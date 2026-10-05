"use client";

import type { DashboardViewPayload } from "@/app/lib/dashboard-projection";

import { PictureStrip } from "@/app/components/PictureStrip";
import { InputHealthNotice } from "@/app/components/InputHealthNotice";
import RiskScoreVisual from "@/app/components/RiskScoreVisual";
import { retrievalTime, formatDate, healthStatusLabel, levelLabel } from "@/app/lib/dashboard-format";
import { useDashboardData } from "@/app/components/DashboardShell";
import { useState } from "react";

export function RiskHeatmapSection({ dashboard }: { dashboard: DashboardViewPayload<"risk"> | null }) {
  const [tableOpen, setTableOpen] = useState(false);
  const risk = dashboard?.riskHeatmap;
  return <section className="section risk-section page-section" id="risk"><div className="shell">
    <div className="section-heading light"><div><span className="section-number">03 / Risk heatmap</span><h1>Where pressure is building</h1></div><p>Each score is rule-based and auditable. It is a monitoring screen, not a forecast or investment signal.</p></div>
    <PictureStrip pictures={["prices", "markets", "trade"]} />
    {!risk ? <div className="risk-empty">{dashboard ? "No validated data is available for this section in the current dataset." : "Loading validated data…"}</div> : <>
      <InputHealthNotice health={dashboard?.inputHealth?.riskHeatmap} />
      <p className="visual-page-summary">{risk.summary}</p>
      <RiskScoreVisual items={risk.items.map((item) => ({ ...item, dataStatus: item.score === null || item.level === "unavailable" ? "unavailable" : dashboard?.usingFallback ? "fallback" : item.dataStatus }))} overallScore={risk.overallScore} overallLevel={risk.overallLevel} availableCount={risk.availableCount} totalCount={risk.totalCount} coverageNote={risk.coverageNote} title="Pressure at a glance" />
      <details className="dashboard-details visual-audit" onToggle={event => setTableOpen(event.currentTarget.open)}><summary>All signals, scoring rules and observation periods</summary><p>{risk.method}</p><p>Calculated {retrievalTime(risk.generatedAt)}. This chart compares published pressure scores, not how the risk evolved over time.</p>
        {tableOpen && <div className="risk-table-wrap"><table><thead><tr><th>Signal</th><th>Period / status</th><th>Score</th><th>Level</th><th>Evidence</th><th>Scoring rule</th><th>What to watch</th></tr></thead><tbody>{risk.items.map((item) => <tr key={item.id}><td>{item.label}</td><td>{item.period ? formatDate(item.period) : "Not recorded"}<br />{healthStatusLabel(item.score === null || item.level === "unavailable" ? "unavailable" : dashboard?.usingFallback ? "fallback" : item.dataStatus)}</td><td>{item.score === null ? "Unavailable" : item.score}</td><td><span className={`risk-pill ${item.level}`}>{levelLabel(item.level)}</span></td><td>{item.evidence}{item.score === null && item.unavailableReason && <p>{item.unavailableReason}</p>}</td><td>{item.rule}</td><td>{item.watch}</td></tr>)}</tbody></table></div>}
      </details>
    </>}
  </div></section>;
}


export default function RiskView() { const { dashboard } = useDashboardData("risk"); return <RiskHeatmapSection dashboard={dashboard} />; }
