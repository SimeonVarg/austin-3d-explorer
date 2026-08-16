/**
 * wayfind.js — "I am here, my next class is in WEL". One field, one pill, one
 * ribbon painted on the real city.
 *
 * ── THE THREE DOCUMENTS THIS FILE OBEYS ─────────────────────────────────────
 *   docs/walk/what-we-can-honestly-say.md   WHAT IT MAY SAY.  Outranks
 *                                           everything else, including the
 *                                           interface doc, on every question of
 *                                           wording. Every string the user can
 *                                           read lives in the SAY block below
 *                                           and is quoted from §11 of that file.
 *   docs/walk/graph.md                      what the graph is and what it costs.
 *   docs/walk/interface.md                  what it looks like.
 *
 * `interface.md` was written on 2026-08-06 and the honesty audit on 2026-08-15,
 * and the audit CONTRADICTS it in three places. The audit wins, every time:
 *
 *   interface.md said            this file ships
 *   ------------------------     -----------------------------------------
 *   `9 min`                      `6-8 min walk`  — a single number has no
 *                                error bar; §3 of the audit forbids it.
 *   `2 flights up`               `Stairs: 2 sets` — nothing in OSM records a
 *                                landing, so a "flight" is not in the data.
 *   `Step-free: 15 min`          `Avoid stairs`  — "step-free" sounds
 *                                descriptive and reads as a guarantee, and
 *                                1.4 % wheelchair coverage cannot back it.
 *
 * The word "uphill" appears nowhere in the interface and cannot: there is no
 * elevation source in this repo at all. That half of the original pitch does
 * not exist yet and pretending otherwise is the one failure this feature is not
 * allowed to have.
 *
 * ── OFF MEANS OFF, AND THAT IS THE POINT ────────────────────────────────────
 * `main` is being screen-recorded for AWS. So the whole module returns on line
 * one unless it is explicitly asked for:
 *
 *     ?walk=1        open the feature
 *     ?from=&to=     route on load (implies walk=1)
 *     WAYFIND.on     the constant that ships the button to everyone. FALSE
 *                    today, on purpose — flip it after the shoot.
 *
 * With none of those, this file adds NO dom, NO map source, NO map layer, NO
 * network request and NO event listener. That is not an argument, it is
 * `scripts/verify/` diffing the two frames; see HANDOFF.
 *
 * ── THE COSTLY THING IS THE GRAPH, SO IT IS NOT FETCHED AT BOOT ─────────────
 * `data/walk_graph.json` is 328 KB raw / 98 KB gzipped and parses in ~1.4 ms.
 * Affordable is not free and it is not proven, so it is fetched on the FIRST
 * OPEN of the panel and never before. Opening the app and never touching the
 * button costs exactly what it costs today.
 *
 * ── HOW THE ROUTE IS DRAWN, AND THE ONE TRICK IN IT ─────────────────────────
 * MapLibre line layers do not depth-test against fill-extrusions; their draw
 * order IS their layer order. So the SAME line geometry is added twice — once
 * under `buildings-3d` and once over it. Under gives a solid ribbon on open
 * ground; over gives a faint dashed hint where the path runs behind a wall. You
 * always know where the route goes and you are never fooled into thinking you
 * can walk through the building. One extra layer, no new render pass, and it is
 * the whole occlusion design.
 *
 * The last leg — walk network to door — is a straight line across whatever is
 * actually there, so it is drawn DASHED and lighter than the routed path. The
 * picture itself tells the truth about which part is surveyed.
 *
 * Public (window) API:
 *   wayfindRoute(from, to, opts)  — resolve two strings and route; returns the
 *                                   answer object (async). Used by the verify
 *                                   scripts as well as by the UI.
 *   wayfindSearch(str)            — the match ladder, for testing
 *   wayfindStats()                — graph health + the last query's timings
 *   wayfindClear()                — remove the drawn route
 *   WAYFIND                       — the taste block (below)
 */
