/** FBA1: independently addressable authored buildings, with unchanged typed arrays.
 * No Three.js dependency: this module is shared by the offline compiler and worker.
 * The SHA-256 in the catalog authenticates the complete file, including descriptors.
 */
export const BUILDING_ASSET_SCHEMA = 1;
export const BUILDING_ASSET_MAGIC = 'FBA1';
const PREFIX = 16;
const MAX_HEADER = 8 * 1024 * 1024;
const MAX_FILE = 256 * 1024 * 1024;
const TYPES = Object.freeze({
  Float32Array, Float64Array, Uint8Array, Uint8ClampedArray, Int8Array,
  Uint16Array, Int16Array, Uint32Array, Int32Array,
});
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const align = n => Math.ceil(n / 8) * 8;
const fail = message => { throw new Error('Building asset: ' + message); };
const plain = o => o !== null && typeof o === 'object' && !Array.isArray(o);
const validKey = k => !['__proto__', 'prototype', 'constructor'].includes(k);

/** Stable across object insertion order; rejects values JSON silently damages. */
export function canonicalJSON(value) {
  const visit = x => {
    if (x === null || typeof x === 'string' || typeof x === 'boolean') return JSON.stringify(x);
    if (typeof x === 'number') {
      if (!Number.isFinite(x)) fail('non-finite descriptor number');
      return JSON.stringify(x);
    }
    if (Array.isArray(x)) return '[' + x.map(visit).join(',') + ']';
    if (!plain(x) || ArrayBuffer.isView(x)) fail('descriptor is not JSON data');
    return '{' + Object.keys(x).sort().map(k => {
      if (!validKey(k)) fail('unsafe descriptor key');
      return JSON.stringify(k) + ':' + visit(x[k]);
    }).join(',') + '}';
  };
  return visit(value);
}

function bytesOf(input) {
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  fail('expected ArrayBuffer or typed array');
}

export async function buildingAssetHash(input) {
  if (!globalThis.crypto?.subtle) fail('SHA-256 is unavailable');
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytesOf(input));
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}

/** The returned views reference one backing buffer. Transfer that buffer once. */
export async function decodeVerifiedBuildingAsset(input, { expectedHash, ...options } = {}) {
  if (typeof expectedHash !== 'string' || !/^[a-f0-9]{64}$/.test(expectedHash)) fail('expected SHA-256 is missing or invalid');
  if (await buildingAssetHash(input) !== expectedHash) fail('SHA-256 mismatch');
  return decodeBuildingAsset(input, options);
}

/** Input arrays are copied without conversions, welding, quantization or compression. */
export function encodeBuildingAsset(asset) {
  validateBuildingAsset(asset);
  const arrays = [], seen = new Map();
  let payloadBytes = 0;
  const visit = x => {
    if (ArrayBuffer.isView(x)) {
      const type = x.constructor.name;
      if (!own(TYPES, type) || x instanceof DataView) fail('unsupported typed array');
      let number = seen.get(x);
      if (number === undefined) {
        payloadBytes = align(payloadBytes);
        number = arrays.length;
        arrays.push({ type, length: x.length, byteOffset: payloadBytes, byteLength: x.byteLength, array: x });
        seen.set(x, number);
        payloadBytes += x.byteLength;
      }
      return { $buffer: number };
    }
    if (Array.isArray(x)) return x.map(visit);
    if (plain(x)) {
      const out = {};
      for (const k of Object.keys(x).sort()) {
        if (!validKey(k)) fail('unsafe descriptor key');
        out[k] = visit(x[k]);
      }
      return out;
    }
    return x;
  };
  const descriptor = visit(asset);
  const header = new TextEncoder().encode(canonicalJSON({
    schemaVersion: BUILDING_ASSET_SCHEMA,
    asset: descriptor,
    buffers: arrays.map(({ array, ...d }) => d),
  }));
  if (header.byteLength > MAX_HEADER) fail('header exceeds limit');
  const payloadStart = align(PREFIX + header.byteLength);
  if (payloadStart + payloadBytes > MAX_FILE) fail('file exceeds limit');
  const bytes = new Uint8Array(payloadStart + payloadBytes);
  bytes.set([70, 66, 65, 49]);
  const view = new DataView(bytes.buffer);
  view.setUint16(4, BUILDING_ASSET_SCHEMA, true);
  view.setUint16(6, 0, true);
  view.setUint32(8, header.byteLength, true);
  view.setUint32(12, payloadBytes, true);
  bytes.set(header, PREFIX);
  for (const d of arrays) bytes.set(bytesOf(d.array), payloadStart + d.byteOffset);
  return bytes;
}

