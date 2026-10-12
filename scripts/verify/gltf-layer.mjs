/**
 * gltf-layer.mjs — the Blender-model layer (js/gltf-layer.js), no browser, no server.
 *
 * Runs the layer's own files in a sandbox with `?gltf=1` and then without, and holds it to what its header promises:
 *   - OFF (no switch): adds the table and nothing else. hides() is false for every recipe, nothing is fetched, the drawing
 *     file is not asked for, no parser.
 *   - ON: hides() is true for exactly the recipe ids in the table, and every one of them is a real recipe file's id
 *     in data/apartments/index.json (a stale id would draw the model ON TOP of the recipe).
 *   - the .glb of every table row parses: flat colours only, triangles counted, positions finite, standing on the ground
 *     (lowest point 0), metres (taller than 20 m, wider than 10 m, nothing over 500 m), the windings mostly face outward.
 *   - a file with an image, a node transform or a non-triangle primitive is REFUSED, not drawn.
 * Usage: node scripts/verify/gltf-layer.mjs        (--break: ruin the table's recipe id; must exit 1)
 */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = fs.readFileSync(path.join(ROOT, 'js/gltf-layer.js'), 'utf8');
const drawSrc = fs.readFileSync(path.join(ROOT, 'js/gltf-layer-draw.js'), 'utf8');
let failed = 0;
const check = (ok, what, extra = '') => { console.log((ok ? '  PASS  ' : '  FAIL  ') + what + (extra ? '  ' + extra : '')); if (!ok) failed++; };

function boot(search) {
  const fetched = [], scripts = [];
  const win = { location: { search }, fetch: u => { fetched.push(u); return Promise.reject(new Error('no network in this test')); } };
  win.window = win;
  const document = { createElement: () => ({}), head: { appendChild: t => { scripts.push(t.src); } } };
  const ctx = vm.createContext({ window: win, document, URLSearchParams, TextDecoder, DataView, Uint8Array, Float32Array, Uint32Array, console: { log() {}, warn() {}, error() {} },
    setInterval: () => 0, clearInterval() {}, fetch: win.fetch, AbortController, setTimeout: () => 0, clearTimeout() {}, performance, location: win.location });
  vm.runInContext(src, ctx);
  // the page would now fetch the drawing file named by the table: run it, the way the browser does, but only if it was asked for
  if (scripts.length) { check(scripts.length === 1 && scripts[0] === win.GLTF_LAYER.drawScript && fs.existsSync(path.join(ROOT, scripts[0])), 'the one script it asks for is the drawing file, and it exists', scripts[0]); vm.runInContext(drawSrc, ctx); }
  return { G: win.GLTF_LAYER, fetched, scripts };
}

console.log('gltf-layer: switch OFF');
const off = boot('');
check(off.G && off.G.on === false, 'GLTF_LAYER.on is false without ?gltf=1');
check(off.G.buildings.every(b => !off.G.hides({ id: b.replaces })), 'hides() is false for every recipe when off');
check(typeof off.G.parse === 'undefined', 'no parser, no loader state when off');
check(off.fetched.length === 0 && off.scripts.length === 0, 'nothing fetched and no script asked for when off');

