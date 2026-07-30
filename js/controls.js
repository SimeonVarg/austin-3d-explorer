/**
 * controls.js — FLYCAM, the flythrough camera for Austin 3D Explorer
 *
 * Desktop: WASD / arrows to move, drag to look, Q/E or the wheel for altitude,
 *          Shift to boost, R to return to the spawn view.
 * Mobile:  left joystick to move, swipe anywhere to look, two fingers or
 *          double-tap-and-drag for altitude.
 *
 * Exposes initControls(map, scene) and returns a cleanup function.
 *
 * ── The one structural rule ──────────────────────────────────────────────
 * THE CAMERA EYE IS THE STATE. MapLibre's center and zoom are OUTPUTS,
 * derived once per frame and written with a single map.jumpTo(). Nothing else
 * in this file calls setCenter/setZoom/setBearing/setPitch.
 *
 * That is not stylistic. The previous version steered `center` directly in
 * degrees, which made a whole family of defects expressible: longitude deltas
 * that ignored cos(latitude) (east/west ran 13% slow and diagonal headings
 * crabbed off course), an unnormalised input vector (W+D was 41% faster than
 * W), and a `zoomToAlt()` that actually returned Web-Mercator metres-per-pixel
 * — at the spawn zoom it reported 1.7 m when the camera was really 230 m up,
 * so the first tap of Q or E clamped to MIN_ALT and teleported the view from
 * zoom 16.5 to 13.35, with no way back on desktop. Steering the eye in metres
 * and deriving the map pose makes all of those unrepresentable rather than
 * patched.
 *
 * Projection note: MapLibre uses 512-px tiles. The 156543.03392 constant found
 * in most tutorials is the 256-px convention and yields exactly 2x the true
 * altitude. The closed forms below reproduce transform.getCameraAltitude()
 * exactly (verified: 230.4 m at zoom 16.5 / pitch 64 / 800 px canvas).
 *
 * Datum note: every height here assumes transform.elevation === 0, which holds
 * because app.js deliberately leaves terrain disabled. If terrain is ever
 * turned on, `alt` becomes sea-level while final_height stays above-ground; the
 * fix is a queryTerrainElevation term in exactly three places — the floor
 * comparison, the hard net, and the write path.
 */

