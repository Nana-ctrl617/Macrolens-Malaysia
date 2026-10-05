// Windows adaptation of the official Sites package-site.sh contract.
// A successful gate for these exact source/data/build bytes is mandatory.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { assertReleaseReady } from './assert-release-ready.mjs';

const project = path.resolve(process.argv[2] ?? process.cwd());
const archive = path.resolve(process.argv[3] ?? path.join(project, 'outputs', 'macrolens-production.tar.gz'));
await assertReleaseReady(project);
const prepare = process.env.SITES_PREPARE_SCRIPT ?? 'C:/Users/USER/.codex/plugins/cache/openai-curated-remote/sites/1.0.0-a/skills/sites/scripts/prepare-site-build.cjs';
if (!fs.existsSync(prepare)) throw new Error('Official Sites packaging helper is unavailable. Preserve the tested build.');
const stage = fs.mkdtempSync(path.join(project, 'outputs', 'publish-stage-'));
const stagedDist = path.join(stage, 'dist');
const run = (exe, args) => {
  const result = spawnSync(exe, args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || 'Packaging failed');
  return result.stdout;
};
const kind = run(process.execPath, [prepare, project, stagedDist]).trim();
const read = filename => JSON.parse(fs.readFileSync(filename, 'utf8'));
const source = read(path.join(project, '.openai', 'hosting.json'));
const builtPath = path.join(project, 'dist', '.openai', 'hosting.json');
const built = fs.existsSync(builtPath) ? read(builtPath) : {};
if (source.artifact_metadata != null && built.artifact_metadata != null && !isDeepStrictEqual(source.artifact_metadata, built.artifact_metadata)) throw new Error('Conflicting artifact attribution');
const stagedPath = path.join(stagedDist, '.openai', 'hosting.json');
const manifest = kind === 'worker' ? source : read(stagedPath);
const attribution = built.artifact_metadata ?? source.artifact_metadata;
if (attribution != null) manifest.artifact_metadata = attribution;
fs.mkdirSync(path.dirname(stagedPath), { recursive: true });
fs.writeFileSync(stagedPath, JSON.stringify(manifest, null, 2) + '\n');
const drizzle = path.join(project, 'drizzle');
if (fs.existsSync(drizzle)) fs.cpSync(drizzle, path.join(stagedDist, '.openai', 'drizzle'), { recursive: true });
fs.mkdirSync(path.dirname(archive), { recursive: true });
run('C:/Windows/System32/tar.exe', ['-C', stage, '-czf', archive, 'dist']);
const entries = run('C:/Windows/System32/tar.exe', ['-tzf', archive]).split(/\r?\n/);
if (!entries.includes('dist/.openai/hosting.json') || !entries.includes('dist/server/index.js')) throw new Error('Missing deployment metadata or Worker');
// Packaging stages metadata separately, never mutating the validated build.
await assertReleaseReady(project);
console.log(JSON.stringify({ archive, kind, entries: entries.length, bytes: fs.statSync(archive).size }));
