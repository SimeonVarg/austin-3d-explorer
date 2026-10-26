// One clay-tile roof for every campus building with a clay tile roof (2026-10-26).
//
// The owner's photographs show UT's roofs as red clay barrel tile with visible rows; the builders' plain colours (one per build, picked
// by eye or from a distant photo) drew them brown-grey to mauve on almost every campus building. The fix is one material, taken from
// his clearest roof photograph (LOOK.CLAY.SOURCE), applied to every clay roof at draw time. No tile is rebuilt:
//   - which surfaces are clay roof: v2/data/roof_glass.json (scripts/v2/roof_glass_data.mjs) lists, per campus building, the palette
//     colours of its clay roof material (found by the builders' material names in its export). When a tile loads, each vertex of the
//     tile's palette mesh is checked: its building (_BUILDING) and its palette colour; a match marks it (attribute v2clay).
//   - how it is drawn: on a pitched face the texture runs in the roof's own plane (u along the eave, level; v up the slope), at the
//     measured barrel spacing and course pitch, so the rows lie as on the roof; on steep parts (caps, ridge sides) the texture's mean.
// Rule 15 (no shimmer, blur is not a fix): the rows are a texture with full mip maps and anisotropic filtering, so far away a pixel is
// the true average of the rows under it (the mip chain IS the box filter), with no small negative bias to keep it at a texel per pixel.
// Every taste value is in LOOK.CLAY (rule 11). ?clay=0 turns it off.
import * as THREE from 'three';
import { LOOK } from './look.js';

const C = LOOK.CLAY;
export const clayState = { tiles: 0, vertices: 0, ms: 0 };
let data = null;
export function setRoofGlassData(d) { data = d; }

let tex = null;
function clayTexture(renderer) {
  if (tex) return tex;
  tex = new THREE.TextureLoader().load(new URL(C.TEXTURE, import.meta.url).href, () => { tex.needsUpdate = true; });
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = renderer ? Math.min(C.ANISOTROPY, renderer.capabilities.getMaxAnisotropy()) : C.ANISOTROPY;
  return tex;
}

// the palette image's pixels (a GLB's ImageBitmap or img): read once per material
function pixels(image) {
  const w = image.width, h = image.height;
  const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(image, 0, 0);
  return { w, h, d: g.getImageData(0, 0, w, h).data };
}

