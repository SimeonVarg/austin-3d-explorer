/**
 * slopes-apartments.js — apartment buildings as real geometry, from sources.
 *
 * The fourth generator in the slopes layer (js/slopes.js header; the other
 * three are the roofs, the arches and the dome). Each building it draws is a
 * data file, data/apartments/<slug>.json, authored by hand from photographs,
 * the architect's page and the nadir — every number in it carries its source
 * — and this file is the one generator that turns any such file into a mesh.
 * The schema is documented in docs/apartments.md; the first building is The
 * Standard at Austin (data/apartments/the-standard.json).
 *
 * WHY A MESH AND NOT THE FILL-EXTRUSION BANDS js/westcampus.js DRAWS. A
 * fill-extrusion can only pull a footprint straight up in one colour per
 * band, and the facade atlas can only paint a repeating window grid on it.
 * The Standard is two towers on a podium with two light wells, a pool deck
 * in the saddle, a broken "pixel" panel field, projecting balconies with
 * rails, a charcoal corner bay that oversails the parapet with the name on
 * it, and a storefront ground floor. None of that is a band. Here every
 * panel, window reveal, balcony slab and rail is its own triangles, lit by
 * MapLibre's own formula through slopes.material(), so it sits beside the
 * fill-extrusion city as one look.
 *
 * WHY NO TEXTURES. The brief allowed a canvas-texture path in the shared
 * shader (utx-diorama's union.js does its brick and rib textures that way).
 * Measured against the cameras this app is judged from — the oblique at
 * ~0.3 m/px and the walking height at ~0.05 m/px — every feature the
 * photographs show is at least 0.5 m on its short side: a 2.2 x 0.56 m
 * panel, a 0.9 m window, a 0.6 m rust strip, a 0.16 m sign dot. All of it
 * is legible as GEOMETRY at those cameras, and geometry needs no plumbing
 * change to slopes.js, no second material, no mipmap policy and no
 * texture-vs-vertex-colour seam at the edge of a building. The one thing a
 * texture would add — brick coursing at 7 cm — is under a pixel at every
 * camera in this app. So: quads.
 *
 * HOW A FACE IS DRAWN (the cell tiler, `tileFace`). A face is a rectangle
 * in (s, z) — s along the wall, z up. Its skin gives a row rhythm (panel
 * courses or floors), a column rhythm (plank joints, bays, mullions), a tone
 * for every cell, and a list of windows. The tiler cuts the face into cells
 * at every row line, column line and window edge, and emits ONE quad per
 * cell: a window cell sits `reveal` metres behind the wall plane with four
 * reveal strips joining it to the plane; every other cell is a panel of its
 * own colour on the plane. Nothing overlaps anything, so nothing z-fights,
 * and the face is exactly as many triangles as it has cells.
 *
 * THE FRAME. Every building is authored in metres in its own oriented
 * bounding box — the same `obbOf` js/westcampus.js uses, ported here so a
 * (u, v) read off the rectified nadir in that file means the same thing in
 * this one. +u runs along the long axis, +v across it; the generator logs
 * L, W and the compass bearing of +u at boot so a builder can check which
 * end is which. A block's plan is either the footprint ring itself (the
 * podium) or a rectangle [u0, u1, v0, v1] on it (a tower, the corner bay).
 *
 * Switch: ?apartments=0 at load, or window.APARTMENTS.on = false at
 * runtime, both of which put the flat prism and the westcampus bands back
 * by restoring the filters this file changed. Everything else in the taste
 * block below is a look, not a measurement.
 *
 * Public (window) API:
 *   APARTMENTS                — the taste block; .on is the switch
 *   slopesApartments          — { count, group, data, filtered, rebuild() }
 *   applySlopesApartments(map) — re-read APARTMENTS / SLOPES and rebuild
 */
