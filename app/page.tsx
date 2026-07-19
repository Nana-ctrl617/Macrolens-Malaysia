"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DashboardPayload, StructuralCandidate, StructuralIndicator } from "@/app/lib/dashboard";

const metrics = [
  { id: "headline", label: "Headline inflation", value: "2.0%", detail: "Year on year", period: "May 2026", tone: "rust" },
  { id: "core", label: "Core inflation", value: "2.0%", detail: "Underlying pressure", period: "May 2026", tone: "teal" },
  { id: "opr", label: "Overnight Policy Rate", value: "2.75%", detail: "BNM policy setting", period: "Jul 2026", tone: "navy" },
  { id: "unemployment", label: "Unemployment", value: "3.0%", detail: "Share of labour force", period: "May 2026", tone: "teal" },
  { id: "fx", label: "USD / MYR", value: "RM 4.04", detail: "Monthly average", period: "May 2026", tone: "navy" },
  { id: "mgs", label: "10-year MGS", value: "3.63%", detail: "Government bond yield", period: "Jul 2026", tone: "rust" },
];

const history = [1.8, 1.8, 1.9, 1.8, 1.7, 1.7, 1.5, 1.4, 1.4, 1.2, 1.1, 1.2, 1.3, 1.5, 1.3, 1.4, 1.6, 1.6, 1.4, 1.7, 1.9, 2.0];
const historyLabels = ["Aug 24", "Nov 24", "Feb 25", "May 25", "Aug 25", "Nov 25", "Feb 26", "May 26"];

const forecasts = [
  { month: "Jun 2026", value: 2.09, low80: 1.47, high80: 2.70, low95: 1.15, high95: 3.03 },
  { month: "Jul 2026", value: 2.05, low80: 0.92, high80: 3.18, low95: 0.33, high95: 3.78 },
  { month: "Aug 2026", value: 2.02, low80: 0.60, high80: 3.44, low95: -0.15, high95: 4.19 },
];

const models = [
  { name: "SARIMA", rmse: 0.18, mae: 0.13, selected: true },
  { name: "ARIMAX", rmse: 0.23, mae: 0.20, selected: false },
  { name: "Seasonal naive", rmse: 0.53, mae: 0.46, selected: false },
];

const categories = [
  ["Restaurants & accommodation", 3.6],
  ["Insurance & financial services", 3.1],
  ["Personal care & miscellaneous", 2.8],
  ["Housing, water & energy", 2.4],
  ["Food & non-alcoholic beverages", 2.1],
  ["Health", 1.7],
  ["Transport", 1.2],
  ["Information & communication", -0.4],
] as const;

const reviewIdeas = [
  { number: "01", title: "Add data vintages", copy: "Recreate what forecasters knew at each historical date, not only today’s revised series." },
  { number: "02", title: "Use official CPI weights", copy: "Turn category pressure into a true contribution-to-inflation decomposition." },
  { number: "03", title: "Make scenarios interactive", copy: "Let users stress USD/MYR, OPR and commodity assumptions while keeping causal claims cautious." },
  { number: "04", title: "Automate monthly refreshes", copy: "Store validated releases and publish a concise change log whenever official data update." },
];

export type DashboardSection = "snapshot" | "forecast" | "drivers" | "bursa" | "structural" | "methodology";

const navigation: Array<{ id: DashboardSection; label: string; href: string }> = [
  { id: "snapshot", label: "Snapshot", href: "/" },
  { id: "forecast", label: "Forecast", href: "/forecast" },
  { id: "drivers", label: "Drivers", href: "/drivers" },
  { id: "bursa", label: "Bursa", href: "/bursa" },
  { id: "structural", label: "Structural shifts", href: "/structural" },
  { id: "methodology", label: "Methodology", href: "/methodology" },
];

function Header({ active }: { active: DashboardSection }) {
  const activeLinkRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    activeLinkRef.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [active]);
  return (
    <header className="site-header">
      <a className="brand" href="/" aria-label="MacroLens Malaysia home">
        <span className="brand-dot" />
        <span>MacroLens Malaysia</span>
      </a>
      <nav aria-label="Primary navigation">
        {navigation.map((item) => <a key={item.id} ref={active === item.id ? activeLinkRef : undefined} className={active === item.id ? "active" : ""} aria-current={active === item.id ? "page" : undefined} href={item.href}>{item.label}</a>)}
      </nav>
      <a className="source-link" href="https://data.gov.my/" target="_blank" rel="noreferrer">Official sources ↗</a>
    </header>
  );
}

type MetricId = "headline" | "core" | "opr" | "unemployment" | "fx" | "mgs";
type Metric = { id: MetricId; label: string; value: string; detail: string; period: string; tone: string; status?: string };
type RangeKey = "1Y" | "3Y" | "5Y" | "10Y" | "ALL" | "CUSTOM";
type DataPoint = { date: string; value: number };
type IndicatorData = {
  id: MetricId;
  title: string;
  unit: string;
  decimals: number;
  source: string;
  sourceUrl: string;
  frequency: string;
  points: DataPoint[];
  structuralBreaks?: StructuralIndicator;
};

function formatDate(date: string) {
  const includeDay = !date.endsWith("-01");
  return new Intl.DateTimeFormat("en-MY", includeDay ? { day: "numeric", month: "short", year: "numeric" } : { month: "short", year: "numeric" })
    .format(new Date(`${date}T00:00:00`));
}

function formatValue(value: number, data: IndicatorData) {
  return data.unit === "RM"
    ? `RM ${value.toFixed(data.decimals)}`
    : `${value.toFixed(data.decimals)}${data.unit}`;
}

