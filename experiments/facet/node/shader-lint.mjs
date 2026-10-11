/**
 * node/shader-lint.mjs - a static check of the SHADER TEXT the Facet flag builds, with no GPU: it assembles the app's real vertex and fragment source
 * (js/slopes.js with the real CityLighting / WallPatterns / RoofTiles strings), splices js/facet-walls.js in, resolves the #ifdef blocks the way
 * the compiler will (FACET_WALL defined, nothing else), and reports (1) a global declared twice, (2) a global used before it is declared (3) braces
 * that do not balance. It found nothing a GPU compiler would not, and it is NOT a GLSL compiler: the AWS run is the compile. It exists because the
 * first run on the GPU failed on a uniform the wall-pattern module had already declared ("redefinition"), a mistake a text check catches in a second.
 *   node experiments/facet/node/shader-lint.mjs [--dump dir]
 */
import fs from 'node:fs'; import vm from 'node:vm'; import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const R = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..') + '/';
const ctx = globalThis; ctx.window = ctx; ctx.self = ctx; ctx.location = { search: '?facadeshader=1', href: 'http://x/' };
ctx.document = { getElementById: () => null, hidden: false, createElement: () => ({ getContext: () => null, style: {}, setAttribute() {}, appendChild() {} }), addEventListener() {}, body: {}, head: { appendChild() {} }, currentScript: null };
ctx.addEventListener = () => {}; ctx.devicePixelRatio = 1; Object.defineProperty(ctx, 'navigator', { value: { userAgent: 'node' }, configurable: true });
const { installStubs } = await import('./app-patch.mjs'); installStubs(ctx);
const three = process.env.THREE_JS || path.join(os.homedir(), 'flyover-private/renderer-2026-10-09/libs/three.min.js');
const log = console.log; console.warn = console.log = () => {};
vm.runInThisContext(fs.readFileSync(three, 'utf8'));
for (const f of ['js/wall-patterns.js', 'js/city-lighting.js']) vm.runInThisContext(fs.readFileSync(R + f, 'utf8'), { filename: f });
let slopes = fs.readFileSync(R + 'js/slopes.js', 'utf8');
slopes = slopes.replace('let originMerc = null, originScale = 0;', 'let originMerc = maplibregl.MercatorCoordinate.fromLngLat({ lng: -97.7393587, lat: 30.2860098 }, 0), originScale = originMerc.meterInMercatorCoordinateUnits();');
const hook = '  let _map = null, _gl = null;'; if (!slopes.includes(hook)) throw new Error('slopes.js moved');
slopes = slopes.replace(hook, '  window.__SRC = { VERT, FRAG };\n' + hook);
vm.runInThisContext(slopes, { filename: 'slopes.js' });
vm.runInThisContext(fs.readFileSync(R + 'js/facet-walls.js', 'utf8'), { filename: 'facet-walls.js' });
const { VERT, FRAG } = ctx.__SRC, { vs, fs: fsrc } = ctx.FACET.collector().patch(VERT, FRAG);
console.log = log;

