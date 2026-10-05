import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {createHash,createHmac,randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {releaseFingerprint,sourceFingerprint} from '../scripts/release-fingerprint.mjs';
import {assertReleaseReady,assertFingerprintMatches} from '../scripts/assert-release-ready.mjs';
import {createReleaseStages,REQUIRED_STAGES,releaseEnvironment,runRequiredStages,executeReleaseStage} from '../scripts/release-gate.mjs';

async function fixture(t){
  const prefix=join(tmpdir(),'macrolens-release-test-'),root=await mkdtemp(prefix);
  assert.ok(resolve(root).startsWith(resolve(prefix)));
  t.after(async()=>{assert.ok(resolve(root).startsWith(resolve(prefix)));await rm(root,{recursive:true,force:true});});
  const files={'app/page.tsx':'export default 1','pipeline/example.py':'value = 1','public/logo.svg':'<svg/>','scripts/example.mjs':'export const a=1','tests/example.mjs':'test example','package.json':'{}','pnpm-lock.yaml':'version: 1','tsconfig.app.json':'{}','data/published/dashboard.json':'{"schemaVersion":9}','dist/server/index.js':'export default {}','dist/server/wrangler.json':'{}','dist/client/.vite/manifest.json':'{}','dist/client/assets/app.js':'console.log(1)'};
  for(const[file,value]of Object.entries(files)){const path=join(root,file);await mkdir(resolve(path,'..'),{recursive:true});await writeFile(path,value);}
  return root;
}
test('fingerprint is deterministic and ignores generated outputs/evidence',async t=>{
  const root=await fixture(t),first=await releaseFingerprint(root);
  await mkdir(join(root,'outputs'),{recursive:true});await writeFile(join(root,'outputs/proof.json'),'noise');
  await mkdir(join(root,'docs/verification'),{recursive:true});await writeFile(join(root,'docs/verification/result.json'),'noise');
  await mkdir(join(root,'pipeline/__pycache__'),{recursive:true});await writeFile(join(root,'pipeline/__pycache__/cache.pyc'),'noise');
  assert.deepEqual(await releaseFingerprint(root),first);
});
test('changing tested source rejects an otherwise matching fingerprint',async t=>{
  const root=await fixture(t),expected=await releaseFingerprint(root);
  await assertFingerprintMatches(root,expected);await writeFile(join(root,'app/page.tsx'),'export default 2');
  await assert.rejects(assertFingerprintMatches(root,expected),/source/i);
});
test('changing built output rejects an otherwise matching fingerprint',async t=>{
  const root=await fixture(t),expected=await releaseFingerprint(root);
  await writeFile(join(root,'dist/client/assets/app.js'),'console.log(2)');
  await assert.rejects(assertFingerprintMatches(root,expected),/build/i);
});
test('changing generated data rejects an otherwise matching fingerprint',async t=>{
  const root=await fixture(t),expected=await releaseFingerprint(root);
  await writeFile(join(root,'data/published/dashboard.json'),'{"schemaVersion":9,"revision":2}');
  await assert.rejects(assertFingerprintMatches(root,expected),/payload/i);
});
test('source files are hashed but absent production builds fail closed',async t=>{
  const root=await fixture(t);assert.match((await sourceFingerprint(root)).hash,/^[a-f0-9]{64}$/);
  await rm(join(root,'dist/server/index.js'));await assert.rejects(releaseFingerprint(root),/production|build|index/i);
});
test('fabricated or incomplete success receipt cannot authorize packaging',async t=>{
  const root=await fixture(t);await mkdir(join(root,'outputs'),{recursive:true});
  await writeFile(join(root,'outputs/release-gate.json'),JSON.stringify({schemaVersion:1,status:'passed',fingerprint:await releaseFingerprint(root),stages:[]}));
  await assert.rejects(assertReleaseReady(root),/receipt|signature|stage|key/i);
});
test('required stage order includes every data, build and browser gate',()=>{
  const stages=createReleaseStages({node:process.execPath,python:'python',pnpm:'pnpm'});
  assert.deepEqual(stages.map(s=>s.name),REQUIRED_STAGES);
  assert.ok(stages.find(s=>s.name==='python-unit').args.includes('pipeline/tests'));
  assert.ok(stages.find(s=>s.name==='playwright').args.includes('playwright'));
});
test('failed required browser child rejects the gate instead of making a success record',async()=>{
  const stages=createReleaseStages({node:process.execPath,python:'python',pnpm:'pnpm'}),seen=[];
  await assert.rejects(runRequiredStages(stages,async stage=>{seen.push(stage.name);return {exitCode:stage.name==='playwright'?1:0};}),/playwright/);
  assert.deepEqual(seen,REQUIRED_STAGES.slice(0,REQUIRED_STAGES.indexOf('playwright')+1));
});
test('a required assertion exception also blocks later stages',async()=>{
  const stages=createReleaseStages({node:process.execPath,python:'python',pnpm:'pnpm'});
  await assert.rejects(runRequiredStages(stages,async stage=>{if(stage.name==='chart-browser')assert.equal('broken','expected');return {exitCode:0};}),/broken|expected/);
});
test('omitting required stages is rejected, not silently skipped',async()=>{
  const stages=createReleaseStages({node:process.execPath,python:'python',pnpm:'pnpm'}).slice(0,-1);
  await assert.rejects(runRequiredStages(stages,async()=>({exitCode:0})),/stage|manifest/i);
});
test('environment cannot narrow coverage or inject test runner options',()=>{
  const env=releaseEnvironment({PATH:process.env.PATH,CHART_PROFILES:'phone',CHART_ROUTES:'/',PLAYWRIGHT_MODULE:'fake',PYTEST_ADDOPTS:'-k nothing',NODE_OPTIONS:'--import fake',PLAYWRIGHT_INJECT_FAILURE:'1',DASHBOARD_BASE_URL:'https://external.test'},process.cwd());
  for(const key of ['CHART_PROFILES','CHART_ROUTES','PLAYWRIGHT_MODULE','PYTEST_ADDOPTS','NODE_OPTIONS'])assert.equal(env[key],undefined,key);
  assert.equal(env.PLAYWRIGHT_EXTERNAL_SERVER,'1');assert.equal(env.PLAYWRIGHT_INJECT_FAILURE,'1');assert.equal(env.DASHBOARD_BASE_URL,'http://127.0.0.1:4185');assert.equal(env.CI,'1');
});
test('invalid published data exits nonzero before release stages',async t=>{
  const root=await fixture(t),input=join(root,'data/published/dashboard.json');
  const script=new URL('../scripts/validate-published.mjs',import.meta.url);
  let stderr='';const code=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[fileURLToPath(script),input],{stdio:'pipe',windowsHide:true});child.stderr.on('data',bytes=>{stderr+=bytes;});child.on('error',reject);child.on('close',resolve);});
  assert.notEqual(code,0);assert.match(stderr,/failed dashboard validation/);
});
test('real child assertion and hanging child both fail the bounded executor',async t=>{
  const root=await fixture(t),logs=join(root,'outputs/logs');await mkdir(logs,{recursive:true});
  const assertion=await executeReleaseStage({name:'controlled-assertion',command:process.execPath,args:['-e','require("node:assert/strict").equal(1,2)'],timeoutMs:5000},root,releaseEnvironment(process.env,root),logs);
  assert.notEqual(assertion.exitCode,0);
  const before=Date.now();await assert.rejects(executeReleaseStage({name:'controlled-timeout',command:process.execPath,args:['-e','setInterval(()=>{},1000)'],timeoutMs:50},root,releaseEnvironment(process.env,root),logs),/timed out/);
  assert.ok(Date.now()-before<15000,'timeout cleanup is bounded');
});
test('native tool invocation preserves executable paths and arguments with spaces',async t=>{
  const root=await fixture(t),folder=join(root,'tool folder'),logs=join(root,'outputs/logs');await mkdir(folder,{recursive:true});await mkdir(logs,{recursive:true});
  const script=join(folder,'echo.mjs');await writeFile(script,'process.stdout.write(process.argv.slice(2).join("|"));');
  let command=process.execPath,args=[script,'a b','123'];
  if(process.platform==='win32'){command=join(folder,'echo.cmd');await writeFile(command,`@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);args=['a b','123'];}
  const result=await executeReleaseStage({name:'native-tool',command,args,timeoutMs:5000},root,releaseEnvironment(process.env,root),logs);
  assert.equal(result.exitCode,0);assert.equal(await readFile(join(logs,'native-tool.log'),'utf8'),'a b|123');
});
async function signedFixture(root){
  const key=randomBytes(32),at=new Date().toISOString(),stages=[];
  await mkdir(join(root,'outputs/release-gate-logs'),{recursive:true});
  for(const name of REQUIRED_STAGES){const text=`Controlled receipt fixture: ${name}\n`,log=`outputs/release-gate-logs/${name}.log`;await writeFile(join(root,log),text);stages.push({name,status:'passed',exitCode:0,signal:null,startedAt:at,completedAt:at,durationMs:0,log,logHash:createHash('sha256').update(text).digest('hex')});}
  const receipt={schemaVersion:1,status:'passed',root,startedAt:at,completedAt:at,negativeControl:false,server:{origin:'http://127.0.0.1:4185',owned:true,configuration:'dist/server/wrangler.json'},fingerprint:await releaseFingerprint(root),stages};
  receipt.signature=createHmac('sha256',key).update(JSON.stringify(receipt)).digest('hex');
  await writeFile(join(root,'outputs/.release-gate-key'),key.toString('hex'));
  await writeFile(join(root,'outputs/release-gate.json'),JSON.stringify(receipt));return receipt;
}
test('editing a signed controlled receipt invalidates its signature',async t=>{
  const root=await fixture(t),receipt=await signedFixture(root);await assertReleaseReady(root);
  receipt.stages[0].exitCode=1;await writeFile(join(root,'outputs/release-gate.json'),JSON.stringify(receipt));
  await assert.rejects(assertReleaseReady(root),/signature/);
});
test('changed evidence, source and build reject a previously matching signed controlled receipt',async t=>{
  for(const[file,content,reason]of [['outputs/release-gate-logs/playwright.log','edited','evidence log'],['app/page.tsx','changed source','source'],['dist/client/assets/app.js','changed build','build']]){
    const root=await fixture(t);await signedFixture(root);await assertReleaseReady(root);await writeFile(join(root,file),content);await assert.rejects(assertReleaseReady(root),new RegExp(reason));
  }
});