function buildAnalysis(data: IndicatorData, points: DataPoint[]) {
  if (points.length < 2) return null;
  const values = points.map((point) => point.value);
  const first = points[0];
  const last = points[points.length - 1];
  const change = last.value - first.value;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const high = points.reduce((best, point) => point.value > best.value ? point : best);
  const low = points.reduce((best, point) => point.value < best.value ? point : best);
  const monthlyChanges = values.slice(1).map((value, index) => value - values[index]);
  const changeAverage = monthlyChanges.reduce((sum, value) => sum + value, 0) / monthlyChanges.length;
  const volatility = Math.sqrt(
    monthlyChanges.reduce((sum, value) => sum + (value - changeAverage) ** 2, 0)
    / monthlyChanges.length,
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

function TimeSeriesChart({ data, points }: { data: IndicatorData; points: DataPoint[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hovered, setHovered] = useState<{ point: DataPoint; left: number; top: number; tooltipLeft: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || points.length < 2) return;
    const container = canvas.parentElement;
    if (!container) return;

    const draw = () => {
      const width = Math.max(container.clientWidth, 320);
      const height = 330;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.scale(ratio, ratio);
      context.clearRect(0, 0, width, height);

      const padding = { top: 28, right: 22, bottom: 44, left: 58 };
      const chartWidth = width - padding.left - padding.right;
      const chartHeight = height - padding.top - padding.bottom;
      const values = points.map((point) => point.value);
      let min = Math.min(...values);
      let max = Math.max(...values);
      const spread = Math.max(max - min, data.id === "fx" ? 0.15 : 0.5);
      min -= spread * 0.14;
      max += spread * 0.14;
      const x = (index: number) => padding.left + index / (points.length - 1) * chartWidth;
      const y = (value: number) => padding.top + (max - value) / (max - min) * chartHeight;

      context.font = "500 12px DM Sans, sans-serif";
      context.fillStyle = "#7b837f";
      context.strokeStyle = "#e1dbd0";
      context.lineWidth = 1;
      for (let index = 0; index < 5; index += 1) {
        const value = max - index / 4 * (max - min);
        const yPosition = padding.top + index / 4 * chartHeight;
        context.beginPath();
        context.moveTo(padding.left, yPosition);
        context.lineTo(width - padding.right, yPosition);
        context.stroke();
        context.fillText(
          data.unit === "RM" ? value.toFixed(2) : `${value.toFixed(data.decimals)}%`,
          4,
          yPosition + 4,
        );
      }

      const gradient = context.createLinearGradient(0, padding.top, 0, height - padding.bottom);
      gradient.addColorStop(0, "rgba(223,91,54,.24)");
      gradient.addColorStop(1, "rgba(223,91,54,0)");
      context.beginPath();
      points.forEach((point, index) => {
        if (index === 0) context.moveTo(x(index), y(point.value));
        else context.lineTo(x(index), y(point.value));
      });
      context.lineTo(x(points.length - 1), height - padding.bottom);
      context.lineTo(x(0), height - padding.bottom);
      context.closePath();
      context.fillStyle = gradient;
      context.fill();

      context.beginPath();
      points.forEach((point, index) => {
        if (index === 0) context.moveTo(x(index), y(point.value));
        else context.lineTo(x(index), y(point.value));
      });
      context.strokeStyle = "#df5b36";
      context.lineWidth = 3;
      context.lineJoin = "round";
      context.lineCap = "round";
      context.stroke();

      [0, Math.floor((points.length - 1) / 2), points.length - 1].forEach((index) => {
        context.fillStyle = "#68716d";
        const label = formatDate(points[index].date);
        const measured = context.measureText(label).width;
        const labelX = index === 0 ? x(index) : index === points.length - 1 ? x(index) - measured : x(index) - measured / 2;
        context.fillText(label, labelX, height - 15);
      });

      const last = points[points.length - 1];
      context.beginPath();
      context.arc(x(points.length - 1), y(last.value), 5, 0, Math.PI * 2);
      context.fillStyle = "#df5b36";
      context.fill();
      context.strokeStyle = "#fffdf7";
      context.lineWidth = 3;
      context.stroke();
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(container);
    return () => observer.disconnect();
  }, [data, points]);

  const showPoint = (clientX: number) => {
    const canvas = canvasRef.current;
    if (!canvas || points.length < 2) return;
    const bounds = canvas.getBoundingClientRect();
    const width = bounds.width;
    const padding = { top: 28, right: 22, bottom: 44, left: 58 };
    const chartWidth = width - padding.left - padding.right;
    const pointerX = Math.min(width - padding.right, Math.max(padding.left, clientX - bounds.left));
    const index = Math.min(points.length - 1, Math.max(0, Math.round((pointerX - padding.left) / chartWidth * (points.length - 1))));
    const values = points.map((point) => point.value);
    let min = Math.min(...values), max = Math.max(...values);
    const spread = Math.max(max - min, data.id === "fx" ? 0.15 : 0.5);
    min -= spread * 0.14; max += spread * 0.14;
    const canvasLeft = padding.left + index / (points.length - 1) * chartWidth;
    const canvasTop = padding.top + (max - points[index].value) / (max - min) * (330 - padding.top - padding.bottom);
    const left = canvas.offsetLeft + canvasLeft;
    const top = canvas.offsetTop + canvasTop;
    setHovered({ point: points[index], left, top, tooltipLeft: canvas.offsetLeft + Math.min(width - 76, Math.max(76, canvasLeft)) });
  };

  return (
    <div className="detail-chart-wrap">
      <canvas
        ref={canvasRef}
        role="img"
        tabIndex={0}
        aria-label={`${data.title} chart with ${points.length} observations from ${formatDate(points[0].date)} to ${formatDate(points[points.length - 1].date)}`}
        onPointerMove={(event) => showPoint(event.clientX)}
        onPointerDown={(event) => showPoint(event.clientX)}
        onTouchStart={(event) => showPoint(event.touches[0].clientX)}
        onClick={(event) => showPoint(event.clientX)}
        onPointerLeave={(event) => event.pointerType === "mouse" && setHovered(null)}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          const current = hovered ? points.findIndex((point) => point.date === hovered.point.date) : points.length - 1;
          const next = Math.min(points.length - 1, Math.max(0, current + (event.key === "ArrowRight" ? 1 : -1)));
          const bounds = event.currentTarget.getBoundingClientRect();
          showPoint(bounds.left + 58 + next / (points.length - 1) * (bounds.width - 80));
        }}
      />
      {hovered && <>
        <i className="chart-hover-dot" style={{ left: hovered.left, top: hovered.top }} />
        <div className="chart-tooltip" role="status" style={{ left: hovered.tooltipLeft, top: hovered.top }}>
          <span>{formatDate(hovered.point.date)}</span><strong>{formatValue(hovered.point.value, data)}</strong>
        </div>
      </>}
      <small className="chart-interaction-hint">Hover, tap, or use the arrow keys to inspect each observation.</small>
    </div>
  );
}

