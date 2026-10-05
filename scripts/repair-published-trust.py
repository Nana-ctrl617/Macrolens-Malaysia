"""One-time audited migration; preserves observations, forecasts and CPI vintages."""
from __future__ import annotations

import copy
from datetime import datetime, timezone
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "pipeline"))
import macrolens


def repair(payload: dict, national: dict, maintained_at: str) -> dict:
    result = copy.deepcopy(payload)
    hies = result["regionalLens"]["sources"]["hiesState"]
    if national["observationPeriod"] != hies["observationPeriod"] or national["status"] != "fresh":
        raise ValueError("A verified exact-period official national benchmark is required for migration")
    hies["nationalExpenditure"] = national
    hies["national"]["expenditureMean"] = national["value"]
    for row in result["regionalLens"]["stateRecords"]:
        row.setdefault("vsNational", {})["expenditureMean"] = round(row["expenditureMean"] - national["value"], 2)
    # Older artifacts overwrote the successful retrieval date on failed attempts.
    # Its real value cannot be recovered reliably; explicitly record it as unknown.
    for source in result["sources"].values():
        if source["status"] != "fresh" and "lastAttemptAt" not in source:
            source["lastAttemptAt"] = source.get("retrievedAt") or result["generatedAt"]
            source["retrievedAt"] = None
            source["message"] += "; last successful retrieval was not recorded by the legacy pipeline"
        elif "lastAttemptAt" not in source:
            source["lastAttemptAt"] = source.get("retrievedAt")
    operations = result.setdefault("dataOperations", {})
    operations.setdefault("lastSuccessfulRefresh", result["generatedAt"])
    operations["lastMaintenanceAt"] = maintained_at
    operations["maintenanceNote"] = "Trust-label and national benchmark correction; no model recalculation or new macro observations."
    result["generatedAt"] = maintained_at
    macrolens.finalize_data_trust(result)
    result["dataHealth"] = macrolens.build_data_health(result, maintained_at)
    return result


if __name__ == "__main__":
    original = json.loads(macrolens.PUBLISHED.read_text(encoding="utf-8"))
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    year = int(original["regionalLens"]["sources"]["hiesState"]["observationPeriod"][:4])
    national = macrolens.fetch_national_expenditure(year, now)
    corrected = repair(original, national, now)
    assert corrected["series"] == original["series"]
    assert corrected["forecast"]["points"] == original["forecast"]["points"]
    macrolens.write_payload(corrected)
    print(json.dumps({"nationalExpenditure": national["value"], "surveyYear": year, "source": national["sourceUrl"], "forecastPointsPreserved": True, "health": corrected["health"]}))
