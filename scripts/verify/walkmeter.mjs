/**
 * walkmeter.mjs — the walk-feature gauntlet's scoreboard.
 *
 * ONE INSTRUMENT, RECONCILED FROM TWO. The baseline lane and the door lane each
 * built a "walkmeter" in parallel while the run was down, and they measured
 * DIFFERENT THINGS under the same name — the worst possible outcome for a
 * shared scoreboard. Both numbers are real and neither is redundant, so this
 * file reports both, on one pair list, from one page load:
 *
 *   A. ROUTE-LENGTH EXTRA (the baseline lane's number, unchanged)
 *      app route length  −  route length forced to the ground-truth door.
 *      Positive = the door the router picked genuinely costs you metres of
 *      pavement. This is what `docs/walk-baseline.md` reports as 795 m on
 *      origin/main, and those numbers must keep reproducing here.
 *
 *   B. DOOR-OFFSET EXTRA (the door lane's number, unchanged)
 *      metres from the door the router picked to the nearest door UT itself
 *      publishes, summed over both ends. Zero means the walk ends where
 *      maps.utexas.edu says the entrance is.
 *
 * NEITHER ONE ALONE IS THE ANSWER, and that is exactly why both are printed.
 * A shorter route to the wrong door scores WELL on A and badly on B — and B is
 * right, because the metres you then walk around the building are real and
 * simply go uncounted (PAT→BIO gets ~94 m longer under the door fix and is more
 * correct for it). Meanwhile A catches what B cannot see: forcing every
 * building onto ONE published door makes nine of the baseline's nineteen pairs
 * longer, because a building can have two real front doors on different sides.
 * A rule that wins on B and loses on A has traded one complaint for another.
 *
 * THE ORACLE — "the door a student would actually use" — is UT Facilities' own
 * hand-surveyed Celebrated_Entrances layer, the one maps.utexas.edu draws. It
 * is read in whichever of two ways the page under test allows, and the run says
 * which:
 *   page   `window.wayfindUTDoors()` — UT's actual coordinates, shipped as a
 *          table in js/wayfind.js. Exact, and it cannot go stale against the
 *          router in silence, because it IS what the router used.
 *   pairs  walk-pairs.json's `fromDoorCorrect`/`toDoorCorrect` door INDICES,
 *          each matched to a UT row offline (citations per pair in that file).
 *          Used against a checkout with no UT table — e.g. origin/main.
 *
 * THIS SCRIPT IS SELF-CHECKING. It never trusts its own Dijkstra blind: for
 * every pair it replays the doors the APP itself picked through the local
 * reimplementation and asserts the distance equals (within EPS_M) what the
 * browser's own wayfindRoute() reported. If they disagree, the reimplementation
 * has drifted from js/wayfind.js and the run FAILS LOUD rather than printing a
 * plausible but wrong number. A door the router INVENTED at run time (a UT
 * entrance our bake never placed) has no index in the served graph, so its
 * anchors are read back off the page with `wayfindDoorAt()` and replayed too —
 * skipping the self-check for exactly the doors this round added would be
 * skipping it where it matters most.
 *
 * THE LIVE UI GATE. Everything above drives `wayfindRoute()`, which is an API,
 * not a control. On 2026-08-24 the "Avoid stairs" ROUTING was clean on 9/9
 * buildings through that API while the CHECKBOX a person clicks was unusable:
 * the click bubbled to the pill, collapsed the card, and destroyed the input
 * before its own change handler could run. An API-only harness said the feature
 * worked. So the last gate clicks the real checkbox with a real mouse at its
 * real pixel centre, twice, and asserts the route changes and changes back.
 * Skip with --no-ui.
 *
 * Usage:
 *   python scripts/serve.py 8811                                   # repo root
 *   node scripts/verify/walkmeter.mjs                              # from scripts/verify
 *   node scripts/verify/walkmeter.mjs walk-pairs.json 8811
 *   VERIFY_URL=http://127.0.0.1:8811 node scripts/verify/walkmeter.mjs
 *     --baseline      also run with the door rules turned OFF, as an A/B
 *     --json out.json write the whole per-pair table there
 *     --no-ui         skip the real-mouse checkbox gate
 *
 * Any of the five w-* lanes can point this at their OWN branch's served app and
 * get the identical measurement — that is the point of it.
 *
 * Exit codes: 0 pass, 1 a self-check failed / a pair errored / the UI gate
 * failed, 2 bad args or files missing.
 */
import { chromium } from 'playwright-core';
import { launch, BASE as DEFAULT_BASE } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = k => argv.indexOf(k) >= 0;
const opt = (k, d) => { const i = argv.indexOf(k); return i < 0 ? d : argv[i + 1]; };
const JSON_OUT = opt('--json', null);
const argPairs = argv.find(a => /\.json$/.test(a) && a !== JSON_OUT);
const argPort = argv.find(a => /^\d+$/.test(a));
const BASE = process.env.VERIFY_URL || (argPort ? `http://127.0.0.1:${argPort}` : DEFAULT_BASE);
const PAIRS_FILE = path.resolve(__dirname, argPairs || 'walk-pairs.json');
const DO_BASELINE = flag('--baseline');
const DO_UI = !flag('--no-ui');

