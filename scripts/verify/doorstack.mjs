/**
 * doorstack.mjs — is ONE doorway being drawn by TWO door groups?
 *
 * `coplanar.mjs` can say that two features share a top plane and an outline. It
 * cannot say whether the two belong to the SAME door (a step tread capping the
 * cheek wall beside it — fine, and what HANDOFF §156 judged) or to two
 * DIFFERENT doors on two DIFFERENT buildings baked into the same two square
 * metres of wall (a bake defect, which looks fine in a still because the front
 * one hides the back one).
 *
 * That distinction is invisible in a finished frame and invisible in the pair
 * count. It IS visible if you draw each eid on its own: if `eid A alone` and
 * `eid B alone` each render a portal over the SAME pixels, the doorway is
 * doubled.
 *
 *   node doorstack.mjs <outDir> <posesJson> <eidA> <eidB>
 *
 * Four arms per pose at one identical camera:
 *   none   — every `entrances-*` layer hidden; the bare wall behind them
 *   both   — what ships
 *   onlyA  — every entrances layer filtered down to eid A alone
 *   onlyB  — ditto, eid B alone
 *
 * ONLY-THIS-EID, not all-but-that-eid. The first cut of this file dropped the
 * other eid and kept everything else, so `onlyA vs none` counted every door in
 * the viewport and came back with 110,030 px over half the frame — a number
 * that says nothing about the pair being judged.
 *
 * Each arm is reported as pixels-differing-from `none`, with a bounding box:
 * that is how much of the frame this door group is responsible for. onlyA and
 * onlyB both large over the SAME box is the doubling, and `overlapAB` counts
 * the pixels where the two arms disagree — small overlap on two large arms
 * means two doors sitting in each other.
 *
 * Pixels are read through the page canvas, like `zfight.mjs`: this suite has no
 * PNG decoder and handing framebuffers back over CDP is the twenty-minute, 2 GB
 * mistake in this directory's README.
 *
 * Traps shared with `doorwalk.mjs`, all already paid for:
 *   - entrances load LAZILY, so this WAITS for the source rather than poking it;
 *   - `cancelGraphicsAutoDetect()` first, or a slow launch has its preset
 *     downgraded mid-run and every tone in the frame moves;
 *   - the collision net can lift the eye off walking height silently, so
 *     `__fly.eye().alt` is read back and printed beside the picture.
 */
import { chromium } from 'playwright-core';
import { chromePath, launch } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';

const PORT = process.env.PORT || '8531';
const BASE = `http://127.0.0.1:${PORT}/index.html?intro=0&drift=0`;
const outDir = path.resolve(process.argv[2] || 'shots/close/doorstack');
const POSES = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const EID_A = Number(process.argv[4]);
const EID_B = Number(process.argv[5]);
fs.mkdirSync(outDir, { recursive: true });

const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.log('PAGEERR', e.message));

await page.goto(BASE, { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 90000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
await page.waitForFunction(() => {
  const m = window.__map, s = m.getSource('austin-entrances');
  return !!s && m.isSourceLoaded('austin-entrances');
}, null, { timeout: 150000 }).catch(() => console.log('WARN entrances source never loaded'));

// in-page frame store, same construction as zfight.mjs
await page.evaluate(() => {
  window.__ds = (function () {
    let cv = null, cx = null; const f = {};
    function grab(tag) {
      const gl = window.__map.getCanvas();
      if (!cv) { cv = document.createElement('canvas'); cv.width = gl.width; cv.height = gl.height;
                 cx = cv.getContext('2d', { willReadFrequently: true }); }
      cx.drawImage(gl, 0, 0);
      f[tag] = cx.getImageData(0, 0, cv.width, cv.height).data;
    }
    function diff(a, b) {
      const A = f[a], B = f[b], W = cv.width, H = cv.height;
      let n = 0, mx = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const d = Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]),
                           Math.abs(A[i + 2] - B[i + 2]));
        if (d > mx) mx = d;
        if (d > 24) { n++;
          if (x < x0) x0 = x; if (y < y0) y0 = y;
          if (x > x1) x1 = x; if (y > y1) y1 = y; }
      }
      return { n, mx, box: x1 < 0 ? null : [x0, y0, x1, y1], total: W * H };
    }
    return { grab, diff };
  })();
});

const M_LAT = 40030228.884 / 360;
const repose = (s, dist) => {
  const mlon = Math.cos(s.door[1] * Math.PI / 180) * M_LAT;
  const back = dist - s.dist;
  return { ...s, dist,
    pitch: Math.atan2(dist, s.alt) * 180 / Math.PI,
    eye: [s.eye[0] - Math.sin(s.bearing * Math.PI / 180) * back / mlon,
          s.eye[1] - Math.cos(s.bearing * Math.PI / 180) * back / M_LAT] };
};

