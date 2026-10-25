// v2 trees from sources a public product may use (scripts/v2/street_trees.py):
//   v2/data/trees/city.json  City of Austin tree inventories (species, trunk size, downtown heights) + crowns measured on the City's
//                            2025 aerial where the inventories have no tree (the UT campus is state land and no inventory covers it)
//   v2/data/trees/osm.json   OpenStreetMap trees where none of those has one (ODbL, its own file)
// Drawn the way v2 drew the old canopy (a smooth round crown on a trunk, the crown taking TREE_CROWN_SHARE of the height), now with a
// shape and a colour per species group. One instanced crown mesh per group, one for all trunks.
import { TREE_LOOK as T } from './street-look.js';

const params = new URLSearchParams(location.search);
const DATA = new URL('./data/trees/', import.meta.url).href;

export function installTrees({ THREE, scene, redraw, renderer, phone = false }) {
  if (params.get('trees') === '0') return null;
  // the tree library (trees-real.js: solid crowns from the tree's own leaf clusters) by default; ?trees=balls for one ball or cone a tree
  const REAL = (params.get('trees') || T.DEFAULT_MODE) === 'real';
  // positions: one tree per crown of the 2021 laser scan (scripts/v2/street_trees_lidar.py) by default; ?treesrc=city for the City
  // inventories + the aerial's crowns + OSM (street_trees.py), which put trees where the owner's photographs have none
  const SRC = params.get('treesrc') || T.DEFAULT_SOURCE;
  const group = new THREE.Group(); group.name = 'trees';
  scene.add(group);
  const stats = { ready: false };

  function smooth(g) {
    // weld so the normals are smooth (a round crown, not facets that flicker)
    g.deleteAttribute('normal'); g.deleteAttribute('uv');
    const p = g.attributes.position, map = new Map(), verts = [], idx = [];
    for (let i = 0; i < p.count; i++) {
      const k = p.getX(i).toFixed(4) + ',' + p.getY(i).toFixed(4) + ',' + p.getZ(i).toFixed(4);
      let j = map.get(k); if (j == null) { j = verts.length / 3; map.set(k, j); verts.push(p.getX(i), p.getY(i), p.getZ(i)); } idx.push(j);
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)); out.setIndex(idx); out.computeVertexNormals();
    return out;
  }
  // crown shapes in a unit frame: centred at 0, radius 1 across, half-height 1
  const SHAPES = {
    round: () => smooth(new THREE.IcosahedronGeometry(1, 1)),
    cone: () => new THREE.ConeGeometry(1, 2, 8, 1, false),
  };

  async function build() {
    const files = SRC === 'lidar' ? [await fetch(DATA + 'safe_lidar.json').then((r) => r.json())]
      : await Promise.all([fetch(DATA + 'safe_city.json').then((r) => r.json()), fetch(DATA + 'safe_osm.json').then((r) => r.json()).catch(() => null)]);
    const groups = files[0].groups;
    const rows = groups.map(() => []);
    for (const f of files) {
      if (!f) continue;
      const t = f.trees;
      for (let i = 0; i + 6 <= t.length; i += 6) rows[t[i + 4]].push([t[i], t[i + 1], t[i + 2], t[i + 3], t[i + 5] / 255]);
    }
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3(), c = new THREE.Color(), hsl = {};
    const trunkAll = [];   // [x, z, crown radius, height, crown height]
    groups.forEach((name, gi) => {
      const list = rows[gi]; if (!list.length) return;
      const look = T.GROUPS[name] || T.GROUPS.broadleaf;
      const crowns = new THREE.InstancedMesh(SHAPES[look.shape](), new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 }), list.length);
      new THREE.Color(look.color).getHSL(hsl);
      list.forEach(([x, z, r, h, v], i) => {
        r *= look.radius;
        const ch = Math.max(r * look.minAspect, h * look.crownShare);   // crown height
        M.compose(P.set(x, h - ch / 2, z), Q, S.set(r, ch / 2, r)); crowns.setMatrixAt(i, M);
        trunkAll.push([x, z, r, h, ch]);
        c.setHSL(hsl.h + (v - 0.5) * T.HUE_VARIATION, hsl.s, THREE.MathUtils.clamp(hsl.l * (1 + (v - 0.5) * 2 * T.LIGHTNESS_VARIATION), 0, 1));
        crowns.setColorAt(i, c);
      });
      crowns.castShadow = true; crowns.receiveShadow = true; crowns.computeBoundingSphere(); crowns.name = 'crowns ' + name; crowns.visible = !REAL;
      group.add(crowns);
      stats[name] = list.length;
    });
    const trunkGeo = new THREE.CylinderGeometry(0.75, 1, 1, 6, 1, true).translate(0, 0.5, 0);
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: T.TRUNK, roughness: 1 }), trunkAll.length);
    trunkAll.forEach(([x, z, r, h, ch], i) => {
      const tr = 0.12 + r * 0.025;
      M.compose(P.set(x, 0, z), Q, S.set(tr, Math.max(0.5, h - ch * 0.8), tr)); trunks.setMatrixAt(i, M);
    });
    trunks.castShadow = true; trunks.receiveShadow = true; trunks.computeBoundingSphere(); trunks.name = 'trunks'; trunks.visible = !REAL;   // (the camera's trunk collision still reads its matrices)
    group.add(trunks);
    Object.assign(stats, { ready: true, total: trunkAll.length, source: SRC, osm: files[1] ? files[1].trees.length / 6 : 0 });
    if (REAL) {
      try { const m = await import('./trees-real.js'); await m.installRealTrees({ THREE, scene, group, redraw, rows, groups, phone, renderer }); stats.real = true; }
      catch (e) { stats.realError = e.message; console.warn('[v2 trees real]', e.message); group.children.forEach((o) => { if (o.name !== 'tree ticker') o.visible = true; }); }   // fall back to the balls
    }
    redraw();
  }
  build().catch((e) => { stats.error = e.message; console.warn('[v2 trees]', e.message); });
  const api = { stats: () => ({ ...stats }), group };
  window.__v2trees = api;
  return api;
}
