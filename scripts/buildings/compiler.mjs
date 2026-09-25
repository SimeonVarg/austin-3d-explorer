import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { BUILDING_ASSET_SCHEMA, canonicalJSON, encodeBuildingAsset, decodeBuildingAsset } from '../../js/building-asset-codec.js';
import { createCompilerRuntime, GENERATOR_FILES, HERO_GENERATOR_FILES } from './runtime.mjs';
import { loadSelectedSpecs } from './catalog.mjs';

export const COMPILER_VERSION = '1.0.0';
export const DEFAULT_OPTIONS = Object.freeze({ detail: 1, chunkTriangles: 8192, filteredResolutionLevel: 1 });
export const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SHARED_FILES = ['js/building-asset-codec.js', 'scripts/buildings/runtime.mjs', 'scripts/buildings/catalog.mjs',
  'scripts/buildings/compiler.mjs', 'scripts/buildings/package-lock.json'];
export const DEPENDENCY_FILES = [...GENERATOR_FILES, ...SHARED_FILES];
export const sha256 = data => createHash('sha256').update(data).digest('hex');
const jsonCopy = value => JSON.parse(JSON.stringify(value));
const finite3 = v => [v.x, v.y, v.z];

export async function compilerIdentity(rootDir, options, renderer = 'apartments') {
  const dependencies = {};
  for (const file of renderer === 'heroes' ? [...HERO_GENERATOR_FILES, ...SHARED_FILES] : DEPENDENCY_FILES) dependencies[file] = sha256((await fs.readFile(path.join(rootDir, file), 'utf8')).replace(/\r\n/g, '\n'));
  const identity = { version: COMPILER_VERSION, schemaVersion: BUILDING_ASSET_SCHEMA, three: '0.159.0', renderer, options, dependencies };
  return { ...identity, hash: sha256(canonicalJSON(identity)) };
}

function sourceMetadata(record, hash) {
  return { hash, file: record.file, pointer: record.pointer, buildingId: record.spec.id,
    ...(record.selector ? { selector: record.selector } : {}),
    priority: 100, kind: record.spec.renderer === 'heroes' ? 'authored-hero-features' : 'authored-building-spec', confidence: 'unreviewed', measurementStatus: 'not-surveyed',
    referenceKeys: Object.keys(record.spec.sources || {}).sort() };
}
function authoredMetadata(spec) {
  if (spec.renderer === 'heroes') {
    const bands = new Map();
    for (const f of spec.featureCollection.features) {
      const band = f.properties.band;
      bands.set(band, (bands.get(band) || 0) + 1);
    }
    return { authoredParts: [...bands].map(([band, featureCount]) => ({ id: spec.id + '/band/' + encodeURIComponent(band),
      sourceSelector: { property: 'band', value: band }, featureCount,
      sourcePriority: 100, confidence: 'unreviewed', measurementStatus: 'not-surveyed',
      editable: { fields: ['geometry.coordinates', 'properties.base', 'properties.h'], source: 'maplibre.featureCollection' } })),
      editableDimensions: { units: 'metres', height: spec.featureCollection.heroHeights[spec.id],
        sourcePriority: 100, confidence: 'unreviewed', measurementStatus: 'not-surveyed' } };
  }
  const used = new Set();
  const authoredParts = (spec.blocks || []).map((block, index) => {
    const key = String(block.id || block.name || index);
    if (used.has(key)) throw new Error(spec.name + ': duplicate authored block identity ' + key);
    used.add(key);
    const item = { id: spec.id + '/block/' + encodeURIComponent(key), sourcePointer: '/blocks/' + index,
      sourcePriority: 100, confidence: 'unreviewed', measurementStatus: 'not-surveyed',
      editable: { plan: jsonCopy(block.plan || {}), z0: block.z0 ?? 0, z1: block.z1 ?? null } };
    return item;
  });
  return { authoredParts, editableDimensions: {
    units: 'metres', sourcePriority: 100, confidence: 'unreviewed', measurementStatus: 'not-surveyed',
    levels: jsonCopy(spec.levels || {}), frame: jsonCopy(spec.frame || {}),
  } };
}
function attribute(a) {
  if (!a?.array || a.isInterleavedBufferAttribute) throw new Error('Compiler requires retained, non-interleaved attributes');
  return { array: a.array, itemSize: a.itemSize, normalized: !!a.normalized, isFloat16: !!a.isFloat16BufferAttribute };
}
function bounds(geometry) {
  geometry.computeBoundingBox();
  return { min: finite3(geometry.boundingBox.min), max: finite3(geometry.boundingBox.max) };
}
function textureDescriptor(texture) {
  const image = texture.image;
  if (!image?.data) throw new Error('Compiler requires retained facade texture data');
  return { array: image.data, width: image.width, height: image.height, depth: image.depth || 1,
    format: 'RGBA', type: 'UnsignedByte', sampling: {
      magFilter: texture.magFilter, minFilter: texture.minFilter, wrapS: texture.wrapS, wrapT: texture.wrapT,
      generateMipmaps: texture.generateMipmaps, flipY: texture.flipY, anisotropy: texture.anisotropy,
      colorSpace: texture.colorSpace,
    } };
}

