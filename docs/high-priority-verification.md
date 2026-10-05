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

## Release evidence

- GitHub implementation/data commit: `d46539a`. The public raw artifact was checked after the push; it contains the verified RM5,566 national benchmark and conservative input-health metadata.
- Sites version **52**, source commit `a915e3de97a8a3f4058b87a269ead2451be8d328`.
- Deployment `appgdep_6ac35cc040388191be94f8cb2069a2fa` returned `succeeded` at 2026-10-05 08:16 UTC, preserving the existing public audience and URL.
- Public `/api/dashboard` confirms schema 9, national expenditure RM5,566, stale OPR/MGS with unknown last successful retrieval and separately preserved attempts, partial Forecast input health and partial Risk status.
- Public `/health`, `/forecast`, `/regional`, `/structural?indicator=core` and `/news` return HTTP 200. Browser verification confirms the actual Data Health table, risk input warning, observation/status labels, headline-first News and real publisher attribution.
- Public news at verification contains two eligible articles, both dated 2 October 2026, newest first within the stated 28 September–5 October window. Google feeds return HTTP 503 and Bernama supplies undated items; these failures are exposed instead of filling the page with out-of-window or invented stories. Local fixture coverage is not a guarantee of a minimum live article count.
- The existing daily GitHub workflow remains unchanged. No manual workflow dispatch was performed; no authenticated dispatch connector was available in this session.
- The source workflow committed and pushed the tested source successfully, but its packager depends on unavailable Bash on this Windows host. Packaging was recovered using the same supplied `prepare-site-build.cjs` validation/staging logic and native Windows tar, preserving the unchanged built output and matching hosting manifest. The archive was accepted by Sites.
- Live screenshot: `outputs/macrolens-priority-live.jpg` in the parent task workspace. This screenshot shows the published source-health audit, not a local preview.

The release does not resolve the upstream OPR/MGS availability problems or redesign the medium-priority statistical models. Their saved observations remain available and visibly labelled.
