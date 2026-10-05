"use client";

import type { DashboardViewPayload } from "@/app/lib/dashboard-projection";

import { PictureStrip } from "@/app/components/PictureStrip";
import { formatDate, healthStatusLabel, levelLabel } from "@/app/lib/dashboard-format";
import { InputHealthNotice } from "@/app/components/InputHealthNotice";
import SeriesTrendPanel from "@/app/components/SeriesTrendPanel";
import { useDashboardData } from "@/app/components/DashboardShell";
import type { SeriesData } from "@/app/lib/dashboard";

export function BriefSection({ dashboard, loadSeries }: { dashboard: DashboardViewPayload<"brief"> | null; loadSeries?: (key: string) => Promise<SeriesData> }) {
  const brief = dashboard?.latestBrief;
  const risk = dashboard?.riskHeatmap;
  const inputHealth = dashboard?.inputHealth?.latestBrief;
  return <section className="section brief-section page-section" id="brief"><div className="shell">
    <div className="section-heading"><div><span className="section-number">02 / Brief</span><h1>Latest economic brief</h1></div><p>A concise monthly reading of what changed, why it may have happened, what to watch next, and what it could mean for households and companies.</p></div>
    <PictureStrip pictures={["city", "prices", "markets"]} />
    {!brief ? <div className="brief-empty">{dashboard ? "No validated data is available for this section in the current dataset." : "Loading validated data…"}</div> : <>
      <div className="brief-hero"><div><span className="brief-label">MacroLens-generated briefing</span><h2>{brief.headline}</h2><p>Calculated {formatDate(brief.generatedAt.slice(0, 10))} · CPI period {formatDate(brief.period)}</p></div><em className={`brief-status ${inputHealth?.status ?? brief.status}`}>{healthStatusLabel(dashboard?.usingFallback ? "fallback" : inputHealth?.status ?? brief.status)}</em></div>
      <InputHealthNotice health={inputHealth} />
      {dashboard && <SeriesTrendPanel series={Object.values(dashboard.series)} statuses={Object.fromEntries(Object.entries(dashboard.sources).map(([id, source]) => [id, dashboard.usingFallback ? "fallback" : source.status]))} title="The latest readings in context" defaultKey="headline" loadSeries={loadSeries} />}
      <details className="dashboard-details visual-reading"><summary>Read the economic brief — changes, possible reasons and implications</summary><div className="brief-grid">
        <article><span>What changed recently</span><ul>{brief.whatChanged.map((item) => <li key={item}>{item}</li>)}</ul></article>
        <article><span>Why it may have happened</span><ul>{brief.whyItMayHaveHappened.map((item) => <li key={item}>{item}</li>)}</ul></article>
        <article><span>What to watch next</span><ul>{brief.watchNext.map((item) => <li key={item}>{item}</li>)}</ul></article>
        <article><span>Implications</span><ul>{brief.implications.map((item) => <li key={item}>{item}</li>)}</ul></article>
      </div></details>
      {risk && <div className="brief-risk-link"><span className={`risk-pill ${risk.overallLevel}`}>{levelLabel(risk.overallLevel)}{risk.overallLevel === "unavailable" ? "" : " pressure"}</span><p>{risk.summary}</p><a href="/risk">Open full risk heatmap</a></div>}
      <p className="brief-disclaimer">{brief.disclaimer}</p>
    </>}
  </div></section>;
}


export default function BriefView() {
  const { dashboard, loadHistory } = useDashboardData("brief");
  const loadSeries = async (key: string) => {
    const id = `indicator:${key}`;
    const ref = Object.values(dashboard?.deferred ?? {}).find(item => item?.id === id);
    if (!ref || !ref.id.startsWith("indicator:")) throw new Error("This indicator history is unavailable.");
    const result = await loadHistory(ref);
    if (!("points" in result.data)) throw new Error("The response is not an indicator history.");
    return result.data as SeriesData;
  };
  return <BriefSection dashboard={dashboard} loadSeries={loadSeries} />;
}
