/**
 * frozen-redraw.mjs - one page, nothing changing, drawn again and again: is it the same picture every time?
 *
 *   node frozen-redraw.mjs                  the two night cameras, 8 redraws each, every pair of frames compared
 *   node frozen-redraw.mjs --break          puts the defect back (the camera is nudged by a hundredth of a degree between two redraws);
 *                                           the check must exit 1 (red), which proves it can see a moving picture
 *   node frozen-redraw.mjs --explain        also records every uniform set and every draw made in each redraw and lists the ones that differ
 *   node frozen-redraw.mjs --arms           switches one part of the sky and the lights off at a time and counts again (bisecting)
 *
 * WHY. On 2026-10-10 a frozen night page (clock held, camera still, labels hidden) drew 5 to 8 different frames out of 8, by up to a few
 * hundred thousand pixels over 12/255, on main. Every picture check that reads the night (the CI before/after pictures, the night-eye
 * checks) reads that as change. This asserts the floor: a still page redraws identically.
 *
 * WHAT IT READS: the map's own canvas (toDataURL), not a screenshot: no page buttons, no CSS filter, no effects layer. The name
 * labels are hidden first (their collision placement follows tile arrival order: a separate system, see js/city-night.js on the
 * night-eye branch). The sky clock is held with ?skyfreeze=0 (js/sky.js), so star twinkle and cloud drift cannot move.
 *
 * Needs a graphics card for the clouds and the draw timing to be the app's own: a HAND-RUN check (ci/checks.json, quarantine), not in `run`.
 * Writes pictures and frozen-redraw.json to $VERIFY_OUT (default ./frozen-redraw-out). Exit 1 when two redraws differ.
 */
import { chromium } from 'playwright-core';
import { launch, BASE } from './chrome.mjs';
import { decodePNG } from './lib/png.mjs';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const BREAK = argv.includes('--break'), EXPLAIN = argv.includes('--explain'), ARMS = argv.includes('--arms');
const EXTRA = opt('--query', '').replace(/\+/g, '&');   // extra page switches, '+' for '&'
const OUT = path.resolve(process.env.VERIFY_OUT || opt('--out', 'frozen-redraw-out'));
fs.mkdirSync(OUT, { recursive: true });
// every number a claim rests on
export const TUNE = {
  redraws: Number(opt('--redraws', 8)),
  tolerance: 12,                 // a pixel moved if any channel moved more than this (the CI pictures use the same 12)
  poses: {                       // the two night pictures of ci/poses.json
    'spawn-night': { p: 0.90, center: [-97.7434, 30.2857], zoom: 16.5, pitch: 64, bearing: 90 },
    'tower-night': { p: 1.0, center: [-97.73932, 30.28601], zoom: 17.2, pitch: 66, bearing: 180 },
  },
};
const VIEWS = opt('--poses', 'spawn-night,tower-night').split(/[,+]/);

