"use client";

import { type IndicatorData, type DataPoint, type Metric, type RangeKey, type MetricId } from "@/app/lib/dashboard-ui-types";
import { seriesCadence } from "@/app/lib/visual-data";
import { AccessibleCanvasChart } from "@/app/components/AccessibleCanvasChart";
import { formatValue, formatDate, healthStatusLabel, formatP } from "@/app/lib/dashboard-format";
import { type DashboardPayload, type SeriesData } from "@/app/lib/dashboard";
export type IndicatorContext = Pick<DashboardPayload, "series" | "structuralBreaks" | "categories" | "usingFallback">;
import { useRef, useState, useEffect, useMemo } from "react";
import { inflationDefinitions } from "@/app/lib/inflation-definitions";
import { consecutiveMonthlyChanges } from "@/app/lib/monthly-evidence";

export function buildAnalysis(data: IndicatorData, points: DataPoint[]) {
  if (points.length < 2) return null;
  const values = points.map((point) => point.value);
  const first = points[0];
  const last = points[points.length - 1];
  const change = last.value - first.value;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const high = points.reduce((best, point) => point.value > best.value ? point : best);
  const low = points.reduce((best, point) => point.value < best.value ? point : best);
  const observationChanges = values.slice(1).map((value, index) => value - values[index]);
  const changeAverage = observationChanges.reduce((sum, value) => sum + value, 0) / observationChanges.length;
  const volatility = Math.sqrt(
    observationChanges.reduce((sum, value) => sum + (value - changeAverage) ** 2, 0)
    / observationChanges.length,
  );
  const threshold = data.id === "fx" ? 0.03 : 0.1;
  const direction = Math.abs(change) < threshold ? "broadly stable" : change > 0 ? "higher" : "lower";
  const absoluteChange = Math.abs(change);
  const changeText = data.id === "fx"
    ? `RM ${absoluteChange.toFixed(2)}`
    : `${absoluteChange.toFixed(data.decimals)} percentage points`;

  const meanings: Record<Metric["id"], string> = {
    headline: change > threshold
      ? "Price pressure increased over this window. Persistent increases can reduce household purchasing power and influence expectations for interest rates."
      : change < -threshold
        ? "Headline price pressure eased over this window. This can improve purchasing-power conditions, although individual household inflation may differ."
        : "Headline inflation was comparatively stable. The mix of food, energy and administered prices still matters even when the overall rate changes little.",
    core: change > threshold
      ? "Underlying inflation strengthened, suggesting price pressure became broader or more persistent beyond volatile items."
      : change < -threshold
        ? "Underlying inflation softened, suggesting broader price pressure became less persistent."
        : "Underlying inflation remained relatively steady, pointing to limited change in broad-based price momentum.",
    opr: change > threshold
      ? "The policy setting became tighter. Higher policy rates generally restrain demand and feed into deposit and lending rates with a delay."
      : change < -threshold
        ? "The policy setting became more accommodative. Lower rates can support demand, while the effect depends on credit conditions and confidence."
        : "The policy rate was stable across the selected endpoints. Unchanged rates do not necessarily mean the policy stance was unchanged in real terms.",
    unemployment: change > threshold
      ? "Labour-market conditions softened as unemployment rose. The size and persistence of the change matter more than a single monthly movement."
      : change < -threshold
        ? "Labour-market conditions improved as unemployment declined, which may support household income and consumption."
        : "The unemployment rate was broadly stable, suggesting little net change in labour-market slack across the selected endpoints.",
    fx: change > threshold
      ? "A higher USD/MYR rate means the ringgit weakened against the US dollar. This can raise imported costs but may support ringgit-denominated export receipts."
      : change < -threshold
        ? "A lower USD/MYR rate means the ringgit strengthened against the US dollar, reducing some imported-cost pressure."
        : "The ringgit was broadly stable against the US dollar across the selected endpoints, although volatility may have occurred within the period.",
    mgs: change > threshold
      ? "The 10-year government yield increased, implying tighter long-term financing conditions and lower prices for comparable existing bonds."
      : change < -threshold
        ? "The 10-year government yield declined, easing long-term benchmark financing conditions and supporting comparable existing bond prices."
        : "The 10-year government yield was broadly stable, suggesting limited net change in the long-term benchmark rate.",
  };

  return {
    first,
    last,
    change,
    changeText,
    direction,
    average,
    high,
    low,
    volatility,
    meaning: meanings[data.id],
  };
}

