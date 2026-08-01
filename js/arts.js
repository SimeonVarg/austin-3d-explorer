/**
 * arts.js — the arts and presidential precinct: LBJ, Kelly's Austin, the Blanton
 * (+ the Snøhetta petals), the Harry Ransom Center and Bass Concert Hall.
 *
 * WHY THIS FILE EXISTS. These are the five buildings on campus where the
 * architecture is the subject rather than the container, and four of the five are
 * essentially BLIND — no window grid at all. The generic facade system is not
 * slightly wrong on them, it is wrong in kind: it was drawing office windows on a
 * windowless travertine box, on a barrel-vaulted stone chapel, and on a concert
 * hall whose whole point is that only the lobby is glass.
 *
 * So this pass is mostly SUBTRACTION. `data/arts.geojson` (scripts/bake_arts.py)
 * replaces sixteen generic extrusions with 79 stacked band features, and 77 of
 * those 79 carry a flat measured colour and NO PATTERN AT ALL. Two exceptions,
 * two registered images, and each one is a feature the eye can actually resolve
 * from 400 m:
 *
 *   the Ransom Center's panel field  the upper two thirds of that building are
 *     large etched translucent glass panels — a solid-looking grid, and per the
 *     brief "the panel grid is the facade". A ~6.5 m panel is 10-14 px at
 *     cruise, the largest drawable feature anywhere in this pass.
 *   Bass's 2008 lobby  one glass box against 105 m of blind brick. This was
 *     first done for free by borrowing the shared atlas through
 *     quantiseOuterFacades(); measured, that produced a BRICK lobby (see the
 *     taste block). Its own image is the price of the one contrast that
 *     identifies the building.
 *
 * WHAT COULD NOT BE DRAWN, and why it is flat colour instead. At this app's
 * flying zooms a 64 px pattern covers 30-59 m of wall, so one texel is 0.4-0.6 m
 * and the smallest feature that survives camera motion is about 1 m. That rules
 * out Kelly's fourteen coloured-glass openings (0.6 x 0.9 m), the LBJ's
 * travertine coursing, and the Blanton's arcade of round arches. It also rules
 * them out for a second, less obvious reason: a pattern has no vertical anchor
 * AND its world scale halves at every integer zoom, so a band 5 m tall shows a
 * different 5-11 px slice of the tile at every altitude. Only a statistically
 * UNIFORM pattern survives that. An arcade is not uniform — it has to sit at the
 * bottom — so the Blanton's loggia is modelled as geometry instead: a band inset
 * 2.6 m and painted in shadow, which is what a colonnade looks like from 400 m.
 *
 * REGISTRATION. Self-booting, like js/outer.js. index.html and _harness.html
 * already carry the <script> tag; neither file is touched by this pass.
 *
 * Public (window) API:
 *   initArts(map)            — add source + layers (called automatically)
 *   applyArtsColors(map, p)  — retint for time-of-day p (hooked automatically)
 *   ARTS                     — the taste block
 */
