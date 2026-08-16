/**
 * sunlight-probe.mjs — is `sky.mjs`'s red the APP or the INSTRUMENT?
 *
 * `sky.mjs` §2 asserts MapLibre's `setLight` points where `window.skyBodies(p)`
 * says the sun is. On 2026-08-16 it reported *FAIL twice — worst mismatch
 * 4.82 deg on one run and 0.92 deg on the next, against a 0.5 deg gate — on the
 * sky that had been rewritten hours earlier. A wandering magnitude is not what a
 * wrong formula looks like, so before anything is written into QUEUE about
 * `js/sky.js` the two candidate explanations get separated by measurement.
 *
 *   H1  THE APP IS WRONG. setLight genuinely disagrees with the shared bodies.
 *   H2  THE INSTRUMENT IS WRONG. sky.mjs calls `applyTimeOfDay(m, p)` with NO
 *       force flag, so the APP quantises p to the nearest 1/128 before it sets
 *       the light — and then the test asks `skyBodies(p)` at the UNQUANTISED p.
 *       That compares light(round(p)) against sun(p) and can only agree by
 *       luck. Half a step is ~0.0039 of a day of sun motion.
 *
 * The discriminator is one flag. Each row is measured three ways at the same p:
 *
 *   A  as sky.mjs does it      applyTimeOfDay(p)        vs skyBodies(p)
 *   B  quantised on both sides applyTimeOfDay(p)        vs skyBodies(round(p))
 *   C  forced on both sides    applyTimeOfDay(p, force) vs skyBodies(p)
 *
 * If B and C collapse to ~0 while A does not, H2 is proved and the finding is
 * against sky.mjs, not js/sky.js. If any of them stays large, H1 survives and
 * there is a real defect in the light path.
 *
 * This repo has shipped four guards that could not see what they guarded. The
 * mirror-image error — writing up an app defect that is really the ruler — is
 * how a lane wastes another lane's night, and §149's own night-silhouette.mjs
 * nearly did it. One flag settles it, so it gets settled.
 *
 * USAGE
 *   VERIFY_URL=http://127.0.0.1:8443 node sunlight-probe.mjs
 *
 * INSTRUMENT: headless swiftshader, index.html?intro=0 (no pixels are read),
 * auto-detect cancelled, 1.2 s settle per sample rather than sky.mjs's 200 ms
 * so a slow style update cannot be mistaken for a disagreement.
 *
 * Written by the Acer lane, 2026-08-16 (§155). Asserts nothing; it attributes.
 */
import { chromium } from 'playwright-core';
import { launch, BASE } from './chrome.mjs';

const PS = [0.0, 0.1, 0.25, 0.4, 0.5, 0.6, 0.8, 0.95];
const Q = 1 / 128;

const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.goto(`${BASE}/index.html?drift=0&intro=0`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });
await page.waitForTimeout(4000);
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());

const rows = await page.evaluate(async ({ PS, Q }) => {
  const m = window.__map;
  const dAz = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
  const out = [];
  const sample = async (p, force) => {
    window.applyTimeOfDay(m, p, force);
    await new Promise(r => setTimeout(r, 1200));
    const L = m.getLight();
    return { az: L.position[1], polar: L.position[2] };
  };
  for (const p of PS) {
    const pq = Math.round(p / Q) * Q;
    const unforced = await sample(p, false);
    const forced = await sample(p, true);
    const sunP = window.skyBodies(p).sun;
    const sunQ = window.skyBodies(pq).sun;
    out.push({
      p, pq: +pq.toFixed(5),
      A_az: +dAz(unforced.az, sunP.az).toFixed(2),
      A_el: +Math.abs((90 - unforced.polar) - sunP.elev).toFixed(2),
      B_az: +dAz(unforced.az, sunQ.az).toFixed(2),
      B_el: +Math.abs((90 - unforced.polar) - sunQ.elev).toFixed(2),
      C_az: +dAz(forced.az, sunP.az).toFixed(2),
      C_el: +Math.abs((90 - forced.polar) - sunP.elev).toFixed(2),
    });
  }
  return out;
}, { PS, Q });

