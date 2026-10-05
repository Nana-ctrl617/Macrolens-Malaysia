# Dashboard Trust and Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. These optional skills are unavailable in this session; isolated collaboration agents and root integration provide the execution fallback.

**Goal:** Correct regional comparison/export semantics and improve usability without weakening official-data provenance or forecast honesty.

**Architecture:** Keep the incumbent Sites/Vinext app and schema-nine compatibility. Extract regional comparisons and cached data loading into focused units. Add optional forecast audit fields without inventing historical vintages or changing official observations.

**Tech Stack:** React, TypeScript, Vinext, Python/pandas/statsmodels, Node tests, pytest.

**Spec:** The MacroLens website review delivered immediately before this request; archive at C:/Users/USER/Documents/Codex/2026-07-16/can/.impeccable/critique/2026-10-05T09-30-23Z__ens-compact-dashboard-source-app-page-tsx-a991734e.md.

## Global Constraints

- Preserve public audience, existing URL, official observations and schema compatibility.
- Retain correct source dates, stale/fallback status and educational boundary.
- No invented district metrics, savings estimates, risk probabilities, causality, vintage backtests or benchmark timings.
- Do not shrink readable text to compact the dashboard.
- Use apply_patch for edits; never write credentials to files.
- Root owns app/page.tsx, app/lib/dashboard.ts and publication. Agents edit isolated files.

### Task 1: Truthful regional comparison and exports

**Files:** Create app/components/RegionalLensView.tsx, app/lib/regional-data.ts and tests/regional-quality.test.mjs; modify app/api/regional-lens/route.ts. Root replaces the old RegionalLensSection in app/page.tsx.

**Interfaces:** RegionalLensView consumes DashboardPayload | null. Helpers produce geography-keyed records with metric-specific period/unit/source metadata. Export rows are long-form metrics.

- [x] Write a failing district mapping test: `assert.equal(records.find(r => r.key === 'Sarawak|Kuching').label, 'Kuching, Sarawak')`.
- [x] Write a mixed-period export test: `assert.equal(rows.find(r => r.metric === 'headlineInflation').observation_period, state.inflationPeriod)`.
- [x] Run `node --test tests/regional-quality.test.mjs` before implementation.
- [x] Bind both selectors, cards and charts to selected geography level. Match supplied district labour/GDP by state/district. Mark missing metrics unavailable; do not borrow state values.
- [x] Export `level,state,district,metric,value,unit,observation_period,source_url,data_status,retrieved_at` for every value. Preserve source uncertainty, annual year labels and regional percentile definitions.
- [x] Add bookmarkable comparisons and explicit aggregate contrast wording; retain income groups only for state mode.
- [x] Run targeted tests and app type checking; root reviews before release.

### Task 2: Honest forecast evaluation and pipeline parity

**Files:** Modify pipeline/macrolens.py and pipeline/tests/test_pipeline.py; regenerate validated forecast/export artifacts only after tests pass.

**Interfaces:** Keep forecast selectedModel/models/points/scenario; add optional evaluation with complete origin dates, per-horizon actual/predicted/error/intervals, fallback counts and measured interval coverage. CSV fields match Task 1.

- [x] Test complete windows: `assert all(len(fold['targets']) == 3 for fold in result['evaluation']['windows'])`; test every candidate uses identical origins.
- [x] Test fitting failures are disclosed, interval coverage numerator/denominator is correct and training never includes future targets.
- [x] Implement complete three-month rolling folds and explicit candidate eligibility/fallback reporting. Retain conservative release-lag and pseudo-real-time wording.
- [x] Generate interval coverage from historical model intervals; explain conditional covariates and overlapping windows.
- [x] Match published regional CSV to API long-form export and test per-metric provenance.
- [x] Run full Python tests; recompute analysis offline from existing validated observations without claiming a new official refresh.
- [ ] Root syncs tested pipeline corrections to the existing GitHub checkout when publication is authorised.

### Task 3: Cached loading and accessible histories

**Files:** Create app/lib/dashboard-client.ts and tests/dashboard-client.test.mjs; modify app/components/SeriesTrendPanel.tsx/CSS and add history tests. Root owns server cache and main effect integration.

**Interfaces:** Cached client loader returns Promise<DashboardPayload> from stable `/api/dashboard-v7`, coalesces requests for five minutes, supports explicit invalidation and preserves fallback health.

- [x] Test concurrent requests: `assert.equal(fetchCalls, 1)`; test expiry, rejected request recovery and successful reuse with injected fetch/time.
- [x] Implement stable URL, timeout/abort cleanup and deduplicated loading. Root integrates initial loading, failure and unavailable state announcements.
- [x] Mount history rows only when details opens and paginate 50 rows; test closed details omits table rows and boundaries disable navigation.
- [x] Compare request counts and closed-table DOM, not unsupported speed claims; run all affected tests.

### Task 4: Compact Risk and release validation

**Files:** Root edits RiskScoreVisual.tsx/CSS, app/page.tsx, compact-dashboard.css and app/lib/dashboard.ts; adds quality regressions and rendered route tests.

**Interfaces:** Retain RiskScoreVisual public props, use one active chart with nearby evidence. Optional forecast evaluation fields remain compatible with older data.

- [x] Add failing tests for one active Risk selection set, evidence placement, equal weights and empty input.
- [x] Implement chart mode toggle and evidence before plot on narrow screens. Explain component contribution and an explicitly exploratory weight-sensitivity calculation from published scores.
- [x] Compact Snapshot through spacing, not small fonts. Correct affected heading hierarchy, annual/quarter dates and async announcements.
- [x] Align OPR explanations to consecutive observed months; do not label irregular observation changes monthly.
- [x] Run Node/Python tests, type check and production build/rendered tests.
- [x] Inspect changed flows in one batched desktop/mobile browser pass; fix observed defects once and confirm once.
- [ ] Package exact pushed source and publish only after the requested external-write approval. Verify returned deployment success and changed public routes.
- [x] Save a reassessment with measured evidence and limitations; do not fabricate a perfect technical score or guarantee all official numbers.
