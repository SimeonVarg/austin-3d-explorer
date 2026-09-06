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
 * half-ellipse section at each one, the top left open and closed with a
 * recessed dark deck strip so the hollow reads from above — which is what
 * tells you they are boats.
 *
 * AND WHAT THAT SHELL LOOKED LIKE UNTIL 2026-09-06, because it is the one
 * failure this file has repeated. The section tapered to a point at BOTH ends
 * and both ends curled up (rocker on the keel, sheer on the gunwale), the
 * beam was 0.82 m off a foreshortened photograph, and seventy of them came off
 * a Fibonacci lattice over the FULL sphere from a point-sized hub. Every one
 * of those decisions is defensible on its own and together they draw an agave:
 * the paired judge frames (scratchpad judge/sculptures/monochrome/A.png ours,
 * B.png Google Earth) read ours as "roughly forty identical needle-thin spikes
 * (length-to-width about 15:1) ... every tip curling upward like a leaf,
 * filling a full sphere so the lower spikes reach the ground", against a
 * reference that is "a lumpy, asymmetric silver mass with a dozen-odd blunt
 * lobes of about 5:1 ... clearly a pile of hulls". So the hull is now a BOAT:
 * one pointed bow, one squared transom, a straight keel and a straight
 * gunwale, 1.05 m in the beam against 4.5-5.5 m of length (4.8:1), rolled and
 * jittered, dealt into three clumps over a hemisphere biased upward, hanging
 * off a 1.1 m knot of overlapping sterns on a steel column that leaves 7 m of
 * open air under the cloud. Numbers and sources: data/art3d/*.json.
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
      seed: 'rubins2015',
    },

    // ── The hull profile ────────────────────────────────────────────────
    // The exponents that decide whether a hull reads as a boat or as a needle,
    // and they are ASYMMETRIC as of 2026-09-06: one pointed bow at u = +1 (the
    // outer end) and one squared transom at u = -1 (the end bolted to the
    // core). `bowPow` is how far down the length the plan stays full before it
    // closes into the bow (3 holds full beam past mid-length and closes over
    // the last third, which is what the reference hull does); `sternPow` is
    // how the run narrows to the transom. `kickPow` is how abruptly the keel
    // and the gunwale turn up at the ends IF the data asks for rocker or sheer
    // — the data now asks for neither, because both ends curling up is what
    // made seventy hulls read as an agave.
    // `deckW` is the open cockpit's half-width as a fraction of the hull's:
    // the rest is the GUNWALE RIM, and the rim is what stops a hull reading as
    // a black slot from above. At 0.94 (the first pass) the recess covered the
    // whole top face and seventy hulls seen from the air were seventy dark
    // gashes; the reference nadir is a burst of BRIGHT pointed shapes.
    prof: { bowPow: 3, sternPow: 2.5, kickPow: 6, beamPow: 0.42, depthPow: 0.35, deckW: 0.70 },

    // ── Circle with Towers ──────────────────────────────────────────────
    circle: {
      on: true,
      // The top course of the wall and of every tower is drawn as its own
      // band, one block deep, in the cap tone. In the aerial that coping is
      // the brightest thing on the piece — a fan of block tops catching the
      // sky — and without it the wall is a smooth pale ribbon.
      capH: 0.2032,        // one course
      // 21 courses on a 4.3 m tower is one line per 6 cm of screen at walking
      // distance and a moire at cruise, so the coursing on a face is a tone
      // rather than a groove per course. The wall's palisade is real geometry
      // because it is 0.23 m and radial; a bed joint is 10 mm and is not.
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

  const PROF = ART3D.prof;
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
   * long axis pointing at the BOW, `L` its length. Stations run stern to bow
   * along `dir`; at each one a half-ellipse section is swept from gunwale to
   * keel to gunwale. The plan closes to a point at the bow (u = +1) and to a
   * flat TRANSOM of `transom` x beam at the stern (u = -1), which is then
   * capped. `roll` turns the hull about its own long axis. The top is left
   * open and closed by a recessed deck strip.
   */
  function hull(B, p, dir, L, beam, depth, rocker, sheer, colOut, colIn, stations, sides, deckDrop, transom, roll) {
    const T = norm(dir);
    // A stable pair of axes across the hull. `up` is world up unless the hull
    // is near-vertical, in which case any horizontal reference will do.
    const ref = Math.abs(T[2]) > 0.97 ? [1, 0, 0] : [0, 0, 1];
    let N = norm(cross(T, ref));          // across the beam
    let U = norm(cross(N, T));            // the hull's own "up"
    // Roll about the long axis, so no two hulls in the cluster present the
    // same face to the camera.
    if (roll) {
      const cr = Math.cos(roll), sr = Math.sin(roll);
      const N2 = [N[0] * cr + U[0] * sr, N[1] * cr + U[1] * sr, N[2] * cr + U[2] * sr];
      const U2 = [U[0] * cr - N[0] * sr, U[1] * cr - N[1] * sr, U[2] * cr - N[2] * sr];
      N = N2; U = U2;
    }
    const TR = Math.max(0, Math.min(1, transom || 0));

    // THE PROFILE, AND IT IS READ OFF ONE PHOTOGRAPH RATHER THAN REASONED.
    // Landmarks' own detail frame (photo Paul Bardagjy) shows a hull whose
    // gunwale is essentially STRAIGHT down its length, whose beam is nearly
    // full at mid-length and closes over the last third into ONE pointed end,
    // and whose other end is a flat cut. So: the plan runs on u^bowPow forward
    // of amidships and closes to `transom` aft of it, and the keel and the
    // gunwale are straight lines unless the data asks for rocker or sheer
    // (it does not — see `profileSource` in the data; both ends curling up is
    // exactly what made the cluster read as an agave).
    const full = u => (u >= 0
      ? Math.max(0, 1 - Math.pow(u, PROF.bowPow))
      : Math.max(0, 1 - (1 - TR) * Math.pow(-u, PROF.sternPow)));
    const kick = u => Math.pow(Math.abs(u), PROF.kickPow);
    const halfB = u => (beam / 2) * Math.pow(full(u), PROF.beamPow);
    const dep = u => depth * Math.pow(full(u), PROF.depthPow);
    const keel = u => L * rocker * kick(u) - dep(u);    // rises at the ends
    const gun = u => L * sheer * kick(u);               // sheer line

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
    // THE TRANSOM. With a squared stern the section at u = -1 is no longer a
    // point, so the shell ends in an open half-ellipse that you can see
    // straight through from behind — a hole where the flat plate should be.
    // Close it with a fan about that section's own centre. (A hull with
    // transom 0 — a cable, or a canoe — degenerates to zero-area triangles
    // and costs nothing.)
    if (TR > 0.01) {
      const c = axis(-1);
      for (let j = 0; j < sides - 1; j++) {
        const t0 = Math.PI * j / (sides - 1), t1 = Math.PI * (j + 1) / (sides - 1);
        B.tri(c, at(-1, t0), at(-1, t1), colOut, [-T[0], -T[1], -T[2]]);
      }
    }

    // The open deck: a strip between the two gunwales, dropped into the hull.
    if (deckDrop > 0) {
      const deck = u => {
        const b = halfB(u) * PROF.deckW, g = gun(u) - dep(u) * deckDrop;
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
    const place = [];
    // THE PLACEMENT RULE, AND IT IS THE PHYSICAL ONE. Every hull is BOLTED TO
    // A CENTRAL ARMATURE ("draws its support from a steel armature and
    // intertwining cables", Landmarks), so their STERNS converge on the core
    // and their pointed bows radiate. Place the inner end, not the centre, and
    // the dense middle and the spiky outline both fall out of it.
    //
    // WHAT CHANGED 2026-09-06, AND IT IS THE WHOLE SILHOUETTE. Directions came
    // off a FIBONACCI LATTICE over the full sphere — even coverage, every
    // direction, including straight down. That is the definition of a sea
    // urchin, and the paired judge frames say so: ours read as "an agave or
    // sea urchin ... a perfect radial from a single point-sized hub, filling a
    // full sphere so the lower spikes reach the ground", the reference as "a
    // lumpy, asymmetric silver mass with a dozen-odd blunt lobes ... in two or
    // three clumps". So the lattice is gone. The hulls are dealt round
    // `clumps` anchor bearings, each with its own rake, and thrown off it by
    // ±clumpSpreadAz / ±clumpSpreadEl; elevation is clamped to elMin..elMax,
    // which is a HEMISPHERE BIASED UP rather than a sphere. Everything below
    // is in the data and every one of them is a one-line edit.
    const D2R = Math.PI / 180;
    const nC = Math.max(1, C.clumps | 0);
    const elC = C.clumpEl || [40];
    const azS = (C.clumpSpreadAz || 0) * D2R, elS = (C.clumpSpreadEl || 0) * D2R;
    const elLo = (C.elMin || 0) * D2R, elHi = (C.elMax || 0) * D2R;
    for (let i = 0; i < H.count; i++) {
      const k = i % nC;
      // The clump's own anchor: evenly spaced in plan, its own rake, and an
      // offset per clump so three clumps are not three spokes of one wheel.
      const az0 = 2 * Math.PI * (k / nC + 0.11 * hash01(M.seed, 977 * k + 13));
      const el0 = (elC[k % elC.length] || 0) * D2R;
      const az = az0 + azS * (hash01(M.seed, 7 * i + 1) - 0.5) * 2;
      let el = el0 + elS * (hash01(M.seed, 7 * i + 2) - 0.5) * 2;
      el = Math.max(elLo, Math.min(elHi, el));
      let dir = norm([Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)]);
      // ±15° of yaw-and-pitch jitter on top, so no two hulls are parallel.
      const ja = 2 * Math.PI * hash01(M.seed, 7 * i + 3);
      const jm = C.jitter * (hash01(M.seed, 7 * i + 4) - 0.5) * 2;
      const perp = norm(cross(dir, Math.abs(dir[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1]));
      const perp2 = norm(cross(dir, perp));
      dir = norm([dir[0] + jm * (Math.cos(ja) * perp[0] + Math.sin(ja) * perp2[0]),
                  dir[1] + jm * (Math.cos(ja) * perp[1] + Math.sin(ja) * perp2[1]),
                  dir[2] + jm * (Math.cos(ja) * perp[2] + Math.sin(ja) * perp2[2])]);
      // Length in the measured band, then ±lenJitter about it.
      const L0 = H.lenMin + (H.lenMax - H.lenMin) * hash01(M.seed, 131 * i + 7);
      const L = L0 * (1 + (H.lenJitter || 0) * (hash01(M.seed, 131 * i + 11) - 0.5) * 2);
      // THE KNOT. The inner end sits anywhere inside a ball of radius coreR
      // about the core (cube root, so the ball fills evenly rather than
      // crowding its skin), and seven hulls in ten hang off it by the stern
      // while the rest are gripped nearer mid-length and push their transom
      // out the far side. Seventy overlapping sterns is the ~1 m armature
      // knot the reference has and the point-hub we drew did not.
      const rin = C.coreR * Math.cbrt(hash01(M.seed, 7 * i + 5));
      const byStern = hash01(M.seed, 7 * i + 6) < (C.sternShare == null ? 1 : C.sternShare);
      const c = add3([0, 0, C.centreZ], dir, rin + L * (byStern ? 0.5 : 0.30));
      // THE SECOND RANK. Rubins bolts boats to each OTHER, not seventy of them
      // to one knot, and seventy sterns inside a 0.55 m ball diverge like a
      // sparkler: air where the reference has aluminium. So a share of the
      // hulls are displaced off the armature by up to `rank2R` in a RANDOM
      // direction — sideways as often as outward, so the mass fills without
      // the silhouette widening.
      if (C.rank2R && hash01(M.seed, 7 * i + 8) < (C.rank2Share || 0)) {
        const oa = 2 * Math.PI * hash01(M.seed, 131 * i + 23);
        const oe = Math.asin(2 * hash01(M.seed, 131 * i + 29) - 1);
        const om = C.rank2R * Math.cbrt(hash01(M.seed, 131 * i + 31));
        c[0] += om * Math.cos(oe) * Math.cos(oa);
        c[1] += om * Math.cos(oe) * Math.sin(oa);
        c[2] += om * Math.sin(oe);
      }
      const roll = (C.roll || 0) * (hash01(M.seed, 131 * i + 17) - 0.5) * 2;
      place.push([c, dir, L, i, roll]);
    }

    for (const [c, dir, L, i, roll] of place) {
      // Keep every hull clear of the pavement: this is a cantilever, and a
      // hull tip through the ground is the one thing that would give it away.
      const low = c[2] - L * 0.5 * Math.abs(dir[2]);
      if (low < C.floorZ) c[2] += C.floorZ - low;
      const bright = i % mat.brightEvery === 0;
      hull(B, c, dir, L, H.beam, H.depth, H.rocker, H.sheer,
           bright ? colBright : colHull, colIn, stations, sides, ART3D.mono.deckDrop,
           H.transom, roll);
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
   * The wall is 108 radial block FINGERS round a 7.82 m circle: each a
   * rectangle 0.1937 m across the face by 0.4064 m deep — a block — turned to
   * its own bearing with its INNER face on the inner radius, so adjacent
   * fingers touch inside and splay to an open wedge outside. That palisade is
   * what the outer face of a radially-laid wall looks like and it is the piece
   * from any distance.
   *
   * The eight TOWERS are NOT that, and reading them as fingers carried up was
   * this file's own error, corrected by looking again at Landmarks' aerial at
   * full resolution: a tower's faces are plain RUNNING-BOND stretchers — 2:1
   * block faces with staggered vertical joints — on a square pier. The deep
   * vertical grooves that suggested fingers in the level ground view are LEAF
   * SHADOW; the same frame carries soft diagonal bands of it across the
   * building behind. So a tower is one square pier, 21 courses tall, its outer
   * face flush with the wall's and the rest of its depth standing proud into
   * the circle, with the wall's own fingers stopping where it stands.
   */
  function buildCircle(B, D, detail) {
    const CI = ART3D.circle, blk = D.block, mat = D.material;
    const Rout = D.dims.diameter / 2;
    const nF = D.fingers.count;
    const wallH = D.wall.courses * blk.course;
    const towH = D.towers.courses * blk.course;
    const wallDeep = D.wall.radialBlocks * blk.length;
    const towSide = D.towers.sideBlocks * blk.length;      // tangential and radial
    const col = triple(mat, ''), colCap = [mat.capDay || mat.day, mat.capGolden || mat.golden, mat.capNight || mat.night];

    // Where each tower stands, and which fingers it stands on top of.
    const half = towSide / 2;
    const skip = new Array(nF).fill(false);
    const towerAt = [];
    for (const bd of D.towers.bearings) {
      // Bearing is degrees clockwise from north; local +y is north, +x is east.
      const a = (90 - bd) * Math.PI / 180;
      towerAt.push(a);
      // The angular half-width the pier covers at the outer radius.
      const dA = Math.atan2(half, Rout);
      for (let i = 0; i < nF; i++) {
        let d = 2 * Math.PI * i / nF - a;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        if (Math.abs(d) <= dA) skip[i] = true;
      }
    }

    let fingers = 0;
    for (let i = 0; i < nF; i++) {
      if (skip[i]) continue;
      const a = 2 * Math.PI * i / nF;
      const rc = Rout - wallDeep / 2;
      const cx = rc * Math.cos(a), cy = rc * Math.sin(a);
      // The face is `blk.face` across; the pitch at the outer radius is wider,
      // and the difference is the open wedge the palisade reads by.
      box(B, cx, cy, wallDeep, blk.face, ART3D.lift, ART3D.lift + wallH - CI.capH, col, a);
      // The coping course, laid flat and proud of the face: in the aerial it is
      // a fan of block tops and it is the brightest thing on the piece.
      box(B, cx, cy, wallDeep, blk.face, ART3D.lift + wallH - CI.capH, ART3D.lift + wallH, colCap, a);
      fingers++;
    }
    for (const a of towerAt) {
      const rc = Rout - towSide / 2;
      const cx = rc * Math.cos(a), cy = rc * Math.sin(a);
      box(B, cx, cy, towSide, towSide, ART3D.lift, ART3D.lift + towH - CI.capH, col, a);
      box(B, cx, cy, towSide, towSide, ART3D.lift + towH - CI.capH, ART3D.lift + towH, colCap, a);
    }
    return { fingers, towers: towerAt.length };
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
