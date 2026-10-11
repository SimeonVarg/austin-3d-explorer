/**
 * rest-converge.mjs - A STILL CAMERA'S PICTURE BECOMES THE SUPERSAMPLED ONE, THEN THE PAGE STOPS DRAWING; Smooth edges is a live switch.
 *
 * Needs a real GPU (VERIFY_GL=hardware): js/frame-target.js switches the accumulation off on a software rasteriser, where
 * a frame costs seconds. The rule's logic is held without a browser by rest-rule.mjs, which runs in CI.
 *
 * One page load (_harness.html, frozen like moire-bar.mjs). Per view:
 *   a. TRUTH: 16 plain pictures, the lens shifted the meter's way (map padding), averaged.
 *   b. Accumulation on: the cycle finishes within DONE_MS, the canvas is within REST_MEAN of the truth (mean over ALL
 *      pixels, levels of 255) and no pixel is further than REST_MAX. The plain picture is PLAIN_MIN x further.
 *   c. THE PAGE STOPS: no frame is drawn in the 3 s that follow MapLibre's own label re-check.
 *   d. A camera move puts the plain picture back on the next frame (the canvas equals a plain picture of the new
 *      camera exactly) and the new camera converges.
 *   e. A parked change of the hour resets and converges on the NEW picture (no ghost of the old one in the mean).
 *   f. Smooth edges on, live: the frame is multisampled (the picture changes, no GL error), off puts back the plain
 *      picture exactly, and with both on the picture converges on the multisampled truth.
 *
 *   VERIFY_URL=http://127.0.0.1:<port> VERIFY_GL=hardware node rest-converge.mjs [--out dir] [--views campus-far,guad-street-night]
 *   --break   every lens shift is made the same one: the mean is then one shifted picture and (b) must FAIL (exit 1)
 */
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';
import fs from 'node:fs'; import path from 'node:path';

const REST_MEAN = 0.30, PLAIN_MIN = 4, DONE_MS = 15000;
const FAR_LEVELS = 3, FAR_SHARE = 0.002;   // pixels further than FAR_LEVELS from the truth: at most this share (a night view has a few lights that change by themselves)
const SAME_SHARE = 0.002;                  // "the same picture": at most this share of pixels differ
const VIEWS = {
  'campus-far':        { p: 0.2, center: [-97.7393, 30.2874],   zoom: 16.85, pitch: 74, bearing: 197.4 },
  'west-mid':          { p: 0.2, center: [-97.7445, 30.2880],   zoom: 16.6,  pitch: 72, bearing: 300 },
  'guad-street-night': { p: 1.0, center: [-97.74175, 30.28700], zoom: 18.6,  pitch: 82, bearing: 356 },
};
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const OUT = opt('--out', process.env.VERIFY_OUT || null), BREAK = argv.includes('--break');
const names = opt('--views', 'campus-far,guad-street-night').split(',');
if (OUT) fs.mkdirSync(OUT, { recursive: true });
let failed = 0;
const say = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) failed++; };

