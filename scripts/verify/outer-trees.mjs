/**
 * outer-trees.mjs - is the outer city's tree cover drawn, where the scan says it is?
 *
 * js/outer-trees.js plants one tree per marked 10 m cell of data/outer_trees.bin
 * as instanced meshes inside the js/slopes.js scene, a near template and a far
 * one per chunk. It can fail silently in every way js/outer-homes.js can (a
 * missing file, a changed shader, every tree on one point) and one more: both
 * templates of a chunk drawn at once, or neither.
 *
 * Usage:
 *   node outer-trees.mjs                 assertions only
 *   node outer-trees.mjs --out DIR       + before/after frames from made-up cameras
 *   node outer-trees.mjs --perf          frame time, trees off and on, six interleaved reps
 */
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';

const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const OUT = arg('--out') ? path.resolve(arg('--out')) : null;
// Made-up cameras over named neighbourhoods. None is a photograph's camera.
const POSES = [
  { name: 'tarrytown-air', center: [-97.7760, 30.2990], zoom: 16.0, pitch: 60, bearing: 300, p: 0.25 },
  { name: 'hyde-park-air', center: [-97.7290, 30.3060], zoom: 16.2, pitch: 55, bearing: 20, p: 0.25 },
  { name: 'hyde-park-low', center: [-97.7288, 30.3052], zoom: 18.2, pitch: 76, bearing: 350, p: 0.25 },
  { name: 'travis-heights-air', center: [-97.7400, 30.2470], zoom: 16.0, pitch: 58, bearing: 160, p: 0.25 },
  { name: 'east-austin-air', center: [-97.7150, 30.2700], zoom: 16.2, pitch: 58, bearing: 110, p: 0.25 },
  { name: 'campus-to-north', center: [-97.7370, 30.2930], zoom: 15.2, pitch: 68, bearing: 5, p: 0.25 },
  { name: 'tarrytown-golden', center: [-97.7760, 30.2990], zoom: 16.0, pitch: 60, bearing: 300, p: 0.5 },
  { name: 'tarrytown-night', center: [-97.7760, 30.2990], zoom: 16.0, pitch: 60, bearing: 300, p: 0.9 },
];
if (OUT) fs.mkdirSync(OUT, { recursive: true });
const t0 = Date.now();
const log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(0).padStart(4) + ' s', ...a);
let failed = 0;
const check = (ok, what, detail) => { if (!ok) failed++; console.log((ok ? '  PASS  ' : '  FAIL  ') + what + (detail !== undefined ? '  [' + detail + ']' : '')); };

const browser = await launch(chromium, { maxMs: 1500000 });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [], shaderErrors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { const t = m.text(); if (/Shader Error|VALIDATE_STATUS|\[outer-trees\]/.test(t) && m.type() !== 'log') shaderErrors.push(t.slice(0, 400)); });
await page.route('**/js/controls.js*', r => r.fulfill({ contentType: 'application/javascript', body: 'function initControls(){return function(){};}' }));
await page.addInitScript(() => {
  const t = setInterval(() => { if (window.cancelGraphicsAutoDetect) { window.cancelGraphicsAutoDetect(); clearInterval(t); } }, 20);
  setTimeout(() => clearInterval(t), 30000);
});
await page.goto(BASE + '/?intro=0&drift=0&namelabels=0&facadepace=0&timeofdaypace=0', { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 300000 });
await page.waitForFunction(() => window.outerTrees && window.outerTrees.stats().done, null, { timeout: 600000, polling: 500 });
await page.waitForFunction(() => !document.getElementById('veil'), null, { timeout: 600000, polling: 500 }).catch(() => log('WARN: veil still up'));
// the Detail distance slider must not hide the tier the trees are in while they are being looked at
await page.evaluate(() => { if (window.GFX) window.GFX.renderDistance = 1500; if (window.applyLOD) window.applyLOD(window.__map); });
const st = await page.evaluate(() => window.outerTrees.stats());
log('loaded', JSON.stringify(st));
check(!st.error, 'the file loaded and decoded', st.error || st.bytes + ' bytes');
check(st.trees > 100000 && st.trees < 400000, 'a city of trees, not a park of them', st.trees);
check(st.group && st.chunks > 20 && st.chunks < 400, 'a few dozen to a few hundred chunks', st.chunks);

