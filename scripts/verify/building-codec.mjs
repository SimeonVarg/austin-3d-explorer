// node scripts/verify/building-codec.mjs; --break proves the fidelity gate fails.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../buildings/node_modules/three/build/three.module.js';
import { canonicalJSON, encodeBuildingAsset, decodeBuildingAsset, decodeVerifiedBuildingAsset, buildingAssetHash } from '../../js/building-asset-codec.js';
import { fixtureAsset, assertGeometryBytes, rewriteHeader, corruptArray } from './building-fixtures.mjs';

const reversed = x => ArrayBuffer.isView(x) ? x : Array.isArray(x) ? x.map(reversed)
  : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).reverse().map(k => [k, reversed(x[k])])) : x;

test('FBA1 preserves exact desktop and packed storage through real Three r159 attributes', () => {
  for (const packed of [false, true]) {
    const input = fixtureAsset({ packed }), bytes = encodeBuildingAsset(input), output = decodeBuildingAsset(bytes);
    if (process.argv.includes('--break')) output.parts[0].geometry.attributes.cDay.array[0] ^= 1;
    assertGeometryBytes(output.parts[0].geometry, input.parts[0].geometry);
    for (const [name, d] of Object.entries(output.parts[0].geometry.attributes)) {
      const a = d.isFloat16 ? new THREE.Float16BufferAttribute(d.array, d.itemSize, d.normalized)
        : new THREE.BufferAttribute(d.array, d.itemSize, d.normalized);
      assertGeometryBytes({ attributes: { [name]: { ...a, isFloat16: !!a.isFloat16BufferAttribute } }, index: output.parts[0].geometry.index },
        { attributes: { [name]: input.parts[0].geometry.attributes[name] }, index: input.parts[0].geometry.index });
    }
    assert.equal(Object.is(output.parts[0].geometry.attributes.position.array[2], -0), true, 'negative zero bits survive');
    assert.deepEqual(encodeBuildingAsset(output), bytes, 'decode/encode is byte stable');
  }
});

test('canonical descriptor ordering and typed views are deterministic', () => {
  const input = fixtureAsset({ filtered: true });
  assert.deepEqual(encodeBuildingAsset(input), encodeBuildingAsset(reversed(input)));
  const bytes = encodeBuildingAsset(input), unaligned = new Uint8Array(bytes.length + 3);
  unaligned.set(bytes, 3);
  const output = decodeBuildingAsset(unaligned.subarray(3), { expectedId: input.building.id });
  assertGeometryBytes(output.parts[0].geometry, input.parts[0].geometry);
  for (const name of ['day', 'gold', 'night']) assert.deepEqual(output.parts[0].textures[name], input.parts[0].textures[name]);
  assert.throws(() => canonicalJSON({ silentlyLost: undefined }), /not JSON/);
  assert.throws(() => canonicalJSON({ invalid: NaN }), /non-finite/);
});

test('whole-file SHA-256 binds geometry and descriptor identity', async () => {
  const bytes = encodeBuildingAsset(fixtureAsset()), hash = await buildingAssetHash(bytes);
  assert.equal((await decodeVerifiedBuildingAsset(bytes, { expectedHash: hash })).building.id, 'fixture-a');
  const corrupted = bytes.slice(); corrupted[corrupted.length - 1] ^= 1;
  await assert.rejects(decodeVerifiedBuildingAsset(corrupted, { expectedHash: hash }), /SHA-256 mismatch/);
  await assert.rejects(decodeVerifiedBuildingAsset(bytes), /SHA-256 is missing/);
  assert.throws(() => decodeBuildingAsset(bytes, { expectedId: 'different-building' }), /ID mismatch/);
});

test('corrupt lengths, schemas, typed-array descriptors and ranges are rejected', () => {
  const bytes = encodeBuildingAsset(fixtureAsset());
  const magic = bytes.slice(); magic[0] = 0; assert.throws(() => decodeBuildingAsset(magic), /bad magic/);
  const schema = bytes.slice(); schema[4] = 2; assert.throws(() => decodeBuildingAsset(schema), /unsupported schema/);
  assert.throws(() => decodeBuildingAsset(bytes.subarray(0, bytes.length - 1)), /truncated/);
  assert.throws(() => decodeBuildingAsset(bytes, { maxBytes: bytes.length - 1 }), /file size/);
  for (const [change, error] of [
    [h => { h.buffers[1].byteOffset = 0; }, /overlapping/],
    [h => { h.buffers[0].type = 'Uint128Array'; }, /unsupported buffer type/],
    [h => { h.buffers[0].length += 1; }, /buffer range/],
    [h => { h.asset.parts[0].geometry.attributes.position = null; }, /unreferenced payload buffer/],
    [h => { h.asset.parts[0].geometry.attributes.normal.itemSize = 4; }, /invalid attribute normal/],
    [h => { h.asset.parts[0].geometry.index.itemSize = 2; }, /triangle index/],
    [h => { h.asset.parts[0].geometry.attributes.cDay.array.$buffer = 999; }, /buffer reference/],
    [h => { h.asset.parts[0].id = 'wrong/part'; }, /part ID/],
    [h => { h.asset.building.bounds.max = [-1, -1, -1]; }, /inverted/],
    [h => { h.asset.building.sphere.radius = 0.1; }, /outside building sphere/],
    [h => { h.asset.parts[0].bounds.max[0] = 0.5; }, /outside part bounds/],
    [h => { h.asset.stats.geometryBytes -= 1; }, /statistics disagree/],
    [h => { h.asset.stats.parts += 1; }, /statistics disagree/],
  ]) assert.throws(() => decodeBuildingAsset(rewriteHeader(bytes, change)), error);
});

