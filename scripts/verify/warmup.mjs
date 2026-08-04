/**
 * warmup.mjs — how long after load does the app take to reach full frame rate?
 *
 * WHY THIS EXISTS. `perf.mjs` toggles one subsystem at a time and prints a delta
 * against a baseline taken at the start of the run. On 2026-08-04, with that
 * script finally pointed at a real GPU and a fixed camera pose, EVERY delta it
 * printed was the same size as the run's own drift — and the drift was not
 * random. It was monotonic and it was downward: the baseline measured 36.0 ms at
 * the top of the run and 18.0 ms when re-measured at the bottom, and under a 4x
 * CPU throttle 180.0 ms became 90.0 ms. Exactly half, both times.
 *
 * A subsystem A/B cannot see that, because it attributes the improvement to
 * whatever it happened to be toggling. So this script does not toggle anything.
 * It parks the camera at one pose, changes nothing, and just watches the frame
 * time fall.
 *
 * WHY THE ANSWER MATTERS MORE THAN ANY SUBSYSTEM DELTA. The intro flythrough
 * plays in exactly this window. HANDOFF §73 is a bug report about the opening
 * seconds — the intro flew over ground whose buildings had not arrived — and it
 * was fixed by gating the flight on the data, not by making anything faster. If
 * the app also spends its first minute at half frame rate, then the single most
 * expensive frames in the product's life are the first ones anybody sees.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not hold a key down and it does not
 * fly. README: "Hold nothing down. Flying with W makes every run cover different
 * buildings; that was a bigger noise source than any setting being compared."
 * The camera is pinned and the map is asked to repaint every frame, so every
 * window in the series renders the SAME content and the only variable left is
 * elapsed time. `triggerRepaint` is required because a still map stops drawing.
 *
 * Usage:
 *   VERIFY_URL=http://127.0.0.1:8211 node scripts/verify/warmup.mjs
 *   CPU_THROTTLE=4   emulate a weaker machine (default 1 = this machine)
 *   WINDOWS=12       how many consecutive windows to sample (default 12)
 *   WINDOW_MS=5000   length of each window (default 5000)
 */
import { chromium } from 'playwright-core';
import { BASE, launch, HW_ARGS } from './chrome.mjs';

const THROTTLE = Number(process.env.CPU_THROTTLE || 1);
const WINDOWS = Number(process.env.WINDOWS || 12);
const WINDOW_MS = Number(process.env.WINDOW_MS || 5000);

// Headed on a real GPU, for the reason perf.mjs's header gives and its code did
// not follow: software rasterisation moves the whole cost onto fill rate and
// measures nothing this script is asking about.
const browser = await launch(chromium, {
  headless: false,
  gl: 'hardware',
  args: [
    ...HW_ARGS,
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    '--disable-features=CalculateNativeWinOcclusion',
  ],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e => console.log('  [pageerror] ' + e.message));

/**
 * `drift=0` IS NOT OPTIONAL HERE, AND LEAVING IT OFF PRODUCED A FAKE DEFECT.
 *
 * `js/app.js` (~line 1722) starts an idle attract loop after `idleMs: 25000` of
 * input silence: the camera flies itself and the clock creeps forward. This
 * script deliberately touches nothing for a minute, so it is the single most
 * likely script in the suite to trip that timer — and it did. The first run
 * reported a rock-steady 18.0 ms for four windows and then a permanent step to
 * 54.0 ms at the 20-25 s mark, which reads exactly like a 3x performance
 * regression that never recovers. It was the app's own idle drift starting up
 * and flying the camera into different geometry.
 *
 * `?drift=0` is in the app precisely for scripted runs (its own comment says
 * so), and boot.mjs and payload.mjs both already pass it. The time of day is
 * also sampled per window below, so a clock change is VISIBLE in the table
 * rather than inferred from a step in the frame time.
 */
const t0 = Date.now();
await page.goto(`${BASE}/index.html?intro=0&drift=0`, { waitUntil: 'commit', timeout: 90000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 90000 });
await page.bringToFront();
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

const RENDERER = await page.evaluate(() => {
  try {
    const gl = window.__map.painter.context.gl;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  } catch (e) { return 'unknown'; }
});
console.log('\nRENDERER  ' + RENDERER);
if (/swiftshader|software|llvmpipe/i.test(String(RENDERER))) {
  console.log('  !! SOFTWARE RASTERISER — these numbers are CPU fill rate, not fps.');
}

// Wait for the city, the same condition boot.mjs uses. The clock below is
// measured from THIS moment, not from navigation, so "0 s" means "the city just
// became drawable" — which is when a visitor starts looking at it.
await page.waitForFunction(() => {
  const m = window.__map;
  const ids = Object.keys(m.getStyle().sources).filter(id => /^austin-/.test(id));
  return ids.length && ids.every(id => { try { return m.isSourceLoaded(id); } catch (e) { return false; } });
}, null, { timeout: 120000 })
  .catch(() => console.log('  WARN: city never fully loaded; series starts early'));
const readyMs = Date.now() - t0;
console.log('city drawable at ' + (readyMs / 1000).toFixed(1) + ' s'
            + (THROTTLE > 1 ? '   (CPU throttle applied AFTER this point)' : ''));

// Throttle only the RENDER, never the load — otherwise the series measures a
// slower load rather than a slower frame.
if (THROTTLE > 1) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
}
console.log('CPU throttle ' + THROTTLE + 'x   window ' + WINDOW_MS + ' ms x ' + WINDOWS
            + '   viewport 1440x900');

