# MacroLens Six-Priority Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. These companion skills are unavailable in this installation; bounded collaboration agents and owner review implement the same ordered checkpoints.

**Goal:** Complete all six requested quality improvements in priority order, proving each against current code, generated data, tests, browser behavior and release gates.

**Architecture:** Keep one validated dashboard data contract and independently refreshable source artifacts. Explicit availability travels from Python generation through server validation to charts. Route-specific React modules share a small shell and data loader; a reproducible browser gate validates the same built artifact used for publication.

**Tech Stack:** Python/pandas/statsmodels/pytest; React/TypeScript/Vinext; Node tests; Cloudflare Worker preview; real-browser CI; Sites and GitHub.

**Spec:** The user goal table is reproduced in the acceptance ledger below. Version 54 is the starting published baseline, not evidence that these new requirements are already satisfied.

## Global Constraints

- Preserve the compact dashboard, public URL and educational boundary.
- Missing Risk inputs show “Unavailable,” never fabricated zero measurements.
- Regional sources refresh independently and retain only their own last-valid data on failure.
- Keyboard, pointer and touch chart inspection use the same selected observation and formatting.
- WCAG reference: https://www.w3.org/WAI/WCAG22/quickref/ . Test focus, live announcements, contrast, text enlargement and reflow; do not claim certification from automated checks.
- One consistent token system owns backgrounds, text, borders, statuses and focus.
- Routes must be real modules; histories are deferred until requested. Measure mobile performance before and after under the same conditions.
- Navigation, filters, charts, retries and downloads are tested at phone, tablet and desktop sizes and 200%/400% zoom/reflow.
- Invalid data or a failing required test blocks publication.
- Forecast evaluation and uncertainty recalibration use no future training/calibration observations. Stored release snapshots and revisions are immutable observations of retrieval time.
- No fabricated data, false freshness, overwritten historical vintage, force push, dependency guess, or passing-test-only completion claim.

## Acceptance Ledger

| Priority | Requirement | Authoritative completion evidence |
|---|---|---|
| 1 | Missing Risk inputs are unavailable; source-local regional failure handling | Controlled missing/null/zero fixtures, independent refresh failure matrix, payload/UI validation and rendered unavailable state |
| 2 | Every chart accessible, including Growth Drivers/trade | Keyboard/pointer/touch parity, focus and live-region tests, contrast calculation, enlarged-text/reflow browser checks against WCAG |
| 3 | Unified visual tokens | Token/source audit, computed style checks and compact desktop/mobile visual confirmation |
| 4 | Real route modules, deferred histories, measured mobile work | Build import/chunk evidence, closed-history network/DOM evidence, same-condition before/after measurements with raw results |
| 5 | Real-browser automated release gate | CI success and intentionally failing gate checks; matrix/navigation/filter/chart/retry/download coverage; invalid payload stops publish |
| 6 | Longer leakage-free evaluation, recalibration experiments and revision vintages | Origin/fit/coverage metadata, calibration train-date assertions, immutable revision tests and prospective-vintage behavior |

### Task 1: Availability and Independent Regional Refresh

**Files:** Modify `pipeline/macrolens.py`, `app/lib/dashboard.ts`, `app/lib/dashboard-integrity.ts`, `app/lib/score-method.ts`, `app/lib/dashboard-health.ts`, `app/components/RiskScoreVisual.tsx`, `app/components/RiskScoreVisual.css`, `app/page.tsx`. Create `pipeline/tests/test_risk_availability.py`, `pipeline/tests/test_regional_refresh.py`, `tests/risk-availability.test.mjs`. Extend existing unit test script.

**Interfaces:** `build_risk_heatmap(...)` emits nine items with `score: number | null`, `level: low | moderate | high | unavailable`, optional availability reason and `availableCount`. `overallScore` is the mean of available items or null; omitted inputs never become zero. `weightedPressure(items, selectedId, multiplier)` excludes explicitly unavailable items and rejects malformed numeric scores. `build_regional_lens(previous, retrieved)` refreshes HIES state, district, percentile, labour, GDP and CPI independently, preserving each source's original retrieval clock when retained.

