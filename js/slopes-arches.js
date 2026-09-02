/**
 * slopes-arches.js — every arched doorway on campus, as the curve its chords
 * are cut from.
 *
 * scripts/bake_entrances.py draws an arched head as ARCH_TIERS = 5 flat
 * fill-extrusion chords, three times over — the fanlight glass, the surround
 * band and, on the families that have one, the terracotta spandrel — because
 * a fill-extrusion cannot curve. 448 of the 509 arch pieces in
 * data/entrances.geojson exist only because of that. Each chord is sampled
 * from the same closed form:
 *
 *     w(t) = half * sqrt(1 - t²),   z(t) = spring + rise * t,   t in [0, 1]
 *
 * a quarter-ellipse with semi-axes `half` (the opening's half width) and
 * `rise` (a semicircle when the two are equal, as on Battle Hall and Gregory
 * Gym; a segment on the Victorian fanlights). The bake now writes that form
 * per entrance as the `arches` foreign member of the same file — the
 * opening's frame on the wall (`o`, `t`, `n`: origin, along and out, in
 * degrees per metre), `half`, `spring`, `rise`, and for each of the three
 * pieces the depth it was boxed at (`v`) and the colours it carries (`c`,
 * day/golden/night) — and this file draws:
 *
 *   tr    the fanlight: the half-ellipse itself, glass, PROUD_DOOR deep
 *   band  the surround: the region between the ellipse and the ellipse
 *         GROWN by `sw` on both axes (half+sw, rise+sw) — a real archivolt,
 *         `sw` wide at every angle, and on a semicircle exactly the
 *         concentric circle. The chords step outward in u alone
 *         (`sgn*w .. sgn*(w+sw)`), which leaves the band with no thickness
 *         at all over the crown; see `arcOut` for why that is not copied
 *   sp    the spandrel: between that outer curve and the vertical `half+sw`
 *         under a head at `crown + sw`, the corner of the square the arch is
 *         set into
 *
 * (ARCHES.cappedFams is the one exception, and it is the bake's, not the
 * geometry's: a family that lays an entablature straight on the crown has no
 * room above the head, so those arches keep the chords' flat crown until the
 * bake writes a head height on the `arches` member.)
 *
 * in the per-opening (u, v, z) frame the flat pieces already use, proud of
 * the wall by the same v. The chords carry `arc: 1` and nothing else does;
 * while SLOPES.on the entrance layers that draw them get
 * ['!', ['has', 'arc']] ANDed onto their own filter, and get their own filter
 * back the moment it is off. The jambs, keystone, cornice, reveal, leaves
 * and steps are already the right shape and are never touched.
 *
 * Public (window) API:
 *   SLOPES_ARCHES             — the taste block
 *   slopesArches.rebuild()    — rebuild (after a taste edit or a preset change)
 *   slopesArches.count        — { arches, triangles, ms, done }
 *   slopesArches.at(ref)      — the arch entries for a building ref, for scripts
 *   applySlopesArches(map)    — re-evaluate the filters and the group
 */
