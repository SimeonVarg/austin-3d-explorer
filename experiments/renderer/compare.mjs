/**
 * compare.mjs - THE AUTOMATED TEST. For each of the ten cameras in scripts/verify/ci/poses.json it
 * renders the REAL app and the PROTOTYPE from the same camera and reports how far apart they are.
 *
 *   node ~/Projects/astra-pipe/tools/gpu-run.mjs --label renderer -- \
 *     node experiments/renderer/compare.mjs [--poses a,b] [--break light|quant|facet] [--tag name] [--phase app|proto|compare]
 *
 * What is compared, and why this way:
 *   - The app side is the real page with only the authored apartment buildings left on screen: every
 *     other map layer hidden, every other group in the three.js scene removed, the sky and the page
 *     chrome hidden, the background a flat #ff00ff. The look is the BASE look (?sunlight=0&surfaces=0
 *     &facadefilter=0): MapLibre's own lighting formula, no shadows, no window reflection, no
 *     procedural surface detail. That is the part this prototype ports; the rest is listed in the study.
 *   - The camera is read off the app: after each frame, `slopes.camera.projectionMatrix` is exactly the
 *     local-metres-to-clip matrix the three.js layer drew with, and the light uniforms are read off its
 *     material. The prototype is handed those numbers and nothing else.
 *   - Numbers per view: percent of pixels over tolerance (whole frame, the CI definition, and over just
 *     the building pixels, which is the honest one because the empty background dilutes the first),
 *     silhouette overlap (IoU), mean colour difference, and SSIM on 8x8 luma blocks.
 *   - --break <mode> deliberately breaks the prototype (light = sun on the wrong side, quant =
 *     coarser positions, facet = one shading feature silently dropped) to show the numbers move.
 * Software GL is used unless VERIFY_GL=hardware. Pixels are valid on software; any ms is marked.
 */
import fs from 'node:fs';
import path from 'node:path';
import { openApp, waitReady, poses as loadPoses, PRIVATE, BASE } from './lib/app.mjs';
import { startStatic } from './lib/static.mjs';
import { decodePNG, rgbOf, compareImages, sideBySide } from './lib/images.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const PHASE = opt('--phase', 'all');
const BREAK = opt('--break', '');
const FORMAT = opt('--format', '');                  // meshopt: load the wire form (brotli + meshopt) instead of the raw packed file
const MODE = opt('--mode', 'standalone');            // standalone: no MapLibre on the page | maplibre: path A, the layer inside a real MapLibre map
const TAG = opt('--tag', (MODE === 'maplibre' ? 'maplibre' : 'standalone') + (BREAK ? '-break-' + BREAK : '') + (FORMAT ? '-' + FORMAT : ''));
const ALL = loadPoses();
const WANT = opt('--poses', null);
const POSES = WANT ? ALL.filter(p => WANT.split(',').includes(p.name)) : ALL;
const SOFTWARE = (process.env.VERIFY_GL || 'swiftshader') !== 'hardware';
const VIEWPORT = { width: 1440, height: 900 };            // the size ci/pictures.mjs shoots at
const DIR = path.join(PRIVATE, 'compare-' + TAG);
const APPDIR = path.join(PRIVATE, 'compare-app');          // the app side is shot once and reused by every proto run
fs.mkdirSync(DIR, { recursive: true }); fs.mkdirSync(APPDIR, { recursive: true });
const UNIFORMS = ['u_lightpos', 'u_lightcolor', 'u_lightintensity', 'u_vertical_gradient', 'u_opacity', 'u_roof_shade', 'u_materialP', 'u_facet_on', 'u_facet_ambient', 'u_facet_lo', 'u_facet_hi', 'u_facet_sin', 'u_facet_cos', 'u_sloped_max_z'];
const APP_QUERY = 'sunlight=0&surfaces=0&facadefilter=0&campuslandscape=0';

