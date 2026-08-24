/**
 * occluder.mjs — WHAT is standing over the lamps the audit found invisible?
 *
 * litaudit.mjs found two places where the card counts a mapped street lamp and
 * the night frame shows nothing, and its occlusion probe brought ~2,950 lamp
 * pixels back by hiding trees AND buildings AND ground in one go. That is not
 * an attribution, it is a bundle — and a bundle is how you ship a fix for the
 * wrong layer. canopy.mjs then failed to reproduce it by hiding trees alone,
 * which is the signal that the bundle was hiding the real culprit.
 *
 * So: at each flagged lamp, hide ONE family at a time and measure what appears.
 * Whatever family produces the reveal is the occluder, and only that one.
 *
 * Usage: VERIFY_URL=http://127.0.0.1:8714 node shots/walk/lit/occluder.mjs
 */
import { chromium } from '../../../scripts/verify/node_modules/playwright-core/index.mjs';
import { BASE, launch } from '../../../scripts/verify/chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';

const OUT = 'shots/walk/lit';
const TOD = 0.92, SITE_ZOOM = 19.8, DISC_M = 25;
// The lamps litaudit.mjs flagged, plus the two lamps nearest them, taken from
// its own JSON rather than retyped.
const SITES = [
  { name: 'flag-A', at: [-97.734713, 30.288976] },
  { name: 'flag-B', at: [-97.734751, 30.289287] },
];
const FAMILIES = {
  trees: /^trees-/,
  buildings: /^(buildings-|roofs-|roofscape-|west-|drag-|tower-|moody-|arts-|stadium-|places-|outer-)/,
  ground: /^ground-/,
};

fs.mkdirSync(OUT, { recursive: true });
const log = [];
const say = (s) => { console.log(s); log.push(s); };

