// CPU evidence, with real Three and complete generator files; no browser/GPU.
// node scripts/verify/building-compiler.mjs [--break]
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as THREE from '../buildings/node_modules/three/build/three.module.js';
import { compileBuildings, serializeCompiledBuilding, compilerIdentity, sha256, DEFAULT_ROOT, DEFAULT_OPTIONS } from '../buildings/compiler.mjs';
import { createCompilerRuntime, MercatorCoordinate } from '../buildings/runtime.mjs';
import { loadSelectedSpecs } from '../buildings/catalog.mjs';
import { canonicalJSON, encodeBuildingAsset, decodeBuildingAsset } from '../../js/building-asset-codec.js';
import { fixtureAsset, testIdentity, assertGeometryBytes } from './building-fixtures.mjs';

function geometry(d) {
  const g = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(d.attributes)) g.setAttribute(name, a.isFloat16
    ? new THREE.Float16BufferAttribute(a.array, a.itemSize, a.normalized)
    : new THREE.BufferAttribute(a.array, a.itemSize, a.normalized));
  g.setIndex(new THREE.BufferAttribute(d.index.array, d.index.itemSize, d.index.normalized));
  return g;
}
const descriptor = a => ({ array: a.array, itemSize: a.itemSize, normalized: a.normalized, isFloat16: !!a.isFloat16BufferAttribute });
const geometryDescriptor = g => ({ attributes: Object.fromEntries(Object.entries(g.attributes).map(([k, a]) => [k, descriptor(a)])), index: descriptor(g.index) });
const fixtureRecord = id => ({ key: id, file: 'data/test-collection.json', pointer: '/buildings/' + id,
  spec: { id, name: id, blocks: [{ id: 'base', plan: [0, 1, 0, 1], z0: 0, z1: 1 }] } });

function fakeRuntime() {
  const calls = [], disposed = [];
  return { calls, disposed, context: { SLOPES: { origin: [-97.7393, 30.286] } },
    async compile(spec) {
      calls.push(spec.id);
      const f = fixtureAsset({ id: spec.id }), group = new THREE.Group();
      if (spec.invalid) f.parts[0].geometry.index.array[0] = 99;
      group.add(new THREE.Mesh(geometry(f.parts[0].geometry), new THREE.ShaderMaterial()));
      return { group, metadata: f.metadata, counts: { generationMs: 0, finalizationMs: 0, filterResolutionLevel: 1 }, triangles: 2 };
    },
    dispose(result) {
      disposed.push(result.metadata.id);
      result.group.traverse(m => { m.geometry?.dispose(); m.material?.dispose(); });
    },
  };
}
async function snapshot(outDir) {
  const files = {};
  for (const name of (await fs.readdir(outDir)).sort()) {
    const file = path.join(outDir, name), bytes = await fs.readFile(file), stat = await fs.stat(file);
    files[name] = { hash: sha256(bytes), size: stat.size, mtime: stat.mtimeMs };
  }
  return files;
}

