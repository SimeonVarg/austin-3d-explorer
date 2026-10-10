/**
 * lib/facet.mjs - Facet: the compiler's whole library. Three jobs, one source (a recipe's skin):
 *   fromRecipe()   recipe skin  -> IR (a small, layered, axis-aligned rectangle program over a wall's own (s, z))
 *   emitGLSL()     IR           -> a vertex and a fragment shader (closed-form filtered coverage per layer, painter's order)
 *   emitJS()       IR           -> the same maths as a JavaScript function (the tests run it; the page does not)
 *   bake()         IR + walls   -> the wall package: one quad per wall with its fit numbers
 *   budget()       a camera sweep -> where the shader wall may replace geometry, under a gate
 * The IR is not for people to type: it is what a recipe's skin compiles to (the recipe JSON stays the source).
 * Supported in v0 (everything else is REFUSED with the reason, so a skin Facet cannot draw stays geometry):
 *   skin kind "bays" (and "flat", which is bays without strips and floor lines): field tone, vertical strips at joints or centres (every n-th), floor lines, one window per bay per floor with a recess.
 */

// ------------------------------------------------------------------------------------------------ 1. recipe -> IR
const UNSUPPORTED = ['fields', 'louvre', 'pier', 'bands'];
const UNSUPPORTED_WINDOW = ['cols', 'offsets', 'mullion', 'frame', 'spandrel', 'head', 'accent', 'arch', 'flip', 'windowRule'];
export function fromRecipe(recipe, skinName, band, tonesOverride = null) {
  const sk = recipe.skins[skinName];
  if (!sk) throw new Error(`no skin ${skinName}`);
  const refuse = [];
  if (sk.kind !== 'bays' && sk.kind !== 'flat') refuse.push(`kind ${sk.kind} is not "bays" or "flat"`);
  for (const k of UNSUPPORTED) if (sk[k]) refuse.push(`option ${k} is not supported in v0`);
  if (sk.windowSkip) refuse.push('windowSkip');
  if (sk.window) for (const k of UNSUPPORTED_WINDOW) if (sk.window[k]) refuse.push(`window option ${k} is not supported in v0`);
  if (refuse.length) { const e = new Error(`Facet refuses skin ${skinName}: ${refuse.join('; ')}`); e.refused = refuse; throw e; }
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const tone = n => (tonesOverride && tonesOverride[n]) || { day: hex(recipe.colours[n].hex), gold: hex(recipe.colours[n].hex), night: hex(recipe.colours[n].hex) };
  const floors = recipe.levels.floors.filter(f => f >= band.z0 - 1e-6 && f < band.z1 - 1e-6);
  const pitches = new Set(); for (let i = 1; i < floors.length; i++) pitches.add(+(floors[i] - floors[i - 1]).toFixed(4));
  if (pitches.size > 1) throw Object.assign(new Error('Facet refuses: floors are not evenly spaced'), { refused: ['uneven floors'] });
  const layers = [{ op: 'field', tone: sk.field || 'wall' }];
  if (sk.strip && sk.kind === 'bays') layers.push({ op: 'strip', tone: sk.strip.tone, w: sk.strip.w || 0.6, at: sk.strip.at === 'centres' ? 'centres' : 'joints', every: sk.strip.every || 1 });
  if (sk.floorLine && sk.kind === 'bays') layers.push({ op: 'floorline', tone: sk.floorLine.tone, h: sk.floorLine.h });
  let rows = 0;
  if (sk.window) {
    const w = sk.window, sill = w.sill ?? 0.8;
    rows = floors.filter(f => f + sill + (w.h || 2.0) <= band.z1 + 1e-6).length;
    layers.push({ op: 'opening', w: w.w || 1.5, h: w.h || 2.0, sill, reveal: sk.reveal ?? 0.1, glass: sk.glass || 'glass', revealTone: sk.frame || sk.field || 'wall' });
  }
  const names = new Set(layers.flatMap(l => [l.tone, l.glass, l.revealTone].filter(Boolean)));
  return { facet: 1, name: `${recipe.name} / ${skinName}`, source: { recipe: recipe.name, skin: skinName },
    fit: { bay: sk.bay || 3.0 }, floors: { first: floors[0], pitch: floors.length > 1 ? floors[1] - floors[0] : 3, count: floors.length, rows, z0: band.z0, z1: band.z1 },
    tones: Object.fromEntries([...names].map(n => [n, tone(n)])), layers };
}

