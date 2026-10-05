import {createHash} from 'node:crypto';
import {lstat,readdir,readFile} from 'node:fs/promises';
import {join,relative,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const SOURCE_DIRS=['app','src','components','lib','styles','types','pipeline','public','scripts','tests','build','config','.github/workflows'];
const IGNORED=new Set(['node_modules','.git','.openai','.wrangler','.next','.vinext','outputs','playwright-report','test-results','__pycache__','.pytest_cache','.venv','venv']);
const ROOT_CONFIG=/^(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|\.npmrc|\.gitignore|requirements[^/]*\.txt|pyproject\.toml|pytest\.ini|playwright\.config\.[cm]?[jt]s|tsconfig[^/]*\.json|(?:vite|vinext|wrangler|postcss|eslint|next|tailwind)[^/]*\.(?:[cm]?[jt]s|jsonc?|toml))$/;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function exists(path){try{await lstat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
async function walk(root,path,files){
  const info=await lstat(path);
  if(info.isSymbolicLink())throw Error(`Release fingerprint refuses a source/build symlink: ${relative(root,path)}`);
  if(info.isDirectory()){
    for(const name of (await readdir(path)).sort())if(!IGNORED.has(name))await walk(root,join(path,name),files);
  }else if(info.isFile()&&!/\.(?:py[co]|tsbuildinfo)$/.test(path)){
    const bytes=await readFile(path);files.push({path:relative(root,path).replaceAll('\\','/'),sha256:sha(bytes),bytes:bytes.length});
  }
}
function treeResult(files){
  files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  return {hash:sha(files.map(file=>`${file.path}\0${file.sha256}\0${file.bytes}\n`).join('')),fileCount:files.length};
}
export async function sourceFingerprint(root=process.cwd()){
  root=resolve(root);const files=[];
  if(!await exists(join(root,'app')))throw Error('Release source root has no app directory.');
  for(const dir of SOURCE_DIRS)if(await exists(join(root,dir)))await walk(root,join(root,dir),files);
  for(const name of (await readdir(root)).sort())if(ROOT_CONFIG.test(name))await walk(root,join(root,name),files);
  // Downloadable generated companions are build relevant; dashboard.json has
  // its own exact-byte payload fingerprint instead of being counted twice.
  const published=join(root,'data/published');
  if(await exists(published))for(const name of (await readdir(published)).sort())if(name!=='dashboard.json')await walk(root,join(published,name),files);
  return treeResult(files);
}
export async function buildFingerprint(root=process.cwd()){
  root=resolve(root);
  for(const path of ['dist/server/index.js','dist/server/wrangler.json','dist/client/.vite/manifest.json'])if(!await exists(join(root,path)))throw Error(`Production build is missing ${path}.`);
  const files=[];await walk(root,join(root,'dist'),files);return treeResult(files);
}
export async function payloadFingerprint(root=process.cwd()){
  const bytes=await readFile(join(resolve(root),'data/published/dashboard.json'));
  return {hash:sha(bytes),bytes:bytes.length};
}
export async function releaseFingerprint(root=process.cwd()){
  const [source,build,payload]=await Promise.all([sourceFingerprint(root),buildFingerprint(root),payloadFingerprint(root)]);
  return {sourceHash:source.hash,buildHash:build.hash,payloadHash:payload.hash,sourceFiles:source.fileCount,buildFiles:build.fileCount,payloadBytes:payload.bytes};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  try{if(process.argv.length>2)throw Error('Usage: node scripts/release-fingerprint.mjs');console.log(JSON.stringify(await releaseFingerprint(),null,2));}
  catch(error){console.error(error.message);process.exitCode=1;}
}
