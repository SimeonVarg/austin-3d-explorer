/**
 * walkmeter.mjs — the walk-feature gauntlet's scoreboard.
 *
 * For each pair in a walk-pairs.json file (default scripts/verify/walk-pairs.json)
 * this drives the REAL app (`?walk=1`) in headless Chrome, calls the same public
 * API the UI itself uses (`window.wayfindRoute`) to get the door the router picks
 * and the route length it reports, and separately computes -- against the SAME
 * served graph, with a Dijkstra reimplementation kept line-for-line faithful to
 * js/wayfind.js -- the route length to the door a UT student would actually use
 * (identified from UT Austin's own public Celebrated_Entrances ArcGIS layer; see
 * walk-pairs.json for the per-pair citations).
 *
 * THIS SCRIPT IS SELF-CHECKING. It never trusts its own reimplementation blind:
 * for every pair it also runs the Dijkstra against the doors the APP itself
 * picked and asserts that number equals (within EPS_M) what the browser's own
 * wayfindRoute() reported. If those two disagree, the reimplementation has
 * drifted from js/wayfind.js and the run FAILS LOUD rather than printing a
 * plausible but wrong "extra metres" number -- CLAUDE.md's "verify by looking,
 * not by reasoning" applies to a reimplemented router exactly as much as to a
 * screenshot.
 *
 * Usage:
 *   python scripts/serve.py 8801                                  # from repo root
 *   node scripts/verify/walkmeter.mjs                              # from scripts/verify
 *   node scripts/verify/walkmeter.mjs walk-pairs.json 8801
 *   VERIFY_URL=http://127.0.0.1:8801 node scripts/verify/walkmeter.mjs
 *
 * Any of the five w-* lanes can point this at their OWN branch's served app to
 * get the identical measurement this baseline used -- that is the point of it.
 *
 * Exit codes: 0 pass (self-check held), 1 self-check failed or a pair errored,
 * 2 bad args / files missing.
 */
import { chromium } from 'playwright-core';
import { chromePath, launch, BASE as DEFAULT_BASE } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argPairs = process.argv[2] && !/^\d+$/.test(process.argv[2]) ? process.argv[2] : null;
const argPort = process.argv.find(a => /^\d+$/.test(a));
const PORT = argPort || process.env.PORT || '8801';
const BASE = process.env.VERIFY_URL || `http://127.0.0.1:${PORT}`;
const PAIRS_FILE = path.resolve(__dirname, argPairs || 'walk-pairs.json');

// Metres of slop tolerated between the browser's own reported distM and this
// script's Dijkstra reimplementation on the SAME (app-chosen) doors. Floating
// point + independent code paths; not zero, but tight enough that a real drift
// (a changed constant, a mis-copied edge cost) stands out immediately.
const EPS_M = 0.5;

if (!fs.existsSync(PAIRS_FILE)) {
  console.error(`Cannot find pairs file: ${PAIRS_FILE}`);
  process.exit(2);
}
const PAIRS = JSON.parse(fs.readFileSync(PAIRS_FILE, 'utf8')).pairs;

// ══════════════════════════════════════════════════════════════════════════
// The Dijkstra reimplementation. Kept deliberately close to js/wayfind.js's
// own decode()/dijkstra()/measure()/edgeCost() -- see that file's §1-3 -- so a
// diff against it is easy for whoever next touches either copy.
// ══════════════════════════════════════════════════════════════════════════
function decode(g) {
  const Q = g.q, N = g.n.x.length, E = g.e.a.length;
  const X = new Float64Array(N), Y = new Float64Array(N);
  let ax = 0, ay = 0;
  for (let i = 0; i < N; i++) { ax += g.n.x[i]; ay += g.n.y[i]; X[i] = ax * Q; Y[i] = ay * Q; }
  const A = new Int32Array(E), B = new Int32Array(E);
  let a = 0;
  for (let i = 0; i < E; i++) { a += g.e.a[i]; A[i] = a; B[i] = a + g.e.b[i]; }
  const W = Int32Array.from(g.e.w), F = Uint8Array.from(g.e.f), S = Int32Array.from(g.e.s);
  const deg = new Int32Array(N);
  for (let i = 0; i < E; i++) { deg[A[i]]++; deg[B[i]]++; }
  const off = new Int32Array(N + 1);
  for (let i = 0; i < N; i++) off[i + 1] = off[i] + deg[i];
  const to = new Int32Array(2 * E), eix = new Int32Array(2 * E);
  const cur = Int32Array.from(off.subarray(0, N));
  for (let i = 0; i < E; i++) {
    to[cur[A[i]]] = B[i]; eix[cur[A[i]]++] = i;
    to[cur[B[i]]] = A[i]; eix[cur[B[i]]++] = i;
  }
  const swEdges = new Map();
  for (let i = 0; i < E; i++) if (S[i] >= 0) swEdges.set(S[i], (swEdges.get(S[i]) || 0) + 1);
  return {
    raw: g, N, E, X, Y, A, B, W, F, S, off, to, eix, swEdges,
    doors: g.d, code: g.code, q: Q,
  };
}

