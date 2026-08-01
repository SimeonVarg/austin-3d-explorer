/**
 * facade-perf.mjs — is `fill-extrusion-pattern` what makes this app laggy?
 *
 * THE CLAIM UNDER TEST: "the window patterns (fill-extrusion-pattern) are what
 * makes this app laggy with motion, and replacing them will fix it."
 *
 * This script is written to REFUTE that claim if the numbers allow it, so it is
 * deliberately generous to the claim in three ways:
 *   1. The alternative is the CHEAPEST fill-extrusion that exists — a single
 *      constant `fill-extrusion-color`, no data-driven expression, no pattern
 *      lookup, no atlas sampling. If the pattern costs anything at all, this is
 *      the configuration that will show it.
 *   2. The pattern is stripped from EVERY layer that carries one (buildings-3d,
 *      the parts walls, the union-24 walls, the outer-ring towers), enumerated
 *      from the live style rather than hardcoded, so nothing is left paying.
 *   3. One of the two camera paths is a low close orbit through downtown where
 *      facade pixels fill most of the frame — the pattern's worst case.
 *
 * And then it puts the answer in context by measuring the OTHER candidate on
 * the same sweep: the post-process stack in js/graphics.js (bloom's per-frame
 * canvas readback, the backdrop-filter distance blur, the grain layer, the CSS
 * grade, auto-exposure metering). Cost is only meaningful as a ranking.
 *
 * Configurations, all measured inside ONE page load so no load-to-load variance
 * leaks into the comparison, and rotated in order every rep so nothing is
 * always first:
 *   pattern   — current app (facade pattern on, GFX post stack on)   [baseline]
 *   flat      — pattern -> null, flat fill-extrusion-color, GFX on
 *   gfx-off   — pattern on, post-process stack off
 *   both-off  — both off (checks the two costs are additive, i.e. that neither
 *               measurement is an artefact of the other)
 *
 * METHODOLOGY, inherited from perf3.mjs / outer-perf.mjs because every one of
 * these lessons was paid for once already (scripts/verify/README.md):
 *   - HEADED, real GPU. swiftshader moves the whole cost onto fill rate and
 *     would report a shader change as enormous and a geometry change as free.
 *   - index.html, never _harness.html — its rAF shim pins the loop at ~60 Hz.
 *   - NO screenshots during a timing run.
 *   - Count DROPPED FRAMES. A median frame time sits on the vsync floor even
 *     while half the frames are being missed, and every delta then reads as 0.
 *   - MINIMUM of interleaved reps, never a mean. A mean measures the machine.
 *   - Script a fixed camera sweep so every run renders identical content, and
 *     hold no key down.
 *   - Cancel the graphics auto-detect probe; it fires 11 s in and rewrites
 *     every setting mid-run.
 *   - Echo back the thing you think you set. This script goes further and
 *     PIXEL-HASHES the frame per configuration: if two configurations produce
 *     the same hash they rendered the same thing and the A/B never happened.
 *
 * Usage:  node facade-perf.mjs [reps] [--path <substring>] [--atlas | --atlas-only]
 *         (serve the repo root first; VERIFY_URL overrides http://127.0.0.1:8099)
 *         --atlas adds the time-of-day atlas-repaint measurement at the end;
 *         --atlas-only runs just that and skips the sweeps.
 */
import { chromium } from 'playwright-core';
import { chromePath, BASE, launch } from './chrome.mjs';

// 4 reps by default, not 3: with four configurations, four reps rotates each of
// them into first position exactly once, which cancels the warm-up the first
// sweep after a page load always pays for (shader compile + tile upload).
const REPS = Number(process.argv.slice(2).find(a => /^\d+$/.test(a)) || 4);
const only = process.argv.includes('--path')
  ? process.argv[process.argv.indexOf('--path') + 1] : null;

// 2560x1400 for the same reason perf3.mjs and outer-perf.mjs use it: at
// 1440x900 with vsync on this scene sits ON the 16.67 ms floor and every
// configuration reads as identical. A frame time only means something once the
// frame is genuinely GPU-bound.
const VW = 2560, VH = 1400;

