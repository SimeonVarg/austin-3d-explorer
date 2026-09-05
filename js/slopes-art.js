/**
 * slopes-art.js — the two campus artworks that are shapes, not stacks.
 *
 * WHY THIS FILE EXISTS. scripts/bake_art.py draws all 34 Landmarks pieces as
 * fill-extrusion parts, and a fill-extrusion is ALWAYS VERTICAL: MapLibre takes
 * a polygon and pushes it straight up. Its own header says so, and says what it
 * cost on these two:
 *
 *   Monochrome for Austin  seventy aluminium canoes cantilevered off a mast at
 *     real angles, drawn as a cloud of pointed SLABS, because a hull that leans
 *     has to be approximated by a run of vertical prisms. Simeon: "still blocky".
 *   Circle with Towers  a low ring wall of concrete block with towers on it,
 *     drawn as a 3 m ring with sixteen posts between the eight towers — and the
 *     bake's own comment: sixteen posts "turn a wall into a colonnade, which is
 *     the opposite of what LeWitt built". Simeon: "should be more accurate".
 *
 * Both are exactly what the three.js slopes layer exists for. Nothing is
 * deleted: while this group draws, the two pieces' `artpart` slabs are hidden
 * by a filter on js/props.js's own layer, and they come straight back the
 * moment the switch goes off.
 *
 * WHAT WAS READ, AND FROM WHERE. data/art3d/*.json carries every measurement
 * with its source beside it. The two findings that changed the geometry:
 *
 *   LeWitt's published "168 x 308 inches diameter" is stated in the BLOCK
 *   MODULE — 168 in is exactly 21 courses of 8 in nominal CMU. So the piece is
 *   not a ring and eight posts, it is 108 radial block FINGERS round a circle,
 *   five courses high, of which eight runs of five fingers carry on up to 21.
 *   The outer face of a radially-laid wall is a palisade of block ends with an
 *   open wedge between them, and that texture is the piece from any distance.
 *
 *   Rubins' hulls RADIATE. In every photograph each hull's long axis points out
 *   from the core, inner end buried, pointed end clear of the mass. bake_art.py
 *   gave each hull an independent random heading, and an uncorrelated cloud of
 *   sticks is a lump however many of them there are. That, not the slab
 *   section, is why the old one read as a silver tree.
 *
 * HOW A HULL IS DRAWN. A real shell, not a prism: stations along the hull, a
 * half-ellipse section at each one whose half-beam and depth both taper to zero
 * at bow and stern, with the keel rockered and the gunwale sheered up at the
 * ends. The top is left open and closed with a recessed dark deck strip, so the
 * hollow reads from above — which is what tells you they are boats.
 *
 * THE SWITCH. `?art3d=0` at load, or `window.ART3D.on = false` from the
 * console. Off, the picture is what main draws.
 *
 * Public (window) API:
 *   ART3D                  — the taste block; ART3D.on is the switch
 *   slopesArt.rebuild()    — rebuild after a taste edit or a preset change
 *   slopesArt.count        — { pieces, hulls, fingers, triangles, ms, done }
 *   slopesArt.group        — the THREE.Group, or null
 *   slopesArt.filtered     — whether the slabs are hidden right now
 *   applySlopesArt(map)    — re-evaluate the filter and the group
 */
