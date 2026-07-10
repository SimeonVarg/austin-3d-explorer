/**
 * controls.js — Flythrough navigation for Austin 3D Explorer
 *
 * Desktop: WASD / arrow keys to move, Q/E to go up/down, click+drag to look.
 * Mobile:  left joystick to move, single-finger swipe to look.
 *
 * Exposes one function: initControls(map)
 * Call after the map has loaded. Returns a cleanup function.
 */

function initControls(map) {
  // ── Config ────────────────────────────────────────────────────
  const MOVE_SPEED   = 0.0000004; // deg/ms base; scaled by zoom below. The old
                                  // value (0.00012) was ~300x too fast — a single
                                  // joystick nudge flung the camera km away.
  const SPRINT_MULT  = 3.5;      // held Shift multiplier
  const VERT_SPEED   = 1.2;      // altitude change m/s
  const LOOK_SENS_D  = 0.25;     // desktop drag degrees per px
  const LOOK_SENS_T  = 0.18;     // touch swipe degrees per px
  const MIN_PITCH    = 0;
  const MAX_PITCH    = 85;
  const MIN_ALT      = 15;       // metres above ground (approx via zoom)
  const MAX_ALT      = 800;

  // ── State ─────────────────────────────────────────────────────
  const keys = {};
  let dragActive = false;
  let lastDragX = 0, lastDragY = 0;
  let joystickDx = 0, joystickDy = 0; // -1..1 each axis
  let lastTs = null;
  let rafId = null;

  // ── Helpers ───────────────────────────────────────────────────
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function degToRad(d) { return d * Math.PI / 180; }

  /** Convert map zoom to approximate altitude in metres */
  function zoomToAlt(zoom) {
    return 40000000 / Math.pow(2, zoom + 8);
  }
  function altToZoom(alt) {
    return Math.log2(40000000 / alt) - 8;
  }

  // ── Keyboard ──────────────────────────────────────────────────
  function onKeyDown(e) {
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)) {
      e.preventDefault();
    }
    keys[e.key.toLowerCase()] = true;
  }
  function onKeyUp(e) {
    keys[e.key.toLowerCase()] = false;
  }

  // ── Desktop drag-to-look ──────────────────────────────────────
  function onMouseDown(e) {
    if (e.target !== map.getCanvas()) return;
    dragActive = true;
    lastDragX = e.clientX;
    lastDragY = e.clientY;
    map.getCanvas().style.cursor = 'grabbing';
    e.preventDefault();
  }
  function onMouseMove(e) {
    if (!dragActive) return;
    const dx = e.clientX - lastDragX;
    const dy = e.clientY - lastDragY;
    lastDragX = e.clientX;
    lastDragY = e.clientY;

    const bearing = map.getBearing() - dx * LOOK_SENS_D;
    const pitch   = clamp(map.getPitch() + dy * LOOK_SENS_D * 0.6, MIN_PITCH, MAX_PITCH);
    map.setBearing(bearing);
    map.setPitch(pitch);
  }
  function onMouseUp() {
    dragActive = false;
    map.getCanvas().style.cursor = 'crosshair';
  }

  // ── Touch look (right half of screen) ────────────────────────
  let lookTouchId = null;
  let lastTouchX = 0, lastTouchY = 0;

  function onTouchStart(e) {
    for (const t of e.changedTouches) {
      const rightHalf = t.clientX > window.innerWidth / 2;
      if (rightHalf && lookTouchId === null) {
        lookTouchId = t.identifier;
        lastTouchX = t.clientX;
        lastTouchY = t.clientY;
      }
    }
  }
  function onTouchMove(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === lookTouchId) {
        const dx = t.clientX - lastTouchX;
        const dy = t.clientY - lastTouchY;
        lastTouchX = t.clientX;
        lastTouchY = t.clientY;

        const bearing = map.getBearing() - dx * LOOK_SENS_T;
        const pitch   = clamp(map.getPitch() + dy * LOOK_SENS_T * 0.5, MIN_PITCH, MAX_PITCH);
        map.setBearing(bearing);
        map.setPitch(pitch);
      }
    }
  }
  function onTouchEnd(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === lookTouchId) lookTouchId = null;
    }
  }

  // ── Joystick ──────────────────────────────────────────────────
  const joystickBase = document.getElementById('joystick-base');
  const joystickKnob = document.getElementById('joystick-knob');
  const JOY_RADIUS   = 30;
  let joyTouchId = null;
  let joyOriginX = 0, joyOriginY = 0;

  if (joystickBase) {
    joystickBase.addEventListener('touchstart', (e) => {
      e.stopPropagation();
      if (joyTouchId !== null) return;
      const t = e.changedTouches[0];
      joyTouchId = t.identifier;
      const r = joystickBase.getBoundingClientRect();
      joyOriginX = r.left + r.width / 2;
      joyOriginY = r.top  + r.height / 2;
    }, { passive: true });

    joystickBase.addEventListener('touchmove', (e) => {
      e.stopPropagation();
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier !== joyTouchId) continue;
        const rawX = t.clientX - joyOriginX;
        const rawY = t.clientY - joyOriginY;
        const dist  = Math.sqrt(rawX * rawX + rawY * rawY);
        const capped = Math.min(dist, JOY_RADIUS);
        const angle  = Math.atan2(rawY, rawX);
        const kx = Math.cos(angle) * capped;
        const ky = Math.sin(angle) * capped;
        if (joystickKnob) joystickKnob.style.transform = `translate(${kx}px, ${ky}px)`;
        joystickDx =  kx / JOY_RADIUS;
        joystickDy = -ky / JOY_RADIUS;
      }
    }, { passive: false });

    const joyEnd = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === joyTouchId) {
          joyTouchId = null;
          joystickDx = 0; joystickDy = 0;
          if (joystickKnob) joystickKnob.style.transform = '';
        }
      }
    };
    joystickBase.addEventListener('touchend',    joyEnd, { passive: true });
    joystickBase.addEventListener('touchcancel', joyEnd, { passive: true });
  }

  // ── Animation loop ────────────────────────────────────────────
  function tick(ts) {
    rafId = requestAnimationFrame(tick);
    if (lastTs === null) { lastTs = ts; return; }
    const dt = Math.min(ts - lastTs, 64);
    lastTs = ts;

    const sprint     = keys['shift'] ? SPRINT_MULT : 1;
    const bearing    = map.getBearing();
    const bearingRad = degToRad(bearing);

    let fwd = 0, right = 0, vert = 0;

    if (keys['w'] || keys['arrowup'])    fwd   += 1;
    if (keys['s'] || keys['arrowdown'])  fwd   -= 1;
    if (keys['a'] || keys['arrowleft'])  right -= 1;
    if (keys['d'] || keys['arrowright']) right += 1;
    if (keys['q'] || keys['pageup'])     vert  += 1;
    if (keys['e'] || keys['pagedown'])   vert  -= 1;

    if (Math.abs(joystickDx) > 0.05 || Math.abs(joystickDy) > 0.05) {
      fwd   += joystickDy;
      right += joystickDx;
    }

    if (fwd !== 0 || right !== 0) {
      // Scale by zoom so movement covers a consistent fraction of the view at
      // any height (faster when zoomed out, finer when down among buildings).
      const zoomScale = Math.pow(2, 16 - map.getZoom());
      const speed  = MOVE_SPEED * dt * sprint * zoomScale;
      const center = map.getCenter();
      const dLon   =  fwd  * Math.sin(bearingRad) * speed + right * Math.cos(bearingRad) * speed;
      const dLat   =  fwd  * Math.cos(bearingRad) * speed - right * Math.sin(bearingRad) * speed;
      map.setCenter([center.lng + dLon, center.lat + dLat]);
    }

    if (vert !== 0) {
      const currentAlt = zoomToAlt(map.getZoom());
      const newAlt = clamp(currentAlt - vert * VERT_SPEED * dt * 0.05, MIN_ALT, MAX_ALT);
      map.setZoom(altToZoom(newAlt));
    }
  }

  // ── Bind events ───────────────────────────────────────────────
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup',   onKeyUp);

  const canvas = map.getCanvas();
  canvas.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup',   onMouseUp);
  canvas.style.cursor = 'crosshair';

  canvas.addEventListener('touchstart', onTouchStart, { passive: true });
  canvas.addEventListener('touchmove',  onTouchMove,  { passive: false });
  canvas.addEventListener('touchend',   onTouchEnd,   { passive: true });

  map.dragPan.disable();
  map.touchZoomRotate.disable();

  rafId = requestAnimationFrame(tick);

  return function cleanup() {
    cancelAnimationFrame(rafId);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup',   onKeyUp);
    canvas.removeEventListener('mousedown', onMouseDown);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup',   onMouseUp);
    canvas.removeEventListener('touchstart', onTouchStart);
    canvas.removeEventListener('touchmove',  onTouchMove);
    canvas.removeEventListener('touchend',   onTouchEnd);
  };
}
