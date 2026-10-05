// Optional audit checks: absence preserves legacy payloads; presence fails closed.
type Row = Record<string, any>;
type AuditPoint = { horizon: number; actual: number; predicted: number; covered80: boolean; covered95: boolean };
const object = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const integer = (value: unknown): value is number => finite(value) && Number.isInteger(value) && value >= 0;
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const close = (left: unknown, right: number, tolerance = 0.00000101) => finite(left) && Math.abs(left - right) <= tolerance;
const same = (left: unknown, right: string[]) => Array.isArray(left) && left.length === right.length && left.every((value, i) => value === right[i]);

function month(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-01$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function nextMonths(origin: string): string[] {
  const date = new Date(`${origin}T00:00:00Z`);
  return [1, 2, 3].map(step => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + step, 1)).toISOString().slice(0, 10));
}

function namedRows(value: unknown, names: string[]): Map<string, Row> | null {
  if (!Array.isArray(value) || value.length !== names.length) return null;
  const rows = new Map<string, Row>();
  for (const row of value) {
    if (!object(row) || !names.includes(row.name) || rows.has(row.name)) return null;
    rows.set(row.name, row);
  }
  return rows;
}

function validCoverage(row: Row, points: AuditPoint[]): boolean {
  for (const level of [80, 95] as const) {
    const covered = points.filter(point => level === 80 ? point.covered80 : point.covered95).length;
    const numerator = row[`covered${level}`], denominator = row[`total${level}`], rate = row[`coverage${level}`];
    if (!integer(numerator) || !integer(denominator) || numerator !== covered || denominator !== points.length) return false;
    if (points.length === 0 ? rate !== null : !finite(rate) || rate < 0 || rate > 1 || !close(rate, covered / points.length)) return false;
  }
  return true;
}

