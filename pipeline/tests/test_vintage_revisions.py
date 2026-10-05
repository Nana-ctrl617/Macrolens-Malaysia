import importlib.util
import json
import sys
from pathlib import Path

import pytest

MODULE_PATH = Path(__file__).parents[1] / "macrolens.py"
SPEC = importlib.util.spec_from_file_location("macrolens_vintage_test", MODULE_PATH)
macrolens = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
sys.modules[SPEC.name] = macrolens
SPEC.loader.exec_module(macrolens)


def points(end="2026-10-01", count=82, value=2.0):
    import pandas as pd
    dates = pd.date_range(end=end, periods=count, freq="MS")
    return [{"date": date.strftime("%Y-%m-%d"), "value": value} for date in dates]


def payload(clock="2026-10-05T05:45:00Z", latest="2026-10-01"):
    series = {}
    sources = {}
    for key, spec in macrolens.SPECS.items():
        observations = points(end=latest, value=4.2 if key == "fx" else 3.5 if key == "mgs" else 2.75 if key == "opr" else 2.0)
        series[key] = {"unit": spec.unit, "frequency": spec.frequency, "source": spec.source, "source_url": spec.source_url, "points": observations}
        sources[key] = {"status": "fresh", "retrievedAt": clock, "lastAttemptAt": clock, "observationPeriod": observations[-1]["date"]}
    issue_dates = ["2026-11-01", "2026-12-01", "2027-01-01"]
    forecast = {
        "selectedModel": "Seasonal naive", "status": "fresh", "calculationStatus": "fresh", "calculatedAt": clock,
        "methodLabel": "Test-only forecast", "points": [{"date": date, "value": 2.0, "low80": 1.5, "high80": 2.5, "low95": 1.0, "high95": 3.0} for date in issue_dates],
        "models": [{"name": "Seasonal naive", "rmse": 0.1, "mae": 0.08, "selected": True}],
        "evaluation": {"finalFit": {"fallbackUsed": False}},
    }
    return {"schemaVersion": 9, "generatedAt": clock, "series": series, "sources": sources, "forecast": forecast}


def test_same_retrieval_content_is_idempotent_and_never_rewrites_legacy_vintages(tmp_path):
    root = tmp_path / "vintages" / "ledger-v1"
    legacy = tmp_path / "vintages" / "cpi-2026-08.json"
    legacy.parent.mkdir(parents=True)
    legacy.write_text("legacy bytes\n", encoding="utf-8")
    before = legacy.read_bytes()
    current = payload()
    first = macrolens.record_vintage_ledger(current, root)
    source_bytes = {path: path.read_bytes() for path in (root / "sources").glob("*/*.json")}
    second = macrolens.record_vintage_ledger(current, root)
    assert first["status"] == second["status"] == "collecting"
    assert first["sourceSnapshotCount"] == second["sourceSnapshotCount"] == len(macrolens.SPECS)
    assert second["prospectiveForecastCount"] == 1
    assert second["pendingForecastTargetCount"] == 3
    assert len(list((root / "forecasts").glob("*.json"))) == 1
    assert {path: path.read_bytes() for path in source_bytes} == source_bytes
    assert legacy.read_bytes() == before


def test_same_period_revision_appends_a_hash_and_preserves_first_snapshot(tmp_path):
    root = tmp_path / "ledger-v1"
    current = payload()
    macrolens.record_vintage_ledger(current, root)
    original = next((root / "sources" / "headline").glob("*.json"))
    original_bytes = original.read_bytes()
    revised = payload()
    revised["series"]["headline"]["points"][-2]["value"] = 2.1
    summary = macrolens.record_vintage_ledger(revised, root)
    headline_files = list((root / "sources" / "headline").glob("*.json"))
    assert len(headline_files) == 2
    assert summary["sourceSnapshotCount"] == len(macrolens.SPECS) + 1
    assert summary["revisedSourcePeriodCount"] == 1
    assert original.read_bytes() == original_bytes