export function serializeCompiledBuilding(record, result, runtime, compiler) {
  const { spec } = record;
  const sourceHash = sha256(canonicalJSON(spec));
  const parts = [], kindCount = { opaque: 0, filtered: 0 };
  const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  result.group.traverse(mesh => {
    if (!mesh.isMesh) return;
    if (mesh.position.lengthSq() || mesh.rotation.x || mesh.rotation.y || mesh.rotation.z || mesh.scale.x !== 1 || mesh.scale.y !== 1 || mesh.scale.z !== 1) throw new Error('Building geometry must already use the shared ENU frame');
    const batch = mesh.userData.facadeBatch;
    if (mesh.userData.disposeFacade && !batch) throw new Error('Filtered mesh is missing its facadeBatch descriptor');
    const kind = batch ? 'filtered' : 'opaque';
    const part = { id: spec.id + '/' + kind + '/' + String(kindCount[kind]++).padStart(4, '0'), kind,
      bounds: bounds(mesh.geometry),
      geometry: { attributes: Object.fromEntries(Object.entries(mesh.geometry.attributes).map(([name, a]) => [name, attribute(a)])), index: attribute(mesh.geometry.index) },
      material: { type: batch ? 'facade' : 'slopes', side: mesh.material.side },
    };
    if (batch) {
      part.material.options = jsonCopy(runtime.context.APARTMENTS.facadeFilter);
      part.textures = Object.fromEntries(['day', 'gold', 'night'].map(name => [name, textureDescriptor(batch.textures[name])]));
      part.faces = batch.faces.map(face => ({ len: face.len, z0: face.z0, z1: face.z1 }));
    }
    for (let k = 0; k < 3; k++) { box.min[k] = Math.min(box.min[k], part.bounds.min[k]); box.max[k] = Math.max(box.max[k], part.bounds.max[k]); }
    parts.push(part);
  });
  if (result.maplibre) {
    if (!result.bounds) throw new Error('MapLibre result requires bounds for all features');
    for (let k = 0; k < 3; k++) { box.min[k] = Math.min(box.min[k], result.bounds.min[k]); box.max[k] = Math.max(box.max[k], result.bounds.max[k]); }
  }
  const center = box.min.map((v, k) => (v + box.max[k]) / 2);
  const radius = Math.hypot(...box.max.map((v, k) => v - center[k]));
  const geometryBytes = parts.reduce((n, p) => n + p.geometry.index.array.byteLength + Object.values(p.geometry.attributes).reduce((m, a) => m + a.array.byteLength, 0), 0);
  const textureBytes = parts.reduce((n, p) => n + Object.values(p.textures || {}).reduce((m, t) => m + t.array.byteLength, 0), 0);
  const triangles = parts.reduce((n, p) => n + p.geometry.index.array.length / 3, 0);
  return { schemaVersion: BUILDING_ASSET_SCHEMA,
    building: { id: spec.id, name: spec.name, bounds: box, sphere: { center, radius } },
    origin: { lng: runtime.context.SLOPES.origin[0], lat: runtime.context.SLOPES.origin[1], units: 'metres', axes: 'east,north,up' },
    metadata: { ...jsonCopy(result.metadata), ...authoredMetadata(spec) },
    source: sourceMetadata(record, sourceHash), compiler,
    stats: { triangles, opaqueTriangles: result.triangles, geometryBytes, textureBytes,
      ...(result.maplibre ? { maplibreFeatureCount: result.maplibre.featureCollection.features.length,
        maplibreBytes: Buffer.byteLength(canonicalJSON(result.maplibre.featureCollection)), maplibreGpuBytes: null } : {}),
      filteredResolutionLevel: result.counts.filterResolutionLevel, parts: parts.length },
    ...(result.maplibre ? { maplibre: jsonCopy(result.maplibre) } : {}),
    parts,
  };
}

async function readManifest(outDir) {
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(outDir, 'manifest.json'), 'utf8'));
    if (manifest.schemaVersion !== BUILDING_ASSET_SCHEMA || !Array.isArray(manifest.buildings)) throw new Error('Existing compiled manifest has an unsupported schema');
    return manifest;
  } catch (error) { if (error.code === 'ENOENT') return { schemaVersion: BUILDING_ASSET_SCHEMA, buildings: [] }; throw error; }
}
function assetFile(entry) {
  if (typeof entry.file !== 'string' || !/^[a-zA-Z0-9_-]+\.[a-f0-9]{64}\.fba$/.test(entry.file)) throw new Error('Unsafe compiled asset path');
  return entry.file;
}
async function validCachedAsset(outDir, entry) {
  try {
    const bytes = await fs.readFile(path.join(outDir, assetFile(entry)));
    if (sha256(bytes) !== entry.hash) return false;
    const decoded = decodeBuildingAsset(bytes, { expectedId: entry.id });
    return decoded.source.hash === entry.sourceHash && decoded.compiler.hash === entry.compilerHash;
  } catch { return false; }
}

