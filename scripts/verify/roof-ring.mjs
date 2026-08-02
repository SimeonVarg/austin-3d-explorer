/**
 * roof-ring.mjs — WHICH layer paints the burnt-orange band round every flat roof?
 *
 * HANDOFF §35 item 2 says the ring is `buildings-roof` (the parapet cap, painted
 * from the building's own terracotta `rd`) showing round the outside of
 * `roofscape-deck` (the membrane deck, inset 1.1 m and painted from its own
 * sampled colour). That is a claim about which of ~46 fill-extrusion layers owns
 * a few pixels of screen, and QUEUE's trap list says a guessed screen box has
 * been wrong three times in this repo.
 *
 * So this does not guess. It is the magenta-mask trick (HANDOFF §48): repaint
 * the suspect layers in flat primaries, read the framebuffer back once, and
 * every pixel that changed to a primary is a pixel that layer owns. Then read
 * the ORIGINAL colours back at exactly those coordinates. No screen box, no
 * eyeballing, no z-order reasoning.
 *
 * THREE LAYERS IN ONE READ, and that is not a nicety. The first draft masked one
 * layer at a time and each pass cost 3-4 minutes — a `setPaintProperty` on a
 * layer this large re-uploads paint buffers for every loaded tile — so a
 * six-layer run hit the 900 s watchdog with half its answers missing, twice.
 * One paint change, one readPixels.
 *
 * IT ALSO ANSWERS THE "AFTER" QUESTION DIRECTLY: how many burnt-orange pixels
 * are there in the frame at all, and who owns them. A fix that moved the ring
 * somewhere else would show up as the same count under a different layer.
 *
 * Reads through `_harness.html` because index.html does not set
 * preserveDrawingBuffer and readPixels on a swapped buffer returns black. Run
 * `harness-drift.mjs` first — a harness missing js/tiles.js measures a city with
 * no vector tiles in it.
 *
 * Usage:
 *   VERIFY_URL=http://127.0.0.1:8141 node scripts/verify/roof-ring.mjs --tag before
 */
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';
import fs from 'node:fs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const TAG = opt('--tag', 'before');
const TOD = parseFloat(opt('--tod', '0.30'));           // tour.mjs's `day`
// `--extra "&roofcaps=0"` puts every parapet cap back on the building's own
// terracotta, so BEFORE and AFTER come out of one build in one session.
const EXTRA = opt('--extra', '');
// tour.mjs's `tower-close`, the frame Simeon named.
const POSE = { center: [-97.7392, 30.2860], zoom: 17.4, pitch: 72, bearing: 20 };
// layer id -> the flat primary it is repainted in for one frame.
const MARK = {
  'buildings-roof': '#ff00ff',      // magenta — the parapet cap
  'roofscape-deck': '#00ff00',      // green   — the membrane deck
  'roofs-pitched':  '#0000ff',      // blue    — real tiled roofs
};

fs.mkdirSync('shots/roofring', { recursive: true });

const browser = await launch(chromium, { gl: 'hardware' });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('pageerror', e => console.log('  [pageerror] ' + e.message));

