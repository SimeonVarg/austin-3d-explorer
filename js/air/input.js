/**
 * input.js — keyboard, mouse and touch, reduced to one stick:
 *   { pitch: -1..1 (+ = climb), bank: -1..1 (+ = right), boost: 0|1, brake: 0|1 }
 *
 * Keyboard   A/D or left/right bank, W/up dive, S/down climb, Shift or Space boost, C or Ctrl brake.
 * Pointer    press and drag: the stick is how far you are from where you pressed (a virtual stick, so the
 *            same code is the mouse and a finger). Drag right = bank right, drag down = pull up (I flips it).
 *            Right button = boost, middle button = brake.
 * Touch      the BOOST / BRAKE buttons the UI draws (elements with data-hold="boost|brake").
 * Both are summed and clamped, so you can hold a key and a drag together.
 *
 * Restart (R), day/night (N), start (Enter/Space on the ready screen) and "invert" (I) go to callbacks.
 */
(function (root, factory) { root.AirInput = factory(root.AIR); })(typeof self !== 'undefined' ? self : this, function (AIR) {
  'use strict';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const STICK_PX = 95, DEAD = 0.06, EXPO = 1.35;

  function create(handlers) {
    handlers = handlers || {};
    const keys = new Set();
    const ptr = { id: null, ax: 0, ay: 0, x: 0, y: 0, btn: 0, mouse: false };
    let invert = false, holdBoost = false, holdBrake = false, boostBtn = false, brakeBtn = false;
    const off = [];
    const on = (el, ev, fn, o) => { el.addEventListener(ev, fn, o); off.push(() => el.removeEventListener(ev, fn, o)); };
    const shape = v => { const a = Math.abs(v); if (a < DEAD) return 0; return Math.sign(v) * Math.pow((a - DEAD) / (1 - DEAD), EXPO); };

    on(window, 'keydown', e => {
      if (e.metaKey || e.altKey) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (e.repeat && ['r', 'n', 'i', 'Enter'].includes(k)) return;
      if (k === 'r') { handlers.restart && handlers.restart(); return; }
      if (k === 'n') { handlers.night && handlers.night(); return; }
      if (k === 'i') { invert = !invert; handlers.invert && handlers.invert(invert); return; }
      if (k === 'h') { handlers.hud && handlers.hud(); return; }
      if (k === 'Enter' || (k === ' ' && handlers.isReady && handlers.isReady())) { handlers.start && handlers.start(); e.preventDefault(); return; }
      if (['w', 'a', 's', 'd', 'c', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Shift', 'Control'].includes(k)) { keys.add(k); e.preventDefault(); }
    });
    on(window, 'keyup', e => { const k = e.key.length === 1 ? e.key.toLowerCase() : e.key; keys.delete(k); });
    on(window, 'blur', () => { keys.clear(); ptr.id = null; holdBoost = holdBrake = false; });

    const target = () => document.getElementById('map') || document.body;
    on(target(), 'pointerdown', e => {
      if (e.target.closest && e.target.closest('#air-root .air-ui')) return;
      if (e.pointerType === 'mouse') {
        if (e.button === 2) { holdBoost = true; return; }
        if (e.button === 1) { holdBrake = true; e.preventDefault(); return; }
        if (e.button !== 0) return;
      }
      if (handlers.isReady && handlers.isReady() && handlers.start && handlers.tapStarts) handlers.start();
      ptr.id = e.pointerId; ptr.ax = ptr.x = e.clientX; ptr.ay = ptr.y = e.clientY; ptr.mouse = e.pointerType === 'mouse';
      try { target().setPointerCapture(e.pointerId); } catch (er) {}
    });
    on(target(), 'pointermove', e => { if (e.pointerId === ptr.id) { ptr.x = e.clientX; ptr.y = e.clientY; } });
    const up = e => { if (e.pointerId === ptr.id) ptr.id = null; if (e.button === 2) holdBoost = false; if (e.button === 1) holdBrake = false; };
    on(target(), 'pointerup', up); on(target(), 'pointercancel', up);
    on(window, 'contextmenu', e => { if (e.target.closest && e.target.closest('#map')) e.preventDefault(); });

    function bindHold(el, which) {
      const set = v => { if (which === 'boost') boostBtn = v; else brakeBtn = v; el.classList.toggle('on', v); };
      on(el, 'pointerdown', e => { set(true); e.preventDefault(); e.stopPropagation(); try { el.setPointerCapture(e.pointerId); } catch (er) {} });
      on(el, 'pointerup', () => set(false)); on(el, 'pointercancel', () => set(false)); on(el, 'lostpointercapture', () => set(false));
    }

    function read() {
      let bank = 0, pitch = 0;
      if (keys.has('a') || keys.has('ArrowLeft')) bank -= 1;
      if (keys.has('d') || keys.has('ArrowRight')) bank += 1;
      if (keys.has('w') || keys.has('ArrowUp')) pitch -= 1;
      if (keys.has('s') || keys.has('ArrowDown')) pitch += 1;
      if (ptr.id !== null) {
        bank += shape((ptr.x - ptr.ax) / STICK_PX);
        pitch += shape((ptr.y - ptr.ay) / STICK_PX) * (invert ? -1 : 1);
      }
      return { bank: clamp(bank, -1, 1), pitch: clamp(pitch, -1, 1),
               boost: (keys.has('Shift') || keys.has(' ') || holdBoost || boostBtn) ? 1 : 0,
               brake: (keys.has('c') || keys.has('Control') || holdBrake || brakeBtn) ? 1 : 0 };
    }
    return { read, bindHold, dispose() { off.forEach(f => f()); }, anchor: () => (ptr.id !== null ? { ax: ptr.ax, ay: ptr.ay, x: ptr.x, y: ptr.y } : null), isInverted: () => invert };
  }
  return { create };
});
