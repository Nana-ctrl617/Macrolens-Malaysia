import {getDashboard} from '@/app/lib/dashboard';
export async function GET(request:Request) {
  const payload = await getDashboard();
  const evaluation = payload.forecast.evaluation;
  if (!evaluation) return Response.json({error:'Per-origin evaluation is not available in this saved data version.'},{status:404});
  const format = new URL(request.url).searchParams.get('format') ?? 'json';
  const metadata = {method:payload.forecast.methodLabel,calculatedAt:payload.forecast.calculatedAt,status:payload.forecast.status,inputHealth:payload.inputHealth?.forecast,usingFallback:payload.usingFallback,evaluation};
  if(format==='json')return new Response(JSON.stringify(metadata,null,2),{headers:{'Content-Type':'application/json; charset=utf-8','Content-Disposition':'attachment; filename=forecast-evaluation.json'}});
  if(format!=='csv')return Response.json({error:'Use format=csv or format=json'},{status:400});
  const headings=['origin','evaluation_phase','target_date','horizon_months','model','fit_status','actual','predicted','error_pp','low80','high80','low95','high95','covered80','covered95','calibration_count','calibration_target_months','recalibrated_low80','recalibrated_high80','recalibrated_low95','recalibrated_high95','failure_reason','method','calculated_at','data_status'];
  const rows=evaluation.windows.flatMap(window=>window.models.flatMap(model=>window.targets.map((date,i)=>{
    const p=model.points.find(point=>point.date===date);
    const calibrated=p?.recalibrated;
    return [window.origin,window.evaluationPhase,date,i+1,model.name,model.status,p?.actual,p?.predicted,p?.error,p?.low80,p?.high80,p?.low95,p?.high95,p?.covered80,p?.covered95,calibrated?.calibrationCount,calibrated?.calibrationTargets?.join('|'),calibrated?.low80,calibrated?.high80,calibrated?.low95,calibrated?.high95,model.failureReason,payload.forecast.methodLabel,payload.forecast.calculatedAt,payload.usingFallback?'fallback':payload.inputHealth?.forecast?.status??payload.forecast.status];
  })));
  const escape=(value:unknown)=>{const text=value==null?'':String(value);return /[",\n\r]/.test(text)?`"${text.replaceAll('"','""')}"`:text;};
  return new Response([headings,...rows].map(row=>row.map(escape).join(',')).join('\n')+'\n',{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename=forecast-evaluation.csv'}});
}
