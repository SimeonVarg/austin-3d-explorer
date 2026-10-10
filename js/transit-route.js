/**
 * transit-route.js — walk + bus + walk between two points, and nothing else.
 *
 * No DOM, no map, no fetch, no storage, no globals. A caller (the apartment
 * finder, the walking pathfinder) hands it the baked transit slice
 * (data/transit-live.json, scripts/bake_transit_live.py) and two points, and it
 * answers: which bus, from which stop to which stop, with how much walking and
 * waiting, as a RANGE. scripts/verify/transit-route.mjs checks it in node with
 * hand-computed cases.
 *
 * WHY A RANGE. The same reason js/finder-core.js gives one: a single number
 * has no error bar. Every leg has a low and a high:
 *
 *   walk   metres x detour / brisk speed  ..  metres x detour / slow speed
 *          (or the caller's own walking-graph answer, through `opts.walkSec`)
 *   wait   scheduled: 0 (you timed the bus) .. one whole headway (you just
 *          missed it). Live: the feed's minutes for the first bus that even a
 *          slow walker reaches; walk + wait is then that number at both ends,
 *          and the range is only as wide as the walk at the far end.
 *   `lo` is always the brisk walker with good luck, `hi` the slow walker with
 *   bad luck, leg by leg, so the legs of an answer add up to its total.
 *   ride   the timetable's minutes between the two stops (`runMin`), both ends.
 *
 * WHAT IT SEARCHES. One agency, a slice of a few hundred stops: so it is a
 * plain search, not a timetable engine.
 *   direct     board at a stop near the start, ride one route in one direction,
 *              get off near the end.
 *   1 transfer ride A to a stop, walk at most `transferWalkM` to a stop of
 *              another route, ride B. The wait for B is 0 .. its headway
 *              (a live feed does not help here: nobody can say today when A
 *              will reach the transfer stop).
 * A route that does not run at `when` (before its first trip, after its last,
 * or a day it has no service) is left out, and counted in `skipped`.
 *
 * WHAT IT DOES NOT KNOW, AND SAYS SO IN ITS OUTPUT: a detour, a full bus, a
 * stop closed for works, whether the walk has stairs. `runMin` comes from one
 * mid-morning trip, so a rush-hour ride is longer than it says.
 *
 * THE SCHEDULE NEVER COMES HERE. The caller passes two coordinates. Nothing
 * in this file can send anything anywhere.
 */

export const ROUTE = {
  brisk: 1.4, slow: 1.1,       // m/s: the walking graph's two speeds (data/walk_graph.json `tune`)
  detour: 1.3,                 // straight line -> street distance (scripts/bake_finder_transit.py uses the same)
  maxWalkM: 800,               // the furthest stop we will send someone to, straight line
  transferWalkM: 250,          // the furthest walk between two buses
  minConnectS: 120,            // a transfer needs at least this long, even "timed"
  minRideStops: 1,             // do not board to ride less than this many stops
  keep: 3,                     // how many answers to return
  mPerDegLat: 111320,
};

const rad = Math.PI / 180;
/** Metres between two [lat, lon] points (flat earth: the slice is a few km). */
export function metres(a, b) {
  const kx = ROUTE.mPerDegLat * Math.cos(((a[0] + b[0]) / 2) * rad);
  return Math.hypot((a[0] - b[0]) * ROUTE.mPerDegLat, (a[1] - b[1]) * kx);
}

const hm = (s) => { const [h, m] = String(s).split(':').map(Number); return h * 60 + m; };

/** The service block of a direction for this day: weekday, `sat` or `sun`. null = no service that day. */
function serviceOf(dir, day) {
  if (day === 6) return dir.sat || null;
  if (day === 0) return dir.sun || null;
  return dir.first ? { first: dir.first, last: dir.last, headway: dir.headway } : null;
}

/** Minutes between buses at `minute` of the day (0..1440+; a trip after midnight is 24:xx). null = not running. */
export function headwayAt(dir, day, minute) {
  const s = serviceOf(dir, day);
  if (!s || !s.headway || !s.headway.length) return null;
  const first = hm(s.first), last = hm(s.last) + (hm(s.last) < first ? 1440 : 0);
  if (minute < first - 1e-9 || minute > last + 1e-9) return null;
  let h = s.headway[0][1];
  for (const [hour, mins] of s.headway) if (minute >= hour * 60) h = mins;
  return h;
}

