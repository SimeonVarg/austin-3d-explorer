/**
 * finder-bus.js — the bus inside the apartment finder's RANKING and on its MAP, and nothing else.
 *
 * No DOM, no map, no fetch, no storage, no globals. js/finder.js hands it the baked transit slice
 * (data/transit-live.json), a home, the door of a class building and two walking answers it already has from the
 * walking graph, and gets back:
 *
 *   busLeg()       the timetable bus trip for ONE home and ONE class building, as a RANGE in minutes, or null when
 *                  walking is as good (a bus has to win by BUS.beatsWalkS). Not live: the ranking is a property of the
 *                  timetable, so it does not move when a bus runs late, and the same student gets the same list twice.
 *                  Live minutes belong to the one home that is selected (js/finder-live.js).
 *   busLegs()      the same for every home x building, with a cache and a per-call tally (how many searches, how long).
 *   tripFeatures() the trip drawn on the map: the walk to the stop, the bus along the route's real shape, the walk from
 *                  the stop to the door, and the board / change / alight stops. GeoJSON features, no map calls.
 *
 * WHY A TIMETABLE AND NOT NOW. A ranking that reshuffles with the clock cannot be compared with last week's, and a bus
 * that happens to be due this minute would lift one home over another for nothing. The ranking asks for a weekday
 * morning (BUS.when); the live feed only ever speaks for the selected home.
 *
 * WHY A MARGIN. js/finder-core.js explains the range; the margin is the other half. The walking model and the bus
 * model each carry minutes of error, so a bus that is "faster" by 40 seconds is not faster. A bus is offered only when
 * its midpoint beats the walk's by BUS.beatsWalkS, and a walk shorter than BUS.skipWalkMin is never searched (a bus
 * cannot win there, and skipping them is what keeps the ranking fast).
 *
 * THE SCHEDULE NEVER COMES HERE. A caller passes coordinates and two walking callbacks. This file has no network
 * code and imports only js/transit-route.js, which has none either (scripts/verify/finder-static.mjs reads both).
 */
import { plan, prepare, shapeBetween } from './transit-route.js';

export const BUS = {
  when: { day: 3, minute: 480 },  // the ranking's moment: Wednesday 08:00 in Austin
  beatsWalkS: 180,                // a bus must have a midpoint at least this much under the walk's
  // Measured on the real data, all 42 majors x 45 homes x their buildings (scripts/verify/finder-bus.mjs repeats it): the
  // shortest walk that a bus beat was 17.4 minutes, so 12 prunes safely, and allowing one change gave the SAME 818 bus
  // trips as direct-only at 2.7 times the cost. The live line for the selected home still allows a change.
  skipWalkMin: 12,                // a walk whose midpoint is under this many minutes is never searched for a bus
  transfers: 0,                   // 0 = direct buses only in the ranking, 1 = one change allowed
  budgetMs: 800,                  // the whole home list x every building of a big schedule, cold cache, quiet laptop (finder-bus.mjs fails above it)
  // The words a row and a stop marker carry live in js/finder.js (FINDER.copy.via, .trip*): one place for the copy.
};

const mins = (s) => s / 60;

const same = (a, b) => a === b || (a && b && a[0] === b[0] && a[1] === b[1]);

/**
 * The timetable trip for one home and one door, or null. `from`, `to`: [lat, lon]. ctx:
 *   walkAll  [lo, hi] seconds, the whole way on foot by the walking graph, or null (then the straight-line model is used)
 *   endWalk  (stopLatLon) -> [lo, hi] seconds, the walking graph from a stop to the door, or null for the straight-line model
 *   when     {day, minute}; default BUS.when
 * Returns {src: 'timetable', lo, hi, mid (minutes), option} or null. `option` is transit-route.js's own answer, legs and all.
 */
export function busLeg(slice, from, to, ctx = {}) {
  const walkAll = ctx.walkAll || null;
  if (walkAll && (walkAll[0] + walkAll[1]) / 120 < BUS.skipWalkMin) return null;
  const res = plan(slice, from, to, {
    when: ctx.when || BUS.when, transfers: BUS.transfers, beatsWalkS: BUS.beatsWalkS,
    walkSec: (a, b) => same(a, from) && same(b, to) ? walkAll : same(b, to) && ctx.endWalk ? ctx.endWalk(a) : null,
  });
  const o = res.options && res.options[0];
  if (!o) return null;
  return { src: 'timetable', lo: mins(o.lo), hi: mins(o.hi), mid: mins(o.mid), option: o };
}

/**
 * Every home x every building. `homes`: [{id, from: [lat, lon]}]; `targets`: [{code, to: [lat, lon]}];
 * `walkAll(homeIndex, targetIndex)` and `endWalk(targetIndex, stopLatLon)` are the finder's walking-graph answers.
 * `skip(homeIndex)` = true leaves a home alone (the four East Riverside homes keep their baked bus table).
 * `cache`: a Map kept by the caller; an answer is reused for the same home, door and baked slice.
 * Returns {legs: [homeIndex][targetIndex] -> busLeg | null, searches, cached, ms}.
 */
