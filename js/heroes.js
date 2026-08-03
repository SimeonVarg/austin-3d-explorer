/**
 * heroes.js — three modern campus buildings that were drawn at half their height.
 *
 * WHY THIS FILE EXISTS. QUEUE F4: *"also add some UT buildings too - some of them
 * look really cool like EER but rn theyre a block. DO those"*. He is right, and
 * the reason is not that nobody modelled them — it is that their HEIGHTS are
 * wrong in the source data in a way that is easy to miss:
 *
 *   EER  8 floors x 2.84 m = 22.7   real: 9 floors, 40.5 m
 *   GDC  6 floors x 2.80 m = 16.8   real: 7 floors, 29.5 m
 *   NHB  6 floors x 2.80 m = 16.8   real: 7 storeys, 32.3 m to the louvre plane
 *
 * A 2.8 m floor is an apartment. These are wet-lab and teaching buildings whose
 * floors measure 4.1-4.7 m. So all three arrive as squat blocks, and no amount of
 * facade work makes a squat block look like a nine-storey building.
 * scripts/bake_heroes.py carries the derivation of every number, with the
 * photograph and the nadir tile each one came off.
 *
 * WHAT IS DRAWN, and it is deliberately little per building — the massing is the
 * whole point and detail below about a metre aliases at the zooms this app flies:
 *
 *   EER   two limestone bars, a glazed canyon between them with a glass roof over
 *         its middle 56 m, and the black steel space-frame LATTICE that closes the
 *         canyon's east end above the entrance. The snapshot footprint also covers
 *         the paved courtyard north of the north bar — there are cars parked on it
 *         in the z20 nadir tile — so this pass makes EER SMALLER in plan.
 *   GDC   two brick bars under a roof plane that oversails them by 2.5 m, joined
 *         by a seven-storey glass atrium standing proud of the brick.
 *   NHB   a limestone base under Acme brick, a four-storey recessed glass volume
 *         in the south face, and the perforated steel louvre plane floating over
 *         the middle 65 m of the roof.
 *
 * FIVE PATTERN IMAGES, and each one earns itself. The shared facade atlas is
 * fourteen colour buckets derived from Austin's building stock and they are
 * almost all tan, so handing it a blue curtain wall gets brick back —
 * docs/PASS_ARTS.md measured exactly that on the Bass lobby. Two of these
 * buildings are substantially glass and the third's identifying feature is a
 * black steel diagrid; none of that survives the atlas.
 *
 * REGISTRATION. Self-booting, like js/arts.js and js/outer.js — js/app.js is
 * owned by another pass and will not call this module. The <script> tag is in
 * BOTH index.html and _harness.html; scripts/verify/harness-drift.mjs is the
 * check that they stay in step.
 *
 * Public (window) API:
 *   initHeroes(map)            — add source + layers (called automatically)
 *   applyHeroColors(map, p)    — retint for time-of-day p (hooked automatically)
 *   HEROES                     — the taste block
 */
