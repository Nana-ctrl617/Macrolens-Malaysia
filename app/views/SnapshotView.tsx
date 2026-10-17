"use client";

import type { DashboardViewPayload } from "@/app/lib/dashboard-projection";

import { type Metric, type DataPoint, type MetricId } from "@/app/lib/dashboard-ui-types";
import { useCallback, useId, useRef, useState, useEffect, useMemo, lazy, Suspense } from "react";
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
  { id: "mgs", label: "10-year government bond yield", detail: "Malaysian Government Securities (MGS)", tone: "rust" },
];

export function MetricCard({ metric, onSelect }: { metric: Metric; onSelect: (metric: Metric) => void }) {
  const sourceStatus = metric.status === "stale" ? "Stale" : metric.status === "fallback" ? "Fallback" : metric.status === "fresh" ? "Validated" : "Status unavailable";
  return (
    <article className={`metric-card ${metric.tone}`}>
      <button
        className="metric-card-action"
        onClick={() => onSelect(metric)}
        aria-label={`Open history for ${metric.label}. ${metric.value}. Release period: ${metric.period}. Data status: ${sourceStatus}.`}
      >
        <div className="metric-topline"><span>{metric.label}</span><i /></div>
        <strong>{metric.value}</strong>
        <p>{metric.detail}</p>
        <div className="metric-footer">
          <small>Release period · {metric.period}</small>
          {metric.validationLabel && <small className="metric-validation-time">{metric.validationLabel}</small>}
          <span className={`metric-status ${metric.status ?? "unavailable"}`}>{sourceStatus}</span>
          <span className="metric-open">Open history</span>
        </div>
      </button>
      {metric.source && metric.sourceUrl && <div className="metric-provenance">
        <a className="metric-source-link" href={metric.sourceUrl} target="_blank" rel="noreferrer" aria-label={`Source: ${metric.source}`}>
          Source: {metric.source} <span aria-hidden="true">↗</span>
        </a>
        {metric.sourceNote && <small className="metric-source-note">{metric.sourceNote}</small>}
      </div>}
    </article>
  );
}

export function SnapshotHeadlineChart({ points, loading = false }: { points: DataPoint[]; loading?: boolean }) {
  const id = useId();
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const describe = (point: DataPoint) => `${formatObservationDate(point.date, "Monthly")}: ${Number.isFinite(point.value) ? `${point.value.toFixed(1)}%` : "Unavailable"}`;
  const reading = selected != null && points[selected] ? describe(points[selected]) : "No observation selected.";
  const values = points.map((point) => point.value).filter(Number.isFinite);
  const minimum = Math.min(0, ...values), maximum = Math.max(2.3, ...values), span = maximum - minimum;
  const baseline = -minimum / span * 100;
  const labels = points.filter((_, index) => index === 0 || index === points.length - 1 || index % Math.max(1, Math.floor(points.length / 6)) === 0).map((point) => formatObservationDate(point.date, "Monthly"));
  return <div data-chart-kind="snapshot" role="group" aria-label={loading ? "Loading latest headline inflation history" : "Latest headline inflation history"}>
    {points.length ? <>
      <div className="bar-chart" style={{ gridTemplateColumns: `repeat(${points.length},minmax(0,1fr))` }}>
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
    </> : <div className="snapshot-chart-empty" aria-hidden="true">{loading ? "Loading monthly observations…" : "No published observations"}</div>}
    <p id={`${id}-help`} className="chart-inspection-help">{points.length ? "Hover or tap a bar, use Left/Right arrows and Home/End, or choose an observation below. Escape clears the selection." : loading ? "Headline inflation history is loading; point inspection will be available when observations arrive." : "No observations are available to inspect in this snapshot."}</p>
    <p id={`${id}-reading`} className="chart-inspection-status" role="status" aria-live="polite" aria-atomic="true">{loading ? "Loading headline inflation observations…" : points.length ? reading : "No published observations available."}</p>
    {points.length > 0 && <label className="chart-inspection-controls">Observation
      <input type="range" min={0} max={points.length - 1} value={selected ?? points.length - 1} aria-label="Headline inflation observation" aria-valuetext={reading}
        onChange={(event) => setSelected(Number(event.currentTarget.value))} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setSelected(null); } }} />
    </label>}
  </div>;
}

const IndicatorDetail = lazy(() => import("@/app/components/IndicatorDetail"));

