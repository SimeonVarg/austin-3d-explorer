/**
 * lab.js - the facade-shader study page. Draws ONE authored tower two ways from the same camera:
 *   arm A  "geometry": the app's own triangles for the tower's window wall (42,252 of them), in the renderer
 *          study's 24-byte vertex, lit by the app's own per-vertex lighting formula.
 *   arm B  "shader":   one flat quad per wall (98 quads) and a fragment shader that computes the window grid from
 *          the recipe's numbers, box-filtered analytically over each pixel's footprint, with the window's recess
 *          (the reveal) done as an exact parallax shift, lit by the same formula.
 * The podium and crown (3,333 triangles) are drawn identically in both arms, marked alpha 0.5, so the metrics can
 * leave them out.
 *
 * Everything the page can measure is behind window.__lab (see the end of the file). Plain WebGL2, no libraries.
 */
const FIX = new URL('../fixture/dobie-twenty21', import.meta.url).href;
const $log = document.getElementById('log');
const log = s => { $log.textContent += s + '\n'; };

async function gunzip(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + ' ' + r.status);
  const ds = r.body.pipeThrough(new DecompressionStream('gzip'));
  return await new Response(ds).arrayBuffer();
}

// ------------------------------------------------------------------------------------------------ small matrix helpers (column-major)
const mul = (a, b) => { const o = new Float32Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; };
const persp = (fovy, asp, n, f) => { const t = 1 / Math.tan(fovy / 2); return new Float32Array([t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, 2 * f * n / (n - f), 0]); };
function lookAt(e, c, up) {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], nrm = a => { const l = Math.hypot(...a); return a.map(x => x / l); }, cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const f = nrm(sub(c, e)), s = nrm(cross(f, up)), u = cross(s, f);
  return new Float32Array([s[0], u[0], -f[0], 0, s[1], u[1], -f[1], 0, s[2], u[2], -f[2], 0, -dot(s, e), -dot(u, e), dot(f, e), 1]);
}

// ------------------------------------------------------------------------------------------------ shaders
// The app's per-vertex lighting (js/slopes.js, MapLibre's fill-extrusion formula), for one colour triple and one normal.
const SHADE = `
uniform vec3 u_lightpos; uniform vec3 u_lightcolor; uniform float u_lightintensity; uniform float u_materialP; uniform float u_opacity;
vec3 shadeTone(vec3 cDay, vec3 cGold, vec3 cNight, vec3 n) {
  vec3 color = (u_materialP <= 0.5) ? mix(cDay, cGold, u_materialP * 2.0) : mix(cGold, cNight, (u_materialP - 0.5) * 2.0);
  float colorvalue = color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
  color += vec3(0.03);
  float directional = clamp(dot(n, u_lightpos), 0.0, 1.0);
  directional = mix(1.0 - u_lightintensity, max(1.0 - colorvalue + u_lightintensity, 1.0), directional);
  vec3 lit = clamp(color * directional * u_lightcolor, mix(vec3(0.0), vec3(0.3), vec3(1.0) - u_lightcolor), vec3(1.0));
  return lit * u_opacity;
}`;
const GEO_VS = `#version 300 es
precision highp float; precision highp int;
layout(location=0) in vec4 a_pos; layout(location=1) in vec4 a_nrm; layout(location=2) in vec4 a_day; layout(location=3) in vec4 a_gold; layout(location=4) in vec4 a_night; layout(location=5) in vec3 a_inst;
uniform mat4 u_matrix; uniform vec3 u_centre; uniform float u_scale; uniform vec2 u_shift;
${SHADE}
out vec3 v_color;
void main() {
  vec3 position = u_centre + a_pos.xyz * u_scale + a_inst;
  v_color = shadeTone(a_day.rgb, a_gold.rgb, a_night.rgb, normalize(a_nrm.xyz));
  gl_Position = u_matrix * vec4(position, 1.0); gl_Position.xy += u_shift * gl_Position.w;
}`;
const GEO_FS = `#version 300 es
precision highp float; in vec3 v_color; uniform float u_alpha; uniform float u_count; out vec4 o;
void main() { o = u_count > 0.0 ? vec4(u_count, 0.0, 0.0, 1.0) : vec4(v_color, u_alpha); }`;

