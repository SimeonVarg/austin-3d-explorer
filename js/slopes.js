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
 * NOTHING DRAWS BY DEFAULT YET. This is the plumbing — the part that makes a
 * mesh behave exactly like the fill-extrusion building next to it — plus a
 * debug scene (?slopesdebug=1) that proves each piece. The generators (roof
 * rigs, arches, the dome lathe) land on `slopes.add()` and `slopes.material()`
 * and never touch MapLibre. scripts/verify/slopes-layer.mjs asserts all of it
 * from pixels; read its header for the numbers.
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
 *   8. LOD. js/lod.js hides `roofs-pitched` at altitude with
 *      setLayoutProperty, which a custom layer does not have. It now calls
 *      `implementation.setVisible(bool)` on any custom layer in its tiers, and
 *      this layer is in the same `mid` tier as the slabs, so the mesh goes at
 *      the same altitude they do.
 *
 * Public (window) API:
 *   SLOPES                         — the taste block; SLOPES.on is the switch
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
    uniform float u_p;
    attribute vec3 cDay;
    attribute vec3 cGold;
    attribute vec3 cNight;
    attribute vec2 aGrad;
    varying vec4 v_color;
    void main() {
      vec3 color = (u_p <= 0.5) ? mix(cDay, cGold, u_p * 2.0)
                                : mix(cGold, cNight, (u_p - 0.5) * 2.0);
      float colorvalue = color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
      color += vec3(0.03);
      vec3 n = normalize(normal);
      float directional = clamp(dot(n, u_lightpos), 0.0, 1.0);
      directional = mix(1.0 - u_lightintensity,
                        max(1.0 - colorvalue + u_lightintensity, 1.0), directional);
      if (aGrad.y > 0.0 && n.y != 0.0) {
        directional *= (1.0 - u_vertical_gradient) + u_vertical_gradient *
          clamp(aGrad.x * sqrt(aGrad.y / 150.0), mix(0.7, 0.98, 1.0 - u_lightintensity), 1.0);
      }
      vec3 lit = clamp(color * directional * u_lightcolor,
                       mix(vec3(0.0), vec3(0.3), vec3(1.0) - u_lightcolor), vec3(1.0));
      v_color = vec4(lit, 1.0) * u_opacity;
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
    return geom;
  }
  function add(obj) { if (root) root.add(obj); if (_map) _map.triggerRepaint(); return obj; }
  function remove(obj) { if (root) root.remove(obj); if (_map) _map.triggerRepaint(); }

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
      if (!SLOPES.on || !_visible || !scene) return;
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
  window.applySlopesSettings = function applySlopesSettings(map) {
    map = map || _map;
    if (!U || !map) return;
    U.u_vertical_gradient.value = SLOPES.verticalGradient;
    U.u_opacity.value = SLOPES.opacity;
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
      u_p: { value: pq(window.__todCurrentP != null ? window.__todCurrentP : 0.5) },
    };
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
