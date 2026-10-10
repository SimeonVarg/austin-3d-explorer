/**
 * measure-app.mjs - what the two frameworks cost the app TODAY, measured on the real page.
 *
 *   node ~/Projects/astra-pipe/tools/gpu-run.mjs --label renderer -- \
 *     node experiments/renderer/measure-app.mjs [--arms full,noslopes] [--out file.json] [--poses a,b]
 *
 * Arms (each one a fresh browser):
 *   full      the page as shipped
 *   noslopes  ?slopes=0 : no three.js layer at all, so whatever is left is MapLibre's
 * Per arm it records: layers by type, GL calls per frame by phase (maplibre | three), draw calls,
 * triangles, program switches, framebuffer passes, state changes, uniform writes, live GL bytes,
 * JS heap, library bytes, load milestones, and a V8 CPU profile of a camera orbit split by file.
 *
 * SOFTWARE GL (the default here) is right for COUNTING calls and bytes and WRONG for frame time:
 * any "ms" printed from a software run is marked `software`. VERIFY_GL=hardware asks for the chip.
 */
import fs from 'node:fs';
import path from 'node:path';
import { openApp, waitReady, poses as loadPoses, PRIVATE, REPO } from './lib/app.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const ARMS = (opt('--arms', 'full,noslopes')).split(',');
const OUT = opt('--out', path.join(PRIVATE, 'measure-app.json'));
const ALL = loadPoses();
const WANT = opt('--poses', null);
const POSES = WANT ? ALL.filter(p => WANT.split(',').includes(p.name)) : ALL;
const SOFTWARE = (process.env.VERIFY_GL || 'swiftshader') !== 'hardware';
const ARM_QUERY = { full: '', noslopes: 'slopes=0', noapts: 'apartments=0' };

const out = { when: new Date().toISOString(), software: SOFTWARE, arms: {} };
const save = () => fs.writeFileSync(OUT, JSON.stringify(out, null, 1));

