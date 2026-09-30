/**
 * sky-roll.mjs — the sunset horizon glow must FOLLOW the camera bank.
 *
 * THE DEFECT. The flight controller banks the camera into a turn (up to
 * TUNE.BANK_MAX = 5 deg of MapLibre roll; js/controls.js) and MapLibre rolls
 * the whole world about the frame centre: the city, the ground and MapLibre's
 * own sky all tilt. js/sky.js's 2D horizon pass used to be drawn LEVEL, so at
 * sunset the orange wash stayed a flat strip while the real horizon leaned
 * under it: on the low side a band of plain blue sky opened between the orange
 * and the city, on the high side the orange ran down over the far city. Seen
 * on a phone as "a flat orange line during sunset with a blue gap underneath
 * that stays flat when the tilt goes left or right".
 *
 * THE FIX (SKY_TUNE.ROLL_FOLLOW, default true) rotates the whole sky pass
 * about the frame centre by the bank. This script flips that switch at
 * runtime, so "before" (false: the old level pass) and "after" come from ONE
 * page load, same pose, same hour.
 *
 * WHAT IT MEASURES, from screenshots (what a visitor sees, composited), at
 * phone (390x844, DPR 2, touch, iPhone UA: the phone graphics profile) and
 * desktop (1100x800), at sunset (p 0.50) and dusk (p 0.62), at roll -15 / -5
 * / 0 / +5 / +15, in columns at 5% / 50% / 95% of the width (which hour and
 * which rolls on which size: PLAN, below; `--full` runs them all):
 *
 *   (a) THE CITY HORIZON. One diagnostic frame per roll: our sky layer and the
 *       depth fog hidden, MapLibre's own sky painted pure magenta with every
 *       blend at 0. Every 2 px across the frame, the bottom of the magenta run
 *       from the top; a straight line fitted to the DEEPEST of those (points
 *       above the line are buildings and trees standing on the horizon, and
 *       are dropped until the fit is stable). That line is the real, rolled
 *       horizon, found in pixels and not predicted.
 *   (b) THE LOWER EDGE OF THE WASH. Two frames with the real sky: our sky layer
 *       drawn, and hidden. Their difference is OUR output and nothing else, so
 *       a fallback that happens to look warm cannot pass. At each column (a
 *       sub-column whose sky reaches the horizon line, so no tower stands in
 *       front) the edge is the first row, scanning up from the horizon, that
 *       our layer paints by at least EDGE_FRAC of the wash's strength REF_UP
 *       px above the horizon on the LEVEL camera.
 *
 *   1. horizon - edge at every column equals the same distance on the LEVEL
 *      camera, at the point of the level frame the bank moved that column to,
 *      within AGREE_PX. Relative because at roll 0 the wash is designed to fade
 *      out a little above the horizon (HORIZON_FADE is centred on it), so the
 *      raw distance is a design constant, not zero. What the bank must not do
 *      is change it: a level wash at roll 15 on the desktop frame is off by
 *      over 100 px at the low end.
 *   2. THE BLUE GAP: open sky between the edge and the horizon that our layer
 *      leaves under GAP_FRAC of that strength (MapLibre's plain sky showing
 *      through) must not exceed the level camera's by more than AGREE_PX.
 *   3. Roll 0 with ROLL_FOLLOW on equals ROLL_FOLLOW off within LUMA_EPS mean
 *      luma over the whole frame: the fix cannot have moved the level render.
 *   4. NO COLD BAND. At sunset, on the LEVEL camera, the sky in the clear rows
 *      just above the horizon must be WARM (red - blue >= WARM_MIN), not the
 *      cold blue-grey stripe production showed. The atmosphere study replaced
 *      the warm sunset horizon with a cool colour that leaked through where the
 *      wash feathers out; this asserts the sky just above the city stays warm,
 *      which is the owner's reported defect.
 *
 * The rolled "before" arm (the old level pass) is measured and printed with
 * `--before`, never asserted. `--break` runs the old level pass in the "after"
 * arm, and must exit 1.
 *
 * THE BANK IS FORCED the way shots/roll/ forced it: the controller heals roll
 * back to 0 on every idle frame (controls.js ~1615, `map.setRoll(0)`), so after
 * setting the roll `map.setRoll` is shadowed with a no-op to hold it.
 * updateSky runs on camera moves, not on every render, so after flipping the
 * switch the script calls it once itself.
 *
 *   VERIFY_URL=http://127.0.0.1:8442 node sky-roll.mjs [--break] [--full] [--before] [--shots DIR] [--size phone|desktop]
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BASE, launch } from './chrome.mjs';
import { decodePNG } from './lib/png.mjs';

// Optional --url=<origin> overrides VERIFY_URL/BASE for the run.
const urlArg = process.argv.find(a => a.startsWith('--url='));
const BASE_URL = urlArg ? urlArg.slice('--url='.length) : BASE;

const BREAK = process.argv.includes('--break');
const shotsAt = process.argv.indexOf('--shots');
const SHOTS = shotsAt > 0 ? process.argv[shotsAt + 1] : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const TMP = SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'sky-roll-'));

const TIMES = [{ name: 'sunset', p: 0.50 }, { name: 'dusk', p: 0.62 }];
// 5 is the controller's own ceiling; 15 is the shots/roll/ stress value.
// Symmetric, so a sign error shows as one side passing and the other failing.
const ROLLS = [-15, -5, 0, 5, 15];
const COLS = [0.05, 0.50, 0.95];
const AGREE_PX = 3;       // CSS px: edge-vs-horizon and blue-gap tolerance
const REF_UP = 40;        // CSS px above the horizon where the wash's strength is read
const WASH_MIN = 6;       // levels summed over RGB: under this there is no wash at the column
const EDGE_FRAC = 0.5;    // the lower edge: where our paint falls to half that strength
const GAP_FRAC = 0.25;    // open sky under a quarter of it is the blue gap
const WIN = 14;           // CSS px either side of a column to find a clear sub-column
const LUMA_EPS = 1.0;     // roll 0, switch on vs off
// ── THE COLD BAND (owner's sunset defect) ──
// At sunset the sky just above the horizon is the WARMEST part of the frame,
// not a cold blue-grey stripe. The band that showed on production was the
// atmosphere study's cool horizon (#abc0d1) leaking through where the warm
// wash feathers out. MEASURED, phone, sunset, level camera, the coolest of the
// three columns' near-horizon red-minus-blue:
//   production (main)  -18   (blue exceeds red at the frame edge: a cold band)
//   fixed (branch)     116   (warm everywhere)
// So 90 sits well clear of both: production fails by over 60, the fix passes by
// over 20. Sampled on the composited frame (what a visitor sees), in the clear
// sky rows just above the horizon.
const WARM_MIN = 90;      // min (red - blue) of the coolest near-horizon sunset column; below this is the cold band
const NEAR_HZ_LO = 6;     // CSS px above the horizon: bottom of the near-horizon sample
const NEAR_HZ_HI = 34;    // CSS px above the horizon: top of the sample (inside the feather zone)
const TOD_SETTLE_MS = 6000;   // lamps and window lights switch on after an hour change
const LOAD_WAIT_MS = 240000;  // cap on waiting for the tiles after the veil lifts
// Over campus looking west into the sunset, horizon inside the frame with room
// for a 15 deg tilt at both sizes, at a pitch the camera flies at.
const POSE = { center: [-97.7434, 30.2857], zoom: 16.2, pitch: 76, bearing: -110 };

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
// PHONE_DPR 2, not an iPhone's 3. js/sky.js draws its pass at
// min(2, devicePixelRatio) (resize()), so the canvas under test is the SAME at
// 2 and at 3, and a CSS-px / device-px mix-up in the bank still shows (the
// ratio is not 1). What 3 adds is 2.25x the MapLibre pixels to rasterise, and
// on a software renderer that was most of the phone half's time.
// The touch / small-screen phone profile does not read the ratio (js/mobile.js).
const PHONE_DPR = 2;
const SIZES = [
  { name: 'phone', ctx: { viewport: { width: 390, height: 844 }, deviceScaleFactor: PHONE_DPR, isMobile: true, hasTouch: true, userAgent: IPHONE_UA } },
  { name: 'desktop', ctx: { viewport: { width: 1100, height: 800 }, deviceScaleFactor: 1 } },
];
// WHICH CASES RUN. A software renderer draws this scene at one frame every
// 4-7 s, and every case is four screenshots, so the full grid (2 sizes x 2
// hours x 4 rolls) ran past CI's 30-minute ceiling. The default keeps, on EACH
// size, one roll of each sign and each magnitude, and gives each size its own
// hour, so across the run both hours, both signs, both magnitudes and both
// frame shapes are asserted:
//   - the old level pass is 17 px off at 5 deg and 45 px at 15 deg (tolerance
//     3), so any one banked case catches the original flat band;
//   - a sign error rotates the wash the wrong way and doubles the error, so
//     it fails at every banked case; one sign per magnitude still catches a
//     bug that only breaks one side (an abs() in the wrong place);
//   - 5 is the controller's own ceiling (a real turn), 15 the stress value;
//   - the bank's geometry in the pass (the rotation, the rows it needs) reads
//     the roll, the horizon and W x H, and the hour only sets colours and
//     strengths (js/sky.js drawSky), so size x hour cross-terms add frames
//     and no coverage.
// `--full` runs every roll at both hours on both sizes.
const FULL = process.argv.includes('--full');
const PLAN = FULL ? null : {
  phone: { times: ['sunset'], rolls: [-15, 5] },
  desktop: { times: ['dusk'], rolls: [-5, 15] },
};
const planFor = (S) => {
  const p = PLAN && PLAN[S.name];
  const rolls = p ? p.rolls : ROLLS.filter(r => r !== 0);
  return { times: p ? TIMES.filter(t => p.times.includes(t.name)) : TIMES,
           rolls, diagRolls: [...new Set([...rolls, 0])].sort((a, b) => a - b) };
};
// The rolled "before" arm (the old level pass) is printed, never asserted, and
// costs as many frames as the asserted arm. `--before` brings it back for a
// side-by-side; `--break` is what proves the checks can go red.
const BEFORE = process.argv.includes('--before');

// `--size phone` or `--size desktop` runs one size only, so a slow machine can
// split the run in two and each half finishes well inside its watchdog.
const sizeAt = process.argv.indexOf('--size');
const ONLY = sizeAt > 0 ? process.argv[sizeAt + 1] : null;
const RUN_SIZES = ONLY ? SIZES.filter(s => s.name === ONLY) : SIZES;
if (!RUN_SIZES.length) { console.error(`unknown --size ${ONLY}`); process.exit(2); }

// Elapsed wall clock on every step, so a slow runner's log says where the time went.
const T0 = Date.now();
const lap = (what) => console.log(`   [t ${((Date.now() - T0) / 1000).toFixed(1)} s] ${what}`);

const results = [];
// Printed the moment it is recorded, so a run the watchdog kills still leaves
// every verdict it reached on the console. The summary at the end repeats them.
const check = (name, pass, detail) => {
  results.push({ name, pass: !!pass, detail: String(detail) });
  console.log((pass ? ' PASS  ' : '*FAIL  ') + name + '\n         ' + String(detail));
};

// HARDWARE GL by default. Every assertion here is a tolerance (3 px, 1 luma)
// measured inside ONE page on ONE renderer, never an exact hex, so the
// determinism that makes SwiftShader the suite default buys nothing here. CI
// has no GPU, so there this IS SwiftShader: the default PLAN is sized for it
// (the full grid at DPR 3 ran past CI's 30-minute ceiling).
// VERIFY_GL=swiftshader still forces the software path.
// Watchdog: 20 minutes per size on hardware; override with VERIFY_MAX_MS.
const browser = await launch(chromium, {
  gl: process.env.VERIFY_GL || 'hardware',
  maxMs: Number(process.env.VERIFY_MAX_MS) || 1200000 * RUN_SIZES.length,
});

/** Wait for two real frames after a change, then a beat. */
async function settle(page) {
  await page.evaluate(() => new Promise(res => {
    const m = window.__map; let n = 0;
    const on = () => { if (++n >= 2) { m.off('render', on); res(); } else m.triggerRepaint(); };
    m.on('render', on); m.triggerRepaint();
    setTimeout(res, 20000);
  }));
  await page.waitForTimeout(250);
}

