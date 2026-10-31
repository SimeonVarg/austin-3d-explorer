// v2 street lamps: the UT campus globe lamp and the cobra-head street light, one InstancedMesh per type.
//   v2/data/lamp_models.json  the two models, built in Blender (scripts/v2/lamp_models_blender.py, about 330 and 70 triangles)
//   v2/data/lamps.json        where each lamp stands (scripts/v2/lamps_bake.py: OpenStreetMap, ODbL, plus a few measured from photographs)
// ?lamps=0 leaves the layer out (nothing is fetched). window.__v2lamps.set(false|true) hides / shows it in a loaded page (A/B).
//
// Rule 15: a post 16 cm thick is under a pixel wide from about 150 m. Drawn as plain triangles it would be hit or missed pixel by pixel
// and crawl in motion. So, as v2/wires.js does for cables: each part is widened about its own axis until its thinnest dimension is at
// least MIN_HALF_PX * 2 pixels wide on screen, and its opacity is (true width) / (drawn width). A part thinner than a pixel covers on
// average exactly the share of each pixel it really covers and fades smoothly with distance. Not a blur: close up nothing changes.
// Phone: the CPU keeps only the lamps within reach of the camera in each mesh (count), so the GPU never draws the whole city's lamps.
import * as THREE from 'three';

// ── PARAMETERS (taste values: one-line edits) ───────────────────────────
export const LAMP_LOOK = {
  MIN_HALF_PX: 0.75,             // a part is never drawn narrower than 1.5 px (the rest goes into opacity)
  REACH_M: 650, REACH_M_PHONE: 380,           // lamps farther than this are not in the meshes at all
  FADE_M: [450, 640], FADE_M_PHONE: [260, 370], // and fade out over this range (before the reach)
  RECULL_M: 25,                  // re-pick the lamps in reach when the camera has moved this far
  ROUGHNESS: { post: 0.7, glass: 0.35, fitting: 0.6 },
  // night: the globes and the cobra lenses glow; linear radiance per unit of night (scaled by the moment's night and white balance)
  GLOW: [2.4e-3, 1.9e-3, 1.2e-3],
  GLOW_DAY: 0,                   // the globes are off by day
  // per part, the radius (m) the coverage is computed from, and the axis it is widened about: 0 = vertical (posts, globes),
  // 1 = horizontal along the arm (the cobra's arm and head, at ARM_Y)
  THICK: [{ post: 0.08, glass: 0.2, fitting: 0.08 }, { post: 0.11, glass: 0.06, fitting: 0.05 }],
  AXIS: [{ post: 0, glass: 0, fitting: 0 }, { post: 0, glass: 1, fitting: 1 }],
  ARM_Y: 8.87,
};

const params = new URLSearchParams(location.search);
const DATA = new URL('./data/', import.meta.url).href;
const PARTS = ['post', 'glass', 'fitting'];

function material(L, uRes, uGlow, uPale, fade) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, transparent: true, depthWrite: true });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uRes, uGlow, uPale, uMinHalfPx: { value: L.MIN_HALF_PX }, uFade: { value: new THREE.Vector2(...fade) },
      uArmY: { value: L.ARM_Y } });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 aLamp;          // x: part (0 post, 1 glass, 2 fitting), y: widening axis, z: true radius (m), w: roughness
attribute float aVar;          // per instance: 0 dark post, 1 pale post
uniform vec2 uRes; uniform float uMinHalfPx; uniform vec2 uFade; uniform float uArmY;
varying float vCov; varying float vGlass; varying float vPost; varying float vVar; varying float vRough;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  {
    vec4 baseV = modelViewMatrix * instanceMatrix * vec4(0.0, aLamp.y > 0.5 ? uArmY : 1.5, 0.0, 1.0);
    float dist = max(-baseV.z, 1e-3);
    float rPx = aLamp.z * projectionMatrix[1][1] * uRes.y * 0.5 / dist;
    float k = max(1.0, uMinHalfPx / max(rPx, 1e-4));
    if (aLamp.y < 0.5) transformed.xz *= k;                                   // about the post's vertical axis
    else { transformed.y = uArmY + (transformed.y - uArmY) * k; transformed.z *= k; }   // about the arm's axis
    vCov = (1.0 / k) * (1.0 - smoothstep(uFade.x, uFade.y, dist));
    if (vCov < 0.004) transformed = vec3(0.0);                                // gone: a degenerate triangle
    vGlass = aLamp.x == 1.0 ? 1.0 : 0.0; vPost = aLamp.x == 0.0 ? 1.0 : 0.0; vVar = aVar; vRough = aLamp.w;
  }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec3 uGlow; uniform vec3 uPale;
