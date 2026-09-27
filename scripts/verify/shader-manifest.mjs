/**
 * shader-manifest.mjs — record, or check, the shader programs js/shader-prewarm.js replays.
 *
 *   VERIFY_URL=http://127.0.0.1:8442 node shader-manifest.mjs            CHECK (default)
 *   VERIFY_URL=http://127.0.0.1:8442 node shader-manifest.mjs --write    RE-RECORD data/shader-manifest.json
 *   VERIFY_URL=http://127.0.0.1:8442 node shader-manifest.mjs --merge    ADD what this run linked and the manifest lacks
 *
 * WHY. js/shader-prewarm.js compiles every program in data/shader-manifest.json
 * the moment the map's GL context exists, so the GPU process's program cache
 * already holds them when MapLibre, three.js and js/city-lighting.js link the
 * same source later (js/shader-prewarm.js header has the numbers). The cache is
 * keyed by the EXACT source text, so the manifest goes stale the moment anyone
 * edits a shader: that program is then compiled cold again, in front of the
 * user, and nothing else tells you.
 *
 * WHAT IT DOES. Loads index.html on a real GPU (headed Chrome, the harness's
 * hardware args), records the vertex source, fragment source and attribute
 * bindings of every program the APP links (the prewarm's own throwaway programs
 * are recognised by their call stack and left out) through the loading screen,
 * the intro flight, a switch to night and back. Then:
 *   CHECK  - lists every linked program that is not in the manifest, and the
 *            time the page spent waiting on shader status queries under the
 *            loading screen. Exit 1 if any program is missing.
 *   --write - writes data/shader-manifest.json in link order: a line table
 *            plus, per program, line indices for each shader and the bindings.
 *   --merge - keeps the manifest and appends what this run linked that it
 *            lacks. One basemap program (fillOutline) is spelled two ways,
 *            depending on which style layer draws it first; merging keeps both.
 *
 * Run it after editing any GLSL (city-lighting.js, slopes.js materials, sky.js,
 * night layers) or bumping the MapLibre or three.js pins. A launch costs one GPU
 * browser: go through astra-pipe's gpu-run.mjs on the owner's laptop.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'data', 'shader-manifest.json');
const WRITE = process.argv.includes('--write');
const MERGE = process.argv.includes('--merge');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await launch(chromium, { headless: false, gl: 'hardware', maxMs: 420000 });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 632 }, deviceScaleFactor: 1.5 })).newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message.slice(0, 200)));

await page.addInitScript(() => {
  const G = window.WebGL2RenderingContext && WebGL2RenderingContext.prototype;
  if (!G) return;
  const R = window.__shaderRec = { progs: [], waitMs: 0, waitUnderVeilMs: 0 };
  const SH = new WeakMap(), PR = new WeakMap(), o = {};
  for (const k of ['createShader', 'shaderSource', 'createProgram', 'attachShader', 'bindAttribLocation', 'linkProgram', 'getProgramParameter', 'getProgramInfoLog', 'getShaderParameter']) o[k] = G[k];
  const fromPrewarm = () => /shader-prewarm\.js/.test(new Error().stack || '');
  G.createShader = function (type) { const s = o.createShader.call(this, type); if (s) SH.set(s, { type, src: null }); return s; };
  G.shaderSource = function (s, src) { const r = SH.get(s); if (r) r.src = src; return o.shaderSource.call(this, s, src); };
  G.createProgram = function () { const p = o.createProgram.call(this); if (p) PR.set(p, { v: null, f: null, a: [], skip: fromPrewarm() }); return p; };
  G.attachShader = function (p, s) { const r = PR.get(p), x = SH.get(s); if (r && x) r[x.type === this.VERTEX_SHADER ? 'vs' : 'fs'] = x; return o.attachShader.call(this, p, s); };
  G.bindAttribLocation = function (p, i, n) { const r = PR.get(p); if (r) r.a.push([i, n]); return o.bindAttribLocation.call(this, p, i, n); };
  G.linkProgram = function (p) {
    const r = PR.get(p);
    if (r && !r.skip && r.vs && r.fs) R.progs.push({ v: r.vs.src, f: r.fs.src, a: r.a.slice(), t: Math.round(performance.now()) });
    return o.linkProgram.call(this, p);
  };
  const timed = k => function (...a) {
    const t = performance.now(); const v = o[k].apply(this, a); const d = performance.now() - t;
    if (d > 0.3) { R.waitMs += d; if (document.getElementById('veil')) R.waitUnderVeilMs += d; }
    return v;
  };
  G.getProgramParameter = timed('getProgramParameter');
  G.getProgramInfoLog = timed('getProgramInfoLog');
  G.getShaderParameter = timed('getShaderParameter');
});

await page.goto(`${BASE}/index.html?drift=0${WRITE ? '&prewarm=0' : ''}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__map && window.__map.painter, null, { timeout: 120000 });
await page.evaluate(() => { try { window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect(); } catch (e) {} });
const t0 = Date.now();
for (;;) {
  const s = await page.evaluate(() => ({ veil: !!document.getElementById('veil'), f: window.__intro && window.__intro.flight && window.__intro.flight.state })).catch(() => null);
  if (s && !s.veil && (!s.f || s.f === 'done' || s.f === 'cancelled')) break;
  if (Date.now() - t0 > 240000) { console.log('gave up waiting for the loading screen and the intro flight'); break; }
  await sleep(500);
}
const underVeil = await page.evaluate(() => Math.round(window.__shaderRec.waitUnderVeilMs));
await sleep(3000);
await page.evaluate(() => { const el = document.getElementById('tod-slider'); if (el) el.value = '1'; window.applyTimeOfDay(window.__map, 1.0, true); });
await sleep(6000);
await page.evaluate(() => { const el = document.getElementById('tod-slider'); if (el) el.value = '0.5'; window.applyTimeOfDay(window.__map, 0.5, true); });
await sleep(3000);
const rec = await page.evaluate(() => ({ progs: window.__shaderRec.progs, waitMs: Math.round(window.__shaderRec.waitMs), prewarm: window.ShaderPrewarm && window.ShaderPrewarm.stats }));
await browser.__done();

// One entry per distinct program (the same source linked twice needs one compile).
const key = p => p.v + '\u0000' + p.f + '\u0000' + JSON.stringify(p.a);
const seen = new Set(), progs = [];
for (const p of rec.progs) { const k = key(p); if (!seen.has(k)) { seen.add(k); progs.push(p); } }
const label = p => (p.v.split('\n').find(l => /^(in|attribute) /.test(l.trim())) || p.v.split('\n')[1] || '').trim().slice(0, 60) + ` (vertex ${p.v.length} + fragment ${p.f.length} chars)`;
console.log(`linked ${rec.progs.length} programs, ${progs.length} distinct; shader status waits ${underVeil} ms under the loading screen, ${rec.waitMs} ms in all`);
if (rec.prewarm) console.log('prewarm:', JSON.stringify(rec.prewarm));
if (errors.length) console.log('page errors:', errors.slice(0, 5));

function writeManifest(list) {
  const lines = [], index = new Map();
  const enc = s => s.split('\n').map(l => { if (!index.has(l)) { index.set(l, lines.length); lines.push(l); } return index.get(l); });
  const manifest = { about: 'Shader programs js/shader-prewarm.js compiles at startup, in link order. Regenerate: node scripts/verify/shader-manifest.mjs --write (or --merge)', programs: list.length, lines, progs: list.map(p => ({ v: enc(p.v), f: enc(p.f), a: p.a })) };
  fs.writeFileSync(OUT, JSON.stringify(manifest));
  console.log(`wrote ${path.relative(ROOT, OUT)}: ${list.length} programs, ${lines.length} distinct lines, ${fs.statSync(OUT).size} bytes`);
}
if (WRITE) { writeManifest(progs); process.exit(0); }

let m = null;
try { m = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) { if (!MERGE) { console.log('no manifest at ' + OUT + ': run with --write'); process.exit(1); } }
const decoded = m ? m.progs.map(p => ({ v: p.v.map(i => m.lines[i]).join('\n'), f: p.f.map(i => m.lines[i]).join('\n'), a: p.a })) : [];
const have = new Set(decoded.map(key));
const missing = progs.filter(p => !have.has(key(p)));
if (MERGE) {
  // Some basemap programs come in two spellings, depending on which style
  // layer happens to draw first (same program, defines in another order).
  // --merge keeps every recorded spelling instead of flip-flopping.
  writeManifest([...decoded, ...missing]);
  process.exit(0);
}
const used = new Set(progs.map(key));
const unused = decoded.filter(p => !used.has(key(p))).length;
console.log(`manifest: ${decoded.length} programs; ${progs.length - missing.length} of ${progs.length} linked programs found; ${unused} manifest programs not linked this run`);
for (const p of missing) {
  console.log(`  MISSING at ${p.t} ms: ${label(p)}`);
  const near = decoded.find(q => q.v.length === p.v.length && q.f.length === p.f.length);
  if (near) for (const [s, t] of [[p.v, near.v], [p.f, near.f]]) {
    const a = s.split('\n'), b = t.split('\n');
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { console.log(`    line ${i}: ${JSON.stringify(a[i])}  manifest: ${JSON.stringify(b[i])}`); break; }
  }
}
if (missing.length) { console.log('STALE: run with --merge (keep old spellings) or --write (start over)'); process.exit(1); }
console.log('PASS');
