import { type StructuralIndicator } from "@/app/lib/dashboard";

export type DashboardSection = "snapshot" | "brief" | "news" | "risk" | "forecast" | "drivers" | "structure" | "external" | "bop" | "household" | "regional" | "sectors" | "bursa" | "decisions" | "timeline" | "structural" | "report" | "health" | "methodology";

export type MetricId = "headline" | "core" | "opr" | "unemployment" | "fx" | "mgs";

export type Metric = { id: MetricId; label: string; value: string; detail: string; period: string; tone: string; status?: string };

export type RangeKey = "1Y" | "3Y" | "5Y" | "10Y" | "ALL" | "CUSTOM";

export type DataPoint = { date: string; value: number };

export type IndicatorData = {
  id: MetricId;
  title: string;
  unit: string;
  decimals: number;
  source: string;
  sourceUrl: string;
  frequency: string;
  points: DataPoint[];
  structuralBreaks?: StructuralIndicator;
};
