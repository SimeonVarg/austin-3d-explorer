/**
 * air-ghost.mjs — the share link, in node. A real run (the autopilot on the
 * real course) and two stress paths are packed, decoded, and compared with the
 * true 120 Hz flight. States and proves:
 *   - every decoded sample is within quantM/2 per axis of the recorded one
 *   - the interpolated ghost stays within AIR.ghost.maxPathErrorM of the TRUE path at every sim step
 *   - a 90 s run is under AIR.ghost.maxLinkChars characters, URL-safe
 *   - truncated or foreign strings are rejected, not decoded into nonsense
 * `--break` mis-scales the decoded path by 1%: the error bounds must fail.
 */
import { AIR, Ghost, Sim, G, BREAK, ok, done, readJSON, realField } from '../air/lib/t.mjs';

const course = readJSON('data/air/courses.json'), field = realField();
const trace = [];
const run = Sim.runAutopilot(course, field, { skill: AIR.house.skill, onStep: g => trace.push([g.t, g.craft.x, g.craft.y, g.craft.z]) });
ok(run.finished, 'the autopilot finishes the real course (a real run to pack)', run.time);
const samples = run.game.samples();
const str = Ghost.encode(samples, { course: 1, time: run.time, misses: run.misses });
const dec = Ghost.decode(str);
if (BREAK) for (const p of dec.pts) { p.x *= 1.01; p.y *= 1.01; }      // a decoder that mis-scales the path by 1%

ok(/^[A-Za-z0-9_-]+$/.test(str), 'the link text is base64url (nothing to escape in a URL fragment)');
ok(str.length < AIR.ghost.maxLinkChars, `a ${run.time.toFixed(0)} s run packs to ${str.length} characters (limit ${AIR.ghost.maxLinkChars})`, str.length);
ok(dec.meta.n === samples.length && Math.abs(dec.meta.time - run.time) < 0.01 && dec.meta.misses === run.misses, 'header round-trips: sample count, time to 10 ms, misses');
let worstSample = 0; samples.forEach((s, k) => { const q = dec.pts[k]; worstSample = Math.max(worstSample, Math.abs(s.x - q.x), Math.abs(s.y - q.y), Math.abs(s.z - q.z)); });
ok(worstSample <= AIR.ghost.quantM / 2 + 1e-9, `every decoded sample is within ${AIR.ghost.quantM / 2} m per axis of the recorded one (closed-loop, no drift)`, worstSample.toFixed(3));
let worst = 0, tEnd = dec.pts[dec.pts.length - 1].t;
for (const [t, x, y, z] of trace) { if (t > tEnd) break; const p = Ghost.sampleAt(dec, t); worst = Math.max(worst, Math.hypot(p.x - x, p.y - y, p.z - z)); }
ok(worst <= AIR.ghost.maxPathErrorM, `the ghost path stays within ${AIR.ghost.maxPathErrorM} m of the true flight at every sim step`, worst.toFixed(2) + ' m');

// stress: wild stick (escapes in the nibble stream) must still round-trip
{
  const wild = []; let x = 0, y = 0, z = 400, vx = 40, vy = 40, vz = 0, s = 99;
  for (let k = 0; k < 600; k++) { s = (s * 1103515245 + 12345) & 0x7fffffff; vx += ((s % 200) - 100) * 0.4; vy += (((s >> 8) % 200) - 100) * 0.4; vz += (((s >> 16) % 100) - 50) * 0.2; x += vx / 5; y += vy / 5; z = Math.max(5, z + vz / 5); wild.push({ x, y, z }); }
  const w = Ghost.decode(Ghost.encode(wild, { course: 1, time: 120, misses: 0 }));
  let e = 0; wild.forEach((p, k) => { e = Math.max(e, Math.abs(p.x - w.pts[k].x), Math.abs(p.y - w.pts[k].y), Math.abs(p.z - w.pts[k].z)); });
  ok(e <= AIR.ghost.quantM / 2 + 1e-9, 'a violent 600-sample path (large residuals, escape codes) round-trips within the same bound', e.toFixed(3));
}
// robustness
let threw = 0; for (const bad of ['', 'AAAA', str.slice(0, 40), '!!!!', 'zzzzzzzzzzzzzzzzzzzzzzzz']) { try { Ghost.decode(bad); } catch (e) { threw++; } }
ok(threw === 5, 'empty, truncated, foreign and non-base64 strings are rejected', threw + ' of 5');
// off-grid: the ghost can be sampled at any time and flies forward
{ const a = Ghost.sampleAt(dec, 30.123), b = Ghost.sampleAt(dec, 30.223); ok(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) > 3 && Math.abs(a.speed - 70) < 60, 'sampling between samples gives a moving, plausible craft', a.speed.toFixed(1) + ' m/s'); }
done('air-ghost');
