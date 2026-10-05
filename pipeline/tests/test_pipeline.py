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


def forecast_fixture(count=60):
    return {key: sample(count, value=2.0) for key in macrolens.SPECS}


class FakeForecastFit:
    mle_retvals = {"converged": True}
    params = {"core": 0.1, "fx": 0.2, "opr": 0.3}

    def get_forecast(self, steps, exog=None):
        import pandas as pd
        self.predicted_mean = pd.Series([2.0, 3.0, 5.0][:steps])
        return self

    def conf_int(self, alpha):
        import pandas as pd
        width = 0.5 if alpha == .20 else 1.5
        return pd.DataFrame({"lower": self.predicted_mean - width, "upper": self.predicted_mean + width})


def test_forecast_backtest_uses_complete_identical_origin_windows(monkeypatch):
    monkeypatch.setattr(macrolens, "fit_model", lambda *args, **kwargs: FakeForecastFit())
    result = macrolens.forecast(forecast_fixture())
    evaluation = result["evaluation"]
    assert len(evaluation["windows"]) == 21
    assert len(evaluation["calibrationExperiment"]["warmupOrigins"]) == 12
    assert len(evaluation["calibrationExperiment"]["evaluationOrigins"]) == 9
    assert all(len(score["metricsByHorizon"]) == 3 for score in result["models"])
    assert all(len(fold["targets"]) == 3 for fold in evaluation["windows"])
    assert all(candidate["origins"] == evaluation["origins"] for candidate in evaluation["candidateEligibility"])
    for fold in evaluation["windows"]:
        assert fold["trainingEnd"] == fold["origin"]
        assert all(date > fold["trainingEnd"] for date in fold["targets"])
        assert all([point["horizon"] for point in candidate["points"]] == [1, 2, 3] for candidate in fold["models"])


def test_backtest_coverage_is_measured_from_historical_bounds(monkeypatch):
    monkeypatch.setattr(macrolens, "fit_model", lambda *args, **kwargs: FakeForecastFit())
    _, _, evaluation = macrolens.backtest(forecast_fixture())
    coverage = next(row for row in evaluation["coverage"] if row["name"] == "SARIMA")
    assert (coverage["covered80"], coverage["total80"]) == (21, 63)
    assert (coverage["covered95"], coverage["total95"]) == (42, 63)
    assert coverage["coverage80"] == pytest.approx(1 / 3, abs=1e-6)
    assert coverage["coverage95"] == pytest.approx(2 / 3, abs=1e-6)
    assert len(coverage["byHorizon"]) == 3


def test_failed_fit_is_disclosed_and_not_scored_as_candidate(monkeypatch):
    def model(name, train, exog=None):
        if name == "SARIMA":
            raise RuntimeError("deliberate failure")
        return FakeForecastFit()
    monkeypatch.setattr(macrolens, "fit_model", model)
    scores, selected, evaluation = macrolens.backtest(forecast_fixture())
    failed = next(score for score in scores if score["name"] == "SARIMA")
    assert failed["eligible"] is False
    assert failed["rmse"] is None and failed["mae"] is None
    assert failed["failedWindows"] == 21 and failed["fallbackCount"] == 0
    assert selected != "SARIMA"
    assert all(next(row for row in fold["models"] if row["name"] == "SARIMA")["points"] == [] for fold in evaluation["windows"])
    assert all("RuntimeError" in next(row for row in fold["models"] if row["name"] == "SARIMA")["failureReason"] for fold in evaluation["windows"])
    coverage = next(row for row in evaluation["coverage"] if row["name"] == "SARIMA")
    assert coverage["total80"] == 0 and coverage["coverage80"] is None


def test_nonconverged_fit_is_ineligible(monkeypatch):
    import numpy as np
    class NotConverged(FakeForecastFit):
        mle_retvals = {"converged": np.bool_(False)}
    monkeypatch.setattr(macrolens, "fit_model", lambda *args, **kwargs: NotConverged())
    scores, selected, _ = macrolens.backtest(forecast_fixture())
    assert selected == "Seasonal naive"
    assert all(not row["eligible"] for row in scores if row["name"] != "Seasonal naive")


def test_partially_failed_candidate_is_not_selected_on_easier_successful_folds(monkeypatch):
    calls = 0
    def fit(name, train, exog=None):
        nonlocal calls
        if name == "SARIMA":
            calls += 1
            if calls == 1:
                raise ValueError("one failed origin")
        return FakeForecastFit()
    monkeypatch.setattr(macrolens, "fit_model", fit)
    scores, selected, evaluation = macrolens.backtest(forecast_fixture())
    sarima = next(row for row in scores if row["name"] == "SARIMA")
    assert sarima["rmse"] is not None
    assert sarima["successfulWindows"] == 20 and sarima["failedWindows"] == 1
    assert sarima["eligible"] is False and selected != "SARIMA"
    assert all(row["origins"] == evaluation["origins"] for row in evaluation["candidateEligibility"])


@pytest.mark.parametrize("count, expected_windows", [(40, 1), (45, 6), (60, 21), (180, macrolens.BACKTEST_MAX_ORIGINS)])
def test_backtest_reports_only_available_complete_windows(monkeypatch, count, expected_windows):
    monkeypatch.setattr(macrolens, "fit_model", lambda *args, **kwargs: FakeForecastFit())
    _, _, evaluation = macrolens.backtest(forecast_fixture(count))
    assert len(evaluation["windows"]) == expected_windows
    assert all(len(window["targets"]) == 3 for window in evaluation["windows"])


def test_recalibrated_intervals_only_use_pre_origin_errors_and_hold_out_later_origins(monkeypatch):
    import pandas as pd
    monkeypatch.setattr(macrolens, "fit_model", lambda *args, **kwargs: FakeForecastFit())
    _, _, evaluation = macrolens.backtest(forecast_fixture(100))
    experiment = evaluation["calibrationExperiment"]
    assert experiment["status"] == "experimental"
    assert experiment["warmupOrigins"] == evaluation["origins"][:macrolens.CALIBRATION_WARMUP_ORIGINS]
    assert experiment["evaluationOrigins"] == evaluation["origins"][macrolens.CALIBRATION_WARMUP_ORIGINS:]
    assert len(experiment["byModelHorizon"]) == 18
    for window in evaluation["windows"]:
        for model in window["models"]:
            for point in model["points"]:
                calibrated = point["recalibrated"]
                assert calibrated["calibrationCount"] == len(calibrated["calibrationTargets"])
                assert calibrated["calibrationTargets"] == sorted(set(calibrated["calibrationTargets"]))
                assert all(target < window["origin"] for target in calibrated["calibrationTargets"])
                if window["evaluationPhase"] == "calibration-warmup":
                    assert calibrated["low80"] is calibrated["low95"] is None
                if calibrated["low95"] is not None:
                    assert calibrated["low95"] <= calibrated["low80"] <= point["predicted"] <= calibrated["high80"] <= calibrated["high95"]
    first_evaluation = evaluation["windows"][macrolens.CALIBRATION_WARMUP_ORIGINS]
    point = next(row for row in first_evaluation["models"] if row["name"] == "SARIMA")["points"][0]
    assert point["recalibrated"]["calibrationCount"] >= 4
    assert point["recalibrated"]["low80"] is not None
    assert point["recalibrated"]["low95"] is None
    assert any(row["recalibrated"]["coverage"] is not None for row in experiment["byModelHorizon"])
    assert all(row["model"] in {"Seasonal naive", "SARIMA", "ARIMAX"} for row in experiment["byModelHorizon"])


