"""Source-local regional refresh behavior using real parsers, without network."""

import copy
import importlib.util
import sys
from pathlib import Path

import pandas as pd
import pytest

SPEC = importlib.util.spec_from_file_location("macrolens_regional_refresh", Path(__file__).parents[1] / "macrolens.py")
macrolens = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = macrolens
SPEC.loader.exec_module(macrolens)

OLD = "2026-09-01T00:00:00Z"
NOW = "2026-10-05T12:00:00Z"
SOURCE_IDS = ["hiesState", "hiesDistrict", "incomeGroupState", "incomeGroupNational", "labour", "gdpState", "gdpDistrict", "cpi", "nationalIncome", "nationalPoverty", "nationalInequality", "nationalExpenditure"]


def source_frames():
    states = macrolens.REGIONAL_STATE_NAMES
    hies = [{"date": "2024-01-01", "state": state, "income_mean": 8000 + index * 100,
             "income_median": 6000 + index * 100, "expenditure_mean": 4000 + index * 50,
             "gini": .35, "poverty": 2.0} for index, state in enumerate(states)]
    districts = [{**hies[index % 16], "district": f"District {index}"} for index in range(120)]
    percentile = [{"date": "2024-01-01", "state": state, "percentile": percentile,
                   "variable": "mean", "income": 1000 + state_index * 100 + percentile * 20}
                  for state_index, state in enumerate(states) for percentile in range(1, 101)]
    national_percentile = [{"date": "2024-01-01", "percentile": percentile, "variable": "mean", "income": 1200 + percentile * 20} for percentile in range(1, 101)]
    labour = [{"state": states[index % 16], "district": f"District {index}", "date": "2025-01-01",
               "lf": 100, "lf_employed": 97, "lf_unemployed": 3, "p_rate": 70,
               "u_rate": 3, "ep_ratio": 68} for index in range(120)]
    state_gdp = [{"series": "abs", "state": state, "date": "2025-01-01", "sector": sector, "value": 100000 if sector == "p0" else 10000} for state in states for sector in ["p0", *macrolens.GDP_SECTORS]]
    district_gdp = [{"series": "abs", "state": states[index % 16], "district": f"District {index}", "date": "2020-01-01", "sector": sector, "value": 1000 if sector == "p0" else 100} for index in range(120) for sector in ["p0", *macrolens.GDP_SECTORS]]
    return {
        "hiesState": pd.DataFrame(hies), "hiesDistrict": pd.DataFrame(districts),
        "incomeGroupState": pd.DataFrame(percentile), "incomeGroupNational": pd.DataFrame(national_percentile),
        "labour": pd.DataFrame(labour), "gdpState": pd.DataFrame(state_gdp), "gdpDistrict": pd.DataFrame(district_gdp),
        "cpi": pd.DataFrame([{"date": "2026-08-01", "state": state, "division": "overall", "inflation_yoy": 1.5} for state in states]),
        "nationalIncome": pd.DataFrame([{"date": "2024-01-01", "income_mean": 9000, "income_median": 7000}]),
        "nationalPoverty": pd.DataFrame([{"date": "2024-01-01", "poverty_absolute": 5.1}]),
        "nationalInequality": pd.DataFrame([{"date": "2024-01-01", "gini": .39}]),
    }


