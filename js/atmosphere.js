/**
 * atmosphere.js — horizon haze band for Austin 3D Explorer
 *
 * The data stops at the bbox edge, so from any flying pitch the city ends in a
 * hard line with an empty basemap plain running to the horizon behind it. The
 * obvious fix — MapLibre v5's `setSky` fog — does not work: sweeping
 * `fog-ground-blend` from 0 to 1 leaves every ground and building pixel
 * bit-identical (measured). That fog only paints the sky dome; it never touches
 * the scene.
 *
 * So the haze is a DOM band instead, tracking the horizon line as the camera
 * pitches. It fades the far ground into the horizon colour, which buries the
 * seam and — the actual point — gives the scene aerial perspective, the depth
 * cue a flat-lit extrusion city has no other way to earn.
 *
 * Public (window) API:
 *   initAtmosphere(map)             — create the band + follow the camera
 *   setHazeColor(colorHex, strength)— retint for the current time of day
 */
(function () {
  'use strict';

  let _el = null, _map = null, _color = '#c4dced', _strength = 1;

  // ── Taste block ─────────────────────────────────────────────────────
  // Haze is a layer of air sitting ON the ground, and the band has to behave
  // like one. It did not: horizonFraction() below is a function of pitch and
  // FOV ONLY, so climbing 400 m changed the band by exactly nothing. Rotating
  // the camera moves pitch as well as bearing, which is why it looked like the
  // band "only reacts when you rotate".
  //
  // The visible symptom was worse than a static band, because this is the one
  // overlay in the sky stack with no blend mode — it genuinely paints over
  // geometry. Flying up over Austin left a fat opaque bar sawn straight through
  // the middle of the downtown towers and holding still while you climbed.
  //
  // Fly above a haze layer and you look DOWN through it: it compresses toward
  // the horizon and thins out. Modelled with a scale height, the standard way
  // aerosol density falls off with altitude.
  const HAZE = {
    scaleHeightM: 850,   // e-folding height of the aerosol layer
    heightFloor: 0.30,   // band never shrinks below this fraction of its ground size
    strengthFloor: 0.22, // ... nor fades below this, so the seam stays covered
  };

  /** 1 at ground level, falling toward 0 as the camera climbs out of the haze. */
  function altitudeFactor() {
    let alt = null;
    try { alt = window.__fly && window.__fly.eye().alt; } catch (e) {}
    if (!isFinite(alt)) {
      // No flight controller (a bare map, or a test harness): fall back to the
      // camera altitude MapLibre derives from zoom and pitch.
      try { alt = _map.transform.cameraToCenterDistance / _map.transform.pixelsPerMeter; } catch (e) {}
    }
    if (!isFinite(alt) || alt <= 0) return 1;
    return Math.exp(-alt / HAZE.scaleHeightM);
  }

  /**
   * Screen position of the horizon, as a fraction from the top of the canvas.
   * MapLibre pitch is measured from straight-down, so the horizon sits
   * (90 - pitch)° above the optical axis; compare that against the half-FOV to
   * get its offset from centre.
   */
  function horizonFraction() {
    const t = _map.transform;
    if (t && typeof t.horizonLineFromTop === 'function') {
      const px = t.horizonLineFromTop();
      if (isFinite(px)) return px / _map.getCanvas().clientHeight;
    }
    const pitch = _map.getPitch();
    const fov = (typeof _map.getVerticalFieldOfView === 'function' ? _map.getVerticalFieldOfView() : 36.87);
    const rad = d => d * Math.PI / 180;
    const off = Math.tan(rad(90 - pitch)) / Math.tan(rad(fov / 2));
    return 0.5 - 0.5 * off;
  }

  function render() {
    if (!_el || !_map) return;
    const f = horizonFraction();
    // Below ~0 the horizon is off-screen (looking down); no haze to draw.
    if (!isFinite(f) || f < -0.15 || _strength <= 0.001) { _el.style.opacity = '0'; return; }
    // This band is the ONE layer in the whole sky stack with no blend mode — it
    // is plain alpha above #sky, so unlike every screen-blended overlay it
    // genuinely paints over geometry. That makes its aim critical, and it was
    // wrong: measured at pitch 64 / H=800, the horizon sits at y=48 px while the
    // old 13% stop peaked at y=61 — THIRTEEN PIXELS BELOW IT — laying 0.87 alpha
    // just under the horizon and still 0.48 at y=130, exactly where mid-distance
    // rooflines and tower flanks live. That, not the sun bloom, was most of what
    // made golden hour lose the mid-distance city.
    //
    // Re-aimed to hug the horizon: it now touches only ~8 px of the 48 px of
    // visible sky (was 20), drops mid-distance alpha by ~70%, and still fully
    // covers the seam just below the horizon, which is its actual job.
    // Altitude collapses the band toward the horizon and fades it. Without this
    // the bar cut the downtown towers in half and stayed put as you climbed.
    const k = altitudeFactor();
    const hMul = HAZE.heightFloor + (1 - HAZE.heightFloor) * k;
    const sMul = HAZE.strengthFloor + (1 - HAZE.strengthFloor) * k;
    const top = Math.max(0, f - 0.010) * 100;
    _el.style.opacity = '1';
    _el.style.top = top + '%';
    _el.style.height = Math.min(52, 26 + Math.max(0, -f) * 34) * hMul + '%';
    const a = m => rgba(_color, m * _strength * sMul);
    _el.style.background =
      `linear-gradient(to bottom, ${rgba(_color, 0)} 0%, ${a(0.58)} 6%, ` +
      `${a(0.30)} 20%, ${a(0.16)} 42%, ${a(0.06)} 70%, ${rgba(_color, 0)} 100%)`;
  }

  function rgba(hex, a) {
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16);
    return `rgba(${r},${g},${b},${a.toFixed(3)})`;
  }

  window.initAtmosphere = function initAtmosphere(map) {
    _map = map;
    _el = document.getElementById('haze');
    if (!_el) return;
    map.on('move', render);
    map.on('pitch', render);
    map.on('zoom', render);      // altitude now changes the band, so watch it
    map.on('resize', render);
    // The flight controller can drive altitude by writing the transform without
    // emitting a map event, which would leave the band stale exactly while you
    // are climbing. A cheap per-frame re-aim costs two style writes.
    map.on('render', render);
    render();
  };

  window.setHazeColor = function setHazeColor(color, strength) {
    _color = color || _color;
    _strength = strength == null ? 1 : strength;
    render();
  };
})();
