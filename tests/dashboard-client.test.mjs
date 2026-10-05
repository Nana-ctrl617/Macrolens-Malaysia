import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createDashboardClient, DASHBOARD_CLIENT_CACHE_MS } from "../app/lib/dashboard-client.ts";

const payload = (health = "fresh") => ({
  schemaVersion: 1, generatedAt: "2026-10-05T00:00:00Z", health,
  usingFallback: health === "fallback", sources: {}, categories: [],
  series: Object.fromEntries(["headline", "core", "opr", "unemployment", "fx", "mgs"].map((key) => [key, { key, points: [] }])),
  forecast: { selectedModel: "Baseline", models: [], points: [] },
  narratives: { snapshot: "Published observations", forecast: "Forecast uncertainty", financial: "Educational use" },
});
const response = (data = payload()) => ({ ok: true, status: 200, json: async () => data });
const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test("concurrent dashboard requests share one stable cacheable request", async () => {
  const request = deferred();
  const calls = [];
  const client = createDashboardClient({ fetch: (url, options) => { calls.push({ url, options }); return request.promise; } });
  const first = client.load();
  const second = client.load();
  assert.strictEqual(first, second);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/dashboard-v7");
  assert.notEqual(calls[0].options.cache, "no-store");
  assert.equal(calls[0].options.headers.Accept, "application/json");
  request.resolve(response());
  assert.strictEqual(await first, await second);
  assert.equal(calls[0].options.signal.aborted, false);
});

test("successful data is reused for five minutes after completion then expires", async () => {
  let current = 0;
  let calls = 0;
  const request = deferred();
  const client = createDashboardClient({ now: () => current, fetch: () => { calls++; return calls === 1 ? request.promise : Promise.resolve(response()); } });
  const first = client.load();
  current = 1000;
  request.resolve(response());
  const result = await first;
  current += DASHBOARD_CLIENT_CACHE_MS - 1;
  assert.strictEqual(await client.load(), result);
  assert.equal(calls, 1);
  current++;
  await client.load();
  assert.equal(calls, 2);
});

test("failed requests do not poison the shared promise and can be retried", async () => {
  let calls = 0;
  const client = createDashboardClient({ fetch: async () => { calls++; if (calls === 1) throw new Error("Offline"); return response(); } });
  await assert.rejects(client.load(), /Offline/);
  await client.load();
  assert.equal(calls, 2);
  await client.load();
  assert.equal(calls, 2);
});

test("HTTP and malformed responses reject instead of replacing source truth", async () => {
  const candidates = [
    { ok: false, status: 503, json: async () => payload() },
    response({ ...payload(), health: "unknown" }),
    response({ ...payload(), series: {} }),
    response({ ...payload(), forecast: null }),
    response({ ...payload(), generatedAt: 1 }),
    response({ ...payload(), usingFallback: "yes" }),
  ];
  for (const bad of candidates) {
    let calls = 0;
    const client = createDashboardClient({ fetch: async () => { calls++; return calls === 1 ? bad : response(); } });
    await assert.rejects(client.load(), /Dashboard/);
    await client.load();
    assert.equal(calls, 2);
  }
});

test("fallback health and source metadata are preserved without normalization", async () => {
  const data = payload("fallback");
  data.sources = { headline: { status: "stale", retrievedAt: "2026-10-01T00:00:00Z", observationPeriod: "2026-08", message: "Preserved observation" } };
  const client = createDashboardClient({ fetch: async () => response(data) });
  assert.strictEqual(await client.load(), data);
  assert.equal((await client.load()).health, "fallback");
  assert.equal((await client.load()).sources.headline.status, "stale");
});

test("explicit invalidation discards cached results and retry revalidates the stable URL", async () => {
  const calls = [];
  const client = createDashboardClient({ fetch: async (url, options) => { calls.push({ url, options }); return response(); } });
  await client.load();
  client.invalidate();
  await client.load();
  await client.retry();
  assert.equal(calls.length, 3);
  assert.ok(calls.every(({ url }) => url === "/api/dashboard-v7"));
  assert.equal(calls[2].options.cache, "no-cache");
});

test("invalidation aborts old work and an obsolete response cannot replace new cache", async () => {
  const old = deferred();
  const latest = payload("partial");
  let calls = 0;
  let oldSignal;
  const client = createDashboardClient({ fetch: async (_url, options) => { calls++; if (calls === 1) { oldSignal = options.signal; return old.promise; } return response(latest); } });
  const pending = client.load();
  const rejection = assert.rejects(pending, { name: "AbortError" });
  client.invalidate();
  assert.equal(oldSignal.aborted, true);
  assert.strictEqual(await client.load(), latest);
  old.resolve(response(payload("fallback")));
  await rejection;
  assert.strictEqual(await client.load(), latest);
  assert.equal(calls, 2);
});

test("timeout covers stalled response bodies, aborts work and allows recovery", async () => {
  let calls = 0;
  let signal;
  const body = deferred();
  const client = createDashboardClient({ timeoutMs: 10, fetch: async (_url, options) => { calls++; signal = options.signal; return calls === 1 ? { ...response(), json: () => body.promise } : response(); } });
  await assert.rejects(client.load(), { name: "TimeoutError" });
  assert.equal(signal.aborted, true);
  await client.load();
  assert.equal(calls, 2);
  body.resolve(payload("fallback"));
  assert.equal((await client.load()).health, "fresh");
});

test("successful requests clear timeout instead of aborting a completed request", async () => {
  let signal;
  const client = createDashboardClient({ timeoutMs: 10, fetch: async (_url, options) => { signal = options.signal; return response(); } });
  await client.load();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(signal.aborted, false);
});

test("client loader does not import the published fallback or server code at runtime", () => {
  const source = readFileSync(new URL("../app/lib/dashboard-client.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /import\s+(?!type\b).*from\s+["'][^"']*dashboard["']/);
  assert.doesNotMatch(source, /data\/published|normalizeDashboard|isDashboard/);
});
