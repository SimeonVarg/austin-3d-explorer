/**
 * outer-homes.mjs - are the outer city's houses drawn, and drawn as houses?
 *
 * js/outer-homes.js draws every building the outer ring's area cull left out,
 * from data/outer_homes.bin, as instanced rectangles with roofs inside the
 * js/slopes.js scene. Nothing else in the suite looks at them, and the ways
 * they can fail are all silent: a missing file, a browser with no
 * DecompressionStream, a changed slopes shader (the module then refuses to
 * draw), an instance buffer that uploads but lands every house on one point.
 * This loads the city ONCE and switches the houses on and off inside the page.
 *
 * Usage:
 *   node outer-homes.mjs                       assertions only
 *   node outer-homes.mjs --out DIR             + labelled before/after frames
 *   node outer-homes.mjs --out DIR --poses F   your own cameras
 *   node outer-homes.mjs --query a=1&b=2       extra page flags
 *   node outer-homes.mjs --perf                frame time, houses off and on, six interleaved
 *                                              reps at four cameras (hardware GL, quiet machine)
 *
 * Runs on SwiftShader by default (nothing here is a timing or exact-hex
 * assertion). For pictures worth looking at use VERIFY_GL=hardware.
 * Scratch frames go to a scratch folder, not the repo (CLAUDE.md rule 12).
 */
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';

const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const OUT = arg('--out') ? path.resolve(arg('--out')) : null;
// Made-up cameras over named neighbourhoods. None is a photograph's camera.
const POSES = arg('--poses') ? JSON.parse(fs.readFileSync(arg('--poses'), 'utf8')) : [
  { name: 'hyde-park-air', center: [-97.7290, 30.3060], zoom: 16.2, pitch: 55, bearing: 20, p: 0.25 },
  { name: 'tarrytown-air', center: [-97.7760, 30.2990], zoom: 16.0, pitch: 60, bearing: 300, p: 0.25 },
  { name: 'east-austin-air', center: [-97.7150, 30.2700], zoom: 16.2, pitch: 58, bearing: 110, p: 0.25 },
  { name: 'bouldin-air', center: [-97.7600, 30.2500], zoom: 16.2, pitch: 58, bearing: 200, p: 0.25 },
  { name: 'travis-heights-top', center: [-97.7400, 30.2470], zoom: 16.6, pitch: 20, bearing: 0, p: 0.25 },
  { name: 'hyde-park-low', center: [-97.7288, 30.3052], zoom: 18.2, pitch: 76, bearing: 350, p: 0.25 },
  { name: 'campus-to-north', center: [-97.7370, 30.2930], zoom: 15.2, pitch: 68, bearing: 5, p: 0.25 },
  { name: 'east-austin-golden', center: [-97.7150, 30.2700], zoom: 16.2, pitch: 58, bearing: 110, p: 0.5 },
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
page.on('console', m => { const t = m.text(); if (/Shader Error|VALIDATE_STATUS|\[outer-homes\]/.test(t) && m.type() !== 'log') shaderErrors.push(t.slice(0, 400)); });
// The flight controls move the camera after jumpTo; the poses must hold.
await page.route('**/js/controls.js*', r => r.fulfill({ contentType: 'application/javascript', body: 'function initControls(){return function(){};}' }));
await page.addInitScript(() => {
  const t = setInterval(() => { if (window.cancelGraphicsAutoDetect) { window.cancelGraphicsAutoDetect(); clearInterval(t); } }, 20);
  setTimeout(() => clearInterval(t), 30000);
});
await page.goto(BASE + '/?intro=0&drift=0&namelabels=0&facadepace=0&timeofdaypace=0' + (arg('--query') ? '&' + arg('--query') : ''), { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 300000 });
await page.waitForFunction(() => window.outerHomes && window.outerHomes.stats().done, null, { timeout: 600000, polling: 500 });
await page.waitForFunction(() => !document.getElementById('veil'), null, { timeout: 600000, polling: 500 }).catch(() => log('WARN: veil still up'));
const st = await page.evaluate(() => ({ ...window.outerHomes.stats(), renderer: (() => { try { const g = document.createElement('canvas').getContext('webgl'); return g.getParameter(g.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL); } catch (e) { return '?'; } })() }));
log('loaded', JSON.stringify(st));

check(!st.error, 'the file loaded and decoded', st.error || st.bytes + ' bytes');
check(st.rects > 20000 && st.houses > 15000, 'tens of thousands of houses, not a handful', st.houses + ' buildings, ' + st.rects + ' rectangles');
check(st.group && st.chunks > 20 && st.chunks < 400, 'one draw call per chunk, a few dozen to a few hundred', st.chunks);
check(st.rects <= st.houses * 3 + 8 * 2000, 'no building exploded into rectangles');

const pose = async (s) => {
  await page.evaluate((s) => {
    const m = window.__map;
    if (m.isEasing && m.isEasing()) m.stop();
    m.jumpTo({ center: s.center, zoom: s.zoom, pitch: s.pitch, bearing: s.bearing });
    if (typeof s.p === 'number') { const sl = document.getElementById('tod-slider'); if (sl) sl.value = String(s.p); window.applyTimeOfDay(m, s.p); }
  }, s);
  await page.waitForTimeout(2500);
  await page.evaluate(() => new Promise(r => { const m = window.__map; if (m.loaded()) return r(); m.once('idle', () => r()); setTimeout(() => r(), 30000); }));
  await page.evaluate(() => window.__map.triggerRepaint());
  await page.waitForTimeout(1200);
};
const setHomes = on => page.evaluate(async (on) => {
  window.OUTER_HOMES.on = on; window.applyOuterHomes(window.__map); window.__map.triggerRepaint();
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
}, on);
const shot = async (file) => { await page.screenshot({ path: file, timeout: 180000 }); await page.waitForTimeout(600); await page.screenshot({ path: file, timeout: 180000 }); };
const grab = () => page.evaluate(() => new Promise(r => {
  // read the map canvas inside a render callback (the buffer is not preserved)
  const m = window.__map;
  m.once('render', () => {
    const c = m.getCanvas(), gl = c.getContext('webgl2') || c.getContext('webgl');
    const w = c.width, h = c.height, step = 8, out = [];
    const px = new Uint8Array(4);
    for (let y = step; y < h; y += step) for (let x = step; x < w; x += step) { gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); out.push(px[0], px[1], px[2]); }
    r(out);
  });
  m.triggerRepaint();
}));

