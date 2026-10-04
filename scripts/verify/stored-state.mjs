/**
 * stored-state.mjs — saved browser state must never quietly make the app worse.
 *
 *   VERIFY_URL=http://127.0.0.1:8442 node stored-state.mjs <outDir> [--break]
 *
 * Why: a hard refresh does not clear localStorage, so a bad value saved under
 * `austin3d.gfx.v1` decides the scene on every later visit. This seeds bad and
 * stale saves into fresh browser contexts BEFORE the page's own scripts run,
 * loads the real page, and asserts two things:
 *
 *   1. the settings the page ended up with (GFX) — a value that is out of
 *      range, the wrong type or unparsable is dropped, and an automatic
 *      downgrade to `performance` that has run out is taken back with the
 *      probe armed again; one that is fresh, and one chosen by hand, stay.
 *      "Armed" is read off the page, not assumed: an init script counts the
 *      setTimeout calls made with the probe's own delay (PROBE_DELAY_MS), and
 *      the clean profile has to show one, or the instrument is not measuring.
 *   2. what is DRAWN downtown at the default quality: the outer ring's tower,
 *      mid-rise and low-rise layers each return rendered features from the
 *      same downtown pose, within 10% of a clean-profile load, and switching
 *      the tower layer off changes pixels (so the features are on screen, not
 *      merely in a query).
 *
 * Scenarios (each its own context, so each load reads its own seed):
 *   clean     no saved state: the baseline every other scenario is held to
 *   corrupt   parses, means nothing: outerDensity 0, renderDistance -5,
 *             renderScale 0.01, treeDensity "lots", shadows "yes", preset "bogus"
 *   garbage   the key holds text that is not JSON
 *   expired   `performance` stamped as an automatic downgrade 30 days ago
 *   fresh     the same stamp, one hour old, already judged for the weak tier:
 *             must NOT be undone, and the probe is not armed
 *   unjudged  the same stamp and age but never judged for the weak tier (a save
 *             from before the tier, or a first visit closed between the two probe
 *             steps): stays Performance, nothing rebuilt, probe armed for the weak
 *             step alone
 *   oldauto   a real browser's save from before the stamp existed (rev 3):
 *             `performance`, autoDetected, no stamp. Goes back to `balanced`
 *             with the probe armed, once (REV_UNSTAMPED_AUTO in js/graphics.js)
 *   chosen    the same shape written by the current code (rev 4): a hand pick,
 *             must NOT be undone, and the probe must NOT be armed for it (the
 *             weak step needs the stamp: a hand pick never gets one)
 *
 * The weak tier (js/graphics.js WEAK_TIER) is the second automatic step, so it
 * follows the same rules; each of these loads the real page and reads the
 * apartments' own report of what they drew (`slopesApartments.far`):
 *   weakfresh    Performance + weak tier, stamped an hour ago: stays, blocks built
 *                at 700 m, probe NOT armed
 *   weakexpired  the same, stamped 30 days ago: the tier is KEPT (no climb back
 *                to Balanced), blocks built, and the probe is armed to MEASURE it
 *   weaknostamp  the tier with no stamp (a hand-picked Performance): put back to
 *                "all", no blocks, probe not armed
 *   weakbad      a fresh stamp but a nonsense tier value: dropped to "all", the
 *                judged flag voided, so the probe is armed to judge it again
 *   weakcustom   the tier set by hand (a moved slider): stays, and never expires
 *
 * --break  sabotages inside the page only: after the corrupt load it writes
 *          outerDensity 0 into the live GFX and re-applies the outer layer,
 *          which is what an unvalidated save did. The gate must come back red,
 *          and the same step is the proof that the bad value really hides
 *          buildings (the reproduction).
 *
 * Exit: 0 pass, 1 an assertion failed, 2 could not run.
 * Run through the GPU queue: node <lanes>/gpu-run.mjs --label stored-state -- node stored-state.mjs <outDir>
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { BASE, launch } from './chrome.mjs';

const OUT = process.argv[2];
if (!OUT) { console.error('usage: stored-state.mjs <outDir> [--break]'); process.exit(2); }
const BREAK = process.argv.includes('--break');
// --only=a,b runs just those scenarios (and `clean`, the baseline): the --break proof needs only `corrupt`.
const onlyArg = process.argv.find(a => a.startsWith('--only='));
const ONLY = onlyArg ? new Set(['clean', ...onlyArg.slice(7).split(',')]) : null;
const ran = n => !ONLY || ONLY.has(n);
fs.mkdirSync(OUT, { recursive: true });

const KEY = 'austin3d.gfx.v1';
const DAY = 24 * 3600 * 1000;
const LAYERS = ['outer-tower', 'outer-midrise', 'outer-3d'];
const PROBE_DELAY_MS = 11000;   // = PROBE_DELAY_MS in js/graphics.js: how the probe's timer is told from the rest
const POSE = { center: [-97.7420, 30.2760], zoom: 15.2, pitch: 55, bearing: 200 };
const TOL = 0.9;     // a scenario must draw at least this share of the clean baseline
const WEAK_M = 700;  // = WEAK_TIER.fullDetailM in js/graphics.js
const ALL_M = 2000;  // = WEAK_TIER.unlimitedAt: the slider's maximum, "all of it"

const SCENARIOS = {
  clean: { raw: null },
  corrupt: { raw: JSON.stringify({
    preset: 'bogus', outerDensity: 0, renderDistance: -5, renderScale: 0.01,
    treeDensity: 'lots', shadows: 'yes', msaa: [1], rev: 3 }) },
  garbage: { raw: '{not json at all' },
  expired: { raw: JSON.stringify({ preset: 'performance', autoDetected: true, custom: false,
    autoDownAt: Date.now() - 30 * DAY, rev: 3 }) },
  fresh: { raw: JSON.stringify({ preset: 'performance', autoDetected: true, custom: false,
    autoDownAt: Date.now() - 3600 * 1000, weakChecked: true, rev: 3 }) },
  // The same stamped Performance, never judged for the weak tier (a save from before the tier
  // existed, or a first visit closed between the two probe steps).
  unjudged: { raw: JSON.stringify({ preset: 'performance', autoDetected: true, custom: false,
    autoDownAt: Date.now() - 3600 * 1000, rev: 3 }) },
  // The saved value of a real desktop browser that was stuck on Performance:
  // every key, rev 3, no autoDownAt. Verbatim.
  oldauto: { raw: JSON.stringify({ renderScale: 0.75, msaa: true, bloom: 0, godRays: 0, flare: 0, dof: 0,
    windowReflections: 1, exposure: 1.03, contrast: 1.06, saturation: 1, filmic: 0.65, vignette: 1,
    autoExposure: false, grain: 0, renderDistance: 350, ao: false, shadows: true, clouds: 0.4, stars: 0.5,
    fov: 58, treeDensity: 0.52, outerDensity: 0.45, preset: 'performance', custom: false,
    autoDetected: true, rev: 3 }) },
  chosen: { raw: JSON.stringify({ preset: 'performance', autoDetected: true, custom: false, rev: 4 }) },
  weakfresh: { raw: JSON.stringify({ preset: 'performance', autoDetected: true, custom: false, rev: 4,
    autoDownAt: Date.now() - 3600 * 1000, fullDetailM: WEAK_M, weakChecked: true }) },
  weakexpired: { raw: JSON.stringify({ preset: 'performance', autoDetected: true, custom: false, rev: 4,
    autoDownAt: Date.now() - 30 * DAY, fullDetailM: WEAK_M, weakChecked: true }) },
  weaknostamp: { raw: JSON.stringify({ preset: 'performance', autoDetected: true, custom: false, rev: 4,
    fullDetailM: WEAK_M, weakChecked: true }) },
  weakbad: { raw: JSON.stringify({ preset: 'performance', autoDetected: true, custom: false, rev: 4,
    autoDownAt: Date.now() - 3600 * 1000, fullDetailM: 'far', weakChecked: true }) },
  weakcustom: { raw: JSON.stringify({ preset: 'performance', autoDetected: true, custom: true, rev: 4,
    autoDownAt: Date.now() - 30 * DAY, fullDetailM: 400, weakChecked: true }) },
};

// What each scenario must end with. `healed` ones also owe the downtown frame.
const EXPECT = {
  clean:   { preset: 'balanced', autoDetected: false, armed: true, draws: true },
  corrupt: { preset: 'balanced', autoDetected: false, armed: true, draws: true,
             values: { outerDensity: 1, renderDistance: 700, renderScale: null, treeDensity: 0.675, shadows: true } },
  garbage: { preset: 'balanced', autoDetected: false, armed: true, draws: true },
  expired: { preset: 'balanced', autoDetected: false, armed: true, draws: true },
  oldauto: { preset: 'balanced', autoDetected: false, armed: true, draws: true,
             values: { renderDistance: 700, outerDensity: 1, renderScale: 1, rev: 4 } },
  fresh:   { preset: 'performance', autoDetected: true, armed: false },
  // Kept as Performance, nothing rebuilt, and the probe armed for the weak step alone.
  unjudged: { preset: 'performance', autoDetected: true, armed: true, recheck: false, far: null,
              values: { fullDetailM: ALL_M, weakChecked: false } },
  chosen:  { preset: 'performance', autoDetected: true, armed: false, values: { fullDetailM: ALL_M } },
  // `far`: what the apartments report once built (null = blocks not built). `recheck`: the saved tier waits to be measured.
  weakfresh:   { preset: 'performance', autoDetected: true, armed: false, recheck: false, far: WEAK_M,
                 values: { fullDetailM: WEAK_M, weakChecked: true } },
  weakexpired: { preset: 'performance', autoDetected: true, armed: true, recheck: true, far: WEAK_M,
                 values: { fullDetailM: WEAK_M, weakChecked: true } },
  weaknostamp: { preset: 'performance', autoDetected: true, armed: false, recheck: false, far: null,
                 values: { fullDetailM: ALL_M, weakChecked: false } },
  weakbad:     { preset: 'performance', autoDetected: true, armed: true, recheck: false, far: null,
                 values: { fullDetailM: ALL_M, weakChecked: false } },
  weakcustom:  { preset: 'performance', autoDetected: true, armed: false, recheck: false, far: WEAK_M - 300,
                 values: { fullDetailM: 400, custom: true } },
};

let failures = 0;
const report = { base: BASE, break: BREAK, scenarios: {}, checks: [] };
const check = (name, ok, detail) => {
  report.checks.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? ' PASS' : ' FAIL'}  ${name}${detail !== undefined ? '  ' + JSON.stringify(detail).slice(0, 260) : ''}`);
};

const browser = await launch(chromium, { gl: 'hardware', maxMs: 1500000 });

async function load(name) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const raw = SCENARIOS[name].raw;
  // Runs before any page script, on every navigation of this context.
  await ctx.addInitScript(([key, value]) => {
    try { if (value !== null) localStorage.setItem(key, value); } catch (e) {}
  }, [KEY, raw]);
  // Count the timers the auto-detect probe arms (see PROBE_DELAY_MS).
  await ctx.addInitScript(delay => {
    window.__probeArmed = 0;
    const st = window.setTimeout;
    window.setTimeout = function (fn, ms, ...rest) { if (ms === delay) window.__probeArmed++; return st.call(this, fn, ms, ...rest); };
  }, PROBE_DELAY_MS);
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log(`  [${name}] pageerror ${e.message}`));
  await page.goto(BASE + '/_harness.html?intro=0&drift=0', { waitUntil: 'domcontentloaded', timeout: 240000 });
  await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded && window.__map.isStyleLoaded() && window.GFX,
    null, { timeout: 300000 });
  // initGraphics (which arms the probe) runs inside the app's build steps, a
  // beat after the style loads: wait for the canvas it appends before reading.
  await page.waitForFunction(() => document.getElementById('fx-canvas'), null, { timeout: 120000 });
  // The probe is a correctness hazard in a test (README): it would downgrade a
  // balanced load mid-measurement. Boot-time state is already decided by now.
  const armed = await page.evaluate(() => window.__probeArmed > 0);
  const recheck = await page.evaluate(() => !!(window.__gfxWeakRecheck && window.__gfxWeakRecheck()));
  await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
  return { ctx, page, armed, recheck };
}

// What the apartments drew, as they report it: wait for the build to finish, then ask.
async function farReach(page) {
  const ready = await page.waitForFunction(() => window.slopesApartments && window.slopesApartments.readyToReveal(),
    null, { timeout: 280000 }).then(() => true, () => false);
  const far = await page.evaluate(() => window.slopesApartments ? window.slopesApartments.far : null);
  return { ready, built: !!(far && far.built), reachM: far ? far.reachM : null };
}

async function downtown(page, sabotage) {
  await page.evaluate(q => window.__map.jumpTo(q), POSE);
  if (sabotage) {
    await page.evaluate(() => { window.GFX.outerDensity = 0; window.applyOuterSettings(window.__map); });
  }
  // Wait for the outer ring to be added and its tiles to land at this pose.
  await page.waitForFunction(layers => layers.every(l => window.__map.getLayer(l)), LAYERS, { timeout: 120000 });
  await page.evaluate(() => new Promise(r => {
    const m = window.__map;
    const go = () => { if (m.loaded() && m.areTilesLoaded()) return r(); m.once('idle', r); };
    go(); setTimeout(r, 60000);
  }));
  await page.waitForTimeout(3000);
  return page.evaluate(async layers => {
    const m = window.__map;
    const counts = {};
    const q = () => { for (const l of layers) counts[l] = m.queryRenderedFeatures({ layers: [l] }).length; };
    q();
    // Tile fetches finish late and out of order: re-read until two reads agree.
    for (let i = 0; i < 6; i++) {
      const before = JSON.stringify(counts);
      await new Promise(r => setTimeout(r, 1500));
      m.triggerRepaint(); q();
      if (JSON.stringify(counts) === before) break;
    }
    const read = async () => {
      m.triggerRepaint();
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const c = m.getCanvas(), gl = c.getContext('webgl2') || c.getContext('webgl');
      const px = new Uint8Array(c.width * c.height * 4);
      gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return px;
    };
    const a = await read();
    m.setLayoutProperty('outer-tower', 'visibility', 'none');
    await new Promise(r => setTimeout(r, 1200));
    const b = await read();
    m.setLayoutProperty('outer-tower', 'visibility', 'visible');
    let diff = 0;
    for (let i = 0; i < a.length; i += 4)
      if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) >= 70) diff++;
    return { counts, towerPixels: diff };
  }, LAYERS);
}

const results = {};
for (const name of Object.keys(SCENARIOS).filter(ran)) {
  const t0 = Date.now();
  const { ctx, page, armed, recheck } = await load(name);
  const snap = await page.evaluate(() => ({ ...window.GFX }));
  const ex = EXPECT[name];
  let drawn = null;
  const far = ex.far !== undefined ? await farReach(page) : null;
  if (ex.draws) {
    drawn = await downtown(page, BREAK && name === 'corrupt');
    if (name === 'clean') await page.screenshot({ path: path.join(OUT, 'clean-downtown.png') });
    if (name === 'corrupt') await page.screenshot({ path: path.join(OUT, `corrupt-downtown${BREAK ? '-broken' : ''}.png`) });
  }
  results[name] = { snap, drawn, armed, recheck, far };
  report.scenarios[name] = { preset: snap.preset, autoDetected: snap.autoDetected, armed, recheck, outerDensity: snap.outerDensity,
    renderDistance: snap.renderDistance, fullDetailM: snap.fullDetailM, far, drawn, seconds: Math.round((Date.now() - t0) / 1000) };
  console.log(`  [${name}] ${JSON.stringify(report.scenarios[name])}`);
  await ctx.close();
}

const base = results.clean.drawn;
check('baseline draws the three downtown layers', LAYERS.every(l => base.counts[l] > 0) && base.towerPixels > 500,
  { counts: base.counts, towerPixels: base.towerPixels });
for (const [name, ex] of Object.entries(EXPECT).filter(([n]) => ran(n))) {
  const { snap, drawn, armed, recheck, far } = results[name];
  check(`${name}: preset ${ex.preset}, autoDetected ${ex.autoDetected}`,
    snap.preset === ex.preset && !!snap.autoDetected === ex.autoDetected, { preset: snap.preset, autoDetected: snap.autoDetected });
  check(`${name}: probe ${ex.armed ? 'armed' : 'not armed'}`, armed === ex.armed, { armed });
  if (ex.recheck !== undefined) check(`${name}: saved tier ${ex.recheck ? 'is' : 'is not'} waiting to be measured`, recheck === ex.recheck, { recheck });
  if (ex.far !== undefined) check(`${name}: apartments ${ex.far === null ? 'all drawn in full (no far blocks)' : 'far blocks built from ' + ex.far + ' m'}`,
    far.ready && far.built === (ex.far !== null) && far.reachM === ex.far, far);
  for (const [k, v] of Object.entries(ex.values || {})) {
    const got = snap[k];
    const ok = v === null ? (typeof got === 'number' && got >= 0.5 && got <= 2) : got === v;
    check(`${name}: ${k} back to a sane value`, ok, { got });
  }
  if (ex.draws) {
    const shortfall = LAYERS.filter(l => drawn.counts[l] < base.counts[l] * TOL);
    check(`${name}: downtown drawn (within ${Math.round((1 - TOL) * 100)}% of clean)`,
      shortfall.length === 0 && drawn.towerPixels > base.towerPixels * TOL, { counts: drawn.counts, towerPixels: drawn.towerPixels, shortfall });
  }
}

fs.writeFileSync(path.join(OUT, 'stored-state.json'), JSON.stringify(report, null, 1));
await browser.close();
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
