import { expect, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import type { DashboardPayload, RegionalLens } from "../../app/lib/dashboard";
import type { NewsPayload } from "../../app/views/NewsView";
import { installDashboardFixture } from "../../scripts/browser-fixture.mjs";
import { loadProjectionModule } from "../../scripts/measurement-projection.mjs";

export const BASE = "http://127.0.0.1:4185";
export const ROUTES = [
  ["/", "Snapshot"], ["/brief", "Brief"], ["/news", "News"], ["/risk", "Risk heatmap"],
  ["/forecast", "Forecast"], ["/drivers", "Drivers"], ["/structure", "Growth drivers"],
  ["/external", "External sector"], ["/bop", "BOP"], ["/household", "Households"],
  ["/regional", "Regional Lens"], ["/sectors", "Sectors"], ["/bursa", "Bursa"],
  ["/decisions", "Decision guide"], ["/timeline", "Timeline"], ["/structural", "Structural shifts"],
  ["/report", "Report"], ["/health", "Data health"], ["/methodology", "Methodology"],
] as const;

export async function dashboardFixture(): Promise<DashboardPayload> {
  return JSON.parse(await readFile(new URL("../../data/published/dashboard.json", import.meta.url), "utf8"));
}

export const NEWS: NewsPayload = {
  schemaVersion: 1, generatedAt: "2026-10-05T06:00:00Z", status: "fresh",
  refreshPolicy: "Controlled browser fixture; not live news.", queryWindow: "Controlled seven-day window",
  sources: [{ id: "desk", label: "Test Desk", url: "https://example.com/desk", status: "fresh", message: "Controlled source" }],
  items: [
    { title: "Fixture inflation release", link: "https://example.com/inflation", publishedAt: "2026-10-04T02:00:00Z", source: "Test Desk", summary: "Controlled inflation story.", topics: ["Inflation"], relevanceScore: 10 },
    { title: "Fixture trade release", link: "https://example.com/trade", publishedAt: "2026-10-03T02:00:00Z", source: "Markets Desk", summary: "Controlled trade story.", topics: ["Trade"], relevanceScore: 9 },
    { title: "Fixture policy discussion", link: "https://example.com/policy", publishedAt: "2026-10-02T02:00:00Z", source: "Test Desk", summary: "Controlled policy story.", topics: ["Policy"], relevanceScore: 8 },
  ], disclaimer: "Browser fixture only, not factual news.",
};

export async function installFixture(context: BrowserContext, payload: DashboardPayload) {
  await context.route("**/*", route => new URL(route.request().url()).origin === BASE ? route.continue() : route.abort());
  await installDashboardFixture(context, BASE, payload);
  await context.route("**/api/news?*", route => route.fulfill({ json: NEWS }));
}

export async function ready(page: Page, path: string) {
  await page.goto(path);
  if (path.startsWith("/news")) await expect(page.locator(".news-meta [role=status]")).toContainText("verified-date headlines");
  else await expect(page.locator(".dashboard-load-status.shell").first()).toContainText(/Validated data loaded|Saved validated data loaded/);
  await expect(page.locator("main h1")).toHaveCount(1);
}

async function enlargeText200(page: Page) {
  await page.evaluate(() => {
    const state = window as Window & { __browserFontBaseline?: WeakMap<HTMLElement, string> };
    const baseline = state.__browserFontBaseline ??= new WeakMap<HTMLElement, string>();
    const labels = [...document.querySelectorAll<HTMLElement>("h1,h2,h3,h4,p,li,a,button,input,select,summary,small,th,td,label,span,strong,b,time")];
    const all = [document.body, ...labels];
    // Capture inline declarations once, then restore every ancestor before
    // measuring new table/dialog nodes. Inherited enlargement never compounds.
    all.forEach(element => { if (!baseline.has(element)) baseline.set(element, element.style.fontSize); });
    all.forEach(element => { element.style.fontSize = baseline.get(element)!; });
    const fonts = labels.map(element => [element, parseFloat(getComputedStyle(element).fontSize)] as const);
    const bodyFont = parseFloat(getComputedStyle(document.body).fontSize);
    document.body.style.fontSize = `${bodyFont * 2}px`;
    fonts.forEach(([element, font]) => { element.style.fontSize = `${font * 2}px`; });
    document.body.dataset.browserText200 = "true";
    window.dispatchEvent(new Event("resize"));
  });
}

export async function readability(page: Page, info: TestInfo) {
  if (info.project.name === "text-200-at-1280") await enlargeText200(page);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

export async function noOverflow(page: Page) {
  if (await page.locator("body").getAttribute("data-browser-text200")) {
    await enlargeText200(page);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  }
  const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: document.documentElement.clientWidth }));
  expect(dimensions.scroll, "Document must not require horizontal scrolling; bounded data tables may scroll internally.").toBeLessThanOrEqual(dimensions.width + 1);
}