const FAC_VS = `#version 300 es
precision highp float; precision highp int;
layout(location=0) in vec3 a_pos; layout(location=1) in vec3 a_nrm; layout(location=2) in vec2 a_sz; layout(location=3) in vec4 a_bay; layout(location=4) in float a_i1; layout(location=5) in vec3 a_inst;
uniform mat4 u_matrix; uniform vec2 u_shift;
uniform vec3 u_fDay, u_fGold, u_fNight, u_gDay, u_gGold, u_gNight, u_rDay, u_rGold, u_rNight;
${SHADE}
out vec2 v_sz; out vec3 v_wp; flat out vec4 v_bay; flat out float v_i1; flat out vec3 v_n; flat out vec3 v_litW; flat out vec3 v_litG; flat out vec3 v_litR;
void main() {
  vec3 p = a_pos + a_inst; vec3 n = normalize(a_nrm);
  v_sz = a_sz; v_wp = p; v_bay = a_bay; v_i1 = a_i1; v_n = n;
  v_litW = shadeTone(u_fDay, u_fGold, u_fNight, n); v_litG = shadeTone(u_gDay, u_gGold, u_gNight, n); v_litR = shadeTone(u_rDay, u_rGold, u_rNight, n);
  gl_Position = u_matrix * vec4(p, 1.0); gl_Position.xy += u_shift * gl_Position.w;
}`;
const FAC_FS = `#version 300 es
precision highp float;
in vec2 v_sz; in vec3 v_wp; flat in vec4 v_bay; flat in float v_i1; flat in vec3 v_n; flat in vec3 v_litW; flat in vec3 v_litG; flat in vec3 v_litR;
uniform vec3 u_cam;
uniform vec4 u_win;          // pitch (floor to floor), sill, height, rows
uniform float u_reveal;      // metres the glass sits behind the wall
uniform float u_aa;          // footprint multiplier: 1 = a pixel-wide box (taste value)
uniform float u_parallax;    // 1 = the recess is drawn, 0 = flat glass
uniform float u_alpha;
uniform float u_count;       // > 0: write this value instead of a colour (overdraw counting)
uniform float u_kernel;      // 0: box filter, 1: tent (triangle) filter
out vec4 o;
// integral from 0 to x of a train of pulses [i*P + a, i*P + b], i in [i0, i1): closed form, no loop
float cum(float x, float P, float a, float b, float i0, float i1) {
  if (i1 <= i0 || x <= 0.0 || b <= a) return 0.0;
  float k = floor(x / P);
  float c = (clamp(k, i0, i1) - i0) * (b - a);
  if (k >= i0 && k < i1) c += clamp(x - k * P - a, 0.0, b - a);
  return c;
}
// the pulse train averaged over a box [x - h, x + h]: 0..1. This is the whole anti-aliasing: nothing is sampled.
float cov(float x, float h, float P, float a, float b, float i0, float i1) {
  h = max(h, 1e-4);
  return (cum(x + h, P, a, b, i0, i1) - cum(x - h, P, a, b, i0, i1)) / (2.0 * h);
}
// the integral of cum(): lets a TENT kernel (triangle filter) be a closed form too: tent(x, h) = (C2(x+h) - 2 C2(x) + C2(x-h)) / h^2
float cum2(float x, float P, float a, float b, float i0, float i1) {
  if (i1 <= i0 || x <= 0.0 || b <= a) return 0.0;
  float w = b - a, n = i1 - i0, k = floor(x / P), r = x - k * P;
  float R = 0.5 * w * w + w * (P - b);
  float m = clamp(k, i0, i1) - i0;
  float full = P * w * 0.5 * m * (m - 1.0) + R * m;                       // whole periods that carry a pulse: sum of (i - i0) w P + R
  if (k > i1) full += (k - i1) * n * w * P;                               // whole periods after the last pulse: cum is flat at n w
  float ck = (k <= i0) ? 0.0 : (k >= i1 ? n * w : (k - i0) * w);         // cum at the start of this period
  float part = ck * r;
  if (k >= i0 && k < i1) part += (r <= a) ? 0.0 : (r <= b ? 0.5 * (r - a) * (r - a) : 0.5 * w * w + w * (r - b));
  return full + part;
}
float covTent(float x, float h, float P, float a, float b, float i0, float i1) {
  h = max(h, 1e-4);
  return (cum2(x + h, P, a, b, i0, i1) - 2.0 * cum2(x, P, a, b, i0, i1) + cum2(x - h, P, a, b, i0, i1)) / (h * h);
}
float filt(float x, float h, float P, float a, float b, float i0, float i1) {
  return u_kernel > 0.5 ? covTent(x, h * 1.41421356, P, a, b, i0, i1) : cov(x, h, P, a, b, i0, i1);
}
void main() {
  if (u_count > 0.0) { o = vec4(u_count, 0.0, 0.0, 1.0); return; }
  vec3 t = vec3(-v_n.y, v_n.x, 0.0);
  vec3 v = normalize(v_wp - u_cam);
  float vn = dot(v, v_n);
  // the pixel's footprint on the wall, as the box that has the same variance as the pixel: the L2 length of the two screen derivatives
  vec2 fw = 0.5 * u_aa * sqrt(dFdx(v_sz) * dFdx(v_sz) + dFdy(v_sz) * dFdy(v_sz));
  float mod_ = v_bay.x, a = v_bay.y, b = v_bay.z, i0 = v_bay.w, i1 = v_i1;
  // where the ray goes on after the wall plane, down to the glass plane: the shift of the glass seen through the opening
  float tt = u_parallax * u_reveal / max(-vn, 0.02);
  vec2 d = vec2(dot(v, t), v.z) * tt;
  float sill = u_win.y, h = u_win.z, pitch = u_win.x, rows = u_win.w;
  float openX = filt(v_sz.x, fw.x, mod_, a, b, i0, i1);
  float openZ = filt(v_sz.y, fw.y, pitch, sill, sill + h, 0.0, rows);
  float glassX = filt(v_sz.x, fw.x, mod_, a + max(0.0, -d.x), b - max(0.0, d.x), i0, i1);
  float glassZ = filt(v_sz.y, fw.y, pitch, sill + max(0.0, -d.y), sill + h - max(0.0, d.y), 0.0, rows);
  float co = openX * openZ, cg = min(glassX * glassZ, co);
  o = vec4(v_litW * (1.0 - co) + v_litR * (co - cg) + v_litG * cg, u_alpha);
}`;

function program(gl, vs, fs) {
  const mk = (t, s) => { const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(sh)); return sh; };
  const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
  const U = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const nm = gl.getActiveUniform(p, i).name; U[nm] = gl.getUniformLocation(p, nm); }
  return { p, U };
}

