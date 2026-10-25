// The v2 water: Lady Bird Lake, Lake Austin, the creeks' wide reaches and the ponds, as a moving, mirroring surface.
// OFF unless ?water=1 (the owner decides; 2026-10-24: "water should look identical" to his Mount Bonnell photographs).
//
// Most of what a lake looks like is what it MIRRORS (the sky, the far shore's trees, the city), not a water colour. So:
//   - one planar reflection per water level (v2's ground is flat: today every body is at level 0, one plane, one extra pass a frame),
//     drawn at a modest resolution and only while some water is in view; it reflects only the sky, buildings, Blender models and
//     trees (never the ground layers, roads, labels or the water itself)
//   - layered, scrolling normal maps (three scales, three directions) that wrinkle that mirror; their mipmaps make far water calm
//     the way real far water reads calm, and the sun's glitter widens with distance instead of sparkling pixel by pixel (rule 15)
//   - Fresnel (Schlick, water's F0): steep views look into the dark water body, grazing views become the sky
//   - sun glitter from the scene's own sun; bright reflected points (the sun's disc, lit windows at night) are torn into vertical
//     streaks, because the wrinkle displaces the mirror more along the view than across it (WATER.STREAK)
// Every taste value is in WATER (rule 11). Data: v2/data/water/osm_water.json (OpenStreetMap, ODbL, its own file;
// scripts/v2/water_bake.py). No shadows on the water yet (the sun is behind the city's towers for Lady Bird Lake at 215 degrees).
//
// Hook (main.js): installWater({ THREE, scene, camera, renderer, sun, dome, holdShadows, redraw, phone }).
import { toLocal } from './geo.js';

const Q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const num = (k, d) => (Q.get(k) != null && Q.get(k) !== '' ? +Q.get(k) : d);

