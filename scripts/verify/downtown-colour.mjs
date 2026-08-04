/**
 * downtown-colour.mjs — WHY does downtown read as a dark grey mass?
 *
 * QUEUE F3 names three candidate causes and asks for the one it is:
 *   1. a regression from the facade tile switch (PRs #84 / #94)
 *   2. what the source data actually says downtown looks like
 *   3. the atmospheric fade over-darkening at that distance
 *
 * `downtown-tone.mjs` already answers "how dark is downtown" — 119.7 luma
 * against campus's 102.2, i.e. downtown is BRIGHTER on its own. That number is
 * true and it is the wrong question, because nobody sees downtown against
 * campus: they see it against the pale hazy low city it stands IN. So this
 * script measures the thing an eye actually integrates, which is LOCAL
 * CONTRAST — the tower pixels against a dilated ring of the pixels immediately
 * around them — and then attributes it by switching one term at a time.
 *
 * THE MASK IS COMPUTED ONCE AND REUSED. `downtown-tone.mjs` re-derives its mask
 * per configuration, which is correct there and wrong here: the whole point is
 * to read the SAME pixels under different lighting terms. Geometry does not
 * move when the haze or the vertical gradient is switched, so the mask is
 * derived once (hide the layer, diff, §48) and every later configuration reads
 * the base frame at exactly that index set.
 *
 * Configurations, each one a single term switched at runtime so there is one
 * build and one session (§53's controlled A/B):
 *   base        as the site serves it
 *   haze=off    window.HAZE_TUNE.on = false               -> cause 3
 *   vg=off      fill-extrusion-vertical-gradient on the
 *               tower + midrise + flat layers             -> MapLibre's own
 *                                                            base darkening
 *   both=off    haze and vertical gradient together
 *
 *   VERIFY_URL=http://127.0.0.1:8172 node scripts/verify/downtown-colour.mjs \
 *     --tod 0.30
 */
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const TOD = parseFloat(opt('--tod', '0.30'));
const EXTRA = opt('--extra', '');
// The tour's own downtown-skyline pose — the frame he is complaining about.
const POSE = {
  center: [parseFloat(opt('--lng', '-97.7420')), parseFloat(opt('--lat', '30.2760'))],
  zoom: parseFloat(opt('--zoom', '15.2')),
  pitch: parseFloat(opt('--pitch', '74')),
  bearing: parseFloat(opt('--bearing', '200')),
};
const LAYERS = (opt('--layers', 'outer-tower,outer-3d,buildings-3d')).split(',');

const browser = await launch(chromium, { gl: 'hardware' });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('pageerror', e => console.log('  [pageerror] ' + e.message));

