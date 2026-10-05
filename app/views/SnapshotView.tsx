"use client";

import type { DashboardViewPayload } from "@/app/lib/dashboard-projection";

import { type Metric, type DataPoint, type MetricId } from "@/app/lib/dashboard-ui-types";
import { useId, useRef, useState, useEffect, useMemo, lazy, Suspense } from "react";
import { formatObservationDate } from "@/app/lib/visual-data";
import { isChartInspectionKey, nextChartIndex } from "@/app/lib/chart-inspection";
import { formatDate, levelLabel } from "@/app/lib/dashboard-format";
import { inflationDefinitions } from "@/app/lib/inflation-definitions";
import { useDashboardData, type DashboardHistoryLoader } from "@/app/components/DashboardShell";

export const metrics = [
  { id: "headline", label: "Headline inflation", detail: "Full CPI basket, year on year", tone: "rust" },
  { id: "core", label: "Core inflation", detail: "Underlying price pressure", tone: "teal" },
  { id: "opr", label: "Overnight Policy Rate", detail: "BNM policy setting", tone: "navy" },
  { id: "unemployment", label: "Unemployment", detail: "Share of labour force", tone: "teal" },
  { id: "fx", label: "USD / MYR", detail: "Monthly average", tone: "navy" },
  { id: "mgs", label: "10-year MGS", detail: "Government bond yield", tone: "rust" },
];

export function MetricCard({ metric, onSelect }: { metric: Metric; onSelect: (metric: Metric) => void }) {
  return (
    <button
      className={`metric-card ${metric.tone}`}
      onClick={() => onSelect(metric)}
      aria-label={`Open historical data for ${metric.label}. ${metric.value}. Release period: ${metric.period}. Data status: ${metric.status ?? "loading"}.`}
    >
      <div className="metric-topline"><span>{metric.label}</span><i /></div>
      <strong>{metric.value}</strong>
      <p>{metric.detail}</p>
      <div className="metric-footer">
        <small>Release period · {metric.period}</small>
        {metric.status && <span className={`metric-status ${metric.status}`}>{metric.status}</span>}
        <span className="metric-open">View history <b>↗</b></span>
      </div>
    </button>
  );
}

export function SnapshotHeadlineChart({ points }: { points: DataPoint[] }) {
  const id = useId();
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const describe = (point: DataPoint) => `${formatObservationDate(point.date, "Monthly")}: ${Number.isFinite(point.value) ? `${point.value.toFixed(1)}%` : "Unavailable"}`;
  const reading = selected != null && points[selected] ? describe(points[selected]) : "No observation selected.";
  const values = points.map((point) => point.value).filter(Number.isFinite);
  const minimum = Math.min(0, ...values), maximum = Math.max(2.3, ...values), span = maximum - minimum;
  const baseline = -minimum / span * 100;
  const labels = points.filter((_, index) => index === 0 || index === points.length - 1 || index % Math.max(1, Math.floor(points.length / 6)) === 0).map((point) => formatObservationDate(point.date, "Monthly"));
  return <div data-chart-kind="snapshot" role="group" aria-label="Latest headline inflation history">
    <div className="bar-chart" style={{ gridTemplateColumns: `repeat(${Math.max(1, points.length)},minmax(0,1fr))` }}>
      {points.map((point, index) => <button type="button" className="bar-column" key={point.date}
        ref={(element) => { buttons.current[index] = element; }} tabIndex={(selected ?? points.length - 1) === index ? 0 : -1}
        aria-label={describe(point)} aria-pressed={selected === index} aria-describedby={`${id}-help ${id}-reading`}
        onFocus={() => setSelected(index)} onPointerMove={() => setSelected(index)} onClick={() => setSelected(index)}
        onKeyDown={(event) => {
          if (!isChartInspectionKey(event.key)) return;
          event.preventDefault();
          const next = nextChartIndex(event.key, index, points.length);
          setSelected(next);
          if (next != null) buttons.current[next]?.focus();
        }}>
        <i aria-hidden="true" style={{ position: "absolute", height: `${Number.isFinite(point.value) ? Math.abs(point.value) / span * 100 : 0}%`, bottom: `${baseline + (point.value < 0 ? point.value / span * 100 : 0)}%` }} />
        <span aria-hidden="true">{index === points.length - 1 && Number.isFinite(point.value) ? `${point.value.toFixed(1)}%` : ""}</span>
      </button>)}
    </div>
    <div className="chart-axis" aria-hidden="true">{labels.map((label) => <span key={label}>{label}</span>)}</div>
    <p id={`${id}-help`} className="chart-inspection-help">Hover or tap a bar, use Left/Right arrows and Home/End, or choose an observation below. Escape clears the selection.</p>
    <p id={`${id}-reading`} className="chart-inspection-status" role="status" aria-live="polite" aria-atomic="true">{points.length ? reading : "No published observations available."}</p>
    {points.length > 0 && <label className="chart-inspection-controls">Observation
      <input type="range" min={0} max={points.length - 1} value={selected ?? points.length - 1} aria-label="Headline inflation observation" aria-valuetext={reading}
        onChange={(event) => setSelected(Number(event.currentTarget.value))} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setSelected(null); } }} />
    </label>}
  </div>;
}

