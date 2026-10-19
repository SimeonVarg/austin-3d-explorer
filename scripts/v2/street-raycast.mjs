// CPU diagnostic of the actual street/tree meshes, not a rendered application screenshot.
// node scripts/v2/street-raycast.mjs CASE.json [--baseline-data /path/to/v2/data]
// CASE: {target:[x,y,z],distance,polar,azimuth,width,height,pixels:[[x,y],...]}
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root = path.resolve(import.meta.dirname, '../..'), spec = JSON.parse(fs.readFileSync(process.argv[2]));
const bi = process.argv.indexOf('--baseline-data'), baseline = bi < 0 ? null : process.argv[bi + 1];
const THREE = await import(pathToFileURL(root + '/v2/vendor/three/build/three.module.js'));
globalThis.location = { search: '' }; globalThis.window = {};
THREE.TextureLoader.prototype.load = function(url, done) {
  const b = fs.readFileSync(new URL(url)); if (b.toString('ascii', 1, 4) !== 'PNG') throw Error('bad atlas');
  const t = new THREE.Texture({ width: b.readUInt32BE(16), height: b.readUInt32BE(20) }); queueMicrotask(() => done(t)); return t;
};
const read = url => {
  const file = new URL(url), rel = file.pathname.split('/v2/data/')[1];
  const old = baseline && rel && path.join(baseline, rel);
  return JSON.parse(fs.readFileSync(old && fs.existsSync(old) ? old : file, 'utf8'));
};
globalThis.fetch = async url => { try { const d = read(url); return { ok: true, json: async () => d }; } catch { return { ok: false }; } };
const scene = new THREE.Scene();
const near = (await import(pathToFileURL(root + '/v2/street_near.js'))).installStreetNear({ THREE, scene, redraw() {} });
const street = (await import(pathToFileURL(root + '/v2/street.js'))).installStreet({ THREE, scene, redraw() {} });
const trees = (await import(pathToFileURL(root + '/v2/trees.js'))).installTrees({ THREE, scene, redraw() {} });
for (let i = 0; ![near, street, trees].every(a => a.stats().ready); i++) {
  if (i > 1000 || [near, street, trees].some(a => a.stats().error)) throw Error('meshes failed to load');
  await new Promise(r => setTimeout(r, 10));
}
const groups = [];
for (const name of ['city', 'osm']) {
  const d = read(pathToFileURL(root + '/v2/data/trees/safe_' + name + '.json'));
  for (let i = 0; i < d.trees.length; i += 6) {
    const gi = d.trees[i + 4]; (groups[gi] ||= []).push({ file: name, sourceIndex: d.safety.kept_indices[i / 6], row: d.trees.slice(i, i + 6) });
  }
}
const names = read(pathToFileURL(root + '/v2/data/trees/safe_city.json')).groups, trunks = groups.flat();
const camera = new THREE.PerspectiveCamera(40, spec.width / spec.height, 1.5, 16000);
const p = spec.polar * Math.PI / 180, a = spec.azimuth * Math.PI / 180;
camera.position.set(spec.target[0] + spec.distance * Math.sin(p) * Math.sin(a), spec.target[1] + spec.distance * Math.cos(p), spec.target[2] + spec.distance * Math.sin(p) * Math.cos(a));
camera.lookAt(...spec.target); camera.updateMatrixWorld(); scene.updateMatrixWorld(true);
const ray = new THREE.Raycaster();
for (const pixel of spec.pixels) {
  ray.setFromCamera(new THREE.Vector2(pixel[0] / spec.width * 2 - 1, 1 - pixel[1] / spec.height * 2), camera);
  const hits = ray.intersectObjects(scene.children, true).slice(0, 8).map(h => {
    const mesh = h.object.name, group = names.indexOf(mesh.replace('crowns ', ''));
    const tree = mesh === 'trunks' ? trunks[h.instanceId] : group >= 0 ? groups[group][h.instanceId] : null;
    return { mesh, face: h.faceIndex, instance: h.instanceId, xyz: h.point.toArray(), distance: h.distance, ...(tree ? { tree } : {}) };
  });
  console.log(JSON.stringify({ pixel, hits }));
}
