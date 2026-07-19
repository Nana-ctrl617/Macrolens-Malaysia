# MacroLens Malaysia

MacroLens is a public economics portfolio dashboard that explains Malaysian inflation, related financial conditions, and a transparent three-month statistical forecast. It is an educational analytical tool, not investment advice.

## What updates automatically

A scheduled GitHub Actions workflow runs at 13:45 Malaysia time each day. It validates official DOSM/data.gov.my and Bank Negara Malaysia series plus delayed FBM KLCI prices, preserves the previous valid value when a source fails, compares three forecasting models, recalculates structural-break evidence when a series changes, and publishes one versioned dashboard artifact.

The website reads `data/published/dashboard.json` through `/api/dashboard`. A failed or invalid remote request falls back to the last snapshot bundled with the deployed site and displays a fallback status instead of claiming the data are live.

The interface uses separate routes for faster navigation: `/` for the snapshot, followed by `/forecast`, `/drivers`, `/structure`, `/bursa`, `/decisions`, `/structural`, and `/methodology`. All routes read the same consolidated payload so values cannot diverge between pages.

The Economic Structure page derives complete annual totals from DOSM's official quarterly nominal GDP-by-economic-sector dataset. Its year selector updates a six-part composition chart (five production sectors plus import duties), exact RM billion values, shares, year-on-year current-price changes, contribution to the annual ringgit change, and a deterministic interpretation. It clearly distinguishes GDP composition from government revenue, company profit, or household income.

Each snapshot indicator explorer also contains a selected-window explanation layer. It reports the strongest same-period monthly-change association across the dashboard series, any screened structural break and nearby verified event, indicator-specific economic mechanisms, and a year-by-year change table. These are labelled as diagnostic clues rather than causal estimates.

## Data sources

| Indicator | Frequency used | Official source |
| --- | --- | --- |
| Headline and core inflation | Monthly | DOSM via data.gov.my |
| CPI divisions | Monthly | DOSM via data.gov.my |
| Unemployment | Monthly | DOSM via data.gov.my |
| OPR | Policy decisions | BNM OpenAPI |
| USD/MYR | Monthly end rate | BNM via data.gov.my |
| 10-year MGS | Latest trading observation | BNM Financial Markets |
| FTSE Bursa Malaysia KLCI | Daily close, delayed | Yahoo Finance price history; benchmark definition from FTSE Russell/Bursa Malaysia |

The BNM Financial Markets website may reject automated requests. When this happens, the pipeline retains the last validated MGS series and marks it stale rather than substituting another source.

## Forecast methodology

The pipeline compares a seasonal-naive baseline, SARIMA, and ARIMAX over 12 identical rolling forecast origins. Model selection uses RMSE, then MAE, then model simplicity. External ARIMAX inputs are lagged by one month and held constant over the three-month forecast horizon. Until enough stored data vintages accumulate, results are labelled as a pseudo-real-time backtest using conservative release lags.

## Structural-change methodology

Each indicator is converted to monthly frequency and modelled as a level depending on an intercept, linear trend, and one-month lag. A Bai-Perron-style dynamic programme screens zero to three breakpoints using BIC and minimum regime lengths. Each selected boundary is then assessed using a classical Chow test with within-indicator Holm correction and a HAC/Newey-West joint Wald test. ADF and CUSUM diagnostics, before/after means and trends, standardised effects, exact sample periods, and nearby official events are included in payload schema version 2.

This is exploratory evidence of parameter instability, not causal identification. Nearby events are shown only within six months of a detected boundary and are never described as causes. Short MGS history is visibly labelled lower-confidence.

Machine-readable results are available from `/api/structural-breaks?format=json` and `/api/structural-breaks?format=csv`, as well as `data/published/structural-breaks.*`. Payload schema version 5 also contains ten years of daily KLCI closes, returns, one-year volatility, drawdown, 52-week range, deterministic market commentary, a self-updating decision guide, and annual nominal GDP sector composition through the latest complete year. Price data are delayed, third-party observations and are not described as live or official. Decision-guide scenarios are general education, not personalised advice.

## Local setup

Requirements: Node.js 22+, Python 3.12+, and the packages in `pipeline/requirements.txt`.

```bash
pip install -r pipeline/requirements.txt
python pipeline/macrolens.py
npm install
npm run dev
```

Validation:

```bash
pytest -q pipeline/tests
npm test
```

Set `DASHBOARD_DATA_URL` to override the default public GitHub artifact URL. No API keys, accounts, payments, portfolios, or personal financial data are used.

## Repository structure

- `pipeline/macrolens.py`: collection, validation, modelling, narratives, and snapshot generation.
- `.github/workflows/update-dashboard.yml`: scheduled and manual refresh workflow.
- `data/published/dashboard.json`: latest validated public payload.
- `data/published/structural-breaks.json` and `.csv`: downloadable structural diagnostics.
- `data/vintages/`: CPI release snapshots retained for future real-time evaluation.
- `app/`: responsive vinext website and API compatibility routes.