(function () {
  'use strict';

  const q = new URLSearchParams(window.location.search);

  const HEROES = {
    // ?heroes=0 removes the pass at load, so a before/after can be measured on
    // ONE build instead of on two checkouts — the shape js/outer.js established.
    on: q.get('heroes') !== '0',
    minZoom: 14,

    // ── EER limestone ────────────────────────────────────────────────────
    // A 64 px tile covers 30-59 m of wall at the zooms this app flies, so nine
    // rows put a floor line every 3.3-6.6 m against a measured 4.65 m. That is
    // the closest a pattern can get: fill-extrusion-pattern has no vertical
    // anchor and its world scale halves at every integer zoom, so the phase
    // drifts and only the RHYTHM survives. The rhythm is the point — the
    // photograph's most legible fact about this facade is a continuous dark
    // ribbon at every floor line.
    stoneRows: 9,
    stoneRibbon: 0.20,   // how far the ribbon steps DOWN from the field, as a
                         // fraction. Not a hex: docs/PASS_ARTS.md's Ransom Center
                         // joint went in as a sampled dark hex and rendered as a
                         // black cage over grey. A value step averages into the
                         // field under minification instead of aliasing into bars.
    stoneSlots: 0.34,    // fraction of cells carrying a narrow vertical window
    stoneSlotDark: 0.52,
    stoneLit: 0.52,      // fraction of those lit after dusk. Measured at 0.30:
                         // EER's night wall came out at mean luma 19 with a p90
                         // of 27, against 18-28 / 17-54 for the four buildings
                         // around it -- inside the range but with almost no
                         // bright pixels, which on a nine-storey research
                         // building reads as unlit rather than as late.

    // ── GDC brick ────────────────────────────────────────────────────────
    // Pelli's facade is a strict horizontal module: a cast-stone/brick spandrel,
    // a terracotta screen band, a glazed ribbon. Eight rows over the tile is a
    // 3.8-7.4 m module against a measured 4.10 m floor.
    brickRows: 8,
    brickPier: 8,        // px. The stack-bond pier rhythm, ~4-7 m — a structural
                         // bay, not a brick. A 7 cm brick course drawn here would
                         // come out as a concrete block; same trap as the Bass
                         // mullions.
    brickGlassFrac: 0.34,   // of each row
    brickScreenFrac: 0.26,
    brickLit: 0.34,

    // ── NHB brick ────────────────────────────────────────────────────────
    // Punched square windows in an Acme tan blend, with the angled brick reveal
    // the architects describe. The reveal is one texel on the sunward side of
    // each opening, which is all a 0.4-0.6 m texel can honestly say about it.
    nbRows: 7,
    nbCols: 9,
    nbWindow: 0.42,      // window as a fraction of the cell
    nbLit: 0.28,

    // ── curtain wall ─────────────────────────────────────────────────────
    glassRows: 6,
    glassCols: 8,
    glassMullion: 1,
    glassLit: 0.40,

    // ── the EER lattice ──────────────────────────────────────────────────
    // Five bays across and five levels, which is what the photograph shows: the
    // cage is 21.4 m wide and 21.1 m tall and its panels are square. The members
    // are 2 px, so 0.9-1.8 m — heavier than the real steel, and deliberately: a
    // 1 px diagonal on a minified tile disappears entirely, and this cage IS the
    // building. It is drawn OVER the glass rather than as a transparent overlay
    // so there is no second surface for the depth buffer to argue about.
    cageBays: 5,
    cageMember: 2,
    cageGlassLit: 0.30,
  };
  window.HEROES = HEROES;

  const SRC = 'austin-heroes';
  const DATA = 'data/heroes.geojson';
  const L = {
    solid: 'heroes-solid', lime: 'heroes-lime', brick: 'heroes-brick',
    nbrick: 'heroes-nbrick', glass: 'heroes-glass', glassb: 'heroes-glassb',
    lattice: 'heroes-lattice', cap: 'heroes-cap',
  };
  const IMG = {
    lime: 'heroes-img-lime', brick: 'heroes-img-brick', nbrick: 'heroes-img-nbrick',
    glass: 'heroes-img-glass', glassb: 'heroes-img-glassb', lattice: 'heroes-img-lattice',
  };

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

  // ── tiles ───────────────────────────────────────────────────────────
  function hexToRgb(h) {
    return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  }
  function mix(a, b, t) { return a.map((v, i) => v + (b[i] - v) * t); }

  /** The same day -> golden -> night ramp scripts/bake_heroes.py bakes into wd/wg/wn. */
  function ramp(day, golden, night, p) {
    return p <= 0.5 ? mix(day, golden, p / 0.5) : mix(golden, night, (p - 0.5) / 0.5);
  }
  /** wall_ramp() from the bake, so a tile and its building's flat bands agree. */
  function rampOf(hex, p) {
    const c = hexToRgb(hex);
    const g = mix(c, [255, 190, 130], 0.16);
    const n = mix(c.map(v => v * 0.19), [18, 22, 40], 0.42);
    return ramp(c, g, n, p);
  }

  // Deterministic 0..1 — a per-cell scatter has to be stable across repaints or
  // the wall shimmers on every time-of-day tick. Copied from js/arts.js.
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
      // willReadFrequently: this canvas is read back with getImageData on every
      // quantised time-of-day tick and never composited from a GPU surface.
      _ctx = c.getContext('2d', { willReadFrequently: true });
    }
    return _ctx;
  }
  const css = v => `rgb(${v.map(x => Math.round(Math.max(0, Math.min(255, x)))).join(',')})`;
  function grab(ctx) {
    const img = ctx.getImageData(0, 0, T, T);
    return { width: T, height: T, data: new Uint8Array(img.data.buffer.slice(0)) };
  }
  /** 0 before dusk, 1 at full night. Same threshold js/arts.js uses. */
  const nightAt = p => Math.max(0, (p - 0.62) / 0.38);

  /** EER: pale limestone, a dark ribbon at every floor line, narrow window slots. */
  function limeTile(p) {
    const ctx = ctx2d();
    const base = rampOf('#e2dacb', p);
    const lit = hexToRgb('#f0d9a2');
    const night = nightAt(p);
    ctx.fillStyle = css(base);
    ctx.fillRect(0, 0, T, T);

    const R = HEROES.stoneRows, step = T / R;
    for (let r = 0; r < R; r++) {
      const y0 = Math.round(r * step);
      // the slots: 1-2 px wide, most of a floor tall, in an irregular rhythm
      for (let c = 0; c < 16; c++) {
        if (hash01(r + 3, c + 11) > HEROES.stoneSlots) continue;
        const w = hash01(r + 5, c + 2) > 0.65 ? 2 : 1;
        const x = Math.round(c * T / 16) + 1;
        let v = mix(base, [0, 0, 0], HEROES.stoneSlotDark);
        if (night > 0 && hash01(c + 7, r + 13) < HEROES.stoneLit) {
          v = mix(v, lit, night * 0.88);
        }
        ctx.fillStyle = css(v);
        ctx.fillRect(x, y0 + 2, w, Math.max(1, Math.round(step) - 3));
      }
      // the ribbon, drawn last so it runs unbroken across the slots — which is
      // what the photograph shows: the floor line is continuous and the windows
      // stop at it.
      ctx.fillStyle = css(mix(base, [0, 0, 0], HEROES.stoneRibbon));
      ctx.fillRect(0, y0, T, 1);
    }
    return grab(ctx);
  }

  /** GDC: cast-stone spandrel / terracotta screen / glazed ribbon, per floor. */
  function brickTile(p) {
    const ctx = ctx2d();
    const brick = rampOf('#d8ccb6', p);
    const screen = rampOf('#8a6a55', p);
    const glass = rampOf('#4f86b4', p);
    const lit = hexToRgb('#efd49c');
    const night = nightAt(p);
    ctx.fillStyle = css(brick);
    ctx.fillRect(0, 0, T, T);

    const R = HEROES.brickRows, step = T / R;
    const gh = Math.max(1, Math.round(step * HEROES.brickGlassFrac));
    const sh = Math.max(1, Math.round(step * HEROES.brickScreenFrac));
    for (let r = 0; r < R; r++) {
      const y0 = Math.round(r * step);
      ctx.fillStyle = css(screen);
      ctx.fillRect(0, y0 + 1, T, sh);
      for (let c = 0; c < 16; c++) {
        let v = glass;
        if (night > 0 && hash01(c + 4, r + 9) < HEROES.brickLit) v = mix(v, lit, night * 0.70);
        ctx.fillStyle = css(v);
        ctx.fillRect(Math.round(c * T / 16), y0 + 1 + sh, Math.round(T / 16) - 1, gh);
      }
    }
    // The stack-bond piers: a light vertical every structural bay, drawn over
    // everything, which is how this facade actually reads from across the mall.
    ctx.fillStyle = css(mix(brick, [255, 255, 255], 0.10));
    for (let x = 0; x < T; x += HEROES.brickPier) ctx.fillRect(x, 0, 1, T);
    return grab(ctx);
  }

  /** NHB: Acme tan brick with punched square windows and an angled reveal. */
  function nbrickTile(p) {
    const ctx = ctx2d();
    const brick = rampOf('#c9a37c', p);
    const glass = rampOf('#3d5f7e', p);
    const lit = hexToRgb('#f0d69c');
    const night = nightAt(p);
    ctx.fillStyle = css(brick);
    ctx.fillRect(0, 0, T, T);

    const R = HEROES.nbRows, C = HEROES.nbCols;
    const sx = T / C, sy = T / R;
    const ww = Math.max(1, Math.round(sx * HEROES.nbWindow));
    const wh = Math.max(1, Math.round(sy * HEROES.nbWindow));
    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C; c++) {
        const x = Math.round(c * sx + (sx - ww) / 2);
        const y = Math.round(r * sy + (sy - wh) / 2);
        let v = glass;
        if (night > 0 && hash01(c + 6, r + 2) < HEROES.nbLit) v = mix(v, lit, night * 0.74);
        ctx.fillStyle = css(v);
        ctx.fillRect(x, y, ww, wh);
        // the angled brick reveal — one texel, on one side, catching light
        ctx.fillStyle = css(mix(brick, [255, 255, 255], 0.16));
        ctx.fillRect(x - 1, y, 1, wh);
      }
    }
    return grab(ctx);
  }

  function glassTileOf(dayHex, litHex) {
    return function (p) {
      const ctx = ctx2d();
      const glass = rampOf(dayHex, p);
      const frame = rampOf('#cfd4d6', p);
      const lit = hexToRgb(litHex);
      const night = nightAt(p);
      ctx.fillStyle = css(frame);
      ctx.fillRect(0, 0, T, T);
      const R = HEROES.glassRows, C = HEROES.glassCols, M = HEROES.glassMullion;
      const sx = T / C, sy = T / R;
      for (let r = 0; r < R; r++) {
        for (let c = 0; c < C; c++) {
          let v = mix(glass, [255, 255, 255], 0.05 * hash01(r + 2, c + 5));
          if (night > 0 && hash01(c + 11, r + 4) < HEROES.glassLit) v = mix(v, lit, night * 0.62);
          ctx.fillStyle = css(v);
          ctx.fillRect(Math.round(c * sx) + M, Math.round(r * sy) + M,
                       Math.round(sx) - M, Math.round(sy) - M);
        }
      }
      return grab(ctx);
    };
  }

  /** EER's space frame: X-braced steel over the atrium's glass. */
  function latticeTile(p) {
    const ctx = ctx2d();
    const glass = rampOf('#4d81ad', p);
    const steel = rampOf('#4b4f53', p);
    const lit = hexToRgb('#e8d3a0');
    const night = nightAt(p);
    const B = HEROES.cageBays, M = HEROES.cageMember, step = T / B;

    ctx.fillStyle = css(glass);
    ctx.fillRect(0, 0, T, T);
    if (night > 0) {
      for (let r = 0; r < B; r++) {
        for (let c = 0; c < B; c++) {
          if (hash01(r + 8, c + 1) > HEROES.cageGlassLit) continue;
          ctx.fillStyle = css(mix(glass, lit, night * 0.66));
          ctx.fillRect(Math.round(c * step), Math.round(r * step),
                       Math.round(step), Math.round(step));
        }
      }
    }
    ctx.strokeStyle = css(steel);
    ctx.lineWidth = M;
    ctx.beginPath();
    for (let i = 0; i <= B; i++) {
      const t = Math.round(i * step);
      ctx.moveTo(0, t + 0.5); ctx.lineTo(T, t + 0.5);
      ctx.moveTo(t + 0.5, 0); ctx.lineTo(t + 0.5, T);
    }
    for (let r = 0; r < B; r++) {
      for (let c = 0; c < B; c++) {
        const x = c * step, y = r * step;
        ctx.moveTo(x, y); ctx.lineTo(x + step, y + step);
        ctx.moveTo(x + step, y); ctx.lineTo(x, y + step);
      }
    }
    ctx.stroke();
    return grab(ctx);
  }

  const TILES = {
    [IMG.lime]: limeTile,
    [IMG.brick]: brickTile,
    [IMG.nbrick]: nbrickTile,
    [IMG.glass]: glassTileOf('#4f86b4', '#efd49c'),
    [IMG.glassb]: glassTileOf('#2f5c94', '#eadfae'),
    [IMG.lattice]: latticeTile,
  };

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

  /**
   * Teach the flight controls that these three are 8-18 m taller than the
   * snapshot says.
   *
   * js/controls.js rasterises its collision grid from `scene.buildings`
   * (final_height) and `scene.parts` (h) ONCE at init, and this pass never edits
   * the snapshot — so without this you fly through the top 17.8 m of EER, which
   * is precisely the defect docs/PASS_WESTCAMPUS.md refused to ship on The
   * Standard. `__flyRebuildCollision` takes any scene-shaped object and stamps a
   * MAX per cell, so handing it the real buildings plus these volumes as
   * parts-shaped features raises exactly the cells under them and nothing else.
   */
  function extendCollision(map, gj) {
    if (typeof window.__flyRebuildCollision !== 'function') return 'no collision api';
    const pick = id => {
      const s = map.getSource(id);
      if (!s) return null;
      // In this MapLibre build `_data` is sometimes a wrapper WITHOUT `.features`
      // — the same measurement js/night.js records. Take whichever candidate
      // actually carries geometry.
      return [s._data, s.serialize && s.serialize().data]
        .find(d => d && typeof d !== 'string' && d.features && d.features.length) || null;
    };
    const buildings = pick('austin-buildings');
    if (!buildings) return 'no buildings source';
    const parts = pick('austin-parts');
    const extra = gj.features.map(f => ({
      type: 'Feature', geometry: f.geometry, properties: { h: f.properties.h },
    }));
    window.__flyRebuildCollision({
      buildings,
      parts: { type: 'FeatureCollection', features: ((parts && parts.features) || []).concat(extra) },
    });
    return 'rebuilt with ' + extra.length + ' hero volumes';
  }

  let _added = false;

  window.initHeroes = async function initHeroes(map) {
    if (!HEROES.on || _added || map.getSource(SRC)) return;
    _added = true;

    let gj;
    try {
      gj = await getJSON(DATA);
    } catch (e) {
      console.warn('[heroes]', e.message, '- buildings left as baked');
      return;
    }

    const p = (window.__todCurrentP != null) ? window.__todCurrentP : 0.3;
    // Every image must exist BEFORE any layer references it, or MapLibre logs
    // "image not found" and paints those walls transparent.
    ensureImages(map, p);

    map.addSource(SRC, { type: 'geojson', data: gj, ...(window.PATTERN_TILING || {}) });

    // The generic extrusions these bands supersede have to STOP being drawn, or
    // the old 22.7 m box sits inside the new 40.5 m one and its roof cap cuts a
    // bright line across the wall. Same mechanism js/arts.js and js/app.js use.
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
    // first in the style — the basemap puts symbol layers immediately after
    // `background`, and anchoring there drops the whole pass under the ground.
    const stack = map.getStyle().layers;
    const after = Math.max(0, stack.findIndex(l => l.id === 'buildings-3d'));
    const anchor = (stack.slice(after + 1).find(l => l.type === 'symbol') || {}).id;

    const geom = { 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-base': ['get', 'base'] };
    const add = (id, lyr, paint) => map.addLayer({
      id, type: 'fill-extrusion', source: SRC, minzoom: HEROES.minZoom,
      filter: ['==', ['get', 'lyr'], lyr],
      paint: Object.assign({}, geom, paint, {
        'fill-extrusion-opacity': 1.0,
        // OFF everywhere in this pass. The gradient darkens the bottom of EACH
        // extrusion and these are stacks of two to four, so it draws a dark seam
        // at every band boundary — on GDC that is a black line right under the
        // roof plane, which is the one edge the building is known for.
        'fill-extrusion-vertical-gradient': false,
      }),
    }, anchor);

    add(L.solid, 'solid', { 'fill-extrusion-color': wallColor(p) });
    add(L.lime, 'lime', { 'fill-extrusion-pattern': IMG.lime });
    add(L.brick, 'brick', { 'fill-extrusion-pattern': IMG.brick });
    add(L.nbrick, 'nbrick', { 'fill-extrusion-pattern': IMG.nbrick });
    add(L.glass, 'glass', { 'fill-extrusion-pattern': IMG.glass });
    add(L.glassb, 'glassb', { 'fill-extrusion-pattern': IMG.glassb });
    add(L.lattice, 'lattice', { 'fill-extrusion-pattern': IMG.lattice });

    // The parapet lip, following app.js's shared CAP_GEOM rule so this pass
    // cannot drift from every other roof in the scene. Only the topmost band of
    // each building carries cap=1.
    const G = window.CAP_GEOM;
    if (G) {
      map.addLayer({
        id: L.cap, type: 'fill-extrusion', source: SRC, minzoom: HEROES.minZoom,
        filter: ['==', ['get', 'cap'], 1],
        paint: {
          'fill-extrusion-color': capColor(p),
          'fill-extrusion-height': G.height(['get', 'h']),
          'fill-extrusion-base': G.base(['get', 'h']),
          'fill-extrusion-opacity': 1.0,
        },
      }, anchor);
    }

    const col = extendCollision(map, gj);
    window.__heroes = { features: gj.features.length, replaced: gone.length,
                        heights: gj.heroHeights || {}, collision: col };
    console.log('[heroes]', gj.features.length, 'band features over', gone.length,
                'replaced buildings; collision', col);
  };

  // js/timeofday.js quantises p to 1/128 and skips its expensive path between
  // ticks. A module that wraps applyTimeOfDay does NOT inherit that decision, so
  // the same quantisation is repeated here — six 64 px canvases redrawn and
  // re-uploaded at 60 fps would be 360 texture uploads a second for a colour
  // change nobody can see.
  let _lastPq = null;
  const PQ = 128;

  window.applyHeroColors = function applyHeroColors(map, p, force) {
    if (!HEROES.on || !map || !map.getLayer) return;
    const pq = Math.round(Math.max(0, Math.min(1, p)) * PQ) / PQ;
    if (force !== true && _lastPq !== null && pq === _lastPq) return;
    _lastPq = pq;
    try {
      if (map.getLayer(L.solid)) map.setPaintProperty(L.solid, 'fill-extrusion-color', wallColor(p));
    } catch (e) {}
    try {
      if (map.getLayer(L.cap)) map.setPaintProperty(L.cap, 'fill-extrusion-color', capColor(p));
    } catch (e) {}
    // The five patterned surfaces are IMAGES, not paint properties, so they need
    // RE-DRAWING rather than re-expressing. A building that only looks right at
    // noon is not done. This is also where the lattice's glass and both curtain
    // walls come on after dusk.
    ensureImages(map, p);
  };

  // ── bootstrap ─────────────────────────────────────────────────────
  // Copied from the boot() at the bottom of js/arts.js.
  function boot() {
    const map = window.__map;
    if (!map) return setTimeout(boot, 60);

    const hookTod = () => {
      if (typeof window.applyTimeOfDay !== 'function' || window.applyTimeOfDay.__heroes) return;
      const prev = window.applyTimeOfDay;
      const wrapped = function (m, p, force) {
        const r = prev.apply(this, arguments);
        try { window.applyHeroColors(m, p, force); } catch (e) {}
        return r;
      };
      wrapped.__heroes = true;
      window.applyTimeOfDay = wrapped;
    };

    const go = () => {
      // Wait for the core buildings AND for facades.js — the state in which
      // addImage is safe — and for the collision field to have been built once,
      // so the rebuild below replaces a real grid rather than racing it.
      if (!map.getLayer('buildings-3d') || typeof window.initFacades !== 'function') {
        return setTimeout(go, 120);
      }
      hookTod();
      window.initHeroes(map);
    };
    if (map.isStyleLoaded && map.isStyleLoaded()) go();
    else map.once('load', () => setTimeout(go, 0));
  }
  boot();
})();
