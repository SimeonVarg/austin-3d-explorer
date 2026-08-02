/**
 * where-time-goes.mjs — before spending $10,000 on a GPU, measure what is slow.
 *
 * THE QUESTION. A verification pass takes minutes and pins the machine. The
 * proposal in docs/CLOUD.md is to rent a cloud GPU so headless Chrome stops
 * falling back to SwiftShader. That is only worth doing if the time actually
 * goes into RENDERING. If it goes into fetching JSON, parsing it, tiling it in
 * a worker, or repainting the facade atlas on the CPU, a GPU buys nothing and
 * the money is wasted.
 *
 * So: measure, then decide. Run this on any machine to see where its time goes.
 *
 * WHAT IT MEASURES, and why each phase is split out:
 *
 *   launch / load / style / tiles   startup. Network and CPU. A GPU cannot
 *                                   touch any of it.
 *   sustained repaint               frames per second with the map being told
 *                                   to redraw continuously. THE number.
 *   jumpTo round-trip               how long a trivial evaluate() takes to come
 *                                   back after the camera moves. This is the
 *                                   surprising one — see below.
 *   idle after jumpTo               waiting for new tiles. CPU and network.
 *   screenshot, first / second      the capture itself. The second is at a pose
 *                                   with nothing left to load, so it is close to
 *                                   pure render + readback.
 *
 * WHAT IT FOUND ON THE ACER (2026-08-01), and the wrong turn it caused:
 *
 *   SwiftShader   4.4 fps    hardware GL   32.1 fps     7.3x
 *   whole run   224.1 s      whole run    206.7 s       1.08x
 *
 * Rendering got seven times faster and the run barely moved. So most of a pass
 * is NOT GL work, and a faster GPU cannot fix it.
 *
 * THE FIRST VERSION OF THIS FILE GOT THAT WRONG. It reported a "jumpTo
 * round-trip" of ~60 s and this comment claimed the main thread was saturated
 * rasterising. Timing the same three poses from INSIDE the page says otherwise:
 *
 *   jumpTo() itself            5-14 ms
 *   main thread free after      1-4 ms
 *   map idle after           0.6-3.9 s
 *   a trivial round-trip after      4 ms
 *
 * Under four seconds of real work per pose. The 60 s was this harness measuring
 * its own driver overhead and attributing it to whatever command came next. A
 * measurement that blames the wrong thing is worse than no measurement, and it
 * nearly justified renting a GPU.
 *
 * THE HONEST NUMBER is the real script end to end. shot.mjs, three poses:
 *
 *   SwiftShader  189 s        hardware GL   98 s        1.9x
 *
 * Nearly twice as fast, for free, by not passing --use-angle=swiftshader. That
 * is the whole finding. See docs/CLOUD.md.
 *
 * So treat the per-phase numbers below as INDICATIVE, not as a budget. The two
 * that are trustworthy are the GL renderer string and the sustained fps.
 *
 * Usage: serve the repo, then  node where-time-goes.mjs
 */
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';

const POSES = [
  { center: [-97.7393, 30.2860], zoom: 17.0, pitch: 68, bearing: 90 },
  { center: [-97.7373, 30.2860], zoom: 17.0, pitch: 68, bearing: 130 },
  { center: [-97.7353, 30.2860], zoom: 17.0, pitch: 68, bearing: 170 },
];

const t0 = Date.now();
const phase = {};
let last = t0;
const lap = n => { const now = Date.now(); phase[n] = now - last; last = now; };
const ms = async fn => { const t = Date.now(); await fn(); return Date.now() - t; };

const browser = await launch(chromium);                                        lap('launch browser');
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e => console.log('PAGEERR', e.message));

// _harness.html forces preserveDrawingBuffer, which is what the pixel-sampling
// scripts need and what a screenshot has to read back.
await page.goto(BASE + '/_harness.html?intro=0&drift=0', { waitUntil: 'networkidle', timeout: 90000 });
                                                                               lap('load page');
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 90000 });
                                                                               lap('style loaded');
