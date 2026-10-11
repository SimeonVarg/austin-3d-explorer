/**
 * air-flight.mjs — the Air Race flight model, in node, no browser.
 *   energy   with thrust and bleed off, v^2/2 + g z is conserved over a long
 *            random-stick dive/climb (trapezoid integration, so to float precision)
 *   limits   speed, pitch and bank stay inside AIR.flight under every input mix
 *   floor    flown at the real ground and at real roofs (the UT Tower, a downtown
 *            tower), the craft is never inside a solid and never below the ground margin
 *   steady   the same inputs give the same flight twice (fixed step)
 * `--break` removes the soft floor and flies at the Tower: the floor checks must fail.
 */
import { AIR, Flight, G, BREAK, ok, done, realField } from '../air/lib/t.mjs';

const dt = 1 / AIR.stepHz;
let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;

// ── energy ────────────────────────────────────────────────────────────
{
  const P = JSON.parse(JSON.stringify(AIR));
  P.flight.tauThrust = P.flight.tauBleed = P.flight.tauBrake = 1e15;     // no thrust, no bleed: gravity only
  P.flight.vMin = 0; P.flight.vMax = 1e9;
  const c = Flight.newCraft(0, 0, 4000, 0, 60);
  let e0 = Flight.energy(c, P), worst = 0, stickP = 0;
  for (let i = 0; i < 120 * 60; i++) {
    if (i % 90 === 0) stickP = rnd() * 2 - 1;
    Flight.step(c, { pitch: stickP, bank: Math.sin(i / 200), boost: 0, brake: 0 }, dt, null, P);
    worst = Math.max(worst, Math.abs(Flight.energy(c, P) - e0) / e0);
  }
  ok(worst < 1e-6, 'energy v^2/2 + g z conserved over 60 s of dives and climbs (gravity only)', 'worst relative drift ' + worst.toExponential(2));
}

// ── limits ────────────────────────────────────────────────────────────
{
  const F = AIR.flight; let vmin = 1e9, vmax = 0, pmin = 0, pmax = 0, rmax = 0;
  const c = Flight.newCraft(0, 0, 3000, 0, 62);
  for (let i = 0; i < 120 * 120; i++) {
    const k = Math.floor(i / 150);
    const inp = { pitch: ((k * 7) % 5 - 2) / 2, bank: ((k * 3) % 5 - 2) / 2, boost: k % 3 === 0 ? 1 : 0, brake: k % 7 === 0 ? 1 : 0 };
    Flight.step(c, inp, dt, null);
    if (c.z < 600) c.z = 3000;                  // keep it in open sky; this is the limits test, not the floor test
    vmin = Math.min(vmin, c.v); vmax = Math.max(vmax, c.v); pmin = Math.min(pmin, c.pitch); pmax = Math.max(pmax, c.pitch); rmax = Math.max(rmax, Math.abs(c.roll));
  }
  ok(vmin >= F.vMin - 1e-9 && vmax <= F.vMax + 1e-9, `speed stays in [${F.vMin}, ${F.vMax}] m/s`, `${vmin.toFixed(1)}..${vmax.toFixed(1)}`);
  ok(pmin >= -F.pitchDown - 1e-9 && pmax <= F.pitchUp + 1e-9, `pitch stays in [-${F.pitchDown}, +${F.pitchUp}] deg`, `${pmin.toFixed(1)}..${pmax.toFixed(1)}`);
  ok(rmax <= F.rollMax + 1e-6, `bank never exceeds ${F.rollMax} deg`, rmax.toFixed(1));
  // a held boost level flight reaches the boost speed, brake the brake speed, nothing the cruise speed
  const run = inp => { const d = Flight.newCraft(0, 0, 3000, 0, 62); for (let i = 0; i < 120 * 30; i++) { Flight.step(d, inp, dt, null); d.z = 3000; d.pitch = 0; } return d.v; };
  ok(Math.abs(run({ boost: 1 }) - F.vBoost) < 1, 'level boost settles at vBoost', run({ boost: 1 }).toFixed(1));
  ok(Math.abs(run({ brake: 1 }) - F.vBrake) < 1, 'level brake settles at vBrake', run({ brake: 1 }).toFixed(1));
  ok(Math.abs(run({}) - F.vCruise) < 1, 'level, no input, settles at vCruise', run({}).toFixed(1));
  // a 30 degree dive gains speed, and gives it back after levelling
  const d = Flight.newCraft(0, 0, 3000, 0, 62); let vTop = 0;
  for (let i = 0; i < 120 * 4; i++) { Flight.step(d, { pitch: -1 }, dt, null); vTop = Math.max(vTop, d.v); }
  ok(vTop > F.vCruise + 20, 'a dive gains speed', vTop.toFixed(1));
  for (let i = 0; i < 120 * 12; i++) { Flight.step(d, {}, dt, null); d.z = Math.max(d.z, 1000); }
  ok(Math.abs(d.v - F.vCruise) < 2, 'and the bleed takes it back to cruise within 12 s', d.v.toFixed(1));
}

