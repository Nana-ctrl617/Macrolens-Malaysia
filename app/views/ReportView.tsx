"use client";

import type { DashboardViewPayload } from "@/app/lib/dashboard-projection";

import { formatDate } from "@/app/lib/dashboard-format";
import { useDashboardData } from "@/app/components/DashboardShell";

export function MonthlyReportSection({ dashboard }: { dashboard: DashboardViewPayload<"report"> | null }) {
  const report = dashboard?.monthlyReport;
  return <section className="section deep-section report-section page-section" id="report"><div className="shell">
    <div className="section-heading"><div><span className="section-number">15 / Report</span><h1>Latest generated report</h1></div><p>A recruiter-friendly written summary generated from the same validated dashboard payload.</p></div>
    {!report ? <div className="deep-empty">{dashboard ? "No validated data is available for this section in the current dataset." : "Loading validated data…"}</div> : <>
      <div className="deep-hero"><div><span>{formatDate(report.generatedAt.slice(0, 10))}</span><strong>{report.title}</strong></div><p>{report.summary ?? `Generated for ${report.period ? formatDate(report.period) : "the latest validated release"}.`}</p></div>
      <div className="report-grid">{report.sections.map((section) => <article key={section.heading}><h2>{section.heading}</h2>{section.bullets?.length ? <ul>{section.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul> : <p>{section.body}</p>}</article>)}</div>
      <div className="report-downloads">{report.downloads.map((item) => <a key={item.href ?? item.url} href={item.href ?? item.url}><span>{item.format ?? "Data"}</span>{item.label}</a>)}<a href="/api/report"><span>JSON</span>Generated report API</a></div>
      <p className="deep-disclaimer">{report.disclaimer}</p>
    </>}
  </div></section>;
}


export default function ReportView() { const { dashboard } = useDashboardData("report"); return <MonthlyReportSection dashboard={dashboard} />; }
