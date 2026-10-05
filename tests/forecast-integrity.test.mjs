import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validateForecastEvaluationIntegrity } from '../app/lib/forecast-evaluation-integrity.ts';
import { validateDashboardIntegrity } from '../app/lib/dashboard-integrity.ts';

const fixture = () => JSON.parse(readFileSync(new URL('../data/published/dashboard.json', import.meta.url), 'utf8'));
const rejects = (mutations) => {
  for (const mutate of mutations) {
    const p = fixture();
    mutate(p);
    assert.equal(validateForecastEvaluationIntegrity(p), false, String(mutate));
  }
};
const successful = (p) => p.forecast.evaluation.windows[0].models.find(m => m.status === 'success');
const coverage = (p) => p.forecast.evaluation.coverage.find(row => row.name === 'SARIMA');

test('current published audit reconciles all candidates, targets and intervals', () => {
  assert.equal(validateForecastEvaluationIntegrity(fixture()), true);
});

test('dashboard integrity actually delegates to the optional audit validator', () => {
  const p = fixture();
  assert.equal(validateDashboardIntegrity(p), true);
  p.forecast.evaluation.coverage[0].covered80 -= 1;
  assert.equal(validateDashboardIntegrity(p), false);
  delete p.forecast.evaluation;
  assert.equal(validateDashboardIntegrity(p), true);
});

test('prospective vintage summary accepts honest collection states and rejects contradictory counts or clocks', () => {
  const p = fixture();
  const ledger = { version:1, status:'waiting', freshSourceCount:0, requiredSourceCount:6, sourceSnapshotCount:0,
    revisedSourcePeriodCount:0, prospectiveForecastCount:0, capturedOutcomeCount:0, pendingForecastTargetCount:0,
    firstSnapshotAt:null, lastSnapshotAt:null, note:'Collection begins only with freshly retrieved sources.' };
  p.forecast.vintageLedger = ledger;
  assert.equal(validateDashboardIntegrity(p), true);
  Object.assign(ledger, { status:'collecting', freshSourceCount:6, sourceSnapshotCount:6,
    prospectiveForecastCount:1, pendingForecastTargetCount:3,
    firstSnapshotAt:'2026-10-05T05:45:00Z', lastSnapshotAt:'2026-10-05T05:45:00Z' });
  assert.equal(validateDashboardIntegrity(p), true);
  ledger.pendingForecastTargetCount = 4;
  assert.equal(validateDashboardIntegrity(p), false);
  ledger.pendingForecastTargetCount = 3;
  ledger.lastSnapshotAt = '2026-10-04T05:45:00Z';
  assert.equal(validateDashboardIntegrity(p), false);
  ledger.lastSnapshotAt = '2026-10-05T05:45:00Z';
  ledger.status = 'partial';
  assert.equal(validateDashboardIntegrity(p), false);
});

test('older payloads without optional evaluation remain compatible', () => {
  const p = fixture();
  delete p.forecast.evaluation;
  for (const model of p.forecast.models) {
    delete model.eligible;
    delete model.successfulWindows;
    delete model.failedWindows;
  }
  assert.equal(validateForecastEvaluationIntegrity(p), true);
});

test('present evaluation cannot be null, malformed or missing required diagnostics', () => {
  rejects([
    p => p.forecast.evaluation = null,
    p => p.forecast.evaluation = [],
    p => delete p.forecast.evaluation.coverage,
    p => p.forecast.evaluation.horizonMonths = 2,
    p => p.forecast.evaluation.method = '',
    p => p.forecast.evaluation.caveats = [42],
  ]);
});

test('origin windows must be identical, complete and chronological', () => {
  rejects([
    p => p.forecast.evaluation.origins[1] = p.forecast.evaluation.origins[0],
    p => p.forecast.evaluation.windows[0].origin = '2025-02-30',
    p => p.forecast.evaluation.windows[0].targets.pop(),
    p => p.forecast.evaluation.windows[0].targets[0] = '2025-09-01',
    p => p.forecast.evaluation.windows[0].trainingEnd = p.forecast.evaluation.windows[0].targets[0],
    p => p.forecast.evaluation.windows[0].trainingObservations -= 1,
    p => p.forecast.backtestWindows += 1,
  ]);
});