const IndicatorDetail = lazy(() => import("@/app/components/IndicatorDetail"));
export function SnapshotContent({ dashboard, loadHistory }: { dashboard: DashboardViewPayload<"snapshot"> | null; loadHistory?: DashboardHistoryLoader }) {
const [selectedMetric, setSelectedMetric] = useState<Metric | null>(null);
const loadSeries = async (id: MetricId) => {
  const ref = dashboard?.deferred?.[`indicator:${id}`];
  if (!ref || !loadHistory) throw new Error("This indicator history is unavailable.");
  return (await loadHistory(ref)).data;
};
const loadComparison = async () => {
  if (!dashboard) throw new Error("The summary is unavailable.");
  const entries = await Promise.all((Object.keys(dashboard.series) as MetricId[]).map(async id => [id, await loadSeries(id)] as const));
  return { ...dashboard, series: Object.fromEntries(entries) };
};
useEffect(() => {
    
    const legacyRoutes: Record<string, string> = { "#brief": "/brief", "#news": "/news", "#risk": "/risk", "#forecast": "/forecast", "#drivers": "/drivers", "#structure": "/structure", "#external": "/external", "#bop": "/bop", "#household": "/household", "#regional": "/regional", "#sectors": "/sectors", "#bursa": "/bursa", "#decisions": "/decisions", "#timeline": "/timeline", "#structural": "/structural", "#report": "/report", "#health": "/health", "#method": "/methodology" };
    const target = legacyRoutes[window.location.hash];
    if (target) window.location.replace(target);
  }, []);
const liveMetrics: Metric[] = useMemo(() => {
    if (!dashboard) return metrics.map((metric) => ({ ...metric, value: "—", period: "Loading" })) as Metric[];
    const details: Record<MetricId, string> = {
      headline: "Full CPI basket, year on year", core: "Underlying price pressure", opr: "BNM policy setting",
      unemployment: "Share of labour force", fx: "Monthly end rate", mgs: "Government bond yield",
    };
    const tones: Record<MetricId, string> = { headline: "rust", core: "teal", opr: "navy", unemployment: "teal", fx: "navy", mgs: "rust" };
    return (["headline", "core", "opr", "unemployment", "fx", "mgs"] as MetricId[]).map((id) => {
      const series = dashboard.series[id];
      const last = series.points[series.points.length - 1];
      const value = series.unit === "RM" ? `RM ${last.value.toFixed(series.decimals)}` : `${last.value.toFixed(series.decimals)}${series.unit}`;
      const daily = /day|trading/i.test(series.frequency);
      const period = new Intl.DateTimeFormat("en-MY", daily ? { day: "numeric", month: "short", year: "numeric" } : { month: "short", year: "numeric" }).format(new Date(`${last.date}T00:00:00`));
      return { id, label: id === "mgs" ? "10-year MGS" : series.title, value, detail: details[id], period, tone: tones[id], status: dashboard.usingFallback ? "fallback" : dashboard.sources[id]?.status };
    });
  }, [dashboard]);
const headlinePoints = dashboard?.series.headline.points.slice(-22) ?? [];
const updatedAt = dashboard ? new Intl.DateTimeFormat("en-MY", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur" }).format(new Date(dashboard.dataOperations?.lastSuccessfulRefresh ?? dashboard.generatedAt)) : "loading";
return <><>
      <section className="section snapshot-section shell" id="snapshot">
        <div className="section-heading">
          <div><span className="section-number">01 / Snapshot</span><h1>Malaysia’s economy at a glance</h1></div>
          <p>Track the latest signals across prices, interest rates, jobs, the ringgit and government bonds—with official data and clear explanations.</p>
        </div>
        <div className="snapshot-meta">
          <span>Last successful refresh · {updatedAt}</span>
          <div className={`data-status ${dashboard?.usingFallback ? "fallback" : dashboard?.health || "loading"}`}><span /> {dashboard?.usingFallback ? "Last validated snapshot · live source temporarily unavailable" : dashboard ? `Official data · ${dashboard.health}` : "Loading validated data"}</div>
        </div>
        <div className="metrics-grid">{liveMetrics.map((metric) => <MetricCard key={metric.label} metric={metric} onSelect={setSelectedMetric} />)}</div>
        <div className="trend-card">
          <div className="card-heading"><div><span>Headline inflation</span><h2>The recent path</h2></div><div className="legend"><i /> Year-on-year change</div></div>
          <SnapshotHeadlineChart points={headlinePoints} />
          <div className="interpretation"><b>How to read this</b><p>{dashboard?.narratives.snapshot ?? "Loading the latest validated inflation interpretation."}</p></div>
          <small className="source-note">Source: DOSM via data.gov.my · Monthly data through {dashboard ? formatDate(dashboard.sources.headline.observationPeriod) : "the latest release"}</small>
        </div>
        <div className="snapshot-completion" aria-label="Explore related analysis">
          <a href="/brief"><span>Latest brief ↗</span><strong>What changed recently</strong><small>Possible reasons, what to watch and decision context.</small></a>
          <a href="/news"><span>Latest headlines ↗</span><strong>Malaysia economy news</strong><small>Recent coverage of prices, policy, markets, trade and jobs.</small></a>
          <a href="/risk"><span>Risk heatmap ↗</span><strong>{dashboard?.riskHeatmap ? dashboard.riskHeatmap.overallScore === null ? "Unavailable" : `${levelLabel(dashboard.riskHeatmap.overallLevel)} pressure · ${dashboard.riskHeatmap.overallScore.toFixed(1)}` : "Risk screen loading"}</strong><small>Inspect the evidence behind the rule-based pressure scores.</small></a>
          <a href="/regional"><span>Regional Lens ↗</span><strong>Compare Malaysia’s states</strong><small>Income, spending, poverty, jobs, CPI and sector mix by place.</small></a>
        </div>
        <details className="dashboard-details snapshot-definitions">
          <summary>Headline versus core inflation — definitions and reading guide</summary>
          <aside className="inflation-primer" aria-labelledby="inflation-primer-title">
            <div className="primer-heading"><span>Quick guide</span><h2 id="inflation-primer-title">Headline versus core inflation</h2></div>
            <article><strong>Headline inflation</strong><p>{inflationDefinitions.headline.short} {inflationDefinitions.headline.explanation}</p></article>
            <article><strong>Core inflation</strong><p>{inflationDefinitions.core.short} {inflationDefinitions.core.explanation}</p></article>
            <p className="primer-summary"><strong>The difference:</strong> headline describes price changes across the full household basket; core helps reveal the steadier underlying trend. Neither is better—they answer different questions.</p>
          </aside>
        </details>
      </section>
      </>{selectedMetric && <Suspense fallback={<p className="dashboard-load-status shell" role="status">Loading historical data…</p>}><IndicatorDetail metric={selectedMetric} dashboard={dashboard} onClose={() => setSelectedMetric(null)} loadSeries={loadHistory ? loadSeries : undefined} loadComparison={loadHistory ? loadComparison : undefined} /></Suspense>}</>;
}
export default function SnapshotView() { const { dashboard, loadHistory } = useDashboardData("snapshot"); return <SnapshotContent dashboard={dashboard} loadHistory={loadHistory} />; }