/** Stage and validate every selected asset before replacing the manifest once.
 * Existing files are immutable/content-addressed. Interruption before the final
 * rename may leave an unreferenced file, but never invalidates the old catalog.
 */
export async function compileBuildings({ rootDir = DEFAULT_ROOT, outDir = path.join(rootDir, 'data/compiled-buildings'), keys = ['welch'],
  options = DEFAULT_OPTIONS, records, runtime, identity } = {}) {
  options = { ...DEFAULT_OPTIONS, ...options };
  const selected = records || await loadSelectedSpecs(rootDir, keys);
  if (!selected.length || new Set(selected.map(r => r.spec.id)).size !== selected.length) throw new Error('Select unique building IDs');
  const compilers = new Map();
  const old = await readManifest(outDir);
  const entries = new Map(old.buildings.map(entry => [entry.id, entry]));
  const pending = [], report = { compiled: [], unchanged: [], manifestChanged: false };
  let adapter = runtime;
  // No output writes, including temporary files, occur until all builds succeed.
  for (const record of selected) {
    const renderer = record.spec.renderer || 'apartments';
    if (!compilers.has(renderer)) compilers.set(renderer, identity || await compilerIdentity(rootDir, options, renderer));
    const compiler = compilers.get(renderer);
    const sourceHash = sha256(canonicalJSON(record.spec));
    const previous = entries.get(record.spec.id);
    if (previous?.sourceHash === sourceHash && previous.compilerHash === compiler.hash && await validCachedAsset(outDir, previous)) {
      report.unchanged.push(record.spec.id); continue;
    }
    adapter ||= await createCompilerRuntime(rootDir);
    let result;
    try {
      result = await adapter.compile(record.spec, options);
      const asset = serializeCompiledBuilding(record, result, adapter, compiler);
      const bytes = encodeBuildingAsset(asset), hash = sha256(bytes);
      decodeBuildingAsset(bytes, { expectedId: record.spec.id });
      const entry = { id: record.spec.id, name: record.spec.name, key: record.key,
        file: record.spec.id + '.' + hash + '.fba', hash, bytes: bytes.byteLength,
        sourceHash, compilerHash: compiler.hash, bounds: asset.building.bounds, sphere: asset.building.sphere,
        origin: asset.origin, stats: asset.stats, metadata: asset.metadata };
      entries.set(entry.id, entry); pending.push({ entry, bytes });
      report.compiled.push({ id: entry.id, name: entry.name, bytes: entry.bytes, ...asset.stats,
        generationMs: result.counts.generationMs, finalizationMs: result.counts.finalizationMs, warnings: result.warnings || [] });
    } finally { if (result) adapter.dispose(result); }
  }
  const manifest = { schemaVersion: BUILDING_ASSET_SCHEMA, compilerVersion: COMPILER_VERSION,
    origin: entries.size ? [...entries.values()][0].origin : null,
    buildings: [...entries.values()].sort((a, b) => a.id.localeCompare(b.id, 'en')) };
  const manifestText = canonicalJSON(manifest) + '\n';
  let previousText;
  try { previousText = await fs.readFile(path.join(outDir, 'manifest.json'), 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (manifestText === previousText && !pending.length) return report;
  await fs.mkdir(outDir, { recursive: true });
  const stage = path.join(outDir, '.stage-' + randomUUID());
  await fs.mkdir(stage);
  try {
    for (const { entry, bytes } of pending) await fs.writeFile(path.join(stage, assetFile(entry)), bytes);
    for (const { entry } of pending) {
      const staged = await fs.readFile(path.join(stage, assetFile(entry)));
      if (sha256(staged) !== entry.hash) throw new Error('Staged asset hash mismatch');
      decodeBuildingAsset(staged, { expectedId: entry.id });
    }
    await fs.writeFile(path.join(stage, 'manifest.json'), manifestText);
    for (const { entry } of pending) {
      const target = path.join(outDir, assetFile(entry));
      try {
        const existing = await fs.readFile(target);
        if (sha256(existing) === entry.hash) { await fs.unlink(path.join(stage, assetFile(entry))); continue; }
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await fs.rename(path.join(stage, assetFile(entry)), target);
    }
    await fs.rename(path.join(stage, 'manifest.json'), path.join(outDir, 'manifest.json'));
    report.manifestChanged = true;
    return report;
  } finally {
    // The stage path is a fresh child of the explicitly selected output directory.
    const resolved = path.resolve(stage), parent = path.resolve(outDir) + path.sep;
    if (!resolved.startsWith(parent) || !path.basename(resolved).startsWith('.stage-')) throw new Error('Unsafe compiler stage cleanup');
    await fs.rm(resolved, { recursive: true, force: true });
  }
}