// 1. houses change the picture over a neighbourhood, and only there
await pose({ center: [-97.7290, 30.3060], zoom: 16.4, pitch: 30, bearing: 0, p: 0.25 });
const drawnOn = await page.evaluate(() => window.outerHomes.stats().drawn);
const A = await grab();
await setHomes(false);
const B = await grab();
await setHomes(true);
const C = await grab();
const diff = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 3) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 30) n++; return n / (a.length / 3); };
const dOnOff = diff(A, B), dOnOn = diff(A, C);
check(drawnOn > 20000, 'every house is in a draw at full density', drawnOn);
check(dOnOff > 0.08, 'over Hyde Park the houses change at least 8 % of the frame', (dOnOff * 100).toFixed(1) + ' %');
check(dOnOn < 0.02, 'switching them back on gives the same frame', (dOnOn * 100).toFixed(2) + ' %');

// 2. they are not all on one point: two far-apart places both change
await pose({ center: [-97.7600, 30.2500], zoom: 16.4, pitch: 30, bearing: 0, p: 0.25 });
const D = await grab(); await setHomes(false); const E = await grab(); await setHomes(true);
check(diff(D, E) > 0.08, 'and over Bouldin Creek, 7 km away, as well', (diff(D, E) * 100).toFixed(1) + ' %');