/**
 * Screenshot twice, trust the second; CSS-px resolution. Each capture waits
 * for a new frame (measured on SwiftShader: 8-19 s a capture even for a 4 px
 * clip, i.e. it is drawing, not encoding), so the second comes a full frame
 * after whatever the caller just changed (roll, layer visibility, the switch).
 * No settle between them: that was two more frames a shot. A stale capture
 * cannot pass here: an "off" frame equal to its "on" frame reads as no wash
 * (not measured, and a case with nothing measured fails), and a frame from the
 * previous roll puts the horizon in the wrong place.
 */
async function shoot(page, name) {
  const f = path.join(TMP, name + '.png');
  await page.screenshot({ path: f, scale: 'css' });
  await page.screenshot({ path: f, scale: 'css' });
  return decodePNG(f);
}

/** Sets and holds the roll. No settle: the next shoot() waits for it. */
async function setRoll(page, roll) {
  await page.evaluate((roll) => {
    const m = window.__map;
    if (m.__rollReal) m.setRoll = m.__rollReal;
    m.__rollReal = m.__rollReal || m.setRoll.bind(m);
    if (m.isEasing && m.isEasing()) m.stop();
    m.__rollReal(roll);
    m.setRoll = () => {};           // hold it against the idle self-heal
  }, roll);
}

