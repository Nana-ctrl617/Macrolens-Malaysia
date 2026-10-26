import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { weightedPressure, pressureSummary } from "../app/lib/score-method.ts";
import { validateDashboardIntegrity } from "../app/lib/dashboard-integrity.ts";
import { normalizeDashboard } from "../app/lib/dashboard-health.ts";
import { viewSource, functionSource } from './source-owners.mjs';

const fixture = () => JSON.parse(readFileSync(new URL("../data/published/dashboard.json", import.meta.url), "utf8"));
const compactCss = readFileSync(new URL("../app/compact-dashboard.css", import.meta.url), "utf8");
const level = (value) => value == null ? "unavailable" : value >= 70 ? "high" : value >= 40 ? "moderate" : "low";
const unavailable = (item) => ({ ...item, score: null, level: "unavailable", dataStatus: "unavailable", unavailableReason: "Required score input not supplied.", evidence: "Unavailable: required score input not supplied." });
function withMissing(indices) {
  const data = fixture();
  const risk = data.riskHeatmap;
  risk.items = risk.items.map((item, index) => indices.includes(index) ? unavailable(item) : item);
  const values = risk.items.map((item) => item.score).filter((score) => typeof score === "number");
  risk.overallScore = values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1)) : null;
  risk.overallLevel = level(risk.overallScore);
  risk.availableCount = values.length;
  risk.totalCount = risk.items.length;
  risk.coverageNote = "Weights renormalized over available signals; unavailable signals are excluded.";
  risk.status = values.length ? "partial" : "unavailable";
  return data;
}