await page.goto(BASE + '/_harness.html?intro=0&drift=0' + EXTRA,
                { waitUntil: 'networkidle', timeout: 180000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

const setTod = async v => page.evaluate(t => {
  const el = document.getElementById('tod-slider');
  if (el) {
    el.value = String(t);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  if (typeof window.applyTimeOfDay === 'function') window.applyTimeOfDay(window.__map, t, true);
}, v);

await setTod(TOD);
await page.waitForTimeout(2500);
await page.evaluate(q => window.__map.jumpTo(q), POSE);
await page.evaluate(() => new Promise(r => {
  const m = window.__map;
  if (m.loaded() && m.areTilesLoaded()) return r();
  m.once('idle', r); setTimeout(r, 30000);
}));
// Re-apply the hour AFTER the move and check it took — downtown-tone.mjs's own
// header records the run where it did not and the night numbers were a daylit
// frame.
await setTod(TOD);
await page.waitForTimeout(2500);
const gotP = await page.evaluate(() => window.__todCurrentP);
if (gotP == null || Math.abs(gotP - TOD) > 0.02) {
  console.log(`  *** tod did not take: asked ${TOD}, page says ${gotP} ***`);
  process.exitCode = 1;
}

await page.evaluate(() => {
  window.__dc = {
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
      await new Promise(r => setTimeout(r, 700));
    },
    masks: {},
  };
});

/** Index set of the pixels `layer` is the frontmost thing in (§48). */
async function deriveMask(id) {
  const run = () => page.evaluate(async layer => {
    const m = window.__map;
    const base = await window.__dc.read();
    m.setLayoutProperty(layer, 'visibility', 'none');
    await window.__dc.settle();
    const shot = await window.__dc.read();
    m.setLayoutProperty(layer, 'visibility', 'visible');
    await window.__dc.settle();
    const idx = [];
    for (let p = 0, n = base.w * base.h; p < n; p++) {
      const k = p * 4;
      const d = Math.abs(shot.px[k] - base.px[k])
              + Math.abs(shot.px[k + 1] - base.px[k + 1])
              + Math.abs(shot.px[k + 2] - base.px[k + 2]);
      if (d >= 70) idx.push(p);                   // §34 noise floor
    }
    window.__dc.masks[layer] = { idx, w: base.w, h: base.h };
    return idx.length;
  }, id);
  // Two reads must agree on the SIZE before the set is believed (§37).
  let a = await run(), b = await run(), tries = 0;
  while (Math.abs(a - b) > Math.max(60, a * 0.03) && tries++ < 4) { a = b; b = await run(); }
  if (Math.abs(a - b) > Math.max(60, a * 0.03))
    console.log(`  *** ${id}: mask size never settled (${a} vs ${b}) ***`);
  return b;
}

/**
 * A one-pixel-thick-ish RING just outside a mask — what the towers are seen
 * AGAINST. Built by dilating the mask by `r` and subtracting it, so it follows
 * the silhouette instead of being a hand-picked box (three of which have been
 * wrong in this repo).
 */
await page.evaluate(() => {
  window.__dc.surround = function (layer, r) {
    const m = window.__dc.masks[layer];
    const w = m.w, h = m.h, n = w * h;
    const inMask = new Uint8Array(n);
    for (const p of m.idx) inMask[p] = 1;
    const dil = new Uint8Array(n);
    for (const p of m.idx) {
      const x = p % w, y = (p / w) | 0;
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= h) continue;
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx; if (xx < 0 || xx >= w) continue;
          dil[yy * w + xx] = 1;
        }
      }
    }
    const out = [];
    for (let p = 0; p < n; p++) if (dil[p] && !inMask[p]) out.push(p);
    window.__dc.masks[layer + '~ring'] = { idx: out, w, h };
    return out.length;
  };
});

for (const id of LAYERS) {
  const px = await deriveMask(id);
  console.log(`  mask ${id.padEnd(14)} ${String(px).padStart(8)} px`);
  if (!px) { console.log('    *** owns NOTHING ***'); process.exitCode = 1; }
}
const ringPx = await page.evaluate(() => window.__dc.surround('outer-tower', 6));
console.log(`  mask outer-tower~ring ${String(ringPx).padStart(6)} px  (what the towers are seen against)`);

/**
 * Mean colour of the CURRENT frame over a stored mask, PLUS the luma spread.
 *
 * The spread is the number this whole script exists for. "A dark grey mass" is
 * two claims and only one of them is about darkness: a MASS is a thing with no
 * internal variation. Measured on the reference photograph (Wikimedia Commons,
 * "Austin Texas skyline, December 2023 - Day", resampled so the tower cluster
 * subtends the same pixels it does in this frame) the tower cluster's luma SD
 * is 35.6 and the low-rise around it 43.7 — white precast beside black glass
 * beside teal. A render whose towers all land within a few luma of each other
 * reads as one object no matter what its mean is.
 */
async function sample(names) {
  return page.evaluate(async keys => {
    const f = await window.__dc.read();
    const out = {};
    for (const key of keys) {
      const m = window.__dc.masks[key];
      let r = 0, g = 0, b = 0, L = 0;
      const lum = new Float64Array(m.idx.length);
      for (let i = 0; i < m.idx.length; i++) {
        const k = m.idx[i] * 4;
        r += f.px[k]; g += f.px[k + 1]; b += f.px[k + 2];
        const l = 0.299 * f.px[k] + 0.587 * f.px[k + 1] + 0.114 * f.px[k + 2];
        lum[i] = l; L += l;
      }
      const n = m.idx.length || 1;
      const mean = L / n;
      let v = 0;
      for (let i = 0; i < lum.length; i++) v += (lum[i] - mean) * (lum[i] - mean);
      const sorted = Array.from(lum).sort((a, b2) => a - b2);
      const q = t => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(t * sorted.length))] : 0;
      out[key] = { r: r / n, g: g / n, b: b / n, luma: mean, px: m.idx.length,
                   sd: Math.sqrt(v / n), p10: q(0.10), p50: q(0.50), p90: q(0.90) };
    }
    return out;
  }, names);
}

