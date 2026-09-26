// Real source selectors and dependency isolation, without generating geometry.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TARGETS, loadSelectedSpecs } from '../buildings/catalog.mjs';
import { DEFAULT_ROOT, DEFAULT_OPTIONS, compilerIdentity, sha256 } from '../buildings/compiler.mjs';
import { canonicalJSON } from '../../js/building-asset-codec.js';

test('the five exact source identities stay distinct from their source collections', async () => {
  const records = await loadSelectedSpecs(DEFAULT_ROOT, Object.keys(TARGETS));
  assert.equal(records.length, 5);
  assert.equal(new Set(records.map(r => r.spec.id)).size, 5);
  const painter = records.find(r => r.key === 'painter');
  assert.equal(painter.pointer, '/buildings');
  assert.deepEqual(painter.selector, { property: 'id', value: TARGETS.painter.id });
  const hero = records.find(r => r.key === 'gdc');
  assert.equal(hero.spec.featureCollection.features.length, 3881);
  assert.ok(hero.spec.featureCollection.features.every(f => f.properties.b === 'gdc'));
  assert.deepEqual(hero.spec.featureCollection.replacedBuildingIds, [TARGETS.gdc.id]);
  const apartments = await compilerIdentity(DEFAULT_ROOT, DEFAULT_OPTIONS, 'apartments');
  const heroes = await compilerIdentity(DEFAULT_ROOT, DEFAULT_OPTIONS, 'heroes');
  assert.ok(apartments.dependencies['js/slopes-apartments.js']);
  assert.ok(heroes.dependencies['js/heroes.js']);
  assert.equal(heroes.dependencies['js/slopes-apartments.js'], undefined);
  for (const identity of [apartments, heroes]) assert.ok(Object.keys(identity.dependencies).every(file => !file.startsWith('data/')), 'collection contents are not shared compiler dependencies');
});

test('editing or reordering siblings preserves selected source hashes and source selectors', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'flyover-catalog-test-'));
  const hashRecords = records => records.map(r => sha256(canonicalJSON(r.spec)));
  try {
    await fs.mkdir(path.join(temp, 'data'));
    const campus = JSON.parse(await fs.readFile(path.join(DEFAULT_ROOT, TARGETS.painter.file), 'utf8'));
    const heroes = JSON.parse(await fs.readFile(path.join(DEFAULT_ROOT, TARGETS.gdc.file), 'utf8'));
    const save = async () => {
      await fs.writeFile(path.join(temp, TARGETS.painter.file), JSON.stringify(campus));
      await fs.writeFile(path.join(temp, TARGETS.gdc.file), JSON.stringify(heroes));
    };
    await save();
    const original = await loadSelectedSpecs(temp, ['painter', 'gdc']);
    const before = hashRecords(original);
    const sibling = campus.buildings.find(b => b.id !== TARGETS.painter.id);
    assert.ok(sibling); sibling.name += ' independent edit';
    const feature = heroes.features.find(f => f.properties.b !== 'gdc');
    assert.ok(feature); feature.properties.h += 0.25;
    await save();
    assert.deepEqual(hashRecords(await loadSelectedSpecs(temp, ['painter', 'gdc'])), before);
    campus.buildings.reverse();
    await save();
    const reordered = await loadSelectedSpecs(temp, ['painter', 'gdc']);
    assert.deepEqual(hashRecords(reordered), before);
    assert.deepEqual(reordered.map(({ pointer, selector }) => ({ pointer, selector })),
      original.map(({ pointer, selector }) => ({ pointer, selector })), 'provenance must still find the unchanged building after a sibling reorder');
    campus.buildings.find(b => b.id === TARGETS.painter.id).blocks[0].z1 += 0.1;
    await save();
    const after = hashRecords(await loadSelectedSpecs(temp, ['painter', 'gdc']));
    assert.notEqual(after[0], before[0]); assert.equal(after[1], before[1]);
  } finally {
    const resolved = path.resolve(temp);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('flyover-catalog-test-'));
    await fs.rm(resolved, { recursive: true, force: true });
  }
});
