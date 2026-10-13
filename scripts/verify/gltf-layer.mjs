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
  if (scripts.length) {
    // the drawing file first; then, only when a row names a `look` file, the app's light and the code that draws with it: nothing else
    const G0 = win.GLTF_LAYER, extra = G0.look && G0.look.on && G0.buildings.some(b => b.look) ? G0.look.scripts : [];
    check(scripts.length === 1 + extra.length && scripts[0] === G0.drawScript && extra.every((x, i) => scripts[i + 1] === x) && scripts.every(x => fs.existsSync(path.join(ROOT, x))),
      'the scripts it asks for are the drawing file and the ' + extra.length + ' file(s) of the app\'s light, and they exist', scripts.join(', '));
    vm.runInContext(drawSrc, ctx);
  }
  return { G: win.GLTF_LAYER, fetched, scripts, win };
}

console.log('gltf-layer: switch OFF');
const off = boot('');
check(off.G && off.G.on === false, 'GLTF_LAYER.on is false without ?gltf=1');
check(off.G.buildings.every(b => !off.G.hides({ id: b.replaces })), 'hides() is false for every recipe when off');
check(typeof off.G.parse === 'undefined', 'no parser, no loader state when off');
check(off.fetched.length === 0 && off.scripts.length === 0, 'nothing fetched and no script asked for when off');