(function () {
  'use strict';

  const q = new URLSearchParams(window.location.search);

  // ══════════════════════════════════════════════════════════════════════
  //  TASTE BLOCK — CLAUDE.md rule 11. Every value here is a choice, not a
  //  measurement; measurements live in the building's JSON with their source.
  // ══════════════════════════════════════════════════════════════════════
  const APTS = {
    on: q.get('apartments') !== '0',
    index: 'data/apartments/index.json',
    // The tier of the fill-extrusion layer this stands in for: buildings-3d
    // has no LOD tier (js/lod.js tiers only roofs-pitched and the Capitol
    // discs) and minzoom 14 like every sibling layer in js/app.js.
    lod: null,
    minzoom: 14,
    // Geometry density per graphics preset (0..1) — the sign dots and the
    // window reveals go first when it drops; the massing never does.
    byPreset: { performance: 0.5, balanced: 1.0, cinematic: 1.0, ultra: 1.0 },
    balconies: true,      // draw balcony slabs and rails (false: flush walls)
    signs: true,          // draw the dot-matrix name signs
    deck: true,           // draw the podium roof deck's pool, turf, screen, rail
    reveals: true,        // draw the four strips that join a window to the wall plane
    reveal: 0.12,         // m a window pane sits behind the wall plane (0 = flush)
    // Night: the share of windows that are lit after dark, by a fixed hash so
    // it never flickers, and the tone they take. The rest go the glass's own
    // night colour. 0.45 is the share the West Campus facade atlas draws.
    nightLit: 0.45,
    nightLitTone: '#d9b46a',
    // Sign lettering: a 5x7 dot font, one quad per dot, standing this far
    // proud of the wall. The dot is the letter's stroke width.
    signDot: 0.18,
    signProud: 0.06,
    // Parapets: a thin wall standing on every roof edge, this thick.
    parapetT: 0.25,
    // A band whose z0 sits between two floor lines still gets the windows of
    // the storey it starts in, when it starts within this of that storey's
    // floor line (the window is clipped to the band). Further up than this
    // the storey is dropped, and either way the boot log says so. Balconies
    // never take the floor below a band: a slab inside the band beneath is
    // worse than a missing one.
    floorSlack: 1.0,
    // What is hidden while a building draws, beyond its own prism and bands:
    //   roofscape — js/roofs.js's deck plates, penthouses and units were baked
    //     from the SNAPSHOT height, so over a building authored lower they
    //     float (Regents West: a 41 x 44 m slab 6.5 m over the roof). Those
    //     features carry no id or name, only k/b/h, so they are hidden by a
    //     `distance` clause against every authored footprint inset this many
    //     metres — a feature that overlaps the inset outline goes, one that
    //     only touches the boundary (a neighbour's own deck) stays.
    //   storeys — js/facades.js's campus-storeys courses, keyed by `host`.
    //   walls — the tiled-roof bake's `f: band` strips (roofs-pitched), baked
    //     on the SNAPSHOT prism too. See wallMargin.
    //   parts — data/parts.geojson's building:part prisms (parts-3d,
    //     parts-roof), which carry an osm_id and no snapshot id, so they are
    //     hidden by geometry on the same inset outline as the roofscape:
    //     way/516187626 stands to 94 m over Dobie Twenty21, authored at 81.2.
    //   precinct — js/moody.js's own arena, from data/moody.geojson
    //     (moody-wall / moody-roof / moody-plant / moody-cap). That pass was
    //     written when the arena was nobody's authored building; it is one
    //     now (data/apartments/moody-center.json), and its own drum walls
    //     stand to 28.7 m over a building this file authors at 17.4 m to the
    //     eave and 22.6 m to the membrane — a second arena, six metres of it
    //     in the air. The same file draws two precinct NEIGHBOURS we do not
    //     author (its `replacedBuildingIds` names three ids, only one of
    //     which is ours), so this is hidden by geometry on the authored
    //     footprint rather than by turning the pass off.
    hideRoofscape: true,
    roofscapeInset: 1.0,
    hideStoreys: true,
    hideParts: true,
    hidePrecinct: true,
    // HOW FAR OUTSIDE ITS FOOTPRINT A BAKED WALL DETAIL MAY STAND AND STILL
    // BE OURS TO REMOVE. This is the number Simeon's "scaffolding" was: the
    // tiled-roof bake draws the snapshot prism's precast strips PROUD of the
    // wall, so 27 of Jester West Hall's 44 tower strips (b 19 -> h 50.55, on
    // a building whose courtyard wings stop at 18.6 m) sat 0.08-0.11 m
    // OUTSIDE the ring — and `['>', ['distance', ring], 0]`, which hides only
    // what overlaps, kept every one of them: 31 m poles standing in the air
    // over the five-storey wings, with nothing behind them.
    //
    // Measured over data/roofs.geojson on 2026-09-06, minimum distance from
    // each feature to the nearest authored footprint: 902 at 0 m, 179 in
    // (0, 0.11], 3 at 0.4, then NOTHING until 1.8 m — a neighbour's own band
    // on the party wall. So the gap this number lives in is wide, and 0.6
    // takes every stray with 1.2 m of clearance to the first feature that is
    // not ours. Raise it and a neighbour's wall detail on a shared boundary
    // starts to go; drop it below 0.5 and the poles come back.
    wallMargin: 0.6,
    // Pitched roofs (a block's `roof`, drawn through js/slopes-roofs.js's
    // rig emitter): the pitch a file that gives none gets, the eave lip's
    // fascia height where the roof oversails its wall, and how far a gable
    // end's corners lean in over the rise so the rig's strip on that edge
    // stands just behind the gable wall this file draws in wall tone.
    roof: { pitch: 25, lipH: 0.25, gableLean: 0.30 },
    // Recesses (a band's `inset`): the soffit over a recess and the floor of
    // one that starts above the block's foot are drawn; `insetReturns` draws
    // the side walls where a recess ends against a face that is not recessed.
    insetSoffit: true,
    insetReturns: true,
    // The fixtures that stand OFF a wall (2026-09-08): fins and piers (a
    // band's or a skin's `fins`, a `bays` skin's `pier`), canopies (a band's
    // `canopies`) and openings (a band's `openings`, an inset balcony) —
    // each switchable like the balconies. `openingD` is an opening's depth
    // when its file gives none, `canopyT` a canopy slab's thickness likewise.
    fins: true,
    piers: true,
    canopies: true,
    openings: true,
    openingD: 2.0,
    canopyT: 0.2,
    // A raked (leaning) face: its skin is tiled in metres ALONG the slope,
    // and the building's floor lines land on it where the floors cut the
    // plane. `rakeFloors: false` drops the floor lines from a raked face
    // altogether (a glass rake with no horizontals at the floors).
    rakeFloors: true,
    // Optional shaped window heads, sash bars and folded cladding panels.
    arch: { segments: 20, trimProud: 0.035 },
    mullion: { w: 0.08, proud: 0.04 },
    facets: { w: 3, h: 3, depth: 0.3, backingGap: 0.01 },
  };
  window.APARTMENTS = APTS;

  // ── state ────────────────────────────────────────────────────────────
  let _map = null, _group = null, _data = null, _lastDetail = null;
  let _filtered = false;
  const _clauses = {};              // layer id -> the clause this file put on it (stripped out again on switch-off)
  const count = { buildings: 0, blocks: 0, faces: 0, cells: 0, windows: 0, balconies: 0, signs: 0, signMissing: 0, roofs: 0, insets: 0, frames: 0, mod4Cells: 0, dominoes: 0, rakes: 0, fins: 0, piers: 0, openings: 0, canopies: 0, soffits: 0, chamfers: 0, holes: 0, triangles: 0, ms: 0, done: false, names: [], warnings: [] };
  const RESET_KEYS = ['buildings', 'blocks', 'faces', 'cells', 'windows', 'balconies', 'signs', 'signMissing', 'roofs', 'insets', 'frames', 'mod4Cells', 'dominoes', 'rakes', 'fins', 'piers', 'openings', 'canopies', 'soffits', 'chamfers', 'holes'];
  const resetCount = () => { for (const k of RESET_KEYS) count[k] = 0; count.names = []; count.warnings = []; };
  /** a warning the boot log carries once, and `count.warnings` keeps for the gate */
  const warned = new Set();
  function warnOnce(key, msg) { if (warned.has(key)) return; warned.add(key); count.warnings.push(msg); console.warn('[slopes-apartments] ' + msg); }

  // ── small helpers ────────────────────────────────────────────────────
  const hx3 = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const hexify = v => '#' + v.map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
  /** a deterministic 0..1 from any keys (union.js's h01: FNV-1a with a murmur finaliser) */
  function h01() {
    let x = 2166136261;
    const s = Array.prototype.join.call(arguments, '|');
    for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); }
    x ^= x >>> 16; x = Math.imul(x, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16;
    return (x >>> 8) / 0x1000000;
  }
  const M_LAT = 110540;
  const mLon = lat => 111320 * Math.cos(lat * Math.PI / 180);

  /**
   * The oriented bounding box of a lng/lat ring, +u along its long axis —
   * js/westcampus.js's obbOf, unchanged, so a (u, v) measured for that file
   * is the same (u, v) here.
   */
  function obbOf(ring) {
    const pts0 = ring.slice(0, ring.length - 1);
    const lat0 = pts0.reduce((a, p) => a + p[1], 0) / pts0.length;
    const mx = mLon(lat0), my = M_LAT;
    const p0 = pts0[0];
    const pts = pts0.map(p => [(p[0] - p0[0]) * mx, (p[1] - p0[1]) * my]);
    let best = null;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      let ax = pts[j][0] - pts[i][0], ay = pts[j][1] - pts[i][1];
      const len = Math.hypot(ax, ay);
      if (len < 1e-6) continue;
      ax /= len; ay /= len;
      let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
      for (const p of pts) {
        const u = p[0] * ax + p[1] * ay, v = -p[0] * ay + p[1] * ax;
        if (u < u0) u0 = u; if (u > u1) u1 = u;
        if (v < v0) v0 = v; if (v > v1) v1 = v;
      }
      const area = (u1 - u0) * (v1 - v0);
      if (!best || area < best.area) best = { area, ax, ay, u0, u1, v0, v1 };
    }
    if (!best) return null;
    let { ax, ay, u0, u1, v0, v1 } = best;
    if (v1 - v0 > u1 - u0) {
      const nax = -ay, nay = ax;
      const nu0 = v0, nu1 = v1, nv0 = -u1, nv1 = -u0;
      ax = nax; ay = nay; u0 = nu0; u1 = nu1; v0 = nv0; v1 = nv1;
    }
    return { o: [p0[0] + (u0 * ax - v0 * ay) / mx, p0[1] + (u0 * ay + v0 * ax) / my],
             ax, ay, mx, my, L: u1 - u0, W: v1 - v0 };
  }

  /**
   * The building's frame in local metres: uv(u, v, z) -> [x, y, z]. Built
   * from the obb through slopes.toLocal at three points, so a vertex lands on
   * the pixel MapLibre would put it on (Mercator is affine to 1e-6 over the
   * hundred metres a building spans — measured for slopes.frame()).
   */
  function frameFor(obb) {
    const S = window.slopes;
    const ll = (u, v) => [obb.o[0] + (u * obb.ax - v * obb.ay) / obb.mx, obb.o[1] + (u * obb.ay + v * obb.ax) / obb.my];
    const O = S.toLocal(...ll(0, 0), 0), Pu = S.toLocal(...ll(1, 0), 0), Pv = S.toLocal(...ll(0, 1), 0);
    const U = [Pu.x - O.x, Pu.y - O.y], V = [Pv.x - O.x, Pv.y - O.y];
    const at = (u, v, z) => [O.x + u * U[0] + v * V[0], O.y + u * U[1] + v * V[1], z || 0];
    // ring -> (u, v): the inverse, for the podium's own outline
    const toUV = p => {
      const l = S.toLocal(p[0], p[1], 0);
      const dx = l.x - O.x, dy = l.y - O.y;
      const det = U[0] * V[1] - U[1] * V[0];
      return [(dx * V[1] - dy * V[0]) / det, (U[0] * dy - U[1] * dx) / det];
    };
    const bearing = ((90 - Math.atan2(obb.ay, obb.ax) * 180 / Math.PI) % 360 + 360) % 360;
    return { at, toUV, ll, U, V, L: obb.L, W: obb.W, bearing };
  }

  /**
   * A wall frame in (u, v) space: origin a, along unit dir, outward unit n
   * (both in uv metres). at(s, d, z) is s along the wall, d out of it. The
   * shape slopes.build().extrude wants (at, T, N), in local metres.
   */
  function wallFrame(F, a, b, outward) {
    const du = b[0] - a[0], dv = b[1] - a[1], L = Math.hypot(du, dv) || 1;
    const dir = [du / L, dv / L];
    // outward: the caller says which side is outside (+1 = left of a->b in (u,v), i.e. [-dv, du])
    const n = outward > 0 ? [-dir[1], dir[0]] : [dir[1], -dir[0]];
    const at = (s, d, z) => F.at(a[0] + dir[0] * s + n[0] * d, a[1] + dir[1] * s + n[1] * d, z);
    const o = at(0, 0, 0), t = at(1, 0, 0), nn = at(0, 1, 0);
    const T = [t[0] - o[0], t[1] - o[1], 0], N = [nn[0] - o[0], nn[1] - o[1], 0];
    return { at, T, N, L, a, b, dir, n };
  }

  // ── plan geometry: the straight-skeleton profile, as scripts/bake_roofs.py solves it ──
  //
  // A ring offset inward by d, vertex by vertex, is what a hip roof's eave
  // becomes as it climbs, what a recessed band's wall stands on, and what a
  // footprint becomes when its roofscape must be hidden without catching a
  // neighbour's. scripts/bake_roofs.py's mitre_rays / cap_along /
  // edge_event_caps / wall_profile are ported here as they are (the bake's
  // own comments say why each exists; the short version: a corner travels
  // along its bisector, stops at the medial axis — the ridge — and a wall
  // exists only until its two corners meet). Rings are [[x, y], ...] in
  // metres, interior to the LEFT of each edge (counter-clockwise); ccw()
  // makes them so.
  const ringArea = r => { let A = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; A += p[0] * q[1] - q[0] * p[1]; } return A / 2; };
  const ccw = r => ringArea(r) < 0 ? r.slice().reverse() : r.slice();
  function pointInRing(x, y, r) {
    let inside = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  function segDist(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) : 0;
    return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t));
  }
  const clearance = (p, r) => { let m = Infinity; for (let i = 0; i < r.length; i++) m = Math.min(m, segDist(p, r[i], r[(i + 1) % r.length])); return m; };
  /** per-vertex direction (and speed) the mitred inward offset travels, per metre of offset; null if a corner is degenerate */
  function mitreRays(poly) {
    const n = poly.length, lines = [];
    for (let i = 0; i < n; i++) {
      const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % n];
      const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy);
      if (L < 1e-9) return null;
      lines.push([x0 - dy / L, y0 + dx / L, dx, dy]);      // the offset line at d = 1, inward = left
    }
    const u = [];
    for (let i = 0; i < n; i++) {
      const [ax, ay, adx, ady] = lines[(i - 1 + n) % n], [bx, by, bdx, bdy] = lines[i];
      const den = adx * bdy - ady * bdx;
      if (Math.abs(den) < 1e-9) {
        // parallel edges: a point on a straight run (San Jacinto's south wing
        // has several where the courtyard notches meet the long wall) travels
        // along the inward normal like a sample point; a spike (the edges
        // doubling back) is degenerate
        if (adx * bdx + ady * bdy <= 0) return null;
        const L = Math.hypot(bdx, bdy);
        u.push([-bdy / L, bdx / L]);
        continue;
      }
      const t = ((bx - ax) * bdy - (by - ay) * bdx) / den;
      u.push([ax + adx * t - poly[i][0], ay + ady * t - poly[i][1]]);
    }
    return u;
  }
  const OFFSET_SLACK_M = 0.05;
  /** how far p may travel along ray u and still be an inward offset (bisection; monotone) */
  function capAlong(p, u, poly, dmax) {
    let lo = 0, hi = dmax || 60;
    for (let k = 0; k < 18; k++) {
      const mid = (lo + hi) / 2, q = [p[0] + u[0] * mid, p[1] + u[1] * mid];
      if (pointInRing(q[0], q[1], poly) && clearance(q, poly) >= mid - OFFSET_SLACK_M) lo = mid; else hi = mid;
    }
    return lo;
  }
  /** the caps, further limited so no wall's two mitres can cross (the bake's edge events) */
  function edgeEventCaps(poly, u, caps, dmax) {
    const n = poly.length, out = caps.slice();
    const firstGapClose = (L, ai, aj, ci, cj) => {
      const gap = d => L + Math.min(d, cj) * aj - Math.min(d, ci) * ai;
      let lo = 0;
      for (const hi of [...new Set([Math.min(ci, cj), Math.max(ci, cj), dmax])].sort((a, b) => a - b)) {
        if (hi <= lo) continue;
        const g0 = gap(lo), g1 = gap(hi);
        if (g1 > 1e-9) { lo = hi; continue; }
        if (g0 <= 1e-9) return lo;
        return lo + (hi - lo) * g0 / (g0 - g1);
      }
      return dmax;
    };
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, dx = poly[j][0] - poly[i][0], dy = poly[j][1] - poly[i][1], L = Math.hypot(dx, dy);
      if (L < 1e-9) continue;
      const tx = dx / L, ty = dy / L;
      const dEv = firstGapClose(L, u[i][0] * tx + u[i][1] * ty, u[j][0] * tx + u[j][1] * ty, caps[i], caps[j]);
      out[i] = Math.min(out[i], dEv); out[j] = Math.min(out[j], dEv);
    }
    return out;
  }
  /**
   * The full profile: every vertex with its mitre ray and cap, plus sample
   * points along any wall whose middle can outrun its own corners (the bake's
   * wall_profile, DENSIFY_* as there). Returns { pts, rays, caps, spans }.
   */
  function wallProfile(poly, dFinal, densify) {
    const DENSIFY_GAIN_M = 0.75, DENSIFY_MAX_PTS = 8, DENSIFY_MARGIN_M = 0.25;
    const n = poly.length, mrays = mitreRays(poly);
    if (!mrays) return null;
    const dmax = Math.max(60, dFinal * 2);
    let caps = poly.map((p, j) => capAlong(p, mrays[j], poly, dmax));
    caps = edgeEventCaps(poly, mrays, caps, dmax);
    const pts = [], rays = [], pcaps = [], spans = [];
    for (let i = 0; i < n; i++) {
      const a = pts.length;
      pts.push(poly[i]); rays.push(mrays[i]); pcaps.push(caps[i]);
      const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % n];
      const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy);
      if (L > 1e-9 && densify !== false) {
        const u = [-dy / L, dx / L], mid = [x0 + dx / 2, y0 + dy / 2], jn = (i + 1) % n;
        const got = 0.5 * (Math.min(dFinal, caps[i]) + Math.min(dFinal, caps[jn]));
        const gain = Math.min(dFinal, capAlong(mid, u, poly, dmax)) - got;
        if (gain > DENSIFY_GAIN_M) {
          const di = Math.min(dFinal, caps[i]), dj = Math.min(dFinal, caps[jn]), tx = dx / L, ty = dy / L;
          let sLo = mrays[i][0] * di * tx + mrays[i][1] * di * ty, sHi = L + mrays[jn][0] * dj * tx + mrays[jn][1] * dj * ty;
          sLo = Math.max(0, sLo) + DENSIFY_MARGIN_M; sHi = Math.min(L, sHi) - DENSIFY_MARGIN_M;
          const span = sHi - sLo;
          if (span > DENSIFY_MARGIN_M) {
            const k = Math.max(1, Math.min(DENSIFY_MAX_PTS, Math.floor(span / 2)));
            for (let s = 1; s <= k; s++) {
              const t = (sLo + span * s / (k + 1)) / L, q = [x0 + dx * t, y0 + dy * t];
              pts.push(q); rays.push(u); pcaps.push(capAlong(q, u, poly, dmax));
            }
          }
        }
      }
      spans.push([a, pts.length]);
    }
    return { pts, rays, caps: pcaps, spans, maxCap: Math.max(...caps) };
  }
  /** the ring offset inward by d (each corner along its mitre, capped) — a recessed wall's plan, an inset footprint */
  function offsetRing(ring, d) {
    const poly = ccw(ring);
    const u = mitreRays(poly);
    if (!u) return null;
    const caps = poly.map((p, j) => capAlong(p, u[j], poly, Math.max(60, d * 2)));
    return poly.map((p, j) => { const c = Math.min(d, caps[j]); return [p[0] + u[j][0] * c, p[1] + u[j][1] * c]; });
  }

  // ── colours ──────────────────────────────────────────────────────────
  /**
   * A colour is a [day, golden, night] triple. The building's `colours`
   * table may give a triple or a day hex alone; a day hex gets golden and
   * night from the same ramp js/westcampus.js applies to its own walls, so a
   * mesh panel and the fill-extrusion band next door age the same way.
   */
  const T4_NIGHT_GAIN = 0.19, T4_NIGHT_TINT = [18, 22, 40], T4_NIGHT_TOWARD = 0.42;   // js/westcampus.js
  function ramp(hex) {
    const c = hx3(hex);
    const mixc = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
    return [hex, hexify(mixc(c, [255, 190, 130], 0.16)), hexify(mixc(c.map(v => v * T4_NIGHT_GAIN), T4_NIGHT_TINT, T4_NIGHT_TOWARD))];
  }
  function palette(spec) {
    const out = {};
    for (const k of Object.keys(spec.colours || {})) {
      if (k[0] === '_') continue;                       // a `_src` note beside a colour, not a colour
      const v = spec.colours[k];
      const hexes = Array.isArray(v) ? v : (v && v.hex);
      out[k] = Array.isArray(hexes) ? (hexes.length === 3 ? hexes : ramp(hexes[0])) : ramp(hexes);
    }
    return out;
  }
  /**
   * The first of these tone keys the palette carries, else `wall`, `roof`,
   * `coping`, else the palette's first colour: a name a file does not define
   * (The Standard has no `wall`; a recess on its storefront asked for one)
   * must never reach the builder as undefined and stop the whole building.
   */
  function toneOf(P) {
    for (let i = 1; i < arguments.length; i++) { const k = arguments[i]; if (k && P[k]) return P[k]; }
    for (const k of ['wall', 'roof', 'coping', 'frame']) if (P[k]) return P[k];
    for (const k of Object.keys(P)) return P[k];
    return ['#888888', '#a08c78', '#101418'];
  }

  // ── the 5x7 dot font ─────────────────────────────────────────────────
  // The whole alphabet, the digits and the marks a wordmark can carry. It
  // began as the fourteen letters THE STANDARD's signs needed, and the next
  // building found the gap at once: MOONTOWER rendered as MOONTO ER with a
  // hole where the W was, on the one feature that building is known by.
  // Rows top to bottom, five columns, '1' is a dot. An unknown character is
  // a space, and `signMissing` counts them so the boot log can say so.
  const FONT = {
    A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
    B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
    C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
    D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
    E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
    F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
    G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
    H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
    I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
    J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
    K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
    L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
    M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
    N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
    O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
    P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
    Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
    R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
    S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
    T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
    U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
    V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
    W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
    X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
    Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
    Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
    0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
    1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
    2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
    3: ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
    4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
    5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
    6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
    7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
    8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
    9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
    ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
    '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
    '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
    '&': ['01100', '10010', '10100', '01000', '10101', '10010', '01101'],
    "'": ['01100', '00100', '01000', '00000', '00000', '00000', '00000'],
    '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
  };
  const glyph = ch => { const g = FONT[ch]; if (!g) count.signMissing++; return g || FONT[' ']; };

  // ══════════════════════════════════════════════════════════════════════
  //  GEOMETRY
  // ══════════════════════════════════════════════════════════════════════

  /** A quad on a wall frame: (s0..s1, z0..z1) at depth d, facing outward (+N). */
  function faceQuad(B, W, s0, s1, z0, z1, d, col) {
    B.quad(W.at(s0, d, z0), W.at(s1, d, z0), W.at(s1, d, z1), W.at(s0, d, z1), col, W.N);
  }

  // ── a cut through a face ─────────────────────────────────────────────
  //
  // A face is a rectangle in (s, z) until a raking plane runs through it:
  // the flank of Villas on Rio's north arm is a white panel wall under a
  // glass plane at 56°, and its cells stop at the plane. `cut` is a
  // half-plane in the face's own (s, z) — keep where a·s + b·z + c ≥ 0 — and
  // a cell the line crosses is clipped to it (Sutherland–Hodgman against one
  // line: a rectangle becomes three to five points) and drawn as a polygon
  // in the wall's plane. A cell wholly outside is not drawn and not counted;
  // an opening the line would cross is dropped whole, so every reveal stays
  // a rectangle.
  const cutSide = (cut, s, z) => cut.a * s + cut.b * z + cut.c;
  function clipRect(sa, sb, za, zb, cut) {
    const pts = [[sa, za], [sb, za], [sb, zb], [sa, zb]];
    const v = pts.map(p => cutSide(cut, p[0], p[1]));
    if (v.every(x => x >= -1e-9)) return pts;
    if (v.every(x => x <= 1e-9)) return null;
    const out = [];
    for (let i = 0; i < 4; i++) {
      const p = pts[i], q = pts[(i + 1) % 4], vp = v[i], vq = v[(i + 1) % 4];
      if (vp >= 0) out.push(p);
      if ((vp >= 0) !== (vq >= 0)) { const t = vp / (vp - vq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
    }
    return out.length >= 3 ? out : null;
  }
  /** a cell, clipped to the face's cut when it has one: a quad, a polygon, or nothing */
  function faceCell(B, W, sa, sb, za, zb, d, col, cut) {
    if (!cut) { faceQuad(B, W, sa, sb, za, zb, d, col); return true; }
    const poly = clipRect(sa, sb, za, zb, cut);
    if (!poly) return false;
    if (poly.length === 4 && poly[0][0] === sa && poly[2][0] === sb && poly[0][1] === za && poly[2][1] === zb) { faceQuad(B, W, sa, sb, za, zb, d, col); return true; }
    B.polygon(poly.map(p => { const q = W.at(p[0], d, p[1]); return [q[0], q[1], q[2], p[0]]; }), col, W.N, 'uz');
    return true;
  }
  const rectInCut = (s0, s1, z0, z1, cut) => !cut || [[s0, z0], [s1, z0], [s1, z1], [s0, z1]].every(p => cutSide(cut, p[0], p[1]) >= -1e-6);

  /**
   * A closed box on a wall frame: s0..s1 along, d0..d1 out (d0 may be
   * negative = into the wall), z0..z1 up. `skip` names faces to leave out
   * ('back' = the d0 face against the wall, 'bottom', 'top').
   */
  function box(B, W, s0, s1, d0, d1, z0, z1, col, skip) {
    skip = skip || {};
    const P = (s, d, z) => W.at(s, d, z);
    const T = W.T, N = W.N;
    const nT = [-T[0], -T[1], 0], nN = [-N[0], -N[1], 0];
    if (!skip.front) B.quad(P(s0, d1, z0), P(s1, d1, z0), P(s1, d1, z1), P(s0, d1, z1), col, N);
    if (!skip.back) B.quad(P(s0, d0, z0), P(s0, d0, z1), P(s1, d0, z1), P(s1, d0, z0), col, nN);
    if (!skip.top) B.quad(P(s0, d0, z1), P(s1, d0, z1), P(s1, d1, z1), P(s0, d1, z1), col, [0, 0, 1]);
    if (!skip.bottom) B.quad(P(s0, d0, z0), P(s0, d1, z0), P(s1, d1, z0), P(s1, d0, z0), col, [0, 0, -1]);
    if (!skip.s0) B.quad(P(s0, d0, z0), P(s0, d1, z0), P(s0, d1, z1), P(s0, d0, z1), col, nT);
    if (!skip.s1) B.quad(P(s1, d0, z0), P(s1, d0, z1), P(s1, d1, z1), P(s1, d1, z0), col, T);
  }

  /**
   * THE CELL TILER. `face` = { W (wall frame), len, z0, z1 }; `skin` is the
   * resolved skin (rows, cols, tone(row, col, cell), windows). Emits one quad
   * per cell; a window cell is recessed by `reveal` with four reveal strips.
   */
  function tileFace(B, face, skin, P, opts) {
    const { W, len, z0, z1, cut } = face;
    const reveal = APTS.reveals ? (skin.reveal != null ? skin.reveal : APTS.reveal) : 0;
    // an opening's own depth and tone (a band's `openings`: a garage mouth, an
    // entry court, a loggia) ride on the window record; the skin's windows
    // take the skin's reveal and its glass
    const revealOf = w => APTS.reveals ? (w.reveal != null ? w.reveal : reveal) : 0;
    const windows = (skin.windows || []).filter(w => w.s1 > 0 && w.s0 < len && w.z1 > z0 && w.z0 < z1)
      .map(w => ({ s0: Math.max(0, w.s0), s1: Math.min(len, w.s1), z0: Math.max(z0, w.z0), z1: Math.min(z1, w.z1), lit: w.lit, frame: w.frame, spandrel: w.spandrel, reveal: w.reveal, tone: w.tone, arch: w.arch, mullion: w.mullion }))
      .filter(w => rectInCut(w.s0, w.s1, w.z0, w.z1, cut));
    // THE FRAME. A window's `frame: { w, h, tone }` is a picture frame round
    // the opening — Signature 1909's white precast surround on every panel
    // tower's punched window, Jester West's 1.31 x 2.31 m precast round a
    // 0.72 x 1.76 window. It is not a strip laid on the wall (that would sit
    // in the wall's own plane and fight it): its four edges are cut into the
    // wall's cells like a row or column line, and a cell whose centre falls
    // in the ring takes the frame's tone. Nothing overlaps, the frame is
    // exactly as wide as the file says, and it costs the cells it makes.
    const framed = windows.filter(w => w.frame && w.frame.w > 0).map(w => {
      const fw = w.frame.w, fh = w.frame.h != null ? w.frame.h : w.frame.w;
      return { s0: Math.max(0, w.s0 - fw), s1: Math.min(len, w.s1 + fw), z0: Math.max(z0, w.z0 - fh), z1: Math.min(z1, w.z1 + fh), col: P[w.frame.tone] || P.frame || P.wall, w };
    });
    count.frames += framed.length;
    // THE SPANDREL. A window's `spandrel: { h, tone }` is a panel of the
    // opening's own width standing directly under it — The Standard's rust
    // panel beneath every window on the bays that carry one (Ext_14 and
    // Ext_41 at full resolution: a wood-look panel under the sill, inside the
    // window's charcoal frame, and a column of them reads from the oblique
    // as the interrupted rust strip the owner's photographs describe). It is
    // cut into the wall's cells the way the frame is, `h` tall downward from
    // the frame's sill strip (or from the sill when there is no frame), and
    // an `offsets` entry may carry its own as a third element (`null` there
    // = none), so a window bay and the juliet-door bay beside it need not
    // match. A window clipped at the band's foot gets none.
    const spandrels = windows.filter(w => w.spandrel && w.spandrel.h > 0 && w.z0 > z0 + 1e-6).map(w => {
      const fh = w.frame && w.frame.w > 0 ? (w.frame.h != null ? w.frame.h : w.frame.w) : 0;
      const zt = w.z0 - fh;
      return { s0: w.s0, s1: w.s1, z0: Math.max(z0, zt - w.spandrel.h), z1: zt, col: P[w.spandrel.tone] || P.frame || P.wall, w };
    }).filter(r => r.z1 - r.z0 > 1e-4);
    const regions = framed.concat(spandrels);   // frames first: where a ring and a panel meet, the ring wins
    // z cuts: the skin's row lines, every window's top and bottom, every frame's and spandrel's
    const zc = new Set([z0, z1]);
    for (const z of skin.rows(z0, z1)) if (z > z0 && z < z1) zc.add(+z.toFixed(4));
    for (const w of windows) { if (w.z0 > z0 && w.z0 < z1) zc.add(+w.z0.toFixed(4)); if (w.z1 > z0 && w.z1 < z1) zc.add(+w.z1.toFixed(4)); }
    for (const f of regions) { if (f.z0 > z0 && f.z0 < z1) zc.add(+f.z0.toFixed(4)); if (f.z1 > z0 && f.z1 < z1) zc.add(+f.z1.toFixed(4)); }
    const zs = [...zc].sort((a, b) => a - b);
    const glass = P[skin.glass || 'glass'];
    const revealCol = P[skin.revealTone || skin.frame || 'frame'] || P.frame || glass;
    for (let r = 0; r < zs.length - 1; r++) {
      const za = zs[r], zb = zs[r + 1];
      if (zb - za < 1e-4) continue;
      const zm = (za + zb) / 2;
      // s cuts for this band: the skin's column lines for this row, plus the
      // edges of every window and every frame that spans this band
      const sc = new Set([0, len]);
      for (const s of skin.cols(zm, len)) if (s > 0 && s < len) sc.add(+s.toFixed(4));
      const inBand = windows.filter(w => w.z0 <= za + 1e-6 && w.z1 >= zb - 1e-6);
      for (const w of inBand) { if (w.s0 > 0 && w.s0 < len) sc.add(+w.s0.toFixed(4)); if (w.s1 > 0 && w.s1 < len) sc.add(+w.s1.toFixed(4)); }
      const frBand = regions.filter(f => f.z0 <= za + 1e-6 && f.z1 >= zb - 1e-6);
      for (const f of frBand) { if (f.s0 > 0 && f.s0 < len) sc.add(+f.s0.toFixed(4)); if (f.s1 > 0 && f.s1 < len) sc.add(+f.s1.toFixed(4)); }
      const ss = [...sc].sort((a, b) => a - b);
      for (let c = 0; c < ss.length - 1; c++) {
        const sa = ss[c], sb = ss[c + 1];
        if (sb - sa < 1e-4) continue;
        const sm = (sa + sb) / 2;
        const win = inBand.find(w => sm > w.s0 && sm < w.s1);
        let drawn;
        if (win) {
          const pane = win.tone ? P[win.tone] || glass : glass;
          const col = win.lit ? [pane[0], pane[1], APTS.nightLitTone] : pane;
          drawn = faceCell(B, W, sa, sb, za, zb, -revealOf(win), col, cut);
        } else {
          const fr = frBand.length ? frBand.find(f => sm > f.s0 && sm < f.s1) : null;
          drawn = faceCell(B, W, sa, sb, za, zb, 0, fr ? fr.col : (skin.tone(zm, sm, r, c) || P.wall), cut);
        }
        if (drawn) count.cells++;
      }
    }
    // reveals: four strips per window, joining the recessed pane to the plane
    for (const w of windows) {
      const rv = revealOf(w);
      if (rv <= 0) continue;
      const T = W.T, N = W.N;
      const P0 = (s, d, z) => W.at(s, d, z);
      const rc = (w.revealTone && P[w.revealTone]) || (w.tone ? (P[w.tone] || revealCol) : revealCol);
      // sill (faces up), head (faces down), jambs (face along the wall)
      B.quad(P0(w.s0, -rv, w.z0), P0(w.s1, -rv, w.z0), P0(w.s1, 0, w.z0), P0(w.s0, 0, w.z0), rc, [0, 0, 1]);
      B.quad(P0(w.s0, 0, w.z1), P0(w.s1, 0, w.z1), P0(w.s1, -rv, w.z1), P0(w.s0, -rv, w.z1), rc, [0, 0, -1]);
      B.quad(P0(w.s0, -rv, w.z0), P0(w.s0, 0, w.z0), P0(w.s0, 0, w.z1), P0(w.s0, -rv, w.z1), rc, T);
      B.quad(P0(w.s1, 0, w.z0), P0(w.s1, -rv, w.z0), P0(w.s1, -rv, w.z1), P0(w.s1, 0, w.z1), rc, [-T[0], -T[1], 0]);
    }
    // A round-headed opening retains the rectangular tiler's cutout, then
    // closes only the two spandrels above its curved head. The glass remains
    // recessed; the arch soffit joins the wall to the pane along that curve.
    // Dimensions and tessellation belong to the building's window spec.
    for (const w of windows) if (w.arch) {
      const radius = (w.s1 - w.s0) / 2;
      const rise = Math.min(w.z1 - w.z0, w.arch.rise || radius);
      const spring = w.z1 - rise, cx = (w.s0 + w.s1) / 2;
      const segments = Math.max(8, Math.min(48, w.arch.segments || APTS.arch.segments));
      const rv = revealOf(w), col = P[w.arch.tone] || skin.tone(spring, cx) || P.wall;
      const at = (s, d, z) => W.at(s, d, z);
      for (let i = 0; i < segments; i++) {
        const a = Math.PI * i / segments, b = Math.PI * (i + 1) / segments;
        const sa = cx - radius * Math.cos(a), sb = cx - radius * Math.cos(b);
        const za = spring + rise * Math.sin(a), zb = spring + rise * Math.sin(b);
        B.quad(at(sa,0,za),at(sb,0,zb),at(sb,0,w.z1),at(sa,0,w.z1),col,W.N);
        if (rv > 0) B.quad(at(sa,0,za),at(sa,-rv,za),at(sb,-rv,zb),at(sb,0,zb),col);
        const sw = w.arch.trim || 0;
        if (sw > 0) {
          const oa = cx - (radius + sw) * Math.cos(a), ob = cx - (radius + sw) * Math.cos(b);
          const ha = spring + (rise + sw) * Math.sin(a), hb = spring + (rise + sw) * Math.sin(b);
          const proud = w.arch.proud ?? APTS.arch.trimProud;
          B.quad(at(sa,proud,za),at(sb,proud,zb),at(ob,proud,hb),at(oa,proud,ha),col,W.N);
        }
      }
    }
    for (const w of windows) if (w.mullion) {
      const m = w.mullion, width = m.w || APTS.mullion.w, col = P[m.tone || 'trim'] || P.frame;
      const d = -revealOf(w) + (m.proud ?? APTS.mullion.proud), radius = (w.s1-w.s0)/2;
      const rise = w.arch ? Math.min(w.z1-w.z0,w.arch.rise || radius) : 0;
      const topAt = s => w.arch ? w.z1-rise+rise*Math.sqrt(Math.max(0,1-Math.pow((s-(w.s0+w.s1)/2)/radius,2))) : w.z1;
      for (const f of m.cols || [.5]) {
        const x = w.s0 + f*(w.s1-w.s0), a = x-width/2, b=x+width/2;
        faceQuad(B,W,a,b,w.z0,Math.min(topAt(a),topAt(b)),d,col);
      }
      for (const f of m.rows || []) {
        const z = w.z0+f*(w.z1-w.z0), shrink = w.arch && z > w.z1-rise ? radius*(1-Math.sqrt(Math.max(0,1-Math.pow((z-(w.z1-rise))/rise,2)))) : 0;
        faceQuad(B,W,w.s0+shrink,w.s1-shrink,z-width/2,z+width/2,d,col);
      }
    }
    // the blades standing proud of the wall: the skin's piers (on its bay
    // lines) and its fins (on their own pitch) — see blades()
    if (skin.piers) blades(B, W, skin.piers, len, z0, z1, P, cut);
    if (skin.fins) blades(B, W, skin.fins, len, z0, z1, P, cut);
    if (skin.facets) {
      const f = skin.facets, pw = f.w || APTS.facets.w, ph = f.h || APTS.facets.h, depth = f.depth || APTS.facets.depth;
      const nx = Math.max(1,Math.round(len/pw)), dx=len/nx;
      for(let i=0;i<nx;i++) for(let z=z0;z<z1-.01;z+=ph) {
        const a=i*dx,b=(i+1)*dx,zt=Math.min(z+ph,z1),c=(a+b)/2,zm=(z+zt)/2;
        const gap = f.backingGap ?? APTS.facets.backingGap;
        const p=[W.at(a,gap,z),W.at(b,gap,z),W.at(b,gap,zt),W.at(a,gap,zt)], peak=W.at(c,depth,zm);
        for(let k=0;k<4;k++) {
          const tone = f.tones?.[k % f.tones.length] || f.tone;
          B.tri(p[k],p[(k+1)%4],peak,P[tone]||P.wall,W.N);
        }
      }
    }
    count.windows += windows.length;
    count.faces++;
  }

  // ── blades: piers and fins, standing OFF the wall ────────────────────
  //
  // A pier or a fin is a box on the wall frame: `w` along the wall, `d` out
  // of it (from `off` — a bracket gap, 0 when it sits on the wall — to
  // off + d), the band's height or its own `z0`..`z1`, in `tone`. Nothing
  // about the wall behind changes: the cells are tiled as usual and the box
  // stands in front of them with its back left open against the plane, so
  // the two never share a face. The whole difference between a pier and a
  // fin is where they stand — a PIER is on the skin's own bay lines and
  // groups the bays between (The Standard's podium: white piers between the
  // glazing-and-rust bays), a FIN is on its own pitch (Moody Center's 12 in
  // airfoil tubes on 4 ft centres, Dark Bronze, standing 0.30 m proud of the
  // glazing; 21 Rio's bronze fins on brackets; The Castilian's garage
  // screen). `frontTone` colours the outer face alone (an airfoil's nose
  // reads lighter than its flanks); `horizontal: true` lays the blades
  // across the wall at a vertical pitch (a sunshade, a trellis) with `w`
  // their height. `at: [s...]` places them by hand; otherwise `pitch` from
  // `from` to `to`, on the centres, or `on: 'joints'` from `from` inclusive.
  //   { pitch | at, w, d, tone, off?, from?, to?, on?, z0?, z1?, frontTone?, horizontal?, every? }
  // Under a `cut` (a raking plane through the face) a blade is drawn only
  // where its whole rectangle is inside the kept side.
  function bladeCentres(spec, len) {
    if (Array.isArray(spec.at)) return spec.at.slice();
    const pitch = spec.pitch || 3.0, from = spec.from || 0, to = spec.to != null ? spec.to : len, every = Math.max(1, spec.every | 0 || 1);
    const n = Math.max(1, Math.round((to - from) / pitch)), mod = (to - from) / n;
    const at = [];
    if (spec.on === 'joints') { for (let i = 0; i <= n; i += every) at.push(from + i * mod); }
    else for (let i = 0; i < n; i += every) at.push(from + (i + 0.5) * mod);
    return at;
  }
  function blades(B, W, spec, len, z0, z1, P, cut) {
    const w = spec.w || 0.3, d = spec.d != null ? spec.d : 0.3, off = spec.off || 0;
    const col = toneOf(P, spec.tone, 'frame'), front = spec.frontTone ? P[spec.frontTone] || col : null;
    const zb0 = Math.max(z0, spec.z0 != null ? spec.z0 : z0), zb1 = Math.min(z1, spec.z1 != null ? spec.z1 : z1);
    if (zb1 - zb0 < 0.02 || d <= 0) return 0;
    const skip = { back: off <= 1e-6, front: !!front };
    let n = 0;
    const one = (s0, s1, za, zz) => {
      if (s1 - s0 < 0.005 || zz - za < 0.005) return;
      if (!rectInCut(s0, s1, za, zz, cut)) return;
      box(B, W, s0, s1, off, off + d, za, zz, col, skip);
      if (front) faceQuad(B, W, s0, s1, za, zz, off + d, front);
      n++;
    };
    if (spec.horizontal) {
      const pitch = spec.pitch || 1.0, s0 = Math.max(0, spec.from || 0), s1 = Math.min(len, spec.to != null ? spec.to : len);
      const zs = Array.isArray(spec.at) ? spec.at : (() => { const out = []; for (let z = zb0 + (spec.start != null ? spec.start : pitch / 2); z <= zb1 + 1e-6; z += pitch) out.push(z); return out; })();
      for (const z of zs) one(s0, s1, Math.max(zb0, z - w / 2), Math.min(zb1, z + w / 2));
    } else {
      for (const c of bladeCentres(spec, len)) one(Math.max(0, c - w / 2), Math.min(len, c + w / 2), zb0, zb1);
    }
    if (spec.isPier) count.piers += n; else count.fins += n;
    return n;
  }

  // ── skins: each resolves a JSON skin spec into rows/cols/tone/windows ──
  //
  // All of them are parameterised by the building's JSON: a bay module, a
  // course height, a plank length, a window size — never a hard-coded count
  // (union.js: "Column COUNT is derived from the bay module, never
  // hardcoded"). `ctx` = { len, z0, z1, floorZ(i) -> z of floor i's slab,
  // floors: [z...] the floor lines inside z0..z1, key: a hash seed }.

  function windowsFromBays(spec, ctx, P, key) {
    // one window per bay per floor: `bay` metres wide, window `w` x `h` with
    // its sill `sill` above the floor line; `cols` (fractions of the face)
    // instead of a bay module gives fixed columns (the pixel towers' slits)
    const out = [];
    const win = spec.window;
    if (!win) return out;
    // the band's floor lines, plus the one just below it when the band starts
    // within APTS.floorSlack of it (floorsBetween): that storey's windows
    // are drawn and clipped to the band by tileFace
    const floors = ctx.floorBelow != null ? [ctx.floorBelow].concat(ctx.floors) : ctx.floors;
    let centres = [];
    if (win.cols) centres = win.cols.map(f => f * ctx.len);
    else {
      const bay = spec.bay || 3.0;
      const n = Math.max(1, Math.round(ctx.len / bay));
      const mod = ctx.len / n;
      for (let i = 0; i < n; i++) centres.push((i + 0.5) * mod);
    }
    const skipS = spec.windowSkip || [];   // s ranges with no window (a sign, a balcony door handled elsewhere)
    // `offsets`: several openings per bay, each [offset from the bay centre, width]
    // in metres — a mirrored pair about a party wall (Jester West, San Jacinto:
    // [[-1.5, 0.72], [1.5, 0.72]]), a wide light with two narrow ones beside
    // it (Skyloft). Without it, one window of `w` at the bay centre.
    const parts = Array.isArray(win.offsets) && win.offsets.length ? win.offsets : [[0, win.w || 1.5]];
    // `flip: true` mirrors the offsets about the bay centre where bay + storey
    // is odd — the diagonal weave of a slot that changes hands bay to bay and
    // row to row (Villas on Rio's glass slot at ±0.55 m off the bay centre)
    const flip = !!win.flip;
    const frame = win.frame && win.frame.w > 0 ? win.frame : null;
    // `spandrel: { h, tone }` under every opening, or per opening as an
    // `offsets` entry's third element (`null` = none) — see tileFace
    const spandrel = win.spandrel && win.spandrel.h > 0 ? win.spandrel : null;
    for (let fi = 0; fi < floors.length; fi++) {
      const fz = floors[fi];
      const zb = fz + (win.sill != null ? win.sill : 0.8), zt = zb + (win.h || 2.0);
      if (zt > ctx.z1 + 1e-6) continue;
      // Anchor the checker to the building's floor list, not this band's
      // first row: changing material halfway up a wall must not reset it.
      const storey = ctx.allFloors ? ctx.allFloors.indexOf(fz) : fi;
      for (let ci = 0; ci < centres.length; ci++) {
        if (spec.windowRule === 'checker' && ((ci + storey) & 1)) continue;
        for (let pi = 0; pi < parts.length; pi++) {
          const cx = centres[ci] + (flip && ((ci + fi) & 1) ? -parts[pi][0] : parts[pi][0]), ww = parts[pi][1];
          const s0 = cx - ww / 2, s1 = cx + ww / 2;
          if (s0 < 0.05 || s1 > ctx.len - 0.05) continue;
          if (skipS.some(r => s1 > r[0] && s0 < r[1])) continue;
          const sp = parts[pi].length > 2 ? (parts[pi][2] && parts[pi][2].h > 0 ? parts[pi][2] : null) : spandrel;
          out.push({ s0, s1, z0: zb, z1: zt, lit: h01(key, 'lit', fi, ci, pi) < APTS.nightLit, frame, spandrel: sp, arch: win.arch, mullion: win.mullion });
        }
      }
    }
    return out;
  }

  /**
   * `pixel`: horizontal panel planks in a running bond, tones by hash, slit
   * windows in fixed columns. The TONE is decided per macro cell of
   * `macro[0]` courses by `macro[1]` planks (The Standard: 2 x 2 — its dark
   * runs are two courses tall and two to four planks long in every
   * photograph, and single 0.56 m planks decided one by one read as noise
   * from the oblique camera); the joints between the real planks inside a
   * macro cell are still drawn, so the coursing survives the walk-up.
   */
  function skinPixel(spec, ctx, P, key) {
    const course = spec.course || 0.556, plank = spec.plank || 2.2, bond = (spec.bond != null ? spec.bond : 0.5) * plank;
    const macro = spec.macro || [1, 1];
    const MR = Math.max(1, macro[0] | 0), MP = Math.max(1, macro[1] | 0);
    const tones = spec.tones.map(t => P[t]);
    // cumulative weights -> a tone per macro plank from one hash; runs of 1..runMax macro planks share a tone
    const w = spec.weights || tones.map(() => 1), tot = w.reduce((a, b) => a + b, 0);
    const cum = []; let acc = 0; for (const x of w) { acc += x / tot; cum.push(acc); }
    const runMax = spec.runMax || 3;
    const zBase = spec.zBase != null ? spec.zBase : ctx.z0;
    const rowOf = z => Math.floor((z - zBase) / course + 1e-6);
    const toneAt = (mrow, mplank) => {
      // the macro plank's run: runs whose length comes from the hash of the run's start
      let i = mplank, guard = 0;
      while (guard++ < runMax) {
        const runLen = 1 + Math.floor(h01(key, 'run', mrow, i) * runMax);
        if (i + runLen > mplank) break;      // this run covers mplank
        i += runLen;
      }
      const r = h01(key, 'tone', mrow, i);
      for (let k = 0; k < cum.length; k++) if (r <= cum[k]) return tones[k];
      return tones[tones.length - 1];
    };
    const offOf = row => (Math.floor(row / MR) % 2) * bond;   // the bond steps per macro row
    return {
      rows: (z0, z1) => { const out = []; for (let z = zBase + course * Math.ceil((z0 - zBase) / course - 1e-6); z < z1; z += course) out.push(z); return out; },
      cols: (zm, len) => { const off = offOf(rowOf(zm)); const out = []; for (let s = off - plank; s < len; s += plank) if (s > 0) out.push(s); return out; },
      tone: (zm, sm) => { const row = rowOf(zm); const off = offOf(row); const plankIdx = Math.floor((sm - off + plank) / plank); return toneAt(Math.floor(row / MR), Math.floor(plankIdx / MP)); },
      windows: windowsFromBays(spec, ctx, P, key),
      glass: spec.glass, frame: spec.frame, reveal: spec.reveal,
    };
  }

  /** `bays`: a flat field cut into bays by vertical strips of another tone, one window per bay per floor */
  function skinBays(spec, ctx, P, key) {
    const bay = spec.bay || 3.4;
    const n = Math.max(1, Math.round(ctx.len / bay)), mod = ctx.len / n;
    const strip = spec.strip || null;                          // { w, tone, at: 'joints' | 'centres' }
    const field = P[spec.field || 'wall'];
    const stripCols = [];
    if (strip) {
      const sw = strip.w || 0.6, every = strip.every || 1;
      const at = strip.at === 'centres' ? [...Array(n)].map((_, i) => (i + 0.5) * mod) : [...Array(n + 1)].map((_, i) => i * mod);
      at.forEach((c, i) => { if (i % every) return; const s0 = Math.max(0, c - sw / 2), s1 = Math.min(ctx.len, c + sw / 2); if (s1 > s0) stripCols.push([s0, s1]); });
    }
    const bands = (spec.bands || []).slice();   // horizontal bands of another tone: [{z0,z1,tone}]
    if (spec.louvre) {
      // a garage screen: horizontal slats `w` tall every `pitch`, in `tone`, over the whole band
      const lv = spec.louvre;
      for (let z = ctx.z0 + (lv.start || 0.3); z + lv.w < ctx.z1; z += lv.pitch) bands.push({ z0: z, z1: z + lv.w, tone: lv.tone });
    }
    const floorLines = spec.floorLine ? ctx.floors.map(z => [z, z + spec.floorLine.h, P[spec.floorLine.tone]]) : [];
    // `fields: [tone, ...]` — the field tone cycles per bay (2623 Salado's
    // cream / terracotta / blue-grey / ochre bays), or per bay AND storey
    // with `fieldRule: 'checker'` (index = bay + storey), so an alternating
    // elevation is one rule and not one face per tone
    const fields = Array.isArray(spec.fields) && spec.fields.length ? spec.fields.map(t => P[t] || field) : null;
    const storeyOf = zm => { let k = 0; for (const f of ctx.floors) if (zm >= f) k++; return k; };
    const fieldAt = (zm, sm) => {
      if (!fields) return field;
      const j = Math.min(n - 1, Math.max(0, Math.floor(sm / mod)));
      const k = spec.fieldRule === 'checker' ? j + storeyOf(zm) : j;
      return fields[((k % fields.length) + fields.length) % fields.length];
    };
    // THE PIER. `pier: { w, d, tone, every?, at?: 'joints' | 'centres', from?,
    // to? }` stands a box `w` wide and `d` proud of the wall on every bay
    // line (or every `every`th, or on the bay centres), the band's full
    // height, so the wall reads as bays GROUPED between piers and not as
    // windows scattered on a field — The Standard's podium in Humphreys'
    // photographs: white piers, and between them the glazing with the rust
    // spandrel under it. Drawn by tileFace through blades(); a `strip` of
    // the same width under it is not needed, the pier covers the line.
    let piers = null;
    if (spec.pier && (spec.pier.d > 0 || spec.pier.d == null)) {
      const pr = spec.pier, every = Math.max(1, pr.every | 0 || 1);
      const from = pr.from || 0, to = pr.to != null ? pr.to : ctx.len;
      const at = [];
      if (Array.isArray(pr.at)) at.push(...pr.at);
      else if (pr.at === 'centres') { for (let i = 0; i < n; i += every) at.push((i + 0.5) * mod); }
      else { for (let i = 0; i <= n; i += every) at.push(i * mod); }
      piers = { at: at.filter(c => c >= from - 1e-6 && c <= to + 1e-6), w: pr.w || 0.5, d: pr.d != null ? pr.d : 0.2, tone: pr.tone, off: pr.off, frontTone: pr.frontTone, z0: pr.z0, z1: pr.z1, isPier: true };
    }
    return {
      rows: (z0, z1) => { const out = []; for (const z of ctx.floors) if (z > z0 && z < z1) out.push(z); for (const b of bands) { out.push(b.z0, b.z1); } for (const f of floorLines) { out.push(f[0], f[1]); } return out; },
      cols: () => { const out = []; for (const s of stripCols) { out.push(s[0], s[1]); } if (fields) for (let i = 1; i < n; i++) out.push(i * mod); return out; },
      tone: (zm, sm) => {
        for (const f of floorLines) if (zm > f[0] && zm < f[1]) return f[2];
        for (const b of bands) if (zm > b.z0 && zm < b.z1) return P[b.tone];
        for (const s of stripCols) if (sm > s[0] && sm < s[1]) return P[strip.tone];
        return fieldAt(zm, sm);
      },
      windows: windowsFromBays(spec, ctx, P, key),
      glass: spec.glass, frame: spec.frame, reveal: spec.reveal, piers,
    };
  }

  /** `storefront`: full-height glazing between mullions, a transom line, a fascia band on top */
  function skinStorefront(spec, ctx, P, key) {
    const mullion = spec.mullion || 1.5, mw = spec.mullionW || 0.12;
    const n = Math.max(1, Math.round(ctx.len / mullion)), mod = ctx.len / n;
    const fascia = spec.fascia || 0.9;         // m of solid band under the floor above
    const plinth = spec.plinth || 0.15;
    const zTop = ctx.z1 - fascia;
    const windows = [];
    const transom = spec.transom != null ? spec.transom : 0.72;
    for (let i = 0; i < n; i++) {
      const s0 = i * mod + mw / 2, s1 = (i + 1) * mod - mw / 2;
      const zt = ctx.z0 + plinth + (zTop - ctx.z0 - plinth) * transom;
      windows.push({ s0, s1, z0: ctx.z0 + plinth, z1: zt - mw / 2, lit: true });
      windows.push({ s0, s1, z0: zt + mw / 2, z1: zTop, lit: true });
    }
    return {
      rows: () => [zTop],
      cols: () => [],
      tone: (zm) => zm > zTop ? P[spec.fasciaTone || 'charcoal'] : P[spec.frame || 'frame'],
      windows, glass: spec.glass || 'storeGlass', frame: spec.frame || 'frame', reveal: spec.reveal != null ? spec.reveal : 0.25,
    };
  }

  /** `flat`: one tone, optional windows from bays */
  function skinFlat(spec, ctx, P, key) {
    return { rows: () => [], cols: () => [], tone: () => P[spec.field || 'wall'], windows: windowsFromBays(spec, ctx, P, key), glass: spec.glass, frame: spec.frame, reveal: spec.reveal };
  }

  /**
   * `mod4`: Union on 24th's outer wall. A square cell per bay per floor —
   * every cell a dark-glass window in a light frame with a light strip above
   * and below it, on the dark ribbed cladding — and the cells merged into
   * two-cell dominoes by the rule k = (c − r) mod `period`, `pairs[k]` = 'h'
   * pairing a cell with the one to its RIGHT, 'v' with the one BELOW, any
   * other k a single: a diagonal weave in which half the vertical reveals
   * and half the horizontal ones vanish. The owner's own model of the
   * building, utx-diorama's union.js, is the source and this is its rule
   * ported: r = 0 is the TOP row, c runs left to right along the face and
   * is CONTINUED round the corners by `colOffset`, so the diagonals wrap on
   * to the end caps; a pair straddling a corner is two halves whose frames
   * and strips run to the edge (`wrap: [lo, hi]`). The cell's fractions are
   * union.js's own, corrected against the building (glass 0.49 of the cell,
   * not the SVG's 0.578): `fi` 0.105 the dark margin, `wi` 0.15 the frame
   * beside the glass, `ws` 0.49 the glass, `st` 0.15 each strip — they sum
   * to 1 in both axes. A pair shares one continuous frame: an H-pair's
   * inner seam is frame, its strips only as wide as its glass; a V-pair's
   * inner seam is the light strip, its strips the frame's full width.
   *   { kind: 'mod4', cell: 3.26, floor?: 3.26, field: 'clad', fieldH?: (the
   *     ribbed cladding behind H-pairs), frameTone: 'frameBase', stripTone:
   *     'strip', glass: 'glassU', frame: (reveal tone; stripTone), reveal,
   *     period: 4, pairs: { 0: 'h', 3: 'v' }, colOffset: 0, rowOffset: 0,
   *     wrap: [false, false], fractions: { fi, wi, ws, st } }
   */
  function skinMod4(spec, ctx, P, key) {
    const cell = spec.cell || spec.bay || 3.26;
    const n = Math.max(1, Math.round(ctx.len / cell)), mod = ctx.len / n;
    const floors = ctx.floors;
    const rows = floors.length;
    const FLOOR = spec.floor || (rows > 1 ? floors[1] - floors[0] : cell);
    const fr = Object.assign({ fi: 0.105, wi: 0.15, ws: 0.49, st: 0.15 }, spec.fractions || {});
    const FI = fr.fi, WI = fr.wi, WS = fr.ws, ST = fr.st;
    const period = spec.period || 4, pairs = spec.pairs || { 0: 'h', 3: 'v' };
    const colOff = spec.colOffset || 0, rowOff = spec.rowOffset || 0;
    const wrapLo = !!(spec.wrap && spec.wrap[0]), wrapHi = !!(spec.wrap && spec.wrap[1]);
    const field = P[spec.field || 'wall'], fieldH = P[spec.fieldH || spec.field || 'wall'];
    const frameCol = P[spec.frameTone || 'frame'] || P.frame, stripCol = P[spec.stripTone || spec.frame || 'strip'] || frameCol;
    const K = (c, r) => (((c - r) % period) + period) % period;
    // the roles, decided the way union.js decides them: rows from the top,
    // columns left to right, a cell claimed by the first pair that reaches it
    const role = [];           // role[fi][j]: 'single' | 'hL' | 'hR' | 'vT' | 'vB'
    for (let fi = 0; fi < rows; fi++) { role.push([]); for (let j = 0; j < n; j++) role[fi].push(null); }
    let dominoes = 0;
    for (let r = 0; r < rows; r++) {
      const fi = rows - 1 - r;                      // r = 0 is the top row
      for (let j = 0; j < n; j++) {
        if (role[fi][j]) continue;
        const k = K(colOff + j, r + rowOff), pk = pairs[k];
        if (pk === 'h' && j + 1 < n && !role[fi][j + 1]) { role[fi][j] = 'hL'; role[fi][j + 1] = 'hR'; dominoes++; }
        else if (pk === 'h' && j + 1 === n && wrapHi) { role[fi][j] = 'hLw'; }
        else if (pk === 'v' && fi - 1 >= 0 && !role[fi - 1][j]) { role[fi][j] = 'vT'; role[fi - 1][j] = 'vB'; dominoes++; }
        else if (j === 0 && wrapLo && pairs[K(colOff - 1, r + rowOff)] === 'h') { role[fi][j] = 'hRw'; }
        else role[fi][j] = 'single';
      }
    }
    count.mod4Cells += rows * n; count.dominoes += dominoes;
    const cellOf = zm => { for (let fi = rows - 1; fi >= 0; fi--) if (zm >= floors[fi]) return zm < floors[fi] + FLOOR ? fi : -1; return -1; };
    const windows = [];
    for (let fi = 0; fi < rows; fi++) for (let j = 0; j < n; j++) {
      const s0 = j * mod + mod * (FI + WI), z0 = floors[fi] + FLOOR * (FI + ST);
      if (z0 + FLOOR * WS > ctx.z1 + 1e-6) continue;
      windows.push({ s0, s1: s0 + mod * WS, z0, z1: z0 + FLOOR * WS, lit: h01(key, 'lit', fi, j) < APTS.nightLit });
    }
    return {
      rows: (z0, z1) => { const out = []; for (const f of floors) for (const q of [0, FI, FI + ST, FI + ST + WS, 1 - FI]) { const z = f + FLOOR * q; if (z > z0 && z < z1) out.push(z); } return out; },
      cols: () => { const out = []; for (let j = 0; j < n; j++) for (const q of [0, FI, FI + WI, FI + WI + WS, 1 - FI]) { const s = j * mod + mod * q; if (s > 0 && s < ctx.len) out.push(s); } return out; },
      tone: (zm, sm) => {
        const fi = cellOf(zm); if (fi < 0) return field;
        const j = Math.min(n - 1, Math.max(0, Math.floor(sm / mod)));
        const fx = (sm - j * mod) / mod, fz = (zm - floors[fi]) / FLOOR;
        const ro = role[fi][j] || 'single';
        const H = ro === 'hL' || ro === 'hR' || ro === 'hLw' || ro === 'hRw';
        const dark = H ? fieldH : field;
        const inFrameZ = fz >= FI && fz <= 1 - FI;
        // the vertical margins: dark, except an H-pair's shared seam and a wrapped half's edge, which the frame and strips run through
        const openR = ro === 'hL' || ro === 'hLw', openL = ro === 'hR' || ro === 'hRw';
        if (fx < FI || fx > 1 - FI) {
          const seam = (fx > 1 - FI && openR) || (fx < FI && openL);
          if (!seam || !inFrameZ) return dark;
          const strip = (fz >= FI && fz <= FI + ST) || (fz >= FI + ST + WS && fz <= 1 - FI);
          return strip && (ro === 'hLw' || ro === 'hRw') ? stripCol : frameCol;
        }
        // the horizontal margins: dark, except a V-pair's seam, the light strip across the frame's width
        if (fz < FI || fz > 1 - FI) {
          const seam = (fz < FI && ro === 'vT') || (fz > 1 - FI && ro === 'vB');
          return seam ? stripCol : dark;
        }
        // inside the frame: the two strips (full width for singles and V members, glass width for H members), the glass, the frame beside it
        const strip = (fz >= FI && fz <= FI + ST) || (fz >= FI + ST + WS && fz <= 1 - FI);
        const inGlassX = fx >= FI + WI && fx <= FI + WI + WS;
        if (strip) { if (!H) return stripCol; return (inGlassX || (openR && fx > FI + WI) || (openL && fx < FI + WI + WS)) ? stripCol : frameCol; }
        return inGlassX ? P[spec.glass || 'glass'] : frameCol;
      },
      windows, glass: spec.glass, frame: spec.frame || spec.stripTone, reveal: spec.reveal,
    };
  }

  const SKINS = { pixel: skinPixel, bays: skinBays, storefront: skinStorefront, flat: skinFlat, mod4: skinMod4 };
  /**
   * A skin spec resolved for one piece of wall, plus the blades any skin
   * may carry: `fins` (its own pitch, any skin) and `pier` (the bay lines
   * of a `bays` or `flat` skin — skinBays sets `piers` itself). See blades().
   */
  function resolveSkin(sk, ctx, P, key) {
    const skin = SKINS[sk.kind](sk, ctx, P, key);
    if (APTS.fins && sk.fins) skin.fins = sk.fins;
    skin.facets = sk.facets;
    if (!APTS.piers) skin.piers = null;
    return skin;
  }

  /**
   * The floor lines of a band between z0 and z1, from the building's levels,
   * and — separately — the floor line just BELOW z0 when the band starts
   * within APTS.floorSlack of it. A band that starts between two floor lines
   * used to lose that storey's windows silently: `floorsBetween` dropped the
   * line and `windowsFromBays` never heard of it (26 West's todo 8, a
   * look-fix to find). Now the storey's windows are kept when the band
   * starts within the slack (the window is clipped to the band), dropped
   * beyond it, and the boot log names the band either way.
   */
  function floorsBetween(levels, z0, z1, where) {
    const out = [];
    let below = null;
    for (const z of levels) {
      if (z >= z0 - 1e-6 && z < z1 - 0.5) out.push(z);
      else if (z < z0 && (below == null || z > below)) below = z;
    }
    let floorBelow = null;
    if (below != null && !levels.some(z => Math.abs(z-z0) < 1e-3) && z0 - below > 1e-3 && levels.some(z => z > z0 + 1e-3)) {
      const kept = z0 - below <= APTS.floorSlack;
      if (kept) floorBelow = below;
      // one line per building and band start, not one per face: a band that
      // starts between floor lines does so on every face it is on
      warnOnce('floor|' + String(where).split('|')[0] + '|' + z0, where + ': band z0 ' + z0 + ' sits ' + (z0 - below).toFixed(2) + ' m above the floor line at ' + below
        + (kept ? ' — that storey\'s windows are kept and clipped to the band (APARTMENTS.floorSlack ' + APTS.floorSlack + ')' : ' — that storey\'s windows are DROPPED; start the band at the floor line or within APARTMENTS.floorSlack of it'));
    }
    return { floors: out, floorBelow };
  }

  // ── balconies ────────────────────────────────────────────────────────
  /**
   * A stack of projecting balconies on one wall: slab + three rails, every
   * floor in `floors`. Numbers from the building's JSON (slab width and
   * projection, slab thickness, rail height and thickness) — The Standard's
   * are js/westcampus.js's TIER4 read of Ext_01, carried over.
   */
  function balconyStack(B, W, spec, floors, P) {
    const s0 = spec.s0, s1 = spec.s1, proj = spec.proj || 1.15, t = spec.slabT || 0.28, rh = spec.railH || 0.95, rt = spec.railT || 0.06;
    const slab = P[spec.slabTone || 'slab'], rail = P[spec.railTone || 'rail'];
    function railing(a, b, d0, d1, z0, z1) {
      if (!(spec.railPitch > 0)) return box(B, W, a, b, d0, d1, z0, z1, rail, { back: true });
      const post = spec.railPost || rt;
      box(B, W, a, b, d0, d1, z1 - rt, z1, rail, { back: true });
      box(B, W, a, b, d0, d1, z0, z0 + rt, rail, { back: true });
      const along = b - a >= d1 - d0, length = along ? b - a : d1 - d0;
      const n = Math.max(1, Math.ceil(length / spec.railPitch));
      for (let i = 0; i <= n; i++) {
        const x = (length - post) * i / n;
        box(B, W, along ? a + x : a, along ? a + x + post : b,
          along ? d0 : d0 + x, along ? d1 : d0 + x + post,
          z0 + rt, z1 - rt, rail, { back: true });
      }
    }
    for (const fz of floors) {
      const z = fz + (spec.lift || 0);
      if (spec.inset > 0) {
        // AN INSET BALCONY (a loggia): the opening is cut into the wall by
        // openings() below — its sill strip is the loggia's floor, its head
        // the soffit, its jambs the reveals — and all that stands at the
        // face is the rail, on the floor of the recess. Nothing projects, so
        // the balcony reads as the shadowed void the photographs show (the
        // Villas on Guadalupe, 2819 Rio Grande) and not as a lit slab edge.
        railing(s0, s1, 0, rt, z, z + rh);
        count.balconies++;
        continue;
      }
      box(B, W, s0, s1, 0, proj, z, z + t, slab, { back: true });
      // rails: front, and the two returns; a thin box each
      railing(s0, s1, proj - rt, proj, z + t, z + t + rh);
      railing(s0, s0 + rt, 0, proj - rt, z + t, z + t + rh);
      railing(s1 - rt, s1, 0, proj - rt, z + t, z + t + rh);
      count.balconies++;
    }
  }

  // ── openings: a recess cut into a band's wall ────────────────────────
  //
  // A band's `openings` are the holes a skin cannot make: a garage mouth
  // (2706 Rio Grande's at u 6-14; Signature 1909's lit one on the west
  // front), an entry court, a leasing frontage under an overhang. Each is
  // `{ s0, s1 | w, z0?, z1?, d, tone? | glass?, lit? }` — `s` along the face
  // (an override piece's own s, like its balconies and signs), `z0`/`z1` in
  // metres (the band's when omitted), `d` the depth of the recess
  // (APARTMENTS.openingD when omitted). It is drawn by the tiler as an
  // opening with its OWN reveal depth and tone: the back wall `d` behind the
  // plane, the sill (the floor), the head (the soffit) and the two jambs
  // in `tone`, or — with `glass` — a pane in that glass with the reveals in
  // `tone` (the skin's frame tone otherwise), lit at night when `lit`. Any
  // window of the skin under the opening goes. An INSET BALCONY (a stack
  // with `inset: d`) is the same thing once per floor line, `h` tall
  // (the storey less the slab when omitted), with the rail drawn at the
  // face by balconyStack.
  function openings(skin, band, len, z0, z1, spec, fl, P, sOff) {
    if (!APTS.openings) return;
    const list = [];
    for (const o of band.openings || []) {
      const s0 = (o.s0 || 0) - sOff, s1 = (o.s1 != null ? o.s1 : (o.s0 || 0) + (o.w || 3.0)) - sOff;
      const oz0 = o.z0 != null ? o.z0 : z0, oz1 = o.z1 != null ? o.z1 : z1;
      list.push({ s0, s1, z0: Math.max(z0, oz0), z1: Math.min(z1, oz1), reveal: o.d != null ? o.d : APTS.openingD,
                  tone: o.glass || o.tone || 'wall', revealTone: o.glass ? (o.tone || null) : null, lit: !!(o.glass && o.lit), opening: true });
    }
    if (APTS.balconies) for (const bs of band.balconies || []) {
      if (!(bs.inset > 0)) continue;
      const b = Object.assign({}, spec.balcony || {}, bs);
      const floors = fl.floors;
      for (let i = 0; i < floors.length; i++) {
        const fz = floors[i] + (b.lift || 0);
        const next = i + 1 < floors.length ? floors[i + 1] : z1;
        const h = b.h != null ? b.h : (next - floors[i]) - (b.slabT || 0.28);
        list.push({ s0: b.s0 - sOff, s1: b.s1 - sOff, z0: fz, z1: Math.min(z1, fz + h), reveal: b.inset,
          tone: b.insetGlass || b.insetTone || 'wall', revealTone: b.insetGlass ? b.insetTone : undefined,
          lit: !!b.insetLit, opening: true });
      }
    }
    if (!list.length) return;
    const inside = list.filter(o => o.s1 > 0 && o.s0 < len && o.z1 > o.z0 + 0.02);
    if (!inside.length) return;
    skin.windows = (skin.windows || []).filter(w => !inside.some(o => w.s1 > o.s0 && w.s0 < o.s1 && w.z1 > o.z0 && w.z0 < o.z1));
    for (const o of inside) skin.windows.push(o);
    count.openings += inside.length;
  }

  // ── canopies: a slab standing off a wall ─────────────────────────────
  //
  // `canopies` on a band: `[{ s0, s1, z, d, t?, tone, soffitTone?, off?,
  // posts? }]` — a slab `d` metres out from the wall (from `off`, a gap,
  // when the slab does not touch it), `t` thick (APARTMENTS.canopyT) with
  // its top edge at `z`, in `tone`; its UNDERSIDE in `soffitTone` when that
  // is given (GrandMarc's two awnings, 3.85 and 3.60 m, which were boxes in
  // `deck` standing against the wall; Skyloft's sky-lounge soffit). `posts:
  // { pitch | at, w, tone, z0? }` stand under its outer edge from `z0` (0).
  function canopy(B, W, spec, P) {
    const s0 = spec.s0, s1 = spec.s1 != null ? spec.s1 : spec.s0 + (spec.w || 3.0), d = spec.d || 1.0, t = spec.t != null ? spec.t : APTS.canopyT, off = spec.off || 0;
    const zTop = spec.z, z0 = zTop - t;
    if (s1 - s0 < 0.02 || d <= 0 || t <= 0) return;
    const col = toneOf(P, spec.tone, 'coping'), soffit = spec.soffitTone ? P[spec.soffitTone] || col : null;
    box(B, W, s0, s1, off, off + d, z0, zTop, col, { back: off <= 1e-6, bottom: !!soffit });
    if (soffit) B.quad(W.at(s0, off, z0), W.at(s0, off + d, z0), W.at(s1, off + d, z0), W.at(s1, off, z0), soffit, [0, 0, -1]);
    count.soffits += soffit ? 1 : 0;
    const PS = spec.posts;
    if (PS) {
      const w = PS.w || 0.3, pcol = toneOf(P, PS.tone, spec.tone, 'coping'), pz0 = PS.z0 || 0;
      for (const c of bladeCentres(Object.assign({ from: s0, to: s1 }, PS), s1 - s0)) box(B, W, c - w / 2, c + w / 2, off + d - w, off + d, pz0, z0, pcol, { top: true });
    }
    count.canopies++;
  }

  // ── signs ────────────────────────────────────────────────────────────
  /** Dot-matrix lettering on a wall; horizontal (reads along s) or vertical (letters stacked, top first). */
  function sign(B, W, spec, P) {
    const dot = spec.dot || APTS.signDot, gap = spec.gap != null ? spec.gap : dot;   // letter gap
    const col = P[spec.tone || 'sign'];
    const text = (spec.text || '').toUpperCase();
    const proud = APTS.signProud;
    const letterW = 5 * dot, letterH = 7 * dot;
    // A GRAPHIC MARK. `bitmap: ['0110...', ...]` — rows top to bottom, any
    // width, '1' a dot — is drawn as one glyph at `dot` in place of `text`
    // (the Union 'U' on its pylon, 2400 Nueces' logo panel, a two-pronged
    // mark no font has): `s0`, `z0` its low-s foot as for text, or `s` and
    // `zTop` centred and hanging as for a vertical sign.
    if (Array.isArray(spec.bitmap) && spec.bitmap.length) {
      const rows = spec.bitmap.map(String), gh = rows.length, gw = Math.max(...rows.map(r => r.length));
      const rd0 = (-W.N[1] * W.T[0] + W.N[0] * W.T[1]) >= 0 ? 1 : -1;
      const sStart = spec.s != null ? spec.s - rd0 * gw * dot / 2 : (rd0 > 0 ? spec.s0 : spec.s0 + gw * dot);
      const zTop = spec.zTop != null ? spec.zTop : spec.z0 + gh * dot;
      let n0 = 0;
      for (let r = 0; r < gh; r++) for (let c = 0; c < gw; c++) {
        if (rows[r][c] !== '1') continue;
        const sa = sStart + rd0 * c * dot, z1 = zTop - r * dot;
        box(B, W, Math.min(sa, sa + rd0 * dot), Math.max(sa, sa + rd0 * dot), 0, proud, z1 - dot, z1, col, { back: true }); n0++;
      }
      count.signs++;
      return n0;
    }
    // READING DIRECTION. A viewer in front of the wall (on its +N side) looks
    // along -N, and their right hand points along (-N) x up = (-N.y, N.x).
    // Whether that is +T or -T depends on the plan's winding, so text is laid
    // along `rd`, never blindly along +T — the first render spelt the name
    // backwards on both faces of the corner bay.
    const rd = (-W.N[1] * W.T[0] + W.N[0] * W.T[1]) >= 0 ? 1 : -1;
    const cell = (sa, sb, z0, z1) => box(B, W, Math.min(sa, sb), Math.max(sa, sb), 0, proud, z0, z1, col, { back: true });
    let n = 0;
    if (spec.vertical) {
      // letters stacked down from zTop, each letter upright and reading left to right, centred on s
      const sc = spec.s;
      if (spec.back) box(B, W, sc - spec.back.w / 2, sc + spec.back.w / 2, 0, proud * 0.4, spec.zTop - text.length * (letterH + gap) + gap - spec.back.pad, spec.zTop + spec.back.pad, P[spec.back.tone], { back: true });
      let z = spec.zTop;
      for (const ch of text) {
        const g = glyph(ch);
        for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) {
          if (g[r][c] !== '1') continue;
          const s0 = sc + rd * (-letterW / 2 + c * dot), z1 = z - r * dot;
          cell(s0, s0 + rd * dot, z1 - dot, z1); n++;
        }
        z -= letterH + gap;
      }
    } else {
      // `s0` is the low-s edge of the text block; the text reads along rd from whichever end that makes its start
      const zb = spec.z0;
      const width = text.length * (letterW + gap) - gap;
      let s = rd > 0 ? spec.s0 : spec.s0 + width;
      for (const ch of text) {
        const g = glyph(ch);
        for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) {
          if (g[r][c] !== '1') continue;
          const s0 = s + rd * c * dot, z1 = zb + letterH - r * dot;
          cell(s0, s0 + rd * dot, z1 - dot, z1); n++;
        }
        s += rd * (letterW + gap);
      }
    }
    count.signs++;
    return n;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  PITCHED ROOFS — a rig for js/slopes-roofs.js's emitter
  // ══════════════════════════════════════════════════════════════════════
  //
  // Nine buildings came in with their hips as stacks of inset boxes — five
  // to twenty-three steps each, a ziggurat that reads as a slope from 220 m
  // and as stairs from the street (the Villas: "about 120 boxes"; San
  // Jacinto: "23 inset boxes plus a ridge course"). A block's `roof` is the
  // real thing: the eave profile is solved by the same straight-skeleton
  // port the roofs bake uses (wallProfile above), packed into that bake's
  // own rig schema, and handed to slopesRoofs.emit() — the way
  // js/slopes-dome.js draws the Capitol's wings — so a hip is two planes and
  // a ridge, a pyramid four planes and a point, an L two ridges meeting over
  // a valley, and every strip is a `facet` shaded the way the campus roofs
  // are. Nothing here is typed for a building: the pitch, the overhang, the
  // fascia and the tones are the file's.
  //
  //   roof: { kind: 'hip' | 'gable',
  //           pitch: degrees (APARTMENTS.roof.pitch),
  //           over: m of eave overhang beyond the wall (0),
  //           lipH: m of fascia at the eave (APARTMENTS.roof.lipH when over > 0),
  //           tone, lipTone: the roof's and the fascia's colours (roofTone / lipTone or 'coping'),
  //           deck: tone — the slope stops `d` metres in from the eave and a
  //                 flat deck of this tone fills the middle (Regents West's
  //                 mitred cap round a membrane roof); d: that depth,
  //           inset: m the eave stands inside the wall (a roof behind a parapet),
  //           base: the eave height (the block's z1),
  //           gable: [face keys] — for 'gable', the edges that rise as walls
  //                  (a rectangle's two short edges when omitted); gableTone,
  //           sides: [face keys] — only these edges slope; the others STAND:
  //                  on a full hip a standing edge is a gable end, on a deck
  //                  roof it is the deck's own vertical edge (a shingle band
  //                  round three sides of a membrane roof, the fourth facing
  //                  a courtyard) }
  //
  // A roofItem may carry a `roof` too — `{ plan, h, tone, roof }` is a box
  // `h` tall with that roof on it (2706 Rio Grande's two hipped masses on
  // the wing's plate, the Villas' bay caps, 26 West's turret caps) — drawn
  // by the same rig with the item's plan and the box's top as the eave.
  //
  // The rig: pts and rays in longitude/latitude (dpm [1, 1], so the emitter's
  // toLocal lands each point where frameFor puts the walls), caps and d in
  // metres, rise = tan(pitch) * d. A full hip's d is the deepest cap, so the
  // ridge is as high as the roof is wide at that place and every point stops
  // at its own — the emitter's own rule for a rig with no deck. A gable end's
  // two corners slide along the long walls instead of the mitre (the roofs
  // file's gableEnd, done here on the rays), leaning APARTMENTS.roof.gableLean
  // in over the rise so the strip the emitter still draws on that edge stands
  // behind the gable wall this file draws in wall tone.

  /** the two shortest edges of a ring: a rectangle's gable ends */
  function shortestEdges(poly, n) {
    const L = poly.map((p, i) => { const q = poly[(i + 1) % poly.length]; return [Math.hypot(q[0] - p[0], q[1] - p[1]), i]; });
    return L.sort((a, b) => a[0] - b[0]).slice(0, n).map(x => x[1]);
  }

  /**
   * Build one block's roof rig and emit it. `planUV` is the block's plan in
   * the frame, `keys` its face keys in plan order, `F` the building frame.
   * Returns the record the boot log and the gate read, or null.
   */
  function roofOf(B, spec, blk, F, planUV, keys, P, zTop) {
    const R = blk.roof;
    const Roofs = window.slopesRoofs;
    if (!R || !Roofs || !Roofs.emit) { if (R) warnOnce('roof|' + spec.name, spec.name + ' ' + blk.id + ': a roof needs js/slopes-roofs.js on the page'); return null; }
    const kind = R.kind || 'hip';
    const pitch = (R.pitch != null ? R.pitch : APTS.roof.pitch) * Math.PI / 180;
    // the ring, interior to the left, with each edge's face key carried through the reversal
    let ring = planUV.map(p => [p[0], p[1]]), ekeys = keys.slice();
    if (R.inset > 0) { const off = offsetRing(ring, R.inset); if (off) { if (ringArea(ring) < 0) ekeys = ekeys.map((_, i, a) => a[(a.length - 2 - i + a.length) % a.length]); ring = off; } }
    else if (ringArea(ring) < 0) { ring = ring.slice().reverse(); ekeys = ekeys.map((_, i, a) => a[(a.length - 2 - i + a.length) % a.length]); }
    // consecutive duplicate points (a footprint traced with a closing repeat) break the mitre
    ring = ring.filter((p, i) => Math.hypot(p[0] - ring[(i + 1) % ring.length][0], p[1] - ring[(i + 1) % ring.length][1]) > 0.02);
    if (ring.length < 3) return null;
    const n = ring.length;
    // the standing edges: a gable's ends, or everything `sides` leaves out
    const gableEdges = new Set();
    if (R.sides) { const want = new Set(R.sides.map(String)); ekeys.forEach((k, i) => { if (!want.has(String(k))) gableEdges.add(i); }); }
    else if (kind === 'gable') {
      const want = R.gable ? new Set(R.gable.map(String)) : null;
      if (want) ekeys.forEach((k, i) => { if (want.has(String(k))) gableEdges.add(i); });
      else for (const i of shortestEdges(ring, 2)) gableEdges.add(i);
    }
    if (gableEdges.size >= n) { warnOnce('roof|' + spec.name + '|' + blk.id, spec.name + ' ' + blk.id + ': every edge stands; no roof'); return null; }
    const prof = wallProfile(ring, 60, kind !== 'gable');
    if (!prof) { warnOnce('roof|' + spec.name + '|' + blk.id, spec.name + ' ' + blk.id + ': the plan has a degenerate corner; no roof'); return null; }
    const rays = prof.rays.map(v => v.slice()), caps = prof.caps.slice();
    // a gable end: its two corners travel along the neighbouring walls' inward normals, leaning in a little
    const inward = i => { const a = ring[i], b = ring[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1; return [-dy / L, dx / L]; };
    if (gableEdges.size) {
      const dmax = Math.max(60, prof.maxCap * 2);
      // a corner on a standing edge slides along that edge, driven by the
      // sloping neighbour's offset; between two standing edges it stays put
      for (const i of gableEdges) {
        const j = (i + 1) % n, prev = (i - 1 + n) % n;
        const kA = prof.spans[i][0], kB = prof.spans[j][0];
        const nPrev = inward(prev), nNext = inward(j);
        rays[kA] = gableEdges.has(prev) ? [0, 0] : [nPrev[0], nPrev[1]];
        rays[kB] = gableEdges.has(j) ? [0, 0] : [nNext[0], nNext[1]];
        caps[kA] = Math.hypot(rays[kA][0], rays[kA][1]) > 0 ? capAlong(ring[i], rays[kA], ring, dmax) : 0;
        caps[kB] = Math.hypot(rays[kB][0], rays[kB][1]) > 0 ? capAlong(ring[j], rays[kB], ring, dmax) : 0;
      }
      // a gable end (no deck) leans APARTMENTS.roof.gableLean inward by the
      // time its corners reach their caps, so the emitter's strip on that
      // edge stands behind the wall drawn below; a deck roof's standing edge
      // is the deck's own vertical face and stays plumb
      if (!R.deck) for (const i of gableEdges) {
        const j = (i + 1) % n, nIn = inward(i);
        for (const k of [prof.spans[i][0], prof.spans[j][0]]) {
          if (caps[k] <= 0) continue;
          const lean = APTS.roof.gableLean / caps[k];
          rays[k] = [rays[k][0] + nIn[0] * lean, rays[k][1] + nIn[1] * lean];
        }
      }
    }
    const dUse = R.deck ? Math.max(0.05, R.d || 1.0) : Math.max(...caps.map((c, k) => Math.min(c, 1e6)));
    const rise = Math.tan(pitch) * dUse;
    const base = R.base != null ? R.base : zTop;
    const over = R.over || 0;
    const lipH = over > 0 || R.lipH ? (R.lipH != null ? R.lipH : APTS.roof.lipH) : 0;
    const roofCol = toneOf(P, R.tone, blk.roofTone, 'roof');
    const lipCol = over > 0 || R.lipH ? (P[R.lipTone || 'coping'] || roofCol) : null;
    // `soffitTone`: the overhang's UNDERSIDE in its own material. The emitter
    // draws an eave lip's top, fascia and soffit in one colour, so a roof
    // that asks for a soffit tone gets no lip from the emitter (`lip: null`)
    // and this file draws the three itself from the same profile — the top
    // and the fascia in the lip tone, the soffit in this one. Moody Center's
    // 70,000 sq ft of wood-composite soffit under a dark bronze fascia.
    const soffitCol = lipCol && R.soffitTone ? (P[R.soffitTone] || null) : null;
    // longitude/latitude for the emitter (its dpm is [1, 1]); a ray is the frame's linear map of a metre vector
    const ll = (u, v) => F.ll(u, v);
    const o = ll(0, 0);
    const rayLL = r => { const q = ll(r[0], r[1]); return [q[0] - o[0], q[1] - o[1]]; };
    const entry = {
      name: spec.name + ' ' + blk.id, dpm: [1, 1],
      pts: prof.pts.map(p => ll(p[0], p[1])), rays: rays.map(rayLL), caps, spans: prof.spans,
      d: dUse, run: dUse, rise, base, steps: 0, col: roofCol, lip: soffitCol ? null : lipCol, deck: R.deck ? (P[R.deck] || roofCol) : null,
    };
    const interior = [...gableEdges];
    const before = B.triangles;
    Roofs.emit(B, { meta: { lip: lipH, over, pitch: Math.tan(pitch) }, roofs: { [blk.id]: entry } }, { lines: false, interior });
    if (soffitCol) {
      // the lip, as the emitter would draw it (roofOne step 1), with its own soffit colour
      const M = prof.pts.length, zLip = base + lipH;
      const skipLip = new Set();
      for (const i of gableEdges) { const sp = prof.spans[i]; if (sp) for (let k = sp[0]; k < sp[1]; k++) skipLip.add(k % M); }
      const capAt = (k, d) => { const c = Math.min(d, caps[k]); return [prof.pts[k][0] + rays[k][0] * c, prof.pts[k][1] + rays[k][1] * c]; };
      const eaveAt = k => [prof.pts[k][0] - rays[k][0] * over, prof.pts[k][1] - rays[k][1] * over];
      for (let k = 0; k < M; k++) {
        const j = (k + 1) % M;
        if (skipLip.has(k)) continue;
        const ek = eaveAt(k), ej = eaveAt(j), wk = capAt(k, 0), wj = capAt(j, 0);
        const dx = ej[0] - ek[0], dy = ej[1] - ek[1], L = Math.hypot(dx, dy) || 1;
        const o3 = F.at(ek[0] + dy / L, ek[1] - dx / L, 0), o0 = F.at(ek[0], ek[1], 0);   // outward: right of the CCW edge
        const outward = [o3[0] - o0[0], o3[1] - o0[1], 0];
        B.quad(F.at(ek[0], ek[1], zLip), F.at(ej[0], ej[1], zLip), F.at(wj[0], wj[1], zLip), F.at(wk[0], wk[1], zLip), lipCol, [0, 0, 1]);
        B.quad(F.at(ek[0], ek[1], base), F.at(ej[0], ej[1], base), F.at(ej[0], ej[1], zLip), F.at(ek[0], ek[1], zLip), lipCol, outward);
        B.quad(F.at(wk[0], wk[1], base), F.at(wj[0], wj[1], base), F.at(ej[0], ej[1], base), F.at(ek[0], ek[1], base), soffitCol, [0, 0, -1]);
      }
      count.soffits++;
    }
    // the gable walls: the wall's top edge, then the roof's profile along it, in wall tone (a deck roof's standing edge is the rig's own fin)
    const gableCol = toneOf(P, R.gableTone, 'wall');
    for (const i of (R.deck ? [] : gableEdges)) {
      const j = (i + 1) % n, kA = prof.spans[i][0], kB = prof.spans[j][0];
      const a = ring[i], b = ring[j];
      const zLip = base + lipH;
      const capA = Math.min(caps[kA], dUse), capB = Math.min(caps[kB], dUse);
      const topA = [a[0] + prof.rays[kA][0] * 0 + (b[0] - a[0]) / Math.hypot(b[0] - a[0], b[1] - a[1]) * capA, a[1] + (b[1] - a[1]) / Math.hypot(b[0] - a[0], b[1] - a[1]) * capA];
      const topB = [b[0] - (b[0] - a[0]) / Math.hypot(b[0] - a[0], b[1] - a[1]) * capB, b[1] - (b[1] - a[1]) / Math.hypot(b[0] - a[0], b[1] - a[1]) * capB];
      const nOut = inward(i).map(v => -v);
      const pts = [F.at(a[0], a[1], base - 0.01), F.at(b[0], b[1], base - 0.01), F.at(topB[0], topB[1], zLip + Math.tan(pitch) * capB), F.at(topA[0], topA[1], zLip + Math.tan(pitch) * capA)];
      const T = [pts[1][0] - pts[0][0], pts[1][1] - pts[0][1], 0], LT = Math.hypot(T[0], T[1]) || 1;
      const want = [-T[1] / LT, T[0] / LT, 0];
      const o3 = F.at(a[0] + nOut[0], a[1] + nOut[1], 0), o0 = F.at(a[0], a[1], 0);
      const wantOut = [o3[0] - o0[0], o3[1] - o0[1], 0];
      B.polygon(pts, gableCol, wantOut, 'xy');
    }
    count.roofs++;
    return { block: blk.id, kind, pitch: R.pitch != null ? R.pitch : APTS.roof.pitch, eave: base, ridgeZ: base + lipH + rise, rise, d: dUse, over, deck: !!R.deck, triangles: B.triangles - before };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  ONE BUILDING
  // ══════════════════════════════════════════════════════════════════════

  /** the outline's edges as wall frames, outward = away from the polygon's interior */
  function ringWalls(F, ringUV) {
    // signed area: CCW > 0 means the interior is to the LEFT of each edge, so outward is to the right
    let A = 0;
    for (let i = 0; i < ringUV.length; i++) { const p = ringUV[i], q = ringUV[(i + 1) % ringUV.length]; A += p[0] * q[1] - q[0] * p[1]; }
    const outward = A > 0 ? -1 : 1;
    const walls = [];
    for (let i = 0; i < ringUV.length; i++) {
      const a = ringUV[i], b = ringUV[(i + 1) % ringUV.length];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.05) continue;
      walls.push(wallFrame(F, a, b, outward));
    }
    return walls;
  }

  /**
   * A rectangle's four walls, outward, keyed by the side each faces: v0 (the
   * wall on the v0 edge, running from u1 to u0 so s = 0 is its u1 end), u0
   * (v0 -> v1), v1 (u0 -> u1), u1 (v1 -> v0). The ring is [u1,v0] [u0,v0]
   * [u0,v1] [u1,v1]; ringWalls picks outward from that winding.
   */
  const RECT_SIDES = ['v0', 'u0', 'v1', 'u1'];
  function rectRing(r) { const [u0, u1, v0, v1] = r; return [[u1, v0], [u0, v0], [u0, v1], [u1, v1]]; }
  function rectWalls(F, r) {
    const walls = ringWalls(F, rectRing(r));
    const out = {};
    RECT_SIDES.forEach((k, i) => { out[k] = walls[i]; });
    return out;
  }

  /** the (s) range of a wall that lies inside a (u, v) region, for axis-parallel walls; null if none */
  function clipWall(W, region) {
    const [ru0, ru1, rv0, rv1] = region;
    const pts = [W.a, W.b];
    const inU = t => t >= ru0 - 1e-6 && t <= ru1 + 1e-6, inV = t => t >= rv0 - 1e-6 && t <= rv1 + 1e-6;
    if (Math.abs(W.dir[1]) < 1e-6) {          // runs along u at v = a[1]
      if (!inV(W.a[1])) return null;
      const s = [(ru0 - W.a[0]) / W.dir[0], (ru1 - W.a[0]) / W.dir[0]].sort((x, y) => x - y);
      const s0 = Math.max(0, s[0]), s1 = Math.min(W.L, s[1]);
      return s1 > s0 + 0.05 ? [s0, s1] : null;
    }
    if (Math.abs(W.dir[0]) < 1e-6) {          // runs along v at u = a[0]
      if (!inU(W.a[0])) return null;
      const s = [(rv0 - W.a[1]) / W.dir[1], (rv1 - W.a[1]) / W.dir[1]].sort((x, y) => x - y);
      const s0 = Math.max(0, s[0]), s1 = Math.min(W.L, s[1]);
      return s1 > s0 + 0.05 ? [s0, s1] : null;
    }
    const m = [(W.a[0] + W.b[0]) / 2, (W.a[1] + W.b[1]) / 2];
    return inU(m[0]) && inV(m[1]) ? [0, W.L] : null;
  }

  /**
   * Draw one wall from z0 to z1 with a list of bands (each a skin over a z
   * range), for the part s0..s1 of it.
   */
  function drawWall(B, F, W, s0, s1, bands, spec, P, key, opts) {
    const len = s1 - s0;
    if (len < 0.05) return;
    opts = opts || {};
    // a sub-frame starting at s0 so skins see s from 0
    const sub = { at: (s, d, z) => W.at(s0 + s, d, z), T: W.T, N: W.N, L: len, a: W.a, b: W.b, dir: W.dir, n: W.n };
    // a raking plane through this wall (a rake block's flank): the half-space
    // A·u + B·v + C·z + D ≥ 0 in the building's frame, carried into the
    // piece's own (s, z) so the tiler can clip its cells to it
    // a band's openings and inset balconies are placed like its balconies and
    // signs: `s` along the FACE for the face's own bands (drawn per piece
    // here, so the piece's start is taken off), along the piece for an override's
    const sOff = opts.fixtures === false ? s0 : 0;
    const cutAt = opts.clip ? (sOff => { const H = opts.clip, u0 = W.a[0] + W.dir[0] * (s0 + sOff), v0 = W.a[1] + W.dir[1] * (s0 + sOff);
      return { a: H[0] * W.dir[0] + H[1] * W.dir[1], b: H[2], c: H[0] * u0 + H[1] * v0 + H[3] }; }) : null;
    for (const band of bands) {
      const z0 = band.z0, z1 = band.z1;
      if (z1 - z0 < 0.05) continue;
      const sk = spec.skins[band.skin];
      if (!sk) { warnOnce('skin|' + key + '|' + band.skin, key + ': no skin "' + band.skin + '"'); continue; }
      const fl = floorsBetween(spec.levels.floors, z0, z1, key + ' ' + band.skin);
      const d = insetOf(band);
      if (d > 0) { recess(B, sub, len, band, d, sk, spec, P, key, Object.assign({ cutAt, sOff }, opts), fl); continue; }
      const ctx = { len, z0, z1, floors: fl.floors, floorBelow: fl.floorBelow, allFloors: spec.levels.floors, key: key + '|' + band.skin, band };
      const skin = resolveSkin(sk, ctx, P, ctx.key);
      openings(skin, band, len, z0, z1, spec, fl, P, sOff);
      tileFace(B, { W: sub, len, z0, z1, cut: cutAt ? cutAt(0) : null }, skin, P);
    }
    // the fixtures — balconies and signs — positioned by `s` along THIS
    // piece: an override region's own. A face's default bands' fixtures are
    // drawn by wallFixtures on the whole wall instead, never per piece.
    if (!opts || opts.fixtures !== false) wallFixtures(B, sub, bands, spec, P, key);
  }

  // ── recesses ─────────────────────────────────────────────────────────
  //
  // A band's `inset` (metres; or `{ d, tone, columns }`) puts that band's
  // wall behind the face plane by the measured distance: a ground floor set
  // back under an oversailing podium on columns (Union on 24th, 2.4 m; The
  // Castilian, about 2 m; 21 Rio), a loggia (Union's L6 court glazing, 3.3 m
  // behind the tower face), a recessed balcony run (The Block on Rio, the
  // Villas). The wall is tiled by the band's own skin as usual, just on a
  // frame `d` behind the plane, and what closes the recess is drawn round
  // it: the SOFFIT at the band's top (facing down), the FLOOR at its foot
  // when that is above the block's own foot (a loggia's slab), and at each
  // end either a RETURN — a wall across the recess, on the neighbouring
  // face's plane, where that neighbour is not recessed at the same band —
  // or nothing, where it is: two faces recessed by the same depth over the
  // same band meet at the mitre of their offset lines, the recessed walls
  // shortened to it, so an open corner on columns is open round the corner.
  // A neighbour recessed by a different depth meets at the two offset
  // lines' intersection; along one wall (an override piece next to the
  // face's own bands) the step between depths is a jog return. `columns`
  // stand on the face line under the soffit: `{ pitch | at: [s...], w, d,
  // tone }`, one box each from floor to soffit.
  //
  // The corner arithmetic, for wall i leaving corner O with direction di
  // and outward normal ni after wall p (dp, np), both recessed (d, dN): the
  // point on i's offset line that lies on p's is s along the wall with
  //     s = (d (ni . np) - dN) / (di . np)
  // (a right angle: s = dN; a straight run: di . np = 0, no shortening),
  // and by symmetry the wall ends t = (dN - d (ni . nn)) / (di . nn) short
  // of its far corner. With dN = 0 the wall runs to the neighbour's plane
  // and the return closes it there.
  const insetOf = band => band && band.inset != null ? (typeof band.inset === 'number' ? band.inset : (band.inset.d || 0)) : 0;
  const insetSpec = band => (band && typeof band.inset === 'object') ? band.inset : {};
  const sameBand = (a, b) => Math.abs(a.z0 - b.z0) < 1e-3 && Math.abs(a.z1 - b.z1) < 1e-3;
  /** how far the recessed wall's end sits from this end of the piece, and whether a return closes it there */
  function recessEnd(end, band, d, high) {
    if (!end || !end.bands) return { s: 0, ret: true, from: 0 };
    const nb = end.bands.find(b => sameBand(b, band) && insetOf(b) > 0);
    const dN = nb ? insetOf(nb) : 0;
    if (end.kind === 'straight' || Math.abs(end.dot) < 1e-6) {
      return Math.abs(dN - d) < 1e-3 ? { s: 0, ret: false, from: dN } : { s: 0, ret: true, from: dN };
    }
    // a corner: end.dot = di . n_other, end.nn = ni . n_other (the walls' outward normals)
    const sh = high ? (dN - d * end.nn) / end.dot : (d * end.nn - dN) / end.dot;
    return { s: sh, ret: dN <= 1e-3, from: 0 };
  }
  function recess(B, W, len, band, d, sk, spec, P, key, opts, fl) {
    const z0 = band.z0, z1 = band.z1;
    const IS = insetSpec(band);
    const tone = toneOf(P, IS.tone, band.insetTone, sk.field, sk.fasciaTone, 'wall');
    const lo = recessEnd(opts.lo, band, d, false), hi = recessEnd(opts.hi, band, d, true);
    const sLo = Math.max(0, lo.s), sHi = Math.min(len, len - hi.s);
    const T = W.T, nT = [-T[0], -T[1], 0];
    // the wall, on a frame d behind the plane and starting at sLo
    if (sHi - sLo > 0.05) {
      const subR = { at: (s, dd, z) => W.at(sLo + s, dd - d, z), T: W.T, N: W.N, L: sHi - sLo, a: W.a, b: W.b, dir: W.dir, n: W.n };
      const ctx = { len: sHi - sLo, z0, z1, floors: fl.floors, floorBelow: fl.floorBelow, allFloors: spec.levels.floors, key: key + '|' + band.skin, band };
      const skin = resolveSkin(sk, ctx, P, ctx.key);
      openings(skin, band, sHi - sLo, z0, z1, spec, fl, P, (opts.sOff || 0) + sLo);
      tileFace(B, { W: subR, len: sHi - sLo, z0, z1, cut: opts.cutAt ? opts.cutAt(sLo) : null }, skin, P);
    }
    // the returns: a wall across the recess at either end, where nothing recessed meets it
    if (APTS.insetReturns) {
      if (lo.ret) B.quad(W.at(0, -lo.from, z0), W.at(lo.s, -d, z0), W.at(lo.s, -d, z1), W.at(0, -lo.from, z1), tone, T);
      if (hi.ret) B.quad(W.at(len, -hi.from, z0), W.at(len - hi.s, -d, z0), W.at(len - hi.s, -d, z1), W.at(len, -hi.from, z1), tone, nT);
    }
    // the soffit at the top, the floor at the foot when the band starts above the block's foot
    if (APTS.insetSoffit) {
      const ring = zz => [W.at(0, 0, zz), W.at(len, 0, zz), W.at(len - hi.s, -d, zz), W.at(lo.s, -d, zz)];
      B.polygon(ring(z1), tone, [0, 0, -1], 'xy');
      if (opts.blockZ0 == null || z0 > opts.blockZ0 + 0.01) B.polygon(ring(z0), tone, [0, 0, 1], 'xy');
    }
    // the columns, on the face line
    const C = IS.columns || band.columns;
    if (C) {
      const w = C.w || 0.5, cd = C.d || w, ctone = toneOf(P, C.tone, IS.tone) || tone;
      let at = C.at;
      if (!at) {
        // `pitch` metres apart: on the bay centres, or with `on: 'joints'` on
        // the bay lines including both ends (Union's L6 loggia: a square
        // column on every bay line of the court face)
        const pitch = C.pitch || 5.0, from = C.from || 0, to = C.to != null ? C.to : len;
        const n = Math.max(1, Math.round((to - from) / pitch)), mod = (to - from) / n;
        at = [];
        if (C.on === 'joints') for (let i = 0; i <= n; i++) at.push(from + i * mod);
        else for (let i = 0; i < n; i++) at.push(from + (i + 0.5) * mod);
      }
      for (const c of at) box(B, W, c - w / 2, c + w / 2, -cd, 0, z0, z1, ctone, { top: true, bottom: true });
    }
    count.insets++;
  }

  /**
   * The balconies and signs riding a list of bands, on frame W with `s`
   * measured along it. Called ONCE per wall for the face's own bands — an
   * override cuts a wall into pieces and every piece redraws the face's
   * bands, so a sign drawn inside drawWall was drawn once per piece: THE
   * MARK five times across one block, overlapping into gibberish (The Mark's
   * look-fix 1 moved its signs into regions of their own to dodge it). A
   * balcony stack had the same defect and the same fix.
   */
  function wallFixtures(B, W, bands, spec, P, key, cut) {
    for (const band of bands) {
      if (band.z1 - band.z0 < 0.05) continue;
      const hasB = APTS.balconies && band.balconies && band.balconies.length, hasS = APTS.signs && band.signs && band.signs.length;
      const hasF = APTS.fins && band.fins, hasC = APTS.canopies && band.canopies && band.canopies.length;
      if (!hasB && !hasS && !hasF && !hasC) continue;
      const floors = floorsBetween(spec.levels.floors, band.z0, band.z1, key + ' ' + band.skin).floors;
      const d = insetOf(band);
      const Wb = d > 0 ? { at: (s, dd, z) => W.at(s, dd - d, z), T: W.T, N: W.N, L: W.L, a: W.a, b: W.b, dir: W.dir, n: W.n } : W;
      if (hasB) for (const bs of band.balconies) balconyStack(B, Wb, Object.assign({}, spec.balcony || {}, bs), floors, P);
      if (hasS) for (const sg of band.signs) sign(B, Wb, sg, P);
      // a band's own fins: on the whole face at their pitch (a skin's ride on each piece with the skin)
      if (hasF) for (const fs of Array.isArray(band.fins) ? band.fins : [band.fins]) blades(B, Wb, fs, W.L, band.z0, band.z1, P, cut || null);
      if (hasC) for (const c of band.canopies) canopy(B, Wb, c, P);
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  //  A RAKED FACE — one wall of a block leans
  // ══════════════════════════════════════════════════════════════════════
  //
  // Villas on Rio's north arm is roofed by one raking glass plane, from an
  // eave at 24.2 m on West 22nd Street to the tower's face at 54.95 m,
  // 20.74 m back: pitch 56.0°. It came in as TWENTY blocks of run 1.037 m
  // and rise 1.538 m — the treads collinear, a 1.54 m sawtooth on the
  // silhouette, every flank sliver rounded to one bay so the openings landed
  // at 2.07 m where the building's are 3.20 — because only a block's roof
  // could slope, and the gable code degenerates when a standing edge's own
  // corner travels along that edge. That is the "everything is stacked flat
  // pieces" defect back one level down, inside a wall.
  //
  // `rake: { face, run?, ... }` on a block leans the named face: its FOOT is
  // that edge of the plan at z0, its HEAD the same edge moved `run` metres
  // into the block at z1 (the plan's whole depth behind the edge when `run`
  // is omitted — a pure wedge), and the plane between them is ONE surface,
  // tiled by the face's own bands as any wall is. The tiler works in the
  // plane's own metres: s along the foot line, t up the slope, d out of it,
  // so a skin's module (a 1.55 m mullion, a 2.8 m louvre pitch) is the right
  // size in metres on the leaning surface; a band's z0/z1 are given in
  // metres of height as everywhere else and land where those heights cut
  // the plane, and so do the building's floor lines (windows and floor
  // bands sit where the floors meet the glass). The other walls of the
  // block — the flanks the plane cuts through, the wall opposite — are
  // tiled as usual and CLIPPED to the wedge: the tiler cuts each cell at
  // the plane and drops any opening the line would cross, so the flank is
  // a trapezoid in one skin at the building's own bay, and the roof cap
  // covers only what is left beyond the head. A parapet stops at the head
  // line. Overrides and fixtures on the raked face itself are not applied
  // (the face's bands are), and a `roof` on a raked block is ignored.
  //
  // The plane's outward normal has a z component (cos 56° for the Villas),
  // so it is lit by MapLibre's formula as a slope, and it is not a facet:
  // it is glass, not tile, and takes the real light on the real angle.
  function rakeOf(spec, blk, planUV, keys, walls, F) {
    const R = blk.rake;
    const isRect = Array.isArray(blk.plan) && blk.plan.length === 4 && typeof blk.plan[0] === 'number';
    const fk = String(R.face != null ? R.face : (isRect ? 'u0' : '0'));
    const i = keys.indexOf(fk);
    if (i < 0 || !walls[i]) { warnOnce('rake|' + spec.name + '|' + blk.id, spec.name + ' ' + blk.id + ': rake.face "' + fk + '" is not a face of the plan; drawn plumb'); return null; }
    const W = walls[i];
    const inward = [-W.n[0], -W.n[1]];
    let depth = 0;
    for (const p of planUV) depth = Math.max(depth, (p[0] - W.a[0]) * inward[0] + (p[1] - W.a[1]) * inward[1]);
    const run = R.run != null ? Math.min(R.run, depth) : depth;
    const rise = blk.z1 - blk.z0;
    if (run < 0.05 || rise < 0.05) { warnOnce('rake|' + spec.name + '|' + blk.id, spec.name + ' ' + blk.id + ': a rake needs a run and a rise (run ' + run.toFixed(2) + ', rise ' + rise.toFixed(2) + '); drawn plumb'); return null; }
    const len = Math.hypot(run, rise), sinP = rise / len, cosP = run / len;
    // the wedge: keep where (p - foot)·inward × rise − (z − z0) × run ≥ 0
    const half = [inward[0] * rise, inward[1] * rise, -run, -(inward[0] * W.a[0] + inward[1] * W.a[1]) * rise + blk.z0 * run];
    // the plane's own frame: s along the foot line, t up the slope, d out of the plane
    const at = (s, d, t) => F.at(W.a[0] + W.dir[0] * s + inward[0] * (cosP * t - sinP * d), W.a[1] + W.dir[1] * s + inward[1] * (cosP * t - sinP * d), blk.z0 + sinP * t + cosP * d);
    const o = at(0, 0, 0), pn = at(0, 1, 0), pt = at(1, 0, 0);
    const N = [pn[0] - o[0], pn[1] - o[1], pn[2] - o[2]], T = [pt[0] - o[0], pt[1] - o[1], 0];
    const SW = { at, T, N, L: W.L, a: W.a, b: W.b, dir: W.dir, n: W.n, sloped: true };
    return { i, face: fk, W: SW, run, rise, len, sinP, cosP, pitch: Math.atan2(rise, run) * 180 / Math.PI, half, inward, foot: W.a, depth, z0: blk.z0 };
  }
  /** the raked face itself: its bands, in metres up the slope */
  function drawRakeFace(B, RK, bands, spec, P, key) {
    const t0Of = z => (z - RK.z0) / RK.sinP;
    for (const band of bands) {
      const zb0 = Math.max(band.z0, RK.z0), zb1 = Math.min(band.z1, RK.z0 + RK.rise);
      if (zb1 - zb0 < 0.05) continue;
      const sk = spec.skins[band.skin];
      if (!sk) { warnOnce('skin|' + key + '|' + band.skin, key + ': no skin "' + band.skin + '"'); continue; }
      if (insetOf(band) > 0) warnOnce('rake-inset|' + key, key + ': a raked face cannot be recessed; its band is drawn on the plane');
      const fl = floorsBetween(spec.levels.floors, zb0, zb1, key + ' ' + band.skin);
      const floors = APTS.rakeFloors ? fl.floors.map(t0Of) : [];
      const floorBelow = APTS.rakeFloors && fl.floorBelow != null ? t0Of(fl.floorBelow) : null;
      const t0 = t0Of(zb0), t1 = t0Of(zb1);
      const ctx = { len: RK.W.L, z0: t0, z1: t1, floors, floorBelow, allFloors: spec.levels.floors.map(t0Of), key: key + '|' + band.skin, band };
      const skin = resolveSkin(sk, ctx, P, ctx.key);
      tileFace(B, { W: RK.W, len: RK.W.L, z0: t0, z1: t1 }, skin, P);
      if ((band.balconies && band.balconies.length) || (band.canopies && band.canopies.length)) warnOnce('rake-fix|' + key, key + ': balconies and canopies are not drawn on a raked face');
    }
    count.rakes++;
  }
  /** a ring clipped to the half-plane (p − o)·n ≥ k (Sutherland–Hodgman against one line) */
  function clipRing(ring, o, n, k) {
    const f = p => (p[0] - o[0]) * n[0] + (p[1] - o[1]) * n[1] - k;
    const out = [];
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length], fp = f(p), fq = f(q);
      if (fp >= 0) out.push(p);
      if ((fp >= 0) !== (fq >= 0)) { const t = fp / (fp - fq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
    }
    return out.length >= 3 ? out : null;
  }
  /** the s-range of wall W beyond the rake's head line, or null */
  function wallBeyondHead(W, RK) {
    const f = p => (p[0] - RK.foot[0]) * RK.inward[0] + (p[1] - RK.foot[1]) * RK.inward[1] - RK.run;
    const fa = f(W.a), fb = f(W.b);
    if (fa < 1e-6 && fb < 1e-6) return null;
    if (fa >= -1e-6 && fb >= -1e-6) return [0, W.L];
    const sx = W.L * fa / (fa - fb);
    return fa >= 0 ? [0, sx] : [sx, W.L];
  }

  // ── chamfered corners and holed plans ────────────────────────────────
  //
  // `chamfer` on a rectangle block — metres, one number for all four corners
  // or `{ u1v0, u0v0, u0v1, u1v1 }` by corner — cuts each named corner at
  // 45°, and the cut face is keyed by the corner's name (`faces.u1v0`,
  // `parapetSides`, `roof.sides`) while the four sides keep theirs: Dobie
  // Twenty21's tower corners, Skyloft's amenity volume, 26 West's corner
  // tower at W 26th and Nueces, all drawn square until now. A cut is
  // clamped to half the shorter side it meets.
  function chamferRect(plan, ch) {
    const [u0, u1, v0, v1] = plan;
    const m = k => Math.max(0, typeof ch === 'number' ? ch : (ch && +ch[k]) || 0);
    const corners = [['u1v0', [u1, v0]], ['u0v0', [u0, v0]], ['u0v1', [u0, v1]], ['u1v1', [u1, v1]]];
    const edgeKeys = ['v0', 'u0', 'v1', 'u1'];   // edge k runs from corner k to corner k + 1
    const half = Math.min(Math.abs(u1 - u0), Math.abs(v1 - v0)) / 2 - 0.01;
    const ring = [], keys = []; let n = 0;
    for (let k = 0; k < 4; k++) {
      const [name, p] = corners[k], mk = Math.min(m(name), half);
      const prev = corners[(k + 3) % 4][1], next = corners[(k + 1) % 4][1];
      if (mk > 0.05) {
        const din = [Math.sign(prev[0] - p[0]), Math.sign(prev[1] - p[1])], dout = [Math.sign(next[0] - p[0]), Math.sign(next[1] - p[1])];
        ring.push([p[0] + din[0] * mk, p[1] + din[1] * mk]); keys.push(name);
        ring.push([p[0] + dout[0] * mk, p[1] + dout[1] * mk]); keys.push(edgeKeys[k]);
        n++;
      } else { ring.push(p); keys.push(edgeKeys[k]); }
    }
    return { ring, keys, n };
  }
  /**
   * ringWalls with a key per edge, the two lists kept in step where a short
   * edge is dropped (`keys` null: keyed by kept-wall index, as a polygon plan
   * always was). `inward` faces the walls INTO the ring's interior instead of
   * away from it — a light well's walls face the well. (Reversing the ring
   * does not do that: it flips the edge direction and the winding sign
   * together, and the normal comes out the same.)
   */
  function ringWallsKeyed(F, ringUV, keys, inward) {
    let A = 0;
    for (let i = 0; i < ringUV.length; i++) { const p = ringUV[i], q = ringUV[(i + 1) % ringUV.length]; A += p[0] * q[1] - q[0] * p[1]; }
    const outward = (A > 0 ? -1 : 1) * (inward ? -1 : 1);
    const out = [];
    for (let i = 0; i < ringUV.length; i++) {
      const a = ringUV[i], b = ringUV[(i + 1) % ringUV.length];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.05) continue;
      out.push({ W: wallFrame(F, a, b, outward), key: keys ? keys[i] : String(out.length) });
    }
    return out;
  }
  /**
   * `plan: { ring, holes: [ring, ...] }` — a block with light wells cut out
   * of it: Skyloft's two wells were six blocks round two gaps, 2706 Rio
   * Grande's was a dark plate on the roof, GrandMarc's H-shaped court a
   * rectangle. The outer ring is the plan as ever (a rectangle, a polygon,
   * `"footprint"`); each hole is a (u, v) ring or a rectangle, its walls
   * face INTO the well and are keyed `h<i>.<j>` (hole i, edge j from the
   * hole's point j to j + 1 as authored), and the cap is triangulated round
   * them. A hole's edges take a parapet like any other (`parapetSides`
   * lists them by key); a pitched `roof` on a holed block ignores the holes.
   */
  function capWithHoles(B, F, ringUV, holesUV, z, col) {
    const T = window.THREE;
    const c2 = ringUV.map(p => new T.Vector2(p[0], p[1]));
    const h2 = holesUV.map(h => h.map(p => new T.Vector2(p[0], p[1])));
    let idx = [];
    try { idx = T.ShapeUtils.triangulateShape(c2, h2); } catch (e) { idx = []; }
    const all = ringUV.concat(...holesUV).map(p => F.at(p[0], p[1], z));
    for (const [a, b, c] of idx) B.tri(all[a], all[b], all[c], col, [0, 0, 1]);
  }

  function buildingOne(B, spec) {
    const S = window.slopes;
    const P = palette(spec);
    const ring = spec.footprint.ring;
    const obb = spec.frame && spec.frame.obb ? spec.frame.obb : obbOf(ring);
    const F = frameFor(obb);
    const ringUV = ring.slice(0, ring.length - 1).map(F.toUV);
    console.log('[slopes-apartments] ' + spec.name + ': obb L=' + F.L.toFixed(1) + ' W=' + F.W.toFixed(1) + ', +u at bearing ' + F.bearing.toFixed(1) + '°');
    const key = spec.id || spec.name;
    const levels = spec.levels;
    let top = 0;
    const roofs = [];                 // the pitched roofs built: { block, kind, ridgeZ, rise, dUse }
    const rakes = [];                 // the raked faces built: { block, face, pitch, run, rise, len }
    const signs0 = count.signs, insets0 = count.insets;

    for (const blk of spec.blocks || []) {
      count.blocks++;
      const bands = blk.bands || [];
      const zTop = blk.z1;
      top = Math.max(top, zTop + (blk.parapet || 0));
      // the plan: the footprint ring, a (u, v) polygon, a rectangle [u0, u1, v0, v1],
      // or { ring, holes } — any of those with light wells cut out (capWithHoles)
      const planSpec = blk.plan && !Array.isArray(blk.plan) && typeof blk.plan === 'object' && blk.plan.ring != null ? blk.plan : null;
      const planIn = planSpec ? planSpec.ring : blk.plan;
      const isRect = Array.isArray(planIn) && planIn.length === 4 && typeof planIn[0] === 'number';
      let planUV = planIn === 'footprint' ? ringUV : (isRect ? rectRing(planIn) : planIn);
      // a rectangle's sides are keyed by name (and a chamfer's cuts by corner); a polygon's edges by index among the walls kept
      let keys0 = isRect ? RECT_SIDES.slice() : null;
      if (isRect && blk.chamfer) { const ch = chamferRect(planIn, blk.chamfer); planUV = ch.ring; keys0 = ch.keys; count.chamfers += ch.n; }
      const holesUV = planSpec ? (planSpec.holes || []).map(h => (Array.isArray(h) && h.length === 4 && typeof h[0] === 'number') ? rectRing(h) : h).filter(h => Array.isArray(h) && h.length >= 3) : [];
      count.holes += holesUV.length;
      // the walls: the outer ring's, then each hole's (facing into the well), each ring contiguous
      const walls = [], keys = [], prevOf = [], nextOf = [], ringLenOf = [];
      const addRing = (rg, ks, into) => {
        const ws = ringWallsKeyed(F, rg, ks, into), start = walls.length, n = ws.length;
        ws.forEach((w, j) => { walls.push(w.W); keys.push(w.key); prevOf.push(start + (j - 1 + n) % n); nextOf.push(start + (j + 1) % n); ringLenOf.push(n); });
      };
      addRing(planUV, keys0);
      holesUV.forEach((h, hi) => addRing(h, h.map((_, k) => 'h' + hi + '.' + k), true));
      // the rake: one face leans (rakeOf above); every other wall is clipped to the wedge
      const RK = blk.rake ? rakeOf(spec, blk, planUV, keys, walls, F) : null;
      if (RK) rakes.push({ block: blk.id, face: RK.face, pitch: +RK.pitch.toFixed(2), run: +RK.run.toFixed(3), rise: +RK.rise.toFixed(3), len: +RK.len.toFixed(3), z0: blk.z0, z1: blk.z1 });
      // pass 1: what every wall wears — its bands and the override pieces along it
      const plan = walls.map((W, i) => {
        const face = blk.faces ? (keys[i] in blk.faces ? blk.faces[keys[i]] : blk.faces['*']) : undefined;
        if (face === null) return null;                    // a face against another block: not drawn
        let bd = (face && face.bands) || bands;
        if (face && face.z0 != null) bd = bd.map(b => Object.assign({}, b, { z0: Math.max(b.z0, face.z0) }));
        // a face's or the block's own `inset` recesses every band of it that has none of its own
        const fin = face && face.inset != null ? face.inset : blk.inset;
        if (fin != null) bd = bd.map(b => b.inset != null ? b : Object.assign({}, b, { inset: fin }));
        // overrides: a region of the plan whose walls wear other bands (the corner bay, a wall another block hides)
        const pieces = [[0, W.L, bd]];
        for (const ov of blk.overrides || []) {
          const c = clipWall(W, ov.region);
          if (!c) continue;
          const next = [];
          for (const [a, b, pb] of pieces) {
            if (pb !== bd) { next.push([a, b, pb]); continue; }
            if (c[1] <= a || c[0] >= b) { next.push([a, b, pb]); continue; }
            if (c[0] > a) next.push([a, c[0], pb]);
            next.push([Math.max(a, c[0]), Math.min(b, c[1]), ov.bands]);
            if (c[1] < b) next.push([c[1], b, pb]);
          }
          pieces.splice(0, pieces.length, ...next);
        }
        return { bd, pieces };
      });
      // pass 2: draw, telling each piece what meets it at either end (a recess needs to know)
      const nW = walls.length;
      const corner = (Wi, Wo, high) => ({ kind: 'corner', dot: Wi.dir[0] * Wo.n[0] + Wi.dir[1] * Wo.n[1], nn: Wi.n[0] * Wo.n[0] + Wi.n[1] * Wo.n[1], bands: null });
      for (let i = 0; i < nW; i++) {
        if (!plan[i]) continue;
        const W = walls[i], { bd, pieces } = plan[i];
        const wkey = key + '|' + blk.id + '|' + keys[i];
        if (RK && i === RK.i) { drawRakeFace(B, RK, bd, spec, P, wkey); continue; }
        const prev = plan[prevOf[i]], next = plan[nextOf[i]], nR = ringLenOf[i];
        for (let k = 0; k < pieces.length; k++) {
          const [a, b, pb] = pieces[k];
          let lo, hi;
          if (k > 0) lo = { kind: 'straight', bands: pieces[k - 1][2] };
          else { lo = corner(W, walls[prevOf[i]], false); lo.bands = prev && nR > 1 ? prev.pieces[prev.pieces.length - 1][2] : null; }
          if (k < pieces.length - 1) hi = { kind: 'straight', bands: pieces[k + 1][2] };
          else { hi = corner(W, walls[nextOf[i]], true); hi.bands = next && nR > 1 ? next.pieces[0][2] : null; }
          drawWall(B, F, W, a, b, pb, spec, P, wkey, { fixtures: pb !== bd, lo, hi, blockZ0: blk.z0, clip: RK ? RK.half : null });
        }
        // the face's own balconies and signs: once, on the whole wall, `s` along the face
        wallFixtures(B, W, bd, spec, P, wkey, RK ? { a: RK.half[0] * W.dir[0] + RK.half[1] * W.dir[1], b: RK.half[2], c: RK.half[0] * W.a[0] + RK.half[1] * W.a[1] + RK.half[3] } : null);
      }
      // the roof: the plan at z1 (earcut through slopes.build().polygon), or
      // the pitched roof the block asks for (roofOf); a roof standing inside
      // its wall (`inset`, behind a parapet) keeps the flat cap under it
      let roofRec = null;
      if (blk.roof && RK) warnOnce('rake-roof|' + key + '|' + blk.id, spec.name + ' ' + blk.id + ': a raked block carries no roof; the plane is its roof');
      if (blk.roof && holesUV.length) warnOnce('holes-roof|' + key + '|' + blk.id, spec.name + ' ' + blk.id + ': a pitched roof on a holed plan ignores the holes');
      if (blk.roof && !RK) { try { roofRec = roofOf(B, spec, blk, F, planUV, keys, P, zTop); } catch (e) { console.warn('[slopes-apartments] roof', spec.name, blk.id, e); } }
      if (roofRec) { roofs.push(roofRec); top = Math.max(top, roofRec.ridgeZ); }
      if (blk.cap !== false && (!roofRec || blk.roof.inset > 0)) {
        // a raked block's cap is only what lies beyond the head line; a holed plan's goes round its wells
        const capUV = RK ? clipRing(planUV, RK.foot, RK.inward, RK.run) : planUV;
        const capCol = P[blk.roofTone || 'roof'];
        if (capUV && (!RK || Math.abs(ringArea(capUV)) > 0.05)) {
          if (holesUV.length && !RK) capWithHoles(B, F, capUV, holesUV, zTop, capCol);
          else B.polygon(capUV.map(p => F.at(p[0], p[1], zTop)), capCol, [0, 0, 1], 'xy');
        }
      }
      if (blk.parapet) {
        const sides = blk.parapetSides || keys;
        for (let i = 0; i < walls.length; i++) {
          if (!sides.includes(keys[i]) || (RK && i === RK.i)) continue;
          const r = RK ? wallBeyondHead(walls[i], RK) : [0, walls[i].L];
          if (!r || r[1] - r[0] < 0.05) continue;
          box(B, walls[i], r[0], r[1], -APTS.parapetT, 0, zTop, zTop + blk.parapet, P[blk.parapetTone || 'coping'], { bottom: true });
        }
      }
      // A roof-edge ribbon whose height follows an authored path. Rambler's
      // teal crown rises smoothly round its street corner; stacking rectangular
      // boxes here changes its silhouette into steps. Points are [u,v,topZ].
      if (blk.crest && blk.crest.path?.length > 1) {
        const C = blk.crest, path = C.path, width = C.width ?? APTS.parapetT;
        const col = P[C.tone || blk.parapetTone || 'metal'];
        const inner = path.map((p, i) => {
          const a = path[Math.max(0,i-1)], b = path[Math.min(path.length-1,i+1)];
          const len = Math.hypot(b[0]-a[0],b[1]-a[1]) || 1;
          return [p[0]-(b[1]-a[1])*width/len,p[1]+(b[0]-a[0])*width/len,p[2]];
        });
        const at = (p,z=p[2]) => F.at(p[0],p[1],z);
        for (let i=0;i<path.length-1;i++) {
          const a=path[i],b=path[i+1],c=inner[i+1],d=inner[i];
          B.quad(at(a,zTop),at(b,zTop),at(b),at(a),col);
          B.quad(at(d,zTop),at(d),at(c),at(c,zTop),col);
          B.quad(at(a),at(b),at(c),at(d),col);
        }
        for (const i of [0,path.length-1]) B.quad(at(path[i],zTop),at(path[i]),at(inner[i]),at(inner[i],zTop),col);
        top = Math.max(top,...path.map(p=>p[2]));
      }
      // rooftop items: closed boxes on the roof — a bulkhead, a stair head, or
      // a `grid` [nu, nv] of them inside `plan` (a condenser cluster: the
      // nadir shows the units in tight rows on every roof of The Standard)
      const roofBox = (plan, h, tone) => {
        const RW = rectWalls(F, plan);
        for (const k of RECT_SIDES) box(B, RW[k], 0, RW[k].L, -0.0001, 0, zTop, zTop + h, P[tone || 'coping'], { bottom: true, back: true, s0: true, s1: true, top: true });
        const c = rectRing(plan).map(p => F.at(p[0], p[1], zTop + h));
        B.polygon(c, P[tone || 'coping'], [0, 0, 1], 'xy');
      };
      for (let ii = 0; ii < (blk.roofItems || []).length; ii++) {
        const it = blk.roofItems[ii];
        if (it.roof) {
          // a box `h` tall with a pitched roof on it (h may be 0: the roof stands on the deck)
          const isR = Array.isArray(it.plan) && it.plan.length === 4 && typeof it.plan[0] === 'number';
          const z0i = zTop + (it.z0 || 0), z1i = z0i + (it.h || 0);
          if (it.h > 0) {
            if (isR) { const RW = rectWalls(F, it.plan); for (const k of RECT_SIDES) box(B, RW[k], 0, RW[k].L, -0.0001, 0, z0i, z1i, P[it.tone || 'coping'], { bottom: true, back: true, s0: true, s1: true, top: true }); }
            else for (const Wi of ringWalls(F, it.plan)) box(B, Wi, 0, Wi.L, -0.0001, 0, z0i, z1i, P[it.tone || 'coofing'] || P[it.tone || 'coping'], { bottom: true, back: true, s0: true, s1: true, top: true });
          }
          const pseudo = { id: blk.id + '/' + (it.id || 'item' + ii), roof: it.roof, roofTone: it.tone || blk.roofTone };
          let rec = null;
          try { rec = roofOf(B, spec, pseudo, F, isR ? rectRing(it.plan) : it.plan, isR ? RECT_SIDES : it.plan.map((_, i) => String(i)), P, z1i); } catch (e) { console.warn('[slopes-apartments] roof item', spec.name, pseudo.id, e); }
          if (rec) { roofs.push(rec); top = Math.max(top, rec.ridgeZ); }
          else { const c = (isR ? rectRing(it.plan) : it.plan).map(p => F.at(p[0], p[1], z1i)); B.polygon(c, P[it.tone || 'coping'], [0, 0, 1], 'xy'); }
          continue;
        }
        if (!it.grid) { roofBox(it.plan, it.h, it.tone); continue; }
        const [u0, u1, v0, v1] = it.plan, [nu, nv] = it.grid, [w, d] = it.size || [1.0, 2.0];
        const du = nu > 1 ? (u1 - u0 - w) / (nu - 1) : 0, dv = nv > 1 ? (v1 - v0 - d) / (nv - 1) : 0;
        for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
          const a = u0 + i * du, b = v0 + j * dv;
          roofBox([a, a + w, b, b + d], it.h, it.tone);
        }
      }
    }

    // ── the deck: boxes on a roof, each from the JSON with its source ──
    if (APTS.deck && spec.deck) {
      const z = spec.deck.z;
      for (const it of spec.deck.items || []) {
        const R = rectWalls(F, it.plan);
        const z0 = z + (it.z0 || 0), z1 = z + (it.z1 != null ? it.z1 : (it.z0 || 0) + (it.h || 0.1));
        const col = P[it.tone];
        for (const side of RECT_SIDES) box(B, R[side], 0, R[side].L, -0.0001, 0, z0, z1, col, { bottom: true, back: true, s0: true, s1: true, top: true });
        const c = rectRing(it.plan).map(p => F.at(p[0], p[1], z1));
        B.polygon(c, col, [0, 0, 1], 'xy');
      }
    }
    count.buildings++;
    count.names.push(spec.name);
    return { name: spec.name, id: spec.id || null, top, frame: F, roofs, rakes, signs: count.signs - signs0, insets: count.insets - insets0 };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  THE GROUP, THE FILTERS, THE SWITCH
  // ══════════════════════════════════════════════════════════════════════
  let _built = [];
  function build() {
    const T = window.THREE, S = window.slopes;
    const t0 = performance.now();
    resetCount();
    const B = S.build();
    _built = [];
    for (const spec of _data.buildings) {
      try { _built.push(buildingOne(B, spec)); }
      catch (e) { console.error('[slopes-apartments]', spec.name, e); }
    }
    const geom = B.geometry();
    const mesh = new T.Mesh(geom, S.material());
    mesh.name = 'apartments';
    const g = new T.Group();
    g.name = 'slopes-apartments';
    g.userData.lod = APTS.lod;
    g.userData.minzoom = APTS.minzoom;
    g.add(mesh);
    count.triangles = B.triangles;
    count.ms = +(performance.now() - t0).toFixed(1);
    _lastDetail = S.detail();
    return g;
  }

  /**
   * Every authored footprint, inset APTS.roofscapeInset metres, as one
   * GeoJSON MultiPolygon for the roofscape clause. The roofscape features
   * carry no id and no name (k/src/t/d/b/h and three colours — nothing a
   * property filter can name), so they are hidden by GEOMETRY: MapLibre's
   * `distance` expression is 0 for a feature that overlaps the input and
   * positive for one that stands clear of it, and 5.24.0 evaluates it for
   * polygon features (measured on the page before this was written: the
   * deck under The Standard's centre goes, a neighbour's 100 m east stays).
   * The inset is what keeps a neighbour's own deck, which shares the
   * boundary, on the positive side.
   */
  const _hideGeo = {};              // inset -> the MultiPolygon, per list of buildings
  function hideGeometry(inset) {
    // cached per inset and list of buildings: a building added at runtime (a builder's console, the gate) gets its clause on the next apply
    inset = inset == null ? APTS.roofscapeInset : inset;
    const key = inset + '|' + ((_data && _data.buildings) || []).map(b => b.name).join('|');
    if (_hideGeo[key] !== undefined) return _hideGeo[key];
    const polys = [];
    for (const b of (_data && _data.buildings) || []) {
      const ring = b.footprint && b.footprint.ring;
      if (!ring || ring.length < 4) continue;
      const pts = ring.slice(0, ring.length - 1);
      const lat0 = pts.reduce((a, p) => a + p[1], 0) / pts.length, lng0 = pts[0][0];
      const mx = mLon(lat0), my = M_LAT;
      const m = pts.map(p => [(p[0] - lng0) * mx, (p[1] - lat0) * my]);
      const off = inset > 0 ? (offsetRing(m, inset) || ccw(m)) : ccw(m);
      const ll = off.map(q => [+(lng0 + q[0] / mx).toFixed(7), +(lat0 + q[1] / my).toFixed(7)]);
      ll.push(ll[0]);
      polys.push([ll]);
    }
    _hideGeo[key] = polys.length ? { type: 'MultiPolygon', coordinates: polys } : null;
    return _hideGeo[key];
  }

  /**
   * Hide what the mesh replaces while it draws; put it all back when it does
   * not. The replaced prism by id (buildings-3d, buildings-roof), the
   * westcampus bands by name (the four wc- layers), the campus-storeys
   * courses by `host` (js/facades.js keys them by the building's id there),
   * and the roofscape pass by geometry (above): its deck plates, penthouses
   * and units were baked at the SNAPSHOT height, so over a building
   * authored lower they floated — Regents West's 41 x 44 m deck 6.5 m above
   * its roof, 2706 Rio Grande's ten metres up, the Villas' 12.6 — and hid
   * everything the file draws on the roof.
   */
  // `roofscape` here is every layer hidden by GEOMETRY: the roofscape pass,
  // and roofs-pitched — the tiled-roof bake keeps its `f: band` features
  // drawn as fill-extrusions while js/slopes-roofs.js draws the rest as a
  // mesh, and over Jester West Hall's tower those bands are the precast
  // strips from 19 m to the roof, baked on the snapshot, standing through
  // the mesh this file draws (measured 2026-09-05: queryRenderedFeatures on
  // one of the "poles" answered roofs-pitched, b 19, h 50.55).
  // Those bands stand ON the wall line, outside the inset that spares a
  // neighbour's deck, so roofs-pitched is hidden against the footprint
  // itself (`walls`) — and, since 2026-09-06, against the footprint plus
  // APTS.wallMargin, because a precast strip is drawn PROUD of the wall and
  // "overlaps the ring" was not true of most of them. That is the defect
  // Simeon reported on the live site: "the parts with 5 floors still have a
  // scaffolding for the rest of the floors". The strips over Jester West's
  // 18.6 m wings run to 50.55 m, over Jester East's to 39.35 m, and 27 of
  // the 44 on the West tower alone stood 0.08-0.11 m clear of the ring, so
  // the `> 0` clause kept them with no wall behind them. The roofscape pass
  // is hidden against the INSET one, which is a different question (a
  // neighbour's deck shares the boundary and must stay).
  //
  // EVERY LAYER THAT DRAWS A BUILDING VOLUME BELONGS IN HERE. That is the
  // rule the two 2026-09-06 defects were both a miss of: a pass that draws
  // walls or roofs from its own bake, over ground this file has authored, is
  // a second building standing inside or above the first. Ground, roads,
  // props, trees and art are NOT in here on purpose — they sit at grade
  // inside a footprint quite legitimately, and hiding them would cut a hole
  // in the ground. `_aptfloat` (scripts/verify/aptfloat.mjs) is the sweep
  // that finds a new one: a nadir over every authored footprint, every
  // fill-extrusion layer queried, anything that answers named.
  const HIDE_LAYERS = { prism: ['buildings-3d', 'buildings-roof'], bands: ['wc-wall', 'wc-wall-cap', 'wc-solid', 'wc-detail'], storeys: ['campus-storeys'], roofscape: ['roofscape-deck', 'roofscape-major', 'roofscape-minor'], walls: ['roofs-pitched'], parts: ['parts-3d', 'parts-roof'], precinct: ['moody-wall', 'moody-roof', 'moody-plant', 'moody-cap'] };
  /**
   * The tiled roofs js/slopes-roofs.js draws from data/roofs.geojson's rig
   * were baked on the SNAPSHOT prism too: San Jacinto Hall's hip sits on
   * Overture's 28.1 m and floats six metres over the roof this file draws
   * (its builder's todo 2b: "this building's tile roof is drawn TWICE and
   * mine loses"). That generator has no skip list, so while we draw, its rig
   * entries keyed by a replaced building's id are lifted out of its data and
   * it is rebuilt; when the switch goes off they are put back and it is
   * rebuilt again. The right fix is in scripts/bake_roofs.py (skip every id
   * in data/apartments/index.json, as bake_roofscape.py skips authored
   * roofs) and is written into HANDOFF.md for the roofs lane.
   */
  const _rigStash = {};
  function stashRigs(on) {
    const R = window.slopesRoofs;
    const roofs = R && R.data && R.data.roofs;
    if (!roofs) return 0;
    let n = 0;
    if (on) {
      const ids = new Set((_data.replacedBuildingIds || []).filter(id => !_data.buildings.some(b => b.id === id && b.preserveRoof)));
      for (const k of Object.keys(roofs)) if (ids.has(k.split('/')[0])) { _rigStash[k] = roofs[k]; delete roofs[k]; n++; }
    } else {
      for (const k of Object.keys(_rigStash)) { roofs[k] = _rigStash[k]; delete _rigStash[k]; n++; }
    }
    if (n) { try { R.rebuild(); } catch (e) { console.warn('[slopes-apartments] roofs rebuild', e); } }
    return n;
  }
  /** the rig keys still in js/slopes-roofs.js's data that should have been lifted out (it booted after us) */
  function rigsMissing() {
    const R = window.slopesRoofs, roofs = R && R.data && R.data.roofs;
    if (!roofs || !_data) return [];
    const ids = new Set((_data.replacedBuildingIds || []).filter(id => !_data.buildings.some(b => b.id === id && b.preserveRoof)));
    return Object.keys(roofs).filter(k => ids.has(k.split('/')[0]));
  }
  function filterPlan() {
    const gone = _data.replacedBuildingIds || [];
    const names = _data.replacedNames || [];
    const plan = [];
    if (gone.length) for (const id of HIDE_LAYERS.prism) plan.push([id, ['!', ['in', ['get', 'id'], ['literal', gone]]]]);
    if (names.length) for (const id of HIDE_LAYERS.bands) plan.push([id, ['!', ['in', ['get', 'name'], ['literal', names]]]]);
    if (gone.length && APTS.hideStoreys) for (const id of HIDE_LAYERS.storeys) plan.push([id, ['!', ['in', ['get', 'host'], ['literal', gone]]]]);
    const geo = APTS.hideRoofscape && hideGeometry(APTS.roofscapeInset);
    if (geo) for (const id of HIDE_LAYERS.roofscape) plan.push([id, ['>', ['distance', geo], 0]]);
    const geoW = APTS.hideRoofscape && hideGeometry(0);
    if (geoW) for (const id of HIDE_LAYERS.walls) plan.push([id, ['>', ['distance', geoW], APTS.wallMargin]]);
    if (geo && APTS.hideParts) for (const id of HIDE_LAYERS.parts) plan.push([id, ['>', ['distance', geo], 0]]);
    if (geo && APTS.hidePrecinct) for (const id of HIDE_LAYERS.precinct) plan.push([id, ['>', ['distance', geo], 0]]);
    return plan;
  }
  /** the planned layers that exist but do not carry our clause yet (a layer that booted after us) */
  function filtersMissing() {
    if (!_map || !_data) return [];
    return filterPlan().filter(([id, clause]) => _map.getLayer(id) && JSON.stringify(_map.getFilter(id) || null).indexOf(JSON.stringify(clause)) < 0).map(p => p[0]);
  }
  /**
   * Our clause taken back out of a filter, wherever another pass has since
   * wrapped it: ['all', X, ours] becomes X, a bare ours becomes null. This is
   * how the switch-off restores — not from a snapshot. js/slopes-roofs.js
   * saves and restores roofs-pitched's filter on the same SLOPES switch, and
   * js/westcampus.js rewrites buildings-3d's from its own snapshot; a
   * snapshot taken between them can only put back the wrong state.
   */
  const sameJSON = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function stripClause(f, clause) {
    if (!Array.isArray(f)) return f;
    if (sameJSON(f, clause)) return null;
    if (f[0] === 'all' && f.length === 3 && sameJSON(f[2], clause)) return stripClause(f[1], clause);
    const out = f.map(x => Array.isArray(x) ? stripClause(x, clause) : x);
    if (out[0] === 'all') { const rest = out.slice(1).filter(x => x !== null); return rest.length === 0 ? null : (rest.length === 1 ? rest[0] : ['all'].concat(rest)); }
    return out;
  }
  function setFilters(on) {
    const map = _map;
    if (!map) return;
    const plan = filterPlan();
    if (on) {
      for (const [id, clause] of plan) {
        if (!map.getLayer(id)) continue;
        let f = map.getFilter(id) || null;
        if (JSON.stringify(f).indexOf(JSON.stringify(clause)) >= 0) { _clauses[id] = clause; continue; }   // already ours (a re-apply)
        if (_clauses[id]) f = stripClause(f, _clauses[id]);                              // a clause of ours that has since changed (a building added at runtime)
        try { map.setFilter(id, f ? ['all', f, clause] : clause); _clauses[id] = clause; } catch (e) { console.warn('[slopes-apartments] filter', id, e); }
      }
      stashRigs(true);
      _filtered = true;
    } else if (_filtered) {
      for (const id of Object.keys(_clauses)) {
        if (map.getLayer(id)) {
          const f = map.getFilter(id) || null, g = stripClause(f, _clauses[id]);
          if (!sameJSON(f, g)) { try { map.setFilter(id, g); } catch (e) {} }
        }
        delete _clauses[id];
      }
      stashRigs(false);
      _filtered = false;
    }
  }

  /**
   * Teach the flight controls the real height: js/controls.js rasterises its
   * collision grid once at init from final_height (20.5 m for The Standard),
   * so without this you fly through the top 38 m of the tower. The same
   * route js/heroes.js and js/westcampus.js take; theirs are carried along so
   * the rebuild does not drop Rambler's corrected height.
   */
  function extendCollision(map) {
    if (typeof window.__flyRebuildCollision !== 'function') return 'no collision api';
    const pick = id => { const s = map.getSource(id); if (!s) return null; return [s._data, s.serialize && s.serialize().data].find(d => d && typeof d !== 'string' && d.features && d.features.length) || null; };
    const buildings = pick('austin-buildings');
    if (!buildings) return 'no buildings source';
    const parts = pick('austin-parts');
    const heights = Object.assign({}, (window.__wc4 && window.__wc4.heights) || {});
    const byId = {};
    const authored = new Map(_data.buildings.map(b => [b.id, b]));
    for (const b of _built) { if (b.name) heights[b.name] = b.top; if (b.id) byId[b.id] = b.top; }
    const extra = [];
    for (const f of buildings.features) {
      const p = f.properties || {};
      // by id first: a snapshot row's name can be null (26 West Courtyard's is), and then a name match keeps the prism's height
      const h = byId[p.id] || heights[p.name];
      // New construction can replace a much smaller former building (Icon's
      // site was a church). Collision must follow the authored envelope too.
      const spec = authored.get(p.id);
      const geometry = spec ? { type: 'Polygon', coordinates: [spec.footprint.ring, ...(spec.footprint.holes || [])] } : f.geometry;
      if (h) extra.push({ type: 'Feature', geometry, properties: { h } });
    }
    if (!extra.length) return 'no matching footprints';
    window.__flyRebuildCollision({ buildings, parts: { type: 'FeatureCollection', features: ((parts && parts.features) || []).concat(extra) } });
    return 'rebuilt with ' + extra.length + ' corrected heights';
  }

  // A new building may replace a differently named snapshot feature. Keep the
  // authored name with its mesh, and restore the snapshot label with fallback.
  const _labelFields = new Map();
  function setLabels(on) {
    const entries = on ? _data.buildings.filter(b => b.labelOverride && b.id).flatMap(b => [b.id, b.name]) : [];
    for (const id of ['buildings-labels-major', 'buildings-labels-mid', 'buildings-labels']) {
      if (!_map.getLayer(id)) continue;
      const current = _map.getLayoutProperty(id, 'text-field'), saved = _labelFields.get(id);
      const base = saved && sameJSON(current, saved.applied) ? saved.base : current;
      const field = entries.length ? ['match', ['get', 'id'], ...entries, base] : base;
      if (!sameJSON(current, field)) _map.setLayoutProperty(id, 'text-field', field);
      if (entries.length) _labelFields.set(id, { base, applied: field });
      else _labelFields.delete(id);
    }
  }

  window.applySlopesApartments = function applySlopesApartments(map) {
    map = map || _map;
    if (!map || !_data) return;
    const S = window.slopes;
    const want = !!(window.SLOPES.on && APTS.on);
    if (want && !_group) { _group = build(); S.add(_group); }
    else if (want && _group && _lastDetail !== S.detail()) { S.remove(_group); _group = build(); S.add(_group); }
    else if (!want && _group) { S.remove(_group); _group = null; }
    setFilters(want);
    setLabels(want);
    map.triggerRepaint();
  };

  window.slopesApartments = {
    rebuild() { if (_group) { window.slopes.remove(_group); _group = null; } window.applySlopesApartments(); },
    get count() { return Object.assign({}, count, { names: count.names.slice() }); },
    get group() { return _group; },
    get data() { return _data; },
    get filtered() { return _filtered; },
    get built() { return _built.map(b => ({ name: b.name, id: b.id, top: b.top, roofs: b.roofs, rakes: b.rakes, signs: b.signs, insets: b.insets })); },
    /** the filter plan as applied, the layers whose clause is missing, the rigs lifted out of js/slopes-roofs.js */
    get hidden() { return { plan: _data ? filterPlan().map(p => p[0]) : [], missing: filtersMissing(), rigs: Object.keys(_rigStash), rigsMissing: rigsMissing() }; },
    /** every character the dot font can set */
    get glyphs() { return Object.keys(FONT); },
    /** a built building's frame: (u, v) metres to [lng, lat], and back */
    uvToLngLat(name, u, v) { const b = _built.find(x => x.name === name); return b ? b.frame.ll(u, v) : null; },
    lngLatToUV(name, lng, lat) { const b = _built.find(x => x.name === name); return b ? b.frame.toUV([lng, lat]) : null; },
    obbOf, h01, floorsBetween, offsetRing, hideGeometry,
  };

  // ── boot ─────────────────────────────────────────────────────────────
  // Waits for the layer (window.slopes.root exists once initSlopes ran —
  // never under ?slopes=0), for the prisms it hides, and — when the West
  // Campus pass is on — for that pass's layers, so their filter can be set
  // in the same apply. The data is fetched once, through the layer's cache.
  let _fetching = null;
  async function boot() {
    const map = window.__map, S = window.slopes;
    if (!map || !S || !S.root || !map.getLayer('buildings-3d')) return false;
    if (window.WESTCAMPUS && window.WESTCAMPUS.on && !map.getLayer('wc-wall') && !window.__wcSkipped) return false;
    _map = map;
    if (!_data) {
      if (!_fetching) {
        _fetching = (async () => {
          const idx = await S.fetchJSON(APTS.index);
          const buildings = [];
          for (const f of idx.buildings || []) {
            try { buildings.push(await S.fetchJSON(f.startsWith('data/') ? f : 'data/apartments/' + f)); }
            catch (e) { console.warn('[slopes-apartments]', f, e.message); }
          }
          return { buildings, replacedBuildingIds: idx.replacedBuildingIds || buildings.map(b => b.id).filter(Boolean), replacedNames: idx.replacedNames || buildings.map(b => b.name) };
        })();
      }
      try { _data = await _fetching; } catch (e) { console.warn('[slopes-apartments]', e.message, '— nothing drawn'); count.done = true; return true; }
    }
    S.onSwitch(() => window.applySlopesApartments(map));
    // after any pass that rewrites a layer we filter — the slopes settings,
    // js/slopes-roofs.js's own apply (it sets roofs-pitched's filter from
    // the snapshot it took at ITS boot, which drops ours if we came first)
    // and js/westcampus.js's (buildings-3d from its own snapshot) — ours
    // re-applies; setFilters skips a layer that already carries the clause
    const hook = name => {
      const orig = window[name];
      if (typeof orig !== 'function' || orig.__aptsHooked) return;
      const wrapped = function (m) { const r = orig.apply(this, arguments); try { window.applySlopesApartments(m && m.getLayer ? m : undefined); } catch (e) {} return r; };
      wrapped.__aptsHooked = true;
      window[name] = wrapped;
    };
    for (const name of ['applySlopesSettings', 'applySlopesRoofs', 'applyWestcampusSettings']) hook(name);
    window.applySlopesApartments(map);
    console.log('[slopes-apartments]', count.buildings, 'building(s):', count.names.join(', '), '—', count.blocks, 'blocks,', count.faces, 'faces,', count.cells, 'cells,', count.windows, 'windows,', count.balconies, 'balconies,', count.signs, 'signs' + (count.signMissing ? ' (' + count.signMissing + ' characters the font lacks)' : '') + ',', count.roofs, 'pitched roofs,', count.insets, 'recesses,', count.frames, 'framed windows,', count.dominoes, 'dominoes,', count.rakes, 'raked faces,', count.fins, 'fins,', count.piers, 'piers,', count.openings, 'openings,', count.canopies, 'canopies in', count.triangles, 'triangles,', count.ms, 'ms; collision:', extendCollision(map), '; hidden:', filterPlan().filter(p => map.getLayer(p[0])).map(p => p[0]).join(' '));
    // a layer that boots after this file (campus-storeys comes with the
    // facades pass, on its own clock; slopes-roofs after its 1.4 MB rig
    // fetch) gets its clause when it appears, and a pass that has not been
    // hooked above (it booted after us) has its rewrite undone: a light poll,
    // every 150 ms for the first minute, then every second for five
    (function late() {
      let n = 0;
      const tick = () => {
        n++;
        if (n > 400 + 240) return;
        setTimeout(tick, n < 400 ? 150 : 1000);
        if (!_filtered || !(window.SLOPES.on && APTS.on)) return;
        setLabels(true);
        for (const name of ['applySlopesRoofs', 'applyWestcampusSettings']) if (typeof window[name] === 'function' && !window[name].__aptsHooked) hook(name);
        if (filtersMissing().length || rigsMissing().length) { setFilters(true); map.triggerRepaint(); }
      };
      tick();
    })();
    count.done = true;
    return true;
  }
  (function poll() {
    if (new URLSearchParams(location.search).get('slopes') === '0') return;   // the layer is out; so is this
    let n = 0, busy = false;
    const t = setInterval(async () => {
      if (busy) return;
      busy = true;
      let done = false;
      try { done = await boot(); } catch (e) { console.error('[slopes-apartments]', e); done = true; count.done = true; }
      busy = false;
      // the West Campus pass may be off by URL (?westcampus=0) or never boot: after 40 s stop waiting for it
      if (!done && n === 260) window.__wcSkipped = true;
      if (done || ++n > 900) clearInterval(t);
    }, 150);
  })();
})();
