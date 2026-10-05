import { getDashboard } from "@/app/lib/dashboard";
import { regionalCsv } from "@/app/lib/regional-data";

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
  const csv = regionalCsv(regional);
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=regional-lens.csv" } });
}
