/**
 * v2-labels.mjs - the building names in v2 move WITH their buildings on every frame, and fade instead of popping.
 *
 *   VERIFY_URL=http://127.0.0.1:8099 node scripts/verify/v2-labels.mjs
 *
 * Owner, 2026-10-18: "The names for buildings update every like 200 miliseconds fix that." Before, labels.js placed the names at
 * most every 120 ms and with the camera matrix of the frame before, so a name slid behind its building and jumped to catch up.
 *
 * Asserts, during the app's own slow orbit (window.__v2.measure, which turns the camera a little on EVERY frame):
 *   1. on every sampled frame, every shown name sits where its building's point projects with the camera of that frame
 *      (max error <= MAX_ERR_PX). The sample is taken in a requestAnimationFrame callback, so it sees the same camera the
 *      frame was drawn with whichever callback runs first;
 *   2. the names on screen actually moved between frames (the orbit is real, so check 1 is not vacuous);
 *   3. a name fades: the label's opacity has a transition of at least MIN_FADE_S, and a shown name ends at opacity > 0.8.
 * Runs on any renderer (SwiftShader in CI is slow, but the check counts frames, not milliseconds).
 */
import { chromium } from 'playwright-core';
import { launch, BASE } from './chrome.mjs';

const MAX_ERR_PX = 0.75, MIN_FADE_S = 0.15, MIN_FRAMES = 6;
const browser = await launch(chromium, { maxMs: 900000 });
const page = await (await browser.newContext({ viewport: { width: 1100, height: 700 } })).newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`${BASE.replace(/\/$/, '')}/v2/?intro=0`, { waitUntil: 'load', timeout: 180000 });
await page.waitForFunction(() => window.__v2 && window.__v2.ready, null, { timeout: 300000 });
await page.evaluate(() => window.__v2.ready);
// a view over campus with many names
await page.evaluate(() => window.__v2.placeCamera({ target: [-150, 0, 120], distance: 900, polarDeg: 58, azimuthDeg: 20 }));
await page.waitForFunction(() => window.__v2.labels().shown >= 4, null, { timeout: 300000 });
await page.waitForTimeout(1500);
const r = await page.evaluate(async () => {
  const { camera, THREE } = window.__v2;
  const v = new THREE.Vector3();
  const samples = [];
  let stop = false;
  const tick = () => {
    if (stop) return;
    const W = innerWidth, H = innerHeight;
    camera.updateMatrixWorld();
    let err = 0, n = 0; const pos = {};
    for (const el of document.querySelectorAll('.v2-label.on')) {
      if (!el._it || el.style.visibility === 'hidden') continue;
      const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(el.style.transform); if (!m) continue;
      v.set(el._it.x, el._it.y, el._it.z).project(camera);
      const x = (v.x + 1) / 2 * W, y = (1 - v.y) / 2 * H;
      err = Math.max(err, Math.hypot(x - +m[1], y - +m[2])); n++; pos[el._it.name] = [+m[1], +m[2]];
    }
    samples.push({ err, n, pos });
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  await window.__v2.measure(2500, 0.4);
  stop = true;
  let moved = 0;
  for (let i = 1; i < samples.length; i++) for (const k in samples[i].pos) { const a = samples[i - 1].pos[k], b = samples[i].pos[k]; if (a) moved = Math.max(moved, Math.hypot(a[0] - b[0], a[1] - b[1])); }
  const el = document.querySelector('.v2-label.on');
  const cs = el && getComputedStyle(el);
  const dur = cs ? Math.max(...cs.transitionDuration.split(',').map((s) => parseFloat(s) * (s.trim().endsWith('ms') ? 0.001 : 1))) : 0;
  return { frames: samples.length, maxErr: Math.max(...samples.map((s) => s.err)), minShown: Math.min(...samples.map((s) => s.n)), moved, dur, opacity: cs ? +cs.opacity : 0 };
});
await page.waitForTimeout(600);
const op = await page.evaluate(() => { const el = document.querySelector('.v2-label.on'); return el ? +getComputedStyle(el).opacity : 0; });
await browser.close();
console.log(`frames sampled ${r.frames}, names on screen (min) ${r.minShown}, largest move between frames ${r.moved.toFixed(1)} px`);
console.log(`largest gap between a name and its building's point ${r.maxErr.toFixed(2)} px (limit ${MAX_ERR_PX})`);
console.log(`fade: transition ${r.dur} s (min ${MIN_FADE_S}), a shown name's opacity ${op}`);
let ok = true;
const check = (c, msg) => { console.log((c ? 'PASS ' : '*FAIL ') + msg); ok &&= c; };
check(r.frames >= MIN_FRAMES, `at least ${MIN_FRAMES} frames sampled`);
check(r.minShown >= 1, 'names on screen in every sampled frame');
check(r.moved > 0.2, 'the names moved with the camera');
check(r.maxErr <= MAX_ERR_PX, 'every name on its building on every frame');
check(r.dur >= MIN_FADE_S, 'names fade in and out');
check(op > 0.8, 'a shown name is fully visible');
if (errs.length) { console.log('page errors:', errs.slice(0, 3)); ok = false; }
process.exit(ok ? 0 : 1);
