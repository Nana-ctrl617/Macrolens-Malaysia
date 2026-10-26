"use client";

import { useMemo, useState } from "react";

import type { DashboardViewPayload } from "@/app/lib/dashboard-projection";

import { healthStatusLabel, formatDate, retrievalTime } from "@/app/lib/dashboard-format";
import { useDashboardData } from "@/app/components/DashboardShell";

export function DataHealthSection({ dashboard }: { dashboard: DashboardViewPayload<"health"> | null }) {
  const health = dashboard?.dataHealth;
  const mgsHistory = health?.mgsDailyHistory;
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
      <div className="deep-hero"><div><span>Schema version {health.schemaVersion}</span><strong>{healthStatusLabel(health.overall)}</strong><b className={`risk-pill ${health.overall}`}>{health.staleCount} source group{health.staleCount === 1 ? " needs" : "s need"} attention</b></div><div><p>{health.note}</p><p className="health-validation-time"><strong>Last dashboard validation:</strong> {retrievalTime(health.generatedAt)}</p></div></div>
      {mgsHistory && <section className={`mgs-history-coverage ${mgsHistory.status}`} aria-labelledby="mgs-history-coverage-title">
        <div className="mgs-history-heading"><div><h2 id="mgs-history-coverage-title">10-year MGS daily-history coverage</h2><p>{mgsHistory.completed ? "The historical backfill has reached its current target." : "The latest close is available; this status tracks how far the continuous historical check has reached."}</p></div><span className={`risk-pill ${mgsHistory.status}`}>{mgsHistory.completed ? "History check complete" : "Backfill in progress"}</span></div>
        <ol className="mgs-history-timeline" aria-label="MGS history dates">
          <li><span>Backfill begins</span><time dateTime={mgsHistory.startDate}>{mgsHistory.startDate ? formatDate(mgsHistory.startDate) : "Not recorded"}</time></li>
          <li><span>Daily dates verified through</span><time dateTime={mgsHistory.throughDate ?? undefined}>{mgsHistory.throughDate ? formatDate(mgsHistory.throughDate) : "No dates verified yet"}</time></li>
          <li><span>Latest close in dashboard</span><time dateTime={mgsHistory.latestObservationDate || undefined}>{mgsHistory.latestObservationDate ? formatDate(mgsHistory.latestObservationDate) : "Not available"}</time></li>
        </ol>
        <p className="mgs-history-detail">{mgsHistory.completed ? "A checked date can have no yield when markets were closed; the count below records source requests and returned closes separately." : "The latest close and historical coverage are different checks. Dates after the verified-through point have not yet been confirmed as a continuous daily history."} {mgsHistory.requests !== null && mgsHistory.observations !== null ? `${mgsHistory.requests.toLocaleString("en-MY")} weekday dates checked · ${mgsHistory.observations.toLocaleString("en-MY")} official daily closes returned.` : "Backfill request counts are not available in this saved snapshot."}</p>
        {mgsHistory.completed
          ? <p className="mgs-history-checkpoint"><strong>Complete history retrieval:</strong> {retrievalTime(mgsHistory.retrievedAt)}. This records the successful validation of the completed historical download.</p>
          : <p className="mgs-history-checkpoint"><strong>Coverage checkpoint:</strong> {retrievalTime(mgsHistory.retrievedAt)}. This records when the backfill progress was saved; it is not evidence that the full historical download completed.</p>}
      </section>}
      <p className="health-recency-note">Age limits are conservative checks, not official release calendars. “No fixed age limit” means this source is checked using retrieval and coverage rules; it does not mean it updates daily. Status describes the latest validation recorded in this dashboard. <a href="https://github.com/Nana-ctrl617/Macrolens-Malaysia/actions/workflows/update-dashboard.yml" target="_blank" rel="noreferrer">View automated update runs ↗</a></p>
      <div className="health-source-toolbar"><div className="health-source-filters" role="group" aria-label="Filter data-health sources">
        <button type="button" aria-pressed={sourceFilter === "all"} className={sourceFilter === "all" ? "active" : ""} onClick={() => setSourceFilter("all")}>All sources <span>{sourceCounts.all}</span></button>
        <button type="button" aria-pressed={sourceFilter === "attention"} className={sourceFilter === "attention" ? "active" : ""} onClick={() => setSourceFilter("attention")}>Needs attention <span>{sourceCounts.attention}</span></button>
        <button type="button" aria-pressed={sourceFilter === "validated"} className={sourceFilter === "validated" ? "active" : ""} onClick={() => setSourceFilter("validated")}>Last validation successful <span>{sourceCounts.validated}</span></button>
      </div><span className="health-source-count" role="status">Showing {visibleSources.length} of {sourceCounts.all} source groups</span></div>
      {visibleSources.length === 0 ? <div className="health-filter-empty">No source groups need attention in the saved validation results.</div> : <div className="deep-table-wrap"><table><thead><tr><th>Source</th><th>Status</th><th>Observation period</th><th>Recency check</th><th>Last successful retrieval</th><th>Last refresh / checkpoint</th><th>Message</th></tr></thead><tbody>{visibleSources.map((source) => <tr key={source.id}><td><strong>{source.label ?? source.id}</strong>{source.source && <small className="health-source-publisher">Published by {source.source}</small>}{source.sourceUrl && <a className="health-source-link" href={source.sourceUrl} target="_blank" rel="noreferrer">{source.id === "market" ? "Open delayed price data ↗" : "Open dataset or source page ↗"}</a>}{source.relatedSource && <small className="health-source-publisher">Index reference: {source.relatedSource}</small>}{source.relatedSourceUrl && <a className="health-source-link" href={source.relatedSourceUrl} target="_blank" rel="noreferrer">Open index publisher reference ↗</a>}</td><td><span className={`risk-pill ${source.status}`}>{source.status}</span></td><td>{source.period || source.observationPeriod ? formatDate(source.period ?? source.observationPeriod ?? "") : "—"}</td><td>{source.freshness ? <span title={source.freshness.note}>{source.freshness.observationAgeDays} days since {source.freshness.reference === "period-end" ? "period end" : "observation"} / {source.freshness.maximumObservationAgeDays}-day limit</span> : <span title="This source is assessed using its retrieval result, official observation period, or source-specific coverage checks rather than a simple age threshold.">No fixed age limit</span>}</td><td>{retrievalTime(source.retrievedAt)}</td><td>{source.id === "mgsDailyHistory" && source.lastAttemptAt ? <>Coverage checkpoint: {retrievalTime(source.lastAttemptAt)}</> : retrievalTime(source.lastAttemptAt)}</td><td>{source.message}</td></tr>)}</tbody></table></div>}
    </>}
  </div></section>;
}


export default function HealthView() { const { dashboard } = useDashboardData("health"); return <DataHealthSection dashboard={dashboard} />; }
