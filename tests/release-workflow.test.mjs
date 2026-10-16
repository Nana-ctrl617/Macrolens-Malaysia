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

test('published validator checks remotely fetched bytes with the same integrity guard', async () => {
  const { validatePublishedPayload } = await import(validator.href);
  const result = await validatePublishedPayload(Buffer.from(JSON.stringify(published)), 'remote fixture');
  assert.equal(result.path, 'remote fixture');
  assert.equal(result.schemaVersion, published.schemaVersion);
  assert.equal(result.generatedAt, published.generatedAt);
  assert.equal(result.bytes, Buffer.byteLength(JSON.stringify(published)));
  await assert.rejects(validatePublishedPayload('{not json', 'remote fixture'), /not valid JSON/);
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
  assert.ok(yaml.indexOf('node scripts/validate-published.mjs') < yaml.indexOf('git add -- data/published data/vintages data/backfill'));
  assert.match(yaml, /pnpm install --frozen-lockfile/);
  assert.match(yaml, /git status --porcelain --untracked-files=all -- data\/published data\/vintages data\/backfill/);
  assert.match(yaml, /git diff --cached --quiet -- data\/published data\/vintages data\/backfill/);
  assert.doesNotMatch(yaml, /continue-on-error:\s*true|git push --force/);
  assert.match(yaml, /id:\s*validation[\s\S]*echo "validated=true" >> "\$GITHUB_OUTPUT"/);
  assert.match(yaml, /id:\s*commit[\s\S]*echo "changed=false" >> "\$GITHUB_OUTPUT"/);
  assert.match(yaml, /git push[\s\S]*echo "changed=true" >> "\$GITHUB_OUTPUT"/);
  assert.match(yaml, /name:\s*Summarize dashboard refresh[\s\S]*if:\s*always\(\)/);
  assert.match(yaml, /DASHBOARD_VALIDATED:\s*\$\{\{ steps\.validation\.outputs\.validated \}\}/);
  assert.match(yaml, /node scripts\/refresh-summary\.mjs data\/published\/dashboard\.json/);
});

