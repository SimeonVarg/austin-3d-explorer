/**
 * selftest.mjs - the prototype's smoke test with NO app, NO dump and NO GPU slot: it builds a tiny packed
 * city (two boxes) in memory, draws it on proto/standalone.html in a software-GL browser, and checks that
 * (1) the shaders compile and link, (2) something is drawn, (3) the box is where the matrix says, and
 * (4) culling drops a box that is behind the camera. Run it after any change to proto/renderer.js.
 *     node experiments/renderer/selftest.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, launch, PRIVATE } from './lib/app.mjs';
import { startStatic } from './lib/static.mjs';
import { decodePNG, rgbOf } from './lib/images.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'renderer-selftest-'));
process.env.RENDERER_OUT = dir;
// two boxes, 8 vertices each; coordinates in local metres. Box 0 in front of the camera, box 1 behind it.
const boxes = [{ c: [0, 0, 5], h: 5 }, { c: [0, -200, 5], h: 5 }];
const STRIDE = 24, nv = 8 * boxes.length, vb = new ArrayBuffer(nv * STRIDE), v16 = new Int16Array(vb), v8 = new Int8Array(vb), u8 = new Uint8Array(vb), u16 = new Uint16Array(vb);
const idx = [], table = new Float32Array(boxes.length * 4), chunks = new Float32Array(boxes.length * 8);
boxes.forEach((b, bi) => {
  table.set([b.c[0], b.c[1], b.c[2], b.h / 32767], bi * 4);
  chunks.set([b.c[0], b.c[1], b.c[2], b.h * 2, idx.length, 36, 0, 0], bi * 8);
  for (let k = 0; k < 8; k++) {
    const o = bi * 8 + k, sx = k & 1 ? 1 : -1, sy = k & 2 ? 1 : -1, sz = k & 4 ? 1 : -1;
    v16[o * 12] = sx * 32767; v16[o * 12 + 1] = sy * 32767; v16[o * 12 + 2] = sz * 32767; u16[o * 12 + 3] = bi;
    v8[o * 24 + 8] = 0; v8[o * 24 + 9] = 0; v8[o * 24 + 10] = 127; v8[o * 24 + 11] = 0;       // normals all up: every face lit as a roof
    u8.set([200, 120, 60, 0, 200, 120, 60, 0, 20, 20, 40, 0], o * 24 + 12);
  }
  const f = [[0, 1, 3, 0, 3, 2], [4, 6, 7, 4, 7, 5], [0, 4, 5, 0, 5, 1], [2, 3, 7, 2, 7, 6], [0, 2, 6, 0, 6, 4], [1, 5, 7, 1, 7, 3]];
  for (const q of f) for (const i of q) idx.push(bi * 8 + i);
});
const ib = new Uint32Array(idx);
const meta = { stride: STRIDE, vertexCount: nv, vertexBytes: nv * STRIDE, indexType: 'u32', indexCount: ib.length, indexOffset: nv * STRIDE, chunkCount: boxes.length,
  tableOffset: nv * STRIDE + ib.byteLength, chunkOffset: nv * STRIDE + ib.byteLength + table.byteLength, gradScale: [1 / 255, 1 / 255], origin: [-97.7393587, 30.2860098] };
const out = Buffer.alloc(meta.chunkOffset + chunks.byteLength);
Buffer.from(vb).copy(out, 0); Buffer.from(ib.buffer).copy(out, meta.indexOffset); Buffer.from(table.buffer).copy(out, meta.tableOffset); Buffer.from(chunks.buffer).copy(out, meta.chunkOffset);
fs.writeFileSync(path.join(PRIVATE, 'selftest.packed.json'), JSON.stringify(meta)); fs.writeFileSync(path.join(PRIVATE, 'selftest.packed.bin'), out);

// a simple perspective camera at (0,-60,30) looking at +y, as a column-major local->clip matrix
const f = 1 / Math.tan(0.5), near = 1, far = 2000, asp = 1.6, ex = 0, ey = -60, ez = 30;
const view = [1, 0, 0, 0, 0, 0.9, -0.43, 0, 0, 0.43, 0.9, 0, 0, 0, 0, 1];   // roughly pitched down 25 deg: right-handed, y forward
// build view = R * T explicitly: x right, up' = (0,-sin,cos)... keep it simple: look-at
const norm = v => { const l = Math.hypot(...v); return v.map(x => x / l); }, cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const fwd = norm([0 - ex, 0 - ey, 5 - ez]), right = norm(cross(fwd, [0, 0, 1])), up = cross(right, fwd);
const V = [right[0], up[0], -fwd[0], 0, right[1], up[1], -fwd[1], 0, right[2], up[2], -fwd[2], 0, -dot(right, [ex, ey, ez]), -dot(up, [ex, ey, ez]), dot(fwd, [ex, ey, ez]), 1];
const P = [f / asp, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, 2 * far * near / (near - far), 0];
const mul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
const matrix = mul(P, V);
const u = { u_lightpos: [0.3, -0.5, 0.8], u_lightcolor: [1, 1, 1], u_lightintensity: 0.5, u_vertical_gradient: 1, u_opacity: 1, u_roof_shade: 1, u_materialP: 0, u_facet_on: 0, u_facet_ambient: 0.35, u_facet_lo: 0.7, u_facet_hi: 1.28, u_facet_sin: 0.6, u_facet_cos: 0.8, u_sloped_max_z: 0.99 };

const server = await startStatic(8499);
const browser = await launch(chromium, { gl: 'swiftshader' });
let ok = true;
const check = (name, cond, extra = '') => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); if (!cond) ok = false; };
try {
  const page = await (await browser.newContext({ viewport: { width: 640, height: 400 } })).newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://127.0.0.1:8499/exp/proto/standalone.html?data=/data/selftest.packed', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__proto, null, { timeout: 15000 });
  await page.evaluate(() => window.__proto.init([640, 400]));
  const st = await page.evaluate(m => window.__proto.drawFrame(m), { matrix, u });
  await page.waitForTimeout(200);
  const file = path.join(dir, 'selftest.png'); await page.screenshot({ path: file });
  const img = rgbOf(decodePNG(file));
  let cover = 0, cx = 0, cy = 0; for (let i = 0; i < img.width * img.height; i++) { const r = img.rgb[i * 3], g = img.rgb[i * 3 + 1], b = img.rgb[i * 3 + 2]; if (!(r > 240 && g < 10 && b > 240)) { cover++; cx += i % img.width; cy += Math.floor(i / img.width); } }
  const real = errors.filter(e => !/Failed to load resource/.test(e));   // the favicon
  check('shaders compile and the page has no errors', real.length === 0, real.join(' | ').slice(0, 200));
  check('something is drawn', cover > 500, `covered pixels ${cover}`);
  check('the box is near the middle of the frame', cover > 0 && Math.abs(cx / cover - 320) < 80 && Math.abs(cy / cover - 200) < 90, `centre ${Math.round(cx / cover)},${Math.round(cy / cover)}`);
  check('the box behind the camera was culled (1 of 2 drawn)', st.chunksDrawn === 1, JSON.stringify({ drawn: st.chunksDrawn, of: st.chunks, draws: st.draws, tris: st.triangles }));
} finally { await browser.__done(); server.close(); }
// the metrics themselves: identical -> zero, a shifted picture -> moves, a recoloured picture -> moves
{
  const { compareImages } = await import('./lib/images.mjs');
  const W = 64, H = 64, mk = fn => { const rgb = new Uint8Array(W * H * 3); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const c = fn(x, y); rgb.set(c, (y * W + x) * 3); } return { width: W, height: H, rgb }; };
  const bg = [255, 0, 255], box = (x0, col) => (x, y) => (x >= x0 && x < x0 + 24 && y >= 16 && y < 48) ? col : bg;
  const a = mk(box(10, [180, 90, 40])), same = mk(box(10, [180, 90, 40])), shifted = mk(box(14, [180, 90, 40])), recol = mk(box(10, [60, 90, 180]));
  const r0 = compareImages(a, same), r1 = compareImages(a, shifted), r2 = compareImages(a, recol);
  check('metrics: identical pictures differ by 0 and score SSIM 1', r0.pctOverOnBuildings === 0 && r0.ssim > 0.999 && r0.silhouetteIoU === 1, JSON.stringify(r0));
  check('metrics: a 4-pixel shift moves the silhouette overlap', r1.silhouetteIoU < 0.8 && r1.pctOverOnBuildings > 10, JSON.stringify(r1));
  check('metrics: a recoloured building keeps its silhouette but moves colour', r2.silhouetteIoU === 1 && r2.pctOverOnBuildings > 90, JSON.stringify(r2));
}
console.log(ok ? 'SELFTEST PASS' : 'SELFTEST FAIL'); process.exit(ok ? 0 : 1);