// Logs every uniform set and every draw, per program, per redraw (page side). A program is named by what is in its fragment shader.
const LOGGER = () => {
  const P = WebGL2RenderingContext.prototype, native = {};
  const wrap = (name, fn) => { native[name] = P[name]; P[name] = function (...a) { return fn.call(this, native[name].bind(this), ...a); }; };
  const srcOf = new WeakMap(), progOf = new WeakMap(), locOf = new WeakMap(), label = new WeakMap();
  let cur = null;
  window.__ul = { cur: {}, draws: {}, labels: {} };
  const h31 = (h, x) => (Math.imul(h, 31) + x) | 0;
  const num = v => { const f = new Float32Array([+v]); return new Int32Array(f.buffer)[0]; };
  const nameFor = src => {
    const t = [['u_pano', 'sky'], ['a_dm', 'stars'], ['u_cityTileToLocal', 'extrusion'], ['u_cityPoolLift', 'circle'], ['u_sunShadow', 'shadow-receiver'], ['gl_PointSize', 'points'], ['a_pos_offset', 'symbol'], ['u_image', 'raster/pattern']];
    for (const [k, n] of t) if (src.includes(k)) return n;
    return 'other';
  };
  wrap('shaderSource', (n, sh, src) => { srcOf.set(sh, src); return n(sh, src); });
  wrap('attachShader', (n, p, sh) => { (progOf.get(p) || progOf.set(p, []).get(p)).push(sh); return n(p, sh); });
  wrap('linkProgram', (n, p) => { const shs = progOf.get(p) || []; let all = ''; for (const s of shs) all += (srcOf.get(s) || ''); let h = 5381; for (let i = 0; i < all.length; i++) h = h31(h, all.charCodeAt(i)); label.set(p, `${nameFor(all)}#${(h >>> 0).toString(16).slice(0, 5)}`); return n(p); });
  wrap('getUniformLocation', (n, p, name) => { const l = n(p, name); if (l) locOf.set(l, { p, name }); return l; });
  wrap('useProgram', (n, p) => { cur = p; return n(p); });
  const rec = (loc, vals) => {
    const i = locOf.get(loc); if (!i) return; const key = `${label.get(i.p) || '?'}:${i.name}`;
    const rec = window.__ul.cur[key] || (window.__ul.cur[key] = { h: 5381, n: 0, last: null });
    for (const v of vals) rec.h = h31(rec.h, typeof v === 'boolean' ? +v : num(v)); rec.n++; rec.last = Array.from(vals).slice(0, 4).map(v => +(+v).toFixed(5));
  };
  for (const [name, k] of [['uniform1f', 1], ['uniform2f', 2], ['uniform3f', 3], ['uniform4f', 4], ['uniform1i', 1]]) wrap(name, (n, loc, ...a) => { rec(loc, a.slice(0, k)); return n(loc, ...a); });
  for (const name of ['uniform1fv', 'uniform2fv', 'uniform3fv', 'uniform4fv', 'uniformMatrix4fv']) wrap(name, (n, loc, ...a) => { const arr = name === 'uniformMatrix4fv' ? a[1] : a[0]; rec(loc, arr); return n(loc, ...a); });
  for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) wrap(name, (n, ...a) => { const k = label.get(cur) || '?'; window.__ul.draws[k] = (window.__ul.draws[k] || 0) + 1; return n(...a); });
  window.__ul.snap = () => { const o = { cur: window.__ul.cur, draws: window.__ul.draws }; window.__ul.cur = {}; window.__ul.draws = {}; return JSON.parse(JSON.stringify(o)); };
};

const browser = await launch(chromium, { maxMs: Number(process.env.VERIFY_MAX_MS) || 40 * 60 * 1000 });
const results = [], data = { when: new Date().toISOString(), tune: TUNE, views: {} };
const report = (name, ok, detail) => { results.push({ name, ok }); console.log(`${ok ? ' PASS' : '*FAIL'}  ${name}${detail ? '  ' + detail : ''}`); };

async function open(view) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  if (EXPLAIN) await page.addInitScript(LOGGER);
  page.on('pageerror', e => console.log('PAGEERROR', e.message.slice(0, 200)));
  await page.goto(`${BASE}/_harness.html?intro=0&drift=0&namelabels=0&facadepace=0&timeofdaypace=0&skyfreeze=0${EXTRA ? '&' + EXTRA : ''}`, { waitUntil: 'networkidle', timeout: 90000 });
  await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const m = window.__map; if (!m || !m.getSource('austin-buildings')) return false;
    return ['austin-buildings', 'austin-ground', 'austin-trees', 'austin-roofscape', 'austin-tower', 'austin-westcampus', 'austin-drag', 'austin-arts', 'austin-moody', 'austin-stadium'].every(s => !m.getSource(s) || m.isSourceLoaded(s));
  }, null, { timeout: 120000 }).catch(() => console.log('WARN: sources not all loaded'));
  await page.waitForTimeout(4000);
  await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
  const pose = TUNE.poses[view];
  await page.evaluate(s => {
    const m = window.__map; if (m.isEasing && m.isEasing()) m.stop();
    m.jumpTo({ center: s.center, zoom: s.zoom, pitch: s.pitch, bearing: s.bearing });
    const sl = document.getElementById('tod-slider'); if (sl) sl.value = String(s.p);
    window.applyTimeOfDay(m, s.p);
  }, pose);
  // labels: a separate system with its own timing (see the header); hidden so the canvas is the night city alone
  const hide = () => page.evaluate(() => { const m = window.__map; for (const l of m.getStyle().layers) if (l.type === 'symbol') m.setLayoutProperty(l.id, 'visibility', 'none'); });
  await hide(); await page.waitForTimeout(3000);
  await waitStill(page); await hide(); await waitStill(page);
  return page;
}
/** Two canvas grabs 3 s apart must be the same, three times running, with the cloud panorama up and the shadow pass built. */
async function waitStill(page, maxMs = 150000) {
  const t0 = Date.now(); let same = 0;
  while (Date.now() - t0 < maxMs && same < 3) {
    await redraw(page);
    const a = await page.evaluate(() => window.__map.getCanvas().toDataURL('image/png')); await page.waitForTimeout(3000);
    await redraw(page); const b = await page.evaluate(() => window.__map.getCanvas().toDataURL('image/png'));
    const ready = await page.evaluate(() => (!window.__skyGL || window.__skyGL.cloudsReady() || window.__skyGL.state() === 'failed') && !(window.CityLighting && window.CityLighting.stats && window.CityLighting.stats.shadowProxyBuilding) && !(window.__facadePace && window.__facadePace.busy) && !(window.slopesApartments && window.slopesApartments.count && !window.slopesApartments.count.done));
    same = ready && a === b ? same + 1 : 0;
  }
  return same >= 3;
}
const redraw = page => page.evaluate(() => new Promise(r => { window.__map.once('render', () => requestAnimationFrame(() => requestAnimationFrame(() => r()))); window.__map.triggerRepaint(); }));

