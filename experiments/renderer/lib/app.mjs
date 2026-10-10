/**
 * lib/app.mjs - open the REAL app in headless Chrome, with GL call counters installed
 * before any app script runs. Shared by measure-app.mjs, dump-apartments.mjs and compare.mjs.
 *
 * Software GL (SwiftShader) is the default, as everywhere in scripts/verify: right for pixels and
 * for counting calls, NOT valid for frame time. VERIFY_GL=hardware asks for the real chip.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '../../..');
export const VERIFY = path.join(REPO, 'scripts/verify');
export const PRIVATE = process.env.RENDERER_OUT || path.join(process.env.HOME || '.', 'flyover-private/renderer-2026-10-09');
fs.mkdirSync(PRIVATE, { recursive: true });

const pw = await import(pathToFileURL(path.join(VERIFY, 'node_modules/playwright-core/index.mjs')).href);
export const chromium = pw.chromium;
const chromeMod = await import(pathToFileURL(path.join(VERIFY, 'chrome.mjs')).href);
export const launch = chromeMod.launch;
export const BASE = process.env.VERIFY_URL || 'http://127.0.0.1:8475';

/** Runs in the page before any script: counts GL calls per canvas and per phase ('maplibre' | 'three'). */
export function glCounterInit() {
  if (window.__glc) return;
  const G = window.__glc = { phase: 'maplibre', canvases: new Map(), bufBytes: 0, ctxCount: 0 };
  const classify = n => {
    if (/^(multiDraw|draw)(Elements|Arrays|RangeElements)/.test(n)) return 'draw';
    if (n === 'useProgram') return 'program';
    if (/^bind(Texture|Sampler)$/.test(n) || n === 'activeTexture') return 'texbind';
    if (/^bind(Buffer|BufferBase|BufferRange|VertexArray)$/.test(n)) return 'bufbind';
    if (/^bind(Framebuffer|Renderbuffer)$/.test(n) || /^(draw|read)Buffers?$/.test(n) || n === 'blitFramebuffer' || n === 'framebufferTexture2D') return 'target';
    if (/^uniform/.test(n)) return 'uniform';
    if (/^(enable|disable|depthFunc|depthMask|depthRange|blendFunc|blendFuncSeparate|blendEquation|blendEquationSeparate|blendColor|colorMask|cullFace|frontFace|stencilFunc|stencilFuncSeparate|stencilOp|stencilOpSeparate|stencilMask|scissor|viewport|polygonOffset|lineWidth)$/.test(n)) return 'state';
    if (/^(clear|clearColor|clearDepth|clearStencil|clearBuffer)/.test(n)) return 'clear';
    if (/^(vertexAttrib|enableVertexAttribArray|disableVertexAttribArray)/.test(n)) return 'attrib';
    if (/^(bufferData|bufferSubData|texImage|texSubImage|compressedTex|copyTex|texStorage)/.test(n)) return 'upload';
    if (/^(get|is|check|read|finish|flush)/.test(n)) return 'query';
    return 'other';
  };
  const blank = () => ({ draw: 0, tris: 0, program: 0, texbind: 0, bufbind: 0, target: 0, uniform: 0, state: 0, clear: 0, attrib: 0, upload: 0, query: 0, other: 0, total: 0, uploadBytes: 0, jsMs: 0 });
  G.blank = blank;
  G.live = { buf: { three: 0, maplibre: 0, other: 0 }, tex: { three: 0, maplibre: 0, other: 0 } };
  G.progSet = new Set(); G.targetSet = new Set();
  const BB = new WeakMap(), TB = new WeakMap();
  const owner = () => G.phase === 'three' ? 'three' : 'maplibre';
  G.sets = { programs: new Set(), targets: new Set() };
  const keyOf = gl => {
    let c = G.canvases.get(gl.canvas);
    if (!c) { c = { id: (gl.canvas && (gl.canvas.id || gl.canvas.className)) || ('canvas' + G.canvases.size), phases: {} }; G.canvases.set(gl.canvas, c); G.ctxCount++; }
    return c;
  };
  const patch = P => {
    if (!P || P.__glcPatched) return; P.__glcPatched = true;
    for (const n of Object.getOwnPropertyNames(P)) {
      let d; try { d = Object.getOwnPropertyDescriptor(P, n); } catch (e) { continue; }
      if (!d || typeof d.value !== 'function' || n === 'constructor') continue;
      const orig = d.value, kind = classify(n);
      const isDraw = kind === 'draw';
      P[n] = function () {
        if (G.mute) return orig.apply(this, arguments);
        const c = keyOf(this), s = c.phases[G.phase] || (c.phases[G.phase] = blank());
        s.total++; s[kind]++;
        G.mute = true;
        try {
        if (n === 'useProgram') G.sets.programs.add(arguments[0]);
        else if (n === 'bindFramebuffer') G.sets.targets.add(arguments[1]);
        else if (n === 'bufferData') {
          const a = arguments, b = ({ 0x8892: 0x8894, 0x8893: 0x8895 })[a[0]];
          if (b) { try { const buf = this.getParameter(b); if (buf) { const bytes = typeof a[1] === 'number' ? a[1] : (a[1] ? a[1].byteLength : 0); const o = BB.get(buf) || { b: 0, who: owner() }; G.live.buf[o.who] += bytes - o.b; o.b = bytes; BB.set(buf, o); } } catch (e) {} }
        } else if (n === 'deleteBuffer') { const o = arguments[0] && BB.get(arguments[0]); if (o) { G.live.buf[o.who] -= o.b; BB.delete(arguments[0]); } }
        else if (n === 'texImage2D' || n === 'texStorage2D') {
          try { const a = arguments; let w, h; if (n === 'texStorage2D') { w = a[3]; h = a[4]; } else if (a.length >= 8) { w = a[3]; h = a[4]; } else { const sx = a[5]; w = sx && (sx.width || sx.videoWidth) || 0; h = sx && (sx.height || sx.videoHeight) || 0; }
            const tgt = a[0]; const bind = tgt === 0x0DE1 ? 0x8069 : null; if (bind && w) { const t = this.getParameter(bind); if (t) { const o = TB.get(t) || { m: new Map(), who: owner() }; const lvl = n === 'texStorage2D' ? 'st' : a[1]; const bytes = n === 'texStorage2D' ? (() => { let sum = 0; for (let l = 0; l < a[1]; l++) sum += Math.max(1, w >> l) * Math.max(1, h >> l) * 4; return sum; })() : w * h * 4; const old = o.m.get(lvl) || 0; o.m.set(lvl, bytes); G.live.tex[o.who] += bytes - old; TB.set(t, o); } } } catch (e) {}
        } else if (n === 'deleteTexture') { const o = arguments[0] && TB.get(arguments[0]); if (o) { for (const v of o.m.values()) G.live.tex[o.who] -= v; TB.delete(arguments[0]); } }
        } finally { G.mute = false; }
        if (isDraw) {
          const a = arguments; let count = 0, inst = 1;
          if (/^multiDraw/.test(n)) {                       // (mode, counts, countsOffset, type, offsets, offsetsOffset, drawcount [, instanceCounts...]): one call
            const cs = a[1], co = a[2] || 0, dc = a[6]; let sum = 0; for (let i = 0; i < dc; i++) sum += cs[co + i];
            if (a[0] === 4) s.tris += sum / 3; return orig.apply(this, arguments);
          }
          if (/Arrays/.test(n)) count = a[2]; else if (/RangeElements/.test(n)) count = a[3]; else count = a[1];
          if (/Instanced/.test(n)) inst = a[a.length - 1];
          if (a[0] === 4) s.tris += (count / 3) * inst; else if (a[0] === 5 || a[0] === 6) s.tris += Math.max(0, count - 2) * inst;
        } else if (kind === 'upload') {
          const a = arguments; const last = a[a.length - 1]; const src = a[1] && a[1].byteLength != null ? a[1] : (last && last.byteLength != null ? last : null);
          if (src) s.uploadBytes += src.byteLength; else if (typeof a[1] === 'number') s.uploadBytes += a[1];
        }
        return orig.apply(this, arguments);
      };
    }
  };
  patch(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype);
  patch(window.WebGLRenderingContext && WebGLRenderingContext.prototype);
  G.snap = () => { const o = {}; for (const [, c] of G.canvases) { o[c.id] = {}; for (const [p, s] of Object.entries(c.phases)) o[c.id][p] = { ...s }; } return o; };
  // Wrap the three.js layer so its share is counted separately.
  G.wrapLayer = () => {
    const L = window.slopes && window.slopes.layer; if (!L || L.__glcWrapped) return !!(L && L.__glcWrapped);
    L.__glcWrapped = true;
    for (const fn of ['render', 'prerender']) {
      const o = L[fn];
      L[fn] = function () { const prev = G.phase; G.phase = 'three'; const t = performance.now(); try { return o.apply(this, arguments); } finally { G.threeMs = (G.threeMs || 0) + (performance.now() - t); G.phase = prev; } };
    }
    return true;
  };
}

