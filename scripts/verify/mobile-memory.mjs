/**
 * mobile-memory.mjs — how much memory does the PHONE profile need, at its peak
 * and once it has settled? Desktop Chrome in phone emulation, NOT a phone.
 *
 * WHY. 2026-09-24: "the site still breaks on mobile browsers — it loads for
 * like 15 seconds, but during the intro it refreshes, and then i get an error
 * 'a problem repeatedly occured'". That is iOS Safari after its page process
 * was killed twice, which is what jetsam does to a tab over its memory limit.
 * mobile-budget.mjs reads one number (JS heap after a forced GC, once the veil
 * lifts). A phone is not killed for its settled JS heap; it is killed for its
 * whole footprint at the worst moment — typed-array backing stores, decoded
 * images, and every texture and buffer the page hands WebGL (WebKit charges
 * GPU-process allocations back to the page that asked for them). So this reads,
 * once a second from navigation until `--settle` ms after the authored
 * buildings land:
 *
 *   heap     CDP Runtime.getHeapUsage: used JS heap, embedder heap, and
 *            backingStorageSize (ArrayBuffers / typed arrays / external strings)
 *   gl       every texture, buffer and renderbuffer the page allocates in WebGL,
 *            live bytes, counted in the page (a wrapper on the GL entry points),
 *            and at the end the live bytes per owner (the first js/ file on the
 *            allocating stack, else the library)
 *   renderer / gpu   the renderer and GPU processes' private bytes and working
 *            set (Get-Process, Windows only)
 *
 * and reports the PEAK during the intro and the SETTLED value (the minimum of
 * the last 5 samples). The headline is `phone` = JS heap + backing store + GL
 * live bytes: what the page itself is holding, independent of this machine's
 * GPU driver (a discrete GPU's VRAM is not in any process's working set here).
 *
 *   VERIFY_URL=http://127.0.0.1:8871 node mobile-memory.mjs
 *   node mobile-memory.mjs --arms main=http://127.0.0.1:8872,branch=http://127.0.0.1:8871 --reps 3
 *   options: --query '?drift=0'  --settle 30000  --out <dir>  --desktop (1280x800, no touch)
 *
 * Arms are interleaved rep by rep (A1 B1 A2 B2 ...) and every rep is a FRESH
 * browser, so no process carries the previous load. Run it through the lane's
 * gpu-run.mjs: it holds one browser at a time. Exit 0 always unless it could
 * not run (2) — it is a measurement, not a gate.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { BASE, launch, HW_ARGS } from './chrome.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const ARMS = (arg('--arms', 'this=' + BASE)).split(',').map(s => { const i = s.indexOf('='); return { name: s.slice(0, i), base: s.slice(i + 1) }; });
const REPS = +arg('--reps', 1);
const QUERY = arg('--query', '?drift=0');
const SETTLE = +arg('--settle', 30000);
const REVEAL_MAX = +arg('--max', 300000);
const OUT = arg('--out', path.join(os.tmpdir(), 'mobile-memory'));
const DESKTOP = argv.includes('--desktop');
fs.mkdirSync(OUT, { recursive: true });

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE_UA };
const DESK = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 };
const MB = b => b == null ? null : Math.round(b / 1048576);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── In-page GL accounting (runs before any app script) ─────────────────
function glInit() {
  if (window.__mm) return;
  const M = window.__mm = { tex: 0, buf: 0, rb: 0, peak: 0, own: {} };
  const TB = new WeakMap(), BB = new WeakMap(), RB = new WeakMap(), LIVE = M.live = new Set();
  const SIZED = { 0x8058: 4, 0x8051: 4, 0x881A: 8, 0x881B: 8, 0x8814: 16, 0x8815: 16, 0x8229: 1, 0x822B: 2, 0x822D: 2, 0x822E: 4,
    0x822F: 4, 0x8230: 8, 0x81A5: 2, 0x81A6: 4, 0x88F0: 4, 0x8CAC: 4, 0x8CAD: 8, 0x8C43: 4, 0x8C41: 4, 0x8D62: 2, 0x8056: 2,
    0x8057: 2, 0x8D48: 1, 0x8C3A: 4, 0x8C3D: 4, 0x8059: 4 };
  const CH = { 0x1908: 4, 0x1907: 3, 0x1906: 1, 0x1909: 1, 0x190A: 2, 0x1903: 1, 0x8227: 2, 0x1902: 1, 0x84F9: 1, 0x8D94: 1, 0x8228: 2, 0x8D98: 4, 0x8D99: 4 };
  const TY = { 0x1401: 1, 0x1400: 1, 0x1406: 4, 0x140B: 2, 0x8D61: 2, 0x1403: 2, 0x1402: 2, 0x1405: 4, 0x1404: 4, 0x84FA: 4, 0x8033: 2, 0x8034: 2, 0x8363: 2, 0x8368: 4, 0x8C3B: 4, 0x8DAD: 8 };
  const bpp = (ifmt, fmt, type) => {
    if (SIZED[ifmt]) return SIZED[ifmt];
    const c = CH[fmt] || CH[ifmt] || 4, t = TY[type] || 1;
    if ([0x8033, 0x8034, 0x8363, 0x84FA, 0x8368, 0x8C3B].includes(type)) return t;
    return Math.max(1, (c === 3 ? 4 : c) * t);
  };
  const texBind = t => t === 0x0DE1 ? 0x8069 : (t >= 0x8515 && t <= 0x851A) || t === 0x8513 ? 0x8514 : t === 0x8C1A ? 0x8C1D : t === 0x806F ? 0x806A : null;
  const bufBind = { 0x8892: 0x8894, 0x8893: 0x8895, 0x8A11: 0x8A28, 0x88EB: 0x88ED, 0x88EC: 0x88EF, 0x8F36: 0x8F36, 0x8F37: 0x8F37, 0x8C8E: 0x8C8F };
  const who = (kind) => {
    try {
      const st = new Error().stack.split('\n');
      for (const l of st) { const m = l.match(/\/(js\/[\w.-]+\.js):\d+/); if (m) return kind + ' ' + m[1]; }
      for (const l of st) { const m = l.match(/(maplibre-gl|three)[^/]*\.js/); if (m) return kind + ' ' + m[1]; }
    } catch (e) {}
    return kind + ' ?';
  };
  const add = (o, d) => { if (o && d) M.own[o] = (M.own[o] || 0) + d; const t = M.tex + M.buf + M.rb; if (t > M.peak) M.peak = t; };
  function setTex(gl, target, key, bytes) {
    const b = texBind(target); if (!b) return;
    const tex = gl.getParameter(b); if (!tex) return;
    let m = TB.get(tex); if (!m) { m = new Map(); m.owner = who('tex'); TB.set(tex, m); LIVE.add(m); }
    const old = m.get(key) || 0; m.set(key, bytes); M.tex += bytes - old; add(m.owner, bytes - old);
  }
  function patch(P) {
    if (!P || P.__mmPatched) return; P.__mmPatched = true;
    const w = (name, fn) => { const o = P[name]; if (typeof o !== 'function') return; P[name] = function () { try { fn.call(this, arguments); } catch (e) {} return o.apply(this, arguments); }; };
    w('texImage2D', function (a) {
      let wd, ht, fmt, type; const ifmt = a[2];
      if (a.length >= 8) { wd = a[3]; ht = a[4]; fmt = a[6]; type = a[7]; }
      else { const s = a[5]; wd = s && (s.videoWidth || s.naturalWidth || s.width) || 0; ht = s && (s.videoHeight || s.naturalHeight || s.height) || 0; fmt = a[3]; type = a[4]; }
      setTex(this, a[0], a[0] + ':' + a[1], wd * ht * bpp(ifmt, fmt, type));
      try { const b = texBind(a[0]); const t = b && this.getParameter(b); const m = t && TB.get(t); if (m && a[1] === 0) m.wh = wd + 'x' + ht; } catch (e) {}
    });
    w('texImage3D', function (a) { setTex(this, a[0], a[0] + ':' + a[1], a[3] * a[4] * a[5] * bpp(a[2], a[7], a[8])); });
    w('texStorage2D', function (a) { let s = 0; for (let l = 0; l < a[1]; l++) s += Math.max(1, a[3] >> l) * Math.max(1, a[4] >> l) * bpp(a[2]); if (a[0] === 0x8513) s *= 6; setTex(this, a[0], 'st', s); });
    w('texStorage3D', function (a) { let s = 0; for (let l = 0; l < a[1]; l++) s += Math.max(1, a[3] >> l) * Math.max(1, a[4] >> l) * a[5] * bpp(a[2]); setTex(this, a[0], 'st', s); });
    w('compressedTexImage2D', function (a) { const d = a[a.length - 1]; setTex(this, a[0], a[0] + ':' + a[1], d && d.byteLength || 0); });
    w('generateMipmap', function (a) {
      const b = texBind(a[0]); if (!b) return; const tex = this.getParameter(b); const m = tex && TB.get(tex); if (!m) return;
      const l0 = m.get(a[0] + ':0') || 0; const old = m.get('mip') || 0; m.set('mip', l0 / 3); M.tex += l0 / 3 - old; add(m.owner, l0 / 3 - old);
    });
    w('deleteTexture', function (a) { const m = a[0] && TB.get(a[0]); if (!m) return; let s = 0; for (const v of m.values()) s += v; M.tex -= s; add(m.owner, -s); TB.delete(a[0]); LIVE.delete(m); });
    w('bufferData', function (a) {
      const b = bufBind[a[0]]; if (!b) return; const buf = this.getParameter(b); if (!buf) return;
      const bytes = typeof a[1] === 'number' ? a[1] : (a.length >= 5 && a[4] ? a[4] * (a[1].BYTES_PER_ELEMENT || 1) : (a[1] ? a[1].byteLength : 0));
      let o = BB.get(buf); if (!o) { o = { b: 0, owner: who('buf') }; BB.set(buf, o); }
      M.buf += bytes - o.b; add(o.owner, bytes - o.b); o.b = bytes;
    });
    w('deleteBuffer', function (a) { const o = a[0] && BB.get(a[0]); if (!o) return; M.buf -= o.b; add(o.owner, -o.b); BB.delete(a[0]); });
    const rbs = (gl, ifmt, wd, ht, samples) => {
      const rb = gl.getParameter(0x8CA7); if (!rb) return;
      const bytes = wd * ht * bpp(ifmt) * Math.max(1, samples);
      let o = RB.get(rb); if (!o) { o = { b: 0, owner: who('rb') }; RB.set(rb, o); }
      M.rb += bytes - o.b; add(o.owner, bytes - o.b); o.b = bytes;
    };
    w('renderbufferStorage', function (a) { rbs(this, a[1], a[2], a[3], 1); });
    w('renderbufferStorageMultisample', function (a) { rbs(this, a[2], a[3], a[4], a[1]); });
    w('deleteRenderbuffer', function (a) { const o = a[0] && RB.get(a[0]); if (!o) return; M.rb -= o.b; add(o.owner, -o.b); RB.delete(a[0]); });
  }
  patch(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype);
  patch(window.WebGLRenderingContext && WebGLRenderingContext.prototype);

  // Large CPU buffers (>= 256 KB) by the code that allocated them, live bytes
  // kept with a FinalizationRegistry. A census, not an exact ledger: views on
  // an existing buffer, .slice() copies and worker isolates are not counted.
  const AB = M.ab = {}, MIN = 256 * 1024;
  const fin = new FinalizationRegistry(([o, b]) => { AB[o] = (AB[o] || 0) - b; });
  const track = (obj, who2) => {
    try {
      const buf = obj && (obj.buffer || obj); const b = buf && buf.byteLength;
      if (!b || b < MIN) return;
      AB[who2] = (AB[who2] || 0) + b; fin.register(buf, [who2, b]);
    } catch (e) {}
  };
  const whoLine = () => {
    try {
      const st = new Error().stack.split('\n');
      for (const l of st) { const m = l.match(/\/(js\/[\w.-]+\.js):(\d+)/); if (m) return m[1] + ':' + m[2]; }
      for (const l of st) { const m = l.match(/(maplibre-gl|three|pmtiles)[^/]*\.js/); if (m) return m[1]; }
    } catch (e) {}
    return '?';
  };
  for (const name of ['ArrayBuffer', 'Float32Array', 'Float64Array', 'Uint8Array', 'Uint8ClampedArray', 'Uint16Array', 'Uint32Array', 'Int8Array', 'Int16Array', 'Int32Array']) {
    const C = window[name]; if (!C) continue;
    window[name] = new Proxy(C, { construct(t, args, nt) {
      const o = Reflect.construct(t, args, nt === window[name] ? t : nt);
      const a0 = args[0];
      if (!(a0 instanceof ArrayBuffer) && o.byteLength >= MIN) track(o, whoLine());
      return o;
    } });
  }
  const RA = Response.prototype.arrayBuffer;
  Response.prototype.arrayBuffer = function () { const w = whoLine(); return RA.apply(this, arguments).then(b => { track(b, 'fetch ' + w); return b; }); };
  const GI = CanvasRenderingContext2D.prototype.getImageData;
  CanvasRenderingContext2D.prototype.getImageData = function () { const r = GI.apply(this, arguments); track(r.data, 'getImageData ' + whoLine()); return r; };
}

// ── Process memory, Windows: one PowerShell loop for the whole run ─────
function startProcSampler() {
  const latest = new Map();
  if (process.platform !== 'win32') return { get: () => latest, stop() {} };
  const ps = "while($true){ Get-Process chrome,msedge -ErrorAction SilentlyContinue | % { \"$($_.Id)|$($_.PrivateMemorySize64)|$($_.WorkingSet64)\" }; '---'; Start-Sleep -Milliseconds 600 }";
  const child = spawn('powershell', ['-NoProfile', '-Command', ps], { stdio: ['ignore', 'pipe', 'ignore'] });
  let buf = '', cur = new Map();
  child.stdout.on('data', d => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (line === '---') { latest.clear(); for (const [k, v] of cur) latest.set(k, v); cur = new Map(); continue; }
      const [id, pm, ws] = line.split('|').map(Number);
      if (id) cur.set(id, { pm, ws });
    }
  });
  return { get: () => latest, stop() { try { child.kill(); } catch (e) {} } };
}

async function measure(arm, rep, sampler) {
  const browser = await launch(chromium, { args: [...HW_ARGS, '--enable-precise-memory-info'], maxMs: REVEAL_MAX + SETTLE + 120000 });
  const bcdp = await browser.newBrowserCDPSession();
  const ctx = await browser.newContext(DESKTOP ? DESK : PHONE);
  await ctx.addInitScript(glInit);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const errors = [];
  let crashed = false, navs = 0;
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });
  page.on('crash', () => { crashed = true; });
  page.on('framenavigated', f => { if (f === page.mainFrame()) navs++; });

  const t0 = Date.now();
  // An arm may carry its own query (`lighter=http://127.0.0.1:8871/?drift=0&litetier=lighter`).
  await page.goto(arm.base.includes('?') ? arm.base : arm.base + '/' + QUERY, { waitUntil: 'domcontentloaded', timeout: 120000 });
  const samples = [];
  let tReveal = null, tLanded = null, tEnd = null;
  for (;;) {
    const t = Date.now() - t0;
    let s = null;
    try {
      s = await page.evaluate(() => {
        const M = window.__mm || {};
        const A = window.slopesApartments;
        let ready = null; try { ready = A && A.readyToReveal ? A.readyToReveal() : null; } catch (e) {}
        return {
          veil: !!document.getElementById('veil'), reason: window.__intro && window.__intro.reason || null,
          slopesOn: !!(window.SLOPES && window.SLOPES.on), aptsOn: !!(window.APARTMENTS && window.APARTMENTS.on),
          group: !!(A && A.group), ready, n: A && A.count ? A.count.buildings : null,
          tex: M.tex, buf: M.buf, rb: M.rb, glPeak: M.peak,
          lite: window.LITE_PROFILE ? { on: window.LITE_PROFILE.on, safe: window.LITE_PROFILE.safe, tier: window.LITE_PROFILE.tier || null } : null,
        };
      });
    } catch (e) { s = { evalError: String(e).slice(0, 120) }; }
    let hu = null; try { hu = await cdp.send('Runtime.getHeapUsage'); } catch (e) {}
    let procs = []; try { procs = (await bcdp.send('SystemInfo.getProcessInfo')).processInfo; } catch (e) {}
    const pm = sampler.get();
    const rend = procs.filter(p => p.type === 'renderer').map(p => pm.get(p.id)).filter(Boolean);
    const gpu = procs.filter(p => p.type === 'GPU').map(p => pm.get(p.id)).filter(Boolean);
    const sum = (a, k) => a.length ? a.reduce((x, y) => x + (y[k] || 0), 0) : null;
    const row = {
      t, ...s,
      heapUsed: hu && hu.usedSize, heapEmbedder: hu && hu.embedderHeapUsedSize, backing: hu && hu.backingStorageSize,
      rendPM: sum(rend, 'pm'), rendWS: sum(rend, 'ws'), gpuPM: sum(gpu, 'pm'), gpuWS: sum(gpu, 'ws'),
    };
    row.gl = (row.tex || 0) + (row.buf || 0) + (row.rb || 0);
    row.phone = (row.heapUsed || 0) + (row.heapEmbedder || 0) + (row.backing || 0) + row.gl;
    samples.push(row);
    if (tReveal == null && s && s.reason) tReveal = t;
    const landed = s && s.reason && (!s.slopesOn || !s.aptsOn || s.ready === true);
    if (tLanded == null && landed) tLanded = t;
    if (tLanded != null && t - tLanded >= SETTLE) { tEnd = t; break; }
    if (crashed || t > REVEAL_MAX + SETTLE) { tEnd = t; break; }
    await sleep(1000);
  }

  // Census at the end: who owns the GL bytes, what the three.js scene keeps on
  // the CPU, and what MapLibre's image manager and tile pattern atlases hold.
  let census = null;
  if (!crashed) {
    census = await page.evaluate(() => {
      const out = { glOwners: {}, three: null, maplibre: null };
      const M = window.__mm || { own: {} };
      for (const [k, v] of Object.entries(M.own)) if (v > 1048576) out.glOwners[k] = Math.round(v / 1048576);
      out.liveTex = {};
      for (const m of (M.live || [])) { let b = 0; for (const v of m.values()) b += v; const k = m.owner + ' ' + (m.wh || '?'); const o = out.liveTex[k] = out.liveTex[k] || [0, 0]; o[0]++; o[1] += b; }
      out.liveTex = Object.fromEntries(Object.entries(out.liveTex).sort((a, b) => b[1][1] - a[1][1]).slice(0, 15).map(([k, v]) => [k, v[0] + ' x = ' + Math.round(v[1] / 1048576) + ' MB']));
      try { const tm = window.__map.style.tileManagers['austin-buildings']; out.tmKeys = Object.keys(tm).join(','); out.cacheKeys = tm._cache ? Object.keys(tm._cache).join(',') : null; out.cacheMax = tm._cache && tm._cache.max; } catch (e) { out.tmKeys = String(e).slice(0, 80); }
      out.cpuOwners = {};
      for (const [k, v] of Object.entries(M.ab || {}).sort((a, b) => b[1] - a[1]).slice(0, 25)) if (v > 2 * 1048576) out.cpuOwners[k] = Math.round(v / 1048576);
      try {
        const S = window.slopes && window.slopes.scene;
        if (S) {
          const seen = new Set(); let cpu = 0, tris = 0, geoms = 0;
          S.traverse(o => {
            const g = o.geometry; if (!g || seen.has(g)) return; seen.add(g); geoms++;
            for (const a of Object.values(g.attributes || {})) { const arr = a.array || (a.data && a.data.array); if (arr && !seen.has(arr)) { seen.add(arr); cpu += arr.byteLength; } }
            if (g.index && g.index.array && !seen.has(g.index.array)) { seen.add(g.index.array); cpu += g.index.array.byteLength; }
            tris += g.index ? g.index.count / 3 : (g.attributes.position ? g.attributes.position.count / 3 : 0);
          });
          out.three = { geometries: geoms, cpuMB: Math.round(cpu / 1048576), triangles: Math.round(tris) };
        }
      } catch (e) { out.three = { error: String(e).slice(0, 100) }; }
      try {
        const map = window.__map, st = map && map.style;
        let imgCpu = 0, imgN = 0;
        const im = st && st.imageManager;
        const imgs = im && (im.images || (im.getImages && null));
        if (imgs) for (const v of Object.values(imgs)) { const d = v && v.data && v.data.data; if (d) { imgCpu += d.byteLength; imgN++; } }
        const tms = st && (st.tileManagers || st._sourceCaches || st.sourceCaches) || {};
        const per = {};
        const tileOf = v => !v || typeof v !== 'object' ? null : (v.tileID ? v : (v.value && v.value.tileID ? v.value : null));
        const walk = (store, depth, fn) => {
          if (!store || typeof store !== 'object') return;
          if (typeof store.forEach === 'function' && typeof store.size === 'number') { store.forEach(v => { if (Array.isArray(v)) v.forEach(x => { const t = tileOf(x); if (t) fn(t); }); else { const t = tileOf(v); if (t) fn(t); } }); return; }
          for (const k in store) { const v = store[k]; if (Array.isArray(v)) { v.forEach(x => { const t = tileOf(x); if (t) fn(t); }); continue; } const t = tileOf(v); if (t) { fn(t); continue; } if (depth > 0 && v && typeof v === 'object') walk(v, depth - 1, fn); }
        };
        for (const [id, tm] of Object.entries(tms)) {
          if (!tm) continue;
          const o = per[id] = { inView: 0, cached: 0, atlasInViewMB: 0, atlasCachedMB: 0 };
          const seen = new Set();
          const f = (key) => (t) => { if (seen.has(t)) return; seen.add(t); o[key]++; const a = t.imageAtlas; if (a && a.image && a.image.width) o[key === 'inView' ? 'atlasInViewMB' : 'atlasCachedMB'] += a.image.width * a.image.height * 4 / 1048576; };
          walk(tm._inViewTiles, 2, f('inView')); walk(tm._tiles, 2, f('inView'));
          walk(tm._cache && (tm._cache.data || tm._cache), 2, f('cached'));
          o.atlasInViewMB = Math.round(o.atlasInViewMB); o.atlasCachedMB = Math.round(o.atlasCachedMB);
          o.maxCache = tm._cache && tm._cache.max;
          if (!o.inView && !o.cached) delete per[id];
        }
        out.maplibre = { images: imgN, imagesCpuMB: Math.round(imgCpu / 1048576), sources: per };
      } catch (e) { out.maplibre = { error: String(e).slice(0, 100) }; }
      out.lite = window.LITE_PROFILE ? JSON.parse(JSON.stringify(window.LITE_PROFILE)) : null;
      out.preset = window.GFX ? window.GFX.preset : null;
      out.renderScale = window.GFX ? window.GFX.renderScale : null;
      try { out.canvas = [window.__map.getCanvas().width, window.__map.getCanvas().height]; } catch (e) {}
      try { out.slopesTris = window.slopes.stats().triangles; } catch (e) {}
      try { out.apts = { buildings: window.slopesApartments.count.buildings, triangles: window.slopesApartments.count.triangles }; } catch (e) {}
      return out;
    }).catch(e => ({ error: String(e).slice(0, 200) }));
  }
  await browser.__done();

  const intro = samples.filter(r => tLanded == null || r.t <= tLanded + 5000);
  const tail = samples.slice(-5);
  const peak = (rows, k) => rows.reduce((m, r) => r[k] != null && r[k] > m ? r[k] : m, 0);
  const settled = (k) => tail.reduce((m, r) => r[k] != null && r[k] < m ? r[k] : m, Infinity);
  const KEYS = ['phone', 'heapUsed', 'backing', 'gl', 'tex', 'buf', 'rb', 'rendPM', 'rendWS', 'gpuPM', 'gpuWS'];
  const res = { arm: arm.name, rep, crashed, navs, tReveal, tLanded, errors: errors.slice(0, 20), census, peak: {}, settled: {}, samples };
  for (const k of KEYS) {
    res.peak[k] = MB(Math.max(peak(intro, k), peak(samples, k)));
    const v = settled(k); res.settled[k] = v === Infinity ? null : MB(v);
  }
  res.peak.glPeakInPage = MB(peak(samples, 'glPeak'));
  return res;
}

const sampler = startProcSampler();
await sleep(1500);
const results = [];
try {
  for (let rep = 1; rep <= REPS; rep++) {
    for (const arm of ARMS) {
      const r = await measure(arm, rep, sampler);
      results.push(r);
      const p = r.peak, s = r.settled;
      console.log(`${arm.name} rep ${rep}: reveal ${r.tReveal} ms, landed ${r.tLanded} ms, crashed ${r.crashed}, navs ${r.navs}, errors ${r.errors.length}`);
      console.log(`   peak    phone ${p.phone}  heap ${p.heapUsed}  backing ${p.backing}  gl ${p.gl} (tex ${p.tex} buf ${p.buf} rb ${p.rb})  renderer ${p.rendPM}/${p.rendWS}  gpu ${p.gpuPM}/${p.gpuWS}  MB (private/ws)`);
      console.log(`   settled phone ${s.phone}  heap ${s.heapUsed}  backing ${s.backing}  gl ${s.gl} (tex ${s.tex} buf ${s.buf} rb ${s.rb})  renderer ${s.rendPM}/${s.rendWS}  gpu ${s.gpuPM}/${s.gpuWS}  MB`);
      if (r.census) console.log('   census', JSON.stringify({ three: r.census.three, maplibre: r.census.maplibre, preset: r.census.preset, canvas: r.census.canvas, slopesTris: r.census.slopesTris, apts: r.census.apts, tier: r.census.lite && r.census.lite.tier }));
      if (r.census) console.log('   gl owners MB', JSON.stringify(r.census.glOwners));
      if (r.census) console.log('   cpu owners MB', JSON.stringify(r.census.cpuOwners));
      if (r.census) console.log('   live textures', JSON.stringify(r.census.liveTex), r.census.tmKeys, '| cache:', r.census.cacheKeys, r.census.cacheMax);
      fs.writeFileSync(path.join(OUT, `mem-${arm.name}-${rep}.json`), JSON.stringify(r, null, 1));
    }
  }
} finally { sampler.stop(); }

// Minimum per arm over reps (CLAUDE.md rule 10), with the range.
console.log('\nSUMMARY (MB; min over reps, [range])' + (DESKTOP ? ' — DESKTOP 1280x800' : ' — phone emulation 390x844 DPR 3'));
for (const arm of ARMS) {
  const rs = results.filter(r => r.arm === arm.name && !r.crashed);
  if (!rs.length) { console.log(arm.name, 'no successful reps'); continue; }
  const f = (grp, k) => { const v = rs.map(r => r[grp][k]).filter(x => x != null); return v.length ? `${Math.min(...v)} [${Math.min(...v)}-${Math.max(...v)}]` : '-'; };
  console.log(`${arm.name}:`);
  for (const k of ['phone', 'heapUsed', 'backing', 'gl', 'tex', 'buf', 'rendPM', 'rendWS', 'gpuPM', 'gpuWS']) {
    console.log(`   ${k.padEnd(9)} peak ${f('peak', k).padEnd(20)} settled ${f('settled', k)}`);
  }
  console.log(`   landed ms ${rs.map(r => r.tLanded).join(', ')}`);
}
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(results.map(r => ({ ...r, samples: undefined })), null, 1));
process.exit(0);