(function () {
  'use strict';

  // ══════════════════════════════════════════════════════════════════════
  //  TASTE BLOCK — CLAUDE.md rule 11.
  // ══════════════════════════════════════════════════════════════════════
  const ARCHES = {
    on: true,
    layers: ['entrances-portal', 'entrances-glass'],   // the layers that draw the chords
    source: 'austin-entrances',
    url: 'data/entrances.geojson',
    tag: 'arc',                    // the property the chords carry
    minzoom: 15.2,                 // ENT.minZoom; read live from window.ENT when it exists
    lod: null,                     // no js/lod.js tier lists the entrances
    segments: 24,                  // points per quarter-curve × slopes.detail()
    transom: true, band: true, spandrel: true,
    radial: true,                  // extrados grown on both axes (a real archivolt);
                                   // false steps out in u alone, as the chords do
    // ...EXCEPT where the surround carries an entablature straight on the crown.
    // A real archivolt reaches `crown + sw`, so the head of the square it sits
    // in is there too — which is fine over plain wall or a spandrel, and wrong
    // under family B's architrave + frieze + cornice (bake_entrances.py's
    // `cornice=0.30`, laid on `top = spring + rise`). Raised, Gregory Gym's
    // west door grew a 0.25 m stone hump over its own entablature — seen in a
    // magnified A/B of that door on 2026-09-02. The bake knows the number and
    // does not write it — HANDOFF asks for a head height on the `arches`
    // member, and this list goes away the day it arrives.
    cappedFams: ['B'],             // families whose arch cannot grow past its head
  };
  window.SLOPES_ARCHES = ARCHES;

  let _map = null, _group = null, _data = null, _lastDetail = null;
  let _filtered = false;
  const _orig = {};
  const count = { arches: 0, triangles: 0, ms: 0, done: false };

  function arcPts(a, n, sw, from, to) {
    // u = half*cos θ (+ sw), z = spring + rise*sin θ, θ from `from` to `to`
    const out = [];
    for (let i = 0; i <= n; i++) {
      const th = from + (to - from) * i / n;
      const w = a.half * Math.cos(th);
      out.push([w + (w >= 0 ? sw : -sw), a.spring + a.rise * Math.sin(th)]);
    }
    return out;
  }

  /**
   * THE EXTRADOS — the curve the band's OUTER edge follows.
   *
   * `arcPts(.., sw, ..)` steps outward in u alone, which is what the five
   * chords do: at the crown cos θ = 0, so the outer point is (sw, crown) and
   * the inner one (0, crown) — the same height. The annulus closes to a
   * horizontal line there and the archivolt has NO THICKNESS over the top of
   * the arch, so the fanlight glass meets the spandrel across the crown with
   * nothing between them. Battle Hall's portal is the frame the critics
   * magnify and that seam is at the middle of it.
   *
   * So the extrados is the intrados grown by `sw` on BOTH axes: half+sw and
   * rise+sw. On a semicircle — 18 of the 24 arches, and every monumental one:
   * Battle Hall, Sutton, Gregory, the Biomedical and Blanton portals — that
   * is exactly the concentric circle a real archivolt is, sw wide at every
   * angle. On the six segmental Victorian fanlights it is the same curve the
   * chords approximate, and it stays a simple convex arc where a true normal
   * offset would cusp (JHH's radius of curvature at the springing is 0.265 m
   * against a 0.26 m band, and E4's crown is 0.21 m against 0.30 m — both
   * would fold back on themselves).
   *
   * The consequences are the arch's, not this file's: the head of the square
   * the arch sits in rises to `crown + sw`, because that is where an arch of
   * outer radius half+sw springing at `spring` actually reaches, and the
   * spandrel that fills the corner between the two follows it. The straight
   * legs of the surround below the springing are untouched — at θ = 0 this
   * curve still lands on (half + sw, spring), the exact top of the
   * fill-extrusion jamb it continues.
   */
  function arcOut(a, n, sw, from, to) {
    const out = [];
    for (let i = 0; i <= n; i++) {
      const th = from + (to - from) * i / n;
      out.push([(a.half + sw) * Math.cos(th), a.spring + (a.rise + sw) * Math.sin(th)]);
    }
    return out;
  }

  function archOne(B, a, seg) {
    const S = window.slopes;
    const F = S.frame(a.o, a.t, a.n);
    const crown = a.spring + a.rise;
    const radial = ARCHES.radial && ARCHES.cappedFams.indexOf(a.fam) < 0;
    if (ARCHES.transom && a.tr) {
      // the half-ellipse, from (half, spring) over the crown to (-half, spring)
      const poly = arcPts(a, 2 * seg, 0, 0, Math.PI);
      B.extrude(poly, F, a.tr.v[0], a.tr.v[1], a.tr.c, { back: false, skipDown: true });
    }
    if (ARCHES.band && a.band && radial) {
      // ONE ring, not two halves: the extrados runs right over the crown, so
      // there is no seam at u = 0 for two coincident side faces to fight over.
      const sw = a.band.sw;
      const outer = arcOut(a, 2 * seg, sw, 0, Math.PI);        // (half+sw, spring) → (0, crown+sw) → (-(half+sw), spring)
      const inner = arcPts(a, 2 * seg, 0, Math.PI, 0);         // (-half, spring) → (0, crown) → (half, spring)
      B.extrude(outer.concat(inner), F, a.band.v[0], a.band.v[1], a.band.c, { back: false, skipDown: true });
    } else if (ARCHES.band && a.band) {
      for (const sgn of [1, -1]) {
        const sw = a.band.sw;
        const outer = arcPts(a, seg, sw, 0, Math.PI / 2).map(p => [sgn * Math.abs(p[0]), p[1]]);
        const inner = arcPts(a, seg, 0, Math.PI / 2, 0).map(p => [sgn * Math.abs(p[0]), p[1]]);
        outer[outer.length - 1] = [sgn * sw, crown];
        inner[0] = [0, crown];
        B.extrude(outer.concat(inner), F, a.band.v[0], a.band.v[1], a.band.c, { back: false, skipDown: true });
      }
    }
    if (ARCHES.spandrel && a.sp) {
      for (const sgn of [1, -1]) {
        const sw = a.sp.sw, x = a.half + sw, head = crown + (radial ? sw : 0);
        // the corner between the extrados and the square: pinched to a point
        // at the crown, where the archivolt now reaches the head itself
        const curve = (radial ? arcOut(a, seg, sw, Math.PI / 2, 0) : arcPts(a, seg, sw, Math.PI / 2, 0))
          .map(p => [sgn * Math.abs(p[0]), p[1]]);
        curve[0] = radial ? [0, head] : [sgn * sw, head];
        const poly = [[sgn * x, head]].concat(curve);          // top corner, then down the outer curve to (x, spring)
        B.extrude(poly, F, a.sp.v[0], a.sp.v[1], a.sp.c, { back: false, skipDown: true });
      }
    }
  }

  function build() {
    const S = window.slopes, T = window.THREE;
    const t0 = performance.now();
    const B = S.build();
    const seg = Math.max(6, Math.round(ARCHES.segments * S.detail()));
    let n = 0;
    for (const eid of Object.keys(_data)) {
      try { archOne(B, _data[eid], seg); n++; }
      catch (e) { console.warn('[slopes-arches] eid', eid, e); }
    }
    const mesh = new T.Mesh(B.geometry(), S.material());
    mesh.name = 'arches';
    const g = new T.Group();
    g.name = 'slopes-arches';
    g.userData.lod = ARCHES.lod;
    g.userData.minzoom = (window.ENT && typeof window.ENT.minZoom === 'number') ? window.ENT.minZoom : ARCHES.minzoom;
    g.add(mesh);
    count.arches = n; count.triangles = B.triangles; count.ms = +(performance.now() - t0).toFixed(1);
    _lastDetail = S.detail();
    return g;
  }

  function setFilters(on) {
    if (!_map) return;
    for (const id of ARCHES.layers) {
      if (!_map.getLayer(id)) continue;
      if (on) {
        if (id in _orig) continue;
        const f = _map.getFilter(id) || null;
        _orig[id] = f;
        const hide = ['!', ['has', ARCHES.tag]];
        _map.setFilter(id, f ? ['all', f, hide] : hide);
      } else if (id in _orig) {
        _map.setFilter(id, _orig[id]);
        delete _orig[id];
      }
    }
    _filtered = on;
  }

  window.applySlopesArches = function applySlopesArches(map) {
    map = map || _map;
    if (!map || !_data) return;
    const S = window.slopes;
    const want = !!(window.SLOPES.on && ARCHES.on);
    if (want && !_group) { _group = build(); S.add(_group); }
    else if (want && _group && _lastDetail !== S.detail()) { S.remove(_group); _group = build(); S.add(_group); }
    else if (!want && _group) { S.remove(_group); _group = null; }
    setFilters(want);
    map.triggerRepaint();
  };

  window.slopesArches = {
    rebuild() { if (_group) { window.slopes.remove(_group); _group = null; } window.applySlopesArches(); },
    at(ref) { return _data ? Object.keys(_data).filter(k => _data[k].ref === ref).map(k => ({ eid: +k, ..._data[k] })) : []; },
    get count() { return { ...count }; },
    get group() { return _group; },
    get data() { return _data; },
    get filtered() { return _filtered; },
  };

  // ── boot ────────────────────────────────────────────────────────────────
  // The entrances are a deferred source (js/entrances.js ENT.defer); this
  // waits for the layers that draw the chords, then reads `arches` off the
  // object app.js handed the source, or fetches the file if it was tiled.
  async function boot() {
    const map = window.__map, S = window.slopes;
    if (!map || !S || !S.root) return false;
    if (window.ENT && window.ENT.on === false) { count.done = true; return true; }   // no doors, no arches
    if (!ARCHES.layers.some(id => map.getLayer(id))) return false;
    _map = map;
    let arches = null;
    try {
      const src = map.getSource(ARCHES.source);
      const d = src && src._data;
      if (d && typeof d === 'object' && d.arches) arches = d.arches;
    } catch (e) {}
    if (!arches) {
      try { const gj = await S.fetchJSON(ARCHES.url); arches = gj && gj.arches; } catch (e) { console.warn('[slopes-arches]', e.message); }
    }
    count.done = true;
    if (!arches || !Object.keys(arches).length) { console.warn('[slopes-arches] entrances.geojson carries no arches — chords stay'); return true; }
    _data = arches;
    S.onSwitch(() => window.applySlopesArches(map));
    const orig = window.applySlopesSettings;
    if (typeof orig === 'function' && !orig.__archesHooked) {
      const wrapped = function (m) { const r = orig.apply(this, arguments); try { window.applySlopesArches(m); } catch (e) {} return r; };
      wrapped.__archesHooked = true;
      window.applySlopesSettings = wrapped;
    }
    window.applySlopesArches(map);
    console.log('[slopes-arches]', count.arches, 'arched entrances in', count.triangles, 'triangles,', count.ms, 'ms');
    return true;
  }
  (function poll() {
    if (new URLSearchParams(location.search).get('slopes') === '0') return;
    let n = 0, busy = false;
    const t = setInterval(async () => {
      if (busy) return;
      busy = true;
      let done = false;
      try { done = await boot(); } catch (e) { console.error('[slopes-arches]', e); done = true; }
      busy = false;
      if (done || ++n > 1200) clearInterval(t);
    }, 200);
  })();
})();
