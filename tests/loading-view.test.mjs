import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';

const require=createRequire(import.meta.url);
const state={values:[],cursor:0};
globalThis.__dashboardRenderState=state;
const react=pathToFileURL(require.resolve('react')).href;
const hooks=`data:text/javascript;base64,${Buffer.from(`
export * from ${JSON.stringify(react)};
export const useEffect=()=>{};
export const useId=()=> 'dashboard-state-test';
export const useMemo=fn=>fn();
export const useRef=value=>({current:value});
export const useState=initial=>{
 const state=globalThis.__dashboardRenderState,index=state.cursor++;
 if(!(index in state.values)) state.values[index]=typeof initial==='function'?initial():initial;
 return [state.values[index],value=>{state.values[index]=typeof value==='function'?value(state.values[index]):value;}];
};`).toString('base64')}`;
const modules=new Map();
async function moduleUrl(filename){
 if(modules.has(filename))return modules.get(filename);
 let output=ts.transpileModule(readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/import\s+["'][^"']+\.css["'];?\s*/g,'');
 for(const match of [...output.matchAll(/\bimport\s+[^;]+?\bfrom\s+(["'])([^"']+)\1/g)]){
  const specifier=match[2];let target;
  if(specifier==='react')target=hooks;
  else if(specifier.startsWith('@/')||specifier.startsWith('.')){
   const base=specifier.startsWith('@/')?fileURLToPath(new URL(`../${specifier.slice(2)}`,import.meta.url)):fileURLToPath(new URL(specifier,pathToFileURL(filename)));
   const source=[base,`${base}.ts`,`${base}.tsx`].find(existsSync);
   if(!source)throw Error(`Missing dependency ${specifier}`);
   target=await moduleUrl(source);
  }else target=pathToFileURL(require.resolve(specifier)).href;
  output=output.replaceAll(`${match[1]}${specifier}${match[1]}`,JSON.stringify(target));
 }
 const url=`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`;modules.set(filename,url);return url;
}
const DashboardPage=(await import(await moduleUrl(fileURLToPath(new URL('../app/page.tsx',import.meta.url))))).DashboardPage;
function render(section,{data=null,error='',loading=false}={}){
 state.values=[null,data,error,loading,0];state.cursor=0;
 return renderToStaticMarkup(DashboardPage({section}));
}
test('transport failures replace route loading bodies with honest unavailable state',()=>{
 for(const section of ['snapshot','brief','risk','forecast','regional','health']){
  const html=render(section,{error:'Request failed'});
  assert.match(html,/Economic data is temporarily unavailable/);
  assert.match(html,/role="alert"/);
  assert.match(html,/Retry dashboard/);
  assert.doesNotMatch(html,/Loading validated|Risk screen loading|Loading the latest/);
 }
});
test('validated fallback remains visible and provides explicit retry',()=>{
 const data=JSON.parse(readFileSync(new URL('../data/published/dashboard.json',import.meta.url),'utf8'));
 data.usingFallback=true;data.health='fallback';
 const html=render('snapshot',{data});
 assert.match(html,/Try latest data again/);
 assert.match(html,/Open historical data for Headline inflation/);
 assert.doesNotMatch(html,/Economic data is temporarily unavailable/);
});
test('failed sensitivity fitting never renders invented coefficients or sliders',()=>{
 const data=JSON.parse(readFileSync(new URL('../data/published/dashboard.json',import.meta.url),'utf8'));
 data.forecast.scenario=null;
 const html=render('forecast',{data});
 assert.match(html,/Sensitivity analysis is unavailable/);
 assert.doesNotMatch(html,/aria-label="Core inflation change"|aria-label="USD MYR change"|aria-label="OPR change"/);
 assert.match(html,/Historical forecast audit/);
});
