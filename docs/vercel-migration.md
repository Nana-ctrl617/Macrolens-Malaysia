# MacroLens Malaysia: Vercel deployment and cutover

## Current deployment contract

- Framework: Next.js App Router, built by `pnpm run build:vercel`.
- Data: the dashboard API fetches the public, versioned dashboard artifact from GitHub; the request bypasses framework fetch caching, then uses a short validated-artifact cache. Invalid or unavailable remote data is labelled as fallback and never replaces a valid payload.
- Daily refresh: GitHub Actions runs at 05:45 UTC (13:45 Malaysia time) and commits validated `data/published` changes to `main`. A Vercel project connected to this repository's production branch should deploy each such commit. Do not configure ignored build paths that skip `data/published/**` changes.
- No Vercel secrets are required for the public dashboard source. `DASHBOARD_DATA_URL` is optional; leave unset to use the version-controlled public artifact URL.
- News feeds are fetched by the server route at request time. They are separate from the official statistics payload and may report partial source availability.

## Vercel project setup and current state

- Created Vercel project: `nana-ctrl617/macrolens-malaysia`.
- Connected GitHub repository: `Nana-ctrl617/Macrolens-Malaysia`; production branch is `main` and project root is the repository root.
- `vercel.json` selects Next.js, frozen pnpm installation, and the native `next build` command `pnpm run build:vercel`.
- Production is publicly reachable at `https://macrolens-malaysia.vercel.app`. The initial Windows CLI packaging hit a symlink permission error; Vercel's remote Linux builder completed the production deployment successfully.
- The project does not need Cloudflare bindings; the public dashboard routes do not use D1 or R2.
- `.vercelignore` excludes local environment files, the Python virtual environment, and source-vintage archives from deployment uploads.
- The forecast-interval integrity issue is fixed: raw and recalibrated coverage now use the same held-out observations, and the strict validator accepts the published artifact.
- A data-only commit (`29abba3`) automatically produced a new Vercel production deployment. `/api/dashboard` now returns schema 9, `generatedAt: 2026-10-15T09:45:18Z`, and `usingFallback: false`.
- Current overall health is `partial`, not fully fresh: the latest MGS retrieval failed with a `RuntimeError`, so the last valid MGS observation (2026-10-14, 3.83%) was retained and explicitly marked stale. Other dashboard inputs are fresh. This preserves data integrity and should remain visible to users.
- The daily GitHub workflow is scheduled for 05:45 UTC (13:45 Malaysia time); future validated commits to `main` automatically deploy through the Vercel Git connection. Keep the ChatGPT-hosted site until a scheduled workflow run and its resulting Vercel/API refresh have also been observed; do not describe the migration as fully cut over before that check.

## Release checks before retiring the ChatGPT-hosted site

On the Vercel production domain verify:

- `/` and the compact responsive navigation load successfully.
- `/api/dashboard` returns schema version 9 or later, `usingFallback: false`, and a `generatedAt` matching the latest validated GitHub artifact. If one official source fails, it must be visibly stale and preserve its last valid observation.
- `/api/indicator?id=headline`, `/api/forecast-evaluation?format=json`, `/api/regional-lens?format=json`, and `/api/structural-breaks?format=json` return usable data from the same consolidated artifact.
- `/api/news` returns a valid feed-status response (partial feed availability is acceptable and must be visible).
- Browser checks pass for desktop and mobile, including page navigation, charts/hover and keyboard inspection, filters, source links, and downloads.
- After a later data-only GitHub commit, Vercel completes a new production deployment and `/api/dashboard` reports the new artifact timestamp without manual website edits.

Only after all checks pass should the existing ChatGPT-hosted site be removed. Keep it available during the migration so visitors have a working dashboard if Vercel deployment, domain configuration, or data checks fail.

## Current known gate

The earlier 15 October artifact failed because some held-out 95% recalibration rows counted original intervals while having no recalibrated intervals. The paired-sample correction is now on `main`, and the newer artifact passed validation. The next scheduled GitHub workflow run remains the final automation check before removing the old public host.