export function busLegs(slice, homes, targets, cb, cache, now = () => Date.now()) {
  const t0 = now(), legs = [];
  let searches = 0, cached = 0;
  prepare(slice);                                                   // the stop index, once, before the first timing
  homes.forEach((h, hi) => {
    const row = [];
    targets.forEach((t, ti) => {
      if (!t.to || (cb.skip && cb.skip(hi))) { row.push(null); return; }
      const key = h.id + '>' + t.code + '@' + t.to[0] + ',' + t.to[1];
      if (cache && cache.has(key)) { cached++; row.push(cache.get(key)); return; }
      searches++;
      const leg = busLeg(slice, h.from, t.to, { walkAll: cb.walkAll(hi, ti), endWalk: (p) => cb.endWalk(ti, p) });
      if (cache) cache.set(key, leg);
      row.push(leg);
    });
    legs.push(row);
  });
  return { legs, searches, cached, ms: now() - t0 };
}

// ══════════════════════════════════════════════════════════════════════════
// THE TRIP, DRAWN
// ══════════════════════════════════════════════════════════════════════════

/**
 * An answer of plan() as map features. `from`, `to`: [lat, lon] (the home, the door). Features carry `k`:
 *   'link' a straight walking connection (dashed on the finder's map: we did not map this walk)
 *   'walk' a walk along the walking graph's own path (opts.endPath supplies it for the last leg)
 *   'bus'  the bus along the route's real line (shapeBetween), `c` = the route's colour from the slice, `r` = its name
 *   'stop' a board / change / alight stop, `role` = 'board' | 'change' | 'alight', `c` = the route's colour
 * Coordinates are [lon, lat]. Returns {feats, stops, pts}: `stops` carry the words, `pts` every coordinate (to fit a camera).
 * opts.endPath([lon, lat] of the last stop) -> [[lon, lat], ...] from that stop to the door (core.treePath), or null.
 */
export function tripFeatures(slice, option, from, to, opts = {}) {
  const feats = [], stops = [], pts = [];
  if (!slice || !option || !Array.isArray(option.legs)) return { feats, stops, pts };
  const P = prepare(slice);
  const push = (props, coords) => {
    if (coords.length < 2) return;
    feats.push({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: coords } });
    pts.push(...coords);
  };
  const at = (sid) => { const s = slice.stops[sid]; return s ? [s[2], s[1]] : null; };
  let here = [from[1], from[0]];                                    // [lon, lat]
  const buses = option.legs.filter((l) => l.kind === 'bus');
  buses.forEach((leg, n) => {
    const board = at(leg.board), alight = at(leg.alight), dir = P.dirs[leg.k] && P.dirs[leg.k].d;
    if (!board || !alight || !dir) return;
    push({ k: 'link' }, [here, board]);                             // the walk (or the change) to this stop
    push({ k: 'bus', c: leg.color || null, r: leg.route }, shapeBetween(slice, dir, leg.i, leg.j));
    const first = n === 0;
    stops.push({ role: first ? 'board' : 'change', p: board, route: leg.route, name: leg.boardName, c: leg.color || null });
    if (n === buses.length - 1) stops.push({ role: 'alight', p: alight, route: leg.route, name: leg.alightName, c: leg.color || null });
    here = alight;
  });
  if (!buses.length) return { feats, stops, pts };
  const end = [to[1], to[0]], path = opts.endPath ? opts.endPath(here) : null;
  if (path && path.length >= 3) {                                   // the mapped path from the stop to the door
    push({ k: 'link' }, path.slice(0, 2));
    push({ k: 'walk' }, path.slice(1, -1));
    push({ k: 'link' }, path.slice(-2));
  } else push({ k: 'link' }, [here, end]);
  for (const s of stops) {
    feats.push({ type: 'Feature', properties: { k: 'stop', role: s.role, c: s.c, r: s.route }, geometry: { type: 'Point', coordinates: s.p } });
    pts.push(s.p);
  }
  return { feats, stops, pts };
}

/** The short names of the routes a trip rides: ['20', '801']. Empty for no trip. */
export function tripRoutes(option) {
  const out = [];
  for (const l of (option && option.legs) || []) if (l.kind === 'bus' && !out.includes(l.route)) out.push(l.route);
  return out;
}

/** A short string that changes when the trip's stops or routes change (not when only the minutes do): a redraw guard. */
export function tripSig(option) {
  return ((option && option.legs) || []).filter((l) => l.kind === 'bus').map((l) => l.routeId + '/' + l.dir + ':' + l.board + '>' + l.alight).join('|');
}
