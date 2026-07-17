import { NextResponse } from "next/server";
import { getDashboard } from "@/app/lib/dashboard";

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  const payload = await getDashboard();
  const series = id ? payload.series[id] : undefined;
  if (!series) return NextResponse.json({ error: "Unknown indicator" }, { status: 400 });
  const sourceStatus = payload.sources[id];
  return NextResponse.json({
    id,
    title: series.title,
    unit: series.unit,
    decimals: series.decimals,
    source: series.source,
    sourceUrl: series.source_url,
    frequency: series.frequency,
    points: series.points,
    status: payload.usingFallback ? "fallback" : sourceStatus?.status || payload.health,
    generatedAt: payload.generatedAt,
    structuralBreaks: payload.structuralBreaks?.indicators[id],
  }, {
    headers: { "Cache-Control": "public, max-age=3600, s-maxage=21600, stale-while-revalidate=86400" },
  });
}
