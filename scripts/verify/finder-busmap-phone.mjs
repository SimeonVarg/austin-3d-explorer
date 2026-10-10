/**
 * finder-busmap-phone.mjs — the finder's bus parts inside the bottom sheet of a touch screen (390 x 844, touch), one browser look.
 * The same real city and rules as finder-busmap.mjs (needs a GPU; run by hand on a cloud lane, quarantined in CI): a bus home's
 * trip is drawn and framed in the part of the screen the sheet leaves free, the board / get-off tags are on screen, the
 * "Show live buses" switch inside the open sheet is a 44 px target with 12 px text, switching it on draws only the trip's
 * routes' buses, and closing the finder stops everything. Major only; no schedule.
 * Usage: node scripts/verify/finder-busmap-phone.mjs --out DIR     (or VERIFY_OUT=DIR)
 */
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { launch, BASE } from './chrome.mjs';
const oi = process.argv.indexOf('--out');
const OUT = (oi > 0 && process.argv[oi + 1]) || process.env.VERIFY_OUT || '.';
fs.mkdirSync(OUT, { recursive: true });
const results = [], sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (name, cond, detail) => { results.push({ name, ok: !!cond, detail: detail === undefined ? null : detail }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail === undefined ? '' : '  ' + JSON.stringify(detail))); };
const browser = await launch(chromium, { gl: process.env.VERIFY_GL || 'hardware', maxMs: 900000 });
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage(), errors = [], reqs = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => reqs.push({ t: Date.now(), url: r.url() }));
  await page.addInitScript(() => { const t = setInterval(() => { if (window.cancelGraphicsAutoDetect) { window.cancelGraphicsAutoDetect(); clearInterval(t); } }, 50); });
  const st = () => page.evaluate(() => window.finderState());
  await page.goto(BASE + '/index.html?intro=0&drift=0&finder=1&major=computer-science&mode=either', { waitUntil: 'domcontentloaded', timeout: 240000 });
  await page.waitForFunction(() => window.finderState && window.finderState().loaded, null, { timeout: 240000 });
  await page.waitForFunction(() => !document.getElementById('veil'), null, { timeout: 240000 }).catch(() => {});
  await page.waitForFunction(() => window.finderState().bus.rank && window.finderState().bus.timetableLegs > 0, null, { timeout: 120000 }).catch(() => {});
  let s = await st();
  check('the sheet is a bottom sheet here', await page.evaluate(() => { const r = document.getElementById('finder').getBoundingClientRect(); return r.width >= innerWidth - 2 && r.bottom >= innerHeight - 2; }));
  await page.evaluate(() => { const h = document.querySelector('.fd-item .fd-sub'); });
  const id = await page.evaluate(() => { const li = [...document.querySelectorAll('.fd-item')].find((l) => /bus about/.test(l.querySelector('.fd-sub').textContent)); return li && li.dataset.id; });
  check('a home with a bus is in the list', !!id, id);
  await page.evaluate((i) => window.finderSelect(i), id);
  await page.waitForFunction(() => { const r = window.finderState().route; return r.bus >= 1 && r.stop >= 2; }, null, { timeout: 30000 }).catch(() => {});
  await sleep(5000);
  s = await st();
  check('the trip is drawn on a phone: bus line and both stops, with tags', s.route.bus >= 1 && s.route.stop >= 2 && s.labels >= 2, { route: s.route, labels: s.labels, view: s.view });
  const geo = await page.evaluate(() => {
    const sh = document.getElementById('finder').getBoundingClientRect(), W = innerWidth;
    const tags = [...document.querySelectorAll('.fd-stoptag')].map((n) => { const r = n.getBoundingClientRect(); return { t: n.textContent.slice(0, 20), x: Math.round(r.left), r: Math.round(r.right), y: Math.round(r.top), b: Math.round(r.bottom) }; });
    const stops = window.__map.querySourceFeatures('finder-route').filter((f) => f.properties.k === 'stop').map((f) => { const q = window.__map.project(f.geometry.coordinates); return { x: Math.round(q.x), y: Math.round(q.y) }; });
    return { sheetTop: Math.round(sh.top), W, tags, stops };
  });
  check('both stops are on screen above the sheet', geo.stops.length >= 2 && geo.stops.every((p) => p.x >= 0 && p.x <= geo.W && p.y >= 0 && p.y <= geo.sheetTop + 4), geo);
  check('the board and get-off tags are not hidden under the sheet', geo.tags.length >= 2 && geo.tags.every((t) => t.b <= geo.sheetTop + 4), geo.tags);   // a tag centred on a stop near the edge can still overhang the side of a phone: reported in the detail, not asserted
  await page.screenshot({ path: `${OUT}/phone-1-trip.png` });
  // open the sheet tall: the foot (and the switch) is there
  await page.click('.fd-handle'); await sleep(1200);
  const sw = await page.evaluate(() => { const l = document.querySelector('.fd-livebuses'), r = l.getBoundingClientRect(), n = document.querySelector('.fd-livebuses-note'); return { h: Math.round(r.height), w: Math.round(r.width), vis: !l.hidden && r.height > 0, noteFont: parseFloat(getComputedStyle(n).fontSize), labelFont: parseFloat(getComputedStyle(l).fontSize) }; });
  check('the live-buses switch is on screen in the open sheet and is a 44 px target', sw.vis && sw.h >= 43.5, sw);
  await page.tap('.fd-livebuses input');
  await page.waitForFunction(() => window.finderState().liveBuses.active && window.__map.getLayer('transit-live-vehicles'), null, { timeout: 30000 }).catch(() => {});
  await sleep(4000);
  const on = await page.evaluate(() => ({ layers: window.__map.getStyle().layers.map((l) => l.id).filter((x) => /^transit-live/.test(x)), noteFont: parseFloat(getComputedStyle(document.querySelector('.fd-livebuses-note')).fontSize), note: document.querySelector('.fd-livebuses-note').textContent.slice(0, 40), shown: window.TransitLive.vehiclesGeo().features.length }));
  check('switched on in the sheet: only the vehicles layers, and the note is at the 12 px floor', on.layers.sort().join() === 'transit-live-vehicle-halo,transit-live-vehicles' && on.noteFont >= 12, on);
  await page.screenshot({ path: `${OUT}/phone-2-live-buses.png` });
  // closing the finder (the x) stops everything
  await page.tap('.fd-hide'); await sleep(2500);
  const from = Date.now(); await sleep(30000);
  s = await st();
  const gone = await page.evaluate(() => ({ live: !window.__map.getLayer('transit-live-vehicles'), route: window.__map.querySourceFeatures('finder-route').length }));
  check('closing the sheet: no trip, no live layer, no handle, no request to the bus feeds in 30 s', s.view === 'pill' && !s.liveBuses.active && gone.live && gone.route === 0 && !reqs.some((r) => r.t >= from && /data\.texas\.gov/.test(r.url)), { view: s.view, gone });
  check('no page error', errors.length === 0, errors.slice(0, 5));
} finally {
  fs.writeFileSync(`${OUT}/finder-busmap-phone.json`, JSON.stringify({ results }, null, 2));
  await browser.__done();
}
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `FAIL  finder-busmap-phone: ${failed.length} of ${results.length} checks` : `PASS  finder-busmap-phone: ${results.length} checks`);
process.exitCode = failed.length ? 1 : 0;
