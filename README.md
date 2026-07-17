# MacroLens Malaysia

MacroLens is a public economics portfolio dashboard that explains Malaysian inflation, related financial conditions, and a transparent three-month statistical forecast. It is an educational analytical tool, not investment advice.

## What updates automatically

A scheduled GitHub Actions workflow runs at 13:45 Malaysia time each day. It validates official DOSM/data.gov.my and Bank Negara Malaysia series, preserves the previous valid value when a source fails, compares three forecasting models, and publishes one versioned dashboard artifact.

The website reads `data/published/dashboard.json` through `/api/dashboard`. A failed or invalid remote request falls back to the last snapshot bundled with the deployed site and displays a fallback status instead of claiming the data are live.

## Data sources

| Indicator | Frequency used | Official source |
| --- | --- | --- |
| Headline and core inflation | Monthly | DOSM via data.gov.my |
| CPI divisions | Monthly | DOSM via data.gov.my |
| Unemployment | Monthly | DOSM via data.gov.my |
| OPR | Policy decisions | BNM OpenAPI |
| USD/MYR | Monthly end rate | BNM via data.gov.my |
| 10-year MGS | Latest trading observation | BNM Financial Markets |

The BNM Financial Markets website may reject automated requests. When this happens, the pipeline retains the last validated MGS series and marks it stale rather than substituting another source.

## Forecast methodology

The pipeline compares a seasonal-naive baseline, SARIMA, and ARIMAX over 12 identical rolling forecast origins. Model selection uses RMSE, then MAE, then model simplicity. External ARIMAX inputs are lagged by one month and held constant over the three-month forecast horizon. Until enough stored data vintages accumulate, results are labelled as a pseudo-real-time backtest using conservative release lags.

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
- `data/vintages/`: CPI release snapshots retained for future real-time evaluation.
- `app/`: responsive vinext website and API compatibility routes.
