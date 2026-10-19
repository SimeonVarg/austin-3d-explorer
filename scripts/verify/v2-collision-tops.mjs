// Node >=22.15; no browser, server, npm install or GPU needed.
//   node scripts/verify/v2-collision-tops.mjs
//   node scripts/verify/v2-collision-tops.mjs --flycam /tmp/flycam-before.js
// Uses the real city worker, tile manifest, CollisionField and (for absent outlines)
// decoded tile geometry. A missing building is a failure, never a skipped check.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';

const root = new URL('../../', import.meta.url);
const url = (p) => new URL(p, root);
registerHooks({ resolve(specifier, context, next) {
  return next(specifier === 'three' ? url('v2/vendor/three/build/three.core.js').href : specifier, context);
} });
const THREE = await import(url('v2/vendor/three/build/three.core.js'));
const flycamArg = process.argv.indexOf('--flycam');
const { CollisionField, FlyControls, FLY } = await import(flycamArg < 0 ? url('v2/flycam.js') : pathToFileURL(process.argv[flycamArg + 1]));
const { LOOK } = await import(url('v2/look.js'));
const { ORIGIN } = await import(url('v2/geo.js'));
const manifest = JSON.parse(await readFile(url('v2/tiles/manifest.json'), 'utf8'));

// Run the actual worker with fetch restricted to public repo data. No duplicated
// height choices, downtown deduplication or polygon serialization in this check.
let data;
const saved = { fetch: globalThis.fetch, postMessage: globalThis.postMessage, onmessage: globalThis.onmessage };
try {
  globalThis.fetch = async (href) => {
    const u = new URL(href);
    assert(u.href.startsWith(url('data/').href), `unexpected worker fetch: ${u}`);
    return { ok: true, json: async () => JSON.parse(await readFile(u, 'utf8')) };
  };
  globalThis.postMessage = (m) => {
    if (m.type === 'collide') data = m.data;
    if (m.type === 'error') throw new Error(m.msg);
  };
  globalThis.onmessage = null;
  await import(url('v2/city-worker.js'));
  await globalThis.onmessage({ data: { type: 'init', look: LOOK, origin: ORIGIN } });
} finally { Object.assign(globalThis, saved); }
assert(data?.ids.length, 'worker must produce collision polygons');
const field = new CollisionField(); field.setFootprints(data);

// Resolve expected identities independently of CollisionField.byId.
const canonical = (id) => /^[0-9a-f]{8}-/i.test(String(id)) ? String(id).slice(0, 8) : String(id);
const indices = new Map();
data.polyId.forEach((id, p) => {
  const key = canonical(data.ids[id]);
  if (!indices.has(key)) indices.set(key, []);
  indices.get(key).push(p);
});
const slugs = [...new Set(manifest.tiles.filter((t) => t.lod0).flatMap((t) => t.buildings))];
assert.equal(slugs.length, Object.keys(manifest.buildings).length, 'every manifest building has a full tile');
const expectedTop = new Map();
for (const slug of slugs) {
  const b = manifest.buildings[slug];
  assert(b?.map_ids?.length && Number.isFinite(b.top) && b.top > 0, `${slug}: valid ids/top`);
  for (const id of b.map_ids) for (const p of indices.get(canonical(id)) || []) expectedTop.set(p, Math.max(expectedTop.get(p) || 0, b.top));
  field.setTop(b.map_ids, b.top);
}

