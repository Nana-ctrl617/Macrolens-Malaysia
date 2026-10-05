import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { installDashboardFixture } from './browser-fixture.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? '@playwright/test');

const base = process.env.DASHBOARD_BASE_URL ?? 'http://127.0.0.1:4185';
const fixture = JSON.parse(await readFile(new URL('../data/published/dashboard.json', import.meta.url),'utf8'));
const result = { at: new Date().toISOString(), browser: '', environment: 'Isolated headless Chromium; production Worker; saved fixture; no external requests', checks: [], failures: [] };
const browser = await chromium.launch({ headless: true });
result.browser = browser.version();
const routes = (process.env.CHART_ROUTES ?? '/,/brief,/risk,/structure,/external,/bop,/bursa,/forecast,/regional,/structural').split(',');
const sizes = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 900 },
  { name: '200-percent-reflow', width: 640, height: 450 },
  { name: '400-percent-reflow', width: 320, height: 225 },
  { name: '200-percent-text', width: 1280, height: 900, textScale: 2 },
].filter(size => !process.env.CHART_PROFILES || process.env.CHART_PROFILES.split(',').includes(size.name));
// Reflow widths model 1280px at 200%/400%. This is not OS or physical-device zoom.
for (const size of sizes) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, hasTouch: true });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.origin === new URL(base).origin ? route.continue() : route.abort();
  });
  await installDashboardFixture(context, base, fixture);
  const page = await context.newPage();
  for (const route of routes) {
    const item = { size: size.name, route, canvasChecks: 0, liveRegions: 0, overflow: false };
    try {
      await page.goto(`${base}${route}`, { waitUntil: 'networkidle' });
      await page.locator('main h1').first().waitFor();
      if (size.textScale) {
        // User-style text enlargement is separate from the viewport-equivalent zoom cases.
        await page.evaluate(scale => {
          const bodyFont = parseFloat(getComputedStyle(document.body).fontSize);
          const labels = [...document.querySelectorAll('h1,h2,h3,h4,p,li,a,button,input,select,summary,small,th,td,label,span,strong,b,time')];
          const fonts = labels.map(el => [el,parseFloat(getComputedStyle(el).fontSize)]);
          document.body.style.fontSize = `${bodyFont*scale}px`;
          for (const [el,font] of fonts) el.style.fontSize = `${font*scale}px`;
        },size.textScale);
        await page.setViewportSize({width:size.width-1,height:size.height});
        await page.setViewportSize({width:size.width,height:size.height});
      }
      if (route === '/') {
        const bars=page.locator('[data-chart-kind="snapshot"] button.bar-column');
        const lastBar=bars.last(); await lastBar.focus();
        await lastBar.press('Home'); const firstBar=bars.first();
        assert.equal(await firstBar.evaluate(el=>el===document.activeElement),true);
        await firstBar.press('End'); const ids=(await lastBar.getAttribute('aria-describedby')).split(/\s+/);
        const status=page.locator(`[id=${JSON.stringify(ids.find(id=>id.endsWith('-reading')))}]`);
        const last=await status.textContent(); await lastBar.click();
        assert.equal(await status.textContent(),last,'snapshot pointer and keyboard parity');
        await lastBar.tap(); assert.equal(await status.textContent(),last,'snapshot touch and keyboard parity');
        await lastBar.press('Escape'); assert.equal(await lastBar.evaluate(el=>el===document.activeElement),true);
        await page.getByRole('button', { name: /Open historical data for Headline inflation/ }).click();
        await page.locator('.detail-chart-wrap canvas').waitFor();
      }
      item.overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      assert.equal(item.overflow, false, 'page must not have two-dimensional scrolling');
      const axisFonts = await page.locator('.series-trend-axis,.bop-axis text,.bop-axis-label').evaluateAll(nodes=>nodes.map(el=>{
        const svg=el.closest('svg'); const rendered=svg.getBoundingClientRect().width/svg.viewBox.baseVal.width;
        return parseFloat(getComputedStyle(el).fontSize)*rendered;
      }));
      assert.ok(axisFonts.every(size=>size>=13.99), 'SVG labels must not shrink below 14 CSS pixels');
      item.axisFonts=axisFonts;
      const canvases = page.locator('canvas[tabindex="0"]');
      for (let index = 0; index < await canvases.count(); index++) {
        const canvas = canvases.nth(index);
        if (!await canvas.isVisible()) continue;
        await canvas.scrollIntoViewIfNeeded();
        await canvas.evaluate(el => el.scrollIntoView({block:'center',inline:'center'}));
        await canvas.focus();
        await canvas.scrollIntoViewIfNeeded();
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal(await canvas.evaluate(el => el === document.activeElement), true);
        assert.ok((await canvas.getAttribute('aria-describedby'))?.trim(), 'chart needs linked instructions/status');
        const descriptions = (await canvas.getAttribute('aria-describedby')).split(/\s+/);
        const statusId = descriptions.find(id => id.includes('status') || id.endsWith('-reading'));
        assert.ok(statusId, 'chart needs a persistent described status');
        const status = page.locator(`[id=${JSON.stringify(statusId)}]`);
        await canvas.press('Home');
        const first = await status.innerText();
        await canvas.press('End');
        const last = await status.innerText();
        assert.ok(first && last, 'first and last values must be announced');
        const box = await canvas.evaluate(el => { const r=el.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; });
        const viewportHeight = await page.evaluate(() => window.innerHeight);
        const visibleTop = Math.max(0,box.y), visibleBottom = Math.min(viewportHeight,box.y+box.height);
        assert.ok(visibleBottom>visibleTop,`chart must be scrolled into the visible viewport before pointer/touch inspection (${JSON.stringify({box,viewportHeight,scrollY:await page.evaluate(()=>window.scrollY)})})`);
        const inspectY = visibleTop + (visibleBottom-visibleTop)/2;
        // The rightmost point is clamped to the last real observation.
        const isDonut = await canvas.evaluate(el => !!el.closest('[data-chart-kind="donut"]'));
        if (!isDonut) {
          // Inspect the last plotted point inside the graph, not the canvas's
          // trailing padding where touch hit-testing can land on adjacent UI.
          const plotRightInset = await canvas.evaluate(el => Math.min(24,el.clientWidth*.08));
          // Use the endpoint itself: on narrow daily charts, a one-pixel
          // inset can be closer to the previous trading day than the last one.
          const lastPointX = box.x + box.width - plotRightInset;
          // Sticky navigation may cover the top edge of the canvas after it is
          // scrolled into view, especially in a 320x225 reflow viewport. Find
          // an actually visible point on the plotted endpoint rather than
          // assuming the geometric viewport midpoint is unobstructed.
          const pointerY = await page.evaluate(({x,top,bottom}) => {
            const hits=[];
            for(let y=Math.ceil(top);y<Math.floor(bottom);y+=2) {
              if(document.elementFromPoint(x,y)?.tagName==='CANVAS') hits.push(y);
            }
            return hits.length ? hits[Math.floor(hits.length/2)] : null;
          },{x:lastPointX,top:visibleTop,bottom:visibleBottom});
          const pointerTarget = await page.evaluate(({x,y}) => { const el=y==null?null:document.elementFromPoint(x,y); return {tag:el?.tagName??'none',text:el?.textContent?.trim().slice(0,80),label:el?.getAttribute('aria-label'),className:typeof el?.className==='string'?el.className:''}; },{x:lastPointX,y:pointerY});
          assert.equal(pointerTarget.tag,'CANVAS',`the plotted endpoint must be touchable in the visible chart area (${JSON.stringify({pointerTarget,lastPointX,pointerY,box,viewportHeight,scrollY:await page.evaluate(()=>window.scrollY)})})`);
          await page.mouse.move(lastPointX, pointerY);
          assert.equal(await status.innerText(), last, 'pointer and keyboard must read the same last observation');
          const tapTarget = await page.evaluate(({x,y}) => document.elementFromPoint(x,y)?.tagName ?? 'none',{x:lastPointX,y:pointerY});
          assert.equal(tapTarget,'CANVAS',`touch must hit the inspected chart, not adjacent UI (hit ${tapTarget} at ${lastPointX}, ${pointerY})`);
          await page.touchscreen.tap(lastPointX, pointerY);
          assert.equal(await status.innerText(), last, `tap and keyboard must read the same last observation (tap ${lastPointX}, ${pointerY})`);
        } else {
          await canvas.press('Home'); const first=await status.innerText();
          const shares=fixture.growthDrivers.production.years.at(-1).sectors;
          const angle=shares[0].share/100*Math.PI-Math.PI/2;
          const pointer={x:box.x+box.width/2+Math.cos(angle)*box.width*.33,y:box.y+box.height/2+Math.sin(angle)*box.height*.33};
          if(pointer.y>=150 && pointer.y<size.height) {
            await page.mouse.move(pointer.x,pointer.y); assert.equal(await status.innerText(),first,'donut slice mouse/keyboard parity');
            await page.touchscreen.tap(pointer.x,pointer.y); assert.equal(await status.innerText(),first,'donut slice tap/keyboard parity');
          }
          const legend = page.locator('.sector-legend button').first();
          if (await legend.count()) {
            await legend.focus();
            const keyboard = await status.innerText();
            await legend.click();
            assert.equal(await status.innerText(), keyboard, 'donut legend keyboard and pointer select the same sector');
            await legend.tap();
            assert.equal(await status.innerText(), keyboard, 'donut legend touch and keyboard select the same sector');
          }
        }
        await canvas.focus(); await canvas.press('Escape');
        assert.equal(await canvas.evaluate(el => el === document.activeElement), true, 'dismissal must not remove focus');
        const focus = await canvas.evaluate(el => ({ width: getComputedStyle(el).outlineWidth, style: getComputedStyle(el).outlineStyle }));
        assert.notEqual(focus.style, 'none'); assert.ok(parseFloat(focus.width) >= 2);
        item.canvasChecks++;
      }
      for (const selector of ['.series-trend-plot','.bop-trend-frame']) {
        const charts = page.locator(selector);
        for (let index=0;index<await charts.count();index++) {
          const chart=charts.nth(index);
          await chart.evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          await chart.focus();
          const ids=(await chart.getAttribute('aria-describedby')).split(/\s+/);
          const status=page.locator(`[id=${JSON.stringify(ids.find(id=>id.endsWith('-live')))}]`);
          await chart.press('Home'); assert.ok(await status.textContent());
          await chart.press('End'); const last=await status.textContent();
          const box=await chart.locator('svg').evaluate(el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};});
          const viewportHeight=await page.evaluate(()=>window.innerHeight);
          const visibleTop=Math.max(0,box.y),visibleBottom=Math.min(viewportHeight,box.y+box.height);
          assert.ok(visibleBottom>visibleTop,`SVG chart must be visible before pointer/touch inspection (${JSON.stringify({selector,box,viewportHeight,scrollY:await page.evaluate(()=>window.scrollY)})})`);
          const x=box.x+box.width-1;
          const y=await page.evaluate(({x,top,bottom,selector})=>{
            const hits=[];
            for(let y=Math.ceil(top);y<Math.floor(bottom);y+=2) {
              if(document.elementFromPoint(x,y)?.closest(selector)) hits.push(y);
            }
            return hits.length?hits[Math.floor(hits.length/2)]:null;
          },{x,top:visibleTop,bottom:visibleBottom,selector});
          const touchTarget=await page.evaluate(({x,y,selector})=>y!=null&&document.elementFromPoint(x,y)?.closest(selector)!=null,{x,y,selector});
          assert.equal(touchTarget,true,`SVG chart must have an unobstructed touch point at its right edge (${JSON.stringify({selector,box,viewportHeight,scrollY:await page.evaluate(()=>window.scrollY),x,y})})`);
          await page.mouse.move(x,y);
          assert.equal(await status.textContent(),last,'SVG pointer/keyboard parity');
          await page.touchscreen.tap(x,y);
          assert.equal(await status.textContent(),last,'SVG touch/keyboard parity');
          await chart.press('Escape'); assert.equal(await chart.evaluate(el=>el===document.activeElement),true);
          item.canvasChecks++;
        }
      }
      item.liveRegions = await page.locator('[role="status"][aria-live="polite"]').count();
      if (route === '/forecast') {
        const forecasts = page.locator('button.interval-track');
        assert.equal(await forecasts.count(),3, 'each future interval must be a keyboard/touch action');
        for (let index=0;index<3;index++) {
          const point = fixture.forecast.points[index];
          const label = await forecasts.nth(index).getAttribute('aria-label');
          for (const key of ['value','low80','high80','low95','high95']) assert.ok(label.includes(point[key].toFixed(2)), `${key} must match the payload`);
          await forecasts.nth(index).click();
          await forecasts.nth(index).press('Enter');
        }
      }
      result.checks.push(item);
      console.log(`PASS ${size.name} ${route}: ${item.canvasChecks} inspected canvases`);
    } catch (error) {
      const failure = { ...item, error: String(error.message) }; result.failures.push(failure);
      console.error(`FAIL ${size.name} ${route}: ${error.message}`);
    }
  }
  await context.close();
}
await browser.close();
await mkdir(new URL('../outputs/',import.meta.url), { recursive: true });
await writeFile(new URL('../outputs/chart-browser-check.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
if (result.failures.length) process.exitCode = 1;