// Metres of slop tolerated between the browser's own reported distM and this
// script's Dijkstra reimplementation on the SAME (app-chosen) doors. Floating
// point + independent code paths; not zero, but tight enough that a real drift
// (a changed constant, a mis-copied edge cost) stands out immediately.
const EPS_M = 0.5;

/** A walk ending this far from UT's own door counts as "the right door". The
 *  same trough js/wayfind.js's utDoorMatchM sits in, rounded up: under ~15 m
 *  you are at the same doorway, over it you are on another wall. Reported,
 *  never asserted on — this script prints a number, it does not gate a merge. */
const AT_THE_DOOR_M = 15;

/** The pair the live UI gate drives. It is in the house pair list, tagged
 *  level-change, and its route really does cross a mapped staircase — so
 *  ticking the box has something to change. */
const UI_GATE_PAIR = { from: 'WCH', to: 'MAI' };

/** The door rules the door round added, one switch each, so `--baseline` is the
 *  SAME page with the rule off rather than an old checkout — same graph, same
 *  data, same browser, only the rule differs. On a build with no such flags
 *  (origin/main) the assign is a harmless no-op and the pass is a repeat. */
const DOORS_OFF = { useUTSurvey: false, utVirtualDoors: false, widenSideDoors: false };
const DOORS_ON = { useUTSurvey: true, utVirtualDoors: true, widenSideDoors: true };

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
    doors: g.d, code: g.code, q: Q, bakedDoors: g.d.length,
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

/**
 * Anchors for a set of doors. `extra` carries door records the SERVED GRAPH
 * does not have — a UT entrance the router invented at run time — read back off
 * the page. Without it the self-check would have to be skipped for exactly the
 * doors the door round added.
 */
function anchors(g, doors, role, extra) {
  const out = [];
  for (const di of doors) {
    let nodes = null, costsM = null;
    if (g.doors[di]) { nodes = g.doors[di][2]; costsM = (g.doors[di][3] || []).map(c => c / 100); }
    else if (extra && extra[di]) { nodes = extra[di].nodes; costsM = extra[di].costM; }
    if (!nodes || !nodes.length) continue;
    for (let k = 0; k < nodes.length; k++) out.push({ node: nodes[k], c: costsM[k], door: di, role });
  }
  return out;
}

// js/wayfind.js's doorSet(): role:main wins where a building has one.
function doorSetFor(g, code) {
  const all = (g.code[code] || []).filter(di => g.doors[di][2] && g.doors[di][2].length);
  const mains = all.filter(di => g.doors[di][4] === 'main');
  return mains.length ? mains : all;
}