varying float vCov; varying float vGlass; varying float vPost; varying float vVar; varying float vRough;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
  diffuseColor.rgb = mix(diffuseColor.rgb, uPale, vPost * vVar);
  diffuseColor.a *= vCov;`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = vRough;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += uGlow * vGlass;');
  };
  m.customProgramCacheKey = () => 'v2-lamps-' + fade.join(',');
  return m;
}

function geometry(model, ti, L, palette) {
  const n = model.part.length, col = new Float32Array(n * 3), lamp = new Float32Array(n * 4), c = new THREE.Color();
  const partColor = ti === 0 ? ['post_dark', 'glass', 'fitting_dark'] : ['mast', 'glass', 'head'];
  for (let i = 0; i < n; i++) {
    const p = model.part[i], name = PARTS[p];
    c.set(palette[partColor[p]]).convertSRGBToLinear(); col.set([c.r, c.g, c.b], i * 3);
    lamp.set([p, L.AXIS[ti][name], L.THICK[ti][name], L.ROUGHNESS[name]], i * 4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(model.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(model.nrm, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aLamp', new THREE.BufferAttribute(lamp, 4));
  return g;
}

// night(): the app's current moment ({ nightK, wb }) or null; called before each draw
export async function installLamps({ scene, renderer, camera, phone = false, redraw = () => {}, night = () => null, L = LAMP_LOOK }) {
  if (params.get('lamps') === '0') return null;
  let models, data;
  try {
    [models, data] = await Promise.all([fetch(DATA + 'lamp_models.json').then((r) => r.json()), fetch(DATA + 'lamps.json').then((r) => r.json())]);
  } catch (e) { console.warn('[v2 lamps]', e.message); return null; }
  const S = data.stride || 6, rows = [];
  for (let i = 0; i + S <= data.lamps.length; i += S) rows.push(data.lamps.slice(i, i + S));
  const group = new THREE.Group(); group.name = 'street lamps';
  const uRes = { value: new THREE.Vector2(1, 1) }, uGlow = { value: new THREE.Vector3() };
  const pale = new THREE.Color(models.palette.post_pale).convertSRGBToLinear(), uPale = { value: new THREE.Vector3(pale.r, pale.g, pale.b) };
  const fade = phone ? L.FADE_M_PHONE : L.FADE_M, reach = phone ? L.REACH_M_PHONE : L.REACH_M;
  const mat = material(L, uRes, uGlow, uPale, fade);
  const types = models.types.map((model, ti) => {
    const mine = rows.filter((r) => r[4] === ti);
    const mesh = new THREE.InstancedMesh(geometry(model, ti, L, models.palette), mat, Math.max(1, mine.length));
    const aVar = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, mine.length)), 1);
    mesh.geometry.setAttribute('aVar', aVar);
    mesh.name = 'lamps ' + model.name; mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = true;
    mesh.renderOrder = 2; mesh.count = 0;
    group.add(mesh);
    return { mesh, aVar, rows: mine, tris: model.tris };
  });
  scene.add(group);

  // keep only the lamps within reach in each mesh (CPU, a few hundred rows: well under a millisecond)
  const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), ONE = new THREE.Vector3(1, 1, 1), UP = new THREE.Vector3(0, 1, 0);
  const last = new THREE.Vector3(Infinity, 0, 0), size = new THREE.Vector2();
  const stats = { total: rows.length, byType: types.map((t) => t.rows.length), inReach: 0, draws: types.length, counts: data.counts };
  function recull(cam) {
    if (cam.position.distanceTo(last) < L.RECULL_M) return;
    last.copy(cam.position); stats.inReach = 0;
    const r2 = reach * reach, cx = cam.position.x, cz = cam.position.z;
    for (const t of types) {
      let n = 0;
      for (const r of t.rows) {
        const dx = r[0] - cx, dz = r[2] - cz;
        if (dx * dx + dz * dz > r2) continue;
        Q.setFromAxisAngle(UP, -r[3]);       // our angle turns +x toward +z; three's +y rotation turns +x toward -z
        M4.compose(P.set(r[0], r[1], r[2]), Q, ONE); t.mesh.setMatrixAt(n, M4); t.aVar.array[n] = r[5]; n++;
      }
      t.mesh.count = n; t.mesh.instanceMatrix.needsUpdate = true; t.aVar.needsUpdate = true; stats.inReach += n;
    }
  }
  // before the scene is projected (so the new matrices and counts are what is drawn this frame); only for the app's own camera
  const prev = scene.onBeforeRender;
  scene.onBeforeRender = function (r, s, cam, rt) {
    if (prev) prev.call(this, r, s, cam, rt);
    if (cam !== camera || !group.visible) return;
    if (rt) uRes.value.set(rt.width, rt.height); else { r.getDrawingBufferSize(size); uRes.value.copy(size); }
    recull(cam);
    const M = night(), k = M && M.nightK > 0 ? M.nightK : 0, wb = (M && M.wb) || [1, 1, 1];
    for (let c = 0; c < 3; c++) uGlow.value.setComponent(c, L.GLOW[c] * wb[c] * (k + L.GLOW_DAY));
  };
  const api = {
    group, set(on) { group.visible = !!on; last.set(Infinity, 0, 0); redraw(); },
    stats: () => ({ ...stats, visible: group.visible, drawn: types.map((t) => t.mesh.count), trisInReach: types.reduce((a, t) => a + t.mesh.count * t.tris, 0) }),
  };
  window.__v2lamps = api;
  redraw();
  return api;
}
