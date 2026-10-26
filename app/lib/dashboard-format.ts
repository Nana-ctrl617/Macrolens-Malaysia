import { type IndicatorData } from "@/app/lib/dashboard-ui-types";

export function formatDate(date: string) {
  const includeDay = !date.endsWith("-01");
  return new Intl.DateTimeFormat("en-MY", includeDay ? { day: "numeric", month: "short", year: "numeric" } : { month: "short", year: "numeric" })
    .format(new Date(`${date}T00:00:00`));
}

export function formatRiskPeriod(indicatorId: string, period: string) {
  if (!period || !/^\d{4}-\d{2}-\d{2}$/.test(period) || !Number.isFinite(Date.parse(`${period}T00:00:00`))) return "Not recorded";
  if (indicatorId === "growth" && period.endsWith("-12-31")) return `Year ${period.slice(0, 4)} (annual)`;
  const monthly = ["headline", "core", "unemployment", "fx", "trade"].includes(indicatorId);
  const options: Intl.DateTimeFormatOptions = monthly
    ? { month: "short", year: "numeric" }
    : { day: "numeric", month: "short", year: "numeric" };
  return new Intl.DateTimeFormat("en-MY", options).format(new Date(`${period}T00:00:00`));
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
  return formatMalaysiaTimestamp(value);
}

/** A timestamp is only unambiguous when the dashboard shows its time zone. */
export function formatMalaysiaTimestamp(value?: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Not recorded";
  return `${new Intl.DateTimeFormat("en-MY", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur" }).format(new Date(value))} MYT`;
}
