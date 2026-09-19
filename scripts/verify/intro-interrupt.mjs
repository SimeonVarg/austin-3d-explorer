/**
 * intro-interrupt.mjs — does touching the controls during the opening flight
 * keep the camera where it is?
 *
 * REPORTED: "moving during the intro teleports me behind campus." The opening
 * flight (js/app.js primeIntro) used to answer any input with
 * `map.stop(); map.jumpTo(INTRO.end)` — a cut to the flight's LAST frame, over
 * north campus facing south, from wherever the camera was. This script is the
 * guard for the fix: the first navigation input stops the flight on the frame
 * the user is looking at and the movement carries on from there.
 *
 * WHAT IT DOES. Loads the REAL index.html once per case, records the camera on
 * every animation frame (map pose, the camera's own lng/lat/altitude from
 * MapLibre's transform, and window.__fly.eye()), fires ONE real input at a
 * chosen moment of the flight, and asserts on the recorded trajectory:
 *
 *   jump      the step across the input frame is no bigger than the flight's
 *             own per-frame step just before it plus what the controller can
 *             move in one frame (horizontal, vertical, bearing)
 *   stopped   no camera ease runs after the controller has taken the camera,
 *             i.e. neither leg of the flight resumes on top of the user
 *   reach     over the observation window the eye moves no further than the
 *             controller's own top speed allows — the flight is 5-20x faster
 *   effect    the input did what it does (W goes forward along the bearing,
 *             the arrow strafes, Q/wheel climb, a drag turns) FROM the pose the
 *             user was looking at
 *   sync      __fly.eye() agrees with the map's camera afterwards
 *
 * PHASES (the flight's timeline, measured from the moment the veil lifts):
 *   veil      under the load veil, before departure (camera primed at start)
 *   reveal    the first frames after the veil lifts (the handoff)
 *   leg1      3.0 s into leg 1 (the climb over the Capitol, fastest motion)
 *   boundary  the instant leg 1 ends / leg 2 begins (was a 30 ms timer gap)
 *   leg2      3.0 s into leg 2 (the run north and the bank)
 *   settle    ~6 s into leg 2 (the long ease-out onto the Tower)
 * plus two SYNTHETIC cases fired from inside the page at the exact instant a
 * real input cannot hit reliably: `reveal-exact` (in the microtask after the
 * veil's class flips, before the flight's first frame) and `boundary-exact`
 * (inside leg 1's own moveend).
 *
 * INPUTS: key-w, key-arrow (ArrowLeft), key-q, drag (mouse look), wheel —
 * desktop 1280x800; joystick, touch-look — phone 390x844, touch, via CDP touch
 * events so the browser generates the real pointer + touch event pairs.
 *
 * CONTROL CASES: `none` (no input — the flight must still play and end exactly
 * on INTRO.end), `none-probe` (same, with the graphics auto-detect probe left
 * running, i.e. normal startup), `home` (R during leg 1 — the deliberate reset
 * must still reach the spawn pose and stay there), `tour` / `autopilot`
 * (?tour=1 / ?autopilot=1 still replace the intro and still move).
 *
 * Usage:
 *   VERIFY_URL=http://127.0.0.1:8611 VERIFY_GL=hardware \
 *     node scripts/verify/intro-interrupt.mjs [--only=key-w@leg1,none] \
 *       [--inputs=key-w,drag] [--phases=leg1,leg2] [--controls=0] \
 *       [--record=key-w@leg1,drag@leg2] [--out=<dir>] [--report]
 *
 * Exit 1 if any case fails (unless --report). Writes <out>/intro-interrupt.json
 * with every case's numbers and, for --record cases, a screencast of JPEG
 * frames named by milliseconds relative to the input.
 *
 * Browser count: ONE browser for the whole run, one page at a time. On the
 * owner's laptop wrap it in the lane GPU slot runner.
 */
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';

const arg = (k, d) => {
  const a = process.argv.find(s => s.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};
const REPORT = process.argv.includes('--report');
const OUT = path.resolve(arg('out', 'shots/intro-interrupt'));
fs.mkdirSync(OUT, { recursive: true });
const list = s => (s ? s.split(',').map(x => x.trim()).filter(Boolean) : null);
const ONLY = list(arg('only'));
const INPUTS = list(arg('inputs')) || ['key-w', 'key-arrow', 'key-q', 'drag', 'wheel', 'joystick', 'touch-look'];
const PHASES = list(arg('phases')) || ['veil', 'reveal', 'leg1', 'boundary', 'leg2', 'settle'];
const CONTROLS = arg('controls', '1') !== '0';
const RECORD = new Set(list(arg('record')) || []);
const DUMP = process.argv.includes('--dump');   // also write each case's raw frame log
// Extra URL parameters for every case, e.g. --query=apartments=0 to skip the
// authored-apartment wait under the veil (on a loaded machine that wait runs to
// its 90 s ceiling, which is a veil question, not an interrupt one).
const EXTRA_Q = arg('query', '') ? '&' + arg('query', '').replace(/^[?&]/, '') : '';

// The flight's own constants, mirrored for the assertions only (js/app.js
// INTRO). If INTRO changes, change these with it; `none` fails loudly if not.
const INTRO_END = { center: [-97.7365, 30.2900], zoom: 16.45, pitch: 74, bearing: 202 };
const OBS_MS = 2500;            // observation window after the input
const HOLD_MS = 1000;           // how long a key / joystick is held

const DESKTOP = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true };
const MOBILE_INPUTS = new Set(['joystick', 'touch-look']);

