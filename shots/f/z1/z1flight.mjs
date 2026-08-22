/**
 * z1flight.mjs — the instrument that measured the Z1 fix (reel-shot veil gate).
 *
 * Same pattern as the evidence lane's run (docs/z1-slidein.md, boot.mjs): a
 * property-setter on `window.__map` installed via addInitScript, so the clock
 * starts at navigation and no `sourcedata` event can be missed. Logs every
 * FIRST load event per `austin-outer` tile (z/x/y), the veil lift (MutationObserver
 * on #veil's class), the reveal reason, and frames at fixed offsets from the
 * veil lift — so a before/after pair is comparable frame for frame.
 *
 * Usage:  node z1flight.mjs <label> [flag]      (flag defaults to autopilot)
 * Expects `python scripts/serve.py 8641` already running from the repo root.
 * Lives in shots/f/z1/ because that is this lane's evidence directory; imports
 * playwright-core by explicit path for the same reason.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { chromium } from '../../../scripts/verify/node_modules/playwright-core/index.mjs';

const OUT   = path.dirname(fileURLToPath(import.meta.url));
const LABEL = process.argv[2] || 'run';
const FLAG  = process.argv[3] || 'autopilot';   // autopilot | timelapse | plain (the intro page)
const URL   = FLAG === 'plain'
  ? 'http://127.0.0.1:8641/?preset=cinematic&drift=0'
  : `http://127.0.0.1:8641/?${FLAG}=1&preset=cinematic&drift=0`;

// Explicit executable, hardware GL (this is a timing run, not a pixel assert —
// scripts/verify/chrome.mjs documents why timing must not run on SwiftShader).
const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const HW_ARGS = [
  '--no-sandbox', '--disable-dev-shm-usage', '--ignore-gpu-blocklist',
  '--enable-gpu-rasterization', '--force_high_performance_gpu',
  '--enable-unsafe-swiftshader',   // reap.mjs's marker tag, inert here
];

// First ten seconds of the flight. The timelapse retints every frame (a
// measured ~93% frame-rate cost, see js/app.js TL_RETINT_MS) so its page can
// barely service the harness — fewer frames, interval polling, longer waits.
const TL = FLAG === 'timelapse';
const FRAME_OFFSETS_MS = TL ? [0, 5000, 10000] : [0, 2000, 4000, 6000, 8000, 10000];
const FLIGHT_MS = TL ? 58500 : 46200;   // authored legs + gaps
const SETTLE_MS = 14000;      // after the flight, let stragglers land before dumping the log
const POLL = { polling: 500, timeout: 150000 };

const browser = await chromium.launch({ executablePath: EXE, headless: true, args: HW_ARGS });
const kill = () => { try { browser.process()?.kill('SIGKILL'); } catch (e) {} };
const watchdog = setTimeout(() => { console.error('watchdog: killed at 240s'); kill(); process.exit(124); }, 240000);
watchdog.unref?.();
process.once('SIGINT', () => { kill(); process.exit(130); });
process.once('uncaughtException', e => { console.error(e); kill(); process.exit(1); });

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
// Z1_THROTTLE=4 reproduces the reported machine state ("running claude and
// quite a few chrome tabs"): on a quiet box MapLibre's `idle` event happens to
// beat the 7s timeout and acts as an accidental gate, so the defect only shows
// under load. Same 4x the perf suite defaults to (CLAUDE.md rule 10: the
// setting is quoted with every number this instrument prints).
const THROTTLE = Number(process.env.Z1_THROTTLE || 0);
if (THROTTLE > 1) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  console.log(`[z1flight] CPU throttled ${THROTTLE}x`);
}
const consoleErrors = [];
page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });

await page.addInitScript(() => {
  const z1 = window.__z1 = { marks: [], tiles: [], veilLiftAt: null, seen: {} };
  const mark = what => z1.marks.push({ t: Math.round(performance.now()), what });
  let realMap;
  Object.defineProperty(window, '__map', {
    configurable: true,
    get() { return realMap; },
    set(m) {
      realMap = m;
      mark('map-object-assigned');
      try {
        m.on('load', () => mark('map-load-event'));
        // A `sourcedata` event carrying `e.tile` is a tile that FINISHED
        // loading (MapLibre's _tileLoaded), which is the moment its buildings
        // can first appear on screen. First event per tileID only.
        m.on('sourcedata', e => {
          if (e.sourceId !== 'austin-outer' || !e.tile) return;
          const c = e.tile.tileID && e.tile.tileID.canonical;
          const key = c ? `${c.z}/${c.x}/${c.y}` : 'unknown';
          if (z1.seen[key]) return;
          z1.seen[key] = true;
          let pose = null;
          try {
            const ct = m.getCenter();
            pose = { lng: +ct.lng.toFixed(5), lat: +ct.lat.toFixed(5),
                     zoom: +m.getZoom().toFixed(2), bearing: +m.getBearing().toFixed(1) };
          } catch (err) {}
          z1.tiles.push({ t: Math.round(performance.now()), tileID: key, cum: z1.tiles.length + 1, pose });
        });
      } catch (err) {}
    },
  });
  const watchVeil = () => {
    const v = document.getElementById('veil');
    if (!v) { mark('no-veil-element'); return; }
    const mo = new MutationObserver(() => {
      if (v.classList.contains('lift') && z1.veilLiftAt == null) {
        z1.veilLiftAt = Math.round(performance.now());
        mark('veil-lift');
      }
    });
    mo.observe(v, { attributes: true, attributeFilter: ['class'] });
  };
  if (document.readyState !== 'loading') watchVeil();
  else document.addEventListener('DOMContentLoaded', watchVeil);
});

console.log(`[z1flight] ${LABEL}: ${URL}`);
await page.goto(URL, { waitUntil: 'domcontentloaded' });

// The graphics auto-detect probe is a correctness measure for visitors, noise
// for an instrument. Cancel it as soon as its hook exists.
await page.waitForFunction(() => typeof window.cancelGraphicsAutoDetect === 'function', null, { timeout: 20000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect());

await page.waitForFunction(() => window.__z1 && window.__z1.veilLiftAt != null, null, { timeout: 90000 });
const lift = await page.evaluate(() => window.__z1.veilLiftAt);
console.log(`[z1flight] veil lift at t=${lift}ms`);

// Pose + joystick knob at the lift, for the Shot A contract checks.
const atLift = await page.evaluate(() => {
  const m = window.__map, ct = m.getCenter();
  const k = document.getElementById('joystick-knob');
  return { pose: { lng: +ct.lng.toFixed(5), lat: +ct.lat.toFixed(5),
                   zoom: +m.getZoom().toFixed(2), pitch: +m.getPitch().toFixed(1),
                   bearing: +m.getBearing().toFixed(1) },
           knobTransform: k ? k.style.transform : null,
           intro: window.__intro ? { waitedMs: window.__intro.waitedMs, reason: window.__intro.reason,
                                     gateOkAt: window.__intro.gateOkAt, missingAtLift: window.__intro.missingAtLift } : null };
});

const frames = [];
for (const off of FRAME_OFFSETS_MS) {
  await page.waitForFunction(target => performance.now() >= target, lift + off, POLL);
  const s = await page.evaluate(() => {
    const m = window.__map, ct = m.getCenter();
    const k = document.getElementById('joystick-knob');
    return { t: Math.round(performance.now()),
             pose: { lng: +ct.lng.toFixed(5), lat: +ct.lat.toFixed(5),
                     zoom: +m.getZoom().toFixed(2), bearing: +m.getBearing().toFixed(1) },
             knobTransform: k ? k.style.transform : null,
             tilesSoFar: window.__z1.tiles.length };
  });
  const name = `${LABEL}-f${String(off / 1000).padStart(2, '0')}s.png`;
  // ?timelapse=1 retints every frame and can starve the screenshot pipeline —
  // a missed frame is recorded as missed, never allowed to kill the run.
  try { await page.screenshot({ path: path.join(OUT, name), timeout: 60000 }); }
  catch (e) { console.log(`[z1flight] screenshot ${name} skipped: ${e.message.split('\n')[0]}`); }
  frames.push({ name, ...s });
  console.log(`[z1flight] ${name} t=${s.t} tiles=${s.tilesSoFar} knob=${s.knobTransform}`);
}

// Let the flight finish and the stragglers land, then the reference end frame.
await page.waitForFunction(target => performance.now() >= target, lift + FLIGHT_MS + SETTLE_MS, POLL);
try { await page.screenshot({ path: path.join(OUT, `${LABEL}-end.png`), timeout: 60000 }); }
catch (e) { console.log(`[z1flight] end screenshot skipped: ${e.message.split('\n')[0]}`); }

const dump = await page.evaluate(() => ({
  z1: { marks: window.__z1.marks, veilLiftAt: window.__z1.veilLiftAt, tiles: window.__z1.tiles },
  intro: window.__intro ? { waitedMs: window.__intro.waitedMs, reason: window.__intro.reason,
                            gateOkAt: window.__intro.gateOkAt, missingAtLift: window.__intro.missingAtLift } : null,
  sourceLoadedAtEnd: (() => { try { return window.__map.isSourceLoaded('austin-outer'); } catch (e) { return null; } })(),
}));

const tiles = dump.z1.tiles;
const before = tiles.filter(t => t.t <= lift).length;
const after  = tiles.filter(t => t.t > lift);
const summary = {
  label: LABEL, url: URL, veilLiftAt: lift,
  reason: dump.intro && dump.intro.reason,
  atLift, frames,
  tilesTotal: tiles.length, tilesBehindVeil: before, tilesAfterLift: after.length,
  lastTileT: tiles.length ? tiles[tiles.length - 1].t : null,
  lastTileAfterLiftMs: after.length ? Math.round(after[after.length - 1].t - lift) : null,
  consoleErrors,
};
fs.writeFileSync(path.join(OUT, `${LABEL}-log.json`), JSON.stringify({ summary, ...dump }, null, 2));
console.log(`[z1flight] ${LABEL}: veil=${lift}ms reason=${summary.reason} ` +
            `tiles behind veil=${before}/${tiles.length}, after lift=${after.length}, ` +
            `last tile +${summary.lastTileAfterLiftMs}ms into flight, errors=${consoleErrors.length}`);

clearTimeout(watchdog);
await browser.close();
kill();
