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
- First deployment is publicly reachable at `https://macrolens-malaysia.vercel.app`. Direct CLI production builds on this Windows host hit a symlink permission error, so the first deployment was built by Vercel's remote Linux builder instead.
- The project does not need Cloudflare bindings; the public dashboard routes do not use D1 or R2.
- `.vercelignore` excludes local environment files, the Python virtual environment, and source-vintage archives from deployment uploads.
- The site and API respond publicly, but `/api/dashboard` currently reports `usingFallback: true`. The strict local validator confirms the current GitHub `main` artifact is malformed in the comparison of original and recalibrated 95% forecast intervals. This is an honest fallback, not a verified healthy live-data state.
- The paired-sample recalibration fix, validator, and tests are local changes and must be published to `main`. Then run the GitHub `Update MacroLens dashboard` workflow and verify the new artifact passes `scripts/validate-published.mjs` and Vercel returns `usingFallback: false` before considering the migration complete.

## Release checks before retiring the ChatGPT-hosted site

On the Vercel production domain verify:

- `/` and the compact responsive navigation load successfully.
- `/api/dashboard` returns schema version 9 or later, `usingFallback: false`, and a `generatedAt` matching the latest validated GitHub artifact.
- `/api/indicator?id=headline`, `/api/forecast-evaluation?format=json`, `/api/regional-lens?format=json`, and `/api/structural-breaks?format=json` return usable data from the same consolidated artifact.
- `/api/news` returns a valid feed-status response (partial feed availability is acceptable and must be visible).
- Browser checks pass for desktop and mobile, including page navigation, charts/hover and keyboard inspection, filters, source links, and downloads.
- After a later data-only GitHub commit, Vercel completes a new production deployment and `/api/dashboard` reports the new artifact timestamp without manual website edits.

Only after all checks pass should the existing ChatGPT-hosted site be removed. Keep it available during the migration so visitors have a working dashboard if Vercel deployment, domain configuration, or data checks fail.

## Current known gate

The GitHub artifact generated on 15 October 2026 was rejected by the stricter forecast-integrity validator: some held-out 95% recalibration rows counted original intervals while having no recalibrated intervals. The corrected paired-sample handling and validator are currently local changes. Do not treat the earlier green workflow run as a validated Vercel release; first publish these code changes to `main`, then rerun the data workflow and verify its artifact.