// ------------------------------------------------------------------------------------------------ the lab
const canvas = document.getElementById('c');
const gl = canvas.getContext('webgl2', { antialias: false, alpha: true, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
if (!gl) throw new Error('no WebGL2');
const dbg = gl.getExtension('WEBGL_debug_renderer_info');
const timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2');
const meta = await (await fetch(FIX + '.json')).json();
const R = meta.recipe;
const bufBytes = { A: 0, B: 0, rest: 0 };

function loadPacked(buf, info) {
  const vb = new Uint8Array(buf, 0, info.vertexBytes), ib = new Uint32Array(buf.slice(info.vertexBytes, info.vertexBytes + info.indexBytes));
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  const vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, vb, gl.STATIC_DRAW);
  const at = (loc, size, type, norm, off) => { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, type, norm, 24, off); };
  at(0, 4, gl.SHORT, false, 0); at(1, 4, gl.BYTE, true, 8); at(2, 4, gl.UNSIGNED_BYTE, true, 12); at(3, 4, gl.UNSIGNED_BYTE, true, 16); at(4, 4, gl.UNSIGNED_BYTE, true, 20);
  const ibo = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, ib, gl.STATIC_DRAW);
  // per-instance offset (location 5), set by the caller's instance buffer
  gl.bindVertexArray(null);
  return { vao, count: ib.length, centre: info.centre, scale: info.scale, bytes: vb.byteLength + ib.byteLength, vertices: info.vertexCount };
}
const facadeBuf = await gunzip(FIX + '.facade.bin.gz'), restBuf = await gunzip(FIX + '.rest.bin.gz');
const meshA = loadPacked(facadeBuf, meta.facade), meshRest = loadPacked(restBuf, meta.rest);

// arm B: one quad per wall. Vertex = pos(3) nrm(3) sz(2) bay(4: mod, a, b, i0) i1(1) = 13 floats.
function buildQuads() {
  const F = meta.faces, V = new Float32Array(F.length * 4 * 13), I = new Uint16Array(F.length * 6);
  const bp = (L, hs) => { const Lr = L / hs, n = Math.max(1, Math.round(Lr / R.bay)), mod = Lr / n, a = mod / 2 - R.window.w / 2, ok = a >= 0.05; return { mod: mod * hs, a: a * hs, b: (a + R.window.w) * hs, i0: ok ? 0 : 1, i1: ok ? n : n - 1 }; };
  F.forEach((f, i) => {
    const L = f.s1 - f.s0, p = bp(L, f.hs), tx = -f.ny, ty = f.nx;
    const corners = [[0, R.z0], [L, R.z0], [L, R.z1], [0, R.z1]];
    corners.forEach(([s, z], k) => {
      const o = (i * 4 + k) * 13, ss = f.s0 + s;
      V[o] = f.nx * f.d + tx * ss; V[o + 1] = f.ny * f.d + ty * ss; V[o + 2] = z;
      V[o + 3] = f.nx; V[o + 4] = f.ny; V[o + 5] = 0;
      V[o + 6] = s; V[o + 7] = z - R.rowFirst;
      V[o + 8] = p.mod; V[o + 9] = p.a; V[o + 10] = p.b; V[o + 11] = p.i0; V[o + 12] = p.i1;
    });
    I.set([0, 1, 2, 0, 2, 3].map(x => x + i * 4), i * 6);
  });
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  const vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, V, gl.STATIC_DRAW);
  const S = 52, at = (loc, size, off) => { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, S, off); };
  at(0, 3, 0); at(1, 3, 12); at(2, 2, 24); at(3, 4, 32); at(4, 1, 48);
  const ibo = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, I, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return { vao, count: I.length, bytes: V.byteLength + I.byteLength, vertices: F.length * 4 };
}
const meshB = buildQuads();

const progGeo = program(gl, GEO_VS, GEO_FS), progFac = program(gl, FAC_VS, FAC_FS);

// instance offsets (location 5 is the same attribute index in both VAOs; one buffer feeds both)
const instBuf = gl.createBuffer(); let instCount = 1;
function setInstances(list) {
  instCount = list.length / 3;
  gl.bindBuffer(gl.ARRAY_BUFFER, instBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(list), gl.STATIC_DRAW);
  for (const m of [meshA, meshRest, meshB]) { gl.bindVertexArray(m.vao); gl.bindBuffer(gl.ARRAY_BUFFER, instBuf); gl.enableVertexAttribArray(5); gl.vertexAttribPointer(5, 3, gl.FLOAT, false, 12, 0); gl.vertexAttribDivisor(5, 1); }
  gl.bindVertexArray(null);
}
setInstances([0, 0, 0]);

// ------------------------------------------------------------------------------------------------ render targets
const targets = new Map();
function target(w, h, msaa) {
  const key = w + 'x' + h + (msaa ? 'm' : '');
  if (targets.has(key)) return targets.get(key);
  const mk = () => {
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const rb = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, rb); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
    return { fb, tex, rb };
  };
  const t = { w, h, plain: mk() };
  if (msaa) {
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    const cb = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, cb); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, 4, gl.RGBA8, w, h); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, cb);
    const db = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, db); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, 4, gl.DEPTH_COMPONENT24, w, h); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, db);
    t.ms = { fb };
  }
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('framebuffer incomplete ' + key);
  targets.set(key, t); return t;
}