const KEYS = [...LAYERS, 'outer-tower~ring'];
const CONFIGS = [
  ['base', () => {}],
  ['haze off', () => { window.HAZE_TUNE.on = false; }],
  ['vgrad off', () => {
    window.HAZE_TUNE.on = true;
    for (const id of ['outer-tower', 'outer-midrise', 'outer-3d', 'outer-detail'])
      if (window.__map.getLayer(id))
        window.__map.setPaintProperty(id, 'fill-extrusion-vertical-gradient', false);
  }],
  // THE REGRESSION TEST QUEUE F3 ASKS FOR, run rather than reasoned about.
  // Before PRs #84/#94 the tile path had no `fb` join, so every downtown tower
  // fell through ['coalesce', ['get','wp'], 'mh00'] to the campus-hall pattern.
  // Setting the pattern to that literal reproduces the old frame exactly, in
  // this session, on this build.
  ['pre-#84', () => {
    window.HAZE_TUNE.on = true;
    for (const id of ['outer-tower', 'outer-midrise', 'outer-3d', 'outer-detail'])
      if (window.__map.getLayer(id))
        window.__map.setPaintProperty(id, 'fill-extrusion-vertical-gradient', true);
    window.__map.setPaintProperty('outer-tower', 'fill-extrusion-pattern', 'mh00');
  }],
  ['restore', () => {
    window.__map.setPaintProperty('outer-tower', 'fill-extrusion-pattern', window.__dc.pat);
  }],
];

await page.evaluate(() => {
  window.__dc.pat = window.__map.getPaintProperty('outer-tower', 'fill-extrusion-pattern');
});

console.log(`\ntod ${TOD}  extra "${EXTRA}"  pose ${POSE.center} z${POSE.zoom} p${POSE.pitch} b${POSE.bearing}`);
console.log('REFERENCE, scale-matched (Wikimedia "Austin Texas skyline, December 2023 - Day"):');
console.log('            towers luma 116.5 sd 35.6 B-R -0.3 | low-rise luma 127.9 sd 43.7 B-R -23.0');
console.log('            i.e. the real towers sit 11.4 luma BELOW the low city, not 20-30, and vary 3x as much\n');
console.log('config      layer               mean rgb        luma     sd   p10   p90   B-R   vs surround');
const rows = {};
for (const [name, fn] of CONFIGS) {
  await page.evaluate(f => { (new Function(f))(); }, '(' + fn.toString() + ')()');
  await page.evaluate(() => window.__dc.settle());
  const s = await sample(KEYS);
  rows[name] = s;
  const ring = s['outer-tower~ring'];
  for (const key of KEYS) {
    const m = s[key];
    const rel = (key === 'outer-tower')
      ? `  ${(m.luma - ring.luma).toFixed(1)} luma` : '';
    console.log(`${name.padEnd(11)} ${key.padEnd(19)} ` +
      `${Math.round(m.r).toString().padStart(3)},${Math.round(m.g).toString().padStart(3)},${Math.round(m.b).toString().padStart(3)}  ` +
      `${m.luma.toFixed(1).padStart(6)} ${m.sd.toFixed(1).padStart(6)} ` +
      `${m.p10.toFixed(0).padStart(5)} ${m.p90.toFixed(0).padStart(5)} ` +
      `${(m.b - m.r).toFixed(1).padStart(6)}${rel}`);
  }
  console.log('');
}

const d = (a, b, key) => (rows[a][key].luma - rows[b][key].luma);
console.log('ATTRIBUTION on the tower walls (luma):');
console.log(`  the haze contributes         ${d('base', 'haze off', 'outer-tower').toFixed(1)}`);
console.log(`  the vertical gradient        ${d('base', 'vgrad off', 'outer-tower').toFixed(1)}`);
console.log(`  the #84/#94 buckets, vs mh00 ${d('base', 'pre-#84', 'outer-tower').toFixed(1)}   ` +
            `(sd ${rows['base']['outer-tower'].sd.toFixed(1)} vs ${rows['pre-#84']['outer-tower'].sd.toFixed(1)})`);
console.log(`  base restored (drift check)  ${(rows['restore']['outer-tower'].luma - rows['base']['outer-tower'].luma).toFixed(1)}`);

await browser.close();