- [x] Write failing Python cases for null market return/drawdown, missing trade growth, short core change history and genuine zero. Example:
  ```python
  result = build_risk_heatmap(series, market_missing_return, growth, external, stamp)
  assert next(row for row in result['items'] if row['id'] == 'bursa')['score'] is None
  assert 'Unavailable' in next(row for row in result['items'] if row['id'] == 'bursa')['evidence']
  ```
- [x] Run `python -m pytest pipeline/tests/test_risk_availability.py pipeline/tests/test_regional_refresh.py -q`; confirm the pre-fix failures.
- [x] Implement source-local refresh wrappers and joins over the union of validated available geographies. Preserve each failed source's records/retrieval period, mark stale/attempt/error; no old source means unavailable rather than borrowing another source's values.
- [x] Implement nullable availability through validators, summary narratives, badges, ranked bars, heatmap, contributions and exploratory weights. Test all unavailable and partial availability as well as the legacy complete payload.
- [x] Run all Node units, all Python tests and app type checking. Regenerate only affected risk/brief/regional derived fields from preserved inputs; do not advance official source clocks for an offline calculation.
- [x] Review failing-source matrix and rendered unavailable evidence before proceeding to priority 2.

**Priority 1 checkpoint (2026-10-05):** 177 combined pipeline tests and 139 application tests passed; type check passed. Risk-specific suite subsequently expanded to 50 passing tests for the bounded offline recomputation. Twelve regional inputs have independent failure/first-run/mismatched-period/legacy-upgrade tests. Nullable charts, heatmap, table and Snapshot have rendered partial/all-missing/true-zero/fallback tests. Saved risk/brief recalculated at 12:09:33 UTC; official observations and retrieval clocks unchanged. These new changes are local and have not yet been published. Separate pre-existing Household Pressure wealth-risk missing-input coercion remains outside this Risk Heatmap contract and must be revisited before any broader data-accuracy claim.

### Task 2: Accessible Chart Inspection

**Files:** Modify Growth Drivers/trade chart definitions currently in `app/page.tsx`; create `app/lib/chart-inspection.ts` and `tests/chart-inspection.test.mjs`; update chart styles and browser checks.

**Interfaces:** `nextChartIndex(key, current, length): number | null` handles ArrowLeft/Right, Home/End and Escape consistently. A shared point-selection routine calculates tooltip coordinates from an observation index for pointer, touch and keyboard. Each chart provides an accessible name, instructions, visible focus and a polite live point description using the same formatted values.

- [x] Read the referenced WCAG primary guidance and inspect every current canvas/SVG chart and its controls.
- [x] Add failing navigation tests:
  ```javascript
  assert.equal(nextChartIndex('ArrowRight', 0, 3), 1);
  assert.equal(nextChartIndex('End', 0, 3), 2);
  assert.equal(nextChartIndex('Escape', 2, 3), null);
  ```
- [x] Add shared selection and announcement behavior to missing charts; fix inconsistent existing charts without changing economic values.
- [x] Test keyboard/pointer/touch selection parity, first/last/gapped data, focus retention, legend controls and resize behavior. Audit text/non-text contrast and forced-colour visibility.
- [x] Run units/typecheck/build and one batched browser matrix including enlarged text and 200%/400% reflow. Record tested assistive semantics separately from unperformed physical screen-reader certification.

