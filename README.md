# MacroLens Malaysia

MacroLens is a public dashboard for understanding Malaysia's economy and financial markets. It brings official macroeconomic data, regional differences, trade and balance-of-payments indicators, Bursa performance, transparent forecasts and statistical diagnostics into one educational site. It is not investment advice.

## What it covers

- Snapshot and economic brief with source periods and freshness labels.
- Inflation drivers, a three-month headline-inflation forecast, model backtests and uncertainty intervals.
- Risk heatmap with disclosed rules and component coverage.
- Growth drivers by production sector and expenditure component.
- Trade, balance of payments, household conditions and state/district comparisons where comparable official data exist.
- Bursa Malaysia's KLCI, structural-shift diagnostics, economic timeline and a general decision guide.
- Source-health and methodology pages, CSV/JSON downloads, and on-demand detailed histories.

The 19 routes share one versioned dashboard payload so a figure and its source notes stay consistent across pages. National-only measures such as OPR, USD/MYR, MGS, Bursa and balance of payments are not presented as if they varied by state. Regional datasets refresh independently; unavailable or stale inputs are labelled rather than silently filled with zero.

## Automatic data updates

The GitHub Actions workflow `.github/workflows/update-dashboard.yml` runs daily at 13:45 Malaysia time (05:45 UTC) and can also be started manually. It validates official-source data, preserves the last valid series when a source fails, regenerates the dashboard, and commits only changed validated data. GitHub may start a scheduled run later than its requested time.

The website reads the public artifact at `data/published/dashboard.json` through `/api/dashboard`. Successful responses are cached. If the upstream artifact is unavailable or fails validation, the site serves its bundled last-valid snapshot with a fallback label; fallback data are not described as live. `DASHBOARD_DATA_URL` can override the default raw-GitHub artifact URL.

The news page fetches public RSS/search feeds separately at request time. News items can change between visits and are not part of the official statistical dashboard payload.

## Main sources

| Data | Frequency / coverage | Source |
| --- | --- | --- |
| Headline/core CPI, CPI divisions, unemployment | Monthly | DOSM via [data.gov.my](https://data.gov.my/) |
| OPR decisions | Dated policy decisions | [BNM OpenAPI](https://apikijangportal.bnm.gov.my/faq) |
| USD/MYR | Monthly reference rate | BNM via [data.gov.my](https://data.gov.my/) |
| 10-year MGS yield | Daily trading observations | [BNM Financial Markets](https://financialmarkets.bnm.gov.my/benchmark-yields) |
| GDP by state, district and sector; trade; balance of payments | Official published periods | DOSM / [data.gov.my](https://data.gov.my/) |
| Household income, expenditure, poverty, inequality and labour | State/district coverage varies by release | DOSM / [OpenDOSM](https://open.dosm.gov.my/) |
| FBM KLCI prices | Daily, delayed third-party prices | Yahoo Finance; benchmark definition from FTSE Russell/Bursa Malaysia |
| Headlines | Public feeds, retrieved at request time | News publishers and feed providers; not official statistics |

Each dataset has its own frequency, release period, retrieval time and validation state. Different periods should not be read as simultaneous observations. BNM or DOSM may revise published data, and the dashboard preserves source metadata to make those changes inspectable.

## Forecast and statistical methods

### Inflation forecast

The pipeline compares seasonal-naive, SARIMA and ARIMAX forecasts on identical rolling-origin windows. It requires at least 24 months of training data and evaluates up to 60 common origins; actual coverage is limited by shared feature history and visible candidate fit failures. Model selection uses lowest RMSE, then MAE, then the fixed model order. The page reports the information-origin month, backtest coverage, forecast horizon and 80%/95% intervals.

The current pipeline uses a 12-origin warm-up for an experimental interval-recalibration comparison; later evaluation targets may use only errors observed before each forecast origin. Recalibration is compared on matched held-out cases, does not alter the published forecast, and is not a coverage guarantee. Forecast backtests use today's saved/revised series with conservative assumed release lags; until verified release-vintage data accumulate, they are not true real-time tests.

### Structural shifts

Monthly indicator series are screened for zero to three unknown break dates using a Bai–Perron-style dynamic program and BIC, subject to minimum regime lengths. Selected boundaries are examined with adjacent-regime Chow tests, within-indicator Holm adjustments and HAC/Newey–West stability tests, alongside ADF and CUSUM diagnostics. Effect sizes and nearby catalogue events are descriptive context; neither a statistical break nor an event match establishes causation. Short histories receive lower-confidence warnings.

### Risk and regional comparisons

Risk scores are deterministic monitoring rules with visible inputs and weights; they are not probabilities of loss or crisis. Missing inputs remain unavailable and do not silently count as zero. Regional charts compare published survey/administrative data for the geographies and years available; they are not a personal cost-of-living calculator.

More detail is in [`docs/forecast-validation.md`](docs/forecast-validation.md), the in-app Methodology and Data Health pages, and the generated payload metadata.

## Run locally

Requirements: Node.js 22+, pnpm 11+, and Python 3.12+.

```powershell
pnpm install --frozen-lockfile
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r pipeline/requirements.txt
python pipeline/macrolens.py
pnpm dev
```

The pipeline retrieves current public sources when run. The checked-in published artifact remains available if a source cannot be reached; it will be preserved and marked stale instead of replaced by an invalid response.

## Verify changes

```powershell
pytest -q pipeline/tests
pnpm run test:unit
pnpm run release:check
pnpm run release:ready
```

`release:check` validates the published payload, runs pipeline and application tests, type-checks and builds the production app, tests rendered routes and downloads, then runs the real-browser accessibility/responsiveness matrix and chart checks. It writes `outputs/release-gate.json` only after the required stages pass. `release:ready` verifies the exact source, build and payload fingerprint has not changed since that run.

## Repository map

- `app/`: compact responsive website, route views, API and data-integrity validation.
- `pipeline/macrolens.py`: data collection, source-local refresh, statistical analysis and payload generation.
- `.github/workflows/update-dashboard.yml`: scheduled/manual data refresh.
- `.github/workflows/verify-dashboard.yml`: source-change verification workflow.
- `data/published/`: current consolidated JSON and downloadable generated data.
- `data/vintages/`: append-only source snapshots, prospective forecast issues and observed outcomes.
- `docs/forecast-validation.md`: forecast sampling, calibration limits and vintage definitions.
- `tests/` and `pipeline/tests/`: application, accessibility, browser and data-pipeline regression coverage.