// ------------------------------------------------------------------------------------------------ cameras (local metres, z up; the app's vertical field of view is 58 degrees)
const BB = meta.facade.bbox, TC = [(BB[0] + BB[3]) / 2, (BB[1] + BB[4]) / 2];
const FOV = 58 * Math.PI / 180;
function camera(v, w, h) {
  const az = v.az * Math.PI / 180, el = v.el * Math.PI / 180, tz = v.tz;
  const eye = [TC[0] + v.dist * Math.cos(el) * Math.sin(az), TC[1] + v.dist * Math.cos(el) * Math.cos(az), tz + v.dist * Math.sin(el)];
  const M = mul(persp(FOV, w / h, Math.max(1, v.dist * 0.02), v.dist * 6 + 500), lookAt(eye, [TC[0], TC[1], tz], [0, 0, 1]));
  return { M, eye };
}

// ------------------------------------------------------------------------------------------------ drawing
const state = { light: meta.light.day, tones: meta.tones, aa: 1.0, parallax: 1.0, rest: true, count: 0, kernel: 0 };
const f3 = a => new Float32Array(a.map(x => x / 255));
function setLight(L) {
  for (const prog of [progGeo, progFac]) {
    gl.useProgram(prog.p);
    gl.uniform3fv(prog.U.u_lightpos, L.lightpos); gl.uniform3fv(prog.U.u_lightcolor, L.lightcolor);
    gl.uniform1f(prog.U.u_lightintensity, L.lightintensity); gl.uniform1f(prog.U.u_materialP, L.materialP); gl.uniform1f(prog.U.u_opacity, L.opacity);
  }
  gl.useProgram(progFac.p);
  const T = state.tones;
  const setT = (nm, t) => { gl.uniform3fv(progFac.U['u_' + nm + 'Day'], f3(t.day)); gl.uniform3fv(progFac.U['u_' + nm + 'Gold'], f3(t.gold)); gl.uniform3fv(progFac.U['u_' + nm + 'Night'], f3(t.night)); };
  setT('f', T.field); setT('g', T.glass); setT('r', T.reveal);
  gl.uniform4f(progFac.U.u_win, R.rowPitch, R.window.sill, R.window.h, R.rowCount);
  gl.uniform1f(progFac.U.u_reveal, R.reveal);
}
const customArms = {};          // name -> ({ cam, shiftNdc, builtin, view }) : draws the facade part of a custom arm (experiments/facet registers some)
function drawScene(arm, parts, cam, shiftNdc) {
  const withFacade = parts !== 'rest', withRest = parts !== 'facade';
  if (withFacade && customArms[arm]) { customArms[arm]({ cam, shiftNdc, view: state.view, builtin: a => drawFacade(a, cam, shiftNdc) }); }
  else if (withFacade) drawFacade(arm, cam, shiftNdc);
  if (withRest) drawRest(cam, shiftNdc);
  gl.bindVertexArray(null);
}
function drawFacade(arm, cam, shiftNdc) {
  if (arm === 'B') {
    gl.useProgram(progFac.p); gl.bindVertexArray(meshB.vao);
    gl.uniformMatrix4fv(progFac.U.u_matrix, false, cam.M); gl.uniform2f(progFac.U.u_shift, shiftNdc[0], shiftNdc[1]);
    gl.uniform3fv(progFac.U.u_cam, cam.eye); gl.uniform1f(progFac.U.u_aa, state.aa); gl.uniform1f(progFac.U.u_parallax, state.parallax); gl.uniform1f(progFac.U.u_alpha, 1.0); gl.uniform1f(progFac.U.u_count, state.count); gl.uniform1f(progFac.U.u_kernel, state.kernel);
    gl.drawElementsInstanced(gl.TRIANGLES, meshB.count, gl.UNSIGNED_SHORT, 0, instCount);
  }
  else {
    gl.useProgram(progGeo.p);
    gl.uniformMatrix4fv(progGeo.U.u_matrix, false, cam.M); gl.uniform2f(progGeo.U.u_shift, shiftNdc[0], shiftNdc[1]);
    gl.bindVertexArray(meshA.vao); gl.uniform3fv(progGeo.U.u_centre, meshA.centre); gl.uniform1f(progGeo.U.u_scale, meshA.scale); gl.uniform1f(progGeo.U.u_alpha, 1.0); gl.uniform1f(progGeo.U.u_count, state.count);
    gl.drawElementsInstanced(gl.TRIANGLES, meshA.count, gl.UNSIGNED_INT, 0, instCount);
  }
}
function drawRest(cam, shiftNdc) {
  {
    gl.useProgram(progGeo.p);
    gl.uniformMatrix4fv(progGeo.U.u_matrix, false, cam.M); gl.uniform2f(progGeo.U.u_shift, shiftNdc[0], shiftNdc[1]);
    gl.bindVertexArray(meshRest.vao); gl.uniform3fv(progGeo.U.u_centre, meshRest.centre); gl.uniform1f(progGeo.U.u_scale, meshRest.scale); gl.uniform1f(progGeo.U.u_alpha, 0.5); gl.uniform1f(progGeo.U.u_count, state.count);
    gl.drawElementsInstanced(gl.TRIANGLES, meshRest.count, gl.UNSIGNED_INT, 0, instCount);
  }
}
function frame(arm, parts, tg, cam, shiftNdc, msaa) {
  const T = msaa ? tg.ms : tg.plain;
  gl.bindFramebuffer(gl.FRAMEBUFFER, T.fb); gl.viewport(0, 0, tg.w, tg.h);
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
  gl.clearColor(1, 0, 1, 0); gl.clearDepth(1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  drawScene(arm, parts, cam, shiftNdc);
  if (msaa) { gl.bindFramebuffer(gl.READ_FRAMEBUFFER, tg.ms.fb); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, tg.plain.fb); gl.blitFramebuffer(0, 0, tg.w, tg.h, 0, 0, tg.w, tg.h, gl.COLOR_BUFFER_BIT, gl.NEAREST); }
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, tg.plain.fb);
}
function read(tg) { const u = new Uint8Array(tg.w * tg.h * 4); gl.bindFramebuffer(gl.READ_FRAMEBUFFER, tg.plain.fb); gl.bindFramebuffer(gl.FRAMEBUFFER, tg.plain.fb); gl.readPixels(0, 0, tg.w, tg.h, gl.RGBA, gl.UNSIGNED_BYTE, u); return u; }
const sync = tg => { gl.bindFramebuffer(gl.FRAMEBUFFER, tg.plain.fb); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); };

