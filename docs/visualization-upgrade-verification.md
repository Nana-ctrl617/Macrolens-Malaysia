# Chart-led dashboard verification

Date: 5 October 2026

## Scope

Risk, Brief, Households, BOP and Forecast now use small interactive charts driven by the existing consolidated payload. Schema, data pipeline, score calculations, forecast models and APIs are unchanged. Long explanatory content is retained in expandable panels.

## Automated checks

- 57 Node unit, source and component-render checks passed.
- 17 production-rendered checks passed.
- Application TypeScript check passed.
- Production build passed.
- Fixtures exercise absent observations, malformed dates, zero/negative values, source status, fallback states and preserved model selection.

## Browser verification

Checked all five surfaces at 1280 x 720 and 390 x 844 in the in-app browser.

- Risk matrix and score bars expose the same supplied values. Selecting policy rate displays its scoring rule, observation period and stale status.
- Brief indicator/range controls and keyboard inspection display actual historical observations, units and source links. The OPR series is stepped and marked stale.
- Household components retain individual source periods/statuses; debt service is stale and job/income is fresh.
- BOP account and quarter selection display actual signed balances. Missing balances remain unpublished, not zero.
- Forecast RMSE/MAE toggle preserves the supplied selected-model badge.
- No page-wide horizontal overflow at phone width. Exact data tables have contained horizontal scrolling.
- One observed mobile defect was corrected: the BOP plot now fits the phone width rather than requiring sideways chart scrolling. A single confirmation pass verified the change on phone and desktop.

Pointer handlers are source-tested. Native hover was not exercised by this browser interface; click/tap-style selection and keyboard inspection were exercised.

## Release boundary

The verified build is ready for publication to the existing public MacroLens site. Publication outcome and public smoke checks are recorded separately after deployment. No data pipeline run is required for these frontend-only changes.