(function () {
  'use strict';

  const q = new URLSearchParams(window.location.search);

  // ══════════════════════════════════════════════════════════════════════════
  // TASTE BLOCK — CLAUDE.md rule 11. Every aesthetic and behavioural judgement
  // in this file is one line here. Nothing below invents a number.
  // ══════════════════════════════════════════════════════════════════════════
  const WAYFIND = {
    // THE SHIP SWITCH. False = the button does not exist for anyone who has not
    // asked for it by URL, so the app a stranger loads is byte-identical to
    // today's. Flip to true after the AWS recording and the feature is live for
    // everyone with no other change.
    on: false,

    // ── the ribbon ────────────────────────────────────────────────────────
    routeWidthM: 1.6,      // ground metres — a pavement slab under your feet
    // NOT A TASTE VALUE, AND THE SECOND HALF OF THE SAME BUG. js/ground.js
    // extrudes its footways as slabs `GROUND.pathRaise` = 0.22 m proud of the
    // ground. The first extruded ribbon was ALSO 0.22 m tall from base 0, so it
    // was exactly coplanar with the pavement it lies on: it appeared from
    // altitude (1,064 px, up from 9) and was still invisible at walking height,
    // because at eye level you are looking along a coplanar pair and the
    // pavement wins. So the ribbon now STARTS at the pavement's own top surface
    // and is a 14 cm thick painted strip resting on it. Keep routeBaseM equal
    // to GROUND.pathRaise if that ever moves.
    routeBaseM: 0.22,
    routeHeightM: 0.36,
    routeMinPx: 3,         // (line layers only — the thread and the ghost)
    routeMaxPx: 90,
    legHeightM: 0.30,      // the unmapped door leg is THINNER and narrower than
                           // the routed path, so the surveyed walk and our own
                           // straight line read as different things even from
                           // directly overhead. Honesty audit §7.
    legWidthMul: 0.7,
    colDay: '#fff4d8',     // warm white on a sunlit city
    colNight: '#ffcf6a',   // warm amber after dark
    ghostOpacity: 0.28,    // the copy that shows through buildings
    ghostDash: [1.6, 1.5],
    ghostWidthMul: 0.55,   // the ghost is thinner than the ribbon it shadows
    ghostMinPx: 1.5,       // but never thinner than a followable line
    ribbonOpacity: 0.95,
    legDash: [1.1, 1.3],
    legOpacity: 0.6,
    casingWidthPx: 1.6,
    casingCol: 'rgba(38,20,4,.55)',
    // The thread: the route seen from altitude, where 1.6 m of ground is under
    // a pixel. Drawn over the city, faded out as you descend into the ribbon.
    threadPx: 3.2,
    threadOpacity: 0.9,
    threadFadeZoom: 17.2,
    threadGoneZoom: 18.4,

    // ── the marks ─────────────────────────────────────────────────────────
    turnMinDeg: 35,        // a vertex only becomes a bead if you really turn
    turnRadiusM: 0.9,
    ringRadiusM: 3.2,      // the pool at the start and at the door
    arriveH: 12,           // metres of column standing on the destination door
    arriveW: 1.2,          // its footprint, metres square
    arriveOpacity: 0.55,
    viaRingCol: '#8fd3ff', // the coffee stop reads as a different kind of thing

    // ── motion ────────────────────────────────────────────────────────────
    pulse: true,           // a bright band runs start -> end, so the ribbon has
    pulseSec: 4,           // a direction without a single arrowhead
    pulseWidth: 0.16,      // fraction of the route the band covers
    pulseFps: 15,          // NOT per frame. Each step is a setPaintProperty, and
                           // a style write every frame forces a full repaint
                           // every frame for as long as a route is on screen.
                           // 15 reads as smooth and costs a seventh of that.
    // QUEUE Z5 — AND 15 A SECOND *FOREVER* WAS STILL THE WORST THING IN THIS
    // FILE. Measured on this laptop's RTX 3050 Ti, headed, real GPU: a drawn
    // route dirtied the style 8-12 times a second and never stopped, including
    // at walking height where the layer it animates is at zero opacity, and
    // including with the tab hidden. On a phone that is a battery drain buying
    // an effect nobody is looking at. The pulse now has a life: it runs while
    // it can be SEEN, and only for as long as it takes to say what it is for.
    pulseSettleSec: 12,    // three full passes at pulseSec 4. The band exists to
                           // show you which way the route runs; after it has run
                           // start-to-end three times it has said that, and it
                           // stops for good until a NEW route is drawn. Raise
                           // this to bring the old forever-behaviour back.
                           // (The gate for "can it be seen at all" is not a new
                           // number: it is `threadGoneZoom` below, the zoom at
                           // which the animated layer's own opacity reaches 0.)
    pulseGapCapMs: 1000,   // the most one frame may charge to that budget. A
                           // stalled main thread should not spend the pulse's
                           // whole life in a single tick; a genuinely slow
                           // renderer (SwiftShader draws this scene at ~3.7 fps
                           // = 270 ms a frame) should count every millisecond,
                           // because that time WAS watched.

    // ── the arithmetic (docs/walk/what-we-can-honestly-say.md §13) ────────
    // Defaults; every one is overwritten at load by walk_graph.json's own
    // `tune` block so the bake and the client can never disagree.
    speedLow: 1.10,        // m/s, the slow end of the printed range
    speedHigh: 1.40,       // m/s, the fast end
    stairSpeed: 0.50,      // m/s along the plan length of a staircase
    stairFixedS: 4.0,      // per staircase, for finding it and turning
    stairUpMult: 1.35,     // going up costs more, where `incline` is known
    signalWaitLowS: 0,     // a green light on arrival
    signalWaitHighS: 45,   // half a cycle on Guadalupe or MLK
    crossingPenaltyM: 8,   // a nudge so the router mildly prefers fewer roads

    // ── the passing period (docs/walk/what-we-can-honestly-say.md §15) ────
    // The question a student is actually asking is not "how do I get there" but
    // "do I have time". §15 rules that we may WARN and may never REASSURE, and
    // this is the number the warning is measured against. It is the ONLY value
    // in this feature with no file behind it: UT's MWF blocks leave ten minutes
    // and its TTh blocks fifteen, so the sentences say "a 15-minute passing
    // period", never "the".
    passingMin: 15,

    // ── search + stops ────────────────────────────────────────────────────
    resultRows: 6,
    codeHeadMinLen: 3,     // QUEUE Z9. A code this long or longer, sitting at
                           // the HEAD of what you typed, is evidence. Two
                           // letters is not: `we` heads WEL, WEB and WCP alike.
    fuzzyMinLen: 4,        // NEVER fuzzy-match a 2-4 letter code: the 1-edit
                           // neighbourhood of WEL contains WCP, WMB and MEL
    detourMaxM: 250,       // a place further off the line is not "on the way"
    viaCandidates: 8,      // how many we actually re-route through
    lastLegNoteM: 25,      // beyond this the pill says the last stretch is ours
    doorLinkMaxM: 30,      // the bake's own door-attach limit, echoed here

    // ── camera ────────────────────────────────────────────────────────────
    // The camera NEVER moves on its own. `?fit=1`, or the button in the card.
    fitPitch: 55,
    fitMs: 1200,
    fitPadPx: 90,
    // QUEUE Z6. `?clip=1&walk=1&from=JES&to=WEL&fit=1` is the URL the docs
    // advertise as "a recordable shot of a route with no chrome", and loaded
    // exactly as written it did not work: our fitBounds landed at t≈2 s and
    // js/app.js's opening flight took the camera back at t≈10 s, so the shot
    // ended on the intro's end pose with the route lying across the rooftops.
    // The camera is not this file's to own, so we WAIT for it rather than
    // fight it. Set fitWaitIntro false to go back to fitting immediately.
    fitWaitIntro: true,
    fitQuietMs: 600,       // camera silence required before the fit departs.
                           // Must exceed the 30 ms gap between the intro's two
                           // legs, or the fit fires into the middle of it.
    fitWaitMaxMs: 30000,   // a stalled intro must never eat the recording: the
                           // ceiling in js/app.js is 18 s of veil + 12.6 s of
                           // flight, so this is that plus a little.
    fitPollMs: 200,

    // ── plumbing ──────────────────────────────────────────────────────────
    graphUrl: 'data/walk_graph.json',
    registerUrl: 'data/ut_buildings.json',  // UT's own 198-code register; the
                           // codes the graph lacks still deserve an answer
    minZoom: 13,
  };

  // ══════════════════════════════════════════════════════════════════════════
  // COPY BLOCK — every string a human can read.
  //
  // These are QUOTATIONS from docs/walk/what-we-can-honestly-say.md §11, the
  // list of sentences this interface is permitted to use. If you want to say
  // something that is not in here, that document is the place to go and argue,
  // not this file. §12 of the same document is the list of sentences that are
  // forbidden and why — read it before adding a line.
  // ══════════════════════════════════════════════════════════════════════════
  const SAY = {
    title: 'Walk to class',
    placeholder: 'Building code, name or number',
    fromLabel: 'From',
    toLabel: 'To',
    // QUEUE Z2. The old placeholder was `Where I am standing` — a promise of
    // geolocation this file does not have. The From default is now the
    // routable building nearest the CAMERA (which always exists and never asks
    // permission), and the placeholder says exactly that and nothing more.
    fromDefault: 'Nearest building to the view',
    // QUEUE Z3. A register code the graph lacks gets a specific, honest answer
    // — never an empty list, never silence.
    notWalkable: (code) => code + ' is not walkable in this build yet',
    notWalkableTag: 'not walkable yet',
    minWalk: (lo, hi) => lo + '-' + hi + ' min walk',
    minWalkUnder: (hi) => 'Under ' + hi + ' min walk',
    stairsNone: 'No stairs on this route',
    stairsSets: (n) => 'Stairs: ' + n + (n === 1 ? ' set' : ' sets'),
    signals: (n) => 'Crosses ' + n + ' signalised crossing' + (n === 1 ? '' : 's') +
      ' — add up to a minute and a half if the lights are against you',
    lastLeg: "The last stretch isn't a mapped path",
    // THE PASSING PERIOD, and it is one-sided ON PURPOSE — §15 of the honesty
    // doc, written before these two strings existed. "You won't make it" costs
    // a wrong reader one minute of walking faster. "You'll make it" costs a
    // wrong reader the class. So there is a sentence for the bad news, a
    // sentence for the borderline, and DELIBERATELY NO SENTENCE for the good
    // news: the range is already on screen and any wording of "you have time"
    // is a promise about a lift, a crowd and a stairwell we cannot see.
    passingOver: (n) => 'Longer than a ' + n + '-minute passing period',
    passingTight: (n) => 'Tight for a ' + n + '-minute passing period',
    // Doors, picked by `src` — the table in §7. A derived door may NEVER be
    // called "the main entrance": that role was assigned by a ranking, not by
    // anybody standing in front of the building.
    doorOsmMain: 'The main entrance',
    doorOsmSide: 'A side entrance',
    doorOsmOther: 'An entrance',
    doorAuthored: 'The lobby entrance',
    doorDerived: 'Entrances are on this side',
    doorNone: "We don't have door locations for this building — the route ends at the building",
    noRoute: 'No walking route found',
    notFound: (s) => 'We couldn’t find “' + s + '”.',
    notRoutable: 'We have no door or path for this building.',
    avoidStairs: 'Avoid stairs',
    avoidBlurb: 'Routes around every staircase OpenStreetMap has mapped on campus.',
    avoidNotAccess: "This is not an accessibility check. We don't have data on kerbs, " +
      'ramps, door widths or automatic doors, and there may be steps nobody has mapped.',
    avoidShown: 'Avoids 189 mapped staircases. Kerbs and doorways are not checked.',
    avoidNone: 'No route that avoids mapped stairs.',
    onTheWay: (kind, name, m) => kind + ' on the way: ' + name + ', ' + m + ' off route',
    hours: (h) => 'OpenStreetMap lists ' + h + '. Check before you go.',
    noneNear: (kind) => 'No ' + kind.toLowerCase() + ' within a short detour of this route.',
    asOf: (d) => 'Campus paths from OpenStreetMap, ' + d,
    changed: 'Paths may have changed since then',
    noIndoor: "We can't route inside buildings",
    osm: '© OpenStreetMap contributors',
    notUT: 'Not affiliated with UT Austin',
    showRoute: 'Show route',
    clear: 'Clear',
    more: (n) => '+ ' + n + ' more — keep typing',
    chipCoffee: 'Coffee',
    chipFood: 'Food',
    chipStore: 'Store',
    examples: 'Try WEL, PCL, GDC, or an apartment name',
  };

  // ── ON/OFF, decided before anything else happens ──────────────────────────
  // `?walk=0` is an explicit veto and beats every other switch, so a verify
  // script can prove the off state on a URL that also carries from/to.
  const urlWalk = q.get('walk');
  const urlFrom = q.get('from');
  const urlTo = q.get('to');
  const ENABLED = urlWalk !== '0' &&
    (WAYFIND.on || urlWalk != null || urlFrom != null || urlTo != null);
  window.WAYFIND = WAYFIND;
  if (!ENABLED) return;   // <- byte-identical past this line

  const MPD_LON = 96061, MPD_LAT = 111195;   // metres per degree at lat 30.285
  const SRC = 'wayfind-route', SRC_RIB = 'wayfind-strip', SRC_COL = 'wayfind-arrive';
  const L_RIB = 'wayfind-ribbon', L_GHOST = 'wayfind-ghost';
  const L_TURN = 'wayfind-thread', L_COL = 'wayfind-column';

  // ══════════════════════════════════════════════════════════════════════════
  // 1. THE GRAPH
  // ══════════════════════════════════════════════════════════════════════════
  let G = null;              // decoded graph
  let loadPromise = null;
  const stats = { fetchMs: 0, parseMs: 0, decodeMs: 0, indexMs: 0, lastRouteMs: 0, routes: 0 };

  async function loadGraph() {
    if (G) return G;
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      const t0 = performance.now();
      // The register rides along so the 85 codes the graph lacks can still be
      // FOUND and answered honestly (QUEUE Z3). Its failure is tolerated: the
      // feature works without it, it just answers less specifically.
      const [r, reg] = await Promise.all([
        fetch(WAYFIND.graphUrl),
        fetch(WAYFIND.registerUrl).then(x => x.ok ? x.json() : null).catch(() => null),
      ]);
      if (!r.ok) throw new Error(WAYFIND.graphUrl + ': ' + r.status);
      const text = await r.text();
      const t1 = performance.now();
      const raw = JSON.parse(text);
      const t2 = performance.now();
      G = decode(raw);
      const t3 = performance.now();
      buildIndex(G, reg);
      const t4 = performance.now();
      stats.fetchMs = t1 - t0; stats.parseMs = t2 - t1;
      stats.decodeMs = t3 - t2; stats.indexMs = t4 - t3;
      // The bake owns the arithmetic. Anything it ships overrides the defaults
      // above so the printed range can never disagree with the cost model the
      // graph was measured with.
      const map = { WALK_SPEED_LOW_MS: 'speedLow', WALK_SPEED_HIGH_MS: 'speedHigh',
        STAIR_SPEED_MPS: 'stairSpeed', STAIR_FIXED_S: 'stairFixedS',
        STAIR_UP_MULT: 'stairUpMult', SIGNAL_WAIT_LOW_S: 'signalWaitLowS',
        SIGNAL_WAIT_HIGH_S: 'signalWaitHighS', CROSSING_PENALTY_M: 'crossingPenaltyM',
        DOOR_LINK_MAX_M: 'doorLinkMaxM' };
      for (const k in map) if (raw.tune && raw.tune[k] != null) WAYFIND[map[k]] = raw.tune[k];
      return G;
    })();
    return loadPromise;
  }

  // The file is delta-coded quantised integers (see its own `_format` string).
  // Decoding is ~11k nodes and ~12k edges of cumulative sum: sub-millisecond,
  // and it buys a 4.4x smaller file than an array of objects would have been.
  function decode(g) {
    const Q = g.q, N = g.n.x.length, E = g.e.a.length;
    const X = new Float64Array(N), Y = new Float64Array(N);
    let ax = 0, ay = 0;
    for (let i = 0; i < N; i++) { ax += g.n.x[i]; ay += g.n.y[i]; X[i] = ax * Q; Y[i] = ay * Q; }
    const A = new Int32Array(E), B = new Int32Array(E);
    let a = 0;
    for (let i = 0; i < E; i++) { a += g.e.a[i]; A[i] = a; B[i] = a + g.e.b[i]; }
    const W = Int32Array.from(g.e.w), F = Uint8Array.from(g.e.f), S = Int32Array.from(g.e.s);

    // CSR adjacency. Built once; every query reuses it.
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

    // How many edges each `highway=steps` way was split into. The fixed
    // per-staircase cost is divided by this, so traversing a whole staircase
    // costs STAIR_FIXED_S exactly ONCE however many segments it was drawn with.
    // Charging it per edge would make a long stepped path look like fourteen
    // separate staircases to the router.
    const swEdges = new Map();
    for (let i = 0; i < E; i++) if (S[i] >= 0) swEdges.set(S[i], (swEdges.get(S[i]) || 0) + 1);

    return {
      raw: g, N, E, X, Y, A, B, W, F, S, off, to, eix, swEdges,
      doors: g.d, code: g.code, nameIdx: g.name, wc: g.wc, poi: g.poi,
      asOf: g.as_of, meta: g.meta, q: Q,
    };
  }

  const F_STEPS = 1, F_CROSS = 2, F_SIGNAL = 4, F_UP_AB = 8, F_OFFMAIN = 128;

  // Edge cost in "equivalent flat metres". Stairs cost what they cost because a
  // staircase is slow, not because of any claim about a hill.
  function edgeCost(g, i, avoidStairs) {
    const m = g.W[i] / 100;
    if (g.F[i] & F_STEPS) {
      if (avoidStairs) return Infinity;
      const n = g.swEdges.get(g.S[i]) || 1;
      return m * (WAYFIND.speedLow / WAYFIND.stairSpeed) +
        (WAYFIND.stairFixedS * WAYFIND.speedLow) / n;
    }
    let c = m;
    if (g.F[i] & F_CROSS) c += WAYFIND.crossingPenaltyM;
    return c;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 2. DIJKSTRA. 11,062 nodes, 11,997 edges, a plain binary heap. Measured, in
  //    the browser, and reported by wayfindStats() — see the HANDOFF entry.
  // ══════════════════════════════════════════════════════════════════════════
  function dijkstra(g, seeds, targets, avoidStairs) {
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
      // The frontier only ever grows, and every remaining target adds its own
      // non-negative door link on top of whatever it costs to reach. So the
      // moment the cheapest thing left in the heap costs more than the answer
      // we already have, there is nothing better to find. Without this the
      // router walks the whole 11k-node graph on every query for no gain.
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
        if (g.F[e] & F_OFFMAIN) continue;      // never route on a stranded island
        const c = edgeCost(g, e, avoidStairs);
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

  // ══════════════════════════════════════════════════════════════════════════
  // 3. WHAT THE ROUTE ACTUALLY IS — measured off the path, never estimated
  // ══════════════════════════════════════════════════════════════════════════
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

  // The printed range. NEVER one number: see §3 of the honesty audit — a 1.1 to
  // 1.4 m/s band is a 25 % spread on a 1 km route before a single traffic light
  // is counted, and a single number turns our assumption into a promise.
  // Rounds OUTWARD, so the low end is a floor and the high end a ceiling.
  function timeRange(m) {
    const lowS = m.flat / WAYFIND.speedHigh +
      m.stair / WAYFIND.stairSpeed +
      m.stairSets * WAYFIND.stairFixedS +
      m.signals * WAYFIND.signalWaitLowS;
    const highS = m.flat / WAYFIND.speedLow +
      (m.stair / WAYFIND.stairSpeed) * WAYFIND.stairUpMult +
      m.stairSets * WAYFIND.stairFixedS +
      m.signals * WAYFIND.signalWaitHighS;
    let lo = Math.floor(lowS / 60), hi = Math.ceil(highS / 60);
    if (hi <= lo) hi = lo + 1;
    return { lo, hi, lowS, highS };
  }

  // Two significant figures below 950 m, kilometres above. `647 m` is a
  // precision claim about a snapped graph that nobody can back.
  function fmtDist(m) {
    if (m >= 950) return (m / 1000).toFixed(1) + ' km';
    if (m < 10) return m.toFixed(1) + ' m';
    const mag = Math.pow(10, Math.floor(Math.log10(m)) - 1);
    return String(Math.round(m / mag) * mag) + ' m';
  }

  function fmtAsOf(iso) {
    const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
      'August', 'September', 'October', 'November', 'December'];
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.getUTCDate() + ' ' + MON[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 4. THE SEARCH INDEX AND THE MATCH LADDER
  // ══════════════════════════════════════════════════════════════════════════
  function norm(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }
  const STOPWORDS = new Set(['hall', 'building', 'bldg', 'center', 'centre', 'the',
    'and', 'of', 'at', 'complex']);

  function buildIndex(g, reg) {
    // code -> {code, name, number, doors[]}
    const byCode = new Map();
    for (const c of Object.keys(g.code)) {
      byCode.set(c, { kind: 'code', code: c, name: '', number: '', doors: g.code[c].slice() });
    }
    for (const [k, v] of Object.entries(g.nameIdx)) {
      const rec = byCode.get(v);
      if (!rec) continue;
      if (/^[0-9]+$/.test(k)) { if (!rec.number) rec.number = k; }
      else if (k !== v.toLowerCase() && k.length > rec.name.length) rec.name = k;
    }
    // A door carries the register name already title-cased. Prefer it: the
    // index's own keys are lower-case and re-casing "AT&T" by rule is a losing
    // game.
    for (const rec of byCode.values()) {
      for (const di of rec.doors) {
        const nm = g.doors[di][7];
        if (nm) { rec.display = nm; break; }
      }
      if (!rec.display) rec.display = rec.name ? titleCase(rec.name) : rec.code;
    }
    const entries = Array.from(byCode.values());
    for (const [name, doors] of Object.entries(g.wc)) {
      entries.push({ kind: 'wc', code: '', name: norm(name), number: '', display: name, doors: doors.slice() });
    }
    // THE REGISTER MERGE (QUEUE Z3). 85 of UT's 198 register codes are not in
    // walk_graph.json at all, and an empty result list reads as "you typed it
    // wrong" rather than "we don't have it". So every register code the graph
    // lacks becomes a findable, non-routable entry that gets the honest answer
    // (`SMC is not walkable in this build yet`). Actually ROUTING them is the
    // bake's job — scripts/bake_walk.py, QUEUE Z3/Z4 — not this file's.
    if (reg && Array.isArray(reg.buildings)) {
      for (const b of reg.buildings) {
        if (!b || !b.ref || byCode.has(b.ref)) continue;
        const e = { kind: 'reg', reg: true, code: b.ref, name: norm(b.name),
          number: b.number || '', display: titleCase(norm(b.name)), doors: [] };
        byCode.set(b.ref, e);
        entries.push(e);
      }
    }
    for (const e of entries) {
      // TOKENS COME FROM BOTH NAMES, NOT ONE (QUEUE Z9). The index key and the
      // door's own register name genuinely differ — JCD is `jester residence
      // hall` in the index and `Jester East Hall` on the door — and only the
      // second is the string the student is reading off the screen. Searching
      // the name we do not show, and not the one we do, made `jester east`
      // match nothing.
      const t = new Set();
      for (const w of norm(e.name).split(' ')) if (w) t.add(w);
      for (const w of norm(e.display).split(' ')) if (w) t.add(w);
      e.tokens = Array.from(t);
      e.routable = e.doors.some(di => g.doors[di][2] && g.doors[di][2].length);
    }
    g.entries = entries;
    g.byCode = byCode;
  }

  const KEEP_CAPS = new Set(['ii', 'iii', 'iv', 'ut', 'lbj', 'rlm', 'dkr', 'at&t', 'tx']);
  function titleCase(s) {
    return s.split(' ').map(w => KEEP_CAPS.has(w) ? w.toUpperCase()
      : w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  // One edit, Damerau-Levenshtein, early-exit. Words only.
  function withinOne(a, b) {
    if (a === b) return true;
    const la = a.length, lb = b.length;
    if (Math.abs(la - lb) > 1) return false;
    let i = 0, j = 0, diff = 0;
    while (i < la && j < lb) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++diff > 1) return false;
      if (la === lb) {
        if (a[i + 1] === b[j] && a[i] === b[j + 1]) { i += 2; j += 2; }  // transposition
        else { i++; j++; }
      } else if (la > lb) i++;
      else j++;
    }
    if (i < la || j < lb) diff++;
    return diff <= 1;
  }

  /**
   * The match ladder, first hit wins. Order is from interface.md §1 and the one
   * rule that is not negotiable is the last step: NEVER fuzzy-match a code. The
   * 1-edit neighbourhood of `WEL` contains `WCP`, `WMB` and `MEL`, so a typo
   * rule on codes would confidently route a student to the wrong building —
   * exactly the failure this feature is not allowed to have.
   */
  function search(str) {
    if (!G) return [];
    const s = norm(str);
    if (!s) return [];
    const up = s.toUpperCase().replace(/ /g, '');

    // RUNG BY RUNG, AND THE ORDER BETWEEN RUNGS IS NEVER RE-SORTED.
    //
    // This is the bug that cost this pass a whole verification round and it is
    // worth the paragraph, because it is the exact failure mode the brief calls
    // "made me late for my exam". The first cut collected every rung into one
    // list and then sorted the WHOLE thing by "routable first, then shortest
    // name". Typing `JES` therefore returned **JCD, Jester East Hall** —
    // seventeen characters — ahead of `JES`, Beauford H. Jester Center, which
    // is the building the student typed the code of. The route was drawn,
    // beautifully, to the wrong building, and every number about it was
    // correct. Nothing but photographing it would have caught that.
    //
    // So: sort WITHIN a rung, concatenate BETWEEN rungs, and an exact code is
    // a rung of its own that ends the search.
    const rungs = [];
    const seen = new Set();
    const rung = (list) => {
      const keep = list.filter(e => e && !seen.has(e));
      for (const e of keep) seen.add(e);
      keep.sort((a, b) => (b.routable - a.routable) || (a.display.length - b.display.length));
      if (keep.length) rungs.push(keep);
    };

    // 1. EXACT CODE. It is the only result. A student who types WEL has told us
    //    which building; offering them a list is us second-guessing them.
    if (G.byCode.has(up)) return [G.byCode.get(up)];

    // 2. building number, leading zeros optional. Also unambiguous.
    if (/^[0-9]+$/.test(s)) {
      const n = String(parseInt(s, 10));
      const hit = G.entries.filter(e => e.number && String(parseInt(e.number, 10)) === n);
      if (hit.length === 1) return hit;
      rung(hit);
    }
    // 3. exact display / name
    rung(G.entries.filter(e => norm(e.display) === s || e.name === s));
    // 4. code prefix (2+ chars, so `w` does not list forty buildings)
    if (up.length >= 2 && /^[A-Z0-9]+$/.test(up)) {
      rung(G.entries.filter(e => e.code && e.code.startsWith(up)));
    }
    const qt = s.split(' ').filter(Boolean);
    // Token prefix on the name, order-free. Stop-words never have to be typed
    // but never block a match either. Used by rungs 5 and 6.
    const tokenHit = (e) => e.tokens.length &&
      qt.every(t => STOPWORDS.has(t) || e.tokens.some(w => w.startsWith(t)));

    // 5. YOU TYPED THE CODE AND THEN KEPT TYPING — QUEUE Z9, and this is the
    //    rung that fixes `jest`.
    //
    //    Both Jesters carry the word "jester": JES is `Beauford H. Jester
    //    Center` and JCD is `Jester East Hall`. So they land in the SAME rung
    //    below and the tie falls to "shortest display name", which is JCD — the
    //    wrong one, and the one nobody typing `jest` means. §116's photograph
    //    caught it; nothing else would have.
    //
    //    What actually separates them is that `jest` BEGINS WITH `JES`. UT's
    //    codes are almost always the head of the building's own name (WEL
    //    Welch, GRE Gregory, BUR Burdine, PAI Painter, MAI Main), so a query
    //    that starts with a building's code is real evidence about which
    //    building is meant.
    //
    //    ALONE it would be dangerous — plenty of four-letter words start with
    //    somebody's three-letter code. So it is a CONJUNCTION: the code must
    //    head the query AND the entry's own words must match it. Two
    //    independent signals agreeing is a different thing from one guess.
    if (up.length > WAYFIND.codeHeadMinLen) {
      rung(G.entries.filter(e => e.code &&
        e.code.length >= WAYFIND.codeHeadMinLen && up.startsWith(e.code) && tokenHit(e)));
    }
    // 6. token prefix on the name, order-free.
    rung(G.entries.filter(tokenHit));
    // 7. one typo, on words of 4 characters or more, and ONLY on words.
    //    `welhc` -> `welch`, `jestre` -> `jester`. Never on the code.
    const found = rungs.reduce((n, r) => n + r.length, 0);
    if (found < WAYFIND.resultRows && qt.some(t => t.length >= WAYFIND.fuzzyMinLen)) {
      const near = (t, w) => w.startsWith(t) ||
        (t.length >= WAYFIND.fuzzyMinLen &&
          (withinOne(t, w) || withinOne(t, w.slice(0, t.length)) || withinOne(t, w.slice(0, t.length + 1))));
      rung(G.entries.filter(e => qt.every(t => STOPWORDS.has(t) || e.tokens.some(w => near(t, w)))));
    }
    return [].concat.apply([], rungs);
  }

  function resolve(str) {
    if (!str) return null;
    const r = search(str);
    return r.length ? r[0] : null;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 5. ROUTING BETWEEN TWO NAMED THINGS
  // ══════════════════════════════════════════════════════════════════════════
  //
  // WHICH DOOR. Taking the minimum over EVERY door pair answers "what is the
  // shortest mapped walk between these two footprints", and for adjacent
  // buildings that is a pair of back doors: PCL to Jester comes out at 80 m
  // that way and 156 m between the doors a person would actually use. So
  // `role: main` wins where a building has one. (HANDOFF #113, finding 1.)
  function doorSet(g, entry) {
    const all = entry.doors.filter(di => g.doors[di][2] && g.doors[di][2].length);
    const mains = all.filter(di => g.doors[di][4] === 'main');
    return mains.length ? mains : all;
  }
  function anchors(g, doors, role) {
    const out = [];
    for (const di of doors) {
      const d = g.doors[di];
      for (let k = 0; k < d[2].length; k++) out.push({ node: d[2][k], c: d[3][k] / 100, door: di, role });
    }
    return out;
  }

  function legBetween(g, fromDoors, toDoors, avoidStairs) {
    const seeds = anchors(g, fromDoors, 'from');
    const targets = anchors(g, toDoors, 'to');
    if (!seeds.length || !targets.length) return null;
    const r = dijkstra(g, seeds, targets, avoidStairs);
    if (!r) return null;
    r.fromDoor = r.seed ? r.seed.door : fromDoors[0];
    r.fromLinkM = r.seed ? r.seed.c : 0;
    r.toDoor = r.target.door;
    r.toLinkM = r.target.c;
    return r;
  }

  function lonlat(g, i) { return [g.X[i], g.Y[i]]; }
  function doorLL(g, di) { return [g.doors[di][0] * g.q, g.doors[di][1] * g.q]; }

  function metresBetween(a, b) {
    const dx = (a[0] - b[0]) * MPD_LON, dy = (a[1] - b[1]) * MPD_LAT;
    return Math.hypot(dx, dy);
  }

  /** Turn every leg into one polyline plus the two unmapped door legs. */
  function geometryOf(g, legs, fromDoor, toDoor) {
    const line = [];
    for (const leg of legs) {
      for (const n of leg.nodes) {
        const p = lonlat(g, n);
        const last = line[line.length - 1];
        if (!last || last[0] !== p[0] || last[1] !== p[1]) line.push(p);
      }
    }
    const startLeg = line.length ? [doorLL(g, fromDoor), line[0]] : null;
    const endLeg = line.length ? [line[line.length - 1], doorLL(g, toDoor)] : null;
    return { line, startLeg, endLeg };
  }

  function bearing(a, b) {
    return Math.atan2((b[0] - a[0]) * MPD_LON, (b[1] - a[1]) * MPD_LAT) * 180 / Math.PI;
  }
  function turnPoints(line) {
    const out = [];
    for (let i = 1; i < line.length - 1; i++) {
      let d = Math.abs(bearing(line[i - 1], line[i]) - bearing(line[i], line[i + 1]));
      if (d > 180) d = 360 - d;
      if (d >= WAYFIND.turnMinDeg) out.push(line[i]);
    }
    return out;
  }

  function doorPhrase(g, di) {
    if (di == null) return SAY.doorNone;
    const d = g.doors[di];
    const src = d[5], role = d[4];
    if (src === 'osm') {
      if (role === 'main') return SAY.doorOsmMain;
      if (role === 'secondary') return SAY.doorOsmSide;
      return SAY.doorOsmOther;
    }
    if (src === 'westcampus' || src === 'authored') return SAY.doorAuthored;
    return SAY.doorDerived;   // 543 of 629. Never a definite article.
  }

  /**
   * The whole answer. `via` is a POI index or null.
   */
  function computeRoute(g, from, to, opts) {
    opts = opts || {};
    const t0 = performance.now();
    const fromDoors = doorSet(g, from), toDoors = doorSet(g, to);
    if (!fromDoors.length || !toDoors.length) return { ok: false, why: 'nodoor' };

    let legs, viaPoi = null;
    if (opts.via != null) {
      const p = g.poi[opts.via];
      const viaAnchor = [{ node: p[2], c: 0, door: null }];
      const a = dijkstra(g, anchors(g, fromDoors, 'from'), viaAnchor, opts.avoidStairs);
      const b = a ? dijkstra(g, [{ node: p[2], c: 0 }], anchors(g, toDoors, 'to'), opts.avoidStairs) : null;
      if (!a || !b) return { ok: false, why: 'noroute' };
      a.fromDoor = a.seed ? a.seed.door : fromDoors[0]; a.fromLinkM = a.seed ? a.seed.c : 0;
      b.toDoor = b.target.door; b.toLinkM = b.target.c;
      legs = [a, b];
      viaPoi = { i: opts.via, name: p[4], cat: p[3], hours: p[5], ll: [p[0] * g.q, p[1] * g.q] };
      legs.fromDoor = a.fromDoor; legs.toDoor = b.toDoor;
      legs.fromLinkM = a.fromLinkM; legs.toLinkM = b.toLinkM;
    } else {
      const r = legBetween(g, fromDoors, toDoors, opts.avoidStairs);
      if (!r) return { ok: false, why: 'noroute' };
      legs = [r];
      legs.fromDoor = r.fromDoor; legs.toDoor = r.toDoor;
      legs.fromLinkM = r.fromLinkM; legs.toLinkM = r.toLinkM;
    }

    const m = { flat: 0, stair: 0, signals: 0, stairSets: 0 };
    const sets = new Set();
    for (const leg of legs) {
      const s = measure(g, leg);
      m.flat += s.flat; m.stair += s.stair; m.signals += s.signals;
      for (const e of leg.edges) if (g.F[e] & F_STEPS) sets.add(g.S[e]);
    }
    m.stairSets = sets.size;
    // The unmapped door legs are real metres you have to walk, so they count in
    // the distance and in the time. They are drawn dashed because they are not
    // a surveyed path, not because they are free.
    m.flat += legs.fromLinkM + legs.toLinkM;

    const geom = geometryOf(g, legs, legs.fromDoor, legs.toDoor);
    const dist = m.flat + m.stair;
    const t = timeRange(m);
    const ms = performance.now() - t0;
    stats.lastRouteMs = ms; stats.routes++;

    return {
      ok: true, from, to, legs, geom, m, time: t, distM: dist,
      fromDoor: legs.fromDoor, toDoor: legs.toDoor,
      fromLinkM: legs.fromLinkM, toLinkM: legs.toLinkM,
      via: viaPoi, avoidStairs: !!opts.avoidStairs, ms,
    };
  }

  // ── the optional stop ─────────────────────────────────────────────────────
  const CATS = {
    Coffee: ['cafe'],
    Food: ['restaurant', 'fast_food', 'bakery', 'ice_cream', 'pub', 'food_court'],
    Store: ['convenience', 'supermarket'],
  };
  function stopCandidates(g, route, kind) {
    const cats = CATS[kind] || [];
    const pts = route.geom.line;
    const out = [];
    for (let i = 0; i < g.poi.length; i++) {
      const p = g.poi[i];
      if (cats.indexOf(p[3]) < 0) continue;
      const ll = [p[0] * g.q, p[1] * g.q];
      let best = Infinity;
      for (let k = 0; k < pts.length; k++) {
        const d = metresBetween(ll, pts[k]);
        if (d < best) best = d;
        if (best < 20) break;
      }
      if (best <= WAYFIND.detourMaxM) out.push({ i, off: best, name: p[4] });
    }
    out.sort((a, b) => a.off - b.off);
    return out.slice(0, WAYFIND.viaCandidates);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 6. DRAWING
  // ══════════════════════════════════════════════════════════════════════════
  //
  // The ribbon is 1.6 GROUND METRES wide at every altitude, which MapLibre
  // cannot express directly — line widths are pixels. An exponential-base-2
  // zoom interpolation is exactly a constant ground width, because metres per
  // pixel halves per zoom step. Measured at lat 30.2862: 2.06 m/px at z15 and
  // 0.06 m/px at the eye-level pose, so 1.6 m is 0.8 px from cruise altitude
  // (clamped up to a followable thread) and 27 px under your feet.
  function mPerPxAt(z) { return (40075016.686 * Math.cos(30.2862 * Math.PI / 180)) / (512 * Math.pow(2, z)); }
  // THE Z1 LESSON, PAID FOR IN A MISSING LAYER. MapLibre only accepts a
  // ["zoom"] expression as the input of a TOP-LEVEL "interpolate" or "step".
  // The first version wrapped the interpolate in ['max', 1.5, ['*', 0.55, ...]]
  // — style validation rejected it, fired an error EVENT rather than throwing,
  // and skipped the layer, so `wayfind-ghost` never entered the style and a
  // route running behind a building simply vanished. So the clamp and the
  // multiplier are applied HERE, in JavaScript, per stop, and MapLibre is
  // handed a bare interpolate. Same ground-metres arithmetic as before:
  // exponential base 2 is a constant ground width between the stops.
  function ghostWidthExpr() {
    const at = (z) => Math.max(WAYFIND.ghostMinPx, WAYFIND.ghostWidthMul *
      Math.min(WAYFIND.routeMaxPx, Math.max(WAYFIND.routeMinPx, WAYFIND.routeWidthM / mPerPxAt(z))));
    return ['interpolate', ['exponential', 2], ['zoom'], 15, at(15), 21, at(21)];
  }

  function nightness() {
    const p = window.__todCurrentP != null ? window.__todCurrentP : 0.5;
    return Math.max(0, Math.min(1, (p - 0.5) / 0.5));
  }
  function hex2rgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function routeColour() {
    const a = hex2rgb(WAYFIND.colDay), b = hex2rgb(WAYFIND.colNight), t = nightness();
    return 'rgb(' + a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',') + ')';
  }

  function squareAround(ll, sideM) {
    const dx = (sideM / 2) / MPD_LON, dy = (sideM / 2) / MPD_LAT;
    return [[[ll[0] - dx, ll[1] - dy], [ll[0] + dx, ll[1] - dy],
      [ll[0] + dx, ll[1] + dy], [ll[0] - dx, ll[1] + dy], [ll[0] - dx, ll[1] - dy]]];
  }

  // `pulseGen` is not decoration. `cancelAnimationFrame` does not un-queue a
  // callback that the browser has already handed to the current frame, so the
  // PREVIOUS route's `step` can still fire once after the NEXT route's pulse
  // has started — and it would then write `pulseRAF = null` over the live
  // handle and, if its own budget had run out, call `endPulse` and take the
  // new route's pulse down with it. That is exactly what happened: a route
  // drawn after a route that had been on screen for more than pulseSettleSec
  // never pulsed at all. Found by driving it; no amount of reading found it.
  // Every loop therefore carries the generation it was born in and a stale one
  // returns on its first line.
  let layersAdded = false, pulseRAF = null, pulseDetach = null, pulseGen = 0;

  function ensureLayers(map) {
    if (layersAdded) return;
    layersAdded = true;
    const col = routeColour();

    map.addSource(SRC, { type: 'geojson', lineMetrics: true, data: empty() });
    map.addSource(SRC_RIB, { type: 'geojson', data: empty() });
    map.addSource(SRC_COL, { type: 'geojson', data: empty() });

    // ── THE RIBBON IS AN EXTRUSION, NOT A LINE, AND THAT IS THE WHOLE STORY ──
    //
    // It was a `line` layer first, sitting on the ground under the buildings,
    // exactly as the interface doc specifies. It rendered NINE PIXELS. Not
    // faintly — nine, in a ten-pixel sliver at the far end of the frame, and
    // zero at walking height. Three screenshots looked completely convincing
    // before the isolation test (same pose, route drawn vs cleared, diff the
    // frames) proved that every "ribbon" in them was js/ground.js's Speedway
    // paving, which happens to run exactly where a Jester-to-Welch route runs.
    //
    // The cause: THE GROUND IN THIS APP IS NOT FLAT GEOMETRY. js/ground.js
    // draws its paths, plazas, Speedway and road surfaces as `fill-extrusion`
    // slabs standing a few centimetres proud. Those write into the depth
    // buffer. A 2D line layer placed beneath them in the stack is drawn first
    // and then painted over by every slab it lies on — which is every slab a
    // footpath route lies on, by definition.
    //
    // So the ribbon is a real 1.6 m wide strip of geometry standing
    // ROUTE_H_M proud of the pavement, which is the same answer js/places.js
    // reached for its shopfronts ("a thin slab standing 0.30 m PROUD of the
    // host wall, so they can never z-fight"). It depth-sorts correctly against
    // the ground AND against the buildings, it is a true 1.6 m at every
    // altitude with no zoom expression at all, and it cannot be confused with
    // the basemap because nothing else in the scene is that colour.
    map.addLayer({
      id: L_RIB, type: 'fill-extrusion', source: SRC_RIB, minzoom: WAYFIND.minZoom,
      paint: {
        'fill-extrusion-color': col,
        'fill-extrusion-height': ['get', 'h'],
        'fill-extrusion-base': ['get', 'base'],
        'fill-extrusion-opacity': WAYFIND.ribbonOpacity,
        'fill-extrusion-vertical-gradient': false,
      },
    }, overOf(map));

    // THE THREAD. From 600 m up a 1.6 m strip is 0.8 px of ground and would
    // disappear into the tan, so a `line` layer ON TOP of the buildings carries
    // the route at altitude — where nothing is close enough for the occlusion
    // question to matter, and where being able to follow the whole route across
    // campus in one glance is the entire point. It fades out as you descend and
    // the real ribbon takes over.
    map.addLayer({
      id: L_TURN, type: 'line', source: SRC, minzoom: WAYFIND.minZoom,
      filter: ['==', ['get', 'k'], 'path'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': col,
        'line-width': ['interpolate', ['linear'], ['zoom'],
          14, WAYFIND.threadPx, WAYFIND.threadFadeZoom, WAYFIND.threadPx, WAYFIND.threadGoneZoom, 0.5],
        'line-opacity': ['interpolate', ['linear'], ['zoom'],
          WAYFIND.threadFadeZoom, WAYFIND.threadOpacity, WAYFIND.threadGoneZoom, 0],
      },
    }, overOf(map));

    // The column stands at the door. It goes in with the buildings so it is
    // depth-sorted against them: at walking height it is standing in front of
    // the actual modelled door leaf, not floating through the wall.
    map.addLayer({
      id: L_COL, type: 'fill-extrusion', source: SRC_COL, minzoom: WAYFIND.minZoom,
      paint: {
        'fill-extrusion-color': ['case', ['==', ['get', 'r'], 'via'], WAYFIND.viaRingCol, col],
        'fill-extrusion-height': ['get', 'h'],
        'fill-extrusion-base': ['get', 'base'],
        'fill-extrusion-opacity': WAYFIND.arriveOpacity,
        'fill-extrusion-vertical-gradient': false,
      },
    });

    // THE GHOST, which is the answer to "what if it runs behind a building".
    // The same geometry drawn a second time, dashed and faint, ABOVE the
    // extrusions. Solid ribbon on open ground, faint dash through the wall: you
    // always know where the route goes and you are never fooled into thinking
    // you can walk through the building. One extra layer, no new render pass.
    map.addLayer({
      id: L_GHOST, type: 'line', source: SRC, minzoom: WAYFIND.minZoom,
      filter: ['match', ['get', 'k'], ['path', 'leg'], true, false],
      layout: { 'line-cap': 'butt' },
      paint: {
        'line-color': col,
        'line-width': ghostWidthExpr(),
        'line-opacity': WAYFIND.ghostOpacity,
        'line-dasharray': WAYFIND.ghostDash,
      },
    }, overOf(map));
  }

  // The first symbol layer above `buildings-3d`. Everything this file draws
  // goes here: over the city, under the place labels.
  function overOf(map) {
    const stack = map.getStyle().layers;
    const after = Math.max(0, stack.findIndex(l => l.id === 'buildings-3d'));
    return (stack.slice(after + 1).find(l => l.type === 'symbol') || {}).id;
  }

  /**
   * THE BUFFER. Turn a polyline into a strip of real geometry `wM` wide.
   *
   * One quad per segment plus a square patch at each interior vertex to fill
   * the mitre gap. Deliberately not a proper mitre join: at 1.6 m wide the
   * patch is 1.6 m square and invisible as a join, and a real mitre needs a
   * bevel limit and a self-intersection guard for hairpins — which this
   * network has (a switchback stair is exactly that). Thirty segments of quads
   * is a few microseconds and cannot produce a degenerate polygon.
   */
  function ribbonPolys(line, wM, h, kind) {
    const out = [];
    const half = wM / 2;
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i], b = line[i + 1];
      const dx = (b[0] - a[0]) * MPD_LON, dy = (b[1] - a[1]) * MPD_LAT;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      const nx = (-dy / len) * half / MPD_LON, ny = (dx / len) * half / MPD_LAT;
      out.push({
        type: 'Feature', properties: { k: kind, h: h, base: WAYFIND.routeBaseM },
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny],
            [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny],
            [a[0] + nx, a[1] + ny],
          ]],
        },
      });
    }
    for (let i = 1; i < line.length - 1; i++) {
      out.push({
        type: 'Feature', properties: { k: kind, h: h, base: WAYFIND.routeBaseM },
        geometry: { type: 'Polygon', coordinates: squareAround(line[i], wM) },
      });
    }
    return out;
  }

  function empty() { return { type: 'FeatureCollection', features: [] }; }

  function draw(map, route) {
    ensureLayers(map);
    const feats = [];
    if (route) {
      feats.push({ type: 'Feature', properties: { k: 'path' }, geometry: { type: 'LineString', coordinates: route.geom.line } });
      for (const leg of [route.geom.startLeg, route.geom.endLeg]) {
        if (leg && metresBetween(leg[0], leg[1]) > 0.5) {
          feats.push({ type: 'Feature', properties: { k: 'leg' }, geometry: { type: 'LineString', coordinates: leg } });
        }
      }
    }
    map.getSource(SRC).setData({ type: 'FeatureCollection', features: feats });

    // The real geometry: 1.6 m of ribbon standing 0.22 m proud of the pavement,
    // and the two door legs standing lower and narrower so the surveyed part of
    // the walk and the part that is our straight line are different objects.
    let strip = [];
    if (route) {
      strip = ribbonPolys(route.geom.line, WAYFIND.routeWidthM, WAYFIND.routeHeightM, 'path');
      for (const leg of [route.geom.startLeg, route.geom.endLeg]) {
        if (leg && metresBetween(leg[0], leg[1]) > 0.5) {
          strip = strip.concat(ribbonPolys(leg, WAYFIND.routeWidthM * WAYFIND.legWidthMul,
            WAYFIND.legHeightM, 'leg'));
        }
      }
      // The start and the door get a low pad rather than a circle: a `circle`
      // layer is 2D and is buried by the ground slabs for the same reason the
      // line ribbon was.
      strip.push({
        type: 'Feature', properties: { k: 'ring', h: WAYFIND.routeBaseM + 0.08, base: WAYFIND.routeBaseM },
        geometry: { type: 'Polygon', coordinates: squareAround(doorLL(G, route.fromDoor), WAYFIND.ringRadiusM * 2) },
      });
      strip.push({
        type: 'Feature', properties: { k: 'ring', h: WAYFIND.routeBaseM + 0.08, base: WAYFIND.routeBaseM },
        geometry: { type: 'Polygon', coordinates: squareAround(doorLL(G, route.toDoor), WAYFIND.ringRadiusM * 2) },
      });
    }
    map.getSource(SRC_RIB).setData({ type: 'FeatureCollection', features: strip });

    const cols = [];
    if (route) {
      cols.push({
        type: 'Feature', properties: { r: 'to', h: WAYFIND.arriveH, base: 0 },
        geometry: { type: 'Polygon', coordinates: squareAround(doorLL(G, route.toDoor), WAYFIND.arriveW) },
      });
      if (route.via) cols.push({
        type: 'Feature', properties: { r: 'via', h: WAYFIND.arriveH * 0.55, base: 0 },
        geometry: { type: 'Polygon', coordinates: squareAround(route.via.ll, WAYFIND.arriveW) },
      });
    }
    map.getSource(SRC_COL).setData({ type: 'FeatureCollection', features: cols });

    startPulse(map, !!route);
  }

  // Direction without arrowheads: a bright band runs start -> end along the
  // altitude thread once per PULSE_SEC. It rides the THREAD rather than the
  // ribbon because `line-gradient` is a line-layer property and the ribbon is
  // geometry now — and because direction is a question you ask from above,
  // while at walking height the ribbon is simply the floor in front of you.
  //
  // ── QUEUE Z5: THE PULSE NOW HAS A LIFE, AND IT ENDS ────────────────────────
  //
  // Every tick of this loop is a `setPaintProperty`, every `setPaintProperty`
  // marks the style dirty, and every dirty style is a full repaint of a scene
  // with 41 fill-extrusion passes in it. The first version did that at
  // `pulseFps` for as long as a route was on screen, which measured 8-12
  // repaints a second on this laptop's RTX 3050 Ti and did not stop — not when
  // the tab went to the background, not at walking height where the layer it
  // animates is faded to zero opacity, not after five minutes. On a phone that
  // is the battery going down for an effect nobody is looking at.
  //
  // Three gates, and the loop is TORN DOWN rather than left spinning:
  //
  //   VISIBLE   `threadGoneZoom` is the zoom at which this exact layer's own
  //             opacity interpolation reaches 0. Above it the pulse is
  //             literally invisible, so it does not run. Not a new constant on
  //             purpose: one number cannot drift from itself.
  //   AWAKE     a hidden tab is not looking. (The browser throttles rAF there
  //             anyway on most platforms — "most" is why this is explicit.)
  //   FINITE    `pulseSettleSec` of ELIGIBLE running time and then it is done
  //             for good. The band exists to say which way the route runs; it
  //             has said it. A NEW route starts a new life.
  //
  // Parked is not stopped: `zoomend`/`moveend`/`visibilitychange` re-arm it, so
  // a route drawn at walking height still pulses the moment you climb, using
  // the budget it never spent. Nothing polls.
  function pulseEligible(map) {
    if (document.hidden) return false;
    try { return map.getZoom() < WAYFIND.threadGoneZoom; } catch (e) { return false; }
  }

  // Stop the loop but keep the arming listeners: we may come back.
  function parkPulse() {
    if (pulseRAF) { cancelAnimationFrame(pulseRAF); pulseRAF = null; }
  }

  // Stop for good, drop the listeners, and put the flat colour back so the
  // thread rests as a plain line rather than frozen mid-band.
  function endPulse(map) {
    pulseGen++;              // anything still in flight is now a stale loop
    parkPulse();
    if (pulseDetach) { try { pulseDetach(); } catch (e) {} pulseDetach = null; }
    if (map && map.getLayer && map.getLayer(L_TURN)) {
      try { map.setPaintProperty(L_TURN, 'line-gradient', null); } catch (e) {}
    }
  }

  function startPulse(map, on) {
    endPulse(map);
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion:reduce)').matches;
    if (!on || !WAYFIND.pulse || reduce) return;

    const gen = ++pulseGen;
    const budgetMs = Math.max(0, WAYFIND.pulseSettleSec) * 1000;
    const minGap = 1000 / Math.max(1, WAYFIND.pulseFps);
    const t0 = performance.now();
    let spentMs = 0;        // ELIGIBLE milliseconds burned, not wall clock
    let prevFrame = 0, lastWrite = -1e9;

    const step = () => {
      if (gen !== pulseGen) return;        // a cancelled loop's last callback
      pulseRAF = null;
      const now = performance.now();
      // A gap longer than this is the machine having stopped drawing, not time
      // the viewer got to watch, so it is not charged in full. The cap is well
      // above a real slow frame — SwiftShader renders this scene at ~3.7 fps,
      // a 270 ms gap, and that IS watched time and must count — and the tab-away
      // case is handled by prevFrame being reset when the pulse parks.
      if (prevFrame) spentMs += Math.min(now - prevFrame, WAYFIND.pulseGapCapMs);
      prevFrame = now;
      if (spentMs >= budgetMs) { endPulse(map); return; }
      if (!pulseEligible(map)) { prevFrame = 0; return; }   // parked; events re-arm
      if (now - lastWrite >= minGap) {
        lastWrite = now;
        const phase = ((now - t0) / 1000 / WAYFIND.pulseSec) % 1;
        const w = Math.min(0.4, WAYFIND.pulseWidth);
        // The stops of an `interpolate` MUST be strictly increasing or MapLibre
        // throws and the pulse dies for the rest of the session. So the band's
        // centre is mapped into [w, 1-w] rather than clamped at the ends: a
        // clamp produces st === t at phase 0 and that is exactly the invalid
        // case.
        const t = (w + 0.001) + phase * (1 - 2 * w - 0.002);
        const c = routeColour();
        const st = t - w, en = t + w;
        try {
          map.setPaintProperty(L_TURN, 'line-gradient',
            ['interpolate', ['linear'], ['line-progress'],
              0, c, st, c, t, '#ffffff', en, c, 1, c]);
        } catch (e) { endPulse(map); return; }
      }
      pulseRAF = requestAnimationFrame(step);
    };

    const arm = () => {
      if (gen !== pulseGen) return;
      if (pulseRAF || spentMs >= budgetMs) return;
      if (!pulseEligible(map)) return;
      prevFrame = 0;
      pulseRAF = requestAnimationFrame(step);
    };

    const onVis = () => { if (document.hidden) { parkPulse(); prevFrame = 0; } else arm(); };
    document.addEventListener('visibilitychange', onVis);
    map.on('zoomend', arm);
    map.on('moveend', arm);
    pulseDetach = () => {
      document.removeEventListener('visibilitychange', onVis);
      try { map.off('zoomend', arm); map.off('moveend', arm); } catch (e) {}
    };
    arm();
  }

  function retint(map) {
    if (!layersAdded || !map || !map.getLayer) return;
    const col = routeColour();
    for (const id of [L_TURN, L_GHOST]) {
      if (map.getLayer(id)) { try { map.setPaintProperty(id, 'line-color', col); } catch (e) {} }
    }
    for (const id of [L_RIB, L_COL]) {
      if (map.getLayer(id)) { try { map.setPaintProperty(id, 'fill-extrusion-color', col); } catch (e) {} }
    }
    if (map.getLayer(L_COL)) {
      try { map.setPaintProperty(L_COL, 'fill-extrusion-color', ['case', ['==', ['get', 'r'], 'via'], WAYFIND.viaRingCol, col]); } catch (e) {}
    }
  }

  function fitTo(map, route) {
    const pts = route.geom.line.concat([doorLL(G, route.fromDoor), doorLL(G, route.toDoor)]);
    let w = 180, s = 90, e = -180, n = -90;
    for (const p of pts) { w = Math.min(w, p[0]); e = Math.max(e, p[0]); s = Math.min(s, p[1]); n = Math.max(n, p[1]); }
    map.fitBounds([[w, s], [e, n]], {
      padding: WAYFIND.fitPadPx, pitch: WAYFIND.fitPitch, duration: WAYFIND.fitMs, bearing: map.getBearing(),
    });
  }

  // ── QUEUE Z6: `?fit=1` HAD TO LEARN TO WAIT ───────────────────────────────
  //
  // `?clip=1&walk=1&from=JES&to=WEL&fit=1` is the URL the docs advertise as the
  // recordable shot of a route, and loaded exactly as written it produced the
  // wrong frame: `applyURL` runs the moment the style is up, so the fitBounds
  // landed at about t=2 s — while the veil was still down and js/app.js's
  // opening flight had not even departed. At t=10 s the flight took the camera
  // to its own end pose and stayed there, and what the recording caught was
  // z16.9 over the Tower with the route thread drawn across the rooftops.
  //
  // The fix is not to fight for the camera — nothing in this file has ever
  // moved the camera on its own and that rule stands. It is to wait for the
  // camera to be FREE: the veil lifted (js/app.js publishes `window.__intro`
  // and stamps `.reason` at the moment it lifts and the flight departs), the
  // flight finished easing, and `fitQuietMs` of silence on top so the 30 ms gap
  // between the intro's two legs cannot be mistaken for the end of it.
  //
  // A hard ceiling means a stalled tile can never eat the shot, and a user who
  // touches anything cancels the intro in js/app.js — which jumps the camera to
  // the end pose and stops easing, so the fit simply departs a moment later.
  function introWillFly() {
    return q.get('tour') === '1' || q.get('intro') !== '0';
  }
  function fitWhenFree(map, route) {
    if (!WAYFIND.fitWaitIntro || !introWillFly()) { fitTo(map, route); return; }
    const t0 = performance.now();
    let quietSince = 0;
    const tick = () => {
      if (state.route !== route) return;      // cleared or replaced while waiting
      const waited = performance.now() - t0;
      let busy = true;
      try {
        const lifted = !window.__intro || window.__intro.reason != null;
        busy = !lifted || (map.isEasing && map.isEasing()) || (map.isMoving && map.isMoving());
      } catch (e) { busy = false; }
      if (busy) quietSince = 0;
      else if (!quietSince) quietSince = performance.now();
      const quietFor = quietSince ? performance.now() - quietSince : 0;
      if (quietFor >= WAYFIND.fitQuietMs || waited >= WAYFIND.fitWaitMaxMs) {
        fitTo(map, route);
        return;
      }
      setTimeout(tick, WAYFIND.fitPollMs);
    };
    tick();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 7. THE INTERFACE
  // ══════════════════════════════════════════════════════════════════════════
  let el = null, state = { from: null, to: null, route: null, avoid: false, via: null,
    viaKind: null, viaList: [], viaAt: 0, viaNote: null, expanded: false };

  function h(tag, cls, txt) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  }

  function buildUI() {
    if (el) return el;
    const root = h('div', null); root.id = 'wf-root';

    const btn = h('button', null, ''); btn.id = 'wf-button';
    btn.title = SAY.title; btn.setAttribute('aria-label', SAY.title);
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M5 20.5 9.5 4.2l4.4 5.3 5.6 1.2-4.3 3.2 1 5.6-4.7-2.9z"/></svg>';

    const sheet = h('div', 'hidden'); sheet.id = 'wf-sheet';
    const head = h('div', null); head.id = 'wf-head';
    head.appendChild(h('div', 'wf-h', SAY.title));
    const close = h('button', null, '✕'); close.id = 'wf-close'; close.setAttribute('aria-label', 'Close');
    head.appendChild(close);
    sheet.appendChild(head);

    const rowFrom = h('div', 'wf-row');
    rowFrom.appendChild(h('span', 'wf-lab', SAY.fromLabel));
    const inFrom = document.createElement('input');
    inFrom.id = 'wf-from'; inFrom.type = 'text'; inFrom.placeholder = SAY.fromDefault;
    inFrom.autocomplete = 'off'; inFrom.spellcheck = false;
    rowFrom.appendChild(inFrom);

    const rowTo = h('div', 'wf-row');
    rowTo.appendChild(h('span', 'wf-lab', SAY.toLabel));
    const inTo = document.createElement('input');
    inTo.id = 'wf-to'; inTo.type = 'text'; inTo.placeholder = SAY.placeholder;
    inTo.autocomplete = 'off'; inTo.spellcheck = false;
    rowTo.appendChild(inTo);

    sheet.appendChild(rowFrom);
    sheet.appendChild(rowTo);
    const list = h('div', null); list.id = 'wf-list';
    sheet.appendChild(list);
    // QUEUE Z9, second half. `+ N more — keep typing` used to be the last child
    // of the scrolling list, so `#wf-list`'s max-height cut it in half and the
    // remains collided with the hint line. It is not a result — it is a note
    // ABOUT the results — so it lives outside the scroller and cannot be
    // clipped by it. Empty means gone: see `#wf-more:empty` in style.css.
    const more = h('div', null); more.id = 'wf-more';
    sheet.appendChild(more);
    const hint = h('div', 'wf-hint', SAY.examples);
    sheet.appendChild(hint);
    const foot = h('div', 'wf-foot');
    foot.appendChild(h('div', null, SAY.noIndoor));
    foot.appendChild(h('div', null, SAY.osm + ' · ' + SAY.notUT));
    sheet.appendChild(foot);

    const pill = h('div', 'hidden'); pill.id = 'wf-pill';
    const headline = h('div', null); headline.id = 'wf-headline';
    const sub = h('div', null); sub.id = 'wf-sub';
    // THE PASSING-PERIOD LINE. It sits in the closed pill, above the fold,
    // because "do I have time" is the question and an answer you have to tap to
    // see is not an answer. Empty means gone (`#wf-verdict:empty`).
    const verdict = h('div', null); verdict.id = 'wf-verdict';
    const card = h('div', 'hidden'); card.id = 'wf-card';
    pill.appendChild(headline); pill.appendChild(sub);
    pill.appendChild(verdict); pill.appendChild(card);

    root.appendChild(btn); root.appendChild(sheet); root.appendChild(pill);
    document.body.appendChild(root);

    el = { root, btn, sheet, list, more, hint, inFrom, inTo, pill, headline, sub, verdict, card, close };

    btn.addEventListener('click', () => openSheet());
    close.addEventListener('click', () => closeSheet());
    pill.addEventListener('click', () => { state.expanded = !state.expanded; renderPill(); });
    for (const inp of [inFrom, inTo]) {
      inp.addEventListener('input', () => renderList(inp));
      inp.addEventListener('focus', () => renderList(inp));
      inp.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); commitFirst(inp); }
        if (ev.key === 'Escape') { ev.preventDefault(); closeSheet(); }
        ev.stopPropagation();     // controls.js already ignores text inputs; belt and braces
      });
    }
    return el;
  }

  async function openSheet() {
    buildUI();
    el.sheet.classList.remove('hidden');
    el.btn.classList.add('active');
    try { await loadGraph(); } catch (e) { el.hint.textContent = 'Could not load the campus paths.'; return; }
    el.hint.textContent = SAY.examples + ' · ' + SAY.asOf(fmtAsOf(G.asOf));
    // QUEUE Z2: the From default. interface.md §2 wants From pre-filled from
    // something that exists; geolocation does not exist here (honesty audit
    // §9), the camera always does. So From opens holding the routable building
    // nearest the camera — visibly a building name, never a claim about where
    // the PERSON is standing — and the field stays fully editable.
    if (!state.from && !el.inFrom.value) {
      const near = nearestToCamera();
      if (near) { state.from = near; el.inFrom.value = near.display; }
    }
    el.inTo.focus();
  }

  // The routable entry whose nearest door is closest to the camera's centre.
  // 132 routable entries x a handful of doors each is a sub-millisecond scan.
  function nearestToCamera() {
    if (!G || !window.__map || !window.__map.getCenter) return null;
    const c = window.__map.getCenter();
    let best = null, bd = Infinity;
    for (const e of G.entries) {
      if (!e.routable) continue;
      for (const di of e.doors) {
        if (!G.doors[di][2] || !G.doors[di][2].length) continue;
        const ll = doorLL(G, di);
        const dx = (ll[0] - c.lng) * MPD_LON, dy = (ll[1] - c.lat) * MPD_LAT;
        const m2 = dx * dx + dy * dy;
        if (m2 < bd) { bd = m2; best = e; }
      }
    }
    return best;
  }
  function closeSheet() {
    if (!el) return;
    el.sheet.classList.add('hidden');
    el.btn.classList.remove('active');
    el.list.innerHTML = '';
    el.more.textContent = '';
  }

  function renderList(inp) {
    if (!G) return;
    // A new keystroke is a new question: put the default hint back so a
    // previous failure message does not outlive the query it answered.
    el.hint.textContent = SAY.examples + ' · ' + SAY.asOf(fmtAsOf(G.asOf));
    const rows = search(inp.value);
    el.list.innerHTML = '';
    const shown = rows.slice(0, WAYFIND.resultRows);
    for (const e of shown) {
      const r = h('div', 'wf-item' + (e.routable ? '' : ' off'));
      r.appendChild(h('span', 'wf-code', e.code || '•'));
      r.appendChild(h('span', 'wf-name', e.display));
      const n = e.doors.length;
      r.appendChild(h('span', 'wf-meta', e.routable ? (n + (n === 1 ? ' door' : ' doors'))
        : (e.reg ? SAY.notWalkableTag : 'no door mapped')));
      if (e.routable) r.addEventListener('mousedown', (ev) => { ev.preventDefault(); pick(inp, e); });
      // A non-routable row is not pickable, but clicking it must still ANSWER
      // (QUEUE Z3) — and a failed answer must never sit on top of a stale route.
      else r.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        answerFail(e.reg ? SAY.notWalkable(e.code) : SAY.notRoutable);
      });
      el.list.appendChild(r);
    }
    el.more.textContent = rows.length > shown.length ? SAY.more(rows.length - shown.length) : '';
  }

  function commitFirst(inp) {
    const all = search(inp.value);
    const rows = all.filter(e => e.routable);
    if (rows.length) return pick(inp, rows[0]);
    // Empty From + Enter used to do NOTHING, silently (QUEUE Z2). Now it takes
    // the stated default: the routable building nearest the view.
    if (!norm(inp.value)) {
      if (inp === el.inFrom) { const near = nearestToCamera(); if (near) pick(inp, near); }
      return;   // empty To + Enter: the hint line already says what to type
    }
    // A query that matched nothing routable gets a specific answer, and the
    // previous route is CLEARED so a failed question never keeps a confident
    // answer on screen (QUEUE Z3).
    answerFail(all.length
      ? (all[0].reg ? SAY.notWalkable(all[0].code) : SAY.notRoutable)
      : SAY.notFound(inp.value));
  }

  // Say why, in the sheet, and take the old route off the map.
  function answerFail(msg) {
    failText(msg);
    clear();
  }

  function pick(inp, entry) {
    inp.value = entry.display;
    if (inp === el.inFrom) state.from = entry; else state.to = entry;
    el.list.innerHTML = '';
    el.more.textContent = '';
    if (state.from && state.to) { closeSheet(); run(); }
    else if (inp === el.inTo && !state.from) el.inFrom.focus();
  }

  function run(opts) {
    if (!G || !state.from || !state.to) return;
    const r = computeRoute(G, state.from, state.to, {
      avoidStairs: state.avoid,
      via: state.via,
    });
    state.route = r;
    closeSheet();          // the answer replaces the question; two panels is two panels
    if (!r.ok) { renderPill(); draw(window.__map, null); return; }
    draw(window.__map, r);
    renderPill();
    // `?fit=1` waits for the opening flight (Z6). The card's own `Show route`
    // button does NOT — that is a person asking, and the camera is theirs.
    if (opts && opts.fit) fitWhenFree(window.__map, r);
  }

  function renderPill() {
    buildUI();
    const r = state.route;
    el.pill.classList.remove('hidden');
    document.body.classList.add('wf-routed');
    el.card.innerHTML = '';
    el.card.classList.toggle('hidden', !state.expanded);

    if (!r || !r.ok) {
      // 'nodoor' names whichever end cannot be routed; a register-only entry
      // (QUEUE Z3) gets the specific sentence, a graph entry the general one.
      const dead = r && r.why === 'nodoor'
        ? [state.to, state.from].find(e => e && (!e.doors.length || !e.routable))
        : null;
      el.headline.textContent = dead
        ? (dead.reg ? SAY.notWalkable(dead.code) : SAY.notRoutable)
        : (r && r.why === 'nodoor' ? SAY.notRoutable : SAY.noRoute);
      el.sub.textContent = state.to ? state.to.display : '';
      el.verdict.textContent = '';
      el.verdict.className = '';
      return;
    }

    // THE HEADLINE. Three facts, in decreasing order of how much they change
    // your decision, and not one of them is a claim we cannot back.
    const t = r.time;
    const parts = [
      t.lo === 0 ? SAY.minWalkUnder(t.hi) : SAY.minWalk(t.lo, t.hi),
      fmtDist(r.distM),
      r.m.stairSets ? SAY.stairsSets(r.m.stairSets) : SAY.stairsNone,
    ];
    el.headline.textContent = parts.join(' · ');
    el.sub.textContent = r.to.display + ' · ' + doorPhrase(G, r.toDoor);

    // ── "WILL I MAKE IT?" — the one-sided answer. Honesty doc §15. ──────────
    //
    // A student between classes is not asking how to get there, they are
    // asking whether they have time, and making them do the subtraction while
    // walking is the app failing at its own job. So we do it — in ONE
    // direction only.
    //
    //   both ends over the period   -> say so. If we are wrong they walk faster.
    //   the range crosses it        -> say it is tight. True of our own numbers.
    //   both ends under it          -> SAY NOTHING, on purpose.
    //
    // There is no "you'll make it" and there must not be. Our range measures
    // pavement between two doors; it knows nothing about getting out of a
    // lecture hall, a lift, a stairwell inside the building, the crowd on
    // Speedway at the hour, or finding the room. On a 13-minute walk into a
    // 15-minute gap those eat the whole buffer, and being wrong in THAT
    // direction is the one failure this feature was written to avoid.
    const pm = WAYFIND.passingMin;
    el.verdict.className = '';
    if (t.lo >= pm) {
      el.verdict.textContent = SAY.passingOver(pm);
      el.verdict.className = 'over';
    } else if (t.hi >= pm) {
      el.verdict.textContent = SAY.passingTight(pm);
      el.verdict.className = 'tight';
    } else {
      el.verdict.textContent = '';
    }

    if (!state.expanded) return;

    if (state.viaNote) el.card.appendChild(h('div', 'wf-c', state.viaNote));
    if (r.via) {
      const line = h('div', 'wf-c wf-via', SAY.onTheWay(state.viaKind, r.via.name, fmtDist(viaOffset())));
      el.card.appendChild(line);
      // Hours ONLY where OpenStreetMap actually carries the string. The baked
      // `open` flag in places.geojson is a category habit table the bake itself
      // calls wrong one time in six; it lights a shopfront and it is not an
      // opening-hours source. Never "open now".
      if (r.via.hours) el.card.appendChild(h('div', 'wf-c wf-dim', SAY.hours(r.via.hours)));
    }
    if (r.m.signals) el.card.appendChild(h('div', 'wf-c', SAY.signals(r.m.signals)));
    if (Math.max(r.fromLinkM, r.toLinkM) > WAYFIND.lastLegNoteM) {
      el.card.appendChild(h('div', 'wf-c', SAY.lastLeg));
    }

    // AVOID STAIRS. Named for what it does. Its limits sit next to the toggle,
    // not in an about page, because being wrong here strands a specific person
    // at the bottom of a staircase.
    const av = h('label', 'wf-toggle');
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = state.avoid;
    cb.addEventListener('change', () => { state.avoid = cb.checked; run(); });
    av.appendChild(cb); av.appendChild(h('span', null, SAY.avoidStairs));
    el.card.appendChild(av);
    el.card.appendChild(h('div', 'wf-c wf-dim', SAY.avoidBlurb));
    el.card.appendChild(h('div', 'wf-c wf-dim', SAY.avoidNotAccess));
    if (state.avoid) el.card.appendChild(h('div', 'wf-c wf-dim', SAY.avoidShown));

    const chips = h('div', 'wf-chips');
    for (const kind of ['Coffee', 'Food', 'Store']) {
      const c = h('button', 'wf-chip' + (state.viaKind === kind && state.via != null ? ' on' : ''), '+ ' + SAY['chip' + kind]);
      c.addEventListener('click', (ev) => { ev.stopPropagation(); cycleStop(kind); });
      chips.appendChild(c);
    }
    if (state.via != null) {
      const x = h('button', 'wf-chip', '✕');
      x.addEventListener('click', (ev) => { ev.stopPropagation(); state.via = null; state.viaKind = null; run(); });
      chips.appendChild(x);
    }
    el.card.appendChild(chips);

    const show = h('button', 'wf-act', SAY.showRoute + ' ⤡');
    show.addEventListener('click', (ev) => { ev.stopPropagation(); fitTo(window.__map, state.route); });
    const clr = h('button', 'wf-act', SAY.clear);
    clr.addEventListener('click', (ev) => { ev.stopPropagation(); clear(); });
    const acts = h('div', 'wf-acts'); acts.appendChild(show); acts.appendChild(clr);
    el.card.appendChild(acts);

    const f = h('div', 'wf-foot');
    f.appendChild(h('div', null, SAY.asOf(fmtAsOf(G.asOf)) + ' · ' + SAY.changed));
    f.appendChild(h('div', null, SAY.noIndoor + ' · ' + SAY.osm + ' · ' + SAY.notUT));
    el.card.appendChild(f);
  }

  function viaOffset() {
    const c = state.viaList.find(x => x.i === state.via);
    return c ? c.off : 0;
  }

  // One place, named, with what it costs. No list, no filter, no rating and no
  // photo — that is where this becomes a second app. `Next` cycles the top few
  // by detour and that is the whole browse experience.
  function cycleStop(kind) {
    if (!state.route || !state.route.ok) return;
    if (state.viaKind !== kind) {
      state.viaKind = kind;
      state.viaAt = 0;
      const base = state.via != null ? withoutVia() : state.route;
      state.viaList = stopCandidates(G, base, kind);
    } else {
      state.viaAt = (state.viaAt + 1) % Math.max(1, state.viaList.length);
    }
    if (!state.viaList.length) {
      state.via = null; state.viaNote = SAY.noneNear(kind);
      run();
      return;
    }
    state.viaNote = null;
    state.via = state.viaList[state.viaAt].i;
    run();
  }
  function withoutVia() {
    return computeRoute(G, state.from, state.to, { avoidStairs: state.avoid });
  }

  function clear() {
    state.route = null; state.via = null; state.viaKind = null; state.expanded = false;
    if (el) { el.pill.classList.add('hidden'); el.card.classList.add('hidden'); }
    document.body.classList.remove('wf-routed');
    if (window.__map && layersAdded) draw(window.__map, null);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 8. URL GRAMMAR — read exactly ONCE, at load. Typing never rewrites the
  //    address bar: a recording's URL must not mutate while it is being filmed,
  //    and typing must not create history entries.
  // ══════════════════════════════════════════════════════════════════════════
  async function applyURL() {
    if (urlFrom == null && urlTo == null) {
      // `?walk=1` on its own is a deep link to the feature: open the panel with
      // nothing routed. It does NOT move the camera and does not touch the
      // intro — nothing in this file ever does.
      if (urlWalk != null && urlWalk !== '0') openSheet();
      return;
    }
    buildUI();
    try { await loadGraph(); } catch (e) { return; }
    const f = urlFrom ? resolve(urlFrom) : null;
    const t = urlTo ? resolve(urlTo) : null;
    if (urlFrom && !f) { el.inFrom.value = urlFrom; failText(SAY.notFound(urlFrom)); return; }
    if (urlTo && !t) { el.inTo.value = urlTo; failText(SAY.notFound(urlTo)); return; }
    state.from = f; state.to = t;
    if (f) el.inFrom.value = f.display;
    if (t) el.inTo.value = t.display;
    if (!f || !t) { openSheet(); return; }
    const viaQ = q.get('via');
    if (viaQ) {
      const r0 = computeRoute(G, f, t, { avoidStairs: q.get('step') === 'free' });
      if (r0.ok) {
        const kind = { cafe: 'Coffee', coffee: 'Coffee', food: 'Food', store: 'Store' }[viaQ.toLowerCase()];
        if (kind) {
          state.viaKind = kind; state.viaList = stopCandidates(G, r0, kind); state.viaAt = 0;
          if (state.viaList.length) state.via = state.viaList[0].i;
        } else {
          const n = norm(viaQ);
          for (let i = 0; i < G.poi.length; i++) if (norm(G.poi[i][4]).startsWith(n)) { state.via = i; state.viaKind = 'Coffee'; state.viaList = [{ i, off: 0, name: G.poi[i][4] }]; break; }
        }
      }
    }
    state.avoid = q.get('step') === 'free';
    run({ fit: q.get('fit') === '1' });
  }
  function failText(msg) {
    buildUI();
    el.sheet.classList.remove('hidden');
    el.hint.textContent = msg;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 9. PUBLIC API + BOOT
  // ══════════════════════════════════════════════════════════════════════════
  window.wayfindSearch = function (s) { return search(s).map(e => ({ code: e.code, name: e.display, routable: e.routable, doors: e.doors.length })); };
  window.wayfindStats = function () {
    return {
      loaded: !!G, enabled: ENABLED, drawn: layersAdded && !!state.route,
      meta: G ? G.meta : null, timings: Object.assign({}, stats),
      asOf: G ? G.asOf : null,
      // Z5's gates, readable from a test rather than inferred from a frame
      // rate: `pulseRAF` is the loop, `pulseDetach` is whether it is merely
      // parked (listeners still armed) or finished for good.
      pulseRunning: !!pulseRAF, pulseArmed: !!pulseDetach,
    };
  };
  window.wayfindClear = clear;
  window.wayfindRoute = async function (from, to, opts) {
    opts = opts || {};
    await loadGraph();
    const f = resolve(from), t = resolve(to);
    if (!f || !t) return { ok: false, why: 'notfound', from: f, to: t };
    buildUI();
    state.from = f; state.to = t;
    el.inFrom.value = f.display; el.inTo.value = t.display;
    state.avoid = !!opts.avoidStairs;
    state.via = null; state.viaKind = null;
    if (opts.via) {
      const r0 = computeRoute(G, f, t, { avoidStairs: state.avoid });
      if (r0.ok) {
        state.viaKind = opts.via; state.viaList = stopCandidates(G, r0, opts.via); state.viaAt = 0;
        if (state.viaList.length) state.via = state.viaList[0].i;
      }
    }
    run({ fit: !!opts.fit });
    if (opts.expand) { state.expanded = true; renderPill(); }
    const r = state.route;
    if (!r || !r.ok) return { ok: false, why: r ? r.why : 'noroute' };
    // The bbox and a point-on-route come back with the answer so a verify
    // script can pose a camera from the route itself rather than from a guess.
    const pts = r.geom.line.concat([doorLL(G, r.fromDoor), doorLL(G, r.toDoor)]);
    let w = 180, s = 90, e = -180, n = -90;
    for (const p of pts) { w = Math.min(w, p[0]); e = Math.max(e, p[0]); s = Math.min(s, p[1]); n = Math.max(n, p[1]); }
    const at = Math.max(0, Math.min(r.geom.line.length - 2, Math.floor(r.geom.line.length * 0.3)));
    return {
      ok: true, distM: r.distM, lo: r.time.lo, hi: r.time.hi,
      stairSets: r.m.stairSets, signals: r.m.signals,
      headline: el.headline.textContent, sub: el.sub.textContent,
      verdict: el.verdict.textContent,
      fromName: f.display, toName: t.display, fromCode: f.code, toCode: t.code,
      fromDoor: r.fromDoor, toDoor: r.toDoor,
      fromSrc: G.doors[r.fromDoor][5], toSrc: G.doors[r.toDoor][5],
      fromRole: G.doors[r.fromDoor][4], toRole: G.doors[r.toDoor][4],
      fromLinkM: r.fromLinkM, toLinkM: r.toLinkM,
      ms: r.ms, vertices: r.geom.line.length,
      bbox: [w, s, e, n], centre: [(w + e) / 2, (s + n) / 2],
      on: r.geom.line[at], onNext: r.geom.line[at + 1] || r.geom.line[at],
      via: r.via ? { name: r.via.name, cat: r.via.cat, hours: r.via.hours } : null,
    };
  };

  function boot() {
    const map = window.__map;
    if (!map) return setTimeout(boot, 60);

    // Same wrap js/places.js uses. Retint is a no-op until a route exists, so
    // this costs nothing on an app nobody has routed on.
    const hookTod = () => {
      if (typeof window.applyTimeOfDay !== 'function' || window.__wayfindTodHooked) return;
      const prev = window.applyTimeOfDay;
      const wrapped = function (m, p, force) {
        const r = prev.apply(this, arguments);
        try { retint(m); } catch (e) {}
        return r;
      };
      window.applyTimeOfDay = wrapped;
      window.__wayfindTodHooked = true;
    };

    const go = () => {
      if (!map.getLayer('buildings-3d')) return setTimeout(go, 120);
      hookTod();
      buildUI();
      // `/` opens the field on desktop. The app already uses W A S D Q E R P T
      // and `?`; `/` is free, and js/controls.js:1270 already ignores keystrokes
      // aimed at a text input, so typing WEL cannot fly the camera west.
      window.addEventListener('keydown', (ev) => {
        const tag = (ev.target && ev.target.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        if (ev.key === '/') { ev.preventDefault(); openSheet(); }
      });
      applyURL();
    };
    if (map.isStyleLoaded && map.isStyleLoaded()) go();
    else map.once('load', () => setTimeout(go, 0));
  }
  boot();
})();
