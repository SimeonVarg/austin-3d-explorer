/**
 * union24.js — Union on 24th, corrected from the utx-diorama hero build.
 *
 * WHY THIS FILE EXISTS
 * Union on 24th arrives from Overture as ONE ROTATED QUAD, 79.9 x 55.2 m, extruded
 * flat at 97.5 m in light grey (#babcbd, tagged confidence:"inferred" in
 * hero_designs.json). The real building is an H — two wings with a court cut clean
 * through the middle, open at BOTH ends — in dark bronze cladding with light boxed
 * window surrounds. From the air the missing court is the single most visible error
 * in West Campus: a 36 m slot rendered as solid mass.
 *
 * Height and display name are overridable via scripts/hero_overrides.json, and colour
 * via data/hero_designs.json, but FOOTPRINT IS NOT — it comes straight from the source
 * polygon in the bake. So this follows the capitol.js precedent instead: mutate the
 * feature in place at load, before quantiseFacades() assigns facade patterns.
 *
 * EVERY NUMBER HERE IS MEASURED, not assumed — see utx-diorama/docs/UNION24_AUDIT.md.
 * The envelope is derived FROM the facade module (the cell is square, MOD = FLOOR =
 * 3.26 m) rather than the module being derived from an assumed envelope. That inversion
 * is the whole lesson of that build: dividing an ASSUMED 57 m by a known column count
 * stretched every cell 9% and silently corrupted the massing for weeks.
 *
 * Public (window) API:
 *   applyUnion24(buildings)   — call BEFORE quantiseFacades(); returns true if applied
 */
(function () {
  'use strict';

  const U24 = {
    on: true,
    match: 'Union on 24th',

    // ── measured geometry ────────────────────────────────────────────────────
    // Origin is the SW corner of the source quad; the site's long axis runs
    // 95.2 deg (5.2 deg south of due east), read off that quad's own edges.
    origin: [-97.745691, 30.287421],
    MOD: 3.26,          // = FLOOR. The mod-4 facade cell is SQUARE (verified).
    envelope: 25.18,    // MOD. 7 + 11.18 + 7, self-consistent => 82.09 m E-W.
    depth: 16.0,        // MOD => 52.16 m N-S. This is the 16-column long face.
    wing: 7.0,          // MOD => 22.82 m. Simeon's 7-cap count, spec-frozen.
    southCourt: 5.0,    // MOD => 16.30 m deep notch
    northCourt: 6.0,    // MOD => 19.56 m deep notch
    parapet: 94.4,      // m. Measured; the baked 97.5 is the LiDAR high point.

    // ── measured palette ─────────────────────────────────────────────────────
    // The tower is NOT light grey. Cladding samples #2c2b30, light boxed window
    // surrounds #c9c8c4, glass #49544e. `wd` is the area-weighted average of those
    // across one cell (0.376 dark field + 0.384 light frame + 0.240 glass), because
    // this renderer gets ONE wall colour per building and the facade pattern is
    // generic — so the honest value is the distant read, not any one material.
    wd: '#6f7172',
    wg: '#7c7a74',      // golden hour: the light frames pick up warmth first
    wn: '#23262e',
    rd: '#8a8b8c',      // roof = L29 amenity deck + mechanical, mid grey
    rg: '#96907f',
    rn: '#161926',
  };

  function ptAt(u, v) {
    const BU = 95.2 * Math.PI / 180, BV = 5.2 * Math.PI / 180;
    const dx = Math.sin(BU) * u + Math.sin(BV) * v;
    const dy = Math.cos(BU) * u + Math.cos(BV) * v;
    return [U24.origin[0] + dx / 96000, U24.origin[1] + dy / 111000];
  }

  // The H, anticlockwise from the SW corner. The two notches are the courts —
  // they are OPEN at both ends, so this is one non-convex ring, not a ring with a
  // hole. fill-extrusion handles it directly.
  function hPlan() {
    const M = U24.MOD;
    const W = U24.envelope * M, D = U24.depth * M, wing = U24.wing * M;
    const sc = U24.southCourt * M, nc = D - U24.northCourt * M;
    const x0 = wing, x1 = W - wing;
    const r = [
      ptAt(0, 0), ptAt(x0, 0), ptAt(x0, sc), ptAt(x1, sc), ptAt(x1, 0), ptAt(W, 0),
      ptAt(W, D), ptAt(x1, D), ptAt(x1, nc), ptAt(x0, nc), ptAt(x0, D), ptAt(0, D),
    ];
    r.push(r[0]);
    return [r];
  }

  window.applyUnion24 = function applyUnion24(buildings) {
    if (!U24.on || !buildings || !buildings.length) return false;
    const f = buildings.find(b => b.properties && b.properties.name === U24.match);
    if (!f) { console.warn('[union24] feature not found — left as baked'); return false; }
    const p = f.properties;
    f.geometry = { type: 'Polygon', coordinates: hPlan() };
    p.final_height = U24.parapet;
    p.source_height = 'hero_override';   // shows purple in COLOR_DEBUG, as intended
    p.num_floors = 29;
    p.wd = U24.wd; p.wg = U24.wg; p.wn = U24.wn;
    p.rd = U24.rd; p.rg = U24.rg; p.rn = U24.rn;
    p.hero_detail = 'utx-diorama/workbench/js/union.js';
    console.log('[union24] H-plan applied: %d pts, %.1f m parapet', hPlan()[0].length - 1, U24.parapet);
    return true;
  };

  window.UNION24 = U24;
})();