test('no-op bakes are byte stable; one collection spec invalidates only its building', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'flyover-building-test-'));
  const outDir = path.join(temp, 'compiled'), runtime = fakeRuntime();
  const a = fixtureRecord('fixture-a'), b = fixtureRecord('fixture-b');
  const bake = (records, identity = testIdentity) => compileBuildings({ outDir, records, runtime, identity });
  try {
    assert.equal((await bake([a, b])).compiled.length, 2);
    const first = await snapshot(outDir), firstManifest = JSON.parse(await fs.readFile(path.join(outDir, 'manifest.json')));
    const unchanged = await bake([a, b]);
    assert.equal(unchanged.compiled.length, 0); assert.equal(unchanged.unchanged.length, 2);
    assert.deepEqual(await snapshot(outDir), first, 'no writes or timestamp changes on a no-op');
    assert.equal(runtime.calls.length, 2, 'no generator work on a no-op');

    const edited = structuredClone(a); edited.spec.blocks[0].z1 = 2;
    const changed = await bake([edited, b]);
    assert.deepEqual(changed.compiled.map(e => e.id), ['fixture-a']);
    const secondManifest = JSON.parse(await fs.readFile(path.join(outDir, 'manifest.json')));
    assert.deepEqual(secondManifest.buildings.find(e => e.id === 'fixture-b'), firstManifest.buildings.find(e => e.id === 'fixture-b'));
    assert.notEqual(secondManifest.buildings.find(e => e.id === 'fixture-a').sourceHash, firstManifest.buildings.find(e => e.id === 'fixture-a').sourceHash);

    const stable = await snapshot(outDir), nextA = structuredClone(edited), badB = structuredClone(b);
    nextA.spec.blocks[0].z1 = 3; badB.spec.invalid = true;
    await assert.rejects(bake([nextA, badB]), /index exceeds vertex range/);
    assert.deepEqual(await snapshot(outDir), stable, 'failed second asset leaves manifest and all old assets untouched');
    assert.deepEqual(runtime.disposed.slice(-2), ['fixture-a', 'fixture-b'], 'both pending and invalid outputs are disposed');

    const entry = secondManifest.buildings.find(e => e.id === 'fixture-a');
    const file = path.join(outDir, entry.file), corrupt = await fs.readFile(file);
    corrupt[corrupt.length - 1] ^= 1; await fs.writeFile(file, corrupt);
    assert.deepEqual((await bake([edited, b])).compiled.map(e => e.id), ['fixture-a'], 'corrupt cache must rebuild');
    assert.equal(sha256(await fs.readFile(file)), entry.hash, 'rebuilt content has the original content address');

    assert.equal((await bake([edited, b], { ...testIdentity, hash: '3'.repeat(64) })).compiled.length, 2, 'shared compiler change invalidates both');
    assert.ok((await fs.readdir(outDir)).every(name => !name.startsWith('.stage-')));
    for (const e of JSON.parse(await fs.readFile(path.join(outDir, 'manifest.json'))).buildings) decodeBuildingAsset(await fs.readFile(path.join(outDir, e.file)), { expectedId: e.id });
  } finally {
    const resolved = path.resolve(temp);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('flyover-building-test-'));
    await fs.rm(resolved, { recursive: true, force: true });
  }
});

test('ENU scale follows pinned MapLibre operation order, including the last bit', () => {
  const origin = MercatorCoordinate.fromLngLat([-97.7393587, 30.2860098]);
  assert.equal(origin.meterInMercatorCoordinateUnits(), 2.8929449583396323e-8);
  const regrouped = 1 / (2 * Math.PI * 6371008.8) / Math.cos(origin.toLngLat().lat * Math.PI / 180);
  assert.notEqual(origin.meterInMercatorCoordinateUnits(), regrouped, 'algebraic reassociation changes authored normals');
});

