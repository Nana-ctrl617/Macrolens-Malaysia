"use client";

import { useMemo, useState } from "react";

import type { DashboardViewPayload } from "@/app/lib/dashboard-projection";

import { healthStatusLabel, formatDate, retrievalTime } from "@/app/lib/dashboard-format";
import { useDashboardData } from "@/app/components/DashboardShell";

export function DataHealthSection({ dashboard }: { dashboard: DashboardViewPayload<"health"> | null }) {
  const health = dashboard?.dataHealth;
  const [sourceFilter, setSourceFilter] = useState<"all" | "attention" | "validated">("all");
  const sourceCounts = useMemo(() => ({
    all: health?.sources.length ?? 0,
    attention: health?.sources.filter((source) => source.status !== "fresh").length ?? 0,
    validated: health?.sources.filter((source) => source.status === "fresh").length ?? 0,
  }), [health?.sources]);
  const visibleSources = useMemo(() => (health?.sources ?? [])
    .filter((source) => sourceFilter === "all" || (sourceFilter === "attention" ? source.status !== "fresh" : source.status === "fresh"))
    .map((source, index) => ({ source, index }))
    .sort((a, b) => (a.source.status === "fresh" ? 1 : 0) - (b.source.status === "fresh" ? 1 : 0) || a.index - b.index)
    .map(({ source }) => source), [health?.sources, sourceFilter]);
  return <section className="section deep-section health-section page-section" id="health"><div className="shell">
    <div className="section-heading light"><div><span className="section-number">16 / Data health</span><h1>Source freshness and validation audit</h1></div><p>Shows whether the dashboard is fresh, stale or using fallback data. Cached data is never labelled as live.</p></div>
    {!health ? <div className="deep-empty">{dashboard ? "No validated data is available for this section in the current dataset." : "Loading validated data…"}</div> : <>
      <div className="deep-hero"><div><span>Schema version {health.schemaVersion}</span><strong>{healthStatusLabel(health.overall)}</strong><b className={`risk-pill ${health.overall}`}>{health.staleCount} source groups need attention</b></div><p>{health.note}</p></div>
      <p className="health-recency-note">Age limits are conservative checks, not official release calendars. “No fixed age limit” means this source is checked using retrieval and coverage rules; it does not mean it updates daily. Status describes the latest validation recorded in this dashboard.</p>
      <div className="health-source-toolbar"><div className="health-source-filters" role="group" aria-label="Filter data-health sources">
        <button type="button" aria-pressed={sourceFilter === "all"} className={sourceFilter === "all" ? "active" : ""} onClick={() => setSourceFilter("all")}>All sources <span>{sourceCounts.all}</span></button>
        <button type="button" aria-pressed={sourceFilter === "attention"} className={sourceFilter === "attention" ? "active" : ""} onClick={() => setSourceFilter("attention")}>Needs attention <span>{sourceCounts.attention}</span></button>
        <button type="button" aria-pressed={sourceFilter === "validated"} className={sourceFilter === "validated" ? "active" : ""} onClick={() => setSourceFilter("validated")}>Last validation successful <span>{sourceCounts.validated}</span></button>
      </div><span className="health-source-count" role="status">Showing {visibleSources.length} of {sourceCounts.all} source groups</span></div>
      {visibleSources.length === 0 ? <div className="health-filter-empty">No source groups need attention in the saved validation results.</div> : <div className="deep-table-wrap"><table><thead><tr><th>Source</th><th>Status</th><th>Observation period</th><th>Recency check</th><th>Last successful retrieval</th><th>Last refresh attempt</th><th>Message</th></tr></thead><tbody>{visibleSources.map((source) => <tr key={source.id}><td><strong>{source.label ?? source.id}</strong>{source.source && <small className="health-source-publisher">Published by {source.source}</small>}{source.sourceUrl && <a className="health-source-link" href={source.sourceUrl} target="_blank" rel="noreferrer">{source.id === "market" ? "Open delayed price data ↗" : "Open dataset or source page ↗"}</a>}{source.relatedSource && <small className="health-source-publisher">Index reference: {source.relatedSource}</small>}{source.relatedSourceUrl && <a className="health-source-link" href={source.relatedSourceUrl} target="_blank" rel="noreferrer">Open index publisher reference ↗</a>}</td><td><span className={`risk-pill ${source.status}`}>{source.status}</span></td><td>{source.period || source.observationPeriod ? formatDate(source.period ?? source.observationPeriod ?? "") : "—"}</td><td>{source.freshness ? <span title={source.freshness.note}>{source.freshness.observationAgeDays} days old / {source.freshness.maximumObservationAgeDays}-day limit</span> : <span title="This source is assessed using its retrieval result, official observation period, or source-specific coverage checks rather than a simple age threshold.">No fixed age limit</span>}</td><td>{retrievalTime(source.retrievedAt)}</td><td>{retrievalTime(source.lastAttemptAt)}</td><td>{source.message}</td></tr>)}</tbody></table></div>}
    </>}
  </div></section>;
}


export default function HealthView() { const { dashboard } = useDashboardData("health"); return <DataHealthSection dashboard={dashboard} />; }
