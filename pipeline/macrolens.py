"""Reproducible data and forecast pipeline for MacroLens Malaysia."""

from __future__ import annotations

import argparse
import csv
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
import statsmodels.api as sm
from scipy.stats import f as f_distribution
from statsmodels.stats.diagnostic import breaks_cusumolsresid
from statsmodels.tsa.stattools import adfuller
from statsmodels.tsa.statespace.sarimax import SARIMAX

ROOT = Path(__file__).resolve().parents[1]
PUBLISHED = ROOT / "data" / "published" / "dashboard.json"
STRUCTURAL_JSON = ROOT / "data" / "published" / "structural-breaks.json"
STRUCTURAL_CSV = ROOT / "data" / "published" / "structural-breaks.csv"
VINTAGES = ROOT / "data" / "vintages"
USER_AGENT = "MacroLens-Malaysia/2.0 (public economics portfolio)"
BNM_ACCEPT = "application/vnd.BNM.API.v1+json"

EVENT_CATALOGUE = [
    {"date": "2015-04-01", "title": "Goods and Services Tax introduced", "category": "Fiscal policy", "source": "Ministry of Finance", "sourceUrl": "https://www.mof.gov.my/portal/arkib/economy/2016/chapter4.pdf"},
    {"date": "2018-06-01", "title": "GST zero-rated before abolition", "category": "Fiscal policy", "source": "Ministry of Finance", "sourceUrl": "https://belanjawan.mof.gov.my/pdf/belanjawan2026/revenue/section2.pdf"},
    {"date": "2018-09-01", "title": "Sales and Service Tax reintroduced", "category": "Fiscal policy", "source": "Ministry of Finance", "sourceUrl": "https://belanjawan.mof.gov.my/pdf/belanjawan2026/revenue/section2.pdf"},
    {"date": "2020-03-18", "title": "Nationwide Movement Control Order began", "category": "Public health", "source": "Prime Minister's Office", "sourceUrl": "https://www.pmo.gov.my/ucapan/?id=4837&m=p&p=muhyiddin"},
    {"date": "2024-06-10", "title": "Targeted diesel subsidy implemented in Peninsular Malaysia", "category": "Administered prices", "source": "Ministry of Finance", "sourceUrl": "https://www.mof.gov.my/portal/en/news/press-release/government-implements-targeted-diesel-subsidy-for-peninsular-malaysia-effective-10-june-2024"},
]


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


def structural_monthly(key: str, points: list[dict]) -> pd.Series:
    """Normalise indicators to the information represented by each calendar month."""
    series = pd.Series({pd.Timestamp(point["date"]): float(point["value"]) for point in points}, dtype=float).sort_index()
    if key in {"opr", "mgs", "fx"}:
        output = series.resample("MS").last()
        if key == "opr":
            output = output.ffill()
    else:
        output = series.resample("MS").mean()
    return output.dropna()


def _segment_rss(prefix_xx: np.ndarray, prefix_xy: np.ndarray, prefix_yy: np.ndarray, start: int, end: int) -> float:
    xx = prefix_xx[end] - prefix_xx[start]
    xy = prefix_xy[end] - prefix_xy[start]
    yy = float(prefix_yy[end] - prefix_yy[start])
    beta = np.linalg.pinv(xx) @ xy
    return max(yy - float(xy.T @ beta), 1e-12)