const browser = await launch(chromium, { maxMs: 25 * 60000 });
const page = await browser.newPage({ viewport: { width: 960, height: 600 }, deviceScaleFactor: 1 });
const errs = []; page.on('pageerror', e => errs.push(e.message));
page.on('console', m => { if (/WebGL|INVALID_|GL_INVALID/.test(m.text())) errs.push(m.text().slice(0, 200)); });
await page.addInitScript(() => { try { const K = 'austin3d.gfx.v1', cur = JSON.parse(localStorage.getItem(K) || '{}'); cur.autoDetected = true; cur.autoExposure = false; localStorage.setItem(K, JSON.stringify(cur)); } catch (e) {} });
await page.goto(`${BASE}/_harness.html?intro=0&drift=0&namelabels=0&facadepace=0&timeofdaypace=0&smooth=0&restaccum=0`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 420000 });
await page.waitForFunction(() => !document.getElementById('veil'), null, { timeout: 420000, polling: 500 });
await page.waitForFunction(() => { const A = window.slopesApartments; return !A || !!(A.count.done && A.group); }, null, { timeout: 420000, polling: 500 });
await page.waitForTimeout(1500);
const info = await page.evaluate(() => { const gl = window.__map.painter.context.gl, e = gl.getExtension('WEBGL_debug_renderer_info'), F = window.FrameTarget; window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect(); if (window.GFX) window.GFX.autoExposure = false;
  return { renderer: e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?', attached: !!(F && F.attached), own: !!(F && F.own()) }; });
console.log('renderer: ' + info.renderer);
say(info.attached && info.own, 'the frame target is attached and draws Smooth edges into its own buffer');
if (/swiftshader|llvmpipe/i.test(info.renderer)) { console.log('SKIP: a software rasteriser (the accumulation is off there by design). Run with VERIFY_GL=hardware.'); await browser.__done(); process.exit(failed ? 1 : 0); }

for (const name of names) {
  const v = VIEWS[name]; if (!v) { say(false, 'unknown view ' + name); continue; }
  const r = await page.evaluate(async ([v, BREAK, DONE_MS, FAR]) => {
    const m = window.__map, F = window.FrameTarget, gl = m.painter.context.gl, sleep = ms => new Promise(r => setTimeout(r, ms));
    const quiet = () => { const P = window.__facadePace, A = window.slopesApartments && window.slopesApartments.count, L = window.CityLighting && window.CityLighting.stats; return !(P && P.busy) && !(A && !A.done) && !(L && L.shadowProxyBuilding); };
    const settle = async () => { for (let k = 0; k < 2; k++) { const t = Date.now(); while (!quiet() && Date.now() - t < 120000) await sleep(100); await new Promise(r => { const to = setTimeout(r, 20000); m.once('idle', () => { clearTimeout(to); r(); }); m.triggerRepaint(); }); await sleep(120); } };
    const done = async () => { const t = performance.now(); await sleep(60); while (F.state() !== 'done' && performance.now() - t < DONE_MS) await sleep(20); return { ok: F.state() === 'done', ms: Math.round(performance.now() - t) }; };
    const cv2 = document.createElement('canvas'), cx = cv2.getContext('2d', { willReadFrequently: true });
    const grab = () => { const c = m.getCanvas(); cv2.width = c.width; cv2.height = c.height; cx.drawImage(c, 0, 0); return cx.getImageData(0, 0, c.width, c.height).data; };
    const png = () => { grab(); return cv2.toDataURL('image/png'); };
    const truth = async () => {                                   // the meter's truth: 16 plain pictures, the lens shifted by map padding
      const N = m.getCanvas().width * m.getCanvas().height, acc = new Float32Array(N * 3);
      for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
        const dx = (i + 0.5) / 4 - 0.5, dy = (j + 0.5) / 4 - 0.5;
        m.setPadding({ left: dx > 0 ? 2 * dx : 0, right: dx < 0 ? -2 * dx : 0, top: dy > 0 ? 2 * dy : 0, bottom: dy < 0 ? -2 * dy : 0 });
        await settle();
        const g = grab(); for (let p = 0, q = 0, o = 0; p < N; p++, q += 4, o += 3) { acc[o] += g[q]; acc[o + 1] += g[q + 1]; acc[o + 2] += g[q + 2]; }
      }
      m.setPadding({ left: 0, right: 0, top: 0, bottom: 0 }); await settle();
      for (let o = 0; o < acc.length; o++) acc[o] /= 16;
      return acc;
    };
    const vs = (img, T) => { let s = 0, mx = 0, far = 0; const N = T.length / 3; for (let p = 0, q = 0, o = 0; p < N; p++, q += 4, o += 3) { const d = (Math.abs(img[q] - T[o]) + Math.abs(img[q + 1] - T[o + 1]) + Math.abs(img[q + 2] - T[o + 2])) / 3; s += d; if (d > mx) mx = d; if (d > FAR) far++; } return { mean: s / N, max: mx, far: far / N }; };
    const differ = (a, b) => { let n = 0, s = 0; for (let i = 0; i < a.length; i += 4) { const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); if (d) n++; s += d / 3; } return { px: n, share: n / (a.length / 4), mean: s / (a.length / 4) }; };
    const out = { png: {} };
    F.setRest(false); F.setSmooth(false);
    m.stop(); m.jumpTo({ center: v.center, zoom: v.zoom, pitch: v.pitch, bearing: v.bearing });
    if (window.applyTimeOfDay) window.applyTimeOfDay(m, v.p, true);
    for (const id of m.getLayersOrder()) { const l = m.getLayer(id); if (l && l.type === 'symbol' && m.getLayoutProperty(id, 'visibility') !== 'none') m.setLayoutProperty(id, 'visibility', 'none'); }
    await settle(); await sleep(800); await settle();
    const plain = grab(); out.png.plain = png();
    const T = await truth();
    out.plain = vs(plain, T);
    if (BREAK) F.REST.order = F.REST.order.map(() => [0, 0]);
    // b. converge
    F.setRest(true); out.b = await done(); const rest = grab(); out.png.rest = png(); out.rest = vs(rest, T);
    // c. the page stops
    await sleep(1500); const f0 = F.stats.frames; await sleep(3000); out.parked = F.stats.frames - f0; out.stateParked = F.state();
    // d. a camera move: the very next picture is the plain one of the new camera
    const cam2 = { center: v.center, zoom: v.zoom, pitch: v.pitch, bearing: v.bearing + 3 };
    m.jumpTo(cam2); await new Promise(r => m.once('render', r)); const moved = grab(); out.stateMoved = F.state();
    out.d = await done();
    F.setRest(false); await settle(); const plain2 = grab(); out.movedVsPlain = differ(moved, plain2);
    m.jumpTo({ center: v.center, zoom: v.zoom, pitch: v.pitch, bearing: v.bearing }); await settle();
    // e. the hour changes while parked
    F.setRest(true); await done();
    const p2 = v.p > 0.5 ? 0.2 : 0.62;
    F.stats.who = {}; F.stats.why = {}; F.trace = true;
    window.applyTimeOfDay(m, p2, true); await settle(); out.e = await done(); const rest2 = grab();
    F.trace = false; out.eWho = { ...F.stats.who }; out.eWhy = { ...F.stats.why }; out.eState = F.state(); out.eBreaks = F.stats.breaks;
    F.setRest(false); await settle(); await sleep(500); await settle();
    const T2 = await truth(); out.hour = vs(rest2, T2); out.hourMoved = differ(rest, rest2).mean;
    window.applyTimeOfDay(m, v.p, true); await settle();
    // f. Smooth edges, live
    gl.getError();
    F.setSmooth(true); await settle(); const ms = grab(); out.png.msaa = png(); out.msaaOn = F.smoothOn(); out.msaaDiff = differ(plain, ms); out.glErr = gl.getError();
    out.msaa = vs(ms, T);
    const Tm = await truth();
    F.setRest(true); out.f = await done(); const both = grab(); out.png.restmsaa = png(); out.both = vs(both, Tm);
    F.setRest(false); F.setSmooth(false); await settle(); out.back = differ(plain, grab()); out.glErr2 = gl.getError();
    out.stats = JSON.parse(JSON.stringify(F.stats));
    return out;
  }, [v, BREAK, DONE_MS, FAR_LEVELS]);
  if (OUT) for (const k in r.png) fs.writeFileSync(path.join(OUT, `${name}.${k}.png`), Buffer.from(r.png[k].split(',')[1], 'base64'));
  const f = x => x.toFixed(3);
  console.log(`\n${name}: plain ${f(r.plain.mean)} from the truth; multisampled ${f(r.msaa.mean)}; converged ${f(r.rest.mean)} (max ${r.rest.max.toFixed(2)}); converged with Smooth edges ${f(r.both.mean)} (max ${r.both.max.toFixed(2)})`);
  say(r.b.ok, `${name}: the cycle finishes (${r.b.ms} ms)`);
  say(r.rest.mean <= REST_MEAN && r.rest.far <= FAR_SHARE, `${name}: the converged picture is the truth: mean ${f(r.rest.mean)} <= ${REST_MEAN}; ${(r.rest.far * 100).toFixed(3)}% of pixels further than ${FAR_LEVELS} levels (<= ${FAR_SHARE * 100}%), worst ${r.rest.max.toFixed(2)}`);
  say(r.plain.mean >= PLAIN_MIN * r.rest.mean, `${name}: the plain picture is ${(r.plain.mean / Math.max(1e-9, r.rest.mean)).toFixed(0)}x further from it (>= ${PLAIN_MIN}x)`);
  say(r.parked === 0 && r.stateParked === 'done', `${name}: parked and converged, the page draws nothing (${r.parked} frames in 3 s)`);
  say(r.stateMoved !== 'done' && r.movedVsPlain.share <= SAME_SHARE, `${name}: a camera move shows the plain picture at once (${r.movedVsPlain.px} pixels differ from a plain frame of the new camera)`);
  say(r.d.ok, `${name}: the new camera converges (${r.d.ms} ms)`);
  say(r.e.ok && r.hourMoved > 1 && r.hour.mean <= REST_MEAN, `${name}: the hour changed while parked: it converges again (${r.e.ms} ms) on the NEW picture (mean ${f(r.hour.mean)} from the new truth; the picture moved ${r.hourMoved.toFixed(1)})` + (r.e.ok ? '' : ` state ${r.eState} breaks ${r.eBreaks} why ${JSON.stringify(r.eWhy)} who ${JSON.stringify(r.eWho)}`));
  say(r.msaaOn && r.msaaDiff.mean > 0.2 && r.glErr === 0 && r.msaa.mean < r.plain.mean, `${name}: Smooth edges switched on live: multisampled, ${f(r.msaa.mean)} from the truth against ${f(r.plain.mean)}, no GL error`);
  say(r.f.ok && r.both.mean <= REST_MEAN, `${name}: with Smooth edges on the picture converges too (mean ${f(r.both.mean)} from the multisampled truth)`);
  say(r.back.share <= SAME_SHARE && r.glErr2 === 0, `${name}: both switched off: the plain picture again (${r.back.px} pixels differ)`);
  console.log(`  frames: ${JSON.stringify(r.stats)}`);
}
say(errs.length === 0, 'no page error and no WebGL warning' + (errs.length ? ': ' + [...new Set(errs)].slice(0, 4).join(' | ') : ''));
console.log(failed ? `\n${failed} FAILED` : '\nall hold');
await browser.__done();
process.exit(failed ? 1 : 0);
