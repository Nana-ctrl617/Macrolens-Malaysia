import { getDashboard } from "@/app/lib/dashboard";

function escapeCsv(value: unknown) {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export async function GET(request: Request) {
  const payload = await getDashboard();
  const structural = payload.structuralBreaks;
  if (!structural) return Response.json({ error: "Structural analysis is not available in this data version." }, { status: 404 });
  const format = new URL(request.url).searchParams.get("format") || "json";
  if (format === "json") {
    return new Response(JSON.stringify(structural, null, 2), {
      headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": "attachment; filename=structural-breaks.json" },
    });
  }
  if (format !== "csv") return Response.json({ error: "Use format=csv or format=json" }, { status: 400 });
  const headings = ["indicator", "break_period", "status", "chow_f", "chow_df_numerator", "chow_df_denominator", "chow_p_raw", "chow_p_holm", "hac_wald", "hac_p", "pre_mean", "post_mean", "absolute_change", "pre_annual_trend", "post_annual_trend", "standardised_mean_change", "nearby_events"];
  const rows: unknown[][] = [];
  for (const [indicator, analysis] of Object.entries(structural.indicators)) {
    for (const candidate of analysis.candidates) {
      const comparison = candidate.regimeComparison;
      rows.push([indicator, candidate.breakPeriod, candidate.statusLabel, candidate.chow.fStatistic, candidate.chow.dfNumerator, candidate.chow.dfDenominator, candidate.chow.pRaw, candidate.chow.pHolm, candidate.hacWald.statistic, candidate.hacWald.pValue, comparison.preMean, comparison.postMean, comparison.absoluteChange, comparison.preAnnualTrend, comparison.postAnnualTrend, comparison.standardisedMeanChange, candidate.nearbyEvents.map((event) => event.title).join(" | ")]);
    }
  }
  const csv = [headings, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\n") + "\n";
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=structural-breaks.csv" } });
}
