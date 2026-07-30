/**
 * night.js — night-only scene lighting beyond the windows (streetlights, glow).
 *
 * Owned by the night workstream. Wired from app.js as step('night') and driven
 * from timeofday.js via window.applyNightLayer(map, p) when it exists.
 *
 * Public (window) API:
 *   initNight(map)           — add sources/layers (safe to call once, after signs)
 *   applyNightLayer(map, p)  — retint/fade for time-of-day p (0 day … 1 night)
 */
(function () {
  'use strict';

  window.initNight = function initNight(map) {
    // Populated by the night workstream.
  };

  window.applyNightLayer = function applyNightLayer(map, p) {
    // Populated by the night workstream.
  };
})();
