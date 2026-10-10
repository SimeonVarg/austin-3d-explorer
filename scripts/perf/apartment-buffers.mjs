/**
 * apartment-buffers.mjs — how big are the BUILT apartment meshes, per building and in total? (2026-10-09)
 *
 * The page builds ~3.1 million triangles of authored apartments from small JSON specs at load, on the main
 * thread (js/slopes-apartments.js). The question this answers: if that build were done OFFLINE and shipped
 * as binary buffers, how many bytes would that be, raw and gzipped, per building and in total, against the
 * time it saves?
 *
 * Loads the real city once (fresh Chrome), waits for the apartments to be ready, then reads the live
 * three.js geometries of `slopesApartments.group` (and its `filtered` meshes): for every attribute the type,
 * item size, count and bytes; the index; then, per building (the cull ranges: one per building, in build
 * order), the triangle count, vertex count (min/max index of its range), raw bytes, and gzip bytes of
 * its slices (CompressionStream in the page, level not selectable: the browser's default). A sample of
 * buildings is also compressed with Node's brotli (quality 9) to give a brotli/gzip ratio. Finally it prints
 * the size of the JSON specs the build starts from (data/apartments), raw and gzipped, for comparison.
 *
 * EXIT CODE: 1 if the page read failed or found no meshes (it used to be written into the report with exit 0). TARGET: only this machine
 * unless --allow-live. The spec sizes at the end are read from THIS CHECKOUT's data/apartments, not from --url; the report says so.
 *
 * Settings: desktop 1280x800 DPR1.5 balanced preset, hardware GL (the geometry does not depend on the GPU),
 * ?intro=0&drift=0. Run with --phone for the phone profile (its detail table is lighter; on a phone the CPU
 * copies are released after upload so only the GL-side bytes can be counted there: reported separately).
 *
 *   node ~/Projects/astra-pipe/tools/gpu-run.mjs --label speed -- \
 *     node scripts/perf/apartment-buffers.mjs --url http://127.0.0.1:8473/ --out DIR
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { startChrome } from './lib/cdp.mjs';
import { refuseLive, buffersExitCode } from './lib/outcome.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const URL0 = arg('--url', (process.env.VERIFY_URL || 'http://127.0.0.1:8099') + '/');
const GL = arg('--gl', 'hardware');
const PHONE = argv.includes('--phone');
const OUT = arg('--out', process.env.VERIFY_OUT || '/tmp/apartment-buffers');
const MAX = +arg('--max', 420000);
const TARGET = refuseLive(URL0);   // exit 2 unless the target is this machine or --allow-live was given
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

const PAGE = `(async () => {
  const gz = async (u8) => { const cs = new CompressionStream('gzip'); const w = cs.writable.getWriter(); w.write(u8); w.close(); let n = 0; const r = cs.readable.getReader(); for (;;) { const x = await r.read(); if (x.done) break; n += x.value.length; } return n; };
  const A = window.slopesApartments, g = A.group;
  const meshes = []; g.traverse(o => { if (o.geometry && o.geometry.attributes) meshes.push(o); });
  const names = A.built.map(b => b.name);
  const out = { meshes: [], buildings: [], names: names.length, sampleSlices: [] };
  let totalRaw = 0, totalGz = 0;
  const perBuilding = new Map();
  for (const mesh of meshes) {
    const geo = mesh.geometry, idx = geo.index;
    const attrs = [];
    let vertBytes = 0;
    for (const [k, a] of Object.entries(geo.attributes)) {
      const arr = a.array; const bytes = arr ? arr.byteLength : 0;
      attrs.push({ name: k, itemSize: a.itemSize, type: arr ? arr.constructor.name : 'released', count: a.count, bytes, norm: !!a.normalized });
      vertBytes += bytes;
    }
    const idxBytes = idx && idx.array ? idx.array.byteLength : 0;
    const info = { mesh: mesh.name || mesh.type, verts: geo.attributes.position ? geo.attributes.position.count : 0, tris: idx ? idx.count / 3 : 0, attrs, idxType: idx && idx.array ? idx.array.constructor.name : null, idxBytes, vertBytes, groups: (geo.groups || []).length };
    // whole-geometry gzip, per attribute
    if (idx && idx.array) {
      let gzTotal = await gz(new Uint8Array(idx.array.buffer, idx.array.byteOffset, idx.array.byteLength)); info.idxGz = gzTotal;
      for (const a of attrs) { const arr = geo.attributes[a.name].array; if (!arr) continue; a.gz = await gz(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength)); gzTotal += a.gz; }
      info.gzTotal = gzTotal; totalGz += gzTotal;
    }
    totalRaw += vertBytes + idxBytes;
    // per-building ranges
    const c = mesh.userData.cull;
    if (c && idx && idx.array && geo.attributes.position.array) {
      const ia = idx.array, n = c.n;
      for (let r = 0; r < n; r++) {
        const s = c.start[r], l = c.count[r];
        let lo = 1e12, hi = -1; for (let i = s; i < s + l; i++) { const v = ia[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
        const verts = hi - lo + 1;
        let raw = l * ia.BYTES_PER_ELEMENT, gzb = await gz(new Uint8Array(ia.buffer, ia.byteOffset + s * ia.BYTES_PER_ELEMENT, l * ia.BYTES_PER_ELEMENT));
        for (const a of attrs) { const arr = geo.attributes[a.name].array; if (!arr) continue; const per = a.itemSize * arr.BYTES_PER_ELEMENT; raw += verts * per; gzb += await gz(new Uint8Array(arr.buffer, arr.byteOffset + lo * per, verts * per)); }
        out.buildings.push({ mesh: info.mesh, i: r, tris: l / 3, verts, raw, gz: gzb });
      }
    }
    out.meshes.push(info);
  }
  out.totalRawBytes = totalRaw; out.totalGzBytes = totalGz;
  // one building's slices for node-side brotli
  const big = out.buildings.slice().sort((a, b) => b.raw - a.raw)[Math.floor(out.buildings.length / 2)];
  out.sample = big || null;
  return JSON.stringify(out);
})()`;

const PAGE_SAMPLE = `(async (cfg) => {
  const A = window.slopesApartments; const mesh = (()=>{ let m=null; A.group.traverse(o=>{ if(!m && o.name===cfg.mesh) m=o; }); return m; })();
  const geo = mesh.geometry, ia = geo.index.array, c = mesh.userData.cull, s = c.start[cfg.i], l = c.count[cfg.i];
  let lo = 1e12, hi = -1; for (let i = s; i < s + l; i++) { const v = ia[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
  const parts = {}; const enc = u8 => { let s=''; const CH=0x8000; for (let i=0;i<u8.length;i+=CH) s+=String.fromCharCode.apply(null,u8.subarray(i,i+CH)); return btoa(s); };
  parts.index = enc(new Uint8Array(ia.buffer, ia.byteOffset + s * ia.BYTES_PER_ELEMENT, l * ia.BYTES_PER_ELEMENT));
  for (const [k, a] of Object.entries(geo.attributes)) { const arr = a.array; const per = a.itemSize * arr.BYTES_PER_ELEMENT; parts[k] = enc(new Uint8Array(arr.buffer, arr.byteOffset + lo * per, (hi - lo + 1) * per)); }
  return JSON.stringify(parts);
})`;

const W = PHONE ? 390 : 1280, H = PHONE ? 844 : 800, DPR = PHONE ? 3 : 1.5;
let pageResult = null;   // what the page read gave back (or {error}); decides the exit code
const chrome = await startChrome({ gl: GL, width: W, height: H, vsync: 'off', maxMs: 1500000 });
try {
  const page = await chrome.newPage();
  await page.send('Page.enable'); await page.send('Runtime.enable');
  await page.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: PHONE });
  if (PHONE) { await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }); await page.send('Emulation.setUserAgentOverride', { userAgent: IPHONE_UA, platform: 'iPhone' }); }
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__PERF_CFG=${JSON.stringify({ wrap: [], autodetect: false })};` + fs.readFileSync(path.join(HERE, 'lib/instrument.js'), 'utf8') });
  const ev = async (expr) => { const r = await page.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed'); return r.result.value; };
  const t0 = Date.now();
  await page.send('Page.navigate', { url: URL0 + (URL0.includes('?') ? '&' : '?') + 'intro=0&drift=0' });
  for (;;) {
    await sleep(1000);
    let st = null; try { st = JSON.parse(await ev('JSON.stringify({m:window.__perf&&window.__perf.marks,now:performance.now()})')); } catch (e) {}
    if (st && st.m && st.m.introReveal && st.m.apartmentsDone && st.now - Math.max(st.m.introReveal, st.m.apartmentsDone) >= 8000) break;
    if (Date.now() - t0 > MAX) throw new Error('not ready');
  }
  const gl = JSON.parse(await ev('JSON.stringify({own:window.__perf.gl.own,tex:window.__perf.gl.texBytes,buf:window.__perf.gl.bufBytes})'));
  let res = null;
  try { res = JSON.parse(await ev(PAGE)); } catch (e) { res = { error: String(e.message) }; }
  if (res && res.sample) {
    const parts = JSON.parse(await ev(`${PAGE_SAMPLE}(${JSON.stringify({ mesh: res.sample.mesh, i: res.sample.i })}).then(x=>x)`));
    let raw = 0, gzs = 0, br = 0; const per = {};
    for (const [k, b64] of Object.entries(parts)) { const buf = Buffer.from(b64, 'base64'); const g = zlib.gzipSync(buf, { level: 9 }).length; const b = zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } }).length; raw += buf.length; gzs += g; br += b; per[k] = { raw: buf.length, gz9: g, br9: b }; }
    res.sampleCompare = { building: res.sample, raw, gz9: gzs, br9: br, per };
  }
  // the specs the build starts from
  const specDir = path.join(REPO, 'data/apartments'); const spec = { files: 0, raw: 0, gz: 0, br: 0 };
  const walk = d => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.json$/.test(f.name)) { const b = fs.readFileSync(p); spec.files++; spec.raw += b.length; spec.gz += zlib.gzipSync(b).length; spec.br += zlib.brotliCompressSync(b).length; } } };
  try { walk(specDir); } catch (e) {}
  spec.source = 'this checkout\'s data/apartments on disk, NOT the files served at --url' + (TARGET.local ? '' : ' (and --url is not this machine, so these sizes may not be what that site serves)');
  pageResult = res;
  const out = { phone: PHONE, specs: spec, glBytesByOwner: gl, page: res };
  fs.writeFileSync(path.join(OUT, `apartment-buffers${PHONE ? '-phone' : ''}.json`), JSON.stringify(out, null, 1));
  const MB = n => (n / 2 ** 20).toFixed(1);
  const lines = [`# apartment-buffers (${PHONE ? 'phone profile' : 'desktop balanced'}, hardware GL, cold load)`];
  if (res && res.meshes) {
    lines.push(`meshes ${res.meshes.length}, buildings with ranges ${res.buildings.length} (built list has ${res.names})`);
    lines.push(`TOTAL raw ${MB(res.totalRawBytes)} MB (vertex attributes + index), gzip ${MB(res.totalGzBytes)} MB  (whole-mesh gzip, browser default level)`);
    const t = res.meshes.reduce((a, m) => ({ v: a.v + m.verts, t: a.t + m.tris }), { v: 0, t: 0 });
    lines.push(`vertices ${t.v}, triangles ${Math.round(t.t)}, raw bytes per vertex ${(res.totalRawBytes / t.v).toFixed(1)}`);
    const am = {}; for (const m of res.meshes) for (const a of m.attrs) { const e = am[a.name] || (am[a.name] = { type: a.type, size: a.itemSize, bytes: 0, gz: 0 }); e.bytes += a.bytes; e.gz += a.gz || 0; }
    lines.push('per attribute: ' + Object.entries(am).sort((a, b) => b[1].bytes - a[1].bytes).map(([k, v]) => `${k} ${v.type}x${v.size} ${MB(v.bytes)} MB (gz ${MB(v.gz)})`).join('; '));
    lines.push('index: ' + res.meshes.map(m => `${m.mesh} ${m.idxType} ${MB(m.idxBytes)} MB (gz ${MB(m.idxGz || 0)})`).join('; '));
    const b = res.buildings.slice().sort((x, y) => y.raw - x.raw);
    const med = b[b.length >> 1];
    lines.push(`per building: median raw ${(med.raw / 1024).toFixed(0)} KB / gz ${(med.gz / 1024).toFixed(0)} KB (${med.tris} tris); largest raw ${(b[0].raw / 2 ** 20).toFixed(1)} MB gz ${(b[0].gz / 2 ** 20).toFixed(1)} MB (${b[0].tris} tris); smallest raw ${(b[b.length - 1].raw / 1024).toFixed(0)} KB`);
    lines.push(`sum of per-building raw ${MB(b.reduce((s, x) => s + x.raw, 0))} MB, gz ${MB(b.reduce((s, x) => s + x.gz, 0))} MB`);
    if (res.sampleCompare) lines.push(`sample building (median-size) gzip-9 ${(res.sampleCompare.gz9 / 1024).toFixed(0)} KB vs brotli-9 ${(res.sampleCompare.br9 / 1024).toFixed(0)} KB of raw ${(res.sampleCompare.raw / 1024).toFixed(0)} KB; per attribute: ` + Object.entries(res.sampleCompare.per).map(([k, v]) => `${k} ${(v.raw / 1024).toFixed(0)}K->${(v.br9 / 1024).toFixed(0)}K`).join(', '));
  } else lines.push('page read failed: ' + JSON.stringify(res));
  lines.push(`specs the build starts from (${spec.source}): data/apartments ${spec.files} json files, raw ${MB(spec.raw)} MB, gzip ${MB(spec.gz)} MB, brotli ${MB(spec.br)} MB`);
  lines.push('GL bytes requested by owner (MB): ' + Object.entries(gl.own).map(([k, v]) => [k, (v.tex + v.buf) / 2 ** 20]).filter(x => x[1] > 5).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(', '));
  const text = lines.join('\n'); fs.writeFileSync(path.join(OUT, `report-apartment-buffers${PHONE ? '-phone' : ''}.txt`), text); console.log(text);
} finally { await chrome.close(); }
// 0 only if the page read produced meshes; an {error} used to be written into the report and exit 0 (see lib/outcome.mjs)
const outcome = buffersExitCode(pageResult);
for (const p of outcome.problems) console.error('apartment-buffers: ' + p);
process.exit(outcome.code);
