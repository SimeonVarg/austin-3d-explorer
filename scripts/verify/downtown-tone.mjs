/**
 * downtown-tone.mjs — is downtown actually darker than campus, and by how much?
 *
 * QUEUE E1 asks a question the magenta mask (HANDOFF §48) CANNOT answer.
 * `outer-tower` is painted with `fill-extrusion-pattern`, so it ignores
 * `fill-extrusion-color` outright and every colour-mask probe measures it at
 * ZERO pixels forever — `outer-detail-mask.mjs` says so in its own header.
 *
 * So this masks by VISIBILITY instead of by colour: read the frame, hide one
 * layer, read again, and the pixels that CHANGED are the pixels that layer was
 * the frontmost thing in. Then read the ORIGINAL colours at exactly that set.
 * That works on a textured layer, an untextured one, and anything else, because
 * it never asks what colour the layer was supposed to be.
 *
 * The cost is that it is one page load per layer measured, and that hiding a
 * tall layer reveals sky behind it — which is fine, we only ever read the base
 * frame's pixels at the mask, never the hidden frame's.
 *
 * Noise floor: §34 measured 48% of pixels differing between two frames at the
 * SAME pose (clouds, AA, the light animation). A hidden layer is a big change;
 * noise is not. Hence the d>=70 sum-of-channels floor and the two-reads-agree
 * loop from §37.
 *
 *   VERIFY_URL=http://127.0.0.1:8161 node scripts/verify/downtown-tone.mjs \
 *     --tod 0.30 --extra "&tiles=0"
 */
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const TOD = parseFloat(opt('--tod', '0.30'));
const EXTRA = opt('--extra', '');
// The tour's own downtown-skyline pose — the frame Simeon is complaining about.
const POSE = {
  center: [parseFloat(opt('--lng', '-97.7420')), parseFloat(opt('--lat', '30.2760'))],
  zoom: parseFloat(opt('--zoom', '15.2')),
  pitch: parseFloat(opt('--pitch', '74')),
  bearing: parseFloat(opt('--bearing', '200')),
};
// Ordered so the interesting comparison is adjacent in the output.
const LAYERS = (opt('--layers',
  'outer-tower,outer-tower-roof,outer-detail,outer-3d,buildings-3d')).split(',');

const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

const browser = await launch(chromium, { gl: 'hardware' });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('pageerror', e => console.log('  [pageerror] ' + e.message));

await page.goto(BASE + '/_harness.html?intro=0&drift=0' + EXTRA,
                { waitUntil: 'networkidle', timeout: 180000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
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
// RE-APPLY THE HOUR AFTER THE MOVE, AND CHECK IT TOOK.
//
// Setting it once before jumpTo is not enough and the failure is silent: a
// --tod 0.95 run came back with luma byte-identical to the 0.30 run at the
// same pose — 116.4 against 116.5, 136.8 against 136.8 — i.e. it had measured
// a daylit frame and called it night. Two numbers that agree to a decimal
// across a day/night change are not a result, they are the same frame twice.
await page.evaluate(v => {
  if (typeof window.applyTimeOfDay === 'function') window.applyTimeOfDay(window.__map, v, true);
}, TOD);
await page.waitForTimeout(2500);
const gotP = await page.evaluate(() => window.__todCurrentP);
if (gotP == null || Math.abs(gotP - TOD) > 0.02) {
  console.log(`  *** tod did not take: asked ${TOD}, page says ${gotP} — the numbers below are not about ${TOD} ***`);
}

await page.evaluate(() => {
  window.__dt = {
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
    async settle() {
      const m = window.__map;
      m.triggerRepaint();
      await new Promise(r => {
        if (m.loaded() && m.areTilesLoaded()) return setTimeout(r, 500);
        m.once('idle', r); setTimeout(r, 20000);
      });
    },
  };
});

const present = [];
for (const id of LAYERS) {
  if (await page.evaluate(i => !!window.__map.getLayer(i), id)) present.push(id);
  else console.log(`  *** layer ${id} is MISSING — not measured ***`);
}
console.log(`tod ${TOD}  extra "${EXTRA}"  pose ${POSE.center} z${POSE.zoom} p${POSE.pitch} b${POSE.bearing}`);

await page.evaluate(async () => { window.__dt.base = await window.__dt.read(); });

/** Mean colour of the base frame over the pixels this layer is frontmost in. */
async function measureOne(id) {
  const run = () => page.evaluate(async layer => {
    const m = window.__map;
    m.setLayoutProperty(layer, 'visibility', 'none');
    await window.__dt.settle();
    await new Promise(r => setTimeout(r, 700));
    const shot = await window.__dt.read();
    m.setLayoutProperty(layer, 'visibility', 'visible');
    await window.__dt.settle();

    const base = window.__dt.base, n = base.w * base.h;
    let cnt = 0, r = 0, g = 0, b = 0, L = 0;
    for (let p = 0; p < n; p++) {
      const k = p * 4;
      const d = Math.abs(shot.px[k] - base.px[k])
              + Math.abs(shot.px[k + 1] - base.px[k + 1])
              + Math.abs(shot.px[k + 2] - base.px[k + 2]);
      if (d < 70) continue;                       // §34 noise floor
      cnt++; r += base.px[k]; g += base.px[k + 1]; b += base.px[k + 2];
      L += 0.299 * base.px[k] + 0.587 * base.px[k + 1] + 0.114 * base.px[k + 2];
    }
    return { px: cnt, total: n,
             r: cnt ? r / cnt : 0, g: cnt ? g / cnt : 0, b: cnt ? b / cnt : 0,
             luma: cnt ? L / cnt : 0 };
  }, id);

  let a = await run(), b = await run(), tries = 0;
  const agree = (x, y) => Math.abs(x.px - y.px) <= Math.max(60, x.px * 0.03);
  while (!agree(a, b) && tries++ < 4) { a = b; b = await run(); }
  if (!agree(a, b)) console.log(`  *** ${id}: two reads never agreed (${a.px} vs ${b.px}) ***`);
  return b;
}

const out = {};
for (const id of present) {
  const m = await measureOne(id);
  out[id] = m;
  const hex = '#' + [m.r, m.g, m.b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  console.log(`  ${id.padEnd(18)} ${String(m.px).padStart(8)} px ` +
              `${String((100 * m.px / m.total).toFixed(2)).padStart(6)}%  ` +
              `mean rgb ${Math.round(m.r).toString().padStart(3)},` +
              `${Math.round(m.g).toString().padStart(3)},${Math.round(m.b).toString().padStart(3)} ` +
              `${hex}  luma ${m.luma.toFixed(1)}`);
  if (!m.px) console.log('    *** owns NOTHING — a layer the camera can see must own pixels ***');
}

const t = out['outer-tower'], c = out['buildings-3d'];
if (t && c && t.px && c.px) {
  console.log(`\ndowntown tower walls vs campus walls: ` +
              `luma ${t.luma.toFixed(1)} vs ${c.luma.toFixed(1)} ` +
              `= ${(t.luma / c.luma).toFixed(2)}x`);
}
await browser.close();