console.log('sunlight-probe — sky.mjs §2: app defect, or the ruler?');
console.log(`  ${BASE}  |  headless swiftshader, index.html?intro=0, 1.2 s settle, auto-detect cancelled`);
console.log(`  gate under test: sky.mjs wants worst mismatch < 0.5 deg\n`);
console.log('     p        p->1/128     A az    A el  |    B az    B el  |    C az    C el');
console.log('                          (as sky.mjs)   |  (quantised both) | (forced both)');
for (const r of rows) {
  const f = (v) => String(v).padStart(7);
  console.log(`  ${String(r.p).padEnd(6)} ${String(r.pq).padEnd(10)} ${f(r.A_az)} ${f(r.A_el)}  |  ${f(r.B_az)} ${f(r.B_el)}  |  ${f(r.C_az)} ${f(r.C_el)}`);
}
const worst = k => Math.max(...rows.map(r => r[k]));
const A = Math.max(worst('A_az'), worst('A_el'));
const B = Math.max(worst('B_az'), worst('B_el'));
const C = Math.max(worst('C_az'), worst('C_el'));
console.log(`\n  worst mismatch   A (as sky.mjs) ${A.toFixed(2)} deg   B (quantised both) ${B.toFixed(2)} deg   C (forced both) ${C.toFixed(2)} deg`);
if (A >= 0.5 && B < 0.5 && C < 0.5) {
  console.log(`\n  ATTRIBUTION: THE INSTRUMENT. sky.mjs compares the light at a time the app`);
  console.log(`  ROUNDED to 1/128 against the sun at the time it ASKED for. Matching the two`);
  console.log(`  sides removes the whole disagreement. js/sky.js is not implicated by this.`);
} else if (C >= 0.5) {
  console.log(`\n  ATTRIBUTION: THE APP. With both sides on the same instant the light still`);
  console.log(`  disagrees with the shared bodies by ${C.toFixed(2)} deg. This is a real defect in the light path.`);
} else {
  console.log(`\n  ATTRIBUTION: MIXED / UNRESOLVED — A ${A.toFixed(2)}, B ${B.toFixed(2)}, C ${C.toFixed(2)}. Do not write a QUEUE entry off this run.`);
}

// ── TRACE. When A and B disagree with C, the question is no longer "what is the
// right answer" but "was setLight called at all, and with what". Wrap it and
// watch. This is the same move as instrumenting `map.updateImage` across a real
// slider drag, which is what finally settled the drag.js hook (js/drag.js:770):
// three flags said "hooked" while the call never happened.
console.log('\n-- trace: every map.setLight call during an unforced sequence -------------');
const trace = await page.evaluate(async () => {
  const m = window.__map;
  const log = [];
  const real = m.setLight.bind(m);
  m.setLight = function (o, ...rest) { log.push({ az: +o.position[1].toFixed(2), polar: +o.position[2].toFixed(2) }); return real(o, ...rest); };
  const out = [];
  for (const p of [0.0, 0.1, 0.25]) {
    log.length = 0;
    window.applyTimeOfDay(m, p, false);
    await new Promise(r => setTimeout(r, 1200));
    const L = m.getLight(), sun = window.skyBodies(p).sun;
    out.push({ p, calls: log.length, sent: log.map(l => l.az), lightAz: +L.position[1].toFixed(2),
               sunAz: +sun.az.toFixed(2), todCurrentP: window.__todCurrentP });
  }
  m.setLight = real;
  return out;
});
for (const t of trace) {
  console.log(`  p=${String(t.p).padEnd(5)} setLight called ${t.calls}x  sent az [${t.sent.join(', ')}]  ` +
              `getLight az ${t.lightAz}  skyBodies az ${t.sunAz}  __todCurrentP ${t.todCurrentP}`);
}
console.log('  A zero-call row means the 1/128 memo skipped the heavy pass and the light is STALE.');
console.log('  A called-but-different row means something else wrote the light after it.');

// ── WHO ELSE IS WRITING THE HOUR. The trace above shows a SECOND applyTimeOfDay
// landing ~1 s after ours with a different p. Wrap the function and keep the
// call stack of every caller that is not this probe.
console.log('\n-- who calls applyTimeOfDay when nobody touched the slider ----------------');
const callers = await page.evaluate(async () => {
  const m = window.__map;
  const prev = window.applyTimeOfDay;
  const seen = [];
  window.applyTimeOfDay = function (mm, p, force) {
    seen.push({ p, force: !!force, stack: (new Error().stack || '').split('\n').slice(1, 6).join(' | ') });
    return prev.apply(this, arguments);
  };
  window.applyTimeOfDay(m, 0.1, false);
  const mine = seen.length;
  await new Promise(r => setTimeout(r, 4000));
  window.applyTimeOfDay = prev;
  return { mine, all: seen };
});
console.log(`  our own call is #${callers.mine}; everything after it is somebody else:`);
for (let i = 0; i < callers.all.length; i++) {
  const c = callers.all[i];
  console.log(`  [${i}] p=${String(c.p).padEnd(8)} force=${String(c.force).padEnd(5)} ${i < callers.mine ? '(OURS)' : ''}`);
  if (i >= callers.mine) console.log(`        ${c.stack.replace(/https?:\/\/[^\s)]*\//g, '')}`);
}
if (callers.all.length === callers.mine) console.log('  nobody. The hour is written once and stays put on this run.');

await browser.__done();
