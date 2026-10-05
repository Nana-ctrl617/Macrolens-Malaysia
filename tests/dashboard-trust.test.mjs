import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { normalizeDashboard } from "../app/lib/dashboard-health.ts";

const fixture = () => JSON.parse(readFileSync(new URL("../data/published/dashboard.json", import.meta.url), "utf8"));

test("legacy health field names are normalised and omitted sources are included", () => {
  const payload = fixture();
  payload.dataHealth = { overallHealth: "partial", summary: "old alias", sources: [] };
  const result = normalizeDashboard(payload);
  assert.equal(result.dataHealth.overall, "partial");
  assert.ok(result.dataHealth.note.includes("successful retrieval"));
  assert.ok(result.dataHealth.sources.some((item) => item.id === "demand"));
  assert.ok(result.dataHealth.sources.some((item) => item.id.startsWith("regional:")));
});

test("stale OPR affects every dependent analysis without mutating original", () => {
  const payload = fixture();
  payload.sources.opr.status = "stale";
  for (const key of ["forecast", "riskHeatmap", "latestBrief", "decisionGuide", "householdPressure"]) payload[key].status = "fresh";
  const result = normalizeDashboard(payload);
  for (const key of ["forecast", "riskHeatmap", "latestBrief", "decisionGuide", "householdPressure"]) {
    assert.notEqual(result[key].status, "fresh");
    assert.ok(result.inputHealth[key].staleInputs.includes("opr"));
  }
  assert.equal(result.structuralBreaks.indicators.opr.status, "stale");
  assert.equal(payload.latestBrief.status, "fresh");
});

test("fallback is explicit across derived health and does not alter figures", () => {
  const payload = fixture();
  payload.usingFallback = true;
  const result = normalizeDashboard(payload);
  assert.equal(result.health, "fallback");
  assert.equal(result.dataHealth.overall, "fallback");
  assert.equal(result.forecast.inputHealth.status, "fallback");
  assert.deepEqual(result.forecast.points, payload.forecast.points);
  assert.deepEqual(result.series, payload.series);
});

test("failed analysis stays non-fresh even with successful source inputs", () => {
  const payload = fixture();
  for (const source of Object.values(payload.sources)) source.status = "fresh";
  payload.forecast.status = "stale";
  assert.equal(normalizeDashboard(payload).forecast.status, "stale");
});

test("legacy failed-attempt times are never described as successful retrievals", () => {
  const payload = fixture();
  payload.sources.opr.status = "stale";
  payload.sources.opr.retrievedAt = "2026-10-04T11:16:32Z";
  delete payload.sources.opr.lastAttemptAt;
  const result = normalizeDashboard(payload);
  assert.equal(result.sources.opr.retrievedAt, null);
  assert.equal(result.sources.opr.lastAttemptAt, "2026-10-04T11:16:32Z");
  assert.equal(result.dataHealth.sources.find((source) => source.id === "opr").retrievedAt, null);
  assert.equal(payload.sources.opr.retrievedAt, "2026-10-04T11:16:32Z");
});
