/**
 * tower.js — PLACEHOLDER. Owned by the "The Tower" building pass: UT Tower + Main Building.
 *
 * This file is empty on purpose. index.html and _harness.html ALREADY load it, so the
 * pass that fills it in never has to touch either HTML file. Six building passes are
 * running in parallel and every one of them editing the same two <script> lists is a
 * guaranteed merge conflict — while the opposite failure is worse and already happened
 * here: js/roofs.js was perfect, was loaded by neither file, and its 12,058 features sat
 * dead in the repo for days. Pre-wiring the tag removes both failure modes at once.
 *
 * The brief: docs/PASS_COMMON.md, then block "The Tower" in docs/FIVE_BUILDING_PASSES.md.
 *
 * The contract this file must satisfy when it is written:
 *   - expose window.initTower(map) and window.applyTowerColors(map, p)
 *   - self-boot; app.js will not call you. Copy the boot() at the bottom of js/outer.js:
 *     poll for window.__map, wait for map.getLayer('buildings-3d') and for any facade
 *     quantiser you need, then run.
 *   - wrap window.applyTimeOfDay the way outer.js does, so your colours ride the
 *     day/golden/night ramp.
 *   - read data/tower.geojson, baked by scripts/bake_tower.py, which must declare
 *     replacedBuildingIds for every generic extrusion your geometry supersedes.
 */
(function () {
  'use strict';
  // Intentionally empty until the The Tower pass lands.
})();
