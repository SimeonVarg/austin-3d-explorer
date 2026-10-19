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

// Per-vertex fine repeats. Full original geometry remains at every distance. The tile builder measures
// connected part widths and writes an area mean colour AND normal for each local facade patch.
// Only subpixel features approach that mean; no screen-space blur and no palette-wide repainting.
export const FINE = {
  ON: true,          // trial tiles only; old tiles without _FINE retain their original material
  F0: 0.3,           // > 3.3 pixels: exactly the original colour and shading
  F1: 0.85,          // < 1.2 pixels: the patch mean colour and normal
  TABLE_WIDTH: 1024, // two RGBA half-float texels per patch (colour, world normal)
  NEAR_M: 350,       // preserve the complete 100 m building view, including its far side
  FULL_M: 600,
};

export function fineTexture(fine) {
  if (fine?.version !== 2 || !fine.count) return null;
  const width = FINE.TABLE_WIDTH, height = Math.ceil(fine.count * 2 / width);
  const data = new Uint16Array(width * height * 4);
  const binary = atob(fine.table), bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  if (bytes.length !== fine.count * 12 || !(fine.sizeBase > 0 && fine.sizeSteps > 0)) throw new Error('Invalid fine table');
  for (let i = 0; i < fine.count; i++) for (let k = 0; k < 6; k++) {
    let v = view.getUint16(i * 12 + k * 2, true) / 65535;
    if (k >= 3) v = v * 2 - 1;
    data[i * 8 + (k < 3 ? k : k + 1)] = THREE.DataUtils.toHalfFloat(v);
  }
  for (let i = 0; i < fine.count; i++) {
    // Explicit validity markers: an unbound/failed lookup must retain the original shading.
    data[i * 8 + 3] = data[i * 8 + 7] = THREE.DataUtils.toHalfFloat(1);
  }
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.magFilter = tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
  tex.colorSpace = THREE.NoColorSpace; // table RGB is already linear; normals are signed data
  return { tex, size: new THREE.Vector2(width, height), decode: new THREE.Vector2(fine.sizeBase, fine.sizeSteps), count: fine.count };
}

export function fineable(material, table) {
  if (!material || !table || material.userData.v2Fine) return;
  material.userData.v2Fine = true;
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    sh.uniforms.uFineTex = { value: table.tex };
    sh.uniforms.uFineTableSize = { value: table.size };
    sh.uniforms.uFineDecode = { value: table.decode };
    sh.uniforms.uFine = { value: new THREE.Vector2(FINE.F0, FINE.F1) };
    sh.uniforms.uFineRange = { value: new THREE.Vector2(FINE.NEAR_M, FINE.FULL_M) };
    sh.uniforms.uFineCount = { value: table.count };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
attribute vec4 _fine;
uniform highp sampler2D uFineTex;
uniform vec2 uFineTableSize;
uniform vec2 uFineDecode;
uniform float uFineCount;
varying vec3 vFineW;
varying vec3 vFineMean;
varying vec3 vFineNormal;
varying float vFineSize;
varying float vFineValid;
vec4 fineEntry(float i) {
  // Exact integer texel addressing, independent of sampler LOD and normalized UV precision.
  return texelFetch(uFineTex, ivec2(int(mod(i, uFineTableSize.x)), int(floor(i / uFineTableSize.x))), 0);
}`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
  vFineW = (modelMatrix * vec4(transformed, 1.0)).xyz;
  float patch = floor(_fine.z + 0.5) + 256.0 * floor(_fine.w + 0.5);
  vec4 meanEntry = fineEntry(patch * 2.0);
  vec4 normalEntry = fineEntry(patch * 2.0 + 1.0);
  vFineMean = meanEntry.rgb;
  vFineNormal = mat3(viewMatrix) * normalEntry.xyz;
  vFineValid = patch < uFineCount && uFineDecode.x > 0.0 && uFineDecode.y > 0.0
    && meanEntry.a > 0.5 && normalEntry.a > 0.5 && dot(normalEntry.xyz, normalEntry.xyz) > 0.5 ? 1.0 : 0.0;
  vFineSize = _fine.y < 0.5 ? 1.0e10 : uFineDecode.x * exp2((_fine.y - 1.0) / uFineDecode.y);`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform vec2 uFine;
uniform vec2 uFineRange;
varying vec3 vFineW;
varying vec3 vFineMean;
varying vec3 vFineNormal;
varying float vFineSize;
varying float vFineValid;
float fineK;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
  float mpp = max(length(dFdx(vFineW)), length(dFdy(vFineW)));
  fineK = smoothstep(uFine.x, uFine.y, mpp / vFineSize)
    * smoothstep(uFineRange.x, uFineRange.y, length(vFineW - cameraPosition));
  if (vFineValid < 0.999) fineK = 0.0;
  if (fineK > 0.0) diffuseColor.rgb = mix(diffuseColor.rgb, vFineMean, fineK);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  if (fineK > 0.0) {
    vec3 patchNormal = normalize(vFineNormal);
    // Facing belongs to the facade patch, not to each fin triangle's winding. Otherwise
    // back-facing fin sides flip the mean and recreate the alternating light/dark pattern.
    #ifdef DOUBLE_SIDED
      if (dot(patchNormal, vViewPosition) < 0.0) patchNormal = -patchNormal;
    #endif
    normal = normalize(mix(normal, patchNormal, fineK));
    nonPerturbedNormal = normal;
  }`);
  };
  const key = material.customProgramCacheKey ? material.customProgramCacheKey.bind(material) : () => '';
  material.customProgramCacheKey = () => key() + '|v2-fine-vertex-3';
  material.needsUpdate = true;
}

// The fade: every lit material of a tile mixes its final colour toward the haze colour (main.js fog_fragment's hazeC) by uFade.
// One uniform per tile, shared by the tile's materials; the program is shared by every tile (customProgramCacheKey).
function fadeable(material, uniform) {
  if (!material || material.userData.v2Fade) return;
  material.userData.v2Fade = true;
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    sh.uniforms.uFade = uniform;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uFade;')
      .replace('#include <fog_fragment>', '#include <fog_fragment>\n#ifdef USE_FOG\n  gl_FragColor.rgb = mix(gl_FragColor.rgb, hazeC, uFade);\n#endif');
  };
  const key = material.customProgramCacheKey ? material.customProgramCacheKey.bind(material) : () => '';
  material.customProgramCacheKey = () => key() + '|v2-fade';
  material.needsUpdate = true;
}

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
        const fq = new URLSearchParams(location.search).get('fine');      // ?fine=0 off; ?fine=0.15,0.5 other F0,F1 (to compare)
        const fineOn = FINE.ON && fq !== '0';
        if (fq && fq.includes(',')) { const [a, b] = fq.split(',').map(Number); if (b > a) { FINE.F0 = a; FINE.F1 = b; } }
        const table = fineOn ? fineTexture(gltf.userData.fine) : null;
        obj.userData.v2FineTexture = table?.tex;
        obj.traverse((o) => {
          if (!o.isMesh) return;
          o.castShadow = true; o.receiveShadow = true; o.frustumCulled = true;
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
            if (o.geometry.getAttribute('_fine')) fineable(m, table);
            fadeable(m, fade);
          }
        });
        obj.userData.fade = fade;
        this.prepare(obj, s.def);
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
  root.userData.v2FineTexture?.dispose();
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) {
      for (const k in m) { const v = m[k]; if (v && v.isTexture) v.dispose(); }
      m.dispose();
    }
  });
}