(function () {
  'use strict';

  const q = new URLSearchParams(window.location.search);

  const ARTS = {
    // ?arts=0 removes the pass at load. This exists for scripts/verify/
    // arts-perf.mjs, which measures the A/B on ONE build rather than on two
    // checkouts — the shape js/outer.js established and the only way an
    // interleaved A/B is honest.
    on: q.get('arts') !== '0',
    minZoom: 14,

    // ── the Ransom Center panel tile ──────────────────────────────────────
    // 64 px covers 30-59 m of wall at the zooms this app flies, so a 6-cell tile
    // draws a 5-10 m panel. The real panels measure ~6.5 m square off the
    // elevation photograph (three courses over a 20 m field, two panels per
    // structural bay), which lands in the middle of that range.
    panelCells: 6,
    panelJoint: 1,        // px. One texel = 0.4-0.6 m, which is a real joint
                          // reveal. Two would assert a 1 m gap between panels.
    panelBay: 2,          // a heavier structural line every N cells
    panelVary: 0.055,     // per-panel value scatter. The panels are individually
                          // etched with different images; they are not identical.
    // At night the etched glass is backlit. TWO terms, and the split is the
    // point: a uniform wash over the WHOLE field plus a scatter on top. A
    // scatter alone is what an office building does — lit windows in a dark
    // wall — and the first night render of this facade read exactly like that,
    // as a dark blank slab with a few dots. Translucent glass lit from behind
    // glows all over and unevenly, which is what the Ransom Center's own
    // description of the facade as a beacon actually describes.
    panelNightWash: 0.24,
    panelGlow: 0.34,
    // The joint is a fraction OF THE PANEL, not an absolute dark. The first cut
    // of this tile used the sampled joint hex (#312e2c) directly and rendered as
    // a black cage over grey — 11 hard bars across a 63 m elevation. A joint at
    // this distance is a shadow reveal a few centimetres deep, so it is a value
    // step, and a value step is the only thing that survives minification
    // gracefully: it averages into the field instead of aliasing into bars.
    panelJointDark: 0.30,
    panelBayDark: 0.45,

    // ── the Bass lobby curtain wall ──────────────────────────────────────
    // This was originally handed to quantiseOuterFacades() to borrow a pattern
    // from the shared atlas at zero image cost. MEASURED, that produced a brick
    // lobby: #ac7a52 on screen against a sampled #738e9d. The shared palette is
    // fourteen buckets derived from Austin's building colours and they are
    // almost all tan, so nearest-RGB on a blue-grey glass simply snaps to brick.
    // scripts/bake_stadium.py hit exactly this and says so about its 2008 brick
    // end zone. One glass box against 105 m of blind brick IS the building, so
    // it gets its own image — the second and last one this pass registers.
    glassRows: 6,         // ~5-10 m: a floor band, not a single pane
    glassCols: 8,         // ~4-7 m: a structural bay, not a single mullion
    glassMullion: 1,
    glassLit: 0.42,       // fraction of bays lit after dusk
  };
  window.ARTS = ARTS;

  const SRC = 'austin-arts';
  const L_SOLID = 'arts-solid';
  const L_PANEL = 'arts-panel';
  const L_GLASS = 'arts-glass';
  const L_CAP = 'arts-cap';
  const PANEL_IMG = 'arts-hrc-panel';
  const GLASS_IMG = 'arts-bass-glass';
  const DATA = 'data/arts.geojson';

  /** ['interpolate', p, day, golden, night] — the shape js/timeofday.js bakes with. */
  function tod(p, d, g, n) {
    p = Math.max(0, Math.min(1, p));
    return ['interpolate', ['linear'], p,
      0, ['to-color', ['get', d], '#888888'],
      0.5, ['to-color', ['get', g], '#888888'],
      1, ['to-color', ['get', n], '#333344'],
    ];
  }
  const wallColor = p => tod(p, 'wd', 'wg', 'wn');
  const capColor = p => tod(p, 'rd', 'rg', 'rn');

  // ── the two pattern images ──────────────────────────────────────────
  function hexToRgb(h) {
    return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  }
  function mix(a, b, t) { return a.map((v, i) => v + (b[i] - v) * t); }

  /** The same day -> golden -> night ramp scripts/bake_arts.py bakes into wd/wg/wn. */
  function ramp(day, golden, night, p) {
    return p <= 0.5 ? mix(day, golden, p / 0.5) : mix(golden, night, (p - 0.5) / 0.5);
  }

  // Deterministic 0..1. Copied in spirit from js/facades.js: a per-panel scatter
  // has to be stable across repaints or the wall shimmers every time-of-day tick.
  function hash01(a, b) {
    let x = (a * 374761393 + b * 668265263) | 0;
    x = (x ^ (x >> 13)) * 1274126177;
    return ((x ^ (x >> 16)) >>> 0) / 4294967295;
  }

  let _ctx = null;
  const T = 64;

  function ctx2d() {
    if (!_ctx) {
      const c = document.createElement('canvas');
      c.width = c.height = T;
      // willReadFrequently, because this canvas is read back with getImageData
      // on every time-of-day tick and never composited from a GPU surface. See
      // the canvas note in docs/PASS_COMMON.md section 3 — drawImage FROM a
      // WebGL canvas forces a pipeline flush, 230 ms against 22 ms.
      _ctx = c.getContext('2d', { willReadFrequently: true });
    }
    return _ctx;
  }
  const css = v => `rgb(${v.map(x => Math.round(Math.max(0, Math.min(255, x)))).join(',')})`;
  function grab(ctx) {
    const img = ctx.getImageData(0, 0, T, T);
    return { width: T, height: T, data: new Uint8Array(img.data.buffer.slice(0)) };
  }
  /** 0 before dusk, 1 at full night. */
  const nightAt = p => Math.max(0, (p - 0.62) / 0.38);

  /**
   * The Ransom Center's etched-glass panel grid, at time-of-day p.
   *
   * Deliberately NOT a window grid: there is no glazing ratio here and no
   * spandrel. Every cell is the same pale neutral as its neighbour give or take
   * a few percent, and all the structure is in the joints. That is the whole
   * difference between "clad box" and "office building" at this distance.
   */
  function panelTile(p) {
    const ctx = ctx2d();
    const base = ramp(hexToRgb('#a4a4a1'), hexToRgb('#b0a294'), hexToRgb('#22242a'), p);
    const joint = mix(base, [0, 0, 0], ARTS.panelJointDark);
    const bay = mix(base, [0, 0, 0], ARTS.panelBayDark);
    const glow = hexToRgb('#c8a86a');
    const night = nightAt(p);

    ctx.fillStyle = css(joint);
    ctx.fillRect(0, 0, T, T);

    const N = ARTS.panelCells, J = ARTS.panelJoint;
    const step = T / N;
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const t = hash01(r + 1, c + 1);
        let v = mix(base, t < 0.5 ? [0, 0, 0] : [255, 255, 255],
                    ARTS.panelVary * Math.abs(t * 2 - 1));
        if (night > 0) {
          v = mix(v, glow, night * ARTS.panelNightWash);                 // the whole field
          if (hash01(c + 7, r + 3) > 0.62) v = mix(v, glow, night * ARTS.panelGlow);
        }
        ctx.fillStyle = css(v);
        ctx.fillRect(Math.round(c * step) + J, Math.round(r * step) + J,
                     Math.round(step) - J, Math.round(step) - J);
      }
    }
    // The structural line: a heavier vertical every panelBay cells. This is the
    // column grid behind the cladding and it is what stops 36 identical squares
    // reading as graph paper.
    ctx.fillStyle = css(bay);
    for (let c = 0; c < N; c += ARTS.panelBay) ctx.fillRect(Math.round(c * step), 0, J, T);
    return grab(ctx);
  }

  /**
   * Bass's 2008 lobby: a real curtain wall, and the only glass in this pass.
   *
   * Sized for the STRUCTURAL bay, not the mullion. A 1.5 m mullion spacing is
   * 2-3 px of a tile that covers 30-59 m of wall, so drawing it would draw a
   * 3-5 m mullion — the same lie that makes a 7 cm brick course come out as
   * concrete block. Eight columns across the tile is a 4-7 m bay, which is what
   * actually reads on the photograph from across the street.
   */
  function glassTile(p) {
    const ctx = ctx2d();
    // #6b93b6, not the sampled #738e9d. A wall face in this renderer comes out
    // at about R x0.78 / G x0.69 / B x0.58 of its input, so the photograph's
    // own value renders dead neutral and the pass's only cool material stops
    // being cool. Entered bluer so it lands blue. Kept in step with
    // MAT["bass_glass"] in scripts/bake_arts.py.
    const glass = ramp(hexToRgb('#6b93b6'), hexToRgb('#93917f'), hexToRgb('#1b2029'), p);
    const frame = ramp(hexToRgb('#cfd4d6'), hexToRgb('#d6c2a6'), hexToRgb('#2a2c34'), p);
    const lit = hexToRgb('#f0d59a');
    const night = nightAt(p);

    ctx.fillStyle = css(frame);
    ctx.fillRect(0, 0, T, T);
    const R = ARTS.glassRows, C = ARTS.glassCols, M = ARTS.glassMullion;
    const sx = T / C, sy = T / R;
    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C; c++) {
        let v = mix(glass, [255, 255, 255], 0.05 * hash01(r + 2, c + 5));
        if (night > 0 && hash01(c + 11, r + 4) < ARTS.glassLit) v = mix(v, lit, night * 0.62);
        ctx.fillStyle = css(v);
        ctx.fillRect(Math.round(c * sx) + M, Math.round(r * sy) + M,
                     Math.round(sx) - M, Math.round(sy) - M);
      }
    }
    return grab(ctx);
  }

  const TILES = { [PANEL_IMG]: panelTile, [GLASS_IMG]: glassTile };

  function ensureImages(map, p) {
    for (const id of Object.keys(TILES)) {
      try {
        if (map.hasImage && map.hasImage(id)) map.updateImage(id, TILES[id](p));
        else map.addImage(id, TILES[id](p));
      } catch (e) { /* already registered, or the canvas is gone */ }
    }
  }

  async function getJSON(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(url + ': ' + r.status);
    return await r.json();
  }

  let _added = false;

  window.initArts = async function initArts(map) {
    if (!ARTS.on || _added || map.getSource(SRC)) return;
    _added = true;

    let gj;
    try {
      gj = await getJSON(DATA);
    } catch (e) {
      console.warn('[arts]', e.message, '- precinct not drawn');
      return;
    }

    const p = (window.__todCurrentP != null) ? window.__todCurrentP : 0.3;
    // Both images must exist BEFORE any layer references them, or MapLibre logs
    // "image not found" and paints those walls transparent — the same ordering
    // js/app.js observes for initFacades.
    ensureImages(map, p);

    const glass = gj.features.filter(f => f.properties && f.properties.lyr === 'glass');
    map.addSource(SRC, { type: 'geojson', data: gj, ...(window.PATTERN_TILING || {}) });

    // The generic extrusions these bands supersede have to STOP being drawn or
    // the old box buries every band inside it. Same mechanism app.js uses for
    // the stadium; the ids were checked against every other replacedBuildingIds
    // in data/ and there is no overlap.
    const gone = gj.replacedBuildingIds || [];
    if (gone.length) {
      const notReplaced = ['!', ['in', ['get', 'id'], ['literal', gone]]];
      for (const id of ['buildings-3d', 'buildings-roof']) {
        if (!map.getLayer(id)) continue;
        const f = map.getFilter(id);
        try { map.setFilter(id, f ? ['all', f, notReplaced] : notReplaced); } catch (e) {}
      }
    }

    // The anchor must be the first symbol layer AFTER our buildings, not the
    // first in the style. The basemap puts symbol layers immediately after
    // `background`, and anchoring there drops the whole pass to the BOTTOM of
    // the stack, under the ground — which is exactly how the stadium once ended
    // up rendering beneath `ground-areas`.
    const stack = map.getStyle().layers;
    const after = Math.max(0, stack.findIndex(l => l.id === 'buildings-3d'));
    const anchor = (stack.slice(after + 1).find(l => l.type === 'symbol') || {}).id;

    const geom = { 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-base': ['get', 'base'] };

    map.addLayer({
      id: L_SOLID, type: 'fill-extrusion', source: SRC, minzoom: ARTS.minZoom,
      filter: ['==', ['get', 'lyr'], 'solid'],
      paint: Object.assign({}, geom, {
        'fill-extrusion-color': wallColor(p),
        'fill-extrusion-opacity': 1.0,
        // OFF, and for the same reason bake_stadium's walls turn it off: the
        // gradient darkens the bottom of EACH extrusion, and these are three to
        // six stacked extrusions per building, so it draws a dark seam at every
        // band boundary. On the LBJ's 4.2 m undercroft the whole band falls
        // inside the gradient and the piers render as a row of black teeth.
        // The band tones already carry the vertical hierarchy.
        'fill-extrusion-vertical-gradient': false,
      }),
    }, anchor);

    map.addLayer({
      id: L_PANEL, type: 'fill-extrusion', source: SRC, minzoom: ARTS.minZoom,
      filter: ['==', ['get', 'lyr'], 'panel'],
      paint: Object.assign({}, geom, {
        'fill-extrusion-pattern': PANEL_IMG,
        'fill-extrusion-opacity': 1.0,
        'fill-extrusion-vertical-gradient': false,
      }),
    }, anchor);

    map.addLayer({
      id: L_GLASS, type: 'fill-extrusion', source: SRC, minzoom: ARTS.minZoom,
      filter: ['==', ['get', 'lyr'], 'glass'],
      paint: Object.assign({}, geom, {
        'fill-extrusion-pattern': GLASS_IMG,
        'fill-extrusion-opacity': 1.0,
        // ON here, unlike the bands: the lobby is one 15.8 m extrusion, not a
        // stack, so there is no seam for the gradient to draw.
        'fill-extrusion-vertical-gradient': true,
      }),
    }, anchor);

    // The parapet lip, following app.js's shared CAP_GEOM rule so this pass
    // cannot drift from every other roof in the scene. Only the topmost band of
    // each building is capped — capping every band would put a ledge at each
    // boundary, which on the LBJ would be four ledges up a blank wall.
    const G = window.CAP_GEOM;
    if (G) {
      map.addLayer({
        id: L_CAP, type: 'fill-extrusion', source: SRC, minzoom: ARTS.minZoom,
        filter: ['==', ['get', 'cap'], 1],
        paint: {
          'fill-extrusion-color': capColor(p),
          'fill-extrusion-height': G.height(['get', 'h']),
          'fill-extrusion-base': G.base(['get', 'h']),
          'fill-extrusion-opacity': 1.0,
        },
      }, anchor);
    }

    console.log('[arts]', gj.features.length, 'band features over', gone.length,
                'replaced buildings (', glass.length, 'glass,',
                gj.features.filter(f => f.properties.lyr === 'panel').length,
                'panel, 2 new images )');
  };

  // js/timeofday.js quantises p to 1/128 and skips its own expensive path in
  // between — 128 heavy passes per sweep instead of 1,920. A module that wraps
  // applyTimeOfDay does NOT see that decision: the wrapper runs on the cheap
  // per-frame path too. js/outer.js can ignore that because its hook is two
  // setPaintProperty calls; this one redraws two 64 px canvases and re-uploads
  // two textures, which at 60 fps is 120 texture uploads a second for a colour
  // change nobody can see. So the same quantisation is repeated here.
  let _lastPq = null;
  const PQ = 128;

  window.applyArtsColors = function applyArtsColors(map, p, force) {
    // `!ARTS.on` first, and it matters: without it the ?arts=0 side of the
    // perf A/B still redraws and re-uploads both tiles on every quantised tick,
    // so the "off" configuration pays part of this pass's cost and the
    // measurement understates it. An A/B that measures the wrong thing is worse
    // than no A/B.
    if (!ARTS.on || !map || !map.getLayer) return;
    const pq = Math.round(Math.max(0, Math.min(1, p)) * PQ) / PQ;
    if (force !== true && _lastPq !== null && pq === _lastPq) return;
    _lastPq = pq;
    try {
      if (map.getLayer(L_SOLID)) map.setPaintProperty(L_SOLID, 'fill-extrusion-color', wallColor(p));
    } catch (e) {}
    try {
      if (map.getLayer(L_CAP)) map.setPaintProperty(L_CAP, 'fill-extrusion-color', capColor(p));
    } catch (e) {}
    // Both tiles are IMAGES, not paint properties, so they need RE-DRAWING
    // rather than re-expressing. A building that only looks right at noon is not
    // done — docs/PASS_COMMON.md section 4. This is also where the Ransom
    // Center's panels light up and the Bass lobby's bays come on after dusk.
    //
    // This line went missing once during a refactor and nothing else noticed:
    // the two patterned bands simply stayed frozen at whatever time of day they
    // were first registered at, while every band around them moved. That is why
    // scripts/verify/arts-check.mjs asserts the IMAGE BYTES change and not just
    // that the paint properties do.
    ensureImages(map, p);
  };

  // ── bootstrap ─────────────────────────────────────────────────────
  // Copied from the boot() at the bottom of js/outer.js. app.js is owned by
  // another pass and will not call this module, so it waits for the map and the
  // core layers and inserts itself. applyTimeOfDay is wrapped here, after every
  // module has loaded, so script order cannot break it.
  function boot() {
    const map = window.__map;
    if (!map) return setTimeout(boot, 60);

    const hookTod = () => {
      if (typeof window.applyTimeOfDay !== 'function' || window.applyTimeOfDay.__arts) return;
      const prev = window.applyTimeOfDay;
      const wrapped = function (m, p, force) {
        const r = prev.apply(this, arguments);
        // `force` is passed through so the verification harness, which calls
        // applyTimeOfDay(map, p, true) to bypass the 1/128 quantisation, also
        // bypasses this module's copy of it.
        try { window.applyArtsColors(m, p, force); } catch (e) {}
        return r;
      };
      wrapped.__arts = true;
      window.applyTimeOfDay = wrapped;
    };

    const go = () => {
      // Wait for the core buildings AND for facades.js, which is what puts the
      // scene into the state where addImage is safe. This pass registers its own
      // two images and borrows nothing, so it does not need the atlas itself —
      // but it does need to be after initFacades in the boot order rather than
      // racing it.
      if (!map.getLayer('buildings-3d') || typeof window.initFacades !== 'function') {
        return setTimeout(go, 120);
      }
      hookTod();
      window.initArts(map);
    };
    if (map.isStyleLoaded && map.isStyleLoaded()) go();
    else map.once('load', () => setTimeout(go, 0));
  }
  boot();
})();
