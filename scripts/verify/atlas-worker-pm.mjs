/**
 * atlas-worker-pm.mjs — the facade atlas premultiply that moved into MapLibre's
 * tile workers (js/facades.js, ATLAS_WORKER_PM) gives the SAME BYTES as the
 * main-thread one it replaced, on the real page, for every atlas; and the
 * pattern images the workers keep (ATLAS_IMAGE_CACHE) are the same bytes as
 * the page's own images every time one is used instead of a fresh copy.
 *
 *   VERIFY_URL=http://127.0.0.1:8562 node atlas-worker-pm.mjs [--break | --break-img]
 *
 * Loads index.html with `?atlaspmcheck=1`: every worker-premultiplied atlas
 * then also carries its raw bytes, and the page compares premultiplyInto(raw)
 * with what arrived, byte for byte, before uploading. The camera is then
 * turned through a full circle at campus and downtown so hundreds of new tiles
 * arrive after the workers were armed. Asserts:
 *   - the workers were armed (`workerPm` is 'on'),
 *   - atlases arrived premultiplied (at least MIN_WORKER atlases),
 *   - every one of them was checked, and 0 bytes differed,
 *   - the image cache is on, at least MIN_STUBS images were sent as stubs
 *     during the turns, their held copies were compared with fresh ones
 *     (`?atlaspmcheck=1` sends both), and 0 bytes differed,
 *   - no page errors.
 * `--break` imports a second script into the workers that tags each atlas as
 * premultiplied WITHOUT premultiplying it (a worker that forgot the work) and
 * must exit 1. `--break-img` imports one that flips a byte of every image a
 * worker is handed, i.e. of the copies it keeps (a stale cache), and must exit 1.
 *
 * Hardware GL, headed (a headless page stops firing rAF), one browser: wrap it
 * in astra-pipe's gpu-run.mjs on the laptop.
 */
import { chromium } from 'playwright-core';
import { launch, HW_ARGS } from './chrome.mjs';

const A = process.argv.slice(2);
const BREAK = A.includes('--break');
const BREAK_IMG = A.includes('--break-img');
const URL0 = process.env.VERIFY_URL || 'http://127.0.0.1:8099';
const MIN_WORKER = 50;               // atlases the turns must bring in premultiplied
const MIN_STUBS = 50;                // images the turns must use from a worker's own copy
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await launch(chromium, { headless: false, gl: 'hardware',
  args: [...HW_ARGS, '--window-size=1296,820', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion',
    '--disable-gpu-vsync', '--disable-frame-rate-limit'], maxMs: 600000 });