const F_STEPS = 1, F_CROSS = 2, F_SIGNAL = 4, F_OFFMAIN = 128;

function makeConsts(raw) {
  const c = {
    speedLow: 1.10, speedHigh: 1.40, stairSpeed: 0.50, stairFixedS: 4.0,
    stairUpMult: 1.35, signalWaitLowS: 0, signalWaitHighS: 45, crossingPenaltyM: 8,
    doorLinkMaxM: 30,
  };
  const map = { WALK_SPEED_LOW_MS: 'speedLow', WALK_SPEED_HIGH_MS: 'speedHigh',
    STAIR_SPEED_MPS: 'stairSpeed', STAIR_FIXED_S: 'stairFixedS',
    STAIR_UP_MULT: 'stairUpMult', SIGNAL_WAIT_LOW_S: 'signalWaitLowS',
    SIGNAL_WAIT_HIGH_S: 'signalWaitHighS', CROSSING_PENALTY_M: 'crossingPenaltyM',
    DOOR_LINK_MAX_M: 'doorLinkMaxM' };
  for (const k in map) if (raw.tune && raw.tune[k] != null) c[map[k]] = raw.tune[k];
  return c;
}

function edgeCost(g, WF, i, avoidStairs) {
  const m = g.W[i] / 100;
  if (g.F[i] & F_STEPS) {
    if (avoidStairs) return Infinity;
    const n = g.swEdges.get(g.S[i]) || 1;
    return m * (WF.speedLow / WF.stairSpeed) + (WF.stairFixedS * WF.speedLow) / n;
  }
  let c = m;
  if (g.F[i] & F_CROSS) c += WF.crossingPenaltyM;
  return c;
}

function dijkstra(g, WF, seeds, targets, avoidStairs) {
  const N = g.N;
  const dist = new Float64Array(N).fill(Infinity);
  const prevE = new Int32Array(N).fill(-1);
  const prevN = new Int32Array(N).fill(-1);
  const seedOf = new Int32Array(N).fill(-1);
  const tmap = new Map();
  for (const t of targets) {
    const p = tmap.get(t.node);
    if (!p || t.c < p.c) tmap.set(t.node, t);
  }
  const hn = [], hd = [];
  const push = (n, d) => {
    hn.push(n); hd.push(d);
    let i = hn.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hd[p] <= hd[i]) break;
      const td = hd[p]; hd[p] = hd[i]; hd[i] = td;
      const tn = hn[p]; hn[p] = hn[i]; hn[i] = tn;
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
        const td = hd[s]; hd[s] = hd[i]; hd[i] = td;
        const tn = hn[s]; hn[s] = hn[i]; hn[i] = tn;
        i = s;
      }
    }
    return [n, d];
  };
  for (let k = 0; k < seeds.length; k++) {
    const s = seeds[k];
    if (s.c < dist[s.node]) { dist[s.node] = s.c; seedOf[s.node] = k; push(s.node, s.c); }
  }
  let best = null;
  let left = tmap.size;
  while (hn.length) {
    const popped = pop(); const u = popped[0], d = popped[1];
    if (d > dist[u]) continue;
    if (best && d > best.cost) break;
    if (tmap.has(u)) {
      const t = tmap.get(u);
      const tot = d + t.c;
      if (!best || tot < best.cost) best = { cost: tot, node: u, target: t };
      tmap.delete(u);
      left--;
      if (!left) break;
    }
    for (let k = g.off[u]; k < g.off[u + 1]; k++) {
      const e = g.eix[k];
      if (g.F[e] & F_OFFMAIN) continue;
      const c = edgeCost(g, WF, e, avoidStairs);
      if (!isFinite(c)) continue;
      const v = g.to[k];
      const nd = d + c;
      if (nd < dist[v]) { dist[v] = nd; prevE[v] = e; prevN[v] = u; seedOf[v] = seedOf[u]; push(v, nd); }
    }
  }
  if (!best) return null;
  const edges = [], nodes = [];
  let n = best.node;
  nodes.push(n);
  while (prevE[n] !== -1) { edges.push(prevE[n]); n = prevN[n]; nodes.push(n); }
  edges.reverse(); nodes.reverse();
  return { cost: best.cost, edges, nodes, target: best.target, seed: seeds[seedOf[best.node]] };
}

