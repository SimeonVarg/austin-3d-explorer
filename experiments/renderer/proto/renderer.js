/**
 * proto/renderer.js - the core of "path A": a raw WebGL2 renderer for the authored apartment buildings.
 *
 * What it is: ONE vertex buffer, ONE index buffer, ONE small float texture (the chunk table), ONE
 * program, ONE state setup, and either ONE multi-draw call or one drawElements per visible run of
 * buildings. No scene graph, no per-object uniforms, no framework. It draws the same triangles the
 * three.js layer draws, lit by the same formula (MapLibre's fill-extrusion lighting, ported from the
 * vertex shader in js/slopes.js), from the same camera matrix.
 *
 * What it does NOT do (and the study says so): sun shadows, the glass reflection/night/window shading
 * in cityShade, the procedural wall patterns and surface detail (brick joints, tile noise, shop
 * interiors), the textured facade meshes, the depth fog. See docs/custom-renderer-study-2026-10-09.md
 * for what each of those costs to port.
 *
 * Matrix contract (js/slopes.js, contract point 1-3): the camera matrix takes LOCAL METRES (east,
 * north, up of the Tower) to clip space: mainMatrix * translate(originMerc) * scale(s, -s, s).
 * localMatrix() below builds exactly that from what a MapLibre custom layer is handed.
 *
 * Plain script (no imports, no build step): works as <script type=module> or in a worker.
 */

// ---------- tiny matrix helpers (column-major, like WebGL) ----------
export function mul(a, b) {            // a * b
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}
/** mainMatrix (mercator -> clip) composed with the origin translate and the one mirrored scale. */
export function localMatrix(mainMatrix, originMerc, metreInMerc) {
  const s = metreInMerc;
  const L = new Float64Array([s, 0, 0, 0, 0, -s, 0, 0, 0, 0, s, 0, originMerc.x, originMerc.y, originMerc.z, 1]);
  const M = new Float64Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let t = 0; for (let k = 0; k < 4; k++) t += mainMatrix[k * 4 + r] * L[c * 4 + k]; M[c * 4 + r] = t; }
  return Float32Array.from(M);
}
function planes(m) {                   // Gribb-Hartmann, normalised; m is column-major local->clip
  const p = [];
  const row = i => [m[i], m[4 + i], m[8 + i], m[12 + i]];
  const r0 = row(0), r1 = row(1), r2 = row(2), r3 = row(3);
  const add = (a, b, s) => { const v = [a[0] + s * b[0], a[1] + s * b[1], a[2] + s * b[2], a[3] + s * b[3]]; const l = Math.hypot(v[0], v[1], v[2]) || 1; p.push(v.map(x => x / l)); };
  add(r3, r0, 1); add(r3, r0, -1); add(r3, r1, 1); add(r3, r1, -1); add(r3, r2, 1); add(r3, r2, -1);
  return p;
}

// ---------- shaders ----------
const VERT = `#version 300 es
precision highp float;
precision highp int;
layout(location=0) in vec4 a_pos;      // int16 x,y,z (relative to the chunk centre), chunk id
layout(location=1) in vec4 a_nrm;      // int8 normal xyz, facet flag in w
layout(location=2) in vec4 a_day;      // u8 rgb, gradient x
layout(location=3) in vec4 a_gold;     // u8 rgb, gradient y (height term)
layout(location=4) in vec4 a_night;    // u8 rgb, surface kind
uniform mat4 u_matrix;
uniform sampler2D u_chunks;            // per chunk: centre.xyz, scale
uniform vec3 u_lightpos;
uniform vec3 u_lightcolor;
uniform float u_lightintensity;
uniform float u_vertical_gradient;
uniform float u_opacity;
uniform float u_roof_shade;
uniform float u_materialP;
uniform float u_facet_on, u_facet_ambient, u_facet_lo, u_facet_hi, u_facet_sin, u_facet_cos, u_sloped_max_z;
uniform vec2 u_gradScale;              // decode of the two gradient bytes
out vec4 v_color;
void main() {
  vec4 ch = texelFetch(u_chunks, ivec2(int(a_pos.w), 0), 0);
  vec3 position = ch.xyz + a_pos.xyz * ch.w;
  vec3 cDay = a_day.rgb, cGold = a_gold.rgb, cNight = a_night.rgb;
  vec2 aGrad = vec2(a_day.a * u_gradScale.x, a_gold.a * u_gradScale.y);
  float aFacet = a_nrm.w;
  vec3 color = (u_materialP <= 0.5) ? mix(cDay, cGold, u_materialP * 2.0) : mix(cGold, cNight, (u_materialP - 0.5) * 2.0);
  vec3 n = normalize(a_nrm.xyz);
  float az = abs(n.z);
  bool sloped = (aGrad.y == 0.0 && az > 0.02 && az < u_sloped_max_z);
  vec3 nl = n;
  if (u_facet_on > 0.5 && aFacet > 0.5 && sloped) {
    vec3 L = normalize(u_lightpos);
    float sinE = L.z, cosE = length(L.xy);
    vec2 sh = (cosE > 1e-4) ? L.xy / cosE : vec2(0.0, 1.0);
    vec2 nh = normalize(n.xy);
    float d = u_facet_sin * cosE * dot(nh, sh) + u_facet_cos * sinE;
    float A = u_facet_ambient;
    float lit = A + (1.0 - A) * max(0.0, d);
    float flat_ = A + (1.0 - A) * max(0.0, sinE);
    float t = clamp((lit / max(flat_, 1e-4) - u_facet_lo) / (u_facet_hi - u_facet_lo), 0.0, 1.0);
    float m = mix(u_facet_lo, u_facet_hi, t);
    color = (u_materialP <= 0.5) ? mix(cDay, cGold, u_materialP * 2.0) * m : mix(cGold * m, cNight, (u_materialP - 0.5) * 2.0);
    nl = vec3(0.0, 0.0, 1.0);
  }
  float colorvalue = color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
  color += vec3(0.03);
  float directional = clamp(dot(nl, u_lightpos), 0.0, 1.0);
  directional = mix(1.0 - u_lightintensity, max(1.0 - colorvalue + u_lightintensity, 1.0), directional);
  if (aGrad.y > 0.0 && n.y != 0.0) {
    directional *= (1.0 - u_vertical_gradient) + u_vertical_gradient * clamp(aGrad.x * sqrt(aGrad.y / 150.0), mix(0.7, 0.98, 1.0 - u_lightintensity), 1.0);
  }
  vec3 lit = clamp(color * directional * u_lightcolor, mix(vec3(0.0), vec3(0.3), vec3(1.0) - u_lightcolor), vec3(1.0));
  float k = sloped ? u_roof_shade : 1.0;
  v_color = vec4(lit * k, 1.0) * u_opacity;
  gl_Position = u_matrix * vec4(position, 1.0);
}`;
const FRAG = `#version 300 es
precision highp float;
in vec4 v_color;
out vec4 o;
void main() { o = v_color; }`;