const pose = async (s) => {
  await page.evaluate((s) => {
    const m = window.__map;
    if (m.isEasing && m.isEasing()) m.stop();
    m.jumpTo({ center: s.center, zoom: s.zoom, pitch: s.pitch, bearing: s.bearing });
    if (typeof s.p === 'number') { const sl = document.getElementById('tod-slider'); if (sl) sl.value = String(s.p); window.applyTimeOfDay(m, s.p); }
  }, s);
  await page.waitForTimeout(2500);
  await page.evaluate(() => new Promise(r => { const m = window.__map; if (m.loaded()) return r(); m.once('idle', () => r()); setTimeout(() => r(), 30000); }));
  await page.evaluate(() => { window.applyOuterTrees(window.__map); window.__map.triggerRepaint(); });
  await page.waitForTimeout(1200);
};
const setTrees = on => page.evaluate(async (on) => {
  window.OUTER_TREES.on = on; window.applyOuterTrees(window.__map); window.__map.triggerRepaint();
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
}, on);
const shot = async (file) => { await page.screenshot({ path: file, timeout: 180000 }); await page.waitForTimeout(600); await page.screenshot({ path: file, timeout: 180000 }); };
const grab = () => page.evaluate(() => new Promise(r => {
  const m = window.__map;
  m.once('render', () => {
    const c = m.getCanvas(), gl = c.getContext('webgl2') || c.getContext('webgl');
    const out = [], px = new Uint8Array(4);
    for (let y = 8; y < c.height; y += 8) for (let x = 8; x < c.width; x += 8) { gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); out.push(px[0], px[1], px[2]); }
    r(out);
  });
  m.triggerRepaint();
}));
const diff = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 3) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 30) n++; return n / (a.length / 3); };
const greener = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 3) if ((a[i + 1] - a[i]) - (b[i + 1] - b[i]) > 12) n++; return n / (a.length / 3); };

// 1. over Tarrytown (half canopy in the scan) the trees turn a large share of the frame green, near template
await pose({ center: [-97.7760, 30.2990], zoom: 16.6, pitch: 35, bearing: 0, p: 0.25 });
const s1 = await page.evaluate(() => window.outerTrees.stats());
const A = await grab(); await setTrees(false); const B = await grab(); await setTrees(true); const C = await grab();
check(s1.near > 0, 'close to the ground the near template draws', 'near ' + s1.near + ', far ' + s1.far);
check(greener(A, B) > 0.15, 'over Tarrytown at least 15 % of the frame turns green', (greener(A, B) * 100).toFixed(1) + ' %');
check(diff(A, C) < 0.02, 'switching them back on gives the same frame', (diff(A, C) * 100).toFixed(2) + ' %');
// 2. far template from high up, and never both templates of a chunk
await pose({ center: [-97.7760, 30.2990], zoom: 14.4, pitch: 50, bearing: 0, p: 0.25 });
const s2 = await page.evaluate(() => { const g = window.outerTrees.group; let both = 0, tris = 0; for (const m of g.children) { if (m.userData.which === 'near' && m.visible && m.userData.twin.visible) both++; } return { ...window.outerTrees.stats(), both, hidden: window.LOD_isHidden ? window.LOD_isHidden('slopes-mesh') : null, groupVisible: g.visible }; });
check(s2.far > 0 && s2.both === 0, 'from high up the far template draws, and no chunk draws both', JSON.stringify({ near: s2.near, far: s2.far, both: s2.both, groupVisible: s2.groupVisible }));
// 3. somewhere else entirely
await pose({ center: [-97.7400, 30.2470], zoom: 16.6, pitch: 35, bearing: 0, p: 0.25 });
const D = await grab(); await setTrees(false); const E = await grab(); await setTrees(true);
check(greener(D, E) > 0.10, 'and over Travis Heights, 7 km away, as well', (greener(D, E) * 100).toFixed(1) + ' %');
// 4. none where another lane owns the trees
const core = await page.evaluate(() => {
  const d = window.outerTrees.data, lv = window.outerTrees.level; let n = 0;
  for (let r = 0; r < d.rows; r++) for (let c = 0; c < d.cols; c++) {
    if (!lv(d, r * d.cols + c)) continue;
    const lon = d.k[0] + d.k[1] * (c + 0.5) + d.k[2] * (r + 0.5), lat = d.k[3] + d.k[4] * (c + 0.5) + d.k[5] * (r + 0.5);
    if (lon > -97.7515 && lon < -97.7265 && lat > 30.2715 && lat < 30.2955) n++;
  }
  return n;
});
check(core === 0, 'no tree of this layer inside the campus core or the Capitol strip', core);
const dens = await page.evaluate(() => { window.OUTER_TREES.density = 0.5; window.applyOuterTrees(window.__map); const a = window.outerTrees.stats().drawn; window.OUTER_TREES.density = 1; window.applyOuterTrees(window.__map); const b = window.outerTrees.stats().drawn; window.OUTER_TREES.density = null; window.applyOuterTrees(window.__map); return [a, b]; });
check(dens[0] > 0.4 * dens[1] && dens[0] < 0.6 * dens[1], 'density 0.5 draws about half', dens.join(' of '));
check(shaderErrors.length === 0, 'no shader or module error was logged', shaderErrors.slice(0, 2).join(' | '));
check(errors.length === 0, 'no page error', errors.slice(0, 2).join(' | '));

