"use client";

import type { DashboardViewPayload } from "@/app/lib/dashboard-projection";

import { type DataPoint } from "@/app/lib/dashboard-ui-types";
import { AccessibleCanvasChart } from "@/app/components/AccessibleCanvasChart";
import { useState, useMemo } from "react";
import { PictureStrip } from "@/app/components/PictureStrip";
import { signedPercent, formatDate } from "@/app/lib/dashboard-format";
import { useDashboardData, type DashboardHistoryLoader } from "@/app/components/DashboardShell";
import { DeferredHistoryControl, useDeferredHistory } from "@/app/components/DeferredHistoryControl";

export type MarketRange = "RECENT" | "1M" | "3M" | "YTD" | "1Y" | "3Y" | "5Y" | "ALL";

export function MarketChart({ points }: { points: DataPoint[] }) {
  return <AccessibleCanvasChart title="FTSE Bursa Malaysia KLCI daily closing levels" points={points} frequency="daily"
    valueLabel={(value) => value.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
    axisLabel={(value) => value.toFixed(0)} className="market-chart" height={350} minimumSpread={30} colour="var(--chart-market-line)" dark fill />;
}

export function BursaSection({ dashboard, loadHistory }: { dashboard: DashboardViewPayload<"bursa"> | null; loadHistory?: DashboardHistoryLoader }) {
  const [range, setRange] = useState<MarketRange>(dashboard?.market?.history?.complete === false ? "RECENT" : "1Y");
  const history = useDeferredHistory(dashboard?.deferred?.["market-history"], loadHistory);
  const preview = dashboard?.market;
  const market = history.data ?? preview;
  const isPreview = Boolean(preview?.history && !preview.history.complete && !history.data);
  const selectRange = async (next: MarketRange) => { if (isPreview && !await history.load()) return; setRange(next); };
  const allPoints = useMemo(() => market?.benchmark.points ?? [], [market]);
  const points = useMemo(() => {
    if (!allPoints.length || range === "ALL" || range === "RECENT") return allPoints;
    const end = new Date(`${allPoints.at(-1)?.date}T00:00:00`), start = new Date(end);
    if (range === "YTD") start.setMonth(0, 1);
    else if (range.endsWith("M")) start.setMonth(start.getMonth() - Number(range.replace("M", "")));
    else start.setFullYear(start.getFullYear() - Number(range.replace("Y", "")));
    return allPoints.filter((point) => new Date(`${point.date}T00:00:00`) >= start);
  }, [allPoints, range]);
  const periodReturn = points.length > 1 ? (points.at(-1)!.value / points[0].value - 1) * 100 : null;
  const summary = market?.summary;
  return <section className="section market-section" id="bursa"><div className="shell">
    <div className="section-heading light"><div><span className="section-number">08 / Bursa Malaysia</span><h1>The large-cap market pulse</h1></div><p>The FBM KLCI tracks 30 leading Main Market companies. It is a benchmark for large Malaysian shares, not the performance of every Bursa-listed company.</p></div>
    <PictureStrip pictures={["markets", "city", "research"]} />
    {!market || !summary ? <div className="market-empty">{dashboard ? "No validated data is available for this section in the current dataset." : "Loading validated data…"}</div> : <>
      <div className="market-overview">
        <article className="market-quote"><span>FTSE Bursa Malaysia KLCI</span><strong>{summary.latest.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong><div><b className={summary.change1D >= 0 ? "positive" : "negative"}>{signedPercent(summary.change1D)}</b><small>latest trading day · {formatDate(summary.latestDate)}</small></div><em className={`market-status ${market.status}`}>{dashboard?.usingFallback ? "Bundled fallback" : market.status === "fresh" ? "Delayed data · refreshed" : "Delayed data · cached"}</em></article>
        <div className="market-range" role="group" aria-label="Choose KLCI chart period">{isPreview && <button aria-pressed={true} className="active" onClick={() => setRange("RECENT")}>Recent preview</button>}{(["1M", "3M", "YTD", "1Y", "3Y", "5Y", "ALL"] as MarketRange[]).map((item) => <button key={item} className={range === item ? "active" : ""} aria-pressed={range === item} disabled={history.loading} onClick={() => void selectRange(item)}>{item}</button>)}</div>
      </div>
      <MarketChart points={points} />
      {preview?.history && <DeferredHistoryControl complete={!isPreview} returnedRows={preview.history.returnedRows} totalRows={preview.history.totalRows} loading={history.loading} error={history.error} onLoad={() => void selectRange("ALL")} />}
      <div className="market-stats">
        <article><span>{isPreview ? "Preview endpoint" : range} return</span><strong className={(periodReturn ?? 0) >= 0 ? "positive" : "negative"}>{signedPercent(periodReturn)}</strong><small>Price change between {isPreview ? "available preview" : "selected"} endpoints</small></article>
        <article><span>1-year volatility</span><strong>{summary.annualizedVolatility1Y?.toFixed(2) ?? "—"}%</strong><small>Annualised standard deviation of daily returns</small></article>
        <article><span>1-year max drawdown</span><strong className="negative">{summary.maxDrawdown1Y.toFixed(2)}%</strong><small>Largest fall from a running peak</small></article>
        <article><span>52-week range</span><strong>{summary.low52w.toFixed(0)}–{summary.high52w.toFixed(0)}</strong><small>Lowest and highest daily closes</small></article>
      </div>
      <div className="market-analysis"><article><span>Performance reading</span><p>{market.narratives.performance}</p></article><article><span>Macroeconomic context</span><p>{market.narratives.macro}</p></article></div>
      <div className="market-sources"><span>{market.message} · Retrieved {formatDate(market.retrievedAt.slice(0, 10))}</span><div><a href={market.benchmark.benchmarkSourceUrl} target="_blank" rel="noreferrer">Benchmark definition ↗</a><a href={market.benchmark.sourceUrl} target="_blank" rel="noreferrer">Delayed price source ↗</a></div></div>
      <p className="market-disclaimer">Returns exclude dividends, fees and taxes. Delayed third-party market data may be revised. This section is educational analysis, not investment advice or a trading signal.</p>
    </>}
  </div></section>;
}


export default function BursaView() { const { dashboard, loadHistory } = useDashboardData("bursa"); return <BursaSection dashboard={dashboard} loadHistory={loadHistory} />; }
