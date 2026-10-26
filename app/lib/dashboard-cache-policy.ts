/**
 * One policy shared by the browser client, server-side artifact cache and
 * public API headers. Keeping it central prevents one layer from silently
 * delaying an otherwise validated dashboard update.
 */
export const DASHBOARD_REFRESH_CACHE_MS = 60_000;
export const DASHBOARD_FRESH_CACHE_CONTROL = "public, max-age=60, s-maxage=60";
export const DASHBOARD_FALLBACK_CACHE_CONTROL = "public, max-age=30, s-maxage=30";
