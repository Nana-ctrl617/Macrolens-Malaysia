import { NextResponse } from "next/server";
import { getDashboard } from "@/app/lib/dashboard";
import { dashboardStatus } from "@/app/lib/dashboard-status";

/**
 * Lightweight endpoint for deployment checks and external uptime monitors.
 * Detailed source periods remain available in the public Data Health page.
 */
export async function GET() {
  const payload = await getDashboard();
  const status = dashboardStatus(payload);
  return NextResponse.json(status, {
    status: status.status === "ok" ? 200 : 503,
    headers: {
      "Cache-Control": "no-store",
      "X-MacroLens-Data": status.usingFallback ? "fallback" : status.health,
    },
  });
}