def test_stale_or_historically_clocked_sources_cannot_be_backdated_as_a_fresh_vintage(tmp_path):
    root = tmp_path / "ledger-v1"
    current = payload()
    current["sources"]["mgs"]["status"] = "stale"
    current["sources"]["mgs"]["retrievedAt"] = "2026-10-04T05:45:00Z"
    result = macrolens.record_vintage_ledger(current, root)
    assert result["freshSourceCount"] == 5
    assert not (root / "sources" / "mgs").exists()
    assert not list((root / "forecasts").glob("*.json"))

    historical_clock = payload()
    historical_clock["generatedAt"] = "2026-10-05T05:45:00Z"
    for source in historical_clock["sources"].values():
        source["retrievedAt"] = source["lastAttemptAt"] = "2026-10-04T05:45:00Z"
    for key in macrolens.SPECS:
        historical_clock["forecast"]["calculatedAt"] = "2026-10-04T05:45:00Z"
    delayed = macrolens.record_vintage_ledger(historical_clock, tmp_path / "historical-ledger")
    assert delayed["freshSourceCount"] == 0
    assert delayed["sourceSnapshotCount"] == 0
    assert delayed["prospectiveForecastCount"] == 0


def test_only_forecasts_wholly_after_the_real_issue_month_are_issued(tmp_path):
    current = payload(latest="2026-08-01")
    current["forecast"]["points"] = [{"date": date, "value": 2.0, "low80": 1.5, "high80": 2.5, "low95": 1.0, "high95": 3.0} for date in ["2026-09-01", "2026-10-01", "2026-11-01"]]
    result = macrolens.record_vintage_ledger(current, tmp_path / "ledger-v1")
    assert result["prospectiveForecastCount"] == 0
    assert "not represented as release vintages" in result["note"]


def test_outcomes_record_first_seen_values_and_later_revisions_as_new_files(tmp_path):
    root = tmp_path / "ledger-v1"
    issue = payload()
    macrolens.record_vintage_ledger(issue, root)
    issue_files = list((root / "forecasts").glob("*.json"))
    assert len(issue_files) == 1
    issue_id = json.loads(issue_files[0].read_text(encoding="utf-8"))["forecastId"]

    observed = payload(clock="2026-11-05T05:45:00Z", latest="2026-11-01")
    observed["series"]["headline"]["points"][-1]["value"] = 2.2
    first = macrolens.record_vintage_ledger(observed, root)
    outcome_dir = root / "outcomes" / issue_id.split(":", 1)[-1][:24]
    outcome_files = list(outcome_dir.glob("*.json"))
    assert len(outcome_files) == 1
    first_bytes = outcome_files[0].read_bytes()
    first_record = json.loads(first_bytes)
    assert first_record["actualHeadlineInflation"] == 2.2
    assert first_record["firstOfficialReleaseVerified"] is False
    assert first["capturedOutcomeCount"] == 1

    macrolens.record_vintage_ledger(observed, root)
    assert len(list(outcome_dir.glob("*.json"))) == 1
    revised = payload(clock="2026-11-06T05:45:00Z", latest="2026-11-01")
    revised["series"]["headline"]["points"][-1]["value"] = 2.3
    macrolens.record_vintage_ledger(revised, root)
    assert len(list(outcome_dir.glob("*.json"))) == 2
    assert outcome_files[0].read_bytes() == first_bytes


def test_finite_sample_recalibration_quantiles_withhold_under_supported_intervals():
    assert macrolens._absolute_error_quantile([1.0, 2.0, 3.0], 0.80) is None
    assert macrolens._absolute_error_quantile([1.0, 2.0, 3.0, 4.0], 0.80) == 4.0
    assert macrolens._absolute_error_quantile([float(i) for i in range(1, 19)], 0.95) is None
    assert macrolens._absolute_error_quantile([float(i) for i in range(1, 20)], 0.95) == 19.0
    assert macrolens._absolute_error_quantile([1, 1, 0, 0], 0.80) == 1.0