// ── In-page recorder ───────────────────────────────────────────────────────
// Installed before any app script runs, so its window listeners are the FIRST
// capture listeners and log an input before anything can react to it, and its
// map listeners are registered before the intro's own.
function recorder() {
  const L = window.__ii = { frames: [], inputs: [], events: [], revealAt: null, introAt: null,
                            leg1EndAt: null, hooks: {}, hooked: false, epoch: performance.timeOrigin };
  const log = e => L.inputs.push({ t: performance.now(), type: e.type, code: e.code || null,
                                   ptype: e.pointerType || null, trusted: e.isTrusted,
                                   x: e.clientX != null ? e.clientX : null, mx: e.movementX != null ? e.movementX : null });
  for (const t of ['keydown', 'keyup', 'pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture',
                   'mousedown', 'wheel', 'touchstart', 'touchend'])
    window.addEventListener(t, log, true);
  const watchVeil = () => {
    const v = document.getElementById('veil');
    if (!v) { if (L.revealAt == null && document.readyState !== 'loading') L.noVeil = true; return; }
    new MutationObserver(() => {
      if (L.revealAt == null && v.classList.contains('lift')) {
        L.revealAt = performance.now();
        try { L.hooks.reveal && L.hooks.reveal(); } catch (e) { L.hookError = String(e); }
      }
    }).observe(v, { attributes: true, attributeFilter: ['class'] });
  };
  document.addEventListener('DOMContentLoaded', watchVeil);
  // The controller announces a takeover BEFORE it stops the ease and re-reads
  // the pose (js/controls.js), and this listener was registered first, so this
  // is the camera exactly as the flight left it: the interrupted pose.
  L.takeovers = [];
  window.addEventListener('flycam:takeover', () => {
    const m = window.__map;
    try {
      const c = m.getCenter(), cam = m.transform.getCameraLngLat();
      L.takeovers.push({ t: performance.now(), lng: c.lng, lat: c.lat, z: m.getZoom(), p: m.getPitch(),
                         b: m.getBearing(), cLng: cam.lng, cLat: cam.lat, alt: m.transform.getCameraAltitude(),
                         easing: m.isEasing() });
    } catch (e) { L.takeovers.push({ t: performance.now(), error: String(e) }); }
  });
  const R = Math.PI / 180;
  const loop = () => {
    const m = window.__map;
    if (m && m.transform && typeof m.getCenter === 'function') {
      if (!L.hooked) {
        L.hooked = true;
        const ev = type => e => {
          const rec = { t: performance.now(), type, intro: e && e.introLeg != null ? e.introLeg : null,
                        fly: !!(e && e.fly), tour: !!(e && e.tour), easing: m.isEasing() };
          L.events.push(rec);
          if (type === 'moveend' && L.revealAt != null && L.leg1EndAt == null && !rec.fly) {
            L.leg1EndAt = rec.t;
            try { L.hooks.leg1End && L.hooks.leg1End(); } catch (err) { L.hookError = String(err); }
          }
        };
        m.on('movestart', ev('movestart'));
        m.on('moveend', ev('moveend'));
      }
      if (window.__intro && L.introAt == null) L.introAt = performance.now();
      try {
        const c = m.getCenter(), tr = m.transform;
        const cam = tr.getCameraLngLat ? tr.getCameraLngLat() : null;
        const f = window.__fly && window.__fly.eye ? window.__fly.eye() : null;
        L.frames.push({
          t: performance.now(), lng: c.lng, lat: c.lat, z: m.getZoom(), p: m.getPitch(), b: m.getBearing(),
          roll: m.getRoll ? m.getRoll() : 0, fov: m.getVerticalFieldOfView ? m.getVerticalFieldOfView() : null,
          cLng: cam ? cam.lng : null, cLat: cam ? cam.lat : null, alt: tr.getCameraAltitude(),
          easing: m.isEasing(),
          fly: f ? { lng: f.lng, lat: f.lat, alt: f.alt, b: f.bearing, p: f.pitch, vE: f.vE, vN: f.vN,
                     driving: f.driving } : null,
        });
      } catch (e) { L.frameError = String(e); }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  // In-page synthetic inputs for the two instants CDP cannot hit reliably.
  L.synthKey = (code, holdMs) => {
    const key = code === 'KeyW' ? 'w' : code;
    document.body.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true, cancelable: true }));
    setTimeout(() => document.body.dispatchEvent(new KeyboardEvent('keyup', { code, key, bubbles: true })), holdMs);
  };
}

// ── Geometry ───────────────────────────────────────────────────────────────
const M_LAT = 111195.08;
const hdist = (a, b) => Math.hypot((b.lng - a.lng) * M_LAT * Math.cos(a.lat * Math.PI / 180), (b.lat - a.lat) * M_LAT);
const camOf = f => ({ lng: f.cLng, lat: f.cLat });
const wrap180 = d => ((d % 360) + 540) % 360 - 180;
const heading = (a, b) => {   // degrees clockwise from north, a -> b
  const e = (b.lng - a.lng) * M_LAT * Math.cos(a.lat * Math.PI / 180), n = (b.lat - a.lat) * M_LAT;
  return (Math.atan2(e, n) * 180 / Math.PI + 360) % 360;
};
const r2 = v => (v == null ? null : Math.round(v * 100) / 100);

