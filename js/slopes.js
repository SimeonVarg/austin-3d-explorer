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
    uniform vec3 u_lightpos;
    uniform vec3 u_lightcolor;
    uniform float u_lightintensity;
    uniform float u_vertical_gradient;
    uniform float u_opacity;
    uniform float u_roof_shade;
    uniform float u_p;
    uniform float u_facet_on;
    uniform float u_facet_ambient;
    uniform float u_facet_lo;
    uniform float u_facet_hi;
    uniform float u_facet_sin;
    uniform float u_facet_cos;
    uniform float u_sloped_max_z;
    attribute vec3 cDay;
    attribute vec3 cGold;
    attribute vec3 cNight;
    attribute vec2 aGrad;
    attribute float aFacet;
    varying vec4 v_color;
    void main() {
      vec3 color = (u_p <= 0.5) ? mix(cDay, cGold, u_p * 2.0)
                                : mix(cGold, cNight, (u_p - 0.5) * 2.0);
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
        color = (u_p <= 0.5) ? mix(cDay, cGold, u_p * 2.0) * m
                             : mix(cGold * m, cNight, (u_p - 0.5) * 2.0);
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
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`;
  const FRAG = `
    varying vec4 v_color;
    void main() { gl_FragColor = v_color; }`;

  // ── State ───────────────────────────────────────────────────────────────
  let _map = null, _gl = null;
  let scene = null, root = null, camera = null, renderer = null, dirLight = null;
  let U = null;                 // the shared uniforms, built once THREE exists
  let originMerc = null, originScale = 0;
  let _visible = true;          // js/lod.js's decision, via layer.setVisible
  let _lastPreset = null;
  let _frames = 0, _warnedMatrix = false;
  let _mat = null, _loc = null, _s3 = null;   // per-frame scratch
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

  // ── Materials and geometry helpers ──────────────────────────────────────
  function material(opts) {
    if (!U) throw new Error('[slopes] material() before initSlopes — three.js not ready');
    const T = window.THREE;
    const o = opts || {};
    return new T.ShaderMaterial({
      uniforms: U,                    // SHARED, deliberately: one hour, one sun, every mesh
      vertexShader: VERT, fragmentShader: FRAG,
      side: o.side != null ? o.side : T.FrontSide,
      depthTest: true, depthWrite: true, transparent: false, blending: T.NoBlending,
    });
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
    return geom;
  }
  function add(obj) { if (root) root.add(obj); if (_map) _map.triggerRepaint(); return obj; }
  function remove(obj) { if (root) root.remove(obj); if (_map) _map.triggerRepaint(); }

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
  function build() {
    const T = window.THREE;
    const pos = [], nrm = [], cd = [], cg = [], cn = [], fc = [];
    const cache = new Map();
    const rgb = hex => { let c = cache.get(hex); if (!c) { c = hexToRgb01(hex); cache.set(hex, c); } return c; };
    // `facet(true)` marks everything pushed after it as a roof facet for
    // SLOPES.facetShade (a sloped face shaded like the slab it replaces);
    // `facet(false)` ends the run. Walls, decks, domes and arches never set it.
    let _facet = 0;
    const push = (p, n, col) => {
      pos.push(p[0], p[1], p[2]); nrm.push(n[0], n[1], n[2]); fc.push(_facet);
      const d = rgb(col[0]), g = rgb(col[1]), k = rgb(col[2]);
      cd.push(d[0], d[1], d[2]); cg.push(g[0], g[1], g[2]); cn.push(k[0], k[1], k[2]);
    };
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    let tris = 0;
    function tri(a, b, c, col, want) {
      let n = cross(sub(b, a), sub(c, a));
      const L = Math.hypot(n[0], n[1], n[2]);
      if (L < 1e-9) return;                        // degenerate: nothing to draw
      n = [n[0] / L, n[1] / L, n[2] / L];
      if (want && dot(n, want) < 0) { const t = b; b = c; c = t; n = [-n[0], -n[1], -n[2]]; }
      push(a, n, col); push(b, n, col); push(c, n, col); tris++;
    }
    function quad(a, b, c, d, col, want) { tri(a, b, c, col, want); tri(a, c, d, col, want); }
    /** A triangle with its own per-vertex normals (a smooth-shaded curve); wound to face their mean. */
    function triN(a, b, c, na, nb, nc, col) {
      let n = cross(sub(b, a), sub(c, a));
      const L = Math.hypot(n[0], n[1], n[2]);
      if (L < 1e-9) return;
      n = [n[0] / L, n[1] / L, n[2] / L];
      const avg = [na[0] + nb[0] + nc[0], na[1] + nb[1] + nc[1], na[2] + nb[2] + nc[2]];
      if (dot(n, avg) < 0) { let t = b; b = c; c = t; t = nb; nb = nc; nc = t; }
      push(a, na, col); push(b, nb, col); push(c, nc, col); tris++;
    }
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
    function geometry() {
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new T.Float32BufferAttribute(nrm, 3));
      g.setAttribute('cDay', new T.Float32BufferAttribute(cd, 3));
      g.setAttribute('cGold', new T.Float32BufferAttribute(cg, 3));
      g.setAttribute('cNight', new T.Float32BufferAttribute(cn, 3));
      g.setAttribute('aGrad', new T.Float32BufferAttribute(new Float32Array(pos.length / 3 * 2), 2));
      g.setAttribute('aFacet', new T.Float32BufferAttribute(fc, 1));
      g.computeBoundingSphere();
      return g;
    }
    function facet(v) { _facet = v ? 1 : 0; }
    return { tri, triN, quad, polygon, extrude, geometry, facet, get triangles() { return tris; } };
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
      _fetches.set(url, fetch(url).then(r => { if (!r.ok) throw new Error(url + ': ' + r.status); return r.json(); }));
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
      try { if (renderer) renderer.dispose(); } catch (e) {}
      renderer = null; _frames = 0;
    },
    /** js/lod.js calls this instead of setLayoutProperty for custom layers. */
    setVisible(v) { _visible = !!v; if (_map) _map.triggerRepaint(); },
    isVisible() { return _visible; },
    render(gl, args) {
      // The switch, read LIVE every frame — never cached at onAdd.
      if (!SLOPES.on || !scene) return;
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
      if (!any) return;
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
      renderer.resetState();
      renderer.render(scene, camera);
      _frames++;
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

    U = {
      u_lightpos: { value: new T.Vector3(0, 0, 1) },
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

  window.slopes = {
    toLocal, toLngLat, project, raycast, material, colour, add, remove, detail,
    onSwitch, build, frame, stats, fetchJSON,
    light: () => ({ enu: _light.enu.slice(), colour: _light.colour.slice(), intensity: _light.intensity }),
    get scene() { return scene; }, get root() { return root; }, get camera() { return camera; },
    get renderer() { return renderer; }, get layer() { return layer; },
    get origin() { return originMerc; }, get scale() { return originScale; },
    get frames() { return _frames; }, get debugGroup() { return _debugGroup; },
    uniforms: () => U,
  };

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