// One fixed graphics configuration for every run. `balanced`, matching what the
// auto-detect lands on for a mid machine, so the post-process numbers below are
// the ones a real user actually pays.
const GFX = {
  preset: 'balanced', autoDetected: true, msaa: false, renderScale: 1,
  bloom: 0.40, godRays: 0.5, flare: 0.3, dof: 0.30,
  exposure: 1.03, autoExposure: true, contrast: 1.06, saturation: 1.1,
  filmic: 0.65, vignette: 1.0, grain: 0.1,
  ao: true, shadows: true, clouds: 1, stars: 1, fov: 58,
};
const INSTALL = (cfg) => {
  // addInitScript runs in the PAGE — the config must be the second argument,
  // not a closure, or nothing is installed and four "different" configurations
  // silently run identically.
  try { localStorage.setItem('austin3d.gfx.v1', JSON.stringify(cfg)); } catch (e) {}
};

// Fixed sweeps, expressed as endpoints so the page can lerp them without the
// script having to ship a function across the boundary.
const PATHS = {
  // Low and close through downtown with the camera orbiting: facades fill most
  // of the frame. This is the pattern's WORST case and the honest place to test
  // the claim.
  'downtown facades (close orbit)': {
    from: { lng: -97.7425, lat: 30.2665, zoom: 16.6, pitch: 82, bearing: 0 },
    to:   { lng: -97.7425, lat: 30.2665, zoom: 16.6, pitch: 82, bearing: 360 },
  },
  // The flying shot the app is actually for: campus, pitched over, running
  // south into the skyline. Facades are a smaller share of the frame and the
  // ground/trees/sky/post stack are a bigger one. Named so that `--path
  // downtown` selects only the orbit above — a substring filter that matches
  // both paths silently runs the whole suite.
  'campus flight (into the skyline)': {
    from: { lng: -97.7425, lat: 30.2900, zoom: 15.1, pitch: 77, bearing: 178 },
    to:   { lng: -97.7425, lat: 30.2825, zoom: 15.1, pitch: 77, bearing: 178 },
  },
};

const ORDER = ['pattern', 'flat', 'gfx-off', 'both-off'];
const CONFIGS = {
  'pattern':  { pattern: true,  gfx: true  },
  'flat':     { pattern: false, gfx: true  },
  'gfx-off':  { pattern: true,  gfx: false },
  'both-off': { pattern: false, gfx: false },
};

const browser = await launch(chromium, { gl: 'hardware' });

