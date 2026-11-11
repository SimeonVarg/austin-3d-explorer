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
  const CARDS = params.get('treecards') === '1' && !REAL;   // far round crowns as one card each (street-look.js TREE_LOOK.CARDS)
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
  ${CARDS ? `if (distance(cameraPosition, c) >= ${f(T.CARDS.FROM_M)}) transformed = vec3(0.0);   // its card draws instead` : ''}
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
    mat.customProgramCacheKey = () => 'v2-tree-near' + msaa + CARDS;
    return mat;
  }

  // ── the far crowns as cards (TREE_LOOK.CARDS) ──────────────────────────────────────────────────
  // The card stands at the crown's middle, turned to the camera, just big enough to hold the crown's outline. For every pixel the
  // shader meets the view ray with the crown's ellipsoid: no hit = no pixel; a hit gives the true surface point, its normal and
  // its depth, so the crown is lit, shaded, hidden and fogged exactly as the ball was, with a perfectly round edge.
  function cardMaterial() {
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 });
    mat.alphaToCoverage = msaa;
    const LIGHTS = THREE.ShaderChunk.lights_fragment_begin
      .replace('vec3 geometryPosition = - vViewPosition;', 'vec3 geometryPosition = tcVP;')
      .replace('normalize( vViewPosition )', 'normalize( - tcVP )')
      .replace('vDirectionalShadowCoord[ i ] ) : 1.0;', 'directionalShadowMatrix[ i ] * vec4( tcP + tcN * directionalLightShadow.shadowNormalBias, 1.0 ) ) : 1.0;');
    if (LIGHTS.split('tcVP').length !== 3 || !LIGHTS.includes('tcP + tcN')) console.warn('[v2 trees] the card light patch did not apply (three.js changed)');
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vTcC; varying vec3 vTcS; varying vec3 vTcW;')
        .replace('#include <project_vertex>', `
  vec3 tcC = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
  vec3 tcS = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
  vec3 tcV = cameraPosition - tcC; float tcD = length(tcV); tcV /= max(tcD, 1e-4);
  vec3 tcR = cross(vec3(0.0, 1.0, 0.0), tcV); float tcRl = length(tcR); tcR = tcRl > 1e-4 ? tcR / tcRl : vec3(1.0, 0.0, 0.0);
  vec3 tcT = cross(tcV, tcR);
  // (the cone from the eye that touches the crown is wider than the crown where it crosses the card)
  float tcK = 1.04 / sqrt(max(1.0 - pow(max(tcS.x, tcS.y) / max(tcD, 1e-3), 2.0), 0.25));
  vec3 tcW = tcC + tcR * (position.x * tcS.x * tcK) + tcT * (position.y * length(tcT * tcS) * tcK);
  if (tcD < ${f(T.CARDS.FROM_M)}) tcW = tcC;                      // near: the ball draws instead
  vTcC = tcC; vTcS = tcS; vTcW = tcW;
  vec4 mvPosition = viewMatrix * vec4(tcW, 1.0);
  gl_Position = projectionMatrix * mvPosition;`)
        .replace('#include <worldpos_vertex>', 'vec4 worldPosition = vec4(tcW, 1.0);');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vTcC; varying vec3 vTcS; varying vec3 vTcW;
uniform mat4 projectionMatrix;
#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
  uniform mat4 directionalShadowMatrix[ NUM_DIR_LIGHT_SHADOWS ];
