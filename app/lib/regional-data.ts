import type { RegionalLens, RegionalSourceMetadata } from "./dashboard";
import { normalizeRegionalGeography } from "./regional-geography";

export type RegionalLevel = "state" | "district";
export type RegionalComparison = { level: RegionalLevel; primary: string; secondary: string; metric: RegionalMetric; view: "chart" | "table" };
export const regionalMetrics = {
  incomeMedian: { label: "Median household income", unit: "RM per household per month", description: "The middle monthly household income: half of households earn more and half less.", cadence: "annual" },
  incomeMean: { label: "Mean household income", unit: "RM per household per month", description: "Average monthly household income; very high incomes can pull the average upward.", cadence: "annual" },
  expenditureMean: { label: "Mean household expenditure", unit: "RM per household per month", description: "Average monthly household spending. This aggregate is not a household budget.", cadence: "annual" },
  incomeMinusExpenditure: { label: "Income minus expenditure", unit: "RM per household per month", description: "Median income minus mean expenditure: an aggregate contrast, not matched household savings.", cadence: "annual" },
  incomeToExpenditureRatio: { label: "Income-to-expenditure ratio", unit: "ratio", description: "Median income divided by mean expenditure: an aggregate contrast, not an individual affordability measure.", cadence: "annual" },
  poverty: { label: "Absolute poverty rate", unit: "%", description: "Share of households below DOSM’s poverty line income.", cadence: "annual" },
  gini: { label: "Gini coefficient", unit: "coefficient", description: "Income inequality on a 0–1 scale. Higher values indicate greater inequality.", cadence: "annual" },
  headlineInflation: { label: "Headline inflation", unit: "%", description: "State-level year-on-year CPI inflation. No official district CPI is supplied.", cadence: "monthly" },
  unemploymentRate: { label: "Unemployment rate", unit: "%", description: "Official district unemployment; state rates are labour-force-weighted aggregates of the supplied districts.", cadence: "annual" },
  realGdp: { label: "Real GDP", unit: "RM billion (constant 2015 prices)", description: "Annual economic output at constant 2015 prices. State and district reference years can differ.", cadence: "annual" },
} as const;
export type RegionalMetric = keyof typeof regionalMetrics;
export type RegionalObservation = {
  value: number | string | null; unit: string; observationPeriod: string | null;
  sourceUrl: string; sourceLabel: string; dataStatus: string; retrievedAt: string | null;
  cadence: "annual" | "monthly";
};
export type RegionalRecord = {
  key: string; level: RegionalLevel; state: string; district: string; label: string;
  geographyKind?: "district" | "residual";
  metrics: Record<string, RegionalObservation>;
  sectorShares: Array<{ id: string; name: string; value: number | null; share: number | null }>;
};
export type RegionalExportRow = {
  level: string; state: string; district: string; metric: string; value: number | string;
  unit: string; observation_period: string; source_url: string; data_status: string; retrieved_at: string;
};

const hiesMetrics = ["incomeMean", "incomeMedian", "expenditureMean", "incomeMinusExpenditure", "incomeToExpenditureRatio", "poverty", "gini"] as const;
const numeric = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value : null;
export const regionalKey = (state: string, district?: string) => district ? normalizeRegionalGeography(state, district).key : state;

export function regionalGdpSource(regional: RegionalLens, level: RegionalLevel): RegionalSourceMetadata | undefined {
  const sources = regional.sources ?? {};
  const independent = level === "state" ? sources.gdpState ?? sources.gdp?.stateSource : sources.gdpDistrict ?? sources.gdp?.districtSource;
  if (independent) return level === "state" ? independent : { ...independent, districtSourceUrl: independent.sourceUrl, districtDatasetUrl: independent.datasetUrl };
  return sources.gdp;
}

