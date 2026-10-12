/**
 * gltf-layer.js — buildings modelled in Blender, drawn next to the recipe buildings. OFF unless the page asks: ?gltf=1.
 *
 * WHY. The apartment buildings are drawn from recipes (data/apartments/*.json): rules that make walls, windows and
 * panels. A model made in Blender by hand has no recipe, so it could not be shown. This file draws a plain .glb
 * (metres, coloured meshes, no images) as ONE more mesh in the city's own three.js scene (js/slopes.js), through the
 * city's own builder and material, so it takes the city's sun, shadows, hour, haze and render distance for nothing.
 *
 * REPLACE, NEVER OVERLAP. A building named in the table below is left out of js/slopes-apartments.js while this layer is
 * on (one hook there: GLTF_LAYER.hides), so the recipe's drawing and the model never stand in the same place. The
 * generic block under it stays hidden through the recipe's own replacedBuildingIds. With the switch off this file adds
 * the table and nothing else: no fetch, no mesh, no change to any other file's behaviour.
 *
 * WHAT A .glb MUST BE (checked, a wrong file fails loudly instead of drawing wrong): glTF 2.0 binary, positions as
 * float32, indices as uint8/16/32, one flat colour per material (baseColorFactor), no node transforms, no images, no
 * sparse accessors. The loader (js/gltf-layer-draw.js) is about 70 lines for exactly that. Model frame (Blender's, Z up): X along the
 * street face, Y into the building, Z up; Z = 0 at the ground. The .glb stores it Y-up (x, z, -y); the loader turns it
 * back.
 *
 * WHAT IT DOES NOT CARRY from a recipe building is listed in docs/gltf-layer.md (night windows, click card, name label,
 * far tier, packed vertices, picking), each with the cost of adding it.
 *
 * TWO FILES. This one holds the table, every taste value and the two functions js/slopes-apartments.js calls. The drawing code
 * (the .glb loader, colours, the mesh) is js/gltf-layer-draw.js, fetched only when the switch is on.
 *
 * Public: window.GLTF_LAYER = { on, buildings, hides(spec), stub(spec), stats(), group, ready } (+ parse(), for scripts/verify).
 */
