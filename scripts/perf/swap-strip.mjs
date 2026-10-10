/**
 * swap-strip.mjs — what does a visitor SEE when a newly reached area is answered with flat walls and the real ones swap
 * in (js/facades.js WALL TIERS, the burst cap)? (written 2026-10-10)
 *
 * Loads the default page, waits for the reveal and for the opening flight to end, then jumps the camera to places the
 * flight never visited, at street level, and takes FRAMES screenshots right away (as fast as the browser delivers them),
 * with the page's own clock beside each: how many flat answers had been given and how many real images had landed.
 * Frames go to --out, one folder per place, plus a contact sheet per place (frames side by side) written as a PNG strip
 * by the page itself, so nothing here needs an image library. PRIVATE: keep --out outside the repository.
 *
 *   node scripts/perf/swap-strip.mjs --url http://127.0.0.1:8442/ --out DIR [--frames 5] [--throttle 1]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startChrome } from './lib/cdp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const URL0 = arg('--url', (process.env.VERIFY_URL || 'http://127.0.0.1:8099') + '/');
const OUT = arg('--out', process.env.VERIFY_OUT || '/tmp/swap-strip');
const FRAMES = +arg('--frames', 5);
const THROTTLE = +arg('--throttle', 1);
const SETTLE = +arg('--settle', 16000);
const MAX = +arg('--max', 420000);
const QUERY = arg('--query', '').replaceAll('+', '&');   // e.g. wtbudget=0&wtwarm=0 to force every image flat and nothing warmed (the worst case)
const INSTRUMENT = fs.readFileSync(path.join(HERE, 'lib/instrument.js'), 'utf8');
// places the opening flight never meets, at street level
const PLACES = [
  { name: 'capitol-street', center: [-97.7405, 30.2747], zoom: 18.2, pitch: 66, bearing: 20, p: 0.25 },
  { name: 'stadium-street', center: [-97.7352, 30.2840], zoom: 18.0, pitch: 66, bearing: 90, p: 0.25 },
  { name: 'drag-street', center: [-97.7418, 30.2868], zoom: 18.4, pitch: 70, bearing: 356, p: 0.25 },
];
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const chrome = await startChrome({ gl: arg('--gl', 'hardware'), width: 1280, height: 800, vsync: 'off', maxMs: MAX + 300000 });
const page = await chrome.newPage();
try {
  await page.send('Page.enable'); await page.send('Runtime.enable');
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  if (THROTTLE > 1) await page.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__PERF_CFG=${JSON.stringify({ wrap: [], autodetect: false })};` + INSTRUMENT });
  await page.send('Page.navigate', { url: URL0 + (URL0.includes('?') ? '&' : '?') + 'drift=0&namelabels=0' + (QUERY ? '&' + QUERY : '') });
  const tNav = Date.now();
  const ev = async (expr) => (await page.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
  for (;;) {
    await sleep(500);
    let st = null;
    try { st = JSON.parse((await page.send('Runtime.evaluate', { expression: 'JSON.stringify({m:window.__perf&&window.__perf.marks,now:performance.now()})', returnByValue: true })).result.value || 'null'); } catch (e) {}
    if (st && st.m && st.m.introReveal && st.now - st.m.introReveal >= SETTLE) break;
    if (Date.now() - tNav > MAX) throw new Error('no reveal');
  }
  const report = [];
  for (const pl of PLACES) {
    const dir = path.join(OUT, pl.name);
    fs.mkdirSync(dir, { recursive: true });
    await ev(`(async () => { const m = window.__map; if (m.isEasing && m.isEasing()) m.stop(); window.applyTimeOfDay(m, ${pl.p}); await new Promise(r => setTimeout(r, 400)); window.__t0 = performance.now(); window.__w0 = JSON.stringify({ flat: window.__facadeWallTiers.placeholders, real: window.__facadeWallTiers.syncPainted, committed: window.__facadePace && window.__facadePace.committed }); m.jumpTo(${JSON.stringify({ center: pl.center, zoom: pl.zoom, pitch: pl.pitch, bearing: pl.bearing })}); return 1; })()`);
    const frames = [];
    for (let i = 0; i < FRAMES; i++) {
      const shot = await page.send('Page.captureScreenshot', { format: 'png' });
      const state = JSON.parse(await ev(`JSON.stringify({ t: Math.round(performance.now() - window.__t0), flat: window.__facadeWallTiers.placeholders, real: window.__facadeWallTiers.syncPainted, paced: window.__facadePace && window.__facadePace.committed, busy: window.__facadePace && window.__facadePace.busy })`));
      fs.writeFileSync(path.join(dir, `frame-${i}.png`), Buffer.from(shot.data, 'base64'));
      frames.push(state);
      await sleep(i < 2 ? 0 : 150 * i);
    }
    // and the settled frame, for the comparison
    await sleep(4000);
    const shot = await page.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(dir, 'settled.png'), Buffer.from(shot.data, 'base64'));
    report.push({ place: pl.name, base: JSON.parse(await ev('window.__w0')), frames });
  }
  fs.writeFileSync(path.join(OUT, 'strip.json'), JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 1));
} finally { await chrome.close(); }
process.exit(0);
