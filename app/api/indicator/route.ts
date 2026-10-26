import { NextResponse } from "next/server";
import { getDashboard } from "@/app/lib/dashboard";
import { DASHBOARD_FALLBACK_CACHE_CONTROL, DASHBOARD_FRESH_CACHE_CONTROL } from "@/app/lib/dashboard-cache-policy";

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  const payload = await getDashboard();
  const series = id ? payload.series[id] : undefined;
  if (!id || !series) return NextResponse.json({ error: "Unknown indicator" }, { status: 400 });
  const sourceStatus = payload.sources[id];
  // Keep detailed explorers on the same bounded refresh cadence as the
  // dashboard summary. A longer CDN lifetime could otherwise show a newly
  // refreshed card next to an older indicator history.
  const cacheControl = payload.usingFallback
    ? DASHBOARD_FALLBACK_CACHE_CONTROL
    : DASHBOARD_FRESH_CACHE_CONTROL;
  return NextResponse.json({
    id,
    title: series.title,
    unit: series.unit,
    decimals: series.decimals,
    source: series.source,
    sourceUrl: series.source_url,
    frequency: series.frequency,
    historyCoverage: series.historyCoverage,
    points: series.points,
    status: payload.usingFallback ? "fallback" : sourceStatus?.status || payload.health,
    generatedAt: payload.generatedAt,
    structuralBreaks: payload.structuralBreaks?.indicators[id],
  }, {
    headers: { "Cache-Control": cacheControl },
  });
}
