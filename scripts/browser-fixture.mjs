import { loadProjectionModule } from './measurement-projection.mjs';
import { normalizeDashboard } from '../app/lib/dashboard-health.ts';

export async function installDashboardFixture(context, base, payload) {
  const { projectDashboard, projectDashboardHistory, parseHistoryRequest } = await loadProjectionModule();
  const normalized = normalizeDashboard(payload);
  await context.route('**/api/dashboard-view?*', async route => {
    const section = new URL(route.request().url()).searchParams.get('section');
    return route.fulfill({ json: await projectDashboard(normalized, section) });
  });
  await context.route('**/api/dashboard-history?*', async route => {
    try { return route.fulfill({ json: await projectDashboardHistory(normalized, parseHistoryRequest(new URL(route.request().url()))) }); }
    catch (error) { return route.fulfill({ status: error.status ?? 500, json: { error: error.message } }); }
  });
  await context.route('**/api/dashboard-v7', route => route.fulfill({ json: normalized }));
  await context.route('**/api/dashboard', route => route.fulfill({ json: normalized }));
  await context.route('**/api/indicator?*', route => {
    const id = new URL(route.request().url()).searchParams.get('id');
    const series = normalized.series[id];
    return route.fulfill({ json: { id, ...series, sourceUrl: series.source_url, status: normalized.sources[id]?.status, retrievedAt: normalized.sources[id]?.retrievedAt, period: normalized.sources[id]?.observationPeriod } });
  });
}
