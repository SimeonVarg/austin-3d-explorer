/**
 * gl-check.mjs — does a script get the GL backend it asked for?
 *
 * WHY THIS IS A SCRIPT AND NOT A COMMENT. The backend a run gets is decided by
 * argument-array arithmetic inside `launch()`, it is invisible from the outside,
 * and getting it wrong is silent — a timing script on a CPU rasteriser prints
 * confident numbers that mean nothing. That exact bug shipped twice:
 *
 *   1. `opts.args || GL_ARGS` meant a caller passing `{ headless: false }` and
 *      no args silently got the full SwiftShader set. 17 of 21 *-perf scripts
 *      were in that state, including perf.mjs, whose own header opens
 *      "1. RUN ON A REAL GPU" and then called `launch(chromium)` bare.
 *
 *   2. The fix for that left the same `||` in place for callers who DO pass
 *      args. Four timing scripts (lod-perf, places-perf, roads-perf,
 *      night-perf) pass an anti-throttling set, so their GL flags were replaced
 *      rather than added to, and they ran with no backend selection at all —
 *      ANGLE's default, which is hardware but on a laptop is the INTEGRATED
 *      chip, because --force_high_performance_gpu was one of the flags dropped.
 *
 * Both were arithmetic that read fine and did the wrong thing. So: assert it.
 *
 * Each case below launches for real and reads UNMASKED_RENDERER_WEBGL out of the
 * live context. No reasoning about flags — the driver's own answer.
 *
 * Usage:  VERIFY_URL=http://127.0.0.1:8123 node scripts/verify/gl-check.mjs
 */
import { chromium } from 'playwright-core';
import { launch, MARK_ARG } from './chrome.mjs';

const SOFT = /swiftshader|llvmpipe|softwarerasterizer|software/i;

// The anti-throttling set the four headed timing scripts pass. Copied, not
// imported, so this test keeps failing if someone edits one of them into a
// shape that drops the GL flags again.
const PERF_ARGS = [
  '--no-sandbox',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-background-timer-throttling',
  '--disable-features=CalculateNativeWinOcclusion',
];

const CASES = [
  { name: 'default (headless, no opts)', opts: {}, want: 'software',
    why: 'pixel-assertion scripts must stay deterministic' },
  { name: "gl:'hardware'", opts: { gl: 'hardware' }, want: 'hardware',
    why: 'the 15 bare headless timing scripts' },
  { name: "gl:'hardware' + own args", opts: { gl: 'hardware', args: PERF_ARGS }, want: 'hardware',
    why: 'lod/places/roads/night-perf — gl and args must be orthogonal' },
  { name: "gl:'swiftshader' (explicit)", opts: { gl: 'swiftshader' }, want: 'software',
    why: 'an explicit request for determinism must win' },
  { name: 'own args, no gl said', opts: { args: PERF_ARGS }, want: 'any',
    why: 'legacy shape - recorded, not asserted' },
];

async function rendererFor(opts) {
  const browser = await launch(chromium, { ...opts });
  try {
    const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
    // A bare canvas, not the app: this asks about the browser's GL backend and
    // has no business waiting 20 s for a city to load.
    await page.setContent('<canvas id="c" width="300" height="200"></canvas>');
    return await page.evaluate(() => {
      const g = document.getElementById('c').getContext('webgl2')
             || document.getElementById('c').getContext('webgl');
      if (!g) return 'no webgl context';
      const d = g.getExtension('WEBGL_debug_renderer_info');
      return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unavailable';
    });
  } finally {
    await browser.__done();
  }
}

let fails = 0;
for (const c of CASES) {
  let r;
  try { r = await rendererFor(c.opts); }
  catch (e) { r = 'LAUNCH FAILED: ' + e.message; }
  const soft = SOFT.test(r);
  const got = soft ? 'software' : 'hardware';
  const ok = c.want === 'any' || got === c.want;
  if (!ok) fails++;
  console.log((ok ? '  ok   ' : '  FAIL ') + c.name.padEnd(30)
              + (c.want === 'any' ? '(recorded) ' : 'want ' + c.want.padEnd(9))
              + 'got ' + got);
  console.log('       ' + r);
  console.log('       ' + c.why);
}

// The reaper tag has to be on every harness browser or reap.mjs cannot find the
// runs most likely to be left behind. It is functionally inert.
console.log('\n  reaper tag: ' + MARK_ARG);

console.log('\n' + (fails ? fails + ' FAILED' : 'all backends as requested'));
process.exitCode = fails ? 1 : 0;