def test_policy_rate_uses_last_decision_each_month_then_one_month_lag():
    import pandas as pd
    dates = pd.date_range("2025-01-01", periods=8, freq="MS")
    series = {key: [{"date": date.strftime("%Y-%m-%d"), "value": 2.0} for date in dates] for key in macrolens.SPECS}
    series["opr"] = [
        {"date": "2025-01-15", "value": 2.75},
        {"date": "2025-02-05", "value": 2.50},
        {"date": "2025-02-20", "value": 2.25},
        {"date": "2025-04-10", "value": 3.00},
    ]
    frame = macrolens.prepare_exog(series, dates)
    assert frame.loc[pd.Timestamp("2025-02-01"), "opr"] == pytest.approx(2.75)
    assert frame.loc[pd.Timestamp("2025-03-01"), "opr"] == pytest.approx(2.25)
    assert frame.loc[pd.Timestamp("2025-04-01"), "opr"] == pytest.approx(2.25)
    assert frame.loc[pd.Timestamp("2025-05-01"), "opr"] == pytest.approx(3.00)


def test_backtest_does_not_invent_target_months_when_calendar_has_gaps(monkeypatch):
    import pandas as pd
    series = forecast_fixture()
    for key in series:
        series[key].pop(-2)
    monkeypatch.setattr(macrolens, "fit_model", lambda *args, **kwargs: FakeForecastFit())
    _, _, evaluation = macrolens.backtest(series)
    for window in evaluation["windows"]:
        assert window["targets"] == [date.strftime("%Y-%m-%d") for date in pd.date_range(pd.Timestamp(window["origin"]) + pd.offsets.MonthBegin(), periods=3, freq="MS")]


def test_training_and_conditional_covariates_never_use_future_targets(monkeypatch):
    import numpy as np
    calls = []
    class RecordingFit(FakeForecastFit):
        def __init__(self, train, x_train):
            self.train = train
            self.x_train = x_train
        def get_forecast(self, steps, exog=None):
            if exog is not None:
                assert all(date > self.train.index[-1] for date in exog.index)
                assert np.allclose(exog.to_numpy(), np.tile(self.x_train.iloc[-1].to_numpy(), (3, 1)))
            return super().get_forecast(steps, exog)
    def fit(name, train, exog=None):
        calls.append((name, train.index[-1], None if exog is None else exog.index[-1]))
        return RecordingFit(train, exog)
    monkeypatch.setattr(macrolens, "fit_model", fit)
    _, _, evaluation = macrolens.backtest(forecast_fixture())
    origins = set(evaluation["origins"])
    assert all(date.strftime("%Y-%m-%d") in origins for _, date, _ in calls)
    assert all(x_end is None or x_end <= train_end for _, train_end, x_end in calls)


def test_final_fit_failure_has_explicit_correctly_named_fallback(monkeypatch):
    monkeypatch.setattr(macrolens, "backtest", lambda _: ([], "SARIMA", {"windows": [], "caveats": []}))
    monkeypatch.setattr(macrolens, "fit_model", lambda *args: (_ for _ in ()).throw(RuntimeError("fit failed")))
    result = macrolens.forecast(forecast_fixture())
    assert result["selectedModel"] == "Seasonal naive"
    assert result["status"] == "fallback"
    assert result["evaluation"]["finalFit"]["requestedModel"] == "SARIMA"
    assert result["evaluation"]["finalFit"]["fallbackUsed"] is True
    assert result["scenario"] is None
    assert "RuntimeError" in result["evaluation"]["scenarioFit"]["failureReason"]


def regional_export_fixture():
    return {
        "sources": {
            "hiesState": {"status": "fresh", "sourceUrl": "https://example.test/state-hies", "retrievedAt": "2026-09-01T00:00:00Z"},
            "hiesDistrict": {"status": "stale", "sourceUrl": "https://example.test/district-hies", "retrievedAt": "2026-08-01T00:00:00Z"},
            "cpi": {"status": "stale", "sourceUrl": "https://example.test/state-cpi", "retrievedAt": "2026-08-20T00:00:00Z"},
            "labour": {"status": "fresh", "sourceUrl": "https://example.test/labour", "retrievedAt": "2026-09-02T00:00:00Z"},
            "gdp": {"status": "fresh", "sourceUrl": "https://example.test/state-gdp", "districtSourceUrl": "https://example.test/district-gdp", "retrievedAt": "2026-09-03T00:00:00Z"},
        },
        "stateRecords": [{"state": "Sarawak", "date": "2024-01-01", "incomeMedian": 6500,
                          "headlineInflation": 1.5, "inflationPeriod": "2026-07-01", "unemploymentRate": 3.0,
                          "labourPeriod": "2024-01-01", "realGdp": 145.0, "gdpPeriod": "2025-01-01"}],
        "districtRecords": [{"state": "Sarawak", "district": "Kuching", "date": "2024-01-01", "incomeMedian": 6000}],
        "districtLabourRecords": [{"state": "Sarawak", "district": "Kuching", "date": "2023-01-01", "unemploymentRate": 2.8, "labourForce": 100}],
        "districtGdpRecords": [{"state": "Sarawak", "district": "Kuching", "date": "2020-01-01", "total": 25, "sectors": [{"id": "p5", "value": 20, "share": 80}]}],
        "incomeGroups": {"status": "fresh", "sourceUrl": "https://example.test/state-groups", "nationalDatasetUrl": "https://example.test/national-groups", "observationPeriod": "2024-01-01", "retrievedAt": "2026-09-04T00:00:00Z", "stateGroups": [], "nationalGroups": [{"id": "b40", "meanIncome": 3000, "percentileRange": "1-40"}]},
    }


def test_regional_export_is_long_form_with_per_metric_provenance():
    rows = macrolens.regional_export_rows(regional_export_fixture())
    columns = ["level", "state", "district", "metric", "value", "unit", "observation_period", "source_url", "data_status", "retrieved_at"]
    assert all(list(row) == columns for row in rows)
    inflation = next(row for row in rows if row["metric"] == "headlineInflation")
    assert inflation["observation_period"] == "2026-07-01"
    assert inflation["data_status"] == "stale"
    assert inflation["retrieved_at"] == "2026-08-20T00:00:00Z"
    gdp = next(row for row in rows if row["level"] == "district" and row["metric"] == "realGdp")
    assert gdp["observation_period"] == "2020-01-01"
    assert gdp["source_url"] == "https://example.test/district-gdp"
    assert gdp["unit"] == "RM billion (constant 2015 prices)"
    assert not any(row["level"] == "district" and row["metric"] == "headlineInflation" for row in rows)
    national_group = next(row for row in rows if row["metric"] == "incomeGroup.b40.meanIncome")
    assert national_group["source_url"] == "https://example.test/national-groups"
    assert not any(row["metric"] == "incomeGroup.b40.vsNationalMean" for row in rows)


