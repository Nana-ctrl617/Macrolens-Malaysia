import type { DashboardPayload } from "./dashboard";

export const DASHBOARD_CLIENT_CACHE_MS = 5 * 60 * 1000;
export const DASHBOARD_CLIENT_TIMEOUT_MS = 12 * 1000;
const DASHBOARD_URL = "/api/dashboard-v7";

type DashboardClientOptions = {
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  cacheMs?: number;
  timeoutMs?: number;
};

const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));

// The API owns complete schema validation and source-health normalization. This
// small boundary check avoids importing the server's large published fallback.
function hasDashboardShape(value: unknown): value is DashboardPayload {
  if (!record(value) || !record(value.series) || !record(value.sources) || !record(value.forecast) || !record(value.narratives)) return false;
  const required = ["headline", "core", "opr", "unemployment", "fx", "mgs"];
  return Number.isInteger(value.schemaVersion) && Number(value.schemaVersion) >= 1 && Number(value.schemaVersion) <= 9
    && typeof value.generatedAt === "string" && value.generatedAt.length > 0
    && typeof value.health === "string" && ["fresh", "partial", "fallback"].includes(value.health)
    && (value.usingFallback === undefined || typeof value.usingFallback === "boolean")
    && required.every((key) => record(value.series) && record(value.series[key]) && Array.isArray(value.series[key].points))
    && Array.isArray(value.categories)
    && typeof value.forecast.selectedModel === "string"
    && Array.isArray(value.forecast.models) && Array.isArray(value.forecast.points)
    && ["snapshot", "forecast", "financial"].every((key) => record(value.narratives) && typeof value.narratives[key] === "string");
}

function requestError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

export function createDashboardClient(options: DashboardClientOptions = {}) {
  const fetchDashboard = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const now = options.now ?? Date.now;
  const cacheMs = options.cacheMs ?? DASHBOARD_CLIENT_CACHE_MS;
  const timeoutMs = options.timeoutMs ?? DASHBOARD_CLIENT_TIMEOUT_MS;
  let cached: { data: DashboardPayload; expiresAt: number } | undefined;
  let pending: { controller: AbortController; promise: Promise<DashboardPayload> } | undefined;
  let generation = 0;
  let revalidateNextRequest = false;

  function invalidate(): void {
    generation++;
    cached = undefined;
    const previous = pending;
    pending = undefined;
    previous?.controller.abort();
  }

  function load(): Promise<DashboardPayload> {
    if (cached && now() < cached.expiresAt) return Promise.resolve(cached.data);
    if (pending) return pending.promise;

    const controller = new AbortController();
    const requestGeneration = generation;
    const revalidate = revalidateNextRequest;
    revalidateNextRequest = false;
    let timedOut = false;
    let rejectAbort: (error: Error) => void = () => {};
    const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
    const onAbort = () => rejectAbort(timedOut
      ? requestError("TimeoutError", "Dashboard request timed out. Please retry.")
      : requestError("AbortError", "Dashboard request was cancelled."));
    controller.signal.addEventListener("abort", onAbort, { once: true });
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    const download = async () => {
      const response = await fetchDashboard(DASHBOARD_URL, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
        ...(revalidate ? { cache: "no-cache" as const } : {}),
      });
      if (!response.ok) throw new Error(`Dashboard could not be loaded (HTTP ${response.status}). Please retry.`);
      const data: unknown = await response.json();
      if (!hasDashboardShape(data)) throw new Error("Dashboard response is invalid. Please retry.");
      return data;
    };

    const promise = Promise.race([download(), aborted])
      .then((data) => {
        if (requestGeneration === generation) cached = { data, expiresAt: now() + cacheMs };
        return data;
      })
      .finally(() => {
        clearTimeout(timeout);
        controller.signal.removeEventListener("abort", onAbort);
        if (pending?.promise === promise) pending = undefined;
      });
    pending = { controller, promise };
    return promise;
  }

  function retry(): Promise<DashboardPayload> {
    invalidate();
    revalidateNextRequest = true;
    return load();
  }

  return { load, invalidate, retry };
}

const dashboardClient = createDashboardClient();
export const loadDashboard = dashboardClient.load;
export const invalidateDashboardCache = dashboardClient.invalidate;
export const retryDashboard = dashboardClient.retry;
