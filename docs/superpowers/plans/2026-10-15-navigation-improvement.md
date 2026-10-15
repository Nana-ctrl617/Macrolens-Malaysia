# Navigation Discovery Improvement Implementation Plan

> **For agentic workers:** Execute inline in this session and validate each task before proceeding.

**Goal:** Make all 19 dashboard destinations easier to find without changing their route URLs or removing any page.

**Architecture:** Retain the five existing topic groups, clarify ambiguous labels, and add an accessible search over page names, groups, and keywords. Use native collapsible groups so the current area is immediately visible while all other destinations remain one action away.

**Tech Stack:** React 19, TypeScript, Next-compatible links, CSS, Playwright, Node test runner.

**Spec:** User-approved improvement order in this task: navigation first, news curation second, lint baseline third; preserve existing site identity and route behavior.

## Global Constraints

- Preserve all 19 route IDs and URLs.
- Keep mobile navigation keyboard-accessible and correctly labelled, with closed-panel visibility and accurate `aria-expanded` state.
- Keep the incumbent visual design; do not change theme tokens in this pass.

---

### Task 1: Discoverable navigation controls

**Files:** Modify `app/components/DashboardNavigation.tsx`, `app/compact-navigation.css`, `tests/rendered-html.test.mjs`, and `tests/browser/helpers.ts`.

- [x] Test the accessible search control, all 19 route links, collapsible topic groups, and no-results behavior.
- [x] Add page keywords and concise clarifying labels while preserving route identifiers.
- [x] Add current-group-first disclosure and a labelled search field with clearable filtering.
- [x] Verify route navigation, mobile close/Escape behavior, focus visibility, and no horizontal overflow.

### Task 2: Validate navigation

**Files:** `tests/browser/dashboard.spec.ts`, `tests/rendered-html.test.mjs`.

- [x] Run rendered navigation assertions.
- [x] Run the full 19-route browser journey at desktop and mobile widths.
