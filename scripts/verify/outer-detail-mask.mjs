/**
 * outer-detail-mask.mjs — which pixels does the downtown detail own, and are
 * they dark at night?
 *
 * §35 item 1 is the failure this exists to rule out: a surface that keeps a
 * daylit colour while the city goes dark, and whose brightness is invisible to
 * a fixed threshold because the frame's own median has moved. So the test is
 * RELATIVE — the detail layer's mean luma against the frame's median, at the
 * same pose, in the same run.
 *
 * Magenta-mask (HANDOFF §48): repaint, read back, RECORD WHICH PIXELS CHANGED,
 * then read the original colours at exactly that set. No hand-picked box.
 * Waits for the map's own idle and re-reads until two reads agree (§37).
 *
 *   VERIFY_URL=http://127.0.0.1:8155 node scripts/verify/outer-detail-mask.mjs --tod 0.95
 */
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const TOD = parseFloat(opt('--tod', '0.30'));
const EXTRA = opt('--extra', '&tiles=0');
const POSE = { center: [-97.7430, 30.2665], zoom: 16.2, pitch: 68, bearing: 20 };
const MARK = {
  'outer-detail': '#ff00ff',   // crowns, masts, ground bands, park pads
  // NOTE: `outer-tower` is painted with fill-extrusion-PATTERN, so setting
  // fill-extrusion-color on it does nothing and it will always measure 0 px.
  // That is not a defect and not a null result — it is the layer telling you it
  // is textured. Masking it needs `fill-extrusion-pattern`, which needs a
  // registered atlas image, which is a different instrument.
  'outer-tower':  '#00ff00',   // tower walls, podiums, jenga blocks, taper steps
  'outer-3d':     '#0000ff',   // the 7,511 low-rise prisms
};

const browser = await launch(chromium, { gl: 'hardware' });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('pageerror', e => console.log('  [pageerror] ' + e.message));

await page.goto(BASE + '/_harness.html?intro=0&drift=0' + EXTRA, { waitUntil: 'networkidle', timeout: 180000 });
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
await page.waitForTimeout(2000);

