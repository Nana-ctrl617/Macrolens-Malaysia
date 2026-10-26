import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validateDashboardIntegrity } from '../app/lib/dashboard-integrity.ts';
import { createValidatedArtifactCache } from '../app/lib/validated-artifact-cache.ts';
import { consecutiveMonthlyChanges } from '../app/lib/monthly-evidence.ts';
import { weightedPressure } from '../app/lib/score-method.ts';
import { formatMetricPeriod, metricPeriodLabel } from '../app/lib/metric-period.ts';
import { appSource, viewSource } from './source-owners.mjs';

const fixture = () => JSON.parse(readFileSync(new URL('../data/published/dashboard.json', import.meta.url), 'utf8'));

test('observation-change volatility never claims daily or decision changes are monthly', () => {
  const explorer = readFileSync(new URL('../app/components/IndicatorDetail.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(explorer, /Monthly-change volatility/);
  assert.match(explorer, /Successive-observation change volatility/);
  assert.match(explorer, /data.frequency/);
  assert.match(explorer, /Observation spacing can differ/);
});

test('saved dashboard passes numerical and temporal integrity checks', () => {
  assert.equal(validateDashboardIntegrity(fixture()), true);
});
test('snapshot labels and formats each indicator date according to its real observation cadence', () => {
  assert.equal(metricPeriodLabel('headline'), 'Reference month');
  assert.equal(formatMetricPeriod('headline', '2026-08-01'), 'Aug 2026');
  assert.equal(metricPeriodLabel('opr'), 'Decision date');
  assert.equal(formatMetricPeriod('opr', '2026-09-03'), '3 Sept 2026');
  assert.equal(metricPeriodLabel('mgs'), 'Trading date');
  assert.equal(formatMetricPeriod('mgs', '2026-10-16'), '16 Oct 2026');
  assert.equal(metricPeriodLabel('fx', 'Trading days · BNM KL reference rate'), 'Trading date');
  assert.equal(formatMetricPeriod('fx', '2026-10-16', 'Trading days · BNM KL reference rate'), '16 Oct 2026');
  assert.equal(metricPeriodLabel('fx', 'Monthly end rate'), 'Reference month');
  assert.equal(formatMetricPeriod('fx', 'invalid'), 'Not recorded');
  assert.equal(formatMetricPeriod('opr', '2026-02-30'), 'Not recorded');
});
test('rejects malformed dates, duplicated observations and impossible values', () => {
  for (const mutate of [
    p => p.generatedAt = '2026-10-19 08:28:45',
    p => p.generatedAt = 'not-a-timestamp',
    p => p.generatedAt = '2099-01-01T00:00:00Z',
    p => p.series.headline.points[0].date = '2020-02-30',
    p => p.series.headline.points[1].date = p.series.headline.points[0].date,
    p => p.series.fx.points[0].value = -2,
    p => p.regionalLens.stateRecords[0].poverty = 101,
    p => p.regionalLens.districtGdpRecords[0].sectors[0].value = -1,
    p => p.regionalLens.districtGdpRecords[0].sectors[0].share = 101,
  ]) { const p = fixture(); mutate(p); assert.equal(validateDashboardIntegrity(p), false); }
});
test('schema 10 rejects a monthly FX series mislabeled as daily BNM reference data', () => {
  const p = fixture();
  p.schemaVersion = 10;
  p.series.fx.frequency = 'Trading days · BNM KL reference rate';
  p.series.fx.source = 'Bank Negara Malaysia Financial Markets';
  p.series.fx.source_url = 'https://financialmarkets.bnm.gov.my/data-download-kl-usd-myr-reference-rate?date_range=all_date';
  p.series.fx.points = Array.from({ length: 60 }, (_, index) => ({
    date: new Date(Date.UTC(2021, index, 1)).toISOString().slice(0, 10), value: 4.0795,
  }));
  p.sources.fx.observationPeriod = p.series.fx.points.at(-1).date;
  assert.equal(validateDashboardIntegrity(p), false);
});
test('schema 10 accepts a properly dated daily BNM series while preserving the forecast payload', () => {
  const p = fixture();
  const dates = [];
  for (let day = new Date('2026-07-01T00:00:00Z'); dates.length < 60; day.setUTCDate(day.getUTCDate() + 1)) {
    if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) dates.push(day.toISOString().slice(0, 10));
  }
  p.schemaVersion = 10;
  p.series.fx.frequency = 'Trading days · BNM KL reference rate';
  p.series.fx.source = 'Bank Negara Malaysia Financial Markets';
  p.series.fx.source_url = 'https://financialmarkets.bnm.gov.my/data-download-kl-usd-myr-reference-rate?date_range=all_date';
  p.series.fx.points = dates.map(date => ({ date, value: 4.0795 }));
  p.sources.fx.observationPeriod = dates.at(-1);
  assert.equal(validateDashboardIntegrity(p), true);
});
test('rejects unsafe or malformed dashboard source links', () => {
  for (const mutate of [
    p => p.dataHealth.sources.find(source => source.id === 'headline').sourceUrl = 'javascript:alert(1)',
    p => p.dataHealth.sources.find(source => source.id === 'market').relatedSourceUrl = 'https://user:secret@example.com/index',
    p => p.dataHealth.sources.find(source => source.id === 'headline').sourceUrl = 'https://',
    p => p.series.headline.source_url = 'http://data.gov.my/dataset',
    p => p.macroTimeline.entries[0].sourceUrl = '//attacker.example/story',
  ]) { const p = fixture(); mutate(p); assert.equal(validateDashboardIntegrity(p), false); }
});
test('rejects non-future forecasts, reversed intervals and contradictory risk summaries', () => {
  for (const mutate of [
    p => p.forecast.points[0].date = p.series.headline.points.at(-1).date,
    p => p.forecast.points[0].low95 = p.forecast.points[0].high95 + 1,
    p => p.riskHeatmap.overallScore = 99,
  ]) { const p = fixture(); mutate(p); assert.equal(validateDashboardIntegrity(p), false); }
});
test('keeps unavailable household market observations out of the published mean', () => {
  const p = fixture();
  const market = p.householdPressure.components.find(item => item.id === 'wealth-risk');
  market.score = null; market.level = 'unavailable'; market.unavailableReason = 'No one-year return.';
  p.householdPressure.status = 'partial';
  const available = p.householdPressure.components.filter(item => item.score !== null).map(item => item.score);
  p.householdPressure.overallScore = Math.round(available.reduce((a, b) => a + b, 0) / available.length * 10) / 10;
  p.householdPressure.overallLevel = p.householdPressure.overallScore >= 70 ? 'high' : p.householdPressure.overallScore >= 40 ? 'moderate' : 'low';
  assert.equal(validateDashboardIntegrity(p), true);
  market.unavailableReason = '';
  assert.equal(validateDashboardIntegrity(p), false);
});
test('sector screens never present missing growth as a calculated risk level', () => {
  const p = fixture();
  const sector = p.sectorDeepDive.sectors[0];
  sector.changeYoY = null;
  sector.riskLevel = 'unavailable';
  assert.equal(validateDashboardIntegrity(p), true);
  sector.riskLevel = 'low';
  assert.equal(validateDashboardIntegrity(p), false);
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
  const shell = appSource('components/DashboardShell.tsx');
  const forecast = viewSource('Forecast');
  const explorer = appSource('components/IndicatorDetail.tsx');
  for(const source of [shell,forecast,explorer]) assert.doesNotMatch(source, /dashboard-v7\?refresh|schema-nine dataset|version-seven dataset|version-eight dataset/);
  assert.match(shell, /loadDashboardView\(section\)/);
  assert.match(shell, /retryDashboardView\(section\)/);
  assert.doesNotMatch(shell, /from\s+["'][^"']*dashboard-client["']/);
  assert.match(shell, /role="status" aria-live="polite"/);
  assert.doesNotMatch(forecast, /coefficients\s*=\s*scenario\?\.coefficients\s*\?\?/);
  assert.match(forecast, /if \(!scenario\) return/);
  assert.match(shell, /initialDataUnavailable\s*=\s*section !== "news" && !currentDashboard && !dashboardLoading && Boolean\(currentError\)/);
  assert.match(shell, /initialDataUnavailable \? <section/);
  assert.match(shell, /Try latest data again/);
  assert.match(explorer, /Historical data is unavailable/);
  assert.match(explorer, /Retry historical data/);
  assert.match(explorer, /const timeout = setTimeout\(\(\) => controller.abort\(\), 12000\)/);
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
