import type { DashboardPayload, DataHealth, InputHealth, SeriesHistoryCoverage } from "./dashboard";

const macroInputs = ["headline", "core", "unemployment", "opr", "fx", "mgs"];
const sourceLabels: Record<string, string> = {
  market: "FBM KLCI (delayed market prices)",
  mgsDailyHistory: "10-year MGS historical coverage",
  production: "GDP by production sector",
  economicStructure: "GDP by production sector",
  demand: "GDP by expenditure components",
  "growthDrivers.demand": "GDP by expenditure components",
  externalSector: "Trade in goods",
  balancePayments: "Balance of payments",
  "regional:nationalIncome": "National household income benchmark",
  "regional:nationalPoverty": "National poverty benchmark",
  "regional:nationalInequality": "National income-inequality benchmark",
  "regional:hiesState": "Household income and spending by state",
  "regional:nationalExpenditure": "National household spending benchmark",
  "regional:hiesDistrict": "Household income and spending by district",
  "regional:incomeGroupState": "Household income groups by state",
  "regional:incomeGroupNational": "National household income groups",
  "regional:incomeGroups": "Household income groups",
  "regional:labour": "Labour-force indicators by district",
  "regional:gdpState": "GDP by state and sector",
  "regional:gdpDistrict": "GDP by district and sector",
  "regional:gdp": "Regional GDP data",
  "regional:cpi": "Headline inflation by state",
};

