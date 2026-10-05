import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {projectDashboard,projectDashboardHistory,parseHistoryRequest,dashboardArtifactId,DASHBOARD_VIEWS,DashboardProjectionError} from "../app/lib/dashboard-projection.ts";
import {isDashboardViewPayload} from "../app/lib/dashboard-view-client.ts";
const fixture = () => JSON.parse(readFileSync(new URL("../data/published/dashboard.json",import.meta.url),"utf8"));

test("Snapshot transfers a bounded preview, not unrelated histories",async()=>{
  const source=fixture(), before=structuredClone(source), view=await projectDashboard(source,"snapshot");
  assert.equal(view.view,"snapshot"); assert.match(view.artifactId,/^[a-f0-9]{64}$/);
  assert.equal(view.series.headline.points.length,22); assert.equal(view.series.core.points.length,1);
  assert.equal(view.series.headline.history.complete,false);
  assert.equal(view.series.headline.history.totalRows,source.series.headline.points.length);
  assert.equal(view.market,undefined); assert.equal(view.forecast,undefined);
  assert.equal(view.regionalLens?.districtRecords,undefined);
  assert.deepEqual(source,before);
});
test("same clock but different data produces a different artifact identity",async()=>{
  const source=fixture(), first=await projectDashboard(source,"risk");
  source.riskHeatmap.summary+=" changed";
  const second=await projectDashboard(source,"risk");
  assert.equal(first.generatedAt,second.generatedAt); assert.notEqual(first.artifactId,second.artifactId);
});
test("Forecast summary explicitly defers per-origin details",async()=>{
  const source=fixture(), view=await projectDashboard(source,"forecast");
  assert.equal(view.forecast.evaluation.windows,undefined);
  assert.deepEqual(view.forecast.evaluation.coverage,source.forecast.evaluation.coverage);
  assert.equal(view.deferred["forecast-audit"].totalRows,source.forecast.evaluation.windows.length);
});
test("Regional summary has state comparators but no embedded raw source rows",async()=>{
  const view=await projectDashboard(fixture(),"regional");
  assert.ok(view.regionalLens.stateRecords.length>10);
  assert.equal(view.regionalLens.districtRecords,undefined);
  assert.ok(view.regionalLens.districtIndex.length>100);
  const json=JSON.stringify(view.regionalLens.sources);
  assert.doesNotMatch(json,/percentileRecords|stateRecords|districtRecords|labourRecords|\"records\"/);
  assert.ok(view.deferred["regional-districts"]);
});
test("history is requested by artifact and cannot silently cross revisions",async()=>{
  const source=fixture(), view=await projectDashboard(source,"snapshot");
  const request={view:"snapshot",id:"indicator:headline",artifactId:view.artifactId,range:"ALL"};
  const result=await projectDashboardHistory(source,request);
  assert.deepEqual(result.data.points,source.series.headline.points);
  assert.equal(result.scope.complete,true);
  source.narratives.snapshot+=" revised";
  await assert.rejects(projectDashboardHistory(source,request),error=>error instanceof DashboardProjectionError && error.status===409);
});
test("history IDs, ranges and dates are validated before data work",()=>{
  const base="https://example.test/api/dashboard-history?view=snapshot&id=indicator:headline&artifactId="+"a".repeat(64);
  assert.equal(parseHistoryRequest(new URL(base)).range,"ALL");
  for(const query of ["&range=BAD","&range=CUSTOM&start=2024-02-30&end=2024-04-01","&range=CUSTOM&start=2024-05-01&end=2024-04-01"])
    assert.throws(()=>parseHistoryRequest(new URL(base+query)),DashboardProjectionError);
  assert.throws(()=>parseHistoryRequest(new URL(base.replace("indicator:headline","indicator:invented"))),DashboardProjectionError);
});
test("bounded history keeps source clocks and source observations unchanged",async()=>{
  const source=fixture(), view=await projectDashboard(source,"external");
  const data=await projectDashboardHistory(source,{view:"external",id:"external-history",artifactId:view.artifactId,range:"1Y"});
  assert.equal(data.data.retrievedAt,source.externalSector.retrievedAt);
  assert.ok(data.data.points.length<=13); assert.equal(data.scope.complete,false);
  assert.equal(data.scope.totalRows,source.externalSector.points.length);
});
test("national comparator records survive projection without duplicated state/district rows",async()=>{
  const source=fixture();
  for(const [id,row] of Object.entries({nationalIncome:{date:"2024-01-01",incomeMedian:7017,incomeMean:9362},nationalPoverty:{date:"2024-01-01",poverty:5.1},nationalInequality:{date:"2024-01-01",gini:0.390}}))
    source.regionalLens.sources[id]={status:"fresh",sourceUrl:"https://example.test/"+id,records:[row]};
  const view=await projectDashboard(source,"regional");
  for(const id of ["nationalIncome","nationalPoverty","nationalInequality"])
    assert.deepEqual(view.regionalLens.sources[id].records,source.regionalLens.sources[id].records);
  assert.equal(view.regionalLens.sources.hiesState.records,undefined);
  assert.equal(view.regionalLens.sources.hiesDistrict.records,undefined);
});
test("all route projections satisfy the client DTO boundary",async()=>{
  const source=fixture();
  for(const view of DASHBOARD_VIEWS)assert.equal(isDashboardViewPayload(await projectDashboard(source,view),view),true,view);
});
test("canonical identity is independent of object insertion order",async()=>{
  const source=fixture(), reordered=Object.fromEntries(Object.entries(source).reverse());
  assert.equal(await dashboardArtifactId(source),await dashboardArtifactId(reordered));
});
test("structured histories reject ranges they cannot apply",()=>{
  for(const id of ["forecast-audit","regional-districts","gdp-years"])
    assert.throws(()=>parseHistoryRequest(new URL(`https://example.test/?view=forecast&id=${id}&artifactId=${"a".repeat(64)}&range=1Y`)),error=>error.status===400);
});
test("daily preview covers a year; daily range keeps exact anniversary with leap-day clamp",async()=>{
  const source=fixture();
  source.market.benchmark.points=["2023-02-27","2023-02-28","2023-03-01","2024-02-29"].map((date,i)=>({date,value:100+i}));
  const view=await projectDashboard(source,"bursa"), result=await projectDashboardHistory(source,{view:"bursa",id:"market-history",artifactId:view.artifactId,range:"1Y"});
  assert.deepEqual(result.data.benchmark.points.map(p=>p.date),["2023-02-28","2023-03-01","2024-02-29"]);
  const original=fixture(), market=await projectDashboard(original,"bursa");
  assert.equal(market.market.benchmark.points.length,Math.min(300,original.market.benchmark.points.length));
});
test("district GDP and labour remain requestable when district HIES is unavailable",async()=>{
  const source=fixture();source.regionalLens.districtRecords=[];
  const view=await projectDashboard(source,"regional"),ref=view.deferred["regional-districts"];
  assert.equal(ref.available,true);
  assert.equal(ref.totalRows,(source.regionalLens.districtLabourRecords?.length??0)+(source.regionalLens.districtGdpRecords?.length??0));
  const history=await projectDashboardHistory(source,{view:"regional",id:ref.id,artifactId:view.artifactId,range:"ALL"});
  assert.deepEqual(history.data.districtGdpRecords,source.regionalLens.districtGdpRecords);
  assert.equal(history.scope.returnedRows,ref.totalRows);
});
test("external preview covers the default three-year range including both endpoints",async()=>{
  const source=fixture(),view=await projectDashboard(source,"external");
  assert.equal(view.externalSector.points.length,Math.min(37,source.externalSector.points.length));
});