function measure(g, leg) {
  let flat = 0, stair = 0, signals = 0;
  const sets = new Set();
  for (const e of leg.edges) {
    const m = g.W[e] / 100;
    if (g.F[e] & F_STEPS) { stair += m; sets.add(g.S[e]); }
    else flat += m;
    if (g.F[e] & F_SIGNAL) signals++;
  }
  return { flat, stair, signals, stairSets: sets.size };
}

function anchors(g, doors, role) {
  const out = [];
  for (const di of doors) {
    const d = g.doors[di];
    for (let k = 0; k < d[2].length; k++) out.push({ node: d[2][k], c: d[3][k] / 100, door: di, role });
  }
  return out;
}

// js/wayfind.js's doorSet(): role:main wins where a building has one.
function doorSetFor(g, code) {
  const all = (g.code[code] || []).filter(di => g.doors[di][2] && g.doors[di][2].length);
  const mains = all.filter(di => g.doors[di][4] === 'main');
  return mains.length ? mains : all;
}

function routeBetween(g, WF, fromDoors, toDoors, avoidStairs) {
  const seeds = anchors(g, fromDoors, 'from');
  const targets = anchors(g, toDoors, 'to');
  if (!seeds.length || !targets.length) return null;
  const r = dijkstra(g, WF, seeds, targets, avoidStairs);
  if (!r) return null;
  const fromDoor = r.seed ? r.seed.door : fromDoors[0];
  const fromLinkM = r.seed ? r.seed.c : 0;
  const toDoor = r.target.door;
  const toLinkM = r.target.c;
  const m = measure(g, r);
  const distM = m.flat + m.stair + fromLinkM + toLinkM;
  return { distM, fromDoor, toDoor, fromLinkM, toLinkM, stairSets: m.stairSets, signals: m.signals };
}