export function TimeSeriesChart({ data, points }: { data: IndicatorData; points: DataPoint[] }) {
  const cadence = seriesCadence(data.frequency);
  return <AccessibleCanvasChart title={`${data.title} history`} points={points}
    valueLabel={(value) => formatValue(value, data)} axisLabel={(value) => data.unit === "RM" ? value.toFixed(2) : `${value.toFixed(data.decimals)}%`}
    className="detail-chart-wrap" fill frequency={cadence === "daily" || cadence === "policy" ? cadence : "monthly"} minimumSpread={data.id === "fx" ? .15 : .5} />;
}

export function IndicatorDetail({ metric, dashboard, onClose, loadSeries, loadComparison }: { metric: Metric; dashboard: IndicatorContext | null; onClose: () => void; loadSeries?: (id: MetricId) => Promise<SeriesData>; loadComparison?: () => Promise<IndicatorContext> }) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [data, setData] = useState<IndicatorData | null>(null);
  const [error, setError] = useState("");
  const [detailRetry, setDetailRetry] = useState(0);
  const [range, setRange] = useState<RangeKey>("5Y");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [showTable, setShowTable] = useState(false);
  const [comparisonContext, setComparisonContext] = useState<IndicatorContext | null>(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [comparisonError, setComparisonError] = useState("");
  const requestComparison = async () => {
    if (!loadComparison || comparisonLoading) return;
    setComparisonLoading(true); setComparisonError("");
    try { setComparisonContext(await loadComparison()); }
    catch (failure) { setComparisonError(failure instanceof Error ? failure.message : "Comparison histories could not be loaded. Please retry."); }
    finally { setComparisonLoading(false); }
  };

  useEffect(() => {
    const panel = panelRef.current;
    const overlay = overlayRef.current;
    if (!panel || !overlay) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const background = new Map<HTMLElement, boolean>();
    let branch: HTMLElement | null = overlay;
    while (branch && branch !== document.body) {
      const parent: HTMLElement | null = branch.parentElement;
      if (!parent) break;
      for (const element of Array.from(parent.children)) {
        if (!(element instanceof HTMLElement) || element === branch) continue;
        background.set(element, element.inert);
        element.inert = true;
      }
      branch = parent;
    }
    const wasModalOpen = document.body.classList.contains("modal-open");
    document.body.classList.add("modal-open");
    const focusableElements = () => Array.from(panel.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'))
      .filter((element) => !element.closest("[inert]") && element.getClientRects().length > 0);
    const focusStart = () => (focusableElements()[0] ?? panel).focus();
    const containFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !panel.contains(event.target)) focusStart();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // Native document listeners can run before React's delegated handlers.
        // An inspected chart owns Escape; the dialog still closes from its other controls.
        if (event.target instanceof Element && event.target.closest('.detail-chart-wrap')) return;
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      } else if (event.key === "Tab") {
        const elements = focusableElements();
        const first = elements[0] ?? panel;
        const last = elements.at(-1) ?? panel;
        const active = document.activeElement;
        if (!panel.contains(active) || (event.shiftKey && active === first) || (!event.shiftKey && active === last) || !elements.length) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        }
      }
    };
    focusStart();
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("focusin", containFocus);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("focusin", containFocus);
      for (const [element, wasInert] of background) element.inert = wasInert;
      if (!wasModalOpen) document.body.classList.remove("modal-open");
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const request = loadSeries ? loadSeries(metric.id).then(series => ({ id: metric.id, title: series.title, unit: series.unit, decimals: series.decimals, source: series.source, sourceUrl: series.source_url, frequency: series.frequency, points: series.points, structuralBreaks: dashboard?.structuralBreaks?.indicators[metric.id] })) : fetch(`/api/indicator?id=${metric.id}`, { signal: controller.signal, ...(detailRetry ? {cache: "no-cache" as const} : {}) })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to load data");
        return payload as IndicatorData;
      });
    request.then((payload) => {
        if (!active) return;
        setData(payload);
        setCustomStart(payload.points[0]?.date ?? "");
        setCustomEnd(payload.points[payload.points.length - 1]?.date ?? "");
      })
      .catch((reason: Error) => active && setError(reason.name === "AbortError" ? "Historical data took too long to load. Please retry." : reason.message))
      .finally(() => clearTimeout(timeout));
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [metric, detailRetry]);

  const filtered = useMemo(() => {
    if (!data?.points.length) return [];
    const end = new Date(`${data.points[data.points.length - 1].date}T00:00:00`);
    let start: Date | null = null;
    if (range !== "ALL" && range !== "CUSTOM") {
      start = new Date(end);
      start.setFullYear(start.getFullYear() - Number(range.replace("Y", "")));
    }
    return data.points.filter((point) => {
      const date = new Date(`${point.date}T00:00:00`);
      if (range === "CUSTOM") {
        return (!customStart || point.date >= customStart)
          && (!customEnd || point.date <= customEnd);
      }
      return !start || date >= start;
    });
  }, [data, range, customStart, customEnd]);

  const analysis = data ? buildAnalysis(data, filtered) : null;

  return (
    <div ref={overlayRef} className="detail-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={panelRef} className="detail-panel" role="dialog" aria-modal="true" aria-labelledby="detail-title" tabIndex={-1}>
        <header className="detail-header">
          <div>
            <span className="detail-kicker">Interactive indicator explorer</span>
            <h2 id="detail-title">{data?.title ?? metric.label}</h2>
            <p>{data ? `${data.frequency} · ${data.points.length} observations available` : error ? "Historical data is unavailable. No values are estimated." : "Loading the official historical series…"}</p>
          </div>
          <button className="detail-close" onClick={onClose} aria-label="Close indicator details">×</button>
        </header>

        {error && <div className="detail-error" role="alert"><p>{error}</p><button type="button" onClick={() => setDetailRetry(value => value + 1)}>Retry historical data</button></div>}
        {!data && !error && <div className="detail-loading"><i /><span>Retrieving and validating the official series…</span></div>}

        {data && (
          <>
            {(metric.id === "headline" || metric.id === "core") && (
              <aside className="indicator-definition" aria-label={`${metric.label} definition`}>
                <span>What this index means</span>
                <p><strong>{inflationDefinitions[metric.id].short}</strong> {inflationDefinitions[metric.id].explanation}</p>
              </aside>
            )}
            <div className="range-toolbar" aria-label="Select time frame">
              <span>Time frame</span>
              <div>
                {(["1Y", "3Y", "5Y", "10Y", "ALL"] as RangeKey[]).map((option) => (
                  <button
                    key={option}
                    className={range === option ? "active" : ""}
                    aria-pressed={range === option}
                    onClick={() => setRange(option)}
                  >
                    {option === "ALL" ? "All" : option}
                  </button>
                ))}
                <button className={range === "CUSTOM" ? "active" : ""} aria-pressed={range === "CUSTOM"} onClick={() => setRange("CUSTOM")}>Custom</button>
              </div>
            </div>

            {range === "CUSTOM" && (
              <div className="custom-range">
                <label>From<input type="date" value={customStart} min={data.points[0]?.date} max={customEnd} onChange={(event) => setCustomStart(event.target.value)} /></label>
                <label>To<input type="date" value={customEnd} min={customStart} max={data.points[data.points.length - 1]?.date} onChange={(event) => setCustomEnd(event.target.value)} /></label>
              </div>
            )}

            {filtered.length >= 2 && analysis ? (
              <>
                <TimeSeriesChart data={data} points={filtered} />
                <div className="detail-stats">
                  <article><span>Latest</span><strong>{formatValue(analysis.last.value, data)}</strong><small>{formatDate(analysis.last.date)}</small></article>
                  <article><span>Period change</span><strong className={analysis.change > 0 ? "up" : analysis.change < 0 ? "down" : ""}>{analysis.change > 0 ? "+" : analysis.change < 0 ? "−" : ""}{analysis.changeText}</strong><small>From {formatDate(analysis.first.date)}</small></article>
                  <article><span>Period average</span><strong>{formatValue(analysis.average, data)}</strong><small>{filtered.length} observations</small></article>
                  <article><span>Range</span><strong>{formatValue(analysis.low.value, data)} – {formatValue(analysis.high.value, data)}</strong><small>Low to high</small></article>
                </div>
                <div className="detail-analysis">
                  <div>
                    <span>Period analysis</span>
                    <h2>{data.title} ended the selected period {analysis.direction}.</h2>
                  </div>
                  <p>
                    It moved from {formatValue(analysis.first.value, data)} in {formatDate(analysis.first.date)}
                    {" "}to {formatValue(analysis.last.value, data)} in {formatDate(analysis.last.date)}.
                    {" "}{analysis.meaning}
                  </p>
                  <small>Successive-observation change volatility: {analysis.volatility.toFixed(data.decimals + 1)} {data.unit === "RM" ? "ringgit" : "percentage points"}. This is the spread of changes between published observations ({data.frequency}), not an annualised measure. Observation spacing can differ. This is descriptive analysis, not a causal estimate or forecast.</small>
                </div>
                {loadComparison && !comparisonContext && <div className="dashboard-load-status" role="status" aria-live="polite"><p>Related indicator histories have not been loaded. Load them to inspect co-movement over this selected window.</p><button type="button" onClick={requestComparison} disabled={comparisonLoading}>{comparisonLoading ? "Loading comparison evidence…" : comparisonError ? "Retry comparison evidence" : "Load comparison evidence"}</button>{comparisonError && <p>{comparisonError}</p>}</div>}
                <WhyAnalysis data={data} points={filtered} dashboard={comparisonContext ?? dashboard} comparisonPending={Boolean(loadComparison && !comparisonContext)} />
                {data.structuralBreaks && (
                  <div className="detail-structural">
                    <div><span>Structural shift screen</span><strong>{data.structuralBreaks.candidates.filter((candidate) => candidate.status === "supported").length} supported break{data.structuralBreaks.candidates.filter((candidate) => candidate.status === "supported").length === 1 ? "" : "s"}</strong></div>
                    <small>Diagnostic data status: {healthStatusLabel(dashboard?.usingFallback ? "fallback" : data.structuralBreaks.status)}. Statistical evidence does not establish data freshness.</small>
                    <p>{data.structuralBreaks.narrative}</p>
                    <a href={`/structural?indicator=${metric.id}`} onClick={onClose}>Open full diagnostics →</a>
                  </div>
                )}
              </>
            ) : (
              <div className="detail-error">Choose a wider date range containing at least two observations.</div>
            )}

            <div className="detail-footer">
              <div>
                <span>Source</span>
                <a href={data.sourceUrl} target="_blank" rel="noreferrer">{data.source} ↗</a>
              </div>
              <button aria-expanded={showTable} aria-controls="indicator-data-table" onClick={() => setShowTable(!showTable)}>{showTable ? "Hide data table" : `Show all ${filtered.length} data points`}</button>
            </div>

            {showTable && (
              <div className="data-table-wrap" id="indicator-data-table">
                <table>
                  <thead><tr><th>Period</th><th>{data.title}</th><th>Change from previous</th></tr></thead>
                  <tbody>
                    {[...filtered].reverse().map((point, index, reversed) => {
                      const previous = reversed[index + 1];
                      const change = previous ? point.value - previous.value : null;
                      return (
                        <tr key={point.date}>
                          <td>{formatDate(point.date)}</td>
                          <td>{formatValue(point.value, data)}</td>
                          <td>{change === null ? "—" : `${change > 0 ? "+" : ""}${change.toFixed(data.decimals)}`}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

export const mechanismNotes: Record<MetricId, Array<{ title: string; copy: string }>> = {
  headline: [
    { title: "Food, energy and administered prices", copy: "Headline inflation can move quickly when food, fuel, utilities, taxes or subsidies change because these items are included directly in the household basket." },
    { title: "Imported cost pressure", copy: "A weaker ringgit can raise the local-currency cost of imported food, fuel and production inputs, although firms may absorb part of the change in margins." },
    { title: "Domestic demand and wages", copy: "Strong spending or wage growth can allow businesses to pass higher costs through to consumer prices; weak demand can limit that pass-through." },
  ],
  core: [
    { title: "Persistent domestic demand", copy: "Core inflation removes selected volatile or administered items, so sustained services demand and business pricing power often matter more than one-off commodity moves." },
    { title: "Wages and operating costs", copy: "Labour, rent and recurring input costs can create broader price pressure when firms pass them through across many categories." },
    { title: "Delayed monetary-policy effects", copy: "Changes in interest rates influence borrowing and spending gradually, so the effect on underlying inflation normally appears with a lag." },
  ],
  opr: [
    { title: "Inflation outlook", copy: "BNM sets the OPR prospectively. Persistent or rising inflation risks can support tighter policy, while subdued pressure can create room for easing." },
    { title: "Growth and labour conditions", copy: "Policy also considers whether demand, employment and financial conditions are strong enough to sustain price pressure." },
    { title: "Risk management", copy: "An OPR decision is not a mechanical reaction to one indicator; BNM weighs the balance of risks and the expected path of the economy." },
  ],
  unemployment: [
    { title: "Economic activity and shocks", copy: "Businesses tend to reduce hiring or employment when sales and production weaken, while recoveries usually improve labour demand with a delay." },
    { title: "Participation and labour supply", copy: "The unemployment rate can change because both the number of unemployed people and the size of the labour force change." },
    { title: "Sector reallocation", copy: "Different industries recover or contract at different speeds, creating mismatches between available workers, skills and locations." },
  ],
  fx: [
    { title: "Relative interest-rate expectations", copy: "The ringgit can respond when expected Malaysian returns change relative to US and other global interest rates, affecting cross-border capital demand." },
    { title: "Trade, commodities and global risk", copy: "Export receipts, commodity prices, global growth and investor risk appetite can alter demand for ringgit assets." },
    { title: "Many forces move together", copy: "USD/MYR is a relative price between two currencies, so a move may originate in Malaysia, the United States or global markets." },
  ],
  mgs: [
    { title: "Expected OPR and inflation", copy: "Long-term government yields embed expectations about future short rates and inflation, not only the current OPR." },
    { title: "Global bond markets", copy: "US Treasury yields and global risk appetite can affect the return investors require from Malaysian government bonds." },
    { title: "Term premium and bond supply", copy: "Fiscal borrowing, market liquidity and uncertainty can change the extra yield required to hold a long-maturity bond." },
  ],
};

export function monthlyLast(points: DataPoint[], start: string, end: string) {
  const months = new Map<string, number>();
  points.filter((point) => point.date >= start && point.date <= end).forEach((point) => months.set(point.date.slice(0, 7), point.value));
  return months;
}

export function correlation(left: number[], right: number[]) {
  if (left.length !== right.length || left.length < 3) return null;
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
  let covariance = 0, leftVariance = 0, rightVariance = 0;
  left.forEach((value, index) => {
    const a = value - leftMean, b = right[index] - rightMean;
    covariance += a * b; leftVariance += a * a; rightVariance += b * b;
  });
  const denominator = Math.sqrt(leftVariance * rightVariance);
  return denominator ? covariance / denominator : null;
}

export function buildWhyEvidence(data: IndicatorData, points: DataPoint[], dashboard: IndicatorContext | null) {
  const start = points[0].date, end = points.at(-1)!.date;
  const target = monthlyLast(points, start, end);
  const associations = Object.entries(dashboard?.series ?? {}).filter(([id]) => id !== data.id).map(([id, series]) => {
    const related = monthlyLast(series.points, start, end);
    const changes = consecutiveMonthlyChanges(target, related);
    const targetChanges = changes.left, relatedChanges = changes.right;
    return { id, title: series.title, value: correlation(targetChanges, relatedChanges), observations: targetChanges.length };
  }).filter((item) => item.value != null && item.observations >= 12).sort((a, b) => Math.abs(b.value!) - Math.abs(a.value!));
  const strongest = associations[0] ?? null;

  const annual = new Map<string, DataPoint[]>();
  points.forEach((point) => { const year = point.date.slice(0, 4); annual.set(year, [...(annual.get(year) ?? []), point]); });
  const annualRows = [...annual.entries()].map(([year, values]) => ({ year, first: values[0], last: values.at(-1)!, change: values.at(-1)!.value - values[0].value })).reverse();
  const breaks = (data.structuralBreaks?.candidates ?? []).filter((candidate) => candidate.breakPeriod >= start && candidate.breakPeriod <= end).reverse();
  const categories = data.id === "headline" || data.id === "core" ? (dashboard?.categories ?? []).slice(0, 3) : [];
  return { strongest, annualRows, breaks, categories, mechanisms: mechanismNotes[data.id] };
}

export function WhyAnalysis({ data, points, dashboard, comparisonPending = false }: { data: IndicatorData; points: DataPoint[]; dashboard: IndicatorContext | null; comparisonPending?: boolean }) {
  const evidence = useMemo(() => buildWhyEvidence(data, points, dashboard), [data, points, dashboard]);
  const strongest = evidence.strongest;
  const featuredBreak = evidence.breaks[0];
  const associationStrength = strongest ? Math.abs(strongest.value!) >= .6 ? "strong" : Math.abs(strongest.value!) >= .35 ? "moderate" : "weak" : "unavailable";
  return <section className="why-analysis" aria-labelledby="why-heading">
    <div className="why-heading"><div><span>Evidence-based explanation</span><h2 id="why-heading">Why did it change?</h2></div><p>The dashboard tests clues that moved during your selected period. It reports what the data support, then explains plausible mechanisms without claiming that correlation proves cause.</p></div>
    <div className="why-evidence-grid">
      <article><span>Co-movement clue</span>{comparisonPending ? <><strong>Comparison history not loaded</strong><p>Use “Load comparison evidence” to retrieve the related official histories before evaluating overlap.</p></> : strongest ? <><strong>{strongest.title}</strong><p>{data.title} and {strongest.title.toLowerCase()} monthly changes had a {associationStrength} {strongest.value! >= 0 ? "positive" : "negative"} association (r = {strongest.value!.toFixed(2)}, {strongest.observations} overlapping changes).</p></> : <><strong>Insufficient overlap</strong><p>The selected window does not contain at least 12 comparable monthly changes across another dashboard series.</p></>}<small>Association is a screening clue, not a causal estimate.</small></article>
      <article><span>Structural and event evidence</span>{featuredBreak ? <><strong>{featuredBreak.statusLabel} near {formatDate(featuredBreak.breakPeriod)}</strong><p>Adjusted Chow p {formatP(featuredBreak.chow.pHolm)}; HAC p {formatP(featuredBreak.hacWald.pValue)}. {featuredBreak.nearbyEvents.length ? `The screen matched ${featuredBreak.nearbyEvents.length} official event${featuredBreak.nearbyEvents.length > 1 ? "s" : ""} within six months.` : "No catalogue event was close enough to attach."}</p></> : <><strong>No screened break in this window</strong><p>The current stability model did not place a selected breakpoint inside this exact period. Gradual change can still occur without a discrete break.</p></>}<small>Data-selected break tests are exploratory and can change after revisions.</small></article>
    </div>
    {!!featuredBreak?.nearbyEvents.length && <div className="why-events">{featuredBreak.nearbyEvents.map((event) => <a key={`${event.date}-${event.title}`} href={event.sourceUrl} target="_blank" rel="noreferrer"><time>{formatDate(event.date)}</time><span>{event.title}</span><b>{event.source} ↗</b></a>)}</div>}
    <div className="mechanism-grid">{evidence.mechanisms.map((item, index) => <article key={item.title}><span>0{index + 1}</span><div><h4>{item.title}</h4><p>{item.copy}</p></div></article>)}</div>
    {!!evidence.categories.length && <div className="latest-pressure"><span>Latest CPI pressure check</span><p>{evidence.categories.map((item) => `${item.name} ${item.value > 0 ? "+" : ""}${item.value.toFixed(1)}%`).join(" · ")}</p><small>These are latest unweighted division inflation rates, not historical contribution weights, so they explain current concentration rather than the whole selected period.</small></div>}
    <details className="annual-evidence"><summary>See the change year by year</summary><div><table><thead><tr><th>Year</th><th>First observation</th><th>Last observation</th><th>Within-year change</th></tr></thead><tbody>{evidence.annualRows.map((row) => <tr key={row.year}><td>{row.year}</td><td>{formatValue(row.first.value, data)}</td><td>{formatValue(row.last.value, data)}</td><td className={row.change < 0 ? "down" : row.change > 0 ? "up" : ""}>{row.change > 0 ? "+" : ""}{row.change.toFixed(data.decimals)} {data.unit === "RM" ? "RM" : "pp"}</td></tr>)}</tbody></table></div></details>
    <p className="why-limit"><b>Interpretation boundary:</b> an economic cause requires more evidence than timing or correlation. Policy decisions, global shocks, expectations and data revisions may matter even when they are not represented by these six series.</p>
  </section>;
}


export default IndicatorDetail;