// ── The flight's own path ──────────────────────────────────────────────────
// MapLibre's easeTo interpolates zoom, pitch and bearing LINEARLY in the eased
// progress k (the centre is not linear, so it is not used). So from a frame's
// zoom the leg's k is exact, and pitch and bearing must agree with it; and a
// frame can never be further along than easing((t - legStart) / duration).
// Mirrors js/app.js INTRO. The `none` case runs this over a whole uninterrupted
// flight, so a wrong model fails there first.
const INTRO_M = {
  start: { z: 16.2, p: 78, b: 5 }, crest: { z: 15.45, p: 71, b: 3 }, end: { z: 16.45, p: 74, b: 202 },
  leg1Ms: 6000, leg2Ms: 6600,
  ease1: t => 0.5 - 0.5 * Math.cos(Math.PI * t),
  ease2: t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
};
// easeTo takes the short way round: 3 -> 202 is -161 degrees.
const shortTo = (from, to) => from + wrap180(to - from);
function flightLegs(d) {
  const ms = d.events.filter(e => e.type === 'movestart' && !e.fly && !e.tour);
  const l1 = ms.find(e => e.intro === 1) ||
             (d.revealAt != null ? ms.find(e => e.intro == null && e.t >= d.revealAt - 5) : null) || null;
  let l2 = ms.find(e => e.intro === 2) || null;
  if (!l2 && l1 && d.leg1EndAt != null && !ms.some(e => e.intro != null))
    l2 = ms.find(e => e.t >= d.leg1EndAt - 0.5 && e.t - d.leg1EndAt < 200 && e !== l1) || null;
  return { l1: l1 ? l1.t : null, l2: l2 ? l2.t : null };
}
function legAt(t, legs) {
  const M = INTRO_M;
  if (legs.l1 == null || t < legs.l1) return { n: 0, a: M.start, b: M.start, kExp: 0 };
  if (legs.l2 == null || t < legs.l2)
    return { n: 1, a: M.start, b: M.crest, kExp: M.ease1(Math.min(1, (t - legs.l1) / M.leg1Ms)) };
  return { n: 2, a: M.crest, b: M.end, kExp: M.ease2(Math.min(1, (t - legs.l2) / M.leg2Ms)) };
}
function pathCheck(frames, legs) {
  let ok = true, worst = null, prev = null, detail = `${frames.length} frames on path`;
  for (const f of frames) {
    const L = legAt(f.t, legs);
    const bEnd = shortTo(L.a.b, L.b.b);
    const k = L.n === 0 ? 0 : (f.z - L.a.z) / (L.b.z - L.a.z);
    const pErr = Math.abs(f.p - (L.a.p + (L.b.p - L.a.p) * k));
    const bErr = Math.abs(wrap180(f.b - (L.a.b + (bEnd - L.a.b) * k)));
    const zErr = L.n === 0 ? Math.abs(f.z - L.a.z) : 0;
    const ahead = k - L.kExp;
    const back = prev && prev.n === L.n ? prev.k - k : 0;
    const bad = zErr > 1e-3 || pErr > 0.15 || bErr > 0.5 || ahead > 0.03 || back > 0.01 || k < -0.01 || k > 1.01;
    const score = Math.max(zErr / 1e-3, pErr / 0.15, bErr / 0.5, ahead / 0.03, back / 0.01);
    if (!worst || score > worst.score)
      worst = { score: r2(score), leg: L.n, k: r2(k), kExp: r2(L.kExp), pErr: r2(pErr), bErr: r2(bErr), zErr: r2(zErr) };
    if (bad && ok) {
      ok = false;
      detail = `off the flight's path on leg ${L.n}: k ${r2(k)} (clock allows ${r2(L.kExp)}), ` +
               `pitch off ${r2(pErr)} deg, bearing off ${r2(bErr)} deg` + (L.n === 0 ? `, zoom off ${r2(zErr)}` : '');
    }
    prev = { n: L.n, k };
  }
  return { ok, detail, worst };
}
// At most one more eased frame: how far the flight could move between the
// last frame it drew (`f`) and time `t`, from the path itself.
function oneFlightFrame(f, t, legs) {
  const L = legAt(t, legs);
  if (L.n === 0) return { h: 0, v: 0, b: 0 };
  const k0 = (f.z - L.a.z) / (L.b.z - L.a.z);
  const dk = Math.max(0, L.kExp - k0);
  const bEnd = shortTo(L.a.b, L.b.b);
  // The eye moves at most ~4.5 km over a whole leg (leg 2's bank); scale by dk.
  return { h: 4500 * dk + 2, v: 400 * dk + 2, b: Math.abs(bEnd - L.a.b) * dk + 0.2 };
}

// ── Inputs ─────────────────────────────────────────────────────────────────
async function canvasPoint(page, fx, fy) {
  return page.evaluate(([fx, fy]) => {
    const cv = window.__map.getCanvas();
    const r = cv.getBoundingClientRect();
    // Find a point that really hits the canvas (UI chrome floats over it).
    for (const [dx, dy] of [[0, 0], [0.1, 0], [-0.1, 0], [0, 0.1], [0, -0.1], [0.15, 0.15], [-0.15, 0.15]]) {
      const x = r.left + r.width * (fx + dx), y = r.top + r.height * (fy + dy);
      const el = document.elementFromPoint(x, y);
      if (el === cv) return { x, y };
    }
    return { x: r.left + r.width * fx, y: r.top + r.height * fy, blocked: true };
  }, [fx, fy]);
}

// Everything that needs a round trip (where is the canvas, where is the stick,
// hover the mouse there) happens BEFORE the phase wait, so that at the chosen
// moment only the input itself is sent. On a loaded machine each CDP input
// call returns only once the renderer has handled it (measured: up to ~1 s per
// event), so the time the PAGE saw the input is what every check uses — it is
// logged by the recorder, not assumed.
async function prepareInput(page, input) {
  if (input === 'drag' || input === 'wheel') {
    const p = await canvasPoint(page, 0.5, 0.45);
    await page.mouse.move(p.x, p.y);
    return p;
  }
  if (input === 'touch-look') return canvasPoint(page, 0.6, 0.35);
  if (input === 'joystick') {
    return page.evaluate(() => {
      const b = document.getElementById('joystick-base');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, visible: r.width > 0 };
    });
  }
  return null;
}