function observation(value: unknown, unit: string, period: string | null | undefined, source: RegionalSourceMetadata | undefined, sourceLabel: string, cadence: "annual" | "monthly" = "annual", districtGdp = false): RegionalObservation {
  const validated = unit === "sector" || unit === "percentiles" ? text(value) : numeric(value);
  return {
    value: validated, unit, observationPeriod: text(period), sourceLabel, cadence,
    sourceUrl: districtGdp ? source?.districtSourceUrl ?? source?.districtDatasetUrl ?? "" : source?.sourceUrl ?? source?.datasetUrl ?? "",
    dataStatus: validated == null ? "unavailable" : source?.status ?? "unknown",
    retrievedAt: text(source?.retrievedAt),
  };
}

/** Canonical aliases join within a state; ambiguous duplicates never pick an arbitrary winner. */
function indexDistrictRecords<T extends { state: string; district: string }>(records: readonly T[]): Map<string, T> {
  const index = new Map<string, T>();
  const ambiguous = new Set<string>();
  for (const record of records) {
    const key = regionalKey(record.state, record.district);
    if (ambiguous.has(key)) continue;
    if (index.has(key)) { index.delete(key); ambiguous.add(key); }
    else index.set(key, record);
  }
  return index;
}

/** District joins use confirmed state-scoped aliases, preserving all source values and dates. */
export function buildRegionalRecords(regional: RegionalLens | null | undefined, level: RegionalLevel, options: { includeResidual?: boolean } = {}): RegionalRecord[] {
  if (!regional) return [];
  const sources = regional.sources ?? {};
  const stateGdp = regionalGdpSource(regional, "state"), districtGdp = regionalGdpSource(regional, "district");
  if (level === "state") return regional.stateRecords.map((state) => {
    const metrics: Record<string, RegionalObservation> = {};
    for (const metric of hiesMetrics) metrics[metric] = observation(state[metric], regionalMetrics[metric].unit, state.date, sources.hiesState, "DOSM state HIES");
    metrics.headlineInflation = observation(state.headlineInflation, "%", state.inflationPeriod ?? sources.cpi?.observationPeriod, sources.cpi, "DOSM state CPI", "monthly");
    metrics.unemploymentRate = observation(state.unemploymentRate, "%", state.labourPeriod ?? sources.labour?.observationPeriod, sources.labour, "DOSM district labour force, aggregated to state");
    const period = state.gdpPeriod ?? stateGdp?.observationPeriod;
    metrics.realGdp = observation(state.realGdp, regionalMetrics.realGdp.unit, period, stateGdp, "DOSM state real GDP");
    metrics.largestSector = observation(state.largestSector, "sector", period, stateGdp, "DOSM state real GDP");
    metrics.largestSectorShare = observation(state.largestSectorShare, "%", period, stateGdp, "DOSM state real GDP");
    const record: RegionalRecord = { key: state.state, level, state: state.state, district: "", label: state.state, metrics, sectorShares: state.sectorShares ?? [] };
    addSectorMetrics(record, stateGdp, period, false);
    return record;
  }).sort((a, b) => a.label.localeCompare(b.label));

  const hies = indexDistrictRecords(regional.districtRecords);
  const labour = indexDistrictRecords(regional.districtLabourRecords ?? []);
  const gdp = indexDistrictRecords(regional.districtGdpRecords ?? []);
  const geographies = new Map([...regional.districtRecords, ...(regional.districtLabourRecords ?? []), ...(regional.districtGdpRecords ?? [])].map((record) => {
    const geography = normalizeRegionalGeography(record.state, record.district);
    return [geography.key, geography] as const;
  }));
  return [...geographies].filter(([, geography]) => options.includeResidual || geography.kind === "district").map(([key, geography]) => {
    const survey = hies.get(key), jobs = labour.get(key), output = gdp.get(key);
    const metrics: Record<string, RegionalObservation> = {};
    for (const metric of hiesMetrics) metrics[metric] = observation(survey?.[metric], regionalMetrics[metric].unit, survey?.date, sources.hiesDistrict, "DOSM district HIES");
    // CPI is state-only. Its state value and period deliberately never enter a district row.
    metrics.headlineInflation = observation(null, "%", null, undefined, "No official district CPI supplied", "monthly");
    for (const metric of ["unemploymentRate", "participationRate", "employmentPopulationRatio"] as const) metrics[metric] = observation(jobs?.[metric], "%", jobs?.date, sources.labour, "DOSM district labour force");
    metrics.labourForce = observation(jobs?.labourForce, "thousand persons", jobs?.date, sources.labour, "DOSM district labour force");
    metrics.realGdp = observation(output?.total, regionalMetrics.realGdp.unit, output?.date, districtGdp, "DOSM district real GDP", "annual", true);
    metrics.largestSector = observation(output?.largestSector, "sector", output?.date, districtGdp, "DOSM district real GDP", "annual", true);
    metrics.largestSectorShare = observation(output?.largestSectorShare, "%", output?.date, districtGdp, "DOSM district real GDP", "annual", true);
    const record: RegionalRecord = { key, level, state: geography.state, district: geography.district, geographyKind: geography.kind, label: `${geography.district}, ${geography.state}`, metrics, sectorShares: output?.sectors ?? [] };
    addSectorMetrics(record, districtGdp, output?.date, true);
    return record;
  }).sort((a, b) => a.state.localeCompare(b.state) || a.district.localeCompare(b.district));
}

