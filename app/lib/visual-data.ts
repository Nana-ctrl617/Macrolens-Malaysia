import type { DataPoint } from "./dashboard";

export type ObservationRange = "1Y" | "3Y" | "All";
export type PointPreparation = { points: DataPoint[]; rejected: number; duplicateRows: number; conflictingDates: number };
export type NumericDomain = { min: number; max: number; ticks: number[] };

/** Strict UTC date parsing avoids browser locale shifts and impossible dates. */
export function pointEpoch(date: unknown): number | null {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const value = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(value) && new Date(value).toISOString().slice(0, 10) === date ? value : null;
}

/** Never coerce missing/string values to zero or choose between conflicting observations. */
export function prepareSeriesPoints(raw: readonly DataPoint[] | null | undefined): PointPreparation {
  const byDate = new Map<string, number>();
  const conflicts = new Set<string>();
  let rejected = 0;
  let duplicateRows = 0;
  for (const point of Array.isArray(raw) ? raw : []) {
    if (!point || pointEpoch(point.date) === null || typeof point.value !== "number" || !Number.isFinite(point.value)) {
      rejected += 1;
      continue;
    }
    if (byDate.has(point.date)) {
      duplicateRows += 1;
      if (byDate.get(point.date) !== point.value) conflicts.add(point.date);
    } else {
      byDate.set(point.date, point.value);
    }
  }
  const points = [...byDate]
    .filter(([date]) => !conflicts.has(date))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({ date, value }));
  return { points, rejected, duplicateRows, conflictingDates: conflicts.size };
}

export function observationWindow(points: readonly DataPoint[], range: ObservationRange): DataPoint[] {
  if (!points.length || range === "All") return points.map((point) => ({ ...point }));
  const lastEpoch = pointEpoch(points[points.length - 1].date);
  if (lastEpoch === null) return [];
  const last = new Date(lastEpoch);
  const years = range === "3Y" ? 3 : 1;
  const year = last.getUTCFullYear() - years;
  // A leap-day anniversary becomes the final valid day of February.
  const lastDay = new Date(Date.UTC(year, last.getUTCMonth() + 1, 0)).getUTCDate();
  const start = Date.UTC(year, last.getUTCMonth(), Math.min(last.getUTCDate(), lastDay));
  return points.filter((point) => (pointEpoch(point.date) ?? -Infinity) >= start).map((point) => ({ ...point }));
}

export function seriesCadence(frequency: string): "monthly" | "daily" | "quarterly" | "annual" | "policy" | "other" {
  const label = frequency.toLowerCase();
  if (label.includes("policy") || label.includes("decision")) return "policy";
  if (label.includes("month")) return "monthly";
  if (label.includes("quarter")) return "quarterly";
  if (label.includes("annual") || label.includes("year")) return "annual";
  if (label.includes("daily") || label.includes("trading") || label.includes("day")) return "daily";
  return "other";
}

export function segmentSeries(points: readonly DataPoint[], frequency: string): DataPoint[][] {
  const cadence = seriesCadence(frequency);
  const segments: DataPoint[][] = [];
  for (const point of points) {
    const segment = segments[segments.length - 1];
    const previous = segment?.[segment.length - 1];
    let gap = false;
    if (previous) {
      const before = new Date(pointEpoch(previous.date)!);
      const after = new Date(pointEpoch(point.date)!);
      const months = (after.getUTCFullYear() - before.getUTCFullYear()) * 12 + after.getUTCMonth() - before.getUTCMonth();
      gap = cadence === "monthly" ? months > 1
        : cadence === "quarterly" ? months > 3
          : cadence === "annual" ? months > 12
            // Weekends and short market holidays remain valid trading-day gaps.
            : cadence === "daily" ? (after.getTime() - before.getTime()) / 86_400_000 > 7 : false;
    }
    if (!segment || gap) segments.push([{ ...point }]);
    else segment.push({ ...point });
  }
  return segments;
}

