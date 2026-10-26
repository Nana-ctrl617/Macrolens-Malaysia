import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dashboardStatus } from "../app/lib/dashboard-status.ts";

const fixture = () => JSON.parse(readFileSync(new URL("../data/published/dashboard.json", import.meta.url), "utf8"));

test("monitoring status is OK only for a fresh non-fallback artifact", () => {
  const payload = fixture();
  const status = dashboardStatus(payload);
  assert.equal(status.status, "ok");
  assert.equal(status.schemaVersion, payload.schemaVersion);
  assert.equal(status.generatedAt, payload.generatedAt);
  assert.equal(status.sources.total, Object.keys(payload.sources).length);
  assert.equal(status.sources.fresh + status.sources.stale, status.sources.total);
});

test("monitoring status is degraded for partial or fallback data", () => {
  const payload = fixture();
  payload.health = "partial";
  assert.equal(dashboardStatus(payload).status, "degraded");
  payload.health = "fresh";
  payload.usingFallback = true;
  const fallback = dashboardStatus(payload);
  assert.equal(fallback.status, "degraded");
  assert.equal(fallback.usingFallback, true);
});