def test_regional_export_keeps_unknown_retrieval_and_unmatched_district_sources():
    regional = regional_export_fixture()
    regional["sources"]["gdp"].pop("districtSourceUrl")
    regional["sources"]["gdp"].pop("retrievedAt")
    regional["districtLabourRecords"].append({"state": "Johor", "district": "Kuching", "date": "2022-01-01", "unemploymentRate": 9.0})
    rows = macrolens.regional_export_rows(regional)
    gdp = next(row for row in rows if row["level"] == "district" and row["metric"] == "realGdp")
    assert gdp["source_url"] == "" and gdp["retrieved_at"] == ""
    assert next(row for row in rows if row["level"] == "district" and row["state"] == "Sarawak" and row["metric"] == "unemploymentRate")["value"] == 2.8
    assert next(row for row in rows if row["level"] == "district" and row["state"] == "Johor" and row["metric"] == "unemploymentRate")["value"] == 9.0


def test_regional_csv_formula_protection_preserves_numeric_negatives(tmp_path, monkeypatch):
    import csv
    regional = regional_export_fixture()
    regional["stateRecords"][0]["largestSector"] = "=unsafe formula"
    regional["stateRecords"][0]["incomeMinusExpenditure"] = -250
    monkeypatch.setattr(macrolens, "REGIONAL_JSON", tmp_path / "regional-lens.json")
    monkeypatch.setattr(macrolens, "REGIONAL_CSV", tmp_path / "regional-lens.csv")
    macrolens.write_regional_exports(regional)
    with macrolens.REGIONAL_CSV.open(encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    assert next(row for row in rows if row["metric"] == "largestSector")["value"] == "'=unsafe formula"
    assert next(row for row in rows if row["metric"] == "incomeMinusExpenditure")["value"] == "-250"


def test_offline_forecast_recompute_preserves_observations_and_retrieval_metadata(monkeypatch, tmp_path):
    import copy
    import json
    previous = json.loads(macrolens.PUBLISHED.read_text(encoding="utf-8"))
    previous["forecast"].pop("vintageLedger", None)
    monkeypatch.setattr(macrolens, "VINTAGES", tmp_path / "vintages")
    before = copy.deepcopy(previous)
    forecast = {**copy.deepcopy(previous["forecast"]), "selectedModel": "Seasonal naive", "status": "fresh", "calculationStatus": "fresh"}
    forecast["points"][-1]["value"] = 2.345
    monkeypatch.setattr(macrolens, "forecast", lambda _: forecast)
    monkeypatch.setattr(macrolens, "get", lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("offline calculation must not fetch")))
    result = macrolens.recompute_forecast_offline(previous, "2026-10-05T12:00:00Z")
    assert previous == before
    for key in ["series", "sources", "categories", "market", "regionalLens", "dataHealth", "dataOperations", "generatedAt"]:
        assert result[key] == before[key]
    assert result["forecast"]["calculatedAt"] == "2026-10-05T12:00:00Z"
    assert result["forecast"]["recomputation"]["sourceRefresh"] is False
    assert result["forecast"]["vintageLedger"]["status"] == "waiting"
    assert result["forecast"]["vintageLedger"]["sourceSnapshotCount"] == 0
    assert not (tmp_path / "vintages").exists()
    assert "2.35%" in result["narratives"]["forecast"]
    assert "2.35%" in next(section for section in result["monthlyReport"]["sections"] if section["heading"] == "Forecast")["body"]


def test_published_forecast_audit_reconciles_each_interval_and_origin():
    import json
    payload = json.loads(macrolens.PUBLISHED.read_text(encoding="utf-8"))
    evaluation = payload["forecast"].get("evaluation")
    if evaluation is None:
        pytest.skip("Legacy schema-nine payload without optional forecast audit")
    assert len(evaluation["windows"]) == payload["forecast"]["backtestWindows"]
    assert all(len(fold["targets"]) == 3 for fold in evaluation["windows"])
    for coverage in evaluation["coverage"]:
        points = [point for fold in evaluation["windows"] for candidate in fold["models"] if candidate["name"] == coverage["name"] for point in candidate["points"]]
        assert coverage["total80"] == coverage["total95"] == len(points)
        assert coverage["covered80"] == sum(point["low80"] <= point["actual"] <= point["high80"] for point in points)
        assert coverage["covered95"] == sum(point["low95"] <= point["actual"] <= point["high95"] for point in points)
        if coverage["eligible"]:
            assert len(points) == 3 * len(evaluation["windows"])
    assert all(candidate["origins"] == evaluation["origins"] for candidate in evaluation["candidateEligibility"])


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


def test_failed_refresh_preserves_last_success_and_records_attempt():
    success = "2026-09-01T12:00:00Z"
    attempt = "2026-10-05T12:00:00Z"
    old = {"series": {"headline": {"points": sample()}}, "sources": {"headline": {"status": "fresh", "retrievedAt": success}}}
    _, status = macrolens.merge_or_stale("headline", lambda: (_ for _ in ()).throw(RuntimeError()), old, attempt)
    assert status["retrievedAt"] == success
    assert status["lastAttemptAt"] == attempt


def test_old_observation_is_stale_but_old_opr_decision_is_not():
    _, monthly_status = macrolens.merge_or_stale("headline", lambda: sample(), None, "2026-10-05T12:00:00Z")
    _, opr_status = macrolens.merge_or_stale("opr", lambda: sample(20), None, "2026-10-05T12:00:00Z")
    assert monthly_status["status"] == "stale"
    assert opr_status["status"] == "fresh"
    assert monthly_status["freshness"]["basis"] == "observation-recency"


def test_derived_sections_inherit_stale_inputs_and_health_lists_regional_and_demand():
    payload = {
        "schemaVersion": 9, "generatedAt": "2026-10-05T12:00:00Z", "health": "fresh",
        "sources": {key: {"status": "stale" if key == "opr" else "fresh", "retrievedAt": "2026-10-01T00:00:00Z"} for key in macrolens.SPECS},
        "market": {"status": "fresh"}, "economicStructure": {"status": "fresh"},
        "growthDrivers": {"status": "fresh", "production": {"status": "fresh"}, "demand": {"status": "stale"}},
        "externalSector": {"status": "fresh"}, "balancePayments": {"status": "fresh"},
        "regionalLens": {"status": "fresh", "sources": {"hiesState": {"status": "fresh"}, "hiesDistrict": {"status": "stale"}}},
        "structuralBreaks": {"status": "fresh", "indicators": {key: {"status": "fresh"} for key in macrolens.SPECS}},
        **{key: {"status": "fresh"} for key in ["forecast", "riskHeatmap", "latestBrief", "householdPressure", "decisionGuide", "sectorDeepDive", "macroTimeline", "monthlyReport"]},
    }
    result = macrolens.finalize_data_trust(payload)
    for key in ["forecast", "riskHeatmap", "latestBrief", "householdPressure", "decisionGuide", "structuralBreaks"]:
        assert result[key]["status"] != "fresh"
        assert "opr" in result[key]["inputHealth"]["staleInputs"]
    assert result["growthDrivers"]["status"] == "partial"
    assert result["regionalLens"]["status"] == "partial"
    assert result["health"] == "partial"
    health = macrolens.build_data_health(result, result["generatedAt"])
    assert health["overall"] == "partial"
    assert health["note"] == health["summary"]
    assert {"growthDrivers.demand", "regionalLens.hiesDistrict"}.issubset({row["id"] for row in health["sources"]})


def test_successful_derived_recalculation_clears_prior_input_warning():
    payload = {"sources": {key: {"status": "fresh"} for key in macrolens.SPECS}, "forecast": {"status": "partial", "calculationStatus": "fresh"}}
    result = macrolens.finalize_data_trust(payload)
    assert result["forecast"]["status"] == "fresh"
    assert result["forecast"]["inputHealth"]["staleInputs"] == []