def screen_breaks(y: pd.Series, minimum_segment: int, max_breaks: int = 3) -> tuple[list[int], float]:
    """Bai-Perron-style dynamic programming over an AR(1) trend regression."""
    values = y.to_numpy(dtype=float)
    response = values[1:]
    trend = np.arange(1, len(values), dtype=float)
    x = np.column_stack([np.ones(len(response)), trend, values[:-1]])
    n, parameters = len(response), x.shape[1]
    if n < minimum_segment * 2:
        return [], float("nan")
    prefix_xx = np.zeros((n + 1, parameters, parameters))
    prefix_xy = np.zeros((n + 1, parameters))
    prefix_yy = np.zeros(n + 1)
    for index in range(n):
        prefix_xx[index + 1] = prefix_xx[index] + np.outer(x[index], x[index])
        prefix_xy[index + 1] = prefix_xy[index] + x[index] * response[index]
        prefix_yy[index + 1] = prefix_yy[index] + response[index] ** 2

    max_segments = min(max_breaks + 1, n // minimum_segment)
    dp = np.full((max_segments + 1, n + 1), np.inf)
    previous = np.full((max_segments + 1, n + 1), -1, dtype=int)
    dp[0, 0] = 0.0
    for segments in range(1, max_segments + 1):
        earliest_end = segments * minimum_segment
        for end in range(earliest_end, n + 1):
            start_min = (segments - 1) * minimum_segment
            start_max = end - minimum_segment
            for start in range(start_min, start_max + 1):
                if not math.isfinite(dp[segments - 1, start]):
                    continue
                score = dp[segments - 1, start] + _segment_rss(prefix_xx, prefix_xy, prefix_yy, start, end)
                if score < dp[segments, end]:
                    dp[segments, end] = score
                    previous[segments, end] = start

    candidates: list[tuple[float, int]] = []
    for segments in range(1, max_segments + 1):
        rss = dp[segments, n]
        if math.isfinite(rss):
            bic = n * math.log(max(rss / n, 1e-12)) + (parameters * segments + segments - 1) * math.log(n)
            candidates.append((bic, segments))
    best_bic, best_segments = min(candidates)
    boundaries: list[int] = []
    end = n
    for segments in range(best_segments, 0, -1):
        start = int(previous[segments, end])
        if start > 0:
            boundaries.append(start)
        end = start
    return sorted(boundaries), float(best_bic)


def holm_adjust(p_values: list[float]) -> list[float]:
    if not p_values:
        return []
    order = sorted(range(len(p_values)), key=p_values.__getitem__)
    adjusted = [1.0] * len(p_values)
    running = 0.0
    size = len(p_values)
    for rank, original_index in enumerate(order):
        running = max(running, (size - rank) * p_values[original_index])
        adjusted[original_index] = min(1.0, running)
    return adjusted


def nearby_events(period: str, opr_points: list[dict]) -> list[dict]:
    events = list(EVENT_CATALOGUE)
    prior = None
    for point in opr_points:
        value = float(point["value"])
        if prior is not None and not math.isclose(value, prior):
            events.append({
                "date": point["date"], "title": f"OPR changed to {value:.2f}%",
                "category": "Monetary policy", "source": "Bank Negara Malaysia",
                "sourceUrl": "https://financialmarkets.bnm.gov.my/data-download-opr",
            })
        prior = value
    target = pd.Timestamp(period)
    matched = []
    for event in events:
        event_date = pd.Timestamp(event["date"])
        month_distance = abs((target.year - event_date.year) * 12 + target.month - event_date.month)
        if month_distance <= 6:
            matched.append({**event, "monthDistance": int(month_distance)})
    return sorted(matched, key=lambda event: (event["monthDistance"], event["date"]))


def _annual_trend(values: np.ndarray) -> float:
    if len(values) < 2:
        return 0.0
    return float(np.polyfit(np.arange(len(values), dtype=float), values, 1)[0] * 12)


def _hedges_g(pre: np.ndarray, post: np.ndarray) -> float | None:
    degrees = len(pre) + len(post) - 2
    if degrees <= 1:
        return None
    pooled = math.sqrt(((len(pre) - 1) * np.var(pre, ddof=1) + (len(post) - 1) * np.var(post, ddof=1)) / degrees)
    if pooled <= 1e-12:
        return 0.0
    correction = 1 - 3 / (4 * degrees - 1)
    return float(correction * (np.mean(post) - np.mean(pre)) / pooled)


def analyse_structural_indicator(key: str, points: list[dict], opr_points: list[dict], calculated_at: str) -> dict:
    series = structural_monthly(key, points)
    minimum_segment = 24 if len(series) >= 72 else 12
    confidence = "standard" if minimum_segment == 24 else "limited-history"
    warnings: list[str] = []
    if confidence == "limited-history":
        warnings.append("A 12-month minimum regime was required because the available history is short; treat break dates as lower-confidence.")
    if len(series) < minimum_segment * 2 + 1:
        raise ValueError(f"{key}: insufficient monthly history for structural analysis")

    adf_stat, adf_p, adf_lags, _, _, _ = adfuller(series.to_numpy(dtype=float), autolag="AIC")
    if adf_p >= 0.05:
        warnings.append("The level series does not reject a unit root at 5%; level and trend breaks may partly reflect persistence.")

    boundaries, bic = screen_breaks(series, minimum_segment)
    values = series.to_numpy(dtype=float)
    response = values[1:]
    trend = np.arange(1, len(values), dtype=float)
    lag = values[:-1]
    full_x = np.column_stack([np.ones(len(response)), trend, lag])
    full_fit = sm.OLS(response, full_x).fit()
    cusum_stat, cusum_p, _ = breaks_cusumolsresid(full_fit.resid, ddof=full_x.shape[1])

    segment_edges = [0, *boundaries, len(response)]
    candidates = []
    raw_p_values = []
    for position, boundary in enumerate(boundaries, start=1):
        left, right = segment_edges[position - 1], segment_edges[position + 1]
        split = boundary - left
        pooled_y = response[left:right]
        pooled_trend = trend[left:right]
        pooled_lag = lag[left:right]
        pooled_x = np.column_stack([np.ones(len(pooled_y)), pooled_trend, pooled_lag])
        pre_x, post_x = pooled_x[:split], pooled_x[split:]
        pre_y, post_y = pooled_y[:split], pooled_y[split:]
        pooled_rss = float(np.sum(sm.OLS(pooled_y, pooled_x).fit().resid ** 2))
        split_rss = float(np.sum(sm.OLS(pre_y, pre_x).fit().resid ** 2) + np.sum(sm.OLS(post_y, post_x).fit().resid ** 2))
        parameters = pooled_x.shape[1]
        denominator_df = len(pooled_y) - 2 * parameters
        chow_f = max(0.0, ((pooled_rss - split_rss) / parameters) / (split_rss / denominator_df))
        chow_p = float(f_distribution.sf(chow_f, parameters, denominator_df))
        raw_p_values.append(chow_p)

        regime = np.concatenate([np.zeros(split), np.ones(len(pooled_y) - split)])
        interaction_x = np.column_stack([
            np.ones(len(pooled_y)), pooled_trend, pooled_lag,
            regime, regime * pooled_trend, regime * pooled_lag,
        ])
        robust = sm.OLS(pooled_y, interaction_x).fit().get_robustcov_results(cov_type="HAC", maxlags=min(12, len(pooled_y) // 4))
        restriction = np.zeros((3, interaction_x.shape[1]))
        restriction[:, 3:] = np.eye(3)
        wald = robust.wald_test(restriction, scalar=True)
        hac_stat = float(np.asarray(wald.statistic).squeeze())
        hac_p = float(np.asarray(wald.pvalue).squeeze())
        break_period = series.index[boundary + 1].strftime("%Y-%m-%d")
        mean_pre, mean_post = float(np.mean(pre_y)), float(np.mean(post_y))
        effect = _hedges_g(pre_y, post_y)
        candidates.append({
            "breakPeriod": break_period,
            "adjacentSample": {
                "preStart": series.index[left + 1].strftime("%Y-%m-%d"),
                "preEnd": series.index[boundary].strftime("%Y-%m-%d"),
                "postStart": break_period,
                "postEnd": series.index[right].strftime("%Y-%m-%d"),
                "preObservations": int(len(pre_y)), "postObservations": int(len(post_y)),
            },
            "chow": {"fStatistic": round(chow_f, 6), "dfNumerator": parameters, "dfDenominator": int(denominator_df), "pRaw": round(chow_p, 8)},
            "hacWald": {"statistic": round(hac_stat, 6), "df": 3, "pValue": round(hac_p, 8), "maxLags": min(12, len(pooled_y) // 4)},
            "regimeComparison": {
                "preMean": round(mean_pre, 6), "postMean": round(mean_post, 6), "absoluteChange": round(mean_post - mean_pre, 6),
                "percentChange": None if abs(mean_pre) < 1e-12 else round((mean_post / mean_pre - 1) * 100, 4),
                "preAnnualTrend": round(_annual_trend(pre_y), 6), "postAnnualTrend": round(_annual_trend(post_y), 6),
                "annualTrendChange": round(_annual_trend(post_y) - _annual_trend(pre_y), 6),
                "standardisedMeanChange": None if effect is None else round(effect, 6),
            },
            "nearbyEvents": nearby_events(break_period, opr_points),
        })

    for candidate, adjusted in zip(candidates, holm_adjust(raw_p_values)):
        candidate["chow"]["pHolm"] = round(adjusted, 8)
        hac_p = candidate["hacWald"]["pValue"]
        if adjusted < 0.05 and hac_p < 0.05:
            status = "supported"
            label = "Supported structural shift"
        elif adjusted < 0.10 or hac_p < 0.10 or (adjusted < 0.05) != (hac_p < 0.05):
            status = "possible"
            label = "Possible structural shift"
        else:
            status = "not-supported"
            label = "Not statistically supported"
        candidate["status"], candidate["statusLabel"] = status, label

    supported = [candidate for candidate in candidates if candidate["status"] == "supported"]
    possible = [candidate for candidate in candidates if candidate["status"] == "possible"]
    if supported:
        latest = supported[-1]
        change = latest["regimeComparison"]["absoluteChange"]
        direction = "higher" if change > 0 else "lower"
        narrative_text = f"The latest supported parameter shift is estimated near {latest['breakPeriod'][:7]}. The adjacent-regime mean was {abs(change):.2f} units {direction}; both the Holm-adjusted Chow and HAC tests are below 5%."
    elif possible:
        latest = possible[-1]
        narrative_text = f"A possible shift is screened near {latest['breakPeriod'][:7]}, but the classical and autocorrelation-robust evidence do not both meet the 5% threshold."
    elif candidates:
        narrative_text = "The screening step found candidate regime boundaries, but the confirmation tests do not support calling them structural shifts."
    else:
        narrative_text = "BIC selected a stable single-regime specification; no structural break candidate is reported."
    narrative_text += " This is evidence of parameter instability, not proof that a nearby event caused the change."

    return {
        "indicatorId": key, "status": "fresh", "calculatedAt": calculated_at,
        "sample": {"start": series.index[0].strftime("%Y-%m-%d"), "end": series.index[-1].strftime("%Y-%m-%d"), "observations": int(len(series)), "frequency": "Monthly", "minimumSegmentMonths": minimum_segment, "confidence": confidence},
        "screening": {"method": "Bai-Perron-style dynamic programming", "criterion": "BIC", "maximumBreaks": 3, "selectedBreaks": len(boundaries), "bic": None if not math.isfinite(bic) else round(bic, 6)},
        "diagnostics": {"adfStatistic": round(float(adf_stat), 6), "adfPValue": round(float(adf_p), 8), "adfLags": int(adf_lags), "cusumStatistic": round(float(cusum_stat), 6), "cusumPValue": round(float(cusum_p), 8)},
        "warnings": warnings, "candidates": candidates, "narrative": narrative_text,
    }


def build_structural_analysis(series: dict[str, dict], previous: dict | None, calculated_at: str) -> dict:
    prior = (previous or {}).get("structuralBreaks", {}).get("indicators", {})
    indicators: dict[str, dict] = {}
    for key in SPECS:
        fingerprint = hashlib.sha256(json.dumps({"series": series[key]["points"], "oprEvents": series["opr"]["points"]}, sort_keys=True).encode()).hexdigest()
        if prior.get(key, {}).get("seriesFingerprint") == fingerprint:
            indicators[key] = copy.deepcopy(prior[key])
            continue
        try:
            indicators[key] = analyse_structural_indicator(key, series[key]["points"], series["opr"]["points"], calculated_at)
            indicators[key]["seriesFingerprint"] = fingerprint
        except Exception as error:
            if key in prior:
                indicators[key] = copy.deepcopy(prior[key])
                indicators[key]["status"] = "stale"
                indicators[key]["warnings"] = [*indicators[key].get("warnings", []), f"Last valid analysis retained after {type(error).__name__}."]
            else:
                indicators[key] = {"indicatorId": key, "status": "unavailable", "calculatedAt": calculated_at, "seriesFingerprint": fingerprint, "sample": {"start": "", "end": "", "observations": 0, "frequency": "Monthly", "minimumSegmentMonths": 0, "confidence": "unavailable"}, "screening": {"method": "Bai-Perron-style dynamic programming", "criterion": "BIC", "maximumBreaks": 3, "selectedBreaks": 0, "bic": None}, "diagnostics": {"adfStatistic": None, "adfPValue": None, "adfLags": None, "cusumStatistic": None, "cusumPValue": None}, "warnings": [f"Analysis unavailable after {type(error).__name__}."], "candidates": [], "narrative": "Structural analysis is temporarily unavailable for this indicator."}
    calculated = max((item.get("calculatedAt", calculated_at) for item in indicators.values()), default=calculated_at)
    return {
        "status": "fresh" if all(item["status"] == "fresh" for item in indicators.values()) else "partial",
        "calculatedAt": calculated,
        "methodology": {"model": "Level on intercept, linear trend, and one-month lag", "screening": "Bai-Perron-style dynamic programming with BIC", "confirmation": "Classical Chow test with within-indicator Holm correction", "robustness": "HAC/Newey-West joint Wald test and full-sample CUSUM", "significanceLevel": 0.05, "suggestiveLevel": 0.10, "eventWindowMonths": 6, "causalClaim": False},
        "indicators": indicators,
    }


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
    structural_data = build_structural_analysis(series, previous, retrieved)
    payload = {
        "schemaVersion": 2,
        "generatedAt": retrieved,
        "health": "fresh" if all(source["status"] == "fresh" for source in sources.values()) else "partial",
        "sources": sources,
        "series": series,
        "categories": categories,
        "forecast": forecast_data,
        "structuralBreaks": structural_data,
        "narratives": narrative(series, forecast_data),
    }
    if previous:
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
    structural = payload.get("structuralBreaks", {})
    structural_json = json.dumps(structural, indent=2, ensure_ascii=False) + "\n"
    STRUCTURAL_JSON.parent.mkdir(parents=True, exist_ok=True)
    if not STRUCTURAL_JSON.exists() or STRUCTURAL_JSON.read_text(encoding="utf-8") != structural_json:
        STRUCTURAL_JSON.write_text(structural_json, encoding="utf-8")
    rows = []
    for key, indicator in structural.get("indicators", {}).items():
        for candidate in indicator.get("candidates", []):
            comparison = candidate["regimeComparison"]
            rows.append({
                "indicator": key, "break_period": candidate["breakPeriod"], "status": candidate["statusLabel"],
                "chow_f": candidate["chow"]["fStatistic"], "chow_df_numerator": candidate["chow"]["dfNumerator"],
                "chow_df_denominator": candidate["chow"]["dfDenominator"], "chow_p_raw": candidate["chow"]["pRaw"],
                "chow_p_holm": candidate["chow"]["pHolm"], "hac_wald": candidate["hacWald"]["statistic"],
                "hac_p": candidate["hacWald"]["pValue"], "pre_mean": comparison["preMean"], "post_mean": comparison["postMean"],
                "absolute_change": comparison["absoluteChange"], "pre_annual_trend": comparison["preAnnualTrend"],
                "post_annual_trend": comparison["postAnnualTrend"], "standardised_mean_change": comparison["standardisedMeanChange"],
                "nearby_events": " | ".join(event["title"] for event in candidate.get("nearbyEvents", [])),
            })
    fieldnames = ["indicator", "break_period", "status", "chow_f", "chow_df_numerator", "chow_df_denominator", "chow_p_raw", "chow_p_holm", "hac_wald", "hac_p", "pre_mean", "post_mean", "absolute_change", "pre_annual_trend", "post_annual_trend", "standardised_mean_change", "nearby_events"]
    STRUCTURAL_CSV.parent.mkdir(parents=True, exist_ok=True)
    with STRUCTURAL_CSV.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    return changed


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=PUBLISHED)
    args = parser.parse_args()
    payload = build(args.output)
    print(json.dumps({"changed": write_payload(payload, args.output), "generatedAt": payload["generatedAt"], "health": payload["health"]}))


if __name__ == "__main__":
    main()
