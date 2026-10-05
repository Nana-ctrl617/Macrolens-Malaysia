import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
function luminance(hex) {
  const rgb = hex.slice(1).match(/../g).map((x) => parseInt(x,16)/255).map((x) => x <= .04045 ? x/12.92 : ((x+.055)/1.055)**2.4);
  return rgb[0]*.2126 + rgb[1]*.7152 + rgb[2]*.0722;
}
function contrast(a,b) { const first = luminance(a), second = luminance(b); return (Math.max(first,second)+.05)/(Math.min(first,second)+.05); }
test('chart focus and meaningful graphical indicators meet non-text contrast target', () => {
  for (const [foreground, background] of [['#145f9e','#ffffff'],['#76dbe2','#172522'],['#76dbe2','#1d2e2a'],['#52636b','#ffffff'],['#6f9e8e','#20332f'],['#b7dacf','#20332f'],['#111f1c','#b7dacf'],['#111f1c','#6f9e8e'],['#d95c3f','#ffffff'],['#1d746b','#ffffff'],['#9a6b16','#ffffff'],['#274653','#ffffff'],['#7b6fa6','#ffffff'],['#5d7564','#ffffff']]) assert.ok(contrast(foreground,background) >= 3, `${foreground}/${background}: ${contrast(foreground,background)}`);
  assert.ok(contrast('#52636b','#ffffff')>=4.5,'chart metadata text');
});
test('chart accessibility styles preserve wrapping, forced-colour focus and native slider targets', () => {
  const css = readFileSync(new URL('../app/chart-accessibility.css', import.meta.url),'utf8');
  assert.match(css,/focus-visible/); assert.match(css,/forced-colors/);
  assert.match(css,/outline-color:\s*Highlight/); assert.match(css,/min-height:\s*44px/);
  assert.match(css,/overflow-wrap:\s*anywhere/); assert.match(css,/\.chart-live-description/);
});
