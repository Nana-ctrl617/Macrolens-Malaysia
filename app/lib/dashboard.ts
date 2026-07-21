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
export type BriefData = {
  generatedAt: string; status: "fresh" | "partial"; period: string; headline: string;
  whatChanged: string[]; whyItMayHaveHappened: string[]; watchNext: string[]; implications: string[];
  disclaimer: string;
};
export type RiskItem = {
  id: string; label: string; group: string; score: number; level: "low" | "moderate" | "high";
  evidence: string; rule: string; period: string; watch: string;
};
export type RiskHeatmap = {
  generatedAt: string; status: "fresh" | "partial"; overallScore: number; overallLevel: "low" | "moderate" | "high";
  summary: string; method: string; items: RiskItem[];
};
export type EconomicSector = {
  id: string; name: string; value: number; share: number; rank: number;
  changeValue: number | null; changeYoY: number | null; growthContribution: number | null;
};
export type EconomicStructureYear = {
  year: number; total: number; sectors: EconomicSector[]; narrative: string;
  summary: {
    largestSector: string; largestShare: number; fastestGrowingSector: string;
    fastestGrowth: number | null; largestGrowthContributor: string; largestContributionValue: number | null;
  };
};
export type EconomicStructure = {
  status: "fresh" | "stale"; retrievedAt: string; observationPeriod: string;
  source: string; sourceUrl: string; datasetUrl: string; frequency: string;
  measure: string; unit: string; latestYear: number; years: EconomicStructureYear[];
  note: string; message: string;
};
export type DemandComponent = {
  id: string; name: string; value: number; share: number; gdpSign: number; signedValue: number;
  changeValue: number | null; changeYoY: number | null; signedContribution: number | null;
};
export type DemandYear = {
  year: number; total: number; components: DemandComponent[]; narrative: string;
  summary: { largestComponent: string; largestShare: number; largestGrowthDriver: string; largestContribution: number | null; demandType: string };
};
export type DemandStructure = {
  status: "fresh" | "stale" | "unavailable"; retrievedAt: string; observationPeriod: string;
  source: string; sourceUrl: string; datasetUrl: string; frequency: string; measure: string; unit: string;
  latestYear: number | null; years: DemandYear[]; note: string; message: string;
};
export type GrowthDrivers = {
  status: "fresh" | "partial"; generatedAt: string; production: EconomicStructure; demand: DemandStructure; summary: string; message: string;
};
export type TradePoint = { date: string; exports: number; imports: number; total: number; balance: number };
export type ExternalSector = {
  status: "fresh" | "stale"; retrievedAt: string; observationPeriod: string; source: string; sourceUrl: string; datasetUrl: string;
  frequency: string; unit: string; points: TradePoint[];
  summary: { latestDate: string; exports: number; imports: number; total: number; balance: number; exportsYoY: number | null; importsYoY: number | null; last12Balance: number; prior12Balance: number | null; tradeReading: string };
  narratives: { performance: string; macro: string }; message: string;
};
export type DashboardPayload = {
  schemaVersion: number;
  generatedAt: string;
  health: "fresh" | "partial" | "fallback";
  usingFallback?: boolean;
  sources: Record<string, { status: "fresh" | "stale"; retrievedAt: string; observationPeriod: string; message: string }>;
  series: Record<string, SeriesData>;
  categories: Array<{ code: string; name: string; value: number; weight?: number; contribution?: number }>;
  cpiDecomposition?: {
    observationPeriod: string; weightReferenceYear: number; effectiveFrom: string; source: string; sourceUrl: string;
    headline: number; estimatedTotal: number; reconciliationGap: number; method: string; warning: string;
  };
  forecast: {
    selectedModel: string;
    methodLabel: string;
    backtestWindows: number;
    status: string;
    models: Array<{ name: string; rmse: number; mae: number; selected: boolean }>;
    points: Array<{ date: string; value: number; low80: number; high80: number; low95: number; high95: number }>;
    scenario?: { model: string; lag: string; baseline: Record<"core" | "fx" | "opr", number>; coefficients: Record<"core" | "fx" | "opr", number>; warning: string } | null;
  };
  narratives: { snapshot: string; forecast: string; financial: string };
  structuralBreaks?: StructuralBreaks;
  market?: MarketData;
  decisionGuide?: DecisionGuide;
  economicStructure?: EconomicStructure;
  latestBrief?: BriefData;
  riskHeatmap?: RiskHeatmap;
  growthDrivers?: GrowthDrivers;
  externalSector?: ExternalSector;
  dataOperations?: {
    schedule: string; lastSuccessfulRefresh: string; vintageCount: number; latestVintagePeriod: string; vintagePolicy: string;
    releaseLog: Array<{ period: string; headline: number; core: number | null }>;
  };
};

