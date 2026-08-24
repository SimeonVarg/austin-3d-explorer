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
    // THE WAIT IS COMPUTED, NOT QUOTED. §11's permitted sentence was written
    // with TWO crossings in it — "add up to a minute and a half" is exactly
    // 2 x SIGNAL_WAIT_S — and the build generalised the COUNT while freezing
    // the WAIT. Found 2026-08-16 by routing The Block > RLP, which crosses
    // SEVEN: the card said "a minute and a half" while the range above it had
    // already added five and a quarter minutes for those same lights. A
    // sentence that contradicts the number printed directly above it is worse
    // than no sentence. The allowance now comes off `signalWaitHighS`, the
    // same constant timeRange() uses, so the two can never disagree again;
    // n = 2 still renders §11's wording verbatim. Honesty doc §11, revised.
    signals: (n) => 'Crosses ' + n + ' signalised crossing' + (n === 1 ? '' : 's') +
      ' — add up to ' + waitPhrase(n * WAYFIND.signalWaitHighS) +
      (n === 1 ? ' if the light is against you' : ' if the lights are against you'),
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
    // THE COUNT IS READ, NOT TYPED. §11 permits this sentence and prints it
    // with 189 in it, because 189 was the number of `highway=steps` ways in
    // the 2026-07-30 snapshot. It was typed into this file, so the next
    // Overpass refresh would have moved the graph and left the CLAIM behind —
    // an interface asserting a count of a file it no longer matches. It now
    // comes off `swEdges.size`, the distinct steps-way ids the decoder already
    // builds, which is exactly the set `edgeCost` prices at Infinity when the
    // toggle is on. So the sentence says what the filter did, by construction.
    // Today that is still 189 and the rendered string is unchanged.
    avoidShown: (n) => 'Avoids ' + n + ' mapped staircases. Kerbs and doorways are not checked.',
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

  // The signal-wait allowance, said the way §11 says it and DERIVED from the
  // same constant the range is built from. Rounds OUTWARD to the next half
  // minute, because "add up to" is a ceiling and an undercounted ceiling is
  // the failure mode this whole document exists to prevent. At the shipped
  // `signalWaitHighS` 45 this reads: 1 crossing "45 seconds", 2 "a minute and
  // a half" (§11 verbatim), 4 "3 minutes", 7 "5 and a half minutes".
  function waitPhrase(sec) {
    if (sec < 60) return Math.round(sec) + ' seconds';
    const halves = Math.ceil(sec / 30);
    const whole = Math.floor(halves / 2), half = halves % 2 === 1;
    if (whole === 1) return half ? 'a minute and a half' : 'a minute';
    return whole + (half ? ' and a half minutes' : ' minutes');
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
    // THE REGISTER MERGE (QUEUE Z3). 63 of UT's 198 register codes are not in
    // walk_graph.json at all (85 when this was written, 78 before the door
    // pass of 2026-08-16), and an empty result list reads as "you typed it
    // wrong" rather than "we don't have it". So every register code the graph
    // lacks becomes a findable, non-routable entry that gets the honest answer
    // (`SMC is not walkable in this build yet`). Actually ROUTING them is the
    // bake's job — scripts/bake_walk.py, QUEUE Z3/Z4 — not this file's, and
    // the count above is a comment: nothing renders it, so it cannot go stale
    // in the interface the way `avoidShown`'s 189 was about to.
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

  /**
   * MEASURED, THEN NOT DONE. `padding: fitPadPx` is one number on all four
   * sides, and the obvious complaint is that the top of a phone frame is not
   * empty — the answer bar is sitting in it, 172-220 px of it. So this fit grew
   * a bar-aware top padding, and then the claim was measured rather than
   * believed: every vertex of the drawn path projected to screen after a real
   * `Show route`, counted against the bar's own measured bottom edge, on three
   * routes of 30, 66 and 86 vertices at 390 x 844.
   *
   *   padding                      JES>WEL   21 Rio>WEL   JES>ANB
   *   uniform 90                    100 %       100 %       100 %
   *   90 + the bar on top           100 %       100 %       100 %
   *   90 + the bar at the bottom    100 %        59 %        45 %
   *
   * A fit at `fitPitch` 55 already lands the whole route in the lower half of
   * the frame: MapLibre's `cameraForBounds` solves the bounds unpitched and
   * applies the pitch afterwards, so the tilt carries the content down the
   * screen on its own and there is nothing left for the padding to fix. The
   * bar-aware version was three functions and a clamp that moved no pixel, and
   * the mirror-image "pad the bottom instead" — which reads just as plausible —
   * is the one that would have broken it, on the two longest routes.
   *
   * So the padding stays one number. Written down because the next person to
   * look at a phone frame will have the same idea.
   */
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
      // ROUND 6: AND NOT IF SOMEBODY IS ALREADY WALKING IT. This poll is
      // waiting for the camera to go quiet, and `Walk it` produces exactly that
      // quiet — it calls `map.stop()` and then jumps. So a person who tapped
      // `Walk it` while this was still waiting for the opening flight got their
      // walk framed away from under them at ~900 m, which is the number round
      // 1's critic reported. The deep link loses its fit; the person standing
      // on the pavement keeps their view. See holdWalk.
      if (walkHold) return;
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
  //
  // The whole feature is TWO objects and there is never more than one of them
  // on screen: the QUESTION (`#wf-sheet`, one field per end) and the ANSWER
  // (`#wf-pill`, which takes over the title pill's slot). Picking a building
  // closes the question, because an answer sitting under the form that asked
  // for it is two panels.
  //
  // ── WHAT CHANGED IN THIS PASS, AND WHY (acer/w-ui, 2026-08-23) ────────────
  // The answer was a centred paragraph of 12 px text: `6-8 min walk · 530 m ·
  // No stairs on this route` set as one run, with the door line under it. Three
  // things were wrong with it at 390x844, all of them photographed first:
  //
  //   1. THE MOBILE RULE FOR #wf-pill WAS DEAD. `style.css` had a stray `*/`
  //      inside the QUEUE Z7 comment above it, so the comment closed early and
  //      four lines of English became the rule's selector. An invalid selector
  //      drops the whole rule, so on a phone the answer fell back to the
  //      desktop `left:50%` — which is exactly the 197 px column Z7 was written
  //      to kill. It had been silently un-fixed. Photographed at 390x844: the
  //      headline on two lines, `Show route` wrapping inside its own button,
  //      the bar sitting on top of the three top-row buttons.
  //   2. NOTHING SAID THE PILL OPENED. The card was behind a tap on an element
  //      with no affordance at all. There is now a chevron, and it turns.
  //   3. THE APP KNEW WHERE THE CAMERA WAS AND NEVER SAID SO. You could be
  //      standing halfway along the route and the bar still read the whole
  //      journey. That is the one thing this app can do that a maps app cannot,
  //      and it was on the floor.
  //
  // So the answer is now a real bar: a figure line with the minutes at 26 px, a
  // STRIP showing where the staircases and the signalised crossings fall along
  // the route, the destination and its door, and — when the view is actually on
  // the route — a WALKING READOUT that replaces the figure line with what is
  // left and an arrow pointing at the next turn.
  //
  // ── THE STRINGS DID NOT MOVE ──────────────────────────────────────────────
  // `#wf-headline`, `#wf-sub` and `#wf-verdict` still exist, still hold exactly
  // the strings §11 permits, and `.textContent` on each still returns the same
  // sentence it returned before this pass — the typography is spans INSIDE
  // them, so `wayfindRoute()`'s return value is byte-identical. Nothing that
  // reads this UI from a test had to change.
  // ══════════════════════════════════════════════════════════════════════════

  // ── TASTE, interface half (CLAUDE.md rule 11) ─────────────────────────────
  // A SEPARATE BLOCK ON PURPOSE. Four lanes are editing this file at once and
  // `WAYFIND` is the one object all four of them want to append to; a second
  // named block is the same rule-11 promise (every judgement is one line, in
  // one place) without four lanes queuing on the same twenty lines. Everything
  // that is a NUMBER lives here; everything that is a SIZE or a COLOUR is a
  // custom property on `#wf-pill` in style.css, named the same way and listed
  // in the block comment there.
  const WF_UI = {
    // The walking readout. It is not a mode you switch on: the bar shows it
    // when the VIEW is on the route, and goes back to the summary when it is
    // not. Both gates are needed — from 300 m up you are directly over the
    // ribbon and you are not walking it.
    liveOnRouteM: 45,      // perpendicular distance from the drawn path
    liveAltMaxM: 90,       // camera altitude; above this you are looking at it
    liveHz: 6,             // DOM writes a second WHILE THE CAMERA MOVES. Zero
                           // at rest: this is a `move` handler, not a loop, so
                           // a parked camera costs nothing at all. (The pulse's
                           // Z5 finding was about a style write every frame
                           // FOREVER; this is a textContent write, and it stops
                           // the moment the camera does.)
    liveMinMoveM: 1.0,     // below this the readout would only flicker
    arriveM: 15,           // this close to the end, say so instead of counting
    turnAheadMinM: 8,      // a turn nearer than this is one you are in
    // The strip. Fractions of the route, so they hold at any width.
    pipMergeT: 0.03,       // two pips closer than this would overlap; the
                           // second is dropped and the first is labelled with
                           // the count, because a smear of dots is not a fact.
                           // RAISED FROM 0.018, and the reason is that a MERGED
                           // pip is wider than an unmerged one — a capsule of
                           // three is 19 px, so it needs about 5.5 % of a 342 px
                           // rail of clearance and the old threshold only bought
                           // it 1.8 %. Photographed on JES -> ANB at 390 x 844:
                           // a capsule of three and a single dot 20 m apart drew
                           // ON TOP of each other, and the result on the rail
                           // was a blue pill with a paler circle inside it —
                           // i.e. an iOS toggle switch, sitting on the one
                           // element in this bar that already had to be argued
                           // out of looking like a slider. At 0.03 they are one
                           // capsule of four, which is also the number the card
                           // prints two lines below.
    stripMinPipT: 0.01,    // a pip exactly on an end would be half off the rail
    // A RAIL WITH NOTHING ON IT IS A SLIDER AT 100 %, and this is the THIRD
    // round this one element has had to be argued out of being a control.
    // Round 4's fix — every mark cuts a notch clean through the band, so it
    // comes apart into the stretches of uninterrupted walking — is the right
    // fix and it cannot help the case with no marks in it. Photographed at
    // 390 x 844 on JES -> WEL, the commonest shape of route there is (`No
    // stairs on this route`, no crossings): one continuous amber band, empty,
    // with a bright round amber ring at the right end. That is a slider at
    // 100 % and it is nothing else, and it is carrying ZERO information — the
    // line directly above it already says there is nothing on this walk.
    // So the picture is drawn only when there is something to picture.
    //
    // AND THE SAME RULE HOLDS WHILE WALKING, which was not the first cut. The
    // first cut kept the rail on the move, on the reasoning that the playhead
    // is itself a fact — how far along you are. Photographed walking JES -> WEL
    // at 390 x 844, that is an empty band with a white bar sitting near its
    // left end and a bright ring at the right: a volume slider at five per
    // cent, which is word for word what round 4 said about the shape it had
    // just spent a round killing. And the fact is not lost — `6–8 min walk
    // REMAINING · 520 m`, directly above it, is the same progress in words.
    // One rule: the rail is drawn when the walk has something on it, in both
    // states, and otherwise the sentences carry it.
    stripNeedsMarks: true,
    // THE KEY under the strip. A `title` attribute is not reachable on a phone,
    // which is the only device this bar is judged at, so the marks were three
    // colours of dot with nothing anywhere saying what a colour meant. The key
    // is drawn from the SAME counts the card prints — `r.m.stairSets`,
    // `r.m.signals` — so the picture and the sentences cannot disagree.
    keyOn: true,
    // ── ROUND 7: THE SPINE ────────────────────────────────────────────────
    // ROUND 5 DELETED THE ONLY THING HOLDING THE TWO ENDS TOGETHER AND NOBODY
    // LOOKED AT WHAT WAS LEFT. Round 4 gave the origin line a tick and the
    // destination line a ring, "identical shapes to .wf-cap-a and .wf-cap-b on
    // the rail — so the origin line, the rail and the destination line are
    // visibly one object" (style.css says exactly that, and it was true).
    // Round 5 then stopped drawing the rail on any route with nothing on it,
    // which is most short walks — and on those routes the sentence above is a
    // claim about an object that is no longer there. Photographed at 390 x 844
    // on JES -> WEL: a tick, then two rows of figures at a DIFFERENT left edge,
    // then a ring. Two stray marks, not a journey.
    //
    // The spine is the rail stood on its end: a hairline down the same gutter
    // both name lines are already indented into, from the tick to the ring,
    // behind the text. It adds no row, no word and no claim — it is the two
    // marks the bar already draws, joined. It is drawn ONLY when the rail is
    // not, so the bar never carries two pictures of one walk.
    spineOn: true,
    spineMinPx: 10,        // below this the two marks are on adjacent lines and
                           // a stub between them is noise, not structure.
    // Which way the route turns at the next turn, in words, because the arrow
    // says where the turn IS and not which way it goes. Beyond this many
    // degrees the turn is described as a sharp one.
    turnSharpDeg: 100,
    // The empty sheet. Four codes a first-time user can tap instead of
    // wondering what the field wants. Ordered by how likely a freshman is to
    // be going there, not alphabetically.
    exampleCodes: ['WEL', 'PCL', 'GDC', 'JES'],

    // ── THE ITINERARY (round 3) ───────────────────────────────────────────
    // The strip says WHERE the things on this route are, as a picture. The
    // itinerary says WHAT THEY ARE, in order, as a list — which is the one
    // shape every walking-directions app in the world has and this bar did
    // not. It is derived entirely from the drawn line: the distance between
    // consecutive events, the sign of the bearing change at a vertex, and the
    // marks the strip already draws. It names no street, because the graph
    // carries no street names, and it gives no instruction — the rows read
    // `then left`, the same audited wording the walking readout uses.
    stepsOn: true,
    stepsMax: 10,          // event rows the list will hold before it prunes
                           // turns it would otherwise have kept
    stepTurnMinLegM: 40,   // A TURN IS A DECISION ONLY IF THERE IS WALKING
                           // AROUND IT. With no rule here, JES -> DKR listed
                           // twelve turns for 580 m — a `then right` every
                           // fifteen metres, describing the wander of the
                           // pavement rather than the walk. A turn is kept when
                           // the longer of its two legs reaches this; below it
                           // the turn is dropped and its two legs merge, so the
                           // distances still sum to the route. Staircases,
                           // crossings and the stop are never pruned.
    stepMergeM: 14,        // the FLOOR on the merge distance. The real one is
                           // `pipMergeT` of the route, so the list merges where
                           // the rail merges and the two can never print
                           // different counts of the same four lights. Turns
                           // merge only when they go the SAME WAY: a
                           // left-then-right jink is two facts and collapsing
                           // it would invent one.
    // THE CARD STOPS ABOVE THE DRIVE CONTROLS, MEASURED. style.css caps the
    // card with `100vh - (bar top + 168px + --drive-clear)`, where the 168 is a
    // GUESS at the closed bar's height — and the closed bar is 173 px with
    // nothing to say and 249 px with a passing-period warning and a wrapped
    // action row. Photographed on JES -> ANB at 390 x 844, the open card ran to
    // y739 and the joystick ring (which draws ABOVE the bar) punched an orange
    // circle straight through the middle of the itinerary. The guess cannot be
    // right for both bars, so the card is sized from where it actually starts.
    // The CSS rule stays as the pre-script fallback.
    cardGapPx: 8,          // air between the card's bottom and the controls
    cardMinPx: 150,        // never squeeze it below something worth scrolling
    // ── WALK IT (round 4) ─────────────────────────────────────────────────
    // THE DURING-WALK VIEW HAD NO DOOR INTO IT. Everything in §7d — the
    // manoeuvre disc, `27 m, then left`, `and then right`, the remaining
    // figures — arms itself on `body.wf-live`, which arms when the CAMERA is
    // on the route under `liveAltMaxM`. Nothing in the interface ever put the
    // camera there. Three rounds of this lane photographed that readout by
    // flying a test harness onto the line; a person holding the phone had to
    // find the route from 300 m up and fly down onto it by hand, and there was
    // no reason for them to believe there was anything down there to find. So
    // half of what this bar can say was unreachable from the bar.
    //
    // `Walk it` is the door. It stands the eye at the first point of the route
    // that is CLEAR OF EVERY BUILDING, facing the way the route goes, at the
    // height the app's own walking mode uses. It is the primary action now and
    // `Show route` — which frames the line from above — is the secondary,
    // because the thing this app has that a maps app does not is the walk
    // itself, not another aerial of it.
    walkItOn: true,
    walkAltM: 1.7,         // eye height. The app's own walking altitude.
    walkPitch: 85,         // and its own walking pitch — looking down the path.
    // THE CLEARANCE SEARCH IS NOT OPTIONAL AND THIS IS THE LANE THAT LEARNED
    // IT. A pose placed at a door is placed ON A WALL: the door is a point on
    // the building's outline, and `js/controls.js` answers a camera inside
    // geometry by lifting it onto the roof — so `Walk it` without a search puts
    // you forty metres up looking at a rooftop, which is precisely the "camera
    // buried inside a surface" that voided two rounds of work on this project.
    // The route's own line walks away from the door onto the path, so the
    // search is: step along it until `__fly.roofAt` reads zero.
    // MEASURED, NOT COPIED. The first cut used 7 m — the radius the verify
    // harness's `findStart` uses to drop a camera on open ground — and on
    // `JES -> DKR` it found nothing in 140 m and the button silently did
    // nothing, because a pavement three metres from a wall never has seven
    // clear metres around it. `js/controls.js` itself walks at
    // `R_CAM_GROUND = 1.0`: at walking altitude the app asks "is there a roof
    // within one metre of me", not seven. 2 m is that, with a metre of margin.
    walkClearR: 2.0,       // metres of radius that must read 0 to stand there
    walkStepM: 4,          // how far along the line each probe steps
    walkMaxM: 200,         // stop looking after this much route
    // The camera moves by `jumpTo`, and `js/controls.js` only re-reads the map
    // on its OWN next tick (`syncFromMap`, and only while nothing is driving),
    // so for a frame or two `__fly.eye()` still reports where you were. The
    // walking readout is built off `__fly.eye()`, so asking it once on the next
    // frame asks it while the answer is still stale — measured, and the bar
    // stayed on the summary layout with the camera standing on the route. It
    // is asked a few times over half a second instead, and it stops as soon as
    // the answer changes.
    walkSettleMs: 90,
    walkSettleN: 8,
    // ROUND 7. The burst above is armed all at once and is therefore over
    // 720 ms after the tap — and the walk is not settled at 720 ms. See the
    // tail's own note at the bottom of `walkIt` for the measurement. These
    // three are the whole of it and all three are taste values.
    walkSettleTailOn: true,
    walkSettleTailMs: 250,   // four looks a second, each one projection
    walkSettleMaxMs: 10000,  // >= walkHoldMs, because that is exactly the
                             // window in which something can still put the
                             // camera back on the pavement. It stops the
                             // instant the readout arms, which is usually
                             // before this chain runs at all.
    // ── ROUND 6: THE HOLD ─────────────────────────────────────────────────
    // Measured, 3 runs of 3: `Walk it` put the eye at 1.70 m and js/app.js's
    // opening flight put it back at 158 m two and a half seconds later, with
    // no input. See holdWalk's header for the trace and for why a real finger
    // dodges it by coincidence rather than by design. These five numbers are
    // the whole of the defence and every one of them is a taste value.
    walkHoldOn: true,
    walkHoldMs: 9000,      // how long after the tap the walk owns the camera.
                           // Long enough to outlast the intro's second leg
                           // (which lands 2-3 s after the tap) and a stalled
                           // `?fit=1` poll, short enough that it is over before
                           // anybody has finished reading the bar.
    walkHoldPollMs: 200,   // five looks a second. It is one `eye()` read and a
                           // distance while it is armed, and nothing at all
                           // afterwards.
    walkHoldAltM: 12,      // above this the eye is not on the pavement any
                           // more. Well clear of the 1.7 m we stand at and of
                           // the metre or two the controller's own ground net
                           // moves it by, and well under `liveAltMaxM` (90) so
                           // the hold fires long before the readout would give
                           // up and fall back to the summary layout.
    walkHoldSlipM: 60,     // ...or this far off the spot we stood on. Catches
                           // a lateral yank (a pending fitBounds recentres
                           // before it climbs) without firing on the metre of
                           // settle the controller does on arrival.
    walkHoldMaxN: 3,       // AND THEN IT GIVES UP. A camera that fights back
                           // forever is worse than one that loses once: if
                           // three re-takes have not stuck, something we do not
                           // model is driving, and flickering is the one
                           // outcome worse than being lifted out.
    // A FEW STEPS IN, NOT ON THE JOINT. At pitch 85 and 1.7 m the bottom of the
    // frame is a metre or two in front of your shoes, so standing exactly on
    // the vertex where the route turns fills the near field with the segment
    // you have just left. Measured on `JES -> DKR`: the eye was on the line,
    // the readout armed correctly, and the ribbon changed only 1 of 5 sampled
    // pixels down the centre of the lower half because the walk started off to
    // the left. Advancing along the segment you FACE puts the ribbon under
    // your feet and running to the horizon, which is the shot.
    walkLeadM: 5,
    // AND YOU LOOK DOWN THE WALK, NOT ALONG ONE SEGMENT OF IT. Facing along the
    // segment underfoot is right on a straight path and wrong on a curved one:
    // measured on `JES -> DKR`, the eye stood exactly on the line with zero
    // degrees of deviation from its segment and the ribbon still crossed only
    // 23 % of the centre strip, because the walk bends away inside the first
    // twenty metres. Aiming at a point this far along the polyline keeps the
    // route in the middle of the frame through a bend, which is what a person
    // looking down a path does with their head.
    walkLookM: 25,
    // ── ROUND 5 ───────────────────────────────────────────────────────────
    // THE WAY BACK OUT OF THE WALK. Round 4 gave the bar a door IN (`Walk it`)
    // and left it with no door out: photographed at 390 x 844 on both walking
    // routes, the only control on the bar while standing on the route was the
    // ✕, and the ✕ DELETES THE ANSWER. A person who taps it to get back to the
    // map is standing at eye level in the middle of campus with no route and
    // has to type both ends again. So `Show route` — which is exactly the
    // "lift me out and frame the whole thing" every navigation app offers in
    // its GO screen — comes back while walking, and the pair reads as the
    // toggle it always was: `Walk it` puts you on the pavement, `Show route`
    // takes you back up. `Walk it` itself stays hidden while walking; you are
    // already there.
    liveShowRoute: true,
    // HOW LONG THE READOUT KEEPS ASKING AFTER A MOVE ENDS. `__fly.eye()` lags a
    // map-driven move by a tick or two (see onCamEnd), and the sample taken on
    // `moveend` can be the camera you have already left. Eight asks 110 ms
    // apart covers ~0.9 s of controller lag; it stops at the first one that
    // changes anything, and a parked camera that has not moved still costs
    // nothing once they are done.
    endSettleN: 8,
    endSettleMs: 110,
    // AND THE PASSING-PERIOD LINE IS RE-ASKED OF WHAT IS LEFT. It was computed
    // once, off the WHOLE route's time range, and never recomputed — so three
    // minutes from the door the bar still read `Tight for a 15-minute passing
    // period` about a walk that was nearly over. That is the identical defect
    // round 4 fixed one row higher up (`Stairs: 3 sets` counting sets already
    // behind you) left in place one row lower down. `live.rem.time` is the same
    // range arithmetic over the same permitted wording, run on the part of the
    // route that is left — the same measurement class as `remaining` and as the
    // `ahead` counts, both already audited. The rule stays one-sided (§15):
    // over -> say so, crossing -> say it is tight, under -> SAY NOTHING. So it
    // goes quiet as you get close, which is the honest thing for it to do, and
    // the row it frees is what lets the way out sit beside `and then left`
    // instead of under it.
    liveVerdictRemaining: true,
    // ── ROUND 6: THE ENTRANCE CALLOUT ARRIVES WHEN YOU DO ─────────────────
    // `Entrances are on this side` is the single most valuable thing this app
    // says — it is the whole reason the feature exists and no maps app says it
    // — and while walking it was printed on the bar for the ENTIRE journey,
    // where it is the longest line on a 342 px phone bar and, six minutes from
    // the door, not yet a fact you can act on. Round 1's critic measured the
    // walking bar as "current turn + remaining ETA + destination note + next
    // step + two buttons stacked into a single persistent card... denser and
    // more capable but not calmer, which was the brief."
    //
    // So it holds until the walk has this far left, and then it appears. The
    // building's NAME stays on the bar the whole way — you never lose track of
    // where you are going — and the sentence about which face of it to aim for
    // turns up at about the point you can see the building. Nothing is deleted
    // and `#wf-sub`.textContent is unchanged in both states (the phrase is
    // hidden in CSS, the same way the middot beside it already is), so every
    // honesty gate and verify script that reads that string still reads it.
    liveDoorNoteOnApproach: true,
    liveDoorNoteM: 160,    // metres of route left when the door phrase appears.
                           // About two minutes at this app's own walking speed,
                           // and further than the longest sightline on the
                           // malls — you are looking at the building by then.
    // THE WORD ON THE DOOR. The itinerary — the one shape this bar shares with
    // every walking-directions app on the phone — sits behind a bare 28 px
    // chevron in the corner with nothing anywhere saying it is there. Round 2
    // took `Show route` out from behind that chevron for exactly this reason
    // and left the list behind it. A label costs about 40 px of a row whose
    // only other tenant is a building name that already ellipsizes.
    stepsPeekOn: true,
    stepMinLegM: 12,       // shorter than this and the distance row is noise —
                           // the 10 m of median between the two halves of a
                           // divided crossing is not a leg of anybody's walk.
                           // (It is also below the point where `fmtDist` starts
                           // printing a decimal: `10.0 m` is the formatter's
                           // sub-10-metre branch catching a rounded 9.96, and
                           // that formatter is not this lane's to change — the
                           // one-line patch is written into docs/walk-ui.md.)
  };

  // ── LABELS, and why they are not in SAY ───────────────────────────────────
  // `SAY` is quotations from §11 of the honesty doc: the sentences that make a
  // CLAIM about the campus, the route or the time. Everything below is a LABEL
  // — a word naming a control or a part of the picture — and none of it asserts
  // anything that could be true or false about the world. They are collected
  // here anyway, in one block, so that a future honesty pass can audit the
  // whole readable surface from two places instead of hunting the file.
  //
  // The two that come closest to being claims, and the reasoning:
  //   `remaining` — the route's own length minus how far along it the CAMERA
  //     is. It is a measurement of the drawn line and of the view, both of
  //     which we have exactly. It says nothing about where the person is
  //     standing (§12's `You are here`), and the minutes beside it are the
  //     same range arithmetic, over the same permitted wording, run on the
  //     part of the route that is left.
  //   `to the next turn` — a distance along the drawn line to the next vertex
  //     where the bearing changes by more than `WAYFIND.turnMinDeg`. It names
  //     no street, because the graph carries no street names, and it gives no
  //     instruction beyond what the ribbon on the ground already shows.
  //   `then left` / `then right` — ROUND 2. The sign of that same bearing
  //     change. It is a description of the line already painted on the ground,
  //     not an instruction: the wording is `340 m, then left`, never `turn
  //     left`, because we are saying what the route does and not telling
  //     anybody what to do. It names no street for the same reason as above.
  //     Without it the readout knew the turn was coming and would not say
  //     which way it went, and the 24 px arrow beside it is the whole of what
  //     a person had to read that off — which is exactly the kind of thing
  //     that is legible on a laptop and gone on a phone in sunlight.
  const SAY_UI = {
    remaining: 'remaining',
    unitMin: 'min walk',
    toNextTurn: 'to the next turn',
    toTheEnd: 'to the end of the route',
    atTheEnd: 'You are at the end of the drawn route',
    // ROUND 3. THE ONE AFTER. `24 m, then left` says what happens next; this
    // says what the line does after that, and it is deliberately a DIRECTION
    // WITH NO DISTANCE — a second number on the bar would be read as the
    // distance to the first turn by anybody glancing, and the direction alone
    // is the part that decides which side of the path to walk on. It reads as
    // the continuation of the sentence above it: `24 m, then left` / `and then
    // right`.
    andThen: 'and ',
    thenLeft: 'then left',
    thenRight: 'then right',
    thenSharpLeft: 'then a sharp left',
    thenSharpRight: 'then a sharp right',
    fromMark: 'Where the route starts',
    toMark: 'Where the route ends',
    pipStairs: 'A staircase OpenStreetMap has mapped',
    pipSignal: 'A signalised crossing',
    pipStairsN: (n) => n + ' staircases OpenStreetMap has mapped',
    pipSignalN: (n) => n + ' signalised crossings',
    pipVia: 'The stop on the way',
    capStart: 'Start of the route',
    // ROUND 3. The heading over the itinerary. `Step by step` is a label for a
    // list of things the drawn line does; it promises no instruction and no
    // street name, both of which §12 forbids and neither of which the rows
    // contain.
    stepsTitle: 'Step by step',
    // ROUND 4. The label on the door into the walking readout. It names a
    // control and claims nothing: tapping it moves the CAMERA to the start of
    // the drawn line at eye level. It does not say you will make it, how long
    // you will take, or that the way is passable — all of which the bar above
    // it is already careful not to say.
    walkIt: 'Walk it',
    walkItHint: 'Stand at the start of this route, at eye level',
    // ROUND 5. The word on the chevron. `Steps` names the list behind it and
    // claims nothing — the rows of that list are the drawn line measured, and
    // the label promises no street name and no instruction, neither of which
    // they contain.
    stepsPeek: 'Steps',
    // ROUND 4. WHAT IS STILL IN FRONT OF YOU. While walking, the third line of
    // the bar was the WHOLE-ROUTE figure line demoted to footnote size — a
    // second complete trip summary under the first, and a stale one: `Stairs:
    // 3 sets` counts sets you may already have climbed. The marks past the
    // camera's own projection onto the line are the same measurement class as
    // `remaining` (see the note above), and they are the ones that change what
    // you do next.
    aheadTag: 'ahead',
    // THE COUNTS, IN THE WORDS A NAV BAR HAS ROOM FOR. Photographed walking
    // 21 Rio -> WEL at 390 x 844, the legend's own strings wrapped this row
    // onto two lines — `3 staircases OpenStreetMap has mapped` / `2 signalised
    // crossings AHEAD` — because they are written for a legend you read
    // standing still, where naming the source is the whole point of the row.
    // On the move the row is a count of the marks left on the drawn line, the
    // same measurement as `remaining`, and it fits on one. WHAT IS STILL
    // NAMED: signalised, because a signalised crossing and an unsignalised one
    // are different facts about the walk. WHAT IS NOT: OpenStreetMap, which
    // the details card states in full two lines below and the standing legend
    // still carries.
    aheadStairsN: (n) => n + (n === 1 ? ' staircase' : ' staircases'),
    aheadSignalN: (n) => n + (n === 1 ? ' signalised crossing' : ' signalised crossings'),
    details: 'Details',
    hideDetails: 'Hide details',
    swap: 'Swap the two ends',
    clearField: 'Clear this field',
    tryLabel: 'Try',
  };

  let el = null, state = { from: null, to: null, route: null, avoid: false, via: null,
    viaKind: null, viaList: [], viaAt: 0, viaNote: null, expanded: false };
  // The walking readout's own state. `prof` is the route measured segment by
  // segment (see routeProfile); `live` is the last projection of the camera
  // onto it, or null when the view is not on the route.
  let prof = null, live = null, liveHooked = false, liveAt = 0, liveFrom = null;
  // ROUND 6. The walk's claim on the camera — see holdWalk. Null except in the
  // few seconds after `Walk it`, and released by the first thing the person
  // touches.
  let walkHold = null;

  function h(tag, cls, txt) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  }
  // One helper for every icon in the feature, so no icon is a font glyph that
  // may or may not exist on the device (`⤡` and `✕` were, and both render at a
  // different size on Android than on this laptop).
  function icon(cls, d, w) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', w || 2);
    s.setAttribute('stroke-linecap', 'round');
    s.setAttribute('stroke-linejoin', 'round');
    s.setAttribute('aria-hidden', 'true');
    if (cls) s.setAttribute('class', cls);
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d);
    s.appendChild(p);
    return s;
  }
  const IC = {
    chev: 'M6 9.5 12 15.5 18 9.5',
    close: 'M6 6 18 18M18 6 6 18',
    swap: 'M7 4v16M7 4 4 7.5M7 4l3 3.5M17 20V4M17 20l3-3.5M17 20l-3-3.5',
    arrow: 'M12 3.5 12 20.5M12 3.5 5.5 11M12 3.5 18.5 11',
    // THE MANOEUVRE, not a compass bearing — see renderLive. A shaft coming up
    // from the bottom of the disc and hooking the way the route goes.
    turnLeft: 'M13.5 21V12a3.5 3.5 0 0 0-3.5-3.5H5.2M8.6 4.6 4.2 8.5l4.4 3.9',
    turnRight: 'M10.5 21v-9a3.5 3.5 0 0 1 3.5-3.5h4.8M15.4 4.6l4.4 3.9-4.4 3.9',
    pin: 'M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11z M12 10.2v.01',
    // A DOORWAY, not a pin. The destination line's job is to say WHICH DOOR,
    // which is the one thing a maps app will not tell you here, and a map pin
    // says "a place" — the same glyph every other row of every other app uses.
    door: 'M15.5 21V4.2a1 1 0 0 0-1.2-1L6.7 4.7a1 1 0 0 0-.7.97V21M4 21h13M12.6 12.4v.01',
    // The route frames itself: a rectangle with two corners pulled out.
    frame: 'M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15',
    // ROUND 3. THE MODE, on the figure line. Every walking-directions screen
    // ever shipped says WALKING before it says a number, and this bar said it
    // nowhere: `6-8 min walk` carried the whole claim in a 12.5 px word at the
    // end of a sentence. A walking figure in front of the minutes says it at a
    // glance and costs no character of `#wf-headline`.textContent, because an
    // <svg> contributes nothing to it.
    walk: 'M13.7 2.9a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 1 0 0-3.5' +
      'M14.9 21.4 13.2 15.1 10.3 12.7 11.5 7.9' +
      'M11.5 7.9 15.3 9.7 17 12.9' +
      'M11.5 7.9 8.4 9.5 7.2 12.6' +
      'M10.3 12.7 7.5 17.4',
  };

  // ══════════════════════════════════════════════════════════════════════════
  // 7a. THE ROUTE, MEASURED FOR THE PICTURE
  //
  // Everything the strip and the walking readout need comes out of ONE walk of
  // the route, done once when the route is drawn. `leg.nodes[i] -> leg.edges[i]
  // -> leg.nodes[i+1]` is exact by construction (dijkstra builds the two arrays
  // together), so every segment carries its own true length and its own flags.
  // Nothing here estimates or interpolates.
  // ══════════════════════════════════════════════════════════════════════════
  function routeProfile(g, r) {
    const segs = [];
    const push = (a, b, len, f, sid, link) => {
      if (!(len > 0)) return;
      segs.push({ a, b, len, f, sid, link });
    };
    let first = null, last = null;
    for (const leg of r.legs) if (leg.nodes.length) { first = lonlat(g, leg.nodes[0]); break; }
    for (let i = r.legs.length - 1; i >= 0; i--) {
      const leg = r.legs[i];
      if (leg.nodes.length) { last = lonlat(g, leg.nodes[leg.nodes.length - 1]); break; }
    }
    const fd = doorLL(g, r.fromDoor), td = doorLL(g, r.toDoor);
    if (first) push(fd, first, metresBetween(fd, first), 0, -1, true);
    let viaAfter = -1;
    for (let li = 0; li < r.legs.length; li++) {
      const leg = r.legs[li];
      for (let i = 0; i < leg.edges.length; i++) {
        const e = leg.edges[i];
        push(lonlat(g, leg.nodes[i]), lonlat(g, leg.nodes[i + 1]), g.W[e] / 100, g.F[e], g.S[e], false);
      }
      if (li === 0 && r.via) viaAfter = segs.length - 1;
    }
    if (last) push(last, td, metresBetween(last, td), 0, -1, true);

    let total = 0;
    for (const s of segs) { s.at = total; total += s.len; }
    // The bar prints `r.distM`, so the strip and the remaining figure are
    // scaled to that same number rather than to this walk's own sum. The two
    // differ by the metre or two between a door-link COST and the straight line
    // it stands for, and a bar that says `530 m` above a readout that counts
    // down from 532 is a bar arguing with itself.
    const k = total > 0 ? (r.distM / total) : 1;
    return { segs, total, k, viaAfter, distM: r.distM };
  }

  /** Where the staircases, the crossings and the stop fall along the route. */
  function routeMarks(g, r, p) {
    if (!p || !p.total) return [];
    const raw = [];
    const seen = new Set();
    for (let i = 0; i < p.segs.length; i++) {
      const s = p.segs[i];
      if (s.f & F_STEPS) {
        if (!seen.has(s.sid)) { seen.add(s.sid); raw.push({ t: s.at / p.total, kind: 'stairs' }); }
      }
      if (s.f & F_SIGNAL) raw.push({ t: (s.at + s.len / 2) / p.total, kind: 'signal' });
      if (i === p.viaAfter) raw.push({ t: (s.at + s.len) / p.total, kind: 'via' });
    }
    raw.sort((a, b) => a.t - b.t);
    // MERGE, DO NOT SMEAR. Two crossings 12 m apart on a 900 m route are 1.3 %
    // of the strip; drawn as two dots they are one blurred dot that reads as
    // one crossing. Merged, the pip carries the count and its label says two.
    const out = [];
    for (const m of raw) {
      const prev = out[out.length - 1];
      if (prev && prev.kind === m.kind && m.t - prev.t < WF_UI.pipMergeT) { prev.n++; continue; }
      out.push({ t: Math.min(1 - WF_UI.stripMinPipT, Math.max(WF_UI.stripMinPipT, m.t)), kind: m.kind, n: 1 });
    }
    return out;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 7a-ii. THE ITINERARY — the same walk, as a list (round 3)
  //
  // The rail is a picture of WHERE things are. This is the list of WHAT they
  // are, in order, and it is the one shape every walking-directions screen has
  // that this bar did not. Every row comes off the SAME profile the rail and
  // the walking readout are built from — the distance between consecutive
  // events, the signed bearing change at a vertex, and the marks `routeMarks`
  // already draws — so the list, the rail and the sentences cannot disagree.
  //
  // What it deliberately does NOT do: name a street (the graph has none), give
  // an instruction (§12 — the rows are `then left`, a description of the line
  // already painted on the ground), or print a clock time (§3 forbids arrival
  // times outright, which is why there is no `arrive 3:47` on this bar and
  // never will be).
  // ══════════════════════════════════════════════════════════════════════════
  function routeSteps(g, r, p) {
    if (!p || !p.total) return [];
    const ev = [];
    const seen = new Set();
    for (let i = 0; i < p.segs.length; i++) {
      const s = p.segs[i], n = p.segs[i + 1];
      if ((s.f & F_STEPS) && !seen.has(s.sid)) { seen.add(s.sid); ev.push({ at: s.at, kind: 'stairs', n: 1 }); }
      if (s.f & F_SIGNAL) ev.push({ at: s.at + s.len / 2, kind: 'signal', n: 1 });
      if (i === p.viaAfter) ev.push({ at: s.at + s.len, kind: 'via', n: 1 });
      // NOT A TURN IF EITHER SIDE OF IT IS THE DOOR LINK, and this was on the
      // frame the first time the list was drawn: `JES -> WEL` opened with `then
      // a sharp right` before it had walked a metre, and ended with `then a
      // sharp left` at the door. Both were the joint between the routed path
      // and OUR OWN STRAIGHT LINE from the door to the nearest path node —
      // geometry this app drew, not a corner anybody surveyed. Describing a
      // manoeuvre there is asserting something about the world off a line we
      // invented, which is the one thing this feature is not allowed to do.
      // `link` is set by routeProfile on exactly those two segments.
      if (n && !s.link && !n.link) {
        const d = ((bearing(n.a, n.b) - bearing(s.a, s.b) + 540) % 360) - 180;
        if (Math.abs(d) >= WAYFIND.turnMinDeg) ev.push({ at: s.at + s.len, kind: 'turn', n: 1, dir: d });
      }
    }
    ev.sort((a, b) => a.at - b.at);
    // MERGE, and only where merging cannot invent a fact. Two crossings on a
    // divided road are one place; two turns the same way inside 14 m are one
    // corner; two turns OPPOSITE ways inside 14 m are a jink, and calling that
    // "then left" would delete the half of it that comes back.
    // THE LIST MERGES AT THE SAME DISTANCE THE RAIL DOES, by construction. The
    // rail merges marks closer than `pipMergeT` of the route; the list used a
    // flat 14 m, and on JES -> ANB (1.1 km) the rail drew ONE capsule of four
    // crossings where the list printed two rows of two, 15 m apart. Two
    // pictures of the same four lights that count them differently is the bar
    // arguing with itself, which is the exact failure `pipMergeT` was written
    // to prevent on the rail. The floor keeps short routes from merging nothing.
    const mergeM = Math.max(WF_UI.stepMergeM, WF_UI.pipMergeT * p.total);
    const merged = [];
    for (const e of ev) {
      const q = merged[merged.length - 1];
      const sameWay = e.kind !== 'turn' || (e.dir < 0) === (q && q.dir < 0);
      if (q && q.kind === e.kind && sameWay && e.at - q.at < mergeM) {
        q.n++;
        if (e.kind === 'turn' && Math.abs(e.dir) > Math.abs(q.dir)) q.dir = e.dir;
        continue;
      }
      merged.push(Object.assign({}, e));
    }
    // PRUNE THE JINKS — the first draft of this list printed TWELVE turns for a
    // 580 m walk to DKR, `then right` / `then left` every fifteen metres, and
    // what it was describing was the shape of the pavement rather than the
    // shape of the walk. A turn earns a row when there is real walking on at
    // least one side of it; under that it is a wiggle you take without looking
    // up. Dropping one MERGES ITS TWO LEGS into a single longer distance, so
    // the list still adds up to the route's own length — that is the property
    // that makes this a summary and not a truncation. Staircases, crossings and
    // the stop are never pruned, whatever the row count.
    //
    // It converges: every drop lengthens the legs either side, so the turns
    // that survive are the ones with distance around them, and a list can never
    // be pruned to nothing on a route long enough to have a turn in it.
    let keep = merged;
    for (;;) {
      let worst = -1, worstV = Infinity;
      for (let i = 0; i < keep.length; i++) {
        if (keep[i].kind !== 'turn') continue;
        const before = keep[i].at - (i > 0 ? keep[i - 1].at : 0);
        const after = (i < keep.length - 1 ? keep[i + 1].at : p.total) - keep[i].at;
        const v = Math.max(before, after) * p.k;
        if (v < worstV) { worstV = v; worst = i; }
      }
      if (worst < 0) break;
      if (keep.length <= WF_UI.stepsMax && worstV >= WF_UI.stepTurnMinLegM) break;
      keep = keep.slice(0, worst).concat(keep.slice(worst + 1));
    }
    const rows = [{ kind: 'start' }];
    let prev = 0;
    for (const e of keep) {
      const legM = (e.at - prev) * p.k;
      if (legM >= WF_UI.stepMinLegM) rows.push({ kind: 'leg', m: legM });
      rows.push(e);
      prev = e.at;
    }
    const tail = (p.total - prev) * p.k;
    if (tail >= WF_UI.stepMinLegM) rows.push({ kind: 'leg', m: tail });
    rows.push({ kind: 'end' });
    return rows;
  }

  /** Closest point on the drawn route to a lon/lat, in metres along it. */
  function projectOnRoute(p, ll) {
    if (!p || !p.segs.length) return null;
    let best = null;
    for (const s of p.segs) {
      const ax = s.a[0] * MPD_LON, ay = s.a[1] * MPD_LAT;
      const bx = s.b[0] * MPD_LON, by = s.b[1] * MPD_LAT;
      const px = ll[0] * MPD_LON, py = ll[1] * MPD_LAT;
      const dx = bx - ax, dy = by - ay;
      const L2 = dx * dx + dy * dy;
      let u = L2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
      u = Math.max(0, Math.min(1, u));
      const qx = ax + u * dx, qy = ay + u * dy;
      const off = Math.hypot(px - qx, py - qy);
      if (!best || off < best.off) best = { off, at: s.at + u * s.len, seg: s, u };
    }
    return best;
  }

  /**
   * What is LEFT, measured rather than scaled: every segment ahead of the
   * projection contributes its own length to flat or to stair, and the
   * staircases and crossings ahead are counted, not prorated. The result goes
   * through `timeRange()` — the same arithmetic, the same constants and the
   * same outward rounding as the whole-route figure above it.
   */
  function remainingOf(p, at) {
    const m = { flat: 0, stair: 0, signals: 0, stairSets: 0 };
    const sets = new Set();
    for (const s of p.segs) {
      const end = s.at + s.len;
      if (end <= at) continue;
      const len = Math.min(s.len, end - Math.max(at, s.at));
      if (s.f & F_STEPS) { m.stair += len; sets.add(s.sid); }
      else m.flat += len;
      if ((s.f & F_SIGNAL) && s.at + s.len / 2 > at) m.signals++;
    }
    m.stairSets = sets.size;
    m.flat *= p.k; m.stair *= p.k;
    return { m, time: timeRange(m), distM: Math.max(0, (p.total - at) * p.k) };
  }

  /**
   * The next vertex ahead where the route really turns, how far off it is, and
   * — ROUND 2 — WHICH WAY IT GOES. `turn` is the SIGNED bearing change in
   * degrees, negative left and positive right, wrapped to -180..180. The old
   * version took `Math.abs` two lines before it returned, so the sign the whole
   * question turns on was computed and thrown away, and the readout could say a
   * turn was 340 m off without being able to say it was a left.
   */
  function nextTurnFrom(p, at) {
    for (let i = 0; i < p.segs.length - 1; i++) {
      const s = p.segs[i], n = p.segs[i + 1];
      const v = s.at + s.len;
      if (v - at < WF_UI.turnAheadMinM) continue;
      // Same rule as the itinerary (§7a-ii): the joint with the door link is
      // not a corner, it is where our own straight line meets the surveyed
      // path. Without this the readout opened a walk with `then a sharp right`
      // before the first metre.
      if (s.link || n.link) continue;
      const d = ((bearing(n.a, n.b) - bearing(s.a, s.b) + 540) % 360) - 180;
      if (Math.abs(d) >= WAYFIND.turnMinDeg) {
        return { at: v, ll: s.b, distM: (v - at) * p.k, turn: d };
      }
    }
    const lastSeg = p.segs[p.segs.length - 1];
    return { at: p.total, ll: lastSeg.b, distM: Math.max(0, (p.total - at) * p.k), end: true };
  }

  /** The signed turn, in the words §11's neighbours permit. Description, not order. */
  function turnWord(deg) {
    const sharp = Math.abs(deg) >= WF_UI.turnSharpDeg;
    if (deg < 0) return sharp ? SAY_UI.thenSharpLeft : SAY_UI.thenLeft;
    return sharp ? SAY_UI.thenSharpRight : SAY_UI.thenRight;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 7b. THE DOM
  // ══════════════════════════════════════════════════════════════════════════
  function buildUI() {
    if (el) return el;
    const root = h('div', null); root.id = 'wf-root';

    const btn = h('button', null, ''); btn.id = 'wf-button';
    btn.title = SAY.title; btn.setAttribute('aria-label', SAY.title);
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M5 20.5 9.5 4.2l4.4 5.3 5.6 1.2-4.3 3.2 1 5.6-4.7-2.9z"/></svg>';

    // ── the question ──────────────────────────────────────────────────────
    const sheet = h('div', 'hidden'); sheet.id = 'wf-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-label', SAY.title);
    const head = h('div', null); head.id = 'wf-head';
    head.appendChild(h('div', 'wf-h', SAY.title));
    const close = h('button', null); close.id = 'wf-close';
    close.setAttribute('aria-label', 'Close'); close.appendChild(icon(null, IC.close, 2.1));
    head.appendChild(close);
    sheet.appendChild(head);

    const ends = h('div', null); ends.id = 'wf-ends';
    const mk = (id, lab, ph) => {
      const row = h('div', 'wf-row');
      row.appendChild(h('span', 'wf-lab', lab));
      const inp = document.createElement('input');
      inp.id = id; inp.type = 'text'; inp.placeholder = ph;
      inp.autocomplete = 'off'; inp.spellcheck = false;
      inp.setAttribute('aria-label', lab);
      inp.enterKeyHint = 'go';
      row.appendChild(inp);
      const x = h('button', 'wf-x'); x.setAttribute('aria-label', SAY_UI.clearField);
      x.appendChild(icon(null, IC.close, 2.4));
      x.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        inp.value = '';
        if (inp.id === 'wf-from') state.from = null; else state.to = null;
        inp.focus(); renderList(inp); syncClears();
      });
      row.appendChild(x);
      return { row, inp, x };
    };
    const from = mk('wf-from', SAY.fromLabel, SAY.fromDefault);
    const to = mk('wf-to', SAY.toLabel, SAY.placeholder);
    ends.appendChild(from.row);
    ends.appendChild(to.row);
    // SWAP. It is the one thing a two-field router is asked for constantly and
    // it costs one button, so it is not in a menu. It sits on the seam between
    // the rows because that is what it acts on.
    const swap = h('button', null); swap.id = 'wf-swap';
    swap.setAttribute('aria-label', SAY_UI.swap); swap.title = SAY_UI.swap;
    swap.appendChild(icon(null, IC.swap, 1.9));
    swap.addEventListener('click', (ev) => { ev.preventDefault(); swapEnds(); });
    ends.appendChild(swap);
    sheet.appendChild(ends);

    const list = h('div', null); list.id = 'wf-list';
    list.setAttribute('role', 'listbox');
    sheet.appendChild(list);
    // QUEUE Z9, second half. `+ N more — keep typing` is a note ABOUT the
    // results, not a result, so it lives outside the scroller and cannot be
    // clipped by its max-height. Empty means gone: `#wf-more:empty`.
    const more = h('div', null); more.id = 'wf-more';
    sheet.appendChild(more);
    // THE FIRST-RUN STATE, which interface.md flagged as undesigned. Four codes
    // you can tap. It answers "what does this field want" with an example
    // instead of a sentence, and it disappears the moment you type.
    const egs = h('div', null); egs.id = 'wf-egs';
    egs.appendChild(h('span', 'wf-eg-lab', SAY_UI.tryLabel));
    for (const code of WF_UI.exampleCodes) {
      const c = h('button', 'wf-eg', code);
      c.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        const inp = (document.activeElement === el.inFrom) ? el.inFrom : el.inTo;
        inp.value = code; inp.focus();
        renderList(inp); syncClears();
      });
      egs.appendChild(c);
    }
    sheet.appendChild(egs);
    const hint = h('div', 'wf-hint', SAY.examples);
    sheet.appendChild(hint);
    const foot = h('div', 'wf-foot');
    foot.appendChild(h('div', null, SAY.noIndoor));
    foot.appendChild(h('div', null, SAY.osm + ' · ' + SAY.notUT));
    sheet.appendChild(foot);

    // ── the answer ────────────────────────────────────────────────────────
    const pill = h('div', 'hidden'); pill.id = 'wf-pill';
    // THE BAR IS NOT ITSELF A BUTTON ANY MORE, AND IT CANNOT BE. It carried
    // `role="button"` and `tabIndex=0` while containing `Show route`, `Clear`,
    // a checkbox and three chips — a control with controls inside it, which no
    // assistive technology can present and which puts every one of those on the
    // wrong side of one focus stop. The CHEVRON is the button now: a real
    // <button> with a real label and `aria-controls` on the card it opens.
    // Tapping the bar still toggles, because on a phone the whole bar is the
    // affordance; that is a pointer convenience on top of a keyboard control
    // that exists, rather than the only way in.
    const chev = h('button', null); chev.id = 'wf-chev';
    chev.setAttribute('aria-controls', 'wf-card');
    // ROUND 5: A WORD ON THE DOOR. The itinerary is the one shape this bar
    // shares with every walking-directions app on a phone, and it was behind a
    // bare 28 px chevron in the corner with nothing on the frame saying it was
    // there — the same mistake round 2 fixed for `Show route` and left in place
    // for the list. The label is hidden while walking (`#wf-orig` is gone then
    // and the row belongs to the manoeuvre) and on a failure, where the chevron
    // itself is hidden because there is nothing to open.
    const chevLab = h('span', 'wf-chev-lab');
    if (WF_UI.stepsPeekOn) chev.appendChild(chevLab);
    chev.appendChild(icon(null, IC.chev, 2.2));
    // THE WALKING READOUT. Above the headline, and the headline hides under it
    // rather than being replaced, so `#wf-headline`.textContent is still the
    // whole-journey sentence for anything reading this UI from a test.
    const liveEl = h('div', null); liveEl.id = 'wf-live';
    // WHERE IT THINKS YOU ARE STARTING FROM. This is not decoration: with an
    // empty From the app picks the routable building nearest the CAMERA
    // (QUEUE Z2) and until now it never said which one it picked. A router
    // that hides its own assumed origin is the "wrong building, beautifully
    // drawn" failure with an extra step.
    const orig = h('div', null); orig.id = 'wf-orig';
    const headline = h('div', null); headline.id = 'wf-headline';
    const strip = h('div', null); strip.id = 'wf-strip';
    strip.setAttribute('aria-hidden', 'true');
    // THE KEY. Not aria-hidden, unlike the strip: on a phone this row is the
    // ONLY thing that says what a coloured mark on the rail stands for, and
    // `title` is a desktop affordance that does not exist under a thumb.
    const key = h('div', null); key.id = 'wf-key';
    const sub = h('div', null); sub.id = 'wf-sub';
    const verdict = h('div', null); verdict.id = 'wf-verdict';
    // THE PRIMARY ACTION, IN THE CLOSED BAR. It was inside the card, behind a
    // tap on a chevron, and that is the wrong side of a door for it: the camera
    // never moves on its own (WAYFIND.fit*), so unless the answer arrived with
    // `?fit=1` the route this bar is describing can be entirely off screen and
    // the one control that puts it back was not on screen either.
    const acts = h('div', null); acts.id = 'wf-acts';
    // ROUND 4: THE PRIMARY ACTION IS THE WALK, NOT ANOTHER AERIAL OF IT.
    // `Show route` frames the line from above — useful, and it is what every
    // maps app already does. The thing this app has that they do not is that
    // you can stand on the pavement it just drew, and until now no control
    // anywhere put you there (see walkIt's header). So `Walk it` takes the
    // filled amber and the width, `Show route` keeps its glyph and its word at
    // secondary weight, and `Clear` becomes the ✕ it always meant — three
    // controls on 342 px only fit if the way out stops asking for a word.
    const walkBtn = h('button', 'wf-act wf-act-go');
    walkBtn.appendChild(icon('wf-act-ic wf-act-walk', IC.walk, 1.9));
    walkBtn.appendChild(h('span', null, SAY_UI.walkIt));
    walkBtn.title = SAY_UI.walkItHint;
    walkBtn.setAttribute('aria-label', SAY_UI.walkIt + ' — ' + SAY_UI.walkItHint);
    walkBtn.addEventListener('click', (ev) => { ev.stopPropagation(); walkIt(); });
    const showBtn = h('button', 'wf-act wf-act-show');
    showBtn.appendChild(icon('wf-act-ic', IC.frame, 1.9));
    showBtn.appendChild(h('span', null, SAY.showRoute));
    showBtn.title = SAY.showRoute;
    showBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      // ASKING TO BE LIFTED OUT IS TAKING THE CAMERA BACK. The hold is already
      // released by this tap's own `mousedown` (holdWalk listens in the capture
      // phase), but a synthetic `.click()` from a script has no `mousedown`, so
      // say it here too rather than depend on the order of two other things.
      releaseWalkHold();
      if (state.route && state.route.ok) fitTo(window.__map, state.route);
    });
    const clrBtn = h('button', 'wf-act wf-act-clr');
    clrBtn.appendChild(icon('wf-act-ic', IC.close, 2.2));
    clrBtn.title = SAY.clear;
    clrBtn.setAttribute('aria-label', SAY.clear);
    acts.appendChild(walkBtn); acts.appendChild(showBtn); acts.appendChild(clrBtn);
    clrBtn.addEventListener('click', (ev) => { ev.stopPropagation(); clear(); });
    // THE LAST ROW IS ONE ROW. Photographed at 390 x 844 while walking, the
    // bar's bottom 44 px held a single 90 px `Clear` button with 270 px of
    // nothing to the left of it, directly under a passing-period warning that
    // was itself on a line of its own. Two half-empty rows where one would do
    // is the most expensive kind of space on a phone. `#wf-footrow` is a
    // wrapping flex: with a wide primary action in it the actions take their
    // own line (the `flex-basis` is wider than what is left beside a verdict),
    // and while walking — when the only action is `Clear` — the warning and the
    // way out share the row. Nothing is hidden to achieve it.
    const footrow = h('div', null); footrow.id = 'wf-footrow';
    // WHAT THE ROUTE DOES AFTER THE NEXT TURN. It lives in the footer row
    // because that row is where the space is: walking a route with nothing to
    // warn about, the row held `Clear` and 250 px of nothing. One more fact
    // about the walk is a better tenant of that space than air.
    const then2 = h('div', 'hidden'); then2.id = 'wf-then2';
    // ORDER IN THE DOM: verdict, then2, acts. ORDER ON THE FRAME: then2,
    // verdict, acts (`order:-1` in style.css). They differ on purpose, because
    // CSS can only look FORWARD from a sibling: with the warning first in the
    // markup, `#wf-verdict:not(:empty) + #wf-then2` can drop the chained turn
    // on exactly the routes that have something to warn about — and those are
    // the routes where all three would not fit, and where the warning is the
    // one that changes what you do.
    footrow.appendChild(verdict); footrow.appendChild(then2); footrow.appendChild(acts);
    const card = h('div', 'hidden'); card.id = 'wf-card';
    // THE SPINE IS APPENDED FIRST ON PURPOSE. It is an absolutely positioned
    // child of the bar and `.wf-mk` is `position:relative`, so both paint in
    // the positioned layer and DOM order decides which is on top. Last would
    // draw the hairline OVER the tick and the ring it joins; first tucks it
    // under them, which is the only way the join has no seam.
    const spine = h('div', 'hidden'); spine.id = 'wf-spine';
    spine.setAttribute('aria-hidden', 'true');
    pill.appendChild(spine);
    pill.appendChild(chev);
    pill.appendChild(orig);
    pill.appendChild(liveEl); pill.appendChild(headline); pill.appendChild(strip);
    pill.appendChild(key);
    pill.appendChild(sub);
    pill.appendChild(footrow); pill.appendChild(card);

    root.appendChild(btn); root.appendChild(sheet); root.appendChild(pill);
    document.body.appendChild(root);

    el = { root, btn, sheet, list, more, egs, hint, inFrom: from.inp, inTo: to.inp,
      xFrom: from.x, xTo: to.x, swap, pill, chev, chevLab, liveEl, orig, headline, strip, key, sub,
      verdict, acts, footrow, then2, card, close, ends, spine };
    // The way out of the walk, and it is a taste value because it is one:
    // round 4's reading was that framing the route from above is not what you
    // want while standing on it, which is true right up until the only other
    // control on the bar is the one that deletes the route.
    root.classList.toggle('wf-out', !!WF_UI.liveShowRoute);

    btn.addEventListener('click', () => openSheet());
    close.addEventListener('click', () => closeSheet());
    // A rotation changes both the room above the controls and the height of the
    // bar above the card, and the card is the only thing in this feature whose
    // size is measured rather than declared.
    window.addEventListener('resize', () => { if (state.expanded) fitCard(); drawSpine(); });
    const toggle = () => { state.expanded = !state.expanded; renderPill(); };
    pill.addEventListener('click', toggle);
    // The BAR toggles the card; the CARD does not. Reading the accessibility
    // disclaimer and having the panel shut under your thumb because you touched
    // a word of it is the kind of thing nobody reports and everybody notices.
    card.addEventListener('click', (ev) => ev.stopPropagation());
    chev.addEventListener('click', (ev) => { ev.stopPropagation(); toggle(); });
    for (const inp of [from.inp, to.inp]) {
      inp.addEventListener('input', () => { renderList(inp); syncClears(); });
      inp.addEventListener('focus', () => { renderList(inp); syncClears(); });
      inp.addEventListener('keydown', (ev) => {
        // ARROW KEYS PICK. Enter used to commit "the first routable match",
        // which is correct and completely invisible: nothing on screen said
        // which row that was. There is now a highlighted row, it starts on the
        // first one, and Enter takes it.
        if (ev.key === 'ArrowDown') { ev.preventDefault(); moveActive(1); }
        else if (ev.key === 'ArrowUp') { ev.preventDefault(); moveActive(-1); }
        else if (ev.key === 'Enter') { ev.preventDefault(); commitFirst(inp); }
        else if (ev.key === 'Escape') { ev.preventDefault(); closeSheet(); }
        ev.stopPropagation();     // controls.js already ignores text inputs; belt and braces
      });
    }
    return el;
  }

  function syncClears() {
    if (!el) return;
    for (const [inp, x] of [[el.inFrom, el.xFrom], [el.inTo, el.xTo]]) {
      const has = !!inp.value;
      x.classList.toggle('on', has);
      // The row, not just the button: the field only gives up the 19 px the
      // clear button needs while there is a value in it to clear.
      inp.parentNode.classList.toggle('has-val', has);
    }
  }

  function swapEnds() {
    const a = state.from, b = state.to;
    const av = el.inFrom.value, bv = el.inTo.value;
    state.from = b; state.to = a;
    el.inFrom.value = bv; el.inTo.value = av;
    syncClears();
    if (state.from && state.to) run(); else renderList(el.inTo);
  }

  async function openSheet() {
    buildUI();
    el.sheet.classList.remove('hidden');
    el.btn.classList.add('active');
    try { await loadGraph(); } catch (e) { el.hint.textContent = 'Could not load the campus paths.'; return; }
    el.hint.textContent = SAY.asOf(fmtAsOf(G.asOf));
    // QUEUE Z2: the From default. Geolocation does not exist here (honesty
    // audit §9); the camera always does. So From opens holding the routable
    // building nearest the camera — visibly a building name, never a claim
    // about where the PERSON is standing — and the field stays editable.
    if (!state.from && !el.inFrom.value) {
      const near = nearestToCamera();
      if (near) { state.from = near; el.inFrom.value = near.display; }
    }
    syncClears();
    el.inTo.focus();
    renderList(el.inTo);
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
    activeRow = 0;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 7c. THE RESULT LIST
  // ══════════════════════════════════════════════════════════════════════════
  let activeRow = 0, activeRows = [];

  function renderList(inp) {
    if (!G || !el) return;
    // A new keystroke is a new question: put the default hint back so a
    // previous failure message does not outlive the query it answered.
    el.hint.textContent = SAY.asOf(fmtAsOf(G.asOf));
    const rows = search(inp.value);
    el.list.innerHTML = '';
    const shown = rows.slice(0, WAYFIND.resultRows);
    activeRows = shown.filter(e => e.routable);
    if (activeRow >= activeRows.length) activeRow = 0;
    for (const e of shown) {
      const isActive = e.routable && activeRows[activeRow] === e;
      const r = h('div', 'wf-item' + (e.routable ? '' : ' off') + (isActive ? ' active' : ''));
      r.setAttribute('role', 'option');
      r.setAttribute('aria-selected', isActive ? 'true' : 'false');
      r.appendChild(h('span', 'wf-code', e.code || '•'));
      r.appendChild(h('span', 'wf-name', e.display));
      const n = e.doors.length;
      // ONE TAG, AND IT IS ON THE PERMITTED LIST (§11). `no door mapped` used
      // to appear here and lived in neither SAY nor the permitted list; both
      // cases now take the permitted tag.
      r.appendChild(h('span', 'wf-meta', e.routable ? (n + (n === 1 ? ' door' : ' doors'))
        : SAY.notWalkableTag));
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
    el.egs.classList.toggle('hidden', !!norm(inp.value));
  }

  function moveActive(d) {
    if (!activeRows.length) return;
    activeRow = (activeRow + d + activeRows.length) % activeRows.length;
    const inp = document.activeElement === el.inFrom ? el.inFrom : el.inTo;
    renderList(inp);
    const on = el.list.querySelector('.wf-item.active');
    if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
  }

  function commitFirst(inp) {
    const all = search(inp.value);
    const rows = all.filter(e => e.routable);
    // The highlighted row, which is the first one until an arrow key moves it.
    if (rows.length) return pick(inp, rows[Math.min(activeRow, rows.length - 1)]);
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
    activeRow = 0;
    syncClears();
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
    prof = r.ok ? routeProfile(G, r) : null;
    live = null; liveFrom = null;
    releaseWalkHold();     // a new route is a new walk; the old claim is void
    if (!r.ok) { renderPill(); draw(window.__map, null); return; }
    draw(window.__map, r);
    armLive();
    sampleLive();
    renderPill();
    // `?fit=1` waits for the opening flight (Z6). The card's own `Show route`
    // button does NOT — that is a person asking, and the camera is theirs.
    if (opts && opts.fit) fitWhenFree(window.__map, r);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 7d. THE WALKING READOUT
  //
  // ZERO COST AT REST, and that is the whole design of it. It is a `move`
  // handler on the map, not a loop: a parked camera does nothing, a hidden tab
  // does nothing, and clearing the route unhooks it entirely. While the camera
  // IS moving it does one projection (a few hundred segment distances) and one
  // textContent write, capped at `WF_UI.liveHz` a second.
  // ══════════════════════════════════════════════════════════════════════════
  function armLive() {
    const map = window.__map;
    if (!map || liveHooked) return;
    map.on('move', onCam);
    map.on('moveend', onCamEnd);
    liveHooked = true;
  }
  function disarmLive() {
    const map = window.__map;
    if (!map || !liveHooked) return;
    try { map.off('move', onCam); map.off('moveend', onCamEnd); } catch (e) {}
    liveHooked = false;
  }
  function onCam() {
    const now = performance.now();
    if (now - liveAt < 1000 / WF_UI.liveHz) return;
    liveAt = now;
    if (sampleLive()) renderLive();
  }
  // THE LAST SAMPLE IS NOT OPTIONAL. `moveend` through the same throttle drops
  // the frame the camera actually stopped on whenever the move was shorter than
  // one tick — which is every jump — and leaves the readout one step stale at
  // exactly the moment somebody stops to read it.
  //
  // ROUND 5: AND THE LAST SAMPLE ITSELF CAN BE STALE. `sampleLive` reads
  // `__fly.eye()`, and js/controls.js only re-reads the map on its OWN next
  // tick — so the sample taken ON `moveend` after a map-driven move can still
  // report where the camera WAS. Round 4 found this jumping DOWN onto the route
  // (`Walk it` left the bar on the summary layout with the view on the
  // pavement) and fixed it inside that one button. Round 5's way out of the
  // walk jumps UP off the route and hits the identical lag in the other
  // direction: MEASURED on JES -> WEL, the bar kept the walking readout with
  // the camera at 982 m — and with the camera now parked there was no further
  // `move` event, so nothing was ever going to sample again. It stuck.
  //
  // So the re-ask lives here, on every move that ENDS, instead of in each
  // button. It stops at the first sample that changes anything, and when
  // nothing changes — the common case, you stopped where you already were — it
  // is `endSettleN` projections spread over `endSettleN * endSettleMs` and then
  // silence. Still zero while parked.
  function onCamEnd() {
    liveAt = 0;
    onCam();
    let n = 0;
    const again = () => {
      if (++n > WF_UI.endSettleN) return;
      liveAt = 0;
      if (sampleLive()) { renderLive(); return; }
      setTimeout(again, WF_UI.endSettleMs);
    };
    setTimeout(again, WF_UI.endSettleMs);
  }

  /** Camera -> a point on the route, or null. Returns true if it changed. */
  function sampleLive() {
    const map = window.__map;
    if (!prof || !map || !state.route || !state.route.ok) { live = null; return false; }
    let lng, lat, alt = 0, brg = 0;
    try {
      const eye = window.__fly && window.__fly.eye ? window.__fly.eye() : null;
      if (eye) { lng = eye.lng; lat = eye.lat; alt = eye.alt; brg = eye.bearing; }
      else { const c = map.getCenter(); lng = c.lng; lat = c.lat; alt = 0; brg = map.getBearing(); }
    } catch (e) { return false; }
    const p = projectOnRoute(prof, [lng, lat]);
    const on = p && p.off <= WF_UI.liveOnRouteM && alt <= WF_UI.liveAltMaxM;
    if (!on) { const had = !!live; live = null; return had; }
    // LOOKING AROUND IS NOW FREE. The old gate re-rendered whenever the view
    // turned more than 4 degrees, because the arrow was a compass bearing and
    // had to follow it. The arrow is the manoeuvre now (renderLive), so nothing
    // on this readout depends on where the view is POINTING — only on how far
    // along the route it is. Swiping to look, which is the most common gesture
    // there is on a phone, costs no DOM write at all.
    if (live && Math.abs(p.at - live.at) * prof.k < WF_UI.liveMinMoveM) return false;
    const rem = remainingOf(prof, p.at);
    const turn = nextTurnFrom(prof, p.at);
    live = { at: p.at, off: p.off, brg, rem, turn, done: rem.distM <= WF_UI.arriveM };
    return true;
  }

  /**
   * "WILL I MAKE IT?" — the one-sided answer, honesty doc §15, in ONE place.
   *
   * It used to be written inline in renderPill off the WHOLE route's range and
   * never re-asked, so it went stale the moment you started walking: the bar
   * kept saying `Tight for a 15-minute passing period` about a walk with three
   * minutes left in it. This is the same defect round 4 fixed one row higher
   * (`Stairs: 3 sets` counting sets already climbed), and the fix is the same —
   * ask the question again of the part of the route that is left.
   *
   * The RULE is unchanged and stays one-sided, because that is what §15
   * permits:
   *   both ends over the period   -> say so. If we are wrong they walk faster.
   *   the range crosses it        -> say it is tight. True of our own numbers.
   *   both ends under it          -> SAY NOTHING, on purpose.
   *
   * There is no "you'll make it" and there must not be. Our range measures
   * pavement between two doors; it knows nothing about getting out of a lecture
   * hall, a lift, a stairwell inside the building, the crowd on Speedway at the
   * hour, or finding the room.
   */
  function applyVerdict(t) {
    const pm = WAYFIND.passingMin;
    el.verdict.className = '';
    if (!t) { el.verdict.textContent = ''; return; }
    if (t.lo >= pm) {
      el.verdict.textContent = SAY.passingOver(pm);
      el.verdict.className = 'over';
    } else if (t.hi >= pm) {
      el.verdict.textContent = SAY.passingTight(pm);
      el.verdict.className = 'tight';
    } else {
      el.verdict.textContent = '';
    }
  }

  function renderLive() {
    if (!el) return;
    const on = !!live;
    document.body.classList.toggle('wf-live', on);
    // ROUND 6. HOW CLOSE THE END IS, as one class, so the bar can hold the
    // entrance callout back until it is a thing you can act on. See
    // `liveDoorNoteM`. Off the route entirely, it is not "near" anything.
    document.body.classList.toggle('wf-near',
      !!(WF_UI.liveDoorNoteOnApproach && on && live.rem && live.rem.distM <= WF_UI.liveDoorNoteM));
    el.liveEl.classList.toggle('hidden', !on);
    el.then2.innerHTML = '';
    el.then2.classList.add('hidden');
    if (!on) {
      // BACK TO THE WHOLE WALK. Stepping off the route (or lifting the camera
      // above `liveAltMaxM`) has to put the passing-period line back on the
      // whole-route range, or the bar would keep the last remaining-based
      // answer under a summary that is about the whole journey.
      if (WF_UI.liveVerdictRemaining && state.route && state.route.ok) {
        applyVerdict(state.route.time);
      }
      renderStrip();
      // STEPPING OFF THE ROUTE PUTS THE JOURNEY BACK, so it puts the spine
      // back with it. `renderLive` is the only thing that moves the bar between
      // the two layouts and it does not go through `renderPill`.
      drawSpine();
      return;
    }
    el.liveEl.innerHTML = '';
    // THE DISC SHOWS THE MANOEUVRE. It used to show the BEARING to the turn
    // vertex — the arrow rotated to point at where the turn was, relative to
    // where the view faced. Photographed at 390 x 844 the result was an arrow
    // pointing up and to the RIGHT with the words `, then left` set beside it,
    // because those are two different true facts about the same turn and only
    // one of them is what a person reads off a big glyph. A disc this size gets
    // to say one thing, so it says the one the ribbon on the ground cannot:
    // which way the route goes at the turn. Where the turn IS, you can see —
    // it is painted on the floor in front of you.
    const arrow = h('div', 'wf-arrow');
    const path = live.done ? IC.arrow
      : live.turn.end ? IC.arrow
        : (live.turn.turn < 0 ? IC.turnLeft : IC.turnRight);
    arrow.appendChild(icon(null, path, 2.3));
    el.liveEl.appendChild(arrow);

    const txt = h('div', 'wf-livetxt');
    if (live.done) {
      txt.appendChild(h('div', 'wf-liveline', SAY_UI.atTheEnd));
      // At the end of the drawn route there is no walk left to be tight about.
      if (WF_UI.liveVerdictRemaining) applyVerdict(null);
    } else {
      // THE NEXT THING THAT HAPPENS, FIRST AND BIGGEST. What a person walking
      // wants off a glance is not how long the whole thing takes — it is how
      // far to the next decision and which way that decision goes. So the top
      // line is `340 m, then left`, with the distance in the same weight as the
      // minutes were, and the journey figures move to the line under it.
      const nx = h('div', 'wf-next');
      nx.appendChild(h('span', 'wf-big', fmtDist(live.turn.distM)));
      nx.appendChild(h('span', 'wf-then',
        live.turn.end ? (' ' + SAY_UI.toTheEnd) : (', ' + turnWord(live.turn.turn))));
      txt.appendChild(nx);

      const t = live.rem.time;
      // ROUND 5: THE PASSING-PERIOD LINE IS ABOUT WHAT IS LEFT. Same rule, same
      // permitted strings, asked of the same range this line is printing. See
      // applyVerdict's header for why it was wrong before and why re-asking it
      // is the same class of measurement as `remaining` itself.
      if (WF_UI.liveVerdictRemaining) applyVerdict(t);
      const fig = h('div', 'wf-figs');
      fig.appendChild(h('span', 'wf-mins', t.lo === 0 ? ('<' + t.hi) : (t.lo + '–' + t.hi)));
      fig.appendChild(h('span', 'wf-unit', SAY_UI.unitMin));
      fig.appendChild(h('span', 'wf-dim2', SAY_UI.remaining));
      fig.appendChild(h('span', 'wf-mid', '·'));
      fig.appendChild(h('span', 'wf-unit', fmtDist(live.rem.distM)));
      txt.appendChild(fig);

      // AND THEN. The turn after the next one, direction only — see SAY_UI's
      // note for why it carries no distance. `nextTurnFrom` is asked again from
      // just past the first turn, so the two come off one function and one
      // definition of what a turn is; if the second one is the end of the route
      // there is nothing to chain and the row stays empty.
      if (!live.turn.end && prof) {
        const t2 = nextTurnFrom(prof, live.turn.at + 0.01);
        if (t2 && !t2.end) {
          el.then2.classList.remove('hidden');
          el.then2.appendChild(icon('wf-sturn', t2.turn < 0 ? IC.turnLeft : IC.turnRight, 2.3));
          el.then2.appendChild(h('span', null, SAY_UI.andThen + turnWord(t2.turn)));
        }
      }
    }
    el.liveEl.appendChild(txt);
    renderStrip();
    drawSpine();
    // The readout appearing or going away moves everything under it, so the
    // card's ceiling moves with it. Only when the card is open, which is never
    // the common case while walking.
    if (state.expanded) fitCard();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 7e. THE STRIP — where the things on this route actually are
  //
  // Not an elevation profile and it must never be mistaken for one: §12 forbids
  // the whole hill family and there is no elevation source in this repo. This
  // is a flat rail with a pip at each mapped staircase and each signalised
  // crossing, at its true fraction of the route. It turns two counts the bar
  // already prints — `Stairs: 1 set`, `Crosses 2 signalised crossings` — into
  // WHERE, which is the part a student is actually planning around.
  // ══════════════════════════════════════════════════════════════════════════
  function renderStrip() {
    if (!el) return;
    const r = state.route;
    el.strip.innerHTML = '';
    if (!r || !r.ok || !prof) {
      el.strip.classList.add('hidden');
      el.key.classList.add('hidden'); el.key.innerHTML = '';
      return;
    }
    // ROUND 5: NOTHING ON IT, NOTHING TO DRAW. See `stripNeedsMarks`.
    const marks = routeMarks(G, r, prof);
    if (WF_UI.stripNeedsMarks && !marks.length) {
      el.strip.classList.add('hidden');
      renderKey(r);
      return;
    }
    el.strip.classList.remove('hidden');
    const rail = h('div', 'wf-rail');
    const fill = h('div', 'wf-fill');
    const doneT = live ? Math.max(0, Math.min(1, live.at / prof.total)) : 0;
    fill.style.width = (doneT * 100).toFixed(2) + '%';
    rail.appendChild(fill);
    // THE NOTCH PAD, read once off the element rather than hard-coded twice.
    const notchPad = parseFloat(getComputedStyle(el.root).getPropertyValue('--wf-notch-pad')) || 3;
    for (const m of marks) {
      const pip = h('span', 'wf-pip wf-pip-' + m.kind);
      pip.style.left = (m.t * 100).toFixed(2) + '%';
      // A MERGED PIP IS WIDER, and that is the only way the picture can agree
      // with the card. `Crosses 4 signalised crossings` over a strip with two
      // dots on it is the bar arguing with itself; a divided road tags both
      // carriageways and they land within a metre of each other, so the two
      // become one capsule that is labelled with the count it stands for.
      if (m.n > 1) {
        pip.classList.add('multi');
        pip.style.width = (7 + 4 * (m.n - 1)) + 'px';
        pip.style.marginLeft = (-(7 + 4 * (m.n - 1)) / 2) + 'px';
      }
      const lab = m.kind === 'stairs' ? (m.n > 1 ? SAY_UI.pipStairsN(m.n) : SAY_UI.pipStairs)
        : m.kind === 'signal' ? (m.n > 1 ? SAY_UI.pipSignalN(m.n) : SAY_UI.pipSignal)
        : SAY_UI.pipVia;
      pip.title = lab; pip.setAttribute('aria-label', lab);
      if (m.t <= doneT) pip.classList.add('past');
      // THE CUT THE MARK MAKES IN THE BAND. Sized from the pip's own width so a
      // merged capsule cuts a wider gap than a single dot and the two can never
      // disagree; appended BEFORE the pip because a ::before is painted over
      // its own element's background and would have covered the dot.
      const pw = m.n > 1 ? (7 + 4 * (m.n - 1)) : 9;
      const notch = h('span', 'wf-notch');
      notch.style.left = (m.t * 100).toFixed(2) + '%';
      notch.style.width = (pw + notchPad * 2) + 'px';
      notch.style.marginLeft = (-(pw + notchPad * 2) / 2) + 'px';
      rail.appendChild(notch);
      rail.appendChild(pip);
    }
    if (live) {
      // The playhead cuts the band too, so where the view is reads as a joint
      // in the walk rather than as a handle lying on a track.
      const youW = parseFloat(getComputedStyle(el.root).getPropertyValue('--wf-you-w')) || 4;
      const yn = h('span', 'wf-notch');
      yn.style.left = (doneT * 100).toFixed(2) + '%';
      yn.style.width = (youW + notchPad * 2) + 'px';
      yn.style.marginLeft = (-(youW + notchPad * 2) / 2) + 'px';
      rail.appendChild(yn);
      const you = h('span', 'wf-you');
      you.style.left = (doneT * 100).toFixed(2) + '%';
      rail.appendChild(you);
    }
    el.strip.appendChild(rail);
    // THE TWO ENDS ARE SIBLINGS OF THE RAIL, NOT CHILDREN OF IT. A staircase
    // 20 m from the door is at 97 % of a 660 m route, and inside the rail it
    // was drawn underneath the destination ring — the one mark on the strip a
    // student most needs to see, hidden by the mark it is nearest to.
    const a = h('span', 'wf-cap wf-cap-a'); a.title = SAY_UI.capStart;
    const b = h('span', 'wf-cap wf-cap-b'); b.title = r.to.display;
    el.strip.appendChild(a); el.strip.appendChild(b);
    renderKey(r);
  }

  /**
   * THE KEY — what the marks on the rail mean, in words, on the frame.
   *
   * The strip shipped three colours of pip whose only explanation was a `title`
   * attribute, and a `title` does not exist on a phone: there is no hover, and
   * this bar is judged at 390 x 844. So the picture was asserting something the
   * reader had no way to decode, which is a worse failure than not drawing it.
   *
   * The counts come off `r.m` — the SAME object the card's sentences are built
   * from — and not off the merged pip list, so the key, the card and the strip
   * cannot drift apart. The pip's own class draws the swatch, so a colour or a
   * shape changed in style.css moves the key with it and cannot be forgotten.
   */
  function renderKey(r) {
    el.key.innerHTML = '';
    el.key.classList.remove('ahead');
    if (!WF_UI.keyOn) { el.key.classList.add('hidden'); return; }
    const items = [];
    if (live && prof && prof.total) {
      // ── WALKING: THE SAME ROW COUNTS WHAT IS STILL IN FRONT OF YOU ───────
      // Round 4. Standing still, this row is a legend — it binds a colour on
      // the rail to a word, and you read it once. Walking, a legend is the
      // least useful row on the bar, and the row it replaced (the whole-route
      // figure line at footnote size) was a SECOND complete trip summary under
      // the first, printing counts that go stale the moment you climb the first
      // staircase. The marks past the camera's own projection onto the line are
      // the same class of measurement as `remaining` — the drawn line and the
      // view, both of which we have exactly — and they are the ones that change
      // what you do next.
      const doneT = Math.max(0, Math.min(1, live.at / prof.total));
      const n = { stairs: 0, signal: 0 };
      let viaAhead = false;
      for (const m of routeMarks(G, r, prof)) {
        if (m.t <= doneT) continue;
        if (m.kind === 'via') viaAhead = true; else n[m.kind] += m.n;
      }
      if (n.stairs) items.push(['stairs', SAY_UI.aheadStairsN(n.stairs)]);
      if (n.signal) items.push(['signal', SAY_UI.aheadSignalN(n.signal)]);
      if (viaAhead && r.via) items.push(['via', r.via.name]);
      if (items.length) el.key.classList.add('ahead');
    } else {
      // Stairs are NOT here: the headline already prints `Stairs: 3 sets` and
      // carries the swatch inline. The key is for the marks the bar has no
      // sentence for yet.
      if (r.m.signals) {
        items.push(['signal', r.m.signals === 1 ? SAY_UI.pipSignal : SAY_UI.pipSignalN(r.m.signals)]);
      }
      if (r.via) items.push(['via', r.via.name]);
    }
    el.key.classList.toggle('hidden', !items.length);
    for (const [kind, label] of items) {
      const it = h('span', 'wf-keyit');
      it.appendChild(h('span', 'wf-pip wf-pip-' + kind));
      it.appendChild(h('span', 'wf-keytx', label));
      el.key.appendChild(it);
    }
    // The tag that says these are counts of what is LEFT, in the same
    // uppercase footnote the remaining figures already wear, so the two read as
    // one thought: `8–12 min walk REMAINING · 630 m` / `3 crossings AHEAD`.
    if (items.length && el.key.classList.contains('ahead')) {
      el.key.appendChild(h('span', 'wf-aheadtag', SAY_UI.aheadTag));
    }
  }

  /**
   * HOW TALL THE CARD MAY BE, from where it actually starts.
   *
   * `--drive-clear` is resolved by MEASURING a one-pixel probe styled with it,
   * because a custom property holding a `calc(max(...))` reads back as its own
   * token stream and not as a number. The probe is added, measured and removed
   * inside one frame, and this only runs when the card is open — which is never
   * while the camera is moving unless somebody deliberately opened it.
   */
  function driveClearPx() {
    const probe = h('div', 'wf-probe');
    el.root.appendChild(probe);
    const px = probe.getBoundingClientRect().height;
    el.root.removeChild(probe);
    return px;
  }
  function fitCard() {
    if (!el || !state.expanded || el.card.classList.contains('hidden')) {
      if (el) el.card.style.maxHeight = '';
      return;
    }
    const top = el.card.getBoundingClientRect().top;
    const room = Math.max(WF_UI.cardMinPx,
      window.innerHeight - top - driveClearPx() - WF_UI.cardGapPx);
    el.card.style.maxHeight = room + 'px';
    // A LIST CUT OFF FLAT AT THE PANEL'S EDGE LOOKS FINISHED. The class is only
    // on when the content really is taller than the room, so a card that fits
    // ends with a hard, deliberate edge and one that does not says so.
    el.card.classList.toggle('scrolls', el.card.scrollHeight > room + 1);
  }

  /**
   * THE SPINE — the two end marks, joined. (Round 7.)
   *
   * It is MEASURED rather than declared, and that is not laziness. The two
   * marks it runs between are `::before`s on inline-blocks inside two flex rows
   * whose heights depend on the route: the figure line is one line or two, the
   * strip is there or it is not, the key is there or it is not. There is no
   * CSS length that is the distance between those two dots on every route, and
   * a stack of per-row `::before` segments — the other way to do this without
   * measuring — breaks at every margin between the rows and gives you a dashed
   * line nobody asked for. So it asks the two elements where they are.
   *
   * THREE CONDITIONS, and each of them is the answer to "when would this be
   * wrong":
   *   - not while walking. `#wf-orig` is `display:none` then, so there is no
   *     tick to start from and the bar is not describing a journey any more,
   *     it is describing the next twenty metres.
   *   - not when the RAIL is up. The rail already joins the same two marks,
   *     horizontally, and two pictures of one walk is worse than either.
   *   - not on a failure, where the two names are on screen precisely because
   *     we could NOT join them.
   */
  function drawSpine() {
    if (!el || !el.spine) return;
    const off = () => { el.spine.classList.add('hidden'); };
    if (!WF_UI.spineOn) return off();
    if (document.body.classList.contains('wf-live')) return off();
    const r = state.route;
    if (!r || !r.ok) return off();
    if (!el.strip.classList.contains('hidden')) return off();
    const a = el.orig.querySelector('.wf-mk-a');
    const b = el.sub.querySelector('.wf-mk-b');
    if (!a || !b || el.orig.classList.contains('hidden')) return off();
    const pr = el.pill.getBoundingClientRect();
    const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
    // WIDTH, NOT HEIGHT, IS THE LIVENESS TEST. A `.wf-mk` is an EMPTY
    // inline-block carrying its shape in a `::before`, and `align-self:center`
    // in a flex row gives an empty box zero height — measured, 15 x 0 on both.
    // Its `y` is then exactly the vertical centre of the row, which is where
    // `top:50%` puts the mark, so the arithmetic below is right and a
    // `!ar.height` guard would have silently switched the whole thing off.
    if (!ar.width || !br.width) return off();
    // AND THE BAR HAS A 1 px BORDER. `getBoundingClientRect()` measures the
    // border box; an absolutely positioned child is placed from the PADDING
    // box. Ignoring that put the spine one pixel below the tick — invisible on
    // its own and exactly the kind of thing that makes a join look like a
    // mistake. `clientTop`/`clientLeft` are that border, read rather than typed.
    const bt = el.pill.clientTop, bl = el.pill.clientLeft;
    const top = ar.top + ar.height / 2 - pr.top - bt;
    const bot = br.top + br.height / 2 - pr.top - bt;
    if (bot - top < WF_UI.spineMinPx) return off();
    el.spine.style.left = (ar.left + ar.width / 2 - pr.left - bl) + 'px';
    el.spine.style.top = top + 'px';
    el.spine.style.height = (bot - top) + 'px';
    el.spine.classList.remove('hidden');
  }

  /**
   * WALK IT — the door into the walking readout. (Round 4.)
   *
   * THE DEFECT IT CLOSES, and it is a whole half of this feature. Everything
   * §7d renders — the manoeuvre disc, `27 m, then left`, `and then right`, the
   * remaining figures, the progress on the ribbon — arms on `body.wf-live`,
   * which arms when the camera is within `liveOnRouteM` of the drawn line and
   * under `liveAltMaxM`. NOTHING IN THE INTERFACE EVER PUT IT THERE. Three
   * rounds of this lane photographed that readout by flying a test harness onto
   * the route; a person holding the phone would have had to spot the line from
   * 300 m up and fly down onto it by hand, with nothing anywhere telling them
   * there was a different bar waiting when they did.
   *
   * WHERE IT STANDS YOU, and why it is a search and not a point. The origin
   * DOOR is a point on a building's outline — it is on a wall. `js/controls.js`
   * answers a camera inside geometry by lifting it clear (`writeToMap`: if the
   * height field reads anything under the eye, the altitude is raised to
   * `h + HARD_CLEAR`), so placing the eye at the door does not clip through a
   * facade, it puts you on the ROOF looking down at one. That is exactly the
   * "camera buried inside a surface" failure that voided two rounds of work on
   * this project, and it is why this walks the route's own line outward,
   * probing `__fly.roofAt(lng, lat, walkClearR)` every `walkStepM`, and stands
   * at the first point that reads zero.
   *
   * It moves the camera and NOTHING else — no state, no route, no re-render.
   * `renderLive` arms itself off the camera the way it always has, so the walk
   * this opens is the same walk the readout was already written for.
   *
   * Returns true when it moved. Never throws into a click handler.
   */
  function walkIt() {
    const map = window.__map;
    const r = state.route;
    if (!WF_UI.walkItOn || !map || !r || !r.ok || !prof || !prof.segs.length) return false;
    const fly = window.__fly;

    // WHICH WAY YOU FACE IS THE NEXT REAL SEGMENT, NOT THE ONE YOU STAND ON.
    // The first cut faced along whatever segment the chosen point sat on — and
    // the chosen point is very often the far end of the DOOR LINK, the straight
    // line this app drew from the door to the nearest path node. Facing along
    // that put the view across the pavement instead of down it: measured on
    // `21 Rio -> WEL`, the ribbon was under 1 of 5 sample points down the lower
    // half of the frame. You face along the first segment that is a real piece
    // of the walked network.
    const faceAt = (j) => {
      for (let k = j; k < prof.segs.length; k++) {
        if (!prof.segs[k].link) return bearing(prof.segs[k].a, prof.segs[k].b);
      }
      const s = prof.segs[j];
      return bearing(s.a, s.b);
    };

    // Walk the profile outward from the origin door, sampling every
    // `walkStepM`, and keep the first sample with nothing over it. `roofAt` is
    // the app's own collision height field, so "clear" here means exactly what
    // the controller means by it. The lowest roof seen is kept as a fallback:
    // a button that silently does nothing is worse than one that stands you in
    // the best place on the route it could find, and the controller's own hard
    // net (`writeToMap`) guarantees the pose is never inside geometry either
    // way.
    // A POINT AT `m` METRES ALONG THE WALK, AND THE WAY THE WALK GOES THERE.
    // Both come off the polyline itself. The first cut stepped `walkLeadM`
    // along a straight bearing from the chosen point, which is only the same
    // thing while the route is straight: on `21 Rio -> WEL` the chosen point
    // was the END of a segment, the route turned there, and five metres along
    // the old bearing walked off the pavement onto a plaza — photographed, and
    // the ribbon was nowhere in the frame.
    const along = (m) => {
      for (let j = 0; j < prof.segs.length; j++) {
        const s = prof.segs[j];
        if (m <= s.at + s.len || j === prof.segs.length - 1) {
          const f = s.len > 0 ? Math.max(0, Math.min(1, (m - s.at) / s.len)) : 0;
          return { p: [s.a[0] + (s.b[0] - s.a[0]) * f, s.a[1] + (s.b[1] - s.a[1]) * f], j };
        }
      }
      return null;
    };

    let standAt = -1, best = null, bestRoof = Infinity;
    outer:
    for (let j = 0; j < prof.segs.length; j++) {
      const s = prof.segs[j];
      const n = Math.max(1, Math.ceil(s.len / WF_UI.walkStepM));
      for (let i = 0; i <= n; i++) {
        const f = i / n;
        const at = s.at + s.len * f;
        const p = [s.a[0] + (s.b[0] - s.a[0]) * f, s.a[1] + (s.b[1] - s.a[1]) * f];
        if (at > WF_UI.walkMaxM) break outer;
        if (s.link && i < n) continue;   // still on our own straight line to the door
        // No height field yet (the grid builds after the style does) is not a
        // reason to refuse — `roofAt` answers 0 and the first real point wins,
        // which is the path node the door link runs to and is never a wall.
        const roof = fly && typeof fly.roofAt === 'function'
          ? fly.roofAt(p[0], p[1], WF_UI.walkClearR) : 0;
        if (roof < bestRoof) { bestRoof = roof; best = at; }
        if (roof > 0) continue;
        standAt = at; break outer;
      }
    }
    if (standAt < 0 && best != null) standAt = best;
    if (standAt < 0) return false;

    // A few steps IN, measured along the polyline so a corner cannot throw it
    // off, and only if that ground is clear too.
    let hit = along(standAt);
    const ahead = along(standAt + WF_UI.walkLeadM);
    if (ahead && (!fly || typeof fly.roofAt !== 'function'
      || fly.roofAt(ahead.p[0], ahead.p[1], WF_UI.walkClearR) === 0)) { hit = ahead; standAt += WF_UI.walkLeadM; }
    if (!hit) return false;
    const stand = hit.p;
    // Look at a point down the WALK, falling back to the segment's own bearing
    // when the whole route left is shorter than the look-ahead.
    const look = along(Math.min(standAt + WF_UI.walkLookM, prof.total));
    const face = (look && metresBetween(stand, look.p) > 1)
      ? bearing(stand, look.p) : faceAt(hit.j);

    // The same closed-form placement the verification harness uses, so the pose
    // this button produces and the pose every walking shot in shots/walk/ui was
    // taken from are the same arithmetic. `alt = D cos(pitch)` and the centre
    // runs `alt tan(pitch)` ahead of the eye, which is what `syncFromMap` reads
    // back — so the controller inherits the pose instead of fighting it.
    const alt = WF_UI.walkAltM, pit = WF_UI.walkPitch;
    const rad = (d) => d * Math.PI / 180;
    const fov = map.getVerticalFieldOfView ? map.getVerticalFieldOfView() : 58;
    const camPx = 0.5 * map.getCanvas().clientHeight / Math.tan(rad(fov) / 2);
    const D = alt / Math.cos(rad(pit));
    const lead = alt * Math.tan(rad(pit));
    const cLat = stand[1] + lead * Math.cos(rad(face)) / MPD_LAT;
    const cLng = stand[0] + lead * Math.sin(rad(face)) / MPD_LON;
    const z = Math.log2(40030228.884 * Math.cos(rad(cLat)) * camPx / (512 * D));
    const pose = { center: [cLng, cLat], zoom: z, bearing: face, pitch: pit };
    if (map.stop) map.stop();
    map.jumpTo(pose);
    // AND THEN THE WALK KEEPS THE CAMERA. See holdWalk — round 1's critic
    // measured this button putting you on the pavement and something else
    // taking you back off it two seconds later, with no input.
    holdWalk(map, pose, stand);
    // AND THEN ASK THE READOUT AGAIN, A FEW TIMES. `jumpTo` does fire `move`
    // and `moveend`, and `onCam` is on both — but the readout reads
    // `__fly.eye()`, and the controller has not re-read the map yet on either
    // of those frames, so both samples see the camera that was 745 m up. The
    // bar stayed on the summary layout with the view standing on the pavement.
    // A handful of re-asks over half a second is bounded, costs nothing but a
    // textContent write when it lands, and stops the moment it takes.
    for (let i = 1; i <= WF_UI.walkSettleN; i++) {
      setTimeout(() => {
        if (document.body.classList.contains('wf-live')) return;
        liveAt = 0;
        try { onCam(); } catch (e) {}
      }, i * WF_UI.walkSettleMs);
    }
    // ROUND 7: AND THE FIRST 720 ms IS NOT THE WINDOW.
    //
    // MEASURED, on this branch and on the one before it, 390 x 844, real
    // Chromium, `?walk=1&drift=0&from=JES&to=WEL`, on a machine with four
    // sibling lanes running: `Walk it` puts the eye at **1.70 m** and the bar
    // stays on the SUMMARY layout for as long as you care to watch. Not the
    // camera being ejected — that is the other failure, it is older than this
    // round and its trace is in §35. This one is the camera standing exactly
    // where it should with the during-walk view never appearing.
    //
    // WHY. The eight re-asks above are eight `setTimeout`s armed at once, so
    // every one of them has fired 720 ms after the tap. But the walk is not
    // settled at 720 ms: js/app.js's opening flight lands its second leg 2-3 s
    // later, `holdWalk` answers by re-jumping, and THAT jump is the one the
    // readout has to see. Its `moveend` starts `onCamEnd`'s chain —
    // `endSettleN` x `endSettleMs` = 880 ms — and `sampleLive` reads
    // `__fly.eye()`, which js/controls.js only refreshes on its own next tick.
    // Under load that refresh can miss an 880 ms window, and with the camera
    // now parked there is no further `move` event, so nothing is ever going to
    // ask again. Exactly the shape of the bug §29 found on the way OUT of the
    // walk, on the way IN, and one tier further down the stack.
    //
    // So the asking lasts as long as the walk is contested. `walkSettleMaxMs`
    // is set to cover `walkHoldMs`, because that IS the window in which
    // something can still put the camera back on the pavement. It stops on the
    // first sample that arms the readout — the common case is that the burst
    // above already did, and this never runs a second poll.
    if (WF_UI.walkSettleTailOn) {
      const until = performance.now() + WF_UI.walkSettleMaxMs;
      const tail = () => {
        if (document.body.classList.contains('wf-live')) return;
        liveAt = 0;
        try { onCam(); } catch (e) {}
        if (document.body.classList.contains('wf-live')) return;
        if (performance.now() < until) setTimeout(tail, WF_UI.walkSettleTailMs);
      };
      setTimeout(tail, WF_UI.walkSettleN * WF_UI.walkSettleMs + WF_UI.walkSettleTailMs);
    }
    return true;
  }

  /**
   * ROUND 6: THE WALK KEEPS THE CAMERA UNTIL YOU TAKE IT BACK.
   *
   * WHAT WAS MEASURED. Round 1's critic drove the shipped build at 390 x 844,
   * tapped `Walk it` on JES -> WEL, and traced `__fly.eye().alt` — the camera
   * dropped correctly to 1.70 m and was then silently put back up in the air
   * within a few seconds with no input at all. Reproduced here 3 runs out of 3
   * (`?walk=1&drift=0&from=JES&to=WEL`, 390 x 844, real Chromium), and the
   * culprit came back NAMED, off a monkey-patched log of every camera call with
   * a stack on it:
   *
   *     t=+0.0 s  jumpTo   at walkIt      (js/wayfind.js)
   *     t=+2.5 s  easeTo   at js/app.js:1948          <- the opening flight
   *
   * `js/app.js`'s title sequence is TWO legs with a `setTimeout` between them.
   * Leg 2 is armed the moment leg 1 departs and it is only ever disarmed by the
   * intro's own `cancel()`. `walkIt` calls `map.stop()`, which kills the ease
   * that is RUNNING and cannot touch the timer that has not fired yet — so the
   * second leg lands on top of the walk and carries the camera to the intro's
   * end pose at 158 m. With `?fit=1` there is a second one of these: the Z6
   * `fitWhenFree` poll, which is waiting for exactly the quiet that `walkIt`'s
   * own `map.stop()` produces, and it fits to ~900 m — which is the number the
   * critic reported.
   *
   * A real FINGER dodges the first of the two by luck: the intro cancels itself
   * on `mousedown`, which a tap fires before the `click` that runs this button,
   * so the timer is cleared a few milliseconds before we need it gone. That is
   * not a fix, it is a coincidence — it does not hold for a keyboard `Enter`
   * arriving without a preceding pointer event, for `?fit=1`, for anything a
   * future pass schedules, and it did not hold for the critic.
   *
   * SO THE RULE IS THE OTHER WAY UP: for `walkHoldMs` after the tap, the walk
   * owns the camera. Anything that lifts the eye above `walkHoldAltM` or slides
   * it more than `walkHoldSlipM` off the spot we stood on — with no input in
   * between — is undone. THE MOMENT THE PERSON TOUCHES ANYTHING the hold is
   * released for good, so it can never fight the user: it is armed inside the
   * `click` handler, which is after that tap's own `mousedown`, and released by
   * the next one.
   *
   * TWO BRAKES, because a camera that fights back is worse than one that gives
   * up. It re-takes at most `walkHoldMaxN` times, and it will not re-take at
   * all unless the ground it wants is still clear (`roofAt` again) — so if the
   * controller's own hard net is pushing the eye out of geometry, this yields
   * to it instead of flickering in and out of a wall.
   */
  function releaseWalkHold() {
    if (!walkHold) return;
    clearInterval(walkHold.timer);
    try { walkHold.off(); } catch (e) {}
    walkHold = null;
  }
  function holdWalk(map, pose, stand) {
    releaseWalkHold();
    if (!WF_UI.walkHoldOn) return;
    const fly = window.__fly;
    const until = performance.now() + WF_UI.walkHoldMs;
    const evts = ['pointerdown', 'mousedown', 'touchstart', 'wheel', 'keydown'];
    const let_go = () => releaseWalkHold();
    const off = () => { for (const e of evts) window.removeEventListener(e, let_go, true); };
    for (const e of evts) window.addEventListener(e, let_go, true);
    let took = 0;
    const timer = setInterval(() => {
      if (!walkHold) return;
      if (performance.now() >= until) { releaseWalkHold(); return; }
      let eye = null;
      try { eye = fly && fly.eye ? fly.eye() : null; } catch (e) {}
      if (!eye) return;
      const slipped = metresBetween([eye.lng, eye.lat], stand) > WF_UI.walkHoldSlipM;
      if (eye.alt <= WF_UI.walkHoldAltM && !slipped) return;
      // Something took it. Is the spot we want still standable? If the height
      // field now says there is a roof over it, the controller is right and we
      // are wrong — stop.
      let clear = true;
      try {
        if (fly && typeof fly.roofAt === 'function') clear = fly.roofAt(stand[0], stand[1], WF_UI.walkClearR) === 0;
      } catch (e) {}
      if (!clear || ++took > WF_UI.walkHoldMaxN) { releaseWalkHold(); return; }
      try { if (map.stop) map.stop(); map.jumpTo(pose); } catch (e) {}
      liveAt = 0;
      try { onCam(); } catch (e) {}
    }, WF_UI.walkHoldPollMs);
    walkHold = { timer, off };
  }

  /**
   * THE ITINERARY, DRAWN — one thread, one row per thing that happens.
   *
   * Every mark on it is the SAME element the rail draws (`.wf-pip` with the
   * same kind class) and the two ends wear the SAME marks as the two name
   * lines (`.wf-mk-a`, `.wf-mk-b`), so a colour or a shape changed once in
   * style.css moves the bar, the rail and the list together and cannot be left
   * behind in one of the three. The turn glyphs are the manoeuvre discs from
   * the walking readout, at list size.
   */
  function renderSteps(r) {
    const box = h('div', null); box.id = 'wf-steps';
    box.appendChild(h('div', 'wf-steps-h', SAY_UI.stepsTitle));
    const rows = routeSteps(G, r, prof);
    for (const s of rows) {
      const row = h('div', 'wf-step wf-step-' + s.kind);
      const ic = h('span', 'wf-si');
      const tx = h('span', 'wf-sx');
      if (s.kind === 'start') {
        ic.appendChild(h('span', 'wf-mk wf-mk-a'));
        tx.appendChild(h('span', 'wf-sname', r.from.display));
      } else if (s.kind === 'end') {
        ic.appendChild(h('span', 'wf-mk wf-mk-b'));
        tx.appendChild(h('span', 'wf-sname', r.to.display));
        tx.appendChild(h('span', 'wf-sdoor', doorPhrase(G, r.toDoor)));
      } else if (s.kind === 'leg') {
        tx.textContent = fmtDist(s.m);
      } else if (s.kind === 'turn') {
        ic.appendChild(icon('wf-sturn', s.dir < 0 ? IC.turnLeft : IC.turnRight, 2.3));
        tx.textContent = turnWord(s.dir);
      } else {
        ic.appendChild(h('span', 'wf-pip wf-pip-' + s.kind + ' wf-sw'));
        tx.textContent = s.kind === 'stairs'
          ? (s.n > 1 ? SAY_UI.pipStairsN(s.n) : SAY_UI.pipStairs)
          : s.kind === 'signal'
            ? (s.n > 1 ? SAY_UI.pipSignalN(s.n) : SAY_UI.pipSignal)
            : (r.via ? r.via.name : SAY_UI.pipVia);
      }
      row.appendChild(ic); row.appendChild(tx);
      box.appendChild(row);
    }
    return box;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 7f. THE ANSWER BAR
  // ══════════════════════════════════════════════════════════════════════════
  function renderPill() {
    buildUI();
    const r = state.route;
    el.pill.classList.remove('hidden');
    document.body.classList.add('wf-routed');
    el.card.innerHTML = '';
    el.card.classList.toggle('hidden', !state.expanded);
    el.pill.classList.toggle('open', !!state.expanded);
    el.chev.setAttribute('aria-expanded', state.expanded ? 'true' : 'false');
    el.chev.title = state.expanded ? SAY_UI.hideDetails : SAY_UI.details;
    el.chev.setAttribute('aria-label', state.expanded ? SAY_UI.hideDetails : SAY_UI.details);
    // The visible word does NOT flip with the state — the chevron already turns
    // to say which way the door swings, and a label that changes under your
    // thumb is a second thing to read. It names what is behind the door, and it
    // only promises a list when there is one to promise.
    el.chevLab.textContent = WF_UI.stepsOn ? SAY_UI.stepsPeek : SAY_UI.details;
    el.headline.innerHTML = '';
    el.sub.innerHTML = '';
    el.orig.innerHTML = '';

    if (!r || !r.ok) {
      // 'nodoor' names whichever end cannot be routed; a register-only entry
      // (QUEUE Z3) gets the specific sentence, a graph entry the general one.
      const dead = r && r.why === 'nodoor'
        ? [state.to, state.from].find(e => e && (!e.doors.length || !e.routable))
        : null;
      el.headline.textContent = dead
        ? (dead.reg ? SAY.notWalkable(dead.code) : SAY.notRoutable)
        : (r && r.why === 'nodoor' ? SAY.notRoutable : SAY.noRoute);
      el.headline.className = 'fail';
      // BOTH ENDS STAY ON SCREEN ON A FAILURE, and that is not decoration.
      // The headline names whichever end we cannot route, and with only the
      // DESTINATION under it the bar read `FC1 is not walkable in this build
      // yet` over `Robert A. Welch Hall` — which says, to any reader, that
      // Welch is the building we do not have. The origin line comes back so
      // the sentence has the pair it is about underneath it.
      if (state.from) {
        el.orig.classList.remove('hidden');
        el.orig.appendChild(h('span', 'wf-mk wf-mk-a'));
        el.orig.appendChild(h('span', 'wf-from-lab', SAY.fromLabel));
        el.orig.appendChild(h('span', 'wf-from-name', state.from.display));
      } else {
        el.orig.classList.add('hidden');
      }
      el.sub.textContent = state.to ? state.to.display : '';
      el.verdict.textContent = '';
      el.verdict.className = '';
      el.strip.classList.add('hidden');
      el.key.classList.add('hidden'); el.key.innerHTML = '';
      // NO `SHOW ROUTE` ON A FAILURE — AND NO DEAD END EITHER. A button
      // offering to frame the route directly under `FC1 is not walkable in this
      // build yet` is offering the thing the line above it just said we do not
      // have, so it goes. Hiding the whole row went too far: the chevron is
      // hidden on a failure too, so the bar had no control on it at all and the
      // only way out was to find the button in the opposite corner and reopen
      // the sheet. `Clear` stays, alone, and it is the honest one.
      el.acts.classList.remove('hidden');
      el.acts.classList.add('fail');
      el.liveEl.classList.add('hidden');
      document.body.classList.remove('wf-live');
      document.body.classList.remove('wf-near');
      el.chev.classList.add('hidden');
      drawSpine();
      return;
    }
    el.acts.classList.remove('hidden');
    el.acts.classList.remove('fail');
    el.headline.className = '';
    el.chev.classList.remove('hidden');
    el.orig.classList.remove('hidden');
    // THE TWO ENDS WEAR THE SAME MARKS AS THE STRIP'S TWO ENDS. The rail used
    // to be a tick and a ring with nothing to attach them to, which is why the
    // first cut of it read as a slider (the comment in style.css says so). The
    // origin line now carries the tick and the destination line the ring, and
    // the rail between them stops being a control and becomes the walk.
    el.orig.appendChild(h('span', 'wf-mk wf-mk-a'));
    el.orig.appendChild(h('span', 'wf-from-lab', SAY.fromLabel));
    el.orig.appendChild(h('span', 'wf-from-name', r.from.display));

    // ── THE FIGURE LINE ────────────────────────────────────────────────────
    // Three facts, in decreasing order of how much they change your decision,
    // and not one of them is a claim we cannot back. They are the SAME strings
    // §11 permits: the minutes are 26 px and the rest is not, but
    // `el.headline.textContent` still returns `6-8 min walk · 530 m · No stairs
    // on this route` character for character, because the type is spans inside
    // it rather than a different sentence.
    const t = r.time;
    const mins = t.lo === 0 ? String(t.hi) : (t.lo + '-' + t.hi);
    // THE MODE COMES FIRST, AS A GLYPH. `min walk` carried the entire "this is
    // a walking route" claim in a 12.5 px word at the tail of the sentence,
    // which is the last thing an eye reaches on a bar whose first thing is a
    // 25 px number. The figure says it before the number does and costs
    // `.textContent` nothing — an <svg> contributes no characters to it.
    el.headline.appendChild(icon('wf-mode', IC.walk, 1.85));
    if (t.lo === 0) el.headline.appendChild(h('span', 'wf-pre', 'Under '));
    el.headline.appendChild(h('span', 'wf-big', mins));
    el.headline.appendChild(h('span', 'wf-unit', ' ' + SAY_UI.unitMin));
    el.headline.appendChild(h('span', 'wf-mid', ' · '));
    el.headline.appendChild(h('span', 'wf-dist', fmtDist(r.distM)));
    // THE CONDITION TAKES ITS OWN LINE, AND THE SEPARATOR IN FRONT OF IT GOES
    // WITH IT — hidden, not deleted, so `.textContent` is unchanged. Left as
    // one run, the figure line broke wherever it ran out of room: `12-20 min
    // walk · 1.1 km ·` / `No stairs on this route`, photographed at 390 x 844
    // on JES -> ANB, with the middot stranded at the end of the first line.
    // A line that sometimes wraps and sometimes does not is two layouts; the
    // break is deliberate now, the same on every route, and it puts the stairs
    // swatch at the head of its own line where it can be read.
    el.headline.appendChild(h('span', 'wf-mid wf-mid-cond', ' · '));
    // THE STAIRS SWATCH GOES ON THE SENTENCE, NOT IN A SECOND LIST. The key
    // below the strip binds a colour to a word, and the word for stairs is
    // already here — printing `Stairs: 3 sets` twice, forty pixels apart, to
    // introduce a colour is worse than either. So the pip's own class draws a
    // swatch in front of this phrase and the key carries only what the bar has
    // not said yet. `.textContent` is untouched: the swatch is an empty span.
    const cond = h('span', 'wf-cond');
    if (r.m.stairSets) cond.appendChild(h('span', 'wf-pip wf-pip-stairs wf-sw'));
    cond.appendChild(h('span', null,
      r.m.stairSets ? SAY.stairsSets(r.m.stairSets) : SAY.stairsNone));
    el.headline.appendChild(cond);

    // ── THE DESTINATION AND ITS DOOR ───────────────────────────────────────
    // The door phrase gets a doorway glyph and its own weight, because WHICH
    // DOOR is the single thing this app answers that a maps app does not, and
    // it was running on as the tail of a sentence in the dimmest colour in the
    // bar. `.textContent` is unchanged: the glyph is an aria-hidden <svg>.
    el.sub.appendChild(h('span', 'wf-mk wf-mk-b'));
    el.sub.appendChild(h('span', 'wf-dest', r.to.display));
    // THE MIDDOT IS STILL IN `.textContent` AND NO LONGER ON THE FRAME. The
    // separator's whole job is done by the doorway glyph beside it, and a
    // middot followed by an icon reads as a dropped word. It is kept in the
    // string, hidden, because `#wf-sub`.textContent is what the honesty gates
    // and the verify scripts assert on and it must not move.
    el.sub.appendChild(h('span', 'wf-mid wf-mid-hid', ' · '));
    const dsp = h('span', 'wf-door');
    dsp.appendChild(icon('wf-door-ic', IC.door, 1.7));
    dsp.appendChild(h('span', null, doorPhrase(G, r.toDoor)));
    el.sub.appendChild(dsp);

    // ── "WILL I MAKE IT?" — the one-sided answer. Honesty doc §15. ──────────
    //
    // A student between classes is not asking how to get there, they are asking
    // whether they have time, and making them do the subtraction while walking
    // is the app failing at its own job. So we do it — in ONE direction only.
    //
    //   both ends over the period   -> say so. If we are wrong they walk faster.
    //   the range crosses it        -> say it is tight. True of our own numbers.
    //   both ends under it          -> SAY NOTHING, on purpose.
    //
    // There is no "you'll make it" and there must not be. Our range measures
    // pavement between two doors; it knows nothing about getting out of a
    // lecture hall, a lift, a stairwell inside the building, the crowd on
    // Speedway at the hour, or finding the room.
    applyVerdict(t);

    renderLive();

    if (!state.expanded) { fitCard(); drawSpine(); return; }

    // THE ITINERARY IS THE FIRST THING IN THE CARD, because it is the thing the
    // card is opened for. The disclaimers that used to lead it are the thing
    // you read once; the list of what the walk does is the thing you read every
    // time. See §7a-ii for why every row of it is derivable.
    if (WF_UI.stepsOn && prof) el.card.appendChild(renderSteps(r));

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

    // THE CONTROLS COME BEFORE THE SMALL PRINT. The three stop chips were the
    // LAST thing in the card, under two paragraphs of disclaimer, so the two
    // things you can actually do to a route — put a stop on it, take the stairs
    // off it — sat either side of the longest run of grey text in the feature.
    // Photographed at 390 x 844: the chips landed 500 px below the top of the
    // bar and off the bottom of a phone whenever the card also had a via note
    // and an hours line in it.
    const chips = h('div', 'wf-chips');
    for (const kind of ['Coffee', 'Food', 'Store']) {
      const c = h('button', 'wf-chip' + (state.viaKind === kind && state.via != null ? ' on' : ''), '+ ' + SAY['chip' + kind]);
      c.addEventListener('click', (ev) => { ev.stopPropagation(); cycleStop(kind); });
      chips.appendChild(c);
    }
    if (state.via != null) {
      const x = h('button', 'wf-chip wf-chip-x');
      x.setAttribute('aria-label', SAY.clear);
      x.appendChild(icon(null, IC.close, 2.4));
      x.addEventListener('click', (ev) => { ev.stopPropagation(); state.via = null; state.viaKind = null; run(); });
      chips.appendChild(x);
    }
    el.card.appendChild(chips);

    // AVOID STAIRS. Named for what it does. Its limits sit next to the toggle,
    // not in an about page, because being wrong here strands a specific person
    // at the bottom of a staircase.
    const av = h('label', 'wf-toggle');
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = state.avoid;
    cb.addEventListener('change', () => { state.avoid = cb.checked; run(); });
    cb.addEventListener('click', (ev) => ev.stopPropagation());
    av.addEventListener('click', (ev) => ev.stopPropagation());
    av.appendChild(cb); av.appendChild(h('span', null, SAY.avoidStairs));
    el.card.appendChild(av);
    el.card.appendChild(h('div', 'wf-c wf-dim', SAY.avoidBlurb));
    el.card.appendChild(h('div', 'wf-c wf-dim', SAY.avoidNotAccess));
    if (state.avoid) el.card.appendChild(h('div', 'wf-c wf-dim', SAY.avoidShown(G.swEdges.size)));

    // NO ACTION ROW DOWN HERE ANY MORE. `Show route` and `Clear` moved OUT of
    // the card and into the closed bar — see `#wf-acts` in buildUI. Two copies
    // of the same button, one of them behind a chevron, is worse than either
    // one alone, and the copy that mattered was the one you could not see.

    const f = h('div', 'wf-foot');
    f.appendChild(h('div', null, SAY.asOf(fmtAsOf(G.asOf)) + ' · ' + SAY.changed));
    f.appendChild(h('div', null, SAY.noIndoor + ' · ' + SAY.osm + ' · ' + SAY.notUT));
    el.card.appendChild(f);

    fitCard();
    drawSpine();
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
    prof = null; live = null;
    disarmLive();
    releaseWalkHold();   // no route left to hold a camera on
    if (el) {
      el.pill.classList.add('hidden'); el.card.classList.add('hidden');
      el.pill.classList.remove('open');
      el.liveEl.classList.add('hidden');
    }
    document.body.classList.remove('wf-routed');
    document.body.classList.remove('wf-live');
    document.body.classList.remove('wf-near');
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
