# Compact dashboard colour system

`app/design-tokens.css` is the sole owner of the shared palette. `app/layout.tsx` imports it before view styles. Do not add another palette-bearing `:root` block to a view or component.

## Incumbent visual baseline

The compact dashboard uses a neutral blue-grey page (`#f3f6f8`), white panels, dark ink (`#17252b`), readable secondary text (`#52636b`), and quiet borders (`#d5dfe4`). Arial/system sans, existing 8px compact panel corners, contained widths and spacing are preserved. This is a consistency extraction, not a layout redesign.

Three competing palette blocks previously supplied legacy cream, newsroom grey and compact dashboard values. They have been consolidated. Historical one-off illustration/gradient/opacity values in the legacy stylesheet are not a new theme and should not be used for shared UI.

## Token responsibilities

| Group | Purpose |
| --- | --- |
| `--surface-*`, `--text-*`, `--border-*` | Page/panel surfaces, readable content and control boundaries |
| `--accent-*` | Links, actions, editorial emphasis and control selection |
| `--source-*-text/background` | Official-source freshness and availability, not economic risk |
| `--pressure-*` | Rule-based low/moderate/high pressure classifications |
| `--category-*`, `--series-*`, `--news-topic-*` | Sector, indicator and topic identity; no positive/negative judgement |
| `--chart-*` | Plot text/grid/zero/selection colours, uncertainty bands and chart-specific series |
| `--focus-ring-*` | Visible keyboard focus on light/dark surfaces |

Compatibility aliases (`--paper`, `--card`, `--ink`, `--muted`, `--line`, `--teal`, `--rust`, `--navy`, `--dark`) resolve to this owner. Plan-facing aliases such as `--surface-panel`, `--status-low` and `--focus-ring` also resolve here. Component-local variables may alias these tokens but must not redefine the shared raw colours.

Unavailable source badges use neutral slate text/background and a dashed boundary. Fallback/stale badges use amber. High economic pressure uses a separate rust pair. Missing data must never receive a high-pressure label merely because it is unavailable.

## Dark pages and nested light charts

Forecast, Risk, Bursa, BOP, Timeline and Health retain their existing dark presentation using explicit `*-on-dark` and `--surface-dark-*` tokens. Light compatibility aliases are not overridden by a dark ancestor: `SeriesTrendPanel` and `BalancePaymentsVisual` intentionally remain light inside dark pages.

`--chart-focus` selects the dark cyan focus ring on dark routes and resets to the light blue ring within those light components. The owner defines these scopes once. Forced-colour styles remain in the chart/compact accessibility rules and use system colours.

## Charts and uncertainty

The 95% forecast band is `#6f9e8e`, and the 80% band is `#b7dacf`. The dark `#111f1c` central dot is visible inside the bands; its orange `#f07852` stem and legend remain visible against the dark track. Do not reintroduce the superseded lower-contrast band declarations.

Sector gold/grey and supported-break text retain the strengthened chart-accessibility values (`#9a6b16`, `#5d7564`, `#c73b2d`). Canvas code resolves actual computed CSS values rather than assigning unresolved `var(...)` syntax to a drawing context.

## Verification boundary

Token ownership, aliases, source/pressure separation and colour-pair contrast are covered by `tests/design-tokens.test.mjs` and chart contrast tests. Production computed-style checks and compact desktop/mobile comparisons are part of the priority-3 release checkpoint. Automated contrast/style tests are not a claim of complete WCAG certification or physical screen-reader testing.
