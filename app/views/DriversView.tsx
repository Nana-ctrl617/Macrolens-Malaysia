"use client";

import type { DashboardViewPayload } from "@/app/lib/dashboard-projection";

import { useState } from "react";
import { PictureStrip } from "@/app/components/PictureStrip";
import { formatDate } from "@/app/lib/dashboard-format";
import { useDashboardData } from "@/app/components/DashboardShell";

export function DriversSection({ dashboard }: { dashboard: DashboardViewPayload<"drivers"> | null }) {
  const [view, setView] = useState<"contribution" | "rate">("contribution");
  const categories = dashboard?.categories ?? [];
  const ordered = [...categories].sort((a, b) => Math.abs((view === "contribution" ? b.contribution : b.value) ?? 0) - Math.abs((view === "contribution" ? a.contribution : a.value) ?? 0));
  const maximum = Math.max(...ordered.map((item) => Math.abs((view === "contribution" ? item.contribution : item.value) ?? 0)), .1);
  const decomposition = dashboard?.cpiDecomposition;
  const estimatedTotal = decomposition?.estimatedTotal ?? (categories.length && categories.every(item => item.contribution != null) ? categories.reduce((sum, item) => sum + item.contribution!, 0) : null);
  const headline = decomposition?.headline ?? dashboard?.series.headline.points.at(-1)?.value ?? null;
  const gap = decomposition?.reconciliationGap ?? (headline != null && estimatedTotal != null ? headline - estimatedTotal : null);
  return <section className="section shell page-section" id="drivers">
    <div className="section-heading"><div><span className="section-number">05 / Drivers</span><h1>What contributes to inflation</h1></div><p>Official 2022 expenditure weights reveal how much each CPI division matters—not only which category has the fastest price growth.</p></div>
    <PictureStrip pictures={["prices", "household", "research"]} />
    {!dashboard ? <p>Loading validated data…</p> : <>
    <div className="driver-summary"><article><span>Headline inflation</span><strong>{headline == null ? "Unavailable" : `${headline.toFixed(2)}%`}</strong></article><article><span>Weighted division estimate</span><strong>{estimatedTotal == null ? "Unavailable" : `${estimatedTotal.toFixed(2)} pp`}</strong></article><article><span>Chain-index gap</span><strong>{gap == null ? "Unavailable" : `${gap > 0 ? "+" : ""}${gap.toFixed(2)} pp`}</strong></article></div>
    <div className="driver-view-switch" role="group" aria-label="Choose driver measure"><button className={view === "contribution" ? "active" : ""} aria-pressed={view === "contribution"} onClick={() => setView("contribution")}>Weighted contribution</button><button className={view === "rate" ? "active" : ""} aria-pressed={view === "rate"} onClick={() => setView("rate")}>Category inflation rate</button></div>
    <div className="drivers-layout">
      <div className="category-card weighted">
        <div className="category-columns"><span>Division</span><span>{view === "contribution" ? "Contribution estimate" : "Inflation rate"}</span></div>
        {ordered.map((item) => {
          const measure = view === "contribution" ? item.contribution : item.value;
          return <div className="category-row" key={item.code}><span>{item.name}<small>Official basket weight {item.weight == null ? "Unavailable" : `${item.weight.toFixed(1)}%`}</small></span><div aria-hidden="true">{measure != null && <i className={measure < 0 ? "negative" : ""} style={{ width: `${Math.abs(measure) / maximum * 100}%` }} />}</div><b>{measure == null ? "Unavailable" : `${measure > 0 ? "+" : ""}${measure.toFixed(view === "contribution" ? 2 : 1)}${view === "contribution" ? " pp" : "%"}`}</b></div>;
        })}
        <small className="source-note">DOSM expenditure weights reference 2022 · CPI basket effective January 2024 · Monthly rates through {dashboard ? formatDate(dashboard.sources.headline.observationPeriod) : "latest release"}</small>
      </div>
      <div className="meaning-column">
        <article><span>Why weights matter</span><h2>A large category can move headline inflation even with a moderate rate.</h2><p>Contribution combines each division&apos;s year-on-year inflation rate with its share of the household basket.</p></article>
        <article><span>Reconciliation</span><h2>The estimates may not add exactly to headline CPI.</h2><p>Malaysia uses a chained CPI. MacroLens shows the gap instead of forcing the components to equal the headline rate.</p></article>
        <article><span>Interpretation</span><h2>Contribution describes arithmetic, not causation.</h2><p>A category&apos;s contribution shows where measured inflation is concentrated; it does not establish why prices changed.</p></article>
        <a className="official-method-link" href={decomposition?.sourceUrl ?? "https://storage.dosm.gov.my/cpi/cpi_2025-07.pdf"} target="_blank" rel="noreferrer">Official DOSM weights and technical notes ↗</a>
      </div>
    </div>
    </>}
  </section>;
}


export default function DriversView() { const { dashboard } = useDashboardData("drivers"); return <DriversSection dashboard={dashboard} />; }
