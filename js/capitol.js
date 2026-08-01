/**
 * capitol.js — the Texas Capitol Complex.
 *
 * The modelled area used to stop at latitude 30.276, one block north of the
 * Capitol grounds, so the scene held the back of the state complex and then
 * fell off a cliff into empty basemap exactly where the Capitol, its 22 acres
 * of grounds and the Governor's Mansion belong. scripts/bake_capitol.py fills
 * that in; this file is what puts it on the map.
 *
 * THE DESIGN RULE HERE IS "ADD NOTHING NEW WHERE SOMETHING EXISTS".
 * Five of the six baked files are merged into sources the app already has —
 * austin-buildings, austin-parts, austin-ground, austin-trees — so the new
 * area inherits, for free and permanently: facade window patterns, ground
 * shadows, label dedup and placement, the collision grid, the day→night
 * palette, the tree-density knob, and the z-order. Only the dome needs a layer
 * of its own, because it is the one thing in the scene whose colour must NOT
 * follow the others after dark (see `wn` in the bake — the Capitol is
 * floodlit).
 *
 * Public (window) API:
 *   mergeCapitolScene(buildings, parts)  — await before quantiseFacades()
 *   initCapitol(map)                     — dome layer + ground/tree merges
 *   applyCapitolColors(map, p)           — retint the dome for time-of-day p
 *   CAPITOL                              — the taste block (below)
 */
