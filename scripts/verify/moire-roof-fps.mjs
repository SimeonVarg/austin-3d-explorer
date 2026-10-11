import fs from 'node:fs';
import {createHash} from 'node:crypto';
/**
 * moire-fps.mjs — does an anti-aliasing change cost frames while FLYING?
 *
 * Interleaved A/B on the real page (index.html, not _harness.html: the harness
 * shims requestAnimationFrame to setTimeout(16) and would measure the shim).
 * Each rep of each side is a fresh page in a fresh context (MSAA is a context
 * attribute, so it is a page load), the same scripted flight as moire.mjs,
 * one camera step per frame, vsync and the frame-rate cap OFF so a frame
 * costs what it costs instead of rounding to the display's refresh.
 *
 *   VERIFY_URL=http://127.0.0.1:<port> node moire-fps.mjs \
 *     --a 'BEFORE||{"msaa":false,"custom":true}' \
 *     --b 'AFTER||{"msaa":true,"custom":true}' [--reps 3] [--frames 300] [--flight spawn-orbit]
 *
 *   each side: label | extra URL query (k=v&k=v) | saved graphics JSON
 *   --ref-a <git-ref> / --ref-b <git-ref>   serve that side's js/*.js and *.html from a git ref
 *
 * Prints, per side: the renderer, canvas, antialias/samples, and the frame
 * time min / median / p90 over its reps (each rep's median first, then the
 * min and median of those), with no CPU throttle. The window title is the
 * side's label (BEFORE / AFTER) so a visible window can be told apart.
 *
 * Each rep also prints cpu=, the whole machine's CPU busy share over that rep
 * (this browser included). A rep that reads far above its neighbours shared
 * the machine with something else: read the pairs, not one side's minimum.
 * The last lines are the median of the per-rep differences B - A, of the
 * median frame and of the mean frame (wall time / frames). Read the MEAN on
 * the AMD integrated chip: there the median sits near 20 ms while the mean is
 * 45-65 ms, because most ticks are short and every few frames one waits on
 * the GPU queue, so a GPU cost shows in the mean and the tail, not the median.
 * Across fresh loads that mean still swings 45-66 ms between reps of the SAME
 * code; for a change that can be switched live, time it in one page instead.
 */
