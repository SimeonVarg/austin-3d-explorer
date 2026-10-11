/**
 * selftest.mjs - Facet's tests that need no GPU.
 *   1. the compiler REFUSES what it cannot draw (a list of skins and the reasons)
 *   2. the IR of the Dobie tower gives the same window area on every wall as the generator's own rule (facade-shader/lib/pattern.mjs windowsFor)
 *   3. the compiled coverage maths (emitJS, which runs the same cum/cov text the GLSL contains) against a brute-force point oracle that does NOT use
 *      cum/cov: a point-in-layout test written from the layout rules, supersampled over the footprint. For the real skin and for a synthetic skin
 *      with strips (joints, centres), floor lines and an opening, with the glass shifted by parallax. The error where layers overlap (a strip crossing a
 *      floor line) is REPORTED, not hidden: averaging the layers and then compositing is not the average of the composite.
 *   node experiments/facet/selftest.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromRecipe, emitJS, composeJS, emitGLSL, bake, budget } from './lib/facet.mjs';
import { windowsFor } from '../facade-shader/lib/pattern.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.resolve(HERE, '../..');
let fails = 0; const check = (ok, msg) => { if (!ok) { fails++; console.log('FAIL', msg); } };
const recipe = JSON.parse(fs.readFileSync(path.join(REPO, 'data/apartments/dobie-twenty21.json'), 'utf8'));
const fixture = JSON.parse(fs.readFileSync(path.join(REPO, 'experiments/facade-shader/fixture/dobie-twenty21.json'), 'utf8'));
const band = recipe.blocks.find(b => b.id === 'tower').bands[0];

// 1. refusals
for (const [name, skin, why] of [
  ['louvre', { kind: 'bays', bay: 3, field: 'wall', louvre: { pitch: 0.2, w: 0.1, tone: 'wall' } }, 'louvre'],
  ['pixel', { kind: 'pixel', course: 1, plank: 2, tones: ['wall'] }, 'kind'],
  ['frame', { kind: 'bays', bay: 3, field: 'wall', window: { w: 1, h: 1, sill: 1, frame: { w: 0.1, tone: 'wall' } } }, 'frame'],
  ['offsets', { kind: 'bays', bay: 3, field: 'wall', window: { w: 1, h: 1, sill: 1, offsets: [[-1, 1], [1, 1]] } }, 'offsets'],
]) {
  const r = JSON.parse(JSON.stringify(recipe)); r.skins.t = skin;
  let refused = null; try { fromRecipe(r, 't', band); } catch (e) { refused = e.refused; }
  check(refused && refused.join(' ').includes(why), `${name} should be refused for ${why}, got ${JSON.stringify(refused)}`);
}
console.log('refusals: louvre, pixel, window frame and offsets are refused with their reasons');

// 2. window area of the IR against the generator's rule, wall by wall
const ir = fromRecipe(recipe, 'curtain', band, Object.fromEntries(Object.entries(fixture.tones).map(([k, v]) => [fixture.recipe[k + 'Tone'] || k, v])));
const ev = emitJS(ir);
let worstArea = 0;
for (const w of fixture.faces) {
  const L = w.s1 - w.s0, n = Math.max(1, Math.round(L / w.hs / ir.fit.bay)), face = { L, n, hs: w.hs };
  const pred = windowsFor(L, fixture.recipe, w.hs).reduce((s, q) => s + (q.s1 - q.s0) * (q.z1 - q.z0), 0);
  const big = 1e6, c = ev(face, L / 2, 0, big, big);        // a footprint far larger than the wall: coverage = area / footprint area
  // use the exact integral instead: sum of the openings via coverage over the whole wall
  const cx = ev(face, L / 2, 0, L / 2, 1e-3 + 0).opening;   // not used; area below
  void c; void cx;
  const area = (function () { const { cum } = (0, eval)('0') || {}; return null; })();
  void area;
  worstArea = Math.max(worstArea, 0 * pred);
}
{ // area through the pulse description (the same numbers the shader gets), not through a footprint trick
  const { pulses } = await import('./lib/facet.mjs'); const { coreJS } = await import('./lib/facet.mjs'); const { cum } = coreJS(); let worst = 0;
  for (const w of fixture.faces) {
    const L = w.s1 - w.s0, n = Math.max(1, Math.round(L / w.hs / ir.fit.bay)), face = { L, n, hs: w.hs }, op = ir.layers.find(l => l.op === 'opening'), p = pulses(ir, op, face);
    const a = cum(L + 1, p.x.P, p.x.a, p.x.b, p.x.i0, p.x.i1) * cum(1e4, p.z.P, p.z.a, p.z.b, p.z.i0, p.z.i1);
    const pred = windowsFor(L, fixture.recipe, w.hs).reduce((s, q) => s + (q.s1 - q.s0) * (q.z1 - q.z0), 0);
    worst = Math.max(worst, Math.abs(a - pred) / Math.max(1, pred));
  }
  check(worst < 1e-9, `window area from the IR differs from the generator's rule by ${worst}`);
  console.log(`IR of ${ir.name}: window area on all ${fixture.faces.length} walls equals the generator's rule (worst relative difference ${worst.toExponential(1)})`);
}

// 3. coverage maths against a brute-force point oracle
function oracle(irx, face, tones) {
  const mod = face.L / face.n, hs = face.hs, F = irx.floors;
  const inPulse = (x, P, a, b, i0, i1) => { const i = Math.floor(x / P); return i >= i0 && i < i1 && x - i * P >= a && x - i * P < b; };
  return (s, zp, d = [0, 0]) => {                       // the colour of a point: painter's order, written from the rules
    let col = tones[irx.layers[0].tone];
    for (const L of irx.layers.slice(1)) {
      if (L.op === 'strip') {
        const sw = L.w * hs, P = L.every * mod;
        const hit = L.at === 'joints' ? inPulse(s + sw / 2, P, 0, sw, 0, Math.floor(face.n / L.every) + 1) : inPulse(s, P, 0.5 * mod - sw / 2, 0.5 * mod + sw / 2, 0, Math.ceil(face.n / L.every));
        if (hit) col = tones[L.tone];
      } else if (L.op === 'floorline') { if (inPulse(zp, F.pitch, 0, L.h, 0, F.count)) col = tones[L.tone]; }
      else if (L.op === 'opening') {
        const a = mod / 2 - L.w * hs / 2, ok = a >= 0.05 * hs, i0 = ok ? 0 : 1, i1 = ok ? face.n : face.n - 1;
        const inOpen = (ss, zz) => inPulse(ss, mod, a, a + L.w * hs, i0, i1) && inPulse(zz, F.pitch, L.sill, L.sill + L.h, 0, F.rows);
        if (inOpen(s, zp)) col = inOpen(s + d[0], zp + d[1]) ? tones[L.glass] : tones[L.revealTone];
      }
    }
    return col;
  };
}
const rnd = (() => { let x = 7; return () => (x = (x * 1664525 + 1013904223) >>> 0) / 4294967296; })();
function compare(irx, tones, face, label, samples = 120) {
  const ev2 = emitJS(irx), orc = oracle(irx, face, tones), res = { max: 0, sum: 0, n: 0, overlap: 0, overlapN: 0 };
  for (let t = 0; t < samples; t++) {
    const hx = Math.pow(10, -2 + rnd() * 2.3), hz = Math.pow(10, -2 + rnd() * 2.3), s = rnd() * face.L, zp = rnd() * irx.floors.pitch * irx.floors.count, d = [(rnd() - 0.5) * 0.2, (rnd() - 0.5) * 0.2];
    const c = composeJS(ev2(face, s, zp, hx, hz, d), tones);
    const N = 36; const acc = [0, 0, 0];
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { const col = orc(s - hx + (i + 0.5) / N * 2 * hx, zp - hz + (j + 0.5) / N * 2 * hz, d); for (let k = 0; k < 3; k++) acc[k] += col[k] / (N * N); }
    const e = (Math.abs(c[0] - acc[0]) + Math.abs(c[1] - acc[1]) + Math.abs(c[2] - acc[2])) / 3;
    res.max = Math.max(res.max, e); res.sum += e; res.n++;
  }
  console.log(`${label}: mean abs difference ${(res.sum / res.n).toFixed(3)}, worst ${res.max.toFixed(2)} (0 to 255, ${samples} random footprints, ${36 * 36} samples each)`);
  return res;
}
const tonesRGB = Object.fromEntries(Object.entries(ir.tones).map(([k, v]) => [k, v.day]));
const wall = fixture.faces[40], face = { L: wall.s1 - wall.s0, n: Math.max(1, Math.round((wall.s1 - wall.s0) / wall.hs / ir.fit.bay)), hs: wall.hs };
const r1 = compare(ir, tonesRGB, face, 'Dobie curtain (field + opening, parallax on)');
check(r1.sum / r1.n < 0.5 && r1.max < 6, 'the closed form disagrees with the oracle on the real skin');
// synthetic: disjoint layers (strips at joints and an opening) -> exact; then strips x floor lines (overlapping) -> approximate
const syn = JSON.parse(JSON.stringify(ir)); syn.fit.bay = 3.2; syn.tones = { wall: { day: [200, 190, 170] }, strip: { day: [120, 110, 100] }, line: { day: [60, 60, 60] }, glass: { day: [40, 90, 110] }, rev: { day: [30, 30, 30] } };
syn.layers = [{ op: 'field', tone: 'wall' }, { op: 'strip', tone: 'strip', w: 0.5, at: 'joints', every: 2 }, { op: 'opening', w: 1.4, h: 1.5, sill: 0.9, reveal: 0.12, glass: 'glass', revealTone: 'rev' }];
const T2 = Object.fromEntries(Object.entries(syn.tones).map(([k, v]) => [k, v.day])), f2 = { L: 19.2, n: 6, hs: 1 };
const r2 = compare(syn, T2, f2, 'synthetic: strips at joints (every 2nd) + opening: disjoint layers');
check(r2.sum / r2.n < 1.0 && r2.max < 12, 'disjoint layers should agree with the oracle up to its own sampling noise');
const syn2 = JSON.parse(JSON.stringify(syn)); syn2.layers = [{ op: 'field', tone: 'wall' }, { op: 'strip', tone: 'strip', w: 0.9, at: 'centres', every: 1 }, { op: 'floorline', tone: 'line', h: 0.5 }];
const r3 = compare(syn2, T2, f2, 'synthetic: strips at centres x floor lines: OVERLAPPING layers (the approximation Astra warned about)');
console.log(`  -> measured: mean ${(r3.sum / r3.n).toFixed(2)}, worst ${r3.max.toFixed(1)} of 255. Why it is small: a strip depends on s only and a floor line on z only, and over a box footprint the average of a product of independent axes is the product of the averages, so painter's-order compositing of such layers is exact (the remaining difference is the oracle's own sampling noise). It stops being exact only where two layers are both 2D rectangles that overlap (a head panel over a window): not in v0.`);
check(r3.sum / r3.n < 1.0, 'overlap error is larger than expected');

// 4. generated GLSL sanity (a compile needs a GPU: the AWS run does it) and the baked package
const g = emitGLSL(ir);
const bal = s => (s.match(/\{/g) || []).length === (s.match(/\}/g) || []).length;
check(bal(g.vs) && bal(g.fs) && g.fs.startsWith('#version 300 es') && g.vs.startsWith('#version 300 es'), 'generated GLSL braces/version');
const pkg = bake(ir, fixture.faces);
check(pkg.triangles === fixture.faces.length * 2 && pkg.vertices.length === fixture.faces.length * 4 * 12, 'baked package size');
console.log(`generated ${g.vs.length + g.fs.length} bytes of GLSL; wall package ${pkg.bytes} bytes, ${pkg.triangles} triangles (geometry: ${fixture.facade.triangles} triangles)`);

// 5. the budget logic on a made-up sweep
const b = budget([{ dist: 55, bayPx: 11.7, errF: 0.3, errNear: 0.15, flickF: 0.7, flickNear: 0.25 }, { dist: 230, bayPx: 2.8, errF: 1.6, errNear: 1.1, flickF: 3.3, flickNear: 1.7 }, { dist: 1100, bayPx: 0.6, errF: 5.9, errNear: 5.4, flickF: 8.2, flickNear: 5.9 }], 1.5);
check(!b.pass && b.geometryAtDistances.join() === '55' && b.switchBayPx > 2.8 && b.switchBayPx < 11.7, 'only the 55 m row exceeds the gate: a clean near/far switch: ' + JSON.stringify([b.geometryAtDistances, b.switchBayPx]));
const b1 = budget([{ dist: 55, bayPx: 11.7, errF: 0.2, errNear: 0.15, flickF: 0.3, flickNear: 0.25 }, { dist: 230, bayPx: 2.8, errF: 3.2, errNear: 1.1, flickF: 3.3, flickNear: 1.7 }, { dist: 500, bayPx: 1.3, errF: 3.0, errNear: 2.7, flickF: 6, flickNear: 3.2 }], 1.5);
check(!b1.pass && b1.switchBayPx === null, 'a failure in the middle is not a clean split and must not invent a switch');
const b2 = budget([{ dist: 55, bayPx: 11.7, errF: 0.5, errNear: 0.15, flickF: 0.7, flickNear: 0.25 }, { dist: 230, bayPx: 2.8, errF: 1.2, errNear: 1.1, flickF: 3.3, flickNear: 1.7 }], 1.5);
check(!b2.pass && b2.switchBayPx > 2.8 && b2.switchBayPx < 11.7, 'near-only failure should give a switch between the rows');
const b3 = budget([{ dist: 55, bayPx: 11.7, errF: 0.2, errNear: 0.15, flickF: 0.3, flickNear: 0.25 }], 1.5);
check(b3.pass, 'a sweep inside the gates passes');
console.log('budget logic: three cases (all outside, near-field only outside, all inside) behave');
console.log(fails ? `${fails} FAILURE(S)` : 'facet selftest: all checks pass'); process.exit(fails ? 1 : 0);
