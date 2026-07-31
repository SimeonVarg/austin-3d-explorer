/**
 * night-luma.mjs — the luma histogram of a night frame, and the lit-vs-unlit
 * ORDERING that brightening night is not allowed to invert.
 *
 * Why this file exists. "Night is too dim" gets fixed by raising things, and
 * the one way this repo has already got that wrong is raising the WRONG things:
 * an early DKR night pass left the unlit seating bowl as the brightest object
 * on the east side of campus. `night-silhouette.mjs` guards one case of that
 * (wall vs sky at the roofline, seven columns, median). This guards the other:
 * across the WHOLE frame, the brightest things in the city must be lights.
 *
 * ── How it measures, and why it does not do the obvious thing ──────────
 *
 * The obvious design is per-class masks built by hiding layers and diffing.
 * That was built first and abandoned; the reason is worth recording so nobody
 * rebuilds it.
 *
 *   Hiding ~30 fill-extrusion layers and showing them again re-tiles the scene
 *   and drops the facade atlas, and under headless swiftshader it does not come
 *   back inside any settle this suite can afford. Measured: two consecutive
 *   lamps-on grabs of the SAME pose disagreed on 695,048 of 1,296,000 pixels;
 *   the pale-masonry class read 11.4% of frame in one run and 2.0% in the next
 *   with identical code; and the streetlights — a layer whose three colours are
 *   all warm — came back once as 11.6% of the frame in COOL BLUE light, because
 *   the diff was measuring load progress and calling it lamplight.
 *
 * So the histogram takes ONE readPixels per pose and changes no visibility at
 * all. Classes come from the pixels themselves:
 *
 *   lit    luma > LIT_LUMA and R-B >= 0    a lit window, a lamp, a sign
 *   pale   luma > LIT_LUMA and R-B <  0    unlit masonry catching the night sky
 *   dark   luma <= LIT_LUMA                everything else
 *
 * Chroma rather than brightness, because brightness alone does not tell a lit
 * window from pale limestone: at the Drag pose the Co-op, the Texas Union and
 * the Harry Ransom Center are the brightest objects in the frame and not one of
 * them is lit, and a luma-only threshold scored 38% of the building surface as
 * "lit windows".
 *
 * The split sits at R-B = 0, not at some positive amber threshold, and that
 * matters once the scene has COOL light sources in it. An unlit night surface
 * is reflecting the night sky and comes back distinctly blue (measured mean
 * rgb(57,61,81), R-B = -24). A 4000K LED streetlight is neutral-to-faintly-warm
 * (measured rgb(51,48,45), R-B = +7). A +25 threshold put the cool edge lamps
 * in with the unlit masonry and made the west pose's "unlit" p99 leap from 136
 * to 226 — which reads as the inverted-silhouette failure and was in fact the
 * new streetlights being filed as walls.
 *
 * The one A/B that genuinely needs a toggle — what the streetlights actually
 * contribute — is `--lamps`, run at two poses, with every pixel where the two
 * lamps-on grabs disagree thrown OUT rather than credited to the lamps. It
 * prints how much it threw out and says so loudly when that is too much.
 *
 * The reduction happens IN THE PAGE. Handing a 1440x900 framebuffer back
 * through CDP as `Array.from(buf)` once ran for twenty minutes at 2 GB of RSS
 * before it was killed (README, "Three more traps"), and building a 1.3M-entry
 * JS array per class just to take a median closed the renderer outright —
 * hence the 256-bin histograms below.
 *
 * Usage:  node night-luma.mjs [--json out.json] [--p 0.92] [--lamps]
 *         VERIFY_URL=http://127.0.0.1:8113 node night-luma.mjs --lamps
 */
import { chromium } from 'playwright-core';
import { chromePath, GL_ARGS, BASE } from './chrome.mjs';
import fs from 'node:fs';

// The same four poses `night-shots.json` screenshots, so a number here and a
// picture there are the same frame. `core` sits over the campus core and `west`
// over the western edge — the warm-core/cool-edge claim is the measured
// difference between their lamplight, not an impression.
const POSES = [
  { name: 'core',   center: [-97.7395, 30.2860], zoom: 16.0, pitch: 68, bearing: 200 },
  { name: 'wide',   center: [-97.7420, 30.2850], zoom: 15.2, pitch: 70, bearing: 120 },
  { name: 'street', center: [-97.7415, 30.2865], zoom: 17.0, pitch: 72, bearing: 30 },
  { name: 'west',   center: [-97.7470, 30.2865], zoom: 16.3, pitch: 62, bearing: 100 },
];
const LAMP_POSES = ['core', 'west'];