// ------------------------------------------------------------------------------------------------ image maths
function boxDown(u, W, H, SS) {
  const out = new Float32Array(W * H * 4), Wd = W * SS, inv = 1 / (SS * SS);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let j = 0; j < SS; j++) { let p = ((y * SS + j) * Wd + x * SS) * 4; for (let i = 0; i < SS; i++, p += 4) { r += u[p]; g += u[p + 1]; b += u[p + 2]; a += u[p + 3]; } }
    const o = (y * W + x) * 4; out[o] = r * inv; out[o + 1] = g * inv; out[o + 2] = b * inv; out[o + 3] = a * inv;
  }
  return out;
}
function box3(f, W, H) {   // 3x3 box on RGB, clamped at the edges
  const tmp = new Float32Array(W * H * 3), out = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < 3; c++) { let s = 0; for (let i = -1; i <= 1; i++) { const xx = Math.min(W - 1, Math.max(0, x + i)); s += f[(y * W + xx) * 4 + c]; } tmp[(y * W + x) * 3 + c] = s / 3; }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < 3; c++) { let s = 0; for (let j = -1; j <= 1; j++) { const yy = Math.min(H - 1, Math.max(0, y + j)); s += tmp[(yy * W + x) * 3 + c]; } out[(y * W + x) * 3 + c] = s / 3; }
  return out;
}
const luma = (f, i) => 0.2126 * f[i * 4] + 0.7152 * f[i * 4 + 1] + 0.0722 * f[i * 4 + 2];
function q(arr, p) { const a = Float32Array.from(arr).sort(); return a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : 0; }
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;