/** Everything that happens inside one page load: all four configurations. */
async function runRep(pathName, path, order) {
  const page = await browser.newPage({ viewport: { width: VW, height: VH } });
  await page.bringToFront();
  await page.addInitScript(INSTALL, GFX);
  const t0 = Date.now();
  // `networkidle` never settles: the basemap streams tiles for as long as the
  // camera moves. The source-loaded check below is the real readiness signal.
  await page.goto(`${BASE}/index.html?intro=0&drift=0`,
                  { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(),
                             null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const m = window.__map;
    if (!m || !m.getSource('austin-buildings')) return false;
    return ['austin-buildings', 'austin-outer', 'austin-ground', 'austin-trees']
      .every(s => !m.getSource(s) || m.isSourceLoaded(s));
  }, null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(4000);
  // The auto-detect probe fires ~11 s after load and rewrites every setting.
  // Left running it lands mid-test and reads as a lever being broken.
  await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
  // Fixed time of day, forced past the 1/128 quantisation, so the facade atlas
  // is repainted once here and never again during the measurement. (updateFacades
  // is only called on a heavy tod tick; nothing advances the clock with the
  // auto-play button untouched.)
  await page.evaluate(() => window.applyTimeOfDay(window.__map, 0.30, true));
  await page.waitForTimeout(2500);

  // Snapshot the pattern-bearing layers BEFORE anything is flipped.
  const meta = await page.evaluate(() => {
    const m = window.__map;
    const saved = [];
    for (const l of m.getStyle().layers) {
      if (l.type !== 'fill-extrusion' || !l.paint) continue;
      if (l.paint['fill-extrusion-pattern'] === undefined) continue;
      saved.push({
        id: l.id,
        pat: l.paint['fill-extrusion-pattern'],
        col: l.paint['fill-extrusion-color'] === undefined ? null : l.paint['fill-extrusion-color'],
      });
    }
    window.__ab = { saved, gfx0: JSON.parse(JSON.stringify(window.GFX)) };
    return {
      patternLayers: saved.map(s => s.id),
      // NOT queryRenderedFeatures: at a flying pitch it returns 0 for
      // buildings-3d in a scene visibly full of buildings.
      coreSrc: (() => { try { return m.querySourceFeatures('austin-buildings').length; } catch (e) { return -1; } })(),
      outerSrc: (() => { try { return m.querySourceFeatures('austin-outer').length; } catch (e) { return -1; } })(),
      // How many atlas images the pattern scheme costs. Cost is per IMAGE.
      atlasImages: (() => { try { return (window.facadePalette && m.listImages) ? m.listImages().filter(i => /^(lo|md|tw|dk|st)\d\d/.test(i)).length : -1; } catch (e) { return -1; } })(),
      pdb: (() => { try {
        const c = m.getCanvas();
        const gl = c.getContext('webgl2') || c.getContext('webgl');
        return !!(gl && gl.getContextAttributes().preserveDrawingBuffer);
      } catch (e) { return false; } })(),
      dpr: window.devicePixelRatio,
      canvas: [m.getCanvas().width, m.getCanvas().height],
    };
  });

  const out = {};
  for (const name of order) {
    const cfg = CONFIGS[name];
    // ── apply ────────────────────────────────────────────────────────
    const applied = await page.evaluate(({ cfg, FLAT }) => {
      const m = window.__map, S = window.__ab;
      for (const l of S.saved) {
        if (cfg.pattern) {
          m.setPaintProperty(l.id, 'fill-extrusion-pattern', l.pat);
          if (l.col !== null) m.setPaintProperty(l.id, 'fill-extrusion-color', l.col);
        } else {
          // Order matters: a pattern always wins over a colour, so it has to
          // come off first (js/app.js:924 does the same for debug mode).
          m.setPaintProperty(l.id, 'fill-extrusion-pattern', null);
          m.setPaintProperty(l.id, 'fill-extrusion-color', FLAT);
        }
      }
      const g = window.GFX, s = S.gfx0;
      // Only the POST-PROCESS stack. ao/shadows/renderScale/fov stay fixed, or
      // this would be measuring geometry and resolution instead.
      const ZERO = { bloom: 0, godRays: 0, flare: 0, dof: 0, grain: 0, vignette: 0,
                     filmic: 0, contrast: 1, saturation: 1, exposure: 1, autoExposure: false };
      for (const k of Object.keys(ZERO)) g[k] = cfg.gfx ? s[k] : ZERO[k];
      window.applyGraphics();
      return {
        // Echo it back. Four "different" configurations once ran identically
        // while the report printed four different numbers.
        pat: JSON.stringify(m.getPaintProperty(S.saved[0].id, 'fill-extrusion-pattern') ?? null),
        col: JSON.stringify(m.getPaintProperty(S.saved[0].id, 'fill-extrusion-color') ?? null),
        bloom: g.bloom, dof: g.dof, grain: g.grain, vignette: g.vignette, ae: g.autoExposure,
      };
    }, { cfg, FLAT: '#8f8778' });

    // The facade atlas and data-driven paint do not land in the same frame as
    // the call. Settle, and wait for the source to finish re-tiling.
    await page.waitForTimeout(3500);

    // ── measure ──────────────────────────────────────────────────────
    const r = await page.evaluate(async ({ path, vsync }) => {
      const m = window.__map;
      const L = (a, b, t) => a + (b - a) * t;
      const at = t => ({
        center: [L(path.from.lng, path.to.lng, t), L(path.from.lat, path.to.lat, t)],
        zoom: L(path.from.zoom, path.to.zoom, t),
        pitch: L(path.from.pitch, path.to.pitch, t),
        bearing: L(path.from.bearing, path.to.bearing, t),
      });

      // ── warm-up sweep, DISCARDED ──────────────────────────────────
      // Without this the FIRST configuration measured in each page load is
      // heavily penalised and the paired differences become unreadable: the
      // first run of this script produced 12.4 / 12.7 / 7.7 fps for whichever
      // configuration happened to go first, against 20-25 fps for the same
      // configurations later in the same load. Two causes, both fixed by
      // flying the path once and throwing the numbers away:
      //   - the basemap is REMOTE (tiles.openfreemap.org, js/app.js:144), so
      //     the first traversal is measuring a network fetch;
      //   - flipping fill-extrusion-pattern rebuilds the paint vertex arrays
      //     for every visible tile, and a static settle does not upload the
      //     tiles the camera is about to move onto — only moving does.
      // Rotating the configuration order (which this script also does) fixes
      // this only in aggregate; the WITHIN-rep difference, which is the whole
      // point of pairing, stays contaminated until the warm-up exists.
      {
        const W = 5000, t0 = performance.now();
        await new Promise(res => {
          const step = () => {
            const el = performance.now() - t0;
            m.jumpTo(at((el % 4000) / 4000));
            if (el > W) return res();
            requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        });
      }

      // ── frame hash ────────────────────────────────────────────────
      // The guard against a null A/B. Two configurations that render the same
      // pixels did not actually differ, whatever the paint property says.
      m.jumpTo(at(0.25));
      await new Promise(r2 => setTimeout(r2, 900));
      m.triggerRepaint();
      await new Promise(r2 => requestAnimationFrame(() => requestAnimationFrame(r2)));
      let hash = -1;
      try {
        const c = m.getCanvas();
        const gl = c.getContext('webgl2') || c.getContext('webgl');
        const W = 256, H = 256;
        const px = new Uint8Array(W * H * 4);
        gl.readPixels((c.width - W) >> 1, (c.height - H) >> 1, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
        let h = 2166136261;
        for (let i = 0; i < px.length; i += 7) { h ^= px[i]; h = Math.imul(h, 16777619); }
        hash = h >>> 0;
      } catch (e) {}

      // ── wall-clock sweep: the headline ────────────────────────────
      // This is the number the claim is about — "laggy WITH MOTION" — so the
      // camera moves the whole time, along a fixed path, so every run renders
      // identical content. It includes the compositor: the CSS grade, the
      // backdrop-filter blur and the grain layer are real frame cost that a GL
      // timer cannot see.
      const DUR = 8000, LEG = 4000;
      const dts = [];
      {
        const t0 = performance.now();
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
      }
      const elapsed = dts.reduce((a, d) => a + d, 0);
      const dropped = dts.reduce((a, d) => a + Math.max(0, Math.round(d / vsync) - 1), 0);
      const sorted = [...dts].sort((a, b) => a - b);
      const q = f => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * f))];
      const nBest = Math.max(3, Math.round(sorted.length * 0.05));
      const fastest = sorted.slice(0, nBest).reduce((a, b) => a + b, 0) / nBest;

      // ── GPU-stalled pass: resolves below the vsync floor ──────────
      // readPixels is a synchronising call — it cannot return until every draw
      // submitted before it has executed. One 1x1 read at the end of MapLibre's
      // own `render` event turns each frame from "how fast can the CPU submit"
      // into "how long did the GPU take on OUR draw calls". This ISOLATES the
      // WebGL scene, so it sees the facade shader but NOT the CSS/compositor
      // half of the post stack — which is exactly why the wall clock above is
      // the headline and this is the supporting detail.
      const gpu = [];
      try {
        const gl = m.getCanvas().getContext('webgl2') || m.getCanvas().getContext('webgl');
        const px1 = new Uint8Array(4);
        let t1 = 0;
        const onRender = () => {
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px1);
          const now = performance.now();
          gpu.push(now - t1);
          t1 = now;
        };
        m.on('render', onRender);
        for (let i = 0; i < 70; i++) {
          m.jumpTo(at((i / 35) % 1));   // dirties the transform: a real full draw
          t1 = performance.now();
          m.triggerRepaint();
          await new Promise(r2 => requestAnimationFrame(r2));
        }
        m.off('render', onRender);
      } catch (e) {}
      const gs = gpu.slice(3).sort((a, b) => a - b);
      const nb = Math.max(3, Math.round(gs.length * 0.1));
      return {
        hash,
        frames: dts.length,
        fps: 1000 * dts.length / elapsed,
        dropped: Math.round(dropped * (4000 / DUR)),   // normalised to per-4s
        droppedPct: 100 * dts.filter(d => d > 1.5 * vsync).length / dts.length,
        fastest, p10: q(0.10), med: q(0.50), p90: q(0.90),
        gpuMed: gs.length ? gs[Math.floor(gs.length / 2)] : null,
        gpuFast: gs.length ? gs.slice(0, nb).reduce((a, b) => a + b, 0) / nb : null,
      };
    }, { path, vsync: VSYNC });
    r.applied = applied;
    out[name] = r;
    process.stdout.write(
      `    ${name.padEnd(9)} fps ${r.fps.toFixed(1).padStart(5)}  drop/4s ${String(r.dropped).padStart(3)}  ` +
      `gpu ${r.gpuMed == null ? '  n/a' : r.gpuMed.toFixed(2).padStart(6)} ms  hash ${r.hash}\n`);
  }

  await page.close();
  return { out, meta, seconds: Math.round((Date.now() - t0) / 1000) };
}

