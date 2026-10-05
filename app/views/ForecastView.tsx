"use client";

import type { DashboardViewPayload } from "@/app/lib/dashboard-projection";

import { useId, useRef, useState } from "react";
import { isChartInspectionKey, nextChartIndex } from "@/app/lib/chart-inspection";
import { formatDate } from "@/app/lib/dashboard-format";
import { InputHealthNotice } from "@/app/components/InputHealthNotice";
import ModelErrorVisual from "@/app/components/ModelErrorVisual";
import ForecastAudit from "@/app/components/ForecastAudit";
import type { ForecastEvaluation } from "@/app/lib/dashboard";
import { useDashboardData } from "@/app/components/DashboardShell";

export function ForecastIntervalChart({ points }: { points: Array<{ month: string; value: number; low80: number; high80: number; low95: number; high95: number }> }) {
  const id = useId();
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const intervalValues = points.flatMap((point) => [point.low95, point.low80, point.value, point.high80, point.high95]).filter(Number.isFinite);
  const scaleMin = Math.floor(Math.min(-1, ...intervalValues)), scaleMax = Math.ceil(Math.max(5, ...intervalValues));
  const toPercent = (value: number) => Math.min(100, Math.max(0, (value - scaleMin) / (scaleMax - scaleMin) * 100));
  const ticks = Array.from({ length: 7 }, (_, index) => scaleMin + (scaleMax - scaleMin) * index / 6);
  const describe = (item: typeof points[number]) => `${item.month}: central forecast ${item.value.toFixed(2)}%; 80% interval ${item.low80.toFixed(2)}% to ${item.high80.toFixed(2)}%; 95% interval ${item.low95.toFixed(2)}% to ${item.high95.toFixed(2)}%.`;
  const reading = selected != null && points[selected] ? describe(points[selected]) : "No forecast month selected.";
  return <div data-chart-kind="forecast" role="group" aria-label="Three-month headline inflation forecast and prediction intervals"
    onKeyDown={(event) => {
      if (!isChartInspectionKey(event.key)) return;
      event.preventDefault();
      const focused = buttons.current.findIndex((button) => button === event.target);
      const next = nextChartIndex(event.key, focused >= 0 ? focused : selected, points.length);
      setSelected(next);
      if (next != null) buttons.current[next]?.focus();
    }}>
    <div className="forecast-scale" aria-hidden="true">{ticks.map((value, index) => <span key={index}>{Number(value.toFixed(1))}%</span>)}</div>
    <div className="forecast-plot">{points.map((item, index) => <div className="forecast-row" key={item.month}>
      <strong>{item.month}</strong>
      <button type="button" className="interval-track" aria-label={describe(item)} aria-pressed={selected === index} tabIndex={(selected ?? 0) === index ? 0 : -1}
        ref={(element) => { buttons.current[index] = element; }}
        aria-describedby={`${id}-help ${id}-reading`} onFocus={() => setSelected(index)} onPointerMove={() => setSelected(index)} onClick={() => setSelected(index)}>
        <i className="range range95" aria-hidden="true" style={{ left: `${toPercent(item.low95)}%`, width: `${toPercent(item.high95) - toPercent(item.low95)}%` }} />
        <i className="range range80" aria-hidden="true" style={{ left: `${toPercent(item.low80)}%`, width: `${toPercent(item.high80) - toPercent(item.low80)}%` }} />
        <i className="forecast-point" aria-hidden="true" style={{ left: `${toPercent(item.value)}%` }}><span>{item.value.toFixed(2)}%</span></i>
      </button>
    </div>)}</div>
    <div className="interval-legend"><span><i className="keypoint" />Central forecast</span><span><i className="key80" />80% interval</span><span><i className="key95" />95% interval</span></div>
    <p id={`${id}-help`} className="chart-inspection-help">Tap or focus a forecast row to read every bound. Use arrows or Home/End to compare months; Escape clears the selection.</p>
    <p id={`${id}-reading`} className="chart-inspection-status" role="status" aria-live="polite" aria-atomic="true">{reading}</p>
  </div>;
}

