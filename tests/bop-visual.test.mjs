import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const componentUrl = new URL("../app/components/BalancePaymentsVisual.tsx", import.meta.url);
const componentRequire = createRequire(componentUrl);
const compiled = ts.transpileModule(readFileSync(componentUrl, "utf8"), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const compiledModule = { exports: {} };
new Function("require", "module", "exports", compiled)(
  (name) => name.endsWith(".css") ? undefined : componentRequire(name),
  compiledModule,
  compiledModule.exports,
);
const { BalancePaymentsVisual } = compiledModule.exports;
const fixture = JSON.parse(readFileSync(new URL("../data/published/dashboard.json", import.meta.url), "utf8")).balancePayments;
const render = (data) => renderToStaticMarkup(React.createElement(BalancePaymentsVisual, { data }));

test("BOP visual shows real latest signed accounts and source metadata", () => {
  const html = render(fixture);
  const latest = fixture.quarters.at(-1);
  assert.ok(html.includes(latest.date));
  for (const account of latest.accounts) {
    assert.ok(html.includes(account.name));
    assert.ok(html.includes(`${account.balance > 0 ? "+" : ""}${new Intl.NumberFormat("en-MY", { maximumFractionDigits: 15 }).format(account.balance)}`));
  }
  assert.ok(html.includes(fixture.sourceUrl));
  assert.ok(html.includes("Last successful retrieval"));
  assert.ok(html.includes("View exact quarterly balances as a table"));
  assert.ok(html.includes("not household cash or savings"));
});

test("missing account observations split the line and never become zeros", () => {
  const data = { ...fixture, quarters: [
    { date: "2025-01-01", accounts: [{ id: "ca", name: "Current account", balance: 1 }] },
    { date: "2025-04-01", accounts: [{ id: "fa", name: "Financial account", balance: -1 }] },
    { date: "2025-07-01", accounts: [{ id: "ca", name: "Current account", balance: 2 }] },
  ] };
  const html = render(data);
  const path = html.match(/class="bop-trend-line" d="([^"]*)"/)[1];
  assert.equal((path.match(/M/g) ?? []).length, 2);
  assert.equal((path.match(/L/g) ?? []).length, 0);
  assert.ok(html.includes('View exact quarterly balances as a table'));
  assert.ok(!html.includes('<table'), 'the unavailable cell is demand-mounted and tested after opening in chart-components-accessibility');
  assert.ok(!html.includes("RM 0 billion"));
});

test("actual zero is distinguished from an unpublished balance", () => {
  const html = render({ ...fixture, quarters: [{ date: "2025-01-01", accounts: [{ id: "ca", name: "Current account", balance: 0 }] }] });
  assert.ok(html.includes("RM 0 billion"));
  assert.ok(html.includes("bop-actual-zero"));
});

test("empty source has an honest empty state and keeps source access", () => {
  const html = render({ ...fixture, status: "unavailable", retrievedAt: null, quarters: [] });
  assert.ok(html.includes("No published quarterly balances"));
  assert.ok(html.includes("Source unavailable"));
  assert.ok(html.includes("Not recorded"));
  assert.ok(html.includes(fixture.sourceUrl));
  assert.ok(!html.includes("bop-trend-line"));
});

test("fallback snapshot label takes precedence over retained fresh status", () => {
  const html = renderToStaticMarkup(React.createElement(BalancePaymentsVisual, { data: { ...fixture, status: "fresh" }, usingFallback: true }));
  assert.ok(html.includes("Fallback snapshot"));
  assert.ok(!html.includes("Source validated"));
});

test("impossible and malformed quarter dates cannot roll over into the chart", () => {
  for (const date of ["2025-02-30", "2025-13-01", "2025-2-01", "invalid"]) {
    const html = render({ ...fixture, quarters: [{ date, accounts: [{ id: "ca", name: "Current account", balance: 7 }] }] });
    assert.ok(html.includes("No published quarterly balances"), date);
    assert.ok(!html.includes("bop-trend-line"), date);
  }
});
