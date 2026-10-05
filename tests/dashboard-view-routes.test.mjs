import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {stripTypeScriptTypes} from "node:module";
import {projectDashboard} from "../app/lib/dashboard-projection.ts";

const fixture=()=>JSON.parse(readFileSync(new URL("../data/published/dashboard.json",import.meta.url),"utf8"));
const projectionUrl=new URL("../app/lib/dashboard-projection.ts",import.meta.url).href;
async function controlledRoute(name,source){
  let reads=0;
  const key=`__projectionRoute${name}${Math.random().toString(16).slice(2)}`;
  globalThis[key]=async()=>{reads++;if(source instanceof Error)throw source;return source;};
  let code=readFileSync(new URL(`../app/api/${name}/route.ts`,import.meta.url),"utf8")
    .replace(/import\s+\{getDashboard\}\s+from\s+"@\/app\/lib\/dashboard";/,`const getDashboard=globalThis[${JSON.stringify(key)}];`)
    .replace('"@/app/lib/dashboard-projection"',JSON.stringify(projectionUrl));
  code=stripTypeScriptTypes(code);
  const route=await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
  return {GET:route.GET,reads:()=>reads,dispose:()=>delete globalThis[key]};
}
test("view and history routes reject invalid requests before reading the artifact",async()=>{
  const view=await controlledRoute("dashboard-view",fixture()),history=await controlledRoute("dashboard-history",fixture());
  try{
    assert.equal((await view.GET(new Request("https://example.test/api/dashboard-view?section=unknown"))).status,400);
    assert.equal((await history.GET(new Request("https://example.test/api/dashboard-history?view=risk&id=invented"))).status,400);
    assert.equal(view.reads(),0);assert.equal(history.reads(),0);
  }finally{view.dispose();history.dispose();}
});
test("view route keeps fallback clocks, status and no-store semantics without transferring full history",async()=>{
  const source=fixture();source.usingFallback=true;source.health="fallback";
  const route=await controlledRoute("dashboard-view",source);
  try{
    const response=await route.GET(new Request("https://example.test/api/dashboard-view?section=snapshot")),body=await response.json();
    assert.equal(response.status,200);assert.equal(response.headers.get("cache-control"),"no-store");
    assert.equal(body.usingFallback,true);assert.equal(body.health,"fallback");assert.equal(body.generatedAt,source.generatedAt);
    assert.deepEqual(body.sources,source.sources);assert.equal(body.series.headline.points.length,22);assert.equal(body.forecast,undefined);
  }finally{route.dispose();}
});
test("history route returns409 for a content revision even when generatedAt is unchanged",async()=>{
  const source=fixture(),view=await projectDashboard(source,"forecast");source.narratives.forecast+=" revision";
  const route=await controlledRoute("dashboard-history",source);
  try{
    const response=await route.GET(new Request(`https://example.test${view.deferred["forecast-audit"].url}`));
    assert.equal(response.status,409);assert.equal(response.headers.get("cache-control"),"no-store");
    assert.match((await response.json()).error,/Refresh|changed/);
  }finally{route.dispose();}
});
test("history route returns only explicitly requested authoritative records",async()=>{
  const source=fixture(),view=await projectDashboard(source,"regional"),route=await controlledRoute("dashboard-history",source);
  try{
    const response=await route.GET(new Request(`https://example.test${view.deferred["regional-districts"].url}`)),body=await response.json();
    assert.equal(response.status,200);assert.deepEqual(body.data.districtRecords,source.regionalLens.districtRecords);
    assert.equal(body.data.forecast,undefined);assert.equal(body.artifactId,view.artifactId);assert.equal(body.scope.complete,true);
  }finally{route.dispose();}
});
test("route failures remain friendly and do not leak internal errors",async()=>{
  for(const name of ["dashboard-view","dashboard-history"]){
    const route=await controlledRoute(name,new Error("secret internal path"));
    try{
      const url=name==="dashboard-view"?"https://example.test/?section=risk":`https://example.test/?view=snapshot&id=indicator:headline&artifactId=${"a".repeat(64)}`;
      const response=await route.GET(new Request(url)),body=await response.json();
      assert.equal(response.status,503);assert.doesNotMatch(body.error,/secret|internal path/);
    }finally{route.dispose();}
  }
});
