// Walking routes, off the main thread: A* on the repo's walking graph (data/walk_graph.json, OpenStreetMap footways + UT doors).
// New code; it reads the same graph the old app's finder reads (format: that file's own `_format` string).
//
// in : {type:'init', origin}
//      {type:'route', id, from:{doors:[i..]} | {x,z}, to:{doors:[i..]} | {x,z}}
// out: {type:'ready', apartments:[{name, doors}], buildings:[{code, name, doors}], doors:[[x,z]..]}
//      {type:'route', id, ok, path:[x,z,...], metres, seconds, minutes} | {type:'route', id, ok:false, reason}
import { toLocal, setOrigin } from './geo.js';

export const WALK_SPEED_MS = 1.4;          // the owner's walking speed for minutes (m/s)
const CROSSING_PENALTY_M = 8;              // a street crossing costs this many extra metres (the graph's own tune value)
const SNAP_MAX_M = 250;                    // a free point (no door) joins the graph at its nearest node within this

let X, Z, adjStart, adjTo, adjW, doors, ready = false;

function decode(w) {
  const q = w.q, n = w.n.x.length;
  X = new Float64Array(n); Z = new Float64Array(n);
  let ax = 0, ay = 0;
  for (let i = 0; i < n; i++) { ax += w.n.x[i]; ay += w.n.y[i]; const p = toLocal(ax * q, ay * q); X[i] = p[0]; Z[i] = p[1]; }
  const m = w.e.a.length, A = new Int32Array(m), B = new Int32Array(m), W = new Float64Array(m);
  let a = 0;
  for (let e = 0; e < m; e++) {
    a += w.e.a[e];
    A[e] = a; B[e] = a + w.e.b[e];
    W[e] = w.e.w[e] / 100 + ((w.e.f[e] & 2) ? CROSSING_PENALTY_M : 0);
  }
  // CSR adjacency, both directions
  const deg = new Int32Array(n + 1);
  for (let e = 0; e < m; e++) { deg[A[e] + 1]++; deg[B[e] + 1]++; }
  for (let i = 0; i < n; i++) deg[i + 1] += deg[i];
  adjStart = deg; adjTo = new Int32Array(2 * m); adjW = new Float64Array(2 * m);
  const fill = adjStart.slice(0, n);
  for (let e = 0; e < m; e++) {
    adjTo[fill[A[e]]] = B[e]; adjW[fill[A[e]]++] = W[e];
    adjTo[fill[B[e]]] = A[e]; adjW[fill[B[e]]++] = W[e];
  }
  // doors: [x, y, anchorNodes, linkCm, role, src, ref, name]
  doors = w.d.map((d) => { const p = toLocal(d[0] * q, d[1] * q); return { x: p[0], z: p[1], anchors: d[2], link: d[3].map((c) => c / 100), ref: d[6], name: d[7] }; });
}

// A binary heap on (f, node)
class Heap {
  constructor() { this.f = []; this.v = []; }
  get size() { return this.v.length; }
  push(f, v) { const F = this.f, V = this.v; let i = V.length; F.push(f); V.push(v); while (i > 0) { const p = (i - 1) >> 1; if (F[p] <= f) break; F[i] = F[p]; V[i] = V[p]; i = p; } F[i] = f; V[i] = v; }
  pop() {
    const F = this.f, V = this.v, top = V[0], lf = F.pop(), lv = V.pop(), n = V.length;
    if (n) { let i = 0; for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && F[c + 1] < F[c]) c++; if (F[c] >= lf) break; F[i] = F[c]; V[i] = V[c]; i = c; } F[i] = lf; V[i] = lv; }
    return top;
  }
}

function nearestNode(x, z) {
  let best = -1, bd = Infinity;
  for (let i = 0; i < X.length; i++) { const d = (X[i] - x) ** 2 + (Z[i] - z) ** 2; if (d < bd) { bd = d; best = i; } }
  return Math.sqrt(bd) <= SNAP_MAX_M ? { node: best, d: Math.sqrt(bd) } : null;
}
// An end of a route = a list of {node, cost, door} entries (a door joins its anchor nodes by its link lengths).
function endsOf(spec) {
  const out = [];
  if (spec.doors && spec.doors.length) {
    for (const di of spec.doors) { const d = doors[di]; if (!d) continue; d.anchors.forEach((nd, k) => out.push({ node: nd, cost: d.link[k] || 0, door: di })); }
  } else if (spec.x != null) {
    const s = nearestNode(spec.x, spec.z);
    if (s) out.push({ node: s.node, cost: s.d, point: [spec.x, spec.z] });
  }
  return out;
}

