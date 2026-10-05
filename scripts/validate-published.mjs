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
    + declarations.join('\n');
  const actual = await import(dataUrl(transpile(source, path)));
  if (typeof actual.isDashboard !== 'function') throw Error('Actual dashboard guard could not be loaded');
  validator = actual.isDashboard;
  return validator;
}

export async function validatePublishedArtifact(path = defaultPath) {
  const absolutePath = resolve(path);
  let bytes;
  try { bytes = await readFile(absolutePath); }
  catch { throw Error(`Unable to read published dashboard: ${absolutePath}`); }
  let payload;
  try { payload = JSON.parse(bytes.toString('utf8')); }
  catch { throw Error(`Published dashboard is not valid JSON: ${absolutePath}`); }
  if (!(await loadValidator())(payload)) throw Error(`Published artifact failed dashboard validation: ${absolutePath}`);
  return {
    path: absolutePath,
    schemaVersion: payload.schemaVersion,
    generatedAt: payload.generatedAt,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

export const validatePublished = validatePublishedArtifact;

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (process.argv.length > 3) throw Error('Usage: node scripts/validate-published.mjs [dashboard.json]');
    const result = await validatePublishedArtifact(process.argv[2]);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Published dashboard validation failed'}\n`);
    process.exitCode = 1;
  }
}