/** Open the app. Returns { browser, page, errors, t0 }. */
export async function openApp({ query = '', viewport = { width: 1280, height: 800 }, dsf = 1, gl = null, initScripts = [], extraArgs = [], url = null } = {}) {
  // RENDERER_NOVSYNC=1 turns the frame limiter off (scripts/verify/README.md, turnmeter): without it a frame
  // interval is a multiple of 16.7 ms and says nothing about what the frame cost.
  const args = process.env.RENDERER_NOVSYNC ? [...chromeMod.glArgsFor(gl), '--disable-gpu-vsync', '--disable-frame-rate-limit'] : undefined;
  const browser = await launch(chromium, { gl, maxMs: 25 * 60 * 1000, args });
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: dsf });
  await ctx.addInitScript(glCounterInit);
  // CLAUDE.md rule 10: cancel the graphics auto-detect probe before anything it can change.
  await ctx.addInitScript(() => { const t = setInterval(() => { if (window.cancelGraphicsAutoDetect) { window.cancelGraphicsAutoDetect(); clearInterval(t); } }, 10); });
  for (const s of initScripts) await ctx.addInitScript(s);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR ' + String(e).slice(0, 200)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  const t0 = Date.now();
  const target = url || (BASE + '/index.html?intro=0&drift=0&namelabels=0' + (query ? '&' + query.replace(/^[?&]/, '') : ''));
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 180000 });
  return { browser, page, errors, t0, ctx };
}

