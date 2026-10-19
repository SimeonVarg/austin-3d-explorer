// v2 street level near the camera (owner, 2026-10-18: "Can you get street level detail"), from v2/data/street/near.json
// (scripts/v2/street_near.py): modelled asphalt with the lane lines the photograph shows, kerbs with gutters, sidewalk slabs with
// joints, driveway aprons, lane-use arrows and street signs. Within NEAR.FADE these replace the aerial photograph on streets; past it
// they fade out and the photograph (sharp from 150 m up) carries the street. Everything is merged or instanced in 250 m squares.
//
// Rule 15: fine detail is procedural only where it is bigger than a pixel (the asphalt grain and the slab joints fade with the
// screen-space derivative), and nothing here is drawn past NEAR.FADE[1].
import { NEAR_LOOK as N } from './street-look.js';

const params = new URLSearchParams(location.search);
const DATA = new URL('./data/street/near.json', import.meta.url).href;

export function installStreetNear({ THREE, scene, redraw, phone = false }) {
  if (params.get('near') === '0') return null;
  const group = new THREE.Group(); group.name = 'street near';
  scene.add(group);
  const FADE = phone ? N.FADE_PHONE : N.FADE;
  const stats = { ready: false };

  // ── materials: alpha by distance from the camera; optional procedural grain / joints in world space ──
  function nearMaterial(color, { grain = 0, joints = false, opaqueDepth = false, roughness = 0.95 } = {}) {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, transparent: true, depthWrite: opaqueDepth,
      polygonOffset: !opaqueDepth, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vNearW;\nattribute float aS;\nvarying float vS;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvNearW = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvS = aS;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vNearW; varying float vS;
          float nHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float nNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(nHash(i), nHash(i + vec2(1, 0)), f.x), mix(nHash(i + vec2(0, 1)), nHash(i + vec2(1, 1)), f.x), f.y); }`)
        .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
          float nd = length(vViewPosition);
          diffuseColor.a *= 1.0 - smoothstep(${FADE[0].toFixed(1)}, ${FADE[1].toFixed(1)}, nd);
          #if ${grain > 0 ? 1 : 0}
            // two octaves of grain, each faded out before its cells get smaller than a pixel (rule 15)
            vec2 gp = vNearW.xz;
            float w1 = fwidth(gp.x * 4.0) + fwidth(gp.y * 4.0), w2 = fwidth(gp.x * 0.7) + fwidth(gp.y * 0.7);
            float g = (nNoise(gp * 4.0) - 0.5) * (1.0 - smoothstep(0.3, 0.8, w1)) + (nNoise(gp * 0.7) - 0.5) * (1.0 - smoothstep(0.3, 0.8, w2));
            diffuseColor.rgb *= 1.0 + ${grain.toFixed(3)} * g;
          #endif
          #if ${joints ? 1 : 0}
            float js = vS / ${N.JOINT_M.toFixed(2)};
            float jw = fwidth(js);
            float jl = 1.0 - smoothstep(0.0, max(jw, 1e-4) * 1.5 + 0.012, abs(fract(js + 0.5) - 0.5));
            diffuseColor.rgb *= 1.0 - ${N.JOINT_DARK.toFixed(2)} * jl * (1.0 - smoothstep(0.08, 0.3, jw));
          #endif`);
    };
    m.customProgramCacheKey = () => `v2-near-${grain}-${joints}-${FADE.join(',')}`;
    return m;
  }

  // ── geometry helpers: everything is pushed into per-square buckets and merged ──
  const SQ = 250;
  const buckets = new Map();   // key -> { [kind]: {pos, nrm, s, idx} }
  function buf(kind, x, z) {
    const k = Math.floor(x / SQ) + ',' + Math.floor(z / SQ);
    let b = buckets.get(k); if (!b) buckets.set(k, (b = {}));
    return b[kind] || (b[kind] = { pos: [], nrm: [], s: [], idx: [] });
  }
  // a flat strip along a polyline from offset o0 to o1 (n = (-dz, dx)), at height y, normal up; s = distance along
  function strip(kind, pts, o0, o1, y, s0 = 0) {
    const B = buf(kind, pts[0][0], pts[0][1]);
    let s = s0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / L, nz = (b[0] - a[0]) / L;
      if (i > 0) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      const v = B.pos.length / 3;
      B.pos.push(pts[i][0] + nx * o0, y, pts[i][1] + nz * o0, pts[i][0] + nx * o1, y, pts[i][1] + nz * o1);
      B.nrm.push(0, 1, 0, 0, 1, 0); B.s.push(s, s);
      if (i > 0) B.idx.push(v - 2, v - 1, v, v - 1, v + 1, v);
    }
    return s;
  }
  // a vertical face along a polyline at offset o, from y0 to y1, facing +n * facing
  function face(kind, pts, o, y0, y1, facing) {
    const B = buf(kind, pts[0][0], pts[0][1]);
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i], q = pts[i + 1], L = Math.hypot(q[0] - p[0], q[1] - p[1]); if (L < 1e-3) continue;
      const nx = -(q[1] - p[1]) / L, nz = (q[0] - p[0]) / L, v = B.pos.length / 3;
      const px = p[0] + nx * o, pz = p[1] + nz * o, qx = q[0] + nx * o, qz = q[1] + nz * o;
      B.pos.push(px, y0, pz, qx, y0, qz, qx, y1, qz, px, y1, pz);
      for (let k = 0; k < 4; k++) { B.nrm.push(nx * facing, 0, nz * facing); B.s.push(0); }
      B.idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
    }
  }
  const pairs = (a, from) => { const o = []; for (let i = from; i + 1 < a.length; i += 2) o.push([a[i], a[i + 1]]); return o; };

  async function build() {
    const d = await (await fetch(DATA)).json();
    const H = N.CURB_HEIGHT_M;
    // asphalt
    for (const r of d.roads) { const pts = pairs(r, 2); if (pts.length >= 2) strip('asphalt', pts, -r[0] / 2, r[0] / 2, N.ASPHALT_Y_M); }
    // lane lines (dashed: only the painted pieces)
    for (const l of d.lanes) {
      const [colour, style, phase, s0] = l, pts = pairs(l, 4), kind = colour ? 'yellow' : 'white';
      if (pts.length < 2) continue;
      if (!style) { strip(kind, pts, -N.LANE_W_M / 2, N.LANE_W_M / 2, N.PAINT_Y_M); continue; }
      const [on, off] = N.DASH_M, per = on + off;
      let s = s0;
      for (let i = 0; i < pts.length - 1; i++) {
        const p = pts[i], q = pts[i + 1], L = Math.hypot(q[0] - p[0], q[1] - p[1]);
        let t = 0;
        while (t < L) {
          const ph = ((s + t - phase) % per + per) % per;
          if (ph < on) {
            const len = Math.min(on - ph, L - t), a = t / L, b = (t + len) / L;
            strip(kind, [[p[0] + (q[0] - p[0]) * a, p[1] + (q[1] - p[1]) * a], [p[0] + (q[0] - p[0]) * b, p[1] + (q[1] - p[1]) * b]], -N.LANE_W_M / 2, N.LANE_W_M / 2, N.PAINT_Y_M);
            t += len + 1e-3;
          } else t += per - ph;
        }
        s += L;
      }
    }
    // kerbs: the road lies toward (dz, -dx) = -n; gutter on the road side, the face, a top on the sidewalk side
    for (const c of d.curbs) {
      const pts = pairs(c, 0); if (pts.length < 2) continue;
      strip('gutter', pts, -N.GUTTER_M, 0, N.GUTTER_Y_M);
      face('curb', pts, 0, 0, H, -1);
      strip('curb', pts, 0, N.CURB_TOP_M, H);
    }
    // sidewalk slabs (centre line, width) with joints, and their two side faces
    for (const w of d.walks) {
      const width = w[0], pts = pairs(w, 1); if (pts.length < 2) continue;
      strip('walk', pts, -width / 2, width / 2, H);
      face('curb', pts, width / 2, 0, H, 1); face('curb', pts, -width / 2, 0, H, -1);
    }
    const mats = {
      asphalt: nearMaterial(N.ASPHALT, { grain: N.ASPHALT_GRAIN }), white: nearMaterial(N.PAINT_WHITE), yellow: nearMaterial(N.PAINT_YELLOW),
      gutter: nearMaterial(N.GUTTER, { grain: N.CONCRETE_GRAIN }), curb: nearMaterial(N.CURB, { opaqueDepth: true }),
      walk: nearMaterial(N.WALK, { grain: N.CONCRETE_GRAIN, joints: true, opaqueDepth: true }),
    };
    const ORDER = { asphalt: 0.9, gutter: 0.92, white: 0.95, yellow: 0.95, curb: 0.97, walk: 0.98 };
    let draws = 0, tris = 0;
    for (const b of buckets.values()) for (const [kind, B] of Object.entries(b)) {
      if (!B.idx.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(B.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(B.nrm, 3));
      g.setAttribute('aS', new THREE.Float32BufferAttribute(B.s, 1));
      g.setIndex(B.idx); g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mats[kind]); m.renderOrder = ORDER[kind]; m.receiveShadow = true; m.name = 'near ' + kind;
      if (kind === 'curb' || kind === 'walk') m.side = THREE.DoubleSide;
      group.add(m); draws++; tris += B.idx.length / 3;
    }

    // ── arrows (flat, instanced per kind) and signs (posts and panels, instanced per kind) ──
    const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3(1, 1, 1), UP = new THREE.Vector3(0, 1, 0);
    function inst(name, geo, mat, rows, order) {
      if (!rows.length) return;
      const im = new THREE.InstancedMesh(geo, mat, rows.length);
      rows.forEach(([x, y, z, a, sx = 1, sy = 1, sz = 1], i) => { Q.setFromAxisAngle(UP, -a); M4.compose(P.set(x, y, z), Q, S.set(sx, sy, sz)); im.setMatrixAt(i, M4); });
      im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.receiveShadow = true; im.name = name;
      if (order != null) im.renderOrder = order;
      group.add(im); draws++;
    }
    const arrowShape = (kind) => {
      // drawn pointing +x, about 2.4 m long, in the ground plane (shape y = left of travel); kinds: 0 through, 1 left, 2 right,
      // 3 left+through, 4 right+through
      const shapes = [];
      const poly = (pts) => { const sh = new THREE.Shape(); sh.moveTo(...pts[0]); for (const p of pts.slice(1)) sh.lineTo(...p); sh.closePath(); shapes.push(sh); };
      const straight = kind === 0 || kind === 3 || kind === 4;
      poly([[-1.2, -0.09], [straight ? 0.6 : 0.09, -0.09], [straight ? 0.6 : 0.09, 0.09], [-1.2, 0.09]]);
      if (straight) poly([[0.6, -0.38], [1.2, 0], [0.6, 0.38]]);
      for (const side of [kind === 1 || kind === 3 ? 1 : 0, kind === 2 || kind === 4 ? -1 : 0]) {
        if (!side) continue;
        poly([[-0.09, 0.09 * side], [0.09, 0.09 * side], [0.09, 0.55 * side], [-0.09, 0.55 * side]].map(([x, y]) => [x - 0.3, y]));
        poly([[-0.68, 0.55 * side], [-0.3, 1.1 * side], [0.08, 0.55 * side]]);
      }
      return new THREE.ShapeGeometry(shapes).rotateX(-Math.PI / 2);   // shape y -> -z: left of travel stays left
    };
    const byKind = new Map();
    for (const [x, z, a, k] of d.arrows) { const kk = k <= 4 ? k : 0; (byKind.get(kk) || byKind.set(kk, []).get(kk)).push([x, N.PAINT_Y_M + 0.002, z, a]); }
    for (const [k, rows] of byKind) inst('arrows ' + k, arrowShape(k), nearMaterial(N.PAINT_WHITE), rows, 0.96);

    // signs: a post per location, panels stacked from the top; the face normal looks along the panel's angle
    const posts = [], panels = new Map();
    for (const s of d.signs) {
      const [x, z, n] = s; posts.push([x, 0, z, 0]);
      let y = N.SIGN_TOP_M;
      for (let i = 0; i < n; i++) {
        const k = s[3 + i * 2], a = s[4 + i * 2], spec = N.SIGNS[k] || N.SIGNS[0];
        const yy = k === 2 ? N.SIGN_BLADE_Y_M : (y -= spec.h + 0.08) + spec.h / 2;
        (panels.get(k) || panels.set(k, []).get(k)).push([x + Math.cos(a) * 0.06, yy, z + Math.sin(a) * 0.06, a]);
      }
    }
    const signMat = (c) => nearMaterial(c, { opaqueDepth: true, roughness: 0.6 });
    inst('sign posts', new THREE.CylinderGeometry(0.03, 0.03, N.SIGN_POST_M, 6).translate(0, N.SIGN_POST_M / 2, 0), signMat(N.SIGN_POST), posts);
    for (const [k, rows] of panels) {
      const spec = N.SIGNS[k] || N.SIGNS[0];
      let geo;
      if (spec.shape === 'octagon') geo = new THREE.CylinderGeometry(spec.w / 2, spec.w / 2, 0.02, 8).rotateZ(Math.PI / 2).rotateX(Math.PI / 8);
      else if (spec.shape === 'diamond') geo = new THREE.BoxGeometry(0.02, spec.h / Math.SQRT2, spec.w / Math.SQRT2).rotateX(Math.PI / 4);
      else if (spec.shape === 'triangle') geo = new THREE.CylinderGeometry(spec.w / 1.7, spec.w / 1.7, 0.02, 3).rotateZ(Math.PI / 2).rotateX(Math.PI / 2);
      else geo = new THREE.BoxGeometry(0.02, spec.h, spec.w);
      inst('signs ' + k, geo, signMat(spec.color), rows);
    }
    Object.assign(stats, { ready: true, draws, triangles: tris, ...(d.counts || {}) });
    redraw();
  }
  build().catch((e) => { stats.error = e.message; console.warn('[v2 near]', e.message); });

  // the near layer is street level: off when the camera is high (nothing of it would show, and it saves the draws)
  const prev = scene.onBeforeRender;
  let cam = null;
  // and a 250 m square whose nearest point is past the fade is not drawn at all (measured: 330 extra draws at street level without this)
  const cs = new THREE.Vector3();
  scene.onBeforeRender = function (r, s, c, t) {
    prev.call(this, r, s, c, t);
    if (t) return;
    // the group's own visibility belongs to others (Google mode hides every map layer by it): only its children are switched here
    cam = c; low = c.position.y < N.MAX_CAMERA_Y_M;
    for (const m of group.children) {
      if (!low) { m.visible = false; continue; }
      if (m.isInstancedMesh || !m.geometry.boundingSphere) { m.visible = true; continue; }
      cs.copy(m.geometry.boundingSphere.center);
      m.visible = cs.distanceTo(c.position) - m.geometry.boundingSphere.radius < FADE[1];
    }
  };
  let low = false;

  const api = { stats: () => ({ ...stats, low }), group };
  window.__v2near = api;
  return api;
}
