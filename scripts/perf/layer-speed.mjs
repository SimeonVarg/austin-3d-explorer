/**
 * layer-speed.mjs — what does the Blender-building layer (?gltf=1, js/gltf-layer.js) cost in frame time and page memory?
 * (written 2026-10-16, branch mac/layer-speed-table; a measurement tool, no verdict)
 *
 * For each REP and each ARM (layer OFF = the plain URL, layer ON = `&gltf=1`) it starts a FRESH Chrome (empty cache, fresh
 * profile), loads the real city once, cancels the graphics auto-detect probe, waits for the layer to be ready and the
 * city to settle, then visits each POSE in the same page. The arms are interleaved and the order alternates by rep (off,on /
 * on,off / off,on) so a drifting machine hits both arms alike. At a pose the camera turns by a small fixed step a frame
 * (so every frame is a real render), and three passes are run:
 *   warm    discarded (tiles, building files by distance, shader programs settle)
 *   free    measured: the interval between two requestAnimationFrame callbacks, vsync off
 *   stall   measured: a 1x1 gl.readPixels at the end of every map render, which cannot return until the GPU has finished,
 *           so a frame costs CPU + GPU in sequence (the ceiling on the GPU's share)
 * Per pose and arm it reports p50 / p95 of the frame interval and, at the end of the visit to all poses, PAGE MEMORY:
 * the summed resident memory (RSS) of the whole Chrome process tree (`ps`), the page's JS heap, and the GPU's used memory when
 * `nvidia-smi` exists. The layer's own stats (buildings loaded, triangles, draw calls) are read from GLTF_LAYER.stats() so
 * an "ON" arm that drew nothing is visible.
 *
 * SETTINGS (printed with the numbers): --gl hardware (never swiftshader for frame time), the graphics preset the page chose
 * (printed; the auto-detect probe is cancelled so it cannot change it mid-run), `?intro=0&drift=0`, --vsync off,
 * desktop 1280x800 DPR 1.5 or --phone (390x844 DPR 3, mobile emulation, iPhone user agent: SIMULATED, the GPU is still the
 * runner's), --throttle N (CDP CPU throttle on the page's main thread only: SIMULATED), --frames N per pass (default 90).
 * A reading is the MINIMUM over reps (CLAUDE.md rule 10), shown with every rep beside it.
 *
 *   node scripts/perf/layer-speed.mjs --url http://127.0.0.1:8442/ --reps 3 --out DIR
 *   node scripts/perf/layer-speed.mjs --url ... --reps 3 --phone --throttle 4 --frames 40 --label phone4x
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { startChrome, machineLoad } from './lib/cdp.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const URL0 = arg('--url', (process.env.VERIFY_URL || 'http://127.0.0.1:8099') + '/');
const GL = arg('--gl', 'hardware');
const PHONE = argv.includes('--phone');
const THROTTLE = +arg('--throttle', 1);
const REPS = +arg('--reps', 3);
const FRAMES = +arg('--frames', 90);
const WARM_FRAMES = +arg('--warm-frames', Math.max(20, Math.round(FRAMES * 0.6)));
const LABEL = arg('--label', 'layer-speed');
const OUT = arg('--out', process.env.VERIFY_OUT || path.join(process.env.TMPDIR || '/tmp', 'layer-speed'));
const SETTLE = +arg('--settle', 15000);
const MAX = +arg('--max', 600000);
const DEADLINE_MIN = +arg('--deadline-min', 0);       // stop starting new arms after this many minutes and report what is in (0 = no limit)
const T_START = Date.now();
const EXTRA = arg('--query', '');
// --arms off,on,both (2026-10-17, mac/layer-table-505): the arms to visit. off = the plain URL; any other arm turns the layer on with its query
const ARM_QUERY = { off: '', on: 'gltf=1', far400: 'gltf=1&gltffardist=400', cap96: 'gltf=1&gltfatlasmb=96', both: 'gltf=1&gltffardist=400&gltfatlasmb=96',
  // (2026-10-17, mac/gltf-westcampus-cost) the same as `both` with the far copies rebuilt on every change (js/gltf-look.js STILL off): the before arm
  bothOld: 'gltf=1&gltffardist=400&gltfatlasmb=96&gltfcopystill=0' };
const ARMS = arg('--arms', 'off,on').split(',');                 // extra query text for both arms, e.g. skyrig=a
fs.mkdirSync(OUT, { recursive: true });
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// The poses are the app's own cameras (scripts/verify/moire.mjs POSES, js/app.js SPAWN), plus two close views built here.
//   spawn        the opening view: where the app starts (js/app.js SPAWN)
//   start-close  the same ground as the start view, 2.1 zoom levels closer (about 4.3x nearer the walls)
//   west-campus  over West Campus (moire.mjs 'west-campus')
//   union-close  the Union on San Antonio tower (centre of its surveyed outline), seen from the east
//   near-west / near-campus   the two close-ups the #499 numbers were taken at (moire.mjs)
const POSES = {
  'spawn':       { center: [-97.7434, 30.2857], zoom: 16.5, pitch: 74, bearing: 250 },
  'start-close': { center: [-97.7434, 30.2857], zoom: 18.6, pitch: 70, bearing: 250 },
  'west-campus': { center: [-97.7445, 30.2880], zoom: 16.6, pitch: 72, bearing: 300 },
  'union-close': { center: [-97.74286, 30.28333], zoom: 18.4, pitch: 68, bearing: 280 },
  'near-west':   { center: [-97.7447, 30.2885], zoom: 18.6, pitch: 70, bearing: 300 },
  'near-campus': { center: [-97.7392, 30.2858], zoom: 18.8, pitch: 68, bearing: 200 },
};
const POSE_NAMES = arg('--poses', Object.keys(POSES).join(',')).split(',');

// One pass: turn the camera 0.12 degrees a frame at a fixed pose, `n` frames, record the interval between callbacks.
const PAGE_PASS = `(async (cfg) => {
  const m = window.__map;
  m.jumpTo(cfg.pose);
  const gl = m.painter && m.painter.context && m.painter.context.gl;
  let stall = null;
  if (cfg.stall && gl) { const px = new Uint8Array(4); stall = () => { try { gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); } catch (e) {} }; m.on('render', stall); }
  const dts = []; let last = null, i = 0;
  await new Promise(res => {
    const step = (ts) => {
      if (last != null) dts.push(ts - last);
      last = ts;
      if (i++ >= cfg.n + 2) return res();
      m.jumpTo({ bearing: cfg.pose.bearing + i * 0.12 });
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  if (stall) m.off('render', stall);
  return dts.slice(2);
})`;

const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null; };
const r1 = x => x == null ? null : +x.toFixed(1);

function processTreeRssMB(rootPid) {
  try {
    const rows = execFileSync('ps', ['-eo', 'pid=,ppid=,rss='], { encoding: 'utf8' }).trim().split('\n').map(l => l.trim().split(/\s+/).map(Number));
    const kids = new Map(); for (const [pid, ppid, rss] of rows) { if (!kids.has(ppid)) kids.set(ppid, []); kids.get(ppid).push({ pid, rss }); }
    let total = 0; const walk = pid => { for (const k of kids.get(pid) || []) { total += k.rss; walk(k.pid); } };
    const self = rows.find(r => r[0] === rootPid); if (self) total += self[2];
    walk(rootPid);
    return +(total / 1024).toFixed(0);
  } catch (e) { return null; }
}
function gpuUsedMB() {
  try { return +execFileSync('nvidia-smi', ['--query-gpu=memory.used', '--format=csv,noheader,nounits'], { encoding: 'utf8', timeout: 5000 }).trim().split('\n')[0]; } catch (e) { return null; }
}

async function oneArm(rep, arm) {
  const W = PHONE ? 390 : 1280, H = PHONE ? 844 : 800, DPR = PHONE ? 3 : 1.5;
  const chrome = await startChrome({ gl: GL, width: W, height: H, vsync: 'off', maxMs: 1500000 });
  try {
    const page = await chrome.newPage();
    await page.send('Page.enable'); await page.send('Runtime.enable'); await page.send('Performance.enable');
    await page.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: PHONE });
    if (PHONE) { await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }); await page.send('Emulation.setUserAgentOverride', { userAgent: IPHONE_UA, platform: 'iPhone' }); }
    if (THROTTLE > 1) await page.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
    // cancel the graphics auto-detect probe the moment the page defines it (CLAUDE.md rule 10), and again after load
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(()=>{const iv=setInterval(()=>{if(window.cancelGraphicsAutoDetect){try{window.cancelGraphicsAutoDetect();window.__acCancelled=performance.now();}catch(e){}clearInterval(iv);}},10);})();` });
    const ev = async (expr) => { const r = await page.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed'); return r.result.value; };
    const q = ['intro=0', 'drift=0', EXTRA, ARM_QUERY[arm]].filter(Boolean).join('&');
    const t0 = Date.now();
    await page.send('Page.navigate', { url: URL0 + (URL0.includes('?') ? '&' : '?') + q });
    for (;;) {
      await sleep(1000);
      let st = null; try { st = JSON.parse(await ev(`JSON.stringify({map:!!(window.__map&&window.__map.isStyleLoaded()),veil:!!document.getElementById('veil'),apts:!!(window.slopesApartments&&window.slopesApartments.count&&window.slopesApartments.count.done),gltf:window.GLTF_LAYER?{on:window.GLTF_LAYER.on,ready:window.GLTF_LAYER.ready}:null})`)); } catch (e) {}
      if (st && st.map && !st.veil && st.apts && (arm === 'off' || (st.gltf && st.gltf.on && st.gltf.ready))) break;
      if (Date.now() - t0 > MAX) throw new Error('city not ready within ' + MAX + ' ms: ' + JSON.stringify(st));
    }
    await sleep(SETTLE);
    await ev(`window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect()`);
    const env = JSON.parse(await ev(`JSON.stringify({
      preset: window.GFX && window.GFX.preset, renderScale: window.GFX && window.GFX.renderScale, msaa: window.GFX && window.GFX.msaa, shadows: window.GFX && window.GFX.shadows, ao: window.GFX && window.GFX.ao,
      bloom: window.GFX && window.GFX.bloom, renderDistance: window.GFX && window.GFX.renderDistance,
      lite: window.LITE_PROFILE && { on: window.LITE_PROFILE.on, tier: window.LITE_PROFILE.tierName },
      canvas: [document.querySelector('canvas').width, document.querySelector('canvas').height], dpr: devicePixelRatio,
      autodetectCancelledAtMs: window.__acCancelled || null,
      gltf: window.GLTF_LAYER ? { on: window.GLTF_LAYER.on, light: window.GLTF_LAYER.look && window.GLTF_LAYER.look.on } : null })`));
    const gpuRenderer = await ev(`(()=>{const g=document.createElement('canvas').getContext('webgl');const d=g.getExtension('WEBGL_debug_renderer_info');return d?g.getParameter(d.UNMASKED_RENDERER_WEBGL):null})()`);
    const res = { rep, arm, env, gpuRenderer, machine: machineLoad(), loadMs: Date.now() - t0, poses: {} };
    res.memAfterLoad = { rssMB: processTreeRssMB(chrome.pid), gpuMB: gpuUsedMB() };
    for (const name of POSE_NAMES) {
      const pose = POSES[name];
      await ev(`${PAGE_PASS}(${JSON.stringify({ pose, n: WARM_FRAMES, stall: false })}).then(()=>0)`);
      await sleep(1500);
      const out = {};
      for (const pass of ['free', 'stall']) {
        const dts = await ev(`${PAGE_PASS}(${JSON.stringify({ pose, n: FRAMES, stall: pass === 'stall' })}).then(r=>JSON.stringify(r))`).then(JSON.parse);
        out[pass] = { n: dts.length, p50: r1(pct(dts, 0.5)), p95: r1(pct(dts, 0.95)), max: r1(Math.max(...dts)) };
      }
      out.gltf = await ev(`(()=>{try{const G=window.GLTF_LAYER;if(!G||!G.on)return null;const O=G.lookOwn,C=G.lookCopy;return{fullShown:O.list.filter(b=>b.group&&b.group.visible).length,copiesShown:C.shown,needMB:O.needMB,ownMB:Math.round((O.bytes||0)/1e6),layerTris:G.info.look?G.info.look.triangles:null}}catch(e){return{err:String(e)}}})()`);
      res.poses[name] = out;
      console.error(`  [rep ${rep} ${arm}] ${name}: free p50 ${out.free.p50} p95 ${out.free.p95} | stall p50 ${out.stall.p50} p95 ${out.stall.p95}${out.gltf ? ' | layer ' + JSON.stringify(out.gltf) : ''}`);
    }
    const hu = await page.send('Runtime.getHeapUsage');
    res.memEnd = { rssMB: processTreeRssMB(chrome.pid), gpuMB: gpuUsedMB(), jsHeapMB: +(hu.usedSize / 2 ** 20).toFixed(0) };
    res.machineAfter = machineLoad();
    return res;
  } finally { await chrome.close(); }
}

const results = [];
for (let rep = 1; rep <= REPS; rep++) {
  const k = (rep - 1) % ARMS.length, order = ARMS.slice(k).concat(ARMS.slice(0, k));   // rotated each rep: every arm takes every place
  if (rep % 2 === 0) order.reverse();
  for (const arm of order) {
    if (DEADLINE_MIN && Date.now() - T_START > DEADLINE_MIN * 60000) { console.error(`deadline ${DEADLINE_MIN} min passed: rep ${rep} ${arm} NOT run`); continue; }
    try { const r = await oneArm(rep, arm); results.push(r); fs.writeFileSync(path.join(OUT, `${LABEL}-r${rep}-${arm}.json`), JSON.stringify(r, null, 1)); console.error(`rep ${rep} ${arm} done`); }
    catch (e) { console.error(`rep ${rep} ${arm} FAILED: ${e.stack || e}`); }
  }
}

// ── report ──
const out = [];
const any = results[0];
if (any) {
  const e = any.env;
  out.push(`# layer-speed  url ${URL0}  gl ${GL}  ${PHONE ? 'SIMULATED phone: 390x844 DPR3 mobile emulation (iPhone user agent), the GPU is the runner\'s' : 'desktop 1280x800 DPR1.5'}  CPU throttle ${THROTTLE}x${THROTTLE > 1 ? ' (SIMULATED: CDP throttle on the page main thread only)' : ''}`);
  out.push(`renderer ${any.gpuRenderer}`);
  out.push(`preset ${e.preset}  renderScale ${e.renderScale} msaa ${e.msaa} shadows ${e.shadows} ao ${e.ao} bloom ${e.bloom} renderDistance ${e.renderDistance}  canvas ${e.canvas.join('x')}  phone tier ${JSON.stringify(e.lite)}`);
  out.push(`arms ${ARMS.map(a => a + '=[' + ARM_QUERY[a] + ']').join(' ')}  ?intro=0&drift=0${EXTRA ? '&' + EXTRA : ''}  vsync off  frames/pass ${FRAMES} (warm ${WARM_FRAMES}, discarded)  camera turns 0.12 deg/frame at a fixed pose  auto-detect cancelled at ms ${results.map(r => Math.round(r.env.autodetectCancelledAtMs)).join(',')}`);
  out.push(`load average at arm start (in run order): ${results.map(r => r.arm + ':' + r.machine.load1).join(', ')}  cpus ${any.machine.cpus}`);
  out.push(`load time ms (cold, fresh Chrome, in run order): ${results.map(r => r.arm + ':' + r.loadMs).join(', ')}`);
}
const arms = a => results.filter(r => r.arm === a);
const mn = a => a.length ? Math.min(...a) : null;
const ON_ARMS = ARMS.filter(a => a !== 'off');
out.push('\n| pose | pass | arm | OFF min p50 ms | ON min p50 ms | change | OFF min p95 | ON min p95 | per-rep p50 OFF | per-rep p50 ON | layer drew (last rep, last visit of the pose) |');
out.push('|---|---|---|---|---|---|---|---|---|---|---|');
const table = [];
for (const name of POSE_NAMES) for (const pass of ['free', 'stall']) for (const arm of ON_ARMS) {
  const o = arms('off').map(r => r.poses[name]?.[pass]).filter(Boolean), n = arms(arm).map(r => r.poses[name]?.[pass]).filter(Boolean);
  if (!o.length || !n.length) continue;
  const o50 = mn(o.map(x => x.p50)), n50 = mn(n.map(x => x.p50));
  const g = arms(arm).map(r => r.poses[name]?.gltf).filter(Boolean).slice(-1)[0];
  const change = ((n50 / o50 - 1) * 100);
  table.push({ name, pass, arm, o50, n50, change });
  out.push(`| ${name} | ${pass} | ${arm} | ${o50} | ${n50} | ${change >= 0 ? '+' : ''}${change.toFixed(0)} % | ${mn(o.map(x => x.p95))} | ${mn(n.map(x => x.p95))} | ${o.map(x => x.p50).join(' / ')} | ${n.map(x => x.p50).join(' / ')} | ${g ? g.fullShown + ' full, ' + g.copiesShown + ' far copies, targets ' + g.needMB + ' MB (held ' + g.ownMB + '), ' + Math.round(g.layerTris / 1000) + 'k tris' : '-'} |`);
}
out.push('\n| memory | ' + ARMS.join(' | ') + ' |');
out.push('|---|' + ARMS.map(() => '---').join('|') + '|');
const memRow = (label, f) => out.push(`| ${label} | ` + ARMS.map(a => { const v = arms(a).map(f).filter(x => x != null); return `min ${mn(v)} (reps ${v.join(' / ')})`; }).join(' | ') + ' |');
memRow('Chrome process tree RSS after load, MB', r => r.memAfterLoad.rssMB);
memRow('Chrome process tree RSS after all poses, MB', r => r.memEnd.rssMB);
memRow('JS heap after all poses, MB', r => r.memEnd.jsHeapMB);
memRow('GPU memory used after all poses, MB (whole card)', r => r.memEnd.gpuMB);
out.push('\nJSON_TABLE ' + JSON.stringify(table));
const text = out.join('\n');
fs.writeFileSync(path.join(OUT, `report-${LABEL}.txt`), text);
console.log(text);
process.exit(results.length ? 0 : 1);
