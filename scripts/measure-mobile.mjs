import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? '@playwright/test');
const base = process.env.DASHBOARD_BASE_URL ?? 'http://127.0.0.1:4185';
const phase = process.env.MEASUREMENT_PHASE ?? 'before';
assert.ok(['before', 'after'].includes(phase));
const raw = await readFile(new URL('../data/published/dashboard.json', import.meta.url), 'utf8');
const payload = JSON.parse(raw);
const fixtureHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
const routes = ['/', '/forecast', '/regional', '/risk'];
const browser = await chromium.launch({ headless: true });
const report = {
  phase, measuredAt: new Date().toISOString(), browser: browser.version(), fixtureHash,
  conditions: {
    viewport: { width: 390, height: 844 }, cache: 'new browser context, cache disabled for each trial',
    network: { latencyMs: 150, downloadBytesPerSecond: 200000, uploadBytesPerSecond: 93750 },
    cpuSlowdown: 4, trialsPerRoute: 3, host: 'local production Worker preview',
    caveat: 'Synthetic cold-load lab observations, not field Core Web Vitals or a public network benchmark. Dashboard JSON is fulfilled from a deterministic fixture; its body bytes are counted separately. Network shaping applies to real asset requests.',
  }, trials: [],
};
let project;
if (phase === 'after') {
  const { loadProjectionForMeasurement } = await import('./measurement-projection.mjs');
  project = await loadProjectionForMeasurement();
}
for (const route of routes) for (let trial = 1; trial <= 3; trial++) {
  const context = await browser.newContext({ viewport: report.conditions.viewport });
  let payloadBytes = 0;
  let historyRequests = 0;
  await context.route('**/*', async intercepted => {
    const url = new URL(intercepted.request().url());
    if (url.origin !== new URL(base).origin) return intercepted.abort();
    if (url.pathname === '/api/dashboard-v7') {
      const body = JSON.stringify(payload); payloadBytes += Buffer.byteLength(body);
      return intercepted.fulfill({ body, contentType: 'application/json' });
    }
    if (url.pathname === '/api/dashboard-view') {
      assert.ok(project, 'Projection fixture required for after measurement');
      const body = JSON.stringify(await project(payload, url.searchParams.get('section')));
      payloadBytes += Buffer.byteLength(body);
      return intercepted.fulfill({ body, contentType: 'application/json' });
    }
    if (url.pathname === '/api/dashboard-history') historyRequests++;
    return intercepted.continue();
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__labPaints = [];
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) window.__labPaints.push({ name: entry.entryType, startTime: entry.startTime });
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 200000, uploadThroughput: 93750 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const resources = new Map();
  cdp.on('Network.responseReceived', ({ requestId, response }) => resources.set(requestId, {
    url: new URL(response.url).pathname, type: response.mimeType, status: response.status, encodedBytes: 0,
  }));
  cdp.on('Network.loadingFinished', ({ requestId, encodedDataLength }) => {
    if (resources.has(requestId)) resources.get(requestId).encodedBytes = encodedDataLength;
  });
  await page.goto(`${base}${route}`, { waitUntil: 'networkidle' });
  await page.locator('main section').first().waitFor();
  await page.locator('.dashboard-load-status').waitFor({ state: 'visible' }).catch(() => {});
  await page.waitForFunction(() => !document.body.textContent.includes('Loading validated'));
  const values = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    return {
      domContentLoadedMs: nav.domContentLoadedEventEnd, loadMs: nav.loadEventEnd,
      fcpMs: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null,
      lcpMs: window.__labPaints.at(-1)?.startTime ?? null,
      domElements: document.querySelectorAll('*').length,
      closedDetailsRows: [...document.querySelectorAll('details:not([open])')].reduce((sum, details) => sum + details.querySelectorAll('tbody tr').length, 0),
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  });
  const captured = [...resources.values()];
  const js = captured.filter(item => item.type.includes('javascript'));
  const row = { route, trial, ...values, dashboardPayloadBytes: payloadBytes, unopenedHistoryRequests: historyRequests,
    javascriptEncodedBytes: js.reduce((sum, resource) => sum + resource.encodedBytes, 0), javascriptRequests: js.length, resources: captured };
  assert.equal(row.overflow, false);
  report.trials.push(row);
  console.log(`${phase} ${route} trial ${trial}: JS ${row.javascriptEncodedBytes} B; payload ${payloadBytes} B; closed rows ${values.closedDetailsRows}`);
  await context.close();
}
await browser.close();
const median = numbers => numbers.sort((a, b) => a - b)[Math.floor(numbers.length / 2)];
report.summary = routes.map(route => {
  const rows = report.trials.filter(row => row.route === route);
  const keys = ['domContentLoadedMs', 'loadMs', 'fcpMs', 'lcpMs', 'domElements', 'closedDetailsRows', 'dashboardPayloadBytes', 'javascriptEncodedBytes', 'javascriptRequests', 'unopenedHistoryRequests'];
  return { route, ...Object.fromEntries(keys.map(key => [key, median(rows.map(row => row[key]).filter(value => value != null)) ?? null])) };
});
await mkdir(new URL('../outputs/', import.meta.url), { recursive: true });
await writeFile(new URL(`../outputs/mobile-${phase}.json`, import.meta.url), JSON.stringify(report, null, 2) + '\n');