// ------------------------------------------------------------------------------------------------ the quality measurement (the moire meter's method, on the lab's own scene)
const STEP_PX = 0.3, FRAMES = 8, SS = 4, FLAT_LEVELS = 2.5;
async function quality(view, { W = 640, H = 400, arms = ['A', 'B', 'Bt', 'A4'], pictures = true, pictureArms = ['A', 'B'] } = {}) {
  state.view = view;
  const cam = camera(view, W, H);
  const t1 = target(W, H, false), t4 = target(W, H, true), tS = target(W * SS, H * SS, false);
  const res = { view: view.name, dist: view.dist, mPerPx: +(2 * view.dist * Math.tan(FOV / 2) / H).toFixed(3), bayPx: +(R.bay / (2 * view.dist * Math.tan(FOV / 2) / H)).toFixed(2), arms: {} };
  const baseOf = arm => arm === 'Bt' ? 'B' : (arm.endsWith('4') ? arm.slice(0, -1) : arm);
  const one = (arm, step) => { const sh = [2 * step * STEP_PX / W, 0]; const ms = arm.endsWith('4'); const tgt = ms ? t4 : t1; state.kernel = arm === 'Bt' ? 1 : 0; frame(baseOf(arm), 'all', tgt, cam, sh, ms); state.kernel = 0; return read(tgt); };
  const truthOf = (arm, step) => { const sh = [2 * step * STEP_PX / W, 0]; state.kernel = 0; frame(arm, 'all', tS, cam, sh, false); return boxDown(read(tS), W, H, SS); };
  const imgs = {};
  const cached = {};
  for (const arm of arms) {
    const baseArm = baseOf(arm);
    const sums = { s: new Float32Array(W * H * 3), s2: new Float32Array(W * H * 3) };
    let r0 = null, tr0 = null;
    for (let i = 0; i < FRAMES; i++) {
      const r1 = one(arm, i);
      const key = baseArm + i; const tr = cached[key] || (cached[key] = truthOf(baseArm, i));
      for (let p = 0; p < W * H; p++) for (let c = 0; c < 3; c++) { const e = r1[p * 4 + c] - tr[p * 4 + c]; sums.s[p * 3 + c] += e; sums.s2[p * 3 + c] += e * e; }
      if (i === 0) { r0 = r1; tr0 = tr; }
    }
    imgs[arm] = { r: r0, t: tr0 };
    res.arms[arm] = { flick: sums };
  }
  // masks from arm A's truth: facade interior = alpha 1 (rest geometry is alpha 0.5), edge = partial
  const tA = imgs.A.t, N = W * H, interior = new Uint8Array(N), edge = new Uint8Array(N), flat = new Uint8Array(N);
  for (let p = 0; p < N; p++) { const a = tA[p * 4 + 3] / 255; if (a >= 0.999) interior[p] = 1; else if (a > 0.004 && a < 0.49) edge[p] = 1; }
  // flat truth: 3x3 luma spread under FLAT_LEVELS
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const p = y * W + x; if (!interior[p]) continue; let lo = 1e9, hi = -1e9; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const xx = Math.min(W - 1, Math.max(0, x + i)), yy = Math.min(H - 1, Math.max(0, y + j)), l = luma(tA, yy * W + xx); lo = Math.min(lo, l); hi = Math.max(hi, l); } if (hi - lo < FLAT_LEVELS) flat[p] = 1; }
  let nInt = 0, nFlat = 0, nEdge = 0; for (let p = 0; p < N; p++) { nInt += interior[p]; nFlat += flat[p]; nEdge += edge[p]; }
  res.pixels = { interior: nInt, interiorPct: +(100 * nInt / N).toFixed(2), flatOfInterior: nInt ? +(100 * nFlat / nInt).toFixed(1) : 0, edge: nEdge };
  const stat = (r, t, mask) => { const e = []; for (let p = 0; p < N; p++) if (mask[p]) e.push((Math.abs(r[p * 4] - t[p * 4]) + Math.abs(r[p * 4 + 1] - t[p * 4 + 1]) + Math.abs(r[p * 4 + 2] - t[p * 4 + 2])) / 3); return { n: e.length, mean: +mean(e).toFixed(3), p99: +q(e, 0.99).toFixed(2) }; };
  const bandStat = (r, t, mask) => { const rb = box3(r, W, H), tb = box3(t, W, H), e = []; for (let p = 0; p < N; p++) if (mask[p]) e.push((Math.abs(rb[p * 3] - tb[p * 3]) + Math.abs(rb[p * 3 + 1] - tb[p * 3 + 1]) + Math.abs(rb[p * 3 + 2] - tb[p * 3 + 2])) / 3); return +mean(e).toFixed(3); };
  const detail = new Uint8Array(N); for (let p = 0; p < N; p++) detail[p] = interior[p] && !flat[p] ? 1 : 0;
  const maskAny = new Uint8Array(N); for (let p = 0; p < N; p++) maskAny[p] = interior[p] || edge[p] ? 1 : 0;
  for (const arm of arms) {
    const { r, t } = imgs[arm], A = res.arms[arm];
    A.err = stat(r, t, interior); A.errDetail = stat(r, t, detail); A.errFlat = stat(r, t, flat); A.errWithEdges = stat(r, t, maskAny); A.band = bandStat(r, t, interior);
    // flicker: per-pixel std of the error over the steps, averaged over interior pixels (the meter's definition)
    const fl = []; for (let p = 0; p < N; p++) if (interior[p]) { let s = 0; for (let c = 0; c < 3; c++) { const m = A.flick.s[p * 3 + c] / FRAMES, v = Math.max(0, A.flick.s2[p * 3 + c] / FRAMES - m * m); s += Math.sqrt(v); } fl.push(s / 3); }
    A.flicker = { mean: +mean(fl).toFixed(3), p99: +q(fl, 0.99).toFixed(2) }; delete A.flick;
  }
  // cross: every other arm's 1x picture against the geometry's own supersampled picture; and the pairs that tell how far two ways of drawing the same wall are apart
  if (imgs.A) {
    res.cross = {};
    for (const arm of arms) if (arm !== 'A') res.cross[arm + ' vs truth(A)'] = stat(imgs[arm].r, imgs.A.t, interior);
    if (imgs.B) { res.cross['truth(B) vs truth(A)'] = stat(imgs.B.t, imgs.A.t, interior); res.cross['A vs truth(B)'] = stat(imgs.A.r, imgs.B.t, interior); }
    if (imgs.F && imgs.B) res.cross['F vs B (the compiler against the hand-written shader)'] = stat(imgs.F.r, imgs.B.r, interior);
    if (imgs.F && imgs.A4) res.cross['F vs A4 (the switch)'] = stat(imgs.F.r, imgs.A4.r, interior);
    if (imgs.A && imgs.A4) res.cross['A vs A4'] = stat(imgs.A.r, imgs.A4.r, interior);
  }
  const [pa, pb] = pictureArms;
  if (pictures && imgs[pa] && imgs[pb]) {
    const cv = document.createElement('canvas'); cv.width = W * 5; cv.height = H; const cx = cv.getContext('2d'); const id = cx.createImageData(W * 5, H);
    const put = (panel, fn) => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = (y * (W * 5) + panel * W + x) * 4, src = (H - 1 - y) * W + x; const c = fn(src); id.data[o] = c[0]; id.data[o + 1] = c[1]; id.data[o + 2] = c[2]; id.data[o + 3] = 255; } };
    const rgb = u => i => [u[i * 4], u[i * 4 + 1], u[i * 4 + 2]];
    put(0, rgb(imgs[pa].r)); put(1, rgb(imgs[pb].r)); put(2, rgb(imgs.A.t));
    put(3, i => [0, 1, 2].map(c => Math.min(255, 6 * Math.abs(imgs[pa].r[i * 4 + c] - imgs.A.t[i * 4 + c]))));
    put(4, i => [0, 1, 2].map(c => Math.min(255, 6 * Math.abs(imgs[pb].r[i * 4 + c] - imgs.A.t[i * 4 + c]))));
    cx.putImageData(id, 0, 0); res.picture = cv.toDataURL('image/png');
  }
  return res;
}

