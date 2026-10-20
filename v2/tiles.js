// Streams the Blender-model tiles listed in a manifest (the contract: v2/tiles/manifest.json, built on mac/v2-tiles).
//   - every tile draws its FULL model (lod0) at every distance: there is no swap to a lesser far copy (owner, 2026-10-18:
//     "get rid of the rule that converts buildings to bad lesser detailed ones when theyre at a distance"). The manifest's lod1
//     files and per-tile lod1_m are no longer read;
//   - the nearest tiles in view load first, then the nearest out of view; tiles beyond LOAD_DISTANCE_M are not loaded;
//   - at most MAX_DECODES loads (fetch + meshopt decode + parse) run at once;
//   - a load whose tile is no longer wanted is aborted, or thrown away the moment it finishes;
//   - a tile that arrives FADES in instead of popping (FADE): the plain extrusions it replaces first fade into the haze, then
//     the model takes their place and fades out of the haze (both opaque, no sorting, no dither: see setFade / the haze mix);
//   - tiles beyond UNLOAD_DISTANCE_M are removed and their GPU memory freed; three.js frustum-culls every mesh.
// While a tile is on screen its buildings' map ids are hidden in the plain extrusions (onShow / onHide).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { LOOK } from './look.js';

export const TILES = {
  MAX_DECODES: 2,
  LOAD_DISTANCE_M: 2600,       // tiles nearer than this are wanted
  UNLOAD_DISTANCE_M: 3200,     // tiles beyond this are dropped (must be > LOAD_DISTANCE_M)
  TILE_TOP_M: 160,             // assumed top of a tile, for the in-view test
  UPDATE_EVERY_MS: 200,        // how often the load plan is made again (the fades run every frame)
  MAX_TRIES: 2,                // a tile that fails this many times is left out (the plain extrusions stay)
  FADE: {
    OUT_MS: 350,               // the plain extrusions a tile replaces fade into the haze over this
    IN_MS: 650,                // then the model fades out of the haze over this
  },
};

const smooth = (k) => k * k * (3 - 2 * k);

// The fade: every lit material of a tile mixes its final colour toward the haze colour (main.js fog_fragment's hazeC) by uFade.
// One uniform per tile, shared by the tile's materials; the program is shared by every tile (customProgramCacheKey).
// The baked ambient occlusion (vertex attribute _AO, scripts/v2/ao_bake.mjs; LOOK.AO): multiplies the indirect light only, as
// three.js's own aoMap does (diffuse sky + bounce, and the specular occlusion of what the surface mirrors). Tiles without the
// attribute draw as before.
const AO_STRENGTH = { value: LOOK.AO.STRENGTH };
const AO_FAR = { value: new THREE.Vector4(...LOOK.AO.FAR_PX_M) };
const AO_SHOW = typeof location !== 'undefined' && new URLSearchParams(location.search).get('aoshow') === '1';   // diagnosis: draw the baked AO itself
function fadeable(material, uniform, ao) {
  if (!material || material.userData.v2Fade) return;
  material.userData.v2Fade = true;
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    sh.uniforms.uFade = uniform;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uFade;')
      .replace('#include <fog_fragment>', '#include <fog_fragment>\n#ifdef USE_FOG\n  gl_FragColor.rgb = mix(gl_FragColor.rgb, hazeC, uFade);\n#endif');
    if (ao) {
      sh.uniforms.uAOStrength = AO_STRENGTH;
      sh.uniforms.uAOFar = AO_FAR;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 _ao;\nvarying float vV2AO;\nvarying float vV2AOF;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvV2AO = _ao.x;\nvV2AOF = _ao.y;');
      if (AO_SHOW) sh.fragmentShader = sh.fragmentShader.replace('#include <dithering_fragment>', '#include <dithering_fragment>\n  gl_FragColor = vec4(vec3(v2aoSeen), 1.0);');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vV2AO;\nvarying float vV2AOF;\nuniform float uAOStrength;\nuniform vec4 uAOFar;\nfloat v2aoSeen = 1.0;')
        .replace('#include <aomap_fragment>', `#include <aomap_fragment>
  {
    // near: the AO of each face; as a pixel grows (metres per pixel, uAOFar.xy) the far AO (the same box-filtered over a few metres),
    // and as it grows on (uAOFar.zw) none: far off, the city draws as it did before the AO
    float v2px = max(length(dFdx(vViewPosition)), length(dFdy(vViewPosition)));
    float v2raw = mix(mix(vV2AO, vV2AOF, smoothstep(uAOFar.x, uAOFar.y, v2px)), 1.0, smoothstep(uAOFar.z, uAOFar.w, v2px));
    v2aoSeen = v2raw;
    float v2ao = clamp(mix(1.0, v2raw, uAOStrength), 0.0, 1.0);
    reflectedLight.indirectDiffuse *= v2ao;
    #if defined( USE_ENVMAP ) && defined( STANDARD )
      float v2dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
      reflectedLight.indirectSpecular *= computeSpecularOcclusion( v2dotNV, v2ao, material.roughness );
    #endif
  }`);
    }
  };
  const key = material.customProgramCacheKey ? material.customProgramCacheKey.bind(material) : () => '';
  material.customProgramCacheKey = () => key() + '|v2-fade' + (ao ? '|v2-ao' : '');
  material.needsUpdate = true;
}
// The models' shadow-map depth, pushed away from the sun by their slope (LOOK.SHADOW_SLOPE_BIAS): no self-shadow stripes on lit faces.
// (three.js flips the factor's sign itself under a reversed depth buffer.)
const shadowDepth = LOOK.SHADOW_SLOPE_BIAS > 0
  ? new THREE.MeshDepthMaterial({ polygonOffset: true, polygonOffsetFactor: LOOK.SHADOW_SLOPE_BIAS, polygonOffsetUnits: 0 }) : null;