function addSectorMetrics(record: RegionalRecord, source: RegionalSourceMetadata | undefined, period: string | null | undefined, district: boolean) {
  for (const sector of record.sectorShares) {
    record.metrics[`sector.${sector.id}.value`] = observation(sector.value, regionalMetrics.realGdp.unit, period, source, district ? "DOSM district real GDP" : "DOSM state real GDP", "annual", district);
    record.metrics[`sector.${sector.id}.share`] = observation(sector.share, "%", period, source, district ? "DOSM district real GDP" : "DOSM state real GDP", "annual", district);
  }
}

export function formatRegionalPeriod(period: string | null | undefined, cadence: "annual" | "monthly"): string {
  if (!period || !/^\d{4}(?:-\d{2}-\d{2})?$/.test(period)) return "not recorded";
  const iso = period.length === 4 ? `${period}-01-01` : period;
  const date = new Date(`${iso}T00:00:00Z`);
  if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== iso) return "not recorded";
  return cadence === "annual" ? period.slice(0, 4) : date.toLocaleDateString("en-MY", { month: "short", year: "numeric", timeZone: "UTC" });
}

export function formatRegionalValue(value: number | string | null | undefined, unit: string): string {
  if (typeof value === "string") return value;
  if (value == null || !Number.isFinite(value)) return "Unavailable";
  if (unit.startsWith("RM per")) return `RM ${value.toLocaleString("en-MY", { maximumFractionDigits: 0 })}`;
  if (unit.startsWith("RM billion")) return `RM ${value.toLocaleString("en-MY", { maximumFractionDigits: 2 })}b`;
  if (unit === "%") return `${value.toFixed(1)}%`;
  if (unit === "ratio") return `${value.toFixed(2)}×`;
  if (unit === "coefficient") return value.toFixed(3);
  return value.toLocaleString("en-MY", { maximumFractionDigits: 2 });
}