// ------------------------------------------------------------------------------------------------ the speed measurement
async function timeIt(label, fn, tg, { frames = 20, reps = 7, warm = 3 } = {}) {
  for (let i = 0; i < warm; i++) fn();
  sync(tg);
  const wall = [], gpu = [];
  for (let r = 0; r < reps; r++) {
    let q = null;
    if (timerExt) { q = gl.createQuery(); gl.beginQuery(timerExt.TIME_ELAPSED_EXT, q); }
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) fn();
    if (q) gl.endQuery(timerExt.TIME_ELAPSED_EXT);
    sync(tg);
    wall.push((performance.now() - t0) / frames);
    if (q) { for (let k = 0; k < 200 && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE); k++) await new Promise(r => setTimeout(r, 5)); const disjoint = gl.getParameter(timerExt.GPU_DISJOINT_EXT); if (!disjoint && gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6 / frames); gl.deleteQuery(q); }
    await new Promise(r => setTimeout(r, 0));
  }
  return { wallMin: +Math.min(...wall).toFixed(3), wallMed: +wall.sort((a, b) => a - b)[wall.length >> 1].toFixed(3), gpuMin: gpu.length ? +Math.min(...gpu).toFixed(3) : null, reps: wall.length };
}
function gridInstances(n, spacing) {
  const out = []; for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) out.push((i - (n - 1) / 2) * spacing, (j - (n - 1) / 2) * spacing, 0);
  return out;
}
async function perf({ W, H, towers, view, parts = 'facade', reps = 7, frames = 20, arms = null }) {
  setInstances(towers === 1 ? [0, 0, 0] : gridInstances(Math.round(Math.sqrt(towers)), 90));
  const cam = camera(view, W, H), tg = target(W, H, false);
  const order = ['A', 'B', 'A', 'B', 'A', 'B'];   // interleaved; minimum over the repetitions inside each
  const res = {};
  const armList = arms || ['A', 'B'];
  for (const arm of armList) {
    const r = await timeIt(arm, () => frame(arm, parts, tg, cam, [0, 0], false), tg, { frames, reps });
    res[arm] = r;
  }
  // a second interleaved pass, keep the minimum of both passes
  for (const arm of armList.slice().reverse()) {
    const r = await timeIt(arm, () => frame(arm, parts, tg, cam, [0, 0], false), tg, { frames, reps });
    res[arm].wallMin = Math.min(res[arm].wallMin, r.wallMin); if (r.gpuMin != null) res[arm].gpuMin = res[arm].gpuMin == null ? r.gpuMin : Math.min(res[arm].gpuMin, r.gpuMin);
  }
  // covered pixels (alpha) for the record
  frame('A', parts, tg, cam, [0, 0], false); const u = read(tg); let cov = 0; for (let p = 0; p < W * H; p++) if (u[p * 4 + 3] > 0) cov++;
  setInstances([0, 0, 0]);
  return { W, H, towers, parts, coveredPct: +(100 * cov / (W * H)).toFixed(1), trianglesA: towers * meshA.count / 3 + (parts === 'all' ? towers * meshRest.count / 3 : 0), trianglesB: towers * meshB.count / 3 + (parts === 'all' ? towers * meshRest.count / 3 : 0), ...res };
}


// ------------------------------------------------------------------------------------------------ overdraw: how many times is a covered pixel shaded?
// Fragments are counted with additive blending (1/255 each) in the order the geometry is submitted (depth test on, no pre-pass):
// that is what a chip without perfect early-z sees. A depth pre-pass would make it 1.
function overdraw(view, { W = 1440, H = 900, arms = ['A', 'B'], towers = 1 } = {}) {
  setInstances(towers === 1 ? [0, 0, 0] : gridInstances(Math.round(Math.sqrt(towers)), 90));
  const cam = camera(view, W, H), tg = target(W, H, false), out = { view: view.name, W, H, towers };
  for (const arm of arms) {
    state.count = 1 / 255;
    gl.bindFramebuffer(gl.FRAMEBUFFER, tg.plain.fb); gl.viewport(0, 0, W, H);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true); gl.clearColor(0, 0, 0, 0); gl.clearDepth(1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    drawScene(arm, 'facade', cam, [0, 0]);
    gl.disable(gl.BLEND); state.count = 0;
    const u = read(tg); let covered = 0, frags = 0, mx = 0; for (let p = 0; p < W * H; p++) { const c = u[p * 4]; if (c > 0) { covered++; frags += c; if (c > mx) mx = c; } }
    out[arm] = { coveredPct: +(100 * covered / (W * H)).toFixed(2), fragmentsPerCoveredPixel: covered ? +(frags / covered).toFixed(2) : 0, max: mx, fragmentsM: +(frags / 1e6).toFixed(3) };
  }
  setInstances([0, 0, 0]);
  return out;
}

