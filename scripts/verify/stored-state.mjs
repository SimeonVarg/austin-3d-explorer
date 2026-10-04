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
 *   fresh     the same stamp, one hour old: must NOT be undone
 *   chosen    `performance` with no stamp (picked by hand): must NOT be undone
 *
 * --break  sabotages inside the page only: after the corrupt load it writes
 *          outerDensity 0 into the live GFX and re-applies the outer layer,
 *          which is what an unvalidated save did. The gate must come back red,
 *          and the same step is the proof that the bad value really hides
 *          buildings (the reproduction).
 *
 * Exit: 0 pass, 1 an assertion failed, 2 could not run.
 * Run through the GPU queue: node <astra-pipe>/tools/gpu-run.mjs --label stored-state -- node stored-state.mjs <outDir>
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { BASE, launch } from './chrome.mjs';

const OUT = process.argv[2];
if (!OUT) { console.error('usage: stored-state.mjs <outDir> [--break]'); process.exit(2); }
const BREAK = process.argv.includes('--break');
fs.mkdirSync(OUT, { recursive: true });

const KEY = 'austin3d.gfx.v1';
const DAY = 24 * 3600 * 1000;
const LAYERS = ['outer-tower', 'outer-midrise', 'outer-3d'];
const POSE = { center: [-97.7420, 30.2760], zoom: 15.2, pitch: 55, bearing: 200 };
const TOL = 0.9;     // a scenario must draw at least this share of the clean baseline

const SCENARIOS = {
  clean: { raw: null },
  corrupt: { raw: JSON.stringify({
    preset: 'bogus', outerDensity: 0, renderDistance: -5, renderScale: 0.01,
    treeDensity: 'lots', shadows: 'yes', msaa: [1], rev: 3 }) },
  garbage: { raw: '{not json at all' },
  expired: { raw: JSON.stringify({ preset: 'performance', autoDetected: true, custom: false,
    autoDownAt: Date.now() - 30 * DAY, rev: 3 }) },
  fresh: { raw: JSON.stringify({ preset: 'performance', autoDetected: true, custom: false,
    autoDownAt: Date.now() - 3600 * 1000, rev: 3 }) },
  chosen: { raw: JSON.stringify({ preset: 'performance', autoDetected: true, custom: false, rev: 3 }) },
};

// What each scenario must end with. `healed` ones also owe the downtown frame.
const EXPECT = {
  clean:   { preset: 'balanced', autoDetected: false, draws: true },
  corrupt: { preset: 'balanced', autoDetected: false, draws: true,
             values: { outerDensity: 1, renderDistance: 700, renderScale: null, treeDensity: 0.675, shadows: true } },
  garbage: { preset: 'balanced', autoDetected: false, draws: true },
  expired: { preset: 'balanced', autoDetected: false, draws: true },
  fresh:   { preset: 'performance', autoDetected: true },
  chosen:  { preset: 'performance', autoDetected: true },
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
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log(`  [${name}] pageerror ${e.message}`));
  await page.goto(BASE + '/_harness.html?intro=0&drift=0', { waitUntil: 'domcontentloaded', timeout: 240000 });
  await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded && window.__map.isStyleLoaded() && window.GFX,
    null, { timeout: 300000 });
  // The probe is a correctness hazard in a test (README): it would downgrade a
  // balanced load mid-measurement. Boot-time state is already decided by now.
  await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
  return { ctx, page };
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
for (const name of Object.keys(SCENARIOS)) {
  const t0 = Date.now();
  const { ctx, page } = await load(name);
  const snap = await page.evaluate(() => ({ ...window.GFX }));
  const ex = EXPECT[name];
  let drawn = null;
  if (ex.draws) {
    drawn = await downtown(page, BREAK && name === 'corrupt');
    if (name === 'clean') await page.screenshot({ path: path.join(OUT, 'clean-downtown.png') });
    if (name === 'corrupt') await page.screenshot({ path: path.join(OUT, `corrupt-downtown${BREAK ? '-broken' : ''}.png`) });
  }
  results[name] = { snap, drawn };
  report.scenarios[name] = { preset: snap.preset, autoDetected: snap.autoDetected, outerDensity: snap.outerDensity,
    renderDistance: snap.renderDistance, drawn, seconds: Math.round((Date.now() - t0) / 1000) };
  console.log(`  [${name}] ${JSON.stringify(report.scenarios[name])}`);
  await ctx.close();
}

const base = results.clean.drawn;
check('baseline draws the three downtown layers', LAYERS.every(l => base.counts[l] > 0) && base.towerPixels > 500,
  { counts: base.counts, towerPixels: base.towerPixels });
for (const [name, ex] of Object.entries(EXPECT)) {
  const { snap, drawn } = results[name];
  check(`${name}: preset ${ex.preset}, autoDetected ${ex.autoDetected}`,
    snap.preset === ex.preset && !!snap.autoDetected === ex.autoDetected, { preset: snap.preset, autoDetected: snap.autoDetected });
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
