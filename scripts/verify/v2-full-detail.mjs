/**
 * v2-full-detail.mjs - a Blender building in v2 never LOOKS less detailed at a distance, and a tile fades in.
 *
 *   VERIFY_URL=http://127.0.0.1:8099 node scripts/verify/v2-full-detail.mjs [shots dir]
 *
 * Owner, 2026-10-18: "can you also get rid fo the rule that converts buildings to bad lesser detailed ones when theyre at a
 * distance? its really disturbing." The old far files (lod1, *.far.glb) are still never read. Since 2026-11-11 a tile may draw its
 * FAR COPY (v2/tiles.js FAR, part of the fast mode), but only where one texel of the copy is smaller than a pixel of the canvas, so
 * the eye gets the same picture. This check holds the copy to that promise instead of to "never":
 *
 *   1. no old far file is ever requested;
 *   2. no tile draws its far copy nearer than its own line (state of every tile, from DKR at 2 km and from the opening view);
 *   3. TRUE TO THE FULL MODEL: the TRUTH of a view is every tile as its full model, drawn with TRUTH_SS x TRUTH_SS samples in each
 *      pixel, the samples added up as light (what an eye gets from the full models at that distance). The view as the app draws it
 *      (far copies) is held to that truth two ways (FAR_TRUE below): its brightness must not drift from it, and what an eye
 *      resolves of the two (each averaged over 3 x 3 pixels) must not differ by more than a set amount. The same two numbers are
 *      printed for the view with every tile forced to its full model at the app's own resolution, as the yardstick. All three
 *      frames are drawn in one page (rule 13), same camera;
 *   4. tiles arrive with a fade: at least one tile was seen mid-fade while loading, and once settled every tile's fade is 0
 *      (the model is drawn at its own colours) and no plain extrusion is left in the haze.
 * Runs on any renderer. On a page with the far copy off (?far=0, a phone) 2 and 3 pass with nothing to compare.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { launch, BASE } from './chrome.mjs';

// True to the full model, in numbers (taste values: one line each to overrule), all of 255 and all over the pixels where the app's
// frame and the all-full frame differ at all (so the size of the window and the share of the frame that is buildings do not move them).
// DRIFT = the mean brightness of the app's frame minus the truth's. SEEN = the mean of the largest channel difference between the
// two after each is averaged over 3 x 3 pixels (the dots of an aliased window grid and a half-pixel shift of an edge are not seen as such).
// Measured 2026-11-11 on the owner's Mac, 1000 x 640: the far copy of that morning (one mixed colour a texel) drifted +4.7 to +8.3
// (pale towers, window rows washed out); model 3 (bright part and dark part sent to the screen apart) measures about 2 and looks like the truth.
const FAR_TRUE = { SS: +(process.env.TRUTH_SS || 3), DRIFT: +(process.env.FAR_TRUE_DRIFT || 3.0), SEEN: +(process.env.FAR_TRUE_SEEN || 8.0) };
const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'v2-full-detail-'));
fs.mkdirSync(OUT, { recursive: true });

const browser = await launch(chromium, { maxMs: 1500000 });
const page = await (await browser.newContext({ viewport: { width: 1000, height: 640 } })).newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
const far = []; page.on('request', (r) => { if (/\.far\.glb(\?|$)/.test(r.url())) far.push(r.url()); });
await page.goto(`${BASE.replace(/\/$/, '')}/v2/?intro=0${process.env.V2_QUERY ? '&' + process.env.V2_QUERY : ''}`, { waitUntil: 'load', timeout: 180000 });
await page.waitForFunction(() => window.__v2 && window.__v2.ready, null, { timeout: 600000 });
await page.evaluate(() => window.__v2.ready);
let sawFade = 0;
// settled = the streamer has planned since the camera last moved, nothing loads or fades, and every tile it wants is in
// (a slow software renderer runs the plan only every few seconds: never call a page settled before its first plan)
const settle = async (also = 'true') => {
  let calm = 0; const t0 = Date.now();
  while (calm < 3 && Date.now() - t0 < 900000) {
    const s = await page.evaluate((also) => { const v = window.__v2; v.redraw(); return { ...v.tiles(), also: !!(0, eval)(also) }; }, also);
    if (s.fading) sawFade++;
    calm = s.planned && s.loaded > 0 && s.loading === 0 && !s.fading && s.wanting === 0 && s.also ? calm + 1 : 0;
    await page.waitForTimeout(calm ? 1000 : 150);
  }
  return calm >= 3;
};
// every tile's copy, as drawn now: [id, 'far' | 'full', distance / its line]
const state = () => page.evaluate(() => {
  const v = window.__v2, ts = v.tileStreamer(), out = [];
  for (const [id, s] of ts.tiles) if (s.full || s.far) out.push([id, s.far && s.far.visible ? 'far' : 'full', s.line > 0 && isFinite(s.line) ? +(s.d / s.line).toFixed(3) : null]);
  return { tiles: out, on: !!(v.FAR && v.FAR.ON), back: v.FAR ? v.FAR.BACK : 1, sum: v.tiles() };
});
const shot = async (file) => {
  await page.evaluate(() => new Promise((r) => { window.__v2.redraw(); requestAnimationFrame(() => { window.__v2.redraw(); requestAnimationFrame(() => r()); }); }));
  await page.waitForTimeout(300);
  await page.screenshot({ path: file });   // (README: screenshot twice, trust the second)
  await page.screenshot({ path: file });
};
// the frame as it is drawn now, at the canvas's own resolution, from `ss` x `ss` samples a pixel (1 = as the app draws it); kept in
// the page under `key` (v2-shimmer.mjs grabs the same way: a direct render, then the pixels read back and box-filtered)
const grab = (key, ss) => page.evaluate(([key, ss]) => {
  const v = window.__v2, r = v.renderer, gl = r.getContext(), c = r.domElement, W = c.clientWidth, H = c.clientHeight, was = r.getPixelRatio();
  const dpr = Math.min(devicePixelRatio || 1, 2);
  r.setPixelRatio(dpr * ss); r.setSize(W, H, false); v.camera.updateMatrixWorld(); r.render(v.scene, v.camera);
  const gw = c.width, gh = c.height, px = new Uint8Array(gw * gh * 4); gl.readPixels(0, 0, gw, gh, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const nw = Math.floor(gw / ss), nh = Math.floor(gh / ss), out = new Float32Array(nw * nh * 3), k = 1 / (ss * ss);
  // the samples of a pixel are averaged as LIGHT (linear), then written back as display values: an eye, and a far copy's texel, add up light,
  // not display numbers (averaging the display numbers of a white wall with black panes reads about 30 of 255 too dark)
  const LIN = new Float32Array(256); for (let i = 0; i < 256; i++) { const c = i / 255; LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) for (let ch = 0; ch < 3; ch++) {
    let a = 0; for (let j = 0; j < ss; j++) for (let i = 0; i < ss; i++) a += LIN[px[((y * ss + j) * gw + x * ss + i) * 4 + ch]];
    a *= k; out[(y * nw + x) * 3 + ch] = 255 * (a <= 0.0031308 ? a * 12.92 : 1.055 * Math.pow(a, 1 / 2.4) - 0.055);
  }
  r.setPixelRatio(was); r.setSize(W, H, false); v.redraw();
  (window.__grabs ||= {})[key] = { w: nw, h: nh, d: out };
  return [nw, nh];
}, [key, ss]);
// app frame and all-full frame against the truth, over the pixels where the two differ at all
const truer = () => page.evaluate(() => {
  const { app: A, full: F, truth: T } = window.__grabs; let n = 0, sA = 0, sF = 0, bA = 0, bF = 0;
  const soft = (g) => { const o = new Float32Array(g.d.length), w = g.w, h = g.h;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) { let a = 0, k = 0;
      for (let j = -1; j <= 1; j++) { const yy = y + j; if (yy < 0 || yy >= h) continue; for (let i = -1; i <= 1; i++) { const xx = x + i; if (xx < 0 || xx >= w) continue; a += g.d[(yy * w + xx) * 3 + c]; k++; } }
      o[(y * w + x) * 3 + c] = a / k; }
    return o; };
  const As = soft(A), Fs = soft(F), Ts = soft(T);
  for (let i = 0; i < A.d.length; i += 3) {
    let dAF = 0, qA = 0, qF = 0;
    for (let c = 0; c < 3; c++) { dAF = Math.max(dAF, Math.abs(A.d[i + c] - F.d[i + c])); qA = Math.max(qA, Math.abs(As[i + c] - Ts[i + c])); qF = Math.max(qF, Math.abs(Fs[i + c] - Ts[i + c])); }
    if (dAF < 1) continue;
    n++; sA += qA; sF += qF;
    const l = (d) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; bA += l(A.d) - l(T.d); bF += l(F.d) - l(T.d);
  }
  const f = (x) => +(n ? x / n : 0).toFixed(2);
  return { sharePct: +(100 * n / (A.d.length / 3)).toFixed(2), seenApp: f(sA), seenFull: f(sF), driftApp: f(bA), driftFull: f(bF) };
});
// a picture of a kept frame (or of app minus truth: red = the app is brighter, blue = darker, x8) for the eye, when a check fails
const save = async (file, key, minus) => {
  const url = await page.evaluate(([key, minus]) => {
    const G = window.__grabs, A = G[key], B = minus ? G[minus] : null, c = document.createElement('canvas'); c.width = A.w; c.height = A.h;
    const x = c.getContext('2d'), im = x.createImageData(A.w, A.h);
    for (let y = 0; y < A.h; y++) for (let X = 0; X < A.w; X++) {
      const i = (y * A.w + X) * 3, o = ((A.h - 1 - y) * A.w + X) * 4;   // (readPixels rows run bottom-up)
      if (!B) { im.data[o] = A.d[i]; im.data[o + 1] = A.d[i + 1]; im.data[o + 2] = A.d[i + 2]; }
      else { const d = (0.2126 * (A.d[i] - B.d[i]) + 0.7152 * (A.d[i + 1] - B.d[i + 1]) + 0.0722 * (A.d[i + 2] - B.d[i + 2])) * 8; im.data[o] = 128 + Math.max(0, d); im.data[o + 1] = 128 - Math.abs(d) / 2; im.data[o + 2] = 128 + Math.max(0, -d); }
      im.data[o + 3] = 255;
    }
    x.putImageData(im, 0, 0); return c.toDataURL('image/png');
  }, [key, minus || null]);
  fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
};
// one view: its state as the app draws it, then the same frame with every tile forced to its full model
const view = async (name) => {
  await settle();
  const st = await state();
  const a = path.join(OUT, `${name}-app.png`), b = path.join(OUT, `${name}-full.png`);
  let cmp = null;
  if (st.on && st.tiles.some((t) => t[1] === 'far')) {
    await shot(a); await grab('app', 1);
    await page.evaluate(() => { window.__v2.FAR.FORCE = 'full'; });
    const ok = await settle('[...window.__v2.tileStreamer().tiles.values()].every((s) => !(s.far && s.far.visible) && (!s.want || s.full))');
    await shot(b); await grab('full', 1); await grab('truth', FAR_TRUE.SS);
    await page.evaluate(() => { window.__v2.FAR.FORCE = null; });
    cmp = { ...(await truer()), settled: ok };
    await save(path.join(OUT, `${name}-truth.png`), 'truth'); await save(path.join(OUT, `${name}-app-minus-truth.png`), 'app', 'truth'); await save(path.join(OUT, `${name}-full-minus-truth.png`), 'full', 'truth');
    await settle();
  }
  return { name, st, cmp };
};
await page.addStyleTag({ content: 'body > *:not(canvas) { visibility: hidden !important; } canvas { visibility: visible !important; }' });
const views = [await view('opening')];
const man = await page.evaluate(() => fetch('./tiles/manifest.json').then((r) => r.json()));
const dkr = man.buildings['dkr-memorial-stadium'];
await page.evaluate(([x, z]) => window.__v2.placeCamera({ target: [x, 0, z], distance: 2000, polarDeg: 72, azimuthDeg: 200 }), [dkr.x, dkr.z]);
views.push(await view('dkr-2km'));
const s = await page.evaluate(() => {
  const v = window.__v2, t = v.tiles();
  let fades = 0, hazed = 0;
  v.scene.getObjectByName('blender-tiles').children.forEach((o) => { if (o.userData.fade && o.userData.fade.value !== 0) fades++; });
  for (const b of v.city.buildings) { const a = b.mesh.geometry.attributes.hz; if (a) for (let i = 0; i < a.array.length; i++) if (a.array[i]) { hazed++; break; } }
  return { t, fades, hazed, dkrTile: v.scene.getObjectByName('blender-tiles').children.some((o) => /t_2_0/.test(o.name) && o.visible) };
});
await browser.close();
let ok = true;
const check = (c, msg) => { console.log((c ? 'PASS ' : '*FAIL ') + msg); ok &&= !!c; };
console.log('tiles', JSON.stringify(s.t), '| pictures in', OUT);
check(far.length === 0, `no old far file requested (${far.length})`);
for (const v of views) {
  const farT = v.st.tiles.filter((t) => t[1] === 'far'), near = farT.filter((t) => t[2] !== null && t[2] < v.st.back - 0.01);
  check(v.st.tiles.some((t) => t[1] === 'full'), `${v.name}: ${v.st.tiles.length - farT.length} tiles draw the full model, ${farT.length} the far copy (far copy ${v.st.on ? 'on' : 'off'})`);
  check(near.length === 0, `${v.name}: no far copy nearer than its line (${near.length}${near.length ? ': ' + near.slice(0, 4).map((t) => `${t[0]} at ${t[2]} x`).join(', ') : ''}; nearest ${farT.length ? Math.min(...farT.map((t) => t[2] ?? 9)).toFixed(2) : '-'} x)`);
  if (v.cmp) {
    check(v.cmp.settled, `${v.name}: every tile came in as its full model for the comparison`);
    console.log(`     ${v.name}: ${v.cmp.sharePct} % of the frame differs between the app and all-full; truth = all-full at ${FAR_TRUE.SS}x${FAR_TRUE.SS} samples a pixel; yardstick (all-full at the app's resolution): drift ${v.cmp.driftFull}, seen ${v.cmp.seenFull}`);
    check(Math.abs(v.cmp.driftApp) <= FAR_TRUE.DRIFT, `${v.name}: brightness drift from the truth ${v.cmp.driftApp} of 255 (limit ${FAR_TRUE.DRIFT})`);
    check(v.cmp.seenApp <= FAR_TRUE.SEEN, `${v.name}: what an eye resolves differs from the truth by ${v.cmp.seenApp} of 255 (limit ${FAR_TRUE.SEEN})`);
  } else console.log(`     ${v.name}: no far copy drawn, nothing to compare`);
}
check(s.dkrTile, 'DKR (2 km away) is drawn');
check(sawFade > 0, `tiles faded in (${sawFade} samples mid-fade)`);
check(s.fades === 0, `settled: every tile at its own colours (${s.fades} still hazed)`);
check(s.hazed === 0, `settled: no plain building left in the haze (${s.hazed} extrusion tiles)`);
if (errs.length) { console.log('page errors:', errs.slice(0, 3)); ok = false; }
process.exit(ok ? 0 : 1);
