import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { nextChartIndex, isChartInspectionKey, nearestChartIndex, chartSegments, canvasContentWidth, chartFontSize, sectorShareObservations } from "../app/lib/chart-inspection.ts";
import { viewSource, functionSource } from './source-owners.mjs';

test("chart inspection handles arrows, boundaries, Home, End and Escape", () => {
  assert.equal(nextChartIndex("ArrowRight", 0, 3), 1);
  assert.equal(nextChartIndex("ArrowLeft", 0, 3), 0);
  assert.equal(nextChartIndex("ArrowRight", 2, 3), 2);
  assert.equal(nextChartIndex("Home", 2, 3), 0);
  assert.equal(nextChartIndex("End", 0, 3), 2);
  assert.equal(nextChartIndex("Escape", 2, 3), null);
  assert.equal(nextChartIndex("ArrowLeft", null, 3), 1);
  assert.equal(nextChartIndex("ArrowUp", 0, 3), 1);
  assert.equal(nextChartIndex("ArrowDown", 1, 3), 0);
  assert.equal(nextChartIndex("Tab", 1, 3), 1);
  assert.equal(isChartInspectionKey("Tab"), false);
});

test("empty and singleton datasets never yield invalid indices", () => {
  for (const key of ["ArrowLeft", "ArrowRight", "Home", "End"]) {
    assert.equal(nextChartIndex(key, null, 0), null);
    assert.equal(nextChartIndex(key, null, 1), 0);
  }
  assert.equal(nextChartIndex("Escape", 0, 1), null);
});

test("pointer and keyboard inspect exactly the same point coordinates", () => {
  const coordinates = [52, 110, 288];
  for (let index = 0; index < coordinates.length; index++) {
    assert.equal(nearestChartIndex(coordinates, coordinates[index]), index);
    assert.equal(nearestChartIndex(coordinates, coordinates[nextChartIndex("End", index, coordinates.length)]), 2);
  }
  assert.equal(nearestChartIndex([], 20), null);
  assert.equal(nearestChartIndex([100], -100), 0);
  assert.equal(nearestChartIndex(coordinates, NaN), null);
});

test("missing and non-finite observations break paths rather than becoming zero", () => {
  const points = [
    {date:"2024-01-01",value:1}, {date:"2024-02-01",value:0},
    {date:"2024-03-01",value:null}, {date:"2024-04-01",value:-1},
    {date:"2024-05-01",value:NaN}, {date:"2024-06-01",value:2},
  ];
  assert.deepEqual(chartSegments(points, "monthly"), [[0,1],[3],[5]]);
});

test("calendar gaps stay visible while normal trading weekends are allowed", () => {
  assert.deepEqual(chartSegments([{date:"2024-01-01",value:1},{date:"2024-03-01",value:2}],"monthly"), [[0],[1]]);
  assert.deepEqual(chartSegments([{date:"2020-01-01",value:1},{date:"2022-01-01",value:2}],"annual"), [[0],[1]]);
  assert.deepEqual(chartSegments([{date:"2024-01-05",value:1},{date:"2024-01-08",value:2},{date:"2024-01-22",value:3}],"daily"), [[0,1],[2]]);
});

test("policy decisions are irregular observations rather than missing monthly data", () => {
  assert.deepEqual(chartSegments([{date:"2024-01-24",value:3},{date:"2024-07-10",value:2.75}],"policy"), [[0,1]]);
});

test("impossible dates cannot become chart coordinates or connected paths", () => {
  assert.deepEqual(chartSegments([{date:"2024-01-01",value:1},{date:"2024-02-30",value:2},{date:"2024-03-01",value:3}],"monthly"), [[0],[2]]);
});

test("donut and forecast expose persistent values and native selections", () => {
  for (const [owner,name] of [["Structure","EconomicDonut"],["Forecast","ForecastIntervalChart"]]) {
    const body = functionSource(`views/${owner}View.tsx`,name);
    assert.match(body,/useId\(/);
    assert.match(body,/nextChartIndex/);
    assert.match(body,/role="status" aria-live="polite" aria-atomic="true"/);
    assert.match(body,/<button/);
    assert.doesNotMatch(body,/role="tooltip"/);
  }
});

test("Snapshot bars use native selections, persistent readings and shared keys", () => {
  const source = viewSource('Snapshot');
  const body = functionSource('views/SnapshotView.tsx','SnapshotHeadlineChart');
  assert.match(body,/useId\(/);
  assert.match(body,/<button[^>]*className="bar-column"/);
  assert.match(body,/nextChartIndex/);
  assert.match(body,/role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(body,/type="range"/);
  assert.doesNotMatch(body,/bar-tooltip/);
  assert.match(source,/<SnapshotHeadlineChart points=\{headlinePoints\}/);
});

test("Forecast keyboard selection also moves native button focus", () => {
  const body = functionSource('views/ForecastView.tsx','ForecastIntervalChart');
  assert.match(body,/buttons\.current\[next\]\?\.focus\(/);
  assert.match(body,/ref=\{\(element\) => \{ buttons\.current\[index\] = element;/);
});

test("canvas width honours container padding even inside a 320 CSS pixel layout", () => {
  assert.equal(canvasContentWidth(280, 16, 16), 248);
  assert.equal(canvasContentWidth(120, 16, 16), 88);
  assert.equal(canvasContentWidth(0, 16, 16), 1);
});

test("raster labels respond to enlarged body text instead of fixed 13px sizes", () => {
  assert.equal(chartFontSize(16), 14);
  assert.equal(chartFontSize(32), 28);
  assert.equal(chartFontSize(64), 56);
});

test("sector shares preserve published zero and missing-year gaps without borrowing", () => {
  const years = [
    {year:2020,sectors:[]}, {year:2021,sectors:[{id:"p1",share:0}]},
    {year:2022,sectors:[{id:"p1",share:NaN}]}, {year:2023,sectors:[{id:"p1",share:12.34}]},
  ];
  const before = structuredClone(years);
  assert.deepEqual(sectorShareObservations(years,"p1"),[
    {date:"2020-01-01",label:"2020",value:null}, {date:"2021-01-01",label:"2021",value:0},
    {date:"2022-01-01",label:"2022",value:null}, {date:"2023-01-01",label:"2023",value:12.34},
  ]);
  assert.deepEqual(years,before);
});

test("all canvas wrappers use one keyboard/pointer/live-value implementation", () => {
  const source = functionSource('components/AccessibleCanvasChart.tsx','AccessibleCanvasChart');
  assert.match(source,/function AccessibleCanvasChart/);
  assert.match(source,/onKeyDown[\s\S]*?nextChartIndex/);
  assert.match(source,/role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(source,/aria-describedby=\{`\$\{id\}-help \$\{id\}-reading`\}/);
  assert.match(source,/type="range"/);
  for (const [owner,name] of [['components/IndicatorDetail.tsx',"TimeSeriesChart"],['views/StructuralView.tsx',"StructuralChart"],['views/StructureView.tsx',"SectorShareTrend"],['views/ExternalView.tsx',"ExternalChart"],['views/BursaView.tsx',"MarketChart"]]) {
    assert.match(functionSource(owner,name),/<AccessibleCanvasChart/,name);
  }
});
