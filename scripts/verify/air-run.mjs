/**
 * air-run.mjs — drives air.html in a real browser: frame-rate runs, stills and the recorded clip.
 * A TOOL, not a check (no pass/fail; it photographs and times). Listed under `tools` in ci/checks.json.
 *
 *   node air-run.mjs --mode perf  --out DIR [--variants on,lite,full] [--size 1280x720] [--secs 70]
 *        the autopilot flies in real time (rAF); frame times in 10 s windows along the course. Variants: on = the air budget,
 *        lite = the integrated/phone step, full = the main page's whole city (?full=1&airbudget=0), same flight
 *   node air-run.mjs --mode stills --out DIR [--hour 0.12]
 *        four stills: start, a downtown gate, the Capitol, the finish (deterministic: the sim is stepped by hand)
 *   node air-run.mjs --mode clip  --out DIR --from 36 --secs 20 [--fps 30] [--hour 0.12]
 *        the clip: frame-by-frame (the sim steps 1/fps, the page waits for the map to settle, one JPEG per frame)
 *   --mode probe: boots the page, prints console errors, the GL renderer, and one screenshot
 *
 * --mode takes a plus-separated list (probe+stills+perf): one browser, one queue slot, run in order.
 * Run it on the laptop or Colab, NOT the Mac (CLOUD-LANES.md):
 *   acer-run.sh check air-run.mjs --workcopy ~/Projects/flyover-air --gl hardware --out DIR  -- --mode stills ...
 * Timing is only honest on a quiet machine; the JSON says which GPU and what else it knew.
 */
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';

const A = process.argv.slice(2);
const arg = (k, d) => { const i = A.indexOf('--' + k); return i >= 0 ? A[i + 1] : d; };
const MODE = arg('mode', 'probe'), OUT = arg('out', process.env.VERIFY_OUT || path.join(process.cwd(), 'air-out'));
const [W, H] = arg('size', '1280x720').split('x').map(Number);
const HOUR = arg('hour', '0.12'), BUDGET = arg('budget', 'on');
const EXTRA = arg('q', '');
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log('[air-run]', ...a);

const browser = await launch(chromium, { maxMs: 40 * 60 * 1000 });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const errors = [], warns = [];
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
page.on('console', m => { const t = m.text(); if (m.type() === 'error') errors.push(t.slice(0, 300)); else if (/\[air\]|MAP ERROR/.test(t)) warns.push(t.slice(0, 300)); });