const place = (s) => page.evaluate((s) => {
  const m = window.__map, rad = d => d * Math.PI / 180;
  const C = 40030228.884, ML = C / 360, mLon = lat => ML * Math.cos(rad(lat));
  const fov = m.getVerticalFieldOfView ? m.getVerticalFieldOfView() : 58;
  const camPx = 0.5 * m.getCanvas().clientHeight / Math.tan(rad(fov) / 2);
  const [elng, elat] = s.eye, lead = s.alt * Math.tan(rad(s.pitch));
  const cLat = elat + lead * Math.cos(rad(s.bearing)) / ML;
  const cLng = elng + lead * Math.sin(rad(s.bearing)) / mLon(elat);
  const D = s.alt / Math.cos(rad(s.pitch));
  const z = Math.log2(C * Math.cos(rad(cLat)) * camPx / (512 * D));
  if (m.isEasing && m.isEasing()) m.stop();
  m.jumpTo({ center: [cLng, cLat], zoom: z, bearing: s.bearing, pitch: s.pitch });
  if (typeof window.applyTimeOfDay === 'function') window.applyTimeOfDay(m, 0.30);
}, s);

const baseFilters = await page.evaluate(() => {
  const m = window.__map, out = {};
  for (const l of m.getStyle().layers) {
    if (!l.id.startsWith('entrances-')) continue;
    out[l.id] = m.getFilter(l.id) || null;
  }
  return out;
});
console.log('entrances layers:', Object.keys(baseFilters).join(' '));

const arm = (spec) => page.evaluate(({ spec, baseFilters }) => {
  const m = window.__map;
  for (const id of Object.keys(baseFilters)) {
    if (!m.getLayer(id)) continue;
    m.setLayoutProperty(id, 'visibility', spec === 'none' ? 'none' : 'visible');
    if (spec === 'none') continue;
    const own = baseFilters[id];
    const f = spec === 'both' ? own
      : (own ? ['all', own, ['==', ['get', 'eid'], spec.only]]
             : ['==', ['get', 'eid'], spec.only]);
    m.setFilter(id, f);
  }
}, { spec, baseFilters });

async function settle() {
  await page.waitForTimeout(1200);
  await page.evaluate(() => new Promise(r => {
    const m = window.__map; if (m.loaded()) return r(); m.once('idle', r); setTimeout(r, 4000);
  }));
  await page.evaluate(() => window.__map.triggerRepaint());
  await page.waitForTimeout(700);
}

const manifest = [];
for (const s of POSES) {
  // Re-pose outward until the collision net stops lifting the eye, exactly as
  // doorwalk.mjs does. Without this, a 15 m standoff inside a padded probe
  // radius throws the camera onto a roof and reports eyeAlt 1.70 anyway.
  let placed = s, eyeAlt = null;
  for (const dist of [s.dist, 22, 26, 30, 42, 60]) {
    placed = repose(s, dist);
    await place(placed);
    await page.waitForTimeout(800);
    eyeAlt = await page.evaluate(() => { try { return +window.__fly.eye().alt.toFixed(2); }
                                         catch (e) { return null; } });
    if (eyeAlt !== null && eyeAlt < s.alt * 2.2) break;
  }
  const eye = await page.evaluate(() => {
    const m = window.__map; let e = null;
    try { e = window.__fly.eye(); } catch (err) {}
    return { alt: e ? +e.alt.toFixed(2) : null, zoom: +m.getZoom().toFixed(3), pitch: +m.getPitch().toFixed(2) };
  });

  for (const [tag, spec] of [['none', 'none'], ['both', 'both'],
                             ['onlyA', { only: EID_A }], ['onlyB', { only: EID_B }]]) {
    await arm(spec);
    await settle();
    const file = path.join(outDir, `${s.name}-${tag}.png`);
    await page.screenshot({ path: file });
    await page.waitForTimeout(350);
    await page.screenshot({ path: file });        // twice, trust the second
    await page.evaluate((t) => window.__ds.grab(t), tag);
  }
  await arm('both');

  const row = { name: s.name, ...eye, eidA: EID_A, eidB: EID_B };
  for (const t of ['both', 'onlyA', 'onlyB']) {
    row[t] = await page.evaluate((t) => window.__ds.diff(t, 'none'), t);
  }
  row.onlyA_vs_onlyB = await page.evaluate(() => window.__ds.diff('onlyA', 'onlyB'));
  manifest.push(row);
  fs.writeFileSync(path.join(outDir, '_manifest.json'), JSON.stringify(manifest, null, 1));
  console.log(
    `${s.name.padEnd(16)} eyeAlt=${String(row.alt).padStart(5)}  ` +
    `both=${String(row.both.n).padStart(6)}  ` +
    `only${EID_A}=${String(row.onlyA.n).padStart(6)}@${row.onlyA.box}  ` +
    `only${EID_B}=${String(row.onlyB.n).padStart(6)}@${row.onlyB.box}  ` +
    `A^B=${row.onlyA_vs_onlyB.n}`);
}
await browser.__done();
