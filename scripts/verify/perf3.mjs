/**
 * perf3.mjs — the shipped numbers, measured so they can be believed.
 *
 * Headed (real GPU), 2560x1400 — the resolution the lag was reported at — and
 * counting DROPPED FRAMES, because the median frame time sits on the 16.7 ms
 * vsync floor even when half the frames are being missed, which is exactly what
 * "super laggy" feels like.
 *
 * The methodology matters more than the numbers here. A first attempt ran each
 * configuration once, in sequence, and produced 23.4 / 32.4 / 43.6 / 40.9 fps for
 * four runs that were all secretly the SAME configuration — a 2x spread of pure
 * noise that would have read as a clean ranking. So: every configuration runs
 * REPS times, the runs are INTERLEAVED (a,b,c,d,a,b,c,d,...) so machine drift hits
 * all of them equally, and the median is printed with its full spread beside it.
 * If the spreads overlap, there is no result.
 */
import { chromium } from 'playwright-core';
import { chromePath, BASE, launch } from './chrome.mjs';

const REPS = 4;

// `antialias` and `preserveDrawingBuffer` are fixed when the WebGL context is
// created, so a configuration has to be installed BEFORE app.js constructs the
// map — which is what graphics.js reads localStorage for. Writing the settings in
// an init script is the same path a returning user takes.
// addInitScript serialises the function and runs it in the PAGE, so a closure
// over `cfg` is not available there — it has to be passed as an argument. Getting
// this wrong silently installed nothing, and every configuration then ran with
// identical settings (aa=false pdb=true for all four) while the report happily
// printed four different fps numbers.
const INSTALL = (cfg) => {
  try { localStorage.setItem('austin3d.gfx.v1', JSON.stringify(cfg)); } catch (e) {}
};

const OFF = {
  bloom: 0, godRays: 0, flare: 0, dof: 0, grain: 0, ao: false, shadows: true,
  exposure: 1, contrast: 1, saturation: 1, vignette: 0.6, renderScale: 1,
  clouds: 1, stars: 1, fov: 58, preset: 'custom', autoDetected: true,
};

const CONFIGS = [
  ['before   (MSAA on, no FX)',   Object.assign({}, OFF, { msaa: true })],
  ['perf fix (MSAA off, no FX)',  Object.assign({}, OFF, { msaa: false })],
  ['ships    (balanced)', {
    preset: 'balanced', autoDetected: true, msaa: false, renderScale: 1,
    bloom: 0.40, godRays: 0.5, flare: 0.3, dof: 0.30,
    exposure: 1.03, contrast: 1.06, saturation: 1.1, vignette: 1.0, grain: 0.1,
    ao: true, shadows: true, clouds: 1, stars: 1, fov: 58 }],
  ['ships    (performance)', {
    preset: 'performance', autoDetected: true, msaa: false, renderScale: 0.75,
    bloom: 0, godRays: 0, flare: 0, dof: 0,
    exposure: 1, contrast: 1, saturation: 1, vignette: 0.6, grain: 0,
    ao: false, shadows: true, clouds: 0.4, stars: 0.5, fov: 58 }],
];

const browser = await launch(chromium, { headless: false });

async function once(cfg) {
  const page = await browser.newPage({ viewport: { width: 2560, height: 1400 } });
  await page.addInitScript(INSTALL, cfg);
  await page.goto(`${BASE}/index.html?drift=0&intro=0`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });
  await page.waitForTimeout(6000);
  await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
  await page.evaluate(() => {
    window.__map.jumpTo({ center: [-97.7434, 30.2857], zoom: 16.5, pitch: 70, bearing: 0 });
    window.applyTimeOfDay(window.__map, 0.12, true);
  });
  await page.waitForTimeout(2500);
  const r = await page.evaluate(async () => {
    const m = window.__map;
    const dts = []; const t0 = performance.now();
    await new Promise(res => {
      let last = null;
      const step = ts => {
        if (last !== null) dts.push(ts - last);
        last = ts;
        const el = performance.now() - t0;
        // 90 deg of yaw over 4 s from a fixed point: every run renders exactly
        // the same city, so the only variable left is the settings.
        m.jumpTo({ center: [-97.7434, 30.2857], zoom: 16.5, pitch: 70, bearing: 90 * el / 4000 });
        if (el > 4000) return res();
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    const dropped = dts.reduce((a, d) => a + Math.max(0, Math.round(d / 16.67) - 1), 0);
    const el = dts.reduce((a, d) => a + d, 0);
    const gl = window.__map.getCanvas().getContext('webgl2') || window.__map.getCanvas().getContext('webgl');
    const at = gl.getContextAttributes();
    const sky = document.getElementById('sky-canvas');
    const cv = window.__map.getCanvas();
    return {
      fps: 1000 * dts.length / el, dropped,
      aa: at.antialias, pdb: at.preserveDrawingBuffer, buf: cv.width,
      skyBytes: sky ? sky.width * sky.height * 4 : 0,
      viewBytes: cv.width * cv.height * 4,
    };
  });
  await page.close();
  return r;
}

const runs = CONFIGS.map(() => []);
for (let rep = 0; rep < REPS; rep++) {
  for (let i = 0; i < CONFIGS.length; i++) {
    runs[i].push(await once(CONFIGS[i][1]));
    process.stdout.write('.');
  }
}
console.log('\n');

const med = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
console.log(`2560x1400, real GPU, 4 s of continuous flight, median of ${REPS} interleaved runs:\n`);
console.log('configuration'.padEnd(28) + 'fps (min-max)'.padEnd(20) + 'dropped (min-max)'.padEnd(20) + 'context');
for (let i = 0; i < CONFIGS.length; i++) {
  const rs = runs[i];
  const f = rs.map(r => r.fps), d = rs.map(r => r.dropped);
  console.log(CONFIGS[i][0].padEnd(28) +
    (med(f).toFixed(1) + ' (' + Math.min(...f).toFixed(0) + '-' + Math.max(...f).toFixed(0) + ')').padEnd(20) +
    (med(d) + ' (' + Math.min(...d) + '-' + Math.max(...d) + ')').padEnd(20) +
    'aa=' + rs[0].aa + ' pdb=' + rs[0].pdb + ' buf=' + rs[0].buf);
}

const s = runs[2][0];
console.log('\nSky canvas is sized to the sky band, not the viewport: ' +
  (s.skyBytes / 1048576).toFixed(2) + ' MB/frame against ' +
  (s.viewBytes / 1048576).toFixed(1) + ' MB for a full-screen one (' +
  (100 * s.skyBytes / s.viewBytes).toFixed(0) + '%).');

await browser.__done();
