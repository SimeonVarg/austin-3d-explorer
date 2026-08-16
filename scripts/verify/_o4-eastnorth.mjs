/**
 * _o4-eastnorth.mjs — WHY does movement.mjs read east/north = 0.905?
 *
 * `movement.mjs` assertion 1 wants |east/north - 1| <= 0.04 and the o4 pass
 * measured 0.905 on a 97 %-CPU machine. Two hypotheses, and they are
 * distinguishable without touching the app:
 *
 *   RULER   the machine. The assertion already takes a median of three, so
 *           this is weaker than it looks, but it is what §144 recorded
 *           (`movement.mjs` swinging 11/14 -> 14/14 with the machine, this
 *           assertion named as the first to go).
 *   APP     the soft data fence. `controls.js` damps `vel.e`/`vel.n` inside
 *           FENCE_SOFT metres of the data edge, and movement.mjs's own header
 *           records the sibling case: "the diagonal legs ran into the soft data
 *           fence, which crushed vel.n — a stable-looking diagonal/cardinal of
 *           0.73 that was really the fence, not the input math." If the start
 *           pose is nearer the east edge than the north edge, EVERY east run is
 *           damped and the ratio is a property of the fence geometry, not of
 *           the movement code — and it would be stable, not noisy.
 *
 * The discriminator is to report, per run, BOTH
 *   - the eye displacement per second of sim time (what movement.mjs measures),
 *   - and the controller's own |vel| sampled every frame (what the movement
 *     code intends), plus the distance to each fence edge at the start.
 * If |vel| matches across headings but displacement does not, the loss is
 * downstream of the velocity — fence, collision or the metre->degree step.
 * If |vel| itself is lower eastbound, the damping is upstream.
 *
 * Everything runs INSIDE one page.evaluate per leg, so no CDP round trip can
 * land in the middle of a measurement. Headings are INTERLEAVED (N,E,N,E,...)
 * because the machine drifts across a run.
 *
 * Usage: VERIFY_URL=http://127.0.0.1:8512 node scripts/verify/_o4-eastnorth.mjs [reps]
 */
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';

const REPS = Number(process.argv[2]) || 4;

const browser = await launch(chromium, { maxMs: 1500000 });
const page = await browser.newPage({ viewport: { width: 800, height: 560 } });
const errs = [];
page.on('pageerror', e => errs.push(e.message));

