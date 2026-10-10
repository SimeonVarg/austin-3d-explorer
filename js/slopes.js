/**
 * slopes.js — real slopes for a city that only has walls.
 *
 * MapLibre's `fill-extrusion` can only pull a flat footprint straight up, so
 * every slope in this scene is a stack of flat slabs pretending: 4,794 of them
 * stand in for the pitched roofs (data/roofs.geojson), the Capitol dome is 75
 * stacked discs (data/capitol_dome.geojson), and every arch is five flat
 * chords (ARCH_TIERS = 5 in scripts/bake_entrances.py — 448 of the 509 arch
 * features exist only because of it). This file is the layer that replaces
 * them with the real angled surfaces: ONE three.js scene, drawn inside
 * MapLibre's own frame as a `type:'custom', renderingMode:'3d'` layer, so it
 * shares the depth buffer, the sun, the hour, the haze and the render distance
 * with the buildings beside it. Walls stay fill-extrusion.
 *
 * This file is the plumbing — the part that makes a mesh behave exactly like
 * the fill-extrusion building next to it — plus a debug scene (?slopesdebug=1)
 * that proves each piece. The generators are three files beside it, each one
 * shape, each generated from baked data and nothing hand-modelled:
 *
 *   js/slopes-roofs.js    the pitched roofs, from the `rig` foreign member
 *                         scripts/bake_roofs.py writes on roofs.geojson (the
 *                         profile, rays and caps every slab ring was a
 *                         multiply-add on), plus Gregory Gym's gable front
 *   js/slopes-arches.js   every arched doorway, from the `arches` member
 *                         scripts/bake_entrances.py writes on entrances.geojson
 *   js/slopes-dome.js     the Capitol dome, bullock-dome and cupola, lathed
 *                         from their own disc profiles in capitol_dome.geojson
 *
 * Each lands on `slopes.add()` with `slopes.material()` and `slopes.build`,
 * hides the fill-extrusion stand-ins it replaces by FILTER (never by deleting
 * anything) while `SLOPES.on` is true, and puts them back the moment it is
 * false — `slopes.onSwitch()` is the hook. scripts/verify/slopes-layer.mjs
 * asserts all of it from pixels; read its header for the numbers.
 *
 * THE CONTRACT, each line of it measured on this build, not reasoned:
 *
 *   1. WHICH MATRIX. MapLibre 5.24 hands render() three matrices and exactly
 *      one of them takes MercatorCoordinate units: `defaultProjectionData
 *      .mainMatrix`, the one the stack-verdict prototype and MapLibre's own
 *      three.js example use. `args.projectionMatrix` is the camera projection
 *      alone (js/sky.js reads frustum terms off it, and that is all it is good
 *      for). `args.modelViewProjectionMatrix` is NOT in [0..1] mercator units:
 *      fed them, its position columns come out ~1e-8 against a ~4e7
 *      translation and every vertex lands on one sub-pixel point — measured
 *      here on 2026-09-02, all five debug objects projecting to the same
 *      pixel while the frame counter kept climbing. Nothing was drawn and
 *      nothing said so. mainMatrix, or nothing.
 *
 *   2. LOCAL METRES, ONE ORIGIN. Mercator units at this latitude are 2.89e-8
 *      per metre and float32 cannot hold 0.297xxxx to sub-metre precision, so
 *      every vertex is authored in metres east/north/up of ONE shared origin
 *      (SLOPES.origin, the Tower) and the origin's translate+scale rides in
 *      the camera matrix. `slopes.toLocal(lng, lat, up)` goes through
 *      MapLibre's own MercatorCoordinate, so a point lands on the pixel
 *      MapLibre itself would put it on.
 *
 *   3. THE MIRROR, AND WHERE IT MUST LIVE. Mercator (east, south, up) is a
 *      left-handed frame, so the local east/north/up frame maps into it with
 *      one reflection: the -scale on y in the camera matrix below, exactly as
 *      the prototype and MapLibre's own example do. It has to be THERE and not
 *      on a mirrored root Group, and the reason is not abstract handedness —
 *      it is that MapLibre's mercator→clip matrix already carries a reflection
 *      of its own (a scale(1,-1,1) in its chain), so the two cancel and
 *      three.js's default counter-clockwise front faces come out right. Put
 *      the mirror on an object instead and three "helpfully" flips the
 *      winding for that object's negative determinant, which uncancels it:
 *      every front face is culled and you see the inside of the far walls,
 *      unlit. Measured here on 2026-09-02 — a south wall read 135 where
 *      MapLibre's formula gives 153 lit and 135 unlit, to the unit. Up is +Z,
 *      not three's default +Y: rotate anything built around Y
 *      (LatheGeometry, CylinderGeometry) by +90° about X.
 *
 *   4. THE LIGHT IS MAPLIBRE'S, FORMULA AND ALL. The material below is the
 *      fill-extrusion vertex shader's lighting block transcribed from the
 *      served maplibre-gl@5.24.0 bundle — the 0.03 ambient add, the colorvalue
 *      mix, the per-channel floor — fed the SAME evaluated light the painter
 *      reads (`map.style.light.properties`, mid-transition values included).
 *      So a mesh top of colour C beside a fill-extrusion cap of colour C is
 *      the same pixel at every hour by construction, and the verify script
 *      holds it to 2/255. A THREE.DirectionalLight in the scene carries the
 *      same direction and colour for any standard material a later pass might
 *      reach for. The 38° roof shading tilt in js/timeofday.js
 *      (ROOF_SHADE.tilt) is deliberately NOT copied: it exaggerates a slope
 *      that flat slabs cannot show. Real geometry at the real 5:12 pitch
 *      (22.6°) under this light needs no exaggeration.
 *
 *   5. COLOUR BY THE HOUR, ON THE GPU. Every vertex carries its baked
 *      day/golden/night triple (rd/rg/rn, wd/wg/wn — whatever its data has)
 *      and the shader blends them for the hour exactly as timeofday.js's
 *      bakedColor() `interpolate` does, on the same 1/128 grid. A retint is
 *      one uniform write, never a re-upload.
 *
 *   6. DEPTH. MapLibre gives a '3d' custom layer the narrowed depth range it
 *      gives every fill-extrusion ([0, 0.958984] on this build). Nothing here
 *      touches gl.depthRange (three.js never does either) and the material
 *      writes real depth with LEQUAL — so a mesh behind the Tower is hidden by
 *      it, one in front hides it, and js/sky.js's fog ladder, which reads that
 *      same buffer, fogs the mesh for free — provided the layer sits BEFORE
 *      `aerial-fog` in the stack, which is where it is inserted and where the
 *      fog's own styledata re-anchor keeps it.
 *
 *   7. STATE. `renderer.autoClear = false` or three erases the city each
 *      frame; `renderer.resetState()` before every render or three's cached GL
 *      state goes stale under MapLibre's. The renderer is built inside the
 *      FIRST render() rather than in onAdd, because three's constructor
 *      touches GL state and MapLibre only re-syncs its own cache after a
 *      custom layer's render() returns. Never call setSize/setPixelRatio —
 *      MapLibre owns the canvas size (js/graphics.js drives it through
 *      map.setPixelRatio) and resetState() re-reads it every frame.
 *
 *   8. LOD IS PER GROUP, AND THE LAYER NEVER STOPS RENDERING. js/lod.js
 *      hides `roofs-pitched` at altitude with setLayoutProperty, which a
 *      custom layer does not have. MapLibre 5.24 *does* honour `visibility`
 *      on a custom layer — by never calling its render() again — and that is
 *      exactly why lod.js must NOT write it here: this layer's three groups
 *      have three different answers, and render() is where they are given.
 *      THE RULE: each group carries the tier of the fill-extrusion layer it
 *      replaces, and nothing else. The roofs carry `userData.lod = 'mid'`
 *      because that is where `roofs-pitched` is, and go with it. The arches
 *      carry `lod: null` because no tier lists `entrances-portal`. The
 *      Capitol dome carries `lod: null` because a dome is a skyline
 *      silhouette — you look at it from further away, not less — which is
 *      what js/slopes-dome.js's `lod: null` promises. Hide the layer
 *      wholesale and the dome disappears while `SLOPES.on` is still true and
 *      still filtering its 18+7+4 fill-extrusion discs away, so there is no
 *      dome at all — only the drum and the statue's spire, which are not in
 *      the filter. Photographed 2026-09-02 over the Capitol from an eye
 *      altitude of 151 m with the Detail-distance slider at its minimum
 *      (150 m, so the mid tier is down at street level and the dome is 100 px
 *      tall), the same commit with and without this fix and with the layer
 *      off altogether: shots/slopes/dome-lod-bug.png,
 *      shots/slopes/dome-lod-fixed.png, shots/slopes/dome-lod-off.png.
 *      (js/lod.js measures the flight controller's EYE altitude, not the
 *      camera-to-centre distance: the pass's high pose, "1,569 m" in §204, is
 *      1,569 m of camera distance and 900 m of altitude.)
 *
 *      THE CONTRACT, changed here on 2026-09-02 (the old one said the custom
 *      layer's visibility goes 'none'; it does not any more):
 *        - `getLayoutProperty('slopes-mesh','visibility')` is 'visible' at
 *          every altitude — lod.js never writes it.
 *        - `window.LOD_isHidden('slopes-mesh')` is true above the tier's
 *          altitude, and `slopes.layer.isVisible()` is false with it.
 *        - render() still runs; `slopes.stats().groups` is what says which
 *          shapes are drawing (`visible` per group), and `slopes.frames`
 *          keeps climbing.
 *        - The mid groups' pixels go with `roofs-pitched`; the dome's do not.
 *
 * Public (window) API:
 *   SLOPES                         — the taste block; SLOPES.on is the switch
 *                                    (an accessor: setting it fires onSwitch hooks)
 *   slopes.onSwitch(fn)            — fn(on) whenever SLOPES.on changes
 *   slopes.build()                 — a geometry builder (quads, polygons,
 *                                    extrusions in a wall frame), one draw call
 *   slopes.frame(o, t, n)          — a wall frame in local metres from lng/lat
 *   slopes.stats()                 — renderer.info for the last frame, per group
 *   slopes.fetchJSON(url)          — one cached fetch per URL
 *   slopes.toLocal(lng, lat, up)   → {x, y, z} local metres (east, north, up)
 *   slopes.toLngLat(x, y, z)       → {lng, lat, alt}
 *   slopes.project(x, y, z)        → {x, y} CSS pixels on the map canvas, or null
 *   slopes.raycast(px, py)         → nearest hit {point, lngLat, distance, object, face} or null
 *   slopes.material(opts)          — the lit, hour-aware material (shared uniforms)
 *   slopes.colour(geom, triple, wall) — fill a geometry's colour/gradient attributes
 *   slopes.add(obj) / slopes.remove(obj) — put an Object3D in the scene, local metres
 *   slopes.detail()                — 0..1 from the graphics preset (SLOPES.byPreset)
 *   slopes.light()                 — the ENU light vector and colour in use
 *   slopes.scene / root / camera / renderer / layer / origin / frames
 *   applySlopesTime(map, p)        — joined to the applyTimeOfDay wrapper chain
 *   applySlopesSettings(map)       — re-read SLOPES / GFX after a live edit
 *   initSlopes(map)                — self-booting; safe to call again
 */
