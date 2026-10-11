/**
 * mac-frame.mjs - FRAME TIME OF THE REAL PAGE on a real GPU, several levers, interleaved, minimum of reps. Built for the owner's Intel Mac (headless Chrome,
 * hardware GL, through the one-browser queue: `node ~/Projects/astra-pipe/tools/gpu-run.mjs --label frame -- node experiments/facet/mac-frame.mjs ...`).
 *
 *   ARMS is a list name=port:query (the page is served by scripts/serve.py on that port from some work copy):
 *     node experiments/facet/mac-frame.mjs --arms "a=8501:,b=8501:facadeshader=1,c=8502:packverts=1" --reps 3 --out frame.json
 * For each rep, each arm in turn: load the page, wait for the authored apartments, then at each view repaint N times, each frame ended by reading one pixel
 * back (the card has really finished), no GL call counters in the timed frames. Reports p50 / p90 / min per view, and for one extra counted frame the
 * triangles and indices submitted by the three.js layer and the vertex bytes of the apartment meshes. Run only when the machine is quiet (load under 10).
 */
import fs from 'node:fs';
import os from 'node:os';
import { openApp, waitReady } from '../renderer/lib/app.mjs';
const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const ARMS = opt('--arms', '').split(',').filter(Boolean).map(s => { const e = s.indexOf('='), name = s.slice(0, e), rest = s.slice(e + 1); const i = rest.indexOf(':'); return { name, port: rest.slice(0, i), query: rest.slice(i + 1) }; });
const REPS = +opt('--reps', '3'), FRAMES = +opt('--frames', '45'), OUT = opt('--out', 'frame.json');
const VIEWS = [
  { name: 'spawn', center: [-97.7434, 30.2857], zoom: 16.5, pitch: 64, bearing: 90, p: 0.12 },
  { name: 'west-campus', center: [-97.7433, 30.2827], zoom: 15.9, pitch: 68, bearing: 0, p: 0.12 },
  { name: 'high', center: [-97.7405, 30.2830], zoom: 14.8, pitch: 55, bearing: 20, p: 0.12 },
];
process.env.RENDERER_NOVSYNC = '1'; process.env.VERIFY_GL ||= 'hardware';
const results = { when: new Date().toISOString(), host: os.hostname(), loadAtStart: os.loadavg(), frames: FRAMES, reps: [] };
const save = () => fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
for (let rep = 0; rep < REPS; rep++) {
  const row = { rep, arms: {}, load: [] };
  for (const arm of ARMS) {
    console.log(`\n== rep ${rep + 1} arm ${arm.name} (${arm.port}: ${arm.query || 'default'}) load ${os.loadavg().map(x => x.toFixed(1)).join(' ')}`);
    row.load.push(os.loadavg()[0]);
    const url = `http://127.0.0.1:${arm.port}/_harness.html?intro=0&drift=0&namelabels=0&facadepace=0&timeofdaypace=0${arm.query ? '&' + arm.query : ''}`;
    const { browser, page, errors, t0 } = await openApp({ url, viewport: { width: 1440, height: 900 } });
    const res = { query: arm.query, views: {} };
    try {
      res.milestones = await waitReady(page, t0, { timeoutMs: 15 * 60 * 1000 });
      await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
      await page.waitForTimeout(6000);
      res.mesh = await page.evaluate(() => { let verts = 0, bytes = 0, tris = 0, n = 0; const g = window.slopesApartments.group; g && g.traverse(m => { if (m.isMesh && !/filtered/.test(m.name || '')) { const p = m.geometry.attributes.position; verts += p ? p.count : 0; tris += m.geometry.index ? m.geometry.index.count / 3 : 0; for (const k in m.geometry.attributes) bytes += m.geometry.attributes[k].array ? m.geometry.attributes[k].array.byteLength : 0; n++; } }); return { meshes: n, vertices: verts, triangles: tris, vertexBytes: bytes, bytesPerVertex: verts ? +(bytes / verts).toFixed(1) : null }; });
      res.shaderDefines = await page.evaluate(() => { const o = {}; window.slopesApartments.group.traverse(m => { for (const mt of [].concat(m.material || [])) if (mt && mt.isShaderMaterial) for (const k of Object.keys(mt.defines || {})) o[k] = (o[k] || 0) + 1; }); return o; });
      console.log('   shader defines on the apartment materials:', JSON.stringify(res.shaderDefines));
      for (const v of VIEWS) {
        await page.evaluate(async ({ v }) => { const m = window.__map; if (m.isEasing && m.isEasing()) m.stop(); m.jumpTo({ center: v.center, zoom: v.zoom, pitch: v.pitch, bearing: v.bearing }); const sl = document.getElementById('tod-slider'); if (sl) sl.value = String(v.p); window.applyTimeOfDay(m, v.p); }, { v });
        await page.waitForTimeout(3500);
        await page.evaluate(() => new Promise(r => { const m = window.__map; if (m.loaded()) return r(); m.once('idle', () => r()); setTimeout(r, 20000); }));
        await page.waitForFunction(() => !(window.CityLighting && window.CityLighting.stats && window.CityLighting.stats.shadowProxyBuilding), null, { timeout: 60000, polling: 200 }).catch(() => {});
        // one counted frame: what the three.js layer submits
        const counted = await page.evaluate(async () => {
          const G = window.__glc, m = window.__map; let out = null;
          for (let i = 0; i < 3; i++) {
            const a = G.snap(); await new Promise(r => { m.once('render', () => setTimeout(r, 0)); m.triggerRepaint(); }); const b = G.snap();
            const d = { three: { draw: 0, tris: 0 }, maplibre: { draw: 0, tris: 0 } };
            for (const cid of Object.keys(b)) for (const ph of Object.keys(b[cid])) { if (!d[ph]) continue; for (const k of ['draw', 'tris']) d[ph][k] += b[cid][ph][k] - ((a[cid] && a[cid][ph] && a[cid][ph][k]) || 0); }
            out = d;
          }
          const c = window.slopesApartments.cull || {};
          return { threeTriangles: Math.round(out.three.tris), threeDraws: Math.round(out.three.draw), mapTriangles: Math.round(out.maplibre.tris), aptDrawnTriangles: Math.round(c.drawnTriangles || 0), aptTotalTriangles: Math.round(c.totalTriangles || 0) };
        });
        const t = await page.evaluate(async (N) => {
          const m = window.__map, gl = m.painter.context.gl, G = window.__glc, ts = [], px = new Uint8Array(4); G.mute = true;
          for (let i = 0; i < N; i++) { const t = performance.now(); await new Promise(r => { m.once('render', () => r()); m.triggerRepaint(); }); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); ts.push(performance.now() - t); }
          G.mute = false; ts.splice(0, 5); ts.sort((a, b) => a - b); const q = f => +ts[Math.min(ts.length - 1, Math.floor(ts.length * f))].toFixed(1);
          return { n: ts.length, min: +ts[0].toFixed(1), p50: q(0.5), p90: q(0.9) };
        }, FRAMES);
        res.views[v.name] = { ...t, ...counted, load1: +os.loadavg()[0].toFixed(1) };
        console.log(`   ${v.name.padEnd(12)} p50 ${t.p50} ms  p90 ${t.p90}  min ${t.min}  | apt drawn ${counted.aptDrawnTriangles}/${counted.aptTotalTriangles} map tris ${counted.mapTriangles} | load ${os.loadavg()[0].toFixed(1)}`);
      }
      res.errors = errors.filter(e => !/warning/i.test(e)).slice(0, 5);
    } catch (e) { res.fatal = String(e); console.log('FAILED', e); }
    row.arms[arm.name] = res; await browser.__done();
    results.reps[rep] = row; save();
  }
}
// summary: minimum over reps of each arm's p50 and p90
console.log('\n== SUMMARY (minimum over reps; ms per frame, real page, 1440x900)');
const names = ARMS.map(a => a.name);
for (const v of VIEWS) {
  const line = names.map(n => { const xs = results.reps.map(r => r.arms[n] && r.arms[n].views[v.name]).filter(Boolean); if (!xs.length) return `${n}: -`; return `${n}: p50 ${Math.min(...xs.map(x => x.p50))} / p90 ${Math.min(...xs.map(x => x.p90))}`; }).join(' | ');
  console.log(v.name.padEnd(12), line);
}
results.summary = 'see stdout'; save();
process.exit(0);
