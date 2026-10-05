"""Reproducible data and forecast pipeline for MacroLens Malaysia."""

from __future__ import annotations

import argparse
import csv
import copy
import hashlib
import io
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
from pypdf import PdfReader
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
VINTAGE_LEDGER = VINTAGES / "ledger-v1"
BACKTEST_MAX_ORIGINS = 36
CALIBRATION_WARMUP_ORIGINS = 12
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
BOP_BALANCE_URL = "https://storage.dosm.gov.my/bop/bop_balance.csv"
BOP_BALANCE_SOURCE_URL = "https://data.gov.my/data-catalogue/bop_balance"
CPI_WEIGHTS_SOURCE_URL = "https://storage.dosm.gov.my/cpi/cpi_2025-07.pdf"
REGIONAL_JSON = ROOT / "data" / "published" / "regional-lens.json"
REGIONAL_CSV = ROOT / "data" / "published" / "regional-lens.csv"
HIES_STATE_URL = "https://storage.dosm.gov.my/hies/hies_state.csv"
HIES_STATE_SOURCE_URL = "https://data.gov.my/data-catalogue/hies_state"
HIES_EXPENDITURE_REPORT_URL = "https://storage.dosm.gov.my/hies/household_expenditure_{year}.pdf"
HIES_DISTRICT_URL = "https://storage.dosm.gov.my/hies/hies_district.csv"
HIES_DISTRICT_SOURCE_URL = "https://data.gov.my/data-catalogue/hies_district"
HIES_STATE_PERCENTILE_URL = "https://storage.dosm.gov.my/hies/hies_state_percentile.csv"
HIES_NATIONAL_PERCENTILE_URL = "https://storage.dosm.gov.my/hies/hies_malaysia_percentile.csv"
HIES_STATE_PERCENTILE_SOURCE_URL = "https://data.gov.my/data-catalogue/hies_state_percentile"
LFS_DISTRICT_URL = "https://storage.dosm.gov.my/labour/lfs_district.csv"
LFS_DISTRICT_SOURCE_URL = "https://data.gov.my/data-catalogue/lfs_district"
GDP_STATE_REAL_URL = "https://storage.dosm.gov.my/gdp/gdp_state_real_supply.csv"
GDP_STATE_REAL_SOURCE_URL = "https://data.gov.my/data-catalogue/gdp_state_real_supply"
GDP_DISTRICT_REAL_URL = "https://storage.dosm.gov.my/gdp/gdp_district_real_supply.csv"
GDP_DISTRICT_REAL_SOURCE_URL = "https://data.gov.my/data-catalogue/gdp_district_real_supply"
CPI_STATE_SOURCE_URL = "https://data.gov.my/data-catalogue/cpi_state_inflation"
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
        result = parse_economic_structure(read_csv(GDP_STRUCTURE_URL), retrieved)
        result["lastAttemptAt"] = retrieved
        return result
    except Exception as error:
        old = (previous or {}).get("economicStructure")
        if not old or not old.get("years"):
            raise
        return {
            **copy.deepcopy(old),
            "status": "stale",
            "lastAttemptAt": retrieved,
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
        demand["lastAttemptAt"] = retrieved
        status = "fresh" if production.get("status") == "fresh" else "partial"
        message = "Production and expenditure GDP views validated"
    except Exception as error:
        old = (previous or {}).get("growthDrivers")
        if old and old.get("demand", {}).get("years"):
            demand = copy.deepcopy(old["demand"])
            demand["status"] = "stale"
            demand["lastAttemptAt"] = retrieved
            demand["message"] = f"Using last valid GDP demand data: {type(error).__name__}"
            status = "partial"
            message = "Production view refreshed; expenditure view retained from last validation"
        else:
            demand = {
                "status": "unavailable",
                "retrievedAt": None,
                "lastAttemptAt": retrieved,
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


def read_catalogue_json(dataset_id: str, limit: int = 100000) -> pd.DataFrame:
    payload = get(f"https://api.data.gov.my/data-catalogue?id={dataset_id}&limit={limit}").json()
    rows = payload if isinstance(payload, list) else payload.get("data", [])
    return pd.DataFrame(rows)


def _latest_rows(frame: pd.DataFrame, keys: list[str], date_col: str = "date") -> pd.DataFrame:
    frame = frame.copy()
    frame[date_col] = pd.to_datetime(frame[date_col], errors="raise")
    frame = frame.sort_values(date_col)
    return frame.groupby(keys, as_index=False, sort=True).tail(1)


def _safe_float(value) -> float | None:
    if value is None or pd.isna(value):
        return None
    number = float(value)
    return round(number, 4) if math.isfinite(number) else None


def _regional_status(*parts: dict) -> str:
    return "fresh" if all(part.get("status") == "fresh" for part in parts) else "partial"


def parse_national_expenditure_report(page_texts: list[str], year: int, retrieved: str) -> dict:
    """Read the labelled national mean, never an average of state estimates.

    Only the exact-year English state-summary page is accepted. Layout/wording
    changes fail closed rather than silently extracting a state or earlier year.
    """
    matches = []
    heading = rf"MEAN MONTHLY HOUSEHOLD CONSUMPTION EXPENDITURE BY STATE, MALAYSIA, {year}\b"
    for page_number, text in enumerate(page_texts, start=1):
        normalised = re.sub(r"\s+", " ", text).strip()
        if not re.search(heading, normalised, flags=re.IGNORECASE):
            continue
        match = re.search(r"\bMALAYSIA\s+RM\s*([\d,]+)(?:\s|$)", normalised, flags=re.IGNORECASE)
        if not match:
            raise ValueError("National expenditure report has no labelled Malaysia mean")
        value = float(match.group(1).replace(",", ""))
        if not 100 <= value <= 100000:
            raise ValueError("National expenditure report contains an implausible RM mean")
        matches.append((value, page_number))
    if len(matches) != 1:
        raise ValueError("National expenditure report year/summary is missing or ambiguous")
    value, page_number = matches[0]
    return {
        "status": "fresh", "value": value, "unit": "RM per household per month",
        "observationPeriod": f"{year}-01-01", "retrievedAt": retrieved, "lastAttemptAt": retrieved,
        "source": "Department of Statistics Malaysia, Household Expenditure Survey Report",
        "sourceUrl": HIES_EXPENDITURE_REPORT_URL.format(year=year), "page": page_number,
        "message": "Exact survey-year national mean consumption expenditure validated from the official DOSM report",
    }


def fetch_national_expenditure(year: int, retrieved: str, previous: dict | None = None) -> dict:
    try:
        response = get(HIES_EXPENDITURE_REPORT_URL.format(year=year))
        if not response.content.startswith(b"%PDF-"):
            raise ValueError("National expenditure response is not a PDF")
        reader = PdfReader(io.BytesIO(response.content))
        # The national summary appears in the opening report pages. Do not scan
        # arbitrary tables where another geography or year could be mistaken.
        texts = [page.extract_text() or "" for page in reader.pages[:60]]
        return parse_national_expenditure_report(texts, year, retrieved)
    except Exception as error:
        prior_value = _safe_float(previous.get("value")) if previous else None
        if previous and previous.get("observationPeriod") == f"{year}-01-01" and previous.get("sourceUrl") == HIES_EXPENDITURE_REPORT_URL.format(year=year) and prior_value is not None and 100 <= prior_value <= 100000:
            return {**copy.deepcopy(previous), "status": "stale", "lastAttemptAt": retrieved, "message": f"Last verified same-year national expenditure retained: {type(error).__name__}"}
        return {"status": "unavailable", "value": None, "unit": "RM per household per month", "observationPeriod": f"{year}-01-01", "retrievedAt": None, "lastAttemptAt": retrieved, "sourceUrl": HIES_EXPENDITURE_REPORT_URL.format(year=year), "message": f"National expenditure benchmark unavailable: {type(error).__name__}; no state-average substitute used"}


def _national_survey_value(frame: pd.DataFrame, column: str, period: pd.Timestamp) -> float | None:
    if frame.empty:
        return None
    if not {"date", column}.issubset(frame.columns):
        raise ValueError("National survey source structure changed")
    dates = pd.to_datetime(frame["date"], errors="raise")
    matching = frame.loc[dates.eq(period)]
    if len(matching) > 1:
        raise ValueError("National survey source has duplicate survey periods")
    return _safe_float(matching[column].iloc[0]) if len(matching) == 1 else None


def _validate_regional_household_values(selected: pd.DataFrame, label: str) -> None:
    numeric = selected[["income_mean", "income_median", "expenditure_mean", "gini", "poverty"]].to_numpy(dtype=float)
    if selected["date"].isna().any() or not np.isfinite(numeric).all():
        raise ValueError(f"{label} HIES source contains missing or non-finite observations")
    if (selected[["income_mean", "income_median", "expenditure_mean"]] <= 0).any().any():
        raise ValueError(f"{label} HIES source contains implausible monetary values")
    if not selected["gini"].between(0, 1).all() or not selected["poverty"].between(0, 100).all():
        raise ValueError(f"{label} HIES source contains impossible inequality or poverty values")
    for key in ["state", *(["district"] if "district" in selected.columns else [])]:
        if not selected[key].map(lambda value: isinstance(value, str) and bool(value.strip())).all():
            raise ValueError(f"{label} HIES source contains invalid geography names")


def parse_hies_state(frame: pd.DataFrame, retrieved: str, national_expenditure: dict | None = None, national_sources: dict | None = None) -> dict:
    required = {"date", "state", "income_mean", "income_median", "expenditure_mean", "gini", "poverty"}
    if not required.issubset(frame.columns):
        raise ValueError("State HIES source structure changed")
    selected = frame[list(required)].copy()
    selected["date"] = pd.to_datetime(selected["date"], errors="raise")
    for column in ["income_mean", "income_median", "expenditure_mean", "gini", "poverty"]:
        selected[column] = pd.to_numeric(selected[column], errors="raise")
    if selected.empty or selected.duplicated(["date", "state"]).any():
        raise ValueError("State HIES source is empty or duplicated")
    _validate_regional_household_values(selected, "State")
    latest_date = selected["date"].max()
    latest = selected[selected["date"].eq(latest_date)].copy()
    if latest["state"].nunique() < 16:
        raise ValueError("State HIES source has incomplete latest geography coverage")
    # Legacy callers may still supply only the survey. The refresh orchestrator
    # supplies independently validated benchmark artifacts, so a national API
    # failure never discards a successfully refreshed state survey.
    if national_sources is None:
        income_national = read_catalogue_json("hh_income")
        poverty_national = read_catalogue_json("hh_poverty")
        gini_national = read_catalogue_json("hh_inequality")
    national_expenditure = national_expenditure or fetch_national_expenditure(latest_date.year, retrieved)
    if national_expenditure.get("observationPeriod") != latest_date.strftime("%Y-%m-%d"):
        national_expenditure = {**national_expenditure, "status": "unavailable", "value": None, "message": "National expenditure survey period does not match the state survey period"}
    national = _regional_national_values(national_sources, latest_date.strftime("%Y-%m-%d"), national_expenditure) if national_sources is not None else {
        "incomeMean": _national_survey_value(income_national, "income_mean", latest_date),
        "incomeMedian": _national_survey_value(income_national, "income_median", latest_date),
        "poverty": _national_survey_value(poverty_national, "poverty_absolute", latest_date),
        "gini": _national_survey_value(gini_national, "gini", latest_date),
        "expenditureMean": _safe_float(national_expenditure.get("value")),
    }
    records = []
    for row in latest.sort_values("state").itertuples(index=False):
        income = float(row.income_median)
        spending = float(row.expenditure_mean)
        records.append({
            "state": str(row.state),
            "date": row.date.strftime("%Y-%m-%d"),
            "incomeMean": round(float(row.income_mean), 2),
            "incomeMedian": round(income, 2),
            "expenditureMean": round(spending, 2),
            "incomeMinusExpenditure": round(income - spending, 2),
            "incomeToExpenditureRatio": round(income / spending, 3) if spending else None,
            "poverty": round(float(row.poverty), 2),
            "gini": round(float(row.gini), 3),
        })
    highest_income = max(records, key=lambda item: item["incomeMedian"])
    highest_spend = max(records, key=lambda item: item["expenditureMean"])
    return {
        "status": "fresh" if national_sources is not None else _regional_status(national_expenditure),
        "retrievedAt": retrieved,
        "observationPeriod": latest_date.strftime("%Y-%m-%d"),
        "source": "Department of Statistics Malaysia via data.gov.my",
        "sourceUrl": HIES_STATE_SOURCE_URL,
        "datasetUrl": HIES_STATE_URL,
        "frequency": "Survey years",
        "records": records,
        "national": national,
        "nationalExpenditure": national_expenditure,
        "narrative": (
            f"Latest HIES ranks {highest_income['state']} highest for median income and {highest_spend['state']} highest for mean expenditure."
        ),
        "message": "Latest state HIES income, expenditure, poverty and inequality data validated",
    }


def parse_hies_district(frame: pd.DataFrame, retrieved: str) -> dict:
    required = {"date", "state", "district", "income_mean", "income_median", "expenditure_mean", "gini", "poverty"}
    if not required.issubset(frame.columns):
        raise ValueError("District HIES source structure changed")
    selected = frame[list(required)].copy()
    selected["date"] = pd.to_datetime(selected["date"], errors="raise")
    for column in ["income_mean", "income_median", "expenditure_mean", "gini", "poverty"]:
        selected[column] = pd.to_numeric(selected[column], errors="raise")
    if selected.empty or selected.duplicated(["date", "state", "district"]).any():
        raise ValueError("District HIES source is empty or duplicated")
    _validate_regional_household_values(selected, "District")
    latest = selected[selected["date"].eq(selected["date"].max())]
    if len(latest) < 100:
        raise ValueError("District HIES source has insufficient latest coverage")
    records = []
    for row in latest.sort_values(["state", "district"]).itertuples(index=False):
        spending = float(row.expenditure_mean)
        income = float(row.income_median)
        records.append({
            "state": str(row.state),
            "district": str(row.district),
            "date": row.date.strftime("%Y-%m-%d"),
            "incomeMean": round(float(row.income_mean), 2),
            "incomeMedian": round(income, 2),
            "expenditureMean": round(spending, 2),
            "incomeMinusExpenditure": round(income - spending, 2),
            "incomeToExpenditureRatio": round(income / spending, 3) if spending else None,
            "poverty": round(float(row.poverty), 2),
            "gini": round(float(row.gini), 3),
        })
    return {"status": "fresh", "retrievedAt": retrieved, "observationPeriod": latest["date"].max().strftime("%Y-%m-%d"), "sourceUrl": HIES_DISTRICT_SOURCE_URL, "datasetUrl": HIES_DISTRICT_URL, "records": records, "message": "Latest district HIES data validated"}


def _income_group_from_percentiles(frame: pd.DataFrame, group_id: str, label: str, start: int, end: int) -> dict:
    group = frame[frame["percentile"].between(start, end)]
    means = group[group["variable"].eq("mean")]["income"].dropna()
    medians = group[group["variable"].eq("median")]["income"].dropna()
    minimums = group[group["variable"].eq("minimum")]["income"].dropna()
    maximums = group[group["variable"].eq("maximum")]["income"].dropna()
    if means.empty:
        raise ValueError(f"Income percentile source missing {label} mean values")
    return {
        "id": group_id,
        "label": label,
        "percentileRange": f"{start}-{end}",
        "meanIncome": round(float(means.mean()), 2),
        "medianIncome": round(float(medians.median()), 2) if not medians.empty else None,
        "minIncome": round(float(minimums.min()), 2) if not minimums.empty else None,
        "maxIncome": round(float(maximums.max()), 2) if not maximums.empty else None,
    }


def parse_hies_income_groups(state_frame: pd.DataFrame, national_frame: pd.DataFrame, retrieved: str) -> dict:
    state_required = {"date", "state", "percentile", "variable", "income"}
    national_required = {"date", "percentile", "variable", "income"}
    if not state_required.issubset(state_frame.columns) or not national_required.issubset(national_frame.columns):
        raise ValueError("Income percentile source structure changed")
    state = state_frame[list(state_required)].copy()
    national = national_frame[list(national_required)].copy()
    state["date"] = pd.to_datetime(state["date"], errors="raise")
    national["date"] = pd.to_datetime(national["date"], errors="raise")
    for frame in (state, national):
        frame["percentile"] = pd.to_numeric(frame["percentile"], errors="raise")
        frame["income"] = pd.to_numeric(frame["income"], errors="coerce")
    if state.empty or national.empty:
        raise ValueError("Income percentile source is empty")
    if state.duplicated(["date", "state", "percentile", "variable"]).any() or national.duplicated(["date", "percentile", "variable"]).any():
        raise ValueError("Income percentile source contains duplicate rows")
    latest_date = min(state["date"].max(), national["date"].max())
    latest_state = state[state["date"].eq(latest_date)].copy()
    latest_national = national[national["date"].eq(latest_date)].copy()
    if latest_state["state"].nunique() < 16 or latest_state["percentile"].nunique() < 100 or latest_national["percentile"].nunique() < 100:
        raise ValueError("Income percentile source has incomplete latest coverage")
    groups = [("b40", "B40", 1, 40), ("m40", "M40", 41, 80), ("t20", "T20", 81, 100)]
    national_groups = [_income_group_from_percentiles(latest_national, group_id, label, start, end) for group_id, label, start, end in groups]
    national_by_id = {item["id"]: item for item in national_groups}
    state_groups = []
    for state_name, state_part in latest_state.groupby("state"):
        grouped = []
        for group_id, label, start, end in groups:
            item = _income_group_from_percentiles(state_part, group_id, label, start, end)
            benchmark = national_by_id[group_id]["meanIncome"]
            item["vsNationalMean"] = round(item["meanIncome"] - benchmark, 2)
            grouped.append(item)
        state_groups.append({"state": str(state_name), "date": latest_date.strftime("%Y-%m-%d"), "groups": grouped})
    return {
        "status": "fresh",
        "retrievedAt": retrieved,
        "observationPeriod": latest_date.strftime("%Y-%m-%d"),
        "source": "Department of Statistics Malaysia via data.gov.my",
        "sourceUrl": HIES_STATE_PERCENTILE_SOURCE_URL,
        "stateDatasetUrl": HIES_STATE_PERCENTILE_URL,
        "nationalDatasetUrl": HIES_NATIONAL_PERCENTILE_URL,
        "frequency": "Survey years",
        "nationalGroups": national_groups,
        "stateGroups": sorted(state_groups, key=lambda item: item["state"]),
        "note": "B40, M40 and T20 are calculated from official percentile mean incomes: bottom 40 percentiles, middle 40 percentiles and top 20 percentiles. They describe household income distribution, not individual wages.",
        "message": "Latest state and national income-percentile data validated",
    }


def parse_regional_labour(frame: pd.DataFrame, retrieved: str) -> dict:
    required = {"state", "district", "date", "lf", "lf_employed", "lf_unemployed", "p_rate", "u_rate", "ep_ratio"}
    if not required.issubset(frame.columns):
        raise ValueError("District labour-force source structure changed")
    selected = frame[list(required)].copy()
    selected["date"] = pd.to_datetime(selected["date"], errors="raise")
    for column in ["lf", "lf_employed", "lf_unemployed", "p_rate", "u_rate", "ep_ratio"]:
        selected[column] = pd.to_numeric(selected[column], errors="raise")
    if selected.empty or selected.duplicated(["date", "state", "district"]).any():
        raise ValueError("District labour-force source is empty or duplicated")
    if selected["date"].isna().any():
        raise ValueError("District labour-force source has missing observation periods")
    for column in ["lf", "lf_employed", "lf_unemployed", "p_rate", "u_rate", "ep_ratio"]:
        values = selected[column].dropna().to_numpy(dtype=float)
        if not np.isfinite(values).all() or (values < 0).any() or (column in {"p_rate", "u_rate", "ep_ratio"} and (values > 100).any()):
            raise ValueError("District labour-force source contains impossible observations")
    latest = selected[selected["date"].eq(selected["date"].max())].dropna(subset=["lf", "lf_unemployed", "u_rate"])
    if latest.empty:
        raise ValueError("District labour-force source has no usable latest observations")
    district_records = [
        {"state": str(row.state), "district": str(row.district), "date": row.date.strftime("%Y-%m-%d"), "labourForce": round(float(row.lf), 2), "unemploymentRate": round(float(row.u_rate), 2), "participationRate": _safe_float(row.p_rate), "employmentPopulationRatio": _safe_float(row.ep_ratio)}
        for row in latest.sort_values(["state", "district"]).itertuples(index=False)
    ]
    state_records = []
    for state, state_frame in latest.groupby("state", sort=True):
        lf = float(state_frame["lf"].sum())
        unemployed = float(state_frame["lf_unemployed"].sum())
        employed = float(state_frame["lf_employed"].sum())
        state_records.append({
            "state": str(state),
            "date": latest["date"].max().strftime("%Y-%m-%d"),
            "labourForce": round(lf, 2),
            "unemploymentRate": round(unemployed / lf * 100, 2) if lf else None,
            "employmentPopulationRatio": round(employed / (lf + float(state_frame["lf_outside"].sum())) * 100, 2) if "lf_outside" in state_frame else None,
        })
    return {"status": "fresh", "retrievedAt": retrieved, "observationPeriod": latest["date"].max().strftime("%Y-%m-%d"), "sourceUrl": LFS_DISTRICT_SOURCE_URL, "datasetUrl": LFS_DISTRICT_URL, "stateRecords": state_records, "districtRecords": district_records, "message": "District labour-force data validated and aggregated to state level"}


REGIONAL_STATE_NAMES = ["Johor", "Kedah", "Kelantan", "Melaka", "Negeri Sembilan", "Pahang", "Perak", "Perlis", "Pulau Pinang", "Sabah", "Sarawak", "Selangor", "Terengganu", "W.P. Kuala Lumpur", "W.P. Labuan", "W.P. Putrajaya"]
REGIONAL_DISTRICT_ALIASES = {
    "Sarawak": {"lubok antu": "Lubok Antu", "tanjong manis": "Tanjung Manis", "tanjung manis": "Tanjung Manis"},
    "Pulau Pinang": {"s.p. selatan": "Seberang Perai Selatan", "s.p.selatan": "Seberang Perai Selatan", "seberang perai selatan": "Seberang Perai Selatan",
                     "s.p. tengah": "Seberang Perai Tengah", "s.p.tengah": "Seberang Perai Tengah", "seberang perai tengah": "Seberang Perai Tengah",
                     "s.p. utara": "Seberang Perai Utara", "s.p.utara": "Seberang Perai Utara", "seberang perai utara": "Seberang Perai Utara"},
    "Perak": {"larut & matang": "Larut dan Matang", "larut dan matang": "Larut dan Matang"},
    "Terengganu": {"hulu": "Hulu Terengganu", "hulu terengganu": "Hulu Terengganu"},
}


def normalize_regional_geography(state: str, district: str) -> dict:
    """The same conservative, explicit state-scoped aliases as regional-geography.ts."""
    supplied_state = re.sub(r"\s+", " ", state.strip())
    state_case = {name.lower(): name for name in REGIONAL_STATE_NAMES}
    canonical_state = state_case.get(supplied_state.lower(), supplied_state)
    supplied_district = re.sub(r"\s+", " ", district.strip())
    canonical_district = REGIONAL_DISTRICT_ALIASES.get(canonical_state, {}).get(supplied_district.lower(), supplied_district)
    residual = (canonical_state in {"Sabah", "Sarawak"} and supplied_district.lower() == "supra") or canonical_state.lower() in {"supra", "supranational"}
    return {"key": f"{canonical_state}|{canonical_district}", "state": canonical_state, "district": canonical_district, "kind": "residual" if residual else "district"}


def parse_regional_gdp_source(frame: pd.DataFrame, retrieved: str | None, *, district: bool = False) -> dict:
    """Validate one GDP publication independently, including its own period."""
    keys = ["state", "district"] if district else ["state"]
    required = {"series", "date", "sector", "value", *keys}
    if not required.issubset(frame.columns):
        raise ValueError("Regional GDP source structure changed")
    def prepare(frame: pd.DataFrame, keys: list[str]) -> list[dict]:
        selected = frame[frame["series"].eq("abs")].copy()
        if selected.empty or not selected["sector"].isin({"p0", *GDP_SECTORS}).all():
            raise ValueError("Regional GDP source is empty or contains unexpected sector codes")
        selected["date"] = pd.to_datetime(selected["date"], errors="raise")
        if selected["date"].isna().any() or not ((selected["date"].dt.month == 1) & (selected["date"].dt.day == 1)).all():
            raise ValueError("Regional GDP source has invalid annual observation periods")
        if any(not selected[key].map(lambda value: isinstance(value, str) and bool(value.strip())).all() for key in keys):
            raise ValueError("Regional GDP source has invalid geography names")
        if selected["value"].map(lambda value: isinstance(value, (bool, np.bool_))).any():
            raise ValueError("Regional GDP source contains malformed numeric values")
        try:
            selected["value"] = pd.to_numeric(selected["value"], errors="raise")
        except (ValueError, TypeError) as error:
            raise ValueError("Regional GDP source contains malformed numeric values") from error
        numeric = selected["value"].dropna().to_numpy(dtype=float)
        if not np.isfinite(numeric).all() or (numeric < 0).any():
            raise ValueError("Regional GDP source contains non-finite or negative levels")
        selected["_geography"] = [normalize_regional_geography(str(row.state), str(getattr(row, "district", "")))["key"] for row in selected.itertuples(index=False)]
        if selected.duplicated(["date", "_geography", "sector"]).any():
            raise ValueError("Regional GDP source contains duplicate geography/period/sector rows")
        latest = selected[selected["date"].eq(selected["date"].max())]
        rows = []
        for group_keys, group in latest.groupby(keys, sort=True):
            group_key_values = (group_keys,) if isinstance(group_keys, str) else group_keys
            levels = group.set_index("sector")["value"]
            if "p0" not in levels or pd.isna(levels["p0"]):
                continue
            total = float(levels["p0"])
            sectors = []
            for code, name in GDP_SECTORS.items():
                published = code in levels
                observed = published and pd.notna(levels[code])
                value = float(levels[code]) if observed else None
                sectors.append({"id": code, "name": name, "value": round(value / 1000, 3) if value is not None else None,
                                "share": round(value / total * 100, 2) if value is not None and total > 0 else None,
                                "valueStatus": "observed" if observed else "suppressed-or-unavailable" if published else "not-published"})
            # Rank actual supplied levels, not rounded display percentages.
            sectors.sort(key=lambda item: float(levels[item["id"]]) if item["valueStatus"] == "observed" else -1, reverse=True)
            ranked = [item for item in sectors if item["value"] is not None]
            row = {key: str(value) for key, value in zip(keys, group_key_values)}
            row.update({"date": group["date"].max().strftime("%Y-%m-%d"), "total": round(total / 1000, 3),
                        "largestSector": ranked[0]["name"] if ranked else None, "largestSectorShare": ranked[0]["share"] if ranked else None,
                        "sectors": sectors, "largestSectorBasis": "Largest among published numeric sector values; missing/suppressed sectors are not ranked"})
            rows.append(row)
        return rows
    rows = prepare(frame, keys)
    administrative = [row for row in rows if normalize_regional_geography(row["state"], row.get("district", ""))["kind"] != "residual"]
    residuals = [row for row in rows if normalize_regional_geography(row["state"], row.get("district", ""))["kind"] == "residual"]
    if len(administrative) < (100 if district else 15):
        raise ValueError("Regional GDP source has insufficient latest coverage")
    return {"status": "fresh", "retrievedAt": retrieved, "observationPeriod": max(row["date"] for row in administrative),
            "sourceUrl": GDP_DISTRICT_REAL_SOURCE_URL if district else GDP_STATE_REAL_SOURCE_URL,
            "datasetUrl": GDP_DISTRICT_REAL_URL if district else GDP_STATE_REAL_URL,
            "records": rows if district else administrative, "residualRecords": residuals,
            "administrativeDistrictCount": len(administrative) if district else None,
            "sectorNullPolicy": "Official null values remain unavailable, not zero; absent sector codes remain not published. Genuine numeric zeros are retained. Shares use the official p0 total, not a sum of available sectors.",
            "residualPolicy": "Supra/Supranational records describe unattributed GDP, not administrative geographies; retained as residuals and excluded from district comparison coverage.",
            "message": "Latest annual real GDP levels validated without converting unavailable sectors to zero"}


def _regional_source_metadata(source: dict) -> dict:
    """Metadata aliases do not duplicate full history/record arrays in JSON."""
    return {key: copy.deepcopy(value) for key, value in source.items() if key not in {"records", "residualRecords", "stateRecords", "districtRecords", "stateResidualRecords", "stateGroups", "nationalGroups"}}


def _combine_regional_gdp(state: dict, district: dict) -> dict:
    return {**_regional_source_metadata(state), "status": _regional_status(state, district),
            "districtSourceUrl": district.get("sourceUrl", GDP_DISTRICT_REAL_SOURCE_URL),
            "districtDatasetUrl": district.get("datasetUrl", GDP_DISTRICT_REAL_URL),
            "stateRecords": state.get("records", []), "stateResidualRecords": state.get("residualRecords", []),
            "districtRecords": district.get("records", []), "administrativeDistrictCount": district.get("administrativeDistrictCount", 0),
            "stateSource": _regional_source_metadata(state), "districtSource": _regional_source_metadata(district),
            "message": "State and district GDP sources are independently validated; consult each source's status, period and retrieval time"}


def parse_regional_gdp(state_frame: pd.DataFrame, district_frame: pd.DataFrame, retrieved: str | None) -> dict:
    """Compatibility parser for callers with both saved official inputs."""
    return _combine_regional_gdp(parse_regional_gdp_source(state_frame, retrieved),
                                 parse_regional_gdp_source(district_frame, retrieved, district=True))


def parse_state_cpi(frame: pd.DataFrame, retrieved: str) -> dict:
    required = {"date", "state", "division", "inflation_yoy"}
    if not required.issubset(frame.columns):
        raise ValueError("State CPI source structure changed")
    selected = frame[list(required)].copy()
    selected["date"] = pd.to_datetime(selected["date"], errors="raise")
    selected["inflation_yoy"] = pd.to_numeric(selected["inflation_yoy"], errors="raise")
    if selected.empty or selected["date"].isna().any() or selected.duplicated(["date", "state", "division"]).any():
        raise ValueError("State CPI source has missing or duplicate observations")
    values = selected["inflation_yoy"].dropna().to_numpy(dtype=float)
    if not np.isfinite(values).all() or (values < -20).any() or (values > 50).any():
        raise ValueError("State CPI source contains implausible inflation observations")
    selected = selected[selected["division"].eq("overall")].dropna(subset=["inflation_yoy"])
    latest = selected[selected["date"].eq(selected["date"].max())]
    if latest["state"].nunique() < 16:
        raise ValueError("State CPI source has incomplete latest coverage")
    records = [{"state": str(row.state), "date": row.date.strftime("%Y-%m-%d"), "headlineInflation": round(float(row.inflation_yoy), 2)} for row in latest.sort_values("state").itertuples(index=False)]
    return {"status": "fresh", "retrievedAt": retrieved, "observationPeriod": latest["date"].max().strftime("%Y-%m-%d"), "source": "Department of Statistics Malaysia via data.gov.my", "sourceUrl": CPI_STATE_SOURCE_URL, "records": records, "message": "Latest state headline CPI inflation validated"}


def _regional_has_data(source: dict | None) -> bool:
    return bool(source and (any(source.get(key) for key in ["records", "stateRecords", "districtRecords", "stateGroups", "nationalGroups"])
                           or _safe_float(source.get("value")) is not None))


def _refresh_regional_source(previous: dict | None, retrieved: str, loader: Callable[[], dict], empty: dict) -> dict:
    """Fail closed locally; never overwrite this source with an invalid response."""
    try:
        source = loader()
        if not isinstance(source, dict) or source.get("status") not in {"fresh", "stale", "unavailable"}:
            raise ValueError("Regional source returned malformed status metadata")
        if source.get("status") == "fresh" and not _regional_has_data(source):
            raise ValueError("Regional source returned no validated observations")
        if source.get("status") == "unavailable":
            source = {**source, "retrievedAt": None, "observationPeriod": None}
        return {**source, "lastAttemptAt": retrieved}
    except Exception as error:
        reason = f"{type(error).__name__}: source retrieval or validation failed"
        if _regional_has_data(previous) and previous.get("status") in {"fresh", "stale", "partial"}:
            return {**copy.deepcopy(previous), "status": "stale", "lastAttemptAt": retrieved,
                    "failureReason": reason, "message": f"Last valid observations retained; {reason}"}
        return {**copy.deepcopy(empty), "status": "unavailable", "retrievedAt": None, "observationPeriod": None,
                "lastAttemptAt": retrieved, "failureReason": reason, "message": f"Unavailable; {reason}; no substitute observations used"}


def parse_regional_national_benchmark(frame: pd.DataFrame, retrieved: str, dataset_id: str, fields: dict[str, str]) -> dict:
    required = {"date", *fields}
    if frame.empty or not required.issubset(frame.columns):
        raise ValueError("National household benchmark source structure changed or is empty")
    selected = frame[list(required)].copy()
    selected["date"] = pd.to_datetime(selected["date"], errors="raise")
    if selected["date"].isna().any() or selected.duplicated("date").any():
        raise ValueError("National household benchmark periods are missing or duplicated")
    for original, field in fields.items():
        selected[original] = pd.to_numeric(selected[original], errors="raise")
        values = selected[original].to_numpy(dtype=float)
        limit = 1 if field == "gini" else 100 if field == "poverty" else 1_000_000
        if not np.isfinite(values).all() or (values < 0).any() or (values > limit).any():
            raise ValueError("National household benchmark contains impossible values")
    records = [{"date": row["date"].strftime("%Y-%m-%d"), **{field: _safe_float(row[original]) for original, field in fields.items()}}
               for _, row in selected.sort_values("date").iterrows()]
    return {"status": "fresh", "retrievedAt": retrieved, "observationPeriod": records[-1]["date"],
            "sourceUrl": f"https://data.gov.my/data-catalogue/{dataset_id}", "records": records,
            "message": "Official national household benchmark validated; comparisons require the same survey period"}


def _regional_national_values(sources: dict, period: str | None, expenditure: dict) -> dict:
    fields = {"incomeMean": "nationalIncome", "incomeMedian": "nationalIncome", "poverty": "nationalPoverty", "gini": "nationalInequality"}
    result = {}
    for field, key in fields.items():
        matching = [row for row in sources.get(key, {}).get("records", []) if row.get("date") == period]
        result[field] = _safe_float(matching[0].get(field)) if len(matching) == 1 else None
    result["expenditureMean"] = _safe_float(expenditure.get("value")) if period and expenditure.get("observationPeriod") == period else None
    return result


def parse_regional_percentile_source(frame: pd.DataFrame, retrieved: str, *, state: bool) -> dict:
    required = {"date", "percentile", "variable", "income", *(["state"] if state else [])}
    if frame.empty or not required.issubset(frame.columns):
        raise ValueError("Income percentile source structure changed or is empty")
    selected = frame[list(required)].copy()
    selected["date"] = pd.to_datetime(selected["date"], errors="raise")
    selected["percentile"] = pd.to_numeric(selected["percentile"], errors="raise")
    selected["income"] = pd.to_numeric(selected["income"], errors="raise")
    keys = ["date", *(["state"] if state else []), "percentile", "variable"]
    if selected["date"].isna().any() or selected.duplicated(keys).any():
        raise ValueError("Income percentile source contains invalid or duplicate rows")
    if not selected["percentile"].between(1, 100).all() or not selected["percentile"].mod(1).eq(0).all():
        raise ValueError("Income percentile source has invalid percentile codes")
    numeric = selected["income"].dropna().to_numpy(dtype=float)
    if not np.isfinite(numeric).all() or (numeric < 0).any() or not selected["variable"].isin({"mean", "median", "minimum", "maximum"}).all():
        raise ValueError("Income percentile source has invalid income values or variables")
    latest = selected[selected["date"].eq(selected["date"].max())]
    period = latest["date"].max().strftime("%Y-%m-%d")
    groups = [("b40", "B40", 1, 40), ("m40", "M40", 41, 80), ("t20", "T20", 81, 100)]
    def aggregate(part):
        means = part[part["variable"].eq("mean")]
        if set(means.dropna(subset=["income"])["percentile"]) != set(range(1, 101)):
            raise ValueError("Income percentile source has incomplete mean-income coverage")
        return [_income_group_from_percentiles(part, group_id, label, start, end) for group_id, label, start, end in groups]
    if state:
        if latest["state"].nunique() < 16:
            raise ValueError("State income percentile source has incomplete latest geography coverage")
        records = {"stateGroups": [{"state": str(name), "date": period, "groups": aggregate(part)} for name, part in latest.groupby("state", sort=True)]}
    else:
        records = {"nationalGroups": aggregate(latest)}
    return {"status": "fresh", "retrievedAt": retrieved, "observationPeriod": period,
            "sourceUrl": HIES_STATE_PERCENTILE_SOURCE_URL if state else "https://data.gov.my/data-catalogue/hies_malaysia_percentile",
            "datasetUrl": HIES_STATE_PERCENTILE_URL if state else HIES_NATIONAL_PERCENTILE_URL,
            **records, "message": "Official income percentiles validated independently"}


def _combine_regional_income_groups(state: dict, national: dict, retrieved: str) -> dict:
    if state.get("status") != "fresh" or national.get("status") != "fresh":
        raise ValueError("Both current percentile sources are required for a refreshed income-group comparison")
    if state.get("observationPeriod") != national.get("observationPeriod"):
        raise ValueError("State and national percentile survey periods do not match")
    national_by_id = {item["id"]: item["meanIncome"] for item in national["nationalGroups"]}
    states = copy.deepcopy(state["stateGroups"])
    for item in states:
        for group in item["groups"]:
            group["vsNationalMean"] = round(group["meanIncome"] - national_by_id[group["id"]], 2)
    return {"status": "fresh", "retrievedAt": retrieved, "observationPeriod": state["observationPeriod"],
            "source": "Department of Statistics Malaysia via data.gov.my", "sourceUrl": HIES_STATE_PERCENTILE_SOURCE_URL,
            "stateDatasetUrl": HIES_STATE_PERCENTILE_URL, "nationalDatasetUrl": HIES_NATIONAL_PERCENTILE_URL, "frequency": "Survey years",
            "stateGroups": states, "nationalGroups": copy.deepcopy(national["nationalGroups"]),
            "note": "B40, M40 and T20 are calculated from official percentile mean incomes: bottom 40 percentiles, middle 40 percentiles and top 20 percentiles. They describe household income distribution, not individual wages.",
            "message": "State and national income groups refreshed from independently validated, same-period percentile data"}


def build_regional_lens(previous: dict | None, retrieved: str) -> dict:
    old = (previous or {}).get("regionalLens", {})
    old_sources = old.get("sources", {})
    sources = {}
    benchmark_specs = {
        "nationalIncome": ("hh_income", {"income_mean": "incomeMean", "income_median": "incomeMedian"}),
        "nationalPoverty": ("hh_poverty", {"poverty_absolute": "poverty"}),
        "nationalInequality": ("hh_inequality", {"gini": "gini"}),
    }
    for key, (dataset_id, fields) in benchmark_specs.items():
        prior_benchmark = old_sources.get(key)
        legacy_survey = old_sources.get("hiesState", {})
        legacy_values = legacy_survey.get("national", {})
        if prior_benchmark is None and legacy_survey.get("observationPeriod") and all(_safe_float(legacy_values.get(field)) is not None for field in fields.values()):
            # Version-9 releases originally embedded national benchmarks in
            # state HIES. Preserve that validated same-period result on upgrade
            # without claiming a separately measured retrieval clock.
            prior_benchmark = {"status": legacy_survey.get("status", "stale"),
                               "retrievedAt": legacy_survey.get("retrievedAt"),
                               "observationPeriod": legacy_survey["observationPeriod"],
                               "sourceUrl": f"https://data.gov.my/data-catalogue/{dataset_id}",
                               "records": [{"date": legacy_survey["observationPeriod"], **{field: legacy_values[field] for field in fields.values()}}],
                               "retrievalClockBasis": "Shared regional HIES refresh timestamp in the previous payload; not a separately logged benchmark retrieval"}
        sources[key] = _refresh_regional_source(prior_benchmark, retrieved,
            lambda dataset_id=dataset_id, fields=fields: parse_regional_national_benchmark(read_catalogue_json(dataset_id), retrieved, dataset_id, fields),
            {"records": [], "sourceUrl": f"https://data.gov.my/data-catalogue/{dataset_id}"})

    # The report is separate from state HIES. A missing national benchmark must
    # not stop validated state household records from refreshing.
    no_expenditure = {"status": "unavailable", "value": None, "observationPeriod": None}
    hies_state = _refresh_regional_source(old_sources.get("hiesState"), retrieved,
        lambda: parse_hies_state(read_csv(HIES_STATE_URL), retrieved, no_expenditure, sources),
        {"records": [], "national": {}, "sourceUrl": HIES_STATE_SOURCE_URL, "datasetUrl": HIES_STATE_URL})
    sources["hiesState"] = hies_state
    old_expenditure = old_sources.get("nationalExpenditure") or old_sources.get("hiesState", {}).get("nationalExpenditure")
    def expenditure_loader():
        period = hies_state.get("observationPeriod")
        if not period:
            raise ValueError("No validated state survey period is available for the national expenditure report")
        result = fetch_national_expenditure(int(period[:4]), retrieved, old_expenditure)
        if result.get("status") == "fresh" and (result.get("observationPeriod") != period or _safe_float(result.get("value")) is None):
            raise ValueError("National expenditure report period or validated value is missing")
        return result
    expenditure = _refresh_regional_source(old_expenditure, retrieved, expenditure_loader,
        {"value": None, "unit": "RM per household per month", "sourceUrl": "https://www.dosm.gov.my/portal-main/release-content/household-expenditure-survey-report"})
    sources["nationalExpenditure"] = expenditure
    national = _regional_national_values(sources, hies_state.get("observationPeriod"), expenditure)
    hies_state["national"] = national
    hies_state["nationalExpenditure"] = expenditure
    hies_district = _refresh_regional_source(old_sources.get("hiesDistrict"), retrieved,
        lambda: parse_hies_district(read_csv(HIES_DISTRICT_URL), retrieved),
        {"records": [], "sourceUrl": HIES_DISTRICT_SOURCE_URL, "datasetUrl": HIES_DISTRICT_URL})
    sources["hiesDistrict"] = hies_district

    prior_groups = old_sources.get("incomeGroups") or old.get("incomeGroups")
    for state, key in [(True, "incomeGroupState"), (False, "incomeGroupNational")]:
        prior_part = old_sources.get(key)
        if prior_part is None and prior_groups:
            array_key = "stateGroups" if state else "nationalGroups"
            prior_part = {**_regional_source_metadata(prior_groups), array_key: copy.deepcopy(prior_groups.get(array_key, []))}
        url = HIES_STATE_PERCENTILE_URL if state else HIES_NATIONAL_PERCENTILE_URL
        sources[key] = _refresh_regional_source(prior_part, retrieved,
            lambda state=state, url=url: parse_regional_percentile_source(read_csv(url), retrieved, state=state),
            {"stateGroups" if state else "nationalGroups": [], "datasetUrl": url,
             "sourceUrl": HIES_STATE_PERCENTILE_SOURCE_URL if state else "https://data.gov.my/data-catalogue/hies_malaysia_percentile"})
    income_groups = _refresh_regional_source(prior_groups, retrieved,
        lambda: _combine_regional_income_groups(sources["incomeGroupState"], sources["incomeGroupNational"], retrieved),
        {"stateGroups": [], "nationalGroups": [], "stateDatasetUrl": HIES_STATE_PERCENTILE_URL,
         "nationalDatasetUrl": HIES_NATIONAL_PERCENTILE_URL, "sourceUrl": HIES_STATE_PERCENTILE_SOURCE_URL,
         "note": "Income groups are unavailable until validated state and national percentile inputs have matching survey periods"})
    sources["incomeGroups"] = income_groups

    labour = _refresh_regional_source(old_sources.get("labour"), retrieved,
        lambda: parse_regional_labour(read_csv(LFS_DISTRICT_URL), retrieved),
        {"stateRecords": [], "districtRecords": [], "sourceUrl": LFS_DISTRICT_SOURCE_URL, "datasetUrl": LFS_DISTRICT_URL})
    sources["labour"] = labour
    old_gdp = old_sources.get("gdp", {})
    gdp_parts = {}
    for district, key in [(False, "gdpState"), (True, "gdpDistrict")]:
        records_key = "districtRecords" if district else "stateRecords"
        prior_part = {**copy.deepcopy(old_sources.get(key) or old_gdp.get("districtSource" if district else "stateSource") or _regional_source_metadata(old_gdp)),
                      "records": copy.deepcopy(old_gdp.get(records_key, [])),
                      "residualRecords": copy.deepcopy(old_gdp.get("stateResidualRecords", [])) if not district else []}
        if prior_part["records"]:
            # Older payloads used the state year for both GDP datasets. Derive
            # the actual district period from its retained observations.
            prior_part["observationPeriod"] = max(row["date"] for row in prior_part["records"])
            prior_part["sourceUrl"] = GDP_DISTRICT_REAL_SOURCE_URL if district else GDP_STATE_REAL_SOURCE_URL
            prior_part["datasetUrl"] = GDP_DISTRICT_REAL_URL if district else GDP_STATE_REAL_URL
        url = GDP_DISTRICT_REAL_URL if district else GDP_STATE_REAL_URL
        part = _refresh_regional_source(prior_part, retrieved,
            lambda district=district, url=url: parse_regional_gdp_source(read_csv(url), retrieved, district=district),
            {"records": [], "residualRecords": [], "sourceUrl": GDP_DISTRICT_REAL_SOURCE_URL if district else GDP_STATE_REAL_SOURCE_URL, "datasetUrl": url})
        gdp_parts[key] = part
        sources[key] = _regional_source_metadata(part)
    gdp = _combine_regional_gdp(gdp_parts["gdpState"], gdp_parts["gdpDistrict"])
    sources["gdp"] = gdp
    cpi = _refresh_regional_source(old_sources.get("cpi"), retrieved,
        lambda: parse_state_cpi(read_catalogue_json("cpi_state_inflation"), retrieved),
        {"records": [], "sourceUrl": CPI_STATE_SOURCE_URL})
    sources["cpi"] = cpi

    indexes = [{item["state"]: item for item in part.get(field, [])} for part, field in
               [(hies_state, "records"), (labour, "stateRecords"), (gdp, "stateRecords"), (cpi, "records")]]
    hies_index, labour_index, gdp_index, cpi_index = indexes
    states = sorted(set().union(*(set(index) for index in indexes), {row["state"] for row in sources["incomeGroupState"].get("stateGroups", [])}))
    records = []
    household_fields = ["incomeMean", "incomeMedian", "expenditureMean", "incomeMinusExpenditure", "incomeToExpenditureRatio", "poverty", "gini"]
    for state in states:
        survey, jobs, output, prices = [index.get(state, {}) for index in indexes]
        comparisons = {field: round(survey[field] - national[field], 3 if field == "gini" else 2)
                       if _safe_float(survey.get(field)) is not None and _safe_float(national.get(field)) is not None else None
                       for field in ["incomeMedian", "incomeMean", "poverty", "gini", "expenditureMean"]}
        records.append({"state": state, "date": survey.get("date"), **{field: survey.get(field) for field in household_fields},
                        "headlineInflation": prices.get("headlineInflation"), "inflationPeriod": prices.get("date"),
                        "unemploymentRate": jobs.get("unemploymentRate"), "labourPeriod": jobs.get("date"),
                        "realGdp": output.get("total"), "gdpPeriod": output.get("date"), "largestSector": output.get("largestSector"),
                        "largestSectorShare": output.get("largestSectorShare"), "sectorShares": output.get("sectors", []), "vsNational": comparisons})
    by_state = {row["state"]: row for row in records}
    summary_cards = []
    for state, short in [("W.P. Kuala Lumpur", "KL"), ("Sarawak", "Sarawak")]:
        row = by_state.get(state, {})
        income = _safe_float(row.get("incomeMedian"))
        gap = row.get("vsNational", {}).get("incomeMedian")
        benchmark = national.get("incomeMedian")
        detail = f"RM {gap:+,.0f} vs Malaysia median income of RM {benchmark:,.0f}." if gap is not None and benchmark is not None else "Same-period national income comparison is unavailable; no substitute benchmark is used."
        summary_cards.append({"label": f"{short} median income", "value": f"RM {income:,.0f}" if income is not None else "Unavailable", "detail": detail})
    for state, short in [("W.P. Kuala Lumpur", "KL"), ("Sarawak", "Sarawak")]:
        spending = _safe_float(by_state.get(state, {}).get("expenditureMean"))
        summary_cards.append({"label": f"{short} spending pressure", "value": f"RM {spending:,.0f}" if spending is not None else "Unavailable",
                              "detail": "Mean monthly household expenditure in the latest validated HIES release." if spending is not None else "State household expenditure is unavailable; no value from another geography is substituted."})
    kl, sarawak = by_state.get("W.P. Kuala Lumpur", {}), by_state.get("Sarawak", {})
    if all(_safe_float(row.get(field)) is not None for row in [kl, sarawak] for field in ["incomeMedian", "expenditureMean"]):
        income_direction = "higher than" if kl["incomeMedian"] > sarawak["incomeMedian"] else "lower than" if kl["incomeMedian"] < sarawak["incomeMedian"] else "the same as"
        spending_direction = "higher than" if kl["expenditureMean"] > sarawak["expenditureMean"] else "lower than" if kl["expenditureMean"] < sarawak["expenditureMean"] else "the same as"
        comparison = f"KL's median household income is {income_direction} Sarawak's; its mean household spending is {spending_direction} Sarawak's. Compare each source period and freshness before drawing conclusions."
    else:
        comparison = "The KL–Sarawak household comparison is unavailable until both states have validated survey observations. Other available regional datasets remain independently usable."
    independent = [sources[key] for key in [*benchmark_specs, "nationalExpenditure", "hiesState", "hiesDistrict", "incomeGroupState", "incomeGroupNational", "labour", "gdpState", "gdpDistrict", "cpi"]]
    fresh_count = sum(part.get("status") == "fresh" for part in independent)
    status = "fresh" if fresh_count == len(independent) and income_groups.get("status") == "fresh" else "partial" if fresh_count else "stale" if records or any(_regional_has_data(part) for part in independent) else "unavailable"
    return {"refreshPolicy": "source-local-v1", "status": status, "generatedAt": retrieved, "lastAttemptAt": retrieved,
            "calculationStatus": status if status in {"stale", "unavailable"} else "fresh",
            "message": f"{fresh_count} of {len(independent)} independent regional sources refreshed; unsuccessful sources retain only their own last-valid data",
            "defaultComparison": {"primary": "W.P. Kuala Lumpur", "secondary": "Sarawak"},
            "coverage": {"state": "State and federal-territory availability differs by source; inspect each metric's source status and observation period.",
                         "district": "District coverage is available where DOSM publishes district income, expenditure, poverty, inequality, labour-force and real GDP data. CPI is state-level only.",
                         "nationalOnly": ["OPR", "10-year MGS", "USD/MYR", "Bursa Malaysia benchmark", "Balance of payments"]},
            "sources": sources, "stateRecords": records, "districtRecords": hies_district.get("records", []),
            "districtLabourRecords": labour.get("districtRecords", []), "districtGdpRecords": gdp.get("districtRecords", []), "incomeGroups": income_groups,
            "summaryCards": summary_cards,
            "narratives": {"headline": "Regional living-cost pressure is not the same across Malaysia.", "comparison": comparison,
                           "incomeGroups": "B40, M40 and T20 comparisons describe household income distribution. Both state and national percentile datasets must be validated for a same-period comparison.",
                           "district": "District data can show within-state differences, but coverage is survey-based and not available for every monthly indicator.",
                           "nationalOnly": "Some financial indicators are national by design: BNM policy rates, government-bond yields, the ringgit and Bursa benchmarks do not have separate district values."},
            "downloads": [{"label": "Regional CSV", "href": "/api/regional-lens?format=csv"}, {"label": "Regional JSON", "href": "/api/regional-lens?format=json"}],
            "disclaimer": "Regional comparisons are descriptive and based on published official datasets. They are not a personal cost-of-living calculator, wage advice, property advice or investment advice."}


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
        result = parse_trade_headline(read_csv(TRADE_HEADLINE_URL), retrieved)
        return apply_observation_recency(result, retrieved, 100)
    except Exception as error:
        old = (previous or {}).get("externalSector")
        if not old or not old.get("points"):
            raise
        return {
            **copy.deepcopy(old),
            "status": "stale",
            "lastAttemptAt": retrieved,
            "message": f"Using last valid trade data: {type(error).__name__}",
        }


def parse_bop_balance(frame: pd.DataFrame, retrieved: str) -> dict:
    required = {"date", "account", "balance"}
    if not required.issubset(frame.columns):
        raise ValueError("BOP source structure changed")
    names = {
        "ca": "Current account",
        "ka": "Capital account",
        "fa": "Financial account",
        "reserves": "Official reserve account",
        "neo": "Net errors and omissions",
    }
    selected = frame.loc[frame["account"].isin(names), list(required)].copy()
    selected["date"] = pd.to_datetime(selected["date"], errors="raise")
    selected["balance"] = pd.to_numeric(selected["balance"], errors="raise")
    selected = selected.dropna(subset=["date", "account", "balance"]).sort_values(["date", "account"])
    if selected.empty:
        raise ValueError("BOP source is empty")
    if selected.duplicated(["date", "account"]).any():
        raise ValueError("BOP source contains duplicate quarter-account rows")
    quarters = []
    for date, quarter_frame in selected.groupby("date", sort=True):
        accounts = []
        for row in quarter_frame.itertuples(index=False):
            accounts.append({
                "id": str(row.account),
                "name": names[str(row.account)],
                "balance": round(float(row.balance) / 1000, 3),
            })
        if len(accounts) == len(names):
            quarters.append({"date": date.strftime("%Y-%m-%d"), "accounts": accounts})
    if len(quarters) < 20:
        raise ValueError("BOP source has insufficient quarterly history")
    latest = quarters[-1]
    latest_accounts = {item["id"]: item for item in latest["accounts"]}
    prior = quarters[-2]
    prior_accounts = {item["id"]: item for item in prior["accounts"]}
    current = latest_accounts["ca"]["balance"]
    financial = latest_accounts["fa"]["balance"]
    reserves = latest_accounts["reserves"]["balance"]
    direction = "surplus" if current > 0 else "deficit" if current < 0 else "balanced"
    return {
        "status": "fresh",
        "retrievedAt": retrieved,
        "observationPeriod": latest["date"],
        "source": "Department of Statistics Malaysia via data.gov.my",
        "sourceUrl": BOP_BALANCE_SOURCE_URL,
        "datasetUrl": BOP_BALANCE_URL,
        "frequency": "Quarterly",
        "unit": "RM billion",
        "quarters": quarters,
        "summary": {
            "latestDate": latest["date"],
            "currentAccount": current,
            "currentAccountChange": round(current - prior_accounts["ca"]["balance"], 3),
            "financialAccount": financial,
            "reserveAccount": reserves,
            "largestAbsoluteComponent": max(latest["accounts"], key=lambda item: abs(item["balance"]))["name"],
            "reading": direction,
        },
        "narratives": {
            "externalPosition": f"Malaysia's latest current account is a RM {abs(current):.1f} billion {direction}. The financial account balance is RM {financial:+.1f} billion and the official reserve account balance is RM {reserves:+.1f} billion.",
            "ringgitContext": "The balance of payments helps explain external funding pressure, but exchange rates also respond to interest-rate expectations, risk appetite and global US dollar conditions.",
        },
        "message": "Official quarterly BOP component balances validated",
    }


def build_balance_payments(previous: dict | None, retrieved: str) -> dict:
    try:
        result = parse_bop_balance(read_csv(BOP_BALANCE_URL), retrieved)
        return apply_observation_recency(result, retrieved, 200)
    except Exception as error:
        old = (previous or {}).get("balancePayments")
        if not old or not old.get("quarters"):
            raise
        return {
            **copy.deepcopy(old),
            "status": "stale",
            "lastAttemptAt": retrieved,
            "message": f"Using last valid BOP data: {type(error).__name__}",
        }


def build_household_pressure(series: dict[str, dict], market: dict, risk: dict, generated_at: str) -> dict:
    headline = float(series["headline"]["points"][-1]["value"])
    core = float(series["core"]["points"][-1]["value"])
    opr = float(series["opr"]["points"][-1]["value"])
    unemployment = float(series["unemployment"]["points"][-1]["value"])
    fx = float(series["fx"]["points"][-1]["value"])
    market_return = _risk_number(market.get("summary", {}).get("return1Y"))
    available_return = market_return is not None
    market_level = _heat_level(35 if market_return is not None and market_return > 5 else 55 if market_return is not None and market_return > -5 else 80) if available_return else "unavailable"
    components = [
        {"id": "cost-of-living", "label": "Cost of living", "score": 30 if headline < 2 else 55 if headline < 3 else 80, "evidence": f"Headline inflation is {headline:.1f}% and core inflation is {core:.1f}%.", "watch": "Track your own food, transport, rent and utilities basket rather than relying only on national CPI."},
        {"id": "debt-service", "label": "Debt service", "score": 35 if opr < 2.5 else 60 if opr < 3.25 else 80, "evidence": f"The OPR is {opr:.2f}%, which anchors many floating-rate loan discussions.", "watch": "Stress-test mortgage, hire-purchase and personal-loan instalments before taking new commitments."},
        {"id": "job-income", "label": "Job and income", "score": 25 if unemployment < 4 else 55 if unemployment < 5 else 80, "evidence": f"Unemployment is {unemployment:.1f}%.", "watch": "National unemployment can hide weaker hiring in specific sectors or regions."},
        {"id": "imported-spending", "label": "Imported spending", "score": 30 if fx < 4.2 else 55 if fx < 4.6 else 80, "evidence": f"USD/MYR is RM {fx:.4f}.", "watch": "Foreign-currency subscriptions, travel, imported goods and overseas education can move differently from local CPI."},
        {"id": "wealth-risk", "label": "Market wealth", "score": (35 if market_return > 5 else 55 if market_return > -5 else 80) if available_return else None, "level": market_level, "unavailableReason": None if available_return else "A valid one-year KLCI price return is not available, so this signal is excluded from the household mean.", "evidence": f"KLCI one-year price return is {market_return:+.1f}%." if available_return else "KLCI one-year price return is unavailable; no market-wealth pressure score is assigned.", "watch": "Equity performance is not a savings plan; align risk with time horizon and cash needs."},
    ]
    available_scores = [item["score"] for item in components if item["score"] is not None]
    average = round(sum(available_scores) / len(available_scores), 1) if available_scores else None
    summary = (f"Household pressure is {_heat_level(int(average))}, led by {max((item for item in components if item['score'] is not None), key=lambda item: item['score'])['label'].lower()} in the current rule-based screen." if average is not None else "The household pressure summary is unavailable because none of its component scores can be calculated.")
    if not available_return:
        summary += " The market-wealth signal is unavailable because a valid one-year KLCI return is missing."
    return {
        "generatedAt": generated_at,
        "status": "partial" if not available_return else risk.get("status", "partial"),
        "overallScore": average,
        "overallLevel": _heat_level(int(average)) if average is not None else "unavailable",
        "summary": summary,
        "components": components,
        "scenarios": [
            {"title": "Variable-rate borrower", "prompt": "If policy-rate pressure remains elevated, check whether repayments still fit after a 50-100 bp stress test.", "limit": "Actual loan pricing depends on lender, tenure, collateral and borrower profile."},
            {"title": "New property buyer", "prompt": "Compare rent, ownership costs, maintenance and cash buffer after down payment before relying on future price appreciation.", "limit": "This is not a property recommendation and does not assess any location."},
            {"title": "Early-career worker", "prompt": "Use stable labour periods to build emergency savings, portfolio evidence and transferable skills.", "limit": "Occupation-specific hiring can diverge from national unemployment."},
            {"title": "Long-term investor", "prompt": "Use diversification and time horizon rather than the latest Bursa move as the decision anchor.", "limit": "Returns exclude dividends, fees and taxes and are not forecasts."},
        ],
        "disclaimer": "Educational household-pressure screen only. It is not personalised financial, investment, property, tax, legal or career advice.",
    }


def build_sector_deep_dive(growth_drivers: dict, market: dict, external: dict, generated_at: str) -> dict:
    production = growth_drivers.get("production", {})
    latest_year = production.get("years", [{}])[-1]
    sectors = []
    for sector in latest_year.get("sectors", []):
        export_link = "high" if sector["id"] in {"p2", "p3", "p1"} else "moderate" if sector["id"] == "p5" else "low"
        market_link = "direct and indirect" if sector["id"] in {"p3", "p5", "p2"} else "mostly indirect"
        exports_yoy = _risk_number(external.get("summary", {}).get("exportsYoY"))
        sector_change = _risk_number(sector.get("changeYoY"))
        risk_available = sector_change is not None and (export_link != "high" or exports_yoy is not None)
        risk_score = 35 + (10 if export_link == "high" and exports_yoy < 0 else 0) + (10 if sector_change < 0 else 0) if risk_available else None
        change_text = f"Its current-price output change is {sector_change:+.1f}%." if sector_change is not None else "Its prior-year current-price output comparison is unavailable."
        sectors.append({
            "id": sector["id"],
            "name": sector["name"],
            "share": sector["share"],
            "value": sector["value"],
            "changeYoY": sector.get("changeYoY"),
            "growthContribution": sector.get("growthContribution"),
            "exportLink": export_link,
            "marketLink": market_link,
            "riskLevel": _heat_level(risk_score) if risk_score is not None else "unavailable",
            "narrative": f"{sector['name']} accounts for {sector['share']:.1f}% of nominal GDP in {latest_year.get('year')}. {change_text}",
        })
    return {
        "generatedAt": generated_at,
        "status": growth_drivers.get("status", "partial"),
        "year": latest_year.get("year"),
        "summary": f"The sector deep-dive maps production GDP shares to export exposure, Bursa context and recent current-price growth for {latest_year.get('year')}.",
        "sectors": sectors,
        "source": production.get("source", "Department of Statistics Malaysia via data.gov.my"),
        "sourceUrl": production.get("sourceUrl", GDP_STRUCTURE_SOURCE_URL),
        "limitations": "Sector screens describe broad economic structure. They do not forecast company earnings or identify investable stocks.",
    }


def build_macro_timeline(series: dict[str, dict], structural: dict, market: dict, generated_at: str) -> dict:
    entries = []
    for event in EVENT_CATALOGUE:
        entries.append({**event, "type": "official-event", "evidence": "Version-controlled event catalogue with official source link."})
    for key, indicator in structural.get("indicators", {}).items():
        for candidate in indicator.get("candidates", []):
            if candidate.get("status") in {"supported", "possible"}:
                entries.append({
                    "date": candidate["breakPeriod"],
                    "title": f"{candidate['statusLabel']} in {SPECS.get(key, SeriesSpec(key, key, '', 1, '', '', '', 0, 0, 0)).title}",
                    "category": "Structural diagnostics",
                    "source": "MacroLens structural-break screen",
                    "sourceUrl": "/api/structural-breaks?format=json",
                    "type": "statistical-break",
                    "evidence": f"Adjusted Chow p {candidate['chow']['pHolm']:.3f}; HAC p {candidate['hacWald']['pValue']:.3f}.",
                })
    market_return = _risk_number(market["summary"].get("return1Y"))
    market_return_text = f"{market_return:+.1f}%" if market_return is not None else "Unavailable (insufficient valid one-year data)"
    entries.append({"date": market["summary"]["latestDate"], "title": "Latest Bursa KLCI observation", "category": "Market data", "source": market["benchmark"]["source"], "sourceUrl": market["benchmark"]["sourceUrl"], "type": "latest-observation", "evidence": f"KLCI one-year price return: {market_return_text}."})
    entries.sort(key=lambda item: item["date"])
    return {
        "generatedAt": generated_at,
        "status": "fresh" if structural.get("status") == "fresh" else "partial",
        "entries": entries,
        "summary": "The timeline combines official Malaysian events, data-selected structural breaks and the latest market observation. Event proximity is context, not causal proof.",
        "limitations": "Structural-break candidates are exploratory and may change after official data revisions.",
    }


def build_data_health(payload: dict, generated_at: str) -> dict:
    source_rows = []
    for key, source in payload.get("sources", {}).items():
        source_rows.append({"id": key, **source})
    extra = [
        ("market", payload.get("market", {})),
        ("economicStructure", payload.get("economicStructure", {})),
        ("externalSector", payload.get("externalSector", {})),
        ("balancePayments", payload.get("balancePayments", {})),
        ("growthDrivers.demand", payload.get("growthDrivers", {}).get("demand", {})),
        *((f"regionalLens.{key}", source) for key, source in payload.get("regionalLens", {}).get("sources", {}).items()),
        ("regionalLens.nationalExpenditure", payload.get("regionalLens", {}).get("sources", {}).get("hiesState", {}).get("nationalExpenditure", {})),
    ]
    for key, source in extra:
        if source:
            source_rows.append({
                "id": key,
                "status": source.get("status", "unavailable"),
                "retrievedAt": source.get("retrievedAt"),
                "lastAttemptAt": source.get("lastAttemptAt"),
                "sourceUrl": source.get("sourceUrl") or source.get("datasetUrl"),
                "observationPeriod": source.get("observationPeriod") or source.get("summary", {}).get("latestDate", ""),
                "message": source.get("message", "Validated"),
            })
    stale_count = sum(1 for row in source_rows if row.get("status") != "fresh")
    overall = "fresh" if source_rows and stale_count == 0 else "partial"
    note = f"{len(source_rows) - stale_count} of {len(source_rows)} source groups validated successfully and passed available recency checks. Observation periods differ; fresh does not mean real-time."
    return {
        "generatedAt": generated_at,
        "schemaVersion": payload.get("schemaVersion"),
        "overall": overall,
        "note": note,
        "overallHealth": overall,
        "sourceCount": len(source_rows),
        "staleCount": stale_count,
        "sources": source_rows,
        "refresh": payload.get("dataOperations", {}),
        "summary": note,
    }


def build_monthly_report(payload: dict, generated_at: str) -> dict:
    brief = payload["latestBrief"]
    risk = payload["riskHeatmap"]
    bop = payload["balancePayments"]
    household = payload["householdPressure"]
    return {
        "generatedAt": generated_at,
        "title": "MacroLens Malaysia monthly research brief",
        "period": brief["period"],
        "sections": [
            {"heading": "Main macro reading", "body": brief["headline"]},
            {"heading": "Risk heatmap", "body": risk["summary"]},
            {"heading": "Household pressure", "body": household["summary"]},
            {"heading": "External position", "body": bop["narratives"]["externalPosition"]},
            {"heading": "Forecast", "body": payload["narratives"]["forecast"]},
        ],
        "downloads": [
            {"label": "Dashboard JSON", "url": "/api/dashboard-v7"},
            {"label": "Structural diagnostics CSV", "url": "/api/structural-breaks?format=csv"},
            {"label": "Structural diagnostics JSON", "url": "/api/structural-breaks?format=json"},
        ],
        "disclaimer": "This report is generated from validated dashboard data and is educational analysis, not personalised financial advice.",
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
    old_market = (previous or {}).get("market", {})
    retrieval_succeeded = False
    recency = {}
    try:
        points = fetch_klci()
        recency = apply_observation_recency({"status": "fresh", "observationPeriod": points[-1]["date"], "message": "Delayed daily prices validated"}, retrieved, 10)
        retrieval_succeeded = True
        status, message = recency["status"], recency["message"]
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
    result = {
        "status": status,
        "retrievedAt": retrieved if retrieval_succeeded else old_market.get("retrievedAt"),
        "lastAttemptAt": retrieved,
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
    if "freshness" in recency:
        result["freshness"] = recency["freshness"]
    return result


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


def monthly_last(points: list[dict], forward_fill: bool = False) -> pd.Series:
    """Use the last dated observation in each month (needed for policy rates)."""
    series = pd.Series({pd.Timestamp(point["date"]): point["value"] for point in points}, dtype=float).sort_index()
    result = series.resample("MS").last()
    return result.ffill().dropna() if forward_fill else result.dropna()


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


def structural_indicator_narrative(candidates: list[dict]) -> str:
    """Deterministic interpretation of saved diagnostics, without rerunning statistics."""
    supported = [candidate for candidate in candidates if candidate["status"] == "supported"]
    possible = [candidate for candidate in candidates if candidate["status"] == "possible"]
    if supported:
        latest = supported[-1]
        change = latest["regimeComparison"]["absoluteChange"]
        direction = "higher" if change > 0 else "lower"
        return f"The latest supported parameter shift is estimated near {latest['breakPeriod'][:7]}. The adjacent-regime mean was {abs(change):.2f} units {direction}; both the Holm-adjusted Chow and HAC tests are below 5%. This is evidence of parameter instability, not proof that a nearby event caused the change."
    if possible:
        latest = possible[-1]
        return f"A possible shift is screened near {latest['breakPeriod'][:7]}, but the classical and autocorrelation-robust evidence do not both meet the 5% threshold. This is suggestive evidence, not confirmed instability or proof that a nearby event caused the change."
    if candidates:
        return "The screening step found candidate regime boundaries, but the confirmation tests do not support calling them structural shifts. Screened candidates alone do not establish parameter instability or causality."
    return "BIC selected a single-regime specification; no discrete break was detected under this specification. This does not prove stability or a causal link to nearby events."


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

    narrative_text = structural_indicator_narrative(candidates)

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
                indicators[key]["calculationStatus"] = "stale"
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
    for key in ("unemployment", "fx", "mgs"):
        values = monthly(series[key]).reindex(index).ffill().shift(1)
        output[key] = values
    output["opr"] = monthly_last(series["opr"], forward_fill=True).reindex(index).ffill().shift(1)
    return output.ffill().dropna()


def fit_model(name: str, y: pd.Series, exog: pd.DataFrame | None = None):
    if name == "SARIMA":
        return SARIMAX(y, order=(1, 0, 1), seasonal_order=(1, 0, 0, 12), trend="c", enforce_stationarity=False, enforce_invertibility=False).fit(disp=False)
    return SARIMAX(y, exog=exog, order=(1, 0, 1), seasonal_order=(0, 0, 0, 0), trend="c", enforce_stationarity=False, enforce_invertibility=False).fit(disp=False)


def _require_converged(model) -> None:
    converged = getattr(model, "mle_retvals", {}).get("converged")
    if converged is not None and not bool(converged):
        raise ValueError("Model fit did not converge")


def _forecast_arrays(name: str, y: pd.Series, exog: pd.DataFrame | None, future_dates: pd.DatetimeIndex):
    """Fit only the supplied training sample; never read realised future inputs."""
    horizon = len(future_dates)
    model = None
    if name == "Seasonal naive":
        central = np.array([y.iloc[-12 + step] for step in range(horizon)], dtype=float)
        residuals = y.iloc[12:].to_numpy() - y.iloc[:-12].to_numpy()
        sigma = float(np.std(residuals, ddof=1))
        intervals = np.array([
            (value - 1.282 * sigma * math.sqrt(step + 1), value + 1.282 * sigma * math.sqrt(step + 1),
             value - 1.96 * sigma * math.sqrt(step + 1), value + 1.96 * sigma * math.sqrt(step + 1))
            for step, value in enumerate(central)
        ])
    else:
        model = fit_model(name, y, exog if name == "ARIMAX" else None)
        _require_converged(model)
        if name == "ARIMAX":
            # Fixed at the last available training value, not realised target-month values.
            future_x = pd.DataFrame([exog.iloc[-1].to_dict()] * horizon, index=future_dates)
            result = model.get_forecast(horizon, exog=future_x)
        else:
            result = model.get_forecast(horizon)
        central = np.asarray(result.predicted_mean, dtype=float)
        ci80 = np.asarray(result.conf_int(alpha=.20), dtype=float)
        ci95 = np.asarray(result.conf_int(alpha=.05), dtype=float)
        intervals = np.column_stack([ci80[:, 0], ci80[:, 1], ci95[:, 0], ci95[:, 1]])
    if central.shape != (horizon,) or intervals.shape != (horizon, 4):
        raise ValueError("Forecast returned an incomplete horizon")
    if not np.isfinite(central).all() or not np.isfinite(intervals).all():
        raise ValueError("Forecast contains non-finite values or intervals")
    if (intervals[:, 0] > intervals[:, 1]).any() or (intervals[:, 2] > intervals[:, 3]).any():
        raise ValueError("Forecast interval bounds are reversed")
    if (intervals[:, 2] > intervals[:, 0]).any() or (intervals[:, 3] < intervals[:, 1]).any():
        raise ValueError("Forecast 95% bounds do not contain 80% bounds")
    return central, intervals, model


def _absolute_error_quantile(errors: list[float], coverage: float) -> float | None:
    """Finite-sample absolute-error order statistic; return None if unsupported."""
    ordered = sorted(float(error) for error in errors)
    if not ordered or any(not math.isfinite(error) for error in ordered):
        return None
    rank = math.ceil((len(ordered) + 1) * coverage)
    if rank > len(ordered):
        return None
    return ordered[rank - 1]


def _apply_prequential_recalibration(windows: list[dict]) -> dict:
    """Add experimental ranges using same-model/horizon errors known before each origin."""
    origins = [window["origin"] for window in windows]
    warmup = origins[:CALIBRATION_WARMUP_ORIGINS]
    evaluation = origins[CALIBRATION_WARMUP_ORIGINS:]
    for index, window in enumerate(windows):
        window["evaluationPhase"] = "calibration-warmup" if index < CALIBRATION_WARMUP_ORIGINS else "held-out-evaluation"
        origin = window["origin"]
        for model in window["models"]:
            for point in model["points"]:
                historical = []
                if index >= CALIBRATION_WARMUP_ORIGINS:
                    for prior in windows[:index]:
                        if prior["origin"] >= origin:
                            continue
                        previous_model = next((row for row in prior["models"] if row["name"] == model["name"] and row["status"] == "success"), None)
                        if not previous_model:
                            continue
                        for previous_point in previous_model["points"]:
                            if previous_point["horizon"] == point["horizon"] and previous_point["date"] < origin:
                                historical.append(previous_point)
                targets = [item["date"] for item in historical]
                errors = [abs(item["error"]) for item in historical]
                q80 = _absolute_error_quantile(errors, 0.80)
                q95 = _absolute_error_quantile(errors, 0.95)
                predicted = float(point["predicted"])
                if q95 is not None:
                    q95 = max(q95, q80 if q80 is not None else 0.0)
                point["recalibrated"] = {
                    "calibrationCount": len(historical),
                    "calibrationTargets": targets,
                    "low80": round(predicted - q80, 6) if q80 is not None else None,
                    "high80": round(predicted + q80, 6) if q80 is not None else None,
                    "low95": round(predicted - q95, 6) if q95 is not None else None,
                    "high95": round(predicted + q95, 6) if q95 is not None else None,
                }
    comparison = []
    for name in ("Seasonal naive", "SARIMA", "ARIMAX"):
        for horizon in (1, 2, 3):
            pool = []
            for window in windows[CALIBRATION_WARMUP_ORIGINS:]:
                row = next((model for model in window["models"] if model["name"] == name and model["status"] == "success"), None)
                if row:
                    pool.extend(point for point in row["points"] if point["horizon"] == horizon)
            for level in (80, 95):
                low_key, high_key = (f"low{level}", f"high{level}")
                raw = [point for point in pool if point.get(low_key) is not None and point.get(high_key) is not None]
                adjusted = [point for point in pool if point["recalibrated"].get(low_key) is not None and point["recalibrated"].get(high_key) is not None]
                def interval_stats(points: list[dict], lower: Callable[[dict], float], upper: Callable[[dict], float]) -> dict:
                    count = len(points)
                    return {
                        "count": count,
                        "coverage": round(sum(lower(point) <= point["actual"] <= upper(point) for point in points) / count, 6) if count else None,
                        "meanWidth": round(sum(upper(point) - lower(point) for point in points) / count, 6) if count else None,
                    }
                comparison.append({
                    "model": name,
                    "horizon": horizon,
                    "nominalCoverage": level,
                    "evaluationPoints": len(pool),
                    "uncalibrated": interval_stats(raw, lambda point: point[low_key], lambda point: point[high_key]),
                    "recalibrated": interval_stats(adjusted, lambda point: point["recalibrated"][low_key], lambda point: point["recalibrated"][high_key]),
                    "unavailableCalibrationPoints": len(pool) - len(adjusted),
                })
    return {
        "status": "experimental" if evaluation else "insufficient-evaluation-history",
        "method": "Rolling absolute forecast-error quantiles by model and horizon; each held-out origin uses only targets observed strictly before that origin.",
        "warmupOrigins": warmup,
        "evaluationOrigins": evaluation,
        "minimumSampleRule": "Finite-sample order statistic at rank ceil((n+1) × nominal coverage); range unavailable when the rank exceeds the number of prior errors. This requires at least 4 prior errors for 80% and 19 for 95%.",
        "byModelHorizon": comparison,
        "warning": "Experimental comparison only. Rolling forecast errors are serially dependent and overlapping, so these ranges do not have a distribution-free or guaranteed coverage claim. They do not change the published forecast intervals or model selection.",
    }


def backtest(series: dict[str, list[dict]]) -> tuple[list[dict], str, dict]:
    y_full = monthly(series["headline"])
    exog_full = prepare_exog(series, y_full.index)
    common = y_full.index.intersection(exog_full.index)
    y_full, exog_full = y_full.loc[common], exog_full.loc[common]
    names = ["Seasonal naive", "SARIMA", "ARIMAX"]
    # Last origin must leave all three observed targets. Retain a documented
    # reproducible recent cap: 36 origins, rather than the previous 12.
    eligible_origins = [position for position in range(35, len(y_full) - 3)
                        if y_full.index[position + 1:position + 4].equals(
                            pd.date_range(y_full.index[position] + pd.offsets.MonthBegin(), periods=3, freq="MS"))]
    origins = eligible_origins[-BACKTEST_MAX_ORIGINS:]
    if not origins:
        raise ValueError("At least 36 training months and three complete target months are required")
    windows = []
    audited_points = {name: [] for name in names}
    failures = {name: [] for name in names}
    for origin in origins:
        train = y_full.iloc[: origin + 1]
        truth = y_full.iloc[origin + 1: origin + 4]
        origin_date = train.index[-1].strftime("%Y-%m-%d")
        fold = {"origin": origin_date, "trainingStart": train.index[0].strftime("%Y-%m-%d"),
                "trainingEnd": origin_date, "trainingObservations": len(train),
                "targets": [date.strftime("%Y-%m-%d") for date in truth.index], "models": []}
        for name in names:
            row = {"name": name, "status": "success", "failureReason": None, "fallbackModel": None, "points": []}
            try:
                central, intervals, _ = _forecast_arrays(name, train, exog_full.loc[train.index], truth.index)
                for step, (date, actual, predicted, bounds) in enumerate(zip(truth.index, truth, central, intervals), start=1):
                    low80, high80, low95, high95 = [round(float(value), 6) for value in bounds]
                    actual, predicted = round(float(actual), 6), round(float(predicted), 6)
                    point = {"horizon": step, "date": date.strftime("%Y-%m-%d"), "actual": actual,
                             "predicted": predicted, "error": round(predicted - actual, 6),
                             "low80": low80, "high80": high80, "low95": low95, "high95": high95,
                             "covered80": low80 <= actual <= high80, "covered95": low95 <= actual <= high95}
                    row["points"].append(point)
                audited_points[name].extend(row["points"])
            except Exception as error:
                row.update({"status": "failed", "failureReason": f"{type(error).__name__}: {str(error)[:240]}", "points": []})
                failures[name].append(origin_date)
            fold["models"].append(row)
        windows.append(fold)
    calibration_experiment = _apply_prequential_recalibration(windows)
    scores = []
    origin_dates = [fold["origin"] for fold in windows]
    eligibility = []
    coverage = []
    for name in names:
        points = audited_points[name]
        eligible = not failures[name] and len(points) == 3 * len(windows)
        actual = [point["actual"] for point in points]
        predicted = [point["predicted"] for point in points]
        performance_by_horizon = []
        for horizon in (1, 2, 3):
            horizon_points = [point for point in points if point["horizon"] == horizon]
            errors = [point["error"] for point in horizon_points]
            performance_by_horizon.append({
                "horizon": horizon,
                "count": len(errors),
                "mae": round(float(mean_absolute_error([point["actual"] for point in horizon_points], [point["predicted"] for point in horizon_points])), 4) if errors else None,
                "rmse": round(float(mean_squared_error([point["actual"] for point in horizon_points], [point["predicted"] for point in horizon_points]) ** 0.5), 4) if errors else None,
            })
        scores.append({"name": name,
                       "rmse": round(float(mean_squared_error(actual, predicted) ** 0.5), 4) if points else None,
                       "mae": round(float(mean_absolute_error(actual, predicted)), 4) if points else None,
                       "selected": False, "eligible": eligible, "successfulWindows": len(windows) - len(failures[name]),
                       "failedWindows": len(failures[name]), "fallbackCount": 0,
                       "metricsByHorizon": performance_by_horizon,
                       "scoreBasis": "Identical complete three-month windows" if eligible else "Successful fits only; not eligible for selection"})
        eligibility.append({"name": name, "eligible": eligible, "successfulWindows": len(windows) - len(failures[name]),
                            "failedWindows": len(failures[name]), "origins": origin_dates, "failedOrigins": failures[name]})
        def measured(items):
            numerator80 = sum(point["covered80"] for point in items)
            numerator95 = sum(point["covered95"] for point in items)
            return {"covered80": numerator80, "total80": len(items), "coverage80": round(numerator80 / len(items), 6) if items else None,
                    "covered95": numerator95, "total95": len(items), "coverage95": round(numerator95 / len(items), 6) if items else None,
                    "meanWidth80": round(float(np.mean([point["high80"] - point["low80"] for point in items])), 6) if items else None,
                    "meanWidth95": round(float(np.mean([point["high95"] - point["low95"] for point in items])), 6) if items else None}
        coverage.append({"name": name, "eligible": eligible, **measured(points),
                         "byHorizon": [{"horizon": horizon, **measured([point for point in points if point["horizon"] == horizon])} for horizon in (1, 2, 3)]})
    eligible_scores = [score for score in scores if score["eligible"]]
    if not eligible_scores:
        raise ValueError("No forecast candidate completed all evaluation windows")
    selected = min(eligible_scores, key=lambda score: (score["rmse"], score["mae"], names.index(score["name"])))["name"]
    for score in scores:
        score["selected"] = score["name"] == selected
    evaluation = {
        "method": "Pseudo-real-time rolling-origin evaluation", "horizonMonths": 3, "origins": origin_dates,
        "originPolicy": f"All eligible monthly origins in the latest {BACKTEST_MAX_ORIGINS} folds; minimum 36 training observations and three consecutive observed target months.",
        "windows": windows, "candidateEligibility": eligibility, "coverage": coverage,
        "calibrationExperiment": calibration_experiment,
        "fallbackCount": 0, "errorDefinition": "predicted minus actual, percentage points",
        "eligibilityRule": "Every candidate attempts the same origins. Selection requires successful fits and all three targets at every origin; failed fits are not replaced or scored as that candidate.",
        "caveats": [
            "Pseudo-real-time, not a historical-vintage backtest: saved current observations may contain revisions that were not available at the original origin.",
            "Core CPI uses the origin's same-month observation; unemployment, FX, OPR and MGS use an assumed one-month lag. These conservative assumptions are not verified historical release timestamps.",
            "ARIMAX future covariates are frozen at the last training values. Its intervals are conditional on that path and do not include future-covariate uncertainty.",
            "Monthly origins overlap across three-month target windows, so errors and interval coverage are dependent; coverage is descriptive, not a calibration guarantee.",
            "Seasonal-naive bounds use only training seasonal residuals with square-root-horizon scaling; parametric model intervals and these approximations may understate uncertainty.",
            "Ineligible candidates' error scores and coverage, if present, describe successful fits only and are not comparable selection scores on the complete shared sample.",
        ],
    }
    return scores, selected, evaluation


def forecast(series: dict[str, list[dict]]) -> dict:
    scores, selected, evaluation = backtest(series)
    y = monthly(series["headline"])
    exog = prepare_exog(series, y.index)
    common = y.index.intersection(exog.index)
    y, exog = y.loc[common], exog.loc[common]
    future_dates = pd.date_range(y.index[-1] + pd.offsets.MonthBegin(), periods=3, freq="MS")
    requested = selected
    failure_reason = None
    try:
        central, intervals, final_model = _forecast_arrays(selected, y, exog, future_dates)
    except Exception as error:
        if selected == "Seasonal naive":
            raise
        failure_reason = f"{type(error).__name__}: {str(error)[:240]}"
        selected = "Seasonal naive"
        central, intervals, final_model = _forecast_arrays(selected, y, exog, future_dates)
    evaluation["finalFit"] = {"requestedModel": requested, "usedModel": selected, "fallbackUsed": failure_reason is not None, "failureReason": failure_reason}
    evaluation["fallbackCount"] = evaluation.get("fallbackCount", 0) + int(failure_reason is not None)
    for score in scores:
        score["selected"] = score["name"] == selected
    points = []
    for date, value, bounds in zip(future_dates, central, intervals):
        low80, high80, low95, high95 = bounds
        points.append({"date": date.strftime("%Y-%m-%d"), "value": round(float(value), 3), "low80": round(float(low80), 3), "high80": round(float(high80), 3), "low95": round(float(min(low95, low80)), 3), "high95": round(float(max(high95, high80)), 3)})
    scenario = None
    try:
        sensitivity_model = final_model if selected == "ARIMAX" else fit_model("ARIMAX", y, exog)
        _require_converged(sensitivity_model)
        scenario = {
            "model": "ARIMAX sensitivity model",
            "lag": "Same-month core CPI; other economic inputs lagged one month",
            "baseline": {key: round(float(exog[key].iloc[-1]), 4) for key in ("core", "fx", "opr")},
            "coefficients": {key: round(float(sensitivity_model.params[key]), 6) for key in ("core", "fx", "opr")},
            "warning": "A conditional sensitivity overlay based on historical ARIMAX associations. Core CPI is contemporaneous; other inputs lag one month. It is not the selected forecast unless ARIMAX completes all backtest windows and wins, and it does not identify causal effects or include covariate-path uncertainty.",
        }
        evaluation["scenarioFit"] = {"status": "success", "failureReason": None}
    except Exception as error:
        scenario = None
        evaluation["scenarioFit"] = {"status": "failed", "failureReason": f"{type(error).__name__}: {str(error)[:240]}"}
    return {"selectedModel": selected, "methodLabel": "Pseudo-real-time backtest using conservative assumed release lags; not historical vintages", "backtestWindows": len(evaluation["windows"]), "models": scores, "points": points, "scenario": scenario, "evaluation": evaluation,
            "status": "fallback" if failure_reason else "fresh", "calculationStatus": "fallback" if failure_reason else "fresh"}


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
        status = {"status": "fresh", "retrievedAt": retrieved, "lastAttemptAt": retrieved, "observationPeriod": points[-1]["date"], "message": "Official source validated"}
        # OPR is an applicable policy setting, not a daily/monthly observation:
        # a successful response with an older last decision is not itself stale.
        max_age = {"headline": 100, "core": 100, "unemployment": 110, "fx": 45, "mgs": 10}.get(key)
        if max_age is not None:
            status = apply_observation_recency(status, retrieved, max_age)
    except Exception as error:
        old = previous and previous.get("series", {}).get(key)
        if not old:
            raise
        points = old["points"]
        previous_source = (previous or {}).get("sources", {}).get(key, {})
        status = {**copy.deepcopy(previous_source), "status": "stale", "retrievedAt": previous_source.get("retrievedAt"), "lastAttemptAt": retrieved, "observationPeriod": points[-1]["date"], "message": f"Using last valid data: {type(error).__name__}"}
    return {**spec.__dict__, "points": points}, status


def apply_observation_recency(source: dict, attempted_at: str, maximum_age_days: int) -> dict:
    """Conservative age screen, not an assertion about an official release date."""
    source["lastAttemptAt"] = attempted_at
    period = source.get("observationPeriod") or source.get("summary", {}).get("latestDate")
    if not period:
        return source
    observation = pd.Timestamp(period)
    attempted = pd.Timestamp(attempted_at)
    observation = observation.tz_localize("UTC") if observation.tzinfo is None else observation.tz_convert("UTC")
    attempted = attempted.tz_localize("UTC") if attempted.tzinfo is None else attempted.tz_convert("UTC")
    age = (attempted.normalize() - observation.normalize()).days
    source["freshness"] = {"basis": "observation-recency", "observationAgeDays": age, "maximumObservationAgeDays": maximum_age_days, "note": "Conservative observation-age limit; not a verified official release calendar."}
    if age > maximum_age_days:
        source["status"] = "stale"
        source["message"] = f"Response validated but latest observation exceeds the {maximum_age_days}-day recency limit; showing last available observation"
    elif age < 0:
        raise ValueError("Source contains a future observation")
    return source


def finalize_data_trust(payload: dict) -> dict:
    """Propagate input health without changing observations or model outputs.

    The calculation status is separate from source availability. Both must be
    fresh before a derived section can be labelled fresh.
    """
    statuses = {key: source.get("status", "unavailable") for key, source in payload.get("sources", {}).items()}
    for key in ["market", "economicStructure", "externalSector", "balancePayments"]:
        statuses[key] = payload.get(key, {}).get("status", "unavailable")

    def attach(section: dict, inputs: dict[str, str]) -> dict:
        if not section:
            return section
        bad = sorted(key for key, status in inputs.items() if status != "fresh")
        calculated = section.get("calculationStatus", section.get("status", "fresh"))
        section["calculationStatus"] = calculated
        section["inputHealth"] = {
            "status": "partial" if bad else "fresh", "staleInputs": bad,
            "note": "Uses retained, stale or unavailable inputs: " + ", ".join(bad) if bad else "All required inputs passed source validation; observation periods still differ.",
        }
        section["status"] = calculated if calculated in {"stale", "unavailable", "fallback"} else "partial" if bad else calculated
        return section

    growth = payload.get("growthDrivers", {})
    attach(growth, {"economicStructure": statuses["economicStructure"], "growthDrivers.demand": growth.get("demand", {}).get("status", "unavailable")})
    statuses["growthDrivers"] = growth.get("status", "unavailable")
    regional = payload.get("regionalLens", {})
    regional_inputs = {f"regionalLens.{key}": source.get("status", "unavailable") for key, source in regional.get("sources", {}).items()}
    national = regional.get("sources", {}).get("hiesState", {}).get("nationalExpenditure")
    if national:
        regional_inputs["regionalLens.nationalExpenditure"] = national.get("status", "unavailable")
    attach(regional, regional_inputs)
    statuses["regionalLens"] = regional.get("status", "unavailable")
    macro = {key: statuses.get(key, "unavailable") for key in SPECS}
    market_inputs = {key: statuses[key] for key in ["market", "growthDrivers", "externalSector"]}
    attach(payload.get("forecast", {}), macro)
    attach(payload.get("cpiDecomposition", {}), {key: statuses.get(key, "unavailable") for key in ["headline", "core"]})
    statuses["forecast"] = payload.get("forecast", {}).get("status", "unavailable")
    risk_inputs = {**macro, **market_inputs}
    risk_heatmap = payload.get("riskHeatmap", {})
    for risk_item in risk_heatmap.get("items", []):
        if risk_item.get("score") is None or risk_item.get("level") == "unavailable":
            risk_item["dataStatus"] = "unavailable"
            continue
        source_key = {"bursa": "market", "growth": "growthDrivers", "trade": "externalSector"}.get(risk_item["id"], risk_item["id"])
        risk_item["dataStatus"] = risk_inputs.get(source_key, risk_item.get("dataStatus", "unavailable"))
    attach(risk_heatmap, risk_inputs)
    statuses["riskHeatmap"] = payload.get("riskHeatmap", {}).get("status", "unavailable")
    attach(payload.get("latestBrief", {}), {**risk_inputs, "forecast": statuses["forecast"]})
    attach(payload.get("householdPressure", {}), {**macro, "market": statuses["market"], "riskHeatmap": statuses["riskHeatmap"]})
    attach(payload.get("decisionGuide", {}), {**risk_inputs, "riskHeatmap": statuses["riskHeatmap"]})
    attach(payload.get("sectorDeepDive", {}), market_inputs)
    structural = payload.get("structuralBreaks", {})
    for key, indicator in structural.get("indicators", {}).items():
        # OPR history supplies the event catalogue used for every indicator.
        attach(indicator, {key: statuses.get(key, "unavailable"), "opr": statuses.get("opr", "unavailable")})
        if indicator.get("status") == "partial":
            indicator["status"] = "stale"
    if structural.get("indicators"):
        structural["calculationStatus"] = "fresh" if all(item.get("calculationStatus") == "fresh" for item in structural["indicators"].values()) else "partial"
    attach(structural, {**macro, **{f"structuralBreaks.{key}": item.get("status", "unavailable") for key, item in structural.get("indicators", {}).items()}})
    attach(payload.get("macroTimeline", {}), {**macro, "market": statuses["market"], "structuralBreaks": structural.get("status", "unavailable")})
    attach(payload.get("monthlyReport", {}), {**risk_inputs, "forecast": statuses["forecast"], "balancePayments": statuses["balancePayments"], "regionalLens": statuses["regionalLens"]})
    source_sections = list(statuses.values())
    payload["health"] = "fresh" if source_sections and all(status == "fresh" for status in source_sections) else "partial"
    return payload


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


def _risk_number(value: object) -> float | None:
    """Accept actual finite measurements, including zero, but not booleans."""
    if isinstance(value, (bool, np.bool_)) or not isinstance(value, (int, float, np.number)):
        return None
    try:
        number = float(value)
    except (OverflowError, TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _risk_latest(series: dict) -> tuple[float | None, str]:
    points = series.get("points", [])
    point = points[-1] if points else {}
    return _risk_number(point.get("value")), point.get("date", "")


def _series_change(series: dict, months: int) -> float | None:
    """Use a calendar-month reference, not row counts for daily market series.

    The final trading observation on/before the reference date is acceptable
    only within that reference month. A missing month is not a zero change.
    """
    points = series.get("points", [])
    if not points or months < 1:
        return None
    latest_value = _risk_number(points[-1].get("value"))
    if latest_value is None:
        return None
    try:
        latest_date = pd.Timestamp(points[-1]["date"])
        if pd.isna(latest_date):
            return None
        reference_date = latest_date - pd.DateOffset(months=months)
        candidates = [(pd.Timestamp(point["date"]), point.get("value")) for point in points]
        candidates = [(date, value) for date, value in candidates
                      if not pd.isna(date) and date <= reference_date
                      and date.to_period("M") == reference_date.to_period("M")]
    except (KeyError, TypeError, ValueError):
        return None
    if not candidates:
        return None
    reference_value = _risk_number(max(candidates, key=lambda candidate: candidate[0])[1])
    return round(latest_value - reference_value, 4) if reference_value is not None else None


def _series_percentile(series: dict) -> float | None:
    values = [_risk_number(point.get("value")) for point in series.get("points", [])]
    if not values or any(value is None for value in values):
        return None
    latest = values[-1]
    return round(sum(1 for value in values if value <= latest) / len(values) * 100, 1)


def _heat_level(score: int) -> str:
    return "high" if score >= 70 else "moderate" if score >= 40 else "low"


def build_risk_heatmap(series: dict[str, dict], market: dict, growth_drivers: dict, external: dict, generated_at: str) -> dict:
    def item(id_: str, label: str, group: str, score: int | None, evidence: str, rule: str, period: str, watch: str,
             source_status: str = "fresh", unavailable_reason: str | None = None) -> dict:
        score = int(max(0, min(100, score))) if score is not None else None
        return {
            "id": id_,
            "label": label,
            "group": group,
            "score": score,
            "level": _heat_level(score) if score is not None else "unavailable",
            "dataStatus": source_status if score is not None else "unavailable",
            "unavailableReason": unavailable_reason if score is None else None,
            "evidence": evidence,
            "rule": rule,
            "period": period,
            "watch": watch,
        }

    items = []
    macro_settings = [
        ("headline", "Headline inflation", "Prices", (2, 3), (25, 45, 75), "Low below 2%, moderate from 2% to below 3%, high at 3% or above.", "Watch food, transport and administered-price categories."),
        ("core", "Core inflation", "Prices", (2, 3), (25, 50, 75), "Low below 2%, moderate from 2% to below 3%, high at 3% or above. The score uses the level, not the change.", "Persistent core pressure matters more than one monthly headline move."),
        ("unemployment", "Labour market", "Households", (4, 5), (25, 55, 80), "Low below 4%, moderate from 4% to below 5%, high at 5% or above.", "National unemployment can hide sector and regional weakness."),
        ("opr", "Policy rate", "Financial conditions", (2.5, 3.25), (35, 55, 75), "Low below 2.50%, moderate from 2.50% to below 3.25%, high at 3.25% or above.", "The real policy stance also depends on expected inflation."),
        ("fx", "USD/MYR pressure", "External", (4.2, 4.6), (30, 55, 80), "Low below RM 4.20, moderate from RM 4.20 to below RM 4.60, high at RM 4.60 or above. The historical percentile is context, not a score input.", "A weaker ringgit can help exporters while raising imported costs."),
        ("mgs", "10-year MGS yield", "Financial conditions", (3.5, 4.25), (30, 55, 80), "Low below 3.50%, moderate from 3.50% to below 4.25%, high at 4.25% or above.", "Bond yields reflect policy expectations, term premium and global rates."),
    ]
    for key, label, group, bounds, scores, rule, watch in macro_settings:
        source = series.get(key, {})
        value, period = _risk_latest(source)
        reason = f"Latest {key} level is missing or non-finite."
        score = None if value is None else scores[0] if value < bounds[0] else scores[1] if value < bounds[1] else scores[2]
        if value is None:
            evidence = f"Unavailable: {reason}"
        elif key == "headline":
            evidence = f"Latest headline CPI inflation is {value:.1f}%."
        elif key == "core":
            change = _series_change(source, 3)
            change_text = f"{change:+.1f} pp" if change is not None else "Unavailable (missing valid three-month reference observation)"
            evidence = f"Latest core inflation is {value:.1f}%; 3-month change is {change_text}."
        elif key == "fx":
            percentile = _series_percentile(source)
            percentile_text = f"at the {percentile:.1f}th percentile of this dashboard history" if percentile is not None else "historical percentile: Unavailable (incomplete or non-finite history)"
            evidence = f"USD/MYR is RM {value:.4f}; {percentile_text}."
        else:
            display_label = {"unemployment": "Unemployment", "opr": "OPR", "mgs": "10-year MGS yield"}[key]
            evidence = f"{display_label} is {value:.1f}%." if key == "unemployment" else f"{display_label} is {value:.2f}%."
        items.append(item(key, label, group, score, evidence, rule, period, watch, source.get("status", "fresh"), reason))

    market_summary = market.get("summary", {})
    market_return = _risk_number(market_summary.get("return1Y"))
    market_drawdown = _risk_number(market_summary.get("maxDrawdown1Y"))
    missing_market = [name for name in ["return1Y", "maxDrawdown1Y"] if _risk_number(market_summary.get(name)) is None]
    market_reason = "Required Bursa inputs are missing or non-finite: " + ", ".join(missing_market) + "."
    if missing_market:
        market_score, market_evidence = None, f"Unavailable: {market_reason}"
    else:
        market_drawdown = abs(market_drawdown)
        market_score = 35 if market_return >= 5 and market_drawdown < 10 else 55 if market_return > -5 else 75
        market_evidence = f"KLCI one-year price return is {market_return:+.1f}% with a {market_drawdown:.1f}% max drawdown."
    items.append(item("bursa", "Bursa large-cap market", "Markets", market_score, market_evidence,
                      "Low for return at least 5% and drawdown below 10%; moderate otherwise when return is above -5%; high when return is -5% or lower. Both measurements are required.",
                      market_summary.get("latestDate", ""), "Index performance excludes dividends, fees and taxes.", market.get("status", "fresh"), market_reason))

    demand = growth_drivers.get("demand", {})
    demand_years = demand.get("years", [])
    demand_summary = demand_years[-1].get("summary", {}) if demand_years else {}
    demand_type = demand_summary.get("demandType")
    known_types = {"consumption-led", "export-led", "investment-led", "import-sensitive", "broad-based"}
    demand_available = isinstance(demand_type, str) and demand_type in known_types and _risk_number(demand_summary.get("largestContribution")) is not None
    demand_reason = "Comparable demandType and largestContribution evidence are missing or invalid."
    demand_score = (35 if demand_type in {"consumption-led", "export-led", "investment-led"} else 55) if demand_available else None
    demand_evidence = f"Latest demand screen is {demand_type}." if demand_available else f"Unavailable: {demand_reason} Production-side GDP is not a substitute for missing demand evidence."
    items.append(item("growth", "GDP growth drivers", "Growth", demand_score, demand_evidence,
                      "Low for an identified consumption, export or investment engine; moderate for import-sensitive or broad-based demand. A comparable numerical demand contribution is required.",
                      demand.get("observationPeriod", ""), "Current-price GDP combines volume and price effects.", demand.get("status", growth_drivers.get("status", "fresh")), demand_reason))

    trade_summary = external.get("summary", {})
    trade_balance = _risk_number(trade_summary.get("balance"))
    exports_yoy = _risk_number(trade_summary.get("exportsYoY"))
    imports_yoy = _risk_number(trade_summary.get("importsYoY"))
    missing_trade = [name for name in ["balance", "exportsYoY", "importsYoY"] if _risk_number(trade_summary.get(name)) is None]
    trade_reason = "Required trade inputs are missing or non-finite: " + ", ".join(missing_trade) + "."
    if missing_trade:
        trade_score, trade_evidence = None, f"Unavailable: {trade_reason}"
    else:
        trade_score = 30 if trade_balance > 0 and exports_yoy >= imports_yoy else 55 if trade_balance > 0 else 75
        trade_evidence = f"Latest goods trade balance is RM {trade_balance:+.1f} billion; exports YoY {exports_yoy:+.1f}%, imports YoY {imports_yoy:+.1f}%."
    items.append(item("trade", "Goods trade balance", "External", trade_score, trade_evidence,
                      "Low for a positive trade balance with export growth at least import growth; moderate for a positive balance otherwise; high for a zero or negative balance. All three inputs are required.",
                      trade_summary.get("latestDate", ""), "Goods trade excludes services and income flows.", external.get("status", "fresh"), trade_reason))

    available = [entry for entry in items if entry["score"] is not None]
    average = round(sum(entry["score"] for entry in available) / len(available), 1) if available else None
    overall_level = _heat_level(average) if average is not None else "unavailable"
    top = sorted(available, key=lambda entry: entry["score"], reverse=True)[:3]
    coverage_note = f"{len(available)} of {len(items)} signals have score inputs. "
    coverage_note += "The overall score is their equal-weight mean; unavailable signals are excluded, not scored as zero."
    if len(available) != len(items):
        coverage_note += " This incomplete screen is not directly comparable with a full-coverage score or a different available-signal set."
    summary = (f"The current macro risk screen is {overall_level}, based on {len(available)} of {len(items)} signals. The highest-pressure available signals are {', '.join(entry['label'] for entry in top)}."
               if available else "Unavailable: no signals have all required score inputs. The dashboard cannot calculate an overall pressure screen.")
    return {
        "generatedAt": generated_at,
        "status": "unavailable" if not available else "fresh" if len(available) == len(items) and all(entry["dataStatus"] == "fresh" for entry in items) else "partial",
        "overallScore": average,
        "overallLevel": overall_level,
        "availableCount": len(available),
        "totalCount": len(items),
        "coverageNote": coverage_note,
        "summary": summary,
        "method": "Deterministic rules use the stated latest-level and market/trade/demand inputs. Recent core changes and FX historical percentiles are supporting context, not score inputs. The overall score is the equal-weight mean of available signals. Scores are descriptive screens, not forecasts or causal estimates.",
        "items": items,
    }


def build_latest_brief(series: dict[str, dict], forecast_data: dict, market: dict, growth_drivers: dict, external: dict, risk: dict, generated_at: str) -> dict:
    headline_points = series.get("headline", {}).get("points", [])
    latest_headline, headline_period = _risk_latest(series.get("headline", {}))
    prior_headline = _risk_number(headline_points[-2].get("value")) if len(headline_points) >= 2 else None
    headline_change = latest_headline - prior_headline if latest_headline is not None and prior_headline is not None else None
    core, _ = _risk_latest(series.get("core", {}))
    headline_text = f"{latest_headline:.1f}%" if latest_headline is not None else "Unavailable"
    core_text = f"{core:.1f}%" if core is not None else "Unavailable"
    fx_change = _series_change(series.get("fx", {}), 3)
    forecast_points = forecast_data.get("points", [])
    forecast_target = _risk_number(forecast_points[-1].get("value")) if forecast_points else None
    watched = sorted((entry for entry in risk["items"] if _risk_number(entry.get("score")) is not None), key=lambda entry: entry["score"], reverse=True)[:3]
    market_return = _risk_number(market.get("summary", {}).get("return1Y"))
    trade_balance = _risk_number(external.get("summary", {}).get("balance"))
    market_text = f"{market_return:+.1f}%" if market_return is not None else "Unavailable (insufficient valid one-year data)"
    trade_text = f"RM {trade_balance:+.1f} billion" if trade_balance is not None else "Unavailable (missing valid trade observation)"
    pressure_text = f"Malaysia's latest macro reading is {risk['overallLevel']} pressure" if risk.get("overallScore") is not None else "Malaysia's overall macro pressure reading is unavailable"
    return {
        "generatedAt": generated_at,
        "status": risk["status"],
        "period": headline_period,
        "headline": f"{pressure_text}, with headline inflation at {headline_text} and core inflation at {core_text}.",
        "whatChanged": [
            f"Headline inflation moved {headline_change:+.1f} percentage points from the prior monthly release." if headline_change is not None else "Headline inflation's monthly change is Unavailable: valid current and prior observations are required.",
            f"The ringgit moved {fx_change:+.2f} against the US dollar over the latest three-month dashboard window." if fx_change is not None else "The ringgit's three-month change is Unavailable: the comparison requires valid observations in both calendar months.",
            f"The FBM KLCI one-year price return is {market_text}, while the latest goods trade balance is {trade_text}.",
        ],
        "whyItMayHaveHappened": [
            "Inflation changes can reflect category-level CPI pressure, policy effects, administered prices and imported costs.",
            "Exchange-rate and bond-yield changes may reflect both Malaysian conditions and global interest-rate or risk-appetite shifts.",
            "GDP and trade readings help separate domestic demand from external demand, but they are not causal proof for market moves.",
        ],
        "watchNext": [f"{entry['label']}: {entry['watch']}" for entry in watched] or ["Risk signals are unavailable; wait for valid source observations before drawing an overall pressure conclusion."],
        "coverageNote": risk.get("coverageNote", ""),
        "implications": [
            "Individuals should stress-test savings, debt repayments and job resilience against the highest-pressure signals.",
            "Companies should review pricing, cash flow, FX exposure and hiring plans using their own contracts and margins.",
            f"The three-month inflation forecast ends at {forecast_target:.2f}%, but the prediction intervals are more important than the point estimate." if forecast_target is not None else "The three-month inflation forecast is Unavailable; do not substitute a zero forecast or draw a forecast-based conclusion.",
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
    market_summary = market.get("summary", {})
    market_return = _risk_number(market_summary.get("return1Y"))
    market_volatility = _risk_number(market_summary.get("annualizedVolatility1Y"))
    market_return_text = f"{market_return:+.1f}%" if market_return is not None else "Unavailable"
    volatility_text = f"{market_volatility:.1f}%" if market_volatility is not None else "Unavailable"
    trade_summary = (external or {}).get("summary", {})
    goods_imports = _risk_number(trade_summary.get("imports"))
    goods_import_growth = _risk_number(trade_summary.get("importsYoY"))
    imports_text = f"RM {goods_imports:.1f} billion" if goods_imports is not None else "Unavailable"
    import_growth_text = f"{goods_import_growth:+.1f}%" if goods_import_growth is not None else "Unavailable"
    available_risk = sorted((entry for entry in (risk or {}).get("items", []) if _risk_number(entry.get("score")) is not None), key=lambda entry: entry["score"], reverse=True)
    heatmap_evidence = (f"The current heatmap is {risk['overallLevel']} pressure, led by {', '.join(entry['label'] for entry in available_risk[:2])}."
                        if risk and available_risk else "The current heatmap pressure reading is Unavailable; valid score inputs are required before setting macro risk triggers.")

    inflation_reading = "positive but moderate" if 0 < headline < 3 else "elevated" if headline >= 3 else "very weak or negative"
    rate_reading = "Borrowing still carries a meaningful financing cost" if opr >= 2.5 else "Policy rates are comparatively accommodative"
    labour_reading = "The national unemployment rate is relatively low" if unemployment < 4 else "Labour-market slack is elevated"
    market_reading = "unavailable" if market_return is None else "positive" if market_return > 3 else "negative" if market_return < -3 else "broadly flat"

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
            "evidence": f"The FBM KLCI's latest one-year price return is {market_return_text} and its measured one-year volatility is {volatility_text}.",
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
            "evidence": f"The dashboard heatmap labels policy-rate pressure as {next((item['level'] for item in (risk or {}).get('items', []) if item['id'] == 'opr'), 'unavailable')} and 10-year MGS pressure as {next((item['level'] for item in (risk or {}).get('items', []) if item['id'] == 'mgs'), 'unavailable')}.",
            "actions": ["List every debt repayment date, rate type and reset date.", "Check whether a higher instalment still leaves room for essentials and emergency savings.", "Avoid using short-term promotional rates as the only affordability test."],
            "watch": "Lending rates depend on individual credit profile, bank policy and product terms, not only national benchmark rates.",
        },
        {
            "id": "imported-costs", "theme": "Daily prices and imported goods", "stance": "Compare baskets",
            "title": "Watch imported-cost pressure in your own spending",
            "evidence": f"USD/MYR is RM {fx:.4f}; latest goods imports: {imports_text}.",
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
            "evidence": f"Unemployment is {unemployment:.1f}% and the KLCI's latest one-year price performance is {market_reading}: {market_return_text}.",
            "actions": ["Prioritise roles tied to bottlenecks, revenue quality or measurable productivity gains.", "Stage capital projects with decision gates instead of treating broad market optimism as demand proof.", "Model downside demand, financing and FX assumptions before approving irreversible expenditure."],
            "watch": "A stock index and national unemployment rate are broad signals, not company-specific revenue forecasts.",
        },
        {
            "id": "inventory-imports", "theme": "Inventory and import exposure", "stance": "Stress landed cost",
            "title": "Tie inventory decisions to FX and trade evidence",
            "evidence": f"Goods imports year-on-year change: {import_growth_text}, while USD/MYR is RM {fx:.4f}.",
            "actions": ["Separate essential stock buffers from speculative over-ordering.", "Reprice landed cost assumptions using adverse FX and freight scenarios.", "Review supplier currency, payment timing and contract pass-through clauses."],
            "watch": "Trade aggregates do not reveal firm-level demand, supplier reliability or margin quality.",
        },
        {
            "id": "business-risk-gates", "theme": "Scenario governance", "stance": "Use triggers",
            "title": "Set decision gates around the highest-risk signals",
            "evidence": heatmap_evidence,
            "actions": ["Define measurable triggers before hiring, capex, refinancing or price changes.", "Assign owners for inflation, FX, cash-flow and sales indicators.", "Review decisions monthly after official releases instead of reacting to headlines."],
            "watch": "A heatmap is a monitoring tool; it cannot replace customer, supplier and balance-sheet evidence.",
        },
    ]

    return {
        "generatedAt": generated_at,
        "status": "fresh" if market.get("status") == "fresh" and market_return is not None and market_volatility is not None else "partial",
        "title": "Decision guide for the current Malaysian economy",
        "summary": f"Malaysia currently combines {headline:.1f}% headline inflation, a {opr:.2f}% OPR, {unemployment:.1f}% unemployment and a one-year KLCI price return of {market_return_text}. The useful response is disciplined scenario planning—not a single buy, sell or career instruction.",
        "signals": [
            {"label": "Headline inflation", "value": f"{headline:.1f}%", "period": headline_date, "reading": inflation_reading},
            {"label": "Core inflation", "value": f"{core:.1f}%", "period": core_date, "reading": "underlying price pressure"},
            {"label": "OPR", "value": f"{opr:.2f}%", "period": opr_date, "reading": "policy-rate setting"},
            {"label": "Unemployment", "value": f"{unemployment:.1f}%", "period": unemployment_date, "reading": labour_reading.lower()},
            {"label": "USD/MYR", "value": f"RM {fx:.4f}", "period": fx_date, "reading": "ringgit cost of one US dollar"},
            {"label": "10-year MGS", "value": f"{mgs:.2f}%", "period": mgs_date, "reading": "long-term government benchmark yield"},
            {"label": "KLCI 1-year", "value": market_return_text, "period": market_summary.get("latestDate", ""), "reading": f"{market_reading} price performance"},
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
    try:
        headline, core, categories = fetch_cpi()
        cpi_loaders = {"headline": lambda: headline, "core": lambda: core}
    except Exception as error:
        if not previous or not previous.get("categories"):
            raise
        categories = copy.deepcopy(previous["categories"])

        # Bind the error outside the exception block; Python clears the exception
        # target when leaving that block, while loaders execute afterwards.
        cpi_error = error

        def unavailable_cpi():
            raise RuntimeError("CPI refresh failed; using last valid CPI release") from cpi_error

        cpi_loaders = {"headline": unavailable_cpi, "core": unavailable_cpi}
    loaders: dict[str, Callable[[], list[dict]]] = {
        **cpi_loaders,
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
        forecast_data["calculatedAt"] = retrieved
    except Exception as error:
        if not previous:
            raise
        forecast_data = previous["forecast"]
        forecast_data = {**forecast_data, "status": "stale", "calculationStatus": "stale", "message": f"Forecast retained after {type(error).__name__}"}
    forecast_data.setdefault("status", "fresh")
    structural_data = build_structural_analysis(series, previous, retrieved)
    market_data = build_market(previous, retrieved)
    economic_structure = build_economic_structure(previous, retrieved)
    growth_drivers = build_growth_drivers(previous, retrieved, economic_structure)
    external_sector = build_external_sector(previous, retrieved)
    balance_payments = build_balance_payments(previous, retrieved)
    regional_lens = build_regional_lens(previous, retrieved)
    risk_heatmap = build_risk_heatmap(series, market_data, growth_drivers, external_sector, retrieved)
    latest_brief = build_latest_brief(series, forecast_data, market_data, growth_drivers, external_sector, risk_heatmap, retrieved)
    household_pressure = build_household_pressure(series, market_data, risk_heatmap, retrieved)
    sector_deep_dive = build_sector_deep_dive(growth_drivers, market_data, external_sector, retrieved)
    macro_timeline = build_macro_timeline(series, structural_data, market_data, retrieved)
    payload = {
        "schemaVersion": 9,
        "generatedAt": retrieved,
        "health": "fresh" if all(source["status"] == "fresh" for source in sources.values()) and market_data["status"] == "fresh" and economic_structure["status"] == "fresh" and external_sector["status"] == "fresh" and growth_drivers["status"] == "fresh" and balance_payments["status"] == "fresh" and regional_lens["status"] == "fresh" else "partial",
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
        "balancePayments": balance_payments,
        "regionalLens": regional_lens,
        "householdPressure": household_pressure,
        "sectorDeepDive": sector_deep_dive,
        "macroTimeline": macro_timeline,
        "riskHeatmap": risk_heatmap,
        "latestBrief": latest_brief,
        "decisionGuide": build_decision_guide(series, market_data, retrieved, risk_heatmap, external_sector),
        "dataOperations": build_data_operations(series, retrieved),
        "narratives": narrative(series, forecast_data),
    }
    payload["monthlyReport"] = build_monthly_report(payload, retrieved)
    finalize_data_trust(payload)
    payload["dataHealth"] = build_data_health(payload, retrieved)
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
        candidate.get("balancePayments", {}).pop("retrievedAt", None)
        baseline.get("balancePayments", {}).pop("retrievedAt", None)
        candidate.get("regionalLens", {}).pop("generatedAt", None)
        baseline.get("regionalLens", {}).pop("generatedAt", None)
        candidate.get("growthDrivers", {}).pop("generatedAt", None)
        baseline.get("growthDrivers", {}).pop("generatedAt", None)
        candidate.get("riskHeatmap", {}).pop("generatedAt", None)
        baseline.get("riskHeatmap", {}).pop("generatedAt", None)
        candidate.get("latestBrief", {}).pop("generatedAt", None)
        baseline.get("latestBrief", {}).pop("generatedAt", None)
        candidate.get("householdPressure", {}).pop("generatedAt", None)
        baseline.get("householdPressure", {}).pop("generatedAt", None)
        candidate.get("sectorDeepDive", {}).pop("generatedAt", None)
        baseline.get("sectorDeepDive", {}).pop("generatedAt", None)
        candidate.get("macroTimeline", {}).pop("generatedAt", None)
        baseline.get("macroTimeline", {}).pop("generatedAt", None)
        candidate.get("dataHealth", {}).pop("generatedAt", None)
        baseline.get("dataHealth", {}).pop("generatedAt", None)
        candidate.get("monthlyReport", {}).pop("generatedAt", None)
        baseline.get("monthlyReport", {}).pop("generatedAt", None)
        if candidate == baseline:
            return previous
    return payload


REGIONAL_CSV_FIELDS = ["level", "state", "district", "metric", "value", "unit", "observation_period", "source_url", "data_status", "retrieved_at"]


def regional_export_rows(regional: dict) -> list[dict]:
    """Long-form export parity with the app: each value carries its own provenance."""
    rows = []
    sources = regional.get("sources", {})
    household_unit = "RM per household per month"
    gdp_unit = "RM billion (constant 2015 prices)"
    hies_units = {"incomeMean": household_unit, "incomeMedian": household_unit,
                  "expenditureMean": household_unit, "incomeMinusExpenditure": household_unit,
                  "incomeToExpenditureRatio": "ratio", "poverty": "%", "gini": "coefficient"}

    def add(level, state, district, metric, value, unit, period, source, district_gdp=False, source_url=None):
        if isinstance(value, bool) or value is None:
            return
        if isinstance(value, (int, float)):
            if not math.isfinite(value):
                return
        elif not isinstance(value, str) or not value.strip():
            return
        if source_url is None:
            source_url = (source.get("districtSourceUrl") or source.get("districtDatasetUrl") or "") if district_gdp else (source.get("sourceUrl") or source.get("datasetUrl") or "")
        rows.append({"level": level, "state": state, "district": district, "metric": metric, "value": value,
                     "unit": unit, "observation_period": period or "", "source_url": source_url,
                     "data_status": source.get("status", "unknown"), "retrieved_at": source.get("retrievedAt") or ""})

    def add_gdp(level, state, district, item, period, district_gdp=False):
        source = sources.get("gdpDistrict" if district_gdp else "gdpState") or sources.get("gdp", {})
        if district_gdp and sources.get("gdpDistrict"):
            source = {**source, "districtSourceUrl": source.get("sourceUrl"), "districtDatasetUrl": source.get("datasetUrl")}
        add(level, state, district, "realGdp", item.get("total") if district_gdp else item.get("realGdp"), gdp_unit, period, source, district_gdp)
        add(level, state, district, "largestSector", item.get("largestSector"), "sector", period, source, district_gdp)
        add(level, state, district, "largestSectorShare", item.get("largestSectorShare"), "%", period, source, district_gdp)
        for sector in item.get("sectors" if district_gdp else "sectorShares", []):
            add(level, state, district, f"sector.{sector['id']}.value", sector.get("value"), gdp_unit, period, source, district_gdp)
            add(level, state, district, f"sector.{sector['id']}.share", sector.get("share"), "%", period, source, district_gdp)

    for state in sorted(regional.get("stateRecords", []), key=lambda item: item["state"]):
        for metric, unit in hies_units.items():
            add("state", state["state"], "", metric, state.get(metric), unit, state.get("date"), sources.get("hiesState", {}))
        add("state", state["state"], "", "headlineInflation", state.get("headlineInflation"), "%", state.get("inflationPeriod") or sources.get("cpi", {}).get("observationPeriod"), sources.get("cpi", {}))
        add("state", state["state"], "", "unemploymentRate", state.get("unemploymentRate"), "%", state.get("labourPeriod") or sources.get("labour", {}).get("observationPeriod"), sources.get("labour", {}))
        add_gdp("state", state["state"], "", state, state.get("gdpPeriod") or sources.get("gdp", {}).get("observationPeriod"))

    def district_index(records):
        index, ambiguous = {}, set()
        for item in records:
            geography = normalize_regional_geography(item["state"], item["district"])
            key = (geography["state"], geography["district"])
            if key in ambiguous:
                continue
            if key in index:
                index.pop(key)
                ambiguous.add(key)
            else:
                index[key] = item
        return index
    district_hies = district_index(regional.get("districtRecords", []))
    district_labour = district_index(regional.get("districtLabourRecords", []))
    district_gdp = district_index(regional.get("districtGdpRecords", []))
    for state, district in sorted(district_hies.keys() | district_labour.keys() | district_gdp.keys()):
        survey = district_hies.get((state, district), {})
        labour = district_labour.get((state, district), {})
        gdp = district_gdp.get((state, district), {})
        level = "district_residual" if normalize_regional_geography(state, district)["kind"] == "residual" else "district"
        for metric, unit in hies_units.items():
            add(level, state, district, metric, survey.get(metric), unit, survey.get("date"), sources.get("hiesDistrict", {}))
        # No state CPI substitution: this dataset has no district CPI observations.
        for metric in ["unemploymentRate", "participationRate", "employmentPopulationRatio"]:
            add(level, state, district, metric, labour.get(metric), "%", labour.get("date"), sources.get("labour", {}))
        add(level, state, district, "labourForce", labour.get("labourForce"), "thousand persons", labour.get("date"), sources.get("labour", {}))
        add_gdp(level, state, district, gdp, gdp.get("date"), True)

    groups = regional.get("incomeGroups", {})
    def add_groups(level, state, period, records, national=False):
        source_url = groups.get("nationalDatasetUrl", "") if national else groups.get("sourceUrl") or groups.get("stateDatasetUrl") or ""
        for group in records:
            for field in ["meanIncome", "medianIncome", "minIncome", "maxIncome", "vsNationalMean", "percentileRange"]:
                add(level, state, "", f"incomeGroup.{group['id']}.{field}", group.get(field), "percentiles" if field == "percentileRange" else household_unit, period, groups, source_url=source_url)
    for state_group in groups.get("stateGroups", []):
        add_groups("state_income_group", state_group["state"], state_group.get("date"), state_group.get("groups", []))
    add_groups("national_income_group", "Malaysia", groups.get("observationPeriod"), groups.get("nationalGroups", []), True)
    return rows


def write_regional_exports(regional: dict) -> None:
    REGIONAL_JSON.parent.mkdir(parents=True, exist_ok=True)
    regional_json = json.dumps(regional, indent=2, ensure_ascii=False) + "\n"
    if not REGIONAL_JSON.exists() or REGIONAL_JSON.read_text(encoding="utf-8") != regional_json:
        REGIONAL_JSON.write_text(regional_json, encoding="utf-8")
    with REGIONAL_CSV.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=REGIONAL_CSV_FIELDS, lineterminator="\n")
        writer.writeheader()
        for row in regional_export_rows(regional):
            # Protect text cells against spreadsheet formulas, preserving negative numbers.
            writer.writerow({key: "'" + value if isinstance(value, str) and re.match(r"^\s*[=+\-@]", value) else value for key, value in row.items()})


def recompute_risk_offline(previous: dict, calculated_at: str) -> dict:
    """Correct risk-derived calculations without claiming a new official retrieval."""
    payload = copy.deepcopy(previous)
    payload["riskHeatmap"] = build_risk_heatmap(payload["series"], payload.get("market", {}), payload.get("growthDrivers", {}), payload.get("externalSector", {}), calculated_at)
    payload["latestBrief"] = build_latest_brief(payload["series"], payload["forecast"], payload.get("market", {}), payload.get("growthDrivers", {}), payload.get("externalSector", {}), payload["riskHeatmap"], calculated_at)
    payload["recomputation"] = {"mode": "offline-risk-recompute", "sourceRefresh": False, "calculatedAt": calculated_at,
        "note": "Risk scores and brief recalculated from saved validated observations; official periods and retrieval clocks are unchanged."}
    return finalize_data_trust(payload)


def recompute_forecast_offline(previous: dict, calculated_at: str) -> dict:
    """Recalculate from saved validated observations without implying a retrieval."""
    payload = copy.deepcopy(previous)
    for key in SPECS:
        validate_points(key, payload["series"][key]["points"])
    calculated = forecast({key: payload["series"][key]["points"] for key in SPECS})
    calculated["calculatedAt"] = calculated_at
    if previous.get("forecast", {}).get("vintageLedger"):
        calculated["vintageLedger"] = copy.deepcopy(previous["forecast"]["vintageLedger"])
    else:
        # The offline calculation must not backdate source observations or create
        # forecast issues. Publish an honest empty ledger state until the next
        # normal pipeline run records newly retrieved, validated inputs.
        calculated["vintageLedger"] = {
            "version": 1, "status": "waiting", "freshSourceCount": 0, "requiredSourceCount": len(SPECS),
            "sourceSnapshotCount": 0, "revisedSourcePeriodCount": 0, "prospectiveForecastCount": 0,
            "capturedOutcomeCount": 0, "pendingForecastTargetCount": 0, "firstSnapshotAt": None,
            "lastSnapshotAt": None,
            "note": "Append-only source and forecast records start with validated live retrievals after this ledger was introduced. Legacy CPI files are retained but are not represented as release vintages. Outcome capture records the first value seen by this ledger; official first-release status is unverified.",
        }
    calculated["recomputation"] = {"mode": "offline", "sourceRefresh": False, "note": "Forecast and affected text recalculated from the saved validated series; official observations, source status and retrieval timestamps are unchanged."}
    finalize_data_trust({"sources": payload.get("sources", {}), "forecast": calculated})
    payload["forecast"] = calculated
    payload.setdefault("narratives", {})["forecast"] = narrative(payload["series"], calculated)["forecast"]
    for section in payload.get("monthlyReport", {}).get("sections", []):
        if section.get("heading") == "Forecast":
            section["body"] = payload["narratives"]["forecast"]
    if payload.get("monthlyReport"):
        payload["monthlyReport"]["calculatedAt"] = calculated_at
    if payload.get("latestBrief"):
        implications = payload["latestBrief"].get("implications", [])
        for index, implication in enumerate(implications):
            if "three-month inflation forecast" in implication:
                implications[index] = f"The three-month inflation forecast ends at {calculated['points'][-1]['value']:.2f}%, but the prediction intervals are more important than the point estimate."
        payload["latestBrief"]["calculatedAt"] = calculated_at
    return payload


def recompute_regional_gdp_offline(previous: dict, state_frame: pd.DataFrame, district_frame: pd.DataFrame, calculated_at: str) -> dict:
    """Bounded correction from explicit saved official inputs; no fetch or forecast fit."""
    payload = copy.deepcopy(previous)
    regional = payload["regionalLens"]
    old_gdp = regional["sources"]["gdp"]
    # Keep the existing source retrieval clock; local validation has its own clock.
    gdp = parse_regional_gdp(state_frame, district_frame, old_gdp.get("retrievedAt"))
    source = {**copy.deepcopy(old_gdp), **gdp, "status": old_gdp.get("status", "unavailable"),
              "sourceValidatedAt": calculated_at,
              "message": "Saved official GDP inputs validated locally; null/missing sectors corrected without a new pipeline retrieval"}
    regional["sources"]["gdp"] = source
    by_state = {normalize_regional_geography(item["state"], "")["state"]: item for item in gdp["stateRecords"]}
    for item in regional.get("stateRecords", []):
        record = by_state.get(normalize_regional_geography(item["state"], "")["state"], {})
        item.update({"realGdp": record.get("total"), "gdpPeriod": record.get("date"),
                     "largestSector": record.get("largestSector"), "largestSectorShare": record.get("largestSectorShare"),
                     "sectorShares": copy.deepcopy(record.get("sectors", []))})
    regional["districtGdpRecords"] = copy.deepcopy(gdp["districtRecords"])
    regional["calculatedAt"] = calculated_at
    regional["recomputation"] = {"mode": "offline-regional-gdp-correction", "sourceRefresh": False,
        "note": "Only GDP-derived regional records/exports were reparsed from explicit saved official source files. Official nulls and absent sector codes remain unavailable, genuine zeros remain observed, shares use official p0 totals, and Supra is a GDP residual. Other official inputs, forecasts and retrieval timestamps are unchanged; this is not a full dashboard refresh."}
    for indicator in payload.get("structuralBreaks", {}).get("indicators", {}).values():
        if isinstance(indicator.get("candidates"), list) and indicator.get("status") != "unavailable":
            indicator["narrative"] = structural_indicator_narrative(indicator["candidates"])
    # Revalidate unchanged national observations and assert correction scope before saving.
    for key in SPECS:
        validate_points(key, payload["series"][key]["points"])
    if any(payload[key] != previous[key] for key in previous if key not in {"regionalLens", "structuralBreaks"}):
        raise ValueError("Bounded GDP correction changed an unrelated dashboard section")
    return payload


def regional_gdp_validation_counts(frame: pd.DataFrame, records: list[dict]) -> dict:
    """Descriptive counts for the already validated latest absolute-level source."""
    selected = frame[frame["series"].eq("abs")].copy()
    dates = pd.to_datetime(selected["date"], errors="raise")
    selected = selected[dates.eq(dates.max()) & selected["sector"].isin(GDP_SECTORS)].copy()
    values = pd.to_numeric(selected["value"], errors="raise")
    sectors = [sector for record in records for sector in record["sectors"]]
    return {"observationPeriod": dates.max().strftime("%Y-%m-%d"), "sourceSectorRows": len(selected),
            "sourceNullSectorRows": int(values.isna().sum()), "sourceZeroSectorRows": int(values.eq(0).sum()),
            "retainedSuppressedOrUnavailableSectorRows": sum(sector["valueStatus"] == "suppressed-or-unavailable" for sector in sectors),
            "retainedNotPublishedSectorRows": sum(sector["valueStatus"] == "not-published" for sector in sectors),
            "retainedObservedSectorRows": sum(sector["valueStatus"] == "observed" for sector in sectors)}


def _canonical_hash(value: object) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _write_immutable_json(path: Path, value: dict) -> bool:
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with path.open("x", encoding="utf-8", newline="\n") as handle:
            json.dump(value, handle, indent=2, ensure_ascii=False, allow_nan=False)
            handle.write("\n")
        return True
    except FileExistsError:
        return False


def record_vintage_ledger(payload: dict, root: Path | None = None) -> dict:
    """Append source revisions and strictly prospective forecasts; never rewrite old snapshots."""
    ledger = root or (VINTAGES / "ledger-v1")
    generated_at = payload.get("generatedAt")
    try:
        run_clock = datetime.fromisoformat(str(generated_at).replace("Z", "+00:00"))
        if run_clock.tzinfo is None:
            raise ValueError("run time must be timezone aware")
    except (TypeError, ValueError):
        run_clock = None
    series = payload.get("series", {})
    sources = payload.get("sources", {})
    source_ids: dict[str, str] = {}
    fresh_sources = 0
    snapshots_dir = ledger / "sources"
    for key in SPECS:
        meta = sources.get(key, {})
        data = series.get(key, {})
        retrieved_at = meta.get("retrievedAt")
        attempted_at = meta.get("lastAttemptAt")
        # Only capture a source fetched and accepted during this pipeline run.
        # Retained, stale, fallback, offline-recomputed, or old legacy clocks do not qualify.
        if (run_clock is None or meta.get("status") != "fresh" or not retrieved_at
                or retrieved_at != attempted_at or retrieved_at != generated_at):
            continue
        points = data.get("points")
        if not isinstance(points, list) or not points or not data.get("source_url") or not data.get("unit"):
            continue
        try:
            clean_points = validate_points(key, points)
        except (KeyError, TypeError, ValueError):
            continue
        period = meta.get("observationPeriod")
        if period != clean_points[-1]["date"]:
            continue
        content = {
            "source": key, "observationPeriod": period, "unit": data["unit"],
            "frequency": data.get("frequency", SPECS[key].frequency), "sourceUrl": data["source_url"],
            "observations": clean_points,
        }
        digest = _canonical_hash(content)
        snapshot_id = f"{key}:{period}:{digest}"
        record = {
            "ledgerVersion": 1, "snapshotId": snapshot_id, "contentHash": digest,
            **content, "retrievedAt": retrieved_at, "attemptedAt": attempted_at,
            "recordedAt": generated_at,
        }
        path = snapshots_dir / key / f"{period}--{digest}.json"
        _write_immutable_json(path, record)
        source_ids[key] = snapshot_id
        fresh_sources += 1

    # Issue records are prospective only when all six inputs were freshly fetched
    # at this run's clock, a complete model fit succeeded, and all targets are future.
    forecast = payload.get("forecast", {})
    evaluation = forecast.get("evaluation", {})
    final_fit = evaluation.get("finalFit", {})
    issue_month = str(generated_at)[:7] if isinstance(generated_at, str) else ""
    forecast_points = forecast.get("points", [])
    issue_ready = (
        run_clock is not None and fresh_sources == len(SPECS) and not payload.get("usingFallback", False)
        and forecast.get("status") == "fresh" and forecast.get("calculationStatus") != "fallback"
        and forecast.get("calculatedAt") == generated_at and isinstance(final_fit, dict)
        and final_fit.get("fallbackUsed") is False and len(forecast_points) == 3
        and all(isinstance(point.get("date"), str) and point["date"][:7] > issue_month for point in forecast_points)
        and set(source_ids) == set(SPECS)
    )
    forecast_dir = ledger / "forecasts"
    if issue_ready:
        model = next((item for item in forecast.get("models", []) if item.get("name") == forecast.get("selectedModel")), None)
        issue_content = {
            "issueDate": str(generated_at)[:10], "targetMonths": [point["date"] for point in forecast_points],
            "selectedModel": forecast.get("selectedModel"), "modelScore": model,
            "forecastPoints": forecast_points, "methodLabel": forecast.get("methodLabel"),
            "sourceSnapshots": {key: source_ids[key] for key in sorted(source_ids)},
            "originPolicy": evaluation.get("originPolicy"),
        }
        digest = _canonical_hash(issue_content)
        forecast_id = f"{issue_content['issueDate']}:{digest}"
        _write_immutable_json(forecast_dir / f"{issue_content['issueDate']}--{digest}.json", {
            "ledgerVersion": 1, "forecastId": forecast_id, "contentHash": digest,
            **issue_content, "issuedAt": generated_at,
            "warning": "Prospective model issue captured by this ledger. This is not a historical first-release vintage before its recorded issue time.",
        })

    # Record the first value this ledger sees for each forecast target. Source
    # revisions create additional immutable outcome files; first official release
    # status is explicitly unverified because DOSM release-vintage timestamps are unavailable.
    headline_meta = sources.get("headline", {})
    headline_snapshot = source_ids.get("headline")
    headline_values = {point["date"]: point["value"] for point in series.get("headline", {}).get("points", []) if isinstance(point, dict) and isinstance(point.get("date"), str)}
    outcome_dir = ledger / "outcomes"
    if headline_snapshot and headline_meta.get("status") == "fresh":
        for issue_path in forecast_dir.glob("*.json"):
            try:
                issue = json.loads(issue_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            for target in issue.get("targetMonths", []):
                value = headline_values.get(target)
                if value is None or target[:7] <= issue.get("issueDate", "")[:7]:
                    continue
                outcome_content = {
                    "forecastId": issue.get("forecastId"), "targetMonth": target,
                    "actualHeadlineInflation": value, "unit": "%", "sourceUrl": series["headline"]["source_url"],
                }
                outcome_hash = _canonical_hash(outcome_content)
                issue_digest = str(issue["forecastId"]).split(":", 1)[-1]
                _write_immutable_json(outcome_dir / issue_digest[:24] / f"{target}--{outcome_hash[:32]}.json", {
                    "ledgerVersion": 1, "contentHash": outcome_hash, **outcome_content,
                    "firstCapturedAt": headline_meta.get("retrievedAt"),
                    "headlineSnapshotId": headline_snapshot,
                    "firstOfficialReleaseVerified": False,
                    "warning": "First value captured by this ledger, not verified as DOSM's unrevised first release.",
                })

    source_files = list(snapshots_dir.glob("*/*.json"))
    source_periods: dict[tuple[str, str], set[str]] = {}
    captured_times = []
    for path in source_files:
        try:
            record = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        source_periods.setdefault((record.get("source", ""), record.get("observationPeriod", "")), set()).add(record.get("contentHash", ""))
        if isinstance(record.get("recordedAt"), str):
            captured_times.append(record["recordedAt"])
    issues = list(forecast_dir.glob("*.json"))
    outcomes = list(outcome_dir.glob("*/*.json"))
    pending = set()
    for path in issues:
        try:
            issue = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        issue_id = issue.get("forecastId")
        observed = set()
        for outcome_path in (outcome_dir / str(issue_id).split(":", 1)[-1][:24]).glob("*.json"):
            try:
                observed.add(json.loads(outcome_path.read_text(encoding="utf-8")).get("targetMonth"))
            except (OSError, json.JSONDecodeError):
                continue
        pending.update((issue_id, target) for target in issue.get("targetMonths", []) if target not in observed)
    return {
        "version": 1, "status": "collecting" if fresh_sources == len(SPECS) else "partial" if fresh_sources else "waiting",
        "freshSourceCount": fresh_sources, "requiredSourceCount": len(SPECS),
        "sourceSnapshotCount": len(source_files),
        "revisedSourcePeriodCount": sum(1 for hashes in source_periods.values() if len(hashes) > 1),
        "prospectiveForecastCount": len(issues), "capturedOutcomeCount": len(outcomes),
        "pendingForecastTargetCount": len(pending), "firstSnapshotAt": min(captured_times) if captured_times else None,
        "lastSnapshotAt": max(captured_times) if captured_times else None,
        "note": "Append-only source and forecast records start with validated live retrievals after this ledger was introduced. Legacy CPI files are retained but are not represented as release vintages. Outcome capture records the first value seen by this ledger; official first-release status is unverified.",
    }


def write_payload(payload: dict, output: Path = PUBLISHED) -> bool:
    output.parent.mkdir(parents=True, exist_ok=True)
    VINTAGES.mkdir(parents=True, exist_ok=True)
    if isinstance(payload.get("forecast"), dict) and all(key in payload.get("series", {}) for key in SPECS):
        payload["forecast"]["vintageLedger"] = record_vintage_ledger(payload)
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
    write_regional_exports(payload.get("regionalLens", {}))
    return changed


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=PUBLISHED)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--recompute-forecast", action="store_true", help="Recalculate only forecast/affected narratives offline; preserve observations and source retrieval metadata")
    modes.add_argument("--recompute-risk", action="store_true", help="Recalculate risk/brief offline without changing official observations or retrieval clocks")
    modes.add_argument("--recompute-regional-gdp", action="store_true", help="Correct only regional GDP from explicit saved official CSV inputs; no network fetch or forecast fitting")
    parser.add_argument("--gdp-state-input", type=Path)
    parser.add_argument("--gdp-district-input", type=Path)
    args = parser.parse_args()
    if args.recompute_risk:
        previous = json.loads(args.output.read_text(encoding="utf-8"))
        calculated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        payload = recompute_risk_offline(previous, calculated_at)
        args.output.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(json.dumps({"mode": "offline-risk-recompute", "sourceRefresh": False, "calculatedAt": calculated_at, "availableCount": payload["riskHeatmap"]["availableCount"]}))
        return
    if args.recompute_regional_gdp:
        if args.gdp_state_input is None or args.gdp_district_input is None:
            parser.error("--recompute-regional-gdp requires --gdp-state-input and --gdp-district-input saved CSV files")
        previous = json.loads(args.output.read_text(encoding="utf-8"))
        calculated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        state_frame, district_frame = pd.read_csv(args.gdp_state_input), pd.read_csv(args.gdp_district_input)
        payload = recompute_regional_gdp_offline(previous, state_frame, district_frame, calculated_at)
        payload["regionalLens"]["sources"]["gdp"]["localInputVerification"] = {
            "sourceValidatedAt": calculated_at,
            "stateSha256": hashlib.sha256(args.gdp_state_input.read_bytes()).hexdigest(),
            "districtSha256": hashlib.sha256(args.gdp_district_input.read_bytes()).hexdigest(),
            "note": "Hashes identify explicit saved source files, not a new network retrieval by this command."}
        args.output.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        write_regional_exports(payload["regionalLens"])
        # Only deterministic interpretation text changes; saved break statistics are retained.
        STRUCTURAL_JSON.write_text(json.dumps(payload["structuralBreaks"], indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        gdp = payload["regionalLens"]["sources"]["gdp"]
        print(json.dumps({"mode": "offline-regional-gdp-correction", "sourceRefresh": False, "calculatedAt": calculated_at,
                          "originalGeneratedAt": payload["generatedAt"], "stateRecords": len(gdp["stateRecords"]),
                          "districtRecords": len(gdp["districtRecords"]), "administrativeDistrictCount": gdp["administrativeDistrictCount"],
                          "stateValidationCounts": regional_gdp_validation_counts(state_frame, gdp["stateRecords"] + gdp["stateResidualRecords"]),
                          "districtValidationCounts": regional_gdp_validation_counts(district_frame, gdp["districtRecords"])}))
        return
    if args.recompute_forecast:
        previous = json.loads(args.output.read_text(encoding="utf-8"))
        calculated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        payload = recompute_forecast_offline(previous, calculated_at)
        args.output.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        write_regional_exports(payload.get("regionalLens", {}))
        print(json.dumps({"mode": "offline-forecast-recompute", "sourceRefresh": False, "calculatedAt": calculated_at, "originalGeneratedAt": payload["generatedAt"], "selectedModel": payload["forecast"]["selectedModel"], "backtestWindows": payload["forecast"]["backtestWindows"]}))
        return
    payload = build(args.output)
    print(json.dumps({"changed": write_payload(payload, args.output), "generatedAt": payload["generatedAt"], "health": payload["health"]}))


if __name__ == "__main__":
    main()
