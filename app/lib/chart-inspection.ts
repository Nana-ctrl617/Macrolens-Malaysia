/** Shared chart inspection primitives. Missing values remain missing, never zero. */
export type InspectionPoint = { date: string; label?: string; value: number | null };
export type ChartFrequency = "monthly" | "annual" | "daily" | "policy";

export function isChartInspectionKey(key: string): boolean {
  return ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "Escape"].includes(key);
}

export function nextChartIndex(key: string, current: number | null, length: number): number | null {
  if (length < 1 || key === "Escape") return null;
  const index = Math.max(0, Math.min(length - 1, current == null ? length - 1 : current));
  if (key === "Home") return 0;
  if (key === "End") return length - 1;
  if (key === "ArrowLeft" || key === "ArrowDown") return Math.max(0, index - 1);
  if (key === "ArrowRight" || key === "ArrowUp") return Math.min(length - 1, index + 1);
  return index;
}

export function nearestChartIndex(coordinates: readonly number[], position: number): number | null {
  if (!coordinates.length || !Number.isFinite(position)) return null;
  let nearest: number | null = null;
  let distance = Infinity;
  coordinates.forEach((coordinate, index) => {
    const candidate = Math.abs(coordinate - position);
    if (Number.isFinite(candidate) && candidate < distance) { nearest = index; distance = candidate; }
  });
  return nearest;
}

export function chartSegments(points: readonly InspectionPoint[], frequency: ChartFrequency): number[][] {
  const segments: number[][] = [];
  let segment: number[] = [];
  let previous: Date | null = null;
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    const date = new Date(`${point.date}T00:00:00Z`);
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(point.date) && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === point.date;
    if (point.value == null || !Number.isFinite(point.value) || !validDate) {
      if (segment.length) segments.push(segment);
      segment = []; previous = null; continue;
    }
    if (previous) {
      const months = (date.getUTCFullYear() - previous.getUTCFullYear()) * 12 + date.getUTCMonth() - previous.getUTCMonth();
      const days = (date.getTime() - previous.getTime()) / 86400000;
      const contiguous = frequency === "policy" ? days > 0 : frequency === "annual" ? months === 12 : frequency === "monthly" ? months === 1 : days > 0 && days <= 8;
      if (!contiguous && segment.length) { segments.push(segment); segment = []; }
    }
    segment.push(index); previous = date;
  }
  if (segment.length) segments.push(segment);
  return segments;
}

export function canvasContentWidth(width: number, paddingLeft = 0, paddingRight = 0): number {
  return Math.max(1, width - paddingLeft - paddingRight);
}

export function chartFontSize(bodySize: number): number {
  return Math.max(14, (Number.isFinite(bodySize) ? bodySize : 16) * 0.875);
}

export function sectorShareObservations(
  years: readonly { year: number; sectors: readonly { id: string; share: number }[] }[], sectorId: string,
): InspectionPoint[] {
  return years.map((year) => {
    const share = year.sectors.find((sector) => sector.id === sectorId)?.share;
    return { date: `${year.year}-01-01`, label: String(year.year), value: share != null && Number.isFinite(share) ? share : null };
  });
}
