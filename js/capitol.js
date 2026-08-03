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
    // THE GROUNDS ARE A FOREST AND THE CITY TREE FILE DOES NOT DRAW THEM.
    //
    // data/trees.geojson has grown to 64,003 features and 26.3 MB and it does
    // now contain 481 canopies inside the grounds (-97.7428..-97.7382,
    // 30.2723..30.2778), so on the face of it this bake's 306 trees are
    // redundant. They are not. Magenta-masking `trees-canopy` and
    // `trees-trunk` together over a box on the SOUTH LAWN reads 0 pixels out
    // of 43,594: whatever the file contains, nothing of it reaches the screen
    // there. A file that has the features and a map that draws none of them
    // look identical from the data side, which is why this is measured in the
    // framebuffer and not in the JSON.
    //
    // So the Capitol keeps its own trees — but NOT by appending to
    // austin-trees, which would mean refetching and re-tiling 26.3 MB and
    // 64,615 features to add 612 (see mergeIntoSource). Their own source and
    // a clone of the two tree layers costs 198 KB and no re-tile.
    ownTrees: true,
    // How high the Capitol's own ground has to stand to clear the outer ring's
    // park pad. MEASURED, not chosen: the pad is one `outer-detail` feature,
    // `k:'g'`, `h` 0.45, base 0, opacity 1, colour #8fa869. See addGround().
    groundLift: 0.46,
    // 0.22 is js/ground.js's own GROUND.pathRaise — a kerb, deliberately
    // over-scale, and the Capitol's walks step up by exactly the same amount
    // as the campus's so the two read as one city.
    pathRaise: 0.22,
    // The lawn's grain. A constant because fill-extrusion-opacity cannot take
    // the per-feature expression `ground-texture` uses; see mirrorGround().
    grainOpacity: 0.5,
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
  /**
   * A VECTOR SOURCE CANNOT BE APPENDED TO AT ALL, which is the price of tiling.
   *
   * `updateData` and `setData` are GeoJSONSource methods. Once js/tiles.js swaps
   * austin-trees over to a pmtiles archive, neither exists, and the Capitol's
   * 612 trees have nowhere to go — silently, because a source that ignores you
   * throws nothing.
   *
   * So the extras get their own GeoJSON source and a CLONE of every layer that
   * was drawing the base one. Cloning is the part that matters: the whole design
   * rule in this file is "add nothing new where something exists", because a
   * second hand-written layer is how two definitions of the same thing drift
   * apart. A clone taken from `getStyle()` at runtime cannot drift — change the
   * tree colour ramp in app.js and the Capitol's trees change with it, since
   * they are literally the same layer definition with one field swapped.
   *
   * `source-layer` is deleted from the clone on purpose. It is meaningless on a
   * GeoJSON source and MapLibre rejects the layer outright if it is left in.
   */
  function cloneLayersOnto(map, srcId, newSrcId) {
    const style = map.getStyle();
    let n = 0;
    for (const layer of (style.layers || [])) {
      if (layer.source !== srcId) continue;
      const copy = JSON.parse(JSON.stringify(layer));
      copy.id = layer.id + '-capitol';
      copy.source = newSrcId;
      delete copy['source-layer'];
      if (map.getLayer(copy.id)) continue;
      // Insert directly above the layer it copies, so z-order is inherited
      // rather than re-derived. Getting this wrong is how the Capitol's paths
      // ended up under its own lawn once.
      try { map.addLayer(copy, nextLayerAfter(style, layer.id)); n++; }
      catch (e) { console.warn('[capitol] clone failed for', layer.id, e.message); }
    }
    return n;
  }

  function nextLayerAfter(style, id) {
    const i = (style.layers || []).findIndex(l => l.id === id);
    return (i >= 0 && style.layers[i + 1]) ? style.layers[i + 1].id : undefined;
  }

  /**
   * `updateData` FAILS IN THE WORKER, A TICK LATER, AND RETURNS NOTHING.
   *
   * MapLibre builds an id-keyed "updateable" index of the source's CURRENT
   * features before it will apply a diff, and it gives up if any feature has
   * no id or if two share one. `data/ground.geojson` and `data/trees.geojson`
   * carry no ids at all, so the diff can never be applied to either — and the
   * refusal arrives as `GeoJSONSource "austin-ground": GeoJSON data is not
   * compatible with updateData` on the map's `error` event, AFTER
   * `src.updateData()` has already returned normally.
   *
   * So the old code called it, logged "1,161 ground features appended", and
   * appended nothing. Measured with the §48 magenta mask at the Capitol,
   * nadir, zoom 16.4: `ground-paths` and `ground-areas` painted 14,683 and
   * 36,072 magenta pixels in the surrounding blocks and EXACTLY ZERO inside
   * the Capitol grounds. The green there is the basemap's park polygon. Every
   * one of the 322 lawns, 839 walks and 612 trees this bake produces has been
   * absent since the updateData change landed, and nothing said so, because a
   * counter taken at call time counts intent rather than outcome.
   *
   * This resolves BEFORE the fallback runs, so the fallback is only paid when
   * the fast path really was refused.
   */
  function updateDataRefused(map, srcId, ms) {
    return new Promise(resolve => {
      let settled = false;
      const stop = v => {
        if (settled) return;
        settled = true;
        map.off('error', onErr);
        clearTimeout(timer);
        resolve(v);
      };
      const onErr = e => {
        const msg = (e && e.error && e.error.message) || '';
        if (msg.indexOf('updateData') >= 0 && msg.indexOf(srcId) >= 0) stop(true);
      };
      map.on('error', onErr);
      const timer = setTimeout(() => stop(false), ms);
    });
  }

  /** What actually happened, per source. Verification reads this, not a log. */
  window.__capitolMerge = {};

  async function mergeIntoSource(map, srcId, baseUrl, extraUrl, label) {
    const src = map.getSource(srcId);
    if (!src) { console.warn('[capitol] no source', srcId); return 0; }
    const extra = await getJSON(extraUrl, EMPTY);
    const add = extra.features || [];
    if (!add.length) return 0;
    const note = how => { window.__capitolMerge[srcId] = { n: add.length, how: how }; };

    if (typeof src.updateData === 'function') {
      const refused = updateDataRefused(map, srcId, 1500);
      src.updateData({ add });
      if (!await refused) {
        note('updateData');
        console.log('[capitol]', add.length, label, 'appended to', srcId);
        return add.length;
      }
      console.warn('[capitol]', srcId, 'refused the diff (its features have no'
                 + ' ids) - refetching', baseUrl, 'to merge', label);
    }
    if (typeof src.setData === 'function') {
      const base = await getJSON(baseUrl, EMPTY);
      src.setData({ type: 'FeatureCollection',
                    features: (base.features || []).concat(add) });
      note('setData');
      console.log('[capitol]', add.length, label, 'merged into', srcId,
                  'by setData (' + ((base.features || []).length + add.length)
                  + ' features total)');
    } else {
      // Tiled. Own source, cloned layers.
      //
      // `data: extra`, not `data: extraUrl` — the file is already parsed and in
      // hand. Passing the URL makes MapLibre fetch it a SECOND time, which is
      // precisely the bug this function was rewritten to remove an hour ago,
      // reintroduced in the fix for a different problem. Measured with
      // payload.mjs: capitol_trees.geojson 2x, 0 from cache.
      const sideId = srcId + '-capitol';
      if (!map.getSource(sideId)) {
        map.addSource(sideId, { type: 'geojson', data: extra });
      }
      const n = cloneLayersOnto(map, srcId, sideId);
      note('clone:' + n);
      console.log('[capitol]', add.length, label, '->', sideId,
                  '(' + n + ' layers cloned; ' + srcId + ' is tiled)');
    }
    return add.length;
  }

  // ───────────────────────────── the grounds ──────────────────────────────
  /**
   * THE OUTER RING PAINTS A 0.45 m PARK PAD OVER THE WHOLE CAPITOL GROUNDS,
   * AND THAT IS WHERE THE WALKWAYS WENT.
   *
   * "looks like u got rid of the walkways around it those had a cool pattern"
   *
   * Two separate faults, both of which had to be found before either mattered:
   *
   *   1. bake_capitol.py still emitted `k:'path'` LineStrings after the whole
   *      city moved to `k:'patharea'` polygons (see widen_paths in that file).
   *   2. Even as polygons they are invisible, because `outer-detail` — one
   *      `fill-extrusion` of 309 flat park pads from the tiled outer ring —
   *      covers the grounds with a slab at `h` 0.45 m, opacity 1, #8fa869.
   *      `ground-areas` is a flat fill at z=0 and `ground-paths` stands at
   *      0.22 m, so BOTH lose the depth test to it. Layer order cannot save
   *      them: `ground-paths` is already drawn after (style index 138 against
   *      129) and still loses, because a fill-extrusion writes depth.
   *
   * Measured with §48's magenta mask asked of every layer in turn, over a box
   * on the south lawn: exactly one layer covers it, `outer-detail`, at 98.6 %.
   * The green everyone has been looking at is the outer ring's pad, not this
   * bake's lawn — which is why the grass looked fine and every walk was gone.
   *
   * THE ROOT CAUSE IS NOT IN THIS LANE. The outer ring should not be padding
   * an area the city models properly, and the modelled box has only just grown
   * to include this one (PR #105 took the fence from 10.1 km2 to 77.4 km2).
   * That is `scripts/bake_outer.py` / `js/outer.js`, and it is written up in
   * HANDOFF for whoever owns them.
   *
   * WHAT THIS DOES INSTEAD, and why it breaks this file's own design rule.
   * "Add nothing new where something exists" is the rule at the top of this
   * file and it is the right one — but it is a rule about not creating a
   * SECOND definition of a thing, and here the shared layers physically cannot
   * draw these features. So the Capitol's ground gets its own source and its
   * own three layers, standing on top of the pad rather than under it, and
   * every paint property is MIRRORED off the shared layers on every
   * time-of-day change. A mirror cannot drift: change the lawn colour in
   * js/ground.js and this changes with it, because it is literally reading
   * that layer's value back out of the style.
   */
  const GSRC = 'austin-capitol-ground';
  const GL_AREA = 'capitol-ground-areas';
  const GL_TEX = 'capitol-ground-texture';
  const GL_PATH = 'capitol-ground-paths';

  /** Copy one paint property from the shared layer to its Capitol twin. */
  function mirror(map, from, fromProp, to, toProp) {
    if (!map.getLayer(from) || !map.getLayer(to)) return;
    try {
      const v = map.getPaintProperty(from, fromProp);
      if (v !== undefined) map.setPaintProperty(to, toProp, v);
    } catch (e) { /* a property this layer does not have is not an error */ }
  }

  function mirrorGround(map) {
    mirror(map, 'ground-areas', 'fill-color', GL_AREA, 'fill-extrusion-color');
    mirror(map, 'ground-areas', 'fill-opacity', GL_AREA, 'fill-extrusion-opacity');
    mirror(map, 'ground-texture', 'fill-pattern', GL_TEX, 'fill-extrusion-pattern');
    // NOT the texture's opacity. `ground-texture` varies it per feature and
    // `fill-extrusion-opacity` refuses a data expression outright —
    // "layers.capitol-ground-texture.paint.fill-extrusion-opacity: data
    // expressions not supported", which invalidates the whole layer. A fill can
    // do it and an extrusion cannot, and the grain has to be an extrusion here
    // to clear the pad. So the grain gets one constant, declared as taste.
    if (map.getLayer(GL_TEX)) {
      try { map.setPaintProperty(GL_TEX, 'fill-extrusion-opacity', CAPITOL.grainOpacity); }
      catch (e) { /* */ }
    }
    mirror(map, 'ground-paths', 'fill-extrusion-color', GL_PATH, 'fill-extrusion-color');
    mirror(map, 'ground-paths', 'fill-extrusion-opacity', GL_PATH, 'fill-extrusion-opacity');
  }

  async function addGround(map) {
    if (map.getSource(GSRC)) return;
    const gj = await getJSON('data/capitol_ground.geojson', EMPTY);
    if (!(gj.features || []).length) return;
    map.addSource(GSRC, { type: 'geojson', data: gj });

    // Stacked by 20 mm so no two top faces are coplanar — the same tie PR #78
    // removed from the campus ground, avoided here by construction rather than
    // by a rank ladder, because there are only three surfaces to order.
    const z = CAPITOL.groundLift;
    const minzoom = map.getLayer('ground-areas')
      ? (map.getLayer('ground-areas').minzoom || CAPITOL.minZoom) : CAPITOL.minZoom;
    // Above `outer-detail`, and in the same neighbourhood of the style as the
    // ground layers it twins, by anchoring to one of them.
    const before = map.getLayer('ground-paths') ? 'ground-paths' : undefined;
    const flat = { 'fill-extrusion-vertical-gradient': false };
    map.addLayer({
      id: GL_AREA, type: 'fill-extrusion', source: GSRC, minzoom: minzoom,
      filter: ['==', ['get', 'k'], 'area'],
      paint: Object.assign({ 'fill-extrusion-base': z,
                             'fill-extrusion-height': z + 0.02 }, flat),
    }, before);
    map.addLayer({
      id: GL_TEX, type: 'fill-extrusion', source: GSRC, minzoom: minzoom,
      filter: ['==', ['get', 'k'], 'area'],
      paint: Object.assign({ 'fill-extrusion-base': z + 0.02,
                             'fill-extrusion-height': z + 0.04 }, flat),
    }, before);
    map.addLayer({
      id: GL_PATH, type: 'fill-extrusion', source: GSRC, minzoom: minzoom,
      filter: ['==', ['get', 'k'], 'patharea'],
      paint: Object.assign({ 'fill-extrusion-base': z + 0.04,
                             'fill-extrusion-height': z + 0.04 + CAPITOL.pathRaise },
                           flat),
    }, before);
    // NO KERB LINE, AND THIS ONE WAS PHOTOGRAPHED BEFORE IT SHIPPED.
    //
    // js/ground.js strokes its walks' boundaries with a `line` layer and that is
    // the right call there: a bevel is a screen-space effect, so pixels are the
    // right unit. The same layer here is a glitch, because a `line` does not
    // depth-test against extrusions and these layers have to sit ABOVE the
    // buildings to clear the park pad. From the standard approach pose — camera
    // south of downtown, looking north at the Capitol — the Capitol's kerbs
    // drew as a white grid floating across every downtown tower in front of
    // them. `ground-paths-casing` never does this because it is anchored below
    // the buildings, which is exactly the position this layer cannot use.
    //
    // Caught by re-running the verification ON THE MERGED TREE rather than on
    // the branch: origin/main is clean at that pose, the merge was not.
    mirrorGround(map);
    const n = k => (gj.features || []).filter(f => f.properties.k === k).length;
    window.__capitolMerge[GSRC] = { how: 'own layers over outer-detail',
                                    area: n('area'), patharea: n('patharea') };
    console.log('[capitol]', n('area'), 'lawns and', n('patharea'),
                'walks on their own layers at', z, 'm, clear of the outer '
                + 'ring\'s 0.45 m park pad');
  }

  // ────────────────────────────── the trees ───────────────────────────────
  const TSRC = 'austin-trees-capitol';

  async function addTrees(map) {
    if (map.getSource(TSRC)) return;
    const gj = await getJSON('data/capitol_trees.geojson', EMPTY);
    if (!(gj.features || []).length) return;
    map.addSource(TSRC, { type: 'geojson', data: gj });
    const n = cloneLayersOnto(map, 'austin-trees', TSRC);
    mirrorTrees(map);
    window.__capitolMerge[TSRC] = { how: 'own source, ' + n + ' cloned layers',
                                    features: gj.features.length };
    console.log('[capitol]', gj.features.length, 'grounds trees on', n,
                'cloned layers (austin-trees draws none here: 0 magenta px'
                + ' over the south lawn)');
  }

  /**
   * A CLONE TAKEN AT INIT IS A SNAPSHOT, and the two things that move under it
   * are the hour and the density knob. Both are mirrored off the layer this
   * was cloned from, so neither can drift: the tree colour ramp lives in
   * js/app.js and this reads it back out of the style rather than restating it.
   */
  function mirrorTrees(map) {
    for (const base of ['trees-canopy', 'trees-trunk']) {
      const twin = base + '-capitol';
      if (!map.getLayer(base) || !map.getLayer(twin)) continue;
      mirror(map, base, 'fill-extrusion-color', twin, 'fill-extrusion-color');
      mirror(map, base, 'fill-extrusion-opacity', twin, 'fill-extrusion-opacity');
      try { map.setFilter(twin, map.getFilter(base)); } catch (e) { /* */ }
    }
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
    addGround(map);
    if (CAPITOL.ownTrees) addTrees(map);
  };

  window.applyCapitolColors = function applyCapitolColors(map, p) {
    if (!map || !map.getLayer) return;
    // The ground twins are mirrored on EVERY time-of-day change, not just at
    // init. This is the whole reason a clone is allowed to exist here: get it
    // wrong and the Capitol keeps a daylit lawn after dark, which is §35 item
    // 1's failure mode on 1,161 features instead of one stadium.
    //
    // TWICE, AND THE SECOND ONE IS THE ONE THAT WORKS. js/timeofday.js calls
    // this at line 406 and repaints `trees-canopy` at line 416, so a mirror
    // taken here reads the PREVIOUS hour's tree colour and the Capitol's grove
    // stayed daylit at night — photographed, sage-green against a dark city,
    // in shots/cap-after-night before this line existed. Deferring to the next
    // task makes it independent of where in that function the call sits, which
    // is not a detail this file should have to know.
    mirrorGround(map);
    mirrorTrees(map);
    setTimeout(() => { mirrorGround(map); mirrorTrees(map); }, 0);
    if (!map.getLayer(DOME_LAYER)) return;
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
