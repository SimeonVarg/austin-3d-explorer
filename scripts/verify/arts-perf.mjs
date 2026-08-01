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
 *   ONE PAGE with the four arts layers toggled, not two pages on ?arts=0 and
 *     not two checkouts. Two pages measured the scene as consistently FASTER
 *     with the pass ON — 20.3 ms against 22.0 ms at p50, in the same direction
 *     at both poses and at every rep count — which is not a thing 79 extra
 *     features can do. Chrome does not give two live MapLibre tabs sharing a
 *     GPU process symmetrical treatment, and no amount of interleaving fixes a
 *     confound that lives in the harness. ground-perf.mjs toggles layer
 *     visibility on one page for exactly this reason; so does this now.
 *     ?arts=0 still exists — it is how arts-shots.mjs takes a BEFORE.
 *   INTERLEAVED A/B/A/B and the MINIMUM of the reps, never the mean. A mean
 *     measures the machine, and that mistake has already produced one false
 *     regression report in this repo.
 *   No screenshots during a timing run (they block ~250 ms).
 *   A scripted bearing sweep, so every rep renders identical content and every
 *     frame is a real redraw rather than a cached one.
 *   Occlusion/throttling flags, because Chrome throttles rAF in a window it
 *     believes is hidden: outer-perf.mjs once measured a p10 of exactly 50.00 ms
 *     against 49.90 ms, which is the window manager, not the scene.
 *   DISCARDED WARM-UP REPS, because without them this rig measures shader
 *     compilation rather than the scene — see the comment above WARMUP below,
 *     which is where this file reported the scene as FASTER with 79 extra
 *     features in it.
 *
 * Counts DROPPED FRAMES rather than median frame time: the median sits on the
 * vsync floor even while half the frames are being dropped.
 *
 * Usage:  node arts-perf.mjs [reps]      # needs the repo served; set VERIFY_URL
 */
import { chromium } from 'playwright-core';
import { chromePath, BASE as SERVER, launch } from './chrome.mjs';

const REPS = Number(process.argv[2] || 4);
const MS = 4200;

// Two poses: one that fills the frame with this pass, and one at the altitude
// the app actually cruises at, where the precinct is a small part of a full
// scene. A pass can be free in the second and expensive in the first.
const POSES = {
  close: { center: [-97.73742, 30.28110], zoom: 17.0, pitch: 64 },
  cruise: { center: [-97.73480, 30.28360], zoom: 15.6, pitch: 70 },
};

const browser = await launch(chromium, { gl: 'hardware' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.bringToFront();
await page.goto(SERVER + '/index.html?intro=0&drift=0', { timeout: 90000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 90000 });
await page.waitForFunction(() => window.__map.getLayer('arts-solid'), null, { timeout: 120000 });
await page.waitForTimeout(6000);
// The graphics auto-detect rewrites every setting ~11 s in, which mid-run would
// change what is being measured.
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

const ARTS_LAYERS = ['arts-solid', 'arts-panel', 'arts-glass', 'arts-cap'];

async function run(on, pose) {
  await page.evaluate(({ on, pose, L }) => {
    const m = window.__map;
    for (const id of L) {
      try { m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'); } catch (e) {}
    }
    m.jumpTo(Object.assign({ bearing: 0 }, pose));
  }, { on, pose, L: ARTS_LAYERS });
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
    // Drop the first three: the frames right after a jumpTo include tile work.
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

// ── warm-up, and why it is not optional ──────────────────────────────
// Measuring straight away reported a steeply descending series inside each
// configuration (142 -> 136 -> 31 -> 29 on one side), which is shader
// compilation and tile caching. Taking the MINIMUM of a descending series just
// reports whichever configuration happened to hold the deepest slots in the
// warm-up curve; alternating the order balances the mean position, not the
// minimum. So the first WARMUP reps of each configuration are thrown away.
const WARMUP = 2;

const out = {};
for (const poseName of Object.keys(POSES)) {
  out[poseName] = { on: [], off: [] };
  for (let r = 0; r < WARMUP; r++) {
    for (const k of [true, false]) await run(k, POSES[poseName]);
  }
  for (let r = 0; r < REPS; r++) {
    // A, B then B, A on the next rep, so a machine that drifts over the run
    // cannot systematically favour one side.
    const order = r % 2 ? [false, true] : [true, false];
    for (const on of order) out[poseName][on ? 'on' : 'off'].push(await run(on, POSES[poseName]));
  }
}

// console.log in Node is util.format: it understands %s and %d, and NOT the
// %-7s width specifiers this originally used, which printed the format string
// verbatim with the values tacked on the end.
const pad = (v, n) => String(v).padEnd(n);
const padS = (v, n) => String(v).padStart(n);
console.log('\npose    config    dropped(MIN)  fps(best)  p50(min)  p90(min)   [reps dropped]');
for (const [poseName, res] of Object.entries(out)) {
  for (const k of ['on', 'off']) {
    const a = res[k];
    console.log([
      pad(poseName, 8), pad(k === 'on' ? 'arts ON' : 'arts off', 9),
      padS(Math.min(...a.map(x => x.dropped)), 8),
      padS(Math.max(...a.map(x => x.fps)).toFixed(1), 11),
      padS(Math.min(...a.map(x => x.p50)).toFixed(2), 10),
      padS(Math.min(...a.map(x => x.p90)).toFixed(2), 9),
      '   [' + a.map(x => x.dropped).join(', ') + ']',
    ].join(''));
  }
  const d = Math.min(...res.on.map(x => x.dropped)) - Math.min(...res.off.map(x => x.dropped));
  const t = Math.min(...res.on.map(x => x.p50)) - Math.min(...res.off.map(x => x.p50));
  console.log(pad(poseName, 8) + pad('DELTA', 9) +
              (d >= 0 ? '+' : '') + d + ' frames dropped, ' +
              (t >= 0 ? '+' : '') + t.toFixed(2) + ' ms at p50\n');
}
await browser.__done();