const require = createRequire(import.meta.url);
const modules = new Map();
const riskState={values:[],cursor:0};
globalThis.__riskDisclosureState=riskState;
const riskHooks=`data:text/javascript;base64,${Buffer.from('export const useState=initial=>{const state=globalThis.__riskDisclosureState,index=state.cursor++;if(!(index in state.values))state.values[index]=typeof initial==="function"?initial():initial;return[state.values[index],next=>{state.values[index]=typeof next==="function"?next(state.values[index]):next;}];};').toString('base64')}`;
const imageShim=`import {createElement} from ${JSON.stringify(pathToFileURL(require.resolve('react')).href)}; export default function Image(props){const attributes=Object.fromEntries(Object.entries(props).filter(([key])=>key!=='priority'&&key!=='unoptimized')); return createElement('img',attributes);}`;
const imageShimUrl=`data:text/javascript;base64,${Buffer.from(imageShim).toString('base64')}`;
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
async function sourceModule(filename) {
  if (modules.has(filename)) return modules.get(filename);
  let output = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  output = output.replace(/import\s+["'][^"']+\.css["'];?\s*/g, "");
  for (const match of [...output.matchAll(/from\s+(["'])([^"']+)\1/g)]) {
    const specifier = match[2];
    let resolved;
    if(specifier==='react'&&filename.endsWith('RiskView.tsx'))resolved=riskHooks;
    else if(specifier==='next/image')resolved=imageShimUrl;
    else if (specifier.startsWith("@/") || specifier.startsWith(".")) {
      const base = specifier.startsWith("@/") ? fileURLToPath(new URL(`../${specifier.slice(2)}`, import.meta.url)) : fileURLToPath(new URL(specifier, pathToFileURL(filename)));
      const target = [base, `${base}.ts`, `${base}.tsx`].find(existsSync);
      if (!target) throw new Error(`Missing risk component dependency: ${specifier}`);
      resolved = await sourceModule(target);
    } else resolved = pathToFileURL(require.resolve(specifier)).href;
    output = output.replaceAll(`${match[1]}${specifier}${match[1]}`, JSON.stringify(resolved));
  }
  const url = `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`;
  modules.set(filename, url);
  return url;
}
async function renderRisk(risk) {
  const Risk = (await import(await sourceModule(fileURLToPath(new URL("../app/components/RiskScoreVisual.tsx", import.meta.url))))).default;
  return renderToStaticMarkup(createElement(Risk, risk));
}
async function pageRiskRendering(dashboard, snapshot = false) {
  if (!snapshot) {
    const { RiskHeatmapSection } = await import(await sourceModule(fileURLToPath(new URL('../app/views/RiskView.tsx', import.meta.url))));
    riskState.values=[];
    const render=()=>{riskState.cursor=0;return RiskHeatmapSection({dashboard});};
    let tree=render();
    const closed=renderToStaticMarkup(tree);
    assert.doesNotMatch(closed,/class="risk-table-wrap"|<table/,'Risk exact rows are not mounted before disclosure');
    const disclosure=nodes(tree).find(node=>node.type==='details'&&node.props.className==='dashboard-details visual-audit');
    assert.ok(disclosure,'exact Risk audit is accessible on demand');
    disclosure.props.onToggle({currentTarget:{open:true}});tree=render();
    const opened=renderToStaticMarkup(tree);
    assert.match(opened,/class="risk-table-wrap"/,'opening retains the production Risk audit');
    disclosure.props.onToggle({currentTarget:{open:false}});
    assert.doesNotMatch(renderToStaticMarkup(render()),/class="risk-table-wrap"|<table/,'closing unmounts the exact rows');
    return opened;
  }
  const source = viewSource('Snapshot');
  const declaration = (name) => functionSource('lib/dashboard-format.ts', name);
  let body;
  const link = source.match(/<a href="\/risk"><span>Risk heatmap →<\/span><strong>[^\n]+?<\/a>/)?.[0];
  assert.ok(link, "Missing Snapshot Risk link");
  body = `${declaration("levelLabel")} export default function SnapshotRisk({dashboard}) { return ${link}; }`;
  let output = ts.transpileModule(body, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  output = output.replaceAll('"react/jsx-runtime"', JSON.stringify(pathToFileURL(require.resolve("react/jsx-runtime")).href));
  const Component = (await import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`)).default;
  return renderToStaticMarkup(createElement(Component, { dashboard }));
}

test("weights exclude explicitly unavailable scores and retain genuine zero", () => {
  const items = [{ id: "zero", score: 0, level: "low" }, { id: "available", score: 60, level: "moderate" }, { id: "missing", score: null, level: "unavailable", dataStatus: "unavailable" }];
  assert.equal(weightedPressure(items, "missing", 2), 30);
  assert.equal(weightedPressure(items, "zero", 2), 20);
  assert.equal(weightedPressure(items, "available", 0), 0);
  assert.deepEqual(pressureSummary(items), { valid: true, availableCount: 2, totalCount: 3, score: 30 });
  assert.equal(weightedPressure([items[2]], "missing", 1), null);
});

test("weighted calculations reject malformed scores rather than coercing or clipping them", () => {
  for (const score of ["0", undefined, NaN, Infinity, -1, 101]) assert.equal(weightedPressure([{ id: "invalid", score }], "invalid", 1), null);
  assert.equal(weightedPressure([{ id: "invalid", score: 0, level: "unavailable" }], "invalid", 1), null);
  assert.equal(weightedPressure([{ id: "invalid", score: null, level: "low" }], "invalid", 1), null);
  assert.equal(weightedPressure([{ id: "valid", score: 0 }], "valid", -1), null);
});

test("legacy complete Risk payloads and controlled partial/all-missing payloads validate", () => {
  const legacy = fixture();
  for (const key of ["availableCount", "totalCount", "coverageNote"]) delete legacy.riskHeatmap[key];
  assert.equal(validateDashboardIntegrity(legacy), true);
  assert.equal(validateDashboardIntegrity(withMissing([6, 8])), true);
  assert.equal(validateDashboardIntegrity(withMissing([0, 1, 2, 3, 4, 5, 6, 7, 8])), true);
});

test("Risk validation rejects invalid availability, coverage and summary numbers", () => {
  for (const mutate of [
    (risk) => { risk.items[0].score = "0"; },
    (risk) => { risk.items[0].score = NaN; },
    (risk) => { risk.items[0].score = Infinity; },
    (risk) => { risk.items[0].score = -1; },
    (risk) => { risk.items[0].score = 101; },
    (risk) => { delete risk.items[0].score; },
    (risk) => { risk.items[0].level = "unavailable"; },
    (risk) => { risk.items[6].level = "low"; },
    (risk) => { delete risk.items[6].unavailableReason; },
    (risk) => { risk.items[6].dataStatus = "fresh"; },
    (risk) => { risk.overallScore = 0; },
    (risk) => { risk.overallLevel = "high"; },
    (risk) => { risk.availableCount = 9; },
    (risk) => { risk.totalCount = 8; },
    (risk) => { risk.status = "fresh"; },
    (risk) => { delete risk.availableCount; },
    (risk) => { delete risk.totalCount; },
    (risk) => { delete risk.coverageNote; },
    (risk) => { risk.items[1].id = risk.items[0].id; },
    (risk) => { risk.items.pop(); },
  ]) {
    const data = withMissing([6, 8]);
    mutate(data.riskHeatmap);
    assert.equal(validateDashboardIntegrity(data), false, mutate.toString());
  }
  const missing = withMissing([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  missing.riskHeatmap.overallScore = 0;
  assert.equal(validateDashboardIntegrity(missing), false);
  const complete = fixture();
  complete.riskHeatmap.status = "unavailable";
  assert.equal(validateDashboardIntegrity(complete), false);
});

test("numeric growth risk keeps demand-source status rather than borrowing production status", () => {
  for (const demandStatus of ["fresh", "stale"]) {
    const data = fixture();
    data.growthDrivers.demand.status = demandStatus;
    data.growthDrivers.production.status = demandStatus === "fresh" ? "stale" : "fresh";
    const item = data.riskHeatmap.items.find((item) => item.id === "growth");
    item.dataStatus = "fresh";
    assert.equal(normalizeDashboard(data).riskHeatmap.items.find((item) => item.id === "growth").dataStatus, demandStatus);
  }
});

test("health normalization never relabels missing score inputs as fresh or fallback", () => {
  for (const fallback of [false, true]) {
    const data = withMissing([0, 6]);
    for (const source of Object.values(data.sources)) source.status = "fresh";
    data.usingFallback = fallback;
    const original = structuredClone(data);
    const normalized = normalizeDashboard(data);
    for (const index of [0, 6]) {
      assert.equal(normalized.riskHeatmap.items[index].score, null);
      assert.equal(normalized.riskHeatmap.items[index].level, "unavailable");
      assert.equal(normalized.riskHeatmap.items[index].dataStatus, "unavailable");
      assert.ok(normalized.riskHeatmap.items[index].unavailableReason);
    }
    assert.notEqual(normalized.inputHealth.riskHeatmap.status, "fresh");
    assert.match(normalized.inputHealth.riskHeatmap.note, /7 of 9|7\/9/);
    assert.deepEqual(data, original);
  }
});

test("partial Risk rendering names unavailable signals without numeric bars or contributions", async () => {
  const risk = withMissing([0, 6]).riskHeatmap;
  const html = await renderRisk(risk);
  assert.match(html, /7 of 9/);
  assert.match(html, /renormalis|renormaliz/);
  assert.match(html, /aria-label="Headline inflation: Unavailable\./);
  assert.doesNotMatch(html, /aria-label="Headline inflation: Unavailable out of 100/);
  assert.match(html, /Required score input not supplied/);
  assert.match(html, /Not included in the overall mean/);
  assert.equal((html.match(/class="score-visual-fill"/g) ?? []).length, 7);
  assert.doesNotMatch(html, /Unavailable \/ 100/);
  assert.doesNotMatch(html, /14\.3%[^<]*missing/);
});

test("all-missing Risk rendering is literal Unavailable, not a zero pressure screen", async () => {
  const risk = withMissing([0, 1, 2, 3, 4, 5, 6, 7, 8]).riskHeatmap;
  const html = await renderRisk(risk);
  assert.match(html, /0 of 9/);
  assert.match(html, /Overall rule-based index <strong>Unavailable<\/strong>/);
  assert.match(html, /index-point score, not a percentage chance of crisis or loss/);
  assert.doesNotMatch(html, /class="score-visual-fill"/);
  assert.doesNotMatch(html, /width:0%/);
  assert.doesNotMatch(html, /0\.0 \/ 100|Unavailable \/ 100|0\.00 points/);
  assert.match(html, /No available scores to average/);
});

test("genuine zero rendering stays numeric and contributes a valid zero", async () => {
  const risk = fixture().riskHeatmap;
  for (const item of risk.items) { item.score = 0; item.level = "low"; item.dataStatus = "fresh"; }
  risk.overallScore = 0; risk.overallLevel = "low"; risk.availableCount = 9; risk.totalCount = 9;
  const html = await renderRisk(risk);
  assert.match(html, /0\.0 \/ 100/);
  assert.match(html, /9 of 9/);
  assert.match(html, /0\.00 points/);
  assert.match(html, /index-point score, not a percentage chance of crisis or loss/);
  assert.equal((html.match(/class="score-visual-fill"/g) ?? []).length, 9);
  assert.match(html, /Headline inflation: 0\.0 out of 100/);
});

test("Risk periods identify monthly, exact-date and annual reference periods", async () => {
  const risk = structuredClone(fixture().riskHeatmap);
  risk.items.find((item) => item.id === "mgs").period = "2026-10-01";
  risk.items.find((item) => item.id === "bursa").period = "2026-10-01";
  const html = await renderRisk(risk);
  assert.match(html, /Observation period: Aug 2026/);
  assert.match(html, /Observation period: 3 Sept 2026/);
  assert.match(html, /Observation period: 1 Oct 2026/);
  assert.match(html, /Observation period: Year 2025 \(annual\)/);
  assert.doesNotMatch(html, /Observation period: 2026-08-01/);
});

test("heatmap availability uses the same literal labels and exclusions as ranked bars", async () => {
  for (const indices of [[0, 6], [0, 1, 2, 3, 4, 5, 6, 7, 8]]) {
    const html = await renderRisk({ ...withMissing(indices).riskHeatmap, initialView: "matrix" });
    assert.match(html, /Interactive pressure heatmap/);
    assert.match(html, /aria-label="Headline inflation: Unavailable\./);
    assert.doesNotMatch(html, /Unavailable(?: out of|(?:<small>)? \/) 100/);
    assert.equal((html.match(/class="score-visual-cell unavailable"/g) ?? []).length, indices.length);
    assert.match(html, /Required score input not supplied/);
  }
});

test("Risk audit table and Snapshot preserve unavailable scores during fallback", async () => {
  for (const indices of [[0, 6], [0, 1, 2, 3, 4, 5, 6, 7, 8]]) {
    const data = withMissing(indices);
    data.usingFallback = true;
    const html = await pageRiskRendering(data);
    const table = html.slice(html.indexOf('<div class="risk-table-wrap">'));
  assert.equal((table.match(/<td data-label="Score">Unavailable<\/td>/g) ?? []).length, indices.length);
    assert.equal((table.match(/Input unavailable<\/td>/g) ?? []).length, indices.length);
    assert.match(table, /risk-pill unavailable">Unavailable/);
    assert.match(html, /Headline inflation: Unavailable\./);
    if (indices.length === 9) {
      const snapshot = await pageRiskRendering(data, true);
      assert.match(snapshot, /<strong>Unavailable<\/strong>/);
      assert.doesNotMatch(snapshot, /0\.0|Unavailable pressure/);
    }
  }
  const completeTable = await pageRiskRendering(fixture());
  assert.match(completeTable, /<td data-label="Period \/ status">Aug 2026<br\/>Fresh inputs<\/td>/);
  assert.match(completeTable, /<td data-label="Period \/ status">Year 2025 \(annual\)<br\/>Fresh inputs<\/td>/);
  assert.doesNotMatch(completeTable, /<td data-label="Period \/ status">2026-08-01<\/td>/);
});

test("Risk signals link to the validated source metadata for each input", async () => {
  const dashboard = fixture();
  const sourceIds = {
    headline: ["headline"], core: ["core"], unemployment: ["unemployment"], opr: ["opr"], fx: ["fx"], mgs: ["mgs"],
    bursa: ["market"], growth: ["demand", "growthDrivers.demand"], trade: ["externalSector"],
  };
  for (const candidate of [dashboard, normalizeDashboard(dashboard)]) {
    const html = await pageRiskRendering(candidate);
    assert.match(html, /<th scope="col">Source<\/th>/);
    for (const item of dashboard.riskHeatmap.items) {
      const source = candidate.dataHealth.sources.find((row) => sourceIds[item.id].includes(row.id));
      assert.ok(source?.sourceUrl, `Missing validated source URL for ${item.id} in ${candidate === dashboard ? "raw" : "normalized"} metadata`);
      assert.ok(html.includes(`href="${source.sourceUrl}"`), `Risk page does not render the source for ${item.id}`);
      assert.ok(source?.retrievedAt, `Missing retrieval time for ${item.id}`);
    }
    assert.equal((html.match(/Last successful retrieval:/g) ?? []).length, 9);
    assert.match(html, /Last successful retrieval: [^<]+ MYT/);
  }
  assert.match(await pageRiskRendering(normalizeDashboard(dashboard)), /href="https:\/\/data\.gov\.my\/data-catalogue\/gdp_qtr_nominal_demand"/);
});

test("Risk audit table keeps a compact scan and progressively reveals analysis on mobile", async () => {
  const html = await pageRiskRendering(fixture());
  for (const label of ["Signal", "Period / status", "Score", "Level", "Analysis", "Source"]) {
    assert.equal((html.match(new RegExp(`data-label="${label}"`, "g")) ?? []).length, 9, `Every signal row needs a ${label} label`);
  }
  const table = html.slice(html.indexOf('<div class="risk-table-wrap">'));
  assert.equal((table.match(/<th scope="col">/g) ?? []).length, 6);
  assert.equal((table.match(/<summary>Evidence and scoring<\/summary>/g) ?? []).length, 9);
  for (const label of ["Evidence", "Scoring rule", "What to watch"]) assert.equal((table.match(new RegExp(`<dt>${label}<\\/dt>`, "g")) ?? []).length, 9);
  const mobileRules = compactCss.slice(compactCss.indexOf("/* Keep the expanded Risk audit"));
  assert.match(mobileRules, /\.risk-table-wrap table \{ display:block;[^}]*min-width:0/);
  assert.match(mobileRules, /\.risk-table-wrap td::before \{ content:attr\(data-label\)/);
  assert.match(mobileRules, /td\[data-label="Analysis"\] summary \{[^}]*min-height:44px/);
  assert.match(mobileRules, /td\[data-label="Source"\] \{ grid-column:1\/-1; \}/);
});

test("malformed or inconsistent Risk summaries fail closed in direct component rendering", async () => {
  for (const mutate of [
    (risk) => { risk.overallScore = 100; },
    (risk) => { risk.items[0].score = "0"; },
    (risk) => { risk.items[0].score = NaN; },
    (risk) => { risk.items[0].level = "unknown"; },
    (risk) => { risk.items[0].dataStatus = 5; },
    (risk) => { risk.items[6].unavailableReason = 5; },
    (risk) => { risk.availableCount = 9; },
  ]) {
    const risk = withMissing([6]).riskHeatmap;
    mutate(risk);
    const html = await renderRisk(risk);
    assert.match(html, /Risk summary unavailable/);
    assert.doesNotMatch(html, /Overall <strong>|class="score-visual-fill"/);
  }
});