(function () {
  'use strict';

  const q = new URLSearchParams(window.location.search);

  // ══════════════════════════════════════════════════════════════════════
  //  TASTE BLOCK — CLAUDE.md rule 11. Every value in this file that is a
  //  choice rather than a measurement is here.
  // ══════════════════════════════════════════════════════════════════════
  const SLOPES = {
    // ?slopes=0 leaves the layer out at load, so an A/B is one build rather
    // than two checkouts — the same lever as ?entrances=0 and ?haze=0.
    // `SLOPES.on = false` from the console stops it on the next frame, no
    // reload; it is read live in render(), never cached.
    on: q.get('slopes') !== '0',
    // Default across both rendering paths. ?sunlight=0 is the comparison switch.
    sunlight: {
      on: q.get('sunlight') !== '0',
      ambient: .32, direct: 1.45, glassReflectance: .90, reflectionStrength: 1, sunGlint: 3.0,
      glintPower: 900, haloPower: 24, haloStrength: .10,
      horizonHeight: .45, sunsetSpread: 3, sunsetStrength: 1.5,
      daySun: '#fff8ed', lowSun: '#ffb45f', shade: '#c2cddd',
      dayZenith: '#6396c7', dayHorizon: '#c4d8e5',
      lowZenith: '#6c91b3', lowHorizon: '#a0b6c8', sunset: '#ff963b',
      ground: '#484e51', groundBlend: .08,
      nightFadeStart: 0, nightFadeEnd: -6, warmElevation: 20,
      // How far the atmosphere study's near-horizon colour swings toward its
      // warm `sunset` hue as the sun drops (0..1, on the same `warm` weight the
      // window reflections use). 1 keeps the sky just above the horizon warm at
      // sunset so the golden wash meets a warm horizon, not a cold blue-grey
      // band; 0 restores the old cool horizon. See js/timeofday.js presetAt.
      horizonWarmAtSunset: 1,
      atmosphere: true, skyBlend: .72, saturation: 1.0,
      // shadowSize: texels per side of each of the two sun shadow maps. A phone
      // takes js/mobile.js LITE.budget.shadowSize instead (desktop: no budget,
      // 1536 as before).
      shadows: true, shadowSize: (window.LITE_PROFILE?.budget?.shadowSize) || 1536, shadowRadii: [240, 1400], shadowSnap: 20,
      shadowDistance: 1500, shadowBias: .10, shadowNormalBias: .09,
      // shadowSnap is the NEAR map's grid; shadowSnapFar the far map's (null:
      // the same grid). Each map is redrawn only when ITS snapped centre
      // moves. A turn swings the look-at point round the camera ~10 m per
      // degree, so on a 20 m grid both maps redraw every ~2 degrees of turn.
      // A coarser far grid (?shadowsnapfar=100) cut far-map redraws 10-20 %
      // but gave no fps change that beat run-to-run noise (NVIDIA, 3+3 runs,
      // 2026-09-28), and it moves far-shadow edge pixels in a still frame. So
      // it stays at the near grid, identical to before, until it earns more.
      shadowSnapFar: isFinite(parseFloat(q.get('shadowsnapfar'))) ? parseFloat(q.get('shadowsnapfar')) : 20,
    },
    // ── Turning (TURN-LAG lane, 2026-09-28) ──────────────────────────────
    // precompile: build every scene material's shader program as soon as the
    // material exists (under the veil), instead of on the first frame that
    // draws it. Most of this scene is outside the spawn view, so that first
    // frame was the first TURN: MEASURED one frame of 0.8-1.4 s on the
    // owner's NVIDIA, campus spawn, the first 60 deg/s turn, the main thread
    // waiting on getProgramInfoLog for the big building shader. With
    // KHR_parallel_shader_compile the driver builds it on its own threads.
    // Speed only: the same program three would build on that frame.
    // ?precompile=0 leaves it to the first frame, as before.
    turn: {
      precompile: q.get('precompile') !== '0',
      precompileEveryMs: 1000,   // how often to look for new, unbuilt materials
    },
    surfaces: {on:q.get('surfaces')!=='0', joint:.009, jointShade:.12,
      grain:.035, reflection:.42, near:25, far:120,
      // Brick in mixed tones (a real brick wall is not one colour). Two parts:
      //  brickPatch    each brick gets its own tone; fades when a brick is under a few pixels.
      //                brickPatchCell = the size of one tone block, in bricks along and courses up.
      //  brickMottle   soft light and dark areas about brickMottleSize metres across, which stay
      //                visible from far away (to brickMottleFar[1] metres), as on a real wall.
      // 0 turns a part off. Try values on any page: ?brickpatch=0.5,1,1&brickmottle=0.12,1.6
      brickPatch:(()=>{const v=(q.get('brickpatch')||'').split(',').map(Number);return q.has('brickpatch')&&Number.isFinite(v[0])&&v[0]>=0?Math.min(v[0],1):0.5;})(),
      brickPatchCell:(()=>{const v=(q.get('brickpatch')||'').split(',').map(Number);return v.length===3&&v[1]>0&&v[2]>0?[v[1],v[2]]:[1,1];})(),
      brickMottle:(()=>{const v=(q.get('brickmottle')||'').split(',').map(Number);return q.has('brickmottle')&&Number.isFinite(v[0])&&v[0]>=0?Math.min(v[0],1):0.12;})(),
      brickMottleSize:(()=>{const v=(q.get('brickmottle')||'').split(',').map(Number);return v.length>=2&&v[1]>0?v[1]:1.6;})(),
      brickMottleFar:[250,600],
      grainScale:36,tileVariation:1.5,reflectionBase:.35,skyLow:.7,skyHigh:1.15,horizonLow:-.4,horizonHigh:.6,
      sky:['#7e9fab','#b19b7d','#101922']},
    // Opt-in shallow shop interiors. Shelf/depth dimensions are metres; ceiling
    // lights and shelfTop are room fractions. No mesh or texture per pane.
    // This is a display approximation, not a tenant interior reconstruction.
    weathering: {streakX:12,streakY:.6,broadX:.8,broadY:1.2,darkening:.62,grain:.06,flatStrength:.10},
    storefront: {on:true,depth:3.8,interior:.78,fresnel:.85,shelfPitch:.85,
      shelfThickness:.035,merchWidth:.48,merchHeight:.45,lightPower:.78,
      wall:'#171d1b',floor:'#101311',merch:'#35392e',light:'#e7dfbe',
      sideShade:.68,ceilingShade:.72,lightWidth:.14,lightLength:.62,shelfTop:.55,closedAmbient:.06},
    // ?slopesdebug=1 adds the proof scene (see debugScene below). Nothing
    // debug is ever drawn without it.
    debug: q.get('slopesdebug') === '1',
    // The shared origin, metres east/north/up of which every vertex lives.
    // The Tower: the middle of the campus this layer is for.
    origin: [-97.7393587, 30.2860098],
    // Geometry density per graphics preset, 0..1. The generators read it for
    // lathe and arch segment counts, the way js/roofs.js reads its own
    // byPreset for roof clutter. `detail` overrides it when it is a number.
    byPreset: { performance: 0.5, balanced: 1.0, cinematic: 1.0, ultra: 1.0 },
    detail: null,
    // Where the layer goes: immediately before the depth fog, so the ladder
    // fogs it like a building. The fallback when the fog is not installed yet
    // is the first symbol layer after our buildings — the anchor every
    // fill-extrusion pass in this repo uses.
    layerId: 'slopes-mesh',
    fogLayerId: 'aerial-fog',
    // ── The one taste knob over how the real slopes are LIT ────────────
    // A multiplier on the lit colour of every SLOPED face this layer draws —
    // roof pitches, gable rakes, arch intrados, the dome's curve. Not walls
    // (those have a vertical gradient and must stay pixel-identical to the
    // fill-extrusion wall beside them), not flat decks, not tops.
    //
    // 1.0 is today's look and is bit-exact: the shader multiplies by it, and
    // x * 1.0 == x. It is here because real geometry at the true 5:12 pitch
    // (22.6°) reads LIGHTER and lower-contrast than the flat slabs it
    // replaced, which were painted with js/timeofday.js's ROOF_SHADE.tilt of
    // 38° — an exaggeration invented precisely because a slab cannot slope.
    // Measured at Gregory Gym, morning: a sunlit slope is 175,77,43 as a mesh
    // and was 136,60,31 as slabs. That is not a bug — it is what the light
    // actually does to a 22.6° roof — but it is a LOOK, so it is a one-line
    // edit: set roofShade to 0.78 and the sunlit slope lands back on the
    // slab's tone; below that it goes darker still, above 1.0 brighter.
    roofShade: 1.0,
    // ── The city's own roof shading, on the mesh's sloped faces ─────────
    // js/timeofday.js paints every slab facet between a DARK end (rdd, 0.70 x
    // the roof colour) and a BRIGHT end (rd, 1.28 x — SHADE_LO/SHADE_HI in
    // scripts/bake_roofs.py) from the live sun on a painted 38° tilt
    // (ROOF_SHADE there), because a flat top cannot shade itself. The mesh's
    // real 22.6° under the real light is honest and it is also why Gregory
    // Gym's hall read as one flat orange plate to three blind critics on
    // 2026-09-03: at golden hour its two planes were 74 and 82 luma — eight
    // apart — where the slabs they replaced would have been ~45 % apart. With
    // this on, a sloped face its generator marked `facet` (the roof pitches
    // and the gabled halls; never a wall, a deck, a dome or an arch) takes
    // that same rule — same ambient, same two ends, same tilt — and is lit
    // as the flat top it stands in for, so a mesh roof and the slabs beside
    // it are one look at every hour. `on: false` is the real normal under
    // the real light, as before. The four numbers must match ROOF_SHADE in
    // js/timeofday.js and SHADE_LO/SHADE_HI in scripts/bake_roofs.py.
    facetShade: { on: true, ambient: 0.35, lo: 0.70, hi: 1.28, tilt: 38 },
    // What counts as a SLOPED face for facetShade and roofShade: a face whose
    // normal is more than this many degrees off vertical (walls are excluded
    // separately, by their gradient attribute, and a wall's 0.02 stays in the
    // shader). It was a bare 0.98 in the shader — 11.5° — and Gregory Gym's
    // clerestory monitor, a real gable at 10° (SLOPES_ROOFS.monitorPitch
    // 0.18), fell under it and was lit as the flat top a lid is: its two
    // slopes read 142 and 151 luma to the round-3 critics, "a flat-topped tan
    // rectangular block". Nothing on campus is pitched between 6° and 11.5°
    // except that monitor; the hips are 22.6°, the Capitol's wings 16.7°.
    slopedMinDeg: 6,
    // MapLibre darkens a fill-extrusion wall toward its base
    // (`fill-extrusion-vertical-gradient`, on by default). 1 applies the same
    // curve to mesh WALLS — faces given a gradient attribute by
    // slopes.colour(); roof facets and domes never carry one. 0 turns it off.
    verticalGradient: 1,
    opacity: 1.0,
    // The debug scene's colours, in the data's own day/golden/night shape.
    debugColour: ['#c86464', '#d08a5a', '#2a1c2c'],
    // Debug scene placement, metres from the origin unless it is a lng/lat.
    debugParityAt: [-97.7396, 30.2846],   // the South Mall's west lawn (roofAt 0 there; -97.7399 is inside Parlin Hall)
    debugTwinEast: 22,                    // the fill-extrusion twin, this far east — still on the lawn
    debugCube: 16,                        // parity cube edge
    debugBehind: { north: 110, w: 16, d: 8, h: 50 },   // behind the Tower
    debugFront:  { north: -90, w: 16, d: 8, h: 30 },   // in front of it
    debugFar:    { north: 2500, w: 40, d: 20, h: 120, gap: 60 },  // the haze pair
    debugLatheAt: [-97.7395, 30.2839], debugLatheR: 10, debugLatheH: 9,
    debugLatheSegments: 48,               // × detail(); what the preset changes
  };
  window.SLOPES = SLOPES;

  // ══════════════════════════════════════════════════════════════════════
  //  THE RUST BUILDER SWITCH (?rustbuilder=1) — default OFF
  //  The shared mesh builder (tri / quad / triN / facet, see build()) also exists as a 34 KB WebAssembly module
  //  (experiments/rust-mesh, studied in docs/rust-study-2026-10-09.md) that makes byte-identical buffers.
  //  With the switch OFF nothing below runs: no fetch, no import, no module. With it ON, the apartment builder
  //  (js/slopes-apartments.js asks for it with build(undefined, { wasm: true })) writes into Wasm memory and hands
  //  the finished arrays to three.js as views of that memory. Every other generator keeps the JS builder.
  // ══════════════════════════════════════════════════════════════════════
  // The defaults of the two switches below, and the URL overrides both ways (?rustbuilder=0|1, ?packverts=0|1). `_budget` is the phone profile's budget
  // (js/mobile.js LITE.budget; null on a desktop): only the Rust builder reads it (LITE.budget.rustBuilder, false: the switch is the only way in).
  const PACK_DEFAULT_ON = true;   // packed vertices (?packverts=0 restores the old layout): ON for every tier, desktop included, see the PACKED VERTEX SWITCH block
  const _budget = (window.LITE_PROFILE && window.LITE_PROFILE.budget) || {};
  const switchOf = (name, dflt) => { const v = q.get(name); return v === '1' ? true : v === '0' ? false : !!dflt; };
  const RUST = {
    on: switchOf('rustbuilder', _budget.rustBuilder),
    wasmUrl: 'wasm/meshkernel.wasm',   // the committed build of experiments/rust-mesh (scripts/verify/wasm-mesh-parity.mjs holds it to the source's hash)
    moduleUrl: './slopes-rust.js',     // the JS side of it, imported only when the switch is on (relative to this file)
    stageRecords: 8192,                // builder calls staged in Wasm memory before one process() call
    // A vertex-count hint: the module reserves its buffers once instead of doubling them (the study's 650 MiB
    // linear memory becomes 357 MiB). 0 = no hint. ?rustreserve=6523203 sets it for an A/B run.
    reserveVertices: Math.max(0, Math.floor(Number(q.get('rustreserve')) || 0)),
  };
  let _rustBuild = null;   // set once the module is compiled; null = every builder is the JS one

  // ══════════════════════════════════════════════════════════════════════
  //  THE PACKED VERTEX SWITCH (?packverts=0|1) — default ON (every tier)
  //  The apartment meshes carry 55.7 bytes a vertex; 26 of them are the three colour triples, the facet flag and the surface
  //  quad, which take only 14,719 distinct values over 6.5 M vertices (with the page's real js/city-night.js), and 12 more are
  //  a flat normal that takes 94,312. With the switch ON the builder writes, per vertex, the position (exact, float32) and ONE
  //  32-bit word: an index into a tone table and an index into a normal table, both held in float textures the vertex shader
  //  reads (VERT, PACKED_TONES). Nothing is quantised: the shader gets back exactly the numbers the unpacked layout would have fed it.
  //  scripts/verify/packverts-decode.mjs proves that on the CPU (all 198 buildings, bit for bit), scripts/verify/packverts-pixels.mjs on the screen
  //  (10 of 10 views, software rendering and an RTX 3050 Ti; the day views move 0 pixels).
  //  WHY IT IS ON FOR EVERY TIER. Measured (the pull request that turned it on has the tables):
  //    memory, AWS A10G desktop, min of 5:  GPU upload 367 -> 159 MB, settled JS heap 679 -> 474 MB, browser memory 4,567 -> 3,833 MB, no time or frame cost
  //    memory, AWS L4 phone emulation (mobile-memory.mjs, whole-page memory):  peak 1,195 -> 1,026 MB, settled 806 -> 685 MB
  //    frames, the owner's Intel Iris Plus 655 (vertex-bound: a vertex falls from 50 to 16 bytes), real page, min of 3, p50 at spawn / West Campus / high view:
  //      101.6 / 88.2 / 80.7 ms -> 82.4 / 70.2 / 63.2 ms  (19 to 22% faster; docs/graphics-basics-study-2026-10-10/mac/frame-1.json, branch mac/graphics-basics-study)
  //  FALLBACKS, each tested (scripts/verify/rust-load-fallbacks.mjs, pack-overflow-fallback.mjs): a GPU without WebGL2 or vertex texture units builds the old layout; a
  //  tone or normal table that overflows rebuilds that build unpacked, with one console line; a byte-rule probe that cannot run uses the spec rule (byteFloats).
  //  ?packverts=0 restores the old layout.
  // ══════════════════════════════════════════════════════════════════════
  const PACK = {
    on: switchOf('packverts', PACK_DEFAULT_ON),
    // The word is 32 bits: toneBits of tone index, 1 facet bit, and 31 - toneBits of normal index. MEASURED on the real catalog with the real js/city-night.js
    // (which picks a lit window's tone and brightness per window): 14,719 distinct tones and 94,312 distinct normals, so 14 bits (16,384) and 17 bits (131,072) is the
    // only split that fits, with 10% and 28% to spare. (An earlier 13/18 split was sized from a build with a stand-in night module that makes 1,266 tones, and
    // the real page overflowed it.) A build that overflows either table throws a packOverflow error and js/slopes-apartments.js rebuilds unpacked.
    toneBits: Math.min(15, Math.max(1, Math.floor(Number(q.get('packtonebits'))) || 14)),   // ?packtonebits=N is a TEST seam (a small N makes the tables overflow so the unpacked fallback can be exercised); leave it at 14
    texWidth: 4096,      // width of both tables' float textures, in texels (a tone takes 4 texels in one row, a normal 1)
    normalHash0: 1 << 14, // the normal interner's first hash-table size (it doubles at half full)
  };
  const PACK_TONES = 2 ** PACK.toneBits, PACK_NLOW = 2 ** (15 - PACK.toneBits);

  // ══════════════════════════════════════════════════════════════════════
  //  THE MOIRE FIX (?moirefix=0|1) — default OFF (MOIRE_DEFAULT_ON)
  //  A window grid drawn about once per pixel shimmers: each pixel takes ONE sample of wall or glass. Supersampling would average
  //  them; this does the averaging in the shader instead. js/slopes-apartments.js's cell tiler tells the builder which cells belong
  //  to one wall face (faceOpen / faceCell / faceClose below), the builder keeps that face's MEANS (opaque parts and glass apart,
  //  lit glass apart again, per 0.25 m of wall height and for the whole face), and FRAG blends a cell toward its row's mean as the
  //  window shrinks under MOIRE.px pixels across, and toward the whole face's mean as it shrinks under MOIRE.pxV pixels up the wall.
  //  The means are shaded per CLASS (opaque, unlit glass, lit glass) with the cell shader itself, so glass keeps its sky reflection
  //  and lit windows their glow: the far wall has the brightness of the near wall (scripts/verify/moire-mean.mjs holds the maths,
  //  scripts/verify/moire-bar.mjs measures it on the real page: the `bias` column).
  //  COST. Download: this code. Vertices: none, and no bytes per vertex: a face's number rides in the unused fourth float of the
  //  packed normal table (so the fix needs ?packverts=1, the default). GPU memory: the face table and the row strips (packInfo()).
  //  Vertex shader: one varying. Pixel shader: nothing where windows are larger than MOIRE.px[1] pixels; up to three class shades beyond.
  //  ?moirefix=0: no face is recorded, the define is absent, the buffers and the program are main's.
  // ══════════════════════════════════════════════════════════════════════
  const pair = (name, dflt) => { const v = (q.get(name) || '').split(',').map(Number); return v.length === 2 && v.every(Number.isFinite) && v[1] > v[0] ? v : dflt; };
  // OFF until it has been looked at on the owner's own machines and the exact-pixel checks have been taken through it (?moirefix=1 turns it on).
  // Measured on an NVIDIA L4 it lowers the window part of the error by 36 to 46% and of the flicker by 38 to 49% with Smooth edges off, and makes
  // no view worse; it does not reach the flat-wall floor (the pull request that added it has the table and what is left).
  const MOIRE_DEFAULT_ON = false;
  const MOIRE = {
    on: switchOf('moirefix', MOIRE_DEFAULT_ON),
    // TASTE AND TUNING. Each is one named value; the URL forms are for an A/B on a live page.
    // px: how many pixels ACROSS a wall face's feature length is (see faceClose: two window widths for a window as wide as its pier). Under px[0]
    // a cell is drawn as its row's mean, over px[1] as itself, a smooth blend between. pxV: the same UP the wall, toward the whole face's mean.
    px: pair('moirepx', [1.0, 2.5]),
    pxV: pair('moirepxv', [1.0, 2.5]),
    rowRes: 0.25,                       // metres of wall height per texel of a face's row strip
    // EDGE SMOOTHING OF THE WINDOWS (?moireedge=0|1). The panes of a face stand in rows and columns, so "is there glass here" is the product of two
    // strips, one up the wall and one along it; the builder keeps their running sums, and FRAG reads from them how much of a pixel's footprint is
    // glass. A pixel on a window's edge is then the right mix of wall and glass, with no extra sample (what Smooth edges does with four samples, for windows).
    edge: q.get('moireedge') !== '0',
    edgeRes: 0.1,                       // metres per texel of those two strips (the finest edge they can place; under edgePx texels to a pixel the cell draws itself)
    edgePx: [1.0, 2.0],                 // pixel size in strip texels: no smoothing under [0], full over [1]
    through: 1,                         // 1 = a recessed pane's edge is looked up where the pixel's ray crosses the wall plane (0 = where the pane itself is)
    footprint: Number(q.get('moirefoot')) > 0 ? Number(q.get('moirefoot')) : 1,   // the pixel's size on the wall as a multiple of the measured one (1 = a box of the pixel's own spread)
    parallax: q.get('moireparallax') === '0' ? 0 : 1,   // 1 = a far mean leaves out the glass that the window reveals hide at this view angle
    goldSlope: 0.84,                    // d(golden)/d(day) of a wall tone (js/slopes-apartments.js ramp(): golden = day + 16% toward a warm white)
    mode: 1,                            // runtime (MoireFix.set): 0 off, 1 on, 2 flat (every cell its face's mean: the meter's floor), 3 rows (every cell its row's mean)
    FACE_TEXELS: 12, ROW_W: 2048,       // layout of the tables (float texels per face; width of the strips' textures)
  };
  // THE MOIRE FIX at run time (scripts/verify/moire-bar.mjs flips it inside one page): MoireFix.set('off' | 'on' | 'flat' | 'rows'), or a number.
  // 'off' draws main's picture through the fix's own program; ?moirefix=0 is the switch that also restores main's program and buffers.
  const MOIRE_DEFAULTS = JSON.parse(JSON.stringify(MOIRE));
  window.MoireFix = {
    params: MOIRE,
    /** every live value back to what the page loaded with (a meter flips them between pictures) */
    reset() { for (const k of ['px', 'pxV', 'edgePx']) MOIRE[k] = MOIRE_DEFAULTS[k].slice(); for (const k of ['parallax', 'edge', 'goldSlope', 'footprint', 'through']) MOIRE[k] = MOIRE_DEFAULTS[k]; },
    set(mode) {
      const m = typeof mode === 'number' ? mode : { off: 0, on: 1, flat: 2, rows: 3 }[mode];
      if (!(m >= 0 && m <= 3)) throw new Error('MoireFix.set: off, on, flat or rows');
      MOIRE.mode = m;
      if (window.CityLighting && window.CityLighting.moire) window.CityLighting.moire.mode = m;
      if (_map) _map.triggerRepaint();
      return m;
    },
    info() {
      let faces = 0, bytes = 0, meshes = 0;
      if (root) root.traverse(o => { const pk = o.isMesh && o.geometry && o.geometry.userData.pack; if (pk && !pk._moireSeen) { pk._moireSeen = true; meshes++; faces += pk.nFaces - 1; bytes += pk.faceBytes ? pk.faceBytes() : 0; } });
      if (root) root.traverse(o => { const pk = o.isMesh && o.geometry && o.geometry.userData.pack; if (pk) delete pk._moireSeen; });
      return { on: MOIRE.on, mode: MOIRE.mode, px: MOIRE.px, pxV: MOIRE.pxV, parallax: MOIRE.parallax, faces, tableBytes: bytes, tables: meshes, walls: window.CityLighting && window.CityLighting.moire ? { ...window.CityLighting.moire } : null };
    },
  };
  const RUST_INFO = { on: RUST.on, state: RUST.on ? 'loading' : 'off', compileMs: 0, builds: 0, error: null };
  // The Rust builder broke AFTER it loaded (a trap, an out-of-memory error, a bad instance). Stop using it for good: every
  // build() from here on is the JS builder, whatever the caller asked for. Safe to call twice.
  function rustFallback(e) {
    if (_rustBuild === null && RUST_INFO.state === 'failed') return;
    _rustBuild = null;
    RUST_INFO.state = 'failed'; RUST_INFO.error = String(e && e.message || e); RUST_INFO.fellBack = (RUST_INFO.fellBack || 0) + 1;
    console.warn('[slopes] the Rust builder failed mid-build; building in JS from here on —', RUST_INFO.error);
  }
  /**
   * Run a whole build with the Rust builder, and if (and only if) the Rust builder breaks, throw the half-built result away,
   * switch to the JS builder for good and run the whole build again with it. `run(opts)` must make its builders with
   * `slopes.build(undefined, opts)` (or buildChunked(..., opts)) and must let an error with `rustBuilderError` set (js/slopes-rust.js
   * stamps it, only around calls into the module) out; any other error is the recipe's own and is rethrown untouched.
   * Everything made so far is rebuilt, not patched: the failed instance's memory is not trusted for even the buildings that came
   * before the trap, and the result is then exactly what the JS builder makes (scripts/verify/wasm-mesh-parity.mjs holds that).
   */
  async function withRustFallback(run) {
    try { return await run({ wasm: true }); }
    catch (e) {
      if (!(e && e.rustBuilderError)) throw e;
      rustFallback(e);
      return run({ wasm: false });
    }
  }

  // `SLOPES.on` is an ACCESSOR, so `window.SLOPES.on = false` from the console
  // is still the whole switch — and the generators, which hide fill-extrusion
  // stand-ins by filter while the mesh draws, hear it and put them back. The
  // value is still read live in render(); this only adds the notification.
  const _switchHooks = [];
  (function observable() {
    let v = SLOPES.on;
    Object.defineProperty(SLOPES, 'on', {
      enumerable: true, configurable: true,
      get() { return v; },
      set(x) {
        x = !!x;
        if (x === v) return;
        v = x;
        for (const fn of _switchHooks) { try { fn(v); } catch (e) { console.error('[slopes] switch hook', e); } }
        if (_map) _map.triggerRepaint();
      },
    });
  })();
  function onSwitch(fn) { _switchHooks.push(fn); return fn; }

  // ── The shader: MapLibre's fill-extrusion lighting, transcribed ─────────
  //
  // Read out of the served maplibre-gl@5.24.0 bundle, not from memory. The
  // original (minified names expanded):
  //
  //   float colorvalue = color.r*0.2126 + color.g*0.7152 + color.b*0.0722;
  //   v_color = vec4(0,0,0,1);
  //   vec4 ambientlight = vec4(0.03,0.03,0.03,1.0);  color += ambientlight;
  //   vec3 normalForLighting = normal/16384.0;
  //   float directional = clamp(dot(normalForLighting, u_lightpos), 0.0, 1.0);
  //   directional = mix((1.0-u_lightintensity), max((1.0-colorvalue+u_lightintensity),1.0), directional);
  //   if (normal.y != 0.0) { directional *= ((1.0-u_vertical_gradient)+(u_vertical_gradient*clamp((t+base)*pow(height/150.0,0.5), mix(0.7,0.98,1.0-u_lightintensity),1.0))); }
  //   v_color.rgb += clamp(color.rgb*directional*u_lightcolor, mix(0.0,0.3,1.0-u_lightcolor), 1.0);
  //   v_color *= u_opacity;
  //
  // Three conventions carried across rather than trusted:
  //   - u_lightpos is NOT unit length: MapLibre keeps the light's radial
  //     (1.25 from js/timeofday.js) in it, so it goes in here as-is.
  //   - MapLibre's tile-space wall normals point INWARD on rings geojson-vt
  //     has rewound clockwise (bucket: `(i-s)._perp()`), which is why its
  //     `az += 90` conversion lights a north wall from the north. With OUTWARD
  //     east/north/up normals the same dot product is reached from
  //     (-x, y, z) of MapLibre's evaluated position — see syncLight().
  //   - `normal.y != 0.0` is MapLibre's own quirk: an east- or west-facing
  //     wall never gets the vertical gradient. Kept, because parity with the
  //     wall next door matters more than tidiness.
  const VERT = `
    #ifdef FACADE_FILTER
    varying vec2 v_faceUV;
    #ifdef FACADE_FILTER_ARRAY
    attribute float faceLayer;
    attribute vec2 faceSize;
    varying float v_faceLayer;
    varying vec2 v_faceSize;
    #endif
    #endif
    uniform vec3 u_lightpos;
    uniform vec3 u_lightcolor;
    uniform float u_lightintensity;
    uniform float u_vertical_gradient;
    uniform float u_opacity;
    uniform float u_roof_shade;
    uniform float u_p;
    uniform float u_materialP;
    uniform float u_nightLamps;
    uniform float u_facet_on;
    uniform float u_facet_ambient;
    uniform float u_facet_lo;
    uniform float u_facet_hi;
    uniform float u_facet_sin;
    uniform float u_facet_cos;
    uniform float u_sloped_max_z;
    #ifdef PACKED_TONES
    // ?packverts=1: ONE 32-bit word per vertex (two uint16, read as floats, exact below 2^24) indexes a tone table and a normal table
    // held in float textures. The same cDay / cGold / cNight / aFacet / aSurface / normal values the attributes would have held.
    attribute vec2 aPack;
    uniform sampler2D u_packTones;
    #ifdef MOIRE_FACES
    // highp, and it matters: a sampler without a precision is LOWP in a vertex shader, and on ANGLE's desktop-GL backend (an NVIDIA L4) the
    // fetched value then came back with about eleven bits. A unit normal survives that; a wall face's NUMBER (thousands) lost its low two bits,
    // so every face read a neighbour's record.
    uniform highp sampler2D u_packNormals;
    #else
    uniform sampler2D u_packNormals;
    #endif
    vec3 cDay; vec3 cGold; vec3 cNight; float aFacet; vec4 aSurface; vec3 packedNormal;
    #define normal packedNormal
    #ifdef MOIRE_FACES
    varying float v_faceRaw;   // THE MOIRE FIX: the wall face this cell belongs to (0 = none); the normal table's fourth float
    #endif
    #else
    attribute vec3 cDay;
    attribute vec3 cGold;
    attribute vec3 cNight;
    attribute float aFacet;
    attribute vec4 aSurface;
    #endif
    attribute vec2 aGrad;
    varying vec4 v_color;
    varying vec3 v_pos;
    varying vec3 v_normal;
    varying vec4 v_surface;
    varying vec3 v_albedo;
    varying vec3 v_night;
    void main() {
      #ifdef PACKED_TONES
      {
        float lo = aPack.x, hi = aPack.y;                         // the word, as two exact floats
        float tone = mod(lo, PACK_TONES);                         // low toneBits of lo
        float rest = floor(lo / PACK_TONES);                      // facet bit, then the low bits of the normal index
        aFacet = mod(rest, 2.0);
        float nid = hi * PACK_NLOW + floor(rest * 0.5);
        float tx = tone * 4.0;
        ivec2 t0 = ivec2(int(mod(tx, PACK_TEXW)), int(floor(tx / PACK_TEXW)));
        cDay = texelFetch(u_packTones, t0, 0).rgb;
        cGold = texelFetch(u_packTones, t0 + ivec2(1, 0), 0).rgb;
        cNight = texelFetch(u_packTones, t0 + ivec2(2, 0), 0).rgb;
        aSurface = texelFetch(u_packTones, t0 + ivec2(3, 0), 0);
        vec4 packedN = texelFetch(u_packNormals, ivec2(int(mod(nid, PACK_TEXW)), int(floor(nid / PACK_TEXW))), 0);
        packedNormal = packedN.xyz;
        #ifdef MOIRE_FACES
        v_faceRaw = packedN.w;
        #endif
      }
      #endif
      vec3 color = (u_materialP <= 0.5) ? mix(cDay, cGold, u_materialP * 2.0)
                                : mix(cGold, cNight, (u_materialP - 0.5) * 2.0);
      vec3 n = normalize(normal);
      float az = abs(n.z);
      // "Sloped" = carries no vertical gradient (aGrad.y == 0: roofs, domes,
      // arch soffits — never a wall) AND its normal is neither flat nor vertical.
      bool sloped = (aGrad.y == 0.0 && az > 0.02 && az < u_sloped_max_z);   // SLOPES.slopedMinDeg
      // SLOPES.facetShade — js/timeofday.js's roofFacetColor, transcribed:
      // a facet marked by its generator is coloured between the slabs' dark
      // and bright ends by the live sun on the painted tilt, and then lit as
      // the FLAT TOP it stands in for (the slab's own normal), so it lands on
      // the tone the slab would have. The night colour carries no ends (the
      // slabs' rn has no rnd), so the range closes toward it past golden.
      vec3 nl = n;
      if (u_facet_on > 0.5 && aFacet > 0.5 && sloped) {
        vec3 L = normalize(u_lightpos);
        float sinE = L.z;
        float cosE = length(L.xy);
        vec2 sh = (cosE > 1e-4) ? L.xy / cosE : vec2(0.0, 1.0);
        vec2 nh = normalize(n.xy);
        float d = u_facet_sin * cosE * dot(nh, sh) + u_facet_cos * sinE;
        float A = u_facet_ambient;
        float lit = A + (1.0 - A) * max(0.0, d);
        float flat_ = A + (1.0 - A) * max(0.0, sinE);
        float t = clamp((lit / max(flat_, 1e-4) - u_facet_lo) / (u_facet_hi - u_facet_lo), 0.0, 1.0);
        float m = mix(u_facet_lo, u_facet_hi, t);
        color = (u_materialP <= 0.5) ? mix(cDay, cGold, u_materialP * 2.0) * m
                             : mix(cGold * m, cNight, (u_materialP - 0.5) * 2.0);
        nl = vec3(0.0, 0.0, 1.0);
      }
      float colorvalue = color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
      color += vec3(0.03);
      float directional = clamp(dot(nl, u_lightpos), 0.0, 1.0);
      directional = mix(1.0 - u_lightintensity,
                        max(1.0 - colorvalue + u_lightintensity, 1.0), directional);
      if (aGrad.y > 0.0 && n.y != 0.0) {
        directional *= (1.0 - u_vertical_gradient) + u_vertical_gradient *
          clamp(aGrad.x * sqrt(aGrad.y / 150.0), mix(0.7, 0.98, 1.0 - u_lightintensity), 1.0);
      }
      vec3 lit = clamp(color * directional * u_lightcolor,
                       mix(vec3(0.0), vec3(0.3), vec3(1.0) - u_lightcolor), vec3(1.0));
      // SLOPES.roofShade — the one look knob, applied to sloped faces only.
      // At the default 1.0 this is an exact multiply by one.
      float k = sloped ? u_roof_shade : 1.0;
      v_color = vec4(lit * k, 1.0) * u_opacity;
      #ifdef FACADE_FILTER
      v_faceUV = uv;
      #ifdef FACADE_FILTER_ARRAY
      v_faceLayer=faceLayer; v_faceSize=faceSize;
      #endif
      #endif
      v_pos = position; v_normal = normal; v_surface = aSurface;
      v_albedo = cDay; v_night = cNight;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`;
  /**
   * THE MOIRE FIX in the fragment shader (see MOIRE). Compiled only into a packed material that carries wall faces (MOIRE_FACES),
   * never into the facade-sheet material. `core` and `reflect` are FRAG's own shading text.
   * No screen derivative and no filtered texture read sits inside a branch here (the footprint is measured first, the strips are read
   * with an explicit level, the shadow comes from the cell's own shading), so a compiler may skip the class shades where W is 0.
   */
  function moireGlsl(core, reflect) {
    if (!MOIRE.on) return '';
    const call = 'cityShade(col/max(baseColor.a,.0001),albedo,v_pos,v_normal,glassResponse)';
    if (!core.includes(call)) { console.warn('[slopes] the moire fix cannot find FRAG\'s cityShade call; it is off'); MOIRE.on = false; return ''; }
    // a class shade reuses the visibility the cell's own shading has just measured (js/city-lighting.js cityVisibility): no second shadow read
    const far = core.replace(call, 'cityShadeLit(col/max(baseColor.a,.0001),albedo,v_pos,v_normal,glassResponse,cityVisibility)');
    return `
    #if defined(MOIRE_FACES) && !defined(FACADE_FILTER)
    #define MOIRE_ACTIVE 1
    // The three corners of a triangle carry the same number, so plain interpolation returns it (rounded: it can come back as 99.9999).
    varying float v_faceRaw;
    #define v_face floor(v_faceRaw+0.5)
    uniform highp sampler2D u_moireFaces;
    uniform sampler2D u_moireRowA;
    uniform sampler2D u_moireRowB;
    uniform vec4 u_moire;    // mode (0 off, 1 on, 2 flat, 3 rows) | window pixels across: all mean under .y, itself over .z | reveal parallax
    uniform vec4 u_moireB;   // window pixels up the wall: face mean under .x, rows over .y | golden slope | unused
    uniform vec4 u_moireC;   // edge smoothing on | pixel size in strip texels: none under .y, full over .z | footprint scale
    uniform vec4 u_moireD;   // 1 = look at a recessed pane through its opening | unused
    uniform highp sampler2D u_moireFine;
    // one class of a wall face's mean, shaded as FRAG shades a cell of that tone (no surface detail: it has faded long before a window is this small)
    vec3 moireFar(vec4 baseColor,vec3 albedo,vec3 night,vec4 surface) {
${far}      if(kind>.5&&u_surfaceRange.x>.5&&glazing>.5&&u_sunlight.x<.5) {
        vec3 n=normalize(v_normal),view=normalize(u_eye-v_pos);
        float strength=surface.w;
${reflect}      }
      return col;
    }
    vec4 moireFace(float k) { float i=v_face*float(MOIRE_FACE_TEXELS)+k,y=floor(i/float(MOIRE_TEXW)); return texelFetch(u_moireFaces,ivec2(int(i-y*float(MOIRE_TEXW)),int(y)),0); }
    // VERT's lighting of a wall vertex (no facet, no vertical gradient: the cell tiler's quads carry neither), for a tone that is a mean
    vec4 moireLit(vec3 day,vec3 gold,vec3 dark,vec3 n) {
      vec3 color=(u_materialP<=0.5)?mix(day,gold,u_materialP*2.0):mix(gold,dark,(u_materialP-0.5)*2.0);
      float colorvalue=color.r*0.2126+color.g*0.7152+color.b*0.0722;
      color+=vec3(0.03);
      float directional=clamp(dot(n,u_lightpos),0.0,1.0);
      directional=mix(1.0-u_lightintensity,max(1.0-colorvalue+u_lightintensity,1.0),directional);
      vec3 lit=clamp(color*directional*u_lightcolor,mix(vec3(0.0),vec3(0.3),vec3(1.0)-u_lightcolor),vec3(1.0));
      return vec4(lit,1.0)*u_opacity;
    }
    float moireFine(float i) { float y=floor(i/float(MOIRE_TEXW)); return texelFetch(u_moireFine,ivec2(int(i-y*float(MOIRE_TEXW)),int(y)),0).r; }
    float moireSum(float base,float u) { float k=floor(u),a=moireFine(base+k); return a+(moireFine(base+k+1.0)-a)*(u-k); }
    // the mean of a strip over [c - span, c + span] texels, from its running sums (what lies off the face counts as wall)
    float moireShare(float base,float n,float c,float span) {
      float u0=clamp(c-span,0.0,n-0.0001),u1=clamp(c+span,0.0,n-0.0001);
      return (moireSum(base,u1)-moireSum(base,u0))/(2.0*span);
    }
    vec3 moireBlend(vec3 own,float ownGlass) {
      // the pixel's footprint on the wall, in metres: across (along the wall) and up. Measured before any branch.
      vec3 n=normalize(v_normal);
      vec2 along=normalize(vec2(-n.y,n.x)+vec2(1e-9,0.0));
      float axis=dot(v_pos.xy,along);
      // A square pixel's weight along one wall axis is a trapezoid (two boxes convolved); the box of the same spread is as wide as the
      // gradient is long. (fwidth, |d/dx| + |d/dy|, is the trapezoid's whole base: up to 1.4x too wide, and it blurs.) u_moireC.w scales it.
      float fh=length(vec2(dFdx(axis),dFdy(axis)))*u_moireC.w,fv=length(vec2(dFdx(v_pos.z),dFdy(v_pos.z)))*u_moireC.w;
      if(u_moire.x<0.5||v_face<0.5)return own;
      vec4 r2=moireFace(2.0),r3=moireFace(3.0);
      if(r2.a<=0.0)return own;
      float wh=1.0-smoothstep(u_moire.y,u_moire.z,r2.a/max(fh,1e-6));
      float wv=1.0-smoothstep(u_moireB.x,u_moireB.y,r3.a/max(fv,1e-6));
      if(u_moire.x>2.5){wh=1.0;wv=0.0;}
      else if(u_moire.x>1.5){wh=1.0;wv=1.0;}
      float W=1.0-(1.0-wh)*(1.0-wv);
      // EDGES: how much of this pixel is glass, from the face's two strips (an aligned window grid is their product)
      float cover=ownGlass,edge=0.0;
      vec4 r9=moireFace(9.0);
      if(u_moireC.x>0.5&&W<1.0&&r9.z>0.5) {
        vec4 r10=moireFace(10.0);
        float pz=fv*r10.x,ps=fh*abs(r10.y);                         // the pixel in strip texels, up and along
        edge=smoothstep(u_moireC.y,u_moireC.z,max(pz,ps));
        if(edge>0.0) {
          // a pane stands behind the wall plane: where this pixel's ray crosses the PLANE is where the opening's edge is
          vec3 toEye=normalize(u_eye-v_pos);
          vec2 through=u_moireD.x*ownGlass*moireFace(11.0).y*vec2(dot(toEye.xy,along),toEye.z)/max(abs(dot(toEye,n)),0.05);
          float uz=(v_pos.z+through.y-moireFace(8.0).z)*r10.x,us=(axis+through.x-r10.z)*r10.y;
          cover=clamp(moireShare(r9.y,r9.z,uz,max(0.5*pz,0.5))*moireShare(r9.y+r9.z+1.0,r9.w,us,max(0.5*ps,0.5)),0.0,1.0);
          if(ownGlass<0.5&&cover>0.0) {
            // a wall cell standing where a pane row meets a pane column (above a shorter window): the product claims it, the cell knows better
            float claimed=moireShare(r9.y,r9.z,uz,1.5)*moireShare(r9.y+r9.z+1.0,r9.w,us,1.5);
            cover*=(1.0-smoothstep(0.7,0.95,claimed))*moireFace(11.0).x;
          }
        }
      }
      // which class shades this pixel needs: the wall's for a pane's edge, the glass's for a wall cell's edge, all of them for a far mean
      float needO=(W>0.0||(edge>0.0&&ownGlass>0.5&&cover<1.0))?1.0:0.0;
      float needG=(W>0.0||(edge>0.0&&ownGlass<0.5&&cover>0.0))?1.0:0.0;
      if(needO+needG<=0.0)return own;
      vec4 r0=moireFace(0.0),r1=moireFace(1.0),r4=moireFace(4.0),r5=moireFace(5.0),r6=moireFace(6.0);
      float g=r0.a,L=r1.a;
      vec3 oDay=r0.rgb,oNight=r2.rgb;
      if(W>0.0&&wv<1.0) {
        // THE ROW: what a horizontal line across the face averages to here, over the pixel's own height (four taps of the strip)
        vec4 r8=moireFace(8.0);
        float u=(v_pos.z-r8.z)*r8.w,reach=fv*r8.w;
        float rows=float(textureSize(u_moireRowA,0).y);
        vec4 a=vec4(0.0),b=vec4(0.0);
        for(int i=0;i<4;i++) {
          float x=clamp(u+reach*(float(i)-1.5)*0.25,0.5,r9.x-0.5);
          vec2 at=vec2((r8.x+x)/MOIRE_ROW_W,(r8.y+0.5)/rows);
          a+=textureLod(u_moireRowA,at,0.0);b+=textureLod(u_moireRowB,at,0.0);
        }
        a*=0.25;b*=0.25;
        // rows and face meet in premultiplied form (colour x opaque share), so the blend is the mean of what is there
        vec3 pd=mix(a.rgb,oDay*(1.0-g),wv),pn=mix(b.rgb,oNight*(1.0-g),wv);
        L=mix(b.a,L,wv);g=mix(a.a,g,wv);
        if(g<0.999){oDay=pd/(1.0-g);oNight=pn/(1.0-g);}
      }
      vec3 oGold=clamp(r1.rgb+(oDay-r0.rgb)*u_moireB.z,0.0,1.0);
      float lit=(u_cityNight.x<=0.0&&u_materialP<=0.5)?0.0:clamp(L/max(g,1e-4),0.0,1.0);   // the lit share of the glass; by day a lit pane is a pane
      vec4 glass=vec4(4.0,0.0,0.0,r6.a);
      vec3 O=vec3(0.0),G=vec3(0.0);
      if(needO>0.5)O=moireFar(moireLit(oDay,oGold,oNight,n),oDay,oNight,moireFace(7.0));
      if(needG>0.5) {
        if(lit<1.0)G+=(1.0-lit)*moireFar(moireLit(r3.rgb,r4.rgb,r5.rgb,n),r3.rgb,r5.rgb,glass);
        if(lit>0.0)G+=lit*moireFar(moireLit(r3.rgb,r4.rgb,r6.rgb,n),r3.rgb,r6.rgb,glass);
      }
      vec3 col=own;
      if(edge>0.0)col=mix(own,ownGlass>0.5?mix(O,own,cover):mix(own,G,cover),edge);
      if(W>0.0) {
        // a recessed pane is partly hidden by its own reveal at this angle; the reveal draws itself, so the mean is of what is left
        vec3 view=normalize(u_eye-v_pos);
        float hide=clamp(u_moire.w*(abs(dot(view.xy,along))*r4.a+abs(view.z)*r5.a)/max(abs(dot(view,n)),0.05),0.0,0.9);
        float gs=g*(1.0-hide);
        col=mix(col,mix(O,G,gs/max(1.0-g*hide,1e-4)),W);
      }
      return col;
    }
    #endif
  `;
  }
  // FRAG's shading of a lit tone, in the three pieces THE MOIRE FIX reuses: main() below is these, in this order, exactly as it always was;
  // the fix shades a wall face's mean tones with SHADE_CORE and SHADE_REFLECT again (one text, so the two cannot drift apart).
  const SHADE_CORE = `      vec3 col=baseColor.rgb;
      float kind=surface.x;
      bool shop=kind>5.5&&kind<6.5;
      float glazing=((kind>3.5&&kind<4.5)||shop)?1.0:0.0;
      float glassResponse=glazing*(shop?1.0:clamp(surface.w,0.0,1.0));
      #ifdef FACADE_FILTER
      glazing=gold.a;
      glassResponse=day.a;
      #endif
      col=cityShade(col/max(baseColor.a,.0001),albedo,v_pos,v_normal,glassResponse)*baseColor.a;
      float opaqueWall=(kind<3.5||kind>6.5)?1.0:0.0;
      #ifdef FACADE_FILTER
      opaqueWall=1.0-glazing;
      #endif
      col=mix(col,max(col,albedo*u_nightWallAmbient),u_cityNight.x*opaqueWall);
      col=cityCrown(col,v_pos,v_normal);
      col=cityLocalLight(col,albedo,v_pos,v_normal,glazing);
      #ifdef FACADE_FILTER
      col=cityEmission(col,night,glazing);
      #else
      col=cityEmission(col,night,((kind>3.5&&kind<5.5)||shop)?1.0:0.0);
      #endif
`;
  const SHADE_REFLECT = `          float fresnel=pow(1.0-abs(dot(n,view)),3.0);
          float daylight=1.0-smoothstep(.5,.95,u_p);
          vec3 reflection=u_surfaceSky*mix(u_surfaceHorizon.x,u_surfaceHorizon.y,smoothstep(u_surfaceHorizon.z,u_surfaceHorizon.w,reflect(-view,n).z));
          col=mix(col,reflection,u_surfaceStyle.w*mix(u_surfaceNoise.z,1.0,fresnel)*strength*daylight);
`;
  const SHADE_DETAIL = `      if(kind>.5 && u_surfaceRange.x>.5) {
        vec3 n=normalize(v_normal),view=normalize(u_eye-v_pos);
        float strength=surface.w;
        float nearDetail=1.0-smoothstep(u_surfaceRange.y,u_surfaceRange.z,distance(u_eye,v_pos));
        if(glazing>.5) {
          if(u_sunlight.x<.5) {
${SHADE_REFLECT}          }
          if(shop&&u_shopRoom.y>0.0) {
            // Ray/box intersection exposes side walls and ceiling as the eye
            // moves past. Glass stays opaque in the shared depth buffer.
            vec3 tangent=normalize(vec3(-n.y,n.x,0.0));
            vec2 size=max(surface.yz,vec2(.01));
            vec2 uv=vec2(dot(v_pos,tangent),v_pos.z)/size;
            vec3 p=vec3(fract(uv)-vec2(.5,0.0),0.0);
            vec3 ray=vec3(-dot(view,tangent)/size.x,-view.z/size.y,-max(abs(dot(view,n)),.001));
            vec2 wall=step(vec2(0.0),ray.xy)-vec2(.5,0.0);
            vec2 safeRay=mix(vec2(-1.0),vec2(1.0),step(vec2(0.0),ray.xy))*max(abs(ray.xy),vec2(.000001));
            vec2 t=(wall-p.xy)/safeRay;
            float back=u_shopRoom.x/-ray.z;
            float travel=min(back,min(t.x,t.y));
            vec3 hit=p+ray*travel;
            bool backWall=back<=min(t.x,t.y);
            bool horizontal=t.y<min(back,t.x);
            vec3 room=u_shopWall*(backWall?1.0:u_shopCeiling.x);
            if(horizontal)room=ray.y<0.0?u_shopFloor:u_shopWall*u_shopCeiling.y;
            if(backWall) {
              float row=fract(hit.y*size.y/u_shopRoom.w)*u_shopRoom.w;
              float aa=max(fwidth(row),.001);
              float shelf=1.0-smoothstep(u_shopStyle.x-aa,u_shopStyle.x+aa,row);
              float rack=hit.x*size.x/(u_shopStyle.y*2.0);
              float garment=step(abs(fract(rack)-.5),0.25)*
                step(u_shopStyle.x,row)*step(row,u_shopStyle.z);
              room=mix(room,u_shopMerch,garment*step(hit.y,u_shopShelfTop));
              room=mix(room,u_shopFloor,shelf*step(hit.y,u_shopShelfTop));
            }
            if(horizontal&&ray.y>0.0) {
              float fixture=step(abs(hit.x),u_shopCeiling.z*.5)*
                step(abs(hit.z/u_shopRoom.x+.5),u_shopCeiling.w*.5);
              room=mix(room,u_shopLight*u_shopStyle.w,fixture);
            }
            float lit=smoothstep(u_cityNight.z,u_cityNight.w,dot(night,vec3(.2126,.7152,.0722)));
            room*=mix(1.0,mix(u_shopClosedAmbient,1.0,lit),u_cityNight.x);
            float facing=1.0-u_shopRoom.z*pow(1.0-abs(dot(n,view)),3.0);
            col=mix(col,room,u_shopRoom.y*facing*nearDetail*strength);
          }
        } else if(kind>6.5&&kind<7.5) {
          vec2 uv=abs(n.z)>.65?v_pos.xy:vec2(dot(v_pos.xy,normalize(vec2(-n.y,n.x))),v_pos.z);
          vec2 streakUV=uv*u_weatherScale.xy;
          float resolved=1.0-smoothstep(.25,1.0,max(fwidth(streakUV.x),fwidth(streakUV.y)));
          float streak=mix(.5,surfaceNoise(streakUV),resolved);
          float weatherPatch=surfaceNoise(uv*u_weatherScale.zw);
          float faceWeight=abs(n.z)>.65?u_weatherTone.z:1.0;
          col*=1.0-strength*nearDetail*faceWeight*(u_weatherTone.x*streak*weatherPatch+u_weatherTone.y*weatherPatch);
        } else if(kind<3.5) {
          vec2 uv=abs(n.z)>.65?v_pos.xy:vec2(dot(v_pos.xy,normalize(vec2(-n.y,n.x))),v_pos.z);
          vec2 size=max(surface.yz,vec2(.01));
          vec2 cell=uv/size;
          // Measure the continuous coordinates before the running-bond row
          // offset. Derivatives of floor/fract measure the discontinuity,
          // not the pixel footprint, and make lines crawl at shallow angles.
          vec2 footprint=fwidth(cell);
          float resolved=1.0-smoothstep(.15,.55,max(footprint.x,footprint.y));
          if(kind<2.5)cell.x+=mod(floor(cell.y),2.0)*.5;
          vec2 edge=(.5-abs(fract(cell)-.5))*size;
          vec2 aa=max(fwidth(uv),vec2(.0005));
          vec2 inside=smoothstep(vec2(u_surfaceStyle.x)-aa*.5,vec2(u_surfaceStyle.x)+aa*.5,edge);
          float joint=1.0-inside.x*inside.y;
          float tile=hashCell(floor(cell))-.5;
          float grain=hashCell(floor(uv*u_surfaceNoise.x))-.5;
          float grainFade=1.0-smoothstep(.2,1.0,max(fwidth(uv.x),fwidth(uv.y))*u_surfaceNoise.x);
          // Random tile colours have the same sampling limit as their joints.
          // Previously only the mortar faded, leaving unfiltered colour noise.
          float brickTone=0.0;
          if(kind>1.5&&kind<2.5&&u_brickPatch.x>0.0){
            float toneSeen=1.0-smoothstep(.15,.55,max(footprint.x/u_brickPatch.y,footprint.y/u_brickPatch.z));
            vec2 tc=floor(uv/size/u_brickPatch.yz+vec2(.5*mod(floor(uv.y/size.y/u_brickPatch.z),2.0),0.0));
            brickTone=(fract(sin(dot(tc,vec2(12.9898,78.233))+tc.x*tc.y*.37)*43758.5453)-.5)*u_brickPatch.x*toneSeen;
          }
          col*=1.0+strength*nearDetail*(tile*u_surfaceStyle.z*u_surfaceNoise.y*resolved+grain*u_surfaceStyle.z*grainFade-joint*u_surfaceStyle.y*resolved+brickTone);
          if(kind>1.5&&kind<2.5&&u_brickMottle.x>0.0){
            // soft areas of lighter and darker brick; two sizes so that it does not read as a grid
            float m=surfaceNoise(uv/u_brickMottle.y)*.65+surfaceNoise(uv/(u_brickMottle.y*.37)+7.3)*.35-.5;
            col*=1.0+strength*m*u_brickMottle.x*(1.0-smoothstep(u_brickMottle.z,u_brickMottle.w,distance(u_eye,v_pos)));
          }
        }
      }
`;
  const MOIRE_GLSL = moireGlsl(SHADE_CORE, SHADE_REFLECT);
  const FRAG = `
    #ifdef FACADE_FILTER
    varying vec2 v_faceUV;
    #ifdef FACADE_FILTER_ARRAY
    varying float v_faceLayer;
    varying vec2 v_faceSize;
    uniform highp sampler2DArray u_faceDay;
    uniform highp sampler2DArray u_faceGold;
    uniform highp sampler2DArray u_faceNight;
    #else
    uniform sampler2D u_faceDay;
    uniform sampler2D u_faceGold;
    uniform sampler2D u_faceNight;
    #endif
    uniform vec2 u_faceSize;
    uniform vec2 u_faceFade;
    uniform vec2 u_faceNightFade;
    uniform float u_faceEnabled;
    uniform float u_materialP;
    uniform vec3 u_lightpos;
    uniform vec3 u_lightcolor;
    uniform float u_lightintensity;
    uniform float u_opacity;
    #endif
    varying vec4 v_color;
    varying vec3 v_pos;
    varying vec3 v_normal;
    varying vec4 v_surface;
    varying vec3 v_albedo;
    varying vec3 v_night;
    uniform vec4 u_surfaceStyle;
    uniform vec3 u_surfaceRange;
    uniform vec3 u_surfaceSky;
    uniform vec3 u_surfaceNoise;
    uniform vec3 u_brickPatch;
    uniform vec4 u_brickMottle;
    uniform vec4 u_surfaceHorizon;
    uniform vec4 u_weatherScale;
    uniform vec3 u_weatherTone;
    uniform vec4 u_shopRoom;
    uniform vec4 u_shopStyle;
    uniform vec4 u_shopCeiling;
    uniform float u_shopShelfTop;
    uniform float u_shopClosedAmbient;
    uniform vec3 u_shopWall;
    uniform vec3 u_shopFloor;
    uniform vec3 u_shopMerch;
    uniform vec3 u_shopLight;
    uniform float u_p;
    uniform float u_nightWallAmbient;
    ${window.CityLighting.uniforms}
    #include <packing>
    ${window.CityLighting.glsl}
${window.WallPatterns.glsl}
${window.RoofTiles.glsl}
    float hashCell(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
    float surfaceNoise(vec2 p) {
      vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
      return mix(mix(hashCell(i),hashCell(i+vec2(1,0)),f.x),
        mix(hashCell(i+vec2(0,1)),hashCell(i+vec2(1,1)),f.x),f.y);
    }
${MOIRE_GLSL}
    void main() {
      vec4 baseColor=v_color, surface=v_surface;
      vec3 albedo=v_albedo, night=v_night;
${window.WallPatterns.apply}
${window.RoofTiles.apply}
      float faceMix=1.0;
      #ifdef FACADE_FILTER
      #ifdef FACADE_FILTER_ARRAY
      vec2 footprint=fwidth(v_faceUV*v_faceSize);
      #else
      vec2 footprint=fwidth(v_faceUV*u_faceSize);
      #endif
      faceMix=u_faceEnabled*smoothstep(u_faceFade.x,u_faceFade.y,max(footprint.x,footprint.y));
      faceMix*=1.0-smoothstep(u_faceNightFade.x,u_faceNightFade.y,u_p);
      if(faceMix<=0.0)discard;
      #ifdef FACADE_FILTER_ARRAY
      vec3 faceCoord=vec3(v_faceUV,v_faceLayer);
      vec4 day=texture(u_faceDay,faceCoord);
      vec4 gold=texture(u_faceGold,faceCoord);
      vec4 dark=texture(u_faceNight,faceCoord);
      #else
      vec4 day=texture2D(u_faceDay,v_faceUV);
      vec4 gold=texture2D(u_faceGold,v_faceUV);
      vec4 dark=texture2D(u_faceNight,v_faceUV);
      #endif
      albedo=day.rgb; night=dark.rgb;
      vec3 color=u_materialP<=.5?mix(day.rgb,gold.rgb,u_materialP*2.0):mix(gold.rgb,dark.rgb,(u_materialP-.5)*2.0);
      float value=dot(color,vec3(.2126,.7152,.0722));
      float directional=mix(1.0-u_lightintensity,max(1.0-value+u_lightintensity,1.0),clamp(dot(normalize(v_normal),u_lightpos),0.0,1.0));
      baseColor=vec4(clamp((color+vec3(.03))*directional*u_lightcolor,mix(vec3(0),vec3(.3),vec3(1)-u_lightcolor),vec3(1)),1)*u_opacity;
      surface=vec4(0);
      #endif
${SHADE_CORE}${SHADE_DETAIL}      #ifdef MOIRE_ACTIVE
      col=moireBlend(col,glazing);
      #endif
      gl_FragColor=vec4(col,baseColor.a*faceMix);
    }`;

  // ── State ───────────────────────────────────────────────────────────────
  let _map = null, _gl = null;
  let scene = null, root = null, camera = null, renderer = null, dirLight = null;
  let U = null;                 // the shared uniforms, built once THREE exists
  let originMerc = null, originScale = 0;
  let _visible = true;          // js/lod.js's decision, via layer.setVisible
  let _lastPreset = null;
  let _frames = 0, _warnedMatrix = false;
  let _sunShadow = null;

  function releaseSunShadows() {
    if(!_sunShadow)return;
    _sunShadow.targets.forEach(t=>t.dispose());_sunShadow.depth.dispose();_sunShadow=null;
    if(U){U.u_sunShadow0.value=null;U.u_sunShadow1.value=null;U.u_shadowSettings.value.x=0;}
  }

  // The viewport and scissor box as the shared context last set them, so the
  // shadow pass can put them back without asking: gl.getParameter(VIEWPORT)
  // and (SCISSOR_BOX) are synchronous round trips to the GPU process, 354-420 ms
  // per 12 s on the owner's AMD chip (window.GLSTATE in js/graphics.js has the
  // measurement and the switches: ?glstate=0 queries as before, ?glstatecheck=1
  // counts disagreements). gl.viewport/gl.scissor are wrapped once per context,
  // pass straight through, and record the call as GL stores it: ints as WebIDL
  // converts them, a negative size ignored (an error that changes nothing), a
  // viewport clamped to MAX_VIEWPORT_DIMS. Seeded with one query each, and again
  // after a lost context. null with GLSTATE off.
  function viewState(gl) {
    const GS=window.GLSTATE;
    if(!GS||!GS.on)return null;
    let S=gl.__vpState;
    if(!S) {
      S=gl.__vpState={known:false,viewport:null,scissor:null,max:null};
      const wrap=(name,rec)=>{const native=gl[name];gl[name]=function(x,y,w,h){const r=native.apply(this,arguments);rec(x|0,y|0,w|0,h|0);return r;};};
      wrap('viewport',(x,y,w,h)=>{if(w>=0&&h>=0&&S.max)S.viewport=[x,y,Math.min(w,S.max[0]),Math.min(h,S.max[1])];});
      wrap('scissor',(x,y,w,h)=>{if(w>=0&&h>=0)S.scissor=[x,y,w,h];});
      gl.canvas.addEventListener('webglcontextlost',()=>{S.known=false;});
    }
    if(!S.known&&!gl.isContextLost()) {
      S.max=Array.from(gl.getParameter(gl.MAX_VIEWPORT_DIMS)||[]);
      S.viewport=Array.from(gl.getParameter(gl.VIEWPORT)||[]);
      S.scissor=Array.from(gl.getParameter(gl.SCISSOR_BOX)||[]);
      S.known=!gl.isContextLost()&&S.max.length===2&&S.viewport.length===4&&S.scissor.length===4;
    }
    return S.known?S:null;
  }

  function updateSunShadows() {
    const s=SLOPES.sunlight,T=window.THREE;
    U.u_shadowSettings.value.x=0;
    const gl=renderer?.getContext();
    if(!gl||gl.isContextLost())return;
    if(!s.on||!s.shadows||window.GFX?.shadows===false||U.u_sunDirection.value.z<=0||!window.slopesApartments?.count.done)return;
    // No new per-frame scene traversal or geometry. Render the existing mesh
    // scene from the sun only when the hour or completed building set changes.
    if(_sunShadow&&_sunShadow.size!==s.shadowSize)releaseSunShadows();
    if(!_sunShadow) {
      const targets=[0,1].map(()=>new T.WebGLRenderTarget(s.shadowSize,s.shadowSize,{minFilter:T.NearestFilter,magFilter:T.NearestFilter,depthBuffer:true,stencilBuffer:false}));
      const depth=new T.ShaderMaterial({
        vertexShader:'varying float v_depth; void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);v_depth=gl_Position.z/gl_Position.w*.5+.5;}',
        fragmentShader:'#include <packing>\nvarying float v_depth; void main(){gl_FragColor=packDepthToRGBA(v_depth);}',
        side:T.DoubleSide,blending:T.NoBlending,depthTest:true,depthWrite:true,
      });
      const cameras=s.shadowRadii.map(r=>new T.OrthographicCamera(-r,r,r,-r,1,s.shadowDistance*2));
      _sunShadow={targets,depth,cameras,keys:[null,null],size:s.shadowSize,updates:0,mapRenders:0};
      U.u_sunShadow0.value=targets[0].texture;U.u_sunShadow1.value=targets[1].texture;
    }
    const look=toLocal(_map.getCenter().lng,_map.getCenter().lat,30);
    // Each map on its own grid (shadowSnap near, shadowSnapFar far) and its
    // own key: a map is redrawn when its snapped centre or anything common to
    // both changes, not when only the other map's centre moved.
    const centres=[0,1].map(i=>{
      const g=i===1&&s.shadowSnapFar!=null?s.shadowSnapFar:s.shadowSnap;
      return {x:Math.round(look.x/g)*g,y:Math.round(look.y/g)*g,z:look.z,g};
    });
    const proxy=window.CityLighting.shadowProxy(_map);
    const common=[U.u_p.value,window.slopesApartments?.count.triangles,window.slopesApartments?.count.done,s.shadowRadii.join(','),s.shadowDistance,proxy?.uuid,root.children.map(g=>`${g.uuid}:${g.visible}`).join(',')].join('|');
    const keys=centres.map(c=>common+'|'+c.g+'|'+c.x+'|'+c.y);
    const stale=[0,1].filter(i=>_sunShadow.keys[i]!==keys[i]);
    if(stale.length) {
      const target=renderer.getRenderTarget(),override=scene.overrideMaterial;
      // MapLibre owns canvas sizing. Three's default viewport is stale unless
      // explicitly restored after leaving an offscreen target (setSize is
      // intentionally forbidden in this shared canvas).
      const V=viewState(gl),GS=window.GLSTATE;
      if(V&&GS.check){GS.verify(gl,'shadow.viewport',gl.VIEWPORT,V.viewport);GS.verify(gl,'shadow.scissor',gl.SCISSOR_BOX,V.scissor);}
      const viewport=V?V.viewport.slice():gl.getParameter(gl.VIEWPORT);
      const scissor=V?V.scissor.slice():gl.getParameter(gl.SCISSOR_BOX),scissorTest=gl.isEnabled(gl.SCISSOR_TEST);
      if(!viewport||!scissor)return; // loss can occur during a GL state query
      const clear=renderer.getClearColor(new T.Color()),alpha=renderer.getClearAlpha();
      // Filtering changes coverage, not the building's shadow geometry.
      const filtered=(window.slopesApartments?.group?.children||[]).filter(o=>o.userData?.disposeFacade&&o.visible);
      for(const o of filtered)o.visible=false;
      try {
        scene.overrideMaterial=_sunShadow.depth;
        if(proxy){scene.add(proxy);proxy.visible=true;}
        renderer.setClearColor(0xffffff,1);
        for(const i of stale) {
          const c=centres[i],cam=_sunShadow.cameras[i],radius=s.shadowRadii[i];
          cam.left=cam.bottom=-radius;cam.right=cam.top=radius;
          cam.far=s.shadowDistance*2;cam.updateProjectionMatrix();
          cam.up.set(0,0,1);
          cam.position.set(c.x,c.y,c.z).addScaledVector(U.u_sunDirection.value,s.shadowDistance);
          cam.lookAt(c.x,c.y,c.z);cam.updateMatrixWorld(true);
          U[i===0?'u_sunShadowMatrix0':'u_sunShadowMatrix1'].value.multiplyMatrices(cam.projectionMatrix,cam.matrixWorldInverse);
          renderer.setRenderTarget(_sunShadow.targets[i]);renderer.clear();renderer.render(scene,cam);
          _sunShadow.keys[i]=keys[i];_sunShadow.mapRenders++;
        }
        _sunShadow.updates++;
      } finally {
        for(const o of filtered)o.visible=true;
        if(proxy){scene.remove(proxy);proxy.visible=false;}
        scene.overrideMaterial=override;renderer.setRenderTarget(target);renderer.setClearColor(clear,alpha);
        renderer.setViewport(...viewport);renderer.setScissor(...scissor);renderer.setScissorTest(scissorTest);
      }
    }
    U.u_shadowSettings.value.set(1,1/s.shadowSize,s.shadowBias/(s.shadowDistance*2-1),s.shadowNormalBias);
  }

  // ── Shader programs built before the frame that first needs them ────────
  // SLOPES.turn.precompile (header there). Every precompileEveryMs, any scene
  // material three has not built a program for yet is handed to
  // renderer.compile() with this scene's own lights, fog and camera, i.e. the
  // program key the next render would compute. Only the missing ones: an
  // object stand-in walks just those meshes, so the materials already built
  // are not re-keyed every second. A program the driver has finished
  // (isReady, KHR_parallel_shader_compile) has its one-time setup -- the
  // uniform and attribute tables three reads on first use -- done here too,
  // on a still frame, rather than on the first frame of a turn.
  const _pc = { next: 0, pending: new Set(), compiled: 0, warmed: 0, materials: 0, ms: 0 };
  function precompileTick() {
    const P = SLOPES.turn;
    if (!P.precompile || !renderer || !scene || !camera) return;
    const t = performance.now();
    if (t < _pc.next) return;
    _pc.next = t + P.precompileEveryMs;
    try {
      for (const p of _pc.pending) if (p.isReady()) { p.getUniforms(); p.getAttributes(); _pc.pending.delete(p); _pc.warmed++; }
      const missing = [];
      scene.traverse(o => {
        const m = o.material; if (!m) return;
        for (const x of Array.isArray(m) ? m : [m]) if (!renderer.properties.get(x).currentProgram) { missing.push(o); return; }
      });
      if (missing.length) {
        const subset = { traverse: fn => { for (const o of missing) fn(o); }, traverseVisible() {} };
        for (const m of renderer.compile(subset, camera, scene)) {
          const p = renderer.properties.get(m).currentProgram;
          if (p && !p.__slopesPrecompiled) { p.__slopesPrecompiled = true; _pc.pending.add(p); _pc.compiled++; }
          _pc.materials++;
        }
      }
    } catch (e) {
      // A failure here only means the program is built on first draw, as before.
      P.precompile = false; console.warn('[slopes] precompile disabled: ' + e.message);
    }
    _pc.ms += performance.now() - t;
  }

  let _mat = null, _loc = null, _s3 = null, _eye4=null;   // per-frame scratch
  let _debugGroup = null, _debugTwinAdded = false;
  const _light = { enu: [0, 0, 1], colour: [1, 1, 1], intensity: 0 };

  const clamp01 = v => Math.max(0, Math.min(1, v));
  const hexToRgb01 = hex => {
    const h = String(hex).replace('#', '');
    return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255,
            parseInt(h.slice(4, 6), 16) / 255];
  };

  function haveThree() { return !!(window.THREE && window.THREE.WebGLRenderer); }

  /** 0..1 geometry density for the current preset (SLOPES.detail wins). */
  function detail() {
    if (typeof SLOPES.detail === 'number') return clamp01(SLOPES.detail);
    const g = window.GFX;
    const pre = (g && g.preset) || 'balanced';
    return SLOPES.byPreset[pre] != null ? SLOPES.byPreset[pre] : 1.0;
  }

  // ── Coordinates ─────────────────────────────────────────────────────────
  function toLocal(lng, lat, up) {
    const m = maplibregl.MercatorCoordinate.fromLngLat({ lng, lat }, up || 0);
    return { x: (m.x - originMerc.x) / originScale,
             y: -(m.y - originMerc.y) / originScale,
             z: (m.z - originMerc.z) / originScale };
  }
  function toLngLat(x, y, z) {
    const m = new maplibregl.MercatorCoordinate(originMerc.x + x * originScale,
                                                originMerc.y - y * originScale,
                                                originMerc.z + (z || 0) * originScale);
    const ll = m.toLngLat();
    return { lng: ll.lng, lat: ll.lat, alt: m.toAltitude() };
  }
  /** Local metres → CSS pixels on the map canvas, through the frame's own matrix. */
  function project(x, y, z) {
    if (!camera || !_frames || !_map) return null;
    const T = window.THREE;
    const v = new T.Vector4(x, y, z || 0, 1).applyMatrix4(camera.projectionMatrix);
    if (v.w <= 0) return null;
    const cv = _map.getCanvas();
    return { x: (v.x / v.w * 0.5 + 0.5) * cv.clientWidth,
             y: (0.5 - v.y / v.w * 0.5) * cv.clientHeight, w: v.w };
  }
  /**
   * Screen point → nearest mesh hit. A helper only: there is no tap-to-select
   * feature in this app (js/app.js's one hit-test is the landmark signs), so
   * nothing is wired to this. `THREE.Raycaster.setFromCamera` refuses a bare
   * THREE.Camera, so the ray is unprojected by hand through the inverse of
   * the frame's matrix, which render() keeps current.
   */
  function raycast(px, py) {
    if (!root || !camera || !_frames || !_map) return null;
    const T = window.THREE;
    const cv = _map.getCanvas();
    const nx = (px / cv.clientWidth) * 2 - 1, ny = 1 - (py / cv.clientHeight) * 2;
    const inv = camera.projectionMatrixInverse;
    const a = new T.Vector3(nx, ny, -1).applyMatrix4(inv);
    const b = new T.Vector3(nx, ny, 1).applyMatrix4(inv);
    const dir = b.clone().sub(a).normalize();
    const rc = new T.Raycaster(a, dir);
    const hits = rc.intersectObjects(root.children, true);
    if (!hits.length) return null;
    const h = hits[0];
    const point = { x: h.point.x, y: h.point.y, z: h.point.z };
    return { point, lngLat: toLngLat(point.x, point.y, point.z),
             distance: h.distance, object: h.object, face: h.face };
  }

  // ── ?packverts=1: the two tables a packed vertex word indexes ───────────────────────────────
  /**
   * Interns tones and flat normals as a builder (or several chunks of one) emits them, and hands back the 32-bit vertex word:
   * low 16 bits = tone index (toneBits) | facet bit | low bits of the normal index; high 16 bits = the rest of the normal index.
   * The tables are plain typed arrays until material() turns them into two float textures.
   */
  /**
   * What THIS GPU turns a normalised UNSIGNED_BYTE attribute into, for every byte 0..255. The unpacked layout hands the shader its colours as such
   * attributes, so the GPU does the byte-to-float conversion; the packed layout reads them from a float table and must hold the very numbers the GPU
   * would have produced. The GL spec says c / 255, but an implementation may compute c * (1 / 255) instead, and the two differ by one float32 ulp for 126
   * of the 256 bytes. That is invisible until a shader compares the colour with a threshold (the night windows do), when one pixel in a thousand flips: the
   * 0.05% of two night views that the first pixel check found. So the table is built from a measurement: an offscreen WebGL2 context, a transform-feedback
   * draw of the 256 bytes as normalised attributes, read back. Without WebGL (Node) it is c / 255 in float32, the spec.
   */
  let _byteFloats = null;
  function byteFloats() {
    if (_byteFloats) return _byteFloats;
    const f = new Float32Array(256); for (let c = 0; c < 256; c++) f[c] = c / 255;
    let how = 'untested';
    try {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (gl) {
        const sh = (type, src) => { const x = gl.createShader(type); gl.shaderSource(x, src); gl.compileShader(x); return x; };
        const pr = gl.createProgram();
        gl.attachShader(pr, sh(gl.VERTEX_SHADER, '#version 300 es\nin vec4 a; out vec4 o; void main() { o = a; gl_Position = vec4(0.0, 0.0, 0.0, 1.0); }'));
        gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, '#version 300 es\nprecision mediump float; out vec4 c; void main() { c = vec4(0.0); }'));
        gl.transformFeedbackVaryings(pr, ['o'], gl.INTERLEAVED_ATTRIBS); gl.linkProgram(pr);
        if (gl.getProgramParameter(pr, gl.LINK_STATUS)) {
          const bytes = new Uint8Array(256 * 4); for (let c = 0; c < 256; c++) bytes[c * 4] = c;
          const vb = gl.createBuffer(), tb = gl.createBuffer(), tf = gl.createTransformFeedback();
          gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, bytes, gl.STATIC_DRAW);
          gl.useProgram(pr); const loc = gl.getAttribLocation(pr, 'a'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 4, gl.UNSIGNED_BYTE, true, 4, 0);
          gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, tb); gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER, 256 * 16, gl.STATIC_READ);
          gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, tf); gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, tb);
          gl.enable(gl.RASTERIZER_DISCARD); gl.beginTransformFeedback(gl.POINTS); gl.drawArrays(gl.POINTS, 0, 256); gl.endTransformFeedback(); gl.disable(gl.RASTERIZER_DISCARD);
          const out = new Float32Array(256 * 4); gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER, 0, out);
          const m = new Float32Array(256); for (let c = 0; c < 256; c++) m[c] = out[c * 4];
          if (!gl.getError() && m[0] === 0 && m[255] === 1) {   // a sane read-back; anything else keeps the spec values
            let div = 0, rec = 0; const inv = Math.fround(1 / 255);
            for (let c = 0; c < 256; c++) { if (m[c] === Math.fround(c / 255)) div++; if (m[c] === Math.fround(c * inv)) rec++; }
            how = div === 256 ? 'divide' : rec === 256 ? 'reciprocal' : 'other';
            f.set(m);
          }
        }
        const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
      }
    } catch (e) { how = 'untested'; }
    _byteFloats = f; _byteFloats.how = how;
    return f;
  }
  function packOverflow(what, limit, faces) {
    const e = new Error('[slopes] ?packverts=1: more than ' + limit + ' distinct ' + what + ' (PACK.toneBits)');
    e.packOverflow = true;   // js/slopes-apartments.js lets this out of its per-building catch and rebuilds unpacked
    e.moireFaces = !!faces;  // ...or, when it was a wall face's normal that did not fit, packed again without the moire fix's faces
    return e;
  }
  // what makes two palette entries ONE tone: the text of their hex colours and surface numbers (js/slopes-rust.js uses the same key)
  const toneKey = col => col[0] + '|' + col[1] + '|' + col[2] + (col.surface ? '|' + col.surface[0] + ',' + col.surface[1] + ',' + col.surface[2] + ',' + col.surface[3] : '');
  function vertexTables() {
    const T = {
      tones: new Float32Array(4 * 4 * 1024), nTones: 0,       // 4 RGBA texels per tone: day.rgb, golden.rgb, night.rgb, surface.xyzw
      normals: new Float32Array(4 * 4096), nNormals: 0,        // 1 RGBA texel per normal: nx, ny, nz, 0
      nbits: null,                                             // the same bytes as Uint32 (compare and hash by bits)
      toneOf: new Map(), toneByObject: new WeakMap(),
      hash: new Int32Array(PACK.normalHash0).fill(-1),          // open addressing: normal index, or -1
      tex: null,
    };
    T.nbits = new Uint32Array(T.normals.buffer);
    const f32 = new Float32Array(3), u32 = new Uint32Array(f32.buffer);
    // `d` is the face number a wall cell's normal carries (THE MOIRE FIX; 0 = none, and then this is the hash it always was)
    const hashOf = (a, b, c, d) => {
      let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35) ^ Math.imul(c ^ 0x165667b1, 0x27d4eb2f) ^ Math.imul(d, 0x2545f491);
      h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); return h ^ (h >>> 12);
    };
    const byte = h => { const f = hexToRgb01(h); return [Math.round(f[0] * 255), Math.round(f[1] * 255), Math.round(f[2] * 255)]; };
    /** the tone index of a [day, golden, night] palette entry (with optional .surface); the same array object is looked up once */
    T.tone = col => {
      let id = T.toneByObject.get(col);
      if (id !== undefined) return id;
      const key = toneKey(col);
      id = T.toneOf.get(key);
      if (id === undefined) {
        if (T.nTones >= PACK_TONES) throw packOverflow('tones', PACK_TONES);
        id = T.nTones++;
        if (id * 16 + 16 > T.tones.length) { const g = new Float32Array(T.tones.length * 2); g.set(T.tones); T.tones = g; }
        const d = byte(col[0]), g = byte(col[1]), n = byte(col[2]), s = col.surface, o = id * 16;
        // what this GPU makes of a normalised UNSIGNED_BYTE attribute (byteFloats above), so the shader gets the very numbers the unpacked layout gives it
        const bf = byteFloats();
        for (let k = 0; k < 3; k++) { T.tones[o + k] = bf[d[k]]; T.tones[o + 4 + k] = bf[g[k]]; T.tones[o + 8 + k] = bf[n[k]]; }
        if (s) { T.tones[o + 12] = s[0]; T.tones[o + 13] = s[1]; T.tones[o + 14] = s[2]; T.tones[o + 15] = s[3]; }
        T.toneOf.set(key, id);
      }
      T.toneByObject.set(col, id);
      return id;
    };
    /** the normal index of (x, y, z), by the exact float32 bits (so -0 and +0 stay distinct and nothing is merged that was not equal) */
    T.normal = (x, y, z, face) => {
      f32[0] = x; f32[1] = y; f32[2] = z;
      const a = u32[0], b = u32[1], c = u32[2], d = face | 0;
      const mask = T.hash.length - 1, nb = T.nbits, nf = T.normals;
      let i = hashOf(a, b, c, d) & mask;
      for (;;) {
        const id = T.hash[i];
        if (id < 0) break;
        const o = id * 4;
        if (nb[o] === a && nb[o + 1] === b && nb[o + 2] === c && nf[o + 3] === d) return id;
        i = (i + 1) & mask;
      }
      if (T.nNormals >= 2 ** (31 - PACK.toneBits)) throw packOverflow(d ? 'normals (with the moire fix\'s wall faces)' : 'normals', 2 ** (31 - PACK.toneBits), !!d);
      const id = T.nNormals++;
      if (id * 4 + 4 > T.normals.length) { const g = new Float32Array(T.normals.length * 2); g.set(T.normals); T.normals = g; T.nbits = new Uint32Array(g.buffer); }
      T.normals[id * 4] = x; T.normals[id * 4 + 1] = y; T.normals[id * 4 + 2] = z; T.normals[id * 4 + 3] = d;
      T.hash[i] = id;
      if (T.nNormals * 2 > T.hash.length) {            // keep the table at most half full
        const nh = new Int32Array(T.hash.length * 2).fill(-1), m2 = nh.length - 1, nb2 = T.nbits, nf2 = T.normals;
        for (let id2 = 0; id2 < T.nNormals; id2++) {
          const o = id2 * 4;
          let j = hashOf(nb2[o], nb2[o + 1], nb2[o + 2], nf2[o + 3]) & m2; while (nh[j] >= 0) j = (j + 1) & m2; nh[j] = id2;
        }
        T.hash = nh;
      }
      return id;
    };
    moireFaces(T);
    /** [lo, hi] of the 32-bit word for a vertex: tone id, facet flag (0/1) and normal id */
    T.wordLo = (tone, facet, nid) => (tone | (facet << PACK.toneBits) | ((nid % PACK_NLOW) << (PACK.toneBits + 1))) >>> 0;
    T.wordHi = nid => Math.floor(nid / PACK_NLOW);
    T.bytes = () => T.nTones * 64 + T.nNormals * 16;
    return T;
  }
  /**
   * THE MOIRE FIX's two tables on a VertexTables: one record per wall face (T.faces, MOIRE.FACE_TEXELS float texels each) and
   * that face's ROW STRIP (T.rowA / T.rowB, one texel per MOIRE.rowRes of wall height: what a horizontal line across the face
   * averages to). A caller opens a face, reports every cell it draws on it, and closes it:
   *   id = T.faceOpen(z0, z1)                         0 when the fix is off: then nothing is recorded and no vertex carries a face
   *   T.faceCell(za, zb, width, tone, glass, lit, fw, fh, reveal)   one rectangle of the face, `width` metres along the wall; `glass` = it is a
   *                                                   window pane (shaded as glass), `lit` = a lit one at night; fw x fh = the size of the
   *                                                   feature it belongs to (a window's own width and height); a NEGATIVE width takes area
   *                                                   back (a mullion laid over a pane reports itself, and the pane it covers with -width)
   *   T.faceClose()                                   works the means out and writes them
   * Record, texel by texel (rgb, a):  0 opaque day, glass share g | 1 opaque golden, lit-glass share L | 2 opaque night, feature width |
   *   3 glass day, feature height | 4 glass golden, reveal hide factor across | 5 unlit glass night, reveal hide factor up |
   *   6 lit glass night (mean), glass reflection response | 7 the main opaque tone's surface (4 floats) | 8 strip x, strip y, z0, texels per metre | 9 strip length
   * Strip texel:  A = opaque day colour x (1 - g_row), g_row ;  B = opaque night colour x (1 - g_row), lit-glass share of the row.
   * Colours are the tones' own 8-bit values / 255 (the space the frame buffer and a supersampled picture average in: FRAG's shading is
   * linear in a tone within a class, see scripts/verify/moire-mean.mjs).
   */
  function moireFaces(T) {
    const FT = MOIRE.FACE_TEXELS * 4, RW = MOIRE.ROW_W;
    T.nFaces = 1; T.faces = null; T.rowA = null; T.rowB = null; T.rowX = 0; T.rowY = 0;   // face 0 = "no face"; arrays made on the first face
    T.fine = null; T.nFine = 0;                                                            // the edge strips' running sums, one float each
    const bytes = new Map();
    const b3 = hex => { let c = bytes.get(hex); if (!c) { const f = hexToRgb01(hex); c = [Math.round(f[0] * 255), Math.round(f[1] * 255), Math.round(f[2] * 255)]; bytes.set(hex, c); } return c; };
    let F = null;
    T.faceOpen = (z0, z1, len, origin, along, outward) => {
      if (!MOIRE.on || T.facesOff || !(z1 > z0)) return 0;
      const n = Math.max(1, Math.ceil((z1 - z0) / MOIRE.rowRes - 1e-6));
      if (n > RW || T.nFaces >= 65535) return 0;
      if (T.rowX + n > RW) { T.rowX = 0; T.rowY++; }
      // the edge strips: nz texels up the wall, ns along it. `origin` is the wall point at s = 0, `along` and `outward` the frame's two vectors.
      let E = null;
      if (MOIRE.edge && len > 0 && origin && along && outward) {
        // FRAG's `along` is the cell's own normal turned a quarter, and that normal is exactly square to the wall. So the axis here is the wall's
        // own direction (never `outward` turned: a frame's two vectors are a hundredth of a degree off square, and at 700 m from the origin that
        // is most of a metre of s), signed the way FRAG's comes out.
        const tl = Math.hypot(along[0], along[1]) || 1, sg = (along[0] * -outward[1] + along[1] * outward[0]) < 0 ? -1 : 1, ax = sg * along[0] / tl, ay = sg * along[1] / tl;
        const dot = sg * tl;                                                                               // metres of FRAG's axis per unit of s (signed)
        const nz = Math.max(1, Math.ceil((z1 - z0) / MOIRE.edgeRes - 1e-6)), ns = Math.max(1, Math.ceil(len * Math.abs(dot) / MOIRE.edgeRes - 1e-6));
        if (nz + ns < 60000) E = { nz, ns, len, s0: origin[0] * ax + origin[1] * ay, dot, rz: new Uint8Array(nz * 8), cs: new Uint8Array(ns * 8), area: 0 };   // eight marks a texel
      }
      F = { id: T.nFaces++, z0, z1, zw: origin && Number.isFinite(origin[2]) ? origin[2] : z0, n, inv: n / (z1 - z0), x: T.rowX, y: T.rowY, E,
        o: new Float64Array(10), g: new Float64Array(16), tones: [], fa: 0, sw: 0, sh: 0, rvv: 0, rvd: 0,   // sums, see faceCell
        rO: new Float64Array(n * 3), rN: new Float64Array(n * 3), rG: new Float64Array(n), rL: new Float64Array(n), rW: new Float64Array(n) };
      T.rowX += n;
      return F.id;
    };
    T.faceCell = (sa, sb, za, zb, col, glass, lit, fw, fh, rv, takeBack) => {
      if (!F || !(zb > za) || !(sb > sa)) return;
      const w = takeBack ? sa - sb : sb - sa;
      const area = w * (zb - za), d = b3(col[0]), gd = b3(col[1]), nt = b3(col[2]), o = F.o, g = F.g;
      // the edge strips: glass height per column and glass width per row, spread over the texels the pane covers
      const E = F.E;
      if (E && glass && !takeBack) {                   // (a bar laid over a pane is drawn by its own cell; the strips keep the pane whole)
        const z0u = Math.round((za - F.z0) / (F.z1 - F.z0) * E.nz * 8), z1u = Math.round((zb - F.z0) / (F.z1 - F.z0) * E.nz * 8), s0u = Math.round(sa / E.len * E.ns * 8), s1u = Math.round(sb / E.len * E.ns * 8);
        if (z1u > z0u && s1u > s0u) { E.rz.fill(1, Math.max(0, z0u), Math.min(E.nz * 8, z1u)); E.cs.fill(1, Math.max(0, s0u), Math.min(E.ns * 8, s1u)); E.area += (z1u - z0u) * (s1u - s0u); }
      }
      if (glass) {
        g[0] += area; g[1] += area * d[0]; g[2] += area * d[1]; g[3] += area * d[2]; g[4] += area * gd[0]; g[5] += area * gd[1]; g[6] += area * gd[2];
        const k = lit ? 10 : 7; g[k] += area * nt[0]; g[k + 1] += area * nt[1]; g[k + 2] += area * nt[2];
        if (lit) g[13] += area;
        const sf = col.surface;
        g[14] += area * (sf ? (sf[0] === 6 ? 1 : Math.min(1, Math.max(0, sf[3]))) : 0);
        if (w > 0 && fw > 0 && fh > 0) { F.fa += area; F.sw += area * fw; F.sh += area * fh; if (rv > 0) { g[15] += area * rv / fw; F.rvv += area * rv / fh; F.rvd += area * rv; } }
      } else {
        o[0] += area; o[1] += area * d[0]; o[2] += area * d[1]; o[3] += area * d[2]; o[4] += area * gd[0]; o[5] += area * gd[1]; o[6] += area * gd[2];
        o[7] += area * nt[0]; o[8] += area * nt[1]; o[9] += area * nt[2];
        if (col.surface && col.surface[0] >= 100) F.pattern = true;   // a wall-pattern material (js/wall-patterns.js) takes its colours from the pattern table, not from this tone
        if (w > 0) {                                   // which opaque tone is the wall (the largest), and how big the others' cells are
          let t = null; const ts = F.tones;
          for (let i = 0; i < ts.length; i++) if (ts[i].col === col) { t = ts[i]; break; }
          if (!t) { if (ts.length < 12) ts.push(t = { col, area: 0, sw: 0, sh: 0 }); else t = ts[11]; }
          t.area += area; t.sw += area * (fw || w); t.sh += area * (fh || (zb - za));
        }
      }
      // the row strip: this rectangle's width, spread over the texels its height covers
      const u0 = (za - F.z0) * F.inv, u1 = (zb - F.z0) * F.inv;
      for (let k = Math.max(0, Math.floor(u0)), ke = Math.min(F.n, Math.ceil(u1)); k < ke; k++) {
        const ov = (Math.min(u1, k + 1) - Math.max(u0, k)) * w;
        if (ov === 0) continue;
        F.rW[k] += ov;
        if (glass) { F.rG[k] += ov; if (lit) F.rL[k] += ov; }
        else { F.rO[k * 3] += ov * d[0]; F.rO[k * 3 + 1] += ov * d[1]; F.rO[k * 3 + 2] += ov * d[2]; F.rN[k * 3] += ov * nt[0]; F.rN[k * 3 + 1] += ov * nt[1]; F.rN[k * 3 + 2] += ov * nt[2]; }
      }
    };
    T.faceClose = () => {
      const f = F; F = null;
      if (!f) return;
      const o = f.o, g = f.g, oA = o[0], gA = g[0], tot = oA + gA, R = f.id * FT;
      if (!T.faces || R + FT > T.faces.length) { const a = new Float32Array(Math.max(FT * 256, (T.faces ? T.faces.length : 0) * 2, R + FT)); if (T.faces) a.set(T.faces); T.faces = a; }
      const need = (f.y + 1) * RW * 4;
      if (!T.rowA || need > T.rowA.length) { const len = Math.max(RW * 4 * 8, (T.rowA ? T.rowA.length : 0) * 2, need); const a = new Uint8Array(len), b = new Uint8Array(len); if (T.rowA) { a.set(T.rowA); b.set(T.rowB); } T.rowA = a; T.rowB = b; }
      const W = T.faces;
      if (!(tot > 1e-9) || f.pattern) return;           // nothing was drawn on it, or its wall is a pattern material (which filters itself): the record stays zero and FRAG leaves the face alone
      const lA = g[13], uA = gA - lA, i255 = 1 / 255;
      const mean = (sum, k, area) => area > 1e-9 ? sum[k] / area * i255 : 0;
      // opaque means (day, golden, night), glass means (day, golden; night apart for unlit and lit panes)
      const oD = [mean(o, 1, oA), mean(o, 2, oA), mean(o, 3, oA)], oG = [mean(o, 4, oA), mean(o, 5, oA), mean(o, 6, oA)];
      const oN = [mean(o, 7, oA), mean(o, 8, oA), mean(o, 9, oA)];
      // FEATURE SIZE: the windows when the face has any, else the cells of every opaque tone but the largest (a panel pattern)
      let fwH = 0, fwV = 0;
      let wall = null; for (const t of f.tones) if (!wall || t.area > wall.area) wall = t;
      if (gA > 1e-9 && f.fa > 1e-9) {
        const ww = f.sw / f.fa, wh = f.sh / f.fa;
        let rows = 0, share = 0; for (let k = 0; k < f.n; k++) if (f.rG[k] > 1e-9 && f.rW[k] > 1e-9) { rows++; share += f.rG[k] / f.rW[k]; }
        const fH = rows ? share / rows : 1, fV = rows / f.n;
        // window a, pier b, period a + b. One sample per pixel is off by about f / (2 (a + b)) of the contrast (f = the pixel on the wall), the flat
        // mean by 2ab / (a + b)^2: the mean is the better picture once f passes 4ab / (a + b). That length is the "feature" FRAG compares the pixel with
        // (two window widths when window and pier are equal; four pier widths when the piers are thin).
        const gapH = fH < 0.999 ? ww * (1 - fH) / Math.max(fH, 1e-3) : ww, gapV = fV < 0.999 ? wh * (1 - fV) / Math.max(fV, 1e-3) : wh;
        fwH = 4 * ww * gapH / (ww + gapH); fwV = 4 * wh * gapV / (wh + gapV);
      } else if (f.tones.length > 1) {
        let a = 0, sw = 0, sh = 0; for (const t of f.tones) if (t !== wall) { a += t.area; sw += t.sw; sh += t.sh; }
        if (a > 1e-9) { fwH = 2 * sw / a; fwV = 2 * sh / a; }
      }
      if (!(fwH > 0) || !(fwV > 0)) return;             // one tone: nothing to average
      const sf = (wall && wall.col.surface) || [0, 0, 0, 0];
      const put = (t, r, gch, b, a) => { const i = R + t * 4; W[i] = r; W[i + 1] = gch; W[i + 2] = b; W[i + 3] = a; };
      put(0, oD[0], oD[1], oD[2], gA / tot);
      put(1, oG[0], oG[1], oG[2], lA / tot);
      put(2, oN[0], oN[1], oN[2], Math.max(0.05, fwH));
      put(3, mean(g, 1, gA), mean(g, 2, gA), mean(g, 3, gA), Math.max(0.05, fwV));
      put(4, mean(g, 4, gA), mean(g, 5, gA), mean(g, 6, gA), gA > 1e-9 ? g[15] / gA : 0);
      put(5, mean(g, 7, uA), mean(g, 8, uA), mean(g, 9, uA), gA > 1e-9 ? f.rvv / gA : 0);
      put(6, mean(g, 10, lA), mean(g, 11, lA), mean(g, 12, lA), gA > 1e-9 ? g[14] / gA : 0);
      put(7, sf[0], sf[1], sf[2], sf[3]);
      put(8, f.x, f.y, f.zw, f.inv);                    // the strip's place, the height the face's foot is DRAWN at, texels per metre
      put(9, f.n, 0, 0, 0);
      // THE EDGE STRIPS. R(z) = 1 where some pane stands at that height, C(s) = 1 where some pane stands at that place along the wall (the share of
      // each texel that is so). For windows in an aligned grid the glass is exactly R(z) C(s); where windows of two sizes share a face the product
      // also claims the wall above the shorter one, which FRAG knows is wall (its own cell says so) and leaves alone. Stored as RUNNING SUMS, so
      // FRAG gets the mean over any pixel footprint from two reads. `claimed` = real pane area / the product's area (1 for a true grid).
      const E = f.E;
      if (E && gA > 1e-9 && E.area > 0) {
        const H = f.z1 - f.z0, base = T.nFine, need = base + E.nz + E.ns + 2;
        if (!T.fine || need > T.fine.length) { const a = new Float32Array(Math.max(1 << 16, (T.fine ? T.fine.length : 0) * 2, need)); if (T.fine) a.set(T.fine); T.fine = a; }
        const run = (marks, n, at) => { let acc = 0; T.fine[at] = 0; for (let k = 0, m = 0; k < n; k++) { let c = 0; for (let j = 0; j < 8; j++) c += marks[m++]; acc += c / 8; T.fine[at + k + 1] = acc; } return acc; };
        const sz = run(E.rz, E.nz, base), ss = run(E.cs, E.ns, base + E.nz + 1);
        T.nFine = need;
        put(9, f.n, base, E.nz, E.ns);
        put(10, E.nz / H, E.ns / (E.len * E.dot), E.s0, 0);   // texels per metre up; texels per metre of FRAG's axis (signed); the axis value at s = 0
        put(11, Math.min(1, E.area / 64 / Math.max(1e-9, sz * ss)), f.rvd / gA, 0, 0);   // claimed (see above); the panes' mean recess in metres (FRAG looks at a pane THROUGH its opening)
        T.nAligned = (T.nAligned || 0) + 1;
      }
      // the strip. A texel no cell reached (a face under a raking cut) takes the face's own means.
      const A = T.rowA, B = T.rowB, base = (f.y * RW + f.x) * 4, by = v => Math.max(0, Math.min(255, Math.round(v)));
      for (let k = 0; k < f.n; k++) {
        const w = f.rW[k], i = base + k * 4;
        if (w > 1e-9) {
          A[i] = by(f.rO[k * 3] / w); A[i + 1] = by(f.rO[k * 3 + 1] / w); A[i + 2] = by(f.rO[k * 3 + 2] / w); A[i + 3] = by(255 * f.rG[k] / w);
          B[i] = by(f.rN[k * 3] / w); B[i + 1] = by(f.rN[k * 3 + 1] / w); B[i + 2] = by(f.rN[k * 3 + 2] / w); B[i + 3] = by(255 * f.rL[k] / w);
        } else {
          const q = oA / tot * 255;
          A[i] = by(oD[0] * q); A[i + 1] = by(oD[1] * q); A[i + 2] = by(oD[2] * q); A[i + 3] = by(255 * gA / tot);
          B[i] = by(oN[0] * q); B[i + 1] = by(oN[1] * q); B[i + 2] = by(oN[2] * q); B[i + 3] = by(255 * lA / tot);
        }
      }
    };
    T.faceBytes = () => (T.faces ? T.nFaces * FT * 4 : 0) + (T.rowA ? (T.rowY + 1) * RW * 8 : 0) + T.nFine * 4;
  }
  /** a new VertexTables if ?packverts=1 is on and the renderer can run the packed program, else null */
  function packTables() {
    if (!PACK.on) return null;
    const c = renderer && renderer.capabilities;
    if (c && !(c.isWebGL2 && c.maxVertexTextures >= 2)) return null;
    return vertexTables();
  }
  /** the uniforms and defines of the packed-vertex program for these tables (the textures are made once and kept) */
  function packedMaterialParts(tables) {
    const T = window.THREE, W = PACK.texWidth;
    if (!tables.tex) {
      const tex = (data, count, perRow) => {
        const rows = Math.max(1, Math.ceil(count / perRow));
        const a = new Float32Array(rows * W * 4); a.set(data.subarray(0, Math.min(data.length, a.length)));
        const t = new T.DataTexture(a, W, rows, T.RGBAFormat, T.FloatType);
        t.minFilter = t.magFilter = T.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true;
        return t;
      };
      tables.tex = { tones: tex(tables.tones, tables.nTones * 4, W), normals: tex(tables.normals, tables.nNormals, W) };
      // THE MOIRE FIX: the face records (float texels, fetched by number) and the two row strips (bytes, filtered along the strip)
      if (tables.nFaces > 1 && tables.faces && tables.rowA) {
        const rows = tables.rowY + 1, RW = MOIRE.ROW_W;
        const strip = data => { const t = new T.DataTexture(data.subarray(0, rows * RW * 4), RW, rows, T.RGBAFormat, T.UnsignedByteType);
          t.minFilter = t.magFilter = T.LinearFilter; t.generateMipmaps = false; t.needsUpdate = true; return t; };
        tables.tex.faces = tex(tables.faces, tables.nFaces * MOIRE.FACE_TEXELS, W);
        tables.tex.rowA = strip(tables.rowA); tables.tex.rowB = strip(tables.rowB);
        // the edge strips' running sums: one float a texel, read by index (never filtered)
        const fr = Math.max(1, Math.ceil(Math.max(1, tables.nFine) / W)), fd = new Float32Array(fr * W);
        if (tables.fine) fd.set(tables.fine.subarray(0, tables.nFine));
        tables.tex.fine = new T.DataTexture(fd, W, fr, T.RedFormat, T.FloatType);
        tables.tex.fine.minFilter = tables.tex.fine.magFilter = T.NearestFilter; tables.tex.fine.generateMipmaps = false; tables.tex.fine.needsUpdate = true;
      }
    }
    const parts = {
      uniforms: { u_packTones: { value: tables.tex.tones }, u_packNormals: { value: tables.tex.normals } },
      defines: { PACKED_TONES: 1, PACK_TONES: PACK_TONES.toFixed(1), PACK_NLOW: PACK_NLOW.toFixed(1), PACK_TEXW: W.toFixed(1) },
    };
    if (tables.tex.faces) {
      Object.assign(parts.uniforms, { u_moireFaces: { value: tables.tex.faces }, u_moireRowA: { value: tables.tex.rowA }, u_moireRowB: { value: tables.tex.rowB }, u_moireFine: { value: tables.tex.fine } });
      Object.assign(parts.defines, { MOIRE_FACES: 1, MOIRE_TEXW: W, MOIRE_FACE_TEXELS: MOIRE.FACE_TEXELS, MOIRE_ROW_W: MOIRE.ROW_W.toFixed(1) });
    }
    return parts;
  }

  // ── Materials and geometry helpers ──────────────────────────────────────
  function material(opts) {
    if (!U) throw new Error('[slopes] material() before initSlopes — three.js not ready');
    const T = window.THREE;
    const o = opts || {};
    // o.pack (the VertexTables a ?packverts=1 build filled): the packed-vertex program. Its two tables are textures of THIS material;
    // every other uniform is still the shared U (the object holders are shared, so one hour, one sun still holds).
    const packed = o.pack ? packedMaterialParts(o.pack) : null;
    const mat = new T.ShaderMaterial({
      uniforms: packed ? { ...U, ...packed.uniforms } : U,   // U SHARED, deliberately: one hour, one sun, every mesh
      defines: packed ? packed.defines : undefined,
      vertexShader: VERT, fragmentShader: FRAG,
      side: o.side != null ? o.side : T.FrontSide,
      depthTest: true, depthWrite: true, transparent: false, blending: T.NoBlending,
    });
    window.WallPatterns.attach(mat);
    window.RoofTiles?.sync(mat.uniforms);
    if (packed) mat.addEventListener('dispose', () => { const t = o.pack.tex; o.pack.tex = null; if (t) { for (const k in t) t[k].dispose(); } });
    // Builder meshes have no wall gradient. A constant vertex attribute is
    // exactly the old all-zero buffer, without eight CPU/GPU bytes per vertex.
    // colour() still supplies an attribute for meshes that need a gradient.
    mat.defaultAttributeValues.aGrad = [0, 0];
    return mat;
  }
  // Continuous, filtered wall overlay. Close geometry remains the depth
  // source; projected metres per pixel select the representation per fragment.
  function facadeMaterial(face, tune) {
    const T=window.THREE;
    const mat = new T.ShaderMaterial({
      defines:face.faces?{FACADE_FILTER:1,FACADE_FILTER_ARRAY:1}:{FACADE_FILTER:1},
      uniforms:{...U,
        u_faceDay:{value:face.textures.day},u_faceGold:{value:face.textures.gold},u_faceNight:{value:face.textures.night},
        u_faceSize:{value:new T.Vector2(face.len||1,face.faces?1:face.z1-face.z0)},
        u_faceFade:{value:new T.Vector2(tune.fadeStart,tune.fadeEnd)},
        u_faceNightFade:{value:new T.Vector2(tune.nightFadeStart,tune.nightFadeEnd)},u_faceEnabled:{value:1}},
      vertexShader:VERT,fragmentShader:FRAG,side:T.FrontSide,
      transparent:true,depthTest:true,depthWrite:false,
      polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1
    });
    mat.defaultAttributeValues.aGrad = [0, 0];
    return mat;
  }
  /**
   * Fill `geom`'s per-vertex colour triple and, for walls, the gradient
   * attribute. `triple` = [day, golden, night] hex; `wall` = {base, top} in
   * metres (the extrusion's own base and top, the way MapLibre sees them) or
   * omitted for roof facets and domes, which never darken toward a base.
   */
  function colour(geom, triple, wall) {
    const T = window.THREE;
    const n = geom.attributes.position.count;
    const pos = geom.attributes.position;
    const d = hexToRgb01(triple[0]), g = hexToRgb01(triple[1]), k = hexToRgb01(triple[2]);
    const cd = new Float32Array(n * 3), cg = new Float32Array(n * 3), cn = new Float32Array(n * 3);
    const gr = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      cd[i * 3] = d[0]; cd[i * 3 + 1] = d[1]; cd[i * 3 + 2] = d[2];
      cg[i * 3] = g[0]; cg[i * 3 + 1] = g[1]; cg[i * 3 + 2] = g[2];
      cn[i * 3] = k[0]; cn[i * 3 + 1] = k[1]; cn[i * 3 + 2] = k[2];
      if (wall) {
        // t is 0 on the base ring and 1 on the top ring in MapLibre's shader;
        // it then adds the base HEIGHT to it and scales by the top. Copied.
        const t = pos.getZ(i) > wall.base + 1e-4 ? 1 : 0;
        gr[i * 2] = t + Math.max(0, wall.base);
        gr[i * 2 + 1] = Math.max(0, wall.top);
      }
    }
    geom.setAttribute('cDay', new T.BufferAttribute(cd, 3));
    geom.setAttribute('cGold', new T.BufferAttribute(cg, 3));
    geom.setAttribute('cNight', new T.BufferAttribute(cn, 3));
    geom.setAttribute('aGrad', new T.BufferAttribute(gr, 2));
    geom.setAttribute('aFacet', new T.BufferAttribute(new Float32Array(n), 1));   // never a roof facet
    geom.setAttribute('aSurface', new T.BufferAttribute(new Float32Array(n*4), 4));
    return geom;
  }
  // A phone drops each mesh's CPU copy once three.js has uploaded it (js/mobile.js
  // LITE.budget.freeGeometryCpu; ~260 MB for the authored buildings). The copy
  // only matters for a re-upload after a lost WebGL context, and a phone
  // recovers from that by reloading; nothing reads it after add() (raycast()
  // above is an unwired helper). onUpload is three's own hook for exactly this.
  // Bounding spheres are computed before the first upload and kept. Desktop
  // (no budget) keeps every copy, so it can re-upload in place after a loss.
  const FREE_CPU = !!(window.LITE_PROFILE && window.LITE_PROFILE.budget && window.LITE_PROFILE.budget.freeGeometryCpu);
  function dropArray() { this.array = null; }
  function freeOnUpload(obj) {
    obj.traverse(o => {
      const g = o.geometry;
      if (!g || !g.isBufferGeometry) return;
      if (!g.boundingSphere && g.attributes.position) g.computeBoundingSphere();
      for (const k in g.attributes) { const a = g.attributes[k]; if (a && a.isBufferAttribute && typeof a.onUpload === 'function') a.onUpload(dropArray); }
      if (g.index && typeof g.index.onUpload === 'function') g.index.onUpload(dropArray);
    });
  }
  function add(obj) { if (FREE_CPU && obj && obj.traverse) freeOnUpload(obj); if (root) root.add(obj); if (_map) _map.triggerRepaint(); return obj; }
  function remove(obj) { if (root) root.remove(obj); if (_map) _map.triggerRepaint(); }

  /**
   * polygon() and extrude(): the two shape operations of a builder, written once over a builder's own tri / triN / quad
   * so the JS vertex store below and the Rust one (js/slopes-rust.js, ?rustbuilder=1) share every line of them and cannot
   * drift. They hold no state; the vertex store is the only thing the two builders do differently.
   */
  function shapeOps(tri, triN, quad) {
    /** A planar polygon, any orientation; triangulated in the given plane. */
    function polygon(pts, col, want, plane) {
      if (pts.length < 3) return;
      const T2 = window.THREE;
      const flat = pts.map(p => plane === 'uz' ? new T2.Vector2(p[3], p[2]) : new T2.Vector2(p[0], p[1]));
      let idx;
      try { idx = T2.ShapeUtils.triangulateShape(flat, []); } catch (e) { idx = []; }
      for (const [i, j, k] of idx) tri(pts[i], pts[j], pts[k], col, want);
    }
    /**
     * `poly` is [[u, z], ...] in the frame's wall plane (any winding), `frame`
     * is from slopes.frame(). Sweeps it from depth v0 to v1 along the frame's
     * normal and emits a closed solid: cap at v1 facing +n, cap at v0 facing
     * -n, one quad per edge facing that edge's outward direction. `opts.sides`
     * = false skips the side quads (a face that sits against a wall).
     * `opts.smooth` (true, or a crease angle in degrees; default 40) gives the
     * side faces per-vertex normals averaged across each polygon vertex whose
     * corner is shallower than the crease, so a curve — an archivolt's
     * extrados, a fanlight's edge — shades continuously instead of as a
     * necklace of flat facets ("faint corners at close range", the critics,
     * 2026-09-03). A real corner keeps its two flat faces.
     */
    function extrude(poly, frame, v0, v1, col, opts) {
      opts = opts || {};
      const P = (u, v, z) => frame.at(u, v, z);
      const N = frame.N, nn = [-N[0], -N[1], -N[2]];
      const n = poly.length;
      if (n < 3) return;
      // signed area in (u, z): CCW > 0 — so every edge's outward normal below is (dz, -du)
      let A = 0;
      for (let i = 0; i < n; i++) { const p = poly[i], q = poly[(i + 1) % n]; A += p[0] * q[1] - q[0] * p[1]; }
      const ccw = A > 0 ? 1 : -1;
      if (opts.front !== false) {
        const cap = poly.map(p => { const q = P(p[0], v1, p[1]); return [q[0], q[1], q[2], p[0]]; });
        polygon(cap, col, N, 'uz');
      }
      if (opts.back !== false) {
        const cap = poly.map(p => { const q = P(p[0], v0, p[1]); return [q[0], q[1], q[2], p[0]]; });
        polygon(cap, col, nn, 'uz');
      }
      if (opts.sides !== false) {
        // each edge's outward unit normal in (u, z), and — for opts.smooth —
        // each vertex's, averaged across the corner when it is shallower
        // than the crease angle
        const en = [];
        for (let i = 0; i < n; i++) {
          const p = poly[i], q = poly[(i + 1) % n];
          const du = q[0] - p[0], dz = q[1] - p[1], L = Math.hypot(du, dz) || 1;
          en.push([ccw * dz / L, -ccw * du / L]);
        }
        const creaseCos = opts.smooth ? Math.cos((typeof opts.smooth === 'number' ? opts.smooth : 40) * Math.PI / 180) : 2;
        const vn = i => {
          const a = en[(i - 1 + n) % n], b = en[i];
          if (a[0] * b[0] + a[1] * b[1] < creaseCos) return null;
          const s = [a[0] + b[0], a[1] + b[1]], L = Math.hypot(s[0], s[1]) || 1;
          return [s[0] / L, s[1] / L];
        };
        const to3 = m => { const v = [frame.T[0] * m[0], frame.T[1] * m[0], m[1]]; const L = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / L, v[1] / L, v[2] / L]; };
        for (let i = 0; i < n; i++) {
          const p = poly[i], q = poly[(i + 1) % n], j = (i + 1) % n;
          const du = q[0] - p[0], dz = q[1] - p[1];
          if (Math.hypot(du, dz) < 1e-6) continue;
          // outward in (u, z) for the polygon's own winding, mapped to 3-D
          const ou = ccw * dz, oz = -ccw * du;
          const want = [frame.T[0] * ou, frame.T[1] * ou, oz];
          if (opts.skipDown && oz < -0.9 * Math.hypot(ou, oz)) continue;   // a bottom face on a sill
          const p0 = P(p[0], v0, p[1]), p1 = P(q[0], v0, q[1]), p2 = P(q[0], v1, q[1]), p3 = P(p[0], v1, p[1]);
          if (opts.smooth) {
            const na = to3(vn(i) || en[i]), nb = to3(vn(j) || en[i]);
            triN(p0, p1, p2, na, nb, nb, col); triN(p0, p2, p3, na, nb, na, col);
          } else {
            quad(p0, p1, p2, p3, col, want);
          }
        }
      }
    }
    return { polygon, extrude };
  }

  // ── The builder: one geometry, one draw call, flat normals ──────────────
  //
  // Every generator emits triangles into one of these per material group and
  // gets back a single non-indexed BufferGeometry carrying position, normal
  // and the colour triple — merged by construction, so a campus of roofs is
  // one draw call and the dome another. Faces are flat-shaded (the normal is
  // the face's own), which is what MapLibre gives an extrusion's wall and what
  // a hip, a pediment and an archivolt want; the lathe computes smooth
  // normals itself and does not come through here.
  //
  //   b.tri(a, b, c, col, want)         a triangle; `want` (optional) is the
  //                                      side it must face — the order is
  //                                      flipped if the winding disagrees
  //   b.quad(a, b, c, d, col, want)     two triangles, split a-c
  //   b.polygon(pts, col, want, plane)  a planar polygon (earcut), `plane` =
  //                                      'xy' | 'uz' picks the 2-D projection
  //   b.extrude(poly2d, frame, v0, v1, col, opts)
  //                                      a polygon in a wall's (u, z) plane
  //                                      swept from depth v0 to v1: front,
  //                                      back and every side, faces outward
  //                                      (opts.smooth: curved sides shade
  //                                      continuously — see extrude)
  //   b.facet(bool)                     mark what follows as roof facets for
  //                                      SLOPES.facetShade (roof pitches only)
  //   b.geometry()                      the BufferGeometry (call once)
  //
  // Points are [x, y, z] in local metres. `col` is [day, golden, night] hex.
  function build(initialCapacity = 1 << 16, opts) {
    // The Rust builder, when the page asked for it (?rustbuilder=1), it has loaded, and this caller opted in.
    // With opts.pack (?packverts=1) it writes the packed layout itself and fills the same tables object (js/slopes-rust.js).
    if (_rustBuild && opts && opts.wasm) {
      try { return _rustBuild(initialCapacity, opts); }
      catch (e) { rustFallback(e); }   // the module would not even start (out of memory, a bad instance): the JS builder, now and from here on
    }
    const T = window.THREE;
    const PK = (opts && opts.pack) || null;   // ?packverts=1: the VertexTables this build (and the chunks around it) share
    // Vertex store: growable Float32Arrays written in place. This used to be
    // seven plain arrays fed one number at a time (170 million push() calls
    // for the apartments alone, plus a per-vertex spread); profiled 2026-09-15
    // that was ~6 s of the 11 s apartment build and 1.6 s of GC. Same API,
    // same bytes out of geometry().
    // Small one-face builders need only four vertices. Bulk generators keep
    // their existing capacity; growth and the final trimmed geometry agree.
    let cap = initialCapacity, nV = 0;
    let P = new Float32Array(cap * 3), NM = PK ? null : new Float32Array(cap * 3);
    // ── WHY THE COLOURS ARE BYTES ────────────────────────────────────────
    //
    // cDay, cGold and cNight are nine of the twenty-two floats a vertex
    // carries — 36 of its 88 bytes, more than position and normal together.
    // Every one of them is read from a SIX-DIGIT HEX STRING in the building's
    // own data file, so the source has exactly 8 bits per channel and a
    // Float32 stores 24 bits of precision the value never had.
    //
    // Held as normalized UNSIGNED_BYTE the attribute is 3 bytes instead of
    // 12, the GPU expands it back to the same 0..1 float in the shader, and
    // the pixel is IDENTICAL — this is a lossless change, not a quality
    // setting. It also shrinks the growth buffers, so the build's own peak
    // comes down with it.
    let CD = PK ? null : new Uint8Array(cap * 3), CG = PK ? null : new Uint8Array(cap * 3), CN = PK ? null : new Uint8Array(cap * 3);
    // aFacet is 0 or 1. It was a float.
    let FC = PK ? null : new Uint8Array(cap);
    let SF = PK ? null : new Float32Array(cap * 4);
    let PW = PK ? new Uint16Array(cap * 2) : null;   // ?packverts=1: the 32-bit vertex word, as two uint16 (little-endian: low first)
    const grow = () => {
      cap *= 2;
      const g = (a, k) => { const b = new Float32Array(cap * k); b.set(a); return b; };
      const u = (a, k) => { const b = new Uint8Array(cap * k); b.set(a); return b; };
      if (PK) { P = g(P, 3); const w = new Uint16Array(cap * 2); w.set(PW); PW = w; return; }
      P = g(P, 3); NM = g(NM, 3); CD = u(CD, 3); CG = u(CG, 3); CN = u(CN, 3); FC = u(FC, 1); SF = g(SF, 4);
    };
    // ── THE INDEX, AND THE ONLY REASON IT IS HERE ────────────────────────
    //
    // A vertex in this layout costs 22 floats — position, normal, the three
    // colour triples, aGrad, aFacet, aSurface — which is 88 bytes. A quad
    // emitted as two independent triangles writes SIX of them for a shape
    // with four corners, and two of those six are exact duplicates.
    //
    // Measured on this build: js/slopes-apartments.js alone draws 2,570,081
    // triangles, and non-indexed that is 647 MB of attribute buffer. It is
    // the single largest allocation in the app by an order of magnitude, and
    // it is what made the site unopenable on a phone (js/mobile.js header).
    //
    // Indexing a planar quad writes 4 vertices (352 bytes) plus 6 Uint32
    // indices (24 bytes) instead of 6 vertices (528 bytes) — 29% less, for
    // BYTE-IDENTICAL output: same corners, same flat normal, same winding.
    // A lone triangle costs 12 bytes more than it did, which is why the
    // planar-quad path is the one that matters and the rest simply rides
    // along.
    //
    // NON-PLANAR QUADS TAKE THE OLD PATH ON PURPOSE. `tri` computes each
    // triangle's own normal, so a quad whose two halves do not share a plane
    // is currently shaded as two facets. Welding it to four vertices would
    // give both halves one averaged normal and CHANGE THE PIXELS. So `quad`
    // measures the two normals and only welds when they agree; otherwise it
    // emits the same two independent triangles it always did.
    let icap = cap * 2, nI = 0;
    let IDX = new Uint32Array(icap);
    const igrow = () => { icap *= 2; const b = new Uint32Array(icap); b.set(IDX); IDX = b; };
    const emit = (a, b, c) => {
      while (nI + 3 > icap) igrow();
      IDX[nI++] = a; IDX[nI++] = b; IDX[nI++] = c; tris++;
    };
    const cache = new Map();
    // 0..255, rounded once per tone rather than once per vertex.
    const rgb = hex => {
      let c = cache.get(hex);
      if (!c) { const f = hexToRgb01(hex); c = [Math.round(f[0] * 255), Math.round(f[1] * 255), Math.round(f[2] * 255)]; cache.set(hex, c); }
      return c;
    };
    // A palette entry ([day, golden, night]) is the same array object for every
    // vertex of a tone, so its three lookups are resolved once per object.
    const colCache = new WeakMap();
    const rgb3 = col => {
      let c = colCache.get(col);
      if (!c) { c = [rgb(col[0]), rgb(col[1]), rgb(col[2])]; colCache.set(col, c); }
      return c;
    };
    // `facet(true)` marks everything pushed after it as a roof facet for
    // SLOPES.facetShade (a sloped face shaded like the slab it replaces);
    // `facet(false)` ends the run. Walls, decks, domes and arches never set it.
    let _facet = 0;
    // ?packverts=1: position and ONE word per vertex. The four corners of a quad share a normal, a tone and a facet flag, so the word is
    // worked out once per primitive (compared by value, not identity: a caller may reuse an array).
    let _ln0 = NaN, _ln1 = 0, _ln2 = 0, _lcol = null, _lfac = -1, _llo = 0, _lhi = 0;
    // THE MOIRE FIX: `face(id)` gives every vertex pushed after it that wall face's number (it rides with the normal); `face(0)` ends the run.
    let _face = 0, _lface = 0;
    const pushPacked = (p, n, col) => {
      // Object.is, not ===: -0 and +0 are different float32 bits and a normal must come back exactly as the unpacked layout holds it
      if (!Object.is(n[0], _ln0) || !Object.is(n[1], _ln1) || !Object.is(n[2], _ln2) || col !== _lcol || _facet !== _lfac || _face !== _lface) {
        const nid = PK.normal(n[0], n[1], n[2], _face);   // tone and normal resolved before any buffer is touched, as in push()
        _llo = PK.wordLo(PK.tone(col), _facet, nid); _lhi = PK.wordHi(nid);
        _ln0 = n[0]; _ln1 = n[1]; _ln2 = n[2]; _lcol = col; _lfac = _facet; _lface = _face;
      }
      if (nV >= cap) grow();
      const i3 = nV * 3, i2 = nV * 2;
      P[i3] = p[0]; P[i3 + 1] = p[1]; P[i3 + 2] = p[2];
      PW[i2] = _llo; PW[i2 + 1] = _lhi;
      return nV++;
    };
    const push = PK ? pushPacked : (p, n, col) => {
      // Resolve the palette before touching any buffer. A rejected tone must
      // not shift every subsequent vertex relative to its colour attributes.
      const c = rgb3(col), d = c[0], g = c[1], k = c[2];
      if (nV >= cap) grow();
      const i3 = nV * 3, i4 = nV * 4;
      P[i3] = p[0]; P[i3 + 1] = p[1]; P[i3 + 2] = p[2];
      NM[i3] = n[0]; NM[i3 + 1] = n[1]; NM[i3 + 2] = n[2];
      CD[i3] = d[0]; CD[i3 + 1] = d[1]; CD[i3 + 2] = d[2];
      CG[i3] = g[0]; CG[i3 + 1] = g[1]; CG[i3 + 2] = g[2];
      CN[i3] = k[0]; CN[i3 + 1] = k[1]; CN[i3 + 2] = k[2];
      FC[nV] = _facet;
      const s = col.surface;                        // fresh slots are already 0
      if (s) { SF[i4] = s[0]; SF[i4 + 1] = s[1]; SF[i4 + 2] = s[2]; SF[i4 + 3] = s[3]; }
      return nV++;
    };
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    let tris = 0;
    /** The unit normal of triangle (a, b, c), or null if it is degenerate. */
    function faceN(a, b, c) {
      const n = cross(sub(b, a), sub(c, a));
      const L = Math.hypot(n[0], n[1], n[2]);
      if (L < 1e-9) return null;
      return [n[0] / L, n[1] / L, n[2] / L];
    }
    function tri(a, b, c, col, want) {
      let n = faceN(a, b, c);
      if (!n) return;                              // degenerate: nothing to draw
      if (want && dot(n, want) < 0) { const t = b; b = c; c = t; n = [-n[0], -n[1], -n[2]]; }
      emit(push(a, n, col), push(b, n, col), push(c, n, col));
    }
    function quad(a, b, c, d, col, want) {
      // Two halves, two normals. They agree for every rectangle the cell
      // tiler cuts and every side an extrusion sweeps, which is where all the
      // bytes are; a quad that has been bent takes the two-triangle path so
      // its shading is untouched.
      // TRULY planar, not nearly. A first cut allowed 0.9999 (0.8 deg of
      // disagreement) and the geometry fingerprint caught it: welding a
      // slightly bent quad gives its second half the FIRST half's normal, so
      // 0.8 deg of shading moved on every bent quad in the city. For a quad
      // that really is flat the two cross products differ only in the last
      // bit or two, so this keeps the weld exact and sends anything bent down
      // the old two-triangle path.
      const n1 = faceN(a, b, c), n2 = faceN(a, c, d);
      if (!n1 || !n2 || dot(n1, n2) < 1 - 1e-12) { tri(a, b, c, col, want); tri(a, c, d, col, want); return; }
      let n = n1;
      let flip = false;
      if (want && dot(n, want) < 0) { n = [-n[0], -n[1], -n[2]]; flip = true; }
      const ia = push(a, n, col), ib = push(b, n, col), ic = push(c, n, col), id = push(d, n, col);
      // Flipping the winding is a reversal of the corner ORDER, which the
      // index list expresses without touching a vertex.
      if (flip) { emit(ia, ic, ib); emit(ia, id, ic); }
      else { emit(ia, ib, ic); emit(ia, ic, id); }
    }
    /** A triangle with its own per-vertex normals (a smooth-shaded curve); wound to face their mean. */
    function triN(a, b, c, na, nb, nc, col) {
      let n = cross(sub(b, a), sub(c, a));
      const L = Math.hypot(n[0], n[1], n[2]);
      if (L < 1e-9) return;
      n = [n[0] / L, n[1] / L, n[2] / L];
      const avg = [na[0] + nb[0] + nc[0], na[1] + nb[1] + nc[1], na[2] + nb[2] + nc[2]];
      if (dot(n, avg) < 0) { let t = b; b = c; c = t; t = nb; nb = nc; nc = t; }
      emit(push(a, na, col), push(b, nb, col), push(c, nc, col));
    }
    const { polygon, extrude } = shapeOps(tri, triN, quad);
    function geometry() {
      const g = new T.BufferGeometry();
      if (PK) {
        g.setAttribute('position', new T.BufferAttribute(P.slice(0, nV * 3), 3));
        g.setAttribute('aPack', new T.BufferAttribute(PW.slice(0, nV * 2), 2, false));   // two uint16 read as floats by VERT
        g.setIndex(new T.BufferAttribute(IDX.slice(0, nI), 1));
        g.userData.pack = PK;
        g.computeBoundingSphere();
        return g;
      }
      // slice(): trimmed copies, so the oversized growth buffers can be freed.
      // BufferAttribute takes ownership of the trimmed array. The convenience
      // Float32BufferAttribute constructor would copy that array a second time.
      g.setAttribute('position', new T.BufferAttribute(P.slice(0, nV * 3), 3));
      g.setAttribute('normal', new T.BufferAttribute(NM.slice(0, nV * 3), 3));
      // `true` = normalized: the GPU divides by 255 on the way into the
      // shader, so `attribute vec3 cDay` still reads 0..1 and no GLSL changes.
      g.setAttribute('cDay', new T.BufferAttribute(CD.slice(0, nV * 3), 3, true));
      g.setAttribute('cGold', new T.BufferAttribute(CG.slice(0, nV * 3), 3, true));
      g.setAttribute('cNight', new T.BufferAttribute(CN.slice(0, nV * 3), 3, true));
      // aGrad is [0,0] for every builder vertex; materials supply the constant.
      g.setAttribute('aFacet', new T.BufferAttribute(FC.slice(0, nV), 1, false));
      g.setAttribute('aSurface', new T.BufferAttribute(SF.slice(0, nV * 4), 4));
      g.setIndex(new T.BufferAttribute(IDX.slice(0, nI), 1));
      g.computeBoundingSphere();
      return g;
    }
    function facet(v) { _facet = v ? 1 : 0; }
    function face(id) { _face = PK ? id | 0 : 0; }
    return { tri, triN, quad, polygon, extrude, geometry, facet, face, moire: PK && PK.faceOpen ? PK : null, get triangles() { return tris; } };
  }

  /**
   * A wall frame in local metres. `o` is [lng, lat]; `t` and `n` are the
   * wall's along and outward unit vectors expressed as DEGREES PER METRE
   * ([dlng, dlat]) — the shape the bakes write, so no projection constant is
   * restated here. at(u, v, z) → [x, y, z] local metres: u along the wall,
   * v out of it, z up. Linear over the tens of metres a door or a gable spans
   * (Mercator is affine to 1e-6 at that scale, measured against toLocal).
   */
  function frame(o, t, n) {
    const O = toLocal(o[0], o[1], 0);
    const Tp = toLocal(o[0] + t[0], o[1] + t[1], 0), Np = toLocal(o[0] + n[0], o[1] + n[1], 0);
    const Tv = [Tp.x - O.x, Tp.y - O.y, 0], Nv = [Np.x - O.x, Np.y - O.y, 0];
    return {
      O: [O.x, O.y, 0], T: Tv, N: Nv,
      at: (u, v, z) => [O.x + u * Tv[0] + v * Nv[0], O.y + u * Tv[1] + v * Nv[1], z || 0],
    };
  }

  /** What the last frame cost: renderer.info, plus each group's own count. */
  function stats() {
    const r = renderer && renderer.info && renderer.info.render;
    const groups = root ? root.children.map(g => {
      let t = 0; g.traverse(o => { if (o.isMesh && o.geometry) { const p = o.geometry.attributes.position; t += o.geometry.index ? o.geometry.index.count / 3 : (p ? p.count / 3 : 0); } });
      return { name: g.name, visible: g.visible, triangles: Math.round(t), lod: g.userData.lod || null, minzoom: g.userData.minzoom == null ? null : g.userData.minzoom };
    }) : [];
    return { calls: r ? r.calls : 0, triangles: r ? r.triangles : 0, frames: _frames, groups };
  }

  const _fetches = new Map();
  /** One fetch per URL for the whole layer; the browser's cache does the rest. */
  function fetchJSON(url) {
    if (!_fetches.has(url)) {
      try { window.loaderData?.(url, 'start'); } catch (e) {}
      _fetches.set(url, fetch(url).then(r => {
        if (!r.ok) throw new Error(url + ': ' + r.status);
        return r.json();
      }).then(data => {
        try { window.loaderData?.(url, 'done'); } catch (e) {}
        return data;
      }).catch(e => {
        try { window.loaderData?.(url, 'error'); } catch (ignored) {}
        throw e;
      }));
    }
    return _fetches.get(url);
  }

  // ── The light ───────────────────────────────────────────────────────────
  /**
   * The same light the painter is drawing the buildings with, this frame.
   * `map.style.light.properties` holds the EVALUATED values — mid-transition
   * when setLight is easing (MapLibre transitions light over 300 ms) — which
   * is exactly what fill-extrusion's uniforms are built from. `map.getLight()`
   * only returns the target and is the fallback.
   */
  function syncLight() {
    let pos = null, col = null, inten = null;
    try {
      const props = _map.style && _map.style.light && _map.style.light.properties;
      if (props) {
        const p = props.get('position'); const c = props.get('color');
        if (p && isFinite(p.x)) { pos = [-p.x, p.y, p.z]; }
        if (c && isFinite(c.r)) { col = [c.r, c.g, c.b]; }
        inten = props.get('intensity');
      }
    } catch (e) {}
    if (!pos) {
      // Target values: [radial, azimuth clockwise from north, polar from up].
      const L = _map.getLight ? _map.getLight() : null;
      const P = (L && L.position) || [1.15, 205, 32];
      const R = Math.PI / 180;
      pos = [P[0] * Math.sin(P[1] * R) * Math.sin(P[2] * R),
             P[0] * Math.cos(P[1] * R) * Math.sin(P[2] * R),
             P[0] * Math.cos(P[2] * R)];
      col = L && L.color ? hexToRgb01(L.color) : [1, 1, 1];
      inten = L && isFinite(L.intensity) ? L.intensity : 0.28;
    }
    _light.enu = pos; _light.colour = col; _light.intensity = inten;
    U.u_lightpos.value.set(pos[0], pos[1], pos[2]);
    U.u_lightcolor.value.set(col[0], col[1], col[2]);
    U.u_lightintensity.value = inten;
    // The real DirectionalLight, in the same east/north/up frame.
    if (dirLight) {
      dirLight.position.set(pos[0], pos[1], pos[2]).normalize().multiplyScalar(1000);
      dirLight.color.setRGB(col[0], col[1], col[2]);
      dirLight.intensity = 1.0;
    }
  }

  // ── The layer ───────────────────────────────────────────────────────────
  const layer = {
    id: SLOPES.layerId,
    type: 'custom',
    renderingMode: '3d',
    onAdd(map, gl) { _gl = gl; },
    onRemove() {
      releaseSunShadows();
      _pc.pending.clear();
      _pc.next = 0;
      try { if (renderer) renderer.dispose(); } catch (e) {}
      renderer = null; _frames = 0;
    },
    /** js/lod.js calls this instead of setLayoutProperty for custom layers. */
    setVisible(v) { _visible = !!v; if (_map) _map.triggerRepaint(); },
    isVisible() { return _visible; },
    prerender(gl,args) { this.render(gl,args,true); },
    render(gl, args, prepareOnly=false) {
      // The switch, read LIVE every frame — never cached at onAdd.
      if (!SLOPES.on || !scene || gl.isContextLost() || window.LITE_PROFILE?.sceneUnavailable) return;
      // Each generator's group carries the minzoom and the LOD tier of the
      // fill-extrusion layer it replaces (userData.minzoom, userData.lod), so
      // the roofs go at the altitude js/lod.js drops `roofs-pitched` while the
      // dome, which no tier lists, stays on the skyline. `_visible` is
      // lod.js's decision and applies to the 'mid' groups only.
      //
      // THIS LOOP IS THE WHOLE REASON js/lod.js MUST NOT WRITE `visibility`
      // ON THIS LAYER. MapLibre 5.24 answers a hidden custom layer by never
      // calling render() again, and a decision taken here cannot be taken in
      // a function nobody calls: hidden wholesale, the dome went with the
      // roofs while the layer's filter still held its discs down, and there
      // was no dome at all. See contract point 8 in the header.
      const zoom = _map.getZoom();
      let any = false;
      for (const g of root.children) {
        const ud = g.userData || {};
        const vis = !(ud.minzoom != null && zoom < ud.minzoom) && (_visible || ud.lod !== 'mid');
        g.visible = vis; any = any || vis;
      }
      // Lighting still updates when LOD hides every authored mesh.
      const T = window.THREE;
      if (!renderer) {
        // Built here, not in onAdd: see contract point 7.
        renderer = new T.WebGLRenderer({ canvas: _map.getCanvas(), context: gl, antialias: false });
        renderer.autoClear = false;
        if ('outputColorSpace' in renderer) renderer.outputColorSpace = T.LinearSRGBColorSpace;
      }
      const M = args.defaultProjectionData && args.defaultProjectionData.mainMatrix;
      if (!M) {
        if (!_warnedMatrix) { _warnedMatrix = true; console.error('[slopes] no defaultProjectionData.mainMatrix in render args — nothing will draw'); }
        return;
      }
      // The graphics preset is read here because js/graphics.js has no hook
      // list; a change is applied on the next tick, never inside a frame.
      const pre = window.GFX && window.GFX.preset;
      if (pre !== _lastPreset) { _lastPreset = pre; setTimeout(() => window.applySlopesSettings(_map), 0); }
      syncLight();
      _mat.fromArray(M);
      _loc.makeTranslation(originMerc.x, originMerc.y, originMerc.z).scale(_s3);
      camera.projectionMatrix.copy(_mat.multiply(_loc));
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
      // The inverse projective z-axis is the camera origin in local metres.
      _eye4.set(0,0,1,0).applyMatrix4(camera.projectionMatrixInverse);
      U.u_eye.value.set(_eye4.x/_eye4.w,_eye4.y/_eye4.w,_eye4.z/_eye4.w);
      const surf=SLOPES.surfaces;
      window.RoofTiles.sync(U);
      U.u_surfaceRange.value.set(surf.on?1:0,surf.near,surf.far);
      U.u_surfaceStyle.value.set(surf.joint,surf.jointShade,surf.grain,surf.reflection);
      U.u_surfaceNoise.value.set(surf.grainScale,surf.tileVariation,surf.reflectionBase);
      U.u_brickPatch.value.set(surf.brickPatch,surf.brickPatchCell[0],surf.brickPatchCell[1]);
      U.u_brickMottle.value.set(surf.brickMottle,surf.brickMottleSize,surf.brickMottleFar[0],surf.brickMottleFar[1]);
      U.u_surfaceHorizon.value.set(surf.skyLow,surf.skyHigh,surf.horizonLow,surf.horizonHigh);
      const weather=SLOPES.weathering;
      U.u_weatherScale.value.set(weather.streakX,weather.streakY,weather.broadX,weather.broadY);
      U.u_weatherTone.value.set(weather.darkening,weather.grain,weather.flatStrength);
      const shop=SLOPES.storefront;
      U.u_shopRoom.value.set(shop.depth,shop.on?shop.interior:0,shop.fresnel,shop.shelfPitch);
      U.u_shopStyle.value.set(shop.shelfThickness,shop.merchWidth,shop.merchHeight,shop.lightPower);
      U.u_shopShelfTop.value=shop.shelfTop;
      U.u_shopClosedAmbient.value=shop.closedAmbient;
      U.u_shopCeiling.value.set(shop.sideShade,shop.ceilingShade,shop.lightWidth,shop.lightLength);
      for(const key of ['Wall','Floor','Merch','Light'])U['u_shop'+key].value.set(...hexToRgb01(shop[key.toLowerCase()]));
      U.u_materialP.value=window.CityNight?.materialP(U.u_p.value)??U.u_p.value;
      U.u_moire.value.set(MOIRE.on?MOIRE.mode:0,MOIRE.px[0],MOIRE.px[1],MOIRE.parallax);
      U.u_moireB.value.set(MOIRE.pxV[0],MOIRE.pxV[1],MOIRE.goldSlope,0);
      U.u_moireD.value.set(MOIRE.through,0,0,0);
      U.u_moireC.value.set(MOIRE.edge&&MOIRE.mode===1?1:0,MOIRE.edgePx[0],MOIRE.edgePx[1],MOIRE.footprint);
      U.u_nightLamps.value=window.CityNight?.tune.on?window.CityNight.lamps(U.u_p.value):-1;
      U.u_nightWallAmbient.value=window.CityNight?.tune.wallAmbient??0;
      const hour=U.u_p.value,sa=hexToRgb01(surf.sky[hour<=.5?0:1]),sb=hexToRgb01(surf.sky[hour<=.5?1:2]),st=hour<=.5?hour*2:(hour-.5)*2;
      U.u_surfaceSky.value.set(...sa.map((v,i)=>v+(sb[i]-v)*st));
      const sunlight=SLOPES.sunlight,body=window.skyBodies?.(hour)?.sun;
      // Read the same celestial track as sky.js and shadows.js. The moon's
      // fallback map light must never become a second reflected sun at night.
      const elevation=body?.elev??-90,azimuth=(body?.az??0)*Math.PI/180;
      const elevationRad=elevation*Math.PI/180,ce=Math.cos(elevationRad);
      U.u_sunDirection.value.set(Math.sin(azimuth)*ce,Math.cos(azimuth)*ce,Math.sin(elevationRad));
      const warm=clamp01(1-elevation/sunlight.warmElevation);
      const present=clamp01((elevation-sunlight.nightFadeEnd)/(sunlight.nightFadeStart-sunlight.nightFadeEnd));
      U.u_sunPresence.value.set(present*present*(3-2*present),warm);
      U.u_sunlight.value.set(sunlight.on?1:0,sunlight.ambient,sunlight.direct,sunlight.glassReflectance);
      U.u_glassStrength.value=sunlight.reflectionStrength*(window.GFX?.windowReflections??1);
      U.u_glassSun.value.set(sunlight.sunGlint,sunlight.glintPower,sunlight.haloPower,sunlight.haloStrength);
      U.u_reflectionSky.value.set(sunlight.horizonHeight,sunlight.sunsetSpread,sunlight.sunsetStrength,sunlight.groundBlend);
      const blendColour=(uniform,a,b,t)=>{
        const ca=hexToRgb01(a),cb=hexToRgb01(b);
        uniform.value.set(...ca.map((v,i)=>v+(cb[i]-v)*t));
      };
      blendColour(U.u_sunColour,sunlight.daySun,sunlight.lowSun,warm);
      blendColour(U.u_skyZenith,sunlight.dayZenith,sunlight.lowZenith,warm);
      blendColour(U.u_skyHorizon,sunlight.dayHorizon,sunlight.lowHorizon,warm);
      U.u_shadeColour.value.set(...hexToRgb01(sunlight.shade));
      U.u_sunsetColour.value.set(...hexToRgb01(sunlight.sunset));
      U.u_groundColour.value.set(...hexToRgb01(sunlight.ground));
      renderer.resetState();
      updateSunShadows();
      if(gl.isContextLost())return;
      window.CityLighting.frame(U,camera.projectionMatrixInverse,_sunShadow?.targets.map(t=>renderer.properties.get(t.texture).__webglTexture));
      if(prepareOnly)return;
      renderer.render(scene, camera);
      _frames++;
      precompileTick();
    },
  };

  /** Before the fog if it exists, else before the first symbol layer after our buildings. */
  function beforeId(map) {
    if (map.getLayer(SLOPES.fogLayerId)) return SLOPES.fogLayerId;
    const stack = map.getStyle().layers;
    const after = Math.max(0, stack.findIndex(l => l.id === 'buildings-3d'));
    const s = stack.slice(after + 1).find(l => l.type === 'symbol');
    return s ? s.id : undefined;
  }

  // ── Time of day ─────────────────────────────────────────────────────────
  /** Quantised exactly as timeofday.js quantises its heavy repaint. */
  function pq(p) {
    const PQ = (typeof window.__todPQ === 'number' && window.__todPQ > 0) ? window.__todPQ : 128;
    return Math.round(clamp01(p) * PQ) / PQ;
  }
  window.applySlopesTime = function applySlopesTime(map, p) {
    if (!U) return;
    const v = pq(p != null ? p : 0.5);
    if (U.u_p.value !== v) { U.u_p.value = v; if (_map) _map.triggerRepaint(); }
    if (_debugTwinAdded && map && map.getLayer('slopes-debug-twin')) {
      try { map.setPaintProperty('slopes-debug-twin', 'fill-extrusion-color', twinColour(v)); } catch (e) {}
    }
  };
  function twinColour(p) {
    return ['interpolate', ['linear'], p,
      0, ['to-color', ['get', 'rd']], 0.5, ['to-color', ['get', 'rg']], 1, ['to-color', ['get', 'rn']]];
  }

  // ── Settings ────────────────────────────────────────────────────────────
  /** SLOPES.facetShade → the shader's uniforms (the tilt as its sine and cosine). */
  function facetUniforms() {
    const F = SLOPES.facetShade || {};
    const R = Math.PI / 180;
    U.u_facet_on.value = F.on ? 1 : 0;
    U.u_facet_ambient.value = isFinite(F.ambient) ? F.ambient : 0.35;
    U.u_facet_lo.value = isFinite(F.lo) ? F.lo : 0.70;
    U.u_facet_hi.value = isFinite(F.hi) ? F.hi : 1.28;
    U.u_facet_sin.value = Math.sin((isFinite(F.tilt) ? F.tilt : 38) * R);
    U.u_facet_cos.value = Math.cos((isFinite(F.tilt) ? F.tilt : 38) * R);
    U.u_sloped_max_z.value = Math.cos((isFinite(SLOPES.slopedMinDeg) ? SLOPES.slopedMinDeg : 6) * R);
  }
  window.applySlopesSettings = function applySlopesSettings(map) {
    map = map || _map;
    if (!U || !map) return;
    U.u_vertical_gradient.value = SLOPES.verticalGradient;
    U.u_opacity.value = SLOPES.opacity;
    U.u_roof_shade.value = SLOPES.roofShade;
    facetUniforms();
    if (SLOPES.debug) debugScene(map);
    map.triggerRepaint();
  };

  // ── Debug scene (?slopesdebug=1) ────────────────────────────────────────
  //
  // Five things, each the smallest object that proves one line of the
  // contract, so the next agent can see the layer working before a generator
  // exists — and so scripts/verify/slopes-layer.mjs has something to measure:
  //
  //   parity   a cube on the South Mall lawn and a fill-extrusion TWIN of the
  //            same colour and height 40 m east of it. Same pixel = same light,
  //            same hour, same colour path.
  //   behind   a slab north of the Tower that the Tower must hide.
  //   front    a slab south of the Tower that must hide the Tower.
  //   far      a mesh post and an extrusion post 2.5 km north, side by side:
  //            the fog must tint both by the same amount.
  //   lathe    a small dome on the mall axis: smooth curvature under the real
  //            light, the rotation-for-Z-up convention, and a raycast target.
  //            Its segment count follows the graphics preset.
  function debugScene(map) {
    const T = window.THREE;
    if (_debugGroup) { root.remove(_debugGroup); _debugGroup = null; }
    const g = new T.Group(); g.name = 'slopes-debug';
    const mat = material();
    const C = SLOPES.debugColour;
    const box = (name, lng, lat, w, d, h, base) => {
      const geom = new T.BoxGeometry(w, d, h);
      geom.translate(0, 0, (base || 0) + h / 2);
      colour(geom, C, { base: base || 0, top: (base || 0) + h });
      const m = new T.Mesh(geom, mat);
      const p = toLocal(lng, lat, 0);
      m.position.set(p.x, p.y, p.z);
      m.name = name;
      g.add(m);
      return m;
    };
    const O = SLOPES.origin;
    const north = m => O[1] + m / 111320;   // metres of latitude, near enough for placement
    const east = (lat, m) => O[0] + m / (111320 * Math.cos(lat * Math.PI / 180));

    const E = SLOPES.debugCube, P = SLOPES.debugParityAt;
    box('parity', P[0], P[1], E, E, E, 0);
    const B = SLOPES.debugBehind, F = SLOPES.debugFront, X = SLOPES.debugFar;
    box('behind', O[0], north(B.north), B.w, B.d, B.h, 0);
    box('front', O[0], north(F.north), F.w, F.d, F.h, 0);
    box('far', O[0], north(X.north), X.w, X.d, X.h, 0);

    const seg = Math.max(6, Math.round(SLOPES.debugLatheSegments * detail()));
    const pts = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI / 2;
      pts.push(new T.Vector2(SLOPES.debugLatheR * Math.cos(a), SLOPES.debugLatheH * Math.sin(a)));
    }
    const lathe = new T.LatheGeometry(pts, seg);
    lathe.rotateX(Math.PI / 2);          // three lathes around +Y; up is +Z here
    lathe.computeVertexNormals();
    colour(lathe, C);
    const dome = new T.Mesh(lathe, mat);
    const L = toLocal(SLOPES.debugLatheAt[0], SLOPES.debugLatheAt[1], 0);
    dome.position.set(L.x, L.y, L.z);
    dome.name = 'lathe';
    dome.userData.segments = seg;
    g.add(dome);

    g.userData.lod = 'mid';          // hidden at altitude with the roofs, as the gate asserts
    _debugGroup = g;
    root.add(g);

    // The fill-extrusion twins: a real MapLibre layer, so the comparison is
    // against the thing itself and not a model of it.
    if (!_debugTwinAdded) {
      const sq = (lng, lat, w, d) => {
        const dx = w / 2 / (111320 * Math.cos(lat * Math.PI / 180)), dy = d / 2 / 111320;
        return [[[lng - dx, lat - dy], [lng + dx, lat - dy], [lng + dx, lat + dy], [lng - dx, lat + dy], [lng - dx, lat - dy]]];
      };
      const feat = (name, lng, lat, w, d, h) => ({ type: 'Feature',
        properties: { name, rd: C[0], rg: C[1], rn: C[2], h, b: 0 },
        geometry: { type: 'Polygon', coordinates: sq(lng, lat, w, d) } });
      const twinLng = east(P[1], (toLocal(P[0], P[1], 0).x + SLOPES.debugTwinEast));
      const farLat = north(X.north);
      const fc = { type: 'FeatureCollection', features: [
        feat('parity-twin', twinLng, P[1], E, E, E),
        feat('far-twin', east(farLat, X.gap), farLat, X.w, X.d, X.h),
      ] };
      try {
        map.addSource('slopes-debug-twin', { type: 'geojson', data: fc });
        map.addLayer({ id: 'slopes-debug-twin', type: 'fill-extrusion', source: 'slopes-debug-twin',
          paint: { 'fill-extrusion-color': twinColour(U.u_p.value),
                   'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-base': ['get', 'b'],
                   'fill-extrusion-opacity': 1.0 } }, beforeId(map));
        _debugTwinAdded = true;
      } catch (e) { console.warn('[slopes] debug twin:', e); }
    }
  }

  // ── Init ────────────────────────────────────────────────────────────────
  window.initSlopes = function initSlopes(map) {
    if (!SLOPES.on || !map || !haveThree()) return;
    if (map.getLayer(SLOPES.layerId)) { _map = map; return; }
    _map = map;
    const T = window.THREE;
    // Colours are the data's own hex, lit by MapLibre's formula. No gamma
    // round trips on top of that: three's colour management is off for this
    // scene so a hex in is the same hex the fill-extrusion next door got.
    if (T.ColorManagement) T.ColorManagement.enabled = false;

    originMerc = maplibregl.MercatorCoordinate.fromLngLat({ lng: SLOPES.origin[0], lat: SLOPES.origin[1] }, 0);
    originScale = originMerc.meterInMercatorCoordinateUnits();
    _mat = new T.Matrix4(); _loc = new T.Matrix4();
    _s3 = new T.Vector3(originScale, -originScale, originScale);   // the one reflection, point 3
    _eye4 = new T.Vector4();

    U = {
      // Subclasses copy the uniform dictionary before their first render.
      // Allocate shared city values now so those copies keep the same holders.
      u_citySkyFill:{value:new T.Vector2()},u_cityNight:{value:new T.Vector4()},
      u_cityCrown:{value:new T.Vector4()},u_cityCrownColour:{value:new T.Vector4()},
      ...Object.fromEntries(Array.from({length:8},(_,i)=>[
        ['u_cityFixture'+i,{value:new T.Vector4()}],
        ['u_cityFixtureColour'+i,{value:new T.Vector4()}],
      ]).flat()),
      u_lightpos: { value: new T.Vector3(0, 0, 1) },
      u_eye: {value:new T.Vector3()}, u_surfaceRange:{value:new T.Vector3(1,25,120)},
      u_surfaceStyle:{value:new T.Vector4()},u_surfaceSky:{value:new T.Vector3()},
      u_surfaceNoise:{value:new T.Vector3()},u_brickPatch:{value:new T.Vector3()},u_brickMottle:{value:new T.Vector4()},u_surfaceHorizon:{value:new T.Vector4()},
      u_weatherScale:{value:new T.Vector4()},u_weatherTone:{value:new T.Vector3()},
      u_shopClosedAmbient:{value:.06},u_shopShelfTop:{value:.55},u_shopRoom:{value:new T.Vector4()},u_shopStyle:{value:new T.Vector4()},u_shopCeiling:{value:new T.Vector4()},
      u_shopWall:{value:new T.Vector3()},u_shopFloor:{value:new T.Vector3()},u_shopMerch:{value:new T.Vector3()},u_shopLight:{value:new T.Vector3()},
      u_moire:{value:new T.Vector4()},u_moireB:{value:new T.Vector4()},u_moireC:{value:new T.Vector4()},u_moireD:{value:new T.Vector4()},
      u_materialP:{value:.5},u_nightLamps:{value:-1},u_nightWallAmbient:{value:0},u_glassStrength:{value:1},u_sunlight:{value:new T.Vector4()},u_sunDirection:{value:new T.Vector3()},
      u_sunColour:{value:new T.Vector3()},u_shadeColour:{value:new T.Vector3()},
      u_skyZenith:{value:new T.Vector3()},u_skyHorizon:{value:new T.Vector3()},
      u_sunsetColour:{value:new T.Vector3()},u_groundColour:{value:new T.Vector3()},
      u_glassSun:{value:new T.Vector4()},u_reflectionSky:{value:new T.Vector4()},
      u_sunPresence:{value:new T.Vector2()},
      u_sunShadow0:{value:null},u_sunShadow1:{value:null},
      u_sunShadowMatrix0:{value:new T.Matrix4()},u_sunShadowMatrix1:{value:new T.Matrix4()},
      u_shadowSettings:{value:new T.Vector4()},
      u_lightcolor: { value: new T.Vector3(1, 1, 1) },
      u_lightintensity: { value: 0.28 },
      u_vertical_gradient: { value: SLOPES.verticalGradient },
      u_opacity: { value: SLOPES.opacity },
      u_roof_shade: { value: SLOPES.roofShade },
      u_p: { value: pq(window.__todCurrentP != null ? window.__todCurrentP : 0.5) },
      u_facet_on: { value: 0 }, u_facet_ambient: { value: 0.35 }, u_facet_lo: { value: 0.70 },
      u_facet_hi: { value: 1.28 }, u_facet_sin: { value: 0 }, u_facet_cos: { value: 1 },
      u_sloped_max_z: { value: Math.cos(6 * Math.PI / 180) },
    };
    facetUniforms();
    scene = new T.Scene();
    root = new T.Group(); root.name = 'slopes-root';   // identity: NO mirror here, see point 3
    scene.add(root);
    camera = new T.Camera();
    dirLight = new T.DirectionalLight(0xffffff, 1.0);
    scene.add(dirLight); scene.add(dirLight.target);
    scene.add(new T.AmbientLight(0xffffff, 0.35));   // ROOF_SHADE.ambient, for standard materials

    map.addLayer(layer, beforeId(map));

    // MapLibre serializes its style without custom layers when the context is
    // lost. Wait for its replacement style, then re-add ONLY the layer: keep
    // CPU meshes/materials/textures and let a fresh renderer upload everything.
    // Only where the CPU copies were kept; a phone reloads instead (js/mobile.js).
    if (!FREE_CPU) {
      let restorePending = false, restoreLight = null, restoreP = null;
      const restoreLayer = () => {
        if (!restorePending || !map.style?._loaded || !map.getLayer('buildings-3d') || map.painter.context.gl.isContextLost()) return;
        // MapLibre's loss snapshot also omits its live time-of-day light.
        if (restoreLight) map.setLight(restoreLight, { duration: 0 });
        if (!map.getLayer(SLOPES.layerId)) map.addLayer(layer, beforeId(map));
        // The clock may have moved while the style was gone (js/app.js, THE
        // STYLELESS GAP); the snapshot only knows the moment of the loss.
        // Re-apply the CURRENT time through the full wrapper chain, but only
        // then: a needless repaint makes the name labels re-test what hides
        // them, and on CI's slow renderer they were still fading back in.
        if (typeof window.applyTimeOfDay === 'function' && window.__todCurrentP != null &&
            window.__todCurrentP !== restoreP)
          window.applyTimeOfDay(map, window.__todCurrentP, true);
        restorePending = false;
        map.triggerRepaint();
      };
      map.getCanvas().addEventListener('webglcontextlost', () => { restoreLight = map.getLight(); restoreP = window.__todCurrentP; restorePending = true; }, true);
      map.on('webglcontextrestored', restoreLayer);
      map.on('styledata', restoreLayer);
      map.on('style.load', restoreLayer);
    }

    // Join the retint chain (js/timeofday.js's retint comment says why the
    // wrapper, not a poll, is the only correct way).
    if (!window.__slopesHooked && typeof window.applyTimeOfDay === 'function') {
      const orig = window.applyTimeOfDay;
      window.applyTimeOfDay = function (m, pp, force) {
        const r = orig.apply(this, arguments);
        try { window.applySlopesTime(m, pp); } catch (e) {}
        return r;
      };
      window.__slopesHooked = true;
    }
    window.applySlopesSettings(map);
    console.log('[slopes] layer installed before', beforeId(map), '— origin', SLOPES.origin,
                '— debug', SLOPES.debug ? 'ON' : 'off');
  };

  /**
   * build(), in chunks of at most `maxTris` triangles (js/mobile.js
   * LITE.budget.geometryChunkTris; phones only). The same API plus
   * `geometries()`: every primitive lands whole in one chunk (its indices only
   * ever point at its own vertices), so the output is the same triangles in the
   * same order, split across several meshes.
   *
   * WHY. One builder holds the whole of a bulk generator in growth buffers
   * that double, and trims them with a copy at the end. For the authored
   * buildings that was ~4.2 M vertices in buffers sized for 8.4 M, plus the
   * trimmed copy, plus the doubling's garbage — the load's peak, ~820 MB of
   * ArrayBuffers for a result of ~235 MB, measured on the phone profile. A
   * chunk's buffers never grow past the chunk.
   */
  function buildChunked(maxTris, pack, opts) {
    const done = [];
    let cur = build(undefined, opts), facetOn = false, faceOn = 0, before = 0;
    const finish = () => (pack ? packGeometry(cur.geometry()) : cur.geometry());
    const roll = () => {
      if (cur.triangles < maxTris) return;
      before += cur.triangles;
      done.push(finish());
      cur = build(undefined, opts);
      cur.facet(facetOn);
      if (cur.face) cur.face(faceOn);
    };
    const api = {
      facet(v) { facetOn = !!v; return cur.facet(v); },
      face(id) { faceOn = id | 0; if (cur.face) cur.face(faceOn); },
      get moire() { return cur.moire || null; },
      geometries() {
        const out = done.splice(0);
        if (cur.triangles > 0 || !out.length) out.push(finish());
        return out;
      },
      get triangles() { return before + cur.triangles; },
    };
    for (const m of ['tri', 'triN', 'quad', 'polygon', 'extrude']) api[m] = (...a) => { roll(); return cur[m](...a); };
    return api;
  }

  /**
   * A builder geometry at 34 bytes a vertex instead of 50 (js/mobile.js
   * LITE.budget.packVertices; phones only). The normal becomes signed
   * normalized BYTES (the shader still reads a vec3 in -1..1; an axis-aligned
   * wall or roof normal is exact, any other is within half a degree) and
   * aSurface four half floats (a material index, which is exact, and three
   * shading scales to ~0.05%). Position and the colours are untouched.
   *
   * NOT PIXEL-IDENTICAL, and this is the one place a phone gives up exactness
   * on purpose: the fine brick-joint grain is anchored in world metres through
   * the normal and the surface scale, so on a wall hundreds of metres from the
   * origin it lands a fraction of a brick along. Measured in one page, packed
   * vs not (SwiftShader, 640x640 close-ups, control 0 px): The Standard by
   * day 2.7% of pixels, at most 12/255; 21 Rio 1.3%; Moody Center 0. The
   * same grain, displaced — invisible at a phone's ~0.3 m a pixel.
   */
  function packGeometry(g) {
    const T = window.THREE;
    const n = g.attributes.normal;
    if (n && n.array instanceof Float32Array) {
      // FOUR bytes, the fourth unused: `attribute vec3 normal` reads x, y, z of
      // a 4-component attribute (legal in WebGL), and a 4-byte stride is one
      // Metal (iOS) can use as is instead of converting a copy.
      const a = n.array, nv = a.length / 3, o = new Int8Array(nv * 4);
      for (let v = 0; v < nv; v++) for (let k = 0; k < 3; k++) o[v * 4 + k] = Math.round(Math.max(-1, Math.min(1, a[v * 3 + k])) * 127);
      g.setAttribute('normal', new T.BufferAttribute(o, 4, true));
    }
    const s = g.attributes.aSurface;
    if (s && s.array instanceof Float32Array && T.Float16BufferAttribute && T.DataUtils && T.DataUtils.toHalfFloat) {
      const a = s.array, o = new Uint16Array(a.length), h = T.DataUtils.toHalfFloat;
      for (let i = 0; i < a.length; i++) o[i] = h(a[i]);
      const attr = new T.Float16BufferAttribute(o, 4);
      g.setAttribute('aSurface', attr);
    }
    return g;
  }

  window.slopes = {
    canRestoreContext: !FREE_CPU,
    toLocal, toLngLat, project, raycast, material, facadeMaterial, colour, add, remove, detail,
    onSwitch, build, buildChunked, packGeometry, frame, stats, fetchJSON,
    // null with the switch off; with it on, a promise that settles when the Rust builder is ready (or has failed and
    // every builder stays the JS one). Callers that want the Rust builder await it before their first build().
    rustReady: null, get rustBuilder() { return !!_rustBuild; }, rustInfo: () => RUST_INFO, withRustFallback,
    // ?packverts=1: a fresh set of tone/normal tables for one build (pass it as build(cap, { pack }) and material({ pack })), or null
    // when the switch is off or this GPU cannot read float textures in the vertex shader (WebGL2 only): callers then build as before.
    packTables, packOn: () => PACK.on, packInfo: () => ({ toneBits: PACK.toneBits, texWidth: PACK.texWidth, byteConversion: _byteFloats ? _byteFloats.how : 'not yet measured' }),
    // a test seam, not a feature: flip the switch at run time so ONE page can build the apartments both ways (scripts/verify/packverts-pixels.mjs
    // rebuilds with slopesApartments.rebuild() and photographs each); a visitor sets it only through ?packverts=1
    packSet: on => { PACK.on = !!on; },
    light: () => ({ enu: _light.enu.slice(), colour: _light.colour.slice(), intensity: _light.intensity }),
    get scene() { return scene; }, get root() { return root; }, get camera() { return camera; },
    get renderer() { return renderer; }, get layer() { return layer; },
    get origin() { return originMerc; }, get scale() { return originScale; },
    get frames() { return _frames; }, get debugGroup() { return _debugGroup; },
    uniforms: () => U,
    sunlightStats: () => ({shadowUpdates:_sunShadow?.updates||0,shadowMapRenders:_sunShadow?.mapRenders||0,shadowSize:_sunShadow?.size||0,shadowMaps:_sunShadow?2:0}),
    precompileStats: () => ({ on: SLOPES.turn.precompile, compiled: _pc.compiled, warmed: _pc.warmed, pending: _pc.pending.size, materials: _pc.materials, ms: +_pc.ms.toFixed(1) }),
  };

  // ?rustbuilder=1: fetch + compile the module now (streaming), well before the first big build asks for it. The switch off
  // never reaches this block, so a page without it requests nothing extra. A failure leaves every builder the JS one.
  if (RUST.on) {
    window.slopes.rustReady = import(RUST.moduleUrl)
      .then(m => m.loadRustBuilder({
        wasmUrl: RUST.wasmUrl, stageRecords: RUST.stageRecords, reserveVertices: RUST.reserveVertices,
        shapeOps, hexToRgb01, three: () => window.THREE, info: RUST_INFO,
        toneKey, packOverflow, toneBits: PACK.toneBits, byteFloats,   // for packed builds (?packverts=1)
      }))
      .then(factory => { _rustBuild = factory; RUST_INFO.state = 'ready'; })
      .catch(e => { RUST_INFO.state = 'failed'; RUST_INFO.error = String(e && e.message || e); console.warn('[slopes] ?rustbuilder=1: the Rust builder did not load; building in JS —', RUST_INFO.error); });
  }

  // Self-boot, the shape js/roofs.js documents: take the style's own `load`
  // event, then poll only for what has to exist — the buildings layer and
  // three.js (loaded `defer`, so it lands after the classic scripts). Give up
  // LOUDLY, never silently.
  function boot() {
    if (!SLOPES.on) return;
    const map = window.__map;
    if (!map) return setTimeout(boot, 60);
    let tries = 0;
    const go = () => {
      if (!map.getLayer('buildings-3d') || !haveThree()) {
        if (++tries > 500) {
          console.error('[slopes] ' + (haveThree() ? 'buildings-3d never appeared' : 'three.js never loaded') +
                        ' after 60 s — the slopes layer is NOT in this scene');
          return;
        }
        return setTimeout(go, 120);
      }
      try { window.initSlopes(map); } catch (e) { console.error('[slopes]', e); }
    };
    if (map.isStyleLoaded && map.isStyleLoaded()) go();
    else map.once('load', () => setTimeout(go, 0));
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 200));
  } else {
    setTimeout(boot, 200);
  }
})();
