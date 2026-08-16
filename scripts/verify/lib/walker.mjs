/**
 * lib/walker.mjs — the harness can walk now.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * Three passes wrote "QUEUE Y15 could not be measured" for the same reason:
 * every scripted walk ended at 23.8 m, the same digit every rep, and above
 * `TRUNK_ALT` (12 m) the trunk field switches off, so the walk measured a
 * subsystem that was not running. HANDOFF §132 read the constant as a "silent
 * lift" and parked it on `js/controls.js`.
 *
 * `walk-lift.mjs` traced it frame by frame and the app is innocent:
 *
 *     frame 0   alt 1.70   roofAt(eye, 1 m) = 8.6    roofAt(eye, 6 m) = 19.8
 *     frame 1   alt 12.60  = 8.6 + HARD_CLEAR(4)     <- hard net, 0 m travelled
 *     frame 3   alt 23.80  = 19.8 + HARD_CLEAR(4)    <- hard net again
 *
 * THE WALK PHASE STARTED INSIDE A BUILDING. The hard net (controls.js:1617)
 * ejected the camera on the first tick, before one metre was travelled, and it
 * did so TWICE because the ejection is a positive-feedback ladder: `rCam()`
 * lerps 1.0 -> 6.0 m as `groundMix()` falls to zero, so the moment the first
 * ejection carries the eye past `ALT_GROUND` the probe radius sextuples, sees a
 * taller roof, and the net fires again. 23.8 m is not a constant anything
 * resolves to — it is `roofAt(that exact start, 6 m) + HARD_CLEAR`, and it
 * repeats to the digit because the start pose is hard-coded and deterministic.
 *
 * So the harness never walked. It was ejected in the first second and then flew
 * 200 m over the rooftops with the trunk field switched off, and every summary
 * table read that as "the walk travelled 120 m".
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT THIS MODULE PROVIDES, and what it deliberately does not
 *
 * NO app code is changed and nothing is monkey-patched. The walker sends only
 * the events a person sends — a `keydown`/`keyup` pair for W (with the sprint
 * bit riding on the SAME event, because `sprintHeld = e.shiftKey`) and
 * `pointermove` for the look. `js/controls.js` arbitrates exactly as it does for
 * a user, and every guarantee it makes still holds.
 *
 * Two things fix the walk:
 *
 * 1. **START ON OPEN GROUND.** `findStart()` searches outward from a wanted
 *    point for one where `roofAt(p, CLEAR_R) === 0` and no trunk claims the
 *    cell. `CLEAR_R` defaults to 7 m, not `R_CAM`'s 6: the collision grid is
 *    quantised to `CELL = 6 m`, so a probe at exactly 6 can still be one cell
 *    short of what the net will see once the ladder starts. §105 already said
 *    this ("stand where `roofAt(p, 3 m) == 0`"); nothing enforced it.
 *
 * 2. **STEER.** A fixed bearing walks into the first building on that heading
 *    and stops — §132 measured 3 m and 11 m at two of its six sites. A person
 *    follows the street. Each frame (throttled) the walker probes the roof and
 *    trunk fields along candidate headings and turns toward the clearest one,
 *    applying the turn through the look input rather than by writing `bearing`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE PROOF OBLIGATION, and it is the whole point
 *
 * `walk()` reads `__fly.eye().alt` ON EVERY FRAME and returns the series. A
 * caller must judge the SERIES, never the endpoint: §105 has a worked example of
 * a summary table that read as a ladder and was a single correct ejection, and
 * §132's 23.8 m was an endpoint that hid a walk which never happened. The
 * returned `maxAlt` / `framesAboveCeiling` are there so a gate can refuse to
 * report a number for a walk that left the ground, the way `perf-budget.mjs`
 * refuses on `valid`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * USAGE (Playwright side)
 *
 *   import { installWalker } from './lib/walker.mjs';
 *   await page.evaluate(installWalker);
 *   const r = await page.evaluate(o => window.__walker.walk(o), { metres: 300 });
 *
 * Written by the Acer lane, 2026-08-16. Owns: this file only.
 */

/**
 * Page-side installer. Everything below runs IN THE BROWSER — no closure over
 * anything in Node (README: `page.addInitScript(fn)` runs `fn` in the PAGE, and
 * four "different" configurations once ran identically because of it).
 */
