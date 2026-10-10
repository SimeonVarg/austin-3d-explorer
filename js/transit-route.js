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
 * or a day it has no service) is left out, and counted in `skipped`. So is a route
 * whose service data is malformed (an unreadable `first`, `last` or `headway`).
 * MIDNIGHT: 00:15 on Saturday is {day: 6, minute: 15} AND {day: 5, minute: 1455}; both
 * give the same answer. A time before a service day's first trip is also tried as the
 * previous day's service plus 1440 minutes (and the mirror for 1440 and over).
 * WALKING IS THE BASELINE: every result carries `walk: {lo, hi, m}`, the same walk
 * door to door by the same model, and a bus is offered only when its midpoint beats the
 * walk's by `ROUTE.busBeatsWalkS`. Two places closer than `ROUTE.sameSpotM` get no bus.
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
  busBeatsWalkS: 120,          // a bus is offered only when its midpoint is at least this much under the walk's midpoint
  transferGainS: 120,          // a transfer answer must beat the best direct one by this much
  sameSpotM: 10,               // two points closer than this are the same place: no bus
  mPerDegLat: 111320,
};

const rad = Math.PI / 180;
/** Metres between two [lat, lon] points (flat earth: the slice is a few km). */
export function metres(a, b) {
  const kx = ROUTE.mPerDegLat * Math.cos(((a[0] + b[0]) / 2) * rad);
  return Math.hypot((a[0] - b[0]) * ROUTE.mPerDegLat, (a[1] - b[1]) * kx);
}

/** "HH:MM" or "HH:MM:SS" (HH may pass 24) -> minutes. NaN for anything else: malformed data is never read as "always on". */
const hm = (s) => {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(s));
  return m ? +m[1] * 60 + +m[2] : NaN;
};

/** One service block, read once: {first, last, headway: [[minuteOfDay, minutes]]}; null when absent or malformed. */
function readBlock(b) {
  if (!b || !Array.isArray(b.headway) || !b.headway.length) return null;
  const first = hm(b.first); let last = hm(b.last);
  if (!Number.isFinite(first) || !Number.isFinite(last)) return null;
  if (last < first) last += 1440;
  const hw = [];
  for (const e of b.headway) {
    if (!Array.isArray(e) || !Number.isFinite(+e[0]) || !(+e[1] > 0)) return null;
    hw.push([+e[0] * 60, +e[1]]);
  }
  return { first, last, hw };
}
const BLOCKS = new WeakMap();
/** The service block of a direction for this day: weekday, `sat` or `sun`. null = no (readable) service that day. */
function serviceOf(dir, day) {
  let c = BLOCKS.get(dir);
  if (!c) BLOCKS.set(dir, c = { wk: readBlock(dir.first ? { first: dir.first, last: dir.last, headway: dir.headway } : null), sat: readBlock(dir.sat), sun: readBlock(dir.sun) });
  return day === 6 ? c.sat : day === 0 ? c.sun : c.wk;
}
function headwayOn(dir, day, minute) {
  const s = serviceOf(dir, day);
  if (!s) return null;
  if (minute < s.first - 1e-9 || minute > s.last + 1e-9) return null;
  let h = s.hw[0][1];
  for (const [from, mins] of s.hw) if (minute >= from) h = mins;
  return h;
}
/**
 * Minutes between buses at `minute` of the day (0..1440+; a trip after midnight is 24:xx). null = not running.
 * `minute` is the time at the direction's first listed stop. Outside the day's own hours it is tried as the neighbouring
 * service day: before the first trip (or negative) as yesterday's service + 1440, and 1440 or over as tomorrow's - 1440.
 */
export function headwayAt(dir, day, minute) {
  if (!dir || !Number.isFinite(minute)) return null;
  const d = ((Math.round(day) % 7) + 7) % 7;
  if (minute >= 0 && minute < 1440) {
    const h = headwayOn(dir, d, minute);
    return h !== null ? h : headwayOn(dir, (d + 6) % 7, minute + 1440);
  }
  if (minute < 0) return headwayOn(dir, (d + 6) % 7, minute + 1440);
  const h = headwayOn(dir, d, minute);
  return h !== null ? h : headwayOn(dir, (d + 1) % 7, minute - 1440);
}