async function open(query) {
  const url = `${BASE}/air.html?${query}`;
  log('open', url);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.airReady === '1', null, { timeout: 240000 });
  // the veil lifts when the city is drawn
  await page.waitForFunction(() => !document.getElementById('veil'), null, { timeout: 240000 }).catch(() => log('veil still up after 240 s'));
  await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
}
const settle = (ms = 6000) => page.evaluate(ms => new Promise(res => {
  const m = window.__air.map; const done = () => { clearTimeout(t); res(); };
  const t = setTimeout(done, ms);
  const chk = () => { if (m.loaded() && m.areTilesLoaded()) done(); else m.once('idle', chk); };
  chk();
}), ms);
const gl = () => page.evaluate(() => { const c = document.createElement('canvas'), g = c.getContext('webgl2'); const e = g && g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
const base = (more = '') => `manual=1&p=${HOUR}&airbudget=${BUDGET}&preset=balanced${EXTRA ? '&' + EXTRA : ''}${more}`;

async function runMode(MODE) {
  if (MODE === 'probe') {
    await open(base('&hud=1'));
    await settle(8000);
    await page.screenshot({ path: path.join(OUT, 'probe.jpg'), type: 'jpeg', quality: 90 });
    log('renderer', await gl()); log('state', JSON.stringify(await page.evaluate(() => window.__air.state())));
  } else if (MODE === 'stills') {
    await open(base('&auto=1&countdown=0&ghost=house'));
    const tl = await page.evaluate(() => window.__air.timeline(1));
    log('autopilot time', tl.time.toFixed(2));
    const shot = async (name) => { await settle(9000); await page.evaluate(() => window.__air.advance(1 / 60)); await settle(9000); await page.screenshot({ path: path.join(OUT, name + '.jpg'), type: 'jpeg', quality: 92 }); log('shot', name); };
    const t = n => tl.gates.find(g => g.name === n).t;
    // 1. start: the ready screen is on, the craft held; hud hidden for a clean frame
    await page.evaluate(() => { window.__air.begin(); });
    await page.evaluate(() => window.__air.seek(0.2));
    await shot('1-start');
    await page.evaluate(sec => window.__air.seek(sec), t('Austonian | JW Marriott') - 1.2);
    await shot('2-downtown-gate');
    await page.evaluate(sec => window.__air.seek(sec), t('Capitol, west') - 1.6);
    await shot('3-capitol');
    await page.evaluate(sec => window.__air.seek(sec), tl.time - 1.4);
    await shot('4-finish');
    fs.writeFileSync(path.join(OUT, 'timeline.json'), JSON.stringify(tl, null, 1));
  } else if (MODE === 'clip') {
    const from = +arg('from', 36), secs = +arg('secs', 20), fps = +arg('fps', 30);
    await open(base('&auto=1&countdown=0&ghost=house&hud=' + arg('hud', '1')));
    await page.evaluate(t => window.__air.seek(t), from);
    await settle(20000);
    const frames = Math.round(secs * fps); fs.mkdirSync(path.join(OUT, 'frames'), { recursive: true });
    const t0 = Date.now();
    for (let k = 0; k < frames; k++) {
      await page.evaluate(dt => window.__air.advance(dt), 1 / fps);
      await settle(5000);
      await page.screenshot({ path: path.join(OUT, 'frames', String(k).padStart(4, '0') + '.jpg'), type: 'jpeg', quality: 92 });
      if (k % 30 === 0) log(`frame ${k}/${frames}, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    }
  } else if (MODE === 'perf') {
    const secs = +arg('secs', 70), win = 10, variants = arg('variants', 'on').split(',');
    const results = [];
    for (const v of variants) {
      const q = v === 'full' ? 'airbudget=0&full=1' : `airbudget=${v}`;
      await open(`p=${HOUR}&${q}&preset=balanced&auto=1&countdown=0&ghost=house&hud=0${EXTRA ? '&' + EXTRA : ''}`);
      await settle(30000);
      const out = { variant: v, gl: await gl(), size: `${W}x${H}`, windows: [] };
      await page.evaluate(() => window.__air.begin());
      for (let w = 0; w < secs / win; w++) {
        await page.evaluate(() => window.__air.perfStart());
        await page.waitForTimeout(win * 1000);
        const r = await page.evaluate(() => ({ perf: window.__air.perfStop(), t: window.__air.state() && window.__air.state().t }));
        out.windows.push({ from: w * win, simT: +(r.t || 0).toFixed(1), ...r.perf });
        log(v, 'window', JSON.stringify(out.windows[out.windows.length - 1]));
      }
      const fp = out.windows.filter(x => x.fpsMean); out.fpsMean = +(fp.reduce((s, x) => s + x.fpsMean, 0) / fp.length).toFixed(1); out.fpsWorstWindow = Math.min(...fp.map(x => x.fpsMean)); out.p95msWorst = Math.max(...fp.map(x => x.p95ms));
      out.misses = await page.evaluate(() => window.__air.state().misses);
      results.push(out);
      fs.writeFileSync(path.join(OUT, `perf-${W}x${H}.json`), JSON.stringify(results, null, 1));
    }
    console.log('RESULT ' + JSON.stringify(results.map(r => ({ variant: r.variant, fpsMean: r.fpsMean, fpsWorstWindow: r.fpsWorstWindow, p95msWorst: r.p95msWorst, gl: r.gl }))));
  }
}
try {
  for (const m of MODE.split('+')) { log('=== mode', m); await runMode(m.trim()); }
  fs.writeFileSync(path.join(OUT, 'console.json'), JSON.stringify({ errors, warns }, null, 1));
  log('errors', errors.length, errors.slice(0, 5)); log('warns', warns.slice(0, 5));
} finally { await browser.__done(); }