export class TileStreamer {
  constructor({ scene, camera, manifestUrl, onShow, onHide, onChange, onFade, onAnimate, prepare }) {
    this.scene = scene; this.camera = camera; this.url = manifestUrl;
    this.prepare = prepare || (() => {});
    this.onShow = onShow || (() => {}); this.onHide = onHide || (() => {}); this.onChange = onChange || (() => {});
    this.onFade = onFade || (() => {});          // (mapIds, k): the plain extrusions of these ids at k of the way into the haze
    this.onAnimate = onAnimate || (() => {});    // a fade moved: draw a frame
    this.group = new THREE.Group(); this.group.name = 'blender-tiles';
    scene.add(this.group);
    this.tiles = new Map();          // id -> state
    this.fading = new Set();         // states with a fade running
    this.active = 0;
    this.loader = new GLTFLoader();
    try { MeshoptDecoder.useWorkers && MeshoptDecoder.useWorkers(2); } catch (e) {}
    this.loader.setMeshoptDecoder(MeshoptDecoder);
    this.last = 0;
    this.stats = { loaded: 0, aborted: 0, discarded: 0, disposed: 0, failed: 0, bytes: 0 };
    this.frustum = new THREE.Frustum(); this.m = new THREE.Matrix4(); this.box = new THREE.Box3();
    this.instant = false;            // true: tiles appear at once (pictures, the verify scripts' settled views)
  }

  async load() {
    const r = await fetch(this.url, { cache: 'no-cache' });
    if (!r.ok) throw new Error('manifest ' + r.status);
    this.manifest = await r.json();
    // tile paths in the manifest are relative to the APP (v2/), as in the contract: "lod0": "tiles/t_i_j.glb"
    this.base = new URL('./', import.meta.url).href;
    for (const t of this.manifest.tiles || []) {
      if (!t.lod0) continue;                                   // a tile with no full model is not drawn (the extrusions stay)
      const mapIds = [];
      for (const slug of t.buildings || []) { const b = this.manifest.buildings?.[slug]; if (b?.map_ids) mapIds.push(...b.map_ids.map(String)); }
      this.tiles.set(t.id, { def: t, mapIds, want: null, have: null, obj: null, job: null, fade: null });
    }
    return this.manifest;
  }

