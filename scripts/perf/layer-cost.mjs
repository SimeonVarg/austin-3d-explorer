/**
 * layer-cost.mjs — WHERE does the Blender-building layer's (?gltf=1) frame time go? (written 2026-10-16, branch mac/gltf-layer-cost;
 * a measurement tool, no verdict). layer-speed.mjs says HOW MUCH it costs (two page loads, layer off and on); this says WHICH PART.
 *
 * ONE page load with the layer on (CLAUDE.md rule 13: load once, test many). At each pose the parts of the layer are switched
 * off one at a time from inside the page, the variants interleaved and their order rotated round by round, and for each:
 *   free     the interval between two requestAnimationFrame callbacks, vsync off (p50 over the pass)
 *   cpu      the JS time of the city's three.js layer a frame (window.slopes.layer prerender + render, performance.now around
 *            each): the main thread's own work, the layer's smoothing pass included (WebGL calls are queued, so this is the
 *            JS and the call encoding, not the GPU)
 *   gpu      GPU time of the same two calls (EXT_disjoint_timer_query_webgl2, when the browser has it; null when not)
 *   own      the layer's smoothing pass alone, JS time (GLTF_LAYER.lookOwn.ms)
 *   calls / tris   three.js's draw calls and triangles a frame (renderer.info, summed over every render() of the frame)
 * The variants (each undone before the next):
 *   on         as loaded
 *   off        every full building and every far copy hidden: the layer's whole cost (its hidden recipe buildings stay hidden)
 *   noOwn      the smoothing pass skipped (picture, depth, lay and glass passes); the shadow casters stay
 *   noCast     the shadow casters hidden in the city's own pass (they draw nothing there; the shadow maps are not redrawn
 *              while the camera only turns, so this is their cost in the main pass)
 *   cheap      every full building's picture and glass drawn with a one-colour shader: the cost of the layer's shading
 *   shrink     the same picture draws into boxes 2 % of the size (GLTF_LAYER.lookOwn.shrink): the picture pass's pixels
 *   noPicture  the picture pass draws nothing (its target is still cleared and resolved)
 *   noLay      the depth pass and the lay pass draw nothing
 *   noGlass    the see-through glass pass draws nothing
 *   farOff     the far treatment off (4 samples a pixel at the canvas's pixels for every box)
 *   atlasBig   the atlas with targets of up to 256 MB a sample count (fewer flushes, more memory)
 *   atlasOff   one building at a time (GLTF.look.own.atlas off: two render calls a building, as before the atlas). With the atlas ON
 *              the variants cheap, noPicture, noLay and noGlass do not reach the drawing (they swap the per-building scenes): pass
 *              --query gltfatlas=0 for them.
 *   copies     every row drawn as its far copy (GLTF.look.copy distances set to zero): the floor a level of detail could reach
 * Plus, once per pose with the layer as loaded, a CPU profile of the main thread (2 s, 1 ms sampling) and the share of it in
 * the layer's own functions.
 *
 * SETTINGS (printed): --gl hardware, desktop 1280x800 DPR 1.5 or --phone (390x844 DPR 3, mobile emulation, iPhone user agent:
 * SIMULATED, the GPU is the runner's), --throttle N (CDP CPU throttle: SIMULATED), ?intro=0&drift=0, vsync off, the auto-detect
 * probe cancelled. A reading is the MINIMUM over rounds (CLAUDE.md rule 10), every round shown.
 *
 *   node scripts/perf/layer-cost.mjs --url http://127.0.0.1:8442/ --rounds 4 --out DIR
 */
