"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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

function Header() {
  return (
    <header className="site-header">
      <a className="brand" href="#top" aria-label="MacroLens Malaysia home">
        <span className="brand-dot" />
        <span>MacroLens Malaysia</span>
      </a>
      <nav aria-label="Primary navigation">
        <a href="#snapshot">Snapshot</a>
        <a href="#forecast">Forecast</a>
        <a href="#drivers">Drivers</a>
        <a href="#method">Method</a>
      </nav>
      <a className="source-link" href="https://data.gov.my/" target="_blank" rel="noreferrer">Official sources ↗</a>
    </header>
  );
}

type Metric = (typeof metrics)[number];
type RangeKey = "1Y" | "3Y" | "5Y" | "10Y" | "ALL" | "CUSTOM";
type DataPoint = { date: string; value: number };
type IndicatorData = {
  id: Metric["id"];
  title: string;
  unit: string;
  decimals: number;
  source: string;
  sourceUrl: string;
  frequency: string;
  points: DataPoint[];
};

function formatDate(date: string) {
  return new Intl.DateTimeFormat("en-MY", { month: "short", year: "numeric" })
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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || points.length < 2) return;
    const container = canvas.parentElement;
    if (!container) return;

    const draw = () => {
      const width = Math.max(container.clientWidth, 420);
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

      context.font = "11px DM Sans, sans-serif";
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

  return (
    <div className="detail-chart-wrap">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`${data.title} chart with ${points.length} observations from ${formatDate(points[0].date)} to ${formatDate(points[points.length - 1].date)}`}
      />
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

export default function Home() {
  const [reviewMode, setReviewMode] = useState(false);
  const [selectedMetric, setSelectedMetric] = useState<Metric | null>(null);

  return (
    <main id="top">
      <Header />

      <section className="hero shell">
        <div className="hero-copy">
          <div className="kicker">Malaysia inflation monitor · 16 July 2026</div>
          <h1>See the pressure.<br /><em>Read the direction.</em></h1>
          <p>A transparent view of Malaysian inflation—connecting official releases, financial conditions and a three-month statistical forecast.</p>
          <div className="hero-actions">
            <a className="primary-button" href="#forecast">Explore the outlook</a>
            <button className={reviewMode ? "review-toggle active" : "review-toggle"} onClick={() => setReviewMode(!reviewMode)} aria-pressed={reviewMode}>
              {reviewMode ? "Hide review notes" : "Show what to improve"}
            </button>
          </div>
          <div className="data-status"><span /> Official data · refreshed</div>
        </div>
        <aside className="hero-brief" aria-label="Latest model brief">
          <div className="brief-label">Three-month signal</div>
          <div className="direction-badge"><span>→</span> Broadly stable</div>
          <div className="brief-value">2.02%</div>
          <p>Central forecast for August 2026</p>
          <div className="brief-divider" />
          <dl>
            <div><dt>Selected model</dt><dd>SARIMA</dd></div>
            <div><dt>Backtest RMSE</dt><dd>0.18 pp</dd></div>
            <div><dt>95% interval</dt><dd>−0.15% — 4.19%</dd></div>
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
        <div className="metrics-grid">{metrics.map((metric) => <MetricCard key={metric.label} metric={metric} onSelect={setSelectedMetric} />)}</div>
        <div className="trend-card">
          <div className="card-heading"><div><span>Headline inflation</span><h3>The recent path</h3></div><div className="legend"><i /> Year-on-year change</div></div>
          <div className="bar-chart" aria-label="Headline inflation from August 2024 to May 2026">
            {history.map((value, index) => <div className="bar-column" key={index}><i style={{ height: `${Math.max(value, .15) / 2.3 * 100}%` }} /><span>{index === history.length - 1 ? `${value.toFixed(1)}%` : ""}</span></div>)}
          </div>
          <div className="chart-axis">{historyLabels.map((label) => <span key={label}>{label}</span>)}</div>
          <div className="interpretation"><b>How to read this</b><p>Headline inflation is relatively contained at 2.0% and in line with core inflation. The short-run path has turned modestly upward, but the central forecast remains close to 2%.</p></div>
          <small className="source-note">Source: DOSM via data.gov.my · Monthly data through May 2026</small>
        </div>
      </section>

      <section className="section forecast-section" id="forecast">
        <div className="shell">
          <div className="section-heading light">
            <div><span className="section-number">02 / Forecast</span><h2>Three months ahead</h2></div>
            <p>The model is chosen through rolling historical tests. Ranges show uncertainty—not a promise about future inflation.</p>
          </div>
          <div className="forecast-layout">
            <div className="forecast-card">
              <div className="forecast-scale"><span>−1%</span><span>0%</span><span>1%</span><span>2%</span><span>3%</span><span>4%</span><span>5%</span></div>
              {forecasts.map((item) => {
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
              {models.map((model) => (
                <div className={model.selected ? "model-row selected" : "model-row"} key={model.name}>
                  <div><strong>{model.name}</strong>{model.selected && <span>Selected</span>}</div>
                  <div className="model-bar"><i style={{ width: `${(model.rmse / .6) * 100}%` }} /></div>
                  <b>{model.rmse.toFixed(2)}</b>
                </div>
              ))}
              <small>RMSE in percentage points · 12 identical rolling windows · Lower is better</small>
            </aside>
          </div>
          <div className="forecast-takeaway"><span>Model reading</span><p>Inflation is estimated to remain broadly stable through August. The growing interval is the important message: confidence falls as the horizon extends.</p></div>
        </div>
      </section>

      <section className="section shell" id="drivers">
        <div className="section-heading">
          <div><span className="section-number">03 / Drivers</span><h2>Where pressure is concentrated</h2></div>
          <p>Category rates identify areas of pressure. They are unweighted and should not be treated as contributions or causal estimates.</p>
        </div>
        <div className="drivers-layout">
          <div className="category-card">
            {categories.map(([name, value]) => (
              <div className="category-row" key={name}>
                <span>{name}</span>
                <div><i className={value < 0 ? "negative" : ""} style={{ width: `${Math.abs(value) / 4 * 100}%` }} /></div>
                <b>{value.toFixed(1)}%</b>
              </div>
            ))}
            <small className="source-note">Illustrative category view · DOSM CPI divisions · May 2026</small>
          </div>
          <div className="meaning-column">
            <article><span>Bonds</span><h3>Persistent inflation can lift required yields.</h3><p>Bond prices and yields generally move in opposite directions, but global rates and risk appetite also matter.</p></article>
            <article><span>Borrowing</span><h3>Policy expectations shape financing costs.</h3><p>Inflation persistence can affect the expected OPR path and, eventually, lending and deposit rates.</p></article>
            <article><span>Ringgit</span><h3>Inflation alone is not an FX signal.</h3><p>Relative rates, trade flows, global growth and risk sentiment can dominate the currency response.</p></article>
          </div>
        </div>
      </section>

      <section className="section method-section" id="method">
        <div className="shell method-layout">
          <div className="method-intro"><span className="section-number">04 / Method</span><h2>Built to be questioned.</h2><p>A portfolio project is stronger when the assumptions are visible. MacroLens shows how data become a forecast—and where the approach can fail.</p></div>
          <ol className="method-list">
            <li><span>01</span><div><h3>Collect</h3><p>Refresh official DOSM and BNM releases, then preserve the last validated cache.</p></div></li>
            <li><span>02</span><div><h3>Align</h3><p>Convert every series to monthly frequency and lag external inputs by one month.</p></div></li>
            <li><span>03</span><div><h3>Backtest</h3><p>Compare seasonal naive, SARIMA and ARIMAX on identical expanding windows.</p></div></li>
            <li><span>04</span><div><h3>Communicate</h3><p>Select the lowest-RMSE model and show both 80% and 95% uncertainty bands.</p></div></li>
          </ol>
        </div>
      </section>

      <footer className="shell">
        <div className="brand"><span className="brand-dot" /><span>MacroLens Malaysia</span></div>
        <p>Applied statistics × financial economics · Educational analysis, not investment advice.</p>
        <div><a href="https://data.gov.my/" target="_blank" rel="noreferrer">data.gov.my ↗</a><a href="https://apikijangportal.bnm.gov.my/" target="_blank" rel="noreferrer">BNM OpenAPI ↗</a></div>
      </footer>
      {selectedMetric && <IndicatorDetail metric={selectedMetric} onClose={() => setSelectedMetric(null)} />}
    </main>
  );
}
