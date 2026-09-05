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
  };
  window.APARTMENTS = APTS;

  // ── state ────────────────────────────────────────────────────────────
  let _map = null, _group = null, _data = null, _lastDetail = null;
  let _filtered = false;
  const _origFilters = {};          // layer id -> the filter it had before this file touched it
  const count = { buildings: 0, blocks: 0, faces: 0, cells: 0, windows: 0, balconies: 0, signs: 0, triangles: 0, ms: 0, done: false, names: [] };

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

  // ── the 5x7 dot font (uppercase, the letters the signs need) ─────────
  const FONT = {
    T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
    H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
    E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
    S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
    A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
    N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
    D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
    R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
    O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
    I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
    L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
    M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
    C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
    U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
    ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  };

  // ══════════════════════════════════════════════════════════════════════
  //  GEOMETRY
  // ══════════════════════════════════════════════════════════════════════

  /** A quad on a wall frame: (s0..s1, z0..z1) at depth d, facing outward (+N). */
  function faceQuad(B, W, s0, s1, z0, z1, d, col) {
    B.quad(W.at(s0, d, z0), W.at(s1, d, z0), W.at(s1, d, z1), W.at(s0, d, z1), col, W.N);
  }

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
    const { W, len, z0, z1 } = face;
    const reveal = APTS.reveals ? (skin.reveal != null ? skin.reveal : APTS.reveal) : 0;
    const windows = (skin.windows || []).filter(w => w.s1 > 0 && w.s0 < len && w.z1 > z0 && w.z0 < z1)
      .map(w => ({ s0: Math.max(0, w.s0), s1: Math.min(len, w.s1), z0: Math.max(z0, w.z0), z1: Math.min(z1, w.z1), lit: w.lit }));
    // z cuts: the skin's row lines and every window's top and bottom
    const zc = new Set([z0, z1]);
    for (const z of skin.rows(z0, z1)) if (z > z0 && z < z1) zc.add(+z.toFixed(4));
    for (const w of windows) { if (w.z0 > z0 && w.z0 < z1) zc.add(+w.z0.toFixed(4)); if (w.z1 > z0 && w.z1 < z1) zc.add(+w.z1.toFixed(4)); }
    const zs = [...zc].sort((a, b) => a - b);
    const glass = P[skin.glass || 'glass'];
    const revealCol = P[skin.revealTone || skin.frame || 'frame'] || P.frame || glass;
    for (let r = 0; r < zs.length - 1; r++) {
      const za = zs[r], zb = zs[r + 1];
      if (zb - za < 1e-4) continue;
      const zm = (za + zb) / 2;
      // s cuts for this band: the skin's column lines for this row, plus the
      // edges of every window that spans this band
      const sc = new Set([0, len]);
      for (const s of skin.cols(zm, len)) if (s > 0 && s < len) sc.add(+s.toFixed(4));
      const inBand = windows.filter(w => w.z0 <= za + 1e-6 && w.z1 >= zb - 1e-6);
      for (const w of inBand) { if (w.s0 > 0 && w.s0 < len) sc.add(+w.s0.toFixed(4)); if (w.s1 > 0 && w.s1 < len) sc.add(+w.s1.toFixed(4)); }
      const ss = [...sc].sort((a, b) => a - b);
      for (let c = 0; c < ss.length - 1; c++) {
        const sa = ss[c], sb = ss[c + 1];
        if (sb - sa < 1e-4) continue;
        const sm = (sa + sb) / 2;
        const win = inBand.find(w => sm > w.s0 && sm < w.s1);
        count.cells++;
        if (win) {
          const col = win.lit ? [glass[0], glass[1], APTS.nightLitTone] : glass;
          faceQuad(B, W, sa, sb, za, zb, -reveal, col);
        } else {
          faceQuad(B, W, sa, sb, za, zb, 0, skin.tone(zm, sm, r, c) || P.wall);
        }
      }
    }
    // reveals: four strips per window, joining the recessed pane to the plane
    if (reveal > 0) {
      for (const w of windows) {
        const T = W.T, N = W.N;
        const P0 = (s, d, z) => W.at(s, d, z);
        // sill (faces up), head (faces down), jambs (face along the wall)
        B.quad(P0(w.s0, -reveal, w.z0), P0(w.s1, -reveal, w.z0), P0(w.s1, 0, w.z0), P0(w.s0, 0, w.z0), revealCol, [0, 0, 1]);
        B.quad(P0(w.s0, 0, w.z1), P0(w.s1, 0, w.z1), P0(w.s1, -reveal, w.z1), P0(w.s0, -reveal, w.z1), revealCol, [0, 0, -1]);
        B.quad(P0(w.s0, -reveal, w.z0), P0(w.s0, 0, w.z0), P0(w.s0, 0, w.z1), P0(w.s0, -reveal, w.z1), revealCol, T);
        B.quad(P0(w.s1, 0, w.z0), P0(w.s1, -reveal, w.z0), P0(w.s1, -reveal, w.z1), P0(w.s1, 0, w.z1), revealCol, [-T[0], -T[1], 0]);
      }
    }
    count.windows += windows.length;
    count.faces++;
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
    const floors = ctx.floors;
    let centres = [];
    if (win.cols) centres = win.cols.map(f => f * ctx.len);
    else {
      const bay = spec.bay || 3.0;
      const n = Math.max(1, Math.round(ctx.len / bay));
      const mod = ctx.len / n;
      for (let i = 0; i < n; i++) centres.push((i + 0.5) * mod);
    }
    const skipS = spec.windowSkip || [];   // s ranges with no window (a sign, a balcony door handled elsewhere)
    for (let fi = 0; fi < floors.length; fi++) {
      const fz = floors[fi];
      const zb = fz + (win.sill != null ? win.sill : 0.8), zt = zb + (win.h || 2.0);
      if (zt > ctx.z1 + 1e-6) continue;
      for (let ci = 0; ci < centres.length; ci++) {
        const cx = centres[ci];
        const s0 = cx - (win.w || 1.5) / 2, s1 = cx + (win.w || 1.5) / 2;
        if (s0 < 0.05 || s1 > ctx.len - 0.05) continue;
        if (skipS.some(r => s1 > r[0] && s0 < r[1])) continue;
        out.push({ s0, s1, z0: zb, z1: zt, lit: h01(key, 'lit', fi, ci) < APTS.nightLit });
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
    return {
      rows: (z0, z1) => { const out = []; for (const z of ctx.floors) if (z > z0 && z < z1) out.push(z); for (const b of bands) { out.push(b.z0, b.z1); } for (const f of floorLines) { out.push(f[0], f[1]); } return out; },
      cols: () => { const out = []; for (const s of stripCols) { out.push(s[0], s[1]); } return out; },
      tone: (zm, sm) => {
        for (const f of floorLines) if (zm > f[0] && zm < f[1]) return f[2];
        for (const b of bands) if (zm > b.z0 && zm < b.z1) return P[b.tone];
        for (const s of stripCols) if (sm > s[0] && sm < s[1]) return P[strip.tone];
        return field;
      },
      windows: windowsFromBays(spec, ctx, P, key),
      glass: spec.glass, frame: spec.frame, reveal: spec.reveal,
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

  const SKINS = { pixel: skinPixel, bays: skinBays, storefront: skinStorefront, flat: skinFlat };

  /** the floor lines of a block between z0 and z1, from the building's levels */
  function floorsBetween(levels, z0, z1) {
    const out = [];
    for (const z of levels) if (z >= z0 - 1e-6 && z < z1 - 0.5) out.push(z);
    return out;
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
    for (const fz of floors) {
      const z = fz + (spec.lift || 0);
      box(B, W, s0, s1, 0, proj, z, z + t, slab, { back: true });
      // rails: front, and the two returns; a thin box each
      box(B, W, s0, s1, proj - rt, proj, z + t, z + t + rh, rail, { back: true });
      box(B, W, s0, s0 + rt, 0, proj - rt, z + t, z + t + rh, rail, { back: true });
      box(B, W, s1 - rt, s1, 0, proj - rt, z + t, z + t + rh, rail, { back: true });
      count.balconies++;
    }
  }

  // ── signs ────────────────────────────────────────────────────────────
  /** Dot-matrix lettering on a wall; horizontal (reads along s) or vertical (letters stacked, top first). */
  function sign(B, W, spec, P) {
    const dot = spec.dot || APTS.signDot, gap = spec.gap != null ? spec.gap : dot;   // letter gap
    const col = P[spec.tone || 'sign'];
    const text = (spec.text || '').toUpperCase();
    const proud = APTS.signProud;
    const letterW = 5 * dot, letterH = 7 * dot;
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
        const g = FONT[ch] || FONT[' '];
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
        const g = FONT[ch] || FONT[' '];
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
  function drawWall(B, F, W, s0, s1, bands, spec, P, key) {
    const len = s1 - s0;
    if (len < 0.05) return;
    // a sub-frame starting at s0 so skins see s from 0
    const sub = { at: (s, d, z) => W.at(s0 + s, d, z), T: W.T, N: W.N, L: len, a: W.a, b: W.b, dir: W.dir, n: W.n };
    for (const band of bands) {
      const z0 = band.z0, z1 = band.z1;
      if (z1 - z0 < 0.05) continue;
      const sk = spec.skins[band.skin];
      if (!sk) { console.warn('[slopes-apartments] no skin', band.skin); continue; }
      const ctx = { len, z0, z1, floors: floorsBetween(spec.levels.floors, z0, z1), key: key + '|' + band.skin };
      const skin = SKINS[sk.kind](sk, ctx, P, ctx.key);
      tileFace(B, { W: sub, len, z0, z1 }, skin, P);
      // balconies riding this band: each is a stack on the sub-frame
      if (APTS.balconies && band.balconies) {
        for (const bs of band.balconies) balconyStack(B, sub, Object.assign({}, spec.balcony || {}, bs), ctx.floors, P);
      }
      if (APTS.signs && band.signs) for (const sg of band.signs) sign(B, sub, sg, P);
    }
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

    for (const blk of spec.blocks || []) {
      count.blocks++;
      const bands = blk.bands || [];
      const zTop = blk.z1;
      top = Math.max(top, zTop + (blk.parapet || 0));
      // the plan: the footprint ring, a (u, v) polygon, or a rectangle [u0, u1, v0, v1]
      const isRect = Array.isArray(blk.plan) && blk.plan.length === 4 && typeof blk.plan[0] === 'number';
      const planUV = blk.plan === 'footprint' ? ringUV : (isRect ? rectRing(blk.plan) : blk.plan);
      const walls = ringWalls(F, planUV);
      const keys = isRect ? RECT_SIDES : walls.map((_, i) => String(i));
      for (let i = 0; i < walls.length; i++) {
        const W = walls[i];
        const face = blk.faces ? (keys[i] in blk.faces ? blk.faces[keys[i]] : blk.faces['*']) : undefined;
        if (face === null) continue;                       // a face against another block: not drawn
        let bd = (face && face.bands) || bands;
        if (face && face.z0 != null) bd = bd.map(b => Object.assign({}, b, { z0: Math.max(b.z0, face.z0) }));
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
        for (const [a, b, pb] of pieces) drawWall(B, F, W, a, b, pb, spec, P, key + '|' + blk.id + '|' + keys[i]);
      }
      // the roof: the plan at z1 (earcut through slopes.build().polygon), then the parapet on the named edges
      const cap = planUV.map(p => F.at(p[0], p[1], zTop));
      B.polygon(cap, P[blk.roofTone || 'roof'], [0, 0, 1], 'xy');
      if (blk.parapet) {
        const sides = blk.parapetSides || keys;
        for (let i = 0; i < walls.length; i++) if (sides.includes(keys[i])) box(B, walls[i], 0, walls[i].L, -APTS.parapetT, 0, zTop, zTop + blk.parapet, P[blk.parapetTone || 'coping'], { bottom: true });
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
      for (const it of blk.roofItems || []) {
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
    return { name: spec.name, top, frame: F };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  THE GROUP, THE FILTERS, THE SWITCH
  // ══════════════════════════════════════════════════════════════════════
  let _built = [];
  function build() {
    const T = window.THREE, S = window.slopes;
    const t0 = performance.now();
    count.buildings = 0; count.blocks = 0; count.faces = 0; count.cells = 0; count.windows = 0; count.balconies = 0; count.signs = 0; count.names = [];
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

  /** hide the replaced prisms and the westcampus bands while the mesh draws; put them back when it does not */
  function setFilters(on) {
    const map = _map;
    if (!map) return;
    const gone = _data.replacedBuildingIds || [];
    const names = _data.replacedNames || [];
    const notReplaced = ['!', ['in', ['get', 'id'], ['literal', gone]]];
    const notNamed = ['!', ['in', ['get', 'name'], ['literal', names]]];
    const plan = [];
    if (gone.length) for (const id of ['buildings-3d', 'buildings-roof']) plan.push([id, notReplaced]);
    if (names.length) for (const id of ['wc-wall', 'wc-wall-cap', 'wc-solid', 'wc-detail']) plan.push([id, notNamed]);
    if (on) {
      for (const [id, clause] of plan) {
        if (!map.getLayer(id)) continue;
        const f = map.getFilter(id) || null;
        if (JSON.stringify(f).indexOf(JSON.stringify(clause)) >= 0) continue;   // already ours (a re-apply)
        if (!(id in _origFilters)) _origFilters[id] = f;
        try { map.setFilter(id, f ? ['all', f, clause] : clause); } catch (e) { console.warn('[slopes-apartments] filter', id, e); }
      }
      _filtered = true;
    } else if (_filtered) {
      for (const id of Object.keys(_origFilters)) {
        if (!map.getLayer(id)) continue;
        try { map.setFilter(id, _origFilters[id]); } catch (e) {}
        delete _origFilters[id];
      }
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
    for (const b of _built) heights[b.name] = b.top;
    const extra = [];
    for (const f of buildings.features) {
      const h = heights[f.properties && f.properties.name];
      if (h) extra.push({ type: 'Feature', geometry: f.geometry, properties: { h } });
    }
    if (!extra.length) return 'no matching footprints';
    window.__flyRebuildCollision({ buildings, parts: { type: 'FeatureCollection', features: ((parts && parts.features) || []).concat(extra) } });
    return 'rebuilt with ' + extra.length + ' corrected heights';
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
    map.triggerRepaint();
  };

  window.slopesApartments = {
    rebuild() { if (_group) { window.slopes.remove(_group); _group = null; } window.applySlopesApartments(); },
    get count() { return Object.assign({}, count, { names: count.names.slice() }); },
    get group() { return _group; },
    get data() { return _data; },
    get filtered() { return _filtered; },
    get built() { return _built.map(b => ({ name: b.name, top: b.top })); },
    obbOf, h01,
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
    const orig = window.applySlopesSettings;
    if (typeof orig === 'function' && !orig.__aptsHooked) {
      const wrapped = function (m) { const r = orig.apply(this, arguments); try { window.applySlopesApartments(m); } catch (e) {} return r; };
      wrapped.__aptsHooked = true;
      window.applySlopesSettings = wrapped;
    }
    window.applySlopesApartments(map);
    console.log('[slopes-apartments]', count.buildings, 'building(s):', count.names.join(', '), '—', count.blocks, 'blocks,', count.faces, 'faces,', count.cells, 'cells,', count.windows, 'windows,', count.balconies, 'balconies,', count.signs, 'signs in', count.triangles, 'triangles,', count.ms, 'ms; collision:', extendCollision(map));
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