const DEFAULT_URL = "https://raw.githubusercontent.com/Nana-ctrl617/macrolens-malaysia/main/data/published/dashboard.json";

export function isDashboard(value: unknown): value is DashboardPayload {
  if (!value || typeof value !== "object") return false;
  const candidate = value as DashboardPayload;
  const required = ["headline", "core", "opr", "unemployment", "fx", "mgs"];
  const structuralValid = candidate.schemaVersion === 1 || (
    (candidate.schemaVersion === 2 || candidate.schemaVersion === 3 || candidate.schemaVersion === 4 || candidate.schemaVersion === 5 || candidate.schemaVersion === 6)
    && !!candidate.structuralBreaks
    && required.every((key) => candidate.structuralBreaks?.indicators?.[key]?.indicatorId === key)
  );
  const marketValid = candidate.schemaVersion < 3 || (
    candidate.market?.benchmark?.id === "fbmklci"
    && Array.isArray(candidate.market.benchmark.points)
    && candidate.market.benchmark.points.length >= 250
    && typeof candidate.market.summary?.latest === "number"
  );
  const decisionValid = candidate.schemaVersion < 4 || (
    (candidate.decisionGuide?.audiences?.individuals?.length ?? 0) >= (candidate.schemaVersion >= 7 ? 6 : 4)
    && (candidate.decisionGuide?.audiences?.companies?.length ?? 0) >= (candidate.schemaVersion >= 7 ? 6 : 4)
    && candidate.decisionGuide?.signals?.length >= 6
  );
  const structureValid = candidate.schemaVersion < 5 || (
    (candidate.economicStructure?.years?.length ?? 0) >= 5
    && !!candidate.economicStructure?.years.every((year) => year.sectors.length === 6)
    && typeof candidate.economicStructure?.latestYear === "number"
  );
  const researchValid = candidate.schemaVersion < 6 || (
    candidate.categories?.length === 13
    && candidate.categories.every((item) => typeof item.weight === "number" && typeof item.contribution === "number")
    && candidate.cpiDecomposition?.weightReferenceYear === 2022
    && typeof candidate.forecast?.scenario?.coefficients?.fx === "number"
    && (candidate.dataOperations?.releaseLog?.length ?? 0) > 0
  );
  const completionValid = candidate.schemaVersion < 7 || (
    (candidate.latestBrief?.whatChanged?.length ?? 0) >= 3
    && (candidate.riskHeatmap?.items?.length ?? 0) >= 9
    && (candidate.growthDrivers?.demand?.years?.length ?? 0) >= 5
    && (candidate.externalSector?.points?.length ?? 0) >= 60
  );
  return (candidate.schemaVersion === 1 || candidate.schemaVersion === 2 || candidate.schemaVersion === 3 || candidate.schemaVersion === 4 || candidate.schemaVersion === 5 || candidate.schemaVersion === 6 || candidate.schemaVersion === 7)
    && structuralValid
    && marketValid
    && decisionValid
    && structureValid
    && researchValid
    && completionValid
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
