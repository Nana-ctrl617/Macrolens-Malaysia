import { type IndicatorData } from "@/app/lib/dashboard-ui-types";

export function formatDate(date: string) {
  const includeDay = !date.endsWith("-01");
  return new Intl.DateTimeFormat("en-MY", includeDay ? { day: "numeric", month: "short", year: "numeric" } : { month: "short", year: "numeric" })
    .format(new Date(`${date}T00:00:00`));
}

export function formatValue(value: number, data: IndicatorData) {
  return data.unit === "RM"
    ? `RM ${value.toFixed(data.decimals)}`
    : `${value.toFixed(data.decimals)}${data.unit}`;
}

export function formatP(value: number | null) {
  if (value == null) return "—";
  if (value < 0.0001) return "<0.0001";
  return value.toFixed(4);
}

export function signedPercent(value: number | null) {
  if (value == null) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export function levelLabel(level?: string) {
  return !level || level === "unavailable" ? "Unavailable" : level.charAt(0).toUpperCase() + level.slice(1);
}

export function healthStatusLabel(status?: string) {
  const labels: Record<string, string> = {
    fresh: "Fresh inputs",
    partial: "Some inputs not fresh",
    fallback: "Fallback snapshot",
    stale: "Saved / stale input",
    unavailable: "Input unavailable",
  };
  return labels[status ?? ""] ?? "Input status unavailable";
}

export function retrievalTime(value?: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Not recorded";
  return new Intl.DateTimeFormat("en-MY", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur" }).format(new Date(value));
}
