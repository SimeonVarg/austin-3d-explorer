// v2 street level near the camera (owner, 2026-10-18: "Can you get street level detail"), from v2/data/street/near.json
// (scripts/v2/street_near.py): modelled asphalt with the lane lines the photograph shows, kerbs with gutters, sidewalk slabs with
// joints, driveway aprons, validated lane-use arrows and street signs. The carriageway is opaque across the entire baked demo area;
// finer details fade with distance. Everything is merged or instanced; the asphalt is one shared draw.
//
// Rule 15: fine detail is procedural only where it is bigger than a pixel (the asphalt grain and the slab joints fade with the
// screen-space derivative). The opaque asphalt stays; fine detail is not drawn past NEAR.FADE[1].
import { NEAR_LOOK as N, SIDEWALK_LOOK as SWL } from './street-look.js';
import { loadSafeStreet } from './street-data.js';

const params = new URLSearchParams(location.search);
// grey concrete at the buildings' grade with the street one curb lower (street-look.js SIDEWALK_LOOK); ?sidewalk=0 = the old raised slab
const SW = SWL.ON && params.get('sidewalk') !== '0';
const DATA = new URL('./data/street/near.json', import.meta.url).href;
const DATA_OSM = new URL('./data/street/near_osm.json', import.meta.url).href;   // lane lines from OSM lane counts (ODbL)
// One road surface (scripts/v2/street_graph.py): carriageway union with junction fillets; kerbs, sidewalks, frontage and lane lines all
// derived from it. When it is there it replaces near.json's separately built roads, kerbs, walks, frontage and lanes.
const SURFACE = new URL('./data/street/surface.json', import.meta.url).href;
const SURFACE_OSM = new URL('./data/street/surface_osm.json', import.meta.url).href;

