/**
 * tower.js — the UT Tower and the Main Building it rises from.
 *
 * WHAT WAS THERE. The Overture feature named "UT Tower" is the whole Main
 * Building complex — a 25-vertex footprint 79.5 x 87.2 m — and it carries
 * `has_parts: 1`, so js/app.js filters it out of `buildings-3d` entirely. What
 * actually rendered was two OSM building:parts: the 94 m shaft as a single
 * prism wearing the generic office-tower window grid, and one 12.8 m block.
 * The Main Building had no wings, no arcade and no red tile roof, and nothing
 * in roofscape.geojson or roofs.geojson falls inside the footprint either. The
 * icon of the campus was a grey box.
 *
 * WHY IT IS GEOMETRY AND NOT A TEXTURE. Two measured properties of
 * fill-extrusion-pattern decide almost every choice in this file and in
 * scripts/bake_tower.py:
 *
 *   1. A pattern has NO VERTICAL ANCHOR. It repeats from the extrusion base
 *      with no idea where the top is, so a cornice drawn "at the top" appears
 *      every ~40 m up the shaft. The Tower is nothing BUT vertical events, so
 *      it is emitted as stacked bands, each its own feature — the same shape as
 *      the BANDS list in scripts/bake_stadium.py.
 *   2. A pattern is TILE-locked. A 64 px repeat covers ~30 m of wall at tile
 *      zoom 17 and ~59 m at 16, and it never aligns to a building corner. The
 *      Tower's shaft has exactly THREE window slots on a 22.56 m face; no tile
 *      can say "three". So the slots are prisms standing 0.30 m proud of each
 *      face, and so are the belfry colonnade, the four clock faces, and the
 *      windows that light the numeral at night.
 *
 * That leaves the tiles doing the one job a tile is good at: material. Every
 * pattern here varies only in x — vertical strips and per-block value scatter,
 * constant down the tile — which is the trick that makes an unanchored,
 * unaligned repeat harmless. It is the same reason js/facades.js draws its
 * weathering as full-height columns.
 *
 * NIGHT. The convention is sourced (tower.utexas.edu/lighting): seven
 * configurations, of which this builds "Orange Tower with No. 1", the
 * national-championship state. The tower floods orange, the Main Building stays
 * dark, the clock dials stay cream, and the shaft's three window columns light
 * a numeral 1 — centre column full height, all three across the bottom, two
 * cells in the left column near the top. That is what a photograph of the real
 * thing shows, and three window columns is exactly enough to write a 1.
 *
 * Reference table, sources and the honest sourced/generative split:
 * docs/PASS_TOWER.md.
 *
 * Public (window) API:
 *   initTower(map)            — add source + layers (called automatically)
 *   applyTowerColors(map, p)  — retint for time-of-day p (hooked automatically)
 *   TOWER                     — the taste block
 */
