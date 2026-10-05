"use client";

import { useState } from "react";
import type { DashboardPayload } from "../lib/dashboard";
import "./ModelErrorVisual.css";

type Model = DashboardPayload["forecast"]["models"][number];

export default function ModelErrorVisual({ models }: { models: Model[] }) {
  const [metric, setMetric] = useState<"rmse" | "mae">("rmse");
  const valid = (value: number) => Number.isFinite(value) && value >= 0;
  const values = models.flatMap((model) => [model.rmse, model.mae]).filter(valid);
  const maximum = Math.max(0.1, ...values);
  const axisMaximum = Math.ceil(maximum * 10) / 10;
  const ordered = [...models].sort((a, b) => (valid(a[metric]) ? a[metric] : Infinity) - (valid(b[metric]) ? b[metric] : Infinity));
  return <div className="model-error-visual">
    <div className="model-error-controls" role="group" aria-label="Compare model forecast errors">
      <button type="button" aria-pressed={metric === "rmse"} onClick={() => setMetric("rmse")}>RMSE</button>
      <button type="button" aria-pressed={metric === "mae"} onClick={() => setMetric("mae")}>MAE</button>
    </div>
    <p className="model-error-caption">{metric.toUpperCase()} · percentage points · shorter bar = lower error</p>
    {ordered.length === 0 ? <p>No model errors are available in this snapshot.</p> : <>
      <div className="model-error-axis" aria-hidden="true"><span>0</span><span>{(axisMaximum / 2).toFixed(2)}</span><span>{axisMaximum.toFixed(2)} pp</span></div>
      <ul className="model-error-list" aria-label={`${metric.toUpperCase()} model comparison in percentage points`}>
        {ordered.map((model) => <li key={model.name} className={model.selected ? "selected" : ""}>
          <div className="model-error-name"><strong>{model.name}</strong>{model.selected && <span>Selected model</span>}<b>{valid(model[metric]) ? `${model[metric].toFixed(2)} pp` : "Unavailable"}</b></div>
          <div className="model-error-track" aria-hidden="true"><i style={{ width: valid(model[metric]) ? `${model[metric] / axisMaximum * 100}%` : "0%" }} /></div>
        </li>)}
      </ul>
    </>}
    <p className="model-error-note">Same scale for both metrics. The selected-model badge comes from the backtest, not from this display toggle. Lower past error does not guarantee a better future forecast.</p>
  </div>;
}
