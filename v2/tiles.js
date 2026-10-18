// Streams the Blender-model tiles listed in a manifest (the contract: v2/tiles/manifest.json, built on mac/v2-tiles).
//   - the nearest tiles in view load first, then the nearest out of view;
//   - at most MAX_DECODES loads (fetch + meshopt decode + parse) run at once;
//   - a load whose tile is no longer wanted is aborted, or thrown away the moment it finishes;
//   - lod1 (the .far.glb) beyond LOD1_DISTANCE_M, back to lod0 inside it, with LOD_HYSTERESIS so a tile on the line does not flip;
//   - tiles beyond UNLOAD_DISTANCE_M are removed and their GPU memory freed.
// While a tile is on screen its buildings' map ids are hidden in the plain extrusions (onShow / onHide).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export const TILES = {
  MAX_DECODES: 2,
  LOD1_DISTANCE_M: 700,        // camera to the tile's nearest edge
  LOD_HYSTERESIS: 0.15,        // switch to lod1 at 700 x 1.15, back to lod0 at 700 x 0.85
  LOAD_DISTANCE_M: 2600,       // tiles nearer than this are wanted
  UNLOAD_DISTANCE_M: 3200,     // tiles beyond this are dropped (must be > LOAD_DISTANCE_M)
  TILE_TOP_M: 160,             // assumed top of a tile, for the in-view test
  UPDATE_EVERY_MS: 200,
  MAX_TRIES: 2,                // a tile that fails this many times is left out (the plain extrusions stay)
};

export class TileStreamer {
  constructor({ scene, camera, manifestUrl, onShow, onHide, onChange, prepare }) {
    this.scene = scene; this.camera = camera; this.url = manifestUrl;
    this.prepare = prepare || (() => {});
    this.onShow = onShow || (() => {}); this.onHide = onHide || (() => {}); this.onChange = onChange || (() => {});
    this.group = new THREE.Group(); this.group.name = 'blender-tiles';
    scene.add(this.group);
    this.tiles = new Map();          // id -> state
    this.active = 0;
    this.loader = new GLTFLoader();
    try { MeshoptDecoder.useWorkers && MeshoptDecoder.useWorkers(2); } catch (e) {}
    this.loader.setMeshoptDecoder(MeshoptDecoder);
    this.last = 0;
    this.stats = { loaded: 0, aborted: 0, discarded: 0, disposed: 0, failed: 0, bytes: 0 };
    this.frustum = new THREE.Frustum(); this.m = new THREE.Matrix4(); this.box = new THREE.Box3();
  }

  async load() {
    const r = await fetch(this.url, { cache: 'no-cache' });
    if (!r.ok) throw new Error('manifest ' + r.status);
    this.manifest = await r.json();
    // tile paths in the manifest are relative to the APP (v2/), as in the contract: "lod0": "tiles/t_i_j.glb"
    this.base = new URL('./', import.meta.url).href;
    for (const t of this.manifest.tiles || []) {
      const mapIds = [];
      for (const slug of t.buildings || []) { const b = this.manifest.buildings?.[slug]; if (b?.map_ids) mapIds.push(...b.map_ids.map(String)); }
      this.tiles.set(t.id, { def: t, mapIds, want: null, have: null, obj: null, job: null });
    }
    return this.manifest;
  }

  // Which lod each tile should have now (null = none), from the camera position.
  plan() {
    const cam = this.camera.position;
    this.m.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.m);
    const H = TILES.LOD_HYSTERESIS;
    const order = [];
    for (const [id, s] of this.tiles) {
      const [x0, z0, x1, z1] = s.def.bounds;
      const dx = Math.max(x0 - cam.x, 0, cam.x - x1), dz = Math.max(z0 - cam.z, 0, cam.z - z1);
      const d = Math.hypot(dx, dz, Math.max(0, cam.y - TILES.TILE_TOP_M));
      const cur = s.have || s.want;
      const L1 = s.def.lod1_m || TILES.LOD1_DISTANCE_M;      // (a tile with a fine repeat in it, Moody Center's fins, asks for lod1 sooner)
      let want;
      if (cur && d > TILES.UNLOAD_DISTANCE_M) want = null;
      else if (!cur && d > TILES.LOAD_DISTANCE_M) want = null;
      else if (cur === 'lod0') want = d > L1 * (1 + H) ? 'lod1' : 'lod0';
      else if (cur === 'lod1') want = d < L1 * (1 - H) ? 'lod0' : 'lod1';
      else want = d > L1 ? 'lod1' : 'lod0';
      if (want && !s.def[want]) want = s.def.lod0 ? 'lod0' : (s.def.lod1 ? 'lod1' : null);
      this.box.min.set(x0, 0, z0); this.box.max.set(x1, TILES.TILE_TOP_M, z1);
      const inView = this.frustum.intersectsBox(this.box);
      s.want = want; s.d = d; s.inView = inView;
      order.push(s);
    }
    return order;
  }

  update(now = performance.now()) {
    if (!this.manifest || now - this.last < TILES.UPDATE_EVERY_MS) return;
    this.last = now;
    const all = this.plan();
    // cancel loads that are no longer wanted at that lod
    for (const s of all) if (s.job && s.job.lod !== s.want) { s.job.ctrl.abort(); s.job.stale = true; s.job = null; this.active--; this.stats.aborted++; }
    // drop what is not wanted
    for (const s of all) if (!s.want && s.obj) this.drop(s);
    // queue: in view first, then nearest
    const queue = all.filter((s) => s.want && s.have !== s.want && !s.job && (s.failed || 0) < TILES.MAX_TRIES).sort((a, b) => (b.inView - a.inView) || (a.d - b.d));
    while (this.active < TILES.MAX_DECODES && queue.length) this.start(queue.shift());
  }

  start(s) {
    const lod = s.want, ctrl = new AbortController();
    const job = { lod, ctrl, stale: false };
    s.job = job; this.active++;
    const url = new URL(s.def[lod], this.base).href;
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
        obj.name = s.def.id + ':' + lod;
        obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = true; } });
        this.prepare(obj, s.def, lod);
        this.group.add(obj);
        const had = s.obj;
        s.obj = obj; s.have = lod;
        if (had) { this.group.remove(had); disposeObject(had); this.stats.disposed++; } else this.onShow(s.mapIds, s.def);
        this.stats.loaded++;
        this.onChange(this);
      } catch (e) {
        if (e.name !== 'AbortError') { this.stats.failed++; console.warn('[v2 tiles]', s.def.id, lod, e.message); s.failed = (s.failed || 0) + 1; }
      } finally {
        if (s.job === job) { s.job = null; this.active--; }
      }
    })();
  }

  drop(s) {
    this.group.remove(s.obj);
    disposeObject(s.obj);
    s.obj = null; s.have = null;
    this.stats.disposed++;
    this.onHide(s.mapIds, s.def);
    this.onChange(this);
  }

  summary() {
    let lod0 = 0, lod1 = 0, loading = 0;
    for (const s of this.tiles.values()) { if (s.have === 'lod0') lod0++; if (s.have === 'lod1') lod1++; if (s.job) loading++; }
    return { tiles: this.tiles.size, lod0, lod1, loading, ...this.stats };
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
