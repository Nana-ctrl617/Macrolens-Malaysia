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
    await navigation.getByRole("searchbox", { name: "Find a page" }).fill(label);
    await navigation.getByRole("link", { name: label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${path === "/" ? "/" : path}/?(?:\\?.*)?$`));
    if (path === "/news") await expect(page.locator(".news-meta [role=status]")).toContainText("verified-date headlines");
    else await expect(page.locator(".dashboard-load-status.shell").first()).toContainText(/Validated data loaded|Saved validated data loaded|Some data coverage is partial/);
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

test("partial dashboard health is clearly announced with a direct route to source details", async ({ page, context }) => {
  const payload = await dashboardFixture();
  payload.health = "partial";
  payload.usingFallback = false;
  await installFixture(context, payload);
  await ready(page, "/");
  const status = page.locator(".dashboard-load-status.shell").first();
  await expect(status).toContainText("Some data coverage is partial");
  await expect(status).toContainText("Values shown passed validation");
  await expect(status.getByRole("link", { name: "Review data health" })).toHaveAttribute("href", "/health");
  await noOverflow(page);
});

test("release gate browser negative control", async ({ page, context }) => {
  await installFixture(context, await dashboardFixture());
  await ready(page, "/");
  expect(process.env.PLAYWRIGHT_INJECT_FAILURE, "Deliberate required browser assertion: a failure must block the release gate.").not.toBe("1");
});

test("the global footer is exposed as a separate contentinfo landmark", async ({ page, context }) => {
  await installFixture(context, await dashboardFixture());
  await ready(page, "/");
  const footer = page.getByRole("contentinfo");
  await expect(footer).toContainText("MacroLens Malaysia");
  await expect(footer).toContainText("Educational analysis, not investment advice.");
  expect(await footer.evaluate(element => element.closest("main"))).toBeNull();
});

test("Data Health links the indicator to its source and explains the observation-age limit", async ({ page, context }) => {
  const payload = await dashboardFixture();
  await installFixture(context, payload);
  await ready(page, "/health");
  const row = page.getByRole("row").filter({ has: page.getByText("Headline inflation", { exact: true }) });
  await expect(row.getByRole("link", { name: "Open dataset or source page ↗" })).toHaveAttribute("href", payload.series.headline.source_url);
  const marketRow = page.getByRole("row").filter({ has: page.getByText("FBM KLCI (delayed market prices)", { exact: true }) });
  await expect(marketRow.getByRole("link", { name: "Open delayed price data ↗" })).toHaveAttribute("href", payload.market.benchmark.sourceUrl);
  await expect(marketRow.getByRole("link", { name: "Open index publisher reference ↗" })).toHaveAttribute("href", payload.market.benchmark.benchmarkSourceUrl);
  await expect(row).toContainText(/\d+ days since period end \/ 100-day limit/);
});

test("Data Health filters source groups without hiding their saved validation status", async ({ page, context }) => {
  const payload = await dashboardFixture();
  payload.sources.headline.status = "stale";
  await installFixture(context, payload);
  await ready(page, "/health");

  const filterGroup = page.getByRole("group", { name: "Filter data-health sources" });
  await filterGroup.getByRole("button", { name: /Needs attention/ }).click();
  await expect(filterGroup.getByRole("button", { name: /Needs attention/ })).toHaveAttribute("aria-pressed", "true");
  const headlineRow = () => page.getByRole("row").filter({ has: page.getByText("Headline inflation", { exact: true }) });
  await expect(headlineRow()).toContainText("stale");
  const attentionRows = page.locator(".deep-table-wrap tbody tr");
  const attentionStatuses = await attentionRows.locator("td:nth-child(2)").allTextContents();
  expect(attentionStatuses.length).toBeGreaterThan(0);
  expect(attentionStatuses.every((status) => status.trim() !== "fresh")).toBe(true);
  const attentionBadge = await filterGroup.getByRole("button", { name: /Needs attention/ }).innerText();
  expect(attentionStatuses).toHaveLength(Number(attentionBadge.match(/\d+/)?.[0]));

  await filterGroup.getByRole("button", { name: /Last validation successful/ }).click();
  await expect(headlineRow()).toHaveCount(0);
  const validatedStatuses = await page.locator(".deep-table-wrap tbody tr td:nth-child(2)").allTextContents();
  expect(validatedStatuses.every((status) => status.trim() === "fresh")).toBe(true);
  await expect(page.locator(".health-source-count")).toContainText(/Showing \d+ of \d+ source groups/);
});

test("navigation search finds pages by label or topic and explains no matches", async ({ page, context }) => {
  await installFixture(context, await dashboardFixture());
  await ready(page, "/regional");
  const toggle = page.getByRole("button", { name: /^Sections\. Current page:/ });
  if (await toggle.isVisible()) await toggle.click();
  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  const search = nav.getByRole("searchbox", { name: "Find a page" });
  await search.fill("jobs");
  await expect(nav.getByRole("link", { name: "Snapshot", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Households", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Regional Lens", exact: true })).toBeVisible();
  await expect(nav.getByRole("status")).toContainText("pages found");
  await search.fill("inflation");
  await expect(nav.getByRole("link", { name: "Snapshot", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Forecast", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Inflation drivers", exact: true })).toBeVisible();
  await search.fill("exchange rate");
  await expect(nav.getByRole("link", { name: "External sector", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Snapshot", exact: true })).toHaveCount(0);
  await search.fill("not a real section");
  await expect(nav.getByRole("status")).toHaveText("No pages match that search. Try a page name or topic such as inflation, jobs, trade or markets.");
  await search.clear();
  await expect(nav.getByRole("link", { name: "Regional Lens", exact: true })).toBeVisible();
});

test("forecast page displays the information origin from its validated payload", async ({ page, context }) => {
  const payload = await dashboardFixture();
  await installFixture(context, payload);
  await ready(page, "/forecast");
  const origin = payload.forecast.informationOrigin;
  expect(origin, "forecast payload includes the model's aligned information origin").toBeTruthy();
  const expected = new Intl.DateTimeFormat("en-MY", { month: "short", year: "numeric" }).format(new Date(`${origin}T00:00:00`));
  const note = page.locator(".forecast-origin");
  await expect(note).toContainText(`Model information origin: ${expected}.`);
  await expect(note).toContainText("latest aligned data month");
  await expect(note).toContainText("released after its reference month");
});

test("Snapshot cards link each indicator to its official source and explain stale data", async ({ page, context }, info) => {
  const payload = await dashboardFixture();
  payload.health = "partial";
  payload.usingFallback = false;
  payload.sources.mgs.status = "stale";
  payload.cpiDecomposition.calculationStatus = "stale";
  await installFixture(context, payload);
  await ready(page, "/");
  await expect(page.locator(".snapshot-meta .data-status")).toContainText("Dashboard sources · partial");
  await expect(page.locator(".snapshot-meta .data-status")).not.toContainText("Official data");
  const cards = page.locator(".metric-card");
  await expect(cards).toHaveCount(6);
  const ids = ["headline", "core", "opr", "unemployment", "fx", "mgs"] as const;
  for (let index = 0; index < ids.length; index++) {
    const card = cards.nth(index), series = payload.series[ids[index]];
    const source = card.getByRole("link", { name: `Source: ${series.source}` });
    await expect(source).toHaveAttribute("href", series.source_url);
    await expect(card.getByRole("button")).toContainText("Release period");
  }
  const staleCard = cards.nth(ids.indexOf("mgs"));
  await expect(staleCard).toContainText("10-year government bond yield");
  await expect(staleCard).toContainText("Malaysian Government Securities (MGS)");
  await expect(staleCard).toContainText("Stale");
  await expect(staleCard).toContainText("The latest refresh did not pass; showing the last validated observation.");
  const pressurePanel = page.locator(".snapshot-price-pressures");
  const leadingPressure = payload.categories.filter((item: { contribution?: number }) => Number.isFinite(item.contribution) && item.contribution! > 0).sort((a: { contribution?: number }, b: { contribution?: number }) => (b.contribution ?? 0) - (a.contribution ?? 0))[0];
  await expect(pressurePanel.locator(".snapshot-pressure-status")).toHaveText("Last validated estimate");
  await expect(pressurePanel.locator("ol li").first()).toContainText(leadingPressure.name);
  await expect(pressurePanel.locator("ol li").first()).toContainText(`+${leadingPressure.contribution.toFixed(2)} pp`);
  await expect(pressurePanel).toContainText("show where measured inflation is concentrated, not why prices changed");
  await expect(pressurePanel.getByRole("link", { name: "OpenDOSM division inflation data ↗" })).toHaveAttribute("href", "https://open.dosm.gov.my/data-catalogue/cpi_headline_inflation");
  await expect(pressurePanel.getByRole("link", { name: "DOSM weight reference & method (2022 weights) ↗" })).toHaveAttribute("href", payload.cpiDecomposition.sourceUrl);
  await readability(page, info);
  await noOverflow(page);
});

test("MGS history explorer visibly warns while saved history is mixed-cadence", async ({ page, context }, info) => {
  const payload = await dashboardFixture();
  const coverage = {
    status: "partial" as const,
    startDate: payload.series.mgs.points[0].date,
    throughDate: null,
    completed: false,
    requests: null,
    observations: null,
    retrievedAt: null,
    message: "This saved series is mostly monthly-spaced, not a verified complete daily trading-day history. No backfill checkpoint is recorded in this snapshot.",
  };
  payload.series.mgs.frequency = "Mixed cadence; daily history not yet verified";
  payload.series.mgs.historyCoverage = coverage;
  payload.sources.mgs.historyCoverage = coverage;
  await installFixture(context, payload);
  await ready(page, "/");
  await page.getByRole("button", { name: /Open history for 10-year government bond yield/i }).click();
  const dialog = page.getByRole("dialog", { name: "10-year MGS yield" });
  await expect(dialog).toBeVisible();
  const warning = dialog.getByRole("complementary", { name: "MGS history coverage" });
  await expect(warning).toHaveClass(/partial/);
  await expect(warning).toContainText("Daily history backfill in progress");
  await expect(warning).toContainText("not a verified complete daily trading-day history");
  await expect(dialog).toContainText("Mixed cadence; daily history not yet verified");
  await readability(page, info);
  await noOverflow(page);
});

test("news topic and source filters intersect, announce counts and recover from no matches", async ({ page, context }, info) => {
  await installFixture(context, await dashboardFixture());
  await ready(page, "/news"); await readability(page, info);
  const topics = page.getByRole("group", { name: "Filter news by topic" });
  const sources = page.getByRole("group", { name: "Filter news by source" });
  await topics.getByRole("button", { name: "Inflation", exact: true }).click();
  await expect(topics.getByRole("button", { name: "Inflation", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".news-meta [role=status]")).toHaveText("1 matching story across 1 verified-date headline. Source status: fresh.");
  await expect(page.locator(".news-featured h2")).toHaveText("Fixture inflation release");
  await sources.getByRole("button", { name: "Markets Desk", exact: true }).click();
  await expect(page.locator(".news-empty")).toContainText("No headlines match these filters");
  await expect(page.locator(".news-meta [role=status]")).toContainText("0 matching stories across 0 verified-date headlines");
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await expect(topics.getByRole("button", { name: "All", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(sources.getByRole("button", { name: "All", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".news-meta [role=status]")).toContainText("6 matching stories across 9 verified-date headlines");
  await expect(page.locator(".news-grid .news-card")).toHaveCount(5);
  await expect(page.locator(".news-grid .news-coverage").first()).toContainText("Markets Desk");
  await noOverflow(page);
});

test("news groups overlapping publisher coverage without hiding links or changing date order", async ({ page, context }) => {
  await installFixture(context, await dashboardFixture());
  await ready(page, "/news");
  await expect(page.locator(".news-featured h2")).toHaveText("Fixture inflation release");
  await expect(page.locator(".news-featured .news-coverage")).toContainText("Test Desk");
  const trade = page.locator(".news-grid .news-card").filter({ hasText: "Malaysia exports surge as trade surplus grows" });
  await expect(trade).toHaveCount(1);
  await trade.locator(".news-coverage summary").click();
  await expect(trade.locator(".news-coverage a")).toHaveCount(2);
  await expect(trade.locator(".news-coverage")).toContainText("3 Oct 2026");
  const bursa = page.locator(".news-grid .news-card").filter({ hasText: "Bursa Malaysia snaps four-day winning streak" });
  await expect(bursa).toHaveCount(1);
  await bursa.locator(".news-coverage summary").click();
  await expect(bursa.locator(".news-coverage a")).toHaveCount(2);
  const ringgit = page.locator(".news-grid .news-card").filter({ hasText: "Ringgit firms against US dollar ahead of GDP estimates" });
  await expect(ringgit).toHaveCount(1);
  await ringgit.locator(".news-coverage summary").click();
  await expect(ringgit.locator(".news-coverage a")).toHaveCount(2);
  await expect(page.locator(".news-grid .news-card").filter({ hasText: "Ringgit slides against US dollar after oil price shock" })).toHaveCount(1);
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
