/**
 * horizon-probe.mjs — the bar across the downtown towers.
 *
 * Simeon, with a screenshot: "im talking about this horizon line ... Is it
 * supposed to go in front of the building like that?"
 *
 * No, it is not. #haze (js/atmosphere.js) is the ONE overlay in the sky stack
 * with no blend mode — plain alpha above #sky — so it paints over geometry
 * instead of behind it. atmosphere.js:33-35 describes this exact failure ("a fat
 * opaque bar sawn straight through the middle of the downtown towers"); the
 * altitude fade added afterwards reduced it without removing it.
 *
 * This measures the bar ON THE BUILDINGS, which is the complaint — not the seam
 * at the horizon, which is a different row and was what an earlier cut of this
 * file wrongly went after.
 *
 * Method: composited screenshots (the GL canvas cannot see a DOM overlay at
 * all), haze on vs off, at the downtown pose. The bar shows up as a pair of
 * horizontal edges in a column that contains only tower wall.
 *
 * Usage: node horizon-probe.mjs [outSuffix]
 */
import { chromium } from 'playwright-core';
import { BASE as SERVER, launch } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';

const SUFFIX = process.argv[2] || '';
const W = 1280, H = 800;

// Simeon's report: "the location which its most apparent which is downtown
// view", at the time of day where it is worst. Looking south down Congress from
// over campus, low enough that the towers fill the middle of the frame.
const POSES = [
  { name: 'downtown-day',    center: [-97.7420, 30.2790], zoom: 15.2, pitch: 78, bearing: 178, p: 0.18 },
  { name: 'downtown-golden', center: [-97.7420, 30.2790], zoom: 15.2, pitch: 78, bearing: 178, p: 0.50 },
  { name: 'spawn-golden',    center: [-97.7434, 30.2857], zoom: 16.5, pitch: 74, bearing: 250, p: 0.50 },
];

const outDir = path.resolve('shots/horizon');
fs.mkdirSync(outDir, { recursive: true });

const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));

await page.goto(`${SERVER}/_harness.html?intro=0&drift=0`, { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
await page.waitForFunction(() => {
  const m = window.__map;
  return m && m.getSource('austin-buildings') && m.getSource('austin-outer');
}, null, { timeout: 120000 });
await page.waitForTimeout(6000);

const hasHaze = await page.evaluate(() => !!document.getElementById('haze'));
console.log('#haze present in DOM:', hasHaze);

for (const pose of POSES) {
  await page.evaluate(p => {
    window.applyTimeOfDay(window.__map, p.p, true);
    window.__map.jumpTo({ center: p.center, zoom: p.zoom, pitch: p.pitch, bearing: p.bearing });
  }, pose);
  await page.waitForFunction(() => window.__map.loaded() && window.__map.areTilesLoaded(), null, { timeout: 120000 });
  await page.waitForTimeout(4000);

  const geom = await page.evaluate(() => {
    const e = document.getElementById('haze');
    if (!e) return null;
    const r = e.getBoundingClientRect();
    const cs = getComputedStyle(e);
    return { top: +r.top.toFixed(0), bottom: +r.bottom.toFixed(0), height: +r.height.toFixed(0),
             opacity: cs.opacity, blend: cs.mixBlendMode };
  });

  for (const on of [true, false]) {
    await page.evaluate(v => {
      const e = document.getElementById('haze');
      if (e) e.style.display = v ? '' : 'none';
      window.__map.triggerRepaint();
    }, on);
    await page.waitForTimeout(1200);
    // Screenshot twice, trust the second.
    await page.screenshot({ path: path.join(outDir, '_t.png') });
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(outDir, `${pose.name}${SUFFIX}-haze${on ? 'ON' : 'OFF'}.png`) });
  }
  await page.evaluate(() => { const e = document.getElementById('haze'); if (e) e.style.display = ''; });
  console.log(`${pose.name}: haze rect ${geom ? `top ${geom.top} bottom ${geom.bottom} (h ${geom.height}) opacity ${geom.opacity} blend ${geom.blend}` : 'ABSENT'}`);
}

fs.existsSync(path.join(outDir, '_t.png')) && fs.unlinkSync(path.join(outDir, '_t.png'));
console.log('page errors:', errors.length ? errors.slice(0, 3).join(' | ') : 'none');
browser.__done();
