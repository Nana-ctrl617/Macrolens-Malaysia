import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const modules = new Map();
const stateHarness = { values: [], cursor: 0 };
globalThis.__historyQualityState = stateHarness;
const reactUrl = pathToFileURL(require.resolve("react")).href;
const hooksUrl = `data:text/javascript;base64,${Buffer.from(`
  export * from ${JSON.stringify(reactUrl)};
  export const useId = () => "history-test";
  export const useMemo = (calculate) => calculate();
  export const useState = (initial) => {
    const state = globalThis.__historyQualityState;
    const index = state.cursor++;
    if (!(index in state.values)) state.values[index] = typeof initial === "function" ? initial() : initial;
    return [state.values[index], (next) => { state.values[index] = typeof next === "function" ? next(state.values[index]) : next; }];
  };
`).toString("base64")}`;

async function sourceModule(filename) {
  if (modules.has(filename)) return modules.get(filename);
  let output = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  output = output.replace(/import\s+["'][^"']+\.css["'];?\s*/g, "");
  for (const match of [...output.matchAll(/from\s+(["'])([^"']+)\1/g)]) {
    const specifier = match[2];
    let resolved;
    if (specifier === "react") resolved = hooksUrl;
    else if (specifier.startsWith("@/") || specifier.startsWith(".")) {
      const base = specifier.startsWith("@/") ? fileURLToPath(new URL(`../${specifier.slice(2)}`, import.meta.url)) : fileURLToPath(new URL(specifier, pathToFileURL(filename)));
      const target = [base, `${base}.ts`, `${base}.tsx`].find(existsSync);
      if (!target) throw new Error(`Missing component dependency: ${specifier}`);
      resolved = await sourceModule(target);
    } else resolved = pathToFileURL(require.resolve(specifier)).href;
    output = output.replaceAll(`${match[1]}${specifier}${match[1]}`, JSON.stringify(resolved));
  }
  const url = `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`;
  modules.set(filename, url);
  return url;
}

const points = Array.from({ length: 125 }, (_, index) => ({ date: new Date(Date.UTC(2016, index, 1)).toISOString().slice(0, 10), value: index / 10 }));
const series = { key: "headline", title: "Headline inflation", unit: "%", decimals: 1, frequency: "monthly", source: "Official source", source_url: "https://example.com/official", points };
const component = async () => (await import(await sourceModule(fileURLToPath(new URL("../app/components/SeriesTrendPanel.tsx", import.meta.url))))).default;
const children = (element) => [element, ...((element?.props?.children ? [element.props.children].flat(Infinity) : []).flatMap(children))];
const find = (tree, type, predicate = () => true) => children(tree).find((element) => element?.type === type && predicate(element));
const html = (tree) => renderToStaticMarkup(tree);
const rows = (tree) => (html(tree).match(/<th scope="row"/g) ?? []).length;

async function harness(input = [series]) {
  stateHarness.values = [];
  const Trend = await component();
  const render = () => { stateHarness.cursor = 0; return Trend({ series: input }); };
  const chooseAll = () => { const tree = render(); find(tree, "button", (item) => item.props.children === "All history").props.onClick(); return render(); };
  const open = () => { const tree = render(); find(tree, "details").props.onToggle({ currentTarget: { open: true } }); return render(); };
  return { render, chooseAll, open };
}

test("closed history has no table rows or mounted table and uses a section heading", async () => {
  const history = await harness();
  const markup = html(history.chooseAll());
  assert.match(markup, /<h2[^>]*>Explore the data over time<\/h2>/);
  assert.match(markup, /<summary>View 125 observations and their source<\/summary>/);
  assert.doesNotMatch(markup, /<table|<tbody|<tr\b/);
});

test("opening history mounts 50 rows with first-page status and disabled previous navigation", async () => {
  const history = await harness();
  history.chooseAll();
  const tree = history.open();
  const markup = html(tree);
  assert.equal(rows(tree), 50);
  assert.match(markup, /Observations 1[^0-9]+50 of 125/);
  assert.match(markup, /Page 1 of 3/);
  assert.equal(find(tree, "button", (item) => item.props.children === "Previous").props.disabled, true);
  assert.equal(find(tree, "button", (item) => item.props.children === "Next").props.disabled, false);
  assert.match(markup, /aria-live="polite"/);
  assert.match(markup, /tabindex="0" role="region" aria-label="Headline inflation observations table"/);
});

test("history navigation reaches final page and disables next without losing source/date metadata", async () => {
  const history = await harness();
  history.chooseAll();
  let tree = history.open();
  find(tree, "button", (item) => item.props.children === "Next").props.onClick();
  tree = history.render();
  assert.equal(rows(tree), 50);
  assert.match(html(tree), /Observations 51[^0-9]+100 of 125/);
  find(tree, "button", (item) => item.props.children === "Next").props.onClick();
  tree = history.render();
  assert.equal(rows(tree), 25);
  assert.match(html(tree), /Observations 101[^0-9]+125 of 125/);
  assert.match(html(tree), /Page 3 of 3/);
  assert.equal(find(tree, "button", (item) => item.props.children === "Next").props.disabled, true);
  assert.equal(find(tree, "button", (item) => item.props.children === "Previous").props.disabled, false);
  assert.match(html(tree), /<time dateTime="2026-05-01"/);
  assert.match(html(tree), /https:\/\/example.com\/official/);
});

test("closing history unmounts rows and changing the observation window resets the page", async () => {
  const history = await harness();
  history.chooseAll();
  let tree = history.open();
  find(tree, "button", (item) => item.props.children === "Next").props.onClick();
  tree = history.render();
  find(tree, "details").props.onToggle({ currentTarget: { open: false } });
  assert.equal(rows(history.render()), 0);
  tree = history.open();
  find(tree, "button", (item) => item.props.children === "1 year").props.onClick();
  tree = history.render();
  assert.equal(rows(tree), 13);
  assert.match(html(tree), /Page 1 of 1/);
  assert.equal(find(tree, "button", (item) => item.props.children === "Previous").props.disabled, true);
  assert.equal(find(tree, "button", (item) => item.props.children === "Next").props.disabled, true);
  tree = history.chooseAll();
  assert.match(html(tree), /Observations 1[^0-9]+50 of 125/);
  assert.match(html(tree), /Page 1 of 3/);
});

test("empty history retains honest empty state and semantic heading", async () => {
  const history = await harness([]);
  const markup = html(history.render());
  assert.match(markup, /<h2[^>]*>Explore the data over time<\/h2>/);
  assert.match(markup, /No indicator series are available/);
  assert.doesNotMatch(markup, /<table|<details/);
});
