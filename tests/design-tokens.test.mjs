import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const root=new URL('../app/',import.meta.url);
const required=['--surface-page','--surface-panel','--text-primary','--text-secondary','--border-default','--status-low','--status-moderate','--status-high','--status-unavailable','--focus-ring'];
test('one token owner declares semantic dashboard colours',()=>{
  const css=readFileSync(new URL('design-tokens.css',root),'utf8');
  for(const token of required) assert.equal([...css.matchAll(new RegExp(`${token}\\s*:`, 'g'))].length,1,`${token} declared once`);
  for(const name of readdirSync(root).filter(name=>name.endsWith('.css')&&name!=='design-tokens.css')) {
    const other=readFileSync(new URL(name,root),'utf8');
    assert.doesNotMatch(other,/--(?:paper|card|ink|muted|line|chart-focus)\s*:\s*#[0-9a-f]/i,`${name} must not compete with token owner`);
  }
  const layout=readFileSync(new URL('layout.tsx',root),'utf8');
  assert.ok(layout.indexOf('./design-tokens.css')<layout.indexOf('./globals.css'));
});
test('categorical palettes remain separate from pressure and freshness semantics',()=>{
  const css=readFileSync(new URL('design-tokens.css',root),'utf8');
  for(let n=1;n<=6;n++) assert.match(css,new RegExp(`--category-${n}\\s*:`));
  for(const status of ['fresh','stale','fallback','unavailable']) assert.match(css,new RegExp(`--source-${status}(?:-text)?\\s*:`));
  assert.doesNotMatch(css,/--(?:category-\d|series-[\w-]+)\s*:\s*var\(--(?:status|source)-/);
});
test('canvas reads the actual CSS colour rather than assigning unresolved var syntax',async()=>{
  const source=readFileSync(new URL('lib/chart-colours.ts',root),'utf8');
  const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
  const helper=await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
  const style={getPropertyValue:key=>key==='--chart-text-light'?' #123456 ':key==='--category-1'?'#abcdef':''};
  assert.equal(helper.chartColours(style).text,'#123456');
  assert.equal(helper.resolveChartColour(style,helper.sectorColourTokens[0]),'#abcdef');
  assert.equal(helper.resolveChartColour(style,'var(--category-3)'),'#9a6b16');
  assert.equal(helper.resolveChartColour(style,'#654321'),'#654321');
});
test('semantic text, status and focus token pairs preserve required contrast',()=>{
  const css=readFileSync(new URL('design-tokens.css',root),'utf8').split('}')[0];
  const tokens=Object.fromEntries([...css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(match=>[match[1],match[2].trim()]));
  const read=(key,seen=[])=>{
    assert.ok(tokens[key],`${key} exists`); assert.ok(!seen.includes(key),'no cyclic token aliases');
    const alias=/^var\((--[\w-]+)\)$/.exec(tokens[key]); return alias?read(alias[1],[...seen,key]):tokens[key];
  };
  const l=(hex)=>{const rgb=hex.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};
  const ratio=(a,b)=>(Math.max(l(a),l(b))+.05)/(Math.min(l(a),l(b))+.05);
  const pairs=[['--text-primary','--surface-panel'],['--text-secondary','--surface-panel'],['--text-on-dark','--surface-dark-panel'],['--text-secondary-on-dark','--surface-dark-panel']];
  for(const state of ['fresh','stale','fallback','unavailable']) pairs.push([`--source-${state}-text`,`--source-${state}-background`]);
  for(const state of ['low','moderate','high']) pairs.push([`--pressure-${state}`,`--pressure-${state}-background`]);
  for(const[a,b]of pairs) assert.ok(ratio(read(a),read(b))>=4.5,`${a}/${b}: ${ratio(read(a),read(b))}`);
  for(const[a,b]of [['--focus-ring-light','--surface-panel'],['--focus-ring-dark','--surface-dark-panel']]) assert.ok(ratio(read(a),read(b))>=3);
});