(function () {
  'use strict';

  const q = new URLSearchParams(window.location.search);

  const TOWER = {
    // ?tower=0 removes the whole pass at load, so scripts/verify/tower-perf.mjs
    // can A/B on one build instead of on two checkouts.
    on: q.get('tower') !== '0',
    minZoom: 14,
    // The window slots, the belfry columns and the clock slabs are 1-1.5 m
    // features. At the altitude this app flies one pixel is roughly half a
    // metre, so they are 2-3 px and worth drawing; below this zoom they are
    // sub-pixel and are pure overdraw.
    detailMinZoom: 14.6,
    opacity: 1.0,
  };
  window.TOWER = TOWER;

  const SRC = 'austin-tower';
  const L_WALL = 'tower-wall';     // banded walls, on our own pattern atlas
  const L_SOLID = 'tower-solid';   // roof facets and everything flat-coloured
  const L_DETAIL = 'tower-detail'; // slots, windows, columns, clock
  const LAYERS = [L_WALL, L_SOLID, L_DETAIL];
  const DATA = 'data/tower.geojson';
  const TILE = 64;

  const HAS_PAT = ['has', 'pat'];
  const NO_PAT = ['!', HAS_PAT];
  const DETAIL_KINDS = ['slot', 'win', 'post', 'clock'];
  const IS_DETAIL = ['in', ['get', 'kind'], ['literal', DETAIL_KINDS]];
  const NOT_DETAIL = ['!', IS_DETAIL];

  /**
   * How each pattern family is drawn. `strip` is the ONLY structure any of them
   * carries and it is deliberately x-only: pitch and width in tile pixels, plus
   * how far the strip is mixed toward black. A 64 px tile covers 30-59 m at the
   * zooms this app flies, so ~7 px is a 3.5-7 m bay — which is the real bay on
   * this building at the middle of that range, and errs to "fine texture" when
   * you fly close, the correct failure direction.
   *
   *   twshaft  Indiana limestone, blank. The shaft's only openings are the
   *            three geometry slots, so this must NOT draw windows.
   *   twplain  the same stone, brighter: cornice, balustrade, crown.
   *   twwall   Main Building piano nobile — tall punched windows on a 4.3 m bay
   *   twbase   the rusticated arcade storey: wide, deep, dark openings
   *   twattic  the attic loggia: openings on a red-brown ground
   *   twvoid   the bell chamber behind the colonnade
   */
  const FAM = {
    twshaft: { strip: null,                   mottle: 0.055, streaks: 5 },
    twplain: { strip: null,                   mottle: 0.045, streaks: 3 },
    twwall:  { strip: [7, 2, 0.42],           mottle: 0.060, streaks: 5 },
    twbase:  { strip: [10, 4, 0.50],          mottle: 0.070, streaks: 4 },
    twattic: { strip: [7, 3, 0.46],           mottle: 0.050, streaks: 2 },
    twvoid:  { strip: null,                   mottle: 0.030, streaks: 0 },
  };

  // ── colour helpers, matching the ramp the rest of the scene uses ────
  const hx = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const css = (c, a) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a == null ? 1 : a})`;

  function rampAt(trio, p) {
    p = Math.max(0, Math.min(1, p));
    return p <= 0.5 ? mix(hx(trio[0]), hx(trio[1]), p / 0.5)
                    : mix(hx(trio[1]), hx(trio[2]), (p - 0.5) / 0.5);
  }

  /** ['interpolate', p, day, golden, night] — timeofday.js's own shape. */
  function bakedColor(p) {
    p = Math.max(0, Math.min(1, p));
    return ['interpolate', ['linear'], p,
      0, ['to-color', ['get', 'wd'], '#cbc0aa'],
      0.5, ['to-color', ['get', 'wg'], '#cbc0aa'],
      1, ['to-color', ['get', 'wn'], '#20222a'],
    ];
  }

  // Deterministic 0..1. Same generator js/facades.js uses, so a tile drawn here
  // cannot flicker between repaints the way Math.random would.
  function hash01(a, b, c) {
    let x = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
    x = (x ^ (x >> 13)) * 1274126177;
    return ((x ^ (x >> 16)) >>> 0) / 4294967295;
  }

  // ── the tile atlas ──────────────────────────────────────────────────
  let _canvas = null, _ctx = null;

  /**
   * One 64 px tile for (family, colour) at time-of-day p.
   *
   * The block-to-block value scatter is applied to the finished pixel buffer
   * rather than composited from a second canvas: drawImage INTO a
   * willReadFrequently context takes the CPU path and js/facades.js measured
   * that at 230 ms against 22 ms. This context has to be willReadFrequently
   * because it ends in getImageData.
   */
  function tileData(fam, trio, p, seed) {
    if (!_canvas) {
      _canvas = document.createElement('canvas');
      _canvas.width = _canvas.height = TILE;
      _ctx = _canvas.getContext('2d', { willReadFrequently: true });
    }
    const spec = FAM[fam] || FAM.twplain;
    const wall = rampAt(trio, p);
    // How far the sun is down. Walls follow the sun, not the hour — the same
    // split js/facades.js documents, and the reason the scene silhouettes
    // correctly through dusk instead of glowing against a darker sky.
    const sunElev = (typeof window.skyBodies === 'function') ? window.skyBodies(p).sun.elev : (0.5 - p) * 100;
    const dark = Math.max(0, Math.min(1, Math.max((p - 0.55) / 0.45, -sunElev / 9)));

    const ctx = _ctx;
    ctx.clearRect(0, 0, TILE, TILE);
    ctx.fillStyle = css(wall);
    ctx.fillRect(0, 0, TILE, TILE);

    // Weathering: aperiodic in x, CONSTANT in y. Tiles in both axes, needs no
    // anchor, and cannot moire against the strips.
    for (let s = 0; s < spec.streaks; s++) {
      const x = Math.round(hash01(seed + 5623, s, 0) * TILE);
      const w = 2 + Math.round(hash01(seed + 5641, s, 0) * 2);
      ctx.fillStyle = css(mix(wall, [0, 0, 0], 0.07), 0.20 * (1 - dark * 0.7));
      for (const xx of [x, x - TILE]) if (xx + w > 0) ctx.fillRect(xx, 0, w, TILE);
    }

    if (spec.strip) {
      const [pitch, w, depth] = spec.strip;
      // Openings go dark, and the pier beside each one takes a lit edge. Both
      // fade as the sun goes down: a pale grid over every wall after dark is
      // what turns a city into graph paper.
      const op = css(mix(wall, [0, 0, 0], depth * (1 - dark * 0.35)));
      const lit = css(mix(wall, [255, 255, 255], 0.10 * (1 - dark * 0.85)));
      for (let x = 0; x < TILE; x += pitch) {
        ctx.fillStyle = lit; ctx.fillRect(x, 0, 1, TILE);
        ctx.fillStyle = op;  ctx.fillRect(x + 1, 0, w, TILE);
      }
    }

    const img = ctx.getImageData(0, 0, TILE, TILE);
    const d = img.data;
    const amp = spec.mottle * (1 - dark * 0.6);
    if (amp > 0.001) {
      // 4 px cells => ~2-4 m, one ashlar block face. The photographs of this
      // building show strong block-to-block value scatter and nothing finer:
      // a real ashlar course is 0.2-0.3 m, which is well under one texel, and
      // drawing it anyway would assert half-metre coursing on a limestone hall.
      const N = TILE / 4;
      for (let y = 0; y < TILE; y++) {
        const row = ((y / 4) | 0) * N;
        for (let x = 0; x < TILE; x++) {
          const t = hash01(seed + 5501, (x / 4) | 0, row / N) * 2 - 1;
          if (!t) continue;
          const k = amp * Math.abs(t), tgt = t < 0 ? 0 : 255, i = (y * TILE + x) * 4;
          d[i] += (tgt - d[i]) * k;
          d[i + 1] += (tgt - d[i + 1]) * k;
          d[i + 2] += (tgt - d[i + 2]) * k;
        }
      }
    }
    return { width: TILE, height: TILE, data: new Uint8Array(d.buffer.slice(0)) };
  }

  // pattern id -> { fam, trio, seed }. Built from the BAKE's own colours, so the
  // hexes live in exactly one place (scripts/bake_tower.py) and the two halves
  // cannot drift apart.
  //
  // `pat` and `fam` are DIFFERENT properties and the difference matters: `fam`
  // is how the tile is drawn, `pat` is which image the feature asks for. Seven
  // bands share the plain-ashlar family and four different palettes, so the
  // bake allocates `twplain`, `twplain2`, `twplain3`… — one image per
  // (family, colour). Keying the image off the family alone made every crown
  // band inherit whichever palette happened to be emitted first, which by day
  // was invisible and at night left the top 28 m of the Tower unlit.
  let _pats = null;

  function collectPatterns(gj) {
    const pats = {};
    let seed = 11;
    for (const f of gj.features) {
      const p = f.properties;
      if (!p || !p.pat || pats[p.pat]) continue;
      pats[p.pat] = { fam: p.fam || p.pat, trio: [p.wd, p.wg, p.wn], seed: seed += 7 };
    }
    return pats;
  }

  function registerPatterns(map, p) {
    if (!_pats) return 0;
    let n = 0;
    for (const id of Object.keys(_pats)) {
      const s = _pats[id];
      try {
        if (map.hasImage && map.hasImage(id)) continue;
        map.addImage(id, tileData(s.fam, s.trio, p, s.seed));
        n++;
      } catch (e) { /* already added */ }
    }
    return n;
  }

  function repaintPatterns(map, p) {
    if (!_pats) return;
    for (const id of Object.keys(_pats)) {
      const s = _pats[id];
      try {
        if (map.hasImage && map.hasImage(id)) map.updateImage(id, tileData(s.fam, s.trio, p, s.seed));
        else map.addImage(id, tileData(s.fam, s.trio, p, s.seed));
      } catch (e) { /* not registered yet */ }
    }
  }

  // ── stop the generic geometry drawing underneath ────────────────────
  /**
   * Two different exclusions, because this building is drawn two different ways.
   *
   * The FOOTPRINT is excluded by id, the way data/stadium.geojson does it. That
   * is belt and braces today — the feature carries has_parts, so app.js's
   * NO_PARTS filter already drops it — but a future bake that stops emitting
   * building:parts would otherwise put a 94 m grey box back inside all of this.
   *
   * The two OSM building:parts have to go too, and they used to be the awkward
   * half: parts.detailed.geojson carried {h, base, wd, wg, wn, rd, rg, rn} and
   * NO id, so they were matched on wall colour — unique to this building across
   * every snapshot on disk, which was true and was still a time bomb. The moment
   * a building is recoloured, an authored pass starts drawing on top of a raw
   * OSM prism it can no longer see.
   *
   * scripts/bake_detail.py now emits `pid`, the parent building's id, so a part
   * is filtered exactly the way its building is: by the SAME replacedBuildingIds
   * list. The colour match is kept only as a fallback for an older snapshot
   * loaded through the date switcher, which will not carry `pid`.
   */
  function hideOriginals(map, gj) {
    const ids = gj.replacedBuildingIds || [];
    if (ids.length) {
      const keep = ['!', ['in', ['get', 'id'], ['literal', ids]]];
      for (const id of ['buildings-3d', 'buildings-roof']) {
        if (!map.getLayer(id)) continue;
        const f = map.getFilter(id);
        try { map.setFilter(id, f ? ['all', f, keep] : keep); } catch (e) {}
      }
    }
    const wd = gj.replacedPartWallColour;
    const partKeep = [];
    if (ids.length) partKeep.push(['!', ['in', ['get', 'pid'], ['literal', ids]]]);
    if (wd) partKeep.push(['!=', ['get', 'wd'], wd]);
    if (partKeep.length) {
      const keep = partKeep.length > 1 ? ['all'].concat(partKeep) : partKeep[0];
      for (const id of ['parts-3d', 'parts-roof']) {
        if (!map.getLayer(id)) continue;
        const f = map.getFilter(id);
        try { map.setFilter(id, f ? ['all', f, keep] : keep); } catch (e) {}
      }
    }
  }

  async function getJSON(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(url + ': ' + r.status);
    return await r.json();
  }

  let _added = false;

  window.initTower = async function initTower(map) {
    if (!TOWER.on || _added || map.getSource(SRC)) return;
    _added = true;

    let gj;
    try {
      gj = await getJSON(DATA);
    } catch (e) {
      console.warn('[tower]', e.message, '- tower not drawn');
      return;
    }

    const p = (window.__todCurrentP != null) ? window.__todCurrentP : 0.3;
    _pats = collectPatterns(gj);
    // Register BEFORE addLayer: a fill-extrusion asking for an image MapLibre
    // does not have is painted transparent, not defaulted.
    const nImg = registerPatterns(map, p);

    map.addSource(SRC, { type: 'geojson', data: gj, ...(window.PATTERN_TILING || {}) });
    hideOriginals(map, gj);

    // The anchor must be the first symbol layer AFTER our buildings. The
    // basemap puts its symbol layers immediately after `background`, so
    // anchoring at the first symbol layer in the style drops everything to the
    // BOTTOM of the stack, under the ground fill — which is how the stadium
    // once rendered underneath `ground-areas`. Same loop, same reason.
    const stack = map.getStyle().layers;
    const after = Math.max(0, stack.findIndex(l => l.id === 'buildings-3d'));
    const anchor = (stack.slice(after + 1).find(l => l.type === 'symbol') || {}).id;

    if (!map.getLayer(L_WALL)) {
      map.addLayer({
        id: L_WALL, type: 'fill-extrusion', source: SRC, minzoom: TOWER.minZoom,
        filter: ['all', HAS_PAT, NOT_DETAIL],
        paint: {
          'fill-extrusion-pattern': ['get', 'pat'],
          'fill-extrusion-height': ['get', 'h'],
          'fill-extrusion-base': ['get', 'base'],
          'fill-extrusion-opacity': TOWER.opacity,
          // OFF. The gradient darkens the bottom of every extrusion and these
          // are nine stacked bands, so it would draw a dark seam at each of the
          // eight boundaries — and the 1.0 m belfry plinth would fall entirely
          // inside its own gradient and render black. The band tones already
          // carry the vertical hierarchy.
          'fill-extrusion-vertical-gradient': false,
        },
      }, anchor);
    }
    if (!map.getLayer(L_SOLID)) {
      map.addLayer({
        id: L_SOLID, type: 'fill-extrusion', source: SRC, minzoom: TOWER.minZoom,
        filter: ['all', NO_PAT, NOT_DETAIL],
        paint: {
          'fill-extrusion-color': bakedColor(p),
          'fill-extrusion-height': ['get', 'h'],
          'fill-extrusion-base': ['get', 'base'],
          'fill-extrusion-opacity': 1.0,
          // Also off: the roof facets are 1.5 m steps, and a gradient over
          // 1.5 m is a black line under every tread.
          'fill-extrusion-vertical-gradient': false,
        },
      }, anchor);
    }
    if (!map.getLayer(L_DETAIL)) {
      map.addLayer({
        id: L_DETAIL, type: 'fill-extrusion', source: SRC, minzoom: TOWER.detailMinZoom,
        filter: IS_DETAIL,
        paint: {
          'fill-extrusion-color': bakedColor(p),
          'fill-extrusion-height': ['get', 'h'],
          'fill-extrusion-base': ['get', 'base'],
          'fill-extrusion-opacity': 1.0,
          'fill-extrusion-vertical-gradient': false,
        },
      }, anchor);
    }

    // Exposed for scripts/verify/tower-*.mjs, which must not carry its own copy
    // of the image list — the bake allocates one per (family, palette) and that
    // set grows whenever a band gets its own colour.
    window.__towerPats = Object.keys(_pats);
    console.log('[tower]', gj.features.length, 'features,', nImg, 'pattern images,',
                'replacing', (gj.replacedBuildingIds || []).length, 'building +',
                '2 OSM parts');
  };

  window.applyTowerColors = function applyTowerColors(map, p) {
    if (!map || !map.getLayer) return;
    const col = bakedColor(p);
    for (const id of [L_SOLID, L_DETAIL]) {
      try { if (map.getLayer(id)) map.setPaintProperty(id, 'fill-extrusion-color', col); } catch (e) {}
    }
    repaintPatterns(map, p);
  };

  /** Visibility switch, so scripts/verify/tower-perf.mjs can A/B in one build. */
  window.setTowerVisible = function setTowerVisible(on) {
    const map = window.__map;
    if (!map) return;
    for (const id of LAYERS) {
      try {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
      } catch (e) {}
    }
  };

  // ── bootstrap ───────────────────────────────────────────────────────
  // js/app.js is owned by another pass, so rather than ask for a call inside
  // buildScene() this waits for the map and for the layers it has to insert
  // itself above and filter, then runs. Copied from the boot() at the bottom of
  // js/outer.js. It also wraps applyTimeOfDay here, after every module has
  // loaded, so script order cannot break the hook.
  function boot() {
    const map = window.__map;
    if (!map) return setTimeout(boot, 60);

    const hookTod = () => {
      if (typeof window.applyTimeOfDay !== 'function' || window.applyTimeOfDay.__tower) return;
      const prev = window.applyTimeOfDay;
      const wrapped = function (m, p, force) {
        const r = prev.apply(this, arguments);
        try { window.applyTowerColors(m, p); } catch (e) {}
        return r;
      };
      wrapped.__tower = true;
      window.applyTimeOfDay = wrapped;
    };

    let tries = 0;
    const go = () => {
      // parts-3d as well as buildings-3d: this building renders through the
      // PARTS layer today, and hideOriginals() has to be able to filter it. If
      // it is somehow never added, give up waiting after ~30 s and draw anyway
      // rather than leaving the tower undrawn.
      const ready = map.getLayer('buildings-3d') && (map.getLayer('parts-3d') || ++tries > 250);
      if (!ready) return setTimeout(go, 120);
      hookTod();
      window.initTower(map);
    };
    if (map.isStyleLoaded && map.isStyleLoaded()) go();
    else map.once('load', () => setTimeout(go, 0));
  }
  boot();
})();