async function runArm(arm) {
  console.log(`\n=== arm ${arm} ===`);
  const { browser, page, errors, t0, ctx } = await openApp({ query: ARM_QUERY[arm] });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  const res = { arm, query: ARM_QUERY[arm] };
  try {
    const ms = await waitReady(page, t0, { needApartments: arm !== 'noslopes' && arm !== 'noapts' });
    res.milestones = ms;
    console.log('ready', JSON.stringify(ms));
    await page.evaluate(() => window.__glc.wrapLayer());
    // let the post-reveal work (shadow proxy, facade atlas) drain before measuring
    await page.waitForTimeout(8000);

    // ---- style: layers by type ---------------------------------------------------------
    res.style = await page.evaluate(() => {
      const m = window.__map, st = m.getStyle(), hist = {}, vis = {};
      for (const l of st.layers) { hist[l.type] = (hist[l.type] || 0) + 1; if (l.layout?.visibility !== 'none') vis[l.type] = (vis[l.type] || 0) + 1; }
      const srcs = {}; for (const [id, s] of Object.entries(st.sources)) srcs[s.type] = (srcs[s.type] || 0) + 1;
      return { layers: st.layers.length, byType: hist, visibleByType: vis, sources: Object.keys(st.sources).length, sourcesByType: srcs,
        custom: st.layers.filter(l => l.type === 'custom').map(l => l.id) };
    });
    console.log('style', JSON.stringify(res.style));

    // ---- memory ---------------------------------------------------------------------------
    const heap = await cdp.send('Runtime.getHeapUsage');
    const pm = await cdp.send('Performance.getMetrics');
    res.memory = { heapUsedMB: +(heap.usedSize / 1048576).toFixed(1), heapTotalMB: +(heap.totalSize / 1048576).toFixed(1),
      metrics: Object.fromEntries(pm.metrics.filter(x => ['JSHeapUsedSize', 'JSHeapTotalSize', 'Nodes', 'LayoutCount', 'ScriptDuration', 'TaskDuration'].includes(x.name)).map(x => [x.name, x.value])) };
    res.memory.gl = await page.evaluate(() => {
      const L = window.__glc.live, mb = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, +(v / 1048576).toFixed(1)]));
      return { bufferMB: mb(L.buf), textureMB: mb(L.tex) };
    });
    res.memory.three = await page.evaluate(() => {
      const S = window.slopes && window.slopes.scene; if (!S) return null;
      const seen = new Set(); let cpu = 0, tris = 0, geoms = 0, meshes = 0, drawRanges = 0;
      S.traverse(o => { if (o.isMesh) meshes++; const g = o.geometry; if (!g || seen.has(g)) return; seen.add(g); geoms++;
        for (const a of Object.values(g.attributes || {})) { const arr = a.array || (a.data && a.data.array); if (arr && !seen.has(arr)) { seen.add(arr); cpu += arr.byteLength; } }
        if (g.index && g.index.array && !seen.has(g.index.array)) { seen.add(g.index.array); cpu += g.index.array.byteLength; }
        tris += g.index ? g.index.count / 3 : (g.attributes.position ? g.attributes.position.count / 3 : 0); });
      return { meshes, geometries: geoms, cpuArraysMB: +(cpu / 1048576).toFixed(1), triangles: Math.round(tris), threeRevision: window.THREE.REVISION };
    });
    console.log('memory', JSON.stringify(res.memory));

    // ---- bytes the page downloaded, by kind ------------------------------------------------
    res.resources = await page.evaluate(() => {
      const kinds = {}, libs = {};
      const kind = n => /maplibre-gl\.js/.test(n) ? 'maplibre js' : /maplibre-gl\.css/.test(n) ? 'maplibre css' : /three(\.min)?\.js/.test(n) ? 'three js' : /pmtiles\.js/.test(n) ? 'pmtiles js'
        : /\/js\/.*\.js/.test(n) ? 'own js' : /\.(css)$/.test(n.split('?')[0]) ? 'own css' : /\/data\/tiles\//.test(n) ? 'own pmtiles (range reads)' : /\/data\//.test(n) ? 'own data json'
        : /openfreemap/.test(n) ? 'openfreemap (style/tiles/glyphs)' : /\.(png|jpg|jpeg|webp|svg)/.test(n) ? 'images' : 'other';
      for (const e of performance.getEntriesByType('resource')) {
        const k = kind(e.name), o = kinds[k] || (kinds[k] = { n: 0, bytes: 0, decoded: 0 });
        o.n++; o.bytes += e.transferSize || 0; o.decoded += e.decodedBodySize || 0;
        if (/maplibre-gl\.js|three(\.min)?\.js|pmtiles\.js/.test(e.name)) libs[e.name.split('/').pop()] = { decoded: e.decodedBodySize, transfer: e.transferSize, dur: Math.round(e.duration) };
      }
      const nav = performance.getEntriesByType('navigation')[0];
      return { kinds, libs, domContentLoaded: Math.round(nav.domContentLoadedEventEnd), load: Math.round(nav.loadEventEnd) };
    });

    // ---- per-frame GL counts at each pose -----------------------------------------------------
    // frame 1 = the first frame after the camera moved (shadow maps and caches may redraw),
    // frames 2..4 = steady. Reported separately because they are different animals.
    res.poses = [];
    for (const p of POSES) {
      await page.evaluate(({ p }) => {
        const m = window.__map; if (m.isEasing && m.isEasing()) m.stop();
        m.jumpTo({ center: p.center, zoom: p.zoom, pitch: p.pitch, bearing: p.bearing });
        const sl = document.getElementById('tod-slider'); if (sl) sl.value = String(p.p);
        window.applyTimeOfDay(m, p.p);
      }, { p });
      await page.waitForTimeout(3500);
      await page.evaluate(() => new Promise(r => { const m = window.__map; if (m.loaded()) return r(); m.once('idle', () => r()); setTimeout(r, 20000); }));
      await page.waitForFunction(() => !(window.CityLighting && window.CityLighting.stats && window.CityLighting.stats.shadowProxyBuilding), null, { timeout: 60000, polling: 200 }).catch(() => {});
      const frames = [];
      for (let i = 0; i < 4; i++) {
        const f = await page.evaluate(async (first) => {
          const G = window.__glc, m = window.__map;
          G.sets.programs.clear(); G.sets.targets.clear();
          const a = G.snap(), t = performance.now(); G.threeMs = 0;
          await new Promise(r => { m.once('render', () => setTimeout(r, 0)); m.triggerRepaint(); });
          const b = G.snap();
          const diff = {};
          for (const cid of Object.keys(b)) for (const ph of Object.keys(b[cid])) {
            const d = {}; for (const k of Object.keys(b[cid][ph])) d[k] = +(b[cid][ph][k] - ((a[cid] && a[cid][ph] && a[cid][ph][k]) || 0)).toFixed(1);
            if (d.total) diff[cid + '/' + ph] = d;
          }
          return { diff, programs: G.sets.programs.size, targets: G.sets.targets.size, wallMs: Math.round(performance.now() - t), threeJsMs: +(G.threeMs).toFixed(1) };
        });
        frames.push(f);
        if (i === 0) await page.waitForTimeout(300);
      }
      const apt = await page.evaluate(() => { const c = window.slopesApartments.cull; return { meshes: c.meshes, drawnRanges: c.drawnRanges, ranges: c.ranges, drawnTriangles: Math.round(c.drawnTriangles), totalTriangles: Math.round(c.totalTriangles) }; }).catch(() => null);
      const sum = (fr, ph) => { const o = {}; for (const [k, v] of Object.entries(fr.diff)) if (k.endsWith('/' + ph) || ph === '*') for (const [kk, vv] of Object.entries(v)) o[kk] = (o[kk] || 0) + vv; return o; };
      const row = { name: p.name, p: p.p,
        first: { maplibre: sum(frames[0], 'maplibre'), three: sum(frames[0], 'three'), programs: frames[0].programs, targets: frames[0].targets, wallMs: frames[0].wallMs, threeJsMs: frames[0].threeJsMs },
        steady: { maplibre: sum(frames[2], 'maplibre'), three: sum(frames[2], 'three'), programs: frames[2].programs, targets: frames[2].targets, wallMs: frames[2].wallMs, threeJsMs: frames[2].threeJsMs },
        canvases: Object.keys(frames[2].diff), cull: apt };
      res.poses.push(row);
      const s = row.steady;
      console.log(`${p.name.padEnd(18)} steady: maplibre draws ${s.maplibre.draw || 0} tris ${Math.round(s.maplibre.tris || 0)} glcalls ${s.maplibre.total || 0} | three draws ${s.three.draw || 0} tris ${Math.round(s.three.tris || 0)} glcalls ${s.three.total || 0} | programs ${s.programs} fbo ${s.targets} wall ${s.wallMs}ms${SOFTWARE ? ' (software)' : ''}`);
      save();
    }

    // ---- frame time: N consecutive repaints, each ended with gl.finish() (only meaningful on a real GPU, vsync off) ----
    res.bench = {};
    for (const name of ['spawn-day', 'west-campus-day', 'downtown-day']) {
      const p = ALL.find(x => x.name === name); if (!p) continue;
      await page.evaluate(({ p }) => { const m = window.__map; if (m.isEasing && m.isEasing()) m.stop(); m.jumpTo({ center: p.center, zoom: p.zoom, pitch: p.pitch, bearing: p.bearing }); }, { p });
      await page.waitForTimeout(4000);
      await page.evaluate(() => new Promise(r => { const m = window.__map; if (m.loaded()) return r(); m.once('idle', () => r()); setTimeout(r, 20000); }));
      res.bench[name] = await page.evaluate(async () => {
        const m = window.__map, gl = m.painter.context.gl, G = window.__glc, ts = [], px = new Uint8Array(4); G.threeMs = 0;
        G.mute = true;     // the GL call counters off: they cost CPU time of their own and must not be in a frame time
        for (let i = 0; i < 45; i++) { const t = performance.now(); await new Promise(r => { m.once('render', () => r()); m.triggerRepaint(); }); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); ts.push(performance.now() - t); }
        G.mute = false; ts.splice(0, 5); ts.sort((a, b) => a - b);
        return { frames: ts.length, minMs: +ts[0].toFixed(2), medianMs: +ts[ts.length >> 1].toFixed(2), p90Ms: +ts[Math.floor(ts.length * 0.9)].toFixed(2), threeJsMsPerFrame: +(G.threeMs / 45).toFixed(2) };
      });
      console.log('bench', name, JSON.stringify(res.bench[name]), SOFTWARE ? '(software: not valid for timing)' : '');
    }

    // ---- V8 profile of an orbit: who spends the main thread ----------------------------------
    await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
    await page.evaluate(({ p }) => { const m = window.__map; m.jumpTo({ center: p.center, zoom: p.zoom, pitch: p.pitch, bearing: p.bearing }); }, { p: ALL[0] });
    await page.waitForTimeout(2500);
    await cdp.send('Profiler.start');
    await page.evaluate(() => { window.__glc.mute = true; });
    const prof = await page.evaluate(async (dur) => {
      const m = window.__map; const t0 = performance.now(); let frames = 0, b = m.getBearing();
      await new Promise(r => { const step = () => { frames++; m.jumpTo({ bearing: b + (performance.now() - t0) * 0.012 }); if (performance.now() - t0 < dur) requestAnimationFrame(step); else r(); }; step(); });
      return { frames, ms: Math.round(performance.now() - t0) };
    }, 12000);
    const { profile } = await cdp.send('Profiler.stop');
    await page.evaluate(() => { window.__glc.mute = false; });
    const byId = new Map(profile.nodes.map(n => [n.id, n]));
    const self = new Map(); const dts = profile.timeDeltas; let total = 0;
    profile.samples.forEach((id, i) => { const d = dts[i] || 0; total += d; self.set(id, (self.get(id) || 0) + d); });
    const byFile = {}, byFn = {};
    for (const [id, t] of self) {
      const n = byId.get(id), url = n.callFrame.url || '(native)';
      const f = /maplibre-gl/.test(url) ? 'maplibre' : /three(\.min)?\.js/.test(url) ? 'three' : /\/js\/([\w.-]+)/.test(url) ? 'js/' + url.match(/\/js\/([\w.-]+)/)[1] : url ? (url === '(native)' ? '(native/idle/gc)' : 'other') : 'other';
      byFile[f] = (byFile[f] || 0) + t;
      const key = f + ' :: ' + (n.callFrame.functionName || '(anon)'); byFn[key] = (byFn[key] || 0) + t;
    }
    const pct = v => +(100 * v / total).toFixed(1);
    res.profile = { orbit: prof, sampledMs: Math.round(total / 1000), software: SOFTWARE,
      byFilePct: Object.fromEntries(Object.entries(byFile).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => [k, pct(v)])),
      topFunctions: Object.entries(byFn).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, v]) => [k, pct(v)]) };
    console.log('profile', JSON.stringify(res.profile.byFilePct));
    res.errors = errors.slice(0, 10);
  } catch (e) {
    res.error = String(e && e.stack || e).slice(0, 800); console.log('ARM FAILED', res.error);
  } finally { await browser.__done(); }
  out.arms[arm] = res; save();
}

for (const a of ARMS) await runArm(a);
console.log('\nwrote', OUT);
