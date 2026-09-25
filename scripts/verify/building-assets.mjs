// Verify emitted files against fresh production generators, without a GPU.
// node scripts/verify/building-assets.mjs [--only welch,painter,gdc,nueces,standard]
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { TARGETS, loadSelectedSpecs } from '../buildings/catalog.mjs';
import { DEFAULT_ROOT, DEFAULT_OPTIONS, compilerIdentity, serializeCompiledBuilding, sha256 } from '../buildings/compiler.mjs';
import { createCompilerRuntime } from '../buildings/runtime.mjs';
import { canonicalJSON, decodeBuildingAsset, encodeBuildingAsset } from '../../js/building-asset-codec.js';
import { assertGeometryBytes } from './building-fixtures.mjs';

const at = process.argv.indexOf('--only');
const keys = at < 0 ? Object.keys(TARGETS) : (process.argv[at + 1] || '').split(',');

test('emitted assets and manifest match fresh production outputs and current dependencies', async () => {
  const records = await loadSelectedSpecs(DEFAULT_ROOT, keys), runtime = await createCompilerRuntime(DEFAULT_ROOT);
  const directory = path.join(DEFAULT_ROOT, 'data/compiled-buildings');
  const manifest = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(new Set(manifest.buildings.map(b => b.id)).size, manifest.buildings.length);
  if (at < 0) assert.equal(manifest.buildings.length, 5, 'the authored district contains exactly five assets');
  for (const record of records) {
    const entry = manifest.buildings.find(e => e.id === record.spec.id);
    assert.ok(entry, 'asset is present: ' + record.spec.name);
    assert.match(entry.file, /^[a-zA-Z0-9_-]+\.[a-f0-9]{64}\.fba$/);
    const bytes = await fs.readFile(path.join(directory, entry.file));
    assert.equal(bytes.length, entry.bytes); assert.equal(sha256(bytes), entry.hash);
    const actual = decodeBuildingAsset(bytes, { expectedId: entry.id });
    const identity = await compilerIdentity(DEFAULT_ROOT, DEFAULT_OPTIONS, record.spec.renderer || 'apartments');
    assert.equal(actual.compiler.hash, identity.hash, 'current compiler dependencies: ' + record.key);
    assert.equal(actual.source.hash, sha256(canonicalJSON(record.spec)), 'current individual source: ' + record.key);
    assert.equal(entry.sourceHash, actual.source.hash); assert.equal(entry.compilerHash, actual.compiler.hash);
    assert.deepEqual(entry.bounds, actual.building.bounds); assert.deepEqual(entry.sphere, actual.building.sphere);
    assert.deepEqual(entry.origin, actual.origin); assert.deepEqual(entry.stats, actual.stats); assert.deepEqual(entry.metadata, actual.metadata);
    const result = await runtime.compile(record.spec, DEFAULT_OPTIONS);
    try {
      const expected = serializeCompiledBuilding(record, result, runtime, identity);
      assert.equal(actual.parts.length, expected.parts.length);
      for (let i = 0; i < expected.parts.length; i++) {
        assertGeometryBytes(actual.parts[i].geometry, expected.parts[i].geometry);
        assert.deepEqual(actual.parts[i].material, expected.parts[i].material);
        assert.deepEqual(actual.parts[i].textures, expected.parts[i].textures);
      }
      assert.deepEqual(actual.maplibre, expected.maplibre);
      assert.deepEqual(encodeBuildingAsset(expected), new Uint8Array(bytes), 'fresh compilation preserves the whole content address: ' + record.key);
      console.log(JSON.stringify({ building: entry.name, bytes: entry.bytes, triangles: actual.stats.triangles,
        geometryBytes: actual.stats.geometryBytes, textureBytes: actual.stats.textureBytes, parts: actual.parts.length,
        ...(actual.maplibre ? { maplibreFeatures: actual.maplibre.featureCollection.features.length } : {}) }));
    } finally { runtime.dispose(result); }
  }
});
