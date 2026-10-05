import type {DashboardPayload,SeriesData,ForecastEvaluation,RegionalLens,RegionalSourceMetadata,MarketData,ExternalSector,BalancePayments,EconomicStructure,GrowthDrivers} from "./dashboard";

export const DASHBOARD_VIEWS = ["snapshot","brief","news","risk","forecast","drivers","structure","external","bop","household","regional","sectors","bursa","decisions","timeline","structural","report","health","methodology"] as const;
export type DashboardView = typeof DASHBOARD_VIEWS[number];
export type IndicatorId = "headline"|"core"|"opr"|"unemployment"|"fx"|"mgs";
export type HistoryId = `indicator:${IndicatorId}`|"forecast-audit"|"regional-districts"|"gdp-years"|"external-history"|"bop-history"|"market-history"|"timeline-history";
export type HistoryRange = "ALL"|"1Y"|"3Y"|"5Y"|"10Y"|"CUSTOM";
export type DeferredHistory<H extends HistoryId=HistoryId> = {id:H;view:DashboardView;artifactId:string;totalRows:number;url:string;available:boolean;note:string};
export type PreviewScope = {complete:boolean;returnedRows:number;totalRows:number;ref:DeferredHistory};
export type SeriesPreview = SeriesData & {history:PreviewScope};
export type ForecastPreview = Omit<DashboardPayload["forecast"],"evaluation"> & {evaluation?:Omit<ForecastEvaluation,"windows">};
export type RegionalBenchmarkSource = RegionalSourceMetadata & {records?:Array<Record<string,unknown>>};
export type RegionalPreview = Omit<RegionalLens,"districtRecords"|"districtLabourRecords"|"districtGdpRecords"|"sources"> & {
  sources?:Record<string,RegionalBenchmarkSource>;districtIndex:Array<{state:string;district:string}>;
  dataScope:"state-summary";
};
export type MarketPreview = MarketData & {history:PreviewScope};
export type ExternalPreview = ExternalSector & {history:PreviewScope};
export type BopPreview = BalancePayments & {history:PreviewScope};
export type GdpPreview = EconomicStructure & {history:PreviewScope;availableYears:number[]};
type ProjectedData = Omit<DashboardPayload,"series"|"forecast"|"regionalLens"|"market"|"externalSector"|"balancePayments"|"economicStructure"|"growthDrivers"> & {
  series:Record<string,SeriesPreview>;forecast:ForecastPreview;regionalLens?:RegionalPreview;
  market?:MarketPreview;externalSector?:ExternalPreview;balancePayments?:BopPreview;economicStructure?:GdpPreview;
  growthDrivers?:Omit<GrowthDrivers,"production"> & {production:GdpPreview};
};
const VIEW_FIELDS = {
  snapshot:["series","narratives","riskHeatmap","dataOperations","regionalLens","structuralBreaks","categories"],
  brief:["latestBrief","riskHeatmap","series"],news:[],risk:["riskHeatmap"],
  forecast:["forecast","narratives","series"],drivers:["series","categories","cpiDecomposition","forecast","narratives"],
  structure:["economicStructure","growthDrivers","sectorDeepDive","regionalLens"],external:["externalSector"],bop:["balancePayments"],
  household:["householdPressure","market","regionalLens"],regional:["regionalLens"],sectors:["sectorDeepDive","regionalLens"],
  bursa:["market"],decisions:["decisionGuide","regionalLens"],timeline:["macroTimeline"],structural:["structuralBreaks","series","categories"],
  report:["monthlyReport"],health:["dataHealth","dataOperations"],methodology:["forecast","dataOperations","narratives"],
} as const satisfies Record<DashboardView,readonly (keyof ProjectedData)[]>;
type Common = Pick<DashboardPayload,"schemaVersion"|"generatedAt"|"health"|"usingFallback"|"sources"|"inputHealth">;
export type DashboardViewPayload<S extends DashboardView = DashboardView> = S extends DashboardView ? Common & {
  view:S;artifactId:string;projectionVersion:1;deferred:{[H in HistoryId]?:DeferredHistory<H>};
} & Pick<ProjectedData,(typeof VIEW_FIELDS)[S][number]> : never;
export type HistoryDataMap = {
  "forecast-audit":ForecastEvaluation;
  "regional-districts":Pick<RegionalLens,"districtRecords"|"districtLabourRecords"|"districtGdpRecords">;
  "gdp-years":Pick<DashboardPayload,"economicStructure"|"growthDrivers">;
  "external-history":ExternalSector;"bop-history":BalancePayments;"market-history":MarketData;
  "timeline-history":NonNullable<DashboardPayload["macroTimeline"]>;
} & Record<`indicator:${IndicatorId}`,SeriesData>;
export type HistoryRequest = {view:DashboardView;id:HistoryId;artifactId:string;range:HistoryRange;start?:string;end?:string};
export type DashboardHistoryPayload<H extends HistoryId=HistoryId> = {projectionVersion:1;artifactId:string;view:DashboardView;id:H;schemaVersion:number;generatedAt:string;usingFallback?:boolean;
  scope:{complete:boolean;range:HistoryRange;returnedRows:number;totalRows:number;start:string|null;end:string|null};data:HistoryDataMap[H]};
