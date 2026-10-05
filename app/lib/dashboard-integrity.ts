// Pure, fail-closed numerical checks shared by server validation and regression tests.
import { validateForecastEvaluationIntegrity } from './forecast-evaluation-integrity.ts';
type Point = { date: string; value: number };
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const date = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const url = (value: unknown) => typeof value === 'string' && /^https:\/\//.test(value);
const between = (value: unknown, min: number, max: number) => finite(value) && value >= min && value <= max;

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
    if (p.forecast.scenario != null && !['core','fx','opr'].every(key => finite(p.forecast.scenario.coefficients?.[key]) && finite(p.forecast.scenario.baseline?.[key]))) return false;
    for (const field of ['stateRecords','districtRecords']) {
      const records = p.regionalLens?.[field];
      if (!records) continue;
      if (!Array.isArray(records)) return false;
      const seen = new Set<string>();
      for (const r of records) {
        const key = `${r.state}|${r.district ?? ''}|${r.date}`;
        if (typeof r.state !== 'string' || !date(r.date) || seen.has(key)) return false;
        seen.add(key);
        if (!['incomeMean','incomeMedian','expenditureMean'].every(k => between(r[k],0,1_000_000)) || !between(r.poverty,0,100) || !between(r.gini,0,1)) return false;
        for (const [k, period] of [['headlineInflation','inflationPeriod'],['unemploymentRate','labourPeriod'],['realGdp','gdpPeriod']]) {
          if (r[k] != null && (!finite(r[k]) || !date(r[period]))) return false;
        }
        if (r.realGdp != null && r.realGdp < 0) return false;
        if (r.unemploymentRate != null && !between(r.unemploymentRate,0,100)) return false;
      }
    }
    for (const record of p.regionalLens?.districtGdpRecords ?? []) {
      if (!date(record.date) || typeof record.state !== 'string' || typeof record.district !== 'string' || !between(record.total,0,1_000_000) || !Array.isArray(record.sectors)) return false;
      const sectorIds = new Set<string>();
      for (const sector of record.sectors) {
        if (typeof sector.id !== 'string' || sectorIds.has(sector.id)) return false;
        sectorIds.add(sector.id);
        if (sector.value == null || sector.share == null) {
          if (sector.value !== null || sector.share !== null) return false;
        } else if (!between(sector.value,0,record.total+0.01) || !between(sector.share,0,100)) return false;
      }
    }
    const risk = p.riskHeatmap;
    if (risk) {
      if (!Array.isArray(risk.items) || !risk.items.length || !risk.items.every((r: any) => between(r.score,0,100))) return false;
      const average = risk.items.reduce((sum: number, r: any) => sum + r.score,0) / risk.items.length;
      if (!finite(risk.overallScore) || Math.abs(average - risk.overallScore) > 0.051) return false;
    }
    return true;
  } catch { return false; }
}
