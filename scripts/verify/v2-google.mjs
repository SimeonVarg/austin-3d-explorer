/**
 * v2-google.mjs - Google mode of the v2 app (/v2/, v2/google.js), checked WITHOUT a Google key and without any request to Google.
 *
 *   VERIFY_URL=http://127.0.0.1:8457 node scripts/verify/v2-google.mjs [OUT_DIR]
 *
 * 1. NO KEY. The page is v2 as before: Google mode is off, the "Google 3D" button is there, no request goes to Google, and no
 *    layer is hidden.
 * 2. A REFUSED KEY. A made-up key is saved in localStorage and every request to tile.googleapis.com is answered here with a
 *    403 (the browser never reaches Google). The page must say the key was refused, in words, must make ONE root request
 *    only, must never print the key (console, page text), and must keep drawing v2.
 * 3. ALIGNMENT, END TO END, ON A STAND-IN TILESET. Google's tiles are ECEF meshes; the same path (3d-tiles-renderer, the frame
 *    map, the ground flattening, the shader) is run on a tileset made here: thin square posts 30 m tall standing on the real
 *    ground (the 2021 lidar ground + GEOID18 + the NAD83 -> ITRF height, the numbers in v2/google/ground-dem.json) at named
 *    places: DKR's field corners, the UT Tower's base corners, two street corners, an apartment's corner and a downtown tower.
 *    For each post: (a) where its geometry lands in v2's frame (CPU, the same map the shader uses), and (b) where its top
 *    really is ON SCREEN from straight above (the drawn pixels, read back) against where v2's own projection (geo.js) puts
 *    that place. Both must be within LIMIT_M. This proves the frame map, the height datum chain and the shader agree; it can
 *    NOT measure Google's own georeferencing error (that needs a key and a look: docs/v2-google-mode.md, checklist).
 * 4. HIDING. With the hiding on, a post standing inside the DKR model (our tile) is not drawn above CLIP_ABOVE_M; with it off
 *    it is. And while Google mode is on, the map layers (ground, roads, extrusions, trees) are hidden and the Blender tiles
 *    and the route are not.
 *
 * Software GL is enough (pixel positions, not timing).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { launch, BASE } from './chrome.mjs';

const OUT = process.argv[2] || null;
if (OUT) fs.mkdirSync(OUT, { recursive: true });
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LIMIT_M = 0.25;          // largest allowed position error of a post, metres
const FAKE_KEY = 'NOT-A-REAL-KEY-v2-google-check-7Q';
const MOCK = 'http://mock-tiles.test/v2-google/';

// ── v2's projection (v2/geo.js) and the ground grid (v2/google/ground-dem.*), in node ──
const O = { lat: 30.28601, lon: -97.73932 }, R = 6378137, D = Math.PI / 180;
const kx = R * D * Math.cos(O.lat * D), kz = R * D;
const toLocal = (lon, lat) => [(lon - O.lon) * kx, -(lat - O.lat) * kz];
const toLonLat = (x, z) => [O.lon + x / kx, O.lat - z / kz];
const meta = JSON.parse(fs.readFileSync(path.join(REPO, 'v2/google/ground-dem.json'), 'utf8'));
const demBuf = fs.readFileSync(path.join(REPO, 'v2/google/ground-dem.bin'));
const dem = new Int16Array(demBuf.buffer, demBuf.byteOffset, demBuf.length / 2);
function ground(x, z) {
  const fx = (x - meta.x0) / meta.cell - 0.5, fz = (z - meta.z0) / meta.cell - 0.5, i0 = Math.floor(fx), j0 = Math.floor(fz), tx = fx - i0, tz = fz - j0;
  const c = (i, j) => dem[Math.min(meta.rows - 1, Math.max(0, j)) * meta.cols + Math.min(meta.cols - 1, Math.max(0, i))] / 100;
  return (c(i0, j0) * (1 - tx) + c(i0 + 1, j0) * tx) * (1 - tz) + (c(i0, j0 + 1) * (1 - tx) + c(i0 + 1, j0 + 1) * tx) * tz;
}
const WGS84 = { a: 6378137, f: 1 / 298.257223563 };
function ecef(lat, lon, h) {
  const e2 = WGS84.f * (2 - WGS84.f), p = lat * D, l = lon * D, N = WGS84.a / Math.sqrt(1 - e2 * Math.sin(p) ** 2);
  return [(N + h) * Math.cos(p) * Math.cos(l), (N + h) * Math.cos(p) * Math.sin(l), (N * (1 - e2) + h) * Math.sin(p)];
}
function enu(lat, lon) {
  const p = lat * D, l = lon * D;
  return { E: [-Math.sin(l), Math.cos(l), 0], N: [-Math.sin(p) * Math.cos(l), -Math.sin(p) * Math.sin(l), Math.cos(p)], U: [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)] };
}

// ── the places (v2 metres, from the tile manifest where a building is named) ──
const man = JSON.parse(fs.readFileSync(path.join(REPO, 'v2/tiles/manifest.json'), 'utf8'));
const B = (slug) => { const b = man.buildings[slug]; if (!b) throw new Error('no ' + slug + ' in the manifest'); return [b.x, b.z]; };
const dkr = B('dkr-memorial-stadium'), tower = B('ut-tower-main-building'), apt = B('the-venue'), frost = B('frost-bank-tower');
const at = (p, dx, dz) => [p[0] + dx, p[1] + dz];
const POSTS = [
  { name: 'DKR field, north-west corner', xz: at(dkr, -25, -55) },
  { name: 'DKR field, south-east corner', xz: at(dkr, 25, 55) },
  { name: 'UT Tower base, north-east corner', xz: at(tower, 9, -9) },
  { name: 'UT Tower base, south-west corner', xz: at(tower, -9, 9) },
  { name: 'Guadalupe St & W 24th St', xz: toLocal(-97.74195, 30.28731) },
  { name: 'Congress Ave & E 6th St', xz: toLocal(-97.74306, 30.26852) },
  { name: 'The Venue (apartment), a corner', xz: at(apt, 12, 12) },
  { name: 'Frost Bank Tower (downtown), a corner', xz: at(frost, 15, 15) },
  { name: 'DKR field centre (inside our model: the hiding test)', xz: dkr, clipTest: true },
];
const POST_H = 30, HALF = 1;

// ── the stand-in tileset: one glb, one node per post, in ECEF (glTF y-up: glTF (x, y, z) = tile (x, z, -y)) ──
function buildTileset() {
  const h0 = meta.origin.ground_ellipsoid_itrf_m;
  const posts = POSTS.map((p) => {
    const [lon, lat] = toLonLat(p.xz[0], p.xz[1]);
    const hBase = h0 + ground(p.xz[0], p.xz[1]);
    const F = enu(lat, lon), P0 = ecef(lat, lon, hBase);
    const corner = (e, n, u) => [0, 1, 2].map((k) => P0[k] + e * F.E[k] + n * F.N[k] + u * F.U[k]);
    const v = [];
    for (const u of [0, POST_H]) for (const [e, n] of [[-HALF, -HALF], [HALF, -HALF], [HALF, HALF], [-HALF, HALF]]) v.push(corner(e, n, u));
    return v;
  });
  const all = posts.flat(), C = [0, 1, 2].map((k) => all.reduce((s, p) => s + p[k], 0) / all.length);
  let radius = 0; for (const p of all) radius = Math.max(radius, Math.hypot(p[0] - C[0], p[1] - C[1], p[2] - C[2]));
  // a closed box: 6 faces, 12 triangles, outward
  const IDX = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
  const bin = [], views = [], accessors = [], meshes = [], nodes = [];
  let off = 0;
  const push = (arr, target) => { const b = Buffer.from(arr.buffer); views.push({ buffer: 0, byteOffset: off, byteLength: b.length, target }); bin.push(b); off += b.length; while (off % 4) { bin.push(Buffer.alloc(1)); off++; } return views.length - 1; };
  posts.forEach((v, i) => {
    const pos = new Float32Array(v.flatMap((p) => { const d = [p[0] - C[0], p[1] - C[1], p[2] - C[2]]; return [d[0], d[2], -d[1]]; }));
    const mn = [0, 1, 2].map((k) => Math.min(...[...Array(8).keys()].map((j) => pos[j * 3 + k]))), mx = [0, 1, 2].map((k) => Math.max(...[...Array(8).keys()].map((j) => pos[j * 3 + k])));
    const pv = push(pos, 34962), iv = push(new Uint16Array(IDX), 34963);
    accessors.push({ bufferView: pv, componentType: 5126, count: 8, type: 'VEC3', min: mn, max: mx });
    accessors.push({ bufferView: iv, componentType: 5123, count: IDX.length, type: 'SCALAR' });
    meshes.push({ primitives: [{ attributes: { POSITION: accessors.length - 2 }, indices: accessors.length - 1, material: 0 }] });
    nodes.push({ name: 'post-' + i, mesh: i });
  });
  const json = { asset: { version: '2.0', generator: 'v2-google.mjs', copyright: 'Stand-in tiles;Flyover check' }, scene: 0, scenes: [{ nodes: nodes.map((_, i) => i) }], nodes, meshes,
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 0, 1, 1] }, extensions: { KHR_materials_unlit: {} } }], extensionsUsed: ['KHR_materials_unlit'],
    accessors, bufferViews: views, buffers: [{ byteLength: off }] };
  let js = Buffer.from(JSON.stringify(json)); while (js.length % 4) js = Buffer.concat([js, Buffer.from(' ')]);
  const body = Buffer.concat(bin);
  const head = Buffer.alloc(12); head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + js.length + 8 + body.length, 8);
  const ch = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(type, 4); return b; };
  const glb = Buffer.concat([head, ch(js.length, 0x4e4f534a), js, ch(body.length, 0x004e4942), body]);
  const tileset = { asset: { version: '1.0' }, geometricError: 500,
    root: { transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, C[0], C[1], C[2], 1], boundingVolume: { sphere: [0, 0, 0, radius + 10] }, geometricError: 0, refine: 'ADD', content: { uri: 'posts.glb' } } };
  return { tileset: JSON.stringify(tileset), glb };
}

const fails = [];
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fails.push(msg); };
const browser = await launch(chromium, { gl: process.env.VERIFY_GL, maxMs: 1500000 });
const url = (q) => `${BASE.replace(/\/$/, '')}/v2/?intro=0${q}`;

async function open(q, { key = null, block = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 760 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const log = { console: [], errors: [], google: [], googleUrls: [] };
  page.on('console', (m) => log.console.push(m.type() + ': ' + m.text()));
  page.on('pageerror', (e) => log.errors.push(e.message));
  if (key) await ctx.addInitScript((k) => { try { localStorage.setItem('v2.googleMapsKey', k); } catch (e) {} }, key);
  // nothing in this check may reach Google: every request to its tile host is answered here
  await ctx.route('https://tile.googleapis.com/**', (r) => { log.google.push(r.request().url().split('?')[0]); log.googleUrls.push(r.request().url());
    return block ? r.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: { code: 403, status: 'PERMISSION_DENIED', message: 'API key not valid.' } }) }) : r.abort(); });
  const ts = buildTileset();
  await ctx.route(MOCK + '**', (r) => {
    const u = r.request().url();
    if (u.includes('tileset.json')) return r.fulfill({ status: 200, contentType: 'application/json', body: ts.tileset });
    if (u.includes('posts.glb')) return r.fulfill({ status: 200, contentType: 'model/gltf-binary', body: ts.glb });
    return r.fulfill({ status: 404, body: '' });
  });
  await page.goto(url(q), { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__v2 && window.__v2.ready, null, { timeout: 120000 });
  await page.evaluate(() => window.__v2.ready);
  await page.waitForFunction(() => !!window.__v2.google, null, { timeout: 60000 });
  return { ctx, page, log };
}

// ── 1. no key ──
{
  const { ctx, page, log } = await open('');
  await page.waitForTimeout(1500);
  const st = await page.evaluate(() => window.__v2.google.state());
  const btn = await page.locator('#g3d button').first().textContent().catch(() => null);
  const hidden = await page.evaluate(() => window.__v2.scene.children.filter((o) => !o.visible).map((o) => o.name || o.type));
  check(st.on === false && !st.keySaved, `no key: Google mode is off (on=${st.on}, keySaved=${st.keySaved})`);
  check(btn && /Google 3D/.test(btn), `no key: the "Google 3D" button is there ("${btn}")`);
  check(log.google.length === 0, `no key: no request to Google (${log.google.length})`);
  check(hidden.length === 0, `no key: no layer hidden (${hidden.join(', ') || 'none'})`);
  check(!(await page.locator('#gattr').isVisible()), 'no key: no Google attribution shown');
  check(!log.errors.length, `no key: no page errors (${log.errors.join(' | ')})`);
  await ctx.close();
}

// ── 2. a refused key ──
{
  const { ctx, page, log } = await open('', { key: FAKE_KEY });
  await page.waitForFunction(() => /refused/.test(window.__v2.google.state().status || ''), null, { timeout: 60000 }).catch(() => {});
  const st = await page.evaluate(() => window.__v2.google.state());
  const text = await page.evaluate(() => document.body.innerText);
  check(/refused the key \(HTTP 403/.test(st.status), `refused key: the page says so ("${st.status}")`);
  check(await page.locator('#g3d .msg').isVisible(), 'refused key: the message is on screen');
  check(log.google.filter((u) => /root\.json$/.test(u)).length === 1, `refused key: one root request (${log.google.length} requests to Google in all, stubbed)`);
  check(log.googleUrls.every((u) => new URL(u).searchParams.get('key') === FAKE_KEY), 'refused key: the key goes only as the key= parameter to Google\'s host');
  check(!log.console.some((l) => l.includes(FAKE_KEY)) && !text.includes(FAKE_KEY), 'refused key: the key is never printed (console, page text)');
  check(st.on === false && st.hiddenLayers.length === 0, `refused key: v2 is back as before (on=${st.on}, hidden=${st.hiddenLayers.length})`);
  await ctx.close();
}

// ── 3 and 4. alignment on the stand-in tileset, and the hiding ──
{
  const { ctx, page, log } = await open(`&google=0&gmock=${encodeURIComponent(MOCK + 'tileset.json')}`);
  const before = await page.evaluate(() => window.__v2.google.state());
  check(before.on === false && log.google.length === 0, 'stand-in: off until asked (google=0)');
  await page.evaluate(() => window.__v2.google.enable());
  await page.waitForFunction(() => window.__v2.google.state().loadedModels >= 1, null, { timeout: 90000 });
  const st = await page.evaluate(() => window.__v2.google.state());
  console.log('frame map fit, max error m:', JSON.stringify(st.frameFitMaxM), ' datum:', JSON.stringify(st.datum));
  check(st.frameFitMaxM && st.frameFitMaxM.tilesArea < 0.05, `frame map: fit error over the tiles' area ${st.frameFitMaxM?.tilesArea} m (< 0.05)`);
  const vis = await page.evaluate(() => Object.fromEntries(window.__v2.scene.children.filter((o) => o.name).map((o) => [o.name, o.visible])));
  check(vis.city === false, 'Google mode: the map extrusions/roads group is hidden');
  check(vis['blender-tiles'] !== false && vis.route !== false && vis['google-3d'] === true, `Google mode: Blender tiles, route and Google group stay (${JSON.stringify(vis)})`);
  check(st.hiddenLayers.length >= 2, `Google mode: ${st.hiddenLayers.length} layers hidden (${st.hiddenLayers.join(', ')})`);
  check(await page.locator('#gattr .logo').isVisible(), 'attribution: the Google Maps logo is on screen');
  const logo = await page.locator('#gattr .logo').boundingBox();
  check(logo && logo.height - 15 >= 16 - 1 && logo.height - 15 <= 19 + 1, `attribution: logo ${logo && (logo.height - 15).toFixed(1)} px high (16 to 19) with its clear space`);
  await page.waitForTimeout(800);
  const attrText = await page.locator('#gattr .data').textContent();
  check(/Stand-in tiles; Flyover check|Flyover check; Stand-in tiles/.test(attrText), `attribution: the tiles' own credits shown in one line ("${attrText}")`);

  // (a) CPU: each post's geometry in v2's frame
  const cpu = await page.evaluate(() => {
    const g = window.__v2.google, out = {};
    g.group().updateMatrixWorld(true);
    g.group().traverse((o) => {
      if (!o.isMesh || !/^post-/.test(o.name)) return;
      const P = o.geometry.attributes.position, v = new window.__v2.THREE.Vector3(), pts = [];
      for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i).applyMatrix4(o.matrixWorld); pts.push(g.toV2([v.x, v.y, v.z])); }
      out[o.name] = pts;
    });
    return out;
  });
  const rows = [];
  for (const [i, p] of POSTS.entries()) {
    const pts = cpu['post-' + i];
    if (!pts) { check(false, `post ${i} (${p.name}) loaded`); continue; }
    const cx = pts.reduce((s, q) => s + q[0], 0) / pts.length, cz = pts.reduce((s, q) => s + q[2], 0) / pts.length;
    // the base and top as the mean of their four corners (the flattening follows the ground under each corner, so on a
    // slope the corners differ; their mean is the ground at the post's centre)
    const base = pts.filter((q, k) => k < 4).reduce((s, q) => s + q[1], 0) / 4, top = pts.filter((q, k) => k >= 4).reduce((s, q) => s + q[1], 0) / 4;
    const shear = Math.max(...pts.filter((q, k) => k < 4).map((q) => Math.abs(q[1] - base)));
    rows.push({ i, name: p.name, dx: cx - p.xz[0], dz: cz - p.xz[1], base, top, shear });
  }
  console.log('\n(a) post geometry in v2 metres (where it should be: the place, base y = 0, top y = 30)');
  for (const r of rows) console.log(`  ${r.name.padEnd(52)} east ${r.dx.toFixed(3).padStart(7)}  south ${r.dz.toFixed(3).padStart(7)}  base ${r.base.toFixed(3).padStart(7)}  top ${r.top.toFixed(3).padStart(7)}  (ground slope under the 2 m post: corners within ${r.shear.toFixed(2)} m)`);
  for (const r of rows) check(Math.hypot(r.dx, r.dz) < LIMIT_M && Math.abs(r.base) < LIMIT_M && Math.abs(r.top - POST_H) < LIMIT_M, `(a) ${r.name}: ${Math.hypot(r.dx, r.dz).toFixed(3)} m across, base ${r.base.toFixed(3)} m`);

  // (b) ON SCREEN: from straight above, where is the post's top drawn, against where geo.js puts the place
  // our own buildings are hidden for this part: a tall model (Frost Bank Tower) would cover a post from above, and what is measured
  // here is where Google's layer is drawn
  await page.evaluate(() => { window.__v2.google.setClip(false); window.__v2.scene.getObjectByName('blender-tiles').visible = false; });
  const shots = [];
  for (const [i, p] of POSTS.entries()) {
    if (p.clipTest) continue;
    const r = await page.evaluate(async ([x, z, H]) => {
      const v2 = window.__v2, T = v2.THREE;
      v2.placeCamera({ target: [x, 0, z], distance: 140, polarDeg: 0.01, azimuthDeg: 0 });
      for (let k = 0; k < 6; k++) { v2.redraw(); await new Promise((res) => requestAnimationFrame(res)); }
      v2.renderer.render(v2.scene, v2.camera);
      const gl = v2.renderer.getContext(), W = gl.drawingBufferWidth, Hh = gl.drawingBufferHeight, px = new Uint8Array(W * Hh * 4);
      gl.readPixels(0, 0, W, Hh, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const proj = (X, Y, Z) => { const q = new T.Vector3(X, Y, Z).project(v2.camera); return [(q.x + 1) / 2 * W, (q.y + 1) / 2 * Hh]; };
      const want = proj(x, H, z), e1 = proj(x + 1, H, z), s1 = proj(x, H, z + 1);
      // the magenta pixels within 8 m of where the post should be (another post may be in the frame); a pixel's centre is +0.5
      const rad = 8 * Math.hypot(e1[0] - want[0], e1[1] - want[1]);
      let n = 0, sx = 0, sy = 0;
      for (let y = 0; y < Hh; y++) for (let xx = 0; xx < W; xx++) {
        const k = (y * W + xx) * 4;
        if (px[k] > 200 && px[k + 1] < 60 && px[k + 2] > 200 && Math.hypot(xx + 0.5 - want[0], y + 0.5 - want[1]) < rad) { n++; sx += xx + 0.5; sy += y + 0.5; }
      }
      return { n, cx: n ? sx / n : null, cy: n ? sy / n : null, want, mpp: 1 / Math.hypot(e1[0] - want[0], e1[1] - want[1]), e1, s1 };
    }, [p.xz[0], p.xz[1], POST_H]);
    if (!r.n) { check(false, `(b) ${p.name}: the post is drawn (no magenta pixels)`); continue; }
    // screen offset -> metres east and south (the camera may be rotated: solve with the projected unit vectors)
    const ex = r.e1[0] - r.want[0], ey = r.e1[1] - r.want[1], sx = r.s1[0] - r.want[0], sy = r.s1[1] - r.want[1];
    const dx = r.cx - r.want[0], dy = r.cy - r.want[1], det = ex * sy - ey * sx;
    const east = (dx * sy - dy * sx) / det, south = (ex * dy - ey * dx) / det;
    shots.push({ name: p.name, east, south, px: r.n, mpp: r.mpp });
  }
  console.log('\n(b) post tops on screen, from straight above, against geo.js (metres; one pixel is about ' + (shots[0]?.mpp || 0).toFixed(3) + ' m)');
  for (const s of shots) console.log(`  ${s.name.padEnd(52)} east ${s.east.toFixed(3).padStart(7)}  south ${s.south.toFixed(3).padStart(7)}  (${s.px} px)`);
  for (const s of shots) check(Math.hypot(s.east, s.south) < LIMIT_M, `(b) ${s.name}: drawn ${Math.hypot(s.east, s.south).toFixed(3)} m from its place`);

  await page.evaluate(() => { window.__v2.scene.getObjectByName('blender-tiles').visible = true; });
  // 4. hiding: the post inside the DKR model, seen from above, with the hiding on and off
  const ci = POSTS.findIndex((p) => p.clipTest), cp = POSTS[ci];
  const seen = async (clip) => page.evaluate(async ([x, z, clip]) => {
    const v2 = window.__v2;
    v2.google.setClip(clip);
    v2.placeCamera({ target: [x, 0, z], distance: 140, polarDeg: 0.01, azimuthDeg: 0 });
    for (let k = 0; k < 8; k++) { v2.redraw(); await new Promise((res) => requestAnimationFrame(res)); }
    v2.renderer.render(v2.scene, v2.camera);
    const gl = v2.renderer.getContext(), W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, px = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let n = 0; for (let k = 0; k < px.length; k += 4) if (px[k] > 200 && px[k + 1] < 60 && px[k + 2] > 200) n++;
    return { n, mask: v2.google.maskAt(x, z), st: v2.google.state().mask };
  }, [cp.xz[0], cp.xz[1], clip]);
  await page.waitForFunction(() => window.__v2.google.state().mask, null, { timeout: 60000 }).catch(() => {});
  const on = await seen(true), off = await seen(false);
  console.log(`\nhiding at the DKR field centre: mask ${on.mask}, magenta pixels with hiding ${on.n}, without ${off.n}; mask ${JSON.stringify(on.st)}`);
  check(on.mask === 1, 'hiding: the DKR field centre is inside our models\' mask');
  check(on.n === 0 && off.n > 50, `hiding: the post inside DKR is hidden (${on.n} px) and shows when hiding is off (${off.n} px)`);
  if (OUT) await page.screenshot({ path: path.join(OUT, 'stand-in-dkr-no-hiding.png') });
  check(!log.errors.length, `stand-in: no page errors (${log.errors.join(' | ')})`);
  check(log.google.length === 0, 'stand-in: no request to Google');
  // off again: everything back
  await page.evaluate(() => window.__v2.google.disable());
  const back = await page.evaluate(() => window.__v2.scene.children.filter((o) => !o.visible).map((o) => o.name || o.type));
  check(back.length === 0, `turned off: every layer is back (${back.join(', ') || 'none hidden'})`);
  await ctx.close();
}

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS');
process.exit(fails.length ? 1 : 0);
