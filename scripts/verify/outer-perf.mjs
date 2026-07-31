/**
 * outer-perf.mjs — what the outer ring costs, measured, on the paths it is for.
 *
 * The scene was ALREADY at its frame budget before this pass (js/graphics.js
 * auto-drops to the performance preset at ~30 fps), so "does it still build" is
 * not a result. This is the A/B: the SAME app, the SAME camera path, the SAME
 * graphics settings, with `?outer=0` turning the ring off at load.
 *
 * Methodology is inherited wholesale from perf3.mjs, because every one of its
 * lessons was paid for once already:
 *   - HEADED, real GPU. swiftshader moves the whole cost onto fill rate and
 *     would report a geometry change as free.
 *   - index.html, never _harness.html — its rAF shim pins the loop at ~60 Hz.
 *   - count DROPPED FRAMES; a median frame time sits on the vsync floor even
 *     while half the frames are missed.
 *   - interleave the configurations and repeat; four sequential runs of the
 *     same configuration once produced a 2x spread of pure noise.
 *   - script a fixed camera sweep so every run renders identical content.
 *
 * Three camera paths, because the ring's cost is not uniform: over West Campus
 * almost none of it is on screen, and looking south from campus nearly all of
 * it is.
 *
 * Usage:  node outer-perf.mjs [reps]
 */
import { chromium } from 'playwright-core';
import { chromePath, BASE } from './chrome.mjs';

const REPS = Number(process.argv[2] || 3);
// 12 s capture x 2 configurations x 3 paths x REPS. Keep REPS >= 2.
// 2560x1400, same as perf3.mjs, and for the same reason: at 1440x900 with
// vsync on this scene sits ON the 16.67 ms floor and every configuration reads
// as identical. A frame time only means something when the frame is genuinely
// GPU-bound, so the harness has to push the GPU past vsync before it can
// measure anything at all.
const VW = 2560, VH = 1400;

// Fixed graphics settings for every run: whatever the ring costs must be read
// against a constant, and the auto-detect probe would otherwise change the
// preset halfway through the suite.
const GFX = {
  preset: 'balanced', autoDetected: true, msaa: false, renderScale: 1,
  bloom: 0.40, godRays: 0.5, flare: 0.3, dof: 0.30,
  exposure: 1.03, contrast: 1.06, saturation: 1.1, vignette: 1.0, grain: 0.1,
  ao: true, shadows: true, clouds: 1, stars: 1, fov: 58,
};
const INSTALL = (cfg) => {
  try { localStorage.setItem('austin3d.gfx.v1', JSON.stringify(cfg)); } catch (e) {}
};

// index.html does not carry <script src="js/outer.js"> yet — it is owned by
// another pass and gets a one-line paste (docs/OUTER_RING.md). Timing MUST be
// measured on index.html, not _harness.html, whose rAF shim pins the loop at
// ~60 Hz and would report every configuration as identical. So the tag is
// injected here, which is byte-for-byte what the paste will do: outer.js
// bootstraps off window.__map and does not care when it loads.
// It still honours ?outer=0, so the A/B is a real A/B on one build.
const INJECT = () => {
  const add = () => {
    if (document.querySelector('script[src="js/outer.js"]')) return;
    const s = document.createElement('script');
    s.src = 'js/outer.js';
    document.head.appendChild(s);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add);
  else add();
};

// Each path is a 4 s move with a fixed start and end pose. `t` is 0..1.
const PATHS = {
  // The spawn pose, yawing 90 deg. Mostly core scene: the control.
  'west campus (core only)': {
    at: t => ({ center: [-97.7434, 30.2857], zoom: 16.5, pitch: 74, bearing: 250 + 90 * t }),
  },
  // Campus looking south at downtown — the shot the extension exists for, and
  // the worst case: the whole ring is in front of the camera.
  'campus -> downtown': {
    at: t => ({ center: [-97.7425, 30.2900 - 0.0075 * t], zoom: 15.1, pitch: 77, bearing: 178 }),
  },
  // Low along the lake, looking back north into the towers.
  'along the lake': {
    at: t => ({ center: [-97.7640 + 0.0140 * t, 30.2620], zoom: 14.8, pitch: 80, bearing: 60 }),
  },
};