def test_structural_status_is_compatible_and_recovers_when_inputs_refresh():
    payload = {"sources": {key: {"status": "stale" if key == "opr" else "fresh"} for key in macrolens.SPECS}, "structuralBreaks": {"status": "fresh", "indicators": {key: {"status": "fresh"} for key in macrolens.SPECS}}}
    result = macrolens.finalize_data_trust(payload)
    assert result["structuralBreaks"]["status"] == "partial"
    assert all(item["status"] == "stale" and item["calculationStatus"] == "fresh" for item in result["structuralBreaks"]["indicators"].values())
    result["sources"]["opr"]["status"] = "fresh"
    recovered = macrolens.finalize_data_trust(result)
    assert recovered["structuralBreaks"]["status"] == "fresh"
    assert all(item["status"] == "fresh" for item in recovered["structuralBreaks"]["indicators"].values())


def test_total_source_failure_preserves_dashboard_without_claiming_fresh(monkeypatch):
    import copy
    import json
    previous = json.loads(macrolens.PUBLISHED.read_text(encoding="utf-8"))

    def unavailable(*args, **kwargs):
        raise RuntimeError("source unavailable")

    for name in ["fetch_cpi", "fetch_unemployment", "fetch_opr", "fetch_daily_fx", "fetch_mgs", "fetch_klci", "read_csv", "read_catalogue_json", "get", "forecast"]:
        monkeypatch.setattr(macrolens, name, unavailable)
    monkeypatch.setattr(macrolens, "build_structural_analysis", lambda *args: copy.deepcopy(previous["structuralBreaks"]))
    result = macrolens.build()
    assert result["health"] == "partial"
    assert all(source["status"] == "stale" for source in result["sources"].values())
    for key in macrolens.SPECS:
        assert result["series"][key]["points"] == previous["series"][key]["points"]
        assert result["sources"][key]["retrievedAt"] == previous["sources"][key]["retrievedAt"]
    assert result["categories"] == previous["categories"]
    assert result["forecast"]["points"] == previous["forecast"]["points"]
    assert result["forecast"]["status"] == "stale"
    assert result["regionalLens"]["status"] == "stale"
    assert result["market"]["retrievedAt"] == previous["market"]["retrievedAt"]
    assert result["externalSector"]["retrievedAt"] == previous["externalSector"]["retrievedAt"]


def test_data_health_does_not_invent_successful_retrieval_time():
    result = macrolens.build_data_health({"health": "partial", "market": {"status": "stale"}}, "2026-10-05T00:00:00Z")
    assert result["sources"][0]["retrievedAt"] is None
    assert result["overall"] == "partial"


def test_write_creates_one_vintage_per_cpi_period(tmp_path, monkeypatch):
    monkeypatch.setattr(macrolens, "VINTAGES", tmp_path / "vintages")
    monkeypatch.setattr(macrolens, "STRUCTURAL_JSON", tmp_path / "published" / "structural-breaks.json")
    monkeypatch.setattr(macrolens, "STRUCTURAL_CSV", tmp_path / "published" / "structural-breaks.csv")
    monkeypatch.setattr(macrolens, "REGIONAL_JSON", tmp_path / "published" / "regional-lens.json")
    monkeypatch.setattr(macrolens, "REGIONAL_CSV", tmp_path / "published" / "regional-lens.csv")
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


def test_future_market_observation_retains_last_valid_prices(monkeypatch):
    old = sample(260, start="2000-01-01", value=1500)
    previous = {"market": {"retrievedAt": "2025-12-01T00:00:00Z", "benchmark": {"points": old}}}
    monkeypatch.setattr(macrolens, "fetch_klci", lambda: sample(260, start="2027-01-01", value=1500))
    result = macrolens.build_market(previous, "2026-01-01T00:00:00Z")
    assert result["status"] == "stale"
    assert result["benchmark"]["points"] == old
    assert result["retrievedAt"] == previous["market"]["retrievedAt"]


def test_decision_guide_is_data_linked_and_balanced_for_both_audiences():
    values = {"headline": 2.0, "core": 2.0, "opr": 2.75, "unemployment": 3.0, "fx": 4.08, "mgs": 3.65}
    series = {key: {"points": sample(value=value)} for key, value in values.items()}
    market = {"status": "fresh", "summary": {"return1Y": 8.4, "annualizedVolatility1Y": 11.2, "latestDate": "2026-07-17"}}
    guide = macrolens.build_decision_guide(series, market, "2026-07-19T00:00:00Z")
    assert "2.0% headline inflation" in guide["summary"]
    assert len(guide["audiences"]["individuals"]) >= 6
    assert len(guide["audiences"]["companies"]) >= 6
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


def gdp_demand_fixture(years=5):
    import pandas as pd
    rows = []
    components = {"e1": 550.0, "e2": 120.0, "e3": 210.0, "e4": 10.0, "e5": 760.0, "e6": 650.0}
    for date in pd.date_range("2020-01-01", periods=years * 4, freq="QS"):
        annual_step = date.year - 2020
        rows.append({"series": "abs", "date": date.strftime("%Y-%m-%d"), "type": "e0", "value": components["e1"] + components["e2"] + components["e3"] + components["e4"] + components["e5"] - components["e6"] + annual_step * 4})
        for code, value in components.items():
            rows.append({"series": "abs", "date": date.strftime("%Y-%m-%d"), "type": code, "value": value + annual_step})
    return pd.DataFrame(rows)


def test_gdp_demand_aggregates_and_reconciles_expenditure_view():
    result = macrolens.parse_gdp_demand(gdp_demand_fixture(), "2026-01-01T00:00:00Z")
    assert result["latestYear"] == 2024
    assert len(result["years"][-1]["components"]) == 6
    imports = next(component for component in result["years"][-1]["components"] if component["id"] == "e6")
    assert imports["gdpSign"] == -1
    assert "expenditure" in result["measure"].lower()


def test_gdp_demand_rejects_duplicates_and_changed_columns():
    duplicated = gdp_demand_fixture()
    duplicated = duplicated._append(duplicated.iloc[0], ignore_index=True)
    with pytest.raises(ValueError, match="duplicate"):
        macrolens.parse_gdp_demand(duplicated, "2026-01-01T00:00:00Z")
    with pytest.raises(ValueError, match="structure changed"):
        macrolens.parse_gdp_demand(duplicated.drop(columns=["type"]), "2026-01-01T00:00:00Z")


def trade_fixture(months=72):
    import pandas as pd
    rows = []
    for index, date in enumerate(pd.date_range("2020-01-01", periods=months, freq="MS")):
        exports = 100_000_000_000 + index * 1_000_000_000
        imports = 85_000_000_000 + index * 800_000_000
        rows.append({
            "date": date.strftime("%Y-%m-%d"),
            "series": "abs",
            "total": exports + imports,
            "balance": exports - imports,
            "exports": exports,
            "imports": imports,
        })
    return pd.DataFrame(rows, columns=["date", "series", "total", "balance", "exports", "imports"])


def test_trade_parser_validates_monthly_flows_and_summary():
    result = macrolens.parse_trade_headline(trade_fixture(), "2026-01-01T00:00:00Z")
    assert result["status"] == "fresh"
    assert len(result["points"]) == 72
    assert result["summary"]["balance"] > 0
    assert result["summary"]["exportsYoY"] is not None


