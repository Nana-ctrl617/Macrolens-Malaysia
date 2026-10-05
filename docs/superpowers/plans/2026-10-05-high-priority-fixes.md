# MacroLens High-Priority Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Fix the three confirmed high-priority trust, navigation/accessibility and news defects without changing dashboard statistics or the compact visual identity.

**Architecture:** Correct national benchmarks and health dependencies in the Python generator, then normalise legacy dashboard artifacts at the consolidated TypeScript boundary. Repair the existing explorer and semantic controls, and isolate news parsing/date filtering/deduplication for deterministic tests. Release the exact tested source to the existing public Sites project and synchronise pipeline changes to its existing public GitHub repository.

**Tech Stack:** Python/pandas/pytest, React/TypeScript/Vinext, Node test runner, Sites.

**Spec:** `.impeccable/critique/2026-10-05T07-13-50Z__app-page-tsx.md`, priorities 1–3, authorised in this chat on 5 October 2026.

## Global Constraints

- Preserve schema version 9 and version 8 compatibility; no forecasting or structural-test model changes.
- Preserve the public URL, audience, scheduled daily workflow, all official observations and the compact design.
- Never compute a national household expenditure benchmark as an unweighted average of state averages.
- Preserve last-valid values on failure; separate successful retrieval time from refresh attempt time.
- Derived analysis inherits non-fresh input status; cached or bundled data must not be described as live or official forecasts.
- News must exclude missing/invalid publication dates, future dates and dates outside its stated seven-day window; no invented articles to fill the page.
- No source-history rewrite or destructive reset. Use apply_patch for edits. Owner publishes after all checks pass.

## Task 1: Data trust and compatibility

**Files:** Modify `pipeline/macrolens.py`, `pipeline/tests/test_pipeline.py`, `app/lib/dashboard.ts`; create `tests/dashboard-trust.test.mjs`; update generated `data/published` through the normal writer.

**Interfaces:** Generator emits source status plus `retrievedAt` for last success and `lastAttemptAt`; derived sections carry `inputHealth`. TypeScript normalisation accepts legacy `overallHealth/summary` and canonical `overall/note`, and derives conservative statuses from source dependencies.

- [x] Add failing parser and dependency regressions. The national test asserts `result["national"]["expenditureMean"] == 5566` even when every synthetic state's expenditure is 4000. A stale OPR fixture must make forecast, risk, brief, household and decision output non-fresh. A failed refresh must retain previous `retrievedAt`.
- [x] Run `python -m pytest -q pipeline/tests` and confirm the new expectations expose the defects.
- [x] Implement official national HIES expenditure parsing with exact survey-period matching and validation; missing national data is unavailable, never fabricated. Implement conservative health propagation and canonical health fields, including regional and demand sources.
- [x] Normalise old remote and fallback objects at `getDashboard()` so the already-published artifact cannot bypass fixed badges. Use focused tests with `assert.equal(normalizeDashboard(payload).riskHeatmap.status, "partial")` for stale OPR and test canonical/legacy Data Health mapping.
- [x] Re-run pipeline and boundary tests, regenerate validated artifact/exports, review numeric changes and commit with the other integrated fixes.

## Task 2: Existing interface accessibility and evidence links

**Files:** Modify `app/page.tsx`, `app/layout.tsx`, `app/compact-dashboard.css`, `tests/rendered-html.test.mjs`; create a focused DOM interaction test if the current runner supports it.

**Interfaces:** Explorer opens with focus inside, contains Tab/Shift-Tab, closes with Escape and returns focus to its trigger. Diagnostics use `/structural?indicator=<id>`; StructuralSection reads that selection. Visible health labels come only from the normalised consolidated payload.

- [x] Add render assertions for one main `h1`, skip link, pressed controls, health status, readable status context and no "official forecast" text. Add source/interaction regressions for explorer containment and indicator-preserving diagnostics navigation.
- [x] Replace hash link with the explicit structural route. Add initial focus, background inertness, Tab containment and restoration without resetting focus whenever the parent renders.
- [x] Add main heading semantics without changing typography, accessible chart-row value/source labels, selected-state attributes and full-width mobile regional selectors. Fix the dark Risk label contrast and preserve table-local scrolling.
- [x] Build and run `node --test tests/rendered-html.test.mjs`; browser-test explorer focus, Escape, diagnostics route/selection, health badges and desktop/mobile geometry in one batched pass.

## Task 3: Reliable seven-day news

**Files:** Modify `app/api/news/route.ts`; create `app/lib/news.ts`, `tests/news.test.mjs`; owner updates `NewsSection` in `app/page.tsx` and existing CSS.

**Interfaces:** News parser accepts a clock for deterministic filtering, returns safe HTTP(S) canonical links, publication timestamps and real publisher attribution. Missing/out-of-window news returns an honest empty state and source audit, not a fabricated headline.

- [x] Add fixtures for malformed dates, missing dates, future stories, older stories, Bing redirect duplicates, numeric/named/nested HTML entities and mojibake. Use `assert.equal(items.length, 1)` for two links to the same canonical article, and `assert.ok(items.every(item => Date.parse(item.publishedAt) >= cutoff))`.
- [x] Run the parser tests to establish failing baseline; implement entity/text cleaning, canonical redirect extraction, date validation, deduplication and newest-first ordering. Identify publishers from RSS source/creator/Bing source metadata and destination host fallback.
- [x] Remove the generic three-picture strip from News only, show count/window and honest unavailable/no-match states, and retain colourful accessible topic/source controls.
- [x] Update existing news route fixtures to use a controlled/current clock; run production route and unit tests.

## Task 4: Integrated release

**Files:** Create `docs/high-priority-verification.md`; preserve `.openai/hosting.json`, `.github/workflows/update-dashboard.yml`.

- [x] Run Python tests, all new Node tests, TypeScript checks and the production build against the final source.
- [x] Run one batched desktop/mobile browser inspection of Snapshot, Risk, Forecast, Health, Regional and News; fix only observed scope defects, then confirm once.
- [ ] Synchronise changed files to GitHub preserving any newer automated observations; push the pipeline, trigger the existing workflow if supported, and verify the validated public artifact.
- [ ] Package with the Sites source helper using its opening result and unchanged built output; save and deploy the returned commit/archive to the existing public project. Confirm `succeeded`, open the public URL and smoke-check corrected statuses and news window.
- [ ] Record tests, release version, live verification and remaining limits. No medium-priority statistical claims are silently upgraded.

## Execution note

The user has explicitly requested implementation, so execute now using bounded parallel agents for Tasks 1 and 3, while the owner handles Task 2, consolidation, testing and publishing. The superpowers execution sub-skills are not installed; use the available collaboration tools without installing unrelated tooling.

## Verification checkpoint

Final checks: 40 Python tests, 23 Node regressions, 16 production-rendered tests, application TypeScript check and production build passed. Browser checks confirmed focus containment/restoration, indicator-preserving diagnostics, conservative badges, readable Risk labels, full-width mobile Regional controls and headline-first News. The previous critique established the defects; red-test console output is not part of this retained record. Deployment and public artifact checks remain pending.