function preprocess(src, defs) {
  const out = []; const stack = [];
  for (const line of src.split('\n')) {
    const t = line.trim();
    let m;
    if ((m = t.match(/^#ifdef\s+(\w+)/))) { const on = defs.has(m[1]); stack.push({ on, taken: on, parent: stack.length ? stack.at(-1).active : true, active: (stack.length ? stack.at(-1).active : true) && on }); continue; }
    if ((m = t.match(/^#ifndef\s+(\w+)/))) { const on = !defs.has(m[1]); stack.push({ on, taken: on, parent: stack.length ? stack.at(-1).active : true, active: (stack.length ? stack.at(-1).active : true) && on }); continue; }
    if ((m = t.match(/^#if\s+(.*)/))) { stack.push({ on: false, taken: false, parent: stack.length ? stack.at(-1).active : true, active: false }); continue; }
    if (/^#else/.test(t)) { const s = stack.at(-1); s.on = !s.taken; s.taken = true; s.active = s.parent && s.on; continue; }
    if (/^#endif/.test(t)) { stack.pop(); continue; }
    if (!stack.length || stack.at(-1).active) out.push(line);
  }
  return out.join('\n');
}
function lint(name, src, defs) {
  const text = preprocess(src, defs).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');
  const problems = []; let depth = 0;
  const decl = new Map(); const order = [];
  // walk character by character tracking brace depth; at depth 0 find declarations and function definitions
  let top = '';
  const flush = () => { const s = top.trim(); top = ''; if (!s) return; const m = s.match(/^(uniform|attribute|varying|in|out)\s+(?:(?:highp|mediump|lowp)\s+)?\w+\s+([\w\s,\[\]]+)$/); if (m) { for (const n of m[2].split(',').map(x => x.trim().replace(/\[.*\]/, '')).filter(Boolean)) { if (decl.has(n)) problems.push(`${name}: '${n}' declared twice (${decl.get(n)} and ${m[1]})`); decl.set(n, m[1]); order.push(n); } } else { const f = s.match(/^(?:\w+\s+)?(?:highp\s+)?\w+\s+(\w+)\s*\(/); if (f && !/^(if|for|while)$/.test(f[1])) { if (decl.has('fn:' + f[1]) && !/^main$/.test(f[1])) problems.push(`${name}: function '${f[1]}' defined twice`); decl.set('fn:' + f[1], 'fn'); order.push('fn:' + f[1]); } } };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '{') { if (depth === 0) flush(); depth++; continue; }
    if (c === '}') { depth--; if (depth < 0) problems.push(name + ': unbalanced }'); continue; }
    if (depth === 0) { if (c === ';') { flush(); } else top += c; }
  }
  if (depth !== 0) problems.push(`${name}: braces do not balance (${depth})`);
  // use-before-declare of OUR globals: any u_f*/v_f*/F* identifiers, plus every u_ uniform, at depth > 0 or in later functions
  const firstUse = new Map(); const re = /\b(u_\w+|v_\w+|FD|FTn|fCum|fCov|fIv|fLit|fMixP)\b/g; let m;
  const strip = text; while ((m = re.exec(strip))) if (!firstUse.has(m[1])) firstUse.set(m[1], m.index);
  const declPos = new Map(); for (const n of order) { const key = n.replace(/^fn:/, ''); const idx = n.startsWith('fn:') ? strip.search(new RegExp('\\b(?:float|vec\\d|ivec\\d|int|bool|void|mat\\d)\\s+' + key + '\\s*\\(')) : strip.search(new RegExp('\\b' + key + '\\b')); declPos.set(key, idx); }
  for (const [n, u] of firstUse) { if (!declPos.has(n)) { if (/^u_|^v_/.test(n) && !/^(u_f|v_f)/.test(n)) continue; problems.push(`${name}: '${n}' used but never declared`); } else if (declPos.get(n) > u && declPos.get(n) !== u) problems.push(`${name}: '${n}' used (offset ${u}) before it is declared (offset ${declPos.get(n)})`); }
  return { problems, decls: decl.size, chars: text.length };
}
let bad = 0;
{ // the linter must be able to fail: a uniform declared twice, and a function used before it is defined
  const t = lint('selftest', 'uniform float u_a;\nuniform float u_a;\nvoid main() { float x = fLit(u_a); }\nvec3 fLit(float a) { return vec3(a); }', new Set());
  if (t.problems.length < 2) { log('SELFTEST FAILED: the linter did not catch a duplicate uniform and a use before declaration: ' + JSON.stringify(t.problems)); process.exit(2); }
}
for (const [name, src] of [['vertex', vs], ['fragment', fsrc]]) {
  const r = lint(name, src, new Set(['FACET_WALL']));
  log(`${name}: ${r.chars} characters after preprocessing, ${r.decls} global declarations; ${r.problems.length ? r.problems.length + ' PROBLEM(S)' : 'no problems found'}`);
  for (const p of r.problems) { log('  ' + p); bad++; }
}
const dump = process.argv.indexOf('--dump'); if (dump > 0) { const d = process.argv[dump + 1]; fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'facet.vert.glsl'), preprocess(vs, new Set(['FACET_WALL']))); fs.writeFileSync(path.join(d, 'facet.frag.glsl'), preprocess(fsrc, new Set(['FACET_WALL']))); }
process.exit(bad ? 1 : 0);