await page.goto(`${BASE}/index.html?drift=0&intro=0`, { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
await page.evaluate(() => { try { window.cancelGraphicsAutoDetect(); } catch (e) {} });
await page.waitForFunction(() => window.__fly && window.__fly.indexed(), null, { timeout: 120000 })
  .catch(() => console.log('WARN: __fly.indexed() never true'));
await page.waitForTimeout(5000);

// The fence, and how far movement.mjs's own start pose is from each edge.
const geom = await page.evaluate(() => {
  const c = window.__fly.consts ? window.__fly.consts() : {};
  const M_LAT = 40030228.884 / 360;
  const lng = -97.7434, lat = 30.2857;
  const mx = M_LAT * Math.cos(lat * Math.PI / 180);
  // __fly.fence is a FUNCTION (controls.js:1802), not a snapshot.
  const f = (typeof window.__fly.fence === 'function') ? window.__fly.fence() : null;
  return {
    consts: Object.fromEntries(Object.entries(c).filter(([k]) => /FENCE|SPEED|TAU|MAX/i.test(k))),
    fence: f,
    toEdgeM: f ? {
      W: +((lng - f.w) * mx).toFixed(0), E: +((f.e - lng) * mx).toFixed(0),
      S: +((lat - f.s) * M_LAT).toFixed(0), N: +((f.n - lat) * M_LAT).toFixed(0),
    } : null,
  };
});
console.log('fence + constants at movement.mjs\'s own start pose (-97.7434, 30.2857):');
console.log(JSON.stringify(geom, null, 1));

/**
 * One leg, entirely in the page. Same shape as movement.mjs's speedOnce:
 * reset, 1.5 s of ramp, then measure over 2.5 s of sim time — but it also
 * samples |vel| every frame and records where the eye ended up relative to the
 * fence.
 */
async function leg(bearing) {
  return page.evaluate(async b => {
    const m = window.__map, F = window.__fly;
    const M_LAT = 40030228.884 / 360;
    const metres = (a, z) => Math.hypot((z.lat - a.lat) * M_LAT,
      (z.lng - a.lng) * M_LAT * Math.cos(a.lat * Math.PI / 180));
    // Wait the controller out, exactly as movement.mjs does — but with a
    // deadline, because movement.mjs's __reset polls forever.
    for (let i = 0; i < 200 && F.eye().driving; i++) await new Promise(r => setTimeout(r, 100));
    m.jumpTo({ center: [-97.7434, 30.2857], zoom: 16.5, pitch: 64, bearing: b });
    await new Promise(r => setTimeout(r, 500));

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }));
    // Ramp.
    const tRamp = F.simTime();
    while (F.simTime() - tRamp < 1.5) await new Promise(r => requestAnimationFrame(r));

    const e0 = F.eye(), t0 = F.simTime();
    let vSum = 0, vN = 0, vMax = 0, vMin = Infinity, frames = 0;
    while (F.simTime() - t0 < 2.5) {
      await new Promise(r => requestAnimationFrame(r));
      const e = F.eye(), v = Math.hypot(e.vE, e.vN);
      vSum += v; vN++; frames++;
      if (v > vMax) vMax = v;
      if (v < vMin) vMin = v;
    }
    const e1 = F.eye(), t1 = F.simTime();
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', bubbles: true }));

    const dist = metres(e0, e1), dt = t1 - t0;
    return {
      bearing: b, frames, dtSim: +dt.toFixed(3),
      dispPerSec: +(dist / dt).toFixed(2),      // what movement.mjs asserts on
      velMean: +(vSum / vN).toFixed(2),          // what the controller intends
      velMax: +vMax.toFixed(2), velMin: +vMin.toFixed(2),
      endLng: +e1.lng.toFixed(5), endLat: +e1.lat.toFixed(5),
      lossPct: +(100 * (1 - (dist / dt) / (vSum / vN))).toFixed(2),
    };
  }, bearing);
}

const rows = [];
for (let r = 0; r < REPS; r++) {
  // Interleaved AND counterbalanced, per README.
  const order = r % 2 === 0 ? [0, 90] : [90, 0];
  for (const b of order) {
    const x = await leg(b);
    rows.push({ rep: r + 1, ...x });
    console.log(`rep ${r + 1}  bearing ${String(b).padStart(3)}  ` +
      `disp/s ${String(x.dispPerSec).padStart(6)}  |vel| mean ${String(x.velMean).padStart(6)}` +
      `  max ${String(x.velMax).padStart(6)}  min ${String(x.velMin).padStart(6)}` +
      `  frames ${String(x.frames).padStart(3)}  dtSim ${x.dtSim}  loss ${x.lossPct}%`);
  }
}

const med = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const pick = (b, k) => rows.filter(x => x.bearing === b).map(x => x[k]);
const nD = med(pick(0, 'dispPerSec')), eD = med(pick(90, 'dispPerSec'));
const nV = med(pick(0, 'velMean')), eV = med(pick(90, 'velMean'));

console.log('\n' + '-'.repeat(70));
console.log(`median displacement/s   north ${nD}   east ${eD}   east/north ${(eD / nD).toFixed(3)}`);
console.log(`median |vel| mean       north ${nV}   east ${eV}   east/north ${(eV / nV).toFixed(3)}`);
console.log(`spread disp/s           north ${Math.min(...pick(0, 'dispPerSec'))}-${Math.max(...pick(0, 'dispPerSec'))}` +
  `   east ${Math.min(...pick(90, 'dispPerSec'))}-${Math.max(...pick(90, 'dispPerSec'))}`);
console.log(`movement.mjs's bar: |east/north - 1| <= 0.04`);
console.log(`page errors: ${errs.length ? errs.slice(0, 3).join(' | ') : 'none'}`);
console.log('\nREAD IT LIKE THIS:');
console.log('  velocity ratio ~1.00 and displacement ratio < 1  -> the loss is DOWNSTREAM of vel');
console.log('     (fence damping, collision slide, or the metre->degree step).');
console.log('  both ratios low and STABLE across reps            -> a real directional asymmetry.');
console.log('  both ratios ~1.00 with a wide spread              -> the machine; the gate is the ruler.');
await browser.__done();
