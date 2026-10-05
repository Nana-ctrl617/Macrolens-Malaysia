"use client";

import type { DashboardViewPayload } from "@/app/lib/dashboard-projection";

import { formatDate } from "@/app/lib/dashboard-format";
import { PictureStrip } from "@/app/components/PictureStrip";
import { useDashboardData } from "@/app/components/DashboardShell";

export function DataOperations({ dashboard }: { dashboard: DashboardViewPayload<"methodology"> | null }) {
  const operations = dashboard?.dataOperations;
  const releases = operations?.releaseLog ?? [];
  return <section className="operations-panel" aria-labelledby="operations-title">
    <div className="operations-heading"><span>Automated data operations</span><h2 id="operations-title">Daily refresh and CPI log</h2><p>The daily pipeline updates the dashboard. This period-keyed cache supports continuity; the Forecast audit tracks newly captured prospective vintages separately.</p></div>
    <div className="operations-stats"><article><span>Refresh schedule</span><strong>{operations?.schedule ?? "Daily at 13:45 Malaysia time"}</strong></article><article><span>Legacy CPI period files</span><strong>{operations?.vintageCount ?? "Building"}</strong><small>Saved period snapshots are not verified first-release vintages or a real-time backtest.</small></article><article><span>Latest saved CPI period</span><strong>{operations?.latestVintagePeriod ?? "Loading"}</strong></article></div>
    {!!releases.length && <div className="release-log"><div><span>Release period</span><span>Headline</span><span>Core</span></div>{releases.map((item) => <div key={item.period}><strong>{formatDate(item.period)}</strong><b>{item.headline.toFixed(1)}%</b><b>{item.core == null ? "—" : `${item.core.toFixed(1)}%`}</b></div>)}</div>}
  </section>;
}

export function MethodologyContent({ dashboard }: { dashboard: DashboardViewPayload<"methodology"> | null }) { return <section className="section method-section page-section" id="method">
        <div className="shell method-layout">
          <div className="method-intro"><span className="section-number">11 / Method</span><h1>Built to be questioned.</h1><p>A portfolio project is stronger when the assumptions are visible. MacroLens shows how data become a forecast—and where the approach can fail.</p></div>
          <PictureStrip pictures={["research", "trade", "city"]} />
          <ol className="method-list">
            <li><span>01</span><div><h2>Collect</h2><p>Refresh official DOSM and BNM releases, then preserve the last validated cache.</p></div></li>
            <li><span>02</span><div><h2>Align</h2><p>Convert every series to monthly frequency and lag external inputs by one month.</p></div></li>
            <li><span>03</span><div><h2>Backtest</h2><p>Compare seasonal naive, SARIMA and ARIMAX on identical expanding windows.</p></div></li>
            <li><span>04</span><div><h2>Communicate</h2><p>Select the lowest-RMSE model and show both 80% and 95% uncertainty bands.</p></div></li>
          </ol>
        </div>
        <div className="shell"><DataOperations dashboard={dashboard} /></div>
      </section>; }
export default function MethodologyView() { const { dashboard } = useDashboardData("methodology"); return <MethodologyContent dashboard={dashboard} />; }