// An area centroid can fall outside a concave shell or in a courtyard. Use the
// middle of an interior scanline there, rather than calling open ground a roof.
function centre(p) {
  const rings = [];
  for (let r = data.polyRing[p]; r < data.polyRing[p + 1]; r++) {
    const points = [];
    for (let i = data.ringStart[r]; i < data.ringStart[r + 1]; i++) points.push([data.coords[i * 2], data.coords[i * 2 + 1]]);
    rings.push(points);
  }
  const insideRing = ([x, z], points) => {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [ax, az] = points[i], [bx, bz] = points[j];
      if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) inside = !inside;
    }
    return inside;
  };
  const inside = (q) => insideRing(q, rings[0]) && !rings.slice(1).some((r) => insideRing(q, r));
  let area = 0, x = 0, z = 0;
  for (let i = 0, j = rings[0].length - 1; i < rings[0].length; j = i++) {
    const a = rings[0][j], b = rings[0][i], cross = a[0] * b[1] - b[0] * a[1];
    area += cross; x += (a[0] + b[0]) * cross; z += (a[1] + b[1]) * cross;
  }
  const q = [x / (3 * area), z / (3 * area)];
  if (inside(q)) return q;
  const zs = [...new Set(rings.flat().map((v) => v[1]))].sort((a, b) => a - b);
  const candidates = [];
  for (let k = 1; k < zs.length; k++) {
    const y = (zs[k - 1] + zs[k]) / 2, xs = [];
    for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a[1] > y) !== (b[1] > y)) xs.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
    }
    xs.sort((a, b) => a - b);
    for (let k = 1; k < xs.length; k++) {
      const v = [(xs[k - 1] + xs[k]) / 2, y];
      if (inside(v)) candidates.push(v);
    }
  }
  candidates.sort((a, b) => Math.hypot(a[0] - q[0], a[1] - q[1]) - Math.hypot(b[0] - q[0], b[1] - q[1]));
  assert(candidates.length, `polygon ${p}: interior centre exists`);
  return candidates[0];
}

// Decode only tiles needed for models missing from the worker data, using the
// shipped loader/decoder. Strip materials/images from an in-memory copy: collision
// needs positions/transforms/ids, and Node has no image loader. Disk files stay intact.
const fallbackCentres = new Map(); let fallbackCount = 0;
for (const tile of manifest.tiles) {
  const absent = tile.buildings.filter((s) => !manifest.buildings[s].map_ids.some((id) => indices.has(canonical(id))));
  if (!absent.length) continue;
  const { GLTFLoader } = await import(url('v2/vendor/three/examples/jsm/loaders/GLTFLoader.js'));
  const { MeshoptDecoder } = await import(url('v2/vendor/three/examples/jsm/libs/meshopt_decoder.module.js'));
  const raw = await readFile(url('v2/' + tile.lod0));
  const n = raw.readUInt32LE(12), j = JSON.parse(raw.subarray(20, 20 + n).toString());
  delete j.images; delete j.textures; delete j.materials;
  for (const mesh of j.meshes) for (const p of mesh.primitives) delete p.material;
  const json = Buffer.from(JSON.stringify(j)), padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32); json.copy(padded);
  const glb = Buffer.alloc(20 + padded.length + raw.length - 20 - n);
  raw.copy(glb, 0, 0, 12); glb.writeUInt32LE(glb.length, 8); glb.writeUInt32LE(padded.length, 12); glb.writeUInt32LE(0x4e4f534a, 16);
  padded.copy(glb, 20); raw.copy(glb, 20 + padded.length, 20 + n);
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
  const { scene } = await loader.parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '');
  scene.updateMatrixWorld(true);
  for (const slug of absent) {
    const i = tile.buildings.indexOf(slug), v = new THREE.Vector3(), sum = new THREE.Vector3(); let count = 0;
    scene.traverse((o) => {
      const pos = o.geometry?.getAttribute('position'), ids = o.geometry?.getAttribute('_building');
      if (!pos || !ids) return;
      for (let k = 0; k < pos.count; k++) if (Math.round(ids.getX(k)) === i) {
        v.fromBufferAttribute(pos, k).applyMatrix4(o.matrixWorld);
        if (v.y > 0.5) { sum.add(v); count++; }
      }
    });
    assert(count > 0, `${slug}: decoded vertices`); sum.divideScalar(count);
    fallbackCentres.set(slug, [sum.x, sum.z]); fallbackCount++;
  }
  field.addTile?.(scene, tile, manifest.buildings);
  const count = field.polys.length;
  field.addTile?.(scene, tile, manifest.buildings);
  assert.equal(field.polys.length, count, 'tile reload must not duplicate collision footprints');
}

const wrong = []; let wrongCentres = 0;
for (const slug of slugs) {
  const b = manifest.buildings[slug];
  const ps = [...new Set(b.map_ids.flatMap((id) => indices.get(canonical(id)) || []))];
  // The primary footprint's centre must reach this model's own top. Other shared
  // outlines must reach the tallest owner, never a later, shorter model's top.
  const q = ps.length ? centre(ps[0]) : fallbackCentres.get(slug);
  assert(q, `${slug}: footprint centre required`);
  const actual = field.heightIn(...q, 0);
  const badParts = ps.filter((p) => Math.abs(field.polys[p].top - expectedTop.get(p)) > 0.5);
  const badCentre = Math.abs(actual - b.top) > 0.5;
  if (badCentre) wrongCentres++;
  if (badCentre || badParts.length) wrong.push({ slug, expected: b.top, actual: +actual.toFixed(3), wrongParts: badParts.length });
}
console.log(`${slugs.length} Blender buildings checked; ${wrongCentres} wrong footprint centres; ${wrong.length} buildings with any wrong top (tolerance 0.5 m); ${fallbackCount} model-derived footprint(s) needed.`);
for (const row of wrong) console.log(JSON.stringify(row));
assert.equal(wrong.length, 0, 'every Blender building must reach its model top');

