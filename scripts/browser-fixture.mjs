import { loadProjectionModule } from './measurement-projection.mjs';

export async function installDashboardFixture(context, base, payload) {
  const { projectDashboard, projectDashboardHistory, parseHistoryRequest } = await loadProjectionModule();
  await context.route('**/api/dashboard-view?*', async route => {
    const section = new URL(route.request().url()).searchParams.get('section');
    return route.fulfill({ json: await projectDashboard(payload, section) });
  });
  await context.route('**/api/dashboard-history?*', async route => {
    try { return route.fulfill({ json: await projectDashboardHistory(payload, parseHistoryRequest(new URL(route.request().url()))) }); }
    catch (error) { return route.fulfill({ status: error.status ?? 500, json: { error: error.message } }); }
  });
  await context.route('**/api/dashboard-v7', route => route.fulfill({ json: payload }));
  await context.route('**/api/dashboard', route => route.fulfill({ json: payload }));
  await context.route('**/api/indicator?*', route => {
    const id = new URL(route.request().url()).searchParams.get('id');
    const series = payload.series[id];
    return route.fulfill({ json: { id, ...series, sourceUrl: series.source_url, status: payload.sources[id]?.status, retrievedAt: payload.sources[id]?.retrievedAt, period: payload.sources[id]?.observationPeriod } });
  });
}
