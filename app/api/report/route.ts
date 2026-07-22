import { NextResponse } from "next/server";
import { getDashboard } from "@/app/lib/dashboard";

export async function GET() {
  const dashboard = await getDashboard();
  return NextResponse.json(dashboard.monthlyReport ?? { generatedAt: dashboard.generatedAt, sections: [], disclaimer: "Report unavailable for this payload." });
}
