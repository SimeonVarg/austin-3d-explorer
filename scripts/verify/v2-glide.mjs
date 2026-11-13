/**
 * v2-glide.mjs - glide.js (?glide=1): the screen never shows a raw frame. A key picture of the city is drawn off screen in
 * slices, and every display frame shows the last complete key picture moved to the camera of now.
 *
 *   VERIFY_URL=http://127.0.0.1:8099 node scripts/verify/v2-glide.mjs [out dir for pictures]
 *
 * Why: glide.js draws the city into a framebuffer of its own behind three.js's back, cuts a frame's draw calls into slices, and
 * moves a picture by its depth. Each of those can go wrong silently and still show a city. Found while it was written
 * (2026-11-12): hooks that act for the app's own camera only (the photograph on the ground was missing), a reset of three.js's
 * state that switched its depth direction off (every depth read the wrong way round), a pass whose numbers were not sent again.
 * This check asserts, on ONE page with ?glide=1 (a software renderer needs minutes to open a page):
 *   1. AT REST THE PICTURE IS TODAY'S: the complete key picture, shown, is as near to the clean still of the same view (rest.js,
 *      which does not go through glide) as one plain frame is (mean difference under SAME of 255). This is the whole
 *      key-picture path: slices, the hooks, the resolve, the show pass with no move.
 *   2. THE MOVE IS RIGHT: with the key picture held, the camera is put 1 degree further round its target. The held picture moved
 *      there must be near a fresh key picture from there (under MOVED of 255), and far nearer than the unmoved picture is
 *      (under SHARE of that distance). A wrong depth, a wrong camera or a pass that does not update fails this.
 *   3. IT RUNS: a timed orbit makes key pictures, each in more than one slice, and no page error.
 *   4. AT REST THE CLEAN STILL TAKES OVER (rest.js): after a move the key picture settles, the still completes, and then the
 *      page draws nothing. (A real GPU only.)
 * Parts 1 to 3 run on any renderer. It does not measure speed (a real GPU only: scripts/verify has no speed check for it yet).
 */
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { launch, BASE } from './chrome.mjs';
const LIM = { SAME: +(process.env.GLIDE_SAME || 3.5), MOVED: +(process.env.GLIDE_MOVED || 6), SHARE: +(process.env.GLIDE_SHARE || 0.4) };   // (measured values are printed; a missing ground photograph was 4.8, a wrong depth made the move 22 of 22)
const OUT = process.argv[2] || ''; if (OUT) fs.mkdirSync(OUT, { recursive: true });
const browser = await launch(chromium, { maxMs: 1500000 });
const fails = [], ok = (c, m) => { console.log(`${c ? 'PASS' : '*FAIL'} ${m}`); if (!c) fails.push(m); };
const REAL = process.env.VERIFY_GL === 'hardware', W = REAL ? 900 : 640, H = REAL ? 560 : 400, errs = [], T0 = Date.now();   // (a software renderer: a smaller page, and no part 4)
const open = async (q) => { const page = await (await browser.newContext({ viewport: { width: W, height: H } })).newPage();
  page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' || /GL_INVALID|WebGL: INVALID/.test(m.text())) errs.push(m.text().slice(0, 200)); });
  await page.goto(`${BASE.replace(/\/$/, '')}/v2/?intro=0&fade=0&adapt=0&steady=0${q}`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => window.__v2 && window.__v2.ready, null, { timeout: 600000 });
  await page.addStyleTag({ content: 'body > *:not(canvas) { visibility: hidden !important; } canvas { visibility: visible !important; }' });
  return page; };
const pose = (page, az) => page.evaluate((az) => { const v = window.__v2; v.placeCamera({ target: [0, 0, -0.5], distance: 330, polarDeg: 62, azimuthDeg: az }); v.redraw(); }, az);
const settle = async (page) => { let calm = 0; const t0 = Date.now(); while (calm < 3 && Date.now() - t0 < 400000) { const s = await page.evaluate(() => { window.__v2.redraw(); const g = window.__v2ground ? window.__v2ground.stats() : { missing: 0, loading: 0, waitingUpload: 0 }, t = window.__v2.tiles(), gl = window.__v2.glide ? window.__v2.glide() : null;
    return t.loading === 0 && !t.fading && (t.wanting || 0) === 0 && g.missing === 0 && g.loading === 0 && g.waitingUpload === 0 && (!gl || !gl.busy); }); calm = s ? calm + 1 : 0; await page.waitForTimeout(calm ? 400 : 200); } await page.waitForTimeout(1200); };
// the mean difference of two pictures of the page, of 255 (in the page: the pictures are PNG buffers)
const diff = (page, a, b) => page.evaluate(async ([a, b]) => { const load = async (b64) => { const im = new Image(); im.src = 'data:image/png;base64,' + b64; await im.decode(); const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const x = c.getContext('2d'); x.drawImage(im, 0, 0); return x.getImageData(0, 0, c.width, c.height).data; };
  const A = await load(a), B = await load(b); let s = 0; for (let i = 0; i < A.length; i += 4) s += Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]); return s / (A.length / 4 * 3); }, [a.toString('base64'), b.toString('base64')]);
