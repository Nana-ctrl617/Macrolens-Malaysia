import { test, expect } from "@playwright/test";
import { dashboardFixture, installFixture, projection, ready, readability, noOverflow, riskFixture } from "./helpers";

for (const failure of ["malformed", "transport"] as const) test(`${failure} summary failure stays unavailable until explicit retry succeeds`, async ({ page, context }, info) => {
  const payload = await dashboardFixture(); await installFixture(context, payload);
  const { projectDashboard } = await projection();
  const good = await projectDashboard(payload, "snapshot");
  let requests = 0;
  await context.route("**/api/dashboard-view?*", async route => {
    requests++;
    if (requests === 1) {
      if (failure === "transport") return route.fulfill({ status: 503, json: { error: "Internal fixture detail must not be displayed" } });
      const bad = structuredClone(good); bad.series.headline.points[0].value = "2.0";
      return route.fulfill({ json: bad });
    }
    return route.fulfill({ json: good });
  });
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("The dashboard could not be loaded");
  await expect(page.locator("main h1")).toHaveText("Economic data is temporarily unavailable");
  await expect(page.locator(".metric-card")).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText("Internal fixture detail");
  const retry = page.getByRole("button", { name: "Retry dashboard", exact: true });
  await retry.focus(); await retry.press("Enter");
  await expect(page.locator(".dashboard-load-status.shell").first()).toContainText("Validated data loaded");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator(".metric-card")).toHaveCount(6);
  expect(requests).toBe(2);
  await readability(page, info); await noOverflow(page);
});

test("artifact409 resets the old explorer and reloads its summary before serving detail", async ({ page, context }, info) => {
  const old = await dashboardFixture(), next = structuredClone(old);
  next.series.headline.points.at(-1)!.value += 0.125;
  await installFixture(context, old);
  const { projectDashboard, projectDashboardHistory, parseHistoryRequest } = await projection();
  const oldView = await projectDashboard(old, "snapshot"), nextView = await projectDashboard(next, "snapshot");
  expect(nextView.artifactId).not.toBe(oldView.artifactId);
  let summaries = 0;
  const historyArtifacts: string[] = [];
  await context.route("**/api/dashboard-view?*", route => { summaries++; return route.fulfill({ json: summaries === 1 ? oldView : nextView }); });
  await context.route("**/api/dashboard-history?*", async route => {
    const request = parseHistoryRequest(new URL(route.request().url())); historyArtifacts.push(request.artifactId);
    if (request.artifactId === oldView.artifactId) return route.fulfill({ status: 409, json: { error: "Controlled content revision" } });
    return route.fulfill({ json: await projectDashboardHistory(next, request) });
  });
  await ready(page, "/");
  const open = page.getByRole("button", { name: /Open historical data for Headline inflation/ });
  await open.click();
  await expect.poll(() => summaries).toBe(2);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".dashboard-load-status.shell").first()).toContainText("Validated data loaded");
  expect(historyArtifacts).toEqual([oldView.artifactId]);
  await open.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator(".detail-chart-wrap canvas")).toBeVisible();
  expect(historyArtifacts).toEqual([oldView.artifactId, nextView.artifactId]);
  await page.getByRole("dialog").press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(open).toBeFocused();
  await readability(page, info); await noOverflow(page);
});

for (const variant of ["fresh", "stale", "fallback", "partial", "unavailable"] as const) test(`Risk ${variant} preserves score availability and source status`, async ({ page, context }, info) => {
  const payload = riskFixture(await dashboardFixture(), variant); await installFixture(context, payload);
  await ready(page, "/risk"); await readability(page, info);
  await expect(page.locator(".score-visual-bar-row")).toHaveCount(9);
  await expect(page.locator(".risk-table-wrap table")).toHaveCount(0);
  if (variant === "partial" || variant === "unavailable") {
    const missing = page.locator(".score-visual-bar-row.unavailable");
    await expect(missing).toHaveCount(variant === "partial" ? 1 : 9);
    await expect(missing.first()).toHaveAttribute("aria-label", /Unavailable/);
    await expect(missing.first()).not.toHaveAttribute("aria-label", /out of 100/);
    await expect(missing.locator(".score-visual-fill")).toHaveCount(0);
    await missing.first().focus(); await missing.first().press("Enter");
    await expect(page.getByRole("region", { name: "Selected signal evidence" })).toContainText("Controlled required input is missing.");
    await expect(page.getByRole("region", { name: "Selected signal evidence" })).toContainText("No weight or contribution is assigned");
    await expect(page.locator(".score-visual-overall")).toContainText(variant === "unavailable" ? "Unavailable" : "45.0 / 100");
  } else {
    const zero = page.locator(".score-visual-bar-row").filter({ hasText: payload.riskHeatmap!.items[0].label });
    await expect(zero).toHaveAttribute("aria-label", /0\.0 out of 100/);
    expect(await zero.locator(".score-visual-fill").evaluate(element => parseFloat((element as HTMLElement).style.width))).toBe(0);
    await zero.focus(); await zero.press("Enter");
    await expect(page.getByRole("region", { name: "Selected signal evidence" })).toContainText(variant === "stale" ? "Stale" : variant === "fallback" ? "Fallback" : "Fresh");
    if (variant === "fallback") {
      await expect(page.locator(".dashboard-load-status.shell").first()).toContainText("Saved validated data loaded");
      await expect(page.getByRole("button", { name: "Try latest data again", exact: true })).toBeVisible();
    }
  }
  await page.getByRole("button", { name: "Heatmap", exact: true }).click();
  await expect(page.locator(".score-visual-cell")).toHaveCount(9);
  if (variant === "unavailable") await expect(page.locator(".score-visual-cell.unavailable")).toHaveCount(9);
  await page.getByText("All signals, scoring rules and observation periods", { exact: true }).click();
  await expect(page.locator(".risk-table-wrap tbody tr")).toHaveCount(9);
  if (variant === "partial" || variant === "unavailable") await expect(page.locator(".risk-table-wrap tbody tr").first()).toContainText("Unavailable");
  await noOverflow(page);
});
