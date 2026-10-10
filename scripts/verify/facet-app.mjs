/**
 * facet-app.mjs - the app with ?facadeshader=0 against ?facadeshader=1 (js/facet-walls.js), from public cameras, day and night.
 *
 *   node facet-app.mjs --out DIR [--views spawn,west-campus,drag-street] [--smoke] [--no-night]
 *   (run through the AWS runner or the laptop lane; software GL is fine for pictures, hardware for nothing here: no timing is taken)
 *
 * For each flag value it loads the real page, waits for the authored apartments, records what the page holds (triangles built, GL buffer and
 * texture bytes, the JavaScript downloaded) and photographs each camera at a day and a night hour. Then it scores every pair: the share of pixels
 * that moved more than 12/255, the mean absolute colour difference, and writes off | on | moved-pixels side by side. --smoke loads the flag-on page
 * only and reports console errors (a shader that does not compile says so here).
 * Not a gate: it measures. Exit 1 only when the page could not be loaded.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium, launch, BASE as DEFAULT_BASE } from '../../experiments/renderer/lib/app.mjs';
import { openApp, waitReady } from '../../experiments/renderer/lib/app.mjs';
import { decodePNG, encodePNG, rgbOf } from '../../experiments/renderer/lib/images.mjs';
const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; }, flag = k => argv.includes(k);
const OUT = path.resolve(opt('--out', process.env.VERIFY_OUT || 'facet-app-out')); fs.mkdirSync(OUT, { recursive: true });
const BASE = process.env.VERIFY_URL || DEFAULT_BASE;
const CAMERAS = {
  'spawn': { center: [-97.7434, 30.2857], zoom: 16.5, pitch: 64, bearing: 90 },
  'west-campus': { center: [-97.7433, 30.2827], zoom: 15.9, pitch: 68, bearing: 0 },
  'drag-street': { center: [-97.7418, 30.2868], zoom: 16.75, pitch: 73, bearing: 356 },
  'tower': { center: [-97.73932, 30.28601], zoom: 17.2, pitch: 66, bearing: 180 },
};
const VIEWS = opt('--views', 'spawn,west-campus,drag-street').split(',');
const HOURS = flag('--no-night') ? { day: 0.12 } : { day: 0.12, night: 0.90 };
const FLAGS = flag('--smoke') ? [1] : [0, 1];
const QUERY = 'namelabels=0&facadepace=0&timeofdaypace=0';
const result = { when: new Date().toISOString(), base: BASE, flags: {}, pairs: [] };
const shots = {};

for (const f of FLAGS) {
  console.log(`\n=== facadeshader=${f}`);
  const { browser, page, errors, t0 } = await openApp({ url: `${BASE}/_harness.html?intro=0&drift=0&${QUERY}&facadeshader=${f}`, viewport: { width: 1440, height: 900 } });
  const info = { errors: [] };
  try {
    const ms = await waitReady(page, t0, { timeoutMs: 30 * 60 * 1000 });
    info.readyMs = ms.apartmentsDone ?? ms.last;
    await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
    info.page = await page.evaluate(() => {
      const A = window.slopesApartments, G = window.__glc, res = performance.getEntriesByType('resource');
      const js = res.filter(r => /\.js(\?|$)/.test(r.name)), all = res;
      return { triangles: A.count.triangles, buildings: A.count.buildings, cells: A.count.cells, windows: A.count.windows, facetStats: A.facetStats || null,
        jsFiles: js.length, jsBytes: js.reduce((s, r) => s + (r.encodedBodySize || r.transferSize || 0), 0), allBytes: all.reduce((s, r) => s + (r.encodedBodySize || r.transferSize || 0), 0),
        facetFile: res.filter(r => /facet-walls\.js/.test(r.name)).map(r => ({ url: r.name.split('/').pop(), bytes: r.encodedBodySize })),
        glLive: G ? JSON.parse(JSON.stringify(G.live)) : null, meshes: (() => { const o = []; window.slopesApartments.group && window.slopesApartments.group.traverse(m => { if (m.isMesh) o.push({ name: m.name, tris: m.geometry.index ? m.geometry.index.count / 3 : 0, bytes: Object.values(m.geometry.attributes).reduce((s, a) => s + a.array.byteLength, 0) + (m.geometry.index ? m.geometry.index.array.byteLength : 0) }); }); return o; })() };
    });
    console.log(JSON.stringify(info.page));
    if (flag('--smoke')) { info.errors = errors.slice(0, 20); result.flags[f] = info; await browser.__done(); continue; }
    for (const view of VIEWS) for (const [hn, p] of Object.entries(HOURS)) {
      const cam = CAMERAS[view];
      await page.evaluate(async ([cam, p]) => {
        const m = window.__map; if (m.isEasing && m.isEasing()) m.stop();
        m.jumpTo({ center: cam.center, zoom: cam.zoom, pitch: cam.pitch, bearing: cam.bearing });
        const sl = document.getElementById('tod-slider'); if (sl) sl.value = String(p);
        window.applyTimeOfDay(m, p);
      }, [cam, p]);
      await page.waitForTimeout(4000);
      await page.evaluate(() => new Promise(r => { const m = window.__map; if (m.loaded()) return r(); m.once('idle', () => r()); setTimeout(() => r(), 15000); }));
      for (let k = 0; k < 40; k++) { const busy = await page.evaluate(() => !!(window.CityLighting && window.CityLighting.stats && window.CityLighting.stats.shadowProxyBuilding) || !!(window.__facadePace && window.__facadePace.busy)); if (!busy) break; await page.waitForTimeout(1500); }
      await page.waitForTimeout(1500);
      const file = path.join(OUT, `${view}-${hn}-flag${f}.png`);
      await page.screenshot({ path: file, clip: { x: 0, y: 0, width: 1440, height: 900 } });
      (shots[`${view}-${hn}`] ||= {})[f] = file; console.log('shot', path.basename(file));
    }
    info.after = await page.evaluate(() => { const G = window.__glc, A = window.slopesApartments; return { glLive: G ? JSON.parse(JSON.stringify(G.live)) : null, programs: G ? G.sets.programs.size : null, triangles: A.count.triangles }; });
    console.log('after the shots: ' + JSON.stringify(info.after));
    info.errors = errors.slice(0, 20);
  } catch (e) { info.fatal = String(e); console.log('FAILED', e); }
  result.flags[f] = info; await browser.__done();
}
// scoring
for (const [name, pair] of Object.entries(shots)) {
  if (!pair[0] || !pair[1]) continue;
  const A = rgbOf(decodePNG(pair[0])), B = rgbOf(decodePNG(pair[1])), n = A.width * A.height;
  let moved = 0, sum = 0; const diff = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) { let d = 0, a = 0; for (let c = 0; c < 3; c++) { const x = Math.abs(A.rgb[i * 3 + c] - B.rgb[i * 3 + c]); d = Math.max(d, x); a += x; } sum += a / 3; if (d > 12) { moved++; diff[i * 3] = 255; diff[i * 3 + 2] = 255; } else for (let c = 0; c < 3; c++) diff[i * 3 + c] = Math.round(B.rgb[i * 3 + c] * 0.25); }
  const W = A.width, H = A.height, side = new Uint8Array(W * 3 * H * 3);
  for (let y = 0; y < H; y++) { side.set(A.rgb.subarray(y * W * 3, (y + 1) * W * 3), y * W * 9); side.set(B.rgb.subarray(y * W * 3, (y + 1) * W * 3), y * W * 9 + W * 3); side.set(diff.subarray(y * W * 3, (y + 1) * W * 3), y * W * 9 + W * 6); }
  fs.writeFileSync(path.join(OUT, `${name}-compare.png`), encodePNG(W * 3, H, side));
  result.pairs.push({ name, movedPct: +(100 * moved / n).toFixed(3), meanAbsDiff: +(sum / n).toFixed(3) });
  console.log(`${name.padEnd(22)} pixels moved ${(100 * moved / n).toFixed(2)}%  mean |diff| ${(sum / n).toFixed(2)}`);
}
fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(result, null, 1));
const bad = Object.values(result.flags).some(x => x.fatal);
console.log('errors flag1:', JSON.stringify((result.flags[1] || {}).errors || []).slice(0, 1500));
process.exit(bad ? 1 : 0);
