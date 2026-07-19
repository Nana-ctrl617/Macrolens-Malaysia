import fallback from "@/data/published/dashboard.json";

export type DataPoint = { date: string; value: number };
export type SeriesData = {
  key: string;
  title: string;
  unit: string;
  decimals: number;
  frequency: string;
  source: string;
  source_url: string;
  points: DataPoint[];
};
export type StructuralEvent = { date: string; title: string; category: string; source: string; sourceUrl: string; monthDistance: number };
export type StructuralCandidate = {
  breakPeriod: string;
  status: "supported" | "possible" | "not-supported";
  statusLabel: string;
  adjacentSample: { preStart: string; preEnd: string; postStart: string; postEnd: string; preObservations: number; postObservations: number };
  chow: { fStatistic: number; dfNumerator: number; dfDenominator: number; pRaw: number; pHolm: number };
  hacWald: { statistic: number; df: number; pValue: number; maxLags: number };
  regimeComparison: { preMean: number; postMean: number; absoluteChange: number; percentChange: number | null; preAnnualTrend: number; postAnnualTrend: number; annualTrendChange: number; standardisedMeanChange: number | null };
  nearbyEvents: StructuralEvent[];
};
export type StructuralIndicator = {
  indicatorId: string;
  status: "fresh" | "stale" | "unavailable";
  calculatedAt: string;
  sample: { start: string; end: string; observations: number; frequency: string; minimumSegmentMonths: number; confidence: string };
  screening: { method: string; criterion: string; maximumBreaks: number; selectedBreaks: number; bic: number | null };
  diagnostics: { adfStatistic: number | null; adfPValue: number | null; adfLags: number | null; cusumStatistic: number | null; cusumPValue: number | null };
  warnings: string[];
  candidates: StructuralCandidate[];
  narrative: string;
};
export type StructuralBreaks = {
  status: "fresh" | "partial";
  calculatedAt: string;
  methodology: { model: string; screening: string; confirmation: string; robustness: string; significanceLevel: number; suggestiveLevel: number; eventWindowMonths: number; causalClaim: boolean };
  indicators: Record<string, StructuralIndicator>;
};
export type MarketData = {
  status: "fresh" | "stale";
  retrievedAt: string;
  message: string;
  benchmark: {
    id: "fbmklci"; title: string; symbol: string; currency: string; unit: string; decimals: number;
    frequency: string; source: string; sourceUrl: string; benchmarkSource: string; benchmarkSourceUrl: string;
    delayed: boolean; points: DataPoint[];
  };
  summary: {
    latest: number; latestDate: string; change1D: number; return1M: number | null; return3M: number | null;
    returnYtd: number | null; return1Y: number | null; annualizedVolatility1Y: number | null;
    maxDrawdown1Y: number; high52w: number; low52w: number;
  };
  narratives: { performance: string; macro: string };
};
export type DecisionCard = {
  id: string; theme: string; stance: string; title: string; evidence: string;
  actions: string[]; watch: string;
};
export type DecisionGuide = {
  generatedAt: string; status: "fresh" | "partial"; title: string; summary: string;
  signals: Array<{ label: string; value: string; period: string; reading: string }>;
  audiences: { individuals: DecisionCard[]; companies: DecisionCard[] };
  sources: Array<{ name: string; url: string }>;
  disclaimer: string;
};
export type DashboardPayload = {
  schemaVersion: number;
  generatedAt: string;
  health: "fresh" | "partial" | "fallback";
  usingFallback?: boolean;
  sources: Record<string, { status: "fresh" | "stale"; retrievedAt: string; observationPeriod: string; message: string }>;
  series: Record<string, SeriesData>;
  categories: Array<{ code: string; name: string; value: number }>;
  forecast: {
    selectedModel: string;
    methodLabel: string;
    backtestWindows: number;
    status: string;
    models: Array<{ name: string; rmse: number; mae: number; selected: boolean }>;
    points: Array<{ date: string; value: number; low80: number; high80: number; low95: number; high95: number }>;
  };
  narratives: { snapshot: string; forecast: string; financial: string };
  structuralBreaks?: StructuralBreaks;
  market?: MarketData;
  decisionGuide?: DecisionGuide;
};

const DEFAULT_URL = "https://raw.githubusercontent.com/Nana-ctrl617/macrolens-malaysia/main/data/published/dashboard.json";

export function isDashboard(value: unknown): value is DashboardPayload {
  if (!value || typeof value !== "object") return false;
  const candidate = value as DashboardPayload;
  const required = ["headline", "core", "opr", "unemployment", "fx", "mgs"];
  const structuralValid = candidate.schemaVersion === 1 || (
    (candidate.schemaVersion === 2 || candidate.schemaVersion === 3 || candidate.schemaVersion === 4)
    && !!candidate.structuralBreaks
    && required.every((key) => candidate.structuralBreaks?.indicators?.[key]?.indicatorId === key)
  );
  const marketValid = candidate.schemaVersion < 3 || (
    candidate.market?.benchmark?.id === "fbmklci"
    && Array.isArray(candidate.market.benchmark.points)
    && candidate.market.benchmark.points.length >= 250
    && typeof candidate.market.summary?.latest === "number"
  );
  const decisionValid = candidate.schemaVersion !== 4 || (
    candidate.decisionGuide?.audiences?.individuals?.length === 4
    && candidate.decisionGuide?.audiences?.companies?.length === 4
    && candidate.decisionGuide?.signals?.length >= 6
  );
  return (candidate.schemaVersion === 1 || candidate.schemaVersion === 2 || candidate.schemaVersion === 3 || candidate.schemaVersion === 4)
    && structuralValid
    && marketValid
    && decisionValid
    && typeof candidate.generatedAt === "string"
    && required.every((key) => Array.isArray(candidate.series?.[key]?.points) && candidate.series[key].points.length > 0)
    && Array.isArray(candidate.forecast?.points)
    && candidate.forecast.points.length === 3;
}

export async function getDashboard(): Promise<DashboardPayload> {
  const local = fallback as DashboardPayload;
  const url = process.env.DASHBOARD_DATA_URL || DEFAULT_URL;
  try {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Remote dashboard returned ${response.status}`);
    const remote: unknown = await response.json();
    if (!isDashboard(remote)) throw new Error("Remote dashboard schema is invalid");
    if (remote.schemaVersion < local.schemaVersion) {
      return { ...local, health: "fallback", usingFallback: true };
    }
    return { ...remote, usingFallback: false };
  } catch {
    return { ...local, health: "fallback", usingFallback: true };
  }
}
