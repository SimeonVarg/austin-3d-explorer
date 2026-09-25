/** The render adapter deliberately keeps the production Three attributes,
 * shared lighting uniforms and ENU coordinates. Decoded arrays are transferred,
 * never regenerated or converted here. Ownership lives with the returned group.
 */
export function createBuildingObject(asset, { THREE: T, slopes: S, pickId = 0 }) {
  const configured = globalThis.SLOPES?.origin;
  if (configured && (Math.abs(asset.origin.lng - configured[0]) > 1e-9 || Math.abs(asset.origin.lat - configured[1]) > 1e-9)) {
    throw new Error('Compiled building uses a different coordinate origin');
  }
  const group = new T.Group();
  group.name = asset.building.id;
  group.userData = { buildingId: asset.building.id, pickId, retainGeometryCpu: true,
    compiled: true, bounds: asset.building.bounds, sourceHash: asset.source.hash };
  let disposed = false;
  const resources = [];
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const resource of resources) resource.dispose();
    group.clear();
  };
  try {
    const shared = new Map();
    for (const part of asset.parts) {
      const geometry = new T.BufferGeometry();
      resources.push(geometry);
      const attribute = value => {
        if (!value.isFloat16) return new T.BufferAttribute(value.array, value.itemSize, value.normalized);
        // r159's Float16 constructor copies an incoming Uint16Array. Preserve
        // the transferred owner, just as the ordinary BufferAttribute does.
        const attr = new T.Float16BufferAttribute(0, value.itemSize, value.normalized);
        attr.array = value.array; attr.count = value.array.length / value.itemSize;
        return attr;
      };
      for (const [name, value] of Object.entries(part.geometry.attributes)) geometry.setAttribute(name, attribute(value));
      geometry.setIndex(attribute(part.geometry.index));
      geometry.boundingBox = new T.Box3(new T.Vector3(...part.bounds.min), new T.Vector3(...part.bounds.max));
      geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new T.Sphere());
      let material, batch;
      if (part.kind === 'filtered') {
        const textures = {};
        for (const [name, value] of Object.entries(part.textures)) {
          const texture = new T.DataArrayTexture(value.array, value.width, value.height, value.depth);
          resources.push(texture);
          texture.format = T.RGBAFormat; texture.type = T.UnsignedByteType;
          for (const key of ['magFilter', 'minFilter', 'wrapS', 'wrapT', 'generateMipmaps', 'flipY', 'anisotropy', 'colorSpace']) {
            if (value.sampling?.[key] !== undefined) texture[key] = value.sampling[key];
          }
          texture.needsUpdate = true;
          textures[name] = texture;
        }
        batch = { textures, faces: part.faces, dispose() {} };
        material = S.facadeMaterial(batch, part.material.options);
        resources.push(material);
      } else {
        if (!shared.has(part.material.side)) {
          const owned = S.material({ side: part.material.side });
          shared.set(part.material.side, owned); resources.push(owned);
        }
        material = shared.get(part.material.side);
      }
      const mesh = new T.Mesh(geometry, material);
      mesh.name = part.id;
      mesh.userData = { buildingId: asset.building.id, partId: part.id, pickId, retainGeometryCpu: true };
      if (batch) { mesh.userData.facadeBatch = batch; mesh.userData.disposeFacade = () => {}; }
      group.add(mesh);
    }
    return { group, asset, dispose, geometryBytes: asset.stats.geometryBytes,
      textureBytes: asset.stats.textureBytes, bytes: asset.stats.geometryBytes + asset.stats.textureBytes };
  } catch (error) { dispose(); throw error; }
}