export const WATER = {
  // ── the water body: what comes up out of the water (linear, in the app's light units; the sky's horizon is ~2.5 here) ──
  // Fitted on the owner's midday photograph of Lake Austin from Mount Bonnell (docs/v2-water.md): it reads deep navy-teal.
  BODY: [0.052, 0.095, 0.122],
  F0: 0.02,                       // water's reflectance straight on (n = 1.33)
  // The mirror's strength. Fitted, not physical: with 1.0 the far water came out brighter than the photo and the near water
  // darker (his photo's lake is nearly one tone from 300 m to 160 m: (68, 95, 116) sRGB); ripples steeper than the normal maps
  // and the photo's clouds (the app's sky has none) are what this stands in for.
  REFLECT_GAIN: 0.48,
  // ── the wrinkles: [scale in metres per repeat, direction in degrees (compass, the way the ripples travel), speed m/s, strength] ──
  // Austin's usual wind is from the south: the main wind waves travel north. Speeds are about 0.6 x the deep-water phase speed.
  LAYERS: [[6.5, 10, 2.0, 0.6], [2.2, 340, 1.2, 0.35], [23, 30, 3.0, 0.4]],
  WAVE_SPREAD_DEG: 35,            // the waves in each layer travel within this many degrees of the layer's direction (wind waves: crests line up)
  SLOPE: 0.24,                    // rms wave slope per unit layer strength (Cox-Munk: ~0.15 for a 4 m/s breeze over all layers)
  DISTORT: 0.045,                 // how far a slope of 1 moves the mirror image, in screen widths
  STREAK: 2.6,                    // ...and how much more along the view (up/down on the screen) than across: torn vertical streaks
  DISTORT_NEAR_M: 30,             // the mirror distortion fades in over this distance (no swimming image right under the camera)
  // ── the sun on the water ──
  GLITTER: 1.0,                   // strength of the sun's glitter
  SHININESS: 900,                 // sharpness of one glint close up...
  SHININESS_FAR: 60,              // ...widening to this where one pixel covers many ripples (no pixel sparkle: rule 15)
  SHINE_FAR_M: [60, 1400],        // over this distance range
  // (Measured 2026-10-24, a 0.05-degree-a-frame pan at street level with the waves frozen: pixels of the water that flip back and
  // forth 0.2 % without glitter, 1.0 % with this lobe. A slope-filtered Cox-Munk glint (LEAN mapping) was tried and flipped 4-8 %:
  // its glints saturate into hard-edged blobs. ?waterglitter=0 turns the glitter off.)
  // ── the reflection pass ──
  RES: 0.5,                       // the mirror's resolution, a share of the canvas (desktop)
  RES_PHONE: 0.35,
  MAX_PX: 1280,                   // and never wider than this
  MSAA: 4,                        // multisampling of the mirror (desktop; 0 on the phone): no stair-stepped reflected edges
  REFLECT_FAR_M: 2500,            // the mirror camera draws to this distance (the far shore's trees and towers; past it, haze)
  // The mirror pass runs only while some water in view is nearer than this; farther water mirrors the sky alone (computed, no
  // pass), blending over the last quarter of the distance. Measured 2026-10-24: with the pass on whenever ANY piece of water was in
  // the view cone (a pond behind the towers, the lake 2 km off), views with no visible water paid for it.
  MIRROR_FAR_M: 1500,
  MIRROR_FAR_M_PHONE: 900,
  // ...and only for bodies at least this big (the two lakes and the river below the dam): ponds and creek reaches near campus sat
  // inside the view cone, hidden behind buildings, and switched the pass on in views that show no water at all. They mirror the sky.
  MIRROR_MIN_BODY_M2: 100000,
  ANIMATE_FAR_M: 3000,
  REFLECT_GROUPS: ['city', 'blender-tiles', 'trees'],   // the scene's top-level groups the mirror shows (plus the sky)            // the app keeps redrawing (moving water) only while water in view is nearer than this
  LIFT_M: 0.03,                   // the surface sits this far over the flat ground (under the roads: bridges stay on top)
  RENDER_ORDER: 0.8,              // over the aerial ground (0.5-0.7), under the modelled asphalt (0.9) and the roads (1)
  ANIMATE: true,                  // the water moves (the app redraws every frame while water is in view)
  NORMAL_PX: 256,                 // the generated normal map's size (tileable, mipmapped)
  WAVES: 48,                      // waves summed into it
};
// query overrides for calibration (?waterbody=r,g,b etc.); never needed by a viewer
if (Q.get('waterbody')) WATER.BODY = Q.get('waterbody').split(',').map(Number);
WATER.REFLECT_GAIN = num('waterrefl', WATER.REFLECT_GAIN);
WATER.SLOPE = num('waterslope', WATER.SLOPE);
WATER.DISTORT = num('waterdistort', WATER.DISTORT);
WATER.RES = num('waterres', WATER.RES);
WATER.GLITTER = num('waterglitter', WATER.GLITTER);
if (Q.get('waterstill') === '1') WATER.ANIMATE = false;

const REFLECT_LAYER = 7;

// A tileable field of slopes (x, z) from WATER.WAVES integer-wavenumber waves (so it repeats exactly), steeper waves short. Seeded:
// the same map on every load. RG = slope x, slope z (0.5 = flat), mipmapped.
function normalTexture(THREE, size, waves, spreadDeg) {
  let s = 1234567;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const W = [];
  for (let i = 0; i < waves; i++) {
    const k = 1 + Math.floor(rnd() * rnd() * 14);          // wavenumber 1..14 per repeat, mostly long
    const a = Math.PI / 2 + (rnd() * 2 - 1) * (spreadDeg * Math.PI / 180) + (rnd() < 0.5 ? 0 : Math.PI);   // around the layer's own axis (v)
    const kx = Math.round(Math.cos(a) * k), kz = Math.round(Math.sin(a) * k);
    if (!kx && !kz) continue;
    const kk = Math.hypot(kx, kz);
    W.push([kx, kz, (0.9 / kk) * (0.6 + 0.4 * rnd()), rnd() * Math.PI * 2]);
  }
  const d = new Uint8Array(size * size * 4);
  const sx = new Float32Array(size * size), sz = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let gx = 0, gz = 0;
    for (const [kx, kz, amp, ph] of W) {
      const t = (2 * Math.PI * (kx * x + kz * y)) / size + ph;
      const c = Math.cos(t) * amp * 2 * Math.PI;           // d/du of amp*sin(t), per repeat
      gx += c * kx; gz += c * kz;
    }
    sx[y * size + x] = gx; sz[y * size + x] = gz;
  }
  // stored as slope / (4 x rms), so the shader's decode (x 4) gives slopes of rms 1 per axis (clipped at 4 rms: rare peaks only)
  let ss = 0;
  for (let i = 0; i < size * size; i++) ss += sx[i] * sx[i] + sz[i] * sz[i];
  const rms = Math.sqrt(ss / (2 * size * size)), q = (v) => Math.round(127.5 + Math.max(-1, Math.min(1, v / (4 * rms))) * 127);
  for (let i = 0; i < size * size; i++) { d[i * 4] = q(sx[i]); d[i * 4 + 1] = q(sz[i]); d[i * 4 + 2] = 255; d[i * 4 + 3] = 255; }
  const t = new THREE.DataTexture(d, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true;
  return t;
}