/** Wait until the veil is gone and the authored apartments have landed. Returns ms since t0 for each milestone. */
export async function waitReady(page, t0, { timeoutMs = 20 * 60 * 1000, needApartments = true } = {}) {
  const ms = {};
  const t = () => Date.now() - t0;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const s = await page.evaluate(() => {
      const A = window.slopesApartments, m = window.__map;
      return { map: !!m, styleLoaded: !!(m && m.isStyleLoaded && m.isStyleLoaded()), veil: !!document.getElementById('veil'),
        reason: window.__intro && window.__intro.reason || null, slopes: !!(window.slopes && window.slopes.layer),
        done: !!(A && A.count && A.count.done), ready: !!(A && A.readyToReveal && A.readyToReveal()), n: A && A.count ? A.count.buildings : 0,
        tris: A && A.count ? A.count.triangles : 0, frames: window.slopes ? window.slopes.frames : 0 };
    }).catch(() => ({}));
    if (s.map && ms.map == null) ms.map = t();
    if (s.styleLoaded && ms.styleLoaded == null) ms.styleLoaded = t();
    if (s.reason && ms.veilGone == null) ms.veilGone = t();
    if (s.done && ms.apartmentsDone == null) ms.apartmentsDone = t();
    if (s.ready && ms.ready == null) ms.ready = t();
    ms.last = s;
    if ((!needApartments && s.reason) || (s.done && s.ready && s.reason)) return ms;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('app not ready after ' + timeoutMs + ' ms: ' + JSON.stringify(ms));
}

export function readJSON(f) { return JSON.parse(fs.readFileSync(f, 'utf8')); }
export const poses = () => readJSON(path.join(VERIFY, 'ci/poses.json'));