let code = 0;
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 680 }, deviceScaleFactor: 1.5 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message.slice(0, 200)));
  await page.goto(`${URL0}/index.html?drift=0&intro=0&atlaspmcheck=1`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.bringToFront();
  const ev = (fn, x) => page.evaluate(fn, x);
  for (let i = 0; i < 400; i++) { if (await ev(() => !!window.__map).catch(() => false)) break; await sleep(250); }
  await ev(() => { try { window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect(); } catch (e) {} });
  const t0 = Date.now();
  for (;;) {
    const st = await ev(() => ({ veil: !!document.getElementById('veil'),
      done: !!(window.slopesApartments && window.slopesApartments.count.done),
      tiles: (() => { try { return window.__map.areTilesLoaded(); } catch (e) { return false; } })() })).catch(() => null);
    if (st && !st.veil && st.done && st.tiles) break;
    if (Date.now() - t0 > 240000) throw new Error('page did not load: ' + JSON.stringify(st));
    await sleep(500);
  }
  await ev(() => { try { window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect(); } catch (e) {} });
  for (let i = 0; i < 40 && (await ev(() => window.facadeMemoryStats().workerPm)) === 'arming'; i++) await sleep(250);
  const before = await ev(() => window.facadeMemoryStats());
  console.log(`[atlas-worker-pm] armed: ${before.workerPm}; at load ${before.fastAtlasUploads} atlases, ${before.workerPmUploads} from workers`);
  if (BREAK) {
    // Outer wrapper on each worker's postMessage: runs BEFORE the real one,
    // tags the atlas and hands over its raw bytes as "premultiplied".
    await ev(() => {
      const src = `(function(){ const post = self.postMessage; self.postMessage = function (m) {
        try { const a = m && m.type === '<response>' && m.data && m.data.imageAtlas;
          if (a && a.$name === 'ImageAtlas' && a.image && a.image.data) { a.__facadePmSrc = a.image.data.slice(); a.__facadePm = 1; } } catch (e) {}
        return post.apply(self, arguments); }; })();`;
      return window.maplibregl.importScriptInWorkers(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    });
    console.log('[atlas-worker-pm] --break: workers now tag atlases without premultiplying them');
  }
  if (BREAK_IMG) {
    // Outer wrapper on each worker's actor: every image handed back to
    // MapLibre (held copies included, they are the same objects) gets a byte
    // flipped, so the copies a worker keeps no longer match the page's.
    await ev(() => {
      const src = `(function(){ const a = self.worker && self.worker.actor; if (!a) return; const send = a.sendAsync;
        a.sendAsync = function (m) { return send.apply(this, arguments).then(function (r) {
          try { if (m && m.type === 'GI' && r) for (const id in r) { const d = r[id] && r[id].data && r[id].data.data; if (d && d.length) d[0] ^= 1; } } catch (e) {}
          return r; }); }; })();`;
      return window.maplibregl.importScriptInWorkers(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    });
    console.log('[atlas-worker-pm] --break-img: the images workers keep are corrupted');
  }
  const POSES = [
    { center: [-97.7434, 30.2857], zoom: 16.5, pitch: 74, bearing: 250 },
    { center: [-97.7445, 30.2668], zoom: 16.3, pitch: 72, bearing: 200 },
  ];
  for (const P of POSES) {
    for (let k = 0; k <= 12; k++) {
      await ev(([P, b]) => { window.__map.jumpTo({ ...P, bearing: b }); }, [P, P.bearing + 30 * k]);
      for (let i = 0; i < 40; i++) { if (await ev(() => window.__map.areTilesLoaded())) break; await sleep(150); }
    }
  }
  await sleep(1500);
  const s = await ev(() => window.facadeMemoryStats());
  const newWorker = s.workerPmUploads - before.workerPmUploads;
  console.log(`[atlas-worker-pm] after the turns: ${s.fastAtlasUploads} atlases, ${s.workerPmUploads} from workers ` +
    `(${(s.workerPmBytes / 1048576).toFixed(1)} MB), ${s.workerPmChecked} checked, ${s.workerPmMismatch} bytes differed; ` +
    `main-thread premultiply ${Math.round(s.mainPmMs)} ms for the rest`);
  const newStubs = s.imgCacheStubs - before.imgCacheStubs;
  console.log(`[atlas-worker-pm] image cache ${s.imgCache}: ${s.imgCacheStubs} images sent as stubs ` +
    `(${(s.imgCacheBytesSaved / 1048576).toFixed(1)} MB not copied; ${newStubs} during the turns), ` +
    `${s.imgCacheSent} sent whole (${(s.imgCacheBytesSent / 1048576).toFixed(1)} MB); ` +
    `${s.imgCacheChecked} held copies checked, ${s.imgCacheMismatch} bytes differed`);
  const fail = [];
  if (s.workerPm !== 'on') fail.push(`workers not armed (${s.workerPm})`);
  if (newWorker < MIN_WORKER) fail.push(`only ${newWorker} atlases arrived premultiplied during the turns (want >= ${MIN_WORKER})`);
  if (s.workerPmChecked !== s.workerPmUploads) fail.push(`${s.workerPmUploads - s.workerPmChecked} worker atlases were not checked`);
  if (s.workerPmMismatch !== 0) fail.push(`${s.workerPmMismatch} bytes differ from the main-thread premultiply`);
  if (s.imgCache !== 'on') fail.push(`image cache not on (${s.imgCache})`);
  if (newStubs < MIN_STUBS) fail.push(`only ${newStubs} images came from a worker's own copy during the turns (want >= ${MIN_STUBS})`);
  if (s.imgCacheChecked < Math.min(MIN_STUBS, s.imgCacheStubs)) fail.push(`only ${s.imgCacheChecked} held copies were checked`);
  if (s.imgCacheMismatch !== 0) fail.push(`${s.imgCacheMismatch} bytes of held images differ from the page's images`);
  if (errors.length) fail.push('page errors: ' + errors.join(' | '));
  if (fail.length) { code = 1; console.log('FAIL: ' + fail.join('; ')); }
  else console.log('PASS: every worker-premultiplied atlas is byte-identical to the main-thread premultiply, and every held image checked is byte-identical to the page image');
  await ctx.close().catch(() => {});
} catch (e) {
  console.error('[atlas-worker-pm] could not run: ' + e.message);
  code = 2;
}
await browser.__done();
process.exit(code);
