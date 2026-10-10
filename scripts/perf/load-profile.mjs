/**
 * load-profile.mjs — where does a COLD LOAD of the real city go? (written 2026-10-09)
 *
 * Measures, per repetition, in a FRESH Chrome with an EMPTY cache (so "cold" is real):
 *   - network: every request of the page AND of MapLibre's/our workers (CDP auto-attach), by category,
 *     with bytes on the wire (encodedDataLength) and decoded bytes. serve.py does not compress, so for a
 *     local URL the wire bytes are the raw bytes; `gzipKB`/`brKB` are computed from the same files for
 *     what Vercel would send. Point --url at the production site to see its real encoding.
 *   - marks: first map render, first idle, authored apartments done/ready, intro reveal ("city ready",
 *     the veil lifting), veil gone, DOMContentLoaded/load, first paint.
 *   - phases: the app's own console build lines, timed wrappers on every init and apply pass, long tasks.
 *   - main-thread CPU profile (Profiler domain, --profile), saved as .cpuprofile, summarised by
 *     lib/cpuprofile.mjs (top self-time functions, by file, named phases).
 *   - Performance.getMetrics (script, layout, style, task seconds), JS heap, GL draw/texture/buffer counts.
 *   - --trace: a Tracing run summing V8 compile/parse and script evaluation per file.
 *
 * SETTINGS THAT COLOUR THE NUMBERS (printed with every result; quote them with the number):
 *   --throttle N   CDP Emulation.setCPUThrottlingRate on the PAGE main thread only. Workers are NOT slowed.
 *                  1 = none. 4 stands for a phone-class CPU (it is a crude stand-in, not a phone).
 *   --gl hardware|swiftshader   hardware = the machine's GPU through ANGLE. Software rendering is never
 *                  valid for frame time and loads the CPU the page needs: use it only to make a point.
 *   --phone        390x844, DPR 3, touch, mobile emulation, iPhone user agent (js/mobile.js picks the
 *                  phone profile from these). Desktop default: 1280x800, DPR 1.5.
 *   ?drift=0       always on (the idle cinema would move the camera after 25 s, scripts/verify/README.md).
 *   graphics auto-detect probe is cancelled unless --autodetect (it rewrites every setting at ~11 s).
 *   profiler sampling 1000 us when --profile; a profiled run is SLOWER than an unprofiled one, so the
 *   load-time table uses unprofiled reps and the profile tables come from separate profiled reps.
 *
 * Arms (throttles) run interleaved: A B A B ... one fresh Chrome per rep. Report = min / median / max.
 *
 *   node scripts/perf/load-profile.mjs --url http://127.0.0.1:8473/ --throttle 1,4 --reps 5 --out DIR
 *   node scripts/perf/load-profile.mjs --url ... --throttle 1,4 --reps 2 --profile --out DIR
 *   node scripts/perf/load-profile.mjs --url ... --throttle 1 --reps 3 --trace --out DIR
 *   one pair per gpu-run slot, so other browser users can interleave:  --reps 1 --rep-offset K (K = 0, 1, 2 ...)
 *   print the report from rep files already in DIR (no browser):  --from DIR [--match REGEX] [--throttle 1,4]
 *
 * Run through the machine's browser queue:
 *   node ~/Projects/astra-pipe/tools/gpu-run.mjs --label speed -- node scripts/perf/load-profile.mjs ...
 * On a Mac that is also somebody's computer, --require-idle SECONDS (default 600 with --gl hardware)
 * waits until the keyboard has been quiet that long before each rep.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { startChrome, machineLoad, idleSeconds } from './lib/cdp.mjs';
import { analyse, formatTop } from './lib/cpuprofile.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const flag = k => argv.includes(k);

const URL0 = arg('--url', (process.env.VERIFY_URL || 'http://127.0.0.1:8099') + '/');
const THROTTLES = arg('--throttle', '1').split(',').map(Number);
const REPS = +arg('--reps', 3);
const GL = arg('--gl', 'hardware');
const PHONE = flag('--phone');
const PROFILE = flag('--profile');
const TRACE = flag('--trace');
const WARM = flag('--warm');
const QUERY = arg('--query', 'drift=0');
// --arms 'old=drift=0&veilgate=full|new=drift=0': several URL variants of ONE build, interleaved with the throttles
// (A/B on one checkout: every threshold in the app has a URL switch). Without it there is a single arm named ''.
const ARMS = arg('--arms', '') ? arg('--arms', '').split('|').map(a => { const i = a.indexOf('='); return { name: a.slice(0, i), query: a.slice(i + 1) }; }) : [{ name: '', query: QUERY }];
const SETTLE = +arg('--settle', 6000);
const MAX = +arg('--max', 420000);
const OUT = arg('--out', process.env.VERIFY_OUT || path.join(process.env.TMPDIR || '/tmp', 'load-profile'));
const REQUIRE_IDLE = +arg('--require-idle', GL === 'hardware' ? 600 : 0);
const AUTODETECT = flag('--autodetect');
const LABEL = arg('--label', '');
const OFFSET = +arg('--rep-offset', 0);
const FROM = arg('--from', '');
const MATCH = new RegExp(arg('--match', '^t\\d+-r\\d+\\.json$'));
fs.mkdirSync(OUT, { recursive: true });

const WRAP = ['quantiseFacades', 'quantisePartFacades', 'mergeCapitolScene', 'applyUnion24', 'buildFacadeAtlas', 'treeFilter',
  'initArts', 'initCampusStoreys', 'initCapitol', 'initDrag', 'initEntrances', 'initFacades', 'initGraphics', 'initGround', 'initHeroes',
  'initLOD', 'initMoody', 'initNameLabels', 'initNight', 'initOuter', 'initPlaces', 'initProps', 'initRoofscape', 'initShadows', 'initSigns',
  'initSky', 'initSlopes', 'initTileLodCache', 'initTower', 'initWestcampus', 'applyTimeOfDay', 'applyGraphics', 'applySlopesApartments',
  'applySlopesRoofs', 'applySlopesArt', 'applySlopesDome', 'applySlopesArches', 'applyLOD'];
const INSTRUMENT = fs.readFileSync(path.join(HERE, 'lib/instrument.js'), 'utf8');
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };

function classify(u) {
  let url; try { url = new URL(u); } catch (e) { return 'other'; }
  const base = new URL(URL0);
  const p = url.pathname;
  if (url.host !== base.host) {
    if (/unpkg|cdn|jsdelivr/.test(url.host)) return 'third-party libraries (CDN)';
    return 'other hosts (basemap tiles/style/fonts)';
  }
  if (/\.pmtiles$/.test(p)) return 'own pmtiles (range reads)';
  if (/^\/js\//.test(p)) return 'own js';
  if (/^\/data\/.*\.(geojson|json)$/.test(p)) return 'own data json/geojson';
  if (/^\/data\//.test(p)) return 'own data other';
  if (/\.(png|jpg|jpeg|webp|svg|ico)$/.test(p)) return 'own images';
  if (/\.(css)$/.test(p)) return 'own css';
  if (/\.(html)$/.test(p) || p === '/') return 'own html';
  if (/^\/vendor\//.test(p)) return 'own vendor';
  return 'own other';
}

async function runOnce(throttle, rep, { profile, trace, warm, arm }) {
  const label = `${arm.name ? arm.name + '-' : ''}t${throttle}${profile ? 'p' : ''}${trace ? 'tr' : ''}-r${rep}`;
  if (REQUIRE_IDLE) {
    for (let waited = 0; ; waited += 15) {
      const idle = await idleSeconds();
      if (idle == null || idle >= REQUIRE_IDLE) break;
      if (waited % 60 === 0) console.error(`[${label}] owner active ${idle}s ago; waiting for ${REQUIRE_IDLE}s of quiet...`);
      await sleep(15000);
    }
  }
  const loadBefore = machineLoad();
  const W = PHONE ? 390 : 1280, H = PHONE ? 844 : 800, DPR = PHONE ? 3 : 1.5;
  const chrome = await startChrome({ gl: GL, width: W, height: H, vsync: 'off', maxMs: MAX + 120000 });
  const page = await chrome.newPage();
  const reqs = new Map();
  const wireNet = (s, kind) => {
    s.on('Network.requestWillBeSent', e => { reqs.set(`${s.sessionId}:${e.requestId}`, { url: e.request.url, type: e.type, kind, t: e.timestamp, range: !!(e.request.headers.Range || e.request.headers.range), enc: 0, dec: 0 }); });
    s.on('Network.responseReceived', e => { const r = reqs.get(`${s.sessionId}:${e.requestId}`); if (r) { r.status = e.response.status; r.mime = e.response.mimeType; r.fromCache = !!(e.response.fromDiskCache || e.response.fromPrefetchCache); r.cenc = (e.response.headers['content-encoding'] || e.response.headers['Content-Encoding'] || ''); } });
    s.on('Network.dataReceived', e => { const r = reqs.get(`${s.sessionId}:${e.requestId}`); if (r) r.dec += e.dataLength; });
    s.on('Network.loadingFinished', e => { const r = reqs.get(`${s.sessionId}:${e.requestId}`); if (r) { r.enc = e.encodedDataLength; r.done = e.timestamp; } });
    s.on('Network.loadingFailed', e => { const r = reqs.get(`${s.sessionId}:${e.requestId}`); if (r) { r.failed = e.errorText; } });
  };
  const workerProfiles = [];
  try {
    await page.send('Page.enable'); await page.send('Runtime.enable'); await page.send('Network.enable');
    await page.send('Performance.enable');
    wireNet(page, 'page');
    await chrome.followWorkers(page, async (child, info) => {
      await child.send('Network.enable'); wireNet(child, 'worker');
      if (profile && info.type === 'worker') { await child.send('Profiler.enable'); await child.send('Profiler.setSamplingInterval', { interval: 1000 }); await child.send('Profiler.start'); workerProfiles.push({ child, info }); }
    });
    await page.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: PHONE });
    if (PHONE) { await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }); await page.send('Emulation.setUserAgentOverride', { userAgent: IPHONE_UA, platform: 'iPhone' }); }
    if (throttle > 1) await page.send('Emulation.setCPUThrottlingRate', { rate: throttle });
    const cfg = `window.__PERF_CFG=${JSON.stringify({ wrap: WRAP, autodetect: AUTODETECT })};`;
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: cfg + INSTRUMENT });
    let traceEvents = null;
    if (trace) {
      traceEvents = [];
      chrome.root.on('Tracing.dataCollected', e => { for (const ev of e.value) traceEvents.push(ev); });
      await chrome.root.send('Tracing.start', { categories: 'devtools.timeline,v8,disabled-by-default-v8.compile,v8.compile,blink.user_timing', transferMode: 'ReportEvents' }).catch(() => {});
    }
    if (profile) { await page.send('Profiler.enable'); await page.send('Profiler.setSamplingInterval', { interval: 1000 }); await page.send('Profiler.start'); }

    const url = URL0 + (URL0.includes('?') ? '&' : '?') + arm.query;
    const tNav = Date.now();
    await page.send('Page.navigate', { url });
    // wait: reveal + apartments done, then SETTLE ms, or MAX
    let state = null;
    for (;;) {
      await sleep(500);
      try {
        const r = await page.send('Runtime.evaluate', { expression: 'JSON.stringify({m:window.__perf&&window.__perf.marks,now:performance.now()})', returnByValue: true });
        state = JSON.parse(r.result.value || 'null');
      } catch (e) { state = null; }
      if (state && state.m && state.m.introReveal && state.m.apartmentsDone && state.now - Math.max(state.m.introReveal, state.m.apartmentsDone) >= SETTLE) break;
      if (Date.now() - tNav > MAX) { console.error(`[${label}] hit the ${MAX} ms ceiling before ready`); break; }
    }
    const wallToEnd = Date.now() - tNav;
    // collect
    const ev = async (expr) => (await page.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
    let prof = null, analysis = null;
    if (profile) {
      prof = (await page.send('Profiler.stop')).profile;
      analysis = analyse(prof, { top: 30 });
      fs.writeFileSync(path.join(OUT, `${label}.cpuprofile`), JSON.stringify(prof));
      const wsum = [];
      for (const w of workerProfiles) { try { const p = (await w.child.send('Profiler.stop')).profile; const a = analyse(p, { top: 8 }); wsum.push({ url: w.info.url.slice(-60), busyMs: a.busyMs, totalMs: a.totalMs, top: a.topSelf.slice(0, 4) }); } catch (e) {} }
      analysis.workers = wsum;
    }
    let traceSummary = null;
    if (trace) {
      await new Promise(res => { chrome.root.on('Tracing.tracingComplete', res); chrome.root.send('Tracing.end').catch(res); setTimeout(res, 60000); });
      traceSummary = summariseTrace(traceEvents);
    }
    const data = JSON.parse(await ev(`JSON.stringify((()=>{
      const P=window.__perf, nav=performance.getEntriesByType('navigation')[0]||{};
      const A=window.slopesApartments, ap=A&&A.count;
      let gfx=null; try{ gfx={preset:window.GFX&&window.GFX.preset||null, tier:window.__gfxGpu&&window.__gfxGpu.tier||null, renderer: window.__gfxGpu&&window.__gfxGpu.renderer||null}; }catch(e){}
      const gl=document.createElement('canvas').getContext('webgl'); const dbg=gl&&gl.getExtension('WEBGL_debug_renderer_info');
      return {
        marks:P.marks, calls:P.calls, log:P.log, long:P.long, paints:P.paints, src:P.src, fetches:P.fetches.length,
        nav:{dcl:nav.domContentLoadedEventEnd, load:nav.loadEventEnd, responseEnd:nav.responseEnd},
        intro: window.__intro?{waitedMs:window.__intro.waitedMs, reason:window.__intro.reason, missingAtLift:window.__intro.missingAtLift, gateOkAt:window.__intro.gateOkAt, gates:window.__intro.gates||null}:null,
        apartments: ap?{buildings:ap.buildings, blocks:ap.blocks, faces:ap.faces, cells:ap.cells, triangles:ap.triangles, ms:ap.ms, slices:ap.buildSlices, done:ap.done}:null,
        facadePace: window.__facadePace||null, loading: window.__loading?{started:window.__loading.started,complete:window.__loading.complete,n:(window.__loading.history||[]).length}:null,
        gfx, gpuRenderer: dbg?gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL):null,
        gl:{draws:P.gl.draws,tris:Math.round(P.gl.tris),tex:P.gl.texBytes,buf:P.gl.bufBytes,peak:P.gl.peak,own:P.gl.own,calls:P.gl.calls},
        frames:{n:P.frames.length, over50:P.frames.filter(x=>x>50).length, over200:P.frames.filter(x=>x>200).length, max:Math.max(0,...P.frames.slice(0,100000))},
        url:location.href, dpr:devicePixelRatio, vw:innerWidth, vh:innerHeight, ua:navigator.userAgent.slice(0,60)
      };})())`));
    const metrics = Object.fromEntries((await page.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
    let heap = null; try { heap = await page.send('Runtime.getHeapUsage'); } catch (e) {}
    const net = summariseNet(reqs);
    // warm: navigate again in the same browser (HTTP cache and V8 code cache warm)
    let warmRes = null;
    if (warm) {
      reqs.clear();
      await page.send('Page.navigate', { url: 'about:blank' }); await sleep(500);
      const t1 = Date.now();
      await page.send('Page.navigate', { url });
      for (;;) {
        await sleep(500);
        let st = null; try { st = JSON.parse((await page.send('Runtime.evaluate', { expression: 'JSON.stringify({m:window.__perf&&window.__perf.marks})', returnByValue: true })).result.value); } catch (e) {}
        if (st && st.m && st.m.introReveal && st.m.apartmentsDone) { warmRes = { marks: st.m, net: summariseNet(reqs) }; break; }
        if (Date.now() - t1 > MAX) { warmRes = { timeout: true, net: summariseNet(reqs) }; break; }
      }
    }
    const loadAfter = machineLoad();
    const res = { label, rep, throttle, profile: !!profile, trace: !!trace, gl: GL, phone: PHONE, query: arm.query, arm: arm.name, settleMs: SETTLE, wallToEndMs: wallToEnd,
      chrome: chrome.version.product, machine: { before: loadBefore, after: loadAfter }, ...data, cdpMetrics: metrics, heap, net, analysis, traceSummary, warm: warmRes };
    fs.writeFileSync(path.join(OUT, `${label}.json`), JSON.stringify(res, null, 1));
    return res;
  } finally {
    await chrome.close();
  }
}

function summariseNet(reqs) {
  const cats = {};
  const files = [];
  let total = { n: 0, enc: 0, dec: 0 };
  for (const r of reqs.values()) {
    if (r.failed && !r.dec) continue;
    const c = classify(r.url);
    const e = cats[c] || (cats[c] = { n: 0, enc: 0, dec: 0, cached: 0, fromWorkers: 0, ranges: 0 });
    e.n++; e.enc += r.enc || 0; e.dec += r.dec || 0; if (r.fromCache) e.cached++; if (r.kind === 'worker') e.fromWorkers++; if (r.range) e.ranges++;
    total.n++; total.enc += r.enc || 0; total.dec += r.dec || 0;
    files.push({ url: r.url.replace(/^https?:\/\/[^/]+/, (m) => m.includes('127.0.0.1') ? '' : m), kind: r.kind, enc: r.enc || 0, dec: r.dec || 0, status: r.status, cached: !!r.fromCache, range: r.range, cenc: r.cenc || '' });
  }
  // compressed estimate for same-origin files that sit in the repo (what a compressing host would send)
  const est = {};
  const seen = new Set();
  for (const f of files) {
    if (f.url.startsWith('http') || f.range || seen.has(f.url)) continue;
    seen.add(f.url);
    const p = path.join(REPO, f.url.split('?')[0]);
    try {
      const b = fs.readFileSync(p); const c = classify(new URL(f.url, URL0).href);
      if (/\.(pmtiles|png|jpg|jpeg|webp|woff2?)$/.test(p)) { f.gz = f.br = b.length; } else { f.gz = zlib.gzipSync(b, { level: 6 }).length; f.br = zlib.brotliCompressSync(b, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 6 } }).length; }
      const e = est[c] || (est[c] = { raw: 0, gz: 0, br: 0 }); e.raw += b.length; e.gz += f.gz; e.br += f.br;
    } catch (e) {}
  }
  files.sort((a, b) => b.dec - a.dec);
  return { total, cats, est, top: files.slice(0, 40) };
}

function summariseTrace(events) {
  // main thread of the renderer = the thread that ran EvaluateScript / FunctionCall
  const agg = {};
  const addTo = (k, d) => { agg[k] = agg[k] || { ms: 0, n: 0 }; agg[k].ms += d / 1000; agg[k].n++; };
  const perScript = {};
  for (const ev of events) {
    if (ev.ph !== 'X' || ev.dur == null) continue;
    const n = ev.name;
    if (/^(v8\.compile|V8\.CompileLazy|V8\.CompileCode|V8\.ParseFunction|V8\.ParseProgram|V8\.CompileScript|V8\.Compile|V8\.CompileFullCode|V8\.CompileIgnition|V8\.Parse|V8\.DeserializeCodeCache|v8\.produceCache|v8\.parseOnBackground|V8\.CompileBackground.*|v8\.compile.*|EvaluateScript|v8\.run|FunctionCall|FireAnimationFrame|MajorGC|MinorGC|V8\.GC_.*|ParseHTML|UpdateLayoutTree|Layout|RunTask|XHRLoad|TimerFire|HitTest|Paint|CompositeLayers)$/.test(n)) {
      addTo(n + (ev.cat && /background/i.test(ev.name) ? ' (bg thread)' : ''), ev.dur);
      const u = ev.args && ev.args.data && (ev.args.data.url || ev.args.fileName);
      if (u && /(v8\.compile|EvaluateScript|CompileScript)/.test(n)) { const k = n + ' ' + u.replace(/^https?:\/\/[^/]+\//, ''); perScript[k] = (perScript[k] || 0) + ev.dur / 1000; }
    }
  }
  const byName = Object.fromEntries(Object.entries(agg).map(([k, v]) => [k, { ms: +v.ms.toFixed(1), n: v.n }]));
  const top = Object.entries(perScript).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => [k, +v.toFixed(1)]);
  return { events: events.length, byName, topScripts: top };
}

// ---------------------------------------------------------------------------------------------
const results = [];
const plan = [];
const nonProfile = !PROFILE && !TRACE;
for (let r = OFFSET + 1; r <= OFFSET + REPS; r++) {
  const groups = THROTTLES.flatMap(t => ARMS.map(arm => ({ t, arm })));
  const order = r % 2 ? groups : [...groups].reverse();   // A B, then B A: counterbalanced
  for (const g of order) plan.push({ t: g.t, arm: g.arm, r });
}
console.error(`load-profile: ${plan.length} loads, url ${URL0}, gl ${GL}${PHONE ? ', phone' : ''}${PROFILE ? ', profiled' : ''}${TRACE ? ', traced' : ''}`);
if (FROM) { for (const f of fs.readdirSync(FROM).sort()) if (MATCH.test(f)) results.push(JSON.parse(fs.readFileSync(path.join(FROM, f), 'utf8'))); }
for (const { t, r, arm } of FROM ? [] : plan) {
  const t0 = Date.now();
  try {
    const res = await runOnce(t, r, { profile: PROFILE, trace: TRACE, warm: WARM && t === THROTTLES[0] && arm === ARMS[0], arm });
    results.push(res);
    const m = res.marks || {};
    console.error(`  ${res.label}: reveal ${m.introReveal ?? '-'} ms, apartmentsDone ${m.apartmentsDone ?? '-'}, firstRender ${m.mapFirstRender ?? '-'}, load avg ${res.machine.before.load1}->${res.machine.after.load1}, renderer ${res.gpuRenderer}, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  } catch (e) { console.error(`  t${t}-r${r} FAILED: ${e.stack || e}`); }
}

// ---- report
if (FROM) { const ts = [...new Set(results.map(r => r.throttle))].sort((a, b) => a - b); THROTTLES.length = 0; THROTTLES.push(...ts); const an = [...new Set(results.map(r => r.arm || ''))]; ARMS.length = 0; ARMS.push(...an.map(name => ({ name, query: '' }))); }
const out = [];
const fmt = n => n == null ? '-' : String(Math.round(n));
const stat = (arr) => arr.length ? `${fmt(Math.min(...arr))} / ${fmt(med(arr))} / ${fmt(Math.max(...arr))}` : '-';
const rows = [
  ['first paint (DOM)', r => (r.paints.find(p => p[0] === 'first-paint') || [])[1]],
  ['DOMContentLoaded', r => r.nav.dcl],
  ['load event', r => r.nav.load],
  ['map created', r => r.marks.mapCreated],
  ['first map render', r => r.marks.mapFirstRender],
  ['map load', r => r.marks.mapLoad],
  ['map first idle', r => r.marks.mapFirstIdle],
  ['apartments boot done (count.done; NOT the build landing)', r => r.marks.apartmentsDone],
  ['apartments ready to reveal', r => r.marks.apartmentsReady],
  ['CITY READY (intro reveal, veil lifts)', r => r.marks.introReveal],
  ['veil gone', r => r.marks.veilGone],
  ['veil wait after authored group landed', r => r.marks.introReveal - r.marks.groupLanded],
  ['group landed (slopesApartments.group set)', r => r.marks.groupLanded],
  ['first view ready (our gate)', r => r.marks.firstViewReady],
  ['apartments count.ms (build wall, sliced)', r => r.apartments && r.apartments.ms],
  ['long tasks > 50 ms: total ms', r => r.long.reduce((s, x) => s + x[1], 0)],
  ['long tasks: count', r => r.long.length],
  ['longest task', r => Math.max(0, ...r.long.map(x => x[1]))],
  ['script duration (CDP ScriptDuration s*1000)', r => r.cdpMetrics.ScriptDuration * 1000],
  ['task duration (CDP TaskDuration s*1000)', r => r.cdpMetrics.TaskDuration * 1000],
  ['JS heap used MB', r => r.heap && r.heap.usedSize / 2 ** 20],
  ['wire MB, all requests', r => r.net.total.enc / 2 ** 20],
  ['requests, all', r => r.net.total.n],
];
out.push(`# load-profile report`);
out.push(`url ${URL0}  gl ${GL}  ${PHONE ? 'phone 390x844 DPR3' : 'desktop 1280x800 DPR1.5'}  query ?${QUERY}  autodetect ${AUTODETECT ? 'on' : 'cancelled'}  profile ${PROFILE}  trace ${TRACE}  settle ${SETTLE} ms`);
if (results[0]) out.push(`chrome ${results[0].chrome}  renderer ${results[0].gpuRenderer}  host cpus ${results[0].machine.before.cpus}`);
for (const { t, arm } of THROTTLES.flatMap(t => ARMS.map(arm => ({ t, arm })))) {
  const rs = results.filter(r => r.throttle === t && (r.arm || '') === arm.name);
  out.push(`\n## ${arm.name ? 'arm ' + arm.name + ', ' : ''}CPU throttle ${t}x, ${rs.length} cold loads  (ms; min / median / max)`);
  out.push(`machine load average before each rep: ${rs.map(r => r.machine.before.load1).join(', ')}`);
  for (const [name, f] of rows) { const v = rs.map(r => { try { return f(r); } catch (e) { return null; } }).filter(x => x != null && isFinite(x)); out.push(`${name.padEnd(46)} ${stat(v)}   [${v.map(fmt).join(', ')}]`); }
}
// what the veil waited for: window.__intro.gates per load, one line per gate (last time it blocked / first time it held)
for (const { t, arm } of THROTTLES.flatMap(t => ARMS.map(arm => ({ t, arm })))) {
  const rs = results.filter(r => r.throttle === t && (r.arm || '') === arm.name && r.intro && r.intro.gates);
  if (!rs.length) continue;
  out.push(`\n## veil gates ${arm.name ? 'arm ' + arm.name + ', ' : ''}${t}x  (per load: lastBlockedAt/firstOkAt ms; reveal at ${rs.map(r => fmt(r.marks.introReveal)).join(', ')}; reason ${rs.map(r => r.intro.reason).join(', ')})`);
  const names = [...new Set(rs.flatMap(r => Object.keys(r.intro.gates)))].sort();
  for (const n of names) out.push(`${n.padEnd(46)} ${rs.map(r => { const g = r.intro.gates[n]; return g ? `${g.lastBlockedAt == null ? '-' : fmt(g.lastBlockedAt)}/${g.firstOkAt == null ? '-' : fmt(g.firstOkAt)}` : 'n/a'; }).join('   ')}`);
  const srcs = ['austin-buildings', 'austin-outer', 'austin-roads', 'austin-ground', 'austin-westcampus', 'austin-entrances', 'campus-storeys'];
  for (const n of srcs) out.push(`source first loaded: ${n.padEnd(24)} ${rs.map(r => fmt(r.src[n])).join('   ')}`);
}
const rs0 = results[0];
if (rs0) {
  out.push('\n## network, first rep (cold, empty cache)');
  out.push('category'.padEnd(40) + 'requests  wireKB   decodedKB  gzipKB(est)  brKB(est)  fromWorkers  ranges');
  for (const [c, e] of Object.entries(rs0.net.cats).sort((a, b) => b[1].dec - a[1].dec)) {
    const es = rs0.net.est[c];
    out.push(c.padEnd(40) + String(e.n).padStart(8) + String(Math.round(e.enc / 1024)).padStart(8) + String(Math.round(e.dec / 1024)).padStart(11) + String(es ? Math.round(es.gz / 1024) : '-').padStart(13) + String(es ? Math.round(es.br / 1024) : '-').padStart(11) + String(e.fromWorkers).padStart(13) + String(e.ranges).padStart(8));
  }
  out.push(`TOTAL ${rs0.net.total.n} requests, wire ${(rs0.net.total.enc / 2 ** 20).toFixed(2)} MB, decoded ${(rs0.net.total.dec / 2 ** 20).toFixed(2)} MB`);
}
for (const r of results.filter(x => x.analysis)) {
  out.push(`\n## CPU profile ${r.label}  (throttle ${r.throttle}x, reveal at ${r.marks.introReveal} ms)`);
  out.push(formatTop(r.analysis, 25));
  out.push('named phases (inclusive >= 150 ms, own js/):');
  r.analysis.phases.slice(0, 20).forEach(p => out.push(`  ${String(p.inclusiveMs).padStart(8)} ms  ${p.firstAtMs}-${p.lastAtMs}  ${p.fn}`));
  if (r.analysis.workers) { out.push('workers (profiled):'); r.analysis.workers.forEach(w => out.push(`  ${w.url}  busy ${w.busyMs} ms of ${w.totalMs}`)); }
}
for (const r of results.filter(x => x.traceSummary)) {
  out.push(`\n## trace ${r.label}: ${r.traceSummary.events} events`);
  for (const [k, v] of Object.entries(r.traceSummary.byName).sort((a, b) => b[1].ms - a[1].ms)) out.push(`  ${k.padEnd(34)} ${String(v.ms).padStart(9)} ms  x${v.n}`);
  out.push('  by script:'); r.traceSummary.topScripts.forEach(([k, v]) => out.push(`   ${String(v).padStart(8)} ms  ${k}`));
}
const text = out.join('\n');
fs.writeFileSync(path.join(OUT, `report${LABEL ? '-' + LABEL : ''}.txt`), text);
fs.writeFileSync(path.join(OUT, `summary${LABEL ? '-' + LABEL : ''}.json`), JSON.stringify(results.map(({ analysis, traceSummary, ...r }) => ({ ...r, analysisTop: analysis && analysis.topSelf.slice(0, 10) })), null, 1));
console.log(text);
process.exit(0);
