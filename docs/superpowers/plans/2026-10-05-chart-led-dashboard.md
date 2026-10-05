# Chart-led MacroLens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing dashboard easier to understand through interactive visual comparisons, retaining full evidence.

**Architecture:** Add small payload-driven React/SVG components with scoped CSS. Reuse them in existing pages; keep data generation and APIs unchanged. Use bounded parallel implementation and one batched desktop/mobile browser check, fixing only observed defects before one confirmation pass.

**Tech Stack:** React, TypeScript, SVG, existing Vinext/Sites build, Node test runner.

**Spec:** `docs/visualization-upgrade-spec.md`

## Global Constraints

- Payload schema 9/8, existing calculations, daily pipeline, public audience and URL remain unchanged.
- Source/unit/date/status labels and original evidence remain accessible.
- No fabricated observations, risk history, causal claims, investment instructions or chart dependencies.
- Controls at least 44px; labels generally 14–16px; page-wide mobile overflow prohibited.

## Task 1: Risk and household score comparisons

**Files:** Create `app/components/RiskScoreVisual.tsx`, its CSS and `tests/score-visual-source.test.mjs`; owner modifies `app/page.tsx`.

**Interface:** `RiskScoreVisual({ items: RiskItem[], overallScore: number, overallLevel: "low" | "moderate" | "high", title?: string })`. Finite scores in 0–100, displayed as supplied; original levels are authoritative. Missing items produce an honest empty state.

- [x] Check source regressions for `aria-pressed`, readable scale labels, selected evidence and no fabricated history.
- [x] Implement selectable matrix, common-scale score bars and evidence inspector.
- [x] Replace repeated first-view Risk/Household cards; retain existing detailed tables and text in `details`.
- [x] Run `node --test tests/score-visual-source.test.mjs` and component-render tests.

## Task 2: Actual time-series trends

**Files:** Create `app/components/SeriesTrendPanel.tsx`, CSS, `app/lib/visual-data.ts`, `tests/visual-data.test.mjs`; owner integrates Brief.

**Interface:** `SeriesTrendPanel({ series: SeriesData[], statuses?: Record<string,string>, title?: string, defaultKey?: string })`. Point sanitation and range selection use only payload observations; SVG gaps remain gaps for missing monthly observations.

- [x] Test deterministic windows, negative/constant values, malformed observations and non-mutation, e.g. `assert.deepEqual(input, original)` after range preparation.
- [x] Implement 1Y/3Y/All selection, point hover/click/keyboard inspection and full table equivalent.
- [x] Put the chart before Brief explanations; group existing generated copy in expandable panels without deleting it.
- [x] Run `node --test tests/visual-data.test.mjs` and rendered regression tests.

## Task 3: BOP accounting charts

**Files:** Create `app/components/BalancePaymentsVisual.tsx`, its CSS and focused tests; owner integrates `BalancePaymentsSection`.

**Interface:** `BalancePaymentsVisual({ data: BalancePayments })`. Consume real quarters/accounts only. Missing account balances are unavailable, not zero; retain source and status.

- [x] Test signed scaling, absent accounts, zero/negative values and exact-quarter labels.
- [x] Implement selectable account trend and latest-quarter diverging balances around zero.
- [x] Preserve accounting interpretation and detailed source table, grouping it in progressive disclosure.
- [x] Run focused tests and production-rendered route tests.

## Task 4: Forecast error comparison and integrated release

**Files:** Create `app/components/ModelErrorVisual.tsx`, scoped CSS and `tests/visualization-render.test.mjs`; modify `app/page.tsx`, `package.json`, `tests/rendered-html.test.mjs`.

**Interface:** `ModelErrorVisual({ models: DashboardPayload["forecast"]["models"] })`. Toggle RMSE/MAE, exact values in percentage points, selected-model badge unchanged. No scores computed from observations.

- [x] Render tested component fixtures and assert supplied values/source labels are present, with absent/malformed inputs handled.
- [x] Integrate all new visual surfaces; retain warnings and readable layout; no changes to models/API/pipeline.
- [x] Run application typecheck, Node regressions, production build and rendered routes. Final run: 57 unit/component checks and 17 production-rendered checks passed; application typecheck and build passed.
- [x] Browser-check Risk, Brief, Household, BOP and Forecast together at desktop/mobile sizes, click/keyboard points and selection states. Fix observed issues in one batch and confirm once. Pointer handlers are source-tested; native hover was not exercised by this browser interface.
- [x] Synchronise only changed application/tests/docs to GitHub without overwriting newer generated artifacts. Push exact Sites source, package matching built output, deploy and verify success/live pages. Published version 53; source SHA b44edb85919fbd413a96c74caf625bf1c4362f32; public routes and assets verified.

The superpowers execution sub-skills are unavailable; use the provided collaboration tools for bounded parallel execution now. Implementation is authorized by the user's request; no additional planning approval is required.
