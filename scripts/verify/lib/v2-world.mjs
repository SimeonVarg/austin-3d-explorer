// v2-world.mjs - the real v2 data a check needs WITHOUT a browser: the collision outlines (the city worker's own output), the tile
// manifest, and the name list v2/labels.js builds from them. Node >=22.15; no GPU, server or npm install.
//   const w = await loadWorld();   // { url, THREE, manifest, field, data, items, homes, catalog }
// `items` = blenderItems + homeItems + campusItems, in the order main.js adds them. Everything is the shipped code reading the
// shipped data files; nothing is copied here.
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';

export const root = new URL('../../../', import.meta.url);
export const url = (p) => new URL(p, root);

let hooked = false;
function hook() {
  if (hooked) return; hooked = true;
  registerHooks({ resolve(specifier, context, next) {
    return next(specifier === 'three' ? url('v2/vendor/three/build/three.core.js').href : specifier, context);
  } });
}

hook();   // `import 'three'` in v2's own modules resolves to the vendored build, in every script that imports this file

// run a v2 worker module (city-worker.js / route-worker.js) in this process: it talks through globalThis.onmessage / postMessage
async function runWorker(file, init, onMessage) {
  const saved = { fetch: globalThis.fetch, postMessage: globalThis.postMessage, onmessage: globalThis.onmessage };
  try {
    globalThis.fetch = async (href) => {
      const u = new URL(href);
      if (!u.href.startsWith(url('data/').href)) throw new Error(`unexpected worker fetch: ${u}`);
      return { ok: true, json: async () => JSON.parse(await readFile(u, 'utf8')) };
    };
    globalThis.postMessage = (m) => { if (m.type === 'error') throw new Error(m.msg); onMessage(m); };
    globalThis.onmessage = null;
    await import(url(file).href + '?w=' + Math.random());
    await globalThis.onmessage({ data: init });
  } finally { Object.assign(globalThis, saved); }
}

export async function loadWorld() {
  hook();
  const THREE = await import(url('v2/vendor/three/build/three.core.js'));
  const { CollisionField } = await import(url('v2/flycam.js'));
  const { LOOK } = await import(url('v2/look.js'));
  const { ORIGIN } = await import(url('v2/geo.js'));
  const labels = await import(url('v2/labels.js'));
  const manifest = JSON.parse(await readFile(url('v2/tiles/manifest.json'), 'utf8'));
  const homes = JSON.parse(await readFile(url('data/finder/homes.json'), 'utf8')).homes;
  let data, catalog;
  await runWorker('v2/city-worker.js', { type: 'init', look: LOOK, origin: ORIGIN }, (m) => { if (m.type === 'collide') data = m.data; });
  await runWorker('v2/route-worker.js', { type: 'init', origin: ORIGIN }, (m) => { if (m.type === 'ready') catalog = m; });
  if (!data?.ids?.length) throw new Error('the city worker produced no collision outlines');
  if (!catalog?.buildings?.length) throw new Error('the route worker produced no campus buildings');
  const field = new CollisionField(); field.setFootprints(data);
  for (const b of Object.values(manifest.buildings)) field.setTop(b.map_ids || [], b.top);
  const items = [
    ...labels.blenderItems(manifest),
    ...labels.homeItems(homes, manifest),
    ...labels.campusItems(catalog.buildings, catalog.doors),
  ];
  return { url, THREE, manifest, field, data, items, homes, catalog, labels };
}

// One tile's lod0 file decoded WITHOUT a browser (the shipped GLTFLoader + MeshoptDecoder; materials and images are stripped from
// an in-memory copy, the file on disk is untouched). Returns, per building of the tile (index = the vertex attribute _building =
// position in tile.buildings), flat world-space triangles: { slug, tris: Float32Array [x0,y0,z0, x1,y1,z1, x2,y2,z2, ...] }.
export async function loadTileTriangles(tile, file = tile.lod0) {
  const world = await import(url('v2/vendor/three/build/three.core.js'));
  const { GLTFLoader } = await import(url('v2/vendor/three/examples/jsm/loaders/GLTFLoader.js'));
  const { MeshoptDecoder } = await import(url('v2/vendor/three/examples/jsm/libs/meshopt_decoder.module.js'));
  const raw = await readFile(file.startsWith('/') ? file : url('v2/' + file));   // (an absolute path: a copy of a tile, e.g. from an older commit)
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
  const per = tile.buildings.map((slug) => ({ slug, list: [] }));
  const v = [new world.Vector3(), new world.Vector3(), new world.Vector3()];
  scene.traverse((o) => {
    const pos = o.geometry?.getAttribute('position'), ids = o.geometry?.getAttribute('_building');
    if (!pos || !ids) return;
    const idx = o.geometry.index, T = idx ? idx.count : pos.count;
    for (let t = 0; t + 2 < T; t += 3) {
      const a = idx ? idx.getX(t) : t, b = idx ? idx.getX(t + 1) : t + 1, c = idx ? idx.getX(t + 2) : t + 2;
      const k = Math.round(ids.getX(a)); if (!per[k]) continue;
      [a, b, c].forEach((i, q) => v[q].fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld));
      per[k].list.push(v[0].x, v[0].y, v[0].z, v[1].x, v[1].y, v[1].z, v[2].x, v[2].y, v[2].z);
    }
  });
  return per.map((p) => ({ slug: p.slug, tris: Float32Array.from(p.list) }));
}
