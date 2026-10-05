export type PressureScoreInput = { id: string; score: unknown; level?: string; dataStatus?: string };

export function isAvailablePressureScore<T extends { score: unknown; level?: string; dataStatus?: string }>(item: T): item is T & { score: number } {
  return typeof item.score === "number" && Number.isFinite(item.score) && item.score >= 0 && item.score <= 100
    && item.level !== "unavailable" && item.dataStatus !== "unavailable";
}

/** Missing scores must be explicit; malformed values are never coerced or clipped. */
export function pressureSummary(items: readonly PressureScoreInput[]) {
  let sum = 0, availableCount = 0;
  const ids = new Set<string>();
  for (const item of items) {
    if (typeof item.id !== "string" || !item.id || ids.has(item.id)) return { valid: false, availableCount: 0, totalCount: items.length, score: null };
    ids.add(item.id);
    if (item.score === null && (item.level === "unavailable" || item.dataStatus === "unavailable")) continue;
    if (!isAvailablePressureScore(item)) return { valid: false, availableCount: 0, totalCount: items.length, score: null };
    sum += item.score; availableCount += 1;
  }
  return { valid: true, availableCount, totalCount: items.length, score: availableCount ? sum / availableCount : null };
}

/** Exploratory weighting of available published scores, not a replacement for the screen. */
export function weightedPressure(items: readonly PressureScoreInput[], selectedId: string, multiplier: number) {
  if (typeof multiplier !== "number" || !Number.isFinite(multiplier) || multiplier < 0 || !pressureSummary(items).valid) return null;
  let sum = 0, weight = 0;
  for (const item of items) {
    if (!isAvailablePressureScore(item)) continue;
    const w = item.id === selectedId ? multiplier : 1;
    if (!Number.isFinite(w) || w < 0) return null;
    sum += w * item.score; weight += w;
  }
  return weight > 0 ? sum / weight : null;
}
