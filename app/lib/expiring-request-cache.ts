export type CachedResult<T> = { value: T; cached: boolean };

/**
 * Keeps a short-lived successful result in a warm server instance. Failed
 * loads are deliberately not cached, and concurrent callers share one load.
 */
export function createExpiringRequestCache<T>({ ttlMs, now = () => Date.now() }: { ttlMs: number; now?: () => number }) {
  if (!Number.isFinite(ttlMs) || ttlMs < 0) throw new RangeError("Cache TTL must be a non-negative finite number.");
  let saved: { value: T; expiresAt: number } | null = null;
  let inFlight: Promise<T> | null = null;

  return {
    async read(load: () => Promise<T>): Promise<CachedResult<T>> {
      if (saved && saved.expiresAt > now()) return { value: saved.value, cached: true };
      if (!inFlight) {
        inFlight = load().then((value) => {
          saved = { value, expiresAt: now() + ttlMs };
          return value;
        }).finally(() => { inFlight = null; });
      }
      return { value: await inFlight, cached: false };
    },
    clear() { saved = null; },
  };
}