**Priority 2 checkpoint (2026-10-05):** 161 Node tests, 19 rendered production tests, application type checking and production build passed. Chromium 151.0.7922.34 exercised 10 chart-bearing routes at phone/tablet/desktop, 200%/400% viewport-equivalent reflow and separate 200% text enlargement: 60/60 passed. Exact pointer/touch/keyboard point readouts, persistent polite statuses, chart focus retention, native Forecast/Snapshot controls, no document overflow and SVG axis labels >=14 CSS pixels were checked. Browser tests exposed and repaired dialog Escape propagation, legend focus/selection disagreement and Structural Shifts small-screen overflow. Contrast checks cover text and meaningful graphical pairs, including GDP slice boundaries and forecast point/bands. Evidence: `docs/verification/2026-10-05-chart-accessibility.json`. This is not a physical screen-reader or full WCAG certification; reflow cases are explicitly not OS/browser zoom. Forced-colour rules are present and will also receive real-browser release checks in priority 5. Changes remain local, unpublished.

### Task 3: Consistent Visual Tokens

**Files:** Create `app/design-tokens.css`; modify `app/globals.css`, compact CSS files and component CSS; create `tests/design-tokens.test.mjs`.

**Interfaces:** Semantic variables own `--surface-page`, `--surface-panel`, `--text-primary`, `--text-secondary`, `--border-default`, `--status-low`, `--status-moderate`, `--status-high`, `--status-unavailable`, `--focus-ring` and dark-surface equivalents. Chart series colours remain a separate categorical palette, not status aliases.

- [x] Inventory conflicting definitions and record the incumbent compact visual baseline.
- [x] Add tests that every required token is declared once in the token owner and that migrated components reference tokens rather than redefining them.
- [x] Extract token definitions and mechanically replace matching palette values; consolidate overriding declarations by responsibility. Keep semantic dark/forecast/risk surfaces.
- [x] Calculate token contrast pairs and verify computed styles for labels, badges, focus and hover/disabled states.
- [x] Build, run tests and compare desktop/mobile renders once; fix observed violations in one bounded batch and confirm.

**Priority 3 checkpoint (2026-10-05):** Shared semantic token ownership and canvas colour resolution have four passing tests, in addition to the 161-test application checkpoint. Type check and the exact production build passed. Ten real-browser computed-style/layout cases passed across five routes at phone and desktop sizes; representative Risk phone and Forecast desktop screenshots were visually reviewed. Text/status/focus contrast tests pass, with separate light/dark chart tokens and source-status versus economic-pressure roles. Compact information order, readable Arial and existing controls remain unchanged. Evidence: `docs/verification/2026-10-05-design-tokens.json`. Changes remain local, unpublished.

### Task 4: Route Modules and Measured Loading

**Files:** Create `app/components/DashboardShell.tsx`, `app/lib/dashboard-format.ts`, `app/views/*View.tsx`; modify `app/page.tsx` and every route wrapper. Create `tests/route-modules.test.mjs` and `scripts/measure-mobile.mjs` for the same browser CI environment.

**Interfaces:** `DashboardShell({section, children})` owns navigation, statuses, footer and data-loader lifecycle; route views consume `DashboardPayload | null` and section-local controls only. Route wrappers import their own view, not the complete nineteen-section component. History downloads and detailed rows are requested on disclosure, never eagerly for unrelated routes.

- [x] Capture pre-change built route JavaScript sizes, requested resources, timings and closed-history behavior with fixed phone viewport/cache/network conditions; preserve raw measurements.
- [x] Write a route import-graph regression that fails if a route imports the whole nineteen-section renderer or unrelated views.
- [x] Extract shared formatting/chart primitives and each route module. Maintain existing paths, bookmark parameters, source links, and API compatibility.
- [x] Defer complete detailed history loading, with bounded rows and explicit retry states; verify unopened history causes neither detailed network work nor mounted rows.
- [x] Run all route/render/unit/type/build tests and the same-condition mobile measurement script. Report actual changes, environment and limits, not an invented percentage gain.