#endif`)
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
  vec3 tcRd = normalize(vTcW - cameraPosition);
  vec3 tcO = (cameraPosition - vTcC) / vTcS, tcDd = tcRd / vTcS;          // the ray in the frame where the crown is the unit ball
  float tcA = dot(tcDd, tcDd), tcB = dot(tcO, tcDd), tcCc = dot(tcO, tcO) - 1.0;
  float tcQl = length(tcO - tcDd * (tcB / tcA));                           // the ray's closest distance to the middle (< 1: it hits)
  float tcAl = clamp(0.5 + (1.0 - tcQl) / max(fwidth(tcQl), 1e-5), 0.0, 1.0);   // the round edge, smooth over one pixel
  #ifdef ALPHA_TO_COVERAGE
    if (tcAl <= 0.0) discard;
  #else
    if (tcAl < 0.5) discard;
  #endif
  vec3 tcU = tcO + tcDd * ((-tcB - sqrt(max(tcB * tcB - tcA * tcCc, 0.0))) / tcA);   // the near hit, on the unit ball
  vec3 tcP = vTcC + tcU * vTcS;                                            // the point on the crown, world
  vec3 tcN = normalize(tcU / vTcS);                                        // its normal, world
  vec3 tcVP = (viewMatrix * vec4(tcP, 1.0)).xyz;`)
        .replace('#include <color_fragment>', '#include <color_fragment>\n#ifdef ALPHA_TO_COVERAGE\n  diffuseColor.a = tcAl;\n#endif')
        .replace('#include <normal_fragment_begin>', 'float faceDirection = 1.0;\n  vec3 normal = normalize((viewMatrix * vec4(tcN, 0.0)).xyz);\n  vec3 nonPerturbedNormal = normal;')
        .replace('#include <lights_fragment_begin>', LIGHTS)
        .replace('#include <dithering_fragment>', `#include <dithering_fragment>
  {
    vec4 tcClip = projectionMatrix * vec4(tcVP, 1.0);
    #ifdef USE_REVERSED_DEPTH_BUFFER
      gl_FragDepth = tcClip.z / tcClip.w;
    #else
      gl_FragDepth = 0.5 * tcClip.z / tcClip.w + 0.5;
    #endif
  }`);
    };
    mat.customProgramCacheKey = () => 'v2-tree-card' + msaa;
    return mat;
  }
  // the card in the sun's shadow map: turned to the sun, cut to the crown's outline seen from the sun (an ellipse)
  function cardDepthMaterial() {
    const mat = new THREE.MeshDepthMaterial();
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vTcQ;')
        .replace('#include <project_vertex>', `
  vec3 tcC = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
  vec3 tcS = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
  vec3 tcV = vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);   // toward the light
  vec3 tcR = cross(vec3(0.0, 1.0, 0.0), tcV); float tcRl = length(tcR); tcR = tcRl > 1e-4 ? tcR / tcRl : vec3(1.0, 0.0, 0.0);
  vec3 tcT = cross(tcV, tcR);
  vTcQ = position.xy;
  vec4 mvPosition = viewMatrix * vec4(tcC + tcR * (position.x * tcS.x) + tcT * (position.y * length(tcT * tcS)), 1.0);
  gl_Position = projectionMatrix * mvPosition;`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vTcQ;')
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n  if (dot(vTcQ, vTcQ) > 1.0) discard;');
    };
    mat.customProgramCacheKey = () => 'v2-tree-card-depth';
    return mat;
  }
  // list: [x, y (crown middle), z, r, half height, THREE.Color] of every round crown; trunkAll as below; trunks: the full trunk mesh (kept, hidden)
  function installCards(list, trunkAll, trunks) {
    const C = T.CARDS, M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3();
    const cards = new THREE.InstancedMesh(new THREE.PlaneGeometry(2, 2), cardMaterial(), list.length);
    list.forEach((t, i) => { M.compose(P.set(t[0], t[1], t[2]), Q, S.set(t[3], t[4], t[3])); cards.setMatrixAt(i, M); cards.setColorAt(i, t[5]); });
    cards.customDepthMaterial = cardDepthMaterial();
    cards.castShadow = true; cards.receiveShadow = true; cards.frustumCulled = false; cards.name = 'crown cards';
    group.add(cards);
    // the balls near the camera: one mesh, refilled as the camera moves (they do not cast: the cards do, for every crown, so the shadow map never changes with the camera)
    const near = new THREE.InstancedMesh(SHAPES.round(), nearShader(new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 })), C.NEAR_MAX);
    near.setColorAt(0, new THREE.Color(1, 1, 1));
    near.count = 0; near.castShadow = false; near.receiveShadow = true; near.frustumCulled = false; near.name = 'crowns near';
    group.add(near);
    const trunkNear = new THREE.InstancedMesh(trunks.geometry, trunks.material, C.TRUNK_MAX);
    trunkNear.count = 0; trunkNear.castShadow = false; trunkNear.receiveShadow = true; trunkNear.frustumCulled = false; trunkNear.name = 'trunks near';
    group.add(trunkNear);
    trunks.visible = false;                                    // (the camera's trunk collision still reads its matrices)
    // a square grid over the trees, so a refill looks only at the squares in range
    const CELL = 100, key = (x, z) => Math.floor(x / CELL) * 65536 + Math.floor(z / CELL);
    const gridC = new Map(), gridT = new Map();
    list.forEach((t, i) => { const k = key(t[0], t[2]); (gridC.get(k) || gridC.set(k, []).get(k)).push(i); });
    trunkAll.forEach((t, i) => { const k = key(t[0], t[1]); (gridT.get(k) || gridT.set(k, []).get(k)).push(i); });
    const last = new THREE.Vector3(1e9, 0, 0), tm = trunks.instanceMatrix.array, cm = cards.instanceMatrix.array, cc = cards.instanceColor.array;
    function fill(mesh, grid, cx, cy, cz, R, srcM, srcC, xzOf, max) {
      let n = 0; const dm = mesh.instanceMatrix.array, dc = srcC && mesh.instanceColor.array, R2 = R * R;
      const i0 = Math.floor((cx - R) / CELL), i1 = Math.floor((cx + R) / CELL), j0 = Math.floor((cz - R) / CELL), j1 = Math.floor((cz + R) / CELL);
      for (let i = i0; i <= i1 && n < max; i++) for (let j = j0; j <= j1 && n < max; j++) {
        const cell = grid.get(i * 65536 + j); if (!cell) continue;
        for (const id of cell) {
          const dx = srcM[id * 16 + 12] - cx, dy = xzOf ? 0 : srcM[id * 16 + 13] - cy, dz = srcM[id * 16 + 14] - cz;
          if (dx * dx + dy * dy + dz * dz > R2 || n >= max) continue;
          dm.set(srcM.subarray(id * 16, id * 16 + 16), n * 16);
          if (dc) dc.set(srcC.subarray(id * 3, id * 3 + 3), n * 3);
          n++;
        }
      }
      mesh.count = n; mesh.instanceMatrix.needsUpdate = true; if (dc) mesh.instanceColor.needsUpdate = true;
      return n;
    }
    const prev = scene.onBeforeRender;
    scene.onBeforeRender = function (r, s, cam, target) {
      prev.call(this, r, s, cam, target);
      if (target || !cam.isPerspectiveCamera) return;
      const p = cam.position;
      if (p.distanceToSquared(last) < C.REFILL_M * C.REFILL_M) return;
      last.copy(p);
      stats.nearCrowns = fill(near, gridC, p.x, p.y, p.z, C.FROM_M + C.REFILL_M + 12, cm, cc, false, C.NEAR_MAX);
      stats.nearTrunks = p.y > C.TRUNK_M ? (trunkNear.count = 0) : fill(trunkNear, gridT, p.x, p.y, p.z, C.TRUNK_M, tm, null, true, C.TRUNK_MAX);
    };
    stats.cards = list.length;
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
    const roundAll = [];   // (cards) [x, crown middle y, z, radius, half height, colour] of every round crown
    groups.forEach((name, gi) => {
      const list = rows[gi]; if (!list.length) return;
      const look = T.GROUPS[name] || T.GROUPS.broadleaf;
      const asCards = CARDS && look.shape === 'round';
      const crowns = asCards ? null : new THREE.InstancedMesh(SHAPES[look.shape](), nearShader(new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 })), list.length);
      new THREE.Color(look.color).getHSL(hsl);
      list.forEach(([x, z, r, h, v], i) => {
        r *= look.radius;
        const ch = Math.max(r * look.minAspect, h * look.crownShare);   // crown height
        trunkAll.push([x, z, r, h, ch]);
        c.setHSL(hsl.h + (v - 0.5) * T.HUE_VARIATION, hsl.s, THREE.MathUtils.clamp(hsl.l * (1 + (v - 0.5) * 2 * T.LIGHTNESS_VARIATION), 0, 1));
        if (asCards) { roundAll.push([x, h - ch / 2, z, r, ch / 2, c.clone()]); return; }
        M.compose(P.set(x, h - ch / 2, z), Q, S.set(r, ch / 2, r)); crowns.setMatrixAt(i, M);
        crowns.setColorAt(i, c);
      });
      stats[name] = list.length;
      if (asCards) return;
      crowns.castShadow = true; crowns.receiveShadow = true; crowns.computeBoundingSphere(); crowns.name = 'crowns ' + name; crowns.visible = !REAL;
      group.add(crowns);
    });
    const trunkGeo = new THREE.CylinderGeometry(0.75, 1, 1, 6, 1, true).translate(0, 0.5, 0);
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: T.TRUNK, roughness: 1 }), trunkAll.length);
    trunkAll.forEach(([x, z, r, h, ch], i) => {
      const tr = 0.12 + r * 0.025;
      M.compose(P.set(x, 0, z), Q, S.set(tr, Math.max(0.5, h - ch * T.TRUNK_TOP), tr)); trunks.setMatrixAt(i, M);
    });
    trunks.castShadow = true; trunks.receiveShadow = true; trunks.computeBoundingSphere(); trunks.name = 'trunks'; trunks.visible = !REAL;   // (the camera's trunk collision still reads its matrices)
    group.add(trunks);
    if (CARDS && roundAll.length) installCards(roundAll, trunkAll, trunks);
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