await page.goto(BASE + '/_harness.html?intro=0&drift=0' + EXTRA, { waitUntil: 'networkidle', timeout: 180000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

// Both paths, always — an element existing is not a handler running (night-pale.mjs).
await page.evaluate(v => {
  const el = document.getElementById('tod-slider');
  if (el) {
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  if (typeof window.applyTimeOfDay === 'function') window.applyTimeOfDay(window.__map, v, true);
}, TOD);
await page.waitForTimeout(2500);

await page.evaluate(q => window.__map.jumpTo(q), POSE);
await page.evaluate(() => new Promise(r => {
  const m = window.__map;
  if (m.loaded() && m.areTilesLoaded()) return r();
  m.once('idle', r); setTimeout(r, 30000);
}));
await page.waitForTimeout(2000);

await page.evaluate(() => {
  window.__rr = {
    // ASSERT THE EFFECT, NEVER THE INTENTION. `triggerRepaint` SCHEDULES a
    // frame; `readPixels` straight after it returns the PREVIOUS one. A first
    // draft did exactly that and, on the run where MapLibre took longer than
    // the fixed wait to re-upload paint buffers for a large layer, reported
    // `buildings-roof owns 0 px` on a frame that visibly had the orange ring in
    // it. Two rendered frames are waited for, and the caller checks the count.
    async read() {
      const m = window.__map;
      m.triggerRepaint();
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const c = m.getCanvas();
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      const w = c.width, h = c.height;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return { w, h, px };
    },
  };
});
await page.evaluate(async () => { window.__rr.base = await window.__rr.read(); });
const dims = await page.evaluate(() => ({ w: window.__rr.base.w, h: window.__rr.base.h }));
await page.screenshot({ path: `shots/roofring/${TAG}-frame.png` });
console.log(`frame ${dims.w}x${dims.h}  ->  shots/roofring/${TAG}-frame.png`);

const present = await page.evaluate(m => Object.keys(m).filter(id => !!window.__map.getLayer(id)), MARK);
console.log('layers present:', present.join(', '));

const prior = await page.evaluate(ids => Object.fromEntries(
  ids.map(id => [id, window.__map.getPaintProperty(id, 'fill-extrusion-color')])), present);
await page.evaluate(([ids, mark]) => {
  for (const id of ids) window.__map.setPaintProperty(id, 'fill-extrusion-color', mark[id]);
}, [present, MARK]);
// A paint change on a layer this size re-uploads a vertex attribute for every
// LOADED TILE, and MapLibre does that lazily. A fixed 1.2 s wait was enough on
// a quiet machine and not enough with four other agents' browsers on the box:
// the same pose measured 181,051 px for `roofs-pitched` and then 11,224, and
// `buildings-roof` came back as ZERO on a frame that visibly had the ring in
// it. So wait for the map's own idle, not for a clock.
await page.evaluate(() => new Promise(r => {
  const m = window.__map;
  m.triggerRepaint();
  if (m.loaded() && m.areTilesLoaded()) return setTimeout(r, 500);
  m.once('idle', r); setTimeout(r, 25000);
}));
await page.waitForTimeout(2500);

const measure = () => page.evaluate(async ([ids, mark]) => {
  const rr = window.__rr, base = rr.base, shot = await rr.read();
  const W = base.w, H = base.h, n = W * H;
  const own = new Int8Array(n).fill(-1);
  const acc = ids.map(() => ({ n: 0, r: 0, g: 0, b: 0 }));
  const hex = id => {
    const s = mark[id];
    return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
  };
  const want = ids.map(hex);
  for (let p = 0; p < n; p++) {
    const k = p * 4;
    if (shot.px[k] === base.px[k] && shot.px[k + 1] === base.px[k + 1] && shot.px[k + 2] === base.px[k + 2]) continue;
    for (let i = 0; i < want.length; i++) {
      const [wr, wg, wb] = want[i];
      // Nearest-primary, with a wide tolerance: the frame is composited and a
      // marked surface can pick up a little of the sun tint on its top face.
      if (Math.abs(shot.px[k] - wr) < 70 && Math.abs(shot.px[k + 1] - wg) < 70 && Math.abs(shot.px[k + 2] - wb) < 70) {
        own[p] = i; acc[i].n++;
        acc[i].r += base.px[k]; acc[i].g += base.px[k + 1]; acc[i].b += base.px[k + 2];
        break;
      }
    }
  }
  // Every BURNT-ORANGE pixel in the frame, and who owns it. This is the number
  // the fix has to move: "orange" is red beating blue by 55 and a luma a roof
  // can reach in daylight — it catches roof tile and not the tan ground.
  const orange = ids.map(() => 0);
  let orangeTotal = 0, orangeOther = 0;
  for (let p = 0; p < n; p++) {
    const k = p * 4;
    const R = base.px[k], G = base.px[k + 1], B = base.px[k + 2];
    if (!(R - B > 55 && R > 110 && G < R - 40)) continue;
    orangeTotal++;
    if (own[p] >= 0) orange[own[p]]++; else orangeOther++;
  }
  // Is the cap a RIM round the deck? Distance from each cap pixel to the
  // nearest deck pixel, searched outward to 6 px.
  const ci = ids.indexOf('buildings-roof'), di = ids.indexOf('roofscape-deck');
  let capN = 0, capNear = 0;
  if (ci >= 0 && di >= 0) {
    for (let y = 6; y < H - 6; y++) for (let x = 6; x < W - 6; x++) {
      const p = y * W + x;
      if (own[p] !== ci) continue;
      capN++;
      let hit = false;
      for (let dy = -2; dy <= 2 && !hit; dy++) for (let dx = -2; dx <= 2; dx++) {
        if (own[(y + dy) * W + (x + dx)] === di) { hit = true; break; }
      }
      if (hit) capNear++;
    }
  }
  return {
    total: n,
    layers: ids.map((id, i) => ({
      id, px: acc[i].n,
      mean: [Math.round(acc[i].r / Math.max(1, acc[i].n)),
             Math.round(acc[i].g / Math.max(1, acc[i].n)),
             Math.round(acc[i].b / Math.max(1, acc[i].n))],
      orange: orange[i],
    })),
    orangeTotal, orangeOther, capN, capNear,
  };
}, [present, MARK]);

// SCREENSHOT TWICE, TRUST THE SECOND — and here, keep reading until two
// consecutive reads agree, because a half-uploaded repaint is not a null
// result, it is a wrong one.
let r = await measure(), prev = null;
for (let i = 0; i < 5; i++) {
  const agree = prev && r.layers.every((L, j) =>
    L.px > 0 && Math.abs(L.px - prev.layers[j].px) <= 0.02 * Math.max(L.px, 1));
  if (agree) break;
  if (prev) console.log('  reads still moving — re-reading');
  prev = r;
  await page.waitForTimeout(4000);
  r = await measure();
}
if (r.layers.some(L => L.px === 0)) {
  console.error('FAIL: ' + r.layers.filter(L => L.px === 0).map(L => L.id).join(', ')
    + ' own no pixels — the mask did not take, do not read the numbers below');
  process.exitCode = 1;
}

await page.evaluate(p => { for (const [id, v] of Object.entries(p)) window.__map.setPaintProperty(id, 'fill-extrusion-color', v); }, prior);

console.log('\n  layer               own px    original colour     of which burnt orange');
for (const L of r.layers) {
  console.log(`  ${L.id.padEnd(18)} ${String(L.px).padStart(7)}    rgb(${L.mean.join(',')})`.padEnd(56)
    + `${String(L.orange).padStart(8)}  (${(100 * L.orange / Math.max(1, L.px)).toFixed(1)}% of the layer)`);
}
console.log(`\n  burnt-orange pixels in the whole frame: ${r.orangeTotal}`
  + `   owned by none of the three: ${r.orangeOther}`);
console.log(`  cap pixels with a deck pixel within 2 px: ${r.capNear} / ${r.capN}`
  + ` (${(100 * r.capNear / Math.max(1, r.capN)).toFixed(1)}%) — that is the rim`);

fs.writeFileSync(`shots/roofring/${TAG}.json`, JSON.stringify({ tag: TAG, tod: TOD, pose: POSE, ...r }, null, 2));
await browser.close();
