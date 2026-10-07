/**
 * area-attach-meter.mjs - what an on-demand area costs the frames when it
 * arrives while you fly (js/slopes-apartments.js APARTMENTS.areas).
 *
 * A probe on 2026-09-27 saw one ~1.5 s frame as Riverside attached mid-flight.
 * This flies the real index.html from 2.3 km west of Riverside into it at
 * flyover height (one jumpTo per frame, driven from the page's own rAF so the
 * path is identical on every arm), then keeps the camera turning slowly over
 * the area until it has attached and ATTACH_TAIL_MS has passed. Every frame
 * interval is recorded, and so is every piece of work the attach can do:
 * slopes.add, MapLibre setFilter / setLayoutProperty, the tiled-roof rebuild,
 * each render (MapLibre's and the three.js layer's share of it), GL uploads
 * (bufferData / bufferSubData / texImage2D / texSubImage2D), shader links and
 * facade atlas uploads, so the worst frame can be attributed.
 *
 *   node area-attach-meter.mjs --arms main=http://127.0.0.1:8977|areaslice=0,branch=http://127.0.0.1:8977
 *        [--reps 3] [--gpu high|low] [--vsync off] [--profile] [--shots DIR] [--out DIR]
 *        [--shots-rep 0] [--cycles 2] [--cycles-rep 0] [--geometry-rep 0]
 *        [--phone] [--stop-after-flight] [--skip-geometry] [--expected-core 196] [--expected-area 353]
 *
 * Arms run INTERLEAVED (A,B,A,B,A,B), a fresh browser and
 * a fresh load each. Headless, 1280x680 CSS px at DPR 1.5 by default. With
 * --shots, after the attach it photographs two fixed cameras over the area
 * at day and night (two JPEG screenshots, first discarded in memory) as
 * <arm>-<rep>-<cam>-<hour>.jpg. Capture-only exposure/twinkle pins are applied
 * after timing. Phone mode is desktop Chromium emulation, not a physical phone.
 *
 * It is a measurement and exits 0 (2 if it cannot run); the verdict is the
 * reader's. Every number is printed with the renderer, the viewport, the DPR
 * and the CPU throttle (none).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('./package.json', import.meta.url))('playwright-core');
import { launch } from './chrome.mjs';

const A = process.argv.slice(2);
const arg = (k, d) => { const i = A.indexOf('--' + k); return i >= 0 ? (A[i + 1] && !A[i + 1].startsWith('--') ? A[i + 1] : true) : d; };
const ARMS = String(arg('arms', 'this=' + (process.env.VERIFY_URL || 'http://127.0.0.1:8099'))).split(',').map(s => { const i = s.indexOf('='), [url, q] = s.slice(i + 1).split('|'); return { name: s.slice(0, i), url, q: q || '' }; });
const REPS = Number(arg('reps', 3));
const GPU = String(arg('gpu', 'high'));
const PHONE = !!arg('phone', false);
const W = Number(arg('w', PHONE ? 390 : 1280)), H = Number(arg('h', PHONE ? 844 : 680)), DPR = Number(arg('dpr', PHONE ? 3 : 1.5));
const VSYNC = String(arg('vsync', 'off'));
const PROFILE = !!arg('profile', false);
const STOP_AFTER_FLIGHT = !!arg('stop-after-flight', false);
const SKIP_GEOMETRY = !!arg('skip-geometry', false);
const SHOTS = arg('shots', null);
const SHOTS_REP = Number(arg('shots-rep', 0));
const CYCLES = Number(arg('cycles', 0) === true ? 2 : arg('cycles', 0));
const CYCLES_REP = Number(arg('cycles-rep', 0));
const GEOMETRY_REP = Number(arg('geometry-rep', 0));
const OUT = String(arg('out', path.join(process.env.TEMP || '.', 'area-attach', 'runs')));
const CACHE = String(arg('cache', path.join(process.env.TEMP || '.', 'area-attach', 'http-cache')));
fs.mkdirSync(OUT, { recursive: true });
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

// The flight: west of Riverside's box (data/apartments/index.json) to its middle.
const FLY = {
  from: [-97.7560, 30.2390], to: [-97.7205, 30.2388],
  zoom: 16.5, pitch: 74, bearing: 90,
  seconds: 15,          // 2.4 km in 15 s: a brisk flyover
  orbitDegS: 12,        // then a slow turn over the area while it builds
};
const ATTACH_TAIL_MS = 4000;   // keep flying this long after the attach
const MAX_WAIT_MS = 90000;    // an area that never attaches ends the run
const EXPECTED_CORE_BUILDINGS = Number(arg('expected-core', 196));
const READINESS_TIMEOUT_MS = 160000;
const READINESS_POLL_MS = 500;
const PAGE_OPERATION_TIMEOUT_MS = 60000;
const FINAL_DIAGNOSTIC_TIMEOUT_MS = 10000;
const DIAGNOSTIC_LIMIT = 250;
const BROWSER_MAX_MS = 300000;
const RUN_WORK_MAX_MS = 280000;
const NAVIGATION_TIMEOUT_MS = 60000;
const RENDERER_TIMEOUT_MS = 20000;
const POSE_SETTLE_MS = 3000;
const POSE_TILE_WAIT_MS = 30000;
const SHOT_REPAINT_MS = 600;
const SHOT_PAIR_MS = 1000;
const SHOT_JPEG_QUALITY = 88;
const SHOT_EXPOSURE = 1;
const SHOT_TWINKLE_AMP = 0;
const SHOT_GRAIN = 0;
const SHOT_LABELS = false;
const SHOT_DAY = 0;
const SHOT_NIGHT = 1;
const SHOT_HIDDEN_LABELS = ['buildings-labels-major', 'buildings-labels-mid', 'buildings-labels', 'name-labels'];
const GEOMETRY_CHUNK_BYTES = 65536;
const FREED_ATTRIBUTE_COMPONENT_BYTES = 4;
const CYCLE_WAIT_MS = 45000;
const CYCLE_COLLECT_SETTLE_MS = 1000;
const CYCLE_AWAY = { center: [-97.8100, 30.2000], zoom: FLY.zoom, pitch: FLY.pitch, bearing: FLY.bearing };
const TARGET_AREA = 'riverside';
const EXPECTED_AREA_BUILDINGS = Number(arg('expected-area', 353));
const SNAPSHOT_POSE = { center: FLY.to, zoom: FLY.zoom, pitch: FLY.pitch, bearing: FLY.bearing };
const CAMS = {
  village: { center: [-97.7128, 30.2374], zoom: 17.2, pitch: 60, bearing: 20 },
  element: { center: [-97.7305, 30.2402], zoom: 17.0, pitch: 68, bearing: 300 },
};

for (const [name, value] of Object.entries({ reps: REPS, w: W, h: H, 'expected-core': EXPECTED_CORE_BUILDINGS, 'expected-area': EXPECTED_AREA_BUILDINGS })) {
  if (!Number.isInteger(value) || value <= 0) throw new Error('--' + name + ' must be a positive integer');
}
for (const [name, value] of Object.entries({ 'shots-rep': SHOTS_REP, 'cycles-rep': CYCLES_REP, 'geometry-rep': GEOMETRY_REP })) {
  if (!Number.isInteger(value) || value < 0 || value >= REPS) throw new Error('--' + name + ' must select a zero-based rep below --reps');
}
if (![0, 1, 2].includes(CYCLES)) throw new Error('--cycles accepts 0, 1 or 2');
if (!Number.isFinite(DPR) || DPR <= 0) throw new Error('--dpr must be positive');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const r1 = v => v == null || !isFinite(v) ? null : Math.round(v * 10) / 10;
const pct = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

function readinessSnapshot({ detailed = true } = {}) {
  const apartments = window.slopesApartments;
  const map = window.__map;
  const read = operation => { try { return operation(); } catch (error) { return { error: error.message }; } };
  const count = apartments ? apartments.count : null;
  const hidden = apartments?.group ? read(() => apartments.hidden) : { missing: [], rigsMissing: [] };
  const collectionKeys = collection => collection instanceof Map ? [...collection.keys()] : Object.keys(collection || {});
  const layerCollection = map?.style?._layers || map?.style?.layers;
  const layers = layerCollection instanceof Map ? [...layerCollection.values()] : Object.values(layerCollection || {});
  const sourceIds = detailed && map ? [...new Set([
    ...collectionKeys(map.style?.sourceCaches), ...collectionKeys(map.style?._sourceCaches),
    ...collectionKeys(map.style?._otherSourceCaches), ...layers.map(layer => layer.source).filter(Boolean),
    ...(hidden?.plan || []).map(id => map.getLayer(id)?.source).filter(Boolean),
  ])] : [];
  const sources = sourceIds.map(sourceId => {
    const source = read(() => map.getSource(sourceId));
    return { id: sourceId, type: source?.type || null, loaded: read(() => map.isSourceLoaded(sourceId)), url: source?.url || null, tiles: source?.tiles || null };
  });
  return {
    veil: !!document.getElementById('veil'), done: !!count?.done,
    ready: apartments?.group ? read(() => apartments.readyToReveal()) : false,
    tiles: map ? read(() => map.areTilesLoaded()) : false,
    styleLoaded: map ? read(() => map.isStyleLoaded()) : false,
    group: !!apartments?.group,
    dataBuildings: apartments?.data?.buildings?.length || 0,
    builtBuildings: apartments?.built?.length || 0,
    count, hidden, sources, frames: window.slopes?.frames || 0,
    areas: apartments?.areas?.list || [],
    lite: window.LITE_PROFILE ? { on: window.LITE_PROFILE.on, tier: window.LITE_PROFILE.tier, sceneUnavailable: window.LITE_PROFILE.sceneUnavailable } : null,
  };
}

function coreReadiness(snapshot) {
  return !!snapshot && !snapshot.veil && snapshot.done && snapshot.group &&
    snapshot.dataBuildings >= EXPECTED_CORE_BUILDINGS && snapshot.builtBuildings >= EXPECTED_CORE_BUILDINGS &&
    snapshot.count?.buildings >= EXPECTED_CORE_BUILDINGS &&
    Array.isArray(snapshot.hidden?.missing) && !snapshot.hidden.missing.length &&
    Array.isArray(snapshot.hidden?.rigsMissing) && !snapshot.hidden.rigsMissing.length;
}

async function bounded(operation, timeoutMs, description) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error(description + ' timeout after ' + timeoutMs + ' ms')), timeoutMs); }),
    ]);
  } finally { clearTimeout(timer); }
}

function memorySnapshot() {
  const renderer = window.slopes?.renderer;
  const geometries = new Set();
  let meshes = 0;
  let liveArrayBytes = 0;
  const arrays = new Set();
  window.slopes?.root?.traverse(object => {
    if (object.isMesh) meshes++;
    if (!object.geometry || geometries.has(object.geometry)) return;
    geometries.add(object.geometry);
    for (const attribute of Object.values(object.geometry.attributes || {}).concat(object.geometry.index || [])) {
      const array = attribute.array || attribute.data?.array;
      if (array && !arrays.has(array)) { arrays.add(array); liveArrayBytes += array.byteLength; }
    }
  });
  return {
    renderer: renderer ? {
      memory: { ...renderer.info.memory }, render: { ...renderer.info.render },
      programs: renderer.info.programs?.length || 0,
    } : null,
    scene: { meshes, geometries: geometries.size, liveArrayBytes },
    jsHeapUsedBytes: performance.memory?.usedJSHeapSize ?? null,
    jsHeapTotalBytes: performance.memory?.totalJSHeapSize ?? null,
    area: window.slopesApartments?.areas.list.find(area => area.name === 'riverside') || null,
  };
}

function areaGeometrySnapshot() {
  const apartments = window.slopesApartments;
  const area = apartments?.areas?.list.find(entry => entry.name === 'riverside') || null;
  const groups = [];
  const buffers = new Map();
  window.slopes?.root?.traverse(object => { if (object.userData?.area?.name === 'riverside') groups.push(object); });
  const catalog = apartments?.data?.buildings || [];
  const builtIds = groups.flatMap(group => group.userData.area.built.map(building => building.id)).sort();
  const catalogIds = new Set(catalog.map(spec => spec.id));
  const records = [];
  let estimatedBytes = 0;
  let retainedBytes = 0;
  for (const group of groups) group.traverse(object => {
    const geometry = object.geometry;
    if (!geometry) return;
    const record = {
      mesh: object.name || '', type: object.type, visible: object.visible,
      matrix: object.matrix?.elements?.slice() || null,
      groups: (geometry.groups || []).map(entry => ({ ...entry })),
      drawRange: { start: geometry.drawRange.start, count: Number.isFinite(geometry.drawRange.count) ? geometry.drawRange.count : null },
      attributes: {}, index: null,
    };
    const describe = (attribute, attributeName) => {
      const array = attribute.array || attribute.data?.array || null;
      const bufferId = records.length + ':' + attributeName;
      const byteLength = array?.byteLength ?? null;
      const itemSize = attribute.itemSize;
      const count = attribute.count;
      const estimatedByteLength = byteLength ?? count * itemSize * window.__amFreedComponentBytes;
      estimatedBytes += estimatedByteLength;
      retainedBytes += byteLength || 0;
      if (array) buffers.set(bufferId, array);
      return { bufferId, itemSize, count, normalized: !!attribute.normalized, arrayType: array?.constructor.name || null, byteLength, estimatedByteLength, interleaved: !!attribute.isInterleavedBufferAttribute };
    };
    for (const attributeName of Object.keys(geometry.attributes || {}).sort()) record.attributes[attributeName] = describe(geometry.attributes[attributeName], attributeName);
    if (geometry.index) record.index = describe(geometry.index, 'index');
    records.push(record);
  });
  window.__amGeometryBuffers = buffers;
  return {
    area, groupCount: groups.length, builtIds, catalogBuildings: catalog.length,
    missingCatalogIds: builtIds.filter(buildingId => !catalogIds.has(buildingId)),
    duplicateBuiltIds: builtIds.filter((buildingId, index) => index > 0 && buildingId === builtIds[index - 1]),
    records, estimatedBytes, retainedBytes,
    areaSpecs: catalog.filter(spec => builtIds.includes(spec.id)),
  };
}

async function geometrySnapshot(evaluate) {
  await evaluate(componentBytes => { window.__amFreedComponentBytes = componentBytes; }, FREED_ATTRIBUTE_COMPONENT_BYTES);
  const snapshot = await evaluate(areaGeometrySnapshot);
  try {
    snapshot.memory = await evaluate(memorySnapshot);
    snapshot.catalogSha256 = createHash('sha256').update(JSON.stringify(snapshot.areaSpecs)).digest('hex');
    snapshot.areaSpecIds = snapshot.areaSpecs.map(spec => spec.id).sort();
    delete snapshot.areaSpecs;
    const aggregate = createHash('sha256');
    let hashedBytes = 0;
    let missingBuffers = 0;
    const browserDigests = await evaluate(async () => {
      if (!window.crypto?.subtle) return null;
      const digests = {};
      for (const [bufferId, array] of window.__amGeometryBuffers) {
        const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
        const hash = await window.crypto.subtle.digest('SHA-256', bytes);
        digests[bufferId] = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
      }
      return digests;
    });
    for (const record of snapshot.records) {
      const attributes = Object.entries(record.attributes);
      if (record.index) attributes.push(['index', record.index]);
      for (const [attributeName, attribute] of attributes) {
        if (attribute.byteLength == null) { missingBuffers++; continue; }
        const digest = createHash('sha256');
        const browserDigest = browserDigests?.[attribute.bufferId];
        if (browserDigests && !browserDigest) throw new Error('Geometry buffer became unavailable: ' + attribute.bufferId);
        for (let offset = 0; !browserDigest && offset < attribute.byteLength; offset += GEOMETRY_CHUNK_BYTES) {
          const bytes = await evaluate(({ bufferId, offset, chunkBytes }) => {
            const array = window.__amGeometryBuffers.get(bufferId);
            if (!array) throw new Error('Geometry buffer became unavailable: ' + bufferId);
            return Array.from(new Uint8Array(array.buffer, array.byteOffset + offset, Math.min(chunkBytes, array.byteLength - offset)));
          }, { bufferId: attribute.bufferId, offset, chunkBytes: GEOMETRY_CHUNK_BYTES });
          digest.update(Buffer.from(bytes));
          hashedBytes += bytes.length;
        }
        attribute.sha256 = browserDigest || digest.digest('hex');
        if (browserDigest) hashedBytes += attribute.byteLength;
        aggregate.update(JSON.stringify([attributeName, attribute.itemSize, attribute.count, attribute.normalized, attribute.arrayType, attribute.sha256]));
      }
      aggregate.update(JSON.stringify([record.matrix, record.groups, record.drawRange]));
    }
    snapshot.hash = {
      method: 'SHA-256 of retained mesh attribute/index bytes (browser WebCrypto or bounded Node fallback); includes mesh matrices and draw groups; partition-sensitive',
      sha256: missingBuffers ? null : aggregate.digest('hex'), hashedBytes, missingBuffers,
      complete: missingBuffers === 0 && snapshot.records.length > 0,
      fallback: missingBuffers ? 'CPU arrays already freed; renderer.info and attached/catalog counts only. Byte estimates assume Float32, not exact GPU allocation.' : null,
    };
    return snapshot;
  } finally { await evaluate(() => { delete window.__amGeometryBuffers; delete window.__amFreedComponentBytes; }); }
}

function areaCompleteness(snapshot) {
  const area = snapshot?.area;
  const checks = {
    on: area?.state === 'on', singleGroup: snapshot?.groupCount === 1,
    buildings: area?.buildings === EXPECTED_AREA_BUILDINGS,
    specs: area?.specs === EXPECTED_AREA_BUILDINGS,
    built: snapshot?.builtIds?.length === EXPECTED_AREA_BUILDINGS,
    triangles: (area?.triangles || 0) > 0,
    noMissingCatalogIds: snapshot?.missingCatalogIds?.length === 0,
    noDuplicateBuiltIds: snapshot?.duplicateBuiltIds?.length === 0,
    matchingSpecIds: JSON.stringify(snapshot?.areaSpecIds) === JSON.stringify(snapshot?.builtIds),
  };
  return { pass: Object.values(checks).every(Boolean), expectedAreaBuildings: EXPECTED_AREA_BUILDINGS, checks };
}

function frameIntervalsInWindow(frames, start, end) {
  return frames.filter(frame => frame[0] >= start && frame[0] - frame[1] <= end).map(frame => frame[1]);
}

async function settlePose(evaluate, pose) {
  await evaluate(camera => { window.__map.stop(); window.__map.jumpTo(camera); }, pose);
  const deadline = Date.now() + POSE_TILE_WAIT_MS;
  let tilesLoaded = false;
  while (Date.now() < deadline) {
    tilesLoaded = await evaluate(() => window.__map.areTilesLoaded() && !window.__map.isMoving());
    if (tilesLoaded) break;
    await sleep(READINESS_POLL_MS);
  }
  await sleep(POSE_SETTLE_MS);
  return tilesLoaded;
}

async function captureShots(page, evaluate, arm, rep, result) {
  result.shots = {};
  result.shotSettings = {
    cameras: CAMS, hours: { day: SHOT_DAY, night: SHOT_NIGHT },
    exposure: SHOT_EXPOSURE, gradeExposure: SHOT_EXPOSURE,
    autoExposure: false, twinkleAmp: SHOT_TWINKLE_AMP, grain: SHOT_GRAIN, nameLabels: SHOT_LABELS,
    jpegQuality: SHOT_JPEG_QUALITY, screenshotsPerPose: 2, retainedScreenshot: 2,
    poseSettleMs: POSE_SETTLE_MS, tileWaitMaxMs: POSE_TILE_WAIT_MS,
    hiddenLabels: SHOT_HIDDEN_LABELS,
    note: 'Capture-only pins applied after timing. JPEG diffs are lossy; counts/hashes and visual review remain required.',
  };
  for (const [cameraName, camera] of Object.entries(CAMS)) {
    for (const [hour, hourValue] of Object.entries(result.shotSettings.hours)) {
      await evaluate(settings => {
        if (!window.GFX || !window.SKY_TUNE?.TWINKLE || typeof window.setGrade !== 'function' || typeof window.applyTimeOfDay !== 'function') throw new Error('Required deterministic capture APIs are unavailable');
        window.GFX.autoExposure = false;
        window.GFX.exposure = settings.exposure;
        window.GFX.grain = settings.grain;
        window.SKY_TUNE.TWINKLE.AMP = settings.twinkleAmp;
        if (window.NAME_LABELS) { window.NAME_LABELS.on = settings.nameLabels; window.nameLabels?.sync(); }
        window.applyGraphics?.();
        window.__aeReset?.();
        window.applyTimeOfDay(window.__map, settings.hourValue, true);
        window.setGrade({ exposure: settings.exposure });
        for (const layerId of settings.hiddenLabels) if (window.__map.getLayer(layerId)) window.__map.setLayoutProperty(layerId, 'visibility', 'none');
      }, { exposure: SHOT_EXPOSURE, grain: SHOT_GRAIN, twinkleAmp: SHOT_TWINKLE_AMP, nameLabels: SHOT_LABELS, hiddenLabels: SHOT_HIDDEN_LABELS, hourValue });
      const tilesLoaded = await settlePose(evaluate, camera);
      await evaluate(() => window.__map.triggerRepaint());
      await sleep(SHOT_REPAINT_MS);
      await bounded(() => page.screenshot({ type: 'jpeg', quality: SHOT_JPEG_QUALITY, timeout: PAGE_OPERATION_TIMEOUT_MS }), PAGE_OPERATION_TIMEOUT_MS, 'Discard screenshot');
      await sleep(SHOT_PAIR_MS);
      const file = path.join(SHOTS, arm.name + '-' + rep + '-' + cameraName + '-' + hour + '.jpg');
      await bounded(() => page.screenshot({ path: file, type: 'jpeg', quality: SHOT_JPEG_QUALITY, timeout: PAGE_OPERATION_TIMEOUT_MS }), PAGE_OPERATION_TIMEOUT_MS, 'Kept screenshot');
      const readiness = await evaluate(readinessSnapshot);
      const pins = await evaluate(() => ({ autoExposure: window.GFX.autoExposure, exposure: window.GFX.exposure, twinkleAmp: window.SKY_TUNE.TWINKLE.AMP, gain: window.__ae?.().gain ?? null, postprocessFilter: document.getElementById('map')?.style.filter || '', timeOfDay: window.__todCurrentP }));
      const visualReady = readiness.ready === true && readiness.tiles === true && readiness.hidden?.missing?.length === 0 && readiness.hidden?.rigsMissing?.length === 0;
      result.shots[cameraName + '-' + hour] = { file, camera, hourValue, tilesLoaded, readiness, pins, visualReady };
      if (!visualReady) result.captureIncomplete = true;
    }
  }
}

async function runCycles(evaluate, cdp, result) {
  result.cycles = [];
  result.cycleSettings = { count: CYCLES, selectedRep: CYCLES_REP, collection: 'CDP HeapProfiler.collectGarbage after settled poses', away: CYCLE_AWAY, maxTransitionMs: CYCLE_WAIT_MS, forcedUnload: !PHONE, physicalPhone: false };
  const collect = async () => {
    await bounded(() => cdp.send('HeapProfiler.collectGarbage'), PAGE_OPERATION_TIMEOUT_MS, 'Forced collection');
    await sleep(CYCLE_COLLECT_SETTLE_MS);
    const memory = await evaluate(memorySnapshot);
    const metrics = await bounded(() => cdp.send('Performance.getMetrics'), PAGE_OPERATION_TIMEOUT_MS, 'Heap metrics');
    memory.cdp = Object.fromEntries(metrics.metrics.filter(metric => ['JSHeapUsedSize', 'JSHeapTotalSize', 'Documents', 'Nodes'].includes(metric.name)).map(metric => [metric.name, metric.value]));
    return memory;
  };
  await bounded(() => cdp.send('Performance.enable'), PAGE_OPERATION_TIMEOUT_MS, 'Enable heap metrics');
  result.cycleBaseline = await collect();
  for (let cycle = 0; cycle < CYCLES; cycle++) {
    const record = { cycle };
    result.cycles.push(record);
    await evaluate(camera => { window.__map.stop(); window.__map.jumpTo(camera); window.slopesApartments.areas.check(); }, CYCLE_AWAY);
    if (!PHONE) await evaluate(areaName => window.slopesApartments.areas.unload(areaName), TARGET_AREA);
    const unloadDeadline = Date.now() + CYCLE_WAIT_MS;
    let unloaded;
    while (Date.now() < unloadDeadline) {
      unloaded = await evaluate(() => window.slopesApartments.areas.list.find(area => area.name === 'riverside'));
      if (unloaded?.state === 'idle' && unloaded.buildings === 0 && unloaded.triangles === 0) break;
      await sleep(READINESS_POLL_MS);
    }
    record.unloadedArea = unloaded;
    record.unloadComplete = unloaded?.state === 'idle' && unloaded.buildings === 0 && unloaded.triangles === 0;
    if (!record.unloadComplete) throw new Error('Area did not unload completely in cycle ' + cycle);
    await settlePose(evaluate, CYCLE_AWAY);
    record.unloadedMemory = await collect();
    record.unloadedReadiness = await evaluate(readinessSnapshot);
    record.unloadedGeometry = await evaluate(areaGeometrySnapshot);
    await evaluate(() => { delete window.__amGeometryBuffers; });
    record.unloadComplete = record.unloadComplete && record.unloadedGeometry.groupCount === 0;
    record.unloadedGeometry = { groupCount: record.unloadedGeometry.groupCount, catalogBuildings: record.unloadedGeometry.catalogBuildings };
    await evaluate(camera => { window.__map.jumpTo(camera); window.slopesApartments.areas.check(); }, { center: FLY.to, zoom: FLY.zoom, pitch: FLY.pitch, bearing: FLY.bearing });
    const reloadDeadline = Date.now() + CYCLE_WAIT_MS;
    let reloaded;
    while (Date.now() < reloadDeadline) {
      reloaded = await evaluate(() => window.slopesApartments.areas.list.find(area => area.name === 'riverside'));
      if (reloaded?.state === 'on' || reloaded?.state === 'failed') break;
      await sleep(READINESS_POLL_MS);
    }
    record.reloadedArea = reloaded;
    if (reloaded?.state !== 'on') throw new Error('Area did not reload in cycle ' + cycle);
    await settlePose(evaluate, { center: FLY.to, zoom: FLY.zoom, pitch: FLY.pitch, bearing: FLY.bearing });
    record.reloadedMemory = await collect();
    record.reloadedReadiness = await evaluate(readinessSnapshot);
    record.geometry = await geometrySnapshot(evaluate);
    record.completeness = areaCompleteness(record.geometry);
    record.matchesInitialHash = result.geometry?.hash?.complete && record.geometry.hash.complete ? result.geometry.hash.sha256 === record.geometry.hash.sha256 : null;
    record.geometryDelta = record.reloadedMemory.renderer && result.cycleBaseline.renderer ? record.reloadedMemory.renderer.memory.geometries - result.cycleBaseline.renderer.memory.geometries : null;
    record.textureDelta = record.reloadedMemory.renderer && result.cycleBaseline.renderer ? record.reloadedMemory.renderer.memory.textures - result.cycleBaseline.renderer.memory.textures : null;
    record.heapDeltaBytes = record.reloadedMemory.cdp.JSHeapUsedSize - result.cycleBaseline.cdp.JSHeapUsedSize;
    record.masksComplete = record.unloadedReadiness.hidden?.missing?.length === 0 && record.unloadedReadiness.hidden?.rigsMissing?.length === 0 && record.reloadedReadiness.hidden?.missing?.length === 0 && record.reloadedReadiness.hidden?.rigsMissing?.length === 0;
    record.pass = record.unloadComplete && record.completeness.pass && record.masksComplete && record.matchesInitialHash !== false && record.geometryDelta === 0 && record.textureDelta === 0;
  }
  result.cyclesComplete = result.cycles.length === CYCLES && result.cycles.every(record => record.pass);
  result.cycleLeakVerdict = 'Counts and post-GC heap deltas are diagnostic; total process/GPU memory and physical-device leak freedom are not proven';
}

// ---------- in-page instrumentation (before any app script) ----------
function pageInit() {
  if (window.__am) return;
  const cancelProbe = setInterval(() => window.cancelGraphicsAutoDetect?.(), 50);
  setTimeout(() => clearInterval(cancelProbe), 30000);
  const AM = window.__am = { raf: [], lt: [], spans: [], logs: [], states: [], mapErrors: [], areaAttachStarts: [] };
  const now = () => performance.now();
  const span = (name, t0) => AM.spans.push([name, t0, now() - t0]);
  const hookMapErrors = () => {
    const map = window.__map;
    if (!map) return setTimeout(hookMapErrors, 25);
    map.on('error', event => AM.mapErrors.push({ at: now(), message: event.error?.message || String(event.error || event), sourceId: event.sourceId || null, tile: event.tile?.tileID?.key || null }));
  };
  hookMapErrors();
  let lastState = null;
  const loop = ts => {
    AM.raf.push(ts);
    try {
      const l = window.slopesApartments && window.slopesApartments.areas.list;
      const s = l ? l.map(a => a.name + ':' + a.state).join(',') : null;
      if (s !== lastState) { AM.states.push([now(), s]); lastState = s; }
    } catch (e) {}
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) AM.lt.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true }); } catch (e) {}
  const log = console.log;
  console.log = function (...a) { try { const s = String(a[0] || ''); if (s.startsWith('[slopes-apartments] area')) AM.logs.push([now(), a.map(String).join(' ')]); } catch (e) {} return log.apply(this, a); };
  const wrap = (obj, key, name) => {
    const o = obj && obj[key]; if (typeof o !== 'function' || o.__am) return;
    const f = function () {
      const t = now();
      if (name === 'slopes.add' && arguments[0]?.name === 'slopes-apartments-riverside') AM.areaAttachStarts.push(t);
      try { return o.apply(this, arguments); } finally { span(name, t); }
    };
    f.__am = true; obj[key] = f;
  };
  const hook = () => {
    const m = window.__map;
    if (!m || !m.painter || !m.painter.context || !window.slopes || !window.slopes.add) return setTimeout(hook, 50);
    const gl = m.painter.context.gl;
    for (const k of ['bufferData', 'bufferSubData', 'texImage2D', 'texSubImage2D', 'texStorage2D', 'linkProgram', 'compileShader', 'texImage3D', 'texSubImage3D']) {
      const o = gl[k]; if (typeof o !== 'function') continue;
      gl[k] = function () { const t = now(); try { return o.apply(this, arguments); } finally { AM.spans.push(['gl.' + k, t, now() - t]); } };
    }
    wrap(m, '_render', 'render');
    wrap(m, 'setFilter', 'setFilter');
    wrap(m, 'setLayoutProperty', 'setLayoutProperty');
    wrap(window.slopes, 'add', 'slopes.add');
    const roofs = () => { if (window.slopesRoofs) wrap(window.slopesRoofs, 'rebuild', 'roofs.rebuild'); else setTimeout(roofs, 200); };
    roofs();
    const wrapCustom = () => {
      try {
        const L = m.style && m.style._layers; if (!L) return;
        for (const id in L) {
          const impl = L[id] && L[id].implementation;
          if (!impl || impl.__am || typeof impl.render !== 'function') continue;
          const o = impl.render; impl.__am = true;
          impl.render = function () { const t = now(); try { return o.apply(this, arguments); } finally { span('custom:' + id, t); } };
        }
      } catch (e) {}
    };
    setInterval(wrapCustom, 500); wrapCustom();
    AM.hooked = now();
  };
  AM.hook = hook;
  // The flight, from the page's own frames: one jumpTo per rAF.
  window.__amFly = (F) => new Promise(done => {
    const m = window.__map, t0 = now(), deg = Math.PI / 180;
    AM.flyT0 = t0; AM.attachT = null;
    const step = () => {
      const t = (now() - t0) / 1000;
      if (t <= F.seconds) {
        const k = t / F.seconds;
        m.jumpTo({ center: [F.from[0] + (F.to[0] - F.from[0]) * k, F.from[1] + (F.to[1] - F.from[1]) * k], zoom: F.zoom, pitch: F.pitch, bearing: F.bearing });
      } else {
        m.jumpTo({ center: F.to, zoom: F.zoom, pitch: F.pitch, bearing: F.bearing + F.orbitDegS * (t - F.seconds) });
      }
      const on = AM.logs.find(l => l[0] >= t0 && / building\(s\)/.test(l[1]));
      if (on && AM.attachT == null) AM.attachT = on[0];
      if ((AM.attachT != null && now() - AM.attachT > F.tailMs) || now() - t0 > F.maxMs) { AM.flyT1 = now(); return done(AM.attachT); }
      requestAnimationFrame(step);
    };
    void deg;
    requestAnimationFrame(step);
  });
  // A marker the CPU profile can find, to map profile time onto performance.now().
  window.__areaMeterMark = function __areaMeterMark() { const t = now(); while (now() - t < 4) {} return t; };
}

function summarizeProfile(p, off, a, b) {
  // off: add to profile microseconds / 1000 to get performance.now(); keep samples in [a, b]
  const byId = new Map(p.nodes.map(n => [n.id, n]));
  const parent = new Map(); for (const n of p.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const nm = n => { const cf = n.callFrame; const f = (cf.url || '').split('/').pop().split('?')[0]; return `${cf.functionName || '(anon)'} ${f}:${cf.lineNumber + 1}`; };
  const self = {}, incl = {};
  let t = p.startTime, total = 0;
  for (let i = 0; i < p.samples.length; i++) {
    t += p.timeDeltas[i];
    const dt = (i + 1 < p.timeDeltas.length ? p.timeDeltas[i + 1] : 0) / 1000;
    const ms = t / 1000 + off;
    if (ms < a || ms > b) continue;
    total += dt;
    let n = byId.get(p.samples[i]);
    self[nm(n)] = (self[nm(n)] || 0) + dt;
    const seen = new Set();
    while (n) { const k = nm(n); if (/\/js\/[\w.-]+\.js|three|maplibre/.test(n.callFrame.url || '') && !seen.has(k)) { seen.add(k); incl[k] = (incl[k] || 0) + dt; } const pid = parent.get(n.id); n = pid != null ? byId.get(pid) : null; }
  }
  const top = (o, k = 18) => Object.entries(o).sort((x, y) => y[1] - x[1]).slice(0, k).map(([k2, v]) => [k2, Math.round(v)]);
  return { windowMs: Math.round(b - a), sampledMs: Math.round(total), self: top(self), inclusive: top(incl, 30) };
}

function findMarkOffset(p, markT) {
  const byId = new Map(p.nodes.map(n => [n.id, n]));
  let t = p.startTime;
  for (let i = 0; i < p.samples.length; i++) {
    t += p.timeDeltas[i];
    const n = byId.get(p.samples[i]);
    if (n && n.callFrame.functionName === '__areaMeterMark') return markT - t / 1000;
  }
  return null;
}

async function runArm(arm, rep) {
  const gpuFlag = GPU === 'low' ? '--force_low_power_gpu' : '--force_high_performance_gpu';
  const args = ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', gpuFlag,
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
    '--disable-features=CalculateNativeWinOcclusion', `--disk-cache-dir=${CACHE}`,
    `--window-size=${W + 16},${H + 140}`, '--window-position=0,0'];
  if (VSYNC === 'off') args.push('--disable-gpu-vsync', '--disable-frame-rate-limit');
  const browser = await launch(chromium, { headless: true, gl: 'hardware', args, maxMs: BROWSER_MAX_MS });
  const workDeadline = Date.now() + RUN_WORK_MAX_MS;
  const errors = [];
  const warnings = [];
  const requestFailures = [];
  const httpErrors = [];
  const res = { arm: arm.name, url: arm.url, q: arm.q, rep, gpuFlag, vsync: VSYNC, viewport: [W, H], dpr: DPR, cpuThrottle: 1, expectedCoreBuildings: EXPECTED_CORE_BUILDINGS, expectedAreaBuildings: EXPECTED_AREA_BUILDINGS,
    device: PHONE ? 'Desktop Chromium phone emulation, NOT a physical phone or iOS Safari' : 'Desktop',
    method: { browserMaxMs: BROWSER_MAX_MS, workMaxMs: RUN_WORK_MAX_MS, readinessMaxMs: READINESS_TIMEOUT_MS, flightMaxMs: MAX_WAIT_MS, graphicsAutoDetect: 'cancelled; application graphics and exposure defaults retained during timing', repetitions: REPS, order: 'A,B,A,B,A,B interleaved', cpuProfileSamplingUs: PROFILE ? 250 : null, shotsRep: SHOTS_REP, cyclesRep: CYCLES_REP, geometryRep: GEOMETRY_REP, stopAfterFlight: STOP_AFTER_FLIGHT },
    candidateSourceSha256: createHash('sha256').update(fs.readFileSync(new URL('../../js/slopes-apartments.js', import.meta.url))).digest('hex') };
  let page;
  try {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR, ...(PHONE ? { isMobile: true, hasTouch: true } : {}) });
  page = await ctx.newPage();
  page.setDefaultTimeout(PAGE_OPERATION_TIMEOUT_MS);
  page.on('pageerror', e => errors.push(e.message.slice(0, 200)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); else if (message.type() === 'warning') warnings.push(message.text()); });
  page.on('requestfailed', request => requestFailures.push({ url: request.url(), type: request.resourceType(), error: request.failure()?.errorText || null }));
  page.on('response', response => { if (response.status() >= 400) httpErrors.push({ url: response.url(), status: response.status() }); });
  await page.addInitScript(pageInit);
  const cdp = await ctx.newCDPSession(page);
  const ev = (fn, value, timeoutMs = PAGE_OPERATION_TIMEOUT_MS) => bounded(() => page.evaluate(fn, value), Math.max(1, Math.min(timeoutMs, workDeadline - Date.now())), 'Page evaluation');
  const url = `${arm.url}/index.html?drift=0&clip=1${arm.q ? '&' + arm.q : ''}`;
  const tNav = Date.now();
  await bounded(() => page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS }), NAVIGATION_TIMEOUT_MS, 'Navigation');
  await page.bringToFront();
  const rendererDeadline = Date.now() + RENDERER_TIMEOUT_MS;
  while (Date.now() < rendererDeadline) {
    const r = await ev(() => { try { const m = window.__map; if (!m || !m.painter) return null; const gl = m.painter.context.gl; const d = gl.getExtension('WEBGL_debug_renderer_info');
      return { renderer: gl.getParameter(d.UNMASKED_RENDERER_WEBGL), canvas: [gl.canvas.width, gl.canvas.height], dpr: devicePixelRatio, css: [innerWidth, innerHeight] }; } catch (e) { return null; } }).catch(() => null);
    if (r) { res.renderer = r; break; }
    await sleep(200);
  }
  if (!res.renderer) throw new Error('WebGL renderer readiness timeout');
  await ev(() => { try { window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect(); } catch (e) {} });
  console.log(`[area ${arm.name}#${rep}] ${res.renderer && res.renderer.renderer} canvas ${res.renderer && res.renderer.canvas} css ${res.renderer && res.renderer.css} dpr ${res.renderer && res.renderer.dpr}`);
  if (GPU === 'low' && /NVIDIA/i.test((res.renderer && res.renderer.renderer) || '')) {
    throw new Error('--gpu low drew on NVIDIA: point CHROME_PATH at a browser with no Windows GPU preference (Edge)');
  }
  const t0 = Date.now();
  for (;;) {
    const snapshot = await ev(readinessSnapshot, { detailed: false });
    res.readiness = snapshot;
    if (coreReadiness(snapshot)) {
      res.coreReady = true;
      if (snapshot.ready !== true || snapshot.tiles !== true) warnings.push('Core geometry is complete; source/tile readiness is incomplete. Timing may proceed, visual acceptance is NOT established. See readiness.sources and map/request errors.');
      break;
    }
    if (Date.now() - t0 > READINESS_TIMEOUT_MS) throw new Error('Core readiness timeout: ' + JSON.stringify(snapshot));
    await sleep(READINESS_POLL_MS);
  }
  res.loadMs = Date.now() - tNav;
  await ev(() => { try { window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect(); } catch (e) {} });
  res.gfx = await ev(() => window.GFX ? { ...window.GFX, timeOfDay: window.__todCurrentP } : null);
  if (PHONE && !(await ev(() => window.LITE_PROFILE?.on && !window.LITE_PROFILE.sceneUnavailable))) throw new Error('Phone emulation did not activate a live authored phone profile');
  res.areasBefore = await ev(() => window.slopesApartments.areas.list);
  await ev(() => window.__am.hook());
  if (res.areasBefore.some(area => area.name === TARGET_AREA && area.state === 'on')) throw new Error('Target area was already attached before flight; this is not a fresh attach measurement');
  // start pose, quiet
  await ev(F => { window.__map.stop(); window.__map.jumpTo({ center: F.from, zoom: F.zoom, pitch: F.pitch, bearing: F.bearing }); }, FLY);
  res.startTilesLoaded = await settlePose(ev, { center: FLY.from, zoom: FLY.zoom, pitch: FLY.pitch, bearing: FLY.bearing });
  res.startReadiness = await ev(readinessSnapshot);
  let profileClockOffset = null;
  if (PROFILE) {
    await bounded(() => cdp.send('Performance.enable'), PAGE_OPERATION_TIMEOUT_MS, 'Profiler clock enable');
    const clocks = await bounded(() => cdp.send('Performance.getMetrics'), PAGE_OPERATION_TIMEOUT_MS, 'Profiler clocks');
    const navigationStart = clocks.metrics.find(metric => metric.name === 'NavigationStart')?.value;
    if (navigationStart) profileClockOffset = -navigationStart * 1000;
    await bounded(() => cdp.send('Profiler.enable'), PAGE_OPERATION_TIMEOUT_MS, 'Profiler enable');
    await bounded(() => cdp.send('Profiler.setSamplingInterval', { interval: 250 }), PAGE_OPERATION_TIMEOUT_MS, 'Profiler interval');
    await bounded(() => cdp.send('Profiler.start'), PAGE_OPERATION_TIMEOUT_MS, 'Profiler start');
  }
  const markT = await ev(() => window.__areaMeterMark());
  const attachT = await ev(F => window.__amFly(F), Object.assign({}, FLY, { tailMs: ATTACH_TAIL_MS, maxMs: MAX_WAIT_MS }), MAX_WAIT_MS + PAGE_OPERATION_TIMEOUT_MS);
  let prof = null;
  if (PROFILE) prof = (await bounded(() => cdp.send('Profiler.stop'), PAGE_OPERATION_TIMEOUT_MS, 'Profiler stop')).profile;
  const snap = await ev(() => { const M = window.__am; return { raf: M.raf.filter(t => t >= M.flyT0 - 50 && t <= M.flyT1), lt: M.lt.filter(x => x[0] + x[1] >= M.flyT0 && x[0] <= M.flyT1), spans: M.spans.filter(x => x[1] + x[2] >= M.flyT0 && x[1] <= M.flyT1), logs: M.logs, states: M.states, areaAttachStarts: M.areaAttachStarts, flyT0: M.flyT0, flyT1: M.flyT1, attachT: M.attachT }; });
  res.attached = attachT != null;
  res.logs = snap.logs.map(l => [r1(l[0] - snap.flyT0), l[1]]);
  res.states = snap.states.filter(s => s[0] >= snap.flyT0 - 50).map(s => [r1(s[0] - snap.flyT0), s[1]]);
  const fetchT = (snap.states.find(s => s[0] >= snap.flyT0 && /fetching/.test(s[1])) || [])[0];
  const buildT = (snap.states.find(s => s[0] >= snap.flyT0 && /building/.test(s[1])) || [])[0];
  const attachStart = snap.areaAttachStarts.find(start => start >= snap.flyT0) ?? snap.attachT - 200;
  res.times = { fetchAt: fetchT == null ? null : r1(fetchT - snap.flyT0), buildAt: buildT == null ? null : r1(buildT - snap.flyT0), attachAt: snap.attachT == null ? null : r1(snap.attachT - snap.flyT0), loadToAttachMs: snap.attachT == null || fetchT == null ? null : r1(snap.attachT - fetchT), buildToAttachMs: snap.attachT == null || buildT == null ? null : r1(snap.attachT - buildT) };
  // frame intervals (end time, ms)
  const fr = []; for (let i = 1; i < snap.raf.length; i++) fr.push([snap.raf[i], snap.raf[i] - snap.raf[i - 1]]);
  res.iv = fr.map(([t, d]) => [r1(t - snap.flyT0), r1(d)]);
  const worstIn = (a, b) => { let w = null; for (const f of fr) if (f[0] >= a && f[0] - f[1] <= b && (!w || f[1] > w[1])) w = f; return w; };
  const attribute = (f) => {
    if (!f) return null;
    const a = f[0] - f[1], b = f[0], by = {};
    for (const [n, t, d] of snap.spans) { const o = Math.min(b, t + d) - Math.max(a, t); if (o > 0) { const k = n.startsWith('gl.') ? n : n; by[k] = (by[k] || 0) + o; } }
    const lt = snap.lt.filter(x => x[0] < b && x[0] + x[1] > a).map(x => [r1(x[0] - snap.flyT0), r1(x[1])]);
    return { at: r1(a - snap.flyT0), ms: r1(f[1]), spans: Object.fromEntries(Object.entries(by).sort((x, y) => y[1] - x[1]).slice(0, 14).map(([k, v]) => [k, r1(v)])), longTasks: lt };
  };
  const ivs = fr.map(f => f[1]);
  const inWin = (a, b) => frameIntervalsInWindow(fr, a, b);
  const fly = inWin(snap.flyT0, snap.flyT0 + FLY.seconds * 1000);
  const aroundAttach = snap.attachT != null ? inWin(attachStart, snap.attachT + 3000) : [];
  const building = buildT != null && snap.attachT != null ? inWin(buildT, snap.attachT) : [];
  res.frames = {
    all: { n: ivs.length, p50: r1(pct(ivs, 0.5)), p95: r1(pct(ivs, 0.95)), worst: r1(Math.max(...ivs)), over50: ivs.filter(x => x > 50).length, over100: ivs.filter(x => x > 100).length },
    flight: { n: fly.length, p50: r1(pct(fly, 0.5)), worst: r1(Math.max(0, ...fly)) },
    building: { n: building.length, p50: r1(pct(building, 0.5)), p95: r1(pct(building, 0.95)), worst: r1(Math.max(0, ...building)), over50: building.filter(x => x > 50).length },
    attach: { n: aroundAttach.length, worst: r1(Math.max(0, ...aroundAttach)), over50: aroundAttach.filter(x => x > 50).length, over100: aroundAttach.filter(x => x > 100).length, sumOver50: Math.round(aroundAttach.filter(x => x > 50).reduce((s, x) => s + x, 0)) },
  };
  const wAll = worstIn(snap.flyT0, snap.flyT1);
  const wAttach = snap.attachT != null ? worstIn(attachStart, snap.attachT + 3000) : null;
  res.attachWindow = { startMs: r1(attachStart - snap.flyT0), endMs: snap.attachT == null ? null : r1(snap.attachT + 3000 - snap.flyT0), method: 'first slopes.add during flight through completion plus 3000 ms; includes every upload/filter slice' };
  res.worstFrame = attribute(wAll);
  res.worstAttachFrame = attribute(wAttach);
  // the five worst frames anywhere, attributed
  res.top5 = [...fr].sort((x, y) => y[1] - x[1]).slice(0, 5).map(attribute);
  if (prof) {
    const off = findMarkOffset(prof, markT) ?? profileClockOffset;
    res.profileOffset = off;
    res.profileClockMethod = findMarkOffset(prof, markT) != null ? 'sampled marker' : 'CDP NavigationStart monotonic clock offset';
    if (off != null && wAttach) res.profileAttach = summarizeProfile(prof, off, wAttach[0] - wAttach[1], wAttach[0]);
    if (off != null && wAll && wAll !== wAttach) res.profileWorst = summarizeProfile(prof, off, wAll[0] - wAll[1], wAll[0]);
  }
  res.areasAfter = await ev(() => window.slopesApartments.areas.list);
  res.aptCount = await ev(() => { const c = window.slopesApartments.count; return { triangles: c.triangles, names: c.names.length }; });
  console.log(`[area ${arm.name}#${rep}] attached ${res.attached} at +${res.times.attachAt} ms (fetch +${res.times.fetchAt}, build +${res.times.buildAt}; load->attach ${res.times.loadToAttachMs} ms)  worst frame ${res.frames.all.worst} ms  attach-window worst ${res.frames.attach.worst} ms (>50: ${res.frames.attach.over50}, >100: ${res.frames.attach.over100})  building worst ${res.frames.building.worst} p95 ${res.frames.building.p95}  flight p50 ${res.frames.flight.p50}`);
  if (wAttach) console.log(`[area ${arm.name}#${rep}] attach frame ${JSON.stringify(res.worstAttachFrame)}`);
  console.log(`[area ${arm.name}#${rep}] flight finished; ${workDeadline - Date.now()} ms left in work budget`);
  res.afterReadiness = await ev(readinessSnapshot, { detailed: false });
  res.memoryAfter = await ev(memorySnapshot);
  res.attachmentComplete = res.areasAfter.some(area => area.name === TARGET_AREA && area.state === 'on' && area.buildings === EXPECTED_AREA_BUILDINGS && area.specs === EXPECTED_AREA_BUILDINGS);
  if (!res.attached || !res.attachmentComplete) errors.push('Flight did not attach the complete expected Riverside catalog');
  if (!STOP_AFTER_FLIGHT && res.attached) {
    if (SHOTS && rep === SHOTS_REP) { console.log(`[area ${arm.name}#${rep}] capturing fixed poses`); await captureShots(page, ev, arm, rep, res); }
    if (!SKIP_GEOMETRY && (rep === GEOMETRY_REP || (CYCLES > 0 && rep === CYCLES_REP))) {
      console.log(`[area ${arm.name}#${rep}] hashing geometry; ${workDeadline - Date.now()} ms left`);
      await settlePose(ev, SNAPSHOT_POSE);
      res.geometry = await geometrySnapshot(ev);
      res.completeness = areaCompleteness(res.geometry);
      if (!res.completeness.pass) errors.push('After-attach geometry/catalog completeness failed');
    }
    if (CYCLES > 0 && rep === CYCLES_REP) { await runCycles(ev, cdp, res); if (!res.cyclesComplete) errors.push('Reload cycles did not retain identical geometry/renderer resource counts'); }
  }
  res.errors = errors.slice(0, 20);
  return res;
  } catch (error) {
    res.runError = error.stack || error.message;
    errors.push(error.message);
    process.exitCode = 2;
    return res;
  } finally {
    res.errors = errors.slice(0, DIAGNOSTIC_LIMIT);
    res.warnings = warnings.slice(0, DIAGNOSTIC_LIMIT);
    res.requestFailures = requestFailures.slice(0, DIAGNOSTIC_LIMIT);
    res.httpErrors = httpErrors.slice(0, DIAGNOSTIC_LIMIT);
    try {
      if (page && !page.isClosed()) res.mapErrors = await bounded(() => page.evaluate(() => window.__am?.mapErrors || []), FINAL_DIAGNOSTIC_TIMEOUT_MS, 'Final map diagnostics').catch(error => [{ message: error.message }]);
      if (res.runError && page && !page.isClosed()) res.failureReadiness = await bounded(() => page.evaluate(readinessSnapshot), FINAL_DIAGNOSTIC_TIMEOUT_MS, 'Failure readiness diagnostics').catch(error => ({ error: error.message }));
      res.diagnosticTotals = { errors: errors.length, warnings: warnings.length, requestFailures: requestFailures.length, httpErrors: httpErrors.length, mapErrors: res.mapErrors?.length || 0 };
      res.visualAcceptance = res.captureIncomplete || res.errors.length || res.requestFailures.length || res.httpErrors.length || res.mapErrors?.length ? 'NOT ESTABLISHED: incomplete readiness or errors; inspect captures and diagnostics' : 'NOT ESTABLISHED: compare matching cameras and geometry with the other arm';
    } finally { await browser.close(); await browser.__done(); }
  }
}

const all = [];
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outFile = path.join(OUT, `area-${stamp}.json`);
for (let rep = 0; rep < REPS; rep++) {
  for (const arm of ARMS) {
    try { all.push(await runArm(arm, rep)); }
    catch (error) {
      all.push({ arm: arm.name, url: arm.url, rep, attached: false, runError: error.stack || error.message, errors: [error.message] });
      fs.writeFileSync(outFile, JSON.stringify(all, null, 1));
      console.error(error.stack || error.message);
      process.exit(2);
    }
    fs.writeFileSync(outFile, JSON.stringify(all, null, 1));
  }
}
console.log(`\n=== area-attach-meter  gpu=${GPU}  renderer=${all[0] && all[0].renderer && all[0].renderer.renderer}  css ${W}x${H} dpr ${DPR}  vsync ${VSYNC}  cpu throttle none  reps ${REPS}`);
for (const arm of ARMS) {
  const rs = all.filter(r => r.arm === arm.name && r.attached);
  if (!rs.length) { console.log(arm.name, 'never attached'); continue; }
  const mm = sel => { const v = rs.map(sel).filter(x => x != null); return `${r1(Math.min(...v))} (min) / ${v.map(r1).join(', ')}`; };
  console.log(`${arm.name.padEnd(8)} attach-window worst ${mm(r => r.frames.attach.worst)}  whole-run worst ${mm(r => r.frames.all.worst)}  building p95 ${mm(r => r.frames.building.p95)}  load->attach ${mm(r => r.times.loadToAttachMs)} ms`);
}
console.log('wrote', outFile);
