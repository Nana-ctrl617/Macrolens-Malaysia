"use client";

import { useId, useMemo, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import type { BalancePayments } from "../lib/dashboard";
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
const plot = { width: 800, height: 300, left: 110, right: 26, top: 26, bottom: 52 };
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

export function BalancePaymentsVisual({ data, usingFallback = false }: { data: BalancePayments; usingFallback?: boolean }) {
  const uid = useId();
  const [accountId, setAccountId] = useState("ca");
  const [range, setRange] = useState<"recent" | "all">("recent");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const quarters = useMemo(() => data.quarters.filter((quarter) => Number.isFinite(quarterNumber(quarter.date))).slice().sort((a, b) => a.date.localeCompare(b.date)), [data.quarters]);
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
  const ticks = Array.from({ length: 5 }, (_, index) => low + (high - low) * index / 4);
  const labelIndices = Array.from(new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])).filter((index) => index >= 0);

  function selectIndex(index: number) {
    if (visibleQuarters.length) setSelectedDate(visibleQuarters[Math.max(0, Math.min(visibleQuarters.length - 1, index))].date);
  }

  function keyboardInspect(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    selectIndex(event.key === "Home" ? 0 : event.key === "End" ? points.length - 1 : selectedIndex + (event.key === "ArrowRight" ? 1 : -1));
  }

  function inspectPosition(event: MouseEvent<SVGSVGElement> | PointerEvent<SVGSVGElement>) {
    if (!points.length) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width) return;
    const x = (event.clientX - rect.left) / rect.width * plot.width;
    const nearest = points.reduce((best, point, index) => Math.abs(point.x - x) < Math.abs(points[best].x - x) ? index : best, 0);
    selectIndex(nearest);
  }

  const status = usingFallback ? "Fallback snapshot" : data.status === "fresh" ? "Source validated" : data.status === "stale" ? "Saved / stale source" : "Source unavailable";
  const attempts = data as BalancePayments & { lastAttemptAt?: string | null };

  return <section className="bop-visual" aria-labelledby={`${uid}-heading`}>
    <div className="bop-visual-heading">
      <div><h2 id={`${uid}-heading`}>Follow Malaysia’s external accounts</h2><p>Compare quarterly balances through time, then see each account’s signed position in the latest published quarter.</p></div>
      <span className="bop-source-status">{status}</span>
    </div>
    {!quarters.length || !selectedAccount ? <p className="bop-empty">No published quarterly balances are available for this chart. Check the source status below; missing observations are not drawn as zero.</p> : <>
      <div className="bop-chart-controls">
        <label htmlFor={`${uid}-account`}>Account<select id={`${uid}-account`} value={selectedAccount.id} onChange={(event) => setAccountId(event.target.value)}>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
        <div className="bop-range-buttons" role="group" aria-label="Quarterly chart range"><button type="button" aria-pressed={range === "recent"} onClick={() => setRange("recent")}>Last 12 quarters</button><button type="button" aria-pressed={range === "all"} onClick={() => setRange("all")}>All quarters</button></div>
      </div>
      <p className="bop-chart-hint" id={`${uid}-help`}>Balances are in RM billion. Hover or tap the line to inspect a quarter. Focus the chart and use Left / Right, Home / End, or choose a quarter below. Missing observations leave gaps.</p>
      <div className="bop-trend-frame" tabIndex={0} role="group" aria-roledescription="interactive quarterly chart" aria-label={`${selectedAccount.name}, quarterly balances in RM billion`} aria-describedby={`${uid}-help ${uid}-reading`} onKeyDown={keyboardInspect}>
        <svg viewBox={`0 0 ${plot.width} ${plot.height}`} role="img" aria-labelledby={`${uid}-chart-title ${uid}-chart-desc`} onPointerMove={(event) => { if (event.pointerType !== "touch") inspectPosition(event); }} onClick={inspectPosition}>
          <title id={`${uid}-chart-title`}>{`${selectedAccount.name} quarterly balance`}</title>
          <desc id={`${uid}-chart-desc`}>RM billion, {quarterLabel(points[0].date)} to {quarterLabel(points[points.length - 1].date)}. Exact dates and signed balances are also available in the quarterly table.</desc>
          {ticks.map((tick, index) => <g key={index} className="bop-axis"><line x1={plot.left} x2={plot.width - plot.right} y1={yPosition(tick)} y2={yPosition(tick)} /><text x={plot.left - 10} y={yPosition(tick) + 5} textAnchor="end">{tick.toLocaleString("en-MY", { maximumFractionDigits: 1 })}</text></g>)}
          <line className="bop-zero-line" x1={plot.left} x2={plot.width - plot.right} y1={yPosition(0)} y2={yPosition(0)} />
          <path className="bop-trend-line" d={makePath(points)} />
          {points.filter((point) => point.y !== null).map((point) => <circle className="bop-trend-dot" key={point.date} cx={point.x} cy={point.y!} r={3}><title>{`${quarterLabel(point.date)} · ${point.date}: ${balanceLabel(point.value)}`}</title></circle>)}
          {active && <line className="bop-selection-line" x1={active.x} x2={active.x} y1={plot.top} y2={plot.height - plot.bottom} />}
          {active?.y !== null && active?.y !== undefined && <circle className="bop-active-dot" cx={active.x} cy={active.y} r={6} />}
          {labelIndices.map((index) => <text className="bop-axis-label" key={index} x={points[index].x} y={plot.height - 19} textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"}>{quarterLabel(points[index].date)}</text>)}
        </svg>
      </div>
      <div className="bop-quarter-inspector">
        <div className="bop-quarter-controls"><button type="button" aria-label="Inspect previous quarter" disabled={selectedIndex <= 0} onClick={() => selectIndex(selectedIndex - 1)}>Previous</button><label htmlFor={`${uid}-quarter`}>Inspect quarter<select id={`${uid}-quarter`} value={active?.date ?? ""} onChange={(event) => setSelectedDate(event.target.value)}>{visibleQuarters.map((quarter) => <option key={quarter.date} value={quarter.date}>{quarterLabel(quarter.date)} · {quarter.date}</option>)}</select></label><button type="button" aria-label="Inspect next quarter" disabled={selectedIndex >= points.length - 1} onClick={() => selectIndex(selectedIndex + 1)}>Next</button></div>
        <p id={`${uid}-reading`} className="bop-inspector-value" aria-live="polite"><span>{selectedAccount.name} · {active ? `${quarterLabel(active.date)} (${active.date})` : "No quarter selected"}</span><strong>{balanceLabel(active?.value ?? null)}</strong></p>
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
          return <button type="button" key={account.id} className="bop-balance-row" aria-pressed={selectedAccount.id === account.id} aria-label={`${account.name}, ${latest.date}, ${balanceLabel(value)}. Select account history.`} onClick={() => { setAccountId(account.id); setSelectedDate(latest.date); }}>
            <span className="bop-account-name">{account.name}</span><span className="bop-balance-track" aria-hidden="true"><span className="bop-track-zero" />{value !== null && <span className={`bop-balance-fill${value === 0 ? " bop-actual-zero" : ""}`} style={style} />}</span><span className="bop-balance-value">{value === null ? "Not published" : `${value > 0 ? "+" : ""}${numberFormat.format(value)}`}</span>
          </button>;
        })}
      </div>
      <details className="bop-data-details"><summary>View exact quarterly balances as a table</summary><div className="bop-table-scroll" tabIndex={0} role="region" aria-label="Quarterly balance-of-payments data table"><table><caption>Published quarterly observations, RM billion. Dates are the official quarter labels. A dash means not published, never zero.</caption><thead><tr><th scope="col">Quarter / source date</th>{accounts.map((account) => <th scope="col" key={account.id}>{account.name}</th>)}</tr></thead><tbody>{visibleQuarters.map((quarter: Quarter) => <tr key={quarter.date}><th scope="row">{quarterLabel(quarter.date)}<span>{quarter.date}</span></th>{accounts.map((account) => { const value = finiteBalance(quarter.accounts.find((item) => item.id === account.id)); return <td key={account.id}>{value === null ? <span aria-label="Not published">—</span> : `${value > 0 ? "+" : ""}${numberFormat.format(value)}`}</td>; })}</tr>)}</tbody></table></div></details>
    </>}
    <p className="bop-accounting-note">Balance-of-payments accounts describe transactions between Malaysia and the rest of the world. Published signs follow BOP accounting conventions; these balances are not household cash or savings, and they do not establish what caused or will happen to the exchange rate.</p>
    <div className="bop-source-strip"><p><a href={data.sourceUrl} target="_blank" rel="noreferrer">{data.source} · official catalogue</a><span>Observation period: {quarterLabel(data.observationPeriod)} ({data.observationPeriod})</span><span>Last successful retrieval: {retrievalLabel(data.retrievedAt)}</span>{attempts.lastAttemptAt && <span>Last refresh attempt: {retrievalLabel(attempts.lastAttemptAt)}</span>}</p><a href={data.datasetUrl} target="_blank" rel="noreferrer">Download source CSV</a><p className="bop-source-message">{data.message}</p></div>
  </section>;
}

export default BalancePaymentsVisual;
