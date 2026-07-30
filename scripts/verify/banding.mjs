/**
 * banding.mjs — measure two things nobody has checked:
 *   1. 8-bit banding in the sky gradient (sample a vertical column, look for
 *      long runs of identical values and count the step sizes)
 *   2. the real cost of the sky overlay redraw while flying
 * Uses _harness.html because it forces preserveDrawingBuffer, which is the only
 * way to read our own pixels back.
 */
import { chromium } from 'playwright-core';
import { chromePath } from './chrome.mjs';
const EXE = chromePath();
const browser = await chromium.launch({ executablePath: EXE, headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 900, height: 800 } });
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.goto('http://127.0.0.1:8099/_harness.html?intro=0', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });
await page.waitForTimeout(4500);

const out = await page.evaluate(async () => {
  const m = window.__map;
  const cv = m.getCanvas();
  const gl = cv.getContext('webgl2') || cv.getContext('webgl');
  const res = { bands: {}, perf: {} };

  // Read a vertical column of the sky, top of frame down to just above the
  // horizon, at native device pixels.
  function column(fx) {
    const w = cv.width, h = cv.height;
    const x = Math.round(fx * w);
    const buf = new Uint8Array(4 * h);
    gl.readPixels(x, 0, 1, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    // gl rows are bottom-up; flip to top-down
    const px = [];
    for (let row = h - 1; row >= 0; row--) px.push([buf[row * 4], buf[row * 4 + 1], buf[row * 4 + 2]]);
    return px;
  }

  function analyse(px, fromFrac, toFrac) {
    const h = px.length;
    const a = Math.round(h * fromFrac), b = Math.round(h * toFrac);
    const seg = px.slice(a, b);
    let runs = [], cur = 1, maxRun = 1, steps = [];
    for (let i = 1; i < seg.length; i++) {
      const same = seg[i][0] === seg[i-1][0] && seg[i][1] === seg[i-1][1] && seg[i][2] === seg[i-1][2];
      if (same) { cur++; }
      else {
        runs.push(cur); maxRun = Math.max(maxRun, cur); cur = 1;
        const d = Math.max(Math.abs(seg[i][0]-seg[i-1][0]), Math.abs(seg[i][1]-seg[i-1][1]), Math.abs(seg[i][2]-seg[i-1][2]));
        steps.push(d);
      }
    }
    runs.push(cur); maxRun = Math.max(maxRun, cur);
    const uniq = new Set(seg.map(c => c.join(','))).size;
    const bigSteps = steps.filter(d => d >= 2).length;
    return {
      pixels: seg.length, uniqueColours: uniq, maxFlatRun: maxRun,
      meanFlatRun: +(runs.reduce((s,x)=>s+x,0)/runs.length).toFixed(2),
      stepsOf2plus: bigSteps,
      top: seg[0] && seg[0].join(','), bottom: seg[seg.length-1] && seg[seg.length-1].join(','),
    };
  }

  for (const [name, p, pitch] of [['day', 0.08, 84], ['golden', 0.5, 84], ['night', 1.0, 84]]) {
    m.jumpTo({ center: [-97.7434, 30.2857], zoom: 16.4, pitch, bearing: 20 });
    window.applyTimeOfDay(m, p);
    for (let i = 0; i < 40; i++) await new Promise(r => requestAnimationFrame(r));
    const px = column(0.5);
    // sky occupies roughly the top 30% at pitch 84
    res.bands[name] = analyse(px, 0.02, 0.26);
  }

  // ── Cost of the sky redraw ──
  // Take the MINIMUM of many single-call timings, not the mean. A mean on a busy
  // machine measures the machine; the minimum measures the code. (A first pass
  // using means reported day getting 3x slower after a change that only touches
  // the night path — pure scheduling noise.)
  async function cost(p) {
    m.jumpTo({ center: [-97.7434, 30.2857], zoom: 16.4, pitch: 80, bearing: 20 });
    window.applyTimeOfDay(m, p);
    await new Promise(r => setTimeout(r, 500));
    for (let i = 0; i < 10; i++) window.updateSky(m, p);      // warm up
    let best = Infinity, sum = 0, n = 60;
    for (let i = 0; i < n; i++) {
      const t = performance.now();
      window.updateSky(m, p);
      const d = performance.now() - t;
      if (d < best) best = d;
      sum += d;
    }
    return { min: +best.toFixed(3), mean: +(sum / n).toFixed(3) };
  }
  res.perf.night = await cost(1.0);
  res.perf.golden = await cost(0.5);
  res.perf.day = await cost(0.08);
  res.perf.canvasPx = cv.width + 'x' + cv.height;
  res.perf.dpr = window.devicePixelRatio;
  return res;
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