import { chromium } from 'playwright-core';
import { BASE, launch, HW_ARGS } from './chrome.mjs';
import { execFileSync, spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const provenance={head:execFileSync('git',['rev-parse','HEAD'],{cwd:REPO,encoding:'utf8'}).trim(),status:execFileSync('git',['status','--short'],{cwd:REPO,encoding:'utf8'}),sources:Object.fromEntries(['js/slopes.js','js/city-lighting.js','js/wall-patterns.js'].map(p=>[p,createHash('sha256').update(fs.readFileSync(path.join(REPO,p))).digest('hex')]))};

provenance.sources['js/slopes-apartments.js']=createHash('sha256').update(fs.readFileSync(path.join(REPO,'js/slopes-apartments.js'))).digest('hex');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
if(!opt('--candidate'))throw Error('--candidate full source required');
const candidateSource=fs.readFileSync(opt('--candidate'));
const baselineSource=fs.readFileSync(new URL('roof-study/baseline-wall-patterns.js',import.meta.url));
provenance.candidateSHA256=createHash('sha256').update(candidateSource).digest('hex');
provenance.baselineSHA256=createHash('sha256').update(baselineSource).digest('hex');
provenance.setupSHA256=opt('--setup')?createHash('sha256').update(fs.readFileSync(opt('--setup'))).digest('hex'):null;
const W = +opt('--width', '1280'), H = +opt('--height', '680'), DPR = +opt('--dpr', '1.5');
const REPS = +opt('--reps', '3'), FRAMES = +opt('--frames', '300'), WARM = +opt('--warm', '40');
const FLIGHT = opt('--flight', 'spawn-orbit');
const side = (s, ref) => { const [label, q, g] = s.split('|'); return { label, q: q || '', gfx: g || '', ref }; };
const A = side(opt('--a', 'BEFORE||'), opt('--ref-a', null)), B = side(opt('--b', 'AFTER||'), opt('--ref-b', null));

const C=opt('--c',null)?side(opt('--c',null),opt('--ref-c',null)):null;
const SIDES=[['A',A],['B',B],...(C?[['C',C]]:[])];

const POSES = {
  spawn: { center: [-97.7434, 30.2857], zoom: 16.5, pitch: 74, bearing: 250 },
};
const FLIGHTS = {
  'spawn-orbit': { from: { ...POSES.spawn, bearing: 214 }, to: { ...POSES.spawn, bearing: 286 } },
  'intro-leg2': { from: { center: [-97.7392, 30.2830], zoom: 16.2, pitch: 73, bearing: 188 },
                  to: { center: [-97.7372, 30.2885], zoom: 16.42, pitch: 74, bearing: 200 } },
  'downtown-pan': { from: { center: [-97.7460, 30.2667], zoom: 16.3, pitch: 72, bearing: 25 },
                    to: { center: [-97.7400, 30.2687], zoom: 16.3, pitch: 72, bearing: 25 } },
};
if (!FLIGHTS[FLIGHT]) { console.error('unknown --flight ' + FLIGHT); process.exit(2); }

// --fresh: a new browser for every rep, so each page is the only one its GPU
// process has seen, as a visitor's is. Without it, all reps share one browser,
// and pages after the first measured slower on both sides (2026-09-28: the
// first page 16.8 ms, later ones 24-29 ms, same code).
const FRESH = argv.includes('--fresh');
// --gap <s>: wait this long after each rep's browser is gone before the next.
const GAP_MS = 1000 * +opt('--gap', '0');
const launchOpts = () => ({
  headless: false, gl: 'hardware', maxMs: +(process.env.VERIFY_MAX_MS || 3600000),
  args: [...HW_ARGS, '--disable-gpu-vsync', '--disable-frame-rate-limit',
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion'],
});
const shared = FRESH ? null : await launch(chromium, launchOpts());

const gitCache = new Map();
async function run(s) {
  const browser = shared || await launch(chromium, launchOpts());
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
  const page = await ctx.newPage();
  const errors = [];
  try {
  page.on('pageerror', e => errors.push(e.message));
  page.on('framenavigated', f=>{if(f===page.mainFrame())console.log('[navigation]',s.label,f.url());});
  if (s.ref) {
    const want = p => /^\/(js\/[^?]+\.js|[^/?]+\.html|[^/?]+\.css)$/.test(p);
    await page.route(url => want(new URL(url).pathname), (route, req) => {
      const p = new URL(req.url()).pathname.slice(1), k = s.ref + ':' + p;
      if (!gitCache.has(k)) { try { gitCache.set(k, execFileSync('git', ['show', k], { cwd: REPO, maxBuffer: 64 << 20 })); } catch (e) { gitCache.set(k, null); } }
      const body = gitCache.get(k);
      if (body == null) return route.continue();
      return route.fulfill({ status: 200, contentType: p.endsWith('.js') ? 'application/javascript' : p.endsWith('.css') ? 'text/css' : 'text/html', body });
    });
  }
  await page.route('**/js/wall-patterns.js',route=>route.fulfill({status:200,contentType:'application/javascript',body:s===A?baselineSource:candidateSource}));
  await page.addInitScript(({ gfx, label }) => {
    try {
      const KEY = 'austin3d.gfx.v1';
      const cur = Object.assign({ preset: 'balanced', rev: 3, autoDetected: true }, gfx ? JSON.parse(gfx) : {});
      localStorage.setItem(KEY, JSON.stringify(cur));
    } catch (e) {}
    const t = setInterval(() => { if (window.cancelGraphicsAutoDetect) { window.cancelGraphicsAutoDetect(); clearInterval(t); } }, 20);
    const title = setInterval(() => { if (document.title !== label) document.title = label; }, 250);
    window.addEventListener('beforeunload', () => clearInterval(title));
  }, { gfx: s.gfx, label: s.label });
  const qs = ['intro=0', 'drift=0'].concat(s.q ? [s.q] : []).join('&');
  await page.goto(`${BASE}/index.html?${qs}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => window.__map && window.slopesApartments?.count.done && window.slopesApartments.count.buildings > 0 &&
    window.slopesApartments.readyToReveal(), null, { timeout: 300000, polling: 500 });
  await page.waitForFunction(({ w, h }) => !document.getElementById('veil') &&
    window.__map.getCanvas().width >= w && window.__map.getCanvas().height >= h, { w: Math.floor(W * DPR), h: Math.floor(H * DPR) }, { timeout: 120000, polling: 250 });
  let textureProof=null;
  if(s!==A&&opt('--setup')) {
    await page.addScriptTag({content:fs.readFileSync(opt('--setup'),'utf8')});
    textureProof=await page.evaluate(()=>{
      const materials=new Set();window.slopes.scene.traverse(o=>{for(const m of Array.isArray(o.material)?o.material:[o.material])if(m?.fragmentShader?.includes('vec3 rtFactor('))materials.add(m);});
      if(!materials.size)throw Error('No roof materials attached');
      for(const m of materials){window.__roofExperimentAttach(m,'filter');m.needsUpdate=true;}
      const t=window.__roofMipExperiment;
      return {materials:materials.size,bytes:t.bytes,sourceBytes:t.sourceBytes,bakeMs:t.bakeMs,anisotropy:t.anisotropy};
    });
  }
  if(!textureProof)textureProof=await page.evaluate(()=>{
    const texture=window.slopes.uniforms().u_roofReliefAtlas?.value;
    if(!texture)return null;
    const {width,height,data}=texture.image;
    let w=width,h=height,bytes=0;while(true){bytes+=w*h*4;if(w===1&&h===1)break;w=Math.max(1,w>>1);h=Math.max(1,h>>1);}
    return {width,height,sourceBytes:data.byteLength,mipBytes:bytes,anisotropy:texture.anisotropy,minFilter:texture.minFilter,generateMipmaps:texture.generateMipmaps};
  });
  (provenance.textureProofs??=[]).push({label:s.label,proof:textureProof});
  const res = await page.evaluate(async ({ fl, frames, warm }) => {
    window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect();
    const m = window.__map, gl = m.painter.context.gl;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const lerp = (a, b, t) => a + (b - a) * t;
    const at = t => ({ center: [lerp(fl.from.center[0], fl.to.center[0], t), lerp(fl.from.center[1], fl.to.center[1], t)],
      zoom: lerp(fl.from.zoom, fl.to.zoom, t), pitch: lerp(fl.from.pitch, fl.to.pitch, t), bearing: lerp(fl.from.bearing, fl.to.bearing, t) });
    // prewarm: the whole path once, slowly, so tiles are loaded for both sides alike
    for (let i = 0; i <= 8; i++) {
      m.jumpTo(at(i / 8));
      await new Promise(r => { const t0 = performance.now(); const tick = () => (m.areTilesLoaded() && performance.now() - t0 > 400) || performance.now() - t0 > 8000 ? r() : setTimeout(tick, 100); tick(); });
    }
    m.jumpTo(at(0));
    await new Promise(r => setTimeout(r, 1500));
    const shadowBefore=window.slopes.sunlightStats();
    const dts = [];
    await new Promise(done => {
      let i = 0, last = performance.now();
      const step = () => {
        const now = performance.now();
        if (i > 0) dts.push(now - last);
        last = now;
        if (i >= frames + warm) return done();
        const k = i < warm ? 0 : (i - warm) / frames;
        m.jumpTo(at(k));
        i++;
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    return {
      renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown',
      canvas: m.getCanvas().width + 'x' + m.getCanvas().height,
      shadows:{before:shadowBefore,after:window.slopes.sunlightStats()},
      shaderFailures:window.CityLighting.stats.failures,
      mesh: (()=>{let triangles=0,vertices=0,bytes=0,packedMeshes=0,packedU16Meshes=0;window.slopesApartments.group.traverse(o=>{const g=o.geometry;if(!g?.index)return;triangles+=g.index.count/3;vertices+=g.attributes.position.count;if(g.userData.pack){packedMeshes++;if(g.index.array instanceof Uint16Array)packedU16Meshes++;}bytes+=g.index.array.byteLength;for(const a of Object.values(g.attributes))bytes+=a.array.byteLength;});return {triangles,vertices,bytes,packedMeshes,packedU16Meshes,buildMs:window.slopesApartments.count.ms};})(),
      geometry:window.slopes.stats(),packed:window.slopes.packInfo(),
      antialias: gl.getContextAttributes().antialias, samples: gl.getParameter(gl.SAMPLES),
      graphics:JSON.parse(JSON.stringify(window.GFX)),
      supportedSamples:Array.from(gl.getInternalformatParameter(gl.RENDERBUFFER,gl.RGBA8,gl.SAMPLES)),
      gfx: window.GFX ? { preset: window.GFX.preset, msaa: window.GFX.msaa, renderScale: window.GFX.renderScale } : null,
      aeAsync: window.__ae ? window.__ae().async : null,
      aeLuma: window.__ae ? window.__ae().luma : null,
      gpuGate: window.__gfxGpu || null,
      dts: dts.slice(warm),
    };
  }, { fl: FLIGHTS[FLIGHT], frames: FRAMES, warm: WARM });
  res.errors = errors.slice(0, 3);
  if(res.errors.length || res.shaderFailures.length)throw Error(JSON.stringify({errors:res.errors,shaderFailures:res.shaderFailures}));
  if(new URLSearchParams(s.q).get("packmerge")==="1"&&(!res.mesh.packedMeshes||res.mesh.packedU16Meshes!==res.mesh.packedMeshes))throw Error("Packed merge did not activate");
  if(new URLSearchParams(s.q).has("smooth") && (res.samples>0)!==(new URLSearchParams(s.q).get("smooth")==="1"))throw Error("Requested MSAA did not activate");
  return res;
  } finally {
    await ctx.close();
    if(!shared){await browser.close();await browser.__done();}
    if(GAP_MS)await new Promise(r=>setTimeout(r,GAP_MS));
  }
}

const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]; };
// NVIDIA only: VRAM in use (peak) and the mean graphics clock over the rep,
// from nvidia-smi every 500 ms. A 4 GB card near full pages, and a hot one
// clocks down; either moves frame time more than the change under test.
function nvSample() {
  let proc = null, peak = 0, clocks = [];
  try {
    proc = spawn('nvidia-smi', ['--query-gpu=memory.used,clocks.gr', '--format=csv,noheader,nounits', '-lms', '500'],
      { stdio: ['ignore', 'pipe', 'ignore'] });
    proc.on('error', () => { proc = null; });
    proc.stdout.on('data', d => {
      for (const line of String(d).split(String.fromCharCode(10))) {
        const [m, c] = line.split(',').map(Number);
        if (Number.isFinite(m)) peak = Math.max(peak, m);
        if (Number.isFinite(c)) clocks.push(c);
      }
    });
  } catch (e) { proc = null; }
  return { stop() {
    if (!proc) return null;
    try { proc.kill(); } catch (e) {}
    if (!clocks.length) return null;
    return { peakMiB: peak, clockMHz: Math.round(clocks.reduce((a, b) => a + b, 0) / clocks.length) };
  } };
}
const cpuSnap = () => os.cpus().reduce((a, c) => {
  const t = c.times, busy = t.user + t.nice + t.sys + t.irq;
  a.busy += busy; a.all += busy + t.idle; return a;
}, { busy: 0, all: 0 });
const out = Object.fromEntries(SIDES.map(([k])=>[k,[]]));
for (let r = 0; r < REPS; r++) {
  const order=C?[...SIDES.slice(r%3),...SIDES.slice(0,r%3)]:(r%2?[SIDES[1],SIDES[0]]:SIDES);
  for(const [k,s] of order) {
    const c0 = cpuSnap(), gpuLog = nvSample();
    const res = await run(s);
    const c1 = cpuSnap(), cpu = (c1.busy - c0.busy) / Math.max(1, c1.all - c0.all), nv = gpuLog.stop();
    // mean = wall time / frames. On a GPU that queues frames (ANGLE D3D11 on
    // the AMD iGPU) most rAF ticks are short and every few frames one blocks
    // on the queue, so the median shows the CPU side and a GPU cost lands in
    // the tail. The mean is what the eye gets; report it next to the median.
    const med = q(res.dts, 0.5), p90 = q(res.dts, 0.9), mean = res.dts.reduce((x, y) => x + y, 0) / res.dts.length;
    res.cpu=cpu;res.nv=nv;
    out[k].push({ med, p90, mean, res });
    if(opt('--out',null))fs.writeFileSync(opt('--out'),JSON.stringify({provenance,settings:{A,B,C,W,H,DPR,REPS,FRAMES,WARM,FLIGHT,FRESH,cpuThrottle:1,vsync:false},out},null,2));
    res.nv = nv;
    const gpu = /nvidia/i.test(res.renderer) ? 'NVIDIA' : /amd|radeon/i.test(res.renderer) ? 'AMD' : res.renderer.slice(0, 24);
    console.log(`rep ${r + 1} ${s.label.padEnd(8)} median ${med.toFixed(2)} ms (${(1000 / med).toFixed(1)} fps)  mean ${mean.toFixed(2)} ms  p90 ${p90.toFixed(2)} ms  ` +
      `cpu=${(cpu * 100).toFixed(0)}% ${gpu} ${nv ? `vram peak ${nv.peakMiB} MiB, ${nv.clockMHz} MHz ` : ''}` +
      `${res.canvas} aa=${res.antialias} samples=${res.samples} gfx=${JSON.stringify(res.gfx)} aeAsync=${res.aeAsync} aeLuma=${res.aeLuma == null ? '-' : res.aeLuma.toFixed(4)}${res.gpuGate ? ` gate=${res.gpuGate.full ? 'card' : 'integrated/other'} ${res.gpuGate.ms}ms` : ''} shadows=${JSON.stringify(res.shadows)}${res.errors.length ? '  ERR ' + res.errors.join(' | ') : ''}`);
  }
}
console.log(`renderer: ${out.A[0].res.renderer}`);
console.log(`viewport ${W}x${H} @ DPR ${DPR}, no CPU throttle, vsync off, flight ${FLIGHT}, ${FRAMES} frames/rep after ${WARM} warm-up, ${FRESH ? 'a fresh browser per rep' : 'one browser for all reps'}`);
for (const [k, s] of SIDES) {
  const meds = out[k].map(x => x.med), p90s = out[k].map(x => x.p90), means = out[k].map(x => x.mean);
  console.log(`${s.label.padEnd(8)} frame ms  min-of-medians ${Math.min(...meds).toFixed(2)}  median-of-medians ${q(meds, 0.5).toFixed(2)}  ` +
    `(fps ${(1000 / Math.min(...meds)).toFixed(1)} / ${(1000 / q(meds, 0.5)).toFixed(1)})  p90 min ${Math.min(...p90s).toFixed(2)}  ` +
    `mean min ${Math.min(...means).toFixed(2)} median ${q(means, 0.5).toFixed(2)}`);
}
const diffs = out.B.map((b, i) => b.med - out.A[i].med);
console.log(`${B.label} - ${A.label} per rep: ${diffs.map(d => (d >= 0 ? '+' : '') + d.toFixed(1)).join(' ')} ms  ` +
  `median ${(q(diffs, 0.5) >= 0 ? '+' : '') + q(diffs, 0.5).toFixed(2)} ms, ${B.label} slower in ${diffs.filter(d => d > 0).length} of ${diffs.length}`);
const mdiffs = out.B.map((b, i) => b.mean - out.A[i].mean);
console.log(`${B.label} - ${A.label} mean per rep: ${mdiffs.map(d => (d >= 0 ? '+' : '') + d.toFixed(1)).join(' ')} ms  ` +
  `median ${(q(mdiffs, 0.5) >= 0 ? '+' : '') + q(mdiffs, 0.5).toFixed(2)} ms, ${B.label} slower in ${mdiffs.filter(d => d > 0).length} of ${mdiffs.length}`);
if(C){const ds=out.C.map((c,i)=>c.mean-out.A[i].mean);console.log(`${C.label} - ${A.label} mean per rep: ${ds.map(d=>d.toFixed(2)).join(' ')} ms; min mean ${Math.min(...out.C.map(r=>r.mean)).toFixed(2)}`);}
if (shared) await shared.__done();