function routeBetween(g, WF, fromDoors, toDoors, avoidStairs, extra) {
  const seeds = anchors(g, fromDoors, 'from', extra);
  const targets = anchors(g, toDoors, 'to', extra);
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

// Equirectangular metres at campus latitude — the same approximation
// js/wayfind.js routes with, so the score cannot disagree with the router about
// what a metre is.
const MPD_LAT = 111320, MPD_LON = 111320 * Math.cos(30.285 * Math.PI / 180);
const metres = (a, b) => Math.hypot((a[0] - b[0]) * MPD_LON, (a[1] - b[1]) * MPD_LAT);

// ══════════════════════════════════════════════════════════════════════════
// The run
// ══════════════════════════════════════════════════════════════════════════
const graphRes = await fetch(`${BASE}/data/walk_graph.json`);
if (!graphRes.ok) {
  console.error(`Cannot fetch ${BASE}/data/walk_graph.json: ${graphRes.status}`);
  process.exit(2);
}
const raw = await graphRes.json();
const g = decode(raw);
const WF = makeConsts(raw);
const doorLL = di => [g.doors[di][0] * g.q, g.doors[di][1] * g.q];

const URL = `${BASE}/index.html?walk=1&drift=0&intro=0`;
const browser = await launch(chromium, { maxMs: 540000 });

async function ready(page) {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
  // Correctness, not speed: the auto-detect probe rewrites every graphics
  // setting ~11 s in (CLAUDE.md verification rule 10).
  await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
  await page.waitForFunction(() => !document.getElementById('veil'), null, { timeout: 120000 });
  await page.waitForFunction(() => typeof window.wayfindRoute === 'function', null, { timeout: 60000 });
}

/**
 * One pass over the pair list. `flags` is applied to window.WAYFIND first, and
 * each pass gets its OWN PAGE LOAD on purpose: virtualDoor() memoises its
 * REFUSALS as well as its hits, so flipping utVirtualDoors on inside a page
 * that already ran with it off keeps every refusal it cached. Do not
 * "optimise" that away — it cost a wrong number once.
 */
async function pass(label, flags) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  await ready(page);

  const cap = await page.evaluate(f => {
    if (window.WAYFIND) Object.assign(window.WAYFIND, f);
    return {
      utTable: typeof window.wayfindUTDoors === 'function',
      doorAt: typeof window.wayfindDoorAt === 'function',
      doorsOf: typeof window.wayfindDoors === 'function',
      flags: window.WAYFIND ? {
        useUTSurvey: window.WAYFIND.useUTSurvey, utVirtualDoors: window.WAYFIND.utVirtualDoors,
        widenSideDoors: window.WAYFIND.widenSideDoors, utDoorMatchM: window.WAYFIND.utDoorMatchM,
        utVirtualSnapM: window.WAYFIND.utVirtualSnapM, sideDoorPenaltyM: window.WAYFIND.sideDoorPenaltyM,
        utVirtualStepFree: window.WAYFIND.utVirtualStepFree,
      } : null,
    };
  }, flags);

  const rows = [];
  let selfCheckFail = 0, pairErrors = 0, correctedMissing = 0;
  const extraDoors = {};      // door index -> record, for doors only this tab has

  for (const p of PAIRS) {
    const id = p.id || `${p.from}-${p.to}`.toLowerCase();
    const appR = await page.evaluate(async ([f, t, hasDoorAt]) => {
      const r = await window.wayfindRoute(f, t, {});
      if (!r || !r.ok) return { ok: false, why: r ? r.why : 'null' };
      const at = hasDoorAt ? window.wayfindDoorAt : null;
      const a = at ? at(r.fromDoor) : null, b = at ? at(r.toDoor) : null;
      // UT's own coordinates for both ends, when this build ships the table.
      const ut = typeof window.wayfindUTDoors === 'function'
        ? { from: window.wayfindUTDoors(r.fromCode), to: window.wayfindUTDoors(r.toCode) } : null;
      return {
        ok: true, distM: r.distM, fromDoor: r.fromDoor, toDoor: r.toDoor,
        fromRole: r.fromRole, toRole: r.toRole, fromSrc: r.fromSrc, toSrc: r.toSrc,
        fromCode: r.fromCode, toCode: r.toCode,
        fromLinkM: r.fromLinkM, toLinkM: r.toLinkM,
        stairSets: r.stairSets, lo: r.lo, hi: r.hi,
        fromAt: a, toAt: b, ut,
      };
    }, [p.from, p.to, cap.doorAt]);

    if (!appR.ok) {
      console.error(`PAIR ${id}: app route FAILED (${appR.why})`);
      pairErrors++;
      rows.push({ ...p, id, error: appR.why });
      continue;
    }
    if (appR.fromAt && appR.fromAt.virtual) extraDoors[appR.fromDoor] = appR.fromAt;
    if (appR.toAt && appR.toAt.virtual) extraDoors[appR.toDoor] = appR.toAt;

    // ── self-check ────────────────────────────────────────────────────────
    // Replay the SAME doors the app picked through the local reimplementation
    // and require the distance to agree with what the browser itself reported.
    const localApp = routeBetween(g, WF, [appR.fromDoor], [appR.toDoor], false, extraDoors);
    const drift = localApp ? Math.abs(localApp.distM - appR.distM) : Infinity;
    const virtualEnds = (appR.fromAt && appR.fromAt.virtual ? 1 : 0) + (appR.toAt && appR.toAt.virtual ? 1 : 0);
    if (!localApp || drift > EPS_M) {
      console.error(`PAIR ${id}: SELF-CHECK FAILED -- browser distM=${appR.distM && appR.distM.toFixed(1)} ` +
        `local reimpl=${localApp ? localApp.distM.toFixed(1) : 'null'} drift=${drift.toFixed(2)}m ` +
        `(limit ${EPS_M}m; ${virtualEnds} run-time door(s) on this pair)`);
      selfCheckFail++;
    }

    // ── A. route-length extra ─────────────────────────────────────────────
    // Force the ground-truth door where walk-pairs.json names one, otherwise
    // fall back to the SAME doorSet the app used (never invent an improvement
    // on an endpoint we have no ground truth for).
    const fromDoors = p.fromDoorCorrect != null ? [p.fromDoorCorrect] : doorSetFor(g, p.from);
    const toDoors = p.toDoorCorrect != null ? [p.toDoorCorrect] : doorSetFor(g, p.to);
    const corrected = routeBetween(g, WF, fromDoors, toDoors, false);
    // A GROUND-TRUTH DOOR THAT WILL NOT ROUTE IS A HOLE IN THE BAKE, NOT A
    // FAILING BRANCH, and it must not take metric B down with it. BIO's
    // UT-matched door (index 286) carries empty node/cost arrays in
    // data/walk_graph.json — it was never snapped to the path network, which
    // docs/walk-baseline.md §2 found and flagged for the bake lane. Metric A is
    // unmeasurable for that pair by construction; metric B still is not, and it
    // is the pair where the door choice matters most. So: warn, count it as
    // unmeasurable, and keep scoring the half that is real. Only a self-check
    // failure or an app route that dies is an exit-1.
    if (!corrected) {
      console.error(`PAIR ${id}: metric A unmeasurable — the ground-truth door is ` +
        `not anchored to the network in this bake (a hole in data/walk_graph.json, not a route failure)`);
      correctedMissing++;
    }

    // ── B. door-offset extra ──────────────────────────────────────────────
    // Where the walk actually ENDED, versus where UT says the entrance is. The
    // oracle is UT's own coordinates when the page ships them, and the pair
    // file's matched graph door otherwise.
    //
    // BOTH ORACLES ARE SCORED WHENEVER BOTH EXIST, because they do not cover
    // the same ends and a single column would silently change its denominator
    // between branches. The page oracle knows UT's coordinate for every
    // building UT surveyed (36 of the 40 ends here); the pair-file oracle knows
    // only the ends someone matched offline (28 of 40) — but it is the ONLY one
    // available against a checkout with no UT table, so it is what makes an
    // origin/main-versus-branch comparison apples to apples.
    const whereIs = (at, di) => (at ? at.ll : (g.doors[di] ? doorLL(di) : null));
    const offToUT = (here, utRows) => {
      if (!here || !utRows || !utRows.length) return null;
      let best = Infinity;
      for (const t of utRows) best = Math.min(best, metres(here, [t.lon, t.lat]));
      return best;
    };
    const offToPair = (here, correctIdx) =>
      (here && correctIdx != null && g.doors[correctIdx]) ? metres(here, doorLL(correctIdx)) : null;

    const fromLL = whereIs(appR.fromAt, appR.fromDoor), toLL = whereIs(appR.toAt, appR.toDoor);
    const fromPairM = offToPair(fromLL, p.fromDoorCorrect), toPairM = offToPair(toLL, p.toDoorCorrect);
    const fromErrM = offToUT(fromLL, appR.ut && appR.ut.from) ?? fromPairM;
    const toErrM = offToUT(toLL, appR.ut && appR.ut.to) ?? toPairM;
    const scoredEnds = (fromErrM != null ? 1 : 0) + (toErrM != null ? 1 : 0);
    const scoredEndsPair = (fromPairM != null ? 1 : 0) + (toPairM != null ? 1 : 0);

    const extraRouteM = corrected ? appR.distM - corrected.distM : null;
    rows.push({
      ...p, id,
      appDistM: appR.distM, appFromDoor: appR.fromDoor, appToDoor: appR.toDoor,
      appFromRole: appR.fromRole, appToRole: appR.toRole,
      appFromSrc: appR.fromSrc, appToSrc: appR.toSrc,
      appFromLinkM: appR.fromLinkM, appToLinkM: appR.toLinkM,
      minutes: `${appR.lo}-${appR.hi}`, appStairSets: appR.stairSets,
      correctedDistM: corrected ? corrected.distM : null,
      correctedFromDoor: corrected ? corrected.fromDoor : null,
      correctedToDoor: corrected ? corrected.toDoor : null,
      stairSets: corrected ? corrected.stairSets : null,
      signals: corrected ? corrected.signals : null,
      extraM: extraRouteM, selfCheckDriftM: drift, virtualEnds,
      fromErrM, toErrM, scoredEnds,
      doorExtraM: (fromErrM || 0) + (toErrM || 0),
      atDoor: (fromErrM != null && fromErrM <= AT_THE_DOOR_M ? 1 : 0) +
              (toErrM != null && toErrM <= AT_THE_DOOR_M ? 1 : 0),
      fromPairM, toPairM, scoredEndsPair,
      doorExtraPairM: (fromPairM || 0) + (toPairM || 0),
      atDoorPair: (fromPairM != null && fromPairM <= AT_THE_DOOR_M ? 1 : 0) +
                  (toPairM != null && toPairM <= AT_THE_DOOR_M ? 1 : 0),
    });
    console.log(`${id.padEnd(10)} app=${appR.distM.toFixed(0).padStart(4)}m  ` +
      `corrected=${(corrected ? corrected.distM.toFixed(0) : '  —').padStart(4)}m  ` +
      `routeExtra=${(corrected ? extraRouteM.toFixed(0) : '  —').padStart(5)}m  ` +
      `doorExtra=${((fromErrM || 0) + (toErrM || 0)).toFixed(1).padStart(6)}m  ` +
      `stairSets=${corrected ? corrected.stairSets : '—'}  drift=${drift.toFixed(2)}m`);
  }

  // ── the stronger door test, because a pair list can be lucky ────────────
  // Score the door choice on EVERY building UT surveyed that this build can
  // route to, not only the forty ends the pairs happen to name. Only possible
  // where the page ships the UT table.
  let all = [], stairs = [], reach = [];
  if (cap.utTable && cap.doorsOf) {
    const audit = await page.evaluate(async ({ AT, HUBS }) => {
      const MPD_LAT = 111320, MPD_LON = 111320 * Math.cos(30.285 * Math.PI / 180);
      const m = (a, b) => Math.hypot((a[0] - b[0]) * MPD_LON, (a[1] - b[1]) * MPD_LAT);
      // wayfindUTDoors is deliberately NOT gated on useUTSurvey — the held-out
      // pass turns the survey off inside the ROUTER and still has to score
      // itself against it, so the oracle must survive its own master switch.
      const oracle = code => window.wayfindUTDoors(code) || [];

      const all = [];
      for (const code of window.wayfindUTDoors().codes) {
        const d = await window.wayfindDoors(code);
        if (!d || !d.doors || !d.doors.length) { all.push({ code, routable: false }); continue; }
        const ut = oracle(code);
        if (!ut.length) { all.push({ code, routable: true, ut: 0 }); continue; }
        // WORST candidate, not best. doorSet() hands all of these to Dijkstra
        // and any one of them can be the door you are sent to, so the honest
        // score for a building is the worst door it might pick.
        let worst = 0, bestOfSet = Infinity;
        for (const dd of d.doors) {
          let best = Infinity;
          for (const t of ut) best = Math.min(best, m(dd.ll, [t.lon, t.lat]));
          worst = Math.max(worst, best);
          bestOfSet = Math.min(bestOfSet, best);
        }
        all.push({ code, routable: true, ut: ut.length, worstM: worst, bestM: bestOfSet,
                   n: d.doors.length, ok: worst <= AT });
      }

      // ── the accessibility claim, measured rather than repeated ───────────
      // UT records BarrierFree per DOOR, and several buildings have both kinds:
      // Batts Hall's north entrance is up a flight with no auto-opener while
      // its east and southwest entrances are barrier-free. With the toggle ON,
      // no candidate door may be nearer a door UT marked BarrierFree=N than one
      // it marked Y.
      const stairs = [];
      for (const code of window.wayfindUTDoors().codes) {
        const ut = oracle(code);
        if (ut.length < 2) continue;
        if (!ut.some(t => t.bf) || !ut.some(t => !t.bf)) continue;  // nothing to choose between
        const off = await window.wayfindDoors(code, false);
        const on = await window.wayfindDoors(code, true);
        if (!off || !on || !on.doors.length) { stairs.push({ code, routable: false }); continue; }
        const kind = dd => {
          let best = null, bd = Infinity;
          for (const t of ut) { const d = m(dd.ll, [t.lon, t.lat]); if (d < bd) { bd = d; best = t; } }
          return { bf: !!(best && best.bf), d: bd };
        };
        const onKinds = on.doors.map(kind), offKinds = off.doors.map(kind);
        stairs.push({
          code, routable: true, utDoors: ut.length,
          offN: off.doors.length, onN: on.doors.length,
          offBad: offKinds.filter(k => !k.bf).length,
          onBad: onKinds.filter(k => !k.bf).length,
          pass: onKinds.every(k => k.bf),
        });
      }

      // ── can you GET there at all without stairs? ─────────────────────────
      // Choosing a barrier-free door is worthless if the walk to it is refused.
      // A door snapped to a walkable node can still sit on an island whose every
      // exit is a staircase. Routed from two step-free hubs at opposite ends of
      // campus so the count cannot be an artefact of one origin, and measured
      // BOTH WAYS: utVirtualStepFree off reproduces the bug rather than
      // describing it. Safe to flip mid-page only because virtualDoor()'s cache
      // key carries the mode.
      const reach = [];
      const keepSF = window.WAYFIND.utVirtualStepFree;
      for (const code of window.wayfindUTDoors().codes) {
        const d = await window.wayfindDoors(code, true);
        if (!d || !d.doors || !d.doors.length) continue;
        const probe = async () => {
          for (const h of HUBS) {
            if (h === code) return true;
            const r = await window.wayfindRoute(h, code, { avoidStairs: true });
            if (r && r.ok) return true;
          }
          return false;
        };
        window.WAYFIND.utVirtualStepFree = true;
        const on = await probe();
        window.WAYFIND.utVirtualStepFree = false;
        const off = await probe();
        window.WAYFIND.utVirtualStepFree = keepSF;
        let anyWay = false;
        for (const h of HUBS) {
          if (h === code) { anyWay = true; break; }
          const r = await window.wayfindRoute(h, code, { avoidStairs: false });
          if (r && r.ok) { anyWay = true; break; }
        }
        reach.push({ code, stepFree: on, stepFreeBefore: off, anyWay });
      }
      window.WAYFIND.utVirtualStepFree = keepSF;
      window.wayfindClear && window.wayfindClear();
      return { all, stairs, reach };
    }, { AT: AT_THE_DOOR_M, HUBS: ['PCL', 'JES'] });
    all = audit.all; stairs = audit.stairs; reach = audit.reach;
  }

  await page.close();
  return { label, cap, rows, all, stairs, reach, errs, selfCheckFail, pairErrors, correctedMissing };
}

