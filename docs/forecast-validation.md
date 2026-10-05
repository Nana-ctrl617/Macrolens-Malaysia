# Forecast validation and revision ledger

## Rolling evaluation

The inflation forecast is evaluated with up to the latest 36 eligible monthly forecast origins. Each origin has at least 36 months of training history and three consecutive observed target months. Every candidate model uses the same origins. If a model fit fails at any origin, that candidate remains visible as incomplete and is not selected using an easier subset. The deterministic selection rule is lowest pooled RMSE, then MAE, then the declared model order.

MAE and RMSE are reported overall and separately at forecast horizons one, two and three. CPI errors are in percentage points. RMSE gives larger misses more weight; neither measure is a probability that the selected model is correct. Empirical interval coverage and average width are also reported overall and by horizon, using only successful fits and their exact observed targets.

Monthly policy-rate inputs use the last dated OPR decision in each month, carried forward only until another decision is observed; the ARIMAX feature is then lagged by one month. FX, MGS and unemployment are aligned to monthly observations and lagged one month. Core CPI is available through the forecast origin under the documented pseudo-real-time assumption. These are conservative release-lag assumptions, not reconstructed publication timestamps. The long backtest still uses today's saved/revised series and is not a historical-vintage test.

## Experimental interval recalibration

When enough origins exist, the first 12 are reserved as a calibration warm-up and later origins form the held-out evaluation period. At each later origin, the experiment calculates an absolute forecast-error order statistic separately for each model and horizon. It may use only earlier errors whose target observation month is strictly before that origin. The exact calibration target months are included in the detailed audit and CSV export; the dashboard integrity check recomputes the eligible history, quantiles, bounds, coverage and mean widths.

The finite-sample rank is `ceil((n + 1) × nominal coverage)`. A range is unavailable if the rank exceeds the count of prior errors (at least four observations for 80%, at least nineteen for 95%). This is an exploratory time-series comparison, not a distribution-free coverage guarantee: rolling errors overlap and are serially dependent. Recalibration does not change the production forecast, its prediction intervals, or model selection.

## Append-only vintages

The `ledger-v1` folders begin collecting only after a validated live pipeline retrieval. A source snapshot is eligible only when it is marked fresh and its successful retrieval clock matches the current run clock. Content hashes cover the source identity, observation period, units, frequency, URL and normalized full series. Re-fetching identical content does not add a duplicate. Changed content for the same latest observation period creates a new hash-addressed file; existing files are opened exclusively and never overwritten.

A prospective forecast issue is saved only when all six forecast input series were freshly retrieved in that run, the selected final fit succeeded, and all three target months begin after the issue month. Its record references the exact input snapshot hashes. An outcome is saved only after a later fresh headline-CPI retrieval contains the target month. A changed value appends a new outcome hash rather than replacing the earlier value.

The outcome is the first value this ledger captured, not a verified DOSM first-release value: official historical release-vintage timestamps are not present in the input feeds. Older `data/vintages/cpi-*.json` files remain untouched, but the dashboard does not count them as true real-time forecasts. True-vintage evaluation begins prospectively as the new issue and outcome records accumulate.

## Reproducibility and tests

The forecast calculation is deterministic for fixed validated inputs and software versions. The release suite tests common origins, monthly OPR treatment, errors and interval metadata, the calibration cutoff and finite-sample thresholds, changed and unchanged source hashes, clock/staleness rejection, future-only forecast issues, outcome revisions, and immutability of existing CPI snapshots.

Method references: [Statsmodels state-space forecasting](https://www.statsmodels.org/stable/examples/notebooks/generated/statespace_forecasting.html), [Forecasting: Principles and Practice — forecast accuracy](https://otexts.com/fpp3/accuracy.html), and [Angelopoulos & Bates — conformal prediction tutorial](https://arxiv.org/abs/2107.07511). The last reference motivates finite-sample order statistics; MacroLens does not claim the independent/exchangeable guarantee for its dependent time-series residual experiment.