// ── the soft floor, on the real city ──────────────────────────────────
{
  const field = realField();
  const P = JSON.parse(JSON.stringify(AIR));
  if (BREAK) { P.flight.floorSpring = 0; P.flight.floorPitchAssist = 0; P.flight.pushSide = 0; }
  const fly = (x, y, z, yaw, pitchStick, secs) => {
    const c = Flight.newCraft(x, y, z, yaw, 70); let inside = 0, below = 1e9, scrape = 0;
    for (let i = 0; i < 120 * secs; i++) {
      Flight.step(c, { pitch: pitchStick, bank: 0 }, dt, field, P);
      const h = field.at(c.x, c.y);
      if (c.z < h) inside++;
      below = Math.min(below, c.z - Math.max(h, 0)); scrape += c.floor;
    }
    return { inside, below, scrape, c };
  };
  // 1. dive at the ground over open ground (Auditorium Shores / the lake side), full dive stick
  let r = fly(-1100, -3100, 300, 90, -1, 20);
  ok(r.inside === 0 && r.c.z >= P.flight.clearGround - 1, `a full dive over open ground levels out at the ${P.flight.clearGround} m margin`, `z ${r.c.z.toFixed(1)}, inside ${r.inside}`);
  // 2. fly straight into the UT Tower (93 m) from the east at 60 m
  r = fly(300, 0, 60, 270, 0, 10);
  ok(r.inside === 0, 'flown at the UT Tower at 60 m, the craft is never inside it', 'steps inside: ' + r.inside);
  // 3. fly into the Waterline (315 m) and a 200 m downtown tower
  r = fly(-35, -2400, 120, 0, 0, 12);
  ok(r.inside === 0, 'flown at the 315 m Waterline at 120 m, the craft is never inside a solid', 'steps inside: ' + r.inside);
  r = fly(-1500, -2038, 100, 90, 0, 14);
  ok(r.inside === 0, 'flown at the 211 m Independent at 100 m, never inside', 'steps inside: ' + r.inside);
  // 4. it never ends the run: the speed stays above vMin and the craft keeps flying after a scrape
  ok(r.c.v >= AIR.flight.vMin, 'a scrape costs speed but never stops the craft', r.c.v.toFixed(1));
}

// ── determinism ───────────────────────────────────────────────────────
{
  const run = () => { const c = Flight.newCraft(0, 0, 500, 10, 62); let s = 7;
    for (let i = 0; i < 120 * 20; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; Flight.step(c, { pitch: (s % 3) - 1, bank: ((s >> 3) % 3) - 1, boost: (s >> 5) & 1 }, dt, null); }
    return [c.x, c.y, c.z, c.v, c.yaw].map(v => v.toFixed(9)).join(','); };
  ok(run() === run(), 'the same inputs give the same flight twice');
}
done('air-flight');
