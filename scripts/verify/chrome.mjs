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

/** Headless flags that make WebGL work without a GPU. */
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
 */
const MAX_RUN_MS = Number(process.env.VERIFY_MAX_MS || 300000);

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
  const args = [...new Set([...(opts.args || GL_ARGS), MARK_ARG])];
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