export async function chartStatus(page: Page, describedBy: string | null) {
  const id = describedBy?.split(/\s+/).find(value => /-(reading|status|description)$/.test(value));
  expect(id, "Chart must reference a persistent point description").toBeTruthy();
  return page.locator(`[id=${JSON.stringify(id)}]`);
}

export function riskFixture(payload: DashboardPayload, variant: "fresh" | "stale" | "fallback" | "partial" | "unavailable") {
  const fixture = structuredClone(payload), risk = fixture.riskHeatmap!;
  risk.items = risk.items.map((item, index) => {
    const unavailable = variant === "unavailable" || variant === "partial" && index === 0;
    const score = unavailable ? null : index * 10;
    return { ...item, score, level: score === null ? "unavailable" : score >= 70 ? "high" : score >= 40 ? "moderate" : "low", dataStatus: unavailable ? "unavailable" : variant === "stale" ? "stale" : "fresh", unavailableReason: unavailable ? "Controlled required input is missing." : null };
  });
  const values = risk.items.flatMap(item => item.score === null ? [] : [item.score]);
  risk.overallScore = values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 10) / 10 : null;
  risk.overallLevel = risk.overallScore === null ? "unavailable" : risk.overallScore >= 70 ? "high" : risk.overallScore >= 40 ? "moderate" : "low";
  risk.availableCount = values.length; risk.totalCount = risk.items.length;
  risk.status = !values.length ? "unavailable" : variant === "partial" || variant === "stale" ? "partial" : "fresh";
  risk.summary = "Controlled browser Risk fixture.";
  risk.coverageNote = `${values.length} of ${risk.items.length} components available; missing scores are excluded and weights renormalised.`;
  fixture.usingFallback = variant === "fallback";
  fixture.health = variant === "fallback" ? "fallback" : variant === "fresh" ? "fresh" : "partial";
  fixture.inputHealth = { ...fixture.inputHealth, riskHeatmap: { status: variant === "fallback" ? "fallback" : variant === "fresh" ? "fresh" : "partial", staleInputs: variant === "stale" ? ["headline"] : [], note: "Controlled input-health fixture." } };
  return fixture;
}

export async function projection() { return loadProjectionModule(); }

export async function regionalFunctions(): Promise<typeof import("../../app/lib/regional-data")> {
  const transpile = (source: string) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const url = (code: string) => `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  const geography = url(transpile(await readFile(new URL("../../app/lib/regional-geography.ts", import.meta.url), "utf8")));
  const source = transpile(await readFile(new URL("../../app/lib/regional-data.ts", import.meta.url), "utf8")).replace('from "./regional-geography"', `from ${JSON.stringify(geography)}`);
  return await import(url(source));
}
export async function regionalExporter(): Promise<(data: RegionalLens) => string> { return (await regionalFunctions()).regionalCsv; }

export function csvRows(csv: string): string[][] {
  const rows: string[][] = [], row: string[] = [];
  let value = "", quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    if (char === '"') { if (quoted && csv[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted; }
    else if (char === "," && !quoted) { row.push(value); value = ""; }
    else if (char === "\n" && !quoted) { row.push(value.replace(/\r$/, "")); rows.push([...row]); row.length = 0; value = ""; }
    else value += char;
  }
  if (value || row.length) { row.push(value); rows.push(row); }
  return rows;
}