function route(from, to) {
  const S = endsOf(from), T = endsOf(to);
  if (!S.length || !T.length) return { ok: false, reason: 'no entrance on the walking graph' };
  const n = X.length;
  const g = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), closed = new Uint8Array(n);
  const goal = new Map();                     // node -> best extra cost to its door
  for (const t of T) if (!goal.has(t.node) || goal.get(t.node).cost > t.cost) goal.set(t.node, t);
  const tx = T.map((t) => X[t.node]), tz = T.map((t) => Z[t.node]);
  const h = (v) => { let b = Infinity; for (let k = 0; k < tx.length; k++) { const d = Math.hypot(X[v] - tx[k], Z[v] - tz[k]); if (d < b) b = d; } return b; };
  const heap = new Heap();
  const startOf = new Map();
  for (const s of S) if (s.cost < g[s.node]) { g[s.node] = s.cost; startOf.set(s.node, s); heap.push(s.cost + h(s.node), s.node); }
  let best = Infinity, bestNode = -1;
  while (heap.size) {
    const v = heap.pop();
    if (closed[v]) continue;
    closed[v] = 1;
    if (g[v] + h(v) >= best) break;
    const gt = goal.get(v);
    if (gt && g[v] + gt.cost < best) { best = g[v] + gt.cost; bestNode = v; }
    for (let k = adjStart[v]; k < adjStart[v + 1]; k++) {
      const u = adjTo[k], c = g[v] + adjW[k];
      if (c < g[u]) { g[u] = c; prev[u] = v; heap.push(c + h(u), u); }
    }
  }
  if (bestNode < 0) return { ok: false, reason: 'no walking connection between them' };
  const nodes = [];
  for (let v = bestNode; v >= 0; v = prev[v]) nodes.push(v);
  nodes.reverse();
  const path = [];
  const s = startOf.get(nodes[0]);
  if (s && s.door != null) path.push(doors[s.door].x, doors[s.door].z); else if (s && s.point) path.push(s.point[0], s.point[1]);
  for (const v of nodes) path.push(X[v], Z[v]);
  const t = goal.get(bestNode);
  if (t.door != null) path.push(doors[t.door].x, doors[t.door].z);
  // the walked length (without the crossing penalty) for the minutes
  let metres = 0;
  for (let i = 2; i < path.length; i += 2) metres += Math.hypot(path[i] - path[i - 2], path[i + 1] - path[i - 1]);
  const seconds = metres / WALK_SPEED_MS;
  return { ok: true, path, metres, seconds, minutes: Math.max(1, Math.round(seconds / 60)), startDoor: s && s.door, endDoor: t.door };
}

function titleCase(s) { return s.replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\bUt\b/g, 'UT'); }

onmessage = async (ev) => {
  const m = ev.data;
  if (m.type === 'init') {
    if (m.origin) setOrigin(m.origin.lat, m.origin.lon);
    const w = await (await fetch(new URL('../data/walk_graph.json', import.meta.url))).json();
    decode(w);
    // building names: the longest written name the graph maps to each code
    const names = {};
    for (const [k, code] of Object.entries(w.name || {})) {
      if (/^\d+$/.test(k) || k.length <= 4) continue;
      if (!names[code] || k.length > names[code].length) names[code] = k;
    }
    for (const d of doors) if (d.ref && d.name && !names[d.ref]) names[d.ref] = d.name.toLowerCase();
    const buildings = Object.entries(w.code || {}).map(([code, ds]) => ({ code, name: titleCase(names[code] || code), doors: ds }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const apartments = Object.entries(w.wc || {}).map(([name, ds]) => ({ name, doors: ds })).sort((a, b) => a.name.localeCompare(b.name));
    ready = true;
    postMessage({ type: 'ready', apartments, buildings, doors: doors.map((d) => [d.x, d.z]), nodes: X.length });
  } else if (m.type === 'route') {
    if (!ready) return postMessage({ type: 'route', id: m.id, ok: false, reason: 'graph not loaded' });
    const t0 = performance.now();
    const r = route(m.from, m.to);
    r.ms = Math.round(performance.now() - t0);
    postMessage({ type: 'route', id: m.id, ...r });
  }
};
