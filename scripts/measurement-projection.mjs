import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// The projection module has type-only dependencies. This executes the exact
// implementation used by the Worker rather than maintaining a second fixture.
export async function loadProjectionForMeasurement() {
  return (await loadProjectionModule()).projectDashboard;
}
export async function loadProjectionModule() {
  const source = await readFile(new URL('../app/lib/dashboard-projection.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}