  // Which tiles should be loaded now (want = 'lod0' or null), from the camera position.
  plan() {
    const cam = this.camera.position;
    this.camera.updateMatrixWorld();
    this.m.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.m);
    const order = [];
    for (const s of this.tiles.values()) {
      const [x0, z0, x1, z1] = s.def.bounds;
      const dx = Math.max(x0 - cam.x, 0, cam.x - x1), dz = Math.max(z0 - cam.z, 0, cam.z - z1);
      const d = Math.hypot(dx, dz, Math.max(0, cam.y - TILES.TILE_TOP_M));
      const cur = s.have || s.want;
      const want = d <= (cur ? TILES.UNLOAD_DISTANCE_M : TILES.LOAD_DISTANCE_M) ? 'lod0' : null;
      this.box.min.set(x0, 0, z0); this.box.max.set(x1, TILES.TILE_TOP_M, z1);
      s.want = want; s.d = d; s.inView = this.frustum.intersectsBox(this.box);
      order.push(s);
    }
    return order;
  }

  update(now = performance.now()) {
    if (this.fading.size) this.stepFades(now);
    if (!this.manifest || now - this.last < TILES.UPDATE_EVERY_MS) return;
    this.last = now;
    const all = this.plan();
    this.plannedFor = this.camera.matrixWorld.elements.join(',');
    // cancel loads that are no longer wanted
    for (const s of all) if (s.job && !s.want) { s.job.ctrl.abort(); s.job.stale = true; s.job = null; this.active--; this.stats.aborted++; }
    // drop what is not wanted
    for (const s of all) if (!s.want && s.obj) this.drop(s);
    // queue: in view first, then nearest
    const queue = all.filter((s) => s.want && !s.have && !s.job && (s.failed || 0) < TILES.MAX_TRIES).sort((a, b) => (b.inView - a.inView) || (a.d - b.d));
    while (this.active < TILES.MAX_DECODES && queue.length) this.start(queue.shift());
  }

  start(s) {
    const ctrl = new AbortController();
    const job = { ctrl, stale: false };
    s.job = job; this.active++;
    const url = new URL(s.def.lod0, this.base).href;
    (async () => {
      try {
        const r = await fetch(url, { signal: ctrl.signal });
        if (!r.ok) throw new Error(url + ' ' + r.status);
        const buf = await r.arrayBuffer();
        if (job.stale) return;
        const gltf = await this.loader.parseAsync(buf, url.replace(/[^/]*$/, ''));
        this.stats.bytes += buf.byteLength;
        if (job.stale) { disposeObject(gltf.scene); this.stats.discarded++; return; }
        const obj = gltf.scene;
        obj.name = s.def.id;
        const fade = { value: 0 };
        obj.traverse((o) => {
          if (!o.isMesh) return;
          o.castShadow = true; o.receiveShadow = true; o.frustumCulled = true;
          if (shadowDepth) o.customDepthMaterial = shadowDepth;
          const ao = LOOK.AO.ON && !!o.geometry.attributes._ao && o.geometry.attributes._ao.itemSize === 2;
          if (!ao && o.geometry.attributes._ao) o.geometry.deleteAttribute('_ao');
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) fadeable(m, fade, ao);
        });
        obj.userData.fade = fade;
        this.prepare(obj, s.def, s);   // (s: main.js adds to s.mapIds the plain extrusions this model stands over, covers.js)
        s.obj = obj; s.have = 'lod0';
        this.stats.loaded++;
        this.appear(s, performance.now());
      } catch (e) {
        if (e.name !== 'AbortError') { this.stats.failed++; console.warn('[v2 tiles]', s.def.id, e.message); s.failed = (s.failed || 0) + 1; }
      } finally {
        if (s.job === job) { s.job = null; this.active--; }
      }
    })();
  }

  // A tile has arrived: its extrusions fade out into the haze (OUT_MS), then the model replaces them and fades in (IN_MS).
  appear(s, now) {
    if (this.instant || !(TILES.FADE.OUT_MS + TILES.FADE.IN_MS > 0)) {
      s.obj.userData.fade.value = 0;
      this.group.add(s.obj); this.onShow(s.mapIds, s.def); this.onChange(this);
      return;
    }
    s.fade = { phase: 'out', t0: now };
    this.fading.add(s);
    this.stepFades(now);
  }

  stepFades(now) {
    for (const s of this.fading) {
      const F = s.fade;
      if (!F || !s.obj) { this.fading.delete(s); continue; }
      if (F.phase === 'out') {
        const k = TILES.FADE.OUT_MS > 0 ? Math.min(1, (now - F.t0) / TILES.FADE.OUT_MS) : 1;
        this.onFade(s.mapIds, smooth(k));
        if (k < 1 && !this.instant) continue;
        // swap: the extrusions are fully in the haze; the model takes their place, fully in the haze, and comes out of it
        s.obj.userData.fade.value = 1;
        this.group.add(s.obj);
        this.onShow(s.mapIds, s.def);
        this.onFade(s.mapIds, 0);                 // (hidden now; reset so they come back unfaded if the tile is dropped)
        this.onChange(this);
        F.phase = 'in'; F.t0 = now;
      } else {
        const k = TILES.FADE.IN_MS > 0 ? Math.min(1, (now - F.t0) / TILES.FADE.IN_MS) : 1;
        s.obj.userData.fade.value = this.instant ? 0 : 1 - smooth(k);
        if (k >= 1 || this.instant) { s.obj.userData.fade.value = 0; s.fade = null; this.fading.delete(s); }
      }
    }
    this.onAnimate();
  }

  // Finish every running fade at once (a settled picture, or the loading screen lifting with everything in place).
  settle() {
    const was = this.instant; this.instant = true;
    this.stepFades(performance.now()); this.stepFades(performance.now());
    this.instant = was;
  }

  drop(s) {
    if (s.fade) {
      if (s.fade.phase === 'out') { this.onFade(s.mapIds, 0); s.fade = null; this.fading.delete(s); disposeObject(s.obj); s.obj = null; s.have = null; this.stats.disposed++; return; }
      s.fade = null; this.fading.delete(s);
    }
    this.group.remove(s.obj);
    disposeObject(s.obj);
    s.obj = null; s.have = null;
    this.stats.disposed++;
    this.onHide(s.mapIds, s.def);
    this.onChange(this);
  }

  summary() {
    let lod0 = 0, loading = 0, fading = 0, wanting = 0;
    for (const s of this.tiles.values()) {
      if (s.have === 'lod0' && !(s.fade && s.fade.phase === 'out')) lod0++; if (s.job) loading++; if (s.fade) fading++;
      if (s.want && !s.have && (s.failed || 0) < TILES.MAX_TRIES) wanting++;
    }
    // lod1 stays in the summary (always 0) for the verify scripts that print it; planned = the plan ran since the camera last moved
    const cam = this.camera.matrixWorld.elements.join(',');
    return { tiles: this.tiles.size, lod0, lod1: 0, loading, fading, wanting, planned: this.plannedFor === cam, ...this.stats };
  }
}

export function disposeObject(root) {
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) {
      for (const k in m) { const v = m[k]; if (v && v.isTexture) v.dispose(); }
      m.dispose();
    }
  });
}
