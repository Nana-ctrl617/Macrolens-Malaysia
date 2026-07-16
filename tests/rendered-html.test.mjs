import assert from "node:assert/strict";
import test from "node:test";

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
  assert.deepEqual(body.points.at(-1), { date: "2026-07-01", value: 3.63 });
});
