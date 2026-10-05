"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { SeriesData } from "@/app/lib/dashboard";
import type { PreviewScope } from "@/app/lib/dashboard-projection";
import { isChartInspectionKey, nextChartIndex } from "../lib/chart-inspection.ts";
import { indicatorColourTokens } from "../lib/chart-colours.ts";
import {
  buildTrendPath, formatMetricChange, formatMetricValue, formatObservationDate, linearScale,
  nearestPointIndex, numericDomain, observationWindow, pointEpoch, prepareSeriesPoints,
  segmentSeries, trendChange, type ObservationRange,
} from "@/app/lib/visual-data";
import "./SeriesTrendPanel.css";

type SeriesTrendPanelProps = {
  series: Array<SeriesData & { history?: PreviewScope }>;
  loadSeries?: (key: string) => Promise<SeriesData>;
  statuses?: Record<string, string>;
  title?: string;
  defaultKey?: string;
  limit?: number;
  compact?: boolean;
};

const palette = indicatorColourTokens;
const ranges: ObservationRange[] = ["1Y", "3Y", "All"];
const HISTORY_PAGE_SIZE = 50;

export function SeriesTrendPanel({ series, loadSeries, statuses = {}, title = "Explore the data over time", defaultKey, limit, compact = false }: SeriesTrendPanelProps) {
  const id = useId();
  const [loadedHistory, setLoadedHistory] = useState<Record<string, SeriesData>>({});
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const requestVersion = useRef(0);
  const retryHistoryRequest = useRef<() => void>(() => {});
  useEffect(() => () => { requestVersion.current++; }, []);
  const available = useMemo(() => {
    const valid = series.filter((item) => item?.key && Array.isArray(item.points)).map(item => loadedHistory[item.key] ?? item);
    return Number.isInteger(limit) && limit! > 0 ? valid.slice(0, limit) : valid;
  }, [series, limit, loadedHistory]);
  const [chosen, setChosen] = useState(defaultKey ?? available[0]?.key ?? "");
  const [range, setRange] = useState<ObservationRange>("1Y");
  const [inspectionIndex, setInspectionIndex] = useState(-1);
  const [inspectionVisible, setInspectionVisible] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyPagination, setHistoryPagination] = useState({ key: "", range: "1Y" as ObservationRange, page: 0 });
  const [chartNode, setChartNode] = useState<SVGSVGElement | null>(null);
  const [chartLayout, setChartLayout] = useState({ width: 800, fontSize: 14 });
  useEffect(() => {
    if (!chartNode) return;
    const measure = () => {
      const width = chartNode.getBoundingClientRect().width;
      if (!Number.isFinite(width) || width <= 0) return;
      const rootSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const bodySize = Number.parseFloat(getComputedStyle(document.body).fontSize) || 16;
      const fontSize = Math.max(14, Math.max(rootSize, bodySize) * 14 / 16);
      setChartLayout((previous) => previous.width === width && previous.fontSize === fontSize ? previous : { width, fontSize });
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(chartNode);
    observer?.observe(document.body);
    const textSizeObserver = typeof MutationObserver === "undefined" ? null : new MutationObserver(measure);
    textSizeObserver?.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class"] });
    textSizeObserver?.observe(document.body, { attributes: true, attributeFilter: ["style", "class"] });
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); textSizeObserver?.disconnect(); window.removeEventListener("resize", measure); };
  }, [chartNode]);
  const active = available.find((item) => item.key === chosen) ?? available[0];
  const prepared = useMemo(() => prepareSeriesPoints(active?.points), [active?.points]);
  const points = useMemo(() => observationWindow(prepared.points, range), [prepared.points, range]);
  const historyPageCount = Math.max(1, Math.ceil(points.length / HISTORY_PAGE_SIZE));
  const historyPage = historyPagination.key === active?.key && historyPagination.range === range
    ? Math.max(0, Math.min(historyPagination.page, historyPageCount - 1)) : 0;
  const historyStart = historyPage * HISTORY_PAGE_SIZE;
  const historyRows = historyOpen ? points.slice(historyStart, historyStart + HISTORY_PAGE_SIZE) : [];
  const domain = useMemo(() => numericDomain(points.map((point) => point.value)), [points]);
  const change = trendChange(points);
  const selectedIndex = inspectionIndex < 0 ? points.length - 1 : Math.min(inspectionIndex, points.length - 1);
  const inspected = points[selectedIndex];
  const status = active ? statuses[active.key] : undefined;
  const nonFresh = Boolean(status && status !== "fresh");
  const axisLabel = (tick: number) => tick.toLocaleString("en-MY", { maximumFractionDigits: Math.min(6, Math.max(active?.decimals ?? 2, 2)) });
  const longestTick = Math.max(1, ...(domain?.ticks ?? []).map((tick) => axisLabel(tick).length));
  const staggerDates = chartLayout.width < 480;
  const geometry = {
    width: chartLayout.width,
    height: Math.max(chartLayout.width / 800 * (compact ? 245 : 285), chartLayout.fontSize * 11 + 52),
    left: Math.max(chartLayout.width >= 640 ? 110 : 54, longestTick * chartLayout.fontSize * 0.62 + 18),
    right: Math.max(25, chartLayout.fontSize), top: Math.max(20, chartLayout.fontSize * 1.4),
    bottom: Math.max(40, chartLayout.fontSize * (staggerDates ? 4 : 2.5)),
  };
  const axisStyle = { fontSize: chartLayout.fontSize };
  const firstEpoch = points.length ? pointEpoch(points[0].date)! : 0;
  const lastEpoch = points.length ? pointEpoch(points[points.length - 1].date)! : 0;
  const x = (epoch: number) => linearScale(epoch, firstEpoch, lastEpoch, geometry.left, geometry.width - geometry.right);
  const y = (value: number) => linearScale(value, domain?.min ?? 0, domain?.max ?? 1, geometry.height - geometry.bottom, geometry.top);
  const color = palette[active?.key ?? ""] ?? "var(--series-core)";
  const plottedPath = active && domain ? buildTrendPath(points, active.frequency, x, y) : "";
  const segments = active ? segmentSeries(points, active.frequency) : [];
  const pointValue = (value: number) => formatMetricValue(value, active.unit, active.decimals);
  const pointDate = (date: string) => formatObservationDate(date, active.frequency);
  const isPreview = (key: string) => !loadedHistory[key] && series.find(item => item.key === key)?.history?.complete === false;
  const fetchHistory = async (key: string, commit: () => void) => {
    if (!loadSeries || !isPreview(key)) { commit(); return; }
    const version = ++requestVersion.current;
    retryHistoryRequest.current = () => { void fetchHistory(key, commit); };
    setHistoryLoading(true); setHistoryError("");
    try {
      const full = await loadSeries(key);
      if (version !== requestVersion.current) return;
      setLoadedHistory(previous => ({ ...previous, [key]: full })); commit();
    } catch (error) {
      if (version === requestVersion.current) setHistoryError(error instanceof Error ? error.message : "Detailed observations could not be loaded. Try again; the validated preview remains visible.");
    } finally { if (version === requestVersion.current) setHistoryLoading(false); }
  };
  const commitSeries = (key: string) => { setChosen(key); setInspectionIndex(-1); setInspectionVisible(true); setHistoryPagination({ key, range, page: 0 }); };
  const pickSeries = (key: string) => { void fetchHistory(key, () => commitSeries(key)); };
  const commitRange = (next: ObservationRange) => { setRange(next); setInspectionIndex(-1); setInspectionVisible(true); setHistoryPagination({ key: active?.key ?? "", range: next, page: 0 }); };
  const pickRange = (next: ObservationRange) => {
    if (active && next !== "1Y") void fetchHistory(active.key, () => commitRange(next));
    else commitRange(next);
  };
  const inspectPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (!points.length) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width || !Number.isFinite(event.clientX)) return;
    const plotX = (event.clientX - bounds.left) / bounds.width * geometry.width;
    const epoch = linearScale(Math.max(geometry.left, Math.min(geometry.width - geometry.right, plotX)), geometry.left, geometry.width - geometry.right, firstEpoch, lastEpoch);
    setInspectionIndex(nearestPointIndex(points, epoch));
    setInspectionVisible(true);
  };
  const inspectKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!points.length || !isChartInspectionKey(event.key)) return;
    event.preventDefault();
    const next = nextChartIndex(event.key, selectedIndex, points.length);
    if (next === null) setInspectionVisible(false);
    else { setInspectionIndex(next); setInspectionVisible(true); }
  };

  if (!active) return <section className="series-trend-panel" aria-labelledby={`${id}-heading`}><h2 id={`${id}-heading`}>{title}</h2><p id={`${id}-live`} role="status" aria-live="polite" aria-atomic="true">No indicator series are available in this dashboard.</p></section>;
  const inspectionDescription = inspected ? `${active.title}. ${pointDate(inspected.date)}: ${pointValue(inspected.value)}. Source: ${active.source}. Data status: ${status ?? "not supplied"}.` : "No valid observations are available for this window.";

  return <section className={`series-trend-panel${compact ? " is-compact" : ""}`} aria-labelledby={`${id}-heading`}>
    <div className="series-trend-heading">
      <h2 id={`${id}-heading`}>{title}</h2>
      <span className={`series-trend-status${nonFresh ? " non-fresh" : ""}`}>{status ? `Source: ${status}` : "Source status not supplied"}</span>
    </div>
    <p id={`${id}-live`} className="chart-live-description" role="status" aria-live="polite" aria-atomic="true">{inspectionDescription}{!inspectionVisible && " Marker hidden; the observation inspector remains available."}</p>
    <div className="series-trend-controls">
      <div className="series-trend-select">
        <label htmlFor={`${id}-series`}>Indicator</label>
        <select id={`${id}-series`} value={active.key} onChange={(event) => pickSeries(event.target.value)}>
          {available.map((item) => <option key={item.key} value={item.key}>{item.title}</option>)}
        </select>
      </div>
      <div className="series-trend-range" role="group" aria-label="Observation window">
        {ranges.map((item) => <button type="button" key={item} aria-pressed={range === item} className={range === item ? "active" : ""} onClick={() => pickRange(item)}>{item === "All" ? "All history" : item === "3Y" ? "3 years" : "1 year"}</button>)}
      </div>
    </div>
    {nonFresh && <p className="series-trend-health">This series is marked {status}. The chart shows preserved observations, not a live feed.</p>}
    {active && isPreview(active.key) && <p className="series-trend-hint">Recent observations are shown first. Other indicators, longer ranges and detailed tables load their matching history only when requested.</p>}
    {historyLoading && <p role="status" aria-live="polite">Loading matching detailed observations…</p>}
    {historyError && <div role="alert"><p>{historyError}</p><button type="button" onClick={() => retryHistoryRequest.current()}>Retry history</button></div>}
    {(prepared.rejected > 0 || prepared.conflictingDates > 0) && <p className="series-trend-health">{prepared.rejected} invalid row{prepared.rejected === 1 ? "" : "s"} and {prepared.conflictingDates} conflicting date{prepared.conflictingDates === 1 ? "" : "s"} could not be plotted. Values were not estimated.</p>}
    {!points.length || !domain || !change ? <p className="series-trend-empty">No valid observations are available for this window.</p> : <>
      <dl className="series-trend-comparison">
        <div><dt>First in window</dt><dd>{pointValue(change.first.value)}<time dateTime={change.first.date}>{pointDate(change.first.date)}</time></dd></div>
        <div><dt>Latest in window</dt><dd>{pointValue(change.last.value)}<time dateTime={change.last.date}>{pointDate(change.last.date)}</time></dd></div>
        <div><dt>Change between these dates</dt><dd className="series-trend-change">{formatMetricChange(change.absolute, active.unit, active.decimals)}</dd></div>
      </dl>
      <div className="series-trend-plot" role="group" tabIndex={0} aria-label={`${active.title} trend chart. Use left and right arrow keys to inspect observations.`} aria-describedby={`${id}-live ${id}-hint`} onPointerMove={(event) => { if (event.pointerType !== "touch") inspectPointer(event); }} onPointerDown={inspectPointer} onKeyDown={inspectKeyboard}>
        <svg ref={setChartNode} viewBox={`0 0 ${geometry.width} ${geometry.height}`} aria-hidden="true" focusable="false">
          {domain.ticks.map((tick) => <g key={tick}>
            <line x1={geometry.left} x2={geometry.width - geometry.right} y1={y(tick)} y2={y(tick)} className={tick === 0 ? "series-trend-zero" : "series-trend-grid"} />
            <text x={geometry.left - 10} y={y(tick) + chartLayout.fontSize * 0.35} textAnchor="end" className="series-trend-axis" style={axisStyle}>{axisLabel(tick)}</text>
          </g>)}
          <path d={plottedPath} fill="none" stroke={color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
          {segments.filter((segment) => segment.length === 1).map((segment) => <circle key={segment[0].date} cx={x(pointEpoch(segment[0].date)!)} cy={y(segment[0].value)} r="3.5" fill={color} />)}
          {points.length > 1 && <>
            <text x={geometry.left} y={geometry.height - (staggerDates ? chartLayout.fontSize * 2 : 10)} className="series-trend-axis" style={axisStyle}>{pointDate(points[0].date)}</text>
            <text x={geometry.width - geometry.right} y={geometry.height - 10} textAnchor="end" className="series-trend-axis" style={axisStyle}>{pointDate(points[points.length - 1].date)}</text>
          </>}
          {points.length === 1 && <text x={geometry.width / 2} y={geometry.height - 10} textAnchor="middle" className="series-trend-axis" style={axisStyle}>{pointDate(points[0].date)}</text>}
          {inspected && inspectionVisible && <g>
            <line x1={x(pointEpoch(inspected.date)!)} x2={x(pointEpoch(inspected.date)!)} y1={geometry.top} y2={geometry.height - geometry.bottom} className="series-trend-guide" />
            <circle cx={x(pointEpoch(inspected.date)!)} cy={y(inspected.value)} r="6" fill={color} stroke="#fff" strokeWidth="2" />
          </g>}
        </svg>
      </div>
      <div id={`${id}-inspection`} className="series-trend-inspection">
        <strong>{pointValue(inspected.value)}</strong>
        <time dateTime={inspected.date}>{pointDate(inspected.date)}</time>
        <a href={active.source_url} target="_blank" rel="noreferrer">{active.source}</a>
      </div>
      <div className="series-trend-inspector">
        <label htmlFor={`${id}-point`}>Inspect an observation</label>
        <input id={`${id}-point`} type="range" min="0" max={Math.max(0, points.length - 1)} value={selectedIndex} disabled={points.length < 2} onChange={(event) => { setInspectionIndex(Number(event.target.value)); setInspectionVisible(true); }} aria-valuetext={`${pointDate(inspected.date)}: ${pointValue(inspected.value)}. Source: ${active.source}. Data status: ${status ?? "not supplied"}.`} />
      </div>
      <p id={`${id}-hint`} className="series-trend-hint">Hover or tap the chart, or use the slider and arrow keys, Home and End. Escape hides the inspection marker without removing the selected value or controls. Values in {active.unit || "unitless terms"} · Frequency: {active.frequency} · {points.length} points. {segments.length > 1 ? "Gaps are not filled." : ""} A rise is not automatically good or bad.</p>
      <details className="series-trend-table" open={historyOpen} onToggle={(event) => { const open = event.currentTarget.open; setHistoryOpen(open); if (open) void fetchHistory(active.key, () => {}); }}>
        <summary>View {points.length} observations and their source</summary>
        {historyOpen && <>
        <div className="series-trend-pagination" role="group" aria-label="Observation history pages">
          <p id={`${id}-history-page`} className="series-trend-page-status" aria-live="polite" aria-atomic="true">Observations {historyStart + 1}–{Math.min(points.length, historyStart + HISTORY_PAGE_SIZE)} of {points.length} · Page {historyPage + 1} of {historyPageCount}</p>
          <div className="series-trend-page-buttons">
            <button type="button" disabled={historyPage === 0} aria-controls={`${id}-history-table`} aria-describedby={`${id}-history-page`} onClick={() => setHistoryPagination({ key: active.key, range, page: historyPage - 1 })}>Previous</button>
            <button type="button" disabled={historyPage >= historyPageCount - 1} aria-controls={`${id}-history-table`} aria-describedby={`${id}-history-page`} onClick={() => setHistoryPagination({ key: active.key, range, page: historyPage + 1 })}>Next</button>
          </div>
        </div>
        <div className="series-trend-table-scroll" tabIndex={0} role="region" aria-label={`${active.title} observations table`}>
          <table id={`${id}-history-table`}>
            <caption>{active.title} · {active.frequency} · {pointDate(points[0].date)} to {pointDate(points[points.length - 1].date)}. Selected window ends at the latest supplied observation, not today.</caption>
            <thead><tr><th scope="col">Observation period</th><th scope="col">Value ({active.unit || "unitless"})</th><th scope="col">Source</th></tr></thead>
            <tbody>{historyRows.map((point) => <tr key={point.date}><th scope="row"><time dateTime={point.date} title={formatObservationDate(point.date, active.frequency, true)}>{pointDate(point.date)}</time></th><td>{pointValue(point.value)}</td><td><a href={active.source_url} target="_blank" rel="noreferrer">{active.source}</a></td></tr>)}</tbody>
          </table>
        </div>
        </>}
      </details>
    </>}
  </section>;
}

export default SeriesTrendPanel;
