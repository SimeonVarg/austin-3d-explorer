/**
 * slopes-dome.js — the Capitol dome, the bullock-dome and the cupola, lathed
 * from their own discs.
 *
 * data/capitol_dome.geojson (scripts/bake_capitol.py) stacks the three curved
 * parts of the Capitol as flat fill-extrusion discs — 18 for the dome, 7 for
 * the bullock-dome, 4 for the cupola — because a fill-extrusion cannot slope.
 * Each disc is a ring at one height with one radius, and read bottom to top
 * the discs of a part are a clean monotonic radius-against-height profile,
 * coaxial to 0.2 m (the scout measured 12.57 → 4.88 m over 60 → 75 m for the
 * dome). That is exactly what THREE.LatheGeometry takes: this file reads the
 * discs, fits nothing, and revolves the profile about the axis they share.
 *
 * The one number the discs do not carry is the radius at the very top of
 * each part. Where another part starts there — the lantern on the dome at
 * 75 m, the goddess on the cupola at 88 m — its base radius is used, so the
 * two meet; where nothing does (the bullock-dome at 36 m) the last two discs'
 * slope is carried one step further, floored at DOME.minTopR, and the top is
 * closed with a flat disc. Columns, drum, lantern, cornice, attic and collar
 * are already the right shape and stay as they are; only the three curved
 * parts are hidden, by a filter on `part`, while SLOPES.on.
 *
 * Colour is the discs' own `wd/wg/wn` — the tone their sides show — blended
 * for the hour like everything else in the layer, with CAPITOL.domeNight
 * honoured per part as js/capitol.js does. Smooth normals: a dome has no
 * facets. No vertical gradient, which is also what the disc layer chose.
 *
 * Public (window) API:
 *   SLOPES_DOME              — the taste block
 *   slopesDome.rebuild()     — rebuild (after a taste edit or a preset change)
 *   slopesDome.count         — { parts, triangles, ms, done }
 *   slopesDome.profile(part) — the [r, z] profile a part was lathed from
 *   applySlopesDome(map)     — re-evaluate the filter and the group
 */
