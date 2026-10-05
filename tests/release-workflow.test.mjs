import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = relative => readFile(new URL(`../${relative}`, import.meta.url), 'utf8');
const published = JSON.parse(await source('data/published/dashboard.json'));
const validator = new URL('../scripts/validate-published.mjs', import.meta.url);

async function withArtifact(value, callback) {
  const directory = await mkdtemp(join(tmpdir(), 'macrolens-validate-'));
  const path = join(directory, 'dashboard.json');
  try {
    await writeFile(path, typeof value === 'string' ? value : JSON.stringify(value));
    return await callback(path);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('published validator accepts the exact current snapshot without fetching', async () => {
  const { validatePublishedArtifact } = await import(validator.href);
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = () => { calls++; throw Error('No network is allowed'); };
  try {
    const result = await validatePublishedArtifact();
    assert.equal(result.path, resolve(root, 'data/published/dashboard.json'));
    assert.equal(result.schemaVersion, published.schemaVersion);
    assert.equal(result.generatedAt, published.generatedAt);
    assert.ok(result.bytes > 0);
    assert.match(result.sha256, /^[a-f0-9]{64}$/);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});

test('published validator invokes shape, regional, risk and forecast cross-field guards', async () => {
  const { validatePublishedArtifact } = await import(validator.href);
  const mutations = [
    value => { value.schemaVersion = 999; },
    value => { value.latestBrief.whatChanged = []; },
    value => { value.regionalLens.stateRecords[0].incomeMedian = -1; },
    value => { value.riskHeatmap.overallScore = 101; },
    value => { value.forecast.points[0].low95 = value.forecast.points[0].high95 + 1; },
    value => { value.forecast.evaluation.coverage[0].covered80 -= 1; },
    value => { value.sources.headline.observationPeriod = '1990-01-01'; },
  ];
  for (const mutate of mutations) {
    const value = structuredClone(published); mutate(value);
    await withArtifact(value, path => assert.rejects(validatePublishedArtifact(path), /failed dashboard validation/, String(mutate)));
  }
});

test('invalid JSON, missing file and CLI validation failures exit nonzero', async () => {
  const { validatePublishedArtifact } = await import(validator.href);
  await withArtifact('{invalid JSON', async path => {
    await assert.rejects(validatePublishedArtifact(path), /JSON/);
    const result = spawnSync(process.execPath, [fileURLToPath(validator), path], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /JSON/);
    assert.equal(result.stdout.trim(), '');
  });
  await withArtifact({ schemaVersion: 9 }, path => {
    const result = spawnSync(process.execPath, [fileURLToPath(validator), path], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /failed dashboard validation/);
    assert.equal(result.stdout.trim(), '');
  });
  await assert.rejects(validatePublishedArtifact(join(tmpdir(), 'macrolens-not-present', 'dashboard.json')), /read/);
  const excess = spawnSync(process.execPath, [fileURLToPath(validator), 'one', 'two'], { cwd: root, encoding: 'utf8' });
  assert.equal(excess.status, 1);
  assert.match(excess.stderr, /Usage/);
});

test('daily source workflow keeps its schedule and validates before staging data', async () => {
  const yaml = await source('.github/workflows/update-dashboard.yml');
  assert.match(yaml, /cron:\s*["']45 5 \* \* \*["']/);
  assert.match(yaml, /workflow_dispatch:/);
  assert.match(yaml, /cancel-in-progress:\s*false/);
  assert.ok(yaml.indexOf('pytest -q pipeline/tests') < yaml.indexOf('python pipeline/macrolens.py'));
  assert.ok(yaml.indexOf('python pipeline/macrolens.py') < yaml.indexOf('node scripts/validate-published.mjs'));
  assert.ok(yaml.indexOf('node scripts/validate-published.mjs') < yaml.indexOf('git add -- data/published data/vintages'));
  assert.match(yaml, /pnpm install --frozen-lockfile/);
  assert.match(yaml, /git status --porcelain --untracked-files=all -- data\/published data\/vintages/);
  assert.match(yaml, /git diff --cached --quiet -- data\/published data\/vintages/);
  assert.doesNotMatch(yaml, /continue-on-error:\s*true|git push --force/);
});

test('workflow change detection includes a new untracked vintage and excludes unrelated files', async () => {
  const yaml = await source('.github/workflows/update-dashboard.yml');
  const command = yaml.match(/git status --porcelain --untracked-files=all -- data\/published data\/vintages/)?.[0];
  assert.ok(command, 'run the exact workflow status command');
  const directory = await mkdtemp(join(tmpdir(), 'macrolens-vintage-git-'));
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: directory, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  try {
    git('init', '--quiet');
    await mkdir(join(directory, 'data/vintages'), { recursive: true });
    await mkdir(join(directory, 'data/published'), { recursive: true });
    await writeFile(join(directory, 'data/published/dashboard.json'), '{}');
    git('add', '--', 'data/published');
    git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.test', 'commit', '--quiet', '-m', 'fixture');
    await writeFile(join(directory, 'unrelated.txt'), 'not dashboard data');
    assert.equal(git(...command.split(' ').slice(1)).trim(), '');
    await writeFile(join(directory, 'data/vintages/new-cpi.json'), '{"period":"2026-07"}');
    assert.match(git(...command.split(' ').slice(1)), /\?\? data\/vintages\/new-cpi\.json/);
    git('add', '--', 'data/published', 'data/vintages');
    const staged = spawnSync('git', ['diff', '--cached', '--quiet', '--', 'data/published', 'data/vintages'], { cwd: directory });
    assert.equal(staged.status, 1, 'a vintage-only change reaches the workflow commit');
    assert.equal(git('diff', '--cached', '--name-only').trim(), 'data/vintages/new-cpi.json');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('verification CI is read-only, reproducible and invokes the required release gate', async () => {
  const yaml = await source('.github/workflows/verify-dashboard.yml');
  assert.match(yaml, /pull_request:/);
  assert.match(yaml, /push:/);
  assert.match(yaml, /workflow_dispatch:/);
  assert.match(yaml, /permissions:\s*\n\s*contents:\s*read/);
  assert.doesNotMatch(yaml, /contents:\s*write|pull_request_target:|continue-on-error:\s*true/);
  assert.match(yaml, /pnpm install --frozen-lockfile/);
  assert.match(yaml, /pip install -r pipeline\/requirements\.txt/);
  assert.match(yaml, /pnpm exec playwright install --with-deps chromium/);
  assert.match(yaml, /node scripts\/release-gate\.mjs/);
  assert.match(yaml, /actions\/upload-artifact@v4/);
  assert.match(yaml, /if:\s*always\(\)/);
  assert.match(yaml, /outputs\/|playwright-report\/|test-results\//);
  assert.match(yaml, /!outputs\/\.release-gate-key/);
  assert.match(yaml, /include-hidden-files:\s*false/);
});