/** Index the slice once: stop -> [routeDir, index], a bucket grid for "stops near a point", transfer neighbours. Cached per slice object (a WeakMap: the slice itself is not touched). */
const PREPARED = new WeakMap();
export function prepare(slice) {
  const cached = PREPARED.get(slice);
  if (cached) return cached;
  const dirs = [], at = new Map(), cell = 0.004, grid = new Map();
  for (const [rid, r] of Object.entries(slice.routes || {})) {
    for (const d of r.dirs || []) {
      const k = dirs.length;
      dirs.push({ rid, short: r.short || rid, name: r.name || '', color: r.color || null, d });
      (d.stops || []).forEach((sid, i) => { if (!at.has(sid)) at.set(sid, []); at.get(sid).push([k, i]); });
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
  // The stops within a transfer walk of a stop (itself first, at 0 m), worked out once per stop.
  const nbrCache = new Map();
  const nbr = (sid) => {
    const key = sid + '|' + ROUTE.transferWalkM;
    let a = nbrCache.get(key);
    if (!a) nbrCache.set(key, a = near([slice.stops[sid][1], slice.stops[sid][2]], ROUTE.transferWalkM));
    return a;
  };
  const prepared = { dirs, at, near, nbr };
  PREPARED.set(slice, prepared);
  return prepared;
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
 *   beatsWalkS how many seconds under the walk a bus's midpoint must be to be offered (default ROUTE.busBeatsWalkS).
 * Returns {options: [...], skipped: n, reason, walk: {lo, hi, m}} with at most ROUTE.keep options, best first.
 * `walk` is the whole trip on foot by the same walking model (seconds, straight-line metres); a bus is only in `options`
 * when its midpoint is better than the walk's by ROUTE.busBeatsWalkS. A missing or unreadable slice gives
 * {options: [], reason: 'no timetable'}; it never throws. An option:
 *   {lo, hi, mid (seconds), transfers, walkM, live: bool,
 *    legs: [{kind: 'walk'|'wait'|'bus', lo, hi, ...}]}
 */
export function plan(slice, from, to, opts = {}) {
  try {
    return search(slice, from, to, opts || {});
  } catch (e) {
    return { options: [], skipped: 0, reason: 'no timetable', error: String((e && e.message) || e) };
  }
}

const okPoint = (p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(+p[0]) && Number.isFinite(+p[1]);

function search(slice, from, to, opts) {
  if (!slice || typeof slice !== 'object' || !slice.stops || !slice.routes) return { options: [], skipped: 0, reason: 'no timetable' };
  if (!okPoint(from) || !okPoint(to)) return { options: [], skipped: 0, reason: 'no place given' };
  const P = prepare(slice), R = ROUTE;
  const when = opts.when || { day: 3, minute: 510 };
  const walk = (a, b, m) => (opts.walkSec && opts.walkSec(a, b, m)) || [m * R.detour / R.brisk, m * R.detour / R.slow];
  const pos = (sid) => [slice.stops[sid][1], slice.stops[sid][2]];

  // Walking the whole way, by the same model: the baseline every bus has to beat.
  const wm = metres(from, to), ww = walk(from, to, wm);
  const walkAll = { lo: ww[0], hi: ww[1], m: wm };
  if (wm < R.sameSpotM) return { options: [], skipped: 0, reason: 'you are already there', walk: walkAll };
  const limit = (walkAll.lo + walkAll.hi) / 2 - (Number.isFinite(opts.beatsWalkS) ? opts.beatsWalkS : R.busBeatsWalkS);     // a bus must have a midpoint under this

  const board = P.near(from, R.maxWalkM), alight = new Map(P.near(to, R.maxWalkM));
  if (!board.length || !alight.size) return { options: [], skipped: 0, reason: !board.length ? 'no stop near the start' : 'no stop near the end', walk: walkAll };

  // Where each direction meets the places near the end: dir index -> [[stop index, stop id], ...] in stop order.
  const alightAt = new Map();
  for (const [sid] of alight) for (const [k, j] of P.at.get(sid) || []) {
    let a = alightAt.get(k); if (!a) alightAt.set(k, a = []);
    a.push([j, sid]);
  }
  for (const a of alightAt.values()) a.sort((x, y) => x[0] - y[0]);

  let skipped = 0, seq = 0, beaten = false;
  const bestD = new Map(), bestX = new Map();     // chain of routes -> the best answer for it (direct, one transfer)
  let boundD = Infinity, boundX = Infinity, bestDirectMid = Infinity;
  const third = (m) => { const v = [...m.values()].map((e) => e.o.mid).sort((a, b) => a - b); return v.length >= R.keep ? v[R.keep - 1] : Infinity; };
  // Offer a finished answer for a chain: it replaces the chain's best only when it is better (mid, then less walking).
  const offer = (map, key, o) => {
    const e = map.get(key);
    if (e && (e.o.mid < o.mid || (e.o.mid === o.mid && e.o.walkM <= o.walkM))) return;
    map.set(key, { o, seq: e ? e.seq : seq++ });
    if (map === bestD) { boundD = third(bestD); bestDirectMid = Math.min(bestDirectMid, o.mid); } else boundX = third(bestX);
  };
  const wfMemo = new Map(), wxMemo = new Map();
  const endWalk = (sid) => { let w = wfMemo.get(sid); if (!w) wfMemo.set(sid, w = walk(pos(sid), to, alight.get(sid))); return w; };
  const xferWalk = (off, t, mx) => { if (t === off) return [0, 0]; const key = off + '>' + t; let w = wxMemo.get(key); if (!w) wxMemo.set(key, w = walk(pos(off), pos(t), mx)); return w; };
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
      const head0 = walkTo[0] + w.lo, head1 = walkTo[1] + w.hi;       // everything before the first bus is ridden
      if ((head0 + head1) / 2 >= limit) { beaten = true; continue; }   // already no better than walking before it even leaves
      const base = [{ kind: 'walk', lo: walkTo[0], hi: walkTo[1], m: mTo, to: sid, toName: slice.stops[sid][0] },
                    { kind: 'wait', lo: w.lo, hi: w.hi, live: w.live, inMin: w.inMin, headway: w.headway, route: A.short, stop: sid }];
      const busOf = (j, off, ride) => ({ kind: 'bus', lo: ride, hi: ride, route: A.short, routeId: A.rid, name: A.name, color: A.color, dir: d.dir, headsign: d.headsign,
                       board: sid, alight: off, boardName: slice.stops[sid][0], alightName: slice.stops[off][0], stops: j - i, k, i, j });
      const keyA = A.rid + '/' + d.dir;
      for (let j = i + R.minRideStops; j < d.stops.length; j++) {
        const off = d.stops[j], ride = rideS(d, i, j);
        if ((head0 + head1) / 2 + ride >= limit) { beaten = true; break; }   // rides only get longer down the line
        const mAl = alight.get(off);
        if (mAl !== undefined) {                                       // direct
          const wf = endWalk(off), lo = head0 + ride + wf[0], hi = head1 + ride + wf[1], mid = (lo + hi) / 2;
          if (mid < limit && mid <= boundD) {
            const o = finish([...base, busOf(j, off, ride), { kind: 'walk', lo: wf[0], hi: wf[1], m: mAl, from: off, fromName: slice.stops[off][0] }], 0, w.live);
            offer(bestD, keyA, o);
          } else if (mid >= limit) beaten = true;
        }
        if ((opts.transfers ?? 1) < 1) continue;
        for (const [t, mx] of P.nbr(off)) {                             // one transfer
          const wx = xferWalk(off, t, mx);
          for (const [k2, i2] of P.at.get(t)) {
            const alts = alightAt.get(k2);
            if (!alts) continue;                                        // this line never gets near the end
            const B = P.dirs[k2];
            if (B.rid === A.rid) continue;
            const reach = when.minute + (walkTo[1] + w.hi + ride + wx[1]) / 60;
            const h2 = headwayAt(B.d, when.day, reach - B.d.runMin[i2]);
            if (h2 === null) continue;
            const wait2 = Math.max(R.minConnectS, h2 * 60);
            for (const [j2, off2] of alts) {
              if (j2 < i2 + R.minRideStops) continue;
              const ride2 = rideS(B.d, i2, j2), wf = endWalk(off2);
              const lo = head0 + ride + wx[0] + R.minConnectS + ride2 + wf[0], hi = head1 + ride + wx[1] + wait2 + ride2 + wf[1], mid = (lo + hi) / 2;
              if (mid >= limit) { beaten = true; continue; }
              if (mid > boundX || mid > bestDirectMid - R.transferGainS) continue;     // cannot be one of the answers
              const o = finish([...base, busOf(j, off, ride),
                { kind: 'walk', lo: wx[0], hi: wx[1], m: mx, from: off, to: t, transfer: true, toName: slice.stops[t][0] },
                { kind: 'wait', lo: R.minConnectS, hi: wait2, live: false, headway: h2, route: B.short, stop: t },
                { kind: 'bus', lo: ride2, hi: ride2, route: B.short, routeId: B.rid, name: B.name, color: B.color, dir: B.d.dir, headsign: B.d.headsign,
                  board: t, alight: off2, boardName: slice.stops[t][0], alightName: slice.stops[off2][0], stops: j2 - i2, k: k2, i: i2, j: j2 },
                { kind: 'walk', lo: wf[0], hi: wf[1], m: alight.get(off2), from: off2, fromName: slice.stops[off2][0] }], 1, w.live);
              offer(bestX, keyA + '>' + B.rid + '/' + B.d.dir, o);
            }
          }
        }
      }
    }
  }
  // Best first; one answer per chain of routes (the best board and alight stops for it), and a transfer answer only
  // when it beats the best direct one by more than its own uncertainty would explain away.
  const all = [...bestD.values(), ...bestX.values()].sort((a, b) => a.o.mid - b.o.mid || a.o.walkM - b.o.walkM || a.seq - b.seq).map((e) => e.o);
  const bestDirect = all.find((o) => o.transfers === 0);
  const options = [];
  for (const o of all) {
    if (o.transfers && bestDirect && o.mid > bestDirect.mid - R.transferGainS) continue;
    options.push(o);
    if (options.length >= R.keep) break;
  }
  const reason = options.length ? null : beaten ? 'walking is as fast as any bus' : skipped ? 'no bus is running at that time' : 'no bus links the two places';
  return { options, skipped, reason, walk: walkAll };
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
