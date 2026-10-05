/** Source-local regional contract. Legacy snapshots retain their original coverage gate. */
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const between = (v: unknown, min: number, max: number) => finite(v) && v >= min && v <= max;
const date = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0,10) === v;
const clock = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));

export function validateRegionalShape(raw: unknown): boolean {
  try {
    const r = raw as Record<string, any>;
    if (!r || !Array.isArray(r.stateRecords) || !Array.isArray(r.districtRecords) || !r.coverage?.nationalOnly?.includes('OPR')) return false;
    if (r.refreshPolicy !== 'source-local-v1') return r.stateRecords.length >= 15 && r.districtRecords.length >= 100 && r.incomeGroups?.nationalGroups?.length >= 3 && r.incomeGroups?.stateGroups?.length >= 15;
    const keys = ['hiesState','hiesDistrict','incomeGroupState','incomeGroupNational','labour','gdpState','gdpDistrict','cpi','nationalIncome','nationalPoverty','nationalInequality','nationalExpenditure'];
    for (const key of keys) {
      const s = r.sources?.[key];
      if (!s || !['fresh','stale','unavailable'].includes(s.status)) return false;
      if (s.status === 'unavailable') { if (s.retrievedAt !== null || s.observationPeriod !== null) return false; }
      else if (!clock(s.retrievedAt) || !date(s.observationPeriod)) return false;
    }
    if (!Array.isArray(r.incomeGroups?.nationalGroups) || !Array.isArray(r.incomeGroups?.stateGroups)) return false;
    if (r.sources.hiesState.status !== 'unavailable' && r.stateRecords.filter((row: any) => row.incomeMedian != null).length < 15) return false;
    if (r.sources.hiesDistrict.status === 'unavailable' ? r.districtRecords.length !== 0 : r.districtRecords.length < 100) return false;
    if (r.incomeGroups.status === 'unavailable') return r.incomeGroups.nationalGroups.length === 0 && r.incomeGroups.stateGroups.length === 0;
    return r.incomeGroups.nationalGroups.length >= 3 && r.incomeGroups.stateGroups.length >= 15;
  } catch { return false; }
}

export function validateRegionalNumbers(raw: unknown): boolean {
  try {
    const regional = raw as Record<string, any>;
    if (!regional) return true;
    for (const field of ['stateRecords','districtRecords']) {
      const records = regional[field]; if (!Array.isArray(records)) return false;
      const seen = new Set<string>();
      for (const r of records) {
        const key = `${r.state}|${r.district ?? ''}|${r.date ?? ''}`;
        if (typeof r.state !== 'string' || !r.state.trim() || seen.has(key) || (field === 'districtRecords' && (typeof r.district !== 'string' || !r.district.trim()))) return false;
        seen.add(key);
        const absent = field === 'stateRecords' && regional.refreshPolicy === 'source-local-v1' && regional.sources?.hiesState?.status === 'unavailable';
        if (absent) {
          if (!['date','incomeMean','incomeMedian','expenditureMean','incomeMinusExpenditure','incomeToExpenditureRatio','poverty','gini'].every(k => r[k] === null)) return false;
        } else {
          if (!date(r.date) || !['incomeMean','incomeMedian','expenditureMean'].every(k => between(r[k],0,1_000_000)) || !between(r.poverty,0,100) || !between(r.gini,0,1)) return false;
          if (!finite(r.incomeMinusExpenditure) || Math.abs(r.incomeMinusExpenditure - (r.incomeMedian-r.expenditureMean)) > 0.01) return false;
          if (r.expenditureMean === 0 ? r.incomeToExpenditureRatio !== null : !finite(r.incomeToExpenditureRatio) || Math.abs(r.incomeToExpenditureRatio - r.incomeMedian/r.expenditureMean) > 0.001) return false;
        }
        for (const [metric, period] of [['headlineInflation','inflationPeriod'],['unemploymentRate','labourPeriod'],['realGdp','gdpPeriod']]) if (r[metric] != null && (!finite(r[metric]) || !date(r[period]))) return false;
        if (r.realGdp != null && r.realGdp < 0 || r.unemploymentRate != null && !between(r.unemploymentRate,0,100)) return false;
      }
    }
    for (const record of regional.districtGdpRecords ?? []) {
      if (!date(record.date) || typeof record.state !== 'string' || typeof record.district !== 'string' || !between(record.total,0,1_000_000) || !Array.isArray(record.sectors)) return false;
      const ids = new Set<string>();
      for (const s of record.sectors) {
        if (typeof s.id !== 'string' || ids.has(s.id)) return false; ids.add(s.id);
        if (s.value == null || s.share == null) { if (s.value !== null || s.share !== null) return false; }
        else if (!between(s.value,0,record.total+0.01) || !between(s.share,0,100)) return false;
      }
    }
    return true;
  } catch { return false; }
}