test('finite geometry, shader layouts and facade dimensions are validated before upload', () => {
  const bytes = encodeBuildingAsset(fixtureAsset());
  for (const name of ['position', 'normal']) {
    const bad = corruptArray(bytes, a => a.parts[0].geometry.attributes[name].array, v => v.setFloat32(0, Infinity, true));
    assert.throws(() => decodeBuildingAsset(bad), new RegExp('non-finite attribute ' + name));
  }
  const badIndex = corruptArray(bytes, a => a.parts[0].geometry.index.array, v => v.setUint32(0, 4, true));
  assert.throws(() => decodeBuildingAsset(badIndex), /index exceeds vertex range/);
  const half = encodeBuildingAsset(fixtureAsset({ packed: true }));
  assert.throws(() => decodeBuildingAsset(corruptArray(half, a => a.parts[0].geometry.attributes.aSurface.array, v => v.setUint16(0, 0x7e00, true))), /non-finite half-float/);
  const filtered = encodeBuildingAsset(fixtureAsset({ filtered: true }));
  assert.throws(() => decodeBuildingAsset(rewriteHeader(filtered, h => { h.asset.parts[0].textures.day.depth = 2; })), /invalid facade texture/);
  assert.throws(() => decodeBuildingAsset(rewriteHeader(filtered, h => { h.asset.parts[0].textures.day.sampling.minFilter = -1; })), /invalid facade texture sampling/);
  assert.throws(() => decodeBuildingAsset(rewriteHeader(filtered, h => { h.asset.parts[0].material.options.fadeEnd = 0; })), /invalid facade fade settings/);
  assert.throws(() => decodeBuildingAsset(rewriteHeader(filtered, h => { h.asset.parts[0].faces = []; })), /invalid facade face dimensions/);
  assert.throws(() => decodeBuildingAsset(corruptArray(filtered, a => a.parts[0].geometry.attributes.faceLayer.array, v => v.setFloat32(0, 1, true))), /invalid facade layer/);
});

test('MapLibre heroes retain original features and validate every facade against shared ENU bounds', () => {
  const input = fixtureAsset(), { lng, lat } = input.origin, id = input.building.id;
  input.maplibre = { adapter: 'heroes', schemaVersion: 1, featureCollection: {
    type: 'FeatureCollection', replacedBuildingIds: [id], authoredRoofIds: [id], heroHeights: { [id]: 0.1 },
    features: [{ type: 'Feature', properties: { b: 'gdc', band: 'roof', lyr: 'solid', base: 0, h: 0.1, cap: 1,
      wd: '#dddddd', wg: '#eeddaa', wn: '#222222' }, geometry: { type: 'Polygon', coordinates: [
      [[lng, lat], [lng + 0.000001, lat], [lng + 0.000001, lat + 0.000001], [lng, lat]],
    ] } }],
  } };
  const bytes = encodeBuildingAsset(input), decoded = decodeBuildingAsset(bytes);
  assert.deepEqual(decoded.maplibre, input.maplibre);
  for (const [change, error] of [
    [h => { h.asset.maplibre.adapter = 'new-material'; }, /unsupported MapLibre adapter/],
    [h => { h.asset.maplibre.featureCollection.replacedBuildingIds = ['wrong']; }, /identity mismatch/],
    [h => { h.asset.maplibre.featureCollection.features[0].properties.wd = 'red'; }, /feature color/],
    [h => { h.asset.maplibre.featureCollection.features[0].properties.h = 1; }, /outside building bounds/],
    [h => { h.asset.maplibre.featureCollection.features[0].geometry.coordinates[0][1][0] += 0.01; }, /outside building bounds/],
    [h => { h.asset.maplibre.featureCollection.features[0].geometry.coordinates[0].at(-1)[0] += 0.0000001; }, /unclosed hero polygon/],
    [h => { h.asset.building.sphere.radius = 0.1; }, /hero coordinate outside building sphere/],
  ]) assert.throws(() => decodeBuildingAsset(rewriteHeader(bytes, change)), error);
});