// ------------------------------------------------------------------------------------------------ temporal anti-aliasing, simulated on the CPU from real renders of arm A
// Camera pans 0.3 px a frame; each frame is drawn with a Halton sub-pixel jitter; history is shifted by the pan (bilinear) and blended
// with weight alpha. Scored like the meter: error against the 4x4 supersampled truth and flicker (std of the error), over frames after the warm-up.
const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };
async function taa(view, { W = 640, H = 400, alpha = 0.15, frames = 20, warm = 8 } = {}) {
  const cam = camera(view, W, H), t1 = target(W, H, false), tS = target(W * SS, H * SS, false), N = W * H;
  const rd = (shiftPx, jit) => { frame('A', 'all', t1, cam, [2 * (shiftPx + jit[0]) / W, 2 * jit[1] / H], false); const u = read(t1), f = new Float32Array(N * 4); for (let i = 0; i < N * 4; i++) f[i] = u[i]; return f; };
  const truthAt = c => { frame('A', 'all', tS, cam, [2 * c / W, 0], false); return boxDown(read(tS), W, H, SS); };
  let hist = null, interior = null;
  const acc = { T: { e: 0, n: 0, s: new Float32Array(N * 3), s2: new Float32Array(N * 3), k: 0 }, A: { e: 0, n: 0, s: new Float32Array(N * 3), s2: new Float32Array(N * 3), k: 0 } };
  for (let i = 0; i < frames; i++) {
    const c = i * STEP_PX, tr = truthAt(c), plain = rd(c, [0, 0]);
    if (i === 0) { interior = new Uint8Array(N); for (let p = 0; p < N; p++) if (tr[p * 4 + 3] / 255 >= 0.999) interior[p] = 1; }
    const cur = rd(c, [halton(i + 1, 2) - 0.5, halton(i + 1, 3) - 0.5]);
    if (!hist) hist = cur;
    else {
      const fr = STEP_PX, nh = new Float32Array(N * 4);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const p = y * W + x, q = y * W + Math.max(0, x - 1); for (let ch = 0; ch < 3; ch++) { const h = (1 - fr) * hist[p * 4 + ch] + fr * hist[q * 4 + ch]; nh[p * 4 + ch] = h + alpha * (cur[p * 4 + ch] - h); } }
      hist = nh;
    }
    if (i >= warm) for (const [key, img] of [['T', hist], ['A', plain]]) { const a = acc[key]; a.k++; for (let p = 0; p < N; p++) if (interior[p]) for (let ch = 0; ch < 3; ch++) { const e = img[p * 4 + ch] - tr[p * 4 + ch]; a.s[p * 3 + ch] += e; a.s2[p * 3 + ch] += e * e; a.e += Math.abs(e); a.n++; } }
  }
  const out = { view: view.name, alpha, frames, scoredFrames: acc.A.k };
  for (const key of ['T', 'A']) { const a = acc[key], fl = []; for (let p = 0; p < N; p++) if (interior[p]) { let s = 0; for (let ch = 0; ch < 3; ch++) { const m = a.s[p * 3 + ch] / a.k, v = Math.max(0, a.s2[p * 3 + ch] / a.k - m * m); s += Math.sqrt(v); } fl.push(s / 3); } out[key === 'T' ? 'taa' : 'plain'] = { errMean: +(a.e / a.n).toFixed(3), flickerMean: +mean(fl).toFixed(3) }; }
  return out;
}

// ------------------------------------------------------------------------------------------------ public surface
export const VIEWS = [
  { name: 'street-55m',   dist: 55,   el: 4,  az: 200, tz: 28 },
  { name: 'near-110m',    dist: 110,  el: 14, az: 200, tz: 38 },
  { name: 'mid-230m',     dist: 230,  el: 22, az: 200, tz: 42 },
  { name: 'far-500m',     dist: 500,  el: 28, az: 200, tz: 42 },
  { name: 'far-grazing',  dist: 500,  el: 6,  az: 110, tz: 42 },
  { name: 'vfar-1100m',   dist: 1100, el: 35, az: 200, tz: 42 },
];
window.__lab = {
  views: VIEWS, meta,
  info: () => ({
    renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : '',
    version: gl.getParameter(gl.VERSION), timerQuery: !!timerExt, maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE), maxRB: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), maxSamples: gl.getParameter(gl.MAX_SAMPLES),
    anisotropic: !!gl.getExtension('EXT_texture_filter_anisotropic'), multiDraw: !!gl.getExtension('WEBGL_multi_draw'),
  }),
  stats: () => ({
    A: { triangles: meshA.count / 3, vertices: meshA.vertices, bytesPacked24: meshA.bytes, bytesAppFormat: meta.facade.appBytes, drawCalls: 1 },
    B: { triangles: meshB.count / 3, vertices: meshB.vertices, bytes: meshB.bytes, drawCalls: 1 },
    rest: { triangles: meshRest.count / 3, vertices: meshRest.vertices, bytes: meshRest.bytes },
    walls: meta.faces.length, windows: null,
  }),
  quality: (viewName, opts) => quality(VIEWS.find(v => v.name === viewName), opts),
  qualityView: (view, opts) => quality(view, opts),
  internals: { getInstCount: () => instCount, gl, meta, R, program, camera, state, customArms, SHADE, FAC_FS, FAC_VS, meshB, instBuf, setInstances, target, frame, read },
  overdraw: (viewName, o) => overdraw(Object.assign({}, VIEWS.find(v => v.name === viewName) || o.view), o),
  taa: (viewName, o) => taa(VIEWS.find(v => v.name === viewName), o),
  perf: opts => perf({ ...opts, view: opts.view || VIEWS.find(v => v.name === (opts.viewName || 'mid-230m')) }),
  setLight: name => { state.light = meta.light[name]; setLight(state.light); },
  set: o => Object.assign(state, o),
  views_: VIEWS,
};
setLight(state.light);
window.__labReady = true;
log('ready');
