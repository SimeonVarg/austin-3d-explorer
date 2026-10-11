/**
 * budget.js — the "air" graphics budget: what the page does NOT draw because
 * nobody can read it from 100 m up at 60 to 100 m/s. Runs after js/graphics.js
 * (it owns the GFX object) and before js/app.js builds the map.
 *
 * Two kinds of saving, both measured in the pull request:
 *   1. MODULES NOT LOADED (air.html): name labels, shop signs, street props,
 *      sculpture, campus planting detail, door and place layers, the walk /
 *      live-here / finder features, the feedback box, analytics. Nothing to
 *      switch off: they never run, never download and never build.
 *   2. SWITCHES for what the loaded modules still do, below. Every line is a
 *      taste value (CLAUDE.md rule 11): `AIR_BUDGET` is on window so the owner
 *      can overrule any of it from the console before the map boots, or with
 *      `?airbudget=0` (the main page's own graphics) / `?airbudget=lite` (the
 *      phone and integrated-GPU step: render scale 0.75, fewer trees).
 *
 * The URL carries `preset=balanced` (air.html), and graphics.js never saves a
 * URL preset, so this page leaves the visitor's saved main-page settings alone.
 */
(function () {
  'use strict';
  const q = new URLSearchParams(location.search);
  const mode = q.get('airbudget') || 'on';          // on | lite | 0
  const AIR_BUDGET = window.AIR_BUDGET = {
    mode,
    // The shop-sign layer is not loaded; app.js still calls its init.
    stubs: ['initSigns', 'initProps', 'initArts', 'initPlaces', 'initEntrances'],
    // js/graphics.js overrides (the `balanced` preset, minus what costs and cannot be seen at speed)
    gfx: { bloom: 0, godRays: 0, flare: 0, autoExposure: false, grain: 0, dof: 0, ao: false },
    // `lite`: the integrated-GPU / phone step
    lite: { renderScale: 0.75, treeDensity: 0.45, outerDensity: 0.5 },
    // what the sim's own layer may draw
    layer: { windStreaks: true, haloes: true },
  };
  if (mode === '0') return;
  for (const name of AIR_BUDGET.stubs) if (typeof window[name] !== 'function') window[name] = function () {};
  const GFX = window.GFX;
  if (GFX) {
    Object.assign(GFX, AIR_BUDGET.gfx);
    if (mode === 'lite') Object.assign(GFX, AIR_BUDGET.lite);
    if (window.AIR) GFX.fov = window.AIR.camera.fovBase;
  }
  // bloom and auto-exposure meter the drawn frame, which needs preserveDrawingBuffer (a real cost): off for the air.
  window.GFX_PDB = false;
  // The graphics auto-detect probe may change the preset mid-race; the air budget is decided here, once.
  try { if (typeof window.cancelGraphicsAutoDetect === 'function') window.cancelGraphicsAutoDetect(); } catch (e) {}
})();
