"use client";

import type { DashboardViewPayload } from "@/app/lib/dashboard-projection";

import { type MetricId, type IndicatorData, type DataPoint } from "@/app/lib/dashboard-ui-types";
import { type StructuralCandidate } from "@/app/lib/dashboard";
import { AccessibleCanvasChart } from "@/app/components/AccessibleCanvasChart";
import { formatValue, formatDate, formatP } from "@/app/lib/dashboard-format";
import { useState, useEffect, useMemo } from "react";
import { InputHealthNotice } from "@/app/components/InputHealthNotice";
import { useDashboardData, type DashboardHistoryLoader } from "@/app/components/DashboardShell";
import { DeferredHistoryControl, useDeferredHistory } from "@/app/components/DeferredHistoryControl";

export const structuralLabels: Record<MetricId, string> = {
  headline: "Headline inflation", core: "Core inflation", opr: "OPR",
  unemployment: "Unemployment", fx: "USD / MYR", mgs: "10-year MGS",
};

export function StructuralChart({ data, points, candidates }: { data: IndicatorData; points: DataPoint[]; candidates: StructuralCandidate[] }) {
  return <AccessibleCanvasChart title={`${data.title} structural-break history`} points={points}
    valueLabel={(value) => formatValue(value, data)} axisLabel={(value) => data.unit === "RM" ? value.toFixed(2) : `${value.toFixed(data.decimals)}%`}
    className="structural-chart" colour="var(--series-unemployment)" height={390} candidates={candidates} minimumSpread={data.id === "fx" ? .15 : .5} />;
}

