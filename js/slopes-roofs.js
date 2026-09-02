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
 * is filled at the top of the slope". Same eave line, same ridge, same colours
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
    const lip = meta.lip, over = meta.over, dUse = r.d;
    const zLip = r.base + lip, zTop = zLip + r.rise;
    const at = (k, d) => {
      const c = Math.min(d, caps[k]);
      const l = S.toLocal((r.pts[k][0] + rays[k][0] * c) * r.dpm[0], (r.pts[k][1] + rays[k][1] * c) * r.dpm[1], 0);
      return [l.x, l.y];
    };
    const z = d => zLip + r.rise * Math.max(0, Math.min(1, d / dUse));
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
        B.quad(P(at(k, d0), z(d0)), P(at(j, d0), z(d0)), P(at(j, d1), z(d1)), P(at(k, d1), z(d1)), r.col, want);
      }
    }
    // 3. the deck at the top of the rise
    if (ROOFS.deck && r.deck) {
      const ring = dedupe(top, ROOFS.dedupeM);
      if (ring.length >= 3) B.polygon(ring.map(q => [q[0], q[1], zTop]), r.deck, UP, 'xy');
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
