# MacroLens high-priority verification — 5 October 2026

## Scope

This release fixes the three high-priority findings in the 5 October review: data trust, evidence navigation/accessibility, and news reliability. It preserves schema 9/8 compatibility, compact design, public audience, daily workflow, macro observations and forecast values. Medium-priority changes to risk calibration, forecast evaluation and structural-break inference are not part of this release.

## Data corrections

- The national 2024 mean household expenditure is **RM5,566/month**, from the [official DOSM expenditure report](https://storage.dosm.gov.my/hies/household_expenditure_2024.pdf), page 24. It is not an unweighted average of state means. Exact-year parsing fails closed and retains only previously verified same-year data on failure.
- Legacy failed source attempt times are not reported as successful retrievals. Unknown successful times are explicitly “Not recorded”; the attempt time remains available.
- Forecast, Brief, Risk, household/decision summaries and structural diagnostics inherit non-fresh required inputs. Their calculation date is separate from source observation/retrieval dates.
- The maintenance migration preserves all indicator observations and forecast points. Its time is not described as a new official-data refresh. The existing last source-refresh timestamp is retained.
- The TypeScript compatibility boundary removes unverifiable legacy national expenditure benchmarks and sanitizes legacy failed-attempt timestamps even if an older same-schema remote artifact is served.

## News corrections

- Enforce an actual seven-day publication window; reject missing, malformed, impossible, future and older dates.
- Sort newest first; remove duplicate canonical destinations and normalized titles, including `[UPDATED]` variants.
- Show publisher attribution instead of a generic search-feed source; safely clean HTML entities and common UTF-8 corruption.
- No fabricated fallback articles. Empty/failure states retain a source audit and refresh action.
- News leads with the latest headline before filters, with all topic/publisher choices still clickable. Generic pictures were removed from News only.
- Article claims are not independently verified; feed publication metadata is not statistical evidence or financial advice.

## Validation

- Python parser/pipeline suite: 40 tests.
- Node unit/source regressions: 23 tests.
- Production-rendered routes/APIs: 16 tests.
- Application-scoped TypeScript check and production build.
- Bounded browser checks: Snapshot, selected Core explorer, Structural query navigation, Risk, Forecast, Data Health, Regional and News. Desktop 1280×720 and mobile 390×844.
- Observed keyboard behavior: initial Close-button focus, reverse-Tab wrap to the last dialog control, Tab wrap to Close, Escape close, focus restoration to the Core card, and background inertness restoration.
- Diagnostics preserve `/structural?indicator=core` and select Core. Data Health shows stale OPR with successful retrieval “Not recorded” and failed attempt separately. Risk/Forecast display non-fresh-input notices.
- Mobile regional selects are full-width, 44px high, 16px text; no page-wide overflow in checked pages. Mobile News places its featured headline before the filter groups. Topic selection changes the featured result.

## Verification boundaries

The production build is tested by the rendered-route harness. The installed local `vinext start` preview did not serve bundled assets, so browser interaction checks used the supported development preview; production requires a separate live smoke check after deployment. The repository-wide TypeScript check has unrelated dormant Cloudflare worker scaffold errors; the application-scoped check covers all application code and passes. These are not claims of certified screen-reader compliance or newly calibrated statistical models.

Release is gated on synchronizing the corrected public GitHub artifact, packaging the exact tested source, a successful Sites deployment, and public API/visual smoke checks. The deployment version/commit and final live results are recorded after publication.