test('candidate diagnostics reject duplicate, missing or mismatched names', () => {
  rejects([
    p => p.forecast.evaluation.windows[0].models.pop(),
    p => p.forecast.evaluation.windows[0].models[1].name = p.forecast.evaluation.windows[0].models[0].name,
    p => p.forecast.evaluation.candidateEligibility[0].name = 'Unknown model',
    p => p.forecast.evaluation.coverage[0].name = p.forecast.evaluation.coverage[1].name,
    p => p.forecast.models[0].name = p.forecast.models[1].name,
  ]);
});

test('candidate eligibility and failed origins agree with actual fitting outcomes', () => {
  rejects([
    p => p.forecast.evaluation.candidateEligibility.find(m => m.name === 'ARIMAX').eligible = true,
    p => p.forecast.evaluation.candidateEligibility[0].successfulWindows -= 1,
    p => p.forecast.evaluation.candidateEligibility[0].failedWindows += 1,
    p => p.forecast.evaluation.candidateEligibility[0].origins.reverse(),
    p => p.forecast.evaluation.candidateEligibility.find(m => m.name === 'ARIMAX').failedOrigins.pop(),
    p => p.forecast.models.find(m => m.name === 'ARIMAX').eligible = true,
    p => delete p.forecast.models[0].eligible,
  ]);
});

test('failed fits cannot contain substitute predictions or omit failure disclosure', () => {
  rejects([
    p => p.forecast.evaluation.windows.find(w => w.models.some(m => m.status === 'failed')).models.find(m => m.status === 'failed').failureReason = null,
    p => successful(p).status = 'failed',
    p => successful(p).fallbackModel = 'Seasonal naive',
    p => successful(p).failureReason = 'ignored failure',
    p => successful(p).status = 'fallback',
  ]);
});

test('audit horizons match complete target dates and official observed actuals', () => {
  rejects([
    p => successful(p).points.pop(),
    p => successful(p).points[0].horizon = 2,
    p => successful(p).points[0].date = p.forecast.evaluation.windows[0].origin,
    p => successful(p).points[0].actual += 0.1,
    p => successful(p).points[0].predicted = Infinity,
    p => successful(p).points[0].error += 0.1,
  ]);
});

test('audit bounds and coverage booleans must agree with each actual', () => {
  rejects([
    p => successful(p).points[0].low95 = successful(p).points[0].low80 + 1,
    p => successful(p).points[0].high80 = successful(p).points[0].low80 - 1,
    p => successful(p).points[0].high95 = NaN,
    p => successful(p).points[0].covered80 = !successful(p).points[0].covered80,
    p => successful(p).points[0].covered95 = 'true',
  ]);
});

test('coverage numerator, denominator and rate reconcile against audit points', () => {
  rejects([
    p => coverage(p).covered80 += 1,
    p => coverage(p).total80 -= 1,
    p => coverage(p).covered95 = -1,
    p => coverage(p).total95 += 1,
    p => coverage(p).coverage80 = 0.8,
    p => coverage(p).coverage95 = 1.1,
    p => coverage(p).eligible = false,
  ]);
});

test('optional per-horizon coverage must reconcile when supplied', () => {
  rejects([
    p => coverage(p).byHorizon[0].covered80 += 1,
    p => coverage(p).byHorizon[1].total95 -= 1,
    p => coverage(p).byHorizon[1].horizon = 1,
    p => coverage(p).byHorizon.pop(),
    p => coverage(p).byHorizon[0].coverage95 = 0.95,
  ]);
  const p = fixture();
  for (const row of p.forecast.evaluation.coverage) delete row.byHorizon;
  assert.equal(validateForecastEvaluationIntegrity(p), true);
});

test('candidate summary error metrics reconcile to successful audit points', () => {
  rejects([
    p => p.forecast.models.find(m => m.name === 'SARIMA').rmse += 0.01,
    p => p.forecast.models.find(m => m.name === 'SARIMA').mae = null,
    p => p.forecast.models.find(m => m.name === 'ARIMAX').successfulWindows += 1,
    p => p.forecast.models[0].fallbackCount = 1,
  ]);
});

