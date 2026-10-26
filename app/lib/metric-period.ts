export type SnapshotMetricId = "headline" | "core" | "opr" | "unemployment" | "fx" | "mgs";

export function metricPeriodLabel(id: SnapshotMetricId, frequency?: string) {
  if (id === "opr") return "Decision date";
  if (id === "mgs" || id === "fx" && /trading|daily/i.test(frequency ?? "")) return "Trading date";
  return "Reference month";
}

export function formatMetricPeriod(id: SnapshotMetricId, period: string, frequency?: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(period)) return "Not recorded";
  const calendarDate = new Date(`${period}T00:00:00Z`);
  if (!Number.isFinite(calendarDate.getTime()) || calendarDate.toISOString().slice(0, 10) !== period) return "Not recorded";
  const date = new Date(`${period}T00:00:00+08:00`);
  const options: Intl.DateTimeFormatOptions = id === "opr" || id === "mgs" || id === "fx" && /trading|daily/i.test(frequency ?? "")
    ? { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kuala_Lumpur" }
    : { month: "short", year: "numeric", timeZone: "Asia/Kuala_Lumpur" };
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("en-MY", options).format(date)
    : "Not recorded";
}
