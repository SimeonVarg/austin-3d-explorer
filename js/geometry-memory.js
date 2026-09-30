(function () {
  'use strict';
  const tune = { on: !/[?&]geometrymemory=0(?:&|$)/.test(window.location?.search || ''), minBytes: 64 * 1024, minimumSavingsRatio: 0.25, workerIdleMs: 5000, workerTimeoutMs: 30000,
    attributes: ['cDay', 'cGold', 'cNight', 'aGrad', 'aFacet', 'aSurface', 'aStadiumLight', 'faceLayer', 'faceSize'] };
  const records = new WeakMap(), geometries = new WeakSet(), live = new Set(), queue = [];
  const storage = Symbol('geometryMemoryStorage');
  const totals = { encoded: 0, rehydrated: 0, failures: 0, disposed: 0 };
  let worker = null, workerURL = null, busy = null, serial = 0, unavailable = false, idleTimer = null, jobTimer = null;

  function closeWorker() {
    clearTimeout(idleTimer);
    clearTimeout(jobTimer);
    idleTimer = jobTimer = null;
    if (worker) worker.terminate();
    worker = null;
    if (workerURL) URL.revokeObjectURL(workerURL);
    workerURL = null;
  }

  function discard(record) {
    record.packed = null;
    record.epoch++;
  }
  function stored(attribute) {
    return records.get(attribute) || Object.getOwnPropertyDescriptor(attribute, 'array')?.get?.[storage];
  }
  function restore(record) {
    if (record.pending) record.epoch++;
    if (!record.raw && record.packed) {
      record.raw = window.GeometryMemoryCodec.decode(record.packed);
      record.packed = null;
      record.epoch++;
      totals.rehydrated++;
    }
    return record.raw;
  }
  function fail() {
    totals.failures++;
    unavailable = true;
    const record = busy?.reference.deref();
    if (record && record.job === busy.job) { record.pending = false; record.jobRaw = null; }
    busy = null;
    for (const record of queue) record.pending = false;
    queue.length = 0;
    closeWorker();
  }
  function makeWorker() {
    if (worker || unavailable) return worker;
    if (!window.createGeometryMemoryCodec || typeof Worker !== 'function') return null;
    try {
      const source = `const codec=(${window.createGeometryMemoryCodec.toString()})();self.onmessage=event=>{const {id,array,itemSize,minimumSavingsRatio}=event.data;try{const packed=codec.encode(array,itemSize,{minimumSavingsRatio});const transfer=packed?[packed.values.buffer,packed.runs.buffer]:[];self.postMessage({id,packed},transfer);}catch(error){self.postMessage({id,error:String(error)});}};`;
      workerURL = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      worker = new Worker(workerURL);
      worker.onerror = fail;
      worker.onmessage = event => {
        const job = busy;
        if (!job || event.data.id !== job.job) return;
        clearTimeout(jobTimer);
        jobTimer = null;
        busy = null;
        const record = job.reference.deref();
        if (record && record.job === job.job) {
          record.pending = false;
          if (event.data.error) totals.failures++;
          else if (tune.on && record.owners.size && record.epoch === record.jobEpoch &&
                   record.attribute.version === record.jobVersion && record.raw === record.jobRaw && event.data.packed) {
            record.packed = event.data.packed;
            record.raw = null;
            totals.encoded++;
          }
          record.jobRaw = null;
        }
        pump();
        if (!busy && !queue.length) idleTimer = setTimeout(closeWorker, tune.workerIdleMs);
      };
      return worker;
    } catch (error) {
      fail();
      return null;
    }
  }
  function pump() {
    if (busy || unavailable || !queue.length) return;
    clearTimeout(idleTimer);
    idleTimer = null;
    const target = makeWorker();
    if (!target) { for (const record of queue) record.pending = false; queue.length = 0; return; }
    let record;
    while (queue.length) {
      const candidate = queue.shift();
      if (candidate.owners.size && candidate.raw && candidate.raw.byteLength >= tune.minBytes) { record = candidate; break; }
      candidate.pending = false;
    }
    if (!record) return;
    record.job = ++serial;
    busy = { job: record.job, reference: record.reference };
    record.jobEpoch = record.epoch;
    record.jobVersion = record.attribute.version;
    record.jobRaw = record.raw;
    jobTimer = setTimeout(fail, tune.workerTimeoutMs);
    try {
      target.postMessage({ id: record.job, array: record.raw, itemSize: record.attribute.itemSize,
        minimumSavingsRatio: tune.minimumSavingsRatio });
    } catch (error) { record.jobRaw = null; fail(); }
  }
  function uploaded(record) {
    if (!tune.on || record.pending || !record.owners.size || !record.raw || record.raw.byteLength < tune.minBytes) return;
    record.pending = true;
    queue.push(record);
    pump();
  }
  function track(object) {
    if (!tune.on || window.LITE_PROFILE?.on || !window.GeometryMemoryCodec || typeof WeakRef !== 'function' || !object?.traverse) return object;
    object.traverse(mesh => {
      const geometry = mesh.geometry;
      if (!geometry?.isBufferGeometry || geometries.has(geometry)) return;
      geometries.add(geometry);
      const owned = [];
      for (const name of tune.attributes) {
        const attribute = geometry.attributes[name];
        if (!attribute?.isBufferAttribute || attribute.isInterleavedBufferAttribute || attribute.usage !== THREE.StaticDrawUsage) continue;
        let record = stored(attribute);
        if (!record) {
          const raw = attribute.array;
          if (!ArrayBuffer.isView(raw) || raw.byteLength < tune.minBytes) continue;
          record = { attribute, raw, packed: null, owners: new Set(), epoch: 0, pending: false,
            originalBytes: raw.byteLength, previousUpload: attribute.onUploadCallback };
          record.reference = new WeakRef(record);
          const getArray = function () { return restore(record); };
          getArray[storage] = record;
          Object.defineProperty(attribute, 'array', { configurable: true, enumerable: true,
            get: getArray,
            set(value) { discard(record); record.raw = value; record.originalBytes = value?.byteLength || 0; } });
          record.upload = function () {
            record.previousUpload.call(this);
            uploaded(record);
          };
        }
        if (!record.owners.size) {
          records.set(attribute, record);
          live.add(record.reference);
          record.previousUpload = attribute.onUploadCallback;
          attribute.onUpload(record.upload);
        }
        record.owners.add(geometry);
        owned.push(record);
      }
      const dispose = () => {
        geometries.delete(geometry);
        geometry.removeEventListener('dispose', dispose);
        for (const record of owned) {
          record.owners.delete(geometry);
          if (!record.owners.size) {
            record.attribute.onUploadCallback = record.previousUpload;
            records.delete(record.attribute);
            live.delete(record.reference);
            for (let queueIndex = queue.length - 1; queueIndex >= 0; queueIndex--) {
              if (queue[queueIndex] === record) queue.splice(queueIndex, 1);
            }
            record.pending = false;
            record.job = null;
            record.jobRaw = null;
            record.epoch++;
            totals.disposed++;
          }
        }
      };
      geometry.addEventListener('dispose', dispose);
    });
    return object;
  }
  function stats() {
    let rawBytes = 0, packedBytes = 0, releasedBytes = 0, releasedAttributes = 0;
    for (const reference of live) {
      const record = reference.deref();
      if (!record) { live.delete(reference); continue; }
      rawBytes += record.raw?.byteLength || 0;
      if (record.packed) {
        packedBytes += record.packed.values.byteLength + record.packed.runs.byteLength;
        releasedBytes += record.originalBytes;
        releasedAttributes++;
      }
    }
    return { ...totals, managedAttributes: live.size, rawBytes, packedBytes, releasedBytes,
      bytesSaved: releasedBytes - packedBytes, releasedAttributes, pending: queue.length + (busy ? 1 : 0), unavailable };
  }
  function install() {
    const slopes = window.slopes;
    if (!slopes) { setTimeout(install, 60); return; }
    const add = slopes.add;
    slopes.add = function (object) { track(object); return add.apply(this, arguments); };
    if (slopes.root) track(slopes.root);
  }
  window.GpuMemory = { tune, track, stats, peek(attribute) { const record = stored(attribute); return record ? record.raw : attribute.array; } };
  install();
}());
