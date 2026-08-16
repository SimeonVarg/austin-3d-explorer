/**
 * y20-frames.mjs — PHOTOGRAPH QUEUE Y20, and answer the question dusk.mjs
 * cannot: does a person ever see it?
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * `dusk.mjs` measures Y20 as **83 levels of blue in one step at p=0.595**, and
 * it gets there by sweeping p in 0.005 increments with `applyTimeOfDay(m, p,
 * true)` — `force: true`, which bypasses the app's own quantisation.
 *
 * That is the right instrument for LOCATING a discontinuity and the wrong one
 * for CLAIMING a user sees it. `js/sky.js` quantises the expensive path to
 * 1/128 = 0.0078125, and Y20's whole neighbourhood is narrower than one step:
 * 0.590 and 0.595 both round to 76/128 = 0.59375. A forced sweep can therefore
 * report a discontinuity that the shipped app never renders, and this repo has
 * shipped four guards that could not see what they guarded. A fifth that sees
 * something the user cannot would be the same error wearing the other shoe.
 *
 * So this file re-measures the same pixel across the two ADJACENT QUANTISED
 * STEPS a real slider actually produces — 75/128 -> 76/128 — with force OFF,
 * i.e. through the exact call `index.html`'s slider makes. If the step is still
 * there, Y20 is a defect a person can see and the frames prove it. If it
 * collapses, Y20 is an artefact of the instrument and must be restated.
 *
 * It writes both frames plus a difference-amplified pair to `shots/verify/`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY IT DOES NOT USE shot.mjs
 *
 * `shot.mjs` calls `window.applyTimeOfDay(m, s.p)` with NO force flag, so every
 * `p` in every shots file is silently rounded to the nearest 1/128 before it is
 * drawn. That is faithful to the app and it means shot.mjs is structurally
 * incapable of resolving any time-of-day transition narrower than 0.0078 —
 * including this one, where the two poses of interest are 0.005 apart and land
 * on the same rendered frame. This is not a bug in shot.mjs; it is a limit
 * nobody had written down, and it is why Y20 had numbers but no picture.
 *
 * USAGE
 *   VERIFY_URL=http://127.0.0.1:8443 node y20-frames.mjs
 *
 * INSTRUMENT: headless, swiftshader (pixel work, README), `_harness.html` for
 * preserveDrawingBuffer, auto-detect probe cancelled, 900x700, dusk.mjs's own
 * POSE and sample point so the numbers are comparable to its table.
 *
 * Written by the Acer lane, 2026-08-16 (§155). Owns: this file only. It asserts
 * nothing about js/sky.js beyond what it renders; the fix is another lane's.
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, BASE } from './chrome.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '../../shots/verify');
fs.mkdirSync(OUT, { recursive: true });

// dusk.mjs's pose and its worst sample point, so the two files can be read
// against each other without a change of coordinates.
const POSE = { center: [-97.7434, 30.2857], zoom: 16.4, pitch: 78, bearing: 250 };
const SAMPLE_FX = 0.70;   // the column dusk.mjs names: "point 12 at (0.7, 0.278)"
const SAMPLE_DY = 0.03;   // dusk.mjs's first dy ring; 0.278 = hz - 0.03 at pitch 78

const Q = 1 / 128;
const STEPS = [
  { tag: 'q75', p: 75 * Q, force: false, note: 'quantised step BEFORE the switch — what the app draws' },
  { tag: 'q76', p: 76 * Q, force: false, note: 'quantised step AFTER  the switch — what the app draws' },
  { tag: 'f590', p: 0.590, force: true, note: 'forced, dusk.mjs regime, before' },
  { tag: 'f595', p: 0.595, force: true, note: 'forced, dusk.mjs regime, after' },
];

const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.goto(`${BASE}/_harness.html?drift=0&intro=0`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });
await page.waitForTimeout(4500);
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

console.log('y20-frames — QUEUE Y20 photographed, and tested on the grid the app actually uses');
console.log(`  ${BASE}  |  headless swiftshader, _harness.html, 900x700, auto-detect cancelled`);
console.log(`  pose ${JSON.stringify(POSE)}`);
console.log(`  quantisation 1/128 = ${Q.toFixed(7)}; 0.590 and 0.595 BOTH round to ${(Math.round(0.59 / Q) * Q).toFixed(5)}\n`);

await page.evaluate(P => window.__map.jumpTo(P), POSE);
await page.waitForTimeout(2500);

const rows = [];
for (const s of STEPS) {
  const r = await page.evaluate(async (S) => {
    const m = window.__map, cv = m.getCanvas();
    const gl = cv.getContext('webgl2') || cv.getContext('webgl');
    const sl = document.getElementById('tod-slider'); if (sl) sl.value = String(S.p);
    window.applyTimeOfDay(m, S.p, S.force);
    for (let i = 0; i < 6; i++) await new Promise(res => requestAnimationFrame(res));
    const fov = m.getVerticalFieldOfView() * Math.PI / 180;
    const hz = 0.5 - 0.5 * Math.tan((90 - m.getPitch()) * Math.PI / 180) / Math.tan(fov / 2);
    const fy = Math.max(0.005, hz - S.dy);
    const b = new Uint8Array(4);
    gl.readPixels(Math.round(S.fx * cv.width), Math.round((1 - fy) * cv.height),
                  1, 1, gl.RGBA, gl.UNSIGNED_BYTE, b);
    const B = window.skyBodies(S.p);
    return { rgb: [b[0], b[1], b[2]], fy: +fy.toFixed(3),
             sunUp: !!B.sunUp, moonElev: +B.moon.elev.toFixed(2),
             sunElev: +B.sun.elev.toFixed(2), golden: +B.golden.toFixed(3) };
  }, { ...s, fx: SAMPLE_FX, dy: SAMPLE_DY });

  // Screenshot twice, trust the second — README law, and a time-of-day jump is
  // exactly the case it was written for.
  await page.screenshot({ path: path.join(OUT, `_throwaway-${s.tag}.png`) });
  const file = path.join(OUT, `y20-${s.tag}.png`);
  await page.screenshot({ path: file });
  rows.push({ ...s, ...r, file });
  console.log(`  ${s.tag.padEnd(5)} p=${s.p.toFixed(5)} force=${String(s.force).padEnd(5)} ` +
              `rgb ${r.rgb.join(',').padEnd(12)} sunUp=${String(r.sunUp).padEnd(5)} ` +
              `moonElev ${String(r.moonElev).padStart(6)}  golden ${r.golden}   ${s.note}`);
}

for (const f of fs.readdirSync(OUT)) if (f.startsWith('_throwaway-')) fs.unlinkSync(path.join(OUT, f));

const d = (a, b) => a.rgb.map((v, i) => Math.abs(v - b.rgb[i]));
const [q75, q76, f590, f595] = rows;
const dq = d(q75, q76), df = d(f590, f595);

console.log(`\n  sample point (${SAMPLE_FX}, ${q75.fy}) — dusk.mjs's worst point`);
console.log(`  FORCED     0.590 -> 0.595       per-channel |delta| R${df[0]} G${df[1]} B${df[2]}   worst ${Math.max(...df)}`);
console.log(`  QUANTISED  75/128 -> 76/128     per-channel |delta| R${dq[0]} G${dq[1]} B${dq[2]}   worst ${Math.max(...dq)}`);
console.log(`\n  frames: ${path.relative(path.resolve(HERE, '../..'), OUT).replace(/\\/g, '/')}/y20-{q75,q76,f590,f595}.png`);

const userVisible = Math.max(...dq);
if (userVisible >= 26) {
  console.log(`\n  VERDICT: Y20 IS USER-VISIBLE. One step of the shipped slider moves this pixel ` +
              `${userVisible} levels — past dusk.mjs's MAX_STEP gate of 26 without any forcing.`);
} else {
  console.log(`\n  VERDICT: on the quantised grid the step is only ${userVisible} levels. ` +
              `Y20 must be RESTATED as an instrument artefact before anyone is asked to fix it.`);
}
console.log(`  (No assertion. This file photographs and quantifies; the gate is dusk.mjs --strict.)`);

await browser.__done();