await page.evaluate(() => {
  window.__odm = {
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
await page.evaluate(async () => { window.__odm.base = await window.__odm.read(); });

const present = await page.evaluate(m => Object.keys(m).filter(id => !!window.__map.getLayer(id)), MARK);
console.log('tod', TOD, '| layers present:', present.join(', '));
if (present.length !== 3) console.log('  *** a layer is MISSING — the answer below is not the answer ***');

const prior = await page.evaluate(ids => Object.fromEntries(
  ids.map(id => [id, window.__map.getPaintProperty(id, 'fill-extrusion-color')])), present);
await page.evaluate(([ids, mark]) => {
  for (const id of ids) window.__map.setPaintProperty(id, 'fill-extrusion-color', mark[id]);
}, [present, MARK]);
await page.evaluate(() => new Promise(r => {
  const m = window.__map;
  m.triggerRepaint();
  if (m.loaded() && m.areTilesLoaded()) return setTimeout(r, 600);
  m.once('idle', r); setTimeout(r, 25000);
}));
await page.waitForTimeout(2500);

const measure = () => page.evaluate(async ([ids, mark]) => {
  const base = window.__odm.base, shot = await window.__odm.read();
  const n = base.w * base.h;
  // DO NOT TEST FOR THE AUTHORED HEX. HANDOFF §36 point 4: this scene is lit
  // and colour-graded, so a wall painted #ff00ff arrives on screen at about
  // (236,42,154) — B is 154, not 255. The first version of this asked for each
  // channel within 40 of the authored value, and reported that `outer-detail`
  // owned ZERO pixels on a frame where a screenshot shows every crown, every
  // mast, every ground band and every park pad in magenta
  // (shots/dt-mask/magenta.png). A wrong instrument reading zero is the exact
  // shape of a null result, which is why it has to be checked with a picture.
  //
  // So classify by DIRECTION, not by value: normalise the pixel and take the
  // closest mark by cosine. Grading scales and warms a colour; it does not
  // move magenta onto green.
  const norm = v => { const L = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / L, v[1] / L, v[2] / L]; };
  const want = ids.map(id => norm([parseInt(mark[id].slice(1, 3), 16),
                                   parseInt(mark[id].slice(3, 5), 16),
                                   parseInt(mark[id].slice(5, 7), 16)]));
  const acc = ids.map(() => ({ n: 0, luma: 0, hi: 0, max: 0 }));
  const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
  const all = [];
  for (let p = 0; p < n; p++) {
    const k = p * 4;
    const L = lum(base.px[k], base.px[k + 1], base.px[k + 2]);
    // Sky is excluded from the frame median the same way night-pale.mjs does:
    // the top of the frame is not a surface and would drag the median.
    const y = Math.floor(p / base.w);
    if (y < base.h * 0.62) all.push(L);        // gl origin is bottom-left
    const d = Math.abs(shot.px[k] - base.px[k]) + Math.abs(shot.px[k + 1] - base.px[k + 1])
            + Math.abs(shot.px[k + 2] - base.px[k + 2]);
    // A floor, because §34 measured 48% of pixels differing between two frames
    // at the SAME pose — clouds, AA and the light animation. A mask is a big
    // change; noise is not.
    if (d < 70) continue;
    const v = norm([shot.px[k], shot.px[k + 1], shot.px[k + 2]]);
    let best = -1, bs = 0.86;      // below this it is noise, not a mark
    for (let i = 0; i < ids.length; i++) {
      const s = v[0] * want[i][0] + v[1] * want[i][1] + v[2] * want[i][2];
      if (s > bs) { bs = s; best = i; }
    }
    if (best < 0) continue;
    acc[best].n++; acc[best].luma += L;
    if (L > 45) acc[best].hi++;
    if (L > acc[best].max) acc[best].max = L;
  }
  all.sort((a, b) => a - b);
  return {
    median: all.length ? all[Math.floor(all.length / 2)] : 0,
    total: n,
    per: ids.map((id, i) => ({
      id, px: acc[i].n,
      pct: +(100 * acc[i].n / n).toFixed(3),
      meanLuma: acc[i].n ? +(acc[i].luma / acc[i].n).toFixed(1) : 0,
      overFrameMedianX3: acc[i].hi,
      maxLuma: +acc[i].max.toFixed(1),
    })),
  };
}, [present, MARK]);

let a = await measure(), b = await measure(), tries = 0;
const agree = (x, y) => x.per.every((p, i) => Math.abs(p.px - y.per[i].px) <= Math.max(40, p.px * 0.02));
while (!agree(a, b) && tries++ < 4) { a = b; await page.waitForTimeout(1500); b = await measure(); }
if (!agree(a, b)) console.log('  *** two reads never agreed — under-settled, not a null result ***');

console.log(`frame median luma (below the horizon): ${b.median.toFixed(1)}`);
for (const p of b.per) {
  console.log(`  ${p.id.padEnd(13)} ${String(p.px).padStart(7)} px  ${String(p.pct).padStart(6)}%  ` +
              `mean luma ${String(p.meanLuma).padStart(6)}  max ${String(p.maxLuma).padStart(6)}  ` +
              `px over 45 luma ${p.overFrameMedianX3}`);
  if (!p.px && p.id !== 'outer-tower')
    console.log('    *** owns NOTHING — a layer the camera can see must own pixels ***');
  if (!p.px && p.id === 'outer-tower')
    console.log('    (expected: pattern-painted, fill-extrusion-color is ignored)');
}
await page.evaluate(p => { for (const [id, v] of Object.entries(p)) window.__map.setPaintProperty(id, 'fill-extrusion-color', v); }, prior);
await browser.close();