async function fireInput(page, cdp, input, p) {
  switch (input) {
    case 'key-w': case 'key-arrow': case 'key-q': case 'home': {
      const key = { 'key-w': 'KeyW', 'key-arrow': 'ArrowLeft', 'key-q': 'KeyQ', home: 'KeyR' }[input];
      await page.keyboard.down(key);
      await page.waitForTimeout(input === 'home' ? 60 : HOLD_MS);
      await page.keyboard.up(key);
      return { key };
    }
    case 'drag': {
      await page.mouse.down();
      for (let i = 1; i <= 10; i++) { await page.mouse.move(p.x + 20 * i, p.y); await page.waitForTimeout(40); }
      await page.mouse.up();
      return { px: 200, at: p };
    }
    case 'wheel': {
      await page.mouse.wheel(0, -240);
      await page.waitForTimeout(150);
      await page.mouse.wheel(0, -240);
      return { deltaY: -480, at: p };
    }
    case 'joystick': {
      const j = p;
      if (!j || !j.visible) return { error: 'joystick not visible' };
      const tp = (x, y) => [{ x, y, id: 7, radiusX: 10, radiusY: 10, force: 1 }];
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(j.x, j.y) });
      for (let i = 1; i <= 4; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(j.x, j.y - 8 * i) });
        await page.waitForTimeout(20);
      }
      await page.waitForTimeout(HOLD_MS);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      return { at: j };
    }
    case 'touch-look': {
      const tp = (x, y) => [{ x, y, id: 3, radiusX: 10, radiusY: 10, force: 1 }];
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(p.x, p.y) });
      for (let i = 1; i <= 10; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(p.x - 15 * i, p.y) });
        await page.waitForTimeout(40);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      return { px: -150, at: p };
    }
  }
  throw new Error('unknown input ' + input);
}

// ── One case ───────────────────────────────────────────────────────────────
async function waitPhase(page, phase) {
  const until = (fn, arg) => page.waitForFunction(fn, arg, { timeout: 150000, polling: 'raf' });
  if (phase === 'veil') {
    // Fire as soon as the flight is primed (the start pose is set in the same
    // task that publishes window.__intro). Under the veil rAF can stall for
    // seconds, so this polls on a timer, not on frames.
    await page.waitForFunction(() => !!window.__intro, null, { timeout: 150000, polling: 100 });
    return page.evaluate(() => window.__ii.revealAt == null);
  }
  await until(() => window.__ii && window.__ii.introAt != null);
  if (phase === 'reveal') { await until(() => window.__ii.revealAt != null); return true; }
  if (phase === 'boundary') { await until(() => window.__ii.leg1EndAt != null); return true; }
  const off = { leg1: 3000, leg2: 9030, settle: 12030 }[phase];
  if (off == null) throw new Error('unknown phase ' + phase);
  await until(o => window.__ii.revealAt != null && performance.now() >= window.__ii.revealAt + o, off);
  return true;
}

async function runCase(browser, spec) {
  const ctx = await browser.newContext(spec.mobile ? PHONE : DESKTOP);
  await ctx.addInitScript(recorder);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const cdp = await ctx.newCDPSession(page);
  const frames = [];
  if (spec.record) {
    cdp.on('Page.screencastFrame', f => {
      frames.push({ ts: f.metadata.timestamp * 1000, data: f.data });
      cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    });
  }
  const q = (spec.query || '') + EXTRA_Q;
  await page.goto(`${BASE}/index.html?drift=0${q}`, { timeout: 90000 });
  if (!spec.keepProbe) {
    page.waitForFunction(() => typeof window.cancelGraphicsAutoDetect === 'function', null, { timeout: 60000 })
      .then(() => page.evaluate(() => window.cancelGraphicsAutoDetect())).catch(() => {});
  }
  if (spec.record) await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70, maxWidth: 800, maxHeight: 800 });

  let fired = null, phaseOk = true;
  if (spec.kind === 'input') {
    if (spec.phase === 'reveal-exact' || spec.phase === 'boundary-exact') {
      await page.waitForFunction(() => window.__ii && window.__ii.introAt != null, null, { timeout: 150000 });
      await page.evaluate(([ph, hold]) => {
        const L = window.__ii;
        L.hooks[ph === 'reveal-exact' ? 'reveal' : 'leg1End'] = () => L.synthKey('KeyW', hold);
      }, [spec.phase, HOLD_MS]);
      await page.waitForFunction(ph => ph === 'reveal-exact' ? window.__ii.revealAt != null : window.__ii.leg1EndAt != null,
                                 spec.phase, { timeout: 150000, polling: 'raf' });
      fired = { synthetic: 'KeyW' };
      await page.waitForTimeout(HOLD_MS);
    } else {
      await page.waitForFunction(() => window.__map && window.__intro, null, { timeout: 150000, polling: 100 });
      const prep = await prepareInput(page, spec.input);
      phaseOk = await waitPhase(page, spec.phase);
      fired = await fireInput(page, cdp, spec.input, prep);
    }
    await page.waitForTimeout(OBS_MS);
    // An input before the leg boundary is watched until past the moment leg 2
    // WOULD have started: a flight that is only half-cancelled shows up there
    // (it did, for a mouse drag, before the fix).
    if (['veil', 'reveal', 'reveal-exact', 'leg1'].includes(spec.phase)) {
      await page.waitForFunction(() => window.__ii.revealAt != null &&
        performance.now() >= window.__ii.revealAt + 7200, null, { timeout: 150000, polling: 200 });
    }
  } else if (spec.kind === 'none') {
    await page.waitForFunction(() => window.__ii && window.__ii.revealAt != null, null, { timeout: 150000 });
    await page.waitForTimeout(14500);
  } else if (spec.kind === 'home') {
    phaseOk = await waitPhase(page, 'leg1');
    fired = await fireInput(page, cdp, 'home', null);
    await page.waitForTimeout(3000);
  } else if (spec.kind === 'tour') {
    await page.waitForFunction(() => window.__ii && window.__ii.revealAt != null, null, { timeout: 150000 });
    await page.waitForTimeout(5000);
  }
  if (spec.record) await cdp.send('Page.stopScreencast').catch(() => {});

  const data = await page.evaluate(() => {
    const L = window.__ii, I = window.__intro || null;
    const intro = I ? { reason: I.reason, waitedMs: I.waitedMs, flight: I.flight ? JSON.parse(JSON.stringify(I.flight)) : null } : null;
    let consts = null, home = null;
    try { consts = window.__fly.consts(); } catch (e) {}
    try { home = window.__fly.home ? window.__fly.home() : null; } catch (e) {}
    return { frames: L.frames, inputs: L.inputs, events: L.events, revealAt: L.revealAt, introAt: L.introAt,
             takeovers: L.takeovers || [],
             leg1EndAt: L.leg1EndAt, hookError: L.hookError || null, frameError: L.frameError || null,
             epoch: L.epoch, intro, consts, home };
  });
  await page.close();
  await ctx.close();
  if (DUMP) fs.writeFileSync(path.join(OUT, `raw-${spec.id.replace(/[^\w@-]/g, '_')}.json`),
                             JSON.stringify({ spec, fired, phaseOk, errors, data }));
  const res = analyse(spec, data, fired, phaseOk, errors);
  if (spec.record) res.recording = saveRecording(spec, frames, data, res);
  return res;
}

