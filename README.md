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

The website reads the public artifact at `data/published/dashboard.json` through `/api/dashboard`. Successful dashboard responses are cached for up to one minute per warm serverless function instance, browser client and shared response cache; official dashboard responses do not use `stale-while-revalidate`. Indicator explorers use the same bounded policy, while detailed exports use `no-store`. If the upstream artifact is unavailable or fails validation, the site serves the last valid or bundled snapshot with a fallback label; fallback data are not described as live. `DASHBOARD_DATA_URL` can override the default raw-GitHub artifact URL.

For automated checks, `/api/health` returns a small uncached status document: `ok` only means the artifact is validated, fresh and not a fallback; `degraded` means partial or fallback data. It includes the schema version, generation timestamp and source-count summary, but not the full dashboard payload.

Vercel's Git ignore-build check skips deployments only when a commit changes files exclusively under `data/published/`, `data/vintages/` or `data/backfill/`. The runtime API reads the published artifact directly, so data-only refreshes appear without a website rebuild. If the previous commit cannot be compared, or any code/configuration or unexpected file changed, the guard fails open and Vercel builds as usual.

Vercel may label an intentionally skipped data-only deployment as **Canceled**. That label alone is not a failed data refresh: the workflow's public-artifact verification is the authoritative check. A refresh is live only after `/api/dashboard` reports the validated schema and `generatedAt` with `usingFallback: false`.

After each scheduled refresh validates and pushes its artifact, the workflow polls the public Vercel `/api/dashboard` endpoint for up to 13 attempts, allowing the bounded cache window to expire. It succeeds only when the public response has the same schema version and `generatedAt` as the artifact and explicitly reports `usingFallback: false`. If propagation is not confirmed, the workflow fails and its summary says not to treat that refresh as live; inspect the Vercel/API response before retiring the previous host.

The news page retrieves public RSS/search feeds separately from the official statistical payload. Successful upstream responses are coalesced for simultaneous visitors and kept for up to five minutes on a warm server instance; failed requests are never cached as if they were news. The response exposes its original check time and a short HTTP cache policy, so a cached response is not presented as a fresh fetch. News items can change between visits and are contextual coverage, not official statistics or statistical evidence.

## Reliability and security baseline

The public application sends restrictive browser security headers: a content-security policy, HTTPS transport persistence, frame-embedding protection, MIME-type sniffing protection, a strict cross-origin referrer policy, and permissions that disable unused hardware features. These controls reduce unnecessary browser exposure; they do not validate third-party publisher content or make an economic claim more reliable.

Official-series reliability is handled separately. The pipeline rejects malformed, duplicate, implausible or structurally changed responses before publication, retains the previous valid series during a partial source outage, and marks the affected source stale. The dashboard never treats a fallback snapshot, unavailable input or retained series as a new live observation. The **Data Health** page is the source of truth for each source's release period, retrieval time, freshness and any error.

Every remote official CSV, API and market response uses a bounded timeout, source-identifying request header and retry policy for transient failures. A failed or malformed refresh cannot overwrite the last validated artifact.

## Main sources

| Data | Frequency / coverage | Source |
| --- | --- | --- |
| Headline/core CPI, CPI divisions, unemployment | Monthly | DOSM via [data.gov.my](https://data.gov.my/) |
| OPR decisions | Dated policy decisions | [BNM OpenAPI](https://apikijangportal.bnm.gov.my/faq) |
| USD/MYR | Daily KL reference rate for the snapshot and explorer; monthly last-trading-day closes for macro analysis | [BNM Financial Markets daily history](https://financialmarkets.bnm.gov.my/data-download-kl-usd-myr-reference-rate?date_range=all_date) |
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

`release:check` validates the published payload, runs pipeline and application tests (including data parsers, cache behavior and security-header assertions), type-checks and builds the production app, tests rendered routes and downloads, then runs the real-browser accessibility/responsiveness matrix and chart checks. It writes `outputs/release-gate.json` only after the required stages pass. `release:ready` verifies the exact source, build and payload fingerprint has not changed since that run.

## Repository map

- `app/`: compact responsive website, route views, API and data-integrity validation.
- `pipeline/macrolens.py`: data collection, source-local refresh, statistical analysis and payload generation.
- `.github/workflows/update-dashboard.yml`: scheduled/manual data refresh.
- `.github/workflows/verify-dashboard.yml`: source-change verification workflow.
- `data/published/`: current consolidated JSON and downloadable generated data.
- `data/vintages/`: append-only source snapshots, prospective forecast issues and observed outcomes.
- `docs/forecast-validation.md`: forecast sampling, calibration limits and vintage definitions.
- `tests/` and `pipeline/tests/`: application, accessibility, browser and data-pipeline regression coverage.