const counted = (fa, fb, tol) => {
  const A = decodePNG(fa), B = decodePNG(fb); let n = 0, any = 0, max = 0;
  for (let i = 0; i < A.data.length; i += A.bpp) { const d = Math.max(Math.abs(A.data[i] - B.data[i]), Math.abs(A.data[i + 1] - B.data[i + 1]), Math.abs(A.data[i + 2] - B.data[i + 2])); if (d > tol) n++; if (d > 0) any++; if (d > max) max = d; }
  return { over: n, any, max };
};
/** Draw `count` times, keep each canvas; return the files and (with --explain) each redraw's uniform/draw log. */
async function draws(page, view, label, count) {
  const files = [], logs = [];
  for (let k = 0; k < count; k++) {
    if (EXPLAIN) await page.evaluate(() => window.__ul.snap());
    if (BREAK && k === Math.floor(count / 2)) await page.evaluate(() => { const m = window.__map; m.jumpTo({ bearing: m.getBearing() + 0.01 }); });
    await redraw(page); await page.waitForTimeout(250);
    if (EXPLAIN) logs.push(await page.evaluate(() => window.__ul.snap()));
    const u = await page.evaluate(() => window.__map.getCanvas().toDataURL('image/png'));
    const f = path.join(OUT, `${view}-${label}-${k}.png`); fs.writeFileSync(f, Buffer.from(u.split(',')[1], 'base64')); files.push(f);
  }
  return { files, logs };
}
const pairs = (files, tol) => { let worst = { over: 0, any: 0, max: 0 }, distinct = 0; const seen = []; for (let i = 0; i < files.length; i++) for (let j = i + 1; j < files.length; j++) { const c = counted(files[i], files[j], tol); if (c.over > worst.over) worst = { ...c, i, j }; if (c.any > worst.any) worst.any = c.any; if (c.max > worst.max) worst.max = c.max; } for (const f of files) { const b = fs.readFileSync(f); if (!seen.some(x => x.equals(b))) { seen.push(b); distinct++; } } return { worst, distinct }; };