// ══════════════════════════════════════════════════════════════════════════
// THE LIVE UI GATE — a real mouse, on the real checkbox.
// ══════════════════════════════════════════════════════════════════════════
async function uiGate(shotDir) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  await ready(page);

  const r0 = await page.evaluate(
    p => window.wayfindRoute(p.from, p.to, { expand: true }), UI_GATE_PAIR);
  const boxOf = () => page.evaluate(() => {
    const cb = document.querySelector('#wf-card .wf-toggle input[type=checkbox]');
    if (!cb) return null;
    const r = cb.getBoundingClientRect();
    return {
      checked: cb.checked, x: r.x + r.width / 2, y: r.y + r.height / 2,
      cardHidden: document.getElementById('wf-card').classList.contains('hidden'),
      headline: document.getElementById('wf-headline').textContent,
    };
  });
  const before = await boxOf();
  if (!before) { await page.close(); return { ok: false, why: 'no checkbox in the card', errs }; }
  if (shotDir) await page.screenshot({ path: path.join(shotDir, 'ui-stairs-before.png') });

  await page.mouse.click(before.x, before.y);
  await page.waitForTimeout(400);
  const on = await boxOf();
  if (shotDir && on) await page.screenshot({ path: path.join(shotDir, 'ui-stairs-on.png') });

  // And back off again, because a toggle that only latches is still broken.
  let off = null;
  if (on) {
    await page.mouse.click(on.x, on.y);
    await page.waitForTimeout(400);
    off = await boxOf();
  }
  // THE OTHER HALF OF THE SAME FIX, and the thing it could plausibly have
  // broken. Controls inside the pill no longer collapse it — so the pill's own
  // text had better still do exactly that, in both directions. Clicking the
  // headline is the whole expand/collapse gesture; if the guard were too wide
  // the card would be stuck open and nobody would notice from the numbers.
  const clickHeadline = async () => {
    const b = await page.evaluate(() => {
      const h = document.getElementById('wf-headline');
      const r = h.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await page.mouse.click(b.x, b.y);
    await page.waitForTimeout(250);
    return page.evaluate(() => !document.getElementById('wf-card').classList.contains('hidden'));
  };
  const openBefore = await page.evaluate(() => !document.getElementById('wf-card').classList.contains('hidden'));
  const collapsed = await clickHeadline();
  const reopened = await clickHeadline();
  const pillToggles = openBefore === true && collapsed === false && reopened === true;

  const api = await page.evaluate(
    p => window.wayfindRoute(p.from, p.to, { avoidStairs: true }), UI_GATE_PAIR);

  await page.close();
  const boxOk = !!(on && on.checked === true && !on.cardHidden && on.headline !== before.headline &&
    off && off.checked === false && !off.cardHidden && off.headline === before.headline);
  const ok = boxOk && pillToggles;
  return {
    ok, boxOk, pillToggles, pair: UI_GATE_PAIR, before, on, off, errs,
    why: ok ? null : (!on ? 'the card was destroyed by the click'
      : on.checked !== true ? 'the box did not tick'
      : on.cardHidden ? 'the card collapsed'
      : on.headline === before.headline ? 'the route did not change'
      : !off || off.checked !== false ? 'it would not turn back off'
      : 'the pill itself no longer expands and collapses'),
    api: api && api.ok ? { distM: api.distM, stairSets: api.stairSets } : null,
    r0: r0 && r0.ok ? { distM: r0.distM, stairSets: r0.stairSets } : null,
  };
}

const SHOT_DIR = opt('--shots', null);
if (SHOT_DIR) { try { fs.mkdirSync(SHOT_DIR, { recursive: true }); } catch (e) {} }
const shipped = await pass('SHIPPED', DOORS_ON);
const baseline = DO_BASELINE ? await pass('BASELINE', DOORS_OFF) : null;
const ui = DO_UI ? await uiGate(SHOT_DIR) : null;
await browser.__done();

// ══════════════════════════════════════════════════════════════════════════
// Report
// ══════════════════════════════════════════════════════════════════════════
const sum = a => a.reduce((x, y) => x + y, 0);
function score(p) {
  if (!p) return null;
  // TWO DENOMINATORS, ON PURPOSE. `rt` is the pairs metric A could measure —
  // a pair whose ground-truth door has no anchor in the bake drops out of A and
  // must not silently drop out of B as well. `dr` is every pair that routed.
  const rt = p.rows.filter(r => r.extraM != null);
  const dr = p.rows.filter(r => !r.error);
  const route = rt.map(r => r.extraM);
  const sortedR = route.slice().sort((a, b) => a - b);
  const door = dr.map(r => r.doorExtraM);
  const routable = p.all.filter(a => a.routable && a.ut);
  const worst = routable.map(a => a.worstM);
  return {
    pairsRouted: dr.length, pairsScoredA: rt.length, pairsFail: p.rows.length - dr.length,
    routeExtraTotalM: sum(route.map(v => Math.max(0, v))),
    routeExtraSignedM: sum(route),
    routeExtraMedianM: sortedR.length ? (sortedR.length % 2 ? sortedR[(sortedR.length - 1) / 2]
      : (sortedR[sortedR.length / 2 - 1] + sortedR[sortedR.length / 2]) / 2) : 0,
    routeWorst: rt.reduce((w, r) => (!w || r.extraM > w.extraM) ? r : w, null),
    doorExtraTotalM: sum(door), doorExtraMeanM: door.length ? sum(door) / door.length : 0,
    doorWorstPairM: door.length ? Math.max(...door) : 0,
    atDoor: sum(dr.map(r => r.atDoor)), endsScored: sum(dr.map(r => r.scoredEnds)),
    doorExtraPairTotalM: sum(dr.map(r => r.doorExtraPairM)),
    atDoorPair: sum(dr.map(r => r.atDoorPair)), endsScoredPair: sum(dr.map(r => r.scoredEndsPair)),
    meanRouteM: dr.length ? sum(dr.map(r => r.appDistM)) / dr.length : 0,
    buildings: routable.length,
    meanWorstDoorM: worst.length ? sum(worst) / worst.length : 0,
    allInside: routable.filter(a => a.ok).length,
  };
}
const B = score(shipped), A = score(baseline);
const f1 = n => (n == null ? '   —' : n.toFixed(1));
const col = (a, b, unit = ' m') => `${(A ? f1(a) : '   —').padStart(9)}${unit} ${f1(b).padStart(11)}${unit}`;

const oracleName = shipped.cap.utTable
  ? "UT's own coordinates, read off the page (window.wayfindUTDoors)"
  : 'walk-pairs.json\'s matched door indices (this build ships no UT table)';

console.log('');
console.log('='.repeat(76));
console.log('walkmeter');
console.log(`  page      ${URL}`);
console.log(`  pairs     ${PAIRS.length} from ${path.basename(PAIRS_FILE)}`);
console.log(`  oracle    ${oracleName}`);
console.log(`  "at the door" = within ${AT_THE_DOOR_M} m of a door UT publishes`);
if (shipped.cap.flags) console.log(`  flags     ${JSON.stringify(shipped.cap.flags)}`);
console.log('='.repeat(76));
console.log('');
console.log('  A. ROUTE-LENGTH EXTRA — metres of pavement the chosen door costs');
console.log(`                                        ${A ? '  doors off' : '           '}       shipped`);
console.log(`    total, over pairs it makes worse    ${col(A && A.routeExtraTotalM, B.routeExtraTotalM)}`);
console.log(`    signed total (credit for the rest)  ${col(A && A.routeExtraSignedM, B.routeExtraSignedM)}`);
console.log(`    median per pair                     ${col(A && A.routeExtraMedianM, B.routeExtraMedianM)}`);
if (B.routeWorst) console.log(`    worst offender                      ${(B.routeWorst.id + ' +' + B.routeWorst.extraM.toFixed(0) + ' m').padStart(25)}`);
console.log('');
console.log('  B. DOOR-OFFSET EXTRA — metres from the door UT publishes');
console.log(`    total over ${B.pairsRouted} routed pairs, both ends ${col(A && A.doorExtraTotalM, B.doorExtraTotalM)}`);
console.log(`    mean per pair                       ${col(A && A.doorExtraMeanM, B.doorExtraMeanM)}`);
console.log(`    worst single pair                   ${col(A && A.doorWorstPairM, B.doorWorstPairM)}`);
console.log(`    ends at the right door              ${(A ? A.atDoor + '/' + A.endsScored : '—').padStart(11)} ${(B.atDoor + '/' + B.endsScored).padStart(13)}`);
console.log(`    mean route length                   ${col(A && A.meanRouteM, B.meanRouteM)}`);
// The same metric on the pair file's own oracle only — a smaller set of ends,
// but the SAME set on every branch, so this is the column that compares a build
// with the UT table against one without it.
console.log(`    on the pair-file oracle alone       ${col(A && A.doorExtraPairTotalM, B.doorExtraPairTotalM)}`);
console.log(`      ends at the right door            ${(A ? A.atDoorPair + '/' + A.endsScoredPair : '—').padStart(11)} ${(B.atDoorPair + '/' + B.endsScoredPair).padStart(13)}`);
if (B.buildings) {
  console.log('');
  console.log('  EVERY BUILDING UT SURVEYED (a pair list can be lucky)');
  console.log(`    routable buildings scored           ${(A ? String(A.buildings) : '—').padStart(11)} ${String(B.buildings).padStart(13)}`);
  console.log(`    mean WORST-case door error          ${col(A && A.meanWorstDoorM, B.meanWorstDoorM)}`);
  console.log(`    every candidate inside ${AT_THE_DOOR_M} m         ${(A ? A.allInside + '/' + A.buildings : '—').padStart(11)} ${(B.allInside + '/' + B.buildings).padStart(13)}`);
}
console.log('');
console.log('  per pair');
console.log('    pair          routeExtra    doorExtra    route  doors        drift');
for (let i = 0; i < PAIRS.length; i++) {
  const r = shipped.rows[i];
  const nm = `${PAIRS[i].from}->${PAIRS[i].to}`.padEnd(12);
  if (!r || r.error) { console.log(`    ${nm}  ERROR (${r ? r.error : 'null'})`); continue; }
  const b = baseline && baseline.rows[i];
  const trend = b && b.doorExtraM != null
    ? (r.doorExtraM < b.doorExtraM - 0.5 ? `  better (was ${b.doorExtraM.toFixed(1)} m)`
      : r.doorExtraM > b.doorExtraM + 0.5 ? `  WORSE (was ${b.doorExtraM.toFixed(1)} m)` : '  =')
    : '';
  console.log(`    ${nm} ${f1(r.extraM).padStart(9)} m ${f1(r.doorExtraM).padStart(9)} m ` +
    `${String(Math.round(r.appDistM)).padStart(5)} m  ` +
    `${(String(r.appFromSrc || '?') + '/' + String(r.appToSrc || '?')).padEnd(12)}` +
    ` ${r.selfCheckDriftM.toFixed(2)} m${trend}`);
}

if (shipped.stairs.length) {
  console.log('');
  console.log('  "AVOID STAIRS" AT THE DOOR (buildings where UT records both kinds)');
  const st = shipped.stairs.filter(s => s.routable);
  for (const s of st) {
    console.log(`    ${s.code.padEnd(5)} UT doors ${s.utDoors}   candidates ${s.offN} -> ${s.onN}` +
      `   non-barrier-free among them ${s.offBad} -> ${s.onBad}   ${s.pass ? 'ok' : 'STILL SENDS YOU UP THE STEPS'}`);
  }
  console.log(`    ${st.filter(s => s.pass).length}/${st.length} clean; ` +
    `${st.filter(s => s.offBad > 0).length} of them would have offered a stepped door with the toggle off`);
}
if (shipped.reach.length) {
  const rc = shipped.reach;
  const stranded = rc.filter(r => r.anyWay && !r.stepFree);
  const strandedBefore = rc.filter(r => r.anyWay && !r.stepFreeBefore);
  console.log(`    reachable step-free from a hub   ${String(rc.filter(r => r.stepFreeBefore).length + '/' + rc.length).padStart(11)} ${String(rc.filter(r => r.stepFree).length + '/' + rc.length).padStart(13)}   (utVirtualStepFree off -> on)`);
  console.log(`    stranded before: ${strandedBefore.map(r => r.code).join(' ') || 'none'}   after: ${stranded.map(r => r.code).join(' ') || 'none'}`);
}
if (shipped.all.length) {
  const regress = shipped.all.filter(a => a.routable && a.ut && !a.ok);
  console.log('');
  console.log(`  buildings still outside ${AT_THE_DOOR_M} m: ${regress.length ? regress.map(r => `${r.code} ${f1(r.worstM)} m`).join(', ') : 'none'}`);
  const notRoutable = shipped.all.filter(a => !a.routable).map(a => a.code);
  console.log(`  UT buildings this build cannot route to at all (${notRoutable.length}): ${notRoutable.join(' ') || 'none'}`);
  // Not a shortfall, and checked rather than assumed (docs/walk-door.md round 3
  // §4): ten of these are at the J.J. Pickle Research Campus, latitude
  // 30.38-30.39, about 11 km north of the Forty Acres and outside everything
  // this app draws. The eleventh, SSW, is absent from UT's own 198-code Main
  // Campus register too.
  console.log('    (10 of those are 11 km north at the Pickle campus, off this map; SSW is not in UT\'s own register)');
}

if (ui) {
  console.log('');
  console.log('  LIVE UI GATE — a real mouse click on the "Avoid stairs" checkbox');
  console.log(`    pair                  ${ui.pair ? ui.pair.from + ' -> ' + ui.pair.to : '—'}`);
  if (ui.before) console.log(`    before                checked=${ui.before.checked}  "${ui.before.headline}"`);
  if (ui.on) console.log(`    after one click       checked=${ui.on.checked}  card open=${!ui.on.cardHidden}  "${ui.on.headline}"`);
  if (ui.off) console.log(`    after clicking back   checked=${ui.off.checked}  card open=${!ui.off.cardHidden}  "${ui.off.headline}"`);
  if (ui.api) console.log(`    same route via the API with avoidStairs:true — ${ui.api.distM.toFixed(0)} m, ${ui.api.stairSets} stair sets`);
  console.log(`    clicking the pill's own text still collapses and reopens the card: ${ui.pillToggles ? 'yes' : 'NO'}`);
  console.log(`    ${ui.ok ? 'PASS  the checkbox turns the routing on AND back off, and the pill still toggles' : 'FAIL  ' + ui.why}`);
}

const allErrs = [...shipped.errs, ...(baseline ? baseline.errs : []), ...(ui ? ui.errs : [])];
if (allErrs.length) console.log('\n  PAGE ERRORS:\n    ' + allErrs.slice(0, 8).join('\n    '));

// scripts/verify/out/ is gitignored -- this is a regenerable run artifact, not
// a deliverable. Re-run the script to reproduce it against any branch.
const outJson = JSON_OUT ? path.resolve(JSON_OUT) : path.resolve(__dirname, 'out', 'walkmeter-last-run.json');
try { fs.mkdirSync(path.dirname(outJson), { recursive: true }); } catch (e) {}
fs.writeFileSync(outJson, JSON.stringify({
  base: BASE, at: new Date().toISOString(), atDoorM: AT_THE_DOOR_M, oracle: oracleName,
  shipped: { ...B, flags: shipped.cap.flags, rows: shipped.rows, all: shipped.all,
             stairs: shipped.stairs, reach: shipped.reach },
  baseline: A && { ...A, flags: baseline.cap.flags, rows: baseline.rows, all: baseline.all },
  ui,
}, null, 1));
console.log(`\n  full per-pair JSON written to ${outJson}`);

// What counts as a FAILED RUN, and what is merely a hole in the data. A
// self-check drift means this script's Dijkstra no longer matches the router
// and every number above is void. An app route that dies means the feature is
// broken. A UI gate that fails means the control does not work. Those are
// exit-1. A ground-truth door that is not anchored to the network is a gap in
// data/walk_graph.json — reported loudly, counted, and NOT an exit-1, because
// failing the run for it would make an unrelated bake gap look like this
// branch's regression.
const fail = shipped.selfCheckFail + shipped.pairErrors +
  (baseline ? baseline.selfCheckFail + baseline.pairErrors : 0) + (ui && !ui.ok ? 1 : 0);
if (shipped.correctedMissing) {
  console.log(`\n  NOTE: metric A unmeasurable on ${shipped.correctedMissing} pair(s) — ` +
    `their ground-truth door has no anchor in data/walk_graph.json. Metric B still scored. ` +
    `Not a failure of this branch; see docs/walk-baseline.md §2.`);
}
console.log(`\n  ${fail ? 'FAIL' : 'PASS'}  self-check drift ${shipped.selfCheckFail} over limit, ` +
  `${shipped.pairErrors} route error(s)${ui ? ', UI gate ' + (ui.ok ? 'pass' : 'FAIL') : ''}`);
process.exit(fail ? 1 : 0);