export function decodeBuildingAsset(input, { expectedId, maxBytes = MAX_FILE } = {}) {
  let bytes = bytesOf(input);
  if (bytes.byteLength < PREFIX || bytes.byteLength > maxBytes) fail('invalid file size');
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== BUILDING_ASSET_MAGIC) fail('bad magic');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(4, true) !== BUILDING_ASSET_SCHEMA || view.getUint16(6, true) !== 0) fail('unsupported schema or flags');
  const headerBytes = view.getUint32(8, true), payloadBytes = view.getUint32(12, true);
  const payloadStart = align(PREFIX + headerBytes);
  if (!headerBytes || headerBytes > MAX_HEADER || payloadStart + payloadBytes !== bytes.byteLength) fail('truncated or trailing data');
  let header;
  try { header = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(PREFIX, PREFIX + headerBytes))); }
  catch { fail('invalid header JSON'); }
  if (!plain(header) || header.schemaVersion !== BUILDING_ASSET_SCHEMA || !Array.isArray(header.buffers) || header.buffers.length > 100000) fail('invalid buffer table');
  // Node Buffers can start at an unaligned pooled offset. Worker ArrayBuffers do not.
  if (bytes.byteOffset % 8) bytes = bytes.slice();
  let previousEnd = 0;
  const arrays = header.buffers.map(d => {
    if (!plain(d) || !own(TYPES, d.type)) fail('unsupported buffer type');
    const Type = TYPES[d.type];
    if (!Number.isSafeInteger(d.length) || d.length < 0 ||
        !Number.isSafeInteger(d.byteOffset) || d.byteOffset % 8 || d.byteOffset < previousEnd ||
        d.byteLength !== d.length * Type.BYTES_PER_ELEMENT || d.byteOffset + d.byteLength > payloadBytes) fail('invalid or overlapping buffer range');
    previousEnd = d.byteOffset + d.byteLength;
    return new Type(bytes.buffer, bytes.byteOffset + payloadStart + d.byteOffset, d.length);
  });
  if (previousEnd !== payloadBytes) fail('unreferenced payload bytes');
  const used = new Set();
  const visit = (x, depth = 0) => {
    if (depth > 80) fail('descriptor nesting exceeds limit');
    if (Array.isArray(x)) return x.map(v => visit(v, depth + 1));
    if (plain(x)) {
      if (own(x, '$buffer')) {
        if (Object.keys(x).length !== 1 || !Number.isInteger(x.$buffer) || x.$buffer < 0 || x.$buffer >= arrays.length) fail('invalid buffer reference');
        used.add(x.$buffer);
        return arrays[x.$buffer];
      }
      const out = {};
      for (const k of Object.keys(x)) {
        if (!validKey(k)) fail('unsafe descriptor key');
        out[k] = visit(x[k], depth + 1);
      }
      return out;
    }
    if (typeof x === 'number' && !Number.isFinite(x)) fail('non-finite descriptor number');
    return x;
  };
  const asset = visit(header.asset);
  if (used.size !== arrays.length) fail('unreferenced payload buffer');
  validateBuildingAsset(asset, { expectedId });
  return asset;
}

function vector3(v, label) {
  if (!Array.isArray(v) || v.length !== 3 || !v.every(Number.isFinite)) fail(label + ' must be a finite vector');
}
function checkBounds(b, label) {
  if (!plain(b)) fail(label + ' missing');
  vector3(b.min, label + '.min'); vector3(b.max, label + '.max');
  if (b.min.some((v, i) => v > b.max[i])) fail(label + ' inverted');
}
function containsBounds(outer, inner) {
  return inner.min.every((v, i) => v >= outer.min[i] - 1e-4) && inner.max.every((v, i) => v <= outer.max[i] + 1e-4);
}