export class DashboardProjectionError extends Error {status:number; constructor(status:number,message:string){super(message);this.name="DashboardProjectionError";this.status=status;}}
const INDICATORS:IndicatorId[]=["headline","core","opr","unemployment","fx","mgs"];
export function isDashboardView(value:unknown):value is DashboardView{return typeof value==="string" && (DASHBOARD_VIEWS as readonly string[]).includes(value);}
export function isHistoryId(value:unknown):value is HistoryId{return typeof value==="string"&&(INDICATORS.some(id=>value===`indicator:${id}`)||["forecast-audit","regional-districts","gdp-years","external-history","bop-history","market-history","timeline-history"].includes(value));}
export function dashboardViewFields(view:DashboardView):readonly string[]{return VIEW_FIELDS[view];}
function canonical(value:unknown):string {
  if(Array.isArray(value))return `[${value.map(canonical).join(",")}]`;
  if(value && typeof value==="object")return `{${Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
export async function dashboardArtifactId(payload:DashboardPayload):Promise<string>{
  const bytes=new TextEncoder().encode(canonical(payload));
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  return [...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,"0")).join("");
}
function metadata(source:RegionalSourceMetadata,retainBenchmark=false):RegionalBenchmarkSource {
  const allowed=["status","retrievedAt","lastAttemptAt","observationPeriod","sourceUrl","datasetUrl","stateDatasetUrl","nationalDatasetUrl","districtSourceUrl","districtDatasetUrl","frequency","message"];
  const output=Object.fromEntries(Object.entries(source).filter(([key])=>allowed.includes(key))) as RegionalBenchmarkSource;
  for(const key of ["stateSource","districtSource","nationalSource"] as const)if(source[key])output[key]=metadata(source[key]);
  if(source.nationalExpenditure)output.nationalExpenditure=structuredClone(source.nationalExpenditure);
  const records=(source as RegionalBenchmarkSource).records;
  // These small parsed national comparator rows are necessary evidence, not the
  // duplicated state/district ingestion arrays deliberately deferred elsewhere.
  if(retainBenchmark&&Array.isArray(records))output.records=structuredClone(records);
  return output;
}
function regionalSummary(source:RegionalLens):RegionalPreview {
  const {districtRecords,districtLabourRecords,districtGdpRecords,sources,...rest}=source;
  const index=new Map<string,{state:string;district:string}>();
  for(const row of [...(districtRecords??[]),...(districtLabourRecords??[]),...(districtGdpRecords??[])])index.set(`${row.state}\0${row.district}`,{state:row.state,district:row.district});
  return {...structuredClone(rest),sources:sources?Object.fromEntries(Object.entries(sources).map(([id,s])=>[id,metadata(s,["nationalIncome","nationalPoverty","nationalInequality"].includes(id))])):undefined,
    districtIndex:[...index.values()].sort((a,b)=>a.state.localeCompare(b.state)||a.district.localeCompare(b.district)),dataScope:"state-summary"};
}
function districtRowCount(source:RegionalLens):number{return source.districtRecords.length+(source.districtLabourRecords?.length??0)+(source.districtGdpRecords?.length??0);}
/** Pure projection: callers must pass the already validated consolidated artifact. */
export async function projectDashboard<S extends DashboardView>(payload:DashboardPayload,view:S):Promise<DashboardViewPayload<S>> {
  if(!isDashboardView(view))throw new DashboardProjectionError(400,"Unknown dashboard view.");
  const artifactId=await dashboardArtifactId(payload),deferred:Partial<Record<HistoryId,DeferredHistory>>={};
  const ref=(id:HistoryId,totalRows:number):DeferredHistory=>deferred[id]??(deferred[id]={id,view,artifactId,totalRows,available:totalRows>0,
    url:`/api/dashboard-history?view=${view}&id=${encodeURIComponent(id)}&artifactId=${artifactId}&range=ALL`,note:"Detailed records are loaded only when requested; this preview is not complete history."});
  const scope=(id:HistoryId,totalRows:number,returnedRows:number):PreviewScope=>({complete:returnedRows===totalRows,totalRows,returnedRows,ref:ref(id,totalRows)});
  const data:Record<string,unknown>={projectionVersion:1,view,artifactId,schemaVersion:payload.schemaVersion,generatedAt:payload.generatedAt,health:payload.health,usingFallback:payload.usingFallback,sources:structuredClone(payload.sources),inputHealth:structuredClone(payload.inputHealth),deferred};
  for(const key of VIEW_FIELDS[view]){
    const value=payload[key];if(value===undefined)continue;
    if(key==="series"){
      data.series=Object.fromEntries(INDICATORS.map(id=>{const source=payload.series[id],max=view==="snapshot"?(id==="headline"?22:1):view==="forecast"?1:/trading|day/i.test(source.frequency)?300:24;
        const points=source.points.slice(-max);return[id,{...structuredClone(source),points:structuredClone(points),history:scope(`indicator:${id}`,source.points.length,points.length)}];}));
    }else if(key==="forecast"){
      const {evaluation,...forecast}=payload.forecast;data.forecast=structuredClone(forecast);
      if(evaluation){const {windows,...summary}=evaluation;(data.forecast as ForecastPreview).evaluation=structuredClone(summary);ref("forecast-audit",windows.length);}
    }else if(key==="regionalLens") {data.regionalLens=regionalSummary(value as RegionalLens);ref("regional-districts",districtRowCount(value as RegionalLens));
    }else if(key==="market") {const source=value as MarketData,points=source.benchmark.points.slice(view==="bursa"?-300:-1);data.market={...structuredClone(source),benchmark:{...source.benchmark,points:structuredClone(points)},history:scope("market-history",source.benchmark.points.length,points.length)};
    }else if(key==="externalSector") {const source=value as ExternalSector,points=source.points.slice(-37);data.externalSector={...structuredClone(source),points:structuredClone(points),history:scope("external-history",source.points.length,points.length)};
    }else if(key==="balancePayments") {const source=value as BalancePayments,quarters=source.quarters.slice(-12);data.balancePayments={...structuredClone(source),quarters:structuredClone(quarters),history:scope("bop-history",source.quarters.length,quarters.length)};
    }else if(key==="economicStructure") {const source=value as EconomicStructure,years=source.years.slice(-5);data.economicStructure={...structuredClone(source),years:structuredClone(years),availableYears:source.years.map(y=>y.year),history:scope("gdp-years",source.years.length,years.length)};
    }else if(key==="growthDrivers") {const source=value as GrowthDrivers,production=source.production,years=production.years.slice(-5);data.growthDrivers={...structuredClone(source),production:{...production,years:structuredClone(years),availableYears:production.years.map(y=>y.year),history:scope("gdp-years",production.years.length,years.length)},demand:{...source.demand,years:structuredClone(source.demand.years.slice(-5))}};
    }else if(key==="macroTimeline") {const source=payload.macroTimeline!;data.macroTimeline={...structuredClone(source),entries:structuredClone(source.entries.slice(-20))};ref("timeline-history",source.entries.length);
    }else data[key]=structuredClone(value);
  }
  return data as DashboardViewPayload<S>;
}
function date(value:string|null):value is string {if(!value||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const d=new Date(`${value}T00:00:00Z`);return Number.isFinite(d.valueOf())&&d.toISOString().slice(0,10)===value;}
export function parseHistoryRequest(url:URL):HistoryRequest {
  const view=url.searchParams.get("view"),id=url.searchParams.get("id"),artifactId=url.searchParams.get("artifactId"),range=url.searchParams.get("range")??"ALL";
  const validId=isHistoryId(id);
  if(!isDashboardView(view)||!validId||!artifactId||!/^[a-f0-9]{64}$/.test(artifactId)||!["ALL","1Y","3Y","5Y","10Y","CUSTOM"].includes(range))throw new DashboardProjectionError(400,"Invalid view, history ID, range or artifact identity.");
  const start=url.searchParams.get("start"),end=url.searchParams.get("end");
  if(range==="CUSTOM"&&(!date(start)||!date(end)||start>end))throw new DashboardProjectionError(400,"Custom dates must be valid and ordered.");
  if(range!=="CUSTOM"&&(start||end))throw new DashboardProjectionError(400,"Dates require the CUSTOM range.");
  if(["forecast-audit","regional-districts","gdp-years"].includes(id!)&&range!=="ALL")throw new DashboardProjectionError(400,"This structured history requires the ALL range.");
  return {view,id:id as HistoryId,artifactId,range:range as HistoryRange,...(start&&end?{start,end}:{})};
}
function filtered<T extends {date:string}>(rows:T[],request:HistoryRequest):T[]{
  if(request.range==="ALL")return structuredClone(rows);
  if(request.range==="CUSTOM")return structuredClone(rows.filter(r=>r.date>=request.start!&&r.date<=request.end!));
  if(!rows.length)return [];
  const last=new Date(`${rows.at(-1)!.date}T00:00:00Z`),years=Number(request.range.slice(0,-1));
  const targetYear=last.getUTCFullYear()-years,targetMonth=last.getUTCMonth();
  const lastDay=new Date(Date.UTC(targetYear,targetMonth+1,0)).getUTCDate();
  const cutoff=new Date(Date.UTC(targetYear,targetMonth,Math.min(last.getUTCDate(),lastDay)));
  return structuredClone(rows.filter(r=>new Date(`${r.date}T00:00:00Z`)>=cutoff));
}
export async function projectDashboardHistory(payload:DashboardPayload,request:HistoryRequest):Promise<DashboardHistoryPayload> {
  const view=await projectDashboard(payload,request.view);
  if(request.artifactId!==view.artifactId)throw new DashboardProjectionError(409,"The dashboard artifact changed. Refresh this page before loading history; old and new data are not mixed.");
  if(!view.deferred[request.id]?.available)throw new DashboardProjectionError(400,"This history is unavailable or does not belong to this view.");
  let data:unknown,totalRows=0,returnedRows=0,start:string|null=null,end:string|null=null;
  const use=<T extends {date:string}>(rows:T[])=>{totalRows=rows.length;const selected=filtered(rows,request);returnedRows=selected.length;start=selected[0]?.date??null;end=selected.at(-1)?.date??null;return selected;};
  if(request.id.startsWith("indicator:")){const source=payload.series[request.id.slice(10)];data={...structuredClone(source),points:use(source.points)};
  }else if(request.id==="forecast-audit"){data=structuredClone(payload.forecast.evaluation);totalRows=returnedRows=payload.forecast.evaluation!.windows.length;
  }else if(request.id==="regional-districts"){const source=payload.regionalLens!;data={districtRecords:structuredClone(source.districtRecords),districtLabourRecords:structuredClone(source.districtLabourRecords),districtGdpRecords:structuredClone(source.districtGdpRecords)};totalRows=returnedRows=districtRowCount(source);
  }else if(request.id==="market-history"){const source=payload.market!;data={...structuredClone(source),benchmark:{...source.benchmark,points:use(source.benchmark.points)}};
  }else if(request.id==="external-history"){const source=payload.externalSector!;data={...structuredClone(source),points:use(source.points)};
  }else if(request.id==="bop-history"){const source=payload.balancePayments!;data={...structuredClone(source),quarters:use(source.quarters)};
  }else if(request.id==="gdp-years"){data={economicStructure:structuredClone(payload.economicStructure),growthDrivers:structuredClone(payload.growthDrivers)};totalRows=returnedRows=payload.economicStructure?.years.length??0;
  }else {const source=payload.macroTimeline!;data={...structuredClone(source),entries:use(source.entries)};}
  return {projectionVersion:1,artifactId:view.artifactId,view:request.view,id:request.id,schemaVersion:payload.schemaVersion,generatedAt:payload.generatedAt,usingFallback:payload.usingFallback,
    scope:{complete:request.range==="ALL",range:request.range,totalRows,returnedRows,start,end},data:data as HistoryDataMap[HistoryId]};
}
