import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const moduleUrls = new Map();
async function sourceModule(filename) {
  if (moduleUrls.has(filename)) return moduleUrls.get(filename);
  const source = readFileSync(filename, "utf8");
  let output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  output = output.replace(/import\s+["'][^"']+\.css["'];?\s*/g, "");
  const imports = [...output.matchAll(/from\s+(["'])([^"']+)\1/g)];
  for (const match of imports) {
    const specifier = match[2];
    let resolved;
    if (specifier.startsWith("@/") || specifier.startsWith(".")) {
      const base = specifier.startsWith("@/") ? fileURLToPath(new URL(`../${specifier.slice(2)}`, import.meta.url)) : fileURLToPath(new URL(specifier, pathToFileURL(filename)));
      const target = [base, `${base}.ts`, `${base}.tsx`].find(existsSync);
      if (!target) throw new Error(`Missing component dependency: ${specifier}`);
      resolved = await sourceModule(target);
    } else resolved = pathToFileURL(require.resolve(specifier)).href;
    output = output.replaceAll(`${match[1]}${specifier}${match[1]}`, JSON.stringify(resolved));
  }
  const url = `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`;
  moduleUrls.set(filename, url);
  return url;
}
async function component(name) {
  return (await import(await sourceModule(fileURLToPath(new URL(`../app/components/${name}.tsx`, import.meta.url))))).default;
}
const payload = () => JSON.parse(readFileSync(new URL("../data/published/dashboard.json", import.meta.url), "utf8"));

test("risk visual renders actual scores, input status and selected evidence", async () => {
  const Risk = await component("RiskScoreVisual");
  const data = payload().riskHeatmap;
  const html = renderToStaticMarkup(createElement(Risk, { items:data.items, overallScore:data.overallScore, overallLevel:data.overallLevel }));
  assert.match(html, /Interactive pressure heatmap/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /not a probability/);
  for (const item of data.items) {
    assert.ok(html.includes(item.label));
    assert.ok(html.includes(item.score.toFixed(1)));
  }
  assert.ok(html.includes(data.items[0].evidence));
  assert.match(html, /Scoring rule/);
  assert.match(html, /Observation period/);
});

test("risk visual handles absent observations without inventing scores", async () => {
  const Risk = await component("RiskScoreVisual");
  const html = renderToStaticMarkup(createElement(Risk, { items:[], overallScore:0, overallLevel:"low" }));
  assert.match(html, /No validated pressure scores/);
  assert.doesNotMatch(html, /score-visual-fill/);
});

test("model-error chart uses supplied errors and existing model selection", async () => {
  const Model = await component("ModelErrorVisual");
  const models = [{ name:"Selected candidate", rmse:0.37, mae:0.21, selected:true }, { name:"Baseline", rmse:1.12, mae:0.82, selected:false }];
  const html = renderToStaticMarkup(createElement(Model, { models }));
  assert.match(html, /0\.37 pp/);
  assert.match(html, /1\.12 pp/);
  assert.match(html, /Selected model/);
  assert.match(html, /percentage points/);
  assert.match(html, /does not guarantee/);
});

test("model chart labels malformed errors unavailable and keeps empty states honest", async () => {
  const Model = await component("ModelErrorVisual");
  const html = renderToStaticMarkup(createElement(Model, { models:[{ name:"Missing", rmse:NaN, mae:-1, selected:false }] }));
  assert.match(html, /Unavailable/);
  assert.doesNotMatch(html, /NaN|Infinity/);
  assert.match(renderToStaticMarkup(createElement(Model, { models:[] })), /No model errors/);
});

test("brief trend component preserves unit, source, dated values and controls", async () => {
  const Trend = await component("SeriesTrendPanel");
  const data = payload();
  const html = renderToStaticMarkup(createElement(Trend, { series:[data.series.headline], statuses:{headline:"stale"} }));
  assert.match(html, /1 year/);
  assert.match(html, /3 years/);
  assert.match(html, /All history/);
  assert.match(html, /stale/i);
  assert.ok(html.includes(data.series.headline.source));
  assert.ok(html.includes(data.series.headline.source_url.replaceAll("&", "&amp;")));
  assert.match(html, /<svg/);
  assert.match(html, /<table/);
});

test("BOP renders signed published flows and accounting caveat", async () => {
  const Bop = await component("BalancePaymentsVisual");
  const data = payload().balancePayments;
  const html = renderToStaticMarkup(createElement(Bop, { data }));
  assert.match(html, /Current account/);
  assert.match(html, /Financial account/);
  assert.match(html, /<svg/);
  assert.match(html, /billion/);
  assert.match(html, /accounting/i);
  assert.ok(html.includes(data.sourceUrl.replaceAll("&", "&amp;")));
  assert.match(html, /<table/);
});

test("BOP missing balance is unavailable, not a fabricated zero", async () => {
  const Bop = await component("BalancePaymentsVisual");
  const data = payload().balancePayments;
  data.quarters = [{date:"2026-01-01",accounts:[]}];
  const html = renderToStaticMarkup(createElement(Bop, { data }));
  assert.match(html, /Not published|No .*available/i);
  assert.doesNotMatch(html, /NaN|Infinity/);
});

test("all five integrations retain progressive detail and preserve data pipeline", () => {
  const source = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  for (const name of ["RiskScoreVisual", "SeriesTrendPanel", "BalancePaymentsVisual", "ModelErrorVisual"]) assert.ok(source.includes(`<${name}`));
  assert.match(source, /Read the economic brief/);
  assert.match(source, /All signals, scoring rules and observation periods/);
  assert.match(source, /Household scenario checks/);
  assert.match(source, /Exact model-error table/);
  assert.match(source, /InputHealthNotice/);
});