// ------------------------------------------------------------------ app side
async function shootApp() {
  console.log('== app side ==');
  const { browser, page, errors, t0 } = await openApp({ query: APP_QUERY, viewport: VIEWPORT });
  const frames = { query: APP_QUERY, viewport: VIEWPORT, software: SOFTWARE, views: {} };
  try {
    const ms = await waitReady(page, t0);
    console.log('ready', JSON.stringify({ ...ms, last: undefined }));
    await page.evaluate(() => window.__glc.wrapLayer());
    // The page's own picture grade (exposure, contrast, filmic curve, auto brightness) is a CSS filter on the map host; the prototype has none.
    // Neutral on both sides: the grade is a look the study does not port, and it must not be counted as a renderer difference.
    await page.evaluate(() => { if (window.SKY_COMP) window.SKY_COMP.on = false;   // js/sky.js: the live switch for the GL sky
      const G = window.GFX; if (G) { Object.assign(G, { autoExposure: false, exposure: 1, contrast: 1, saturation: 1, filmic: 0, vignette: 0, bloom: 0, grain: 0 }); try { window.applyGraphics(); } catch (e) {} }
      try { window.__map.setSky({ 'sky-color': '#ff00ff', 'horizon-color': '#ff00ff', 'fog-color': '#ff00ff', 'sky-horizon-blend': 0, 'horizon-fog-blend': 0, 'fog-ground-blend': 0, 'atmosphere-blend': 0 }); } catch (e) {} });
    await page.addStyleTag({ content: 'html,body{background:#ff00ff!important} #map{background:#ff00ff!important} body>*:not(#map){display:none!important} .maplibregl-control-container,.maplibregl-ctrl{display:none!important} html,body,#map,#map *{filter:none!important;mix-blend-mode:normal!important} #sky,#sky-glow,#sky-canvas,[id^="sky"],[class*="sky"]{display:none!important}' });
    const isolate = () => page.evaluate(() => {
      const m = window.__map, A = window.slopesApartments, S = window.slopes;
      let hidden = 0;
      // every layer MapLibre holds, custom ones included (getStyle() leaves them out): the GL sky and the depth fog are custom layers
      const ids = Array.from(new Set([...(m.style._order || []), ...Object.keys(m.style._layers || {}), ...m.getStyle().layers.map(l => l.id)]));
      for (const id of ids) if (id !== 'slopes-mesh' && m.getLayoutProperty(id, 'visibility') !== 'none') { try { m.setLayoutProperty(id, 'visibility', 'none'); hidden++; } catch (e) {} }
      let removed = 0;
      for (const g of [...S.root.children]) if (g !== A.group && !g.getObjectById(A.group.id)) { S.root.remove(g); removed++; }
      return { hidden, removed, kept: S.root.children.map(c => c.name || c.type), visibleLayers: ids.filter(id => m.getLayoutProperty(id, 'visibility') !== 'none') };
    });
    console.log('isolate', JSON.stringify((({ visibleLayers, ...r }) => ({ ...r, visibleLayers }))(await isolate())));
    for (const p of POSES) {
      await page.evaluate(({ p }) => {
        const m = window.__map; if (m.isEasing && m.isEasing()) m.stop();
        m.jumpTo({ center: p.center, zoom: p.zoom, pitch: p.pitch, bearing: p.bearing });
        const sl = document.getElementById('tod-slider'); if (sl) sl.value = String(p.p);
        window.applyTimeOfDay(m, p.p);
        // the hour change re-sets MapLibre's own sky; put it back to the background colour
        try { m.setSky({ 'sky-color': '#ff00ff', 'horizon-color': '#ff00ff', 'fog-color': '#ff00ff', 'sky-horizon-blend': 0, 'horizon-fog-blend': 0, 'fog-ground-blend': 0, 'atmosphere-blend': 0 }); } catch (e) {}
      }, { p });
      await isolate();
      await page.waitForTimeout(2500);
      await page.evaluate(() => new Promise(r => { const m = window.__map; m.once('render', () => setTimeout(r, 50)); m.triggerRepaint(); }));
      await page.evaluate(() => new Promise(r => { const m = window.__map; m.once('render', () => setTimeout(r, 50)); m.triggerRepaint(); }));
      const cap = await page.evaluate((names) => {
        const S = window.slopes, A = window.slopesApartments, m = window.__map, G = window.__glc;
        let mat = null; A.group.traverse(o => { if (!mat && o.isMesh) mat = Array.isArray(o.material) ? o.material[0] : o.material; });
        const u = {};
        for (const n of names) { const v = mat.uniforms[n].value; u[n] = typeof v === 'number' ? v : (v && 'x' in v) ? ['x', 'y', 'z', 'w'].filter(c => c in v).map(c => v[c]) : (v && v.isColor) ? [v.r, v.g, v.b] : v; }
        const c = m.getCanvas();
        return { matrix: Array.from(S.camera.projectionMatrix.elements), u, cam: { center: m.getCenter().toArray(), zoom: m.getZoom(), pitch: m.getPitch(), bearing: m.getBearing(), fov: m.getVerticalFieldOfView ? m.getVerticalFieldOfView() : null }, aa: !!m.painter.context.gl.getContextAttributes().antialias, canvas: [c.width, c.height], css: [c.clientWidth, c.clientHeight], cull: (() => { const x = A.cull; return { drawnRanges: x.drawnRanges, ranges: x.ranges, drawnTriangles: Math.round(x.drawnTriangles), totalTriangles: Math.round(x.totalTriangles) }; })() };
      }, UNIFORMS);
      // GL calls for one steady frame of the isolated scene
      cap.gl = await page.evaluate(async () => {
        const G = window.__glc, m = window.__map; G.sets.programs.clear(); G.sets.targets.clear();
        const a = G.snap(); await new Promise(r => { m.once('render', () => setTimeout(r, 0)); m.triggerRepaint(); }); const b = G.snap();
        const o = {}; for (const cid of Object.keys(b)) for (const ph of Object.keys(b[cid])) { const d = {}; for (const k of Object.keys(b[cid][ph])) d[k] = +(b[cid][ph][k] - ((a[cid] && a[cid][ph] && a[cid][ph][k]) || 0)).toFixed(1); if (d.total) o[cid + '/' + ph] = d; }
        return { diff: o, programs: G.sets.programs.size, targets: G.sets.targets.size };
      });
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(APPDIR, `app-${p.name}.png`), clip: { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height } });
      frames.views[p.name] = cap;
      const t = cap.gl.diff; const k = Object.keys(t).find(x => x.endsWith('/three'));
      console.log(`${p.name.padEnd(18)} canvas ${cap.canvas} app draws ${k ? t[k].draw : 0} tris ${k ? Math.round(t[k].tris) : 0} glcalls ${k ? t[k].total : 0}  (cull ${cap.cull.drawnRanges}/${cap.cull.ranges} buildings)`);
    }
    // timing loop on the last pose: how long a repaint of the isolated scene takes (software: invalid)
    frames.bench = await page.evaluate(async () => {
      const m = window.__map, G = window.__glc, gl = m.painter.context.gl, px = new Uint8Array(4); G.threeMs = 0; const N = 30; G.mute = true; const t = performance.now();
      for (let i = 0; i < N; i++) { await new Promise(r => { m.once('render', () => r()); m.triggerRepaint(); }); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
      G.mute = false;
      return { frames: N, wallMsPerFrame: +((performance.now() - t) / N).toFixed(2), threeJsMsPerFrame: +(G.threeMs / N).toFixed(2) };
    });
    frames.errors = errors.slice(0, 8);
    fs.writeFileSync(path.join(PRIVATE, 'frames.json'), JSON.stringify(frames));
    console.log('bench (app)', JSON.stringify(frames.bench), SOFTWARE ? 'SOFTWARE: not valid for timing' : '');
  } finally { await browser.__done(); }
  return frames;
}

