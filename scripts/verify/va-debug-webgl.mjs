// va-debug-webgl.mjs: what happens with no WebGL: every console message, page error and the loader's state. (visual audit A09)
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';
const browser = await launch(chromium, { gl: process.env.VERIFY_GL || 'hardware', maxMs: 300000 });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.addInitScript(() => {
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (t, ...a) { if (/webgl/i.test(t)) return null; return orig.call(this, t, ...a); };
});
page.on('console', m => console.log('CONSOLE', m.type(), m.text().slice(0, 300)));
page.on('pageerror', e => console.log('PAGEERROR', String(e.message).slice(0, 300)));
await page.goto(BASE + '/?intro=0&drift=0&finder=0', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(20000);
console.log('STATE', JSON.stringify(await page.evaluate(() => ({ hook: typeof window.loaderWebglFailed, map: !!window.__map, h2: (document.querySelector('.load-card h2') || {}).textContent, est: (document.getElementById('load-estimate') || {}).textContent, painter: !!(window.__map && window.__map.painter) }))));
await browser.close(); process.exit(0);
