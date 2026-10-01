import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';

const help = [
  'Usage: node scripts/verify/geometry-memory-upload.mjs [--source <directory>]',
  'Offline regression: actual THREE r159 WebGLAttributes/BufferAttribute with the current codec/manager.',
  'Source precedence: --source, THREE_SOURCE_DIR, installed three@0.159.0.',
  'Provide a local THREE src directory or flat directory containing unmodified r159',
  'WebGLAttributes.js and BufferAttribute.js. SHA-256 pins are checked before execution.',
  'Without sources: SKIP/instructions, exit 77 (not PASS). No downloads or tracked third-party fixtures.',
  'Bound: 64-KiB Float32 and normalized Uint8, each in WebGL1/WebGL2. No browser/real GL.',
  'Limits: fake GL records bytes, not driver/draw/pixel behavior; fresh cache/context is not context loss.',
  'BufferAttribute math imports are omitted; edits use typed arrays and its real needsUpdate setter.',
  'Worker delivery/timers are deterministic, not timing or memory measurements.'
].join('\n');
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') {
  console.log(help);
  process.exit(0);
}
assert.ok(args.length === 0 || (args.length === 2 && args[0] === '--source' && args[1]), help);
const sourcePins = {
  'WebGLAttributes.js': 'd3b92cbb9b48e474d96533c245a5204210244feb1df007c046128d389de3f471',
  'BufferAttribute.js': '9b3fa64a5b5948d1260b9c5b71d04aa561383d464f35b8d12f4bf0bacd90d7db'
};

function sourceDirectory() {
  const explicit = args[1] || process.env.THREE_SOURCE_DIR;
  if (explicit) return path.resolve(explicit);
  let installed;
  try {
    installed = path.dirname(path.dirname(createRequire(import.meta.url).resolve('three')));
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
  }
  if (installed && JSON.parse(readFileSync(path.join(installed, 'package.json'), 'utf8')).version === '0.159.0') {
    return path.join(installed, 'src');
  }
  return null;
}

const sources = sourceDirectory();
if (!sources) {
  console.error('SKIP geometry-memory-upload: local THREE r159 sources are unavailable.');
  console.error(help);
  process.exit(77);
}
function pinnedSource(name, relativePath) {
  const flatPath = path.join(sources, name);
  const sourcePath = existsSync(flatPath) ? flatPath : path.join(sources, relativePath);
  assert.ok(existsSync(sourcePath), 'Missing ' + name + '; provide local r159 sources with --source or THREE_SOURCE_DIR. No fetch is performed.');
  const source = readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');
  assert.equal(createHash('sha256').update(source).digest('hex'), sourcePins[name], sourcePath + ' must be unmodified THREE r159');
  return source;
}

const uploaderSource = pinnedSource('WebGLAttributes.js', 'renderers/webgl/WebGLAttributes.js');
const attributeSource = pinnedSource('BufferAttribute.js', 'core/BufferAttribute.js');
const uploaderExport = 'export { WebGLAttributes };';
assert.equal(uploaderSource.split(uploaderExport).length, 2, 'Only the uploader export is transformed');
const attributeStart = attributeSource.indexOf('class BufferAttribute {');
const attributeEnd = attributeSource.indexOf('\nclass Int8BufferAttribute extends BufferAttribute {');
assert.ok(attributeStart >= 0 && attributeEnd > attributeStart, 'Extract the complete unmodified base BufferAttribute class');
const threeSource = [attributeSource.slice(attributeStart, attributeEnd),
  'globalThis.BufferAttribute = BufferAttribute;', uploaderSource.replace(uploaderExport, ''),
  'globalThis.WebGLAttributes = WebGLAttributes;'].join('\n');
const codecSource = readFileSync(new URL('../../js/geometry-memory-codec.js', import.meta.url), 'utf8');
const managerSource = readFileSync(new URL('../../js/geometry-memory.js', import.meta.url), 'utf8');
const constructors = { ArrayBuffer, Float32Array, Float64Array, Uint8Array, Uint8ClampedArray,
  Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array };
const executionLimit = { timeout: 2000 };
const minimumBytes = 64 * 1024;