def test_trade_parser_rejects_empty_duplicate_and_malformed_data():
    with pytest.raises(ValueError, match="empty"):
        macrolens.parse_trade_headline(trade_fixture(0), "2026-01-01T00:00:00Z")
    duplicated = trade_fixture()
    duplicated = duplicated._append(duplicated.iloc[0], ignore_index=True)
    with pytest.raises(ValueError, match="duplicate"):
        macrolens.parse_trade_headline(duplicated, "2026-01-01T00:00:00Z")
    malformed = trade_fixture().drop(columns=["imports"])
    with pytest.raises(ValueError, match="structure changed"):
        macrolens.parse_trade_headline(malformed, "2026-01-01T00:00:00Z")


def test_heatmap_and_brief_are_deterministic_and_data_linked():
    values = {"headline": 3.2, "core": 2.8, "opr": 2.75, "unemployment": 3.0, "fx": 4.5, "mgs": 3.8}
    series = {key: {"points": sample(80, value=value)} for key, value in values.items()}
    market = {"status": "fresh", "summary": {"return1Y": -2.0, "maxDrawdown1Y": -12.0, "latestDate": "2026-01-01"}}
    production = macrolens.parse_economic_structure(gdp_structure_fixture(), "2026-01-01T00:00:00Z")
    demand = macrolens.parse_gdp_demand(gdp_demand_fixture(), "2026-01-01T00:00:00Z")
    growth = {"status": "fresh", "production": production, "demand": demand}
    external = macrolens.parse_trade_headline(trade_fixture(), "2026-01-01T00:00:00Z")
    heatmap = macrolens.build_risk_heatmap(series, market, growth, external, "2026-01-01T00:00:00Z")
    assert len(heatmap["items"]) == 9
    assert heatmap == macrolens.build_risk_heatmap(series, market, growth, external, "2026-01-01T00:00:00Z")
    brief = macrolens.build_latest_brief(series, {"points": [{"value": 2.1}, {"value": 2.2}, {"value": 2.3}]}, market, growth, external, heatmap, "2026-01-01T00:00:00Z")
    assert len(brief["whatChanged"]) == 3
    assert "not personalised" in brief["disclaimer"].lower()


def bop_fixture(quarters=24):
    import pandas as pd
    rows = []
    accounts = ["ca", "ka", "fa", "reserves", "neo"]
    for index, date in enumerate(pd.date_range("2020-01-01", periods=quarters, freq="QS")):
        for account in accounts:
            base = {"ca": 12_000, "ka": -200, "fa": 7_000, "reserves": -3_500, "neo": -1_000}[account]
            rows.append({"date": date.strftime("%Y-%m-%d"), "account": account, "balance": base + index * 100})
    return pd.DataFrame(rows, columns=["date", "account", "balance"])


def test_bop_parser_validates_quarterly_balances_and_summary():
    result = macrolens.parse_bop_balance(bop_fixture(), "2026-01-01T00:00:00Z")
    assert result["status"] == "fresh"
    assert len(result["quarters"]) == 24
    assert result["summary"]["currentAccount"] > 0
    assert result["summary"]["largestAbsoluteComponent"]


def test_bop_parser_rejects_empty_duplicate_changed_and_short_data():
    with pytest.raises(ValueError, match="empty|insufficient"):
        macrolens.parse_bop_balance(bop_fixture(0), "2026-01-01T00:00:00Z")
    duplicated = bop_fixture()
    duplicated = duplicated._append(duplicated.iloc[0], ignore_index=True)
    with pytest.raises(ValueError, match="duplicate"):
        macrolens.parse_bop_balance(duplicated, "2026-01-01T00:00:00Z")
    with pytest.raises(ValueError, match="structure changed"):
        macrolens.parse_bop_balance(bop_fixture().drop(columns=["balance"]), "2026-01-01T00:00:00Z")
    with pytest.raises(ValueError, match="insufficient"):
        macrolens.parse_bop_balance(bop_fixture(8), "2026-01-01T00:00:00Z")


def test_v8_research_builders_are_payload_linked_and_deterministic():
    values = {"headline": 1.9, "core": 2.0, "opr": 2.75, "unemployment": 3.1, "fx": 4.4, "mgs": 3.7}
    series = {key: {"points": sample(80, value=value)} for key, value in values.items()}
    market = {"status": "fresh", "retrievedAt": "2026-01-01T00:00:00Z", "summary": {"return1Y": 8.0, "maxDrawdown1Y": -8.0, "latestDate": "2026-01-01"}, "benchmark": {"points": sample(260, value=1600), "source": "Stooq", "sourceUrl": "https://stooq.com/"}}
    production = macrolens.parse_economic_structure(gdp_structure_fixture(), "2026-01-01T00:00:00Z")
    demand = macrolens.parse_gdp_demand(gdp_demand_fixture(), "2026-01-01T00:00:00Z")
    growth = {"status": "fresh", "generatedAt": "2026-01-01T00:00:00Z", "production": production, "demand": demand}
    external = macrolens.parse_trade_headline(trade_fixture(), "2026-01-01T00:00:00Z")
    heatmap = macrolens.build_risk_heatmap(series, market, growth, external, "2026-01-01T00:00:00Z")
    household = macrolens.build_household_pressure(series, market, heatmap, "2026-01-01T00:00:00Z")
    sectors = macrolens.build_sector_deep_dive(growth, market, external, "2026-01-01T00:00:00Z")
    structural = {"indicators": {"headline": {"candidates": [{"breakPeriod": "2020-04-01", "status": "supported", "statusLabel": "Supported structural shift", "chow": {"pHolm": 0.01}, "hacWald": {"pValue": 0.02}}]}}}
    timeline = macrolens.build_macro_timeline(series, structural, market, "2026-01-01T00:00:00Z")
    payload = {
        "schemaVersion": 8,
        "health": "fresh",
        "generatedAt": "2026-01-01T00:00:00Z",
        "sources": {"headline": {"status": "fresh", "retrievedAt": "2026-01-01T00:00:00Z", "observationPeriod": "2026-01-01", "message": "ok"}},
        "market": market,
        "economicStructure": production,
        "externalSector": external,
        "balancePayments": macrolens.parse_bop_balance(bop_fixture(), "2026-01-01T00:00:00Z"),
        "latestBrief": {"period": "2026-01-01", "headline": "Brief headline"},
        "riskHeatmap": heatmap,
        "householdPressure": household,
        "narratives": {"forecast": "Forecast narrative"},
    }
    health = macrolens.build_data_health(payload, "2026-01-01T00:00:00Z")
    report = macrolens.build_monthly_report(payload, "2026-01-01T00:00:00Z")
    assert household == macrolens.build_household_pressure(series, market, heatmap, "2026-01-01T00:00:00Z")
    assert len(household["components"]) == 5
    assert len(sectors["sectors"]) == 6
    assert any(entry["category"] == "Structural diagnostics" for entry in timeline["entries"])
    assert health["schemaVersion"] == 8 and len(health["sources"]) >= 4
    assert len(report["sections"]) == 5


