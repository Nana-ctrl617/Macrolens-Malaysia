import { NextResponse } from "next/server";

type Point = { date: string; value: number };

const MGS_10Y: Point[] = ([
  ["2021-11-01",3.73],["2021-12-01",3.59],["2022-01-01",3.62],
  ["2022-02-01",3.70],["2022-03-01",3.72],["2022-04-01",4.01],
  ["2022-05-01",4.41],["2022-06-01",4.25],["2022-07-01",4.26],
  ["2022-08-01",3.98],["2022-09-01",4.05],["2022-10-01",4.42],
  ["2022-11-01",4.43],["2022-12-01",4.16],["2023-01-01",4.13],
  ["2023-02-01",3.95],["2023-03-01",3.98],["2023-04-01",3.96],
  ["2023-05-01",3.81],["2023-06-01",3.80],["2023-07-01",3.88],
  ["2023-08-01",3.85],["2023-09-01",3.86],["2023-10-01",4.00],
  ["2023-11-01",4.09],["2023-12-01",3.86],["2024-01-01",3.77],
  ["2024-02-01",3.82],["2024-03-01",3.84],["2024-04-01",3.85],
  ["2024-05-01",3.98],["2024-06-01",3.90],["2024-07-01",3.89],
  ["2024-08-01",3.72],["2024-09-01",3.78],["2024-10-01",3.75],
  ["2024-11-01",3.94],["2024-12-01",3.81],["2025-01-01",3.83],
  ["2025-02-01",3.82],["2025-03-01",3.81],["2025-04-01",3.78],
  ["2025-05-01",3.62],["2025-06-01",3.52],["2025-07-01",3.50],
  ["2025-08-01",3.43],["2025-09-01",3.41],["2025-10-01",3.49],
  ["2025-11-01",3.52],["2025-12-01",3.53],["2026-01-01",3.52],
  ["2026-02-01",3.53],["2026-03-01",3.50],["2026-04-01",3.61],
  ["2026-05-01",3.59],["2026-06-01",3.60],["2026-07-01",3.63],
] as [string, number][]).map(([date, value]) => ({ date, value }));

function parseCsv(text: string) {
  const [headerLine, ...lines] = text.trim().split(/\r?\n/);
  const headers = headerLine.split(",");
  return lines.map((line) => {
    const values = line.split(",");
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

async function fetchCsv(url: string) {
  const response = await fetch(url, {
    headers: { "User-Agent": "MacroLens-Malaysia/1.1" },
  });
  if (!response.ok) throw new Error(`Source returned ${response.status}`);
  return parseCsv(await response.text());
}

function clean(points: Point[]) {
  return points
    .filter((point) => point.date && Number.isFinite(point.value))
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function getCpi(core = false): Promise<Point[]> {
  const file = core ? "cpi_2d_core_inflation.csv" : "cpi_2d_inflation.csv";
  const rows = await fetchCsv(`https://storage.dosm.gov.my/cpi/${file}`);
  return clean(rows
    .filter((row) => row.division === "overall" && row.inflation_yoy !== "")
    .map((row) => ({ date: row.date, value: Number(row.inflation_yoy) })));
}

async function getUnemployment(): Promise<Point[]> {
  const rows = await fetchCsv("https://storage.dosm.gov.my/labour/lfs_month.csv");
  return clean(rows.map((row) => ({ date: row.date, value: Number(row.u_rate) })));
}

async function getExchangeRate(): Promise<Point[]> {
  const response = await fetch(
    "https://api.data.gov.my/data-catalogue?id=exchangerates&limit=10000",
    { headers: { "User-Agent": "MacroLens-Malaysia/1.1" } },
  );
  if (!response.ok) throw new Error(`Source returned ${response.status}`);
  const payload = await response.json();
  const rows = Array.isArray(payload) ? payload : payload.data ?? payload.value ?? [];
  return clean(rows
    .filter((row: Record<string, unknown>) => row.indicator === "avg")
    .map((row: Record<string, unknown>) => ({
      date: String(row.date),
      value: Number(row.usd),
    })));
}

async function getOpr(): Promise<Point[]> {
  const years = Array.from(
    { length: new Date().getFullYear() - 2009 },
    (_, index) => 2010 + index,
  );
  const results = await Promise.all(years.map(async (year) => {
    const response = await fetch(`https://api.bnm.gov.my/public/opr/year/${year}`, {
      headers: { Accept: "application/vnd.BNM.API.v1+json" },
    });
    if (!response.ok) return [];
    const payload = await response.json();
    const rows = Array.isArray(payload.data) ? payload.data : [payload.data].filter(Boolean);
    return rows.map((row: Record<string, unknown>) => ({
      date: String(row.date),
      value: Number(row.new_opr_level),
    }));
  }));
  return clean(results.flat());
}

const definitions = {
  headline: {
    title: "Headline inflation",
    unit: "%",
    decimals: 1,
    source: "Department of Statistics Malaysia via data.gov.my",
    sourceUrl: "https://data.gov.my/data-catalogue/cpi_headline_inflation",
    frequency: "Monthly",
    load: () => getCpi(false),
  },
  core: {
    title: "Core inflation",
    unit: "%",
    decimals: 1,
    source: "Department of Statistics Malaysia via data.gov.my",
    sourceUrl: "https://data.gov.my/data-catalogue/cpi_core_inflation",
    frequency: "Monthly",
    load: () => getCpi(true),
  },
  opr: {
    title: "Overnight Policy Rate",
    unit: "%",
    decimals: 2,
    source: "Bank Negara Malaysia OpenAPI",
    sourceUrl: "https://apikijangportal.bnm.gov.my/",
    frequency: "Policy decisions",
    load: getOpr,
  },
  unemployment: {
    title: "Unemployment rate",
    unit: "%",
    decimals: 1,
    source: "Department of Statistics Malaysia via data.gov.my",
    sourceUrl: "https://data.gov.my/data-catalogue/lfs_month",
    frequency: "Monthly",
    load: getUnemployment,
  },
  fx: {
    title: "USD / MYR",
    unit: "RM",
    decimals: 2,
    source: "Bank Negara Malaysia via data.gov.my",
    sourceUrl: "https://data.gov.my/data-catalogue/exchangerates",
    frequency: "Monthly average",
    load: getExchangeRate,
  },
  mgs: {
    title: "10-year MGS yield",
    unit: "%",
    decimals: 2,
    source: "Bank Negara Malaysia Financial Markets",
    sourceUrl: "https://financialmarkets.bnm.gov.my/benchmark-yields",
    frequency: "Monthly benchmark snapshot",
    load: async () => MGS_10Y,
  },
} as const;

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") as keyof typeof definitions | null;
  if (!id || !(id in definitions)) {
    return NextResponse.json({ error: "Unknown indicator" }, { status: 400 });
  }

  try {
    const definition = definitions[id];
    const points = await definition.load();
    return NextResponse.json(
      {
        id,
        title: definition.title,
        unit: definition.unit,
        decimals: definition.decimals,
        source: definition.source,
        sourceUrl: definition.sourceUrl,
        frequency: definition.frequency,
        points,
      },
      {
        headers: {
          "Cache-Control": "public, max-age=3600, s-maxage=21600, stale-while-revalidate=86400",
        },
      },
    );
  } catch {
    return NextResponse.json(
      { error: "The official series is temporarily unavailable. Please try again." },
      { status: 503 },
    );
  }
}
