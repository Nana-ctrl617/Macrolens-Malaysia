import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {projectDashboard,projectDashboardHistory} from "../app/lib/dashboard-projection.ts";
import {createDashboardViewClient,DashboardArtifactChangedError,isDashboardViewPayload} from "../app/lib/dashboard-view-client.ts";
const fixture=()=>JSON.parse(readFileSync(new URL("../data/published/dashboard.json",import.meta.url),"utf8"));
const response=data=>({ok:true,status:200,json:async()=>data});
test("same-view requests deduplicate; different views remain independent",async()=>{
  const source=fixture();let calls=0;
  const client=createDashboardViewClient({fetch:async url=>{calls++;return response(await projectDashboard(source,new URL(url,"https://example.test").searchParams.get("section")));}});
  const a=client.load("risk"),b=client.load("risk"),c=client.load("brief");
  assert.equal(a,b);const results=await Promise.all([a,b,c]);assert.equal(calls,2);assert.equal(results[0].view,"risk");
  await client.load("risk");assert.equal(calls,2);
});
test("retry invalidates only its view and forces cache revalidation",async()=>{
  const source=fixture();const calls=[];
  const client=createDashboardViewClient({fetch:async(url,init)=>{calls.push([url,init.cache]);return response(await projectDashboard(source,new URL(url,"https://example.test").searchParams.get("section")));}});
  await client.load("risk");await client.load("brief");await client.retry("risk");await client.load("brief");
  assert.equal(calls.length,3);assert.equal(calls[2][1],"no-cache");
});
test("malformed and wrong-view responses are never cached",async()=>{
  const data=await projectDashboard(fixture(),"brief");let calls=0;
  const client=createDashboardViewClient({fetch:async()=>{calls++;return response(data);}});
  await assert.rejects(client.load("risk"),/invalid/i);await assert.rejects(client.load("risk"),/invalid/i);assert.equal(calls,2);
});
test("view loader never requests full dashboard or histories implicitly",async()=>{
  const source=fixture(),urls=[];
  const client=createDashboardViewClient({fetch:async url=>{urls.push(url);return response(await projectDashboard(source,"forecast"));}});
  const view=await client.load("forecast");assert.ok(view.deferred["forecast-audit"]);
  assert.deepEqual(urls,["/api/dashboard-view?section=forecast"]);
});
test("explicit history deduplicates by artifact/range and rejects mixed revisions",async()=>{
  const source=fixture(),view=await projectDashboard(source,"snapshot");let calls=0;
  const client=createDashboardViewClient({fetch:async url=>{calls++;return response(await projectDashboardHistory(source,{view:"snapshot",id:"indicator:headline",artifactId:view.artifactId,range:"ALL"}));}});
  const ref=view.deferred["indicator:headline"],a=client.loadHistory(ref),b=client.loadHistory(ref);assert.equal(a,b);await a;assert.equal(calls,1);
  const broken=createDashboardViewClient({fetch:async()=>({ok:false,status:409,json:async()=>({error:"changed"})})});
  await assert.rejects(broken.loadHistory(ref),error=>error instanceof DashboardArtifactChangedError&&error.status===409);
});
test("timeouts and invalidation release pending promises even if fetch ignores abort",async()=>{
  const client=createDashboardViewClient({fetch:()=>new Promise(()=>{}),timeoutMs:5});
  await assert.rejects(client.load("risk"),/timed out/i);
  const pending=client.load("brief");client.invalidate("brief");await assert.rejects(pending,/cancelled/i);
});
test("cache expires and a late cancelled request cannot replace refreshed data",async()=>{
  const source=fixture(),first=await projectDashboard(source,"risk");source.riskHeatmap.summary+=" latest";
  const latest=await projectDashboard(source,"risk");let clock=0,calls=0,finishOld;
  const client=createDashboardViewClient({now:()=>clock,cacheMs:10,fetch:async()=>{calls++;if(calls===1)return new Promise(resolve=>{finishOld=resolve});return response(latest);}});
  const old=client.load("risk"),cancelled=assert.rejects(old,/cancelled/i),fresh=client.retry("risk");
  assert.equal((await fresh).artifactId,latest.artifactId);finishOld(response(first));await cancelled;
  assert.equal((await client.load("risk")).artifactId,latest.artifactId);assert.equal(calls,2);
  clock=11;await client.load("risk");assert.equal(calls,3);
});
test("409 invalidates summary cache and never silently requests a new history",async()=>{
  const source=fixture(),calls=[];
  const client=createDashboardViewClient({fetch:async url=>{calls.push(url);return url.includes("dashboard-history")?{ok:false,status:409}:response(await projectDashboard(source,"snapshot"));}});
  const view=await client.load("snapshot");
  await assert.rejects(client.loadHistory(view.deferred["indicator:headline"]),DashboardArtifactChangedError);
  assert.equal(calls.length,2);await client.load("snapshot");assert.equal(calls.length,3);
  assert.equal(calls.filter(url=>url.includes("dashboard-history")).length,1);
});
test("malformed history is rejected and not cached",async()=>{
  const source=fixture(),view=await projectDashboard(source,"snapshot"),ref=view.deferred["indicator:headline"];
  const malformed=await projectDashboardHistory(source,{view:"snapshot",id:ref.id,artifactId:ref.artifactId,range:"ALL"});malformed.data.points[0].value=null;
  let calls=0;const client=createDashboardViewClient({fetch:async()=>{calls++;return response(malformed);}});
  await assert.rejects(client.loadHistory(ref),/invalid/i);await assert.rejects(client.loadHistory(ref),/invalid/i);assert.equal(calls,2);
});
test("unknown views and history references do not send requests",async()=>{
  let calls=0;const client=createDashboardViewClient({fetch:async()=>{calls++;return response({});}});
  await assert.rejects(client.retry("unknown"),/Unknown/);
  await assert.rejects(client.loadHistory({view:"regional",id:"invented",artifactId:"a".repeat(64),totalRows:1,available:true}),/invalid/i);
  assert.equal(calls,0);
});
test("ALL history cannot call a truncated response complete or change its declared total",async()=>{
  const source=fixture(),view=await projectDashboard(source,"snapshot"),ref=view.deferred["indicator:headline"];
  for(const change of [data=>{data.data.points=data.data.points.slice(-2);data.scope.returnedRows=2;},data=>{data.scope.totalRows++;}]){
    const data=await projectDashboardHistory(source,{view:"snapshot",id:ref.id,artifactId:ref.artifactId,range:"ALL"});change(data);
    let calls=0;const client=createDashboardViewClient({fetch:async()=>{calls++;return response(data);}});
    await assert.rejects(client.loadHistory(ref),/invalid/i);await assert.rejects(client.loadHistory(ref),/invalid/i);assert.equal(calls,2);
  }
});
test("series history reference identity and scope must match its own deferred indicator",async()=>{
  for(const change of [data=>{data.series.headline.history.ref=data.deferred["indicator:core"];},data=>{data.series.headline.history.ref={...data.series.headline.history.ref,totalRows:1};},data=>{delete data.deferred["indicator:headline"];}]){
    const data=await projectDashboard(fixture(),"snapshot");change(data);assert.equal(isDashboardViewPayload(data,"snapshot"),false);
  }
});
test("nested Risk data fail closed before caching while genuine zero scores remain valid",async()=>{
  for(const change of [risk=>{risk.items[0].score="bad";},risk=>{risk.overallScore=NaN;},risk=>{risk.items[0].level="wrong";},risk=>{risk.items[0].score=null;risk.items[0].level="unavailable";risk.items[0].dataStatus="fresh";},risk=>{risk.items[0].id=risk.items[1].id;}]){
    const data=await projectDashboard(fixture(),"risk");change(data.riskHeatmap);
    let calls=0;const client=createDashboardViewClient({fetch:async()=>{calls++;return response(data);}});
    await assert.rejects(client.load("risk"),/invalid/i);await assert.rejects(client.load("risk"),/invalid/i);assert.equal(calls,2);
  }
  const valid=await projectDashboard(fixture(),"risk");Object.assign(valid.riskHeatmap,{status:"fresh",overallScore:0,overallLevel:"low",availableCount:9,totalCount:9});
  valid.riskHeatmap.items=valid.riskHeatmap.items.map(item=>({...item,score:0,level:"low",dataStatus:"fresh"}));
  assert.equal(isDashboardViewPayload(valid,"risk"),true);
  valid.usingFallback=true;valid.health="fallback";valid.riskHeatmap.items.forEach(item=>{item.dataStatus="fallback";});
  assert.equal(isDashboardViewPayload(valid,"risk"),true,"transport fallback retains genuine numerical Risk scores");
});
test("external and market malformed chart values and required summaries are rejected",async()=>{
  const cases={external:[data=>{data.externalSector.points[0].exports=null;},data=>{data.externalSector.summary.balance="0";},data=>{data.externalSector.points[0].date="2024-02-30";},data=>{delete data.externalSector.summary.last12Balance;}],bursa:[data=>{data.market.benchmark.points[0].value="100";},data=>{data.market.summary.maxDrawdown1Y=null;},data=>{data.market.benchmark.points[0].date="broken";},data=>{delete data.market.summary.latest;}]};
  for(const [view,changes] of Object.entries(cases))for(const change of changes){const data=await projectDashboard(fixture(),view);change(data);assert.equal(isDashboardViewPayload(data,view),false,view);}
  const external=await projectDashboard(fixture(),"external");external.externalSector.summary.balance=0;external.externalSector.points[0].balance=0;assert.equal(isDashboardViewPayload(external,"external"),true);
});
test("requested market and trade histories validate their chart values before caching",async()=>{
  for(const [view,id,change] of [["bursa","market-history",data=>{data.data.benchmark.points[0].value=null;}],["external","external-history",data=>{data.data.summary.exports=null;}]]){
    const source=fixture(),summary=await projectDashboard(source,view),ref=summary.deferred[id],data=await projectDashboardHistory(source,{view,id,artifactId:summary.artifactId,range:"ALL"});change(data);
    const client=createDashboardViewClient({fetch:async()=>response(data)});await assert.rejects(client.loadHistory(ref),/invalid/i);
  }
});
