import { getDashboard } from "@/app/lib/dashboard";

function escapeCsv(value: unknown) {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export async function GET(request: Request) {
  const payload = await getDashboard();
  const regional = payload.regionalLens;
  if (!regional) return Response.json({ error: "Regional Lens is not available in this data version." }, { status: 404 });
  const format = new URL(request.url).searchParams.get("format") || "json";
  if (format === "json") {
    return new Response(JSON.stringify(regional, null, 2), {
      headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": "attachment; filename=regional-lens.json" },
    });
  }
  if (format !== "csv") return Response.json({ error: "Use format=csv or format=json" }, { status: 400 });
  const headings = ["level", "state", "district", "date", "income_mean", "income_median", "expenditure_mean", "income_minus_expenditure", "income_to_expenditure_ratio", "poverty", "gini", "headline_inflation", "unemployment_rate", "real_gdp_rm_billion", "largest_sector", "income_group", "income_group_mean", "income_group_vs_national_mean"];
  const rows = [
    ...regional.stateRecords.map((item) => ["state", item.state, "", item.date, item.incomeMean, item.incomeMedian, item.expenditureMean, item.incomeMinusExpenditure, item.incomeToExpenditureRatio, item.poverty, item.gini, item.headlineInflation, item.unemploymentRate, item.realGdp, item.largestSector, "", "", ""]),
    ...regional.districtRecords.map((item) => ["district", item.state, item.district, item.date, item.incomeMean, item.incomeMedian, item.expenditureMean, item.incomeMinusExpenditure, item.incomeToExpenditureRatio, item.poverty, item.gini, "", "", "", "", "", "", ""]),
    ...(regional.incomeGroups?.stateGroups ?? []).flatMap((stateGroup) => stateGroup.groups.map((group) => ["state_income_group", stateGroup.state, "", stateGroup.date, "", "", "", "", "", "", "", "", "", "", "", group.label, group.meanIncome, group.vsNationalMean])),
    ...(regional.incomeGroups?.nationalGroups ?? []).map((group) => ["national_income_group", "Malaysia", "", regional.incomeGroups?.observationPeriod, "", "", "", "", "", "", "", "", "", "", "", group.label, group.meanIncome, 0]),
  ];
  const csv = [headings, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\n") + "\n";
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=regional-lens.csv" } });
}
