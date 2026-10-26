import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { normalizeDashboard } from "../app/lib/dashboard-health.ts";

const fixture = () => JSON.parse(readFileSync(new URL("../data/published/dashboard.json", import.meta.url), "utf8"));

test("legacy health field names are normalised and omitted sources are included", () => {
  const payload = fixture();
  payload.health = "fresh";
  payload.dataHealth = { overallHealth: "partial", summary: "old alias", sources: [] };
  const result = normalizeDashboard(payload);
  assert.equal(result.dataHealth.overall, "partial");
  assert.ok(result.dataHealth.note.includes("successful retrieval"));
  assert.ok(result.dataHealth.sources.some((item) => item.id === "demand"));
  assert.ok(result.dataHealth.sources.some((item) => item.id.startsWith("regional:")));
});

test("Data Health uses readable source names, explicit market attribution and unique rows", () => {
  const payload = fixture();
  const result = normalizeDashboard(payload);
  const rows = result.dataHealth.sources;
  const byId = new Map(rows.map((row) => [row.id, row]));
  assert.equal(byId.size, rows.length, "normalized Data Health rows have unique ids");
  assert.equal(byId.get("market")?.label, "FBM KLCI (delayed market prices)");
  assert.equal(byId.get("market")?.source, "Yahoo Finance (delayed market data)");
  assert.equal(byId.get("market")?.sourceUrl, payload.market.benchmark.sourceUrl);
  assert.equal(byId.get("market")?.relatedSource, payload.market.benchmark.benchmarkSource);
  assert.equal(byId.get("market")?.relatedSourceUrl, payload.market.benchmark.benchmarkSourceUrl);
  assert.equal(byId.get("regional:hiesState")?.label, "Household income and spending by state");
  assert.equal(byId.get("regional:nationalIncome")?.source, "Department of Statistics Malaysia via data.gov.my");
  assert.equal(byId.get("regional:nationalExpenditure")?.label, "National household spending benchmark");
  assert.equal(rows.filter((row) => row.id === "regional:nationalExpenditure").length, 1);
  assert.ok(rows.every((row) => row.label !== row.id), "internal ids are not presented as user-facing source names");
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
  assert.deepEqual(result.series.headline.points, payload.series.headline.points);
  assert.deepEqual(result.series.mgs.points, payload.series.mgs.points);
});

test("legacy MGS snapshots with monthly-spaced observations are never called a daily trading-day history", () => {
  const payload = fixture();
  delete payload.series.mgs.historyCoverage;
  delete payload.sources.mgs.historyCoverage;
  payload.series.mgs.frequency = "Trading days";
  // The checked-in dashboard now contains daily history, so make the legacy
  // monthly-only shape explicit instead of relying on the live fixture cadence.
  payload.series.mgs.points = [
    { date: "2025-01-31", value: 3.72 },
    { date: "2025-02-28", value: 3.70 },
    { date: "2025-03-31", value: 3.69 },
    { date: "2025-04-30", value: 3.68 },
    { date: "2025-05-31", value: 3.66 },
    { date: "2025-06-30", value: 3.65 },
  ];
  const result = normalizeDashboard(payload);
  assert.equal(result.series.mgs.frequency, "Mixed cadence; daily history not yet verified");
  assert.equal(result.series.mgs.historyCoverage.status, "partial");
  assert.equal(result.series.mgs.historyCoverage.requests, null);
  assert.match(result.series.mgs.historyCoverage.message, /not a verified complete daily trading-day history/);
  assert.equal(result.dataHealth.sources.find((source) => source.id === "mgsDailyHistory")?.status, "partial");
  assert.equal(result.health, "partial");
  assert.equal(payload.series.mgs.frequency, "Trading days", "normalization does not mutate the original artifact");
});

test("a completed MGS history remains a fresh daily series in the current artifact", () => {
  const payload = fixture();
  const result = normalizeDashboard(payload);
  const coverage = result.series.mgs.historyCoverage;

  assert.equal(coverage?.completed, true);
  assert.equal(coverage?.status, "fresh");
  assert.equal(result.series.mgs.frequency, "Trading days");
  assert.equal(result.dataHealth.sources.find((source) => source.id === "mgsDailyHistory")?.status, "fresh");
  assert.equal(result.dataHealth.overall, "fresh");
  assert.match(coverage?.message ?? "", /complete from November 2021/i);
});

test("data health gives partial MGS history an explicit BNM label and source link", () => {
  const payload = JSON.parse(readFileSync(new URL("../data/published/dashboard.json", import.meta.url), "utf8"));
  const health = normalizeDashboard(payload).dataHealth;
  const history = health.sources.find((source) => source.id === "mgsDailyHistory");
  const coverage = payload.series.mgs.historyCoverage;
  assert.equal(history.label, "10-year MGS historical coverage");
  assert.equal(history.source, "Bank Negara Malaysia (BNM) Financial Markets");
  assert.equal(history.sourceUrl, "https://financialmarkets.bnm.gov.my/benchmark-yields");
  assert.equal(history.observationPeriod, coverage.throughDate);
  if (coverage.completed) {
    assert.equal(history.retrievedAt, coverage.retrievedAt, "a completed backfill records its successful retrieval");
    assert.equal(history.lastAttemptAt, undefined, "a completed backfill is not described as a partial checkpoint");
  } else {
    assert.equal(history.retrievedAt, null, "checkpoint time is not mislabelled as a complete history retrieval");
    assert.equal(history.lastAttemptAt, coverage.retrievedAt);
  }
  assert.equal(health.mgsDailyHistory.status, coverage.status);
  assert.equal(health.mgsDailyHistory.startDate, coverage.startDate);
  assert.equal(health.mgsDailyHistory.throughDate, coverage.throughDate);
  assert.equal(health.mgsDailyHistory.latestObservationDate, payload.series.mgs.points.at(-1).date);
  assert.equal(health.mgsDailyHistory.requests, coverage.requests);
  assert.equal(health.mgsDailyHistory.observations, coverage.observations);
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

test("Data Health restores source links from the validated series and carries recency rules", () => {
  const payload = fixture();
  delete payload.sources.headline.sourceUrl;
  delete payload.sources.headline.label;
  payload.sources.headline.freshness = {
    basis: "observation-recency", observationAgeDays: 24, maximumObservationAgeDays: 100,
    note: "Conservative source-age check; not a release calendar.",
  };
  const result = normalizeDashboard(payload);
  const headline = result.dataHealth.sources.find((source) => source.id === "headline");
  assert.equal(headline.label, payload.series.headline.title);
  assert.equal(headline.sourceUrl, payload.series.headline.source_url);
  assert.deepEqual(headline.freshness, payload.sources.headline.freshness);
});
