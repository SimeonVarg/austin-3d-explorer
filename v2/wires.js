// Thin round parts of Blender builds (bridge cables, their sockets, rails) as screen-space ribbons (v2/data/wires.json).
//
// Why: a cable 5 cm thick is under a pixel wide from about 40 m away. As triangles it is sampled once per pixel and, in motion, breaks
// into a crawling dotted lattice (repo rule 15). Here each segment is a quad turned to face the screen. Its half width is the cable's
// true projected radius, but never less than MIN_HALF_PX, and its opacity is (true width) / (drawn width). So a cable thinner than a
// pixel covers on average exactly the share of each pixel it really covers, and it fades out smoothly with distance instead of
// flickering. Close up (wider than 2 * MIN_HALF_PX) it is drawn solid, shaded as a cylinder across its width.
// Not a blur: what is drawn is the cable's real coverage, at every distance.
import * as THREE from 'three';

// ── PARAMETERS ──────────────────────────────────────────────────────────
const MIN_HALF_PX = 0.75;     // a ribbon is never drawn narrower than 1.5 px (coverage below that goes into opacity)
const ROUGHNESS = 0.45;

const VERT_PARS = /* glsl */`
attribute vec3 aA; attribute vec3 aB; attribute float aSide; attribute float aEnd; attribute float aR;
uniform vec2 uRes; uniform float uMinHalfPx;
varying float vSide; varying float vCov; varying vec3 vN0; varying vec3 vBn;
`;
const VERT_PROJECT = /* glsl */`
vec4 mvA = modelViewMatrix * vec4(aA, 1.0), mvB = modelViewMatrix * vec4(aB, 1.0);
vec4 mvPosition = mix(mvA, mvB, aEnd);
vec4 cA = projectionMatrix * mvA, cB = projectionMatrix * mvB;
vec4 c = mix(cA, cB, aEnd);
vec2 sA = cA.xy / cA.w * uRes * 0.5, sB = cB.xy / cB.w * uRes * 0.5;
vec2 d = sB - sA; d = length(d) > 1e-4 ? normalize(d) : vec2(1.0, 0.0);
vec2 n = vec2(-d.y, d.x);
float rPx = aR * projectionMatrix[1][1] * uRes.y * 0.5 / max(c.w, 1e-3);
float hw = max(rPx, uMinHalfPx);
vCov = rPx / hw;
c.xy += n * aSide * hw * 2.0 / uRes * c.w;
gl_Position = c;
vec3 Tv = normalize(mvB.xyz - mvA.xyz), Vv = normalize(-mvPosition.xyz);
vN0 = normalize(Vv - Tv * dot(Vv, Tv)); vBn = normalize(cross(Tv, vN0)); vSide = aSide;
`;
const FRAG_PARS = /* glsl */`varying float vSide; varying float vCov; varying vec3 vN0; varying vec3 vBn;\n`;
const FRAG_NORMAL = /* glsl */`
float faceDirection = 1.0;
float sWire = clamp(vSide, -1.0, 1.0);
vec3 normal = normalize(vN0 * sqrt(max(1.0 - sWire * sWire, 0.0)) + vBn * sWire);
vec3 nonPerturbedNormal = normal;
`;

function material(kind, uRes) {
  const m = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(...kind.rgb, THREE.LinearSRGBColorSpace), metalness: kind.metal ?? 0.5,
    roughness: ROUGHNESS, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uRes = uRes; sh.uniforms.uMinHalfPx = { value: MIN_HALF_PX };
    sh.vertexShader = VERT_PARS + sh.vertexShader
      .replace('#include <begin_vertex>', 'vec3 transformed = mix(aA, aB, aEnd);')
      .replace('#include <project_vertex>', VERT_PROJECT);
    sh.fragmentShader = FRAG_PARS + sh.fragmentShader
      .replace('#include <normal_fragment_begin>', FRAG_NORMAL)
      .replace('#include <color_fragment>', '#include <color_fragment>\n\tdiffuseColor.a *= vCov;');
  };
  m.customProgramCacheKey = () => 'v2-wires';
  return m;
}

function geometry(segs) {
  const n = segs.length, A = new Float32Array(n * 12), B = new Float32Array(n * 12), side = new Float32Array(n * 4), end = new Float32Array(n * 4),
    r = new Float32Array(n * 4), idx = new Uint32Array(n * 6);
  segs.forEach((s, i) => {
    for (let k = 0; k < 4; k++) {
      A.set(s.slice(0, 3), (i * 4 + k) * 3); B.set(s.slice(3, 6), (i * 4 + k) * 3);
      side[i * 4 + k] = k & 1 ? 1 : -1; end[i * 4 + k] = k >> 1; r[i * 4 + k] = s[6];
    }
    idx.set([i * 4, i * 4 + 1, i * 4 + 3, i * 4, i * 4 + 3, i * 4 + 2], i * 6);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(A, 3));      // (three needs a position; the shader reads aA / aB)
  g.setAttribute('aA', new THREE.BufferAttribute(A, 3)); g.setAttribute('aB', new THREE.BufferAttribute(B, 3));
  g.setAttribute('aSide', new THREE.BufferAttribute(side, 1)); g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1)); g.setAttribute('aR', new THREE.BufferAttribute(r, 1));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

// scene: where the ribbons go; renderer: for the drawing buffer size (the shader works in pixels)
export async function installWires(scene, renderer, url = './data/wires.json') {
  let data;
  try { data = await (await fetch(url)).json(); } catch (e) { console.warn('[v2 wires]', e.message); return null; }
  const group = new THREE.Group(); group.name = 'wires';
  const uRes = { value: new THREE.Vector2(1, 1) }, size = new THREE.Vector2();
  let segments = 0;
  for (const [build, segs] of Object.entries(data.builds || {})) {
    data.kinds.forEach((kind, ki) => {
      const mine = segs.filter((s) => s[7] === ki); if (!mine.length) return;
      const mesh = new THREE.Mesh(geometry(mine), material(kind, uRes));
      mesh.name = `wires ${build} ${kind.name}`; mesh.frustumCulled = false; mesh.receiveShadow = true; mesh.renderOrder = 2;
      mesh.onBeforeRender = (r) => { r.getDrawingBufferSize(size); uRes.value.copy(size); };
      group.add(mesh); segments += mine.length;
    });
  }
  scene.add(group);
  return { group, segments };
}