// ------------------------------------------------------------------ prototype side
async function shootProto(frames) {
  console.log('== prototype side (' + (BREAK || 'clean') + ') ==');
  const server = await startStatic(8498);
  const url = `http://127.0.0.1:8498/exp/proto/${MODE === 'maplibre' ? 'maplibre' : 'standalone'}.html?data=/data/apartments.packed${BREAK ? '&break=' + BREAK : ''}${FORMAT ? '&format=' + FORMAT : ''}`;
  const t0 = Date.now();
  const { browser, page, errors } = await openApp({ url, viewport: VIEWPORT });
  const out = { views: {}, software: SOFTWARE };
  try {
    await page.waitForFunction(() => window.__proto, null, { timeout: 60000 });
    const first = frames.views[POSES[0].name];
    const timeline = MODE === 'maplibre' ? await page.evaluate(([size, cam, fov, aa]) => window.__proto.init(size, cam, fov, aa), [first.canvas, first.cam, first.cam.fov, first.aa]) : await page.evaluate(([size, aa]) => window.__proto.init(size, aa), [first.canvas, first.aa]);
    out.initWallMs = Date.now() - t0;
    out.info = await page.evaluate(() => window.__proto.info);
    for (const p of POSES) {
      const f = frames.views[p.name];
      const st = await page.evaluate(f => window.__proto.drawFrame(f), { matrix: f.matrix, u: f.u, cam: f.cam });
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(DIR, `proto-${p.name}.png`), clip: { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height } });
      // one counted frame
      const gl = await page.evaluate(async f => { const G = window.__glc; const a = G.snap(); await window.__proto.drawFrame(f); const b = G.snap(); const o = {}; for (const cid of Object.keys(b)) for (const ph of Object.keys(b[cid])) { const d = {}; for (const k of Object.keys(b[cid][ph])) d[k] = +(b[cid][ph][k] - ((a[cid] && a[cid][ph] && a[cid][ph][k]) || 0)).toFixed(1); if (d.total) o[cid + '/' + ph] = d; } return o; }, { matrix: f.matrix, u: f.u, cam: f.cam });
      out.views[p.name] = { stats: st, gl };
      const k = Object.keys(gl)[0];
      console.log(`${p.name.padEnd(18)} proto draw calls ${st.draws} (multiDraw ${st.multiDraw}), tris ${Math.round(st.triangles)}, other GL calls ${gl[k] ? gl[k].total : 0}, buildings ${st.chunksDrawn}/${st.chunks}, cull ${st.cullMs.toFixed(2)} ms`);
    }
    out.timeline = await page.evaluate(() => window.__proto.timeline);
    // bench: 60 draws each followed by gl.finish()
    out.bench = MODE === 'maplibre' ? null : await page.evaluate(async (f) => {
      const N = 60, t = performance.now(); let sub = 0; const gl0 = document.getElementById('c').getContext('webgl2'), px = new Uint8Array(4);
      window.__glc.mute = true;
      for (let i = 0; i < N; i++) { const s = window.__proto.drawFrame(f); sub += s.submitMs; gl0.readPixels(0, 0, 1, 1, gl0.RGBA, gl0.UNSIGNED_BYTE, px); }
      window.__glc.mute = false;
      const gl = document.getElementById('c').getContext('webgl2'); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));   // readPixels, not finish: finish does not wait on every driver
      return { frames: N, wallMsPerFrame: +((performance.now() - t) / N).toFixed(2), cpuSubmitMsPerFrame: +(sub / N).toFixed(3) };
    }, { matrix: frames.views[POSES[POSES.length - 1].name].matrix, u: frames.views[POSES[POSES.length - 1].name].u });
    out.errors = errors.slice(0, 8);
    console.log('bench (prototype)', JSON.stringify(out.bench), SOFTWARE ? 'SOFTWARE: not valid for timing' : '');
    console.log('timeline (ms since navigation)', JSON.stringify(out.timeline));
  } finally { await browser.__done(); server.close(); }
  fs.writeFileSync(path.join(DIR, 'proto-run.json'), JSON.stringify(out, null, 1));
  return out;
}

