/**
 * light-perf.mjs — honest before/after cost of the LIGHT beauty pass.
 *
 * A = baseline commit (pristine git-archive copy, env BASELINE_URL)
 * B = this worktree (env VERIFY_URL)
 *
 * HEADED (swiftshader timing is meaningless), 1440x900, cinematic preset at
 * golden hour with the sun in frame (rays + flare + bloom + filmic + AE + belt
 * all active on B). Every run renders IDENTICAL content: a scripted bearing
 * sweep, nothing held down. Interleaved A,B,A,B...; dropped frames counted per
 * run; the MINIMUM of reps is the comparison number (per the README: a mean on
 * a busy machine measures the machine).
 */
import { chromium } from 'playwright-core';
import { chromePath, launch } from './chrome.mjs';

const BASE_B = process.env.VERIFY_URL || 'http://127.0.0.1:8100';
const BASE_A = process.env.BASELINE_URL || 'http://127.0.0.1:8102';
const REPS = 4;

// TWO SERVERS, AND SAY SO BEFORE LAUNCHING A BROWSER.
//
// This is an A/B against a pristine baseline checkout, so it needs a SECOND
// server that nothing else in this suite needs. Run it with only the usual one
// up and it used to open a headed Chrome, navigate at :8102, and die on
// `net::ERR_CONNECTION_REFUSED` inside page.goto — which in the 2026-08-16
// suite inventory was indistinguishable from a guard that crashes. Exit 2
// (cannot run) rather than 1 (something failed) and name both ports.
for (const [label, url, env] of [['A baseline', BASE_A, 'BASELINE_URL'], ['B candidate', BASE_B, 'VERIFY_URL']]) {
  try {
    const r = await fetch(`${url}/index.html`, { method: 'HEAD' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
  } catch (e) {
    console.error(`light-perf.mjs needs TWO servers. ${label} is not answering at ${url} (${e.message}).`);
    console.error(`  A = a pristine baseline checkout, served separately; set ${env} to move it.`);
    console.error('  e.g.  git archive <baseline-sha> | tar -x -C /tmp/base && python scripts/serve.py 8102   (from /tmp/base)');
    process.exit(2);
  }
}

const browser = await launch(chromium, { headless: false });

async function makePage(base) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', e => console.log('  [pageerror] ' + e.message));
  await page.goto(`${base}/index.html?intro=0`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });
  await page.waitForTimeout(4000);
  await page.evaluate(() => {
    window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect();
    Object.assign(window.GFX, window.GFX_PRESETS.cinematic);
    window.applyGraphics();
    window.applyTimeOfDay(window.__map, 0.47, true);
  });
  await page.waitForTimeout(3000);
  return page;
}

/** One 4 s measured bearing sweep from a fixed pose. */
async function sweep(page) {
  return page.evaluate(async () => {
    const m = window.__map;
    m.jumpTo({ center: [-97.7434, 30.2857], zoom: 16.3, pitch: 78, bearing: 200 });
    await new Promise(r => setTimeout(r, 500));
    const dts = [];
    let bearing = 200;
    const t0 = performance.now();
    await new Promise(res => {
      let last = null;
      const step = ts => {
        if (last !== null) dts.push(ts - last);
        last = ts;
        bearing += 0.25;
        m.jumpTo({ bearing });
        if (performance.now() - t0 > 4000) return res();
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    const s = [...dts].sort((a, b) => a - b);
    const q = f => s[Math.min(s.length - 1, Math.floor(s.length * f))] || 0;
    const dropped = dts.reduce((a, d) => a + Math.max(0, Math.round(d / 16.67) - 1), 0);
    const el = dts.reduce((a, d) => a + d, 0);
    return { fps: 1000 * dts.length / el, p50: q(0.5), p95: q(0.95), dropped,
             dropPct: 100 * dropped / (dropped + dts.length) };
  });
}

console.log('A = baseline ' + BASE_A + '   B = light worktree ' + BASE_B);
const pageA = await makePage(BASE_A);
const pageB = await makePage(BASE_B);

const A = [], B = [];
for (let i = 0; i < REPS; i++) {
  const ra = await sweep(pageA);
  A.push(ra);
  console.log(`A rep${i}  ${ra.fps.toFixed(1)} fps  p50 ${ra.p50.toFixed(1)}  p95 ${ra.p95.toFixed(1)}  dropped ${ra.dropped} (${ra.dropPct.toFixed(1)}%)`);
  const rb = await sweep(pageB);
  B.push(rb);
  console.log(`B rep${i}  ${rb.fps.toFixed(1)} fps  p50 ${rb.p50.toFixed(1)}  p95 ${rb.p95.toFixed(1)}  dropped ${rb.dropped} (${rb.dropPct.toFixed(1)}%)`);
}

const min = (arr, k) => Math.min(...arr.map(r => r[k]));
const max = (arr, k) => Math.max(...arr.map(r => r[k]));
console.log('\n=== summary (MIN of interleaved reps; spread in brackets) ===');
console.log(`A baseline : dropped min ${min(A, 'dropped')} [${min(A, 'dropped')}..${max(A, 'dropped')}]  ` +
  `fps best ${max(A, 'fps').toFixed(1)}  p50 best ${min(A, 'p50').toFixed(2)} ms`);
console.log(`B light    : dropped min ${min(B, 'dropped')} [${min(B, 'dropped')}..${max(B, 'dropped')}]  ` +
  `fps best ${max(B, 'fps').toFixed(1)}  p50 best ${min(B, 'p50').toFixed(2)} ms`);
console.log('If the dropped-frame ranges overlap, there is no measurable regression.');

await browser.__done();
