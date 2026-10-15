---
target: MacroLens Malaysia homepage
total_score: 28
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 2
target_identity: "file:C:\\Users\\USER\\Documents\\Codex\\2026-07-16\\can\\work\\macrolens-compact-github\\app\\views\\SnapshotView.tsx"
target_fingerprint: "sha256:f188142f3ca9c821dc8ec07095baa6781f06f1fbbbc9143ad6671351d3bf86c3"
target_path: "C:\\Users\\USER\\Documents\\Codex\\2026-07-16\\can\\work\\macrolens-compact-github\\app\\views\\SnapshotView.tsx"
timestamp: 2026-10-15T14-44-21Z
slug: app-views-snapshotview-tsx
---
# MacroLens Malaysia homepage critique

## Design health: 28/40 — Good

This heuristic score is for the homepage, not a full-site or accessibility certification.

| # | Heuristic | Score | Main observation |
|---|---|---:|---|
| 1 | Visibility of system status | 3/4 | Refresh time and per-indicator freshness are shown, but “Official data · partial” doesn’t say what is partial. |
| 2 | Match with the real world | 3/4 | Mostly plain language; “MGS” is unexplained on the summary card. |
| 3 | User control and freedom | 3/4 | Searchable navigation and closable indicator details provide clear exits. |
| 4 | Consistency and standards | 3/4 | Navigation, cards, and status patterns are mostly consistent. |
| 5 | Error prevention | 3/4 | Release periods and stale labels help distinguish data of different ages. |
| 6 | Recognition rather than recall | 3/4 | Grouped, searchable navigation and descriptive labels help users find sections. |
| 7 | Flexibility and efficiency | 2/4 | Search helps, but repeat users have no way to pin or personalize common indicators. |
| 8 | Aesthetic and minimalist design | 3/4 | Clean and restrained, though it could feel more distinctly MacroLens. |
| 9 | Error recovery | 3/4 | A source failure has a retry path and fallback data is labeled. |
| 10 | Help and documentation | 2/4 | Some explanations are inline, but help is not consistently available beside unfamiliar terms. |

## Design specificity and overall impression

The Malaysian indicators, release periods, and local source framing make the product relevant; the visual identity itself remains fairly familiar for an analytics dashboard. The homepage has a useful path from key indicators to the inflation trend and related analysis. The main trust gap is that a “partial” status is visible without a clear explanation.

## What works

- Freshness is legible at point of use: KPI cards show periods/status and stale MGS is not silently treated as current.
- The homepage progresses from indicators to chart and interpretation.
- Navigation is grouped, searchable, and keeps the current page visible.

## Priority issues

1. **[P1] Public access does not match the intended audience.** The production deployment has Vercel Authentication protection enabled; an authenticated bypass was needed to inspect it. If classmates, recruiters, or other visitors should use the site without a Vercel login, this is the first release issue to resolve. Keep previews private if useful.
2. **[P1] Keep the live deployment and GitHub source in sync.** The recent production publish came directly from the local worktree, which still has uncommitted changes. That makes it harder to reproduce or roll back the live version from GitHub. Commit and push the tested version, then use one dependable release route.
3. **[P2] Put source and status details beside every headline number.** The homepage cards show release period and freshness, but the visible source note is attached to the inflation chart; the overall “partial” label does not identify the affected indicator or source. Add a compact source link and explain the partial/stale state on each card.
4. **[P2] Make the card action label unambiguous.** “View history ↗” appears inside a whole-card button that opens an internal detail view. The arrow can imply an external link. Use “Open history” and remove the external-link styling, or make the card action more explicit. Source: `app/views/SnapshotView.tsx:22-36`.
5. **[P2] Improve first-use explanations.** Expand “MGS” on first mention and add a short explanation of what the “partial” status means, without adding much page clutter.

## Persona red flags

- **Alex, repeat analyst:** Search helps, but there is no way to pin or personalize common indicators; repeated comparisons start from separate cards.
- **Sam, accessibility-focused visitor:** The source contains named KPI buttons, visible keyboard chart guidance, and focus styling. Color alone should not carry the stale/partial meaning; manual screen-reader/contrast testing was not performed in this pass.
- **Jordan, first-time visitor:** “MGS” may be unfamiliar and the definitions disclosure appears after the main KPI/chart content; expand the acronym or add a brief inline definition.

## Minor observations

- Navigation groups the many destinations, though “Markets / research” combines broad concepts.
- A future news-to-data bridge could connect major stories with relevant series while distinguishing reported events, observed data, and interpretation.
- An earlier technical review rated theming 2/4 due to repeated color literals outside the shared token stylesheet; that count was not remeasured in this pass.

## Automated and browser evidence

- `impeccable detect --json app/views/SnapshotView.tsx` returned `[]` (0 findings). This is a narrow static scan, not a whole-site accessibility audit.
- One reviewer inspected a fresh production desktop view. A separate browser view showed the homepage shell but dashboard metrics were still loading; no mobile or assistive-technology review was completed in this pass.
- Script injection was unavailable in the browser controls, so no overlay was shown and the Impeccable live server was not started.

## Questions to consider

- Could the “partial” status explain itself in one short sentence?
- Should users be able to pin the indicators they compare most often?
- Could a story-to-data link make the News section more useful without implying causation?