function checkHeroes(data, building, origin) {
  if (!plain(data) || data.adapter !== 'heroes' || data.schemaVersion !== 1) fail('unsupported MapLibre adapter');
  const fc = data.featureCollection;
  if (!plain(fc) || fc.type !== 'FeatureCollection' || !Array.isArray(fc.features) || !fc.features.length || fc.features.length > 100000) fail('invalid MapLibre feature collection');
  for (const field of ['replacedBuildingIds', 'authoredRoofIds']) {
    if (!Array.isArray(fc[field]) || fc[field].length !== 1 || fc[field][0] !== building.id) fail('MapLibre building identity mismatch');
  }
  if (!plain(fc.heroHeights) || !Number.isFinite(fc.heroHeights[building.id]) || fc.heroHeights[building.id] <= 0 || Object.keys(fc.heroHeights).length !== 1) fail('invalid MapLibre building height');
  const circumference = 2 * Math.PI * 6371008.8;
  const mercatorY = lat => (180 - (180 / Math.PI * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)))) / 360;
  const ox = (180 + origin.lng) / 360, oy = mercatorY(origin.lat);
  const inverseLat = 360 / Math.PI * Math.atan(Math.exp((180 - oy * 360) * Math.PI / 180)) - 90;
  const scale = 1 / circumference * (1 / Math.cos(inverseLat * Math.PI / 180));
  const checkPoint = (ll, z) => {
    const point = [((180 + ll[0]) / 360 - ox) / scale, -(mercatorY(ll[1]) - oy) / scale,
      z / (circumference * Math.cos(ll[1] * Math.PI / 180)) / scale];
    if (point.some((v, i) => !Number.isFinite(v) || v < building.bounds.min[i] - 1e-4 || v > building.bounds.max[i] + 1e-4)) fail('hero coordinate outside building bounds');
    if (Math.hypot(...point.map((v, i) => v - building.sphere.center[i])) > building.sphere.radius + 1e-4) fail('hero coordinate outside building sphere');
  };
  for (const feature of fc.features) {
    const p = feature?.properties, g = feature?.geometry;
    if (feature?.type !== 'Feature' || !plain(p) || p.b !== 'gdc' || !['solid', 'gdc-glass', 'brick', 'glassb'].includes(p.lyr) ||
        !Number.isFinite(p.base) || !Number.isFinite(p.h) || p.base < 0 || p.h < p.base || p.h > 1000 || ![0, 1].includes(p.cap)) fail('invalid hero feature properties');
    for (const color of ['wd', 'wg', 'wn']) if (typeof p[color] !== 'string' || !/^#[a-f0-9]{6}$/i.test(p[color])) fail('invalid hero feature color');
    if (!plain(g) || g.type !== 'Polygon' || !Array.isArray(g.coordinates) || !g.coordinates.length) fail('unsupported hero geometry');
    for (const ring of g.coordinates) {
      if (!Array.isArray(ring) || ring.length < 4 || ring.length > 100000) fail('invalid hero polygon ring');
      for (const point of ring) {
        if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite) || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 85.06) fail('invalid hero coordinate');
        checkPoint(point, p.base); checkPoint(point, p.h);
      }
      if (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1]) fail('unclosed hero polygon');
    }
  }
}

