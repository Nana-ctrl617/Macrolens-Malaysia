"use client";

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import type { BalancePayments } from "../lib/dashboard";
import type { BopPreview } from "../lib/dashboard-projection";
import { isChartInspectionKey, nextChartIndex } from "../lib/chart-inspection.ts";
import "./BalancePaymentsVisual.css";

type Account = BalancePayments["quarters"][number]["accounts"][number];
type Quarter = BalancePayments["quarters"][number];
type PlotPoint = { date: string; value: number | null; x: number; y: number | null };

const knownAccounts = [
  { id: "ca", name: "Current account" },
  { id: "ka", name: "Capital account" },
  { id: "fa", name: "Financial account" },
  { id: "reserves", name: "Official reserve account" },
  { id: "neo", name: "Net errors and omissions" },
];
const numberFormat = new Intl.NumberFormat("en-MY", { maximumFractionDigits: 15 });

function finiteBalance(account?: Account): number | null {
  return account && typeof account.balance === "number" && Number.isFinite(account.balance) ? account.balance : null;
}

function quarterNumber(date: string): number {
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(date)) return NaN;
  const stamp = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(stamp.getTime()) && stamp.toISOString().slice(0, 10) === date ? stamp.getUTCFullYear() * 4 + Math.floor(stamp.getUTCMonth() / 3) : NaN;
}

function quarterLabel(date: string): string {
  const ordinal = quarterNumber(date);
  return Number.isFinite(ordinal) ? `Q${ordinal % 4 + 1} ${Math.floor(ordinal / 4)}` : date;
}

function balanceLabel(value: number | null): string {
  return value === null ? "Not published" : `RM ${value > 0 ? "+" : ""}${numberFormat.format(value)} billion`;
}

function retrievalLabel(value?: string | null): string {
  if (!value) return "Not recorded";
  const stamp = new Date(value);
  if (!Number.isFinite(stamp.getTime())) return "Not recorded";
  return `${new Intl.DateTimeFormat("en-MY", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kuala_Lumpur" }).format(stamp)} MYT`;
}

function makePath(points: PlotPoint[]): string {
  let lastQuarter: number | null = null;
  return points.map((point) => {
    if (point.value === null || point.y === null) {
      lastQuarter = null;
      return "";
    }
    const ordinal = quarterNumber(point.date);
    const command = lastQuarter !== null && ordinal - lastQuarter === 1 ? "L" : "M";
    lastQuarter = ordinal;
    return `${command}${point.x.toFixed(2)},${point.y.toFixed(2)}`;
  }).join(" ");
}

