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
    smooth: true,                  // the curved pieces shade as one curve, not a necklace of
                                   // facets (slopes.build's extrude opts.smooth; corners stay sharp)
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
    // THE ARCADE. Where scripts/bake_entrances.py writes an `arcade` member
    // on a door (a CELEBRATED row with arcade=True — Sutton Hall's north
    // front, off campus_truth.json's photograph: "4 round arches at grade (1
    // door, 3 windows)"), the other bays of that wall are drawn here as the
    // same arch as the door: band, spandrel, and the dark of the loggia
    // behind, with the stone carried between the bays from grade to a string
    // course over the crowns. The critics' read of the pose on 2026-09-03 was
    // a flat wall of atlas windows with one lone arched door; the truth file
    // had said "arcade" all along, and nothing drew it.
    arcade: true,
    arcadeDark: true,              // the openings as the loggia's shadow, a hair off the wall
    arcadeString: true,            // the string course over the crowns
    arcadeStringProud: 0.06,       // m the string course stands proud of the skin
    arcadeSpandrel: 'band',        // 'band': the spandrels take the surround's stone on an
                                   // arcaded wall (the critics read the family's terracotta
                                   // wedges as a texture defect there); 'own': the accent
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
      B.extrude(poly, F, a.tr.v[0], a.tr.v[1], a.tr.c, { back: false, skipDown: true, smooth: ARCHES.smooth });
    }
    if (ARCHES.band && a.band && radial) {
      // ONE ring, not two halves: the extrados runs right over the crown, so
      // there is no seam at u = 0 for two coincident side faces to fight over.
      const sw = a.band.sw;
      const outer = arcOut(a, 2 * seg, sw, 0, Math.PI);        // (half+sw, spring) → (0, crown+sw) → (-(half+sw), spring)
      const inner = arcPts(a, 2 * seg, 0, Math.PI, 0);         // (-half, spring) → (0, crown) → (half, spring)
      B.extrude(outer.concat(inner), F, a.band.v[0], a.band.v[1], a.band.c, { back: false, skipDown: true, smooth: ARCHES.smooth });
    } else if (ARCHES.band && a.band) {
      for (const sgn of [1, -1]) {
        const sw = a.band.sw;
        const outer = arcPts(a, seg, sw, 0, Math.PI / 2).map(p => [sgn * Math.abs(p[0]), p[1]]);
        const inner = arcPts(a, seg, 0, Math.PI / 2, 0).map(p => [sgn * Math.abs(p[0]), p[1]]);
        outer[outer.length - 1] = [sgn * sw, crown];
        inner[0] = [0, crown];
        B.extrude(outer.concat(inner), F, a.band.v[0], a.band.v[1], a.band.c, { back: false, skipDown: true, smooth: ARCHES.smooth });
      }
    }
    if (ARCHES.arcade && a.arcade) arcadeParts(B, a, seg, F);
    if (ARCHES.spandrel && a.sp) {
      for (const sgn of [1, -1]) {
        const sw = a.sp.sw, x = a.half + sw, head = crown + (radial ? sw : 0);
        // the corner between the extrados and the square: pinched to a point
        // at the crown, where the archivolt now reaches the head itself
        const curve = (radial ? arcOut(a, seg, sw, Math.PI / 2, 0) : arcPts(a, seg, sw, Math.PI / 2, 0))
          .map(p => [sgn * Math.abs(p[0]), p[1]]);
        curve[0] = radial ? [0, head] : [sgn * sw, head];
        const poly = [[sgn * x, head]].concat(curve);          // top corner, then down the outer curve to (x, spring)
        const spCol = (a.arcade && ARCHES.arcade && ARCHES.arcadeSpandrel === 'band' && a.band) ? a.band.c : a.sp.c;
        B.extrude(poly, F, a.sp.v[0], a.sp.v[1], spCol, { back: false, skipDown: true, smooth: ARCHES.smooth });
      }
    }
  }

  /**
   * One arcade bay at u = uc in the door's frame: the head (band, spandrels in
   * stone, and the dark half-ellipse of the opening), and below the springing
   * the dark opening between the bands' straight legs. `skin`/`dark` are the
   * arcade's own pieces from the bake.
   */
  function arcadeBay(B, a, seg, F, uc, A) {
    const crown = a.spring + a.rise, sw = a.band.sw;
    const sh = { ...a, half: a.half };            // the same arch, shifted along the wall
    const shift = pts => pts.map(p => [p[0] + uc, p[1]]);
    if (ARCHES.arcadeDark && A.dark) {
      // the opening: a rectangle to the springing and the half-ellipse over it, in the loggia's shadow
      const poly = [[a.half, 0], [a.half, a.spring]].concat(arcPts(sh, 2 * seg, 0, 0, Math.PI).slice(1, -1)).concat([[-a.half, a.spring], [-a.half, 0]]);
      B.extrude(shift(poly), F, A.dark.v[0], A.dark.v[1], A.dark.c, { back: false, skipDown: true, smooth: ARCHES.smooth });
    }
    // the band: the same concentric archivolt as the door's
    const outer = arcOut(sh, 2 * seg, sw, 0, Math.PI), inner = arcPts(sh, 2 * seg, 0, Math.PI, 0);
    B.extrude(shift(outer.concat(inner)), F, a.band.v[0], a.band.v[1], a.band.c, { back: false, skipDown: true, smooth: ARCHES.smooth });
    // its straight legs, grade to springing
    for (const sgn of [1, -1]) {
      const leg = [[sgn * a.half, 0], [sgn * (a.half + sw), 0], [sgn * (a.half + sw), a.spring], [sgn * a.half, a.spring]];
      B.extrude(shift(leg), F, a.band.v[0], a.band.v[1], a.band.c, { back: false, skipDown: true });
    }
    // the spandrels, to the square's head at crown + sw
    if (a.sp) {
      const col = ARCHES.arcadeSpandrel === 'band' ? a.band.c : a.sp.c;
      for (const sgn of [1, -1]) {
        const x = a.half + sw, head = crown + sw;
        const curve = arcOut(sh, seg, sw, Math.PI / 2, 0).map(p => [sgn * Math.abs(p[0]), p[1]]);
        curve[0] = [0, head];
        B.extrude(shift([[sgn * x, head]].concat(curve)), F, a.sp.v[0], a.sp.v[1], col, { back: false, skipDown: true, smooth: ARCHES.smooth });
      }
    }
  }
  /**
   * The whole arcade on the door's wall: every bay the bake laid out that is
   * not a door, the stone between the bays (grade to the string course), the
   * panel over each head, and the string course itself.
   */
  function arcadeParts(B, a, seg, F) {
    const A = a.arcade;
    if (!A || !A.bays || !A.bays.length || !a.band) return;
    const crown = a.spring + a.rise, sw = a.band.sw, reach = a.half + sw;
    const skin = A.skin, zs = A.string;
    const isDoor = u => A.doors.some(d => Math.abs(d - u) < reach);
    const cols = A.bays.map(u => ({ u, door: isDoor(u) }));
    for (const c of cols) if (!c.door) arcadeBay(B, a, seg, F, c.u, A);
    if (!skin) return;
    const zTop = ARCHES.arcadeString ? zs[1] : zs[0];
    // the stone between the bays: from the wall's start, between each pair, to its end.
    // Beside a door bay the door's own fill-extrusion legs stand at ±half..±(half+sw)
    // up to the springing, so the pier starts past them there.
    const edges = [A.wall[0]].concat(cols.flatMap(c => [c.u - reach, c.u + reach])).concat([A.wall[1]]);
    for (let i = 0; i < edges.length; i += 2) {
      const u0 = edges[i], u1 = edges[i + 1];
      if (u1 - u0 < 0.03) continue;
      B.extrude([[u0, 0], [u1, 0], [u1, zTop], [u0, zTop]], F, skin.v[0], skin.v[1], skin.c, { back: false, skipDown: true });
    }
    // the panel over each head, door bays included, from the square's head to
    // the string course (a door's own band and spandrels reach the head; its
    // keystone stands proud of this panel)
    for (const c of cols) {
      const poly = [[c.u - reach, crown + sw], [c.u + reach, crown + sw], [c.u + reach, zTop], [c.u - reach, zTop]];
      B.extrude(poly, F, skin.v[0], skin.v[1], skin.c, { back: false, skipDown: true });
    }
    if (ARCHES.arcadeString) {
      const v1 = skin.v[1] + ARCHES.arcadeStringProud;
      B.extrude([[A.wall[0], zs[0]], [A.wall[1], zs[0]], [A.wall[1], zs[1]], [A.wall[0], zs[1]]], F, skin.v[0], v1, skin.c, { back: false });
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
  // THE FILE IS FETCHED ONCE, BY js/entrances.js, AND WAITED FOR HERE.
  //
  // data/entrances.geojson is 6.4 MB on the wire and is loaded on a DEFER
  // (js/entrances.js ENT.defer: idle + 2 s, capped at 25 s), so at the moment
  // this file boots there is nothing to read. The first version handled that by
  // trying `map.getSource('austin-entrances')._data.arches` and FETCHING THE
  // FILE AGAIN when that came up empty — and it always came up empty, because
  // MapLibre 5.24.0 does not store what you hand a geojson source: `_data` is
  // `{ geojson: <your object> }` (probed on the running app, 2026-09-04; the
  // original object is on `_options.data`). So the fallback fired on every
  // single ON load: entrances.geojson was requested twice, at full price both
  // times, and the page went 18.67 MB -> 25.04 MB on the wire — the whole of
  // this layer's measured page delta, for a file it shares with another pass.
  //
  // The fix is not a better private field to read. It is that js/entrances.js
  // now PUBLISHES what it parsed, as a promise that always settles
  // (`window.entrancesGeoJSON()`), and this waits on that. The direct fetch
  // survives only for a page that loads this file WITHOUT js/entrances.js —
  // there is no such page in the repo today, and if one appears it should get
  // arches rather than a silent nothing.
  //
  // `?entrances=0` is handled above and deliberately builds NOTHING: the whole
  // job of this group is to draw the curve those 448 flat chords approximate
  // and to hide the chords from `entrances-portal` / `entrances-glass`. With
  // the doors switched off there are no chords, no layers to filter, and an
  // arch band hanging in the air where its own doorway is not drawn.
  async function boot() {
    const map = window.__map, S = window.slopes;
    if (!map || !S || !S.root) return false;
    if (window.ENT && window.ENT.on === false) { count.done = true; return true; }   // no doors, no arches
    // Still gated on the layers, not only on the data: setFilters() has to have
    // something to take the chords out of, and the layers land in the same call
    // that resolves the promise.
    if (!ARCHES.layers.some(id => map.getLayer(id))) return false;
    _map = map;
    let arches = null;
    if (typeof window.entrancesGeoJSON === 'function') {
      const gj = await window.entrancesGeoJSON();      // never rejects
      arches = gj && gj.arches;
    } else {
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