function saveRecording(spec, frames, data, res) {
  const dir = path.join(OUT, 'rec', spec.id.replace(/[^\w@-]/g, '_'));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const t0 = res.tInAbs != null ? res.tInAbs : (data.revealAt != null ? data.epoch + data.revealAt : null);
  let n = 0;
  for (const f of frames) {
    if (t0 == null) break;
    const rel = Math.round(f.ts - t0);
    if (rel < -1500 || rel > OBS_MS + 500) continue;
    const name = `f${rel < 0 ? 'm' : 'p'}${String(Math.abs(rel)).padStart(5, '0')}.jpg`;
    fs.writeFileSync(path.join(dir, name), Buffer.from(f.data, 'base64'));
    n++;
  }
  return { dir, frames: n };
}

// ── Analysis ───────────────────────────────────────────────────────────────
function analyse(spec, d, fired, phaseOk, errors) {
  const F = d.frames.filter(f => f.cLng != null);
  const res = { id: spec.id, kind: spec.kind, input: spec.input || null, phase: spec.phase || null,
                pass: true, checks: [], notes: [], fired, intro: d.intro,
                errors: errors.filter(e => !/favicon|404/.test(e)).slice(0, 5) };
  const check = (name, ok, detail) => { res.checks.push({ name, ok: !!ok, detail }); if (!ok) res.pass = false; };
  if (d.frameError) res.notes.push('frame recorder error: ' + d.frameError);
  if (d.hookError) res.notes.push('hook error: ' + d.hookError);
  const reveal = d.revealAt;
  const leg1End = d.leg1EndAt;

  if (spec.kind === 'none') {
    const last = F[F.length - 1];
    const dC = hdist({ lng: last.lng, lat: last.lat }, { lng: INTRO_END.center[0], lat: INTRO_END.center[1] });
    const easingEnd = F.filter(f => f.t > reveal + 13600).some(f => f.easing);
    check('flight ends on INTRO.end', dC < 0.5 && Math.abs(last.z - INTRO_END.zoom) < 1e-3 &&
          Math.abs(last.p - INTRO_END.pitch) < 0.01 && Math.abs(wrap180(last.b - INTRO_END.bearing)) < 0.01,
          `centre off ${dC.toFixed(3)} m, z ${last.z.toFixed(4)}, p ${last.p.toFixed(3)}, b ${last.b.toFixed(3)}`);
    const firstEase = F.find(f => f.t >= reveal && f.easing);
    const lastEase = [...F].reverse().find(f => f.easing);
    const dur = firstEase && lastEase ? lastEase.t - firstEase.t : null;
    check('flight plays both legs (~12.6 s of easing)', dur != null && dur > 11800 && dur < 14500,
          `eased for ${dur == null ? 'n/a' : (dur / 1000).toFixed(2) + ' s'}`);
    check('camera at rest after the flight', !easingEnd, easingEnd ? 'still easing at reveal+13.6 s' : 'at rest');
    // Largest single-frame step during the whole flight: the flight's own
    // scale, which is what makes the teleport stand out against it.
    let maxStep = 0;
    for (let i = 1; i < F.length; i++) if (F[i].t > reveal) maxStep = Math.max(maxStep, hdist(camOf(F[i - 1]), camOf(F[i])));
    res.flightMaxStepM = r2(maxStep);
    const flyingFrames = F.filter(f => f.t > reveal && f.t < reveal + 12700);
    res.flightFps = r2(flyingFrames.length / 12.7);
    const legsN = flightLegs(d);
    const pc = pathCheck(F.filter(f => reveal != null && f.t >= reveal - 200), legsN);
    check('uninterrupted flight stays on the modelled path (validates the path check)', pc.ok, pc.detail);
    check('controller never takes the camera on its own', !F.some(f => f.t > reveal && f.fly && f.fly.driving),
          F.some(f => f.t > reveal && f.fly && f.fly.driving) ? 'driving went true with no input' : 'never drove');
    if (d.intro && d.intro.flight) check('flight state is done', d.intro.flight.state === 'done', `state ${d.intro.flight.state}`);
    check('no page errors', res.errors.length === 0, res.errors.join(' | ') || 'none');
    return res;
  }
  if (spec.kind === 'tour') {
    const moved = F.some(f => f.t > reveal && f.easing);
    check(`${spec.id} moves the camera after the veil`, moved, moved ? 'easing seen' : 'never eased');
    check(`${spec.id} replaces the intro`, !d.intro || !d.intro.flight, d.intro && d.intro.flight ? 'intro flight armed' : 'no intro flight');
    check('no page errors', res.errors.length === 0, res.errors.join(' | ') || 'none');
    return res;
  }

  // Input cases: when did the input land?
  const wantType = { 'key-w': 'keydown', 'key-arrow': 'keydown', 'key-q': 'keydown', drag: 'pointerdown',
                     wheel: 'wheel', joystick: 'pointerdown', 'touch-look': 'pointerdown' }[spec.input] || 'keydown';
  const ev = d.inputs.find(e => e.type === (spec.kind === 'home' ? 'keydown' : wantType) &&
                                (spec.phase === 'reveal-exact' || spec.phase === 'boundary-exact' ? !e.trusted : true));
  if (!ev) { check('input landed', false, 'no input event recorded'); return res; }
  const tIn = ev.t;
  res.tInAbs = d.epoch + tIn;
  const leg2Start = (d.events.find(e => e.type === 'movestart' && leg1End != null && e.t >= leg1End - 0.5 && !e.fly) || {}).t;
  res.landed = reveal == null ? 'no reveal' : tIn < reveal ? `veil (${Math.round(reveal - tIn)} ms before lift)`
    : leg1End == null || tIn < leg1End ? `leg1 +${Math.round(tIn - reveal)} ms`
    : `leg1 end +${Math.round(tIn - leg1End)} ms` + (leg2Start != null ? `, leg2 began +${Math.round(leg2Start - leg1End)} ms` : '');
  if (!phaseOk || (spec.phase === 'veil' && reveal != null && tIn >= reveal))
    res.notes.push('veil phase missed: the input landed after the veil lifted; judged as ' + res.landed);

  // The gesture's LAST event. On a loaded machine CDP input is delivered as
  // the renderer gets to it (measured: a 10-step drag took 11 s), so every
  // "did it act" reading is taken after the gesture ends, not at a fixed delay.
  const GESTURE = new Set(['keydown', 'keyup', 'pointerdown', 'pointermove', 'pointerup', 'wheel', 'touchstart', 'touchend']);
  const tEndIn = Math.max(tIn, ...d.inputs.filter(e => e.t >= tIn && GESTURE.has(e.type)).map(e => e.t));
  res.gestureMs = Math.round(tEndIn - tIn);
  const before = [...F].reverse().find(f => f.t < tIn);
  let endT = tEndIn + OBS_MS;
  if (reveal != null && tIn < reveal + 6100) endT = Math.max(endT, reveal + 7000);
  const after = F.filter(f => f.t >= tIn && f.t <= endT);
  if (!before || after.length < 3) { check('frames around the input', false, `${after.length} frames after`); return res; }
  const take = after.find(f => f.fly && f.fly.driving);
  const ALT_REF = d.consts ? d.consts.ALT_REF : 163;
  const vmax = a => Math.min(120, Math.max(1, 40 * Math.pow(a / ALT_REF, 0.75)));

  // The flight's own per-frame motion just before the input: the step across
  // the input may be as large as that (the flight's last frame) plus what the
  // controller can do in one or two ticks, and no larger.
  const look = spec.input === 'drag' || spec.input === 'touch-look';
  const wheel = spec.input === 'wheel';
  const home = spec.kind === 'home';
  const legs = flightLegs(d);
  // The interrupted pose: the recorder's snapshot at the controller's takeover
  // announcement when there is one (new code), else the last frame the flight
  // drew before the controller's first frame.
  const snap = (d.takeovers || []).find(x => x.t >= tIn - 1 && !x.error) || null;
  const base = take ? ([...F].reverse().find(f => f.t < take.t) || before) : before;
  const ref = snap || base;
  res.takeover = take ? { ms: Math.round(take.t - tIn), flightFrames: after.filter(f => f.t < take.t).length,
                          snapshot: !!snap } : null;

  // 1. UNTIL THE TAKEOVER THE FLIGHT IS STILL FLYING, and every frame it draws
  //    must be ON ITS OWN PATH and no further along it than the clock allows.
  //    That is what separates the flight lurching forward on a starved frame
  //    (measured here: 100 m in one step at 4 fps) from a cut to another pose.
  const flightFrames = [...F.filter(f => f.t >= tIn - 600 && f.t < tIn), ...after.filter(f => !take || f.t < take.t)];
  if (snap) flightFrames.push(snap);
  const onPath = pathCheck(flightFrames, legs);
  res.flightPath = { frames: flightFrames.length, worst: onPath.worst };
  if (!home) check('flight stays on its own path until the takeover (no cut)', onPath.ok, onPath.detail);

  // 2. FROM THE TAKEOVER ON, only the controller moves the camera: the first
  //    controller frame against the interrupted pose, then frame to frame.
  let worst = { over: 0 };
  const ctl = { h: 0, b: 0, v: 0 };
  const ctlSeq = take ? [ref, ...after.filter(f => f.t >= take.t)] : [];
  for (let i = 1; i < ctlSeq.length; i++) {
    const a = ctlSeq[i - 1], b = ctlSeq[i];
    const h = hdist(camOf(a), camOf(b));
    const v = Math.abs(b.alt - a.alt);
    const db = Math.abs(wrap180(b.b - a.b));
    ctl.h = Math.max(ctl.h, h); ctl.b = Math.max(ctl.b, db); ctl.v = Math.max(ctl.v, v);
    // DT_MAX is 0.1 s per controller tick; allow two ticks between samples.
    // Without a takeover snapshot (old code), the handover step may also hold
    // one more eased frame the map drew before the controller's tick stopped it.
    const extra = i === 1 && !snap ? oneFlightFrame(base, take.t, legs) : { h: 0, v: 0, b: 0 };
    const hAllow = vmax(Math.max(a.alt, b.alt)) * 0.2 * 1.3 + 1.5 + extra.h;
    const vAllow = (wheel ? a.alt * 1.6 : a.alt * 0.12) + 45 * 0.2 + 1.5 + extra.v;
    const bAllow = (look ? 45 : 0.6) + extra.b;
    const over = Math.max(h / hAllow, v / vAllow, db / bAllow);
    if (over > worst.over) worst = { over, h, v, b: db, hAllow, vAllow, bAllow, t: b.t - tIn, handover: i === 1 };
  }
  res.controllerMaxStep = { h: r2(ctl.h), v: r2(ctl.v), b: r2(ctl.b) };
  const first = after[0];
  res.jumpAtInput = { h: r2(hdist(camOf(before), camOf(first))), v: r2(first.alt - before.alt),
                      b: r2(wrap180(first.b - before.b)), dtMs: Math.round(first.t - before.t) };
  if (!home) {
    check('controller takes the camera on its next frames', take && res.takeover.flightFrames <= 2,
          take ? `${res.takeover.flightFrames} flight frames, ${Math.round(take.t - tIn)} ms` : 'controller never drove');
    check('no jump at the handover or after', take && worst.over <= 1,
          `worst ${worst.handover ? 'handover' : 'controller'} step +${Math.round(worst.t || 0)} ms: ` +
          `h ${r2(worst.h)} m (allow ${r2(worst.hAllow)}), v ${r2(worst.v)} m (allow ${r2(worst.vAllow)}), ` +
          `bearing ${r2(worst.b)} deg (allow ${r2(worst.bAllow)})`);
  }

  // The flight must not carry on underneath the user.
  const tTake = take ? take.t : tIn + 250;
  const easeAfter = F.filter(f => f.t > tTake && f.t <= endT && f.easing).length;
  if (!home) {
    check('flight does not resume', easeAfter === 0,
          `${easeAfter} eased frames after the controller took the camera` + (take ? '' : ' (controller never drove)'));
    if (spec.phase === 'veil' && reveal != null && tIn < reveal) {
      const flew = F.some(f => f.t > reveal && f.easing);
      check('flight does not depart after an input under the veil', !flew, flew ? 'departed' : 'stayed');
    }
  }
  const last = after[after.length - 1];
  const reach = hdist(camOf(ref), camOf(last));
  const reachAllow = vmax(Math.max(ref.alt, last.alt)) * (last.t - ref.t) / 1000 * 1.3 + 3 +
                     (snap || !take ? 0 : oneFlightFrame(base, take.t, legs).h);
  if (!home) check('eye stays within the controller\'s own reach', reach <= reachAllow,
                   `moved ${r2(reach)} m in ${((last.t - ref.t) / 1000).toFixed(2)} s from the takeover (allow ${r2(reachAllow)})`);

  // Did the input act, from the interrupted pose? `base` is the flight's last
  // drawn frame before the controller's first — the pose the user was looking
  // at when the takeover happened. Effects are measured from there, 300 ms
  // after the gesture's last event.
  const at = F.find(f => f.t >= tEndIn + 300 && f.t <= endT) || last;
  const mv = hdist(camOf(ref), camOf(at));
  const hd = heading(camOf(ref), camOf(at));
  const dB = wrap180(at.b - ref.b);
  const dAltPct = (at.alt / ref.alt - 1) * 100;
  res.effect = { movedM: r2(mv), headingDeg: r2(hd), bearingDeg: r2(ref.b), dBearing: r2(dB), dAltPct: r2(dAltPct) };
  if (spec.input === 'key-w' || spec.input === 'joystick' || spec.phase === 'reveal-exact' || spec.phase === 'boundary-exact') {
    check('moves forward along the bearing it was facing', mv > 3 && Math.abs(wrap180(hd - ref.b)) < 25,
          `moved ${r2(mv)} m heading ${r2(hd)} vs bearing ${r2(ref.b)}`);
  } else if (spec.input === 'key-arrow') {
    check('strafes left of the bearing it was facing', mv > 3 && Math.abs(wrap180(hd - (ref.b - 90))) < 25,
          `moved ${r2(mv)} m heading ${r2(hd)} vs bearing-90 ${r2(ref.b - 90)}`);
  } else if (spec.input === 'key-q') {
    check('climbs in place', dAltPct > 5 && mv < 5, `alt ${r2(dAltPct)}%, moved ${r2(mv)} m`);
  } else if (wheel) {
    check('wheel climbs in place', dAltPct > 20 && mv < 5, `alt ${r2(dAltPct)}%, moved ${r2(mv)} m`);
  } else if (look) {
    check('look turns in place', Math.abs(dB) > 5 && mv < 5, `bearing ${r2(dB)} deg, moved ${r2(mv)} m`);
  } else if (home) {
    const H = d.home;
    const lastF = F[F.length - 1];
    if (H) {
      const dh = hdist({ lng: lastF.lng, lat: lastF.lat }, { lng: H.center[0], lat: H.center[1] });
      check('R still returns to the spawn pose', dh < 1 && Math.abs(lastF.z - H.zoom) < 0.01 &&
            Math.abs(wrap180(lastF.b - H.bearing)) < 0.1, `centre off ${r2(dh)} m, z ${r2(lastF.z)} vs ${r2(H.zoom)}`);
    }
    // Once the home ease has landed, nothing may move the camera again (the
    // old leg-2 timer would have). Measured from the first frame AT home,
    // not a fixed delay: the 900 ms ease ends whenever a frame lands.
    if (H) {
      const atHome = f => hdist({ lng: f.lng, lat: f.lat }, { lng: H.center[0], lat: H.center[1] }) < 1 &&
                          Math.abs(f.z - H.zoom) < 0.01;
      const i0 = F.findIndex(f => f.t > tIn && atHome(f) && !f.easing);   // the home ease has landed
      const tail = i0 < 0 ? [] : F.slice(i0);
      const left = tail.filter(f => !atHome(f) || f.easing).length;
      check('flight does not resume after R', i0 >= 0 && left === 0,
            i0 < 0 ? 'never reached home' : `${left} frames off home after arriving (${tail.length} watched)`);
    }
  }
  // __fly agrees with the camera once the controller has it.
  const settled = [...after].reverse().find(f => f.fly);
  if (settled && settled.fly && !home) {
    const dFly = hdist({ lng: settled.fly.lng, lat: settled.fly.lat }, camOf(settled));
    check('__fly.eye() matches the camera', dFly < 2 && Math.abs(settled.fly.alt - settled.alt) < 2,
          `eye off ${r2(dFly)} m, alt ${r2(settled.fly.alt)} vs ${r2(settled.alt)}`);
  }
  if (d.intro && d.intro.flight) res.notes.push(`flight state ${d.intro.flight.state}` +
    (d.intro.flight.cancelledBy ? ` by ${d.intro.flight.cancelledBy}` : ''));
  const fovs = [before, ...after].map(f => f.fov).filter(v => v != null);
  if (fovs.length) res.fovRange = [r2(Math.min(...fovs)), r2(Math.max(...fovs))];
  check('no page errors', res.errors.length === 0, res.errors.join(' | ') || 'none');
  return res;
}