export function BalancePaymentsVisual({ data, usingFallback = false, loadQuarters }: { data: BalancePayments | BopPreview; usingFallback?: boolean; loadQuarters?: () => Promise<Quarter[]> }) {
  const uid = useId();
  const [accountId, setAccountId] = useState("ca");
  const [range, setRange] = useState<"recent" | "all">("recent");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [inspectionVisible, setInspectionVisible] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [fullQuarters, setFullQuarters] = useState<Quarter[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const requestVersion = useRef(0);
  const retryHistoryRequest = useRef<() => void>(() => {});
  useEffect(() => () => { requestVersion.current++; }, []);
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
  const quarters = useMemo(() => (fullQuarters ?? data.quarters).filter((quarter) => Number.isFinite(quarterNumber(quarter.date))).slice().sort((a, b) => a.date.localeCompare(b.date)), [data.quarters, fullQuarters]);
  const fetchHistory = async (commit: () => void) => {
    if (!loadQuarters || fullQuarters || !("history" in data) || data.history.complete) { commit(); return; }
    const version = ++requestVersion.current; retryHistoryRequest.current=()=>{void fetchHistory(commit);}; setHistoryLoading(true); setHistoryError("");
    try { const rows = await loadQuarters(); if (version === requestVersion.current) { setFullQuarters(rows); commit(); } }
    catch (error) { if (version === requestVersion.current) setHistoryError(error instanceof Error ? error.message : "Quarterly history could not be loaded. The validated recent preview remains visible."); }
    finally { if (version === requestVersion.current) setHistoryLoading(false); }
  };
  const accounts = useMemo(() => {
    const names = new Map<string, string>();
    for (const quarter of quarters) for (const account of quarter.accounts) names.set(account.id, account.name);
    return [...knownAccounts.filter((account) => names.has(account.id)).map((account) => ({ ...account, name: names.get(account.id)! })), ...Array.from(names, ([id, name]) => ({ id, name })).filter((account) => !knownAccounts.some((known) => known.id === account.id))];
  }, [quarters]);
  const selectedAccount = accounts.find((account) => account.id === accountId) ?? accounts[0];
  const visibleQuarters = useMemo(() => {
    if (range === "all" || !quarters.length) return quarters;
    const latestOrdinal = quarterNumber(quarters[quarters.length - 1].date);
    return quarters.filter((quarter) => quarterNumber(quarter.date) >= latestOrdinal - 11);
  }, [quarters, range]);
  const values = visibleQuarters.map((quarter) => finiteBalance(quarter.accounts.find((account) => account.id === selectedAccount?.id)));
  const availableValues = values.filter((value): value is number => value !== null);
  const rawLow = Math.min(0, ...availableValues);
  const rawHigh = Math.max(0, ...availableValues);
  const padding = rawHigh === rawLow ? 1 : (rawHigh - rawLow) * 0.08;
  const low = rawLow - padding;
  const high = rawHigh + padding;
  const ticks = Array.from({ length: 5 }, (_, index) => low + (high - low) * index / 4);
  const axisLabel = (tick: number) => tick.toLocaleString("en-MY", { maximumFractionDigits: 1 });
  const longestTick = Math.max(1, ...ticks.map((tick) => axisLabel(tick).length));
  const narrowChart = chartLayout.width < 480;
  const plot = {
    width: chartLayout.width,
    height: Math.max(chartLayout.width / 800 * 300, chartLayout.fontSize * 11 + 52),
    left: Math.max(chartLayout.width >= 640 ? 110 : 54, longestTick * chartLayout.fontSize * 0.62 + 18),
    right: Math.max(26, chartLayout.fontSize), top: Math.max(26, chartLayout.fontSize * 1.4),
    bottom: Math.max(52, chartLayout.fontSize * (narrowChart ? 4 : 2.5)),
  };
  const axisStyle = { fontSize: chartLayout.fontSize };
  const graphWidth = plot.width - plot.left - plot.right;
  const graphHeight = plot.height - plot.top - plot.bottom;
  const firstOrdinal = visibleQuarters.length ? quarterNumber(visibleQuarters[0].date) : 0;
  const lastOrdinal = visibleQuarters.length ? quarterNumber(visibleQuarters[visibleQuarters.length - 1].date) : 0;
  const yPosition = (value: number) => plot.top + (high - value) / (high - low) * graphHeight;
  const points = visibleQuarters.map((quarter, index) => ({ date: quarter.date, value: values[index], x: firstOrdinal === lastOrdinal ? plot.left + graphWidth / 2 : plot.left + (quarterNumber(quarter.date) - firstOrdinal) / (lastOrdinal - firstOrdinal) * graphWidth, y: values[index] === null ? null : yPosition(values[index]!) }));
  const selectedIndex = Math.max(0, selectedDate ? visibleQuarters.findIndex((quarter) => quarter.date === selectedDate) : visibleQuarters.length - 1);
  const active = points[selectedIndex];
  const latest = quarters[quarters.length - 1];
  const latestBalances = latest?.accounts.map(finiteBalance).filter((value): value is number => value !== null) ?? [];
  const largestLatest = Math.max(1, ...latestBalances.map(Math.abs));
  const labelIndices = Array.from(new Set(narrowChart ? [0, points.length - 1] : [0, Math.floor((points.length - 1) / 2), points.length - 1])).filter((index) => index >= 0);

  function selectIndex(index: number) {
    if (visibleQuarters.length) { setSelectedDate(visibleQuarters[Math.max(0, Math.min(visibleQuarters.length - 1, index))].date); setInspectionVisible(true); }
  }

  function keyboardInspect(event: KeyboardEvent<HTMLDivElement>) {
    if (!isChartInspectionKey(event.key)) return;
    event.preventDefault();
    const next = nextChartIndex(event.key, selectedIndex, points.length);
    if (next === null) setInspectionVisible(false);
    else selectIndex(next);
  }

  function inspectPosition(event: MouseEvent<SVGSVGElement> | PointerEvent<SVGSVGElement>) {
    if (!points.length) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !Number.isFinite(event.clientX)) return;
    const x = (event.clientX - rect.left) / rect.width * plot.width;
    const nearest = points.reduce((best, point, index) => Math.abs(point.x - x) < Math.abs(points[best].x - x) ? index : best, 0);
    selectIndex(nearest);
  }

  const status = usingFallback ? "Fallback snapshot" : data.status === "fresh" ? "Source validated" : data.status === "stale" ? "Saved / stale source" : "Source unavailable";
  const inspectionDescription = active && selectedAccount ? `${selectedAccount.name}. ${quarterLabel(active.date)} (${active.date}): ${balanceLabel(active.value)}. Source: ${data.source}. Data status: ${status}.` : `No published quarterly balances are available for this chart. Source: ${data.source}. Data status: ${status}.`;
  const attempts = data as BalancePayments & { lastAttemptAt?: string | null };

  return <section className="bop-visual" aria-labelledby={`${uid}-heading`}>
    <div className="bop-visual-heading">
      <div><h2 id={`${uid}-heading`}>Follow Malaysia’s external accounts</h2><p>Compare quarterly balances through time, then see each account’s signed position in the latest published quarter.</p></div>
      <span className="bop-source-status">{status}</span>
    </div>
    <p id={`${uid}-live`} className="chart-live-description" role="status" aria-live="polite" aria-atomic="true">{inspectionDescription}{!inspectionVisible && " Marker hidden; the quarter inspector remains available."}</p>
    {"history" in data && !data.history.complete && !fullQuarters && <p className="bop-chart-hint">Recent quarterly observations are shown first. All quarters and the detailed table load matching history when requested.</p>}
    {historyLoading && <p role="status" aria-live="polite">Loading matching quarterly history…</p>}
    {historyError && <div role="alert"><p>{historyError}</p><button type="button" onClick={() => retryHistoryRequest.current()}>Retry quarterly history</button></div>}
    {!quarters.length || !selectedAccount ? <p className="bop-empty">No published quarterly balances are available for this chart. Check the source status below; missing observations are not drawn as zero.</p> : <>
      <div className="bop-chart-controls">
        <label htmlFor={`${uid}-account`}>Account<select id={`${uid}-account`} value={selectedAccount.id} onChange={(event) => { setAccountId(event.target.value); setInspectionVisible(true); }}>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
        <div className="bop-range-buttons" role="group" aria-label="Quarterly chart range"><button type="button" aria-pressed={range === "recent"} onClick={() => { setRange("recent"); setInspectionVisible(true); }}>Last 12 quarters</button><button type="button" aria-pressed={range === "all"} onClick={() => void fetchHistory(() => { setRange("all"); setInspectionVisible(true); })}>All quarters</button></div>
      </div>
      <p className="bop-chart-hint" id={`${uid}-help`}>Balances are in RM billion. Hover or tap the line to inspect a quarter. Focus the chart and use Left / Right, Home / End, or choose a quarter below. Escape hides the marker while keeping the inspected value and controls. Missing observations leave gaps.</p>
      <div className="bop-trend-frame" tabIndex={0} role="group" aria-roledescription="interactive quarterly chart" aria-label={`${selectedAccount.name}, quarterly balances in RM billion`} aria-describedby={`${uid}-help ${uid}-live`} onKeyDown={keyboardInspect}>
        <svg ref={setChartNode} viewBox={`0 0 ${plot.width} ${plot.height}`} role="img" aria-labelledby={`${uid}-chart-title ${uid}-chart-desc`} onPointerMove={(event) => { if (event.pointerType !== "touch") inspectPosition(event); }} onPointerDown={inspectPosition} onClick={inspectPosition}>
          <title id={`${uid}-chart-title`}>{`${selectedAccount.name} quarterly balance`}</title>
          <desc id={`${uid}-chart-desc`}>RM billion, {quarterLabel(points[0].date)} to {quarterLabel(points[points.length - 1].date)}. Exact dates and signed balances are also available in the quarterly table.</desc>
          {ticks.map((tick, index) => <g key={index} className="bop-axis"><line x1={plot.left} x2={plot.width - plot.right} y1={yPosition(tick)} y2={yPosition(tick)} /><text x={plot.left - 10} y={yPosition(tick) + chartLayout.fontSize * 0.35} textAnchor="end" style={axisStyle}>{axisLabel(tick)}</text></g>)}
          <line className="bop-zero-line" x1={plot.left} x2={plot.width - plot.right} y1={yPosition(0)} y2={yPosition(0)} />
          <path className="bop-trend-line" d={makePath(points)} />
          {points.filter((point) => point.y !== null).map((point) => <circle className="bop-trend-dot" key={point.date} cx={point.x} cy={point.y!} r={3}><title>{`${quarterLabel(point.date)} · ${point.date}: ${balanceLabel(point.value)}`}</title></circle>)}
          {active && inspectionVisible && <line className="bop-selection-line" x1={active.x} x2={active.x} y1={plot.top} y2={plot.height - plot.bottom} />}
          {inspectionVisible && active?.y !== null && active?.y !== undefined && <circle className="bop-active-dot" cx={active.x} cy={active.y} r={6} />}
          {labelIndices.map((index) => <text className="bop-axis-label" key={index} x={points[index].x} y={plot.height - (narrowChart && index === 0 && points.length > 1 ? chartLayout.fontSize * 2.2 : 12)} textAnchor={points.length === 1 ? "middle" : index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"} style={axisStyle}>{quarterLabel(points[index].date)}</text>)}
        </svg>
      </div>
      <div className="bop-quarter-inspector">
        <div className="bop-quarter-controls"><button type="button" aria-label="Inspect previous quarter" disabled={selectedIndex <= 0} onClick={() => selectIndex(selectedIndex - 1)}>Previous</button><label htmlFor={`${uid}-quarter`}>Inspect quarter<select id={`${uid}-quarter`} value={active?.date ?? ""} onChange={(event) => { setSelectedDate(event.target.value); setInspectionVisible(true); }}>{visibleQuarters.map((quarter) => <option key={quarter.date} value={quarter.date}>{quarterLabel(quarter.date)} · {quarter.date}</option>)}</select></label><button type="button" aria-label="Inspect next quarter" disabled={selectedIndex >= points.length - 1} onClick={() => selectIndex(selectedIndex + 1)}>Next</button></div>
        <p id={`${uid}-reading`} className="bop-inspector-value"><span>{selectedAccount.name} · {active ? `${quarterLabel(active.date)} (${active.date})` : "No quarter selected"}</span><strong>{balanceLabel(active?.value ?? null)}</strong></p>
      </div>
      {!availableValues.length && <p className="bop-empty">This account has no published balance in the selected range. Choose another account or expand the range.</p>}
      <div className="bop-latest-heading"><h4>Latest-quarter account balances</h4><p>{quarterLabel(latest.date)} · {latest.date} · RM billion</p></div>
      <p className="bop-chart-hint">Bars start at zero. Left means a negative published balance; right means positive. Direction is an accounting sign, not a good / bad rating. Select an account to explore its history.</p>
      <div className="bop-diverging-scale" aria-hidden="true"><span>−{largestLatest.toLocaleString("en-MY", { maximumFractionDigits: 1 })}</span><span>0</span><span>+{largestLatest.toLocaleString("en-MY", { maximumFractionDigits: 1 })}</span></div>
      <div className="bop-latest-bars" role="group" aria-label={`All published account balances for ${quarterLabel(latest.date)}`}>
        {latest.accounts.map((account) => {
          const value = finiteBalance(account);
          const width = value === null ? 0 : Math.abs(value) / largestLatest * 50;
          const style = { "--bop-bar-width": `${width}%`, "--bop-bar-start": `${value !== null && value < 0 ? 50 - width : 50}%` } as CSSProperties;
          return <button type="button" key={account.id} className="bop-balance-row" aria-pressed={selectedAccount.id === account.id} aria-label={`${account.name}, ${latest.date}, ${balanceLabel(value)}. Select account history.`} onClick={() => { setAccountId(account.id); setSelectedDate(latest.date); setInspectionVisible(true); }}>
            <span className="bop-account-name">{account.name}</span><span className="bop-balance-track" aria-hidden="true"><span className="bop-track-zero" />{value !== null && <span className={`bop-balance-fill${value === 0 ? " bop-actual-zero" : ""}`} style={style} />}</span><span className="bop-balance-value">{value === null ? "Not published" : `${value > 0 ? "+" : ""}${numberFormat.format(value)}`}</span>
          </button>;
        })}
      </div>
      <details className="bop-data-details" open={historyOpen} onToggle={(event) => { const open=event.currentTarget.open;setHistoryOpen(open);if(open)void fetchHistory(()=>{}); }}><summary>View exact quarterly balances as a table</summary>{historyOpen && <div className="bop-table-scroll" tabIndex={0} role="region" aria-label="Quarterly balance-of-payments data table"><table><caption>Published quarterly observations, RM billion. Dates are the official quarter labels. A dash means not published, never zero.</caption><thead><tr><th scope="col">Quarter / source date</th>{accounts.map((account) => <th scope="col" key={account.id}>{account.name}</th>)}</tr></thead><tbody>{visibleQuarters.map((quarter: Quarter) => <tr key={quarter.date}><th scope="row">{quarterLabel(quarter.date)}<span>{quarter.date}</span></th>{accounts.map((account) => { const value = finiteBalance(quarter.accounts.find((item) => item.id === account.id)); return <td key={account.id}>{value === null ? <span aria-label="Not published">—</span> : `${value > 0 ? "+" : ""}${numberFormat.format(value)}`}</td>; })}</tr>)}</tbody></table></div>}</details>
    </>}
    <p className="bop-accounting-note">Balance-of-payments accounts describe transactions between Malaysia and the rest of the world. Published signs follow BOP accounting conventions; these balances are not household cash or savings, and they do not establish what caused or will happen to the exchange rate.</p>
    <div className="bop-source-strip"><p><a href={data.sourceUrl} target="_blank" rel="noreferrer">{data.source} · official catalogue</a><span>Observation period: {quarterLabel(data.observationPeriod)} ({data.observationPeriod})</span><span>Last successful retrieval: {retrievalLabel(data.retrievedAt)}</span>{attempts.lastAttemptAt && <span>Last refresh attempt: {retrievalLabel(attempts.lastAttemptAt)}</span>}</p><a href={data.datasetUrl} target="_blank" rel="noreferrer">Download source CSV</a><p className="bop-source-message">{data.message}</p></div>
  </section>;
}

export default BalancePaymentsVisual;
