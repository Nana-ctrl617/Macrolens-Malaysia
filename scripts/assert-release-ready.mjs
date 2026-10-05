import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join,relative,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {releaseFingerprint} from './release-fingerprint.mjs';
import {REQUIRED_STAGES} from './release-gate.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const timestamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
export async function assertFingerprintMatches(root,expected){
  const actual=await releaseFingerprint(root);
  for(const[key,label]of [['sourceHash','source'],['buildHash','build'],['payloadHash','payload']])if(!digest(expected?.[key])||expected[key]!==actual[key])throw Error(`Release ${label} fingerprint changed or is invalid; re-run the complete gate.`);
  for(const key of ['sourceFiles','buildFiles','payloadBytes'])if(!Number.isInteger(expected[key])||expected[key]!==actual[key])throw Error(`Release fingerprint ${key} is invalid.`);
  return actual;
}
export async function assertReleaseReady(root=process.cwd()){
  root=resolve(root);const path=join(root,'outputs/release-gate.json');
  let receipt,keyText;
  try{receipt=JSON.parse(await readFile(path,'utf8'));keyText=(await readFile(join(root,'outputs/.release-gate-key'),'utf8')).trim();}
  catch{throw Error('A successful signed release receipt and local signing key are required. Run the complete release gate.');}
  if(!digest(keyText)||!digest(receipt.signature))throw Error('Release receipt signature or signing key is invalid.');
  const {signature,...unsigned}=receipt,signatureBytes=Buffer.from(signature,'hex'),expected=createHmac('sha256',Buffer.from(keyText,'hex')).update(JSON.stringify(unsigned)).digest();
  if(!timingSafeEqual(signatureBytes,expected))throw Error('Release receipt signature does not match; edited or fabricated receipts are rejected.');
  if(receipt.schemaVersion!==1||receipt.status!=='passed'||receipt.negativeControl!==false||receipt.root!==root||!timestamp(receipt.startedAt)||!timestamp(receipt.completedAt)||receipt.completedAt<receipt.startedAt||receipt.server?.owned!==true||receipt.server?.origin!=='http://127.0.0.1:4185'||receipt.server?.configuration!=='dist/server/wrangler.json')throw Error('Release receipt metadata is invalid.');
  if(!Array.isArray(receipt.stages)||receipt.stages.length!==REQUIRED_STAGES.length)throw Error('Release receipt is missing required stages.');
  for(const[index,stage]of receipt.stages.entries()){
    if(stage.name!==REQUIRED_STAGES[index]||stage.status!=='passed'||stage.exitCode!==0||stage.signal!==null||!timestamp(stage.startedAt)||!timestamp(stage.completedAt)||stage.completedAt<stage.startedAt||!Number.isFinite(stage.durationMs)||stage.durationMs<0||!digest(stage.logHash)||typeof stage.log!=='string')throw Error(`Required release stage ${REQUIRED_STAGES[index]} is not proven successful.`);
    const logPath=resolve(root,stage.log),expectedPath=join(root,'outputs/release-gate-logs',`${stage.name}.log`);
    if(logPath!==expectedPath||relative(root,logPath).startsWith('..'))throw Error('Release evidence log path is invalid.');
    let bytes;try{bytes=await readFile(logPath);}catch{throw Error(`Release stage ${stage.name} evidence log is missing.`);}
    if(hash(bytes)!==stage.logHash)throw Error(`Release stage ${stage.name} evidence log changed.`);
  }
  await assertFingerprintMatches(root,receipt.fingerprint);return receipt;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  try{if(process.argv.length>2)throw Error('Usage: node scripts/assert-release-ready.mjs');await assertReleaseReady();console.log('Exact tested source, build and payload are ready for release.');}
  catch(error){console.error(`Release blocked: ${error.message}`);process.exitCode=1;}
}
