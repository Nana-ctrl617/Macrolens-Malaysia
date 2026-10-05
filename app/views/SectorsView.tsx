"use client";

import type { DashboardViewPayload } from "@/app/lib/dashboard-projection";

import { type SectorDeepDive } from "@/app/lib/dashboard";
import { signedPercent } from "@/app/lib/dashboard-format";
import { useDashboardData } from "@/app/components/DashboardShell";

export function SectorDeepDiveSection({ dashboard }: { dashboard: DashboardViewPayload<"sectors"> | null }) {
  const deep: SectorDeepDive | undefined = dashboard?.sectorDeepDive;
  return <section className="section deep-section sectors-section page-section" id="sectors"><div className="shell">
    <div className="section-heading"><div><span className="section-number">11 / Sector deep dive</span><h1>How sectors connect to markets and external demand</h1></div><p>Uses the latest production-side GDP structure and links each sector to export sensitivity, Bursa exposure and dashboard risk conditions.</p></div>
    {!deep ? <div className="deep-empty">{dashboard ? "No validated data is available for this section in the current dataset." : "Loading validated data…"}</div> : <>
      <div className="deep-hero"><div><span>Reference year</span><strong>{deep.year}</strong><b className={`risk-pill ${deep.status}`}>{deep.status}</b></div><p>{deep.summary}</p></div>
      <div className="sector-deep-grid">{deep.sectors.map((sector) => <article key={sector.id} className={`sector-deep-card ${sector.riskLevel}`}><div><span>{sector.name}</span><b>{sector.share.toFixed(1)}%</b></div><p>{sector.narrative}</p><dl><div><dt>Value</dt><dd>RM {sector.value.toFixed(1)}bn</dd></div><div><dt>Growth</dt><dd>{sector.changeYoY == null ? "—" : signedPercent(sector.changeYoY)}</dd></div><div><dt>Contribution</dt><dd>{sector.growthContribution == null ? "—" : `${sector.growthContribution.toFixed(1)}%`}</dd></div><div><dt>Market link</dt><dd>{sector.marketLink}</dd></div></dl></article>)}</div>
    </>}
  </div></section>;
}


export default function SectorsView() { const { dashboard } = useDashboardData("sectors"); return <SectorDeepDiveSection dashboard={dashboard} />; }
