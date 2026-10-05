# Compact Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Those named skills are unavailable in this workspace; use the available bounded collaboration tools and root integration review.

**Goal:** Implement all five approved layout improvements, putting controls and economic results before supporting explanation.

**Architecture:** Retain the existing route wrappers, consolidated schema-nine payload and self-updating pipeline. Extract grouped navigation into a focused component; reorganise existing JSX and add scoped compact-layout styles after the incumbent styles. No data sources or statistical calculations change.

**Tech Stack:** React 19, Vinext, TypeScript, CSS, Node rendered-route tests, Python pipeline tests, Sites hosting.

**Spec:** `C:/Users/USER/Documents/Codex/2026-07-16/can/outputs/macrolens-layout-review.md` and the user's approval of a compact dashboard covering all five findings.

## Global Constraints

- Preserve all nineteen direct routes, source disclosures, freshness states and educational limitations.
- Preserve public audience and project `appgprj_6a586cf8690c819195f56eb8a6c23f33`.
- Preserve `/api/dashboard`, daily data refresh, schema nine and existing fallback compatibility.
- Retain the dark Forecast surface and MacroLens rust/teal identity.
- Use system sans-serif typography: 16px reading text, 14px metadata, 12–14px analytical labels.
- Keep original dirty generated exports unchanged; implement in the clean Sites checkout.
- Use `apply_patch`; no dependency additions.

---

### Task 1: Regional width and information order

**Files:** Modify `app/page.tsx` RegionalLensSection and `app/globals.css`; create `app/compact-dashboard.css`; extend `tests/rendered-html.test.mjs`.

**Interface:** Consume existing `DashboardPayload.regionalLens`; retain selected region, metric, chart/table and income group states.

- [x] Add a rendered test requiring `regional-controls` before `regional-comparison`, then income groups and source detail.
- [x] Replace `.deep-card div` flex scope with explicit `.deep-card-heading` on the household pressure row.
- [x] Put regional status, controls, comparison and state chart before income distribution, district cards, sources and limitations.
- [x] Use `minmax(0, 1fr)` grids and `min-width: 0`; keep district rank lists vertical and tables locally scrollable.
- [x] Verify populated Regional Lens at 1280px and 390px; document scroll width must not exceed client width.

### Task 2: Grouped navigation

**Files:** Create `app/components/DashboardNavigation.tsx`, `app/compact-navigation.css`; integrate in `app/page.tsx` and `app/layout.tsx`.

**Interface:** `DashboardNavigation({ active }: { active: DashboardSection })` returns the grouped sidebar/header, preserving every route and `aria-current="page"`.

- [x] Add a test for five navigation groups, nineteen links, a labelled mobile Sections toggle and active page.
- [x] Implement desktop grouped sidebar and compact top bar; expose current page and group.
- [x] Implement mobile menu with `aria-expanded`, Escape handling and focus-visible controls.
- [x] Verify open/close and a direct Regional/Forecast navigation at mobile width.

### Task 3: Snapshot reading order and card alignment

**Files:** Modify `app/page.tsx` MetricCard and snapshot JSX; `app/compact-dashboard.css`; `tests/rendered-html.test.mjs`.

**Interface:** Preserve `MetricCard({ metric, onSelect })` and six existing indicator explorer callbacks.

- [x] Add a rendered test requiring refresh metadata, metric grid, trend, supporting links and expandable definitions in that order.
- [x] Move six metrics directly below title/status; remove repeated top photo strip on analytical pages.
- [x] Replace absolute card action with a wrapping `metric-footer` period/status/action flow.
- [x] Make supporting shortcuts a 2×2 grid with concise destination headings.
- [x] Verify six cards, MGS stale footer, modal source links and responsive 3/2/1 columns.

### Task 4: Forecast and site-wide hierarchy

**Files:** Modify only Forecast JSX in `app/page.tsx`; create `app/compact-forecast.css`; update `app/compact-dashboard.css`.

**Interface:** Consume existing `forecast.points`, `forecast.models`, `forecast.backtestWindows`, narratives and `ScenarioExplorer`; no forecasting logic changes.

- [x] Preserve existing rendered Forecast explanation assertions.
- [x] Put plot and scorecard first, aligned at the top; make interval labels and score values readable.
- [x] Keep three final-month estimate/interval cards near plot; collapse method, definitions and limitations.
- [x] Use dynamic chart bounds derived from all interval limits to prevent off-plot values.
- [x] Apply shared title, metadata, table and source sizing; suppress analytical photo strips without deleting News photography.
- [x] Verify desktop/mobile plot, hover values, scorecard and expandable explanation.

### Task 5: Verification and release

**Files:** Existing build, route tests and pipeline tests; release evidence in `docs/compact-dashboard-verification.md`.

- [x] Build with bundled `pnpm.cmd run build`, then run `node --test tests/rendered-html.test.mjs`. The Sites build wrapper failed on Windows command-shim quoting; documented direct build fallback passed.
- [x] Run existing pipeline tests with the available Python environment.
- [x] Batch browser checks on Snapshot, Regional Lens, Forecast, Growth Drivers and News at desktop/mobile; fix observed failures once and confirm.
- [x] Run the Impeccable mechanical layout detector once on changed markup.
- [ ] Package through Sites source helper, save and deploy exact verified commit/archive, confirm terminal `succeeded`.
- [ ] Open the public updated site and smoke-check deployed navigation/layout.

## Test snippets

```js
assert.ok(html.indexOf('class="metrics-grid"') < html.indexOf('class="trend-card"'));
assert.ok(html.indexOf('class="trend-card"') < html.indexOf('class="snapshot-completion"'));
assert.ok(html.indexOf('class="regional-controls"') < html.indexOf('class="regional-comparison"'));
assert.ok(html.indexOf('class="regional-comparison"') < html.indexOf('class="income-group-panel"'));
assert.match(html, /class="metric-footer"/);
assert.match(html, /aria-expanded="false"/);
```

Run: `node --test tests/rendered-html.test.mjs` after a successful production build. Expected: all existing and new assertions pass. Browser checks, not source regex, establish width containment and visual alignment.

## Self-review

All five review priorities map to Tasks 1–4. Task 5 verifies the production artifact and public release. No statistical model, public access policy, official source or daily data pipeline modification is authorised by this layout pass.
