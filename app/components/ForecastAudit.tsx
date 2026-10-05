"use client";
import {useEffect,useRef,useState} from 'react';
import type {DashboardPayload,ForecastEvaluation,InputHealth} from '../lib/dashboard';
import type {ForecastPreview} from '../lib/dashboard-projection';
import './ForecastAudit.css';

export default function ForecastAudit({forecast,inputHealth,loadWindows}: {forecast:DashboardPayload['forecast']|ForecastPreview;inputHealth?:InputHealth;loadWindows?:()=>Promise<ForecastEvaluation['windows']>}) {
  const audit = forecast.evaluation;
  const [model,setModel] = useState(forecast.selectedModel);
  const [page,setPage] = useState(0);
  const [historyOpen,setHistoryOpen] = useState(false);
  const [loadedWindows,setLoadedWindows] = useState<ForecastEvaluation['windows']|null>(null);
  const [historyLoading,setHistoryLoading] = useState(false);
  const [historyError,setHistoryError] = useState('');
  const requestVersion = useRef(0);
  useEffect(()=>()=>{requestVersion.current++;},[]);
  if (!audit) return <section className="forecast-audit"><h2>Historical forecast audit</h2><p>This saved data version does not include per-origin forecasts or measured interval coverage. Its model intervals are nominal, not verified historical coverage. The next corrected pipeline refresh will publish these diagnostics.</p></section>;
  const windows = loadedWindows ?? ('windows' in audit ? audit.windows : []);
  const requestWindows = async () => {
    if (!loadWindows || loadedWindows || 'windows' in audit) return;
    const version=++requestVersion.current;setHistoryLoading(true);setHistoryError('');
    try { const loaded=await loadWindows();if(version===requestVersion.current)setLoadedWindows(loaded); }
    catch(error){if(version===requestVersion.current)setHistoryError(error instanceof Error?error.message:'Detailed forecast history could not be loaded. The summary remains available.');}
    finally{if(version===requestVersion.current)setHistoryLoading(false);}
  };
  const rows = historyOpen ? [...windows].reverse().flatMap(window => {
    const fitted = window.models.find(item => item.name === model);
    return window.targets.map((date,index) => ({origin:window.origin, date, horizon:index+1, status:fitted?.status ?? 'unavailable', failure:fitted?.failureReason, point:fitted?.points.find(point => point.date === date)}));
  }) : [];
  const pages = Math.max(1,Math.ceil(rows.length/12));
  const activePage = Math.min(page,pages-1);
  const fmt = (value:number|undefined|null) => value == null ? 'Unavailable' : value.toFixed(3);
  return <section className="forecast-audit" aria-labelledby="forecast-audit-heading">
    <h2 id="forecast-audit-heading">Historical forecast audit</h2>
    <p>{audit.origins.length} complete forecast origins, each evaluated over {audit.horizonMonths} months. Predictions were made from data ending at each origin; current revised data are used with conservative release lags. This is not a true-vintage backtest.</p>
    <p>Analysis calculated {forecast.calculatedAt ? new Intl.DateTimeFormat('en-MY',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Kuala_Lumpur'}).format(new Date(forecast.calculatedAt)) : 'at the recorded pipeline calculation time'} · input status: {inputHealth?.status ?? forecast.status}. Calculation time is not a new official-data release.</p>
    {audit.finalFit.fallbackUsed && <p role="alert">Final fitting failed for {audit.finalFit.requestedModel}. The forecast uses {audit.finalFit.usedModel} instead. Reason: {audit.finalFit.failureReason}.</p>}
    {audit.scenarioFit?.status === 'failed' && <p>The sensitivity overlay is unavailable because its ARIMAX fit did not converge. No coefficients or slider results are invented. The selected model forecast remains available.</p>}
    <h3>How often did the uncertainty ranges cover the actual outcome?</h3>
    <p>An 80% label is a model assumption, not a guarantee. Measured coverage below 80% or 95% means the historical ranges missed more often than those labels suggest. Counts overlap across forecast origins and are not independent observations.</p>
    <div className="forecast-audit-scroll" tabIndex={0} aria-label="Scroll to read interval coverage table"><table><caption>Empirical interval coverage on successful fits; incomplete candidates are not eligible for selection.</caption><thead><tr><th scope="col">Model</th><th scope="col">Complete origins</th><th scope="col">80% coverage</th><th scope="col">95% coverage</th><th scope="col">Selection eligibility</th></tr></thead><tbody>{audit.coverage.map(item => {
      const eligibility = audit.candidateEligibility.find(candidate => candidate.name === item.name);
      return <tr key={item.name}><th scope="row">{item.name}</th><td>{eligibility?.successfulWindows ?? 0}/{audit.origins.length}{!!eligibility?.failedWindows && ` · ${eligibility.failedWindows} failed`}</td><td>{item.coverage80 == null ? 'Unavailable' : `${(item.coverage80*100).toFixed(1)}% (${item.covered80}/${item.total80})`}</td><td>{item.coverage95 == null ? 'Unavailable' : `${(item.coverage95*100).toFixed(1)}% (${item.covered95}/${item.total95})`}</td><td>{item.eligible ? 'All windows completed' : 'Not eligible — incomplete fits'}</td></tr>;
    })}</tbody></table></div>
    <h3>Accuracy and interval width by forecast month</h3>
    <p>MAE and RMSE are in inflation percentage points; lower errors are better. Interval width is also in percentage points. Coverage and widths are descriptive, and depend on which historical fits completed.</p>
    <div className="forecast-audit-scroll" tabIndex={0} aria-label="Scroll to read model accuracy by forecast horizon"><table><caption>Three-month horizon comparison using the same rolling evaluation origins.</caption><thead><tr><th scope="col">Model</th><th scope="col">Horizon</th><th scope="col">MAE</th><th scope="col">RMSE</th><th scope="col">80% coverage / width</th><th scope="col">95% coverage / width</th></tr></thead><tbody>{forecast.models.flatMap(candidate => (candidate.metricsByHorizon ?? []).map(metric => {
      const coverage = audit.coverage.find(item => item.name === candidate.name)?.byHorizon?.find(item => item.horizon === metric.horizon);
      return <tr key={`${candidate.name}-${metric.horizon}`}><th scope="row">{candidate.name}</th><td>{metric.horizon} month</td><td>{fmt(metric.mae)}</td><td>{fmt(metric.rmse)}</td><td>{coverage?.coverage80 == null ? 'Unavailable' : `${(coverage.coverage80*100).toFixed(1)}% · width ${fmt(coverage.meanWidth80)} pp`}</td><td>{coverage?.coverage95 == null ? 'Unavailable' : `${(coverage.coverage95*100).toFixed(1)}% · width ${fmt(coverage.meanWidth95)} pp`}</td></tr>;
    }))}</tbody></table></div>
    {audit.calibrationExperiment && <>
      <h3>Experimental rolling interval recalibration</h3>
      <p>The first {audit.calibrationExperiment.warmupOrigins.length} origins are a calibration warm-up. The later {audit.calibrationExperiment.evaluationOrigins.length} origins form the evaluation period. For each later forecast, the experiment uses only earlier errors of the same model and horizon whose actual target month is strictly before that forecast origin. The published forecast and its original intervals are not changed.</p>
      <p>{audit.calibrationExperiment.minimumSampleRule}</p>
      <div className="forecast-audit-scroll" tabIndex={0} aria-label="Scroll to compare experimental recalibrated intervals"><table><caption>Held-out period: original versus experimental interval coverage and average width, in percentage points.</caption><thead><tr><th scope="col">Model</th><th scope="col">Horizon</th><th scope="col">Nominal range</th><th scope="col">Original coverage / width</th><th scope="col">Recalibrated coverage / width</th><th scope="col">Insufficient-sample points</th></tr></thead><tbody>{audit.calibrationExperiment.byModelHorizon.map(row => <tr key={`${row.model}-${row.horizon}-${row.nominalCoverage}`}><th scope="row">{row.model}</th><td>{row.horizon} month</td><td>{row.nominalCoverage}%</td><td>{row.uncalibrated.coverage == null ? 'Unavailable' : `${(row.uncalibrated.coverage*100).toFixed(1)}% · ${fmt(row.uncalibrated.meanWidth)} pp`}</td><td>{row.recalibrated.coverage == null ? 'Unavailable' : `${(row.recalibrated.coverage*100).toFixed(1)}% · ${fmt(row.recalibrated.meanWidth)} pp (${row.recalibrated.count} points)`}</td><td>{row.unavailableCalibrationPoints}</td></tr>)}</tbody></table></div>
      <p>{audit.calibrationExperiment.warning}</p>
    </>}
    <details open={historyOpen} onToggle={event=>{const open=event.currentTarget.open;setHistoryOpen(open);if(open)void requestWindows();}}><summary>Inspect actual versus predicted values and fitting failures</summary>
      {historyOpen && <>
      {historyLoading && <p role="status" aria-live="polite">Loading matching historical forecast windows…</p>}
      {historyError && <div role="alert"><p>{historyError}</p><button type="button" onClick={()=>void requestWindows()}>Retry forecast history</button></div>}
      {!historyLoading && !historyError && !windows.length && <p>Detailed windows are not available in this preview. No forecasts or failures are invented.</p>}
      <label htmlFor="audit-model">Historical model</label><select id="audit-model" value={model} onChange={event => {setModel(event.target.value);setPage(0);}}>{forecast.models.map(item => <option key={item.name}>{item.name}</option>)}</select>
      <p role="status" aria-live="polite">{model}: page {activePage+1} of {pages}, newest origins first. Error is predicted minus actual, in percentage points.</p>
      <div className="forecast-audit-scroll" tabIndex={0} aria-label="Scroll to read historical forecast values"><table><thead><tr><th scope="col">Origin</th><th scope="col">Target / horizon</th><th scope="col">Actual</th><th scope="col">Predicted</th><th scope="col">Error</th><th scope="col">80% range</th><th scope="col">95% range</th><th scope="col">Fit status</th></tr></thead><tbody>{rows.slice(activePage*12,(activePage+1)*12).map(row => <tr key={`${row.origin}-${row.date}`}><th scope="row">{row.origin.slice(0,7)}</th><td>{row.date.slice(0,7)} · {row.horizon}m</td><td>{fmt(row.point?.actual)}</td><td>{fmt(row.point?.predicted)}</td><td>{fmt(row.point?.error)}</td><td>{row.point ? `${fmt(row.point.low80)} to ${fmt(row.point.high80)}` : 'Unavailable'}</td><td>{row.point ? `${fmt(row.point.low95)} to ${fmt(row.point.high95)}` : 'Unavailable'}</td><td>{row.status}{row.failure && <small>{row.failure}</small>}</td></tr>)}</tbody></table></div>
      <div className="forecast-audit-pages"><button type="button" disabled={activePage===0} onClick={() => setPage(p=>Math.max(0,p-1))}>Previous origins</button><button type="button" disabled={activePage===pages-1} onClick={() => setPage(p=>Math.min(pages-1,p+1))}>Next origins</button></div>
      </>}
    </details>
    <details><summary>Evaluation assumptions and limitations</summary><ul>{audit.caveats.map(item => <li key={item}>{item}</li>)}</ul></details>
    {forecast.vintageLedger && <aside className={`forecast-vintage-note ${forecast.vintageLedger.status}`} aria-labelledby="forecast-vintage-heading">
      <h3 id="forecast-vintage-heading">Prospective data-revision record</h3>
      {forecast.vintageLedger.sourceSnapshotCount === 0
        ? <p>The append-only ledger is waiting for its first pipeline run after this feature was introduced. It will record only newly retrieved, validated inputs; older cached observations will not be backdated as release vintages.</p>
        : <p>The last ledger update recorded {forecast.vintageLedger.freshSourceCount} of {forecast.vintageLedger.requiredSourceCount} required series as fresh. It now contains {forecast.vintageLedger.sourceSnapshotCount} source snapshots across {forecast.vintageLedger.revisedSourcePeriodCount} revised source-periods.</p>}
      <p>{forecast.vintageLedger.prospectiveForecastCount} forecasts have been issued only for months wholly after their recorded issue date; {forecast.vintageLedger.capturedOutcomeCount} actual outcomes have since been captured and {forecast.vintageLedger.pendingForecastTargetCount} remain unobserved. A captured outcome is not verified as DOSM’s first unrevised release.</p>
      {forecast.vintageLedger.firstSnapshotAt && <p>Ledger collection began {new Intl.DateTimeFormat('en-MY',{dateStyle:'medium',timeZone:'Asia/Kuala_Lumpur'}).format(new Date(forecast.vintageLedger.firstSnapshotAt))}. Older saved CPI files are preserved but are not labelled as genuine historical release vintages.</p>}
      <p>{forecast.vintageLedger.note}</p>
      <a href="https://github.com/Nana-ctrl617/Macrolens-Malaysia/tree/main/data/vintages/ledger-v1" target="_blank" rel="noreferrer">Browse the append-only record in GitHub ↗</a>
    </aside>}
    <div className="forecast-audit-downloads"><a href="/api/forecast-evaluation?format=csv">Download historical forecasts CSV</a><a href="/api/forecast-evaluation?format=json">Download full audit JSON</a></div>
    <div className="forecast-month-ranges"><h3>All three forecast months</h3><div className="forecast-audit-scroll" tabIndex={0} aria-label="Scroll to read all three forecast ranges"><table><thead><tr><th scope="col">Month</th><th scope="col">Central estimate</th><th scope="col">80% interval</th><th scope="col">95% interval</th></tr></thead><tbody>{forecast.points.map(point => <tr key={point.date}><th scope="row">{point.date.slice(0,7)}</th><td>{fmt(point.value)}%</td><td>{fmt(point.low80)}% to {fmt(point.high80)}%</td><td>{fmt(point.low95)}% to {fmt(point.high95)}%</td></tr>)}</tbody></table></div></div>
  </section>;
}
