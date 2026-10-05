import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ROUTES, dashboardFixture, installFixture, ready, readability, noOverflow, chartStatus, regionalFunctions } from "./helpers";

test("all nineteen routes remain reachable through the compact navigation", async ({ page, context }, info) => {
  test.setTimeout(180000);
  const payload = await dashboardFixture();
  await installFixture(context, payload);
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await ready(page, "/");
  for (const [path, label] of ROUTES) await test.step(`${label}: ${path}`, async () => {
    const toggle = page.getByRole("button", { name: /^Sections\. Current page:/ });
    if (await toggle.isVisible()) { await toggle.click(); await expect(toggle).toHaveAttribute("aria-expanded", "true"); }
    const navigation = page.getByRole("navigation", { name: "Primary navigation" });
    await navigation.getByRole("link", { name: label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${path === "/" ? "/" : path}/?(?:\\?.*)?$`));
    if (path === "/news") await expect(page.locator(".news-meta [role=status]")).toContainText("verified-date headlines");
    else await expect(page.locator(".dashboard-load-status.shell").first()).toContainText(/Validated data loaded|Saved validated data loaded/);
    await expect(page.locator("main h1")).toHaveCount(1);
    // Compact navigation unmounts after a selection. Reopen it as a user
    // would, then inspect the current-page semantics on a visible link.
    if (await toggle.isVisible() && await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
    await expect(navigation.getByRole("link", { name: label, exact: true })).toHaveAttribute("aria-current", "page");
    await readability(page, info);
    await noOverflow(page);
    if (await toggle.isVisible()) {
      await toggle.click(); await toggle.press("Escape");
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(toggle).toBeFocused();
    }
    if (info.project.name === "desktop-1280" || info.project.name === "forced-colours-390" && ["/", "/risk", "/forecast", "/regional", "/news"].includes(path)) {
      const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      await info.attach(`axe-${label.replaceAll(" ", "-")}.json`, { body: JSON.stringify(scan, null, 2), contentType: "application/json" });
      const blocking = scan.violations.filter(item => item.impact === "critical" || item.impact === "serious");
      expect(blocking, `${label}: critical/serious focused WCAG checks; not complete certification`).toEqual([]);
    }
  });
  expect(pageErrors, "Hydrated production routes must not throw browser exceptions").toEqual([]);
});

test("release gate browser negative control", async ({ page, context }) => {
  await installFixture(context, await dashboardFixture());
  await ready(page, "/");
  expect(process.env.PLAYWRIGHT_INJECT_FAILURE, "Deliberate required browser assertion: a failure must block the release gate.").not.toBe("1");
});

test("news topic and source filters intersect, announce counts and recover from no matches", async ({ page, context }, info) => {
  await installFixture(context, await dashboardFixture());
  await ready(page, "/news"); await readability(page, info);
  const topics = page.getByRole("group", { name: "Filter news by topic" });
  const sources = page.getByRole("group", { name: "Filter news by source" });
  await topics.getByRole("button", { name: "Inflation", exact: true }).click();
  await expect(topics.getByRole("button", { name: "Inflation", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".news-meta [role=status]")).toHaveText("1 matching verified-date headlines. Source status: fresh.");
  await expect(page.locator(".news-featured h2")).toHaveText("Fixture inflation release");
  await sources.getByRole("button", { name: "Markets Desk", exact: true }).click();
  await expect(page.locator(".news-empty")).toContainText("No headlines match these filters");
  await expect(page.locator(".news-meta [role=status]")).toContainText("0 matching");
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await expect(topics.getByRole("button", { name: "All", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(sources.getByRole("button", { name: "All", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".news-meta [role=status]")).toContainText("3 matching");
  await noOverflow(page);
});

test("regional filters keep official district values, metric years and source notes together", async ({ page, context }, info) => {
  const payload = await dashboardFixture(), regional = payload.regionalLens!;
  const { buildRegionalRecords, formatRegionalValue, formatRegionalPeriod } = await regionalFunctions();
  await installFixture(context, payload);
  const historyRequests: string[] = [];
  page.on("request", request => { if (request.url().includes("/api/dashboard-history")) historyRequests.push(request.url()); });
  await ready(page, "/regional"); await readability(page, info);
  expect(historyRequests).toHaveLength(0);
  const state = buildRegionalRecords(regional, "state").find(record => record.state === "Sarawak")!;
  await page.getByLabel(/^Main region/).selectOption(state.key);
  await expect(page.locator(".regional-comparison article").first()).toContainText(formatRegionalValue(state.metrics.incomeMedian.value, state.metrics.incomeMedian.unit));
  await page.getByLabel(/^Metric/).selectOption("realGdp");
  const main = page.locator(".regional-comparison article").first();
  await expect(main).toContainText(formatRegionalValue(state.metrics.realGdp.value, state.metrics.realGdp.unit));
  await expect(main).toContainText(formatRegionalPeriod(state.metrics.realGdp.observationPeriod, "annual"));
  await page.getByLabel(/^Geography/).selectOption("district");
  await expect(page.getByLabel(/^Main district/)).toBeEnabled();
  expect(historyRequests).toHaveLength(1);
  expect(new URL(historyRequests[0]).searchParams.get("id")).toBe("regional-districts");
  const district = buildRegionalRecords(regional, "district").find(record => record.metrics.realGdp.value !== null && record.metrics.incomeMedian.value !== null)!;
  expect(district, "Fixture must contain at least one district with separately published GDP and HIES").toBeTruthy();
  await page.getByLabel(/^Main district/).selectOption(district.key);
  await expect(main).toContainText(district.label);
  await expect(main).toContainText(formatRegionalValue(district.metrics.realGdp.value, district.metrics.realGdp.unit));
  await expect(main).toContainText("DOSM district real GDP");
  await expect(main).toContainText(formatRegionalPeriod(district.metrics.realGdp.observationPeriod, "annual"));
  await page.getByLabel(/^Metric/).selectOption("headlineInflation");
  await expect(main.locator("strong")).toHaveText("Unavailable");
  await expect(page.locator(".regional-unavailable")).toContainText("No official district CPI is supplied");
  await page.getByLabel(/^Metric/).selectOption("incomeMedian");
  await expect(main).toContainText(formatRegionalValue(district.metrics.incomeMedian.value, district.metrics.incomeMedian.unit));
  await expect(main).toContainText(formatRegionalPeriod(district.metrics.incomeMedian.observationPeriod, "annual"));
  await expect(main).not.toContainText(/Jan(?:uary)?/);
  await page.getByRole("button", { name: "Table", exact: true }).click();
  const row = page.locator(".data-table").getByRole("rowheader", { name: district.label, exact: true }).locator("..");
  await expect(row).toContainText(formatRegionalPeriod(district.metrics.incomeMedian.observationPeriod, "annual"));
  await expect(row).toContainText(formatRegionalPeriod(district.metrics.realGdp.observationPeriod, "annual"));
  await expect(row.locator("a").first()).toHaveAttribute("href", district.metrics.incomeMedian.sourceUrl);
  const bookmark = await page.locator(".regional-meta a").getAttribute("href");
  expect(new URL(bookmark!, "http://127.0.0.1:4185").searchParams.get("regionalPrimary")).toBe(district.key);
  await page.getByLabel(/^Geography/).selectOption("state");
  const income = page.locator(".income-group-row").first();
  await income.focus();
  await expect(income).toHaveAttribute("aria-current", "true");
  await expect(income).toContainText("Official income percentiles");
  await expect(page.locator("#regional .chart-live-description")).toHaveText((await income.getAttribute("aria-label"))!);
  await noOverflow(page);
});

test("Snapshot point inspection has equal keyboard, pointer and synthesized touch values", async ({ page, context }, info) => {
  const payload = await dashboardFixture(); await installFixture(context, payload);
  await ready(page, "/"); await readability(page, info);
  const bars = page.locator('[data-chart-kind="snapshot"] button.bar-column');
  const first = bars.first(), last = bars.last();
  await last.focus(); await last.press("Home"); await expect(first).toBeFocused();
  await expect(first).toHaveAttribute("aria-pressed", "true");
  await first.press("End"); await expect(last).toBeFocused();
  const live = await chartStatus(page, await last.getAttribute("aria-describedby"));
  await expect(live).toHaveAttribute("aria-live", "polite");
  await expect(live).toHaveAttribute("aria-atomic", "true");
  const reading = await last.getAttribute("aria-label");
  await expect(live).toHaveText(reading!);
  const focus = await last.evaluate(element => ({ style: getComputedStyle(element).outlineStyle, width: parseFloat(getComputedStyle(element).outlineWidth) }));
  expect(focus.style).not.toBe("none"); expect(focus.width).toBeGreaterThanOrEqual(2);
  await last.click(); await expect(live).toHaveText(reading!);
  await last.tap(); await expect(live).toHaveText(reading!);
  await last.press("Escape"); await expect(last).toBeFocused();
  await expect(live).toHaveText("No observation selected.");
  const inspector = page.getByRole("slider", { name: "Headline inflation observation" });
  await inspector.focus(); await inspector.press("Home");
  await expect(inspector).toHaveAttribute("aria-valuetext", (await first.getAttribute("aria-label"))!);
  await noOverflow(page);
});

test("earlier GDP years load on demand and missing spending is not borrowed from the latest year", async ({ page, context }, info) => {
  const payload = await dashboardFixture();
  const oldYear = payload.economicStructure!.years[0].year;
  payload.growthDrivers!.demand.years = payload.growthDrivers!.demand.years.filter(row => row.year !== oldYear);
  await installFixture(context, payload);
  let historyRequests = 0;
  page.on("request", request => { if (request.url().includes("id=gdp-years")) historyRequests++; });
  await ready(page, "/structure"); await readability(page, info);
  expect(historyRequests).toBe(0);
  await page.getByRole("button", { name: "Load earlier years and complete trend", exact: true }).click();
  await expect(page.getByLabel("Calendar year").locator(`option[value="${oldYear}"]`)).toHaveCount(1);
  expect(historyRequests).toBe(1);
  await page.getByLabel("Calendar year").selectOption(String(oldYear));
  await page.getByRole("button", { name: "Expenditure side", exact: true }).click();
  await expect(page.locator(".structure-analysis")).toContainText("Expenditure-side GDP is not available for this selected year.");
  await expect(page.locator(".demand-view")).toHaveCount(0);
  await noOverflow(page);
});
