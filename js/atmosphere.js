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
    const top = Math.max(0, f - 0.010) * 100;
    _el.style.opacity = '1';
    _el.style.top = top + '%';
    _el.style.height = Math.min(52, 26 + Math.max(0, -f) * 34) + '%';
    const a = m => rgba(_color, m * _strength);
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
    map.on('resize', render);
    render();
  };

  window.setHazeColor = function setHazeColor(color, strength) {
    _color = color || _color;
    _strength = strength == null ? 1 : strength;
    render();
  };
})();
