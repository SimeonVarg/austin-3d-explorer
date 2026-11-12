/**
 * v2-steady.mjs - the steady picture (v2/steady.js): a full-size picture is kept and small shifted frames are added into it.
 *
 *   VERIFY_URL=http://127.0.0.1:8099 node scripts/verify/v2-steady.mjs [shots dir]
 *
 * On a GPU that cannot hold the full size in motion (the owner's Mac) the app draws the city SMALL while the camera moves and
 * keeps a full-size picture that every small frame is added into, at the place its points really are (the world stands still:
 * the place comes from the depth and the two cameras). This check holds the parts that make that true, all in one page (rule 13):
 *
 *   1. on:     ?steady=1 turns it on; the canvas has no multisampling of its own; no error in the console;
 *   2. still:  the still the steady path converges to = the truth of that view (16 shifted full-size frames added up as light),
 *              to within STILL of 255. This fails when a colour step is wrong (light against display values, the copy to the canvas);
 *   3. carry:  a converged still at camera A, then ONE motion frame at camera B that takes nothing new (the kept picture alone,
 *              carried from A to B). It must lie on the truth at B to within CARRY, and several times nearer than the still of A
 *              does. This fails when a depth is wrong: the ground's (no ground layer writes depth; it is the plane y = 0), the
 *              reversed depth buffer, the shift of the small frame;
 *   4. motion: MOTION_FRAMES small frames along the way from A to B with the app's own settings, then the picture against the
 *              truth at B: within MOTION (a ghost, a trail on uncovered ground or a smear around trees shows here);
 *   5. rest:   after its still is done the steady path asks for no more frames.
 * Runs on any renderer (a software renderer needs a few minutes). The numbers are means over the whole frame, of 255.
 * The app's own loop draws nothing during the test: every frame is set and drawn in one step.
 */
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { launch, BASE } from './chrome.mjs';

// Limits (one line each to overrule). Measured 2026-11-11, 900 x 560 at 1x, real GPU and software: still 1.0 to 2.0 (the rest frames'
// shifts span 0.6 of a pixel, STEADY.REST_SPREAD, so the still is a little sharper than the truth's full-pixel mean), carry 2.7 to 3.0
// (left in place: 21.7), motion 4.1 to 4.5.
const LIM = { STILL: +(process.env.STEADY_STILL || 3.5), CARRY: +(process.env.STEADY_CARRY || 4.0), CARRY_GAIN: +(process.env.STEADY_CARRY_GAIN || 3.0), MOTION: +(process.env.STEADY_MOTION || 6.0) };
const MOTION_FRAMES = 16, MOVE_M = [9, -1, -5], TURN_M = [6, 0, -2];   // camera B = A moved by MOVE_M (metres), looking at A's target moved by TURN_M
const OUT = process.argv[2] || '';
if (OUT) fs.mkdirSync(OUT, { recursive: true });

const browser = await launch(chromium, { maxMs: 1500000 });
const page = await (await browser.newContext({ viewport: { width: 900, height: 560 } })).newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' || /GL_INVALID|WebGL: INVALID/.test(m.text())) errs.push(m.text().slice(0, 200)); });
await page.goto(`${BASE.replace(/\/$/, '')}/v2/?intro=0&fade=0&adapt=0&steady=1${process.env.V2_QUERY ? '&' + process.env.V2_QUERY : ''}`, { waitUntil: 'load', timeout: 180000 });
await page.waitForFunction(() => window.__v2 && window.__v2.ready, null, { timeout: 600000 });
await page.evaluate(() => window.__v2.ready);
// settled: nothing loads or fades, twice in a row
let calm = 0; const t0 = Date.now();
while (calm < 2 && Date.now() - t0 < 600000) { const s = await page.evaluate(() => { window.__v2.redraw(); return window.__v2.tiles(); }); calm = s && s.planned !== false && s.loading === 0 && !s.fading && (s.wanting || 0) === 0 ? calm + 1 : 0; await page.waitForTimeout(calm ? 800 : 400); }
const on = await page.evaluate(() => ({ steady: !!(window.__v2.steady && window.__v2.steady()), antialias: window.__v2.renderer.getContext().getContextAttributes().antialias }));