(function () {
  'use strict';

  // ══════════════════════════════════════════════════════════════════════
  //  TASTE BLOCK — CLAUDE.md rule 11.
  // ══════════════════════════════════════════════════════════════════════
  const DOME = {
    on: true,
    layer: 'capitol-dome',
    url: 'data/capitol_dome.geojson',
    parts: ['dome', 'bullock-dome', 'cupola'],   // the curved ones; everything else stays
    segments: 96,                 // around the axis × slopes.detail()
    minzoom: 13.5,                // CAPITOL.minZoom; read live from window.CAPITOL when it exists
    lod: null,                    // the skyline keeps its dome at any altitude
    minTopR: 0.3,                 // the smallest closing radius, metres
    cap: true,                    // a flat disc closes each part's top
    topJoinTolM: 0.02,            // a part whose base is this close to our top gives us its radius
  };
  window.SLOPES_DOME = DOME;

  let _map = null, _group = null, _gj = null, _lastDetail = null, _filtered = false, _origFilter = null;
  const count = { parts: 0, triangles: 0, ms: 0, done: false };
  const _profiles = {};

  function ringStats(f) {
    const ring = f.geometry.coordinates[0];
    const n = ring.length - 1;
    let cx = 0, cy = 0;
    for (let i = 0; i < n; i++) { cx += ring[i][0]; cy += ring[i][1]; }
    return { cx: cx / n, cy: cy / n, ring: ring.slice(0, n) };
  }

  function profileOf(part) {
    const S = window.slopes;
    const discs = _gj.features.filter(f => f.properties.part === part).sort((a, b) => a.properties.base - b.properties.base);
    if (!discs.length) return null;
    // the shared axis: the mean centroid of every disc of the part
    let ax = 0, ay = 0;
    const st = discs.map(ringStats);
    for (const s of st) { ax += s.cx; ay += s.cy; }
    ax /= st.length; ay /= st.length;
    const A = S.toLocal(ax, ay, 0);
    const radius = s => { let r = 0; for (const q of s.ring) { const l = S.toLocal(q[0], q[1], 0); r += Math.hypot(l.x - A.x, l.y - A.y); } return r / s.ring.length; };
    const prof = discs.map((f, i) => [radius(st[i]), f.properties.base]);
    const top = discs[discs.length - 1].properties.h;
    // the closing radius: the part that starts on our top, else the last slope carried on
    const next = _gj.features.filter(f => DOME.parts.indexOf(f.properties.part) < 0 && !/column/.test(f.properties.part)
                                            && Math.abs(f.properties.base - top) <= DOME.topJoinTolM);
    let rTop;
    if (next.length) {
      const s = ringStats(next[0]);
      const B = S.toLocal(s.cx, s.cy, 0);
      let r = 0; for (const q of s.ring) { const l = S.toLocal(q[0], q[1], 0); r += Math.hypot(l.x - B.x, l.y - B.y); } rTop = r / s.ring.length;
    } else if (prof.length >= 2) {
      const [r1, z1] = prof[prof.length - 2], [r2, z2] = prof[prof.length - 1];
      rTop = r2 + (r2 - r1) / (z2 - z1) * (top - z2);
    } else rTop = prof[0][0];
    rTop = Math.max(DOME.minTopR, rTop);
    prof.push([rTop, top]);
    const p = discs[0].properties;
    const over = (window.CAPITOL && window.CAPITOL.domeNight) || {};
    const col = [p.wd, p.wg, over[part] || p.wn];
    return { axis: [A.x, A.y], prof, col, top, rTop, discs: discs.length, join: next.length ? next[0].properties.part : null };
  }

  function build() {
    const S = window.slopes, T = window.THREE;
    const t0 = performance.now();
    const seg = Math.max(12, Math.round(DOME.segments * S.detail()));
    const g = new T.Group();
    g.name = 'slopes-dome';
    g.userData.lod = DOME.lod;
    g.userData.minzoom = (window.CAPITOL && typeof window.CAPITOL.minZoom === 'number') ? window.CAPITOL.minZoom : DOME.minzoom;
    const mat = S.material();
    let parts = 0, tris = 0;
    const capB = S.build();
    for (const part of DOME.parts) {
      const pr = profileOf(part);
      if (!pr) continue;
      _profiles[part] = pr;
      const pts = pr.prof.map(([r, z]) => new T.Vector2(r, z));
      const lathe = new T.LatheGeometry(pts, seg);
      lathe.rotateX(Math.PI / 2);          // three lathes about +Y; up is +Z here
      lathe.computeVertexNormals();
      S.colour(lathe, pr.col);
      const m = new T.Mesh(lathe, mat);
      m.position.set(pr.axis[0], pr.axis[1], 0);
      m.name = part;
      g.add(m);
      tris += lathe.index ? lathe.index.count / 3 : lathe.attributes.position.count / 3;
      if (DOME.cap && pr.rTop > 0) {
        const ring = [];
        for (let i = 0; i < seg; i++) { const th = 2 * Math.PI * i / seg; ring.push([pr.axis[0] + pr.rTop * Math.cos(th), pr.axis[1] + pr.rTop * Math.sin(th), pr.top]); }
        capB.polygon(ring, pr.col, [0, 0, 1], 'xy');
      }
      parts++;
    }
    if (capB.triangles) { const cm = new T.Mesh(capB.geometry(), mat); cm.name = 'caps'; g.add(cm); tris += capB.triangles; }
    count.parts = parts; count.triangles = Math.round(tris); count.ms = +(performance.now() - t0).toFixed(1);
    _lastDetail = S.detail();
    return g;
  }

  function setFilter(on) {
    if (!_map || !_map.getLayer(DOME.layer)) return;
    if (on) {
      if (_filtered) return;
      _origFilter = _map.getFilter(DOME.layer) || null;
      const hide = ['!', ['in', ['get', 'part'], ['literal', DOME.parts]]];
      _map.setFilter(DOME.layer, _origFilter ? ['all', _origFilter, hide] : hide);
      _filtered = true;
    } else if (_filtered) {
      _map.setFilter(DOME.layer, _origFilter);
      _filtered = false;
    }
  }

  window.applySlopesDome = function applySlopesDome(map) {
    map = map || _map;
    if (!map || !_gj) return;
    const S = window.slopes;
    const want = !!(window.SLOPES.on && DOME.on);
    if (want && !_group) { _group = build(); S.add(_group); }
    else if (want && _group && _lastDetail !== S.detail()) { S.remove(_group); _group = build(); S.add(_group); }
    else if (!want && _group) { S.remove(_group); _group = null; }
    setFilter(want);
    map.triggerRepaint();
  };

  window.slopesDome = {
    rebuild() { if (_group) { window.slopes.remove(_group); _group = null; } window.applySlopesDome(); },
    profile(part) { return _profiles[part] || null; },
    get count() { return { ...count }; },
    get group() { return _group; },
    get filtered() { return _filtered; },
  };

  // ── boot ────────────────────────────────────────────────────────────────
  async function boot() {
    const map = window.__map, S = window.slopes;
    if (!map || !S || !S.root) return false;
    if (window.CAPITOL && window.CAPITOL.on === false) { count.done = true; return true; }
    if (!map.getLayer(DOME.layer)) return false;
    _map = map;
    try { _gj = await S.fetchJSON(DOME.url); } catch (e) { console.warn('[slopes-dome]', e.message); count.done = true; return true; }
    if (!_gj || !_gj.features) { count.done = true; return true; }
    S.onSwitch(() => window.applySlopesDome(map));
    const orig = window.applySlopesSettings;
    if (typeof orig === 'function' && !orig.__domeHooked) {
      const wrapped = function (m) { const r = orig.apply(this, arguments); try { window.applySlopesDome(m); } catch (e) {} return r; };
      wrapped.__domeHooked = true;
      window.applySlopesSettings = wrapped;
    }
    window.applySlopesDome(map);
    count.done = true;
    console.log('[slopes-dome]', count.parts, 'parts lathed in', count.triangles, 'triangles,', count.ms, 'ms');
    return true;
  }
  (function poll() {
    if (new URLSearchParams(location.search).get('slopes') === '0') return;
    let n = 0, busy = false;
    const t = setInterval(async () => {
      if (busy) return;
      busy = true;
      let done = false;
      try { done = await boot(); } catch (e) { console.error('[slopes-dome]', e); done = true; }
      busy = false;
      if (done || ++n > 900) clearInterval(t);
    }, 200);
  })();
})();