function humanizeSourceId(id: string): string {
  return id.replace(/^regional:/, "Regional · ").replace(/[._]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const dependencies: Record<string, string[]> = {
  forecast: macroInputs,
  riskHeatmap: [...macroInputs, "market", "production", "demand", "externalSector"],
  latestBrief: [...macroInputs, "market", "production", "demand", "externalSector"],
  decisionGuide: [...macroInputs, "market", "externalSector"],
  householdPressure: [...macroInputs, "market"],
  sectorDeepDive: ["production", "demand", "market", "externalSector"],
  macroTimeline: [...macroInputs, "market"],
  monthlyReport: [...macroInputs, "market", "production", "demand", "externalSector", "balancePayments"],
};

function looksMonthlySpaced(points: Array<{ date: string }>): boolean {
  const times = points.map(({ date }) => Date.parse(date)).filter(Number.isFinite).sort((a, b) => a - b);
  if (times.length < 5) return false;
  const gaps = times.slice(1).map((time, index) => (time - times[index]) / 86_400_000);
  const monthly = gaps.filter((gap) => gap >= 20 && gap <= 40).length;
  const daily = gaps.filter((gap) => gap <= 7).length;
  return monthly / gaps.length >= 0.75 && daily / gaps.length <= 0.1;
}

/** Compatibility guard: legacy artifacts must not label analyses fresh when an input failed. */
export function normalizeDashboard(original: DashboardPayload): DashboardPayload {
  const result = structuredClone(original);
  // Older published snapshots labelled a mostly monthly-spaced MGS series as
  // daily without carrying a history-completeness checkpoint. Keep those
  // observations, but remove the unsupported frequency claim until a pipeline
  // run publishes validated daily coverage metadata.
  const mgs = result.series?.mgs;
  if (mgs && !mgs.historyCoverage && /trading|daily/i.test(mgs.frequency) && looksMonthlySpaced(mgs.points)) {
    const startDate = [...mgs.points].sort((a, b) => a.date.localeCompare(b.date))[0]?.date ?? "";
    const legacyCoverage: SeriesHistoryCoverage = {
      status: "partial", startDate, throughDate: null, completed: false,
      requests: null, observations: null, retrievedAt: null,
      message: "This saved series is mostly monthly-spaced, not a verified complete daily trading-day history. No backfill checkpoint is recorded in this snapshot.",
    };
    mgs.frequency = "Mixed cadence; daily history not yet verified";
    mgs.historyCoverage = legacyCoverage;
    if (result.sources.mgs) result.sources.mgs.historyCoverage = legacyCoverage;
  }
  const legacyHealth = (result.dataHealth as (DashboardPayload["dataHealth"] & { overallHealth?: string }) | undefined)?.overallHealth;
  const declaredDataHealth = result.dataHealth?.overall ?? legacyHealth;
  const fallback = !!result.usingFallback || result.health === "fallback" || declaredDataHealth === "fallback";
  const previouslyPartial = result.health === "partial" || declaredDataHealth === "partial";
  for (const source of Object.values(result.sources)) {
    if (source.status !== "fresh" && !source.lastAttemptAt && source.retrievedAt) {
      source.lastAttemptAt = source.retrievedAt;
      source.retrievedAt = null;
      source.message = `${source.message ?? "Saved series retained."} Legacy refresh time records an attempt; the last successful retrieval is not recorded.`;
    }
  }
  for (const [id, source] of Object.entries(result.sources)) {
    const series = result.series[id];
    if (!series) continue;
    source.label ??= series.title;
    source.source ??= series.source;
    source.sourceUrl ??= series.source_url;
    source.unit ??= series.unit;
  }
  const hies = result.regionalLens?.sources?.hiesState as ({ national?: { expenditureMean: number | null }; nationalExpenditure?: { status: string; value: number | null; observationPeriod?: string; retrievedAt?: string | null; lastAttemptAt?: string; sourceUrl?: string; message?: string }; observationPeriod?: string; status?: string } | undefined);
  // Legacy national expenditure was a mean of state means. Never serve it as an official benchmark.
  if (hies?.national && !hies.nationalExpenditure) {
    hies.national.expenditureMean = null;
    hies.status = "stale";
    if (result.regionalLens) {
      result.regionalLens.status = "partial";
      for (const record of result.regionalLens.stateRecords) if (record.vsNational) record.vsNational.expenditureMean = null;
    }
  }
  const sourceStatus: Record<string, string> = Object.fromEntries(
    Object.entries(result.sources).map(([key, value]) => [key, value.status]),
  );
  const regionalSources = Object.fromEntries(Object.entries(result.regionalLens?.sources ?? {}).map(([id, source]) => [`regional:${id}`, source]));
  const extraSources = {
    market: result.market,
    mgsDailyHistory: result.series.mgs.historyCoverage,
    production: result.growthDrivers?.production ?? result.economicStructure,
    demand: result.growthDrivers?.demand,
    externalSector: result.externalSector,
    balancePayments: result.balancePayments,
    ...regionalSources,
    ...(!regionalSources["regional:nationalExpenditure"] && hies?.nationalExpenditure ? { "regional:nationalExpenditure": hies.nationalExpenditure } : {}),
  };
  for (const [id, source] of Object.entries(extraSources)) {
    if (source) sourceStatus[id] = source.status ?? "unavailable";
  }
  result.inputHealth = {};
  for (const [key, inputs] of Object.entries(dependencies)) {
    const section = (result as unknown as Record<string, unknown>)[key] as { status?: string; inputHealth?: InputHealth } | undefined;
    if (!section) continue;
    const staleInputs = inputs.filter((id) => sourceStatus[id] !== "fresh");
    const degraded = staleInputs.length > 0 || (section.status && section.status !== "fresh");
    const status = fallback ? "fallback" : degraded ? "partial" : "fresh";
    const health: InputHealth = {
      status,
      staleInputs,
      note: fallback
        ? "Saved dashboard snapshot; a current source refresh could not be verified."
        : staleInputs.length
          ? `Includes saved or unavailable inputs: ${staleInputs.join(", ")}. Calculation time does not mean every input is fresh.`
          : degraded
            ? "A previous analysis is retained; the latest calculation could not be verified."
            : "Inputs were retrieved and validated successfully. See individual official observation periods; releases have different schedules.",
    };
    // Do not relabel a previously failed model calculation as successful.
    if (degraded && section.status === "fresh") section.status = key === "forecast" ? "stale" : "partial";
    section.inputHealth = health;
    result.inputHealth[key] = health;
  }
  if (result.riskHeatmap) {
    for (const item of result.riskHeatmap.items) {
      // Required scoring inputs can be missing even when a source was retrieved.
      // A fallback flag must never turn that missing measurement into a valid score.
      if (item.score === null || item.level === "unavailable" || item.dataStatus === "unavailable") {
        item.dataStatus = "unavailable";
        continue;
      }
      const id = ({ bursa: "market", growth: "demand", gdp: "demand", trade: "externalSector" } as Record<string, string>)[item.id] ?? item.id;
      item.dataStatus = fallback ? "fallback" : item.dataStatus && item.dataStatus !== "fresh" ? item.dataStatus : sourceStatus[id] ?? "unavailable";
    }
    const availableCount = result.riskHeatmap.items.filter((item) => typeof item.score === "number" && Number.isFinite(item.score) && item.level !== "unavailable" && item.dataStatus !== "unavailable").length;
    if (availableCount < result.riskHeatmap.items.length) {
      if (!availableCount) result.riskHeatmap.status = "unavailable";
      else if (result.riskHeatmap.status === "fresh") result.riskHeatmap.status = "partial";
      const health = result.inputHealth.riskHeatmap;
      if (health) {
        health.status = fallback ? "fallback" : "partial";
        health.note = `${availableCount} of ${result.riskHeatmap.items.length} risk scores are available. Missing signals are excluded; weights are renormalised over available scores. ${health.note}`;
      }
    }
  }
  if (result.structuralBreaks) {
    for (const [id, indicator] of Object.entries(result.structuralBreaks.indicators)) {
      if ((sourceStatus[id] !== "fresh" || sourceStatus.opr !== "fresh") && indicator.status === "fresh") indicator.status = "stale";
    }
    if (Object.values(result.structuralBreaks.indicators).some((item) => item.status !== "fresh")) result.structuralBreaks.status = "partial";
  }
  const rows: DataHealth["sources"] = Object.entries(result.sources).map(([id, source]) => ({ id, ...source }));
  for (const [id, source] of Object.entries(extraSources)) {
    if (!source) continue;
    if (rows.some((row) => row.id === id)) continue;
    const value = source as { status?: string; retrievedAt?: string; lastAttemptAt?: string; observationPeriod?: string; throughDate?: string | null; summary?: { latestDate?: string }; message?: string; source?: string; sourceUrl?: string; datasetUrl?: string; freshness?: DataHealth["sources"][number]["freshness"]; benchmark?: { source?: string; sourceUrl?: string; benchmarkSource?: string; benchmarkSourceUrl?: string } };
    const legacyAttempt = value.status !== "fresh" && !value.lastAttemptAt ? value.retrievedAt : undefined;
    const display = id === "market"
      ? { source: "Yahoo Finance (delayed market data)", sourceUrl: value.benchmark?.sourceUrl, relatedSource: value.benchmark?.benchmarkSource || "FTSE Russell / Bursa Malaysia", relatedSourceUrl: value.benchmark?.benchmarkSourceUrl }
      : id === "mgsDailyHistory"
        ? { source: "Bank Negara Malaysia (BNM) Financial Markets", sourceUrl: "https://financialmarkets.bnm.gov.my/benchmark-yields" }
        : id.startsWith("regional:")
          ? { source: "Department of Statistics Malaysia via data.gov.my" }
          : {};
    const declaredLabel = (source as { label?: string }).label;
    const publisher = typeof value.source === "string" && value.source.trim() ? value.source : display.source;
    const sourceUrl = [value.sourceUrl, value.datasetUrl, display.sourceUrl].find((url) => typeof url === "string" && url.trim());
    rows.push({ id, label: declaredLabel && declaredLabel !== id ? declaredLabel : sourceLabels[id] ?? humanizeSourceId(id), source: publisher, sourceUrl, relatedSource: "relatedSource" in display ? display.relatedSource : undefined, relatedSourceUrl: "relatedSourceUrl" in display ? display.relatedSourceUrl : undefined, freshness: value.freshness, status: value.status ?? "stale", retrievedAt: legacyAttempt ? null : value.retrievedAt ?? null, lastAttemptAt: value.lastAttemptAt ?? legacyAttempt, observationPeriod: value.observationPeriod ?? value.throughDate ?? value.summary?.latestDate ?? "", message: legacyAttempt ? `${value.message ?? "Saved source retained."} Last successful retrieval is not recorded.` : value.message ?? "Source status validated" });
  }
  const staleCount = rows.filter((source) => source.status !== "fresh").length;
  result.health = fallback ? "fallback" : staleCount || previouslyPartial ? "partial" : "fresh";
  result.dataHealth = {
    generatedAt: result.generatedAt,
    overall: result.health,
    schemaVersion: result.schemaVersion,
    staleCount,
    sources: rows,
    ...(result.series.mgs.historyCoverage ? {
      mgsDailyHistory: {
        ...result.series.mgs.historyCoverage,
        latestObservationDate: result.series.mgs.points.at(-1)?.date ?? "",
      },
    } : {}),
    note: fallback
      ? "A saved fallback snapshot is displayed. Observation periods are unchanged; this is not a live refresh."
      : `${rows.length - staleCount} of ${rows.length} source groups were retrieved successfully. Fresh means a successful retrieval, not a same-day observation. Older surveys can be the latest official release.`,
  };
  return result;
}
