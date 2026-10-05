# MacroLens data-quality reassessment — 5 October 2026

Status: local corrections validated; publication has **not** been performed. Repository pushes, deployment and other external writes require explicit human approval. The production build and final automated checks passed; local desktop/mobile verification is recorded below.

## Forecast evidence

The saved `forecast.evaluation` contains 12 identical rolling origins, June 2025–May 2026, each with three complete observed targets. Training ends at the origin; future ARIMAX covariates are frozen at the last training values. Each successful horizon records actual, prediction, prediction-minus-actual error, 80%/95% bounds and coverage flags. Failed fits are disclosed and never replaced with a baseline under the failed model's name.

| Candidate | Successful / failed folds | Eligible | RMSE / MAE, percentage points | Historical 80% / 95% coverage |
|---|---:|---|---:|---:|
| Seasonal naive | 12 / 0 | Yes | 0.5061 / 0.4389 | 36/36 / 36/36 |
| SARIMA, selected | 12 / 0 | Yes | 0.2042 / 0.1656 | 21/36 (58.3%) / 32/36 (88.9%) |
| ARIMAX | 2 / 10 | No | 0.0796 / 0.0651, successful fits only | 6/6 / 6/6, successful fits only |

ARIMAX's smaller partial-sample errors are not comparable selection scores. Its full-sample sensitivity fit did not converge, so the scenario is unavailable with an explicit failure reason. SARIMA's final fit succeeded without fallback. Its historical intervals under-cover their nominal levels; no calibration guarantee is claimed.

This is pseudo-real-time evaluation using current saved observations, not historical data vintages. Core CPI is contemporaneous with the origin; other covariates use an assumed one-month lag, not verified historical release timestamps. Conditional ARIMAX bounds exclude future-covariate uncertainty. Overlapping three-month windows make errors and coverage dependent. Seasonal-naive bounds are training-residual approximations.

## Official GDP input verification and bounded correction

The correction reparsed the explicit saved official CSV inputs below without making a network request. SHA-256 values were rechecked against the files and match `regionalLens.sources.gdp.localInputVerification`.

| Saved input | SHA-256 |
|---|---|
| `outputs/gdp_state_real_supply.csv` | `0478e221408f506167d2cbbd1b0e9a73881ccc7509fe59ff6b7b81cbffaf63cb` |
| `outputs/gdp_district_real_supply.csv` | `163b8700fe179fc9cccdbd7e6c2fe5db5763218cf00f67a43e4c69c623f125bd` |

The latest state period remains 2025; district GDP remains 2020. For the latest absolute-level (`series=abs`) sector rows, excluding p0, the district source contains 805 rows: 89 official nulls stay unavailable and 59 genuine numeric zeros stay observed. The district source does not publish p6; all 161 corresponding values and shares are now null/not-published, not invented zero. The equivalent state inputs contain 102 sector rows including the state residual, with no nulls and 10 observed zeros. Official p0 totals are retained; available sectors are neither summed into substitute totals nor rescaled. Largest-sector labels rank only observed source values, before display rounding.

District GDP contains 159 administrative districts plus two Supra residuals. Residuals are excluded from administrative comparisons and exported as `district_residual`. State-scoped spelling/abbreviation aliases reconcile Lubok Antu, Tanjung Manis, Seberang Perai districts, Larut dan Matang and Hulu Terengganu. Unrelated names such as Selama and Larut, Matang dan Selama are not merged. Original source names remain in JSON; export keys are canonical. Ambiguous duplicate geography keys do not pick an arbitrary record.

The long-form regional CSV now has 4,356 rows and ten fields: `level,state,district,metric,value,unit,observation_period,source_url,data_status,retrieved_at`. Removing 500 invented sector value/share rows explains the reduction from 4,856. Per-metric source periods, units, URLs, status and retrieval times reconcile with the app exporter; unavailable sectors are omitted, genuine zero rows retained. No district CPI or borrowed state metrics are invented.

