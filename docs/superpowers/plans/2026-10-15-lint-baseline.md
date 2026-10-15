# Lint Baseline Implementation Plan

> **For agentic workers:** Execute inline after navigation and News validation pass.

**Goal:** Make the repository lint command provide a useful, passing signal for maintained application and test code.

**Architecture:** Scope ESLint to maintained source, tests, and scripts rather than generated `.venv`, `.vercel/output`, or build output; fix real source violations and document any narrowly scoped rule exceptions with reasons. Keep type checking and the existing build/test gates independent.

**Tech Stack:** ESLint 9 flat config, eslint-config-next, TypeScript, pnpm.

**Spec:** User-approved improvement order in this task; preserve current framework and rules where practical.

## Global Constraints

- Do not silence whole rule families or mark the lint script successful while errors remain in maintained source.
- Ignore generated and third-party artifacts explicitly.
- Re-run lint, app typecheck, production build, and relevant test suites after changes.

---

### Task 1: Establish maintained-code lint scope

**Files:** Modify `eslint.config.mjs` and `package.json` only if required by the config; resolve all source/test errors emitted by the scoped command.

- [x] Record the exact scoped baseline for `app`, `tests`, and `scripts`.
- [x] Ignore generated and third-party directories explicitly.
- [x] Fix each maintained-code error, preferring changes that preserve behavior and existing test expectations.

### Task 2: Verify the lint baseline

**Files:** `eslint.config.mjs`, `package.json`, touched source/test files.

- [x] Run `pnpm run lint` and require exit code 0.
- [x] Run `pnpm run typecheck:app`, production build, unit tests, rendered HTML tests, and browser tests.