export class BuildingAssetLoader {
  constructor({ workerURL = new URL('./building-asset-worker.js', import.meta.url), concurrency = 2, maxQueue = 64, onEvent = () => {} } = {}) {
    if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 16 ||
      !Number.isSafeInteger(maxQueue) || maxQueue < 1) throw new Error('Invalid building loader limits');
    this.worker = new Worker(workerURL, { type: 'module', name: 'compiled-buildings' });
    this.concurrency = concurrency; this.maxQueue = maxQueue; this.onEvent = onEvent;
    this.pending = new Map(); this.queue = []; this.serial = 0; this.closed = false;
    this.worker.onmessage = ({ data }) => {
      const task = this.pending.get(data.requestId);
      if (!task || !['loaded', 'error', 'cancelled'].includes(data.type)) return;
      this.pending.delete(data.requestId); task.cleanup();
      if (task.cancelled || data.type === 'cancelled') {
        // A completed transfer can race the abort message. Discard that owner
        // before admitting another request; it must never reach the caller.
        data.asset = null;
        task.reject(new DOMException('Cancelled', 'AbortError'));
        this.onEvent({ type: 'cancelled', id: task.entry.id });
      } else if (data.type === 'loaded') { this.onEvent({ type: 'decoded', id: task.entry.id, ...data.timing, bytes: data.bytes }); task.resolve(data); }
      else task.reject(new Error(data.error || 'Building worker failed'));
      this.pump();
    };
    this.worker.onerror = this.worker.onmessageerror = event => {
      event.preventDefault?.();
      this.stop(new Error(event.message || 'Building worker failed'));
    };
  }
  load(entry, baseURL, { signal } = {}) {
    if (this.closed) return Promise.reject(new Error('Building loader is closed'));
    if (!entry?.id || !/^[a-f0-9]{64}$/.test(entry.hash || '') || !Number.isSafeInteger(entry.bytes) || entry.bytes <= 0 || !entry.file)
      return Promise.reject(new Error('Invalid compiled building manifest entry'));
    if (signal?.aborted) return Promise.reject(new DOMException('Cancelled', 'AbortError'));
    let url;
    try {
      const base = new URL(baseURL); url = new URL(entry.file, base);
      if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname) || url.username || url.password)
        throw new Error('Building asset URL is outside its manifest directory');
    } catch (error) { return Promise.reject(error); }
    if (this.queue.length >= this.maxQueue) return Promise.reject(new Error('Building loader queue is full'));
    entry = { ...entry };
    return new Promise((resolve, reject) => {
      const requestId = ++this.serial;
      const cancel = () => {
        if (task.cancelled) return;
        const queued = this.queue.indexOf(task);
        if (queued >= 0) {
          this.queue.splice(queued, 1); task.cancelled = true; task.cleanup();
          reject(new DOMException('Cancelled', 'AbortError'));
          this.onEvent({ type: 'cancelled', id: entry.id }); this.pump();
        } else if (this.pending.has(requestId)) {
          // Fetch is abortable, but crypto hashing is not. Retain this slot
          // and the caller's reservation until the worker releases its owner
          // and acknowledges completion (or a transferred result races us).
          task.cancelled = true; task.cleanup();
          try { this.worker.postMessage({ type: 'cancel', requestId }); }
          catch (error) { this.stop(error); }
        }
      };
      const task = { requestId, entry, url: url.href, resolve, reject,
        cleanup: () => signal?.removeEventListener('abort', cancel) };
      signal?.addEventListener('abort', cancel, { once: true });
      this.queue.push(task); this.pump();
    });
  }
  pump() {
    while (!this.closed && this.pending.size < this.concurrency && this.queue.length) {
      const task = this.queue.shift();
      this.pending.set(task.requestId, task);
      try {
        this.worker.postMessage({ type: 'load', requestId: task.requestId,
          url: task.url, expectedId: task.entry.id,
          expectedHash: task.entry.hash, maxBytes: task.entry.bytes });
      } catch (error) { this.stop(error); break; }
      this.onEvent({ type: 'fetching', id: task.entry.id, started: performance.timeOrigin + performance.now() });
    }
  }
  stop(error) {
    if (this.closed) return;
    this.closed = true;
    this.worker.onmessage = this.worker.onerror = this.worker.onmessageerror = null;
    // Termination releases worker-owned buffers before promises release their
    // memory reservations, including a hash which cannot acknowledge an abort.
    this.worker.terminate();
    for (const task of [...this.pending.values(), ...this.queue]) {
      task.cleanup(); task.reject(task.cancelled ? new DOMException('Cancelled', 'AbortError') : error);
    }
    this.pending.clear(); this.queue.length = 0;
  }
  close() { this.stop(new DOMException('Closed', 'AbortError')); }
}

/** At least one complete map frame separates upload slices. MessageChannel
 * alone can drain before the browser renders and recreate a long upload burst.
 */
export const nextBuildingFrame = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));

/** Use the SAME renderer and context. A zero-draw mesh makes Three allocate
 * buffers without drawing into the map or running a shadow pass. Filtered
 * textures get their own slices, including mipmap generation. Every GL state
 * boundary mirrors the custom layer's existing reset contract.
 */
export async function uploadBuildingObject(object, { THREE: T, slopes: S, map, signal, onEvent = () => {}, rendererTimeoutMs = 30000 }) {
  // Context restoration rebuilds MapLibre's style before the custom layer's
  // first render recreates Three. Keep this bounded staged object cancellable
  // while that renderer returns; this delay is not a corrupt-asset failure.
  const rendererDeadline = performance.now() + rendererTimeoutMs;
  let renderer = S.renderer;
  while (!renderer || renderer.getContext().isContextLost()) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (performance.now() >= rendererDeadline) throw new Error('Building renderer did not recover');
    map?.triggerRepaint(); await nextBuildingFrame(); renderer = S.renderer;
  }
  const stage = new T.Scene(), camera = new T.Camera();
  const material = new T.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false });
  const check = () => {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (renderer.getContext().isContextLost()) throw new Error('Context lost during building upload');
  };
  try {
    for (const mesh of object.group.children) {
      check();
      const started = performance.now();
      const geometry = mesh.geometry, previous = { ...geometry.drawRange };
      const dummy = new T.Mesh(geometry, material);
      dummy.frustumCulled = false; stage.add(dummy); geometry.setDrawRange(0, 0);
      const target = renderer.getRenderTarget(), autoClear = renderer.autoClear;
      try {
        renderer.resetState(); renderer.autoClear = false;
        renderer.render(stage, camera);
      } finally {
        geometry.setDrawRange(previous.start, previous.count); stage.remove(dummy);
        renderer.setRenderTarget(target); renderer.autoClear = autoClear; renderer.resetState();
      }
      onEvent({ type: 'upload', id: object.group.userData.buildingId, partId: mesh.name,
        started: performance.timeOrigin + started, finished: performance.timeOrigin + performance.now(), ms: performance.now() - started });
      map?.triggerRepaint(); await nextBuildingFrame();
      for (const texture of Object.values(mesh.userData.facadeBatch?.textures || {})) {
        check(); const t = performance.now();
        try { renderer.resetState(); renderer.initTexture(texture); } finally { renderer.resetState(); }
        onEvent({ type: 'texture-upload', id: object.group.userData.buildingId,
          started: performance.timeOrigin + t, finished: performance.timeOrigin + performance.now(), ms: performance.now() - t });
        map?.triggerRepaint(); await nextBuildingFrame();
      }
    }
    check();
  } finally { material.dispose(); }
}