function initControls(map, scene) {
  'use strict';

  const PI = Math.PI;
  const rad = d => d * PI / 180;
  const deg = r => r * 180 / PI;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const wrap360 = d => ((d % 360) + 360) % 360;

  // ── Projection ────────────────────────────────────────────────────
  const C = 40030228.884;                 // 2 * PI * 6371008.8
  const M_LAT = C / 360;                  // 111195.08 m per degree of latitude
  const mLon = lat => M_LAT * Math.cos(rad(lat));
  const fovDeg = () => (map.getVerticalFieldOfView ? map.getVerticalFieldOfView() : 58);
  const camPx = () => 0.5 * map.getCanvas().clientHeight / Math.tan(rad(fovDeg()) / 2);
  const mpp = (z, lat) => C * Math.cos(rad(lat)) / (512 * Math.pow(2, z));

  // ── Tuning ────────────────────────────────────────────────────────
  const ZOOM_MIN = 14.0;    // trees/shadows drop out below this
  const ZOOM_MAX = 21.5;    // under MapLibre's own maxZoom so our clamp binds first

  const SPEED_REF = 40, SPEED_EXP = 0.75, SPEED_MIN = 6, SPEED_MAX = 120;
  const SPRINT = 2.5;
  const TAU_ACCEL = 0.20, TAU_DECEL = 0.45, V_EPS = 0.05;

  const SENS_YAW_MOUSE = 0.20, SENS_PITCH_MOUSE = 0.13;
  const SENS_YAW_TOUCH = 0.18, SENS_PITCH_TOUCH = 0.11;
  const LOOK_DEADZONE = 0.4;
  const PITCH_MIN = 5, PITCH_MAX = 85;

  const ALT_MIN = 18, ALT_MAX = 900, ALT_SLACK = 30;
  const VERT_GAIN = 0.25;          // per second, multiplicative
  const WHEEL_GAIN = 0.0018;       // per px
  const PAN2_GAIN = 0.0022;        // per px
  const TAPDRAG_GAIN = 0.0055;     // per px

  // DT_BAIL exists to swallow tab-restore gaps, which are seconds long. It must
  // NOT double as a slow-frame guard: at 0.25 s it discarded every frame under
  // 4 fps outright, so a weak phone (or a headless render) went from choppy to
  // barely moving — measured 8.85 m/s against a 40 m/s target. DT_MAX bounds a
  // single integration step; the collision walk substeps so a long step still
  // cannot tunnel through a facade.
  const DT_MAX = 0.10, DT_BAIL = 1.0;

  const CELL = 6, R_CAM = 6, SKIN = 2.5, SKIN_V = 8, STEP_UP = 12, HARD_CLEAR = 4;
  const LIFT = 45, FALL = 25, TAU_FLOOR_UP = 0.25, TAU_FLOOR_DOWN = 0.80;
  const FLOOR_LOOKAHEAD = 0.5;
  const BRAKE_PROBES = [[0.9, 0.55], [0.5, 0.30], [0.25, 0.12]];
  const SAFE_ALT = 105;            // fail-safe while the height field is unbuilt

  const FENCE_PAD = 250, FENCE_SOFT = 250;

  const JOY_RADIUS = 34, JOY_DEAD = 0.12, JOY_EXPO = 1.6;

  // ── State — the camera eye is the truth ───────────────────────────
  const eye = { lng: 0, lat: 0 };
  let alt = 0, altUser = 0, altFloor = 0;
  const vel = { e: 0, n: 0 };
  let bearing = 0, pitch = 0;
  let pendingYaw = 0, pendingPitch = 0, wheelLogAcc = 0, touchLogAcc = 0;  // yaw/pitch in DEGREES
  let lastTs = null, rafId = null, wasDriving = false, simTime = 0;

  const keys = Object.create(null);
  const keyDown = code => !!keys[code];
  let sprintHeld = false;

  let ALT_REF = 230, HOME = null;

  // ── Height field ──────────────────────────────────────────────────
  // A dense max-roof grid. Footprints are RASTERISED, not bbox-stamped: a
  // bounding box over-covers a rotated footprint by up to ~13 m at the corners,
  // which would stop you short of exactly the facades you're trying to read.
  let grid = null, gx0 = 0, gy0 = 0, gnx = 0, gny = 0, gridBuilt = false;
  let fence = null;

  function buildHeightField(sc) {
    const feats = [];
    const push = (arr, key) => { for (const f of (arr || [])) {
      const h = f.properties && (f.properties[key]);
      if (h > 0 && f.geometry) feats.push([f.geometry, h]);
    } };
    if (sc) { push(sc.buildings && sc.buildings.features, 'final_height');
              push(sc.parts && sc.parts.features, 'h'); }
    if (!feats.length) { gridBuilt = false; grid = null; return false; }

    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    const rings = [];
    for (const [g, h] of feats) {
      const polys = g.type === 'Polygon' ? [g.coordinates]
                  : g.type === 'MultiPolygon' ? g.coordinates : [];
      for (const poly of polys) {
        const r = poly[0];
        if (!r || r.length < 4) continue;
        rings.push([r, h]);
        for (const p of r) {
          if (p[0] < minLng) minLng = p[0]; if (p[0] > maxLng) maxLng = p[0];
          if (p[1] < minLat) minLat = p[1]; if (p[1] > maxLat) maxLat = p[1];
        }
      }
    }
    if (!rings.length) { gridBuilt = false; return false; }

    const midLat = (minLat + maxLat) / 2;
    const mx = mLon(midLat), my = M_LAT;
    gx0 = minLng - CELL / mx; gy0 = minLat - CELL / my;
    gnx = Math.ceil(((maxLng - gx0) * mx) / CELL) + 2;
    gny = Math.ceil(((maxLat - gy0) * my) / CELL) + 2;
    grid = new Float32Array(gnx * gny);

    const cx = lng => (lng - gx0) * mx / CELL;
    const cy = lat => (lat - gy0) * my / CELL;
    const stamp = (i, j, h) => {
      if (i < 0 || j < 0 || i >= gnx || j >= gny) return;
      const k = j * gnx + i;
      if (grid[k] < h) grid[k] = h;
    };

    for (const [ring, h] of rings) {
      const xs = ring.map(p => cx(p[0])), ys = ring.map(p => cy(p[1]));
      let j0 = Math.floor(Math.min.apply(null, ys)), j1 = Math.ceil(Math.max.apply(null, ys));
      j0 = Math.max(0, j0); j1 = Math.min(gny - 1, j1);
      // (a) scanline fill through each cell-row centre
      for (let j = j0; j <= j1; j++) {
        const yc = j + 0.5, xsAt = [];
        for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
          const ya = ys[a], yb = ys[b];
          if ((ya > yc) === (yb > yc)) continue;
          xsAt.push(xs[a] + (yc - ya) / (yb - ya) * (xs[b] - xs[a]));
        }
        xsAt.sort((p, q) => p - q);
        for (let s = 0; s + 1 < xsAt.length; s += 2) {
          const i0 = Math.max(0, Math.floor(xsAt[s])), i1 = Math.min(gnx - 1, Math.ceil(xsAt[s + 1]));
          for (let i = i0; i <= i1; i++) stamp(i, j, h);
        }
      }
      // (b) edge walk at half-cell steps so slivers are never missed
      for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
        const dx = xs[a] - xs[b], dy = ys[a] - ys[b];
        const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) * 2));
        for (let s = 0; s <= steps; s++) {
          stamp(Math.floor(xs[b] + dx * s / steps), Math.floor(ys[b] + dy * s / steps), h);
        }
      }
    }

    const padLng = FENCE_PAD / mx, padLat = FENCE_PAD / my;
    fence = { w: minLng - padLng, s: minLat - padLat, e: maxLng + padLng, n: maxLat + padLat };
    gridBuilt = true;
    return true;
  }

  /** Max indexed roof height within r metres of a ground position. */
  function maxHeightIn(lng, lat, r) {
    if (!gridBuilt) return 0;
    const mx = mLon(lat), my = M_LAT;
    r = r == null ? R_CAM : r;
    const i0 = Math.floor((lng - r / mx - gx0) * mx / CELL);
    const i1 = Math.floor((lng + r / mx - gx0) * mx / CELL);
    const j0 = Math.floor((lat - r / my - gy0) * my / CELL);
    const j1 = Math.floor((lat + r / my - gy0) * my / CELL);
    let best = 0;
    for (let j = Math.max(0, j0); j <= Math.min(gny - 1, j1); j++) {
      const row = j * gnx;
      for (let i = Math.max(0, i0); i <= Math.min(gnx - 1, i1); i++) {
        const v = grid[row + i];
        if (v > best) best = v;
      }
    }
    return best;
  }

  // ── Derived bounds. These BLOCK input; they never move the camera. ──
  // The derived zoom falls as pitch rises (the point at screen centre really is
  // further away), so the zoom limits have to show up as limits on altitude and
  // pitch. Doing it the other way — nudging the camera toward a legal pose —
  // would mean the view moves without the user asking, which is the exact
  // failure this rewrite exists to remove.
  const dMax = () => camPx() * mpp(ZOOM_MIN, eye.lat);
  const altCeiling = () => Math.min(ALT_MAX, dMax() * Math.cos(rad(pitch)));
  const pitchCap = () => Math.min(PITCH_MAX, deg(Math.acos(clamp(alt / dMax(), 0, 1))));

  // ── Read/write the MapLibre pose ──────────────────────────────────
  function syncFromMap() {
    const c = map.getCenter();
    bearing = map.getBearing();
    pitch = clamp(map.getPitch(), PITCH_MIN, PITCH_MAX);
    const D = camPx() * mpp(map.getZoom(), c.lat);
    alt = D * Math.cos(rad(pitch));
    const lead = D * Math.sin(rad(pitch));
    eye.lat = c.lat - lead * Math.cos(rad(bearing)) / M_LAT;
    eye.lng = c.lng - lead * Math.sin(rad(bearing)) / mLon(eye.lat);
    altUser = alt; altFloor = 0;
    vel.e = 0; vel.n = 0;
    // NOTHING here may clear pendingYaw/pendingPitch/wheelLogAcc/touchLogAcc.
    // This runs on the not-driving -> driving transition, and that transition is
    // triggered BY those accumulators — clearing them here discards the very
    // input that woke the controller up. The wheel is the only input with no
    // accompanying held state (a drag has lookPointerId, a key has keys[code]),
    // so it lost 100% of its signal: from a resting camera every scroll notch
    // was eaten and altitude never moved. Drags lost their last sliver too.
    // Resetting inputs is clearInputs()'s job (blur / tab hide), not this one's.
  }

  let lastWrite = null;
  function writeToMap() {
    const lead = alt * Math.tan(rad(pitch));
    const cLat = eye.lat + lead * Math.cos(rad(bearing)) / M_LAT;
    const cLng = eye.lng + lead * Math.sin(rad(bearing)) / mLon(eye.lat);
    const D = alt / Math.cos(rad(pitch));
    const z = clamp(Math.log2(C * Math.cos(rad(cLat)) * camPx() / (512 * D)), ZOOM_MIN, ZOOM_MAX);
    if (lastWrite &&
        Math.abs(lastWrite.lng - cLng) < 1e-9 && Math.abs(lastWrite.lat - cLat) < 1e-9 &&
        Math.abs(lastWrite.z - z) < 1e-4 && Math.abs(lastWrite.b - bearing) < 1e-4 &&
        Math.abs(lastWrite.p - pitch) < 1e-4) return;
    lastWrite = { lng: cLng, lat: cLat, z, b: bearing, p: pitch };
    // eventData {fly:true} lets other modules ignore camera events we caused.
    map.jumpTo({ center: [cLng, cLat], zoom: z, bearing, pitch }, { fly: true });
  }

  // ── Collision ─────────────────────────────────────────────────────
  const blockedAt = (lng, lat) => maxHeightIn(lng, lat, R_CAM) + SKIN > alt;

  function speedBrake() {
    if (!gridBuilt) return 1;
    const sp = Math.hypot(vel.e, vel.n);
    if (sp < 1) return 1;
    for (const [t, cap] of BRAKE_PROBES) {
      const lng = eye.lng + (vel.e * t) / mLon(eye.lat);
      const lat = eye.lat + (vel.n * t) / M_LAT;
      if (maxHeightIn(lng, lat, R_CAM) + SKIN > alt) return cap;
    }
    return 1;
  }

  // ── Joystick ──────────────────────────────────────────────────────
  const joystickBase = document.getElementById('joystick-base');
  const joystickKnob = document.getElementById('joystick-knob');
  let joyPointerId = null, joyFwd = 0, joyStrafe = 0, joyOx = 0, joyOy = 0;
  const joyActive = () => joyPointerId !== null;

  function joySet(nx, ny) {
    const r = Math.hypot(nx, ny);
    if (r <= JOY_DEAD) { joyFwd = 0; joyStrafe = 0; return; }
    const c = Math.pow((r - JOY_DEAD) / (1 - JOY_DEAD), JOY_EXPO) / r;
    joyStrafe = nx * c; joyFwd = ny * c;
  }

  // ── Canvas pointers ───────────────────────────────────────────────
  // NEVER read TouchEvent.touches — it is document-wide, and that is the whole
  // reason the old build treated the joystick thumb as a pinch finger: with a
  // thumb on the stick, every look swipe was reinterpreted as a two-finger
  // zoom, so moving and looking at the same time was impossible. Here the
  // joystick captures its own pointer and the canvas tracks only its own, so
  // the two gestures cannot collide.
  const canvas = map.getCanvas();
  const canvasPointers = new Map();     // id -> {x, y}
  let lookPointerId = null;
  let pinchDist = null, pinchCx = 0, pinchCy = 0;
  let lastTapAt = 0, lastTapX = 0, lastTapY = 0;
  let tapDragId = null, tapDragY = 0;
  const TAP_MS = 280, TAP_PX = 24;

  const isTouchPointer = e => e.pointerType === 'touch' || e.pointerType === 'pen';

  function pointerCount() { return canvasPointers.size; }

  function rebasePinch() {
    const pts = [...canvasPointers.values()];
    if (pts.length >= 2) {
      pinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      pinchCx = (pts[0].x + pts[1].x) / 2; pinchCy = (pts[0].y + pts[1].y) / 2;
    } else {
      pinchDist = null;
    }
  }

  function onPointerDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    try { canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId); } catch (err) {}
    canvasPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    syncInputActive();
    e.preventDefault();

    if (pointerCount() >= 2) { lookPointerId = null; tapDragId = null; rebasePinch(); return; }

    // Double-tap-and-drag = altitude. Gated behind a completed double tap so a
    // plain look swipe can never trigger it. This is the one-thumb altitude
    // control: with a thumb on the stick there is no hand free for a pinch.
    const now = performance.now();
    if (isTouchPointer(e) && now - lastTapAt < TAP_MS &&
        Math.hypot(e.clientX - lastTapX, e.clientY - lastTapY) < TAP_PX) {
      tapDragId = e.pointerId; tapDragY = e.clientY; lookPointerId = null;
    } else {
      lookPointerId = e.pointerId;
    }
    lastTapAt = now; lastTapX = e.clientX; lastTapY = e.clientY;
    canvas.style.cursor = 'grabbing';
    markFlying();
  }

  function onPointerMove(e) {
    const p = canvasPointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;

    if (pointerCount() >= 2) {
      const pts = [...canvasPointers.values()];
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const cxNow = (pts[0].x + pts[1].x) / 2, cyNow = (pts[0].y + pts[1].y) / 2;
      if (pinchDist != null && d > 0) {
        touchLogAcc += Math.log(pinchDist / d);          // spread = descend
        touchLogAcc += -(cyNow - pinchCy) * PAN2_GAIN;   // two-finger drag up = climb
      }
      pinchDist = d; pinchCx = cxNow; pinchCy = cyNow;
      markFlying();
      return;
    }

    if (e.pointerId === tapDragId) {
      touchLogAcc += -dy * TAPDRAG_GAIN;
      markFlying();
      return;
    }

    if (e.pointerId !== lookPointerId) return;
    // Accumulate DEGREES, not pixels, so touch and mouse can carry different
    // sensitivities without the tick needing to know which device sent them.
    const touch = isTouchPointer(e);
    const mx = (!touch && e.movementX != null) ? e.movementX : dx;
    const my = (!touch && e.movementY != null) ? e.movementY : dy;
    if (Math.abs(mx) >= LOOK_DEADZONE) pendingYaw += mx * (touch ? SENS_YAW_TOUCH : SENS_YAW_MOUSE);
    if (Math.abs(my) >= LOOK_DEADZONE) pendingPitch += my * (touch ? SENS_PITCH_TOUCH : SENS_PITCH_MOUSE);
    markFlying();
  }

  function releasePointer(e) {
    canvasPointers.delete(e.pointerId);
    syncInputActive();
    try { canvas.releasePointerCapture && canvas.releasePointerCapture(e.pointerId); } catch (err) {}
    if (e.pointerId === tapDragId) tapDragId = null;
    if (e.pointerId === lookPointerId) lookPointerId = null;
    if (pointerCount() === 1) {
      // Promote the surviving finger to look instead of letting it go inert.
      const id = [...canvasPointers.keys()][0];
      lookPointerId = id; tapDragId = null; pinchDist = null;
    } else if (pointerCount() >= 2) {
      rebasePinch();
    } else {
      pinchDist = null; lookPointerId = null; tapDragId = null;
      canvas.style.cursor = 'crosshair';
    }
  }

  // ── Wheel = altitude ──────────────────────────────────────────────
  // The most common first instinct on a 3D map. scrollZoom is disabled, so
  // before this the wheel did nothing at all.
  function onWheel(e) {
    e.preventDefault();
    let px = e.deltaMode === 1 ? e.deltaY * 16
           : e.deltaMode === 2 ? e.deltaY * window.innerHeight
           : e.deltaY;
    px = clamp(px, -240, 240);
    wheelLogAcc += -px * WHEEL_GAIN;
    markFlying();
  }

  // ── Keyboard ──────────────────────────────────────────────────────
  // Indexed by e.code, not e.key: on macOS, Option+W reports '∑' on keydown and
  // 'w' on keyup, so a key-indexed map latches forever. e.code is 'KeyW' both
  // times. The same guard runs on keyup as on keydown — mirroring it is what
  // stops a key pressed on the canvas and released over a widget from sticking.
  const MOVE_CODES = ['KeyW','KeyS','KeyA','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight',
                      'KeyQ','KeyE','PageUp','PageDown'];
  function typingTarget(t) {
    return !!t && (/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(t.tagName) || t.isContentEditable);
  }
  function onKeyDown(e) {
    sprintHeld = e.shiftKey;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (typingTarget(e.target)) return;      // let the ToD slider and date picker work
    if (e.code === 'KeyR') { goHome(); e.preventDefault(); return; }
    if (MOVE_CODES.indexOf(e.code) === -1) return;
    keys[e.code] = true;
    e.preventDefault();
    markFlying();
  }
  function onKeyUp(e) {
    sprintHeld = e.shiftKey;
    if (typingTarget(e.target)) { keys[e.code] = false; return; }
    keys[e.code] = false;
  }

  function goHome() {
    if (!HOME) return;
    clearInputs();
    wasDriving = false;
    map.easeTo({ center: HOME.center, zoom: HOME.zoom, bearing: HOME.bearing, pitch: HOME.pitch,
                 duration: 900 }, { fly: true });
  }

  // ── Input reset ───────────────────────────────────────────────────
  // Without this, alt-tabbing while holding W never delivers the keyup and the
  // camera flies on forever; Ctrl+Shift+I strands Shift at a 2.5x boost.
  function clearInputs() {
    for (const k in keys) keys[k] = false;
    sprintHeld = false;
    joyFwd = 0; joyStrafe = 0; joyPointerId = null;
    if (joystickKnob) joystickKnob.style.transform = '';
    canvasPointers.clear();
    lookPointerId = null; tapDragId = null; pinchDist = null;
    pendingYaw = pendingPitch = wheelLogAcc = touchLogAcc = 0;
    vel.e = 0; vel.n = 0;
    lastTs = null;
    syncInputActive();
    canvas.style.cursor = 'crosshair';
  }
  const onBlur = () => clearInputs();
  const onVisibility = () => { if (document.hidden) clearInputs(); };

  // ── Chrome fade ───────────────────────────────────────────────────
  //
  // `.flying` has a deliberate 4-second idle tail so the hint always comes back,
  // and style.css used to hang `pointer-events:none` on the side panels off it.
  // That made the time-of-day slider dead for four seconds after every burst of
  // flying, with nothing to do but wait — the exact thing it felt like. The
  // protection is only needed while a finger is actually down (a right-thumb
  // look swipe must not drag the slider), so it now rides `.input-active`, which
  // is on for precisely the duration of the gesture.
  function syncInputActive() {
    const on = canvasPointers.size > 0 || joyPointerId !== null;
    document.body.classList.toggle('input-active', on);
  }

  let flyingSince = 0, flyingTimer = null;
  function markFlying() {
    flyingSince = flyingSince || performance.now();
    if (performance.now() - flyingSince > 200) document.body.classList.add('flying');
    clearTimeout(flyingTimer);
    flyingTimer = setTimeout(() => {
      document.body.classList.remove('flying');
      flyingSince = 0;
    }, 4000);
  }

  // ── Tick ──────────────────────────────────────────────────────────
  let tickMsAcc = 0, tickCount = 0;

  function tick(ts) {
    rafId = requestAnimationFrame(tick);
    if (lastTs === null) { lastTs = ts; return; }
    const dtRaw = (ts - lastTs) / 1000;
    lastTs = ts;
    if (dtRaw > DT_BAIL) return;                  // tab restore: never integrate a huge step
    const dt = Math.min(dtRaw, DT_MAX);
    const t0 = performance.now();
    simTime += dt;

    const sprint = sprintHeld ? SPRINT : 1;
    let fwd = 0, strafe = 0;
    if (keyDown('KeyW') || keyDown('ArrowUp'))    fwd += 1;
    if (keyDown('KeyS') || keyDown('ArrowDown'))  fwd -= 1;
    if (keyDown('KeyD') || keyDown('ArrowRight')) strafe += 1;
    if (keyDown('KeyA') || keyDown('ArrowLeft'))  strafe -= 1;
    fwd += joyFwd; strafe += joyStrafe;

    const vertKey = (keyDown('KeyQ') || keyDown('PageUp') ? 1 : 0) -
                    (keyDown('KeyE') || keyDown('PageDown') ? 1 : 0);

    // ── Arbitration. While nobody is flying we write NOTHING and simply read
    // the map, so the cinematic intro, the R reset and diff-tour's flyTo all
    // run to completion instead of being aborted by a per-frame jumpTo.
    //
    // The altitude test compares against the RESOLVED target, not against
    // altUser. Testing `altFloor > 0` instead would pin `driving` true forever
    // any time the camera rests over a rooftop — the floor is a standing
    // response, not an intent — and the controller would then own the camera
    // permanently and stomp on every external animation.
    const inputActive = fwd !== 0 || strafe !== 0 || vertKey !== 0 ||
                        lookPointerId !== null || tapDragId !== null || pointerCount() >= 2 ||
                        pendingYaw !== 0 || pendingPitch !== 0 ||
                        wheelLogAcc !== 0 || touchLogAcc !== 0;
    const resolvedAlt = clamp(Math.max(altUser, altFloor), ALT_MIN, altCeiling());
    const driving = inputActive ||
                    Math.hypot(vel.e, vel.n) > V_EPS ||
                    Math.abs(alt - resolvedAlt) > 0.05;

    if (!driving) { wasDriving = false; syncFromMap(); return; }
    if (!wasDriving) {
      if (map.isEasing && map.isEasing()) map.stop();
      syncFromMap();
      wasDriving = true;
    }

    // ── Look
    if (pendingYaw)   { bearing = wrap360(bearing - pendingYaw); pendingYaw = 0; }
    if (pendingPitch) { pitch = clamp(pitch + pendingPitch, PITCH_MIN, pitchCap()); pendingPitch = 0; }

    // ── Altitude intent (multiplicative: one key-second is always the same
    // proportional change, so it feels identical at 20 m and at 800 m)
    let L = vertKey * VERT_GAIN * dt * sprint;
    L += wheelLogAcc; wheelLogAcc = 0;
    L += touchLogAcc; touchLogAcc = 0;
    if (L) altUser *= Math.exp(L);
    // Don't let the user bank a low altitude while riding a rooftop and then
    // drop down a shaft the moment the roof ends.
    altUser = Math.max(altUser, alt - ALT_SLACK);
    // Only the ABSOLUTE limits touch the user's intent. altCeiling() varies with
    // pitch, so clamping intent against it would let one big pitch step (a fast
    // drag, or a slow frame that coalesces a whole gesture) permanently eat the
    // altitude you had asked for, and pitching back would not give it back.
    // The pitch-dependent ceiling is applied to the RENDERED altitude instead.
    altUser = clamp(altUser, ALT_MIN, ALT_MAX);

    // ── Horizontal intent. CLAMP the magnitude rather than normalise, so a
    // half-deflected joystick still means half speed while W+D no longer
    // means 1.41x speed.
    const m = Math.hypot(fwd, strafe);
    if (m > 1) { fwd /= m; strafe /= m; }
    const spd = clamp(SPEED_REF * Math.pow(alt / ALT_REF, SPEED_EXP), SPEED_MIN, SPEED_MAX) * sprint;
    const brake = speedBrake();
    const b = rad(bearing);
    const tE = (fwd * Math.sin(b) + strafe * Math.cos(b)) * spd * brake;
    const tN = (fwd * Math.cos(b) - strafe * Math.sin(b)) * spd * brake;
    const tau = Math.hypot(tE, tN) >= Math.hypot(vel.e, vel.n) ? TAU_ACCEL : TAU_DECEL;
    const k = 1 - Math.exp(-dt / tau);
    vel.e += (tE - vel.e) * k;
    vel.n += (tN - vel.n) * k;
    if (!fwd && !strafe && Math.hypot(vel.e, vel.n) < V_EPS) { vel.e = 0; vel.n = 0; }

    // ── Fence: ease to a stop near the edge of the data rather than letting
    // the user drift into empty basemap.
    if (fence) {
      const mx = mLon(eye.lat);
      const dW = (eye.lng - fence.w) * mx, dE = (fence.e - eye.lng) * mx;
      const dS = (eye.lat - fence.s) * M_LAT, dN = (fence.n - eye.lat) * M_LAT;
      if (vel.e < 0 && dW < FENCE_SOFT) vel.e *= clamp(dW / FENCE_SOFT, 0, 1);
      if (vel.e > 0 && dE < FENCE_SOFT) vel.e *= clamp(dE / FENCE_SOFT, 0, 1);
      if (vel.n < 0 && dS < FENCE_SOFT) vel.n *= clamp(dS / FENCE_SOFT, 0, 1);
      if (vel.n > 0 && dN < FENCE_SOFT) vel.n *= clamp(dN / FENCE_SOFT, 0, 1);
    }

    // ── Advance and collide. Metres in, degrees out — that single conversion
    // is the entire cos(latitude) fix.
    //
    // Substepped so no single frame can step further than the probe radius: at
    // SPEED_MAX with a 0.1 s frame the displacement is 12 m, twice R_CAM, which
    // would let the camera tunnel clean through a narrow building between two
    // samples.
    const frameDist = Math.hypot(vel.e, vel.n) * dt;
    const steps = Math.max(1, Math.ceil(frameDist / (R_CAM * 0.75)));
    const sdt = dt / steps;
    let stepFloor = 0;

    for (let s = 0; s < steps; s++) {
      const pLng = eye.lng + (vel.e * sdt) / mLon(eye.lat);
      const pLat = eye.lat + (vel.n * sdt) / M_LAT;

      // Block and slide. Exactly ONE axis is applied when blocked: applying
      // both independently-free axes would reconstruct the very diagonal that
      // was just rejected and stutter along 45-degree walls.
      if (!gridBuilt || !blockedAt(pLng, pLat)) {
        eye.lng = pLng; eye.lat = pLat;
      } else {
        const hObs = maxHeightIn(pLng, pLat, R_CAM);
        if (hObs + SKIN - alt <= STEP_UP) {          // low enough to skim over
          stepFloor = Math.max(stepFloor, hObs + SKIN_V);
          eye.lng = pLng; eye.lat = pLat;
        } else if (!blockedAt(pLng, eye.lat)) {
          eye.lng = pLng; vel.n = 0;
        } else if (!blockedAt(eye.lng, pLat)) {
          eye.lat = pLat; vel.e = 0;
        } else {
          vel.e = 0; vel.n = 0;
          break;
        }
      }
    }
    if (fence) {
      eye.lng = clamp(eye.lng, fence.w, fence.e);
      eye.lat = clamp(eye.lat, fence.s, fence.n);
    }

    // ── Rooftop floor
    if (gridBuilt) {
      const aLng = eye.lng + (vel.e * FLOOR_LOOKAHEAD) / mLon(eye.lat);
      const aLat = eye.lat + (vel.n * FLOOR_LOOKAHEAD) / M_LAT;
      const roof = Math.max(maxHeightIn(eye.lng, eye.lat, R_CAM), maxHeightIn(aLng, aLat, R_CAM));
      let want = roof > 0 ? roof + SKIN_V : 0;
      if (want - altUser > STEP_UP) want = 0;      // too tall to lift over; the slide already stopped us
      want = Math.max(want, stepFloor);
      const tf = want > altFloor ? TAU_FLOOR_UP : TAU_FLOOR_DOWN;
      const next = altFloor + (want - altFloor) * (1 - Math.exp(-dt / tf));
      altFloor += clamp(next - altFloor, -FALL * dt, LIFT * dt);
    } else {
      altFloor = SAFE_ALT;                          // fail safe, never fail open
    }

    alt = clamp(Math.max(altUser, altFloor), ALT_MIN, altCeiling());

    // ── Hard net: the guarantee rather than the feel. Fires essentially never.
    if (gridBuilt) {
      const h = maxHeightIn(eye.lng, eye.lat, R_CAM);
      if (h > 0 && alt < h + HARD_CLEAR) { alt = altUser = h + HARD_CLEAR; }
    }

    writeToMap();

    tickMsAcc += performance.now() - t0; tickCount++;
    if (window.__fly) {
      window.__fly.ticks = tickCount;
      window.__fly.tickMsAvg = tickMsAcc / tickCount;
    }
  }

  // ── Wiring ────────────────────────────────────────────────────────
  const prevHandlers = {};
  const HANDLERS = ['dragPan','dragRotate','doubleClickZoom','keyboard','touchPitch',
                    'touchZoomRotate','boxZoom','scrollZoom'];
  for (const h of HANDLERS) {
    if (map[h] && typeof map[h].isEnabled === 'function') {
      prevHandlers[h] = map[h].isEnabled();
      map[h].disable();
    }
  }

  map.getCanvasContainer().style.touchAction = 'none';
  canvas.style.touchAction = 'none';
  canvas.style.cursor = 'crosshair';
  document.body.style.overscrollBehavior = 'none';
  document.documentElement.classList.toggle('has-touch', navigator.maxTouchPoints > 0);

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', releasePointer);
  canvas.addEventListener('pointercancel', releasePointer);
  canvas.addEventListener('lostpointercapture', releasePointer);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  window.addEventListener('pageshow', onBlur);
  window.addEventListener('pagehide', onBlur);
  document.addEventListener('visibilitychange', onVisibility);

  // Joystick: Pointer Events with its own capture, so its finger never reaches
  // the canvas — and so it also works with a mouse, pen or trackpad (an iPad
  // with a Magic Keyboard, or any desktop window under 1025 px wide).
  function onJoyDown(e) {
    if (joyPointerId !== null) return;
    joyPointerId = e.pointerId;
    try { joystickBase.setPointerCapture && joystickBase.setPointerCapture(e.pointerId); } catch (err) {}
    const r = joystickBase.getBoundingClientRect();
    joyOx = r.left + r.width / 2; joyOy = r.top + r.height / 2;
    syncInputActive();
    e.preventDefault(); e.stopPropagation();
    markFlying();
  }
  function onJoyMove(e) {
    if (e.pointerId !== joyPointerId) return;
    const rx = e.clientX - joyOx, ry = e.clientY - joyOy;
    const dist = Math.hypot(rx, ry), capped = Math.min(dist, JOY_RADIUS);
    const ang = Math.atan2(ry, rx);
    const kx = Math.cos(ang) * capped, ky = Math.sin(ang) * capped;
    if (joystickKnob) joystickKnob.style.transform = `translate(${kx}px, ${ky}px)`;
    joySet(kx / JOY_RADIUS, -ky / JOY_RADIUS);
    e.preventDefault(); e.stopPropagation();
    markFlying();
  }
  function onJoyUp(e) {
    if (e.pointerId !== joyPointerId) return;
    joyPointerId = null; joyFwd = 0; joyStrafe = 0;
    syncInputActive();
    if (joystickKnob) joystickKnob.style.transform = '';
    try { joystickBase.releasePointerCapture && joystickBase.releasePointerCapture(e.pointerId); } catch (err) {}
  }
  if (joystickBase) {
    joystickBase.style.touchAction = 'none';
    joystickBase.addEventListener('pointerdown', onJoyDown);
    joystickBase.addEventListener('pointermove', onJoyMove);
    joystickBase.addEventListener('pointerup', onJoyUp);
    joystickBase.addEventListener('pointercancel', onJoyUp);
    joystickBase.addEventListener('lostpointercapture', onJoyUp);
  }

  // ── Init ──────────────────────────────────────────────────────────
  syncFromMap();
  ALT_REF = alt || 230;
  HOME = { center: [map.getCenter().lng, map.getCenter().lat], zoom: map.getZoom(),
           bearing: map.getBearing(), pitch: map.getPitch() };
  buildHeightField(scene);

  window.__flyRebuildCollision = sc => { buildHeightField(sc); };
  window.__fly = {
    // `driving` answers ONE question: did this file write the camera last frame.
    // It is not "is the camera moving" — while an external animation runs (the
    // cinematic intro, R-to-home, diff-tour's flyTo) the arbitration deliberately
    // stands aside and driving reads false while the pose changes anyway. Reading
    // driving===false as "nobody is steering" is how a 9-second intro tween got
    // reported as a bearing drift leaking out of this file. `mapEasing` is
    // published alongside it so that inference is never available again.
    eye: () => ({ lng: eye.lng, lat: eye.lat, alt, altUser, altFloor,
                  vE: vel.e, vN: vel.n, bearing, pitch, driving: wasDriving,
                  mapEasing: !!(map.isEasing && map.isEasing()),
                  mapMoving: !!(map.isMoving && map.isMoving()) }),
    roofAt: (lng, lat, r) => maxHeightIn(lng, lat, r == null ? R_CAM : r),
    indexed: () => gridBuilt,
    gridBytes: () => (grid ? grid.byteLength : 0),
    consts: { ALT_REF, ALT_MIN, ALT_MAX, ZOOM_MIN, ZOOM_MAX, R_CAM, HARD_CLEAR,
              SPEED_REF, SPEED_EXP, TAU_ACCEL, TAU_DECEL, VERT_GAIN, SPRINT },
    simTime: () => simTime,
    ticks: 0, tickMsAvg: 0,
  };

  rafId = requestAnimationFrame(tick);

  return function cleanup() {
    cancelAnimationFrame(rafId);
    clearTimeout(flyingTimer);
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', releasePointer);
    canvas.removeEventListener('pointercancel', releasePointer);
    canvas.removeEventListener('lostpointercapture', releasePointer);
    canvas.removeEventListener('wheel', onWheel);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('pageshow', onBlur);
    window.removeEventListener('pagehide', onBlur);
    document.removeEventListener('visibilitychange', onVisibility);
    if (joystickBase) {
      joystickBase.removeEventListener('pointerdown', onJoyDown);
      joystickBase.removeEventListener('pointermove', onJoyMove);
      joystickBase.removeEventListener('pointerup', onJoyUp);
      joystickBase.removeEventListener('pointercancel', onJoyUp);
      joystickBase.removeEventListener('lostpointercapture', onJoyUp);
    }
    for (const h of HANDLERS) {
      if (prevHandlers[h] && map[h] && typeof map[h].enable === 'function') map[h].enable();
    }
    delete window.__fly; delete window.__flyRebuildCollision;
  };
}