**Priority 4 checkpoint (2026-10-05):** 212 application units, 20 exact-production rendered tests and application type checking passed. All 19 routes have isolated eager implementation graphs. Nine hydrated browser cases verified zero unopened-history requests, one explicit artifact-bound request, cached reopen and no closed forecast-window rows. The 60-case chart matrix also passed after extraction. Final production build passed. Four-route, three-trial cold mobile comparison reduced initial JavaScript by approximately 28–30% and page JSON bodies by 90–99%; timings are reported without a universal speed claim (Snapshot/Forecast LCP were slightly higher). Raw before/after, deferred-history and route-chart results and limitations are under `docs/verification/`. Source clocks remain unchanged; old-year GDP and genuine zero values are not borrowed or invented. These changes remain local, unpublished.

### Task 5: Real-Browser Release Gate

**Files:** Create `playwright.config.ts`, `tests/browser/dashboard.spec.ts`, `scripts/release-gate.mjs`, `.github/workflows/verify-dashboard.yml`; extend the existing GitHub daily workflow without changing its schedule. Add reviewed test-only browser/axe dependencies through the package manager.

**Interfaces:** A release command exits nonzero unless payload validation, Python units, Node units, typecheck, production build, rendered routes and the real-browser matrix all succeed. Browser tests execute the exact production Worker artifact. The publishing preparation consumes gate success for the exact source/build fingerprint, rejecting later mutation.

- [x] Add matrix projects for 390×844, 768×1024, 1280×900 and enlarged/reflow configurations representing 200% and 400%; document browser zoom versus viewport-equivalent reflow precisely.
- [x] Test navigation, news/regional filters, keyboard/pointer charts, forced retry/network failure, validated fallbacks and CSV/JSON downloads with assertions on values and statuses.
- [x] Add negative tests showing invalid payload and deliberately failing required browser assertions block the gate.
- [x] Run the full local real-browser release gate and preserve its stage logs, matrix output and trace artifacts. The GitHub verification workflow runs this gate on push/PR; the daily source updater still validates before committing and preserves stale-data behavior.
- [ ] Package/publish only with the matching successful release fingerprint; verify native deployment and public smoke checks, keeping audience/URL unchanged.

**Priority 5 checkpoint (2026-10-15):** The exact local production artifact passed all required stages after fixing Windows `.cmd` launch handling and making chart-check scrolling deterministic under smooth page scroll. Latest evidence includes 194 Python tests, 241 Node tests, typecheck, production build, 20 rendered tests, 119 Playwright cases and chart checks across phone/tablet/desktop, 200%/400% reflow and 200% text enlargement, plus deferred-history checks. The matching source/build/payload release fingerprint is recorded in `outputs/release-gate.json`, and `pnpm run release:ready` passed. GitHub Actions data-update run #92 completed successfully and committed dashboard outputs as `84a4d77`; this is a data commit, not publication of the local application-code changes or redeployment of the website. The new public artifact is reachable but fails the current forecast-integrity guard: where all held-out 95% recalibrated bands are unavailable, its summary still counts the uncalibrated original bands, so the two comparison columns are not paired. The current local pipeline and validator use matched points; a regression test now specifically rejects original-only counts when every adjusted interval is unavailable (the focused suite passes 20/20). Public deployment remains pending.

### Task 6: Forecast Evaluation, Calibration and Vintages

**Files:** Modify forecast/vintage routines in `pipeline/macrolens.py`, integrity validation, `ForecastAudit.tsx`, forecast tests; create `pipeline/tests/test_forecast_calibration.py`, `pipeline/tests/test_vintage_revisions.py` and method documentation.

**Interfaces:** Backtest origin selection expands to all eligible origins or an explicit reproducible larger cap, preserving common model windows and fit failures. Recalibration experiments use residuals from targets observed strictly before each forecast origin; split calibration and evaluation periods, retaining uncalibrated results for comparison. Vintage files include content hash and observation/retrieval timestamps; a revised same-period source creates a new immutable snapshot instead of replacing the first.