export function installWalker() {
  const C = 40030228.884, M_LAT = C / 360;
  const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
  const mLon = lat => M_LAT * Math.cos(rad(lat));

  // ── every taste/tuning value, named, so a caller can overrule any of them
  // in one line (CLAUDE.md rule 11) ─────────────────────────────────────────
  const DEF = {
    // start finding
    clearR: 7,          // roofAt() radius that must read 0 for a start to be legal
    searchR: 260,       // how far from the wanted point to look
    searchStep: 8,      // grid step of the search, metres
    // walking
    alt: 1.7,
    pitch: 85,
    sprint: true,
    metres: 300,
    seconds: 180,       // watchdog; a phase is a DISTANCE, this only bounds it
    ceiling: 12,        // TRUNK_ALT. Above this the walk is not a walk.
    // steering
    steer: true,
    steerEvery: 3,      // frames between steering probes (they cost wall time)
    lookAhead: 26,      // metres of clearance the walker wants in front of it
    probeStep: 2,       // sampling interval along a candidate heading
    probeR: 2.0,        // roofAt() radius used along a heading; > rCam(1.0) on purpose
    fan: [0, 12, -12, 25, -25, 40, -40, 60, -60, 80, -80, 110, -110, 145, -145, 180],
    maxTurnPerSec: 70,  // degrees; a person does not pivot instantly
    stuckSpeed: 0.15,   // m/s below which, with no clear heading, we call it blocked
    stuckFrames: 45,
    // THE INJECTED FAULT, for a caller that wants to watch its own gate fail.
    // Every `proveEvery` frames, call the APP's own `trunkScan()`/`outerScan()`
    // entry points, which zero the throttle and re-enter the real unbounded
    // query. It fabricates no number — the fault is "the 1.5 s throttle stopped
    // working" and the cost it exposes is the app's own. 0 = off.
    proveEvery: 0,
  };

  const F = () => window.__fly;
  const canvas = () => window.__map.getCanvas();

  const offset = (lng, lat, bearing, d) => ({
    lng: lng + Math.sin(rad(bearing)) * d / mLon(lat),
    lat: lat + Math.cos(rad(bearing)) * d / M_LAT,
  });

  /** First distance along `bearing` at which the way is blocked, capped at max. */
  function clearAhead(lng, lat, alt, bearing, max, step, r) {
    for (let d = step; d <= max; d += step) {
      const p = offset(lng, lat, bearing, d);
      if (F().roofAt(p.lng, p.lat, r) > 0) return d;
      try { if (F().trunkAt(p.lng, p.lat, alt)) return d; } catch (e) {}
    }
    return max;
  }

  /**
   * A start the hard net will not eject. Returns null rather than a bad start:
   * silently walking from a compromised pose is what produced 23.8 m three
   * times, and a caller that gets `null` writes "no legal start" instead of a
   * reassuring number.
   */
  function findStart(o = {}) {
    const O = { ...DEF, ...o };
    const legal = (lng, lat) => {
      if (F().roofAt(lng, lat, O.clearR) > 0) return false;
      try { if (F().trunkAt(lng, lat, O.alt)) return false; } catch (e) {}
      return true;
    };
    if (legal(O.lng, O.lat)) return { lng: O.lng, lat: O.lat, movedM: 0, tried: 1 };
    let tried = 1;
    // Rings outward, so the answer is the CLOSEST legal point to what was asked
    // for and a shots list stays roughly where its author meant it.
    for (let ring = O.searchStep; ring <= O.searchR; ring += O.searchStep) {
      const n = Math.max(8, Math.round(2 * Math.PI * ring / O.searchStep));
      for (let i = 0; i < n; i++) {
        const p = offset(O.lng, O.lat, (360 * i) / n, ring);
        tried++;
        if (legal(p.lng, p.lat)) return { lng: p.lng, lat: p.lat, movedM: ring, tried };
      }
    }
    return null;
  }

  const settle = async () => {
    for (let i = 0; i < 240; i++) {
      if (!F().eye().driving) return true;
      await new Promise(r => requestAnimationFrame(r));
    }
    return false;
  };

  /** Closed-form eye placement — the same one collision.mjs and perf-budget use. */
  function placeEye(lng, lat, alt, bearing, pitch) {
    const m = window.__map;
    const camPx = 0.5 * m.getCanvas().clientHeight / Math.tan(rad(58) / 2);
    const D = alt / Math.cos(rad(pitch));
    const lead = alt * Math.tan(rad(pitch));
    const cLat = lat + lead * Math.cos(rad(bearing)) / M_LAT;
    const cLng = lng + lead * Math.sin(rad(bearing)) / mLon(lat);
    const z = Math.log2(C * Math.cos(rad(cLat)) * camPx / (512 * D));
    m.jumpTo({ center: [cLng, cLat], zoom: z, bearing, pitch });
  }

  // ── input, and ONLY input ─────────────────────────────────────────────────
  // The sprint bit rides on the same event as the movement key. A separate
  // ShiftLeft keydown does nothing (`sprintHeld = e.shiftKey`) AND the KeyW that
  // follows clears the flag — measured at 0.7 m/s in perf-budget.mjs's history.
  const key = (code, down, shift) => window.dispatchEvent(
    new KeyboardEvent(down ? 'keydown' : 'keyup', { code, shiftKey: !!shift, bubbles: true }));

  // Look is a pointer DRAG on the canvas, which is what a mouse user does.
  // `onPointerMove` prefers `movementX` for a mouse pointer and it defaults to 0
  // in a synthetic event, so it is set explicitly; `clientX` is advanced too so
  // the fallback path agrees with it rather than fighting it.
  let pointerDown = false, px = 0, py = 0;
  function lookDown() {
    const cv = canvas(), r = cv.getBoundingClientRect();
    px = r.left + r.width / 2; py = r.top + r.height / 2;
    cv.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 7, pointerType: 'mouse', button: 0, buttons: 1,
      clientX: px, clientY: py, bubbles: true, cancelable: true }));
    pointerDown = true;
  }
  function lookUp() {
    if (!pointerDown) return;
    canvas().dispatchEvent(new PointerEvent('pointerup', {
      pointerId: 7, pointerType: 'mouse', button: 0, buttons: 0,
      clientX: px, clientY: py, bubbles: true }));
    pointerDown = false;
  }
  /** Yaw by `dDeg` (positive = turn right/clockwise, i.e. bearing increases). */
  function yaw(dDeg) {
    if (!dDeg) return;
    const SENS_YAW_MOUSE = 0.20;           // controls.js:71
    const LOOK_DEADZONE = 0.4;             // controls.js:73
    // bearing = wrap360(bearing - pendingYaw), pendingYaw += mx * SENS, so a
    // RIGHT turn needs a NEGATIVE mx.
    let mx = -dDeg / SENS_YAW_MOUSE;
    if (Math.abs(mx) < LOOK_DEADZONE) return;
    px += mx;
    canvas().dispatchEvent(new PointerEvent('pointermove', {
      pointerId: 7, pointerType: 'mouse', buttons: 1,
      clientX: px, clientY: py, movementX: mx, movementY: 0, bubbles: true }));
  }

  const wrap180 = d => ((d + 540) % 360) - 180;

  /**
   * Walk. Returns the whole altitude series — judge that, never the endpoint.
   */
  async function walk(o = {}) {
    const O = { ...DEF, ...o };
    const start = O.noFind ? { lng: O.lng, lat: O.lat, movedM: 0, tried: 0 } : findStart(O);
    if (!start) return { ok: false, why: 'no legal start within searchR', series: [] };

    await settle();
    placeEye(start.lng, start.lat, O.alt, O.bearing, O.pitch);
    await new Promise(r => requestAnimationFrame(r));
    await new Promise(r => requestAnimationFrame(r));
    await new Promise(r => setTimeout(r, O.settleMs == null ? 2500 : O.settleMs));

    const e0 = F().eye(), cosLat = Math.cos(rad(e0.lat));
    const covered = e => Math.hypot((e.lng - e0.lng) * M_LAT * cosLat, (e.lat - e0.lat) * M_LAT);

    const t0 = performance.now();
    const series = [];
    // TWO distances, and the difference matters. `m` is DISPLACEMENT from the
    // start; `path` is how far the walker actually walked. A steered walk that
    // turns a corner has a displacement well under its path length, and the
    // rescan triggers this suite cares about (TRUNK_RESCAN_M, OUTER_RESCAN_M)
    // fire on movement, not on displacement. Reporting only displacement would
    // under-report a real walk exactly the way the endpoint over-reported the
    // old one.
    let path = 0, pLng = null, pLat = null;
    const sample = () => {
      const e = F().eye(), c = F().consts();
      if (pLng !== null) {
        path += Math.hypot((e.lng - pLng) * mLon(e.lat), (e.lat - pLat) * M_LAT);
      }
      pLng = e.lng; pLat = e.lat;
      const r = { t: +((performance.now() - t0) / 1000).toFixed(2),
                  m: +covered(e).toFixed(1), path: +path.toFixed(1),
                  alt: +e.alt.toFixed(3),
                  altUser: +e.altUser.toFixed(3), altFloor: +e.altFloor.toFixed(3),
                  sp: +Math.hypot(e.vE, e.vN).toFixed(2), bearing: +e.bearing.toFixed(1),
                  roof: +F().roofAt(e.lng, e.lat, c.rCam).toFixed(2),
                  lng: e.lng, lat: e.lat };
      series.push(r);
      return r;
    };

    sample();
    // THE BASELINE IS TAKEN HERE, not by the caller before `walk()` is called.
    // Placing the eye triggers the field's first full build for that position,
    // and that scan belongs to the BOOT, not to the walk. A caller that
    // snapshots before `walk()` charges a ~1.5 s full build to the walk and
    // reports it as a worst-case incremental scan — which is precisely the
    // reassuring-wrong-number failure this suite exists to prevent.
    // `perf-budget.mjs` learned this the same way; the mark is inside the
    // walker now so no caller can get it wrong.
    const mark = () => ({ t: performance.now(), ticks: F().ticks, tickAvg: F().tickMsAvg,
                          trunk: F().trunkField(), outer: F().outerField() });
    const pre = mark();
    if (O.steer) lookDown();
    key('KeyW', true, O.sprint);

    const cap = O.seconds * 1000;
    let frames = 0, slow = 0, blocked = false, lastT = performance.now();
    let turns = 0, probes = 0, forced = 0;
    // The phase is a DISTANCE WALKED, with wall time only as a watchdog — §132's
    // first draft used a fixed duration and a 24 s walk travelled one metre.
    while (series[series.length - 1].path < O.metres && performance.now() - t0 < cap) {
      await new Promise(r => requestAnimationFrame(r));
      frames++;
      const now = performance.now(), dt = Math.min(0.25, (now - lastT) / 1000);
      lastT = now;
      const r = sample();

      if (O.proveEvery && frames % O.proveEvery === 0) {
        try { F().trunkScan(); } catch (e) {}
        try { F().outerScan(); } catch (e) {}
        forced++;
      }

      if (O.steer && frames % O.steerEvery === 0) {
        const e = F().eye();
        probes++;
        // Cheap first: if the way ahead is clear for the whole look-ahead there
        // is nothing to decide, and the fan is not paid for.
        const straight = clearAhead(e.lng, e.lat, e.alt, e.bearing, O.lookAhead, O.probeStep, O.probeR);
        if (straight < O.lookAhead) {
          let best = { d: straight, turn: 0 };
          for (const t of O.fan) {
            if (t === 0) continue;
            const d = clearAhead(e.lng, e.lat, e.alt, e.bearing + t, O.lookAhead, O.probeStep, O.probeR);
            // Strictly better, so a tie keeps the straighter heading and the
            // walker does not oscillate between two equal openings.
            if (d > best.d + 0.01) best = { d, turn: t };
          }
          if (best.turn) {
            const lim = O.maxTurnPerSec * dt;
            yaw(Math.max(-lim, Math.min(lim, wrap180(best.turn))));
            turns++;
          }
          blocked = best.d <= O.probeStep;
        } else blocked = false;
      }

      if (r.sp < O.stuckSpeed && blocked) { if (++slow >= O.stuckFrames) break; }
      else slow = 0;
    }

    key('KeyW', false, false);
    lookUp();
    const post = mark();

    const alts = series.map(r => r.alt);
    const above = series.filter(r => r.alt >= O.ceiling).length;
    const last = series[series.length - 1];
    return {
      ok: true,
      start, frames, probes, turns, forced,
      wallS: +((performance.now() - t0) / 1000).toFixed(2),
      metres: +last.path.toFixed(1),        // WALKED
      displacement: +last.m.toFixed(1),     // straight-line from the start
      series,
      minAlt: +Math.min(...alts).toFixed(3),
      maxAlt: +Math.max(...alts).toFixed(3),
      endAlt: last.alt,
      framesAboveCeiling: above,
      // The one number a gate should read. `true` only if EVERY frame stayed
      // under the ceiling — an endpoint at 1.7 m proves nothing about the
      // 90 frames in between.
      stayedDown: above === 0,
      stoppedEarly: last.path < O.metres,
      blocked,
      // Counters at the instant W went down and the instant it came up, so a
      // caller can difference the phase's own contribution and never has to
      // decide where the boundary is.
      pre, post,
      phaseS: +((post.t - pre.t) / 1000).toFixed(2),
      opts: { alt: O.alt, pitch: O.pitch, sprint: O.sprint, metres: O.metres,
              ceiling: O.ceiling, steer: O.steer, clearR: O.clearR,
              lookAhead: O.lookAhead, fan: O.fan.length, steerEvery: O.steerEvery },
    };
  }

  window.__walker = { walk, findStart, placeEye, settle, clearAhead, key, yaw, DEF };
  return true;
}
