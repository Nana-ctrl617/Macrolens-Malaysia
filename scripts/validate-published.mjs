import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const defaultPath = resolve(root, 'data/published/dashboard.json');
const pureModules = new Set([
  'dashboard-integrity.ts', 'forecast-evaluation-integrity.ts', 'regional-integrity.ts',
].map(name => resolve(root, 'app/lib', name)));
const moduleUrls = new Map();
let validator;

const transpile = (source, fileName) => ts.transpileModule(source, {
  fileName,
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const dataUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;

// Execute the actual pure server guards. This intentionally does not load
// getDashboard, its bundled fallback, artifact cache or remote fetcher.
async function pureModuleUrl(path, ancestors = new Set()) {
  if (!pureModules.has(path)) throw Error('Dashboard validator has an unreviewed runtime dependency');
  if (moduleUrls.has(path)) return moduleUrls.get(path);
  if (ancestors.has(path)) throw Error('Dashboard validator has a circular dependency');
  const nextAncestors = new Set([...ancestors, path]);
  let code = transpile(await readFile(path, 'utf8'), path);
  const parsed = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const edits = [];
  for (const statement of parsed.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const specifier = statement.moduleSpecifier;
    if (!ts.isStringLiteral(specifier) || !specifier.text.startsWith('./')) {
      throw Error('Dashboard validator must use reviewed local pure dependencies');
    }
    const dependency = resolve(dirname(path), specifier.text.endsWith('.ts') ? specifier.text : `${specifier.text}.ts`);
    const url = await pureModuleUrl(dependency, nextAncestors);
    edits.push({ start: specifier.getStart(parsed), end: specifier.end, text: JSON.stringify(url) });
  }
  for (const edit of edits.reverse()) code = code.slice(0, edit.start) + edit.text + code.slice(edit.end);
  const url = dataUrl(code);
  moduleUrls.set(path, url);
  return url;
}

async function loadValidator() {
  if (validator) return validator;
  const path = resolve(root, 'app/lib/dashboard.ts');
  const text = await readFile(path, 'utf8');
  const parsed = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declarations = ['hasDashboardShape', 'isDashboard'].map(name => {
    const declaration = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    if (!declaration) throw Error(`Actual dashboard guard ${name} is missing`);
    return declaration.getText(parsed);
  });
  const integrity = await pureModuleUrl(resolve(root, 'app/lib/dashboard-integrity.ts'));
  const regional = await pureModuleUrl(resolve(root, 'app/lib/regional-integrity.ts'));
  const source = `import { validateDashboardIntegrity } from ${JSON.stringify(integrity)};\n`
    + `import { validateRegionalShape } from ${JSON.stringify(regional)};\n`
    + declarations.join('\n')
    + '\nexport { hasDashboardShape, validateDashboardIntegrity };';
  const actual = await import(dataUrl(transpile(source, path)));
  if (typeof actual.isDashboard !== 'function') throw Error('Actual dashboard guard could not be loaded');
  validator = actual;
  return validator;
}

export async function validatePublishedPayload(raw, label = 'published dashboard') {
  const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  let payload;
  try { payload = JSON.parse(bytes.toString('utf8')); }
  catch { throw Error(`Published dashboard is not valid JSON: ${label}`); }
  const guards = await loadValidator();
  if (!guards.isDashboard(payload)) {
    const checks = `shape=${guards.hasDashboardShape(payload)} integrity=${guards.validateDashboardIntegrity(payload)}`;
    let isolatedRepairs = [];
    if (guards.hasDashboardShape(payload) && !guards.validateDashboardIntegrity(payload)) {
      try {
        const bundled = JSON.parse((await readFile(defaultPath)).toString('utf8'));
        const roots = ['series', 'sources', 'forecast', 'riskHeatmap', 'regionalLens', 'householdPressure', 'sectorDeepDive', 'externalSector', 'balancePayments'];
        isolatedRepairs = roots.filter(key => {
          if (!(key in bundled)) return false;
          const candidate = { ...payload, [key]: bundled[key] };
          return guards.hasDashboardShape(candidate) && guards.validateDashboardIntegrity(candidate);
        });
        if (isolatedRepairs.includes('forecast')) {
          const forecastRoots = ['evaluation', 'models', 'points', 'scenario', 'selectedModel', 'backtestWindows', 'vintageLedger'];
          let details = [];
          for (let size = 1; size <= forecastRoots.length && !details.length; size++) {
            const choose = (start, selected) => {
              if (selected.length === size) {
                const forecast = { ...payload.forecast };
                for (const key of selected) forecast[key] = bundled.forecast[key];
                if (guards.validateDashboardIntegrity({ ...payload, forecast })) details = [...selected];
                return;
              }
              for (let index = start; index < forecastRoots.length && !details.length; index++) choose(index + 1, [...selected, forecastRoots[index]]);
            };
            choose(0, []);
          }
          if (details.length) isolatedRepairs = [...isolatedRepairs.filter(key => key !== 'forecast'), `forecast.${details.join('+')}`];
        }
      } catch { /* Preserve the primary validation result if diagnostics are unavailable. */ }
    }
    const repairHint = isolatedRepairs.length ? `; a bundled ${isolatedRepairs.join(', ')} replacement restores integrity` : '';
    throw Error(`Published artifact failed dashboard validation (${checks}${repairHint}): ${label}`);
  }
  return {
    path: label,
    schemaVersion: payload.schemaVersion,
    generatedAt: payload.generatedAt,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

export async function validatePublishedArtifact(path = defaultPath) {
  const absolutePath = resolve(path);
  let bytes;
  try { bytes = await readFile(absolutePath); }
  catch { throw Error(`Unable to read published dashboard: ${absolutePath}`); }
  return validatePublishedPayload(bytes, absolutePath);
}

export const validatePublished = validatePublishedArtifact;

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (process.argv.length > 3) throw Error('Usage: node scripts/validate-published.mjs [dashboard.json|https://…]');
    let result;
    if (process.argv[2]?.startsWith('https://')) {
      const url = process.argv[2];
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { Accept: 'application/json' } });
      if (!response.ok) throw Error(`Remote dashboard returned ${response.status}: ${url}`);
      result = await validatePublishedPayload(await response.arrayBuffer(), url);
    } else result = await validatePublishedArtifact(process.argv[2]);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Published dashboard validation failed'}\n`);
    process.exitCode = 1;
  }
}