await page.waitForFunction(() => {
  const m = window.__map;
  return m.getSource('austin-buildings') && m.isSourceLoaded('austin-buildings');
}, null, { timeout: 90000 }).catch(() => console.log('WARN: buildings source never reported loaded'));
                                                                               lap('buildings tiled');
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
await page.waitForTimeout(6000);                                               lap('settle');

const gl = await page.evaluate(() => {
  const c = window.__map.getCanvas();
  const g = c.getContext('webgl2') || c.getContext('webgl');
  const d = g && g.getExtension('WEBGL_debug_renderer_info');
  return {
    renderer: d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unavailable',
    vendor: d ? g.getParameter(d.UNMASKED_VENDOR_WEBGL) : 'unavailable',
  };
});

// Frames per second with the map told to redraw as fast as it can. On a GPU box
// this is the headline number to compare.
const fps = await page.evaluate(() => new Promise(res => {
  const m = window.__map;
  let n = 0; const t = performance.now();
  const tick = () => {
    n++; m.triggerRepaint();
    if (performance.now() - t < 4000) requestAnimationFrame(tick);
    else res({ frames: n, ms: performance.now() - t });
  };
  requestAnimationFrame(tick);
}));                                                                           lap('4 s forced repaint');

let jump = 0, idle = 0, shot = 0, warm = 0;
for (const pose of POSES) {
  jump += await ms(() => page.evaluate(q => window.__map.jumpTo(q), pose));
  idle += await ms(() => page.evaluate(() => new Promise(r => {
    const m = window.__map;
    if (m.loaded()) return r();
    m.once('idle', r); setTimeout(r, 20000);
  })));
  shot += await ms(() => page.screenshot({ path: 'shots/_wtg-cold.png' }));
  warm += await ms(() => page.screenshot({ path: 'shots/_wtg-warm.png' }));
}                                                                              lap('3 poses');

const total = Date.now() - t0;
const n = POSES.length;
console.log('\nGL vendor   ' + gl.vendor);
console.log('GL renderer ' + gl.renderer);
const soft = /swiftshader|llvmpipe|softwarerasterizer|software/i.test(gl.renderer + gl.vendor);
console.log('            ' + (soft ? '*** SOFTWARE RENDERING - no usable GPU ***'
                                   : 'hardware accelerated'));
console.log('\nsustained repaint  ' + (fps.frames / (fps.ms / 1000)).toFixed(1) + ' fps'
            + '   (' + fps.frames + ' frames in ' + fps.ms.toFixed(0) + ' ms)');

console.log('\nstartup, once per run');
for (const k of ['launch browser', 'load page', 'style loaded', 'buildings tiled', 'settle']) {
  console.log('  ' + k.padEnd(24) + (phase[k] / 1000).toFixed(1).padStart(7) + ' s');
}
console.log('\nper pose, averaged over ' + n);
console.log('  jumpTo round-trip       ' + (jump / n / 1000).toFixed(1).padStart(7) + ' s'
            + '   <- MOSTLY DRIVER OVERHEAD, not the page. See the header.');
console.log('  idle (tiles)            ' + (idle / n / 1000).toFixed(1).padStart(7) + ' s'
            + '   <- CPU + network, a GPU does NOT help');
console.log('  screenshot, cold        ' + (shot / n / 1000).toFixed(1).padStart(7) + ' s');
console.log('  screenshot, warm        ' + (warm / n / 1000).toFixed(1).padStart(7) + ' s'
            + '   <- render + readback');
console.log('\nTOTAL ' + (total / 1000).toFixed(1) + ' s, of which '
            + (((phase['3 poses'] + phase['4 s forced repaint']) / total) * 100).toFixed(0)
            + '% is rendering rather than startup');

await browser.__done();