export function StructuralSection({ dashboard, loadHistory }: { dashboard: DashboardViewPayload<"structural"> | null; loadHistory?: DashboardHistoryLoader }) {
  const [selected, setSelected] = useState<MetricId>("core");
  const [range, setRange] = useState<"RECENT" | "10Y" | "25Y" | "ALL">(dashboard?.series.core.history?.complete === false ? "RECENT" : "ALL");
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("indicator");
    if (requested && Object.hasOwn(structuralLabels, requested)) {
      setSelected(requested as MetricId);
      setRange(dashboard?.series[requested].history?.complete === false ? "RECENT" : "ALL");
    }
  }, []);
  const structural = dashboard?.structuralBreaks;
  const analysis = structural?.indicators[selected];
  const ref = dashboard?.deferred?.[`indicator:${selected}`];
  const history = useDeferredHistory(ref, loadHistory);
  const sourceSeries = history.data?.key === selected ? history.data : dashboard?.series[selected];
  const preview = dashboard?.series[selected]?.history;
  const isPreview = Boolean(preview && !preview.complete && history.data?.key !== selected);
  const selectRange = async (next: "10Y" | "25Y" | "ALL") => { if (isPreview && !await history.load()) return; setRange(next); };
  useEffect(() => { if (!isPreview && range === "RECENT") setRange("ALL"); }, [isPreview, range]);
  const series: IndicatorData | undefined = sourceSeries ? {
    id: selected, title: sourceSeries.title, unit: sourceSeries.unit, decimals: sourceSeries.decimals,
    source: sourceSeries.source, sourceUrl: sourceSeries.source_url, frequency: sourceSeries.frequency, points: sourceSeries.points,
  } : undefined;
  const points = useMemo(() => {
    if (!series) return [];
    if (range === "ALL" || range === "RECENT") return series.points;
    const end = new Date(`${series.points.at(-1)?.date}T00:00:00`);
    const start = new Date(end); start.setFullYear(start.getFullYear() - Number(range.replace("Y", "")));
    return series.points.filter((point) => new Date(`${point.date}T00:00:00`) >= start);
  }, [series, range]);
  const candidates = analysis?.candidates ?? [];
  const featured = [...candidates].reverse().find((candidate) => candidate.status === "supported") ?? candidates.at(-1);
  const calculationTime = structural ? new Intl.DateTimeFormat("en-MY", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur" }).format(new Date(structural.calculatedAt)) : "pending";

  return (
    <section className="section structural-section" id="structural">
      <div className="shell">
        <div className="section-heading">
          <div><span className="section-number">10 / Structural shifts</span><h1>When the pattern changed</h1></div>
          <p>Unknown break dates are screened first, then tested with classical and autocorrelation-robust evidence. A nearby event is context—not a causal explanation.</p>
        </div>
        {!structural || !analysis || !series ? <div className="structural-empty">{dashboard ? "No validated data is available for this section in the current dataset." : "Loading validated data…"}</div> : <>
          {(dashboard?.usingFallback || analysis.status !== "fresh") && <InputHealthNotice health={{ status: dashboard?.usingFallback ? "fallback" : "partial", staleInputs: [selected, "opr"].filter((id) => dashboard?.sources[id]?.status !== "fresh"), note: "Saved structural diagnostics are displayed because an input refresh or analysis calculation could not be verified. Break-test evidence and data freshness are separate checks." }} />}
          <div className="structural-toolbar">
            <div className="indicator-tabs" role="tablist" aria-label="Select structural indicator">
              {(Object.keys(structuralLabels) as MetricId[]).map((id) => <button key={id} role="tab" aria-selected={selected === id} disabled={history.loading} className={selected === id ? "active" : ""} onClick={() => { setSelected(id); setRange(dashboard?.series[id].history?.complete === false ? "RECENT" : "ALL"); }}>{structuralLabels[id]}</button>)}
            </div>
            <div className="structural-range" aria-label="Structural chart time frame">{isPreview && <button aria-pressed={true} className="active" onClick={() => setRange("RECENT")}>Recent preview</button>}{(["10Y", "25Y", "ALL"] as const).map((option) => <button key={option} className={range === option ? "active" : ""} aria-pressed={range === option} disabled={history.loading} onClick={() => void selectRange(option)}>{option === "ALL" ? "All history" : option}</button>)}</div>
          </div>

          <div className="structural-summary">
            <div className="structural-finding">
              <div className="finding-top"><span className={`evidence-badge ${featured?.status ?? "none"}`}>{featured?.statusLabel ?? "No break selected"}</span><small>{analysis.screening.selectedBreaks} BIC candidate{analysis.screening.selectedBreaks === 1 ? "" : "s"}</small></div>
              <h2>{featured ? `${structuralLabels[selected]} changed near ${formatDate(featured.breakPeriod)}.` : `${structuralLabels[selected]} is best described by one stable regime.`}</h2>
              <p>{analysis.narrative}</p>
              <div className="finding-meta"><span>Monthly sample: {formatDate(analysis.sample.start)}–{formatDate(analysis.sample.end)}</span><span>{analysis.sample.observations} observations</span><span>Calculated {calculationTime}</span></div>
            </div>
            <div className="evidence-cards">
              <article><span>Chow, Holm p</span><strong>{featured ? formatP(featured.chow.pHolm) : "—"}</strong><small>5% adjusted threshold</small></article>
              <article><span>HAC Wald p</span><strong>{featured ? formatP(featured.hacWald.pValue) : "—"}</strong><small>Newey–West robustness</small></article>
              <article><span>Mean shift</span><strong>{featured ? `${featured.regimeComparison.absoluteChange > 0 ? "+" : ""}${featured.regimeComparison.absoluteChange.toFixed(series.decimals)}` : "—"}</strong><small>{series.unit === "RM" ? "ringgit" : "percentage points"}</small></article>
              <article><span>CUSUM p</span><strong>{formatP(analysis.diagnostics.cusumPValue)}</strong><small>Full-sample stability</small></article>
            </div>
          </div>

          {points.length > 1 && <StructuralChart data={series} points={points} candidates={candidates} />}
          {preview && <DeferredHistoryControl complete={Boolean(history.data?.key === selected) || preview.complete} returnedRows={preview.returnedRows} totalRows={preview.totalRows} loading={history.loading} error={history.error} onLoad={() => void selectRange("ALL")} />}

          {featured && <div className="regime-comparison">
            <article><span>Before regime</span><strong>{formatValue(featured.regimeComparison.preMean, series)}</strong><small>{formatDate(featured.adjacentSample.preStart)}–{formatDate(featured.adjacentSample.preEnd)} · trend {featured.regimeComparison.preAnnualTrend > 0 ? "+" : ""}{featured.regimeComparison.preAnnualTrend.toFixed(series.decimals + 1)}/year</small></article>
            <div className="regime-arrow">→</div>
            <article><span>After regime</span><strong>{formatValue(featured.regimeComparison.postMean, series)}</strong><small>{formatDate(featured.adjacentSample.postStart)}–{formatDate(featured.adjacentSample.postEnd)} · trend {featured.regimeComparison.postAnnualTrend > 0 ? "+" : ""}{featured.regimeComparison.postAnnualTrend.toFixed(series.decimals + 1)}/year</small></article>
            <article className="effect-card"><span>Standardised effect</span><strong>{featured.regimeComparison.standardisedMeanChange?.toFixed(2) ?? "—"}</strong><small>Hedges g; magnitude, not causality</small></article>
          </div>}

          {analysis.warnings.map((warning) => <div className="structural-warning" key={warning}><b>Evidence note</b><span>{warning}</span></div>)}

          <div className="break-table-wrap">
            <div className="break-table-heading"><div><span>Candidate diagnostics</span><h2>Every screened boundary</h2></div><div className="download-links"><a href="/api/structural-breaks?format=csv">Download CSV</a><a href="/api/structural-breaks?format=json">Download JSON</a></div></div>
            {candidates.length ? <table><thead><tr><th>Break</th><th>Evidence</th><th>Chow F (df)</th><th>Raw p</th><th>Holm p</th><th>HAC p</th><th>Mean shift</th></tr></thead><tbody>{candidates.map((candidate) => <tr key={candidate.breakPeriod}><td><strong>{formatDate(candidate.breakPeriod)}</strong><small>{candidate.nearbyEvents.length ? `${candidate.nearbyEvents.length} nearby event${candidate.nearbyEvents.length > 1 ? "s" : ""}` : "No matched event"}</small></td><td><span className={`evidence-badge ${candidate.status}`}>{candidate.statusLabel}</span></td><td>{candidate.chow.fStatistic.toFixed(2)} ({candidate.chow.dfNumerator}, {candidate.chow.dfDenominator})</td><td>{formatP(candidate.chow.pRaw)}</td><td>{formatP(candidate.chow.pHolm)}</td><td>{formatP(candidate.hacWald.pValue)}</td><td>{candidate.regimeComparison.absoluteChange > 0 ? "+" : ""}{candidate.regimeComparison.absoluteChange.toFixed(series.decimals)}</td></tr>)}</tbody></table> : <p className="no-breaks">BIC selected zero breaks, so no post-screening Chow test is reported.</p>}
          </div>

          {!!featured?.nearbyEvents.length && <div className="event-notes"><span className="mini-label">Nearby official events</span>{featured.nearbyEvents.map((event) => <article key={`${event.date}-${event.title}`}><time>{formatDate(event.date)}</time><div><h2>{event.title}</h2><p>The estimated break is within {event.monthDistance} month{event.monthDistance === 1 ? "" : "s"} of this event. Proximity does not demonstrate that the event caused the shift.</p><a href={event.sourceUrl} target="_blank" rel="noreferrer">{event.source} ↗</a></div></article>)}</div>}

          <div className="diagnostic-details">
            <details><summary>Stationarity and residual diagnostics</summary><div><p><b>ADF:</b> statistic {analysis.diagnostics.adfStatistic?.toFixed(3) ?? "—"}, p {formatP(analysis.diagnostics.adfPValue)}, using {analysis.diagnostics.adfLags ?? "—"} lag(s).</p><p><b>CUSUM:</b> statistic {analysis.diagnostics.cusumStatistic?.toFixed(3) ?? "—"}, p {formatP(analysis.diagnostics.cusumPValue)}. CUSUM and local breakpoint tests answer related but different stability questions.</p></div></details>
            <details><summary>Exact model and decision rules</summary><div><p>{structural.methodology.model}. {structural.methodology.screening}. Candidates use {analysis.sample.minimumSegmentMonths}-month minimum regimes.</p><p>{structural.methodology.confirmation}; {structural.methodology.robustness}. “Supported” requires both adjusted Chow and HAC p-values below 0.05; 5–10% or mixed evidence is labelled possible.</p></div></details>
            <details><summary>Interpretation limits</summary><div><p>Break dates were selected from the same sample used for confirmation, so p-values are exploratory conditional diagnostics. Revisions can change dates. Each indicator is tested separately; no economy-wide simultaneous regime is claimed.</p></div></details>
          </div>
        </>}
      </div>
    </section>
  );
}


export default function StructuralView() { const { dashboard, loadHistory } = useDashboardData("structural"); return <StructuralSection dashboard={dashboard} loadHistory={loadHistory} />; }
