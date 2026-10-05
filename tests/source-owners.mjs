import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

export function appSource(relative) {
  return readFileSync(new URL(`../app/${relative}`, import.meta.url), 'utf8');
}

export function viewSource(name) {
  return appSource(`views/${name}View.tsx`);
}

export function functionSource(relative, name) {
  const text = appSource(relative);
  const file = ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = file.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, `${relative} owns function ${name}`);
  return declaration.getText(file);
}
