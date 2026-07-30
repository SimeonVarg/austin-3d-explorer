/**
 * difftour.mjs — exercise the "what changed" tour end to end.
 * It had never been run: it filtered for Point geometry while the diff writer
 * emits Polygons, so every feature was discarded.
 */
import { chromium } from 'playwright-core';
import { chromePath, GL_ARGS, BASE } from './chrome.mjs';

const browser = await chromium.launch({ executablePath: chromePath(), headless: true, args: GL_ARGS });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('[console] ' + m.text()); });
await page.goto(`${BASE}/index.html?intro=0`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });
await page.waitForTimeout(5000);

const results = [];
const check = (n, pass, d) => results.push({ name: n, pass, detail: d });

// The picker only offers dates the manifest lists; switching triggers the tour.
const opts = await page.evaluate(() =>
  [...document.querySelectorAll('#date-select option')].map(o => o.value));
check('snapshot picker is populated', opts.length >= 3, opts.join(', '));

const before = await page.evaluate(() => {
  const c = window.__map.getCenter();
  return { lng: c.lng, lat: c.lat, zoom: window.__map.getZoom() };
});

// Go from the latest snapshot back one, which is the diff that has 12 changes.
await page.selectOption('#date-select', '2026-07-11');
await page.waitForTimeout(1200);
const started = await page.evaluate(() => {
  const b = document.getElementById('diff-banner');
  return {
    visible: b && !b.classList.contains('hidden'),
    info: (document.getElementById('diff-info') || {}).textContent || '',
    counter: (document.getElementById('diff-counter') || {}).textContent || '',
  };
});
check('diff tour opened its banner', started.visible, JSON.stringify(started));
check('banner does NOT say "no changed buildings"',
  !/no changed buildings/i.test(started.info), started.info.slice(0, 90));

// It should fly somewhere; wait out the 1.8s flyTo.
await page.waitForTimeout(3500);
const after = await page.evaluate(() => {
  const c = window.__map.getCenter();
  return { lng: c.lng, lat: c.lat, zoom: window.__map.getZoom() };
});
const moved = Math.hypot((after.lat - before.lat) * 111320,
                         (after.lng - before.lng) * 111320 * Math.cos(before.lat * Math.PI / 180));
check('camera flew to the first changed building', moved > 40 && after.zoom > 17,
  `moved ${moved.toFixed(0)} m, zoom ${before.zoom.toFixed(2)} -> ${after.zoom.toFixed(2)}`);

// Step forward and confirm it advances to a different building.
const c1 = await page.evaluate(() => (document.getElementById('diff-counter') || {}).textContent);
await page.click('#diff-next');
await page.waitForTimeout(3200);
const c2 = await page.evaluate(() => (document.getElementById('diff-counter') || {}).textContent);
const second = await page.evaluate(() => { const c = window.__map.getCenter(); return { lng: c.lng, lat: c.lat }; });
const step = Math.hypot((second.lat - after.lat) * 111320,
                        (second.lng - after.lng) * 111320 * Math.cos(after.lat * Math.PI / 180));
check('next advances to a different building', c1 !== c2 && step > 5, `counter ${c1} -> ${c2}, moved ${step.toFixed(0)} m`);

// Exit must restore the height expressions, not leave a tween override behind.
await page.click('#diff-exit');
await page.waitForTimeout(900);
const restored = await page.evaluate(() => {
  const m = window.__map;
  return {
    wall: JSON.stringify(m.getPaintProperty('buildings-3d', 'fill-extrusion-height')),
    roofH: JSON.stringify(m.getPaintProperty('buildings-roof', 'fill-extrusion-height')),
    banner: document.getElementById('diff-banner').classList.contains('hidden'),
  };
});
check('exit restores the wall height expression', restored.wall === '["get","final_height"]', restored.wall);
check('exit restores the roof-cap height expression',
  /final_height/.test(restored.roofH) && !/case/.test(restored.roofH), restored.roofH);
check('exit hides the banner', restored.banner, String(restored.banner));
check('no uncaught page errors', errs.length === 0, errs.slice(0, 3).join(' | ') || 'none');

console.log('');
for (const r of results) console.log(`${r.pass ? ' PASS' : '*FAIL'}  ${r.name}\n         ${r.detail}`);
console.log(`\n${results.filter(r => r.pass).length}/${results.length} passed`);
await browser.close();
