/**
 * summarize.mjs - print the markdown tables the study quotes, from the JSON the other scripts wrote.
 *   node experiments/renderer/summarize.mjs [dir]       (dir defaults to RENDERER_OUT)
 * Reads whatever exists: measure-app.json, pack-report.json, libs-measure.json, compare-*\/result.json, frames.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PRIVATE } from './lib/app.mjs';

const dir = process.argv[2] || PRIVATE;
const rd = f => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { return null; } };
const mb = b => (b / 1048576).toFixed(1);
const out = [];
const P = (...a) => out.push(a.join(' '));

const m = rd('measure-app.json');
if (m) {
  P(`\n### measure-app (${m.software ? 'SOFTWARE GL: counts valid, times not' : 'hardware GL'})`);
  for (const [arm, r] of Object.entries(m.arms)) {
    if (r.error) { P(`arm ${arm}: FAILED ${r.error.slice(0, 200)}`); continue; }
    P(`\n**arm ${arm}** (${r.query || 'as shipped'}): layers ${r.style?.layers} (${JSON.stringify(r.style?.byType)}), sources ${r.style?.sources} ${JSON.stringify(r.style?.sourcesByType)}`);
    P(`milestones ms: ${JSON.stringify({ ...r.milestones, last: undefined })}`);
    P(`memory: heap ${r.memory?.heapUsedMB} MB; GL buffers ${JSON.stringify(r.memory?.gl?.bufferMB)} MB; textures ${JSON.stringify(r.memory?.gl?.textureMB)} MB; three ${JSON.stringify(r.memory?.three)}`);
    P(`bytes: ${JSON.stringify(Object.fromEntries(Object.entries(r.resources?.kinds || {}).map(([k, v]) => [k, `${v.n} req ${(v.decoded / 1048576).toFixed(2)} MB`])))}`);
    P('\n| view | maplibre draws | maplibre tris | maplibre GL calls | three draws | three tris | three GL calls | programs | passes (fbo) | uniforms | state | first-frame draws |');
    P('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
    for (const v of r.poses || []) {
      const s = v.steady, f = v.first;
      P(`| ${v.name} | ${s.maplibre.draw || 0} | ${Math.round(s.maplibre.tris || 0)} | ${s.maplibre.total || 0} | ${s.three.draw || 0} | ${Math.round(s.three.tris || 0)} | ${s.three.total || 0} | ${s.programs} | ${s.targets} | ${(s.maplibre.uniform || 0) + (s.three.uniform || 0)} | ${(s.maplibre.state || 0) + (s.three.state || 0)} | ${(f.maplibre.draw || 0) + (f.three.draw || 0)} |`);
    }
    if (r.bench) { P('\nframe time (min/median/p90 ms, 40 frames, gl.finish after each)'); for (const [k, v] of Object.entries(r.bench)) P(`- ${k}: ${v.minMs} / ${v.medianMs} / ${v.p90Ms}; three.js layer JS ${v.threeJsMsPerFrame} ms/frame`); }
    if (r.profile) { P(`\nprofile (${r.profile.sampledMs} ms sampled): ${JSON.stringify(r.profile.byFilePct)}`); P('top: ' + r.profile.topFunctions.slice(0, 12).map(x => x.join(' ')).join(' | ')); }
  }
}
const k = rd('pack-report.json');
if (k) {
  P('\n### pack-report');
  P(`app: ${k.app.vertices} vertices, ${k.app.triangles} triangles, ${k.app.buildingRanges} buildings, arrays ${mb(k.app.totalBytes)} MB (${k.app.bytesPerVertex} B/vertex); by attribute ${JSON.stringify(Object.fromEntries(Object.entries(k.app.bytesByAttribute).map(([a, b]) => [a, mb(b) + ' MB'])))}`);
  P(`packed: ${k.packed.vertices} vertices x ${k.packed.bytesPerVertex} B, total ${mb(k.packed.totalBytes)} MB, gzip ${mb(k.packed.gzipBytes)}, brotli ${mb(k.packed.brotliBytes)}; max position error ${k.packed.maxPositionErrorM} m, mean ${k.packed.meanPositionErrorM} m`);
  if (k.meshopt) P(`meshopt: vertex ${mb(k.meshopt.vertexBytes)} + index ${mb(k.meshopt.indexBytes)} = ${mb(k.meshopt.totalBytes)} MB; +gzip ${mb(k.meshopt.plusGzipBytes)}, +brotli ${mb(k.meshopt.plusBrotliBytes)}; decode ${k.meshopt.decodeMsNode} ms (node ${k.meshopt.version})`);
  P(`source JSON the app builds from: ${mb(k.sourceJsonBytes)} MB (${mb(k.sourceJsonGzipBytes)} gzip)`);
}
const l = rd('libs-measure.json');
if (l) { P('\n### libraries'); for (const [f, s] of Object.entries(l.sizes)) P(`- ${f}: raw ${(s.raw / 1024).toFixed(0)} KB, gzip ${(s.gzip9 / 1024).toFixed(0)} KB, brotli ${(s.brotli9 / 1024).toFixed(0)} KB; parse ${JSON.stringify(l.parse[f] || {})}`); }
for (const d of fs.existsSync(dir) ? fs.readdirSync(dir).filter(x => x.startsWith('compare-') && x !== 'compare-app') : []) {
  const r = rd(path.join(d, 'result.json')); if (!r) continue;
  P(`\n### ${d} (${r.software ? 'software GL' : 'hardware GL'}; tolerance ${r.tolerance}/255)`);
  P('| view | shows buildings | building px % | over tolerance, of building px % | over, whole frame % | silhouette IoU | mean abs diff (0-255) | SSIM |');
  P('|---|---|---:|---:|---:|---:|---:|---:|');
  for (const v of r.rows) P(`| ${v.name} | ${v.showsBuildings ? 'yes' : 'no'} | ${v.buildingPctApp} | ${v.pctOverOnBuildings} | ${v.pctOverWholeFrame} | ${v.silhouetteIoU} | ${v.meanAbsDiffOnBuildings} | ${v.ssim} |`);
  P(`summary (views with buildings): ${JSON.stringify(r.summary)}`);
}
console.log(out.join('\n'));