def install_sources(monkeypatch, *, failures=(), malformed=(), delta=0):
    frames = source_frames()
    frames["cpi"]["inflation_yoy"] += delta
    for key in ["hiesState", "hiesDistrict"]:
        frames[key]["income_mean"] += delta * 100
        frames[key]["income_median"] += delta * 100
    for key in ["incomeGroupState", "incomeGroupNational"]:
        frames[key]["income"] += delta * 100
    for key in ["gdpState", "gdpDistrict"]:
        frames[key].loc[frames[key]["sector"].eq("p0"), "value"] += delta * 100
    frames["labour"]["lf_unemployed"] += delta
    frames["labour"]["u_rate"] += delta
    frames["nationalIncome"]["income_mean"] += delta * 100
    frames["nationalIncome"]["income_median"] += delta * 100
    csv_ids = {
        macrolens.HIES_STATE_URL: "hiesState", macrolens.HIES_DISTRICT_URL: "hiesDistrict",
        macrolens.HIES_STATE_PERCENTILE_URL: "incomeGroupState", macrolens.HIES_NATIONAL_PERCENTILE_URL: "incomeGroupNational",
        macrolens.LFS_DISTRICT_URL: "labour", macrolens.GDP_STATE_REAL_URL: "gdpState", macrolens.GDP_DISTRICT_REAL_URL: "gdpDistrict",
    }
    catalogue_ids = {"cpi_state_inflation": "cpi", "hh_income": "nationalIncome", "hh_poverty": "nationalPoverty", "hh_inequality": "nationalInequality"}
    calls = []

    def load(key):
        calls.append(key)
        if key in failures:
            raise RuntimeError("private URL/password must never be exposed")
        if key in malformed:
            return pd.DataFrame([{"unexpected": "changed structure"}])
        return frames[key].copy(deep=True)

    def expenditure(year, retrieved, previous=None):
        calls.append("nationalExpenditure")
        if "nationalExpenditure" in failures:
            raise RuntimeError("private URL/password must never be exposed")
        if "nationalExpenditure" in malformed:
            return {"unexpected": "changed structure"}
        return {"status": "fresh", "value": 5566, "unit": "RM per household per month", "observationPeriod": f"{year}-01-01", "retrievedAt": retrieved,
                "sourceUrl": macrolens.HIES_EXPENDITURE_REPORT_URL.format(year=year), "message": "Validated official fixture"}

    monkeypatch.setattr(macrolens, "read_csv", lambda url: load(csv_ids[url]))
    monkeypatch.setattr(macrolens, "read_catalogue_json", lambda dataset_id, limit=100000: load(catalogue_ids[dataset_id]))
    monkeypatch.setattr(macrolens, "fetch_national_expenditure", expenditure)
    return calls


def test_all_sources_refresh_with_local_clocks_and_separate_gdp_periods(monkeypatch):
    calls = install_sources(monkeypatch)
    result = macrolens.build_regional_lens(None, NOW)
    assert result["status"] == "fresh"
    assert set(calls) == set(SOURCE_IDS)
    for key in SOURCE_IDS:
        assert result["sources"][key]["status"] == "fresh"
        assert result["sources"][key]["retrievedAt"] == NOW
        assert result["sources"][key]["lastAttemptAt"] == NOW
    assert result["sources"]["gdpState"]["observationPeriod"] == "2025-01-01"
    assert result["sources"]["gdpDistrict"]["observationPeriod"] == "2020-01-01"


@pytest.mark.parametrize("failed", SOURCE_IDS)
@pytest.mark.parametrize("failure_kind", ["fetch", "parse"])
def test_failed_source_retains_only_its_old_valid_data_and_other_sources_update(monkeypatch, failed, failure_kind):
    install_sources(monkeypatch)
    prior = macrolens.build_regional_lens(None, OLD)
    original = copy.deepcopy(prior)
    calls = install_sources(monkeypatch, failures=[failed] if failure_kind == "fetch" else [], malformed=[failed] if failure_kind == "parse" else [], delta=.4)
    result = macrolens.build_regional_lens({"regionalLens": prior}, NOW)
    retained = result["sources"][failed]
    assert retained["status"] == "stale"
    assert retained["retrievedAt"] == OLD
    assert retained["observationPeriod"] == prior["sources"][failed]["observationPeriod"]
    assert retained["lastAttemptAt"] == NOW
    assert "private URL" not in retained["message"]
    for field in ["records", "stateRecords", "districtRecords", "stateGroups", "nationalGroups", "value"]:
        if field in retained:
            assert retained[field] == prior["sources"][failed][field]
    for key in set(SOURCE_IDS) - {failed}:
        assert result["sources"][key]["status"] == "fresh", key
        assert result["sources"][key]["retrievedAt"] == NOW, key
    if failed != "cpi":
        assert result["stateRecords"][0]["headlineInflation"] == 1.9
    else:
        assert result["stateRecords"][0]["incomeMedian"] == prior["stateRecords"][0]["incomeMedian"] + 40
    if failed == "gdpDistrict":
        assert result["districtGdpRecords"] == prior["districtGdpRecords"]
        assert result["sources"]["gdp"]["stateRecords"] != prior["sources"]["gdp"]["stateRecords"]
    if failed == "gdpState":
        assert result["sources"]["gdp"]["stateRecords"] == prior["sources"]["gdp"]["stateRecords"]
        assert result["districtGdpRecords"] != prior["districtGdpRecords"]
    if failed in {"incomeGroupState", "incomeGroupNational"}:
        assert result["incomeGroups"]["status"] == "stale"
        assert result["incomeGroups"]["retrievedAt"] == OLD
        assert result["incomeGroups"]["stateGroups"] == prior["incomeGroups"]["stateGroups"]
    assert set(calls) == set(SOURCE_IDS)
    assert prior == original