export function numericDomain(values: readonly number[], includeZero = false): NumericDomain | null {
  const valid = values.filter(Number.isFinite);
  if (!valid.length) return null;
  let min = Math.min(...valid);
  let max = Math.max(...valid);
  if (includeZero) { min = Math.min(0, min); max = Math.max(0, max); }
  const padding = max === min ? Math.max(Math.abs(max) * 0.08, 0.1) : (max - min) * 0.08;
  min -= padding;
  max += padding;
  const roughStep = (max - min) / 4;
  const power = 10 ** Math.floor(Math.log10(roughStep));
  const fraction = roughStep / power;
  const step = (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * power;
  min = Math.floor(min / step) * step;
  max = Math.ceil(max / step) * step;
  const ticks = [];
  for (let index = 0; index <= 10; index += 1) {
    const tick = min + index * step;
    if (tick > max + step / 100) break;
    ticks.push(Number(tick.toPrecision(12)));
  }
  return { min, max, ticks };
}

export function linearScale(value: number, fromMin: number, fromMax: number, toMin: number, toMax: number): number {
  if (fromMax === fromMin) return (toMin + toMax) / 2;
  return toMin + (value - fromMin) / (fromMax - fromMin) * (toMax - toMin);
}

export function buildTrendPath(
  points: readonly DataPoint[],
  frequency: string,
  x: (epoch: number) => number,
  y: (value: number) => number,
): string {
  const step = seriesCadence(frequency) === "policy";
  return segmentSeries(points, frequency).map((segment) => segment.map((point, index) => {
    const px = x(pointEpoch(point.date)!);
    const py = y(point.value);
    if (!index) return `M ${px.toFixed(2)} ${py.toFixed(2)}`;
    return step ? `H ${px.toFixed(2)} V ${py.toFixed(2)}` : `L ${px.toFixed(2)} ${py.toFixed(2)}`;
  }).join(" ")).join(" ");
}

export function nearestPointIndex(points: readonly DataPoint[], target: number): number {
  if (!points.length) return -1;
  let low = 0;
  let high = points.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (pointEpoch(points[middle].date)! < target) low = middle + 1;
    else high = middle;
  }
  if (low === 0) return 0;
  return Math.abs(pointEpoch(points[low].date)! - target) < Math.abs(pointEpoch(points[low - 1].date)! - target) ? low : low - 1;
}

export function trendChange(points: readonly DataPoint[]): { first: DataPoint; last: DataPoint; absolute: number } | null {
  if (!points.length) return null;
  const first = { ...points[0] };
  const last = { ...points[points.length - 1] };
  return { first, last, absolute: last.value - first.value };
}

export function safeDecimals(decimals: number): number {
  return Number.isInteger(decimals) ? Math.min(8, Math.max(0, decimals)) : 2;
}

export function formatMetricValue(value: number, unit: string, decimals: number): string {
  const digits = safeDecimals(decimals);
  const text = value.toLocaleString("en-MY", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return unit === "RM" ? `RM ${text}` : unit === "%" ? `${text}%` : `${text}${unit ? ` ${unit}` : ""}`;
}

export function formatMetricChange(value: number, unit: string, decimals: number): string {
  const digits = safeDecimals(decimals);
  const rounded = Math.abs(value) < 0.5 * 10 ** -digits ? 0 : value;
  const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "";
  const number = Math.abs(rounded).toLocaleString("en-MY", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return unit === "%" ? `${sign}${number} percentage points` : unit === "RM" ? `${sign}RM ${number}` : `${sign}${number}${unit ? ` ${unit}` : ""}`;
}

export function formatObservationDate(date: string, frequency: string, exact = false): string {
  const epoch = pointEpoch(date);
  if (epoch === null) return "Date not available";
  const cadence = seriesCadence(frequency);
  return new Intl.DateTimeFormat("en-MY", {
    year: "numeric", month: "short", timeZone: "UTC",
    ...(exact || cadence === "daily" || cadence === "policy" || cadence === "other" ? { day: "numeric" } : {}),
  }).format(new Date(epoch));
}

/** Signed bars share an auditable zero anchor; sign does not imply good/bad. */
export function signedBarLayout(values: readonly number[]): { zero: number; bars: Array<{ start: number; width: number; value: number }> } | null {
  if (!values.length || values.some((value) => !Number.isFinite(value))) return null;
  let min = Math.min(0, ...values);
  let max = Math.max(0, ...values);
  if (min === max) { min = -1; max = 1; }
  const zero = linearScale(0, min, max, 0, 100);
  return { zero, bars: values.map((value) => {
    const end = linearScale(value, min, max, 0, 100);
    return { start: Math.min(zero, end), width: Math.abs(end - zero), value };
  }) };
}