for (const view of VIEWS) {
  const page = await open(view);
  const { files, logs } = await draws(page, view, 'base', TUNE.redraws);
  const r = pairs(files, TUNE.tolerance);
  data.views[view] = { base: r };
  console.log(`frozen-redraw ${view}: ${TUNE.redraws} redraws, ${r.distinct} different frames; the most any two differ: ${r.worst.over} pixels over ${TUNE.tolerance}/255 (${r.worst.any} by any amount, biggest ${r.worst.max})${r.worst.i != null ? ` between redraws ${r.worst.i} and ${r.worst.j}` : ''}`);
  report(`${view}: ${TUNE.redraws} redraws of a frozen page are the same picture (0 pixels over ${TUNE.tolerance}/255 between any two)`, r.worst.over === 0, `most ${r.worst.over}`);
  if (EXPLAIN) {
    // which uniforms and which draws were not the same in every redraw
    const keys = new Set(); logs.forEach(l => Object.keys(l.cur).forEach(k => keys.add(k)));
    const diffs = [...keys].filter(k => new Set(logs.map(l => l.cur[k] ? l.cur[k].h : 'none')).size > 1).map(k => ({ key: k, samples: logs.slice(0, 4).map(l => l.cur[k] ? l.cur[k].last : null) }));
    const dkeys = new Set(); logs.forEach(l => Object.keys(l.draws).forEach(k => dkeys.add(k)));
    const drawDiffs = [...dkeys].filter(k => new Set(logs.map(l => l.draws[k] || 0)).size > 1).map(k => ({ key: k, counts: logs.map(l => l.draws[k] || 0) }));
    data.views[view].uniformsThatDiffer = diffs; data.views[view].drawsThatDiffer = drawDiffs;
    console.log(`  uniforms that were not the same in every redraw: ${diffs.length}`); for (const d of diffs.slice(0, 40)) console.log(`    ${d.key}  ${JSON.stringify(d.samples)}`);
    console.log(`  draw counts that were not the same in every redraw: ${drawDiffs.length}`); for (const d of drawDiffs.slice(0, 20)) console.log(`    ${d.key}  ${d.counts.join(' ')}`);
  }
  if (ARMS) {
    // one part off at a time: does the picture now repeat?
    const arm = async (name, on, off) => { if (on) await page.evaluate(on); await page.waitForTimeout(800); await redraw(page); const f = await draws(page, view, name.replace(/[^a-z0-9]+/gi, '_'), 8); const x = pairs(f.files, TUNE.tolerance); data.views[view][name] = x; console.log(`  arm [${name}]: ${x.distinct} different frames, most ${x.worst.over} px over ${TUNE.tolerance}/255`); if (off) await page.evaluate(off); };
    await arm('atmosphere pass off', () => { window.SKY_GL_DEBUG.atmoGain = 0; window.__map.triggerRepaint(); }, () => { window.SKY_GL_DEBUG.atmoGain = 1; });
    await arm('cloud pass off', () => { window.SKY_GL_DEBUG.cloudGain = 0; window.__map.triggerRepaint(); }, () => { window.SKY_GL_DEBUG.cloudGain = 1; });
    await arm('sky compositor off', () => { window.SKY_COMP.on = false; window.__map.triggerRepaint(); }, () => { window.SKY_COMP.on = true; });
    await arm('stars off', () => { window.__starsWas = window.SKY_TUNE.CITY_STARS; window.SKY_TUNE.CITY_STARS = 0; window.__map.triggerRepaint(); }, () => { window.SKY_TUNE.CITY_STARS = window.__starsWas; });
    await arm('lamp circles faded', () => { const m = window.__map; window.__was = []; for (const l of m.getStyle().layers) if (/^night-streetlight|^props-lit|^signs-ground|^entrances-pool/.test(l.id)) { window.__was.push([l.id, m.getPaintProperty(l.id, 'circle-opacity')]); try { m.setPaintProperty(l.id, 'circle-opacity', 0); } catch (e) {} } }, () => { for (const [id, v] of window.__was) try { window.__map.setPaintProperty(id, 'circle-opacity', v === undefined ? null : v); } catch (e) {} });
    await arm('shadows and ao off', () => { window.GFX.shadows = false; window.GFX.ao = false; window.applyGraphics(); }, () => { window.GFX.shadows = true; window.GFX.ao = true; window.applyGraphics(); });
    await arm('bloom, rays, flare, exposure off', () => { Object.assign(window.GFX, { bloom: 0, godRays: 0, flare: 0, autoExposure: false }); window.applyGraphics(); }, null);
  }
  await page.close();
}
data.results = results;
fs.writeFileSync(path.join(OUT, 'frozen-redraw.json'), JSON.stringify(data, null, 1));
console.log('WROTE ' + path.join(OUT, 'frozen-redraw.json'));
await browser.close().catch(() => {});
const failed = results.some(r => !r.ok);
// with --break this is the red run that shows the check can see a moving picture (exit 1)
process.exit(failed ? 1 : 0);