export function installStreetNear({ THREE, scene, redraw, phone = false }) {
  if (params.get('near') === '0') return null;
  const group = new THREE.Group(); group.name = 'street near';
  scene.add(group);
  if (SW) group.position.y = -SWL.ROAD_DROP_M;   // walk top at y = 0 (the base every building stands on), the street below it
  const FADE = phone ? N.FADE_PHONE : N.FADE;
  const stats = { ready: false };

  // ── materials: alpha by distance from the camera; optional procedural grain / joints in world space ──
  function nearMaterial(color, { grain = 0, joints = false, jointM = N.JOINT_M, jointDark = N.JOINT_DARK, jointHalf = 0.012, jointFade = [0.08, 0.3], opaqueDepth = false, roughness = 0.95, permanent = false } = {}) {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, transparent: !permanent, depthWrite: opaqueDepth || permanent,
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
          ${permanent ? '' : `diffuseColor.a *= 1.0 - smoothstep(${FADE[0].toFixed(1)}, ${FADE[1].toFixed(1)}, nd);
          if (diffuseColor.a < 0.01) discard;`}
          #if ${grain > 0 ? 1 : 0}
            // two octaves of grain, each faded out before its cells get smaller than a pixel (rule 15)
            vec2 gp = vNearW.xz;
            float w1 = fwidth(gp.x * 4.0) + fwidth(gp.y * 4.0), w2 = fwidth(gp.x * 0.7) + fwidth(gp.y * 0.7);
            float g = (nNoise(gp * 4.0) - 0.5) * (1.0 - smoothstep(0.3, 0.8, w1)) + (nNoise(gp * 0.7) - 0.5) * (1.0 - smoothstep(0.3, 0.8, w2));
            diffuseColor.rgb *= 1.0 + ${grain.toFixed(3)} * g;
          #endif
          #if ${joints ? 1 : 0}
            // the line is antialiased over its own pixel footprint and fades out before the slabs get a few pixels long (rule 15)
            float js = vS / ${jointM.toFixed(3)};
            float jw = fwidth(js);
            float jl = 1.0 - smoothstep(0.0, max(jw, 1e-4) * 1.5 + ${(jointHalf / jointM).toFixed(4)}, abs(fract(js + 0.5) - 0.5));
            diffuseColor.rgb *= 1.0 - ${jointDark.toFixed(2)} * jl * (1.0 - smoothstep(${jointFade[0].toFixed(4)}, ${jointFade[1].toFixed(4)}, jw));
          #endif`);
    };
    m.customProgramCacheKey = () => `v2-near-${grain}-${joints}-${jointM}-${jointDark}-${jointHalf}-${jointFade}-${permanent}-${FADE.join(',')}`;
    return m;
  }

  // ── geometry helpers: everything is pushed into per-square buckets and merged ──
  const SQ = 250;
  const buckets = new Map();   // key -> { [kind]: {pos, nrm, s, idx} }
  function buf(kind, x, z) {
    const k = kind === 'asphalt' ? 'all asphalt' : Math.floor(x / SQ) + ',' + Math.floor(z / SQ);
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
      const hp = typeof y1 === 'function' ? y1(px, pz) : y1, hq = typeof y1 === 'function' ? y1(qx, qz) : y1;
      B.pos.push(px, y0, pz, qx, y0, qz, qx, hq, qz, px, hp, pz);
      for (let k = 0; k < 4; k++) { B.nrm.push(nx * facing, 0, nz * facing); B.s.push(0); }
      B.idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
    }
  }
  // a flat strip whose outer edge varies: per point [x, z, outer offset], inner offset constant (offsets along n = (-dz, dx), signed)
  function stripVar(kind, pts, o0, y) {
    const B = buf(kind, pts[0][0], pts[0][1]);
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / L, nz = (b[0] - a[0]) / L;
      const v = B.pos.length / 3, o1 = pts[i][2];
      B.pos.push(pts[i][0] + nx * o0, y, pts[i][1] + nz * o0, pts[i][0] + nx * o1, y, pts[i][1] + nz * o1);
      B.nrm.push(0, 1, 0, 0, 1, 0); B.s.push(0, 0);
      if (i > 0) B.idx.push(v - 2, v - 1, v, v - 1, v + 1, v);
    }
  }
  const pairs = (a, from) => { const o = []; for (let i = from; i + 1 < a.length; i += 2) o.push([a[i], a[i + 1]]); return o; };

  async function build() {
    const useSurface = params.get('surface') !== '0';
    const [d, dOsm, surf, surfOsm, safe, safeOsm, signFaces] = await Promise.all([fetch(DATA).then((r) => r.json()), fetch(DATA_OSM).then((r) => r.json()).catch(() => null),
      useSurface ? fetch(SURFACE).then((r) => (r.ok ? r.json() : null)).catch(() => null) : null,
      useSurface ? fetch(SURFACE_OSM).then((r) => (r.ok ? r.json() : null)).catch(() => null) : null,
      loadSafeStreet('safe'), loadSafeStreet('safe_osm'),
      fetch(new URL('./data/street/sign_faces.json', import.meta.url)).then(r => r.ok ? r.json() : null).catch(() => null)]);
    // Fail closed: raw point inventories aren't safe render positions. OSM-derived arrows remain in the ODbL file.
    d.signs = safe?.signs || []; d.arrows = safeOsm?.arrows || [];
    const H = N.CURB_HEIGHT_M;
    if (surf) {
      const walkRows = surf.walk.flatMap((r, i) => surf.walk_panels?.[i] || [r]);
      const rampCells = new Map();
      for (const r of surf.walk_ramps || []) {
        const pts = pairs(r.region[0], 0), xs = pts.map(p => p[0]), zs = pts.map(p => p[1]);
        for (let x = Math.floor(Math.min(...xs) / 10); x <= Math.floor(Math.max(...xs) / 10); x++)
          for (let z = Math.floor(Math.min(...zs) / 10); z <= Math.floor(Math.max(...zs) / 10); z++) {
            const k = x + ',' + z; if (!rampCells.has(k)) rampCells.set(k, []); rampCells.get(k).push(r);
          }
      }
      const walkHeight = (x, z) => {
        let height = H;
        for (const r of rampCells.get(Math.floor(x / 10) + ',' + Math.floor(z / 10)) || []) {
          const dx = x - r.end[0], dz = z - r.end[1], along = dx * r.inward[0] + dz * r.inward[1];
          const width = Math.max(...pairs(r.region[0], 0).map(p => Math.abs((p[0] - r.end[0]) * -r.inward[1] + (p[1] - r.end[1]) * r.inward[0])));
          if (along >= -.2 && along <= r.length_m + .05 && Math.abs(dx * -r.inward[1] + dz * r.inward[0]) <= width + .05)
            height = Math.min(height, N.FRONT_Y_M + (H - N.FRONT_Y_M) * THREE.MathUtils.clamp(along / r.length_m, 0, 1));
        }
        return height;
      };
      // Polygons with holes: sidewalk slabs are raised; classified frontage stays at ground level.
      const poly = (kind, rings, y, alongAxis = false) => {
        const toV = (r) => { const o = []; for (let i = 0; i + 1 < r.length; i += 2) o.push(new THREE.Vector2(r[i], r[i + 1])); return o; };
        const outer = toV(rings[0]), holes = rings.slice(1).map(toV);
        if (outer.length < 3) return;
        let tris; try { tris = THREE.ShapeUtils.triangulateShape(outer, holes); } catch (e) { return; }
        const all = outer.concat(...holes), B = buf(kind, all[0].x, all[0].y), v0 = B.pos.length / 3;
        // s = distance along the polygon's longest outer edge, so the slab joints run across the walk (a linear function: exact per triangle)
        let ax = 1, az = 0;
        if (alongAxis) { let best = 0; for (let i = 0; i < outer.length; i++) { const a = outer[i], b = outer[(i + 1) % outer.length], L = Math.hypot(b.x - a.x, b.y - a.y);
          if (L > best) { best = L; ax = (b.x - a.x) / L; az = (b.y - a.y) / L; } } }
        for (const p of all) { B.pos.push(p.x, typeof y === 'function' ? y(p.x, p.y) : y, p.y); B.nrm.push(0, 1, 0); B.s.push(alongAxis ? p.x * ax + p.y * az : 0); }
        for (const t of tris) B.idx.push(v0 + t[0], v0 + t[2], v0 + t[1]);   // (x, z) shape -> faces up
      };
      for (const r of surf.asphalt) poly('asphalt', r, N.ASPHALT_Y_M);
      for (const r of walkRows) poly('walk', r, walkHeight, SW);
      for (const r of surf.kerb_tops || []) poly('curb', r, H + N.CURB_TOP_LIFT_M);
      // Close the complete slab boundary, including driveway ends and courtyard holes. No walls on tile seams.
      if (surf.solid_edges) for (const [rows, height] of [[walkRows, walkHeight], [surf.kerb_tops || [], H + N.CURB_TOP_LIFT_M]]) {
        const edges = new Map();
        for (const polygon of rows) for (const ring of polygon) {
          const pts = pairs(ring, 0);
          for (let i = 0; i < pts.length; i++) {
            const a = pts[i], b = pts[(i + 1) % pts.length], ka = a.join(','), kb = b.join(','), key = ka < kb ? ka + '|' + kb : kb + '|' + ka;
            const edge = edges.get(key); if (edge) edge.count++; else edges.set(key, { a, b, count: 1 });
          }
        }
        for (const e of edges.values()) if (e.count === 1 || typeof height !== 'function') face('curb', [e.a, e.b], 0, 0, height, 1);
      }
      for (const k of ['paving', 'lawn', 'mulch']) for (const r of surf[k] || []) poly(k, r, SW && SWL.FRONTAGE_AT_GRADE ? H - 0.004 : N.FRONT_Y_M);
      d.roads = []; d.fronts = []; d.walks = []; d.curbs = surf.kerbs; d.lanes = surf.lanes.concat((surfOsm && surfOsm.lanes) || []);
    } else if (dOsm && dOsm.lanes) d.lanes = d.lanes.concat(dOsm.lanes);
    // asphalt, kerb to kerb (the two kerbs are measured per side: street_near.py)
    for (const r of d.roads) { const pts = pairs(r, 3); if (pts.length >= 2) strip('asphalt', pts, r[0], r[1], N.ASPHALT_Y_M); }
    // the rest of the right-of-way to the building face: paving, lawn or mulch as the photograph shows, at sidewalk height
    const FRONT = ['paving', 'lawn', 'mulch', 'asphalt'];
    for (const f of d.fronts || []) {
      const pts = []; for (let i = 2; i + 2 < f.length; i += 3) pts.push([f[i], f[i + 1], f[i + 2]]);
      if (pts.length >= 2) stripVar(FRONT[f[0]] || 'paving', pts, f[1], f[0] === 3 ? N.ASPHALT_Y_M : H - 0.004);
    }
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
      if (!surf?.solid_edges) {
        face('curb', pts, 0, 0, H, -1);
        strip('curb', pts, 0, N.CURB_TOP_M, H);
      }
    }
    // sidewalk slabs (centre line, width) with joints, and their two side faces
    for (const w of d.walks) {
      const width = w[0], pts = pairs(w, 1); if (pts.length < 2) continue;
      strip('walk', pts, -width / 2, width / 2, H);
      face('curb', pts, width / 2, 0, H, 1); face('curb', pts, -width / 2, 0, H, -1);
    }
    const mats = {
      asphalt: nearMaterial(N.ASPHALT, { grain: N.ASPHALT_GRAIN, permanent: true }), white: nearMaterial(N.PAINT_WHITE), yellow: nearMaterial(N.PAINT_YELLOW),
      gutter: nearMaterial(SW ? SWL.GUTTER : N.GUTTER, { grain: N.CONCRETE_GRAIN }), curb: nearMaterial(SW ? SWL.CURB : N.CURB, { opaqueDepth: true }),
      walk: SW ? nearMaterial(SWL.WALK, { grain: SWL.WALK_GRAIN, joints: true, opaqueDepth: true, jointM: SWL.JOINT_M, jointDark: SWL.JOINT_DARK,
        jointHalf: SWL.JOINT_HALF_M, jointFade: [1 / SWL.JOINT_FADE_PX[0], 1 / SWL.JOINT_FADE_PX[1]] })
        : nearMaterial(N.WALK, { grain: N.CONCRETE_GRAIN, joints: true, opaqueDepth: true }),
      paving: nearMaterial(N.FRONT_PAVING, { grain: N.CONCRETE_GRAIN }), lawn: nearMaterial(N.FRONT_LAWN, { grain: N.LAWN_GRAIN }),
      mulch: nearMaterial(N.FRONT_MULCH, { grain: N.LAWN_GRAIN }),
    };
    mats.curb.side = THREE.DoubleSide; mats.walk.side = THREE.DoubleSide;
    const ORDER = { asphalt: 0.9, paving: 0.91, lawn: 0.91, mulch: 0.91, gutter: 0.92, white: 0.95, yellow: 0.95, curb: 0.97, walk: 0.98 };
    let draws = 0, tris = 0;
    for (const b of buckets.values()) for (const [kind, B] of Object.entries(b)) {
      if (!B.idx.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(B.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(B.nrm, 3));
      g.setAttribute('aS', new THREE.Float32BufferAttribute(B.s, 1));
      g.setIndex(B.idx); g.computeBoundingSphere();
      if (kind === 'walk' && surf?.walk_ramps?.length) g.computeVertexNormals();
      const m = new THREE.Mesh(g, mats[kind]); m.renderOrder = ORDER[kind]; m.receiveShadow = true; m.name = 'near ' + kind;
      group.add(m); draws++; tris += B.idx.length / 3;
    }

    // ── arrows (flat, instanced per kind) and signs (posts and panels, instanced per kind) ──
    const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3(1, 1, 1), UP = new THREE.Vector3(0, 1, 0);
    function inst(name, geo, mat, rows, order, shadow = false) {
      if (!rows.length) return;
      const im = new THREE.InstancedMesh(geo, mat, rows.length);
      rows.forEach(([x, y, z, a, sx = 1, sy = 1, sz = 1], i) => { Q.setFromAxisAngle(UP, -a); M4.compose(P.set(x, y, z), Q, S.set(sx, sy, sz)); im.setMatrixAt(i, M4); });
      im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.receiveShadow = true; im.name = name;
      if (order != null) im.renderOrder = order;
      im.castShadow = shadow;
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
    for (const [x, z, a, k] of d.arrows) { if (k < 0 || k > 4) continue; (byKind.get(k) || byKind.set(k, []).get(k)).push([x, N.PAINT_Y_M + 0.002, z, a]); }
    for (const [k, rows] of byKind) inst('arrows ' + k, arrowShape(k), nearMaterial(N.PAINT_WHITE), rows, 0.96);

    // signs: a post per location, panels stacked from the top; the face normal looks along the panel's angle
    const posts = [], panels = new Map(), inkBuckets = new Map();
    const atlas = signFaces ? await new Promise(resolve => new THREE.TextureLoader().load(new URL('./data/street/sign_glyphs.png',import.meta.url).href,resolve,undefined,()=>resolve(null))) : null;
    const faceMap = new Map((atlas ? signFaces.records : []).map((r, i) => [JSON.stringify(r), signFaces.faces[i]]));
    const glyphs = new Map(Object.entries(signFaces?.glyphs || {}));
    const inkColor = new THREE.Color();
    function inkPoly(points, triangles, x, z, a, yy, color, uv = null) {
      const key=Math.floor(x/SQ)+','+Math.floor(z/SQ);
      if (!inkBuckets.has(key)) inkBuckets.set(key,{pos:[],col:[],uv:[],idx:[]});
      const ink=inkBuckets.get(key);
      const start = ink.pos.length / 3, ca = Math.cos(a), sa = Math.sin(a); inkColor.set(color);
      points.forEach(([u, v], i) => {
        // Text right is -z when looking at a face whose normal is +x.
        ink.pos.push(x + ca * N.SIGN_INK_OFFSET_M + sa * u, yy + v, z + sa * N.SIGN_INK_OFFSET_M - ca * u);
        ink.col.push(inkColor.r, inkColor.g, inkColor.b); ink.uv.push(...(uv ? uv[i] : [-1,-1]));
      });
      ink.idx.push(...triangles.map(i => start + i));
    }
    function legend(text, spec, k, x, z, a, yy) {
      const white = k === 1 || k === 2;
      // White inset rim on stop/blade signs, red rim on the point-down yield sign.
      let rim;
      if (k === 1) rim = Array.from({length: 8}, (_,i) => { const q = (i + .5) * Math.PI / 4; return [Math.cos(q) * spec.w / 2, Math.sin(q) * spec.h / 2]; });
      else if (k === 3) rim = [[-spec.w / 2, spec.h / 2], [spec.w / 2, spec.h / 2], [0, -spec.h / 2]];
      else rim = [[-spec.w/2,-spec.h/2],[spec.w/2,-spec.h/2],[spec.w/2,spec.h/2],[-spec.w/2,spec.h/2]];
      const rimWidth = k === 3 ? N.SIGN_YIELD_BORDER_M : N.SIGN_BORDER_M;
      const sx = 1 - 2 * rimWidth / spec.w, sy = 1 - 2 * rimWidth / spec.h;
      const outer = rim.map(([u,v])=>[u*N.SIGN_BORDER_INSET,v*N.SIGN_BORDER_INSET]), inner = outer.map(([u,v])=>[u*sx,v*sy]);
      const points = outer.concat(inner), tris = [];
      for (let i=0;i<rim.length;i++) { const j=(i+1)%rim.length, n=rim.length; tris.push(i,j,n+i,j,n+j,n+i); }
      inkPoly(points,tris,x,z,a,yy,k===3?N.SIGN_RED:white?N.SIGN_WHITE:N.SIGN_INK);
      const widths = text.map(line => [...line].reduce((v,ch) => v+(glyphs.get(ch)?.advance || .5),0));
      const scale = Math.min(spec.w * (k===3?N.SIGN_YIELD_TEXT_FILL:N.SIGN_TEXT_FILL) / Math.max(...widths,1), spec.h * (k===3?N.SIGN_YIELD_TEXT_HEIGHT:N.SIGN_TEXT_FILL) / (text.length * N.SIGN_LINE_SPACING));
      text.forEach((line,i) => {
        let left = -widths[i]*scale/2;
        const baseline = (text.length-1)*N.SIGN_LINE_SPACING*scale/2 - i*N.SIGN_LINE_SPACING*scale - scale/2 + (k===3?spec.h*N.SIGN_YIELD_TEXT_RISE:0);
        for (const ch of line) {
          const g=glyphs.get(ch); if (!g) continue;
          if (ch !== ' ') {
            const [x0,y0,x1,y1]=g.bounds,[u0,v0,u1,v1]=g.uv;
            inkPoly([[x0,y0],[x1,y0],[x1,y1],[x0,y1]].map(([u,v])=>[left+u*scale,baseline+v*scale]),[0,1,2,0,2,3],x,z,a,yy,white?N.SIGN_WHITE:N.SIGN_INK,[[u0,v1],[u1,v1],[u1,v0],[u0,v0]]);
          }
          left+=g.advance*scale;
        }
      });
    }
    let drawnPanels = 0, omittedPanels = 0;
    for (const s of d.signs) {
      const [x, z, n] = s, faces = faceMap.get(JSON.stringify(s));
      if (!faces?.some(Boolean)) { omittedPanels += n; continue; }
      const stackHeight = faces.reduce((sum,face,i)=>sum+(face && s[3+i*2]!==2 ? (N.SIGNS[s[3+i*2]] || N.SIGNS[0]).h+N.SIGN_STACK_GAP_M : 0),0);
      const top = Math.max(N.SIGN_TOP_M,N.SIGN_CLEARANCE_M+stackHeight);
      const bladeY = Math.max(N.SIGN_BLADE_Y_M,top+N.SIGN_BLADE_GAP_M);
      const poleHeight = Math.max(N.SIGN_POST_M,faces.some((f,i)=>f && s[3+i*2]===2) ? bladeY+.1 : top+.05);
      posts.push([x, -0.1, z, 0, 1, poleHeight+0.1, 1]);
      let y = top;
      for (let i = 0; i < n; i++) {
        const k = s[3 + i * 2], a = s[4 + i * 2], spec = N.SIGNS[k] || N.SIGNS[0];
        if (!faces[i]) { omittedPanels++; continue; }
        const yy = k === 2 ? bladeY : (y -= spec.h + N.SIGN_STACK_GAP_M) + spec.h / 2;
        (panels.get(k) || panels.set(k, []).get(k)).push([x + Math.cos(a) * 0.06, yy, z + Math.sin(a) * 0.06, a]);
        legend(faces[i], spec, k, x, z, a, yy); drawnPanels++;
      }
    }
    const signMat = (c) => nearMaterial(c, { opaqueDepth: true, roughness: 0.6 });
    // a post's foot sits in the sidewalk slab (it starts below the slab's top), and it throws a shadow, so it reads as standing
    inst('sign posts', new THREE.CylinderGeometry(N.SIGN_POST_R_M, N.SIGN_POST_R_M, 1, 8).translate(0, 0.5, 0), signMat(N.SIGN_POST), posts, null, true);
    for (const [k, rows] of panels) {
      const spec = N.SIGNS[k] || N.SIGNS[0];
      let geo;
      if (spec.shape === 'octagon') geo = new THREE.CylinderGeometry(spec.w / 2, spec.w / 2, 0.02, 8).rotateZ(Math.PI / 2).rotateX(Math.PI / 8);
      else if (spec.shape === 'diamond') geo = new THREE.BoxGeometry(0.02, spec.h / Math.SQRT2, spec.w / Math.SQRT2).rotateX(Math.PI / 4);
      else if (spec.shape === 'triangle') {
        const shape = new THREE.Shape();shape.moveTo(-spec.w/2,spec.h/2);shape.lineTo(spec.w/2,spec.h/2);shape.lineTo(0,-spec.h/2);shape.closePath();
        geo = new THREE.ShapeGeometry(shape).rotateY(Math.PI/2);
      }
      else geo = new THREE.BoxGeometry(0.02, spec.h, spec.w);
      inst('signs ' + k, geo, signMat(spec.color), rows, null, true);
    }
    // OSM highway=bus_stop supports a BUS marker; no invented route number or operator name.
    let busPanels = 0;
    for (let i=0;atlas && i+5<=(safeOsm?.stops.length || 0);i+=5) {
      const [x,z,angle]=safeOsm.stops.slice(i,i+5), a=angle+Math.PI/2;
      inkPoly([[-.225,-.225],[.225,-.225],[.225,.225],[-.225,.225]],[0,1,2,0,2,3],x-Math.cos(a)*.065,z-Math.sin(a)*.065,a,2.6,N.SIGNS[0].color);
      legend(['BUS'],{w:0.45,h:0.45},0,x-Math.cos(a)*0.06,z-Math.sin(a)*0.06,a,2.6); busPanels++;
    }
    if (inkBuckets.size) {
      const mat = nearMaterial('#ffffff',{opaqueDepth:true}); mat.vertexColors=true; mat.side=THREE.DoubleSide;
      // The one atlas is linear data. Its signed distance is antialiased at the actual screen-pixel width.
      atlas.flipY=false;atlas.generateMipmaps=false;atlas.minFilter=THREE.LinearFilter;atlas.magFilter=THREE.LinearFilter;
      const compile=mat.onBeforeCompile;
      mat.onBeforeCompile=sh=>{
        compile(sh);sh.uniforms.uSignAtlas={value:atlas};
        sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nattribute vec2 aAtlas; varying vec2 vAtlas;').replace('#include <begin_vertex>','#include <begin_vertex>\nvAtlas=aAtlas;');
        sh.fragmentShader=sh.fragmentShader.replace('#include <common>','#include <common>\nuniform sampler2D uSignAtlas; varying vec2 vAtlas;').replace('#include <alphatest_fragment>',`#include <alphatest_fragment>
          if(vAtlas.x >= 0.0) { float d=texture2D(uSignAtlas,vAtlas).r;float w=max(fwidth(d),0.002);diffuseColor.a*=smoothstep(0.5-w,0.5+w,d); }
          if(diffuseColor.a<0.01)discard;`);
      };
      mat.customProgramCacheKey=()=> 'v2-sign-distance-atlas';
      for (const ink of inkBuckets.values()) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position',new THREE.Float32BufferAttribute(ink.pos,3));
        geo.setAttribute('color',new THREE.Uint8BufferAttribute(ink.col.map(v=>Math.round(v*255)),3,true));
        geo.setAttribute('aAtlas',new THREE.Int16BufferAttribute(ink.uv.map(v=>Math.round(v*32767)),2,true));
        geo.setIndex(ink.idx); geo.computeVertexNormals(); geo.computeBoundingSphere();
        geo.setAttribute('normal',new THREE.Int8BufferAttribute(Array.from(geo.attributes.normal.array,v=>Math.round(v*127)),3,true));
        const mesh = new THREE.Mesh(geo,mat);mesh.name='sign legends';mesh.renderOrder=1;group.add(mesh);draws++;
      }
    }
    Object.assign(stats, { ready: true, draws, triangles: tris, sign_panels: drawnPanels, bus_panels: busPanels, omitted_panels: omittedPanels, ...(d.counts || {}), sign_posts: posts.length, arrows: d.arrows.length });
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
    // Only the children are switched here; callers own the group's visibility.
    cam = c; low = c.position.y < N.MAX_CAMERA_Y_M;
    for (const m of group.children) {
      if (m.name === 'near asphalt') { m.visible = true; continue; }
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
