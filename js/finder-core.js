/**
 * finder-core.js — the apartment finder's arithmetic, and nothing else.
 *
 * No DOM, no map, no fetch, no storage, no globals. js/finder.js hands it the
 * decoded walking graph and the three static tables in data/finder/, and it
 * answers one question: how many minutes from each home to the buildings a
 * student's classes meet in, and in what order do the homes come out.
 * scripts/verify/finder-core.mjs checks it in node with hand-computed cases.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SCORE
 *
 *   targets   [{code, w}], weights summing to 1: the major's building weights
 *             (data/finder/major-buildings.json), or the student's own imported
 *             schedule, where a building's weight is how many times a week a
 *             class meets there. A code the walking graph has no door for is
 *             dropped and the rest renormalised — and the share dropped is
 *             reported, never hidden.
 *
 *   walk(h,b) the walking graph's own range, [lo, hi] seconds, off the path
 *             the router would take (js/walkgraph.js's cost model, read out of
 *             data/walk_graph.json `tune`): lo = brisk 1.4 m/s and every light
 *             green, hi = 1.1 m/s and every light red, stairs slower going up.
 *
 *   bus(h,b)  for each campus anchor stop a in data/finder/transit.json:
 *               lo = min − wait + walkLo(stop_a → b)   (you timed the bus)
 *               hi = min + wait + walkHi(stop_a → b)   (you just missed it)
 *             where min already contains half a headway of waiting; the anchor
 *             with the smallest midpoint wins.
 *
 *   per building, by mode: walk -> walk, bus -> bus, either -> whichever has
 *   the smaller midpoint. A home missing any building in a mode is not ranked
 *   in that mode (it is listed as unavailable, with the reason).
 *
 *   score(h) = [Σ w_b · lo_b, Σ w_b · hi_b]; ranked by the midpoint, then name.
 *
 * ONE TREE PER BUILDING, NOT ONE ROUTE PER PAIR. js/walkgraph.js answers
 * code→code with an early exit. The finder needs one building to EVERY home,
 * every campus stop and every ground cell of the heat overlay, so it runs the
 * same Dijkstra once per class building over the whole graph, from that
 * building's doors, and reads everything off the tree. Costs are symmetric
 * (walkgraph.js's header says why), so the tree from the building gives the
 * same optimum as a search from the home.
 *
 * Door links are costed ×linkCostMult (walkgraph's rule, so nobody routes
 * across a lawn) but are NOT counted as walking time — the same thing
 * walkgraph.js measures. A home with no mapped door is snapped to the nearest
 * main-component node within CORE.snapMaxM, and THAT link is counted as walking
 * time, because it is the walk out of the building to the path.
 */
import { WALKG, edgeCost, F_STEPS, F_SIGNAL, F_OFFMAIN } from './walkgraph.js';

export const CORE = {
  snapMaxM: 150,          // a home or stop further than this from a path is not walkable from
  countSnapLink: true,    // count the snap link from a home's centre as walking time
  bucketM: 100,           // spatial index cell for nearest-node lookups
  mPerDegLat: 111320,
};

const INF = Infinity;

// ══════════════════════════════════════════════════════════════════════════
// 1. GRAPH HELPERS
// ══════════════════════════════════════════════════════════════════════════

/** Which nodes sit on the main component, plus a bucket index for snapping.
 *  Built once per decoded graph and cached on it. */
export function prepareGraph(G) {
  if (G.finder) return G.finder;
  const main = new Uint8Array(G.N);
  for (let e = 0; e < G.E; e++) {
    if (G.F[e] & F_OFFMAIN) continue;
    main[G.A[e]] = 1; main[G.B[e]] = 1;
  }
  const lat0 = G.N ? G.Y[0] : 30.285;
  const kx = CORE.mPerDegLat * Math.cos(lat0 * Math.PI / 180), ky = CORE.mPerDegLat;
  const buckets = new Map();
  const key = (bx, by) => bx * 100003 + by;
  for (let i = 0; i < G.N; i++) {
    if (!main[i]) continue;
    const k = key(Math.floor(G.X[i] * kx / CORE.bucketM), Math.floor(G.Y[i] * ky / CORE.bucketM));
    let b = buckets.get(k); if (!b) buckets.set(k, b = []);
    b.push(i);
  }
  G.finder = { main, buckets, kx, ky, key, trees: new Map() };
  return G.finder;
}

