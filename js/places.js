/**
 * places.js — PLACEHOLDER. Owned by the "Storefronts" pass.
 *
 * Empty on purpose: index.html and _harness.html already load it, so the pass
 * that fills it in never touches either HTML file. Four sessions are running in
 * parallel and all of them editing the same two <script> lists is a guaranteed
 * conflict — while the opposite failure is worse and already happened here:
 * js/roofs.js was finished, loaded by neither file, and its 12,058 features sat
 * dead in the repo for days.
 *
 * The brief: docs/PASS_COMMON.md, then block 3 of docs/FOUR_MORE_PASSES.md.
 *
 * The contract this file must satisfy when it is written:
 *   - expose window.initPlaces(map) and window.applyPlacesColors(map, p)
 *   - self-boot; app.js will not call you. Copy the boot() at the bottom of
 *     js/outer.js.
 *   - wrap window.applyTimeOfDay the way outer.js does, so a shopfront sign
 *     reads at night as well as at noon.
 *   - read data/places.geojson, baked by scripts/bake_places.py.
 *   - shopfronts are STACKED GEOMETRY, never a wall pattern: a pattern has no
 *     vertical anchor, so a ground floor painted into a tile repeats every
 *     ~40 m up the building.
 */
(function () {
  'use strict';
  // Intentionally empty until the Storefronts pass lands.
})();
