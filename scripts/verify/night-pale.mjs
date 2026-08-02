/**
 * night-pale.mjs — which layer is still bright after dark?
 *
 * THE DEFECT IT WAS WRITTEN FOR. In shots/tour/night-dkr-stadium.png two
 * building-shaped patches sit pale grey while the whole city around them is
 * dark. An unlit surface that stays pale after sunset is the "inverted
 * silhouette" failure, and it is the most visible class of bug this scene has:
 * one wrong building in a night frame draws the eye before anything else.
 *
 * WHY A NEW SCRIPT. `night-silhouette.mjs` exists for this and could not run —
 * it throws `ReferenceError: r is not defined` before doing any work, one of the
 * dead scripts the other lane is repairing. It also asks a narrower question:
 * is the ROOFLINE dark against the sky. That cannot see a pale wall in the
 * middle of the frame.
 *
 * HOW IT FINDS THE CULPRIT WITHOUT GUESSING. Counting bright pixels tells you
 * there is a problem, not where it lives. So: count them, then hide one
 * fill-extrusion layer at a time and count again. The layer whose removal drops
 * the pale count is the layer painting them. No reasoning about paint
 * expressions, no reading the data — the renderer answers directly.
 *
 * It reads pixels through `_harness.html`, which forces preserveDrawingBuffer;
 * index.html does not, and readPixels on a swapped buffer returns black.
 *
 * A LAYER CAN BE INNOCENT AND STILL SCORE. Hiding a layer reveals whatever is
 * behind it, so a dark layer in front of a pale one will also change the count.
 * The report gives the delta per layer and leaves the judgement to a person
 * looking at the two frames it writes.
 *
 * Usage:  VERIFY_URL=http://127.0.0.1:8123 node scripts/verify/night-pale.mjs
 */
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';
import fs from 'node:fs';

fs.mkdirSync('shots', { recursive: true });

// Luma above which a pixel is "pale for a night frame". The night city sits
// well under 40; streetlight cores and lit windows are legitimately above this
// and are why the SMALL counts are noise, not signal.
const PALE = 120;
const P_NIGHT = 0.95;
const POSE = { center: [-97.7325, 30.2835], zoom: 16.2, pitch: 62, bearing: 300 };

const browser = await launch(chromium, { gl: 'hardware' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', e => console.log('  [pageerror] ' + e.message));

await page.goto(BASE + '/_harness.html?intro=0&drift=0', { waitUntil: 'networkidle', timeout: 120000 });
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
}, P_NIGHT);
await page.waitForTimeout(3500);

await page.evaluate(q => window.__map.jumpTo(q), POSE);
await page.evaluate(() => new Promise(r => {
  const m = window.__map;
  if (m.loaded() && m.areTilesLoaded()) return r();
  m.once('idle', r); setTimeout(r, 25000);
}));
await page.waitForTimeout(1500);

const countPale = () => page.evaluate(thr => {
  const m = window.__map;
  m.triggerRepaint();
  const c = m.getCanvas();
  const gl = c.getContext('webgl2') || c.getContext('webgl');
  const w = c.width, h = c.height;
  const px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  let n = 0;
  // Skip the top third: that is sky and horizon glow, legitimately bright.
  const from = Math.floor(h * 4 * w / 3);
  for (let i = from; i < px.length; i += 4) {
    const L = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
    if (L > thr) n++;
  }
  return n;
}, PALE);

const layers = await page.evaluate(() => window.__map.getStyle().layers
  .filter(l => l.type === 'fill-extrusion'
    && window.__map.getLayoutProperty(l.id, 'visibility') !== 'none')
  .map(l => l.id));

await page.screenshot({ path: 'shots/night-pale-before.png' });
const base = await countPale();
console.log('\npale pixels below the horizon, all layers on: ' + base);
console.log('(' + layers.length + ' visible fill-extrusion layers)\n');

/**
 * GROUPS FIRST, THEN THE WINNING GROUP'S MEMBERS.
 *
 * One layer at a time over 41 layers blew a 560 s watchdog: each toggle forces a
 * full repaint of a dense scene and a 4 MB readPixels, and the waits add up. The
 * prefixes here are the passes that author geometry, so a group answers "which
 * pass is responsible" in a dozen probes instead of forty-one, and only the
 * guilty group pays for a second round.
 */
const groupOf = id => (id.match(/^([a-z0-9]+)-/) || [null, id])[1];
const groups = new Map();
for (const id of layers) {
  const g = groupOf(id);
  if (!groups.has(g)) groups.set(g, []);
  groups.get(g).push(id);
}

const setVis = (ids, v) => page.evaluate(([a, vis]) => {
  for (const i of a) { try { window.__map.setLayoutProperty(i, 'visibility', vis); } catch (e) {} }
}, [ids, v]);

const probe = async ids => {
  await setVis(ids, 'none');
  await page.waitForTimeout(420);
  const n = await countPale();
  await setVis(ids, 'visible');
  await page.waitForTimeout(180);
  return base - n;
};

console.log('by pass:');
const gRows = [];
for (const [g, ids] of groups) {
  gRows.push({ id: g + '-*  (' + ids.length + ')', drop: await probe(ids), ids });
}
gRows.sort((a, b) => b.drop - a.drop);
for (const r of gRows) {
  if (r.drop > 0) {
    console.log('  ' + r.id.padEnd(32) + String(r.drop).padStart(8)
                + '   ' + (100 * r.drop / base).toFixed(1) + '%');
  }
}

const rows = [];
const worst = gRows[0];
if (worst && worst.ids.length > 1) {
  console.log('\ninside ' + worst.id + ':');
  for (const id of worst.ids) rows.push({ id, drop: await probe([id]) });
} else if (worst) {
  rows.push({ id: worst.ids[0], drop: worst.drop });
}

rows.sort((a, b) => b.drop - a.drop);
console.log('layer hidden                      pale pixels removed');
for (const r of rows.slice(0, 12)) {
  if (r.drop <= 0) continue;
  console.log('  ' + r.id.padEnd(32) + String(r.drop).padStart(8)
              + '   ' + (100 * r.drop / base).toFixed(1) + '%');
}
const top = rows[0];
console.log('\nlargest single contributor: ' + top.id + '  (' + top.drop + ' px)');
console.log('Hiding a layer also reveals what is behind it — read the two frames');
console.log('before blaming it. shots/night-pale-before.png');

await browser.__done();