import fs from 'node:fs';
import path from 'node:path';
import { startChrome, machineLoad } from './lib/cdp.mjs';
import { analyse } from './lib/cpuprofile.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const URL0 = arg('--url', (process.env.VERIFY_URL || 'http://127.0.0.1:8099') + '/');
const GL = arg('--gl', 'hardware');
const PHONE = argv.includes('--phone');
const THROTTLE = +arg('--throttle', 1);
const ROUNDS = +arg('--rounds', 4);
const FRAMES = +arg('--frames', 40);
const WARM = +arg('--warm', 12);
const LABEL = arg('--label', 'layer-cost');
const OUT = arg('--out', process.env.VERIFY_OUT || path.join(process.env.TMPDIR || '/tmp', 'layer-cost'));
const SETTLE = +arg('--settle', 15000);
const MAX = +arg('--max', 600000);
const DEADLINE_MIN = +arg('--deadline-min', 0);
const EXTRA = arg('--query', '');
const VARIANTS = arg('--variants', 'on,off,noOwn,noCast,cheap,shrink,noPicture,noLay,noGlass,farOff,copies').split(',');
const T_START = Date.now();
fs.mkdirSync(OUT, { recursive: true });
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// the same cameras as layer-speed.mjs
const POSES = {
  'spawn':       { center: [-97.7434, 30.2857], zoom: 16.5, pitch: 74, bearing: 250 },
  'start-close': { center: [-97.7434, 30.2857], zoom: 18.6, pitch: 70, bearing: 250 },
  'west-campus': { center: [-97.7445, 30.2880], zoom: 16.6, pitch: 72, bearing: 300 },
  'union-close': { center: [-97.74286, 30.28333], zoom: 18.4, pitch: 68, bearing: 280 },
};
const POSE_NAMES = arg('--poses', Object.keys(POSES).join(',')).split(',');