/** Nearest main-component node to [lon, lat] within maxM, or null. */
export function nearestNode(G, p, maxM = CORE.snapMaxM) {
  const P = prepareGraph(G);
  const x = p[0] * P.kx, y = p[1] * P.ky;
  const bx = Math.floor(x / CORE.bucketM), by = Math.floor(y / CORE.bucketM);
  const r = Math.ceil(maxM / CORE.bucketM);
  let best = -1, bd = maxM;
  for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
    const b = P.buckets.get(P.key(bx + i, by + j));
    if (!b) continue;
    for (const n of b) {
      const d = Math.hypot(G.X[n] * P.kx - x, G.Y[n] * P.ky - y);
      if (d <= bd) { bd = d; best = n; }
    }
  }
  return best < 0 ? null : { node: best, m: bd };
}

/** Walking-time seconds of one edge: [lo, hi]. The same terms walkgraph.js
 *  measures off a path, spread per edge so they can be summed along a tree. */
function edgeSeconds(G, e) {
  const T = G.tune, m = G.W[e] / 100;
  let lo, hi;
  if (G.F[e] & F_STEPS) {
    const fixed = T.STAIR_FIXED_S / (G.swEdges.get(G.S[e]) || 1);
    lo = m / T.STAIR_SPEED_MPS + fixed;
    hi = (m * T.STAIR_UP_MULT) / T.STAIR_SPEED_MPS + fixed;
  } else {
    lo = m / T.WALK_SPEED_HIGH_MS;
    hi = m / T.WALK_SPEED_LOW_MS;
  }
  if (G.F[e] & F_SIGNAL) { lo += T.SIGNAL_WAIT_LOW_S; hi += T.SIGNAL_WAIT_HIGH_S; }
  return [lo, hi];
}

// ══════════════════════════════════════════════════════════════════════════
// 2. ONE BUILDING -> EVERY NODE
// ══════════════════════════════════════════════════════════════════════════

/**
 * The shortest-path tree from a building's doors. Memoised per code on the
 * graph. Returns null when the code has no door in this graph.
 *   cost[n]  equivalent flat metres (what the search minimises)
 *   lo[n], hi[n]  walking seconds along the tree path
 *   prev[n]  the next node TOWARD the building (-1 at a seed)
 *   door[n]  for a seed node: the [lon, lat] of the door it links to
 */
