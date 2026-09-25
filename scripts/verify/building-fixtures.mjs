import assert from 'node:assert/strict';

export const testIdentity = { version: 'test', hash: '2'.repeat(64) };
const attribute = (array, itemSize, normalized = false, isFloat16 = false) => ({ array, itemSize, normalized, isFloat16 });

export function fixtureAsset({ id = 'fixture-a', filtered = false, packed = false } = {}) {
  const attributes = {
    position: attribute(new Float32Array([0, 0, -0, 1, 0, 0, 0, 1, 0, 1, 1, 0.25]), 3),
    normal: packed
      ? attribute(new Int8Array([0, 0, 127, 0, 0, 0, 127, 0, 0, 0, 127, 0, 0, 0, 127, 0]), 4, true)
      : attribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), 3),
    cDay: attribute(new Uint8Array([255, 0, 17, 31, 63, 127, 23, 254, 1, 255, 255, 0]), 3, true),
    cGold: attribute(new Uint8Array(12).fill(91), 3, true),
    cNight: attribute(new Uint8Array(12).fill(7), 3, true),
    aFacet: attribute(new Uint8Array([0, 1, 1, 0]), 1),
    aSurface: packed
      ? attribute(new Uint16Array([0x3c00, 0, 0x3800, 0x8000, 0x4000, 0x3933, 0x2cfd, 0x3933, 0x4400, 0x3933, 0x2cfd, 0x3933, 0x3c00, 0, 0, 0]), 4, false, true)
      : attribute(new Float32Array([1, 0, 0.5, -0, 2, 0.65, 0.078, 0.65, 4, 0.65, 0.078, 0.65, 1, 0, 0, 0]), 4),
  };
  const part = { id: id + (filtered ? '/filtered/0000' : '/opaque/0000'), kind: filtered ? 'filtered' : 'opaque',
    bounds: { min: [0, 0, 0], max: [1, 1, 0.25] }, geometry: { attributes, index: attribute(new (packed ? Uint16Array : Uint32Array)([0, 1, 2, 1, 3, 2]), 1) },
    material: { type: filtered ? 'facade' : 'slopes', side: 2 } };
  if (filtered) {
    Object.assign(attributes, { uv: attribute(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), 2),
      faceLayer: attribute(new Float32Array([0, 0, 0, 0]), 1), faceSize: attribute(new Float32Array(8).fill(1), 2) });
    part.material.options = { anisotropy: 4, texelMetres: 0.25, resolutionLevel: 1,
      fadeStart: 0.3, fadeEnd: 0.8, nightFadeStart: 0.4, nightFadeEnd: 0.5 };
    part.faces = [{ len: 1, z0: 0, z1: 1 }];
    part.textures = Object.fromEntries(['day', 'gold', 'night'].map((name, j) => [name, {
      array: Uint8Array.from({ length: 16 }, (_, i) => (i * 13 + j * 17) % 256), width: 2, height: 2, depth: 1,
      format: 'RGBA', type: 'UnsignedByte', sampling: { magFilter: 1006, minFilter: 1008, wrapS: 1001, wrapT: 1001,
        generateMipmaps: true, flipY: false, anisotropy: 4, colorSpace: '' },
    }]));
  }
  return { schemaVersion: 1, building: { id, name: 'Compiler fixture', bounds: structuredClone(part.bounds), sphere: { center: [0.5, 0.5, 0.125], radius: 1 } },
    origin: { lng: -97.7393, lat: 30.286, units: 'metres', axes: 'east,north,up' },
    metadata: { id, name: 'Compiler fixture', top: 0.25, frame: { O: [0, 0, 0], U: [1, 0], V: [0, 1], L: 1, W: 1, bearing: 0 },
      roofs: [], rakes: [], signs: 0, insets: 0, footprint: null, aliases: [] },
    source: { hash: '1'.repeat(64) }, compiler: testIdentity,
    stats: { triangles: 2, parts: 1, geometryBytes: part.geometry.index.array.byteLength + Object.values(attributes).reduce((n, a) => n + a.array.byteLength, 0),
      textureBytes: Object.values(part.textures || {}).reduce((n, t) => n + t.array.byteLength, 0) }, parts: [part] };
}

export function assertAttributeBytes(actual, expected, label) {
  assert.equal(actual.array.constructor.name, expected.array.constructor.name, label + ' storage');
  for (const name of ['itemSize', 'normalized', 'isFloat16']) assert.equal(actual[name], expected[name], label + ' ' + name);
  assert.deepEqual(new Uint8Array(actual.array.buffer, actual.array.byteOffset, actual.array.byteLength),
    new Uint8Array(expected.array.buffer, expected.array.byteOffset, expected.array.byteLength), label + ' bytes');
}

export function assertGeometryBytes(actual, expected) {
  assert.deepEqual(Object.keys(actual.attributes).sort(), Object.keys(expected.attributes).sort());
  for (const name of Object.keys(expected.attributes)) assertAttributeBytes(actual.attributes[name], expected.attributes[name], name);
  assertAttributeBytes(actual.index, expected.index, 'index');
}

/** Rebuild only the JSON header, retaining the payload to exercise the decoder. */
export function rewriteHeader(bytes, change) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const oldSize = view.getUint32(8, true), payloadSize = view.getUint32(12, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(16, 16 + oldSize)));
  const changed = change(header) ?? header;
  const json = new TextEncoder().encode(JSON.stringify(changed));
  const start = Math.ceil((16 + json.length) / 8) * 8;
  const result = new Uint8Array(start + payloadSize), resultView = new DataView(result.buffer);
  result.set(bytes.subarray(0, 16)); resultView.setUint32(8, json.length, true);
  result.set(json, 16); result.set(bytes.subarray(Math.ceil((16 + oldSize) / 8) * 8), start);
  return result;
}

export function corruptArray(bytes, find, mutate) {
  const result = bytes.slice(), view = new DataView(result.buffer);
  const headerSize = view.getUint32(8, true);
  const header = JSON.parse(new TextDecoder().decode(result.subarray(16, 16 + headerSize)));
  const d = header.buffers[find(header.asset).$buffer];
  mutate(new DataView(result.buffer, Math.ceil((16 + headerSize) / 8) * 8 + d.byteOffset, d.byteLength));
  return result;
}