(function () {
  'use strict';

  // ══════════════════════════════════════════════════════════════════════
  //  TASTE BLOCK — CLAUDE.md rule 11. Every aesthetic call is a named
  //  constant here, overrulable with a one-line edit in the console.
  // ══════════════════════════════════════════════════════════════════════
  const ART3D = {
    on: new URLSearchParams(window.location.search).get('art3d') !== '0',

    // js/props.js's authored-artwork layer and its source. The slabs for the
    // two pieces below are hidden by name while this group draws.
    layer: 'props-artpart',
    pieces: [
      { name: 'Monochrome for Austin', url: 'data/art3d/monochrome-for-austin.json', build: 'monochrome' },
      { name: 'Circle with Towers',    url: 'data/art3d/circle-with-towers.json',    build: 'circle' },
    ],

    // A 4 m ring and a 15 m burst of boats are noise below this; the same
    // number js/props.js draws its art at, read live from window.PROPS.
    minzoom: 15.5,
    lod: null,          // these are small and local; the LOD ring is for the skyline

    // ── Monochrome for Austin ───────────────────────────────────────────
    mono: {
      on: true,
      // Stations along a hull and sides round its half-section, x slopes.detail().
      // 11 x 9 puts a 5 m hull's silhouette within a few centimetres of the
      // curve it samples, and 70 of them cost about 12,000 triangles.
      stations: 11,
      sides: 9,
      // How deep the open deck sits below the gunwale, as a fraction of hull
      // depth. The dark recess is what says "boat" from above; 0 closes it flush
      // and the hull reads as a solid pod.
      deckDrop: 0.30,
      cables: true,
      // A hull nearer the top of the cloud is turned to point more steeply up:
      // the photographs' upper hulls rake toward the sky, the lower ones splay
      // out and down. 0 makes an even sea urchin.
      rakeWithHeight: 0.55,
      seed: 'rubins2015',
    },

    // ── Circle with Towers ──────────────────────────────────────────────
    circle: {
      on: true,
      // Draw the recessed joint between two fingers as a darker strip rather
      // than as geometry: at 1 px per 0.2 m the wedge is a colour, not a shape,
      // and js/slopes-dome.js's drum windows make the same call.
      jointStrips: true,
      // How far the finger's own face is inset from the block face at the
      // wedge, in metres — the shadow line that makes the palisade read.
      jointInset: 0.018,
      // Every course line drawn, or every nth. 21 courses on a 4.3 m tower is
      // one line per 6 cm of screen at walking distance and a moiré at cruise,
      // so the coursing is a tone on the face rather than a groove per course.
      courseLines: false,
    },

    // The one number that is not measured: how much the whole group is lifted
    // off z=0 so it does not z-fight the ground plane at grazing angles.
    lift: 0.01,
  };
  window.ART3D = ART3D;

  const NAMES = ART3D.pieces.map(p => p.name);

  let _map = null, _group = null, _data = null, _lastDetail = null;
  let _filtered = false, _origFilter = null;
  const count = { pieces: 0, hulls: 0, fingers: 0, towers: 0, triangles: 0, ms: 0, done: false };

  /** The bake's own hash, so a placement is reproducible and reviewable. */
  function hash01(seed, i) {
    let h = 2166136261 >>> 0;
    const s = seed + ':' + i;
    for (let k = 0; k < s.length; k++) { h ^= s.charCodeAt(k); h = Math.imul(h, 16777619) >>> 0; }
    return ((h >>> 8) & 0xffffff) / 0xffffff;
  }

  const norm = v => { const L = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / L, v[1] / L, v[2] / L]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const add3 = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];

  const triple = (m, k) => [m[k + 'Day'] || m.day, m[k + 'Golden'] || m.golden, m[k + 'Night'] || m.night];

  /** A rectangular box, optionally turned `rot` radians anticlockwise from +x. */
  function box(B, cx, cy, w, d, z0, z1, col, rot) {
    const c = Math.cos(rot || 0), s = Math.sin(rot || 0);
    const hw = w / 2, hd = d / 2;
    const P = (u, v, z) => [cx + u * c - v * s, cy + u * s + v * c, z];
    const a0 = P(-hw, -hd, z0), b0 = P(hw, -hd, z0), c0 = P(hw, hd, z0), d0 = P(-hw, hd, z0);
    const a1 = P(-hw, -hd, z1), b1 = P(hw, -hd, z1), c1 = P(hw, hd, z1), d1 = P(-hw, hd, z1);
    B.quad(a1, b1, c1, d1, col, [0, 0, 1]);                       // top
    B.quad(a0, b0, b1, a1, col, [-s, c, 0].map(v => -v));         // -v face
    B.quad(c0, d0, d1, c1, col, [-s, c, 0]);                      // +v face
    B.quad(b0, c0, c1, b1, col, [c, s, 0]);                       // +u face
    B.quad(d0, a0, a1, d1, col, [-c, -s, 0]);                     // -u face
  }

  // ══════════════════════════════════════════════════════════════════════
  //  MONOCHROME FOR AUSTIN
  // ══════════════════════════════════════════════════════════════════════

  /**
   * One hull, as a shell. `p` is its centre in local metres, `dir` its unit
   * long axis, `L` its length. Stations run bow to stern along `dir`; at each
   * one a half-ellipse section is swept from gunwale to keel to gunwale, with
   * the half-beam and the depth both going to zero at the ends (so the bow and
   * stern are points, not blunt cuts), the keel rockered up and the gunwale
   * sheered up. The top is left open and closed by a recessed deck strip.
   */
  function hull(B, p, dir, L, beam, depth, rocker, sheer, colOut, colIn, stations, sides, deckDrop) {
    const T = norm(dir);
    // A stable pair of axes across the hull. `up` is world up unless the hull
    // is near-vertical, in which case any horizontal reference will do.
    const ref = Math.abs(T[2]) > 0.97 ? [1, 0, 0] : [0, 0, 1];
    const N = norm(cross(T, ref));        // across the beam
    const U = norm(cross(N, T));          // the hull's own "up"

    const halfB = u => (beam / 2) * Math.pow(Math.max(0, 1 - u * u), 0.62);
    const dep = u => depth * Math.pow(Math.max(0, 1 - u * u), 0.45);
    const keel = u => L * rocker * u * u - dep(u);      // rises at the ends
    const gun = u => L * sheer * u * u;                 // sheer line

    const world = (u, v, w) => [p[0] + T[0] * (u * L / 2) + N[0] * v + U[0] * w,
                                p[1] + T[1] * (u * L / 2) + N[1] * v + U[1] * w,
                                p[2] + T[2] * (u * L / 2) + N[2] * v + U[2] * w];
    const at = (u, th) => {
      const b = halfB(u), g = gun(u), k = keel(u);
      return world(u, b * Math.cos(th), g - (g - k) * Math.sin(th));
    };
    // The section's own centre line, so each quad can be wound to face OUT.
    // A half-ellipse is convex about it, so surface-minus-centre is the outward
    // direction at every station and every angle — and a shell wound the wrong
    // way is invisible under FrontSide, which is a silent failure.
    const axis = u => world(u, 0, (gun(u) + keel(u)) / 2);

    for (let i = 0; i < stations - 1; i++) {
      const u0 = -1 + 2 * i / (stations - 1), u1 = -1 + 2 * (i + 1) / (stations - 1);
      const c0 = axis(u0), c1 = axis(u1);
      for (let j = 0; j < sides - 1; j++) {
        const t0 = Math.PI * j / (sides - 1), t1 = Math.PI * (j + 1) / (sides - 1);
        const a = at(u0, t0), b = at(u1, t0), c = at(u1, t1), d = at(u0, t1);
        const mid = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2];
        const ctr = [(c0[0] + c1[0]) / 2, (c0[1] + c1[1]) / 2, (c0[2] + c1[2]) / 2];
        B.quad(a, b, c, d, colOut, [mid[0] - ctr[0], mid[1] - ctr[1], mid[2] - ctr[2]]);
      }
    }
    // The open deck: a strip between the two gunwales, dropped into the hull.
    if (deckDrop > 0) {
      const deck = u => {
        const b = halfB(u) * 0.94, g = gun(u) - dep(u) * deckDrop;
        return [-1, 1].map(sgn => [p[0] + T[0] * (u * L / 2) + N[0] * sgn * b + U[0] * g,
                                   p[1] + T[1] * (u * L / 2) + N[1] * sgn * b + U[1] * g,
                                   p[2] + T[2] * (u * L / 2) + N[2] * sgn * b + U[2] * g]);
      };
      for (let i = 0; i < stations - 1; i++) {
        const u0 = -1 + 2 * i / (stations - 1), u1 = -1 + 2 * (i + 1) / (stations - 1);
        const a = deck(u0), b = deck(u1);
        B.quad(a[0], b[0], b[1], a[1], colIn, U);
      }
    }
  }

  function buildMonochrome(B, D, detail) {
    const M = ART3D.mono, C = D.cloud, H = D.hulls, mat = D.material;
    const stations = Math.max(4, Math.round(M.stations * (0.55 + 0.45 * detail)));
    const sides = Math.max(4, Math.round(M.sides * (0.55 + 0.45 * detail)));
    const colHull = triple(mat, ''), colBright = triple(mat, 'bright');
    const colIn = triple(mat, 'inside'), colSteel = triple(mat, 'steel');
    const colPl = triple(mat, 'plinth');

    // The pier and the armature stub. Small, and that is the point.
    const P = D.plinth, MA = D.mast;
    box(B, 0, 0, P.w, P.d, 0, P.h, colPl);
    box(B, 0, 0, P.w * 1.16, P.d * 1.16, 0, 0.18, colPl);          // a base course
    box(B, 0, 0, MA.w, MA.w, P.h, P.h + MA.h, colSteel);

    let hulls = 0;
    const centre = [0, 0, C.centreZ];
    const place = [];
    for (let i = 0; i < H.count; i++) {
      // Position: a point in the ellipsoid, biased outward by `shell` so the
      // middle stays open the way the photographs' middle is open.
      const u = hash01(M.seed, 4 * i + 1), v = hash01(M.seed, 4 * i + 2), w = hash01(M.seed, 4 * i + 3);
      const th = 2 * Math.PI * v, ph = Math.acos(1 - 2 * w);
      // A hull's CENTRE lives inside `core` of the envelope; its own length
      // then carries the pointed end out to the envelope. Placing the centres
      // ON the envelope (the first pass here) spreads seventy hulls into a
      // thin scattered disc with a hole in the middle — the photographs have a
      // dense tangled core with the tips radiating out of it.
      const rr = C.core * Math.pow(u, 1 / 2.4);
      const nx = rr * Math.sin(ph) * Math.cos(th), ny = rr * Math.sin(ph) * Math.sin(th), nz = rr * Math.cos(ph);
      const p = [C.semiX * nx, C.semiY * ny, C.centreZ + C.semiZ * nz];

      // Orientation: the radial direction out of the core, blended toward an
      // independent random heading by (1 - radial). THE RULE, and the one the
      // old recipe did not have.
      let rad = norm([p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]]);
      // Higher hulls rake up, lower ones splay out and down.
      rad = norm([rad[0], rad[1], rad[2] + M.rakeWithHeight * nz]);
      const ra = 2 * Math.PI * hash01(M.seed, 4 * i + 4);
      const re = (hash01(M.seed, 97 * i + 11) - 0.5) * Math.PI;
      const rnd = [Math.cos(re) * Math.cos(ra), Math.cos(re) * Math.sin(ra), Math.sin(re)];
      const dir = norm([rad[0] * C.radial + rnd[0] * (1 - C.radial),
                        rad[1] * C.radial + rnd[1] * (1 - C.radial),
                        rad[2] * C.radial + rnd[2] * (1 - C.radial)]);

      const L = H.lenMin + (H.lenMax - H.lenMin) * hash01(M.seed, 131 * i + 7);
      // The hull hangs off its inner end, so push its centre out half a length:
      // the pointed end is what juts clear of the mass.
      const c = add3(p, dir, L * 0.30);
      place.push([c, dir, L, i]);
    }

    // The spikes: hulls placed ON the envelope rather than sampled, because a
    // sampled cloud almost never reaches its own outline. Evenly round the
    // horizon plus two high and one low, which is the spread the photographs
    // show; each is a full length clear of the mass.
    for (let s = 0; s < C.spikes; s++) {
      const a = 2 * Math.PI * s / C.spikes + 0.31;
      const el = s % 3 === 0 ? 0.62 : (s % 3 === 1 ? 0.06 : -0.34);
      const n = norm([Math.cos(a) * Math.cos(el), Math.sin(a) * Math.cos(el), Math.sin(el)]);
      const dir = norm([n[0], n[1], n[2] + M.rakeWithHeight * n[2] * 0.5]);
      const L = H.lenMax * (0.92 + 0.08 * hash01(M.seed, 613 + s));
      // The TIP lands on the envelope, so a spike sets the outline exactly
      // rather than overshooting it by its own length.
      const tip = [C.semiX * n[0], C.semiY * n[1], C.centreZ + C.semiZ * n[2]];
      place.push([add3(tip, dir, -L * 0.5), dir, L, 1000 + s]);
    }

    for (const [c, dir, L, i] of place) {
      // Keep every hull clear of the pavement: this is a cantilever, and a
      // hull tip through the ground is the one thing that would give it away.
      const low = c[2] - L * 0.5 * Math.abs(dir[2]);
      if (low < C.floorZ) c[2] += C.floorZ - low;
      const bright = i % mat.brightEvery === 0;
      hull(B, c, dir, L, H.beam, H.depth, H.rocker, H.sheer,
           bright ? colBright : colHull, colIn, stations, sides, ART3D.mono.deckDrop);
      hulls++;
    }

    // The cables: from the armature head out into the mass, and a few ties
    // across it. Drawn over-width so they survive as hairlines (see the data).
    if (M.cables && D.cables) {
      const K = D.cables;
      for (let i = 0; i < K.count; i++) {
        const t = place[Math.floor(hash01(M.seed, 311 * i + 3) * place.length)];
        const from = i % 5 === 0
          ? [0, 0, P.h + MA.h]
          : place[Math.floor(hash01(M.seed, 419 * i + 5) * place.length)][0];
        const to = t[0];
        const d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
        const L = Math.hypot(d[0], d[1], d[2]);
        // Ties inside the tangle, not a suspension bridge across it: a long
        // straight run reads as structure the work does not have.
        if (L < 1.5 || L > K.maxM) continue;
        const dir = norm(d);
        const mid = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2];
        hull(B, mid, dir, L, K.w, K.w, 0, 0, colSteel, colSteel, 3, 4, 0);
      }
    }
    return hulls;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  CIRCLE WITH TOWERS
  // ══════════════════════════════════════════════════════════════════════

  /**
   * 108 radial block fingers round a 7.82 m circle. Each is a rectangle
   * 0.1937 m across the face by 0.4064 m deep — a block — turned to its own
   * bearing, with its INNER face on the inner radius, so adjacent fingers
   * touch inside and splay to an open wedge outside. Five courses everywhere;
   * eight runs of five fingers carry on to 21 courses and are the towers, two
   * blocks deep instead of one so they stand proud into the circle.
   */
  function buildCircle(B, D, detail) {
    const CI = ART3D.circle, blk = D.block, mat = D.material;
    const Rout = D.dims.diameter / 2;
    const nF = D.fingers.count;
    const wallH = D.wall.courses * blk.course;
    const towH = D.towers.courses * blk.course;
    const wallDeep = D.wall.radialBlocks * blk.length;
    const towDeep = D.towers.radialBlocks * blk.length;
    const col = triple(mat, ''), colJoint = [mat.jointDay, mat.golden, mat.night];

    // Which fingers are towers: the run of `fingers` centred on each bearing.
    const isTower = new Array(nF).fill(false);
    let towers = 0;
    for (const bd of D.towers.bearings) {
      // Bearing is degrees clockwise from north; local +y is north, +x is east.
      const a = (90 - bd) * Math.PI / 180;
      const centreIdx = Math.round((a / (2 * Math.PI)) * nF);
      const half = (D.towers.fingers - 1) / 2;
      for (let k = -Math.floor(half + 0.5); k <= Math.floor(half); k++) {
        isTower[((centreIdx + k) % nF + nF) % nF] = true;
      }
      towers++;
    }

    let fingers = 0;
    for (let i = 0; i < nF; i++) {
      const a = 2 * Math.PI * i / nF;
      const tower = isTower[i];
      const deep = tower ? towDeep : wallDeep;
      const h = tower ? towH : wallH;
      // Outer faces flush: the finger runs inward from Rout.
      const rc = Rout - deep / 2;
      const cx = rc * Math.cos(a), cy = rc * Math.sin(a);
      // The face is `blk.face` across; the pitch at the outer radius is wider,
      // and the difference is the open wedge the palisade reads by.
      box(B, cx, cy, deep, blk.face, ART3D.lift, ART3D.lift + h, col, a);
      if (CI.jointStrips) {
        // The wedge, as a darker strip a hair behind the block face on both
        // sides. A colour is the depth.
        const t = blk.face / 2 + CI.jointInset;
        const s = Math.sin(a), c = Math.cos(a);
        for (const sgn of [-1, 1]) {
          const px = cx - s * sgn * t, py = cy + c * sgn * t;
          box(B, px, py, deep * 0.98, CI.jointInset * 1.6, ART3D.lift, ART3D.lift + h - blk.course * 0.5, colJoint, a);
        }
      }
      fingers++;
    }
    return { fingers, towers };
  }

  // ══════════════════════════════════════════════════════════════════════

  function build() {
    const t0 = performance.now();
    const T = window.THREE, S = window.slopes;
    const detail = S.detail();
    const g = new T.Group();
    g.name = 'slopes-art';
    g.userData.lod = ART3D.lod;
    g.userData.minzoom = (window.PROPS && typeof window.PROPS.artMinZoom === 'number')
      ? window.PROPS.artMinZoom : ART3D.minzoom;
    const mat = S.material();
    let pieces = 0, tris = 0;
    count.hulls = 0; count.fingers = 0; count.towers = 0;

    for (const spec of ART3D.pieces) {
      const D = _data[spec.name];
      if (!D) continue;
      if (spec.build === 'monochrome' && !ART3D.mono.on) continue;
      if (spec.build === 'circle' && !ART3D.circle.on) continue;
      const B = S.build();
      try {
        if (spec.build === 'monochrome') count.hulls += buildMonochrome(B, D, detail);
        else { const r = buildCircle(B, D, detail); count.fingers += r.fingers; count.towers += r.towers; }
      } catch (e) { console.warn('[slopes-art]', spec.name, e); continue; }
      if (!B.triangles) continue;
      const m = new T.Mesh(B.geometry(), mat);
      m.name = spec.name;
      const at = D.atFromData && _centres[spec.name] ? _centres[spec.name] : D.at;
      const o = S.toLocal(at[0], at[1], 0);
      m.position.set(o.x, o.y, 0);
      g.add(m);
      tris += B.triangles;
      pieces++;
    }
    count.pieces = pieces;
    count.triangles = Math.round(tris);
    count.ms = +(performance.now() - t0).toFixed(1);
    _lastDetail = detail;
    return g;
  }

  // Where each piece's own slabs sit, so the mesh lands exactly where the label
  // and the footprint already are rather than 3-17 m away at the published GPS.
  const _centres = {};
  function readCentres(gj) {
    for (const nm of NAMES) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, n = 0;
      for (const f of gj.features) {
        if (!f.properties || f.properties.name !== nm) continue;
        for (const ring of (f.geometry.coordinates || [])) {
          for (const [x, y] of ring) {
            if (x < x0) x0 = x; if (x > x1) x1 = x;
            if (y < y0) y0 = y; if (y > y1) y1 = y; n++;
          }
        }
      }
      if (n) _centres[nm] = [(x0 + x1) / 2, (y0 + y1) / 2];
    }
  }

  function setFilter(on) {
    if (!_map || !_map.getLayer(ART3D.layer)) return;
    if (on) {
      if (_filtered) return;
      _origFilter = _map.getFilter(ART3D.layer) || null;
      const hide = ['!', ['in', ['get', 'name'], ['literal', NAMES]]];
      _map.setFilter(ART3D.layer, _origFilter ? ['all', _origFilter, hide] : hide);
      _filtered = true;
    } else if (_filtered) {
      _map.setFilter(ART3D.layer, _origFilter);
      _filtered = false;
    }
  }

  window.applySlopesArt = function applySlopesArt(map) {
    map = map || _map;
    if (!map || !_data) return;
    const S = window.slopes;
    const want = !!(window.SLOPES.on && ART3D.on);
    if (want && !_group) { _group = build(); S.add(_group); }
    else if (want && _group && _lastDetail !== S.detail()) { S.remove(_group); _group = build(); S.add(_group); }
    else if (!want && _group) { S.remove(_group); _group = null; }
    setFilter(want);
    map.triggerRepaint();
  };

  window.slopesArt = {
    rebuild() { if (_group) { window.slopes.remove(_group); _group = null; } window.applySlopesArt(); },
    get count() { return { ...count }; },
    get group() { return _group; },
    get filtered() { return _filtered; },
    get data() { return _data; },
  };

  // ── boot ────────────────────────────────────────────────────────────────
  async function boot() {
    const map = window.__map, S = window.slopes;
    if (!map || !S || !S.root) return false;
    if (window.PROPS && window.PROPS.on === false) { count.done = true; return true; }
    // js/props.js adds this layer only once data/art.geojson has arrived.
    if (!map.getLayer(ART3D.layer)) return false;
    _map = map;
    try {
      const out = {};
      for (const spec of ART3D.pieces) out[spec.name] = await S.fetchJSON(spec.url);
      _data = out;
      readCentres(await S.fetchJSON('data/art.geojson'));
    } catch (e) { console.warn('[slopes-art]', e.message); count.done = true; return true; }
    S.onSwitch(() => window.applySlopesArt(map));
    const orig = window.applySlopesSettings;
    if (typeof orig === 'function' && !orig.__artHooked) {
      const wrapped = function (m) { const r = orig.apply(this, arguments); try { window.applySlopesArt(m); } catch (e) {} return r; };
      wrapped.__artHooked = true;
      window.applySlopesSettings = wrapped;
    }
    window.applySlopesArt(map);
    count.done = true;
    console.log('[slopes-art]', count.pieces, 'pieces:', count.hulls, 'hulls and',
                count.fingers, 'block fingers on', count.towers, 'towers in',
                count.triangles, 'triangles,', count.ms, 'ms');
    return true;
  }
  (function poll() {
    if (new URLSearchParams(location.search).get('slopes') === '0') return;
    if (new URLSearchParams(location.search).get('art3d') === '0') { count.done = true; return; }
    let n = 0, busy = false;
    const t = setInterval(async () => {
      if (busy) return;
      busy = true;
      let done = false;
      try { done = await boot(); } catch (e) { console.error('[slopes-art]', e); done = true; }
      busy = false;
      if (done || ++n > 900) clearInterval(t);
    }, 200);
  })();
})();