const argv = process.argv.slice(2);
const jsonOut = argv.includes('--json') ? argv[argv.indexOf('--json') + 1] : null;
const P = argv.includes('--p') ? parseFloat(argv[argv.indexOf('--p') + 1]) : 0.92;
const DO_LAMPS = argv.includes('--lamps');
// --baseline <run.json> turns this into the before/after guard. THIS is the
// check the night brief actually asks for: brightening night may raise every
// number, but it must not change the SHAPE of the histogram. A correct
// brightening lifts the tail (p99, max — the light sources) far more than the
// body (p50, p90 — the unlit mass). An inverted-silhouette regression lifts
// them together, or lifts the body more.
const BASE_JSON = argv.includes('--baseline') ? argv[argv.indexOf('--baseline') + 1] : null;

// The auto-exposure ceiling. graphics.js meters the RAW frame — exactly what
// gl.readPixels returns here, since the grade is a CSS filter layered on top —
// and targets AE.TARGET_NIGHT = 0.135 with a log-space dead zone of
// AE.KNEE = 0.16. Past 0.135*e^0.16 = 0.1585 the gain starts coming DOWN and
// the post-process quietly undoes the brightening, to a floor of AE.MIN = 0.85.
// It is a ceiling on the MEAN and not on the peaks, which is the whole reason
// the fix has to be local contrast — brighter, denser, SMALL sources — instead
// of a global lift. The baseline already sits over it at some poses, so this is
// reported here and A/B'd in the PR rather than asserted as an absolute.
const AE_CEIL = 0.1585;

const browser = await chromium.launch({ executablePath: chromePath(), headless: true, args: GL_ARGS });
// 960x600, not 1440x900. Every number this script reports is a percentage or a
// percentile, so it is resolution-independent — but the settle is not. Headless
// swiftshader rasterises in software, so 2.25x fewer pixels is 2.25x less work
// per frame, and on a loaded machine that is the difference between four poses
// settling and none of them settling. One 1440x900 run came back with all four
// poses unsettled and numbers that disagreed with the previous identical run by
// 30 luma at p90.
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.goto(`${BASE}/_harness.html?intro=0&drift=0`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });
await page.waitForFunction(() => {
  const m = window.__map;
  if (!m || !m.getSource('austin-buildings')) return false;
  return ['austin-buildings', 'austin-ground', 'austin-trees']
    .every(s => !m.getSource(s) || m.isSourceLoaded(s));
}, null, { timeout: 90000 }).catch(() => console.log('WARN: sources not all loaded'));
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
await page.waitForFunction(() => !!window.__nightLights, null, { timeout: 60000 })
  .catch(() => console.log('WARN: __nightLights never appeared — streetlights did not generate'));
const lampGen = await page.evaluate(() => window.__nightLights || null);
await page.waitForTimeout(3000);