export function SnapshotPricePressures({ dashboard }: { dashboard: DashboardViewPayload<"snapshot"> | null }) {
  const categories = dashboard?.categories ?? [];
  const ranked = categories.filter((item) => Number.isFinite(item.contribution) && item.contribution! > 0)
    .sort((a, b) => (b.contribution ?? 0) - (a.contribution ?? 0));
  const top = ranked.slice(0, 3);
  const maximum = Math.max(...top.map((item) => item.contribution ?? 0), 0.01);
  const decomposition = dashboard?.cpiDecomposition;
  const period = decomposition?.observationPeriod ? formatObservationDate(decomposition.observationPeriod, "Monthly") : "period unavailable";
  const status = dashboard?.usingFallback ? "fallback" : decomposition?.calculationStatus ?? dashboard?.sources.headline?.status ?? "unavailable";
  const offsets = categories.filter((item) => Number.isFinite(item.contribution) && item.contribution! < 0)
    .sort((a, b) => (a.contribution ?? 0) - (b.contribution ?? 0));
  return <section className="snapshot-price-pressures" aria-labelledby="snapshot-price-pressures-title">
    <div className="snapshot-pressure-heading">
      <div><h3 id="snapshot-price-pressures-title">Where price pressure is concentrated</h3><p>Largest upward CPI division contributions · {period}</p></div>
      <span className={`snapshot-pressure-status ${status}`}>{status === "fresh" ? "Validated estimate" : status === "stale" ? "Last validated estimate" : status === "fallback" ? "Saved estimate" : "Estimate unavailable"}</span>
    </div>
    {top.length ? <ol className="snapshot-pressure-list">
      {top.map((item) => <li key={item.code} aria-label={`${item.name}: ${item.value.toFixed(1)} percent category inflation, ${item.weight == null ? "basket weight unavailable" : `${item.weight.toFixed(1)} percent basket weight`}, contribution estimate plus ${item.contribution!.toFixed(2)} percentage points`}>
        <div className="snapshot-pressure-copy"><strong>{item.name}</strong><small>{item.value.toFixed(1)}% category inflation · {item.weight == null ? "Weight unavailable" : `${item.weight.toFixed(1)}% basket weight`}</small></div>
        <div className="snapshot-pressure-track" aria-hidden="true"><i style={{ width: `${(item.contribution! / maximum) * 100}%` }} /></div>
        <b className="snapshot-pressure-value">+{item.contribution!.toFixed(2)} pp</b>
      </li>)}
    </ol> : <p className="snapshot-pressure-empty">A validated category breakdown is not available for this snapshot.</p>}
    {offsets.length > 0 && <p className="snapshot-pressure-offset">Largest downward offset: {offsets[0].name} ({offsets[0].contribution!.toFixed(2)} pp).</p>}
    <p className="snapshot-pressure-caveat">Division inflation comes from DOSM’s monthly CPI data. Contributions are estimates using DOSM’s {decomposition?.weightReferenceYear ?? "published"} basket weights (effective {decomposition?.effectiveFrom ?? "period unavailable"}); they show where measured inflation is concentrated, not why prices changed. Chained CPI means estimates may not sum exactly to headline inflation.</p>
    <a className="snapshot-pressure-source" href="https://open.dosm.gov.my/data-catalogue/cpi_headline_inflation" target="_blank" rel="noreferrer">OpenDOSM division inflation data ↗</a>
    {decomposition?.sourceUrl && <a className="snapshot-pressure-source" href={decomposition.sourceUrl} target="_blank" rel="noreferrer">DOSM weight reference & method ({decomposition?.weightReferenceYear ?? "CPI"} weights) ↗</a>}
    <a className="snapshot-pressure-more" href="/drivers">Explore all CPI divisions and the calculation ↗</a>
  </section>;
}