function compile(gl, type, src) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s));
  return s;
}

/** Fetch the packed file pair. Returns { meta, vertices, indices } with typed views, plus timings. */
export async function loadPacked(base) {
  const t0 = performance.now();
  const meta = await (await fetch(base + '.json')).json();
  const t1 = performance.now();
  const buf = await (await fetch(base + '.bin')).arrayBuffer();
  const t2 = performance.now();
  const vertices = new Uint8Array(buf, 0, meta.vertexBytes);
  const indices = new (meta.indexType === 'u16' ? Uint16Array : Uint32Array)(buf, meta.indexOffset, meta.indexCount);
  const chunks = new Float32Array(buf, meta.chunkOffset, meta.chunkCount * 8);   // [cx,cy,cz,radius, indexStart, indexCount, 0, 0]
  const tab = new Float32Array(buf, meta.tableOffset, meta.chunkCount * 4);      // [cx,cy,cz,scale]
  return { meta, vertices, indices, chunks, tab, timings: { metaMs: t1 - t0, binMs: t2 - t1, bytes: buf.byteLength } };
}

export function createRenderer(gl, packed, opts = {}) {
  const t0 = performance.now();
  const { meta } = packed;
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(prog));
  const U = {}; for (const n of ['u_matrix', 'u_chunks', 'u_lightpos', 'u_lightcolor', 'u_lightintensity', 'u_vertical_gradient', 'u_opacity', 'u_roof_shade', 'u_materialP', 'u_facet_on', 'u_facet_ambient', 'u_facet_lo', 'u_facet_hi', 'u_facet_sin', 'u_facet_cos', 'u_sloped_max_z', 'u_gradScale']) U[n] = gl.getUniformLocation(prog, n);

  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  const vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, packed.vertices, gl.STATIC_DRAW);
  const S = meta.stride;
  const attr = (loc, size, type, norm, off) => { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, type, norm, S, off); };
  attr(0, 4, gl.SHORT, false, 0); attr(1, 4, gl.BYTE, true, 8); attr(2, 4, gl.UNSIGNED_BYTE, true, 12); attr(3, 4, gl.UNSIGNED_BYTE, true, 16); attr(4, 4, gl.UNSIGNED_BYTE, true, 20);
  const ibo = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, packed.indices, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, meta.chunkCount, 1, 0, gl.RGBA, gl.FLOAT, packed.tab);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const multi = opts.multiDraw === false ? null : gl.getExtension('WEBGL_multi_draw');
  const IT = meta.indexType === 'u16' ? gl.UNSIGNED_SHORT : gl.UNSIGNED_INT, IB = meta.indexType === 'u16' ? 2 : 4;
  const counts = new Int32Array(meta.chunkCount), offs = new Int32Array(meta.chunkCount);
  const uploadMs = performance.now() - t0;
  const stats = { draws: 0, chunksDrawn: 0, chunks: meta.chunkCount, triangles: 0, cullMs: 0, uploadMs, multiDraw: !!multi, frames: 0 };
  let cull = true;

  function draw(f) {
    const t = performance.now();
    gl.useProgram(prog);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(U.u_chunks, 0);
    gl.uniformMatrix4fv(U.u_matrix, false, f.matrix);
    gl.uniform3fv(U.u_lightpos, f.u.u_lightpos); gl.uniform3fv(U.u_lightcolor, f.u.u_lightcolor);
    gl.uniform1f(U.u_lightintensity, f.u.u_lightintensity); gl.uniform1f(U.u_vertical_gradient, f.u.u_vertical_gradient);
    gl.uniform1f(U.u_opacity, f.u.u_opacity); gl.uniform1f(U.u_roof_shade, f.u.u_roof_shade); gl.uniform1f(U.u_materialP, f.u.u_materialP);
    gl.uniform1f(U.u_facet_on, f.u.u_facet_on); gl.uniform1f(U.u_facet_ambient, f.u.u_facet_ambient); gl.uniform1f(U.u_facet_lo, f.u.u_facet_lo);
    gl.uniform1f(U.u_facet_hi, f.u.u_facet_hi); gl.uniform1f(U.u_facet_sin, f.u.u_facet_sin); gl.uniform1f(U.u_facet_cos, f.u.u_facet_cos);
    gl.uniform1f(U.u_sloped_max_z, f.u.u_sloped_max_z);
    gl.uniform2f(U.u_gradScale, meta.gradScale[0], meta.gradScale[1]);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
    gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);
    // CPU frustum culling over the chunk bounding spheres (a building = a chunk), then merge adjacent runs.
    const c0 = performance.now();
    let n = 0, tris = 0, shown = 0;
    const C = packed.chunks;
    const P = cull ? planes(f.matrix) : null;
    let runStart = -1, runCount = 0;
    const flush = () => { if (runCount) { counts[n] = runCount; offs[n] = runStart * IB; n++; tris += runCount / 3; } runStart = -1; runCount = 0; };
    for (let i = 0; i < meta.chunkCount; i++) {
      const o = i * 8, x = C[o], y = C[o + 1], z = C[o + 2], r = C[o + 3];
      let inside = true;
      if (P) for (let k = 0; k < 6; k++) { const q = P[k]; if (q[0] * x + q[1] * y + q[2] * z + q[3] < -r) { inside = false; break; } }
      if (!inside) { flush(); continue; }
      shown++;
      const s = C[o + 4], c = C[o + 5];
      if (runCount && runStart + runCount === s) runCount += c; else { flush(); runStart = s; runCount = c; }
    }
    flush();
    stats.cullMs = performance.now() - c0;
    if (multi) { if (n) multi.multiDrawElementsWEBGL(gl.TRIANGLES, counts, 0, IT, offs, 0, n); stats.draws = n ? 1 : 0; }
    else { for (let i = 0; i < n; i++) gl.drawElements(gl.TRIANGLES, counts[i], IT, offs[i]); stats.draws = n; }
    stats.chunksDrawn = shown; stats.triangles = tris; stats.frames++; stats.cpuMs = performance.now() - t;
    gl.bindVertexArray(null);
    return stats;
  }
  return { draw, stats, setCull(v) { cull = !!v; }, dispose() { gl.deleteBuffer(vbo); gl.deleteBuffer(ibo); gl.deleteTexture(tex); gl.deleteVertexArray(vao); gl.deleteProgram(prog); },
    bytes: { vertex: packed.vertices.byteLength, index: packed.indices.byteLength, table: packed.tab.byteLength } };
}