const px = (img, x, y) => { const i = (y * img.width + x) * img.bpp; return [img.data[i], img.data[i + 1], img.data[i + 2]]; };
const isSky = (diag, x, y) => { const [r, g, b] = px(diag, x, y); return r > 190 && g < 90 && b > 190; };

/** Bottom of the magenta run from the top of column x (first non-sky row), or -1. */
function skyBottom(diag, x) {
  let low = -1, miss = 0;
  for (let y = 0; y < diag.height; y++) {
    if (isSky(diag, x, y)) { low = y; miss = 0; }
    else if (low >= 0 && ++miss > 3) break;
  }
  return low < 0 ? -1 : low + 1;
}

/** (a) The horizon line y = a + b*x: least squares on the deepest sky, re-fitted without what stands on it. */
function fitHorizon(diag) {
  let pts = [];
  for (let x = 0; x < diag.width; x += 2) { const y = skyBottom(diag, x); if (y > 0) pts.push([x, y]); }
  let a = 0, b = 0;
  for (let it = 0; it < 8 && pts.length > 10; it++) {
    const n = pts.length;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const [x, y] of pts) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
    b = (n * sxy - sx * sy) / (n * sxx - sx * sx); a = (sy - b * sx) / n;
    const keep = pts.filter(([x, y]) => y - (a + b * x) >= -1.5);   // above the line: a building
    if (keep.length === pts.length) break;
    pts = keep;
  }
  return { a, b, n: pts.length, at: (x) => a + b * x };
}