/** Index the slice once: stop -> [routeDir, index] and a bucket grid for "stops near a point". Cached on it. */
export function prepare(slice) {
  if (slice.__route) return slice.__route;
  const dirs = [], at = new Map(), cell = 0.004, grid = new Map();
  for (const [rid, r] of Object.entries(slice.routes || {})) {
    for (const d of r.dirs || []) {
      const k = dirs.length;
      dirs.push({ rid, short: r.short || rid, name: r.name || '', color: r.color || null, d });
      d.stops.forEach((sid, i) => { if (!at.has(sid)) at.set(sid, []); at.get(sid).push([k, i]); });
    }
  }
  for (const [sid, s] of Object.entries(slice.stops || {})) {
    if (!at.has(sid)) continue;                                   // a stop no listed pattern serves
    const key = Math.floor(s[1] / cell) + ':' + Math.floor(s[2] / cell);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(sid);
  }
  const near = (p, maxM) => {
    const out = [], n = Math.ceil(maxM / (cell * ROUTE.mPerDegLat * 0.85)) + 1;
    const cy = Math.floor(p[0] / cell), cx = Math.floor(p[1] / cell);
    for (let y = cy - n; y <= cy + n; y++) for (let x = cx - n; x <= cx + n; x++) {
      for (const sid of grid.get(y + ':' + x) || []) {
        const s = slice.stops[sid], m = metres(p, [s[1], s[2]]);
        if (m <= maxM) out.push([sid, m]);
      }
    }
    return out.sort((a, b) => a[1] - b[1]);
  };
  return (slice.__route = { dirs, at, near });
}

/** The part of a direction's line between two of its stops, for drawing: [[lon, lat], ...]. */
export function shapeBetween(slice, dir, i, j) {
  const sh = dir.shape || [];
  const a = slice.stops[dir.stops[i]], b = slice.stops[dir.stops[j]];
  if (sh.length < 2 || !a || !b) return a && b ? [[a[2], a[1]], [b[2], b[1]]] : [];
  const nearest = (s, from) => {
    let best = from, bm = Infinity;
    for (let k = from; k < sh.length; k++) { const m = metres([s[1], s[2]], [sh[k][1], sh[k][0]]); if (m < bm) { bm = m; best = k; } }
    return best;
  };
  const ia = nearest(a, 0), ib = nearest(b, ia);
  return [[a[2], a[1]], ...sh.slice(ia, ib + 1), [b[2], b[1]]];
}

/**
 * The search. `from`, `to`: [lat, lon]. opts:
 *   when      {day: 0..6 (0 = Sunday), minute: minutes after midnight}, local time. Default: Wednesday 08:30.
 *   live      (stopId, routeId, dirNo) -> [minutes, ...] from now for the next buses at that stop, or null.
 *             Only used for the FIRST bus of an answer.
 *   walkSec   (a, b, metresStraight) -> [lo, hi] seconds, to use the walking graph instead of the straight line.
 *   transfers 0 or 1 (default 1).
 * Returns {options: [...], skipped: n, reason} with at most ROUTE.keep options, best first. An option:
 *   {lo, hi, mid (seconds), transfers, walkM, live: bool,
 *    legs: [{kind: 'walk'|'wait'|'bus', lo, hi, ...}]}
 */
