import { test, expect } from "@playwright/test";
import { dashboardFixture, installFixture, ready, regionalExporter, csvRows } from "./helpers";

test("real Regional CSV and JSON downloads exactly preserve values, periods and provenance", async ({ request, page, context }, info) => {
  const json = await request.get("/api/regional-lens?format=json");
  expect(json.ok()).toBeTruthy();
  expect(json.headers()["content-type"]).toContain("application/json");
  expect(json.headers()["content-disposition"]).toContain("attachment; filename=regional-lens.json");
  const regional = await json.json();
  expect(regional.stateRecords.length).toBeGreaterThan(0);
  const csv = await request.get("/api/regional-lens?format=csv");
  expect(csv.ok()).toBeTruthy();
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect(csv.headers()["content-disposition"]).toContain("attachment; filename=regional-lens.csv");
  const csvText = await csv.text();
  expect(csvText).toBe((await regionalExporter())(regional));
  const rows = csvRows(csvText);
  expect(rows[0]).toEqual(["level", "state", "district", "metric", "value", "unit", "observation_period", "source_url", "data_status", "retrieved_at"]);
  expect(rows.length).toBeGreaterThan(100);
  expect(rows.every(row => row.length === 10)).toBeTruthy();
  const invalid = await request.get("/api/regional-lens?format=xml"); expect(invalid.status()).toBe(400);
  await info.attach("regional-download-proof.json", { body: JSON.stringify({ rows: rows.length - 1, columns: rows[0], stateRecords: regional.stateRecords.length, sourcePeriods: Object.fromEntries(Object.entries(regional.sources).map(([key, value]) => [key, (value as { observationPeriod: string }).observationPeriod])) }, null, 2), contentType: "application/json" });
  // Only page summaries are intercepted. The two attachment endpoints below are real Worker API responses.
  await installFixture(context, await dashboardFixture()); await ready(page, "/regional");
  await page.getByText("Data sources for assignment, downloads and coverage notes", { exact: true }).click();
  for (const [format, expected] of [["csv", csvText], ["json", await json.text()]] as const) {
    const pending = page.waitForEvent("download");
    await page.locator(`a[href="/api/regional-lens?format=${format}"]`).click();
    const download = await pending;
    expect(download.suggestedFilename()).toBe(`regional-lens.${format}`);
    const stream = await download.createReadStream(); expect(stream).not.toBeNull();
    const chunks: Buffer[] = []; for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString("utf8")).toBe(expected);
    expect(await download.failure()).toBeNull();
  }
});

test("real Forecast evaluation CSV rows exactly match their JSON audit records", async ({ request }, info) => {
  const json = await request.get("/api/forecast-evaluation?format=json"); expect(json.ok()).toBeTruthy();
  const metadata = await json.json();
  const csv = await request.get("/api/forecast-evaluation?format=csv"); expect(csv.ok()).toBeTruthy();
  expect(csv.headers()["content-disposition"]).toContain("forecast-evaluation.csv");
  const rows = csvRows(await csv.text());
  const headers = ["origin", "evaluation_phase", "target_date", "horizon_months", "model", "fit_status", "actual", "predicted", "error_pp", "low80", "high80", "low95", "high95", "covered80", "covered95", "calibration_count", "calibration_target_months", "recalibrated_low80", "recalibrated_high80", "recalibrated_low95", "recalibrated_high95", "failure_reason", "method", "calculated_at", "data_status"];
  expect(rows.shift()).toEqual(headers);
  const expected: string[][] = metadata.evaluation.windows.flatMap((window: { origin: string; evaluationPhase?:string; targets: string[]; models: Array<{ name: string; status: string; failureReason: string | null; points: Array<Record<string, any>> }> }) => window.models.flatMap(model => window.targets.map((date, index) => {
    const point = model.points.find(item => item.date === date);
    const adjusted=point?.recalibrated;
    return [window.origin, window.evaluationPhase, date, index + 1, model.name, model.status, point?.actual, point?.predicted, point?.error, point?.low80, point?.high80, point?.low95, point?.high95, point?.covered80, point?.covered95, adjusted?.calibrationCount, adjusted?.calibrationTargets?.join("|"), adjusted?.low80, adjusted?.high80, adjusted?.low95, adjusted?.high95, model.failureReason, metadata.method, metadata.calculatedAt, metadata.usingFallback ? "fallback" : metadata.inputHealth?.status ?? metadata.status].map(value => value == null ? "" : String(value));
  })));
  expect(rows).toEqual(expected);
  const invalid = await request.get("/api/forecast-evaluation?format=xml"); expect(invalid.status()).toBe(400);
  await info.attach("forecast-download-proof.json", { body: JSON.stringify({ rows: rows.length, columns: headers, calculatedAt: metadata.calculatedAt, status: metadata.status, usingFallback: metadata.usingFallback }), contentType: "application/json" });
});
