import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(new URL("../app/components/RiskScoreVisual.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/components/RiskScoreVisual.css", import.meta.url), "utf8");

test("pressure visualization uses only the published scores, levels and metadata", () => {
  assert.match(component, /import type \{ RiskItem \}/);
  for (const field of ["score", "level", "label", "evidence", "rule", "watch", "period", "dataStatus"]) assert.ok(component.includes(`item.${field}`) || component.includes(`selected.${field}`), `Missing payload field ${field}`);
  assert.doesNotMatch(component, /Math\.random|setInterval|points:|score: \d|history:/);
  assert.match(component, /not a probability of a crisis or loss/);
});

test("heatmap and score comparison buttons expose selection and exact observation context", () => {
  assert.match(component, /aria-label="Interactive pressure heatmap"/);
  assert.match(component, /aria-label="Score comparison"/);
  assert.equal((component.match(/aria-pressed=/g) ?? []).length, 2);
  assert.match(component, /Observation period: \$\{item\.period\}/);
  assert.match(component, /Data status: \$\{statusLabel\(item\.dataStatus\)\}/);
  assert.match(component, /aria-live="polite"/);
  assert.match(component, /\[0, 25, 50, 75, 100\]/);
});

test("all new CSS is scoped, readable and has focus and mobile states", () => {
  assert.doesNotMatch(css, /(?:^|\n)(?:button|h[1-6]|p|body|:root)\s*[\{,:]/);
  assert.ok(css.includes(".score-visual"));
  assert.match(css, /:focus-visible/);
  assert.match(css, /min-height:47px/);
  assert.match(css, /max-width:600px/);
  assert.doesNotMatch(css, /font-size:(?:[0-9]|1[0-3])px/);
  assert.match(css, /--score-low:/);
  assert.match(css, /--score-high:/);
});