- [x] Add failing tests asserting every calibration target is strictly earlier than its historical forecast origin, and that repeated same-content retrieval does not duplicate a vintage. Existing source-revision tests preserve the first snapshot byte-for-byte.
- [x] Expand evaluation history using the common feature history; report attempted/successful folds, horizon MAE/RMSE, empirical coverage and interval width. The training floor is now 24 monthly observations and the cap is 60 common origins.
- [x] Compare rolling residual recalibration with the original bands on the identical held-out point set; reject mismatched samples in the browser-integrity validator. Model selection still requires every common origin to succeed and calibration remains experimental.
- [x] Preserve revision-aware append-only source snapshots, forecast issues and outcomes; validate duplicate retrievals, same-period revisions, first-seen outcomes and snapshot immutability.
- [x] Validate deterministic recomputation, short history/failed model behavior, interval containment and metadata/API/download parity. Record the source-history limit and paired-sample method in `docs/forecast-validation.md` and the Forecast audit UI.

**Priority 6 checkpoint (2026-10-15):** The MGS source recovered on a fresh local retrieval and the validated artifact was regenerated at 2026-10-15 07:00:18Z. Headline/core CPI and unemployment are through August 2026; OPR is dated 3 September 2026; FX and MGS market series include observations through 14 October 2026. BNM's benchmark page independently shows the 10-year MGS close at 3.83% and KL USD/MYR at 4.0826 for 14 October 2026 ([official source](https://financialmarkets.bnm.gov.my/benchmark-yields)). The pseudo-real-time window count remains 31 (Nov 2023–May 2026), limited by common MGS feature history. Every candidate uses the same 31 origins; SARIMA completes 31/31 and remains selected, Seasonal naive completes 31/31, and ARIMAX completes only 2/31 so remains ineligible despite its lower partial-sample error. The 12-origin warm-up leaves 19 held-out origins; 80% and 95% calibration comparisons use matched samples, with unsupported ranges excluded on both sides. The forecast records its information origin explicitly (August 2026), and one prospective issue has been captured for September–November 2026, unpublished in headline CPI at issue time. No target outcomes have arrived; true-vintage performance and official first-release status remain unverified. The public site was checked after run #92: its `/api/dashboard` still serves a fallback snapshot generated 2026-10-05. The public GitHub artifact is reachable but fails the current app's forecast-integrity checks; the prior pipeline artifact and the current local evaluator are not release-compatible. The local pipeline's refreshed schema-9 candidate passes validation, but publishing the matching app and data remains necessary to restore a fresh public response.

**Current release verification (2026-10-16):** The MGS refresh compatibility issue was fixed using BNM's versioned OpenAPI, and the validated public artifact now reports fresh data (schema 9; MGS through 15 October 2026). The GitHub raw artifact and anonymous Vercel `/api/dashboard` response have matching `generatedAt` values; `/api/indicator?id=mgs` returns the same 15 October observation. The existing Vercel production domain returns HTTP 200 without sign-in on Snapshot, Risk, Forecast, Regional, Growth Drivers and News. GitHub's scheduled updater is configured for 05:45 UTC (13:45 Malaysia time) and the latest scheduled run succeeded; GitHub data changes are fetched by the website API without a Vercel rebuild after its cache window. The exact application/data release gate passed and the tested changes were pushed and promoted to Vercel production (commit `9bc5250`). This verifies the Vercel publication path; it does not delete the separately hosted ChatGPT Sites copy, which remains untouched because its management page was not available in this session.

## Final Completion Audit

- [x] Inspect the current implementation and evidence for every acceptance-ledger row; absence of a failing test is not proof. See the task checkpoints and `outputs/release-gate.json` for the exact local release fingerprint.
- [x] Confirm publication gate and live artifacts correspond to the tested source and generated payload; the Vercel live API matches the current GitHub artifact and anonymous route smoke checks pass.
- [ ] Mark the active goal complete only when all six priorities have authoritative evidence. Otherwise record remaining requirements and keep the same full goal active.
