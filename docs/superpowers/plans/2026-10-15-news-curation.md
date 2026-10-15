# News Curation Implementation Plan

> **For agentic workers:** Execute inline after the navigation improvement passes validation.

**Goal:** Help readers scan more relevant economic coverage while preserving dates, sources, original headlines, and links.

**Architecture:** Keep the feed payload and server-side eligibility rules unchanged. Group only near-identical headlines in the News view, retain each source article under its story group, and expose both story and article counts so grouping never implies that source items disappeared.

**Tech Stack:** React 19, TypeScript, deterministic title normalization, CSS, Playwright, Node test runner.

**Spec:** User-approved improvement order in this task; no source or data-health behavior changes.

## Global Constraints

- Never invent, rewrite, or alter source publication dates or source URLs.
- Do not hide an article when grouping; provide the original source link and attribution.
- Keep latest-dated stories first and preserve topic/source filters.

---

### Task 1: Auditable related-story grouping

**Files:** Modify `app/views/NewsView.tsx`, `app/globals.css`, `tests/browser/dashboard.spec.ts`, and `tests/news.test.mjs` only if shared grouping helpers are extracted.

- [x] Add controlled fixture stories from two sources that refer to the same event and an unrelated similar-topic story.
- [x] Verify the near-duplicate is represented once as a story with both source links; the unrelated story remains separate.
- [x] Keep a prominent lead story and the rest of the results ordered by latest publication date.
- [x] Add clear coverage controls and counts, and preserve filter intersection/no-result recovery.

### Task 2: Validate news curation

**Files:** `tests/browser/dashboard.spec.ts`, `tests/rendered-html.test.mjs`.

- [x] Run News unit and browser tests, including source links, date order, filters, and responsive overflow.