export async function installWater({ THREE, scene, camera, renderer, sun, dome, holdShadows = () => {}, redraw = () => {}, phone = false }) {
  const url = new URL('./data/water/osm_water.json', import.meta.url).href;
  const data = await fetch(url).then((r) => r.json());

  // ── meshes: one per baked piece (500 m squares), grouped by level, so the camera's frustum culls the water it does not see ──
  const levels = new Map();
  for (const f of data.features) {
    const lv = f.properties.level || 0;
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    const pos = [], idx = [];
    for (const rings of polys) {
      const pts = rings.map((r) => r.slice(0, -1).map(([lon, lat]) => { const [x, z] = toLocal(lon, lat); return new THREE.Vector2(x, -z); }));
      const tris = THREE.ShapeUtils.triangulateShape(pts[0], pts.slice(1));
      const base = pos.length / 3;
      for (const ring of pts) for (const p of ring) pos.push(p.x, 0, -p.y);
      for (const t of tris) idx.push(base + t[0], base + t[2], base + t[1]);
    }
    if (!idx.length) continue;
    (levels.get(lv) || levels.set(lv, { pos: [], idx: [], pieces: [] }).get(lv)).pieces.push({ pos, idx, body: f.properties.body_m2 || f.properties.area_m2 });
  }

  const normalMap = normalTexture(THREE, WATER.NORMAL_PX, WATER.WAVES, WATER.WAVE_SPREAD_DEG);
  normalMap.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const sunCol = new THREE.Vector3(sun.color.r, sun.color.g, sun.color.b).multiplyScalar(sun.intensity);
  const sunDir = new THREE.Vector3();
  const layers = WATER.LAYERS.map(([m, deg, v, a]) => {
    const r = THREE.MathUtils.degToRad(deg);
    // travel direction in the scene frame (x east, z south): compass deg -> (sin, -cos)
    return { scale: 1 / m, dir: new THREE.Vector2(Math.sin(r), -Math.cos(r)), speed: v / m, amp: a };
  });

  const planes = [];
  for (const [lv, L] of levels) {
    const size = new THREE.Vector2();
    const rt = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType, samples: phone ? 0 : WATER.MSAA, depthBuffer: true });
    rt.texture.generateMipmaps = false; rt.texture.minFilter = THREE.LinearFilter;
    const mirrorCam = new THREE.PerspectiveCamera();
    mirrorCam.layers.set(REFLECT_LAYER);
    const textureMatrix = new THREE.Matrix4();
    const U = {
      tReflect: { value: rt.texture }, tNormal: { value: normalMap }, textureMatrix: { value: textureMatrix },
      time: { value: 0 }, body: { value: new THREE.Vector3(...WATER.BODY) }, f0: { value: WATER.F0 }, reflGain: { value: WATER.REFLECT_GAIN },
      slope: { value: WATER.SLOPE }, distort: { value: new THREE.Vector2(WATER.DISTORT, WATER.DISTORT * WATER.STREAK) }, distortNear: { value: WATER.DISTORT_NEAR_M },
      glitter: { value: WATER.GLITTER }, shine: { value: new THREE.Vector2(WATER.SHININESS, WATER.SHININESS_FAR) },
      shineFar: { value: new THREE.Vector2(...WATER.SHINE_FAR_M) },
      sunDir: { value: sunDir }, sunCol: { value: sunCol },
      mirrorOn: { value: 0 }, mirrorFar: { value: phone ? WATER.MIRROR_FAR_M_PHONE : WATER.MIRROR_FAR_M },
      skySines: { value: dome.material.uniforms.sines.value }, skyCols: { value: dome.material.uniforms.cols.value }, skyScale: { value: dome.material.uniforms.scale.value },
      lScale: { value: layers.map((l) => l.scale) }, lDir: { value: layers.map((l) => l.dir) }, lSpeed: { value: layers.map((l) => l.speed) }, lAmp: { value: layers.map((l) => l.amp) },
    };
    const mat = new THREE.ShaderMaterial({
      name: 'v2-water', uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]), fog: true, depthWrite: false, side: THREE.DoubleSide,   // the pieces' winding is whatever the triangulation gave; the camera is always above
      defines: { NL: layers.length, NS: dome.material.uniforms.sines.value.length, DEBUG: { refl: 1, fresnel: 2 }[Q.get('waterdebug')] || 0 },
      vertexShader: /* glsl */`
        uniform mat4 textureMatrix;
        varying vec4 vRefl; varying vec3 vWorld;
        #include <fog_pars_vertex>
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          vRefl = textureMatrix * wp;
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D tReflect, tNormal;
        uniform float time, f0, reflGain, slope, glitter, distortNear;
        uniform vec3 body, sunDir, sunCol;
        uniform vec2 distort, shine, shineFar;
        uniform float lScale[NL], lSpeed[NL], lAmp[NL]; uniform vec2 lDir[NL];
        uniform float mirrorOn, mirrorFar; uniform float skySines[NS]; uniform vec3 skyCols[NS], skyScale;
        vec3 skyAt(vec3 d) {      // the visible dome's sky (main.js skyMaterial, without the sun's halo): what far water mirrors
          vec3 c = skyCols[0];
          for (int i = 1; i < NS; i++) if (d.y > skySines[i - 1]) c = mix(skyCols[i - 1], skyCols[i], clamp((d.y - skySines[i - 1]) / (skySines[i] - skySines[i - 1]), 0.0, 1.0));
          return c * skyScale;
        }
        varying vec4 vRefl; varying vec3 vWorld;
        #include <common>
        #include <fog_pars_fragment>
        void main() {
          vec3 toEye = cameraPosition - vWorld;
          float dist = length(toEye);
          vec3 V = toEye / dist;
          // layered wrinkles: each layer's slopes (rotated into its travel direction), scrolled along it
          vec2 s = vec2(0.0);
          for (int i = 0; i < NL; i++) {
            vec2 d = lDir[i];
            vec2 p = vWorld.xz * lScale[i];
            vec2 uv = vec2(dot(p, vec2(d.y, -d.x)), dot(p, d)) - vec2(0.0, time * lSpeed[i]);
            vec2 t = (texture2D(tNormal, uv).rg * 2.0 - 1.0) * 4.0;   // slopes, rms 1
            s += lAmp[i] * (t.x * vec2(d.y, -d.x) + t.y * d);
          }
          s *= slope;
          vec3 N = normalize(vec3(-s.x, 1.0, -s.y));
          // the mirror, wrinkled: the slope seen on the screen moves the image, more along the view than across it (streaks)
          vec3 nv = (viewMatrix * vec4(N.x, 0.0, N.z, 0.0)).xyz;
          float nearK = smoothstep(0.0, distortNear, dist);
          vec2 ruv = vRefl.xy / vRefl.w + vec2(nv.x, nv.y) * distort * nearK;
          vec3 R = reflect(-V, N);
          float mk = mirrorOn * (1.0 - smoothstep(mirrorFar * 0.75, mirrorFar, dist));
          vec3 refl = skyAt(R);
          if (mk > 0.0) refl = mix(refl, texture2D(tReflect, ruv).rgb, mk);
          float cosT = clamp(dot(N, V), 0.0, 1.0);
          float F = f0 + (1.0 - f0) * pow(1.0 - cosT, 5.0);
          vec3 col = mix(body, refl * reflGain, F);
          // the sun's glitter: a Phong lobe on the wrinkled normal, wider where a pixel covers many ripples
          float sh = mix(shine.x, shine.y, smoothstep(shineFar.x, shineFar.y, dist));
          float g = pow(max(dot(R, sunDir), 0.0), sh) * (sh + 2.0) / 8.0;
          col += sunCol * glitter * g * F;
          #if DEBUG == 1
          col = refl;
          #elif DEBUG == 2
          col = vec3(F);
          #endif
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    Object.assign(mat.uniforms, U);
    const group = new THREE.Group(); group.name = 'water level ' + lv;
    const plane = { level: lv, group, rt, mirrorCam, textureMatrix, mat, size, drawnAt: -1, near: Infinity };
    for (const P of L.pieces) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(P.pos, 3));
      g.setIndex(P.idx);
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat);
      m.position.y = lv + WATER.LIFT_M; m.renderOrder = WATER.RENDER_ORDER; m.name = 'water';
      m.userData.noReflect = true;
      m.updateMatrixWorld();
      plane.spheres = plane.spheres || [];
      if (P.body >= WATER.MIRROR_MIN_BODY_M2) plane.spheres.push(g.boundingSphere.clone().applyMatrix4(m.matrixWorld));
      group.add(m);
    }
    scene.add(group);
    planes.push(plane);
  }

  // ── what the mirror reflects: tagged on its own layer. Only the sky dome and the top-level groups in WATER.REFLECT_GROUPS (plain
  // buildings, Blender models, trees), and inside them only what writes depth. Never the ground, the aerial, roads, paint, the route,
  // map layers, the water itself, or the street furniture and near-street layers (hundreds of small draws at street level for
  // reflections a few pixels tall: measured on the AWS L4, a mirror of "everything that writes depth" doubled the frame's CPU time).
  function tag() {
    dome.layers.enable(REFLECT_LAYER);
    for (const top of scene.children) {
      const want = WATER.REFLECT_GROUPS.includes(top.name);
      top.traverse((o) => {
        if (!(o.isMesh || o.isInstancedMesh)) return;
        const m = Array.isArray(o.material) ? o.material[0] : o.material;
        if (want && m && m.depthWrite !== false && !o.userData.noReflect) o.layers.enable(REFLECT_LAYER);
        else if (o !== dome) o.layers.disable(REFLECT_LAYER);
      });
    }
  }
  let tagAt = 0;

  const reflPos = new THREE.Vector3(), normal = new THREE.Vector3(0, 1, 0), camPos = new THREE.Vector3(), rot = new THREE.Matrix4();
  const lookAt = new THREE.Vector3(), target = new THREE.Vector3(), view = new THREE.Vector3();
  const bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  const canvasSize = new THREE.Vector2();
  const stats = { passes: 0, ms: 0, w: 0, h: 0 };
  function drawMirror(P, cam) {
    const t0 = performance.now();
    if (t0 - tagAt > 1000) { tagAt = t0; tag(); }
    // size: a share of the canvas
    renderer.getDrawingBufferSize(canvasSize);
    const k = Math.min((phone ? WATER.RES_PHONE : WATER.RES), WATER.MAX_PX / canvasSize.x);
    const w = Math.max(64, Math.round(canvasSize.x * k)), h = Math.max(64, Math.round(canvasSize.y * k));
    if (P.rt.width !== w || P.rt.height !== h) P.rt.setSize(w, h);
    // the mirror camera (three.js Reflector's construction, without the oblique near plane: nothing in v2 lies under the water)
    reflPos.set(0, P.level + WATER.LIFT_M, 0);
    camPos.setFromMatrixPosition(cam.matrixWorld);
    view.subVectors(reflPos, camPos);
    if (view.dot(normal) > 0) return;     // under the water: nothing to mirror
    reflPos.set(camPos.x, P.level + WATER.LIFT_M, camPos.z);
    view.subVectors(reflPos, camPos).reflect(normal).negate().add(reflPos);
    rot.extractRotation(cam.matrixWorld);
    lookAt.set(0, 0, -1).applyMatrix4(rot).add(camPos);
    target.subVectors(reflPos, lookAt).reflect(normal).negate().add(reflPos);
    const mc = P.mirrorCam;
    mc.position.copy(view);
    mc.up.set(0, 1, 0).applyMatrix4(rot).reflect(normal);
    mc.lookAt(target);
    mc.fov = cam.fov; mc.aspect = cam.aspect; mc.near = cam.near; mc.far = Math.min(cam.far, WATER.REFLECT_FAR_M);
    mc.updateProjectionMatrix();
    mc.updateMatrixWorld();
    P.textureMatrix.copy(bias).multiply(mc.projectionMatrix).multiply(mc.matrixWorldInverse);
    // the pass: the dome centred on the mirror camera, no shadow-map redraw (the main pass's map is current), into the target
    const prevTarget = renderer.getRenderTarget(), domePos = dome.position.clone(), domeScale = dome.scale.x, prevXr = renderer.xr.enabled;
    renderer.xr.enabled = false;
    dome.position.copy(mc.position);
    // the dome is drawn at 0.8 x the main camera's far plane; inside the mirror's shorter far plane it must shrink to be seen
    if (!dome.geometry.boundingSphere) dome.geometry.computeBoundingSphere();
    dome.scale.setScalar(Math.min(1, (mc.far * 0.9) / dome.geometry.boundingSphere.radius));
    dome.updateMatrixWorld();
    holdShadows(true);
    const prevAuto = renderer.shadowMap.autoUpdate; renderer.shadowMap.autoUpdate = false;
    try {
      renderer.setRenderTarget(P.rt);
      renderer.render(scene, mc);
    } finally {
      holdShadows(false); renderer.shadowMap.autoUpdate = prevAuto;
      dome.position.copy(domePos); dome.scale.setScalar(domeScale); dome.updateMatrixWorld();
      renderer.xr.enabled = prevXr;
      renderer.setRenderTarget(prevTarget);
    }
    stats.passes++; stats.ms += performance.now() - t0; stats.w = w; stats.h = h;
  }

  // ── once per render of the city (scene.onBeforeRender: also the verify scripts' direct renders): which water is in view and how
  // near; the mirror pass when some is near enough. Runs before three.js builds its render lists, so the pass nests safely.
  const frustum = new THREE.Frustum(), pv = new THREE.Matrix4();
  const prevHook = scene.onBeforeRender;
  scene.onBeforeRender = function (r, s, cam, target) {
    prevHook.call(this, r, s, cam, target);
    if (cam !== camera || target) return;
    pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    frustum.setFromProjectionMatrix(pv, THREE.WebGLCoordinateSystem, cam.reversedDepth);
    camPos.setFromMatrixPosition(cam.matrixWorld);
    const far = phone ? WATER.MIRROR_FAR_M_PHONE : WATER.MIRROR_FAR_M;
    for (const P of planes) {
      let near = Infinity;
      for (const sp of P.spheres) if (frustum.intersectsSphere(sp)) near = Math.min(near, Math.max(0, sp.center.distanceTo(camPos) - sp.radius));
      P.near = near;
      const on = near < far;
      P.mat.uniforms.mirrorOn.value = on ? 1 : 0;
      if (on) { drawMirror(P, cam); P.drawnAt = performance.now(); }
      if (near < WATER.ANIMATE_FAR_M) P.seenAt = performance.now();
    }
  };

  const t0 = performance.now();
  let fixedTime = null;
  const api = {
    WATER, planes, stats, near: () => planes.map((P) => P.near),
    // called by main.js every frame before rendering; returns true while water is in view and moving (main.js keeps redrawing)
    update(now) {
      for (const P of planes) {
        P.mat.uniforms.time.value = fixedTime != null ? fixedTime : WATER.ANIMATE ? (now - t0) / 1000 : 0;
        sunDir.copy(sun.position).sub(sun.target.position).normalize();
      }
      return WATER.ANIMATE && fixedTime == null && planes.some((P) => now - (P.seenAt || -1e9) < 250);
    },
    setTime(sec) { fixedTime = sec; },     // the verify scripts: a fixed instant (null = run the clock)
    tag,
  };
  tag();
  redraw();
  return api;
}
