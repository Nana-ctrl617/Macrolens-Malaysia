import {dashboardViewFields,isDashboardView,isHistoryId,type DashboardView,type DashboardViewPayload,type DashboardHistoryPayload,type DeferredHistory,type HistoryId,type HistoryRange} from "./dashboard-projection.ts";
import {pressureSummary} from "./score-method.ts";
type Options={fetch?:typeof globalThis.fetch;now?:()=>number;cacheMs?:number;timeoutMs?:number};
type HistoryOptions={range?:HistoryRange;start?:string;end?:string};
type Entry<T>={data:T;expires:number};
type Pending<T>={controller:AbortController;promise:Promise<T>};
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
const finite=(v:unknown):v is number=>typeof v==="number"&&Number.isFinite(v);
const hash=(v:unknown):v is string=>typeof v==="string"&&/^[a-f0-9]{64}$/.test(v);
const text=(v:unknown):v is string=>typeof v==="string"&&v.trim().length>0;
const nullableFinite=(v:unknown)=>v===null||finite(v);
function observationDate(v:unknown):v is string{if(typeof v!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;const d=new Date(`${v}T00:00:00Z`);return Number.isFinite(d.valueOf())&&d.toISOString().slice(0,10)===v;}
function datedRows(rows:unknown,fields:string[]):rows is Record<string,unknown>[] {
  if(!Array.isArray(rows))return false;
  let previous="";
  for(const point of rows){if(!record(point)||!observationDate(point.date)||point.date<=previous||!fields.every(field=>finite(point[field])))return false;previous=point.date;}
  return true;
}
export class DashboardArtifactChangedError extends Error {readonly status=409;constructor(){super("The dataset changed. Refresh the page summary before requesting details again; previous and current data are not mixed.");this.name="DashboardArtifactChangedError";}}
function validRef(raw:unknown,view:DashboardView,artifactId:string):raw is DeferredHistory{return record(raw)&&isDashboardView(raw.view)&&raw.view===view&&raw.artifactId===artifactId&&isHistoryId(raw.id)&&Number.isInteger(raw.totalRows)&&Number(raw.totalRows)>=0&&raw.available===(Number(raw.totalRows)>0);}
function validPreviewScope(scope:unknown,rows:number,id:HistoryId,raw:Record<string,unknown>):boolean {
  if(!record(scope)||!record(raw.deferred)||scope.returnedRows!==rows||!Number.isInteger(scope.totalRows)||Number(scope.totalRows)<rows||scope.complete!==(scope.totalRows===rows)||!validRef(scope.ref,raw.view as DashboardView,raw.artifactId as string)||scope.ref.id!==id||scope.ref.totalRows!==scope.totalRows)return false;
  const ref=raw.deferred[id];return validRef(ref,raw.view as DashboardView,raw.artifactId as string)&&ref.id===id&&ref.totalRows===scope.totalRows&&ref.available===scope.ref.available;
}
function validRisk(raw:unknown,fallback:boolean):boolean {
  if(!record(raw)||!Array.isArray(raw.items)||raw.items.length!==9||!raw.items.every(record)||!["fresh","partial","unavailable"].includes(String(raw.status))||!text(raw.generatedAt)||!Number.isFinite(Date.parse(raw.generatedAt))||!["summary","method"].every(key=>text(raw[key])))return false;
  const items=raw.items as Record<string,unknown>[],level=(score:number)=>score>=70?"high":score>=40?"moderate":"low";
  if(!items.every(item=>["id","label","group","evidence","rule","period","watch"].every(key=>text(item[key]))))return false;
  const summary=pressureSummary(items.map(item=>({id:item.id as string,score:item.score,level:item.level as string,dataStatus:item.dataStatus as string|undefined})));
  if(!summary.valid)return false;
  for(const item of items){
    if(item.score===null){if(item.level!=="unavailable"||item.dataStatus!=="unavailable"||!text(item.unavailableReason))return false;}
    else if(!finite(item.score)||item.level!==level(item.score)||item.dataStatus==="unavailable")return false;
  }
  if(raw.availableCount!==undefined&&raw.availableCount!==summary.availableCount||raw.totalCount!==undefined&&raw.totalCount!==summary.totalCount||raw.coverageNote!==undefined&&!text(raw.coverageNote))return false;
  if(summary.availableCount<summary.totalCount&&(raw.availableCount!==summary.availableCount||raw.totalCount!==summary.totalCount||!text(raw.coverageNote)||raw.status==="fresh"))return false;
  // A fallback is a transport state: it does not invalidate the saved score.
  if(raw.status==="fresh"&&items.some(item=>item.dataStatus!==undefined&&item.dataStatus!=="fresh"&&!(fallback&&item.dataStatus==="fallback")))return false;
  return summary.score===null?raw.overallScore===null&&raw.overallLevel==="unavailable"&&raw.status==="unavailable":finite(raw.overallScore)&&Math.abs(raw.overallScore-summary.score)<=0.051&&raw.overallLevel===level(raw.overallScore)&&raw.status!=="unavailable";
}
function validMarket(raw:unknown):boolean {
  if(!record(raw)||!record(raw.benchmark)||!record(raw.summary)||!record(raw.narratives)||!datedRows(raw.benchmark.points,["value"])||!["fresh","stale"].includes(String(raw.status))||!text(raw.retrievedAt)||!["performance","macro"].every(key=>text((raw.narratives as Record<string,unknown>)[key])))return false;
  const summary=raw.summary;
  return observationDate(summary.latestDate)&&["latest","change1D","maxDrawdown1Y","high52w","low52w"].every(key=>finite(summary[key]))&&["return1M","return3M","returnYtd","return1Y","annualizedVolatility1Y"].every(key=>nullableFinite(summary[key]));
}
function validExternal(raw:unknown):boolean {
  if(!record(raw)||!record(raw.summary)||!record(raw.narratives)||!datedRows(raw.points,["exports","imports","total","balance"])||!["fresh","stale"].includes(String(raw.status))||!text(raw.retrievedAt)||!["performance","macro"].every(key=>text((raw.narratives as Record<string,unknown>)[key])))return false;
  const summary=raw.summary;
  return observationDate(summary.latestDate)&&["exports","imports","total","balance","last12Balance"].every(key=>finite(summary[key]))&&["exportsYoY","importsYoY","prior12Balance"].every(key=>nullableFinite(summary[key]))&&text(summary.tradeReading);
}
/** The server validates the complete artifact. This boundary validates the projected DTO and prevents accidental full downloads. */
export function isDashboardViewPayload(raw:unknown,view:DashboardView):raw is DashboardViewPayload {
  if(!record(raw)||raw.projectionVersion!==1||raw.view!==view||!hash(raw.artifactId)||!Number.isInteger(raw.schemaVersion)||Number(raw.schemaVersion)<1||Number(raw.schemaVersion)>9||typeof raw.generatedAt!=="string"||!Number.isFinite(Date.parse(raw.generatedAt))||!["fresh","partial","fallback"].includes(String(raw.health))||!record(raw.sources)||!record(raw.deferred))return false;
  if(raw.usingFallback!==undefined&&typeof raw.usingFallback!=="boolean")return false;
  const allowed=["projectionVersion","view","artifactId","schemaVersion","generatedAt","health","usingFallback","sources","inputHealth","deferred",...dashboardViewFields(view)];
  if(Object.keys(raw).some(key=>!allowed.includes(key)))return false;
  if(!Object.entries(raw.deferred).every(([id,ref])=>validRef(ref,view,raw.artifactId as string)&&ref.id===id))return false;
  if(dashboardViewFields(view).includes("series")){
    if(!record(raw.series))return false;
    for(const id of ["headline","core","opr","unemployment","fx","mgs"]){const series=raw.series[id];
      if(!record(series)||!datedRows(series.points,["value"])||!validPreviewScope(series.history,series.points.length,`indicator:${id}` as HistoryId,raw))return false;
    }
  }
  if(raw.forecast!==undefined){if(!record(raw.forecast)||!Array.isArray(raw.forecast.points)||raw.forecast.points.length!==3)return false;
    if(raw.forecast.evaluation!==undefined&&(!record(raw.forecast.evaluation)||raw.forecast.evaluation.windows!==undefined))return false;}
  if(raw.regionalLens!==undefined&&(!record(raw.regionalLens)||raw.regionalLens.dataScope!=="state-summary"||!Array.isArray(raw.regionalLens.stateRecords)||!Array.isArray(raw.regionalLens.districtIndex)||raw.regionalLens.districtRecords!==undefined))return false;
  if(dashboardViewFields(view).includes("riskHeatmap")&&Number(raw.schemaVersion)>=7&&raw.riskHeatmap===undefined)return false;
  if(raw.riskHeatmap!==undefined&&!validRisk(raw.riskHeatmap,raw.usingFallback===true))return false;
  if(raw.market!==undefined&&(!validMarket(raw.market)||!record(raw.market)||!record(raw.market.benchmark)||!Array.isArray(raw.market.benchmark.points)||!validPreviewScope(raw.market.history,raw.market.benchmark.points.length,"market-history",raw)))return false;
  if(raw.externalSector!==undefined&&(!validExternal(raw.externalSector)||!record(raw.externalSector)||!Array.isArray(raw.externalSector.points)||!validPreviewScope(raw.externalSector.history,raw.externalSector.points.length,"external-history",raw)))return false;
  return true;
}
function validHistory(raw:unknown,ref:DeferredHistory,range:HistoryRange):raw is DashboardHistoryPayload{
  if(!record(raw)||raw.projectionVersion!==1||raw.view!==ref.view||raw.id!==ref.id||raw.artifactId!==ref.artifactId||!record(raw.scope)||!record(raw.data))return false;
  const scope=raw.scope;if(scope.range!==range||scope.totalRows!==ref.totalRows||!Number.isInteger(scope.totalRows)||!Number.isInteger(scope.returnedRows)||Number(scope.returnedRows)<0||Number(scope.totalRows)<Number(scope.returnedRows)||scope.complete!==(range==="ALL")||range==="ALL"&&scope.returnedRows!==scope.totalRows)return false;
  if(ref.id.startsWith("indicator:"))return datedRows(raw.data.points,["value"])&&raw.data.points.length===scope.returnedRows;
  if(ref.id==="forecast-audit")return Array.isArray(raw.data.windows)&&Array.isArray(raw.data.origins)&&raw.data.windows.length===scope.returnedRows;
  if(ref.id==="regional-districts")return Array.isArray(raw.data.districtRecords)&&[raw.data.districtLabourRecords,raw.data.districtGdpRecords].every(rows=>rows===undefined||Array.isArray(rows))&&(raw.data.districtRecords.length+(Array.isArray(raw.data.districtLabourRecords)?raw.data.districtLabourRecords.length:0)+(Array.isArray(raw.data.districtGdpRecords)?raw.data.districtGdpRecords.length:0))===scope.returnedRows;
  if(ref.id==="market-history")return validMarket(raw.data)&&record(raw.data.benchmark)&&Array.isArray(raw.data.benchmark.points)&&raw.data.benchmark.points.length===scope.returnedRows;
  if(ref.id==="external-history")return validExternal(raw.data)&&Array.isArray(raw.data.points)&&raw.data.points.length===scope.returnedRows;
  if(ref.id==="bop-history")return Array.isArray(raw.data.quarters)&&raw.data.quarters.length===scope.returnedRows;
  if(ref.id==="gdp-years")return record(raw.data.economicStructure)&&Array.isArray(raw.data.economicStructure.years);
  return Array.isArray(raw.data.entries)&&raw.data.entries.length===scope.returnedRows;
}
export function createDashboardViewClient(options:Options={}){
  const fetcher=options.fetch??((url,init)=>globalThis.fetch(url,init)),now=options.now??Date.now,cacheMs=options.cacheMs??300000,timeoutMs=options.timeoutMs??12000;
  const cached=new Map<string,Entry<unknown>>(),pending=new Map<string,Pending<unknown>>(),generations=new Map<string,number>();
  const invalidateKey=(key:string)=>{generations.set(key,(generations.get(key)??0)+1);cached.delete(key);const old=pending.get(key);pending.delete(key);old?.controller.abort();};
  function request<T>(key:string,url:string,validate:(v:unknown)=>v is T,revalidate=false):Promise<T>{
    const old=cached.get(key);if(old&&now()<old.expires)return Promise.resolve(old.data as T);
    const running=pending.get(key);if(running)return running.promise as Promise<T>;
    const controller=new AbortController(),generation=generations.get(key)??0;let timedOut=false;
    let rejectAbort:(e:Error)=>void=()=>{};const aborted=new Promise<never>((_resolve,reject)=>{rejectAbort=reject;});
    const onAbort=()=>rejectAbort(new Error(timedOut?"Data request timed out. Please retry.":"Data request was cancelled."));
    controller.signal.addEventListener("abort",onAbort,{once:true});const timer=setTimeout(()=>{timedOut=true;controller.abort();},timeoutMs);
    const download=async()=>{const response=await fetcher(url,{signal:controller.signal,headers:{Accept:"application/json"},...(revalidate?{cache:"no-cache" as const}:{})});
      if(response.status===409)throw new DashboardArtifactChangedError();
      if(!response.ok)throw new Error(`Data could not be loaded (HTTP ${response.status}). Please retry.`);
      const data:unknown=await response.json();if(!validate(data))throw new Error("Data response is invalid. Please retry.");return data;};
    const promise=Promise.race([download(),aborted]).then(data=>{if(generation===(generations.get(key)??0))cached.set(key,{data,expires:now()+cacheMs});return data;})
      .finally(()=>{clearTimeout(timer);controller.signal.removeEventListener("abort",onAbort);if(pending.get(key)?.promise===promise)pending.delete(key);});
    pending.set(key,{controller,promise});return promise;
  }
  function load<S extends DashboardView>(view:S):Promise<DashboardViewPayload<S>>{
    if(!isDashboardView(view))return Promise.reject(new Error("Unknown dashboard view."));
    return request(`view:${view}`,`/api/dashboard-view?section=${view}`,(raw):raw is DashboardViewPayload<S>=>isDashboardViewPayload(raw,view));
  }
  function retry<S extends DashboardView>(view:S):Promise<DashboardViewPayload<S>>{if(!isDashboardView(view))return Promise.reject(new Error("Unknown dashboard view."));invalidateKey(`view:${view}`);return request(`view:${view}`,`/api/dashboard-view?section=${view}`,(raw):raw is DashboardViewPayload<S>=>isDashboardViewPayload(raw,view),true);}
  function history<H extends HistoryId>(ref:DeferredHistory<H>,opts:HistoryOptions={},retry=false):Promise<DashboardHistoryPayload<H>>{
    if(!validRef(ref,ref.view,ref.artifactId)||!hash(ref.artifactId)||!ref.available)return Promise.reject(new Error("History reference is unavailable or invalid."));
    const range=opts.range??"ALL",query=new URLSearchParams({view:ref.view,id:ref.id,artifactId:ref.artifactId,range,...(opts.start?{start:opts.start}:{}),...(opts.end?{end:opts.end}:{})});
    const key=`history:${query}`;if(retry)invalidateKey(key);
    const result=request(key,`/api/dashboard-history?${query}`,(raw):raw is DashboardHistoryPayload<H>=>validHistory(raw,ref,range),retry);
    // Keep the original shared promise for deduplication; revision handling is a
    // side effect, never a silent request against a different artifact.
    result.catch(error=>{if(error instanceof DashboardArtifactChangedError)invalidateKey(`view:${ref.view}`);});
    return result;
  }
  return {load,retry,invalidate:(view:DashboardView)=>invalidateKey(`view:${view}`),loadHistory:history,retryHistory:<H extends HistoryId>(ref:DeferredHistory<H>,opts:HistoryOptions={})=>history(ref,opts,true)};
}
const client=createDashboardViewClient();
export const loadDashboardView=client.load;
export const retryDashboardView=client.retry;
export const invalidateDashboardView=client.invalidate;
export const loadDashboardHistory=client.loadHistory;
export const retryDashboardHistory=client.retryHistory;
