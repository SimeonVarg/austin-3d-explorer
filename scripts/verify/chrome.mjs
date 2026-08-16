/**
 * chrome.mjs — find a Chrome that actually launches.
 *
 * Do NOT reach for Playwright's own bundled Chromium without checking it: on the
 * machine this suite was written on it fails with "the application has failed to
 * start because its side-by-side configuration is incorrect" (a missing VC++
 * redistributable), and the failure surfaces as an opaque `spawn UNKNOWN`.
 * A real installed Chrome works fine, so prefer that.
 *
 * Override with CHROME_PATH if your install is somewhere unusual.
 */
import fs from 'node:fs';

const CANDIDATES = [
  process.env.CHROME_PATH,
  // Windows
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA || ''}/Google/Chrome/Application/chrome.exe`,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  // macOS
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  // Linux
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

export function chromePath() {
  for (const p of CANDIDATES) {
    try { if (fs.existsSync(p)) return p; } catch (e) {}
  }
  throw new Error(
    'No Chrome found. Set CHROME_PATH to a Chrome/Edge binary.\nTried:\n  ' +
    CANDIDATES.join('\n  ')
  );
}

/**
 * TWO GL BACKENDS, and choosing the wrong one costs either correctness or hours.
 *
 * THE MEASUREMENT THAT PROMPTED THIS (Acer, 2026-08-01, same scene, same pose):
 *
 *   --use-angle=swiftshader          3.7 fps   SwiftShader Device (Subzero)
 *   no swiftshader flags            34.6 fps   AMD Radeon, D3D11
 *   + --force_high_performance_gpu  35.3 fps   NVIDIA RTX 3050 Ti, D3D11
 *
 * 9.4x, for deleting three flags. The premise that this laptop "has no usable
 * GPU" was never true — it has an RTX 3050 Ti. It was being TOLD not to use it.
 * The comment that used to sit here said these were "flags that make WebGL work
 * without a GPU", which was accurate and became load-bearing by accident.
 *
 * Note the discrete GPU is barely faster than the integrated one (35.3 vs 34.6).
 * The win is hardware versus software, not which chip.
 *
 * SO WHY IS SWIFTSHADER STILL THE DEFAULT? Because it is deterministic. Around a
 * hundred scripts here assert EXACT hex at named pixels, and hardware and
 * software rasterisers legitimately disagree about antialiasing, blending and
 * filtering. Swapping the backend under those would silently invalidate the
 * suite — a much worse outcome than a slow suite. README already says software
 * rendering is "right for pixel assertions and useless for timing".
 *
 * So: correctness scripts keep SwiftShader. Timing and screenshot scripts, where
 * exact pixels do not matter but wall-clock does, ask for hardware.
 *
 *   VERIFY_GL=hardware node <script>     one run
 *   launch(chromium, { gl: 'hardware' }) from inside a script
 */
export const GL_ARGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--no-sandbox',
  // swiftshader rasterises on the CPU, so an unbounded renderer will happily
  // take every core and all the RAM. These cap one run's blast radius.
  '--disable-dev-shm-usage',
  '--renderer-process-limit=2',
  '--js-flags=--max-old-space-size=2048',
];

/** Real GPU. No --use-angle, so ANGLE picks the platform default (D3D11 here). */
export const HW_ARGS = [
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--ignore-gpu-blocklist',
  '--enable-gpu-rasterization',
  // Without this a laptop hands headless Chrome the INTEGRATED chip. Costs
  // nothing on a desktop or a machine with one GPU.
  '--force_high_performance_gpu',
];

/**
 * Is this run allowed a real GPU? Explicit opts.gl wins, then VERIFY_GL, then
 * SwiftShader — so the default stays deterministic and nothing silently
 * changes renderer under a pixel assertion.
 */
export function glArgsFor(pref) {
  const want = pref || process.env.VERIFY_GL || 'swiftshader';
  return want === 'hardware' ? HW_ARGS : GL_ARGS;
}

export const BASE = process.env.VERIFY_URL || 'http://127.0.0.1:8099';

/**
 * launch() — a browser that ALWAYS dies, even when the script does not.
 *
 * THIS EXISTS BECAUSE IT TOOK SIMEON'S LAPTOP DOWN. Every script here called
 * `browser.close()` on the last line and nothing else, so any run that was
 * killed, timed out, or threw left a full swiftshader Chrome — parent plus
 * renderers — alive forever. Thirty-eight of them accumulated across a session
 * of verification runs, pinned the machine at 100% CPU and memory, and cost him
 * hours in the middle of a deadline.
 *
 * A screenshot harness has no business outliving its own process. So:
 *   - close on normal exit, on Ctrl-C, on SIGTERM, and on an uncaught throw;
 *   - a hard watchdog kills the browser after MAX_RUN_MS no matter what the
 *     script is doing, because "the render is just slow" and "the render is
 *     wedged" look identical from outside and only one of them ends;
 *   - kill() rather than close() in the signal path, since a wedged renderer
 *     will not honour a graceful close — which is exactly how they survived.
 *
 * If a run genuinely needs longer than the watchdog, pass VERIFY_MAX_MS. Do not
 * remove the watchdog.
 *
 * READ AT launch() TIME, NOT AT IMPORT TIME (changed 2026-08-16, §154). It used
 * to be a module-level `const`, which meant a script could not raise its own
 * ceiling: ESM hoists imports, so a `process.env.VERIFY_MAX_MS ||= ...` at the
 * top of the script ran AFTER this module body had already frozen the value.
 * `walk.mjs` needs ~7 minutes for 3 sites plus the watched failure and was
 * therefore UNRUNNABLE the way README documents it — exit 124, killed mid-gate,
 * one minute after it had already printed PASS on all three sites. A gate that
 * cannot finish inside its own watchdog is a dead gate, in the same family as a
 * gate that crashes. Callers may also pass `maxMs`.
 */
const DEFAULT_MAX_RUN_MS = 300000;

/**
 * The tag reap.mjs filters on. It must be present on EVERY harness browser,
 * including the headed perf runs that pass their own anti-throttling args and
 * never touch swiftshader — otherwise the reaper cannot see exactly the runs
 * most likely to be left behind. It is functionally inert: it permits
 * swiftshader, it does not select it.
 */
export const MARK_ARG = '--enable-unsafe-swiftshader';

export async function launch(chromium, opts = {}) {
  // A caller that supplies `args` is replacing the GL defaults on purpose (the
  // headed perf runs do), so respect that — but union in the marker either way.
  //
  // THE TRAP THIS COMMENT USED TO HIDE. `opts.args || GL_ARGS` means a caller
  // that passes `{ headless: false }` and NO args silently gets the full
  // SwiftShader set — so it runs headed, on a CPU rasteriser, measuring nothing
  // it claims to measure. 17 of the 21 *-perf scripts were in exactly that
  // state, including perf.mjs, whose own header opens "1. RUN ON A REAL GPU"
  // and then calls `launch(chromium)` bare. Every frame-time A/B they have ever
  // printed was a software rasteriser's fill rate.
  //
  // So: a HEADED run defaults to hardware, because there is no other honest
  // reading of asking for a visible window to measure frames in. Headless still
  // defaults to SwiftShader for determinism. Either can be overridden with
  // `gl:` or VERIFY_GL.
  const headed = opts.headless === false;
  const args = [...new Set([
    ...(opts.args || glArgsFor(opts.gl || (headed ? 'hardware' : null))),
    MARK_ARG,
  ])];
  const MAX_RUN_MS = Number(opts.maxMs || process.env.VERIFY_MAX_MS || DEFAULT_MAX_RUN_MS);
  delete opts.gl;
  delete opts.maxMs;
  const browser = await chromium.launch({
    executablePath: chromePath(),
    headless: true,
    ...opts,
    args,
  });

  let reaped = false;
  const reap = (why, code) => {
    if (reaped) return;
    reaped = true;
    try { browser.process()?.kill('SIGKILL'); } catch (e) {}
    try { browser.close(); } catch (e) {}
    if (why) console.error(`[chrome.mjs] browser killed: ${why}`);
    if (code != null) process.exit(code);
  };

  const watchdog = setTimeout(() => reap(`watchdog at ${MAX_RUN_MS} ms`, 124), MAX_RUN_MS);
  watchdog.unref?.();

  process.once('exit', () => reap());
  process.once('SIGINT', () => reap('SIGINT', 130));
  process.once('SIGTERM', () => reap('SIGTERM', 143));
  process.once('uncaughtException', e => { console.error(e); reap('uncaughtException', 1); });
  process.once('unhandledRejection', e => { console.error(e); reap('unhandledRejection', 1); });

  browser.__done = () => { clearTimeout(watchdog); return reap(); };
  return browser;
}