export const forecastModelDescriptions: Record<string, string> = {
  "Seasonal naive": "Uses the same month from the previous year as a simple benchmark. It is the minimum standard the statistical models should beat.",
  SARIMA: "Uses inflation's own past pattern, trend and seasonality. It does not use extra economic variables.",
  ARIMAX: "Uses inflation history plus lagged macro variables such as core inflation, exchange rates and policy rates.",
};

export const forecastMisunderstandings = [
  "The forecast is not a promise; it is a statistical estimate based on available data.",
  "A lower RMSE does not mean the model is always right; it means it performed better on the tested historical windows.",
  "ARIMAX associations do not prove causation, even when the model uses economic variables.",
  "Prediction intervals matter more than the exact point estimate because uncertainty grows quickly.",
  "Official data revisions can change future model results and backtest scores.",
];

export function ScenarioExplorer({ dashboard, forecastPoints }: { dashboard: DashboardViewPayload<"forecast"> | null; forecastPoints: Array<{ month: string; value: number }> }) {
  const [coreDelta, setCoreDelta] = useState(0);
  const [fxDelta, setFxDelta] = useState(0);
  const [oprDelta, setOprDelta] = useState(0);
  const scenario = dashboard?.forecast.scenario;
  if (!scenario) return <section className="scenario-explorer" aria-labelledby="scenario-title"><div className="scenario-heading"><div><span>Sensitivity overlay</span><h2 id="scenario-title">Sensitivity analysis is unavailable</h2><p>{dashboard ? "The ARIMAX sensitivity fit did not complete successfully. Sliders and coefficients are not shown because their results would not be validated. The selected model's forecast above remains available." : "Waiting for validated model diagnostics. No slider estimates are shown before the data loads."}</p></div></div></section>;
  const coefficients = scenario.coefficients;
  const effect = coreDelta * coefficients.core + fxDelta * coefficients.fx + oprDelta * coefficients.opr;
  const reset = () => { setCoreDelta(0); setFxDelta(0); setOprDelta(0); };
  return <section className="scenario-explorer" aria-labelledby="scenario-title">
    <div className="scenario-heading"><div><span>Sensitivity overlay</span><h2 id="scenario-title">Stress the forecast assumptions</h2><p>These sliders do not change the MacroLens model forecast above. They show how the published central path could shift under a separate historical-association overlay.</p></div><button onClick={reset}>Reset assumptions</button></div>
    <div className="scenario-definitions" aria-label="Sensitivity variable definitions">
      <article><span>Core inflation</span><p>Underlying inflation pressure after selected volatile or administered-price items are removed.</p></article>
      <article><span>USD/MYR</span><p>The ringgit exchange rate against the US dollar; changes can affect imported costs with a lag.</p></article>
      <article><span>OPR</span><p>Bank Negara Malaysia&apos;s Overnight Policy Rate, a policy setting that influences borrowing conditions over time.</p></article>
    </div>
    <div className="scenario-layout">
      <div className="scenario-controls">
        <label><span>Core inflation change <b>{coreDelta > 0 ? "+" : ""}{coreDelta.toFixed(1)} pp</b></span><input aria-label="Core inflation change" type="range" min="-1" max="1" step="0.1" value={coreDelta} onInput={(event) => setCoreDelta(Number(event.currentTarget.value))} /></label>
        <label><span>USD/MYR change <b>{fxDelta > 0 ? "+" : ""}{fxDelta.toFixed(2)} RM</b></span><input aria-label="USD MYR change" type="range" min="-0.5" max="0.5" step="0.05" value={fxDelta} onInput={(event) => setFxDelta(Number(event.currentTarget.value))} /></label>
        <label><span>OPR change <b>{oprDelta > 0 ? "+" : ""}{oprDelta.toFixed(2)} pp</b></span><input aria-label="OPR change" type="range" min="-1" max="1" step="0.25" value={oprDelta} onInput={(event) => setOprDelta(Number(event.currentTarget.value))} /></label>
      </div>
      <div className="scenario-result">
        <span>Association-based overlay</span><strong>{effect > 0 ? "+" : ""}{effect.toFixed(2)} pp</strong><p>Estimated shift relative to the published central path. It is an illustrative sensitivity result, not a new MacroLens model forecast.</p>
        <div>{forecastPoints.map((point) => <article key={point.month}><small>{point.month}</small><b>{(point.value + effect).toFixed(2)}%</b></article>)}</div>
      </div>
    </div>
    <p className="scenario-limit">{scenario?.warning ?? "This uses historical ARIMAX associations with lagged inputs. It is a sensitivity exercise, not a causal estimate, policy forecast or investment signal."}</p>
  </section>;
}