const r = on.steady ? await page.evaluate(async ({ MOTION_FRAMES, MOVE_M, TURN_M, keep }) => {
  const v = window.__v2, S = v.STEADY, st = v.steady(), r = v.renderer, gl = r.getContext(), cam = v.camera, THREE = v.THREE;
  const real = st.render.bind(st); st.render = () => {};                      // the app's own loop draws nothing from here on
  const W = r.domElement.width, H = r.domElement.height;
  const LIN = new Float32Array(256); for (let i = 0; i < 256; i++) { const q = i / 255; LIN[i] = q <= 0.04045 ? q / 12.92 : Math.pow((q + 0.055) / 1.055, 2.4); }
  const enc = (a) => 255 * (a <= 0.0031308 ? a * 12.92 : 1.055 * Math.pow(a, 1 / 2.4) - 0.055);
  const read = () => { const px = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
  const luma = (px) => { const l = new Float32Array(W * H); for (let i = 0, p = 0; i < l.length; i++, p += 4) l[i] = 0.299 * px[p] + 0.587 * px[p + 1] + 0.114 * px[p + 2]; return l; };
  const diff = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return +(s / a.length).toFixed(2); };
  const halton = (i, b) => { let f = 1, q = 0; while (i > 0) { f /= b; q += f * (i % b); i = Math.floor(i / b); } return q; };
  const pose = (P) => { v.controls.target.fromArray(P.tg); cam.position.fromArray(P.p); cam.updateProjectionMatrix(); cam.lookAt(v.controls.target); cam.updateMatrixWorld(); };
  // the truth of the view the camera has now: 16 shifted full-size frames, drawn plainly on the canvas, added up as light
  const truth = () => { const acc = new Float32Array(W * H * 3), N = 16;
    for (let k = 0; k < N; k++) { cam.setViewOffset(W, H, halton(k + 1, 2) - 0.5, halton(k + 1, 3) - 0.5, W, H); cam.updateProjectionMatrix(); r.setRenderTarget(null); r.render(v.scene, cam); const px = read();
      for (let p = 0, q = 0; p < px.length; p += 4, q += 3) { acc[q] += LIN[px[p]]; acc[q + 1] += LIN[px[p + 1]]; acc[q + 2] += LIN[px[p + 2]]; } }
    cam.clearViewOffset(); cam.updateProjectionMatrix();
    const l = new Float32Array(W * H); for (let i = 0, q = 0; i < l.length; i++, q += 3) l[i] = 0.299 * enc(acc[q] / N) + 0.587 * enc(acc[q + 1] / N) + 0.114 * enc(acc[q + 2] / N); return l; };
  const still = () => { st.reset(); for (let k = 0; k < 16; k++) real(1, false, false); return luma(read()); };
  const shots = {}; const shot = (name) => { if (keep) shots[name] = r.domElement.toDataURL('image/jpeg', 0.92); };
  const A = { p: cam.position.toArray(), tg: v.controls.target.toArray() };
  const B = { p: A.p.map((x, i) => x + MOVE_M[i]), tg: A.tg.map((x, i) => x + TURN_M[i]) };
  const out = { size: [W, H] };
  pose(A); const stillA = still(); shot('still_A'); const truthA = truth();
  out.still = diff(stillA, truthA);
  // carry: the kept picture of A, moved to B, taking nothing new
  pose(A); still(); pose(B);
  { const h = S.HIT, m = S.MISS, f = S.FAST_SHARE; S.HIT = S.MISS = S.FAST_SHARE = 0; real(0.5, true, false); S.HIT = h; S.MISS = m; S.FAST_SHARE = f; }
  const carried = luma(read()); shot('carried_A_to_B');
  const truthB = truth();
  out.carry = diff(carried, truthB); out.uncarried = diff(stillA, truthB);
  // motion: small frames along the way, the app's settings
  pose(A); still();
  for (let k = 1; k <= MOTION_FRAMES; k++) { const t = k / MOTION_FRAMES; pose({ p: A.p.map((x, i) => x + MOVE_M[i] * t), tg: A.tg.map((x, i) => x + TURN_M[i] * t) }); real(0.5, true, false); }
  out.motion = diff(luma(read()), truthB); shot('after_motion_at_B');
  // rest: the still, drawn as the app's loop would (frames while it asks for more)
  let n = 0; real(1, false, false); while (st.more() && n < 60) { real(1, false, false); n++; }
  out.restFrames = n; out.more = st.more(); out.stats = { ...st.stats };
  st.render = real; v.redraw();
  return { ...out, shots };
}, { MOTION_FRAMES, MOVE_M, TURN_M, keep: !!OUT }) : null;
await browser.close();
if (r && OUT) for (const [k, u] of Object.entries(r.shots)) fs.writeFileSync(`${OUT}/v2-steady-${k}.jpg`, Buffer.from(u.split(',')[1], 'base64'));

let ok = true;
const check = (c, msg) => { console.log((c ? 'PASS ' : '*FAIL ') + msg); ok &&= !!c; };
check(on.steady, '?steady=1: the steady picture is on');
check(on.antialias === false, `the canvas has no multisampling of its own (antialias ${on.antialias})`);
if (r) {
  console.log(`     frame ${r.size.join(' x ')}; ${JSON.stringify(r.stats)}${OUT ? '; pictures in ' + OUT : ''}`);
  check(r.still <= LIM.STILL, `still: the steady still differs from the truth by ${r.still} of 255 (limit ${LIM.STILL})`);
  check(r.carry <= LIM.CARRY, `carry: the kept picture of A, carried to B, differs from the truth at B by ${r.carry} of 255 (limit ${LIM.CARRY})`);
  check(r.uncarried >= r.carry * LIM.CARRY_GAIN, `carry: that is ${(r.uncarried / Math.max(r.carry, 0.01)).toFixed(1)} times nearer than the picture of A left in place (${r.uncarried}; at least ${LIM.CARRY_GAIN} times)`);
  check(r.motion <= LIM.MOTION, `motion: after ${MOTION_FRAMES} small frames from A to B the picture differs from the truth at B by ${r.motion} of 255 (limit ${LIM.MOTION})`);
  check(!r.more && r.restFrames > 0 && r.restFrames < 40, `rest: the still was done after ${r.restFrames} more frames and asks for no more`);
}
if (errs.length) { console.log('errors:', [...new Set(errs)].slice(0, 4)); ok = false; }
process.exit(ok ? 0 : 1);
