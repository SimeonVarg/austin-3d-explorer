/**
 * pose.mjs — photograph any camera pose you can name, without editing a script.
 *
 * tour.mjs is a FIXED set of poses and that is its job: the same twelve frames
 * every time, so a regression shows up as a difference. But most of a working
 * session is "look at this one thing from over here", and adding a pose to the
 * tour to see it once — then taking it out again — is how the tour rots.
 *
 * So: poses on the command line, one browser, one load, however many frames.
 * The load is the expensive part (10-17 s); the frames after it are nearly free,
 * which is why this takes a LIST rather than one pose per process.
 *
 * SCREENSHOT TWICE, KEEP THE SECOND — scripts/verify/README.md records why: the
 * first capture after a camera move regularly catches a half-drawn frame, and a
 * half-drawn frame read as a defect has cost this project hours.
 *
 * Usage:
 *   node scripts/verify/pose.mjs --out shots/x --tod 0.30 \
 *        name:lng,lat,zoom,pitch,bearing  [name:...]
 *
 *   VERIFY_URL=http://127.0.0.1:8123 node scripts/verify/pose.mjs \
 *     --out shots/speedway --tod 0.30 \
 *     low:-97.7371,30.2820,17,45,0  flat:-97.7371,30.2820,17,84,0
 */
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';
import fs from 'node:fs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const OUT = opt('--out', 'shots/pose');
const TOD = parseFloat(opt('--tod', '0.30'));
const W = parseInt(opt('--width', '1600'), 10);
const H = parseInt(opt('--height', '1000'), 10);
const SUFFIX = opt('--suffix', '');
// Extra query string, e.g. --extra "&tiles=0" to force the GeoJSON fallback
// when you have changed a tiled layer and cannot rebuild the archive locally.
const EXTRA = opt('--extra', '');

const poses = argv.filter(a => /^[\w-]+:-?[\d.]/.test(a)).map(a => {
  const [name, nums] = a.split(':');
  const [lng, lat, zoom, pitch, bearing] = nums.split(',').map(Number);
  return { name, view: { center: [lng, lat], zoom, pitch, bearing } };
});
if (!poses.length) {
  console.error('no poses. usage: pose.mjs --out DIR --tod 0.3 name:lng,lat,zoom,pitch,bearing ...');
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });

const browser = await launch(chromium, { gl: 'hardware' });
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('pageerror', e => console.log('  [pageerror] ' + e.message));

await page.goto(BASE + '/index.html?intro=0&drift=0' + EXTRA, { waitUntil: 'networkidle', timeout: 180000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

await page.evaluate(p => {
  const el = document.getElementById('tod-slider');
  if (el) {
    el.value = String(p);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (typeof window.applyTimeOfDay === 'function') {
    window.applyTimeOfDay(window.__map, p, true);
  }
}, TOD);
await page.waitForTimeout(3000);

for (const { name, view } of poses) {
  await page.evaluate(v => window.__map.jumpTo(v), view);
  // Wait for OUR sources, not for `idle`: the sky canvas repaints every frame,
  // so the map is never idle and once('idle') is a coin flip (boot.mjs, and it
  // once turned a 15 s load into a reported 37 s).
  await page.waitForFunction(() => {
    const m = window.__map;
    const ids = Object.keys(m.getStyle().sources).filter(id => /^austin-/.test(id));
    return ids.length > 0 && ids.every(id => { try { return m.isSourceLoaded(id); } catch (e) { return false; } });
  }, null, { timeout: 40000 }).catch(() => console.log('  (' + name + ': sources still loading)'));
  await page.waitForTimeout(1200);
  const file = `${OUT}/${name}${SUFFIX}.png`;
  await page.screenshot({ path: file });          // discard: often half-drawn
  await page.waitForTimeout(700);
  await page.screenshot({ path: file });
  console.log('  ' + file);
}

await browser.__done();