export function ForecastContent({ dashboard, loadWindows }: { dashboard: DashboardViewPayload<"forecast"> | null; loadWindows?: () => Promise<ForecastEvaluation["windows"]> }) {
const liveForecasts = dashboard?.forecast.points.map((point) => ({ ...point, month: formatDate(point.date) })) ?? [];
const liveModels = dashboard?.forecast.models ?? [];
const selectedForecastModel = liveModels.find((model) => model.selected) ?? liveModels[0];
const finalForecast = liveForecasts.at(-1);
return <section className="section forecast-section page-section compact-forecast" id="forecast">
        <div className="shell">
          <div className="section-heading light">
            <div><span className="section-number">04 / Forecast</span><h1>Three months ahead</h1></div>
            <p>The model is chosen through rolling historical tests. Ranges show uncertainty—not a promise about future inflation.</p>
          </div>
          <InputHealthNotice health={dashboard?.inputHealth?.forecast} />
          <div className="forecast-layout">
            <div className="forecast-card">
              <h2>Headline inflation forecast</h2>
              <ForecastIntervalChart points={liveForecasts} />
              <p className="forecast-chart-note">Start with the range, then read the point estimate. The 95% interval is wider because it is designed to cover more possible outcomes.</p>
            </div>
            <aside className="model-card">
              <span className="mini-label">Out-of-sample comparison</span>
              <h2>Model scorecard</h2>
              <ModelErrorVisual models={liveModels} />
              <details className="forecast-disclosure"><summary>Exact model-error table</summary><div className="forecast-score-table">
                <table>
                  <caption>Identical rolling backtest windows; lower error is better.</caption>
                  <thead><tr><th scope="col">Model</th><th scope="col">RMSE</th><th scope="col">MAE</th></tr></thead>
                  <tbody>{liveModels.map((model) => <tr className={model.selected ? "selected" : undefined} key={model.name}>
                    <th scope="row">{model.name}{model.selected && <span>Selected</span>}</th>
                    <td>{model.rmse == null ? "Unavailable" : model.rmse.toFixed(2)}{model.eligible === false && " (incomplete)"}</td><td>{model.mae == null ? "Unavailable" : model.mae.toFixed(2)}</td>
                  </tr>)}</tbody>
                </table>
              </div></details>
              <small><b>RMSE</b> is the square root of the mean squared error, measured in percentage points; it gives extra weight to large misses. <b>MAE</b> means average absolute error. Scores use {dashboard?.forecast.backtestWindows ?? "the available"} rolling backtest windows; lower is better. {selectedForecastModel?.name ?? dashboard?.forecast.selectedModel ?? "The selected model"} is the published selection. With audited data, only candidates completing every window are eligible, and the lowest RMSE wins (MAE breaks ties). Any final fitting fallback is disclosed below.</small>
            </aside>
          </div>
          <h2 className="forecast-summary-heading">Final forecast month{finalForecast ? ` · ${finalForecast.month}` : ""}</h2>
          <div className="forecast-explain-grid">
            <article><span>Central forecast</span><strong>{finalForecast ? `${finalForecast.value.toFixed(2)}%` : "Loading"}</strong><p>The single line estimate for the last forecast month. It is useful, but should not be read alone.</p></article>
            <article><span>80% interval</span><strong>{finalForecast ? `${finalForecast.low80.toFixed(2)}% to ${finalForecast.high80.toFixed(2)}%` : "Loading"}</strong><p>A narrower uncertainty band. Outcomes outside this range are still possible.</p></article>
            <article><span>95% interval</span><strong>{finalForecast ? `${finalForecast.low95.toFixed(2)}% to ${finalForecast.high95.toFixed(2)}%` : "Loading"}</strong><p>A wider prediction interval. It should contain the 80% interval.</p></article>
          </div>
          {dashboard && <ForecastAudit forecast={dashboard.forecast} inputHealth={dashboard.inputHealth?.forecast} loadWindows={loadWindows} />}
          <div className="forecast-takeaway"><span>Model reading</span><p>{dashboard?.narratives.forecast ?? "Loading the latest model interpretation."}</p></div>
          <details className="forecast-disclosure">
            <summary>How to read the forecast</summary>
            <div className="forecast-guide">
              <div><h2>Start with the range, then read the point estimate.</h2><p>This is a three-month headline inflation forecast. It is not a forecast for individual stocks, the ringgit, or the next OPR decision.</p></div>
              <article><strong>Central forecast</strong><p>The model&apos;s best estimate for each future month.</p></article>
              <article><strong>80% and 95% intervals</strong><p>Uncertainty ranges. The 95% interval is wider because it is designed to cover more possible outcomes.</p></article>
              <article><strong>Wider range</strong><p>More uncertainty. Treat the exact number as less important when the interval is wide.</p></article>
            </div>
          </details>
          <details className="forecast-disclosure">
            <summary>Forecast method in simple steps</summary>
            <div className="forecast-method-panel">
              <h2>How the page turns data into a forecast</h2>
              <ol>
                <li><b>Collect official data.</b><p>Use monthly inflation and related macro variables from the dashboard payload.</p></li>
                <li><b>Compare models fairly.</b><p>Seasonal naive, SARIMA and ARIMAX are tested over the same rolling historical windows.</p></li>
                <li><b>Select the lowest-error model.</b><p>The chosen model is the one with the best backtest performance, mainly lowest RMSE.</p></li>
                <li><b>Forecast three months ahead.</b><p>Show the central forecast for each future month.</p></li>
                <li><b>Show uncertainty.</b><p>Display 80% and 95% prediction intervals and explain the limits.</p></li>
              </ol>
            </div>
          </details>
          <details className="forecast-disclosure">
            <summary>Model definitions and assumptions</summary>
            <div className="forecast-model-notes">
              {liveModels.map((model) => <article key={model.name}><span>{model.name}</span><p>{forecastModelDescriptions[model.name] ?? "Forecast candidate evaluated using the same rolling backtest windows."}</p></article>)}
            </div>
          </details>
          <ScenarioExplorer dashboard={dashboard} forecastPoints={liveForecasts} />
          <details className="forecast-disclosure">
            <summary>What this forecast does not mean</summary>
            <div className="forecast-limits">
              <article><h2>Why three months only?</h2><strong>Short horizon</strong><p>Inflation can change when policy, administered prices, commodity costs or exchange rates move. Shorter horizons are easier to explain responsibly.</p></article>
              <article><h2>What can make it wrong?</h2><strong>New shocks</strong><p>Unexpected subsidy changes, global commodity moves, exchange-rate swings, data revisions or one-off price changes can shift the path.</p></article>
            </div>
            <div className="forecast-misunderstandings"><h2>Common misunderstandings</h2><ul>{forecastMisunderstandings.map((item) => <li key={item}>{item}</li>)}</ul></div>
          </details>
        </div>
      </section>;
}
export default function ForecastView() { const { dashboard, loadHistory } = useDashboardData("forecast"); const ref = dashboard?.deferred["forecast-audit"]; return <ForecastContent dashboard={dashboard} loadWindows={ref ? async () => (await loadHistory(ref)).data.windows : undefined} />; }
