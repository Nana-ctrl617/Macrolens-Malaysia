"use client";

import { useId, useRef, useState } from "react";
import type { RiskItem } from "../lib/dashboard";
import { weightedPressure } from "../lib/score-method";
import "./RiskScoreVisual.css";

type Props = {items: RiskItem[]; overallScore: number; overallLevel: "low" | "moderate" | "high"; title?: string};
const pressureLabel = (level: RiskItem["level"]) => `${level[0].toUpperCase()}${level.slice(1)} pressure`;
const scoreLabel = (score: number) => Number.isFinite(score) ? score.toFixed(1) : "Not available";
const statusLabel = (status?: string) => status ? `${status[0].toUpperCase()}${status.slice(1)}` : "Status not supplied";

export default function RiskScoreVisual({items, overallScore, overallLevel, title = "Pressure at a glance"}: Props) {
  const id = useId();
  const [selectedId,setSelectedId] = useState(items[0]?.id ?? "");
  const [view,setView] = useState<"bars" | "matrix">("bars");
  const [multiplier,setMultiplier] = useState(1);
  const evidenceRef = useRef<HTMLDivElement>(null);
  const selected = items.find(item => item.id === selectedId) ?? items[0];
  const detailId = `${id}-evidence`;
  if (!items.length) return <section className="score-visual"><h2>{title}</h2><p>No validated pressure scores are available for this view.</p></section>;
  const accessibleLabel = (item: RiskItem) => `${item.label}: ${scoreLabel(item.score)} out of 100. ${pressureLabel(item.level)}. Observation period: ${item.period}. Data status: ${statusLabel(item.dataStatus)}. Show evidence.`;
  const selectSignal = (key: string) => {
    setSelectedId(key); setMultiplier(1);
    if (window.matchMedia("(max-width:1000px)").matches) requestAnimationFrame(() => evidenceRef.current?.scrollIntoView({block:"start",behavior:"auto"}));
  };
  const alternative = weightedPressure(items,selected.id,multiplier);
  return <section className="score-visual" aria-labelledby={`${id}-title`}>
    <div className="score-visual-heading"><div><h2 id={`${id}-title`}>{title}</h2><p>Rule-based pressure screen, not a probability of a crisis or loss. Select a signal to inspect its evidence.</p></div><p className="score-visual-overall">Overall <strong>{scoreLabel(overallScore)} / 100</strong><span>{pressureLabel(overallLevel)}</span></p></div>
    <p className="score-visual-method">Each of the {items.length} published components has equal weight ({(100/items.length).toFixed(1)}%). The overall score is their mean, rounded to one decimal. These rules and weights are not calibrated probabilities; inflation, rates and market signals can overlap.</p>
    <div className="score-visual-layout">
      <div ref={evidenceRef} id={detailId} className="score-visual-evidence" role="region" aria-label="Selected signal evidence">
        <div aria-live="polite" aria-atomic="true">
          <div className="score-visual-evidence-title"><h3>{selected.label}</h3><span className={`score-visual-selected-level ${selected.level}`}>{pressureLabel(selected.level)} · {scoreLabel(selected.score)} / 100</span></div>
          <dl><div><dt>Evidence</dt><dd>{selected.evidence}</dd></div><div><dt>Scoring rule</dt><dd>{selected.rule}</dd></div><div><dt>What to watch</dt><dd>{selected.watch}</dd></div></dl>
          <p className="score-visual-source">Observation period: <strong>{selected.period}</strong><span>Data status: <strong>{statusLabel(selected.dataStatus)}</strong></span></p>
          <p className="score-visual-method">Contribution to the overall screen: <strong>{(selected.score/items.length).toFixed(2)} points</strong> ({selected.score.toFixed(1)} ÷ {items.length}).</p>
        </div>
        <details className="score-weight-check"><summary>Check sensitivity to this signal&apos;s weight</summary><label htmlFor={`${id}-weight`}>Exploratory weight for {selected.label}</label><select id={`${id}-weight`} value={multiplier} onChange={event => setMultiplier(Number(event.target.value))}><option value="1">Equal weight — published method</option><option value="0.5">Half weight</option><option value="2">Double weight</option><option value="0">Exclude this component</option></select><p aria-live="polite">Exploratory weighted mean: <strong>{alternative == null ? "Unavailable" : alternative.toFixed(1)} / 100</strong>. Other components retain weight 1; weights are renormalised. This does not change the published score, remove overlap, or validate a new risk model.</p></details>
      </div>
      <div className="score-visual-comparison">
        <div className="score-view-controls" role="group" aria-label="Pressure chart view"><button type="button" aria-pressed={view === "bars"} onClick={() => setView("bars")}>Ranked bars</button><button type="button" aria-pressed={view === "matrix"} onClick={() => setView("matrix")}>Heatmap</button></div>
        {view === "matrix" ? <div className="score-visual-map" role="group" aria-label="Interactive pressure heatmap">{items.map(item => <button key={item.id} type="button" className={`score-visual-cell ${item.level}`} aria-label={accessibleLabel(item)} aria-pressed={selected.id === item.id} aria-controls={detailId} onClick={() => selectSignal(item.id)}><span className="score-visual-label">{item.label}</span><strong>{scoreLabel(item.score)}<small> / 100</small></strong><span className="score-visual-level">{pressureLabel(item.level)}</span><span className="score-visual-status">{statusLabel(item.dataStatus)}</span></button>)}</div> : <>
          <h3>Compare pressure scores</h3><p className="score-visual-axis-label">0 to 100 · higher means more pressure under the published rules</p>
          <div className="score-visual-axis-row" aria-hidden="true"><span /><div className="score-visual-axis">{[0,25,50,75,100].map(tick => <span key={tick} style={{left:`${tick}%`}}>{tick}</span>)}</div><span /></div>
          <ol className="score-visual-bars" aria-label="Score comparison">{[...items].sort((a,b) => b.score-a.score).map(item => <li key={item.id}><button type="button" className={`score-visual-bar-row ${item.level}`} aria-label={accessibleLabel(item)} aria-pressed={selected.id === item.id} aria-controls={detailId} onClick={() => selectSignal(item.id)}><span className="score-visual-bar-label">{item.label}</span><span className="score-visual-track" aria-hidden="true"><span className="score-visual-fill" style={{width:`${Math.max(0,Math.min(100,item.score))}%`}} /></span><span className="score-visual-bar-value">{scoreLabel(item.score)}<span>{item.level}</span></span></button></li>)}</ol>
        </>}
      </div>
    </div>
  </section>;
}