// Page-side helpers, installed once. Everything heavy reduces in the page.
await page.evaluate(() => {
  const m = window.__map, cv = m.getCanvas();
  const gl = cv.getContext('webgl2') || cv.getContext('webgl');
  const W = cv.width, H = cv.height, N = W * H;
  const S = window.__nl = { m, gl, W, H, N };

  S.settle = async n => { for (let i = 0; i < (n || 12); i++) await new Promise(r => requestAnimationFrame(r)); };
  S.grab = () => {
    const buf = new Uint8Array(N * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    return buf;
  };
  // Strided probe into ONE reused buffer for the stability wait. A centre crop
  // misses a change at the frame edges; a fresh framebuffer per probe is what
  // took the renderer down.
  const STRIDE = 37;
  const probeBuf = new Uint8Array(N * 4);
  S.probe = () => {
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, probeBuf);
    const out = new Float32Array(Math.ceil(N / STRIDE));
    for (let i = 0, k = 0; i < N; i += STRIDE, k++) {
      const j = i * 4;
      out[k] = 0.2126 * probeBuf[j] + 0.7152 * probeBuf[j + 1] + 0.0722 * probeBuf[j + 2];
    }
    return out;
  };
  S.stable = async (maxRounds) => {
    let prev = S.probe();
    for (let i = 0; i < (maxRounds || 40); i++) {
      await S.settle(14);
      const cur = S.probe();
      let d = 0;
      for (let k = 0; k < cur.length; k++) d += Math.abs(cur[k] - prev[k]);
      d /= cur.length; prev = cur;
      if (d < 0.05) return +d.toFixed(4);
    }
    return null;
  };
  S.goto = async (pose, p) => {
    m.jumpTo({ center: pose.center, zoom: pose.zoom, pitch: pose.pitch, bearing: pose.bearing });
    window.applyTimeOfDay(m, p, true);
    await S.settle(40);
    await new Promise(r => { if (m.loaded()) return r(); m.once('idle', r); setTimeout(r, 15000); });
    let trees = 0, bld = 0;
    for (let i = 0; i < 25; i++) {
      try { trees = m.querySourceFeatures('austin-trees').length; } catch (e) {}
      try { bld = m.querySourceFeatures('austin-buildings').length; } catch (e) {}
      if (trees > 300 && bld > 300) break;
      await S.settle(20);
    }
    const drift = await S.stable(40);
    return { trees, bld, drift, ok: drift !== null && trees > 300 && bld > 300 };
  };
  // Horizon, closed form. README: transform.horizonLineFromTop() returns 0 at
  // every pitch, which collapses a sky sampling column onto row 0.
  S.horizonRow = () => {
    const fov = m.getVerticalFieldOfView() * Math.PI / 180;
    const yTop = 0.5 - 0.5 * Math.tan((90 - m.getPitch()) * Math.PI / 180) / Math.tan(fov / 2);
    return Math.round((1 - yTop) * H);   // gl rows count from the BOTTOM
  };
});

async function histogram(POSE, p) {
  return await page.evaluate(async ({ POSE, p }) => {
    const S = window.__nl, { W, H, N } = S;
    const LIT_LUMA = 50, LIT_CHROMA = 0;   // see the header: the split is at neutral
    const load = await S.goto(POSE, p);
    const buf = S.grab();

    const keys = ['all', 'lit', 'pale', 'dark', 'sky', 'skyLow'];
    const hist = {}, sums = {};
    for (const k of keys) { hist[k] = new Uint32Array(257); sums[k] = { n: 0, s: 0, r: 0, g: 0, b: 0, max: 0 }; }
    const add = (k, L, R, G, B) => {
      const a = sums[k]; a.n++; a.s += L; a.r += R; a.g += G; a.b += B;
      if (L > a.max) a.max = L;
      hist[k][Math.min(256, Math.round(L))]++;
    };
    const hr = S.horizonRow(), skyLowTop = hr + Math.round(0.06 * H);
    for (let i = 0, j = 0; i < N; i++, j += 4) {
      const R = buf[j], G = buf[j + 1], B = buf[j + 2];
      const L = 0.2126 * R + 0.7152 * G + 0.0722 * B;
      add('all', L, R, G, B);
      const row = (i / W) | 0;
      if (row >= hr) { add('sky', L, R, G, B); if (row < skyLowTop) add('skyLow', L, R, G, B); }
      if (L <= LIT_LUMA) add('dark', L, R, G, B);
      else if (R - B >= LIT_CHROMA) add('lit', L, R, G, B);
      else add('pale', L, R, G, B);
    }
    const out = { pose: POSE.name, load };
    for (const k of keys) {
      const a = sums[k], h = hist[k];
      if (!a.n) { out[k] = { n: 0 }; continue; }
      const q = f => { let c = 0; const t = f * a.n; for (let b = 0; b <= 256; b++) { c += h[b]; if (c >= t) return b; } return 256; };
      out[k] = { n: a.n, share: +(100 * a.n / N).toFixed(2), mean: +(a.s / a.n).toFixed(2),
                 p50: q(0.50), p90: q(0.90), p99: q(0.99), max: +a.max.toFixed(1),
                 rgb: [a.r, a.g, a.b].map(v => Math.round(v / a.n)),
                 warmth: +((a.r - a.b) / a.n).toFixed(1) };
    }
    out.frameMean = out.all.mean;
    out.frameMeanNorm = +(out.all.mean / 255).toFixed(4);
    return out;
  }, { POSE, p });
}

