// The v2 street furniture, in 3D, from open data baked by scripts/v2/street_bake.py:
//   v2/data/street/city.json  (City of Austin)  crosswalk bars, stop lines, yield teeth, curbs, curb-ramp pads, signal poles
//   v2/data/street/safe_osm.json (OpenStreetMap, ODbL)  bus stops and benches (street lamps: v2/lamps.js)
// Everything is instanced or merged into a handful of draws. Rule 15: these are thin things (a 0.6 m bar, a 0.13 m pole, a 0.15 m curb),
// so each fades out with distance (flat things by alpha, upright things by shrinking to their foot) before it can get thinner than a
// pixel and flicker; beyond that the aerial photograph shows the same paint, mipmapped.
import { STREET_LOOK as S, SIDEWALK_LOOK as SWL } from './street-look.js';
import { loadSafeStreet } from './street-data.js';

const params = new URLSearchParams(location.search);
const ROAD_DROP = SWL.ON && params.get('sidewalk') !== '0' ? SWL.ROAD_DROP_M : 0;   // the street sits one curb below the walk (street_near.js)
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

  // THE NEAR SET (2026-11-11). Every kind here fades out by fade.flat[1] / fade.up[1] metres from the camera, but each was one mesh of
  // all its instances in the city, so every frame sent all of them to the GPU: 0.18 M triangles that drew nothing, 3.5 to 4.5 ms of
  // a 40 ms frame in the opening flight on the owner's Mac (a triangle of no size costs that GPU about what a visible one does). Now a
  // mesh holds only the instances inside its own fade distance of the camera; it is filled again each time the camera has moved
  // S.REFILL_M. From the air, past every fade distance, nothing is sent at all. Same picture.
  const NEAR = [], CELL = 120, cellKey = (x, z) => Math.floor(x / CELL) * 65536 + Math.floor(z / CELL);
  const lastFill = new THREE.Vector3(1e9, 0, 0);
  function fillNear(k, p) {
    const R = k.gone + S.REFILL_M, R2 = R * R - p.y * p.y, im = k.im, dm = im.instanceMatrix.array, ab = k.up ? im.geometry.attributes.aBase : null;
    let n = 0;
    if (R2 > 0) {
      const r = Math.sqrt(R2), i0 = Math.floor((p.x - r) / CELL), i1 = Math.floor((p.x + r) / CELL), j0 = Math.floor((p.z - r) / CELL), j1 = Math.floor((p.z + r) / CELL);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const cell = k.grid.get(i * 65536 + j); if (!cell) continue;
        for (const id of cell) {
          const dx = k.base[id * 3] - p.x, dz = k.base[id * 3 + 2] - p.z;
          if (dx * dx + dz * dz > R2) continue;
          dm.set(k.all.subarray(id * 16, id * 16 + 16), n * 16);
          if (ab) { ab.array[n * 3] = k.base[id * 3]; ab.array[n * 3 + 1] = 0; ab.array[n * 3 + 2] = k.base[id * 3 + 2]; }
          n++;
        }
      }
    }
    im.count = n; im.visible = n > 0;
    if (n) {
      im.instanceMatrix.clearUpdateRanges(); im.instanceMatrix.addUpdateRange(0, n * 16); im.instanceMatrix.needsUpdate = true;
      if (ab) { ab.clearUpdateRanges(); ab.addUpdateRange(0, n * 3); ab.needsUpdate = true; }
      im.boundingSphere.center.copy(p); im.boundingSphere.radius = R + 12;
    }
    return n;
  }
  const prevBefore = scene.onBeforeRender;
  scene.onBeforeRender = function (r, sc, cam, target) {
    prevBefore.call(this, r, sc, cam, target);
    if (target || !cam.isPerspectiveCamera || !NEAR.length) return;
    const p = cam.position;
    if (p.distanceToSquared(lastFill) < S.REFILL_M * S.REFILL_M) return;
    lastFill.copy(p);
    let n = 0; for (const k of NEAR) n += fillNear(k, p);
    stats.near = n;
  };

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
    const up = !!(mat.customProgramCacheKey && mat.customProgramCacheKey().startsWith('v2-street-up'));
    if (up) geo.setAttribute('aBase', new THREE.InstancedBufferAttribute(base.slice(), 3));
    im.castShadow = shadow; im.receiveShadow = true; im.name = name;
    // Only the instances that can be seen are drawn (NEAR below): the mesh starts empty and is filled round the camera.
    const grid = new Map();
    for (let i = 0; i < rows.length; i++) { const k = cellKey(base[i * 3], base[i * 3 + 2]); (grid.get(k) || grid.set(k, []).get(k)).push(i); }
    NEAR.push({ im, all: im.instanceMatrix.array.slice(), base, grid, up, gone: up ? fade.up[1] : fade.flat[1] });
    im.count = 0; im.visible = false; im.frustumCulled = false; im.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
    lastFill.x = 1e9;
    group.add(im);
    return im;
  }
  // a geometry used only once per InstancedMesh (an InstancedMesh owns its own attributes for aBase)
  const box = (sx, sy, sz, ox = 0, oy = 0, oz = 0) => new THREE.BoxGeometry(sx, sy, sz).translate(ox, oy, oz);
  const cyl = (r0, r1, h, oy = 0, seg = 8) => new THREE.CylinderGeometry(r0, r1, h, seg, 1, false).translate(0, oy + h / 2, 0);
  const flatQuad = () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);   // 1 x 1 on the ground, x along the bar, z across

  const unflat = (a, n) => { const o = []; for (let i = 0; i + n <= a.length; i += n) o.push(a.slice(i, i + n)); return o; };

  async function build() {
    const [city, osm, marks, safe] = await Promise.all([fetch(DATA + 'city.json').then((r) => r.json()), loadSafeStreet('safe_osm'),
      params.get('surface') !== '0' ? fetch(DATA + 'marks.json').then((r) => (r.ok ? r.json() : null)).catch(() => null) : null,
      loadSafeStreet('safe')]);
    city.signals = safe?.signals || [];
    // crossings, stop bars and ramp pads derived from the one road surface (scripts/v2/street_graph.py) replace the record-by-record ones
    if (marks) city.bars = marks.bars;

    // ── paint: crosswalk bars, stop lines, yield teeth (one draw) ──
    const bars = unflat(city.bars, 5).map(([x, z, a, L, w]) => [x, z, a, L, 1, w, S.PAINT_LIFT_M - ROAD_DROP]);   // on the street, one curb below the walk (SIDEWALK_LOOK)
    const paint = instanced('paint', flatQuad(), flatMaterial(S.PAINT), bars);
    if (paint) paint.renderOrder = 0.96;   // over street_near.js's asphalt (0.9), with its lane lines

    // (curbs: street_near.js draws kerbs, gutters and sidewalks near the camera, where a 15 cm step can be seen at all; the snapped
    //  curbs in city.json are kept for the record and its counts.)

    // ── curb ramps with a warning pad ──
    const pads = marks ? unflat(marks.pads, 3).map(([x,z,a]) => [x,z,a,S.PAD_M[0],1,S.PAD_M[1],S.CURB_HEIGHT_M - ROAD_DROP + S.PAINT_LIFT_M])
      : [];  // raw curb-ramp points aren't validated slab positions
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
    const headY = S.SIGNAL_ARM_Y_M - S.SIGNAL_HANGER_M - S.SIGNAL_HEAD_H_M / 2;
    instanced('signal heads', box(S.SIGNAL_HEAD_W_M, S.SIGNAL_HEAD_H_M, S.SIGNAL_HEAD_D_M, 0, headY, 0), uprightMaterial(S.SIGNAL_HEAD, 0.5, 0.1), heads, headBase, { shadow: true });
    instanced('signal hangers', box(0.07, S.SIGNAL_HANGER_M, 0.07, 0, S.SIGNAL_ARM_Y_M - S.SIGNAL_HANGER_M/2, 0), uprightMaterial(S.SIGNAL_METAL), heads, headBase);
    // Three unlit 12-inch lenses, all in one instanced vertex-colour draw. No invented signal phase.
    const lensPos=[], lensCol=[], lensIndex=[], color=new THREE.Color();
    S.SIGNAL_LENS_COLORS.forEach((c,j)=>{
      color.set(c);const y=headY+(1-j)*S.SIGNAL_LENS_STEP_M, z=S.SIGNAL_HEAD_D_M/2+.003;
      const start=lensPos.length/3;lensPos.push(0,y,z);lensCol.push(color.r,color.g,color.b);
      for(let i=0;i<=16;i++) { const a=i*Math.PI/8;lensPos.push(Math.cos(a)*S.SIGNAL_LENS_R_M,y+Math.sin(a)*S.SIGNAL_LENS_R_M,z);lensCol.push(color.r,color.g,color.b);if(i)lensIndex.push(start,start+i,start+i+1); }
    });
    const lensGeo=new THREE.BufferGeometry();lensGeo.setAttribute('position',new THREE.Float32BufferAttribute(lensPos,3));lensGeo.setAttribute('color',new THREE.Float32BufferAttribute(lensCol,3));lensGeo.setIndex(lensIndex);lensGeo.computeVertexNormals();
    const lensMat=uprightMaterial('#ffffff',.3,0);lensMat.vertexColors=true;
    instanced('signal lenses',lensGeo,lensMat,heads,headBase);
    instanced('pedestrian heads', box(0.36, 0.36, 0.3, 0.2, 2.9, 0), uprightMaterial(S.SIGNAL_HEAD, 0.5, 0.1), poleRows);

    // (protected bike lanes: no posts. The City's bike-facility lines follow the street's centreline, not the lane, so posts drawn
    //  from them stood in the middle of Congress Avenue; 2026-10-18.)

    // (street lamps: v2/lamps.js draws them, from v2/data/lamps.json, with models built in Blender; 2026-10-31)
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
      // The near batch draws the supported BUS face with its legend; a missing atlas leaves no blank flag.
    }
    Object.assign(stats, { ready: true, ...(city.counts || {}), signal_poles: sig.length, draws: group.children.length });
    redraw();
  }
  build().catch((e) => { stats.error = e.message; console.warn('[v2 street]', e.message); });

  const api = { stats: () => ({ ...stats }), group };
  window.__v2street = api;
  return api;
}
