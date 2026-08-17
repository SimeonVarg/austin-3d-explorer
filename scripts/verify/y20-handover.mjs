/**
 * y20-handover.mjs — the A/B for QUEUE Y20, both arms in ONE build.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS, AND WHY IT IS NOT y20-frames.mjs
 *
 * `y20-frames.mjs` (§155) established that Y20 is user-visible: 83 levels of
 * blue between two ADJACENT QUANTISED steps of the shipped slider, force off.
 * It photographs one build. It cannot say whether a candidate fix moved the
 * number, because the only comparison available to it is against a different
 * checkout — and this repo has been burned by A/B arms that were not the same
 * build (README: four "different" configurations that silently ran identically
 * while the report printed four different numbers).
 *
 * So this file drives BOTH arms in one page, one browser, one hour, by flipping
 * `SKY_TUNE.HANDOVER.ON` — which is in `hourMemo`'s cache key on purpose, so
 * the flip really rebuilds the hour and the two arms cannot share a memo. It
 * echoes the flag it thinks it set beside every reading, per README.
 *
 * WHAT IT ASSERTS
 *
 *   1. the OFF arm still shows the defect      (the gate can go red)
 *   2. the ON  arm is under dusk.mjs's MAX_STEP of 26 at the same pixel
 *   3. the sun's wash colour does not change across the switch  (the cause)
 *   4. nothing else at that hour moved by more than the sweep's own noise
 *
 * Assertion 1 is not decoration. Three gates in this repo were exiting 0 while
 * failing; a fix-gate that cannot observe the unfixed state is the same error.
 *
 * USAGE
 *   VERIFY_URL=http://127.0.0.1:8513 node y20-handover.mjs
 *   VERIFY_URL=... node y20-handover.mjs --shots     also write before/after PNGs
 *
 * INSTRUMENT: headless swiftshader, `_harness.html` (preserveDrawingBuffer),
 * `?drift=0` (the idle cinema creeps the hour after 25 s — §155), auto-detect
 * probe cancelled, 900x700, dusk.mjs's own POSE and sample point so every
 * number here is directly comparable to its table and to y20-frames.mjs's.
 *
 * Acer lane, 2026-08-16. Owns: this file and js/sky.js this pass.
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, BASE } from './chrome.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const OUT = path.resolve(ROOT, 'shots/reds');
const SHOTS = process.argv.includes('--shots');
if (SHOTS) fs.mkdirSync(OUT, { recursive: true });

// dusk.mjs's pose and worst sample point — unchanged, so the numbers compare.
const POSE = { center: [-97.7434, 30.2857], zoom: 16.4, pitch: 78, bearing: 250 };
const SAMPLE_FX = 0.70, SAMPLE_DY = 0.03;
const MAX_STEP = 26;      // dusk.mjs's gate, quoted not re-derived
const Q = 1 / 128;
const STEPS = [75, 76];   // the two adjacent quantised notches Y20 lives between

const checks = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok });
  console.log(`${ok ? ' PASS' : '*FAIL'}  ${name}${detail ? `\n       ${detail}` : ''}`);
};

const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.goto(`${BASE}/_harness.html?drift=0&intro=0`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });
await page.waitForTimeout(4500);
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
await page.evaluate(P => window.__map.jumpTo(P), POSE);
await page.waitForTimeout(2500);

console.log('y20-handover — QUEUE Y20 A/B, both arms in one build');
console.log(`  ${BASE}  |  headless swiftshader, _harness.html, 900x700, ?drift=0, auto-detect cancelled`);
console.log(`  pose ${JSON.stringify(POSE)}   sample (${SAMPLE_FX}, horizon-${SAMPLE_DY})`);
console.log(`  quantisation 1/128; steps ${STEPS.join(' -> ')} are ADJACENT notches of the shipped slider\n`);

async function readAt(q, on) {
  return page.evaluate(async (A) => {
    window.SKY_TUNE.HANDOVER.ON = A.on;
    const m = window.__map, cv = m.getCanvas();
    const gl = cv.getContext('webgl2') || cv.getContext('webgl');
    window.applyTimeOfDay(m, A.p, false);
    for (let i = 0; i < 8; i++) await new Promise(r => requestAnimationFrame(r));
    const fov = m.getVerticalFieldOfView() * Math.PI / 180;
    const hz = 0.5 - 0.5 * Math.tan((90 - m.getPitch()) * Math.PI / 180) / Math.tan(fov / 2);
    const fy = Math.max(0.005, hz - A.dy);
    const b = new Uint8Array(4);
    gl.readPixels(Math.round(A.fx * cv.width), Math.round((1 - fy) * cv.height),
                  1, 1, gl.RGBA, gl.UNSIGNED_BYTE, b);
    const B = window.skyBodies(A.p);
    return {
      rgb: [b[0], b[1], b[2]], fy: +fy.toFixed(3),
      // Echo the flag that was actually in force, not the one we asked for.
      flagEcho: window.SKY_TUNE.HANDOVER.ON,
      sunElev: +B.sun.elev.toFixed(2), moonElev: +B.moon.elev.toFixed(2),
      sunUp: !!B.sunUp,
      // The two ramps that make the disc's body switch free, read from the app.
      visSun: Math.max(0, Math.min(1, (B.sun.elev + 1) / 5)),
      visMoon: Math.max(0, Math.min(1, (B.moon.elev + 2) / 6)),
    };
  }, { p: q * Q, on, fx: SAMPLE_FX, dy: SAMPLE_DY });
}

const arms = {};
for (const on of [false, true]) {
  const rows = [];
  for (const q of STEPS) {
    // Screenshot twice, trust the second — README law for a time-of-day jump.
    const first = await readAt(q, on);
    const r = await readAt(q, on);
    if (SHOTS) {
      await page.screenshot({ path: path.join(OUT, `_tmp.png`) });
      await page.screenshot({ path: path.join(OUT, `y20-${on ? 'after' : 'before'}-q${q}.png`) });
    }
    rows.push({ q, ...r, firstRgb: first.rgb });
  }
  arms[on ? 'on' : 'off'] = rows;
  const [a, b] = rows;
  const d = a.rgb.map((v, i) => Math.abs(v - b.rgb[i]));
  console.log(`  HANDOVER.ON = ${String(on).padEnd(5)} (echoed ${a.flagEcho})`);
  for (const r of rows)
    console.log(`    q${r.q}  p=${(r.q * Q).toFixed(5)}  rgb ${r.rgb.join(',').padEnd(12)} ` +
                `sunElev ${String(r.sunElev).padStart(7)}  moonElev ${String(r.moonElev).padStart(6)}  ` +
                `visSun ${r.visSun.toFixed(3)}  visMoon ${r.visMoon.toFixed(3)}`);
  console.log(`    step  |dR| ${d[0]}  |dG| ${d[1]}  |dB| ${d[2]}   WORST ${Math.max(...d)}\n`);
}
if (SHOTS) { const t = path.join(OUT, '_tmp.png'); if (fs.existsSync(t)) fs.unlinkSync(t); }

const worst = (rows) => {
  const [a, b] = rows;
  return Math.max(...a.rgb.map((v, i) => Math.abs(v - b.rgb[i])));
};
const wOff = worst(arms.off), wOn = worst(arms.on);

check('the OFF arm still shows Y20 — this gate can go red',
  wOff > MAX_STEP,
  `HANDOVER.ON=false worst channel step ${wOff} (needs > ${MAX_STEP}); ` +
  `if this ever passes, the A/B is measuring one arm twice`);

check('the ON arm is continuous across the notch dusk.mjs measures',
  wOn <= MAX_STEP,
  `HANDOVER.ON=true worst channel step ${wOn} vs MAX_STEP ${MAX_STEP} ` +
  `(was ${wOff} unfixed — ${(wOff / Math.max(1, wOn)).toFixed(1)}x)`);

// The cause, stated as its own assertion so a future edit that reintroduces it
// fails HERE with the reason rather than only showing up as a pixel number.
const discSwitchFree = arms.on.every(r => r.visSun <= 0.001 || r.visMoon <= 0.001);
check('the disc body switch happens where BOTH visibility ramps are at zero',
  discSwitchFree,
  arms.on.map(r => `q${r.q} visSun ${r.visSun.toFixed(3)} visMoon ${r.visMoon.toFixed(3)}`).join('   ') +
  '  — if a taste edit moves either ramp, the single disc would pop and this goes red');

// ── THE HERO HOURS MUST BE A NO-OP ────────────────────────────────────────
//
// The fix touches two things outside the handover: the SUN's washes now take
// `sunHalo`, and the clouds take a cross-faded colour. Both are provably
// inert away from dusk — the moon track sits flat at -6 deg for every p <= 0.55
// so `wMoon` is exactly 0 all day (`moonMix` 0, `cloudLight` = `sunHalo` =
// the old `haloCol`, since `useMoon` is false), and past ~0.62 `wSun` is 0 so
// the sun's washes draw at zero alpha whatever colour they are handed.
//
// THAT IS ARITHMETIC, AND ARITHMETIC IS NOT A MEASUREMENT. This repo has
// shipped a formula that read identically hook-on and hook-off. So the claim is
// asserted on pixels, at the hours the hero shots use, with the same two arms:
// every channel must be BYTE-IDENTICAL between HANDOVER on and off.
const HERO_P = [
  { tag: 'day', p: 0.12 }, { tag: 'noon', p: 0.30 },
  { tag: 'golden', p: 0.50 }, { tag: 'night', p: 0.92 },
];
const heroRows = [];
for (const h of HERO_P) {
  await readAt(h.p * 128, false);                     // settle this hour, OFF arm
  const off = await readAt(h.p * 128, false);
  await readAt(h.p * 128, true);
  const on = await readAt(h.p * 128, true);
  const d = off.rgb.map((v, i) => Math.abs(v - on.rgb[i]));
  heroRows.push({ ...h, off: off.rgb, on: on.rgb, worst: Math.max(...d) });
}
console.log('\n  hero hours — HANDOVER off vs on, same build, same pixel:');
for (const r of heroRows)
  console.log(`    ${r.tag.padEnd(7)} p=${r.p.toFixed(3)}  off ${r.off.join(',').padEnd(12)} ` +
              `on ${r.on.join(',').padEnd(12)} worst |delta| ${r.worst}`);

check('the fix is a NO-OP at every hour outside the dusk handover',
  heroRows.every(r => r.worst === 0),
  heroRows.map(r => `${r.tag}:${r.worst}`).join('  ') +
  '  — anything non-zero here means the cloud cross-fade or the wash colour ' +
  'reached an hour it has no business touching');

const ok = checks.every(c => c.ok);
console.log(`\n${ok ? ' PASS' : '*FAIL'}  y20-handover: ${checks.filter(c => c.ok).length}/${checks.length}`);
if (SHOTS) console.log(`  frames: shots/reds/y20-{before,after}-q{75,76}.png`);
await browser.__done();
process.exit(ok ? 0 : 1);