export function SnapshotContent({ dashboard, loadHistory }: { dashboard: DashboardViewPayload<"snapshot"> | null; loadHistory?: DashboardHistoryLoader }) {
const [selectedMetric, setSelectedMetric] = useState<Metric | null>(null);
const loadSeries = useCallback(async (id: MetricId) => {
  const ref = dashboard?.deferred?.[`indicator:${id}`];
  if (!ref || !loadHistory) throw new Error("This indicator history is unavailable.");
  return (await loadHistory(ref)).data;
}, [dashboard, loadHistory]);
const loadComparison = useCallback(async () => {
  if (!dashboard) throw new Error("The summary is unavailable.");
  const entries = await Promise.all((Object.keys(dashboard.series) as MetricId[]).map(async id => [id, await loadSeries(id)] as const));
  return { ...dashboard, series: Object.fromEntries(entries) };
}, [dashboard, loadSeries]);
useEffect(() => {
    
    const legacyRoutes: Record<string, string> = { "#brief": "/brief", "#news": "/news", "#risk": "/risk", "#forecast": "/forecast", "#drivers": "/drivers", "#structure": "/structure", "#external": "/external", "#bop": "/bop", "#household": "/household", "#regional": "/regional", "#sectors": "/sectors", "#bursa": "/bursa", "#decisions": "/decisions", "#timeline": "/timeline", "#structural": "/structural", "#report": "/report", "#health": "/health", "#method": "/methodology" };
    const target = legacyRoutes[window.location.hash];
    if (target) window.location.replace(target);
  }, []);
const liveMetrics: Metric[] = useMemo(() => {
    if (!dashboard) return metrics.map((metric) => ({ ...metric, value: "—", period: "Loading" })) as Metric[];
    const details: Record<MetricId, string> = {
      headline: "Full CPI basket, year on year", core: "Underlying price pressure", opr: "BNM policy setting",
      unemployment: "Share of labour force", fx: "Monthly end rate", mgs: "Malaysian Government Securities (MGS)",
    };
    const tones: Record<MetricId, string> = { headline: "rust", core: "teal", opr: "navy", unemployment: "teal", fx: "navy", mgs: "rust" };
    return (["headline", "core", "opr", "unemployment", "fx", "mgs"] as MetricId[]).map((id) => {
      const series = dashboard.series[id];
      const last = series.points[series.points.length - 1];
      const value = series.unit === "RM" ? `RM ${last.value.toFixed(series.decimals)}` : `${last.value.toFixed(series.decimals)}${series.unit}`;
      const daily = /day|trading/i.test(series.frequency);
      const period = new Intl.DateTimeFormat("en-MY", daily ? { day: "numeric", month: "short", year: "numeric" } : { month: "short", year: "numeric" }).format(new Date(`${last.date}T00:00:00`));
      const status = dashboard.usingFallback ? "fallback" : dashboard.sources[id]?.status;
      const retrievedAt = dashboard.sources[id]?.retrievedAt;
      const parsedRetrievedAt = retrievedAt ? new Date(retrievedAt) : null;
      const validationDate = parsedRetrievedAt && Number.isFinite(parsedRetrievedAt.getTime()) ? new Intl.DateTimeFormat("en-MY", {
        day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur",
      }).format(parsedRetrievedAt) : null;
      const validationLabel = validationDate
        ? `${status === "stale" || status === "fallback" ? "Last validated" : "Retrieved"} · ${validationDate}`
        : "Validation time unavailable";
      const sourceNote = status === "fallback"
        ? "Live data unavailable; showing the bundled, last-validated dashboard snapshot."
        : status === "stale"
          ? "The latest refresh did not pass; showing the last validated observation."
          : undefined;
      return { id, label: id === "mgs" ? "10-year government bond yield" : series.title, value, detail: details[id], period, tone: tones[id], status, source: series.source, sourceUrl: series.source_url, sourceNote, validationLabel };
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
          <div className={`data-status ${dashboard?.usingFallback ? "fallback" : dashboard?.health || "loading"}`}><span /> {dashboard?.usingFallback ? "Last validated snapshot · live source temporarily unavailable" : dashboard ? `Dashboard sources · ${dashboard.health}` : "Loading validated data"}</div>
        </div>
        <div className="metrics-grid">{liveMetrics.map((metric) => <MetricCard key={metric.label} metric={metric} onSelect={setSelectedMetric} />)}</div>
        <div className="trend-card">
          <div className="card-heading"><div><span>Headline inflation</span><h2>The recent path</h2></div><div className="legend"><i /> Year-on-year change</div></div>
          <div className="snapshot-inflation-analysis"><SnapshotHeadlineChart points={headlinePoints} loading={!dashboard} /><SnapshotPricePressures dashboard={dashboard} /></div>
          <div className="interpretation"><b>Latest reading</b><p>{dashboard?.narratives.snapshot ?? "Loading the latest validated inflation interpretation."}</p></div>
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