function bytesOf(array) {
  return Buffer.from(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
}

function recordingWebGL() {
  const storage = new Map(), bindings = new Map(), uploads = [], deleted = [];
  let serial = 0;
  const gl = {
    ARRAY_BUFFER: 0x8892, FLOAT: 0x1406, HALF_FLOAT: 0x140b, UNSIGNED_SHORT: 0x1403,
    SHORT: 0x1402, UNSIGNED_INT: 0x1405, INT: 0x1404, BYTE: 0x1400, UNSIGNED_BYTE: 0x1401,
    createBuffer() { const buffer = { id: ++serial }; storage.set(buffer, null); return buffer; },
    bindBuffer(target, buffer) { assert.ok(storage.has(buffer)); bindings.set(target, buffer); },
    bufferData(target, array, usage) {
      assert.ok(ArrayBuffer.isView(array), 'Actual uploader must pass a typed array');
      const buffer = bindings.get(target), bytes = bytesOf(array);
      assert.ok(storage.has(buffer));
      storage.set(buffer, Buffer.from(bytes));
      uploads.push({ method: 'bufferData', buffer, target, usage, offset: 0, bytes,
        ctor: array.constructor.name, byteOffset: array.byteOffset, length: array.length,
        bytesPerElement: array.BYTES_PER_ELEMENT, argumentCount: arguments.length });
    },
    bufferSubData(target, offset, array, sourceOffset = 0, length = array.length - sourceOffset) {
      assert.ok(ArrayBuffer.isView(array));
      const buffer = bindings.get(target), destination = storage.get(buffer);
      assert.ok(destination, 'Subdata requires an allocated store');
      assert.ok(Number.isInteger(sourceOffset) && sourceOffset >= 0 && length > 0 && sourceOffset + length <= array.length);
      const bytes = bytesOf(array.subarray(sourceOffset, sourceOffset + length));
      assert.ok(offset >= 0 && offset + bytes.length <= destination.length);
      bytes.copy(destination, offset);
      uploads.push({ method: 'bufferSubData', buffer, target, offset, sourceOffset, length, bytes,
        ctor: array.constructor.name, bytesPerElement: array.BYTES_PER_ELEMENT, argumentCount: arguments.length });
    },
    deleteBuffer(buffer) { assert.ok(storage.delete(buffer)); deleted.push(buffer); }
  };
  return { gl, uploads, deleted, bytes(buffer) { return Buffer.from(storage.get(buffer)); } };
}

function fixture(Constructor, normalized, isWebGL2) {
  const jobs = [], blobs = new Map(), timers = new Map(), events = [];
  let timerSerial = 0, workerSerial = 0, deliveries = 0;
  class Worker {
    constructor(url) {
      assert.ok(blobs.has(url), 'Execute the manager-generated Blob, not a replacement worker');
      this.blob = blobs.get(url);
      this.closed = false;
    }
    postMessage(message, transfer) {
      assert.equal(this.closed, false);
      assert.equal(transfer, undefined, 'The live source must be cloned, not transferred/detached');
      events.push('post');
      jobs.push({ worker: this, message: structuredClone(message) });
    }
    terminate() { this.closed = true; }
  }
  const slopes = { add(object) { return object; } };
  const window = { slopes, LITE_PROFILE: { on: false } };
  const scope = vm.createContext({ ...constructors, window, Worker, Blob, WeakRef,
    THREE: { StaticDrawUsage: 35044 }, StaticDrawUsage: 35044, FloatType: 1015,
    URL: {
      createObjectURL(blob) {
        const url = 'blob:geometry-memory-upload-' + ++workerSerial;
        blobs.set(url, blob);
        return url;
      },
      revokeObjectURL(url) { blobs.delete(url); }
    },
    setTimeout(callback, delay) { const id = ++timerSerial; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); }
  });
  vm.runInContext(threeSource, scope, executionLimit);
  vm.runInContext(codecSource, scope, executionLimit);
  vm.runInContext(managerSource, scope, executionLimit);
  const backing = new ArrayBuffer(minimumBytes + 16 * Constructor.BYTES_PER_ELEMENT);
  new Uint8Array(backing).fill(0xa5);
  const raw = new Constructor(backing, 8 * Constructor.BYTES_PER_ELEMENT, minimumBytes / Constructor.BYTES_PER_ELEMENT);
  const patterns = Constructor === Float32Array
    ? [[0x40800000, 0x3e800000, 0x80000000, 0x7fc12345], [0x41000000, 0x3f000000, 0, 0x7fc54321]]
    : [[255, 64, 0, 128], [32, 192, 255, 255]];
  const components = Constructor === Float32Array ? new Uint32Array(raw.buffer, raw.byteOffset, raw.length) : raw;
  for (let component = 0; component < components.length; component += 4) {
    components.set(patterns[component < components.length / 2 ? 0 : 1], component);
  }
  const attribute = new scope.BufferAttribute(raw, 4, normalized);
  const callbacks = [];
  function previousUpload() {
    callbacks.push(this);
    assert.equal(arguments.length, 0);
    events.push('callback');
  }
  assert.equal(attribute.onUpload(previousUpload), attribute);
  const listeners = new Set();
  const geometry = { isBufferGeometry: true, attributes: { aSurface: attribute },
    addEventListener(type, listener) { assert.equal(type, 'dispose'); listeners.add(listener); },
    removeEventListener(type, listener) { assert.equal(type, 'dispose'); assert.ok(listeners.delete(listener)); },
    dispose() { for (const listener of [...listeners]) listener(); }
  };
  const object = { traverse(callback) { callback({ geometry }); } };
  assert.equal(slopes.add(object), object);
  const memory = window.GpuMemory;
  assert.equal(memory.stats().managedAttributes, 1);
  assert.equal(memory.peek(attribute), raw);
  assert.equal(jobs.length, 0, 'Tracking alone must not encode before an upload');

  async function deliver() {
    assert.equal(jobs.length, 1, 'Exactly one deterministic worker request');
    assert.equal(memory.stats().pending, 1);
    const { worker, message } = jobs.shift();
    assert.equal(worker.closed, false);
    const replies = [];
    const self = { postMessage(reply, transfer) { replies.push(structuredClone(reply, { transfer })); } };
    const workerScope = vm.createContext({ ...constructors, self, incoming: message });
    vm.runInContext(await worker.blob.text(), workerScope, executionLimit);
    vm.runInContext('self.onmessage({ data: incoming });', workerScope, executionLimit);
    assert.equal(replies.length, 1);
    const reply = replies[0];
    assert.equal(reply.id, message.id);
    assert.equal(reply.error, undefined);
    assert.ok(reply.packed, 'The real codec must compress this fixture');
    assert.equal(reply.packed.ctor, Constructor.name);
    assert.equal(reply.packed.length, raw.length);
    assert.equal(reply.packed.itemSize, attribute.itemSize);
    assert.deepEqual(bytesOf(memory.peek(attribute)), bytesOf(message.array));
    assert.deepEqual(bytesOf(window.GeometryMemoryCodec.decode(reply.packed)), bytesOf(message.array));
    worker.onmessage({ data: reply });
    assert.equal(memory.stats().encoded, ++deliveries);
    assert.equal(memory.stats().pending, 0);
    assert.equal(memory.peek(attribute), null, 'Release only after the actual worker result is delivered');
    assert.equal(memory.stats().releasedAttributes, 1);
    assert.equal(memory.stats().rawBytes, 0);
    assert.equal(memory.stats().releasedBytes, minimumBytes);
    assert.equal(memory.stats().packedBytes, reply.packed.values.byteLength + reply.packed.runs.byteLength);
    assert.equal(memory.stats().bytesSaved, minimumBytes - memory.stats().packedBytes);
    assert.equal(memory.stats().failures, 0);
  }

  function schema(renderer, recording, version) {
    assert.equal(attribute.isBufferAttribute, true);
    assert.equal(attribute.itemSize, 4);
    assert.equal(attribute.count, raw.length / 4);
    assert.equal(attribute.normalized, normalized);
    assert.equal(attribute.usage, 35044);
    assert.equal(attribute.gpuType, 1015);
    assert.equal(attribute.version, version);
    const cached = renderer.get(attribute);
    assert.equal(cached.type, Constructor === Float32Array ? recording.gl.FLOAT : recording.gl.UNSIGNED_BYTE);
    assert.equal(cached.bytesPerElement, Constructor.BYTES_PER_ELEMENT);
    assert.equal(cached.size, minimumBytes);
    assert.equal(cached.version, version);
    assert.equal(attribute.onUploadCallback === previousUpload, false, 'The wrapper must retain the existing callback');
  }

  function upload(renderer, recording, expected, version, hydration, method, range) {
    const before = memory.stats(), uploadCount = recording.uploads.length, callbackCount = callbacks.length;
    const eventCount = events.length;
    renderer.update(attribute, recording.gl.ARRAY_BUFFER);
    assert.equal(recording.uploads.length, uploadCount + 1);
    const call = recording.uploads.at(-1);
    assert.equal(call.method, method);
    assert.equal(call.target, recording.gl.ARRAY_BUFFER);
    assert.equal(call.ctor, Constructor.name);
    assert.equal(call.bytesPerElement, Constructor.BYTES_PER_ELEMENT);
    assert.deepEqual(call.bytes, range ? expected.subarray(range.start * Constructor.BYTES_PER_ELEMENT,
      (range.start + range.count) * Constructor.BYTES_PER_ELEMENT) : expected);
    assert.equal(call.offset, range ? range.start * Constructor.BYTES_PER_ELEMENT : 0);
    assert.equal(call.argumentCount, range && isWebGL2 ? 5 : 3);
    if (method === 'bufferData') assert.equal(call.usage, attribute.usage);
    schema(renderer, recording, version);
    assert.deepEqual(recording.bytes(renderer.get(attribute).buffer), expected, 'Exact complete GPU store, including untouched range bytes');
    assert.equal(memory.stats().rehydrated, before.rehydrated + hydration);
    assert.equal(callbacks.length, callbackCount + 1, 'Original callback runs once per real upload');
    assert.equal(callbacks.at(-1), attribute, 'Original callback keeps BufferAttribute this');
    assert.deepEqual(events.slice(eventCount), ['callback', 'post'], 'Original callback runs before encoding is queued');
    assert.equal(memory.stats().pending, 1);
    assert.equal(memory.stats().releasedAttributes, 0, 'No eager release before worker delivery');
    assert.equal(memory.peek(attribute).constructor, Constructor);
    assert.deepEqual(bytesOf(memory.peek(attribute)), expected);
    return call;
  }

  function stable(renderer, recording, expectedVersion) {
    const before = { ...memory.stats() }, uploadCount = recording.uploads.length, callbackCount = callbacks.length;
    const cache = renderer.get(attribute);
    assert.equal(memory.peek(attribute), null);
    renderer.update(attribute, recording.gl.ARRAY_BUFFER);
    assert.equal(renderer.get(attribute), cache);
    schema(renderer, recording, expectedVersion);
    assert.equal(recording.uploads.length, uploadCount, 'Stable cached update never uploads');
    assert.equal(callbacks.length, callbackCount, 'Stable update never fires upload callbacks');
    assert.equal(jobs.length, 0);
    assert.deepEqual({ ...memory.stats() }, before, 'Stable cached update never hydrates or queues work');
    assert.equal(memory.peek(attribute), null);
  }

  return { memory, attribute, raw, geometry, object, callbacks, previousUpload, listeners, jobs,
    renderer(recording) { return scope.WebGLAttributes(recording.gl, { isWebGL2 }); },
    deliver, schema, upload, stable };
}