@pytest.mark.parametrize("failed", ["hiesState", "hiesDistrict", "incomeGroupState", "incomeGroupNational", "labour", "gdpState", "gdpDistrict", "cpi"])
def test_first_run_missing_source_is_unavailable_not_borrowed_or_global_failure(monkeypatch, failed):
    install_sources(monkeypatch, failures=[failed])
    result = macrolens.build_regional_lens(None, NOW)
    source = result["sources"][failed]
    assert source["status"] == "unavailable"
    assert source["retrievedAt"] is None and source["observationPeriod"] is None
    assert source["lastAttemptAt"] == NOW
    assert result["status"] == "partial"
    assert len(result["stateRecords"]) == 16
    if failed == "hiesState":
        assert all(item["incomeMedian"] is None and item["expenditureMean"] is None and item["date"] is None for item in result["stateRecords"])
        assert all(card["value"] == "Unavailable" for card in result["summaryCards"])
        assert result["sources"]["gdpState"]["status"] == "fresh"
    if failed == "gdpState":
        assert all(item["realGdp"] is None for item in result["stateRecords"])
        assert result["districtGdpRecords"]
    if failed == "gdpDistrict":
        assert result["districtGdpRecords"] == []
        assert all(item["realGdp"] is not None for item in result["stateRecords"])
    if failed in {"incomeGroupState", "incomeGroupNational"}:
        assert result["incomeGroups"]["status"] == "unavailable"
        assert result["incomeGroups"]["stateGroups"] == []


def test_total_failure_preserves_per_source_clocks_and_values_without_mutating_previous(monkeypatch):
    install_sources(monkeypatch)
    prior = macrolens.build_regional_lens(None, OLD)
    original = copy.deepcopy(prior)
    calls = install_sources(monkeypatch, failures=SOURCE_IDS)
    result = macrolens.build_regional_lens({"regionalLens": prior}, NOW)
    assert result["status"] == "stale"
    assert result["stateRecords"] == prior["stateRecords"]
    assert result["districtRecords"] == prior["districtRecords"]
    assert all(result["sources"][key]["status"] == "stale" for key in SOURCE_IDS)
    assert all(result["sources"][key]["retrievedAt"] == OLD for key in SOURCE_IDS)
    assert set(calls) == set(SOURCE_IDS)
    assert prior == original


def test_total_first_run_failure_is_safe_unavailable_state(monkeypatch):
    install_sources(monkeypatch, failures=SOURCE_IDS)
    result = macrolens.build_regional_lens(None, NOW)
    assert result["status"] == "unavailable"
    assert result["stateRecords"] == result["districtRecords"] == result["districtLabourRecords"] == result["districtGdpRecords"] == []
    assert all(card["value"] == "Unavailable" for card in result["summaryCards"])
    assert all(result["sources"][key]["status"] == "unavailable" for key in SOURCE_IDS)


def test_regional_exports_use_separate_gdp_clocks_and_statuses(monkeypatch):
    install_sources(monkeypatch)
    prior = macrolens.build_regional_lens(None, OLD)
    install_sources(monkeypatch, failures=["gdpDistrict"])
    result = macrolens.build_regional_lens({"regionalLens": prior}, NOW)
    rows = macrolens.regional_export_rows(result)
    state = next(row for row in rows if row["level"] == "state" and row["metric"] == "realGdp")
    district = next(row for row in rows if row["level"] == "district" and row["metric"] == "realGdp")
    assert (state["data_status"], state["retrieved_at"], state["observation_period"]) == ("fresh", NOW, "2025-01-01")
    assert (district["data_status"], district["retrieved_at"], district["observation_period"]) == ("stale", OLD, "2020-01-01")


