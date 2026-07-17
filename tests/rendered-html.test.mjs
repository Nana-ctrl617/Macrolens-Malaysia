import assert from "node:assert/strict";
import test from "node:test";

process.env.DASHBOARD_DATA_URL = "http://127.0.0.1:9/dashboard.json";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
}

test("renders the MacroLens public dashboard", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /MacroLens Malaysia/);
  assert.match(html, /See the pressure/);
  assert.match(html, /Three months ahead/);
  assert.match(html, /Built to be questioned/);
  assert.match(html, /When the pattern changed/);
  assert.match(html, /Structural shifts/);
  assert.match(html, /Open historical data for Headline inflation/);
  assert.match(html, /View history/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("serves the embedded MGS history without an external request", async () => {
  const response = await render("/api/indicator?id=mgs");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.id, "mgs");
  assert.ok(body.points.length > 50);
  assert.deepEqual(body.points.at(-1), { date: "2026-07-16", value: 3.63 });
});

test("serves a validated consolidated fallback dashboard", async () => {
  const response = await render("/api/dashboard");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.schemaVersion, 2);
  assert.equal(body.usingFallback, true);
  assert.equal(body.forecast.points.length, 3);
  assert.ok(body.series.headline.points.length > 500);
  assert.ok(body.sources.headline.observationPeriod);
  assert.equal(Object.keys(body.structuralBreaks.indicators).length, 6);
  assert.ok(body.structuralBreaks.indicators.core.candidates.length > 0);
});

test("serves structural diagnostics from the indicator payload", async () => {
  const response = await render("/api/indicator?id=core");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.structuralBreaks.indicatorId, "core");
  assert.ok(body.structuralBreaks.candidates[0].chow.pHolm >= body.structuralBreaks.candidates[0].chow.pRaw);
});

test("downloads structural diagnostics as CSV and JSON", async () => {
  const csvResponse = await render("/api/structural-breaks?format=csv");
  assert.equal(csvResponse.status, 200);
  assert.match(csvResponse.headers.get("content-disposition"), /structural-breaks\.csv/);
  assert.match(await csvResponse.text(), /indicator,break_period,status,chow_f/);
  const jsonResponse = await render("/api/structural-breaks?format=json");
  assert.equal(jsonResponse.status, 200);
  const body = await jsonResponse.json();
  assert.equal(body.indicators.unemployment.indicatorId, "unemployment");
});
