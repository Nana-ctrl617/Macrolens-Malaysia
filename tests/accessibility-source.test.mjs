import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const explorer = page.slice(page.indexOf("function IndicatorDetail("), page.indexOf("const structuralLabels"));

test("explorer manages focus and background inertness with a stable mount lifecycle", () => {
  assert.match(explorer, /closeRef\.current = onClose/);
  assert.match(explorer, /panelRef = useRef/);
  assert.match(explorer, /previousFocus/);
  assert.match(explorer, /element\.inert = true/);
  assert.match(explorer, /element\.inert = wasInert/);
  assert.match(explorer, /event\.key === "Tab"/);
  assert.match(explorer, /event\.shiftKey/);
  assert.match(explorer, /previousFocus\.focus\(\)/);
  assert.doesNotMatch(explorer, /\}, \[onClose\]\)/);
});

test("KPI accessible names include value, release date and status", () => {
  const card = page.slice(page.indexOf("function MetricCard("), page.indexOf("function IndicatorDetail("));
  assert.match(card, /aria-label=\{`Open historical data for \$\{metric\.label\}\. \$\{metric\.value\}/);
  assert.match(card, /Release period: \$\{metric\.period\}/);
  assert.match(card, /Data status: \$\{metric\.status/);
});

test("diagnostic navigation carries the selected indicator to a validated query reader", () => {
  assert.match(explorer, /href=\{`\/structural\?indicator=\$\{metric\.id\}`\}/);
  assert.doesNotMatch(explorer, /href="#structural"/);
  assert.match(page, /new URLSearchParams\(window\.location\.search\)\.get\("indicator"\)/);
  assert.match(page, /Object\.hasOwn\(structuralLabels, requested\)/);
});

test("main route headings are semantic h1 elements", () => {
  for (const heading of ["Malaysia’s economy at a glance", "Latest economic brief", "Where pressure is building", "Three months ahead", "When the pattern changed", "Source freshness and validation audit", "Built to be questioned."]) {
    assert.ok(page.includes(`<h1>${heading}</h1>`), `Missing h1: ${heading}`);
  }
});

test("regional chart rows retain their individual value and source semantics", () => {
  assert.doesNotMatch(page, /className="regional-bars" role="img"/);
  assert.match(page, /className="regional-bars" role="list"/);
  assert.match(page, /role="listitem" aria-label=\{`\$\{item\.state\}/);
  assert.match(page, /Source: \$\{activeSourceName\}\. Observation period: \$\{sourceDate/);
  assert.match(page, /aria-pressed=\{view === "chart"\}/);
  assert.match(page, /aria-pressed=\{view === "table"\}/);
});

test("range and measure buttons expose their selected state", () => {
  assert.match(page, /aria-pressed=\{range === option\}/);
  assert.match(page, /aria-pressed=\{range === item\}/);
  assert.match(page, /aria-pressed=\{metric === item\}/);
  assert.match(page, /aria-pressed=\{view === "production"\}/);
  assert.match(page, /aria-pressed=\{audience === "individuals"\}/);
});

test("data health uses canonical status and separates last success from attempt", () => {
  assert.doesNotMatch(page, /levelLabel\(health\.overall\)/);
  assert.match(page, /healthStatusLabel\(health\.overall\)/);
  assert.match(page, /Last successful retrieval/);
  assert.match(page, /Last refresh attempt/);
  assert.match(page, /source\.lastAttemptAt/);
});

test("model output is never labelled an official forecast", () => {
  assert.doesNotMatch(page, /official forecast/i);
  assert.match(page, /MacroLens model forecast/);
});

test("derived pages carry normalized input health and risk cards retain observation context", () => {
  for (const key of ["latestBrief", "riskHeatmap", "decisionGuide", "householdPressure", "forecast"]) {
    assert.ok(page.includes(`dashboard?.inputHealth?.${key}`), `Missing input-health lookup: ${key}`);
  }
  const scoreVisual = readFileSync(new URL("../app/components/RiskScoreVisual.tsx", import.meta.url), "utf8");
  assert.ok(scoreVisual.includes("Observation period:"));
  assert.ok(scoreVisual.includes("Data status:"));
  assert.ok(page.includes("All signals, scoring rules and observation periods"));
  assert.ok(page.includes('healthStatusLabel(dashboard?.usingFallback ? "fallback" : item.dataStatus)'));
  assert.ok(page.includes("Inspect source freshness →"));
  assert.doesNotMatch(page, /Latest data included|Latest signals incorporated/);
});