export function buildingTree(G, code) {
  const P = prepareGraph(G);
  code = String(code || '').toUpperCase();
  if (P.trees.has(code)) return P.trees.get(code);
  const ds = G.code && G.code[code];
  if (!ds || !ds.length) { P.trees.set(code, null); return null; }
  const N = G.N, mult = WALKG.linkCostMult;
  const cost = new Float64Array(N).fill(INF);
  const lo = new Float32Array(N), hi = new Float32Array(N);
  const prev = new Int32Array(N).fill(-1);
  const door = new Map();
  const hn = [], hd = [];
  const push = (n, d) => {
    hn.push(n); hd.push(d);
    let i = hn.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hd[p] <= hd[i]) break;
      [hd[p], hd[i]] = [hd[i], hd[p]]; [hn[p], hn[i]] = [hn[i], hn[p]];
      i = p;
    }
  };
  const pop = () => {
    const n = hn[0], d = hd[0];
    const ln = hn.pop(), ld = hd.pop();
    if (hn.length) {
      hn[0] = ln; hd[0] = ld;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let s = i;
        if (l < hd.length && hd[l] < hd[s]) s = l;
        if (r < hd.length && hd[r] < hd[s]) s = r;
        if (s === i) break;
        [hd[s], hd[i]] = [hd[i], hd[s]]; [hn[s], hn[i]] = [hn[i], hn[s]];
        i = s;
      }
    }
    return [n, d];
  };
  for (const di of ds) {
    const d = G.doors[di];
    if (!d) continue;
    for (let k = 0; k < d[2].length; k++) {
      const n = d[2][k], c = (d[3][k] / 100) * mult;
      if (!P.main[n]) continue;
      if (c < cost[n]) { cost[n] = c; door.set(n, [d[0] * 1e-6, d[1] * 1e-6]); push(n, c); }
    }
  }
  if (!hn.length) { P.trees.set(code, null); return null; }
  while (hn.length) {
    const [u, du] = pop();
    if (du > cost[u]) continue;
    for (let k = G.off[u]; k < G.off[u + 1]; k++) {
      const e = G.eix[k];
      if (G.F[e] & F_OFFMAIN) continue;
      const v = G.to[k], nd = du + edgeCost(G, e);
      if (nd < cost[v]) {
        cost[v] = nd; prev[v] = u;
        const [a, b] = edgeSeconds(G, e);
        lo[v] = lo[u] + a; hi[v] = hi[u] + b;
        push(v, nd);
      }
    }
  }
  const tree = { code, cost, lo, hi, prev, door };
  P.trees.set(code, tree);
  return tree;
}

/** Where a home joins the graph: its mapped doors when the router knows it
 *  by name (`wc`), else a snap from its position. [] = not walkable. */
export function homeAnchors(G, home, maxM = CORE.snapMaxM) {
  const out = [];
  const doors = home.wc && G.wc && G.wc[home.wc];
  const P = prepareGraph(G);
  if (doors && doors.length) {
    for (const di of doors) {
      const d = G.doors[di];
      if (!d) continue;
      for (let k = 0; k < d[2].length; k++) {
        if (!P.main[d[2][k]]) continue;
        out.push({ node: d[2][k], c: (d[3][k] / 100) * WALKG.linkCostMult, m: 0, from: [d[0] * 1e-6, d[1] * 1e-6] });
      }
    }
    if (out.length) return out;
  }
  if (!home.p) return out;
  const s = nearestNode(G, home.p, maxM);
  if (s) out.push({ node: s.node, c: s.m, m: CORE.countSnapLink ? s.m : 0, from: home.p });
  return out;
}

/** Walking seconds [lo, hi] from a set of anchors to a tree's building, or
 *  null. The anchor with the cheapest total cost is the one used. */
export function walkFrom(G, tree, anchors) {
  if (!tree || !anchors || !anchors.length) return null;
  let best = null, bc = INF;
  for (const a of anchors) {
    const c = tree.cost[a.node] + a.c;
    if (c < bc) { bc = c; best = a; }
  }
  if (!best || bc === INF) return null;
  const T = G.tune;
  return {
    lo: tree.lo[best.node] + best.m / T.WALK_SPEED_HIGH_MS,
    hi: tree.hi[best.node] + best.m / T.WALK_SPEED_LOW_MS,
    anchor: best,
  };
}

/** The path a walk takes, as [lon, lat] points from the anchor to the door. */
export function treePath(G, tree, anchor) {
  const pts = [];
  if (anchor.from) pts.push(anchor.from);
  let u = anchor.node, guard = 0;
  while (u >= 0 && guard++ < G.N) {
    pts.push([G.X[u], G.Y[u]]);
    if (tree.prev[u] < 0) { const d = tree.door.get(u); if (d) pts.push(d); break; }
    u = tree.prev[u];
  }
  return pts;
}

// ══════════════════════════════════════════════════════════════════════════
// 3. TARGETS: WHICH BUILDINGS, HOW MUCH EACH
// ══════════════════════════════════════════════════════════════════════════

