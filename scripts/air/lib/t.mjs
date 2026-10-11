/** t.mjs — a tiny assert harness for the Air Race node tests. `--break` runs the test against a deliberately broken input and EXPECTS to fail. */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { REPO } from './obstacles.mjs';
const require = createRequire(import.meta.url);
export const AIR = require('../../../js/air/params.js');
export const G = require('../../../js/air/geo.js');
export const Flight = require('../../../js/air/flight.js');
export const Race = require('../../../js/air/race.js');
export const Ghost = require('../../../js/air/ghost.js');
export const Sim = require('../../../js/air/sim.js');
export const Autopilot = require('../../../js/air/autopilot.js');
export const { HeightField } = require('../../../js/air/heights.js');
export const BREAK = process.argv.includes('--break');
export const readJSON = f => JSON.parse(fs.readFileSync(path.join(REPO, f), 'utf8'));
export function realField() {
  return new HeightField(readJSON('data/air/heights.json'), new Uint8Array(fs.readFileSync(path.join(REPO, 'data/air/heights.u8'))));
}
let failed = 0, passed = 0;
export function ok(cond, msg, detail) {
  if (cond) { passed++; console.log('  ok   ' + msg); }
  else { failed++; console.log('  FAIL ' + msg + (detail !== undefined ? '  [' + detail + ']' : '')); }
}
export function done(name) {
  console.log(`${name}: ${passed} passed, ${failed} failed${BREAK ? ' (--break: a failure is the expected result)' : ''}`);
  process.exit(failed ? 1 : 0);
}
