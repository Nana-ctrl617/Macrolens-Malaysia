"""Missing evidence must never become a fabricated Risk measurement or score."""

import copy
import importlib.util
import json
from pathlib import Path
import sys

import pandas as pd
import pytest


MODULE_PATH = Path(__file__).resolve().parents[1] / "macrolens.py"
SPEC = importlib.util.spec_from_file_location("macrolens_risk_availability", MODULE_PATH)
macrolens = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = macrolens
SPEC.loader.exec_module(macrolens)

STAMP = "2026-10-05T10:00:00Z"


def fixture():
    values = {"headline": 1.8, "core": 1.8, "opr": 2.75, "unemployment": 3.0, "fx": 4.1, "mgs": 3.4}
    series = {
        key: {"status": "fresh", "points": [
            {"date": date.strftime("%Y-%m-%d"), "value": value}
            for date in pd.date_range("2025-01-01", periods=18, freq="MS")
        ]} for key, value in values.items()
    }
    market = {"status": "fresh", "summary": {"return1Y": 8.0, "maxDrawdown1Y": -7.0, "latestDate": "2026-06-30"}}
    growth = {"status": "fresh", "demand": {"status": "fresh", "observationPeriod": "2025-12-31", "years": [{"year": 2025, "summary": {"demandType": "consumption-led", "largestContribution": 42.0}}]}}
    external = {"status": "fresh", "summary": {"balance": 10.0, "exportsYoY": 4.0, "importsYoY": 3.0, "latestDate": "2026-06-01"}}
    return series, market, growth, external


def run(inputs=None):
    return macrolens.build_risk_heatmap(*(inputs or fixture()), STAMP)


def row(result, id_):
    return next(item for item in result["items"] if item["id"] == id_)


@pytest.mark.parametrize("field", ["return1Y", "maxDrawdown1Y"])
@pytest.mark.parametrize("missing", [None, float("nan"), float("inf"), -float("inf")])
def test_missing_or_nonfinite_market_inputs_are_unavailable(field, missing):
    inputs = fixture()
    inputs[1]["summary"][field] = missing
    result = run(inputs)
    bursa = row(result, "bursa")
    assert bursa["score"] is None
    assert bursa["level"] == "unavailable" and bursa["dataStatus"] == "unavailable"
    assert field in bursa["unavailableReason"]
    assert "Unavailable" in bursa["evidence"]
    assert "0.0%" not in bursa["evidence"]
    assert result["availableCount"] == 8 and result["totalCount"] == 9
    assert result["status"] == "partial"


@pytest.mark.parametrize("field", ["balance", "exportsYoY", "importsYoY"])
def test_missing_trade_input_is_not_a_zero_or_a_complete_trade_score(field):
    inputs = fixture()
    del inputs[3]["summary"][field]
    trade = row(run(inputs), "trade")
    assert trade["score"] is None and trade["level"] == "unavailable"
    assert field in trade["unavailableReason"]
    assert "Unavailable" in trade["evidence"]


@pytest.mark.parametrize("field", ["balance", "exportsYoY", "importsYoY"])
@pytest.mark.parametrize("missing", [None, float("nan"), float("inf"), True])
def test_invalid_trade_measurements_cannot_generate_a_score(field, missing):
    inputs = fixture()
    inputs[3]["summary"][field] = missing
    result = run(inputs)
    assert row(result, "trade")["score"] is None
    json.dumps(result, allow_nan=False)


def test_genuine_zero_market_and_trade_values_remain_available():
    inputs = fixture()
    inputs[1]["summary"].update(return1Y=0.0, maxDrawdown1Y=0.0)
    inputs[3]["summary"].update(balance=0.0, exportsYoY=0.0, importsYoY=0.0)
    result = run(inputs)
    assert row(result, "bursa")["score"] == 55
    assert row(result, "trade")["score"] == 75
    assert "+0.0%" in row(result, "bursa")["evidence"]
    assert "+0.0%" in row(result, "trade")["evidence"]
    assert result["availableCount"] == 9


def test_short_core_history_discloses_missing_change_but_keeps_level_score():
    inputs = fixture()
    inputs[0]["core"]["points"] = inputs[0]["core"]["points"][-2:]
    core = row(run(inputs), "core")
    assert core["score"] == 25
    assert "3-month change" in core["evidence"] and "Unavailable" in core["evidence"]
    assert "+0.0 pp" not in core["evidence"]


