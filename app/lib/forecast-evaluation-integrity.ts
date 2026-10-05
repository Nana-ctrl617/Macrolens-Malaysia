// Optional audit checks: absence preserves legacy payloads; presence fails closed.
type Row = Record<string, any>;
type AuditPoint = { horizon: number; date:string; actual: number; predicted: number; error:number; low80:number; high80:number; low95:number; high95:number; covered80: boolean; covered95: boolean };
const object = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const integer = (value: unknown): value is number => finite(value) && Number.isInteger(value) && value >= 0;
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const close = (left: unknown, right: number, tolerance = 0.00000101) => finite(left) && Math.abs(left - right) <= tolerance;
const same = (left: unknown, right: string[]) => Array.isArray(left) && left.length === right.length && left.every((value, i) => value === right[i]);

function month(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-01$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function nextMonths(origin: string): string[] {
  const date = new Date(`${origin}T00:00:00Z`);
  return [1, 2, 3].map(step => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + step, 1)).toISOString().slice(0, 10));
}

function namedRows(value: unknown, names: string[]): Map<string, Row> | null {
  if (!Array.isArray(value) || value.length !== names.length) return null;
  const rows = new Map<string, Row>();
  for (const row of value) {
    if (!object(row) || !names.includes(row.name) || rows.has(row.name)) return null;
    rows.set(row.name, row);
  }
  return rows;
}

function validCoverage(row: Row, points: AuditPoint[]): boolean {
  for (const level of [80, 95] as const) {
    const covered = points.filter(point => level === 80 ? point.covered80 : point.covered95).length;
    const numerator = row[`covered${level}`], denominator = row[`total${level}`], rate = row[`coverage${level}`];
    if (!integer(numerator) || !integer(denominator) || numerator !== covered || denominator !== points.length) return false;
    if (points.length === 0 ? rate !== null : !finite(rate) || rate < 0 || rate > 1 || !close(rate, covered / points.length)) return false;
  }
  for(const level of [80,95] as const){
    const key=`meanWidth${level}`,value=row[key];
    if(value!==undefined){const width=points.length?points.reduce((sum,point)=>sum+point[`high${level}`]-point[`low${level}`],0)/points.length:null;if(width===null?value!==null:!finite(value)||value<0||!close(value,width,0.0000011))return false;}
  }
  return true;
}

function expectedRecalibratedBand(errors:number[],nominal:80|95,predicted:number):[number|null,number|null]{
  const sorted=[...errors].sort((left,right)=>left-right),rank=Math.ceil((sorted.length+1)*nominal/100);
  if(!sorted.length||rank>sorted.length)return[null,null];
  const radius=sorted[rank-1];return[Math.round((predicted-radius)*1e6)/1e6,Math.round((predicted+radius)*1e6)/1e6];
}
const sameNullableNumber=(actual:unknown,expected:number|null)=>expected===null?actual===null:close(actual,expected,0.0000011);

function validCalibrationComparison(row:Row,points:Row[],level:80|95):boolean{
  const low=`low${level}`,high=`high${level}`;
  const adjusted=points.filter(point=>point.recalibrated?.[low]!==null&&point.recalibrated?.[high]!==null);
  const count=adjusted.length,coverage=count?adjusted.filter(point=>point.recalibrated[low]<=point.actual&&point.actual<=point.recalibrated[high]).length/count:null;
  const width=count?adjusted.reduce((sum,point)=>sum+point.recalibrated[high]-point.recalibrated[low],0)/count:null;
  if(row.evaluationPoints!==points.length||row.unavailableCalibrationPoints!==points.length-count)return false;
  for(const [name,selected] of [["uncalibrated",points],["recalibrated",adjusted]] as const){
    const value=row[name];if(!object(value))return false;
    const n=selected.length,c= n?selected.filter(point=>{
      const lo=name==="uncalibrated"?point[low]:point.recalibrated[low],hi=name==="uncalibrated"?point[high]:point.recalibrated[high];
      return lo<=point.actual&&point.actual<=hi;
    }).length/n:null;
    const w=n?selected.reduce((sum,point)=>sum+(name==="uncalibrated"?point[high]-point[low]:point.recalibrated[high]-point.recalibrated[low]),0)/n:null;
    if(value.count!==n|| (c===null?value.coverage!==null:!close(value.coverage,c)) || (w===null?value.meanWidth!==null:!close(value.meanWidth,w,0.0000011)))return false;
  }
  return count===adjusted.length&&((coverage===null&&row.recalibrated.coverage===null)||(coverage!==null&&close(row.recalibrated.coverage,coverage)))&&((width===null&&row.recalibrated.meanWidth===null)||(width!==null&&close(row.recalibrated.meanWidth,width,0.0000011)));
}