@pytest.mark.parametrize("key,field,value", [
    ("hiesState", "income_median", float("nan")),
    ("hiesState", "gini", 1.5),
    ("hiesDistrict", "poverty", 120),
    ("hiesDistrict", "income_mean", -5),
    ("labour", "u_rate", 150),
    ("labour", "lf", -1),
    ("cpi", "inflation_yoy", float("inf")),
])
def test_source_validation_rejects_nonfinite_or_impossible_values(monkeypatch, key, field, value):
    frame = source_frames()[key]
    frame.loc[0, field] = value
    parser = {
        "hiesState": lambda data: macrolens.parse_hies_state(data, NOW, {"status": "unavailable", "value": None}, {}),
        "hiesDistrict": lambda data: macrolens.parse_hies_district(data, NOW),
        "labour": lambda data: macrolens.parse_regional_labour(data, NOW),
        "cpi": lambda data: macrolens.parse_state_cpi(data, NOW),
    }[key]
    with pytest.raises(ValueError):
        parser(frame)


def test_cpi_duplicates_fail_validation_instead_of_ambiguous_point(monkeypatch):
    frame = source_frames()["cpi"]
    with pytest.raises(ValueError):
        macrolens.parse_state_cpi(pd.concat([frame, frame.iloc[:1]], ignore_index=True), NOW)


def test_legacy_source_metadata_is_migrated_without_losing_last_valid_benchmarks(monkeypatch):
    install_sources(monkeypatch)
    prior = macrolens.build_regional_lens(None, OLD)
    legacy = copy.deepcopy(prior)
    legacy.pop("refreshPolicy")
    for key in ["nationalIncome", "nationalPoverty", "nationalInequality", "nationalExpenditure", "incomeGroupState", "incomeGroupNational", "gdpState", "gdpDistrict"]:
        legacy["sources"].pop(key)
    legacy["sources"]["gdp"].pop("stateSource")
    legacy["sources"]["gdp"].pop("districtSource")
    install_sources(monkeypatch, failures=SOURCE_IDS)
    result = macrolens.build_regional_lens({"regionalLens": legacy}, NOW)
    assert result["status"] == "stale"
    assert result["stateRecords"] == prior["stateRecords"]
    for key in ["nationalIncome", "nationalPoverty", "nationalInequality"]:
        assert result["sources"][key]["status"] == "stale"
        assert result["sources"][key]["retrievedAt"] == OLD
        assert result["sources"][key]["observationPeriod"] == "2024-01-01"
    assert result["sources"]["gdpDistrict"]["observationPeriod"] == "2020-01-01"


def test_mismatched_income_percentile_period_retains_only_derived_previous_groups(monkeypatch):
    install_sources(monkeypatch)
    prior = macrolens.build_regional_lens(None, OLD)
    frames = source_frames()
    frames["incomeGroupState"]["date"] = "2026-01-01"
    frames["incomeGroupState"]["income"] += 500
    install_sources(monkeypatch)
    read = macrolens.read_csv
    monkeypatch.setattr(macrolens, "read_csv", lambda url: frames["incomeGroupState"].copy() if url == macrolens.HIES_STATE_PERCENTILE_URL else read(url))
    result = macrolens.build_regional_lens({"regionalLens": prior}, NOW)
    assert result["sources"]["incomeGroupState"]["status"] == result["sources"]["incomeGroupNational"]["status"] == "fresh"
    assert result["sources"]["incomeGroupState"]["observationPeriod"] == "2026-01-01"
    assert result["incomeGroups"]["status"] == "stale"
    assert result["incomeGroups"]["stateGroups"] == prior["incomeGroups"]["stateGroups"]
    assert result["incomeGroups"]["retrievedAt"] == OLD
