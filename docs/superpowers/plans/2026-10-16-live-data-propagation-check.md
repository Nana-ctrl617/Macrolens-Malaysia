# Live Dashboard Data Propagation Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each scheduled refresh prove that the public Vercel API serves the exact validated dashboard artifact committed to GitHub, without requiring a data-only website rebuild.

**Architecture:** Add a small Node verification script that reads the locally validated artifact, polls the public `/api/dashboard` endpoint for a bounded period, and succeeds only when schema, generation timestamp, and non-fallback state match. Run it after the GitHub update workflow has completed its commit/push step, then align migration documentation and regression tests with the configured Vercel data-only build skip.

**Tech Stack:** Node.js 22, GitHub Actions, Vercel Next.js API, Node test runner.

**Spec:** `docs/vercel-migration.md` and the existing self-updating dashboard contract in `README.md`.

## Global Constraints

- The public GitHub artifact remains the canonical dashboard data source.
- A failed, malformed, older, or fallback API response must never be reported as a successful update.
- Polling must be bounded and require no secret credentials.
- A data-only refresh must appear at runtime without rebuilding the website; code/config changes continue to trigger builds.
- Keep cached fallback data available and labelled if the public source cannot be reached.

---

### Task 1: Add a bounded public-artifact verifier

**Files:**
- Create: `scripts/verify-live-dashboard.mjs`
- Test: `tests/release-workflow.test.mjs`

**Interfaces:**
- Export `verifyLiveDashboard({artifactPath, apiUrl, fetcher, attempts, intervalMs, sleep})`.
- Return `{generatedAt, schemaVersion, attempts}` on exact successful match; throw an error describing the last observed mismatch when attempts expire.
- Direct execution uses `data/published/dashboard.json`, `DASHBOARD_API_URL` (default `https://macrolens-malaysia.vercel.app/api/dashboard`), 13 attempts, and 30-second spacing.

- [x] Test exact timestamp/schema match with `usingFallback: false` succeeds on the first request.
- [x] Test stale timestamp and fallback responses retry, then succeed when the exact artifact appears.
- [x] Test malformed JSON, HTTP errors, missing fields, and exhausted retries fail closed.
- [x] Implement request timeouts, bounded polling, concise progress, and no secret-dependent configuration.
- [x] Run the focused Node workflow test file and confirm the regression cases pass (18/18).

### Task 2: Make the scheduled refresh verify public propagation

**Files:**
- Modify: `.github/workflows/update-dashboard.yml`
- Test: `tests/release-workflow.test.mjs`

**Interfaces:**
- Add a step after `Commit validated changes` and before the always-run summary.
- Set `DASHBOARD_API_URL` to the public Vercel dashboard API; execute `node scripts/verify-live-dashboard.mjs` only when generated payload validation succeeded.

- [x] Assert workflow ordering: validate artifact → commit/push → verify public API → summarize.
- [x] Verify the workflow requires no new permissions, tokens, or secrets.
- [x] Ensure a failed API propagation makes the run visibly fail instead of falsely reporting successful publication.

### Task 3: Align migration and maintenance instructions

**Files:**
- Modify: `docs/vercel-migration.md`
- Modify: `README.md`

- [x] Replace the obsolete instruction that every data-only commit must deploy with the actual contract: runtime API reads the GitHub artifact, Vercel skips data-only rebuilds, and API cache is bounded to five minutes.
- [x] Replace the old cutover check that expects a new Vercel deployment with a check that the public API's schema, generatedAt, and fallback flag match the latest validated GitHub artifact after the bounded cache interval.
- [x] Document that if the verification step fails, the workflow is red, the old valid public payload remains available, and the host should not be retired.
- [x] Preserve the existing statement that deleting the separate ChatGPT-hosted copy is a distinct cutover action requiring successful live-data verification.

### Task 4: Run the production release gate and verify live behavior

**Files:**
- No new source files.

- [x] Run `pnpm.cmd run release:check` and `pnpm.cmd run release:ready`.
- [x] Confirm the full browser suite still passes and the current production Data Health route/API remain reachable.
- [x] Compare the public Vercel API `generatedAt`, `schemaVersion`, and `usingFallback` with the public GitHub artifact (schema 9, generatedAt `2026-10-16T10:05:57Z`, fallback false).
- [ ] Confirm Vercel production deploys the code/workflow change, while the next scheduled data-only run is explicitly checked by the new polling step.
- [ ] Publish only after the exact release gate succeeds; verify the production deployment and API once more.
