/**
 * air-game.mjs — the engine's flow and the camera's maths, in node.
 *   flow    ready -> countdown (3 s, craft held) -> GO at t = 0 -> running -> finishing -> finished;
 *           a restart gives the same run; the clock never runs during the countdown
 *   record  the recorder holds a sample every 1/5 s from GO and ends at or after the finish time
 *   camera  the MapLibre pose the chase camera derives puts the camera exactly where the camera
 *           state says (altitude = distance x cos(pitch), centre on the ground ahead of the eye),
 *           within MapLibre's pitch and zoom limits, for a dive, a climb and a steep bank
 * `--break` skips the countdown hold (the craft flies during 3-2-1): the flow check must fail.
 */
import { AIR, Sim, G, BREAK, ok, done, readJSON, realField } from '../air/lib/t.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Cam = require('../../js/air/camera.js');

const course = readJSON('data/air/courses.json'), field = realField();
{
  const g = new Sim.Game(course, field);
  ok(g.state === 'ready', 'a new game is ready');
  g.startCountdown();
  const x0 = g.craft.x, y0 = g.craft.y, z0 = g.craft.z;
  let goAt = null, steps = 0;
  while (g.state === 'countdown' && steps < 120 * 10) { g.stepOnce(BREAK ? { pitch: 0, bank: 1 } : undefined); if (BREAK) { g.craft.x += 0.2; } steps++; }
  ok(Math.abs(steps / AIR.stepHz - AIR.countdownS) < 0.02, `the countdown lasts ${AIR.countdownS} s`, (steps / AIR.stepHz).toFixed(3));
  ok(g.craft.x === x0 && g.craft.y === y0 && g.craft.z === z0, 'the craft is held still during 3-2-1', `moved ${(g.craft.x - x0).toFixed(2)} m`);
  ok(g.state === 'running' && g.t === 0 && g.events.some(e => e.type === 'go'), 'GO: running, clock at zero, a go event');
  ok(g.clock() === 0, 'the clock reads zero at GO');
  // fly it with the autopilot to the finish
  const Autopilot = require('../../js/air/autopilot.js');
  let n = 0; while (g.state !== 'finished' && n++ < 120 * 200) g.stepOnce(Autopilot.control(g.craft, g.gates, Math.min(g.race.next, g.gates.length - 1), AIR));
  ok(g.state === 'finished' && g.race.finished, 'the run reaches finished');
  const smp = g.samples();
  ok((smp.length - 1) / AIR.ghost.hz >= g.race.finishTime - g.race.misses * AIR.penaltyS - 1e-6 && (smp.length - 2) / AIR.ghost.hz < g.finishedAt, 'the recording ends at the first grid sample at or after the finish', `${smp.length} samples, finish ${g.finishedAt.toFixed(2)} s`);
  ok(Math.abs(g.clock() - g.race.finishTime) < 1e-9, 'the finished clock is the finish time');
  // reset gives the same run
  const t1 = g.race.finishTime; g.reset(); g.startCountdown(); n = 0;
  while (g.state !== 'finished' && n++ < 120 * 210) g.stepOnce(g.state === 'countdown' ? undefined : Autopilot.control(g.craft, g.gates, Math.min(g.race.next, g.gates.length - 1), AIR));
  ok(g.race.finishTime === t1, 'a restart flies the identical run (deterministic sim)', `${g.race.finishTime} vs ${t1}`);
}

// camera
{
  const map = { getCanvas: () => ({ clientHeight: 900 }), getVerticalFieldOfView: () => 58 };
  const cam = Cam.create(map);
  const RAD = Math.PI / 180, C = 40030228.884;
  const cases = [
    { name: 'level cruise', c: { x: 0, y: 0, z: 120, yaw: 30, pitch: 0, roll: 0, v: 62 } },
    { name: 'steep dive', c: { x: 500, y: -900, z: 300, yaw: 200, pitch: -55, roll: 10, v: 125 } },
    { name: 'steep climb', c: { x: -300, y: 400, z: 60, yaw: 90, pitch: 44, roll: -20, v: 40 } },
    { name: 'hard bank', c: { x: 100, y: -2000, z: 150, yaw: 300, pitch: 5, roll: 62, v: 90 } },
  ];
  for (const k of cases) {
    cam.reset(); const e = cam.solve(k.c, 0.016); const p = cam.pose(e, 58);
    const camPx = 0.5 * 900 / Math.tan(29 * RAD), lat = p.center[1];
    const D = C * Math.cos(lat * RAD) * camPx / (512 * Math.pow(2, p.zoom));       // distance eye -> centre, metres
    const alt = D * Math.cos(p.pitch * RAD);
    const want = Math.max(e.ez, 2);
    const clamped = p.zoom <= 14.0001 || p.zoom >= 21.4999;
    ok(clamped || Math.abs(alt - want) < 0.05, `${k.name}: the derived pose puts the eye at ${want.toFixed(1)} m up (zoom ${p.zoom.toFixed(2)}, pitch ${p.pitch.toFixed(1)})`, `got ${alt.toFixed(2)}`);
    ok(p.pitch <= AIR.camera.maxPitchMap && p.pitch >= AIR.camera.pitchMin && p.zoom >= 14 && p.zoom <= 21.5, `${k.name}: pitch and zoom inside MapLibre's limits`, `pitch ${p.pitch.toFixed(1)} zoom ${p.zoom.toFixed(2)}`);
  }
  // the camera trails the craft: at cruise it is behind and above it, on the heading
  cam.reset(); const e = cam.solve(cases[0].c, 0.016);
  const back = (cases[0].c.x - e.ex) * Math.sin(30 * RAD) + (cases[0].c.y - e.ey) * Math.cos(30 * RAD);
  ok(Math.abs(back - AIR.camera.back) < 0.5 && e.ez > cases[0].c.z, `the chase camera sits ${AIR.camera.back} m behind and above the craft`, `${back.toFixed(1)} m back, ${(e.ez - cases[0].c.z).toFixed(1)} m up`);
}
done('air-game');
