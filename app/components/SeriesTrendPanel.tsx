"use client";

import { useId, useMemo, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { SeriesData } from "@/app/lib/dashboard";
import {
  buildTrendPath, formatMetricChange, formatMetricValue, formatObservationDate, linearScale,
  nearestPointIndex, numericDomain, observationWindow, pointEpoch, prepareSeriesPoints,
  segmentSeries, trendChange, type ObservationRange,
} from "@/app/lib/visual-data";
import "./SeriesTrendPanel.css";

type SeriesTrendPanelProps = {
  series: SeriesData[];
  statuses?: Record<string, string>;
  title?: string;
  defaultKey?: string;
  limit?: number;
  compact?: boolean;
};

const palette: Record<string, string> = {
  headline: "#c73b2d", core: "#16665c", unemployment: "#1e3744",
  opr: "#275f91", fx: "#716092", mgs: "#8b6518",
};
const ranges: ObservationRange[] = ["1Y", "3Y", "All"];
const HISTORY_PAGE_SIZE = 50;

export function SeriesTrendPanel({ series, statuses = {}, title = "Explore the data over time", defaultKey, limit, compact = false }: SeriesTrendPanelProps) {
  const id = useId();
  const available = useMemo(() => {
    const valid = series.filter((item) => item?.key && Array.isArray(item.points));
    return Number.isInteger(limit) && limit! > 0 ? valid.slice(0, limit) : valid;
  }, [series, limit]);
  const [chosen, setChosen] = useState(defaultKey ?? available[0]?.key ?? "");
  const [range, setRange] = useState<ObservationRange>("1Y");
  const [inspectionIndex, setInspectionIndex] = useState(-1);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyPagination, setHistoryPagination] = useState({ key: "", range: "1Y" as ObservationRange, page: 0 });
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
  const height = compact ? 245 : 285;
  const geometry = { width: 800, height, left: 110, right: 25, top: 20, bottom: 40 };
  const firstEpoch = points.length ? pointEpoch(points[0].date)! : 0;
  const lastEpoch = points.length ? pointEpoch(points[points.length - 1].date)! : 0;
  const x = (epoch: number) => linearScale(epoch, firstEpoch, lastEpoch, geometry.left, geometry.width - geometry.right);
  const y = (value: number) => linearScale(value, domain?.min ?? 0, domain?.max ?? 1, geometry.height - geometry.bottom, geometry.top);
  const color = palette[active?.key ?? ""] ?? "#16665c";
  const plottedPath = active && domain ? buildTrendPath(points, active.frequency, x, y) : "";
  const segments = active ? segmentSeries(points, active.frequency) : [];
  const pointValue = (value: number) => formatMetricValue(value, active.unit, active.decimals);
  const pointDate = (date: string) => formatObservationDate(date, active.frequency);
  const pickSeries = (key: string) => { setChosen(key); setInspectionIndex(-1); setHistoryPagination({ key, range, page: 0 }); };
  const pickRange = (next: ObservationRange) => { setRange(next); setInspectionIndex(-1); setHistoryPagination({ key: active?.key ?? "", range: next, page: 0 }); };
  const inspectPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (!points.length) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const plotX = (event.clientX - bounds.left) / bounds.width * geometry.width;
    const epoch = linearScale(Math.max(geometry.left, Math.min(geometry.width - geometry.right, plotX)), geometry.left, geometry.width - geometry.right, firstEpoch, lastEpoch);
    setInspectionIndex(nearestPointIndex(points, epoch));
  };
  const inspectKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!points.length) return;
    const actions: Record<string, number> = {
      ArrowLeft: Math.max(0, selectedIndex - 1), ArrowDown: Math.max(0, selectedIndex - 1),
      ArrowRight: Math.min(points.length - 1, selectedIndex + 1), ArrowUp: Math.min(points.length - 1, selectedIndex + 1),
      Home: 0, End: points.length - 1,
    };
    if (event.key in actions) { event.preventDefault(); setInspectionIndex(actions[event.key]); }
  };

  if (!active) return <section className="series-trend-panel" aria-labelledby={`${id}-heading`}><h2 id={`${id}-heading`}>{title}</h2><p>No indicator series are available in this dashboard.</p></section>;

  return <section className={`series-trend-panel${compact ? " is-compact" : ""}`} aria-labelledby={`${id}-heading`}>
    <div className="series-trend-heading">
      <h2 id={`${id}-heading`}>{title}</h2>
      <span className={`series-trend-status${nonFresh ? " non-fresh" : ""}`}>{status ? `Source: ${status}` : "Source status not supplied"}</span>
    </div>
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
    {(prepared.rejected > 0 || prepared.conflictingDates > 0) && <p className="series-trend-health">{prepared.rejected} invalid row{prepared.rejected === 1 ? "" : "s"} and {prepared.conflictingDates} conflicting date{prepared.conflictingDates === 1 ? "" : "s"} could not be plotted. Values were not estimated.</p>}
    {!points.length || !domain || !change ? <p className="series-trend-empty">No valid observations are available for this window.</p> : <>
      <dl className="series-trend-comparison">
        <div><dt>First in window</dt><dd>{pointValue(change.first.value)}<time dateTime={change.first.date}>{pointDate(change.first.date)}</time></dd></div>
        <div><dt>Latest in window</dt><dd>{pointValue(change.last.value)}<time dateTime={change.last.date}>{pointDate(change.last.date)}</time></dd></div>
        <div><dt>Change between these dates</dt><dd className="series-trend-change">{formatMetricChange(change.absolute, active.unit, active.decimals)}</dd></div>
      </dl>
      <div className="series-trend-plot" role="group" tabIndex={0} aria-label={`${active.title} trend chart. Use left and right arrow keys to inspect observations.`} aria-describedby={`${id}-inspection ${id}-hint`} onPointerMove={inspectPointer} onPointerDown={inspectPointer} onKeyDown={inspectKeyboard}>
        <svg viewBox={`0 0 ${geometry.width} ${geometry.height}`} aria-hidden="true" focusable="false">
          {domain.ticks.map((tick) => <g key={tick}>
            <line x1={geometry.left} x2={geometry.width - geometry.right} y1={y(tick)} y2={y(tick)} className={tick === 0 ? "series-trend-zero" : "series-trend-grid"} />
            <text x={geometry.left - 10} y={y(tick) + 5} textAnchor="end" className="series-trend-axis">{tick.toLocaleString("en-MY", { maximumFractionDigits: Math.min(6, Math.max(active.decimals, 2)) })}</text>
          </g>)}
          <path d={plottedPath} fill="none" stroke={color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
          {segments.filter((segment) => segment.length === 1).map((segment) => <circle key={segment[0].date} cx={x(pointEpoch(segment[0].date)!)} cy={y(segment[0].value)} r="3.5" fill={color} />)}
          {points.length > 1 && <>
            <text x={geometry.left} y={geometry.height - 10} className="series-trend-axis">{pointDate(points[0].date)}</text>
            <text x={geometry.width - geometry.right} y={geometry.height - 10} textAnchor="end" className="series-trend-axis">{pointDate(points[points.length - 1].date)}</text>
          </>}
          {points.length === 1 && <text x={geometry.width / 2} y={geometry.height - 10} textAnchor="middle" className="series-trend-axis">{pointDate(points[0].date)}</text>}
          {inspected && <g>
            <line x1={x(pointEpoch(inspected.date)!)} x2={x(pointEpoch(inspected.date)!)} y1={geometry.top} y2={geometry.height - geometry.bottom} className="series-trend-guide" />
            <circle cx={x(pointEpoch(inspected.date)!)} cy={y(inspected.value)} r="6" fill={color} stroke="#fff" strokeWidth="2" />
          </g>}
        </svg>
      </div>
      <div id={`${id}-inspection`} className="series-trend-inspection" aria-live="polite" aria-atomic="true">
        <strong>{pointValue(inspected.value)}</strong>
        <time dateTime={inspected.date}>{pointDate(inspected.date)}</time>
        <a href={active.source_url} target="_blank" rel="noreferrer">{active.source}</a>
      </div>
      <div className="series-trend-inspector">
        <label htmlFor={`${id}-point`}>Inspect an observation</label>
        <input id={`${id}-point`} type="range" min="0" max={Math.max(0, points.length - 1)} value={selectedIndex} disabled={points.length < 2} onChange={(event) => setInspectionIndex(Number(event.target.value))} aria-valuetext={`${pointDate(inspected.date)}: ${pointValue(inspected.value)}. Source: ${active.source}.`} />
      </div>
      <p id={`${id}-hint`} className="series-trend-hint">Hover or tap the chart, or use the slider and arrow keys. Values in {active.unit || "unitless terms"} · Frequency: {active.frequency} · {points.length} points. {segments.length > 1 ? "Gaps are not filled." : ""} A rise is not automatically good or bad.</p>
      <details className="series-trend-table" open={historyOpen} onToggle={(event) => setHistoryOpen(event.currentTarget.open)}>
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