def test_household_market_pressure_keeps_missing_return_unavailable_and_true_zero_observed():
    values = {"headline": 1.9, "core": 2.0, "opr": 2.75, "unemployment": 3.1, "fx": 4.4, "mgs": 3.7}
    series = {key: {"points": sample(80, value=value)} for key, value in values.items()}
    market = {"status": "fresh", "summary": {"return1Y": None, "latestDate": "2026-01-01"}}
    risk = {"status": "fresh"}
    result = macrolens.build_household_pressure(series, market, risk, "2026-01-01T00:00:00Z")
    wealth = next(item for item in result["components"] if item["id"] == "wealth-risk")
    assert wealth["score"] is None
    assert wealth["level"] == "unavailable"
    assert wealth["unavailableReason"]
    assert "unavailable" in wealth["evidence"].lower()
    assert "0.0%" not in wealth["evidence"]
    assert result["overallScore"] == round(sum(item["score"] for item in result["components"] if item["score"] is not None) / 4, 1)
    assert result["status"] == "partial"

    market["summary"]["return1Y"] = 0.0
    zero_result = macrolens.build_household_pressure(series, market, risk, "2026-01-01T00:00:00Z")
    zero = next(item for item in zero_result["components"] if item["id"] == "wealth-risk")
    assert zero["score"] == 55
    assert zero["level"] == "moderate"
    assert "+0.0%" in zero["evidence"]
    assert zero_result["status"] == "fresh"


def test_sector_deep_dive_does_not_turn_missing_growth_into_zero_or_low_risk():
    production = macrolens.parse_economic_structure(gdp_structure_fixture(), "2026-01-01T00:00:00Z")
    latest = production["years"][-1]
    missing_sectors = [{**sector, "changeYoY": None} for sector in latest["sectors"]]
    changed_latest = {**latest, "sectors": missing_sectors}
    growth = {"status": "fresh", "production": {**production, "years": [*production["years"][:-1], changed_latest]}}
    external = {"summary": {"exportsYoY": None}}
    result = macrolens.build_sector_deep_dive(growth, {}, external, "2026-01-01T00:00:00Z")
    assert all(sector["riskLevel"] == "unavailable" for sector in result["sectors"])
    assert all("comparison is unavailable" in sector["narrative"] for sector in result["sectors"])


def test_regional_hies_state_parser_rejects_duplicates(monkeypatch):
    import pandas as pd
    rows = []
    for state in ["Johor", "Kedah", "Kelantan", "Melaka", "Negeri Sembilan", "Pahang", "Pulau Pinang", "Perak", "Perlis", "Selangor", "Terengganu", "Sabah", "Sarawak", "W.P. Kuala Lumpur", "W.P. Labuan", "W.P. Putrajaya"]:
        rows.append({"date": "2024-01-01", "state": state, "income_mean": 8000, "income_median": 6000, "expenditure_mean": 4000, "gini": 0.35, "poverty": 2.0})
    rows.append(rows[0].copy())
    monkeypatch.setattr(macrolens, "read_catalogue_json", lambda dataset_id, limit=100000: pd.DataFrame([{"date": "2024-01-01", "income_mean": 8479, "income_median": 6338, "poverty_absolute": 5.1, "gini": 0.39}]))
    with pytest.raises(ValueError, match="duplicated"):
        macrolens.parse_hies_state(pd.DataFrame(rows), "2026-01-01T00:00:00Z")


def test_national_expenditure_report_requires_exact_year_label_and_unambiguous_mean():
    text = (Path(__file__).parent / "fixtures" / "national-expenditure-summary.txt").read_text(encoding="utf-8")
    result = macrolens.parse_national_expenditure_report([text], 2024, "2026-10-05T00:00:00Z")
    assert result["value"] == 5566
    assert result["observationPeriod"] == "2024-01-01"
    assert result["sourceUrl"] == "https://storage.dosm.gov.my/hies/household_expenditure_2024.pdf"
    for pages in [[text.replace("2024", "2022")], [text.replace("MALAYSIA\nRM5,566", "JOHOR\nRM5,566")], [text, text], [text.replace("5,566", "999,999")]]:
        with pytest.raises(ValueError):
            macrolens.parse_national_expenditure_report(pages, 2024, "2026-10-05T00:00:00Z")


def test_state_hies_uses_official_national_mean_not_average_states(monkeypatch):
    import pandas as pd
    states = ["Johor", "Kedah", "Kelantan", "Melaka", "Negeri Sembilan", "Pahang", "Pulau Pinang", "Perak", "Perlis", "Selangor", "Terengganu", "Sabah", "Sarawak", "W.P. Kuala Lumpur", "W.P. Labuan", "W.P. Putrajaya"]
    frame = pd.DataFrame([{"date": "2024-01-01", "state": state, "income_mean": 8000, "income_median": 6000, "expenditure_mean": 4000, "gini": 0.35, "poverty": 2.0} for state in states])
    monkeypatch.setattr(macrolens, "read_catalogue_json", lambda *_: pd.DataFrame([{"date": "2024-01-01", "income_mean": 9155, "income_median": 7017, "poverty_absolute": 5.1, "gini": 0.39}, {"date": "2026-01-01", "income_mean": 99999, "income_median": 88888, "poverty_absolute": 4.0, "gini": 0.40}]))
    text = (Path(__file__).parent / "fixtures" / "national-expenditure-summary.txt").read_text(encoding="utf-8")
    national = macrolens.parse_national_expenditure_report([text], 2024, "2026-10-05T00:00:00Z")
    result = macrolens.parse_hies_state(frame, "2026-10-05T00:00:00Z", national)
    assert result["national"]["expenditureMean"] == 5566
    assert result["national"]["incomeMedian"] == 7017
    assert result["nationalExpenditure"]["sourceUrl"] == national["sourceUrl"]
    unmatched = macrolens.parse_hies_state(frame, "2026-10-05T00:00:00Z", {**national, "observationPeriod": "2022-01-01"})
    assert unmatched["national"]["expenditureMean"] is None
    assert unmatched["status"] == "partial"


def test_national_expenditure_failure_only_preserves_verified_same_year(monkeypatch):
    monkeypatch.setattr(macrolens, "get", lambda *_: (_ for _ in ()).throw(RuntimeError("offline")))
    prior = {"status": "fresh", "value": 5566, "observationPeriod": "2024-01-01", "retrievedAt": "2026-09-01T00:00:00Z", "sourceUrl": macrolens.HIES_EXPENDITURE_REPORT_URL.format(year=2024)}
    retained = macrolens.fetch_national_expenditure(2024, "2026-10-05T00:00:00Z", prior)
    assert retained["status"] == "stale" and retained["value"] == 5566
    assert retained["retrievedAt"] == prior["retrievedAt"]
    unavailable = macrolens.fetch_national_expenditure(2026, "2026-10-05T00:00:00Z", prior)
    assert unavailable["status"] == "unavailable" and unavailable["value"] is None


def income_percentile_fixture(states):
    import pandas as pd
    rows = []
    for state_index, state in enumerate(states):
        for percentile in range(1, 101):
            rows.append({"date": "2024-01-01", "state": state, "percentile": percentile, "variable": "mean", "income": 1000 + state_index * 100 + percentile * 20})
            rows.append({"date": "2024-01-01", "state": state, "percentile": percentile, "variable": "median", "income": 980 + state_index * 100 + percentile * 20})
            rows.append({"date": "2024-01-01", "state": state, "percentile": percentile, "variable": "minimum", "income": 900 + state_index * 100 + percentile * 20})
            rows.append({"date": "2024-01-01", "state": state, "percentile": percentile, "variable": "maximum", "income": 1100 + state_index * 100 + percentile * 20})
    return pd.DataFrame(rows)


