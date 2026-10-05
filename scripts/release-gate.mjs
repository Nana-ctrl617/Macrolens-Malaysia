import {spawn} from 'node:child_process';
import {createHash,createHmac,randomBytes} from 'node:crypto';
import {createWriteStream} from 'node:fs';
import {chmod,mkdir,readFile,rename,unlink,writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {dirname,join,relative,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {buildFingerprint,payloadFingerprint,sourceFingerprint,releaseFingerprint} from './release-fingerprint.mjs';

export const REQUIRED_STAGES=Object.freeze(['payload','python-unit','node-unit','typecheck','production-build','rendered','playwright','chart-browser','deferred-browser']);
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const BASE='http://127.0.0.1:4185';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function createReleaseStages({node=process.execPath,python='python',pnpm=process.platform==='win32'?'pnpm.cmd':'pnpm'}={}){
  return [
    {name:'payload',command:node,args:['scripts/validate-published.mjs'],timeoutMs:60000},
    {name:'python-unit',command:python,args:['-m','pytest','pipeline/tests','-q'],timeoutMs:1200000},
    {name:'node-unit',command:pnpm,args:['run','test:unit'],timeoutMs:600000},
    {name:'typecheck',command:pnpm,args:['run','typecheck:app'],timeoutMs:300000},
    {name:'production-build',command:pnpm,args:['run','build'],timeoutMs:600000},
    {name:'rendered',command:pnpm,args:['run','test:web'],timeoutMs:300000},
    {name:'playwright',command:pnpm,args:['exec','playwright','test'],timeoutMs:1200000},
    {name:'chart-browser',command:node,args:['scripts/chart-browser-check.mjs'],timeoutMs:1200000},
    {name:'deferred-browser',command:node,args:['scripts/deferred-browser-check.mjs'],timeoutMs:600000},
  ];
}
export function releaseEnvironment(base=process.env,root=ROOT){
  const env={...base};
  for(const key of Object.keys(env))if(/^(?:CHART_(?:ROUTES|PROFILES)|PLAYWRIGHT_MODULE|PYTEST_ADDOPTS|PYTEST_PLUGINS|PYTHONPATH|PYTHONSTARTUP|NODE_OPTIONS|NODE_V8_COVERAGE|PW_TEST_GREP|PW_TEST_ONLY|RELEASE_SKIP_.*)$/.test(key))delete env[key];
  if(env.PLAYWRIGHT_INJECT_FAILURE!=='1')delete env.PLAYWRIGHT_INJECT_FAILURE;
  return {...env,CI:'1',PLAYWRIGHT_EXTERNAL_SERVER:'1',DASHBOARD_BASE_URL:BASE,DASHBOARD_DATA_URL:'http://127.0.0.1:9/dashboard.json',WRANGLER_WRITE_LOGS:'false',WRANGLER_LOG_PATH:join(root,'.wrangler/logs')};
}
/** Testable sequence only; this helper cannot write or sign a release receipt. */
export async function runRequiredStages(stages,execute,onPassed=async()=>{}){
  if(!Array.isArray(stages)||stages.length!==REQUIRED_STAGES.length||stages.some((stage,index)=>stage.name!==REQUIRED_STAGES[index]))throw Error('Required release stage manifest is incomplete or out of order.');
  const records=[];
  for(const stage of stages){
    const record=await execute(stage);if(record.exitCode!==0||record.signal)throw Error(`Required stage ${stage.name} failed${record.exitCode===undefined?'':` (exit ${record.exitCode})`}.`);
    records.push({...record,name:stage.name,status:'passed'});await onPassed(stage);
  }
  return records;
}
function nativeInvocation(command,args){
  if(process.platform!=='win32'||! /\.(?:cmd|bat)$/i.test(command))return {command,args};
  // Only fixed arguments and executable paths reach cmd.exe, never shell text.
  const quote=value=>{if(/[\r\n"&|<>^%!]/.test(value))throw Error('Unsafe characters in native Windows command argument.');return `"${value}"`;};
  return {command:process.env.ComSpec||'cmd.exe',args:['/d','/s','/c',`"${[command.replaceAll('/','\\'),...args].map(quote).join(' ')}"`],windowsVerbatimArguments:true};
}
function startProcess(command,args,root,env){
  const launch=nativeInvocation(command,args);
  return spawn(launch.command,launch.args,{cwd:root,env,stdio:['ignore','pipe','pipe'],windowsHide:true,windowsVerbatimArguments:launch.windowsVerbatimArguments??false,detached:process.platform!=='win32'});
}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function stopOwnedProcess(child){
  if(!child?.pid||child.exitCode!==null||child.signalCode!==null)return;
  if(process.platform==='win32'){
    const kill=force=>new Promise(resolve=>{const killer=spawn('taskkill.exe',['/PID',String(child.pid),'/T',...(force?['/F']:[])],{stdio:'ignore',windowsHide:true});const timer=setTimeout(()=>{killer.kill();resolve();},5000);const done=()=>{clearTimeout(timer);resolve();};killer.on('error',done);killer.on('close',done);});
    await kill(false);await delay(1000);if(child.exitCode===null&&child.signalCode===null)await kill(true);
  }else{
    try{process.kill(-child.pid,'SIGTERM');}catch{}
    await delay(1000);if(child.exitCode===null&&child.signalCode===null)try{process.kill(-child.pid,'SIGKILL');}catch{}
  }
  for(let attempt=0;attempt<20&&child.exitCode===null&&child.signalCode===null;attempt++)await delay(100);
  if(child.exitCode===null&&child.signalCode===null){
    // Permission failure must not leave the gate waiting forever or pretend the
    // owned preview was stopped. The attempt fails and reports its own PID.
    child.unref();child.stdout?.destroy();child.stderr?.destroy();
    throw Error(`Owned test process ${child.pid} could not be stopped; release is blocked and cleanup is required.`);
  }
}
export async function executeReleaseStage(stage,root,env,logDir){
  const started=Date.now(),startedAt=new Date(started).toISOString(),logPath=join(logDir,`${stage.name}.log`),log=createWriteStream(logPath,{flags:'w'});
  const child=startProcess(stage.command,stage.args,root,env);
  child.stdout.on('data',bytes=>{log.write(bytes);process.stdout.write(bytes);});child.stderr.on('data',bytes=>{log.write(bytes);process.stderr.write(bytes);});
  let timedOut=false;
  let rejectDeadline;const expired=new Promise((_resolve,reject)=>{rejectDeadline=reject;});
  const timer=setTimeout(()=>{timedOut=true;rejectDeadline(Error(`Required stage ${stage.name} timed out.`));},stage.timeoutMs);
  try{
    const completion=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',(exitCode,signal)=>resolve({exitCode,signal}));log.on('error',reject);});
    const result=await Promise.race([completion,expired]);
    await new Promise((resolve,reject)=>{log.on('error',reject);log.end(resolve);});
    if(timedOut)throw Error(`Required stage ${stage.name} timed out.`);
    return {...result,command:stage.command,args:stage.args,startedAt,completedAt:new Date().toISOString(),durationMs:Date.now()-started,log:relative(root,logPath).replaceAll('\\','/'),logHash:sha(await readFile(logPath))};
  }finally{clearTimeout(timer);if(!log.writableEnded)log.end();await stopOwnedProcess(child);}
}
async function requireUnusedPort(){
  await new Promise((resolve,reject)=>{const server=createServer();server.once('error',()=>reject(Error('Port4185 is occupied. Stop the unrelated preview; the release gate never reuses it.')));server.listen(4185,'127.0.0.1',()=>server.close(resolve));});
}
async function startWorker(pnpm,root,env,logDir){
  await requireUnusedPort();const log=createWriteStream(join(logDir,'worker.log'),{flags:'w'});
  const child=startProcess(pnpm,['exec','wrangler','dev','--config','dist/server/wrangler.json','--ip','127.0.0.1','--port','4185','--local','--var','DASHBOARD_DATA_URL:http://127.0.0.1:9/dashboard.json'],root,env);
  let launchError;child.on('error',error=>{launchError=error;});child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
  const stop=async()=>{await stopOwnedProcess(child);await new Promise(resolve=>log.end(resolve));};
  const until=Date.now()+120000;
  try{
    while(Date.now()<until){
      if(launchError)throw launchError;if(child.exitCode!==null||child.signalCode!==null)throw Error('Owned production Worker exited before becoming ready.');
      try{const response=await fetch(BASE,{signal:AbortSignal.timeout(3000)});if(response.ok)return {child,stop};}catch{}
      await delay(250);
    }
    throw Error('Owned production Worker did not become ready within120seconds.');
  }catch(error){await stop();throw error;}
}
async function removeIfExists(path){try{await unlink(path);}catch(error){if(error.code!=='ENOENT')throw error;}}
async function main(){
  const root=ROOT,output=join(root,'outputs'),logDir=join(output,'release-gate-logs'),receiptPath=join(output,'release-gate.json'),keyPath=join(output,'.release-gate-key');
  await mkdir(logDir,{recursive:true});await removeIfExists(receiptPath);await removeIfExists(keyPath);
  const startedAt=new Date().toISOString(),env=releaseEnvironment(process.env,root),pnpm=process.env.PNPM_EXE||(process.platform==='win32'?'pnpm.cmd':'pnpm'),python=process.env.PYTHON_EXE||'python';
  let worker,buildBeforeBrowser;
  try{
    if(process.argv.length>2)throw Error('Usage: node scripts/release-gate.mjs (no skip flags).');
    const initialSource=await sourceFingerprint(root),initialPayload=await payloadFingerprint(root);
    const stages=await runRequiredStages(createReleaseStages({python,pnpm}),stage=>executeReleaseStage(stage,root,env,logDir),async stage=>{if(stage.name==='production-build'){buildBeforeBrowser=await buildFingerprint(root);worker=await startWorker(pnpm,root,env,logDir);}});
    if(env.PLAYWRIGHT_INJECT_FAILURE==='1')throw Error('Negative browser assertion control cannot produce a success receipt.');
    await worker.stop();worker=undefined;
    const fingerprint=await releaseFingerprint(root);
    if(fingerprint.sourceHash!==initialSource.hash||fingerprint.payloadHash!==initialPayload.hash)throw Error('Source or payload changed during the gate. Re-run against frozen files.');
    if(fingerprint.buildHash!==buildBeforeBrowser.hash)throw Error('Production build changed during browser testing.');
    const receipt={schemaVersion:1,status:'passed',root,startedAt,completedAt:new Date().toISOString(),negativeControl:false,runner:{node:process.version,platform:process.platform,arch:process.arch},server:{origin:BASE,owned:true,configuration:'dist/server/wrangler.json'},fingerprint,stages};
    const key=randomBytes(32);await writeFile(keyPath,key.toString('hex'),{mode:0o600});if(process.platform!=='win32')await chmod(keyPath,0o600);
    receipt.signature=createHmac('sha256',key).update(JSON.stringify(receipt)).digest('hex');
    const temporary=`${receiptPath}.tmp`;await writeFile(temporary,JSON.stringify(receipt,null,2)+'\n');await rename(temporary,receiptPath);await removeIfExists(join(output,'release-gate-failure.json'));
    console.log(`Release gate passed: ${receiptPath}`);
  }catch(error){
    await removeIfExists(receiptPath);await removeIfExists(keyPath);
    await writeFile(join(output,'release-gate-failure.json'),JSON.stringify({schemaVersion:1,status:'failed',startedAt,completedAt:new Date().toISOString(),error:error.message},null,2)+'\n');throw error;
  }finally{if(worker)await worker.stop();}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  try{await main();}catch(error){console.error(`Release blocked: ${error.message}`);process.exitCode=1;}
}
