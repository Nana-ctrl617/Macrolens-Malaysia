import fallback from "@/data/published/dashboard.json";

export type DataPoint = { date: string; value: number };
export type SeriesData = {
  key: string;
  title: string;
  unit: string;
  decimals: number;
  frequency: string;
  source: string;
  source_url: string;
  points: DataPoint[];
};
export type DashboardPayload = {
  schemaVersion: number;
  generatedAt: string;
  health: "fresh" | "partial" | "fallback";
  usingFallback?: boolean;
  sources: Record<string, { status: "fresh" | "stale"; retrievedAt: string; observationPeriod: string; message: string }>;
  series: Record<string, SeriesData>;
  categories: Array<{ code: string; name: string; value: number }>;
  forecast: {
    selectedModel: string;
    methodLabel: string;
    backtestWindows: number;
    status: string;
    models: Array<{ name: string; rmse: number; mae: number; selected: boolean }>;
    points: Array<{ date: string; value: number; low80: number; high80: number; low95: number; high95: number }>;
  };
  narratives: { snapshot: string; forecast: string; financial: string };
};

const DEFAULT_URL = "https://raw.githubusercontent.com/Nana-ctrl617/macrolens-malaysia/main/data/published/dashboard.json";

export function isDashboard(value: unknown): value is DashboardPayload {
  if (!value || typeof value !== "object") return false;
  const candidate = value as DashboardPayload;
  const required = ["headline", "core", "opr", "unemployment", "fx", "mgs"];
  return candidate.schemaVersion === 1
    && typeof candidate.generatedAt === "string"
    && required.every((key) => Array.isArray(candidate.series?.[key]?.points) && candidate.series[key].points.length > 0)
    && Array.isArray(candidate.forecast?.points)
    && candidate.forecast.points.length === 3;
}

export async function getDashboard(): Promise<DashboardPayload> {
  const local = fallback as DashboardPayload;
  const url = process.env.DASHBOARD_DATA_URL || DEFAULT_URL;
  try {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Remote dashboard returned ${response.status}`);
    const remote: unknown = await response.json();
    if (!isDashboard(remote)) throw new Error("Remote dashboard schema is invalid");
    return { ...remote, usingFallback: false };
  } catch {
    return { ...local, health: "fallback", usingFallback: true };
  }
}

