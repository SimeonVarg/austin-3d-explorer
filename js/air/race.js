/**
 * race.js — gates, the clock, splits and penalties. Pure maths (no DOM), so
 * the node test (scripts/verify/air-race.mjs) drives the page's own logic.
 *
 * A gate is a vertical ring: centre (x, y, z), radius r, and an axis, the
 * compass bearing of the way you fly through it. You pass a gate by crossing
 * its plane going forward; where you cross decides it:
 *   - within r + hitSlack of the centre: a HIT.
 *   - outside that, but within missZone * r: a MISS (you flew past it).
 *   - outside that: not a crossing at all (a plane is infinite; the far side
 *     of town is not "passing the gate").
 * Gates are taken in order. Hitting gate j while gate i < j is unresolved
 * marks every unresolved gate before j as a MISS (you skipped it). The last
 * gate hit finishes the run. Each miss adds AIR.penaltyS to the time.
 *
 * Time is SIM time (steps / stepHz), never wall time, so a run is the same
 * on a 15 fps laptop and a 144 fps desktop.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./params.js'), require('./geo.js'));
  else root.AirRace = factory(root.AIR, root.AirGeo);
})(typeof self !== 'undefined' ? self : this, function (AIR, G) {
  'use strict';
  const RAD = G.RAD;

  /** courses.json -> gates in the local frame, with the axis as a unit vector. */
  function prepareGates(course) {
    return course.gates.map((g, i) => {
      const p = G.toLocal(g.lng, g.lat);
      const yaw = g.yaw, ax = Math.sin(yaw * RAD), ay = Math.cos(yaw * RAD);
      return { i, id: g.id || ('g' + i), name: g.name, x: p.x, y: p.y, z: g.alt, r: g.r, yaw, ax, ay, kind: g.kind || 'ring', note: g.note };
    });
  }

  class Race {
    constructor(gates, opts) {
      this.gates = gates;
      this.penaltyS = (opts && opts.penaltyS != null) ? opts.penaltyS : AIR.penaltyS;
      this.slack = (opts && opts.hitSlack != null) ? opts.hitSlack : AIR.gates.hitSlack;
      this.missZone = (opts && opts.missZone) || 3.0;
      this.reset();
    }
    reset() {
      this.next = 0; this.results = new Array(this.gates.length).fill(null);
      this.misses = 0; this.finished = false; this.finishTime = null; this.elapsed = 0;
    }
    /** Time including penalties so far, for the running clock. */
    clock(t) { return t + this.misses * this.penaltyS; }
    /**
     * Move the craft from p0 at time t0 to p1 at t1 (sim seconds since GO).
     * Returns the events this segment caused: {type:'hit'|'miss'|'finish', i, t, ...}.
     */
    segment(p0, p1, t0, t1) {
      const ev = [];
      if (this.finished) return ev;
      this.elapsed = t1;
      for (let j = this.next; j < this.gates.length; j++) {
        const g = this.gates[j];
        const s0 = (p0.x - g.x) * g.ax + (p0.y - g.y) * g.ay, s1 = (p1.x - g.x) * g.ax + (p1.y - g.y) * g.ay;
        if (!(s0 < 0 && s1 >= 0)) continue;
        const u = s1 === s0 ? 0 : -s0 / (s1 - s0);
        const qx = p0.x + (p1.x - p0.x) * u, qy = p0.y + (p1.y - p0.y) * u, qz = p0.z + (p1.z - p0.z) * u;
        const d = Math.hypot(qx - g.x, qy - g.y, qz - g.z);
        const t = t0 + u * (t1 - t0);
        const inside = d <= g.r + this.slack;
        if (!inside && !(j === this.next && d <= g.r * this.missZone)) continue;   // far side of town, not a crossing
        for (let k = this.next; k < j; k++) this._resolve(k, 'miss', t, null, 'skipped', ev);
        this._resolve(j, inside ? 'hit' : 'miss', t, d, inside ? null : 'outside', ev);
        this.next = j + 1;
        if (j === this.gates.length - 1) {
          this.finished = true; this.finishTime = t + this.misses * this.penaltyS;
          ev.push({ type: 'finish', t, time: this.finishTime, misses: this.misses });
        }
        break;     // one gate per segment; the next segment finds the next one
      }
      return ev;
    }
    _resolve(i, status, t, d, why, ev) {
      if (status === 'miss') this.misses++;
      const split = t + this.misses * this.penaltyS;
      this.results[i] = { i, status, t, split, d, why };
      ev.push({ type: status, i, t, split, d, why });
    }
  }

  /** Run the gate logic over a path of {t,x,y,z} samples (sorted by t). Returns the Race. */
  function scorePath(gates, pts, opts) {
    const race = new Race(gates, opts);
    for (let k = 1; k < pts.length && !race.finished; k++) race.segment(pts[k - 1], pts[k], pts[k - 1].t, pts[k].t);
    return race;
  }
  const fmt = s => { if (s == null || !isFinite(s)) return '--.--'; const m = Math.floor(s / 60); const r = s - m * 60; return (m ? m + ':' : '') + (m && r < 10 ? '0' : '') + r.toFixed(2); };
  const fmtDelta = d => (d <= 0 ? '-' : '+') + Math.abs(d).toFixed(2);
  return { prepareGates, Race, scorePath, fmt, fmtDelta };
});
