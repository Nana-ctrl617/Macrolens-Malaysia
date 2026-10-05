# Exact-artifact release gate

Run from the project root with Node 22.13 or later, Python with the pipeline requirements, pnpm, and the pinned Playwright Chromium installed:

```text
node scripts/release-gate.mjs
node scripts/assert-release-ready.mjs
```

On Windows, `PYTHON_EXE` and `PNPM_EXE` can identify installed executable paths, including a native `pnpm.cmd`. Otherwise the tools are resolved from PATH. These select tools, not stages: there is no skip or narrow-test option.

The gate runs these required stages in order: exact published-payload validation; every Python pipeline test; all Node units; app type checking; production build; rendered-production tests; the Playwright suite; the complete chart browser matrix; and deferred-history browser checks. Every child has a bounded timeout. A nonzero exit, assertion failure, launch failure, timeout, missing stage, or changing source/payload/build blocks the release. Previous success receipts are removed before a new attempt.

After the build, the gate starts and later stops its own local production Worker on `127.0.0.1:4185`. It refuses an occupied port and never borrows an unrelated preview. `PLAYWRIGHT_EXTERNAL_SERVER=1` prevents a second browser-test server. Browser fixtures are bounded, offline observations of the validated saved data; they are not proof that official upstream data is current. Chart profiles/routes and test-runner injection options are removed from child environments so the release cannot silently narrow coverage.

## Evidence and packaging

Only a completely successful run creates `outputs/release-gate.json`. It records all nine stage results and log hashes, the source-tree SHA256, production `dist` tree SHA256, and exact `dashboard.json` SHA256. The source fingerprint covers app/source libraries, pipeline, public assets, scripts, tests, build/config files, workflows, package/lock/config files, and generated downloadable companions. The main payload is fingerprinted separately. Build logs, generated outputs, verification documents, dependency trees, `.git`, `.openai`, and transient caches are excluded. Source/build symlinks fail closed rather than silently escaping the selected tree.

`assertReleaseReady(root)` must run immediately before packaging/publishing. It rehashes the source, build, payload and stage logs and verifies a locally signed receipt. Any later tested-file or build mutation requires the entire gate again. It does not edit source or build files.

The random per-run key is `outputs/.release-gate-key`. Do not upload it or include it in source/release bundles. Unix mode 0600 is set where supported; Windows access remains governed by the local filesystem ACL. Signing prevents accidental edits or made-up receipt JSON from being mistaken for the trusted run. It is **not a security boundary against a malicious local filesystem owner**, who controls the code and key.

Failure details are written to `outputs/release-gate-failure.json`; stage logs are under `outputs/release-gate-logs/`. They are diagnostics, not release permission. Browser reports/traces remain in their configured output directories.

## Negative controls

Unit tests deliberately use invalid published data, fail a required child/assertion, omit a stage, and mutate source/build/payload fingerprints. Their controlled fixture artifacts are not a release receipt for this project.

`PLAYWRIGHT_INJECT_FAILURE=1` is the one permitted test-only negative browser control. It makes a required browser assertion fail. Even if that assertion were accidentally removed, the gate refuses to create a success receipt while the control is set. A successful release run always leaves it unset. There is no equivalent success/skip environment flag.

Automated tests cover the documented browser matrix and semantics. They do not establish physical screen-reader certification, real-device battery/performance guarantees, causal economic validity, or guaranteed forecasts. Viewport-equivalent reflow is recorded separately from actual OS/browser zoom.
