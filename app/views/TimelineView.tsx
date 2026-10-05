"use client";

import type { DashboardViewPayload } from "@/app/lib/dashboard-projection";

import { type MacroTimeline } from "@/app/lib/dashboard";
import { formatDate } from "@/app/lib/dashboard-format";
import { useDashboardData, type DashboardHistoryLoader } from "@/app/components/DashboardShell";
import { DeferredHistoryControl, useDeferredHistory } from "@/app/components/DeferredHistoryControl";

export function MacroTimelineSection({ dashboard, loadHistory }: { dashboard: DashboardViewPayload<"timeline"> | null; loadHistory?: DashboardHistoryLoader }) {
  const ref = dashboard?.deferred?.["timeline-history"];
  const history = useDeferredHistory(ref, loadHistory);
  const timeline: MacroTimeline | undefined = history.data ?? dashboard?.macroTimeline;
  return <section className="section deep-section timeline-section page-section" id="timeline"><div className="shell">
    <div className="section-heading light"><div><span className="section-number">13 / Timeline</span><h1>Macro event and evidence timeline</h1></div><p>Combines verified event dates, detected structural breaks and latest market observations in one chronological audit trail.</p></div>
    {!timeline ? <div className="deep-empty">{dashboard ? "No validated data is available for this section in the current dataset." : "Loading validated data…"}</div> : <>
      <div className="timeline-list">{[...timeline.entries].sort((a, b) => b.date.localeCompare(a.date)).map((entry) => <article key={`${entry.date}-${entry.title}`}><time>{formatDate(entry.date)}</time><div><span>{entry.category}</span><h2>{entry.title}</h2><p>{entry.evidence}</p><small>{entry.interpretation ?? "Context marker only; proximity does not prove causation."}</small><a href={entry.sourceUrl} target="_blank" rel="noreferrer">{entry.source} ↗</a></div></article>)}</div>
      {ref && <DeferredHistoryControl complete={Boolean(history.data) || timeline.entries.length === ref.totalRows} returnedRows={dashboard?.macroTimeline?.entries.length ?? 0} totalRows={ref.totalRows} loading={history.loading} error={history.error} onLoad={history.load} />}
      <p className="deep-disclaimer">{timeline.note}</p>
    </>}
  </div></section>;
}


export default function TimelineView() { const { dashboard, loadHistory } = useDashboardData("timeline"); return <MacroTimelineSection dashboard={dashboard} loadHistory={loadHistory} />; }