test('all-failed candidate has null scores and null zero-denominator coverage', () => {
  const p = fixture();
  const audit = p.forecast.evaluation;
  for (const window of audit.windows) {
    Object.assign(window.models.find(m => m.name === 'ARIMAX'), { status: 'failed', failureReason: 'Synthetic fit failure', points: [] });
  }
  Object.assign(audit.candidateEligibility.find(m => m.name === 'ARIMAX'), { successfulWindows: 0, failedWindows: audit.origins.length, failedOrigins: [...audit.origins] });
  Object.assign(p.forecast.models.find(m => m.name === 'ARIMAX'), { rmse: null, mae: null, successfulWindows: 0, failedWindows: audit.origins.length,
    metricsByHorizon:[1,2,3].map(horizon=>({horizon,count:0,mae:null,rmse:null})) });
  const empty = { covered80: 0, total80: 0, coverage80: null, covered95: 0, total95: 0, coverage95: null, meanWidth80:null, meanWidth95:null };
  const row = audit.coverage.find(m => m.name === 'ARIMAX');
  Object.assign(row, empty);
  row.byHorizon = [1, 2, 3].map(horizon => ({ horizon, ...empty }));
  for (const comparison of audit.calibrationExperiment?.byModelHorizon.filter(item => item.model === 'ARIMAX') ?? []) {
    comparison.evaluationPoints = 0;
    comparison.unavailableCalibrationPoints = 0;
    comparison.uncalibrated = { count:0, coverage:null, meanWidth:null };
    comparison.recalibrated = { count:0, coverage:null, meanWidth:null };
  }
  assert.equal(validateForecastEvaluationIntegrity(p), true);
  row.coverage80 = 0;
  assert.equal(validateForecastEvaluationIntegrity(p), false);
});

test('selected model and final-fit fallback disclosure are consistent', () => {
  rejects([
    p => p.forecast.evaluation.finalFit.usedModel = 'ARIMAX',
    p => p.forecast.evaluation.finalFit.requestedModel = 'ARIMAX',
    p => p.forecast.evaluation.finalFit.fallbackUsed = true,
    p => p.forecast.evaluation.finalFit.failureReason = 'undisclosed failure',
    p => p.forecast.evaluation.fallbackCount = 1,
    p => p.forecast.models.find(m => m.name === 'ARIMAX').selected = true,
    p => p.forecast.selectedModel = 'Unknown model',
  ]);
  const p = fixture();
  for (const model of p.forecast.models) model.selected = model.name === 'Seasonal naive';
  p.forecast.selectedModel = 'Seasonal naive';
  Object.assign(p.forecast.evaluation.finalFit, { requestedModel: 'Seasonal naive', usedModel: 'Seasonal naive' });
  assert.equal(validateForecastEvaluationIntegrity(p), false, 'Selection must request the lowest-error eligible candidate');
});

test('a disclosed final-fit failure may use an eligible correctly named baseline', () => {
  const p = fixture();
  for (const model of p.forecast.models) model.selected = model.name === 'Seasonal naive';
  p.forecast.selectedModel = 'Seasonal naive';
  Object.assign(p.forecast.evaluation.finalFit, { requestedModel: 'SARIMA', usedModel: 'Seasonal naive', fallbackUsed: true, failureReason: 'Synthetic final-fit failure' });
  p.forecast.evaluation.fallbackCount = 1;
  assert.equal(validateForecastEvaluationIntegrity(p), true);
});

test('optional scenario-fit disclosure must agree with scenario availability', () => {
  rejects([
    p => p.forecast.evaluation.scenarioFit.status = 'success',
    p => p.forecast.evaluation.scenarioFit.failureReason = null,
    p => p.forecast.evaluation.scenarioFit.status = 'unknown',
  ]);
  const p = fixture();
  delete p.forecast.evaluation.scenarioFit;
  delete p.forecast.evaluation.fallbackCount;
  assert.equal(validateForecastEvaluationIntegrity(p), true);
});
