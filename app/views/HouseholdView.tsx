"use client";

import type { DashboardViewPayload } from "@/app/lib/dashboard-projection";

import { type HouseholdPressure } from "@/app/lib/dashboard";
import { formatDate } from "@/app/lib/dashboard-format";
import { PictureStrip } from "@/app/components/PictureStrip";
import { InputHealthNotice } from "@/app/components/InputHealthNotice";
import RiskScoreVisual from "@/app/components/RiskScoreVisual";
import { useDashboardData } from "@/app/components/DashboardShell";

export function HouseholdPressureSection({ dashboard }: { dashboard: DashboardViewPayload<"household"> | null }) {
  const household: HouseholdPressure | undefined = dashboard?.householdPressure;
  const householdSignals = household?.components.map((item) => {
    const sourceIds: Record<string, string[]> = { "cost-of-living": ["headline", "core"], "debt-service": ["opr"], "job-income": ["unemployment"], "imported-spending": ["fx"] };
    const sources = (sourceIds[item.id] ?? []).map((id) => dashboard?.sources[id]).filter((source) => source != null);
    const market = item.id === "wealth-risk" ? dashboard?.market : undefined;
    const period = market?.summary.latestDate ? formatDate(market.summary.latestDate) : sources.length ? [...new Set(sources.map((source) => formatDate(source.observationPeriod)))].join(" / ") : "Not recorded";
    const dataStatus = dashboard?.usingFallback ? "fallback" : market ? market.status : sources.length ? sources.every((source) => source.status === "fresh") ? "fresh" : "stale" : "unavailable";
    const validScore = typeof item.score === "number" && Number.isFinite(item.score);
    return { ...item, group: "Households", level: item.level ?? (validScore ? item.score! >= 70 ? "high" as const : item.score! >= 45 ? "moderate" as const : "low" as const : "unavailable" as const), unavailableReason: item.unavailableReason ?? (validScore ? null : "Required data for this pressure signal is unavailable."), period, rule: "Published household pressure screen; not a personal affordability score.", dataStatus: validScore ? dataStatus : "unavailable" };
  }) ?? [];
  return <section className="section deep-section household-section page-section" id="household"><div className="shell">
    <div className="section-heading"><div><span className="section-number">10 / Households</span><h1>Household pressure monitor</h1></div><p>Turns the macro dashboard into household-relevant pressure checks: cost of living, debt service, jobs, imported spending and market wealth.</p></div>
    <PictureStrip pictures={["household", "prices", "markets"]} />
    {!household ? <div className="deep-empty">{dashboard ? "No validated data is available for this section in the current dataset." : "Loading validated data…"}</div> : <>
      <InputHealthNotice health={dashboard?.inputHealth?.householdPressure} />
      <p className="visual-page-summary">{household.summary}</p>
      <RiskScoreVisual title="Household pressure comparison" overallScore={household.overallScore} overallLevel={household.overallLevel} items={householdSignals} />
      <details className="dashboard-details visual-reading"><summary>Household scenario checks and important limits</summary><div className="scenario-grid">{household.scenarios.map((item) => <article key={item.id ?? item.title}><span>Scenario check</span><h2>{item.title}</h2><p>{item.prompt}</p><p>{item.limit}</p></article>)}</div></details>
      <p className="deep-disclaimer">{household.disclaimer}</p>
    </>}
  </div></section>;
}


export default function HouseholdView() { const { dashboard } = useDashboardData("household"); return <HouseholdPressureSection dashboard={dashboard} />; }
