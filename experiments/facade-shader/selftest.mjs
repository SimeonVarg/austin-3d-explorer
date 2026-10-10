/**
 * selftest.mjs - the shader's pattern maths, tested without a GPU. The fragment shader's `cum` and `cov` functions are taken
 * out of page/lab.js AS TEXT, turned into JavaScript, and checked against brute-force sampling of the window rule.
 *     node experiments/facade-shader/selftest.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { windowsFor, bayParams } from './lib/pattern.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(HERE, 'page/lab.js'), 'utf8');
const glsl = name => { const m = src.match(new RegExp('float ' + name + '\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}')); if (!m) throw new Error('no ' + name + ' in lab.js'); return m[0]; };
const toJs = t => t.replace(/float (\w+)\(([^)]*)\)/, (_, n, a) => `function ${n}(${a.replace(/float /g, '')})`).replace(/\bfloat (\w+) =/g, 'let $1 =').replace(/\bfloat (\w+);/g, 'let $1;').replace(/\bclamp\(/g, 'clamp(').replace(/\bfloor\(/g, 'Math.floor(').replace(/\bmax\(/g, 'Math.max(').replace(/(\d)\.0\b/g, '$1.0');
const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
const code = toJs(glsl('cum')) + '\n' + toJs(glsl('cov')) + '\nreturn { cum, cov };';
const { cum, cov } = new Function('clamp', code)(clamp);
let fails = 0; const check = (ok, msg) => { if (!ok) { fails++; console.log('FAIL', msg); } };

// 1. cov() against brute-force sampling of a pulse train, many footprints
const rnd = (() => { let s = 12345; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; })();
let worst = 0;
for (let t = 0; t < 400; t++) {
  const P = 0.5 + rnd() * 3, a = rnd() * P * 0.4, b = a + rnd() * (P - a) * 0.9, i0 = Math.floor(rnd() * 2), i1 = i0 + 1 + Math.floor(rnd() * 20);
  const x = rnd() * P * (i1 + 2), h = Math.pow(10, -3 + rnd() * 3.2);
  const N = 4000; let acc = 0;
  for (let k = 0; k < N; k++) { const xs = x - h + (k + 0.5) / N * 2 * h, i = Math.floor(xs / P), ph = xs - i * P; if (i >= i0 && i < i1 && ph >= a && ph < b) acc++; }
  worst = Math.max(worst, Math.abs(acc / N - cov(x, h, P, a, b, i0, i1)));
}
check(worst < 2e-3, `cov differs from brute force by ${worst}`);
console.log(`cov() against 400 random footprints sampled 4000 times each: worst difference ${worst.toExponential(2)}`);

// 2. the shader's per-wall numbers (bayParams) give the same windows as the rule (windowsFor): integrate cov over each window
const meta = JSON.parse(fs.readFileSync(path.join(HERE, 'fixture/dobie-twenty21.json'), 'utf8')), r = meta.recipe;
let bad = 0, wins = 0, area = 0;
for (const f of meta.faces) {
  const L = f.s1 - f.s0, p = bayParams(L, r, f.hs), pred = windowsFor(L, r, f.hs);
  const eachRow = pred.length / Math.max(1, (p.i1 - p.i0));      // rows of windows
  // total area from the closed form = sum over bays and rows
  const aX = cum(L + 1, p.mod, p.a, p.b, p.i0, p.i1), aZ = cum(1000, r.rowPitch, r.window.sill, r.window.sill + r.window.h, 0, r.rowCount);
  const exp = pred.reduce((s, w) => s + (w.s1 - w.s0) * (w.z1 - w.z0), 0);
  wins += pred.length; area += exp;
  if (Math.abs(aX * aZ - exp) > 1e-6 * Math.max(1, exp)) bad++;
}
check(bad === 0, `${bad} walls where the shader's closed form and the rule disagree on window area`);
console.log(`${meta.faces.length} walls, ${wins} windows, total window area ${area.toFixed(1)} m2: closed form and rule agree on every wall`);

// 3. the rule survives a rotated frame: mirror-symmetric windows (so the shader may start s at either end of a wall)
let asym = 0;
for (const f of meta.faces) { const L = f.s1 - f.s0, w = windowsFor(L, r, f.hs); const set = new Set(w.map(q => q.z0.toFixed(3) + '/' + (q.s0).toFixed(3))), set2 = new Set(w.map(q => q.z0.toFixed(3) + '/' + (L - q.s1).toFixed(3))); for (const k of set) if (!set2.has(k)) { asym++; break; } }
check(asym === 0, `${asym} walls whose window pattern is not mirror-symmetric`);
console.log(`mirror symmetry: ${asym} asymmetric walls`);
console.log(fails ? `${fails} FAILURE(S)` : 'selftest: all checks pass');
process.exit(fails ? 1 : 0);