test('complete Welch generator preserves every vertex/index byte, roof metadata and CPU ray hits', async () => {
  const runtime = await createCompilerRuntime(DEFAULT_ROOT), [record] = await loadSelectedSpecs(DEFAULT_ROOT, ['welch']);
  const identity = await compilerIdentity(DEFAULT_ROOT, DEFAULT_OPTIONS);
  const liveCounts = canonicalJSON(runtime.context.slopesApartments.count);
  let pauses = 0;
  const result = await runtime.compile(record.spec, { ...DEFAULT_OPTIONS, pause: async () => {
    pauses++;
    assert.equal(canonicalJSON(runtime.context.slopesApartments.count), liveCounts, 'yielded compilation must expose the live city counters');
  } });
  assert.ok(pauses > 0, 'the generator actually yielded while compiling Welch');
  assert.equal(canonicalJSON(runtime.context.slopesApartments.count), liveCounts, 'compilation must preserve live city counters');
  const restored = new THREE.Group();
  try {
    const asset = serializeCompiledBuilding(record, result, runtime, identity), bytes = encodeBuildingAsset(asset), decoded = decodeBuildingAsset(bytes);
    assert.equal(decoded.stats.triangles, 44973, 'recorded Welch baseline with real roofs');
    assert.equal(decoded.stats.geometryBytes, 5881926, 'desktop array layout stays exact');
    assert.equal(decoded.parts.length, 6);
    if (process.argv.includes('--break')) decoded.parts[0].geometry.attributes.aFacet.array[0] ^= 1;
    const meshes = []; result.group.traverse(m => { if (m.isMesh) meshes.push(m); });
    const normal = new Float32Array(meshes.reduce((n, m) => n + m.geometry.attributes.normal.array.length, 0));
    let normalOffset = 0;
    for (const m of meshes) { normal.set(m.geometry.attributes.normal.array, normalOffset); normalOffset += m.geometry.attributes.normal.array.length; }
    // First live-browser mismatch from the original ENU shim: positions matched,
    // but regrouping its scale changed this near-zero normal component's bits.
    assert.equal(normal[90950], -8.542218175216013e-14, 'recorded normal at byte 363800');
    meshes.forEach((m, i) => {
      assertGeometryBytes(decoded.parts[i].geometry, geometryDescriptor(m.geometry));
      restored.add(new THREE.Mesh(geometry(decoded.parts[i].geometry), new THREE.MeshBasicMaterial({ side: decoded.parts[i].material.side })));
    });
    for (const key of Object.keys(result.metadata)) assert.equal(canonicalJSON(decoded.metadata[key]), canonicalJSON(result.metadata[key]), 'metadata ' + key);
    assert.ok(decoded.metadata.roofs.some(r => r.kind === 'hip' && r.triangles > 0));
    assert.deepEqual(decoded.metadata.authoredParts.map(p => p.id), record.spec.blocks.map(b => record.spec.id + '/block/' + encodeURIComponent(b.id || b.name)));
    result.group.updateMatrixWorld(true); restored.updateMatrixWorld(true);
    let hits = 0;
    const { min, max } = decoded.building.bounds;
    for (const u of [0.15, 0.5, 0.85]) for (const v of [0.1, 0.35, 0.65, 0.9]) {
      const ray = new THREE.Raycaster(new THREE.Vector3(min[0] + (max[0] - min[0]) * u, min[1] + (max[1] - min[1]) * v, max[2] + 10), new THREE.Vector3(0, 0, -1));
      const reference = ray.intersectObject(result.group, true), candidate = ray.intersectObject(restored, true);
      assert.deepEqual(candidate.map(h => [h.distance, ...h.point.toArray()]), reference.map(h => [h.distance, ...h.point.toArray()]));
      hits += reference.length;
    }
    assert.ok(hits > 0, 'ray probes actually intersect Welch');
    assert.deepEqual(encodeBuildingAsset(serializeCompiledBuilding(record, result, runtime, identity)), bytes);
    const independent = await createCompilerRuntime(DEFAULT_ROOT), rebuilt = await independent.compile(record.spec, DEFAULT_OPTIONS);
    try {
      assert.deepEqual(encodeBuildingAsset(serializeCompiledBuilding(record, rebuilt, independent, identity)), bytes, 'fresh VM generation is byte stable');
    } finally { independent.dispose(rebuilt); }
    console.log(JSON.stringify({ building: record.spec.name, triangles: decoded.stats.triangles, bytes: bytes.length, rayHits: hits }));
  } finally {
    runtime.dispose(result);
    restored.traverse(m => { m.geometry?.dispose(); m.material?.dispose(); });
  }
});

test('actual FacadeFilter array textures and sampling settings survive serialization and disposal', async () => {
  const runtime = await createCompilerRuntime(DEFAULT_ROOT), F = runtime.context.FacadeFilter;
  const record = fixtureRecord('filtered-fixture'), f = fixtureAsset({ id: record.spec.id, filtered: true });
  const col = ['#517191', '#977151', '#080f21']; col.surface = [4, 0, 0, 0.65];
  const face = F.createFace({ THREE, len: 1, z0: 0, z1: 1, rects: [[0, 1, 0, 1, col]], options: { resolutionLevel: 1 } });
  assert.ok(face, 'actual face is allocated');
  const [batch] = F.createBatch({ THREE, faces: [face] });
  const group = new THREE.Group(), material = runtime.context.slopes.facadeMaterial(batch, runtime.context.APARTMENTS.facadeFilter);
  const mesh = new THREE.Mesh(geometry(f.parts[0].geometry), material);
  mesh.userData.facadeBatch = batch;
  mesh.userData.disposeFacade = () => { batch.dispose(); material.dispose(); };
  group.add(mesh);
  const result = { group, metadata: f.metadata, triangles: 0, counts: { filterResolutionLevel: 1 } };
  try {
    const asset = serializeCompiledBuilding(record, result, runtime, testIdentity), decoded = decodeBuildingAsset(encodeBuildingAsset(asset));
    for (const name of ['day', 'gold', 'night']) {
      const original = batch.textures[name], d = decoded.parts[0].textures[name];
      assert.deepEqual(d.array, original.image.data, name + ' exact color/response texels');
      assert.deepEqual([d.width, d.height, d.depth], [original.image.width, original.image.height, original.image.depth]);
      for (const [key, value] of Object.entries(d.sampling)) assert.equal(value, original[key], name + ' ' + key);
    }
    assert.ok(decoded.stats.textureBytes > 0);
  } finally { runtime.dispose(result); }
  assert.equal(F.bytes, 0); assert.equal(F.count, 0);
});
