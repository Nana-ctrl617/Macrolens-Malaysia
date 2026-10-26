"use client";

import type { DashboardViewPayload } from "@/app/lib/dashboard-projection";

import { PictureStrip } from "@/app/components/PictureStrip";
import { InputHealthNotice } from "@/app/components/InputHealthNotice";
import RiskScoreVisual from "@/app/components/RiskScoreVisual";
import { retrievalTime, formatRiskPeriod, healthStatusLabel, levelLabel } from "@/app/lib/dashboard-format";
import { useDashboardData } from "@/app/components/DashboardShell";
import { useState } from "react";

const RISK_SOURCE_IDS: Record<string, string | string[]> = {
  headline: "headline", core: "core", unemployment: "unemployment", opr: "opr", fx: "fx", mgs: "mgs",
  bursa: "market", growth: ["demand", "growthDrivers.demand"], trade: "externalSector",
};

export function RiskHeatmapSection({ dashboard }: { dashboard: DashboardViewPayload<"risk"> | null }) {
  const [tableOpen, setTableOpen] = useState(false);
  const risk = dashboard?.riskHeatmap;
  const sourceItems = dashboard?.dataHealth?.sources ?? [];
  const riskItems = risk?.items.map(item => ({
    ...item,
    sourceInfo: sourceItems.find(source => {
      const sourceIds = RISK_SOURCE_IDS[item.id];
      return Array.isArray(sourceIds) ? sourceIds.includes(source.id) : source.id === sourceIds;
    }),
    dataStatus: item.score === null || item.level === "unavailable" ? "unavailable" : dashboard?.usingFallback ? "fallback" : item.dataStatus,
  }));
  return <section className="section risk-section page-section" id="risk"><div className="shell">
    <div className="section-heading light"><div><span className="section-number">03 / Risk heatmap</span><h1>Where pressure is building</h1></div><p>Each score is rule-based and auditable. It is a monitoring screen, not a forecast or investment signal.</p></div>
    <PictureStrip pictures={["prices", "markets", "trade"]} />
    {!risk ? <div className="risk-empty">{dashboard ? "No validated data is available for this section in the current dataset." : "Loading validated data…"}</div> : <>
      <InputHealthNotice health={dashboard?.inputHealth?.riskHeatmap} dashboardStatus={dashboard?.health} />
      <p className="visual-page-summary">{risk.summary}</p>
      <RiskScoreVisual items={riskItems ?? []} overallScore={risk.overallScore} overallLevel={risk.overallLevel} availableCount={risk.availableCount} totalCount={risk.totalCount} coverageNote={risk.coverageNote} title="Pressure at a glance" />
      <details className="dashboard-details visual-audit" onToggle={event => setTableOpen(event.currentTarget.open)}><summary>All signals, scoring rules and observation periods</summary><p>{risk.method}</p><p>Calculated {retrievalTime(risk.generatedAt)}. This chart compares published pressure scores, not how the risk evolved over time.</p>
        {tableOpen && <div className="risk-table-wrap"><table><thead><tr><th scope="col">Signal</th><th scope="col">Period / status</th><th scope="col">Score</th><th scope="col">Level</th><th scope="col">Analysis</th><th scope="col">Source</th></tr></thead><tbody>{riskItems?.map((item) => <tr key={item.id}>
          <td data-label="Signal">{item.label}</td>
          <td data-label="Period / status">{formatRiskPeriod(item.id, item.period)}<br />{healthStatusLabel(item.score === null || item.level === "unavailable" ? "unavailable" : dashboard?.usingFallback ? "fallback" : item.dataStatus)}</td>
          <td data-label="Score">{item.score === null ? "Unavailable" : item.score}</td>
          <td data-label="Level"><span className={`risk-pill ${item.level}`}>{levelLabel(item.level)}</span></td>
          <td data-label="Analysis"><details><summary>Evidence and scoring</summary><dl><div><dt>Evidence</dt><dd>{item.evidence}{item.score === null && item.unavailableReason && <p>{item.unavailableReason}</p>}</dd></div><div><dt>Scoring rule</dt><dd>{item.rule}</dd></div><div><dt>What to watch</dt><dd>{item.watch}</dd></div></dl></details></td>
          <td data-label="Source">{item.sourceInfo?.sourceUrl ? <><a href={item.sourceInfo.sourceUrl} target="_blank" rel="noreferrer">{item.sourceInfo.source ?? item.sourceInfo.label ?? "Open source"} ↗</a>{item.sourceInfo.relatedSourceUrl && <><br />Benchmark reference: <a href={item.sourceInfo.relatedSourceUrl} target="_blank" rel="noreferrer">{item.sourceInfo.relatedSource ?? "Index provider"} ↗</a></>}{item.sourceInfo.retrievedAt ? <small>Last successful retrieval: {retrievalTime(item.sourceInfo.retrievedAt)} MYT</small> : item.sourceInfo.lastAttemptAt ? <small>Last refresh attempt: {retrievalTime(item.sourceInfo.lastAttemptAt)} MYT; no successful retrieval is recorded.</small> : <small>Retrieval time not recorded.</small>}</> : <a href="/health">Source details unavailable · open Data Health</a>}</td>
        </tr>)}</tbody></table></div>}
      </details>
    </>}
  </div></section>;
}


export default function RiskView() { const { dashboard } = useDashboardData("risk"); return <RiskHeatmapSection dashboard={dashboard} />; }