if (process.argv.includes('--perf')) {
  const frames = n => page.evaluate(n => new Promise(res => {
    const m = window.__map, gl = m.getCanvas().getContext('webgl2'), px = new Uint8Array(4), ts = [];
    let last = null, k = 0;
    const on = () => {
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const t = performance.now();
      if (last != null) ts.push(t - last);
      last = t;
      if (++k > n) { m.off('render', on); ts.sort((a, b) => a - b); res(+ts[ts.length >> 1].toFixed(1)); } else m.triggerRepaint();
    };
    m.on('render', on); m.triggerRepaint();
  }), n);
  const perf = {};
  for (const s of POSES.filter(s => /tarrytown-air|hyde-park-low|campus-to-north/.test(s.name)).concat([{ name: 'spawn-like', center: [-97.7445, 30.2880], zoom: 16.5, pitch: 70, bearing: 250, p: 0.25 }])) {
    await pose(s);
    const off = [], on = [];
    for (let rep = 0; rep < 6; rep++) {
      await setTrees(false); await frames(8); off.push(await frames(24));
      await setTrees(true); await frames(8); on.push(await frames(24));
    }
    const stp = await page.evaluate(() => window.outerTrees.stats());
    perf[s.name] = { off, on, minOff: Math.min(...off), minOn: Math.min(...on), near: stp.near, far: stp.far, drawn: stp.drawn };
    log('PERF', s.name, 'median frame ms, 6 interleaved reps  off', off.join(' '), ' on', on.join(' '), ' min', perf[s.name].minOff, '->', perf[s.name].minOn, 'near', stp.near, 'far', stp.far, 'trees', stp.drawn);
  }
  await setTrees(true);
  if (OUT) fs.writeFileSync(path.join(OUT, 'outer-trees-perf.json'), JSON.stringify({ viewport: [1440, 900], perf }, null, 1));
}

if (OUT && !process.argv.includes('--no-shots')) {
  for (const s of POSES) {
    await pose(s);
    await setTrees(false); await page.waitForTimeout(500); await shot(path.join(OUT, `before-${s.name}.png`));
    await setTrees(true); await page.waitForTimeout(500); await shot(path.join(OUT, `after-${s.name}.png`));
    log('WROTE', s.name);
  }
}
await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