function printResult(r) {
  const bad = r.checks.filter(c => !c.ok);
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.id.padEnd(22)} ${r.landed || ''}` +
              (r.takeover ? `  takeover +${r.takeover.ms} ms/${r.takeover.flightFrames}f` : '') +
              (r.effect ? `  eff moved=${r.effect.movedM}m dB=${r.effect.dBearing} dAlt=${r.effect.dAltPct}%` : '') +
              (r.flightMaxStepM != null ? `  flight maxStep=${r.flightMaxStepM}m fps=${r.flightFps}` : '') +
              (r.intro && r.intro.reason ? `  veil=${r.intro.reason}@${Math.round(r.intro.waitedMs / 1000)}s` : ''));
  for (const c of bad) console.log(`        x ${c.name}: ${c.detail}`);
  for (const n of r.notes || []) console.log(`        - ${n}`);
}

// ── Plan ───────────────────────────────────────────────────────────────────
const specs = [];
for (const input of INPUTS)
  for (const phase of PHASES)
    specs.push({ id: `${input}@${phase}`, kind: 'input', input, phase, mobile: MOBILE_INPUTS.has(input) });
specs.push({ id: 'key-w@reveal-exact', kind: 'input', input: 'key-w', phase: 'reveal-exact' });
specs.push({ id: 'key-w@boundary-exact', kind: 'input', input: 'key-w', phase: 'boundary-exact' });
if (CONTROLS) {
  specs.push({ id: 'none', kind: 'none' });
  specs.push({ id: 'none-probe', kind: 'none', keepProbe: true });
  specs.push({ id: 'home', kind: 'home' });
  specs.push({ id: 'tour', kind: 'tour', query: '&tour=1' });
  specs.push({ id: 'autopilot', kind: 'tour', query: '&autopilot=1' });
}
const plan = specs.filter(s => !ONLY || ONLY.includes(s.id)).map(s => ({ ...s, record: RECORD.has(s.id) }));
// Desktop and phone cases alternate context types anyway; keep the order
// stable so two runs are comparable line by line.
// --reanalyse=<dir>: re-run the assertions over a previous --dump run's raw
// frame logs, no browser. Lets the checks be corrected without re-paying for
// ninety-second veils on a contended machine.
const REANALYSE = arg('reanalyse');
if (REANALYSE) {
  const files = fs.readdirSync(REANALYSE).filter(f => /^raw-.*\.json$/.test(f));
  let bad = 0;
  const out = [];
  for (const f of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(REANALYSE, f), 'utf8'));
    if (ONLY && !ONLY.includes(raw.spec.id)) continue;
    const r = analyse(raw.spec, raw.data, raw.fired, raw.phaseOk, raw.errors || []);
    printResult(r);
    out.push(r);
    if (!r.pass) bad++;
  }
  fs.writeFileSync(path.join(OUT, 'intro-interrupt.json'), JSON.stringify(out, null, 1));
  console.log(`
