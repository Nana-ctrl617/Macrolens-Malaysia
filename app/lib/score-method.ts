/** Exploratory weighting of published scores, never a replacement for the published screen. */
export function weightedPressure(items: Array<{id:string; score:number}>, selectedId: string, multiplier: number) {
  let sum = 0, weight = 0;
  for (const item of items) {
    if (!Number.isFinite(item.score) || item.score < 0 || item.score > 100) return null;
    const w = item.id === selectedId ? multiplier : 1;
    if (!Number.isFinite(w) || w < 0) return null;
    sum += w * item.score; weight += w;
  }
  return weight > 0 ? sum / weight : null;
}