export function plan(slice, from, to, opts = {}) {
  const P = prepare(slice), R = ROUTE;
  const when = opts.when || { day: 3, minute: 510 };
  const walk = (a, b, m) => (opts.walkSec && opts.walkSec(a, b, m)) || [m * R.detour / R.brisk, m * R.detour / R.slow];
  const pos = (sid) => [slice.stops[sid][1], slice.stops[sid][2]];
  const board = P.near(from, R.maxWalkM), alight = new Map(P.near(to, R.maxWalkM));
  if (!board.length || !alight.size) return { options: [], skipped: 0, reason: !board.length ? 'no stop near the start' : 'no stop near the end' };

  const found = [];
  let skipped = 0;
  const rideS = (d, i, j) => (d.runMin[j] - d.runMin[i]) * 60;
  /** The wait for the first bus: live when the feed has a bus we can still reach, else 0 .. headway. */
  const firstWait = (k, i, sid, walkTo) => {
    const { rid, d } = P.dirs[k];
    // `first`, `last` and `headway` are times at the FIRST listed stop; this stop sees the same bus runMin[i] later.
    const h = headwayAt(d, when.day, when.minute + walkTo[1] / 60 - d.runMin[i]);
    const feed = opts.live ? opts.live(sid, rid, d.dir) : null;
    if (feed && feed.length) {
      const m = feed.find((x) => x * 60 >= walkTo[1]);                // a bus even a slow walker reaches
      // lo and hi are the BRISK and the SLOW walker's numbers, so that legs add up: walk + wait is the bus's minutes for
      // both. (So here the brisk walker's wait is the longer one.)
      if (m !== undefined) return { lo: m * 60 - walkTo[0], hi: m * 60 - walkTo[1], live: true, inMin: m, headway: h };
    }
    if (h === null) return null;
    return { lo: 0, hi: h * 60, live: false, headway: h };
  };

  for (const [sid, mTo] of board) {
    const walkTo = walk(from, pos(sid), mTo);
    for (const [k, i] of P.at.get(sid)) {
      const A = P.dirs[k], d = A.d;
      const w = firstWait(k, i, sid, walkTo);
      if (!w) { skipped++; continue; }
      const base = [{ kind: 'walk', lo: walkTo[0], hi: walkTo[1], m: mTo, to: sid, toName: slice.stops[sid][0] },
                    { kind: 'wait', lo: w.lo, hi: w.hi, live: w.live, inMin: w.inMin, headway: w.headway, route: A.short, stop: sid }];
      for (let j = i + R.minRideStops; j < d.stops.length; j++) {
        const off = d.stops[j], ride = rideS(d, i, j);
        const busA = { kind: 'bus', lo: ride, hi: ride, route: A.short, routeId: A.rid, name: A.name, color: A.color, dir: d.dir, headsign: d.headsign,
                       board: sid, alight: off, boardName: slice.stops[sid][0], alightName: slice.stops[off][0], stops: j - i, k, i, j };
        if (alight.has(off)) {                                         // direct
          const wf = walk(pos(off), to, alight.get(off));
          found.push(finish([...base, busA, { kind: 'walk', lo: wf[0], hi: wf[1], m: alight.get(off), from: off, fromName: slice.stops[off][0] }], 0, w.live));
        }
        if ((opts.transfers ?? 1) < 1) continue;
        for (const [t, mx] of P.near(pos(off), R.transferWalkM)) {     // one transfer
          const wx = t === off ? [0, 0] : walk(pos(off), pos(t), mx);
          for (const [k2, i2] of P.at.get(t)) {
            const B = P.dirs[k2];
            if (B.rid === A.rid) continue;
            const reach = when.minute + (walkTo[1] + w.hi + ride + wx[1]) / 60;
            const h2 = headwayAt(B.d, when.day, reach - B.d.runMin[i2]);
            if (h2 === null) continue;
            for (let j2 = i2 + R.minRideStops; j2 < B.d.stops.length; j2++) {
              const off2 = B.d.stops[j2];
              if (!alight.has(off2)) continue;
              const ride2 = rideS(B.d, i2, j2), wf = walk(pos(off2), to, alight.get(off2));
              found.push(finish([...base, busA,
                { kind: 'walk', lo: wx[0], hi: wx[1], m: mx, from: off, to: t, transfer: true, toName: slice.stops[t][0] },
                { kind: 'wait', lo: R.minConnectS, hi: Math.max(R.minConnectS, h2 * 60), live: false, headway: h2, route: B.short, stop: t },
                { kind: 'bus', lo: ride2, hi: ride2, route: B.short, routeId: B.rid, name: B.name, color: B.color, dir: B.d.dir, headsign: B.d.headsign,
                  board: t, alight: off2, boardName: slice.stops[t][0], alightName: slice.stops[off2][0], stops: j2 - i2, k: k2, i: i2, j: j2 },
                { kind: 'walk', lo: wf[0], hi: wf[1], m: alight.get(off2), from: off2, fromName: slice.stops[off2][0] }], 1, w.live));
            }
          }
        }
      }
    }
  }
  // Best first; one answer per chain of routes (the best board and alight stops for it), and a transfer answer only
  // when it beats every direct one by more than its own uncertainty would explain away.
  found.sort((a, b) => a.mid - b.mid || a.walkM - b.walkM);
  const seen = new Set(), options = [];
  const bestDirect = found.find((o) => o.transfers === 0);
  for (const o of found) {
    const key = o.legs.filter((l) => l.kind === 'bus').map((l) => l.routeId + '/' + l.dir).join('>');
    if (seen.has(key)) continue;
    if (o.transfers && bestDirect && o.mid > bestDirect.mid - 120) continue;
    seen.add(key); options.push(o);
    if (options.length >= R.keep) break;
  }
  return { options, skipped, reason: options.length ? null : (skipped ? 'no bus is running at that time' : 'no bus links the two places') };
}

function finish(legs, transfers, live) {
  let lo = 0, hi = 0, walkM = 0;
  for (const l of legs) { lo += l.lo; hi += l.hi; if (l.kind === 'walk') walkM += l.m; }
  return { lo, hi, mid: (lo + hi) / 2, transfers, walkM, live: !!live, legs };
}

/** "12-19 min": whole minutes, never one number unless both ends round to the same minute. */
export function rangeText(lo, hi) {
  const a = Math.max(1, Math.round(lo / 60)), b = Math.max(a, Math.round(hi / 60));
  return a === b ? `${a} min` : `${a}-${b} min`;
}
