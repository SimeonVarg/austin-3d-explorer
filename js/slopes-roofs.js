/**
 * slopes-roofs.js — the pitched roofs, as the surface their slabs are a
 * staircase of.
 *
 * data/roofs.geojson draws every tiled roof on campus as STEPPED INSET FACETS:
 * scripts/bake_roofs.py offsets the footprint inward in 2–6 equal steps at a
 * 5:12 pitch and emits one flat fill-extrusion slab per wall per step, 3,906
 * of them, because a fill-extrusion cannot slope a face. From the air the
 * steps read as a slope; from a street they read as steps. This file draws
 * the slope those steps are sampled from, in the three.js layer js/slopes.js
 * owns, and hides the slabs by filter while it does.
 *
 * THE SHAPE IS THE BAKE'S, NOT A NEW ONE. bake_roofs.py now writes the rig it
 * built every ring from as the `rig` foreign member of the same file — per
 * roof: the eave profile (`pts`, the footprint's own vertices plus the
 * sample points a long wall gains), the direction each point travels per
 * metre of offset (`rays`, mitred at the corners so a corner slides along the
 * hip), how far each may travel before it reaches the ridge (`caps`), the
 * depth the slope runs to (`d`), and the heights it runs between (`base`,
 * `rise`). A slab ring at step s was `pts[k] + rays[k] * min(d_s, caps[k])`
 * at height `rise * s / steps`. The surface here is the same expression with
 * d continuous:
 *
 *     P_k(d) = pts[k] + rays[k] * min(d, caps[k]),   z(d) = base + lip + rise * d / d_use
 *
 * and the roof is the strip swept between neighbouring profile points as d
 * runs 0 → d_use. Where neither point has reached its cap the strip is the
 * wall's own slope plane; where one has, the strip turns toward the hip; where
 * both have, it is vertical — the fin over a wing's ridge that the slabs also
 * leave standing. Each strip is split at its two caps so every piece is a
 * quad the way the surface really bends. The eave lip (flat top, fascia,
 * soffit) sits outside the wall by `over`, and the deck fills the ring at
 * d_use at the top of the rise, the bake's own "whatever the slope encloses
 * is filled at the top of the slope" — untangled first, because that ring
 * folds by a few centimetres on 43 of the 108 roofs and earcut answers a
 * folded ring with triangles outside it (see `untangle` below). Same eave
 * line, same ridge, same colours
 * (`col` is the roof's settled colour; the slabs' bright/dark ends are the
 * fake-tilt shading js/timeofday.js needs for flat tops and are not used —
 * the real 22.6° face under the real light needs no exaggeration).
 *
 * GREGORY GYM. Its west elevation is hand-authored in data/building_overrides
 * .json and baked by gable_front_parts as prisms: two pediments of 22 courses
 * each, a raking cornice of 1.5 m blocks, and three archivolts of 13 voussoir
 * prisms. Those are the stair-step stand-ins here; the veneer, corbels,
 * recess panels, plaque and stair are already the right shape and stay. The
 * bake writes the elevation's frame and spec as `rig.gables[bid]`, and this
 * file draws the pediments as real triangular prisms (flat crown 1.4 m / 1.2 m
 * wide, exactly the courses' apex), the cornice as one raking band, and each
 * archivolt as a half-ring. The roof behind it also stops hipping against
 * that wall: the two corners slide along the long walls instead of the mitre
 * (ROOFS.gableEnd), so the slopes either side run straight to the deck and
 * the west face is a gable, not a hip with a pediment glued on.
 *
 * WHAT IS HIDDEN, AND HOW. `roofs-pitched` gets the filter
 * ['match', ['get','f'], ROOFS.keep, true, false]: the slabs carry no `f`, the
 * courses / rake / rings carry one that is not kept, the veneer and Jester's
 * precast bands carry one that is. The layer is never removed and its
 * original filter is put back when SLOPES.on goes false. js/lod.js still
 * hides the layer at altitude by visibility, and this group is in the same
 * tier (userData.lod = 'mid') and under the same minzoom, so the roofs and
 * the slabs go and come back together whichever is drawing.
 *
 * Public (window) API:
 *   SLOPES_ROOFS            — the taste block (ROOFS.on is this generator's own switch)
 *   slopesRoofs.rebuild()   — rebuild from the rig (after a taste edit)
 *   slopesRoofs.count       — { roofs, gables, triangles, ms }
 *   slopesRoofs.rig(name)   — the rig entry whose name matches, for scripts
 *   slopesRoofs.emit(B, rig) — draw another file's rig member (the Capitol's wings) into a builder
 *   applySlopesRoofs(map)   — re-evaluate the filter and the group's membership
 */
