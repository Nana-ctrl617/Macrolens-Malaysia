"""Reproducible data and forecast pipeline for MacroLens Malaysia."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
import re
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

import numpy as np
import pandas as pd
import requests
from bs4 import BeautifulSoup
from sklearn.metrics import mean_absolute_error, mean_squared_error
from statsmodels.tsa.statespace.sarimax import SARIMAX

ROOT = Path(__file__).resolve().parents[1]
PUBLISHED = ROOT / "data" / "published" / "dashboard.json"
VINTAGES = ROOT / "data" / "vintages"
USER_AGENT = "MacroLens-Malaysia/2.0 (public economics portfolio)"
BNM_ACCEPT = "application/vnd.BNM.API.v1+json"


@dataclass(frozen=True)
class SeriesSpec:
    key: str
    title: str
    unit: str
    decimals: int
    frequency: str
    source: str
    source_url: str
    minimum: float
    maximum: float
    min_points: int


SPECS = {
    "headline": SeriesSpec("headline", "Headline inflation", "%", 1, "Monthly", "Department of Statistics Malaysia via data.gov.my", "https://data.gov.my/data-catalogue/cpi_headline_inflation", -10, 20, 60),
    "core": SeriesSpec("core", "Core inflation", "%", 1, "Monthly", "Department of Statistics Malaysia via data.gov.my", "https://data.gov.my/data-catalogue/cpi_core_inflation", -10, 20, 60),
    "unemployment": SeriesSpec("unemployment", "Unemployment rate", "%", 1, "Monthly", "Department of Statistics Malaysia via data.gov.my", "https://data.gov.my/data-catalogue/lfs_month", 0, 30, 60),
    "opr": SeriesSpec("opr", "Overnight Policy Rate", "%", 2, "Policy decisions", "Bank Negara Malaysia OpenAPI", "https://apikijangportal.bnm.gov.my/", 0, 20, 20),
    "fx": SeriesSpec("fx", "USD / MYR", "RM", 4, "Monthly end rate", "Bank Negara Malaysia via data.gov.my", "https://data.gov.my/data-catalogue/exchangerates", 1, 10, 60),
    "mgs": SeriesSpec("mgs", "10-year MGS yield", "%", 2, "Trading days", "Bank Negara Malaysia Financial Markets", "https://financialmarkets.bnm.gov.my/benchmark-yields", 0, 20, 1),
}

CATEGORY_NAMES = {
    "01": "Food & non-alcoholic beverages", "02": "Alcoholic beverages & tobacco",
    "03": "Clothing & footwear", "04": "Housing, water, electricity & fuels",
    "05": "Furnishings & household maintenance", "06": "Health", "07": "Transport",
    "08": "Information & communication", "09": "Recreation, sport & culture",
    "10": "Education", "11": "Restaurants & accommodation services",
    "12": "Insurance & financial services", "13": "Personal care & miscellaneous",
}


def get(url: str, **kwargs) -> requests.Response:
    headers = {"User-Agent": USER_AGENT, **kwargs.pop("headers", {})}
    response = requests.get(url, headers=headers, timeout=45, **kwargs)
    response.raise_for_status()
    return response


def read_csv(url: str) -> pd.DataFrame:
    return pd.read_csv(url)


def frame_to_points(frame: pd.DataFrame, date: str, value: str) -> list[dict]:
    output = frame[[date, value]].rename(columns={date: "date", value: "value"}).copy()
    output["date"] = pd.to_datetime(output["date"], errors="raise").dt.strftime("%Y-%m-%d")
    output["value"] = pd.to_numeric(output["value"], errors="raise")
    output = output.dropna(subset=["date", "value"])
    return [{"date": row.date, "value": round(float(row.value), 6)} for row in output.itertuples(index=False)]


def fetch_cpi() -> tuple[list[dict], list[dict], list[dict]]:
    headline = read_csv("https://storage.dosm.gov.my/cpi/cpi_2d_inflation.csv")
    core = read_csv("https://storage.dosm.gov.my/cpi/cpi_2d_core_inflation.csv")
    required = {"date", "division", "inflation_yoy"}
    if not required.issubset(headline.columns) or not required.issubset(core.columns):
        raise ValueError("CPI source structure changed")
    overall = headline[headline["division"].eq("overall")]
    core_overall = core[core["division"].eq("overall")]
    latest_date = headline["date"].max()
    categories = headline[(headline["date"].eq(latest_date)) & (~headline["division"].eq("overall"))]
    categories = categories.assign(value=pd.to_numeric(categories["inflation_yoy"], errors="coerce")).dropna(subset=["value"])
    categories = categories.reindex(categories["value"].abs().sort_values(ascending=False).index).head(8)
    category_points = [{"code": str(row.division), "name": CATEGORY_NAMES.get(str(row.division).zfill(2), str(row.division)), "value": round(float(row.value), 2)} for row in categories.itertuples(index=False)]
    return frame_to_points(overall, "date", "inflation_yoy"), frame_to_points(core_overall, "date", "inflation_yoy"), category_points


def fetch_unemployment() -> list[dict]:
    frame = read_csv("https://storage.dosm.gov.my/labour/lfs_month.csv")
    if not {"date", "u_rate"}.issubset(frame.columns):
        raise ValueError("Labour source structure changed")
    return frame_to_points(frame, "date", "u_rate")


def fetch_opr() -> list[dict]:
    rows: list[dict] = []
    for year in range(2010, datetime.now().year + 1):
        payload = get(f"https://api.bnm.gov.my/public/opr/year/{year}", headers={"Accept": BNM_ACCEPT}).json()
        data = payload.get("data", [])
        if isinstance(data, dict):
            data = [data]
        rows.extend({"date": str(row["date"]), "value": float(row["new_opr_level"])} for row in data)
    deduplicated = {row["date"]: row for row in rows}
    return [deduplicated[date] for date in sorted(deduplicated)]


def fetch_daily_fx() -> list[dict]:
    payload = get("https://api.data.gov.my/data-catalogue?id=exchangerates&limit=10000").json()
    rows = payload if isinstance(payload, list) else payload.get("data", [])
    selected = [row for row in rows if row.get("indicator") == "end"]
    return [{"date": str(row["date"]), "value": float(row["usd"])} for row in selected]


def fetch_mgs_for_date(date: str | None = None) -> dict | None:
    url = SPECS["mgs"].source_url + (f"?date={date}" if date else "")
    html = get(url).text
    soup = BeautifulSoup(html, "html.parser")
    text = soup.get_text(" ", strip=True)
    trading = re.search(r"Trading Date:\s*(\d{1,2}\s+\w+\s+\d{4})", text)
    value = re.search(r"10Y\s+\w+\s+\d{4}\s+[\d.]+\s+[\d.*-]+\s+[\d.*-]+\s+([\d.]+)", text)
    if not trading or not value:
        return None
    return {"date": datetime.strptime(trading.group(1), "%d %b %Y").strftime("%Y-%m-%d"), "value": float(value.group(1))}


def fetch_mgs(previous: dict | None) -> list[dict]:
    old = (previous or {}).get("series", {}).get("mgs", {}).get("points", [])
    if not old:
        legacy = ROOT / "app" / "api" / "indicator" / "route.ts"
        if legacy.exists():
            old = [
                {"date": date, "value": float(value)}
                for date, value in re.findall(r'\["(\d{4}-\d{2}-\d{2})",\s*([\d.]+)\]', legacy.read_text(encoding="utf-8"))
            ]
    try:
        latest = fetch_mgs_for_date()
    except requests.RequestException:
        latest = None
    if not latest and previous:
        raise RuntimeError("BNM benchmark-yield page rejected the automated refresh")
    combined = {point["date"]: point for point in old}
    if latest:
        combined[latest["date"]] = latest
    return [combined[date] for date in sorted(combined)]


def validate_points(key: str, points: list[dict]) -> list[dict]:
    spec = SPECS[key]
    if len(points) < spec.min_points:
        raise ValueError(f"{key}: only {len(points)} observations")
    dates = [point["date"] for point in points]
    if len(dates) != len(set(dates)):
        raise ValueError(f"{key}: duplicate dates")
    if dates != sorted(dates):
        raise ValueError(f"{key}: dates are not sorted")
    for point in points:
        datetime.strptime(point["date"], "%Y-%m-%d")
        value = float(point["value"])
        if not math.isfinite(value) or not spec.minimum <= value <= spec.maximum:
            raise ValueError(f"{key}: implausible value {value}")
    return points


def monthly(points: list[dict]) -> pd.Series:
    series = pd.Series({pd.Timestamp(point["date"]): point["value"] for point in points}, dtype=float).sort_index()
    return series.resample("MS").mean().dropna()


def prepare_exog(series: dict[str, list[dict]], index: pd.DatetimeIndex) -> pd.DataFrame:
    output = pd.DataFrame(index=index)
    output["core"] = monthly(series["core"]).reindex(index)
    for key in ("unemployment", "fx", "opr", "mgs"):
        values = monthly(series[key]).reindex(index).ffill().shift(1)
        output[key] = values
    return output.ffill().dropna()


def fit_model(name: str, y: pd.Series, exog: pd.DataFrame | None = None):
    if name == "SARIMA":
        return SARIMAX(y, order=(1, 0, 1), seasonal_order=(1, 0, 0, 12), trend="c", enforce_stationarity=False, enforce_invertibility=False).fit(disp=False)
    return SARIMAX(y, exog=exog, order=(1, 0, 1), seasonal_order=(0, 0, 0, 0), trend="c", enforce_stationarity=False, enforce_invertibility=False).fit(disp=False)


def backtest(series: dict[str, list[dict]]) -> tuple[list[dict], str]:
    y_full = monthly(series["headline"])
    exog_full = prepare_exog(series, y_full.index)
    common = y_full.index.intersection(exog_full.index)
    y_full, exog_full = y_full.loc[common], exog_full.loc[common]
    origins = range(len(y_full) - 14, len(y_full) - 2)
    actual: list[float] = []
    predictions = {"Seasonal naive": [], "SARIMA": [], "ARIMAX": []}
    for origin in origins:
        train = y_full.iloc[: origin + 1]
        horizon = min(3, len(y_full) - origin - 1)
        truth = y_full.iloc[origin + 1: origin + 1 + horizon]
        actual.extend(truth.tolist())
        seasonal = [float(train.iloc[-12 + step]) for step in range(horizon)]
        predictions["Seasonal naive"].extend(seasonal)
        try:
            predictions["SARIMA"].extend(fit_model("SARIMA", train).get_forecast(horizon).predicted_mean.tolist())
        except Exception:
            predictions["SARIMA"].extend(seasonal)
        try:
            x_train = exog_full.loc[train.index]
            future_x = exog_full.iloc[origin + 1: origin + 1 + horizon].copy()
            for column in future_x:
                future_x[column] = x_train[column].iloc[-1]
            predictions["ARIMAX"].extend(fit_model("ARIMAX", train, x_train).get_forecast(horizon, exog=future_x).predicted_mean.tolist())
        except Exception:
            predictions["ARIMAX"].extend(seasonal)
    scores = []
    rank = {"Seasonal naive": 0, "SARIMA": 1, "ARIMAX": 2}
    for name, values in predictions.items():
        scores.append({"name": name, "rmse": round(float(mean_squared_error(actual, values) ** 0.5), 4), "mae": round(float(mean_absolute_error(actual, values)), 4), "selected": False})
    selected = min(scores, key=lambda score: (score["rmse"], score["mae"], rank[score["name"]]))["name"]
    for score in scores:
        score["selected"] = score["name"] == selected
    return scores, selected


def forecast(series: dict[str, list[dict]]) -> dict:
    scores, selected = backtest(series)
    y = monthly(series["headline"])
    exog = prepare_exog(series, y.index)
    common = y.index.intersection(exog.index)
    y, exog = y.loc[common], exog.loc[common]
    future_dates = pd.date_range(y.index[-1] + pd.offsets.MonthBegin(), periods=3, freq="MS")
    if selected == "Seasonal naive":
        central = np.array([y.iloc[-12 + step] for step in range(3)], dtype=float)
        residuals = (y.iloc[12:].to_numpy() - y.iloc[:-12].to_numpy())
        sigma = float(np.std(residuals, ddof=1))
        intervals = [(value - 1.282 * sigma * math.sqrt(step + 1), value + 1.282 * sigma * math.sqrt(step + 1), value - 1.96 * sigma * math.sqrt(step + 1), value + 1.96 * sigma * math.sqrt(step + 1)) for step, value in enumerate(central)]
    else:
        model = fit_model(selected, y, exog if selected == "ARIMAX" else None)
        if selected == "ARIMAX":
            future_x = pd.DataFrame([exog.iloc[-1].to_dict()] * 3, index=future_dates)
            result = model.get_forecast(3, exog=future_x)
        else:
            result = model.get_forecast(3)
        central = result.predicted_mean.to_numpy()
        ci80 = result.conf_int(alpha=.20).to_numpy()
        ci95 = result.conf_int(alpha=.05).to_numpy()
        intervals = [(ci80[i, 0], ci80[i, 1], ci95[i, 0], ci95[i, 1]) for i in range(3)]
    points = []
    for date, value, bounds in zip(future_dates, central, intervals):
        low80, high80, low95, high95 = bounds
        points.append({"date": date.strftime("%Y-%m-%d"), "value": round(float(value), 3), "low80": round(float(low80), 3), "high80": round(float(high80), 3), "low95": round(float(min(low95, low80)), 3), "high95": round(float(max(high95, high80)), 3)})
    return {"selectedModel": selected, "methodLabel": "Pseudo-real-time backtest using conservative release lags", "backtestWindows": 12, "models": scores, "points": points}


def merge_or_stale(key: str, loader: Callable[[], list[dict]], previous: dict | None, retrieved: str) -> tuple[dict, dict]:
    spec = SPECS[key]
    try:
        points = validate_points(key, loader())
        status = {"status": "fresh", "retrievedAt": retrieved, "observationPeriod": points[-1]["date"], "message": "Official source validated"}
    except Exception as error:
        old = previous and previous.get("series", {}).get(key)
        if not old:
            raise
        points = old["points"]
        status = {"status": "stale", "retrievedAt": retrieved, "observationPeriod": points[-1]["date"], "message": f"Using last valid data: {type(error).__name__}"}
    return {**spec.__dict__, "points": points}, status


def narrative(series: dict[str, dict], forecast_data: dict) -> dict:
    headline = series["headline"]["points"]
    core = series["core"]["points"][-1]["value"]
    latest = headline[-1]["value"]
    prior = headline[-2]["value"]
    direction = "rose" if latest > prior else "eased" if latest < prior else "was unchanged"
    target = forecast_data["points"][-1]["value"]
    return {
        "snapshot": f"Headline inflation {direction} to {latest:.1f}% in the latest release, while core inflation was {core:.1f}%.",
        "forecast": f"The selected {forecast_data['selectedModel']} model places the three-month central forecast at {target:.2f}%. Prediction intervals, rather than the point estimate alone, should guide interpretation.",
        "financial": "Inflation, policy rates, the ringgit and bond yields move together through several channels, but these descriptive relationships are not causal estimates or trading recommendations.",
    }


def build(previous_path: Path = PUBLISHED) -> dict:
    previous = json.loads(previous_path.read_text(encoding="utf-8")) if previous_path.exists() else None
    retrieved = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    headline, core, categories = fetch_cpi()
    loaders: dict[str, Callable[[], list[dict]]] = {
        "headline": lambda: headline,
        "core": lambda: core,
        "unemployment": fetch_unemployment,
        "opr": fetch_opr,
        "fx": fetch_daily_fx,
        "mgs": lambda: fetch_mgs(previous),
    }
    series, sources = {}, {}
    for key, loader in loaders.items():
        series[key], sources[key] = merge_or_stale(key, loader, previous, retrieved)
    try:
        forecast_data = forecast({key: value["points"] for key, value in series.items()})
    except Exception as error:
        if not previous:
            raise
        forecast_data = previous["forecast"]
        forecast_data = {**forecast_data, "status": "stale", "message": f"Forecast retained after {type(error).__name__}"}
    forecast_data.setdefault("status", "fresh")
    payload = {
        "schemaVersion": 1,
        "generatedAt": retrieved,
        "health": "fresh" if all(source["status"] == "fresh" for source in sources.values()) else "partial",
        "sources": sources,
        "series": series,
        "categories": categories,
        "forecast": forecast_data,
        "narratives": narrative(series, forecast_data),
    }
    if previous and payload["health"] == "fresh" and previous.get("health") == "fresh":
        candidate = copy.deepcopy(payload)
        baseline = copy.deepcopy(previous)
        candidate.pop("generatedAt", None)
        baseline.pop("generatedAt", None)
        for source in candidate.get("sources", {}).values():
            source.pop("retrievedAt", None)
        for source in baseline.get("sources", {}).values():
            source.pop("retrievedAt", None)
        if candidate == baseline:
            return previous
    return payload


def write_payload(payload: dict, output: Path = PUBLISHED) -> bool:
    output.parent.mkdir(parents=True, exist_ok=True)
    VINTAGES.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
    old = output.read_text(encoding="utf-8") if output.exists() else ""
    changed = hashlib.sha256(text.encode()).digest() != hashlib.sha256(old.encode()).digest()
    if changed:
        output.write_text(text, encoding="utf-8")
        period = payload["series"]["headline"]["points"][-1]["date"][:7]
        vintage = VINTAGES / f"cpi-{period}.json"
        if not vintage.exists():
            vintage.write_text(text, encoding="utf-8")
    return changed


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=PUBLISHED)
    args = parser.parse_args()
    payload = build(args.output)
    print(json.dumps({"changed": write_payload(payload, args.output), "generatedAt": payload["generatedAt"], "health": payload["health"]}))


if __name__ == "__main__":
    main()