${out.length - bad}/${out.length} cases pass (reanalysed from ${REANALYSE})`);
  process.exit(bad && !REPORT ? 1 : 0);
}
console.log(`intro-interrupt: ${plan.length} cases against ${BASE}`);

// A browser killed from OUTSIDE (a reaper sweeping harness Chromes, a GPU
// reset) takes every remaining case with it. Relaunch and retry that case once
// instead of reporting forty "browser has been closed" failures.
const MAX_MS = Math.max(600000, plan.length * 120000);
let browser = await launch(chromium, { maxMs: MAX_MS });
const results = [];
for (const spec of plan) {
  const t0 = Date.now();
  let r;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try { r = await runCase(browser, spec); break; }
    catch (e) {
      r = { id: spec.id, pass: false, checks: [{ name: 'ran', ok: false, detail: String(e).split(String.fromCharCode(10))[0].slice(0, 300) }] };
      if (attempt === 1 && /has been closed|Target closed|crashed/i.test(String(e))) {
        console.log(`        - browser died under ${spec.id}; relaunching and retrying once`);
        try { browser.process()?.kill('SIGKILL'); } catch (err) {}
        browser = await launch(chromium, { maxMs: MAX_MS });
        continue;
      }
      break;
    }
  }
  r.wallS = Math.round((Date.now() - t0) / 1000);
  results.push(r);
  printResult(r);
  fs.writeFileSync(path.join(OUT, 'intro-interrupt.json'), JSON.stringify(results, null, 1));
}
const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} cases pass` +
            (failed.length ? `; FAILED: ${failed.map(r => r.id).join(', ')}` : ''));
await browser.__done();
process.exit(failed.length && !REPORT ? 1 : 0);