// ------------------------------------------------------------------------------------------------ 2. the shared maths (text, so the tests can run the SAME text as JavaScript)
export const CORE = `
float cum(float x, float P, float a, float b, float i0, float i1) {
  if (i1 <= i0 || x <= 0.0 || b <= a) return 0.0;
  float k = floor(x / P);
  float c = (clamp(k, i0, i1) - i0) * (b - a);
  if (k >= i0 && k < i1) c += clamp(x - k * P - a, 0.0, b - a);
  return c;
}
float cov(float x, float h, float P, float a, float b, float i0, float i1) {
  h = max(h, 1e-4);
  return (cum(x + h, P, a, b, i0, i1) - cum(x - h, P, a, b, i0, i1)) / (2.0 * h);
}
`;
export function coreJS() {
  const js = CORE.replace(/float (\w+)\(([^)]*)\)/g, (_, n, a) => `function ${n}(${a.replace(/float /g, '')})`).replace(/\bfloat (\w+) =/g, 'let $1 =').replace(/\bfloor\(/g, 'Math.floor(').replace(/\bmax\(/g, 'Math.max(');
  return new Function('clamp', js + '\nreturn { cum, cov };')((x, a, b) => Math.min(Math.max(x, a), b));
}

// per-layer pulse trains for one wall. face = { L (metres along the wall), n (bays), hs (recipe metre -> map metre) }
// Returns { x: {P,a,b,i0,i1}, z: {P,a,b,i0,i1} } per layer, in the wall's own units. THE ONE PLACE the layout rules live; the GLSL is generated from the same formulae.
export function pulses(ir, layer, face) {
  const mod = face.L / face.n, hs = face.hs, F = ir.floors;
  if (layer.op === 'strip') {
    const sw = layer.w * hs, P = layer.every * mod;
    if (layer.at === 'joints') return { x: { P, a: 0, b: sw, i0: 0, i1: Math.floor(face.n / layer.every) + 1, shift: sw / 2 }, z: null };
    return { x: { P, a: 0.5 * mod - sw / 2, b: 0.5 * mod + sw / 2, i0: 0, i1: Math.ceil(face.n / layer.every), shift: 0 }, z: null };
  }
  if (layer.op === 'floorline') return { x: null, z: { P: F.pitch, a: 0, b: layer.h, i0: 0, i1: F.count, shift: 0 } };
  if (layer.op === 'opening') {
    const a = mod / 2 - layer.w * hs / 2, ok = a >= 0.05 * hs;
    return { x: { P: mod, a, b: a + layer.w * hs, i0: ok ? 0 : 1, i1: ok ? face.n : face.n - 1, shift: 0 }, z: { P: F.pitch, a: layer.sill, b: layer.sill + layer.h, i0: 0, i1: F.rows, shift: 0 } };
  }
  return null;
}

// ------------------------------------------------------------------------------------------------ 3. IR -> JavaScript (what the tests run) 
/** coverage of every layer at a point, box-filtered over [s +- hx] x [zp +- hz] (zp = z - first floor). Parallax: d = [ds, dz] shift of the glass seen through the opening. */
export function emitJS(ir) {
  const { cov } = coreJS();
  return function evaluate(face, s, zp, hx, hz, d = [0, 0]) {
    const out = { layers: [], opening: 0, glass: 0 };
    for (const L of ir.layers) {
      if (L.op === 'field') { out.layers.push({ op: 'field', tone: L.tone, c: 1 }); continue; }
      const p = pulses(ir, L, face);
      const cx = p.x ? cov(s + p.x.shift, hx, p.x.P, p.x.a, p.x.b, p.x.i0, p.x.i1) : 1;
      const cz = p.z ? cov(zp, hz, p.z.P, p.z.a, p.z.b, p.z.i0, p.z.i1) : 1;
      if (L.op === 'opening') {
        out.opening = cx * cz;
        const gx = cov(s, hx, p.x.P, p.x.a + Math.max(0, -d[0]), p.x.b - Math.max(0, d[0]), p.x.i0, p.x.i1);
        const gz = cov(zp, hz, p.z.P, p.z.a + Math.max(0, -d[1]), p.z.b - Math.max(0, d[1]), p.z.i0, p.z.i1);
        out.glass = Math.min(gx * gz, out.opening);
        out.layers.push({ op: 'opening', c: out.opening, glass: out.glass, glassTone: L.glass, revealTone: L.revealTone });
      } else out.layers.push({ op: L.op, tone: L.tone, c: cx * cz });
    }
    return out;
  };
}
/** colour from coverages, painter's order: field, strips, floor lines, then the opening (reveal and glass) on top. Tones: name -> [r,g,b]. */
export function composeJS(cov, tones) {
  let col = null;
  for (const l of cov.layers) {
    if (l.op === 'field') col = tones[l.tone].slice();
    else if (l.op === 'opening') col = col.map((v, i) => v * (1 - l.c) + tones[l.revealTone][i] * (l.c - l.glass) + tones[l.glassTone][i] * l.glass);
    else col = col.map((v, i) => v * (1 - l.c) + tones[l.tone][i] * l.c);
  }
  return col;
}

// ------------------------------------------------------------------------------------------------ 4. IR -> GLSL
const f = x => { const s = Number(x).toFixed(6); return s; };
export function emitGLSL(ir) {
  const tones = Object.keys(ir.tones), T = Object.fromEntries(tones.map((n, i) => [n, 't' + i]));
  const F = ir.floors, bay = ir.fit.bay;
  const lights = tones.map(n => `uniform vec3 u_${T[n]}Day, u_${T[n]}Gold, u_${T[n]}Nit;`).join('\n');
  const flatOut = tones.map(n => `flat out vec3 v_${T[n]};`).join(' ');
  const flatIn = tones.map(n => `flat in vec3 v_${T[n]};`).join(' ');
  const shade = tones.map(n => `  v_${T[n]} = shadeTone(u_${T[n]}Day, u_${T[n]}Gold, u_${T[n]}Nit, n);`).join('\n');
  const vs = `#version 300 es
// GENERATED by experiments/facet (facetc.mjs) from: ${ir.name}. Do not edit; edit the recipe and compile again.
precision highp float; precision highp int;
layout(location=0) in vec3 a_pos; layout(location=1) in vec3 a_nrm; layout(location=2) in vec2 a_sz; layout(location=3) in vec4 a_wall; // (L, bays n, hs, 0)
layout(location=4) in vec3 a_inst;
uniform mat4 u_matrix; uniform vec2 u_shift;
${lights}
uniform vec3 u_lightpos; uniform vec3 u_lightcolor; uniform float u_lightintensity; uniform float u_materialP; uniform float u_opacity;
vec3 shadeTone(vec3 cDay, vec3 cGold, vec3 cNight, vec3 n) {
  vec3 color = (u_materialP <= 0.5) ? mix(cDay, cGold, u_materialP * 2.0) : mix(cGold, cNight, (u_materialP - 0.5) * 2.0);
  float colorvalue = color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
  color += vec3(0.03);
  float directional = clamp(dot(n, u_lightpos), 0.0, 1.0);
  directional = mix(1.0 - u_lightintensity, max(1.0 - colorvalue + u_lightintensity, 1.0), directional);
  vec3 lit = clamp(color * directional * u_lightcolor, mix(vec3(0.0), vec3(0.3), vec3(1.0) - u_lightcolor), vec3(1.0));
  return lit * u_opacity;
}
out vec2 v_sz; out vec3 v_wp; flat out vec4 v_wall; flat out vec3 v_n; ${flatOut}
void main() {
  vec3 n = normalize(a_nrm);
  vec3 p = a_pos + a_inst;
  v_sz = a_sz; v_wp = p; v_wall = a_wall; v_n = n;
${shade}
  gl_Position = u_matrix * vec4(p, 1.0); gl_Position.xy += u_shift * gl_Position.w;
}`;
  const layerCode = ir.layers.map(L => {
    if (L.op === 'field') return `  vec3 col = v_${T[L.tone]};`;
    if (L.op === 'strip') {
      const sw = `${f(L.w)} * hs`;
      if (L.at === 'joints') return `  { float P = ${f(L.every)} * mod_, w = ${sw}; float c = cov(v_sz.x + 0.5 * w, fw.x, P, 0.0, w, 0.0, floor(n / ${f(L.every)}) + 1.0); col = mix(col, v_${T[L.tone]}, c); }`;
      return `  { float P = ${f(L.every)} * mod_, w = ${sw}; float c = cov(v_sz.x, fw.x, P, 0.5 * mod_ - 0.5 * w, 0.5 * mod_ + 0.5 * w, 0.0, ceil(n / ${f(L.every)})); col = mix(col, v_${T[L.tone]}, c); }`;
    }
    if (L.op === 'floorline') return `  { float c = cov(v_sz.y, fw.y, PITCH, 0.0, ${f(L.h)}, 0.0, ${f(F.count)}); col = mix(col, v_${T[L.tone]}, c); }`;
    if (L.op === 'opening') {
      const w = `${f(L.w)} * hs`;
      return `  {
    float w = ${w}, a = 0.5 * mod_ - 0.5 * w; float ok = a >= ${f(0.05)} * hs ? 1.0 : 0.0;
    float i0 = 1.0 - ok, i1 = n - 1.0 + ok;
    float sill = ${f(L.sill)}, h = ${f(L.h)}, rows = ${f(F.rows)};
    float tt = u_parallax * ${f(L.reveal)} / max(-vn, 0.02);
    vec2 d = vec2(dot(v, t), v.z) * tt;
    float openX = filt(v_sz.x, fw.x, mod_, a, a + w, i0, i1), openZ = filt(v_sz.y, fw.y, PITCH, sill, sill + h, 0.0, rows);
    float glassX = filt(v_sz.x, fw.x, mod_, a + max(0.0, -d.x), a + w - max(0.0, d.x), i0, i1);
    float glassZ = filt(v_sz.y, fw.y, PITCH, sill + max(0.0, -d.y), sill + h - max(0.0, d.y), 0.0, rows);
    float co = openX * openZ, cg = min(glassX * glassZ, co);
    col = col * (1.0 - co) + v_${T[L.revealTone]} * (co - cg) + v_${T[L.glass]} * cg;
  }`;
    }
    return '';
  }).join('\n');
  const fs = `#version 300 es
// GENERATED by experiments/facet (facetc.mjs) from: ${ir.name}. Do not edit; edit the recipe and compile again.
precision highp float;
in vec2 v_sz; in vec3 v_wp; flat in vec4 v_wall; flat in vec3 v_n; ${flatIn}
uniform vec3 u_cam; uniform float u_aa; uniform float u_parallax; uniform float u_alpha; uniform float u_count;
out vec4 o;
const float PITCH = ${f(F.pitch)};
${CORE}
float filt(float x, float h, float P, float a, float b, float i0, float i1) { return cov(x, h, P, a, b, i0, i1); }
void main() {
  if (u_count > 0.0) { o = vec4(u_count, 0.0, 0.0, 1.0); return; }
  float n = v_wall.y, hs = v_wall.z, mod_ = v_wall.x / n;
  vec3 t = vec3(-v_n.y, v_n.x, 0.0);
  vec3 v = normalize(v_wp - u_cam);
  float vn = dot(v, v_n);
  vec2 fw = 0.5 * u_aa * sqrt(dFdx(v_sz) * dFdx(v_sz) + dFdy(v_sz) * dFdy(v_sz));
${layerCode}
  o = vec4(col, u_alpha);
}`;
  return { vs, fs, tones: tones.map(n => ({ name: n, id: T[n], ...ir.tones[n] })) };
}

// ------------------------------------------------------------------------------------------------ 5. the wall package (the baker)
/** walls: [{ nx, ny, d, s0, s1, z0, z1, hs }] (from the geometry for the prototype; a production baker takes them from the ring). */
export function bake(ir, walls) {
  const V = new Float32Array(walls.length * 4 * 12), I = new Uint16Array(walls.length * 6), faces = [];
  walls.forEach((w, i) => {
    const L = w.s1 - w.s0, n = Math.max(1, Math.round(L / w.hs / ir.fit.bay)), tx = -w.ny, ty = w.nx;
    faces.push({ L, n, hs: w.hs });
    [[0, ir.floors.z0], [L, ir.floors.z0], [L, ir.floors.z1], [0, ir.floors.z1]].forEach(([s, z], k) => {
      const o = (i * 4 + k) * 12, ss = w.s0 + s;
      V.set([w.nx * w.d + tx * ss, w.ny * w.d + ty * ss, z, w.nx, w.ny, 0, s, z - ir.floors.first, L, n, w.hs, 0], o);
    });
    I.set([0, 1, 2, 0, 2, 3].map(x => x + i * 4), i * 6);
  });
  return { vertices: V, indices: I, faces, bytes: V.byteLength + I.byteLength, triangles: walls.length * 2 };
}

// ------------------------------------------------------------------------------------------------ 6. the budget
/**
 * sweep: [{ dist, bayPx, errF, errNear, flickF, flickNear }] where "near" is the competing geometry (4x MSAA) and F the Facet shader wall.
 * gate: the most the shader wall may be worse than the competing geometry, as a ratio of the mean error. Returns the representation per range:
 * geometry where the ratio is above the gate (closer than switchBayPx pixels a bay), the shader wall elsewhere.
 */
export function budget(sweep, gate, byFlicker = true) {
  const rows = sweep.map(r => ({ ...r, ratioErr: r.errF / Math.max(r.errNear, 1e-6), ratioFlick: r.flickF / Math.max(r.flickNear, 1e-6) }));
  const ok = r => r.ratioErr <= gate && (!byFlicker || r.ratioFlick <= gate * 1.6);
  const shaderRows = rows.filter(ok), geomRows = rows.filter(r => !ok(r));
  const switchBayPx = geomRows.length ? Math.max(...geomRows.map(r => r.bayPx)) : 0;
  const firstShader = shaderRows.filter(r => r.bayPx < (switchBayPx || Infinity)).sort((a, b) => b.bayPx - a.bayPx)[0];
  return { gate, switchBayPx: firstShader && geomRows.length ? (switchBayPx + firstShader.bayPx) / 2 : switchBayPx, rows, worstRatioErr: Math.max(...rows.map(r => r.ratioErr)), geometryNearerThan: geomRows.length ? Math.min(...geomRows.map(r => r.dist)) : null, note: 'use geometry when a bay is wider than switchBayPx pixels; the shader wall otherwise' };
}