@pytest.mark.parametrize("demand", [{}, {"years": []}, {"years": [{}]}, {"years": [{"summary": {"demandType": "consumption-led"}}]}, {"years": [{"summary": {"demandType": "unknown", "largestContribution": 10}}]}])
def test_missing_gdp_demand_evidence_is_not_a_moderate_score(demand):
    inputs = fixture()
    inputs[2]["demand"] = demand
    growth = row(run(inputs), "growth")
    assert growth["score"] is None and growth["level"] == "unavailable"
    assert "Unavailable" in growth["evidence"]


def test_a_genuine_zero_demand_contribution_is_still_measured_evidence():
    inputs = fixture()
    inputs[2]["demand"]["years"][-1]["summary"]["largestContribution"] = 0.0
    assert row(run(inputs), "growth")["score"] == 35


@pytest.mark.parametrize("missing", [None, float("nan"), float("inf"), True])
def test_missing_macro_level_does_not_get_a_threshold_score(missing):
    inputs = fixture()
    inputs[0]["headline"]["points"][-1]["value"] = missing
    headline = row(run(inputs), "headline")
    assert headline["score"] is None and headline["level"] == "unavailable"


def test_empty_macro_source_is_unavailable_without_freezing_other_items():
    inputs = fixture()
    inputs[0]["mgs"]["points"] = []
    result = run(inputs)
    assert row(result, "mgs")["score"] is None
    assert row(result, "headline")["score"] == 25
    assert result["availableCount"] == 8


def test_partial_overall_is_mean_of_available_items_with_explicit_coverage():
    inputs = fixture()
    inputs[1]["summary"]["return1Y"] = None
    inputs[3]["summary"]["importsYoY"] = None
    result = run(inputs)
    available = [item["score"] for item in result["items"] if item["score"] is not None]
    assert result["overallScore"] == round(sum(available) / len(available), 1)
    assert result["availableCount"] == 7 and result["totalCount"] == 9
    assert "7 of 9" in result["coverageNote"]
    assert "not directly comparable" in result["coverageNote"]
    assert "Bursa large-cap market" not in result["summary"]


def test_all_unavailable_is_not_low_pressure_and_serializes_without_nan():
    result = run(({}, {}, {}, {}))
    assert result["overallScore"] is None and result["overallLevel"] == "unavailable"
    assert result["status"] == "unavailable" and result["availableCount"] == 0
    assert "Unavailable" in result["summary"]
    assert all(item["score"] is None and item["unavailableReason"] for item in result["items"])
    json.dumps(result, allow_nan=False)


def test_stale_valid_source_keeps_score_and_identifies_its_health():
    inputs = fixture()
    inputs[0]["mgs"]["status"] = "stale"
    result = run(inputs)
    assert row(result, "mgs")["score"] == 30 and row(result, "mgs")["dataStatus"] == "stale"
    assert result["status"] == "partial"


def test_three_month_daily_fx_change_uses_calendar_not_three_rows():
    points = [{"date": date.strftime("%Y-%m-%d"), "value": 4 + index / 1000}
              for index, date in enumerate(pd.date_range("2026-01-01", "2026-06-30", freq="B"))]
    # June 30's three-month reference is March 30, not the preceding three days.
    reference = next(point for point in points if point["date"] == "2026-03-30")
    expected = round(points[-1]["value"] - reference["value"], 4)
    assert macrolens._series_change({"points": points}, 3) == expected


def test_missing_reference_month_and_nonfinite_percentile_are_unavailable():
    points = [{"date": "2026-01-01", "value": 2}, {"date": "2026-03-01", "value": 2}, {"date": "2026-05-01", "value": 2}, {"date": "2026-06-01", "value": 2}]
    assert macrolens._series_change({"points": points}, 4) is None
    assert macrolens._series_percentile({"points": points + [{"date": "2026-07-01", "value": float("nan")}]}) is None


def test_brief_sorts_only_available_scores_and_does_not_invent_zero_changes():
    inputs = fixture()
    inputs[1]["summary"]["return1Y"] = None
    inputs[3]["summary"]["balance"] = None
    inputs[0]["fx"]["points"] = inputs[0]["fx"]["points"][-1:]
    risk = run(inputs)
    result = macrolens.build_latest_brief(inputs[0], {"points": [{"value": 2.0}]}, inputs[1], inputs[2], inputs[3], risk, STAMP)
    assert any("ringgit" in line and "Unavailable" in line for line in result["whatChanged"])
    assert any("KLCI" in line and "Unavailable" in line for line in result["whatChanged"])
    assert not any("Bursa" in line for line in result["watchNext"])
    assert not any("0.0%" in line or "+0.00" in line for line in result["whatChanged"])


