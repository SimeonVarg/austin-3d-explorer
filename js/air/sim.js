/**
 * sim.js — the game's engine, with no DOM: a fixed-step loop that owns the
 * craft, the race and the recorder. The page (js/air/game.js) feeds it
 * frame times and sticks; the node tests and the house-ghost bake feed it an
 * autopilot. Same code, same numbers.
 *
 * States: ready -> countdown -> running -> finished. Time is sim time. The
 * craft is held still (at cruise speed, nose along the start heading) during
 * the countdown and released on GO.
 *
 * Recording: the position is sampled every stepHz/ghost.hz steps from GO,
 * exactly on the grid, and the craft is flown on for a few tenths of a second
 * after the finish so the last grid sample lies at or after the finish time.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./params.js'), require('./geo.js'), require('./flight.js'), require('./race.js'), require('./autopilot.js'));
  } else root.AirSim = factory(root.AIR, root.AirGeo, root.AirFlight, root.AirRace, root.AirAutopilot);
})(typeof self !== 'undefined' ? self : this, function (AIR, G, Flight, Race, Autopilot) {
  'use strict';

  class Game {
    /** course: courses.json; world: {maxHeight(x,y,r)} or null; P: parameter object (default AIR). */
    constructor(course, world, P) {
      this.P = P || AIR; this.course = course; this.world = world || null;
      this.gates = Race.prepareGates(course);
      const s = G.toLocal(course.start.lng, course.start.lat);
      this.start = { x: s.x, y: s.y, z: course.start.alt, yaw: course.start.yaw };
      this.h = 1 / this.P.stepHz; this.every = Math.round(this.P.stepHz / this.P.ghost.hz);
      this.ref = null;           // reference run for splits: {splits:[], time}
      this.events = [];
      this.reset();
    }
    reset() {
      const s = this.start;
      this.craft = Flight.newCraft(s.x, s.y, s.z, s.yaw, this.P.flight.vCruise);
      this.race = new Race.Race(this.gates, { penaltyS: this.P.penaltyS, hitSlack: this.P.gates.hitSlack });
      this.state = 'ready'; this.t = 0; this.cd = 0; this.steps = 0; this.accum = 0;
      this.rec = []; this.tail = 0; this.finishedAt = null; this.splits = []; this.events.length = 0;
    }
    startCountdown(seconds) { if (this.state === 'ready') { this.state = 'countdown'; this.cd = seconds == null ? this.P.countdownS : seconds; } }
    /** Total time to display: running clock with penalties. */
    clock() { return this.state === 'finished' ? this.race.finishTime : this.race.clock(this.t); }

    stepOnce(inp) {
      const c = this.craft, h = this.h;
      if (this.state === 'countdown') {
        this.cd -= h;
        if (this.cd <= 0) { this.state = 'running'; this.t = 0; this.steps = 0; this.rec.push({ x: c.x, y: c.y, z: c.z }); this.events.push({ type: 'go' }); }
        return;
      }
      if (this.state === 'ready') return;
      const p0 = { x: c.x, y: c.y, z: c.z };
      Flight.step(c, inp, h, this.world, this.P);
      this.steps++;
      const t0 = this.t; this.t = this.steps * h;
      if (this.state === 'running') {
        const ev = this.race.segment(p0, { x: c.x, y: c.y, z: c.z }, t0, this.t);
        for (const e of ev) {
          this.events.push(e);
          if (e.type === 'hit' || e.type === 'miss') this.splits[e.i] = { split: e.split, status: e.status };
          if (e.type === 'finish') { this.state = 'finishing'; this.finishedAt = e.t; }
        }
      }
      if (this.steps % this.every === 0 && (this.state === 'running' || (this.state === 'finishing' && (this.rec.length - 1) / this.P.ghost.hz < this.finishedAt - 1e-9))) {
        this.rec.push({ x: c.x, y: c.y, z: c.z });
      }
      if (this.state === 'finishing' && (this.rec.length - 1) / this.P.ghost.hz >= this.finishedAt - 1e-9) this.state = 'finished';
    }
    /** Advance by a frame's worth of real time; `inputFn()` is read once per sim step. Returns steps run. */
    advance(dtReal, inputFn) {
      this.accum += Math.min(dtReal, this.P.maxFrameS);
      let n = 0;
      while (this.accum >= this.h) { this.stepOnce(inputFn ? inputFn() : Flight.NO_INPUT); this.accum -= this.h; n++; if (this.state === 'finished' && n > 4000) break; }
      return n;
    }
    /** Samples at the ghost rate, ready for Ghost.encode. */
    samples() { return this.rec.slice(); }
  }

  /** Fly the whole course with the autopilot. Returns {game, time, misses, finished}. */
  function runAutopilot(course, world, opts) {
    opts = opts || {};
    const P = opts.P || AIR;
    const g = new Game(course, world, P);
    const Pa = Object.assign({}, P, { autopilot: Object.assign({}, P.autopilot, { skill: opts.skill == null ? P.autopilot.skill : opts.skill }) });
    g.state = 'running'; g.t = 0;
    g.rec.push({ x: g.craft.x, y: g.craft.y, z: g.craft.z });
    const limit = (opts.maxS || 200) * P.stepHz;
    for (let i = 0; i < limit && g.state !== 'finished'; i++) {
      const next = g.race.next, inp = Autopilot.control(g.craft, g.gates, Math.min(next, g.gates.length - 1), Pa);
      g.stepOnce(inp);
      if (opts.onStep) opts.onStep(g, inp);
    }
    return { game: g, time: g.race.finishTime, misses: g.race.misses, finished: g.race.finished, results: g.race.results };
  }
  return { Game, runAutopilot };
});
