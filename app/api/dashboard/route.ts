import { NextResponse } from "next/server";
import { getDashboard } from "@/app/lib/dashboard";

export async function GET() {
  const payload = await getDashboard();
  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": payload.usingFallback
        ? "public, max-age=30, s-maxage=30, stale-while-revalidate=30"
        : "public, max-age=300, s-maxage=900, stale-while-revalidate=3600",
      "X-MacroLens-Data": payload.usingFallback ? "fallback" : payload.health,
    },
  });
}
