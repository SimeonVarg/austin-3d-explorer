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
  const REAL = params.get('trees') === 'real';   // the tree library (trees-real.js) instead of one ball or cone per tree
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

  // Under a tree (street-look.js TREE_LOOK.NEAR). Vertex: the crown the camera stands under lifts its underside into a dome (0 at the
  // rim). Fragment: the underside of that crown, and any crown surface right at the camera, opens into leaf clusters (3D value noise
  // fixed on the crown's own unlifted surface, so the clusters ride with it and never swim); edge = smoothstep over the pixel's own
  // slope, alpha to coverage with MSAA. Crowns away from the camera skip all of it (open = 0, lift = 0): the same picture as before.
  const N = T.NEAR, f = (v) => Number(v).toFixed(4);
  const msaa = !!(renderer && renderer.getContext && renderer.getContext().getContextAttributes().antialias);
  const nearU = { uTreeNear: { value: params.get('treenear0') === '1' ? 0 : 1 } };   // 0 = the old solid crowns (A/B in one page load)
  function nearShader(mat) {
    mat.alphaToCoverage = msaa;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTreeNear = nearU.uTreeNear;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
uniform float uTreeNear; varying vec3 vTnSurf; varying vec3 vTnWorld; varying float vTnUnder; varying float vTnLow;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
{
  vec3 c = instanceMatrix[3].xyz; vec3 s = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
  vec3 q = (cameraPosition - c) / s;
  float under = uTreeNear * (1.0 - smoothstep(${f(N.UNDER_R[0])}, ${f(N.UNDER_R[1])}, length(q.xz))) * (1.0 - smoothstep(${f(N.ABOVE[0])}, ${f(N.ABOVE[1])}, q.y));
  vTnSurf = c + transformed * s; vTnUnder = under; vTnLow = 1.0 - smoothstep(-0.3, 0.45, transformed.y);
  if (transformed.y < 0.0) transformed.y += under * ${f(N.DOME)} * max(0.0, 1.0 - dot(transformed.xz, transformed.xz));
  vTnWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
}
#endif`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform float uTreeNear; varying vec3 vTnSurf; varying vec3 vTnWorld; varying float vTnUnder; varying float vTnLow;
float tnHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float tnNoise(vec3 x) {
  vec3 i = floor(x), u = fract(x); u = u * u * (3.0 - 2.0 * u);
  return mix(mix(mix(tnHash(i), tnHash(i + vec3(1, 0, 0)), u.x), mix(tnHash(i + vec3(0, 1, 0)), tnHash(i + vec3(1, 1, 0)), u.x), u.y),
             mix(mix(tnHash(i + vec3(0, 0, 1)), tnHash(i + vec3(1, 0, 1)), u.x), mix(tnHash(i + vec3(0, 1, 1)), tnHash(i + vec3(1, 1, 1)), u.x), u.y), u.z);
}`)
        .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
{
  float nearK = uTreeNear * (1.0 - smoothstep(${f(N.NEAR_M[0])}, ${f(N.NEAR_M[1])}, length(vTnWorld - cameraPosition)));
  float open = max(vTnUnder * vTnLow * ${f(N.OPEN_UNDER)}, nearK * ${f(N.OPEN_NEAR)});
  if (open > 0.001) {
    float n = 0.6 * tnNoise(vTnSurf / ${f(N.CLUSTER_M[0])}) + 0.4 * tnNoise(vTnSurf / ${f(N.CLUSTER_M[1])} + 17.0);
    float cut = mix(-0.05, 0.95, open), w = max(fwidth(n), 1e-4);
    float a = smoothstep(cut - 0.5 * w, cut + 0.5 * w, n);
    #ifdef ALPHA_TO_COVERAGE
      diffuseColor.a = a; if (a <= 0.0) discard;
    #else
      if (a < 0.5) discard;
    #endif
    diffuseColor.rgb *= mix(1.0, ${f(N.SHADE)}, vTnUnder);
  }
}`);
    };
    mat.customProgramCacheKey = () => 'v2-tree-near' + msaa;
    return mat;
  }

  async function build() {
    const files = await Promise.all([fetch(DATA + 'safe_city.json').then((r) => r.json()), fetch(DATA + 'safe_osm.json').then((r) => r.json()).catch(() => null)]);
    // trees the owner's photographs show are not there (data/trees/exclude.json): any tree within match_m of a listed position is left out
    const ex = await fetch(DATA + 'exclude.json').then((r) => r.json()).catch(() => null);
    const exList = (ex && ex.trees) || [], exR2 = ((ex && ex.match_m) || 0.6) ** 2;
    const excluded = (x, z) => exList.some((e) => (e.x - x) ** 2 + (e.z - z) ** 2 <= exR2);
    const groups = files[0].groups;
    const rows = groups.map(() => []);
    for (const f of files) {
      if (!f) continue;
      const t = f.trees;
      for (let i = 0; i + 6 <= t.length; i += 6) { if (exList.length && excluded(t[i], t[i + 1])) { stats.excluded = (stats.excluded || 0) + 1; continue; } rows[t[i + 4]].push([t[i], t[i + 1], t[i + 2], t[i + 3], t[i + 5] / 255]); }
    }
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3(), c = new THREE.Color(), hsl = {};
    const trunkAll = [];   // [x, z, crown radius, height, crown height]
    groups.forEach((name, gi) => {
      const list = rows[gi]; if (!list.length) return;
      const look = T.GROUPS[name] || T.GROUPS.broadleaf;
      const crowns = new THREE.InstancedMesh(SHAPES[look.shape](), nearShader(new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 })), list.length);
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
      M.compose(P.set(x, 0, z), Q, S.set(tr, Math.max(0.5, h - ch * T.TRUNK_TOP), tr)); trunks.setMatrixAt(i, M);
    });
    trunks.castShadow = true; trunks.receiveShadow = true; trunks.computeBoundingSphere(); trunks.name = 'trunks'; trunks.visible = !REAL;   // (the camera's trunk collision still reads its matrices)
    group.add(trunks);
    Object.assign(stats, { ready: true, total: trunkAll.length, osm: files[1] ? files[1].trees.length / 6 : 0 });
    if (REAL) {
      try { const m = await import('./trees-real.js'); await m.installRealTrees({ THREE, scene, group, redraw, rows, groups, phone, renderer }); stats.real = true; }
      catch (e) { stats.realError = e.message; console.warn('[v2 trees real]', e.message); group.children.forEach((o) => { if (o.name !== 'tree ticker') o.visible = true; }); }   // fall back to the balls
    }
    redraw();
  }
  build().catch((e) => { stats.error = e.message; console.warn('[v2 trees]', e.message); });
  const api = { stats: () => ({ ...stats }), group, near: (on) => { nearU.uTreeNear.value = on ? 1 : 0; redraw(); } };   // near(): the A/B switch
  window.__v2trees = api;
  return api;
}
