/**
 * v2-rest.mjs - the clean still (v2/rest.js): when the camera rests on the multisampled path, shifted frames are added up.
 *
 *   VERIFY_URL=http://127.0.0.1:8099 node scripts/verify/v2-rest.mjs [out dir for pictures]
 *
 * Why: on a screen with one canvas pixel per CSS pixel (the owner's monitor) four samples a pixel draw a part thinner than a pixel
 * as dashes and an edge as a stair. At rest the app now adds REST.FRAMES shifted frames into a mean. Measured 2026-11-12 at
 * 2560 x 1300: the still's error against a 16-sample truth falls from 1.6-1.8 to 0.3 of 255.
 *
 * The page is opened with ?rest=1 (under a test driver the clean still is off by default) and ?steady=0. It asserts:
 *   1. the clean still is on, and the plain path is the one drawing (no steady picture);
 *   2. after the camera is placed, the app's own loop completes the still (REST.FRAMES frames) and then draws nothing more;
 *   3. the complete still is at least GAIN times nearer to a 16-sample truth (drawn here, in the page) than one plain frame is;
 *   4. its first frame is the plain frame itself (nothing jumps when it starts): the picture after one rest frame equals a plain frame;
 *   5. a camera move starts it again: a new mean is started and completed.
 * Runs on any renderer. Numbers are means over the whole frame, of 255.
 */
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { launch, BASE } from './chrome.mjs';

const LIM = { GAIN: +(process.env.REST_GAIN || 2.0), FIRST: +(process.env.REST_FIRST || 0.25) };   // measured 2026-11-12 (900 x 560): gain 3.6 on a real GPU and on a software renderer; first frame 0.00 (GPU), 0.07 (software: its resolve of a multisampled target is not its canvas's to the last bit)
const OUT = process.argv[2] || '';
if (OUT) fs.mkdirSync(OUT, { recursive: true });
const browser = await launch(chromium, { maxMs: 1500000 });
const page = await (await browser.newContext({ viewport: { width: 900, height: 560 } })).newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' || /GL_INVALID|WebGL: INVALID/.test(m.text())) errs.push(m.text().slice(0, 200)); });
await page.goto(`${BASE.replace(/\/$/, '')}/v2/?intro=0&fade=0&adapt=0&steady=0&rest=1${process.env.V2_QUERY ? '&' + process.env.V2_QUERY : ''}`, { waitUntil: 'load', timeout: 180000 });
await page.waitForFunction(() => window.__v2 && window.__v2.ready, null, { timeout: 600000 });
await page.evaluate(() => window.__v2.ready);
let calm = 0; const t0 = Date.now();
// settled: no tile and no tile of the aerial photograph loads or fades, three times in a row (each arrival draws a plain frame and starts the still again)
while (calm < 3 && Date.now() - t0 < 600000) { const s = await page.evaluate(() => { window.__v2.redraw(); const t = window.__v2.tiles(), g = window.__v2ground ? window.__v2ground.stats() : { missing: 0, loading: 0, waitingUpload: 0 }; return t && t.planned !== false && t.loading === 0 && !t.fading && (t.wanting || 0) === 0 && g.missing === 0 && g.loading === 0 && g.waitingUpload === 0; }); calm = s ? calm + 1 : 0; await page.waitForTimeout(calm ? 500 : 250); }
const on = await page.evaluate(() => ({ rest: !!(window.__v2.rest && window.__v2.rest()), steady: !!(window.__v2.steady && window.__v2.steady()), frames: window.__v2.REST ? window.__v2.REST.FRAMES : 0 }));
const waitDone = async (ms = 900000) => { const t = Date.now(); let c = 0; while (Date.now() - t < ms) { c = await page.evaluate(() => window.__v2.rest().count()); if (c >= on.frames) break; await page.waitForTimeout(100); } return c; };
let r = null;
if (on.rest) {
  // 2: the app's own loop completes the still, then stops drawing
  await page.evaluate(() => window.__v2.redraw());
  const done = await waitDone();
  // (a tile that still arrives draws a plain frame and starts the still again: that is right. So: within a minute the page must
  // reach a state where the still is complete and no frame is drawn for 1.5 s)
  let f1 = 0, f2 = 1; const tq = Date.now();
  while (f1 !== f2 && Date.now() - tq < 60000) { await waitDone(); f1 = await page.evaluate(() => window.__v2.info().frames); await page.waitForTimeout(1500); f2 = await page.evaluate(() => window.__v2.info().frames); }
  // 3, 4: pictures read in the page: the complete still (the canvas as it is), one plain frame, a 16-sample truth, the still after one rest frame
  r = await page.evaluate(async (keep) => {
    const v = window.__v2, R = v.renderer, gl = R.getContext(), cam = v.camera, W = R.domElement.width, H = R.domElement.height, rest = v.rest();
    const read = () => { const px = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
    const luma = (px) => { const l = new Float32Array(W * H); for (let i = 0, p = 0; i < l.length; i++, p += 4) l[i] = 0.299 * px[p] + 0.587 * px[p + 1] + 0.114 * px[p + 2]; return l; };
    const diff = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return +(s / a.length).toFixed(3); };
    const shots = {}; const shot = (name) => { if (keep) shots[name] = R.domElement.toDataURL('image/jpeg', 0.92); };
    rest.show(); const clean = luma(read()); shot('clean_still');
    R.render(v.scene, cam); const plain = luma(read()); shot('plain_frame');
    const LIN = new Float32Array(256); for (let i = 0; i < 256; i++) { const q = i / 255; LIN[i] = q <= 0.04045 ? q / 12.92 : Math.pow((q + 0.055) / 1.055, 2.4); }
    const enc = (a) => 255 * (a <= 0.0031308 ? a * 12.92 : 1.055 * Math.pow(a, 1 / 2.4) - 0.055);
    const halton = (i, b) => { let f = 1, q = 0; while (i > 0) { f /= b; q += f * (i % b); i = Math.floor(i / b); } return q; };
    const N = 16, acc = new Float32Array(W * H * 3);
    for (let k = 0; k < N; k++) { cam.setViewOffset(W, H, halton(k + 21, 2) - 0.5, halton(k + 21, 3) - 0.5, W, H); cam.updateProjectionMatrix(); R.render(v.scene, cam); const px = read();
      for (let p = 0, q = 0; p < px.length; p += 4, q += 3) { acc[q] += LIN[px[p]]; acc[q + 1] += LIN[px[p + 1]]; acc[q + 2] += LIN[px[p + 2]]; } }
    cam.clearViewOffset(); cam.updateProjectionMatrix();
    const truth = new Float32Array(W * H); for (let i = 0, q = 0; i < truth.length; i++, q += 3) truth[i] = 0.299 * enc(acc[q] / N) + 0.587 * enc(acc[q + 1] / N) + 0.114 * enc(acc[q + 2] / N);
    rest.reset(); rest.render(); const first = luma(read()); shot('after_one_rest_frame');
    rest.reset(); v.redraw();
    return { size: [W, H], clean: diff(clean, truth), plain: diff(plain, truth), first: diff(first, plain), shots, stats: { ...rest.stats } };
  }, !!OUT);
  r.done = done; r.idle = f2 - f1;
  // 5: a camera move starts it again
  await waitDone();
  await page.evaluate(() => { const v = window.__v2; v.camera.position.x += 3; v.camera.lookAt(v.controls.target); v.camera.updateMatrixWorld(); v.redraw(); });
  // (the next frame of the app's loop draws a plain frame and starts a new mean: a software renderer needs seconds for a frame)
  const runs0 = r.stats.runs + 1, tm = Date.now(); let runs = 0;   // (+1: the test's own first-frame run above)
  while (Date.now() - tm < 120000) { runs = await page.evaluate(() => window.__v2.rest().stats.runs); if (runs > runs0) break; await page.waitForTimeout(100); }
  r.newRun = runs > runs0; r.again = await waitDone();
}
await browser.close();
if (r && OUT) for (const [k, u] of Object.entries(r.shots)) fs.writeFileSync(`${OUT}/v2-rest-${k}.jpg`, Buffer.from(u.split(',')[1], 'base64'));