// Pin the camera. Nothing moves for the rest of the run.
await page.waitForFunction(() => window.__fly && !window.__fly.eye().driving, null, { timeout: 60000 })
  .catch(() => console.log('  WARN: controller still driving'));
const pose = await page.evaluate(() => {
  const m = window.__map, c = m.getCenter();
  return { lng: c.lng, lat: c.lat, zoom: m.getZoom(), bearing: m.getBearing(), pitch: m.getPitch() };
});
console.log('pose  ' + pose.lng.toFixed(5) + ',' + pose.lat.toFixed(5) + '  z' + pose.zoom.toFixed(2)
            + '  bearing ' + pose.bearing.toFixed(0) + '  pitch ' + pose.pitch.toFixed(0) + '\n');

const series = await page.evaluate(async ({ windows, windowMs }) => {
  const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  const out = [];
  for (let w = 0; w < windows; w++) {
    const dts = [];
    await new Promise(res => {
      let last = null;
      const start = performance.now();
      const step = ts => {
        if (last !== null) dts.push(ts - last);
        last = ts;
        // A still map stops rendering, so ask for the next frame explicitly.
        // Without this the series measures an idle compositor, not the scene.
        try { window.__map.triggerRepaint(); } catch (e) {}
        if (performance.now() - start >= windowMs) return res();
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    // Record the clock and the camera so a moving scene cannot masquerade as a
    // slowing one. If either changes between windows the series is void.
    const c = window.__map.getCenter();
    out.push({
      med: med(dts), n: dts.length, worst: Math.max(...dts),
      tod: window.__tod == null ? null : Number(window.__tod),
      lng: c.lng, lat: c.lat, bearing: window.__map.getBearing(),
    });
  }
  return out;
}, { windows: WINDOWS, windowMs: WINDOW_MS });

console.log('  since city drawable      median frame      fps    worst   frames    tod   moved');
const p0 = series[0];
series.forEach((r, i) => {
  const from = (i * WINDOW_MS / 1000).toFixed(0).padStart(3);
  const to = ((i + 1) * WINDOW_MS / 1000).toFixed(0).padStart(3);
  // Metres from the first window's camera position, so "did the camera move"
  // is a number in the table and not a thing anybody has to take on trust.
  const dx = (r.lng - p0.lng) * 111320 * Math.cos(r.lat * Math.PI / 180);
  const dy = (r.lat - p0.lat) * 110540;
  const moved = Math.hypot(dx, dy);
  console.log('  ' + from + '-' + to + ' s' +
              r.med.toFixed(1).padStart(16) + ' ms' +
              (1000 / r.med).toFixed(0).padStart(8) +
              r.worst.toFixed(0).padStart(9) +
              String(r.n).padStart(9) +
              (r.tod == null ? '    n/a' : r.tod.toFixed(3).padStart(7)) +
              (moved.toFixed(0) + ' m').padStart(8));
});

const movedMax = Math.max(...series.map(r =>
  Math.hypot((r.lng - p0.lng) * 111320 * Math.cos(r.lat * Math.PI / 180), (r.lat - p0.lat) * 110540)));
const todMoved = series.some(r => r.tod != null && p0.tod != null && Math.abs(r.tod - p0.tod) > 0.002);
if (movedMax > 5 || todMoved) {
  console.log('\n  !! VOID: the camera moved ' + movedMax.toFixed(0) + ' m'
              + (todMoved ? ' and the clock changed' : '')
              + ' during the series, so this is not a');
  console.log('     measurement of time — it is a measurement of a different view.');
  console.log('     Check that ?drift=0 is on the URL.');
}

const first = series[0].med, last = series[series.length - 1].med;
console.log('\nfirst window ' + first.toFixed(1) + ' ms   last window ' + last.toFixed(1) + ' ms');
if (last > 0 && first / last >= 1.4) {
  console.log('WARM-UP CONFIRMED: the app is ' + (first / last).toFixed(1) +
              'x slower per frame in its first ' + (WINDOW_MS / 1000) + ' s than at the end.');
  const settled = series.findIndex(r => r.med <= last * 1.15);
  console.log('It reaches within 15% of its settled frame time at ~' +
              ((settled + 1) * WINDOW_MS / 1000) + ' s after the city becomes drawable.');
  console.log('The intro flythrough plays inside that window.');
} else {
  console.log('No warm-up ramp at this throttle: first and last windows agree within 40%.');
}

await browser.__done();