// 3. the knobs
const dens = await page.evaluate(() => { window.OUTER_HOMES.density = 0.4; window.applyOuterHomes(window.__map); const d = window.outerHomes.stats().drawn; window.OUTER_HOMES.density = null; window.applyOuterHomes(window.__map); return d; });
check(dens > 0.3 * st.rects && dens < 0.5 * st.rects, 'density 0.4 draws about 40 % of them', dens + ' of ' + st.rects);
const layers = await page.evaluate(() => { const g = window.outerHomes.group; return { mask: g.children[0].layers.mask, cam: window.slopes.camera.layers.mask, minzoom: g.userData.minzoom }; });
check(layers.mask === 2 && (layers.cam & 2) === 2, 'houses sit on a layer the sun-shadow cameras do not draw', JSON.stringify(layers));
const walk = await page.evaluate(async () => {
  const m = window.__map; m.jumpTo({ center: [-97.7288, 30.3052], zoom: 19, pitch: 86, bearing: 0 });
  await new Promise(r => setTimeout(r, 400));
  window.applyOuterHomes(m);
  return window.outerHomes.stats().drawn;
});
check(walk > 50 && walk < 0.25 * st.rects, 'at walking height only the houses near the camera are drawn', walk);
const off = await page.evaluate(() => { window.SLOPES.on = false; const g = !!window.outerHomes.group; window.SLOPES.on = true; return { whileOff: g, back: !!window.outerHomes.group }; });
check(!off.whileOff && off.back, 'they follow the slopes switch off and back on', JSON.stringify(off));
check(shaderErrors.length === 0, 'no shader or module error was logged', shaderErrors.slice(0, 2).join(' | '));
check(errors.length === 0, 'no page error', errors.slice(0, 2).join(' | '));

// 3b. frame time, houses off and on, interleaved (--perf; hardware GL on a quiet machine or it means nothing)
if (process.argv.includes('--perf')) {
  const frames = n => page.evaluate(n => new Promise(res => {
    const m = window.__map, gl = m.getCanvas().getContext('webgl2'), px = new Uint8Array(4), ts = [];
    let last = null, k = 0;
    const on = () => {
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);       // returns only when the frame's draws have run
      const t = performance.now();
      if (last != null) ts.push(t - last);
      last = t;
      if (++k > n) { m.off('render', on); ts.sort((a, b) => a - b); res(+ts[ts.length >> 1].toFixed(1)); } else m.triggerRepaint();
    };
    m.on('render', on); m.triggerRepaint();
  }), n);
  const perf = {};
  for (const s of POSES.filter(s => /hyde-park-air|campus-to-north|hyde-park-low/.test(s.name)).concat([{ name: 'spawn-like', center: [-97.7445, 30.2880], zoom: 16.5, pitch: 70, bearing: 250, p: 0.25 }])) {
    await pose(s);
    const off = [], on = [];
    for (let rep = 0; rep < 6; rep++) {
      await setHomes(false); await frames(8); off.push(await frames(24));
      await setHomes(true); await frames(8); on.push(await frames(24));
    }
    const drawn = await page.evaluate(() => { let c = 0, t = 0; for (const m of window.outerHomes.group.children) if (m.visible) { c++; t += m.geometry.instanceCount; } return { chunks: c, instances: t }; });
    perf[s.name] = { off, on, minOff: Math.min(...off), minOn: Math.min(...on), deltas: on.map((v, i) => +(v - off[i]).toFixed(1)), drawn };
    log('PERF', s.name, 'median frame ms, 6 interleaved reps  off', off.join(' '), ' on', on.join(' '), ' min', perf[s.name].minOff, '->', perf[s.name].minOn, JSON.stringify(drawn));
  }
  await setHomes(true);
  if (OUT) fs.writeFileSync(path.join(OUT, 'outer-homes-perf.json'), JSON.stringify({ renderer: st.renderer, viewport: [1440, 900], perf }, null, 1));
}

// 4. pictures
if (OUT && !process.argv.includes('--no-shots')) {
  const frames = {};
  for (const s of POSES) {
    await pose(s);
    await setHomes(false); await page.waitForTimeout(500); await shot(path.join(OUT, `before-${s.name}.png`));
    await setHomes(true); await page.waitForTimeout(500); await shot(path.join(OUT, `after-${s.name}.png`));
    frames[s.name] = { pose: s, drawn: await page.evaluate(() => window.outerHomes.stats().drawn) };
    log('WROTE', s.name);
  }
  fs.writeFileSync(path.join(OUT, 'outer-homes.json'), JSON.stringify({ stats: st, renderer: st.renderer, frames, failed }, null, 1));
}
await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
