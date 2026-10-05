type CacheOptions<T> = {
  load: () => Promise<unknown>;
  validate: (value: any) => boolean;
  fallback: T;
  now?: () => number;
  cacheMs?: number;
};

/** Cache only validated artifacts. Failed retrieval never erases last-successful values. */
export function createValidatedArtifactCache<T>({load, validate, fallback, now = Date.now, cacheMs = 300_000}: CacheOptions<T>) {
  let lastValid: T | undefined;
  let served: {payload: T; usingFallback: boolean} | undefined;
  let expiresAt = 0;
  let inFlight: Promise<{payload: T; usingFallback: boolean}> | undefined;
  return {
    load(): Promise<{payload: T; usingFallback: boolean}> {
      if (served && now() < expiresAt) return Promise.resolve(served);
      if (inFlight) return inFlight;
      inFlight = Promise.resolve().then(load).then(value => {
        if (!validate(value)) throw Error('Remote artifact failed validation');
        lastValid = value as T;
        served = {payload: lastValid, usingFallback: false};
        expiresAt = now() + cacheMs;
        return served;
      }).catch(() => {
        served = {payload: lastValid ?? fallback, usingFallback: true};
        expiresAt = now() + Math.min(cacheMs,30_000);
        return served;
      }).finally(() => { inFlight = undefined; });
      return inFlight;
    },
  };
}