function MetricCard({ metric, onSelect }: { metric: Metric; onSelect: (metric: Metric) => void }) {
  return (
    <button
      className={`metric-card ${metric.tone}`}
      onClick={() => onSelect(metric)}
      aria-label={`Open historical data for ${metric.label}`}
    >
      <div className="metric-topline"><span>{metric.label}</span><i /></div>
      <strong>{metric.value}</strong>
      <p>{metric.detail}</p>
      <small>Release period · {metric.period}</small>
      {metric.status && <span className={`metric-status ${metric.status}`}>{metric.status}</span>}
      <span className="metric-open">View history <b>↗</b></span>
    </button>
  );
}

function IndicatorDetail({ metric, onClose }: { metric: Metric; onClose: () => void }) {
  const [data, setData] = useState<IndicatorData | null>(null);
  const [error, setError] = useState("");
  const [range, setRange] = useState<RangeKey>("5Y");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    document.body.classList.add("modal-open");
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeWithEscape);
    return () => {
      document.body.classList.remove("modal-open");
      window.removeEventListener("keydown", closeWithEscape);
    };
  }, [onClose]);

  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    fetch(`/api/indicator?id=${metric.id}`)
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to load data");
        return payload as IndicatorData;
      })
      .then((payload) => {
        if (!active) return;
        setData(payload);
        setCustomStart(payload.points[0]?.date ?? "");
        setCustomEnd(payload.points[payload.points.length - 1]?.date ?? "");
      })
      .catch((reason: Error) => active && setError(reason.message));
    return () => { active = false; };
  }, [metric]);

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
    <div className="detail-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="detail-panel" role="dialog" aria-modal="true" aria-labelledby="detail-title">
        <header className="detail-header">
          <div>
            <span className="detail-kicker">Interactive indicator explorer</span>
            <h2 id="detail-title">{data?.title ?? metric.label}</h2>
            <p>{data ? `${data.frequency} · ${data.points.length} observations available` : "Loading the official historical series…"}</p>
          </div>
          <button className="detail-close" onClick={onClose} aria-label="Close indicator details">×</button>
        </header>

        {error && <div className="detail-error">{error}</div>}
        {!data && !error && <div className="detail-loading"><i /><span>Retrieving and validating the official series…</span></div>}

        {data && (
          <>
            <div className="range-toolbar" aria-label="Select time frame">
              <span>Time frame</span>
              <div>
                {(["1Y", "3Y", "5Y", "10Y", "ALL"] as RangeKey[]).map((option) => (
                  <button
                    key={option}
                    className={range === option ? "active" : ""}
                    onClick={() => setRange(option)}
                  >
                    {option === "ALL" ? "All" : option}
                  </button>
                ))}
                <button className={range === "CUSTOM" ? "active" : ""} onClick={() => setRange("CUSTOM")}>Custom</button>
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
                    <h3>{data.title} ended the selected period {analysis.direction}.</h3>
                  </div>
                  <p>
                    It moved from {formatValue(analysis.first.value, data)} in {formatDate(analysis.first.date)}
                    {" "}to {formatValue(analysis.last.value, data)} in {formatDate(analysis.last.date)}.
                    {" "}{analysis.meaning}
                  </p>
                  <small>Monthly-change volatility: {analysis.volatility.toFixed(data.decimals + 1)} {data.unit === "RM" ? "ringgit" : "percentage points"}. This is descriptive analysis, not a causal estimate or forecast.</small>
                </div>
                {data.structuralBreaks && (
                  <div className="detail-structural">
                    <div><span>Structural shift screen</span><strong>{data.structuralBreaks.candidates.filter((candidate) => candidate.status === "supported").length} supported break{data.structuralBreaks.candidates.filter((candidate) => candidate.status === "supported").length === 1 ? "" : "s"}</strong></div>
                    <p>{data.structuralBreaks.narrative}</p>
                    <a href="#structural" onClick={onClose}>Open full diagnostics ↓</a>
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
              <button onClick={() => setShowTable(!showTable)}>{showTable ? "Hide data table" : `Show all ${filtered.length} data points`}</button>
            </div>

            {showTable && (
              <div className="data-table-wrap">
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

const structuralLabels: Record<MetricId, string> = {
  headline: "Headline inflation", core: "Core inflation", opr: "OPR",
  unemployment: "Unemployment", fx: "USD / MYR", mgs: "10-year MGS",
};

function formatP(value: number | null) {
  if (value == null) return "—";
  if (value < 0.0001) return "<0.0001";
  return value.toFixed(4);
}

function StructuralChart({ data, points, candidates }: { data: IndicatorData; points: DataPoint[]; candidates: StructuralCandidate[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hovered, setHovered] = useState<{ point: DataPoint; left: number; top: number; tooltipLeft: number } | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = canvas?.parentElement;
    if (!canvas || !container || points.length < 2) return;
    const draw = () => {
      const width = Math.max(container.clientWidth, 320);
      const height = 390;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.scale(ratio, ratio);
      context.clearRect(0, 0, width, height);
      const padding = { top: 54, right: 24, bottom: 46, left: 62 };
      const chartWidth = width - padding.left - padding.right;
      const chartHeight = height - padding.top - padding.bottom;
      const times = points.map((point) => new Date(`${point.date}T00:00:00`).getTime());
      const firstTime = times[0], lastTime = times[times.length - 1];
      const xTime = (time: number) => padding.left + (time - firstTime) / Math.max(1, lastTime - firstTime) * chartWidth;
      const values = points.map((point) => point.value);
      let min = Math.min(...values), max = Math.max(...values);
      const spread = Math.max(max - min, data.id === "fx" ? .15 : .5);
      min -= spread * .12; max += spread * .12;
      const y = (value: number) => padding.top + (max - value) / (max - min) * chartHeight;

      const visibleBreaks = candidates.filter((candidate) => {
        const time = new Date(`${candidate.breakPeriod}T00:00:00`).getTime();
        return time >= firstTime && time <= lastTime;
      });
      const regimeEdges = [firstTime, ...visibleBreaks.map((candidate) => new Date(`${candidate.breakPeriod}T00:00:00`).getTime()), lastTime];
      for (let index = 0; index < regimeEdges.length - 1; index += 1) {
        context.fillStyle = index % 2 === 0 ? "rgba(28,107,97,.035)" : "rgba(223,91,54,.045)";
        context.fillRect(xTime(regimeEdges[index]), padding.top, xTime(regimeEdges[index + 1]) - xTime(regimeEdges[index]), chartHeight);
      }
      context.font = "500 12px DM Sans, sans-serif";
      for (let index = 0; index < 5; index += 1) {
        const value = max - index / 4 * (max - min);
        const yPosition = padding.top + index / 4 * chartHeight;
        context.strokeStyle = "#e1dbd0"; context.lineWidth = 1;
        context.beginPath(); context.moveTo(padding.left, yPosition); context.lineTo(width - padding.right, yPosition); context.stroke();
        context.fillStyle = "#737c78";
        context.fillText(data.unit === "RM" ? value.toFixed(2) : `${value.toFixed(data.decimals)}%`, 5, yPosition + 4);
      }
      context.beginPath();
      points.forEach((point, index) => {
        const x = xTime(times[index]);
        if (index === 0) context.moveTo(x, y(point.value)); else context.lineTo(x, y(point.value));
      });
      context.strokeStyle = "#213d4a"; context.lineWidth = 2.5; context.lineJoin = "round"; context.stroke();

      visibleBreaks.forEach((candidate, index) => {
        const x = xTime(new Date(`${candidate.breakPeriod}T00:00:00`).getTime());
        context.setLineDash([6, 5]);
        context.strokeStyle = candidate.status === "supported" ? "#df5b36" : candidate.status === "possible" ? "#b78332" : "#8b928f";
        context.lineWidth = 2; context.beginPath(); context.moveTo(x, padding.top); context.lineTo(x, height - padding.bottom); context.stroke(); context.setLineDash([]);
        context.fillStyle = context.strokeStyle;
        context.font = "700 11px DM Sans, sans-serif";
        const label = new Intl.DateTimeFormat("en-MY", { month: "short", year: "numeric" }).format(new Date(`${candidate.breakPeriod}T00:00:00`));
        const offset = index % 2 === 0 ? 18 : 33;
        context.fillText(label, Math.min(x + 5, width - 78), offset);
        if (candidate.nearbyEvents.length) {
          context.beginPath(); context.arc(x, padding.top + 8, 4, 0, Math.PI * 2); context.fill();
        }
      });
      [0, Math.floor((points.length - 1) / 2), points.length - 1].forEach((index) => {
        const label = formatDate(points[index].date);
        context.font = "500 12px DM Sans, sans-serif"; context.fillStyle = "#56615d";
        const measured = context.measureText(label).width;
        const x = xTime(times[index]);
        context.fillText(label, index === 0 ? x : index === points.length - 1 ? x - measured : x - measured / 2, height - 15);
      });
    };
    draw();
    const observer = new ResizeObserver(draw); observer.observe(container);
    return () => observer.disconnect();
  }, [data, points, candidates]);

  const showPoint = (clientX: number) => {
    const canvas = canvasRef.current;
    if (!canvas || points.length < 2) return;
    const bounds = canvas.getBoundingClientRect();
    const width = bounds.width;
    const padding = { top: 54, right: 24, bottom: 46, left: 62 };
    const chartWidth = width - padding.left - padding.right;
    const pointerX = Math.min(width - padding.right, Math.max(padding.left, clientX - bounds.left));
    const firstTime = new Date(`${points[0].date}T00:00:00`).getTime();
    const lastTime = new Date(`${points[points.length - 1].date}T00:00:00`).getTime();
    const targetTime = firstTime + (pointerX - padding.left) / chartWidth * (lastTime - firstTime);
    let index = 0;
    let closest = Number.POSITIVE_INFINITY;
    points.forEach((point, pointIndex) => {
      const distance = Math.abs(new Date(`${point.date}T00:00:00`).getTime() - targetTime);
      if (distance < closest) { closest = distance; index = pointIndex; }
    });
    const values = points.map((point) => point.value);
    let min = Math.min(...values), max = Math.max(...values);
    const spread = Math.max(max - min, data.id === "fx" ? 0.15 : 0.5);
    min -= spread * 0.12; max += spread * 0.12;
    const pointTime = new Date(`${points[index].date}T00:00:00`).getTime();
    const canvasLeft = padding.left + (pointTime - firstTime) / Math.max(1, lastTime - firstTime) * chartWidth;
    const canvasTop = padding.top + (max - points[index].value) / (max - min) * (390 - padding.top - padding.bottom);
    const left = canvas.offsetLeft + canvasLeft;
    const top = canvas.offsetTop + canvasTop;
    setHovered({ point: points[index], left, top, tooltipLeft: canvas.offsetLeft + Math.min(width - 76, Math.max(76, canvasLeft)) });
  };

  return <div className="structural-chart">
    <canvas
      ref={canvasRef}
      role="img"
      tabIndex={0}
      aria-label={`${data.title} structural-break chart with ${candidates.length} candidate breaks`}
      onPointerMove={(event) => showPoint(event.clientX)}
      onPointerDown={(event) => showPoint(event.clientX)}
      onTouchStart={(event) => showPoint(event.touches[0].clientX)}
      onClick={(event) => showPoint(event.clientX)}
      onPointerLeave={(event) => event.pointerType === "mouse" && setHovered(null)}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const current = hovered ? points.findIndex((point) => point.date === hovered.point.date) : points.length - 1;
        const next = Math.min(points.length - 1, Math.max(0, current + (event.key === "ArrowRight" ? 1 : -1)));
        const bounds = event.currentTarget.getBoundingClientRect();
        const firstTime = new Date(`${points[0].date}T00:00:00`).getTime();
        const lastTime = new Date(`${points[points.length - 1].date}T00:00:00`).getTime();
        const pointTime = new Date(`${points[next].date}T00:00:00`).getTime();
        showPoint(bounds.left + 62 + (pointTime - firstTime) / Math.max(1, lastTime - firstTime) * (bounds.width - 86));
      }}
    />
    {hovered && <>
      <i className="chart-hover-dot" style={{ left: hovered.left, top: hovered.top }} />
      <div className="chart-tooltip" role="status" style={{ left: hovered.tooltipLeft, top: hovered.top }}><span>{formatDate(hovered.point.date)}</span><strong>{formatValue(hovered.point.value, data)}</strong></div>
    </>}
    <div className="structural-legend"><span><i className="supported" />Supported</span><span><i className="possible" />Possible</span><span><b />Nearby official event</span></div>
    <small className="chart-interaction-hint">Hover, tap, or use the arrow keys to inspect each observation.</small>
  </div>;
}

function StructuralSection({ dashboard }: { dashboard: DashboardPayload | null }) {
  const [selected, setSelected] = useState<MetricId>("core");
  const [range, setRange] = useState<"10Y" | "25Y" | "ALL">("ALL");
  const structural = dashboard?.structuralBreaks;
  const analysis = structural?.indicators[selected];
  const sourceSeries = dashboard?.series[selected];
  const series: IndicatorData | undefined = sourceSeries ? {
    id: selected, title: sourceSeries.title, unit: sourceSeries.unit, decimals: sourceSeries.decimals,
    source: sourceSeries.source, sourceUrl: sourceSeries.source_url, frequency: sourceSeries.frequency, points: sourceSeries.points,
  } : undefined;
  const points = useMemo(() => {
    if (!series) return [];
    if (range === "ALL") return series.points;
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
          <div><span className="section-number">05 / Structural shifts</span><h2>When the pattern changed</h2></div>
          <p>Unknown break dates are screened first, then tested with classical and autocorrelation-robust evidence. A nearby event is context—not a causal explanation.</p>
        </div>
        {!structural || !analysis || !series ? <div className="structural-empty">Structural diagnostics will appear when the version-two dataset is available.</div> : <>
          <div className="structural-toolbar">
            <div className="indicator-tabs" role="tablist" aria-label="Select structural indicator">
              {(Object.keys(structuralLabels) as MetricId[]).map((id) => <button key={id} role="tab" aria-selected={selected === id} className={selected === id ? "active" : ""} onClick={() => setSelected(id)}>{structuralLabels[id]}</button>)}
            </div>
            <div className="structural-range" aria-label="Structural chart time frame">{(["10Y", "25Y", "ALL"] as const).map((option) => <button key={option} className={range === option ? "active" : ""} onClick={() => setRange(option)}>{option === "ALL" ? "All history" : option}</button>)}</div>
          </div>

          <div className="structural-summary">
            <div className="structural-finding">
              <div className="finding-top"><span className={`evidence-badge ${featured?.status ?? "none"}`}>{featured?.statusLabel ?? "No break selected"}</span><small>{analysis.screening.selectedBreaks} BIC candidate{analysis.screening.selectedBreaks === 1 ? "" : "s"}</small></div>
              <h3>{featured ? `${structuralLabels[selected]} changed near ${formatDate(featured.breakPeriod)}.` : `${structuralLabels[selected]} is best described by one stable regime.`}</h3>
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

          {featured && <div className="regime-comparison">
            <article><span>Before regime</span><strong>{formatValue(featured.regimeComparison.preMean, series)}</strong><small>{formatDate(featured.adjacentSample.preStart)}–{formatDate(featured.adjacentSample.preEnd)} · trend {featured.regimeComparison.preAnnualTrend > 0 ? "+" : ""}{featured.regimeComparison.preAnnualTrend.toFixed(series.decimals + 1)}/year</small></article>
            <div className="regime-arrow">→</div>
            <article><span>After regime</span><strong>{formatValue(featured.regimeComparison.postMean, series)}</strong><small>{formatDate(featured.adjacentSample.postStart)}–{formatDate(featured.adjacentSample.postEnd)} · trend {featured.regimeComparison.postAnnualTrend > 0 ? "+" : ""}{featured.regimeComparison.postAnnualTrend.toFixed(series.decimals + 1)}/year</small></article>
            <article className="effect-card"><span>Standardised effect</span><strong>{featured.regimeComparison.standardisedMeanChange?.toFixed(2) ?? "—"}</strong><small>Hedges g; magnitude, not causality</small></article>
          </div>}

          {analysis.warnings.map((warning) => <div className="structural-warning" key={warning}><b>Evidence note</b><span>{warning}</span></div>)}

          <div className="break-table-wrap">
            <div className="break-table-heading"><div><span>Candidate diagnostics</span><h3>Every screened boundary</h3></div><div className="download-links"><a href="/api/structural-breaks?format=csv">Download CSV</a><a href="/api/structural-breaks?format=json">Download JSON</a></div></div>
            {candidates.length ? <table><thead><tr><th>Break</th><th>Evidence</th><th>Chow F (df)</th><th>Raw p</th><th>Holm p</th><th>HAC p</th><th>Mean shift</th></tr></thead><tbody>{candidates.map((candidate) => <tr key={candidate.breakPeriod}><td><strong>{formatDate(candidate.breakPeriod)}</strong><small>{candidate.nearbyEvents.length ? `${candidate.nearbyEvents.length} nearby event${candidate.nearbyEvents.length > 1 ? "s" : ""}` : "No matched event"}</small></td><td><span className={`evidence-badge ${candidate.status}`}>{candidate.statusLabel}</span></td><td>{candidate.chow.fStatistic.toFixed(2)} ({candidate.chow.dfNumerator}, {candidate.chow.dfDenominator})</td><td>{formatP(candidate.chow.pRaw)}</td><td>{formatP(candidate.chow.pHolm)}</td><td>{formatP(candidate.hacWald.pValue)}</td><td>{candidate.regimeComparison.absoluteChange > 0 ? "+" : ""}{candidate.regimeComparison.absoluteChange.toFixed(series.decimals)}</td></tr>)}</tbody></table> : <p className="no-breaks">BIC selected zero breaks, so no post-screening Chow test is reported.</p>}
          </div>

          {!!featured?.nearbyEvents.length && <div className="event-notes"><span className="mini-label">Nearby official events</span>{featured.nearbyEvents.map((event) => <article key={`${event.date}-${event.title}`}><time>{formatDate(event.date)}</time><div><h3>{event.title}</h3><p>The estimated break is within {event.monthDistance} month{event.monthDistance === 1 ? "" : "s"} of this event. Proximity does not demonstrate that the event caused the shift.</p><a href={event.sourceUrl} target="_blank" rel="noreferrer">{event.source} ↗</a></div></article>)}</div>}

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

type MarketRange = "1M" | "3M" | "YTD" | "1Y" | "3Y" | "5Y" | "ALL";

function signedPercent(value: number | null) {
  if (value == null) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function MarketChart({ points }: { points: DataPoint[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hovered, setHovered] = useState<{ point: DataPoint; left: number; top: number; tooltipLeft: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = canvas?.parentElement;
    if (!canvas || !container || points.length < 2) return;
    const draw = () => {
      const width = Math.max(container.clientWidth, 320), height = 350;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = width * ratio; canvas.height = height * ratio;
      canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
      const context = canvas.getContext("2d"); if (!context) return;
      context.scale(ratio, ratio); context.clearRect(0, 0, width, height);
      const padding = { top: 30, right: 24, bottom: 46, left: 66 };
      const chartWidth = width - padding.left - padding.right, chartHeight = height - padding.top - padding.bottom;
      const values = points.map((point) => point.value);
      let min = Math.min(...values), max = Math.max(...values);
      const spread = Math.max(max - min, 30); min -= spread * .1; max += spread * .1;
      const x = (index: number) => padding.left + index / (points.length - 1) * chartWidth;
      const y = (value: number) => padding.top + (max - value) / (max - min) * chartHeight;
      context.font = "600 12px DM Sans, sans-serif";
      for (let index = 0; index < 5; index += 1) {
        const value = max - index / 4 * (max - min), yPosition = padding.top + index / 4 * chartHeight;
        context.strokeStyle = "rgba(255,255,255,.13)"; context.lineWidth = 1;
        context.beginPath(); context.moveTo(padding.left, yPosition); context.lineTo(width - padding.right, yPosition); context.stroke();
        context.fillStyle = "#bdcbc6"; context.fillText(value.toFixed(0), 7, yPosition + 4);
      }
      const gradient = context.createLinearGradient(0, padding.top, 0, height - padding.bottom);
      gradient.addColorStop(0, "rgba(83,196,167,.33)"); gradient.addColorStop(1, "rgba(83,196,167,0)");
      context.beginPath(); points.forEach((point, index) => index ? context.lineTo(x(index), y(point.value)) : context.moveTo(x(index), y(point.value)));
      context.lineTo(x(points.length - 1), height - padding.bottom); context.lineTo(x(0), height - padding.bottom); context.closePath(); context.fillStyle = gradient; context.fill();
      context.beginPath(); points.forEach((point, index) => index ? context.lineTo(x(index), y(point.value)) : context.moveTo(x(index), y(point.value)));
      context.strokeStyle = "#53c4a7"; context.lineWidth = 2.5; context.lineJoin = "round"; context.stroke();
      [0, Math.floor((points.length - 1) / 2), points.length - 1].forEach((index) => {
        const label = formatDate(points[index].date); context.fillStyle = "#bdcbc6";
        const measured = context.measureText(label).width;
        context.fillText(label, index === 0 ? x(index) : index === points.length - 1 ? x(index) - measured : x(index) - measured / 2, height - 15);
      });
    };
    draw(); const observer = new ResizeObserver(draw); observer.observe(container); return () => observer.disconnect();
  }, [points]);

  const showPoint = (clientX: number) => {
    const canvas = canvasRef.current; if (!canvas || points.length < 2) return;
    const bounds = canvas.getBoundingClientRect(), padding = { top: 30, right: 24, bottom: 46, left: 66 };
    const chartWidth = bounds.width - padding.left - padding.right;
    const pointer = Math.min(bounds.width - padding.right, Math.max(padding.left, clientX - bounds.left));
    const index = Math.min(points.length - 1, Math.max(0, Math.round((pointer - padding.left) / chartWidth * (points.length - 1))));
    const values = points.map((point) => point.value); let min = Math.min(...values), max = Math.max(...values);
    const spread = Math.max(max - min, 30); min -= spread * .1; max += spread * .1;
    const canvasLeft = padding.left + index / (points.length - 1) * chartWidth;
    const canvasTop = padding.top + (max - points[index].value) / (max - min) * (350 - padding.top - padding.bottom);
    setHovered({ point: points[index], left: canvas.offsetLeft + canvasLeft, top: canvas.offsetTop + canvasTop, tooltipLeft: canvas.offsetLeft + Math.min(bounds.width - 78, Math.max(78, canvasLeft)) });
  };

  return <div className="market-chart">
    <canvas ref={canvasRef} tabIndex={0} role="img" aria-label="FTSE Bursa Malaysia KLCI historical daily closing levels"
      onPointerMove={(event) => showPoint(event.clientX)} onPointerDown={(event) => showPoint(event.clientX)} onClick={(event) => showPoint(event.clientX)}
      onPointerLeave={(event) => event.pointerType === "mouse" && setHovered(null)}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault(); const current = hovered ? points.findIndex((point) => point.date === hovered.point.date) : points.length - 1;
        const next = Math.min(points.length - 1, Math.max(0, current + (event.key === "ArrowRight" ? 1 : -1)));
        const bounds = event.currentTarget.getBoundingClientRect(); showPoint(bounds.left + 66 + next / (points.length - 1) * (bounds.width - 90));
      }} />
    {hovered && <><i className="chart-hover-line" style={{ left: hovered.left }} /><i className="chart-hover-dot" style={{ left: hovered.left, top: hovered.top }} /><div className="chart-tooltip" role="status" style={{ left: hovered.tooltipLeft, top: hovered.top }}><span>{formatDate(hovered.point.date)}</span><strong>{hovered.point.value.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div></>}
    <small className="chart-interaction-hint">Hover, tap, or use the arrow keys to inspect each trading observation.</small>
  </div>;
}

function BursaSection({ dashboard }: { dashboard: DashboardPayload | null }) {
  const [range, setRange] = useState<MarketRange>("1Y");
  const market = dashboard?.market;
  const allPoints = useMemo(() => market?.benchmark.points ?? [], [market]);
  const points = useMemo(() => {
    if (!allPoints.length || range === "ALL") return allPoints;
    const end = new Date(`${allPoints.at(-1)?.date}T00:00:00`), start = new Date(end);
    if (range === "YTD") start.setMonth(0, 1);
    else if (range.endsWith("M")) start.setMonth(start.getMonth() - Number(range.replace("M", "")));
    else start.setFullYear(start.getFullYear() - Number(range.replace("Y", "")));
    return allPoints.filter((point) => new Date(`${point.date}T00:00:00`) >= start);
  }, [allPoints, range]);
  const periodReturn = points.length > 1 ? (points.at(-1)!.value / points[0].value - 1) * 100 : null;
  const summary = market?.summary;
  return <section className="section market-section" id="bursa"><div className="shell">
    <div className="section-heading light"><div><span className="section-number">04 / Bursa Malaysia</span><h2>The large-cap market pulse</h2></div><p>The FBM KLCI tracks 30 leading Main Market companies. It is a benchmark for large Malaysian shares, not the performance of every Bursa-listed company.</p></div>
    {!market || !summary ? <div className="market-empty">Market history will appear when the version-three dataset is available.</div> : <>
      <div className="market-overview">
        <article className="market-quote"><span>FTSE Bursa Malaysia KLCI</span><strong>{summary.latest.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong><div><b className={summary.change1D >= 0 ? "positive" : "negative"}>{signedPercent(summary.change1D)}</b><small>latest trading day · {formatDate(summary.latestDate)}</small></div><em className={`market-status ${market.status}`}>{dashboard?.usingFallback ? "Bundled fallback" : market.status === "fresh" ? "Delayed data · refreshed" : "Delayed data · cached"}</em></article>
        <div className="market-range" role="group" aria-label="Choose KLCI chart period">{(["1M", "3M", "YTD", "1Y", "3Y", "5Y", "ALL"] as MarketRange[]).map((item) => <button key={item} className={range === item ? "active" : ""} onClick={() => setRange(item)}>{item}</button>)}</div>
      </div>
      <MarketChart points={points} />
      <div className="market-stats">
        <article><span>{range} return</span><strong className={(periodReturn ?? 0) >= 0 ? "positive" : "negative"}>{signedPercent(periodReturn)}</strong><small>Price change between selected endpoints</small></article>
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

export function DashboardPage({ section = "snapshot" }: { section?: DashboardSection }) {
  const [reviewMode, setReviewMode] = useState(false);
  const [selectedMetric, setSelectedMetric] = useState<Metric | null>(null);
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/dashboard?refresh=${Date.now()}`, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("Dashboard data unavailable");
        return response.json() as Promise<DashboardPayload>;
      })
      .then((payload) => active && setDashboard(payload))
      .catch(() => active && setDashboard(null));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (section !== "snapshot") return;
    const legacyRoutes: Record<string, string> = { "#forecast": "/forecast", "#drivers": "/drivers", "#bursa": "/bursa", "#structural": "/structural", "#method": "/methodology" };
    const target = legacyRoutes[window.location.hash];
    if (target) window.location.replace(target);
  }, [section]);

  const liveMetrics: Metric[] = useMemo(() => {
    if (!dashboard) return metrics as Metric[];
    const details: Record<MetricId, string> = {
      headline: "Year on year", core: "Underlying pressure", opr: "BNM policy setting",
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

  const headlinePoints = dashboard?.series.headline.points.slice(-22) ?? history.map((value, index) => {
    const date = new Date(Date.UTC(2024, 7 + index, 1));
    return { date: date.toISOString().slice(0, 10), value };
  });
  const liveHistory = headlinePoints.map((point) => point.value);
  const liveHistoryLabels = headlinePoints.filter((_, index) => index === 0 || index === headlinePoints.length - 1 || index % Math.max(1, Math.floor(headlinePoints.length / 6)) === 0).map((point) => formatDate(point.date));
  const liveForecasts = dashboard?.forecast.points.map((point) => ({ ...point, month: formatDate(point.date) })) ?? forecasts;
  const liveModels = dashboard?.forecast.models ?? models;
  const liveCategories = dashboard?.categories.map((item) => [item.name, item.value] as const) ?? categories;
  const finalForecast = liveForecasts[liveForecasts.length - 1];
  const selectedScore = liveModels.find((model) => model.selected) ?? liveModels[0];
  const updatedAt = dashboard ? new Intl.DateTimeFormat("en-MY", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur" }).format(new Date(dashboard.generatedAt)) : "loading";

  return (
    <main id="top">
      <Header active={section} />

      {section === "snapshot" && <>
      <section className="hero shell">
        <div className="hero-copy">
          <div className="kicker">Malaysia inflation monitor · {updatedAt}</div>
          <h1>See the pressure.<br /><em>Read the direction.</em></h1>
          <p>A transparent view of Malaysian inflation—connecting official releases, financial conditions and a three-month statistical forecast.</p>
          <div className="hero-actions">
            <a className="primary-button" href="/forecast">Explore the outlook</a>
            <button className={reviewMode ? "review-toggle active" : "review-toggle"} onClick={() => setReviewMode(!reviewMode)} aria-pressed={reviewMode}>
              {reviewMode ? "Hide review notes" : "Show what to improve"}
            </button>
          </div>
          <div className={`data-status ${dashboard?.usingFallback ? "fallback" : dashboard?.health || "loading"}`}><span /> {dashboard?.usingFallback ? "Last validated snapshot · live source temporarily unavailable" : dashboard ? `Official data · ${dashboard.health}` : "Loading validated data"}</div>
        </div>
        <aside className="hero-brief" aria-label="Latest model brief">
          <div className="brief-label">Three-month signal</div>
          <div className="direction-badge"><span>→</span> Broadly stable</div>
          <div className="brief-value">{finalForecast.value.toFixed(2)}%</div>
          <p>Central forecast for {finalForecast.month}</p>
          <div className="brief-divider" />
          <dl>
            <div><dt>Selected model</dt><dd>{dashboard?.forecast.selectedModel ?? "SARIMA"}</dd></div>
            <div><dt>Backtest RMSE</dt><dd>{selectedScore.rmse.toFixed(2)} pp</dd></div>
            <div><dt>95% interval</dt><dd>{finalForecast.low95.toFixed(2)}% — {finalForecast.high95.toFixed(2)}%</dd></div>
          </dl>
          <small>Uncertainty widens with the forecast horizon.</small>
        </aside>
      </section>

      {reviewMode && (
        <section className="review-strip shell" aria-label="Improvement opportunities">
          <div className="review-heading"><span>Review mode</span><h2>Strong next steps for version two</h2></div>
          <div className="review-grid">
            {reviewIdeas.map((idea) => (
              <article key={idea.number}><span>{idea.number}</span><h3>{idea.title}</h3><p>{idea.copy}</p></article>
            ))}
          </div>
        </section>
      )}

      <section className="section shell" id="snapshot">
        <div className="section-heading">
          <div><span className="section-number">01 / Snapshot</span><h2>The economy at a glance</h2></div>
          <p>Six indicators frame the current inflation story. Each card keeps its own release period visible.</p>
        </div>
        <div className="metrics-grid">{liveMetrics.map((metric) => <MetricCard key={metric.label} metric={metric} onSelect={setSelectedMetric} />)}</div>
        <div className="trend-card">
          <div className="card-heading"><div><span>Headline inflation</span><h3>The recent path</h3></div><div className="legend"><i /> Year-on-year change</div></div>
          <div className="bar-chart" aria-label="Latest headline inflation history">
            {liveHistory.map((value, index) => <div className="bar-column" key={index} tabIndex={0} aria-label={`${formatDate(headlinePoints[index].date)}: ${value.toFixed(1)}%`}><i style={{ height: `${Math.max(value, .15) / Math.max(...liveHistory, 2.3) * 100}%` }} /><span>{index === liveHistory.length - 1 ? `${value.toFixed(1)}%` : ""}</span><b className="bar-tooltip"><small>{formatDate(headlinePoints[index].date)}</small>{value.toFixed(1)}%</b></div>)}
          </div>
          <div className="chart-axis">{liveHistoryLabels.map((label) => <span key={label}>{label}</span>)}</div>
          <div className="interpretation"><b>How to read this</b><p>{dashboard?.narratives.snapshot ?? "Loading the latest validated inflation interpretation."}</p></div>
          <small className="source-note">Source: DOSM via data.gov.my · Monthly data through {dashboard ? formatDate(dashboard.sources.headline.observationPeriod) : "the latest release"}</small>
        </div>
      </section>
      </>}

      {section === "forecast" && <section className="section forecast-section page-section" id="forecast">
        <div className="shell">
          <div className="section-heading light">
            <div><span className="section-number">02 / Forecast</span><h2>Three months ahead</h2></div>
            <p>The model is chosen through rolling historical tests. Ranges show uncertainty—not a promise about future inflation.</p>
          </div>
          <div className="forecast-layout">
            <div className="forecast-card">
              <div className="forecast-scale"><span>−1%</span><span>0%</span><span>1%</span><span>2%</span><span>3%</span><span>4%</span><span>5%</span></div>
              {liveForecasts.map((item) => {
                const toPercent = (v: number) => ((v + 1) / 6) * 100;
                return (
                  <div className="forecast-row" key={item.month}>
                    <strong>{item.month}</strong>
                    <div className="interval-track">
                      <i className="range range95" style={{ left: `${toPercent(item.low95)}%`, width: `${toPercent(item.high95) - toPercent(item.low95)}%` }} />
                      <i className="range range80" style={{ left: `${toPercent(item.low80)}%`, width: `${toPercent(item.high80) - toPercent(item.low80)}%` }} />
                      <i className="forecast-point" style={{ left: `${toPercent(item.value)}%` }}><span>{item.value.toFixed(2)}%</span></i>
                    </div>
                  </div>
                );
              })}
              <div className="interval-legend"><span><i className="key95" />95% interval</span><span><i className="key80" />80% interval</span><span><i className="keypoint" />Central forecast</span></div>
            </div>
            <aside className="model-card">
              <span className="mini-label">Out-of-sample comparison</span>
              <h3>Model scorecard</h3>
              {liveModels.map((model) => (
                <div className={model.selected ? "model-row selected" : "model-row"} key={model.name}>
                  <div><strong>{model.name}</strong>{model.selected && <span>Selected</span>}</div>
                  <div className="model-bar"><i style={{ width: `${(model.rmse / .6) * 100}%` }} /></div>
                  <b>{model.rmse.toFixed(2)}</b>
                </div>
              ))}
              <small>RMSE in percentage points · {dashboard?.forecast.backtestWindows ?? 12} identical rolling windows · Lower is better</small>
            </aside>
          </div>
          <div className="forecast-takeaway"><span>Model reading</span><p>{dashboard?.narratives.forecast ?? "Loading the latest model interpretation."}</p></div>
        </div>
      </section>}

      {section === "drivers" && <section className="section shell page-section" id="drivers">
        <div className="section-heading">
          <div><span className="section-number">03 / Drivers</span><h2>Where pressure is concentrated</h2></div>
          <p>Category rates identify areas of pressure. They are unweighted and should not be treated as contributions or causal estimates.</p>
        </div>
        <div className="drivers-layout">
          <div className="category-card">
            {liveCategories.map(([name, value]) => (
              <div className="category-row" key={name}>
                <span>{name}</span>
                <div><i className={value < 0 ? "negative" : ""} style={{ width: `${Math.abs(value) / 4 * 100}%` }} /></div>
                <b>{value.toFixed(1)}%</b>
              </div>
            ))}
            <small className="source-note">Automatically ranked, unweighted CPI division rates · {dashboard ? formatDate(dashboard.sources.headline.observationPeriod) : "latest release"}</small>
          </div>
          <div className="meaning-column">
            <article><span>Bonds</span><h3>Persistent inflation can lift required yields.</h3><p>Bond prices and yields generally move in opposite directions, but global rates and risk appetite also matter.</p></article>
            <article><span>Borrowing</span><h3>Policy expectations shape financing costs.</h3><p>Inflation persistence can affect the expected OPR path and, eventually, lending and deposit rates.</p></article>
            <article><span>Ringgit</span><h3>Inflation alone is not an FX signal.</h3><p>Relative rates, trade flows, global growth and risk sentiment can dominate the currency response.</p></article>
          </div>
        </div>
      </section>}

      {section === "bursa" && <BursaSection dashboard={dashboard} />}

      {section === "structural" && <StructuralSection dashboard={dashboard} />}

      {section === "methodology" && <section className="section method-section page-section" id="method">
        <div className="shell method-layout">
          <div className="method-intro"><span className="section-number">06 / Method</span><h2>Built to be questioned.</h2><p>A portfolio project is stronger when the assumptions are visible. MacroLens shows how data become a forecast—and where the approach can fail.</p></div>
          <ol className="method-list">
            <li><span>01</span><div><h3>Collect</h3><p>Refresh official DOSM and BNM releases, then preserve the last validated cache.</p></div></li>
            <li><span>02</span><div><h3>Align</h3><p>Convert every series to monthly frequency and lag external inputs by one month.</p></div></li>
            <li><span>03</span><div><h3>Backtest</h3><p>Compare seasonal naive, SARIMA and ARIMAX on identical expanding windows.</p></div></li>
            <li><span>04</span><div><h3>Communicate</h3><p>Select the lowest-RMSE model and show both 80% and 95% uncertainty bands.</p></div></li>
          </ol>
        </div>
      </section>}

      <footer className="shell">
        <div className="brand"><span className="brand-dot" /><span>MacroLens Malaysia</span></div>
        <p>Applied statistics × financial economics · Educational analysis, not investment advice.</p>
        <div><a href="https://data.gov.my/" target="_blank" rel="noreferrer">data.gov.my ↗</a><a href="https://apikijangportal.bnm.gov.my/" target="_blank" rel="noreferrer">BNM OpenAPI ↗</a></div>
      </footer>
      {selectedMetric && <IndicatorDetail metric={selectedMetric} onClose={() => setSelectedMetric(null)} />}
    </main>
  );
}

export default function Home() {
  return <DashboardPage section="snapshot" />;
}