// Behavioural seams: a real corrected Tower blocks below its roof and clears
// above it; holes, plain buildings, exact ids, repeated updates and shared ids.
const tower = manifest.buildings['ut-tower-main-building'];
const p = indices.get(tower.map_ids[0])[0], q = centre(p);
const controller = Object.create(FlyControls.prototype); controller.field = field; controller.alt = tower.top - 1;
assert(controller.blockedAt(...q), 'Tower shaft blocks below the Blender roof');
controller.alt = tower.top + FLY.SKIN + 1;
assert(!controller.blockedAt(...q), 'camera clears the Blender roof');
const fixture = new CollisionField();
fixture.setFootprints({ coords: new Float32Array([0, 0, 10, 0, 10, 10, 0, 10, 3, 3, 7, 3, 7, 7, 3, 7]), ringStart: [0, 4, 8], polyRing: [0, 2], polyTop: [12], polyId: [0], ids: ['12345678-aaaa-bbbb-cccc-123456789abc'] });
fixture.setTop(['12345678', '12345678-aaaa-bbbb-cccc-123456789abc'], 50);
fixture.setTop(['12345678'], 40);
assert.equal(fixture.heightIn(1, 1, 0), 50, 'shared outline keeps taller top');
assert.equal(fixture.heightIn(5, 5, 0), 0, 'courtyard stays open');
fixture.setTop(['12345678'], NaN);
assert.equal(fixture.heightIn(1, 1, 0), 50, 'invalid top ignored');
fixture.setFootprints({ coords: new Float32Array([0, 0, 10, 0, 10, 10, 0, 10]), ringStart: [0, 4], polyRing: [0, 1], polyTop: [12], polyId: [0], ids: ['w123456789'] });
fixture.setTop(['w1234567'], 60);
assert.equal(fixture.heightIn(5, 5, 0), 12, 'non-campus ids never match arbitrary prefixes; reset clears overrides');
fixture.setTop(['w123456789'], 30);
assert.equal(fixture.heightIn(5, 5, 0), 30, 'exact non-campus id still works');

// Exercise the unchanged v1 movement loop, omitting only DOM event binding.
class HeadlessFly extends FlyControls { bind() {} }
const wall = new CollisionField();
wall.setFootprints({ coords: new Float32Array([0, 0, 100, 0, 100, 100, 0, 100]), ringStart: [0, 4], polyRing: [0, 1], polyTop: [12], polyId: [0], ids: ['12345678-aaaa-bbbb-cccc-123456789abc'] });
wall.setTop(['12345678'], 50);
function drive(x, y, z, keys, frames) {
  const camera = new THREE.PerspectiveCamera(40, 1, 0.25, 10000);
  camera.position.set(x, y, z);
  const c = new HeadlessFly(camera, {}, { field: wall });
  let time = 1e7; c.clock = () => time; c.update();
  Object.assign(c.keys, keys);
  for (let i = 0; i < frames; i++) {
    time += 1000 / 60; c.update();
    const roof = wall.heightIn(c.eye.x, c.eye.z, 0);
    if (roof) assert(camera.position.y >= roof + FLY.HARD_CLEAR, 'moving camera remains above the roof');
  }
  return c;
}
const sliding = drive(-7, 30, 90, { KeyW: true, KeyD: true }, 180);
assert(sliding.eye.x < 0 && sliding.eye.z < 80, 'camera blocks across the tall wall and slides along it');
const riding = drive(-10, 48, 50, { KeyD: true }, 120);
assert(riding.eye.x > 0 && riding.eye.x < 100 && riding.alt >= 54, 'camera steps onto and rides the corrected roof');
console.log('PASS Tower blocking/roof clearance, wall sliding, roof riding, courtyard, shared ids, invalid tops, exact non-campus ids and reset.');