The dashboard's original generation time remains `2026-10-05T07:37:53Z`. GDP retrieval remains `2026-10-04T11:16:32Z`; local correction/validation is separately recorded at `2026-10-05T10:27:14Z`. Forecast calculation remains `2026-10-05T09:46:59Z`. National observations, forecasts, unrelated sections and their retrieval clocks were preserved. Two deterministic no-candidate structural narratives were corrected to say that no discrete break was detected under the specification, not that stability or instability was proved; saved break statistics were not recalculated.

## Validation and limits

- 121 Node unit tests passed, including regenerated regional CSV parity, optional forecast-audit integrity checks and the final mobile evidence-scroll regression.
- 82 Python tests passed, including source null/zero handling, malformed numbers, negative levels, duplicates, aliases, bounded correction scope and unchanged statistical diagnostics.
- App type checking passed.
- Production build passed using the bundled Windows runtime. The preview server was closed before rebuilding to release its build-directory lock.
- All 19 rendered-route/download tests passed against the exact production build, including shared dashboard fallback, regional CSV/JSON parity and forecast audit downloads.
- Local browser verification used the production Worker preview with a deliberately unavailable upstream artifact. Forecast displayed SARIMA eligibility, measured coverage, all three future months and no unvalidated sensitivity sliders. Regional controls switched to district mode; the final selector contained 165 administrative geographies, no Supra residuals and one canonical option for each verified alias. Kuching and Batu Pahat comparisons used district records, not state substitutes.
- At a 390-by-844 viewport, the Snapshot cards retained 16px body text and 36px figures. Loaded cards measured 343px wide and 166–190px tall according to content; the document measured 375px with no horizontal overflow. Regional and Forecast also had no document-level horizontal overflow in inspected states.
- Risk uses one active selection chart, explicit equal weighting, source periods, fallback status and a separate exploratory weight check. Browser inspection found that nearest-edge scrolling could leave mobile evidence above the viewport; it was changed to start alignment with a 160px sticky-navigation offset and regression-tested.
- Final browser confirmation measured the selected mobile Risk evidence at y=160–680 within an 844px viewport. Heatmap mode rendered nine cells and zero ranked bars. Brief history had no mounted table when closed; opening all 548 observations rendered 50 rows, Next showed rows 51–100, and closing removed the table again.
- Desktop visual proof: `outputs/macrolens-risk-quality-oct5.jpg`, captured from the local production Worker preview. Its fallback state is intentional and is not evidence of a public deployment.

Passing these checks is evidence for the tested transformations, not a guarantee that every official release, revision, economic interpretation or browser condition is correct. Source observation years differ; retained stale/unavailable inputs and educational boundaries remain explicit. This was not a full official-data refresh.

## Conservative local rubric

Provisional technical reassessment: **14/20**, versus the prior **13/20**. This is a local reviewer rubric, not a certified assessment, Lighthouse measurement, WCAG conformance statement or measured speed benchmark.

| Dimension, out of four | Prior | Current | Evidence boundary |
|---|---:|---:|---|
| Accessibility | 3 | 3 | Semantic/status improvements; full assistive-technology certification not performed. |
| Performance structure | 2 | 3 | Coalesced/cached loading and deferred, bounded history rows are tested; no latency percentage claimed. |
| Theming | 2 | 2 | No comprehensive contrast/theming audit claimed. |
| Responsiveness | 3 | 3 | Changed flows inspected at desktop/mobile sizes; no exhaustive device matrix claimed. |
| Presentation integrity | 3 | 3 | Provenance and numerical guards improved; source/model limitations remain. |

The increase is deliberately limited. The selected model's interval under-coverage, nonconverged ARIMAX fits, mixed-period regional coverage, lack of real-device/assistive-technology certification and lack of a measured performance benchmark prevent a stronger claim. No public-site release or official-source freshness claim follows from the local preview.