(function () {
  'use strict';

  const CAPITOL = {
    on: true,
    minZoom: 13.5,
    domeOpacity: 1.0,
  };
  window.CAPITOL = CAPITOL;

  const DOME_SRC = 'austin-capitol-dome';
  const DOME_LAYER = 'capitol-dome';

  async function getJSON(url, fallback) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(r.status);
      return await r.json();
    } catch (e) {
      console.warn('[capitol] fetch', url, e.message);
      return fallback;
    }
  }

  const EMPTY = { type: 'FeatureCollection', features: [] };

  /**
   * Splice the new buildings and parts into the snapshot BEFORE anything reads
   * it, and apply the height/material corrections to the state buildings that
   * were already there.
   *
   * The corrections live in a data file applied here rather than being written
   * back into buildings.detailed.geojson on purpose: that snapshot is a
   * generated artefact, and a re-run of bake_detail.py would silently undo them.
   * A patch that re-applies on every load cannot rot that way.
   */
  window.mergeCapitolScene = async function mergeCapitolScene(buildings, parts) {
    if (!CAPITOL.on) return null;
    const [add, addParts, overrides] = await Promise.all([
      getJSON('data/capitol.geojson', EMPTY),
      getJSON('data/capitol_parts.geojson', EMPTY),
      getJSON('data/capitol_overrides.json', {}),
    ]);

    let patched = 0, raised = 0;
    for (const f of buildings.features) {
      const o = overrides[f.properties && f.properties.id];
      if (!o) continue;
      if (o.final_height) raised++;
      // `was_height` is provenance for the report, not a paint property.
      for (const k in o) if (k !== 'was_height') f.properties[k] = o[k];
      patched++;
    }
    buildings.features.push(...(add.features || []));
    if (parts) parts.features.push(...(addParts.features || []));

    // Tell the facade quantiser which tones it may not average away. This must
    // happen before quantiseFacades runs — hence the await in app.js's
    // loadScene. Without it the Capitol's granite is one building against 3,000
    // and folds into the nearest tan, which put a pink dome on brown walls.
    if (Array.isArray(addParts.facade_protect)) {
      window.FACADE_PROTECTED = (window.FACADE_PROTECTED || [])
        .concat(addParts.facade_protect);
    }

    console.log('[capitol]', (add.features || []).length, 'buildings +',
                (addParts.features || []).length, 'parts added,',
                patched, 'existing patched (', raised, 'raised )');
    return { added: (add.features || []).length, patched: patched, raised: raised };
  };

  /**
   * Merge an extra FeatureCollection into a URL-backed GeoJSON source.
   *
   * This re-fetches the base file, which looks wasteful and is the deliberate
   * choice: MapLibre v5 does not expose a source's data back to us
   * (`_data` is gone — see HANDOFF §15), so the alternative is a second source
   * with a second copy of every layer, palette and z-order rule, which is how
   * two of them silently diverge later. The refetch is a browser cache hit —
   * the same URL was requested seconds earlier — so the real cost is one JSON
   * parse, paid once at load, in exchange for the ground and the trees having
   * exactly one definition each.
   */
  /**
   * Append the Capitol's features to a source that is already loaded.
   *
   * THIS USED TO DOWNLOAD THE ENTIRE BASE FILE A SECOND TIME. `setData` replaces
   * a source wholesale, so to add 60 Capitol trees it re-fetched all 25,341 of
   * the city's, concatenated, and handed the lot back. Measured with
   * scripts/verify/payload.mjs on 2026-08-01: `data/trees.geojson` fetched twice
   * at 9.13 MB and `data/ground.geojson` twice at 0.81 MB — **9.94 MB, a quarter
   * of the 39.7 MB a first-time visitor downloads**, for features they already
   * had. The second fetch is usually a cache hit so it never showed up as slow
   * network; what it actually cost was a second full JSON parse and a complete
   * re-tile of the biggest source in the app, on the main thread, during load.
   *
   * `updateData` (MapLibre 4+, confirmed present in the 5.24.0 bundle) takes a
   * DIFF instead. `{ add: [...] }` appends in the worker and leaves the existing
   * tiles alone. The base file is never named, let alone fetched.
   *
   * baseUrl is kept only for the fallback path, so that pinning MapLibre to an
   * older build degrades to the old behaviour instead of silently dropping the
   * Capitol.
   */
  async function mergeIntoSource(map, srcId, baseUrl, extraUrl, label) {
    const src = map.getSource(srcId);
    if (!src) { console.warn('[capitol] no source', srcId); return 0; }
    const extra = await getJSON(extraUrl, EMPTY);
    const add = extra.features || [];
    if (!add.length) return 0;
    if (typeof src.updateData === 'function') {
      src.updateData({ add });
      console.log('[capitol]', add.length, label, 'appended to', srcId);
    } else {
      const base = await getJSON(baseUrl, EMPTY);
      src.setData({ type: 'FeatureCollection',
                    features: (base.features || []).concat(add) });
      console.warn('[capitol] no updateData on', srcId,
                   '- refetched', baseUrl, 'to merge', label);
    }
    return add.length;
  }

  /** ['interpolate', p, wd, wg, wn] — the same shape timeofday.js bakes with. */
  function bakedColor(p, d, g, n) {
    p = Math.max(0, Math.min(1, p));
    return ['interpolate', ['linear'], p,
      0, ['to-color', ['get', d], '#888888'],
      0.5, ['to-color', ['get', g], '#888888'],
      1, ['to-color', ['get', n], '#333344'],
    ];
  }

  window.initCapitol = function initCapitol(map) {
    if (!CAPITOL.on || map.getSource(DOME_SRC)) return;
    map.addSource(DOME_SRC, { type: 'geojson', data: 'data/capitol_dome.geojson' });

    const p = (window.__todCurrentP != null) ? window.__todCurrentP : 0.3;
    if (!map.getLayer(DOME_LAYER)) {
      // Under the labels, over the buildings. `parts-roof` is the last
      // extrusion of ours in the style, so inserting before the first symbol
      // layer keeps the dome from painting over its own name.
      const before = ['buildings-labels', 'signs-label']
        .find(id => map.getLayer(id));
      map.addLayer({
        id: DOME_LAYER, type: 'fill-extrusion', source: DOME_SRC,
        minzoom: CAPITOL.minZoom,
        paint: {
          'fill-extrusion-color': bakedColor(p, 'wd', 'wg', 'wn'),
          'fill-extrusion-height': ['get', 'h'],
          'fill-extrusion-base': ['get', 'base'],
          'fill-extrusion-opacity': CAPITOL.domeOpacity,
          // OFF, and this is the opposite of what it looks like it should be.
          // The gradient darkens the BOTTOM of each extrusion — which for one
          // 30 m building is the effect you want, and for a dome made of 18
          // stacked 1.3 m discs is 18 dark bands, one per disc. Measured: with
          // it on, the dome read as a dark brown cone; off, MapLibre's own
          // per-facet shading around each circle carries the curvature and the
          // stack reads as one mass.
          'fill-extrusion-vertical-gradient': false,
        },
      }, before);
    }

    // Fire and forget: both merges are independent of each other and of the
    // dome, and neither is worth blocking the first frame on.
    mergeIntoSource(map, 'austin-ground', 'data/ground.geojson',
                    'data/capitol_ground.geojson', 'ground features');
    mergeIntoSource(map, 'austin-trees', 'data/trees.geojson',
                    'data/capitol_trees.geojson', 'trees');
  };

  window.applyCapitolColors = function applyCapitolColors(map, p) {
    if (!map || !map.getLayer || !map.getLayer(DOME_LAYER)) return;
    try {
      map.setPaintProperty(DOME_LAYER, 'fill-extrusion-color',
                           bakedColor(p, 'wd', 'wg', 'wn'));
    } catch (e) {}
  };

  /** Re-read CAPITOL after a live edit. */
  window.applyCapitolSettings = function applyCapitolSettings(map) {
    if (!map.getLayer(DOME_LAYER)) return;
    try {
      map.setLayoutProperty(DOME_LAYER, 'visibility', CAPITOL.on ? 'visible' : 'none');
      map.setPaintProperty(DOME_LAYER, 'fill-extrusion-opacity', CAPITOL.domeOpacity);
    } catch (e) {}
  };
})();
