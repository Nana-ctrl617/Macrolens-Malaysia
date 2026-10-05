"use client";

import type { DashboardViewPayload } from "@/app/lib/dashboard-projection";

import { healthStatusLabel, formatDate, retrievalTime } from "@/app/lib/dashboard-format";
import { useDashboardData } from "@/app/components/DashboardShell";

export function DataHealthSection({ dashboard }: { dashboard: DashboardViewPayload<"health"> | null }) {
  const health = dashboard?.dataHealth;
  return <section className="section deep-section health-section page-section" id="health"><div className="shell">
    <div className="section-heading light"><div><span className="section-number">16 / Data health</span><h1>Source freshness and validation audit</h1></div><p>Shows whether the dashboard is fresh, stale or using fallback data. Cached data is never labelled as live.</p></div>
    {!health ? <div className="deep-empty">{dashboard ? "No validated data is available for this section in the current dataset." : "Loading validated data…"}</div> : <>
      <div className="deep-hero"><div><span>Schema version {health.schemaVersion}</span><strong>{healthStatusLabel(health.overall)}</strong><b className={`risk-pill ${health.overall}`}>{health.staleCount} stale</b></div><p>{health.note}</p></div>
      <div className="deep-table-wrap"><table><thead><tr><th>Source</th><th>Status</th><th>Observation period</th><th>Last successful retrieval</th><th>Last refresh attempt</th><th>Message</th></tr></thead><tbody>{health.sources.map((source) => <tr key={source.id}><td>{source.label ?? source.id}</td><td><span className={`risk-pill ${source.status}`}>{source.status}</span></td><td>{source.period || source.observationPeriod ? formatDate(source.period ?? source.observationPeriod ?? "") : "—"}</td><td>{retrievalTime(source.retrievedAt)}</td><td>{retrievalTime(source.lastAttemptAt)}</td><td>{source.message}</td></tr>)}</tbody></table></div>
    </>}
  </div></section>;
}


export default function HealthView() { const { dashboard } = useDashboardData("health"); return <DataHealthSection dashboard={dashboard} />; }
