import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const runtimeKey = "__macrolens_chart_component_test_hooks__";
const reactHooks = `export const useState = (initial) => globalThis[${JSON.stringify(runtimeKey)}].useState(initial); export const useRef = (initial) => globalThis[${JSON.stringify(runtimeKey)}].useRef(initial); export const useId = () => "chart-test"; export const useMemo = (calculate) => calculate(); export const useEffect = () => {};`;
const hookUrl = `data:text/javascript;base64,${Buffer.from(reactHooks).toString("base64")}`;
const modules = new Map();
async function sourceModule(filename) {
  if (modules.has(filename)) return modules.get(filename);
  let output = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  output = output.replace(/import\s+["'][^"']+\.css["'];?\s*/g, "");
  for (const match of [...output.matchAll(/from\s+(["'])([^"']+)\1/g)]) {
    const specifier = match[2];
    let resolved;
    if (specifier === "react") resolved = hookUrl;
    else if (specifier.startsWith("@/") || specifier.startsWith(".")) {
      const base = specifier.startsWith("@/") ? fileURLToPath(new URL(`../${specifier.slice(2)}`, import.meta.url)) : fileURLToPath(new URL(specifier, pathToFileURL(filename)));
      const target = [base, `${base}.ts`, `${base}.tsx`].find(existsSync);
      assert.ok(target, `Missing component dependency ${specifier}`);
      resolved = await sourceModule(target);
    } else resolved = pathToFileURL(require.resolve(specifier)).href;
    output = output.replaceAll(`${match[1]}${specifier}${match[1]}`, JSON.stringify(resolved));
  }
  const url = `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`;
  modules.set(filename, url);
  return url;
}
async function harness(name, props) {
  const Component = (await import(await sourceModule(fileURLToPath(new URL(`../app/components/${name}.tsx`, import.meta.url))))).default;
  const state = [], refs = [];
  const runtime = { cursor: 0, refCursor: 0, useState(initial) { const index = this.cursor++; if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial; return [state[index], (next) => { state[index] = typeof next === "function" ? next(state[index]) : next; }]; }, useRef(initial) { const index=this.refCursor++; if(!(index in refs))refs[index]={current:initial}; return refs[index]; } };
  return { render() { runtime.cursor = 0; runtime.refCursor = 0; globalThis[runtimeKey] = runtime; return Component(props); } };
}
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...nodes(tree.props?.children)];
}
const byClass = (tree, name) => nodes(tree).find((node) => node.props?.className?.split(" ").includes(name));
const live = (tree) => nodes(tree).find((node) => node.props?.role === "status" && node.props?.["aria-live"] === "polite");
function content(tree) {
  if (Array.isArray(tree)) return tree.map(content).join("");
  if (tree == null || typeof tree === "boolean") return "";
  return typeof tree === "object" ? content(tree.props?.children) : String(tree);
}
const keyboard = (key) => ({ key, preventDefault() {} });
const pointer = (clientX, pointerType = "mouse", width = 800) => ({ clientX, pointerType, currentTarget: { getBoundingClientRect: () => ({ left: 0, width }) } });
const series = { key: "headline", title: "Headline inflation", unit: "%", decimals: 1, frequency: "monthly", source: "Official DOSM", source_url: "https://data.gov.my/data-catalogue/cpi_headline", points: [{ date: "2025-01-01", value: 0 }, { date: "2025-02-01", value: -1 }, { date: "2025-04-01", value: 3 }] };
const fixture = () => JSON.parse(readFileSync(new URL("../data/published/dashboard.json", import.meta.url), "utf8"));

test("Series trend keyboard, mouse and touch use one persistent exact-value description", async () => {
  const view = await harness("SeriesTrendPanel", { series: [series], statuses: { headline: "stale" } });
  let tree = view.render();
  const statusId = live(tree)?.props.id;
  assert.ok(statusId, "A persistent named status is required");
  assert.match(content(live(tree)), /Official DOSM.*stale/);
  byClass(tree, "series-trend-plot").props.onKeyDown(keyboard("Home"));
  tree = view.render();
  const first = content(live(tree));
  assert.match(first, /Jan 2025.*0\.0%|0\.0%.*Jan 2025/);
  byClass(tree, "series-trend-plot").props.onPointerMove(pointer(110));
  assert.equal(content(live(view.render())), first);
  byClass(view.render(), "series-trend-plot").props.onPointerDown(pointer(110, "touch"));
  assert.equal(content(live(view.render())), first);
  byClass(view.render(), "series-trend-plot").props.onKeyDown(keyboard("End"));
  tree = view.render();
  const last = content(live(tree));
  assert.match(last, /3\.0%/);
  byClass(tree, "series-trend-plot").props.onKeyDown(keyboard("Escape"));
  tree = view.render();
  assert.equal(live(tree).props.id, statusId);
  assert.ok(content(live(tree)).includes(last.split(". Marker")[0]));
  assert.equal(byClass(tree, "series-trend-guide"), undefined);
  assert.ok(nodes(tree).some((node) => node.type === "input" && node.props.type === "range"));
  byClass(tree, "series-trend-plot").props.onPointerDown(pointer(110, "touch", 0));
  assert.match(content(live(view.render())), /3\.0%/);
});

test("Series empty states retain a live description without invented observations", async () => {
  for (const items of [[], [{ ...series, points: [] }]]) {
    const tree = (await harness("SeriesTrendPanel", { series: items })).render();
    assert.ok(live(tree));
    assert.match(content(live(tree)), /No .*available/);
    assert.equal(byClass(tree, "series-trend-guide"), undefined);
  }
});

test("BOP inspection parity preserves missing balance and zero while Escape only hides marker", async () => {
  const data = { ...fixture().balancePayments, quarters: [{ date: "2025-01-01", accounts: [{ id: "ca", name: "Current account", balance: 0 }] }, { date: "2025-04-01", accounts: [{ id: "ca", name: "Current account", balance: -1.25 }] }, { date: "2025-07-01", accounts: [{ id: "ca", name: "Current account", balance: null }] }] };
  const original = structuredClone(data);
  const view = await harness("BalancePaymentsVisual", { data });
  let tree = view.render();
  assert.match(content(live(tree)), /Not published/);
  assert.match(content(live(tree)), /Source:/);
  byClass(tree, "bop-trend-frame").props.onKeyDown(keyboard("Home"));
  tree = view.render();
  const first = content(live(tree));
  assert.match(first, /Q1 2025.*RM 0 billion/);
  nodes(tree).find((node) => node.type === "svg").props.onPointerMove(pointer(110));
  assert.equal(content(live(view.render())), first);
  nodes(view.render()).find((node) => node.type === "svg").props.onPointerDown(pointer(110, "touch"));
  assert.equal(content(live(view.render())), first);
  byClass(view.render(), "bop-trend-frame").props.onKeyDown(keyboard("ArrowRight"));
  tree = view.render();
  assert.match(content(live(tree)), /RM -1\.25 billion/);
  byClass(tree, "bop-trend-frame").props.onKeyDown(keyboard("Escape"));
  tree = view.render();
  assert.match(content(live(tree)), /RM -1\.25 billion/);
  assert.equal(byClass(tree, "bop-selection-line"), undefined);
  assert.ok(nodes(tree).some((node) => node.type === "select" && node.props.id.endsWith("-quarter")));
  assert.deepEqual(data, original);
});

test("BOP unavailable source retains a persistent live state and source access", async () => {
  const data = { ...fixture().balancePayments, quarters: [], status: "unavailable" };
  const tree = (await harness("BalancePaymentsVisual", { data })).render();
  assert.ok(live(tree));
  assert.match(content(live(tree)), /No published quarterly balances.*Source unavailable/);
  assert.ok(nodes(tree).some((node) => node.type === "a" && node.props.href === data.sourceUrl));
});

test("BOP unpublished middle quarter is inspectable and labelled, never silently zero", async () => {
  const data = { ...fixture().balancePayments, quarters: [
    { date: '2025-01-01', accounts: [{ id: 'ca', name: 'Current account', balance: 1 }] },
    { date: '2025-04-01', accounts: [{ id: 'fa', name: 'Financial account', balance: -1 }] },
    { date: '2025-07-01', accounts: [{ id: 'ca', name: 'Current account', balance: 2 }] },
  ] };
  const view = await harness('BalancePaymentsVisual', { data });
  byClass(view.render(), 'bop-trend-frame').props.onKeyDown(keyboard('Home'));
  byClass(view.render(), 'bop-trend-frame').props.onKeyDown(keyboard('ArrowRight'));
  let tree = view.render();
  assert.match(content(live(tree)), /Q2 2025.*Not published/);
  assert.doesNotMatch(content(live(tree)), /RM 0 billion/);
  assert.equal(byClass(tree, 'bop-active-dot'), undefined);
  byClass(tree, 'bop-data-details').props.onToggle({ currentTarget: { open: true } });
  tree = view.render();
  assert.ok(nodes(tree).some(node => node.props?.['aria-label'] === 'Not published'), 'unpublished table cell has the same accessible label');
});

test("BOP disclosure mounts exact signed quarterly data only after opening", async () => {
  const data = { ...fixture().balancePayments, quarters: [
    { date: '2025-01-01', accounts: [{ id: 'ca', name: 'Current account', balance: 0 }, { id: 'fa', name: 'Financial account', balance: -1.25 }] },
    { date: '2025-04-01', accounts: [{ id: 'ca', name: 'Current account', balance: 2 }] },
    { date: '2025-07-01', accounts: [{ id: 'ca', name: 'Current account', balance: null }] },
  ] };
  const original = structuredClone(data);
  const view = await harness('BalancePaymentsVisual', { data });
  let tree = view.render();
  assert.equal(nodes(tree).find(node => node.type === 'table'), undefined);
  byClass(tree, 'bop-data-details').props.onToggle({ currentTarget: { open: true } });
  tree = view.render();
  const table = nodes(tree).find(node => node.type === 'table');
  assert.ok(table, 'exact table remains available on demand');
  assert.match(content(table), /Published quarterly observations, RM billion/);
  for(const date of data.quarters.map(quarter => quarter.date)) assert.ok(content(table).includes(date), date);
  const cells = nodes(table).filter(node => node.type === 'td').map(content);
  assert.ok(cells.includes('0'), 'published zero is displayed as zero');
  assert.ok(cells.includes('-1.25'), 'negative published flow keeps its sign');
  assert.ok(cells.includes('+2'), 'positive published flow keeps its sign');
  assert.ok(nodes(table).some(node => node.props?.['aria-label'] === 'Not published'), 'missing balance stays labelled unavailable');
  assert.equal(nodes(table).filter(node => node.type === 'tr').length, data.quarters.length + 1);
  byClass(tree, 'bop-data-details').props.onToggle({ currentTarget: { open: false } });
  assert.equal(nodes(view.render()).find(node => node.type === 'table'), undefined);
  assert.deepEqual(data, original);
});

test("Model error metric and row inspection announce the exact displayed values", async () => {
  const models = [{ name: "Selected fit", rmse: 0.37, mae: 0.21, selected: true }, { name: "Baseline", rmse: 1.12, mae: 0.82, selected: false }, { name: "Unavailable fit", rmse: null, mae: null, eligible: false, selected: false }];
  const view = await harness("ModelErrorVisual", { models });
  let tree = view.render();
  const id = live(tree)?.props.id;
  assert.ok(id);
  assert.match(content(live(tree)), /Selected fit.*RMSE.*0\.37 pp/);
  const baseline = nodes(tree).find((node) => node.type === "li" && content(node).includes("Baseline"));
  assert.equal(baseline.props.tabIndex, 0);
  baseline.props.onFocus();
  tree = view.render();
  const focusText = content(live(tree));
  assert.match(focusText, /Baseline.*RMSE.*1\.12 pp/);
  assert.equal(nodes(tree).find((node) => node.type === "li" && content(node).includes("Baseline")).props["aria-current"], "true");
  nodes(tree).find((node) => node.type === "li" && content(node).includes("Baseline")).props.onPointerMove({ pointerType: "mouse" });
  assert.equal(content(live(view.render())), focusText);
  nodes(tree).find((node) => node.type === "li" && content(node).includes("Baseline")).props.onPointerDown({ pointerType: "touch" });
  assert.equal(content(live(view.render())), focusText);
  nodes(view.render()).find((node) => node.type === "button" && content(node) === "MAE").props.onClick();
  tree = view.render();
  assert.equal(live(tree).props.id, id);
  assert.match(content(live(tree)), /Baseline.*MAE.*0\.82 pp/);
  const missing = nodes(tree).find((node) => node.type === "li" && content(node).includes("Unavailable fit"));
  missing.props.onFocus();
  assert.match(content(live(view.render())), /Not comparable/);
  assert.equal(nodes(missing).find((node) => node.type === "i"), undefined);
  assert.ok(nodes(tree).filter((node) => node.props?.className === "model-error-track").every((node) => node.props["aria-hidden"] === "true"));
});

const settleHistory = async () => { for(let index=0;index<4;index++)await Promise.resolve(); };
const observationTable = tree => nodes(tree).find(node => node.type==='table' && nodes(node).some(cell=>cell.type==='th'&&content(cell)==='Observation period'));
const auditDisclosure = tree => nodes(tree).find(node => node.type==='details' && nodes(node).some(child=>child.type==='summary'&&content(child)==='Inspect actual versus predicted values and fitting failures'));

test('Series preview defers detailed retrieval, caches a successful history and keeps exact pagination',async()=>{
  const points=Array.from({length:125},(_,index)=>({date:new Date(Date.UTC(2016,index,1)).toISOString().slice(0,10),value:index/10}));
  const full={...series,points};
  const preview={...full,points:points.slice(-24),history:{complete:false,totalRows:125,returnedRows:24,ref:{available:true}}};
  let calls=0,resolveHistory;
  const view=await harness('SeriesTrendPanel',{series:[preview],loadSeries:()=>{calls++;return new Promise(resolve=>{resolveHistory=resolve;});}});
  let tree=view.render();
  assert.equal(calls,0,'no history fetch during initial rendering');
  assert.equal(observationTable(tree),undefined,'closed preview has no table rows');
  nodes(tree).find(node=>node.type==='button'&&content(node)==='All history').props.onClick();
  tree=view.render();
  assert.equal(calls,1);
  assert.match(content(tree),/Loading matching detailed observations/);
  assert.equal(nodes(tree).find(node=>node.type==='button'&&content(node)==='All history').props['aria-pressed'],false,'long range is not falsely committed before matching history arrives');
  resolveHistory(full);await settleHistory();tree=view.render();
  assert.equal(nodes(tree).find(node=>node.type==='button'&&content(node)==='All history').props['aria-pressed'],true);
  nodes(tree).find(node=>node.type==='details').props.onToggle({currentTarget:{open:true}});
  tree=view.render();
  assert.equal(nodes(observationTable(tree)).filter(node=>node.type==='th'&&node.props.scope==='row').length,50);
  assert.match(content(tree),/Observations 1–50 of 125/);
  assert.ok(nodes(tree).some(node=>node.type==='time'&&node.props.dateTime===points[0].date));
  nodes(tree).find(node=>node.type==='details').props.onToggle({currentTarget:{open:false}});
  nodes(view.render()).find(node=>node.type==='details').props.onToggle({currentTarget:{open:true}});
  await settleHistory();
  assert.equal(calls,1,'reopening reuses successfully validated detailed history');
  assert.deepEqual(preview.points,points.slice(-24),'the summary fixture is not mutated into history');
});

test('Series failed history retains the dated preview and retries the same requested range',async()=>{
  const preview={...series,history:{complete:false,totalRows:100,returnedRows:series.points.length,ref:{available:true}}};
  let calls=0;
  const view=await harness('SeriesTrendPanel',{series:[preview],loadSeries:async()=>{calls++;if(calls===1)throw new Error('Matching history offline');return {...series};}});
  nodes(view.render()).find(node=>node.type==='button'&&content(node)==='All history').props.onClick();
  await settleHistory();let tree=view.render();
  assert.match(content(nodes(tree).find(node=>node.props?.role==='alert')),/Matching history offline/);
  assert.match(content(live(tree)),/Apr 2025.*3\.0%/);
  assert.equal(observationTable(tree),undefined);
  nodes(tree).find(node=>node.type==='button'&&content(node)==='Retry history').props.onClick();
  await settleHistory();tree=view.render();
  assert.equal(calls,2);
  assert.equal(nodes(tree).find(node=>node.type==='button'&&content(node)==='All history').props['aria-pressed'],true);
  assert.equal(nodes(tree).find(node=>node.props?.role==='alert'),undefined);
});

test('Forecast audit requests windows only on opening, retains summary and caches successful details',async()=>{
  const full=fixture().forecast,preview=structuredClone(full);
  delete preview.evaluation.windows;
  let calls=0,resolveWindows;
  const view=await harness('ForecastAudit',{forecast:preview,loadWindows:()=>{calls++;return new Promise(resolve=>{resolveWindows=resolve;});}});
  let tree=view.render();
  assert.equal(calls,0);
  assert.equal(nodes(auditDisclosure(tree)).filter(node=>node.type==='tr').length,0,'no audit-detail rows constructed while closed');
  assert.match(content(tree),/Empirical interval coverage/);
  const coverage=full.evaluation.coverage[0];
  assert.ok(content(tree).includes(`${(coverage.coverage80*100).toFixed(1)}% (${coverage.covered80}/${coverage.total80})`));
  auditDisclosure(tree).props.onToggle({currentTarget:{open:true}});tree=view.render();
  assert.equal(calls,1);
  assert.match(content(tree),/Loading matching historical forecast windows/);
  assert.equal(nodes(auditDisclosure(tree)).filter(node=>node.type==='th'&&node.props.scope==='row').length,0);
  resolveWindows(full.evaluation.windows);await settleHistory();tree=view.render();
  const rows=nodes(auditDisclosure(tree)).filter(node=>node.type==='tr').slice(1);
  assert.equal(rows.length,Math.min(12,full.evaluation.windows.length*3));
  const latest=full.evaluation.windows.at(-1),fitted=latest.models.find(model=>model.name===full.selectedModel);
  assert.match(content(rows[0]),new RegExp(latest.origin.slice(0,7)));
  if(fitted?.points[0])for(const value of [fitted.points[0].actual,fitted.points[0].predicted,fitted.points[0].error])assert.ok(content(rows[0]).includes(value.toFixed(3)));
  auditDisclosure(tree).props.onToggle({currentTarget:{open:false}});tree=view.render();
  assert.equal(nodes(auditDisclosure(tree)).filter(node=>node.type==='tr').length,0);
  auditDisclosure(tree).props.onToggle({currentTarget:{open:true}});await settleHistory();
  assert.equal(calls,1);
  assert.equal(preview.evaluation.windows,undefined,'history remains separate from the summary DTO');
});

test('Forecast history failures show retry without fabricating detail rows or removing coverage',async()=>{
  const full=fixture().forecast,preview=structuredClone(full);delete preview.evaluation.windows;
  let calls=0;
  const view=await harness('ForecastAudit',{forecast:preview,loadWindows:async()=>{calls++;if(calls===1)throw new Error('Audit history offline');return full.evaluation.windows;}});
  auditDisclosure(view.render()).props.onToggle({currentTarget:{open:true}});await settleHistory();let tree=view.render();
  assert.match(content(nodes(tree).find(node=>node.props?.role==='alert')),/Audit history offline/);
  assert.match(content(tree),/Empirical interval coverage/);
  assert.equal(nodes(auditDisclosure(tree)).filter(node=>node.type==='th'&&node.props.scope==='row').length,0);
  nodes(tree).find(node=>node.type==='button'&&content(node)==='Retry forecast history').props.onClick();await settleHistory();tree=view.render();
  assert.equal(calls,2);
  assert.equal(nodes(tree).find(node=>node.props?.role==='alert'),undefined);
  assert.ok(nodes(auditDisclosure(tree)).some(node=>node.type==='th'&&node.props.scope==='row'));
});

test('BOP long history loads on demand and an unavailable detail request preserves source-labeled preview',async()=>{
  const quarters=Array.from({length:16},(_,index)=>({date:new Date(Date.UTC(2021,index*3,1)).toISOString().slice(0,10),accounts:[{id:'ca',name:'Current account',balance:index===0?0:index-8}]}));
  const data={...fixture().balancePayments,quarters:quarters.slice(-12),history:{complete:false,totalRows:16,returnedRows:12,ref:{available:true}}};
  let calls=0;
  const view=await harness('BalancePaymentsVisual',{data,loadQuarters:async()=>{calls++;if(calls===1)throw new Error('Quarterly history offline');return quarters;}});
  let tree=view.render();
  assert.equal(calls,0);
  assert.equal(nodes(tree).find(node=>node.type==='table'),undefined);
  nodes(tree).find(node=>node.type==='button'&&content(node)==='All quarters').props.onClick();await settleHistory();tree=view.render();
  assert.equal(calls,1);
  assert.match(content(nodes(tree).find(node=>node.props?.role==='alert')),/Quarterly history offline/);
  assert.match(content(live(tree)),/Source:/);
  assert.equal(nodes(tree).find(node=>node.type==='button'&&content(node)==='All quarters').props['aria-pressed'],false);
  nodes(tree).find(node=>node.type==='button'&&content(node)==='Retry quarterly history').props.onClick();await settleHistory();tree=view.render();
  assert.equal(calls,2);
  assert.equal(nodes(tree).find(node=>node.type==='button'&&content(node)==='All quarters').props['aria-pressed'],true);
  assert.equal(nodes(tree).find(node=>node.props?.role==='alert'),undefined);
  byClass(tree,'bop-data-details').props.onToggle({currentTarget:{open:true}});tree=view.render();
  const table=nodes(tree).find(node=>node.type==='table');
  assert.equal(nodes(table).filter(node=>node.type==='th'&&node.props.scope==='row').length,16);
  assert.ok(content(table).includes(quarters[0].date));
  assert.ok(nodes(table).some(node=>node.type==='td'&&content(node)==='0'),'retrieved published zero keeps its meaning');
  assert.equal(calls,2,'opening the table reuses loaded matching quarters');
  assert.deepEqual(data.quarters,quarters.slice(-12));
});

test("Regional chart and income groups expose pointer/keyboard/touch metadata visibly", async () => {
  const dashboard = fixture();
  const original = structuredClone(dashboard);
  const view = await harness("RegionalLensView", { dashboard });
  let tree = view.render();
  const row = byClass(tree, "regional-bar");
  assert.equal(row.props.tabIndex, 0);
  row.props.onFocus();
  tree = view.render();
  const description = content(live(tree));
  assert.equal(description, row.props["aria-label"]);
  assert.equal(byClass(tree, "regional-bar").props["aria-current"], "true");
  byClass(tree, "regional-bar").props.onPointerMove({ pointerType: "mouse" });
  assert.equal(content(live(view.render())), description);
  byClass(tree, "regional-bar").props.onPointerDown({ pointerType: "touch" });
  assert.equal(content(live(view.render())), description);
  const group = byClass(view.render(), "income-group-row");
  assert.equal(group.props.tabIndex, 0);
  assert.equal(group.props.role, "group");
  assert.match(group.props["aria-label"], /percentiles.*Observation period:.*Source:.*Data status:/);
  assert.match(content(group), /percentiles.*202[0-9].*(?:DOSM|Department)/);
  group.props.onFocus();
  tree = view.render();
  assert.equal(content(live(tree)), group.props["aria-label"]);
  assert.equal(byClass(tree, "income-group-row").props["aria-current"], "true");
  byClass(tree, "income-group-row").props.onPointerMove({ pointerType: "mouse" });
  assert.equal(content(live(view.render())), group.props["aria-label"]);
  byClass(tree, "income-group-row").props.onPointerDown({ pointerType: "touch" });
  assert.equal(content(live(view.render())), group.props["aria-label"]);
  assert.ok(nodes(group).filter((node) => node.type === "i").every((node) => node.props["aria-hidden"] === "true"));
  assert.ok(nodes(tree).filter((node) => node.props?.className?.includes("regional-bar-track")).every((node) => node.props["aria-hidden"] === "true"));
  assert.deepEqual(dashboard, original);
});
