# Compact dashboard verification

Date: 5 October 2026. Scope: all five approved layout improvements, with compact information order rather than an editorial landing-page treatment.

## What changed

1. Regional Lens width containment: replaced the overly broad `.deep-card div` flex rule with an explicit heading class, constrained grids, and retained local scrolling for wide tables.
2. Data-first reading order: Snapshot leads with refresh status and six indicators; Regional Lens leads with controls and the selected comparison. Supporting definitions, sources and technical explanations remain available below or in expandable panels.
3. Grouped navigation: nineteen routes in five desktop sidebar groups, with a compact mobile Sections menu, current-page state, keyboard focus and Escape-to-close.
4. Card alignment: period, freshness and history action use normal wrapping flow; six metric cards keep consistent desktop heights. Supporting Snapshot links use concise destination titles.
5. Forecast and typography: plot and model score table lead, dark Forecast styling is retained, uncertainty cards stay near the plot, and technical explanations are collapsed by default. Chart bounds include the full prediction intervals. Shared system-sans typography and restrained neutral surfaces improve readability.

No economic data sources, statistical model calculations, schema version, official source links, daily workflow schedule or public audience were changed. Initial loading uses empty/placeholder values rather than showing old sample figures as though they were current.

## Automated checks

- Production build: passed using bundled pnpm with the frozen existing pnpm lockfile.
- Rendered HTML/API tests: 14 passed, including all nineteen routes, active links, information order, grouped navigation, Regional Lens scoping, Forecast explanations, fallback handling and downloads.
- Python pipeline tests: 29 passed.
- Whitespace/conflict checks: passed.
- Mechanical layout detector on changed main markup and dashboard styles: no findings. Navigation's system Arial family was deliberately retained in the existing-product refinement rather than introducing a new font dependency.

The pipeline export test now isolates both regional CSV/JSON paths in its temporary directory, as it already did for structural exports. Its earlier test-generated empty regional files were restored from this clean checkout's HEAD; no published data changes are included in the layout commit. The original dirty checkout was not edited.

The optional full TypeScript check is not clean because of pre-existing backend/binding issues in the indicator API, news regex compiler target, dashboard fallback types and Cloudflare runtime types. It reported no errors in the changed UI files. This release is verified by the production build and route/pipeline tests, not represented as a clean full typecheck.

## Browser checks against the production artifact

The exact generated Worker configuration was served through Wrangler. The vinext standalone preview returned missing static assets under this project's current Worker integration, so it was not used for final visual evidence.

The populated API used generated data dated `2026-10-04T11:16:32Z`, not fallback data. It showed headline inflation at 1.9%, ARIMAX selection and September–November 2026 forecasts.

| View | Desktop 1280 × 720 | Mobile 390 × 844 |
| --- | --- | --- |
| Snapshot | Document client/scroll width 1265/1265; six populated cards each 253.2px high; wrapping stale MGS footer | Client/scroll width 375/375; first card and history modal load; history keyboard tooltip works |
| Regional Lens | Client/scroll width 1265/1265; controls near the top; district switching remains contained | Client/scroll width 375/375; Sarawak versus KL expenditure selection displays RM 4,281 versus RM 8,178; 960px-wide table scrolls inside its 343.2px panel |
| Forecast | Client/scroll width 1265/1265; plot and scorecard align at the top with intrinsic heights; 13px scale labels, 14px table text | Client/scroll width 375/375; compact 114px header; central/80%/95% tooltip accessible by focus/tap; method details expand |
| Growth Drivers | Client/scroll width 1265/1265; photo strip hidden, year and production/expenditure controls retained | Shared responsive containment rules and navigation verified |
| News | Client/scroll width 1265/1265; photography and visible topic/source choices retained | Shared responsive navigation verified |

Mobile Sections showed five groups and nineteen routes. Escape closed the menu and restored focus; clicking Forecast navigated to that route. Default Forecast technical disclosures were closed. November's tooltip displayed central 1.81%, 80% range 1.43–2.18%, and 95% range 1.23–2.38% from the loaded payload.

QA used one desktop/mobile observation batch, one fix batch and one confirmation batch. These are viewport-emulation and selected keyboard checks, not a physical-device study or a full accessibility certification.

## Release

Release follows the Sites source helper's verified commit/archive, preserving the public project and URL. GitHub synchronisation applies the code-only commit onto the latest GitHub main so automated economic data and CPI vintages are not rolled back. The final response records the confirmed public release and any sync limitation.
