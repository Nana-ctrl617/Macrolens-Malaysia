import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { normalizeRegionalGeography } from "../app/lib/regional-geography.ts";

const payload = () => JSON.parse(readFileSync(new URL("../data/published/dashboard.json", import.meta.url), "utf8"));
const require = createRequire(import.meta.url);
const modules = new Map();
async function sourceModule(filename) {
  if (modules.has(filename)) return modules.get(filename);
  let output = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  output = output.replace(/import\s+["'][^"']+\.css["'];?\s*/g, "");
  for (const match of [...output.matchAll(/from\s+(["'])([^"']+)\1/g)]) {
    const specifier = match[2];
    let resolved;
    if (specifier === "@/app/lib/dashboard") {
      resolved = `data:text/javascript;base64,${Buffer.from("export async function getDashboard() { return globalThis.__regionalRouteFixture; }").toString("base64")}`;
    } else if (specifier.startsWith("@/") || specifier.startsWith(".")) {
      const base = specifier.startsWith("@/") ? fileURLToPath(new URL(`../${specifier.slice(2)}`, import.meta.url)) : fileURLToPath(new URL(specifier, pathToFileURL(filename)));
      const target = [base, `${base}.ts`, `${base}.tsx`].find(existsSync);
      if (!target) throw new Error(`Missing regional dependency: ${specifier}`);
      resolved = await sourceModule(target);
    } else resolved = pathToFileURL(require.resolve(specifier)).href;
    output = output.replaceAll(`${match[1]}${specifier}${match[1]}`, JSON.stringify(resolved));
  }
  const url = `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`;
  modules.set(filename, url);
  return url;
}
async function component() {
  return (await import(await sourceModule(fileURLToPath(new URL("../app/components/RegionalLensView.tsx", import.meta.url))))).default;
}
const {
  buildRegionalRecords, regionalExportRows, regionalCsv, formatRegionalPeriod,
  resolveRegionalComparison, parseRegionalComparison, regionalComparisonQuery,
} = await import(await sourceModule(fileURLToPath(new URL("../app/lib/regional-data.ts", import.meta.url))));

test("district comparison joins only exact state and district keys", () => {
  const regional = payload().regionalLens;
  const records = buildRegionalRecords(regional, "district");
  assert.equal(records.find((record) => record.key === "Sarawak|Kuching").label, "Kuching, Sarawak");
  const example = regional.districtLabourRecords.find((record) => record.unemploymentRate != null);
  const joined = records.find((record) => record.key === `${example.state}|${example.district}`);
  assert.equal(joined.metrics.unemploymentRate.value, example.unemploymentRate);
  assert.equal(joined.metrics.unemploymentRate.observationPeriod, example.date);
  const gdp = regional.districtGdpRecords[0];
  const district = records.find((record) => record.key === `${gdp.state}|${gdp.district}`);
  assert.equal(district.metrics.realGdp.value, gdp.total);
  assert.equal(district.metrics.realGdp.observationPeriod, gdp.date);
  assert.equal(district.metrics.realGdp.sourceUrl, regional.sources.gdp.districtSourceUrl);
});

test("verified district aliases share one state-scoped geography without changing source records", () => {
  const regional = payload().regionalLens;
  const before = structuredClone(regional);
  const records = buildRegionalRecords(regional, "district");
  const aliases = [
    ["Sarawak", "Lubok antu", "Lubok Antu"],
    ["Sarawak", "Tanjong Manis", "Tanjung Manis"],
    ["Pulau Pinang", "S.P. Selatan", "Seberang Perai Selatan"],
    ["Pulau Pinang", "S.P.Tengah", "Seberang Perai Tengah"],
    ["Pulau Pinang", "S.P.Utara", "Seberang Perai Utara"],
    ["Perak", "Larut & Matang", "Larut dan Matang"],
    ["Terengganu", "Hulu", "Hulu Terengganu"],
  ];
  for (const [state, alias, district] of aliases) {
    assert.equal(normalizeRegionalGeography(state, alias).key, `${state}|${district}`);
    const matches = records.filter((record) => record.key === `${state}|${district}`);
    assert.equal(matches.length, 1, `${district} must not split across source names`);
    assert.equal(matches[0].district, district);
    for (const metric of ["incomeMedian", "unemploymentRate", "realGdp"]) assert.equal(typeof matches[0].metrics[metric].value, "number", `${district} ${metric} must use the joined official record`);
    for (const [sourceRecords, metric, rawField, sourceUrl] of [
      [regional.districtRecords, "incomeMedian", "incomeMedian", regional.sources.hiesDistrict.sourceUrl],
      [regional.districtLabourRecords, "unemploymentRate", "unemploymentRate", regional.sources.labour.sourceUrl],
      [regional.districtGdpRecords, "realGdp", "total", regional.sources.gdp.districtSourceUrl],
    ]) {
      const original = sourceRecords.find((record) => normalizeRegionalGeography(record.state, record.district).key === matches[0].key);
      assert.equal(matches[0].metrics[metric].value, original[rawField]);
      assert.equal(matches[0].metrics[metric].observationPeriod, original.date);
      assert.equal(matches[0].metrics[metric].sourceUrl, sourceUrl);
    }
    assert.ok(!records.some((record) => record.district === alias && alias !== district));
  }
  assert.deepEqual(regional, before, "Canonical presentation must not rewrite official source records");
  const bookmarked = resolveRegionalComparison(regional, { level: "district", primary: "Perak|Larut & Matang", secondary: "Terengganu|Hulu" });
  assert.equal(bookmarked.primary, "Perak|Larut dan Matang");
  assert.equal(bookmarked.secondary, "Terengganu|Hulu Terengganu");
});

test("geography normalization is conservative: no cross-state, fuzzy or boundary merges", () => {
  assert.equal(normalizeRegionalGeography("Perak", "Hulu").district, "Hulu");
  assert.notEqual(normalizeRegionalGeography("Perak", "Hulu").key, normalizeRegionalGeography("Terengganu", "Hulu").key);
  assert.notEqual(normalizeRegionalGeography("Perak", "Larut, Matang dan Selama").key, normalizeRegionalGeography("Perak", "Larut & Matang").key);
  assert.notEqual(normalizeRegionalGeography("Perak", "Selama").key, normalizeRegionalGeography("Perak", "Larut & Matang").key);
  assert.equal(normalizeRegionalGeography("Johor", "S.P.Tengah").district, "S.P.Tengah");
  assert.equal(normalizeRegionalGeography("Sarawak", "Tanjong Manis Barat").district, "Tanjong Manis Barat");
  assert.notEqual(normalizeRegionalGeography("Selangor", "Hulu Langat").key, normalizeRegionalGeography("Selangor", "Ulu Langat").key);
  assert.equal(normalizeRegionalGeography("Sarawak", "  Lubok   antu  ").district, "Lubok Antu");
});

test("official Supra GDP residuals stay out of district comparisons and retain separate export classification", () => {
  const regional = payload().regionalLens;
  const records = buildRegionalRecords(regional, "district");
  assert.ok(!records.some((record) => record.district === "Supra"));
  assert.equal(normalizeRegionalGeography("Sarawak", "Supra").kind, "residual");
  assert.equal(normalizeRegionalGeography("Sabah", "Supra").kind, "residual");
  assert.equal(normalizeRegionalGeography("Johor", "Supra").kind, "district", "Only officially documented residual combinations are classified");
  const rows = regionalExportRows(regional);
  for (const state of ["Sabah", "Sarawak"]) {
    const raw = regional.districtGdpRecords.find((record) => record.state === state && record.district === "Supra");
    const exported = rows.find((row) => row.level === "district_residual" && row.state === state && row.district === "Supra" && row.metric === "realGdp");
    assert.equal(exported.value, raw.total);
    assert.equal(exported.observation_period, raw.date);
  }
  assert.ok(!rows.some((row) => row.level === "district" && row.district === "Supra"));
});

test("conflicting duplicate aliases in one dataset cannot arbitrarily overwrite official values", () => {
  const regional = payload().regionalLens;
  const raw = regional.districtRecords.find((record) => record.state === "Sarawak" && record.district === "Tanjung Manis");
  regional.districtRecords.push({ ...raw, district: "Tanjong Manis", incomeMedian: raw.incomeMedian + 1 });
  const district = buildRegionalRecords(regional, "district").find((record) => record.key === "Sarawak|Tanjung Manis");
  assert.equal(district.metrics.incomeMedian.value, null);
  assert.equal(typeof district.metrics.unemploymentRate.value, "number", "Other unambiguous datasets still join");
});

test("null or suppressed district sector values stay missing while genuine zero remains exported", () => {
  const regional = payload().regionalLens;
  const gdp = regional.districtGdpRecords[0];
  gdp.sectors = [{ id: "missing", name: "Suppressed sector", value: null, share: null }, { id: "zero", name: "Genuine zero", value: 0, share: 0 }];
  const district = buildRegionalRecords(regional, "district").find((record) => record.key === normalizeRegionalGeography(gdp.state, gdp.district).key);
  assert.equal(district.metrics["sector.missing.value"].value, null);
  assert.equal(district.metrics["sector.missing.share"].value, null);
  assert.equal(district.metrics["sector.zero.value"].value, 0);
  assert.equal(district.metrics.realGdp.value, gdp.total);
  const exported = regionalExportRows(regional).filter((row) => row.level === "district" && row.state === district.state && row.district === district.district);
  assert.ok(!exported.some((row) => row.metric.startsWith("sector.missing.")));
  assert.equal(exported.find((row) => row.metric === "sector.zero.value").value, 0);
  assert.equal(exported.find((row) => row.metric === "sector.zero.share").value, 0);
});

test("missing district metrics stay unavailable and never borrow state observations", () => {
  const regional = payload().regionalLens;
  regional.districtLabourRecords = [];
  regional.districtGdpRecords = [];
  const district = buildRegionalRecords(regional, "district")[0];
  for (const metric of ["headlineInflation", "unemploymentRate", "realGdp"]) assert.equal(district.metrics[metric].value, null);
  assert.equal(district.metrics.headlineInflation.dataStatus, "unavailable");
  const sameNamed = structuredClone(regional.districtRecords[0]);
  sameNamed.state = "Other state";
  regional.districtRecords.push(sameNamed);
  regional.districtLabourRecords = [{ ...regional.districtRecords[0], unemploymentRate: 7 }];
  assert.equal(buildRegionalRecords(regional, "district").find((record) => record.state === "Other state").metrics.unemploymentRate.value, null);
});

test("labour-only districts remain selectable without inventing household observations", () => {
  const regional = payload().regionalLens;
  regional.districtLabourRecords.push({ state: "Sarawak", district: "Labour-only district", date: "2024-01-01", labourForce: 2, unemploymentRate: 0 });
  const district = buildRegionalRecords(regional, "district").find((record) => record.key === "Sarawak|Labour-only district");
  assert.equal(district.metrics.unemploymentRate.value, 0);
  assert.equal(district.metrics.incomeMedian.value, null);
  assert.equal(district.metrics.realGdp.value, null);
  assert.ok(regionalExportRows(regional).some((row) => row.district === "Labour-only district" && row.metric === "unemploymentRate" && row.value === 0));
});

test("nonfinite and numeric-string observations cannot become official export values", () => {
  const regional = payload().regionalLens;
  regional.stateRecords[0].incomeMedian = Infinity;
  regional.stateRecords[0].incomeMean = "3";
  const record = buildRegionalRecords(regional, "state").find((item) => item.state === regional.stateRecords[0].state);
  assert.equal(record.metrics.incomeMedian.value, null);
  assert.equal(record.metrics.incomeMean.value, null);
  assert.ok(!regionalExportRows(regional).some((row) => row.level === "state" && row.state === record.state && ["incomeMedian", "incomeMean"].includes(row.metric)));
});

test("long-form exports carry each metric's own observation period and provenance", () => {
  const regional = payload().regionalLens;
  const state = regional.stateRecords[0];
  const rows = regionalExportRows(regional);
  const stateRows = rows.filter((row) => row.level === "state" && row.state === state.state);
  assert.equal(stateRows.find((row) => row.metric === "headlineInflation").observation_period, state.inflationPeriod);
  assert.equal(stateRows.find((row) => row.metric === "realGdp").observation_period, state.gdpPeriod);
  assert.equal(stateRows.find((row) => row.metric === "incomeMedian").observation_period, state.date);
  assert.equal(stateRows.find((row) => row.metric === "headlineInflation").source_url, regional.sources.cpi.sourceUrl);
  assert.equal(rows.filter((row) => row.level === "district" && row.metric === "headlineInflation").length, 0);
  assert.equal(rows.find((row) => row.level === "national_income_group").source_url, regional.incomeGroups.nationalDatasetUrl);
  regional.sources.cpi.status = "stale";
  assert.equal(regionalExportRows(regional).find((row) => row.metric === "headlineInflation").data_status, "stale");
  delete regional.sources.cpi;
  assert.equal(regionalExportRows(regional).find((row) => row.metric === "headlineInflation").data_status, "unknown");
});

test("CSV has long-form headings and safely escapes line breaks, quotes and formula-like labels", () => {
  const regional = payload().regionalLens;
  regional.stateRecords[0].state = '=SUM(1,2)\r\n"quoted"';
  const csv = regionalCsv(regional);
  assert.ok(csv.startsWith("level,state,district,metric,value,unit,observation_period,source_url,data_status,retrieved_at\n"));
  assert.ok(csv.includes('"\'=SUM(1,2)\r\n""quoted"""'));
  assert.ok(csv.endsWith("\n"));
});

test("annual and survey periods show only years; monthly CPI keeps the month", () => {
  assert.equal(formatRegionalPeriod("2024-01-01", "annual"), "2024");
  assert.equal(formatRegionalPeriod("2026-08-01", "monthly"), "Aug 2026");
  assert.equal(formatRegionalPeriod(null, "annual"), "not recorded");
  assert.equal(formatRegionalPeriod("not-a-date", "annual"), "not recorded");
  assert.equal(formatRegionalPeriod("2024-13-01", "annual"), "not recorded");
  assert.equal(formatRegionalPeriod("2023-02-29", "monthly"), "not recorded");
});

test("bookmark comparisons round trip district keys and reject invalid query values", () => {
  const regional = payload().regionalLens;
  const input = { level: "district", primary: "Sarawak|Kuching", secondary: "Johor|Batu Pahat", metric: "unemploymentRate", view: "table" };
  assert.deepEqual(resolveRegionalComparison(regional, parseRegionalComparison(regionalComparisonQuery(input))), input);
  const invalid = resolveRegionalComparison(regional, parseRegionalComparison("?regionalLevel=moon&regionalPrimary=missing&regionalMetric=magic"));
  assert.equal(invalid.level, "state");
  assert.equal(invalid.metric, "incomeMedian");
  assert.ok(regional.stateRecords.some((record) => record.state === invalid.primary));
});

test("district rendered cards, chart and selectors use district geography, not states", async () => {
  const Regional = await component();
  const data = payload();
  const html = renderToStaticMarkup(createElement(Regional, { dashboard: data, initialComparison: { level: "district", primary: "Sarawak|Kuching", secondary: "Johor|Batu Pahat", metric: "incomeMedian", view: "chart" } }));
  assert.match(html, /value="Sarawak\|Kuching"/);
  assert.match(html, /Kuching, Sarawak/);
  assert.match(html, /aria-label="Median household income by district"/);
  assert.doesNotMatch(html, /B40, M40 and T20 income comparison/);
  assert.match(html, /aggregate contrast/);
  assert.match(html, /Data sources for assignment/);
});

test("district table retains unavailable metrics and distinct metric periods", async () => {
  const Regional = await component();
  const data = payload();
  const html = renderToStaticMarkup(createElement(Regional, { dashboard: data, initialComparison: { level: "district", primary: "Sarawak|Kuching", secondary: "Johor|Batu Pahat", metric: "headlineInflation", view: "table" } }));
  assert.match(html, /No official district CPI/);
  assert.match(html, /Unavailable/);
  assert.match(html, /2020/);
  assert.match(html, /2024/);
  assert.doesNotMatch(html, /1 Jan 2020/);
});

test("regional table shows the selected metric once and preserves companion provenance", async () => {
  const Regional = await component();
  const data = payload();
  const selectedLabels = { incomeMedian: "Median household income", expenditureMean: "Mean household expenditure", poverty: "Absolute poverty rate", unemploymentRate: "Unemployment rate", realGdp: "Real GDP", headlineInflation: "Headline inflation" };
  for (const metric of ["incomeMedian", "expenditureMean", "poverty", "unemploymentRate", "realGdp", "headlineInflation"]) {
    const html = renderToStaticMarkup(createElement(Regional, { dashboard: data, initialComparison: { level: "district", primary: "Sarawak|Kuching", secondary: "Johor|Batu Pahat", metric, view: "table" } }));
    const headings = html.slice(html.indexOf("<thead>"), html.indexOf("</thead>"));
    const firstRow = html.slice(html.indexOf("<tbody>") + "<tbody>".length).split("</tr>")[0];
    const selectedRow = [...html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/g)].map((match) => match[0]).find((row) => row.includes('<th scope="row">Kuching, Sarawak</th>'));
    const expectedMetrics = new Set([metric, "incomeMedian", "expenditureMean", "poverty", "unemploymentRate", "realGdp"]);
    assert.equal((headings.match(/scope="col"/g) ?? []).length, expectedMetrics.size + 1, `One geography column and one column per unique metric: ${metric}`);
    assert.equal((firstRow.match(/<td\b/g) ?? []).length, expectedMetrics.size, `Cells must align with unique headings: ${metric}`);
    assert.equal((headings.match(new RegExp(selectedLabels[metric], "g")) ?? []).length, 1, `Selected metric heading occurs once: ${metric}`);
    assert.match(firstRow, /scope="row"/);
    assert.ok(selectedRow, "Selected district remains in the table");
    assert.match(selectedRow, /Official source for/);
    assert.match(selectedRow, /2024/);
    assert.match(selectedRow, /2020/);
    assert.match(selectedRow, /hies_district/);
    assert.match(selectedRow, /lfs_district/);
    assert.match(selectedRow, /gdp_district_real_supply/);
  }
});

test("state rendering preserves state-relative income definitions and loading announcement", async () => {
  const Regional = await component();
  const html = renderToStaticMarkup(createElement(Regional, { dashboard: payload() }));
  assert.match(html, /B40, M40 and T20 income comparison/);
  assert.match(html, /within each state/);
  assert.match(html, /not identical income bands/);
  const loading = renderToStaticMarkup(createElement(Regional, { dashboard: null, loading: true }));
  assert.match(loading, /role="status"/);
  assert.match(loading, /Loading official regional observations/);
});

test("regional API returns the shared CSV, preserves JSON and rejects invalid requests", async () => {
  const route = await import(await sourceModule(fileURLToPath(new URL("../app/api/regional-lens/route.ts", import.meta.url))));
  globalThis.__regionalRouteFixture = payload();
  try {
    const response = await route.GET(new Request("https://example.test/api/regional-lens?format=csv"));
    assert.equal(response.status, 200);
    assert.match(response.headers.get("Content-Type"), /text\/csv/);
    assert.equal(await response.text(), regionalCsv(globalThis.__regionalRouteFixture.regionalLens));
    const json = await route.GET(new Request("https://example.test/api/regional-lens"));
    assert.deepEqual(await json.json(), globalThis.__regionalRouteFixture.regionalLens);
    assert.equal((await route.GET(new Request("https://example.test/api/regional-lens?format=exe"))).status, 400);
    delete globalThis.__regionalRouteFixture.regionalLens;
    assert.equal((await route.GET(new Request("https://example.test/api/regional-lens?format=csv"))).status, 404);
  } finally { delete globalThis.__regionalRouteFixture; }
});

function parseCsv(csv) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (character === '"') {
      if (quoted && csv[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
    } else if (!quoted && character === ",") { row.push(cell); cell = ""; }
    else if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && csv[index + 1] === "\n") index += 1;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += character;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

test("published pipeline CSV and API exporter have identical keyed metrics and provenance", () => {
  const regional = payload().regionalLens;
  const csvRows = parseCsv(readFileSync(new URL("../data/published/regional-lens.csv", import.meta.url), "utf8"));
  const columns = csvRows.shift();
  assert.deepEqual(columns, ["level", "state", "district", "metric", "value", "unit", "observation_period", "source_url", "data_status", "retrieved_at"]);
  const expected = regionalExportRows(regional);
  assert.equal(csvRows.length, expected.length);
  const keyed = new Map(csvRows.map((values) => {
    assert.equal(values.length, columns.length);
    const row = Object.fromEntries(columns.map((column, index) => [column, values[index]]));
    return [JSON.stringify([row.level, row.state, row.district, row.metric]), row];
  }));
  assert.equal(keyed.size, expected.length, "Published metric keys must be unique");
  for (const row of expected) {
    const published = keyed.get(JSON.stringify([row.level, row.state, row.district, row.metric]));
    assert.ok(published, `Missing published metric ${row.state}/${row.district}/${row.metric}`);
    for (const column of columns) assert.equal(column === "value" && typeof row.value === "number" ? Number(published[column]) : published[column], row[column], `${row.state}/${row.district}/${row.metric} ${column}`);
  }
});