/** [[code, weight], ...] -> {targets:[{code,w}] summing to 1, dropped, droppedShare}.
 *  `ok(code)` says whether the graph can route to it. */
export function normaliseTargets(pairs, ok) {
  const merged = new Map();
  for (const [c, w] of pairs || []) {
    const code = String(c || '').toUpperCase(), wt = Number(w);
    if (!code || !(wt > 0)) continue;
    merged.set(code, (merged.get(code) || 0) + wt);
  }
  const total = [...merged.values()].reduce((a, b) => a + b, 0);
  const keep = [], dropped = [];
  for (const [code, w] of merged) (ok(code) ? keep : dropped).push({ code, w });
  const kept = keep.reduce((a, t) => a + t.w, 0);
  const targets = kept > 0 ? keep.map(t => ({ code: t.code, w: t.w / kept })) : [];
  targets.sort((a, b) => b.w - a.w || a.code.localeCompare(b.code));
  return { targets, dropped: dropped.map(t => ({ code: t.code, w: total ? t.w / total : 0 })),
    droppedShare: total ? 1 - kept / total : 0 };
}

/**
 * A schedule -> [[code, meetings per week], ...]. Reads ONLY `code`, `days`
 * and whether the class was placed — never titles, rooms or times — and it
 * returns nothing that leaves this function except building codes and counts.
 * Accepts both shapes js/wayfind.js publishes: an import result (`classes`)
 * and a restored store (`events`, with `status`).
 */
export function scheduleTargets(schedule) {
  const rows = Array.isArray(schedule?.events) ? schedule.events.filter(e => e && e.status !== 'failed')
    : Array.isArray(schedule?.classes) ? schedule.classes.filter(c => c && !c.unroutableWhy) : [];
  const count = new Map();
  for (const r of rows) {
    const code = String(r.code || '').toUpperCase();
    if (!code) continue;
    const n = Array.isArray(r.days) && r.days.length ? r.days.length : 1;
    count.set(code, (count.get(code) || 0) + n);
  }
  return [...count.entries()];
}

// ══════════════════════════════════════════════════════════════════════════
// 4. BUS, SCORE, RANK
// ══════════════════════════════════════════════════════════════════════════

/** Bus minutes [lo, hi] from a home's transit row to a building, given the
 *  walk (seconds) from each anchor stop to that building. */
export function busTo(row, walkFromAnchor) {
  if (!row) return null;
  let best = null;
  for (const [aid, t] of Object.entries(row)) {
    const w = walkFromAnchor[aid];
    if (!t || !w) continue;
    const mid = t.min + (w.lo + w.hi) / 120;
    if (!best || mid < best.mid) {
      best = { lo: t.min - t.wait + w.lo / 60, hi: t.min + t.wait + w.hi / 60, mid, via: aid, t };
    }
  }
  return best;
}

/**
 * legs: [{code, w, walk: {lo,hi} minutes | null, bus: {lo,hi,...} minutes | null}]
 * -> {lo, hi, mid, how, legs} minutes, or null when a building has no answer
 * in this mode.
 */
export function scoreHome(legs, mode) {
  if (!legs || !legs.length) return null;
  const out = [];
  let lo = 0, hi = 0, wsum = 0;
  const hows = new Set();
  for (const l of legs) {
    const w = l.walk, b = l.bus;
    let pick = null, how = null;
    if (mode === 'walk') { pick = w; how = 'walk'; }
    else if (mode === 'bus') { pick = b; how = 'bus'; }
    else {
      const mw = w ? (w.lo + w.hi) / 2 : INF, mb = b ? (b.lo + b.hi) / 2 : INF;
      if (mw <= mb) { pick = w; how = 'walk'; } else { pick = b; how = 'bus'; }
    }
    if (!pick) return null;
    hows.add(how);
    lo += l.w * pick.lo; hi += l.w * pick.hi; wsum += l.w;
    out.push({ code: l.code, w: l.w, lo: pick.lo, hi: pick.hi, how, bus: how === 'bus' ? pick : null });
  }
  if (!(wsum > 0)) return null;
  lo /= wsum; hi /= wsum;
  return { lo, hi, mid: (lo + hi) / 2, how: hows.size === 1 ? [...hows][0] : 'mixed', legs: out };
}