/** Receives the dashboard so audit actuals can be checked against its official CPI observations. */
export function validateForecastEvaluationIntegrity(raw: unknown): boolean {
  try {
    if (!object(raw) || !object(raw.forecast)) return false;
    const forecast = raw.forecast;
    if (forecast.evaluation === undefined) return true;
    const evaluation = forecast.evaluation;
    if (!object(evaluation) || !text(evaluation.method) || evaluation.horizonMonths !== 3) return false;
    if (!Array.isArray(evaluation.caveats) || !evaluation.caveats.every(text)) return false;
    if (!Array.isArray(evaluation.origins) || evaluation.origins.length === 0 || evaluation.origins.length > 36) return false;
    const origins: string[] = evaluation.origins;
    if (!origins.every((origin, i) => month(origin) && (i === 0 || origin > origins[i - 1]))) return false;
    if (!Array.isArray(evaluation.windows) || evaluation.windows.length !== origins.length || forecast.backtestWindows !== origins.length) return false;

    if (!Array.isArray(forecast.models) || forecast.models.length === 0) return false;
    const names: string[] = forecast.models.map((row: Row) => row?.name);
    if (!names.every(text) || new Set(names).size !== names.length) return false;
    const summaries = namedRows(forecast.models, names);
    const eligibility = namedRows(evaluation.candidateEligibility, names);
    const coverage = namedRows(evaluation.coverage, names);
    if (!summaries || !eligibility || !coverage) return false;

    const headline = raw.series?.headline?.points;
    if (!Array.isArray(headline) || headline.length === 0) return false;
    const actuals = new Map<string, number>();
    let lastObservation = '';
    for (const point of headline) {
      if (!object(point) || !month(point.date) || !finite(point.value) || point.date <= lastObservation) return false;
      actuals.set(point.date, point.value);
      lastObservation = point.date;
    }
    const points = new Map<string, AuditPoint[]>(names.map(name => [name, []]));
    const failedOrigins = new Map<string, string[]>(names.map(name => [name, []]));

    for (const [index, window] of evaluation.windows.entries()) {
      if (!object(window) || window.origin !== origins[index] || window.trainingEnd !== window.origin) return false;
      if(evaluation.calibrationExperiment!==undefined&&window.evaluationPhase!==(index<evaluation.calibrationExperiment.warmupOrigins?.length?'calibration-warmup':'held-out-evaluation'))return false;
      if (!month(window.trainingStart) || window.trainingStart > window.trainingEnd || !actuals.has(window.trainingStart) || !actuals.has(window.trainingEnd)) return false;
      const trainCount = [...actuals.keys()].filter(date => date >= window.trainingStart && date <= window.trainingEnd).length;
      if (!integer(window.trainingObservations) || window.trainingObservations < 36 || window.trainingObservations !== trainCount) return false;
      const targets = nextMonths(window.origin);
      if (!same(window.targets, targets) || targets.at(-1)! > lastObservation) return false;
      const modelRows = namedRows(window.models, names);
      if (!modelRows) return false;
      for (const name of names) {
        const model = modelRows.get(name)!;
        // No baseline substitution may be attributed to a failed candidate.
        if (model.fallbackModel !== null || !Array.isArray(model.points)) return false;
        if (model.status === 'failed') {
          if (!text(model.failureReason) || model.points.length !== 0) return false;
          failedOrigins.get(name)!.push(window.origin);
          continue;
        }
        if (model.status !== 'success' || model.failureReason !== null || model.points.length !== 3) return false;
        for (const [step, point] of model.points.entries()) {
          if (!object(point) || point.horizon !== step + 1 || point.date !== targets[step]) return false;
          if (!['actual', 'predicted', 'error', 'low80', 'high80', 'low95', 'high95'].every(key => finite(point[key]))) return false;
          const observed = actuals.get(point.date);
          if (observed === undefined || !close(point.actual, observed) || !close(point.error, point.predicted - point.actual)) return false;
          if (!(point.low95 <= point.low80 && point.low80 <= point.predicted && point.predicted <= point.high80 && point.high80 <= point.high95)) return false;
          if (typeof point.covered80 !== 'boolean' || typeof point.covered95 !== 'boolean') return false;
          if (point.covered80 !== (point.low80 <= point.actual && point.actual <= point.high80) || point.covered95 !== (point.low95 <= point.actual && point.actual <= point.high95)) return false;
          if(evaluation.calibrationExperiment!==undefined){
            const adjusted=point.recalibrated;
            if(!object(adjusted)||!integer(adjusted.calibrationCount)||!Array.isArray(adjusted.calibrationTargets)||adjusted.calibrationCount!==adjusted.calibrationTargets.length)return false;
            const warmup=index<evaluation.calibrationExperiment.warmupOrigins.length;
            if(warmup){if(adjusted.calibrationCount!==0||adjusted.calibrationTargets.length||![adjusted.low80,adjusted.high80,adjusted.low95,adjusted.high95].every(value=>value===null))return false;}
            else {
              const prior=evaluation.windows.slice(0,index).flatMap((earlier:Row)=>{
                const row=earlier.models?.find((candidate:Row)=>candidate.name===name&&candidate.status==='success');
                return (row?.points??[]).filter((candidate:Row)=>candidate.horizon===point.horizon&&candidate.date<window.origin);
              });
              const dates=prior.map((candidate:Row)=>candidate.date),errors=prior.map((candidate:Row)=>Math.abs(candidate.error));
              if(!same(adjusted.calibrationTargets,dates)||dates.some((value:string,i:number)=>!month(value)||value>=window.origin||(i>0&&value<=dates[i-1])))return false;
              const expected80=expectedRecalibratedBand(errors,80,point.predicted),expected95=expectedRecalibratedBand(errors,95,point.predicted);
              let radius95=expected95[0]===null?null:Math.max(point.predicted-expected95[0],expected80[0]===null?0:point.predicted-expected80[0]);
              const bounds95: [number|null,number|null]=radius95===null?[null,null]:[Math.round((point.predicted-radius95)*1e6)/1e6,Math.round((point.predicted+radius95)*1e6)/1e6];
              if(adjusted.calibrationCount!==prior.length||!sameNullableNumber(adjusted.low80,expected80[0])||!sameNullableNumber(adjusted.high80,expected80[1])||!sameNullableNumber(adjusted.low95,bounds95[0])||!sameNullableNumber(adjusted.high95,bounds95[1]))return false;
              if(adjusted.low80!==null&&adjusted.low95!==null&&!(adjusted.low95<=adjusted.low80&&adjusted.low80<=point.predicted&&point.predicted<=adjusted.high80&&adjusted.high80<=adjusted.high95))return false;
            }
          }
          points.get(name)!.push(point as AuditPoint);
        }
      }
    }

    for (const name of names) {
      const errors = points.get(name)!;
      const failures = failedOrigins.get(name)!;
      const candidate = eligibility.get(name)!;
      const summary = summaries.get(name)!;
      const measured = coverage.get(name)!;
      const eligible = failures.length === 0 && errors.length === 3 * origins.length;
      if (candidate.eligible !== eligible || !same(candidate.origins, origins) || !same(candidate.failedOrigins, failures)) return false;
      if (!integer(candidate.successfulWindows) || !integer(candidate.failedWindows) || candidate.successfulWindows !== origins.length - failures.length || candidate.failedWindows !== failures.length) return false;
      if (summary.eligible !== eligible || typeof summary.selected !== 'boolean') return false;
      if (summary.successfulWindows !== undefined && summary.successfulWindows !== candidate.successfulWindows) return false;
      if (summary.failedWindows !== undefined && summary.failedWindows !== candidate.failedWindows) return false;
      if (summary.fallbackCount !== undefined && summary.fallbackCount !== 0) return false;
      if(summary.metricsByHorizon!==undefined){
        if(!Array.isArray(summary.metricsByHorizon)||summary.metricsByHorizon.length!==3)return false;
        for(const [step,row] of summary.metricsByHorizon.entries()){
          const selected=errors.filter(point=>point.horizon===step+1),differences=selected.map(point=>point.error);
          const rmse=selected.length?Math.sqrt(differences.reduce((sum,error)=>sum+error*error,0)/selected.length):null;
          const mae=selected.length?differences.reduce((sum,error)=>sum+Math.abs(error),0)/selected.length:null;
          if(!object(row)||row.horizon!==step+1||row.count!==selected.length||(rmse===null?row.rmse!==null||row.mae!==null:!close(row.rmse,rmse,0.000051)||!close(row.mae,mae!,0.000051)))return false;
        }
      }
      if (errors.length === 0) {
        if (summary.rmse !== null || summary.mae !== null) return false;
      } else {
        const differences = errors.map(point => point.predicted - point.actual);
        const rmse = Math.sqrt(differences.reduce((sum, error) => sum + error * error, 0) / errors.length);
        const mae = differences.reduce((sum, error) => sum + Math.abs(error), 0) / errors.length;
        // Published error metrics have four decimal places, audit points six.
        if (!close(summary.rmse, rmse, 0.000051) || !close(summary.mae, mae, 0.000051) || summary.rmse < 0 || summary.mae < 0) return false;
      }
      if (measured.eligible !== eligible || !validCoverage(measured, errors)) return false;
      if (measured.byHorizon !== undefined) {
        if (!Array.isArray(measured.byHorizon) || measured.byHorizon.length !== 3) return false;
        for (const [step, row] of measured.byHorizon.entries()) {
          if (!object(row) || row.horizon !== step + 1 || !validCoverage(row, errors.filter(point => point.horizon === step + 1))) return false;
        }
      }
    }

    const recalibration=evaluation.calibrationExperiment;
    if(recalibration!==undefined){
      if(!object(recalibration)||!['experimental','insufficient-evaluation-history'].includes(recalibration.status)||!text(recalibration.method)||!text(recalibration.minimumSampleRule)||!text(recalibration.warning)||!Array.isArray(recalibration.warmupOrigins)||!Array.isArray(recalibration.evaluationOrigins))return false;
      const warmupCount=Math.min(12,origins.length);
      if(!same(recalibration.warmupOrigins,origins.slice(0,warmupCount))||!same(recalibration.evaluationOrigins,origins.slice(warmupCount))||recalibration.status!==(recalibration.evaluationOrigins.length?'experimental':'insufficient-evaluation-history'))return false;
      if(evaluation.originPolicy!==undefined&&!text(evaluation.originPolicy))return false;
      if(!Array.isArray(recalibration.byModelHorizon)||recalibration.byModelHorizon.length!==names.length*6)return false;
      const seen=new Set<string>();
      for(const row of recalibration.byModelHorizon){
        if(!object(row)||!names.includes(row.model)||![1,2,3].includes(row.horizon)||![80,95].includes(row.nominalCoverage))return false;
        const key=`${row.model}:${row.horizon}:${row.nominalCoverage}`;if(seen.has(key))return false;seen.add(key);
        const points=evaluation.windows.slice(warmupCount).flatMap((window:Row)=>{
          const candidate=window.models?.find((item:Row)=>item.name===row.model&&item.status==='success');
          return (candidate?.points??[]).filter((point:Row)=>point.horizon===row.horizon);
        });
        if(!validCalibrationComparison(row,points,row.nominalCoverage))return false;
      }
    }

    const finalFit = evaluation.finalFit;
    const selected = forecast.models.filter((row: Row) => row.selected);
    if (!object(finalFit) || typeof finalFit.fallbackUsed !== 'boolean' || selected.length !== 1) return false;
    if (selected[0].name !== forecast.selectedModel || finalFit.usedModel !== forecast.selectedModel || !summaries.has(finalFit.requestedModel)) return false;
    if (eligibility.get(finalFit.usedModel)?.eligible !== true || eligibility.get(finalFit.requestedModel)?.eligible !== true) return false;
    const ranked = forecast.models.filter((row: Row) => row.eligible).sort((left: Row, right: Row) => left.rmse - right.rmse || left.mae - right.mae || names.indexOf(left.name) - names.indexOf(right.name));
    if (ranked[0]?.name !== finalFit.requestedModel) return false;
    if (finalFit.fallbackUsed) {
      if (finalFit.usedModel !== 'Seasonal naive' || finalFit.requestedModel === finalFit.usedModel || !text(finalFit.failureReason)) return false;
    } else if (finalFit.requestedModel !== finalFit.usedModel || finalFit.failureReason !== null) return false;
    if (evaluation.fallbackCount !== undefined && evaluation.fallbackCount !== Number(finalFit.fallbackUsed)) return false;

    if (evaluation.scenarioFit !== undefined) {
      const scenarioFit = evaluation.scenarioFit;
      if (!object(scenarioFit)) return false;
      if (scenarioFit.status === 'success') {
        if (scenarioFit.failureReason !== null || !object(forecast.scenario)) return false;
      } else if (scenarioFit.status === 'failed') {
        if (!text(scenarioFit.failureReason) || forecast.scenario != null) return false;
      } else return false;
    }
    if (forecast.scenario != null) {
      if (!object(forecast.scenario) || !['core', 'fx', 'opr'].every(key => finite(forecast.scenario.baseline?.[key]) && finite(forecast.scenario.coefficients?.[key]))) return false;
    }
    return true;
  } catch { return false; }
}