console.log('gltf-layer: switch ON');
const on = boot('?gltf=1'); const G = on.G;
check(G.on === true, 'GLTF_LAYER.on is true with ?gltf=1');
const idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/apartments/index.json'), 'utf8'));
const recipeIds = new Map();
for (const f of idx.buildings) { try { const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/apartments', f), 'utf8')); if (j.id) recipeIds.set(j.id, f); } catch (e) {} }
const rows = G.buildings.map(b => process.argv.includes('--break') ? { ...b, replaces: b.replaces.replace(/^./, 'x') } : b);
for (const row of rows) {
  console.log('  row: ' + row.name);
  check(recipeIds.has(row.replaces), 'its `replaces` id is a recipe in data/apartments/index.json', recipeIds.get(row.replaces) || '');
  check(G.hides({ id: row.replaces }) && !G.hides({ id: 'not-a-recipe' }) && !G.hides({}), 'hides() is true for that recipe and no other');
  check(G.stub({ id: row.replaces, name: row.name }).top === row.topM && row.topM > 20, 'the stub in the apartments built list carries the model height (flight collision)', 'topM ' + row.topM);
  const glb = fs.readFileSync(path.join(ROOT, row.file));
  const ab = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength);
  let meshes = null; try { meshes = G.parse(ab); } catch (e) { check(false, 'the .glb parses', e.message); continue; }
  const tris = meshes.reduce((n, m) => n + m.idx.length / 3, 0);
  check(meshes.length > 0 && tris > 100, 'the .glb parses to flat-coloured meshes', meshes.length + ' meshes, ' + tris + ' triangles');
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], finite = true, outOfRange = 0;
  for (const m of meshes) { for (let i = 0; i < m.pos.length; i += 3) for (let c = 0; c < 3; c++) { const v = m.pos[i + c]; if (!Number.isFinite(v)) finite = false; lo[c] = Math.min(lo[c], v); hi[c] = Math.max(hi[c], v); } for (const i of m.idx) if (i * 3 >= m.pos.length) outOfRange++; }
  check(finite && outOfRange === 0, 'positions are finite and every index is inside its mesh');
  const height = hi[1] - lo[1], bx = hi[0] - lo[0], bz = hi[2] - lo[2];   // glTF is Y-up
  check(Math.abs(lo[1]) < 0.05, 'it stands on the ground (lowest point is 0 m)', 'lowest ' + lo[1].toFixed(3));
  check(Math.abs(height + (row.groundM || 0) - row.topM) < 0.1, 'topM is the file height plus groundM', (height + (row.groundM || 0)).toFixed(2) + ' vs ' + row.topM);
  check(height > 20 && height < 500 && bx > 10 && bz > 10, 'it is in metres', height.toFixed(1) + ' m tall, ' + bx.toFixed(1) + ' x ' + bz.toFixed(1) + ' m on the ground');
  // windings: for walls (normal mostly horizontal) the normal should point away from the building's middle for most triangles
  let walls = 0, outward = 0; const cx = (lo[0] + hi[0]) / 2, cz = (lo[2] + hi[2]) / 2;
  for (const m of meshes) for (let k = 0; k < m.idx.length; k += 3) {
    const p = [0, 1, 2].map(j => m.idx[k + j] * 3), P = p.map(o => [m.pos[o], m.pos[o + 1], m.pos[o + 2]]);
    const u = P[1].map((v, c) => v - P[0][c]), w = P[2].map((v, c) => v - P[0][c]);
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], L = Math.hypot(...n);
    if (L < 1e-9 || Math.abs(n[1]) / L > 0.3) continue;
    walls++; const mid = [(P[0][0] + P[1][0] + P[2][0]) / 3 - cx, (P[0][2] + P[1][2] + P[2][2]) / 3 - cz];
    if (n[0] * mid[0] + n[2] * mid[1] > 0) outward++;
  }
  check(walls > 100 && outward / walls > 0.7, 'wall triangles are wound to face outward (the sun lights the right side)', outward + ' of ' + walls);
  // refusals: edit the file's JSON chunk in memory and see the loader say no
  const dv = new DataView(ab), jl = dv.getUint32(12, true), json = JSON.parse(Buffer.from(ab, 20, jl).toString());
  const rewrite = mod => { const j = JSON.parse(JSON.stringify(json)); mod(j); let t = Buffer.from(JSON.stringify(j)); const pad = (4 - t.length % 4) % 4; t = Buffer.concat([t, Buffer.alloc(pad, 0x20)]);
    const rest = Buffer.from(ab, 20 + jl); const head = Buffer.alloc(20); head.writeUInt32LE(0x46546C67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(20 + t.length + rest.length, 8); head.writeUInt32LE(t.length, 12); head.writeUInt32LE(0x4E4F534A, 16);
    const out = Buffer.concat([head, t, rest]); return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength); };
  const refuses = (mod) => { try { G.parse(rewrite(mod)); return false; } catch (e) { return true; } };
  check(refuses(j => { j.images = [{ uri: 'x.png' }]; }), 'a file with an image is refused');
  check(refuses(j => { j.nodes[0].translation = [1, 2, 3]; }), 'a file with a node transform is refused');
  check(refuses(j => { j.meshes[0].primitives[0].mode = 1; }), 'a file with a non-triangle primitive is refused');
  check(!refuses(j => { j.asset.generator = 'x'; }), 'a harmless edit of the JSON chunk still parses (the refusals above are real)');
  // nothing in the JSON that names a person, a folder or a photograph
  const text = JSON.stringify(json);
  check(!/photo|\.jpg|\.png|users|home|[a-z]:\\|\/[a-z]+\//i.test(text), 'the .glb names no folder, file or photograph');
}
console.log(failed ? '\nFAILED: ' + failed : '\nall passed');
process.exit(failed ? 1 : 0);