let ok = true;
const check = (c, msg) => { console.log((c ? 'PASS ' : '*FAIL ') + msg); ok &&= !!c; };
check(on.rest && !on.steady, `?rest=1 and ?steady=0: the clean still is on, on the multisampled path (rest ${on.rest}, steady ${on.steady})`);
if (r) {
  console.log(`     frame ${r.size.join(' x ')}; ${JSON.stringify(r.stats)}${OUT ? '; pictures in ' + OUT : ''}`);
  check(r.done >= on.frames && r.idle === 0, `the app's own loop completes the still (${r.done} of ${on.frames} frames) and then comes to rest: nothing more is drawn (${r.idle} frames in 1.5 s)`);
  check(r.plain >= r.clean * LIM.GAIN, `the clean still differs from a 16-sample truth by ${r.clean} of 255, one plain frame by ${r.plain}: ${(r.plain / Math.max(r.clean, 0.001)).toFixed(1)} times nearer (at least ${LIM.GAIN})`);
  check(r.first <= LIM.FIRST, `its first frame is the plain frame (they differ by ${r.first} of 255; limit ${LIM.FIRST}): nothing jumps when it starts`);
  check(r.newRun && r.again >= on.frames, `a camera move starts it again (a new mean was started: ${r.newRun}; it is complete again: ${r.again} of ${on.frames} frames)`);
}
if (errs.length) { console.log('errors:', [...new Set(errs)].slice(0, 4)); ok = false; }
process.exit(ok ? 0 : 1);
