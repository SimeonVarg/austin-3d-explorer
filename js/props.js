/**
 * props.js — the small things that give a place scale and identity.
 *
 * Three things live here, all from data/props.geojson (see
 * scripts/bake_props.py):
 *
 *   art   UT's Landmarks collection — Clock Knot, Monochrome for Austin,
 *         Circle with Towers, The Torchbearers, Ellsworth Kelly's Austin…
 *         POSITION and NAME are factual, from OSM. The FORM IS NOT THE
 *         ARTWORK: we do not model di Suvero's steel or Rubins' aluminium
 *         boats. Each piece is a plinth-and-mass stand-in sized by its
 *         artwork_type; the NAME carries the identity, which is why the label
 *         matters more than the geometry here.
 *   furn  benches, lamps, bins, bike parking — the scale-givers. A bench is
 *         what tells you how big the building behind it is.
 *   cons  current construction sites (Mulva Hall, Villas on 24th…).
 *
 * All of it is small, so it is held back until you are low enough for it to be
 * information rather than noise.
 *
 * Public (window) API:
 *   initProps(map)             — add source + layers
 *   applyPropColors(map, p)    — retint for time-of-day p
 *   PROPS                      — the taste block
 */
(function () {
  'use strict';

  const PROPS = {
    on: true,
    artMinZoom: 15.5,       // sculptures are 1–3 m wide; below this they are noise
    artLabelZoom: 16.6,     // the name is the payoff — but only when you're close
    furnMinZoom: 17.0,      // benches and bins earn their place lower still
    consMinZoom: 15.0,
    labelSize: [16.6, 10, 18.5, 13],   // zoom, px, zoom, px
  };
  window.PROPS = PROPS;

  const SRC = 'austin-props';
  const ART = 'props-art', FURN = 'props-furn', CONS = 'props-cons', ART_LBL = 'props-art-label';

  // Day / golden / night, blended the same way as every other palette.
  const COL = {
    art:  ['#8d8f96', '#8a7a6a', '#20222c'],   // weathered metal & stone
    furn: ['#6f6a62', '#6b5c4c', '#191b22'],
    cons: ['#c8a44a', '#c19040', '#2a2418'],   // site hoarding yellow
  };
  const hex2rgb = h => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];
  const rgb2hex = (r,g,b) => '#' + [r,g,b].map(v =>
    Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join('');
  function pick(triple, p) {
    const a = p <= 0.5 ? triple[0] : triple[1];
    const b = p <= 0.5 ? triple[1] : triple[2];
    const t = p <= 0.5 ? p / 0.5 : (p - 0.5) / 0.5;
    const A = hex2rgb(a), B = hex2rgb(b);
    return rgb2hex(A[0]+(B[0]-A[0])*t, A[1]+(B[1]-A[1])*t, A[2]+(B[2]-A[2])*t);
  }

  window.initProps = function initProps(map) {
    if (!PROPS.on || map.getSource(SRC)) return;
    map.addSource(SRC, { type: 'geojson', data: 'data/props.geojson' });
    const p = window.__todCurrentP != null ? window.__todCurrentP : 0.5;

    if (!map.getLayer(CONS)) {
      map.addLayer({
        id: CONS, type: 'fill-extrusion', source: SRC, minzoom: PROPS.consMinZoom,
        filter: ['==', ['get', 'k'], 'cons'],
        paint: { 'fill-extrusion-color': pick(COL.cons, p),
                 'fill-extrusion-height': ['get', 'h'],
                 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 0.9 },
      });
    }
    if (!map.getLayer(FURN)) {
      map.addLayer({
        id: FURN, type: 'fill-extrusion', source: SRC, minzoom: PROPS.furnMinZoom,
        filter: ['==', ['get', 'k'], 'furn'],
        paint: { 'fill-extrusion-color': pick(COL.furn, p),
                 'fill-extrusion-height': ['get', 'h'],
                 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 1 },
      });
    }
    if (!map.getLayer(ART)) {
      map.addLayer({
        id: ART, type: 'fill-extrusion', source: SRC, minzoom: PROPS.artMinZoom,
        filter: ['==', ['get', 'k'], 'art'],
        paint: { 'fill-extrusion-color': pick(COL.art, p),
                 'fill-extrusion-height': ['get', 'h'],
                 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 1,
                 'fill-extrusion-vertical-gradient': true },
      });
    }
    if (!map.getLayer(ART_LBL)) {
      map.addLayer({
        id: ART_LBL, type: 'symbol', source: SRC, minzoom: PROPS.artLabelZoom,
        filter: ['==', ['get', 'k'], 'art'],
        layout: {
          'text-field': ['get', 'name'],
          // Only Noto Sans Regular/Bold/Italic exist on OpenFreeMap's glyph
          // server; a missing fontstack 404s and drops the whole tile.
          'text-font': ['Noto Sans Italic'],
          'text-size': ['interpolate', ['linear'], ['zoom'],
            PROPS.labelSize[0], PROPS.labelSize[1], PROPS.labelSize[2], PROPS.labelSize[3]],
          'text-anchor': 'bottom', 'text-offset': [0, -0.5],
          'text-max-width': 9, 'text-padding': 8, 'text-allow-overlap': false,
        },
        paint: {
          'text-color': '#f6ead2', 'text-halo-color': 'rgba(20,12,4,0.92)',
          'text-halo-width': 1.4, 'text-halo-blur': 0.4,
          'text-opacity': ['interpolate', ['linear'], ['zoom'],
            PROPS.artLabelZoom, 0, PROPS.artLabelZoom + 0.5, 0.9],
        },
      });
    }
  };

  window.applyPropColors = function applyPropColors(map, p) {
    if (!map || !map.getLayer || !map.getLayer(ART)) return;
    const set = (id, v) => { try { map.setPaintProperty(id, 'fill-extrusion-color', v); } catch (e) {} };
    set(ART, pick(COL.art, p));
    set(FURN, pick(COL.furn, p));
    set(CONS, pick(COL.cons, p));
  };
})();
