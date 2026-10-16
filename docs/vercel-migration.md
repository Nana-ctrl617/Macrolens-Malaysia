# MacroLens Malaysia: Vercel deployment and cutover

## Current deployment contract

- Framework: Next.js App Router, built by `pnpm run build:vercel`.
- Canonical data: `data/published/dashboard.json` in the public GitHub repository.
- Runtime data path: `/api/dashboard` reads the GitHub artifact directly with framework caching disabled, validates it, and caches a successful response for up to five minutes per warm function instance. If retrieval or validation fails, the API serves the last valid artifact or bundled fallback and marks it as fallback; it never silently calls stale data live.
- Daily refresh: GitHub Actions runs at 05:45 UTC (13:45 Malaysia time) and commits changed, validated `data/published`, `data/vintages`, and `data/backfill` files to `main`.
- Vercel build behavior: `vercel.json` uses `scripts/vercel-ignore-build.mjs` to skip only commits whose changed paths are entirely under the three data directories. Runtime API retrieval makes new data visible without rebuilding the website. Missing/invalid previous SHAs, code/configuration changes, and unexpected paths fail open and build normally.
- Refresh verification: after validation and push, the GitHub workflow polls the public `/api/dashboard` endpoint until its schema version and `generatedAt` match the validated artifact and `usingFallback` is `false`. The bounded check allows the five-minute function cache to expire; failure makes the workflow red and is included in the run summary.
- No Vercel secrets are required for the public dashboard source. `DASHBOARD_DATA_URL` is optional; unset, the API uses the version-controlled public artifact URL.
- News is separate: publisher feeds are fetched by `/api/news` at request time and are not part of the official statistical payload.

## Vercel project and observed state

- Project: `nana-ctrl617/macrolens-malaysia`, connected to `Nana-ctrl617/Macrolens-Malaysia` with production branch `main` and repository-root project directory.
- Production URL: [https://macrolens-malaysia.vercel.app](https://macrolens-malaysia.vercel.app).
- `vercel.json` selects Next.js, frozen pnpm installation, and `pnpm run build:vercel`.
- The public site does not require Cloudflare bindings, D1, R2, or secrets to retrieve the dashboard artifact.
- `.vercelignore` excludes local environment files, the Python virtual environment, and source-vintage archives from deployment uploads.
- On 16 October 2026, the public API returned schema 9, `usingFallback: false`, and a `generatedAt` matching the public GitHub artifact. The live Data Health page returned HTTP 200 and exposed the source filters. Its one partial source group is `mgsDailyHistory`, whose saved history is not verified as a complete daily trading-day series; this is distinct from a claim that the latest yield observation is unavailable.
- The previous ChatGPT-hosted copy has not been removed. Keep it during cutover until a scheduled refresh is verified end-to-end and the old host can be managed safely.

## Cutover verification

Before retiring the ChatGPT-hosted site, verify:

- `/` and the compact responsive navigation load successfully on desktop and mobile.
- `/api/dashboard` returns schema version 9 or later, `usingFallback: false`, and a `generatedAt` matching the latest validated public GitHub artifact.
- `/api/indicator?id=headline`, `/api/forecast-evaluation?format=json`, `/api/regional-lens?format=json`, and `/api/structural-breaks?format=json` return usable data from the same consolidated artifact.
- `/api/news` returns a valid feed-status response; partial feed availability is acceptable only when visibly labelled.
- Browser checks pass for routes, chart point inspection, keyboard interactions, filters, source links, downloads, and responsive layouts.
- A later scheduled GitHub refresh completes. For changed data, Vercel skips the data-only rebuild and the workflow's public-artifact verification confirms the API has picked up the exact artifact after its cache window. For unchanged data, the API still matches the unchanged validated artifact and the run reports that no repository change was needed.
- If public verification fails, treat the migration check as failed, retain the last valid snapshot and previous host, and inspect the workflow summary before retrying.

Only after these checks pass should the separately hosted ChatGPT site be removed. Its lifecycle is independent of Vercel; publishing to Vercel does not delete or redirect that site.