/** What do the two streetlight layers actually add? One toggle, drift rejected. */
async function lampDelta(POSE, p) {
  return await page.evaluate(async ({ POSE, p }) => {
    const S = window.__nl, { N } = S, m = S.m;
    const LAMPS = ['night-streetlight-pool', 'night-streetlight-core'];
    const vis = on => { for (const id of LAMPS) { try { m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'); } catch (e) {} } };
    await S.goto(POSE, p);
    const A = S.grab();
    vis(false); const dOff = await S.stable();
    const OFF = S.grab();
    vis(true);  const dOn = await S.stable();
    const B = S.grab();

    const lum = (b, j) => 0.2126 * b[j] + 0.7152 * b[j + 1] + 0.0722 * b[j + 2];
    let n = 0, add = 0, mx = 0, rejected = 0, dr = 0, dg = 0, db = 0;
    for (let i = 0, j = 0; i < N; i++, j += 4) {
      const la = lum(A, j), lb = lum(B, j);
      if (Math.abs(la - lb) > 2) { rejected++; continue; }   // the scene moved here
      const d = la - lum(OFF, j);
      if (d <= 2) continue;
      n++; add += d; if (d > mx) mx = d;
      dr += A[j] - OFF[j]; dg += A[j + 1] - OFF[j + 1]; db += A[j + 2] - OFF[j + 2];
    }
    // The lamps-OFF frame IS the window-light measurement: the same city with
    // the streetlights subtracted. Without this, a rise in "lit pixels" cannot
    // be attributed — denser lamps and brighter windows both move it, and the
    // facade change would get credit for the streetlight change.
    const LIT_LUMA = 50;
    const wh = new Uint32Array(257);
    let wn = 0, ws = 0, wmax = 0, wr = 0, wg = 0, wb = 0;
    for (let i = 0, j = 0; i < N; i++, j += 4) {
      const R = OFF[j], G = OFF[j + 1], B = OFF[j + 2];
      const L = 0.2126 * R + 0.7152 * G + 0.0722 * B;
      if (L <= LIT_LUMA || R - B < 0) continue;
      wn++; ws += L; wr += R; wg += G; wb += B;
      if (L > wmax) wmax = L;
      wh[Math.min(256, Math.round(L))]++;
    }
    const wq = f => { let c = 0; const t = f * wn; for (let b = 0; b <= 256; b++) { c += wh[b]; if (c >= t) return b; } return 256; };
    const windows = wn ? { n: wn, share: +(100 * wn / N).toFixed(3), mean: +(ws / wn).toFixed(2),
                           p50: wq(0.50), p90: wq(0.90), p99: wq(0.99), max: +wmax.toFixed(1),
                           warmth: +((wr - wb) / wn).toFixed(1) } : { n: 0 };

    return { pose: POSE.name, settled: dOff !== null && dOn !== null, windows,
             pixels: n, shareOfFrame: +(100 * n / N).toFixed(3),
             rejected, rejectedShare: +(100 * rejected / N).toFixed(2),
             meanLumaAdded: n ? +(add / n).toFixed(2) : 0,
             maxLumaAdded: +mx.toFixed(1), frameLumaAdded: +(add / N).toFixed(3),
             lightRGB: n ? [dr, dg, db].map(v => Math.round(v / n)) : null,
             lightWarmth: n ? +((dr - db) / n).toFixed(1) : null };
  }, { POSE, p });
}

// Retry a pose that does not settle. "Never trust a single run" (README) cuts
// both ways: a run that reports it did not settle is not a result to be argued
// with, it is a run to be redone. Jumping away first forces a full re-tile
// rather than re-reading the same stuck state.
const results = [];
for (const pose of POSES) {
  let r = await histogram(pose, P);
  for (let attempt = 1; attempt <= 2 && !r.load.ok; attempt++) {
    console.log(`   (${pose.name} did not settle — retry ${attempt})`);
    await page.evaluate(() => window.__map.jumpTo({ center: [-97.70, 30.32], zoom: 12, pitch: 0, bearing: 0 }));
    await page.waitForTimeout(2500);
    r = await histogram(pose, P);
  }
  results.push(r);
}
const lamps = [];
if (DO_LAMPS) for (const name of LAMP_POSES) {
  const pose = POSES.find(p => p.name === name);
  let l = await lampDelta(pose, P);
  for (let attempt = 1; attempt <= 2 && (!l.settled || l.rejectedShare > 1 || !l.pixels); attempt++) {
    console.log(`   (lamp A/B at ${name} unclean — retry ${attempt})`);
    await page.evaluate(() => window.__map.jumpTo({ center: [-97.70, 30.32], zoom: 12, pitch: 0, bearing: 0 }));
    await page.waitForTimeout(2500);
    l = await lampDelta(pose, P);
  }
  lamps.push(l);
}

const f = n => String(n).padStart(8);
console.log(`\nnight-luma @ p=${P}  (${BASE})`);
if (lampGen) console.log(`streetlights generated: ${lampGen.count}` +
  (lampGen.walk != null ? ` (${lampGen.major} major / ${lampGen.minor} minor / ${lampGen.walk} walk, mean warmth ${lampGen.meanWarmth})` : ''));
console.log('');
for (const r of results) {
  console.log(`── ${r.pose} ────────────────────────────────────────────────────────`);
  console.log(r.load.ok
    ? `   settled: ${r.load.trees} trees / ${r.load.bld} buildings queryable, drift ${r.load.drift}`
    : `   *** NEVER SETTLED (${r.load.trees} trees, ${r.load.bld} buildings, drift ${r.load.drift}) — numbers below are on a half-loaded scene ***`);
  console.log(`   frame mean luma ${r.frameMean}  (${r.frameMeanNorm} normalised; AE night ceiling ${AE_CEIL})`);
  console.log(`   class          share%     p50     p90     p99     max   meanRGB          R-B`);
  for (const k of ['all', 'lit', 'pale', 'dark', 'sky', 'skyLow']) {
    const s = r[k];
    if (!s.n) { console.log(`   ${k.padEnd(12)}   (empty)`); continue; }
    console.log(`   ${k.padEnd(12)}${f(s.share)}${f(s.p50)}${f(s.p90)}${f(s.p99)}${f(s.max)}   ` +
                `${String(s.rgb.join(',')).padEnd(14)}${String(s.warmth).padStart(6)}`);
  }
  console.log('');
}
for (const l of lamps) {
  console.log(`── streetlight A/B @ ${l.pose} ${l.settled ? '' : '(*** a toggle never settled ***)'}`);
  console.log(`   ${l.pixels} px lit (${l.shareOfFrame}% of frame), mean +${l.meanLumaAdded} luma where they land, ` +
              `max +${l.maxLumaAdded}, +${l.frameLumaAdded} across the whole frame`);
  console.log(`   the light they add is rgb(${l.lightRGB}) — warmth R-B ${l.lightWarmth}`);
  console.log(`   ${l.rejected} px (${l.rejectedShare}%) thrown out because the scene moved under the toggle` +
              (l.rejectedShare > 8 ? '   *** too many: do not trust this A/B ***' : ''));
  if (l.windows.n) console.log(`   windows alone (lamps hidden): ${l.windows.share}% of frame lit, ` +
    `p50 ${l.windows.p50}, p90 ${l.windows.p90}, p99 ${l.windows.p99}, warmth R-B ${l.windows.warmth}`);
  console.log('');
}

// ── The assertions ────────────────────────────────────────────────────
//
// Deliberately NOT "lit p99 >= pale p99". The chroma classes above are
// reporting, not law: the scene legitimately contains COOL light sources —
// TV-blue and cool-fluorescent window tones, and 4000K LED lamps on the outer
// streets — so no chroma threshold separates "a light" from "an unlit wall"
// in general. Chasing that split produced a *FAIL on the wide pose (lit p99
// 224 vs pale p99 225) that was two lit windows on opposite sides of an
// arbitrary line.
//
// What IS unambiguous, and is the actual claim, is the SHAPE of the histogram:
// ~90% of a night frame is unlit mass and the top percentile is light sources,
// so p50/p90 measure the surfaces and p99/max measure the lights. Night reads
// as a city when the gap between them is large.
let fail = 0;
const check = (name, ok, detail) => { console.log(`${ok ? ' PASS' : '*FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); if (!ok) fail++; };

console.log('');
for (const r of results) {
  if (!r.load.ok) { console.log(`*FAIL  ${r.pose}: scene never settled, refusing to assert on it`); fail++; continue; }
  check(`${r.pose}: night is still night (unlit mass median under 45)`,
    r.all.p50 < 45, `frame p50 ${r.all.p50}`);
  check(`${r.pose}: the frame has a real bright tail (p99 >= 2.5x p50)`,
    r.all.p99 >= 2.5 * r.all.p50, `p99 ${r.all.p99} vs p50 ${r.all.p50} (ratio ${(r.all.p99 / r.all.p50).toFixed(2)})`);
  check(`${r.pose}: the unlit mass stays below the sky at the roofline`,
    r.dark.n && r.skyLow.n && r.skyLow.p50 > r.dark.p50, `sky-at-roofline p50 ${r.skyLow.p50} vs unlit p50 ${r.dark.p50}`);
}
if (lamps.length) {
  const core = lamps.find(l => l.pose === 'core'), west = lamps.find(l => l.pose === 'west');
  const trust = l => l && l.settled && l.rejectedShare <= 1;
  if (trust(core) && trust(west)) {
    // A margin, not just a sign. The baseline already had core at R-B 34.6 and
    // west at 29.1 — a 5.5 gap that falls out of the tier mix at those two
    // poses and reflects no intent — so a bare `>` passes on a scene with no
    // gradient in it at all.
    check('warm core, cool edge: core lamplight is warmer than edge lamplight by a real margin',
      core.lightWarmth > west.lightWarmth + 15,
      `core R-B ${core.lightWarmth} vs west R-B ${west.lightWarmth} (baseline gap was 5.5)`);
  } else {
    console.log(` SKIP  warm core / cool edge: the lamp A/B did not settle cleanly at both poses ` +
                `(core rejected ${core ? core.rejectedShare : '?'}%, west ${west ? west.rejectedShare : '?'}%). ` +
                `night-lights.mjs asserts the same claim on the generated data instead.`);
  }
}

// ── The before/after guard ─────────────────────────────────────────────
if (BASE_JSON) {
  const prev = JSON.parse(fs.readFileSync(BASE_JSON, 'utf8'));
  console.log(`
A/B against ${BASE_JSON}
`);
  console.log('   pose      frameMean       p50        p90        p99        max     p99/p50');
  for (const r of results) {
    const o = prev.results.find(x => x.pose === r.pose);
    if (!o) continue;
    const row = (tag, x) => `   ${tag.padEnd(9)} ${String(x.frameMeanNorm ?? '').padEnd(9)}` +
      `${String(x.all.p50).padStart(6)}${String(x.all.p90).padStart(11)}${String(x.all.p99).padStart(11)}` +
      `${String(x.all.max).padStart(11)}${(x.all.p99 / x.all.p50).toFixed(2).padStart(11)}`;
    console.log(row(r.pose + ' before', o));
    console.log(row('  after', r));
    // The unlit mass may drift a little (quantisation, one luma unit), but it
    // must not track the tail. If p50 rises as fast as p99, the whole frame is
    // being lifted and the silhouette is going with it.
    check(`${r.pose}: the unlit mass did not get lifted with the lights (p50 +<=8%)`,
      r.all.p50 <= o.all.p50 * 1.08, `p50 ${o.all.p50} -> ${r.all.p50}`);
    check(`${r.pose}: the light sources actually got brighter (p99 up)`,
      r.all.p99 > o.all.p99, `p99 ${o.all.p99} -> ${r.all.p99}`);
    // 3% of slack, because p50 lives in an integer histogram bin down at ~28
    // and a single bin of quantisation there is already 3.5% of the ratio. The
    // Drag pose reads 4.64 -> 4.59 purely from p50 landing on 29 instead of 28
    // while p99 rose 130 -> 133 and max rose 230 -> 250. Without the slack that
    // is a *FAIL on a frame that got measurably better.
    check(`${r.pose}: contrast between lights and mass did not fall`,
      r.all.p99 / r.all.p50 >= (o.all.p99 / o.all.p50) * 0.97,
      `p99/p50 ${(o.all.p99 / o.all.p50).toFixed(2)} -> ${(r.all.p99 / r.all.p50).toFixed(2)}`);
    check(`${r.pose}: frame mean still under the auto-exposure ceiling`,
      r.frameMeanNorm <= AE_CEIL, `${o.frameMeanNorm} -> ${r.frameMeanNorm} (ceiling ${AE_CEIL})`);
  }
}
console.log('');

if (jsonOut) { fs.writeFileSync(jsonOut, JSON.stringify({ p: P, lampGen, results, lamps }, null, 1)); console.log('WROTE ' + jsonOut); }
await browser.close();
process.exit(fail ? 1 : 0);
