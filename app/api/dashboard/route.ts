import { NextResponse } from "next/server";
import { getDashboard } from "@/app/lib/dashboard";

export async function GET() {
  const payload = await getDashboard();
  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "public, max-age=3600, s-maxage=21600, stale-while-revalidate=86400",
      "X-MacroLens-Data": payload.usingFallback ? "fallback" : payload.health,
    },
  });
}