(function () {
  'use strict';
  const q = new URLSearchParams(window.location.search);

  // ══════════════════════════════════════════════════════════════════════
  //  TASTE BLOCK — CLAUDE.md rule 11. Every value here is a choice, not a measurement, unless it says so.
  // ══════════════════════════════════════════════════════════════════════
  const GLTF = {
    // ?gltf=1 turns it on. Anything else, or nothing: the layer is not there.
    on: q.get('gltf') === '1',

    // ── THE TABLE: one row per building ───────────────────────────────────
    //   file       the .glb, metres, local origin at the ground, X along the street face, Y into the building
    //   lng, lat   where that origin stands (the middle of the slab's lettering, on the slab's street face)
    //   groundM    height of the origin above the city's ground plane (the recipes all stand on 0). 1.74 is a CHOICE: the
    //              model's own ground level is inferred and its height scale is good to about 5 % (4.7 m on this tower).
    //              Set 0 for the model's own inferred ground (docs/gltf-layer.md, "Placement").
    //   topM       the model's height above the city's ground (the .glb's height plus groundM): the flight collision
    //              reads it from `built`, so nobody flies through the top of the tower. scripts/verify/gltf-layer.mjs checks it.
    //   headingDeg compass bearing of the model's +Y axis (into the building); the recipe's own frame gives 95
    //   replaces   the id of the recipe whose drawing this takes over (data/apartments/yugo-austin-waterloo.json)
    buildings: [
      { name: 'Yugo Austin Waterloo', file: 'data/gltf/waterloo.glb',
        lng: -97.7442748, lat: 30.2881180, groundM: 1.74, headingDeg: 95, topM: 104.02,
        replaces: '57d4d01d-0a57-4b46-b2a8-02fcaf77f81a' },
    ],

    // ── How each Blender material is drawn ────────────────────────────────
    // `surface` is one of the city's own material classes (APARTMENTS.materials: stone, brick, concrete, glass, ...).
    // `strength` overrides that class's strength (the 4th number). `day` / `night` replace the colour read from the
    // file (hex); without them the day colour is the file's own and the night colour comes from the ramp below.
    // A material not listed is drawn as a plain flat colour from the file. The glass keeps the file's own dark colour: the city's glass
    // class mirrors the city's sky over it (the colour under it hardly shows: a lighter stand-in changed the picture by 1 grey level).
    materials: {
      white:        { surface: 'concrete', strength: 0.04 },
      white_joint:  { surface: 'concrete', strength: 0.04 },
      white_panel:  { surface: 'concrete', strength: 0.04 },
      south_white:  { surface: 'concrete', strength: 0.04 },
      south_greige: { surface: 'concrete', strength: 0.04 },
      podium_panel: { surface: 'concrete', strength: 0.04 },
      brick:        { surface: 'brick', strength: 0.35 },
      glass:        { surface: 'glass', night: '#101823', lit: true },
      glass_b:      { surface: 'glass', night: '#101823', lit: true },
      glass_rail:   { surface: 'glass', night: '#101823' },
      glass_rail_c: { surface: 'glass', night: '#101823' },
      glass_south:  { surface: 'glass', night: '#101823' },
    },
    // ── Night windows ─────────────────────────────────────────────────────
    // A recipe lights rooms pane by pane (its `night.occupancy`). A Blender model has no rooms, so a material marked
    // `lit: true` above has its panes lit AT RANDOM, the same pane every time (a hash of where the pane is), this
    // fraction of them, with the recipes' own lit-window tone. 0 = every pane dark at night, as the file says.
    // ?gltflit=0.4 tries another fraction on any page. Windows are a guess here, not a reading of the building.
    nightLit: (() => { const v = parseFloat(q.get('gltflit')); return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.23; })(),
    litTone: '#eadfc8',      // the recipes' APTS.nightLitTone
    // The day colour's golden-hour and night colours when a material gives none: the same ramp the recipes use
    // (js/slopes-apartments.js ramp(), which copies js/westcampus.js).
    goldMix: 0.16, goldTo: [255, 190, 130],
    nightGain: 0.19, nightTint: [18, 22, 40], nightToward: 0.42,

    // The layer's place in the scene, as the apartments' group has it (js/slopes-apartments.js APTS.lod / minzoom).
    lod: null, minzoom: 14,
    // Draw both sides of every face, as the apartments do (APTS.twoSided): a model with one mis-wound face must not show a hole.
    twoSided: true,
    fetchTimeoutMs: 45000,
    drawScript: 'js/gltf-layer-draw.js',
  };
  window.GLTF_LAYER = GLTF;

  // ── what js/slopes-apartments.js asks ───────────────────────────────────
  const rowFor = spec => spec && GLTF.buildings.find(b => b.replaces && b.replaces === spec.id);
  /** true when a model replaces this recipe: the apartments builder then does not draw it */
  GLTF.hides = spec => GLTF.on && !!rowFor(spec);
  /** what the apartments' `built` list holds for a recipe that is not drawn there (ids are read by campus-landscape, places, arches) */
  GLTF.stub = spec => ({ name: spec.name, id: spec.id || null, top: (rowFor(spec) || {}).topM || 0, frame: null, roofs: [], rakes: [], signs: 0, insets: 0, replacedBy: 'gltf' });
  GLTF.group = null;
  GLTF.ready = false;
  const info = { loaded: [], triangles: 0, vertices: 0, drawCalls: 0, litTriangles: 0, bytes: 0, ms: 0, buildMs: 0, errors: [] };
  GLTF.info = info;
  GLTF.stats = () => Object.assign({}, info);
  if (!GLTF.on) return;
  // The drawing code (loader, colours, build) is a second file that is only fetched when the switch is on, so a page
  // without ?gltf=1 pays for the table and two functions and nothing else.
  const tag = document.createElement('script');
  tag.src = GLTF.drawScript;
  document.head.appendChild(tag);
})();