const browser = await launch(chromium, { gl: 'hardware' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', e => say('  [pageerror] ' + e.message));
await page.goto(BASE + '/_harness.html?intro=0&drift=0&walk=1', { waitUntil: 'networkidle', timeout: 180000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
await page.evaluate(() => { if (window.cancelGraphicsAutoDetect) window.cancelGraphicsAutoDetect(); });
await page.waitForFunction(() => !document.getElementById('veil'), null, { timeout: 120000 });
await page.evaluate((v) => {
  const el = document.getElementById('tod-slider');
  if (el) { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
  if (typeof window.applyTimeOfDay === 'function') window.applyTimeOfDay(window.__map, v, true);
}, TOD);
await page.waitForTimeout(2000);
const gotP = await page.evaluate(() => window.__todCurrentP);
if (gotP == null || Math.abs(gotP - TOD) > 0.02) { say(`FAIL: tod ${gotP}`); await browser.close(); process.exit(1); }
say(`# occluder — tod ${gotP}`);

await page.evaluate(() => {
  window.__oc = {
    async read() {
      const m = window.__map; m.triggerRepaint();
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const c = m.getCanvas();
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      const px = new Uint8Array(c.width * c.height * 4);
      gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return { w: c.width, h: c.height, px };
    },
    settle(ms) {
      return new Promise(r => {
        const m = window.__map; m.triggerRepaint();
        if (m.loaded() && m.areTilesLoaded()) return setTimeout(r, ms || 500);
        m.once('idle', () => setTimeout(r, ms || 500)); setTimeout(r, 20000);
      });
    },
    jump(q) { window.__map.jumpTo(q); },
  };
});

const layersOf = async (re) => page.evaluate((s) => {
  const rx = new RegExp(s);
  return window.__map.getStyle().layers.map(l => l.id).filter(id => rx.test(id));
}, re.source);
const fam = {};
for (const [k, re] of Object.entries(FAMILIES)) fam[k] = await layersOf(re);
for (const [k, v] of Object.entries(fam)) say(`${k}: ${v.length} layers`);

// mask props-lit green so the measurement is the LAMP, not any warm pixel
const MASKC = ['match', ['get', 'c'], 'blue', '#0000ff', '#00ff00'];
const shipped = await page.evaluate(() => ({
  lit: window.__map.getPaintProperty('props-lit', 'circle-color'),
  core: window.__map.getPaintProperty('props-lit-core', 'circle-color'),
}));
await page.evaluate((c) => {
  window.__map.setPaintProperty('props-lit', 'circle-color', c);
  window.__map.setPaintProperty('props-lit-core', 'circle-color', c);
}, MASKC);

const greenPx = (R) => page.evaluate(async (rad) => {
  const shot = await window.__oc.read();
  const cx = shot.w / 2, cy = shot.h / 2, R2 = rad * rad;
  let n = 0;
  for (let y = 0; y < shot.h; y++) {
    const dy = y - cy; if (dy * dy > R2) continue;
    for (let x = 0; x < shot.w; x++) {
      const dx = x - cx; if (dx * dx + dy * dy > R2) continue;
      const k = (y * shot.w + x) * 4;
      const Rc = shot.px[k], G = shot.px[k + 1], B = shot.px[k + 2];
      const mx = Math.max(Rc, G, B); if (mx < 12) continue;
      if (G > mx * 0.55 && !(Rc > mx * 0.55)) n++;
    }
  }
  return n;
}, R);

const rows = [];
for (const s of SITES) {
  const devR = await page.evaluate(([ll, z, m]) => {
    const map = window.__map;
    map.jumpTo({ center: ll, zoom: z, pitch: 0, bearing: 0 });
    const a = map.project(ll);
    const dLon = m / (111320 * Math.cos(ll[1] * Math.PI / 180));
    const b = map.project([ll[0] + dLon, ll[1]]);
    const c = map.getCanvas();
    return Math.hypot(b.x - a.x, b.y - a.y) * (c.width / c.clientWidth);
  }, [s.at, SITE_ZOOM, DISC_M]);
  await page.evaluate(() => window.__oc.settle(900));
  const base = await greenPx(devR);
  await page.screenshot({ path: path.join(OUT, `occl-${s.name}-shipped.png`) });
  const row = { site: s.name, shipped: base };
  for (const [k, ids] of Object.entries(fam)) {
    if (!ids.length) { row[k] = null; continue; }
    await page.evaluate((a) => { for (const id of a) window.__map.setLayoutProperty(id, 'visibility', 'none'); }, ids);
    await page.evaluate(() => window.__oc.settle(700));
    row[k] = await greenPx(devR);
    await page.screenshot({ path: path.join(OUT, `occl-${s.name}-no-${k}.png`) });
    await page.evaluate((a) => { for (const id of a) window.__map.setLayoutProperty(id, 'visibility', 'visible'); }, ids);
    await page.evaluate(() => window.__oc.settle(400));
  }
  // all three at once, the bundle litaudit used — kept so the two are comparable
  const all = [].concat(...Object.values(fam));
  await page.evaluate((a) => { for (const id of a) window.__map.setLayoutProperty(id, 'visibility', 'none'); }, all);
  await page.evaluate(() => window.__oc.settle(800));
  row.allThree = await greenPx(devR);
  await page.screenshot({ path: path.join(OUT, `occl-${s.name}-no-all.png`) });
  await page.evaluate((a) => { for (const id of a) window.__map.setLayoutProperty(id, 'visibility', 'visible'); }, all);
  await page.evaluate(() => window.__oc.settle(400));
  rows.push(row);
}
await page.evaluate((p) => {
  window.__map.setPaintProperty('props-lit', 'circle-color', p.lit);
  window.__map.setPaintProperty('props-lit-core', 'circle-color', p.core);
}, shipped);

console.table(rows);
say('lamp pixels in the 25 m disc, by what is hidden:');
say(JSON.stringify(rows, null, 1));
for (const r of rows) {
  const gains = Object.entries(r).filter(([k]) => k in FAMILIES).map(([k, v]) => [k, (v || 0) - r.shipped]);
  gains.sort((a, b) => b[1] - a[1]);
  say(`  ${r.site}: ${gains.map(([k, g]) => k + ' +' + g).join(', ')}  | all three +${r.allThree - r.shipped}`);
}
fs.writeFileSync(path.join(OUT, 'occluder.json'), JSON.stringify({ when: new Date().toISOString(), tod: gotP, rows }, null, 1));
fs.writeFileSync(path.join(OUT, 'occluder.log'), log.join('\n') + '\n');
await browser.close();
