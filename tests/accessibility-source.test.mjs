import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { appSource, viewSource, functionSource } from './source-owners.mjs';

const explorer = functionSource('components/IndicatorDetail.tsx', 'IndicatorDetail');

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
  const card = functionSource('views/SnapshotView.tsx', 'MetricCard');
  assert.match(card, /aria-label=\{`Open historical data for \$\{metric\.label\}\. \$\{metric\.value\}/);
  assert.match(card, /Release period: \$\{metric\.period\}/);
  assert.match(card, /Data status: \$\{metric\.status/);
});

test("diagnostic navigation carries the selected indicator to a validated query reader", () => {
  assert.match(explorer, /href=\{`\/structural\?indicator=\$\{metric\.id\}`\}/);
  assert.doesNotMatch(explorer, /href="#structural"/);
  assert.match(viewSource('Structural'), /new URLSearchParams\(window\.location\.search\)\.get\("indicator"\)/);
  assert.match(viewSource('Structural'), /Object\.hasOwn\(structuralLabels, requested\)/);
});

test("main route headings are semantic h1 elements", () => {
  for (const [owner, heading] of [['Snapshot', "Malaysia’s economy at a glance"], ['Brief', "Latest economic brief"], ['Risk', "Where pressure is building"], ['Forecast', "Three months ahead"], ['Structural', "When the pattern changed"], ['Health', "Source freshness and validation audit"], ['Methodology', "Built to be questioned."]]) {
    assert.ok(viewSource(owner).includes(`<h1>${heading}</h1>`), `Missing h1 in ${owner}: ${heading}`);
  }
});

test("regional chart rows retain their individual value and source semantics", () => {
  const regional = readFileSync(new URL("../app/components/RegionalLensView.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(regional, /className="regional-bars" role="img"/);
  assert.match(regional, /className="regional-bars" role="list"/);
  assert.match(regional, /role="listitem"/);
  assert.match(regional, /Source: \$\{item\.sourceLabel\}\. Data status/);
  assert.match(regional, /aria-pressed=\{selected.view === "chart"\}/);
  assert.match(regional, /aria-pressed=\{selected.view === "table"\}/);
});

test("range and measure buttons expose their selected state", () => {
  assert.match(explorer, /aria-pressed=\{range === option\}/);
  assert.match(viewSource('Bursa'), /aria-pressed=\{range === item\}/);
  assert.match(viewSource('External'), /aria-pressed=\{metric === item\}/);
  assert.match(viewSource('Structure'), /aria-pressed=\{view === "production"\}/);
  assert.match(viewSource('Decisions'), /aria-pressed=\{audience === "individuals"\}/);
});

test("data health uses canonical status and separates last success from attempt", () => {
  const page = viewSource('Health');
  assert.doesNotMatch(page, /levelLabel\(health\.overall\)/);
  assert.match(page, /healthStatusLabel\(health\.overall\)/);
  assert.match(page, /Last successful retrieval/);
  assert.match(page, /Last refresh attempt/);
  assert.match(page, /source\.lastAttemptAt/);
});

test("model output is never labelled an official forecast", () => {
  const page = viewSource('Forecast');
  assert.doesNotMatch(page, /official forecast/i);
  assert.match(page, /MacroLens model forecast/);
});

test("derived pages carry normalized input health and risk cards retain observation context", () => {
  for (const [owner,key] of [['Brief',"latestBrief"], ['Risk',"riskHeatmap"], ['Decisions',"decisionGuide"], ['Household',"householdPressure"], ['Forecast',"forecast"]]) {
    assert.ok(viewSource(owner).includes(`dashboard?.inputHealth?.${key}`), `Missing ${owner} input-health lookup: ${key}`);
  }
  const scoreVisual = readFileSync(new URL("../app/components/RiskScoreVisual.tsx", import.meta.url), "utf8");
  assert.ok(scoreVisual.includes("Observation period:"));
  assert.ok(scoreVisual.includes("Data status:"));
  assert.ok(viewSource('Risk').includes("All signals, scoring rules and observation periods"));
  const riskSection = functionSource('views/RiskView.tsx', 'RiskHeatmapSection');
  assert.match(riskSection, /healthStatusLabel\(item\.score === null \|\| item\.level === "unavailable" \? "unavailable" : dashboard\?\.usingFallback \? "fallback" : item\.dataStatus\)/);
  assert.match(riskSection, /item\.period \? formatDate\(item\.period\) : "Not recorded"/);
  assert.ok(appSource('components/InputHealthNotice.tsx').includes("Inspect source freshness →"));
  for (const owner of ['Brief','Risk','Decisions','Household','Forecast']) assert.doesNotMatch(viewSource(owner), /Latest data included|Latest signals incorporated/);
});
