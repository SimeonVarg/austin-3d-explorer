/**
 * ground.js — the ground plane, made of what is actually there.
 *
 * Before this, everything below the buildings was two flat colours: one green
 * for "park", one tan for "ground". A city read as extrusions pushed up out of
 * a blank sheet — and worse, every footpath in the basemap was deliberately
 * hidden by cleanupBasemap (it keeps only major roads), so the paths people
 * actually walk were switched off. On campus that is most of the ground.
 *
 * This draws data/ground.geojson: real OSM paths, plazas, lawns, water,
 * pitches, tracks and parking, differentiated by what each surface IS.
 *
 * TRUTH: every POSITION comes from OSM (see scripts/bake_ground.py). What is
 * generative is FORM — the drawn width of a path OSM does not measure, and the
 * colour chosen for a named surface. No feature here is decorative.
 *
 * Public (window) API:
 *   initGround(map)              — add the source + layers under the buildings
 *   applyGroundColors(map, p)    — retint every surface for time-of-day p
 *   GROUND                       — the taste block (below)
 */
(function () {
  'use strict';

  // ── Taste block. Every value here is a one-line override. ───────────
  const GROUND = {
    on: true,
    pathOpacity: 0.92,      // paths are the strongest read; keep them confident
    areaOpacity: 0.95,
    minZoom: 13.5,          // below this the ground is too far to earn the fill
    pathFadeZoom: [14.2, 15.4],   // paths fade in across this zoom range
    widthScale: 1.0,        // multiply every path width (form, not fact)
    kerbLight: 0.10,        // how much the path edge lightens (fake bevel)
  };
  window.GROUND = GROUND;

  const SRC = 'austin-ground';
  const AREA = 'ground-areas', PATH_CASE = 'ground-paths-casing', PATH = 'ground-paths';

  // ── Surface palettes, per hour ──────────────────────────────────────
  // Chosen against the protected palette: terracotta roofs over tan/olive
  // walls. So ground brick is browner and darker than any roof, and limestone
  // stays cooler than the wall tan — the buildings must still win the frame.
  const SURF = {
    // Paths must sit LIGHT on the mid-grey `ground` in timeofday.js and dark
    // where they are asphalt. Target ≥40 luma of separation from the ground —
    // the first attempt had 3.5 and the whole path network was invisible even
    // though it was rendering correctly (proved with a magenta pass).
    day: {
      limestone:'#efe6cf', concrete:'#dfd9cb', paving:'#e6ddc9', brick:'#9a6249',
      asphalt:'#6e6960', gravel:'#c9bfa9', dirt:'#a28b6c', sand:'#e2d2ab',
      grass:'#8fa869', turf:'#7d9c5e', wood:'#5d7a48', water:'#8fbccd',
      track:'#a8503c',
    },
    golden: {
      limestone:'#f4e0b8', concrete:'#e3cba6', paving:'#ecd6ac', brick:'#8f5439',
      asphalt:'#6b5c4c', gravel:'#cdb28d', dirt:'#a37f5b', sand:'#e7cb9c',
      grass:'#8a9457', turf:'#7a8b4e', wood:'#5a6a3c', water:'#c9a184',
      track:'#a5482f',
    },
    night: {
      limestone:'#1b1e28', concrete:'#181b24', paving:'#1a1d26',
      brick:'#1d1720', asphalt:'#12141b', gravel:'#1b1a22', dirt:'#191620',
      sand:'#201d26', grass:'#111a14', turf:'#0f1712', wood:'#0c130f',
      water:'#070f1e', track:'#1d1418',
    },
  };
  const KEYS = Object.keys(SURF.day);

  // ── colour helpers (same convention as timeofday.js) ────────────────
  const hex2rgb = h => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];
  const rgb2hex = (r,g,b) => '#' + [r,g,b].map(v =>
    Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join('');
  function lerpHex(a, b, t) {
    const A = hex2rgb(a), B = hex2rgb(b);
    return rgb2hex(A[0]+(B[0]-A[0])*t, A[1]+(B[1]-A[1])*t, A[2]+(B[2]-A[2])*t);
  }
  const clamp01 = v => Math.max(0, Math.min(1, v));

  /** The palette at hour p, blended day→golden→night like every other colour. */
  function paletteAt(p) {
    p = clamp01(p);
    const a = p <= 0.5 ? SURF.day : SURF.golden;
    const b = p <= 0.5 ? SURF.golden : SURF.night;
    const t = p <= 0.5 ? p / 0.5 : (p - 0.5) / 0.5;
    const out = {};
    for (const k of KEYS) out[k] = lerpHex(a[k], b[k], t);
    return out;
  }

  /** ['match', ['get','s'], 'grass', '#..', …, fallback] */
  function matchExpr(pal, tweak) {
    const e = ['match', ['get', 's']];
    for (const k of KEYS) e.push(k, tweak ? tweak(pal[k]) : pal[k]);
    e.push(pal.concrete);
    return e;
  }

  /** Lighten a hex by t toward white — used for the path kerb highlight. */
  function lighten(h, t) {
    const c = hex2rgb(h);
    return rgb2hex(c[0]+(255-c[0])*t, c[1]+(255-c[1])*t, c[2]+(255-c[2])*t);
  }

  // Path width: OSM metres → screen px. MapLibre uses 512 px tiles, so one
  // pixel is 78271.517·cos(lat)/2^zoom metres; at Austin's latitude that is
  // 67546/2^zoom. Width in px is therefore w·2^zoom/67546, which is exactly a
  // base-2 exponential in zoom — so two stops describe it perfectly.
  const PX_AT = z => Math.pow(2, z) / 67546;
  function widthExpr(scale) {
    return ['interpolate', ['exponential', 2], ['zoom'],
      14, ['*', ['get', 'w'], PX_AT(14) * scale],
      21, ['*', ['get', 'w'], PX_AT(21) * scale]];
  }

  window.initGround = function initGround(map) {
    if (!GROUND.on || map.getSource(SRC)) return;
    map.addSource(SRC, { type: 'geojson', data: 'data/ground.geojson' });

    // Under everything of ours: the buildings' contact shadows and extrusions
    // must sit ON the ground, not under it.
    const under = ['buildings-shadow', 'buildings-ao', 'buildings-3d']
      .find(id => map.getLayer(id));

    const pal = paletteAt(window.__todCurrentP != null ? window.__todCurrentP : 0.5);

    if (!map.getLayer(AREA)) {
      map.addLayer({
        id: AREA, type: 'fill', source: SRC, minzoom: GROUND.minZoom,
        filter: ['==', ['get', 'k'], 'area'],
        paint: {
          'fill-color': matchExpr(pal),
          'fill-opacity': GROUND.areaOpacity,
          'fill-antialias': true,
        },
      }, under);
    }

    // A slightly wider, lighter line under each path reads as the kerb/edge
    // catching light — the cheapest thing that stops a path looking like a
    // sticker laid on the grass.
    if (!map.getLayer(PATH_CASE)) {
      map.addLayer({
        id: PATH_CASE, type: 'line', source: SRC, minzoom: GROUND.minZoom,
        filter: ['==', ['get', 'k'], 'path'],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': matchExpr(pal, c => lighten(c, GROUND.kerbLight)),
          'line-width': widthExpr(GROUND.widthScale * 1.34),
          'line-opacity': ['interpolate', ['linear'], ['zoom'],
            GROUND.pathFadeZoom[0], 0, GROUND.pathFadeZoom[1], GROUND.pathOpacity * 0.8],
        },
      }, under);
    }

    if (!map.getLayer(PATH)) {
      map.addLayer({
        id: PATH, type: 'line', source: SRC, minzoom: GROUND.minZoom,
        filter: ['==', ['get', 'k'], 'path'],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': matchExpr(pal),
          'line-width': widthExpr(GROUND.widthScale),
          'line-opacity': ['interpolate', ['linear'], ['zoom'],
            GROUND.pathFadeZoom[0], 0, GROUND.pathFadeZoom[1], GROUND.pathOpacity],
        },
      }, under);
    }
  };

  window.applyGroundColors = function applyGroundColors(map, p) {
    if (!map || !map.getLayer || !map.getLayer(AREA)) return;
    const pal = paletteAt(p);
    const set = (id, prop, val) => { try { map.setPaintProperty(id, prop, val); } catch (e) {} };
    set(AREA, 'fill-color', matchExpr(pal));
    set(PATH, 'line-color', matchExpr(pal));
    set(PATH_CASE, 'line-color', matchExpr(pal, c => lighten(c, GROUND.kerbLight)));
  };

  /** Re-read GROUND after a live edit (widths, opacity, scale). */
  window.applyGroundSettings = function applyGroundSettings(map) {
    if (!map.getLayer(PATH)) return;
    const set = (id, prop, val) => { try { map.setPaintProperty(id, prop, val); } catch (e) {} };
    set(PATH, 'line-width', widthExpr(GROUND.widthScale));
    set(PATH_CASE, 'line-width', widthExpr(GROUND.widthScale * 1.34));
    set(AREA, 'fill-opacity', GROUND.areaOpacity);
    const vis = GROUND.on ? 'visible' : 'none';
    for (const id of [AREA, PATH, PATH_CASE]) {
      try { map.setLayoutProperty(id, 'visibility', vis); } catch (e) {}
    }
  };
})();
