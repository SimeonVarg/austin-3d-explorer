// The v2 street furniture, in 3D, from open data baked by scripts/v2/street_bake.py:
//   v2/data/street/city.json  (City of Austin)  crosswalk bars, stop lines, yield teeth, curbs, curb-ramp pads, signal poles
//   v2/data/street/osm.json   (OpenStreetMap, ODbL)  street lamps
// Everything is instanced or merged into a handful of draws. Rule 15: these are thin things (a 0.6 m bar, a 0.13 m pole, a 0.15 m curb),
// so each fades out with distance (flat things by alpha, upright things by shrinking to their foot) before it can get thinner than a
// pixel and flicker; beyond that the aerial photograph shows the same paint, mipmapped.
import { STREET_LOOK as S } from './street-look.js';

const params = new URLSearchParams(location.search);
const DATA = new URL('./data/street/', import.meta.url).href;

export function installStreet({ THREE, scene, redraw, phone = false }) {
  if (params.get('street') === '0') return null;
  const group = new THREE.Group(); group.name = 'street furniture';
  scene.add(group);
  const fade = phone ? S.FADE_PHONE : S.FADE;
  const stats = { ready: false };

  // flat things: alpha fades between fade.flat[0] and fade.flat[1] metres from the camera
  function flatMaterial(color) {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    m.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <alphatest_fragment>',
        `#include <alphatest_fragment>\n diffuseColor.a *= 1.0 - smoothstep(${fade.flat[0].toFixed(1)}, ${fade.flat[1].toFixed(1)}, length(vViewPosition));`);
    };
    m.customProgramCacheKey = () => 'v2-street-flat-' + fade.flat.join(',');
    return m;
  }
  // upright things: every part of a model shrinks toward the model's foot (aBase) between fade.up[0] and fade.up[1] metres
  function uprightMaterial(color, roughness = 0.6, metalness = 0.2) {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 aBase;')
        .replace('#include <project_vertex>', `
          vec4 wp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            wp = instanceMatrix * wp;
          #endif
          float kFade = 1.0 - smoothstep(${fade.up[0].toFixed(1)}, ${fade.up[1].toFixed(1)}, length((modelViewMatrix * vec4(aBase, 1.0)).xyz));
          wp.xyz = aBase + (wp.xyz - aBase) * kFade;
          vec4 mvPosition = modelViewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;`);
    };
    m.customProgramCacheKey = () => 'v2-street-up-' + fade.up.join(',');
    return m;
  }

  const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), SC = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  // instances of `geo` from rows of [x, z, angle(rad, from +x toward +z), sx, sy, sz, lift]; bases = the model's foot per instance
  function instanced(name, geo, mat, rows, bases, { shadow = false } = {}) {
    if (!rows.length) return null;
    const im = new THREE.InstancedMesh(geo, mat, rows.length);
    const base = new Float32Array(rows.length * 3);
    rows.forEach((r, i) => {
      Q.setFromAxisAngle(UP, -r[2]);   // three's +y rotation turns +x toward -z; our angle turns +x toward +z
      M4.compose(P.set(r[0], r[6] || 0, r[1]), Q, SC.set(r[3], r[4], r[5])); im.setMatrixAt(i, M4);
      const b = bases ? bases[i] : r; base[i * 3] = b[0]; base[i * 3 + 1] = 0; base[i * 3 + 2] = b[1];
    });
    geo = im.geometry;
    if (mat.customProgramCacheKey && mat.customProgramCacheKey().startsWith('v2-street-up')) geo.setAttribute('aBase', new THREE.InstancedBufferAttribute(base, 3));
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    im.castShadow = shadow; im.receiveShadow = true; im.name = name;
    group.add(im);
    return im;
  }
  // a geometry used only once per InstancedMesh (an InstancedMesh owns its own attributes for aBase)
  const box = (sx, sy, sz, ox = 0, oy = 0, oz = 0) => new THREE.BoxGeometry(sx, sy, sz).translate(ox, oy, oz);
  const cyl = (r0, r1, h, oy = 0, seg = 8) => new THREE.CylinderGeometry(r0, r1, h, seg, 1, false).translate(0, oy + h / 2, 0);
  const flatQuad = () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);   // 1 x 1 on the ground, x along the bar, z across

  const unflat = (a, n) => { const o = []; for (let i = 0; i + n <= a.length; i += n) o.push(a.slice(i, i + n)); return o; };

  async function build() {
    const [city, osm] = await Promise.all([fetch(DATA + 'city.json').then((r) => r.json()), fetch(DATA + 'osm.json').then((r) => r.json()).catch(() => null)]);

    // ── paint: crosswalk bars, stop lines, yield teeth (one draw) ──
    const bars = unflat(city.bars, 5).map(([x, z, a, L, w]) => [x, z, a, L, 1, w, S.PAINT_LIFT_M]);
    const paint = instanced('paint', flatQuad(), flatMaterial(S.PAINT), bars);
    if (paint) paint.renderOrder = 0.96;   // over street_near.js's asphalt (0.9), with its lane lines

    // (curbs: street_near.js draws kerbs, gutters and sidewalks near the camera, where a 15 cm step can be seen at all; the snapped
    //  curbs in city.json are kept for the record and its counts.)

    // ── curb ramps with a warning pad ──
    const pads = unflat(city.ramps, 4).filter((r) => r[3]).map(([x, z, a]) => [x + Math.cos(a) * 0.4, z + Math.sin(a) * 0.4, a + Math.PI / 2, S.PAD_M[0], 1, S.PAD_M[1], S.PAINT_LIFT_M]);
    const padMesh = instanced('ramp pads', flatQuad(), flatMaterial(S.PAD), pads);
    if (padMesh) padMesh.renderOrder = 0.99;

    // ── traffic signals: pole, mast arm, signal heads on the arm, a pedestrian head on every pole ──
    const sig = unflat(city.signals, 4);
    const poleRows = sig.map(([x, z, a]) => [x, z, a, 1, 1, 1]);
    // poles start below ground (inside the sidewalk slab), stand on a concrete footing and throw shadows: from 8 m up they read as standing
    instanced('signal poles', cyl(0.13, 0.17, S.SIGNAL_POLE_M + 0.3, -0.3), uprightMaterial(S.SIGNAL_METAL), poleRows, null, { shadow: true });
    instanced('signal footings', cyl(0.38, 0.42, 0.42, -0.1, 12), uprightMaterial(S.FOOTING, 0.9, 0), poleRows, null, { shadow: true });
    const arms = sig.filter((s) => s[3] > 0);
    instanced('signal arms', box(1, 0.18, 0.18, 0.5, S.SIGNAL_ARM_Y_M, 0), uprightMaterial(S.SIGNAL_METAL),
      arms.map(([x, z, a, L]) => [x, z, a, L, 1, 1]), null, { shadow: true });
    const heads = [], headBase = [];
    for (const [x, z, a, L] of arms) for (const f of S.SIGNAL_HEADS_AT) {
      heads.push([x + Math.cos(a) * L * f, z + Math.sin(a) * L * f, a, 1, 1, 1]); headBase.push([x, z]);
    }
    instanced('signal heads', box(0.3, 1.05, 0.3, 0, S.SIGNAL_ARM_Y_M - 0.62, 0), uprightMaterial(S.SIGNAL_HEAD, 0.5, 0.1), heads, headBase, { shadow: true });
    instanced('pedestrian heads', box(0.36, 0.36, 0.3, 0.2, 2.9, 0), uprightMaterial(S.SIGNAL_HEAD, 0.5, 0.1), poleRows);

    // (protected bike lanes: no posts. The City's bike-facility lines follow the street's centreline, not the lane, so posts drawn
    //  from them stood in the middle of Congress Avenue; 2026-10-18.)

    // ── street lamps (OpenStreetMap) ──
    if (osm && osm.lamps) {
      const L = unflat(osm.lamps, 3);
      const cobra = L.filter((l) => l[2] === 1), lantern = L.filter((l) => l[2] === 0);
      // a cobra head leans out toward the nearest road: no direction in the data, so it faces the direction of the nearest signal-free
      // street is unknown; a fixed bearing per lamp from its position keeps the field varied without pretending to know
      const ang = (x, z) => ((Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1) * Math.PI * 2;
      const cr = cobra.map(([x, z]) => [x, z, ang(x, z), 1, 1, 1]);
      instanced('lamp masts', cyl(0.09, 0.13, S.LAMP_MAST_M + 0.3, -0.3), uprightMaterial(S.LAMP_METAL), cr, null, { shadow: true });
      instanced('lamp arms', box(1.8, 0.1, 0.1, 0.9, S.LAMP_MAST_M - 0.1, 0), uprightMaterial(S.LAMP_METAL), cr);
      instanced('lamp heads', box(0.7, 0.16, 0.32, 1.85, S.LAMP_MAST_M - 0.18, 0), uprightMaterial(S.LAMP_HEAD, 0.4, 0.3), cr);
      const lr = lantern.map(([x, z]) => [x, z, 0, 1, 1, 1]);
      instanced('lantern posts', cyl(0.06, 0.09, S.LANTERN_POST_M + 0.3, -0.3), uprightMaterial(S.LAMP_METAL), lr, null, { shadow: true });
      instanced('lantern heads', box(0.34, 0.55, 0.34, 0, S.LANTERN_POST_M + 0.27, 0), uprightMaterial(S.LANTERN_GLASS, 0.3, 0.0), lr);
    }
    // ── bus stops and benches (OpenStreetMap): a shelter (roof, back and side glass on posts), a bench, a stop sign post ──
    if (osm && osm.stops) {
      const st = unflat(osm.stops, 5), bn = unflat(osm.benches || [], 3);
      // facing angle = toward the road; a shelter's open side faces it, set 0.8 m back from the stop point
      const back = (x, z, a, d) => [x - Math.cos(a) * d, z - Math.sin(a) * d];
      const shel = st.filter((s) => s[3]).map(([x, z, a]) => { const [bx, bz] = back(x, z, a, 0.8); return [bx, bz, a, 1, 1, 1]; });
      instanced('shelter roofs', box(1.6, 0.08, 3.6, 0, 2.5, 0), uprightMaterial(S.SHELTER_ROOF, 0.5, 0.3), shel);
      instanced('shelter backs', box(0.04, 1.9, 3.4, -0.75, 1.3, 0), uprightMaterial(S.SHELTER_GLASS, 0.15, 0.0), shel);
      instanced('shelter posts', box(0.08, 2.5, 3.5, -0.75, 1.25, 0).scale(1, 1, 1), uprightMaterial(S.SHELTER_FRAME, 0.5, 0.4), shel.map(([x, z, a]) => [x, z, a, 1, 1, 0.03]));
      const seats = [...st.filter((s) => s[4]).map(([x, z, a]) => { const [bx, bz] = back(x, z, a, 1.2); return [bx, bz, a, 1, 1, 1]; }),
        ...bn.map(([x, z, a]) => [x, z, a, 1, 1, 1])];
      instanced('bench seats', box(0.45, 0.06, 1.8, 0, 0.45, 0), uprightMaterial(S.BENCH, 0.7, 0.1), seats);
      instanced('bench backs', box(0.05, 0.4, 1.8, -0.22, 0.75, 0), uprightMaterial(S.BENCH, 0.7, 0.1), seats);
      instanced('stop poles', cyl(0.04, 0.04, 2.9), uprightMaterial(S.SIGNAL_METAL), st.map(([x, z, a]) => [x, z, a, 1, 1, 1]));
      instanced('stop flags', box(0.03, 0.45, 0.45, 0, 2.6, 0), uprightMaterial(S.STOP_FLAG, 0.5, 0.1), st.map(([x, z, a]) => [x, z, a + Math.PI / 2, 1, 1, 1]));
    }
    Object.assign(stats, { ready: true, ...(city.counts || {}), lamps: osm && osm.lamps ? osm.lamps.length / 3 : 0, draws: group.children.length });
    redraw();
  }
  build().catch((e) => { stats.error = e.message; console.warn('[v2 street]', e.message); });

  const api = { stats: () => ({ ...stats }), group };
  window.__v2street = api;
  return api;
}