/**
 * The display's real refresh period, measured ONCE on about:blank.
 *
 * This must NOT be measured on the app. The first version of this script did,
 * and got a median of exactly 50.00 ms — which reads like the 20 Hz
 * occlusion-throttle signature the README warns about, but wasn't: a blank page
 * in the same browser with the same flags returns 16.7 ms. It was the app's own
 * frame cost being mistaken for the refresh rate, so every frame was being
 * scored against a 50 ms budget and "dropped frames" came out ~3x too low for
 * every configuration. Measure the panel, not the scene.
 */
async function measureRefresh() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.bringToFront();
  await page.goto('about:blank');
  await page.waitForTimeout(1200);
  const v = await page.evaluate(async () => {
    const d = []; let last = null;
    await new Promise(res => {
      let n = 0;
      const step = ts => {
        if (last !== null) d.push(ts - last);
        last = ts;
        if (++n > 90) return res();
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    const s = d.sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  });
  await page.close();
  return v;
}

// ── report helpers ───────────────────────────────────────────────────
// MINIMUM of reps for the throughput statistics (README: a mean measures the
// machine, and a mean-based run once reported day getting 3x slower after a
// change that only touched the night path). For frame TIMES the minimum is the
// best frame, so those use the min too — same direction, best case.
const min = a => Math.min(...a);
const max = a => Math.max(...a);
const med = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

console.log(`facade-perf — ${VW}x${VH} headed, real GPU, ${REPS} interleaved reps per path.`);
console.log('Testing: "fill-extrusion-pattern is what makes this laggy with motion."');
console.log('Headline statistics are the BEST of the reps (min dropped frames / max fps):');
console.log('a mean measures the machine, not the scene.\n');

const VSYNC = await measureRefresh();
console.log(`display refresh measured on about:blank: ${VSYNC.toFixed(2)} ms ` +
            `(${(1000 / VSYNC).toFixed(0)} Hz) — the frame budget every drop is scored against.\n`);

const verdicts = [];
const ATLAS = process.argv.includes('--atlas') || process.argv.includes('--atlas-only');
for (const [pathName, path] of Object.entries(PATHS)) {
  if (process.argv.includes('--atlas-only')) break;
  if (only && !pathName.includes(only)) continue;
  console.log(`\n=== ${pathName} ===`);
  const reps = [];
  for (let rep = 0; rep < REPS; rep++) {
    // Rotate so no configuration is always first: the first sweep after a load
    // pays for shader compilation and tile upload that the later ones do not.
    const order = ORDER.slice(rep % ORDER.length).concat(ORDER.slice(0, rep % ORDER.length));
    console.log(`  rep ${rep + 1} (order: ${order.join(', ')})`);
    reps.push(await runRep(pathName, path, order));
  }
  const m0 = reps[0].meta;
  console.log(`  [pattern layers: ${m0.patternLayers.join(', ')}]`);
  console.log(`  [core src features ${m0.coreSrc}, outer ${m0.outerSrc}, atlas images ${m0.atlasImages}, ` +
              `canvas ${m0.canvas[0]}x${m0.canvas[1]}, dpr ${m0.dpr}, pdb ${m0.pdb}]`);

  // The null-A/B guard.
  const hashes = {};
  for (const n of ORDER) hashes[n] = reps.map(r => r.out[n].hash);
  const same = reps.every(r => r.out['pattern'].hash === r.out['flat'].hash);
  console.log(`  [frame hashes pattern vs flat: ${reps.map(r => `${r.out['pattern'].hash}/${r.out['flat'].hash}`).join('  ')}]` +
              (same ? '   <- IDENTICAL: THE A/B DID NOT HAPPEN, IGNORE EVERY NUMBER BELOW' : '   (differ: the flip is real)'));

  console.log('');
  console.log('  config'.padEnd(12) + 'fps (best)'.padEnd(12) + 'dropped/4s (best)'.padEnd(20) +
              'frames >1.5 vsync'.padEnd(20) + 'fastest ms'.padEnd(12) + 'median ms'.padEnd(12) + 'GPU ms (best)');
  const stat = {};
  for (const n of ORDER) {
    const rs = reps.map(r => r.out[n]);
    stat[n] = {
      fps: max(rs.map(r => r.fps)),
      drop: min(rs.map(r => r.dropped)),
      dropAll: rs.map(r => r.dropped),
      pct: min(rs.map(r => r.droppedPct)),
      fastest: min(rs.map(r => r.fastest)),
      med: min(rs.map(r => r.med)),
      gpu: min(rs.map(r => r.gpuMed ?? Infinity)),
      gpuPaired: rs.map(r => r.gpuMed),
    };
    const s = stat[n];
    console.log('  ' + n.padEnd(10) +
      s.fps.toFixed(1).padEnd(12) +
      `${s.drop} (${min(s.dropAll)}-${max(s.dropAll)})`.padEnd(20) +
      `${s.pct.toFixed(1)}%`.padEnd(20) +
      s.fastest.toFixed(2).padEnd(12) +
      s.med.toFixed(2).padEnd(12) +
      (isFinite(s.gpu) ? s.gpu.toFixed(2) : 'n/a'));
  }

  // PAIRED deltas, not "best of one set minus best of the other". Repeats of
  // the same configuration on this machine swing wider than the effect being
  // measured, and the level drifts upward as the GPU heats. Each rep measures
  // every configuration seconds apart inside one page load, so differencing
  // WITHIN a rep cancels most of the drift.
  const pairs = (a, b, k) => reps.map(r => (r.out[a][k] ?? NaN) - (r.out[b][k] ?? NaN));
  const show = (label, a, b) => {
    const dFps = pairs(a, b, 'fps'), dDrop = pairs(a, b, 'dropped'), dGpu = pairs(a, b, 'gpuMed');
    const sp = max(dGpu) - min(dGpu), mg = med(dGpu);
    console.log(`\n  ${label}`);
    console.log(`    paired dfps    : ${dFps.map(v => (v >= 0 ? '+' : '') + v.toFixed(1)).join('  ')}   median ${(med(dFps) >= 0 ? '+' : '') + med(dFps).toFixed(2)} fps`);
    console.log(`    paired ddropped: ${dDrop.map(v => (v >= 0 ? '+' : '') + v).join('  ')}   median ${(med(dDrop) >= 0 ? '+' : '') + med(dDrop)} per 4 s`);
    console.log(`    paired dGPU ms : ${dGpu.map(v => (v >= 0 ? '+' : '') + v.toFixed(2)).join('  ')}   median ${(mg >= 0 ? '+' : '') + mg.toFixed(2)} ms` +
                (sp > 4 * Math.abs(mg) ? '   <- SPREAD EXCEEDS THE EFFECT' : ''));
    return { dFps: med(dFps), dDrop: med(dDrop), dGpu: mg, spread: sp };
  };
  show('REMOVING THE FACADE PATTERN  (flat - pattern):', 'flat', 'pattern');
  show('REMOVING THE POST-PROCESS STACK  (gfx-off - pattern):', 'gfx-off', 'pattern');
  show('REMOVING BOTH  (both-off - pattern):', 'both-off', 'pattern');

  // ── the estimator the verdict actually uses ────────────────────────
  // BEST-OF-REPS, not the paired median, and this is a correction the first two
  // runs of this script forced.
  //
  // Pairing within a page load is the right idea when the noise is slow drift —
  // it cancels a GPU warming up over minutes. It is the WRONG idea when the
  // noise is contention, because contention hits one configuration inside a rep
  // and not the other three: one rep here recorded 4.3 fps for `flat` and
  // 28.4 fps for `both-off` twenty seconds apart, and the paired difference from
  // that rep (+52 dropped frames from REMOVING work) is not a measurement of
  // anything. Both runs produced "SPREAD EXCEEDS THE EFFECT" on the paired
  // numbers while the best-of column stayed stable and ordered.
  //
  // Contention and thermal throttling are one-sided: they can only ever make a
  // frame slower, never faster. So the fastest run of each configuration is the
  // one with the least foreign work in it, and the minimum is the estimator that
  // converges on the scene instead of the machine. That is what
  // scripts/verify/README.md means by "take the MINIMUM of many timings" — the
  // paired block above is kept as a diagnostic, because when its spread is small
  // it confirms the ranking, and when it is large it is telling you the machine
  // was busy, which is information too.
  const base = stat['pattern'];
  const dFps  = n => stat[n].fps - base.fps;
  const dDrop = n => stat[n].drop - base.drop;
  const facade = { dFps: dFps('flat'),     dDrop: dDrop('flat') };
  const post   = { dFps: dFps('gfx-off'),  dDrop: dDrop('gfx-off') };
  const both   = { dFps: dFps('both-off'), dDrop: dDrop('both-off') };

  // Default is REFUTED. The claim only survives if killing the pattern is both
  // a large improvement in its own right AND beats the other candidate —
  // "replacing them will FIX it" is a claim about the DOMINANT cost, not about
  // a merely measurable one.
  const bigEnough = facade.dFps >= 0.30 * base.fps || facade.dDrop <= -0.25 * Math.max(1, base.drop);
  const beatsPost = facade.dFps > post.dFps && facade.dDrop < post.dDrop;
  const supported = bigEnough && beatsPost && !same;
  console.log(`\n  VERDICT (${pathName}): the claim is ${supported ? 'SUPPORTED' : 'REFUTED'}`);
  console.log(`    (best-of-${REPS} deltas against a ${base.fps.toFixed(1)} fps / ${base.drop} dropped baseline)`);
  console.log(`    removing the pattern:    ${facade.dFps >= 0 ? '+' : ''}${facade.dFps.toFixed(2)} fps ` +
              `(${(100 * facade.dFps / base.fps).toFixed(1)}%), ${facade.dDrop >= 0 ? '+' : ''}${facade.dDrop} dropped frames per 4 s`);
  console.log(`    removing the post stack: ${post.dFps >= 0 ? '+' : ''}${post.dFps.toFixed(2)} fps ` +
              `(${(100 * post.dFps / base.fps).toFixed(1)}%), ${post.dDrop >= 0 ? '+' : ''}${post.dDrop} dropped frames per 4 s`);
  console.log(`    removing both:           ${both.dFps >= 0 ? '+' : ''}${both.dFps.toFixed(2)} fps ` +
              `(${(100 * both.dFps / base.fps).toFixed(1)}%), ${both.dDrop >= 0 ? '+' : ''}${both.dDrop} dropped frames per 4 s`);
  if (!bigEnough) console.log('    -> removing the pattern does not recover enough of the frame to "fix" anything.');
  if (!beatsPost) console.log('    -> the post-process stack is the bigger lever on this path.');
  verdicts.push({ pathName, supported, facade, post, both, base });
}

// ── where the pattern DOES cost, so the report is not only a negative ───────
// `node facade-perf.mjs --atlas`
//
// The A/B above answers "is the pattern what makes MOTION laggy" and the answer
// is no — a facade pattern is one extra texture fetch in a fragment shader that
// was already running. But the scheme is not free, and its cost is somewhere
// else entirely: every heavy time-of-day tick calls updateFacades, which
// re-rasterises and re-uploads EVERY image in the atlas (js/facades.js:840).
// That is a per-IMAGE cost paid on the main thread while the tod slider moves,
// and it dirties the sprite, which re-renders every tile using a pattern.
// Nothing advances the clock during a normal flight, which is exactly why it
// does not show up above — and exactly why "it's laggy when I drag the time
// slider" and "it's laggy when I fly" are two different bugs.
if (ATLAS) {
  const page = await browser.newPage({ viewport: { width: VW, height: VH } });
  await page.bringToFront();
  await page.addInitScript(INSTALL, GFX);
  await page.goto(`${BASE}/index.html?intro=0&drift=0`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 90000 });
  await page.waitForTimeout(6000);
  await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
  await page.evaluate(() => window.__map.jumpTo({ center: [-97.7425, 30.2665], zoom: 16.6, pitch: 82, bearing: 20 }));
  await page.waitForTimeout(3000);
  const a = await page.evaluate(async () => {
    const m = window.__map;
    const n = m.listImages().filter(i => /^(lo|md|tw|dk|st)\d\d/.test(i)).length;
    const atlas = [], tod = [];
    for (let i = 0; i < 24; i++) {
      const p = 0.20 + 0.02 * i;
      let t = performance.now();
      window.updateFacades(m, p);               // the atlas repaint alone
      atlas.push(performance.now() - t);
      t = performance.now();
      window.applyTimeOfDay(m, p, true);        // the whole heavy tod tick
      tod.push(performance.now() - t);
      await new Promise(r => requestAnimationFrame(r));
    }
    const s = a => [...a].sort((x, y) => x - y);
    const q = (a, f) => s(a)[Math.floor(a.length * f)];
    // MINIMUM, per the README: a mean here measures the machine.
    return { n, atlasMin: Math.min(...atlas), atlasMed: q(atlas, 0.5),
             todMin: Math.min(...tod), todMed: q(tod, 0.5) };
  });
  console.log('\n\n==== where the pattern scheme actually costs (atlas repaint) ====');
  console.log(`atlas images: ${a.n}`);
  console.log(`updateFacades() alone: ${a.atlasMin.toFixed(1)} ms best, ${a.atlasMed.toFixed(1)} ms median  ` +
              `(${(a.atlasMin / a.n).toFixed(2)} ms per image)`);
  console.log(`full heavy applyTimeOfDay(force) tick: ${a.todMin.toFixed(1)} ms best, ${a.todMed.toFixed(1)} ms median`);
  console.log(`-> ${(100 * a.atlasMin / a.todMin).toFixed(0)}% of a heavy time-of-day tick is the facade atlas.`);
  console.log('   This is a MAIN-THREAD cost paid while the time slider moves, not while flying.');
  await page.close();
}

if (!verdicts.length) { await browser.__done(); process.exit(0); }

console.log('\n\n==== SUMMARY ====');
for (const v of verdicts) {
  console.log(`${v.pathName}: baseline ${v.base.fps.toFixed(1)} fps / ${v.base.drop} dropped per 4 s | ` +
              `pattern off ${v.facade.dFps >= 0 ? '+' : ''}${v.facade.dFps.toFixed(2)} fps | ` +
              `post stack off ${v.post.dFps >= 0 ? '+' : ''}${v.post.dFps.toFixed(2)} fps | ` +
              `claim ${v.supported ? 'SUPPORTED' : 'REFUTED'}`);
}
console.log(verdicts.every(v => !v.supported)
  ? '\nOVERALL: the claim is REFUTED on every path measured.'
  : '\nOVERALL: at least one path supports the claim — read the per-path numbers.');

await browser.__done();
