/**
 * arts-perf.mjs — what does the arts precinct actually cost?
 *
 * Shaped after scripts/verify/ground-perf.mjs and outer-perf.mjs, and every one
 * of those choices is load-bearing:
 *
 *   HEADED, because the rest of the suite runs `--use-angle=swiftshader`, which
 *     is right for pixel assertions and useless for timing — software
 *     rasterisation moves the whole cost onto fill rate.
 *   index.html, not _harness.html, whose rAF shim pins the loop at ~60 Hz no
 *     matter how slow a frame really is.
 *   ?arts=0 rather than two checkouts, so the A and the B are the same build,
 *     the same data on disk and the same machine state.
 *   INTERLEAVED A/B/A/B and the MINIMUM of the reps, never the mean. A mean
 *     measures the machine, and that mistake has already produced one false
 *     regression report in this repo.
 *   No screenshots during a timing run (they block ~250 ms).
 *   A scripted bearing sweep, so every rep renders identical content and every
 *     frame is a real redraw rather than a cached one.
 *   Occlusion/throttling flags, because Chrome throttles rAF in a window it
 *     believes is hidden: outer-perf.mjs once measured a p10 of exactly 50.00 ms
 *     against 49.90 ms, which is the window manager, not the scene.
 *
 * Counts DROPPED FRAMES rather than median frame time: the median sits on the
 * vsync floor even while half the frames are being dropped.
 *
 * Usage:  node arts-perf.mjs [reps]      # needs the repo served; set VERIFY_URL
 */
import { chromium } from 'playwright-core';
import { chromePath, BASE as SERVER } from './chrome.mjs';

const REPS = Number(process.argv[2] || 4);
const MS = 4200;

// Two poses: one that fills the frame with this pass, and one at the altitude
// the app actually cruises at, where the precinct is a small part of a full
// scene. A pass can be free in the second and expensive in the first.
const POSES = {
  close: { center: [-97.73742, 30.28110], zoom: 17.0, pitch: 64 },
  cruise: { center: [-97.73480, 30.28360], zoom: 15.6, pitch: 70 },
};

const browser = await chromium.launch({
  executablePath: chromePath(), headless: false,
  args: ['--no-sandbox',
         '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
         '--disable-background-timer-throttling',
         '--disable-features=CalculateNativeWinOcclusion'],
});

async function open(on) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await page.bringToFront();
  await page.goto(SERVER + '/index.html?intro=0&drift=0' + (on ? '' : '&arts=0'), { timeout: 90000 });
  await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 90000 });
  await page.waitForTimeout(9000);
  await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
  return page;
}

// Both pages stay open for the whole run and are alternated, so an A and its
// paired B are separated by seconds rather than by a page load.
const pages = { on: await open(true), off: await open(false) };
const present = await pages.on.evaluate(() => {
  const m = window.__map;
  return { layer: !!m.getLayer('arts-solid'), src: !!m.getSource('austin-arts') };
});
const absent = await pages.off.evaluate(() => !!window.__map.getLayer('arts-solid'));
if (!present.layer || absent) {
  console.log('SETUP WRONG: on=%j  off has layer=%j — the A/B is not measuring this pass',
              present, absent);
}

async function run(page, pose) {
  await page.bringToFront();
  await page.evaluate((p) => window.__map.jumpTo(Object.assign({ bearing: 0 }, p)), pose);
  await page.waitForTimeout(1500);
  return page.evaluate(async ({ ms, pose }) => {
    const m = window.__map;
    const dts = [];
    let last = performance.now(), t0 = last, b = 0;
    await new Promise(res => {
      const step = () => {
        const now = performance.now();
        dts.push(now - last); last = now;
        b += 0.9;
        m.jumpTo(Object.assign({}, pose, { bearing: b }));
        if (now - t0 < ms) requestAnimationFrame(step); else res();
      };
      requestAnimationFrame(step);
    });
    // Drop the first three: the first frames after a jumpTo include tile work.
    const d = dts.slice(3);
    const dropped = d.reduce((a, x) => a + Math.max(0, Math.round(x / 16.67) - 1), 0);
    const sorted = d.slice().sort((x, y) => x - y);
    return {
      dropped, frames: dts.length,
      fps: +(1000 * dts.length / (performance.now() - t0)).toFixed(1),
      p50: +sorted[sorted.length >> 1].toFixed(2),
      p90: +sorted[Math.floor(sorted.length * 0.9)].toFixed(2),
    };
  }, { ms: MS, pose });
}

const out = {};
for (const poseName of Object.keys(POSES)) {
  out[poseName] = { on: [], off: [] };
  for (let r = 0; r < REPS; r++) {
    // A, B, then B, A on the next rep — so a machine that warms or cools over
    // the run cannot systematically favour one side.
    const order = r % 2 ? ['off', 'on'] : ['on', 'off'];
    for (const k of order) out[poseName][k].push(await run(pages[k], POSES[poseName]));
  }
}

console.log('\npose    config   dropped(MIN)   fps(best)   p50(min)  p90(min)   [all reps dropped]');
for (const [poseName, res] of Object.entries(out)) {
  for (const k of ['on', 'off']) {
    const a = res[k];
    console.log('%-7s %-8s %6d        %7.1f   %7.2f  %7.2f    [%s]',
      poseName, k === 'on' ? 'arts ON' : 'arts=0',
      Math.min(...a.map(x => x.dropped)), Math.max(...a.map(x => x.fps)),
      Math.min(...a.map(x => x.p50)), Math.min(...a.map(x => x.p90)),
      a.map(x => x.dropped).join(', '));
  }
  const d = Math.min(...res.on.map(x => x.dropped)) - Math.min(...res.off.map(x => x.dropped));
  const t = Math.min(...res.on.map(x => x.p50)) - Math.min(...res.off.map(x => x.p50));
  console.log('%-7s DELTA    %+6d frames dropped, %+.2f ms at p50\n', poseName, d, t);
}
await browser.close();
