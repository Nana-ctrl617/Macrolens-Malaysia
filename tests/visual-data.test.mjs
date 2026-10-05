import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  pointEpoch, prepareSeriesPoints, observationWindow, seriesCadence, segmentSeries,
  numericDomain, linearScale, buildTrendPath, nearestPointIndex, trendChange,
  formatMetricValue, formatMetricChange, formatObservationDate, signedBarLayout,
} from "../app/lib/visual-data.ts";

const point = (date, value) => ({ date, value });

test("chart dates accept genuine UTC dates and reject malformed or impossible dates", () => {
  assert.equal(pointEpoch("2024-02-29"), Date.UTC(2024, 1, 29));
  for (const date of ["2023-02-29", "2024-02-30", "2024-13-01", "2024-1-01", "", null, "2024-01-01T00:00:00Z"]) assert.equal(pointEpoch(date), null);
});

test("series preparation sorts valid zero and negative values without mutation", () => {
  const input = [point("2024-03-01", -1), point("2024-01-01", 0), point("2024-02-01", 2)];
  const before = structuredClone(input);
  assert.deepEqual(prepareSeriesPoints(input).points, [input[1], input[2], input[0]]);
  assert.deepEqual(input, before);
});

test("missing, non-finite and string values are excluded, never coerced to zero", () => {
  const prepared = prepareSeriesPoints([
    point("2024-01-01", null), point("2024-02-01", "2"), point("2024-03-01", NaN),
    point("2024-04-01", Infinity), point("2024-02-30", 9), point("2024-06-01", 0),
  ]);
  assert.equal(prepared.rejected, 5);
  assert.deepEqual(prepared.points, [point("2024-06-01", 0)]);
});

test("identical duplicate dates collapse but conflicting dates are not arbitrarily selected", () => {
  const result = prepareSeriesPoints([point("2024-01-01", 1), point("2024-01-01", 1), point("2024-02-01", 2), point("2024-02-01", 3)]);
  assert.deepEqual(result.points, [point("2024-01-01", 1)]);
  assert.equal(result.duplicateRows, 2);
  assert.equal(result.conflictingDates, 1);
});

test("one-year and three-year windows anchor to the latest observation, not the clock", () => {
  const input = [point("2020-04-01", 1), point("2021-03-01", 2), point("2021-04-01", 3), point("2023-03-01", 4), point("2023-04-01", 5), point("2024-04-01", 6)];
  assert.deepEqual(observationWindow(input, "1Y"), input.slice(4));
  assert.deepEqual(observationWindow(input, "3Y"), input.slice(2));
  assert.deepEqual(observationWindow(input, "All"), input);
  assert.notEqual(observationWindow(input, "All")[0], input[0]);
});

test("leap-day windows clamp their anniversary without dropping a valid February observation", () => {
  const input = [point("2023-02-27", 1), point("2023-02-28", 2), point("2024-02-29", 3)];
  assert.deepEqual(observationWindow(input, "1Y"), input.slice(1));
  assert.deepEqual(observationWindow([], "1Y"), []);
});

test("monthly missing observations break paths rather than interpolate", () => {
  const input = [point("2024-01-01", 1), point("2024-02-01", 2), point("2024-04-01", 3)];
  assert.equal(segmentSeries(input, "Monthly end rate").length, 2);
  const path = buildTrendPath(input, "Monthly", (epoch) => epoch / 1e10, (value) => value * 10);
  assert.equal((path.match(/M /g) ?? []).length, 2);
  assert.equal((path.match(/L /g) ?? []).length, 1);
});

test("daily data keeps weekend gaps but breaks an extended missing run", () => {
  const input = [point("2024-01-05", 1), point("2024-01-08", 2), point("2024-01-20", 3)];
  assert.equal(seriesCadence("Trading days"), "daily");
  assert.equal(segmentSeries(input, "Trading days").length, 2);
});

test("policy decision observations use a step rather than a gradual rate change", () => {
  const path = buildTrendPath([point("2024-01-15", 3), point("2024-05-06", 2.75)], "Policy decisions", () => 10, (value) => value);
  assert.ok(path.includes("H 10.00 V 2.75"));
  assert.ok(!path.includes("L "));
});

test("constant, zero, negative and mixed numeric domains stay finite and non-degenerate", () => {
  for (const values of [[0, 0], [-4, -4], [3, 3], [-2, 5], [0.0001, 0.0002]]) {
    const domain = numericDomain(values);
    assert.ok(domain.min < domain.max);
    assert.ok(domain.min <= Math.min(...values));
    assert.ok(domain.max >= Math.max(...values));
    assert.ok(domain.ticks.every(Number.isFinite));
  }
  assert.equal(numericDomain([NaN, Infinity]), null);
  assert.equal(numericDomain([]), null);
});

