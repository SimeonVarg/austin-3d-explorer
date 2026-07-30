/**
 * difftour.mjs — exercise the "what changed" tour end to end.
 *
 * It had never been run before this test existed: diff-tour.js filtered for
 * Point geometry while diff_snapshots.py emits Polygons, so every feature was
 * discarded and it always reported "No changed buildings found in this diff."
 */
import { chromium } from 'playwright-core';
import { chromePath, GL_ARGS, BASE } from './chrome.mjs';

const browser = await chromium.launch({ executablePath: chromePath(), headless: true, args: GL_ARGS });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('[console] ' + m.text()); });

const results = [];
const check = (n, pass, d) => results.push({ name: n, pass, detail: d });

function report() {
  console.log('');
  for (const r of results) {
    console.log((r.pass ? ' PASS  ' : '*FAIL  ') + r.name);
    console.log('         ' + r.detail);
  }
  console.log('');
  console.log(results.filter(r => r.pass).length + '/' + results.length + ' passed');
}

// A Playwright timeout used to kill this script before it printed anything, and
// a bare stack trace tells you nothing about which assertion was in flight.
process.on('uncaughtException', async (e) => {
  check('ran to completion', false, String(e && e.message).split(/\r?\n/)[0]);
  try {
    const st = await page.evaluate(() => ({
      banner: document.getElementById('diff-banner').className,
      info: (document.getElementById('diff-info') || {}).textContent,
      counter: (document.getElementById('diff-counter') || {}).textContent,
      active: (document.getElementById('date-select') || {}).value,
    }));
    console.log('DOM at failure: ' + JSON.stringify(st));
  } catch (e2) { /* page already gone */ }
  report();
  try { await browser.close(); } catch (e3) {}
  process.exit(1);
});

await page.goto(`${BASE}/index.html?intro=0`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });
await page.waitForTimeout(5000);

const opts = await page.evaluate(() =>
  [...document.querySelectorAll('#date-select option')].map(o => o.value));
check('snapshot picker is populated', opts.length >= 3, opts.join(', '));

// Find the diff that actually HAS changes, from the manifest, rather than
// hardcoding dates: snapshots keep being added and the newest adjacent diff is
// often empty (2026-07-27 -> 2026-07-30 has changed_count 0).
const pair = await page.evaluate(async () => {
  const m = await (await fetch('data/manifest.json')).json();
  const best = (m.diffs || []).filter(d => d.changed_count > 0)
    .sort((a, b) => b.changed_count - a.changed_count)[0];
  return best ? { from: best.from, to: best.to, n: best.changed_count } : null;
});
check('manifest has a diff with changes to tour', !!pair, pair ? JSON.stringify(pair) : 'none found');
if (!pair) { report(); await browser.close(); process.exit(1); }

const before = await page.evaluate(() => {
  const c = window.__map.getCenter();
  return { lng: c.lng, lat: c.lat, zoom: window.__map.getZoom() };
});

// app.js keys the tour off (previously active date -> newly selected date), so
// land on that exact pair: select the `to` date, then the `from` date.
await page.selectOption('#date-select', pair.to);
await page.waitForTimeout(2000);
await page.selectOption('#date-select', pair.from);
await page.waitForTimeout(2500);

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
  !/no changed buildings/i.test(started.info), started.info.replace(/\s+/g, ' ').slice(0, 90));
check('counter reflects the manifest changed_count',
  started.counter.indexOf('/ ' + pair.n) !== -1,
  'counter "' + started.counter + '" vs changed_count ' + pair.n);

// It should fly somewhere; wait out the 1.8s flyTo.
await page.waitForTimeout(3500);
const after = await page.evaluate(() => {
  const c = window.__map.getCenter();
  return { lng: c.lng, lat: c.lat, zoom: window.__map.getZoom() };
});
const moved = Math.hypot((after.lat - before.lat) * 111320,
                         (after.lng - before.lng) * 111320 * Math.cos(before.lat * Math.PI / 180));
check('camera flew to the first changed building', moved > 40 && after.zoom > 17,
  'moved ' + moved.toFixed(0) + ' m, zoom ' + before.zoom.toFixed(2) + ' -> ' + after.zoom.toFixed(2));

// Step forward and confirm it advances to a different building.
const c1 = await page.evaluate(() => (document.getElementById('diff-counter') || {}).textContent);
await page.click('#diff-next');
await page.waitForTimeout(3200);
const c2 = await page.evaluate(() => (document.getElementById('diff-counter') || {}).textContent);
const second = await page.evaluate(() => { const c = window.__map.getCenter(); return { lng: c.lng, lat: c.lat }; });
const step = Math.hypot((second.lat - after.lat) * 111320,
                        (second.lng - after.lng) * 111320 * Math.cos(after.lat * Math.PI / 180));
check('next advances to a different building', c1 !== c2 && step > 5,
  'counter ' + c1 + ' -> ' + c2 + ', moved ' + step.toFixed(0) + ' m');

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
check('exit restores the wall height expression',
  restored.wall === '["get","final_height"]', restored.wall);
check('exit restores the roof-cap height expression',
  /final_height/.test(restored.roofH) && !/case/.test(restored.roofH), restored.roofH);
check('exit hides the banner', restored.banner, String(restored.banner));
check('no uncaught page errors', errs.length === 0, errs.slice(0, 3).join(' | ') || 'none');

report();
await browser.close();
process.exit(results.every(r => r.pass) ? 0 : 1);