console.log('gltf-layer: switch ON');
const on = boot('?gltf=1'); const G = on.G, win = on.win;
check(G.on === true, 'GLTF_LAYER.on is true with ?gltf=1');
const idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/apartments/index.json'), 'utf8'));
const recipeIds = new Map();
for (const f of idx.buildings) { try { const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/apartments', f), 'utf8')); if (j.id) recipeIds.set(j.id, f); } catch (e) {} }
// a building can also be an entry of one of the collections the index lists (the apartments builder draws those the same way)
for (const f of idx.collections || []) { try { const j = JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); for (const b of j.buildings || []) if (b.id && !recipeIds.has(b.id)) recipeIds.set(b.id, f); } catch (e) {} }
// ... or of a collection an area lists
for (const a of Object.values(idx.areas || {})) for (const f of (a && a.collections) || []) { try { const j = JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); for (const b of j.buildings || []) if (b.id && !recipeIds.has(b.id)) recipeIds.set(b.id, f); } catch (e) {} }
const rows = G.buildings.map(b => process.argv.includes('--break') ? { ...b, replaces: b.replaces.replace(/^./, 'x') } : b);
for (const row of rows) {
  console.log('  row: ' + row.name);
  check(recipeIds.has(row.replaces), 'its `replaces` id is a recipe or a collection entry the apartments builder draws (data/apartments/index.json)', recipeIds.get(row.replaces) || '');
  check(G.hides({ id: row.replaces }) && !G.hides({ id: 'not-a-recipe' }) && !G.hides({}), 'hides() is true for that recipe and no other');
  check(G.stub({ id: row.replaces, name: row.name }).top === row.topM && row.topM > 5, 'the stub in the apartments built list carries the model height (flight collision)', 'topM ' + row.topM);
  for (const id of row.alsoReplaces || []) check(recipeIds.has(id) && G.hides({ id }), 'a further recipe it replaces is one the apartments builder draws, and is hidden', recipeIds.get(id) || id);
  if (!row.file) check(!!row.look, 'a row with no flat-colour file has a look file (it is drawn under the app\'s light or not at all)');
  flat: if (row.file) {
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
  // the code that runs in the page with this file: faces, panes, sun sides, colours, the whole building loop (a fake builder counts what it is given)
  {
    const I = G.internals, F = G.faces, total = meshes.reduce((n, m) => n + m.idx.length / 3, 0);
    const plan = F.plan(meshes); check(plan.length >= 3 && plan.every(f => f.details >= G.facade.minDetails && f.s1 > f.s0 && f.z1 > f.z0), 'wall faces are planned (each with enough quads on it)', plan.length + ' faces');
    const pal = F.palette(meshes, row), painted = plan.map(f => F.paint(f, pal));
    check(painted.every(x => x.width * x.height * 4 === x.day.length && x.day.every(v => v >= 0 && v <= 255)), 'every wall map is painted, texel by texel', painted.reduce((n, x) => n + x.width * x.height, 0) + ' texels');
    const glass = meshes.filter(m => /^glass/.test(m.material) && (row.materials || G.materials)[m.material] && (row.materials || G.materials)[m.material].lit).sort((a, b) => b.idx.length - a.idx.length)[0], addr = I.paneAddress(glass.pos, glass.idx, row);
    check(addr.wide.some(v => v === 0) && (row.name !== 'Yugo Austin Waterloo' || addr.wide.some(v => v === 1)), 'room windows are told apart from long strips of glazing (the tower has a crown of them)', addr.wide.filter(v => v).length + ' triangles in strips');
    check(Math.max(...addr.floor) >= 3 && Math.max(...addr.col) >= 3 && addr.wall.every(w => typeof w === 'string'), 'every glass pane gets a wall, a floor and a column for the night rules', 'floors 0 to ' + Math.max(...addr.floor) + ', up to ' + (Math.max(...addr.col) + 1) + ' columns');
    const white = meshes.find(m => m.material === 'white'), sides = I.sunSides(white.pos, white.idx, row.headingDeg, row);
    check(sides.some(v => v === 1) && sides.some(v => v === 0), 'the sun reaches some faces of the building and not others at the photograph\'s hour');
    for (const m of meshes) for (const side of ['shade', 'sun']) { const c = I.tripleFor(m, side, undefined, row); if (!(c.length === 3 && c.every(h => /^#[0-9a-f]{6}$/.test(h)))) check(false, 'colour triple of ' + m.material); }
    check(true, 'every material has a valid [day, golden, night] triple on both sides');
    let tris = 0, bad = 0, groups = 0;
    const T = { Group: class { constructor() { this.children = []; this.userData = {}; } add(o) { this.children.push(o); groups++; } }, Mesh: class { constructor(g, m) { this.geometry = g; this.material = m; this.userData = {}; } }, DoubleSide: 2, FrontSide: 0, BufferAttribute: class { constructor(a, n) { this.array = a; this.itemSize = n; } }, Vector3: class { constructor(x, y, z) { this.x = x; this.y = y; this.z = z; } } };
    const S = { toLocal: (lng, lat, z) => ({ x: 0, y: 0, z }), material: () => ({ vertexShader: 'attribute vec2 aGrad;\n v_albedo = cDay;', defaultAttributeValues: {} }),
      build: () => ({ tri(a, b, c, col) { tris++; if (![a, b, c].every(p => p.length === 3 && p.every(Number.isFinite)) || !(col && col.length === 3 && col.every(h => /^#[0-9a-f]{6}$/.test(h)))) bad++; }, geometry: () => ({ attributes: { position: { count: tris * 3 } }, setAttribute() {} }), get triangles() { return tris; } }) };
    for (const withNight of [false, true]) {
      tris = 0; bad = 0;
      const rooms = []; win.CityNight = withNight ? { tune: { on: true, unlitGlass: '#101823' }, register() {}, registerFixtures(spec, frame) { if (spec.night && spec.night.fixtures) rooms.push(frame.at(...spec.night.fixtures[0].position)); }, room: (key, floor, col) => ({ lit: (floor * 7 + col * 3) % 4 === 0, nightTone: '#eadfc8' }) } : undefined;
      win.THREE = T;
      const b = I.buildBuilding(S, row, meshes);
      check(tris === total && bad === 0 && b.triangles === total, 'the building loop draws every triangle (' + total + ') with valid vertices and colours' + (withNight ? ' (with the city\'s night rules)' : ' (without them)'), tris + ' triangles, ' + bad + ' bad, ' + b.litTriangles + ' lit');
      if (withNight && row.night && row.night.fixtures) check(rooms.length === 1 && rooms[0].every(Number.isFinite), 'the building\'s lamps are handed to the city\'s night rules in the world frame');
    }
    win.THREE = undefined; win.CityNight = undefined;
  }
  // nothing in the JSON that names a person, a folder or a photograph
  check(!/photo|\.jpg|\.png|users|home|[a-z]:\\|\/[a-z]+\//i.test(JSON.stringify(json)), 'the .glb names no folder, file or photograph');
  }
  if (row.look) {
    const lb = fs.readFileSync(path.join(ROOT, row.look)), ljl = lb.readUInt32LE(12), lj = JSON.parse(lb.slice(20, 20 + ljl).toString());
    const prims = lj.meshes.flatMap(m => m.primitives);
    check(prims.length > 0 && prims.every(p => p.attributes.NORMAL != null && p.attributes.TEXCOORD_0 != null && p.indices != null), 'its look file has normals, a UV set and indices on every mesh', prims.length + ' meshes');
    check(fs.existsSync(path.join(ROOT, row.look.replace(/\.glb$/, '-sky.png'))), 'the sky-light map of its look file is beside it');
    if (row.lookClearDay) check(fs.existsSync(path.join(ROOT, row.lookClearDay)) && fs.existsSync(path.join(ROOT, row.lookClearDay.replace(/\.glb$/, '-sky.png'))), 'its clear-day file (?skyview=1) and that file\'s sky-light map exist');
    check(!lj.images && !lj.cameras && !/photo|\.jpg|users|home|[a-z]:\\|\/[a-z]+\//i.test(JSON.stringify(lj)), 'its look file carries no image, no camera, and names no folder, file or photograph');
    check(lj.materials.every(m => m.pbrMetallicRoughness && m.extras && m.extras.look_kind) && (row.name !== 'Yugo Austin Waterloo' || lj.materials.some(m => m.extras.look_kind === 'glass' && Array.isArray(m.extras.look_glossy))), 'its materials say what they are (plain or glass), and the tower\'s glass carries its mirror colour');
    check(lb.length < 8e6, 'its look file is under 8 MB', (lb.length / 1e6).toFixed(2) + ' MB');
  }
}
// ── the app's light (js/city-sky.js): the sky and the sun for an hour, as numbers ─────────────────────────
console.log('city-sky: the light for an hour');
{
  const sky = fs.readFileSync(path.join(ROOT, 'js/city-sky.js'), 'utf8');
  const w = { location: { search: '' } }; w.window = w;
  // the app's own sun track, cut down to what this needs: high sun, low sun, night
  w.skyBodies = p => p < 0.4 ? { sun: { az: 180, elev: 55 }, moon: { az: 90, elev: -20 } } : p < 0.55 ? { sun: { az: 255, elev: 8 }, moon: { az: 90, elev: -5 } } : { sun: { az: 300, elev: -30 }, moon: { az: 120, elev: 22 } };
  vm.runInContext(sky, vm.createContext({ window: w, document: { querySelector: () => null, getElementById: () => null }, URLSearchParams, Float32Array, Uint8Array, console }));
  const C = w.CitySky, day = C.at(0.3), gold = C.at(0.5), night = C.at(0.9), lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  check(day.light.length === 17 && day.light.every(c => c.length === 3 && c.every(v => Number.isFinite(v) && v >= 0)), 'the sky light is 17 finite colours, by how far a surface tilts up');
  // The 17 colours are the sky AND the ground's bounce. Under the measured sun the lit ground is bright, so a face that looks down gets
  // about as much as a roof gets from the sky alone; what must hold is that the whole light on a sunlit roof beats both, and that the
  // 17 change smoothly.
  const top = Math.max(...day.light.map(lum)), roofAll = lum(day.light[16]) + lum(day.sunStrength) * day.sunDir[2];
  check(roofAll > 2 * lum(day.light[8]) && roofAll > 2 * lum(day.light[0]) && day.light.every((c, i) => i === 0 || Math.abs(lum(c) - lum(day.light[i - 1])) < 0.35 * top), 'a sunlit roof gets more than twice what the sky and ground give a wall or a face looking down, and the light changes smoothly between', 'down ' + lum(day.light[0]).toFixed(2) + ', wall ' + lum(day.light[8]).toFixed(2) + ', roof with the sun ' + roofAll.toFixed(2));
  check(Math.abs(lum(day.light[0]) / (Math.PI * lum(day.ground)) - 1) < 0.05, 'a face that looks at the ground gets the ground\'s bounce and nothing else (pi times the lit ground)', (lum(day.light[0]) / (Math.PI * lum(day.ground))).toFixed(3));
  check(Math.abs(Math.hypot(...day.sunDir) - 1) < 1e-6 && day.sunDir[2] > 0.7 && lum(day.sunStrength) > 1, 'by day the sun is up and strong', 'strength ' + day.sunStrength.map(v => v.toFixed(2)).join(', '));
  check(gold.sunStrength[0] / gold.sunStrength[2] > 1.5 * day.sunStrength[0] / day.sunStrength[2] && gold.pts[2][1][0] > gold.pts[2][1][2], 'a low sun is warmer, and so is the sky at the level line');
  check(lum(night.light[8]) < 0.1 * lum(day.light[8]) && lum(night.sunStrength) < 0.1 && night.sunDir[2] > 0, 'at night the sky light is a small share of the day\'s and the one light with a direction is the moon');
  check(day.pts.length === 7 && day.pts.every((q, i) => i === 0 || q[0] > day.pts[i - 1][0]), 'the sky is seven stops by height, in order');
  check(day.exposure === 1 && night.exposure === 1, 'the view\'s exposure is 1 unless the page asks (?skyexp=)');
  check(typeof C.glsl === 'string' && ['csSkyLight', 'csMirror', 'csDisplay'].every(n => C.glsl.includes('vec3 ' + n + '(')), 'the shader code has the three functions a surface needs');
}
// ── the Blender rig (scripts/blender_light_rig.py) carries the same numbers as the app's light ─────────────
console.log('the standard light for Blender builders');
{
  const { rigText, HOURS } = await import('../city-sky-rig.mjs');
  const py = fs.readFileSync(path.join(ROOT, 'scripts/blender_light_rig.py'), 'utf8'), m = py.match(/# RIG-BEGIN[^\n]*\n([\s\S]*?)# RIG-END/);
  check(!!m && m[1] === rigText(), 'scripts/blender_light_rig.py holds the numbers js/city-sky.js gives today (else: node scripts/city-sky-rig.mjs)', Object.keys(HOURS).join(', '));
  check(['def apply(', 'def sun_from_photo(', 'def check(', 'def base_colour(', 'def gate('].every(t => py.includes(t)), 'it has the three calls a builder needs, and the colour function and the gate');
}
// ── the generated rows (js/gltf-rows.js): each has its look file and sky-light map, no image inside, and its height is the file's ──────
console.log('the rows of js/gltf-rows.js');
{
  const w = {}; vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/gltf-rows.js'), 'utf8'), vm.createContext({ window: w }));
  const rows = w.GLTF_ROWS || [], bad = [], ids = new Set(); let tris = 0, bytes = 0;
  for (const r of rows) {
    const f = path.join(ROOT, 'data/gltf', r.slug + '-look.glb');
    if (!fs.existsSync(f) || !fs.existsSync(f.replace(/\.glb$/, '-sky.png'))) { bad.push(r.slug + ': file or sky-light map missing'); continue; }
    const buf = fs.readFileSync(f), jl = buf.readUInt32LE(12), j = JSON.parse(buf.slice(20, 20 + jl).toString('utf8')); bytes += buf.length;
    if (j.images && j.images.length) bad.push(r.slug + ': carries an image');
    let top = -1e9; for (const m of j.meshes) for (const p of m.primitives) { tris += j.accessors[p.indices].count / 3; top = Math.max(top, j.accessors[p.attributes.POSITION].max[1]); if (p.attributes.NORMAL == null || p.attributes.TEXCOORD_0 == null) bad.push(r.slug + ': no normals or no UV set'); }
    if (Math.abs(top - r.topM) > 0.06) bad.push(r.slug + ': topM ' + r.topM + ' is not the file\'s ' + top.toFixed(2));
    if (!(Math.abs(r.lng + 97.74) < 0.03 && Math.abs(r.lat - 30.287) < 0.02)) bad.push(r.slug + ': not near campus');
    for (const id of [r.replaces, ...(r.alsoReplaces || [])]) { if (!/^[0-9a-f-]{36}$/.test(id) || ids.has(id)) bad.push(r.slug + ': id missing or used twice'); ids.add(id); }
    if (r.rings && !r.rings.every(g => g.length >= 4 && g[0][0] === g[g.length - 1][0] && g[0][1] === g[g.length - 1][1])) bad.push(r.slug + ': an outline is not a closed ring');
  }
  check(rows.length > 0 && !bad.length, rows.length + ' rows: each has its look file and sky-light map, no image inside, its height is the file\'s, its ids are its own', bad.slice(0, 4).join('; ') || (tris + ' triangles, ' + (bytes / 1e6).toFixed(1) + ' MB'));
}
console.log(failed ? '\nFAILED: ' + failed : '\nall passed');
process.exit(failed ? 1 : 0);
