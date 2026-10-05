import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { installDashboardFixture } from './browser-fixture.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'@playwright/test');
const base=process.env.DASHBOARD_BASE_URL??'http://127.0.0.1:4185';
const data=JSON.parse(await readFile(new URL('../data/published/dashboard.json',import.meta.url),'utf8'));
const browser=await chromium.launch({headless:true});
const evidence={browser:browser.version(),at:new Date().toISOString(),checks:[]};
for(const viewport of [{width:390,height:844},{width:1280,height:900}]){
  const context=await browser.newContext({viewport});
  await context.route('**/*',route=>new URL(route.request().url()).origin===new URL(base).origin?route.continue():route.abort());
  await installDashboardFixture(context,base,data);
  const page=await context.newPage();
  for(const route of ['/','/forecast','/risk','/bop','/regional']){
    await page.goto(`${base}${route}`,{waitUntil:'networkidle'});
    const values=await page.evaluate(()=>{
      const style=getComputedStyle(document.documentElement);
      const property=key=>style.getPropertyValue(key).trim();
      const panel=document.querySelector('.series-trend-panel,.bop-visual');
      const chart=document.querySelector('button.interval-track,.score-visual-bar-row,.metric-card');
      return {background:getComputedStyle(document.body).backgroundColor,font:getComputedStyle(document.body).fontFamily,
        surface:property('--surface-page'),text:property('--text-primary'),focus:property('--focus-ring-light'),
        overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,
        panel:panel?{background:getComputedStyle(panel).backgroundColor,text:getComputedStyle(panel).color,focus:getComputedStyle(panel).getPropertyValue('--chart-focus').trim()}:null,
        chart:chart?{background:getComputedStyle(chart).backgroundColor,text:getComputedStyle(chart).color}:null};
    });
    assert.equal(values.surface,'#f3f6f8'); assert.equal(values.text,'#17252b'); assert.ok(values.font.includes('Arial'));
    assert.equal(values.overflow,false);
    if(values.panel){assert.equal(values.panel.background,'rgb(255, 255, 255)');assert.equal(values.panel.text,'rgb(23, 37, 43)');assert.equal(values.panel.focus,'#145f9e');}
    evidence.checks.push({viewport,route,...values});
    await page.screenshot({path:fileURLToPath(new URL(`../outputs/tokens-${viewport.width}-${route.slice(1)||'snapshot'}.png`,import.meta.url)),fullPage:false});
  }
  await context.close();
}
await browser.close();await mkdir(new URL('../outputs/',import.meta.url),{recursive:true});
await writeFile(new URL('../outputs/token-browser-check.json',import.meta.url),JSON.stringify(evidence,null,2)+'\n');
console.log(`${evidence.checks.length} computed-style and compact layout cases passed`);
