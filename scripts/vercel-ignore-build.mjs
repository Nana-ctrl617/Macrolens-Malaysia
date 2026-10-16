import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DATA_PREFIXES = Object.freeze([
  'data/published/',
  'data/vintages/',
  'data/backfill/',
]);

export function isDataOnlyChange(paths) {
  return Array.isArray(paths)
    && paths.length > 0
    && paths.every(path => typeof path === 'string'
      && DATA_PREFIXES.some(prefix => path.startsWith(prefix)));
}

export function shouldSkipBuild({ previousSha, paths }) {
  if (!/^[a-f0-9]{40,64}$/i.test(previousSha ?? '')) return false;
  return isDataOnlyChange(paths);
}

function run() {
  const previousSha = process.env.VERCEL_GIT_PREVIOUS_SHA;
  if (!/^[a-f0-9]{40,64}$/i.test(previousSha ?? '')) {
    console.log('Building: Vercel did not provide a valid previous commit SHA.');
    process.exitCode = 1;
    return;
  }

  const diff = spawnSync('git', [
    'diff', '--name-only', '-z', '--no-renames', `${previousSha}...HEAD`,
  ], { encoding: 'utf8', windowsHide: true });

  if (diff.error || diff.status !== 0) {
    console.log('Building: unable to compare the previous commit with HEAD.');
    process.exitCode = 1;
    return;
  }

  const paths = diff.stdout.split('\0').filter(Boolean);
  if (shouldSkipBuild({ previousSha, paths })) {
    console.log('Skipping build: this commit only updates published dashboard data.');
    process.exitCode = 0;
    return;
  }

  console.log('Building: code, configuration, or an unexpected change was detected.');
  process.exitCode = 1;
}

const isDirectExecution = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href.toLowerCase() === import.meta.url.toLowerCase();

if (isDirectExecution) run();
