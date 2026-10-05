// Pure, fail-closed numerical checks shared by server validation and regression tests.
import { validateForecastEvaluationIntegrity } from './forecast-evaluation-integrity.ts';
import { validateRegionalNumbers } from './regional-integrity.ts';
type Point = { date: string; value: number };
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const date = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const url = (value: unknown) => typeof value === 'string' && /^https:\/\//.test(value);
const between = (value: unknown, min: number, max: number) => finite(value) && value >= min && value <= max;
const count = (value: unknown, min = 0) => Number.isInteger(value) && (value as number) >= min;
const instant = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)) && /(?:Z|[+-]\d{2}:?\d{2})$/.test(value);

function validVintageLedger(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const ledger = value as Record<string, any>;
  if (ledger.version !== 1 || ledger.requiredSourceCount !== 6 || !count(ledger.freshSourceCount)
      || ledger.freshSourceCount > ledger.requiredSourceCount || !count(ledger.sourceSnapshotCount)
      || ledger.freshSourceCount > ledger.sourceSnapshotCount
      || !count(ledger.revisedSourcePeriodCount) || ledger.revisedSourcePeriodCount > ledger.sourceSnapshotCount
      || !count(ledger.prospectiveForecastCount) || !count(ledger.capturedOutcomeCount)
      || !count(ledger.pendingForecastTargetCount) || ledger.pendingForecastTargetCount > ledger.prospectiveForecastCount * 3
      || typeof ledger.note !== 'string' || !ledger.note.trim()) return false;
  if ((ledger.prospectiveForecastCount > 0 && ledger.sourceSnapshotCount < ledger.requiredSourceCount)
      || (ledger.capturedOutcomeCount > 0 && ledger.prospectiveForecastCount === 0)) return false;
  const expectedStatus = ledger.freshSourceCount === 0 ? 'waiting'
    : ledger.freshSourceCount === ledger.requiredSourceCount ? 'collecting' : 'partial';
  if (ledger.status !== expectedStatus) return false;
  if (ledger.sourceSnapshotCount === 0) {
    return ledger.firstSnapshotAt === null && ledger.lastSnapshotAt === null;
  }
  return instant(ledger.firstSnapshotAt) && instant(ledger.lastSnapshotAt)
    && Date.parse(ledger.firstSnapshotAt) <= Date.parse(ledger.lastSnapshotAt);
}