// ══════════════════════════════════════════════════════════════════════════
// The run
// ══════════════════════════════════════════════════════════════════════════
async function main() {
  const graphRes = await fetch(`${BASE}/data/walk_graph.json`);
  if (!graphRes.ok) { console.error(`Cannot fetch ${BASE}/data/walk_graph.json: ${graphRes.status}`); process.exit(2); }
  const raw = await graphRes.json();
  const g = decode(raw);
  const WF = makeConsts(raw);

  const browser = await launch(chromium);
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));

  await page.goto(`${BASE}/index.html?walk=1&drift=0&intro=0`, { waitUntil: 'networkidle', timeout: 90000 });
  await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 90000 });
  await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
  await page.waitForFunction(() => typeof window.wayfindRoute === 'function', null, { timeout: 30000 });

  const rows = [];
  let selfCheckFail = 0, pairErrors = 0;

  for (const p of PAIRS) {
    const appR = await page.evaluate(async ([f, t]) => {
      const r = await window.wayfindRoute(f, t, {});
      if (!r.ok) return { ok: false, why: r.why };
      return {
        ok: true, distM: r.distM, fromDoor: r.fromDoor, toDoor: r.toDoor,
        fromRole: r.fromRole, toRole: r.toRole,
      };
    }, [p.from, p.to]);

    if (!appR.ok) {
      console.error(`PAIR ${p.id}: app route FAILED (${appR.why})`);
      pairErrors++;
      rows.push({ ...p, error: appR.why });
      continue;
    }

    // Self-check: replay the SAME doors the app picked through the local
    // reimplementation and require the distance to agree with what the
    // browser itself reported.
    const localAppDoors = { from: [appR.fromDoor], to: [appR.toDoor] };
    const localApp = routeBetween(g, WF, localAppDoors.from, localAppDoors.to, false);
    const drift = localApp ? Math.abs(localApp.distM - appR.distM) : Infinity;
    if (!localApp || drift > EPS_M) {
      console.error(`PAIR ${p.id}: SELF-CHECK FAILED -- browser distM=${appR.distM?.toFixed(1)} ` +
        `local reimpl=${localApp ? localApp.distM.toFixed(1) : 'null'} drift=${drift.toFixed(2)}m (limit ${EPS_M}m)`);
      selfCheckFail++;
    }

    // The corrected route: force the UT-verified door where we have one,
    // otherwise fall back to the SAME doorSet the app used (never invent an
    // improvement on an endpoint we have no ground truth for).
    const fromDoors = p.fromDoorCorrect != null ? [p.fromDoorCorrect] : doorSetFor(g, p.from);
    const toDoors = p.toDoorCorrect != null ? [p.toDoorCorrect] : doorSetFor(g, p.to);
    const corrected = routeBetween(g, WF, fromDoors, toDoors, false);
    if (!corrected) {
      console.error(`PAIR ${p.id}: corrected route FAILED to resolve`);
      pairErrors++;
      rows.push({ ...p, error: 'corrected-noroute' });
      continue;
    }

    const extra = appR.distM - corrected.distM;
    rows.push({
      ...p,
      appDistM: appR.distM, appFromDoor: appR.fromDoor, appToDoor: appR.toDoor,
      appFromRole: appR.fromRole, appToRole: appR.toRole,
      correctedDistM: corrected.distM, correctedFromDoor: corrected.fromDoor, correctedToDoor: corrected.toDoor,
      stairSets: corrected.stairSets, signals: corrected.signals,
      extraM: extra, selfCheckDriftM: drift,
    });
    console.log(`${p.id.padEnd(10)} app=${appR.distM.toFixed(0).padStart(4)}m  ` +
      `corrected=${corrected.distM.toFixed(0).padStart(4)}m  extra=${extra.toFixed(0).padStart(4)}m  ` +
      `stairSets=${corrected.stairSets}  drift=${drift.toFixed(2)}m`);
  }

  await browser.__done();

  const ok = rows.filter(r => r.extraM != null);
  const total = ok.reduce((s, r) => s + Math.max(0, r.extraM), 0);
  const sorted = ok.map(r => r.extraM).sort((a, b) => a - b);
  const median = sorted.length ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2]
    : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2) : 0;
  const worst = ok.reduce((w, r) => (!w || r.extraM > w.extraM) ? r : w, null);

  console.log('\n' + '='.repeat(72));
  console.log(`Pairs measured: ${ok.length}/${PAIRS.length}  (errors: ${pairErrors}, self-check fails: ${selfCheckFail})`);
  console.log(`Total extra metres walked (sum, floored at 0 per pair): ${total.toFixed(0)} m`);
  console.log(`Median extra metres per pair: ${median.toFixed(1)} m`);
  if (worst) console.log(`Worst offender: ${worst.id} (${worst.from} -> ${worst.to}), +${worst.extraM.toFixed(0)} m`);
  console.log('='.repeat(72));

  // scripts/verify/out/ is gitignored -- this is a regenerable run artifact,
  // not a deliverable. Re-run the script to reproduce it against any branch.
  const outJson = path.resolve(__dirname, 'out', 'walkmeter-last-run.json');
  try { fs.mkdirSync(path.dirname(outJson), { recursive: true }); } catch (e) {}
  fs.writeFileSync(outJson, JSON.stringify({ base: BASE, at: new Date().toISOString(), rows, total, median, worst: worst?.id }, null, 1));
  console.log(`\nFull per-pair JSON written to ${outJson}`);

  if (errors.length) console.log('PAGE ERRORS', errors.slice(0, 8));
  if (selfCheckFail > 0 || pairErrors > 0) process.exit(1);
}

main();