export function regionalExportRows(regional: RegionalLens): RegionalExportRow[] {
  const rows: RegionalExportRow[] = [];
  const add = (level: string, state: string, district: string, metric: string, item: RegionalObservation) => {
    if (item.value == null) return;
    rows.push({ level, state, district, metric, value: item.value, unit: item.unit, observation_period: item.observationPeriod ?? "", source_url: item.sourceUrl, data_status: item.dataStatus, retrieved_at: item.retrievedAt ?? "" });
  };
  // Cleaned CSV uses canonical district identity; raw JSON retains publisher spelling.
  // Unattributed GDP remains available for audit under a separate, non-district level.
  for (const level of ["state", "district"] as const) for (const record of buildRegionalRecords(regional, level, { includeResidual: true })) for (const [metric, item] of Object.entries(record.metrics)) add(record.geographyKind === "residual" ? "district_residual" : level, record.state, record.district, metric, item);
  const groups = regional.incomeGroups;
  if (groups) {
    const groupSource: RegionalSourceMetadata = { ...groups, datasetUrl: groups.stateDatasetUrl };
    const nationalSource: RegionalSourceMetadata = { ...groups, sourceUrl: groups.nationalDatasetUrl };
    const addGroups = (level: string, state: string, period: string | null, records: typeof groups.nationalGroups, source: RegionalSourceMetadata) => {
      for (const group of records) for (const field of ["meanIncome", "medianIncome", "minIncome", "maxIncome", "vsNationalMean", "percentileRange"] as const) add(level, state, "", `incomeGroup.${group.id}.${field}`, observation(group[field], field === "percentileRange" ? "percentiles" : "RM per household per month", period, source, "DOSM HIES income percentiles"));
    };
    for (const state of groups.stateGroups) addGroups("state_income_group", state.state, state.date, state.groups, groupSource);
    addGroups("national_income_group", "Malaysia", groups.observationPeriod, groups.nationalGroups, nationalSource);
  }
  return rows;
}

export const regionalCsvColumns = ["level", "state", "district", "metric", "value", "unit", "observation_period", "source_url", "data_status", "retrieved_at"] as const;
/** RFC-compatible cells and text-only spreadsheet formula protection; negative numbers remain numeric. */
export function escapeRegionalCsv(value: unknown): string {
  let cell = value == null ? "" : String(value);
  if (typeof value === "string" && /^[\s]*[=+\-@]/.test(cell)) cell = `'${cell}`;
  return /[",\r\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;
}
export function regionalCsv(regional: RegionalLens): string {
  return [regionalCsvColumns.join(","), ...regionalExportRows(regional).map((row) => regionalCsvColumns.map((column) => escapeRegionalCsv(row[column])).join(","))].join("\n") + "\n";
}

export function parseRegionalComparison(query: string): Partial<RegionalComparison> {
  const params = new URLSearchParams(query);
  return { level: params.get("regionalLevel") as RegionalLevel, primary: params.get("regionalPrimary") ?? undefined, secondary: params.get("regionalSecondary") ?? undefined, metric: params.get("regionalMetric") as RegionalMetric, view: params.get("regionalView") as "chart" | "table" };
}
export function resolveRegionalComparison(regional: RegionalLens | null | undefined, input: Partial<RegionalComparison> = {}): RegionalComparison {
  const level = input.level === "district" ? "district" : "state";
  const records = buildRegionalRecords(regional, level);
  const comparisonKey = (value: string | undefined) => {
    if (level !== "district" || !value?.includes("|")) return value;
    const [state, ...district] = value.split("|");
    return normalizeRegionalGeography(state, district.join("|")).key;
  };
  const primary = records.find((record) => record.key === comparisonKey(input.primary)) ?? records.find((record) => record.state === (input.primary?.split("|")[0] ?? regional?.defaultComparison.primary)) ?? records[0];
  const secondary = records.find((record) => record.key === comparisonKey(input.secondary)) ?? records.find((record) => record.state === (input.secondary?.split("|")[0] ?? regional?.defaultComparison.secondary) && record.key !== primary?.key) ?? records.find((record) => record.key !== primary?.key) ?? primary;
  return { level, primary: primary?.key ?? "", secondary: secondary?.key ?? "", metric: input.metric && Object.hasOwn(regionalMetrics, input.metric) ? input.metric : "incomeMedian", view: input.view === "table" ? "table" : "chart" };
}
export function regionalComparisonQuery(comparison: RegionalComparison): string {
  return `?${new URLSearchParams({ regionalLevel: comparison.level, regionalPrimary: comparison.primary, regionalSecondary: comparison.secondary, regionalMetric: comparison.metric, regionalView: comparison.view })}`;
}