async function verify(Constructor, normalized, isWebGL2) {
  const test = fixture(Constructor, normalized, isWebGL2);
  const { attribute, memory, raw } = test;
  const recording = recordingWebGL(), renderer = test.renderer(recording);
  let expected = bytesOf(raw), version = 0;
  const first = test.upload(renderer, recording, expected, version, 0, 'bufferData');
  assert.equal(first.byteOffset, raw.byteOffset, 'Upload the original typed view, not its entire backing buffer');
  assert.equal(first.length, raw.length);
  assert.equal(memory.peek(attribute), raw);
  const originalBuffer = renderer.get(attribute).buffer;
  await test.deliver();
  test.stable(renderer, recording, version);

  const hydrated = attribute.array;
  assert.notEqual(hydrated, raw, 'Reading a released array reconstructs rather than retaining the original');
  assert.equal(hydrated.constructor, Constructor);
  assert.equal(hydrated.length, raw.length);
  assert.deepEqual(bytesOf(hydrated), expected, 'Float NaN payloads/signed zero and normalized Uint8 bytes survive');
  assert.equal(memory.stats().rehydrated, 1);
  assert.equal(attribute.array, hydrated, 'Subsequent reads reuse the materialized array');
  hydrated[0] = Constructor === Float32Array ? 0.875 : 17;
  expected = bytesOf(hydrated);
  attribute.needsUpdate = true;
  test.upload(renderer, recording, expected, ++version, 0, 'bufferSubData');
  assert.equal(renderer.get(attribute).buffer, originalBuffer, 'Mutation updates the original allocation');
  await test.deliver();
  test.stable(renderer, recording, version);

  attribute.needsUpdate = true;
  test.upload(renderer, recording, expected, ++version, 1, 'bufferSubData');
  await test.deliver();
  test.stable(renderer, recording, version);

  const edited = attribute.array, range = { start: 8, count: 4 };
  edited[range.start] = Constructor === Float32Array ? -2.5 : 231;
  expected = bytesOf(edited);
  attribute.addUpdateRange(range.start, range.count);
  attribute.needsUpdate = true;
  test.upload(renderer, recording, expected, ++version, 0, 'bufferSubData', range);
  assert.equal(attribute.updateRanges.length, 0, 'The real uploader clears partial update ranges');
  assert.equal(attribute._updateRange.count, -1);
  await test.deliver();

  const freshRenderer = test.renderer(recording);
  assert.equal(freshRenderer.get(attribute), undefined);
  test.upload(freshRenderer, recording, expected, version, 1, 'bufferData');
  assert.notEqual(freshRenderer.get(attribute).buffer, originalBuffer);
  await test.deliver();
  test.stable(freshRenderer, recording, version);

  const freshContext = recordingWebGL(), restoredRenderer = test.renderer(freshContext);
  assert.equal(restoredRenderer.get(attribute), undefined);
  test.upload(restoredRenderer, freshContext, expected, version, 1, 'bufferData');
  await test.deliver();
  test.stable(restoredRenderer, freshContext, version);

  restoredRenderer.remove(attribute);
  assert.equal(freshContext.deleted.length, 1);
  assert.equal(restoredRenderer.get(attribute), undefined);
  assert.equal(memory.peek(attribute), null, 'Removing a GPU cache must not materialize CPU arrays');
  test.upload(restoredRenderer, freshContext, expected, version, 1, 'bufferData');
  await test.deliver();

  const replacement = new Constructor(raw.length);
  new Uint8Array(replacement.buffer).set(expected);
  replacement[0] = Constructor === Float32Array ? -13.5 : 237;
  const priorBytes = expected, beforeReplacement = memory.stats().rehydrated;
  expected = bytesOf(replacement);
  assert.notDeepEqual(expected, priorBytes);
  attribute.array = replacement;
  assert.equal(memory.peek(attribute), replacement);
  assert.equal(memory.stats().rehydrated, beforeReplacement, 'Replacing the source discards packed bytes without hydration');
  assert.equal(memory.stats().releasedAttributes, 0);
  const cachedUploadCount = freshContext.uploads.length, cachedCallbackCount = test.callbacks.length;
  restoredRenderer.update(attribute, freshContext.gl.ARRAY_BUFFER);
  assert.equal(freshContext.uploads.length, cachedUploadCount, 'THREE requires needsUpdate for a same-length source replacement');
  assert.equal(test.callbacks.length, cachedCallbackCount);
  assert.deepEqual(freshContext.bytes(restoredRenderer.get(attribute).buffer), priorBytes);
  attribute.needsUpdate = true;
  test.upload(restoredRenderer, freshContext, expected, ++version, 0, 'bufferSubData');
  await test.deliver();
  test.stable(restoredRenderer, freshContext, version);
  const replacementContext = recordingWebGL(), replacementRenderer = test.renderer(replacementContext);
  test.upload(replacementRenderer, replacementContext, expected, version, 1, 'bufferData');
  await test.deliver();
  test.stable(replacementRenderer, replacementContext, version);

  const beforeDispose = memory.stats().rehydrated;
  test.geometry.dispose();
  assert.equal(test.listeners.size, 0);
  assert.equal(memory.stats().managedAttributes, 0);
  assert.equal(attribute.onUploadCallback, test.previousUpload, 'Disposal restores the exact original callback');
  const descriptor = Object.getOwnPropertyDescriptor(attribute, 'array');
  assert.equal(typeof descriptor.get, 'function');
  assert.equal(typeof descriptor.set, 'function');
  assert.equal(memory.stats().rehydrated, beforeDispose, 'Disposal never decodes packed bytes');
  assert.equal(memory.peek(attribute), null, 'Dormant inspection never decodes packed bytes');
  assert.equal(memory.stats().rawBytes, 0);
  assert.equal(memory.stats().packedBytes, 0, 'Dormant storage is excluded from live accounting');
  const disposedContext = recordingWebGL(), disposedRenderer = test.renderer(disposedContext);
  const callbackCount = test.callbacks.length;
  disposedRenderer.update(attribute, disposedContext.gl.ARRAY_BUFFER);
  assert.equal(test.callbacks.length, callbackCount + 1);
  assert.equal(test.callbacks.at(-1), attribute);
  assert.deepEqual(disposedContext.uploads[0].bytes, expected);
  assert.equal(memory.stats().rehydrated, beforeDispose + 1, 'A new renderer lazily restores dormant bytes');
  assert.deepEqual(bytesOf(attribute.array), expected);
  assert.equal(test.jobs.length, 0, 'Disposed attributes no longer queue compression');
  assert.equal(memory.stats().pending, 0);
  assert.equal(memory.stats().failures, 0);
  memory.track(test.object);
  assert.equal(Object.getOwnPropertyDescriptor(attribute, 'array').get, descriptor.get, 'Re-add reuses dormant storage without stacking getters');
  assert.equal(memory.stats().managedAttributes, 1);
  assert.equal(memory.stats().rehydrated, beforeDispose + 1);
  const reusedContext = recordingWebGL(), reusedRenderer = test.renderer(reusedContext);
  test.upload(reusedRenderer, reusedContext, expected, version, 0, 'bufferData');
  await test.deliver();
  test.geometry.dispose();
  const beforePackedReadd = memory.stats().rehydrated;
  assert.equal(beforePackedReadd, beforeDispose + 1);
  assert.equal(memory.peek(attribute), null);
  memory.track(test.object);
  assert.equal(memory.stats().rehydrated, beforePackedReadd, 'Re-add does not decode dormant packed storage');
  assert.equal(memory.stats().releasedAttributes, 1);
  const packedReaddContext = recordingWebGL(), packedReaddRenderer = test.renderer(packedReaddContext);
  test.upload(packedReaddRenderer, packedReaddContext, expected, version, 1, 'bufferData');
  await test.deliver();
  test.stable(packedReaddRenderer, packedReaddContext, version);
  test.geometry.dispose();
  const beforeDormantRead = memory.stats().rehydrated;
  assert.equal(memory.peek(attribute), null);
  assert.deepEqual(bytesOf(attribute.array), expected);
  assert.equal(memory.stats().rehydrated, beforeDormantRead + 1, 'A later dormant getter returns exact bytes');
  assert.equal(memory.stats().managedAttributes, 0);
  console.log('PASS ' + Constructor.name + (normalized ? ' normalized' : '') + ' WebGL' + (isWebGL2 ? 2 : 1) +
    ': first/cached, mutation/version/range, fresh renderer/context/remove, replacement, lazy disposal/re-add and callbacks');
}

for (const isWebGL2 of [false, true]) {
  await verify(Float32Array, false, isWebGL2);
  await verify(Uint8Array, true, isWebGL2);
}
console.log('Geometry memory upload PASS: actual SHA-256-pinned THREE r159 sources from ' + sources);
console.log('Limit: fake GL bytes and deterministic worker; no real driver, pixels, context-loss events, physical-device or timing/memory acceptance.');