/**
 * Path A glue: a MapLibre CustomLayerInterface around the renderer. Add it with
 *   map.addLayer(makeMapLibreLayer({ packed, origin: [lng, lat], uniforms }), beforeId)
 * `uniforms` is the object of light values; in the real app they would come from the same
 * places js/slopes.js reads them today (map.style.light, the hour).
 */
export function makeMapLibreLayer({ id = 'proto-apartments', packed, origin, uniforms, maplibregl }) {
  let renderer = null, originMerc = null, scale = 0, map = null;
  return {
    id, type: 'custom', renderingMode: '3d',
    onAdd(m, gl) {
      map = m; originMerc = maplibregl.MercatorCoordinate.fromLngLat({ lng: origin[0], lat: origin[1] }, 0);
      scale = originMerc.meterInMercatorCoordinateUnits();
      renderer = createRenderer(gl, packed);
    },
    render(gl, args) {
      const M = args.defaultProjectionData && args.defaultProjectionData.mainMatrix; if (!M || !renderer) return;
      const u = typeof uniforms === 'function' ? uniforms(map) : uniforms;
      renderer.draw({ matrix: localMatrix(M, originMerc, scale), u });
    },
    onRemove() { renderer && renderer.dispose(); renderer = null; },
    get renderer() { return renderer; },
  };
}