def national_percentile_fixture():
    import pandas as pd
    rows = []
    for percentile in range(1, 101):
        rows.append({"date": "2024-01-01", "percentile": percentile, "variable": "mean", "income": 1200 + percentile * 20})
        rows.append({"date": "2024-01-01", "percentile": percentile, "variable": "median", "income": 1180 + percentile * 20})
        rows.append({"date": "2024-01-01", "percentile": percentile, "variable": "minimum", "income": 1100 + percentile * 20})
        rows.append({"date": "2024-01-01", "percentile": percentile, "variable": "maximum", "income": 1300 + percentile * 20})
    return pd.DataFrame(rows)


def test_regional_income_group_parser_builds_b40_m40_t20():
    states = ["Johor", "Kedah", "Kelantan", "Melaka", "Negeri Sembilan", "Pahang", "Pulau Pinang", "Perak", "Perlis", "Selangor", "Terengganu", "Sabah", "Sarawak", "W.P. Kuala Lumpur", "W.P. Labuan", "W.P. Putrajaya"]
    result = macrolens.parse_hies_income_groups(income_percentile_fixture(states), national_percentile_fixture(), "2026-01-01T00:00:00Z")
    assert result["status"] == "fresh"
    assert [item["id"] for item in result["nationalGroups"]] == ["b40", "m40", "t20"]
    kl = next(item for item in result["stateGroups"] if item["state"] == "W.P. Kuala Lumpur")
    assert len(kl["groups"]) == 3
    assert kl["groups"][0]["meanIncome"] < kl["groups"][2]["meanIncome"]
    assert isinstance(kl["groups"][0]["vsNationalMean"], float)


def test_regional_lens_combines_kl_sarawak_and_national_only(monkeypatch):
    import pandas as pd
    states = ["Johor", "Kedah", "Kelantan", "Melaka", "Negeri Sembilan", "Pahang", "Pulau Pinang", "Perak", "Perlis", "Selangor", "Terengganu", "Sabah", "Sarawak", "W.P. Kuala Lumpur", "W.P. Labuan", "W.P. Putrajaya"]
    hies_state = pd.DataFrame([
        {"date": "2024-01-01", "state": state, "income_mean": 7000 + index * 100, "income_median": 5000 + index * 100, "expenditure_mean": 3500 + index * 50, "gini": 0.32, "poverty": 2.0}
        for index, state in enumerate(states)
    ])
    hies_district = pd.DataFrame([
        {"date": "2024-01-01", "state": states[index % len(states)], "district": f"District {index}", "income_mean": 6000, "income_median": 5000, "expenditure_mean": 3300, "gini": 0.31, "poverty": 3.0}
        for index in range(120)
    ])
    income_state = income_percentile_fixture(states)
    income_national = national_percentile_fixture()
    labour = pd.DataFrame([
        {"state": states[index % len(states)], "district": f"District {index}", "date": "2024-01-01", "lf": 100, "lf_employed": 97, "lf_unemployed": 3, "lf_outside": 40, "p_rate": 70, "u_rate": 3, "ep_ratio": 68}
        for index in range(120)
    ])
    gdp_state = pd.DataFrame([
        {"series": "abs", "state": state, "date": "2025-01-01", "sector": sector, "value": 100000 if sector == "p0" else 10000}
        for state in states for sector in ["p0", *macrolens.GDP_SECTORS]
    ])
    gdp_district = pd.DataFrame([
        {"series": "abs", "state": states[index % len(states)], "district": f"District {index}", "date": "2020-01-01", "sector": sector, "value": 1000 if sector == "p0" else 100}
        for index in range(120) for sector in ["p0", *macrolens.GDP_SECTORS]
    ])
    cpi = pd.DataFrame([
        {"date": "2026-07-01", "state": state, "division": "overall", "inflation_yoy": 1.5}
        for state in states
    ])
    sources = iter([hies_state, hies_district, income_state, income_national, labour, gdp_state, gdp_district])
    monkeypatch.setattr(macrolens, "read_csv", lambda url: next(sources))
    monkeypatch.setattr(macrolens, "fetch_national_expenditure", lambda year, retrieved, previous=None: {"status": "fresh", "value": 5566, "observationPeriod": "2024-01-01", "retrievedAt": retrieved})
    monkeypatch.setattr(macrolens, "read_catalogue_json", lambda dataset_id, limit=100000: pd.DataFrame([{"date": "2024-01-01", "income_mean": 8479, "income_median": 6338, "poverty_absolute": 5.1, "gini": 0.39}]) if dataset_id != "cpi_state_inflation" else cpi)
    result = macrolens.build_regional_lens(None, "2026-01-01T00:00:00Z")
    assert result["schemaVersion"] if "schemaVersion" in result else True
    assert result["defaultComparison"] == {"primary": "W.P. Kuala Lumpur", "secondary": "Sarawak"}
    assert any(item["state"] == "Sarawak" for item in result["stateRecords"])
    assert len(result["incomeGroups"]["nationalGroups"]) == 3
    assert "OPR" in result["coverage"]["nationalOnly"]


def regional_gdp_source_fixture():
    import pandas as pd
    states = ["Johor", "Kedah", "Kelantan", "Melaka", "Negeri Sembilan", "Pahang", "Pulau Pinang", "Perak", "Perlis", "Selangor", "Terengganu", "Sabah", "Sarawak", "W.P. Kuala Lumpur", "W.P. Labuan", "W.P. Putrajaya"]
    state = pd.DataFrame([{"series": "abs", "state": name, "date": "2025-01-01", "sector": sector, "value": 100000 if sector == "p0" else 10000} for name in states for sector in ["p0", *macrolens.GDP_SECTORS]])
    district = pd.DataFrame([{"series": "abs", "state": states[index % len(states)], "district": f"District {index}", "date": "2020-01-01", "sector": sector, "value": 1000 if sector == "p0" else 100} for index in range(120) for sector in ["p0", *macrolens.GDP_SECTORS]])
    return state, district


def test_regional_gdp_preserves_null_missing_and_genuine_zero_sectors():
    state, district = regional_gdp_source_fixture()
    key = district["district"].eq("District 0")
    district.loc[key & district["sector"].eq("p2"), "value"] = None
    district.loc[key & district["sector"].eq("p3"), "value"] = 0
    district = district[~(key & district["sector"].eq("p6"))]
    result = macrolens.parse_regional_gdp(state, district, "2026-09-01T00:00:00Z")
    record = next(row for row in result["districtRecords"] if row["district"] == "District 0")
    sectors = {row["id"]: row for row in record["sectors"]}
    assert sectors["p2"]["value"] is None and sectors["p2"]["share"] is None
    assert sectors["p2"]["valueStatus"] == "suppressed-or-unavailable"
    assert sectors["p3"]["value"] == 0 and sectors["p3"]["share"] == 0
    assert sectors["p3"]["valueStatus"] == "observed"
    assert sectors["p6"]["value"] is None and sectors["p6"]["share"] is None
    assert sectors["p6"]["valueStatus"] == "not-published"
    assert record["total"] == 1.0, "Use official p0; do not sum or rescale partial sectors"
    assert record["largestSector"] != "Mining and quarrying"


def test_regional_gdp_all_unavailable_sectors_do_not_invent_largest_sector():
    state, district = regional_gdp_source_fixture()
    district.loc[district["district"].eq("District 0") & ~district["sector"].eq("p0"), "value"] = None
    result = macrolens.parse_regional_gdp(state, district, "2026-09-01T00:00:00Z")
    record = next(row for row in result["districtRecords"] if row["district"] == "District 0")
    assert record["total"] == 1.0
    assert record["largestSector"] is None and record["largestSectorShare"] is None
    assert all(row["value"] is None and row["share"] is None for row in record["sectors"])


