import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import ts from 'typescript';
import {projectDashboard} from '../app/lib/dashboard-projection.ts';

const require=createRequire(import.meta.url);
const state={dashboard:null,error:'',loading:false};
globalThis.__dashboardRenderState=state;

// Inject controlled initial Shell state without depending on unrelated view hook order.
// Every rendered branch and child is still the production React implementation.
function withShellState(filename, source){
 if(!filename.endsWith('DashboardShell.tsx'))return source;
 const file=ts.createSourceFile(filename,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const fields={dashboard:'dashboard',dashboardError:'error',dashboardLoading:'loading'};
 const edits=[];
 const visit=node=>{
  if(ts.isVariableDeclaration(node)&&ts.isArrayBindingPattern(node.name)&&node.initializer&&ts.isCallExpression(node.initializer)){
   const name=node.name.elements[0]?.name?.getText(file),field=fields[name];
   if(field){assert.equal(node.initializer.expression.getText(file),'useState');edits.push([node.initializer.getStart(file),node.initializer.end,`useState(globalThis.__dashboardRenderState.${field})`]);}
  }
  ts.forEachChild(node,visit);
 };
 visit(file);assert.equal(edits.length,3,'Shell has independently controlled data/error/loading state');
 for(const[start,end,text]of edits.sort((a,b)=>b[0]-a[0]))source=source.slice(0,start)+text+source.slice(end);
 return source;
}
const modules=new Map();
async function moduleUrl(filename){
 if(modules.has(filename))return modules.get(filename);
 let output=ts.transpileModule(withShellState(filename,readFileSync(filename,'utf8')),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/import\s+["'][^"']+\.css["'];?\s*/g,'');
 for(const match of [...output.matchAll(/\bimport\s+[^;]+?\bfrom\s+(["'])([^"']+)\1/g)]){
  const specifier=match[2];let target;
  if(specifier.startsWith('@/')||specifier.startsWith('.')){
   const base=specifier.startsWith('@/')?fileURLToPath(new URL(`../${specifier.slice(2)}`,import.meta.url)):fileURLToPath(new URL(specifier,pathToFileURL(filename)));
   const source=[base,`${base}.ts`,`${base}.tsx`].find(existsSync);
   if(!source)throw Error(`Missing dependency ${specifier}`);
   target=await moduleUrl(source);
  }else target=pathToFileURL(require.resolve(specifier)).href;
  output=output.replaceAll(`${match[1]}${specifier}${match[1]}`,JSON.stringify(target));
 }
 const url=`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`;modules.set(filename,url);return url;
}
const Shell=(await import(await moduleUrl(fileURLToPath(new URL('../app/components/DashboardShell.tsx',import.meta.url))))).default;
const views=new Map();
for(const[section,name]of [['snapshot','Snapshot'],['brief','Brief'],['risk','Risk'],['forecast','Forecast'],['drivers','Drivers'],['structure','Structure'],['external','External'],['bop','Bop'],['household','Household'],['regional','Regional'],['sectors','Sectors'],['bursa','Bursa'],['decisions','Decisions'],['timeline','Timeline'],['structural','Structural'],['report','Report'],['health','Health'],['methodology','Methodology']])views.set(section,(await import(await moduleUrl(fileURLToPath(new URL(`../app/views/${name}View.tsx`,import.meta.url))))).default);
function render(section,{data=null,error='',loading=false}={}){
 Object.assign(state,{dashboard:data,error,loading});
 assert.ok(views.has(section),`Render the actual ${section} view`);
 return renderToStaticMarkup(createElement(Shell,{section},createElement(views.get(section))));
}
test('transport failures replace route loading bodies with honest unavailable state',()=>{
 for(const section of views.keys()){
  const html=render(section,{error:'Request failed'});
  assert.match(html,/Economic data is temporarily unavailable/);
  assert.match(html,/role="alert"/);
  assert.match(html,/Retry dashboard/);
  assert.doesNotMatch(html,/Loading validated|Risk screen loading|Loading the latest/);
 }
});

test('every data-backed view renders from its own projected DTO without fetching deferred details',async()=>{
 const source=JSON.parse(readFileSync(new URL('../data/published/dashboard.json',import.meta.url),'utf8'));
 for(const section of views.keys()){
  const html=render(section,{data:await projectDashboard(source,section)});
  assert.equal((html.match(/<h1\b/g)??[]).length,1,`${section} retains one semantic main heading`);
  assert.doesNotMatch(html,/Economic data is temporarily unavailable|NaN|Infinity/,section);
  assert.match(html,/Validated data loaded/);
 }
});
test('validated fallback remains visible and provides explicit retry',async()=>{
 const data=JSON.parse(readFileSync(new URL('../data/published/dashboard.json',import.meta.url),'utf8'));
 data.usingFallback=true;data.health='fallback';
 const html=render('snapshot',{data:await projectDashboard(data,'snapshot')});
 assert.match(html,/Try latest data again/);
 assert.match(html,/Open historical data for Headline inflation/);
 assert.doesNotMatch(html,/Economic data is temporarily unavailable/);
});
test('failed sensitivity fitting never renders invented coefficients or sliders',async()=>{
 const data=JSON.parse(readFileSync(new URL('../data/published/dashboard.json',import.meta.url),'utf8'));
 data.forecast.scenario=null;
 const html=render('forecast',{data:await projectDashboard(data,'forecast')});
 assert.match(html,/Sensitivity analysis is unavailable/);
 assert.doesNotMatch(html,/aria-label="Core inflation change"|aria-label="USD MYR change"|aria-label="OPR change"/);
 assert.match(html,/Historical forecast audit/);
});
