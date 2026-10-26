import assert from "node:assert/strict";
import test from "node:test";
import { createExpiringRequestCache } from "../app/lib/expiring-request-cache.ts";

test("expiring request cache shares work, expires on schedule, and never caches a failed load", async () => {
  let clock = 1000;
  const cache = createExpiringRequestCache({ ttlMs: 300, now: () => clock });
  let calls = 0;
  let release;
  const load = () => { calls++; return new Promise((resolve) => { release = resolve; }); };
  const first = cache.read(load);
  const second = cache.read(load);
  assert.equal(calls, 1, "concurrent callers share one upstream request");
  release({ id: 1 });
  assert.deepEqual(await first, { value: { id: 1 }, cached: false });
  assert.deepEqual(await second, { value: { id: 1 }, cached: false });
  assert.deepEqual(await cache.read(load), { value: { id: 1 }, cached: true });
  assert.equal(calls, 1);
  clock += 301;
  const refreshed = await cache.read(async () => ({ id: ++calls }));
  assert.deepEqual(refreshed, { value: { id: 2 }, cached: false });
  cache.clear();
  await assert.rejects(cache.read(async () => { throw new Error("source unavailable"); }), /source unavailable/);
  const recovered = await cache.read(async () => ({ id: ++calls }));
  assert.deepEqual(recovered, { value: { id: 3 }, cached: false });
});