test("signed domains and scaling include a true zero anchor", () => {
  const domain = numericDomain([2, 3], true);
  assert.ok(domain.min <= 0);
  assert.equal(linearScale(2, 2, 2, 0, 100), 50);
  const bars = signedBarLayout([-2, 4, 0]);
  assert.ok(Math.abs(bars.zero - 100 / 3) < 1e-10);
  assert.equal(bars.bars[0].start, 0);
  assert.equal(bars.bars[1].start, bars.zero);
  assert.equal(bars.bars[2].width, 0);
  assert.equal(signedBarLayout([null]), null);
  assert.equal(signedBarLayout([NaN]), null);
  assert.equal(signedBarLayout([]), null);
});

test("nearest point inspection chooses actual dates at boundaries and between observations", () => {
  const input = [point("2024-01-01", 1), point("2024-01-03", 2), point("2024-01-05", 3)];
  assert.equal(nearestPointIndex(input, pointEpoch("2023-12-01")), 0);
  assert.equal(nearestPointIndex(input, pointEpoch("2024-02-01")), 2);
  assert.equal(nearestPointIndex(input, pointEpoch("2024-01-04")), 1);
  assert.equal(nearestPointIndex([], 0), -1);
});

test("trend changes are absolute observed differences, not invented percentage returns", () => {
  const input = [point("2024-01-01", -1), point("2024-03-01", 2)];
  assert.equal(trendChange(input).absolute, 3);
  assert.equal(trendChange([point("2024-01-01", 0)]).absolute, 0);
  assert.equal(trendChange([]), null);
  assert.notEqual(trendChange(input).first, input[0]);
});

test("formatting retains series precision and distinguishes percent levels from percentage-point changes", () => {
  assert.equal(formatMetricValue(4.1234, "RM", 4), "RM 4.1234");
  assert.equal(formatMetricValue(1.8, "%", 1), "1.8%");
  assert.equal(formatMetricChange(0.25, "%", 2), "+0.25 percentage points");
  assert.equal(formatMetricChange(-0.25, "%", 2), "−0.25 percentage points");
  assert.equal(formatMetricChange(-0.00001, "%", 2), "0.00 percentage points");
  assert.equal(formatMetricValue(1000, "index points", 0), "1,000 index points");
});

test("daily and policy dates show a day while monthly periods do not invent daily precision", () => {
  assert.equal(formatObservationDate("2024-05-01", "Monthly"), "May 2024");
  assert.equal(formatObservationDate("2024-05-01", "Trading days"), "1 May 2024");
  assert.equal(formatObservationDate("2024-05-01", "Policy decisions"), "1 May 2024");
  assert.equal(formatObservationDate("2024-05-01", "Monthly", true), "1 May 2024");
});

test("all six bundled series can render deterministically without mutating the payload", () => {
  const payload = JSON.parse(readFileSync(new URL("../data/published/dashboard.json", import.meta.url), "utf8"));
  const before = JSON.stringify(payload.series);
  for (const series of Object.values(payload.series)) {
    const prepared = prepareSeriesPoints(series.points);
    assert.ok(prepared.points.length > 0);
    for (const range of ["1Y", "3Y", "All"]) {
      const points = observationWindow(prepared.points, range);
      const domain = numericDomain(points.map((point) => point.value));
      assert.ok(domain);
      const path = buildTrendPath(points, series.frequency, (epoch) => epoch / 1e10, (value) => value * 10);
      assert.ok(!path.includes("NaN"));
      assert.equal(path, buildTrendPath(points, series.frequency, (epoch) => epoch / 1e10, (value) => value * 10));
    }
  }
  assert.equal(JSON.stringify(payload.series), before);
});

test("trend component provides source-linked observations and keyboard inspection, not only an image", () => {
  const source = readFileSync(new URL("../app/components/SeriesTrendPanel.tsx", import.meta.url), "utf8");
  assert.ok(source.includes("<table>"));
  assert.ok(source.includes("aria-valuetext="));
  assert.ok(source.includes("onKeyDown={inspectKeyboard}"));
  assert.ok(source.includes("active.source_url"));
  assert.ok(source.includes("aria-pressed={range === item}"));
  assert.ok(source.includes("not a live feed"));
});