const f = (x) => Number(x).toFixed(5);
// the material patch, shared by every tile's palette material (one program)
const RGID = typeof location !== 'undefined' && new URLSearchParams(location.search).get('rgid') === '1';   // measuring: clay roofs drawn pure cyan
function patch(material, map) {
  if (material.userData.v2Clay) return;
  material.userData.v2Clay = true;
  const prev = material.onBeforeCompile;
  const uniforms = { v2ClayMap: { value: map } };
  material.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float v2clay;\nvarying float vV2Clay;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvV2Clay = v2clay;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D v2ClayMap;\nvarying float vV2Clay;')
      .replace('#include <color_fragment>', `#include <color_fragment>
  if (vV2Clay > 0.25) {
    // the face's own plane, from the world position's derivatives (exact per triangle, either winding)
    vec3 v2wp = cameraPosition + (vec4(-vViewPosition, 0.0) * viewMatrix).xyz;
    vec3 v2n = normalize(cross(dFdx(v2wp), dFdy(v2wp)));
    if (v2n.y < 0.0) v2n = -v2n;
    vec3 v2t1 = cross(vec3(0.0, 1.0, 0.0), v2n);
    float v2l = length(v2t1);
    // pitched: from PITCH_NY[0] (steep) to PITCH_NY[1] (nearly flat) the rows show; elsewhere the texture's mean
    float v2pitch = step(0.75, vV2Clay) * smoothstep(${f(C.PITCH_NY[0])}, ${f(C.PITCH_NY[0] + 0.1)}, v2n.y) * (1.0 - smoothstep(${f(C.PITCH_NY[1])}, ${f(Math.min(0.9999, C.PITCH_NY[1] + 0.01))}, v2n.y));
    vec3 v2c = vec3(${C.MEAN.map(f).join(', ')});
    if (v2l > 1e-3 && v2pitch > 0.0) {
      v2t1 /= v2l;
      vec3 v2t2 = cross(v2n, v2t1);          // up the slope, in the roof's plane
      vec2 v2uv = vec2(dot(v2wp, v2t1) / ${f(C.REPEAT_M[0])}, dot(v2wp, v2t2) / ${f(C.REPEAT_M[1])});
      vec3 v2tex = texture2D(v2ClayMap, v2uv).rgb * vec3(${C.FACTOR.map(f).join(', ')});
      v2c = mix(v2c, v2tex, v2pitch);
    }
    diffuseColor.rgb = v2c;
  }`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  if (vV2Clay > 0.25) roughnessFactor = ${f(C.ROUGHNESS)};`);
    if (RGID) sh.fragmentShader = sh.fragmentShader.replace('#include <dithering_fragment>', '#include <dithering_fragment>\n  if (vV2Clay > 0.25) gl_FragColor = vec4(0.0, 1.0, 1.0, 1.0);');
  };
  const key = material.customProgramCacheKey ? material.customProgramCacheKey.bind(material) : () => '';
  material.customProgramCacheKey = () => key() + '|v2-clay' + (RGID ? '-id' : '');
  material.needsUpdate = true;
}

// a loaded tile: mark its clay roof vertices (255: rows; 128: the colour only, data.meanOnly) and patch their material
export function clayPrepare(obj, def, renderer) {
  if (!C.ON || !data || !def) return;
  const t0 = performance.now();
  // the clay colours of the buildings in this tile, by building index
  const want = new Map();
  const meanOnly = new Set(data.meanOnly || []), level = new Map();
  (def.buildings || []).forEach((s, i) => { const cs = data.clay && data.clay[s]; if (cs && cs.length) { want.set(i, cs); level.set(i, meanOnly.has(s) ? 128 : 255); } });
  if (!want.size) return;
  let marked = 0;
  obj.traverse((o) => {
    if (!o.isMesh || Array.isArray(o.material)) return;
    const m = o.material, map = m.map, g = o.geometry;
    if (!map || !map.image || !/^Palette/.test(m.name || '') || m.userData.v2_kind === 'glass') return;
    const uv = g.attributes.uv, b = g.attributes._building;
    if (!uv || !b) return;
    const px = pixels(map.image);
    map.updateMatrix();
    const e = map.matrix.elements, n = uv.count, mark = new Uint8Array(n);
    let any = 0;
    for (let i = 0; i < n; i++) {
      const bi = Math.round(b.getX(i)), cs = want.get(bi);
      if (!cs) continue;
      const u0 = uv.getX(i), v0 = uv.getY(i);
      const u = e[0] * u0 + e[3] * v0 + e[6], v = e[1] * u0 + e[4] * v0 + e[7];
      const x = Math.min(px.w - 1, Math.max(0, Math.floor(u * px.w))), y = Math.min(px.h - 1, Math.max(0, Math.floor(v * px.h)));
      const k = (y * px.w + x) * 4, r = px.d[k], gg = px.d[k + 1], bb = px.d[k + 2];
      for (const c of cs) if (Math.abs(c[0] - r) <= 2 && Math.abs(c[1] - gg) <= 2 && Math.abs(c[2] - bb) <= 2) { mark[i] = level.get(bi); any++; break; }
    }
    if (!any) return;
    g.setAttribute('v2clay', new THREE.BufferAttribute(mark, 1, true));
    patch(m, clayTexture(renderer));
    marked += any;
  });
  if (marked) { clayState.tiles++; clayState.vertices += marked; }
  clayState.ms += performance.now() - t0;
}
