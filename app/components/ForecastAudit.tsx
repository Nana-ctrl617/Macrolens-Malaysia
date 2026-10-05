"use client";
import {useState} from 'react';
import type {DashboardPayload,InputHealth} from '../lib/dashboard';
import './ForecastAudit.css';

export default function ForecastAudit({forecast,inputHealth}: {forecast:DashboardPayload['forecast'];inputHealth?:InputHealth}) {
  const audit = forecast.evaluation;
  const [model,setModel] = useState(forecast.selectedModel);
  const [page,setPage] = useState(0);
  if (!audit) return <section className="forecast-audit"><h2>Historical forecast audit</h2><p>This saved data version does not include per-origin forecasts or measured interval coverage. Its model intervals are nominal, not verified historical coverage. The next corrected pipeline refresh will publish these diagnostics.</p></section>;
  const rows = [...audit.windows].reverse().flatMap(window => {
    const fitted = window.models.find(item => item.name === model);
    return window.targets.map((date,index) => ({origin:window.origin, date, horizon:index+1, status:fitted?.status ?? 'unavailable', failure:fitted?.failureReason, point:fitted?.points.find(point => point.date === date)}));
  });
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
    <div className="forecast-audit-scroll"><table><caption>Empirical interval coverage on successful fits; incomplete candidates are not eligible for selection.</caption><thead><tr><th scope="col">Model</th><th scope="col">Complete origins</th><th scope="col">80% coverage</th><th scope="col">95% coverage</th><th scope="col">Selection eligibility</th></tr></thead><tbody>{audit.coverage.map(item => {
      const eligibility = audit.candidateEligibility.find(candidate => candidate.name === item.name);
      return <tr key={item.name}><th scope="row">{item.name}</th><td>{eligibility?.successfulWindows ?? 0}/{audit.origins.length}{!!eligibility?.failedWindows && ` · ${eligibility.failedWindows} failed`}</td><td>{item.coverage80 == null ? 'Unavailable' : `${(item.coverage80*100).toFixed(1)}% (${item.covered80}/${item.total80})`}</td><td>{item.coverage95 == null ? 'Unavailable' : `${(item.coverage95*100).toFixed(1)}% (${item.covered95}/${item.total95})`}</td><td>{item.eligible ? 'All windows completed' : 'Not eligible — incomplete fits'}</td></tr>;
    })}</tbody></table></div>
    <details><summary>Inspect actual versus predicted values and fitting failures</summary>
      <label htmlFor="audit-model">Historical model</label><select id="audit-model" value={model} onChange={event => {setModel(event.target.value);setPage(0);}}>{forecast.models.map(item => <option key={item.name}>{item.name}</option>)}</select>
      <p role="status" aria-live="polite">{model}: page {activePage+1} of {pages}, newest origins first. Error is predicted minus actual, in percentage points.</p>
      <div className="forecast-audit-scroll"><table><thead><tr><th scope="col">Origin</th><th scope="col">Target / horizon</th><th scope="col">Actual</th><th scope="col">Predicted</th><th scope="col">Error</th><th scope="col">80% range</th><th scope="col">95% range</th><th scope="col">Fit status</th></tr></thead><tbody>{rows.slice(activePage*12,(activePage+1)*12).map(row => <tr key={`${row.origin}-${row.date}`}><th scope="row">{row.origin.slice(0,7)}</th><td>{row.date.slice(0,7)} · {row.horizon}m</td><td>{fmt(row.point?.actual)}</td><td>{fmt(row.point?.predicted)}</td><td>{fmt(row.point?.error)}</td><td>{row.point ? `${fmt(row.point.low80)} to ${fmt(row.point.high80)}` : 'Unavailable'}</td><td>{row.point ? `${fmt(row.point.low95)} to ${fmt(row.point.high95)}` : 'Unavailable'}</td><td>{row.status}{row.failure && <small>{row.failure}</small>}</td></tr>)}</tbody></table></div>
      <div className="forecast-audit-pages"><button type="button" disabled={activePage===0} onClick={() => setPage(p=>Math.max(0,p-1))}>Previous origins</button><button type="button" disabled={activePage===pages-1} onClick={() => setPage(p=>Math.min(pages-1,p+1))}>Next origins</button></div>
    </details>
    <details><summary>Evaluation assumptions and limitations</summary><ul>{audit.caveats.map(item => <li key={item}>{item}</li>)}</ul></details>
    <div className="forecast-audit-downloads"><a href="/api/forecast-evaluation?format=csv">Download historical forecasts CSV</a><a href="/api/forecast-evaluation?format=json">Download full audit JSON</a></div>
    <div className="forecast-month-ranges"><h3>All three forecast months</h3><div className="forecast-audit-scroll"><table><thead><tr><th scope="col">Month</th><th scope="col">Central estimate</th><th scope="col">80% interval</th><th scope="col">95% interval</th></tr></thead><tbody>{forecast.points.map(point => <tr key={point.date}><th scope="row">{point.date.slice(0,7)}</th><td>{fmt(point.value)}%</td><td>{fmt(point.low80)}% to {fmt(point.high80)}%</td><td>{fmt(point.low95)}% to {fmt(point.high95)}%</td></tr>)}</tbody></table></div></div>
  </section>;
}
