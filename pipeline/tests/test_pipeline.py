import importlib.util
import sys
from pathlib import Path

import pytest

MODULE_PATH = Path(__file__).parents[1] / "macrolens.py"
SPEC = importlib.util.spec_from_file_location("macrolens", MODULE_PATH)
macrolens = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
sys.modules["macrolens"] = macrolens
SPEC.loader.exec_module(macrolens)


def sample(count=60, start="2020-01-01", value=2.0):
    import pandas as pd
    return [{"date": date.strftime("%Y-%m-%d"), "value": value} for date in pd.date_range(start, periods=count, freq="MS")]


def test_validation_rejects_duplicates():
    points = sample()
    points[-1]["date"] = points[-2]["date"]
    with pytest.raises(ValueError, match="duplicate"):
        macrolens.validate_points("headline", points)


def test_validation_rejects_implausible_values():
    points = sample()
    points[-1]["value"] = 99
    with pytest.raises(ValueError, match="implausible"):
        macrolens.validate_points("headline", points)


def test_partial_failure_preserves_last_valid_series():
    old = {"series": {"headline": {"points": sample()}}}
    result, status = macrolens.merge_or_stale("headline", lambda: (_ for _ in ()).throw(RuntimeError()), old, "2026-01-01T00:00:00Z")
    assert result["points"] == old["series"]["headline"]["points"]
    assert status["status"] == "stale"


def test_write_creates_one_vintage_per_cpi_period(tmp_path, monkeypatch):
    monkeypatch.setattr(macrolens, "VINTAGES", tmp_path / "vintages")
    monkeypatch.setattr(macrolens, "STRUCTURAL_JSON", tmp_path / "published" / "structural-breaks.json")
    monkeypatch.setattr(macrolens, "STRUCTURAL_CSV", tmp_path / "published" / "structural-breaks.csv")
    payload = {"schemaVersion": 2, "series": {"headline": {"points": sample(60)}}, "structuralBreaks": {"indicators": {}}}
    output = tmp_path / "published" / "dashboard.json"
    assert macrolens.write_payload(payload, output)
    assert len(list((tmp_path / "vintages").glob("*.json"))) == 1


def test_official_cpi_weights_reconcile_and_gap_stays_visible():
    assert sum(macrolens.CPI_WEIGHTS_2022.values()) == pytest.approx(100.0)
    categories = [
        {"code": code, "name": code, "value": 2.0, "weight": weight, "contribution": weight * 2.0 / 100}
        for code, weight in macrolens.CPI_WEIGHTS_2022.items()
    ]
    result = macrolens.build_cpi_decomposition(categories, [{"date": "2026-06-01", "value": 2.1}])
    assert result["estimatedTotal"] == pytest.approx(2.0)
    assert result["reconciliationGap"] == pytest.approx(0.1)
    assert result["weightReferenceYear"] == 2022


def test_monthly_normalisation_uses_last_opr_observation_and_forward_fills():
    points = [
        {"date": "2020-01-05", "value": 3.0},
        {"date": "2020-01-22", "value": 2.75},
        {"date": "2020-03-03", "value": 2.5},
    ]
    result = macrolens.structural_monthly("opr", points)
    assert result.loc["2020-01-01"] == 2.75
    assert result.loc["2020-02-01"] == 2.75
    assert result.loc["2020-03-01"] == 2.5


def test_holm_adjustment_controls_familywise_error():
    assert macrolens.holm_adjust([0.01, 0.04, 0.03]) == pytest.approx([0.03, 0.06, 0.06])


def test_screening_finds_known_level_shift_and_respects_boundaries():
    import numpy as np
    import pandas as pd
    rng = np.random.default_rng(617)
    values = np.r_[rng.normal(2.0, 0.12, 72), rng.normal(5.0, 0.12, 72)]
    series = pd.Series(values, index=pd.date_range("2010-01-01", periods=len(values), freq="MS"))
    breaks, _ = macrolens.screen_breaks(series, minimum_segment=24)
    assert breaks
    assert abs(breaks[0] - 71) <= 3
    assert all(24 <= point <= len(series) - 1 - 24 for point in breaks)


def test_structural_analysis_reports_ordered_diagnostics_and_future_free_sample():
    import numpy as np
    import pandas as pd
    rng = np.random.default_rng(617)
    dates = pd.date_range("2010-01-01", periods=144, freq="MS")
    values = np.r_[rng.normal(2.0, 0.1, 72), rng.normal(4.5, 0.1, 72)]
    points = [{"date": date.strftime("%Y-%m-%d"), "value": float(value)} for date, value in zip(dates, values)]
    result = macrolens.analyse_structural_indicator("headline", points, [], "2026-01-01T00:00:00Z")
    assert result["sample"]["end"] == points[-1]["date"]
    assert result["screening"]["selectedBreaks"] >= 1
    candidate = result["candidates"][0]
    assert candidate["chow"]["pHolm"] >= candidate["chow"]["pRaw"]
    assert candidate["chow"]["dfNumerator"] == 3
    assert candidate["adjacentSample"]["postEnd"] <= points[-1]["date"]
    assert candidate["status"] in {"supported", "possible", "not-supported"}