def test_brief_handles_an_all_unavailable_screen_without_claiming_pressure():
    series, market, growth, external = fixture()
    risk = run(({}, {}, {}, {}))
    result = macrolens.build_latest_brief(series, {"points": [{"value": 2.0}]}, market, growth, external, risk, STAMP)
    assert "unavailable" in result["headline"].lower()
    assert "unavailable pressure" not in result["headline"].lower()
    assert result["watchNext"] and "unavailable" in result["watchNext"][0].lower()


def test_brief_handles_missing_underlying_levels_without_inventing_values():
    risk = run(({}, {}, {}, {}))
    result = macrolens.build_latest_brief({}, {"points": []}, {}, {}, {}, risk, STAMP)
    assert result["period"] == ""
    assert "Unavailable" in result["headline"]
    assert any("Unavailable" in implication for implication in result["implications"])
    assert not any("0.0%" in value for value in [result["headline"], *result["whatChanged"]])


def test_available_results_are_deterministic_and_do_not_mutate_inputs():
    inputs = fixture()
    old = copy.deepcopy(inputs)
    assert run(inputs) == run(inputs)
    assert inputs == old


def test_decision_guide_retains_missing_market_and_trade_data_as_unavailable():
    series, market, growth, external = fixture()
    market["summary"].update(return1Y=None, annualizedVolatility1Y=None)
    external["summary"].update(imports=None, importsYoY=None)
    risk = run((series, market, growth, external))
    result = macrolens.build_decision_guide(series, market, STAMP, risk, external)
    market_signal = next(signal for signal in result["signals"] if signal["label"] == "KLCI 1-year")
    assert market_signal["value"] == "Unavailable"
    cards = {card["id"]: card for audience in result["audiences"].values() for card in audience}
    assert "Unavailable" in cards["listed-investments"]["evidence"]
    assert "Unavailable" in cards["inventory-imports"]["evidence"]
    assert "Unavailable" in cards["imported-costs"]["evidence"]
    assert "+0.0%" not in result["summary"]


def test_decision_guide_genuine_zero_market_and_trade_data_stay_numeric():
    series, market, growth, external = fixture()
    market["summary"].update(return1Y=0.0, annualizedVolatility1Y=0.0)
    external["summary"].update(imports=0.0, importsYoY=0.0)
    result = macrolens.build_decision_guide(series, market, STAMP, run((series, market, growth, external)), external)
    market_signal = next(signal for signal in result["signals"] if signal["label"] == "KLCI 1-year")
    assert market_signal["value"] == "+0.0%"
    cards = {card["id"]: card for audience in result["audiences"].values() for card in audience}
    assert "+0.0%" in cards["inventory-imports"]["evidence"]


def test_macro_timeline_does_not_turn_missing_market_return_into_zero():
    series, market, _, _ = fixture()
    market["summary"]["return1Y"] = None
    market["benchmark"] = {"source": "Test delayed source", "sourceUrl": "https://example.test/history"}
    result = macrolens.build_macro_timeline(series, {"indicators": {}}, market, STAMP)
    latest = next(entry for entry in result["entries"] if entry["type"] == "latest-observation")
    assert "Unavailable" in latest["evidence"] and "0.0%" not in latest["evidence"]


def test_finalized_risk_health_uses_source_status_and_keeps_missing_inputs_unavailable():
    series, market, growth, external = fixture()
    # Series display metadata need not contain the independently stored health.
    for source in series.values():
        source.pop("status")
    market["summary"]["return1Y"] = None
    risk = run((series, market, growth, external))
    sources = {key: {"status": "fresh"} for key in series}
    sources["mgs"]["status"] = "stale"
    payload = {"sources": sources, "riskHeatmap": risk, "market": market,
               "externalSector": external, "growthDrivers": growth,
               "economicStructure": {"status": "fresh"}}
    macrolens.finalize_data_trust(payload)
    assert row(payload["riskHeatmap"], "mgs")["dataStatus"] == "stale"
    assert row(payload["riskHeatmap"], "bursa")["dataStatus"] == "unavailable"
    assert row(payload["riskHeatmap"], "bursa")["score"] is None
def test_offline_risk_recalculation_preserves_official_data_and_vintages():
    import copy
    import json
    prior = json.loads(macrolens.PUBLISHED.read_text(encoding="utf-8"))
    original = copy.deepcopy(prior)
    result = macrolens.recompute_risk_offline(prior, "2026-10-05T12:30:00Z")
    assert result["series"] == original["series"]
    assert result["sources"] == original["sources"]
    assert result["generatedAt"] == original["generatedAt"]
    assert prior == original
    assert result["recomputation"]["sourceRefresh"] is False

