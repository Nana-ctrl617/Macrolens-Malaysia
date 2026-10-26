import type { DashboardPayload } from "./dashboard";

export type DashboardStatus = {
  status: "ok" | "degraded";
  health: DashboardPayload["health"];
  usingFallback: boolean;
  schemaVersion: number;
  generatedAt: string;
  sources: { total: number; fresh: number; stale: number };
};

/**
 * A small, non-economic health summary for monitoring. It deliberately reports
 * the artifact status rather than inferring freshness from the server clock.
 */
export function dashboardStatus(payload: DashboardPayload): DashboardStatus {
  const sourceRows = Object.values(payload.sources);
  const fresh = sourceRows.filter((source) => source.status === "fresh").length;
  const stale = sourceRows.length - fresh;
  const usingFallback = Boolean(payload.usingFallback);
  return {
    status: !usingFallback && payload.health === "fresh" ? "ok" : "degraded",
    health: payload.health,
    usingFallback,
    schemaVersion: payload.schemaVersion,
    generatedAt: payload.generatedAt,
    sources: { total: sourceRows.length, fresh, stale },
  };
}