// ------------------------------------------------------------------ the numbers
function score(frames) {
  const rows = [];
  for (const p of POSES) {
    const a = path.join(APPDIR, `app-${p.name}.png`), b = path.join(DIR, `proto-${p.name}.png`);
    if (!fs.existsSync(a) || !fs.existsSync(b)) { rows.push({ name: p.name, error: 'missing picture' }); continue; }
    const A = rgbOf(decodePNG(a)), B = rgbOf(decodePNG(b));
    const diffPath = path.join(DIR, `diff-${p.name}.png`);
    const r = compareImages(A, B, { saveTo: diffPath });
    sideBySide(A, B, diffPath, path.join(DIR, `side-${p.name}.png`));
    rows.push({ name: p.name, ...r });
  }
  const shows = rows.filter(r => r.showsBuildings);
  console.log(`\nview               shows  bldg%   over%(bldg)  over%(frame)  IoU     meanAbs  SSIM`);
  for (const r of rows) console.log(`${r.name.padEnd(18)} ${r.error ? r.error : `${r.showsBuildings ? 'yes  ' : 'no   '} ${String(r.buildingPctApp).padStart(6)}  ${String(r.pctOverOnBuildings).padStart(10)}  ${String(r.pctOverWholeFrame).padStart(11)}  ${String(r.silhouetteIoU).padStart(6)}  ${String(r.meanAbsDiffOnBuildings).padStart(7)}  ${r.ssim}`}`);
  const mean = k => shows.length ? +(shows.reduce((s, r) => s + r[k], 0) / shows.length).toFixed(4) : null;
  const summary = { views: rows.length, viewsWithBuildings: shows.length, meanPctOverOnBuildings: mean('pctOverOnBuildings'), meanSilhouetteIoU: mean('silhouetteIoU'), meanSSIM: mean('ssim'), meanAbsDiff: mean('meanAbsDiffOnBuildings') };
  console.log('\nsummary', JSON.stringify(summary));
  fs.writeFileSync(path.join(DIR, 'result.json'), JSON.stringify({ tag: TAG, break: BREAK || null, software: SOFTWARE, tolerance: 12, summary, rows }, null, 1));
  return { summary, rows };
}

let frames = null;
if (PHASE === 'all' || PHASE === 'app') frames = await shootApp();
if (PHASE === 'all' || PHASE === 'proto') { frames = frames || JSON.parse(fs.readFileSync(path.join(PRIVATE, 'frames.json'), 'utf8')); await shootProto(frames); }
if (PHASE === 'all' || PHASE === 'compare' || PHASE === 'proto') { frames = frames || JSON.parse(fs.readFileSync(path.join(PRIVATE, 'frames.json'), 'utf8')); score(frames); }