const browser = await chromium.launch({
  executablePath: chromePath(), headless: false,
  // The first run of this reported a p10 of EXACTLY 50.00 ms against 49.90 ms —
  // 20 Hz, quantised, identical for both configurations. That is not a scene
  // cost, it is Chrome throttling requestAnimationFrame in a window it thinks
  // is occluded, which it was: three other agents had 32 Chrome windows in
  // front of it. Without these flags the harness measures the window manager.
  //
  // VSYNC STAYS ON, and that decision took three wrong runs to reach. With it
  // OFF, a WebGL frame delta measures how fast the CPU can SUBMIT draw calls,
  // not how long the GPU takes to execute them — the fastest frames came back
  // at 1.9 ms for a scene of 10,000 extrusions, which is a queue depth, not a
  // render. With it ON, the delta includes the wait for the GPU, so the number
  // is real; it just cannot resolve anything faster than the refresh. The way
  // out is to make the scene genuinely GPU-bound (see VW/VH below), which is
  // exactly why perf3.mjs runs at 2560x1400.
  args: ['--no-sandbox',
         '--disable-backgrounding-occluded-windows',
         '--disable-renderer-backgrounding',
         '--disable-background-timer-throttling',
         '--disable-features=CalculateNativeWinOcclusion'],
});

async function once(pathName, outerOn) {
  const page = await browser.newPage({ viewport: { width: VW, height: VH } });
  await page.bringToFront();
  await page.addInitScript(INSTALL, GFX);
  await page.addInitScript(INJECT);
  const q = `?intro=0&drift=0${outerOn ? '' : '&outer=0'}`;
  // `networkidle` never settles here: the basemap streams tiles for as long as
  // the camera keeps moving, so waiting for it burned minutes per run for no
  // benefit. The source-loaded check below is the real readiness signal.
  const tRun = Date.now();
  await page.goto(`${BASE}/index.html${q}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 90000 });
  // Wait for every source to finish tiling, not for a clock: the ring is an
  // extra megabyte of GeoJSON and a fixed sleep measured the fetch, not the
  // frame.
  await page.waitForFunction(() => {
    const m = window.__map;
    if (!m || !m.getSource('austin-buildings')) return false;
    return ['austin-buildings', 'austin-outer', 'austin-ground', 'austin-trees']
      .every(s => !m.getSource(s) || m.isSourceLoaded(s));
  }, null, { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(4000);
  await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
  await page.evaluate(() => window.applyTimeOfDay(window.__map, 0.30, true));
  await page.waitForTimeout(2500);

  const r = await page.evaluate(async (name) => {
    const m = window.__map;
    const PATHS = {
      'west campus (core only)': t => ({ center: [-97.7434, 30.2857], zoom: 16.5, pitch: 74, bearing: 250 + 90 * t }),
      'campus -> downtown': t => ({ center: [-97.7425, 30.2900 - 0.0075 * t], zoom: 15.1, pitch: 77, bearing: 178 }),
      'along the lake': t => ({ center: [-97.7640 + 0.0140 * t, 30.2620], zoom: 14.8, pitch: 80, bearing: 60 }),
    };
    const at = PATHS[name];
    m.jumpTo(at(0));
    await new Promise(r2 => setTimeout(r2, 1500));
    // TWELVE seconds, not four, and the statistic that matters is the FASTEST
    // frame rather than the average one. Four seconds on a machine running
    // three other agents gave ~48 frames whose median swung 83-233 ms; the
    // report that came out of it had the outer ring making the scene 16 ms
    // FASTER, which is not a result. Twelve seconds is ~150 frames, and the
    // fastest few are the ones where nothing else was competing for the GPU —
    // which is exactly the number this is trying to isolate: what OUR geometry
    // costs. The camera still sweeps the same fixed path, three times over, so
    // every run renders identical content.
    const DUR = 12000, LEG = 4000;
    const dts = []; const t0 = performance.now();
    await new Promise(res => {
      let last = null;
      const step = ts => {
        if (last !== null) dts.push(ts - last);
        last = ts;
        const el = performance.now() - t0;
        m.jumpTo(at((el % LEG) / LEG));
        if (el > DUR) return res();
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    const dropped = dts.reduce((a, d) => a + Math.max(0, Math.round(d / 16.67) - 1), 0);
    const el = dts.reduce((a, d) => a + d, 0);
    const sorted = [...dts].sort((a, b) => a - b);
    const at_ = f => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * f))];
    // Average of the fastest 5%: one single minimum is a lucky frame, the
    // fastest 5% of ~150 is eight of them and still excludes everything the
    // scheduler touched.
    const nBest = Math.max(3, Math.round(sorted.length * 0.05));
    const fastest = sorted.slice(0, nBest).reduce((a, b) => a + b, 0) / nBest;
    // ── the GPU-stalled pass ─────────────────────────────────────────
    // Everything above is wall-clock, and wall-clock on this machine cannot
    // resolve the answer: with vsync on the fastest frames sit exactly on
    // 16.5 ms for every configuration, and the median swings 33-116 ms between
    // repeats of the SAME configuration. So measure the GPU directly.
    //
    // `readPixels` is a synchronising call: it cannot return until every draw
    // submitted before it has actually executed. Issuing one 1x1 read at the
    // end of MapLibre's own `render` event turns each frame from "how fast can
    // the CPU submit" into "how long did the GPU take", which is the number a
    // geometry change actually moves. It needs preserveDrawingBuffer, which the
    // fixed GFX above already asks for via bloom > 0.
    const gpu = [];
    {
      const gl = m.getCanvas().getContext('webgl2') || m.getCanvas().getContext('webgl');
      const px = new Uint8Array(4);
      let t1 = 0;
      const onRender = () => {
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);   // stall
        const now = performance.now();
        gpu.push(now - t1);
        t1 = now;
      };
      m.on('render', onRender);
      // 120 forced renders along the same path. jumpTo dirties the transform,
      // so every one of them is a real full-scene draw.
      for (let i = 0; i < 120; i++) {
        m.jumpTo(at((i / 40) % 1));
        t1 = performance.now();
        m.triggerRepaint();
        await new Promise(r2 => requestAnimationFrame(r2));
      }
      m.off('render', onRender);
    }
    const gs = gpu.slice(2).sort((a, b) => a - b);
    const gpuMed = gs.length ? gs[Math.floor(gs.length / 2)] : null;
    const gpuFast = gs.length
      ? gs.slice(0, Math.max(3, Math.round(gs.length * 0.1)))
          .reduce((a, b) => a + b, 0) / Math.max(3, Math.round(gs.length * 0.1))
      : null;

    return {
      gpuMed, gpuFast,
      fps: 1000 * dts.length / el,
      dropped: Math.round(dropped / (DUR / 4000)),   // normalised back to per-4s
      frames: dts.length,
      // p10 is the headline: the fastest decile is the frame the scheduler did
      // not steal, so it isolates what the GPU did with our geometry rather
      // than what the rest of the machine was doing. The median is printed
      // beside it — if the two disagree wildly the run was contended and the
      // spread says so. scripts/verify/README.md: take the minimum of many
      // timings, not the mean.
      fastest, p10: at_(0.10), med: at_(0.50), p90: at_(0.90),
      ringLoaded: !!m.getSource('austin-outer'),
      // NOT queryRenderedFeatures. At pitch 77 it returns 0 for buildings-3d in
      // a scene that is visibly full of buildings — measured — so it reads as
      // "nothing is drawn" when everything is. Source features per tile is a
      // number that means something.
      ringSrc: (() => { try { return m.querySourceFeatures('austin-outer').length; } catch (e) { return -1; } })(),
      coreSrc: (() => { try { return m.querySourceFeatures('austin-buildings').length; } catch (e) { return -1; } })(),
    };
  }, pathName);
  await page.close();
  r.wallSeconds = Math.round((Date.now() - tRun) / 1000);
  return r;
}

const med = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const best = a => Math.min(...a);
const fmt = (a, d = 1) => `${med(a).toFixed(d)} (${Math.min(...a).toFixed(d)}-${Math.max(...a).toFixed(d)})`;

console.log(`${VW}x${VH}, real GPU, ${REPS} interleaved runs per path.`);
console.log('12 s capture per run (~150 frames). "fastest" is the mean of the quickest 5% of\n' +
            'frames, taken as the best of the runs: what OUR geometry costs with the machine\'s\n' +
            'noise removed. The median is printed beside it so you can see how noisy it was.\n');
console.log('path'.padEnd(26) + 'ring'.padEnd(6) + 'GPU ms (stalled)'.padEnd(26) +
            'wall fastest'.padEnd(14) + 'wall median'.padEnd(20) + 'dropped/4s');

// `--path <substring>` narrows the suite to one camera path, so the worst case
// can be measured with enough repeats to say something without paying for the
// other two.
const only = process.argv.includes('--path')
  ? process.argv[process.argv.indexOf('--path') + 1] : null;

const rows = {};
for (const name of Object.keys(PATHS)) {
  if (only && !name.includes(only)) continue;
  const runs = { off: [], on: [] };
  for (let rep = 0; rep < REPS; rep++) {
    const a = await once(name, false); runs.off.push(a);
    process.stdout.write(`  [${name} rep${rep + 1} off ${a.wallSeconds}s gpu ${a.gpuMed.toFixed(2)}ms]
`);
    const b2 = await once(name, true); runs.on.push(b2);
    process.stdout.write(`  [${name} rep${rep + 1} on  ${b2.wallSeconds}s gpu ${b2.gpuMed.toFixed(2)}ms]
`);
  }
  process.stdout.write('\r');
  for (const key of ['off', 'on']) {
    const rs = runs[key];
    console.log(
      (key === 'off' ? name : '').padEnd(26) + key.padEnd(6) +
      (fmt(rs.map(r => r.gpuMed), 2) + ' med').padEnd(26) +
      best(rs.map(r => r.fastest)).toFixed(2).padEnd(14) +
      fmt(rs.map(r => r.med), 1).padEnd(20) +
      fmt(rs.map(r => r.dropped), 0));
  }
  // PAIRED, not "median of one set minus median of the other".
  //
  // Repeats of the SAME configuration on this machine swing 47-73 ms — wider
  // than the effect being measured — and the level drifts upward through a long
  // run as the GPU heats. Comparing the two medians therefore produced +9.04,
  // -1.55 and -13.93 ms for one change on three paths: three different signs.
  // Each rep runs off and on back to back, seconds apart, so differencing
  // WITHIN a rep cancels most of the drift, and the median of those paired
  // differences is the estimate. Print all of them: if they straddle zero by
  // more than the median, the honest answer is "below this machine's floor",
  // not the median.
  const pairs = runs.off.map((o, i) => runs.on[i].gpuMed - o.gpuMed);
  const dPair = med(pairs);
  const spread = Math.max(...pairs) - Math.min(...pairs);
  rows[name] = dPair;
  console.log(''.padEnd(26) +
    `-> paired GPU deltas: ${pairs.map(v => (v >= 0 ? '+' : '') + v.toFixed(1)).join('  ')}`);
  console.log(''.padEnd(26) +
    `   median ${(dPair >= 0 ? '+' : '') + dPair.toFixed(2)} ms/frame ` +
    `(${(100 * dPair / med(runs.off.map(r => r.gpuMed))).toFixed(1)}% of the frame), ` +
    `pair-to-pair spread ${spread.toFixed(1)} ms` +
    (spread > 4 * Math.abs(dPair) ? '  <- SPREAD EXCEEDS THE EFFECT' : ''));
  console.log(''.padEnd(26) +
    `   [ring source features ${runs.on[0].ringSrc}, core ${runs.on[0].coreSrc}]\n`);
}
console.log('summary (paired median GPU delta):', Object.entries(rows)
  .map(([k, v]) => `${k} ${v >= 0 ? '+' : ''}${v.toFixed(2)} ms`).join('   |   '));

await browser.close();
