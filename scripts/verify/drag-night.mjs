/**
 * drag-night.mjs — does the Drag pass silhouette at night, or glow?
 *
 * THE FAILURE THIS EXISTS TO CATCH. An unlit wall whose night tone is brighter
 * than the city around it inverts the skyline: the buildings read as pale
 * cut-outs against a darker sky instead of as a silhouette. This repo has
 * shipped that once already (the stadium deck at luma 70 against a city at 30,
 * see js/app.js's SEAT_COL note) and `night-silhouette.mjs` exists because of
 * it. A pass authoring its own materials is exactly where it comes back.
 *
 * WHY A MASK AND NOT AN EYEBALLED CROP. Comparing "a wall I think is ours" to
 * "a wall I think is generic" measures face ORIENTATION as much as material — a
 * north-facing wall and a sunward one differ by more than any palette choice,
 * because MapLibre shades extrusion faces per normal. And a crop of a 66-degree
 * view is mostly ROOF: eyeballing one led to twenty minutes spent on a "pale
 * wall at night" that was the parapet cap's top face.
 *
 * WHY A DIFFERENCE MASK AND NOT A KEY COLOUR. The first version of this script
 * painted each group flat magenta and matched the hex with a tolerance. At
 * night the post-process stack crushes magenta so far that the match found ZERO
 * pixels — and a zero-pixel mask reports luma -1, which the comparison then
 * passed. A vacuous pass is worse than a failure. So: render the frame, render
 * it again with the group hidden, and a pixel belongs to the group if hiding it
 * changed that pixel. That is exactly the right definition, it needs no colour
 * matching, and it cannot silently degrade to an empty set.
 *
 * Usage: VERIFY_URL=http://127.0.0.1:8127 node drag-night.mjs [p ...]
 */
import { chromium } from 'playwright-core';
import { chromePath, GL_ARGS, BASE } from './chrome.mjs';

const PS = process.argv.slice(2).length ? process.argv.slice(2).map(Number) : [0.14, 0.86];
// Low over the Drag with campus behind it, so both the pass and a large sample
// of generic city are in the same frame under the same light.
const POSE = { center: [-97.7412, 30.2862], zoom: 16.9, pitch: 70, bearing: 340 };
const DIFF = 6;   // per-channel delta that counts as "this group painted here"

const browser = await chromium.launch({
  executablePath: chromePath(), headless: true,
  args: [...GL_ARGS, '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', e => console.log('PAGEERR', e.message));

await page.goto(BASE + '/_harness.html?intro=0&drift=0', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });
await page.waitForFunction(() => window.__map.getLayer('drag-wall'), null, { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(6000);
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

const settle = async (ms = 2600) => {
  await page.waitForTimeout(ms);
  await page.evaluate(() => new Promise(r => {
    const m = window.__map; if (m.loaded()) return r(); m.once('idle', r); setTimeout(r, 12000);
  }));
  await page.evaluate(() => window.__map.triggerRepaint());
  await page.waitForTimeout(800);
};

// Grab the framebuffer into a page-side global. Never returned as an array:
// handing a 1280x800 buffer back through CDP once ran for twenty minutes at
// 2 GB of RSS before it was killed (scripts/verify/README.md).
const grab = (slot) => page.evaluate((slot) => {
  const c = window.__map.getCanvas();
  const gl = c.getContext('webgl2') || c.getContext('webgl');
  const b = new Uint8Array(c.width * c.height * 4);
  gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, b);
  window.__buf = window.__buf || {};
  window.__buf[slot] = b;
  window.__wh = [c.width, c.height];
}, slot);

const setVis = (ids, v) => page.evaluate(({ ids, v }) => {
  for (const id of ids) {
    try { if (window.__map.getLayer(id)) window.__map.setLayoutProperty(id, 'visibility', v); } catch (e) {}
  }
}, { ids, v });

const GROUPS = {
  drag: ['drag-wall', 'drag-cap'],
  city: ['buildings-3d', 'buildings-roof'],
};

const rows = [];
for (const p of PS) {
  await page.evaluate(({ POSE, p }) => {
    window.__map.jumpTo(POSE);
    window.applyTimeOfDay(window.__map, p, true);
  }, { POSE, p });
  await settle(3800);
  await grab('full');

  const out = { p };
  for (const [name, ids] of Object.entries(GROUPS)) {
    await setVis(ids, 'none');
    await settle(2200);
    await grab('hidden');
    await setVis(ids, 'visible');
    out[name] = await page.evaluate((DIFF) => {
      const A = window.__buf.full, B = window.__buf.hidden;
      let sum = 0, n = 0;
      for (let i = 0; i < A.length; i += 4) {
        if (Math.abs(A[i] - B[i]) < DIFF && Math.abs(A[i + 1] - B[i + 1]) < DIFF &&
            Math.abs(A[i + 2] - B[i + 2]) < DIFF) continue;
        sum += 0.30 * A[i] + 0.59 * A[i + 1] + 0.11 * A[i + 2];
        n++;
      }
      return { luma: n ? +(sum / n).toFixed(1) : -1, px: n };
    }, DIFF);
    await settle(1600);
  }
  out.sky = await page.evaluate(() => {
    const A = window.__buf.full, [w] = window.__wh;
    let sum = 0, n = 0;
    for (let y = 0; y < 50; y++) for (let x = 0; x < w; x += 4) {
      const i = (y * w + x) * 4;
      sum += 0.30 * A[i] + 0.59 * A[i + 1] + 0.11 * A[i + 2]; n++;
    }
    return +(sum / n).toFixed(1);
  });
  rows.push(out);
}

console.log('\n  p     drag luma (px)        city luma (px)        sky     drag/city');
for (const r of rows) {
  console.log(`  ${r.p.toFixed(2)}  ${String(r.drag.luma).padStart(6)} (${String(r.drag.px).padStart(6)})     ` +
    `${String(r.city.luma).padStart(6)} (${String(r.city.px).padStart(6)})    ${String(r.sky).padStart(6)}    ` +
    (r.city.luma > 0 ? (r.drag.luma / r.city.luma).toFixed(2) : 'n/a'));
}

const A = [];
const t = (name, cond, detail) => A.push({ name, pass: !!cond, detail });
for (const r of rows) {
  t(`p=${r.p} the mask found the pass at all`, r.drag.px > 3000, r.drag.px + ' px');
}
const night = rows.find(r => r.p >= 0.8);
if (night) {
  t('night: not a pale cut-out against the city',
    night.drag.luma / night.city.luma < 1.35,
    `drag ${night.drag.luma} / city ${night.city.luma} = ${(night.drag.luma / night.city.luma).toFixed(2)} (want < 1.35)`);
  t('night: the skyline stays darker than the sky it sits against',
    night.drag.luma < night.sky + 34, `drag ${night.drag.luma} vs sky ${night.sky}`);
}
let fail = 0;
console.log('');
for (const a of A) { if (!a.pass) fail++; console.log(`${a.pass ? 'PASS' : 'FAIL'}  ${a.name}   [${a.detail}]`); }
await browser.close();
process.exit(fail ? 1 : 0);