export function validateBuildingAsset(asset, { expectedId } = {}) {
  if (!plain(asset) || asset.schemaVersion !== BUILDING_ASSET_SCHEMA) fail('unsupported asset schema');
  const b = asset.building;
  if (!plain(b) || typeof b.id !== 'string' || !b.id || typeof b.name !== 'string' || !b.name) fail('building identity missing');
  if (expectedId !== undefined && b.id !== expectedId) fail('building ID mismatch');
  checkBounds(b.bounds, 'building bounds');
  if (!plain(b.sphere) || !Number.isFinite(b.sphere.radius) || b.sphere.radius < 0) fail('invalid building sphere');
  vector3(b.sphere.center, 'sphere center');
  const o = asset.origin;
  if (!plain(o) || !Number.isFinite(o.lng) || !Number.isFinite(o.lat) || Math.abs(o.lng) > 180 || Math.abs(o.lat) > 85.06 || o.units !== 'metres' || o.axes !== 'east,north,up') fail('invalid coordinate frame');
  if (!plain(asset.metadata) || asset.metadata.id !== b.id) fail('metadata identity mismatch');
  if (!plain(asset.source) || !/^[a-f0-9]{64}$/.test(asset.source.hash) || !plain(asset.compiler) || !/^[a-f0-9]{64}$/.test(asset.compiler.hash)) fail('source or compiler hash missing');
  if (asset.maplibre !== undefined) checkHeroes(asset.maplibre, b, o);
  if (!Array.isArray(asset.parts) || !asset.parts.length || asset.parts.length > 10000) fail('invalid part list');
  const ids = new Set();
  let geometryBytes = 0, textureBytes = 0, triangles = 0, opaqueTriangles = 0;
  for (const part of asset.parts) {
    if (!plain(part) || typeof part.id !== 'string' || !part.id.startsWith(b.id + '/') || ids.has(part.id)) fail('invalid or duplicate part ID');
    ids.add(part.id);
    if (!['opaque', 'filtered'].includes(part.kind)) fail('unsupported part kind');
    checkBounds(part.bounds, 'part bounds');
    if (!containsBounds(b.bounds, part.bounds)) fail('part outside building bounds');
    const g = part.geometry;
    if (!plain(g) || !plain(g.attributes)) fail('geometry missing');
    for (const name of ['position', 'normal', 'cDay', 'cGold', 'cNight', 'aFacet', 'aSurface']) if (!own(g.attributes, name)) fail('missing attribute ' + name);
    const p = g.attributes.position;
    if (!plain(p) || !(p.array instanceof Float32Array) || p.itemSize !== 3 || p.normalized || p.isFloat16 || !p.array.length || p.array.length % 3) fail('invalid position attribute');
    const count = p.array.length / 3;
    for (const [name, a] of Object.entries(g.attributes)) {
      if (!validKey(name) || !plain(a) || !ArrayBuffer.isView(a.array) || !own(TYPES, a.array.constructor.name) ||
          !Number.isInteger(a.itemSize) || a.itemSize < 1 || a.itemSize > 4 || a.array.length !== count * a.itemSize ||
          typeof a.normalized !== 'boolean' || typeof a.isFloat16 !== 'boolean') fail('invalid attribute ' + name);
      if (a.isFloat16 && !(a.array instanceof Uint16Array)) fail('half-float attribute has wrong storage');
      if (a.isFloat16 && a.array.some(v => (v & 0x7c00) === 0x7c00)) fail('non-finite half-float attribute ' + name);
      if (a.array instanceof Float32Array || a.array instanceof Float64Array) {
        for (const v of a.array) if (!Number.isFinite(v)) fail('non-finite attribute ' + name);
      }
    }
    const normal = g.attributes.normal;
    if (!((normal.array instanceof Float32Array && normal.itemSize === 3 && !normal.normalized) ||
          (normal.array instanceof Int8Array && normal.itemSize === 4 && normal.normalized)) || normal.isFloat16) fail('unsupported normal attribute');
    for (const [name, size] of Object.entries({ cDay: 3, cGold: 3, cNight: 3, aFacet: 1, aSurface: 4 })) if (g.attributes[name].itemSize !== size) fail('invalid shader attribute size ' + name);
    const idx = g.index;
    if (!plain(idx) || !(idx.array instanceof Uint16Array || idx.array instanceof Uint32Array) || idx.itemSize !== 1 || idx.normalized || idx.isFloat16 || !idx.array.length || idx.array.length % 3) fail('invalid triangle index');
    for (const v of idx.array) if (v >= count) fail('index exceeds vertex range');
    triangles += idx.array.length / 3;
    if (part.kind === 'opaque') opaqueTriangles += idx.array.length / 3;
    geometryBytes += idx.array.byteLength + Object.values(g.attributes).reduce((n, a) => n + a.array.byteLength, 0);
    for (let i = 0; i < p.array.length; i += 3) {
      let radius2 = 0;
      for (let k = 0; k < 3; k++) {
        const v = p.array[i + k];
        if (v < part.bounds.min[k] - 1e-4 || v > part.bounds.max[k] + 1e-4) fail('position outside part bounds');
        radius2 += (v - b.sphere.center[k]) ** 2;
      }
      if (radius2 > (b.sphere.radius + 1e-4) ** 2) fail('position outside building sphere');
    }
    if (part.kind === 'filtered') {
      if (!plain(part.textures) || part.material?.type !== 'facade') fail('filtered facade data missing');
      const tune = part.material.options;
      if (!plain(tune) || !['fadeStart', 'fadeEnd', 'nightFadeStart', 'nightFadeEnd'].every(k => Number.isFinite(tune[k]) && tune[k] >= 0) ||
          tune.fadeEnd <= tune.fadeStart || tune.nightFadeEnd <= tune.nightFadeStart) fail('invalid facade fade settings');
      let size;
      for (const name of ['day', 'gold', 'night']) {
        const t = part.textures[name];
        if (!plain(t) || !(t.array instanceof Uint8Array) || ![t.width, t.height, t.depth].every(v => Number.isInteger(v) && v > 0) ||
            t.width > 4096 || t.height > 4096 || t.depth > 256 || t.array.length !== t.width * t.height * t.depth * 4 ||
            t.format !== 'RGBA' || t.type !== 'UnsignedByte') fail('invalid facade texture ' + name);
        const s = t.sampling;
        if (!plain(s) || ![1003, 1006].includes(s.magFilter) || ![1003, 1004, 1005, 1006, 1007, 1008].includes(s.minFilter) ||
            ![1000, 1001, 1002].includes(s.wrapS) || ![1000, 1001, 1002].includes(s.wrapT) ||
            typeof s.generateMipmaps !== 'boolean' || typeof s.flipY !== 'boolean' || !Number.isFinite(s.anisotropy) || s.anisotropy < 1 ||
            !['', 'srgb', 'srgb-linear'].includes(s.colorSpace)) fail('invalid facade texture sampling');
        const dimensions = [t.width, t.height, t.depth].join(',');
        if (size && size !== dimensions) fail('facade texture dimensions disagree');
        size = dimensions;
        textureBytes += t.array.byteLength;
      }
      if (!Array.isArray(part.faces) || part.faces.length !== part.textures.day.depth ||
          part.faces.some(f => !plain(f) || !Number.isFinite(f.len) || f.len <= 0 || !Number.isFinite(f.z0) || !Number.isFinite(f.z1) || f.z1 <= f.z0)) fail('invalid facade face dimensions');
      for (const name of ['uv', 'faceLayer', 'faceSize']) if (!g.attributes[name]) fail('missing facade attribute ' + name);
      for (const name of ['uv', 'faceSize']) if (!(g.attributes[name].array instanceof Float32Array) || g.attributes[name].itemSize !== 2 || g.attributes[name].normalized) fail('invalid facade attribute size');
      if (g.attributes.faceSize.array.some(v => v <= 0)) fail('invalid facade face size');
      const layer = g.attributes.faceLayer;
      if (!(layer.array instanceof Float32Array) || layer.itemSize !== 1 || layer.normalized || layer.array.some(v => v < 0 || v >= part.textures.day.depth || !Number.isInteger(v))) fail('invalid facade layer');
    } else if (part.textures || part.material?.type !== 'slopes') fail('invalid opaque material');
    if (![0, 1, 2].includes(part.material.side)) fail('invalid material side');
  }
  const stats = asset.stats;
  if (!plain(stats) || stats.geometryBytes !== geometryBytes || stats.textureBytes !== textureBytes ||
      stats.triangles !== triangles || stats.parts !== asset.parts.length ||
      (stats.opaqueTriangles !== undefined && stats.opaqueTriangles !== opaqueTriangles)) fail('geometry/texture statistics disagree');
  return asset;
}