/** Receives the dashboard so audit actuals can be checked against its official CPI observations. */
export function validateForecastEvaluationIntegrity(raw: unknown): boolean {
  try {
    if (!object(raw) || !object(raw.forecast)) return false;
    const forecast = raw.forecast;
    if (forecast.evaluation === undefined) return true;
    const evaluation = forecast.evaluation;
    if (!object(evaluation) || !text(evaluation.method) || evaluation.horizonMonths !== 3) return false;
    if (!Array.isArray(evaluation.caveats) || !evaluation.caveats.every(text)) return false;
    if (!Array.isArray(evaluation.origins) || evaluation.origins.length === 0 || evaluation.origins.length > 12) return false;
    const origins: string[] = evaluation.origins;
    if (!origins.every((origin, i) => month(origin) && (i === 0 || origin > origins[i - 1]))) return false;
    if (!Array.isArray(evaluation.windows) || evaluation.windows.length !== origins.length || forecast.backtestWindows !== origins.length) return false;

    if (!Array.isArray(forecast.models) || forecast.models.length === 0) return false;
    const names: string[] = forecast.models.map((row: Row) => row?.name);
    if (!names.every(text) || new Set(names).size !== names.length) return false;
    const summaries = namedRows(forecast.models, names);
    const eligibility = namedRows(evaluation.candidateEligibility, names);
    const coverage = namedRows(evaluation.coverage, names);
    if (!summaries || !eligibility || !coverage) return false;

    const headline = raw.series?.headline?.points;
    if (!Array.isArray(headline) || headline.length === 0) return false;
    const actuals = new Map<string, number>();
    let lastObservation = '';
    for (const point of headline) {
      if (!object(point) || !month(point.date) || !finite(point.value) || point.date <= lastObservation) return false;
      actuals.set(point.date, point.value);
      lastObservation = point.date;
    }
    const points = new Map<string, AuditPoint[]>(names.map(name => [name, []]));
    const failedOrigins = new Map<string, string[]>(names.map(name => [name, []]));

    for (const [index, window] of evaluation.windows.entries()) {
      if (!object(window) || window.origin !== origins[index] || window.trainingEnd !== window.origin) return false;
      if (!month(window.trainingStart) || window.trainingStart > window.trainingEnd || !actuals.has(window.trainingStart) || !actuals.has(window.trainingEnd)) return false;
      const trainCount = [...actuals.keys()].filter(date => date >= window.trainingStart && date <= window.trainingEnd).length;
      if (!integer(window.trainingObservations) || window.trainingObservations < 36 || window.trainingObservations !== trainCount) return false;
      const targets = nextMonths(window.origin);
      if (!same(window.targets, targets) || targets.at(-1)! > lastObservation) return false;
      const modelRows = namedRows(window.models, names);
      if (!modelRows) return false;
      for (const name of names) {
        const model = modelRows.get(name)!;
        // No baseline substitution may be attributed to a failed candidate.
        if (model.fallbackModel !== null || !Array.isArray(model.points)) return false;
        if (model.status === 'failed') {
          if (!text(model.failureReason) || model.points.length !== 0) return false;
          failedOrigins.get(name)!.push(window.origin);
          continue;
        }
        if (model.status !== 'success' || model.failureReason !== null || model.points.length !== 3) return false;
        for (const [step, point] of model.points.entries()) {
          if (!object(point) || point.horizon !== step + 1 || point.date !== targets[step]) return false;
          if (!['actual', 'predicted', 'error', 'low80', 'high80', 'low95', 'high95'].every(key => finite(point[key]))) return false;
          const observed = actuals.get(point.date);
          if (observed === undefined || !close(point.actual, observed) || !close(point.error, point.predicted - point.actual)) return false;
          if (!(point.low95 <= point.low80 && point.low80 <= point.predicted && point.predicted <= point.high80 && point.high80 <= point.high95)) return false;
          if (typeof point.covered80 !== 'boolean' || typeof point.covered95 !== 'boolean') return false;
          if (point.covered80 !== (point.low80 <= point.actual && point.actual <= point.high80) || point.covered95 !== (point.low95 <= point.actual && point.actual <= point.high95)) return false;
          points.get(name)!.push(point as AuditPoint);
        }
      }
    }

    for (const name of names) {
      const errors = points.get(name)!;
      const failures = failedOrigins.get(name)!;
      const candidate = eligibility.get(name)!;
      const summary = summaries.get(name)!;
      const measured = coverage.get(name)!;
      const eligible = failures.length === 0 && errors.length === 3 * origins.length;
      if (candidate.eligible !== eligible || !same(candidate.origins, origins) || !same(candidate.failedOrigins, failures)) return false;
      if (!integer(candidate.successfulWindows) || !integer(candidate.failedWindows) || candidate.successfulWindows !== origins.length - failures.length || candidate.failedWindows !== failures.length) return false;
      if (summary.eligible !== eligible || typeof summary.selected !== 'boolean') return false;
      if (summary.successfulWindows !== undefined && summary.successfulWindows !== candidate.successfulWindows) return false;
      if (summary.failedWindows !== undefined && summary.failedWindows !== candidate.failedWindows) return false;
      if (summary.fallbackCount !== undefined && summary.fallbackCount !== 0) return false;
      if (errors.length === 0) {
        if (summary.rmse !== null || summary.mae !== null) return false;
      } else {
        const differences = errors.map(point => point.predicted - point.actual);
        const rmse = Math.sqrt(differences.reduce((sum, error) => sum + error * error, 0) / errors.length);
        const mae = differences.reduce((sum, error) => sum + Math.abs(error), 0) / errors.length;
        // Published error metrics have four decimal places, audit points six.
        if (!close(summary.rmse, rmse, 0.000051) || !close(summary.mae, mae, 0.000051) || summary.rmse < 0 || summary.mae < 0) return false;
      }
      if (measured.eligible !== eligible || !validCoverage(measured, errors)) return false;
      if (measured.byHorizon !== undefined) {
        if (!Array.isArray(measured.byHorizon) || measured.byHorizon.length !== 3) return false;
        for (const [step, row] of measured.byHorizon.entries()) {
          if (!object(row) || row.horizon !== step + 1 || !validCoverage(row, errors.filter(point => point.horizon === step + 1))) return false;
        }
      }
    }

    const finalFit = evaluation.finalFit;
    const selected = forecast.models.filter((row: Row) => row.selected);
    if (!object(finalFit) || typeof finalFit.fallbackUsed !== 'boolean' || selected.length !== 1) return false;
    if (selected[0].name !== forecast.selectedModel || finalFit.usedModel !== forecast.selectedModel || !summaries.has(finalFit.requestedModel)) return false;
    if (eligibility.get(finalFit.usedModel)?.eligible !== true || eligibility.get(finalFit.requestedModel)?.eligible !== true) return false;
    const ranked = forecast.models.filter((row: Row) => row.eligible).sort((left: Row, right: Row) => left.rmse - right.rmse || left.mae - right.mae || names.indexOf(left.name) - names.indexOf(right.name));
    if (ranked[0]?.name !== finalFit.requestedModel) return false;
    if (finalFit.fallbackUsed) {
      if (finalFit.usedModel !== 'Seasonal naive' || finalFit.requestedModel === finalFit.usedModel || !text(finalFit.failureReason)) return false;
    } else if (finalFit.requestedModel !== finalFit.usedModel || finalFit.failureReason !== null) return false;
    if (evaluation.fallbackCount !== undefined && evaluation.fallbackCount !== Number(finalFit.fallbackUsed)) return false;

    if (evaluation.scenarioFit !== undefined) {
      const scenarioFit = evaluation.scenarioFit;
      if (!object(scenarioFit)) return false;
      if (scenarioFit.status === 'success') {
        if (scenarioFit.failureReason !== null || !object(forecast.scenario)) return false;
      } else if (scenarioFit.status === 'failed') {
        if (!text(scenarioFit.failureReason) || forecast.scenario != null) return false;
      } else return false;
    }
    if (forecast.scenario != null) {
      if (!object(forecast.scenario) || !['core', 'fx', 'opr'].every(key => finite(forecast.scenario.baseline?.[key]) && finite(forecast.scenario.coefficients?.[key]))) return false;
    }
    return true;
  } catch { return false; }
}
