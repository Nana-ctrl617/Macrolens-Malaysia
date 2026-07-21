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
KLCI_URL = "https://query1.finance.yahoo.com/v8/finance/chart/%5EKLSE?range=10y&interval=1d&events=history"
KLCI_SOURCE_URL = "https://finance.yahoo.com/quote/%5EKLSE/history/"
KLCI_BENCHMARK_URL = "https://research.ftserussell.com/Analytics/FactSheets/Home/DownloadSingleIssue?isManual=False&issueName=FBMKLCI&openfile=open"
GDP_STRUCTURE_URL = "https://storage.dosm.gov.my/gdp/gdp_qtr_nominal_supply.csv"
GDP_STRUCTURE_SOURCE_URL = "https://data.gov.my/data-catalogue/gdp_qtr_nominal_supply"
GDP_DEMAND_URL = "https://storage.dosm.gov.my/gdp/gdp_qtr_nominal_demand.csv"
GDP_DEMAND_SOURCE_URL = "https://data.gov.my/data-catalogue/gdp_qtr_nominal_demand"
TRADE_HEADLINE_URL = "https://storage.dosm.gov.my/trade/trade_headline.csv"
TRADE_HEADLINE_SOURCE_URL = "https://data.gov.my/data-catalogue/trade_headline"
CPI_WEIGHTS_SOURCE_URL = "https://storage.dosm.gov.my/cpi/cpi_2025-07.pdf"
GDP_SECTORS = {
    "p1": "Agriculture",
    "p2": "Mining and quarrying",
    "p3": "Manufacturing",
    "p4": "Construction",
    "p5": "Services",
    "p6": "Import duties",
}
GDP_DEMAND_TYPES = {
    "e1": ("Private consumption", 1),
    "e2": ("Government consumption", 1),
    "e3": ("Gross fixed capital formation", 1),
    "e4": ("Inventories and valuables", 1),
    "e5": ("Exports of goods and services", 1),
    "e6": ("Imports of goods and services", -1),
}

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
CPI_WEIGHTS_2022 = {
    "01": 29.8, "02": 1.9, "03": 2.7, "04": 23.2, "05": 4.3, "06": 2.7,
    "07": 11.3, "08": 6.6, "09": 3.0, "10": 1.3, "11": 3.4, "12": 4.0, "13": 5.8,
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
    category_points = []
    for row in categories.itertuples(index=False):
        code = str(row.division).zfill(2)
        weight = CPI_WEIGHTS_2022.get(code)
        if weight is None:
            raise ValueError(f"Missing official CPI weight for division {code}")
        category_points.append({
            "code": code,
            "name": CATEGORY_NAMES.get(code, code),
            "value": round(float(row.value), 2),
            "weight": weight,
            "contribution": round(weight * float(row.value) / 100, 3),
        })
    if round(sum(item["weight"] for item in category_points), 1) != 100.0:
        raise ValueError("Official CPI division weights do not sum to 100")
    category_points.sort(key=lambda item: abs(item["contribution"]), reverse=True)
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


def parse_klci(payload: dict) -> list[dict]:
    results = payload.get("chart", {}).get("result") or []
    if not results:
        raise ValueError("KLCI response contains no result")
    result = results[0]
    timestamps = result.get("timestamp") or []
    quotes = result.get("indicators", {}).get("quote") or []
    closes = quotes[0].get("close", []) if quotes else []
    if not timestamps or len(timestamps) != len(closes):
        raise ValueError("KLCI source structure changed")
    points: dict[str, dict] = {}
    for timestamp, close in zip(timestamps, closes):
        if close is None:
            continue
        date = datetime.fromtimestamp(int(timestamp), timezone.utc).strftime("%Y-%m-%d")
        value = float(close)
        if not math.isfinite(value) or not 100 <= value <= 5000:
            raise ValueError(f"KLCI implausible value {value}")
        points[date] = {"date": date, "value": round(value, 4)}
    ordered = [points[date] for date in sorted(points)]
    if len(ordered) < 250:
        raise ValueError(f"KLCI has only {len(ordered)} valid observations")
    return ordered


def fetch_klci() -> list[dict]:
    return parse_klci(get(KLCI_URL).json())


def parse_economic_structure(frame: pd.DataFrame, retrieved: str) -> dict:
    """Aggregate complete quarterly nominal GDP observations into annual sector shares."""
    required = {"series", "date", "sector", "value"}
    if not required.issubset(frame.columns):
        raise ValueError("GDP sector source structure changed")
    selected = frame.loc[frame["series"].eq("abs"), list(required)].copy()
    selected["date"] = pd.to_datetime(selected["date"], errors="raise")
    selected["value"] = pd.to_numeric(selected["value"], errors="raise")
    selected = selected[selected["sector"].isin({"p0", *GDP_SECTORS})]
    if selected.empty or selected["value"].isna().any():
        raise ValueError("GDP sector source is empty or malformed")
    if selected.duplicated(["date", "sector"]).any():
        raise ValueError("GDP sector source contains duplicate quarter-sector rows")
    if (selected["value"] < 0).any():
        raise ValueError("GDP sector source contains implausible negative values")
    selected["year"] = selected["date"].dt.year
    selected["quarter"] = selected["date"].dt.quarter

    years: list[dict] = []
    for year, annual_frame in selected.groupby("year", sort=True):
        counts = annual_frame.groupby("sector")["quarter"].nunique()
        if any(int(counts.get(code, 0)) != 4 for code in ["p0", *GDP_SECTORS]):
            continue
        totals = annual_frame.groupby("sector")["value"].sum()
        total_million = float(totals["p0"])
        sector_sum = sum(float(totals[code]) for code in GDP_SECTORS)
        if total_million <= 0 or abs(sector_sum - total_million) / total_million > 0.003:
            raise ValueError(f"GDP sector values do not reconcile for {year}")
        sectors = [
            {
                "id": code,
                "name": name,
                "value": round(float(totals[code]) / 1000, 3),
                "share": round(float(totals[code]) / total_million * 100, 2),
            }
            for code, name in GDP_SECTORS.items()
        ]
        sectors.sort(key=lambda item: item["share"], reverse=True)
        for rank, sector in enumerate(sectors, start=1):
            sector["rank"] = rank
        years.append({"year": int(year), "total": round(total_million / 1000, 3), "sectors": sectors})

    if len(years) < 5:
        raise ValueError("GDP sector source has insufficient complete annual history")
    previous_by_sector: dict[str, float] = {}
    previous_total: float | None = None
    for year_data in years:
        total_change = year_data["total"] - previous_total if previous_total is not None else None
        for sector in year_data["sectors"]:
            previous_value = previous_by_sector.get(sector["id"])
            change_value = sector["value"] - previous_value if previous_value is not None else None
            sector["changeValue"] = round(change_value, 3) if change_value is not None else None
            sector["changeYoY"] = round(change_value / previous_value * 100, 2) if previous_value and change_value is not None else None
            sector["growthContribution"] = round(change_value / total_change * 100, 2) if total_change and change_value is not None else None
            previous_by_sector[sector["id"]] = sector["value"]
        previous_total = year_data["total"]
        ranked = year_data["sectors"]
        largest = ranked[0]
        comparable = [sector for sector in ranked if sector["id"] != "p6" and sector["changeYoY"] is not None]
        fastest = max(comparable, key=lambda item: item["changeYoY"]) if comparable else largest
        contributor = max(comparable, key=lambda item: item["changeValue"]) if comparable else largest
        year_data["summary"] = {
            "largestSector": largest["name"],
            "largestShare": largest["share"],
            "fastestGrowingSector": fastest["name"],
            "fastestGrowth": fastest["changeYoY"],
            "largestGrowthContributor": contributor["name"],
            "largestContributionValue": contributor["changeValue"],
        }
        if comparable:
            year_data["narrative"] = (
                f"{largest['name']} was Malaysia's largest production sector in {year_data['year']}, accounting for "
                f"{largest['share']:.1f}% of nominal GDP. {fastest['name']} recorded the fastest current-price "
                f"increase at {fastest['changeYoY']:+.1f}%, while {contributor['name']} added the largest ringgit "
                f"amount to the annual change (RM {contributor['changeValue']:+.1f} billion)."
            )
        else:
            year_data["narrative"] = f"{largest['name']} was Malaysia's largest production sector in {year_data['year']}, accounting for {largest['share']:.1f}% of nominal GDP."

    latest = years[-1]
    return {
        "status": "fresh",
        "retrievedAt": retrieved,
        "observationPeriod": f"{latest['year']}-12-31",
        "source": "Department of Statistics Malaysia via data.gov.my",
        "sourceUrl": GDP_STRUCTURE_SOURCE_URL,
        "datasetUrl": GDP_STRUCTURE_URL,
        "frequency": "Annual totals aggregated from quarterly observations",
        "measure": "GDP at current prices by production sector",
        "unit": "RM billion",
        "latestYear": latest["year"],
        "years": years,
        "note": "Sector shares describe where value added is produced. They are not government revenue, company profit or household income. Current-price changes combine real output and price effects.",
        "message": "Official quarterly observations validated; only complete calendar years are published",
    }


def build_economic_structure(previous: dict | None, retrieved: str) -> dict:
    try:
        return parse_economic_structure(read_csv(GDP_STRUCTURE_URL), retrieved)
    except Exception as error:
        old = (previous or {}).get("economicStructure")
        if not old or not old.get("years"):
            raise
        return {
            **copy.deepcopy(old),
            "status": "stale",
            "retrievedAt": retrieved,
            "message": f"Using last valid GDP sector data: {type(error).__name__}",
        }


def parse_gdp_demand(frame: pd.DataFrame, retrieved: str) -> dict:
    required = {"series", "date", "type", "value"}
    if not required.issubset(frame.columns):
        raise ValueError("GDP demand source structure changed")
    selected = frame.loc[frame["series"].eq("abs"), list(required)].copy()
    selected["date"] = pd.to_datetime(selected["date"], errors="raise")
    selected["value"] = pd.to_numeric(selected["value"], errors="raise")
    selected = selected[selected["type"].isin({"e0", *GDP_DEMAND_TYPES})]
    if selected.empty or selected["value"].isna().any():
        raise ValueError("GDP demand source is empty or malformed")
    if selected.duplicated(["date", "type"]).any():
        raise ValueError("GDP demand source contains duplicate quarter-component rows")
    if (selected.loc[selected["type"].ne("e4"), "value"] < 0).any():
        raise ValueError("GDP demand source contains implausible negative values")
    selected["year"] = selected["date"].dt.year
    selected["quarter"] = selected["date"].dt.quarter

    years: list[dict] = []
    for year, annual_frame in selected.groupby("year", sort=True):
        counts = annual_frame.groupby("type")["quarter"].nunique()
        if any(int(counts.get(code, 0)) != 4 for code in ["e0", *GDP_DEMAND_TYPES]):
            continue
        totals = annual_frame.groupby("type")["value"].sum()
        total_million = float(totals["e0"])
        signed_sum = sum(float(totals[code]) * sign for code, (_, sign) in GDP_DEMAND_TYPES.items())
        if total_million <= 0 or abs(signed_sum - total_million) / total_million > 0.01:
            raise ValueError(f"GDP demand values do not reconcile for {year}")
        components = []
        for code, (name, sign) in GDP_DEMAND_TYPES.items():
            value = float(totals[code])
            components.append({
                "id": code,
                "name": name,
                "value": round(value / 1000, 3),
                "share": round(value / total_million * 100, 2),
                "gdpSign": sign,
                "signedValue": round(value * sign / 1000, 3),
            })
        years.append({"year": int(year), "total": round(total_million / 1000, 3), "components": components})

    if len(years) < 5:
        raise ValueError("GDP demand source has insufficient complete annual history")
    previous_by_component: dict[str, float] = {}
    previous_total: float | None = None
    for year_data in years:
        total_change = year_data["total"] - previous_total if previous_total is not None else None
        comparable = []
        for component in year_data["components"]:
            previous_value = previous_by_component.get(component["id"])
            change_value = component["value"] - previous_value if previous_value is not None else None
            component["changeValue"] = round(change_value, 3) if change_value is not None else None
            component["changeYoY"] = round(change_value / previous_value * 100, 2) if previous_value and change_value is not None else None
            signed_change = change_value * component["gdpSign"] if change_value is not None else None
            component["signedContribution"] = round(signed_change / total_change * 100, 2) if total_change and signed_change is not None else None
            previous_by_component[component["id"]] = component["value"]
            if component["changeValue"] is not None and component["id"] != "e4":
                comparable.append(component)
        previous_total = year_data["total"]
        driver = max(comparable, key=lambda item: abs(item["signedContribution"] or 0)) if comparable else year_data["components"][0]
        demand_type = (
            "consumption-led" if driver["id"] == "e1" else
            "investment-led" if driver["id"] == "e3" else
            "export-led" if driver["id"] == "e5" else
            "import-sensitive" if driver["id"] == "e6" else
            "broad-based"
        )
        year_data["summary"] = {
            "largestComponent": max(year_data["components"], key=lambda item: item["share"])["name"],
            "largestShare": max(year_data["components"], key=lambda item: item["share"])["share"],
            "largestGrowthDriver": driver["name"],
            "largestContribution": driver.get("signedContribution"),
            "demandType": demand_type,
        }
        year_data["narrative"] = (
            f"The expenditure view for {year_data['year']} looks {demand_type}. "
            f"{driver['name']} made the largest absolute contribution to the annual GDP change "
            f"among the main demand components."
        )
    latest = years[-1]
    return {
        "status": "fresh",
        "retrievedAt": retrieved,
        "observationPeriod": f"{latest['year']}-12-31",
        "source": "Department of Statistics Malaysia via data.gov.my",
        "sourceUrl": GDP_DEMAND_SOURCE_URL,
        "datasetUrl": GDP_DEMAND_URL,
        "frequency": "Annual totals aggregated from quarterly observations",
        "measure": "GDP at current prices by expenditure type",
        "unit": "RM billion",
        "latestYear": latest["year"],
        "years": years,
        "note": "Imports are shown as a positive ringgit flow but subtract from GDP in the expenditure identity. Inventories are volatile and should not be read as a stable demand engine.",
        "message": "Official quarterly expenditure observations validated; complete years only",
    }


def build_growth_drivers(previous: dict | None, retrieved: str, production: dict) -> dict:
    try:
        demand = parse_gdp_demand(read_csv(GDP_DEMAND_URL), retrieved)
        status = "fresh" if production.get("status") == "fresh" else "partial"
        message = "Production and expenditure GDP views validated"
    except Exception as error:
        old = (previous or {}).get("growthDrivers")
        if old and old.get("demand", {}).get("years"):
            demand = copy.deepcopy(old["demand"])
            demand["status"] = "stale"
            demand["retrievedAt"] = retrieved
            demand["message"] = f"Using last valid GDP demand data: {type(error).__name__}"
            status = "partial"
            message = "Production view refreshed; expenditure view retained from last validation"
        else:
            demand = {
                "status": "unavailable",
                "retrievedAt": retrieved,
                "observationPeriod": production.get("observationPeriod", ""),
                "source": "Department of Statistics Malaysia via data.gov.my",
                "sourceUrl": GDP_DEMAND_SOURCE_URL,
                "datasetUrl": GDP_DEMAND_URL,
                "frequency": "Quarterly",
                "measure": "GDP at current prices by expenditure type",
                "unit": "RM billion",
                "latestYear": None,
                "years": [],
                "note": "Expenditure-side GDP could not be validated in this run.",
                "message": f"Expenditure view unavailable: {type(error).__name__}",
            }
            status = "partial"
            message = "Production view available; expenditure view unavailable"
    latest_production = production.get("years", [{}])[-1]
    latest_demand = demand.get("years", [{}])[-1] if demand.get("years") else {}
    production_driver = latest_production.get("summary", {}).get("largestGrowthContributor", "the largest production sector")
    demand_driver = latest_demand.get("summary", {}).get("largestGrowthDriver", "available demand components")
    return {
        "status": status,
        "generatedAt": retrieved,
        "production": production,
        "demand": demand,
        "summary": (
            f"Production-side GDP is still anchored by {latest_production.get('summary', {}).get('largestSector', 'the services sector')}. "
            f"The latest expenditure-side screen points to {demand_driver} as the main annual demand-side driver where data are available."
        ),
        "message": message,
    }


def parse_trade_headline(frame: pd.DataFrame, retrieved: str) -> dict:
    required = {"date", "series", "total", "balance", "exports", "imports"}
    if not required.issubset(frame.columns):
        raise ValueError("Trade source structure changed")
    selected = frame.loc[frame["series"].eq("abs"), list(required)].copy()
    selected["date"] = pd.to_datetime(selected["date"], errors="raise")
    for column in ["total", "balance", "exports", "imports"]:
        selected[column] = pd.to_numeric(selected[column], errors="raise")
    selected = selected.dropna(subset=["date", "total", "balance", "exports", "imports"]).sort_values("date")
    if selected.empty:
        raise ValueError("Trade source is empty")
    if selected.duplicated("date").any():
        raise ValueError("Trade source contains duplicate monthly rows")
    if (selected[["total", "exports", "imports"]] <= 0).any().any():
        raise ValueError("Trade source contains implausible non-positive flows")
    selected["check_balance"] = selected["exports"] - selected["imports"]
    if ((selected["check_balance"] - selected["balance"]).abs() / selected["total"]).max() > 0.002:
        raise ValueError("Trade balance does not reconcile with exports and imports")
    points = [
        {
            "date": row.date.strftime("%Y-%m-%d"),
            "exports": round(float(row.exports) / 1_000_000_000, 3),
            "imports": round(float(row.imports) / 1_000_000_000, 3),
            "total": round(float(row.total) / 1_000_000_000, 3),
            "balance": round(float(row.balance) / 1_000_000_000, 3),
        }
        for row in selected.itertuples(index=False)
    ]
    if len(points) < 60:
        raise ValueError("Trade source has insufficient monthly history")
    latest = points[-1]
    same_month_prior = next((point for point in reversed(points[:-1]) if point["date"][:7] == f"{int(latest['date'][:4]) - 1}{latest['date'][4:7]}"), None)
    last12 = points[-12:]
    prior12 = points[-24:-12] if len(points) >= 24 else []
    def growth(column: str) -> float | None:
        if same_month_prior and same_month_prior[column]:
            return round((latest[column] / same_month_prior[column] - 1) * 100, 2)
        return None
    last12_balance = sum(point["balance"] for point in last12)
    prior12_balance = sum(point["balance"] for point in prior12) if prior12 else None
    export_growth = growth("exports")
    import_growth = growth("imports")
    trade_reading = (
        "exports outpaced imports" if export_growth is not None and import_growth is not None and export_growth > import_growth else
        "imports grew faster than exports" if export_growth is not None and import_growth is not None and import_growth > export_growth else
        "trade growth was balanced"
    )
    return {
        "status": "fresh",
        "retrievedAt": retrieved,
        "observationPeriod": latest["date"],
        "source": "Department of Statistics Malaysia via data.gov.my",
        "sourceUrl": TRADE_HEADLINE_SOURCE_URL,
        "datasetUrl": TRADE_HEADLINE_URL,
        "frequency": "Monthly",
        "unit": "RM billion",
        "points": points,
        "summary": {
            "latestDate": latest["date"],
            "exports": latest["exports"],
            "imports": latest["imports"],
            "total": latest["total"],
            "balance": latest["balance"],
            "exportsYoY": export_growth,
            "importsYoY": import_growth,
            "last12Balance": round(last12_balance, 3),
            "prior12Balance": round(prior12_balance, 3) if prior12_balance is not None else None,
            "tradeReading": trade_reading,
        },
        "narratives": {
            "performance": f"In the latest month, Malaysia recorded RM {latest['exports']:.1f} billion of goods exports and RM {latest['imports']:.1f} billion of goods imports, leaving a RM {latest['balance']:.1f} billion trade balance.",
            "macro": "Goods trade matters for the ringgit, manufacturing demand and imported-cost pressure, but it excludes services trade and does not by itself explain GDP or market performance.",
        },
        "message": "Official monthly trade headline data validated",
    }


def build_external_sector(previous: dict | None, retrieved: str) -> dict:
    try:
        return parse_trade_headline(read_csv(TRADE_HEADLINE_URL), retrieved)
    except Exception as error:
        old = (previous or {}).get("externalSector")
        if not old or not old.get("points"):
            raise
        return {
            **copy.deepcopy(old),
            "status": "stale",
            "retrievedAt": retrieved,
            "message": f"Using last valid trade data: {type(error).__name__}",
        }


def market_statistics(points: list[dict]) -> dict:
    values = pd.Series(
        [float(point["value"]) for point in points],
        index=pd.to_datetime([point["date"] for point in points]),
        dtype=float,
    ).sort_index()
    latest_date, latest = values.index[-1], float(values.iloc[-1])

    def return_since(target: pd.Timestamp) -> float | None:
        eligible = values.loc[:target]
        if eligible.empty:
            return None
        return round((latest / float(eligible.iloc[-1]) - 1) * 100, 2)

    one_year = values.loc[values.index >= latest_date - pd.DateOffset(years=1)]
    daily_returns = one_year.pct_change().dropna()
    running_peak = one_year.cummax()
    drawdown = one_year / running_peak - 1
    prior = float(values.iloc[-2]) if len(values) > 1 else latest
    return {
        "latest": round(latest, 2),
        "latestDate": latest_date.strftime("%Y-%m-%d"),
        "change1D": round((latest / prior - 1) * 100, 2),
        "return1M": return_since(latest_date - pd.DateOffset(months=1)),
        "return3M": return_since(latest_date - pd.DateOffset(months=3)),
        "returnYtd": return_since(pd.Timestamp(year=latest_date.year - 1, month=12, day=31)),
        "return1Y": return_since(latest_date - pd.DateOffset(years=1)),
        "annualizedVolatility1Y": round(float(daily_returns.std(ddof=1) * math.sqrt(252) * 100), 2) if len(daily_returns) > 1 else None,
        "maxDrawdown1Y": round(float(drawdown.min() * 100), 2),
        "high52w": round(float(one_year.max()), 2),
        "low52w": round(float(one_year.min()), 2),
    }


def build_market(previous: dict | None, retrieved: str) -> dict:
    try:
        points = fetch_klci()
        status, message = "fresh", "Delayed daily prices validated"
    except Exception as error:
        old = (previous or {}).get("market", {}).get("benchmark", {}).get("points")
        if not old:
            raise
        points = old
        status, message = "stale", f"Using last valid market data: {type(error).__name__}"
    summary = market_statistics(points)
    one_year = summary["return1Y"]
    direction = "gained" if one_year is not None and one_year > 0 else "declined" if one_year is not None and one_year < 0 else "was broadly unchanged"
    magnitude = abs(one_year or 0)
    performance = f"The FBM KLCI {direction} {magnitude:.1f}% over the latest year, with {summary['annualizedVolatility1Y']:.1f}% annualised volatility and a {abs(summary['maxDrawdown1Y']):.1f}% maximum drawdown during that window."
    macro = "The index can respond to earnings, global risk appetite, commodity prices, interest rates and the ringgit. These co-movements are context, not evidence that any one macro variable caused the market move."
    return {
        "status": status,
        "retrievedAt": retrieved,
        "message": message,
        "benchmark": {
            "id": "fbmklci", "title": "FTSE Bursa Malaysia KLCI", "symbol": "^KLSE",
            "currency": "MYR", "unit": "index points", "decimals": 2,
            "frequency": "Trading days", "source": "Yahoo Finance delayed market data",
            "sourceUrl": KLCI_SOURCE_URL, "benchmarkSource": "FTSE Russell / Bursa Malaysia",
            "benchmarkSourceUrl": KLCI_BENCHMARK_URL, "delayed": True, "points": points,
        },
        "summary": summary,
        "narratives": {"performance": performance, "macro": macro},
    }


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
    scenario = None
    try:
        sensitivity_model = fit_model("ARIMAX", y, exog)
        scenario = {
            "model": "ARIMAX sensitivity model",
            "lag": "One-month-lag economic inputs",
            "baseline": {key: round(float(exog[key].iloc[-1]), 4) for key in ("core", "fx", "opr")},
            "coefficients": {key: round(float(sensitivity_model.params[key]), 6) for key in ("core", "fx", "opr")},
            "warning": "A sensitivity overlay based on historical ARIMAX associations. It is not the selected forecast unless ARIMAX wins the backtest, and it does not identify causal effects.",
        }
    except Exception:
        scenario = None
    return {"selectedModel": selected, "methodLabel": "Pseudo-real-time backtest using conservative release lags", "backtestWindows": 12, "models": scores, "points": points, "scenario": scenario}


def build_cpi_decomposition(categories: list[dict], headline_points: list[dict]) -> dict:
    headline = float(headline_points[-1]["value"])
    estimated = round(sum(float(item["contribution"]) for item in categories), 3)
    return {
        "observationPeriod": headline_points[-1]["date"],
        "weightReferenceYear": 2022,
        "effectiveFrom": "2024-01",
        "source": "Department of Statistics Malaysia CPI publication",
        "sourceUrl": CPI_WEIGHTS_SOURCE_URL,
        "headline": round(headline, 3),
        "estimatedTotal": estimated,
        "reconciliationGap": round(headline - estimated, 3),
        "method": "Official division weight multiplied by the division year-on-year inflation rate",
        "warning": "This is a transparent weighted-pressure estimate. Malaysia uses a chained CPI, so division estimates need not add exactly to headline inflation; the reconciliation gap is shown rather than hidden.",
    }


def build_data_operations(series: dict[str, dict], generated_at: str) -> dict:
    headline = series["headline"]["points"]
    core_by_date = {item["date"]: item["value"] for item in series["core"]["points"]}
    current_period = headline[-1]["date"][:7]
    stored = {path.stem.removeprefix("cpi-") for path in VINTAGES.glob("cpi-*.json")}
    stored.add(current_period)
    releases = []
    for item in reversed(headline[-6:]):
        releases.append({
            "period": item["date"],
            "headline": round(float(item["value"]), 2),
            "core": round(float(core_by_date[item["date"]]), 2) if item["date"] in core_by_date else None,
        })
    return {
        "schedule": "Daily at 13:45 Malaysia time",
        "lastSuccessfulRefresh": generated_at,
        "vintageCount": len(stored),
        "latestVintagePeriod": current_period,
        "vintagePolicy": "A new immutable CPI snapshot is stored whenever the published CPI period changes.",
        "releaseLog": releases,
    }


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


def _series_change(series: dict, months: int) -> float | None:
    points = series["points"]
    if len(points) <= months:
        return None
    return round(float(points[-1]["value"]) - float(points[-1 - months]["value"]), 4)


def _series_percentile(series: dict) -> float:
    values = [float(point["value"]) for point in series["points"]]
    latest = values[-1]
    return round(sum(1 for value in values if value <= latest) / len(values) * 100, 1)


def _heat_level(score: int) -> str:
    return "high" if score >= 70 else "moderate" if score >= 40 else "low"


def build_risk_heatmap(series: dict[str, dict], market: dict, growth_drivers: dict, external: dict, generated_at: str) -> dict:
    def item(id_: str, label: str, group: str, score: int, evidence: str, rule: str, period: str, watch: str) -> dict:
        return {
            "id": id_,
            "label": label,
            "group": group,
            "score": int(max(0, min(100, score))),
            "level": _heat_level(score),
            "evidence": evidence,
            "rule": rule,
            "period": period,
            "watch": watch,
        }

    headline = float(series["headline"]["points"][-1]["value"])
    core = float(series["core"]["points"][-1]["value"])
    unemployment = float(series["unemployment"]["points"][-1]["value"])
    opr = float(series["opr"]["points"][-1]["value"])
    fx = float(series["fx"]["points"][-1]["value"])
    mgs = float(series["mgs"]["points"][-1]["value"])
    market_return = market["summary"].get("return1Y")
    market_drawdown = abs(float(market["summary"].get("maxDrawdown1Y") or 0))
    trade_balance = external["summary"]["balance"]
    exports_yoy = external["summary"].get("exportsYoY")
    imports_yoy = external["summary"].get("importsYoY")
    demand_summary = growth_drivers.get("demand", {}).get("years", [{}])[-1].get("summary", {})

    items = [
        item("headline", "Headline inflation", "Prices", 25 if headline < 2 else 45 if headline < 3 else 75,
             f"Latest headline CPI inflation is {headline:.1f}%.", "Low below 2%, moderate from 2-3%, high at 3% or above.", series["headline"]["points"][-1]["date"], "Watch food, transport and administered-price categories."),
        item("core", "Core inflation", "Prices", 25 if core < 2 else 50 if core < 3 else 75,
             f"Latest core inflation is {core:.1f}%; 3-month change is {_series_change(series['core'], 3) or 0:+.1f} pp.", "Low below 2%, moderate from 2-3%, high at 3% or above.", series["core"]["points"][-1]["date"], "Persistent core pressure matters more than one monthly headline move."),
        item("unemployment", "Labour market", "Households", 25 if unemployment < 4 else 55 if unemployment < 5 else 80,
             f"Unemployment is {unemployment:.1f}%.", "Low below 4%, moderate from 4-5%, high at 5% or above.", series["unemployment"]["points"][-1]["date"], "National unemployment can hide sector and regional weakness."),
        item("opr", "Policy rate", "Financial conditions", 35 if opr < 2.5 else 55 if opr < 3.25 else 75,
             f"OPR is {opr:.2f}%.", "Low below 2.50%, moderate from 2.50-3.25%, high above 3.25%.", series["opr"]["points"][-1]["date"], "The real policy stance also depends on expected inflation."),
        item("fx", "USD/MYR pressure", "External", 30 if fx < 4.2 else 55 if fx < 4.6 else 80,
             f"USD/MYR is RM {fx:.4f}, at the {_series_percentile(series['fx']):.1f}th percentile of this dashboard history.", "Higher USD/MYR levels receive higher imported-cost pressure scores.", series["fx"]["points"][-1]["date"], "A weaker ringgit can help exporters while raising imported costs."),
        item("mgs", "10-year MGS yield", "Financial conditions", 30 if mgs < 3.5 else 55 if mgs < 4.25 else 80,
             f"10-year MGS yield is {mgs:.2f}%.", "Low below 3.50%, moderate from 3.50-4.25%, high above 4.25%.", series["mgs"]["points"][-1]["date"], "Bond yields reflect policy expectations, term premium and global rates."),
        item("bursa", "Bursa large-cap market", "Markets", 35 if (market_return or 0) >= 5 and market_drawdown < 10 else 55 if (market_return or 0) > -5 else 75,
             f"KLCI one-year price return is {(market_return or 0):+.1f}% with a {market_drawdown:.1f}% max drawdown.", "Higher pressure when one-year return is negative or drawdown is large.", market["summary"]["latestDate"], "Index performance excludes dividends, fees and taxes."),
        item("growth", "GDP growth drivers", "Growth", 35 if demand_summary.get("demandType") in {"consumption-led", "export-led", "investment-led"} else 55,
             f"Latest demand screen is {demand_summary.get('demandType', 'production-only')}.", "Lower pressure when a clear demand engine is visible; higher when only partial evidence is available.", growth_drivers.get("demand", {}).get("observationPeriod") or growth_drivers.get("production", {}).get("observationPeriod", ""), "Current-price GDP combines volume and price effects."),
        item("trade", "Goods trade balance", "External", 30 if trade_balance > 0 and (exports_yoy or 0) >= (imports_yoy or 0) else 55 if trade_balance > 0 else 75,
             f"Latest goods trade balance is RM {trade_balance:+.1f} billion; exports YoY {exports_yoy if exports_yoy is not None else 0:+.1f}%, imports YoY {imports_yoy if imports_yoy is not None else 0:+.1f}%.", "Higher pressure when trade balance is negative or imports grow faster than exports.", external["summary"]["latestDate"], "Goods trade excludes services and income flows."),
    ]
    average = round(sum(entry["score"] for entry in items) / len(items), 1)
    top = sorted(items, key=lambda entry: entry["score"], reverse=True)[:3]
    return {
        "generatedAt": generated_at,
        "status": "fresh" if market["status"] == "fresh" and external["status"] == "fresh" and growth_drivers["status"] == "fresh" else "partial",
        "overallScore": average,
        "overallLevel": _heat_level(int(average)),
        "summary": f"The current macro risk screen is {_heat_level(int(average))}. The highest-pressure signals are {', '.join(entry['label'] for entry in top)}.",
        "method": "Deterministic rules combine latest levels, recent changes, historical percentile checks and market/trade summaries. Scores are descriptive screens, not forecasts or causal estimates.",
        "items": items,
    }


def build_latest_brief(series: dict[str, dict], forecast_data: dict, market: dict, growth_drivers: dict, external: dict, risk: dict, generated_at: str) -> dict:
    latest_headline = series["headline"]["points"][-1]
    prior_headline = series["headline"]["points"][-2]
    headline_change = float(latest_headline["value"]) - float(prior_headline["value"])
    core = float(series["core"]["points"][-1]["value"])
    fx_change = _series_change(series["fx"], 3) or 0
    forecast_target = forecast_data["points"][-1]["value"]
    watched = sorted(risk["items"], key=lambda entry: entry["score"], reverse=True)[:3]
    return {
        "generatedAt": generated_at,
        "status": risk["status"],
        "period": latest_headline["date"],
        "headline": f"Malaysia's latest macro reading is {risk['overallLevel']} pressure, with headline inflation at {float(latest_headline['value']):.1f}% and core inflation at {core:.1f}%.",
        "whatChanged": [
            f"Headline inflation moved {headline_change:+.1f} percentage points from the prior monthly release.",
            f"The ringgit moved {fx_change:+.2f} against the US dollar over the latest three-month dashboard window.",
            f"The FBM KLCI one-year price return is {(market['summary'].get('return1Y') or 0):+.1f}%, while the latest goods trade balance is RM {external['summary']['balance']:+.1f} billion.",
        ],
        "whyItMayHaveHappened": [
            "Inflation changes can reflect category-level CPI pressure, policy effects, administered prices and imported costs.",
            "Exchange-rate and bond-yield changes may reflect both Malaysian conditions and global interest-rate or risk-appetite shifts.",
            "GDP and trade readings help separate domestic demand from external demand, but they are not causal proof for market moves.",
        ],
        "watchNext": [f"{entry['label']}: {entry['watch']}" for entry in watched],
        "implications": [
            "Individuals should stress-test savings, debt repayments and job resilience against the highest-pressure signals.",
            "Companies should review pricing, cash flow, FX exposure and hiring plans using their own contracts and margins.",
            f"The three-month inflation forecast ends at {forecast_target:.2f}%, but the prediction intervals are more important than the point estimate.",
        ],
        "disclaimer": "Educational macroeconomic briefing only. It is not personalised financial, investment, property, legal, tax or career advice.",
    }


def build_decision_guide(series: dict[str, dict], market: dict, generated_at: str, risk: dict | None = None, external: dict | None = None) -> dict:
    def latest(key: str) -> tuple[float, str]:
        point = series[key]["points"][-1]
        return float(point["value"]), point["date"]

    headline, headline_date = latest("headline")
    core, core_date = latest("core")
    opr, opr_date = latest("opr")
    unemployment, unemployment_date = latest("unemployment")
    fx, fx_date = latest("fx")
    mgs, mgs_date = latest("mgs")
    market_summary = market["summary"]
    market_return = float(market_summary.get("return1Y") or 0)

    inflation_reading = "positive but moderate" if 0 < headline < 3 else "elevated" if headline >= 3 else "very weak or negative"
    rate_reading = "Borrowing still carries a meaningful financing cost" if opr >= 2.5 else "Policy rates are comparatively accommodative"
    labour_reading = "The national unemployment rate is relatively low" if unemployment < 4 else "Labour-market slack is elevated"
    market_reading = "positive" if market_return > 3 else "negative" if market_return < -3 else "broadly flat"

    individuals = [
        {
            "id": "safety-buffer", "theme": "Savings and resilience", "stance": "Protect first",
            "title": "Build liquidity before taking more market risk",
            "evidence": f"Headline inflation is {headline:.1f}% and core inflation is {core:.1f}%, so cash purchasing power still changes even when inflation is moderate.",
            "actions": ["Estimate essential monthly commitments and work toward an emergency buffer suited to income stability.", "Keep emergency money accessible; compare deposit terms, withdrawal limits and PIDM protection before choosing an account.", "Automate a realistic monthly transfer instead of relying on leftover cash."],
            "watch": "Job stability, household-specific expenses and any variable-rate debt matter more than the national average alone.",
        },
        {
            "id": "listed-investments", "theme": "Stocks and long-term investing", "stance": "Avoid chasing",
            "title": "Use goals and diversification, not the latest index move",
            "evidence": f"The FBM KLCI's latest one-year price return is {market_return:+.1f}% and its measured one-year volatility is {market_summary.get('annualizedVolatility1Y'):.1f}%.",
            "actions": ["Match any equity allocation to the time horizon, loss capacity and need for near-term cash.", "Review diversification across companies, sectors and asset types; the KLCI represents large-cap shares, not the whole market.", "Verify that intermediaries and products are authorised by the Securities Commission before transferring money."],
            "watch": "Recent performance is not a forecast. Returns shown here exclude dividends, fees and taxes.",
        },
        {
            "id": "property-borrowing", "theme": "Property and borrowing", "stance": "Stress-test",
            "title": "Test affordability before relying on property appreciation",
            "evidence": f"The OPR is {opr:.2f}% and the 10-year MGS yield is {mgs:.2f}%, both relevant reference points for financing conditions.",
            "actions": ["Compare the full ownership cost with renting, including maintenance, assessment, insurance, vacancy and transaction costs.", "Recalculate repayments under a higher-rate scenario and a temporary income interruption.", "Preserve a separate cash reserve after the deposit and purchase costs."],
            "watch": "Property suitability depends on location, financing terms, holding period and personal cash flow—not national inflation alone.",
        },
        {
            "id": "career-budget", "theme": "Career and daily life", "stance": "Strengthen options",
            "title": "Use the stable labour picture to improve resilience",
            "evidence": f"National unemployment is {unemployment:.1f}%; {labour_reading.lower()}, but this does not describe every occupation or region.",
            "actions": ["Track your own essential-cost inflation rather than assuming the headline CPI matches your household basket.", "Use stable employment periods to build portable skills, update professional evidence and explore market salary ranges.", "Direct pay increases or bonuses toward high-cost debt, emergency savings and long-term goals before lifestyle expansion."],
            "watch": "Sector hiring, contract type and individual employability can diverge sharply from the national unemployment rate.",
        },
        {
            "id": "debt-reset", "theme": "Debt and repayments", "stance": "Check buffers",
            "title": "Review variable-rate and short-tenor commitments",
            "evidence": f"The dashboard heatmap labels policy-rate pressure as {next((item['level'] for item in (risk or {}).get('items', []) if item['id'] == 'opr'), 'moderate')} and 10-year MGS pressure as {next((item['level'] for item in (risk or {}).get('items', []) if item['id'] == 'mgs'), 'moderate')}.",
            "actions": ["List every debt repayment date, rate type and reset date.", "Check whether a higher instalment still leaves room for essentials and emergency savings.", "Avoid using short-term promotional rates as the only affordability test."],
            "watch": "Lending rates depend on individual credit profile, bank policy and product terms, not only national benchmark rates.",
        },
        {
            "id": "imported-costs", "theme": "Daily prices and imported goods", "stance": "Compare baskets",
            "title": "Watch imported-cost pressure in your own spending",
            "evidence": f"USD/MYR is RM {fx:.4f}; latest goods imports are RM {(external or {}).get('summary', {}).get('imports', 0):.1f} billion where trade data are available.",
            "actions": ["Track recurring imported or foreign-currency-linked spending separately.", "Compare total cost after shipping, tax, warranties and exchange-rate conversion.", "Keep subscription and discretionary spending flexible when currency pressure is elevated."],
            "watch": "A national exchange-rate move does not affect every household basket equally.",
        },
    ]

    companies = [
        {
            "id": "cash-funding", "theme": "Cash flow and funding", "stance": "Protect liquidity",
            "title": "Review debt sensitivity and idle-cash policy",
            "evidence": f"The OPR is {opr:.2f}% while the 10-year MGS yield is {mgs:.2f}%. {rate_reading}.",
            "actions": ["Run base, higher-rate and revenue-shock cash-flow cases before refinancing or expanding debt.", "Match cash maturities to payroll, tax and supplier obligations rather than maximising yield alone.", "Separate committed facilities from genuinely available liquidity and monitor covenant headroom."],
            "watch": "Actual bank pricing depends on credit risk, collateral, tenor and facility structure.",
        },
        {
            "id": "pricing-margins", "theme": "Pricing and margins", "stance": "Measure precisely",
            "title": "Respond to cost pressure at product level",
            "evidence": f"Headline inflation is {headline:.1f}% and core inflation is {core:.1f}% ({inflation_reading}); category pressures remain uneven.",
            "actions": ["Track input, wage, freight and energy costs separately rather than applying a blanket CPI uplift.", "Review gross margin by product and customer before changing prices or promotions.", "Use smaller, explainable adjustments where demand is price-sensitive."],
            "watch": "CPI measures consumer prices and is not a direct index of any company's input-cost structure.",
        },
        {
            "id": "fx-exposure", "theme": "Ringgit and trade", "stance": "Map exposure",
            "title": "Manage net currency exposure, not exchange-rate headlines",
            "evidence": f"The latest monthly USD/MYR observation is RM {fx:.4f} per US dollar.",
            "actions": ["Map contracted foreign-currency receipts and payments by date, currency and certainty.", "Use natural offsets first and discuss appropriate hedging instruments with regulated banking providers.", "Test quotations and margins under adverse exchange-rate scenarios."],
            "watch": "The dashboard describes USD/MYR movements; it does not forecast a profitable hedge or currency direction.",
        },
        {
            "id": "people-capex", "theme": "Hiring and investment", "stance": "Stage commitments",
            "title": "Link hiring and capital spending to demand evidence",
            "evidence": f"Unemployment is {unemployment:.1f}% and the KLCI's latest one-year price performance is {market_reading} at {market_return:+.1f}%.",
            "actions": ["Prioritise roles tied to bottlenecks, revenue quality or measurable productivity gains.", "Stage capital projects with decision gates instead of treating broad market optimism as demand proof.", "Model downside demand, financing and FX assumptions before approving irreversible expenditure."],
            "watch": "A stock index and national unemployment rate are broad signals, not company-specific revenue forecasts.",
        },
        {
            "id": "inventory-imports", "theme": "Inventory and import exposure", "stance": "Stress landed cost",
            "title": "Tie inventory decisions to FX and trade evidence",
            "evidence": f"Goods imports grew {(external or {}).get('summary', {}).get('importsYoY', 0):+.1f}% year on year, while USD/MYR is RM {fx:.4f}.",
            "actions": ["Separate essential stock buffers from speculative over-ordering.", "Reprice landed cost assumptions using adverse FX and freight scenarios.", "Review supplier currency, payment timing and contract pass-through clauses."],
            "watch": "Trade aggregates do not reveal firm-level demand, supplier reliability or margin quality.",
        },
        {
            "id": "business-risk-gates", "theme": "Scenario governance", "stance": "Use triggers",
            "title": "Set decision gates around the highest-risk signals",
            "evidence": f"The current heatmap is {(risk or {}).get('overallLevel', 'moderate')} pressure, led by {', '.join(item['label'] for item in (risk or {}).get('items', [])[:2]) or 'macro and market indicators'}.",
            "actions": ["Define measurable triggers before hiring, capex, refinancing or price changes.", "Assign owners for inflation, FX, cash-flow and sales indicators.", "Review decisions monthly after official releases instead of reacting to headlines."],
            "watch": "A heatmap is a monitoring tool; it cannot replace customer, supplier and balance-sheet evidence.",
        },
    ]

    return {
        "generatedAt": generated_at,
        "status": "fresh" if market["status"] == "fresh" else "partial",
        "title": "Decision guide for the current Malaysian economy",
        "summary": f"Malaysia currently combines {headline:.1f}% headline inflation, a {opr:.2f}% OPR, {unemployment:.1f}% unemployment and a {market_return:+.1f}% one-year KLCI price return. The useful response is disciplined scenario planning—not a single buy, sell or career instruction.",
        "signals": [
            {"label": "Headline inflation", "value": f"{headline:.1f}%", "period": headline_date, "reading": inflation_reading},
            {"label": "Core inflation", "value": f"{core:.1f}%", "period": core_date, "reading": "underlying price pressure"},
            {"label": "OPR", "value": f"{opr:.2f}%", "period": opr_date, "reading": "policy-rate setting"},
            {"label": "Unemployment", "value": f"{unemployment:.1f}%", "period": unemployment_date, "reading": labour_reading.lower()},
            {"label": "USD/MYR", "value": f"RM {fx:.4f}", "period": fx_date, "reading": "ringgit cost of one US dollar"},
            {"label": "10-year MGS", "value": f"{mgs:.2f}%", "period": mgs_date, "reading": "long-term government benchmark yield"},
            {"label": "KLCI 1-year", "value": f"{market_return:+.1f}%", "period": market_summary["latestDate"], "reading": f"{market_reading} price performance"},
        ],
        "audiences": {"individuals": individuals, "companies": companies},
        "sources": [
            {"name": "PIDM emergency savings calculator", "url": "https://www.pidm.gov.my/finlit/pidm-emergency-savings-calculator"},
            {"name": "Securities Commission investor empowerment", "url": "https://www.sc.com.my/investor-empowerment"},
            {"name": "Bank Negara Malaysia OPR decisions", "url": "https://www.bnm.gov.my/monetary-stability/opr-decisions"},
            {"name": "Malaysia official open data", "url": "https://data.gov.my/"},
        ],
        "disclaimer": "General educational scenarios only. They do not consider income, liabilities, tax, risk tolerance, business contracts or objectives. They are not personalised financial, investment, property, legal, tax or career advice.",
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
    market_data = build_market(previous, retrieved)
    economic_structure = build_economic_structure(previous, retrieved)
    growth_drivers = build_growth_drivers(previous, retrieved, economic_structure)
    external_sector = build_external_sector(previous, retrieved)
    risk_heatmap = build_risk_heatmap(series, market_data, growth_drivers, external_sector, retrieved)
    latest_brief = build_latest_brief(series, forecast_data, market_data, growth_drivers, external_sector, risk_heatmap, retrieved)
    payload = {
        "schemaVersion": 7,
        "generatedAt": retrieved,
        "health": "fresh" if all(source["status"] == "fresh" for source in sources.values()) and market_data["status"] == "fresh" and economic_structure["status"] == "fresh" and external_sector["status"] == "fresh" and growth_drivers["status"] == "fresh" else "partial",
        "sources": sources,
        "series": series,
        "categories": categories,
        "cpiDecomposition": build_cpi_decomposition(categories, series["headline"]["points"]),
        "forecast": forecast_data,
        "structuralBreaks": structural_data,
        "market": market_data,
        "economicStructure": economic_structure,
        "growthDrivers": growth_drivers,
        "externalSector": external_sector,
        "riskHeatmap": risk_heatmap,
        "latestBrief": latest_brief,
        "decisionGuide": build_decision_guide(series, market_data, retrieved, risk_heatmap, external_sector),
        "dataOperations": build_data_operations(series, retrieved),
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
        candidate.get("market", {}).pop("retrievedAt", None)
        baseline.get("market", {}).pop("retrievedAt", None)
        candidate.get("economicStructure", {}).pop("retrievedAt", None)
        baseline.get("economicStructure", {}).pop("retrievedAt", None)
        candidate.get("externalSector", {}).pop("retrievedAt", None)
        baseline.get("externalSector", {}).pop("retrievedAt", None)
        candidate.get("growthDrivers", {}).pop("generatedAt", None)
        baseline.get("growthDrivers", {}).pop("generatedAt", None)
        candidate.get("riskHeatmap", {}).pop("generatedAt", None)
        baseline.get("riskHeatmap", {}).pop("generatedAt", None)
        candidate.get("latestBrief", {}).pop("generatedAt", None)
        baseline.get("latestBrief", {}).pop("generatedAt", None)
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
