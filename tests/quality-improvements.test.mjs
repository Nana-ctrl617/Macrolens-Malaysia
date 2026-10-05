import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validateDashboardIntegrity } from '../app/lib/dashboard-integrity.ts';
import { createValidatedArtifactCache } from '../app/lib/validated-artifact-cache.ts';
import { consecutiveMonthlyChanges } from '../app/lib/monthly-evidence.ts';
import { weightedPressure } from '../app/lib/score-method.ts';

const fixture = () => JSON.parse(readFileSync(new URL('../data/published/dashboard.json', import.meta.url), 'utf8'));

test('saved dashboard passes numerical and temporal integrity checks', () => {
  assert.equal(validateDashboardIntegrity(fixture()), true);
});
test('rejects malformed dates, duplicated observations and impossible values', () => {
  for (const mutate of [
    p => p.series.headline.points[0].date = '2020-02-30',
    p => p.series.headline.points[1].date = p.series.headline.points[0].date,
    p => p.series.fx.points[0].value = -2,
    p => p.regionalLens.stateRecords[0].poverty = 101,
    p => p.regionalLens.districtGdpRecords[0].sectors[0].value = -1,
    p => p.regionalLens.districtGdpRecords[0].sectors[0].share = 101,
  ]) { const p = fixture(); mutate(p); assert.equal(validateDashboardIntegrity(p), false); }
});
test('rejects non-future forecasts, reversed intervals and contradictory risk summaries', () => {
  for (const mutate of [
    p => p.forecast.points[0].date = p.series.headline.points.at(-1).date,
    p => p.forecast.points[0].low95 = p.forecast.points[0].high95 + 1,
    p => p.riskHeatmap.overallScore = 99,
  ]) { const p = fixture(); mutate(p); assert.equal(validateDashboardIntegrity(p), false); }
});
test('server cache coalesces loads and preserves last valid values with fallback status', async () => {
  let now = 0, calls = 0, broken = false;
  const cache = createValidatedArtifactCache({
    load: async () => { calls++; if (broken) throw Error('offline'); return {value: 12}; },
    validate: v => Number.isFinite(v?.value), fallback: {value: 2}, now: () => now, cacheMs: 100,
  });
  const values = await Promise.all([cache.load(), cache.load()]);
  assert.equal(calls, 1); assert.equal(values[0].usingFallback, false);
  now = 101; broken = true;
  const retained = await cache.load();
  assert.equal(retained.payload.value, 12); assert.equal(retained.usingFallback, true);
});
test('invalid remote data cannot replace a valid cached artifact', async () => {
  let now = 0, value = {value: 5};
  const cache = createValidatedArtifactCache({ load: async () => value, validate: v => Number.isFinite(v?.value), fallback: {value: 1}, now: () => now, cacheMs: 5 });
  await cache.load(); now = 6; value = {value: NaN};
  const result = await cache.load(); assert.equal(result.payload.value, 5); assert.equal(result.usingFallback, true);
});
test('monthly explanation excludes gaps rather than mislabelling multi-month changes', () => {
  const result = consecutiveMonthlyChanges(new Map([['2025-05',2],['2025-07',3],['2025-08',4]]), new Map([['2025-05',5],['2025-07',6],['2025-08',8]]));
  assert.deepEqual(result.left, [1]); assert.deepEqual(result.right, [2]);
  assert.deepEqual(result.periods, ['2025-08']);
});
test('stable data loading replaces timestamp cache bypass and internal schema messages', () => {
  const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /dashboard-v7\?refresh|schema-nine dataset|version-seven dataset|version-eight dataset/);
  assert.match(page, /loadDashboard\(/);
  assert.match(page, /role="status" aria-live="polite"/);
  assert.doesNotMatch(page, /coefficients\s*=\s*scenario\?\.coefficients\s*\?\?/);
  assert.match(page, /if \(!scenario\) return/);
  assert.match(page, /initialDataUnavailable\s*=\s*section !== "news" && !dashboard && !dashboardLoading && Boolean\(dashboardError\)/);
  assert.match(page, /initialDataUnavailable \? <section/);
  assert.match(page, /Try latest data again/);
  assert.match(page, /Historical data is unavailable/);
  assert.match(page, /Retry historical data/);
  assert.match(page, /const timeout = setTimeout\(\(\) => controller.abort\(\), 12000\)/);
});

test('exploratory risk weights renormalize without changing published scores', () => {
  const items = [{id:'inflation',score:20},{id:'labour',score:80}];
  assert.equal(weightedPressure(items,'inflation',1),50);
  assert.equal(weightedPressure(items,'inflation',2),40);
  assert.equal(weightedPressure(items,'inflation',0),80);
  assert.equal(weightedPressure(items,'inflation',-1),null);
  assert.equal(weightedPressure([], 'inflation',1),null);
  assert.deepEqual(items,[{id:'inflation',score:20},{id:'labour',score:80}]);
});