def test_stable_series_can_select_no_break():
    import numpy as np
    import pandas as pd
    rng = np.random.default_rng(12)
    values = np.zeros(180)
    for index in range(1, len(values)):
        values[index] = 0.65 * values[index - 1] + rng.normal(0, 0.2)
    series = pd.Series(values, index=pd.date_range("2010-01-01", periods=len(values), freq="MS"))
    breaks, _ = macrolens.screen_breaks(series, minimum_segment=24)
    assert breaks == []


def test_klci_parser_drops_nulls_deduplicates_and_sorts():
    import pandas as pd
    dates = pd.date_range("2025-01-01", periods=260, freq="B")
    timestamps = [int(date.timestamp()) for date in dates]
    closes = [1500 + index * 0.2 for index in range(260)]
    timestamps.extend([timestamps[-1], timestamps[-1] + 86400])
    closes.extend([1600.0, None])
    payload = {"chart": {"result": [{"timestamp": timestamps, "indicators": {"quote": [{"close": closes}]}}]}}
    points = macrolens.parse_klci(payload)
    assert len(points) == 260
    assert points[-1]["value"] == 1600.0
    assert [point["date"] for point in points] == sorted(point["date"] for point in points)


def test_klci_parser_rejects_changed_structure():
    with pytest.raises(ValueError, match="structure"):
        macrolens.parse_klci({"chart": {"result": [{"timestamp": [1], "indicators": {}}]}})


def test_market_statistics_reports_return_volatility_and_drawdown():
    import pandas as pd
    values = [1000.0, 1100.0, 880.0, 968.0]
    points = [{"date": date.strftime("%Y-%m-%d"), "value": value} for date, value in zip(pd.date_range("2025-01-01", periods=4, freq="30D"), values)]
    result = macrolens.market_statistics(points)
    assert result["latest"] == 968.0
    assert result["maxDrawdown1Y"] == pytest.approx(-20.0)
    assert result["high52w"] == 1100.0


def test_market_failure_preserves_last_valid_prices(monkeypatch):
    old = sample(260, start="2000-01-01", value=1500)
    previous = {"market": {"benchmark": {"points": old}}}
    monkeypatch.setattr(macrolens, "fetch_klci", lambda: (_ for _ in ()).throw(RuntimeError("offline")))
    result = macrolens.build_market(previous, "2026-01-01T00:00:00Z")
    assert result["status"] == "stale"
    assert result["benchmark"]["points"] == old


def test_decision_guide_is_data_linked_and_balanced_for_both_audiences():
    values = {"headline": 2.0, "core": 2.0, "opr": 2.75, "unemployment": 3.0, "fx": 4.08, "mgs": 3.65}
    series = {key: {"points": sample(value=value)} for key, value in values.items()}
    market = {"status": "fresh", "summary": {"return1Y": 8.4, "annualizedVolatility1Y": 11.2, "latestDate": "2026-07-17"}}
    guide = macrolens.build_decision_guide(series, market, "2026-07-19T00:00:00Z")
    assert "2.0% headline inflation" in guide["summary"]
    assert len(guide["audiences"]["individuals"]) == 4
    assert len(guide["audiences"]["companies"]) == 4
    assert all(len(card["actions"]) == 3 and card["watch"] for cards in guide["audiences"].values() for card in cards)
    assert "not personalised" in guide["disclaimer"].lower()


def gdp_structure_fixture(years=5):
    import pandas as pd
    rows = []
    components = {"p1": 100.0, "p2": 100.0, "p3": 200.0, "p4": 100.0, "p5": 480.0, "p6": 20.0}
    for date in pd.date_range("2020-01-01", periods=years * 4, freq="QS"):
        annual_step = date.year - 2020
        rows.append({"series": "abs", "date": date.strftime("%Y-%m-%d"), "sector": "p0", "value": sum(components.values()) + annual_step * len(components)})
        for sector, value in components.items():
            rows.append({"series": "abs", "date": date.strftime("%Y-%m-%d"), "sector": sector, "value": value + annual_step})
    return pd.DataFrame(rows)


def test_economic_structure_aggregates_complete_years_and_reconciles_shares():
    result = macrolens.parse_economic_structure(gdp_structure_fixture(), "2026-01-01T00:00:00Z")
    assert result["latestYear"] == 2024
    assert len(result["years"]) == 5
    latest = result["years"][-1]
    assert len(latest["sectors"]) == 6
    assert latest["sectors"][0]["name"] == "Services"
    assert sum(sector["share"] for sector in latest["sectors"]) == pytest.approx(100, abs=0.1)
    assert "2024" in latest["narrative"]


def test_economic_structure_rejects_duplicates_and_changed_columns():
    duplicated = gdp_structure_fixture()
    duplicated = duplicated._append(duplicated.iloc[0], ignore_index=True)
    with pytest.raises(ValueError, match="duplicate"):
        macrolens.parse_economic_structure(duplicated, "2026-01-01T00:00:00Z")
    with pytest.raises(ValueError, match="structure changed"):
        macrolens.parse_economic_structure(duplicated.drop(columns=["sector"]), "2026-01-01T00:00:00Z")


def test_economic_structure_failure_preserves_last_valid_result(monkeypatch):
    previous = {"economicStructure": {"status": "fresh", "years": [{"year": 2024}]}}
    monkeypatch.setattr(macrolens, "read_csv", lambda _: (_ for _ in ()).throw(RuntimeError("offline")))
    result = macrolens.build_economic_structure(previous, "2026-01-01T00:00:00Z")
    assert result["status"] == "stale"
    assert result["years"] == previous["economicStructure"]["years"]