/** Rank scored homes by midpoint then name. Unscored homes come back apart. */
export function rankHomes(items) {
  const ranked = items.filter(i => i.score).sort((a, b) =>
    a.score.mid - b.score.mid || a.home.name.localeCompare(b.home.name));
  ranked.forEach((r, i) => { r.rank = i + 1; });
  return { ranked, unranked: items.filter(i => !i.score) };
}

// ══════════════════════════════════════════════════════════════════════════
// 5. HEAT: MINUTES FOR A PATCH OF GROUND
// ══════════════════════════════════════════════════════════════════════════

/** Square cells over the walking graph, each tied to the main-component node
 *  nearest its centre (within half a diagonal). Cached per cell size. */
export function walkCells(G, cellM) {
  const P = prepareGraph(G);
  P.cells = P.cells || new Map();
  if (P.cells.has(cellM)) return P.cells.get(cellM);
  let x0 = INF, y0 = INF, x1 = -INF, y1 = -INF;
  for (let i = 0; i < G.N; i++) if (P.main[i]) {
    if (G.X[i] < x0) x0 = G.X[i]; if (G.X[i] > x1) x1 = G.X[i];
    if (G.Y[i] < y0) y0 = G.Y[i]; if (G.Y[i] > y1) y1 = G.Y[i];
  }
  const dx = cellM / P.kx, dy = cellM / P.ky, cells = [];
  for (let y = y0 + dy / 2; y < y1; y += dy) for (let x = x0 + dx / 2; x < x1; x += dx) {
    const s = nearestNode(G, [x, y], cellM * 0.71);
    if (s) cells.push({ c: [x, y], node: s.node, hx: dx / 2, hy: dy / 2 });
  }
  P.cells.set(cellM, cells);
  return cells;
}

/** Weighted walking midpoint (minutes) at a node, or null. */
export function walkMidAt(trees, targets, node) {
  let s = 0;
  for (let i = 0; i < targets.length; i++) {
    const t = trees[i];
    if (!t || t.cost[node] === INF) return null;
    s += targets[i].w * (t.lo[node] + t.hi[node]) / 120;
  }
  return s;
}

/** Weighted bus midpoint (minutes) at a transit grid cell, or null.
 *  cell = [lon, lat, min0, wait0, min1, wait1, ...] in `anchorIds` order;
 *  walkMid[b][aid] = walking midpoint (minutes) from anchor stop aid to b. */
export function busMidAt(cell, anchorIds, targets, walkMid) {
  let s = 0;
  for (let b = 0; b < targets.length; b++) {
    let best = INF;
    for (let a = 0; a < anchorIds.length; a++) {
      const m = cell[2 + 2 * a], w = walkMid[b][anchorIds[a]];
      if (m == null || w == null) continue;
      if (m + w < best) best = m + w;
    }
    if (best === INF) return null;
    s += targets[b].w * best;
  }
  return s;
}

/** Colour for a minute value on a ramp of [[minutes, '#rrggbb'], ...]. */
export function rampColour(stops, m) {
  if (!(m >= stops[0][0])) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (m <= stops[i][0]) {
      const [m0, c0] = stops[i - 1], [m1, c1] = stops[i], f = (m - m0) / (m1 - m0);
      const a = parseInt(c0.slice(1), 16), b = parseInt(c1.slice(1), 16);
      const ch = (s) => Math.round(((a >> s) & 255) + (((b >> s) & 255) - ((a >> s) & 255)) * f);
      return '#' + ((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1);
    }
  }
  return stops[stops.length - 1][1];
}
