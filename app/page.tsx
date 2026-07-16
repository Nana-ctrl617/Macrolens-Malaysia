"use client";

import { useState } from "react";

const metrics = [
  { label: "Headline inflation", value: "2.0%", detail: "Year on year", period: "May 2026", tone: "rust" },
  { label: "Core inflation", value: "2.0%", detail: "Underlying pressure", period: "May 2026", tone: "teal" },
  { label: "Overnight Policy Rate", value: "2.75%", detail: "BNM policy setting", period: "Jul 2026", tone: "navy" },
  { label: "Unemployment", value: "3.0%", detail: "Share of labour force", period: "May 2026", tone: "teal" },
  { label: "USD / MYR", value: "RM 4.04", detail: "Monthly average", period: "May 2026", tone: "navy" },
  { label: "10-year MGS", value: "3.63%", detail: "Government bond yield", period: "Jul 2026", tone: "rust" },
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

function MetricCard({ metric }: { metric: (typeof metrics)[number] }) {
  return (
    <article className={`metric-card ${metric.tone}`}>
      <div className="metric-topline"><span>{metric.label}</span><i /></div>
      <strong>{metric.value}</strong>
      <p>{metric.detail}</p>
      <small>Release period · {metric.period}</small>
    </article>
  );
}

export default function Home() {
  const [reviewMode, setReviewMode] = useState(false);

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
        <div className="metrics-grid">{metrics.map((metric) => <MetricCard key={metric.label} metric={metric} />)}</div>
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
    </main>
  );
}
