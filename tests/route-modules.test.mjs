import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const project = fileURLToPath(new URL('../', import.meta.url));
const routes = [
  ['', 'Snapshot'], ['brief', 'Brief'], ['news', 'News'], ['risk', 'Risk'],
  ['forecast', 'Forecast'], ['drivers', 'Drivers'], ['structure', 'Structure'],
  ['external', 'External'], ['bop', 'Bop'], ['household', 'Household'],
  ['regional', 'Regional'], ['sectors', 'Sectors'], ['bursa', 'Bursa'],
  ['decisions', 'Decisions'], ['timeline', 'Timeline'], ['structural', 'Structural'],
  ['report', 'Report'], ['health', 'Health'], ['methodology', 'Methodology'],
];
const viewFiles = new Set(routes.map(([, name]) => resolve(project, `app/views/${name}View.tsx`)));
const rootPage = resolve(project, 'app/page.tsx');
const shell = resolve(project, 'app/components/DashboardShell.tsx');

function localFile(specifier, owner) {
  if (!specifier.startsWith('@/') && !specifier.startsWith('.')) return null;
  const base = specifier.startsWith('@/') ? resolve(project, specifier.slice(2)) : resolve(dirname(owner), specifier);
  if (base.endsWith('.css')) return null;
  const target = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')].find(existsSync);
  assert.ok(target, `Runtime dependency ${specifier} from ${owner} resolves`);
  return target;
}

function runtimeEdges(filename) {
  const source = ts.createSourceFile(filename, readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const edges = [];
  const add = (specifier, deferred = false) => {
    const target = localFile(specifier, filename);
    if (target) edges.push({ target, deferred });
  };
  for (const node of source.statements) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      if (clause?.isTypeOnly) continue;
      if (clause && !clause.name && clause.namedBindings && ts.isNamedImports(clause.namedBindings)
          && clause.namedBindings.elements.every((element) => element.isTypeOnly)) continue;
      add(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      if (node.isTypeOnly) continue;
      if (node.exportClause && ts.isNamedExports(node.exportClause)
          && node.exportClause.elements.every((element) => element.isTypeOnly)) continue;
      add(node.moduleSpecifier.text);
    }
  }
  const visit = (node) => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
        && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) add(node.arguments[0].text, true);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return edges;
}

function reachable(entry, includeDeferred = true) {
  const found = new Set();
  const visit = (filename) => {
    if (found.has(filename)) return;
    found.add(filename);
    for (const edge of runtimeEdges(filename)) if (includeDeferred || !edge.deferred) visit(edge.target);
  };
  visit(entry);
  return found;
}

test('every public route imports only the shared shell and its own true view', () => {
  for (const [route, name] of routes) {
    const wrapper = resolve(project, 'app', route, 'page.tsx');
    const expected = resolve(project, `app/views/${name}View.tsx`);
    const direct = runtimeEdges(wrapper).map((edge) => edge.target);
    assert.ok(direct.includes(shell), `${route || '/'} imports DashboardShell`);
    assert.ok(direct.includes(expected), `${route || '/'} imports ${name}View directly`);
    assert.equal(direct.filter((file) => viewFiles.has(file)).length, 1, `${route || '/'} has one view owner`);
    assert.ok(!direct.includes(rootPage), `${route || '/'} does not import the former whole-dashboard page`);
    const graph = reachable(wrapper);
    assert.ok(graph.has(expected));
    assert.deepEqual([...graph].filter((file) => viewFiles.has(file)), [expected], `${route || '/'} cannot reach unrelated views`);
  }
});

test('shared shell and navigation never import or lazily select route views', () => {
  for (const entry of [shell, resolve(project, 'app/components/DashboardNavigation.tsx')]) {
    assert.ok(existsSync(entry), `${entry} exists`);
    const graph = reachable(entry);
    assert.deepEqual([...graph].filter((file) => viewFiles.has(file)), [], `${entry} has no eager or deferred view edges`);
    assert.ok(!graph.has(rootPage), `${entry} has no former monolith dependency`);
    const source = readFileSync(entry, 'utf8');
    assert.doesNotMatch(source, /import\s*\([^)]*(?:views\/|app\/page)/);
  }
});

test('root is a small Snapshot wrapper rather than a compatibility monolith', () => {
  const source = readFileSync(rootPage, 'utf8');
  assert.ok(Buffer.byteLength(source) < 2500, 'root page contains no large all-section implementation');
  assert.doesNotMatch(source, /\bDashboardPage\b|function\s+(?:ForecastIntervalChart|StructuralSection|EconomicStructureSection|NewsSection)\b/);
  for (const [, name] of routes) assert.ok(existsSync(resolve(project, `app/views/${name}View.tsx`)), `${name} is a real module`);
});

test('view imports stay route-local even through shared components and dynamic boundaries', () => {
  for (const [, name] of routes) {
    const entry = resolve(project, `app/views/${name}View.tsx`);
    assert.ok(existsSync(entry), `${name} view exists`);
    const graph = reachable(entry);
    assert.deepEqual([...graph].filter((file) => viewFiles.has(file)), [entry], `${name} does not hide cross-view imports in a barrel`);
    for (const file of graph) assert.ok(file.startsWith(`${project}${sep}`) || file.startsWith(project), 'graph stays inside the project');
  }
});
