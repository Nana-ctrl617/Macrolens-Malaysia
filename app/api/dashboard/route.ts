import { NextResponse } from "next/server";
import { getDashboard } from "@/app/lib/dashboard";
import { DASHBOARD_FALLBACK_CACHE_CONTROL, DASHBOARD_FRESH_CACHE_CONTROL } from "@/app/lib/dashboard-cache-policy";

export async function GET() {
  const payload = await getDashboard();
  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": payload.usingFallback
        ? DASHBOARD_FALLBACK_CACHE_CONTROL
        : DASHBOARD_FRESH_CACHE_CONTROL,
      "X-MacroLens-Data": payload.usingFallback ? "fallback" : payload.health,
    },
  });
}
