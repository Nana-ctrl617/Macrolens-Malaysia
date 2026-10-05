"use client";

import type { DashboardViewPayload } from "@/app/lib/dashboard-projection";

import { type TradePoint } from "@/app/lib/dashboard";
import { useMemo, useState } from "react";
import { AccessibleCanvasChart } from "@/app/components/AccessibleCanvasChart";
import { PictureStrip } from "@/app/components/PictureStrip";
import { signedPercent, formatDate } from "@/app/lib/dashboard-format";
import { useDashboardData, type DashboardHistoryLoader } from "@/app/components/DashboardShell";
import { DeferredHistoryControl, useDeferredHistory } from "@/app/components/DeferredHistoryControl";

export function ExternalChart({ points, metric }: { points: TradePoint[]; metric: "balance" | "exports" | "imports" }) {
  const observations = useMemo(() => points.map((point) => ({ date: point.date, value: point[metric] })), [points, metric]);
  return <AccessibleCanvasChart title={`Malaysia goods trade ${metric}`} points={observations}
    valueLabel={(value) => `RM ${value.toFixed(1)} billion`} axisLabel={(value) => value.toFixed(0)}
    className="external-chart" height={340} includeZero={metric === "balance"} minimumSpread={5}
    colour={metric === "imports" ? "var(--series-headline)" : metric === "exports" ? "var(--series-core)" : "var(--series-unemployment)"} />;
}

export function ExternalSectorSection({ dashboard, loadHistory }: { dashboard: DashboardViewPayload<"external"> | null; loadHistory?: DashboardHistoryLoader }) {
  const history = useDeferredHistory(dashboard?.deferred?.["external-history"], loadHistory);
  const preview = dashboard?.externalSector;
  const external = history.data ?? preview;
  const [metric, setMetric] = useState<"balance" | "exports" | "imports">("balance");
  const [range, setRange] = useState<"RECENT" | "3Y" | "5Y" | "ALL">(dashboard?.externalSector?.history?.complete === false ? "RECENT" : "3Y");
  const isPreview = Boolean(preview?.history && !preview.history.complete && !history.data);
  const selectRange = async (next: "3Y" | "5Y" | "ALL") => { if (isPreview && !await history.load()) return; setRange(next); };
  const points = useMemo(() => {
    const all = external?.points ?? [];
    if (!all.length || range === "ALL" || range === "RECENT") return all;
    const end = new Date(`${all.at(-1)?.date}T00:00:00`), start = new Date(end);
    start.setFullYear(start.getFullYear() - Number(range.replace("Y", "")));
    return all.filter((point) => new Date(`${point.date}T00:00:00`) >= start);
  }, [external, range]);
  return <section className="section external-section page-section" id="external"><div className="shell">
    <div className="section-heading"><div><span className="section-number">07 / External sector</span><h1>Trade, exports and imported-cost pressure</h1></div><p>Goods trade helps explain how external demand, the ringgit and imported costs can flow through the Malaysian economy.</p></div>
    <PictureStrip pictures={["trade", "markets", "prices"]} />
    {!external ? <div className="external-empty">{dashboard ? "No validated data is available for this section in the current dataset." : "Loading validated data…"}</div> : <>
      <div className="external-summary"><article><span>Exports</span><strong>RM {external.summary.exports.toFixed(1)}bn</strong><small>{signedPercent(external.summary.exportsYoY)} year on year</small></article><article><span>Imports</span><strong>RM {external.summary.imports.toFixed(1)}bn</strong><small>{signedPercent(external.summary.importsYoY)} year on year</small></article><article><span>Trade balance</span><strong className={external.summary.balance >= 0 ? "up" : "down"}>RM {external.summary.balance > 0 ? "+" : ""}{external.summary.balance.toFixed(1)}bn</strong><small>Latest month · {formatDate(external.summary.latestDate)}</small></article><article><span>12-month balance</span><strong>RM {external.summary.last12Balance > 0 ? "+" : ""}{external.summary.last12Balance.toFixed(1)}bn</strong><small>{external.summary.tradeReading}</small></article></div>
      <div className="external-toolbar"><div role="group" aria-label="Choose trade chart measure">{(["balance", "exports", "imports"] as const).map((item) => <button key={item} className={metric === item ? "active" : ""} aria-pressed={metric === item} onClick={() => setMetric(item)}>{item === "balance" ? "Trade balance" : item[0].toUpperCase() + item.slice(1)}</button>)}</div><div role="group" aria-label="Choose trade chart time frame">{isPreview && <button aria-pressed={true} className="active" onClick={() => setRange("RECENT")}>Recent preview</button>}{(["3Y", "5Y", "ALL"] as const).map((item) => <button key={item} className={range === item ? "active" : ""} aria-pressed={range === item} disabled={history.loading} onClick={() => void selectRange(item)}>{item === "ALL" ? "All history" : item}</button>)}</div></div>
      <ExternalChart points={points} metric={metric} />
      {preview?.history && <DeferredHistoryControl complete={Boolean(history.data) || preview.history.complete} returnedRows={preview.history.returnedRows} totalRows={preview.history.totalRows} loading={history.loading} error={history.error} onLoad={() => void selectRange("ALL")} />}
      <div className="external-analysis"><article><span>Latest reading</span><p>{external.narratives.performance}</p></article><article><span>Macro meaning</span><p>{external.narratives.macro}</p></article></div>
      <div className="external-table-wrap"><table><thead><tr><th>Month</th><th>Exports</th><th>Imports</th><th>Total trade</th><th>Balance</th></tr></thead><tbody>{[...external.points].slice(-12).reverse().map((point) => <tr key={point.date}><td>{formatDate(point.date)}</td><td>RM {point.exports.toFixed(1)}bn</td><td>RM {point.imports.toFixed(1)}bn</td><td>RM {point.total.toFixed(1)}bn</td><td className={point.balance >= 0 ? "up" : "down"}>RM {point.balance > 0 ? "+" : ""}{point.balance.toFixed(1)}bn</td></tr>)}</tbody></table></div>
      <div className="external-sources"><p>{external.message} · Retrieved {formatDate(external.retrievedAt.slice(0, 10))}</p><a href={external.sourceUrl} target="_blank" rel="noreferrer">Official data catalogue</a><a href={external.datasetUrl} target="_blank" rel="noreferrer">Source CSV</a></div>
    </>}
  </div></section>;
}


export default function ExternalView() { const { dashboard, loadHistory } = useDashboardData("external"); return <ExternalSectorSection dashboard={dashboard} loadHistory={loadHistory} />; }
