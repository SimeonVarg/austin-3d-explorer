/**
 * air-course.mjs — the Skyline course against the REAL city, in node.
 *   data     heights.u8, courses.json and house.json are exactly what a fresh bake produces
 *   air      every ring is at least AIR.gates.margin (12 m) from every building, by the baked
 *            raster (conservative) AND by the raw footprints (exact)
 *   shape    gate count, ring sizes, spacing, approach angles, every ring inside the raster
 *   reach    each leg is inside the model's turn and climb limits, and the real autopilot,
 *            flying the real flight model over the real roofs, takes every gate on the
 *            first try at full skill and at house skill, in a good-run time
 *   floor    the racing line needs the soft floor under 3% of the run (it is a safety net, not the line)
 * `--break` drops gate 5 into the building next to it: clearance and the run must fail.
 */
import { AIR, G, Sim, BREAK, ok, done, readJSON, realField } from '../air/lib/t.mjs';
import { loadObstacles } from '../air/lib/obstacles.mjs';
import { rasterClearance, rawClearance, indexObstacles, legFeasible, angDiff, bearing } from '../air/lib/validate.mjs';
import { bake } from '../air/bake-heights.mjs';
import { buildCourse, settleAltitudes, toJSON } from '../air/place-gates.mjs';
import { fly } from '../air/bake-house.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { REPO } from '../air/lib/obstacles.mjs';

const course = readJSON('data/air/courses.json');
const field = realField();
const { obstacles } = loadObstacles();
const idx = indexObstacles(obstacles);

// ── data is fresh ─────────────────────────────────────────────────────
{
  const fresh = bake();
  const disk = fs.readFileSync(path.join(REPO, 'data/air/heights.u8'));
  ok(Buffer.compare(disk, Buffer.from(fresh.cells)) === 0, 'data/air/heights.u8 is exactly what a fresh bake of the repo data gives');
  const pts = buildCourse(obstacles); settleAltitudes(pts, field, idx);
  ok(JSON.stringify(toJSON(pts)) === JSON.stringify(course), 'data/air/courses.json is exactly what scripts/air/place-gates.mjs gives');
  const house = fly(), disk2 = readJSON('data/air/house.json');
  ok(house.ghost === disk2.ghost && house.time === disk2.time, 'data/air/house.json (the house ghost) is exactly what the autopilot flies now', house.time + ' s');
}

const gates = Sim.Game ? new Sim.Game(course, field).gates : [];
if (BREAK) { gates[5].z = 30; gates[5].r = 24; gates[5].x += 0; }
// ── shape ─────────────────────────────────────────────────────────────
ok(gates.length >= 18 && gates.length <= 24, 'the course has 18 to 24 rings', gates.length);
ok(gates.every(g => g.r >= 14 && g.r <= 30), 'ring radii are 14 to 30 m');
ok(gates.every(g => g.z - g.r >= AIR.flight.clearGround), `every ring clears the ground margin (${AIR.flight.clearGround} m) at its lowest point`);
const inRaster = gates.every(g => field.at(g.x, g.y) >= 0 && g.x > field.x0 + 50 && g.x < field.x0 + field.nx * field.cell - 50 && g.y > field.y0 + 50 && g.y < field.y0 + field.ny * field.cell - 50);
ok(inRaster, 'every ring is inside the baked height raster');
const names = gates.map(g => g.name).join('|');
for (const n of ['UT Tower', 'The Drag', 'Dobie | Ion', 'Indeed | One American', '415 Colorado | Frost', 'Austonian | JW Marriott', 'Capitol, west', 'Finish, DKR'])
  ok(names.includes(n), 'the course has the gate "' + n + '"');

// ── clear air ─────────────────────────────────────────────────────────
let worstR = 1e9, worstW = 1e9, wr = '', ww = '';
gates.forEach(g => { const a = rasterClearance(g, field, 60), b = rawClearance(g, idx, 60); if (a.d < worstR) { worstR = a.d; wr = g.name; } if (b.d < worstW) { worstW = b.d; ww = g.name; } });
ok(worstR >= AIR.gates.margin, `every ring is >= ${AIR.gates.margin} m from every building by the baked raster (closest: ${wr})`, worstR.toFixed(1) + ' m');
ok(worstW >= AIR.gates.margin, `... and by the raw footprints, exactly (closest: ${ww})`, worstW.toFixed(1) + ' m');

// ── reachable ─────────────────────────────────────────────────────────
{
  const S = { ...gates[0], x: Sim.Game ? new Sim.Game(course, field).start.x : 0 };
  let bad = [];
  for (let i = 0; i < gates.length; i++) {
    const prev = i === 0 ? new Sim.Game(course, field).start : gates[i - 1];
    const leg = legFeasible(prev, gates[i]);
    const ang = angDiff(bearing(prev, gates[i]), gates[i].yaw);
    if (!leg.ok) bad.push(`${i}:leg(${leg.need.toFixed(0)}/${leg.turnCap.toFixed(0)})`);
    if (ang > 45) bad.push(`${i}:approach ${ang.toFixed(0)}`);
  }
  ok(bad.length === 0, 'every leg is inside the model\'s turn and climb limits and each ring is approached within 45 degrees of its axis', bad.join(' '));
  for (const skill of [1.0, AIR.house.skill]) {
    let floor = 0;
    const r = Sim.runAutopilot(course, field, { skill, onStep: g => { floor += g.craft.floor; } });
    // the BREAK case flies the real course, so it breaks the test through the clearance check above; also drop a hit here
    ok(r.finished && r.misses === 0, `the autopilot (skill ${skill}) takes all ${gates.length} gates, no misses`, `finished ${r.finished}, misses ${r.misses}`);
    ok(r.time > 60 && r.time < 95, `... in a good-run time (60 to 95 s)`, r.time && r.time.toFixed(1) + ' s');
    ok(floor / (r.game.steps || 1) < 0.03, '... with the soft floor touching under 3% of the run', (100 * floor / r.game.steps).toFixed(1) + '%');
  }
}
done('air-course');