export function validateDashboardIntegrity(raw: unknown): boolean {
  try {
    if (!raw || typeof raw !== 'object') return false;
    // Schema shape remains guarded by isDashboard; this unit checks cross-field integrity.
    const p = raw as Record<string, any>;
    if (!Number.isFinite(Date.parse(p.generatedAt))) return false;
    const bounds: Record<string, [number, number]> = { headline:[-50,100], core:[-50,100], opr:[0,20], unemployment:[0,100], fx:[0.01,100], mgs:[0,30] };
    for (const [key, [min, max]] of Object.entries(bounds)) {
      const s = p.series?.[key];
      if (!Array.isArray(s?.points) || !s.points.length || !url(s.source_url) || typeof s.unit !== 'string') return false;
      let previous = '';
      for (const point of s.points as Point[]) {
        if (!date(point.date) || point.date <= previous || !between(point.value, min, max) || point.date > p.generatedAt.slice(0,10)) return false;
        previous = point.date;
      }
      if (!date(p.sources?.[key]?.observationPeriod) || !['fresh','stale'].includes(p.sources?.[key]?.status)) return false;
      if (p.sources[key].observationPeriod !== s.points.at(-1).date) return false;
    }
    const last = new Date(`${p.series.headline.points.at(-1).date}T00:00:00Z`);
    if (!Array.isArray(p.forecast?.points) || p.forecast.points.length !== 3) return false;
    for (const [index, point] of p.forecast.points.entries()) {
      const expected = new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth() + index + 1, 1)).toISOString().slice(0,10);
      if (point.date !== expected || !['low95','low80','value','high80','high95'].every(k => finite(point[k]))) return false;
      if (!(point.low95 <= point.low80 && point.low80 <= point.value && point.value <= point.high80 && point.high80 <= point.high95)) return false;
    }
    if (!Array.isArray(p.forecast.models) || p.forecast.models.filter((m: any) => m.selected).length !== 1) return false;
    for (const m of p.forecast.models) {
      if (m.rmse === null || m.mae === null) { if (m.selected || m.eligible !== false) return false; }
      else if (!between(m.rmse,0,100) || !between(m.mae,0,100)) return false;
    }
    if (!validateForecastEvaluationIntegrity(p)) return false;
    if (p.forecast.vintageLedger !== undefined && !validVintageLedger(p.forecast.vintageLedger)) return false;
    if (p.forecast.scenario != null && !['core','fx','opr'].every(key => finite(p.forecast.scenario.coefficients?.[key]) && finite(p.forecast.scenario.baseline?.[key]))) return false;
    if (!validateRegionalNumbers(p.regionalLens)) return false;
    const household = p.householdPressure;
    if (household) {
      if (!Array.isArray(household.components) || household.components.length < 5 || !['fresh','partial'].includes(household.status)) return false;
      const householdScores: number[] = [];
      const levelFor = (score: number) => score >= 70 ? 'high' : score >= 40 ? 'moderate' : 'low';
      for (const item of household.components) {
        if (item.score === null) {
          if (item.level !== 'unavailable' || typeof item.unavailableReason !== 'string' || !item.unavailableReason.trim() || household.status !== 'partial') return false;
        } else {
          if (!between(item.score, 0, 100) || (item.level !== undefined && item.level !== levelFor(item.score))) return false;
          householdScores.push(item.score);
        }
      }
      if (householdScores.length === 0) {
        if (household.overallScore !== null || household.overallLevel !== 'unavailable') return false;
      } else {
        const average = Math.round(householdScores.reduce((sum, score) => sum + score, 0) / householdScores.length * 10) / 10;
        if (!finite(household.overallScore) || Math.abs(average - household.overallScore) > 0.051 || household.overallLevel !== levelFor(average)) return false;
      }
    }
    for (const sector of p.sectorDeepDive?.sectors ?? []) {
      const exportGrowth = p.externalSector?.summary?.exportsYoY;
      const needsExportGrowth = sector.exportLink === 'high';
      if (sector.changeYoY === null || (needsExportGrowth && !finite(exportGrowth))) {
        if (sector.riskLevel !== 'unavailable') return false;
      } else {
        const score = 35 + (needsExportGrowth && exportGrowth < 0 ? 10 : 0) + (sector.changeYoY < 0 ? 10 : 0);
        if (sector.riskLevel !== (score >= 70 ? 'high' : score >= 40 ? 'moderate' : 'low')) return false;
      }
      if (typeof sector.narrative !== 'string' || !sector.narrative.trim()) return false;
    }
    const risk = p.riskHeatmap;
    if (risk) {
      if (!Array.isArray(risk.items) || risk.items.length !== 9 || !['fresh','partial','unavailable'].includes(risk.status)) return false;
      const ids = new Set<string>();
      const available = [];
      const heatLevel = (score: number) => score >= 70 ? 'high' : score >= 40 ? 'moderate' : 'low';
      for (const item of risk.items) {
        if (typeof item.id !== 'string' || !item.id || ids.has(item.id)) return false;
        ids.add(item.id);
        if (item.score === null) {
          if (item.level !== 'unavailable' || item.dataStatus !== 'unavailable' || typeof item.unavailableReason !== 'string' || !item.unavailableReason.trim()) return false;
        } else {
          if (!between(item.score,0,100) || item.level !== heatLevel(item.score) || item.dataStatus === 'unavailable') return false;
          available.push(item.score);
        }
      }
      if (risk.availableCount !== undefined && (!Number.isInteger(risk.availableCount) || risk.availableCount !== available.length)) return false;
      if (risk.totalCount !== undefined && (!Number.isInteger(risk.totalCount) || risk.totalCount !== risk.items.length)) return false;
      if (risk.coverageNote !== undefined && (typeof risk.coverageNote !== 'string' || !risk.coverageNote.trim())) return false;
      if (available.length < risk.items.length && (risk.availableCount === undefined || risk.totalCount === undefined || typeof risk.coverageNote !== 'string' || !risk.coverageNote.trim() || risk.status === 'fresh')) return false;
      if (risk.status === 'fresh' && risk.items.some((item: any) => item.dataStatus !== undefined && item.dataStatus !== 'fresh')) return false;
      if (!available.length) {
        if (risk.overallScore !== null || risk.overallLevel !== 'unavailable' || risk.status !== 'unavailable') return false;
      } else {
        const average = available.reduce((sum, score) => sum + score,0) / available.length;
        if (!finite(risk.overallScore) || Math.abs(average - risk.overallScore) > 0.051 || risk.overallLevel !== heatLevel(risk.overallScore) || risk.status === 'unavailable') return false;
      }
    }
    return true;
  } catch { return false; }
}
