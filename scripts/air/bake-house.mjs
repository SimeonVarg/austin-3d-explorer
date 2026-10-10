/**
 * bake-house.mjs — the HOUSE GHOST: the autopilot flies the course (at
 * AIR.house.skill) and the run is packed exactly like a player's, into
 * data/air/house.json. It is the time to beat when a link carries no ghost,
 * and the craft in the recorded clip's ghost lane.
 *
 *   node scripts/air/bake-house.mjs            write data/air/house.json
 *   node scripts/air/bake-house.mjs --check    fail if it is stale (courses, heights or AIR changed)
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { REPO } from './lib/obstacles.mjs';
const require = createRequire(import.meta.url);
const AIR = require('../../js/air/params.js');
const Sim = require('../../js/air/sim.js');
const Ghost = require('../../js/air/ghost.js');
const { HeightField } = require('../../js/air/heights.js');

export function fly() {
  const course = JSON.parse(fs.readFileSync(path.join(REPO, 'data/air/courses.json'), 'utf8'));
  const meta = JSON.parse(fs.readFileSync(path.join(REPO, 'data/air/heights.json'), 'utf8'));
  const field = new HeightField(meta, new Uint8Array(fs.readFileSync(path.join(REPO, 'data/air/heights.u8'))));
  const r = Sim.runAutopilot(course, field, { skill: AIR.house.skill });
  if (!r.finished) throw new Error('the autopilot did not finish the course');
  const ghost = Ghost.encode(r.game.samples(), { course: 1, time: r.time, misses: r.misses });
  return { course: course.id, time: +r.time.toFixed(2), misses: r.misses, hz: AIR.ghost.hz, samples: r.game.samples().length, chars: ghost.length, ghost };
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const house = fly(), file = path.join(REPO, 'data/air/house.json');
  if (process.argv.includes('--check')) {
    const disk = JSON.parse(fs.readFileSync(file, 'utf8'));
    const same = disk.ghost === house.ghost && disk.time === house.time;
    console.log(same ? 'house.json is fresh' : 'house.json is STALE: run node scripts/air/bake-house.mjs');
    process.exit(same ? 0 : 1);
  }
  fs.writeFileSync(file, JSON.stringify(house) + '\n');
  console.log(`house run ${house.time}s, ${house.misses} misses, ${house.samples} samples, link ${house.chars} chars`);
}