/** A sub-column near x whose sky reaches the horizon line (nothing standing in front). */
function clearColumn(diag, fit, x) {
  for (let d = 0; d <= WIN; d++) for (const xx of [x - d, x + d]) {
    if (xx < 0 || xx >= diag.width) continue;
    if (skyBottom(diag, xx) >= Math.round(fit.at(xx)) - 1) return xx;
  }
  return null;
}

/** Our layer's paint at (x, y): sky layer on minus off, summed over RGB. */
const ours = (on, off, x, y) => {
  if (y < 0) return 0;
  const a = px(on, x, y), b = px(off, x, y);
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
};

/** (b) At a clear column: the wash strength REF_UP above the horizon, the edge and the gap against strength S. */
function washAt(fr, x, S) {
  const hz = Math.round(fr.fit.at(x));
  let V = 0; for (let k = -2; k <= 2; k++) V += ours(fr.on, fr.off, x, hz - REF_UP + k) / 5;
  const s = S ?? V;
  if (s < WASH_MIN) return { x, hz, V, edge: null, gap: null, d: null, none: true };
  let edge = null;
  for (let y = hz - 1; y >= 0; y--) if (ours(fr.on, fr.off, x, y) >= EDGE_FRAC * s) { edge = y + 1; break; }
  if (edge == null) return { x, hz, V, edge: null, gap: null, d: null };
  let gap = 0;
  for (let y = edge; y < hz; y++) if (isSky(fr.diag, x, y) && ours(fr.on, fr.off, x, y) < GAP_FRAC * s) gap++;
  return { x, hz, V, edge, gap, d: hz - edge };
}