(function () {
  'use strict';

  // ══════════════════════════════════════════════════════════════════════
  //  TASTE BLOCK — CLAUDE.md rule 11.
  // ══════════════════════════════════════════════════════════════════════
  const ROOFS = {
    on: true,                    // this generator; SLOPES.on is the layer
    layer: 'roofs-pitched',      // the slab layer it stands in for
    source: 'austin-roofs',      // where app.js put the parsed roofs.geojson
    url: 'data/roofs.geojson',   // ...and the fallback if that object is not there
    keep: ['gable', 'band'],     // `f` tags that stay drawn as fill-extrusion
    lod: 'mid',                  // js/lod.js tier — the one `roofs-pitched` is in
    minzoom: 14,                 // roofs-pitched's own minzoom
    fascia: true,                // the eave's outer face, base → base + lip
    soffit: true,                // the eave's underside
    deck: true,                  // the flat top the slope stops at
    gable: true,                 // Gregory Gym's pediments, cornice and archivolts
    gableEnd: true,              // ...and no hip against the gabled wall
    gableWallMaxM: 3.0,          // how far the gable's anchor may sit from a wall
    ringSegments: 48,            // archivolt half-ring segments × slopes.detail()
    dedupeM: 0.02,               // deck ring points closer than this are one point
    untangleDeck: true,          // split a folded deck ring before triangulating it
    deckMinM2: 0.01,             // ...and drop the loops smaller than this
    // The hall behind a gable front (rig.gables[bid].hall, written by
    // scripts/bake_roofs.py's _hall_rig): a gable roof to the pediment's apex
    // in place of the hip rig inside it. See "the hall behind a gable front".
    hall: true,
    hallEnd: true,               // ...closed at its back by a brick gable wall
    hallJunction: true,          // ...and walled where an attached block's deck stands above its eave
    hallTolM: 0.3,               // a profile edge within this of the hall rectangle belongs to the hall
    monitor: true,               // the clerestory monitor on the ridge (the override's measured plan)
    monitorColour: 'stone',      // 'stone' | 'brick' | 'roof': the tone the monitor takes
  };
  window.SLOPES_ROOFS = ROOFS;

  let _map = null, _group = null, _rig = null;
  let _filtered = false, _origFilter = null, _lastDetail = null;
  const count = { roofs: 0, gables: 0, triangles: 0, ms: 0 };

  // ── helpers ─────────────────────────────────────────────────────────────
  const UP = [0, 0, 1], DOWN = [0, 0, -1];
  const P = (xy, z) => [xy[0], xy[1], z];
  const outward = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1; return [dy / L, -dx / L, 0]; };
  const inwardOf = (r, span) => {
    const M = r.pts.length, a = r.pts[span[0]], b = r.pts[span[1] % M];
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
    return [-dy / L, dx / L];
  };
  /** Sutherland–Hodgman in u against u0 <= u <= u1; poly is [[u, z], ...]. */
  function clipU(poly, u0, u1) {
    const clip = (pts, inside, cut) => {
      const out = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const ia = inside(a), ib = inside(b);
        if (ia) out.push(a);
        if (ia !== ib) out.push(cut(a, b));
      }
      return out;
    };
    const at = (a, b, u) => { const t = (u - a[0]) / (b[0] - a[0]); return [u, a[1] + (b[1] - a[1]) * t]; };
    let p = clip(poly, q => q[0] >= u0 - 1e-9, (a, b) => at(a, b, u0));
    p = clip(p, q => q[0] <= u1 + 1e-9, (a, b) => at(a, b, u1));
    return p;
  }
  function dedupe(ring, tol) {
    const out = [];
    for (const q of ring) {
      const l = out[out.length - 1];
      if (l && Math.hypot(q[0] - l[0], q[1] - l[1]) < tol) continue;
      out.push(q);
    }
    while (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < tol) out.pop();
    return out;
  }
  const ringArea = r => { let A = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; A += p[0] * q[1] - q[0] * p[1]; } return A / 2; };
  /**
   * THE DECK RING FOLDS, AND EARCUT DOES NOT SAY SO.
   *
   * `top` is the profile offset by the full depth, each point clamped at its
   * own cap: `pts[k] + rays[k] * min(d, caps[k])`. Two neighbours whose caps
   * differ by a few centimetres reach the ridge at slightly different places
   * and their edges CROSS — measured on the shipped rig, 43 of the 108 deck
   * rings self-intersect, most of them by 2–6 cm. A crossing that small is
   * invisible; what is not invisible is what THREE.ShapeUtils.triangulateShape
   * does with it. Earcut assumes a simple polygon, and fed a tangled one it
   * emits triangles that lie OUTSIDE the ring — 36 roofs did, the worst of
   * them (Anna Hiss) spilling 891 m² of deck over a 475 m² roof. Coplanar
   * with the hip planes underneath, that reads as a triangular wedge of deck
   * colour punched through the terracotta with a bright sliver down its edge:
   * the notch on Battle Hall's roof, and the one over the West Mall.
   *
   * So the ring is untangled BEFORE it is triangulated. Every proper crossing
   * becomes a shared node, the walk is split into simple loops at those nodes
   * (stack pop — a node seen twice closes the loop between its two visits),
   * and only the loops wound the ring's own way are kept. The folded-back
   * slivers are wound the other way and go. Nothing else changes: the loops
   * that survive are bounded by the same top edges the slopes end on.
   */
  function untangle(ring, minA) {
    const n = ring.length;
    if (n < 3) return [];
    const pts = ring.slice();                      // node id -> point
    const hits = [];                               // per edge: [{ t, id }]
    for (let i = 0; i < n; i++) hits.push([]);
    for (let i = 0; i < n; i++) {
      const a = ring[i], b = ring[(i + 1) % n];
      for (let j = i + 1; j < n; j++) {
        if (j === i || j === (i + 1) % n || (i === 0 && j === n - 1)) continue;
        const c = ring[j], d = ring[(j + 1) % n];
        const rx = b[0] - a[0], ry = b[1] - a[1], sx = d[0] - c[0], sy = d[1] - c[1];
        const den = rx * sy - ry * sx;
        if (Math.abs(den) < 1e-12) continue;
        const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / den;
        const u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / den;
        if (t <= 1e-9 || t >= 1 - 1e-9 || u <= 1e-9 || u >= 1 - 1e-9) continue;
        const id = pts.length;
        pts.push([a[0] + rx * t, a[1] + ry * t]);
        hits[i].push({ t, id });
        hits[j].push({ t: u, id });
      }
    }
    if (!pts.length || pts.length === n) return [ring];
    const seq = [];
    for (let i = 0; i < n; i++) {
      seq.push(i);
      hits[i].sort((p, q) => p.t - q.t);
      for (const h of hits[i]) seq.push(h.id);
    }
    const loops = [], stack = [], at = new Map();
    for (const id of seq) {
      if (at.has(id)) {
        const p = at.get(id);
        loops.push(stack.slice(p));
        for (let k = p; k < stack.length; k++) at.delete(stack[k]);
        stack.length = p;
      }
      at.set(id, stack.length);
      stack.push(id);
    }
    if (stack.length) loops.push(stack);
    const want = Math.sign(ringArea(ring)) || 1;
    const out = [];
    for (const L of loops) {
      if (L.length < 3) continue;
      const poly = L.map(id => pts[id]);
      const A = ringArea(poly);
      if (Math.sign(A) === want && Math.abs(A) >= minA) out.push(poly);
    }
    return out;
  }

  // ── the hall behind a gable front ───────────────────────────────────────
  //
  // A gable front is the end of a gabled HALL. Until 2026-09-03 the roof
  // behind Gregory Gym's pediment was the same hip rig as every tiled roof —
  // a 4 m tile band around a flat deck at 25.5 m — and from the gregory pose
  // the whole 46 x 60 m of it read as one flat orange plate with a pediment
  // glued to its front (the critics' words, and the z19 tile agrees with
  // them). scripts/bake_roofs.py now reads the hall off the footprint and
  // writes it as `rig.gables[bid].hall`, in the gable's own (u along the
  // wall, v out of it) frame: the flank walls `uL` / `uR`, the pediment
  // prisms' rear plane per elevation segment (`front`), the back `v1`, the
  // ridge height (the pediment's apex), and the clerestory monitor's plan
  // where the override measured one. This file:
  //
  //   - takes the hip rig OUT of that rectangle: profile edges inside it are
  //     skipped the way gableEnd skips the gable wall, a corner where a kept
  //     edge meets a skipped one slides straight in along the kept wall (so
  //     the kept strip ends square instead of mitring into the hall), and the
  //     deck is clipped to the parts of the footprint beside and behind it;
  //   - draws the hall: two planes from the flank eaves to the ridge, with a
  //     front edge that steps with the pediment; the eave lip along each
  //     flank; a brick gable wall closing the back; the monitor as a low box
  //     on the ridge in the gable's stone; and, where an attached block's deck
  //     stands above the hall's eave, the wall between them along the clipped
  //     deck's edge, so the step from hall to annex reads.
  //
  // Nothing here is typed for one building: every number is the rig's, the
  // override's, or a taste constant above.
  function clipHalf(poly, axis, c, keepGE) {
    const out = [], n = poly.length;
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n];
      const ia = keepGE ? a[axis] >= c - 1e-9 : a[axis] <= c + 1e-9;
      const ib = keepGE ? b[axis] >= c - 1e-9 : b[axis] <= c + 1e-9;
      if (ia) out.push(a);
      if (ia !== ib) { const t = (c - a[axis]) / (b[axis] - a[axis]); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
    }
    return out;
  }
  function hallSetup(r, rays, skipEdge, g) {
    const H = g.hall, tol = ROOFS.hallTolM, M = r.pts.length;
    const toUV = p => [(p[0] - g.foot[0]) * g.t[0] + (p[1] - g.foot[1]) * g.t[1],
                       (p[0] - g.foot[0]) * g.n[0] + (p[1] - g.foot[1]) * g.n[1]];
    const fromUV = q => [g.foot[0] + g.t[0] * q[0] + g.n[0] * q[1], g.foot[1] + g.t[1] * q[0] + g.n[1] * q[1]];
    const uv = r.pts.map(toUV);
    const vTop = Math.max(...g.west.map(s => s[2]));
    const inHall = k => uv[k][0] >= H.uL - tol && uv[k][0] <= H.uR + tol && uv[k][1] >= H.v1 - tol && uv[k][1] <= vTop + tol;
    const n = r.spans.length;
    const isIn = r.spans.map(([a, b]) => inHall(a) && inHall(b % M));
    let skipped = 0;
    for (let i = 0; i < n; i++) {
      if (!isIn[i]) continue;
      const [a, bRaw] = r.spans[i];
      for (let k = a; k < bRaw; k++) { skipEdge.add(k % M); skipped++; }
      const prev = (i - 1 + n) % n, next = (i + 1) % n;
      if (!isIn[prev]) rays[a] = inwardOf(r, r.spans[prev]);          // the kept wall before ends square
      if (!isIn[next]) rays[bRaw % M] = inwardOf(r, r.spans[next]);   // ...and the one after
    }
    const front = H.front.slice().sort((p, q) => p[0] - q[0]);
    const frontRear = u => { for (const [u0, u1, vr] of front) if (u >= u0 - 1e-6 && u <= u1 + 1e-6) return vr; return Math.max(...front.map(s => s[2])); };
    return { H, toUV, fromUV, front, frontRear, skipped };
  }
  function hallParts(B, r, meta, g, hall, F, zLip, zTop) {
    const H = hall.H, over = meta.over;
    const zAt = u => u < 0 ? H.ridge - (H.ridge - zLip) * (u / H.uL) : H.ridge - (H.ridge - zLip) * (u / H.uR);
    // 1. the two planes, their front edge stepping with the pediment
    const frontEdge = (ua, ub) => {
      const out = [];
      for (const [u0, u1, vr] of hall.front) { const a = Math.max(u0, ua), b = Math.min(u1, ub); if (b - a > 0.01) out.push([a, vr], [b, vr]); }
      if (!out.length) { const vr = hall.frontRear(0.5 * (ua + ub)); out.push([ua, vr], [ub, vr]); }
      return out;
    };
    const plane = (ua, ub, want) => {
      const pts2 = frontEdge(ua, ub).concat([[ub, H.v1], [ua, H.v1]]);
      B.polygon(pts2.map(([u, v]) => F.at(u, v, zAt(u))), r.col, want, 'xy');
    };
    plane(H.uL, 0, [-F.T[0], -F.T[1], 1]);
    plane(0, H.uR, [F.T[0], F.T[1], 1]);
    // 2. the eave lip along each flank, from the pediment's rear to the back
    if (r.lip) {
      for (const [u, sgn] of [[H.uL, -1], [H.uR, 1]]) {
        const vf = hall.frontRear(u - sgn * 0.01), ue = u + sgn * over;
        B.quad(F.at(ue, vf, zLip), F.at(ue, H.v1, zLip), F.at(u, H.v1, zLip), F.at(u, vf, zLip), r.lip, UP);
        if (ROOFS.fascia) B.quad(F.at(ue, vf, r.base), F.at(ue, H.v1, r.base), F.at(ue, H.v1, zLip), F.at(ue, vf, zLip), r.lip, [sgn * F.T[0], sgn * F.T[1], 0]);
        if (ROOFS.soffit) B.quad(F.at(u, vf, r.base), F.at(u, H.v1, r.base), F.at(ue, H.v1, r.base), F.at(ue, vf, r.base), r.lip, DOWN);
      }
    }
    // 3. the gable wall closing the back
    if (ROOFS.hallEnd) {
      const tri = [[H.uL, zLip], [H.uR, zLip], [0, H.ridge]].map(([u, z]) => F.at(u, H.v1, z).concat(u));
      B.polygon(tri, g.brick, [-F.N[0], -F.N[1], 0], 'uz');
    }
    // 4. the monitor: a low box astride the ridge, in the gable's stone
    const Mo = H.monitor;
    if (ROOFS.monitor && Mo && Mo.w > 0 && Mo.h > 0) {
      const col = ROOFS.monitorColour === 'brick' ? g.brick : ROOFS.monitorColour === 'roof' ? r.col : g.stone;
      const hw = Mo.w / 2, zt = H.ridge + Mo.h, za = zAt(-hw), zb = zAt(hw);
      const v0 = Math.min(Mo.v0, hall.frontRear(0)), v1 = Math.max(Mo.v1, H.v1);
      if (v0 - v1 > 0.5) {
        B.quad(F.at(-hw, v0, zt), F.at(hw, v0, zt), F.at(hw, v1, zt), F.at(-hw, v1, zt), col, UP);
        B.quad(F.at(hw, v0, zb), F.at(hw, v1, zb), F.at(hw, v1, zt), F.at(hw, v0, zt), col, [F.T[0], F.T[1], 0]);
        B.quad(F.at(-hw, v0, za), F.at(-hw, v1, za), F.at(-hw, v1, zt), F.at(-hw, v0, zt), col, [-F.T[0], -F.T[1], 0]);
        for (const [v, sgn] of [[v0, 1], [v1, -1]]) {
          const end = [[-hw, za], [0, H.ridge], [hw, zb], [hw, zt], [-hw, zt]].map(([u, z]) => F.at(u, v, z).concat(u));
          B.polygon(end, col, [sgn * F.N[0], sgn * F.N[1], 0], 'uz');
        }
      }
    }
  }
  /** The wall between the hall's eave and an attached block's deck, along the clipped deck's edge on the flank line. */
  function hallJunction(B, piece, u, sgn, hall, F, zLip, zTop, col) {
    if (!ROOFS.hallJunction || zTop <= zLip + 0.05) return;
    const H = hall.H, vf = hall.frontRear(u - sgn * 0.01);
    for (let i = 0; i < piece.length; i++) {
      const a = piece[i], b = piece[(i + 1) % piece.length];
      if (Math.abs(a[0] - u) > 1e-4 || Math.abs(b[0] - u) > 1e-4) continue;
      const va = Math.max(H.v1, Math.min(vf, Math.min(a[1], b[1]))), vb = Math.max(H.v1, Math.min(vf, Math.max(a[1], b[1])));
      if (vb - va < 0.05) continue;
      B.quad(F.at(u, va, zLip), F.at(u, vb, zLip), F.at(u, vb, zTop), F.at(u, va, zTop), col, [-sgn * F.T[0], -sgn * F.T[1], 0]);
    }
  }

  // ── one roof ────────────────────────────────────────────────────────────
  function gableEnd(r, rays, skipEdge, g) {
    const M = r.pts.length;
    let best = null;
    for (let i = 0; i < r.spans.length; i++) {
      const a = r.spans[i][0], b = r.spans[i][1] % M;
      const pa = r.pts[a], pb = r.pts[b];
      const dx = pb[0] - pa[0], dy = pb[1] - pa[1], L = Math.hypot(dx, dy);
      if (L < 1e-6) continue;
      if ((dy / L) * g.n[0] + (-dx / L) * g.n[1] < 0.8) continue;      // must face the gable's way
      const t = Math.max(0, Math.min(1, ((g.foot[0] - pa[0]) * dx + (g.foot[1] - pa[1]) * dy) / (L * L)));
      const dist = Math.hypot(g.foot[0] - (pa[0] + dx * t), g.foot[1] - (pa[1] + dy * t));
      if (!best || dist < best.dist) best = { i, a, bRaw: r.spans[i][1], b, dist };
    }
    if (!best || best.dist > ROOFS.gableWallMaxM) return false;
    const n = r.spans.length;
    rays[best.a] = inwardOf(r, r.spans[(best.i - 1 + n) % n]);   // slides along the wall before
    rays[best.b] = inwardOf(r, r.spans[(best.i + 1) % n]);       // ...and the wall after
    for (let k = best.a; k < best.bRaw; k++) skipEdge.add(k % M); // the gable wall itself: no slope, no eave
    return true;
  }

  function roofOne(B, r, meta, gable) {
    const S = window.slopes;
    const M = r.pts.length;
    const rays = r.rays.map(v => v.slice()), caps = r.caps;
    const skipEdge = new Set();
    if (gable && ROOFS.gableEnd) gableEnd(r, rays, skipEdge, gable);
    const hall = (gable && ROOFS.hall && gable.hall) ? hallSetup(r, rays, skipEdge, gable) : null;
    const lip = meta.lip, over = meta.over, dUse = r.d;
    const zLip = r.base + lip, zTop = zLip + r.rise;
    // the offset points, in the bake's own metre frame and in local metres
    const atB = (k, d) => { const c = Math.min(d, caps[k]); return [r.pts[k][0] + rays[k][0] * c, r.pts[k][1] + rays[k][1] * c]; };
    const loc = q => { const l = S.toLocal(q[0] * r.dpm[0], q[1] * r.dpm[1], 0); return [l.x, l.y]; };
    const at = (k, d) => loc(atB(k, d));
    const z = d => zLip + r.rise * Math.max(0, Math.min(1, d / dUse));
    // WHERE A POINT STOPS, ITS SLOPE STOPS. A profile point capped short of
    // d_use has reached this roof's ridge; the slab bake kept lifting it with
    // the ring anyway (a ring is one height), which leaves the vertical fin
    // over every wing's ridge that the deck then hides. A rig with NO deck —
    // the Capitol's wings, bake_capitol.py — has nothing to hide a fin behind,
    // so there its height is its own: zLip + pitch * min(d, cap). The ridge
    // is then as high as the roof is wide at that place, which is what a hip
    // over an irregular outline actually does. Rigs with a deck keep the fin,
    // because the deck's edge stands on it.
    const zk = r.deck ? ((k, d) => z(d)) : ((k, d) => zLip + r.rise * Math.min(d, caps[k]) / dUse);
    const eave = [], wall = [], top = [];
    for (let k = 0; k < M; k++) { eave.push(at(k, -over)); wall.push(at(k, 0)); top.push(at(k, dUse)); }

    // 1. the eave lip: flat top from the overhang to the wall, its fascia, its soffit
    if (r.lip) {
      for (let k = 0; k < M; k++) {
        const j = (k + 1) % M;
        if (skipEdge.has(k)) continue;
        B.quad(P(eave[k], zLip), P(eave[j], zLip), P(wall[j], zLip), P(wall[k], zLip), r.lip, UP);
        if (ROOFS.fascia) B.quad(P(eave[k], r.base), P(eave[j], r.base), P(eave[j], zLip), P(eave[k], zLip), r.lip, outward(eave[k], eave[j]));
        if (ROOFS.soffit) B.quad(P(wall[k], r.base), P(wall[j], r.base), P(eave[j], r.base), P(eave[k], r.base), r.lip, DOWN);
      }
    }
    // 2. the slope: one strip per profile edge, split where either end reaches its cap
    for (let k = 0; k < M; k++) {
      const j = (k + 1) % M;
      if (skipEdge.has(k)) continue;
      const brk = [0, dUse];
      for (const c of [caps[k], caps[j]]) if (c > 1e-4 && c < dUse - 1e-4) brk.push(c);
      brk.sort((a, b) => a - b);
      const o = outward(wall[k], wall[j]);
      const want = [o[0], o[1], 1];
      for (let i = 0; i + 1 < brk.length; i++) {
        const d0 = brk[i], d1 = brk[i + 1];
        if (d1 - d0 < 1e-4) continue;
        B.quad(P(at(k, d0), zk(k, d0)), P(at(j, d0), zk(j, d0)), P(at(j, d1), zk(j, d1)), P(at(k, d1), zk(k, d1)), r.col, want);
      }
    }
    // 3. the deck at the top of the rise
    if (ROOFS.deck && r.deck && !hall) {
      const ring = dedupe(top, ROOFS.dedupeM);
      if (ring.length >= 3) {
        const loops = ROOFS.untangleDeck ? untangle(ring, ROOFS.deckMinM2) : [ring];
        for (const L of loops) B.polygon(L.map(q => [q[0], q[1], zTop]), r.deck, UP, 'xy');
      }
    }
    // 3b. with a hall: the deck beside and behind it, then the hall itself
    if (hall) {
      const g = gable, H = hall.H;
      const F = S.frame([g.foot[0] * g.dpm[0], g.foot[1] * g.dpm[1]],
                        [g.t[0] * g.dpm[0], g.t[1] * g.dpm[1]], [g.n[0] * g.dpm[0], g.n[1] * g.dpm[1]]);
      if (ROOFS.deck && r.deck) {
        const ring = dedupe(r.pts.map((_, k) => hall.toUV(atB(k, dUse))), ROOFS.dedupeM);
        const loops = ring.length >= 3 ? (ROOFS.untangleDeck ? untangle(ring, ROOFS.deckMinM2) : [ring]) : [];
        const put = piece => { if (piece.length >= 3 && Math.abs(ringArea(piece)) >= ROOFS.deckMinM2) B.polygon(piece.map(q => { const l = loc(hall.fromUV(q)); return [l[0], l[1], zTop]; }), r.deck, UP, 'xy'); };
        for (const L of loops) {
          const right = clipHalf(L, 0, H.uR, true), left = clipHalf(L, 0, H.uL, false);
          const behind = clipHalf(clipHalf(clipHalf(L, 0, H.uL, true), 0, H.uR, false), 1, H.v1, false);
          put(right); put(left); put(behind);
          hallJunction(B, right, H.uR, 1, hall, F, zLip, zTop, g.brick);
          hallJunction(B, left, H.uL, -1, hall, F, zLip, zTop, g.brick);
        }
      }
      hallParts(B, r, meta, g, hall, F, zLip, zTop);
    }
  }

  // ── Gregory Gym's elevation ─────────────────────────────────────────────
  function gableParts(B, g) {
    const S = window.slopes;
    const F = S.frame([g.foot[0] * g.dpm[0], g.foot[1] * g.dpm[1]],
                      [g.t[0] * g.dpm[0], g.t[1] * g.dpm[1]], [g.n[0] * g.dpm[0], g.n[1] * g.dpm[1]]);
    const trap = (W, apex, hw) => [[-W / 2, g.eave], [W / 2, g.eave], [hw, apex], [-hw, apex]];
    const rake = side => {
      const u0 = side * g.w_out / 2, u1 = side * g.apex_hw_out;
      const dn = g.rake.down, up = g.rake.up;
      return [[u0, g.eave - dn], [u1, g.apex_out - dn], [u1, g.apex_out + up], [u0, g.eave + up]];
    };
    const outer = trap(g.w_out, g.apex_out, g.apex_hw_out);
    for (const [u0, u1, v] of g.west) {
      // the anchored bay's own pediment steps back, so the inner one in front of it is not swallowed
      const vu = Math.abs(v) < g.bay_v ? v - g.bay_back : v;
      const poly = clipU(outer, u0, u1);
      if (poly.length >= 3) B.extrude(poly, F, vu - g.gable_d, vu + g.proud_g, g.brick, { skipDown: true });
      for (const side of [-1, 1]) {
        const p = clipU(rake(side), u0, u1);
        if (p.length >= 3) B.extrude(p, F, vu - g.gable_d, vu + g.proud_g + g.rake.proud, g.stone, {});
      }
    }
    B.extrude(trap(g.w_in, g.apex_in, g.apex_hw_in), F, g.inner_rear, g.proud_g, g.brick, { skipDown: true });
    const A = g.arches, seg = Math.max(8, Math.round(ROOFS.ringSegments * S.detail()));
    for (let j = 0; j < A.n; j++) {
      const uc = (j - (A.n - 1) / 2) * A.pitch, R = A.r + A.ring;
      const poly = [];
      for (let i = 0; i <= seg; i++) { const th = Math.PI * i / seg; poly.push([uc + R * Math.cos(th), A.spring + R * Math.sin(th)]); }
      for (let i = seg; i >= 0; i--) { const th = Math.PI * i / seg; poly.push([uc + A.r * Math.cos(th), A.spring + A.r * Math.sin(th)]); }
      B.extrude(poly, F, 0, A.proud, g.brick, { back: false });
    }
  }

  // ── build ───────────────────────────────────────────────────────────────
  function build() {
    const S = window.slopes, T = window.THREE;
    const t0 = performance.now();
    const B = S.build();
    let roofs = 0, gables = 0;
    for (const key of Object.keys(_rig.roofs)) {
      const r = _rig.roofs[key];
      const g = ROOFS.gable && _rig.gables && _rig.gables[key.split('/')[0]];
      try { roofOne(B, r, _rig.meta, g || null); roofs++; }
      catch (e) { console.warn('[slopes-roofs] roof', r.name || key, e); }
    }
    if (ROOFS.gable && _rig.gables) {
      for (const bid of Object.keys(_rig.gables)) {
        try { gableParts(B, _rig.gables[bid]); gables++; }
        catch (e) { console.warn('[slopes-roofs] gable', bid, e); }
      }
    }
    const mesh = new T.Mesh(B.geometry(), S.material());
    mesh.name = 'roofs';
    const g = new T.Group();
    g.name = 'slopes-roofs';
    g.userData.lod = ROOFS.lod;
    g.userData.minzoom = ROOFS.minzoom;
    g.add(mesh);
    count.roofs = roofs; count.gables = gables; count.triangles = B.triangles;
    count.ms = +(performance.now() - t0).toFixed(1);
    _lastDetail = S.detail();
    return g;
  }

  function setFilter(on) {
    if (!_map || !_map.getLayer(ROOFS.layer)) return;
    if (on) {
      if (_filtered) return;
      _origFilter = _map.getFilter(ROOFS.layer) || null;
      _map.setFilter(ROOFS.layer, ['match', ['get', 'f'], ROOFS.keep, true, false]);
      _filtered = true;
    } else if (_filtered) {
      _map.setFilter(ROOFS.layer, _origFilter);
      _filtered = false;
    }
  }

  window.applySlopesRoofs = function applySlopesRoofs(map) {
    map = map || _map;
    if (!map || !_rig) return;
    const S = window.slopes;
    const want = !!(window.SLOPES.on && ROOFS.on);
    if (want && !_group) { _group = build(); S.add(_group); }
    else if (want && _group && _lastDetail !== S.detail()) { S.remove(_group); _group = build(); S.add(_group); }
    else if (!want && _group) { S.remove(_group); _group = null; }
    setFilter(want);
    map.triggerRepaint();
  };

  window.slopesRoofs = {
    rebuild() { if (_group) { window.slopes.remove(_group); _group = null; } window.applySlopesRoofs(); },
    /**
     * Draw another file's `rig` member into a builder: the same schema
     * scripts/bake_roofs.py writes for the campus (profile, rays, caps,
     * spans, heights), the same roofOne. scripts/bake_capitol.py writes one
     * for the Capitol's wings and js/slopes-dome.js calls this with it, so
     * those hips live in the dome's group and keep its LOD (none: a skyline
     * stays). Returns the number of roofs drawn.
     */
    emit(B, rig) {
      if (!rig || !rig.roofs) return 0;
      const meta = { lip: 0, over: 0, ...(rig.meta || {}) };
      let n = 0;
      for (const key of Object.keys(rig.roofs)) {
        try { roofOne(B, rig.roofs[key], meta, null); n++; }
        catch (e) { console.warn('[slopes-roofs] rig', key, e); }
      }
      return n;
    },
    rig(name) { if (!_rig) return null; const k = Object.keys(_rig.roofs).find(k => (_rig.roofs[k].name || '').indexOf(name) >= 0); return k ? { key: k, ...(_rig.roofs[k]) } : null; },
    get count() { return { ...count }; },
    get group() { return _group; },
    get data() { return _rig; },
    get filtered() { return _filtered; },
  };

  // ── boot ────────────────────────────────────────────────────────────────
  // Waits for the layer (window.slopes.root exists once initSlopes ran — never
  // under ?slopes=0), for the slab layer it stands in for, and for the rig.
  async function boot() {
    const map = window.__map;
    const S = window.slopes;
    if (!map || !S || !S.root || !map.getLayer(ROOFS.layer)) return false;
    _map = map;
    let rig = null;
    try {
      const src = map.getSource(ROOFS.source);
      const d = src && src._data;
      if (d && typeof d === 'object' && d.rig) rig = d.rig;
    } catch (e) {}
    if (!rig) {
      try { const gj = await S.fetchJSON(ROOFS.url); rig = gj && gj.rig; } catch (e) { console.warn('[slopes-roofs]', e.message); }
    }
    if (!rig || !rig.roofs) { console.warn('[slopes-roofs] roofs.geojson carries no rig — slabs stay'); return true; }
    _rig = rig;
    S.onSwitch(() => window.applySlopesRoofs(map));
    // a preset change alters slopes.detail(); the layer re-applies its settings on the next tick
    const orig = window.applySlopesSettings;
    if (typeof orig === 'function' && !orig.__roofsHooked) {
      const wrapped = function (m) { const r = orig.apply(this, arguments); try { window.applySlopesRoofs(m); } catch (e) {} return r; };
      wrapped.__roofsHooked = true;
      window.applySlopesSettings = wrapped;
    }
    window.applySlopesRoofs(map);
    console.log('[slopes-roofs]', count.roofs, 'roofs and', count.gables, 'gable in', count.triangles, 'triangles,', count.ms, 'ms');
    return true;
  }
  (function poll() {
    if (new URLSearchParams(location.search).get('slopes') === '0') return;   // the layer is out; so is this
    let n = 0, busy = false;
    const t = setInterval(async () => {
      if (busy) return;
      busy = true;
      let done = false;
      try { done = await boot(); } catch (e) { console.error('[slopes-roofs]', e); done = true; }
      busy = false;
      if (done || ++n > 900) clearInterval(t);
    }, 150);
  })();
})();