test('Vercel skips only validated data-only commits and builds on uncertainty or code changes', async t => {
  const config = JSON.parse(await source('vercel.json'));
  assert.equal(config.ignoreCommand, 'node scripts/vercel-ignore-build.mjs');
  const { isDataOnlyChange, shouldSkipBuild } = await import(new URL('../scripts/vercel-ignore-build.mjs', import.meta.url));
  assert.equal(isDataOnlyChange(['data/published/dashboard.json', 'data/vintages/cpi.json']), true);
  assert.equal(isDataOnlyChange(['data/published/dashboard.json', 'app/page.tsx']), false);
  assert.equal(isDataOnlyChange(['data/other/readme.md']), false);
  assert.equal(shouldSkipBuild({ previousSha: 'bad-sha', paths: ['data/published/dashboard.json'] }), false);
  assert.equal(shouldSkipBuild({ previousSha: 'a'.repeat(40), paths: [] }), false);

  const directory = await mkdtemp(join(tmpdir(), 'macrolens-vercel-ignore-'));
  const script = fileURLToPath(new URL('../scripts/vercel-ignore-build.mjs', import.meta.url));
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: directory, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const runGuard = base => spawnSync(process.execPath, [script], {
    cwd: directory,
    env: { ...process.env, VERCEL_GIT_PREVIOUS_SHA: base },
    encoding: 'utf8',
    windowsHide: true,
  });

  try {
    git('init', '--quiet');
    git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.test', 'config', 'core.autocrlf', 'false');
    await mkdir(join(directory, 'data/published'), { recursive: true });
    await writeFile(join(directory, 'app.ts'), 'export const app = 1;');
    await writeFile(join(directory, 'data/published/dashboard.json'), '{}');
    git('add', '--', 'app.ts', 'data/published/dashboard.json');
    git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.test', 'commit', '--quiet', '-m', 'initial');
    const initial = git('rev-parse', 'HEAD');

    await writeFile(join(directory, 'data/published/dashboard.json'), '{"generatedAt":"new"}');
    git('add', '--', 'data/published/dashboard.json');
    git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.test', 'commit', '--quiet', '-m', 'data refresh');
    const dataOnly = runGuard(initial);
    assert.equal(dataOnly.status, 0, dataOnly.stderr);
    assert.match(dataOnly.stdout, /Skipping build/);

    await writeFile(join(directory, 'app.ts'), 'export const app = 2;');
    git('add', '--', 'app.ts');
    git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.test', 'commit', '--quiet', '-m', 'app change');
    const codeChange = runGuard(initial);
    assert.equal(codeChange.status, 1);
    assert.match(codeChange.stdout, /Building/);

    const noBase = runGuard('');
    assert.equal(noBase.status, 1);
    assert.match(noBase.stdout, /valid previous commit SHA/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('refresh summary distinguishes changed, unchanged, unvalidated, and failed runs', async () => {
  const { renderRefreshSummary } = await import(new URL('../scripts/refresh-summary.mjs', import.meta.url));
  const dashboard = {
    generatedAt: '2026-10-16T03:14:33Z',
    health: 'stale',
    sources: {
      headline: { status: 'stale', observationPeriod: '2026-08-01', retrievedAt: '2026-10-16T03:14:33Z' },
    },
  };

  const changed = renderRefreshSummary({ jobStatus: 'success', dashboardChanged: 'true', dashboardValidated: 'true', dashboard });
  assert.match(changed, /Succeeded/);
  assert.match(changed, /validated changes were pushed/);
  assert.match(changed, /2026-08-01/);
  assert.match(changed, /stale/);
  assert.match(changed, /does not mean the scheduled job was skipped/);

  const unchanged = renderRefreshSummary({ jobStatus: 'success', dashboardChanged: 'false', dashboardValidated: 'true', dashboard });
  assert.match(unchanged, /No repository artifact change was needed/);
  assert.doesNotMatch(unchanged, /no data was released/i);

  const failed = renderRefreshSummary({ jobStatus: 'failure', dashboardChanged: undefined, dashboardValidated: undefined, dashboard: null });
  assert.match(failed, /not marked successful/);
  assert.match(failed, /Do not treat its generated files as a fresh publication/);
  assert.match(failed, /public dashboard remains on the last version known to have been published/);
});

test('workflow change detection includes published data, vintages, backfill checkpoints, and excludes unrelated files', async () => {
  const yaml = await source('.github/workflows/update-dashboard.yml');
  const command = yaml.match(/git status --porcelain --untracked-files=all -- data\/published data\/vintages data\/backfill/)?.[0];
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
    await mkdir(join(directory, 'data/backfill'), { recursive: true });
    await writeFile(join(directory, 'data/published/dashboard.json'), '{}');
    git('add', '--', 'data/published');
    git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.test', 'commit', '--quiet', '-m', 'fixture');
    await writeFile(join(directory, 'unrelated.txt'), 'not dashboard data');
    assert.equal(git(...command.split(' ').slice(1)).trim(), '');
    await writeFile(join(directory, 'data/vintages/new-cpi.json'), '{"period":"2026-07"}');
    assert.match(git(...command.split(' ').slice(1)), /\?\? data\/vintages\/new-cpi\.json/);
    await writeFile(join(directory, 'data/backfill/mgs-history.json'), '{"nextDate":"2021-11-03"}');
    git('add', '--', 'data/published', 'data/vintages', 'data/backfill');
    const staged = spawnSync('git', ['diff', '--cached', '--quiet', '--', 'data/published', 'data/vintages', 'data/backfill'], { cwd: directory });
    assert.equal(staged.status, 1, 'vintage and history-checkpoint changes reach the workflow commit');
    assert.deepEqual(git('diff', '--cached', '--name-only').trim().split(/\r?\n/).sort(), ['data/backfill/mgs-history.json', 'data/vintages/new-cpi.json']);
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
  assert.match(yaml, /name:\s*Audit production dependencies\s*\n\s*run:\s*pnpm audit --prod/);
  assert.ok(yaml.indexOf('pnpm install --frozen-lockfile') < yaml.indexOf('pnpm audit --prod'));
  assert.ok(yaml.indexOf('pnpm audit --prod') < yaml.indexOf('node scripts/release-gate.mjs'));
  assert.match(yaml, /pip install -r pipeline\/requirements\.txt/);
  assert.match(yaml, /pnpm exec playwright install --with-deps chromium/);
  assert.match(yaml, /node scripts\/release-gate\.mjs/);
  assert.match(yaml, /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4\.6\.2/);
  assert.match(yaml, /if:\s*always\(\)/);
  assert.match(yaml, /outputs\/|playwright-report\/|test-results\//);
  assert.match(yaml, /!outputs\/\.release-gate-key/);
  assert.match(yaml, /include-hidden-files:\s*false/);
});

test('all third-party workflow actions are pinned to verified release commits and kept up to date', async () => {
  const workflows = await Promise.all([
    source('.github/workflows/update-dashboard.yml'),
    source('.github/workflows/verify-dashboard.yml'),
  ]);
  const expected = new Map([
    ['actions/checkout', '11d5960a326750d5838078e36cf38b85af677262'],
    ['pnpm/action-setup', 'c336a2788d9774dccfdeb4823a5058ccc9f07453'],
    ['actions/setup-node', '49933ea5288caeca8642d1e84afbd3f7d6820020'],
    ['actions/setup-python', 'a26af69be951a213d495a4c3e4e4022e16d87065'],
    ['actions/upload-artifact', 'ea165f8d65b6e75b540449e92b4886f43607fa02'],
  ]);

  for (const yaml of workflows) {
    const references = yaml.match(/^\s*-\s*uses:\s*.+$/gm) ?? [];
    assert.ok(references.length > 0);
    for (const line of references) {
      assert.match(line, /@[a-f0-9]{40}\s+# v\d+\.\d+\.\d+$/, line);
      const match = line.match(/uses:\s*([^@\s]+)@([a-f0-9]{40})\s+#\s+(v\d+\.\d+\.\d+)/);
      assert.ok(match, line);
      assert.equal(expected.get(match[1]), match[2], `unverified action reference: ${line}`);
    }
  }

  const dependabot = await source('.github/dependabot.yml');
  assert.match(dependabot, /package-ecosystem:\s*github-actions/);
  assert.match(dependabot, /interval:\s*weekly/);
  assert.match(dependabot, /update-types:[\s\S]*- minor[\s\S]*- patch/);
});