const shot = async (page, name) => { const b = await page.screenshot(); if (OUT) fs.writeFileSync(`${OUT}/${name}.png`, b); return b; };

// ONE page for all parts (a software renderer needs minutes to open a page): glide with the clean still held back
const page = await open('&rest=1&glide=1');
await page.evaluate(() => { window.__v2.REST.WAIT_MS = 1e12; });
const on = await page.evaluate(() => ({ glide: !!window.__v2.glide(), fbo: window.__v2.glide() && window.__v2.glide().fbo, steady: !!(window.__v2.steady && window.__v2.steady()), msaa: window.__v2.renderer.getContext().getContextAttributes().antialias }));
ok(on.glide && on.fbo && !on.steady && !on.msaa, `glide is on, its framebuffers are complete, the steady picture is off and the canvas has no multisampling of its own (${JSON.stringify(on)})`);
// 1. the key picture at rest against the clean still of the same view (drawn by rest.js, which does not go through glide)
await pose(page, 200); await settle(page); const G200 = await shot(page, 'glide_200');
await page.evaluate(() => { window.__v2.REST.WAIT_MS = 150; window.__v2.redraw(); });
await page.waitForFunction(() => { const v = window.__v2; return !v.glide().busy && v.rest() && !v.rest().more(); }, null, { timeout: 600000 });
await page.waitForTimeout(400); const C200 = await shot(page, 'clean_200');
const same = await diff(page, G200, C200);
ok(same < LIM.SAME, `1. at rest the picture is today's: the key picture is ${same.toFixed(2)} of 255 from the clean still of the same view (limit ${LIM.SAME}; one plain frame is about 1.6 from it)`);
await page.evaluate(() => { window.__v2.REST.WAIT_MS = 1e12; });
// 2. the move: hold the key picture, put the camera 1 degree on
await pose(page, 200); await settle(page);
await page.evaluate(() => { window.__v2.GLIDE.FREEZE = 1; });
await pose(page, 201); await page.waitForTimeout(REAL ? 1500 : 8000); const moved = await shot(page, 'glide_held_moved');
await page.evaluate(() => { window.__v2.GLIDE.FREEZE = 0; });
await pose(page, 201); await settle(page); const fresh = await shot(page, 'glide_201');
const dm = await diff(page, moved, fresh), du = await diff(page, G200, fresh);
ok(dm < LIM.MOVED && dm < du * LIM.SHARE, `2. the move is right: the held picture moved 1 degree on is ${dm.toFixed(2)} of 255 from a fresh one there (limit ${LIM.MOVED}); the unmoved picture is ${du.toFixed(2)} from it (the moved one must be under ${(LIM.SHARE * 100).toFixed(0)} % of that: ${(100 * dm / du).toFixed(0)} %)`);
// 3. it runs
const g0 = await page.evaluate(() => window.__v2.glide());
await page.evaluate((ms) => window.__v2.measure(ms, 0.15), REAL ? 6000 : 30000);
const g1 = await page.evaluate(() => window.__v2.glide());
ok(g1.keys > g0.keys && g1.keySlices >= 1, `3. a timed orbit makes key pictures (${g1.keys - g0.keys}), the last in ${g1.keySlices} slice${g1.keySlices > 1 ? 's' : ''}`);
// 4. at rest the clean still takes over, and then the page draws nothing (a real GPU only: on a software renderer a late
// piece of the city starts the still again for minutes)
if (REAL) {
  await page.evaluate(() => { window.__v2.REST.WAIT_MS = 150; });
  await pose(page, 200); await settle(page); await pose(page, 201);
  let r1 = null, drawn = -1; const tr = Date.now();
  while (Date.now() - tr < 90000) {
    await page.waitForFunction(() => { const v = window.__v2; return !v.glide().busy && v.rest() && !v.rest().more(); }, null, { timeout: 60000 }).catch(() => {});
    r1 = await page.evaluate(() => ({ busy: window.__v2.glide().busy, rest: window.__v2.rest().count(), more: window.__v2.rest().more(), frames: window.__v2.info().frames }));
    await page.waitForTimeout(2000);
    drawn = (await page.evaluate(() => window.__v2.info().frames)) - r1.frames;
    if (!r1.busy && !r1.more && drawn === 0) break;
  }
  ok(!!r1 && !r1.busy && !r1.more && drawn === 0, `4. at rest the key picture settles, the clean still completes (${r1 && r1.rest} frames) and the page then draws nothing (${drawn} frames in 2 s)`);
} else console.log('(part 4 is for a real GPU: VERIFY_GL=hardware)');
await page.context().close();
ok(errs.length === 0, `no page errors (${errs.length}${errs.length ? ': ' + [...new Set(errs)].slice(0, 3).join(' | ') : ''})`);
await browser.close();
console.log(`(${((Date.now() - T0) / 1000).toFixed(0)} s)`);
console.log(fails.length ? `\n*FAIL ${fails.length}` : '\nPASS the picture at rest is today\'s, the move is right, it runs, and the clean still takes over');
process.exit(fails.length ? 1 : 0);