/**
 * THE COLD BAND. The warmth (red - blue) of the composited sky in the clear
 * rows just above the horizon at a column, averaged over NEAR_HZ_LO..NEAR_HZ_HI
 * px. This is what a visitor sees at sunset, not our layer alone: a cold band
 * is cold whether MapLibre or our wash painted it. Only counts rows the
 * diagnostic frame says are sky (no tower standing in front). Returns null if
 * the column has no clear near-horizon sky.
 */
function nearHorizonWarmth(on, diag, fit, x) {
  const hz = Math.round(fit.at(x));
  let sum = 0, n = 0;
  for (let dy = NEAR_HZ_LO; dy <= NEAR_HZ_HI; dy++) {
    const y = hz - dy; if (y < 0) continue;
    if (!isSky(diag, x, y)) continue;   // a building/tree stands here, not sky
    const c = px(on, x, y);
    sum += c[0] - c[2]; n++;
  }
  return n ? { warmth: sum / n, n } : null;
}

function meanLumaDiff(a, b) {
  let s = 0; const n = a.width * a.height;
  for (let i = 0; i < n; i++) {
    const j = i * a.bpp, k = i * b.bpp;
    s += Math.abs(0.2126 * (a.data[j] - b.data[k]) + 0.7152 * (a.data[j + 1] - b.data[k + 1]) + 0.0722 * (a.data[j + 2] - b.data[k + 2]));
  }
  return s / n;
}

