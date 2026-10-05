import type { DashboardPayload, InputHealth } from "./dashboard";

const macroInputs = ["headline", "core", "unemployment", "opr", "fx", "mgs"];
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

/** Compatibility guard: legacy artifacts must not label analyses fresh when an input failed. */
export function normalizeDashboard(original: DashboardPayload): DashboardPayload {
  const result = structuredClone(original);
  const fallback = !!result.usingFallback || result.health === "fallback";
  for (const source of Object.values(result.sources)) {
    if (source.status !== "fresh" && !source.lastAttemptAt && source.retrievedAt) {
      source.lastAttemptAt = source.retrievedAt;
      source.retrievedAt = null;
      source.message = `${source.message ?? "Saved series retained."} Legacy refresh time records an attempt; the last successful retrieval is not recorded.`;
    }
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
  const extraSources = {
    market: result.market,
    production: result.growthDrivers?.production ?? result.economicStructure,
    demand: result.growthDrivers?.demand,
    externalSector: result.externalSector,
    balancePayments: result.balancePayments,
    ...Object.fromEntries(Object.entries(result.regionalLens?.sources ?? {}).map(([id, source]) => [`regional:${id}`, source])),
    ...(hies?.nationalExpenditure ? { "regional:nationalExpenditure": hies.nationalExpenditure } : {}),
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
      const id = ({ bursa: "market", growth: "production", gdp: "production", trade: "externalSector" } as Record<string, string>)[item.id] ?? item.id;
      item.dataStatus = fallback ? "fallback" : sourceStatus[id] ?? "unavailable";
    }
  }
  if (result.structuralBreaks) {
    for (const [id, indicator] of Object.entries(result.structuralBreaks.indicators)) {
      if ((sourceStatus[id] !== "fresh" || sourceStatus.opr !== "fresh") && indicator.status === "fresh") indicator.status = "stale";
    }
    if (Object.values(result.structuralBreaks.indicators).some((item) => item.status !== "fresh")) result.structuralBreaks.status = "partial";
  }
  const rows = Object.entries(result.sources).map(([id, source]) => ({ id, ...source }));
  for (const [id, source] of Object.entries(extraSources)) {
    if (!source) continue;
    const value = source as { status?: string; retrievedAt?: string; lastAttemptAt?: string; observationPeriod?: string; summary?: { latestDate?: string }; message?: string };
    const legacyAttempt = value.status !== "fresh" && !value.lastAttemptAt ? value.retrievedAt : undefined;
    rows.push({ id, status: (value.status ?? "stale") as "fresh" | "stale", retrievedAt: legacyAttempt ? null : value.retrievedAt ?? null, lastAttemptAt: value.lastAttemptAt ?? legacyAttempt, observationPeriod: value.observationPeriod ?? value.summary?.latestDate ?? "", message: legacyAttempt ? `${value.message ?? "Saved source retained."} Last successful retrieval is not recorded.` : value.message ?? "Source status validated" });
  }
  const staleCount = rows.filter((source) => source.status !== "fresh").length;
  result.health = fallback ? "fallback" : staleCount || result.health === "partial" ? "partial" : "fresh";
  result.dataHealth = {
    generatedAt: result.generatedAt,
    overall: result.health,
    schemaVersion: result.schemaVersion,
    staleCount,
    sources: rows,
    note: fallback
      ? "A saved fallback snapshot is displayed. Observation periods are unchanged; this is not a live refresh."
      : `${rows.length - staleCount} of ${rows.length} source groups were retrieved successfully. Fresh means a successful retrieval, not a same-day observation. Older surveys can be the latest official release.`,
  };
  return result;
}
