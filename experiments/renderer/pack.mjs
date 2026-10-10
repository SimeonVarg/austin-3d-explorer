/**
 * pack.mjs - turn the app's built arrays (dump-apartments.mjs) into the prototype's packed format,
 * and report what that format saves.
 *
 *   node experiments/renderer/pack.mjs            (no browser, no GPU slot)
 *
 * Reads  apartments.json + apartments.bin   (the app's own arrays, as built at runtime)
 * Writes apartments.packed.json + .bin       (what proto/renderer.js draws)
 *        apartments.packed.meshopt.bin       (the same vertex/index data meshopt-encoded: the wire form)
 *        pack-report.json                    (sizes and errors; the numbers the study quotes)
 *
 * The packed vertex is 24 bytes:
 *   int16 x,y,z (relative to the building's centre, scaled to its extent) + uint16 building id   8
 *   int8  normal xyz + facet flag                                                                 4
 *   uint8 day rgb + gradient x                                                                    4
 *   uint8 golden rgb + gradient y (height term)                                                   4
 *   uint8 night rgb + surface kind                                                                4
 * Dropped for the BASE look (the study prices them back in): aSurface's size and strength (the
 * brick joint and tile-noise sizes read by the procedural surface pass), 3 bytes of each colour
 * triple's alpha (unused). A full-fidelity vertex adds 4 bytes: size.y, size.z, strength as uint8
 * on a log scale, and the kind byte already carried. So ~28 bytes against the app's ~60.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { PRIVATE } from './lib/app.mjs';

const man = JSON.parse(fs.readFileSync(path.join(PRIVATE, 'apartments.json'), 'utf8'));
const bin = fs.readFileSync(path.join(PRIVATE, 'apartments.bin'));
const ab = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength);
const CTORS = { Float32Array, Uint32Array, Uint16Array, Int16Array, Uint8Array, Int8Array, Int32Array, Float64Array };
const view = d => new CTORS[d.type](ab, d.offset, d.bytes / CTORS[d.type].BYTES_PER_ELEMENT);
const half = h => { const s = (h & 0x8000) >> 15, e = (h & 0x7c00) >> 10, f = h & 0x03ff; return e === 0 ? (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024) : e === 0x1f ? (f ? NaN : (s ? -Infinity : Infinity)) : (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024); };

// ---- what the app holds now (CPU arrays, per attribute), from the dump ----
const appBytes = {}; let appVerts = 0, appIdx = 0;
for (const m of man.meshes) {
  appVerts += m.vertexCount; appIdx += m.index ? m.index.count : 0;
  for (const [k, a] of Object.entries(m.attrs)) appBytes[k] = (appBytes[k] || 0) + (a.bytes || 0);
  if (m.index) appBytes.index = (appBytes.index || 0) + m.index.bytes;
}
const appTotal = Object.values(appBytes).reduce((a, b) => a + b, 0);

// ---- pass 1: ranges, gradient maxima ----
let gxMax = 0, gyMax = 0, nChunks = 0, kinds = {};
const chunkSrc = [];                   // { mesh, i, sph, start, count }
for (const m of man.meshes) {
  const c = m.cull; if (!c) throw new Error('mesh ' + m.name + ' has no cull ranges; dump with the culling arrays');
  const sph = view(c.sph), start = view(c.start), count = view(c.count);
  for (let i = 0; i < c.n; i++) if (count[i] > 0) chunkSrc.push({ m, i, sph: [sph[i * 4], sph[i * 4 + 1], sph[i * 4 + 2], sph[i * 4 + 3]], start: start[i], count: count[i] });
  const g = view(m.attrs.aGrad); for (let v = 0; v < g.length; v += 2) { if (g[v] > gxMax) gxMax = g[v]; if (g[v + 1] > gyMax) gyMax = g[v + 1]; }
}
nChunks = chunkSrc.length;
if (nChunks > 32000) throw new Error('chunk id must fit a signed int16: ' + nChunks);
console.log(`app: ${man.meshes.length} meshes, ${appVerts} vertices, ${appIdx / 3} triangles, ${nChunks} building ranges, arrays ${(appTotal / 1048576).toFixed(1)} MB; aGrad max ${gxMax.toFixed(3)}, ${gyMax.toFixed(2)}`);

// ---- pass 2: build ----
const STRIDE = 24;
let totalVerts = 0, totalIdx = 0;
const spans = chunkSrc.map(ch => {
  const idx = view(ch.m.index); let lo = Infinity, hi = -1;
  for (let k = ch.start; k < ch.start + ch.count; k++) { const v = idx[k]; if (v < lo) lo = v; if (v > hi) hi = v; }
  ch.lo = lo; ch.hi = hi; ch.nv = hi - lo + 1; totalVerts += ch.nv; totalIdx += ch.count; return ch;
});
const vb = new ArrayBuffer(totalVerts * STRIDE), v16 = new Int16Array(vb), v8 = new Int8Array(vb), u16 = new Uint16Array(vb), u8 = new Uint8Array(vb);
const ib = new Uint32Array(totalIdx);
const table = new Float32Array(nChunks * 4), chunks = new Float32Array(nChunks * 8);
let vOff = 0, iOff = 0, maxErr = 0, errSum = 0, errN = 0, framed = 0;
const q8 = (v, max) => v <= 0 ? 0 : Math.max(1, Math.min(255, Math.round(v / max * 255)));
spans.forEach((ch, ci) => {
  const m = ch.m, P = view(m.attrs.position), N = view(m.attrs.normal), D = view(m.attrs.cDay), G = view(m.attrs.cGold), Ni = view(m.attrs.cNight), Gr = view(m.attrs.aGrad), F = view(m.attrs.aFacet), S = m.attrs.aSurface && !m.attrs.aSurface.missing ? view(m.attrs.aSurface) : null;
  const sIsHalf = S && m.attrs.aSurface.type === 'Uint16Array';
  const idx = view(m.index);
  // bbox centre and extent of this building's vertices
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let v = ch.lo; v <= ch.hi; v++) { const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2, ext = Math.max(x1 - x0, y1 - y0, z1 - z0) / 2 || 1, scale = ext / 32767;
  table[ci * 4] = cx; table[ci * 4 + 1] = cy; table[ci * 4 + 2] = cz; table[ci * 4 + 3] = scale;
  chunks[ci * 8] = ch.sph[0]; chunks[ci * 8 + 1] = ch.sph[1]; chunks[ci * 8 + 2] = ch.sph[2]; chunks[ci * 8 + 3] = ch.sph[3];
  chunks[ci * 8 + 4] = iOff; chunks[ci * 8 + 5] = ch.count;
  for (let v = ch.lo; v <= ch.hi; v++) {
    const o = (vOff + v - ch.lo);
    const qx = Math.round((P[v * 3] - cx) / scale), qy = Math.round((P[v * 3 + 1] - cy) / scale), qz = Math.round((P[v * 3 + 2] - cz) / scale);
    v16[o * 12] = qx; v16[o * 12 + 1] = qy; v16[o * 12 + 2] = qz; u16[o * 12 + 3] = ci;
    const e = Math.max(Math.abs(qx * scale + cx - P[v * 3]), Math.abs(qy * scale + cy - P[v * 3 + 1]), Math.abs(qz * scale + cz - P[v * 3 + 2])); if (e > maxErr) maxErr = e; errSum += e; errN++;
    v8[o * 24 + 8] = Math.round(N[v * 3] * 127); v8[o * 24 + 9] = Math.round(N[v * 3 + 1] * 127); v8[o * 24 + 10] = Math.round(N[v * 3 + 2] * 127); v8[o * 24 + 11] = F[v] > 0.5 ? 127 : 0;
    u8[o * 24 + 12] = D[v * 3]; u8[o * 24 + 13] = D[v * 3 + 1]; u8[o * 24 + 14] = D[v * 3 + 2]; u8[o * 24 + 15] = q8(Gr[v * 2], gxMax);
    u8[o * 24 + 16] = G[v * 3]; u8[o * 24 + 17] = G[v * 3 + 1]; u8[o * 24 + 18] = G[v * 3 + 2]; u8[o * 24 + 19] = q8(Gr[v * 2 + 1], gyMax);
    u8[o * 24 + 20] = Ni[v * 3]; u8[o * 24 + 21] = Ni[v * 3 + 1]; u8[o * 24 + 22] = Ni[v * 3 + 2];
    const kind = S ? Math.round(sIsHalf ? half(S[v * 4]) : S[v * 4]) : 0; u8[o * 24 + 23] = Math.max(0, Math.min(255, kind)); kinds[kind] = (kinds[kind] || 0) + 1;
  }
  for (let k = 0; k < ch.count; k++) ib[iOff + k] = idx[ch.start + k] - ch.lo + vOff;
  vOff += ch.nv; iOff += ch.count; framed++;
});

// ---- write the packed pair ----
const vBytes = totalVerts * STRIDE, iBytes = totalIdx * 4;
const align = n => (n + 3) & ~3;
const meta = { format: 'flyover-apartments-packed-1', stride: STRIDE, vertexCount: totalVerts, vertexBytes: vBytes, indexType: 'u32', indexCount: totalIdx, indexOffset: align(vBytes), chunkCount: nChunks,
  tableOffset: align(vBytes) + iBytes, chunkOffset: align(vBytes) + iBytes + table.byteLength, gradScale: [gxMax / 255, gyMax / 255], origin: man.origin, kinds };
const out = Buffer.alloc(meta.chunkOffset + chunks.byteLength);
Buffer.from(vb).copy(out, 0); Buffer.from(ib.buffer).copy(out, meta.indexOffset); Buffer.from(table.buffer).copy(out, meta.tableOffset); Buffer.from(chunks.buffer).copy(out, meta.chunkOffset);
fs.writeFileSync(path.join(PRIVATE, 'apartments.packed.json'), JSON.stringify(meta));
fs.writeFileSync(path.join(PRIVATE, 'apartments.packed.bin'), out);

// ---- the wire form: meshopt + gzip, and the real decode time ----
const report = { app: { meshes: man.meshes.length, vertices: appVerts, triangles: appIdx / 3, buildingRanges: nChunks, bytesByAttribute: appBytes, totalBytes: appTotal, bytesPerVertex: +(appTotal / appVerts).toFixed(1) } };
report.packed = { vertices: totalVerts, vertexBytes: vBytes, indexBytes: iBytes, chunkBytes: table.byteLength + chunks.byteLength, totalBytes: out.length, bytesPerVertex: STRIDE,
  vertexSharePct: +(100 * totalVerts / appVerts).toFixed(1), maxPositionErrorM: +maxErr.toFixed(4), meanPositionErrorM: +(errSum / errN).toFixed(5), skippedMeshes: man.skipped.length };
report.packed.gzipBytes = zlib.gzipSync(out, { level: 6 }).length;
report.packed.brotliBytes = zlib.brotliCompressSync(out, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } }).length;
try {
  const { MeshoptEncoder, MeshoptDecoder } = await import('meshoptimizer');
  await MeshoptEncoder.ready; await MeshoptDecoder.ready;
  const vtx = new Uint8Array(vb), idx32 = ib;
  const ev = MeshoptEncoder.encodeVertexBuffer(vtx, totalVerts, STRIDE);
  const ei = MeshoptEncoder.encodeIndexBuffer(new Uint8Array(idx32.buffer), totalIdx, 4);
  const meshoptBin = Buffer.concat([ev, ei]); fs.writeFileSync(path.join(PRIVATE, 'apartments.packed.meshopt.bin'), meshoptBin);
  const gz = b => zlib.gzipSync(b, { level: 6 }).length, br = b => zlib.brotliCompressSync(b, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } }).length;
  // decode time: min of 5
  let best = Infinity, bestV = Infinity, bestI = Infinity;
  for (let r = 0; r < 5; r++) {
    const dv = new Uint8Array(vBytes), di = new Uint32Array(totalIdx);
    let t = performance.now(); MeshoptDecoder.decodeVertexBuffer(dv, totalVerts, STRIDE, ev); const tv = performance.now() - t;
    t = performance.now(); MeshoptDecoder.decodeIndexBuffer(new Uint8Array(di.buffer), totalIdx, 4, ei); const ti = performance.now() - t;
    if (tv + ti < best) { best = tv + ti; bestV = tv; bestI = ti; }
    if (r === 0) { let bad = 0; for (let i = 0; i < Math.min(vBytes, 4e6); i++) if (dv[i] !== vtx[i]) { bad++; break; } if (bad || di[1] !== idx32[1] || di[totalIdx - 1] !== idx32[totalIdx - 1]) throw new Error('meshopt round trip failed'); }
  }
  report.meshopt = { vertexBytes: ev.length, indexBytes: ei.length, totalBytes: meshoptBin.length, plusGzipBytes: gz(meshoptBin), plusBrotliBytes: br(meshoptBin), decodeMsNode: +best.toFixed(1), decodeVertexMs: +bestV.toFixed(1), decodeIndexMs: +bestI.toFixed(1), version: 'meshoptimizer npm ' + JSON.parse(fs.readFileSync(new URL('./node_modules/meshoptimizer/package.json', import.meta.url))).version };
  // what 16-bit indices would be (each building under 65,536 vertices): a straight halving of the index part
  const maxChunkVerts = Math.max(...spans.map(c => c.nv)); report.packed.maxVerticesPerBuilding = maxChunkVerts; report.packed.u16IndicesPossible = maxChunkVerts < 65536;
} catch (e) { report.meshoptError = String(e).slice(0, 200); }
// the source data the app BUILDS these from, for scale
const src = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../data/apartments');
let srcBytes = 0; try { for (const f of fs.readdirSync(src)) srcBytes += fs.statSync(path.join(src, f)).size; } catch (e) {}
report.sourceJsonBytes = srcBytes; report.sourceJsonGzipBytes = (() => { let n = 0; try { for (const f of fs.readdirSync(src)) n += zlib.gzipSync(fs.readFileSync(path.join(src, f))).length; } catch (e) {} return n; })();
fs.writeFileSync(path.join(PRIVATE, 'pack-report.json'), JSON.stringify(report, null, 1));
const mb = b => (b / 1048576).toFixed(2) + ' MB';
console.log(`packed: ${totalVerts} vertices (${report.packed.vertexSharePct}% of the app's: the app keeps vertices outside the drawn ranges), ${nChunks} buildings, ${mb(out.length)}; gzip ${mb(report.packed.gzipBytes)}; brotli ${mb(report.packed.brotliBytes)}`);
if (report.meshopt) console.log(`meshopt: ${mb(report.meshopt.totalBytes)} (${mb(report.meshopt.plusBrotliBytes)} brotli), decode ${report.meshopt.decodeMsNode} ms in node`);
console.log(`position error: max ${report.packed.maxPositionErrorM} m, mean ${report.packed.meanPositionErrorM} m; app arrays ${mb(appTotal)} (${report.app.bytesPerVertex} B/vertex)`);
console.log(`source JSON the app builds from: ${mb(srcBytes)} (${mb(report.sourceJsonGzipBytes)} gzip)`);