async function runSize(S) {
  const page = await browser.newPage(S.ctx);
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(`${BASE_URL}/index.html?intro=0&drift=0`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded && window.__map.isStyleLoaded(), null, { timeout: 180000 });
  await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
  // Pose NOW, under the load veil, so the city loads its tiles and facades for
  // this view once, during the load, rather than loading the spawn view and
  // then this one (measured: the first frame after a post-veil jump took
  // 125-257 s on SwiftShader). Posed again below in case the reveal moves it.
  await page.evaluate((pose) => { const m = window.__map; if (m.isEasing && m.isEasing()) m.stop(); m.jumpTo(pose); }, POSE);
  await page.waitForFunction(() => !document.getElementById('veil'), null, { timeout: 300000 }).catch(() => {});
  const setup = await page.evaluate((pose) => {
    const m = window.__map;
    // The meter reads the previous frame; a sky-on / sky-off pair must not be
    // compared across two different gains.
    if (window.GFX) { window.GFX.autoExposure = false; window.applyGraphics && window.applyGraphics(); }
    // Only the map and the sky: the menus and the time slider sit over the
    // right-hand column on a phone. Place names would stand on the horizon.
    const st = document.createElement('style');
    st.textContent = 'body > *:not(#map):not(#sky) { visibility: hidden !important; }';
    document.head.appendChild(st);
    for (const l of m.getStyle().layers) if (l.type === 'symbol') m.setLayoutProperty(l.id, 'visibility', 'none');
    if (m.isEasing && m.isEasing()) m.stop();
    m.jumpTo(pose);
    return { roll: !!m.getRoll, lite: !!(window.LITE_PROFILE && window.LITE_PROFILE.on),
             preset: window.GFX && window.GFX.preset, skyLayer: !!m.getLayer('sky-overlay'),
             updateSky: typeof window.updateSky === 'function' };
  }, POSE);
  await page.waitForTimeout(3000);
  // Wait for the city to finish loading before the first measured frame: the
  // veil lifts while tiles are still arriving (measured on SwiftShader: done
  // about 50 s after the reveal), and a frame taken mid-load is a moving
  // target. MapLibre's own flags, polled, capped at LOAD_WAIT_MS.
  const loadedAt = await page.waitForFunction(() => { const m = window.__map; return m.loaded() && m.areTilesLoaded(); },
    null, { timeout: LOAD_WAIT_MS, polling: 1000 }).then(() => 'tiles loaded', () => 'still loading after the wait');
  await settle(page);
  lap(`[${S.name}] page loaded and posed (${loadedAt})`);
  const okSetup = setup.roll && setup.skyLayer && setup.updateSky;
  check(`[${S.name}] setup`, okSetup,
    `getRoll ${setup.roll}, sky layer ${setup.skyLayer}, updateSky ${setup.updateSky}, phone profile ${setup.lite}, preset ${setup.preset}`);
  if (!okSetup) { await page.close(); return; }

  const vis = (id, v) => page.evaluate(({ id, v }) => { const m = window.__map; if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', v); }, { id, v });
  const follow = (f) => page.evaluate((f) => { window.SKY_TUNE.ROLL_FOLLOW = f; window.updateSky(window.__map, window.__todCurrentP); }, f);
  const plan = planFor(S);
  console.log(`   [${S.name}] hours ${plan.times.map(t => t.name).join(', ')}; banked rolls ${plan.rolls.join(', ')}${FULL ? ' (--full)' : ''}`);

  // (a) The horizon per roll. Hour-independent: it is geometry. The diagnostic
  // sky goes on ONCE for every roll and comes off once, instead of on and off
  // around each roll: the roll is the only thing that differs.
  const diagBy = {};
  const skySaved = await page.evaluate(() => JSON.stringify(window.__map.getSky ? window.__map.getSky() : null));
  await vis('sky-overlay', 'none'); await vis('aerial-fog', 'none');
  // A BLOCK BODY, returning nothing. setSky returns the map, and an arrow that
  // returns it makes Playwright serialise the whole map object graph back to
  // Node (a probe that did so got the map back as a circular object). On
  // SwiftShader the step holding this call took 250-310 s on every size, a
  // third of the run; the same call with a block body takes under 50 ms.
  lap(`[${S.name}] diagnostic sky: our layers hidden`);
  await page.evaluate(() => { window.__map.setSky({
    'sky-color': '#ff00ff', 'horizon-color': '#ff00ff', 'fog-color': '#00ff00',
    'sky-horizon-blend': 0, 'horizon-fog-blend': 0, 'fog-ground-blend': 1, 'atmosphere-blend': 0,
  }); });
  lap(`[${S.name}] diagnostic sky on`);
  for (const roll of plan.diagRolls) {
    await setRoll(page, roll);
    const diag = await shoot(page, `${S.name}-diag-r${roll}`);
    lap(`[${S.name}] horizon frame, roll ${roll}`);
    const fit = fitHorizon(diag);
    diagBy[roll] = { diag, fit };
    const deg = -Math.atan(fit.b) * 180 / Math.PI;
    check(`[${S.name} roll ${roll > 0 ? '+' : ''}${roll}] city horizon found and tilted by the roll`,
      fit.n > 20 && Math.abs(deg - roll) < 0.5,
      `line through ${fit.n} sky points, tilt ${deg.toFixed(2)} deg (right end up is +), y at centre ${fit.at(diag.width / 2).toFixed(1)}`);
  }
  await page.evaluate((s) => { const v = JSON.parse(s); if (v) window.__map.setSky(v); }, skySaved);
  await vis('sky-overlay', 'visible'); await vis('aerial-fog', 'visible');

  // Each shoot() waits for the change before it; nothing settles twice.
  const frame = async (tag, roll) => {
    const on = await shoot(page, tag);
    await vis('sky-overlay', 'none');
    const off = await shoot(page, tag + '-skyoff');
    await vis('sky-overlay', 'visible');
    return { on, off, ...diagBy[roll] };
  };

  for (const t of plan.times) {
    await page.evaluate((p) => { window.applyTimeOfDay(window.__map, p, true); }, t.p);
    await page.waitForTimeout(TOD_SETTLE_MS);
    await settle(page);
    lap(`[${S.name} ${t.name}] hour set`);

    // The LEVEL camera: the reference every banked column is compared with.
    await setRoll(page, 0);
    await follow(false);
    const lvOff1 = await shoot(page, `${S.name}-${t.name}-r0-before`);
    await follow(true);
    const level = await frame(`${S.name}-${t.name}-r0-after`, 0);
    await follow(false);
    const lvOff2 = await shoot(page, `${S.name}-${t.name}-r0-before2`);
    // Two switch-off neighbours, so a scene still settling cannot pass for the switch.
    lap(`[${S.name} ${t.name}] level camera frames`);
    const dl = Math.min(meanLumaDiff(level.on, lvOff1), meanLumaDiff(level.on, lvOff2));
    check(`[${S.name} ${t.name} roll 0] switch on matches switch off`, dl <= LUMA_EPS,
      `mean |dLuma| over the frame ${dl.toFixed(3)} (tol ${LUMA_EPS})`);

    // THE COLD BAND (owner's defect), on the LEVEL camera. Only asserted at
    // the warm hour where the wash shows: at sunset the sky just above the
    // horizon must be WARM, not the cold blue-grey band production showed.
    // Sampled in the composited frame (what a visitor sees), in clear sky
    // columns, over the rows where the wash feathers toward the horizon.
    if (t.name === 'sunset') {
      let worstWarm = Infinity, warmParts = [], warmN = 0;
      for (const f of COLS) {
        const x = clearColumn(level.diag, level.fit, Math.round(f * (level.on.width - 1)));
        if (x == null) { warmParts.push(`${Math.round(f * 100)}%: no clear sky column`); continue; }
        const w = nearHorizonWarmth(level.on, level.diag, level.fit, x);
        if (!w) { warmParts.push(`${Math.round(f * 100)}%: no near-horizon sky`); continue; }
        warmN++;
        worstWarm = Math.min(worstWarm, w.warmth);
        warmParts.push(`${Math.round(f * 100)}%: x${x} red-blue ${w.warmth.toFixed(0)} over ${w.n} rows`);
      }
      check(`[${S.name} ${t.name} roll 0] no cold band above the horizon`,
        warmN > 0 && worstWarm >= WARM_MIN,
        `coolest near-horizon sky red-blue ${Number.isFinite(worstWarm) ? worstWarm.toFixed(0) : 'n/a'} (min ${WARM_MIN}) — ${warmParts.join(' | ')}`);
    }

    const W = level.on.width, H = level.on.height, hx = W / 2, hy = H / 2;
    for (const roll of plan.rolls) {
      await setRoll(page, roll);
      const arms = {};
      const ARMS = BEFORE ? ['before', 'after'] : ['after'];
      for (const arm of ARMS) {
        await follow(arm === 'after' && !BREAK);
        arms[arm] = await frame(`${S.name}-${t.name}-r${roll}-${arm}`, roll);
        lap(`[${S.name} ${t.name}] roll ${roll} ${arm} arm`);
      }
      const tag = `[${S.name} ${t.name} roll ${roll > 0 ? '+' : ''}${roll}]`;
      // The screen is the level frame rotated by -roll about the centre; take
      // each banked column's horizon point back into the level frame.
      const th = -roll * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
      for (const arm of ARMS) {
        const fr = arms[arm];
        let worstEdge = 0, worstGap = 0, measured = 0;
        const parts = [];
        for (const f of COLS) {
          const x = clearColumn(fr.diag, fr.fit, Math.round(f * (W - 1)));
          if (x == null) { parts.push(`${Math.round(f * 100)}%: no clear sky column`); worstEdge = Infinity; continue; }
          const dx = x - hx, dy = fr.fit.at(x) - hy;
          const x0 = clearColumn(level.diag, level.fit, Math.round(hx + c * dx + s * dy));
          const r0 = x0 == null ? null : washAt(level, x0);
          if (!r0 || r0.none || r0.edge == null) { parts.push(`${Math.round(f * 100)}%: no wash on the level camera here, not asserted`); continue; }
          const w = washAt(fr, x, r0.V);
          measured++;
          if (w.edge == null) { worstEdge = worstGap = Infinity; parts.push(`${Math.round(f * 100)}%: x${x} no wash edge (level x${x0} ${r0.d} px above)`); continue; }
          worstEdge = Math.max(worstEdge, Math.abs(w.d - r0.d));
          worstGap = Math.max(worstGap, w.gap - r0.gap);
          parts.push(`${Math.round(f * 100)}%: x${x} hz ${w.hz} edge ${w.d} px above, gap ${w.gap} (level x${x0}: ${r0.d} above, gap ${r0.gap})`);
        }
        const fmt = (v) => Number.isFinite(v) ? v.toFixed(0) : 'n/a';
        const detail = parts.join(' | ');
        if (arm === 'before') {
          console.log(`   ${tag} BEFORE (level pass): edge off by ${fmt(worstEdge)} px, extra gap ${fmt(worstGap)} px — ${detail}`);
          continue;
        }
        check(`${tag} wash edge sits on the horizon`, measured > 0 && worstEdge <= AGREE_PX,
          `worst ${fmt(worstEdge)} px off the level camera (tol ${AGREE_PX}) — ${detail}`);
        check(`${tag} no blue gap under the wash`, measured > 0 && worstGap <= AGREE_PX,
          `worst ${fmt(worstGap)} px more unpainted sky under the wash than the level camera (tol ${AGREE_PX})`);
      }
    }
  }
  await follow(true);
  check(`[${S.name}] no page errors`, errs.length === 0, errs.slice(0, 3).join(' | ') || 'none');
  await page.close();
}

try {
  for (const S of RUN_SIZES) await runSize(S);
} catch (e) {
  check('ran to completion', false, String(e && e.message).split(/\r?\n/)[0]);
}

console.log('\n── summary ──');
for (const r of results) console.log((r.pass ? ' PASS  ' : '*FAIL  ') + r.name + '\n         ' + r.detail);
const passed = results.filter(r => r.pass).length;
console.log(`\n${passed}/${results.length} passed${BREAK ? '  (--break: the level pass in both arms, must fail)' : ''}`);
if (!SHOTS) try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
await browser.close();
browser.__done();
process.exit(results.length && passed === results.length ? 0 : 1);
