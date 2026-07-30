import { chromium } from 'playwright-core';
import { chromePath, GL_ARGS } from './chrome.mjs';
const URL = process.argv[2] || 'https://flyover-utx.vercel.app/';
const browser = await chromium.launch({ executablePath: chromePath(), headless: true, args: GL_ARGS });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('[console] ' + m.text()); });
const resp = await page.goto(URL, { waitUntil: 'networkidle', timeout: 90000 });
console.log('HTTP', resp.status(), URL);
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 90000 });
await page.waitForTimeout(14000);   // let the 9s cinematic intro finish
const info = await page.evaluate(() => {
  const m = window.__map;
  const q = id => { try { return m.queryRenderedFeatures({ layers: [id] }).length; } catch (e) { return -1; } };
  return {
    newModulesLive: {
      sky: typeof window.skyBodies, fly: typeof window.__fly,
      facadesPatterns: m.listImages().filter(i => /^(lo|md|tw|dk)\d\d$/.test(i)).length,
      collisionIndexed: !!(window.__fly && window.__fly.indexed()),
      skyOverlay: !!document.getElementById('sky-canvas'),
      hazeBand: !!document.getElementById('haze'),
    },
    scene: { shadows: q('buildings-shadow'), signs: q('signs-label'), osmLabels: q('buildings-labels') },
    camera: { zoom: +m.getZoom().toFixed(2), pitch: +m.getPitch().toFixed(1), bearing: +m.getBearing().toFixed(1) },
    snapshot: (document.getElementById('hud-snapshot') || {}).textContent,
    sunAt012: window.skyBodies ? window.skyBodies(0.12).sun : null,
  };
});
console.log(JSON.stringify(info, null, 1));
if (errs.length) console.log('ERRORS:', errs.slice(0, 6).join(' | ')); else console.log('no page errors');
await page.screenshot({ path: 'shots/LIVE.png', timeout: 90000 });
await page.waitForTimeout(600);
await page.screenshot({ path: 'shots/LIVE.png', timeout: 90000 });
console.log('wrote shots/LIVE.png');
await browser.close();
