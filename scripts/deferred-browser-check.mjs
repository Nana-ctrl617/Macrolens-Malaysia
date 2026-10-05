import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { installDashboardFixture } from './browser-fixture.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? '@playwright/test');
const base = process.env.DASHBOARD_BASE_URL ?? 'http://127.0.0.1:4185';
const fixture = JSON.parse(await readFile(new URL('../data/published/dashboard.json', import.meta.url), 'utf8'));
const browser = await chromium.launch({ headless: true });
const result = { browser: browser.version(), at: new Date().toISOString(), checks: [] };
const cases = [
  { route: '/', id: 'indicator:headline', action: page => page.getByRole('button', { name: /Open historical data for Headline inflation/ }).click(), ready: '.detail-chart-wrap canvas' },
  { route: '/brief', id: 'indicator:headline', action: page => page.getByRole('button', { name: 'All history', exact: true }).click(), ready: '.series-trend-plot' },
  { route: '/forecast', id: 'forecast-audit', action: page => page.getByText('Inspect actual versus predicted values and fitting failures', { exact: true }).click(), ready: '.forecast-audit-pages' },
  { route: '/bop', id: 'bop-history', action: page => page.getByRole('button', { name: 'All quarters', exact: true }).click(), ready: '.bop-trend-frame' },
  { route: '/regional', id: 'regional-districts', action: page => page.getByLabel(/Geography/).selectOption('district'), ready: '.regional-bars' },
  { route: '/structure', id: 'gdp-years', action: page => page.getByRole('button', { name: 'Load earlier years and complete trend', exact: true }).click(), ready: '#structure-year' },
  { route: '/external', id: 'external-history', action: page => page.getByRole('button', { name: 'All history', exact: true }).click(), ready: '.external-chart' },
  { route: '/structural', id: 'indicator:core', action: page => page.getByRole('button', { name: 'All history', exact: true }).click(), ready: '.structural-chart' },
  { route: '/bursa', id: 'market-history', action: page => page.locator('.market-range').getByRole('button', { name: 'ALL', exact: true }).click(), ready: '.market-chart' },
];
for (const item of cases) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
  await installDashboardFixture(context, base, fixture);
  const historyRequests = [];
  context.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname === '/api/dashboard-history') historyRequests.push({ id: url.searchParams.get('id'), artifactId: url.searchParams.get('artifactId') });
  });
  const page = await context.newPage();
  await page.goto(`${base}${item.route}`, { waitUntil: 'networkidle' });
  assert.equal(historyRequests.length, 0, `${item.route}: unopened details must not fetch history`);
  if (item.route === '/forecast') assert.equal(await page.locator('.forecast-audit details tbody tr').count(), 0);
  if (item.route === '/bop') assert.equal(await page.locator('.bop-data-details tbody tr').count(), 0);
  await item.action(page);
  await page.waitForFunction(() => !document.body.textContent.includes('Loading matching') && !document.body.textContent.includes('Loading history…'));
  await page.locator(item.ready).first().waitFor({ state: 'visible' });
  await page.waitForLoadState('networkidle');
  assert.equal(historyRequests.length, 1, `${item.route}: one explicit matching history request`);
  assert.equal(historyRequests[0].id, item.id);
  assert.match(historyRequests[0].artifactId, /^[a-f0-9]{64}$/);
  if (item.route === '/forecast') {
    assert.equal(await page.locator('.forecast-audit details tbody tr').count(), 12);
    await item.action(page);
    await page.waitForFunction(() => document.querySelectorAll('.forecast-audit details tbody tr').length === 0);
    await item.action(page);
    await page.waitForFunction(() => document.querySelectorAll('.forecast-audit details tbody tr').length > 0);
    assert.equal(historyRequests.length, 1);
  }
  if (item.route === '/structure') assert.ok(await page.locator('#structure-year option').count() > 5);
  if (item.route === '/regional') assert.ok(await page.getByLabel(/Main (region|district)/).locator('option').count() > 16);
  result.checks.push({ route: item.route, initialHistoryRequests: 0, explicitRequests: historyRequests });
  console.log(`PASS deferred ${item.route}`);
  await context.close();
}
await browser.close();
await mkdir(new URL('../outputs/', import.meta.url), { recursive: true });
await writeFile(new URL('../outputs/deferred-browser-check.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