// ── installed once in the page: the timing wrappers and the variant switches ──
const PAGE_SETUP = `(() => {
  if (window.__LC) return window.__LC.status();
  const S = window.slopes, G = window.GLTF_LAYER, OWN = G.lookOwn, COPY = G.lookCopy, R = S.renderer, gl = R.getContext(), layer = S.layer, T = window.THREE;
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const st = { cpu: 0, gpu: 0, gpuPending: [], frameGpu: [], calls: 0, tris: 0 };
  R.info.autoReset = false;
  // prerender calls this.render(gl, args, true): only the outermost call is timed
  let depth = 0;
  const wrap = (name) => { const f = layer[name]; layer[name] = function () {
    if (depth > 0) return f.apply(this, arguments);
    if (name === 'prerender') { st.cpu = 0; R.info.reset(); }
    let q = null; if (ext) { q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); }
    const t0 = performance.now(); depth++;
    try { return f.apply(this, arguments); }
    finally { depth--; st.cpu += performance.now() - t0; if (q) { gl.endQuery(ext.TIME_ELAPSED_EXT); st.gpuPending.push({ q, frame: st.frame || 0 }); }
      if (name === 'render') { st.calls = R.info.render.calls; st.tris = R.info.render.triangles; } } }; };
  wrap('prerender'); wrap('render');
  // GPU results arrive a few frames late: summed by frame
  const pollGpu = () => {
    if (!ext) return; const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT); const keep = [];
    for (const p of st.gpuPending) { if (gl.getQueryParameter(p.q, gl.QUERY_RESULT_AVAILABLE)) { if (!disjoint) { const ns = gl.getQueryParameter(p.q, gl.QUERY_RESULT); st.byFrame = st.byFrame || new Map(); st.byFrame.set(p.frame, (st.byFrame.get(p.frame) || 0) + ns / 1e6); } gl.deleteQuery(p.q); } else keep.push(p); }
    st.gpuPending = keep;
  };
  const rows = () => (G.info.look && G.info.look.rows) || [];
  const empty = new T.Scene();
  const cheapMat = new T.ShaderMaterial({ side: T.DoubleSide, vertexShader: 'void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }', fragmentShader: 'void main(){ gl_FragColor = vec4(0.55, 0.5, 0.45, 1.0); }' });
  const cheapGlass = new T.ShaderMaterial({ side: T.DoubleSide, transparent: true, depthWrite: false, blending: T.CustomBlending, blendEquation: T.AddEquation, blendSrc: T.ZeroFactor, blendDst: T.SrcColorFactor,
    vertexShader: 'void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }', fragmentShader: 'void main(){ gl_FragColor = vec4(0.8, 0.8, 0.8, 1.0); }' });
  G.look.own.slackFrames = 1e9;   // no target is let go while variants flip (it would be made again: a one-frame cost in the next variant)
  let undo = null;
  const swapScenes = keys => { const saved = []; for (const b of OWN.list) for (const k of keys) { saved.push([b, k, b[k]]); b[k] = empty; } return () => { for (const [b, k, v] of saved) b[k] = v; }; };
  const V = {
    on: () => () => {},
    off: () => { const hid = []; for (const e of rows()) if (e.built && e.built.group.visible) { e.built.group.visible = false; hid.push(e.built.group); } const cg = COPY.group, cv = cg && cg.visible; if (cg) cg.visible = false; return () => { for (const g of hid) g.visible = true; if (cg) cg.visible = cv; }; },
    noOwn: () => { const saved = OWN.list.splice(0); return () => { OWN.list.push(...saved); }; },
    noCast: () => { const hid = []; for (const e of rows()) if (e.built) for (const m of e.built.group.children) if (m.visible) { m.visible = false; hid.push(m); } return () => { for (const m of hid) m.visible = true; }; },
    cheap: () => { const saved = []; for (const b of OWN.list) { for (const m of b.picture.children) { saved.push([m, m.material]); m.material = cheapMat; } for (const m of b.glass.children) { saved.push([m, m.material]); m.material = cheapGlass; } } return () => { for (const [m, mat] of saved) m.material = mat; }; },
    shrink: () => { OWN.shrink = 0.02; return () => { OWN.shrink = 0; }; },
    noPicture: () => swapScenes(['picture']),
    noLay: () => swapScenes(['depth', 'fill']),
    noGlass: () => swapScenes(['glass']),
    farOff: () => { const was = G.look.far.on; G.look.far.on = false; return () => { G.look.far.on = was; }; },
    leanOff: () => { const was = G.look.own.lean; G.look.own.lean = false; return () => { G.look.own.lean = was; }; },
    atlasBig: () => { const was = G.look.own.atlasMB; G.look.own.atlasMB = 256; return () => { G.look.own.atlasMB = was; }; },
    atlasOff: () => { const was = G.look.own.atlas; G.look.own.atlas = false; return () => { G.look.own.atlas = was; }; },
    copies: () => { const C = G.look.copy, a = C.fullM, b = C.farM, f = C.fadeS; C.fullM = 1e-6; C.farM = 2e-6; C.fadeS = 0; return () => { C.fullM = a; C.farM = b; setTimeout(() => { C.fadeS = f; }, 1500); }; },
  };
  const status = () => ({ timer: !!ext, own: OWN.list.length, fullShown: OWN.list.filter(b => b.group && b.group.visible).length, rows: rows().length, loaded: rows().filter(e => e.state === 2).length,
    copiesShown: COPY.shown, ownPixels: OWN.pixels, atlas: !!G.look.own.atlas, ownRenders: OWN.renders, ownFlushes: OWN.flushes, ownMB: Math.round((OWN.bytes || 0) / 1e6), layerTris: G.info.look ? G.info.look.triangles : null,
    shadowMapRenders: S.sunlightStats().shadowMapRenders, tiers: OWN.list.filter(b => b.group && b.group.visible).map(b => (b.samples || 0) + 'x' + (b.scale || 0)).join(' ') });
  window.__LC = {
    status, variants: Object.keys(V),
    set(name) { if (undo) { undo(); undo = null; } undo = V[name](); if (window.__map) window.__map.triggerRepaint(); return status(); },
    async pass(cfg) {
      const m = window.__map; m.jumpTo(cfg.pose);
      const rec = []; let last = null, i = 0; st.byFrame = new Map();
      await new Promise(res => {
        const step = (ts) => {
          pollGpu();
          if (i > 2) rec.push({ dt: ts - last, cpu: st.cpu, own: OWN.ms, renders: OWN.renders, calls: st.calls, tris: st.tris, frame: st.frame });
          last = ts; st.frame = (st.frame || 0) + 1;
          if (i++ >= cfg.n + 2) return res();
          m.jumpTo({ bearing: cfg.pose.bearing + i * 0.12 });
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
      // the last frames' GPU results
      for (let k = 0; k < 20 && st.gpuPending.length; k++) { await new Promise(r => requestAnimationFrame(r)); pollGpu(); }
      // GPU time a frame: prerender and render of one map frame carry the same frame number (summed)
      return { rec, gpu: [...st.byFrame.values()] };
    },
  };
  return status();
})()`;

const pct = (a, q) => { const s = a.filter(x => x != null).sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null; };
const r2 = x => x == null ? null : +x.toFixed(2);

