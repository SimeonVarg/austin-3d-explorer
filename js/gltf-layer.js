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
  const OWN_DEFAULT = q.get('gltfaa') !== '0';
  const GLTF = {
    // ?gltf=1 turns it on. Anything else, or nothing: the layer is not there.
    on: q.get('gltf') === '1',

    // ── THE TABLE: one row per building ───────────────────────────────────
    //   file       the .glb, metres, local origin at the ground, X along the street face, Y into the building
    //   lng, lat   where that origin stands (the middle of the slab's lettering, on the slab's street face). Fitted to the surveyed
    //              footprint (the map outline, which the 2021 laser scan agrees with): the model's podium is centred on the outline's
    //              extent along the street face. The recipe's slab would put it 6.35 m south of that (lng -97.7442748, lat 30.2881180).
    //   groundM    height of the origin above the city's ground plane (the recipes all stand on 0). 1.74 is a CHOICE: the
    //              model's own ground level is inferred and its height scale is good to about 5 % (4.7 m on this tower).
    //              Set 0 for the model's own inferred ground (docs/gltf-layer.md, "Placement").
    //   topM       the model's height above the city's ground (the .glb's height plus groundM): the flight collision
    //              reads it from `built`, so nobody flies through the top of the tower. scripts/verify/gltf-layer.mjs checks it.
    //   headingDeg compass bearing of the model's +Y axis (into the building); the recipe's own frame gives 95
    //   replaces   the id of the recipe whose drawing this takes over (data/apartments/yugo-austin-waterloo.json)
    buildings: [
      { name: 'Yugo Austin Waterloo', file: 'data/gltf/waterloo.glb',
        lng: -97.7442690, lat: 30.2881748, groundM: 1.74, headingDeg: 95, topM: 104.02,
        replaces: '57d4d01d-0a57-4b46-b2a8-02fcaf77f81a',
        // The same model WITH its Blender materials, drawn by js/gltf-look.js under the app's light (js/city-sky.js) instead of the flat colours
        // above. `lookOrigin`: the point of that file (its own X, Y, Z) that stands on this row's lng / lat.
        look: 'data/gltf/waterloo-look.glb', lookOrigin: [7.78, 0, 0],
        // The night profile the city's night rules read for this building (the recipe's own `night`): the share of rooms lit and the
        // lamps. Lamp positions are in the MODEL frame (x along the street face, y into the building, z up from the model's ground), the
        // recipe's four downlights moved onto this model's terrace, sign and entry: sign wash, two terrace lamps, entry canopy.
        night: { occupancy: 0.23, unitBays: 1, fixtures: [
          { position: [0, -0.45, 100.85], colour: '#ffe6bd', radius: 5, power: 0.45 },
          { position: [10.7, 9.7, 92.64], colour: '#ffe6b8', radius: 5, power: 0.25 },
          { position: [10.7, 22.7, 92.64], colour: '#ffe6b8', radius: 5, power: 0.25 },
          { position: [13.7, 29.0, 4.7], colour: '#ffdb9e', radius: 5, power: 0.4 } ] } },
      // The Venue on Guadalupe: the app has no hand-made recipe for it, its drawing is the neighbourhood collection's entry
      // (data/neighborhood_apartments.json, id below), which this row replaces like any recipe. Origin = the blue triangle's corner at the ground,
      // X along the long sign face, Y into the building. Placed by fitting its two measured street walls to the surveyed outline (see
      // docs/gltf-layer.md); its own values below override the layer's: the materials (each window group is a measured pane colour), the
      // light gains, the hour whose sun matches the site photograph (the sign face lit, the Guadalupe face in shade), storeys of 3.3 m.
      { name: 'The Venue on Guadalupe', file: 'data/gltf/venue.glb',
        lng: -97.7419657, lat: 30.2939211, groundM: 0, headingDeg: 6.834, topM: 22.91,
        replaces: '5d3a4e03-f525-4037-917c-4c4b56584fc4',
        photoHour: 0.28, storeyM: 3.3, storeyOffsetM: 0, glassStrength: 0.22,
        windowGapM: 0.3,       // the panes of one window (2 to 4, a few cm apart) are one room at night
        materials: (() => {
          const m = {
            white:    { fix: 'white', surface: 'concrete', strength: 0.04 },
            grey:     { fix: 'grey',  surface: 'concrete', strength: 0.04 },
            blue:     { fix: 'blue',  surface: 'concrete', strength: 0.04 },
            band:     { fix: 'band',  surface: 'concrete', strength: 0.04 },
            roof:     { fix: 'roof',  surface: 'concrete', strength: 0.04 },
            slab:     { fix: 'dark',  night: '#1c252d' },
            frame:    { fix: 'dark',  night: '#242b30' },
            bulkhead: { fix: 'roof',  night: '#3a3d3d' },
            unit:     { fix: 'roof',  night: '#3a3d3d' },
            sign:     { fix: 'dark',  surface: 'glass', strength: 0, night: '#fff0d4' },
          };
          for (let i = 0; i < 16; i++) m['glass_' + i] = { fix: 'glass', surface: 'glass', lit: true };
          return m;
        })(),
        litFix: {
          shade: { white: [0.78, 0.77, 0.80], grey: [0.52, 0.56, 0.58], blue: [0.04, 0.24, 0.37], band: [1, 1, 1], roof: [1, 1, 1], dark: [1, 1, 1], glass: [1, 1, 1] },
          sun:   { white: [0.99, 0.97, 0.97], grey: [0.93, 0.94, 0.90], blue: [0.79, 0.81, 0.82], band: [0.91, 0.88, 0.90], roof: [0.98, 0.98, 0.96], dark: [1, 1, 1], glass: [1, 1, 1] },
        } },
    ],

    // ── How each Blender material is drawn ────────────────────────────────
    // `surface` is one of the city's own material classes (APARTMENTS.materials: stone, brick, concrete, glass, ...).
    // `strength` overrides that class's strength (the 4th number). `day` / `night` replace the colour read from the
    // file (hex); without them the day colour is the file's own and the night colour comes from the ramp below.
    // A material not listed is drawn as a plain flat colour from the file. The glass keeps the file's own dark colour: the city's glass
    // class mirrors the city's sky over it (the colour under it hardly shows: a lighter stand-in changed the picture by 1 grey level).
    materials: {
      white:        { fix: 'slab', surface: 'concrete', strength: 0.04, night: '#85847c' },   // the blade: the recipe's `cream` night tone
      white_joint:  { fix: 'slab', surface: 'concrete', strength: 0.04, night: '#6f6e68' },
      white_panel:  { fix: 'panel', surface: 'concrete', strength: 0.04, night: '#62696c' },   // the recipe's `charPanel`
      south_white:  { fix: 'wall', surface: 'concrete', strength: 0.04, night: '#85847c' },
      south_greige: { fix: 'wall', surface: 'concrete', strength: 0.04, night: '#61676b' },   // `greige`
      podium_panel: { fix: 'panel', surface: 'concrete', strength: 0.04, night: '#737777' },   // `brickLight`
      brick:        { fix: 'brick', surface: 'brick', strength: 0.35, night: '#272830' },      // `brick`
      charcoal:     { fix: 'dark', night: '#2a3138' },                                        // `charcoal`
      black:        { fix: 'dark', night: '#1c252d' },                                        // `frameDark`
      midgrey:      { fix: 'dark', night: '#363a3a' },                                        // the blade's slots: `slot`
      duct:         { fix: 'dark', night: '#323d47' },                                        // `metal`
      penthouse:    { fix: 'dark', night: '#323d47' },
      // The sign: the recipe's lit lettering. A glass surface of strength 0 is how the recipe's `signFace` is drawn: no mirror, and the
      // city's night rules light it with its night tone.
      letters:      { fix: 'dark', surface: 'glass', strength: 0, night: '#fff0d4', sign: true },
      // Windows are lit room by room (below). The tone of a dark pane is the city's own (CityNight.tune.unlitGlass); the crown and rails
      // use the recipe's `crownGlass` night tone.
      glass:        { fix: 'glass', surface: 'glass', lit: true },
      glass_b:      { fix: 'glass', surface: 'glass', lit: true },
      glass_rail:   { fix: 'glass', surface: 'glass', night: '#122a31' },
      glass_rail_c: { fix: 'glass', surface: 'glass', night: '#122a31' },
      glass_south:  { fix: 'glass', surface: 'glass', night: '#122a31' },
    },
    // ── Night windows ─────────────────────────────────────────────────────
    // A material marked `lit: true` above has its panes lit by the CITY'S OWN night rules, CityNight.room(building, floor, column): the
    // profile above (occupancy 0.23), the city's tones and brightness, and its dark-pane tone for the rest. The floor comes from the
    // pane's height (3.05 m storeys from the ground) and the column from its place in its row on its wall. `nightLit` is only the
    // fallback when the city's night rules are off (?citynight=0): that fraction of panes, by a hash of where the pane is.
    maxRoomWidthM: 3.0,   // a glass pane wider than this is a strip of glazing (the crown), not a room: never lit, like the recipe's subdued crown glazing
    storeyM: 3.05, storeyOffsetM: 0.25,   // the model's floors: floor = floor((height above its ground + offset) / storey)
    nightLit: (() => { const v = parseFloat(q.get('gltflit')); return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.23; })(),
    litTone: '#eadfc8',      // the recipes' APTS.nightLitTone
    // ── Day colour under the app's light ──────────────────────────────────────────────────────────────────────
    // The colours in the file are what a lit photograph shows, and the app lights them again with its own sun and grade. So each class
    // of material (its `fix` above) gets a gain per colour channel, one for faces the sun reaches at the photograph's hour and one for
    // faces it does not, found by rendering the app from the photograph's camera and dividing the photograph's colour by the app's
    // (js/look-photo.js does the same for trees and roads). Measured numbers are in the pull request. The gain is
    // applied to the day colour and to the golden colour made from it; night colours are the table's own.
    photoHour: 0.315,                // the app's time of day (0..1) whose sun matches the site photograph's light
    sunThreshold: 0.15,              // a face is sunlit when its normal dotted with the sun's direction is above this
    litFix: {
      shade: { slab: [1.22, 1.30, 1.36], panel: [1.08, 1.20, 1.38], wall: [1, 1, 1], dark: [1.31, 1.51, 1.58], brick: [1, 1, 1], glass: [1, 1, 1] },
      sun:   { slab: [0.81, 0.84, 0.84], panel: [0.81, 0.84, 0.84], wall: [0.81, 0.84, 0.84], dark: [1, 1, 1], brick: [1, 1, 1], glass: [1, 1, 1] },
    },
    glassStrength: 0.5,              // how much sky the glass mirrors (0..1; the city's glass class is 1, the recipe tower's own glass 0.55); null = the city's
    // The long strips of glazing (the crown) mirror the sky differently from room windows in the photograph: bluer and darker than the
    // city's sky mirror makes the file's near-black glass. Only panes wider than `maxRoomWidthM` take these; windows keep the file's glass.
    crownGlass: { day: '#1870b8', strength: 0.22 },
    // The day colour's golden-hour and night colours when a material gives none: the same ramp the recipes use
    // (js/slopes-apartments.js ramp(), which copies js/westcampus.js).
    goldMix: 0.16, goldTo: [255, 190, 130],
    nightGain: 0.19, nightTint: [18, 22, 40], nightToward: 0.42,

    // ── Far away: the windows must be steady (CLAUDE.md rule 15) ──────────────────────────────────────────
    // Panes thinner than a pixel crawl when they are drawn as geometry. The city's cure for its recipe buildings is a texture of each
    // wall's AREA-AVERAGED colours, minified by the GPU's mip chain, drawn over the wall once a pixel covers more than about 0.3 m
    // (js/facade-filter.js, js/slopes.js facadeMaterial). This layer builds the same overlay from the model's own quads, painted back
    // to front: near = the hard panes of the geometry, far = their true area average, in between a fade that never pops. Nothing is
    // blurred: the texture is only ever sampled where a texel is smaller than a pixel. ?gltffilter=0 turns it off for an A/B.
    facade: {
      on: q.get('gltffilter') !== '0',
      fadeStart: 0.25, fadeEnd: 0.5,           // metres a pixel covers: the overlay starts here and is complete there (the recipes use 0.3 and 0.8; the
                                               // model's panes are thinner and more of them, so the geometry beneath must be gone by 250 m)
      nightFadeStart: 0.4, nightFadeEnd: 0.5,  // the hour (0..1) it gives way to the lit-window geometry at night (the recipes' values)
      texelMetres: 0.25, maxDimension: 256,    // one texel of the wall map, and its largest side in texels
      supersample: 3,                          // painting resolution: this many cells a texel side
      anisotropy: 4,
      minArea: 40, minDetails: 12,             // a wall face gets an overlay if it is this big (m2) and has this many quads on it
      behind: 0.02, front: 0.4,                // quads this far behind / in front of the face (m) belong to it
      lift: 0.1,                               // the overlay stands this far (m) in front of the frontmost quad (more than the depth buffer can mix up with it at 1 km)
    },

    // ── The app's light (round 5): a row with a `look` file is drawn by js/gltf-look.js under js/city-sky.js ─────────────────────────────
    // ?gltflook=0 draws every row the old way (flat colours with light gains, wall maps). `skyMapStrength`: 1 = recesses get as little
    // sky light as the map baked in Blender says, 0 = the map is ignored.
    look: { on: q.get('gltflook') !== '0', scripts: ['js/city-sky.js', 'js/gltf-look.js'], skyMapStrength: 1,
      // Smooth edges of its own (js/gltf-look.js "SMOOTH EDGES OF ITS OWN"). Smoothing the whole canvas costs an integrated chip about 140 ms a
      // frame at a laptop's full density with the city drawn (measured), so each look building is drawn alone into a small target with `samples`
      // samples a pixel, covering only the part of the screen it stands on, and that picture is laid onto the canvas where the building is in
      // front. Used only when the canvas itself is not smoothed. `bigPixels`: a building that covers more pixels than this takes `bigSamples`
      // (its target would otherwise hold 36 bytes for each of them). ?gltfaa=0 turns it off (hard edges, thin lines break up).
      own: { on: OWN_DEFAULT, samples: 4, bigSamples: 2, bigPixels: 2600000, growBy: 128, pad: 2 } },
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
  // ... and, when a row has a `look` file, the app's light and the code that draws with it
  if (GLTF.look.on && GLTF.buildings.some(b => b.look)) for (const src of GLTF.look.scripts) { const t = document.createElement('script'); t.src = src; t.async = false; document.head.appendChild(t); }
})();
