/**
 * air-race.mjs — gates, the clock, splits and penalties, in node.
 * Synthetic paths through a small made-up course: a clean run, a gate flown
 * past (outside the ring, penalty), a gate skipped (penalty), a backwards
 * crossing (ignored), the far side of town (ignored), the finish time with
 * penalties, and the running clock. `--break` expects a penalty of 3.0 s and
 * is given 0.
 */
import { AIR, Race, G, BREAK, ok, done } from '../air/lib/t.mjs';

const gate = (x, y, z, yaw, r = 20) => ({ i: 0, x, y, z, r, yaw, ax: Math.sin(yaw * G.RAD), ay: Math.cos(yaw * G.RAD) });
const gates = [gate(0, 100, 100, 0), gate(0, 300, 100, 0), gate(0, 500, 100, 0)];
const path = (dx, skip) => {            // fly north at 50 m/s, offset dx east at gate k (skip = a gate index to miss by 80 m)
  const pts = []; for (let t = 0; t <= 12; t += 0.02) pts.push({ t, x: 0, y: t * 50, z: 100 });
  return pts.map(p => ({ ...p, x: skip !== undefined && p.y > 100 * (2 * skip + 1) - 60 && p.y < 100 * (2 * skip + 1) + 60 ? dx : 0 }));
};
const P = BREAK ? { penaltyS: 0 } : { penaltyS: AIR.penaltyS };
const expectPenalty = AIR.penaltyS;                    // what the spec says: 3.0

{ // clean
  const r = Race.scorePath(gates, path(0), P);
  ok(r.finished && r.misses === 0, 'a clean run hits all three gates and finishes');
  ok(Math.abs(r.finishTime - 10) < 0.05, 'finish time = flight time (500 m at 50 m/s = 10 s)', r.finishTime && r.finishTime.toFixed(3));
  ok(r.results[0].t > 1.99 && r.results[0].t < 2.01, 'gate 0 split is at 100 m / 50 m/s = 2.0 s', r.results[0].t.toFixed(3));
}
{ // flown past gate 1 by 30 m (r 20): a miss, +penalty
  const r = Race.scorePath(gates, path(30, 1), P);
  ok(r.results[1] && r.results[1].status === 'miss', 'a gate crossed 30 m off a 20 m ring is a miss');
  ok(r.misses === 1 && Math.abs(r.finishTime - (10 + expectPenalty)) < 0.05, `the miss adds ${expectPenalty} s to the finish time`, r.finishTime && r.finishTime.toFixed(3));
  ok(Math.abs(r.results[1].split - (6 + expectPenalty)) < 0.05, 'the gate\'s own split already carries its penalty', r.results[1].split.toFixed(3));
  ok(r.results[2].status === 'hit', 'the next gate is still taken in order');
}
{ // hit within the slack (r + 2 m)
  const r = Race.scorePath(gates, path(21.5, 1), P);
  ok(r.results[1].status === 'hit', 'a crossing 21.5 m off a 20 m ring is a hit (2 m slack for the craft\'s size)');
}
{ // skip gate 1 entirely: fly around it, 300 m east of the course, then back
  const pts = []; for (let t = 0; t <= 12; t += 0.02) { const y = t * 50; pts.push({ t, x: (y > 150 && y < 450) ? 300 : 0, y, z: 100 }); }
  // that path crosses plane 1 (y=300) at x=300, 300 m off: not a crossing; gate 2 is hit (x=0): gate 1 is a skip
  const r = Race.scorePath(gates, pts, P);
  ok(r.results[1] && r.results[1].status === 'miss' && r.results[1].why === 'skipped', 'a gate flown around entirely is a skipped miss when the next gate is hit');
  ok(r.finished && Math.abs(r.finishTime - (10 + expectPenalty)) < 0.05, 'and costs the penalty', r.finishTime && r.finishTime.toFixed(3));
}
{ // a backwards crossing does not count
  const pts = []; for (let t = 0; t <= 6; t += 0.02) pts.push({ t, x: 0, y: 400 - t * 50, z: 100 });
  const r = Race.scorePath(gates, pts, P);
  ok(r.next === 0 && !r.finished, 'flying through gates backwards scores nothing');
}
{ // the far side of town: crossing a gate\'s plane 500 m from its ring is not "passing" it
  const pts = []; for (let t = 0; t <= 6; t += 0.02) pts.push({ t, x: -500, y: t * 50, z: 100 });
  const r = Race.scorePath(gates, pts, P);
  ok(r.next === 0 && r.misses === 0, 'crossing a gate\'s plane far from the ring is not a miss and not a pass');
}
{ // height matters: through the right x,y but 40 m above a 20 m ring is a miss
  const pts = []; for (let t = 0; t <= 12; t += 0.02) pts.push({ t, x: 0, y: t * 50, z: (t * 50 > 240 && t * 50 < 360) ? 145 : 100 });
  const r = Race.scorePath(gates, pts, P);
  ok(r.results[1].status === 'miss', 'a ring is a ring, not a column: 45 m over the centre misses');
}
{ // the running clock: elapsed + penalties so far
  const r = new Race.Race(gates, P); r.misses = 2;
  ok(Math.abs(r.clock(10) - (10 + 2 * expectPenalty)) < 1e-9, 'the running clock includes penalties so far', r.clock(10));
}
{ // formatting
  ok(Race.fmt(83.456) === '1:23.46' && Race.fmt(9.5) === '9.50' && Race.fmt(61.2) === '1:01.20', 'times format as m:ss.cc', [Race.fmt(83.456), Race.fmt(9.5), Race.fmt(61.2)].join(' '));
  ok(Race.fmtDelta(-0.4) === '-0.40' && Race.fmtDelta(1.234) === '+1.23', 'split deltas format with a sign');
}
done('air-race');