def test_regional_gdp_largest_observed_sector_uses_source_values_not_rounded_share_ties():
    state, district = regional_gdp_source_fixture()
    district["value"] = district["value"].astype(float)
    district.loc[district["district"].eq("District 0") & district["sector"].eq("p1"), "value"] = 100.01
    district.loc[district["district"].eq("District 0") & district["sector"].eq("p2"), "value"] = 100.02
    result = macrolens.parse_regional_gdp(state, district, "2026-09-01T00:00:00Z")
    record = next(row for row in result["districtRecords"] if row["district"] == "District 0")
    assert record["largestSector"] == "Mining and quarrying"


@pytest.mark.parametrize("bad_value", ["not-a-number", "Infinity", -1, float("inf"), True])
def test_regional_gdp_rejects_malformed_nonfinite_or_negative_values(bad_value):
    state, district = regional_gdp_source_fixture()
    district["value"] = district["value"].astype(object)
    district.loc[district.index[1], "value"] = bad_value
    with pytest.raises(ValueError, match="GDP"):
        macrolens.parse_regional_gdp(state, district, "2026-09-01T00:00:00Z")


@pytest.mark.parametrize("which", ["state", "district"])
def test_regional_gdp_rejects_duplicate_sector_rows_instead_of_summing(which):
    state, district = regional_gdp_source_fixture()
    if which == "state":
        state = state._append(state.iloc[0], ignore_index=True)
    else:
        district = district._append(district.iloc[0], ignore_index=True)
    with pytest.raises(ValueError, match="duplicat"):
        macrolens.parse_regional_gdp(state, district, "2026-09-01T00:00:00Z")


def test_regional_gdp_keeps_supra_as_residual_not_administrative_coverage():
    state, district = regional_gdp_source_fixture()
    state = state._append([{ "series": "abs", "state": "Supra", "date": "2025-01-01", "sector": code, "value": 1000 } for code in ["p0", *macrolens.GDP_SECTORS]], ignore_index=True)
    district = district._append([{ "series": "abs", "state": "Sabah", "district": "Supra", "date": "2020-01-01", "sector": code, "value": 1000 } for code in ["p0", *macrolens.GDP_SECTORS]], ignore_index=True)
    result = macrolens.parse_regional_gdp(state, district, "2026-09-01T00:00:00Z")
    assert not any(row["state"] == "Supra" for row in result["stateRecords"])
    assert result["stateResidualRecords"][0]["state"] == "Supra"
    assert result["administrativeDistrictCount"] == 120
    assert any(row["district"] == "Supra" for row in result["districtRecords"])


@pytest.mark.parametrize("state, supplied, expected", [
    ("Sarawak", "Lubok antu", "Lubok Antu"), ("Sarawak", "Tanjong Manis", "Tanjung Manis"),
    ("Pulau Pinang", "S.P. Selatan", "Seberang Perai Selatan"), ("Pulau Pinang", "S.P.Tengah", "Seberang Perai Tengah"),
    ("Perak", "Larut & Matang", "Larut dan Matang"), ("Terengganu", "Hulu", "Hulu Terengganu"),
    ("Perak", "Larut, Matang dan Selama", "Larut, Matang dan Selama"), ("Perak", "Selama", "Selama"),
    ("Kelantan", "Hulu", "Hulu"),
])
def test_regional_aliases_are_explicit_and_state_scoped(state, supplied, expected):
    geography = macrolens.normalize_regional_geography(state, supplied)
    assert geography == {"key": f"{state}|{expected}", "state": state, "district": expected, "kind": "district"}


def test_regional_csv_canonicalizes_alias_joins_and_keeps_residual_gdp_separate():
    regional = regional_export_fixture()
    regional["districtRecords"][0]["district"] = "Tanjong Manis"
    regional["districtLabourRecords"][0]["district"] = "Tanjung Manis"
    regional["districtGdpRecords"][0]["district"] = "Tanjung Manis"
    regional["districtGdpRecords"][0]["sectors"].append({"id": "p2", "value": None, "share": None})
    regional["districtGdpRecords"].append({"state": "Sabah", "district": "Supra", "date": "2020-01-01", "total": 2.0, "sectors": []})
    rows = macrolens.regional_export_rows(regional)
    district_rows = [row for row in rows if row["level"] == "district"]
    assert {row["district"] for row in district_rows} == {"Tanjung Manis"}
    assert {row["metric"] for row in district_rows}.issuperset({"incomeMedian", "unemploymentRate", "realGdp"})
    assert not any(row["metric"].startswith("sector.p2.") for row in district_rows)
    residual = next(row for row in rows if row["level"] == "district_residual" and row["metric"] == "realGdp")
    assert residual["state"] == "Sabah" and residual["district"] == "Supra"
    assert regional["districtRecords"][0]["district"] == "Tanjong Manis", "Do not rewrite source labels"


def test_regional_gdp_offline_correction_is_bounded_and_preserves_retrievals(monkeypatch):
    import copy
    import json
    previous = json.loads(macrolens.PUBLISHED.read_text(encoding="utf-8"))
    before = copy.deepcopy(previous)
    state, district = regional_gdp_source_fixture()
    monkeypatch.setattr(macrolens, "get", lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("must not fetch")))
    result = macrolens.recompute_regional_gdp_offline(previous, state, district, "2026-10-05T12:00:00Z")
    assert previous == before
    assert all(result[key] == before[key] for key in before if key not in {"regionalLens", "structuralBreaks"})
    for key, indicator in before["structuralBreaks"]["indicators"].items():
        corrected = result["structuralBreaks"]["indicators"][key]
        assert {field: value for field, value in corrected.items() if field != "narrative"} == {field: value for field, value in indicator.items() if field != "narrative"}
    assert result["regionalLens"]["calculatedAt"] == "2026-10-05T12:00:00Z"
    assert result["regionalLens"]["generatedAt"] == before["regionalLens"]["generatedAt"]
    assert result["regionalLens"]["sources"]["gdp"]["retrievedAt"] == before["regionalLens"]["sources"]["gdp"]["retrievedAt"]
    assert result["regionalLens"]["sources"]["gdp"]["sourceValidatedAt"] == "2026-10-05T12:00:00Z"
    assert all(result["regionalLens"]["sources"][key] == before["regionalLens"]["sources"][key] for key in before["regionalLens"]["sources"] if key != "gdp")
    assert result["regionalLens"]["stateRecords"][0]["incomeMedian"] == before["regionalLens"]["stateRecords"][0]["incomeMedian"]


def test_no_candidate_structural_narrative_does_not_claim_instability_or_proven_stability():
    text = macrolens.structural_indicator_narrative([])
    assert "no discrete break was detected under this specification" in text
    assert "does not prove stability" in text
    assert "evidence of parameter instability" not in text
    assert "stable single-regime" not in text


@pytest.mark.parametrize("status, claim", [("supported", "This is evidence of parameter instability"), ("possible", "suggestive evidence, not confirmed instability"), ("not-supported", "do not establish parameter instability")])
def test_structural_candidate_narratives_match_confirmation_strength(status, claim):
    text = macrolens.structural_indicator_narrative([{"status": status, "breakPeriod": "2020-03-01", "regimeComparison": {"absoluteChange": -1.0}}])
    assert claim in text
    assert "caus" in text