// --shots POSE: no timing; pictures of one pose with variant A and B in turn (A, B, A, B; the second of each is kept), in the same page,
// plus a pixel count of what differs (A against A = the page's own noise; A against B = the change). --width/--height/--dpr set the window.
const SHOTS = arg('--shots', '');
const SHOT_AB = arg('--shot-ab', 'leanOff,on').split(',');
const W = +arg('--width', PHONE ? 390 : 1280), H = +arg('--height', PHONE ? 844 : 800), DPR = +arg('--dpr', PHONE ? 3 : 1.5);
const chrome = await startChrome({ gl: GL, width: W, height: H, vsync: 'off', maxMs: 3000000 });
const result = { label: LABEL, phone: PHONE, throttle: THROTTLE, poses: {}, profiles: {} };
try {
  const page = await chrome.newPage();
  await page.send('Page.enable'); await page.send('Runtime.enable');
  await page.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: PHONE });
  if (PHONE) { await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }); await page.send('Emulation.setUserAgentOverride', { userAgent: IPHONE_UA, platform: 'iPhone' }); }
  if (THROTTLE > 1) await page.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(()=>{const iv=setInterval(()=>{if(window.cancelGraphicsAutoDetect){try{window.cancelGraphicsAutoDetect();window.__acCancelled=performance.now();}catch(e){}clearInterval(iv);}},10);})();` });
  const ev = async (expr) => { const r = await page.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text || 'eval failed'); return r.result.value; };
  const q = ['intro=0', 'drift=0', 'gltf=1', EXTRA].filter(Boolean).join('&');
  const t0 = Date.now();
  await page.send('Page.navigate', { url: URL0 + (URL0.includes('?') ? '&' : '?') + q });
  for (;;) {
    await sleep(1000);
    let s = null; try { s = JSON.parse(await ev(`JSON.stringify({map:!!(window.__map&&window.__map.isStyleLoaded()),veil:!!document.getElementById('veil'),apts:!!(window.slopesApartments&&window.slopesApartments.count&&window.slopesApartments.count.done),gltf:window.GLTF_LAYER?{on:window.GLTF_LAYER.on,ready:window.GLTF_LAYER.ready}:null,own:!!(window.GLTF_LAYER&&window.GLTF_LAYER.lookOwn)})`)); } catch (e) {}
    if (s && s.map && !s.veil && s.apts && s.gltf && s.gltf.on && s.gltf.ready && s.own) break;
    if (Date.now() - t0 > MAX) throw new Error('city not ready within ' + MAX + ' ms: ' + JSON.stringify(s));
  }
  await sleep(SETTLE);
  await ev(`window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect()`);
  result.env = JSON.parse(await ev(`JSON.stringify({ preset: window.GFX && window.GFX.preset, renderScale: window.GFX && window.GFX.renderScale, msaa: window.GFX && window.GFX.msaa, shadows: window.GFX && window.GFX.shadows,
    canvas: [document.querySelector('canvas').width, document.querySelector('canvas').height], dpr: devicePixelRatio, renderer: (()=>{const g=document.createElement('canvas').getContext('webgl');const d=g.getExtension('WEBGL_debug_renderer_info');return d?g.getParameter(d.UNMASKED_RENDERER_WEBGL):null})() })`));
  result.loadMs = Date.now() - t0; result.machine = machineLoad();
  result.setup = await ev(PAGE_SETUP);
  console.error(`[${LABEL}] loaded in ${result.loadMs} ms; ${JSON.stringify(result.env)}; ${JSON.stringify(result.setup)}`);

  if (SHOTS) {
    const pose = POSES[SHOTS];
    await ev(`(async()=>{window.__LC.set('on');window.__map.jumpTo(${JSON.stringify(pose)});for(let i=0;i<240;i++){await new Promise(r=>setTimeout(r,250));if(window.GLTF_LAYER.lookTick())break;}return 0})()`);
    await sleep(8000);
    // the drawing buffer read at the end of a map render (it is still whole then); kept in the page, compared there
    await ev(`(() => { window.__LCgrab = () => new Promise(res => { const m = window.__map, gl = m.painter.context.gl; const f = () => { m.off('render', f); const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, px = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px); res(px); }; m.on('render', f); m.triggerRepaint(); });
      window.__LCdiff = (a, b) => { let n2 = 0, n16 = 0, mx = 0; for (let i = 0; i < a.length; i += 4) { const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])); if (d > 2) n2++; if (d > 16) n16++; if (d > mx) mx = d; } return { pixels: a.length / 4, over2: n2, over16: n16, max: mx }; };
      window.__LCimg = {}; return 0; })()`);
    const shots = {};
    for (const [k, v] of [['A1', SHOT_AB[0]], ['B1', SHOT_AB[1]], ['A2', SHOT_AB[0]], ['B2', SHOT_AB[1]]]) {
      await ev(`window.__LC.set(${JSON.stringify(v)})`); await sleep(2500);
      await ev(`window.__LCgrab().then(px => { window.__LCimg[${JSON.stringify(k)}] = px; return 0; })`);
      const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
      if (k.endsWith('2')) fs.writeFileSync(path.join(OUT, `${LABEL}-${SHOTS}-${v}.png`), Buffer.from(data, 'base64'));
      shots[k] = await ev(`window.__LC.status()`);
    }
    result.shots = { pose: SHOTS, ab: SHOT_AB, window: [W, H, DPR],
      noiseA: await ev(`window.__LCdiff(window.__LCimg.A1, window.__LCimg.A2)`), noiseB: await ev(`window.__LCdiff(window.__LCimg.B1, window.__LCimg.B2)`),
      change: await ev(`window.__LCdiff(window.__LCimg.A2, window.__LCimg.B2)`), status: shots };
    console.error(`[${LABEL}] shots ${JSON.stringify(result.shots)}`);
  }
  for (const name of (SHOTS ? [] : POSE_NAMES)) {
    if (DEADLINE_MIN && Date.now() - T_START > DEADLINE_MIN * 60000) { console.error(`deadline passed: pose ${name} not run`); continue; }
    const pose = POSES[name], cfg = n => JSON.stringify({ pose, n });
    // let the rows for this camera load (by distance), then warm
    await ev(`(async()=>{window.__LC.set('on');window.__map.jumpTo(${JSON.stringify(pose)});for(let i=0;i<240;i++){await new Promise(r=>setTimeout(r,250));if(window.GLTF_LAYER.lookTick())break;}return 0})()`);
    await ev(`window.__LC.pass(${cfg(60)}).then(()=>0)`); await sleep(1500);
    const before = await ev(`window.__LC.status()`);
    // a CPU profile with the layer as loaded
    await page.send('Profiler.enable'); await page.send('Profiler.setSamplingInterval', { interval: 1000 }); await page.send('Profiler.start');
    await ev(`window.__LC.pass(${cfg(PHONE ? 30 : 90)}).then(()=>0)`);
    const { profile } = await page.send('Profiler.stop'); await page.send('Profiler.disable');
    const a = analyse(profile, { top: 30 });
    // inclusive time of the layer's own code and of the city's render, from the same profile
    const nodes = new Map(profile.nodes.map(n => [n.id, n])), parent = new Map(); for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
    const incl = new Map(); const dur = profile.timeDeltas.map((_, i) => (profile.timeDeltas[i + 1] || 0) / 1000);
    profile.samples.forEach((id, i) => { const seen = new Set(); for (let n = id; n != null; n = parent.get(n)) { const cf = nodes.get(n).callFrame; const k = `${cf.functionName || '(anon)'} ${(cf.url || '').replace(/^.*\/(js\/)/, '$1')}:${cf.lineNumber + 1}`; if (seen.has(k)) continue; seen.add(k); incl.set(k, (incl.get(k) || 0) + dur[i]); } });
    result.profiles[name] = { busyMs: a.busyMs, totalMs: a.totalMs, gcMs: a.gcMs, topSelf: a.topSelf.slice(0, 20), topFiles: a.topFiles.slice(0, 10),
      inclusive: [...incl.entries()].filter(([k]) => /js\/(gltf|slopes|city-sky|city-lighting)/.test(k)).sort((x, y) => y[1] - x[1]).slice(0, 25).map(([k, v]) => ({ fn: k, ms: +v.toFixed(1) })) };
    const per = {};
    for (let r = 0; r < ROUNDS; r++) {
      const order = VARIANTS.slice(r % VARIANTS.length).concat(VARIANTS.slice(0, r % VARIANTS.length));
      if (r % 2) order.reverse();
      for (const v of order) {
        const s = await ev(`window.__LC.set(${JSON.stringify(v)})`);
        await sleep(v === 'copies' || v === 'off' ? 1600 : 600);
        await ev(`window.__LC.pass(${cfg(WARM)}).then(()=>0)`);
        const { rec, gpu } = await ev(`window.__LC.pass(${cfg(FRAMES)})`);
        const agg = { free: r2(pct(rec.map(x => x.dt), 0.5)), p95: r2(pct(rec.map(x => x.dt), 0.95)), cpu: r2(pct(rec.map(x => x.cpu), 0.5)), gpu: r2(pct(gpu, 0.5)), gpuN: gpu.length, own: r2(pct(rec.map(x => x.own), 0.5)),
          calls: pct(rec.map(x => x.calls), 0.5), tris: pct(rec.map(x => x.tris), 0.5), renders: pct(rec.map(x => x.renders), 0.5), fullShown: s.fullShown, ownPixels: s.ownPixels };
        (per[v] = per[v] || []).push(agg);
      }
      await ev(`window.__LC.set('on')`);
      console.error(`  [${LABEL}] ${name} round ${r + 1}: ` + VARIANTS.map(v => `${v} ${per[v][r].free}/${per[v][r].cpu}/${per[v][r].gpu}`).join('  '));
    }
    result.poses[name] = { status: before, per };
  }
} finally { await chrome.close(); }

// ── report ──
const out = [];
const e = result.env || {};
out.push(`# layer-cost ${LABEL}  url ${URL0}  gl ${GL}  ${PHONE ? "SIMULATED phone 390x844 DPR3 (the runner's GPU)" : 'desktop 1280x800 DPR1.5'}  CPU throttle ${THROTTLE}x`);
out.push(`renderer ${e.renderer}  preset ${e.preset} renderScale ${e.renderScale} msaa ${e.msaa} shadows ${e.shadows} canvas ${(e.canvas || []).join('x')}  GPU timer ${result.setup && result.setup.timer}`);
out.push(`?intro=0&drift=0&gltf=1${EXTRA ? '&' + EXTRA : ''}  vsync off  ${ROUNDS} rounds, ${FRAMES} frames a variant (warm ${WARM})  load ${result.loadMs} ms  machine ${JSON.stringify(result.machine)}`);
out.push('Columns: min over rounds of the p50. free = frame interval; cpu = JS of the city three.js layer a frame; gpu = GPU time of the same; own = the smoothing pass JS; delta = against `off`.');
const mn = a => { const b = a.filter(x => x != null); return b.length ? Math.min(...b) : null; };
const table = {};
for (const [name, P] of Object.entries(result.poses)) {
  out.push(`\n## ${name}  (${JSON.stringify(P.status)})`);
  out.push('| variant | free ms | free delta | cpu ms | cpu delta | gpu ms | gpu delta | own ms | render calls (smoothing) | draw calls | triangles | free per round |');
  out.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
  const base = k => mn(P.per.off.map(x => x[k]));
  table[name] = {};
  for (const v of VARIANTS) {
    const rs = P.per[v]; if (!rs) continue;
    const m = k => mn(rs.map(x => x[k])), d = k => (m(k) != null && base(k) != null ? (m(k) - base(k) >= 0 ? '+' : '') + (m(k) - base(k)).toFixed(2) : '-');
    table[name][v] = { free: m('free'), cpu: m('cpu'), gpu: m('gpu'), own: m('own'), renders: m('renders'), calls: m('calls'), tris: m('tris') };
    out.push(`| ${v} | ${m('free')} | ${d('free')} | ${m('cpu')} | ${d('cpu')} | ${m('gpu')} | ${d('gpu')} | ${m('own')} | ${m('renders')} | ${m('calls')} | ${m('tris')} | ${rs.map(x => x.free).join(' / ')} |`);
  }
  const p = result.profiles[name];
  if (p) {
    out.push(`\nCPU profile (layer as loaded): busy ${p.busyMs} of ${p.totalMs} ms, GC ${p.gcMs}`);
    out.push('inclusive, the layer and city code: ' + p.inclusive.slice(0, 14).map(x => `${x.fn} ${x.ms}`).join(' | '));
    out.push('top self: ' + p.topSelf.slice(0, 12).map(x => `${x.fn} ${x.selfMs}`).join(' | '));
    out.push('by file: ' + p.topFiles.map(x => `${x.file} ${x.selfMs}`).join(' | '));
  }
}
if (result.shots) { const s = result.shots; out.push(`\n## pictures ${s.pose} at ${s.window.join(' x ')}: ${s.ab[0]} against ${s.ab[1]}`); out.push(`noise ${s.ab[0]} vs itself ${JSON.stringify(s.noiseA)}; noise ${s.ab[1]} vs itself ${JSON.stringify(s.noiseB)}; change ${JSON.stringify(s.change)}`); }
out.push('\nJSON_TABLE ' + JSON.stringify(table));
const text = out.join('\n');
fs.writeFileSync(path.join(OUT, `report-${LABEL}.txt`), text);
fs.writeFileSync(path.join(OUT, `raw-${LABEL}.json`), JSON.stringify(result, null, 1));
console.log(text);
process.exit(Object.keys(result.poses).length || result.shots ? 0 : 1);
