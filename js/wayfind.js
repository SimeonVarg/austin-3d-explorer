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
    // ROUND 7 (docs/walk-stairs.md §R41). What the ROUTER charges for a flight
    // it KNOWS it is climbing, as a multiple of the same flight taken downhill
    // or with no `incline` tag at all. `null` means "whatever the card already
    // bills a climb at", i.e. `stairUpMult` — so the thing that CHOOSES the
    // route and the thing that PRICES it can never disagree, which they did
    // for six rounds. A number overrides it; **1 turns direction-aware routing
    // off entirely** and restores exactly the round-6 router.
    //
    // §R45 has the ladder this was NOT read off: the curve does not plateau,
    // it keeps buying climbs off the route all the way up, at a rising price
    // in real metres. How hard a walking router should work to dodge a climb
    // is a taste call, so it is one line here rather than a decision buried in
    // a function (CLAUDE.md rules 9 and 11). To say "never climb if there is
    // any way round", use a large FINITE number — 100000 saturates, measured.
    // Anything unreadable (below 1, negative, NaN, Infinity, a string) fails
    // SAFE to 1, i.e. to round 6, rather than to a guess: stairClimbMult().
    stairClimbCostMult: null,
    // WHAT AN INVENTED DOOR LINK COSTS, per metre of pavement. A link is the
    // dashed straight line from a door to the path network: nobody surveyed it,
    // it may cross a flowerbed, and at 1.0 the router spent them as shortcuts —
    // 485 m of invented line over twenty pairs, 278 m of it on grass or on
    // nothing. 4.0 is the knee of the measured curve (docs/walk-sidewalks.md):
    // 55 % of the off-pavement metres removed for 2.7 % more route. Set to 1 to
    // restore the old behaviour.
    //
    // INTEGRATION (acer/w-integrate): acer/w-sidewalks already read this key
    // here and fell back to a `const LINK_COST_MULT` buried in a function body
    // when it was absent — which it always was, so the value was in the body,
    // against CLAUDE.md rule 11, and INVISIBLE to anything outside this file.
    // scripts/verify/walkmeter.mjs reimplements this router to check itself and
    // could not see it, so its self-check drifted on 15 of 19 pairs the moment
    // the sidewalks lane landed and its "extra metres" number went uncalibrated.
    // Declaring it is what lets the meter read the real value off the page
    // instead of hardcoding a copy that can rot.
    linkCostMult: 4.0,
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

    // ── which door ────────────────────────────────────────────────────────
    // Simeon, on the walk feature: "many routes if not most take you to a
    // farther entrance than you have to go... you need to do research on where
    // students actually enter buildings." The research is in
    // docs/walk-evidence.md and it found that UT publishes the answer itself
    // (UT_CELEBRATED, below). These four numbers are what is left to taste.
    utDoorMatchM: 12,      // one of our doors counts as "the same door" as UT's
                           // surveyed one within this many metres, and is then
                           // used instead of UT's bare point — a real door is
                           // drawn in the city and a coordinate is not. This is
                           // not a round number, it is the trough: the 83
                           // UT doors on routable buildings pile up at 0-8 m
                           // (25 of them), thin out at 8-16 m (9), and pile up
                           // again at 16-28 m (25). Under 12 m is the same
                           // doorway; over it is a different one, on a
                           // different wall. Histogram in docs/walk-door.md.
    utDoorNearest: true,   // AND when nothing is that close, still walk to the
                           // door nearest UT's point rather than to the one the
                           // bake's scoring guessed. Set false to fall back to
                           // the old `role: main` behaviour on those buildings.
    useUTSurvey: true,     // the master switch on all of the above. Turning it
                           // OFF is how the numbers below were chosen: with UT
                           // held out, the 55 buildings UT surveyed become a
                           // labelled test set for the guessing rule that has
                           // to carry the other 228, and a rule can be scored
                           // instead of argued about. See docs/walk-door.md
                           // "held out" and scripts/verify walk harnesses.
    widenSideDoors: true,  // consider side doors at all on buildings UT does
                           // not cover. False = the old behaviour exactly, one
                           // `role: main` door per building and nothing else.
    sideDoorPenaltyM: 55,  // buildings UT does not cover (228 of 295). A door
                           // the bake called `secondary` is allowed to win, but
                           // only if it saves more than this — otherwise the
                           // router goes back to sending people round the block
                           // to a loading bay (HANDOFF #113: PCL->Jester came
                           // out 80 m through two back doors and 156 m through
                           // the two doors a person actually uses).
                           // 55 was a taste value when it was written and it is
                           // now a measured one. Held out (useUTSurvey false)
                           // and swept over 432 real routes into the buildings
                           // UT surveyed, this number turns out NOT to be a
                           // door-correctness lever at all — mean error to UT's
                           // door is 27.5-29.1 m at every setting from 0 to
                           // infinity, with no trend — but it IS a route-length
                           // lever: 599 m per route at 0, 674 m at infinity. So
                           // the argument for the value is #113, re-run here:
                           // PCL->Jester comes out 80 m through two back doors
                           // at 35 and below, and 156 m through the two front
                           // doors at 55 and above. The cliff is between 35 and
                           // 55, so 55 is the smallest safe value, not a round
                           // one. Curve and table in docs/walk-door.md.
    backDoorPenaltyM: 400, // service / exit / emergency doors. Effectively
                           // never, but not literally never: a building whose
                           // only mapped door is a service door still routes.
    utVirtualDoors: true,  // UT surveyed a door our own bake never placed at
                           // all (26 of the 55 routable buildings it covers).
                           // Route to UT's coordinate anyway, snapped to the
                           // walked network. Set false to route only to doors
                           // that exist in data/entrances.geojson.
    utVirtualSnapM: 75,    // and only if there is a mapped path that close to
                           // it — past that we would be inventing the walk as
                           // well as the door. This is long for a dashed last
                           // stretch and it is the honest length of one: the
                           // Music Recital Hall's entrance really is 37 m from
                           // the nearest footway anybody has mapped, and Jesse
                           // H. Jones Hall's is at the far end of an open
                           // courtyard between its two wings — it was raised
                           // from 45 only after standing at the snap node and
                           // looking up the courtyard,
                           // shots/walk/door/jon-courtyard-eye.jpg. The
                           // alternative for Jones Hall was a route 129 m
                           // LONGER that stopped 62 m short of the door and
                           // left those 62 m uncounted.
                           //
                           // IT WAS 58 UNTIL 2026-08-24, AND 58 WAS JONES HALL'S
                           // OWN 57 PLUS A METRE. That is a constant fitted to
                           // the last digit of one building's coordinate, and it
                           // broke the moment the coordinate moved: reading UT's
                           // point geometry instead of its Longitude/Latitude
                           // columns shifted Jones Hall's door 2 m, the snap it
                           // needs went 57.x -> 58.8, and the building silently
                           // stopped being routable — 0 m from UT's door became
                           // 59.9 m, with nothing failing to say so.
                           //
                           // MEASURED, cap lifted to 400 m, all 39 invented
                           // doors: 38 of them need 41.6 m or less, and Jones
                           // Hall needs 58.8 m. NOTHING lies between. So this
                           // number decides exactly one building and every cap
                           // from 58.8 m upward admits the identical set — its
                           // value above that is unobservable in today's data
                           // and matters only for the next data refresh. 75 is
                           // therefore set for HEADROOM, not for fit: 16.2 m
                           // above the real maximum, which is more than the
                           // 15.2 m by which UT's own two coordinate fields
                           // disagree on the worst building in play, so a
                           // future source swap of this kind cannot strand a
                           // building again. Lower it below 58.8 only if you
                           // mean to drop Jones Hall on purpose.
    utVirtualStepFree: true, // and with "avoid stairs" on, that snap must land
                           // in the step-free component of the network, not
                           // merely on a walkable node. Without this the Main
                           // Building's west entrance snapped onto the Tower's
                           // plinth — 37 nodes, every exit a staircase — and
                           // EVERY step-free route to or from the Tower came
                           // back "we cannot take you there", while UT's own
                           // survey calls that entrance barrier-free with an
                           // auto-opener. It costs 3.8 m of extra dashed leg at
                           // the Tower (42.8 -> 46.6 m) and recovers 3 of the 4
                           // buildings that were stranded (CMA, JGB, MAI). Set
                           // false to snap the same way in both modes.
    stepFreeDoors: true,   // and the same test applied to the doors we did NOT
                           // snap — our own baked ones. A door whose every
                           // anchor node sits outside the step-free component
                           // is a door this walker cannot arrive at, so it is
                           // not offered. Measured across all 158 buildings
                           // with mapped doors, from three hubs, live: it
                           // changes the candidate list for exactly three
                           // (CMB, AHG, NUR) and turns exactly one "No walking
                           // route found" into a walk (CMB).
                           // It adds no new endpoint of its own: a door it
                           // drops falls through to the same UT-coordinate
                           // snap round 3 already built, so all 20 pairs and
                           // every stairs-allowed route are bit-identical.
                           // Set false to offer unreachable doors again.
    utVirtualAnchors: 8,   // HOW MANY WAYS THERE ARE OF WALKING UP TO A DOOR.
                           // A baked door carries every anchor the bake found
                           // for it — Welch's main carries two, 0.4 m and
                           // 22.6 m out — and dijkstra picks whichever suits
                           // the walk. A door we invent at UT's coordinate
                           // used to carry exactly ONE, the nearest node, so
                           // the router had no choice to make: it had to reach
                           // that node however far round it came. This is the
                           // count of anchors such a door may carry. 1
                           // restores the old single-snap behaviour exactly.
    utVirtualClusterM: 15, // and how far from the NEAREST anchor the extra
                           // ones may sit. THE LAST STRETCH IS A STRAIGHT LINE
                           // OVER GROUND NOBODY HAS MAPPED, so the further
                           // round the building an anchor sits, the more of
                           // that line runs through the building itself —
                           // which is the one thing this feature is not
                           // allowed to do. Measured over 416 trips by
                           // intersecting every drawn stretch with the pinned
                           // snapshot's own footprints:
                           //
                           //   anchors  cluster   stretches through a building
                           //         1     —        70 of 615   (round 5)
                           //         8     no bound 115 of 626
                           //         8     25 m      91 of 623
                           //         8     15 m      76 of 619
                           //         8      8 m      70 of 616
                           //
                           // and the walk over all 416 trips: 236.9 km at one
                           // anchor, 230.3 km unbounded, 235.3 km at 15. So 15
                           // buys 1.6 km of the 6.6 km on offer and ACCEPTS
                           // only 6 of the 45 extra through-building stretches
                           // the unbounded rule drew. A tried-and-dropped
                           // ANGULAR version of the same idea (a ±60° cone off
                           // the nearest anchor) scored 92 and was strictly
                           // worse than this at every setting, so there is one
                           // knob here and not two.
    utVirtualSpreadM: 14,  // and how much LONGER than the nearest one an
                           // anchor's dashed stretch may be. The point of the
                           // extra anchors is a different approach to the same
                           // door, not a different door: past this they stop
                           // being the same last stretch. Straight metres, so
                           // it reads against utVirtualSnapM above.
    // ── AFTER DARK: which of this walk has a mapped light on it ───────────
    //
    // WHAT THE NUMBERS ARE AND WHY THEY ARE THESE NUMBERS. Measured on this
    // repo's own files, 2026-08-23, and written up in docs/walk-lit.md:
    //
    //   data/props.geojson carries 236 `k:"lit"` points — 193 warm
    //   (highway=street_lamp) and 43 blue (emergency=phone, UT's blue-light
    //   call boxes). They are the ONLY lights the 3D scene actually stands a
    //   pole under, and data/walk_lamps.json is those same points republished
    //   at 2.5 KB so this file can read them.
    //
    //   Against the 11,773 routable edges of the walk graph, a warm lamp
    //   within 25 m covers 9.2 % of the network's METRES. Nine per cent is why
    //   the default is to ANNOTATE and not to re-route: optimising a path for
    //   a signal that thin steers by who bothered to map, not by where the
    //   light is. The lit alternative below is offered, priced, and taken by
    //   the user — never chosen for them.
    litOn: true,
    litUrl: 'data/walk_lamps.json',
    litRadiusM: 25,        // a mapped streetlight this close COUNTS as covering
                           // the path. A UT walkway lamp is a ~5 m mast and the
                           // scene draws its pool at 7-9 m ground radius
                           // (PROPS.litGroundNear); 25 m is the walkable throw,
                           // deliberately more generous than the drawn disc so
                           // the claim is not an artifact of a render choice.
    // ── a lamp standing under a tree ────────────────────────────────────────
    // Found by looking, not by reasoning: a 43-site pixel audit
    // (shots/walk/lit/litaudit.mjs) turned up two places where the card counted
    // a mapped lamp and the night frame showed nothing at all. Hiding the tree
    // and building layers brought ~2,950 lamp pixels back at both, and
    // data/trees.geojson has a 10.3 m canopy centred within a metre of each
    // lamp, reaching 12 m over a 4.9 m head. City-wide that is 56 of 193 warm
    // lamps. It is REPORTED, never deducted — a lamp under an oak is still a
    // lamp — and it nudges the offered alternative, which is the only place
    // this feature is allowed to act rather than say.
    canopyOn: true,
    decorNoteOn: true,    // the one line that tells a user the road glow is
                          // scenery. Taste call, and one word to drop.
    // WHAT AN EDGE COSTS THE LIT-PREFERRING SEARCH WHEN ITS ONLY LAMPS ARE
    // UNDER TREES — and it ships at 1, which means OFF, on measurement rather
    // than on taste. It was written at 1.25, on the reasoning that a covered
    // lamp still throws light but less of it reaches the pavement. Then it was
    // A/B'd over 60 seeded building pairs (shots/walk/lit/canopy-ab.mjs), and:
    //
    //   routes carrying at least one tree-covered lamp        12 of 60
    //   ...of those, routes whose OFFER changed at 1.25        0
    //   routes whose offer changed at all                      1
    //   ...and that one had NO covered lamp on it: at 1.25 it
    //      lost an offer of 1,201 m with 10 lamps that 1.0 made
    //
    // So it does nothing where it was aimed and takes away a good offer where
    // it was not. A term in a cost function that provably moves nothing should
    // not ship steering anything, however sound the reasoning behind it — the
    // canopy count is verified and worth SAYING, and is not verified to be
    // worth ROUTING BY. Raise it to 1.25 and the search prefers open lamps
    // again; the count in the card is unaffected either way.
    litCanopyMult: 1,
    litPhoneNearM: 40,     // a blue-light phone is a thing you RUN TO, not a
                           // thing that lights your path. Counted separately,
                           // at a radius that means "on this walk", not "over
                           // your head".
    litSampleM: 8,         // resample step. Half the shortest gap worth naming.
    litGapMinM: 60,        // an unmapped stretch shorter than this gets no
                           // sentence: at 1.2 m/s it is under a minute and
                           // every route has one.
    litNightP: 0.45,       // nightness (0 day, 1 full night) at or above which
                           // the lighting line is worth putting in the closed
                           // pill instead of only in the card.
    litDayOpacityMul: 0.25, // the marks never vanish in daylight — you may be
                           // planning a walk you will take at 9 pm — but they
                           // step back to a quarter until the sun goes down.
    litLampCol: '#ffc27a', // EXACTLY js/props.js's warm `lit` circle colour, so
    litPhoneCol: '#6fa8ff', // and its blue one. A mark under a lamp that is not
                           // the lamp's own colour is a second light source.
    // The unmapped stretch: cool, flat, and deliberately NOT black — it is
    // "nothing is mapped here", not "this is dark", and a black route would say
    // the second thing and also be unfollowable.
    //
    // TUNED BY LOOKING, AND THE FIRST VALUE WAS BACKWARDS. At `#59637a` the
    // unmapped stretch came out as the BRIGHTEST thing in a night aerial —
    // brighter than the amber it was supposed to read as the poor relation of
    // (shots/walk/lit/anb-etc-lamp-air.png, first pass). A stretch we are
    // warning about must not look like the stretch we are recommending, so it
    // went two steps down in value and stayed cool.
    litDarkCol: '#39435e',
    // The SAME fact needs two different colours: `litDarkCol` is a mark lying
    // on a night street and has to be dark to read as unlit; the same words on
    // the dark glass of the pill have to be light to read at all. Keeping one
    // constant for both is how "no mapped streetlight" became unreadable text.
    litTextDim: '#9fb0cc',
    // The mark at every counted lamp is a square RING, not a filled pad: the
    // lamp already throws its own warm pool in the scene and a second amber
    // blob on top of it reads as a second light. A ring reads as a tag on the
    // light that is already there — which is exactly what it is.
    litPadM: 2.8,          // outer side, ground metres
    litPadRimM: 0.45,      // how thick the ring is
    litPadH: 0.34,         // stands proud of GROUND.pathRaise (0.22) so it is
                           // not buried by the pavement slab, like the ribbon.
    litPadOpacity: 0.8,
    // ── THE RING ROUND A LAMP WITH A TREE ON IT ────────────────────────────
    //
    // Round 3 found live oaks standing on counted street lamps and made it a
    // field in the index (`warm_canopy`, 56 of 193) and a clause in the card
    // ("4 of them are under tree cover"), counted and never deducted. Round 5's
    // matrix put twelve cameras on stretches this card draws AMBER
    // (shots/walk/lit/stretchscene.mjs) and the flag turned out to predict the
    // picture exactly: ten of twelve sites have a lamp burning in the frame,
    // the two that are pitch black are BOTH canopy-flagged, and at a third
    // flagged site the flagged lamp itself contributes nothing inside the 25 m
    // disc while another lamp lights the frame. Three flagged, three with no
    // light of their own; nine unflagged, nine lit. `litgap.mjs` hid one layer
    // family at a time at the two black ones: buildings 0, ground 0, TREES
    // +4,380 and +3,034 pool pixels.
    //
    // WHICH MAKES THE RING THE ONE THING IN THIS FEATURE THAT OVERSTATES. Fly
    // to a flagged lamp at night and there is a full-strength amber ring on the
    // pavement — the claim's receipt — with no light in it. The card's canopy
    // sentence was the only claim in the block with nothing on the map to check
    // it against, and the mark that WAS there quietly contradicted it.
    //
    // So a flagged lamp gets the same ring, same size, same shape, same hue,
    // in a dimmer value. It is still a counted lamp and the count is unchanged:
    // this can only ever make a counted lamp look like LESS light, which is the
    // same test every permitted sentence in docs/walk-lit.md §5 has to pass.
    // One line to drop the whole idea.
    litPadCanopyOn: true,
    litPadCanopyCol: '#9c7748', // litLampCol carried down in value, not shifted
                           // in hue: a dimmer lamp, not a different object.
    litDarkLiftM: 0.05,    // the unmapped overlay rides this far above the
                           // ribbon's own top so the two never z-fight.
    litDarkWidthMul: 1.04, // ...and is a hair wider, so its edges are visible
                           // against the ribbon rather than exactly on them.
    litDarkOpacity: 0.9,
    // The offered alternative. `litAltMult` is what an unmapped metre costs the
    // search; `litAltMaxFrac` is the hard ceiling on the answer it may return.
    // The multiplier only decides which way it leans — the ceiling is the
    // promise, and it is checked against the REAL distance, re-measured after
    // the search with the real edge lengths.
    litAltMult: 1.7,
    litAltMaxFrac: 1.35,   // never offer a route more than 35 % longer. Time
                           // outside after dark is itself a cost and we cannot
                           // measure the trade, so we bound it.
    litAltMinGainM: 40,    // and never offer one that buys less than this much
                           // extra covered walking. Below that it is noise.

    // ── THE BLOCK IN THE CARD, AND WHY IT IS A PICTURE NOW ─────────────────
    //
    // MEASURED, NOT FELT (shots/walk/lit/cardshot.mjs, before/after JSON next
    // to it). Three rounds of this lane verified the lighting CLAIM against the
    // scene and never once looked at the block it is printed in. Photographed:
    //
    //   ANB -> ETC          252 px of a 466 px card = 54 %  17 lines  105 words
    //   GDC -> Castilian    312 px of a 526 px card = 59 %  20 lines  162 words
    //   PMA -> WEL          232 px of a 446 px card = 52 %  16 lines   99 words
    //
    // Every sentence in it is honest and every sentence is the same weight, so
    // the walk home into West Campus printed "No mapped streetlight along this
    // route" in the same grey, at the same size, as three paragraphs of
    // provenance. Nobody reads that at 11 pm, which means the caveats were not
    // being read either. Round 4 gave the block one picture, one headline, and
    // put the provenance behind a line that carries its own warning.
    //
    // THE STRIP is the whole walk left to right, amber where a mapped lamp is
    // within `litRadiusM` and cool where none is, with a tick at every spot
    // somebody reported too dark. It answers the question the numbers could
    // not: WHERE. A 700 m gap in the middle of a walk and a 700 m gap at the
    // door are the same sentence and completely different walks.
    litStripOn: true,
    litStripH: 10,         // px. Tall enough to read a colour, short enough not
                           // to be a chart.
    litStripRadius: 5,
    litStripMinFrac: 0.008, // a run this much of the walk or less still gets
                           // this much width, so a single lamp in a 2 km walk
                           // is a visible mark rather than a rounding error.
                           // It makes the strip a schematic, not a scale bar —
                           // which is why the metres are still printed under it.
    // The map's `litDarkCol` is #39435e because it is a mark lying on a night
    // street. The SAME fact on the dark glass of the card needs to be lighter
    // to read at all — this is exactly the `litTextDim` lesson, one object
    // along. Two constants because they are two surfaces, not one value used
    // twice.
    litStripLitCol: '#ffc27a',   // = litLampCol. A lamp is a lamp on both.
    litStripDarkCol: '#46536f',
    litStripTickCol: '#c3b0ff',  // = darkTextCol, the on-glass violet
    litStripTickW: 2,      // px
    litStripCapsOn: true,  // the two end labels under the strip. Without them
                           // nothing says which end is your door.
    // ...and both of the caps row's own values, which sat buried in a style
    // string from round 4 until round 7 measured them. 9.5 px at 45 % opacity
    // renders at 3.86:1 on this card (shots/walk/lit/readable-before.json) —
    // under the 4.5:1 a person needs to resolve text this size. Every number
    // here is now a named constant because CLAUDE.md rule 11 says so and
    // because the last two rounds have both wanted to tune one of them.
    litStripCapsPx: 9.5,
    litStripCapsOpacity: 0.58,   // MEASURED UP FROM 0.45, not felt. Swept on
                                 // the real card (shots/walk/lit/edgesweep.mjs):
                                 // .45 -> 3.88:1, .52 -> 4.84:1, .58 -> 5.69:1.
                                 // .52 already clears, by 0.34 — and the glass
                                 // behind this block measured anywhere from
                                 // (17,13,11) to (29,19,30) depending on what
                                 // the city is painting, so 0.34 is inside the
                                 // noise. The lowest value that clears at BOTH
                                 // widths with margin wins.
    // ── THE PICTURE COULD NOT BE SEEN, WHICH IS UPSTREAM OF WHAT IT MEANS ──
    //
    // Round 6 gave the bar a key. Round 7 measured the bar and the key against
    // the glass they are drawn on (shots/walk/lit/readable.mjs) and found the
    // one thing six rounds of colour work had never checked:
    //
    //   bar, unmapped run  `litStripDarkCol` on the card   2.34:1
    //   key swatch, cool   the same value, 9 px square     2.46:1
    //   WCAG 2.1 AA for a mark that carries meaning        3.00:1
    //
    // Every WORD in this block clears AA. The two things that do not are the
    // colour meaning "nothing is mapped here" and the mark round 6 added to
    // name it — and on the West Campus walk home the whole bar is that colour.
    //
    // THE FIX IS NOT TO LIGHTEN `litStripDarkCol`. What that colour has to
    // separate from is the AMBER beside it, and measured, it does: cool against
    // lit is 4.86:1, well clear. The failing comparison is against the CARD,
    // which is a question about seeing the object's extent, not about reading
    // its meaning — and the answer to that is an edge, not a repaint. Moving
    // the fill would also have cost §47's proof that the key and the bar are
    // the same colour on screen, for a problem the fill does not have.
    litStripEdgeOn: true,
    // `litStripDarkCol` lifted along its own ramp, so the frame reads as the
    // bar's own edge and not as a new colour brought in to pass a test. Swept
    // over six values (shots/walk/lit/edgesweep.json): #46536f 2.34:1,
    // #5a6688 3.17:1, #6b779a 4.06:1, #7b88a6 5.08:1, #9fb0cc 8.21:1, all at
    // the worse of the two widths. #5a6688 clears by 0.17 and that is inside
    // the glass's own variation; #6b779a is the lowest with real margin, and
    // the frames were looked at as well as scored — anything above it starts
    // reading as a pill outline instead of an edge.
    litStripEdgeCol: '#6b779a',
    litStripEdgePx: 1,     // inset, via box-sizing: the bar stays litStripH
                           // tall and the swatch stays litSwatchPx square, so
                           // no line of this card moves (round 4's metric).
    // ── THE PICTURE HAD NO KEY ─────────────────────────────────────────────
    //
    // Round 4 replaced twenty lines of prose with a bar, and round 5 proved the
    // bar survives a 390 px handset. Neither asked the question underneath
    // both: can a person tell what its colours MEAN? Read off the shipped card,
    // the three colours are anchored very unevenly.
    //
    //   amber   `litStripLitCol` === `litLampCol`, and the count line is set in
    //           `litLampCol` DIRECTLY under the bar. Amber explains itself.
    //   violet  `litStripTickCol` === `darkTextCol`, so the tie exists — but
    //           the line it ties to sits two to four lines below the bar, past
    //           the longest-gap and the emergency phones.
    //   cool    tied to NOTHING. `litStripDarkCol` appears nowhere else on the
    //           card, and "No mapped streetlight along this route" is set in
    //           `litTextDim`, a deliberately different value for the reason
    //           `litTextDim` itself records. On a route with no counted lamp —
    //           the West Campus walk home, the walk this feature exists for —
    //           the bar is one flat colour that nothing on screen names.
    //
    // A LEGEND ROW IS THE OBVIOUS ANSWER AND IT DOES NOT FIT. §37 measured
    // `#wf-card` at 153 px on a 390 px handset and the caps row's START/DOOR
    // already fill that width. Adding words also runs straight back at round
    // 4's finding, which was that this block had too many.
    //
    // So the key is not a row. It is ONE MARK, in the strip's own colour, at
    // the head of the sentence that colour means: no words, no new line, no
    // height. The swatch beside the count is the strip's amber (or its cool,
    // when there is nothing to count); the mark beside the reported-dark line
    // is the strip's tick, at the strip's tick width, so it reads as the same
    // object rather than as a bullet.
    litSwatchOn: true,
    litSwatchPx: 9,        // square side / tick height, px. Just under the
                           // 10 px strip, so it reads as a piece of it.
    litSwatchRadius: 2,
    litSwatchGap: 6,       // px between the mark and the words it labels
    // ── THE LAMP JUST OFF THE PATH ─────────────────────────────────────────
    //
    // MEASURED, AND IT IS THE FINDING OF ROUND 4 (shots/walk/lit/boundary.mjs).
    // Round 3's 43-site matrix sampled "unmapped" only where the nearest
    // counted lamp is more than 60 m away — clear of the boundary on purpose,
    // which means the clean result was obtained on the easy half. Round 4
    // sampled the band the matrix skipped, 25 to 60 m, at 18 sites off 8 real
    // routes, plan view, night, card hidden:
    //
    //   a warm street lamp is somewhere in the night frame       9 of 18
    //   ...its pool reaches inside the 25 m disc itself          5 of 18
    //   nearest-lamp distance: min 25.2 m, median 28.9 m
    //
    // So on a route with no lamp inside 25 m, half the time a person who goes
    // and looks can see one. The card is right — the claim is about 25 m — and
    // it is right in a way that will get it called wrong.
    //
    // THE FIX IS A CLAUSE, NOT A WIDER RADIUS. Raising `litRadiusM` to swallow
    // the band would inflate every coverage number in this feature and make
    // "covering the path" mean a lamp across a lawn. The radius is defended on
    // what a 5 m mast actually throws and it stays. Instead the scan counts the
    // ring OUTSIDE it and the card says so — but only on a route with no
    // counted lamp at all, because that is the sentence that reads like a
    // verdict and the only one worth qualifying.
    litNearMissOn: true,
    // ROUND 5 MEASURED THE WIDTH OF THIS RING INSTEAD OF REASONING ABOUT IT.
    // Round 4 shipped 50 m — "twice the counting radius, and inside the 60 m
    // round 3 called clear of the boundary" — and wrote in its own §31 that
    // this "is a reason, not a measurement". Round 4's own 9-of-18 came off a
    // sample that put six sites on one route and two of them 24 m apart.
    //
    // shots/walk/lit/stretchscene.mjs: 24 sites, four distance buckets,
    // deduplicated by coordinate and spread over 35 routes, flown to at night,
    // masked pixels, card hidden. A warm street lamp is somewhere in the frame:
    //
    //   25-30 m from the nearest mapped lamp     5 of 6
    //   30-35 m                                  4 of 6
    //   35-40 m                                  3 of 6
    //   40-50 m                                  0 of 6
    //   >120 m (the control)                     0 of 12
    //
    // The outer ten metres of the shipped ring hold lamps NOBODY STANDING THERE
    // CAN SEE. This clause exists to stop "No mapped streetlight along this
    // route" being called wrong by a person who walks out and looks at one — and
    // a lamp that cannot be seen is not that person's objection. Counting it
    // makes the sentence longer and less true in the same stroke, and in the one
    // direction this feature has spent five rounds refusing to be wrong in:
    // sounding like more light than is there.
    //
    // PRICED BEFORE IT WAS CHANGED (shots/walk/lit/ringsweep.mjs, 60 seeded
    // routes, the sweep driven through the real router with the reprice hook
    // checked every pass): 33 routes have no counted lamp; the clause fires on
    // 3 of them at 50 m and 2 at 40 m. Exactly one route in sixty changes —
    // NEZ->TMM, which at 50 m was told about a single lamp 40-50 m away.
    litNearMissM: 40,      // outer ring, at the measured edge of what is
                           // visible from the pavement at night. Raise it and
                           // the clause starts naming lamps you cannot see.
    // FOLDING THE PROVENANCE. Three dated paragraphs, eight of the twenty
    // lines, and they were the least-read text in the app precisely because
    // they were the longest. Folded, the two disclaimers that matter most —
    // "mapped only" and "not a safety rating" — are promoted into the
    // always-visible label, and the full sourcing is one tap away, unchanged
    // and still dated. Nothing is deleted; a shorter caveat that is read beats
    // a longer one that is not. Flip to false and all three print in full.
    litProvenanceFold: true,

    // ── AND THE OTHER SOURCE: WHERE PEOPLE SAID IT WAS DARK ────────────────
    //
    // Everything above is about the MAP — where a lamp is recorded. This is the
    // one signal in the feature that is about the WORLD: in 2017 the City of
    // Austin Transportation Department put up a public-input map for West
    // Campus and asked residents to drop a pin where a light was needed. 182 of
    // those pins are inside the city we draw, 100 of them with the person's own
    // words attached — "This street isn't lit at all at night", "The alleyway
    // here is very dark at night."
    //
    // WHY IT IS WORTH CARRYING A 2018 FILE. Measured on this repo, 2026-08-23:
    // inside the survey's own study area OSM has 58 street lamps covering 7.1 %
    // of the walk network's metres; the pins touch 32.6 % of the same metres.
    // West Campus after midnight is the walk this whole feature exists for and
    // the lamp layer is nearly silent about it.
    //
    // AND THE TWO SOURCES DO NOT FIGHT. Only 3 of the 182 pins have a mapped
    // lamp within 25 m. A point dropped at random on the same network would sit
    // near a mapped lamp about 7 % of the time; these do it 2 % of the time —
    // they land where OSM has no light either, which is what you would want a
    // report of darkness to do.
    //
    // WHAT IT IS NOT: current, complete, or a measurement. It is what people
    // said eight years ago. Lights have been added since — that is what the
    // survey was FOR — and nobody surveyed the streets nobody pinned. Every
    // sentence built on it carries the year, and none of them says "dark".
    // They say "reported".
    darkOn: true,
    darkNearM: 35,         // how close a pin has to be to count as being ON this
                           // route. A pin is a finger on a phone map describing
                           // a STRETCH of street ("this entire street is very
                           // dark"), not a survey point, so this is wider than
                           // litRadiusM on purpose and should not be read as a
                           // precision claim.
    darkQuoteMinLen: 12,   // a comment shorter than this ("dark", "more light")
                           // is a vote, not a sentence, and quoting it back to
                           // someone makes the feature look thinner than it is.
    darkQuoteMaxLen: 96,   // and one longer than this is trimmed on a word.
    // A THIRD colour, and it has to be a third. Amber already means "a mapped
    // lamp is here" and litDarkCol means "nothing is mapped here"; a person
    // saying "it is dark here" is neither of those, and painting it in either
    // one would fold a human report into a fact about the map. Cool violet: it
    // cannot be mistaken for a light source in a night frame, and it is the one
    // hue nothing else in this scene uses.
    darkCol: '#a98cff',
    darkTextCol: '#c3b0ff', // the same fact on the dark glass of the card, where
                           // the ground colour is too dark to read as text.
    darkMarkM: 4.6,        // outer side of the mark, ground metres — larger than
                           // litPadM so the two never read as the same object.
    darkMarkRimM: 0.5,
    darkMarkH: 0.30,       // just under litPadH: where a pin and a lamp land in
                           // the same place (3 of 182 do) the lamp's ring is the
                           // one on top, because the lamp is the newer fact.
    darkMarkOpacity: 0.72,
    darkMarkDiamond: true, // drawn as a diamond, not a square. The lamp ring is
                           // an axis-aligned square; at a walking camera two
                           // squares of different sizes read as the same mark
                           // twice, and a 45-degree turn is legible at a glance
                           // where a size difference is not.
    // What a reported-dark edge costs the OFFERED alternative's search. This is
    // the second reason that alternative exists — and in West Campus it is the
    // only reason, because there are hardly any lamps there to prefer toward.
    darkAltMult: 1.5,
    darkAltMinDrop: 2,     // an alternative that sheds fewer reported spots than
                           // this is not worth a button. It is offered when it
                           // clears EITHER this or litAltMinGainM, because in
                           // West Campus a route can drop four reported-dark
                           // spots while gaining no mapped lamp at all.
    // ── stairs, and the way round them (docs/walk-stairs.md) ──────────────
    // Every judgement the stair code makes is one line here. Nothing in
    // section 3b invents a number.
    stairAlt: true,        // compute the step-free alternative alongside any
                           // route that has stairs on it. One extra Dijkstra.
                           // MEASURED, not assumed: eight fixed pairs, nine
                           // interleaved reps, minimum of each, hardware GL,
                           // no CPU throttle — worst pair +1.3 ms, most +0.5,
                           // on routes that cost 0.3-1.0 ms to begin with.
                           // False = the alternative is only ever produced by
                           // the toggle.
    stairAltCleanDoors: true,
                           // ...and, in that pass ONLY, refuse a door whose
                           // unmapped last-stretch line crosses a mapped
                           // staircase. Four anchors of 421 do (COM, CS3, MAG,
                           // STD) and they made 11 of 140 offered step-free
                           // routes not step-free. False = the old behaviour.
    stairAltFarExtraM: 400,
                           // above this much extra walking the alternative is
                           // still offered — never hidden, that is the whole
                           // point of it — but it is FAR, and the interface
                           // should say so rather than let a number pass as a
                           // suggestion. GEB>WEL is 178 m direct and 994 m
                           // step-free; that is a decision, not a detour.
    stairLegGridDeg: 0.0006,
                           // ~55 m spatial bucket for the leg-crossing test.
                           // Not taste, but it is a tuning number and it does
                           // not belong in a function body either.
    // ── ROUND 4: A STAIRCASE IS AN OBJECT, NOT A LINE ────────────────────
    // Rounds 1-3 tested the door leg against the staircase's CENTRELINE with
    // a segment-segment intersection, and that test cannot see the worst
    // case there is: a leg running ALONG a flight rather than across it is
    // parallel, so the determinant is zero and the answer is "no crossing"
    // while the person walks the whole staircase. `bake_ground.py` draws the
    // same staircase 3.0 m wide (`DEFAULT_WIDTH['steps']`), so the drawn slab
    // said "you are on the steps" for four of forty-eight offered step-free
    // routes while the router said clean. This is that width, given to the
    // router, so the two files agree by construction rather than by luck.
    stairLegHalfWidthM: 1.5,
    // ...and how much of the leg has to lie inside that width before it is
    // walking on the staircase rather than clipping its corner. MEASURED,
    // not assumed: over 120 routes the metres-inside-a-drawn-slab for door
    // legs the old test called clean came out
    // 0.24 0.24 0.24 0.24 0.73 0.73 | 1.98 2.74 2.99 2.99 — a graze cannot
    // reach half the slab's width, and a real crossing of a 3.0 m slab
    // cannot fall below it. 1.5 m is the gap, and it is half the width for a
    // reason rather than a number picked out of the histogram's middle.
    stairLegOverlapMinM: 1.5,
    // ── AND THE ONE THAT KEEPS THE WIDTH TEST HONEST ─────────────────────
    // Overlap ALONE convicts the innocent, and the frame is what showed it.
    // Every door leg that leaves the top of a flight starts ON the flight and
    // diverges, so it overlaps for the first couple of metres without anyone
    // walking down a single step. Measured on the eight legs the width test
    // caught, the angle between the leg and the flight is completely
    // bimodal:
    //     1  1  1  1 deg   the leg IS the flight, 4.0-4.2 m of overlap
    //    32 61 61 61 deg   the leg leaves an end of it and walks away
    // Both groups share an endpoint with the staircase to within 6 cm, so
    // "does it touch" cannot separate them and "which way does it point"
    // separates them completely. 20 deg sits in a 12-degree empty gap.
    //
    // This is also precisely the case the intersection test cannot see: two
    // parallel segments never cross, so 0 deg is its blind spot and 0 deg is
    // the only angle at which a door leg is really a staircase.
    stairLegParallelDeg: 20,
    // ── ROUND 5: A REFUSAL IS A CLAIM TOO ────────────────────────────────
    // "There is no step-free way to get you there" is a UNIVERSAL NEGATIVE,
    // and it was the one thing this feature says that nothing had ever
    // checked. Rounds 1-4 verified the routes it OFFERS; nobody verified the
    // ones it REFUSES. Checked at last against two files the router never
    // reads, FIVE of the fourteen refusals over 300 pairs were false — and
    // false on the app's own graph, with the app's own anchors, so this is
    // not a data complaint.
    //
    // The mechanism is that a door gets at most three precomputed anchors,
    // and at Gearing Hall BOTH doors' clean anchors sit on a stub whose only
    // way out is the flight of steps. Priced at Infinity under this profile,
    // that stub is an island; the router correctly finds nothing and then
    // says something much stronger than "nothing from here". The step-free
    // network runs 13 m away.
    //
    // So: one more pass, and ONLY when the first two have failed, in which a
    // door may leave the network at any graph node within this radius whose
    // straight leg is clean of stairs — not only at its baked anchors. False
    // restores round 4 exactly, and is the A/B every number in §R28 is from.
    stairAltWide: true,
    // THE DANGER THIS PAIR OF NUMBERS EXISTS TO BOUND. A door leg is a
    // straight line THIS FILE draws itself, and this file has no building
    // footprints — they are a 1.4 MB snapshot the client never loads. So a
    // widened anchor can put the last stretch straight through a wall, and
    // the first cut of this pass did exactly that on three of the five walks
    // it recovered (13.8 m of the Pharmacy Building on FNT>GEA). Routing
    // through buildings is ruled out, so both numbers below are chosen off a
    // measurement against those footprints, made offline over all 300 pairs.
    //
    // WORST ADDED DOOR LEG INSIDE A FOOTPRINT, and (+n) refusals answered:
    //
    //     radius \ cap        4            8           24
    //       13 m         0.00 (+0)    0.00 (+0)    0.00 (+0)
    //       20 m         0.00 (+5)    0.00 (+5)    0.00 (+5)   <-- SHIPPED
    //       24 m         0.00 (+5)    0.00 (+5)    0.00 (+5)
    //       28 m         0.00 (+5)  * 9.42 (+5)  * 9.42 (+5)
    //       30 m         0.00 (+5)  *13.81 (+5)  *13.81 (+5)
    //       40 m         0.00 (+5)  *13.81 (+5)  *24.70 (+14)
    //
    // Read it before changing either. THE CAP IS THE BINDING CONSTRAINT, not
    // the radius: candidates are taken nearest-first, and every through-wall
    // anchor on this campus is a FAR one, so a small cap excludes them at any
    // radius. (The first version of this comment credited the radius alone,
    // because that sweep was run with the cap still at its first-cut 24.)
    //
    // The shipped pair is clean with margin in both directions — the radius
    // could double to 40 m and the cap could reach 24 at 24 m, either way
    // still 0.00. Below 13.5 m the fix stops working at all.
    //
    // NOTE the bottom-right cell. At 40 m and cap 24 the pass "answers" all
    // 14 refusals — by walking someone 24.7 m through a building. A number
    // that looks like a complete fix is what a wrong constant looks like here.
    //
    // This plateau is a property of THIS graph and THIS footprint snapshot,
    // and nothing at runtime can notice it moving. Re-run the matrix
    // (docs/walk-stairs.md §R31) after any re-bake.
    stairAltWideRadiusM: 20,
    // ...and how many widened anchors one door may contribute, nearest first.
    // Besides bounding the wall risk above, this is the whole COST of the
    // pass — every candidate is stair-tested and every kept one is a Dijkstra
    // seed — and it buys nothing above a very small number. Swept over 300
    // pairs at 2/3/4/6/8/12/24: 125 offered and 9 refused at EVERY setting,
    // so the nearest TWO clean anchors per door already carry all five
    // recovered walks. Shipped at double the measured need. The cost was
    // real: WAG>GEA measured p50 247 ms at 24 and 86 ms at 8.
    stairAltWideMax: 4,

    // ── ROUND 6. AND THEN THE DOOR ITSELF ────────────────────────────────
    // Rounds 1-5 verified the PATH: no stepped edge, no door leg lying on a
    // drawn flight, and a real way round where the app used to refuse. All
    // five checks stop at the threshold. Nobody ever asked whether the door
    // the walk ARRIVES AT is a door a wheelchair can get through.
    //
    // UT publishes the answer per entrance, and it is not a guess: field
    // `BarrierFree` in `Celebrated_Entrances_view`, with a prose Description
    // that names the barrier. Gearing Hall's celebrated entrance reads
    // "Access is off 24th Street UP THE STAIRS and through the courtyard",
    // and our door 386 sits 1.2 m from it. Measured over the same 300 pairs:
    // 20 of the 38 step-free endpoints at a building UT surveyed a
    // barrier-free door for went to a DIFFERENT door — up to 63 m away.
    //
    // False restores round 5 exactly, and is the A/B every §R38 number is
    // from. The pass runs only under the step-free profile, only after a
    // clean answer already exists, and only at an end where UT names a door
    // we are not already using.
    stairBarrierFree: true,
    // HOW FAR OUT OF THE WAY A DOOR YOU CAN ACTUALLY GET THROUGH IS WORTH.
    // This is the taste knob and it is the whole argument of the feature:
    // for the person the toggle exists for, a door with steps is not a
    // slightly worse door, it is a wall. docs/walk-baseline.md measured that
    // forcing UT's door on EVERYBODY makes 9 of 19 ordinary trips longer —
    // which is why this is a slack, not a rule, and why it is confined to
    // the step-free profile where the other door is not an option at all.
    //
    // Swept over 300 pairs (docs/walk-stairs.md §R38): endpoints moved onto
    // UT's barrier-free door, and the total metres that cost.
    stairBarrierFreeSlackM: 150,
    // How close a UT survey point must be to one of our doors before the two
    // are the same physical door, and how much nearer than the closest row
    // of the OPPOSITE verdict. Read off a sweep, not guessed: the two doors
    // this convicts (GEA 386, PAR 512) are the same two at 5, 8, 12 and
    // 20 m. A building whose accessible and inaccessible entrances are both
    // near one of our doors gets NO label rather than a coin toss.
    stairBarrierFreeMatchM: 8,
    stairBarrierFreeMarginX: 2,

    // ── ROUND 8a. THE OTHER HALF OF THE SAME TABLE ───────────────────────
    // Round 6 used the rows UT publishes as `BarrierFree = Y` and moved 29
    // of 38 step-free endpoints onto them. The rows it had in the same array
    // marked `N` — whose own field notes name the barrier, "Access is off
    // 24th Street UP THE STAIRS" — were used ONLY as the margin test for the
    // positive verdict. Nothing has ever declined one, moved off one, or
    // said a word about one.
    //
    // Two of our doors carry that verdict (GEA 386, PAR 512), and neither
    // building has a barrier-free door of ours for round 6's pass to move
    // to, so round 6 never fires there. Measured over the same 300 pairs: 2
    // step-free offers of 123 START at PAR 512 and are handed over with a
    // clean tick and no sentence.
    //
    // This pass does the one thing the router can honestly do about it —
    // leave by a door UT has NOT convicted, if the building has one — and
    // where it does not, marks the answer so the card can say so instead of
    // promising silently. False restores round 7 exactly.
    stairBarrierDoor: true,
    // A door UT convicts is a wall for the person this profile exists for,
    // so this is deliberately the same slack round 6 spends to REACH a good
    // door. Same trade, opposite sign; keep the two together.
    stairBarrierDoorSlackM: 150,

    // ── ROUND 8b. AND THE WALK ITSELF WAS LONGER THAN IT HAD TO BE ───────
    // Round 5's widened anchors are gated to last resort: they fire only
    // when the first two passes cannot produce a clean walk at all. That was
    // the safe way to land them and it left the obvious question unasked —
    // when the ordinary passes DO succeed, is the walk they found the
    // SHORTEST step-free walk to the same two doors, or just the shortest
    // one reachable from at most three baked anchors?
    //
    // It is the second — and the answer to the question is that it barely
    // matters, which is the round's result and not an excuse for not
    // shipping. The pass is built, it works, and it is OFF, because the
    // measurement says it should be. Over the same 300 pairs, letting a
    // widened anchor shorten the walk by ANY amount at all:
    //
    //     shortened  55 of 123 walks     292 m of 130,596  (0.22 %)
    //     median 3 m, and exactly ONE walk gains more than 25 m (63 m)
    //     offers 123 and refusals 9 at EVERY margin, unbounded included
    //
    //   ...for +246 computeRoute calls over 300 pairs (+31.9 %), and +2.5 ms
    //   on a control pair whose answer is byte-identical both ways, so that
    //   is real cost and not the neighbours. There is no cheap precondition
    //   to gate it on either: only 1 of the 3 walks that gain more than 15 m
    //   has an anchor `cleanAnchors()` refused, so "only look where a door
    //   lost an anchor" predicts nothing.
    //
    // A third of the Dijkstras for 0.08 % of the metres is a bad trade, and
    // the honest report is that `scripts/bake_walk.py`'s three anchors per
    // door were already right. TRUE turns it on; §R56 has the whole curve.
    stairAltShortcut: false,
    // HOW MUCH SHORTER IS WORTH MOVING SOMEBODY'S WALK, when it is on. Taste
    // (rule 9), so it is one line (rule 11). Read off §R56's curve: below
    // 5 m the pass is moving people for noise.
    stairAltShortcutMinM: 15,

    // ── ROUND 8c. AND THE CLOCK WAS STILL BILLING A DESCENT AS A CLIMB ───
    // Round 7 taught the ROUTER which way a flight goes and wrote the
    // matching patch for the arithmetic out in §R50 instead of making it.
    // `timeRange()` charged EVERY stair metre at `stairUpMult`, including
    // flights the very same card was printing "down the steps" beside.
    // The worst case is the fair thing to assume about a flight nobody has
    // tagged. It is not the fair thing to assume about one OSM has.
    //
    // False restores round 7's clock exactly and is the A/B §R57 is quoted
    // against. Untagged metres are unaffected either way — silence still
    // costs the worst case, because silence is not a downhill.
    stairDownDiscount: true,

    stairListMax: 12,      // most staircases we will name in one leg list. A
                           // route with more than this is not a leg list, it
                           // is a wall of text; the count above it is still
                           // exact.

    // ── plumbing ──────────────────────────────────────────────────────────
    graphUrl: 'data/walk_graph.json',
    registerUrl: 'data/ut_buildings.json',  // UT's own 198-code register; the
                           // codes the graph lacks still deserve an answer

    // ── THE CODES THE REGISTER FILE ITSELF MISSES ─────────────────────────
    // Two switches, one each for the two tables below §4b. Both default on;
    // either one off restores the behaviour this file had before 2026-08-24,
    // which was to answer `notfound` — the same word a typo gets.
    campusExtraCodes: true,  // a code UT surveys and files as main campus that
                           // `registerUrl`'s snapshot does not list. SSW.
    offMapCodes: true,     // a code UT surveys at a campus this app does not
                           // draw. The ten at Pickle, 11 km north.
    // ROUND 3 — materialise doorSet()'s rule-4 door AT INDEX TIME for the two
    // buildings that route only through it, so the search list can offer them
    // instead of greying them out. Measured before it was believed: §4c and
    // docs/si-gaps.md §6. Off restores the round-2 behaviour exactly.
    utDoorsIndexed: true,
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
    // 5b — was "every staircase OpenStreetMap has mapped on campus", which is
    // 189 and sat one line above "Avoids 168 mapped staircases". 21 of the 189
    // are on stranded islands the router never enters in either state, so what
    // the filter actually does is refuse every staircase it could have reached.
    avoidBlurb: 'Routes around every mapped staircase it can reach.',
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

    // ── AFTER DARK (docs/walk-lit.md) ─────────────────────────────────────
    //
    // A COUNT OF MAPPED LAMPS IS NOT A SAFETY RATING, and these strings are
    // written so that cannot be misread. §12 above bans "accessible route" on
    // a field with 1.4 % coverage; mapped street lighting covers 9.2 % of this
    // network's metres, so "well lit", "safe", "safest route", "avoids the
    // dark bits" and a shield icon are banned by exactly the same argument and
    // for a stronger reason — being wrong about a staircase costs a detour,
    // being wrong about safety costs something we are not entitled to gamble.
    //
    // So every sentence here is about the MAP, never about the street:
    // "mapped", "none mapped", "OpenStreetMap has". The one place we describe
    // the world is to say the map UNDERSTATES it, which is the direction that
    // cannot hurt anyone.
    litHeading: 'Street lighting',
    litLamps: (n) => n + (n === 1 ? ' mapped streetlight' : ' mapped streetlights') +
      ' along this route',
    litNone: 'No mapped streetlight along this route',
    litGap: (d) => 'Longest stretch with none mapped: ' + d,
    litSource: (n, when) => 'OpenStreetMap has ' + n + ' streetlights mapped in this area' +
      (when ? ', from ' + when : '') + '. Real lighting is denser than that, and a mapped ' +
      'lamp can be out. This is not a safety rating.',
    litPhones: (n) => n + (n === 1 ? ' emergency phone' : ' emergency phones') + ' near this route',
    litPhonesNone: 'No emergency phone mapped near this route',
    // THE CANOPY LINE. It survives the §5 test — "under a tree" is a statement
    // about the same map and the same scene as the lamp count, checkable by
    // flying there and looking up, and it is the direction that cannot hurt
    // anyone: it can only make a counted lamp sound like LESS light, never
    // more. Banned alongside the rest: "these lamps are blocked", "the trees
    // make this dark", any present-tense claim about how much light reaches
    // the pavement, which nobody here has measured.
    litCanopy: (n, of) => (n === of ? (of === 1 ? 'It is' : 'All ' + of + ' are')
      : n + ' of them ' + (n === 1 ? 'is' : 'are')) + ' under tree cover',
    // THE NEAR MISS, and it rides ON the zero-lamp sentence rather than under
    // it, so it costs no line at all. Measured before it was written
    // (shots/walk/lit/nearmiss.mjs, 60 seeded routes): 33 routes have no
    // counted lamp, and only 3 of those have any lamp in the 25-50 m ring,
    // median 1 and at most 2. So this fires on one route in twenty and says a
    // small number when it does — which is the whole reason it is affordable.
    // Still "mapped", still a statement about the index, and it can only ever
    // make an empty count sound like MORE light, never less.
    litNearMiss: (n, r) => ' · ' + n + (n === 1 ? ' more is' : ' more are') +
      ' mapped within ' + r + ' m of it',
    // The same claim, sized to sit on the end of the count instead of under it.
    // Identical fact, one line rather than two — "4 under tree cover" cannot be
    // read as anything "4 of them are under tree cover" could not.
    litCanopyShort: (n) => n + ' under tree cover',
    // ── the strip ─────────────────────────────────────────────────────────
    // Spoken form of the picture, because a picture that only exists as pixels
    // is unreadable to a screen reader and unassertable by a test. Both read
    // this string; it is the strip's own description of itself.
    litStripAria: (pct, gapTxt, ticks) => 'Lighting along the walk, start on the ' +
      'left: ' + pct + '% of it has a mapped streetlight within 25 metres' +
      (gapTxt ? ', longest stretch with none mapped ' + gapTxt : '') +
      (ticks ? ', ' + ticks + ' spot' + (ticks === 1 ? '' : 's') + ' reported too dark' : '') + '.',
    litStripFrom: 'start',
    litStripTo: 'door',
    // ── the fold ──────────────────────────────────────────────────────────
    // The label is doing real work, not naming a drawer. It carries the two
    // disclaimers that must never be behind a tap — the count is of the MAP,
    // and this is not a safety rating — so that folding the three source
    // paragraphs hides sourcing, never the warning.
    litFold: 'Mapped lamps only, and not a safety rating — where these numbers come from',
    // The scene paints soft pools along roads at night that have no pole under
    // them and no survey behind them. A 43-site audit found decoration as
    // bright as a real lamp inside the 25 m disc at 5 of 24 places this card
    // calls unmapped — so a user who flies down to check is, one time in five,
    // looking at light the count does not include and being right to wonder.
    // One line, at the bottom with the other provenance, is the cheapest
    // honest answer available to a lane that does not own js/night.js.
    litDecor: 'The soft glow along roads after dark is scenery, not mapped ' +
      'light. Every counted lamp has a ring drawn at its foot.',
    // The offer. The price is printed BEFORE the button, never after it.
    litAltOffer: (extra, pct, was, now) => 'A way with more mapped light: ' + extra +
      ' further (' + pct + '%), ' + now + ' streetlights instead of ' + was,
    // ...and sometimes the price is nothing. Measured over 120 random pairs:
    // where an alternative exists at all it is a median 2 % longer, and one in
    // eight of them is not longer at all — the shortest-COST route is not the
    // shortest-METRES route once crossings and staircases are priced in. A
    // sentence that says "-67 m further" is a sentence nobody can read.
    litAltOfferFree: (was, now) => 'A way with more mapped light, no further: ' +
      now + ' streetlights instead of ' + was,
    litAltTake: 'Take the lit way',
    litAltOn: 'Showing the way with more mapped light',
    litAltOff: 'Back to the shortest way',
    litAltNone: 'No way with more mapped light within the extra distance we allow',
    // ...and once the search is also steering away from reported-dark spots,
    // "no way with more mapped light" no longer describes what it looked for.
    // A sentence that names only half the search is a sentence that will be
    // read as the whole search.
    litAltNoneEither: 'No way with more mapped light, or past fewer reported-dark ' +
      'spots, within the extra distance we allow',

    // ── the reported-dark sentences ───────────────────────────────────────
    //
    // THE RULE THEY ALL OBEY: name the reporter and the year, every time. This
    // data licenses a sentence the lamp data never could — someone stood on
    // that pavement and said it was too dark — and it licenses it only while
    // it is attributed. "3 dark spots on this route" would be us claiming to
    // know the street is dark today, off a file that stopped taking pins in
    // January 2018. "3 spots residents reported too dark in 2017" is the same
    // information and it is true.
    //
    // BANNED HERE FOR THE SAME REASON §5 of docs/walk-lit.md bans them on the
    // lamp side, and one more besides: `Dangerous` · `Unsafe` · `Avoid this
    // street` · `3 dark spots` · any sentence in the present tense about the
    // street rather than about the report. A 2017 pin is evidence about 2017.
    darkSpots: (n) => n + (n === 1 ? ' spot on this route was' : ' spots on this route were') +
      ' reported too dark',
    darkNoneOnRoute: 'No spot on this route was reported too dark',
    darkQuote: (q) => '“' + q + '”',
    // The SURVEY's years, not the file's last-edited date. Pins came in from
    // September 2017 to January 2018 and nothing records which pin came when,
    // so a single year under a specific person's sentence would be a fact we
    // do not have. The range is one we do.
    darkQuoteWho: () => '— a resident, City of Austin lighting survey, 2017–18',
    darkSource: (n, when) => 'The City of Austin asked West Campus where lighting ' +
      'was needed and ' + n + ' pins came back in this area, the last on ' + when +
      '. Lights may have been added since — that is what the survey was for.',
    // Outside the surveyed area there is nothing to say, and saying nothing is
    // the honest thing. This line exists so the ABSENCE of reports is never
    // read as an all-clear on a route nobody was ever asked about. "Area" and
    // not "West Campus": the study polygon the city drew reaches east over
    // Guadalupe onto the campus blocks, and pins landed there.
    darkOutside: 'Nobody was asked about lighting along this route',
    darkAltOffer: (extra, pct, was, now) => 'A way past fewer reported-dark spots: ' +
      extra + ' further (' + pct + '%), ' + now + ' instead of ' + was,
    darkAltOfferFree: (was, now) => 'A way past fewer reported-dark spots, no further: ' +
      now + ' instead of ' + was,
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

  // ── A DOOR LINK IS NOT PAVEMENT, SO IT MUST NOT COST WHAT PAVEMENT COSTS ──
  //
  // The bake gives every door up to three anchors — the three nearest points on
  // the network, up to DOOR_LINK_MAX_M = 30 m away — and the router was free to
  // pick whichever gave the cheapest total. It costed the link at one metre per
  // metre, exactly like a surveyed footway, so a 27 m straight line across a
  // lawn was a legal shortcut whenever it saved 27 m of real walking. It did
  // that a lot: measured over twenty class-to-class pairs, the router spent
  // 485 m of invented straight line and 278 m of that lay on grass or on
  // nothing at all. Burdine's front door has an anchor 2.3 m away and another
  // 27.6 m away; the router was taking the 27.6 m one.
  //
  // A link is not a path. Nobody surveyed it, we draw it dashed precisely
  // because we are not claiming it is walkable, and it may cross a flowerbed,
  // a hedge or the corner of another building. So charge it more than pavement
  // and the router will only ever spend one when there is no pavement instead.
  //
  // 4.0 is the knee of the measured curve (docs/walk-sidewalks.md): it removes
  // 55 % of the off-pavement metres for 2.7 % more route. Going higher keeps
  // buying, but at 4.5 m of extra walking per metre of lawn saved — at the
  // limit ("always take the nearest anchor") routes are 14 % longer, which is
  // a worse answer to the question the student actually asked.
  //
  // TASTE VALUE, CLAUDE.md rule 11. Raise it to keep the ribbon on pavement at
  // the cost of longer routes; set it to 1 to restore the old behaviour.
  const LINK_COST_MULT = 4.0;
  /** Routing cost of an anchor. `.c` stays TRUE METRES so every printed
   *  distance and every drawn door leg is unchanged; `.pc` is what Dijkstra
   *  spends. Anchors without a `.pc` (the via stop) cost their plain metres. */
  function linkCost(a) {
    return a.pc != null ? a.pc : a.c;
  }

  // ROUND 7 — what a climb costs, resolved once per call and never below 1.
  //
  // The clamp is the whole safety argument of this pass, not decoration: at
  // >= 1 no edge in this graph can ever get CHEAPER than it was in round 6, so
  // the router can only ever move a route OFF a climb and can never put a
  // staircase on a route that did not already have one. A bad override cannot
  // turn that around; it can only turn the pass off.
  function stairClimbMult() {
    const v = WAYFIND.stairClimbCostMult;
    const m = Number(v == null ? WAYFIND.stairUpMult : v);
    return isFinite(m) && m > 1 ? m : 1;
  }

  // Is traversing edge `i` FROM node `from` a climb? `F_UP_AB` is the only
  // thing the file asserts about direction and it means "the stored a->b order
  // of this edge is uphill". Stored order is ascending node index (the bake
  // sorts the key), so it says nothing on its own — it only becomes `up` or
  // `down` once you know which end you are walking from, which is exactly what
  // stairLegs() already does to print "up the steps".
  //
  // AN EDGE WITHOUT THE BIT IS UNTAGGED, NOT DOWNHILL. `scripts/bake_walk.py`
  // CLEARS the bit for a reverse-stored edge instead of inverting it, and drops
  // `incline=down` on the floor (docs/walk-stairs.md §5a), so 109 of 189 mapped
  // flights arrive here with nothing said about them and 46 m more inside ways
  // that ARE tagged. Those cost exactly what they cost in round 6. Guessing a
  // direction for them would be inventing data.
  //
  // `ex.down` is the down list §5a proposes and the bake does not emit yet. It
  // is read from the same place stairLegs() reads it, so the sentence on the
  // card and the price in the router turn on together the day it lands.
  //
  // STEPS ONLY, on purpose. 17 edges in this graph carry the incline bit
  // WITHOUT being steps — 16 of them `wheelchair=yes`, i.e. ramps, 120 m in
  // total — and an uphill ramp is genuinely harder. But the flat-walk cost
  // model has no gradient term at all, and inventing one for 6 ways out of
  // 3,430 would be a constant with almost nothing under it (§R42). The guard
  // is here rather than at the call site so a later caller cannot re-open it
  // by accident.
  function isClimb(g, i, from) {
    if (from == null) return false;         // caller supplied no direction
    if (!(g.F[i] & F_STEPS)) return false;
    const ab = from === g.A[i];
    if (g.F[i] & F_UP_AB) return ab;
    const ex = stairExtras(g);
    return ex.down.size ? (ex.down.has(i) ? !ab : false) : false;
  }

  // ROUND 8 — the same test with the sense inverted, and the SAME rule about
  // silence: an edge nobody has tagged is not downhill, so it is in neither
  // bucket and is billed the worst case, which is the fair thing to assume
  // about a flight nobody has surveyed. It is not the fair thing to assume
  // about one this very card has just called "down the steps". §R57.
  function isDescent(g, i, from) {
    if (from == null) return false;
    if (!(g.F[i] & F_STEPS)) return false;
    const ab = from === g.A[i];
    if (g.F[i] & F_UP_AB) return !ab;
    const ex = stairExtras(g);
    return ex.down.size ? (ex.down.has(i) ? ab : false) : false;
  }

  // Edge cost in "equivalent flat metres". Stairs cost what they cost because a
  // staircase is slow, not because of any claim about a hill — except where OSM
  // does say which way the hill goes, and then a climb costs more than the same
  // flight downhill. `from` is the node the walk arrives from; without it the
  // cost is the round-6 symmetric one.
  function edgeCost(g, i, avoidStairs, from) {
    const m = g.W[i] / 100;
    if (g.F[i] & F_STEPS) {
      // 5b — `STAIRS.breakStepFree` makes this filter leaky ON PURPOSE, so the
      // assertion in stepFreeRoute() can be watched coming back red. Shipped
      // false; a step-free route is step-free by construction, not by hope.
      if (avoidStairs && !STAIRS.breakStepFree) return Infinity;
      const n = g.swEdges.get(g.S[i]) || 1;
      // Only the TRAVEL term is multiplied. `stairFixedS` is the cost of
      // spotting the flight and turning onto it, and that is the same job
      // whichever way you then go.
      const climb = isClimb(g, i, from) ? stairClimbMult() : 1;
      return m * (WAYFIND.speedLow / WAYFIND.stairSpeed) * climb +
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
      if (!p || linkCost(t) < linkCost(p)) tmap.set(t.node, t);
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
      const sc = linkCost(s);
      if (sc < dist[s.node]) { dist[s.node] = sc; seedOf[s.node] = k; push(s.node, sc); }
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
        const tot = d + linkCost(t);
        if (!best || tot < best.cost) best = { cost: tot, node: u, target: t };
        tmap.delete(u);
        left--;
        if (!left) break;
      }
      for (let k = g.off[u]; k < g.off[u + 1]; k++) {
        const e = g.eix[k];
        if (g.F[e] & F_OFFMAIN) continue;      // never route on a stranded island
        // ROUND 7 — `u` is the node the walk arrives from, so edgeCost() can
        // tell a climb from a descent. Every seed here is a FROM door and every
        // target a TO door (legBetween(), and both halves of the via route), so
        // this search always runs in walking order. One argument; the rest of
        // this function is acer/w-door's this round and is untouched.
        const c = edgeCost(g, e, avoidStairs, u);
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
    let flat = 0, stair = 0, stairDown = 0, signals = 0;
    const sets = new Set();
    for (let i = 0; i < leg.edges.length; i++) {
      const e = leg.edges[i];
      const m = g.W[e] / 100;
      if (g.F[e] & F_STEPS) {
        stair += m; sets.add(g.S[e]);
        // ROUND 8 (§R57) — `leg.nodes[i]` is the node this edge is entered
        // from, exactly as stairLegs() uses it to print "down the steps". The
        // walk this measures is the walk the card describes, so the two can
        // no longer disagree about which way it goes.
        if (leg.nodes && isDescent(g, e, leg.nodes[i])) stairDown += m;
      } else flat += m;
      if (g.F[e] & F_SIGNAL) signals++;
    }
    return { flat, stair, stairDown, signals, stairSets: sets.size };
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
    // ROUND 8 (§R57). The high end is a worst case, and a worst case is a fair
    // thing to assume about a flight nobody has tagged. It is not a fair thing
    // to assume about one this very card has just called "down the steps".
    // Round 7 made the ROUTER know which way a flight goes and left the clock
    // billing every metre of every flight as a climb. Only metres OSM says are
    // downhill are taken out; silence still costs the worst case.
    const down = WAYFIND.stairDownDiscount ? (m.stairDown || 0) : 0;
    const highS = m.flat / WAYFIND.speedLow +
      (down + (m.stair - down) * WAYFIND.stairUpMult) / WAYFIND.stairSpeed +
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
  // 3b. THE STAIRS, AND THE WAY ROUND THEM      (docs/walk-stairs.md)
  //
  // ── THE 179 AND THE 189 ARE THE SAME STAIRCASES ──────────────────────────
  // `data/ground.geojson` draws 179 features tagged `steps` and this graph
  // prices 189 `highway=steps` ways. That is not a disagreement and neither
  // number is wrong: the ground bake buffers each stepped centreline and
  // UNIONS them per surface, so flights that touch merge into one drawn
  // polygon. Checked by identity rather than by eye — every one of the 189
  // way ids in `data/osm_cache/footways.json` appears in this file's `e.s`,
  // and after this round every one of them is also drawn and carries its own
  // `wid` on the slab. (One, way 147362093, was tagged `area=yes` and was
  // being skipped by the ground bake entirely: the router would send you up a
  // staircase the city did not draw. Fixed in `scripts/bake_ground.py`.)
  //
  // ── A ROUTE IS EDGES *PLUS TWO LINES WE DREW OURSELVES* ──────────────────
  // The last stretch from the walk network to a door is not a surveyed path,
  // it is a straight line, and it is drawn dashed for exactly that reason.
  // It can therefore run clean across a staircase. Measured over 396 routes:
  // 11 of the 140 step-free routes this feature offered did precisely that,
  // so "no stairs on this route" was false for the one person the toggle
  // exists for. Only four door anchors of 421 are responsible — on COM, CS3,
  // MAG and STD — but they sit on popular ends, so they poisoned 8 % of the
  // offers. `legCrossesStairs` is the test; `cleanAnchors` is the fix, and it
  // costs nothing in coverage: 140 offered before, 140 offered after, 11
  // dirty before, 0 after.
  //
  // ── WHAT WE MAY SAY ABOUT A STAIRCASE ────────────────────────────────────
  // Its way id, its plan length, how far along the walk it starts, and — for
  // the 39 ways of 189 that carry a usable `incline` — whether you are going
  // up or down it. NOT a step count: OSM has `step_count` on 9 ways of 189
  // and this graph does not carry it at all (the patch that would is written
  // out in docs/walk-stairs.md §5, and it is not this lane's file). NOT a
  // number of flights: nothing in OSM records a landing. So `dir` is 'up',
  // 'down' or '' and the empty string is honest.
  // ══════════════════════════════════════════════════════════════════════════

  // Built once per graph, on the first question anyone asks about stairs, and
  // memoised on the graph object. A route that never touches a staircase never
  // pays for this.
  function stairIndex(g) {
    if (g._stairIx) return g._stairIx;
    const CELL = WAYFIND.stairLegGridDeg;
    const seg = [], grid = new Map();
    for (let i = 0; i < g.E; i++) {
      if (!(g.F[i] & F_STEPS)) continue;
      const ax = g.X[g.A[i]], ay = g.Y[g.A[i]], bx = g.X[g.B[i]], by = g.Y[g.B[i]];
      const ix = seg.push({ ax, ay, bx, by, way: g.S[i] }) - 1;
      const x0 = Math.floor(Math.min(ax, bx) / CELL), x1 = Math.floor(Math.max(ax, bx) / CELL);
      const y0 = Math.floor(Math.min(ay, by) / CELL), y1 = Math.floor(Math.max(ay, by) / CELL);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cy = y0; cy <= y1; cy++) {
          const k = cx + ':' + cy;
          let a = grid.get(k); if (!a) { a = []; grid.set(k, a); }
          a.push(ix);
        }
      }
    }
    g._stairIx = { CELL, seg, grid };
    return g._stairIx;
  }

  // ROUND 4 — how much of segment AB lies within `r` metres of segment CD.
  //
  // THE CASE THE INTERSECTION TEST BELOW CANNOT SEE. Two parallel segments
  // never intersect, so a door leg drawn straight up a flight of steps — the
  // single worst thing this feature can do to somebody who cannot climb —
  // came back "no crossing" every time, and four of forty-eight offered
  // step-free routes did exactly that. A staircase is 3.0 m wide on the map
  // (`bake_ground.py` DEFAULT_WIDTH['steps']); measuring against that width
  // makes the router and the drawing agree by construction.
  //
  // Sampling rather than solving: the closed form for capsule-segment overlap
  // is fiddly and this runs at most a few hundred times per route, on a
  // button press. The step is a quarter of the tolerance, so the answer is
  // good to well under the metre the threshold is stated in.
  const LEG_SAMPLE_DIV = 6;   // samples per `r` of leg length
  function segmentOverlapM(ax, ay, bx, by, cx, cy, dx, dy, r) {
    const x1 = ax * MPD_LON, y1 = ay * MPD_LAT, x2 = bx * MPD_LON, y2 = by * MPD_LAT;
    const x3 = cx * MPD_LON, y3 = cy * MPD_LAT, x4 = dx * MPD_LON, y4 = dy * MPD_LAT;
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len === 0) return 0;
    const ex = x4 - x3, ey = y4 - y3, e2 = ex * ex + ey * ey;
    const n = Math.max(1, Math.ceil(len / (r / LEG_SAMPLE_DIV)));
    const step = len / n;
    let inside = 0;
    for (let i = 0; i <= n; i++) {
      const t = i / n, px = x1 + (x2 - x1) * t, py = y1 + (y2 - y1) * t;
      let u = e2 ? ((px - x3) * ex + (py - y3) * ey) / e2 : 0;
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      if (Math.hypot(px - (x3 + ex * u), py - (y3 + ey * u)) <= r) inside++;
    }
    return inside * step;
  }

  /**
   * Does the door leg a->b point along the stepped segment `s`, either way
   * round? Direction only — "along" and "against" are the same staircase.
   * `cos` is the cosine of the tolerance, precomputed by the caller.
   */
  function nearlyParallel(a, b, s, cos) {
    const ux = (b[0] - a[0]) * MPD_LON, uy = (b[1] - a[1]) * MPD_LAT;
    const vx = (s.bx - s.ax) * MPD_LON, vy = (s.by - s.ay) * MPD_LAT;
    const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
    if (lu === 0 || lv === 0) return false;
    return Math.abs((ux * vx + uy * vy) / (lu * lv)) >= cos;
  }

  // Proper segment-segment intersection in local metres. Endpoint contact is
  // NOT a crossing — a door leg that starts at the top of a staircase touches
  // it and does not walk down it.
  function segmentsCross(ax, ay, bx, by, cx, cy, dx, dy) {
    const x1 = ax * MPD_LON, y1 = ay * MPD_LAT, x2 = bx * MPD_LON, y2 = by * MPD_LAT;
    const x3 = cx * MPD_LON, y3 = cy * MPD_LAT, x4 = dx * MPD_LON, y4 = dy * MPD_LAT;
    const den = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
    if (Math.abs(den) < 1e-12) return false;          // parallel or degenerate
    const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / den;
    const u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / den;
    return t > 0.001 && t < 0.999 && u > 0.001 && u < 0.999;
  }

  /**
   * Steps-way ids a straight line from a to b walks over. `[]` is the good
   * case, and it is the case the whole "avoid stairs" promise rests on.
   *
   * ROUND 4 — TWO TESTS, EITHER OF WHICH CONVICTS.
   *   1. the centreline is genuinely crossed (rounds 1-3's test, unchanged);
   *   2. OR the leg runs ALONG the flight — within `stairLegParallelDeg` of
   *      its direction — for at least `stairLegOverlapMinM` inside
   *      `stairLegHalfWidthM` of the centreline. Test 1 is mathematically
   *      incapable of seeing this one: parallel segments never intersect.
   * The angle is not optional. Without it the test convicts every door leg
   * that merely LEAVES the top of a flight, because such a leg starts on the
   * staircase and diverges; the constants above carry the measurement.
   * Overlap is summed PER WAY, so a flight drawn as three short segments
   * convicts on the total rather than needing one segment to do it alone.
   */
  function legCrossesStairs(g, a, b) {
    const ix = stairIndex(g);
    if (!ix.seg.length) return [];
    const C = ix.CELL, R = WAYFIND.stairLegHalfWidthM;
    const COS = Math.cos(WAYFIND.stairLegParallelDeg * Math.PI / 180);
    // One cell of padding: a staircase whose centreline sits just outside the
    // leg's own bucket can still be within R metres of it.
    const x0 = Math.floor(Math.min(a[0], b[0]) / C) - 1, x1 = Math.floor(Math.max(a[0], b[0]) / C) + 1;
    const y0 = Math.floor(Math.min(a[1], b[1]) / C) - 1, y1 = Math.floor(Math.max(a[1], b[1]) / C) + 1;
    const seen = new Set(), hit = [], over = new Map();
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const arr = ix.grid.get(cx + ':' + cy);
        if (!arr) continue;
        for (let k = 0; k < arr.length; k++) {
          const i = arr[k];
          if (seen.has(i)) continue;
          seen.add(i);
          const s = ix.seg[i];
          if (segmentsCross(a[0], a[1], b[0], b[1], s.ax, s.ay, s.bx, s.by)) {
            if (hit.indexOf(s.way) < 0) hit.push(s.way);
            continue;
          }
          if (!nearlyParallel(a, b, s, COS)) continue;
          const m = segmentOverlapM(a[0], a[1], b[0], b[1], s.ax, s.ay, s.bx, s.by, R);
          if (m > 0) over.set(s.way, (over.get(s.way) || 0) + m);
        }
      }
    }
    for (const [way, m] of over) {
      if (m >= WAYFIND.stairLegOverlapMinM && hit.indexOf(way) < 0) hit.push(way);
    }
    return hit;
  }

  /**
   * The leg list, in walk order — one entry per STAIRCASE, never per step and
   * never per drawn segment, because a staircase drawn in fourteen pieces is
   * still one staircase you climb once. This is the shape Citymapper states a
   * flight in: where it is along the walk, how long it is, which way it goes.
   */
  // TWO FIELDS THE GRAPH DOES NOT CARRY YET, READ HERE THE MOMENT IT DOES.
  //
  //   e.dn   edge indices whose stored a->b direction is DOWN. Flag bit 8 only
  //          ever means "up", so `incline=down` — 36 of the 80 tagged
  //          staircases on campus — currently arrives as no direction at all.
  //   sc     way id -> OSM `step_count`, on 9 of 189 ways. Without it we may
  //          not print a number of steps, and we do not.
  //
  // Both are one small patch to scripts/bake_walk.py, written out verbatim in
  // docs/walk-stairs.md §5. That file belongs to another lane, so this side is
  // built to accept them and reports '' / null until it gets them, which is
  // exactly what it should say today.
  function stairExtras(g) {
    if (g._stairExtra) return g._stairExtra;
    const down = new Set();
    const raw = g.raw && g.raw.e;
    if (raw && Array.isArray(raw.dn)) {
      let acc = 0;
      for (let i = 0; i < raw.dn.length; i++) { acc += raw.dn[i]; down.add(acc); }
    }
    const count = (g.raw && g.raw.sc) || null;
    g._stairExtra = { down: down, count: count };
    return g._stairExtra;
  }

  function stairLegs(g, legs, startAtM) {
    const ex = stairExtras(g);
    const out = [];
    let at = startAtM || 0;
    let cur = null;
    for (const leg of legs) {
      for (let i = 0; i < leg.edges.length; i++) {
        const e = leg.edges[i];
        const m = g.W[e] / 100;
        if (g.F[e] & F_STEPS) {
          // direction of travel over THIS edge, so `up` means up for you
          const ab = leg.nodes[i] === g.A[e];
          let dir = '';
          if (g.F[e] & F_UP_AB) dir = ab ? 'up' : 'down';
          else if (ex.down.has(e)) dir = ab ? 'down' : 'up';
          if (cur && cur.way === g.S[e]) {
            cur.m += m;
            if (!cur.dir) cur.dir = dir;
          } else {
            const sc = ex.count ? ex.count[g.S[e]] : null;
            cur = { way: g.S[e], atM: at, m: m, dir: dir, steps: sc == null ? null : sc,
              // ROUND 2 — where the flight IS, in words. "620 m in" alone makes
              // a reader count; "620 m in · near WEL" is a place. The nearest
              // register code within STAIRS.nearBuildingM; 215 of 216 flights
              // in a 300-route census got one.
              at0: lonlat(g, leg.nodes[i]), code: null };
            out.push(cur);
          }
        } else {
          cur = null;
        }
        at += m;
      }
    }
    // A staircase re-entered later in the same walk is two entries above and
    // one staircase in the count; the count is the set, the list is the walk.
    for (const s of out) {
      s.atM = Math.round(s.atM); s.m = Math.round(s.m * 10) / 10;
      s.code = nearestCode(g, s.at0); delete s.at0;
    }
    return out;
  }

  /**
   * ROUND 3 — THE ROWS, which are not the flights.
   *
   * `stairLegs` stays exact: one entry per mapped `highway=steps` way, in walk
   * order, and `sets`/`ways` are still counted off it, so nothing about how
   * many staircases we report changes here. This is the DISPLAY grouping —
   * consecutive flights at the same named building, starting within
   * STAIRS.mergeGapM of one another, are one thing you do and get one row.
   *
   * A merged row keeps every way id it swallowed, so a test can still join a
   * row back to the ground. `dir` survives only when every flight in the row
   * agrees; three flights where one is tagged `up` and two are untagged is not
   * an "up", and saying so would be the exact failure this file forbids.
   */
  function stairRows(list) {
    const out = [];
    for (const s of list) {
      const p = out.length ? out[out.length - 1] : null;
      const near = p && p.code && s.code === p.code &&
        (s.atM - (p.atM + p.m)) <= STAIRS.mergeGapM;
      if (near) {
        p.ways.push(s.way);
        p.m = Math.round((p.m + s.m) * 10) / 10;
        p.flights++;
        if (p.dir !== s.dir) p.dir = '';
      } else {
        out.push({ way: s.way, ways: [s.way], atM: s.atM, m: s.m, dir: s.dir,
          code: s.code, flights: 1 });
      }
    }
    return out;
  }

  /**
   * Everything true about stairs on one finished route, including the part
   * that is not in the graph: the two lines we drew ourselves.
   *   sets      distinct staircases the ROUTED path climbs
   *   list      those staircases in walk order (capped for display)
   *   legWays   staircases the unmapped door legs cross — not routed over,
   *             but walked over, and the reason `clean` can be false while
   *             `sets` is 0
   *   clean     true only when BOTH are empty. This is the whole test behind
   *             offering a step-free alternative at all.
   */
  function stairFacts(g, legs, geom, fromDoor, toDoor, startAtM) {
    const list = stairLegs(g, legs, startAtM);
    const sets = [];
    for (const s of list) if (sets.indexOf(s.way) < 0) sets.push(s.way);
    const legWays = [];
    if (geom && geom.startLeg) {
      for (const w of legCrossesStairs(g, geom.startLeg[0], geom.startLeg[1]))
        if (legWays.indexOf(w) < 0) legWays.push(w);
    }
    if (geom && geom.endLeg) {
      for (const w of legCrossesStairs(g, geom.endLeg[0], geom.endLeg[1]))
        if (legWays.indexOf(w) < 0) legWays.push(w);
    }
    // ROUND 3 — the rows are grouped from the WHOLE list and capped after, so
    // the cap counts rows a person sees rather than ways the graph holds.
    const allRows = stairRows(list);
    const rows = allRows.slice(0, WAYFIND.stairListMax);
    return {
      sets: sets.length, ways: sets,
      list: list.slice(0, WAYFIND.stairListMax), listTruncated: list.length > WAYFIND.stairListMax,
      rows: rows, rowCount: allRows.length,
      legWays: legWays, legWayCount: legWays.length,
      clean: sets.length === 0 && legWays.length === 0,
    };
  }

  // ROUND 5 — set ONLY by stepFreeRoute()'s third pass and cleared in a
  // `finally`. computeRoute() reaches cleanAnchors() through a closure it
  // builds itself, and computeRoute belongs to the door lane this round, so
  // the third pass is signalled here rather than by threading a new option
  // through a function another branch is rewriting. Never true outside one
  // synchronous call.
  let stairWidePass = false;

  /**
   * Door anchors a step-free walk may actually use. Same shape as `anchors()`,
   * minus every anchor whose straight last-stretch line crosses a staircase.
   * If that empties a building — it never does today, but a data refresh could
   * — the dropped ones come back rather than the building becoming unroutable,
   * and `dropped` says so so the answer can be honest about it.
   */
  function cleanAnchors(g, doors, role) {
    const kept = [], dropped = [];
    for (const di of doors) {
      const d = g.doors[di];
      const dll = doorLL(g, di);
      for (let k = 0; k < d[2].length; k++) {
        const rec = { node: d[2][k], c: d[3][k] / 100, door: di, role: role };
        if (WAYFIND.stairAltCleanDoors && legCrossesStairs(g, dll, lonlat(g, d[2][k])).length) {
          dropped.push(rec);
        } else {
          kept.push(rec);
        }
      }
    }
    // ROUND 5 — THE WIDENED PASS, and it is off unless stepFreeRoute() has
    // already failed twice. See WAYFIND.stairAltWide. Note the trigger is NOT
    // `kept.length === 0`: at Gearing Hall two anchors survive this function
    // perfectly well and are both stranded on a stub behind a flight of
    // steps, which only the Dijkstra can discover. So the signal has to come
    // from the caller, and it does.
    if (stairWidePass && WAYFIND.stairAltWide) {
      const seen = new Set();
      for (const a of kept) seen.add(a.door + ':' + a.node);
      for (const a of wideAnchors(g, doors, role)) {
        const k = a.door + ':' + a.node;
        if (seen.has(k)) continue;
        seen.add(k);
        kept.push(a);
      }
    }
    return kept.length ? { anchors: kept, dropped: dropped.length, forced: false }
                       : { anchors: dropped, dropped: 0, forced: dropped.length > 0 };
  }

  /**
   * ROUND 5 — every graph node a door could honestly leave the network at.
   *
   * The bake precomputes at most three anchors per door and they are the only
   * places the router has ever been able to start or finish a walk. That is
   * the right default — they are snapped against the building footprints,
   * which this file does not have — but when the step-free profile has
   * already failed twice it is the difference between "no way round" and a
   * walk that exists. Nearest first, capped, and every candidate held to the
   * same stair test as a baked anchor.
   *
   * `wide: true` rides along so the answer can be told apart from a normal
   * one; `stepFreeRoute()` reads it and `wayfindStairs()` reports it.
   */
  function nodeIndex(g) {
    if (g._nodeIx) return g._nodeIx;
    const CELL = WAYFIND.stairLegGridDeg;
    const grid = new Map();
    for (let i = 0; i < g.N; i++) {
      const k = Math.floor(g.X[i] / CELL) + ':' + Math.floor(g.Y[i] / CELL);
      let a = grid.get(k); if (!a) { a = []; grid.set(k, a); }
      a.push(i);
    }
    g._nodeIx = { CELL, grid };
    return g._nodeIx;
  }

  function wideAnchors(g, doors, role) {
    const ix = nodeIndex(g), C = ix.CELL, R = WAYFIND.stairAltWideRadiusM;
    const dLon = R / MPD_LON, dLat = R / MPD_LAT;
    const out = [];
    for (const di of doors) {
      const dll = doorLL(g, di);
      const cand = [];
      const x0 = Math.floor((dll[0] - dLon) / C), x1 = Math.floor((dll[0] + dLon) / C);
      const y0 = Math.floor((dll[1] - dLat) / C), y1 = Math.floor((dll[1] + dLat) / C);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cy = y0; cy <= y1; cy++) {
          const arr = ix.grid.get(cx + ':' + cy);
          if (!arr) continue;
          for (let i = 0; i < arr.length; i++) {
            const m = metresBetween(dll, lonlat(g, arr[i]));
            if (m <= R) cand.push({ node: arr[i], c: m, door: di, role: role, wide: true });
          }
        }
      }
      cand.sort((a, b) => a.c - b.c);
      let kept = 0;
      for (let i = 0; i < cand.length && kept < WAYFIND.stairAltWideMax; i++) {
        if (legCrossesStairs(g, dll, lonlat(g, cand[i].node)).length) continue;
        out.push(cand[i]); kept++;
      }
    }
    return out;
  }

  /**
   * THE ALTERNATE ROUTE. Same two buildings, no mapped staircase anywhere on
   * it — not on the path, and not on either straight line we drew ourselves.
   *
   * Returns null when there is no such walk, and null is a RESULT: 31 of 171
   * stair routes in a 396-route sample have no step-free way at all, and the
   * interface has to be able to say that instead of quietly offering nothing.
   * It never returns a route it could not verify: if the result still touches
   * stairs, `clean` is false and the caller must not call it step-free.
   *
   * ROUND 2 — IT IS NOW THE SAME ROUTE THE TOGGLE PRODUCES, BY CONSTRUCTION.
   * Round 1 built the alternative here with its own door and anchor handling
   * while `run()` built the toggle's answer through computeRoute, and the two
   * were only equal because they happened to make the same choices. The moment
   * round 2 let the alternative use side doors they diverged, and the card
   * offered "Step-free: 14-19 min · 1.2 km" on ART>MAI and then answered "No
   * route that avoids mapped stairs" when the button was pressed — caught by
   * looking at the screenshot, with every number in the census already green.
   * There is one implementation now: stepFreeRoute() in §5b, which computeRoute
   * also delegates to whenever `avoidStairs` arrives without an explicit
   * profile. This function decorates that answer with what it costs.
   *
   * The `via` stop is carried through, so a step-free route with a coffee stop
   * is still verified as step-free end to end (round 1 refused the combination
   * outright; the verification does not care, and refusing it silently dropped
   * the option for anyone who had picked a stop).
   */
  function stepFreeAlternative(g, from, to, base, opts) {
    const sfr = stepFreeRoute(g, from, to, opts || {});
    if (!sfr.ok) return null;
    const r = sfr.route;
    const st = r.stair;
    const extraM = base ? r.distM - base.distM : 0;
    return {
      ok: true, clean: st.clean, stair: st,
      legs: r.legs, geom: r.geom, m: r.m, time: r.time, distM: r.distM,
      fromDoor: r.fromDoor, toDoor: r.toDoor,
      fromLinkM: r.fromLinkM, toLinkM: r.toLinkM,
      extraM: extraM,
      extraMinLo: base ? r.time.lo - base.time.lo : 0,
      extraMinHi: base ? r.time.hi - base.time.hi : 0,
      far: extraM > WAYFIND.stairAltFarExtraM,
      sameWalk: base ? Math.abs(extraM) < 0.5 : false,
      doorChanged: base ? (r.toDoor !== base.toDoor || r.fromDoor !== base.fromDoor) : false,
      // ROUND 3 — WHICH entrance, not just "a different" one. Computed here
      // rather than in the card because it is a property of the alternate
      // route, and because `wayfindStairs()` hands it to the verify harness.
      toDoorChanged: base ? r.toDoor !== base.toDoor : false,
      fromDoorChanged: base ? r.fromDoor !== base.fromDoor : false,
      toDoorWhere: (base && r.toDoor !== base.toDoor) ? doorWhere(g, r.toDoor) : null,
      doorsRefused: r.doorsRefused || 0,
      doorsForced: !!r.doorsForced,
      // ROUND 5 — true when this walk only exists because a door was allowed
      // to leave the network somewhere the bake did not precompute. Nothing on
      // the card reads it yet; it is here because the card SHOULD eventually
      // say so, and because a route found this way is worth being able to tell
      // apart in a census. See docs/walk-stairs.md §R28.
      doorsWide: !!r.doorsWide,
      // ROUND 6 — how many ends of this walk were moved onto the entrance UT
      // publishes as barrier-free. 0 means either that no end had one or that
      // the walk was already using it. Nothing on the card reads it yet; the
      // card SHOULD eventually say "arrives at the barrier-free entrance UT
      // lists", and that sentence belongs in
      // docs/walk/what-we-can-honestly-say.md and another lane's function.
      doorsBF: r.doorsBF || 0,
      // ROUND 8a — the ends of this walk that sit on a door UT PUBLISHES as
      // not barrier-free, after §8a has already tried to leave by another
      // one. `null` on almost every walk, and when it is not null it is the
      // one thing on this object the card must not drop: it is UT saying the
      // entrance is up the stairs while we hand over a green tick. See
      // docs/walk-stairs.md §R55 for the sentence and where it goes.
      doorBarriered: r.doorBarriered || null,
      doorsOffBarriered: r.doorsOffBarriered || 0,
      // ...and the ends that sit on a door UT publishes AS barrier-free —
      // Citymapper's `Best Step-Free Entrance`, which §R17 could not say.
      // Reachable on 19 of the 22 doors UT surveyed (§R54).
      doorBarrierFree: r.doorBarrierFree || null,
      // ROUND 8b — metres this walk is shorter than the one the baked
      // anchors alone could reach, 0 when the pass changed nothing.
      shortcutM: r.shortcutM || 0,
      avoidStairs: true,
    };
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
    // THE TWO MERGES THE REGISTER MERGE ABOVE CANNOT DO, because the register
    // file does not contain these codes to merge (§4b). Both run AFTER it and
    // both skip anything already indexed, so neither can take a code away from
    // the register or from the graph — they can only fill a hole the register
    // left. Order matters only in that direction.
    if (WAYFIND.campusExtraCodes) {
      for (const row of CAMPUS_EXTRA) {
        if (byCode.has(row[0])) continue;
        // `reg: true` on purpose. This IS a register building — ours is the
        // register snapshot that is short a row — so it deserves the same
        // "findable, and honestly answered if it will not route" treatment,
        // and doorSet()'s rule 4 will in fact route it from UT's own door.
        const e = { kind: 'reg', reg: true, extra: true, code: row[0],
          name: norm(row[1]), number: row[2] || '', display: row[1], doors: [] };
        byCode.set(row[0], e);
        entries.push(e);
      }
    }
    if (WAYFIND.offMapCodes) {
      for (const r of offMapIndex().values()) {
        if (byCode.has(r.code)) continue;
        // NO `reg` FLAG, and that is the point of the whole table: a register
        // entry means "not walkable in this build YET", which is a promise.
        // This one is not walkable in any build, because it is not in this
        // city. The record rides along on the entry so anything that resolves
        // the code — the route card, the search list, a schedule import — has
        // the reason in hand without a second lookup.
        const e = { kind: 'offmap', offMap: r, code: r.code,
          name: norm(r.name), number: '', display: r.name, doors: [] };
        byCode.set(r.code, e);
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
      // ── `routable` IS NARROWER THAN THE ROUTER, AND SAYING SO COSTS NOTHING
      //
      // `e.routable` means "has a door OUR BAKE anchored". That was the whole
      // truth when it was written and stopped being it when doorSet() grew
      // rule 4 — walk to UT's own coordinate when we have no door of our own.
      // Since then two buildings have routed perfectly well while the search
      // list greyed their row out and refused to let anybody pick it.
      //
      // MEASURED rather than argued: exactly two entries are in that state —
      // HLB (PCL -> HLB, 1339 m) and SSW (JES -> SSW, 660 m). Both route. The
      // set is small because rule 4 needs UT to have surveyed the building AND
      // our bake to have missed it, which is a narrow overlap.
      //
      // THIS FLAG CHANGES NO BEHAVIOUR ON PURPOSE. Widening `routable` itself
      // was tried and reverted: the row became pickable and then read
      // "0 doors", because renderList() counts `e.doors`, which is empty for
      // exactly these two until virtualDoor() runs at route time. Both the
      // count and the tag live in the copy/render block this lane does not
      // own, so the honest move is to publish the fact and let that lane make
      // one coherent change. The patch is written out in docs/si-gaps.md §6.
      //
      // `utTruth` and not `utIndex`, so the useUTSurvey gate applies here
      // exactly as it does on the routing path. `!e.offMap` because a Pickle
      // building has UT rows and still cannot be reached — virtualDoor() finds
      // no node within utVirtualSnapM of a point eleven kilometres away.
      e.utRoutable = !e.routable &&
        !!(!e.offMap && WAYFIND.utVirtualDoors && utTruth(e.code));
    }
    // ── §4c. AND THEN ROUND 3 SHUT THAT GAP INSTEAD OF DESCRIBING IT ───────
    //
    // The paragraph above says publishing the fact is the honest move. It was
    // half right: `utRoutable` costs nothing and it also FIXES nothing — a
    // student who types SSW still gets a grey row that will not open, and a
    // schedule import that hands the search box a code gets the same. The
    // reason the row reads "0 doors" was never a copy problem. `e.doors` is
    // simply EMPTY until virtualDoor() runs at route time.
    //
    // So run it here instead. The list then counts real doors, `routable` is
    // true because those doors really are anchored to the network, and the
    // copy/render block this lane does not own needs no change at all.
    //
    // THE TRAP THIS NEARLY WALKED INTO. virtualDoor() snaps DIFFERENTLY with
    // "avoid stairs" on — the anchor has to sit in the step-free component
    // (utVirtualStepFree). Filling `e.doors` hands doorSet() a non-empty
    // `all`, so it stops taking its `!pool.length` branch, and that branch is
    // where the step-free re-snap lives. Giving an avoid-stairs walker the
    // stair-climbing anchor is the exact bug utVirtualStepFree exists to
    // prevent, reintroduced one level up.
    //
    // It does not happen, because of a line that was already there:
    // doorSet() filters the pool through stepFreeDoor(), which keeps a door
    // only when one of its anchors is in the big step-free component. If the
    // plain snap landed somewhere a step-free walker can stand, using it is
    // correct; if it did not, the pool empties and the `!pool.length` branch
    // re-snaps exactly as before. MEASURED, not reasoned: with this switch
    // off and on, all 67 UT-surveyed buildings return the identical candidate
    // doors AS COORDINATES in both stairs modes, and walkmeter's stairs and
    // reachability rows do not move. docs/si-gaps.md §4.
    //
    // Scope, measured on this graph rather than assumed: `utRoutable` is true
    // for exactly two entries — HLB and SSW — so this loop makes at most
    // three node scans, once, at load.
    if (WAYFIND.utDoorsIndexed) {
      for (const e of entries) {
        if (!e.utRoutable) continue;
        const truth = utTruth(e.code);
        if (!truth) continue;
        const made = [];
        // avoidStairs FALSE on purpose — see the trap above. The step-free
        // variant stays lazy so it is snapped under its own constraint.
        for (const t of utWant(truth, false)) {
          const v = virtualDoor(g, e, t, false);
          if (v >= 0 && made.indexOf(v) < 0) made.push(v);
        }
        if (!made.length) continue;
        e.doors = made;
        e.utIndexed = true;          // provenance: UT's own coordinate, not a
                                     // door this project's bake ever placed.
        e.routable = e.doors.some(di => g.doors[di][2] && g.doors[di][2].length);
      }
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
  // ══════════════════════════════════════════════════════════════════════════
  // WHICH DOOR — and this is the part the router used to get wrong.
  //
  // Taking the minimum over EVERY door pair answers "what is the shortest
  // mapped walk between these two footprints", and for adjacent buildings that
  // is a pair of back doors: PCL to Jester comes out at 80 m that way and 156 m
  // between the doors a person would actually use. So the first version made
  // `role: main` win wherever a building had one. (HANDOFF #113, finding 1.)
  //
  // THAT FIX WAS RIGHT ABOUT THE PROBLEM AND WRONG ABOUT THE EVIDENCE. `role`
  // is assigned by scripts/bake_entrances.py from a publicness score — how much
  // pavement, plaza and street a door faces — and on 9 buildings out of 10
  // there is no surveyed fact anywhere in OpenStreetMap to check it against.
  // It is a guess, and making a guess the ONLY door the router will consider
  // makes a wrong guess unrecoverable: the correct door is sitting in the same
  // file, correctly placed, labelled `secondary`, and structurally invisible.
  //
  // UT ALREADY PUBLISHED THE ANSWER. maps.utexas.edu runs on public ArcGIS
  // layers, and one of them — `Celebrated_Entrances_view` — is UT Facilities'
  // own hand-surveyed record of the real front door of 67 campus buildings,
  // with a barrier-free flag and an auto-opener flag per door. Measured against
  // it (docs/walk-door.md), the door this router picked was the right one for
  // 16 of 55 routable buildings. For the other 39 the right door was already in
  // our data and merely mislabelled. So UT's survey is now truth here, in the
  // same way an OSM `entrance=main` node is truth, and it wins over the score.
  //
  // Everything below is measured or quoted. Nothing here is a guess about a
  // building nobody looked at.
  // ══════════════════════════════════════════════════════════════════════════

  // UT Austin celebrated entrances, © The University of Texas at Austin,
  // re-pulled 2026-08-24 from the public, unauthenticated layer
  //   services9.arcgis.com/w9x0fkENXvuWZY26/arcgis/rest/services/
  //   Celebrated_Entrances_view/FeatureServer/0/query?where=1=1&outFields=*
  // — the same data the campus map itself draws. 97 doors on 67 buildings.
  //
  //   CODE  latitude  longitude  side  barrier-free  auto-opener
  //
  // THE COORDINATE IS THE ROW'S POINT GEOMETRY, NOT ITS Longitude/Latitude
  // COLUMNS, and the difference is not cosmetic: every row carries both, they
  // are a median 2.7 m apart, 15 buildings are 10 m+ apart and MBB is 39 m
  // apart. Rounds 1-6 of this lane read the columns and were therefore scoring
  // themselves against a point maps.utexas.edu does not draw. An ArcGIS feature
  // layer renders `geometry`; the columns are drawn by nothing, and 29 of the
  // 98 rows have no columns at all yet still appear on the map. The full
  // measurement, including why this is a correctness fix and NOT a claim that
  // the geometry is the better survey, is in scripts/bake_entrances.py above
  // UT_COORD_SOURCE — which is also the one-line switch back.
  //
  // It is a literal table on purpose: a wrong coordinate is a one-line edit,
  // and a table in the file cannot go stale against a fetch that fails at boot.
  // Re-pull it with `python scripts/bake_entrances.py --refresh-ut`, which
  // prints the disagreement between the two fields alongside the table.
  const UT_CELEBRATED = [
    'ASE 30.291253 -97.737547 W Y Y',
    'BAT 30.284753 -97.739088 SW Y Y',
    'BAT 30.284797 -97.738693 E Y Y',
    'BAT 30.284889 -97.738916 N N N',
    'BE1 30.391820 -97.726989 N Y Y',
    'BEG 30.391018 -97.725348 N Y Y',
    'BEN 30.283959 -97.738779 E Y Y',
    'BIO 30.287254 -97.740064 W Y Y',
    'BME 30.289405 -97.738721 NW Y Y',
    'BRB 30.285261 -97.736991 W Y Y',
    'BUR 30.288629 -97.738532 S Y Y',
    'BWY 30.290797 -97.738079 E Y N',
    'CAL 30.284460 -97.740360 S Y Y',
    'CCJ 30.288101 -97.730595 W Y Y',
    'CCJ 30.288205 -97.730582 NW N N',
    'CMA 30.289220 -97.740757 S Y Y',
    'CMB 30.289316 -97.741017 E Y Y',
    'CPE 30.290032 -97.736140 S Y N',
    'DMC 30.290125 -97.740480 S Y Y',
    'ECJ 30.288962 -97.735493 W Y Y',
    'ECJ 30.289034 -97.735890 W N N',
    'EER 30.288310 -97.735657 W Y Y',
    'EME 30.389588 -97.727334 E Y Y',
    'EPS 30.285686 -97.736684 S N N',
    'EPS 30.285800 -97.736936 W Y Y',
    'ETC 30.289814 -97.735485 W Y Y',
    'FAC 30.286071 -97.740009 SE Y Y',
    'FAC 30.286422 -97.740629 NW Y Y',
    'FAC 30.286556 -97.739980 NE Y N',
    'FNT 30.287846 -97.737779 E Y Y',
    'FS1 30.386885 -97.731999 E Y N',
    'FSL 30.387375 -97.731553 W N N',
    'GAR 30.285109 -97.738549 S Y Y',
    'GAR 30.285182 -97.738702 W Y Y',
    'GDC 30.285991 -97.736639 S Y Y',
    'GEA 30.287729 -97.739216 S N N',
    'GEA 30.287782 -97.738929 E Y Y',
    'GOL 30.285294 -97.741409 SW Y Y',
    'GOL 30.285689 -97.741284 NW Y N',
    'GWB 30.287829 -97.740064 W Y Y',
    'HLB 30.275597 -97.733208 N Y Y',
    'HRH 30.284097 -97.740421 SW Y Y',
    'HSM 30.288992 -97.740945 W Y N',
    'JES 30.283087 -97.737032 NW Y Y',
    'JGB 30.285622 -97.735839 SW Y Y',
    'JHH 30.278341 -97.731966 E Y Y',
    'JHH 30.278370 -97.732079 W Y Y',
    'JON 30.288525 -97.731347 S Y Y',
    'MAI 30.286023 -97.739757 W Y Y',
    'MBB 30.288237 -97.737147 SW Y Y',
    'MER 30.385289 -97.728277 SE Y N',
    'MER 30.385775 -97.727978 E Y Y',
    'MER 30.386410 -97.727796 NE Y N',
    'MEZ 30.284323 -97.739133 SW Y Y',
    'MEZ 30.284376 -97.738725 E Y Y',
    'MRH 30.287193 -97.730867 S Y N',
    'NHB 30.287474 -97.737253 E Y Y',
    'NHB 30.287493 -97.737785 SE N N',
    'NHB 30.287530 -97.738271 SW N Y',
    'NHB 30.287733 -97.737757 NE Y N',
    'PAI 30.286928 -97.738670 SW Y Y',
    'PAI 30.286948 -97.738468 E Y Y',
    'PAR 30.284894 -97.739866 E N N',
    'PAR 30.284934 -97.740339 W Y Y',
    'PAT 30.288162 -97.736508 N Y Y',
    'PCL 30.282994 -97.737865 N Y Y',
    'PHR 30.288100 -97.738786 W Y Y',
    'PHR 30.288351 -97.738902 N Y Y',
    'PMA 30.288903 -97.736342 S Y Y',
    'PMA 30.288912 -97.736006 NE Y Y',
    'PX3 30.387322 -97.729725 E Y N',
    'RLP 30.284868 -97.735765 W Y N',
    'RLP 30.285000 -97.734882 NE Y Y',
    'RLP 30.285186 -97.735451 N Y Y',
    'ROC 30.390533 -97.725667 W Y Y',
    'SEA 30.289739 -97.737745 SW Y Y',
    'SSW 30.280477 -97.732959 SW Y Y',
    'SSW 30.280797 -97.732860 NW N N',
    'SUT 30.285052 -97.740815 N Y Y',
    'SV1 30.382449 -97.725727 W Y N',
    'SZB 30.281923 -97.738584 E Y Y',
    'SZB 30.281936 -97.738864 NW Y Y',
    'TCB 30.387216 -97.727045 W Y Y',
    'UA9 30.290197 -97.738854 SW Y Y',
    'UTA 30.279248 -97.742629 E Y Y',
    'UTA 30.279461 -97.743022 W Y Y',
    'UTC 30.283339 -97.738594 NE Y N',
    'WAG 30.285273 -97.737505 NE Y Y',
    'WCH 30.286112 -97.738639 W Y Y',
    'WCH 30.286121 -97.738138 NE N Y',
    'WEL 30.286522 -97.737405 E Y Y',
    'WEL 30.286690 -97.738026 NW Y Y',
    'WEL 30.286888 -97.737452 NE Y N',
    'WIN 30.285663 -97.734532 S Y Y',
    'WMB 30.285617 -97.740594 N Y Y',
    'WWH 30.289196 -97.741842 S N N',
    'WWH 30.289354 -97.741895 W Y Y',
  ];
  let utByCode = null;
  /** The table, parsed. NOT gated on anything — see wayfindUTDoors below. */
  function utIndex() {
    if (!utByCode) {
      utByCode = new Map();
      for (const row of UT_CELEBRATED) {
        const p = row.split(' ');
        const rec = { lat: +p[1], lon: +p[2], side: p[3], bf: p[4] === 'Y', ao: p[5] === 'Y' };
        const k = p[0];
        if (utByCode.has(k)) utByCode.get(k).push(rec); else utByCode.set(k, [rec]);
      }
    }
    return utByCode;
  }
  /** What the ROUTER is allowed to use. `useUTSurvey` is the master switch and
   *  it belongs here, on the routing path, and nowhere else. */
  function utTruth(code) {
    if (!code || !WAYFIND.useUTSurvey) return null;
    return utIndex().get(code.toUpperCase()) || null;
  }
  // Exposed so a verify script can score the router against UT's own answer
  // without re-fetching ArcGIS, and so the count in docs/walk-door.md is read
  // off the shipped table rather than typed next to it.
  //
  // With no argument it returns the WHOLE oracle — the row count and every
  // building code in it. scripts/verify/walkmeter.mjs needs the code list to
  // score "every building UT surveyed" rather than only the forty ends a pair
  // list happens to name, and the alternative was the harness carrying its own
  // copy of the list, which is a copy that can go stale against this table
  // without anything failing. Deliberately NOT gated on useUTSurvey: the
  // held-out pass turns the survey off inside the ROUTER and still has to score
  // itself against it, so the oracle must survive its own master switch.
  //
  // IT DID NOT, UNTIL 2026-08-24, AND THE COMMENT ABOVE WAS THE ONLY PLACE THAT
  // SAID SO. The per-code branch went through utTruth(), which returns null the
  // moment useUTSurvey is false — so the A/B pass that turns the survey off
  // silently lost the ground truth it was being scored against and fell back to
  // a coarser proxy, comparing 30 ends against 38 and calling it a before-and-
  // after. Reading the table directly is the fix; the switch stays where it
  // belongs, on the routing path.
  window.wayfindUTDoors = function (code) {
    if (code) return (utIndex().get(String(code).toUpperCase()) || []).slice();
    const codes = [];
    for (const row of UT_CELEBRATED) {
      const c = row.slice(0, row.indexOf(' '));
      if (codes.indexOf(c) < 0) codes.push(c);
    }
    return { doors: UT_CELEBRATED.length, buildings: codes.length, codes };
  };

  // ══════════════════════════════════════════════════════════════════════════
  // 4b. THE CODES `registerUrl` DOES NOT COVER — AND WHY THEY GET AN ANSWER
  // ══════════════════════════════════════════════════════════════════════════
  //
  // A class schedule is a list of building CODES. Import one and every code in
  // it lands in exactly one of four buckets, and until 2026-08-24 two of those
  // four buckets were the same silence:
  //
  //   1. routable                 136 of the 209 codes a schedule can name
  //   2. known, not walkable yet   62  — the register merge above already
  //                                     gives these the honest sentence
  //   3. real, but not on this map  10  <- said `notfound`, i.e. "you typed it
  //   4. not a UT code at all        —      wrong". So did bucket 4.
  //
  // Buckets 3 and 4 reading identically is the whole defect. A student whose
  // Tuesday 2 pm is at MER should be told MER is eleven kilometres north at
  // another campus, not that MER does not exist. The two tables below are the
  // only thing standing between those two answers, and they exist because
  // `data/ut_buildings.json` — UT's own register, retrieved 2026-08-05 — is a
  // MAIN-CAMPUS snapshot: 198 codes, none of them at a satellite campus, and
  // (measured, not assumed) missing one main-campus building outright.
  //
  // MEASURED 2026-08-24, on this repo's own files, before either table existed:
  // eleven UT-surveyed codes answered `notfound`. Every one of them was put
  // through the same two questions — how far is UT's own surveyed door from
  // the nearest node of `data/walk_graph.json`, and is there a footprint in
  // the snapshot the app actually draws:
  //
  //   SSW   nearest walk node  37.4 m   both UT doors land 0.4 m and 2.5 m
  //                                     from the edge of ONE drawn footprint
  //                                     (id 3fcbe266-…, h 9.8 m, unnamed)
  //   the other ten          9.6–10.6 km to the nearest node; no footprint
  //                                     within 200 m of any of them
  //
  // Three orders of magnitude apart, so they are two different problems and
  // they get two different tables. Full working: docs/si-gaps.md.

  // The middle of the Forty Acres, for saying how far away "away" is. It is
  // the Main Building's OWN surveyed door out of UT_CELEBRATED above ('MAI
  // 30.286023 -97.739757') rather than a second hand-typed coordinate, so
  // there is exactly one place a campus centre can be wrong.
  const OFF_MAP_ORIGIN = ['MAI', -97.739757, 30.286023];

  // ── TABLE A: on this map, surveyed by UT, absent from the register ────────
  //
  // `[CODE, display name, UT building number]`.
  //
  // SSW is the only member, and it is not a special case bolted on — it is the
  // register file being incomplete. UT files SSW as main campus (its own
  // maps.utexas.edu record redirects to the `UTM` path, not the `PRC` one; see
  // docs/import-bar-ut.md, which checked three public sources). Our register
  // snapshot simply does not list it, so the register merge never made an
  // entry, so `resolve('SSW')` returned null, so `doorSet()`'s rule 4 — walk to
  // UT's own coordinate when we have no door of our own, the rule that already
  // makes HLB work — never got the chance to fire.
  //
  // NOTHING ELSE IS NEEDED. Adding the entry is the entire fix: UT_CELEBRATED
  // already carries SSW's two doors, and `utVirtualSnapM` (75 m) already
  // reaches the network from both of them.
  const CAMPUS_EXTRA = [
    ['SSW', 'School of Social Work Building', '0625'],
  ];

  // ── TABLE B: a real UT building, at a campus this app does not draw ───────
  //
  // `[CODE, display name, campus]`.
  //
  // The coordinate is deliberately NOT repeated here — it is read back out of
  // UT_CELEBRATED, which already has every one of these, so the distance below
  // cannot drift away from the survey. Names are UT Direct's own Pickle
  // Research Campus building index, quoted in docs/import-bar-ut.md.
  //
  // ROUTING TO THESE IS NOT THE FIX AND WOULD BE A LIE: there is no pavement
  // in `data/walk_graph.json` within nine kilometres of any of them. Saying so
  // is the fix.
  const OFF_MAP_CAMPUS_PICKLE = 'J.J. Pickle Research Campus';
  const OFF_MAP = [
    ['BE1', 'BEG Lab Building', OFF_MAP_CAMPUS_PICKLE],
    ['BEG', 'BEG Main Building', OFF_MAP_CAMPUS_PICKLE],
    ['EME', 'Electro-Mechanical Engineering Research Center', OFF_MAP_CAMPUS_PICKLE],
    ['FS1', 'Ferguson Engineering Lab Annex', OFF_MAP_CAMPUS_PICKLE],
    ['FSL', 'Ferguson Laboratory — Main Building', OFF_MAP_CAMPUS_PICKLE],
    ['MER', 'Microelectronics & Engineering Research Center', OFF_MAP_CAMPUS_PICKLE],
    ['PX3', 'PETEX', OFF_MAP_CAMPUS_PICKLE],
    ['ROC', 'Research Office Complex', OFF_MAP_CAMPUS_PICKLE],
    ['SV1', 'PRC Service Center Trades', OFF_MAP_CAMPUS_PICKLE],
    ['TCB', 'J. Neils Thompson Commons', OFF_MAP_CAMPUS_PICKLE],
  ];

  // Eight points is as fine as a direction can honestly be for a place eleven
  // kilometres away that the reader cannot see on the map anyway.
  const COMPASS_8 = ['north', 'northeast', 'east', 'southeast',
    'south', 'southwest', 'west', 'northwest'];

  let offMapByCode = null;
  /**
   * What we know about a code that names a building this map does not draw:
   * its name, its campus, UT's own coordinate for it, and how far and which
   * way that is from the middle of campus.
   *
   * Everything derived is derived HERE rather than stored, so the table above
   * holds only facts that are not computable from another fact in this file.
   * `km` uses the same flat MPD_LON/MPD_LAT this whole file routes with; over
   * a span that is 99% north-south the longitude term barely participates and
   * the error against a great circle is under a metre.
   */
  function offMapIndex() {
    if (!offMapByCode) {
      offMapByCode = new Map();
      for (const row of OFF_MAP) {
        const ut = utIndex().get(row[0]) || [];
        const p = ut.length ? ut[0] : null;
        let km = null, dir = null;
        if (p) {
          const dx = (p.lon - OFF_MAP_ORIGIN[1]) * MPD_LON;
          const dy = (p.lat - OFF_MAP_ORIGIN[2]) * MPD_LAT;
          // Two decimals. A reader is going to see "11 km"; more precision
          // than a centidegree of it would be false confidence in a straight
          // line nobody walks.
          km = Math.round(Math.hypot(dx, dy) / 10) / 100;
          // Bearing clockwise from north, bucketed to eight.
          const deg = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
          dir = COMPASS_8[Math.round(deg / 45) % 8];
        }
        offMapByCode.set(row[0], {
          code: row[0], name: row[1], campus: row[2],
          lat: p ? p.lat : null, lon: p ? p.lon : null,
          km: km, direction: dir, doors: ut.length,
          from: OFF_MAP_ORIGIN[0],
        });
      }
    }
    return offMapByCode;
  }

  /**
   * THE SEAM A SCHEDULE IMPORT CONSUMES. With a code, the record above or
   * null; with nothing, the whole table plus the campuses in it.
   *
   * This is the contract, and it is deliberately data rather than a sentence:
   * an import bar, a search box and a route card each want to phrase "MER is
   * at the J.J. Pickle Research Campus, 11 km north" differently, and the copy
   * block is somebody else's file. Adding a second satellite campus later — UT
   * has several — is a row in OFF_MAP and nothing else.
   *
   * NOT gated on `offMapCodes`, for the same reason `wayfindUTDoors` is not
   * gated on `useUTSurvey`: the switch turns the behaviour off inside the
   * ROUTER, and a harness that flips it still has to be able to ask what the
   * table says.
   */
  window.wayfindOffMap = function (code) {
    if (code) return offMapIndex().get(String(code).toUpperCase()) || null;
    const idx = offMapIndex();
    const campuses = {};
    for (const r of idx.values()) campuses[r.campus] = (campuses[r.campus] || 0) + 1;
    return {
      buildings: idx.size, campuses,
      codes: Array.from(idx.keys()),
      extras: CAMPUS_EXTRA.map(r => r[0]),
      origin: { code: OFF_MAP_ORIGIN[0], lon: OFF_MAP_ORIGIN[1], lat: OFF_MAP_ORIGIN[2] },
    };
  };
  // Where a door index actually is. A verify script cannot read this out of
  // data/walk_graph.json any more, because a door UT surveyed and our bake
  // never placed is created here at run time and has no index in that file.
  window.wayfindDoorAt = function (di) {
    if (!G || di == null || !G.doors[di]) return null;
    const d = G.doors[di];
    return {
      ll: [d[0] * G.q, d[1] * G.q], role: d[4], src: d[5], ref: d[6],
      // how far the dashed "not a mapped path" leg to this door runs, in
      // metres — the thing utVirtualSnapM caps.
      linkM: (d[3] && d[3].length) ? Math.min.apply(null, d[3]) / 100 : null,
      // WHERE IT ATTACHES TO THE NETWORK, so an offline replay can route to a
      // door that exists only in this tab. scripts/verify/walkmeter.mjs keeps
      // its own Dijkstra and self-checks it against the browser's number every
      // run; a virtual door (src:'ut') has no index in the served
      // data/walk_graph.json, so without these two fields that self-check has
      // to be SKIPPED for exactly the doors this lane added — the ones most in
      // need of checking. `virtual` is not a guess: it is whether this record
      // was pushed on at run time rather than baked.
      nodes: (d[2] || []).slice(),
      costM: (d[3] || []).map(c => c / 100),
      virtual: utVirtualIdx.has(di),
    };
  };
  // The candidate doors for one building, without routing anywhere — so the
  // door choice can be scored across every building UT covers instead of only
  // the ones that happen to appear in a pair list.
  window.wayfindDoors = async function (query, avoidStairs) {
    await loadGraph();
    const e = resolve(query);
    if (!e) return null;
    return {
      code: e.code, display: e.display,
      doors: doorSet(G, e, !!avoidStairs).map(di => window.wayfindDoorAt(di)),
      ut: (utTruth(e.code) || []).slice(),
      // §4b. Present only on a code that names a building at another campus.
      // The doors array is still empty for those, so anything counting
      // routable buildings counts them exactly as it did before — this adds a
      // reason next to the zero, it does not change the zero.
      offMap: e.offMap || null,
    };
  };

  // ── a door UT surveyed that our own bake never placed ─────────────────────
  //
  // For 26 of the 55 routable buildings UT covers, `data/entrances.geojson` has
  // no geometry within utDoorMatchM of UT's point, so there is nothing to
  // relabel: the door simply is not in our data. Walking people to the far side
  // of the building instead is the exact complaint this pass exists to fix, so
  // the router builds a routing TARGET at UT's coordinate and snaps it to the
  // nearest usable node of the walked network — the same thing the bake's
  // anchor step does for a real door, done at load time for one point.
  //
  // It is a target, not geometry. Nothing new is drawn on the building; the
  // last stretch is the same dashed, "not a mapped path" leg every unmapped
  // door already gets. The durable fix is upstream in scripts/bake_entrances.py
  // (see docs/walk-door.md); once data/walk_graph.json is rebaked from the new
  // data/entrances.geojson these become ordinary doors and this never fires.
  const utVirtual = new Map();
  // Which door indices this file invented at run time. `wayfindDoorAt` reports
  // it so a verify script can tell a baked door from one that exists only in
  // this tab, and route to the second anyway.
  const utVirtualIdx = new Set();

  // ── THE STEP-FREE COMPONENT, and the Main Building bug that found it ──────
  //
  // Snapping a door to "the nearest node with a walkable edge" is not enough
  // when the walker cannot use stairs, because a node can be perfectly walkable
  // and still sit on an island whose ONLY connections to the rest of campus are
  // staircases. The Main Building is exactly that: UT's west entrance snapped to
  // node 871 on the Tower's plinth, which reaches 10,790 nodes if you may climb
  // steps and 37 if you may not. So with "avoid stairs" ticked, EVERY route to
  // or from the most recognisable building on campus answered "we cannot take
  // you there" — while UT's own survey records that entrance as BarrierFree with
  // an auto-opener. Measured, 2026-08-23: 4 of the 56 UT-covered buildings were
  // unreachable that way (CMA, CMB, JGB, MAI).
  //
  // So when the toggle is on, the snap must land in the step-free component, not
  // merely on a walkable node. Labels are flooded once, lazily, on the first
  // avoid-stairs door — 11,284 nodes, and it never runs for a walker who never
  // ticks the box. The largest component is 92.0% of the graph; the runner-up is
  // 68 nodes, so "largest" is not a close call that could flip between bakes.
  //
  // What it does NOT do: move a REAL door. Choosing between real doors is
  // doorSet()'s job, and round 5 gave it the same component test — see
  // stepFreeDoor() below, and CMB, which this round's flooding could see was
  // stranded and had no way to act on.
  let stepFree = null;
  function stepFreeComp(g) {
    if (stepFree && stepFree.g === g) return stepFree;
    const comp = new Int32Array(g.N).fill(-1);
    const stack = new Int32Array(g.N);
    const sizes = [];
    for (let s = 0; s < g.N; s++) {
      if (comp[s] !== -1) continue;
      const cid = sizes.length;
      let sp = 0, n = 0;
      stack[sp++] = s; comp[s] = cid;
      while (sp > 0) {
        const u = stack[--sp]; n++;
        for (let k = g.off[u]; k < g.off[u + 1]; k++) {
          const f = g.F[g.eix[k]];
          if (f & F_OFFMAIN) continue;
          if (f & F_STEPS) continue;
          const v = g.to[k];
          if (comp[v] === -1) { comp[v] = cid; stack[sp++] = v; }
        }
      }
      sizes.push(n);
    }
    let big = 0;
    for (let c = 1; c < sizes.length; c++) if (sizes[c] > sizes[big]) big = c;
    stepFree = { g, comp, big, size: sizes[big], parts: sizes.length };
    return stepFree;
  }

  /**
   * THE WAYS THERE ARE OF WALKING UP TO A POINT, nearest first.
   *
   * This used to return one node and only one: the nearest usable node to UT's
   * coordinate. That is the right answer to "where does this door attach to the
   * network" and the WRONG answer to "how does a walker arrive at it", and the
   * router only ever asked the second question. A door with one anchor forces
   * every walk in the city through that node no matter which direction it came
   * from — which is this lane's founding complaint ("routes take you to a
   * farther entrance than you have to go") committed one level down, at the
   * approach instead of at the door.
   *
   * A BAKED DOOR HAS NEVER WORKED THAT WAY. `scripts/bake_walk.py` gives a real
   * door every anchor it found — Welch's main door carries two, 0.4 m and
   * 22.6 m out — and `anchors()` hands all of them to dijkstra, which picks
   * whichever the walk makes cheapest. The door we invent at UT's coordinate is
   * now built the same way, and it is the only kind of door left that was not.
   *
   * `spreadM` is what stops that from becoming a different door: an anchor whose
   * dashed stretch runs much longer than the nearest one's is not another way to
   * the same entrance, it is a straight line across somewhere else. The list is
   * nearest-first and capped, so the cheapest approach is always in it.
   */
  function usableNodesNear(g, lon, lat, stepFreeOnly, maxM, spreadM, cap) {
    const sf = stepFreeOnly ? stepFreeComp(g) : null;
    const lim = maxM * maxM;
    const found = [];
    for (let i = 0; i < g.N; i++) {
      const dx = (g.X[i] - lon) * MPD_LON, dy = (g.Y[i] - lat) * MPD_LAT;
      const d2 = dx * dx + dy * dy;
      if (d2 > lim) continue;
      // A node whose every edge is F_OFFMAIN is on a stranded island the router
      // refuses to walk on, so snapping to it would produce "no route found"
      // for a building that was fine before. With "avoid stairs" on, the same
      // argument applies one level up: the node must be in a component the
      // walker can actually leave without climbing anything.
      let usable = false;
      if (sf) {
        usable = sf.comp[i] === sf.big;
      } else {
        for (let k = g.off[i]; k < g.off[i + 1]; k++) {
          if (!(g.F[g.eix[k]] & F_OFFMAIN)) { usable = true; break; }
        }
      }
      if (usable) found.push({ node: i, m: Math.sqrt(d2) });
    }
    if (!found.length) return [];
    found.sort((a, b) => a.m - b.m);
    const keep = found[0].m + spreadM;
    // ONE STRETCH OF PAVEMENT, NOT A RING ROUND THE BUILDING. The extra
    // anchors have to stay near the nearest one, because the leg from an
    // anchor to the door is a STRAIGHT LINE over ground nobody has mapped:
    // the further round the building an anchor sits, the more of that line
    // runs through the building. Routing through a building is the one thing
    // Simeon ruled out ("a bit not verifyable"), and this dashed leg was the
    // only part of a walk still exempt from it. Measured — see
    // utVirtualClusterM's own comment for the table.
    const nx = (g.X[found[0].node] - lon) * MPD_LON;
    const ny = (g.Y[found[0].node] - lat) * MPD_LAT;
    const out = [];
    for (let k = 0; k < found.length && out.length < cap; k++) {
      if (found[k].m > keep) break;
      if (k > 0) {
        const vx = (g.X[found[k].node] - lon) * MPD_LON;
        const vy = (g.Y[found[k].node] - lat) * MPD_LAT;
        if (Math.hypot(vx - nx, vy - ny) > WAYFIND.utVirtualClusterM) continue;
      }
      out.push(found[k]);
    }
    return out;
  }
  function virtualDoor(g, entry, t, avoidStairs) {
    const wantStepFree = !!avoidStairs && WAYFIND.utVirtualStepFree;
    // THE CACHE KEY CARRIES THE MODE. It memoises REFUSALS as well as hits, so
    // a key that ignored the toggle would hand an avoid-stairs walker the door
    // snapped for a stair-climbing one — which is the whole bug, cached.
    const key = entry.code + '|' + t.lat + ',' + t.lon + (wantStepFree ? '|sf' : '');
    if (utVirtual.has(key)) return utVirtual.get(key);
    let di = -1;
    const near = usableNodesNear(g, t.lon, t.lat, wantStepFree,
      WAYFIND.utVirtualSnapM, WAYFIND.utVirtualSpreadM,
      Math.max(1, WAYFIND.utVirtualAnchors | 0));
    if (near.length) {
      di = g.doors.length;
      // Same 8-field door record scripts/bake_walk.py writes, with `src: 'ut'`
      // so a door phrase or a verify script can tell where it came from — and
      // now with the same MULTI-anchor node/cost arrays a baked door carries.
      g.doors.push([Math.round(t.lon / g.q), Math.round(t.lat / g.q),
        near.map(s => s.node), near.map(s => Math.round(s.m * 100)),
        'main', 'ut', entry.code || '', entry.display || '']);
      utVirtualIdx.add(di);
    }
    utVirtual.set(key, di);
    return di;
  }

  // Which of a building's UT-surveyed doors are on offer. With "avoid stairs"
  // on, only the barrier-free ones — unless UT records none for this building,
  // in which case the honest answer is still the doors that exist (the card
  // already says the toggle is not an accessibility guarantee).
  function utWant(truth, avoidStairs) {
    if (!avoidStairs) return truth;
    const bf = truth.filter(t => t.bf);
    return bf.length ? bf : truth;
  }

  // ── A DOOR YOU CANNOT GET TO IS NOT A CANDIDATE ───────────────────────────
  //
  // Round 3 taught the SNAP about the step-free component (see utVirtualStepFree
  // above) and stopped there, because a snap is the only thing that INVENTS a
  // target. That left a hole with a real building in it, and round 4's critic
  // walked straight into it: the router still offered doors it had not snapped
  // — our own baked ones — without ever asking whether the walker could reach
  // them.
  //
  // CMB, Jesse H. Jones Communication Center B. UT publishes its east entrance
  // at 30.289279,-97.741010 and calls it BarrierFree with an auto-opener. Our
  // bake has a door 3.1 m from that point (door #324), so the UT match fires,
  // and #324 anchors nodes 452 and 11040 — both on a 16-node island in the
  // CMA/CMB courtyard whose every exit OSM has drawn as `highway=steps`. So the
  // candidate list came back with one door on it, the door was unreachable by
  // construction, and dijkstra answered `noroute`. Measured from three separate
  // hubs (GDC, PCL, UTC): the walk is fine with the box unticked and refused
  // the moment you tick it, and the card says "No walking route found" to the
  // one person on campus who cannot just take the steps.
  //
  // This is the same class of bug one level up, so it gets the same rule: with
  // "avoid stairs" on, a door is only a candidate if one of its anchor nodes is
  // in the step-free component. Dropping the rest cannot lose a route — a node
  // outside that component is one dijkstra could never have arrived at with the
  // toggle on — so this is subtraction that only ever removes refusals.
  function stepFreeDoor(g, di) {
    const sf = stepFreeComp(g);
    const nodes = g.doors[di][2] || [];
    for (let k = 0; k < nodes.length; k++) if (sf.comp[nodes[k]] === sf.big) return true;
    return false;
  }

  /**
   * The candidate doors for one end of a route, in order of how much we know.
   *
   *   1. UT surveyed this building  -> the door(s) nearest UT's own point.
   *      With "avoid stairs" on, only UT's barrier-free doors — because UT
   *      records, per door, that Batts' north entrance is up a flight with no
   *      auto-opener while its east entrance is not. That is a fact about a
   *      DOOR, and the stairs toggle used to only know about PATHS.
   *   2. Nobody surveyed it -> `role: main`, exactly as before.
   *   3. No main -> everything routable.
   *   4. No door of ours at all, but UT surveyed one -> UT's door. This is
   *      last in the list and first in the order of operations, because a
   *      building with nothing anchored to the network used to answer "we
   *      cannot take you there" (SAY.notRoutable) even when UT publishes the
   *      entrance. HLB, the Health Learning Building, is the live case.
   *
   * Every one of those is filtered through `pool` first when the walker has
   * ticked "avoid stairs": see stepFreeDoor() above.
   *
   * Returns the same shape it always did (an array of door indices) so the
   * `via` branch of computeRoute keeps its old, conservative behaviour.
   */
  function doorSet(g, entry, avoidStairs) {
    const all = entry.doors.filter(di => g.doors[di][2] && g.doors[di][2].length);
    const truth = utTruth(entry.code);
    // The doors this particular walker can actually arrive at. Identical to
    // `all` unless the toggle is on, so nothing below this line can move a
    // stairs-allowed route by a single metre.
    const gate = !!avoidStairs && WAYFIND.stepFreeDoors;
    const pool = gate ? all.filter(di => stepFreeDoor(g, di)) : all;
    if (!pool.length) {
      // Nothing of ours is anchored to the network here — or, with the toggle
      // on, nothing of ours is anchored anywhere this walker can stand. If UT
      // surveyed the entrance, walk to UT's own coordinate rather than refusing
      // the trip; virtualDoor() snaps into the step-free component in that mode.
      if (!truth || !WAYFIND.utVirtualDoors) return all;
      const made = [];
      for (const t of utWant(truth, avoidStairs)) {
        const v = virtualDoor(g, entry, t, avoidStairs);
        if (v >= 0 && made.indexOf(v) < 0) made.push(v);
      }
      // A building with mapped doors and no step-free one (LTH, TS2) still
      // answers with the doors that exist. The route then fails, and it SHOULD:
      // we have no evidence of a step-free way in, and inventing one is worse
      // than saying so.
      return made.length ? made : all;
    }
    if (truth) {
      const want = utWant(truth, avoidStairs);
      // ONE UT DOOR AT A TIME, AND WHAT HAPPENS NEXT DEPENDS ON WHETHER WE HAVE
      // IT. Under utDoorMatchM our door IS UT's door and we simply mislabelled
      // it. Over it, our data has no door there at all — Biological
      // Laboratories' nearest is 62 m from UT's west entrance — and such a door
      // is NOT evidence for anything: mixing it in with a real match let the
      // router arrive 28 m from Welch's east door while a 2 m match sat in the
      // same candidate list. So an unmatched UT door becomes a virtual target
      // at UT's own coordinate, and a merely-nearest door is the last resort.
      const picked = [];
      let far = -1, farD = Infinity;
      for (const t of want) {
        let best = -1, bd = Infinity;
        for (const di of pool) {
          const d = metresBetween(doorLL(g, di), [t.lon, t.lat]);
          if (d < bd) { bd = d; best = di; }
        }
        if (best >= 0 && bd <= WAYFIND.utDoorMatchM) {
          if (picked.indexOf(best) < 0) picked.push(best);
          continue;
        }
        // AND THE THING THAT WAS TRIED HERE AND REJECTED, because the numbers
        // said so and the reasoning had not. Falling past utDoorMatchM in
        // avoid-stairs mode no longer only means "we have no door there" — it
        // can now also mean "the door we have there is up the steps", so it is
        // tempting to take the nearest REACHABLE door of our own instead (CMB's
        // mapped main entrance, 29 m round the building, on pavement) rather
        // than let the line below snap a target onto UT's coordinate with a
        // 41 m dashed leg. Measured on the live page with a 35 m cap, that
        // branch recovered CMB and moved EIGHTEEN other buildings off UT's
        // exact coordinate by 12.4-33.8 m (BEN 25.7, ECJ 33.7, UTA 33.8,
        // WEL 27.8; three more changed candidate without moving) —
        // reintroducing, inside the step-free mode, the exact "walks you to a
        // farther door than you have to go" complaint this lane exists to fix.
        // Table in docs/walk-door.md round 5.
        //
        // The virtual door is also the better ANSWER for CMB, not just the
        // cheaper diff: UT's survey records CMB East as BarrierFree with an
        // auto-opener, which is UT asserting a step-free approach that OSM has
        // simply not drawn. Our door #322 is a door UT never certified either
        // way. Sending a wheelchair user to the entrance UT certified, with the
        // unmapped stretch drawn dashed and labelled, beats sending them to one
        // nobody surveyed because we happen to have pavement to it.
        const v = WAYFIND.utVirtualDoors ? virtualDoor(g, entry, t, avoidStairs) : -1;
        if (v >= 0) { if (picked.indexOf(v) < 0) picked.push(v); }
        else if (best >= 0 && bd < farD) { farD = bd; far = best; }
      }
      if (picked.length) return picked;
      if (far >= 0 && WAYFIND.utDoorNearest) return [far];
    }
    // Buildings UT never surveyed. Same subtraction, and MEASURED RATHER THAN
    // ASSUMED: the offline read of the bake said this rescued two more, AHG and
    // NUR, whose `main` door is on a stairs island while a real secondary door
    // is not. Driving the live app said otherwise — both already routed, both
    // modes, from all three hubs. legBetween()'s wide pass had been quietly
    // covering them, because widenSideDoors reopens every routable door on a
    // building UT does not cover. So the honest claim is smaller than the one
    // this comment first made: the candidate list AHG and NUR offer is now the
    // door you can reach rather than the one you cannot (the unmapped last
    // stretch halves, 9.9 -> 4.5 m and 8.8 -> 4.1 m), and the route a user gets
    // is the same route it always was.
    const mains = pool.filter(di => g.doors[di][4] === 'main');
    return mains.length ? mains : pool;
  }

  // What a door has to BEAT to be worth walking round the building for. Zero
  // for the door we believe in, a taste value for a side door, effectively
  // never for a loading bay. Straight metres, so it is directly comparable
  // with the route length it is added to.
  function doorHandicapM(g, di, preferred) {
    if (preferred.indexOf(di) >= 0) return 0;
    const role = g.doors[di][4];
    if (role === 'main') return 0;
    if (role === 'secondary') return WAYFIND.sideDoorPenaltyM;
    return WAYFIND.backDoorPenaltyM;
  }

  function anchors(g, doors, role) {
    const out = [];
    const mult = WAYFIND.linkCostMult != null ? WAYFIND.linkCostMult : LINK_COST_MULT;
    for (const di of doors) {
      const d = g.doors[di];
      for (let k = 0; k < d[2].length; k++) {
        const m = d[3][k] / 100;
        // `c` is the truth (metres you walk, printed and drawn). `pc` is what
        // the router pays for making an unsurveyed claim of that length.
        out.push({ node: d[2][k], c: m, pc: m * mult, door: di, role });
      }
    }
    return out;
  }

  /**
   * Route between two buildings, and let a side door win when it genuinely
   * saves a walk.
   *
   * Two passes, not one, and the second is thrown away unless it earns its
   * place. Pass A is the doors we believe in (above). Pass B is every routable
   * door on both buildings, and it only replaces A if it is shorter even after
   * each of its doors pays its handicap. So a `secondary` door has to save more
   * than sideDoorPenaltyM to be chosen — a back-door pair of the kind HANDOFF
   * #113 caught would have had to save 110 m instead of the 76 m it did save.
   *
   * (That original pair is no longer decided here at all: UT surveyed both PCL
   * and Jester, so both ends come from the table above and the walk between
   * their two real front doors — PCL's north entrance off the library plaza,
   * Jester's northwest entrance — measures 100 m. Photographed in
   * shots/walk/door/check-pcl-jes.jpg.)
   *
   * The handicap NEVER touches the reported distance. Pass B, if it wins, is a
   * real route with its real link metres; the handicap is only ever used in the
   * comparison. A number on the card is always a number of metres you walk.
   *
   * WHEN THE ANSWER IS SUPPOSED TO BE STEP-FREE, THE DOOR IS PART OF THE
   * ANSWER. §3b: the last stretch is a straight line we drew, and four
   * anchors on campus draw it clean across a staircase. Pricing the graph's
   * step edges at Infinity while still arriving over one of those made the
   * toggle wrong on 11 of 140 routes. Same anchors as before on a normal
   * route; only the avoiding pass is fussy about its doors.
   *
   * `mk` lets the caller substitute a picker (computeRoute passes one that also
   * counts what was refused, so the card can say so). With no `mk` this is the
   * stairs lane's round-1 behaviour, line for line.
   *
   * INTEGRATION (acer/w-integrate): acer/w-door and acer/w-stairs both
   * redefined this function with different signatures — the only place in the
   * five lanes where two of them genuinely collided rather than appended.
   * They are not alternatives: `fromEntry`/`toEntry` are what let the widening
   * pass below refuse to outvote a door UT surveyed, and `mk` is what keeps a
   * step-free route from arriving over a staircase. Both are carried, `mk`
   * last so it stays optional and the stairs lane's default still applies.
   */
  function legBetween(g, fromDoors, toDoors, avoidStairs, fromEntry, toEntry, mk) {
    mk = mk || ((doors, role) => avoidStairs ? cleanAnchors(g, doors, role).anchors
                                             : anchors(g, doors, role));
    const seeds = mk(fromDoors, 'from');
    const targets = mk(toDoors, 'to');
    if (!seeds.length || !targets.length) return null;
    const a = dijkstra(g, seeds, targets, avoidStairs);
    // An end UT surveyed is NOT widened. Ground truth does not get outvoted by
    // a 55 m saving; the second pass exists for the 228 buildings where all we
    // have is our own scoring.
    const wide = (e, narrow) => (WAYFIND.widenSideDoors && e && !utTruth(e.code))
      ? routableDoors(g, e) : narrow;
    const wideFrom = wide(fromEntry, fromDoors), wideTo = wide(toEntry, toDoors);
    let r = a;
    if (wideFrom.length > fromDoors.length || wideTo.length > toDoors.length) {
      const b = dijkstra(g, anchors(g, wideFrom, 'from'), anchors(g, wideTo, 'to'), avoidStairs);
      if (b && (!a || b.cost + doorHandicapM(g, b.seed ? b.seed.door : wideFrom[0], fromDoors) +
                      doorHandicapM(g, b.target.door, toDoors) < a.cost)) r = b;
    }
    if (!r) return null;
    r.fromDoor = r.seed ? r.seed.door : fromDoors[0];
    r.fromLinkM = r.seed ? r.seed.c : 0;
    r.toDoor = r.target.door;
    r.toLinkM = r.target.c;
    return r;
  }
  function routableDoors(g, entry) {
    return entry.doors.filter(di => g.doors[di][2] && g.doors[di][2].length);
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
    // ── 5b. THE TOGGLE AND THE OFFER MUST BE THE SAME ROUTE ────────────────
    // `avoidStairs` with no explicit profile IS the step-free profile. Without
    // this line the card offered "Step-free: 14-19 min · 1.2 km" on ART>MAI and
    // then, when the button was pressed, answered "No route that avoids mapped
    // stairs" — because the offer had been worked out with the step-free door
    // and anchor rules and the click had not. Caught by looking at the frame,
    // not by reading the diff. stepFreeRoute() always passes `stepFree`
    // explicitly, so this delegation cannot recurse.
    if (opts.avoidStairs && opts.stepFree == null) {
      const sfr = stepFreeRoute(g, from, to, opts);
      return sfr.ok ? sfr.route
        : { ok: false, why: sfr.why === 'assert' ? 'nostepfree' : (sfr.why || 'nostepfree') };
    }
    const t0 = performance.now();
    // 5b — the step-free profile picks its DOORS differently (any door, not
    // only the ranked front one) and counts what cleanAnchors() refused so the
    // card can say so. With stepFree unset both are the round-1 behaviour.
    const sf = !!opts.stepFree;
    let refused = 0, forced = false;
    const mk = (doors, role) => {
      if (!sf) return anchors(g, doors, role);
      const c = cleanAnchors(g, doors, role);
      refused += c.dropped; forced = forced || c.forced;
      return c.anchors;
    };
    const allDoors = opts.stepFreeAllDoors != null ? opts.stepFreeAllDoors : STAIRS.allDoorsStepFree;
    const pickDoors = (sf && allDoors) ? stepFreeDoors : doorSet;
    // INTEGRATION (acer/w-integrate): the door lane's third argument survives
    // the stairs lane's picker. `avoidStairs` has to reach doorSet as well as
    // the path cost — UT records per DOOR whether it is barrier-free, and
    // without this the toggle could still send a step-free route to a door at
    // the top of a flight. `stepFreeDoors` takes two parameters and ignores the
    // extra one, so the same call serves both pickers.
    const fromDoors = pickDoors(g, from, opts.avoidStairs),
      toDoors = pickDoors(g, to, opts.avoidStairs);
    if (!fromDoors.length || !toDoors.length) return { ok: false, why: 'nodoor' };

    let legs, viaPoi = null;
    if (opts.via != null) {
      const p = g.poi[opts.via];
      const viaAnchor = [{ node: p[2], c: 0, door: null }];
      const a = dijkstra(g, mk(fromDoors, 'from'), viaAnchor, opts.avoidStairs);
      const b = a ? dijkstra(g, [{ node: p[2], c: 0 }], mk(toDoors, 'to'), opts.avoidStairs) : null;
      if (!a || !b) return { ok: false, why: opts.avoidStairs ? 'nostepfree' : 'noroute' };
      a.fromDoor = a.seed ? a.seed.door : fromDoors[0]; a.fromLinkM = a.seed ? a.seed.c : 0;
      b.toDoor = b.target.door; b.toLinkM = b.target.c;
      legs = [a, b];
      viaPoi = { i: opts.via, name: p[4], cat: p[3], hours: p[5], ll: [p[0] * g.q, p[1] * g.q] };
      legs.fromDoor = a.fromDoor; legs.toDoor = b.toDoor;
      legs.fromLinkM = a.fromLinkM; legs.toLinkM = b.toLinkM;
    } else {
      // INTEGRATION (acer/w-integrate): the door lane passes the two ENTRIES so
      // legBetween can refuse to widen an end UT surveyed; the stairs lane
      // passes the anchor picker `mk` so a step-free pass refuses a door whose
      // last stretch crosses a staircase. Both are real and neither replaces
      // the other, so both are passed. The stairs lane's `why` is kept because
      // it is strictly more specific: a step-free request that finds nothing
      // should say so rather than claim there is no route at all.
      const r = legBetween(g, fromDoors, toDoors, opts.avoidStairs, from, to, mk);
      if (!r) return { ok: false, why: opts.avoidStairs ? 'nostepfree' : 'noroute' };
      legs = [r];
      legs.fromDoor = r.fromDoor; legs.toDoor = r.toDoor;
      legs.fromLinkM = r.fromLinkM; legs.toLinkM = r.toLinkM;
    }

    const m = { flat: 0, stair: 0, signals: 0, stairSets: 0 };
    const sets = new Set();
    for (const leg of legs) {
      const s = measure(g, leg);
      // ROUND 8 §R57 — `stairDown` rides along with the other three. It is the
      // one line of this function this lane touched; neither open sibling PR
      // touches the accumulator, and the arithmetic it feeds is §3's.
      m.flat += s.flat; m.stair += s.stair; m.signals += s.signals;
      m.stairDown = (m.stairDown || 0) + s.stairDown;
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

    // ── stairs (§3b) ───────────────────────────────────────────────────────
    // `stair` is the leg list and the honest `clean` flag; `stepFree` is the
    // alternate route, computed HERE rather than waiting for someone to find
    // the toggle, because a person who cannot climb should not have to know
    // the toggle exists to be told the way round. It is produced only when
    // there is something to route around, and never on top of a via stop.
    const out = {
      ok: true, from, to, legs, geom, m, time: t, distM: dist,
      fromDoor: legs.fromDoor, toDoor: legs.toDoor,
      fromLinkM: legs.fromLinkM, toLinkM: legs.toLinkM,
      via: viaPoi, avoidStairs: !!opts.avoidStairs, ms: 0,
      doorsRefused: refused, doorsForced: forced,
    };
    out.stair = stairFacts(g, legs, geom, legs.fromDoor, legs.toDoor, legs.fromLinkM);
    out.stepFree = null;
    if (WAYFIND.stairAlt && opts.stepFree !== false && !opts.avoidStairs &&
        !out.stair.clean) {
      const alt = stepFreeAlternative(g, from, to, out, opts);
      // Never hand back an alternative that did not come out clean. It would
      // be a promise about a staircase, made to the one person who cannot
      // absorb being wrong about it.
      // `breakStepFreeGate` is the watched failure and nothing else — it is
      // the ONLY way this line hands back an unclean alternative, and it
      // ships false. See STAIRS.breakStepFreeGate.
      out.stepFree = (alt && (alt.clean || STAIRS.breakStepFreeGate)) ? alt : null;
      out.stepFreeNone = !out.stepFree;
    }
    const ms = performance.now() - t0;
    out.ms = ms;
    stats.lastRouteMs = ms; stats.routes++;
    return out;
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
  // 5b. THE STAIRS CARD — round 2
  //
  // Round 1 (commit 735e235) put the facts on the route object and wrote the
  // interface patch into docs/walk-stairs.md rather than making it, because
  // four lanes were in this file. This is that patch, made — plus four things
  // the pictures and a 300-route census turned up once there was something to
  // look at. Everything outside this block is marked `// 5b` or `ROUND 2`.
  //
  // THE FOUR COUNTS, BECAUSE THREE OF THEM GET CONFUSED:
  //   189  `highway=steps` ways in data/osm_cache/footways.json.
  //   215  edges in walk_graph.json carrying the STEPS flag. A flight drawn
  //        with a bend is several edges of ONE way; `e.s` is the way id.
  //   168  of those 189 ways have at least one edge on the MAIN COMPONENT.
  //        They are the only staircases any route can ever touch, with the
  //        toggle on or off, because dijkstra() skips every OFF_MAIN edge.
  //        The card said "Avoids 189 mapped staircases"; 21 of those it has
  //        never been able to walk over in either state. It says 168 now.
  //   179  `u:'steps'` polygons in data/ground.geojson. NOT a staircase count:
  //        188 flights buffered to their width and unioned per surface, nine
  //        of which touch a neighbour and merge. Round 1 said the same thing;
  //        docs/walk-stairs.md §1b now reproduces the number to the digit.
  // ══════════════════════════════════════════════════════════════════════════

  // Every judgement the card makes is one line here (CLAUDE.md rule 11). The
  // routing judgements live in WAYFIND with round 1's (`stairAlt`,
  // `stairAltCleanDoors`, `stairAltFarExtraM`, `stairLegGridDeg`,
  // `stairListMax`); these are the ones that only the card and the door choice
  // need.
  const STAIRS = {
    // Under step-free, route to ANY door, not only `role: main`. Measured over
    // 300 random pairs: 124 routes have stairs, and this is worth 21 more of
    // them getting an answer at all (91 -> 112) while halving the typical
    // detour (median 119 m -> 44 m). The justification is not convenience —
    // docs/walk-progress.md (2026-08-23) found UT's own Celebrated_Entrances
    // survey records a separate accessible door where it differs from the
    // front door, and our `main` label came out of a ranking rather than out of
    // anybody standing in front of the building. Refusing the side door
    // because a ranking called it "secondary" is the ranking overruling the
    // person the toggle exists for.
    allDoorsStepFree: true,
    // ...but come back to the front door when the front door is nearly as good.
    // Without this, 89 of 112 offers quietly moved you to a different entrance,
    // most of them to save a handful of metres. The step-free pass therefore
    // runs TWICE — front doors only, and every door — and the front door wins
    // unless the other saves more than this. 89 -> 66 for six metres of median
    // detour. 40 m is about half a minute at the slow end of our own range.
    mainDoorSlackM: 40,
    legListMax: 5,          // rows before the list collapses to "+ n more"
    // ...and fewer on a phone. Measured on a 393x852 viewport: five rows put
    // the card at 825 px of an 852 px screen, over the joystick and the city.
    // He judges this feature off a phone recording, so the phone decides.
    legListMaxNarrow: 3,
    narrowPx: 520,
    atRoundM: 10,           // how coarsely a flight's position down the route reads
    nearBuildingM: 70,      // a code may be named beside a flight this close
    // ── ROUND 3, and every one of these came off a Citymapper screenshot ──
    // docs/walk-stairs.md §R13 has the captured frames and their sha256s. The
    // shape being copied is: WHERE first, what second, WHICH NAMED THING last,
    // with the leg's own size on the right.
    //
    // A leg row names the building rather than its register code, because
    // "near WEL" is staff shorthand and "at Welch Hall" is a place. But 158
    // codes have display names running to 69 characters ("O'Donnell Building
    // for Applied Computational Engineering and Sciences"), and a name that
    // wraps three lines is worse than the code. Measured on the shipped
    // walk_graph.json: at 26 characters, 111 of 158 buildings (70 %) keep
    // their name and the rest fall back to the code — which for exactly those
    // long ones (POB, GDC, ATT) is what people say out loud anyway.
    placeNameMaxCh: 26,
    // A flight's own plan length, on the right of the row where Citymapper
    // puts the leg's minutes. Below this it is a kerb, not a staircase, and
    // printing "3 m" beside "Up the steps" reads as precision we did not earn.
    flightLenMinM: 4,
    // Naming which SIDE of a building a step-free route arrives at. Both
    // guards exist so the sentence is never invented: a building with one
    // door has no "side", and a door sitting on the door-cloud's own centroid
    // has no bearing worth rounding to a compass point.
    doorSideMinDoors: 2,
    doorSideMinM: 6,
    // ── ONE APPROACH IS ONE ROW ──────────────────────────────────────────
    // Found by looking at the frame, which is the only way it was ever going
    // to be found: ART -> MAI printed
    //     at the start   Steps at Art Building and Museum
    //     at the start   Steps at Art Building and Museum
    //     in 20 m        Steps at Art Building and Museum
    // — three rows that read as a rendering bug and used the whole phone
    // list. They are three genuine `highway=steps` ways, and OSM is right:
    // the approach to the Art Building really is three mapped flights. But a
    // leg list states MANOEUVRES, not ways. Citymapper's rows are "in 25 m /
    // Turn right onto / Goldsmith's Row" — one row is one thing you do.
    //
    // So consecutive flights at the same building, starting within this of
    // each other, become ONE row that says how many. `sets`, `ways` and the
    // count in the headline are untouched and still come off the way ids, so
    // the number of staircases we report is exactly what the data holds —
    // only the row count changes.
    mergeGapM: 40,
    // Only for the watched failure: makes the step-free filter leaky so the
    // verification in stepFreeRoute() has something to catch. Never true
    // shipped. With it on, 101 of 124 offers are withheld and none leak.
    breakStepFree: false,
    // ROUND 3 — and the OTHER half of the watched failure, because round 2's
    // was only half of one. `breakStepFree` alone proves the gate WORKS: the
    // filter leaks, the verification catches every leak, and the census still
    // reads 0 dirty (measured: 91 offers drop to 6, none of them dirty). That
    // is a green run, so it never demonstrated that the census's own
    // "verified clean" assertion can go red — an assertion nobody has watched
    // fail is an assertion nobody has tested.
    //
    // This one removes the verification itself. With BOTH on, the leak
    // reaches the answer and the census must come back RED. Never true
    // shipped, and the two are separate switches on purpose: one breaks the
    // routing, the other breaks the guard, and they fail differently.
    breakStepFreeGate: false,
  };
  WAYFIND.stairs = STAIRS;

  // COPY. Same rule as SAY above — docs/walk/what-we-can-honestly-say.md is
  // where a new sentence gets argued for, not here. Kept as its own block only
  // because four lanes are editing this file; docs/walk-stairs.md §6b says to
  // fold it into SAY once they land.
  //
  // A quantity is one word: without `nb` the step-free button on a 393 px phone
  // broke as "Step-free: 14–19 min · 1.2 / km", which reads as a defect.
  const nb = (s) => String(s).replace(/ /g, ' ');
  const SAY_S = {
    listTitle: 'Stairs on this route',
    up: 'Up the steps',
    down: 'Down the steps',
    unknown: 'Steps',
    // A position along a route is not a precision claim: it rounds to
    // STAIRS.atRoundM and collapses to "at the start" below one rounding step,
    // because "8.6 m in" reads as a survey and is worth nothing to a walker.
    //
    // ROUND 3 — PREPOSITION FIRST, because that is what the bar does. Two
    // independently captured Citymapper walking rows (§R13) both lead with
    // `in 25 m` / `in 85 m`; the spoken form in the same screenshot is
    // "In 25m, turn right onto Goldsmith's Row". Ours read `620 m in`, which
    // is the same fact in the order a spreadsheet would print it.
    //
    // AND IN METRES ALL THE WAY OUT, not fmtDist. fmtDist is the ROUTE's
    // formatter and collapses anything over 950 m to one decimal of a
    // kilometre, which on ADH -> COM printed two different flights 20 m apart
    // as `in 1.1 km` and `in 1.1 km` — the same row twice, on screen, in the
    // frame. A position along a walk needs the resolution the rounding step
    // already promises, so it stays in metres and gets a thousands separator.
    at: (m) => m < STAIRS.atRoundM * 1.5 ? 'at the start'
      : 'in ' + String(Math.round(m / STAIRS.atRoundM) * STAIRS.atRoundM)
        .replace(/\B(?=(\d{3})+(?!\d))/g, ',') + ' m',
    // A row that merged several mapped flights at one building says so. It is
    // a count of `highway=steps` WAYS, which is a thing OSM records, and never
    // a count of steps or of landings, which are things it does not.
    sets: (n) => n + ' sets of steps',
    // The named thing the flight is at. Citymapper's third line is a NAME
    // ("Goldsmith's Row", "D - Republic Plaza"), never an internal id.
    atPlace: (name) => 'at ' + name,
    // Where Citymapper prints the leg's minutes. We print the flight's plan
    // length instead, on purpose: at 0.5 m/s every flight on this campus
    // rounds to "1 min", and this file's own honesty rule (§3 of the audit)
    // forbids collapsing a range to one number. The metre is measured; the
    // minute would be theatre.
    flightLen: (m) => fmtDist(m),
    more: (n) => '+ ' + n + ' more',
    dirNote: 'Up or down is only mapped on some of them.',
    // The unmapped door leg crossing a flight — round 1 §3b. This is the one
    // staircase the route cannot route around, so it is named separately.
    legCross: (n) => n === 1
      ? 'The unmapped stretch to the door crosses a staircase.'
      : 'The unmapped stretches to the doors cross ' + n + ' staircases.',
    offerBtn: (lo, hi, dist) => 'Step-free: ' + nb(lo + '–' + hi + ' min') + ' · ' + nb(dist),
    // `n` is EVERY staircase the alternative gets you away from — the ones
    // the router climbs plus the ones under our own straight door legs. The
    // n===0 arm should be unreachable (an alternative is only offered when
    // the direct walk has stairs on it) and exists because the version that
    // did not have it printed "Avoids all 0 sets" in a screenshot.
    offerCost: (extra, n) => 'Avoids ' +
      (n <= 0 ? 'the stairs' : n === 1 ? 'the staircase' : n === 2 ? 'both sets' : 'all ' + n + ' sets') +
      (extra > 0 ? ' · ' + fmtDist(extra) + ' further' : ' · no further to walk'),
    // ROUND 3 — NAME THE ENTRANCE. Citymapper's step-free route detail does
    // not say "a different entrance"; it opens an inset row labelled
    // "Best Step-Free Entrance" and names the door — "D - Republic Plaza"
    // (§R13, sf3). We have no entrance letters, but we do know which building
    // and which side of it, so we say that.
    //
    // We deliberately do NOT copy the words "Step-Free Entrance". What this
    // route verified is that nothing between the two doors crosses a mapped
    // staircase — including the two straight lines we drew ourselves. It did
    // not verify the door. `doorForced` below is the same distinction and it
    // is the one this feature must not blur.
    offerDoorAt: (w) => 'Ends at ' +
      (w.side ? 'the ' + w.side + ' side of ' : '') + w.name + '.',
    offerDoor: 'It uses a different entrance.',
    offerDoorStart: 'It also starts from a different entrance.',
    offerNone: 'No step-free route we can find between these two.',
    backBtn: (lo, hi, dist) => 'With stairs: ' + nb(lo + '–' + hi + ' min') + ' · ' + nb(dist),
    // The headline already says "No stairs on this route", so this line must
    // not say it again — it says what the step-free answer COST instead, which
    // is the fact the headline cannot carry.
    isStepFree: (extra) => extra > 0
      ? 'Step-free · ' + fmtDist(extra) + ' further than the route with stairs'
      : 'Step-free · no further to walk than the route with stairs',
    isStepFreePlain: 'Step-free',
    // Deliberately an admission and not an assertion. cleanAnchors() had to
    // keep an anchor whose door leg crosses a staircase because the door had
    // no other; which side of the flight the door is on, the data does not say.
    doorForced: "We can't tell whether the last few metres into the door involve steps.",
  };

  // ── the count, READ off the graph rather than typed into a string ─────────
  //
  // A staircase the router can never enter is not a staircase the toggle
  // avoids. `swEdges` counts every steps way in the file (189); this counts the
  // ones with an edge dijkstra() will actually relax (168).
  let _routableCache = null;
  function routableStairways(g) {
    if (_routableCache && _routableCache.g === g) return _routableCache.n;
    const s = new Set();
    for (let i = 0; i < g.E; i++) {
      if ((g.F[i] & F_STEPS) && !(g.F[i] & F_OFFMAIN)) s.add(g.S[i]);
    }
    _routableCache = { g, n: s.size };
    return s.size;
  }

  // ── where a flight IS, in words ──────────────────────────────────────────
  // door index -> the register code it belongs to, so a flight can be placed by
  // the building beside it rather than by a bare distance down the route.
  // 215 of 216 flights in the census got a name this way.
  let _doorCodeCache = null;
  function doorCode(g) {
    if (_doorCodeCache && _doorCodeCache.g === g) return _doorCodeCache.m;
    const m = new Map();
    for (const code in g.code) for (const di of g.code[code]) if (!m.has(di)) m.set(di, code);
    _doorCodeCache = { g, m };
    return m;
  }
  function nearestCode(g, ll) {
    if (!ll) return null;
    let best = null, bd = STAIRS.nearBuildingM;
    for (const [di, code] of doorCode(g)) {
      const d = metresBetween(ll, doorLL(g, di));
      if (d < bd) { bd = d; best = code; }
    }
    return best;
  }

  // ── ROUND 3: a code is not a name ────────────────────────────────────────
  // buildIndex() already resolved every code to the string the search list
  // shows ("Welch Hall", "UT Tower"), so the leg list says that instead of
  // "WEL". Falls back to the code when the name is too long to sit on a row —
  // see STAIRS.placeNameMaxCh for the measurement behind the number — and
  // when the register has nothing better than the code anyway (3 of 158).
  function displayName(g, code) {
    if (!code) return null;
    const rec = g.byCode && g.byCode.get(code);
    return (rec && rec.display) || code;
  }
  // The LEG ROW's name, capped — a row is one line of a five-row list.
  function placeName(g, code) {
    const d = displayName(g, code);
    if (!d) return null;
    return d.length <= STAIRS.placeNameMaxCh ? d : code;
  }

  const COMPASS8 = ['north', 'north-east', 'east', 'south-east',
    'south', 'south-west', 'west', 'north-west'];

  /**
   * ROUND 3. Which building a door belongs to, and which side of it — the
   * fact Citymapper's step-free detail carries as "D - Republic Plaza".
   *
   * The side is a bearing from the CENTROID OF THAT BUILDING'S OWN DOORS, not
   * from a footprint we do not have here, so it is "which of this building's
   * doors is this" rather than a survey claim. It is withheld entirely when
   * the building has one door (nothing to be a side of) or when the door sits
   * within STAIRS.doorSideMinM of the centroid, where the bearing is noise.
   */
  function doorWhere(g, di) {
    if (di == null) return null;
    const code = doorCode(g).get(di);
    // The FULL name here, not the leg row's capped one. This sentence owns a
    // whole line, and the card was reading "Jackson Geological Sciences
    // Building" in the headline and "Ends at the north side of JGB" three
    // lines below it — the same building under two names, in one frame.
    const name = displayName(g, code);
    if (!name) return null;
    const list = code ? g.code[code] : null;
    let side = null;
    if (list && list.length >= STAIRS.doorSideMinDoors) {
      let sx = 0, sy = 0;
      for (const j of list) { const ll = doorLL(g, j); sx += ll[0]; sy += ll[1]; }
      const c = [sx / list.length, sy / list.length], d = doorLL(g, di);
      if (metresBetween(c, d) >= STAIRS.doorSideMinM) {
        let b = bearing(c, d);
        if (b < 0) b += 360;
        side = COMPASS8[Math.round(b / 45) % 8];
      }
    }
    return { code: code || null, name: name, side: side };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // THE ONE STEP-FREE IMPLEMENTATION
  //
  // computeRoute() delegates here whenever `avoidStairs` arrives without an
  // explicit profile, and stepFreeAlternative() calls it for the offer. That is
  // the whole point: the offer and the toggle cannot be different routes.
  // ══════════════════════════════════════════════════════════════════════════

  // ── ROUND 6. UT'S OWN BARRIER-FREE ENTRANCE SURVEY ───────────────────────
  //
  // Every row of `Celebrated_Entrances_view` that publishes coordinates AND
  // names a building `walk_graph.json` has, as `[code, lon, lat, barrierFree]`.
  // 66 rows over 50 buildings; 29 of UT's 98 rows carry null coordinates and
  // cannot be placed, 2 name buildings the graph does not have, 1 is an exact
  // duplicate. Source, sha256 and the re-derivation are docs/walk-stairs.md
  // §R38 — this is a TRANSCRIPTION, and the doc is where it is argued for.
  //
  // It is here rather than in a data file for the same reason round 5's radius
  // is: the client cannot fetch it, no bake this lane owns writes it, and a
  // number nobody can see is worse than a number in the open. The honest
  // permanent home is a `barrierFree` flag per door, published by whoever owns
  // `scripts/bake_entrances.py` — written up in §R38, not made here.
  //
  // NOTHING READS THIS OUTSIDE THE STEP-FREE PROFILE. It cannot change an
  // ordinary walk by construction.
  const UT_ENTRANCES = [
    ['ASE',-97.737604,30.291228,1], ['BAT',-97.738677,30.284796,1],
    ['BEN',-97.738771,30.283956,1], ['BIO',-97.740083,30.287254,1],
    ['BME',-97.738752,30.289431,1], ['BRB',-97.737006,30.285259,1],
    ['BUR',-97.738492,30.288627,1], ['BWY',-97.738079,30.290797,1],
    ['CCJ',-97.730652,30.287988,1], ['CCJ',-97.730635,30.288093,0],
    ['CMB',-97.74101,30.289279,1], ['CPE',-97.736153,30.289992,1],
    ['DMC',-97.740528,30.290092,1], ['ECJ',-97.735751,30.289045,0],
    ['ECJ',-97.735494,30.288962,1], ['EER',-97.735633,30.288143,1],
    ['EPS',-97.736945,30.285801,1], ['EPS',-97.736684,30.285686,0],
    ['ETC',-97.735587,30.289903,1], ['FAC',-97.740629,30.286422,1],
    ['FAC',-97.7401,30.286257,1], ['FNT',-97.737753,30.287855,1],
    ['GAR',-97.738772,30.28506,1], ['GAR',-97.73854,30.285101,1],
    ['GDC',-97.736679,30.285996,1], ['GEA',-97.739222,30.287691,0],
    ['GEA',-97.738956,30.287668,1], ['GOL',-97.741276,30.285697,1],
    ['GWB',-97.740069,30.287863,1], ['HRH',-97.740424,30.284081,1],
    ['HSM',-97.740945,30.288992,1], ['JES',-97.737014,30.283089,1],
    ['JGB',-97.735853,30.285757,1], ['JHH',-97.732079,30.278383,1],
    ['JHH',-97.731978,30.278357,1], ['JON',-97.731335,30.288508,1],
    ['MAI',-97.739719,30.286186,1], ['MBB',-97.737132,30.28859,1],
    ['MEZ',-97.739144,30.284308,1], ['MEZ',-97.738739,30.284377,1],
    ['NHB',-97.737621,30.287738,1], ['PAI',-97.738471,30.287011,1],
    ['PAR',-97.740252,30.285003,1], ['PAR',-97.73986,30.28488,0],
    ['PAT',-97.736524,30.28817,1], ['PCL',-97.737865,30.282994,1],
    ['PHR',-97.738917,30.288355,1], ['PHR',-97.738815,30.288104,1],
    ['PMA',-97.736342,30.288903,1], ['PMA',-97.736006,30.288912,1],
    ['RLP',-97.735365,30.285229,1], ['RLP',-97.734889,30.285002,1],
    ['SEA',-97.737745,30.289739,1], ['SUT',-97.740788,30.285065,1],
    ['SZB',-97.738621,30.281952,1], ['UA9',-97.738825,30.290245,1],
    ['UTA',-97.743022,30.279461,1], ['UTA',-97.74263,30.279248,1],
    ['UTC',-97.738594,30.283339,1], ['WAG',-97.737505,30.285273,1],
    ['WCH',-97.738658,30.28613,1], ['WCH',-97.738138,30.286121,0],
    ['WIN',-97.734505,30.285631,1], ['WMB',-97.740594,30.285617,1],
    ['WWH',-97.741895,30.289318,1], ['WWH',-97.741842,30.289196,0],
  ];

  /**
   * ROUND 6 — the door of `code` that UT publishes as barrier-free, or -1.
   *
   * The match is deterministic and deliberately fussy, because the failure
   * mode is sending somebody to the wrong door with more confidence than
   * before: the nearest survey row must be inside
   * `stairBarrierFreeMatchM`, and the nearest row of the OPPOSITE verdict
   * must be at least `stairBarrierFreeMarginX` times farther. A building that
   * cannot pass both gets -1 and this whole pass never fires for it — which
   * is why a re-bake that renumbers or moves doors degrades to round 5's
   * behaviour rather than to a wrong answer.
   *
   * Memoised on the decoded graph, so the scan is one pass per building per
   * page load.
   */
  function barrierFreeDoor(g, code) { return utDoor(g, code, 1); }

  /**
   * ROUND 8a — and the SAME join run for the other verdict, which is the
   * whole point: the two answers cannot come from different rules, different
   * radii or different margins, because they come from one function. `want`
   * is 1 for the doors UT publishes as barrier-free and 0 for the doors it
   * publishes as not. A door that fails the margin gets NO verdict either
   * way, exactly as it did in round 6.
   */
  function barrieredDoor(g, code) { return utDoor(g, code, 0); }

  function utDoor(g, code, want) {
    if (!g._bfDoor) {
      const rows = new Map();
      for (const r of UT_ENTRANCES) {
        if (!rows.has(r[0])) rows.set(r[0], []);
        rows.get(r[0]).push(r);
      }
      g._bfRows = rows;
      g._bfDoor = new Map();
    }
    const key = want + ':' + code;
    if (g._bfDoor.has(key)) return g._bfDoor.get(key);
    const rows = g._bfRows.get(code), entry = g.code && g.code[code];
    let best = -1;
    if (rows && entry) {
      const M = WAYFIND.stairBarrierFreeMatchM, X = WAYFIND.stairBarrierFreeMarginX;
      let bestM = Infinity;
      for (const di of entry) {
        const dll2 = doorLL(g, di);
        let near = null, opp = Infinity;
        for (const r of rows) {
          const m = metresBetween(dll2, [r[1], r[2]]);
          if (!near || m < near.m) near = { m, bf: r[3] };
        }
        for (const r of rows) {
          const m = metresBetween(dll2, [r[1], r[2]]);
          if (r[3] !== near.bf && m < opp) opp = m;
        }
        if (near.bf !== want || near.m > M || opp < near.m * X) continue;
        if (near.m < bestM) { bestM = near.m; best = di; }
      }
    }
    g._bfDoor.set(key, best);
    return best;
  }

  // Which ENTRIES this pass is currently restricting to their barrier-free
  // door. Set and cleared in a `finally` inside one synchronous call, exactly
  // as round 5's `stairWidePass` is, and for the same reason: computeRoute()
  // is another lane's function this round, so the signal cannot be an option
  // travelling down through it. It should become a plain option the moment
  // that lane lands. Nothing in this file is re-entrant.
  let stairBFOnly = null;

  /** Every door with an anchor, not only `role: main`. See STAIRS above. */
  function stepFreeDoors(g, entry) {
    const all = entry.doors.filter(di => g.doors[di][2] && g.doors[di][2].length);
    // ROUND 6 — and when this pass is running for THIS end, only the door UT
    // publishes as barrier-free. `all` is returned untouched when the entry is
    // not in the set, which is every call the first three passes make.
    if (stairBFOnly && stairBFOnly.has(entry)) {
      const want = stairBFOnly.get(entry);
      // ROUND 8 — a LIST is allowed as well as a single door, so the same
      // one-line filter serves "only UT's barrier-free door" (round 6, one
      // door), "any door but the one UT convicts" (§8a) and "the door this
      // walk already chose" (§8b). A number behaves exactly as it did.
      const only = all.filter(di => Array.isArray(want) ? want.indexOf(di) >= 0 : di === want);
      if (only.length) return only;
    }
    return all;
  }

  /**
   * Front doors first, every door second, and the front door wins unless the
   * other saves more than STAIRS.mainDoorSlackM. Two Dijkstras on a route that
   * has stairs; the answer is then VERIFIED before anyone is allowed to call it
   * step-free.
   *
   * `edgeCost` prices a stepped edge at Infinity under this profile and
   * cleanAnchors() refuses a door leg that crosses a flight, so a dirty result
   * is impossible — which is exactly why the check is code and not a comment.
   * The offer is WITHHELD if it fires. A wrong "step-free" badge leaves
   * somebody at the bottom of a flight, and no route at all is a better
   * failure than that. Watch it fire with `WAYFIND.stairs.breakStepFree = true`.
   */
  function stepFreeRoute(g, from, to, opts) {
    const via = (opts && opts.via != null) ? opts.via : null;
    const one = (all) => computeRoute(g, from, to,
      { avoidStairs: true, stepFree: true, stepFreeAllDoors: all, via });
    const front = one(false);
    const any = STAIRS.allDoorsStepFree ? one(true) : { ok: false };
    let r = null;
    if (front.ok && (!any.ok || front.distM - any.distM <= STAIRS.mainDoorSlackM)) r = front;
    else if (any.ok) r = any;
    // ── ROUND 5. THE THIRD PASS, AND ONLY IF THE FIRST TWO FAILED ──────────
    // Everything above is untouched: a route that works today takes the
    // identical path through this function and never reaches this line. This
    // is the last resort before the feature tells somebody who cannot climb
    // stairs that there is no way to get there — a sentence that was wrong 5
    // times in 14 and that nothing had ever checked. See WAYFIND.stairAltWide
    // and docs/walk-stairs.md §R28.
    if (WAYFIND.stairAltWide && (!r || !r.stair || !r.stair.clean)) {
      let wide = null;
      stairWidePass = true;
      try { wide = one(true); } finally { stairWidePass = false; }
      if (wide && wide.ok && wide.stair && wide.stair.clean) {
        wide.doorsWide = true;
        r = wide;
      }
    }
    // ── ROUND 6. THE FOURTH PASS: THE DOOR AT THE END OF IT ────────────────
    // Everything above is untouched. This runs only on a route that ALREADY
    // has a clean step-free answer, and only at an end where UT names a
    // barrier-free door we are not already using. It can never turn an offer
    // into a refusal: `r` is only replaced by a candidate that is itself ok,
    // clean, and within STAIRS' own slack. See WAYFIND.stairBarrierFree and
    // docs/walk-stairs.md §R38.
    if (WAYFIND.stairBarrierFree && r && r.ok && r.stair && r.stair.clean) {
      const wantFrom = barrierFreeDoor(g, from.code), wantTo = barrierFreeDoor(g, to.code);
      // A door the bake never snapped to the network cannot be insisted on:
      // stepFreeDoors() would find nothing to keep, fall back to every door,
      // and hand back the SAME walk — which would then be recorded as a move
      // that never happened. Checked here rather than there so the restriction
      // stays a filter and never a silent no-op.
      const usable = (entry, di) => di >= 0 && entry.doors.indexOf(di) >= 0 &&
        g.doors[di][2] && g.doors[di][2].length;
      const fix = [];
      if (usable(from, wantFrom) && r.fromDoor !== wantFrom) fix.push([from, wantFrom]);
      if (usable(to, wantTo) && r.toDoor !== wantTo) fix.push([to, wantTo]);
      if (fix.length) {
        // Both ends together first — it is the cheapest and the usual answer.
        // Then each end alone, because one unreachable barrier-free door must
        // not cost the walker the other end's.
        const tries = fix.length === 2 ? [fix, [fix[0]], [fix[1]]] : [fix];
        let bestBF = null;
        for (const set of tries) {
          let cand = null;
          stairBFOnly = new Map(set);
          try { cand = one(true); } finally { stairBFOnly = null; }
          if (!cand || !cand.ok || !cand.stair || !cand.stair.clean) continue;
          if (cand.distM - r.distM > WAYFIND.stairBarrierFreeSlackM) continue;
          // More ends moved wins; among equals, the shorter walk wins.
          const moved = set.length;
          if (!bestBF || moved > bestBF.moved ||
              (moved === bestBF.moved && cand.distM < bestBF.route.distM)) {
            bestBF = { moved, route: cand };
          }
          if (moved === fix.length) break;   // nothing better is available
        }
        if (bestBF) { bestBF.route.doorsBF = bestBF.moved; r = bestBF.route; }
      }
    }
    // ── ROUND 8a. THE DOOR UT PUBLISHES AS **NOT** BARRIER-FREE ────────────
    // Round 6 spent the Y rows of UT's table and left the N rows on the floor.
    // An N row is a stronger statement than a missing Y row: it is UT saying,
    // in prose, that this entrance is up a flight of steps. Two of our doors
    // carry it, and neither building has a Y door for round 6's pass to move
    // to — so round 6 never fires there and the walk is handed over with a
    // clean tick.
    //
    // Two things happen here and only the first can move anybody: leave by a
    // door UT has not convicted, if the building has one; and where it has
    // not, SAY SO. `r` is only ever replaced by a candidate that is itself
    // ok, clean and within slack, so this cannot turn an offer into a
    // refusal, and it cannot undo round 6's choice because a door UT
    // publishes as barrier-free is by construction never one it convicts.
    if (WAYFIND.stairBarrierDoor && r && r.ok && r.stair && r.stair.clean) {
      const ends = [{ entry: from, which: 'start' }, { entry: to, which: 'end' }];
      const convicted = (route) => ends
        .map((e, i) => ({ ...e, door: i === 0 ? route.fromDoor : route.toDoor }))
        .filter(e => barrieredDoor(g, e.entry.code) === e.door);
      const bad = convicted(r);
      if (bad.length) {
        // Every OTHER door of that building the router could actually use.
        // A building whose only linked door is the convicted one has no
        // alternative to find, and inventing one is not this file's job.
        const alt = [];
        for (const e of bad) {
          const others = e.entry.doors.filter(x => x !== e.door &&
            g.doors[x][2] && g.doors[x][2].length);
          if (others.length) alt.push([e.entry, others]);
        }
        if (alt.length) {
          // Both ends together first, then each alone — one end with no way
          // off its convicted door must not cost the other end its move.
          const tries = alt.length === 2 ? [alt, [alt[0]], [alt[1]]] : [alt];
          let bestOff = null;
          for (const set of tries) {
            // BAKED ANCHORS FIRST, THEN ROUND 5'S WIDENED ONES, and the second
            // half is not optional: at the one building on this campus where
            // this pass has anywhere to go, the door it wants — Gearing Hall's
            // 387 — has no baked anchor a step-free walk can use at all. Round
            // 5 already ships that rescue and already bounds its through-wall
            // risk (§R31's matrix, 0.00 m at the shipped radius and cap); this
            // is the same last resort for the same reason, one door later.
            let cand = null, wide = false;
            for (const w of [false, true]) {
              stairBFOnly = new Map(set);
              stairWidePass = w;
              try { cand = one(true); } finally { stairWidePass = false; stairBFOnly = null; }
              if (cand && cand.ok && cand.stair && cand.stair.clean) { wide = w; break; }
              cand = null;
              if (!WAYFIND.stairAltWide) break;
            }
            if (!cand) continue;
            if (cand.distM - r.distM > WAYFIND.stairBarrierDoorSlackM) continue;
            const off = bad.length - convicted(cand).length;
            if (off <= 0) continue;
            if (!bestOff || off > bestOff.off ||
                (off === bestOff.off && cand.distM < bestOff.route.distM)) {
              bestOff = { off, route: cand, wide };
            }
            if (off === bad.length) break;
          }
          if (bestOff) {
            bestOff.route.doorsOffBarriered = bestOff.off;
            if (bestOff.wide) bestOff.route.doorsWide = true;
            r = bestOff.route;
          }
        }
        // Recomputed against the route actually being returned, so this is a
        // statement about the answer and not about an earlier draft of it.
        const left = convicted(r);
        if (left.length) {
          r.doorBarriered = left.map(e => ({
            door: e.door, code: e.entry.code, end: e.which,
            only: e.entry.doors.filter(x => g.doors[x][2] && g.doors[x][2].length).length === 1,
          }));
        }
      }
      // AND THE SENTENCE CITYMAPPER'S FRAME HAS AND OURS NEVER DID. sf3 labels
      // the door `Best Step-Free Entrance`; docs/walk-stairs.md §R17 answered
      // "we do not — we verified the walk, not the door", and that was the
      // right answer for three rounds. It is not the right answer at a door UT
      // has stood in front of and published a verdict for. Same join, positive
      // verdict, no route change: this only NAMES what the walk already chose.
      const verified = [];
      for (const e of [{ entry: from, which: 'start', door: r.fromDoor },
                       { entry: to, which: 'end', door: r.toDoor }]) {
        if (barrierFreeDoor(g, e.entry.code) === e.door) {
          verified.push({ door: e.door, code: e.entry.code, end: e.which });
        }
      }
      if (verified.length) r.doorBarrierFree = verified;
    }
    // ── ROUND 8b. AND THE WALK WAS LONGER THAN IT HAD TO BE ────────────────
    // Round 5's widened anchors only ever run as a rescue. When the ordinary
    // passes succeed, the walk they found is the shortest one reachable from
    // at most three BAKED anchors per door — which is not the same thing as
    // the shortest step-free walk between those two doors, and the difference
    // is metres a person has to push.
    //
    // Pinned to the doors already chosen, so every door decision above —
    // front-door slack, round 5's rescue, round 6's barrier-free door,
    // §8a's move off a convicted one — survives this pass by construction.
    // Accepted only if it is itself clean and shorter by more than the
    // margin, so it can only ever subtract metres.
    if (WAYFIND.stairAltShortcut && WAYFIND.stairAltWide &&
        r && r.ok && r.stair && r.stair.clean) {
      let cand = null;
      stairBFOnly = new Map([[from, [r.fromDoor]], [to, [r.toDoor]]]);
      stairWidePass = true;
      try { cand = one(true); } finally { stairWidePass = false; stairBFOnly = null; }
      if (cand && cand.ok && cand.stair && cand.stair.clean &&
          cand.fromDoor === r.fromDoor && cand.toDoor === r.toDoor &&
          r.distM - cand.distM > WAYFIND.stairAltShortcutMinM) {
        cand.shortcutM = r.distM - cand.distM;
        cand.doorsBF = r.doorsBF;
        cand.doorsOffBarriered = r.doorsOffBarriered;
        cand.doorBarriered = r.doorBarriered;
        cand.doorBarrierFree = r.doorBarrierFree;
        r = cand;
      }
    }
    if (!r) return { ok: false, why: (front.why || (any && any.why) || 'nostepfree') };
    if (!STAIRS.breakStepFreeGate && (!r.stair || !r.stair.clean)) {
      return { ok: false, why: 'assert', stair: r.stair };
    }
    return { ok: true, route: r };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // THE CARD SECTION. One call from renderPill(); everything it draws is here.
  //
  // THE STYLESHEET. These rules belong in style.css beside the rest of `.wf-*`
  // and they are quoted verbatim in docs/walk-stairs.md §6a for whoever owns
  // it. They are injected from here for one round only, because style.css is
  // another lane's file this round and a rule that lands in the wrong file is
  // worse than a rule that announces where it should have gone.
  // ══════════════════════════════════════════════════════════════════════════
  const STAIRS_CSS = `
.wf-sthead{margin:11px 0 4px;font-weight:600;letter-spacing:.02em}
.wf-steps{margin:0 0 6px;border-left:2px solid rgba(255,190,90,.28);padding-left:9px}
/* ROUND 3 — the row is Citymapper's, in two lines instead of three.
   Line 1  WHERE it is, and the leg's own size on the right.
   Line 2  WHAT you do, and the NAMED place it happens at.
   Citymapper splits the verb and the name onto separate lines; it owns the
   whole screen and this card is 233 px of text over a 3D city, so the two are
   merged. The hierarchy is kept: position and place are the weighted things,
   the verb is the small dim one. Frames in docs/walk-stairs.md §R13. */
.wf-step{padding:3.5px 0;font-size:11.5px}
.wf-step-l1{display:flex;align-items:baseline;gap:8px}
.wf-step-l2{padding-left:19px;font-size:10.5px;line-height:1.4;opacity:.72}
.wf-step-i{width:11px;flex:none;text-align:center;color:#ffcf7a;font-weight:700}
.wf-step-at{flex:0 1 auto;font-weight:600;letter-spacing:.01em;white-space:nowrap}
.wf-step-w{flex:none;margin-left:auto;font-size:10.5px;opacity:.45;letter-spacing:.01em}
.wf-step-p{font-weight:600;opacity:1}
.wf-step.wf-dim{opacity:.5;font-size:10.5px;padding-left:19px}
.wf-stepfree{color:#a8e6b0;font-weight:600}
.wf-nostepfree{color:#ffd79a;font-weight:600}
.wf-alt{display:block;width:100%;margin-top:8px;text-align:center}
`;
  function ensureStairsCss() {
    if (document.getElementById('wf-stairs-css')) return;
    const s = document.createElement('style');
    s.id = 'wf-stairs-css';
    s.textContent = STAIRS_CSS;
    document.head.appendChild(s);
  }

  function stairsSection(card, r) {
    if (!r || !r.ok || !r.stair) return;
    ensureStairsCss();
    const st = r.stair;

    // ── already on the step-free answer ────────────────────────────────────
    if (r.avoidStairs) {
      // The way back is priced too, so the button says what it costs rather
      // than "turn the filter off" — and the same figure prices the step-free
      // answer you are looking at. One extra route, only while the card is
      // open, because renderPill has already returned if it is not.
      const back = computeRoute(G, r.from, r.to, { via: state.via, stepFree: false });
      card.appendChild(h('div', 'wf-c wf-stepfree', '✓ ' + (back.ok
        ? SAY_S.isStepFree(Math.round(r.distM - back.distM)) : SAY_S.isStepFreePlain)));
      if (r.doorsForced) card.appendChild(h('div', 'wf-c wf-dim', SAY_S.doorForced));
      if (back.ok) {
        const b = h('button', 'wf-act wf-alt',
          SAY_S.backBtn(back.time.lo, back.time.hi, fmtDist(back.distM)));
        b.addEventListener('click', (ev) => { ev.stopPropagation(); state.avoid = false; run(); });
        card.appendChild(b);
      }
      return;
    }

    if (st.clean) return;

    // ── the leg list ───────────────────────────────────────────────────────
    const rows = st.rows || st.list;
    if (rows.length) {
      card.appendChild(h('div', 'wf-c wf-sthead', SAY_S.listTitle));
      const list = h('div', 'wf-steps');
      const cap = (window.innerWidth <= STAIRS.narrowPx) ? STAIRS.legListMaxNarrow : STAIRS.legListMax;
      const show = Math.min(rows.length, cap);
      let anyUnknown = false;
      for (let i = 0; i < rows.length; i++) if (!rows[i].dir) anyUnknown = true;
      for (let i = 0; i < show; i++) {
        const s = rows[i];
        const row = h('div', 'wf-step');
        // line 1 — where, and how big
        const l1 = h('div', 'wf-step-l1');
        l1.appendChild(h('span', 'wf-step-i', s.dir === 'up' ? '↑' : s.dir === 'down' ? '↓' : '•'));
        l1.appendChild(h('span', 'wf-step-at', nb(SAY_S.at(s.atM))));
        if (s.m >= STAIRS.flightLenMinM) {
          l1.appendChild(h('span', 'wf-step-w', nb(SAY_S.flightLen(s.m))));
        }
        row.appendChild(l1);
        // line 2 — what you do, and the named place it happens at
        const l2 = h('div', 'wf-step-l2');
        l2.appendChild(document.createTextNode(
          s.flights > 1 ? SAY_S.sets(s.flights)
            : s.dir === 'up' ? SAY_S.up : s.dir === 'down' ? SAY_S.down : SAY_S.unknown));
        const place = placeName(G, s.code);
        if (place) {
          l2.appendChild(document.createTextNode(' '));
          l2.appendChild(h('span', 'wf-step-p', SAY_S.atPlace(place)));
        }
        row.appendChild(l2);
        list.appendChild(row);
      }
      // ROUND 3 — `rows` is grouped from the WHOLE leg list before any cap, so
      // the remainder is now a plain subtraction and cannot disagree with the
      // headline the way round 2's had to be reconciled against `sets`.
      const totalRows = st.rowCount != null ? st.rowCount : rows.length;
      if (totalRows > show) list.appendChild(h('div', 'wf-step wf-dim', SAY_S.more(totalRows - show)));
      card.appendChild(list);
      if (anyUnknown) card.appendChild(h('div', 'wf-c wf-dim', SAY_S.dirNote));
    }
    // A staircase the route does not walk over but our own straight line to the
    // door crosses. Round 1 measured 11 of 140 "step-free" routes doing exactly
    // this; it is a different fact from the list above and gets its own line.
    if (st.legWayCount) card.appendChild(h('div', 'wf-c wf-dim', SAY_S.legCross(st.legWayCount)));

    // ── the alternative ────────────────────────────────────────────────────
    const sf = r.stepFree;
    if (!sf) {
      // NOT dim. For the one person the toggle exists for this is the most
      // important line on the card, and a footnote is not where it goes.
      if (r.stepFreeNone) card.appendChild(h('div', 'wf-c wf-nostepfree', SAY_S.offerNone));
      return;
    }
    const btn = h('button', 'wf-act wf-alt', SAY_S.offerBtn(sf.time.lo, sf.time.hi, fmtDist(sf.distM)));
    btn.addEventListener('click', (ev) => { ev.stopPropagation(); state.avoid = true; run(); });
    card.appendChild(btn);
    card.appendChild(h('div', 'wf-c wf-dim',
      // ROUND 4 — `st.sets` counts only the staircases the ROUTER climbs. A
      // staircase under one of our own straight door legs is the other kind
      // and the alternative avoids it too, so it counts here. Reading only
      // the climbed half printed "Avoids all 0 sets" on WEL>AND, where the
      // only staircase on the walk was under the last stretch. Found in a
      // screenshot; every number in the census was green.
      SAY_S.offerCost(Math.max(0, Math.round(sf.extraM)), st.sets + st.legWayCount)));
    // ROUND 3 — name it. `toDoorWhere` is null when the arrival door did not
    // move, or when the graph cannot name the building it belongs to, and the
    // round-1 sentence is still what gets said in both of those cases.
    if (sf.toDoorWhere) {
      card.appendChild(h('div', 'wf-c wf-dim', SAY_S.offerDoorAt(sf.toDoorWhere)));
      if (sf.fromDoorChanged) card.appendChild(h('div', 'wf-c wf-dim', SAY_S.offerDoorStart));
    } else if (sf.doorChanged) {
      card.appendChild(h('div', 'wf-c wf-dim', SAY_S.offerDoor));
    }
    if (sf.doorsForced) card.appendChild(h('div', 'wf-c wf-dim', SAY_S.doorForced));
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
    litDraw(map, route);            // §6b — the lamps this route has, and hasn't
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
    litRetint(map);                 // §6b — the lighting marks ride the same clock
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 6b. AFTER DARK — WHICH OF THIS WALK HAS A MAPPED LIGHT ON IT
  // ══════════════════════════════════════════════════════════════════════════
  //
  // THE SOURCE, AND WHY IT IS THIS ONE. The scene draws exactly 236 lights:
  // `k:"lit"` points in data/props.geojson, 193 warm street lamps and 43 blue
  // emergency phones, every one of them an OpenStreetMap node. js/night.js also
  // paints pools of light along the BASEMAP's road and path classes, but those
  // are generated at runtime at a fixed spacing to keep the city from reading
  // as a void — there is no lamp under them and no survey behind them. Counting
  // those would be counting our own decoration, so this file counts the 236 and
  // says "mapped" every time it opens its mouth. Fly to any pad this draws at
  // night and there is a pole standing in it; that is the whole test.
  //
  // WHY IT DOES NOT SILENTLY RE-ROUTE. A warm lamp within `litRadiusM` covers
  // 9.2 % of the walk network's metres (measured; docs/walk-lit.md). Steering
  // every night route by a signal that thin optimises for OSM's mapping
  // coverage, not for light, and it buys that with time spent outside, which is
  // itself the risk. So the default answer ANNOTATES, and the alternative is
  // computed, priced in metres and lamps, and offered as a button. The user
  // makes the trade; we only make it visible.
  //
  // The light index is NOT the same OSM snapshot as the path network — the
  // furniture caches are 2026-06-12 and the walk graph is 2026-07-30 — so the
  // date printed under the lighting block is the light index's own, read from
  // the file, never the graph's.
  const SRC_LIT = 'wayfind-lit';
  const L_LIT_PAD = 'wayfind-lit-pad', L_LIT_DARK = 'wayfind-lit-dark';
  const L_LIT_THREAD = 'wayfind-lit-thread', L_DARK_MARK = 'wayfind-dark-mark';
  let LAMPS = null, lampPromise = null, litLayersAdded = false;
  // The tally of marks litDraw last handed to the source, by kind. Test surface
  // only — see the note where it is written.
  let litDrawn = {};

  function decodeLampSet(o) {
    const xs = (o && o.x) || [], ys = (o && o.y) || [], n = xs.length;
    const X = new Float64Array(n), Y = new Float64Array(n);
    let ax = 0, ay = 0;
    for (let i = 0; i < n; i++) { ax += xs[i]; ay += ys[i]; X[i] = ax; Y[i] = ay; }
    return { X, Y, n };
  }
  /** A metric hash grid. `cell` must be >= the query radius: the lookup only
   *  visits the 3x3 block around a point, which is exact only under that. */
  function lampGrid(set, cell) {
    const m = new Map();
    for (let i = 0; i < set.n; i++) {
      const k = Math.floor(set.X[i] * MPD_LON / cell) + ':' + Math.floor(set.Y[i] * MPD_LAT / cell);
      const a = m.get(k);
      if (a) a.push(i); else m.set(k, [i]);
    }
    return { m, cell };
  }
  function lampsNear(set, gr, lon, lat, r, into) {
    const cx = Math.floor(lon * MPD_LON / gr.cell), cy = Math.floor(lat * MPD_LAT / gr.cell);
    let any = false;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const a = gr.m.get((cx + dx) + ':' + (cy + dy));
        if (!a) continue;
        for (let k = 0; k < a.length; k++) {
          const i = a[k];
          const ddx = (set.X[i] - lon) * MPD_LON, ddy = (set.Y[i] - lat) * MPD_LAT;
          if (ddx * ddx + ddy * ddy <= r * r) { any = true; if (into) into.add(i); }
        }
      }
    }
    return any;
  }

  /** The bounding box of the reported-dark pins, padded by the radius at which
   *  a pin counts, so a route running along the edge of the surveyed area is
   *  inside it rather than just outside it. */
  function darkBounds(set) {
    if (!set || !set.n) return null;
    let w = 180, s = 90, e = -180, n = -90;
    for (let i = 0; i < set.n; i++) {
      w = Math.min(w, set.X[i]); e = Math.max(e, set.X[i]);
      s = Math.min(s, set.Y[i]); n = Math.max(n, set.Y[i]);
    }
    const px = WAYFIND.darkNearM / MPD_LON, py = WAYFIND.darkNearM / MPD_LAT;
    return [w - px, s - py, e + px, n + py];
  }
  /** Does any part of this walked line fall in the surveyed area? */
  function touchesDarkArea(line) {
    const b = LAMPS && LAMPS.darkBox;
    if (!b) return false;
    for (const p of line) if (p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3]) return true;
    return false;
  }

  async function loadLamps() {
    if (LAMPS) return LAMPS;
    if (lampPromise) return lampPromise;
    lampPromise = (async () => {
      const r = await fetch(WAYFIND.litUrl);
      if (!r.ok) throw new Error(WAYFIND.litUrl + ': ' + r.status);
      const j = await r.json();
      const q = j.q || 1e-6;
      const warm = decodeLampSet(j.warm), blue = decodeLampSet(j.blue);
      // The city's reported-dark pins ride in the same file — a different
      // source, a different licence and a different date, so they are decoded
      // into their own set and never merged into `warm`. `dark_notes[i]` is the
      // person's own words for `dark[i]`; the bake sorts both the same way.
      const dark = decodeLampSet(j.dark);
      for (const s of [warm, blue, dark]) for (let i = 0; i < s.n; i++) { s.X[i] *= q; s.Y[i] *= q; }
      LAMPS = {
        warm, blue, asOf: j.as_of || null,
        nWarm: j.n_warm != null ? j.n_warm : warm.n,
        nBlue: j.n_blue != null ? j.n_blue : blue.n,
        gWarm: lampGrid(warm, WAYFIND.litRadiusM),
        // A SECOND grid at the near-miss radius, not the same one queried
        // wider: `lampsNear` only visits the 3x3 block around a point, which
        // is exact only while the cell is at least the query radius. Asking
        // the 25 m grid for 50 m would quietly miss lamps two cells away.
        gWarmWide: lampGrid(warm, WAYFIND.litNearMissM),
        gBlue: lampGrid(blue, WAYFIND.litPhoneNearM),
        dark, nDark: j.n_dark != null ? j.n_dark : dark.n,
        darkNotes: j.dark_notes || [],
        darkAsOf: j.dark_as_of || null,
        gDark: lampGrid(dark, WAYFIND.darkNearM),
        // 1 where `warm[i]` is standing inside a tree canopy the scene draws
        // over it. The bake reads the same trees.geojson the renderer does, so
        // this flag and the picture cannot disagree — which is the only reason
        // it is allowed to appear in a sentence. It never removes a lamp from
        // the count; a lamp under an oak is still a lamp.
        warmCanopy: Array.isArray(j.warm_canopy) ? j.warm_canopy : null,
        nWarmCanopy: j.n_warm_under_canopy != null ? j.n_warm_under_canopy : null,
        // The study area, as a bounding box off the pins themselves. Used for
        // one thing only: knowing when to say "this survey did not cover here"
        // instead of letting an empty count read as an all-clear. A box and not
        // the real polygon because the difference does not change that sentence
        // and the polygon is 60 vertices we would have to ship.
        darkBox: darkBounds(dark),
      };
      return LAMPS;
    })().catch((e) => { lampPromise = null; throw e; });
    return lampPromise;
  }

  /** Everything the walker actually walks: the door leg, the mapped path, the
   *  other door leg. An unmapped door leg is real metres in the dark too. */
  function walkedLine(route) {
    const out = [];
    const push = (p) => {
      const last = out[out.length - 1];
      if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
    };
    if (route.geom.startLeg) push(route.geom.startLeg[0]);
    for (const p of route.geom.line) push(p);
    if (route.geom.endLeg) push(route.geom.endLeg[1]);
    return out;
  }

  /**
   * Walk the route in `litSampleM` steps and classify every step by whether a
   * mapped street lamp is within `litRadiusM` of its MIDPOINT. Returns the
   * metres each way, the distinct lamps and phones involved, and the runs
   * themselves so the map can draw the unmapped ones.
   *
   * Memoised on the route object: renderPill and draw both want it, and a route
   * is immutable once computed.
   */
  function litScan(route) {
    if (!route || !route.ok || !LAMPS) return null;
    if (route.__lit) return route.__lit;
    const line = walkedLine(route);
    if (line.length < 2) return null;
    const step = WAYFIND.litSampleM;
    const lamps = new Set(), phones = new Set(), reported = new Set();
    // Lamps within the OUTER ring. A superset of `lamps`, so the near-miss
    // count is the difference and a lamp can never be counted in both.
    const wide = new Set();
    let litM = 0, darkM = 0, longestGap = 0;
    // Where along the walk each reported-dark pin was first met, in METRES from
    // the start door. The card's strip needs a POSITION, not just a count — a
    // Set has no geometry — and `reportedAtM[k]` is kept index-aligned with
    // `Array.from(reported)[k]` by pushing exactly once per newly-added pin.
    // The `M` is not decoration: the test surface already exposes a
    // `reportedAt` that is a list of lon/lat, and two arrays with one name is
    // how the wrong one gets plotted.
    let walkedM = 0;
    const reportedAtM = [];
    const runs = [];                 // {lit:bool, m:number, line:[[lon,lat],…]}
    let cur = null;
    const emit = (isLit, a, b, m) => {
      if (cur && cur.lit === isLit) { cur.m += m; cur.line.push(b); }
      else { cur = { lit: isLit, m, line: [a, b] }; runs.push(cur); }
    };
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i], b = line[i + 1];
      const segM = metresBetween(a, b);
      if (segM < 1e-6) continue;
      const n = Math.max(1, Math.ceil(segM / step));
      for (let k = 0; k < n; k++) {
        const t0 = k / n, t1 = (k + 1) / n;
        const p0 = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0];
        const p1 = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1];
        const mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2;
        const m = segM / n;
        const on = lampsNear(LAMPS.warm, LAMPS.gWarm, mx, my, WAYFIND.litRadiusM, lamps);
        if (WAYFIND.litNearMissOn) {
          lampsNear(LAMPS.warm, LAMPS.gWarmWide, mx, my, WAYFIND.litNearMissM, wide);
        }
        lampsNear(LAMPS.blue, LAMPS.gBlue, mx, my, WAYFIND.litPhoneNearM, phones);
        // The city's pins, on the same sweep and into their own set. They are
        // NOT allowed to move `litM`/`darkM`: those two numbers mean "a lamp is
        // mapped here" and nothing else, and a resident's report is a different
        // kind of thing that gets its own count and its own sentence.
        if (WAYFIND.darkOn && LAMPS.dark) {
          const had = reported.size;
          lampsNear(LAMPS.dark, LAMPS.gDark, mx, my, WAYFIND.darkNearM, reported);
          for (let q = had; q < reported.size; q++) reportedAtM.push(walkedM + m / 2);
        }
        if (on) litM += m; else darkM += m;
        walkedM += m;
        emit(on, p0, p1, m);
      }
    }
    for (const r of runs) if (!r.lit && r.m > longestGap) longestGap = r.m;
    const lampList = Array.from(lamps);
    // How many of this route's lamps are standing under a tree. Counted, never
    // deducted — see `warmCanopy` in loadLamps for why a covered lamp is still
    // a lamp. `canopyOn` is the switch, so the whole idea is one line to drop.
    const canopy = (WAYFIND.canopyOn && LAMPS.warmCanopy)
      ? lampList.filter(i => LAMPS.warmCanopy[i]).length : 0;
    const out = {
      litM, darkM, totalM: litM + darkM, longestGapM: longestGap,
      lamps: lampList, phones: Array.from(phones), runs,
      // Counted lamps are a subset of `wide` by construction, so this is the
      // number of mapped lamps that are near the walk and NOT near enough to
      // count. It is never added to the headline count.
      nearMiss: WAYFIND.litNearMissOn ? Math.max(0, wide.size - lamps.size) : 0,
      lampsUnderCanopy: canopy,
      lampsInClear: lampList.length - canopy,
      pct: (litM + darkM) > 0 ? litM / (litM + darkM) : 0,
      reported: Array.from(reported), reportedAtM,
      inDarkArea: WAYFIND.darkOn && touchesDarkArea(line),
    };
    route.__lit = out;
    return out;
  }

  // ── the alternative, and the whole reason it is an OFFER ──────────────────
  //
  // HOW IT IS SEARCHED WITHOUT A SECOND DIJKSTRA. `edgeCost` prices an edge off
  // `g.W`, the decoded centimetre length array. So a lit-preferring search is
  // the SAME search over a swapped `g.W` in which every unmapped edge is
  // `litAltMult` longer than it really is. The swap is synchronous, restored in
  // a `finally`, and nothing else runs between — and the answer is then
  // RE-MEASURED against the true lengths, because a route whose printed
  // distance came off the inflated array would be lying by exactly the amount
  // of the preference.
  //
  // AND THE SECOND PREFERENCE, WHICH IS THE ONE THAT WORKS IN WEST CAMPUS. An
  // edge near a pin somebody dropped saying "too dark here" costs `darkAltMult`
  // more as well. This matters because the lamp preference alone has almost
  // nothing to bite on west of Guadalupe — 58 mapped lamps for the whole
  // neighbourhood — so before this the offer could essentially never fire on
  // exactly the walk it exists for. The two multipliers compound on an edge
  // that is both unmapped and reported, which is the right ordering: no light
  // recorded AND a person saying so is a worse edge than either alone.
  function litEdgeWeights(g) {
    if (g.__litW) return g.__litW;
    const W = Int32Array.from(g.W);
    const useDark = WAYFIND.darkOn && LAMPS.dark && LAMPS.dark.n > 0;
    const useCanopy = WAYFIND.canopyOn && LAMPS.warmCanopy && WAYFIND.litCanopyMult !== 1;
    const hit = useCanopy ? new Set() : null;
    for (let i = 0; i < g.E; i++) {
      const mx = (g.X[g.A[i]] + g.X[g.B[i]]) / 2, my = (g.Y[g.A[i]] + g.Y[g.B[i]]) / 2;
      let mult = 1;
      if (hit) hit.clear();
      if (!lampsNear(LAMPS.warm, LAMPS.gWarm, mx, my, WAYFIND.litRadiusM, hit)) {
        mult *= WAYFIND.litAltMult;
      } else if (useCanopy) {
        // Covered by lamps, but is any of them in the clear? A stretch whose
        // only light is under a tree is charged BETWEEN "lit" and "unmapped",
        // so given two lit ways the offer leans to the open one — and given a
        // lit way and no way, it still takes the lit one.
        let clear = false;
        for (const k of hit) if (!LAMPS.warmCanopy[k]) { clear = true; break; }
        if (!clear) mult *= WAYFIND.litCanopyMult;
      }
      if (useDark && lampsNear(LAMPS.dark, LAMPS.gDark, mx, my, WAYFIND.darkNearM, null)) {
        mult *= WAYFIND.darkAltMult;
      }
      if (mult !== 1) W[i] = Math.round(g.W[i] * mult);
    }
    g.__litW = W;
    return W;
  }
  /** Re-measure a route against the TRUE edge lengths. Same arithmetic as
   *  computeRoute's own, and it must stay the same arithmetic. */
  function litRemeasure(g, r) {
    const m = { flat: 0, stair: 0, signals: 0, stairSets: 0 };
    const sets = new Set();
    for (const leg of r.legs) {
      const s = measure(g, leg);
      m.flat += s.flat; m.stair += s.stair; m.signals += s.signals;
      for (const e of leg.edges) if (g.F[e] & F_STEPS) sets.add(g.S[e]);
    }
    m.stairSets = sets.size;
    m.flat += r.legs.fromLinkM + r.legs.toLinkM;
    r.m = m;
    r.distM = m.flat + m.stair;
    r.time = timeRange(m);
    r.__lit = null;
    return r;
  }
  function sameEdges(a, b) {
    const ea = [].concat.apply([], a.legs.map(l => l.edges));
    const eb = [].concat.apply([], b.legs.map(l => l.edges));
    if (ea.length !== eb.length) return false;
    for (let i = 0; i < ea.length; i++) if (ea[i] !== eb[i]) return false;
    return true;
  }
  /**
   * The lit alternative to `route`, or null if there isn't one worth offering.
   * Both gates are checked against re-measured reality, never against the
   * search's own inflated numbers.
   */
  function litAlternative(route) {
    if (!G || !LAMPS || !route || !route.ok || route.__litPreferred) return null;
    if (route.__litAlt !== undefined) return route.__litAlt;
    let alt = null;
    const W0 = G.W;
    try {
      G.W = litEdgeWeights(G);
      alt = computeRoute(G, route.from, route.to,
        { avoidStairs: route.avoidStairs, via: route.via ? route.via.i : null });
    } catch (e) { alt = null; } finally { G.W = W0; }
    if (alt && alt.ok) {
      litRemeasure(G, alt);
      alt.__litPreferred = true;
      const base = litScan(route), got = litScan(alt);
      // Two ways to earn the button, and it needs only one of them. The first
      // is the original: enough extra metres with a mapped lamp on them. The
      // second is new and is the West Campus case: shedding reported-dark spots
      // while gaining no lamp at all, because there are no lamps there to gain.
      // Both are measured against the RE-MEASURED route, never the search's own
      // inflated numbers, and the distance ceiling binds either way.
      const gainedLamps = base && got ? got.litM - base.litM : 0;
      const droppedSpots = base && got ? base.reported.length - got.reported.length : 0;
      const ok = base && got &&
        !sameEdges(route, alt) &&
        alt.distM <= route.distM * WAYFIND.litAltMaxFrac &&
        (gainedLamps >= WAYFIND.litAltMinGainM ||
         droppedSpots >= WAYFIND.darkAltMinDrop);
      if (ok) alt.__litWhy = gainedLamps >= WAYFIND.litAltMinGainM ? 'lamps' : 'reports';
      alt = ok ? alt : null;
    } else { alt = null; }
    route.__litAlt = alt;
    return alt;
  }

  // ── drawing: the pads under the lamps, and the stretches with no lamp ─────
  function litEnsure(map) {
    if (litLayersAdded || !map || !map.getStyle) return;
    litLayersAdded = true;
    map.addSource(SRC_LIT, { type: 'geojson', data: empty() });
    // The unmapped stretch. An extrusion for the same reason the ribbon is one
    // (see §6): a 2D line under js/ground.js's proud pavement slabs renders
    // nine pixels. It rides `litDarkLiftM` above the ribbon's own top surface.
    map.addLayer({
      id: L_LIT_DARK, type: 'fill-extrusion', source: SRC_LIT, minzoom: WAYFIND.minZoom,
      filter: ['==', ['get', 'k'], 'dark'],
      paint: {
        'fill-extrusion-color': WAYFIND.litDarkCol,
        'fill-extrusion-height': ['get', 'h'],
        'fill-extrusion-base': ['get', 'base'],
        'fill-extrusion-opacity': WAYFIND.litDarkOpacity,
        'fill-extrusion-vertical-gradient': false,
      },
    }, overOf(map));
    // ── AND THE SAME SPLIT AT ALTITUDE, WHICH THE STRIP CANNOT CARRY ────────
    //
    // Above `threadFadeZoom` the route on screen is not the 1.6 m ribbon — it
    // is `wayfind-thread`, a line drawn over the buildings, because 1.6 m of
    // ground is under a pixel from up there (§6). The first cut of this pass
    // only recoloured the ribbon, so from 600 m up the whole route read as one
    // amber line with no lighting in it at all: exactly the altitude at which
    // you are choosing between two ways home. This is the thread's twin, with
    // the thread's own width and fade curve — copied from the same constants,
    // so the two cannot drift apart — carrying the unmapped stretches.
    map.addLayer({
      id: L_LIT_THREAD, type: 'line', source: SRC_LIT, minzoom: WAYFIND.minZoom,
      filter: ['==', ['get', 'k'], 'darkline'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': WAYFIND.litDarkCol,
        'line-width': ['interpolate', ['linear'], ['zoom'],
          14, WAYFIND.threadPx, WAYFIND.threadFadeZoom, WAYFIND.threadPx, WAYFIND.threadGoneZoom, 0.5],
        'line-opacity': ['interpolate', ['linear'], ['zoom'],
          WAYFIND.threadFadeZoom, WAYFIND.threadOpacity, WAYFIND.threadGoneZoom, 0],
      },
    }, overOf(map));
    // A ring round the foot of every lamp this route counted, in that lamp's
    // own colour. This is the claim's receipt: stand in one at night and the
    // pole is in it.
    //
    // ...except where a tree is standing on the lamp, which round 5 measured at
    // three of three flagged sites. There the ring is the same ring in a dimmer
    // value (`litPadCanopyCol`), because a full-strength receipt around a lamp
    // throwing nothing was the only mark in this feature that claimed more light
    // than the scene has. Three kinds, one layer, one filter — a second layer
    // would have to be kept in step with this one's opacity clock.
    map.addLayer({
      id: L_LIT_PAD, type: 'fill-extrusion', source: SRC_LIT, minzoom: WAYFIND.minZoom,
      filter: ['match', ['get', 'k'], ['lamp', 'lampcanopy', 'phone'], true, false],
      paint: {
        'fill-extrusion-color': ['match', ['get', 'k'],
          'phone', WAYFIND.litPhoneCol,
          'lampcanopy', WAYFIND.litPadCanopyCol,
          WAYFIND.litLampCol],
        'fill-extrusion-height': ['get', 'h'],
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': WAYFIND.litPadOpacity,
        'fill-extrusion-vertical-gradient': false,
      },
    }, overOf(map));
    // A DIAMOND at every reported-dark spot this route passes. Deliberately a
    // different shape, a different size and a different hue from the lamp ring:
    // it marks a sentence somebody typed in 2017, not a light, and the one
    // thing this mark must never do is read as another lamp. It is added BELOW
    // the lamp ring in the layer order so that at the three places where a pin
    // and a mapped lamp coincide, the lamp — the newer fact — sits on top.
    map.addLayer({
      id: L_DARK_MARK, type: 'fill-extrusion', source: SRC_LIT, minzoom: WAYFIND.minZoom,
      filter: ['==', ['get', 'k'], 'reported'],
      paint: {
        'fill-extrusion-color': WAYFIND.darkCol,
        'fill-extrusion-height': ['get', 'h'],
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': WAYFIND.darkMarkOpacity,
        'fill-extrusion-vertical-gradient': false,
      },
    }, L_LIT_PAD);
    litRetint(map);
  }

  function litDraw(map, route) {
    if (!route) litPillClear();     // cleared, or a route that could not be found
    if (!WAYFIND.litOn || !map || !map.getStyle) return;
    if (!LAMPS) {
      // First route on the page: fetch the index and come back. A failure is
      // survivable — the route is still a route, it just says nothing about
      // light — so this never rejects into the console on the user's behalf.
      loadLamps().then(() => { if (state.route === route) { litDraw(map, route); renderPill(); } })
        .catch(() => {});
      return;
    }
    litEnsure(map);
    const feats = [];
    const scan = route ? litScan(route) : null;
    if (scan) {
      for (const run of scan.runs) {
        if (run.lit) continue;
        const w = WAYFIND.routeWidthM * WAYFIND.litDarkWidthMul;
        const h = WAYFIND.routeBaseM + WAYFIND.routeHeightM + WAYFIND.litDarkLiftM;
        for (const f of ribbonPolys(run.line, w, h, 'dark')) {
          f.properties.base = WAYFIND.routeBaseM + WAYFIND.routeHeightM;
          feats.push(f);
        }
        feats.push({
          type: 'Feature', properties: { k: 'darkline' },
          geometry: { type: 'LineString', coordinates: run.line },
        });
      }
      const ring = (ll, kind) => ({
        type: 'Feature', properties: { k: kind, h: WAYFIND.litPadH },
        // Outer square plus an inner square as a HOLE. `squareAround` returns a
        // one-ring polygon, so this is its outer ring followed by the smaller
        // one — winding order does not matter to MapLibre's earcut tessellator,
        // only that the hole is the second ring.
        geometry: {
          type: 'Polygon',
          coordinates: squareAround(ll, WAYFIND.litPadM)
            .concat(squareAround(ll, Math.max(0.2, WAYFIND.litPadM - 2 * WAYFIND.litPadRimM))),
        },
      });
      // A flagged lamp is still a counted lamp and still gets a ring — the
      // count above the card and the marks on the ground have to agree, or the
      // receipt stops being a receipt. Only its VALUE changes.
      const covered = (i) => WAYFIND.litPadCanopyOn && WAYFIND.canopyOn &&
        LAMPS.warmCanopy && LAMPS.warmCanopy[i];
      for (const i of scan.lamps) {
        feats.push(ring([LAMPS.warm.X[i], LAMPS.warm.Y[i]], covered(i) ? 'lampcanopy' : 'lamp'));
      }
      for (const i of scan.phones) feats.push(ring([LAMPS.blue.X[i], LAMPS.blue.Y[i]], 'phone'));
      // ...and the city's pins, as a diamond ring in their own colour.
      if (WAYFIND.darkOn && LAMPS.dark) {
        for (const i of scan.reported) {
          feats.push(diamondRing([LAMPS.dark.X[i], LAMPS.dark.Y[i]]));
        }
      }
    }
    const src = map.getSource(SRC_LIT);
    if (src) src.setData({ type: 'FeatureCollection', features: feats });
    // WHAT WAS ACTUALLY DRAWN, kept for the test surface. Not a convenience:
    // the marks cannot be counted back off the map. `getSource()._data` is not
    // the FeatureCollection that was set (it reads as undefined with zero
    // features, which looks exactly like a change that did nothing), and
    // `querySourceFeatures` repeats a feature in every tile it touches — 24
    // rings came back as 64, then as 39 after a deduplication by vertex, which
    // is the right ratio and a meaningless count. A tally taken here is taken
    // from the array that was handed to the source, once.
    litDrawn = feats.reduce((n, f) => {
      const k = f.properties && f.properties.k;
      if (k) n[k] = (n[k] || 0) + 1;
      return n;
    }, {});
  }

  /** The reported-dark mark: an open ring, like the lamp's, but turned 45° and
   *  bigger. `squareAround` is axis-aligned by construction, so the corners are
   *  built here rather than by rotating it — a rotation would have to know the
   *  latitude scaling and would come out as a kite, not a diamond. */
  function diamondRing(ll) {
    const corners = (sideM) => {
      const rx = (sideM / 2) / MPD_LON, ry = (sideM / 2) / MPD_LAT;
      return [[ll[0], ll[1] - ry], [ll[0] + rx, ll[1]],
        [ll[0], ll[1] + ry], [ll[0] - rx, ll[1]], [ll[0], ll[1] - ry]];
    };
    const outer = WAYFIND.darkMarkM;
    const inner = Math.max(0.2, outer - 2 * WAYFIND.darkMarkRimM);
    const shape = WAYFIND.darkMarkDiamond
      ? [corners(outer), corners(inner)]
      : squareAround(ll, outer).concat(squareAround(ll, inner));
    return {
      type: 'Feature', properties: { k: 'reported', h: WAYFIND.darkMarkH },
      geometry: { type: 'Polygon', coordinates: shape },
    };
  }

  /** Night makes these marks matter, so night is when they are at full
   *  strength. By day they step back rather than disappear: you may be planning
   *  a walk you will take at nine. */
  function litRetint(map) {
    if (!litLayersAdded || !map || !map.getLayer) return;
    const k = WAYFIND.litDayOpacityMul + (1 - WAYFIND.litDayOpacityMul) * nightness();
    const set = (id, v) => { if (map.getLayer(id)) { try { map.setPaintProperty(id, 'fill-extrusion-opacity', v); } catch (e) {} } };
    set(L_LIT_DARK, WAYFIND.litDarkOpacity * k);
    set(L_LIT_PAD, WAYFIND.litPadOpacity * k);
    set(L_DARK_MARK, WAYFIND.darkMarkOpacity * k);
    // The thread's opacity is a zoom interpolation, not a scalar, so the whole
    // expression is rebuilt with the night factor folded into its peak. Same
    // two stops as `wayfind-thread`, off the same two constants.
    if (map.getLayer(L_LIT_THREAD)) {
      try {
        map.setPaintProperty(L_LIT_THREAD, 'line-opacity', ['interpolate', ['linear'], ['zoom'],
          WAYFIND.threadFadeZoom, WAYFIND.threadOpacity * k, WAYFIND.threadGoneZoom, 0]);
      } catch (e) {}
    }
    // The line in the closed pill is gated on `litNightP`, so it has to move
    // with the clock too. Without this, dragging the time slider back to noon
    // with a route on screen left "24 mapped streetlights along this route"
    // sitting under a midday sky — found by driving the slider, not by reading.
    // `litScan` is memoised on the route, so this is a DOM swap and no work.
    litPillLine(state.route);
  }

  // ── the words ─────────────────────────────────────────────────────────────
  /**
   * The one line worth putting in the CLOSED pill, and only after dark.
   *
   * It goes in the pill itself rather than inside `#wf-sub`, which was the
   * first cut and the wrong one: `#wf-sub` carries `opacity:.62`, and a child
   * cannot be more opaque than its parent, so the line a person is meant to
   * read while walking at night came out at 62 % of everything else in the
   * pill. Living in the pill means owning its lifetime — `renderPill` clears
   * the headline, the sub and the card but not a node it does not know about —
   * so this removes its own previous node first, and `litDraw(map, null)` takes
   * it down when the route goes away or fails.
   */
  let litPillNode = null;
  function litPillClear() {
    if (litPillNode && litPillNode.parentNode) litPillNode.parentNode.removeChild(litPillNode);
    litPillNode = null;
  }
  function litPillLine(r) {
    litPillClear();
    if (!WAYFIND.litOn || !el || !r || !r.ok) return;
    const scan = litScan(r);
    if (!scan || nightness() < WAYFIND.litNightP) return;
    const n = scan.lamps.length;
    // WHICH ONE LINE. The closed pill has room for exactly one sentence about
    // light, so it gets the one that carries the most information about THIS
    // walk. A route with no mapped lamp on it but four spots people reported
    // too dark is far better described by the second fact than by the first —
    // and that is not an edge case, it is every walk home into West Campus.
    // A route with lamps on it, or one the survey never covered, keeps the
    // lamp sentence.
    const spots = WAYFIND.darkOn ? scan.reported.length : 0;
    const useReports = spots > 0 && n === 0;
    const line = h('div', null,
      useReports ? SAY.darkSpots(spots) : (n ? SAY.litLamps(n) : SAY.litNone));
    line.style.cssText = 'font-size:11px;font-weight:600;margin-top:4px;letter-spacing:.02em;' +
      'color:' + (useReports ? WAYFIND.darkTextCol : (n ? WAYFIND.litLampCol : WAYFIND.litTextDim));
    el.pill.insertBefore(line, el.card);
    litPillNode = line;
  }

  /** One resident's sentence, picked from the pins this route passes.
   *
   *  WHY QUOTE AT ALL. A count is a number we produced; "This street isn't lit
   *  at all at night" is a person, and it is the only thing in this feature
   *  that is testimony rather than arithmetic. It also does the honesty work
   *  for free — nobody reads a quotation mark as a live measurement.
   *
   *  Picks the LONGEST usable comment rather than the nearest, because the
   *  nearest is often "too dark here", which tells the reader nothing they did
   *  not just read in the count above it. Deterministic: same route, same quote.
   */
  function darkQuoteFor(scan) {
    if (!WAYFIND.darkOn || !LAMPS || !LAMPS.darkNotes || !scan) return null;
    let best = null;
    for (const i of scan.reported) {
      const t = (LAMPS.darkNotes[i] || '').trim();
      if (t.length < WAYFIND.darkQuoteMinLen) continue;
      if (!best || t.length > best.length) best = t;
    }
    if (!best) return null;
    if (best.length > WAYFIND.darkQuoteMaxLen) {
      const cut = best.slice(0, WAYFIND.darkQuoteMaxLen);
      const sp = cut.lastIndexOf(' ');
      best = (sp > WAYFIND.darkQuoteMinLen ? cut.slice(0, sp) : cut) + '…';
    }
    return best;
  }

  /**
   * The walk, left to right, as one bar: amber where a mapped street lamp is
   * within `litRadiusM`, cool where none is, a violet tick at every spot
   * somebody reported too dark.
   *
   * WHY THIS EXISTS. The block already printed "Longest stretch with none
   * mapped: 700 m" — a true number that cannot answer the question a person
   * standing on a doorstep at midnight is actually asking, which is WHERE. A
   * 700 m unmapped stretch in the middle of a walk and a 700 m unmapped stretch
   * at the far door are the same sentence and two different walks.
   *
   * It is a SCHEMATIC, not a scale bar: `litStripMinFrac` floors the width of a
   * short run so a single lamp on a 2 km walk is a visible mark instead of a
   * rounding error. That trade is why the metres are still printed underneath
   * it — the picture says where, the number says how much, and the number is
   * the one that is exact.
   *
   * The colours are the card's own, not the map's, for the reason `litTextDim`
   * already records: the same fact lying on a night street and sitting on dark
   * glass needs two different values to be legible on both.
   */
  function litStrip(scan) {
    if (!WAYFIND.litStripOn || !scan || !scan.totalM) return null;
    const wrap = h('div', null);
    wrap.style.cssText = 'margin:7px 0 4px';

    const track = h('div', null);
    // `box-sizing:border-box` is load-bearing, not tidiness: the edge is inset
    // so the bar stays exactly `litStripH` tall and this block's height — the
    // one measure round 4 called the one that cannot be gamed — does not move.
    track.style.cssText = 'position:relative;display:flex;width:100%;overflow:hidden;' +
      'box-sizing:border-box;' +
      'height:' + WAYFIND.litStripH + 'px;border-radius:' + WAYFIND.litStripRadius + 'px;' +
      (WAYFIND.litStripEdgeOn
        ? 'border:' + WAYFIND.litStripEdgePx + 'px solid ' + WAYFIND.litStripEdgeCol + ';' : '') +
      'background:' + WAYFIND.litStripDarkCol + ';';
    // Runs first, in order, as flex children — so they tile the full width with
    // no sub-pixel gaps, which absolute lefts computed from rounded percentages
    // do not. Every run is present in the DOM even at the floor width; a run
    // that is dropped for being small is a lamp the picture denies and the
    // count claims.
    const floor = WAYFIND.litStripMinFrac;
    let sum = 0;
    const fracs = scan.runs.map(run => Math.max(floor, run.m / scan.totalM));
    for (const f of fracs) sum += f;
    scan.runs.forEach((run, i) => {
      const seg = h('div', null);
      seg.style.cssText = 'flex:' + (fracs[i] / sum) + ' 1 0;min-width:0;' +
        'background:' + (run.lit ? WAYFIND.litStripLitCol : WAYFIND.litStripDarkCol) + ';';
      track.appendChild(seg);
    });
    // The pins ride on top at their true position, never floored: a tick is a
    // point and has no length to lose.
    if (WAYFIND.darkOn && scan.inDarkArea && scan.reportedAtM) {
      for (const at of scan.reportedAtM) {
        const t = h('div', null);
        t.style.cssText = 'position:absolute;top:0;bottom:0;width:' + WAYFIND.litStripTickW + 'px;' +
          'margin-left:' + (-WAYFIND.litStripTickW / 2) + 'px;' +
          'left:' + (100 * Math.min(1, Math.max(0, at / scan.totalM))).toFixed(2) + '%;' +
          'background:' + WAYFIND.litStripTickCol + ';';
        track.appendChild(t);
      }
    }
    // A picture that exists only as pixels is unreadable to a screen reader and
    // unassertable by a test. This string is the strip saying what it is.
    const ticks = (WAYFIND.darkOn && scan.inDarkArea && scan.reportedAtM) ? scan.reportedAtM.length : 0;
    track.setAttribute('role', 'img');
    track.setAttribute('aria-label', SAY.litStripAria(
      Math.round(100 * scan.pct),
      scan.longestGapM >= WAYFIND.litGapMinM ? fmtDist(scan.longestGapM) : '', ticks));
    wrap.appendChild(track);

    if (WAYFIND.litStripCapsOn) {
      const caps = h('div', null);
      caps.style.cssText = 'display:flex;justify-content:space-between;' +
        'font-size:' + WAYFIND.litStripCapsPx + 'px;' +
        'opacity:' + WAYFIND.litStripCapsOpacity + ';' +
        'letter-spacing:.05em;text-transform:uppercase;margin-top:3px';
      caps.appendChild(h('span', null, SAY.litStripFrom));
      caps.appendChild(h('span', null, SAY.litStripTo));
      wrap.appendChild(caps);
    }
    return wrap;
  }

  /**
   * One mark from the strip, inline, at the head of the sentence that mark
   * means. This is the strip's key — see `litSwatchOn` for why it is a mark
   * and not a legend row.
   *
   * It takes the colour it is given rather than looking one up, so the caller
   * is always naming which of the strip's own constants it is echoing; a
   * swatch that quietly drifted off the bar's colour would be worse than no
   * swatch at all, and `shots/walk/lit/swatch.mjs` samples both off the
   * rendered card to prove they still match.
   */
  function litSwatch(col, asTick) {
    if (!WAYFIND.litSwatchOn) return null;
    const s = h('span', null);
    const px = WAYFIND.litSwatchPx;
    // The square carries the bar's own edge, for the reason the bar has one:
    // measured on the shipped card the cool swatch was 2.46:1 against the
    // glass, under the 3:1 a mark needs, and a 9 px square is far easier to
    // miss than a full-width bar of the identical colour. The FILL is left
    // exactly as it was — it has to keep matching the bar (§47), and
    // `swatch.mjs` samples the centre, which the inset edge does not touch.
    //
    // The tick does NOT take an edge: it is `litStripTickW` (2 px) wide, so a
    // 1 px frame would leave no fill at all and the mark would stop being the
    // colour it exists to name. Measured, it does not need one — the violet
    // renders at 9.9:1 on this card.
    const edge = WAYFIND.litStripEdgeOn && !asTick;
    s.style.cssText = 'display:inline-block;vertical-align:baseline;box-sizing:border-box;' +
      'width:' + (asTick ? WAYFIND.litStripTickW : px) + 'px;height:' + px + 'px;' +
      'border-radius:' + (asTick ? 0 : WAYFIND.litSwatchRadius) + 'px;' +
      (edge ? 'border:' + WAYFIND.litStripEdgePx + 'px solid ' + WAYFIND.litStripEdgeCol + ';' : '') +
      'margin-right:' + WAYFIND.litSwatchGap + 'px;background:' + col + ';';
    // It is decoration for a sentence that already says the thing in words, so
    // it must not be read out twice.
    s.setAttribute('aria-hidden', 'true');
    return s;
  }

  /** The block in the open card: what is mapped, where it runs out, what that
   *  claim is and is not, and the priced alternative. */
  function litCard(card, r) {
    if (!WAYFIND.litOn || !r || !r.ok) return;
    const scan = litScan(r);
    if (!scan) return;

    const head = h('div', 'wf-c', SAY.litHeading);
    head.style.fontWeight = '600';
    head.style.marginTop = '11px';
    card.appendChild(head);

    // The picture first, then the headline it is a picture of.
    const strip = litStrip(scan);
    if (strip) card.appendChild(strip);

    const n = scan.lamps.length;
    // THE ONE FACT, GIVEN THE WEIGHT OF ONE FACT. Everything under this is a
    // qualifier on it, and until round 4 all of them were set in the same grey
    // at the same size, which is how "No mapped streetlight along this route"
    // ended up indistinguishable from a licence attribution.
    const lamps = h('div', 'wf-c', n ? SAY.litLamps(n) : SAY.litNone);
    lamps.style.cssText = 'font-size:13px;font-weight:600;margin:6px 0 2px;color:' +
      (n ? WAYFIND.litLampCol : WAYFIND.litTextDim);
    // The strip's key, at the head of the strip's headline. Amber when there is
    // something counted — the colour of the runs the bar drew amber — and the
    // bar's own cool otherwise, which is the ONLY place on this card that
    // colour is named. `litTextDim` stays the text colour: a swatch may be the
    // map's value because it is a mark, and text may not, because it has to be
    // read (see `litTextDim`).
    if (strip) {
      const sw = litSwatch(n ? WAYFIND.litStripLitCol : WAYFIND.litStripDarkCol, false);
      if (sw) lamps.insertBefore(sw, lamps.firstChild);
    }
    // Under tree cover rides ON the count rather than under it — it is a
    // qualifier on that number and nothing else, and a separate line gave it
    // the standing of a separate fact.
    if (n && WAYFIND.canopyOn && scan.lampsUnderCanopy > 0) {
      const cov = h('span', null, ' · ' + SAY.litCanopyShort(scan.lampsUnderCanopy));
      cov.style.cssText = 'font-weight:400;opacity:.62';
      lamps.appendChild(cov);
    }
    // ...and on a route with NO counted lamp, the lamps that are near it but
    // not near enough. "No mapped streetlight along this route" is the
    // strongest sentence in this block and the one a user is most likely to go
    // and check — and round 4 measured that in the 25-60 m band a lamp is
    // visible from the pavement at 9 of 18 sampled places
    // (shots/walk/lit/boundary.mjs). Qualifying the sentence is honest; widening
    // `litRadiusM` to swallow the band would have made "covers the path" mean
    // a lamp across a lawn, and inflated every coverage figure in the feature.
    if (!n && WAYFIND.litNearMissOn && scan.nearMiss > 0) {
      const nm = h('span', null, SAY.litNearMiss(scan.nearMiss, WAYFIND.litNearMissM));
      nm.style.cssText = 'font-weight:400;opacity:.62;color:' + WAYFIND.litTextDim;
      lamps.appendChild(nm);
    }
    card.appendChild(lamps);

    // The two secondary map facts, on one row, verbatim. Both sentences are
    // the permitted ones from docs/walk-lit.md §5 — joined, not reworded.
    const bits = [];
    if (scan.longestGapM >= WAYFIND.litGapMinM) bits.push(SAY.litGap(fmtDist(scan.longestGapM)));
    const ph = scan.phones.length;
    bits.push(ph ? SAY.litPhones(ph) : SAY.litPhonesNone);
    const second = h('div', 'wf-c', bits.join(' · '));
    second.style.cssText = 'margin:2px 0 0;opacity:.8';
    card.appendChild(second);

    // ── what people said, where anybody was asked ─────────────────────────
    //
    // Ordered after the map facts and before the offer, because that is the
    // order they carry weight in: here is what is recorded, here is what people
    // who live here said about it, here is what you can do about it.
    const spots = WAYFIND.darkOn && LAMPS.dark ? scan.reported.length : 0;
    if (WAYFIND.darkOn && LAMPS.dark && LAMPS.dark.n) {
      if (!scan.inDarkArea) {
        // The survey only ever covered West Campus. On a route that never
        // enters it, zero reports is not an all-clear and must not be printed
        // as one — so the count is not printed at all, only its absence of
        // standing. This line is the whole reason `inDarkArea` exists.
        card.appendChild(h('div', 'wf-c wf-dim', SAY.darkOutside));
      } else {
        const rep = h('div', 'wf-c', spots ? SAY.darkSpots(spots) : SAY.darkNoneOnRoute);
        rep.style.color = spots ? WAYFIND.darkTextCol : WAYFIND.litTextDim;
        // ...and the tick's key, at the head of the only sentence that names
        // what the ticks are. Only when there ARE ticks on the bar: a mark
        // explaining a mark that is not drawn is a mark that lies.
        if (strip && spots) {
          const sw = litSwatch(WAYFIND.litStripTickCol, true);
          if (sw) rep.insertBefore(sw, rep.firstChild);
        }
        card.appendChild(rep);
        const q = darkQuoteFor(scan);
        if (q) {
          const quote = h('div', 'wf-c', SAY.darkQuote(q));
          quote.style.cssText = 'font-style:italic;color:' + WAYFIND.darkTextCol + ';opacity:.9';
          card.appendChild(quote);
          card.appendChild(h('div', 'wf-c wf-dim', SAY.darkQuoteWho()));
        }
      }
    }

    if (r.__litPreferred) {
      const on = h('div', 'wf-c', SAY.litAltOn);
      on.style.color = WAYFIND.litLampCol;
      card.appendChild(on);
      const back = h('button', 'wf-chip', SAY.litAltOff);
      back.addEventListener('click', (ev) => { ev.stopPropagation(); litSwap(false); });
      const row = h('div', 'wf-chips'); row.appendChild(back);
      card.appendChild(row);
    } else {
      const alt = litAlternative(r);
      if (alt) {
        const extra = alt.distM - r.distM;
        const pct = Math.round(100 * extra / Math.max(1, r.distM));
        const gotScan = litScan(alt);
        // The offer names the thing the alternative actually buys. An offer
        // that says "more mapped light" when what it really did was route
        // around four reported-dark spots — gaining no lamp at all — would be
        // selling the user the wrong reason, and the wrong reason is the one
        // they would judge the result by.
        const byReports = alt.__litWhy === 'reports';
        const was = byReports ? scan.reported.length : scan.lamps.length;
        const now = byReports ? gotScan.reported.length : gotScan.lamps.length;
        const offer = pct >= 1
          ? (byReports ? SAY.darkAltOffer : SAY.litAltOffer)(fmtDist(extra), pct, was, now)
          : (byReports ? SAY.darkAltOfferFree : SAY.litAltOfferFree)(was, now);
        card.appendChild(h('div', 'wf-c', offer));
        const take = h('button', 'wf-chip', SAY.litAltTake);
        take.addEventListener('click', (ev) => { ev.stopPropagation(); litSwap(true); });
        const row = h('div', 'wf-chips'); row.appendChild(take);
        card.appendChild(row);
      } else if (scan.longestGapM >= WAYFIND.litGapMinM) {
        const searchedBoth = WAYFIND.darkOn && LAMPS.dark && LAMPS.dark.n && scan.inDarkArea;
        card.appendChild(h('div', 'wf-c wf-dim',
          searchedBoth ? SAY.litAltNoneEither : SAY.litAltNone));
      }
    }

    // ── the sourcing ─────────────────────────────────────────────────────
    //
    // Three dated paragraphs. They were eight of this block's twenty lines and
    // they were the least-read text in the app precisely because they were the
    // longest — set in the same grey as the answer, immediately under it. They
    // go in a drawer whose LABEL carries the two disclaimers that must never be
    // behind a tap: the count is of the map, and this is not a safety rating.
    // Nothing is removed and no date is dropped. A shorter caveat that is read
    // beats a longer one that is not.
    const src = h('div', null);
    src.appendChild(h('div', 'wf-c wf-dim',
      SAY.litSource(LAMPS.nWarm, LAMPS.asOf ? fmtAsOf(LAMPS.asOf) : '')));
    // The second source gets its own attribution line and its own date, and
    // only where it has standing. Two sources with two dates must never share
    // one banner — the lamps are a June 2026 snapshot, the pins stopped in
    // January 2018, and printing either date over the other's data is the
    // exact mistake the lamp line was already careful not to make.
    if (WAYFIND.darkOn && LAMPS.dark && LAMPS.dark.n && scan.inDarkArea) {
      src.appendChild(h('div', 'wf-c wf-dim',
        SAY.darkSource(LAMPS.nDark, LAMPS.darkAsOf ? fmtAsOf(LAMPS.darkAsOf) : '')));
    }
    // Only after dark, because before dark there is no glow to explain. It
    // answers the one thing a user who goes and checks will see and reasonably
    // read as this card being wrong.
    if (WAYFIND.decorNoteOn && nightness() >= WAYFIND.litNightP) {
      src.appendChild(h('div', 'wf-c wf-dim', SAY.litDecor));
    }

    if (!WAYFIND.litProvenanceFold) { card.appendChild(src); return; }

    src.style.display = 'none';
    const tog = h('div', 'wf-c wf-dim', '▸ ' + SAY.litFold);
    tog.style.cssText = 'cursor:pointer;margin-top:7px;opacity:.62;' +
      'text-decoration:underline;text-decoration-color:rgba(255,255,255,.18);' +
      'text-underline-offset:3px';
    tog.setAttribute('role', 'button');
    tog.setAttribute('tabindex', '0');
    const flip = (ev) => {
      // The pill's own click handler collapses the card. Every control inside
      // it has to stop the event or opening the drawer closes the card it is in.
      if (ev) ev.stopPropagation();
      const open = src.style.display === 'none';
      src.style.display = open ? '' : 'none';
      tog.firstChild.nodeValue = (open ? '▾ ' : '▸ ') + SAY.litFold;
      tog.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    tog.setAttribute('aria-expanded', 'false');
    tog.addEventListener('click', flip);
    tog.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); flip(ev); }
    });
    card.appendChild(tog);
    card.appendChild(src);
  }

  /** Swap the drawn route between the shortest and the lit-preferring one.
   *  Deliberately NOT sticky: change the destination, the stairs toggle or the
   *  stop and you are back on the shortest route with the offer made again,
   *  priced for the new walk. A preference that survives a change of question
   *  is a preference nobody asked the new question about. */
  function litSwap(preferLit) {
    if (!G || !state.route) return;
    let next = null;
    if (preferLit) next = litAlternative(state.route);
    else next = computeRoute(G, state.from, state.to,
      { avoidStairs: state.avoid, via: state.via });
    if (!next || !next.ok) return;
    state.route = next;
    draw(window.__map, next);
    renderPill();
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
    // A CLICK ON A CONTROL IS NOT A CLICK ON THE PILL, and getting that wrong
    // cost the one feature Simeon named. The card's buttons each call
    // stopPropagation, but a CHECKBOX cannot be fixed that way: a checkbox
    // fires `change` only AFTER its click has finished bubbling, so by the time
    // the box's own handler would run, this listener has already flipped
    // `state.expanded` to false and renderPill() has emptied `#wf-card` — the
    // input is detached from the document, Chrome drops its activation, and
    // nothing happens at all.
    //
    // Measured on this page, 2026-08-24, real mouse click at the "Avoid stairs"
    // box's own pixel centre (docs/walk-door.md round 4 §1): checkbox still
    // unchecked, card shut, headline still reading "Stairs: 1 set", route
    // unchanged at 260 m — while the same route asked through the API with
    // avoidStairs:true comes back 166 m with no stairs at all. The routing was
    // right the whole time; the control that turns it on was unreachable.
    //
    // So guard once, here, rather than per control: anything interactive inside
    // the pill owns its own click, and the expand/collapse gesture is only ever
    // a click on the pill's own text.
    //
    // INTEGRATION (acer/w-integrate): acer/w-ui rebuilt this whole block for the
    // phone and acer/w-door fixed the checkbox in it, and the two edits landed on
    // top of each other. w-ui's structure is the one that survives — its `card`
    // and `chev` handlers and its `from.inp`/`to.inp` inputs are what the rest of
    // the merged file is written against, and w-door's bare `inFrom`/`inTo` are
    // locals that no longer exist and would have thrown on load. But w-door's
    // guard is a MEASURED fix for the one control Simeon asked for by name, and
    // w-ui's `card.stopPropagation()` does not cover a control sitting in the
    // pill itself, so the guard is kept and wraps w-ui's `toggle`. A click on
    // `chev` is caught by the guard here and toggled by chev's own handler
    // below, so it still toggles exactly once.
    const WF_CONTROL_SEL = 'input, button, select, textarea, label, a';
    pill.addEventListener('click', (ev) => {
      const t = ev.target;
      if (t && t.closest && t.closest(WF_CONTROL_SEL)) return;
      toggle();
    });
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
        // 5b — `nostepfree` is a route that exists and is unreachable WITH THE
        // TOGGLE ON, which is a different fact from "no walking route found"
        // and had a sentence written for it (SAY.avoidNone) that nothing said.
        // INTEGRATION: acer/w-stairs wrote this third branch and acer/w-ui
        // rewrote the block under it; the branch is kept because without it a
        // step-free request that finds nothing tells the reader there is no
        // walking route at all, which is false.
        : (r && r.why === 'nodoor' ? SAY.notRoutable
          : r && r.why === 'nostepfree' ? SAY.avoidNone : SAY.noRoute);
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
    // INTEGRATION (acer/w-integrate): acer/w-ui rebuilt this figure line as
    // spans so the minutes can be 26 px without changing `.textContent`, and
    // acer/w-lit added `litPillLine(r)` under it. w-ui's construction is kept
    // whole — it is the typographic rebuild and the honesty gates assert on the
    // `.textContent` it preserves — and w-lit's call is re-attached at the end
    // of the block, which is the same position it held relative to the sub line.
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
    litPillLine(r);                 // §6b — after dark, above the fold

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

    // THE CONTROLS COME BEFORE THE SMALL PRINT. The three stop chips were the
    // LAST thing in the card, under two paragraphs of disclaimer, so the two
    // things you can actually do to a route — put a stop on it, take the stairs
    // off it — sat either side of the longest run of grey text in the feature.
    // Photographed at 390 x 844: the chips landed 500 px below the top of the
    // bar and off the bottom of a phone whenever the card also had a via note
    // and an hours line in it.
    //
    // INTEGRATION (acer/w-integrate) — AND THE CONTROLS COME BEFORE THE
    // ITINERARY TOO, which is a change to acer/w-ui's own ordering, made
    // because a photograph said so rather than because it reads better.
    //
    // MEASURED, three ways, on WCH -> MAI at 1280x800 through walkmeter's live
    // UI gate (a real mouse click at the checkbox's own pixel centre):
    //   acer/w-door alone            PASS  the box ticks, the route changes
    //   acer/w-ui alone              FAIL  "the card was destroyed by the click"
    //   the two merged, w-ui order   FAIL  the box did not tick
    // acer/w-ui's rebuild puts a step-by-step itinerary of up to WF_UI.stepsMax
    // events at the top of the card. fitCard() caps the card's height and lets
    // it scroll, so on a route of any length the chips and the avoid-stairs
    // toggle land BELOW THE VISIBLE EDGE — the gate's click went through to the
    // map, and the one control Simeon named by name was unusable again. That is
    // the exact defect acer/w-door had just fixed and its critic had flagged
    // twice, reintroduced by a lane that never ran this gate.
    //
    // No value of stepsMax fixes it: the card is shorter still on a phone. So
    // the two CONTROLS move above the itinerary, which is also the maximal
    // reading of w-ui's own rule at the top of this comment. w-ui's "itinerary
    // first" was written against the DISCLAIMERS that used to lead the card, and
    // those are still below it. Nothing is unreachable — the card scrolls — but
    // a control must be reachable WITHOUT scrolling, and reference material need
    // not be.
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
    // 5b — #wf-pill toggles `expanded` on any click inside it, so ticking this
    // box ALSO folded the card shut on the same gesture: you turned step-free
    // on and the answer disappeared. Every other control in here already calls
    // stopPropagation; the one control this feature is about did not.
    cb.addEventListener('click', (ev) => ev.stopPropagation());
    av.addEventListener('click', (ev) => ev.stopPropagation());
    av.appendChild(cb); av.appendChild(h('span', null, SAY.avoidStairs));
    el.card.appendChild(av);
    el.card.appendChild(h('div', 'wf-c wf-dim', SAY.avoidBlurb));
    el.card.appendChild(h('div', 'wf-c wf-dim', SAY.avoidNotAccess));
    // 5b — was `G.swEdges.size`, every steps way in the file (189). 21 of them
    // are on stranded islands dijkstra() refuses to enter with the toggle on OR
    // off, so the filter never "avoided" them. routableStairways() is 168.
    if (state.avoid) el.card.appendChild(h('div', 'wf-c wf-dim', SAY.avoidShown(routableStairways(G))));

    // THE ITINERARY, and it is still the first thing in the card that is not a
    // control, because it is the thing the card is opened for. The disclaimers
    // that used to lead it are the thing you read once; the list of what the
    // walk does is the thing you read every time. See §7a-ii for why every row
    // of it is derivable.
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

    // 5b — WHERE THE STAIRS ARE, and the step-free answer with its price. It
    // sits directly under the toggle it explains: the list is the reason you
    // would reach for the toggle, and a filter you have to guess the effect of
    // is a filter nobody ticks. Everything it draws lives in §5b. (acer/w-stairs
    // put it ABOVE the toggle; see the INTEGRATION note at the controls block
    // for the frame that moved it below.)
    stairsSection(el.card, r);

    litCard(el.card, r);            // §6b — street lighting, and the lit way

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
  // §6b, readable from a test. Everything here is measured off the SAME scan
  // the card prints, so a verify script can never be agreeing with a different
  // arithmetic than the interface's. `lampsAt` is the list of coordinates a
  // camera should be able to see a pole standing at — the whole point of the
  // pads is that this list is checkable by looking.
  window.wayfindLit = async function () {
    await loadLamps().catch(() => {});
    const r = state.route;
    const scan = r ? litScan(r) : null;
    if (!LAMPS) return { ok: false, why: 'noindex' };
    if (!scan) return { ok: false, why: 'noroute', indexWarm: LAMPS.nWarm, indexBlue: LAMPS.nBlue };
    const alt = litAlternative(r);
    const altScan = alt ? litScan(alt) : null;
    return {
      ok: true, preferred: !!r.__litPreferred,
      indexWarm: LAMPS.nWarm, indexBlue: LAMPS.nBlue, asOf: LAMPS.asOf,
      radiusM: WAYFIND.litRadiusM,
      lamps: scan.lamps.length, phones: scan.phones.length,
      nearMiss: scan.nearMiss, nearMissM: WAYFIND.litNearMissM,
      // The canopy split, and the coordinates of the covered ones, so a test
      // can fly to one and look up. Same discipline as `lampsAt`: a claim that
      // cannot be checked by looking does not belong in the card.
      indexCanopy: LAMPS.nWarmCanopy, lampsUnderCanopy: scan.lampsUnderCanopy,
      lampsInClear: scan.lampsInClear,
      canopyAt: (LAMPS.warmCanopy ? scan.lamps.filter(i => LAMPS.warmCanopy[i]) : [])
        .map(i => [LAMPS.warm.X[i], LAMPS.warm.Y[i]]),
      litM: Math.round(scan.litM), darkM: Math.round(scan.darkM),
      totalM: Math.round(scan.totalM), pct: Math.round(100 * scan.pct),
      longestGapM: Math.round(scan.longestGapM),
      runs: scan.runs.length,
      // The marks litDraw actually put on the ground, by kind, so a test can
      // check that the card's sentence and the map's receipt agree — 24 counted
      // lamps must be 24 rings, of which `lampcanopy` many are the dim ones.
      drawn: litDrawn, padCanopyOn: !!WAYFIND.litPadCanopyOn,
      lampsAt: scan.lamps.map(i => [LAMPS.warm.X[i], LAMPS.warm.Y[i]]),
      phonesAt: scan.phones.map(i => [LAMPS.blue.X[i], LAMPS.blue.Y[i]]),
      darkAt: scan.runs.filter(x => !x.lit && x.m >= WAYFIND.litGapMinM)
        .map(x => ({ m: Math.round(x.m), mid: x.line[Math.floor(x.line.length / 2)] })),
      // EVERY classified stretch, lit ones included, with the geometry the
      // classification was made on. `darkAt` above only ever exposed the long
      // unmapped runs, so an audit could sample where this feature is UNSURE
      // and never where it is CONFIDENT — and a confusion matrix needs both
      // columns or it is just a list of the places we already doubted.
      // `m` is metres, `line` is the same resampled polyline `litScan` walked,
      // so a camera placed on it is standing exactly where the claim was made.
      runsAt: scan.runs.map(x => ({ lit: !!x.lit, m: Math.round(x.m), line: x.line })),
      // The city's reported-dark pins, with the coordinates so a test can fly
      // to one and look at what is standing there — which is the only way this
      // claim has ever been checked and the only way it should be.
      indexDark: LAMPS.nDark, darkAsOf: LAMPS.darkAsOf, darkNearM: WAYFIND.darkNearM,
      inDarkArea: !!scan.inDarkArea,
      reported: scan.reported.length,
      reportedAt: scan.reported.map(i => ({
        at: [LAMPS.dark.X[i], LAMPS.dark.Y[i]], note: LAMPS.darkNotes[i] || '',
      })),
      // ...and the same pins as a position ALONG the walk, in metres, which is
      // what the card's strip draws its ticks from. Exposed so the picture's
      // tick positions are assertable against the scan rather than eyeballed.
      reportedAtM: scan.reportedAtM.map(x => Math.round(x)),
      quote: darkQuoteFor(scan),
      alt: alt ? {
        distM: Math.round(alt.distM), baseDistM: Math.round(r.distM),
        extraM: Math.round(alt.distM - r.distM),
        lamps: altScan.lamps.length, litM: Math.round(altScan.litM),
        pct: Math.round(100 * altScan.pct),
        why: alt.__litWhy || null, reported: altScan.reported.length,
      } : null,
    };
  };
  window.wayfindLitSwap = function (preferLit) { litSwap(!!preferLit); };
  /**
   * Drop the memoised lit-preference weight array, and every route's memoised
   * scan, so the next search re-prices from the current constants.
   *
   * THIS EXISTS BECAUSE ITS ABSENCE INVALIDATED AN A/B. `litEdgeWeights`
   * memoises on the graph object, which is right for the app and fatal for a
   * test: flip `litCanopyMult` or `litAltMult` between two runs in one page and
   * the second run silently answers with the first run's array. The first round
   * of this lane worked around it by loading the page twice and wrote that down;
   * the second round read the note, wrote a one-page A/B anyway, and got a
   * clean-looking "no difference" that measured nothing. A hook is cheaper than
   * the note.
   */
  window.wayfindLitReprice = function () {
    if (G) delete G.__litW;
    if (state.route) delete state.route.__lit;
    return true;
  };
  window.wayfindClear = clear;
  window.wayfindRoute = async function (from, to, opts) {
    opts = opts || {};
    await loadGraph();
    const f = resolve(from), t = resolve(to);
    // §4b — THE CLEAN "NOT ON THIS MAP" SIGNAL, and it has to come out BEFORE
    // the UI is built. Without this branch an off-map code takes one of two
    // wrong exits: `notfound` when the tables are off, which is the word a
    // typo gets, or `nodoor` when they are on, which the card renders as
    // "not walkable in this build yet" — a promise nobody can keep about a
    // building eleven kilometres away. Named `offmap` so a caller can tell the
    // three apart, with the whole record attached so it never has to ask twice.
    const offEnd = (f && f.offMap) || (t && t.offMap) || null;
    if (offEnd) {
      return { ok: false, why: 'offmap', offMap: offEnd, from: f, to: t,
        fromOffMap: (f && f.offMap) || null, toOffMap: (t && t.offMap) || null };
    }
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

  /**
   * THE STAIR ANSWER, for the interface and for the verify harness (§3b).
   *
   * Everything here is measured off the drawn route, never estimated, and
   * every field is something the data can actually back:
   *   sets/list   staircases the route climbs, in walk order, with `dir`
   *               'up' | 'down' | '' — empty means OSM does not say, which is
   *               150 of the 189 staircases on campus, and '' is the truth.
   *   legWays     staircases the two unmapped straight door legs cross. Not
   *               climbed by the router; walked over by you.
   *   clean       no stairs anywhere on this walk, both kinds counted.
   *   stepFree    the verified alternative, or null. `null` with
   *               `stepFreeNone` true means we looked and there is no way
   *               round — 31 of 171 stair routes on this campus.
   * Wording is deliberately NOT here: docs/walk/what-we-can-honestly-say.md
   * owns every sentence, and this returns facts for it to phrase.
   */
  // ROUND 2 — called bare it still reports the route on screen, exactly as
  // round 1 shipped it. Called with a pair it ROUTES, without touching the UI
  // or the map, and re-derives the step-free claim from the graph so a census
  // over hundreds of pairs never has to take the card's word for anything.
  function stairAnswer(r) {
    if (!r || !r.ok || !r.stair) return null;
    const sf = r.stepFree;
    return {
      avoidingStairs: !!r.avoidStairs,
      from: r.from && r.from.code, to: r.to && r.to.code,
      sets: r.stair.sets, ways: r.stair.ways.slice(),
      // ROUND 3 — `place` is what the row actually PRINTS, so a census can
      // check the name a person reads rather than the code behind it.
      list: r.stair.list.map(s => ({ way: s.way, atM: s.atM, m: s.m, dir: s.dir,
        steps: s.steps, code: s.code, place: G ? placeName(G, s.code) : null })),
      listTruncated: r.stair.listTruncated,
      // ROUND 3 — `rows` is what the card DRAWS: consecutive flights at one
      // building grouped into one manoeuvre. `list` above is still one entry
      // per mapped way, and `sets`/`ways` are still counted off that, so a
      // test can check the grouping without losing the ground truth.
      rows: (r.stair.rows || []).map(s => ({ ways: s.ways.slice(), atM: s.atM,
        m: s.m, dir: s.dir, flights: s.flights, code: s.code,
        place: G ? placeName(G, s.code) : null })),
      rowCount: r.stair.rowCount,
      legWays: r.stair.legWays.slice(), legWayCount: r.stair.legWayCount,
      clean: r.stair.clean,
      distM: r.distM, lo: r.time.lo, hi: r.time.hi,
      fromDoor: r.fromDoor, toDoor: r.toDoor,
      stepFree: sf ? {
        clean: sf.clean, distM: Math.round(sf.distM),
        extraM: Math.round(sf.extraM), lo: sf.time.lo, hi: sf.time.hi,
        extraMinLo: sf.extraMinLo, extraMinHi: sf.extraMinHi,
        far: sf.far, sameWalk: sf.sameWalk, doorChanged: sf.doorChanged,
        doorsRefused: sf.doorsRefused, doorsForced: sf.doorsForced,
        fromDoor: sf.fromDoor, toDoor: sf.toDoor,
        // ROUND 3 — the named entrance the card prints, or null when the
        // arrival door did not move.
        toDoorChanged: sf.toDoorChanged, fromDoorChanged: sf.fromDoorChanged,
        toDoorWhere: sf.toDoorWhere,
        // ROUND 8 — the two facts this lane added, on the verification
        // surface as well as on the offer, because a census that cannot see
        // them cannot hold the code to them. Both are null/0 on the ordinary
        // walk, which is most of them.
        doorBarriered: sf.doorBarriered, doorsOffBarriered: sf.doorsOffBarriered,
        doorBarrierFree: sf.doorBarrierFree,
        shortcutM: Math.round(sf.shortcutM || 0),
        avoided: r.stair.sets, vertices: sf.geom.line.length,
      } : null,
      stepFreeNone: !!r.stepFreeNone,
      // 189 is what the FILE holds; 168 is what the router can reach and what
      // the card is allowed to print. Both, so a test can tell them apart.
      graphStaircases: G ? G.swEdges.size : 0,
      routableStaircases: G ? routableStairways(G) : 0,
    };
  }
  /**
   * ROUND 4 — THE WALKED POLYLINE, END TO END, FOR AN OUTSIDE INSTRUMENT.
   *
   * Rounds 1-3 verified "this route is step-free" against `walk_graph.json`'s
   * own STEPS flag — which is asking the object that built the route whether
   * the route is good. `data/ground.geojson` holds the SAME staircases as
   * drawn polygons, baked by a different script from the same OSM cache, and
   * a check against those cannot be fooled by a bad flag, a missed edge, or a
   * door leg nobody thought to test. It needs geometry, so this hands it over.
   *
   * Opt-in (`{ geom: true }`) and verification-only: the card never asks for
   * it and the shipped answer object is byte-for-byte what it was.
   *
   * The two straight door legs are INCLUDED, in walk order, because they are
   * metres a person walks and they are exactly where round 1 found eleven
   * "step-free" routes crossing a staircase.
   */
  function walkGeom(r) {
    if (!r || !r.ok) return null;
    const line = [];
    const push = (p) => {
      const last = line[line.length - 1];
      if (!last || last[0] !== p[0] || last[1] !== p[1]) line.push([p[0], p[1]]);
    };
    if (r.geom.startLeg) for (const p of r.geom.startLeg) push(p);
    for (const p of r.geom.line) push(p);
    if (r.geom.endLeg) for (const p of r.geom.endLeg) push(p);
    return {
      line,
      // The surveyed part and our own two straight lines are DIFFERENT
      // OBJECTS and an instrument has to be able to tell them apart. Handing
      // over only the concatenation cost round 4 an afternoon: a door leg
      // that leaves the end of a 2.1 m flight sits within a metre of it for
      // most of its length, so a corridor test run over the whole walk reads
      // that as "the router climbed this staircase" when the router never
      // went near it. `net` is the graph edges alone.
      net: r.geom.line.map(p => [p[0], p[1]]),
      startLeg: r.geom.startLeg || null,
      endLeg: r.geom.endLeg || null,
    };
  }

  window.wayfindStairs = function (from, to, opts) {
    if (from == null) return stairAnswer(state.route);
    return (async () => {
      const g = await loadGraph();
      const f = resolve(from), t = resolve(to);
      if (!f || !t) return { ok: false, why: 'notfound' };
      const r = computeRoute(g, f, t, { avoidStairs: !!(opts && opts.avoidStairs) });
      if (!r.ok) return { ok: false, why: r.why, from: f.code, to: t.code };
      const a = stairAnswer(r);
      a.ok = true;
      // Re-derive the step-free claim straight from the graph rather than
      // trusting that the filter did what the filter is supposed to do.
      if (a.stepFree) {
        const alt = computeRoute(g, f, t, { avoidStairs: true });
        a.stepFree.verifiedStepEdges = alt.ok
          ? alt.legs.reduce((n, leg) => n + leg.edges.filter(e => g.F[e] & F_STEPS).length, 0) : -1;
        a.stepFree.verifiedLegWays = alt.ok ? alt.stair.legWayCount : -1;
        a.stepFree.verifiedDistM = alt.ok ? alt.distM : -1;
        if (opts && opts.geom) a.stepFree.geom = walkGeom(alt);
      }
      if (opts && opts.geom) a.geom = walkGeom(r);
      return a;
    })();
  };

  // ══════════════════════════════════════════════════════════════════════════
  // 10. THE DAY PLAN — a schedule's whole day of walks, not one leg at a time
  //
  // WHAT THIS IS FOR. Everything above answers ONE question: "I am here, my
  // next class is in WEL". A student with four classes asks it three times a
  // day and has to retype both ends every time, and the answer that matters —
  // which of today's three walks is the one that will make me late — is not
  // any single one of those three answers. It is the SEQUENCE. So this is the
  // sequence: every class the schedule holds, every walk between them, in
  // order, with the one that is next marked, before you pick one to navigate.
  //
  // IT IS A CHOOSER, NOT A SECOND FEATURE. Tapping a walk row calls the same
  // run() the search panel calls, with the same two ends, so the ribbon, the
  // answer bar, `Walk it`, the stairs card and the lighting card are all the
  // ones that already shipped. Nothing here re-implements a route or re-prints
  // a number the bar prints; every figure on a row comes out of the same
  // computeRoute() the bar is drawn from, which is why they cannot disagree.
  //
  // ── THE SEAM, AND WHY IT IS SHAPED LIKE THIS ─────────────────────────────
  // A schedule import's whole job is turning "MAI 220, TTh 2:00pm" into the
  // three-letter code this router already speaks. `docs/import-bar-ut.md`
  // established that UT's own location field IS `{CODE} {FLOOR.ROOM}`, space
  // separated, code first — the same vocabulary as UT_ENTRANCES above — so the
  // normalised shape below is deliberately thin. A plan is:
  //
  //   { day, date, tz, source, items: [ { course, title, code, room, raw,
  //       startMin, endMin, unique, codeSource, codeConfidence } ] }
  //
  // Only `code`, `startMin` and `endMin` are load-bearing. Everything else is
  // display or provenance.
  //
  // THE THREE FIELDS THAT ARE NOT FOR TODAY'S THREE IMPORTERS. `raw`,
  // `codeSource` and `codeConfidence` exist so that an image-OCR importer or a
  // Registration-Plus API importer can land later WITHOUT a rewrite here.
  // Google's, Apple's and UT's .ics all give a code we either read or do not;
  // confidence is 1 or the item is dropped by the parser. An OCR of a
  // photographed timetable cannot do that — it will hand over `MA1` for `MAI`
  // with 0.6 of a belief — and a renderer with no branch for "the code might
  // be wrong" would have to grow one, which is exactly the rewrite. So the
  // branch is here now and today's importers simply never take it: an item
  // with `codeConfidence < WF_DAY.confidenceSure` renders with the raw string
  // it came from and asks to be checked, instead of silently routing to a
  // building nobody has a class in. Nothing else in this file reads a calendar
  // field of any kind.
  //
  // ── WHAT IT MAY SAY ABOUT TIME ───────────────────────────────────────────
  // docs/walk/what-we-can-honestly-say.md §15 rules that this feature may WARN
  // and may never REASSURE, which is why SAY.passingOver and SAY.passingTight
  // exist above with deliberately no third sentence for the good case. That
  // rule gets STRICTER here, not looser, because a day plan is tempting in a
  // way a single leg is not: it would be very easy to print "12 min spare" on
  // every row. It does not. What it prints is the gap the SCHEDULE itself
  // holds — a fact read off the calendar, not a claim about a walk — and it
  // draws the walk's range inside that gap. An empty tail on the bar is left
  // empty and unlabelled. No row anywhere says you will make it.
  //
  // The one thing this does better than the single-leg bar: that bar measures
  // against `WAYFIND.passingMin`, which its own comment calls the only value
  // in the feature with no file behind it. A schedule KNOWS the real gap, so
  // when there is one it is used instead, and the row says which it used.
  // ══════════════════════════════════════════════════════════════════════════

  // ── TASTE (CLAUDE.md rule 11). Every judgement on this surface is one line ─
  const WF_DAY = {
    // Which built-in fixture `?walk=1&day=1` shows. The fixtures are demo and
    // verification data (see DAY_FIXTURES); a real import replaces them.
    demoPlan: 'tth',
    // A walk row is "next" until the class it leads to has begun. After that it
    // is behind you and dims. `nextGraceMin` keeps the row you are ON marked as
    // next for a few minutes after that class started, because someone running
    // late is exactly who is looking at this.
    nextGraceMin: 5,
    // Below this the parser is telling us it is not sure of the code, and the
    // row asks rather than routes. Today's three importers always send 1.
    confidenceSure: 1,
    // ── the gap bar ───────────────────────────────────────────────────────
    // The single strongest thing on a row: the track is the gap the schedule
    // holds, and the walk's own range is drawn inside it. Overflow past the
    // right-hand end is the whole point, so it is drawn, not clipped away.
    gapBar: true,
    gapBarH: 8,            // px. Thick enough to read as a bar, thin enough
                           // that four of them stacked are not the row.
    gapBarR: 2,            // and NOT a pill — same argument as --wf-rail-r
                           // above: a rounded track with a cap is a slider.
    gapBarMinPct: 3,       // a 43 m walk in a 15 minute gap is 3 % of the
                           // track and would otherwise render as nothing at
                           // all, which reads as "no walk" rather than "a
                           // short one"
    gapBarOverPct: 14,     // how much of the track the overflow stub takes
                           // when the slow end of the range runs past the gap
    // The longest gap a bar is drawn for. Past this the bar is all tail and
    // says nothing — a 105-minute lunch gap is not a race, and drawing an
    // eleven-twelfths-empty track next to a 14-22 minute walk makes the walk
    // look like nothing when it is the longest one of the day.
    gapBarMaxMin: 45,
    // ── the ladder (§15) ──────────────────────────────────────────────────
    // 'late'  the FAST end of the range already exceeds the gap
    // 'tight' the SLOW end does
    // null    nothing is printed. There is no third rung and there must not be.
    warnOn: true,
    // A crossing chip is worth a row only when the lights are a real part of
    // the trip. Under this it is noise the answer bar already carries.
    signalChipMin: 3,
    // ── the summary, and the three things it may add (round 4) ────────────
    // NAME THE BAD LEG IN THE HEADER. "2 of 3 walks have something to check"
    // makes you scan three rows to find out which two, and on a phone only two
    // rows are on screen at once — so the header is the only part of this
    // surface that is ALWAYS visible and it was spending itself on a count. It
    // now names the leg, which is a warning and therefore §15-legal; there is
    // still no sentence anywhere for a leg that fits.
    headlineWorst: true,
    // How far you walk today, rolled into the count line. A fact off the
    // router, not a claim about it — and the one number a day plan can give
    // that no per-leg row can.
    totalOnFoot: true,
    // A CLASS THE IMPORTER COULD NOT PLACE IS STILL ON YOUR TIMETABLE. Before
    // round 4 it was dropped, which silently turned a 10am class with a blank
    // room field into a three-hour gap — the worst kind of wrong, because the
    // panel looked complete. Off, it drops them again.
    showUnplaced: true,
    // ── the now line ──────────────────────────────────────────────────────
    // Google Calendar's day view has exactly one thing this list did not: a
    // line across the column at the current time. It is what makes "which one
    // is next" spatial instead of a badge you have to find. Pure fact — the
    // clock — so §15 has no opinion about it.
    nowLine: true,
    nowLineDot: 4,         // px radius of the pip in the time gutter
    // Tint the walk row's own rail when the router says the leg is tight or
    // longer than its gap, so scanning the left edge finds the trouble before
    // any word is read. The NEXT rail stays amber and stays wider — it is a
    // different question and must not be confused with this one.
    warnRail: true,
    // ── layout ────────────────────────────────────────────────────────────
    panelW: 348,           // matches #wf-sheet, because it takes the same slot
    // The scroller's share of the viewport on a DESKTOP (the phone rule lets it
    // fill the sheet instead). 66, not 56: at 56 a four-class day is 470 px of
    // rows in a 448 px scroller, so the last class of the day was permanently
    // one scroll below the fold — photographed, and the whole argument for this
    // surface is that you can see the day. 66 fits four classes and three walks
    // on an 800 px window with the header and the footer.
    listMaxVh: 66,
    railW: 2,
    dotR: 4.5,             // the class pip on the spine
    // ── the clock ─────────────────────────────────────────────────────────
    // `?dayat=HH:MM` freezes it. A screenshot of "which walk is next" cannot be
    // taken against a real clock and be the same picture tomorrow.
    clockFrom: 'real',
    // ── the demo, and the one thing that makes it safe ────────────────────
    // EVERY BUILT-IN FIXTURE DAY IS LABELLED ON SCREEN. Off, the demo is
    // indistinguishable from an import, which is exactly the defect this round
    // found: import M 340L / RTF 305 / C S 439 / EE 460R, tap the button that
    // says "Import my class schedule", and be shown CMS 306M / C S 429 /
    // BA 101S / J 310F — four classes that are not yours, presented as your
    // day. Nothing may turn this off while demoWhenEmpty is on.
    exampleBadge: true,
    // Whether the button may fall back to the demo AT ALL when nothing has
    // been imported. On, because an empty panel reads as a broken feature —
    // and it is only ever honest because of exampleBadge above.
    demoWhenEmpty: true,
    // A parsed schedule is a WEEK. Which of its days opens, when the caller did
    // not say: 'today', or 'first' to always open the first day the schedule
    // has a class on. Either way a day with no classes falls through to the
    // first that has one, because an empty panel reads as a broken import.
    weekFrom: 'today',
  };

  // COPY. Same rule as SAY above: docs/walk/what-we-can-honestly-say.md
  // outranks this file on every question of wording, and §15 is why there is
  // no sentence anywhere below for the case where the walk fits the gap.
  const SAY_D = {
    title: 'My day',
    open: 'Import my class schedule',
    openHint: 'Google Calendar, Apple Calendar or a UT registration export',
    heading: (n, w) => n + (n === 1 ? ' class' : ' classes') + ' · ' +
      w + (w === 1 ? ' walk' : ' walks'),
    toCheck: (n, w) => n + ' of ' + w + (w === 1 ? ' walk has' : ' walks have') +
      ' something to check',
    // ── the header names the leg (round 4) ────────────────────────────────
    // §15 again, and it survives it for the same reason the chips do: every
    // sentence here is a WARNING about a specific leg. There is deliberately no
    // header sentence for a day whose walks all fit — a day with nothing wrong
    // says "4 classes · 3 walks · 2.1 km on foot" and stops.
    worstLate: (a, b) => a + ' → ' + b + ' is longer than its gap',
    worstTight: (a, b) => a + ' → ' + b + ' is the tight one',
    worstTightN: (n) => n + ' of the walks are tight for their gaps',
    onFoot: (d) => d + ' on foot',
    next: 'NEXT',
    now: 'NOW',
    // A real schedule holds classes the importer could not place at all — a
    // blank LOCATION, or a string nothing in this app recognises. Before round
    // 4 such a class was DROPPED, and a dropped 10am class reads on this panel
    // as a three-hour gap, which is worse than any error message: the panel
    // looks complete and is wrong. It now takes an ordinary class row, at its
    // real time, carrying this sentence and — when the importer supplied one —
    // the importer's own explanation underneath it.
    unplaced: (label) => "We don't know where " + label + ' is',
    unplacedWhy: 'The import could not read a building for this class.',
    cannotToLabel: (label) => "We can't take you to " + label,
    cannotFromLabel: (label) => "We can't take you from " + label,
    done: 'Every walk in this day is behind you',
    walkTo: (code) => 'Walk to ' + code,
    gapWas: (m) => m + ' min between them',
    // The passing period, when the schedule does NOT give us a real gap (a
    // day with one class, or two classes that overlap). Same wording as the
    // single-leg bar so the two surfaces cannot be read as two claims.
    gapAssumed: (m) => 'assuming a ' + m + '-minute passing period',
    late: 'Longer than the gap, even at a walking pace',
    tight: 'Tight for this gap',
    stairsOnly: (n) => n + (n === 1 ? ' set' : ' sets') + ' of stairs · no way round it',
    stairs: (n) => n + (n === 1 ? ' set' : ' sets') + ' of stairs',
    stairsFree: (d) => 'a step-free way is ' + d + ' further',
    stairsFreeShorter: (d) => 'a step-free way is ' + d + ' shorter',
    stairsFreeSame: 'a step-free way is no further',
    signals: (n) => 'Crosses ' + n + ' signalised crossings',
    // ── the three ways a real schedule breaks this router ─────────────────
    // Each says WHICH KIND of gap it is, because the three need three
    // different things from a person and lumping them into "can't route
    // there" tells them nothing about which.
    offMap: (code, d, dir) => code + ' is ' + d + ' ' + dir + ' of campus — off this map',
    offMapWhy: 'This map is main campus only.',
    unknown: (code) => "We've never heard of " + code,
    unknownWhy: 'Not in the building list this map was built from.',
    // ...and when the type-ahead had a near miss, SAY it rather than silently
    // walking there. `MAII 220` is a real typo in a real UT calendar export;
    // the useful answer names both halves and lets the student decide.
    unknownMaybe: (code, name) => 'Did you mean ' + code + (name ? ' (' + name + ')' : '') + '?',
    noDoor: (code) => 'No door or path for ' + code,
    noDoorWhy: 'It is in the building list, but nothing is mapped to walk to.',
    // What a WALK row says about the same building. The explanation is on the
    // class row; this is only the consequence for this one leg.
    cannotTo: (code) => "We can't take you to " + code,
    cannotFrom: (code) => "We can't take you from " + code,
    noRoute: 'No walking route between these two',
    lowConf: (raw) => 'Read as “' + raw + '” — check this one',
    // The whole-day banner when a plan holds a building we cannot reach.
    someUnreachable: (n) => n + (n === 1 ? ' class is' : ' classes are') +
      ' somewhere this map cannot take you',
    someUnplaced: (n) => n + (n === 1 ? ' class has' : ' classes have') +
      ' no building we could read',
    close: 'Close the day plan',
    source: { google: 'Google Calendar', apple: 'Apple Calendar', ut: 'UT registration',
      image: 'a photo of a schedule', api: 'Registration Plus', manual: 'typed in' },
    from: (s) => 'From ' + s,
    // THE DEMO SAYS IT IS A DEMO, IN TWO PLACES. The badge rides in the header,
    // which is the one strip of this panel always on screen on a 390 px phone;
    // the footer replaces "From UT registration" — a sentence that, on a demo,
    // was a claim about a file the student never gave us.
    exampleBadge: 'EXAMPLE',
    // PROVENANCE AND AUTHENTICITY ARE TWO DIFFERENT FACTS, and the footer says
    // both. "From UT registration" is what the DATA claims about where it came
    // from — true of a fixture built out of real UT LOCATION lines, and a trip
    // dayview.mjs already asserts survives from the parser's shape to here.
    // What the footer could not say before is that the data is not the
    // student's, which is the half that matters and the half the badge repeats
    // in the header.
    fromExample: (s) => 'From ' + s + ' — sample data, not your schedule',
  };

  /**
   * THE DAY PLAN'S STYLESHEET, injected rather than added to style.css.
   *
   * WHY INJECTED. style.css belongs to another lane this round. More
   * importantly the RECORDING GATE lives in it, as
   * `.clip #wf-button,.clip #wf-sheet,.clip #wf-pill{display:none!important}`,
   * with a comment claiming "every element this feature has ever added is a
   * CHILD of one of these three, which is why the rule has not had to grow as
   * the bar did". This surface adds two elements that are children of
   * `#wf-root` and of neither of those three, so that claim stops being true
   * here. The gate for them is therefore in this block, one line, next to the
   * elements it covers — and the one-line consolidation for whoever owns
   * style.css is written down in docs/si-dayview.md rather than made from here.
   *
   * `?clip=1`, `?autopilot=1` and `?sliderdemo=1` all put `.clip` on <html> in
   * index.html's head script, so one rule covers all three recording surfaces.
   *
   * Every size and colour below is either a token off `#wf-root` (so the day
   * plan cannot drift from the answer bar it feeds) or a WF_DAY value written
   * in from JS. Nothing here is a number typed twice.
   */
  const DAY_CSS = `
.clip #wf-day,.clip #wf-day-btn{display:none!important}
#wf-day.hidden{display:none}

/* THE WAY IN. A row at the foot of the search sheet, above the small print. It
   is a row and not a chip because what it offers is a different SHAPE of answer
   — a whole day rather than one leg — and a two-line label is what says that. */
#wf-day-btn{display:flex;align-items:center;gap:10px;width:100%;box-sizing:border-box;
  margin:0;padding:10px 14px;background:rgba(255,255,255,.05);border:none;
  border-top:1px solid var(--wf-edge-soft);color:var(--wf-ink);font:inherit;
  text-align:left;cursor:pointer}
#wf-day-btn:hover,#wf-day-btn.on{background:var(--wf-hot)}
#wf-day-btn .wf-day-btn-ic{width:17px;height:17px;flex:none;color:var(--wf-accent)}
.wf-day-btn-l{display:flex;flex-direction:column;gap:1px;min-width:0}
.wf-day-btn-l1{font-size:12.5px;font-weight:600}
.wf-day-btn-l2{font-size:var(--wf-small);color:var(--wf-dimmer)}

/* THE PANEL takes the search sheet's slot, because it answers the same
   question at a different scale and two panels in one corner is two panels. */
#wf-day{position:absolute;top:68px;left:16px;z-index:30;
  width:__PANELW__px;max-width:calc(100vw - 32px);
  background:var(--wf-glass-solid);backdrop-filter:blur(14px) saturate(1.1);
  border:1px solid rgba(255,190,90,.18);border-radius:var(--wf-radius);
  box-shadow:var(--wf-shadow);color:var(--wf-ink);font-size:12.5px;overflow:hidden;
  display:flex;flex-direction:column;text-align:left}
#wf-day-head{display:flex;align-items:center;justify-content:space-between;
  padding:10px 10px 6px 14px;flex:none}
#wf-day-title{font-size:11px;font-weight:700;letter-spacing:.17em;text-transform:uppercase;
  color:var(--wf-dim)}
/* THE EXAMPLE BADGE rides INSIDE the title line rather than taking a row of
   its own, so labelling the demo costs the panel no height — dayview.mjs
   asserts the whole panel fits a 390x844 phone, and a new row would have been
   a real risk to a shipped assertion for a purely additive label. */
.wf-d-example{margin-left:7px;padding:1px 5px;border-radius:4px;
  background:rgba(255,190,90,.16);color:#ffc077;font-weight:800;font-size:9.5px;
  letter-spacing:.14em}
#wf-day-close{background:none;border:none;color:inherit;opacity:.6;cursor:pointer;
  width:30px;height:30px;display:grid;place-items:center;padding:0;border-radius:8px}
#wf-day-close svg{width:15px;height:15px}
#wf-day-close:hover{opacity:1;background:rgba(255,255,255,.07)}

/* THE SUMMARY. Three facts, in falling order of how much they change what you
   do: how big the day is, how many of its walks have something wrong with
   them, and whether any of its classes is somewhere this map cannot go. The
   second is the one this whole surface exists to put on screen at a glance. */
#wf-day-sum{display:flex;flex-direction:column;gap:3px;padding:0 14px 9px;flex:none;
  border-bottom:1px solid var(--wf-edge-soft)}
.wf-d-count{font-size:14px;font-weight:600}
.wf-d-count-sub{font-weight:400;color:var(--wf-dim)}
/* The COUNT of flagged walks sits below the NAMED one and is set quieter than
   it, because two amber lines running together read as one paragraph nobody
   ranks. Which leg is the actionable half; how many is the footnote. */
.wf-d-checks{font-size:11.5px;color:var(--wf-dim)}
.wf-d-unreach{font-size:11.5px;color:var(--wf-dim)}
/* THE HEADER'S NAMED LEG. Set in the same warning amber the tight chip on the
   row carries, so the header and the row you scroll to are visibly one claim
   and not two. */
.wf-d-worst{font-size:11.5px;color:#ffc077;font-weight:600}

#wf-day-list{overflow-y:auto;min-height:0;max-height:__LISTVH__vh;padding:4px 0 2px}
#wf-day-foot{padding:7px 14px 9px;border-top:1px solid rgba(255,190,90,.11);
  font-size:9.5px;color:var(--wf-dimmer);flex:none}

/* A ROW IS THREE COLUMNS: when, the spine, and what happens.
   The spine is continuous down the whole list — the same argument as the
   itinerary's thread above: the picture and the list cannot say different
   things if the picture IS the list. */
.wf-d-row{display:grid;grid-template-columns:46px 16px 1fr;align-items:stretch;
  width:100%;box-sizing:border-box;padding:0 12px 0 10px;text-align:left;
  background:none;border:none;color:inherit;font:inherit}
.wf-d-when{padding-top:7px;text-align:right;padding-right:2px}
.wf-d-t1{font-size:11.5px;font-weight:600;color:var(--wf-ink)}
.wf-d-t2{font-size:10px;color:var(--wf-dimmer)}
.wf-d-t3{font-size:10px;color:var(--wf-dimmer);padding-top:2px}
.wf-d-walk.next .wf-d-t3{color:var(--wf-dim)}
.wf-d-rail{position:relative}
.wf-d-rail:before{content:"";position:absolute;left:50%;top:0;bottom:0;
  width:__RAILW__px;margin-left:-__RAILHALF__px;background:var(--wf-spine-col)}
.wf-d-dot{position:absolute;left:50%;top:11px;width:__DOTD__px;height:__DOTD__px;
  margin-left:-__DOTR__px;border-radius:50%;background:var(--wf-mk-col);
  box-shadow:0 0 0 3px var(--wf-glass-solid)}
.wf-d-body{padding:6px 0 8px;min-width:0}

/* ── A CLASS ──────────────────────────────────────────────────────────────
   Deliberately the quiet row. The classes are the anchors; the WALKS are the
   thing you can act on, and a day plan that gives them the same weight is a
   calendar with a map in it rather than a walking plan. */
.wf-d-class .wf-d-course{font-size:13px;font-weight:600;line-height:1.25}
.wf-d-class.in .wf-d-course{color:var(--wf-accent)}
.wf-d-class.in .wf-d-dot{background:var(--wf-accent)}
.wf-d-nowtag{margin-left:7px;font-size:9px;font-weight:700;letter-spacing:.14em;
  color:var(--wf-go-ink);background:var(--wf-accent);border-radius:4px;padding:1px 4px;
  vertical-align:1px}
.wf-d-place{font-size:11px;color:var(--wf-dim);line-height:1.3;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wf-d-where{display:flex;align-items:baseline;gap:6px;margin-top:1px}
.wf-d-code{font-size:11.5px;font-weight:700;letter-spacing:.06em;color:#ffcf7a}
/* An end of a walk that has NO building code — the class stands in for it. It
   must not be set in the code's colour and weight: a course number that looks
   like a building code is this surface asserting a code it never read. */
.wf-d-noplace{font-size:11.5px;font-weight:600;color:var(--wf-dim);font-style:italic}
.wf-d-room{font-size:11px;color:var(--wf-dimmer)}

/* ── A WALK ───────────────────────────────────────────────────────────────
   The row you can press. The minutes are the biggest thing on it, for the same
   reason they are the biggest thing on the answer bar: it is the one number
   read at a glance. */
.wf-d-walk{cursor:pointer;position:relative}
.wf-d-walk:disabled{cursor:default}
.wf-d-walk .wf-d-rail-w:before{background:var(--wf-rail)}
.wf-d-walk:hover:not(:disabled){background:rgba(255,255,255,.045)}
.wf-d-walk.past{opacity:.42}
/* THE ROW THAT DOES NOT FIT ITS GAP, WASHED. Google Calendar's day view puts
   colour on the BLOCK; ours had colour only on the rail, and the rail was
   already spent on "next". So this is a second, independent channel: "next"
   owns the rail and the gutter badge, "does not fit" owns the row's ground,
   and a row can be both without either mark being misread. Faint on purpose —
   it has to survive being stacked three deep without turning the list into a
   warning, and .picked below deliberately outranks it, because which row you
   are actually navigating is the more urgent fact once you have chosen one. */
.wf-d-walk.warn{background:rgba(255,192,119,.055)}
.wf-d-walk.warn-late{background:rgba(255,143,107,.08)}
.wf-d-walk.picked{background:rgba(245,166,35,.13)}
/* WHICH ONE IS NEXT, and it is the only amber rail in the list. Everything
   else on this surface is set in the answer bar's quiet cream; one warm rail
   and one warm word is the whole "at a glance" budget, spent on the one row
   that is about to matter. */
.wf-d-walk.next .wf-d-rail-w:before{background:var(--wf-accent);width:__RAILNEXTW__px;
  margin-left:-__RAILNEXTH__px}
.wf-d-walk.next .wf-d-min{color:var(--wf-accent)}
.wf-d-next{font-size:9px;font-weight:700;letter-spacing:.13em;color:var(--wf-accent);
  padding-top:9px}
.wf-d-fig{display:flex;align-items:baseline;gap:5px;flex-wrap:wrap}
.wf-d-mode{width:var(--wf-mode);height:var(--wf-mode);font-size:17px;flex:none;
  align-self:center;color:var(--wf-dim)}
.wf-d-min{font-size:17px;font-weight:700;letter-spacing:-.01em;line-height:1.1}
.wf-d-unit{font-size:10.5px;color:var(--wf-dim)}
.wf-d-dist{font-size:11px;color:var(--wf-dim);margin-left:2px}
.wf-d-figoff .wf-d-min{color:var(--wf-dimmer)}
.wf-d-ends{display:flex;align-items:center;gap:5px;margin-top:3px;flex-wrap:wrap}
.wf-d-arr{width:12px;height:12px;color:var(--wf-dimmer);flex:none}
.wf-d-gap{font-size:10px;color:var(--wf-dimmer);margin-left:2px}

/* ── THE NOW LINE ─────────────────────────────────────────────────────────
   The one thing Google Calendar's day view has that this list did not. It
   answers "which one is next" SPATIALLY — everything above it has happened,
   everything below it has not — which is a different and faster act of reading
   than finding a badge. It is drawn between two rows, at the position in the
   sequence the clock is actually at, and it carries the time in the same
   gutter every other row puts its time in, so the column stays one clock.

   Deliberately NOT proportional. A calendar column is a ruler and this is a
   list, so the line sits BETWEEN rows rather than at a pixel offset inside
   one: a 105-minute lunch gap would otherwise push the afternoon off the
   bottom to make room for empty air. */
.wf-d-now{display:grid;grid-template-columns:46px 16px 1fr;align-items:center;
  width:100%;box-sizing:border-box;padding:0 12px 0 10px;margin:1px 0}
.wf-d-now-t{text-align:right;padding-right:2px;font-size:10px;font-weight:700;
  color:var(--wf-accent);letter-spacing:.02em}
.wf-d-now-p{position:relative;height:__NOWD__px}
.wf-d-now-p:before{content:"";position:absolute;left:50%;top:0;
  width:__NOWD__px;height:__NOWD__px;margin-left:-__NOWR__px;border-radius:50%;
  background:var(--wf-accent)}
.wf-d-now-l{height:1px;background:var(--wf-accent);opacity:.55}

/* ── THE GAP BAR ──────────────────────────────────────────────────────────
   The track is the gap the schedule holds. Solid to the fast end of the walk,
   lighter out to the slow end, and the tail left EMPTY AND UNLABELLED — the
   honesty doc's §15 lets us draw what the calendar says and forbids us saying
   you will make it, and an empty tail says the first without saying the
   second. Overflow is drawn OUTSIDE the track, because a walk that does not
   fit is the one state worth seeing from across the room. */
.wf-d-bar{margin:5px 0 1px;display:flex;align-items:center}
.wf-d-bar-tr{display:flex;height:__BARH__px;border-radius:__BARR__px;overflow:hidden;
  width:100%;background:rgba(255,255,255,.07)}
.wf-d-bar-lo{background:var(--wf-fill)}
.wf-d-bar-hi{background:var(--wf-rail)}
.wf-d-bar-ov{background:repeating-linear-gradient(-45deg,#ff8f6b 0 3px,#7a2f18 3px 6px);
  flex:none;margin-left:auto}
.wf-d-bar.over .wf-d-bar-tr{box-shadow:inset 0 0 0 1px rgba(255,143,107,.5)}

/* ── A CHIP ───────────────────────────────────────────────────────────────
   One problem, one line, and its own colour only where the colour is earned.
   Only the late chip changes what you do today; everything else is amber
   or grey, because five colours on a four-row list is a colour key nobody
   reads. */
.wf-d-chip{display:flex;align-items:flex-start;gap:5px;margin-top:4px;
  font-size:11px;line-height:1.35;color:var(--wf-dim)}
.wf-d-chip-ic{width:13px;height:13px;flex:none;margin-top:1px}
.wf-d-chip-s{color:var(--wf-dimmer)}
.wf-d-late{color:#ffab8c}
.wf-d-tight{color:#ffc077}
.wf-d-stairsOnly{color:#ffc077}
.wf-d-stairs{color:var(--wf-dim)}
.wf-d-off{color:#ffab8c}
.wf-d-class .wf-d-off{color:rgba(255,171,140,.85)}

@media(max-width:640px){
  /* Same slot the search sheet takes on a phone, and for the same reasons:
     above the drive controls, clear of the time-of-day panel on the right.
     IT IS TALLER THAN THE SEARCH SHEET, THOUGH, AND MEASURED RATHER THAN
     COPIED. At the sheet's 62vh the day plan is 337 px on an 844 px phone: it
     showed one class, one walk and the top of the next class, with 321 px of
     empty sky above it. A search panel is short by nature and a day is not.
     78vh puts its top edge at y186 — below the two rows of top buttons
     (16..112), which is the thing that must not be covered.
     WITH A ROUTE DRAWN it goes back to 62vh, because the answer bar then owns
     the top of the screen (--wf-pill-top is 120 px and the closed bar runs
     to about 310) and a taller list would slide underneath it. wf-routed is
     already on <body> whenever a route exists, so this costs no new state. */
  #wf-day{--wf-tod-clear:calc(8px + var(--touch-min) + 14px + 8px);
    top:auto;bottom:var(--drive-clear);left:8px;right:var(--wf-tod-clear);width:auto;
    max-width:none;max-height:calc(78vh - var(--drive-clear));border-radius:16px}
  body.wf-routed #wf-day{max-height:calc(62vh - var(--drive-clear))}
  #wf-day-list{max-height:none;flex:1 1 auto}
  /* A WALK ROW IS A THUMB TARGET. It is the control that decides which of
     three walks gets drawn on the ground, so it takes --touch-min like the
     result rows next door do. The class rows do not: they are not pressable
     and giving them the same height would push the walks off the screen. */
  .wf-d-walk{min-height:var(--touch-min)}
  .wf-d-walk .wf-d-body{padding:8px 0 10px}
}
`.replace(/__PANELW__/g, String(WF_DAY.panelW))
  .replace(/__LISTVH__/g, String(WF_DAY.listMaxVh))
  .replace(/__RAILNEXTW__/g, String(WF_DAY.railW + 1))
  .replace(/__RAILNEXTH__/g, String((WF_DAY.railW + 1) / 2))
  .replace(/__RAILHALF__/g, String(WF_DAY.railW / 2))
  .replace(/__RAILW__/g, String(WF_DAY.railW))
  .replace(/__DOTD__/g, String(WF_DAY.dotR * 2))
  .replace(/__DOTR__/g, String(WF_DAY.dotR))
  .replace(/__NOWD__/g, String(WF_DAY.nowLineDot * 2))
  .replace(/__NOWR__/g, String(WF_DAY.nowLineDot))
  .replace(/__BARH__/g, String(WF_DAY.gapBarH))
  .replace(/__BARR__/g, String(WF_DAY.gapBarR));

  /** This surface's own glyphs. A separate object from IC above on purpose:
   *  four lanes are inside this file this round and appending a key to a shared
   *  literal is the one edit that conflicts every time. */
  const IC_D = {
    cal: 'M4.5 6.8a1.8 1.8 0 0 1 1.8-1.8h11.4a1.8 1.8 0 0 1 1.8 1.8v11.4a1.8 1.8 0 0 1-1.8 1.8H6.3a1.8 1.8 0 0 1-1.8-1.8zM4.5 9.6h15M8.6 3.2v3.4M15.4 3.2v3.4',
    warn: 'M12 4.4 21 19.6H3zM12 10v4M12 17.2v.01',
    stairs: 'M3 20h4v-4h4v-4h4V8h4V4',
    info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 11v5.4M12 7.6v.01',
    arrowR: 'M4.5 12h14M13 6.5 18.5 12 13 17.5',
  };

  /**
   * THE FIXTURES. Demo and verification data, not a shipped feature — a real
   * import replaces `items` wholesale. They are here rather than in a JSON file
   * for the same reason UT_CELEBRATED is a literal table: a fixture in the file
   * cannot go stale against a fetch that fails.
   *
   * `tth` and `mwf` are ordinary days on UT's own two class grids (TTh: 75
   * minutes, 15 between; MWF: 50 minutes, 10 between). Every location string in
   * `tth` is verbatim a real UT `LOCATION:` line quoted in
   * `docs/import-bar-ut.md` from UT-Registration-Plus's own test fixtures, so
   * the format being parsed is a real one and not one invented here.
   *
   * `gaps` is CONSTRUCTED, and says so: it is `tth` with two classes moved onto
   * the two codes the forcing function names — SSW, which is a real registered
   * main-campus building this app has never heard of, and BE1, which is a real
   * UT building eleven kilometres north at the Pickle Research Campus. Nobody's
   * real Tuesday looks like that; the renderer still has to survive it.
   */
  const DAY_FIXTURES = {
    tth: {
      day: 'Tuesday', source: 'ut', tz: 'America/Chicago',
      items: [
        { course: 'CMS 306M', title: 'Professional Communication Skills',
          raw: 'CMA 6.146', startMin: 570, endMin: 645 },
        { course: 'C S 429', title: 'Computer Organization and Architecture',
          raw: 'UTC 3.102', startMin: 660, endMin: 735, unique: '54795' },
        { course: 'BA 101S', title: 'Business Foundations',
          raw: 'GSB 2.122', startMin: 750, endMin: 825 },
        { course: 'J 310F', title: 'Fundamental Issues in Journalism',
          raw: 'DMC 3.208', startMin: 840, endMin: 915 },
      ],
    },
    mwf: {
      day: 'Monday', source: 'google', tz: 'America/Chicago',
      items: [
        { course: 'ECO 304K', title: 'Introduction to Microeconomics',
          raw: 'WAG 214', startMin: 540, endMin: 590 },
        { course: 'UGS 302', title: 'Undergraduate Signature Course',
          raw: 'FAC 21', startMin: 600, endMin: 650 },
        { course: 'CH 301', title: 'Principles of Chemistry I',
          raw: 'WEL 2.122', startMin: 660, endMin: 710 },
        { course: 'ARH 301', title: 'Introduction to the Visual Arts',
          raw: 'ART 1.102', startMin: 720, endMin: 770 },
      ],
    },
    gaps: {
      day: 'Thursday', source: 'apple', tz: 'America/Chicago',
      items: [
        { course: 'SW 327', title: 'Social Work Practice',
          raw: 'SSW 2.132', startMin: 570, endMin: 645 },
        { course: 'C S 429', title: 'Computer Organization and Architecture',
          raw: 'UTC 3.102', startMin: 660, endMin: 735 },
        // ONE LEG OF THIS DAY HAS TO WORK. A fixture where every walk is
        // blocked cannot show that the good rows and the bad rows sit in one
        // list and read as one sequence — which is the whole claim being made
        // about a mixed day. UTC -> GSB is 43 m and routes.
        { course: 'BA 101S', title: 'Business Foundations',
          raw: 'GSB 2.122', startMin: 750, endMin: 825 },
        { course: 'BME 383J', title: 'Laboratory Rotation',
          raw: 'BE1 1.100', startMin: 900, endMin: 1020 },
      ],
    },
  };

  /**
   * A WEEK, IN THE PARSER LANE'S OWN PUBLISHED SHAPE (`ut-walk-schedule` v1,
   * docs/si-parser.md). Round 3 documented the day shape and stopped there,
   * so nothing had ever made the trip from a parsed calendar to this panel.
   * `?walk=1&day=week` makes it, through `wayfindDayFromSchedule` below.
   *
   * WHAT IT IS AND IS NOT. It is hand-written to the published shape, so it
   * proves the ADAPTER without needing the parser branch in the tree — which
   * is what lets this lane verify itself. It is NOT a claim that the parser
   * emits exactly this; that claim needs the parser's own .ics run through the
   * parser's own code, and docs/si-dayview.md records that run separately.
   *
   * The Tuesday it holds is UT's real TTh grid (75-minute classes, 15 between)
   * and its four LOCATION strings are the same real ones the `tth` fixture
   * uses. The Monday/Wednesday classes exist so that picking a day is a real
   * choice rather than a formality, and PSY 301 exists because a real export
   * has a class with a blank LOCATION in it and this panel used to silently
   * delete that class from the student's day.
   */
  const DAY_SCHED_FIXTURE = {
    shape: 'ut-walk-schedule', version: 1, tz: 'America/Chicago',
    source: { kind: 'ics', label: 'My Schedule',
      producer: '-//UT Registration Plus//Course Schedule//EN',
      url: '', importedAt: null },
    events: [
      { index: 1, id: 'ev-1', course: 'CMS 306M', title: 'CMS 306M – PROFESSIONAL COMMUNICATION',
        locationText: 'CMA 6.146', code: 'CMA', room: '6.146', days: ['TU', 'TH'],
        startMin: 570, endMin: 645, firstDate: '2026-08-25', lastDate: '2026-12-08',
        exDates: [], tz: 'America/Chicago', status: 'ok', problems: [], confidence: null },
      { index: 2, id: 'ev-2', course: 'C S 429', title: 'C S 429 – COMP ORGANIZATN AND ARCH',
        locationText: 'UTC 3.102', code: 'UTC', room: '3.102', days: ['TU', 'TH'],
        startMin: 660, endMin: 735, firstDate: '2026-08-25', lastDate: '2026-12-08',
        exDates: [], tz: 'America/Chicago', status: 'ok', problems: [], confidence: null },
      { index: 3, id: 'ev-3', course: 'BA 101S', title: 'BA 101S – BUSINESS FOUNDATIONS',
        locationText: 'GSB 2.122', code: 'GSB', room: '2.122', days: ['TU', 'TH'],
        startMin: 750, endMin: 825, firstDate: '2026-08-25', lastDate: '2026-12-08',
        exDates: [], tz: 'America/Chicago', status: 'ok', problems: [], confidence: null },
      // THE ONE THAT DID NOT IMPORT. A blank LOCATION is the commonest way a
      // real export loses a class, and before round 4 this row was dropped —
      // which turned a 2:00pm class into empty afternoon on a panel that
      // otherwise looked complete.
      { index: 4, id: 'ev-4', course: 'PSY 301', title: 'PSY 301 – INTRODUCTION TO PSYCHOLOGY',
        locationText: '', code: null, room: '', days: ['TU', 'TH'],
        startMin: 840, endMin: 915, firstDate: '2026-08-25', lastDate: '2026-12-08',
        exDates: [], tz: 'America/Chicago', status: 'failed', confidence: null,
        problems: [{ level: 'error', code: 'LOCATION_MISSING',
          text: 'Row 4 (PSY 301 – INTRODUCTION TO PSYCHOLOGY) has no location, so there is nowhere to walk to.',
          hint: 'Every class needs a building before it can be walked to.',
          at: { event: 4, line: 31, field: 'LOCATION' } }] },
      { index: 5, id: 'ev-5', course: 'ACC 311', title: 'ACC 311 – FUNDAMENTALS OF ACCOUNTING',
        locationText: 'WAG 214', code: 'WAG', room: '214', days: ['MO', 'WE'],
        startMin: 570, endMin: 620, firstDate: '2026-08-26', lastDate: '2026-12-07',
        exDates: [], tz: 'America/Chicago', status: 'ok', problems: [], confidence: null },
      { index: 6, id: 'ev-6', course: 'CH 301', title: 'CH 301 – PRINCIPLES OF CHEMISTRY I',
        locationText: 'WEL 2.122', code: 'WEL', room: '2.122', days: ['MO', 'WE'],
        startMin: 630, endMin: 680, firstDate: '2026-08-26', lastDate: '2026-12-07',
        exDates: [], tz: 'America/Chicago', status: 'ok', problems: [], confidence: null },
      // THE TYPO, kept off Tuesday so the demo day stays an ordinary four-class
      // one. `MAII 220` is a real mis-typing of `MAI 220` and it is verbatim in
      // the parser lane's own `messy.ics`; the parser reads the shape, hands
      // back the code `MAII`, and marks the row failed. Before round 4 this
      // panel drew a confident walk to the UT TOWER for it, because the code
      // went through `resolve()`, which is the field's forgiving type-ahead.
      // See dayPlace(). This event is the fixture for that fix.
      { index: 7, id: 'ev-7', course: 'HIS 315K', title: 'HIS 315K – THE UNITED STATES 1492-1865',
        locationText: 'MAII 220', code: 'MAII', room: '220', days: ['MO', 'WE'],
        startMin: 720, endMin: 770, firstDate: '2026-08-26', lastDate: '2026-12-07',
        exDates: [], tz: 'America/Chicago', status: 'failed', confidence: null,
        problems: [{ level: 'error', code: 'BUILDING_UNKNOWN',
          text: 'Row 7 (HIS 315K): "MAII 220" is not a UT building code.',
          hint: 'Class locations read like "WEL 2.224".',
          at: { event: 7, line: 44, field: 'LOCATION' } }] },
    ],
    problems: [], counts: { total: 7, ok: 5, failed: 2, errors: 2, warnings: 0 },
    summary: 'Imported 5 of 7 classes. 2 could not be used.',
  };

  let dayEl = null;              // the panel, built once
  let dayPlan = null;            // the normalised plan on screen
  let dayRows = null;            // the computed sequence (classes and walks)
  let dayPicked = -1;            // which walk row is drawn on the ground
  let dayBtn = null;             // the way in, appended to the search sheet
  let dayBBox = null;            // the routable graph's own extent

  // ── THE SEAM, IN CODE ─────────────────────────────────────────────────────
  /**
   * Take whatever an importer produced and make it safe to render. It is
   * deliberately forgiving about what it is given and strict about what it
   * hands on: an item with no usable time or no code is DROPPED rather than
   * rendered half-formed, because half a row on a schedule is worse than a
   * missing one.
   *
   * `raw` is split exactly as docs/import-bar-ut.md's recon says UT's own
   * field is shaped — first token is the code, the rest is the room — but only
   * when the importer did not already separate them. An importer that knows
   * better (an API, say) sets `code` and `room` itself and this never runs.
   */
  function dayNormalise(plan) {
    if (!plan || !plan.items) return null;
    const items = [];
    for (const it of plan.items) {
      let code = it.code, room = it.room, src = it.codeSource;
      if (!code && it.raw) {
        const parts = String(it.raw).trim().split(/\s+/);
        code = parts[0]; room = parts.slice(1).join(' ');
        src = src || 'location-field';
      }
      // A CLASS WITH NO USABLE TIME IS STILL DROPPED. Time is the one field
      // this surface cannot render around: the whole panel is an ordering, and
      // a row with no place in the order has nowhere to go.
      const a = Number(it.startMin), b = Number(it.endMin);
      if (!isFinite(a) || !isFinite(b) || b <= a) continue;
      // A CLASS WITH NO CODE IS NOT. Round 3 dropped it, and dropping it is the
      // worst available answer: a 10am class whose LOCATION field was blank
      // vanished, and the panel then showed a three-hour gap that the student's
      // day does not have. It looked complete and it was wrong. It now takes an
      // ordinary row at its real time, marked as unplaced, and the two walks
      // either side of it say they cannot be taken. `note` is whatever the
      // importer wanted to say about it — the parser lane's own sentence for
      // this event, when there is one.
      if (!code) {
        if (!WF_DAY.showUnplaced) continue;
        items.push({
          course: it.course || null, title: it.title || null,
          code: null, room: '', raw: it.raw || null,
          label: it.course || it.title || String(it.raw || '').trim() || null,
          note: it.note || null,
          startMin: a, endMin: b, unique: it.unique || null,
          codeSource: src || 'none', codeConfidence: 0, unplaced: true,
        });
        continue;
      }
      items.push({
        course: it.course || null, title: it.title || null,
        code: String(code).toUpperCase(), room: room || '',
        raw: it.raw || (room ? code + ' ' + room : code),
        label: it.course || it.title || String(code).toUpperCase(),
        note: it.note || null,
        startMin: a, endMin: b, unique: it.unique || null,
        codeSource: src || 'given',
        codeConfidence: it.codeConfidence == null ? 1 : Number(it.codeConfidence),
        unplaced: false,
      });
    }
    items.sort((x, y) => x.startMin - y.startMin);
    if (!items.length) return null;
    return { day: plan.day || null, date: plan.date || null,
      source: plan.source || 'manual', tz: plan.tz || null,
      example: !!plan.example, items };
  }

  /** The routable city's own extent, so "off this map" is measured rather than
   *  asserted against a hardcoded list of eleven codes that would go stale the
   *  next time the graph is rebaked. */
  function dayBounds() {
    if (dayBBox || !G) return dayBBox;
    let w = 180, s = 90, e = -180, n = -90;
    for (let i = 0; i < G.X.length; i++) {
      if (G.X[i] < w) w = G.X[i];
      if (G.X[i] > e) e = G.X[i];
      if (G.Y[i] < s) s = G.Y[i];
      if (G.Y[i] > n) n = G.Y[i];
    }
    dayBBox = { w, s, e, n, c: [(w + e) / 2, (s + n) / 2] };
    return dayBBox;
  }

  /**
   * WHICH OF THE FOUR THINGS A CODE IS. A real schedule names a real building
   * and this app can be in one of four states about it, and they need four
   * different sentences:
   *
   *   ok       routable, walk to it
   *   nodoor   in the register, but we hold no door or no path — "not walkable
   *            in this build yet", which SAY.notWalkable already says
   *   offmap   UT publishes a door for it and the door is outside the extent of
   *            the graph we route on. Ten of the eleven codes the forcing
   *            function names are this, at 10.8-11.8 km north (Pickle Research
   *            Campus), measured here rather than looked up.
   *   unknown  nothing in this app has ever heard of it. SSW is this, and it is
   *            NOT the same problem as Pickle: SSW is a real registered
   *            main-campus building 900 m from the Tower with two doors in
   *            UT_CELEBRATED above, which the search index simply does not
   *            carry. Telling a student "off the map" about a building they
   *            can see from the Tower would be a lie.
   */
  function dayPlace(code) {
    const up = String(code || '').toUpperCase();
    const hit = G ? resolve(up) : null;
    // ── A CODE OFF A SCHEDULE IS EXACT VOCABULARY, NOT A TYPE-AHEAD QUERY ──
    // `resolve()` is `search()[0]`, and `search()` is the FORGIVING type-ahead
    // the field uses so that typing "wel" finds Welch. Handing a schedule's
    // building code straight to it means a typo routes: the parser lane's
    // `messy.ics` carries the real-world typo `MAII 220`, the parser correctly
    // hands back the code `MAII` and marks the row failed — and until this line
    // existed, this panel drew a confident 10-14 minute walk to the UT TOWER
    // for a class that is not in it. Nothing was red; the walk was measured,
    // the row was pretty, and the building was wrong.
    //
    // Found by running the merged tree (this lane + acer/si-parser) against the
    // parser's own fixture files, which is the only place it can be found:
    // every fixture on this branch alone spells its codes correctly.
    //
    // So an inexact hit is not a hit. It is kept only as a SUGGESTION, which is
    // the useful half of what the type-ahead knew.
    const entry = hit && String(hit.code || '').toUpperCase() === up ? hit : null;
    const near = (hit && !entry) ? { code: hit.code, name: hit.display } : null;
    if (entry && entry.routable) return { kind: 'ok', code: up, entry, name: entry.display };
    // ── SI6: `nodoor` IS THE SENTENCE FOR A BUILDING ON THIS CAMPUS ────────
    // `si-gaps` put the ten Pickle codes into `search()` as entries carrying an
    // `offMap` record. They have no doors, so `entry.routable` is false, so
    // before this clause tested for it every one of them was answered "It is in
    // the building list, but nothing is mapped to walk to" — which is true of a
    // building 400 m away whose door we have not surveyed, and a lie about one
    // eleven kilometres north. Falling through instead reaches this function's
    // own off-map branch below, which measures the distance and says it.
    if (entry && !entry.offMap) return { kind: 'nodoor', code: up, entry, name: entry.display };
    const code2 = up;
    const ut = utIndex().get(up);
    const bb = dayBounds();
    if (ut && ut.length && bb) {
      const ll = [ut[0].lon, ut[0].lat];
      const out = ll[0] < bb.w || ll[0] > bb.e || ll[1] < bb.s || ll[1] > bb.n;
      if (out) {
        const d = metresBetween(ll, bb.c);
        const brg = (Math.atan2(ll[0] - bb.c[0], ll[1] - bb.c[1]) * 180 / Math.PI + 360) % 360;
        return { kind: 'offmap', code: code2, entry: null, name: null,
          distM: d, dir: COMPASS8[Math.round(brg / 45) % 8] };
      }
      // UT knows it, it is on this map's ground, and we still cannot route to
      // it. That is a hole in this app, not in the schedule.
      return { kind: 'unknown', code: code2, entry: null, name: null, utKnows: true, near };
    }
    return { kind: 'unknown', code: code2, entry: null, name: null, utKnows: false, near };
  }

  /** §15's ladder, and there are only two rungs on purpose. */
  function dayVerdict(lo, hi, gapMin) {
    if (!WF_DAY.warnOn || gapMin == null) return null;
    if (lo > gapMin) return 'late';
    if (hi > gapMin) return 'tight';
    return null;
  }

  /**
   * The sequence. Classes and the walks between them, in one array, each walk
   * routed ONCE through the same computeRoute() the answer bar is drawn from.
   */
  function dayBuild(plan) {
    const out = [];
    // `unreachable` and `unplaced` are counted apart because they are not the
    // same news. "This map cannot take you there" is a fact about the map;
    // "we could not read a building for this class" is a fact about the import,
    // and only the second one is something the student can go and fix.
    let checks = 0, unreachable = 0, unplaced = 0, onFootM = 0;
    // WORST-FIRST, not first-worst. The header names ONE leg and there may be
    // two, so 'late' outranks 'tight' and, within a rung, the earlier leg wins
    // — the one you hit first is the one you can still do something about.
    let worst = null, tights = 0;
    // An unplaced class has no code to look up, so it never reaches dayPlace()
    // — which resolves against the building register and would answer
    // `unknown` about a null, i.e. the wrong one of its four sentences.
    const places = plan.items.map(it => (it.unplaced
      ? { kind: 'unplaced', code: null, entry: null, name: null,
          label: it.label || it.course || it.title || '', note: it.note || null }
      : dayPlace(it.code)));
    for (let i = 0; i < plan.items.length; i++) {
      const it = plan.items[i], pl = places[i];
      if (pl.kind === 'unplaced') unplaced++;
      else if (pl.kind !== 'ok') unreachable++;
      out.push({ type: 'class', i, item: it, place: pl });
      const nx = plan.items[i + 1];
      if (!nx) continue;
      const pn = places[i + 1];
      // The gap the SCHEDULE holds. When two classes overlap or abut there is
      // no gap to measure against and we fall back to the same assumed passing
      // period the single-leg bar uses — and the row says which one it used.
      const raw = nx.startMin - it.endMin;
      const gapMin = raw > 0 ? raw : null;
      const leg = { type: 'walk', i, from: it, to: nx, fromPlace: pl, toPlace: pn,
        gapMin, gapAssumed: gapMin == null ? WAYFIND.passingMin : null,
        problems: [], route: null };
      const budget = gapMin == null ? WAYFIND.passingMin : gapMin;
      if (pl.kind !== 'ok' || pn.kind !== 'ok') {
        leg.status = 'blocked';
        for (const p of [pl, pn]) if (p.kind !== 'ok') leg.problems.push({ kind: p.kind, place: p });
      } else {
        const r = computeRoute(G, pl.entry, pn.entry, {});
        if (!r.ok) { leg.status = 'noroute'; leg.problems.push({ kind: 'noroute' }); }
        else {
          leg.status = 'ok';
          leg.route = r;
          leg.lo = r.time.lo; leg.hi = r.time.hi; leg.distM = r.distM;
          leg.sets = r.m.stairSets; leg.signals = r.m.signals;
          onFootM += r.distM;
          leg.verdict = dayVerdict(r.time.lo, r.time.hi, budget);
          if (leg.verdict) {
            leg.problems.push({ kind: leg.verdict });
            if (leg.verdict === 'tight') tights++;
            if (!worst || (worst.verdict === 'tight' && leg.verdict === 'late')) worst = leg;
          }
          if (leg.sets > 0) {
            // The stairs lane already computed the way round, or established
            // there is none, on this same answer object. Do not re-route it.
            const sf = r.stepFree;
            if (!sf) leg.problems.push({ kind: 'stairsOnly', sets: leg.sets });
            else leg.problems.push({ kind: 'stairs', sets: leg.sets,
              extraM: Math.round(sf.distM - r.distM) });
          }
          if (leg.signals >= WF_DAY.signalChipMin) leg.problems.push({ kind: 'signals', n: leg.signals });
        }
      }
      if (leg.problems.length) checks++;
      out.push(leg);
    }
    return { rows: out, checks, walks: out.filter(r => r.type === 'walk').length,
      classes: plan.items.length, unreachable, unplaced, onFootM, worst, tights };
  }

  // ── THE CLOCK ────────────────────────────────────────────────────────────
  /** Minutes past local midnight, or a frozen value so a screenshot of "which
   *  walk is next" is the same picture tomorrow. */
  function dayNow() {
    const s = q.get('dayat');
    if (s) {
      const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
      if (m) return (+m[1]) * 60 + (+m[2]);
    }
    if (WF_DAY.clockFrom !== 'real') return null;
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  }

  function dayFmtTime(min) {
    let h = Math.floor(min / 60), m = min % 60;
    const ap = h >= 12 ? 'pm' : 'am';
    h = h % 12; if (h === 0) h = 12;
    return h + ':' + String(m).padStart(2, '0') + ap;
  }

  // ── THE PANEL ────────────────────────────────────────────────────────────
  function dayEnsureCss() {
    if (document.getElementById('wf-day-css')) return;
    const s = document.createElement('style');
    s.id = 'wf-day-css';
    s.textContent = DAY_CSS;
    document.head.appendChild(s);
  }

  /**
   * The panel is a CHILD OF #wf-root and its stylesheet is injected from here
   * rather than added to style.css, for one reason each.
   *
   * Child of #wf-root: it inherits every type and colour token the answer bar
   * uses, so the day plan cannot drift from the bar it feeds.
   *
   * Injected: style.css belongs to another lane this round, and the recording
   * gate lives in it. `.clip #wf-button,.clip #wf-sheet,.clip #wf-pill` names
   * three ids and its own comment claims "every element this feature has ever
   * added is a CHILD of one of these three" — which stops being true the moment
   * this panel exists. So the gate for the two elements this surface adds is in
   * DAY_CSS below, next to them, and the one-line consolidation for whoever
   * owns style.css is written down in docs/si-dayview.md.
   */
  function dayBuildPanel() {
    if (dayEl) return dayEl;
    dayEnsureCss();
    buildUI();
    const panel = h('div', 'hidden'); panel.id = 'wf-day';
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', SAY_D.title);
    const head = h('div', null); head.id = 'wf-day-head';
    const hl = h('div', null); hl.id = 'wf-day-title';
    head.appendChild(hl);
    const close = h('button', null); close.id = 'wf-day-close';
    close.setAttribute('aria-label', SAY_D.close);
    close.appendChild(icon(null, IC.close, 2.1));
    close.addEventListener('click', (ev) => { ev.stopPropagation(); dayHide(); });
    head.appendChild(close);
    panel.appendChild(head);
    const sum = h('div', null); sum.id = 'wf-day-sum';
    panel.appendChild(sum);
    const list = h('div', null); list.id = 'wf-day-list';
    panel.appendChild(list);
    const foot = h('div', null); foot.id = 'wf-day-foot';
    panel.appendChild(foot);
    el.root.appendChild(panel);
    dayEl = { panel, title: hl, sum, list, foot };
    return dayEl;
  }

  function dayHide() {
    if (dayEl) dayEl.panel.classList.add('hidden');
    if (dayBtn) dayBtn.classList.remove('on');
  }
  function dayShow() {
    dayBuildPanel();
    dayEl.panel.classList.remove('hidden');
    if (dayBtn) dayBtn.classList.add('on');
    // Two panels in one slot is two panels. The search sheet and the day plan
    // take the same corner, so opening one closes the other — the same rule
    // run() already applies when the answer replaces the question.
    if (el && el.sheet) { el.sheet.classList.add('hidden'); el.btn.classList.remove('active'); }
  }

  /** A chip: one problem, one line, its own severity. */
  function dayChip(kind, text, sub) {
    const c = h('div', 'wf-d-chip wf-d-' + kind);
    c.appendChild(icon('wf-d-chip-ic', kind === 'late' || kind === 'tight' ? IC_D.warn
      : (kind === 'stairs' || kind === 'stairsOnly' ? IC_D.stairs : IC_D.info), 2));
    const t = h('span', 'wf-d-chip-t', text);
    if (sub) { t.appendChild(h('span', 'wf-d-chip-s', ' · ' + sub)); }
    c.appendChild(t);
    return c;
  }

  /**
   * THE GAP BAR. The track is the gap the schedule holds; the walk's own range
   * is drawn inside it, solid to the fast end and lighter out to the slow end.
   * The tail is left EMPTY AND UNLABELLED on purpose — §15 permits drawing what
   * the calendar says and forbids saying you will make it, and an empty tail
   * says the first without saying the second. Overflow past the end is drawn as
   * a stub outside the track, because that is the one state worth seeing from
   * across the room.
   */
  function dayGapBar(leg) {
    if (!WF_DAY.gapBar || leg.status !== 'ok') return null;
    const gap = leg.gapMin == null ? leg.gapAssumed : leg.gapMin;
    if (!gap || gap > WF_DAY.gapBarMaxMin) return null;
    const wrap = h('div', 'wf-d-bar');
    wrap.setAttribute('aria-hidden', 'true');
    const track = h('div', 'wf-d-bar-tr');
    const pct = (m) => Math.max(0, Math.min(100, (m / gap) * 100));
    const lo = Math.max(WF_DAY.gapBarMinPct, pct(leg.lo));
    const hi = Math.max(lo, pct(leg.hi));
    const sure = h('div', 'wf-d-bar-lo'); sure.style.width = lo.toFixed(1) + '%';
    const maybe = h('div', 'wf-d-bar-hi'); maybe.style.width = (hi - lo).toFixed(1) + '%';
    track.appendChild(sure); track.appendChild(maybe);
    if (leg.hi > gap) {
      const over = h('div', 'wf-d-bar-ov');
      over.style.width = WF_DAY.gapBarOverPct + '%';
      track.appendChild(over);
      wrap.classList.add('over');
    }
    wrap.appendChild(track);
    return wrap;
  }

  /**
   * WHERE THE NOW LINE GOES, and it is a rule about reading rather than about
   * arithmetic. Google Calendar draws its line at a pixel offset inside a
   * proportional column; this is a list, so the line goes BETWEEN two rows and
   * has to land where "everything above has happened" is actually true.
   *
   *   before the first row that has not ENDED yet — so at 10:50, in a
   *   10:45→11:00 passing period, the line sits above the walk row and the
   *   walk reads as ahead of you, which it is;
   *
   *   except when the clock is INSIDE a class, where it goes after that class
   *   instead — you are in the room, the class is current, and what is below
   *   the line is what is left of the day. (Not for a walk row: the walk you
   *   have not finished is still ahead of you.)
   *
   * Returns rows.length for a day that is over, which draws the line at the
   * foot of the list, and 0 for a day that has not started.
   */
  function dayNowIndex(rows, nowMin) {
    if (!WF_DAY.nowLine || nowMin == null || !rows.length) return -1;
    const endOf = (r) => r.type === 'class' ? r.item.endMin : r.to.startMin;
    const startOf = (r) => r.type === 'class' ? r.item.startMin : r.from.endMin;
    for (let i = 0; i < rows.length; i++) {
      if (endOf(rows[i]) <= nowMin) continue;
      if (rows[i].type === 'class' && nowMin >= startOf(rows[i])) return i + 1;
      return i;
    }
    return rows.length;
  }

  /** The line itself: the clock in the same gutter every row puts its time in,
   *  a pip on the spine, and a hairline across the body. Three columns, the
   *  same three a row has, so it cannot drift out of the grid. */
  function dayNowLine(nowMin) {
    const w = h('div', 'wf-d-now');
    w.setAttribute('aria-hidden', 'true');
    w.appendChild(h('div', 'wf-d-now-t', dayFmtTime(nowMin)));
    w.appendChild(h('div', 'wf-d-now-p'));
    w.appendChild(h('div', 'wf-d-now-l'));
    return w;
  }

  function dayRenderClass(row, nowMin) {
    const r = h('div', 'wf-d-row wf-d-class');
    if (nowMin != null && nowMin >= row.item.startMin && nowMin < row.item.endMin) r.classList.add('in');
    const when = h('div', 'wf-d-when');
    when.appendChild(h('div', 'wf-d-t1', dayFmtTime(row.item.startMin)));
    when.appendChild(h('div', 'wf-d-t2', dayFmtTime(row.item.endMin)));
    r.appendChild(when);
    const rail = h('div', 'wf-d-rail'); rail.setAttribute('aria-hidden', 'true');
    rail.appendChild(h('span', 'wf-d-dot'));
    r.appendChild(rail);
    const body = h('div', 'wf-d-body');
    const t = h('div', 'wf-d-course', row.item.course || row.item.code);
    if (nowMin != null && nowMin >= row.item.startMin && nowMin < row.item.endMin) {
      t.appendChild(h('span', 'wf-d-nowtag', SAY_D.now));
    }
    body.appendChild(t);
    const nm = row.place.name || (row.place.kind === 'offmap' || row.place.kind === 'unknown'
      ? null : row.item.code);
    if (nm) body.appendChild(h('div', 'wf-d-place', nm));
    // AN UNPLACED CLASS SHOWS THE STRING IT ACTUALLY HAD, not a blank where a
    // code goes. Whatever the calendar put in LOCATION is what the student will
    // recognise and what they have to go and fix, so it is printed verbatim.
    if (row.place.kind === 'unplaced') {
      if (row.item.raw) {
        const where = h('div', 'wf-d-where');
        where.appendChild(h('span', 'wf-d-room', String(row.item.raw)));
        body.appendChild(where);
      }
    } else {
      const where = h('div', 'wf-d-where');
      where.appendChild(h('span', 'wf-d-code', row.item.code));
      if (row.item.room) where.appendChild(h('span', 'wf-d-room', row.item.room));
      body.appendChild(where);
    }
    // "Read as X — check this one" is for a code we DID read and are not sure
    // of. An unplaced class has no code and no raw string to quote, and printing
    // this for it produced a literal `Read as "null" — check this one` on screen
    // next to a sentence that already said the true thing. Caught by looking at
    // the harness's own output, not by any gate.
    if (row.place.kind !== 'unplaced' && row.item.raw &&
        row.item.codeConfidence < WF_DAY.confidenceSure) {
      body.appendChild(dayChip('info', SAY_D.lowConf(row.item.raw)));
    }
    // WHY A BUILDING IS OUT OF REACH BELONGS TO THE CLASS ROW, ONCE. It is a
    // fact about the BUILDING, and a building appears on exactly one class row
    // but on up to two walk rows either side of it — photographed on the
    // constructed fixture, "BE1 is 11.8 km north of campus — off this map ·
    // This map is main campus only." was on screen THREE times in a panel five
    // rows long. The class row carries the sentence and its explanation; the
    // walk rows carry only the short consequence (see dayRenderWalk).
    if (row.place.kind === 'offmap') {
      body.appendChild(dayChip('off', SAY_D.offMap(row.item.code,
        fmtDist(row.place.distM), row.place.dir), SAY_D.offMapWhy));
    } else if (row.place.kind === 'unknown') {
      // The near miss, when the type-ahead had one. It is a SUGGESTION on the
      // row and never a substitution in the router — see dayPlace().
      body.appendChild(dayChip('off', SAY_D.unknown(row.item.code),
        row.place.near ? SAY_D.unknownMaybe(row.place.near.code, row.place.near.name)
          : SAY_D.unknownWhy));
    } else if (row.place.kind === 'nodoor') {
      body.appendChild(dayChip('off', SAY_D.noDoor(row.item.code), SAY_D.noDoorWhy));
    } else if (row.place.kind === 'unplaced') {
      // The importer's own sentence when it gave one, this surface's when it
      // did not — the parser lane already writes a better one than a renderer
      // can, because it knows WHICH way the location field failed.
      body.appendChild(dayChip('off',
        SAY_D.unplaced(row.place.label || row.item.code || ''),
        row.place.note || SAY_D.unplacedWhy));
    } else if (row.item.note) {
      // A CLASS WE CAN ROUTE TO THAT THE IMPORTER STILL COULD NOT USE. Only
      // here — every other branch above already says something more specific
      // about this building, and saying both puts one fact on screen twice.
      body.appendChild(dayChip('info', row.item.note));
    }
    r.appendChild(body);
    return r;
  }

  function dayRenderWalk(row, nowMin, isNext, idx) {
    const past = nowMin != null && nowMin >= row.to.startMin + WF_DAY.nextGraceMin;
    const btn = document.createElement('button');
    // The row's own ground carries "does not fit its gap" — a second channel
    // from `next`, which owns the rail and the gutter badge. See DAY_CSS.
    const wash = !WF_DAY.warnRail ? '' :
      (row.verdict === 'late' ? ' warn warn-late' : (row.verdict === 'tight' ? ' warn' : ''));
    btn.className = 'wf-d-row wf-d-walk' + (isNext ? ' next' : '') + (past ? ' past' : '') +
      wash + (dayPicked === idx ? ' picked' : '');
    btn.type = 'button';
    const when = h('div', 'wf-d-when');
    if (isNext) when.appendChild(h('div', 'wf-d-next', SAY_D.next));
    // WHEN THE WALK STARTS, in the same gutter the classes put their times in,
    // so the column is one clock all the way down instead of a clock with
    // three holes in it. It is the previous class's END TIME — a fact read off
    // the schedule, not a claim about when you should leave, which §15 would
    // not let this surface make.
    when.appendChild(h('div', 'wf-d-t3', dayFmtTime(row.from.endMin)));
    btn.appendChild(when);
    const rail = h('div', 'wf-d-rail wf-d-rail-w'); rail.setAttribute('aria-hidden', 'true');
    btn.appendChild(rail);
    const body = h('div', 'wf-d-body');

    if (row.status === 'ok') {
      const line = h('div', 'wf-d-fig');
      line.appendChild(icon('wf-d-mode', IC.walk, 1.9));
      // `0–1 min` is what the arithmetic produces on a 43 m walk and it is not
      // what the answer bar says: SAY.minWalkUnder above prints `Under 1 min
      // walk`, because a range whose fast end is zero is not a range. The two
      // surfaces have to use one vocabulary or they read as two claims.
      line.appendChild(h('span', 'wf-d-min', row.lo === 0 ? 'Under ' + row.hi : row.lo + '–' + row.hi));
      line.appendChild(h('span', 'wf-d-unit', 'min'));
      line.appendChild(h('span', 'wf-d-dist', fmtDist(row.distM)));
      body.appendChild(line);
      const bar = dayGapBar(row);
      if (bar) body.appendChild(bar);
      const ends = h('div', 'wf-d-ends');
      ends.appendChild(h('span', 'wf-d-code', row.fromPlace.code));
      ends.appendChild(icon('wf-d-arr', IC_D.arrowR, 2.1));
      ends.appendChild(h('span', 'wf-d-code', row.toPlace.code));
      ends.appendChild(h('span', 'wf-d-gap', row.gapMin == null
        ? SAY_D.gapAssumed(row.gapAssumed) : SAY_D.gapWas(row.gapMin)));
      body.appendChild(ends);
    } else {
      // A BLOCKED WALK IS STILL A WALK ROW. It keeps the figure line, the mode
      // glyph and the two codes, so the sequence does not develop a hole where
      // the row you cannot take should be — an absent row reads as "there is no
      // walk here", which is the opposite of what has happened.
      const line = h('div', 'wf-d-fig wf-d-figoff');
      line.appendChild(icon('wf-d-mode', IC.walk, 1.9));
      line.appendChild(h('span', 'wf-d-min', '—'));
      body.appendChild(line);
      const ends = h('div', 'wf-d-ends');
      // An unplaced end has no code, so the ends line prints what the class is
      // called instead. It must print SOMETHING: an ends line with one code and
      // an arrow into nothing reads as a rendering bug.
      // AND IT IS NOT SET AS A CODE. `PSY 301` in the code's amber weight looks
      // exactly like `GSB` next to it, which would have this surface asserting
      // a building code it does not have and never read. It is a course number
      // standing in for a building we could not find, and it is set as one.
      const endName = (p, it) => p.code || p.label || (it && (it.course || it.title)) || '?';
      const endCell = (p, it) => h('span', p.code ? 'wf-d-code' : 'wf-d-noplace', endName(p, it));
      ends.appendChild(endCell(row.fromPlace, row.from));
      ends.appendChild(icon('wf-d-arr', IC_D.arrowR, 2.1));
      ends.appendChild(endCell(row.toPlace, row.to));
      if (row.gapMin != null) ends.appendChild(h('span', 'wf-d-gap', SAY_D.gapWas(row.gapMin)));
      body.appendChild(ends);
    }

    for (const p of row.problems) {
      if (p.kind === 'late') body.appendChild(dayChip('late', SAY_D.late));
      else if (p.kind === 'tight') body.appendChild(dayChip('tight', SAY_D.tight));
      else if (p.kind === 'stairsOnly') body.appendChild(dayChip('stairsOnly', SAY_D.stairsOnly(p.sets)));
      else if (p.kind === 'stairs') body.appendChild(dayChip('stairs', SAY_D.stairs(p.sets),
        p.extraM > 0 ? SAY_D.stairsFree(fmtDist(p.extraM))
          : (p.extraM < 0 ? SAY_D.stairsFreeShorter(fmtDist(-p.extraM)) : SAY_D.stairsFreeSame)));
      else if (p.kind === 'signals') body.appendChild(dayChip('signals', SAY_D.signals(p.n)));
      else if (p.kind === 'noroute') body.appendChild(dayChip('off', SAY_D.noRoute));
      // THE SHORT CONSEQUENCE, NOT THE EXPLANATION. Why BE1 is out of reach is
      // printed once, on BE1's own class row directly above or below this one.
      // Repeating it here put the same twelve-word sentence on screen three
      // times in a five-row panel.
      else if (p.kind === 'offmap' || p.kind === 'unknown' || p.kind === 'nodoor') {
        body.appendChild(dayChip('off', p.place === row.toPlace
          ? SAY_D.cannotTo(p.place.code) : SAY_D.cannotFrom(p.place.code)));
      }
      // An unplaced end is named by its CLASS, not by a code, because there is
      // no code — "We can't take you to BIO 206L" is the only true sentence
      // available and it is also the one the student can act on.
      else if (p.kind === 'unplaced') {
        const lab = p.place.label || (p.place === row.toPlace ? row.to : row.from).course || '';
        body.appendChild(dayChip('off', p.place === row.toPlace
          ? SAY_D.cannotToLabel(lab) : SAY_D.cannotFromLabel(lab)));
      }
    }
    btn.appendChild(body);
    if (row.status === 'ok') {
      btn.setAttribute('aria-label', SAY_D.walkTo(row.toPlace.code) + ' — ' +
        row.lo + '–' + row.hi + ' min, ' + fmtDist(row.distM));
      btn.addEventListener('click', (ev) => { ev.stopPropagation(); dayPick(idx); });
    } else {
      btn.disabled = true;
    }
    return btn;
  }

  /**
   * PICK ONE AND NAVIGATE IT. This is the whole reason the day plan is a
   * chooser rather than a second answer surface: it hands the two ends to the
   * SAME run() the search panel calls, so everything downstream — the ribbon,
   * the answer bar, `Walk it`, the stairs card, the lighting card — is the
   * shipped single-leg feature, unmodified and unduplicated.
   */
  function dayPick(idx) {
    const row = dayRows && dayRows.rows[idx];
    if (!row || row.type !== 'walk' || row.status !== 'ok') return;
    dayPicked = idx;
    buildUI();
    state.from = row.fromPlace.entry;
    state.to = row.toPlace.entry;
    el.inFrom.value = row.fromPlace.entry.display;
    el.inTo.value = row.toPlace.entry.display;
    state.via = null; state.viaKind = null; state.viaList = []; state.viaAt = 0;
    run();
    dayRender();
  }

  function dayRender() {
    if (!dayPlan || !dayEl) return;
    const nowMin = dayNow();
    dayRows = dayBuild(dayPlan);
    dayEl.title.textContent = dayPlan.day || SAY_D.title;
    if (WF_DAY.exampleBadge && dayPlan.example) {
      dayEl.title.appendChild(h('span', 'wf-d-example', SAY_D.exampleBadge));
    }
    dayEl.sum.innerHTML = '';
    const count = h('span', 'wf-d-count', SAY_D.heading(dayRows.classes, dayRows.walks));
    // HOW FAR YOU WALK TODAY, on the end of the count line rather than on a
    // line of its own — it is the same KIND of fact as "3 walks" (the size of
    // the day) and giving it its own row would rank it with the warnings.
    if (WF_DAY.totalOnFoot && dayRows.onFootM > 0) {
      count.appendChild(h('span', 'wf-d-count-sub',
        ' · ' + SAY_D.onFoot(fmtDist(dayRows.onFootM))));
    }
    dayEl.sum.appendChild(count);
    // WHICH LEG, ABOVE THE COUNT. The count says how many walks have something
    // wrong; this says WHICH, and which is the more useful of the two — the
    // count was making you scroll to find out what this line just tells you.
    // On a phone only two rows are on screen, so the header is the only part of
    // this panel always in view and the order inside it is the ranking. §15
    // holds: every form of this sentence is a warning about a named leg, and a
    // day whose walks all fit gets no sentence here at all.
    if (WF_DAY.headlineWorst && dayRows.worst) {
      const w = dayRows.worst;
      const a = w.fromPlace.code, b = w.toPlace.code;
      const line = w.verdict === 'late' ? SAY_D.worstLate(a, b)
        : (dayRows.tights > 1 ? SAY_D.worstTightN(dayRows.tights) : SAY_D.worstTight(a, b));
      dayEl.sum.appendChild(h('span', 'wf-d-worst', line));
    }
    if (dayRows.checks) {
      dayEl.sum.appendChild(h('span', 'wf-d-checks',
        SAY_D.toCheck(dayRows.checks, dayRows.walks)));
    }
    if (dayRows.unreachable) {
      dayEl.sum.appendChild(h('span', 'wf-d-unreach',
        SAY_D.someUnreachable(dayRows.unreachable)));
    }
    if (dayRows.unplaced) {
      dayEl.sum.appendChild(h('span', 'wf-d-unreach',
        SAY_D.someUnplaced(dayRows.unplaced)));
    }
    // WHICH ONE IS NEXT, and exactly one row may be it. The first walk whose
    // destination class has not started yet (plus a grace window, because
    // somebody looking at this while a class starts is running late and the row
    // they want is still the one they are on).
    let nextIdx = -1;
    if (nowMin != null) {
      for (let i = 0; i < dayRows.rows.length; i++) {
        const r = dayRows.rows[i];
        if (r.type !== 'walk') continue;
        if (nowMin < r.to.startMin + WF_DAY.nextGraceMin) { nextIdx = i; break; }
      }
      // AND WHEN NOTHING IS NEXT, SAY SO. A panel with no marked row and no
      // sentence explaining why reads as a panel that failed to work out which
      // one was next — the same "absence of a claim read as an all-clear"
      // failure SAY.darkOutside exists to stop.
      if (nextIdx < 0 && dayRows.walks) {
        dayEl.sum.appendChild(h('span', 'wf-d-unreach', SAY_D.done));
      }
    }
    const nowAt = dayNowIndex(dayRows.rows, nowMin);
    dayEl.list.innerHTML = '';
    for (let i = 0; i < dayRows.rows.length; i++) {
      if (i === nowAt) dayEl.list.appendChild(dayNowLine(nowMin));
      const r = dayRows.rows[i];
      dayEl.list.appendChild(r.type === 'class'
        ? dayRenderClass(r, nowMin)
        : dayRenderWalk(r, nowMin, i === nextIdx, i));
    }
    if (nowAt === dayRows.rows.length) dayEl.list.appendChild(dayNowLine(nowMin));
    const daySrcName = SAY_D.source[dayPlan.source] || dayPlan.source;
    dayEl.foot.textContent = dayPlan.example ? SAY_D.fromExample(daySrcName)
      : SAY_D.from(daySrcName);
  }

  /**
   * PUBLIC. An importer calls this with a normalised plan and the day appears.
   * It is the only entry point this surface has, and it takes the shape
   * documented at the top of this section — nothing calendar-shaped reaches
   * this file.
   */
  window.wayfindDay = async function (plan) {
    const p = dayNormalise(plan);
    if (!p) return { ok: false, why: 'empty' };
    await loadGraph();
    dayBuildPanel();
    dayPlan = p; dayPicked = -1;
    dayRender();
    dayShow();
    return { ok: true, classes: p.items.length,
      walks: dayRows.walks, checks: dayRows.checks, unreachable: dayRows.unreachable,
      unplaced: dayRows.unplaced, onFootM: Math.round(dayRows.onFootM),
      tights: dayRows.tights,
      worst: dayRows.worst ? { from: dayRows.worst.fromPlace.code,
        to: dayRows.worst.toPlace.code, verdict: dayRows.worst.verdict } : null,
      rows: dayRows.rows.map(r => r.type === 'class'
        ? { type: 'class', code: r.item.code, kind: r.place.kind,
            startMin: r.item.startMin, endMin: r.item.endMin }
        : { type: 'walk', from: r.fromPlace.code, to: r.toPlace.code, status: r.status,
            lo: r.lo, hi: r.hi, distM: r.distM == null ? null : Math.round(r.distM),
            sets: r.sets, signals: r.signals, gapMin: r.gapMin,
            verdict: r.verdict || null, problems: r.problems.map(x => x.kind) }) };
  };
  /** The built-in fixtures, by name, so a verify script can drive the same day
   *  this file ships rather than carrying its own copy of it. */
  window.wayfindDayFixture = function (name) {
    const f = DAY_FIXTURES[name] || DAY_FIXTURES[WF_DAY.demoPlan];
    const c = JSON.parse(JSON.stringify(f));
    // MARKED AT THE SOURCE, not at each call site. A fixture that can reach the
    // screen without the flag is a fixture that can be read as a real import,
    // and there is no call site where that is acceptable.
    c.example = true;
    return c;
  };
  /** A whole WEEK in the parser lane's published shape, for driving the
   *  schedule adapter below without the parser branch in the tree. */
  window.wayfindDayScheduleFixture = function () {
    const c = JSON.parse(JSON.stringify(DAY_SCHED_FIXTURE));
    c.example = true;
    return c;
  };

  // ── THE OTHER HALF OF THE SEAM ────────────────────────────────────────────
  // A parsed schedule is a WEEK; this panel shows a DAY. Round 3 documented the
  // shape the renderer wants and left the conversion to whoever called it,
  // which meant nothing had ever actually made the trip end to end. This is the
  // conversion, and it is here rather than in the parser for the same reason
  // `dayNormalise` is here: the renderer is the side that knows what a day is.
  //
  // It reads a plain object. There is no call into the parser lane's code, no
  // reference to any of its identifiers, and nothing here breaks if it is not
  // loaded — which is what lets both halves be verified separately and then
  // together, and what keeps two lanes out of one another's functions.
  const DAY_ICS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday',
    'Friday', 'Saturday'];

  /** 'TU' | 'Tuesday' | 'tue' | 2 -> 2, or -1. */
  function dayIndexOf(v) {
    if (v == null || v === '') return -1;
    if (typeof v === 'number' && v >= 0 && v <= 6) return v;
    const s = String(v).trim().toUpperCase();
    const i = DAY_ICS.indexOf(s.slice(0, 2));
    if (i >= 0 && (s.length === 2 || DAY_NAMES[i].toUpperCase().indexOf(s) === 0)) return i;
    for (let k = 0; k < 7; k++) if (DAY_NAMES[k].toUpperCase().indexOf(s) === 0) return k;
    return -1;
  }

  /** Which of the three importers produced this, from what the file says about
   *  itself. PRODID is the honest signal; the front end's own label is second;
   *  a paste is nobody's calendar and says so. */
  function daySourceOf(src) {
    // A BARE SOURCE ID, TOO. The import screen and the store each name the same
    // three sources in their own vocabulary ('gcal' / 'google-ics'), and a
    // schedule restored from disk carries the store's. Reading only the
    // parser's descriptor object made every one of those read 'manual', so a
    // real UT import's footer said "From typed in".
    if (typeof src === 'string') {
      const id = src.toLowerCase();
      if (/^(gcal|google)/.test(id)) return 'google';
      if (/^apple/.test(id)) return 'apple';
      if (/^ut/.test(id)) return 'ut';
      if (/^image/.test(id)) return 'image';
      if (/^(api|registration-plus)/.test(id)) return 'api';
      return 'manual';
    }
    const p = String((src && (src.producer || src.label)) || '').toLowerCase();
    if (/google/.test(p)) return 'google';
    if (/apple|mac os|ical\b|core ?data/.test(p)) return 'apple';
    if (/utexas|registration|ut ?registration/.test(p)) return 'ut';
    if (src && src.kind === 'rows') return 'manual';
    return 'manual';
  }

  /**
   * PUBLIC. Take a parsed schedule — the `ut-walk-schedule` shape the parser
   * lane produces from a Google export, an Apple export or subscription, or a
   * UT registration export — and show ONE of its days.
   *
   *   opts.day   'TU' | 'Tuesday' | 2 | omitted (today, then the first day the
   *              schedule actually has classes on)
   *   opts.show  false to build the plan and not open the panel
   *
   * TWO DECISIONS IN HERE ARE THE WHOLE POINT.
   *
   * 1. A CLASS THAT FAILED TO IMPORT IS STILL ON THE DAY. The parser marks an
   *    event `failed` when it cannot read a building for it; dropping those
   *    would leave a student looking at a panel that says "3 classes" on a
   *    four-class Tuesday, with an invented two-hour gap where the fourth one
   *    is. Every event that has a TIME comes through. What it lost is a place,
   *    and the row says so, in the importer's own words where it gave any.
   *
   * 2. A CODE THAT RESOLVED IS PASSED THROUGH RAW, NOT PRE-JUDGED. The parser
   *    already knows MER is at Pickle and SSW is unregistered — but this file
   *    asks `dayPlace()` the same question again, against the graph it is
   *    actually going to route on. Two surfaces that answer "can I get there"
   *    from two different sources is exactly the failure the day plan's own
   *    gate exists to catch, and it would be perverse to introduce it here.
   */
  window.wayfindDayFromSchedule = async function (schedule, opts) {
    opts = opts || {};
    const evs = (schedule && (schedule.events || schedule.routable)) || [];
    if (!evs.length) return { ok: false, why: 'empty' };

    // WHICH DAY. Asked for, else today, else the first day this schedule has a
    // class on — because a Sunday visitor with a Mon/Wed timetable should see
    // Monday, not an empty panel that looks broken.
    const has = (d) => evs.some(e => Array.isArray(e.days) && e.days.indexOf(DAY_ICS[d]) >= 0);
    let di = dayIndexOf(opts.day);
    if (di < 0 && WF_DAY.weekFrom === 'today') di = new Date().getDay();
    if (di < 0 || !has(di)) { for (let k = 0; k < 7; k++) if (has(k)) { di = k; break; } }
    if (di < 0) di = 0;
    const want = DAY_ICS[di];

    let skipped = 0, noTime = 0;
    const items = [];
    for (const e of evs) {
      const days = Array.isArray(e.days) ? e.days : [];
      if (days.length && days.indexOf(want) < 0) { skipped++; continue; }
      // A one-off event carries no RRULE day list. Its own date decides.
      if (!days.length) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(e.firstDate || ''));
        if (!m) { skipped++; continue; }
        if (new Date(+m[1], +m[2] - 1, +m[3]).getDay() !== di) { skipped++; continue; }
      }
      if (e.startMin == null || e.endMin == null) { noTime++; continue; }
      // The parser's own sentence about why this one has no building. The HINT,
      // not the problem text: the text names a row number and repeats the class
      // title, which is right for an import report and wrong under a row that
      // already carries both.
      // The parser's own sentence about why this event failed. Carried for
      // EVERY failed event, not only the placeless ones, and here is why.
      //
      // `messy.ics` holds LAH 350: a real class, in PCL, at a real time, whose
      // only problem is that the file was cut off. The parser's report says
      // "8 could not be used"; this panel would have shown LAH 350 as an
      // ordinary class with an ordinary walk to it, and the two surfaces would
      // have been telling a student two different things about the same
      // import. The note makes them agree.
      //
      // It is only PRINTED on a class this map can actually route to — see
      // dayRenderClass. Where the building itself is the problem, dayPlace()
      // says a better and more specific thing, and printing both put the same
      // fact on screen twice, which is the defect round 3 had to fix once.
      let note = null;
      if (Array.isArray(e.problems) && (e.status !== 'ok' || !e.code)) {
        for (const p of e.problems) if (p && p.level === 'error') { note = p.hint || p.text || null; break; }
      }
      items.push({
        course: e.course || null, title: e.title || null,
        code: e.code || null, room: e.room || '',
        raw: e.locationText || (e.code ? (e.room ? e.code + ' ' + e.room : e.code) : null),
        note: note,
        startMin: e.startMin, endMin: e.endMin, unique: e.unique || null,
        codeSource: 'schedule',
        codeConfidence: e.confidence == null ? 1 : Number(e.confidence),
      });
    }
    if (!items.length) return { ok: false, why: 'no-classes-that-day', day: DAY_NAMES[di] };

    const plan = {
      day: DAY_NAMES[di], date: null, tz: schedule.tz || null,
      // `origin` is the parser's own descriptor when there is one; `source` is
      // the bare id the import screen and the store use. Either answers.
      source: daySourceOf(schedule.origin || schedule.source),
      example: !!schedule.example, items,
    };
    if (opts.show === false) { return { ok: true, plan, day: DAY_NAMES[di], skipped, noTime }; }
    const r = await window.wayfindDay(plan);
    r.day = DAY_NAMES[di];
    r.skipped = skipped;
    r.noTime = noTime;
    return r;
  };

  /**
   * THE WAY IN. A row appended to the bottom of the search sheet at run time,
   * not a line added to buildUI() — four lanes are inside this file this round
   * and a DOM append cannot collide with any of them the way a source edit can.
   */
  function dayMount() {
    buildUI();
    dayEnsureCss();
    if (dayBtn) return;
    dayBtn = h('button', null); dayBtn.id = 'wf-day-btn';
    dayBtn.appendChild(icon('wf-day-btn-ic', IC_D.cal, 1.9));
    const lab = h('span', 'wf-day-btn-l');
    lab.appendChild(h('span', 'wf-day-btn-l1', SAY_D.open));
    lab.appendChild(h('span', 'wf-day-btn-l2', SAY_D.openHint));
    dayBtn.appendChild(lab);
    dayBtn.addEventListener('click', async (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      if (dayEl && !dayEl.panel.classList.contains('hidden')) { dayHide(); return; }
      // SI2. THE STUDENT'S OWN SCHEDULE, ALWAYS FIRST. This button used to call
      // the demo unconditionally — a hard-coded Tuesday — under a label reading
      // "Import my class schedule". Somebody who had just imported four classes
      // was shown four different ones and given no way to tell.
      const mine = dayImportedSchedule();
      if (mine) {
        let r = null;
        try { r = await window.wayfindDayFromSchedule(mine); } catch (e) { r = null; }
        if (r && r.ok) return;
        // Imported, but no day could be built out of it — every class lost its
        // time. The demo is not the answer to that; the import screen is,
        // because that is the surface where what happened is written down.
        try { if (window.wayfindImportOpen) window.wayfindImportOpen(); } catch (e) {}
        return;
      }
      if (dayPlan && !dayPlan.example) { dayShow(); return; }
      if (WF_DAY.demoWhenEmpty) await window.wayfindDay(window.wayfindDayFixture(WF_DAY.demoPlan));
      else if (dayPlan) dayShow();
    });
    // ONE dispatchEvent, AND UNTIL NOW ZERO addEventListener. The import
    // announced itself on `wayfind:schedule` and nothing in the app was
    // listening, so an open demo stayed on screen through an import and a
    // stale plan outlived the schedule it was built from.
    window.addEventListener('wayfind:schedule', (ev) => {
      const s = (ev && ev.detail) || window.wayfindSchedule || null;
      const open = !!(dayEl && !dayEl.panel.classList.contains('hidden'));
      dayPlan = null; dayRows = null; dayPicked = -1;
      if (!s) { dayHide(); return; }
      if (open) { try { window.wayfindDayFromSchedule(s); } catch (e) {} }
    });
    const foot = el.sheet.querySelector('.wf-foot');
    if (foot) el.sheet.insertBefore(dayBtn, foot); else el.sheet.appendChild(dayBtn);
    // Opening the question closes the day plan, for the same one-panel reason
    // dayShow() closes the question. An extra listener, not an edited one.
    el.btn.addEventListener('click', () => dayHide());
  }

  /**
   * THE SCHEDULE THE STUDENT ACTUALLY IMPORTED, or null.
   *
   * `window.wayfindSchedule` is the live one; after a reload the store section
   * republishes the saved one onto the same name, so this single accessor
   * covers both and the demo is left with exactly one condition it may appear
   * under: nothing has ever been imported on this device.
   */
  function dayImportedSchedule() {
    const s = window.wayfindSchedule;
    if (!s) return null;
    const evs = s.events || s.routable || [];
    return evs.length ? s : null;
  }

  function dayBoot() {
    const map = window.__map;
    if (!map) return setTimeout(dayBoot, 80);
    const go = async () => {
      if (!map.getLayer('buildings-3d')) return setTimeout(go, 140);
      dayMount();
      const d = q.get('day');
      if (d && d !== '0') {
        try {
          // `?day=week` goes in through the SCHEDULE door instead of the day
          // door, so the adapter is on the same path a real import takes
          // rather than only on the harness's.
          if (d === 'week') {
            await window.wayfindDayFromSchedule(window.wayfindDayScheduleFixture(),
              { day: q.get('dayof') || 'TU' });
          } else {
            await window.wayfindDay(window.wayfindDayFixture(d === '1' ? WF_DAY.demoPlan : d));
          }
        } catch (e) {}
      }
    };
    if (map.isStyleLoaded && map.isStyleLoaded()) go();
    else map.once('load', () => setTimeout(go, 0));
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 14. SCHEDULE IMPORT — three front ends, one shape, one seam
  // ══════════════════════════════════════════════════════════════════════════
  //
  // THE WHOLE JOB OF THIS SECTION is turning `"MAI 220, TTh 2:00pm"` into the
  // string `MAI`, because `MAI` is already this app's native vocabulary: it is
  // what `search()` matches on rung 1, what `UT_CELEBRATED` is keyed by, and
  // what `wayfindRoute` takes. Everything else here is bookkeeping around that
  // one conversion.
  //
  // THREE FRONT ENDS, ONE BACK END. Google Calendar, Apple Calendar and UT
  // Registration Plus all terminate in the same place — a standard ICS payload
  // of VEVENT blocks with SUMMARY / LOCATION / DTSTART / RRULE (docs/
  // import-bar-apple.md, docs/import-bar-ut.md). They differ only in HOW the
  // bytes arrive: an uploaded file, a webcal:// subscription, or a block of
  // text pasted off UT's own course-schedule page. So there is one parser and
  // three ways to feed it, and `wayfindScheduleFrom()` below is a FOURTH way in
  // that takes already-structured rows — that is the seam an image-OCR source
  // or a Registration-Plus API can be bolted onto later without touching a line
  // of this code. Neither is built here, on purpose.
  //
  // PARTIAL FAILURE IS THE POINT, and the bar is Google Calendar's own import:
  // it never lets one bad row kill the file. It imports what it can, tells you
  // "N of M", and lists what it skipped and why. So every function below is
  // written to keep going: a malformed date fails ONE event, a location it
  // cannot resolve fails ONE event, and a file that is not a calendar at all
  // fails with a sentence a student can act on rather than a stack trace.
  //
  // WHAT IT REFUSES TO DO. `search()` above documents the one rule this file
  // does not break: NEVER fuzzy-match a building code, because the 1-edit
  // neighbourhood of `WEL` contains `WCP`, `WMB` and `MEL`, and confidently
  // routing a student to a building one letter away from the one on their
  // schedule is the exact failure this feature is not allowed to have. So a
  // near miss is SUGGESTED in the error text and never applied. The student
  // picks.
  //
  // THE ELEVEN GAPS, RE-MEASURED 2026-08-24 (docs/si-parser.md has the run).
  // The brief this lane was given listed eleven codes that cannot be routed to
  // and both of its explanations were partly wrong, so the answers are worth
  // stating where the code that uses them lives:
  //   - Ten of them (BE1 BEG EME FS1 FSL MER PX3 ROC SV1 TCB) are 10.8-11.8 km
  //     from MAI's door, measured off UT_CELEBRATED above. Pickle Research
  //     Campus, genuinely off this map. `offmap` says so by name.
  //   - SSW is NOT off-map and NOT unregistered: it is 0.88 km from MAI with
  //     two surveyed doors in UT_CELEBRATED right here in this file. What it is
  //     missing from is data/ut_buildings.json, this app's own 198-code
  //     register, so `search()` returns nothing for it. Different status,
  //     different sentence: `unmapped`.
  //   - HLB is a TWELFTH code the brief's list missed, and it fails in the
  //     opposite direction: `wayfindSearch('HLB')[0].routable` is FALSE and
  //     `wayfindRoute('PCL','HLB')` nevertheless succeeds at 1339 m, because
  //     computeRoute() invents a virtual door off the UT survey. So this file
  //     NEVER reports routability from `entry.routable`. The only honest test
  //     is trying the route, which is what wayfindScheduleCheck() does.
  //
  // A BUG A REVIEW FOUND THAT THE GATE COULD NOT, AND WHY (2026-08-24). The
  // sniff that decides which parser gets the text was a two-way question —
  // "is it ICS? no? then rows" — so the fixture in this suite modelling the
  // single likeliest real-world bad file, a saved UT EID sign-in page, went
  // to the ROW parser and came back with NINE errors, one per line of markup,
  // each reading "names a course but no building" about a line like
  // `<!DOCTYPE html>`. The correct sentence for that file existed and was
  // unreachable: only a caller that forced `kind:'ics'` ever saw it, and the
  // only caller that did was the test. 209 green assertions, and the exact
  // scenario they were written for still got through when called the way the
  // docs say to call it. Three changes, all below: the sniff is three-way
  // (schedSniff), a row that names no course gets the sentence written for
  // that case instead of the one written for a different case, and a paste
  // with no schedule signal on ANY line is refused once rather than per line.
  // The gate now calls the public entry point with NO options, for every
  // fixture, which is the assertion that was actually missing.

  const SCHEDULE = {
    // ── the shape ─────────────────────────────────────────────────────────
    // Bump `shapeVersion` if a consumer could be broken by a change. A future
    // OCR or Registration-Plus source stamps the same two fields.
    shape: 'ut-walk-schedule',
    shapeVersion: 1,
    tz: 'America/Chicago',            // UT is one campus in one zone

    // ── limits, so a pasted 40 MB file cannot wedge the tab ────────────────
    maxBytes: 4194304,
    maxEvents: 500,

    // ── resolution ────────────────────────────────────────────────────────
    codeMinLen: 2,                    // shortest UT building code (none are 1)
    codeMaxLen: 4,                    // longest, e.g. `UA9`, `PX3`, `FS1`
    suggestMax: 3,                    // did-you-mean candidates offered, never applied
    // Farther than this from `campusCentre` and the building is not on this
    // map at all. Pickle Research Campus is 10.8-11.8 km out; the farthest
    // main-campus door in UT_CELEBRATED is under 1.5 km. 3 km is the gap.
    offMapM: 3000,
    campusCentre: [-97.739719, 30.286186],   // MAI's celebrated door

    // ── manual / pasted entry ─────────────────────────────────────────────
    // A bare hour below this reads as afternoon: "TTh 2:00" is 14:00, because
    // no UT class meets at 02:00. Raise it if that ever stops being true.
    pmCutoffHour: 8,
    dayWords: [
      // LONGEST FIRST — `TTH` must win over `T`. Uppercased before matching.
      ['MTWTHF', ['MO', 'TU', 'WE', 'TH', 'FR']],
      ['MTWTH', ['MO', 'TU', 'WE', 'TH']],
      ['MTWRF', ['MO', 'TU', 'WE', 'TH', 'FR']],
      ['TWTH', ['TU', 'WE', 'TH']],
      ['MWF', ['MO', 'WE', 'FR']],
      ['TTH', ['TU', 'TH']],
      ['MW', ['MO', 'WE']],
      ['MF', ['MO', 'FR']],
      ['TW', ['TU', 'WE']],
      ['WF', ['WE', 'FR']],
      ['TH', ['TH']],
      ['SU', ['SU']],
      ['M', ['MO']], ['T', ['TU']], ['W', ['WE']], ['F', ['FR']], ['S', ['SA']],
    ],

    // ── telling a schedule from a file that is not one ────────────────────
    //
    // ADDED AFTER A REVIEW CAUGHT THE GATE GRADING ITS OWN HOMEWORK. The old
    // sniff asked one question — "does this contain BEGIN:VCALENDAR" — and
    // anything else fell through to the row parser. A saved UT EID sign-in
    // page (the likeliest wrong file a student uploads, and already a fixture
    // here) therefore produced NINE errors, one per line of markup, each
    // reading "names a course but no building" about a line like
    // `<!DOCTYPE html>`. Nine wrong sentences instead of the one right one
    // that was already written. The crafted message was only reachable when
    // the caller forced `kind:'ics'`, which the gate did, so the gate was
    // green on a path no real caller takes.
    //
    // So the sniff is now THREE-way — ics / rows / markup — and the row
    // parser has a floor under it for junk that is not markup either.
    markupHeadChars: 512,       // how much of the head the opener test reads
    markupTagsMin: 3,           // fewest tag-shaped tokens that can convict
    markupLineFraction: 0.5,    // ...and they must be on this share of lines
    // A paste with at least this many lines and NO schedule signal anywhere
    // (no building candidate, no course number, no time, no day word) is not
    // a schedule at all, and says so once instead of once per line. Below
    // this, per-line errors read better than a verdict on the whole file.
    notScheduleMinLines: 3,
    // Quoted back to the student inside an error. A whole line of minified
    // markup in an error message is not a message.
    rowSnippetMax: 60,

    // ── network ───────────────────────────────────────────────────────────
    fetchTimeoutMs: 12000,
    // `webcal://` is not a wire protocol — it is an OS handoff that means
    // "subscribe to the feed at this host and path". The feed itself is served
    // over HTTPS, which is what the scheme is swapped for. Set to 'http' only
    // if you are testing against a plain-HTTP server.
    webcalScheme: 'https',

    // ── the sentences ─────────────────────────────────────────────────────
    // Every string a student can read is here, so the interface lane can
    // reword any of them without going near the parsing (CLAUDE.md rule 11).
    // `{n}` is the 1-based row, `{title}` the class, `{loc}` what they wrote.
    say: {
      summaryAllOk: 'Imported all {ok} classes.',
      summaryPartial: 'Imported {ok} of {total} classes. {failed} could not be used.',
      summaryNone: 'None of the {total} entries in that file could be used.',
      fileNotCalendar: 'That is not a calendar file — it has no BEGIN:VCALENDAR line. If you saved it from a page that asked you to sign in, you probably saved the sign-in page instead of the .ics.',
      fileEmpty: 'That calendar has no events in it.',
      fileTooBig: 'That file is {mb} MB. The importer stops at {maxmb} MB.',
      fileTruncated: 'The file stops in the middle of an event, so the last entry was skipped. Re-export it and try again.',
      fileTooMany: 'That calendar has more than {max} events, so only the first {max} were read.',
      locationMissing: 'Row {n} ({title}) has no location, so there is nowhere to walk to. Add the building and room to that event, or type it in below.',
      buildingUnknown: 'Row {n} ({title}): "{loc}" is not a UT building code.',
      buildingSuggest: ' Did you mean {suggest}?',
      buildingAddress: 'Row {n} ({title}): "{loc}" looks like a street address, not a UT building code. Class locations read like "WEL 2.224".',
      buildingOffMap: 'Row {n} ({title}): {code} is at the Pickle Research Campus, about {km} km north of here. This map only covers the main campus.',
      buildingUnmapped: 'Row {n} ({title}): {code} is a real UT building, but this build has no walkable doors for it yet.',
      dateMalformed: 'Row {n} ({title}) has an unreadable {field} ("{raw}"), so we do not know when it meets.',
      timeMissing: 'Row {n} ({title}) has no start time.',
      eventTruncated: 'Row {n} ({title}) is cut off at the end of the file and was skipped.',
      guessedByName: 'Row {n} ({title}) says "{loc}" — matched to {code} ({name}) by name rather than by building code. Worth a look.',
      noRoute: '{fromCode} to {toCode}: no walking route found between those two buildings.',
      // "Row", not "Line", and deliberately the same word the ICS problems
      // use. A paste that produced one `Row 6` and one `Line 7` about the
      // same seven lines reads like two different programs talking.
      rowNoLocation: 'Row {n} ("{line}") names a course but no building.',
      rowUnreadable: 'Row {n} ("{line}") does not read like a class. A row needs at least a building and room, e.g. "WEL 2.224".',
      fileNotSchedule: 'None of the {total} lines in that text look like a class. A schedule line needs a building and room, e.g. "GOV 312L, WEL 2.224, MWF 1:00pm".',
    },
  };
  WAYFIND.schedule = SCHEDULE;

  const SCHED_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  // A date, or a date-time, with an optional trailing Z for UTC. Deliberately
  // strict: `2026O826T140000` (letter O for zero) must FAIL rather than be
  // silently coerced, because a wrong class time is worse than a missing one.
  const SCHED_DT_RE = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/;
  // UT's own format, from registrar.utexas.edu/schedules/269/using: a code,
  // one space, a floor.room. The room may be `220`, `2.224`, `A121A`, `1.606D`.
  //
  // THE CODE HALF IS DELIBERATELY WIDER THAN A VALID CODE — up to six
  // characters, not three — AND THAT IS THE WHOLE POINT. "Does this string
  // CLAIM a building code" is a question about shape; "is that code real" is a
  // question about vocabulary, and running them together is what broke the
  // first cut of this parser. `MAII 220` (a real typo for `MAI 220`) did not
  // fit a 2-3 character code, so it fell past this test to the free-text name
  // ladder — and `search()`, which is a forgiving type-ahead, fuzzed `maii`
  // onto `mail` and resolved a Government lecture to the **Comal Mail Service
  // Building**. That is precisely the wrong-building-with-confidence failure
  // the note above `search()` exists to prevent, arriving through the back
  // door. A wide claim plus a strict vocabulary check gives the student
  // "MAII is not a UT building code. Did you mean MAI?" instead.
  const SCHED_CODE_ROOM_RE = /^([A-Z][A-Z0-9]{1,5})\s+([0-9A-Z][0-9A-Z.\-]*)$/;
  // A ROOM CONTAINS A DIGIT, always — `220`, `2.224`, `A121A`, `1.606D`. Without
  // that, `Welch Hall` parses as building `WELCH` room `HALL` and a perfectly
  // good name match is turned into an error.
  const SCHED_ROOM_DIGIT_RE = /[0-9]/;
  const SCHED_PARENS_RE = /\(\s*([A-Z]{2,3}[0-9]?)\s*\)/;
  // Anything that opens with a street number, or carries a US ZIP, is an
  // ADDRESS and must never be handed to the name ladder — `search()` is a
  // forgiving type-ahead and will happily fuzzy a street name onto a building.
  const SCHED_ADDRESS_RE = /(^\s*\d{2,6}\s+\S)|(\b\d{5}(-\d{4})?\b)/;
  // A time, only where a colon or an am/pm marker proves it is one. Without
  // that guard `MWF 10` parses as building `MWF` room `10`.
  const SCHED_TIME_RE = /\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\.?\b|\b(\d{1,2}):(\d{2})\b/gi;
  const SCHED_COURSE_RE = /\b([A-Z]{1,3}(?:\s+[A-Z])?\s+\d{3}[A-Z]?)\b/;
  // A saved WEB PAGE, which is what a student uploads when the export link
  // bounced them through a sign-in wall. Two independent tests, because the
  // two real shapes differ: a whole saved document opens with a doctype or an
  // `<html>` root, while a page saved as a FRAGMENT (or copied out of a
  // Canvas panel) has neither and is only recognisable by tag density.
  const SCHED_MARKUP_HEAD_RE = /^\uFEFF?\s*(?:<\?xml\b|<!DOCTYPE\b|<!--|<html\b|<head\b|<body\b)/i;
  const SCHED_TAG_RE = /<\/?[a-z][a-z0-9]*(?:\s[^<>]*)?\/?>/i;

  /** Fill `{k}` placeholders in one of SCHEDULE.say's strings. */
  function schedSay(key, vars) {
    let s = String((SCHEDULE.say && SCHEDULE.say[key]) || key);
    if (vars) for (const k in vars) s = s.split('{' + k + '}').join(String(vars[k]));
    return s;
  }

  /**
   * A line, quoted back to the student, trimmed to something readable.
   *
   * The error that prompted this quoted a whole line of HTML into a sentence.
   * An error message that is itself unreadable is not an error message.
   */
  function schedSnippet(line) {
    const s = String(line == null ? '' : line).trim().replace(/\s+/g, ' ');
    const max = SCHEDULE.rowSnippetMax;
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
  }

  function schedProblem(level, code, text, at, hint) {
    return { level: level, code: code, text: text, at: at || null, hint: hint || '' };
  }

  // ── ICS lexing ────────────────────────────────────────────────────────────

  /**
   * RFC 5545 §3.1 line unfolding, and it has to happen before anything else.
   *
   * Google and Apple both fold at 75 octets: the value continues on the next
   * physical line, marked by a leading space or tab. A LOCATION carrying a
   * street address is routinely split across three lines that way — which is
   * exactly the "multi-line address" case this lane is judged on. A parser
   * that reads physical lines sees `LOCATION:2617 Wichita Street\, Building`
   * and a mystery line starting with a space.
   *
   * The source line number of the FIRST physical line is kept, so an error can
   * say where in the file to look.
   */
  function schedUnfold(text) {
    let s = String(text == null ? '' : text);
    if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);       // BOM
    const raw = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const out = [];
    for (let i = 0; i < raw.length; i++) {
      const l = raw[i];
      const c = l.charCodeAt(0);
      if (out.length && (c === 32 || c === 9)) out[out.length - 1].text += l.slice(1);
      else out.push({ text: l, line: i + 1 });
    }
    return out;
  }

  /** RFC 5545 §3.3.11 TEXT unescaping. `\n` and `\N` are both a newline. */
  function schedUnescape(v) {
    return String(v == null ? '' : v).replace(/\\([\\;,nN])/g,
      (m, c) => (c === 'n' || c === 'N') ? '\n' : c);
  }

  /**
   * One content line -> { name, params, value }.
   *
   * Scanned, not `split(':')`, because a quoted parameter value may contain a
   * colon and every Apple export has one: `X-APPLE-STRUCTURED-LOCATION;
   * X-ADDRESS="...":geo:30.28,-97.73` breaks a naive split three ways.
   */
  function schedLine(text) {
    let i = 0, q = false;
    const n = text.length;
    for (; i < n; i++) {
      const c = text[i];
      if (c === '"') { q = !q; continue; }
      if (c === ':' && !q) break;
    }
    if (i >= n) return null;                       // no colon: not a content line
    const head = text.slice(0, i), value = text.slice(i + 1);
    const parts = [];
    let cur = '', inq = false;
    for (let k = 0; k < head.length; k++) {
      const c = head[k];
      if (c === '"') { inq = !inq; continue; }
      if (c === ';' && !inq) { parts.push(cur); cur = ''; continue; }
      cur += c;
    }
    parts.push(cur);
    const params = {};
    for (let k = 1; k < parts.length; k++) {
      const eq = parts[k].indexOf('=');
      if (eq < 0) params[parts[k].toUpperCase().trim()] = '';
      else params[parts[k].slice(0, eq).toUpperCase().trim()] = parts[k].slice(eq + 1);
    }
    return { name: parts[0].toUpperCase().trim(), params: params, value: value };
  }

  /**
   * A UTC instant -> wall-clock date and minute in `tz`, via the platform's own
   * zone database. No offset table in this file, so DST is never wrong.
   *
   * It matters more than it looks: every real export ends its RRULE with
   * `UNTIL=20261208T055959Z`, which is 23:59:59 on 7 December in Chicago. Read
   * as a UTC date the semester appears to run a day longer than it does.
   */
  function schedZoned(ms, tz) {
    try {
      const f = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hour12: false, year: 'numeric', month: '2-digit',
        day: '2-digit', hour: '2-digit', minute: '2-digit',
      });
      const p = {};
      for (const x of f.formatToParts(new Date(ms))) p[x.type] = x.value;
      let h = +p.hour; if (h === 24) h = 0;
      return { date: p.year + '-' + p.month + '-' + p.day, min: h * 60 + (+p.minute) };
    } catch (e) {
      const d = new Date(ms);
      const p2 = (x) => (x < 10 ? '0' : '') + x;
      return {
        date: d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate()),
        min: d.getUTCHours() * 60 + d.getUTCMinutes(),
      };
    }
  }

  /**
   * A DTSTART/DTEND/UNTIL value -> { ok, date, min, kind }.
   *
   * `min` is minutes past LOCAL midnight and nothing here ever builds a Date
   * from a floating or TZID value, because the browser's own zone would leak
   * into a class time that is defined in Austin's.
   */
  function schedDT(value, params) {
    const v = String(value == null ? '' : value).trim();
    const m = SCHED_DT_RE.exec(v);
    if (!m) return { ok: false, why: 'malformed', raw: v };
    const y = +m[1], mo = +m[2], d = +m[3];
    const probe = new Date(Date.UTC(y, mo - 1, d));
    if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) {
      return { ok: false, why: 'range', raw: v };
    }
    const dateStr = m[1] + '-' + m[2] + '-' + m[3];
    if (!m[4]) return { ok: true, kind: 'date', date: dateStr, min: null, raw: v };
    const hh = +m[4], mi = +m[5], ss = +m[6];
    if (hh > 23 || mi > 59 || ss > 60) return { ok: false, why: 'range', raw: v };
    if (m[7]) {
      const z = schedZoned(Date.UTC(y, mo - 1, d, hh, mi, ss),
        (params && params.TZID) || SCHEDULE.tz);
      return { ok: true, kind: 'utc', date: z.date, min: z.min, raw: v };
    }
    return {
      ok: true, kind: (params && params.TZID) ? 'zoned' : 'floating',
      date: dateStr, min: hh * 60 + mi, raw: v,
    };
  }

  /** `YYYY-MM-DD` -> `MO` / `TU` / ... */
  function schedDow(dateStr) {
    const p = String(dateStr || '').split('-');
    if (p.length !== 3) return '';
    return SCHED_DAYS[new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay()] || '';
  }

  /** RRULE -> the only three fields a class schedule needs from it. */
  function schedRRule(v) {
    const out = { freq: '', interval: 1, byday: [], until: null, count: null, raw: String(v || '') };
    for (const part of out.raw.split(';')) {
      const eq = part.indexOf('=');
      if (eq < 0) continue;
      const k = part.slice(0, eq).toUpperCase(), val = part.slice(eq + 1);
      if (k === 'FREQ') out.freq = val.toUpperCase();
      else if (k === 'INTERVAL') out.interval = Math.max(1, parseInt(val, 10) || 1);
      else if (k === 'COUNT') out.count = parseInt(val, 10) || null;
      else if (k === 'UNTIL') { const d = schedDT(val, {}); out.until = d.ok ? d.date : null; }
      else if (k === 'BYDAY') {
        out.byday = val.toUpperCase().split(',')
          // `2SU` (second Sunday) is an ordinal form VTIMEZONE uses; the
          // ordinal is dropped, the weekday kept.
          .map(s => s.replace(/^[-+]?\d+/, '').trim())
          .filter(s => SCHED_DAYS.indexOf(s) >= 0);
      }
    }
    return out;
  }

  // ── location -> building code ─────────────────────────────────────────────

  let schedCodeCache = null;
  /**
   * Every building code this app has any knowledge of, and where from.
   *
   * Three sources, and they genuinely disagree — that disagreement is what
   * lets an error say WHICH kind of gap a code fell into:
   *   graph     walk_graph.json, has doors, routes today
   *   register  data/ut_buildings.json, findable, may or may not route
   *   ut        UT_CELEBRATED only — not findable by `search()` at all (SSW)
   */
  function schedCodes() {
    if (schedCodeCache && schedCodeCache.g === G) return schedCodeCache.map;
    const map = new Map();
    if (G && G.byCode) {
      for (const [c, e] of G.byCode) {
        if (!c || !/^[A-Z0-9]{2,4}$/.test(c)) continue;
        map.set(c, { name: (e && e.display) || c, where: (e && e.routable) ? 'graph' : 'register' });
      }
    }
    for (const c of utIndex().keys()) if (!map.has(c)) map.set(c, { name: c, where: 'ut' });
    schedCodeCache = { g: G, map: map };
    return map;
  }

  /** Metres from `campusCentre` to a UT_CELEBRATED row. */
  function schedMetresOut(rec) {
    const dx = (rec.lon - SCHEDULE.campusCentre[0]) * MPD_LON;
    const dy = (rec.lat - SCHEDULE.campusCentre[1]) * MPD_LAT;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Codes one edit away from `up`, for the error text ONLY.
   *
   * `search()` refuses to fuzzy-match codes and it is right to: `WEL`'s 1-edit
   * neighbourhood holds `WCP`, `WMB` and `MEL`. So this never resolves
   * anything — it hands the student a name and lets them decide.
   */
  function schedSuggest(up) {
    const out = [];
    for (const [c, rec] of schedCodes()) {
      if (c !== up && withinOne(up, c)) out.push({ code: c, name: rec.name });
    }
    out.sort((a, b) => a.code.localeCompare(b.code));
    return out.slice(0, SCHEDULE.suggestMax);
  }

  /**
   * A LOCATION string -> { code, room, text, lines } with nothing resolved yet.
   *
   * The order is the evidence ladder, strongest first:
   *   1. a code in parentheses anywhere — Apple writes `Welch Hall (WEL), ...`
   *   2. UT's own `CODE ROOM` on the first line — the format registrar.utexas.
   *      edu documents and the one UT Registration Plus emits
   *   3. the first line IS a bare code
   *   4. nothing structural; the text is handed on for a name match, unless it
   *      is an address (see SCHED_ADDRESS_RE)
   */
  function schedLocation(value) {
    const whole = schedUnescape(value);
    const lines = whole.split('\n').map(s => s.trim()).filter(Boolean);
    if (!lines.length) return { empty: true, text: '', lines: [], raw: whole };
    const head = lines[0];
    const out = { empty: false, code: null, room: '', text: head, lines: lines, raw: whole };

    const par = SCHED_PARENS_RE.exec(whole);
    if (par) {
      out.code = par[1].toUpperCase();
      const rest = head.replace(SCHED_PARENS_RE, ' ').replace(/[,;]/g, ' ').trim();
      const cr = SCHED_CODE_ROOM_RE.exec(rest.toUpperCase());
      if (cr && cr[1] === out.code && SCHED_ROOM_DIGIT_RE.test(cr[2])) out.room = cr[2];
      return out;
    }
    // A trailing `, Austin, TX 78712` is decoration on an otherwise fine
    // `WEL 2.224` — drop it before testing the shape, but only the tail.
    const trimmed = head.replace(/\s*,\s*Austin\b.*$/i, '').trim();
    const cr = SCHED_CODE_ROOM_RE.exec(trimmed.toUpperCase());
    if (cr && SCHED_ROOM_DIGIT_RE.test(cr[2])) { out.code = cr[1]; out.room = cr[2]; return out; }
    const bare = trimmed.toUpperCase();
    if (/^[A-Z]{2,4}[0-9]?$/.test(bare)) { out.code = bare; return out; }
    out.address = SCHED_ADDRESS_RE.test(whole);
    return out;
  }

  /**
   * A free-text location -> a building, but only on REAL evidence.
   *
   * `search()` is the type-ahead ladder and it is forgiving on purpose: a
   * student watching a list of suggestions can see it guessed wrong. An
   * importer has no such feedback loop — it takes the top hit and routes. So
   * the top hit is only accepted here when a whole alphabetic word of four
   * characters or more from the location is a genuine PREFIX of one of the
   * building's own words. A one-edit fuzz is not evidence; `maii` is not
   * allowed to become `mail`.
   */
  function schedByName(text) {
    const t = String(text || '');
    if (!t.trim() || SCHED_ADDRESS_RE.test(t)) return null;
    let hits = [];
    try { hits = (G ? search(t) : []) || []; } catch (e) { return null; }
    const top = hits[0];
    if (!top || !top.code) return null;
    const words = norm(t).split(' ').filter(w => w.length >= 4 && /^[a-z]+$/.test(w));
    if (!words.length) return null;
    const own = (top.tokens || []).concat(norm(top.display || '').split(' ')).filter(Boolean);
    if (!words.some(w => own.some(o => o.startsWith(w)))) return null;
    return {
      status: 'byName', code: top.code, room: '',
      name: top.display || top.code, routable: null,
    };
  }

  /**
   * A parsed location -> what this app can actually say about it.
   *
   * status is one of:
   *   ok        a code `search()` finds. It may still not route — see the HLB
   *             note at the top of this section — so `routable` stays null
   *             until wayfindScheduleCheck() has actually tried.
   *   byName    no code, but the free text matched a building name. A WARNING,
   *             never silent: the student is told what we guessed.
   *   offmap    a real UT code more than `offMapM` from campus (Pickle)
   *   unmapped  a real UT code on campus that this build cannot find (SSW)
   *   unknown   not a UT building code at all
   *   missing   no location on the event
   */
  function schedResolve(loc) {
    if (!loc || loc.empty) return { status: 'missing', code: null, room: '' };
    if (loc.code) {
      const up = loc.code.toUpperCase();
      const hit = (G && G.byCode) ? G.byCode.get(up) : null;
      if (hit) {
        return {
          status: 'ok', code: up, room: loc.room, name: hit.display || up,
          indexed: true, routable: null,
        };
      }
      const ut = utIndex().get(up);
      if (ut && ut.length) {
        const m = schedMetresOut(ut[0]);
        return {
          status: m > SCHEDULE.offMapM ? 'offmap' : 'unmapped',
          code: up, room: loc.room, name: up, routable: false,
          km: Math.round(m / 100) / 10,
        };
      }
      // A code-shaped token this app has never heard of. Before failing it,
      // ask whether the WHOLE string is a building name we do know — that is
      // how `Jester Center` survives being read as a code-shaped `JESTER`.
      const named = schedByName(loc.text);
      if (named) return named;
      return { status: 'unknown', code: up, room: loc.room, routable: false, suggest: schedSuggest(up) };
    }
    // No code. An address never goes to the name ladder — `search()` is a
    // forgiving type-ahead and would fuzz a street name onto a building.
    if (loc.address) {
      return { status: 'unknown', code: null, room: '', address: true, routable: false, suggest: [] };
    }
    const named = schedByName(loc.text);
    if (named) return named;
    return { status: 'unknown', code: null, room: '', routable: false, suggest: [] };
  }

  /** Turn one resolution into the problem, if any, a student should read. */
  function schedLocProblem(res, ev, at) {
    const n = ev.index, title = ev.title || ev.course || 'untitled';
    if (res.status === 'ok') return null;
    if (res.status === 'missing') {
      return schedProblem('error', 'LOCATION_MISSING',
        schedSay('locationMissing', { n: n, title: title }), at,
        'Every class needs a building before it can be walked to.');
    }
    if (res.status === 'byName') {
      return schedProblem('warning', 'BUILDING_BY_NAME',
        schedSay('guessedByName', { n: n, title: title, loc: ev.locationText, code: res.code, name: res.name }),
        at, 'Building codes are exact; names are matched loosely.');
    }
    if (res.status === 'offmap') {
      return schedProblem('error', 'BUILDING_OFF_MAP',
        schedSay('buildingOffMap', { n: n, title: title, code: res.code, km: res.km }), at,
        'Nothing at the Pickle Research Campus can be routed on this map.');
    }
    if (res.status === 'unmapped') {
      return schedProblem('error', 'BUILDING_NOT_WALKABLE',
        schedSay('buildingUnmapped', { n: n, title: title, code: res.code }), at,
        'The building is real; this build is missing its doors.');
    }
    if (res.address) {
      return schedProblem('error', 'BUILDING_IS_ADDRESS',
        schedSay('buildingAddress', { n: n, title: title, loc: ev.locationText }), at,
        'Replace the address with the building code and room.');
    }
    let text = schedSay('buildingUnknown', { n: n, title: title, loc: ev.locationText || res.code || '' });
    if (res.suggest && res.suggest.length) {
      text += schedSay('buildingSuggest', {
        suggest: res.suggest.map(s => s.code + (s.name && s.name !== s.code ? ' (' + s.name + ')' : '')).join(' or '),
      });
    }
    return schedProblem('error', 'BUILDING_UNKNOWN', text, at,
      'We will not guess between codes one letter apart — pick one.');
  }

  // ── ICS -> raw events ─────────────────────────────────────────────────────

  /**
   * Walk the file once, tracking component nesting.
   *
   * NESTING IS NOT OPTIONAL AND THIS IS THE TRAP. Every Google and Apple export
   * carries a VTIMEZONE whose BEGIN:STANDARD and BEGIN:DAYLIGHT blocks each
   * hold their own `DTSTART:19701101T020000`. A parser that collects properties
   * without knowing which component it is inside reads 2 a.m. on 1 November
   * 1970 as a class time. Only properties whose immediately enclosing
   * component is VEVENT are kept — which also drops VALARM's DESCRIPTION and
   * TRIGGER for free.
   */
  function schedScanICS(text) {
    const lines = schedUnfold(text);
    const stack = [];
    const events = [];
    const cal = { name: '', prodId: '', tz: '', sawCalendar: false, truncated: false };
    let cur = null;

    for (let i = 0; i < lines.length; i++) {
      const L = lines[i];
      if (!L.text || !L.text.trim()) continue;
      const p = schedLine(L.text);
      if (!p) continue;
      if (p.name === 'BEGIN') {
        const comp = p.value.toUpperCase().trim();
        stack.push(comp);
        if (comp === 'VCALENDAR') cal.sawCalendar = true;
        if (comp === 'VEVENT' && !cur) cur = { line: L.line, props: [], truncated: false };
        continue;
      }
      if (p.name === 'END') {
        const comp = p.value.toUpperCase().trim();
        if (comp === 'VEVENT' && cur) { events.push(cur); cur = null; }
        const at = stack.lastIndexOf(comp);
        if (at >= 0) stack.length = at; else stack.pop();
        continue;
      }
      if (stack.length === 1 && stack[0] === 'VCALENDAR') {
        if (p.name === 'X-WR-CALNAME') cal.name = schedUnescape(p.value).trim();
        else if (p.name === 'PRODID') cal.prodId = schedUnescape(p.value).trim();
        else if (p.name === 'X-WR-TIMEZONE') cal.tz = p.value.trim();
        continue;
      }
      if (cur && stack[stack.length - 1] === 'VEVENT') cur.props.push({ p: p, line: L.line });
    }
    if (cur) { cur.truncated = true; cal.truncated = true; events.push(cur); }
    return { cal: cal, events: events };
  }

  /** One raw VEVENT -> one event in the shape, with its own problems attached. */
  function schedEventFromICS(raw, idx, defTz) {
    const first = (name) => {
      for (const q of raw.props) if (q.p.name === name) return q;
      return null;
    };
    const ev = {
      index: idx, id: '', title: '', course: '', locationText: '',
      code: null, room: '', days: [], startMin: null, endMin: null,
      firstDate: null, lastDate: null, exDates: [], tz: defTz || SCHEDULE.tz,
      status: 'ok', problems: [], resolved: null,
      raw: { line: raw.line, uid: '', summary: '', location: '', rrule: '' },
    };
    const at = (field, line) => ({ event: idx, line: line || raw.line, field: field || '' });

    const uid = first('UID');
    ev.id = uid ? schedUnescape(uid.p.value).trim() : ('row-' + idx);
    ev.raw.uid = ev.id;

    const sum = first('SUMMARY');
    ev.title = sum ? schedUnescape(sum.p.value).trim() : '';
    ev.raw.summary = ev.title;
    const cm = SCHED_COURSE_RE.exec(ev.title.toUpperCase());
    ev.course = cm ? cm[1].replace(/\s+/g, ' ').trim() : '';

    if (raw.truncated) {
      ev.status = 'failed';
      ev.problems.push(schedProblem('error', 'EVENT_TRUNCATED',
        schedSay('eventTruncated', { n: idx, title: ev.title || 'untitled' }), at('', raw.line),
        'The file ended before this event closed, so its fields cannot be trusted.'));
    }

    const ds = first('DTSTART');
    if (!ds) {
      ev.status = 'failed';
      ev.problems.push(schedProblem('error', 'TIME_MISSING',
        schedSay('timeMissing', { n: idx, title: ev.title || 'untitled' }), at('DTSTART')));
    } else {
      ev.tz = ds.p.params.TZID || defTz || SCHEDULE.tz;
      const d = schedDT(ds.p.value, ds.p.params);
      if (!d.ok) {
        ev.status = 'failed';
        ev.problems.push(schedProblem('error', 'DATE_MALFORMED',
          schedSay('dateMalformed', { n: idx, title: ev.title || 'untitled', field: 'start date', raw: d.raw }),
          at('DTSTART', ds.line), 'Dates look like 20260826T100000.'));
      } else {
        ev.firstDate = d.date;
        ev.startMin = d.min;
      }
    }
    const de = first('DTEND');
    if (de) {
      const d2 = schedDT(de.p.value, de.p.params);
      if (!d2.ok) {
        ev.problems.push(schedProblem('warning', 'DATE_MALFORMED',
          schedSay('dateMalformed', { n: idx, title: ev.title || 'untitled', field: 'end date', raw: d2.raw }),
          at('DTEND', de.line), 'The class still imports; only its length is unknown.'));
      } else ev.endMin = d2.min;
    }

    const rr = first('RRULE');
    if (rr) {
      const r = schedRRule(rr.p.value);
      ev.raw.rrule = r.raw;
      ev.days = r.byday.slice();
      ev.lastDate = r.until;
    }
    if (!ev.days.length && ev.firstDate) {
      const d = schedDow(ev.firstDate);
      if (d) ev.days = [d];
    }
    for (const q of raw.props) {
      if (q.p.name !== 'EXDATE') continue;
      for (const one of String(q.p.value).split(',')) {
        const d = schedDT(one, q.p.params);
        if (d.ok && ev.exDates.indexOf(d.date) < 0) ev.exDates.push(d.date);
      }
    }

    const loc = first('LOCATION');
    ev.raw.location = loc ? loc.p.value : '';
    const parsed = schedLocation(loc ? loc.p.value : '');
    ev.locationText = parsed.empty ? '' : parsed.text;
    const res = schedResolve(parsed);
    ev.resolved = res;
    ev.code = res.code;
    ev.room = res.room || parsed.room || '';
    const lp = schedLocProblem(res, ev, at('LOCATION', loc ? loc.line : raw.line));
    if (lp) {
      ev.problems.push(lp);
      if (lp.level === 'error') ev.status = 'failed';
    }
    return ev;
  }

  // ── manual / pasted text ─────────────────────────────────────────────────

  /** Minutes past midnight for `h:mm` with UT's afternoon convention. */
  function schedClock(h, m, ap) {
    let hh = h % 24;
    if (ap === 'p') { if (hh !== 12) hh += 12; }
    else if (ap === 'a') { if (hh === 12) hh = 0; }
    else if (hh < SCHEDULE.pmCutoffHour) hh += 12;      // "TTh 2:00" is 14:00
    return hh * 60 + (m || 0);
  }

  /**
   * Pull the times out of one pasted line and hand back the line with them
   * blanked, so the building scan that follows cannot mistake `10:00` for a
   * room number.
   */
  function schedTimesOf(line) {
    const found = [];
    SCHED_TIME_RE.lastIndex = 0;
    const masked = line.replace(SCHED_TIME_RE, function (m, h1, m1, ap, h2, m2) {
      if (h1 != null) found.push(schedClock(+h1, m1 == null ? 0 : +m1, String(ap).toLowerCase()));
      else found.push({ h: +h2, m: +m2 });
      return ' '.repeat(m.length);
    });
    // A bare `12:30-2:00` carries no marker. The first one sets the half of the
    // day; anything after it that would run backwards is pushed to the
    // afternoon, which is what "12:30-2:00" means on every schedule ever
    // printed.
    const out = [];
    for (const f of found) {
      if (typeof f === 'number') { out.push(f); continue; }
      let v = schedClock(f.h, f.m, '');
      if (out.length && v < out[out.length - 1] && v + 720 <= 1439) v += 720;
      out.push(v);
    }
    return { times: out, masked: masked };
  }

  /**
   * The day pattern in one pasted line, and the line with it blanked.
   *
   * LONGEST MATCH WINS, ACROSS THE WHOLE LINE — not the first match found.
   * `C S 429  MWF 10:00 am  GDC 2.216` is a real UT row and its first
   * day-word-shaped token is the `S` of the field-of-study `C S`, which reads
   * as Saturday. `M 340L ... TTh ...` reads as Monday for the same reason. A
   * three-letter `MWF` sitting later in the same line is far better evidence
   * than a one-letter token, so length decides and position only breaks ties.
   */
  function schedDaysOf(line) {
    const toks = line.split(/[\s,;|–—]+/);
    let best = null;
    for (let i = 0; i < toks.length; i++) {
      const up = toks[i].toUpperCase().replace(/[^A-Z]/g, '');
      if (!up) continue;
      for (const [word, days] of SCHEDULE.dayWords) {
        if (up !== word) continue;
        if (!best || word.length > best.word.length) best = { word: word, days: days, tok: toks[i] };
        break;
      }
    }
    if (!best) return { days: [], masked: line };
    const esc = best.tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return {
      days: best.days.slice(),
      masked: line.replace(new RegExp('\\b' + esc + '\\b'), ' '.repeat(best.tok.length)),
    };
  }

  /**
   * One pasted row -> one event.
   *
   * THE TRAP THE UT RECON DOC NAMED: a course number and a building+room are
   * the same SHAPE. `GOV 312L` and `WEL 2.224` both read `three letters, a
   * space, a number`. Nothing in the string tells them apart, so the shape is
   * not what decides — the app's own vocabulary is. Every `CODE NUM` candidate
   * on the line is collected and the one whose code is a KNOWN BUILDING wins.
   * If none is known the LAST candidate is reported as the failure, because UT
   * prints the room after the course on its own schedule rows.
   */
  function schedEventFromRow(line, idx) {
    const ev = {
      index: idx, id: 'row-' + idx, title: '', course: '', locationText: '',
      code: null, room: '', days: [], startMin: null, endMin: null,
      firstDate: null, lastDate: null, exDates: [], tz: SCHEDULE.tz,
      status: 'ok', problems: [], resolved: null,
      raw: { line: idx, uid: '', summary: line, location: '', rrule: '' },
    };
    const at = { event: idx, line: idx, field: '' };
    const flat = line.replace(/[–—|]/g, ' ');
    const t = schedTimesOf(flat);
    ev.startMin = t.times.length ? t.times[0] : null;
    ev.endMin = t.times.length > 1 ? t.times[1] : null;
    const d = schedDaysOf(t.masked);
    ev.days = d.days;

    const known = schedCodes();
    const cands = [];
    // Same width as SCHED_CODE_ROOM_RE and for the same reason: a typo has to
    // be CAUGHT here, not silently skipped. `MAII 220` must become a candidate
    // so it can be reported, otherwise the row degrades to "no building" and
    // the student never learns which letter is wrong.
    const re = /\b([A-Za-z][A-Za-z0-9]{1,5})\s+([0-9A-Za-z][0-9A-Za-z.\-]*)\b/g;
    let m;
    while ((m = re.exec(d.masked))) {
      if (!SCHED_ROOM_DIGIT_RE.test(m[2])) continue;
      const code = m[1].toUpperCase();
      cands.push({ code: code, room: m[2], text: m[1] + ' ' + m[2], known: known.has(code) });
    }
    const cm = SCHED_COURSE_RE.exec(line.toUpperCase());
    ev.course = cm ? cm[1].replace(/\s+/g, ' ').trim() : '';
    ev.title = ev.course || line.trim();

    // WHICH TOKEN IS THE BUILDING. `GOV 312L` and `WEL 2.224` are the same
    // SHAPE — three letters, a space, a number — so shape cannot decide, and
    // docs/import-bar-ut.md flagged exactly this as the trap. The app's own
    // vocabulary decides instead: the LAST candidate whose code is a real
    // building wins, because UT prints the room after the course on its own
    // schedule rows. `MAI 220, TTh 2:00pm` — the brief's own example — is a
    // line where the only candidate is BOTH a course-shaped token and a known
    // building, and there the building wins: a known code is hard evidence and
    // course-shape is not. The residual ambiguity is real and documented in
    // docs/si-parser.md (`ART 302` could be either), and it resolves the way a
    // walking app should: toward a building it can actually take you to.
    let pick = null;
    for (let i = cands.length - 1; i >= 0; i--) {
      if (cands[i].known) { pick = cands[i]; break; }
    }
    if (!pick && cands.length) {
      const tail = cands[cands.length - 1];
      if (!(cands.length === 1 && tail.text === ev.course)) pick = tail;
    }
    // DOES THIS LINE CARRY ANY SIGNAL AT ALL that it is about a class? A
    // building candidate, a course number, a clock time, or a day word will
    // do. `schedParseRows` uses this to tell "a schedule with a broken row"
    // apart from "this is not a schedule", which are different sentences.
    ev.hasSignal = !!(cands.length || ev.course || ev.startMin != null || ev.days.length);

    if (!pick) {
      ev.status = 'failed';
      // TWO DIFFERENT FAILURES, AND SAYING THE WRONG ONE IS WORSE THAN SAYING
      // NOTHING. "names a course but no building" is exactly right for
      // `PSY 301, TTh 2:00pm-3:30pm` and a lie about `<!DOCTYPE html>` — and
      // the lie is what shipped, because this branch did not look at whether
      // a course had actually been found. `rowUnreadable` existed for the
      // other case and was dead text nothing ever reached.
      const named = !!ev.course;
      ev.problems.push(schedProblem('error',
        named ? 'LOCATION_MISSING' : 'ROW_UNREADABLE',
        schedSay(named ? 'rowNoLocation' : 'rowUnreadable',
          { n: idx, line: schedSnippet(line) }), at,
        named
          ? 'Add the building and room, e.g. "WEL 2.224".'
          : 'Type one class per line, e.g. "GOV 312L, WEL 2.224, MWF 1:00pm".'));
      return ev;
    }
    ev.locationText = pick.text;
    const res = schedResolve({ empty: false, code: pick.code, room: pick.room, text: pick.text, lines: [pick.text] });
    ev.resolved = res;
    ev.code = res.code;
    ev.room = res.room || pick.room;
    const lp = schedLocProblem(res, ev, at);
    if (lp) {
      ev.problems.push(lp);
      if (lp.level === 'error') ev.status = 'failed';
    }
    if (ev.startMin == null) {
      ev.problems.push(schedProblem('warning', 'TIME_MISSING',
        schedSay('timeMissing', { n: idx, title: ev.title }), at,
        'The class imports; we just cannot order it in the day.'));
    }
    return ev;
  }

  // ── assembly ──────────────────────────────────────────────────────────────

  /**
   * The one internal shape, and the reason it looks like this.
   *
   * NOTHING AT THE TOP LEVEL IS ICS-SPECIFIC. `source.kind` names where the
   * bytes came from and `raw` per event keeps whatever that source had, but a
   * consumer reads `code`, `room`, `days`, `startMin`, `endMin` and never has
   * to know whether an .ics, a paste, an OCR pass or a Registration-Plus API
   * produced them. That is the whole "add a fourth source without a rewrite"
   * requirement, and `wayfindScheduleFrom()` is the door it comes in through.
   */
  function schedAssemble(source, events, problems, note) {
    const ok = events.filter(e => e.status === 'ok');
    const failed = events.filter(e => e.status !== 'ok');
    const all = problems.slice();
    for (const e of events) for (const p of e.problems) all.push(p);
    const total = events.length;
    let summary;
    if (!total) summary = note || schedSay('fileEmpty', {});
    else if (!ok.length) summary = schedSay('summaryNone', { total: total });
    else if (failed.length) summary = schedSay('summaryPartial', { ok: ok.length, total: total, failed: failed.length });
    else summary = schedSay('summaryAllOk', { ok: ok.length });
    return {
      shape: SCHEDULE.shape,
      version: SCHEDULE.shapeVersion,
      source: source,
      tz: SCHEDULE.tz,
      events: events,
      problems: all,
      counts: {
        total: total, ok: ok.length, failed: failed.length,
        errors: all.filter(p => p.level === 'error').length,
        warnings: all.filter(p => p.level === 'warning').length,
      },
      summary: summary,
      // A convenience the interface lane asked for in docs/import-bar-*.md:
      // the classes that CAN be walked to, in day order then clock order.
      routable: ok.filter(e => e.code).slice().sort((a, b) =>
        (SCHED_DAYS.indexOf(a.days[0] || '') - SCHED_DAYS.indexOf(b.days[0] || '')) ||
        ((a.startMin == null ? 1e9 : a.startMin) - (b.startMin == null ? 1e9 : b.startMin))),
    };
  }

  /** ICS text -> the shape. Synchronous; `G` must already be loaded to resolve. */
  function schedParseICS(text, source) {
    const problems = [];
    const bytes = String(text || '').length;
    if (bytes > SCHEDULE.maxBytes) {
      problems.push(schedProblem('error', 'FILE_TOO_BIG', schedSay('fileTooBig', {
        mb: Math.round(bytes / 104857.6) / 10, maxmb: Math.round(SCHEDULE.maxBytes / 1048576),
      }), null, 'Export just this semester rather than the whole calendar.'));
      return schedAssemble(source, [], problems, problems[0].text);
    }
    const scan = schedScanICS(text);
    if (!scan.cal.sawCalendar && !scan.events.length) {
      problems.push(schedProblem('error', 'FILE_NOT_CALENDAR', schedSay('fileNotCalendar', {}), null,
        'Look for a file ending in .ics.'));
      return schedAssemble(source, [], problems, problems[0].text);
    }
    if (scan.cal.truncated) {
      problems.push(schedProblem('error', 'FILE_TRUNCATED', schedSay('fileTruncated', {}), null, ''));
    }
    let raws = scan.events;
    if (raws.length > SCHEDULE.maxEvents) {
      problems.push(schedProblem('warning', 'FILE_TOO_MANY',
        schedSay('fileTooMany', { max: SCHEDULE.maxEvents }), null, ''));
      raws = raws.slice(0, SCHEDULE.maxEvents);
    }
    if (source && scan.cal.name) source.label = source.label || scan.cal.name;
    if (source) source.producer = scan.cal.prodId || '';
    const events = raws.map((r, i) => schedEventFromICS(r, i + 1, scan.cal.tz || SCHEDULE.tz));
    if (!events.length) {
      problems.push(schedProblem('error', 'NO_EVENTS', schedSay('fileEmpty', {}), null,
        'Check you exported the calendar your classes are on.'));
    }
    return schedAssemble(source, events, problems, schedSay('fileEmpty', {}));
  }

  /** Pasted text -> the shape. One class per non-blank line. */
  function schedParseRows(text, source) {
    const problems = [];
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n')
      .map(s => s.trim()).filter(Boolean);
    const events = lines.slice(0, SCHEDULE.maxEvents).map((l, i) => schedEventFromRow(l, i + 1));
    if (!events.length) {
      problems.push(schedProblem('error', 'NO_EVENTS', schedSay('fileEmpty', {}), null,
        'Type one class per line, e.g. "GOV 312L, WEL 2.224, MWF 1:00pm".'));
      return schedAssemble(source, events, problems, schedSay('fileEmpty', {}));
    }

    // THE FLOOR UNDER THE ROW PARSER, and it is deliberately hard to trip.
    //
    // The markup sniff catches a saved web page. This catches everything else
    // that is not a schedule — a syllabus paragraph, a CSV of grades, a
    // paste that missed. A verdict on the WHOLE file is only allowed when
    // NOT ONE line anywhere carries any evidence of a class: no building
    // candidate, no course number, no time, no day word.
    //
    // ONE SURVIVING ROW REVOKES IT, which is the whole point and is asserted
    // (`mostly-junk.txt`: one real class among five junk lines still imports
    // 1 of 6, per-line). That is the same "one bad row never kills the file"
    // rule this feature is built on, applied to the failure mode this floor
    // itself introduces — a summary verdict that swallows a good class would
    // be a worse bug than the nine wrong sentences it replaced.
    if (lines.length >= SCHEDULE.notScheduleMinLines && !events.some(e => e.hasSignal)) {
      const text = schedSay('fileNotSchedule', { total: lines.length });
      return schedAssemble(source, [], [schedProblem('error', 'FILE_NOT_SCHEDULE', text, null,
        'If you meant to upload a calendar file, look for one ending in .ics.')], text);
    }
    return schedAssemble(source, events, problems, schedSay('fileEmpty', {}));
  }

  /** Is this text an iCalendar payload? Cheap and decisive. */
  function schedLooksLikeICS(text) {
    const head = String(text || '').slice(0, 4096).toUpperCase();
    return head.indexOf('BEGIN:VCALENDAR') >= 0 || head.indexOf('BEGIN:VEVENT') >= 0;
  }

  /**
   * Is this a saved WEB PAGE rather than anything a student meant to hand us?
   *
   * Two tests because the two real shapes differ. A whole saved document opens
   * with a doctype or an `<html>` root and the head test catches it on the
   * first non-blank byte. A page saved or copied as a FRAGMENT has no such
   * opener, so it is convicted on density instead: enough tag-shaped tokens,
   * spread across enough of the lines, that no schedule paste could look like
   * this by accident. Both bars are named constants in SCHEDULE.
   */
  function schedLooksLikeMarkup(text) {
    const s = String(text || '');
    if (SCHED_MARKUP_HEAD_RE.test(s.slice(0, SCHEDULE.markupHeadChars))) return true;
    const lines = s.split(/\r\n?|\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length < SCHEDULE.markupTagsMin) return false;
    let tagged = 0;
    for (const l of lines) if (SCHED_TAG_RE.test(l)) tagged++;
    return tagged >= SCHEDULE.markupTagsMin &&
      tagged >= lines.length * SCHEDULE.markupLineFraction;
  }

  /**
   * WHICH PARSER GETS THIS TEXT — and it is a THREE-way question, not two.
   *
   * It used to be two ("is it ICS? no? then it is rows"), and that is the bug
   * a review found: the fall-through swallowed a saved sign-in page and the
   * row parser dutifully reported one error per line of markup. There was
   * already a correct, crafted sentence for that exact file — it was simply
   * unreachable unless the caller forced `kind:'ics'`, which only the test
   * ever did.
   *
   * Returns 'ics' | 'markup' | 'rows'. ICS is asked first because a calendar
   * file that happens to carry an HTML description is still a calendar file.
   */
  function schedSniff(text) {
    if (schedLooksLikeICS(text)) return 'ics';
    if (schedLooksLikeMarkup(text)) return 'markup';
    return 'rows';
  }

  /** The one thing to say about a file that is not a calendar at all. */
  function schedNotCalendar(source) {
    const text = schedSay('fileNotCalendar', {});
    return schedAssemble(source, [], [schedProblem('error', 'FILE_NOT_CALENDAR', text, null,
      'Look for a file ending in .ics.')], text);
  }

  // ── the public entry points ───────────────────────────────────────────────

  /**
   * wayfindParseSchedule(text, opts) — the file/paste front end.
   *
   * `opts.kind` forces `'ics'` or `'rows'`; left off, the text decides — and
   * the sniff is three-way, so a file that is NEITHER (a saved sign-in page)
   * is named as such instead of being fed to the row parser. Async only
   * because the building vocabulary lives in walk_graph.json and a resolution
   * made before it loads would be wrong about every code.
   *
   * `source.sniffed` always records what the sniff decided, even when
   * `opts.kind` overruled it, so the interface can say "we read this as a
   * paste" without guessing. `source.kind` is 'ics' | 'rows' | 'unknown'.
   */
  window.wayfindParseSchedule = async function (text, opts) {
    opts = opts || {};
    try { await loadGraph(); } catch (e) { /* resolve against UT_CELEBRATED alone */ }
    const sniffed = schedSniff(text);
    const route = opts.kind || sniffed;
    const source = {
      kind: route === 'markup' ? 'unknown' : route,
      sniffed: sniffed,
      label: opts.label || '', url: opts.url || '', producer: '',
      importedAt: new Date().toISOString(),
    };
    if (route === 'markup') return schedNotCalendar(source);
    if (route === 'rows') return schedParseRows(text, source);
    return schedParseICS(text, source);
  };

  /**
   * wayfindFetchSchedule(url) — the subscribe-by-URL front end.
   *
   * `webcal://` is not a protocol a browser can fetch; it is an OS handoff to
   * a calendar app (docs/import-bar-apple.md). The feed behind it is ordinary
   * HTTPS at the same host and path, so the scheme is rewritten and fetched.
   *
   * A REAL GOOGLE OR UT FEED WILL USUALLY FAIL HERE, and saying so plainly is
   * the whole value: those hosts send no `Access-Control-Allow-Origin`, so the
   * browser blocks the read before this code sees a byte. That is a CORS fact
   * about the other end, not a bug at this one, and the student's move is to
   * download the .ics and drop it in — which the error says.
   */
  window.wayfindFetchSchedule = async function (url, opts) {
    opts = opts || {};
    const given = String(url || '').trim();
    const source = {
      kind: 'ics-url', label: opts.label || '', url: given, producer: '',
      importedAt: new Date().toISOString(),
    };
    if (!given) {
      return schedAssemble(source, [], [schedProblem('error', 'URL_MISSING',
        'No calendar address was given.', null, '')], 'No calendar address was given.');
    }
    let target = given;
    const scheme = SCHEDULE.webcalScheme + '://';
    if (/^webcal:\/\//i.test(target)) target = scheme + target.slice(9);
    else if (/^webcals:\/\//i.test(target)) target = scheme + target.slice(10);
    if (!/^https?:\/\//i.test(target)) {
      return schedAssemble(source, [], [schedProblem('error', 'URL_UNSUPPORTED',
        'Calendar addresses start with webcal:// or https://.', null,
        'Copy the "subscribe" link out of your calendar app.')], 'Unsupported address.');
    }
    source.fetched = target;
    let text = '';
    const ctl = (typeof AbortController === 'function') ? new AbortController() : null;
    const timer = setTimeout(() => { try { ctl && ctl.abort(); } catch (e) {} }, SCHEDULE.fetchTimeoutMs);
    try {
      const r = await fetch(target, ctl ? { signal: ctl.signal } : undefined);
      if (!r.ok) {
        clearTimeout(timer);
        return schedAssemble(source, [], [schedProblem('error', 'URL_STATUS',
          'That calendar address answered ' + r.status + '.', null,
          r.status === 401 || r.status === 403
            ? 'A private feed cannot be read from a web page. Download the .ics instead.'
            : 'Check the address and try again.')], 'That address answered ' + r.status + '.');
      }
      text = await r.text();
    } catch (e) {
      clearTimeout(timer);
      const aborted = e && (e.name === 'AbortError');
      return schedAssemble(source, [], [schedProblem('error', aborted ? 'URL_TIMEOUT' : 'URL_BLOCKED',
        aborted
          ? 'That calendar address did not answer within ' + Math.round(SCHEDULE.fetchTimeoutMs / 1000) + ' seconds.'
          : 'The browser would not let this page read that calendar address. Google and UT do not allow other sites to read a feed directly.',
        null, 'Download the .ics from your calendar and drop the file in here instead.')],
      'That calendar could not be read.');
    }
    clearTimeout(timer);
    try { await loadGraph(); } catch (e) {}
    // A feed URL that answers 200 with a LOGIN PAGE is the common way this
    // fails in the wild — the same wrong bytes an upload brings, arriving
    // over the wire. Same sniff, same sentence.
    source.sniffed = schedSniff(text);
    if (source.sniffed !== 'ics') return schedNotCalendar(source);
    return schedParseICS(text, source);
  };

  /**
   * wayfindScheduleFrom(rows, meta) — THE SEAM FOR A SOURCE THAT DOES NOT EXIST
   * YET.
   *
   * An image-OCR pass, or a Registration-Plus API, will not hand this app an
   * .ics; it will hand it rows. So it comes in here, and everything downstream
   * — resolution, the gap statuses, the problem list, the summary line, the
   * shape itself — is shared with the three sources that do exist. Adding one
   * is writing an adapter to this signature, not touching the parser.
   *
   *   rows: [{ title?, course?, location, days?, startMin?, endMin?,
   *            firstDate?, lastDate?, room?, confidence?, raw? }]
   *
   * `location` may be anything a LOCATION field may be: `WEL 2.224`, a name, a
   * folded address. `days` accepts either the ICS vocabulary (`['MO','WE']`) or
   * a UT day word (`'MWF'`). Nothing is trusted: a row from OCR gets exactly
   * the same scrutiny and the same readable failures as a row from Google.
   */
  window.wayfindScheduleFrom = async function (rows, meta) {
    meta = meta || {};
    try { await loadGraph(); } catch (e) {}
    const source = {
      kind: meta.kind || 'rows', label: meta.label || '', url: meta.url || '',
      // Nothing was sniffed — these rows arrived already structured. Recording
      // that keeps `source` one shape across all four ways in.
      sniffed: null,
      producer: meta.producer || '', importedAt: new Date().toISOString(),
    };
    const list = Array.isArray(rows) ? rows.slice(0, SCHEDULE.maxEvents) : [];
    const events = list.map((r, i) => {
      const idx = i + 1;
      const ev = {
        index: idx, id: r.id || ('row-' + idx), title: String(r.title || r.course || '').trim(),
        course: String(r.course || '').trim(), locationText: '',
        code: null, room: String(r.room || ''), days: [], startMin: null, endMin: null,
        firstDate: r.firstDate || null, lastDate: r.lastDate || null, exDates: r.exDates || [],
        tz: r.tz || SCHEDULE.tz, status: 'ok', problems: [], resolved: null,
        confidence: (r.confidence == null ? null : r.confidence),
        raw: r.raw || { line: idx },
      };
      const at = { event: idx, line: idx, field: 'location' };
      if (Array.isArray(r.days)) ev.days = r.days.map(d => String(d).toUpperCase().slice(0, 2))
        .filter(d => SCHED_DAYS.indexOf(d) >= 0);
      else if (r.days) {
        const up = String(r.days).toUpperCase().replace(/[^A-Z]/g, '');
        for (const [w, ds] of SCHEDULE.dayWords) if (up === w) { ev.days = ds.slice(); break; }
      }
      if (r.startMin != null) ev.startMin = +r.startMin;
      if (r.endMin != null) ev.endMin = +r.endMin;
      if (ev.startMin == null && r.start) {
        const t = schedTimesOf(String(r.start));
        ev.startMin = t.times.length ? t.times[0] : null;
      }
      if (ev.endMin == null && r.end) {
        const t = schedTimesOf(String(r.end));
        ev.endMin = t.times.length ? t.times[0] : null;
      }
      const parsed = schedLocation(String(r.location == null ? '' : r.location));
      ev.locationText = parsed.empty ? '' : parsed.text;
      if (!ev.title) ev.title = ev.course || ('row ' + idx);
      const res = schedResolve(parsed);
      ev.resolved = res;
      ev.code = res.code;
      ev.room = ev.room || res.room || parsed.room || '';
      const lp = schedLocProblem(res, ev, at);
      if (lp) { ev.problems.push(lp); if (lp.level === 'error') ev.status = 'failed'; }
      return ev;
    });
    return schedAssemble(source, events, [], schedSay('fileEmpty', {}));
  };

  /**
   * wayfindScheduleCheck(schedule) — the only honest routability test.
   *
   * `entry.routable` from buildIndex() reads the graph's own door list, and HLB
   * proves that is not the same question: it reports false and routes anyway,
   * off a virtual door computeRoute() invents from the UT survey. So this
   * ROUTES — every consecutive same-day pair in the schedule, headless, through
   * the same code path the card uses, and writes the answer back onto the
   * events.
   *
   * It does not draw anything and does not touch the interface.
   */
  window.wayfindScheduleCheck = async function (schedule, opts) {
    opts = opts || {};
    if (!schedule || !Array.isArray(schedule.events)) return schedule;
    await loadGraph();
    const usable = schedule.events.filter(e => e.status === 'ok' && e.code);
    const seen = new Map();
    for (const e of usable) {
      if (seen.has(e.code)) { e.resolved.routable = seen.get(e.code); continue; }
      let ok = false;
      try {
        const r = await window.wayfindStairs(e.code, e.code === 'PCL' ? 'MAI' : 'PCL',
          { avoidStairs: !!opts.avoidStairs });
        ok = !!(r && r.ok);
      } catch (err) { ok = false; }
      seen.set(e.code, ok);
      e.resolved.routable = ok;
      if (!ok) {
        e.status = 'failed';
        e.problems.push(schedProblem('error', 'BUILDING_NOT_WALKABLE',
          schedSay('buildingUnmapped', { n: e.index, title: e.title || 'untitled', code: e.code }),
          { event: e.index, line: e.raw && e.raw.line, field: 'LOCATION' },
          'The code is known but no walking route reaches it.'));
        schedule.problems.push(e.problems[e.problems.length - 1]);
      }
    }
    // The legs a student actually walks: consecutive classes on the same day.
    const legs = [];
    for (const day of SCHED_DAYS) {
      const onDay = schedule.events
        .filter(e => e.status === 'ok' && e.code && e.days.indexOf(day) >= 0)
        .sort((a, b) => (a.startMin == null ? 1e9 : a.startMin) - (b.startMin == null ? 1e9 : b.startMin));
      for (let i = 0; i + 1 < onDay.length; i++) {
        const a = onDay[i], b = onDay[i + 1];
        if (a.code === b.code) continue;
        legs.push({
          day: day, from: a.code, to: b.code, fromIndex: a.index, toIndex: b.index,
          fromTitle: a.title, toTitle: b.title,
          gapMin: (b.startMin != null && a.endMin != null) ? (b.startMin - a.endMin) : null,
          ok: false, distM: null, lo: null, hi: null, why: null,
        });
      }
    }
    for (const leg of legs) {
      try {
        const r = await window.wayfindStairs(leg.from, leg.to, { avoidStairs: !!opts.avoidStairs });
        if (r && r.ok) {
          leg.ok = true;
          leg.distM = r.distM != null ? r.distM : null;
        } else {
          leg.why = (r && r.why) || 'noroute';
        }
      } catch (err) { leg.why = 'threw'; }
      if (!leg.ok) {
        schedule.problems.push(schedProblem('error', 'LEG_NO_ROUTE',
          schedSay('noRoute', { fromCode: leg.from, toCode: leg.to }),
          { event: leg.toIndex, line: null, field: '' }, ''));
      }
    }
    schedule.legs = legs;
    schedule.counts.legs = legs.length;
    schedule.counts.legsOk = legs.filter(l => l.ok).length;
    return schedule;
  };

  /** The vocabulary, for a test or for the interface's own type-ahead. */
  window.wayfindScheduleCodes = async function () {
    try { await loadGraph(); } catch (e) {}
    const out = [];
    for (const [c, rec] of schedCodes()) out.push({ code: c, name: rec.name, where: rec.where });
    out.sort((a, b) => a.code.localeCompare(b.code));
    return out;
  };

  // ══════════════════════════════════════════════════════════════════════════
  // 9. THE SCHEDULE IMPORT — THE SCREEN A STUDENT ADDS THEIR CLASSES ON
  // ══════════════════════════════════════════════════════════════════════════
  //
  // WHAT THIS IS. The router already speaks UT building codes: `MAI`, `WEL`,
  // `JES` are the app's native vocabulary (UT_ENTRANCES, §6). A class schedule
  // is a list of times and a list of those same codes. So the import's whole
  // job is one function — turn "MAI 220, TTh 2:00pm" into `MAI` — and the three
  // routes Simeon asked for (Google Calendar, Apple Calendar, UT registration)
  // are three ways of getting the bytes to that function, not three features.
  //
  // ── THE SHAPE, AND WHY IMAGE-OCR AND REGISTRATION-PLUS ARE A ROW EACH ──────
  // Everything below is a two-stage pipe with ONE joint:
  //
  //     bytes ──[ decoder ]──> RAW ROWS ──[ impPlace ]──> classes + rejects
  //
  // A DECODER is per-format and knows nothing about UT. `impDecodeICS` handles
  // Google's export, Apple's `.ics` and any webcal feed, because all three end
  // up as the identical VEVENT payload (docs/import-bar-apple.md proved that
  // for Apple's two paths; docs/import-bar-ut.md proved UT Registration Plus
  // emits the same). `impDecodeUTText` handles a block of rows pasted straight
  // off UT Direct.
  //
  // A RAW ROW is `{ title, location, days, start, end, raw }` and nothing else.
  // It is the only thing the two halves agree on.
  //
  // `impPlace` is per-CAMPUS and knows nothing about calendars. It splits the
  // location on its first space, uppercases the head, and asks the router.
  //
  // So adding image-OCR later is adding `impDecodeImage(pixels) -> RAW ROWS`
  // and one row to IMP_SOURCES. Adding a Registration-Plus API is adding
  // `impDecodeRegPlus(json) -> RAW ROWS` and one row to IMP_SOURCES. Neither
  // touches the placement, the failure taxonomy, or one line of this screen.
  // That is the whole reason the joint is where it is. NOT BUILT NOW, on
  // purpose — Simeon said "not in this pass".
  //
  // ── AND THE PARSER IS A SEAM, NOT A DEPENDENCY ────────────────────────────
  // A sibling lane owns the parser proper. If it lands, it publishes
  // `window.wayfindParseSchedule(text, opts) -> RAW ROWS` and this screen uses
  // it (impRawRows checks for it first). Until then the reference decoders
  // below run, so the screen is real and photographable today rather than a
  // mockup waiting on someone else. Neither side has to change when the swap
  // happens: RAW ROWS is the contract.
  //
  // ── WHAT FAILED AND WHY IS HALF THE FEATURE, AND IT WAS MEASURED ──────────
  // A real schedule names a real building and some of those buildings this
  // router cannot reach. RE-VERIFIED 2026-08-24 against the live page rather
  // than taken from the brief (docs/si-ui.md): **12** codes in the app's own
  // tables have no walkable door, not the 11 the brief carried — HLB, the Dell
  // Med Health Learning Building, is a twelfth and it is NOT off-map. Ten are
  // genuinely 11 km north at the Pickle Research Campus. SSW is a real,
  // registered main-campus building that this app simply cannot walk to yet.
  // Those are three different sentences and the screen says three different
  // sentences, because "couldn't import" for a building that exists 400 m away
  // is the "wrong building, beautifully drawn" failure with the lights off.
  // ══════════════════════════════════════════════════════════════════════════

  // TASTE BLOCK for the import screen — CLAUDE.md rule 11. Nothing below
  // invents a number or a word; it is all here.
  const IMP = {
    // The button that opens it, in the walk sheet under the examples. It is a
    // ROW, not a chip beside `Try WEL PCL GDC JES`: those four fill a field,
    // this one opens a different screen, and a control that changes screens
    // sitting in a row of controls that fill a field is how you get tapped by
    // accident on a phone.
    entryOn: true,
    // Which acquisition front-end opens first. Google is the biggest calendar
    // on a student phone; it is not a judgement about which is best.
    defaultSource: 'gcal',
    // The CEILING on how many placed classes the result list shows before
    // `Show N more`. It is a ceiling and no longer the whole rule: how many
    // actually show is measured against the panel this phone gave us (see
    // `impFitList`), because a fixed number cannot be right on both a result
    // with three failures above it and a result with none.
    resultPeek: 6,
    // ...and the floor under that measurement. ZERO, deliberately: when the
    // failures have eaten the whole panel, `PLACED 6` over a `Show 6 more`
    // button is a complete, honest screen, and one placed row over a button
    // nobody can see is not. A visible control beats a visible sample.
    minPeek: 0,
    // A schedule is one term. Anything past this in one paste is somebody's
    // whole calendar, not their classes, and importing 400 events silently is
    // worse than saying no.
    maxEvents: 200,
    // The timezone a row carries when the FALLBACK decoder made it. The parser
    // reads the real one off the file; a block pasted off UT Direct carries
    // none, and UT is Central.
    tz: 'America/Chicago',
    // A pasted URL is fetched by the browser, which is subject to the calendar
    // host's CORS policy — Google's and Apple's both refuse. That is not a bug
    // to hide; it is the commonest way this screen fails and it has its own
    // sentence and its own way out (choose the file instead).
    fetchTimeoutMs: 12000,
    // The two-letter ICS day codes, in the order a week is read. Sunday last,
    // because a class schedule is a working week.
    dayOrder: ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'],
    // How each day is printed on a result row. UT prints TTh; ICS says TU,TH.
    dayShort: { MO: 'M', TU: 'T', WE: 'W', TH: 'Th', FR: 'F', SA: 'Sa', SU: 'Su' },
    // HOW FAR THE BODY HAS TO BE OFF AN END BEFORE THAT END IS CALLED CUT.
    // Not zero: a scroller sitting on 0.5 px of subpixel rounding is not
    // scrolled, and a shade that flickers on and off under a thumb is worse
    // than no shade. 6 px is under one line of the smallest type on this
    // screen (--wf-imp-row2, 10.5px), so nothing readable can hide inside it.
    edgeSlopPx: 6,
  };

  // THE THREE ROUTES. A row here is one acquisition front-end. `accepts` is the
  // controls the panel draws for it, in order — so adding OCR later is
  // `{ id:'ocr', accepts:['image'] }` and a decoder, and this file's layout
  // code does not change.
  const IMP_SOURCES = [
    {
      id: 'gcal', tab: 'Google', label: 'Google Calendar',
      // What the STORE calls this source. Two vocabularies existed for the
      // same three sources — this screen's short tab ids and
      // SCHEDULE_SOURCES's long ones — and the privacy panel reads the long
      // one, so a saved schedule said "from an import" instead of naming it.
      storeKind: 'google-ics',
      accepts: ['file', 'url'],
      // Read off Google Calendar's own export flow. The .zip is the part every
      // guide forgets and the part that produces a real, confusing failure.
      steps: [
        'In Google Calendar on a computer: Settings → Import & export → Export.',
        'Google hands you a .zip. Unzip it — the .ics files are inside.',
      ],
      fileLabel: 'Choose the .ics file',
      urlLabel: 'or paste the secret address in iCal format',
      urlHint: 'Settings → your calendar → Integrate calendar → Secret address in iCal format.',
      urlPlaceholder: 'https://calendar.google.com/calendar/ical/…/basic.ics',
    },
    {
      id: 'apple', tab: 'Apple', label: 'Apple Calendar',
      storeKind: 'apple-ics',
      // URL FIRST FOR APPLE, and that is not a coin toss. Apple's own flow is
      // a SUBSCRIPTION: `webcal://` is a URI scheme the OS registers, so the
      // address is the thing a student already has in their hand.
      // docs/import-bar-apple.md, quoting Apple's own guide.
      accepts: ['url', 'file'],
      steps: [
        'Mac: Calendar → File → New Calendar Subscription. iPhone: Calendars → Add Calendar → Add Subscription Calendar.',
        'Copy the webcal:// address you subscribed with. (File → Export → Export… gives an .ics instead.)',
      ],
      fileLabel: 'or choose an exported .ics',
      urlLabel: 'The subscription address',
      urlHint: 'webcal:// and https:// are the same feed — either works here.',
      urlPlaceholder: 'webcal://p00-calendars.icloud.com/published/…',
    },
    {
      id: 'ut', tab: 'UT', label: 'UT registration',
      storeKind: 'ut-registration',
      // TEXT FIRST FOR UT, AND THE REASON IS RESEARCH, NOT PREFERENCE. There
      // is no confirmed first-party UT .ics or webcal feed for a personal
      // class schedule — docs/import-bar-ut.md looked and found none, and the
      // existence of a 50,000-user third-party extension that exists solely to
      // produce one is the evidence. So the honest control is a paste box.
      accepts: ['text', 'file'],
      steps: [
        'Open your class schedule on UT Direct and select the rows.',
        'Paste them below. One class per line, however they come out.',
      ],
      textLabel: 'Paste your schedule',
      // A PLACEHOLDER IS AN EXAMPLE, SO IT HAS TO BE ONE THAT WORKS. The first
      // one ended `RLM 5.104` — a code this app cannot route, because RLM was
      // renamed PMA — so the one line on the screen teaching the format would
      // have failed if a student had typed it back.
      textPlaceholder: 'M 408C  DIFFERENTIAL CALCULUS   MWF 10:00 am-11:00 am   PMA 5.104',
      fileLabel: 'or choose an .ics you exported',
    },
    // LATER, WITHOUT A REWRITE — see the header. A photo of a printed schedule
    // is `{ id:'ocr', accepts:['image'] }` plus `impDecodeImage`. Registration
    // Plus is `{ id:'regplus', accepts:['api'] }` plus `impDecodeRegPlus`.
    // Both feed RAW ROWS into the same impPlace and render on the same screen.
  ];

  // THE CODES THIS ROUTER CANNOT REACH, AND WHICH KIND OF UNREACHABLE EACH IS.
  //
  // ── SI5: THIS USED TO BE A TABLE, AND A TABLE IS HOW ONE APP GETS TWO
  //    ANSWERS ABOUT ONE BUILDING ─────────────────────────────────────────
  //
  // It was twelve rows, and every one of them was measured honestly against
  // the live `wayfindSearch` on the day it was written (`docs/si-ui.md` records
  // that run). The problem was never the measurement. It was that a measurement
  // written down stops being a measurement: `si-gaps` then gave SSW its
  // register entry and HLB its virtual door, both of them route now with 2 and
  // 1 doors, and this screen went on refusing them — because the answer had
  // been remembered instead of asked for. `wayfindSearch('SSW')` said routable
  // and the import screen said "no door", two taps apart, in the same app.
  //
  // So it asks. The two kinds of unreachable still are not distinguishable from
  // a single question — a code with no doors looks identical whether it is
  // 11 km away or across the street, and the whole point of this screen is that
  // the student is told which — so the screen asks two:
  //
  //   `window.wayfindOffMap(code)`  a real UT building at a campus this app
  //                                 does not draw. Returns the record or null,
  //                                 and the record carries the building's own
  //                                 name, its campus, and how far and which way
  //                                 it is — all derived from UT's own survey.
  //   `window.wayfindSearch(code)`  everything on this map, routable or not.
  //
  // Neither can go stale, because neither is a copy: they ARE the router. The
  // ten Pickle codes come back from the first, and nothing else does.
  //
  // THE NAME IS NOT DECORATION, and it now comes from the same place as the
  // distance. A student reading `MER 1.906 — Pickle Research Campus` has to
  // take our word for it; `MER 1.906 · Microelectronics & Engineering Research
  // Center — J.J. Pickle Research Campus` they can check against their own
  // registration page.
  const IMP_PLACES = {
    // Built from the record `wayfindOffMap()` hands back, so the distance this
    // screen prints and the distance the day view prints are one fact from one
    // source instead of two strings that agree until one of them is edited.
    // WHOLE KILOMETRES: the record carries two decimals, and a reader eleven
    // kilometres from a building they cannot see on the map does not need them.
    offmap: (rec) => ({
      name: rec.campus || null,
      why: 'about ' + Math.round(Number(rec.km) || 0) + ' km ' +
        (rec.direction || 'away') + ' of here, outside the city this app models',
    }),
    nodoor: {
      name: null,
      why: 'on campus, but the walking network has no door for it yet',
    },
  };

  // EVERY SENTENCE THIS SCREEN CAN SAY. Same rule as SAY and SAY_UI: wording
  // is data, so it can be read, argued with and changed without touching a
  // render function.
  const SAY_IMP = {
    entry: 'Import your class schedule',
    entryNote: 'Google, Apple or UT — read on this phone, never uploaded',
    title: 'Add your schedule',
    resultTitle: 'What imported',
    failTitle: 'Nothing imported',
    importBtn: 'Import',
    working: 'Reading…',
    back: 'Back',
    chooseFile: 'Choose a file',
    // THE PRIVACY LINE IS A FACT, NOT A REASSURANCE. There is no server in
    // this app; a file picked here is read by FileReader in the tab and is
    // gone when the tab is. Saying so is the difference between a student
    // pasting their schedule and closing the panel.
    privacy: 'Read on your device. This app has no server to send it to.',
    placed: (n, total) => n + ' of ' + total + (total === 1 ? ' class placed' : ' classes placed'),
    placedAll: (n) => 'All ' + n + (n === 1 ? ' class' : ' classes') + ' placed',
    fromSource: (label) => 'from ' + label,
    couldNot: (n) => "Couldn't place " + n,
    placedSec: (n) => 'Placed ' + n,
    // A COUNT THE STUDENT CANNOT CHECK IS NOT A COUNT. This used to be a plain
    // line of text: `Use these 9` on the button, six rows on screen, `+ 3 more`
    // under them, and no way — scroll, tap or otherwise — to find out which
    // three. The screen was naming buildings it would then route them to and
    // refusing to say which buildings. It is a button now, and it says what
    // pressing it does rather than restating the arithmetic above it.
    andMore: (n) => 'Show ' + n + ' more',
    useThese: (n) => 'Use ' + (n === 1 ? 'this class' : 'these ' + n),
    noneUsable: 'Nothing here can be routed to',
    // The failure taxonomy, one sentence each. Every one of them names the
    // thing that went wrong instead of the thing we wanted.
    whyOffmap: (name, place) => (name ? name + ' — ' : '') +
      place.name + ', ' + place.why + '.',
    whyNodoor: (name) => (name ? name + ' — ' : '') +
      'we know where it is; the walking network has no door for it yet.',
    whyUnknown: (code) => code + " isn't a UT building code this app knows.",
    // TWO SENTENCES FOR ONE STATUS, because the student did two different
    // things. A calendar export that omitted LOCATION is not their doing and
    // the sentence says so; a pasted line with no room in it is a line they
    // can look at and fix, and telling them "the export" would send them
    // hunting through Google for a setting that was never involved.
    whyNoLocation: 'No room on this event — the export carried no location.',
    whyNoLocationText: 'No room on this line — nothing in it named a building.',
    // The ways the whole import can fail before a single row is read.
    errNoEvents: 'That file had no calendar events in it.',
    errNoClasses: 'That calendar had events, but none of them named a room.',
    errNoClassesText: 'None of those lines named a building and a room, so there is nothing to place.',
    errZip: 'That is a .zip. Google exports one — unzip it and choose the .ics inside.',
    errNotICS: "That file isn't a calendar. An .ics starts with BEGIN:VCALENDAR.",
    errEmptyText: 'Paste your schedule rows first.',
    errEmptyUrl: 'Paste the calendar address first.',
    errBadUrl: "That doesn't look like a web address.",
    // ONE SENTENCE FOR TWO CAUSES, BECAUSE THE BROWSER GIVES US ONE ERROR.
    // A cross-origin refusal and a dead network are the SAME `TypeError` here
    // by design — the spec hides which, so a page cannot probe another site.
    // Claiming "blocked" when it might be "offline" would be a guess, so the
    // sentence names only what is certain (we could not read it, from there)
    // and spends its length on the way round, which is a control already on
    // this screen.
    errBlocked: (host) => "Couldn't read a calendar from " + host + '. A browser ' +
      "won't let this page fetch another site's calendar. Download the .ics and " +
      'choose the file instead.',
    errHttp: (code) => 'That address answered ' + code + ', not a calendar.',
    errTimeout: 'That address took too long to answer.',
    errTooMany: (n) => 'That is ' + n + ' events — a whole calendar, not one term. ' +
      'Export just your class calendar.',
    unnamed: 'Untitled class',
    noRoom: '(no room)',
    // The payoff. Two consecutive classes go into the two ends of the router
    // that already exists, which is the whole reason a schedule is worth
    // importing into THIS app rather than into a calendar.
    handoffTwo: (a, b) => 'Routed ' + a + ' → ' + b,
    handoffOne: 'Put in the To field',
  };

  // THIS SCREEN'S OWN GLYPHS. A separate table from `IC` on purpose: `IC` is
  // the walk bar's and four other lanes are editing that region of this file
  // this round. Same drawn-path rule as IC — no font glyphs, because `✓` and
  // `⚠` render at a different size and weight on Android than on this laptop.
  const IC_IMP = {
    // A file going up into a tray.
    upload: 'M12 15.5V4.3M12 4.3 7.8 8.6M12 4.3l4.2 4.3M4.5 15.2v3.3a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-3.3',
    check: 'M4.8 12.4 9.6 17.2 19.2 6.8',
    warn: 'M12 3.6 21.2 19.4H2.8zM12 9.6v4.6M12 17.1v.01',
    // A month grid with its two hangers — a calendar, not a clock.
    cal: 'M4.2 6.6h15.6v13.2H4.2zM4.2 10.6h15.6M8.6 4v3.4M15.4 4v3.4',
    chevR: 'M9.5 5.5 15.5 12 9.5 18.5',
  };

  // ── decoders: bytes of one format -> RAW ROWS ─────────────────────────────

  /** ICS line unfolding. A continuation line starts with a space or a tab. */
  function impUnfold(text) {
    return String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
      .replace(/\n[ \t]/g, '');
  }
  function impUnescape(v) {
    return String(v).replace(/\\n/gi, ' ').replace(/\\,/g, ',')
      .replace(/\\;/g, ';').replace(/\\\\/g, '\\').trim();
  }
  /** `DTSTART;TZID=America/Chicago:20250825T160000` -> { day:'MO', hm:'16:00' } */
  function impStamp(val) {
    const m = /(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/.exec(val || '');
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const dow = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][d.getDay()];
    return { day: dow, hm: m[4] ? m[4] + ':' + m[5] : null };
  }

  /**
   * Google's export, Apple's export, Apple's webcal feed and UT Registration
   * Plus's output are all this. One decoder, four sources — which is exactly
   * the claim docs/import-bar-apple.md's last section makes.
   */
  function impDecodeICS(text) {
    const src = impUnfold(text);
    const rows = [];
    const blocks = src.split(/BEGIN:VEVENT/i).slice(1);
    for (const b of blocks) {
      const body = b.split(/END:VEVENT/i)[0];
      const get = (name) => {
        const re = new RegExp('^' + name + '(?:;[^:\\n]*)?:(.*)$', 'im');
        const m = re.exec(body);
        return m ? m[1] : '';
      };
      const start = impStamp(get('DTSTART'));
      const end = impStamp(get('DTEND'));
      const rrule = get('RRULE');
      let days = [];
      const by = /BYDAY=([A-Z,+\-0-9]+)/i.exec(rrule);
      if (by) days = by[1].split(',').map(s => s.replace(/[^A-Z]/gi, '').toUpperCase()).filter(Boolean);
      else if (start) days = [start.day];
      rows.push({
        title: impUnescape(get('SUMMARY')),
        location: impUnescape(get('LOCATION')),
        days: days,
        start: start ? start.hm : null,
        end: end ? end.hm : null,
        raw: impUnescape(get('LOCATION')) || impUnescape(get('SUMMARY')),
      });
    }
    return rows;
  }

  /** `MWF` / `TTh` / `TTH` -> ['MO','WE','FR'] / ['TU','TH']. TH is greedy. */
  function impDays(tok) {
    const s = String(tok || '').toUpperCase();
    const out = [];
    for (let i = 0; i < s.length; i++) {
      if (s[i] === 'T' && s[i + 1] === 'H') { out.push('TH'); i++; continue; }
      if (s[i] === 'S' && s[i + 1] === 'U') { out.push('SU'); i++; continue; }
      if (s[i] === 'M') out.push('MO');
      else if (s[i] === 'T') out.push('TU');
      else if (s[i] === 'W') out.push('WE');
      else if (s[i] === 'F') out.push('FR');
      else if (s[i] === 'S') out.push('SA');
    }
    return out;
  }
  function impTo24(h, m, ap) {
    let hh = Number(h);
    if (/p/i.test(ap) && hh !== 12) hh += 12;
    if (/a/i.test(ap) && hh === 12) hh = 0;
    return String(hh).padStart(2, '0') + ':' + m;
  }

  /**
   * A block of rows copied off UT Direct. Deliberately forgiving about
   * everything except the ONE thing UT's own glossary guarantees: the room is
   * a three-letter building code, a space, then a room number
   * (registrar.utexas.edu/schedules/…/using — see docs/import-bar-ut.md).
   * A line where that pattern is absent is not silently dropped; it comes back
   * as a reject with the line printed, so the student can see what we could
   * not read.
   */
  function impDecodeUTText(text) {
    const rows = [];
    for (const lineRaw of String(text).split('\n')) {
      const line = lineRaw.trim();
      if (!line) continue;
      // A LINE IS READ BY SUBTRACTION, NOT BY POSITION. UT's own row is
      // `course · title · unique · days · hours · room · instructor`, but a
      // student's copy-paste reflows it, drops columns and re-orders them. So
      // each field that IS unambiguous is found and then BLANKED OUT of a
      // working copy, and the next field is looked for in what is left.
      //
      // THIS IS NOT TIDINESS, IT IS THE BUG THAT WAS ACTUALLY THERE. Reading
      // the location off the raw line matched `MW 3` in
      // `RHE 306 … 42655  MW 3:00 pm-4:00 pm` — two capitals, a space, a digit,
      // which is a UT room's exact shape — so a class with NO room at all was
      // reported as a class in a building called MW. A wrong building silently
      // invented out of a day abbreviation is the one failure this feature is
      // not allowed to have, and no amount of care in the regex fixes it while
      // the day token is still on the line.
      let rest = line;
      const blank = (at, len) => {
        rest = rest.slice(0, at) + ' '.repeat(len) + rest.slice(at + len);
      };
      // 1. TIMES. The least ambiguous token on the line: nothing else on a
      //    class row carries a colon between two digits.
      const t = /(\d{1,2}):(\d{2})\s*([ap])\.?\s*m\.?\s*(?:[-–—]|to)\s*(\d{1,2}):(\d{2})\s*([ap])\.?\s*m\.?/i.exec(rest)
        || /(\d{1,2}):(\d{2})()\s*[-–—]\s*(\d{1,2}):(\d{2})()/.exec(rest);
      const start = t ? impTo24(t[1], t[2], t[3] || t[6] || '') : null;
      const end = t ? impTo24(t[4], t[5], t[6] || '') : null;
      const cut = t ? t.index : rest.length;
      if (t) blank(t.index, t[0].length);
      // 2. DAYS. A standalone token of day letters, before where the time was.
      //    Anchored to the time because `M 408C` is a FIELD OF STUDY that
      //    happens to be spelled like a Monday.
      let days = [];
      const dm = /(?:^|\s)(TTH|TTh|MWF|MW|TT|WF|MF|TH|M|T|W|F|S|SU)(?=\s|$)/g;
      let dHit = null, dPick = null;
      while ((dHit = dm.exec(rest))) {
        if (dHit.index + dHit[0].length > cut) break;
        dPick = dHit;
      }
      if (dPick) {
        days = impDays(dPick[1]);
        blank(dPick.index + dPick[0].length - dPick[1].length, dPick[1].length);
      }
      // 3. THE ROOM, in what is left — AND ONLY AFTER THE DAYS AND THE HOUR.
      //
      //    A COURSE NUMBER AND A ROOM ARE THE SAME SHAPE. `RHE 306` is a
      //    course; `PAR 201` is a room; nothing about the characters tells
      //    them apart, which docs/import-bar-ut.md flagged as "a real parser
      //    trap" before a line of this was written. Photographed: a class with
      //    NO room, `RHE 306  RHETORIC AND WRITING  42655  MW 3:00 pm-4:00 pm`,
      //    came back as a class in a building called RHE.
      //
      //    What separates them is not shape, it is COLUMN ORDER, which UT's
      //    own listing fixes: course, title, unique, days, hour, ROOM. So the
      //    room is only looked for after where the days and the hour were. On
      //    a line with neither, the last match anywhere is taken — that is a
      //    bare `MAI 220` typed by hand, which has no columns to be after.
      //
      //    The cost of the rule is a line whose paste reflowed the room in
      //    front of the time: it comes back as "no room", which the student
      //    SEES and can fix. The cost of not having it is a confident route to
      //    a building nobody has a class in. Those are not the same mistake.
      const minAt = dPick ? dPick.index + dPick[0].length
        : (t ? t.index + t[0].length : 0);
      const lm = /\b([A-Z]{2,4})\s+([0-9][A-Za-z0-9.\-]*)\b/g;
      let hit = null, loc = null, locAt = rest.length;
      while ((hit = lm.exec(rest))) {
        if (hit.index < minAt) continue;
        loc = hit[1] + ' ' + hit[2]; locAt = hit.index;
      }
      if (loc) blank(locAt, loc.length);
      // 4. THE TITLE is whatever is in front of the first thing we recognised,
      //    less the five-digit unique number, which is not a name.
      const headEnd = Math.min(dPick ? dPick.index : Infinity, cut, locAt);
      const title = rest.slice(0, headEnd === Infinity ? rest.length : headEnd)
        .replace(/\b\d{5}\b/g, ' ').replace(/\s+/g, ' ').trim();
      rows.push({ title: title, location: loc || '', days: days, start: start, end: end, raw: line });
    }
    return rows;
  }

  /**
   * THE JOINT — AND THE ONE SHAPE THAT CROSSES IT.
   *
   * Everything above produces RAW ROWS; everything below consumes them. The
   * producer is the PARSER; the decoders above are the FALLBACK for when it
   * throws, which is the opposite of how this ran until now.
   *
   * IT IS ASYNC BECAUSE THE PARSER IS. `wayfindParseSchedule` is declared
   * `async` — it awaits the building vocabulary before resolving a code — so a
   * caller that does not `await` holds a Promise, and `Array.isArray(promise)`
   * is false every time. That one missing keyword silently ran the fallback
   * decoders on every import in the app: measured on the parser's own
   * manual-paste fixture, 2 of 7 classes placed where the parser places 5.
   *
   * WHY THE PARSER'S OBJECT IS THE SHAPE THAT CROSSES THE SEAM. It is the only
   * producer carrying `startMin`/`endMin` as NUMBERS and a per-row
   * `problems[]`, and those are exactly what everything downstream needs: the
   * day view orders a day by minutes, and the store's `normaliseSchedule`
   * discards any `startMin` that is not finite. So the parser's `events[]` are
   * adapted DOWN to the row shape `impPlace()` already reads — which leaves
   * this screen's placement rules and its taxonomy of failures exactly where
   * they were — and the events themselves travel on, untouched, inside the
   * result object. docs/si-seams.md is the argument in full.
   */
  async function impRawRows(text, sourceId) {
    if (typeof window.wayfindParseSchedule === 'function') {
      try {
        const s = impSource(sourceId);
        // The label is a HINT, not an override: schedParseICS prefers the
        // file's own PRODID and calendar name, and this is only what the day
        // view's footer falls back to when the file said nothing about itself.
        const parsed = await window.wayfindParseSchedule(text, { label: s ? s.label : '' });
        if (parsed && Array.isArray(parsed.events) && parsed.events.length) {
          return { rows: parsed.events.map(impRowFromEvent), events: parsed.events,
            parsed: parsed, decoder: 'parser' };
        }
        // A future producer bound to this name may hand back plain rows. Kept,
        // so the seam is a shape contract and not a function identity.
        if (Array.isArray(parsed) && parsed.length) {
          return { rows: parsed, events: null, parsed: null, decoder: 'parser' };
        }
      } catch (e) { /* fall through to the reference decoders */ }
    }
    const rows = (/BEGIN:VCALENDAR/i.test(text) || /BEGIN:VEVENT/i.test(text))
      ? impDecodeICS(text) : impDecodeUTText(text);
    return { rows: rows, events: null, parsed: null, decoder: 'fallback' };
  }

  /** `14:00` -> 840, and back. The row shape this screen reads speaks clock
   *  strings; every surface downstream of it speaks minutes. */
  function impMinOf(hm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hm == null ? '' : hm).trim());
    if (!m) return null;
    const v = (+m[1]) * 60 + (+m[2]);
    return (v >= 0 && v < 1440) ? v : null;
  }
  function impHmOf(min) {
    const v = Number(min);
    if (!isFinite(v) || v < 0) return null;
    return String(Math.floor(v / 60)).padStart(2, '0') + ':' +
      String(Math.round(v % 60)).padStart(2, '0');
  }

  /**
   * ONE PARSER EVENT -> ONE RAW ROW.
   *
   * The parser has already done the hard half — unfolded the file, found the
   * LOCATION and resolved it against the same building vocabulary this app
   * routes on — so its `code`/`room` are preferred over its raw
   * `locationText`. That preference is the whole gain: `Jester Center` is a
   * NAME, not a code, and the fallback decoder can only ever drop it, while
   * the parser resolves it and hands this screen `JES`.
   */
  function impRowFromEvent(e) {
    const ev = e || {};
    const loc = ev.code ? (ev.room ? ev.code + ' ' + ev.room : ev.code)
      : String(ev.locationText || '');
    return {
      title: ev.title || ev.course || '',
      course: ev.course || '',
      location: loc,
      days: Array.isArray(ev.days) ? ev.days.slice() : [],
      start: ev.startMin == null ? null : impHmOf(ev.startMin),
      end: ev.endMin == null ? null : impHmOf(ev.endMin),
      startMin: ev.startMin == null ? null : Number(ev.startMin),
      endMin: ev.endMin == null ? null : Number(ev.endMin),
      firstDate: ev.firstDate || null,
      unique: ev.unique || null,
      // What the file actually said, kept verbatim, because a reject row
      // prints it and "we could not read THIS" is the only useful failure.
      raw: String(ev.locationText || loc || ev.title || ''),
    };
  }

  /**
   * ...AND THE OTHER DIRECTION, for the fallback decoders ONLY. When the parser
   * threw, the surfaces downstream still need events, and inventing them from
   * the rows this screen actually placed is the only way the two views cannot
   * end up telling a student different things.
   */
  function impEventFromPlaced(p, row, idx) {
    const r = row || {};
    return {
      index: idx, id: 'row-' + idx,
      title: r.title || '', course: r.course || '',
      locationText: r.location || '',
      code: p.code || null, room: p.room || '',
      days: (p.days || []).slice(),
      startMin: p.startMin, endMin: p.endMin,
      firstDate: r.firstDate || null, lastDate: null, exDates: [],
      tz: IMP.tz, status: p.status === 'ok' ? 'ok' : 'failed',
      problems: [], confidence: 1, unique: r.unique || null,
    };
  }

  // ── placement: a RAW ROW -> a placed class, or a reject with a reason ─────

  /**
   * `MAI 220` -> `MAI`. One split on the first space, per UT's own glossary,
   * which is what makes this a line of code rather than a regex minefield.
   */
  function impCodeOf(location) {
    const s = String(location || '').trim();
    if (!s) return { code: null, room: '' };
    const parts = s.split(/\s+/);
    const head = parts[0].toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!/^[A-Z][A-Z0-9]{1,3}$/.test(head)) return { code: null, room: s };
    return { code: head, room: parts.slice(1).join(' ') };
  }

  function impPlace(row) {
    const { code, room } = impCodeOf(row.location);
    const base = {
      title: row.title || SAY_IMP.unnamed, room: room, code: code,
      days: row.days || [], start: row.start || null, end: row.end || null,
      // MINUTES TRAVEL WITH THE ROW, rather than being re-derived downstream.
      // `normaliseSchedule` discards any `startMin` that is not finite, so a
      // class saved without these loses its time for good — which is what a
      // reload did to every class before anything called `store.save()`.
      startMin: row.startMin == null ? impMinOf(row.start) : Number(row.startMin),
      endMin: row.endMin == null ? impMinOf(row.end) : Number(row.endMin),
      raw: row.raw || row.location || row.title || '',
    };
    if (!code) return Object.assign(base, { status: 'nolocation', name: null });
    // ── ASK THE ROUTER; DO NOT REPEAT WHAT IT SAID LAST WEEK (SI5) ─────────
    // Off the map is asked FIRST because it is the narrower question and the
    // only one with an unambiguous answer: `wayfindOffMap` returns a record or
    // null, and a code it does not know is by definition somewhere on this map,
    // which is exactly what the next question is for.
    let off = null;
    try { off = window.wayfindOffMap ? window.wayfindOffMap(code) : null; } catch (e) { off = null; }
    if (off) {
      return Object.assign(base, {
        status: 'offmap', place: IMP_PLACES.offmap(off), name: off.name || null,
      });
    }
    let hit = null;
    try {
      const r = window.wayfindSearch ? window.wayfindSearch(code) : [];
      hit = r.find(x => x.code === code) || null;
    } catch (e) { hit = null; }
    if (!hit) return Object.assign(base, { status: 'unknown', name: null });
    if (!hit.routable) {
      return Object.assign(base, { status: 'nodoor', name: hit.name, place: IMP_PLACES.nodoor });
    }
    return Object.assign(base, { status: 'ok', name: hit.name });
  }

  /**
   * THE IMPORT RESULT — the one object the rest of the feature (and anything
   * added later) reads. Versioned, because a saved schedule outlives the
   * session that made it.
   */
  async function impBuild(text, sourceId, via) {
    const got = await impRawRows(text, sourceId);
    const rows = got.rows || [];
    if (!rows.length) return { err: SAY_IMP.errNoEvents };
    if (rows.length > IMP.maxEvents) return { err: SAY_IMP.errTooMany(rows.length) };
    const classes = [], rejects = [], events = [];
    const seen = new Set();
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const p = impPlace(r);
      // ONE CLASS, NOT ONE MEETING. A weekly class is one VEVENT with an
      // RRULE, but a hand-pasted block can repeat a room on three lines; the
      // key is what makes the count on screen the number of classes.
      const key = p.code + '|' + p.room + '|' + p.start + '|' + (p.days || []).join('');
      if (seen.has(key)) continue;
      seen.add(key);
      if (p.status === 'ok') classes.push(p); else rejects.push(p);
      // THE SAME ROW, KEPT IN THE PARSER'S SHAPE. Same set, same order, same
      // de-duplication, so `events` and `classes` + `rejects` are two views of
      // one list rather than two lists that can drift.
      events.push(got.events ? got.events[i] : impEventFromPlaced(p, r, events.length + 1));
    }
    if (!classes.length && !rejects.length) return { err: SAY_IMP.errNoEvents };
    if (!classes.length && rejects.every(r => r.status === 'nolocation')) {
      return { err: via === 'text' ? SAY_IMP.errNoClassesText : SAY_IMP.errNoClasses };
    }
    return {
      v: 1, source: sourceId, via: via, at: Date.now(),
      classes: classes, rejects: rejects,
      // ── AND THE PARSER'S OWN SHAPE, CARRIED ───────────────────────────────
      // `events` is what `wayfindDayFromSchedule()` reads and what the store
      // is handed; `origin` is the parser's account of where the file came
      // from, which is what lets the day view's footer tell Google from Apple
      // from UT. Publishing them on the SAME object is what makes one import
      // satisfy every reader downstream, instead of each lane publishing a
      // shape only it can read. `decoder` records which producer actually ran,
      // because "which decoder read the student's file" turned out to be a
      // question nobody could answer from outside.
      decoder: got.decoder,
      events: events,
      origin: (got.parsed && got.parsed.source) || null,
      tz: (got.parsed && got.parsed.tz) || IMP.tz,
      problems: (got.parsed && got.parsed.problems) || [],
      summary: (got.parsed && got.parsed.summary) || null,
    };
  }

  // ── the screen ────────────────────────────────────────────────────────────

  let impEl = null;
  // `url` and `text` LIVE IN STATE, NOT IN THE DOM, and that is not tidiness
  // either. `impRender` rebuilds the body, so the first cut threw away the
  // address the student had just typed every time it drew the error about it
  // — photographed at 390 x 844: an empty field, an invisible message and no
  // way to see what had been tried. A field whose value the screen forgets is
  // worse than no field.
  const impState = { source: IMP.defaultSource, result: null, err: null, busy: false,
    url: '', text: '', showAll: false,
    // How many placed rows this panel turned out to have room for, measured
    // once per result by `impFitList`. `null` means "not measured yet", which
    // is the state every new result starts in, and `fitDone` latches once
    // the panel is whole so a thumb on the scroller cannot restart the search.
    fit: null, fitDone: false };

  function impSource(id) {
    return IMP_SOURCES.find(s => s.id === id) || IMP_SOURCES[0];
  }

  function impBuildDOM() {
    if (impEl) return impEl;
    const panel = h('div', 'hidden'); panel.id = 'wf-imp';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', SAY_IMP.title);

    const head = h('div', null); head.id = 'wf-imp-head';
    const title = h('div', 'wf-h', SAY_IMP.title); title.id = 'wf-imp-title';
    head.appendChild(title);
    const close = h('button', null); close.id = 'wf-imp-close';
    close.setAttribute('aria-label', 'Close');
    close.appendChild(icon(null, IC.close, 2.1));
    close.addEventListener('click', () => impClose());
    head.appendChild(close);
    panel.appendChild(head);

    // THE TABS. Three sources, one panel — three stacked panels do not fit on
    // a 390 px phone and a source a student does not use is not worth the
    // scroll. `role=tablist` because they are tabs and a screen reader should
    // hear them as tabs.
    const tabs = h('div', null); tabs.id = 'wf-imp-tabs';
    tabs.setAttribute('role', 'tablist');
    for (const s of IMP_SOURCES) {
      const b = h('button', 'wf-imp-tab', s.tab);
      b.setAttribute('role', 'tab');
      b.dataset.src = s.id;
      b.addEventListener('click', () => { impState.source = s.id; impState.err = null; impRender(); });
      tabs.appendChild(b);
    }
    panel.appendChild(tabs);

    const body = h('div', null); body.id = 'wf-imp-body';
    // The shade is a function of where this scroller actually is, so it is
    // recomputed from the scroller itself and never from what a render thought
    // it had drawn. `passive` because it only reads geometry.
    body.addEventListener('scroll', () => impShade(), { passive: true });
    panel.appendChild(body);

    // WHAT WENT WRONG IS NOT A RESULT, SO IT DOES NOT LIVE IN THE SCROLLER.
    // Exactly the lesson `#wf-more` in the search sheet already learned and
    // wrote down: a note ABOUT the contents, put inside the contents, gets cut
    // in half by their max-height. The first cut put this at the end of
    // `#wf-imp-body` and photographed at 390 x 844 the message was entirely
    // below the fold — the student pressed Import, nothing appeared to happen,
    // and the explanation was two scrolls away. Its own row, above the action,
    // where the eye already is.
    const errSlot = h('div', null); errSlot.id = 'wf-imp-errslot';
    panel.appendChild(errSlot);

    const foot = h('div', null); foot.id = 'wf-imp-foot';
    panel.appendChild(foot);

    const note = h('div', 'wf-imp-note', SAY_IMP.privacy);
    panel.appendChild(note);

    // ONE FILE INPUT FOR THE WHOLE SCREEN, kept out of the flow. A file input
    // is styled differently by every browser and cannot be made to match this
    // panel; the visible control is a real button that clicks this.
    const file = document.createElement('input');
    file.type = 'file'; file.id = 'wf-imp-file';
    file.accept = '.ics,text/calendar';
    file.addEventListener('change', () => {
      const f = file.files && file.files[0];
      if (f) impFromFile(f);
      file.value = '';
    });
    panel.appendChild(file);

    el.root.appendChild(panel);
    impEl = { panel, head, title, tabs, body, errSlot, foot, file, note };
    // A rotation, or the software keyboard opening under a focused field,
    // changes how much of the body is visible without a scroll event ever
    // firing — so the shade would go stale in exactly the moment a phone is
    // most cramped. Bound once, and it costs nothing while the panel is shut.
    window.addEventListener('resize', () => {
      if (impEl && !impEl.panel.classList.contains('hidden')) impShade();
    }, { passive: true });
    return impEl;
  }

  function impOpen() {
    buildUI();
    impBuildDOM();
    // The graph is what turns a code into a building name and a verdict, so
    // the screen asks for it the moment it opens rather than at Import — a
    // student who has just chosen a file should not then wait 300 ms for a
    // fetch that could have run while they were choosing.
    loadGraph().catch(() => {});
    impState.result = null; impState.err = null; impState.busy = false;
    impState.url = ''; impState.text = ''; impState.showAll = false;
    impState.fit = null; impState.fitDone = false;
    el.sheet.classList.add('hidden');
    el.btn.classList.remove('active');
    impEl.panel.classList.remove('hidden');
    impRender();
  }
  function impClose() {
    if (!impEl) return;
    impEl.panel.classList.add('hidden');
  }
  function impBack() {
    impState.result = null; impState.err = null; impState.busy = false;
    impState.showAll = false; impState.fit = null; impState.fitDone = false;
    impRender();
  }

  /** A labelled block of small print above a control. */
  function impSteps(src) {
    const box = h('div', 'wf-imp-steps');
    src.steps.forEach((s, i) => {
      const row = h('div', 'wf-imp-step');
      row.appendChild(h('span', 'wf-imp-n', String(i + 1)));
      row.appendChild(h('span', 'wf-imp-t', s));
      box.appendChild(row);
    });
    return box;
  }

  function impRenderAdd() {
    const src = impSource(impState.source);
    const { body, foot, tabs, title } = impEl;
    title.textContent = SAY_IMP.title;
    for (const b of tabs.children) b.classList.toggle('on', b.dataset.src === src.id);
    for (const b of tabs.children) b.setAttribute('aria-selected', b.dataset.src === src.id ? 'true' : 'false');
    tabs.classList.remove('hidden');
    body.innerHTML = ''; foot.innerHTML = '';
    body.appendChild(impSteps(src));
    impRenderErr();

    // The controls this source actually produces, in the order it produces
    // them. `accepts` is the whole layout rule — see IMP_SOURCES.
    //
    // A label is written for the SECOND slot ("or choose an exported .ics")
    // because that is where its source puts it; a source that puts the same
    // control first drops the "or ", and then it has to be a capital again.
    // Photographed: `choose an exported .ics` on a button, lowercase, sitting
    // directly under a sentence-case error.
    const lead = (s) => (s || '').replace(/^or /, '').replace(/^./, c => c.toUpperCase());
    let first = true;
    for (const kind of src.accepts) {
      if (!first) body.appendChild(h('div', 'wf-imp-or', 'or'));
      if (kind === 'file') {
        const b = h('button', 'wf-imp-file-btn');
        b.appendChild(icon('wf-imp-ic', IC_IMP.upload, 1.9));
        b.appendChild(h('span', null, first ? src.fileLabel : lead(src.fileLabel)));
        b.addEventListener('click', () => impEl.file.click());
        body.appendChild(b);
      } else if (kind === 'url') {
        const lab = h('div', 'wf-imp-lab', first ? src.urlLabel : lead(src.urlLabel));
        body.appendChild(lab);
        const inp = document.createElement('input');
        inp.type = 'url'; inp.id = 'wf-imp-url'; inp.className = 'wf-imp-in';
        inp.placeholder = src.urlPlaceholder;
        inp.autocomplete = 'off'; inp.spellcheck = false; inp.enterKeyHint = 'go';
        inp.value = impState.url;
        inp.addEventListener('input', () => { impState.url = inp.value; });
        inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') impGo(); });
        body.appendChild(inp);
        if (src.urlHint) body.appendChild(h('div', 'wf-imp-hint', src.urlHint));
      } else if (kind === 'text') {
        const lab = h('div', 'wf-imp-lab', src.textLabel);
        body.appendChild(lab);
        const ta = document.createElement('textarea');
        ta.id = 'wf-imp-text'; ta.className = 'wf-imp-in wf-imp-ta';
        ta.placeholder = src.textPlaceholder;
        ta.spellcheck = false; ta.rows = 4;
        ta.value = impState.text;
        ta.addEventListener('input', () => { impState.text = ta.value; });
        body.appendChild(ta);
      }
      first = false;
    }

    // The primary action only exists for the sources that have something to
    // press it with. A file picker imports on pick — a second button after it
    // would be a control with nothing to do.
    if (src.accepts.indexOf('url') >= 0 || src.accepts.indexOf('text') >= 0) {
      const go = h('button', 'wf-imp-go', impState.busy ? SAY_IMP.working : SAY_IMP.importBtn);
      go.disabled = !!impState.busy;
      go.addEventListener('click', () => impGo());
      foot.appendChild(go);
    }
  }

  function impRenderErr() {
    const slot = impEl.errSlot;
    slot.innerHTML = '';
    if (!impState.err) return;
    const e = h('div', 'wf-imp-err');
    e.setAttribute('role', 'alert');
    e.appendChild(icon('wf-imp-err-ic', IC_IMP.warn, 2));
    e.appendChild(h('span', null, impState.err));
    slot.appendChild(e);
    // AND THE WAY OUT OF THE FAILURE HAS TO BE VISIBLE UNDER IT. Photographed
    // at 390 x 844 on the Apple tab: the message said "download the .ics and
    // choose the file instead" while the file button it means was scrolled off
    // the bottom of the body — an instruction pointing at a control the same
    // frame is hiding. The message itself costs the body ~86 px, so an error
    // is exactly the moment the controls stop fitting.
    //
    // Scrolling the body to its END is the fix and not an arbitrary one: every
    // source puts its numbered instructions first and its CONTROLS last, so
    // the bottom of that scroller is always the doing half. The steps are what
    // the student has already followed.
    const b = impEl.body;
    if (b) requestAnimationFrame(() => { b.scrollTop = b.scrollHeight; impShade(); });
  }

  function impDayStr(days) {
    if (!days || !days.length) return '';
    const order = IMP.dayOrder;
    return days.slice().sort((a, b) => order.indexOf(a) - order.indexOf(b))
      .map(d => IMP.dayShort[d] || d).join('');
  }
  function impTimeStr(c) {
    if (!c.start) return '';
    return c.start + (c.end ? '–' + c.end : '');
  }
  function impWhy(r, via) {
    if (r.status === 'offmap') return SAY_IMP.whyOffmap(r.name, r.place);
    if (r.status === 'nodoor') return SAY_IMP.whyNodoor(r.name);
    if (r.status === 'nolocation') {
      return via === 'text' ? SAY_IMP.whyNoLocationText : SAY_IMP.whyNoLocation;
    }
    return SAY_IMP.whyUnknown(r.code);
  }

  function impRenderResult() {
    const res = impState.result;
    const { body, foot, tabs, title } = impEl;
    const src = impSource(res.source);
    title.textContent = res.classes.length ? SAY_IMP.resultTitle : SAY_IMP.failTitle;
    tabs.classList.add('hidden');
    body.innerHTML = ''; foot.innerHTML = '';
    impRenderErr();

    const total = res.classes.length + res.rejects.length;
    const sum = h('div', 'wf-imp-sum');
    sum.appendChild(h('div', 'wf-imp-count',
      res.rejects.length ? SAY_IMP.placed(res.classes.length, total)
        : SAY_IMP.placedAll(res.classes.length)));
    sum.appendChild(h('div', 'wf-imp-src', SAY_IMP.fromSource(src.label)));
    body.appendChild(sum);

    // ── WHAT FAILED COMES FIRST, AND THIS IS THE ONE ORDERING DECISION ON
    //    THE SCREEN THAT WAS MADE FROM A PHOTOGRAPH RATHER THAN FROM TASTE.
    //    The first cut listed the six that worked and then the three that did
    //    not. Photographed at 390 x 844 that put FOUR placed rows on screen
    //    and every failure below the fold: a student who imports nine classes
    //    sees six ticks, believes they are done, and finds out on the second
    //    Tuesday of term that the app has never heard of their Friday lab.
    //    The count line above already delivers the good news in five words.
    //    The three rows that change what they have to do go where the eye is.
    if (res.rejects.length) {
      body.appendChild(h('div', 'wf-imp-sec bad', SAY_IMP.couldNot(res.rejects.length)));
      const bad = h('div', 'wf-imp-list');
      for (const r of res.rejects) {
        const row = h('div', 'wf-imp-row bad');
        row.appendChild(icon('wf-imp-row-ic', IC_IMP.warn, 2));
        const mid = h('div', 'wf-imp-mid');
        const l1 = h('div', 'wf-imp-l1');
        // WHAT THE STUDENT ACTUALLY TYPED OR EXPORTED, verbatim. A failure
        // row that shows our normalised guess instead of their own text is a
        // failure row they cannot check.
        l1.appendChild(h('span', 'wf-imp-rawtxt',
          r.code ? (r.code + (r.room ? ' ' + r.room : '')) : SAY_IMP.noRoom));
        if (r.title && r.title !== SAY_IMP.unnamed) l1.appendChild(h('span', 'wf-imp-rtitle', r.title));
        mid.appendChild(l1);
        mid.appendChild(h('div', 'wf-imp-l2 why', impWhy(r, res.via)));
        row.appendChild(mid);
        bad.appendChild(row);
      }
      body.appendChild(bad);
    }

    if (res.classes.length) {
      body.appendChild(h('div', 'wf-imp-sec', SAY_IMP.placedSec(res.classes.length)));
      const list = h('div', 'wf-imp-list');
      const cap = impState.showAll ? res.classes.length
        : Math.min(IMP.resultPeek, impState.fit == null ? IMP.resultPeek : impState.fit);
      const shown = res.classes.slice(0, cap);
      for (const c of shown) {
        const row = h('div', 'wf-imp-row ok');
        row.appendChild(icon('wf-imp-row-ic', IC_IMP.check, 2.4));
        const mid = h('div', 'wf-imp-mid');
        const l1 = h('div', 'wf-imp-l1');
        l1.appendChild(h('span', 'wf-imp-code', c.code));
        l1.appendChild(h('span', 'wf-imp-bname', c.name || ''));
        if (c.room) l1.appendChild(h('span', 'wf-imp-room', c.room));
        mid.appendChild(l1);
        // WHEN FIRST, THEN THE COURSE. The second line is one line with an
        // ellipsis on it, so whichever half is last is the half that gets
        // eaten — and `TTh 12:30–14:00` is what makes the row a class rather
        // than a building, while `C S 429 - COMPUTER ORGANIZATION AND…` is
        // the student's own course title, which they can already recite.
        const when = [[impDayStr(c.days), impTimeStr(c)].filter(Boolean).join(' '), c.title]
          .filter(Boolean).join(' · ');
        mid.appendChild(h('div', 'wf-imp-l2', when));
        row.appendChild(mid);
        list.appendChild(row);
      }
      body.appendChild(list);
      if (res.classes.length > shown.length) {
        const more = h('button', 'wf-imp-more',
          SAY_IMP.andMore(res.classes.length - shown.length));
        // The list is the last thing in the body, so opening it always adds
        // height BELOW where the eye already is — the scroll shade picks that
        // up on the next frame and the new rows are reachable by thumb.
        more.addEventListener('click', () => { impState.showAll = true; impRender(); });
        body.appendChild(more);
      }
    }

    if (res.classes.length) {
      const use = h('button', 'wf-imp-go', SAY_IMP.useThese(res.classes.length));
      use.addEventListener('click', () => impUse(res));
      foot.appendChild(use);
    } else {
      foot.appendChild(h('div', 'wf-imp-none', SAY_IMP.noneUsable));
    }
    const back = h('button', 'wf-imp-back', SAY_IMP.back);
    back.addEventListener('click', () => impBack());
    foot.appendChild(back);
  }

  /**
   * THE SCROLLER HAS TO SAY THAT IT IS A SCROLLER, AND THIS WAS FOUND IN A
   * FRAME, NOT IN THE CODE.
   *
   * `#wf-imp-body` is the one child that yields height, so on a 390 x 844 phone
   * it is almost always shorter than its contents — and it clipped them with a
   * hard edge and no mark of any kind. Two photographs, both from a working
   * build:
   *
   *   - THE RESULT SCREEN. "6 of 9 classes placed", three failures, `PLACED 6`,
   *     and then ONE placed row before the edge. The other five were below it
   *     with nothing on screen to say so, and `+ N more` does not fire here
   *     because six is exactly `IMP.resultPeek`. A student who is told six
   *     classes were placed and shown one has been given a number they cannot
   *     check.
   *   - THE ERROR SCREEN. `impRenderErr` scrolls the body to its end on purpose
   *     (so the control the message names is under the message), and the end
   *     landed mid-line: the bottom halves of the letters of "…Subscription
   *     Calendar" sat under the tab divider like a rendering fault.
   *
   * Both are the same missing thing — an edge that is CUT looks identical to an
   * edge that is FINISHED. So each end that has content past it is faded, and
   * an end that has nothing past it is left hard, which is what makes the fade
   * mean something. A half-line under a fade reads as "there is more up there";
   * a half-line under a crisp border reads as a bug.
   *
   * Driven off measured scroll geometry rather than a render-time guess,
   * because the same body is scrolled by a thumb, by `impRenderErr`, and by the
   * keyboard opening under a focused field.
   */
  function impShade() {
    const b = impEl && impEl.body;
    if (!b) return;
    const slop = IMP.edgeSlopPx;
    const over = b.scrollHeight - b.clientHeight;
    b.classList.toggle('cut-top', over > slop && b.scrollTop > slop);
    b.classList.toggle('cut-bot', over > slop && (over - b.scrollTop) > slop);
  }

  /**
   * HOW MANY PLACED CLASSES FIT, ASKED OF THE PANEL RATHER THAN GUESSED.
   *
   * `IMP.resultPeek` was the whole rule and a fixed number cannot be right
   * twice. Photographed on a 390 x 844 phone: nine imported, three failed,
   * `PLACED 6` — and ONE placed row before the edge of the scroller. The other
   * five were below the fold, `Show N more` did not appear because six is
   * exactly the peek, and the button said `Use these 6`. A screen that names a
   * number, shows one of it, and then routes you somewhere on the strength of
   * the rest is asking to be trusted about a thing it is hiding.
   *
   * Whether they fit depends on what is ABOVE them — three failures whose
   * reasons each wrap to two or three lines cost about 210 px of a 373 px
   * body, and a clean import costs none of it. So it is measured: render once,
   * count the rows that landed whole inside the scroller, and if any did not,
   * re-render with the list cut to what fits and a real `Show N more` under
   * it. The count on the screen becomes a count the student can check.
   *
   * THE BUTTON IS PART OF WHAT HAS TO FIT, and the first cut of this function
   * forgot that: it counted the rows that fitted, dropped one, and shipped —
   * and the `Show 5 more` it had just added landed below the fold, which is
   * the identical defect to the one this feature already fixed once, when an
   * error message named a file button the same frame was hiding. Photographed:
   * `PLACED 6`, one WEL row, and no control anywhere on the panel. So the exit
   * condition is not "the rows fit", it is "the rows fit AND the way to the
   * rest is reachable".
   *
   * IT TERMINATES BY CONSTRUCTION. Each pass renders one fewer row than the
   * last, so it runs at most `IMP.resultPeek + 1` times and cannot oscillate —
   * `fit` never grows. `fitDone` latches the moment the panel is whole, so a
   * thumb scrolling the body afterwards cannot restart it. A layout loop on a
   * panel over a live map is not a bug anyone would enjoy finding on a phone.
   */
  /**
   * How deep the bottom shade currently eats, in px — 0 when it is not on.
   * READ OFF THE STYLESHEET, not restated here: `--wf-imp-fade` is a taste
   * value and CLAUDE.md rule 11 puts taste values where Simeon can change
   * them in one line. A copy of the number in this file would be a second
   * place to change it and therefore a place to forget.
   */
  function impFadePx() {
    const b = impEl && impEl.body;
    if (!b) return 0;
    if ((b.scrollHeight - b.clientHeight) <= IMP.edgeSlopPx) return 0;
    const v = parseFloat(getComputedStyle(b).getPropertyValue('--wf-imp-fade'));
    return isFinite(v) ? v : 0;
  }

  function impFitList() {
    if (!impEl || !impState.result || impState.showAll || impState.fitDone) return;
    const b = impEl.body;
    for (let pass = 0; pass <= IMP.resultPeek; pass++) {
      const bb = b.getBoundingClientRect();
      // CLEAR OF THE SHADE, not merely inside the box. An earlier cut stopped
      // the moment `Show 6 more` was technically within the scroller — and the
      // scroller was still overflowing, so the shade was on, and the bottom
      // 16 px of that button was ghosted out. A control half-dissolved by the
      // affordance that says "there is more below" is a worse frame than the
      // one this function was written to fix.
      const guard = impFadePx();
      const inside = (e) => !!e && e.getBoundingClientRect().bottom <= bb.bottom - guard + 1;
      const rows = [].slice.call(b.querySelectorAll('.wf-imp-row.ok'));
      const more = b.querySelector('.wf-imp-more');
      if (rows.every(inside) && (!more || inside(more))) break;
      // Nothing left to give. The failures alone have filled the panel, which
      // is a real result and not a layout bug — five reasons a student has to
      // read are worth more than a sample of the six that worked. The shade
      // and the scroller take it from here, and the two numbers that matter
      // are already above the fold and on the button.
      if (rows.length <= IMP.minPeek) break;
      impState.fit = rows.length - 1;
      impRenderResult();
    }
    impState.fitDone = true;
  }

  function impRender() {
    if (!impEl) return;
    // ONE SYNCHRONOUS PASS, and the fit runs INSIDE it rather than a frame
    // later. This used to post `impFitList` to `requestAnimationFrame` and let
    // it chain a frame per shrink, which reasons fine and measures badly: on
    // the headless Chrome this suite drives, a UT paste with five failures was
    // still visibly mid-shrink FOUR SECONDS after the result rendered, with
    // `Show 6 more` hanging below the fold the whole time. Whatever throttles
    // rAF for an offscreen surface will throttle it on a phone whose browser
    // has decided the tab is busy, and a panel that reflows six times in front
    // of a student is worse than the defect it is fixing.
    // `getBoundingClientRect` forces layout, so the measurement is available
    // now, not next frame.
    if (impState.result) { impRenderResult(); impFitList(); } else impRenderAdd();
    impShade();
    // One more, a frame later, only for the shade: a web font swapping in
    // after this returns changes how much overflows, and the shade is the one
    // thing here that is cheap enough to recompute for free.
    requestAnimationFrame(impShade);
  }

  // ── the three ways bytes arrive ───────────────────────────────────────────

  /**
   * THE VERDICT CANNOT BE COMPUTED BEFORE THE GRAPH EXISTS, AND UNTIL THIS
   * ROUND IT WAS COMPUTED ANYWAY.
   *
   * `impPlace` asks `wayfindSearch` whether a code has a walkable door.
   * `impOpen` kicks off `loadGraph()` when the panel opens — deliberately, so
   * that the fetch overlaps the student reading the instructions — but nothing
   * WAITED for it. Reproduced on the real page: open the panel, paste twelve
   * real UT rows, press Import inside two seconds, and the screen says
   *
   *     12 · Couldn't place 12 · Nothing here can be routed to
   *
   * for a schedule where seven of them are two minutes' walk away. Do the same
   * thing five seconds later and it says `7 of 12 classes placed`. Same input,
   * same build, two different answers — the worst shape a bug can have on a
   * screen whose entire job is telling a student the truth about their own
   * timetable, and it is silent: nothing on the panel suggests waiting.
   *
   * `loadGraph` memoises its own promise, so awaiting it here costs nothing
   * after the first time and cannot start a second fetch. A rejection is
   * swallowed on purpose: if the graph genuinely will not load, the honest
   * thing is still to place what the static register can and say so per row,
   * which is exactly what the failure taxonomy is for.
   */
  function impFinish(text, via) {
    let p = null;
    try { p = loadGraph(); } catch (e) { p = null; }
    if (!p || typeof p.then !== 'function') { impFinishNow(text, via); return; }
    // `Reading…` stays on the button for as long as this takes. It is the
    // campus graph being fetched rather than the student's file being read,
    // but from their side the import has not finished either way, and a second
    // busy state saying "waiting for the campus map" is a state they cannot
    // act on and did not ask about.
    impState.busy = true; impRender();
    p.then(() => impFinishNow(text, via), () => impFinishNow(text, via));
  }

  async function impFinishNow(text, via) {
    let out;
    // `busy` is cleared AFTER the await, not before it: the parser is async
    // now, and clearing it first put `Import` back on the button while the
    // file was still being read.
    try { out = await impBuild(text, impState.source, via); }
    catch (e) { out = { err: SAY_IMP.errNoEvents }; }
    impState.busy = false;
    impState.showAll = false; impState.fit = null; impState.fitDone = false;
    if (out.err) { impState.err = out.err; impState.result = null; }
    else { impState.result = out; impState.err = null; }
    impRender();
    return out;
  }

  function impFromFile(f) {
    impState.err = null;
    if (/\.zip$/i.test(f.name)) { impState.err = SAY_IMP.errZip; impRender(); return; }
    impState.busy = true; impRender();
    const rd = new FileReader();
    rd.onerror = () => { impState.busy = false; impState.err = SAY_IMP.errNotICS; impRender(); };
    rd.onload = () => {
      const text = String(rd.result || '');
      // A .zip that has been renamed still starts PK\x03\x04, and the message
      // for it is the useful one rather than "this is not a calendar".
      if (text.slice(0, 2) === 'PK') { impState.busy = false; impState.err = SAY_IMP.errZip; impRender(); return; }
      if (!/BEGIN:VCALENDAR|BEGIN:VEVENT/i.test(text) && /\.ics$/i.test(f.name)) {
        impState.busy = false; impState.err = SAY_IMP.errNotICS; impRender(); return;
      }
      impFinish(text, 'file');
    };
    rd.readAsText(f);
  }

  async function impFromUrl(raw) {
    const s = String(raw || '').trim();
    if (!s) { impState.err = SAY_IMP.errEmptyUrl; impRender(); return; }
    // webcal:// and https:// are the same feed and both ends accept the swap —
    // docs/import-bar-apple.md. So an Apple subscription address pasted here
    // works without the student having to know that.
    const url = s.replace(/^webcal:\/\//i, 'https://');
    let host = '';
    try { host = new URL(url).host; } catch (e) { impState.err = SAY_IMP.errBadUrl; impRender(); return; }
    impState.busy = true; impState.err = null; impRender();
    const ctl = ('AbortController' in window) ? new AbortController() : null;
    const timer = setTimeout(() => { if (ctl) ctl.abort(); }, IMP.fetchTimeoutMs);
    try {
      const res = await fetch(url, ctl ? { signal: ctl.signal } : undefined);
      clearTimeout(timer);
      if (!res.ok) { impState.busy = false; impState.err = SAY_IMP.errHttp(res.status); impRender(); return; }
      impFinish(await res.text(), 'url');
    } catch (e) {
      clearTimeout(timer);
      impState.busy = false;
      // THE COMMONEST FAILURE THIS SCREEN HAS, AND IT IS NOT OUR BUG. A browser
      // will not let this page read calendar.google.com's response; the fetch
      // fails identically whether the address is wrong, the network is down or
      // CORS refused. The honest sentence names the host and gives the way
      // round it, because the way round is a control already on this screen.
      impState.err = (e && e.name === 'AbortError') ? SAY_IMP.errTimeout : SAY_IMP.errBlocked(host);
      impRender();
    }
  }

  function impGo() {
    if (impState.busy) return;
    const ta = document.getElementById('wf-imp-text');
    if (ta) {
      impState.text = ta.value;
      if (!impState.text.trim()) { impState.err = SAY_IMP.errEmptyText; impRender(); return; }
      impState.err = null; impState.busy = true; impRender();
      // A paste can be long; yield once so `Reading…` actually paints.
      setTimeout(() => impFinish(impState.text, 'text'), 0);
      return;
    }
    const u = document.getElementById('wf-imp-url');
    if (u) { impState.url = u.value; impFromUrl(impState.url); }
  }

  /**
   * THE HANDOFF. The schedule is published on `window.wayfindSchedule` — the
   * one object anything else in this feature reads — and the two ends of the
   * router that already exists are filled with the first two consecutive
   * classes, which is the answer to "why import this into a MAP".
   */
  function impUse(res) {
    window.wayfindSchedule = res;
    // SI3. THE IMPORT IS WHAT SAVES, AND UNTIL NOW NOTHING DID.
    // `WAYFIND.store.save` calls itself "the public seam the import lanes
    // call" and no line in this file called it, so a reload lost the import,
    // "Delete my schedule" had nothing to delete, and the egress guard — which
    // arms its watchlist from the STORED schedule — was reading watched=0 at
    // the exact moment a schedule was in memory and on screen.
    //
    // HERE AND NOT AT PREVIEW TIME. This is the tap that says "use these"; a
    // schedule a student looked at and backed out of has no business being
    // left on the device.
    let saved = null;
    try {
      saved = (window.WAYFIND && WAYFIND.store && WAYFIND.store.save)
        ? WAYFIND.store.save(impStoreDoc(res)) : null;
    } catch (e) { saved = { ok: false, why: 'threw' }; }
    res.saved = saved;
    try {
      window.dispatchEvent(new CustomEvent('wayfind:schedule', { detail: res }));
    } catch (e) {}
    const cs = res.classes.slice().sort(impByTime);
    impClose();
    el.sheet.classList.remove('hidden');
    el.btn.classList.add('active');
    if (cs.length >= 2) {
      const a = resolve(cs[0].code), b = resolve(cs[1].code);
      if (a && b) {
        state.from = a; state.to = b;
        el.inFrom.value = a.display; el.inTo.value = b.display;
      }
    } else if (cs.length === 1) {
      const b = resolve(cs[0].code);
      if (b) { state.to = b; el.inTo.value = b.display; }
    }
    try { syncClears(); renderList(el.inTo); } catch (e) {}
  }
  /**
   * THE IMPORT RESULT -> THE STORED ENVELOPE. `normaliseSchedule` decides what
   * a stored schedule IS; this only decides what to hand it.
   *
   * THE REJECTS ARE STORED TOO, each with the reason this screen gave for it.
   * A student who imported seven classes and can walk to five still has seven
   * classes on their Tuesday, and dropping the other two on the way to disk
   * would put an invented two-hour gap into the day view the moment the page
   * reloads — the same defect WF_DAY.showUnplaced exists to stop.
   */
  function impStoreDoc(res) {
    const out = [];
    const put = (c, why) => out.push({
      code: c.code || null, room: c.room || null, title: c.title || null,
      days: (c.days || []).slice(),
      startMin: c.startMin == null ? null : c.startMin,
      endMin: c.endMin == null ? null : c.endMin,
      unroutableWhy: why, confidence: 1,
    });
    for (const c of (res.classes || [])) put(c, null);
    for (const r of (res.rejects || [])) put(r, r.status || 'unknown');
    return {
      classes: out, tz: res.tz || IMP.tz, term: null,
      source: (impSource(res.source) || {}).storeKind || 'manual',
    };
  }

  function impByTime(a, b) {
    const da = IMP.dayOrder.indexOf((a.days || [])[0] || 'MO');
    const db = IMP.dayOrder.indexOf((b.days || [])[0] || 'MO');
    if (da !== db) return da - db;
    return String(a.start || '').localeCompare(String(b.start || ''));
  }

  /**
   * THE DOOR IN. Appended to the walk sheet rather than written into
   * `buildUI` — four other lanes are editing this file this round and a DOM
   * append is a change no one of them can conflict with.
   */
  function impInstallEntry() {
    if (!IMP.entryOn || !el || !el.sheet || document.getElementById('wf-imp-entry')) return;
    const row = h('button', null, null); row.id = 'wf-imp-entry';
    row.appendChild(icon('wf-imp-entry-ic', IC_IMP.cal, 1.9));
    const t = h('span', 'wf-imp-entry-t');
    t.appendChild(h('span', 'wf-imp-entry-lab', SAY_IMP.entry));
    t.appendChild(h('span', 'wf-imp-entry-sub', SAY_IMP.entryNote));
    row.appendChild(t);
    row.appendChild(icon('wf-imp-entry-go', IC_IMP.chevR, 2.2));
    row.addEventListener('click', (ev) => { ev.preventDefault(); impOpen(); });
    // Above the footnotes, below the hint: it is an action, and the two lines
    // under it are provenance, not controls.
    const foot = el.sheet.querySelector('.wf-foot');
    if (foot) el.sheet.insertBefore(row, foot); else el.sheet.appendChild(row);
  }
  (function impBoot() {
    if (el && el.sheet) { impInstallEntry(); return; }
    setTimeout(impBoot, 80);
  })();

  // The screen, for the verify harness and for anything added later. Opening
  // it from a script is how it gets photographed.
  window.wayfindImportOpen = impOpen;
  window.wayfindImportClose = impClose;
  window.wayfindImportSet = function (sourceId) {
    impState.source = sourceId; impState.result = null; impState.err = null;
    impState.showAll = false; impState.fit = null; impState.fitDone = false; impRender();
  };
  // BOTH OF THESE RETURN A PROMISE NOW, and that is not tidying. They used to
  // return the result object synchronously, which meant they answered before
  // the walking graph had loaded and reported every code as unreachable — the
  // same race `impFinish` documents, except a harness hitting it gets a
  // confident wrong number instead of a visibly wrong screen. `loadGraph`
  // memoises, so awaiting costs nothing on the second call.
  window.wayfindImportText = async function (text, sourceId) {
    if (sourceId) impState.source = sourceId;
    try { await loadGraph(); } catch (e) {}
    await impFinishNow(String(text), 'text');
    return impState.result || { err: impState.err };
  };
  /** WHAT THE SCREEN IS ACTUALLY SHOWING, including `decoder` — which producer
   *  made the rows it placed. Added because "which decoder read the student's
   *  file" was a question nothing outside this section could answer, and the
   *  only available proxy (the parser's return TYPE) is false by construction
   *  now that the parser is correctly awaited. */
  window.wayfindImportResult = function () { return impState.result || null; };
  window.wayfindImportParse = async function (text, sourceId) {
    try { await loadGraph(); } catch (e) {}
    return impBuild(String(text), sourceId || impState.source, 'text');
  };

  // ══════════════════════════════════════════════════════════════════════════
  // 12. THE SCHEDULE STAYS ON THE DEVICE, AND THAT HAS TO BE PROVABLE
  // ══════════════════════════════════════════════════════════════════════════
  /**
   * A class schedule is not a preference. It is where one named person is,
   * hour by hour, for four months. So this section holds exactly two promises
   * and tries to make both of them *checkable by a machine* rather than
   * believable by a reader:
   *
   *   1. NOTHING LEAVES. The schedule is written to this browser's own
   *      localStorage and to nothing else. No fetch, no XHR, no beacon, no
   *      socket, no worker message carries a byte of it.
   *   2. DELETE MEANS GONE. One tap wipes every key this feature ever wrote
   *      — including keys a *future* import source might write — plus the
   *      IndexedDB database reserved below for the image-OCR pass, and the
   *      in-memory copy. Reload and there is nothing to find.
   *
   * PROMISE 1 IS ENFORCED, NOT ASSERTED. `installEgressGuard()` wraps the six
   * ways bytes actually leave a page (fetch, XMLHttpRequest, sendBeacon,
   * WebSocket, EventSource, Worker.postMessage) plus form submission, and
   * refuses any of them that carries a string out of the stored schedule. It
   * is a seatbelt, not the safety case: the safety case is that no code here
   * ever sends anything. The guard exists so that if some later lane wires an
   * analytics call into this file, the call fails loudly instead of quietly
   * working. Its log is what `docs/si-privacy.md` audits.
   *
   * THE DOOR INTO A WORKER IS THE WHOLE ARGUMENT, so round 6 stopped patching
   * shapes and changed the default. The guard is main-thread only: it cannot
   * reach inside MapLibre's four workers, and this file creates none of its
   * own, so nothing can wrap their `fetch`. Everything therefore rests on one
   * claim — *schedule bytes never get in* — and that claim is only as good as
   * the walk that inspects a payload.
   *
   * Three rounds running, that walk had a hole in it, and each round shut the
   * one shape that had been demonstrated:
   *   - round 4: a `Blob` request BODY the guard could not read, waved through.
   *   - round 5: a `Blob` LEAF inside a worker payload, strolled past, because
   *     a `Blob` has no own enumerable properties and a `for...in` walk sees
   *     nothing on one.
   *   - round 6 (this one): an `ArrayBuffer`/`TypedArray` leaf, skipped
   *     OUTRIGHT with no flag raised, on the reasoning that a buffer "cannot
   *     hold a JS string". `TextEncoder` makes that reasoning false in one
   *     line, and the critic put a class title through a worker and out onto a
   *     raw socket with the guard armed and `blockedDelta: 0, opaqueDelta: 0`
   *     — not merely unblocked, *uncounted*.
   *
   * Patching the third shape would have left a fourth. So the walk is now
   * CLOSED BY DEFAULT instead of open by default: `scanStructured()` knows a
   * short list of node kinds it can actually read, reads them, and flags
   * ANYTHING ELSE as opaque. `Map`, `Set`, `RegExp`, `Error`, `ImageData`, a
   * host object nobody has invented yet — none of them needs its own line to
   * be caught, because the default branch is "I could not read this" rather
   * than "nothing to see here". Binary is not skipped and not blocked either
   * (MapLibre moves 22.5 MB of real tile bytes through this path on one cold
   * load, measured): the BYTES ARE SCANNED, so a buffer that is really tile
   * data passes and a buffer that is really a class title does not.
   *
   * The same round found a second silent bypass nobody had reported: the walk
   * gave up at `maxNodes` and returned `complete: false`, and every caller
   * ignored it. **21 of this app's own messages per cold load exceed the old
   * 4,000-node cap** (largest measured: 172,512 nodes), so 21 payloads a load
   * were already sailing past uninspected. The cap is now measured-with-
   * headroom and running out of it FLAGS instead of shrugging.
   *
   * WHAT IT STILL CANNOT DO, said plainly so nobody reads it as more than it
   * is — and §9 of docs/si-privacy.md is the same list with the reasoning:
   *   - it does not watch `<img src>` or a plain link navigation. Those are
   *     covered by the browser-level network capture in `docs/si-privacy.md`,
   *     which sees every request the page makes regardless of who made it.
   *   - a leak of a FRAGMENT of a field ("Data" out of "Data Structures")
   *     would not match. Whole field values are the tokens, because whole
   *     field values are what a serialiser emits and word fragments are what
   *     tile URLs are full of.
   *   - it matches CONTENT, so content that has been re-encoded past
   *     recognition — base64, gzip, XOR — is not content it can see. UTF-8 and
   *     UTF-16LE are both covered because those are what an honest bug
   *     produces; base64 is what an attacker produces, and a content scanner
   *     inside the page it is guarding cannot win that argument. This is a
   *     seatbelt against a later lane's mistake, not a sandbox.
   *   - a THROW inside the inspector fails OPEN on the NETWORK paths (the
   *     request proceeds) and is counted, because a bug in this file must not
   *     be able to stop a tile loading. On the WORKER path it now fails
   *     CLOSED (`SCHEDULE_STORE.failClosedOnScanError`) — a throw there is
   *     indistinguishable from an evasion, and 2,545 real messages a load
   *     produce zero of them.
   *   - the worker SCRIPT itself. MapLibre mints one `blob:` URL and spawns
   *     four workers from it; a `Blob` cannot be read synchronously, so the
   *     constructor wrapper below scans the URL and cannot scan blob-sourced
   *     source. Named, not hidden.
   *
   * THE SHAPE IS BUILT FOR THE SOURCES THAT DO NOT EXIST YET. Simeon asked for
   * Google Calendar, Apple Calendar and UT's registration export now, and said
   * a photo of a schedule and a Registration-Plus API should be addable later
   * "without a rewrite". Three reservations in the envelope below are what buy
   * that, and each one is a thing that would otherwise force a schema change:
   *   - `sources` is a LIST, and every class points at one of them. A photo
   *     imported on top of an .ics has to ADD to a schedule, not replace it;
   *     a single `source` string on the envelope cannot express that.
   *   - every class carries `confidence` and `provenance`. An .ics is exact
   *     (1.0, and the VEVENT UID); OCR is not, and needs somewhere to put the
   *     box on the image it read a room number out of so the student can be
   *     shown what to check. Adding that later means rewriting every stored
   *     schedule.
   *   - `v` plus `SCHEDULE_MIGRATIONS` means a v2 reader can still open a v1
   *     blob, and a v1 reader hands back `tooNew` rather than deleting a
   *     schedule it does not understand.
   */

  // ── the taste values, all of them, in one block (CLAUDE.md rule 11) ────────
  const SCHEDULE_STORE = {
    /** The one key the schedule itself lives under. */
    key: 'austin3d.schedule.v1',
    /** Delete sweeps EVERY key with this prefix, not just the one above, so a
     *  future source that writes its own key is covered by a delete written
     *  today. `austin3d.gfx.v1` (js/graphics.js) does not match it. */
    prefix: 'austin3d.schedule.',
    /** Reserved for the image-OCR pass: a photo will not fit in localStorage,
     *  and delete has to reach it on the day it starts existing. Deleting a
     *  database that was never created is a no-op, so this costs nothing now. */
    idbName: 'austin3d-schedule',
    /** A term of classes is a few KB. Anything near this is a bug or a paste
     *  of the wrong file, and localStorage throws at ~5 MB with a quota error
     *  that reads like a crash. */
    maxBytes: 256 * 1024,
    /** Strings shorter than this are not watched by the egress guard. Three
     *  letters is a building CODE — `?from=WEL&to=MAI` is a documented URL
     *  feature of this app and the codes are its public vocabulary, so a code
     *  on its own is not the private part. `MAI 220`, a course title and an
     *  instructor's name all clear the bar. */
    minTokenLen: 4,
    /** Ring buffer for the guard's log. */
    logCap: 400,
    /**
     * AN OPAQUE BODY IS REFUSED, NOT WAVED THROUGH — and this is the round-5
     * change, so it gets the whole reason written down.
     *
     * `bodyToText()` cannot read a `Blob` or a `ReadableStream` synchronously,
     * and until now it returned `undefined` for those and the guard counted
     * them and let them past. Round 4's critic did the obvious thing nobody
     * else had done: fired `fetch(url, { body: new Blob([canary]) })` at a
     * bare TCP listener with the guard armed, and watched the canary arrive on
     * the wire verbatim while `blocked` stayed 0. A seatbelt with a buckle
     * that does not close over one shape of passenger.
     *
     * So: while a schedule is stored, a body the guard cannot read is treated
     * as a body it cannot clear, and refused. The cost of that is bounded and
     * was checked rather than assumed — every request this app makes on the
     * hot path (tiles, glyphs, sprites, style JSON, the baked city data) is a
     * bodyless GET, so `bodyToText` returns `''` for all of them and none of
     * them ever reaches this rule. See docs/si-privacy.md §6.
     *
     * Flip to false to go back to fail-open if a later lane ever needs a
     * genuine binary upload while a schedule is on the device — and if you do,
     * read the audit's blob probe first, because that is the thing you are
     * turning off.
     */
    blockUnreadableBodies: true,
    /**
     * A REQUEST HEADER IS A STRING THAT GOES ON THE WIRE, and until round 8
     * nothing in this section had ever looked at one.
     *
     * `inspect()` is handed a method, a URL and a body. Round 8's channel
     * probe fired `fetch(sink, { headers: { 'X-Sched': classTitle } })`, the
     * same through a `Headers` object, and `xhr.setRequestHeader('X-Sched',
     * classTitle)` at a bare TCP listener with the guard armed. All three
     * returned 204 at `blocked: 0` and the listener read the class title
     * verbatim. This is not an exotic shape: attaching a context header is
     * what every analytics and error-reporting library does, and "a later
     * lane wires an analytics call into this file" is the exact scenario §12
     * says this guard exists for.
     *
     * WHAT IT COSTS, AND THE PREDICTION THAT WAS WRONG. This was first written
     * as "nil, because this app sets exactly one header on exactly one request
     * in its whole codebase" (`Accept: application/json`, js/graphics.js's
     * feedback POST). True of the SOURCE and false of the TRAFFIC: measured on
     * a real drive, the guard reads headers on **248–411 requests**, because
     * MapLibre passes a headers object on essentially every tile fetch. It is
     * still not measurable against the cost of a `fetch` call — the A/B in
     * docs/si-privacy.md §8 comes back with overlapping spreads — and
     * `unreadableHeaders` is 0 and no real request has ever been refused. The
     * number is here because the first claim was read off the code instead of
     * run, and `guard.state().headersScanned` republishes it so the next
     * person re-checks rather than trusts.
     *
     * Flip to false to stop scanning headers. `blockUnreadableHeaders` is the
     * same fail-closed rule bodies got in round 5: a header collection the
     * guard cannot enumerate is one it cannot clear.
     */
    scanRequestHeaders: true,
    blockUnreadableHeaders: true,
    /**
     * ROUND 8: the byte scanner registers the percent-encoded and
     * `+`-encoded forms of each watched token as extra NEEDLES, rather than
     * decoding the haystack. See `buildBytePatterns`. Flip to false to go back
     * to raw-only byte patterns; the string path keeps its decode retry either
     * way, because that one is gated on the string containing a `%` or a `+`
     * and this one cannot be.
     */
    scanEncodedForms: true,
    /** The same rule one layer down, for a `Blob`/`ReadableStream` handed to a
     *  worker rather than to the network. Separate constant because this one
     *  is on MapLibre's per-tile path and the other is not: measured on a real
     *  map load before it was turned on (docs/si-privacy.md §6), and the
     *  measurement is republished by `guard.state().opaqueWorkerLeaves` so the
     *  next person can re-check it in one line instead of trusting this
     *  comment. */
    blockOpaqueWorkerLeaves: true,
    /**
     * HOW MANY BYTES OF BINARY THE WALK WILL READ IN ONE PAYLOAD before it
     * gives up and flags instead. This is the number that lets binary be
     * SCANNED rather than blocked, which is the only option that keeps the map
     * working — MapLibre's tile bytes travel this exact path.
     *
     * Set from a measurement, not a guess. One cold load of this city with a
     * schedule stored pushes 4,742 `Uint8Array` leaves and 22.5 MB across
     * `Worker.postMessage`; the median leaf is 4 KB, the 99th percentile is
     * 16 KB, six leaves all load are over 64 KB, and the LARGEST SINGLE
     * MESSAGE totals 999,424 bytes. 4 MB is four times that worst case and
     * still a hard ceiling: past it the payload is refused, not waved on, so
     * padding a leak past the budget buys nothing.
     */
    binaryScanBytes: 4 * 1024 * 1024,
    /**
     * How far into ONE payload the structured walk goes. The old value was
     * 4,000 and running out SILENTLY gave up — measured, 21 of this app's own
     * messages per cold load exceed it and the largest on a still camera is
     * 172,512 nodes, so the guard was already blind to 21 payloads a load and
     * nothing said so.
     *
     * THE NUMBER IS BIG ON PURPOSE, and the first attempt at it was wrong in a
     * way worth writing down. 400,000 looked like 2.3× headroom over a census
     * taken on a page that loaded and then sat still. Drive the camera —
     * 1600×1000, zoom 11 to 19, seven pan-and-zoom steps — and one real
     * MapLibre payload hits **634,093 nodes**, so that cap refused one of the
     * map's own messages. A cap that blocks real traffic is worse than the
     * hole it closes.
     *
     * Running out now REFUSES, and that is what lets this be generous: a leak
     * gains nothing by padding past the cap, so the cap's only job is to bound
     * our own worst-case work. 8,000,000 is 12.6× the worst case measured
     * under deliberate punishment. Re-measure before lowering it.
     */
    workerScanNodes: 8000000,
    /** A watched token longer than this is matched by its first N characters
     *  in the byte scanner. The serialised schedule is one watched token and
     *  can be tens of KB; a full memcmp of that at every candidate byte is not
     *  something to run on the tile path, and any buffer holding the whole
     *  blob holds its first 256 characters too. */
    binaryPatternChars: 256,
    /**
     * REACH INTO A SAME-ORIGIN CHILD REALM AND GUARD IT TOO — round 7.
     *
     * The channel probe fired `iframe.contentWindow.postMessage(title, '*')`
     * with the guard armed and got `checked: 0`. Patching `Window.prototype`
     * on the main thread does not cover it, and the reason is worth knowing
     * rather than rediscovering: **a same-origin child iframe is a separate
     * JavaScript realm with its own intrinsics.** Its `Window.prototype` is a
     * different object from ours. Every wrapper in `installEgressGuard()` is
     * therefore invisible inside it, and a child frame's own `fetch` reaches
     * the network exactly the way a worker's does.
     *
     * So the guard follows the reference: whenever this page reads a frame's
     * `contentWindow` or takes the Window back from `window.open()`, that
     * realm's `postMessage` and `fetch` get wrapped before the caller can use
     * them. Cross-origin throws on the assignment and is caught — there is
     * nothing to patch there, and nothing our objects can reach either.
     *
     * Measured cost: zero. This app has no iframes and calls `window.open`
     * never, so the `contentWindow` getter below is never read on a real load
     * (`guard.state().frameChecked` is 0 in the audit).
     */
    guardChildFrames: true,
    /** A throw inside the WORKER payload walk blocks the message rather than
     *  waving it through. Different from the network paths on purpose: a
     *  broken inspector must never stop a tile downloading, but a payload that
     *  makes the walk throw is indistinguishable from one built to make it
     *  throw, and 2,545 real messages a load produce zero throws. Flip to
     *  false to go back to fail-open. */
    failClosedOnScanError: true,
    /** One tap deletes, with no "are you sure". Flip to true if that ever
     *  reads as too sharp — the brief asked for one tap and an undo would
     *  mean keeping the data around after saying it was gone. */
    deleteNeedsConfirm: false,
    /** How long the "Deleted." line stays up before the panel goes back to
     *  its empty state. */
    deletedNoticeMs: 5000,
  };

  /** Where a schedule came from. An open registry: adding a source is one line
   *  here and a parser somewhere else, never a change to what is stored. The
   *  last two are deliberately listed before they are built — they are the
   *  forward compatibility, written down. */
  const SCHEDULE_SOURCES = {
    'google-ics': 'a Google Calendar export',
    'apple-ics': 'an Apple Calendar export',
    'ut-registration': 'UT’s registration export',
    'manual': 'classes typed in by hand',
    // Not built this pass. Named so the storage format already has a home for
    // them and the delete sweep already covers what they will write.
    'image-ocr': 'a photo of a schedule',
    'registration-plus': 'Registration Plus',
  };

  const SCHEDULE_SCHEMA_VERSION = 1;
  /** v => function turning a v blob into a v+1 blob. Empty today; the loop
   *  below is what makes it a one-line job later. */
  const SCHEDULE_MIGRATIONS = {};

  /**
   * THE COPY. index.html carries the editable copy of this in
   * `<template id="wf-privacy-copy">` and it WINS — these are the defaults, so
   * `_harness.html` (which has no such template, and must not, or
   * harness-drift.mjs is not the only thing that can drift) still says the
   * same words. `scripts/verify` asserts the two agree; see docs/si-privacy.md.
   */
  const SCHEDULE_PRIVACY_COPY = {
    line: 'Your schedule stays on this device — saved in this browser only, ' +
          'never uploaded anywhere, and Delete wipes it for good.',
    deleteBtn: 'Delete my schedule',
    deleted: 'Deleted. Nothing of it is left in this browser.',
    empty: 'No schedule saved on this device yet.',
    confirm: 'Delete it? This cannot be undone.',
  };
  /** Rendered when a schedule IS stored. Counts and a source, never a class
   *  name — the panel sits in the footer of a sheet that may be on screen
   *  while someone else is looking. */
  const scheduleSavedLine = (n, srcLabel) =>
    n + (n === 1 ? ' class' : ' classes') + ' from ' + srcLabel + ', on this device only';

  /** The panel's look. Reuses the feature's own custom properties so it is not
   *  a second design system living in the footer. */
  const SCHEDULE_PRIVACY_CSS = [
    '#wf-priv{display:block;padding:8px 14px 9px;border-top:1px solid var(--wf-edge-soft);',
    'font-size:var(--wf-small);line-height:1.5;color:var(--wf-dim)}',
    '#wf-priv .wf-priv-line{color:var(--wf-dimmer)}',
    '#wf-priv .wf-priv-state{margin-top:5px;color:var(--wf-ink);opacity:.82}',
    '#wf-priv .wf-priv-state:empty{display:none}',
    '#wf-priv-del{margin-top:6px;display:none;align-items:center;gap:6px;',
    'min-height:32px;padding:0 var(--wf-ghost-pad);border-radius:9px;',
    'border:1px solid var(--wf-edge);background:transparent;color:var(--wf-ink);',
    'font:inherit;font-size:var(--wf-small);letter-spacing:.02em;cursor:pointer}',
    '#wf-priv-del:hover{border-color:var(--wf-hot);background:rgba(245,166,35,.10)}',
    '#wf-priv-del:focus-visible{outline:2px solid var(--wf-accent);outline-offset:2px}',
    // An <svg> with a viewBox and no width collapses to 300x150 and blows the
    // footer apart. Every other icon in this feature is sized by style.css,
    // which this lane does not own, so this one sizes itself.
    '#wf-priv-del svg{width:11px;height:11px;flex:none}',
    '#wf-priv.has-schedule #wf-priv-del{display:inline-flex}',
  ].join('');

  // ── the envelope ──────────────────────────────────────────────────────────
  /**
   * normaliseSchedule — the one place that decides what a stored schedule is.
   * Every import source hands its result through here, so a photo and an .ics
   * cannot drift into two shapes.
   */
  function normaliseSchedule(doc) {
    const d = doc || {};
    const now = new Date().toISOString();
    const srcIn = Array.isArray(d.sources) ? d.sources
      : (d.source ? [{ kind: d.source, importedAt: d.importedAt || now }] : []);
    const sources = srcIn.map((s, i) => ({
      id: String((s && s.id) || ('s' + i)),
      kind: String((s && s.kind) || 'manual'),
      label: String((s && s.label) || SCHEDULE_SOURCES[(s && s.kind)] || 'an import'),
      importedAt: String((s && s.importedAt) || now),
    }));
    const classes = (Array.isArray(d.classes) ? d.classes : []).map((c, i) => {
      const o = c || {};
      return {
        id: String(o.id || ('c' + i)),
        code: o.code == null ? null : String(o.code).toUpperCase(),
        room: o.room == null ? null : String(o.room),
        title: o.title == null ? null : String(o.title),
        instructor: o.instructor == null ? null : String(o.instructor),
        days: Array.isArray(o.days) ? o.days.map(String) : [],
        startMin: Number.isFinite(o.startMin) ? o.startMin : null,
        endMin: Number.isFinite(o.endMin) ? o.endMin : null,
        // WHY THIS IS NOT `resolved: true/false`. Eleven codes a real UT
        // schedule can name do not route in this build, and they are TWO
        // different problems, not one: ten sit at the Pickle campus ~11 km
        // north and are off this map for good, while SSW is a main-campus
        // building whose UT-surveyed door lands 0.4 m from a footprint this
        // app already draws — missing only a row in our register snapshot.
        // "Unknown code" and "real building, just not on this map" want
        // different sentences, and a boolean cannot tell them apart, so the
        // reason is stored as a string. Re-measured on this branch from
        // data/ut_buildings.json, the UT door table in §3 above and the drawn
        // snapshot; the numbers are in docs/si-privacy.md §7, and
        // docs/si-gaps.md (on origin/acer/si-gaps) reaches them independently.
        unroutableWhy: o.unroutableWhy == null ? null : String(o.unroutableWhy),
        // Reserved for OCR. An .ics sets 1; a photo will not.
        confidence: Number.isFinite(o.confidence) ? o.confidence : 1,
        // Reserved for OCR and for a future API: which source, and where in it.
        src: o.src == null ? (sources[0] ? sources[0].id : null) : String(o.src),
        provenance: o.provenance == null ? null : o.provenance,
      };
    });
    return {
      v: SCHEDULE_SCHEMA_VERSION,
      savedAt: now,
      term: d.term == null ? null : String(d.term),
      tz: d.tz == null ? null : String(d.tz),
      sources,
      classes,
    };
  }

  function migrateSchedule(raw) {
    let d = raw, guard = 0;
    while (d && Number(d.v) < SCHEDULE_SCHEMA_VERSION && guard++ < 16) {
      const step = SCHEDULE_MIGRATIONS[Number(d.v)];
      if (!step) return null;      // a gap in the chain is not a thing to guess at
      d = step(d);
    }
    return d;
  }

  // ── the egress guard ──────────────────────────────────────────────────────
  let schedWatch = [];             // lowercased strings that must never leave
  const schedGuard = {
    installed: false,
    armed: true,
    log: [],
    blocked: 0,
    checked: 0,
    quietChecked: 0,          // worker messages: counted, not individually logged
    inspectFailures: 0,
    unreadableBodies: 0,
    blockedOpaque: 0,          // of `blocked`, how many were refused unread
    opaqueWorkerLeaves: 0,     // payload nodes the walk could not read
    binaryLeaves: 0,           // ArrayBuffer/TypedArray leaves actually scanned
    binaryBytes: 0,            // ...and how many bytes that was
    truncatedScans: 0,         // payloads that ran out of the node budget
    scanThrows: 0,             // throws inside the worker-payload walk
    portChecked: 0,            // MessagePort/BroadcastChannel messages inspected
    workerCtors: 0,            // Worker/SharedWorker constructions seen
    bodyBytesScanned: 0,       // round 7: bytes of BINARY request body byte-scanned
    frameChecked: 0,           // round 7: window/iframe postMessage calls inspected
    swChecked: 0,              // round 7: ServiceWorker postMessage/register calls
    rtcChecked: 0,             // round 7: RTCDataChannel.send calls
    headersScanned: 0,         // round 8: requests whose headers were read
    unreadableHeaders: 0,      // round 8: header collections that would not enumerate
    encodedHits: 0,            // round 8: matches that needed the decode/encode retry
  };

  /** The stand-in "tokens" for the four ways the guard can refuse something it
   *  never actually read. They are not real watched strings, so they are never
   *  used as needles and never redacted as one — they exist so an unreadable
   *  thing travels the same refusal path as a real match and shows up in the
   *  log saying honestly what happened. The LEADING SPACE is what makes a
   *  collision impossible rather than unlikely: `buildWatchlist` only ever
   *  stores `s.trim().toLowerCase()`, so no watched token can begin with
   *  whitespace, so no schedule string can ever equal one of these however a
   *  student names their classes. */
  const EGRESS_OPAQUE_BODY = ' opaque-body';
  const EGRESS_OPAQUE_LEAF = ' opaque-leaf';
  const EGRESS_SCAN_TRUNCATED = ' scan-truncated';
  const EGRESS_SCAN_THREW = ' scan-threw';
  const EGRESS_OPAQUE_HEADERS = ' opaque-headers';   // round 8
  /** The one place that decides "is this a sentinel", so adding a fifth is one
   *  line and cannot be forgotten in the redactor or in the URL rewrite. */
  const EGRESS_SENTINELS = {
    [EGRESS_OPAQUE_BODY]: 'a body the guard could not read',
    [EGRESS_OPAQUE_LEAF]: 'a payload node the guard could not read',
    [EGRESS_SCAN_TRUNCATED]: 'a payload bigger than the guard can scan',
    [EGRESS_SCAN_THREW]: 'a payload that made the guard throw',
    [EGRESS_OPAQUE_HEADERS]: 'request headers the guard could not read',
  };

  /** Every string leaf in the schedule, long enough to be distinctive, plus
   *  the serialised blob itself and the `CODE ROOM` composites the router will
   *  be handed. Lowercased once here so the hot path is a plain indexOf. */
  function buildWatchlist(doc) {
    const out = new Set();
    const add = (s) => {
      if (typeof s !== 'string') return;
      const t = s.trim().toLowerCase();
      if (t.length >= SCHEDULE_STORE.minTokenLen) out.add(t);
    };
    const walk = (v) => {
      if (v == null) return;
      if (typeof v === 'string') return add(v);
      if (Array.isArray(v)) return v.forEach(walk);
      if (typeof v === 'object') return Object.keys(v).forEach(k => walk(v[k]));
    };
    walk(doc);
    for (const c of (doc && doc.classes) || []) {
      if (c.code && c.room) { add(c.code + ' ' + c.room); add(c.code + '-' + c.room); }
    }
    try { add(JSON.stringify(doc)); } catch (e) {}
    return Array.from(out);
  }

  /** The redaction the log itself needs, so reading the audit log is not a
   *  second copy of the leak. */
  const redactToken = (t) =>
    EGRESS_SENTINELS[t] || (t.slice(0, 2) + '…(' + t.length + ')');

  /**
   * WHAT SCANS ONE STRING, AND WHY IT IS A LOOP OF `indexOf` AND NOT A REGEX.
   *
   * A single compiled alternation `/tok1|tok2|.../i` looks like the obvious
   * win — one pass, no allocation — and it is the wrong primitive here. An
   * alternation has to try every branch at every start position, so on a
   * 60-character tile URL with ~22 branches it does over a thousand attempted
   * matches to conclude "no". `String.prototype.indexOf` is a single
   * vectorised substring search per token, and it is the operation V8 has
   * actually optimised. Two cheap gates come first and remove most of the work
   * outright: a haystack shorter than the shortest token cannot contain one,
   * and every token is stored pre-lowercased so the haystack is lowercased
   * exactly once per scan instead of once per token.
   *
   * `schedRe` is kept only as the "is anything watched" flag the hot paths
   * test, so there is one thing to check rather than two.
   */
  let schedRe = null;               // null == nothing stored == fast path
  let schedMinLen = Infinity;
  /** THE ONLY WRITER of `schedWatch`. The list, the flag and the shortest
   *  length must never disagree — a stale one of those is either a guard that
   *  blocks nothing or one that blocks the map. */
  function setWatchlist(list) {
    schedWatch = list || [];
    schedRe = schedWatch.length ? true : null;
    schedMinLen = Infinity;
    for (const t of schedWatch) if (t.length < schedMinLen) schedMinLen = t.length;
    buildBytePatterns(schedWatch);
  }

  // ── the byte scanner: a buffer is content, not a hole in the floor ─────────
  /**
   * WHY THIS EXISTS AT ALL, and why the obvious two answers are both wrong.
   *
   * `scanStructured()` used to have this line in it:
   *
   *     if (ArrayBuffer.isView(x) || x instanceof ArrayBuffer) return;
   *
   * — skip, no flag, nothing counted, with a comment claiming a buffer "cannot
   * hold a JS string". Round 5's critic wrote `encoder.encode(title).buffer`,
   * `postMessage`d it into a worker with the guard armed, and read the class
   * title back off a raw TCP socket. `blockedDelta: 0, opaqueDelta: 0`.
   *
   * OPTION A — BLOCK BINARY. Breaks the map on contact: measured, one cold
   * load of this city puts 4,742 `Uint8Array` leaves and 22.5 MB of real tile
   * bytes through this path.
   *
   * OPTION B — DECODE EACH BUFFER TO A STRING AND REUSE `scanForSchedule`.
   * Correct, and it allocates 22.5 MB of transient string per load and then
   * `toLowerCase()`s all of it into a second 22.5 MB. On the tile path.
   *
   * SO: match the token BYTES against the buffer bytes, allocating nothing.
   * One pass, no decode, no lowercase copy.
   *
   * THE PREFILTER IS TWO BYTES WIDE, AND THE HONEST VERSION OF WHY IS THAT
   * THREE SHAPES WERE MEASURED AND THIS ONE WON NARROWLY. A 256-entry table
   * keyed on one byte was the first try; a bit-packed 8 KB table was the
   * third. Cold-load minimums, three interleaved reps: 925 ms, **866 ms**,
   * and worse-than-both. The win is smaller than the reasoning predicted,
   * which is the usual result of reasoning about caches — §8 of
   * docs/si-privacy.md has the whole ledger including the two theories that
   * were wrong. Case folding is ASCII-only and happens only at verify time:
   * the mask carries all four case combinations of the leading pair, so the
   * hot loop never folds.
   *
   * TWO ENCODINGS, because there are two an honest bug produces: UTF-8 (what
   * `TextEncoder` emits, which is exactly how the critic did it) and UTF-16LE
   * (what a hand-rolled `charCodeAt` copy into a `Uint16Array` emits). Base64
   * and gzip are NOT covered and cannot be — see §9 of docs/si-privacy.md.
   */
  let schedByteMask = null;      // 65,536 bits packed into 8 KB, keyed (b0<<8)|b1
  let schedByteBuckets = null;   // Map: folded (b0<<8)|b1 -> [{ b, tok }]
  let schedMinPatLen = Infinity;

  function buildBytePatterns(tokens) {
    schedByteMask = null; schedByteBuckets = null; schedMinPatLen = Infinity;
    if (typeof TextEncoder === 'undefined' || !tokens || !tokens.length) return;
    const enc = new TextEncoder();
    // ONE BYTE PER ENTRY, 64 KB, and the two cheaper-looking alternatives were
    // both measured and both lost. A 256-entry table keyed on the first byte
    // alone fits in L1 but lights up ~10% of byte values with a real
    // watchlist, so one tile byte in ten pays for a bucket lookup. Packing
    // 65,536 entries into 8 KB of BITS fits L1 too, but the shift-and-mask per
    // byte costs more than the cache miss it avoids. Cold-load minimums, three
    // interleaved reps each: 256-entry 925 ms, 64 KB byte table 866 ms,
    // 8 KB bit table worse than both on the isolated benchmark.
    const mask = new Uint8Array(65536);
    const buckets = new Map();
    const upper = (c) => (c >= 97 && c <= 122) ? c - 32 : c;
    let min = Infinity;
    const addPat = (bytes, tok) => {
      if (bytes.length < SCHEDULE_STORE.minTokenLen) return;
      // The pattern comes from a lowercased token, so these are the lower-case
      // bytes; the buffer may hold either case of either of them.
      const f0 = bytes[0], f1 = bytes[1];
      const a0 = upper(f0) === f0 ? [f0] : [f0, upper(f0)];
      const a1 = upper(f1) === f1 ? [f1] : [f1, upper(f1)];
      for (let i = 0; i < a0.length; i++) {
        for (let j = 0; j < a1.length; j++) mask[(a0[i] << 8) | a1[j]] = 1;
      }
      const key = (f0 << 8) | f1;
      let bs = buckets.get(key);
      if (!bs) { bs = []; buckets.set(key, bs); }
      bs.push({ b: bytes, tok });
      if (bytes.length < min) min = bytes.length;
    };
    // BOTH ENCODINGS OF ONE FORM OF ONE TOKEN. Deduped per token, because the
    // percent-encoded form of a token that needs no escaping IS the token.
    const seenForms = new Set();
    const addForm = (s, tok) => {
      if (!s) return;
      const k = tok + '\u0000' + s;
      if (seenForms.has(k)) return;
      seenForms.add(k);
      addPat(enc.encode(s), tok);
      const u16 = new Uint8Array(s.length * 2);
      for (let i = 0; i < s.length; i++) {
        const cp = s.charCodeAt(i);
        u16[i * 2] = cp & 0xff;
        u16[i * 2 + 1] = (cp >> 8) & 0xff;
      }
      addPat(u16, tok);
    };
    for (const t of tokens) {
      const s = t.length > SCHEDULE_STORE.binaryPatternChars
        ? t.slice(0, SCHEDULE_STORE.binaryPatternChars) : t;
      addForm(s, t);
      // ── ENCODE THE NEEDLE, NEVER DECODE THE HAYSTACK ────────────────────
      // Round 8's probe put `new TextEncoder().encode(encodeURIComponent(
      // title)).buffer` through a worker with the guard armed and it crossed
      // at `blocked: 0` — the string path now retries decoded, but the byte
      // path cannot: percent-decoding 120 MB of real tile bytes per load to
      // look for a needle is not a thing to do on the tile path.
      //
      // So the needle carries the encodings instead. It costs nothing at scan
      // time — the hot loop is byte-identical, there are just more entries in
      // a bucket — and it costs almost nothing in the PREFILTER either,
      // because `encodeURIComponent` leaves letters alone: the encoded form of
      // a class title starts with the same two bytes as the title, so no new
      // mask bit is lit. Only a token that starts with a character needing an
      // escape adds one.
      if (SCHEDULE_STORE.scanEncodedForms) {
        let pct = null;
        try { pct = encodeURIComponent(s); } catch (e) { pct = null; }   // lone surrogate
        if (pct) { addForm(pct, t); addForm(pct.replace(/%20/g, '+'), t); }
        addForm(s.replace(/ /g, '+'), t);
      }
    }
    schedByteMask = mask; schedByteBuckets = buckets; schedMinPatLen = min;
  }

  /** The matched token, or null. Allocates nothing. */
  function scanBytesForSchedule(u8) {
    const mask = schedByteMask;
    if (!mask) return null;
    const n = u8.length;
    if (n < schedMinPatLen) return null;
    const buckets = schedByteBuckets;
    const last = n - schedMinPatLen;
    let b0 = u8[0];
    for (let i = 0; i <= last; i++) {
      const b1 = u8[i + 1];
      if (mask[(b0 << 8) | b1] !== 0) {
        const f0 = (b0 >= 65 && b0 <= 90) ? b0 + 32 : b0;
        const f1 = (b1 >= 65 && b1 <= 90) ? b1 + 32 : b1;
        const bs = buckets.get((f0 << 8) | f1);
        if (bs !== undefined) {
          for (let k = 0; k < bs.length; k++) {
            const pb = bs[k].b, m = pb.length;
            if (i + m > n) continue;
            let j = 2;
            for (; j < m; j++) {
              const d = u8[i + j];
              if (((d >= 65 && d <= 90) ? d + 32 : d) !== pb[j]) break;
            }
            if (j === m) return bs[k].tok;
          }
        }
      }
      b0 = b1;
    }
    return null;
  }

  /** THE RAW SUBSTRING TEST. Private on purpose — see `scanForSchedule` below
   *  for why there is no second exported way to scan a string. Assumes a real
   *  string and a non-empty watchlist; both are checked by its one caller. */
  function scanRawForSchedule(s) {
    if (s.length < schedMinLen) return null;
    const h = s.toLowerCase();
    for (let i = 0; i < schedWatch.length; i++) {
      const t = schedWatch[i];
      if (t.length <= h.length && h.indexOf(t) !== -1) return t;
    }
    return null;
  }

  /**
   * THE ONLY WAY TO SCAN A STRING, and being the only way is the fix.
   *
   * Round 6 found that a percent-encoded canary does not contain the canary:
   * `fetch('/collect?t=' + encodeURIComponent(title))` and a `URLSearchParams`
   * form body both sailed past an armed guard, because
   * `Zygomorphic%20Percussion%20Seminar` does not contain `zygomorphic
   * percussion seminar`. It fixed that — in a SECOND function,
   * `scanTextForSchedule`, and wired that function to the URL and body paths.
   *
   * `scanStructured()`'s string leaf kept calling the raw one. So did
   * `inspectPayload`'s top-level string branch, and the `RegExp`, `Error` and
   * boxed-`String` branches of the walk. Round 8 fired ten shapes of encoded
   * string into a worker with the guard armed and **all ten crossed at
   * `blocked: 0, opaque: 0`** — uncounted and unlogged — with six of them
   * landing the class title on a raw TCP socket verbatim after the worker
   * decoded them. Same defect as round 7's byte scanner: a correct check wired
   * to one of the two doors.
   *
   * THE STRUCTURAL FIX IS NOT "WIRE THE OTHER DOOR TOO", because that leaves a
   * third door for round 9. It is that there is now exactly one function
   * anybody can call to ask "does this string carry the schedule", and it does
   * the whole job. The raw test still exists, is not exported, and is called
   * from precisely one place: this function's own retry.
   *
   * COSTS NOTHING ON THE HOT PATH. Every URL this app fetches is a plain
   * relative path (`data/tiles/roads.pmtiles`) and every string leaf MapLibre
   * puts through a worker payload is a layer id or a source name, so the
   * `%`/`+` gate is false for all of them and no decode is ever attempted.
   * Only a string that actually looks encoded pays for a decoded copy.
   *
   * ONE LEVEL OF DECODE, said plainly: `%2520` (double-encoded) is not caught,
   * for the same reason base64 is not — see §9 of docs/si-privacy.md. One level
   * is what an honest bug produces, because one level is what
   * `encodeURIComponent` does.
   */
  function scanForSchedule(hay) {
    if (!schedRe || !hay) return null;
    const s = typeof hay === 'string' ? hay : String(hay);
    const hit = scanRawForSchedule(s);
    if (hit) return hit;
    const pct = s.indexOf('%') !== -1, plus = s.indexOf('+') !== -1;
    if (!pct && !plus) return null;
    if (pct) {
      // A malformed escape is not a reason to stop guarding the rest.
      try {
        const h = scanRawForSchedule(decodeURIComponent(s));
        if (h) { schedGuard.encodedHits++; return h; }
      } catch (e) {}
    }
    if (plus) {
      const spaced = s.replace(/\+/g, ' ');
      try {
        const h = scanRawForSchedule(pct ? decodeURIComponent(spaced) : spaced);
        if (h) { schedGuard.encodedHits++; return h; }
      } catch (e) {}
    }
    return null;
  }

  /**
   * scanStructured — walk a structured-clone payload and decide, for EVERY
   * node in it, one of exactly three things: it is clear, it carries the
   * schedule, or the guard could not read it. There is no fourth answer and in
   * particular there is no "skip".
   *
   * ROUND 6 INVERTED THE DEFAULT, and that is the whole change. The old walk
   * was an open-by-default `for (const k in x)` with a growing list of special
   * cases bolted onto the front — skip buffers, flag `Blob`, flag
   * `ReadableStream` — so every round shut the one shape that had been
   * demonstrated and left the next one open. A `Blob` has no own enumerable
   * properties, so a `for...in` walk reports a clean `hit: null` on one; so
   * does a `Map`, a `Set`, a `RegExp`, an `Error`, an `ImageData`, and every
   * host object nobody has written yet. Enumerating them is a losing game.
   *
   * So the walk now recognises a CLOSED list of node kinds it can genuinely
   * read, reads them, and every other object falls into a default branch that
   * sets `opaque`. Adding a new cloneable type to the platform can make this
   * guard over-refuse; it cannot make it under-refuse. That direction is the
   * point.
   *
   * BINARY IS SCANNED, NOT SKIPPED AND NOT BLOCKED. The line that used to read
   * `if (ArrayBuffer.isView(x) || x instanceof ArrayBuffer) return;` is how a
   * class title went through a worker and onto a socket. Blocking the shape
   * instead is not available: MapLibre moves 22.5 MB of genuine tile bytes
   * through this exact path on one cold load. `scanBytesForSchedule()` above
   * tells the two apart by looking at the bytes.
   *
   * `truncated` IS NOT COSMETIC. The old walk returned `complete: false` when
   * it ran out of nodes and every caller dropped it on the floor — and 21 of
   * this app's own messages per cold load exceed the old 4,000-node cap. Those
   * payloads were not inspected and nothing said so. Running out of budget is
   * now a refusal, exactly like a node the walk cannot read.
   */
  /**
   * ONE WALK FUNCTION, MODULE-LEVEL, WITH ITS STATE BESIDE IT.
   *
   * IT WAS HOISTED HERE ON A THEORY THAT TURNED OUT TO BE WRONG, and that is
   * worth leaving written down so nobody re-derives it. The walk used to be a
   * closure declared inside `scanStructured`, i.e. a fresh function object per
   * message, and the guard was costing ~30 µs per message on top of the byte
   * scan. The theory was that V8 could never keep a per-call closure hot.
   * Measured before and after: **no difference at all** (215 ms → 216 ms on
   * the same 5,000-message benchmark). The per-message cost is the walk and
   * the scan doing real work, not allocation.
   *
   * It stays hoisted because it is the better shape — one function, one place
   * to read, no allocation per message — not because it was faster. Not
   * re-entrant, and it does not need to be: every caller is synchronous and
   * single-threaded, and the walk contains no `await` and no callback into
   * anything that could re-enter it.
   */
  let swHit = null, swOpaque = false, swTrunc = false;
  let swNodes = 0, swMaxNodes = 0, swBudget = 0, swBinLeaves = 0, swBinBytes = 0;
  const HAS_OWN = Object.prototype.hasOwnProperty;

  /** A view onto a buffer's bytes, or null if there is no reading it (a
   *  detached buffer, a length-tracking view whose backing store has gone).
   *  null takes the opaque path — never the "nothing there, carry on" path. */
  function scanBytesOf(x) {
    try {
      if (x instanceof ArrayBuffer) return new Uint8Array(x);
      if (typeof SharedArrayBuffer !== 'undefined' && x instanceof SharedArrayBuffer) {
        return new Uint8Array(x);
      }
      return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
    } catch (e) { return null; }
  }

  function scanWalk(x) {
    if (swHit !== null || swTrunc) return;
    if (swNodes++ >= swMaxNodes) { swTrunc = true; return; }
    if (x == null) return;
    const t = typeof x;
    if (t === 'string') { swHit = scanForSchedule(x); return; }
    if (t !== 'object') return;                // number, boolean, bigint, symbol

    // -- the two shapes that are 99% of real traffic, tested first ----------
    //
    // ROUND 7'S FINDING, AND IT IS THE SAME BUG ROUND 6 THOUGHT IT HAD FIXED.
    // This branch used to read `for (let i = 0; i < x.length; i++)`. An index
    // loop is not what a structured clone does to an array: the clone walks
    // `EnumerableOwnPropertyNames`, so `a.note = classTitle` on an ordinary
    // array **crosses into the worker** and an index loop never looks at it.
    // Measured, not argued — `structuredClone([1,2,3] with .note)` carries the
    // canary, the worker read it back, and it landed on a raw TCP socket with
    // the guard armed at `blocked: 0, opaque: 0`. Uncounted and unlogged: the
    // exact failure round 6 set out to make impossible, sitting inside the one
    // branch round 6 declared fully read.
    //
    // Round 6 fixed *which kinds the walk recognises* and left *what reading a
    // kind means* alone. So the rule now is the one the platform itself uses:
    // for every kind this walk claims to read, it reads exactly what the clone
    // algorithm reads. For `Array` and for a plain object that is the same
    // thing — own enumerable properties — so they are the same loop, and an
    // array is no longer the odd one out that was optimised into being wrong.
    // The cost of that is real and is written down in docs/si-privacy.md §8.
    if (Array.isArray(x)) {
      for (const k in x) {
        if (swHit !== null || swTrunc) return;
        if (HAS_OWN.call(x, k)) scanWalk(x[k]);
      }
      return;                                   // an array IS fully read
    }
    const proto = Object.getPrototypeOf(x);
    if (proto === Object.prototype || proto === null) {
      // No per-property try/catch here. A throwing accessor on a plain object
      // is caught by `inspectPayload`, which FAILS CLOSED — same refusal, and
      // a try/catch in this loop is 99% of the traffic paying for the 0.001%.
      for (const k in x) {
        if (swHit !== null || swTrunc) return;
        if (HAS_OWN.call(x, k)) scanWalk(x[k]);
      }
      return;                                   // a plain object IS fully read
    }

    // -- binary: read the bytes --------------------------------------------
    if (ArrayBuffer.isView(x) || x instanceof ArrayBuffer ||
        (typeof SharedArrayBuffer !== 'undefined' && x instanceof SharedArrayBuffer)) {
      const u8 = scanBytesOf(x);
      if (u8 === null) { swOpaque = true; return; }
      swBudget -= u8.length;
      if (swBudget < 0) { swOpaque = true; return; }
      swBinLeaves++; swBinBytes += u8.length;
      const h = scanBytesForSchedule(u8);
      if (h) swHit = h;
      return;
    }

    // -- the built-ins a `for...in` walk is blind to ------------------------
    if (typeof Map !== 'undefined' && x instanceof Map) {
      for (const pair of x) {
        if (swHit !== null || swTrunc) return;
        scanWalk(pair[0]); scanWalk(pair[1]);
      }
      return;
    }
    if (typeof Set !== 'undefined' && x instanceof Set) {
      for (const val of x) { if (swHit !== null || swTrunc) return; scanWalk(val); }
      return;
    }
    if (x instanceof Date) return;              // a timestamp holds no text
    if (x instanceof RegExp) { swHit = scanForSchedule(x.source); return; }
    if (x instanceof Error) {
      swHit = scanForSchedule(String(x.message || '')) ||
              scanForSchedule(String(x.stack || ''));
      return;
    }
    if (x instanceof String) { swHit = scanForSchedule(String(x)); return; }
    if (x instanceof Number || x instanceof Boolean) return;

    // -- a class instance: read what it actually exposes --------------------
    let seen = 0;
    for (const k in x) {
      if (swHit !== null || swTrunc) return;
      if (!HAS_OWN.call(x, k)) continue;
      seen++;
      scanWalk(x[k]);
    }

    // -- THE DEFAULT, AND THE POINT OF THE WHOLE REWRITE --------------------
    // Nothing above recognised this, and it exposed no own enumerable
    // property to read. That is exactly what a `Blob`, a `File`, an
    // `ImageData`, an `ImageBitmap` and a type invented next year all look
    // like from here. It is reported as unread rather than as clear, and the
    // caller decides. Measured cost on this app: zero — a census of a full
    // cold load found only `Object`, `Array` and `Uint8Array` crossing this
    // boundary, and not one object with no own enumerable properties.
    if (seen === 0) swOpaque = true;
  }

  function scanStructured(v, limits) {
    swHit = null; swOpaque = false; swTrunc = false;
    swNodes = 0; swBinLeaves = 0; swBinBytes = 0;
    swMaxNodes = (limits && limits.nodes) || SCHEDULE_STORE.workerScanNodes;
    swBudget = (limits && limits.bytes) || SCHEDULE_STORE.binaryScanBytes;
    scanWalk(v);
    return { hit: swHit, opaque: swOpaque, truncated: swTrunc,
             binLeaves: swBinLeaves, binBytes: swBinBytes, nodes: swNodes };
  }

  /** Best-effort synchronous text of a request body. Returns `''` for a body
   *  that is genuinely absent, and `undefined` for one that EXISTS but cannot
   *  be read without going async (a Blob, a ReadableStream, a buffer past
   *  `maxBytes`). The caller must keep those two apart: `''` clears the
   *  request, `undefined` refuses it while a schedule is stored. */
  /** "This call HAS a body and it is not here to be read" — a `Request`'s
   *  `ReadableStream`, or a `FormData` that would not build. Distinct from
   *  `null`/absent, which clears the request. `bodyToText` maps it to
   *  `undefined`, which is the refusal path. */
  const BODY_UNREADABLE = { __wfUnreadable: true };

  function bodyToText(b) {
    if (b === BODY_UNREADABLE) return undefined;
    if (b == null) return '';
    if (typeof b === 'string') return b;
    if (typeof URLSearchParams !== 'undefined' && b instanceof URLSearchParams) return b.toString();
    if (typeof FormData !== 'undefined' && b instanceof FormData) {
      let s = '';
      for (const pair of b.entries()) s += pair[0] + '=' + (typeof pair[1] === 'string' ? pair[1] : '[file]') + '&';
      return s;
    }
    if (typeof ArrayBuffer !== 'undefined' && (b instanceof ArrayBuffer || ArrayBuffer.isView(b))) {
      try {
        const u8 = b instanceof ArrayBuffer ? new Uint8Array(b) : new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
        if (u8.length > SCHEDULE_STORE.maxBytes) return undefined;
        return new TextDecoder('utf-8', { fatal: false }).decode(u8);
      } catch (e) { return undefined; }
    }
    return undefined;   // Blob, ReadableStream, anything else
  }

  /**
   * THE BYTES OF A BINARY BODY, so a request body gets the same two-encoding
   * scan a worker payload already got. null for a body that is not binary.
   *
   * ROUND 7 FOUND THIS BY FIRING AT ITS OWN SOCKET, and it is the other half of
   * the array bug: round 6 built `scanBytesForSchedule()` — UTF-8 *and*
   * UTF-16LE, the two encodings an honest bug produces — and then wired it to
   * exactly one of the two doors. `bodyToText()` decodes a binary body as UTF-8
   * and nothing else, so
   *
   *     fetch(url, { body: utf16leBufferOfTheClassTitle })
   *
   * came back `204` off a bare TCP listener with the guard armed and
   * `blocked: 0`, while the *same title* UTF-8-encoded was refused. A guard
   * that is encoding-complete on the worker path and encoding-blind on the
   * network path is not a guard, it is a coin flip about which door gets used.
   *
   * Costs nothing here: every request this app makes is a bodyless GET, so
   * `bodyBytes()` returns null for all of them and the scan never runs. And a
   * binary body over `maxBytes` is already refused unread by `bodyToText()`
   * returning `undefined`, so the bytes this ever sees are at most 256 KB.
   */
  function bodyBytes(b) {
    if (b == null || typeof b === 'string') return null;
    if (typeof ArrayBuffer === 'undefined') return null;
    try {
      if (b instanceof ArrayBuffer) return new Uint8Array(b);
      if (ArrayBuffer.isView(b)) return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    } catch (e) { return null; }
    return null;
  }

  /**
   * inspectPayload — the ONE inspection every structured-clone channel goes
   * through, so `Worker.postMessage`, `MessagePort.postMessage` and
   * `BroadcastChannel.postMessage` cannot end up with three different
   * definitions of "clear". Returns the token to refuse on, or null.
   *
   * Its own inline shape rather than a trip through `inspect()`, because
   * `inspect()` builds a log line and a MapLibre tile load is 2,545 of these.
   * Counted always, logged only when it actually matters.
   */
  function inspectPayload(via, msg) {
    schedGuard.checked++; schedGuard.quietChecked++;
    let hit = null;
    try {
      if (typeof msg === 'string') {
        hit = scanForSchedule(msg);
      } else {
        const r = scanStructured(msg);
        hit = r.hit;
        if (r.binLeaves) { schedGuard.binaryLeaves += r.binLeaves; schedGuard.binaryBytes += r.binBytes; }
        if (r.truncated) schedGuard.truncatedScans++;
        if (r.opaque) schedGuard.opaqueWorkerLeaves++;
        // Counted ALWAYS, refused only if the policy says so, so the counts
        // stay a real measurement of this app's own traffic rather than a
        // number the policy shaped.
        if (!hit && SCHEDULE_STORE.blockOpaqueWorkerLeaves) {
          if (r.truncated) hit = EGRESS_SCAN_TRUNCATED;
          else if (r.opaque) hit = EGRESS_OPAQUE_LEAF;
        }
      }
    } catch (e) {
      // FAILS CLOSED HERE, unlike the network paths. A throw on the way into a
      // worker is indistinguishable from a payload built to cause one, and
      // refusing a worker message cannot stop a tile downloading the way a
      // broken `fetch` wrapper could. `SCHEDULE_STORE.failClosedOnScanError`
      // is the one-line way back.
      schedGuard.scanThrows++; schedGuard.inspectFailures++;
      hit = SCHEDULE_STORE.failClosedOnScanError ? EGRESS_SCAN_THREW : null;
    }
    if (hit && schedGuard.armed) {
      schedGuard.blocked++;
      if (EGRESS_SENTINELS[hit]) schedGuard.blockedOpaque++;
      noteEgress(via, 'POST', '[' + via + ']', hit, true, -1);
      return hit;
    }
    return null;
  }

  function noteEgress(via, method, url, hit, blocked, bytes) {
    if (schedGuard.log.length >= SCHEDULE_STORE.logCap) schedGuard.log.shift();
    let u = String(url == null ? '' : url);
    // The sentinel is not a needle — it never appeared in the URL, so there is
    // nothing in the URL to redact and building a regex for it is pure waste
    // on a path that also runs for ordinary traffic.
    if (hit && !EGRESS_SENTINELS[hit]) {
      const re = new RegExp(hit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      u = u.replace(re, '[REDACTED]');
    }
    schedGuard.log.push({
      t: Math.round(performance.now()),
      via, method: method || 'GET', url: u,
      bytes: bytes == null ? 0 : bytes,
      watched: schedWatch.length,
      blocked: !!blocked,
      matched: hit ? redactToken(hit) : null,
    });
  }

  /**
   * The one decision. Returns the matched token, or null to let it through.
   *
   * `quiet` MEANS "COUNT IT, DO NOT WRITE A LOG LINE FOR IT" — and it is a
   * measured fix, not a style choice. The first version logged every call, and
   * `Worker.postMessage` is MapLibre's per-tile path: 4,000 messages measured
   * at 47 µs each over the unguarded baseline, and most of that was the log
   * entry — a `performance.now()`, an object, and a `shift()` off a full ring
   * buffer, per tile. The log exists to audit egress to the NETWORK, where the
   * traffic is tens of requests and every line is worth having. A worker
   * message still gets counted, and still gets a log line the moment it
   * actually matches, which is the only worker message anyone would ever read.
   */
  /**
   * `raw` IS THE BODY AS THE CALLER HAD IT, not a string the caller already
   * flattened — round 7's change, and the reason is in `bodyBytes()` above.
   * Flattening in the caller is what let a UTF-16LE buffer body reach the wire:
   * by the time `inspect` saw it, it was already mojibake. It converts here now
   * so there is one place that decides what a body is, and binary reaches the
   * byte scanner instead of only the UTF-8 decoder.
   */
  /**
   * ROUND 8 — HEADERS. `headerSources` is always a LIST of places a request's
   * headers can come from, never one of them, because a `fetch(new Request(u,
   * {headers}), {headers})` has two and picking either one is how this class of
   * bug happens in the first place. Each entry may be a `Headers`, a plain
   * object, an array of pairs, a pre-flattened string, or null.
   *
   * A collection that will not enumerate returns `undefined`, which is the
   * refusal path — the same rule an unreadable body got in round 5.
   */
  function oneHeaderSourceToText(h) {
    if (h == null) return '';
    if (typeof h === 'string') return h;
    if (typeof Headers !== 'undefined' && h instanceof Headers) {
      let s = '';
      for (const p of h) s += p[0] + ': ' + p[1] + '\n';
      return s;
    }
    if (Array.isArray(h)) {
      let s = '';
      for (const p of h) s += String(p && p[0]) + ': ' + String(p && p[1]) + '\n';
      return s;
    }
    if (typeof h === 'object') {
      let s = '';
      for (const k in h) if (HAS_OWN.call(h, k)) s += k + ': ' + String(h[k]) + '\n';
      return s;
    }
    return String(h);
  }
  function headerSourcesToText(list) {
    if (!list || !list.length) return '';
    let s = '';
    try { for (let i = 0; i < list.length; i++) s += oneHeaderSourceToText(list[i]); }
    catch (e) { return undefined; }
    return s;
  }

  function inspect(via, method, url, raw, quiet, headerSources) {
    schedGuard.checked++;
    if (quiet) schedGuard.quietChecked++;
    if (!schedWatch.length) { if (!quiet) noteEgress(via, method, url, null, false, 0); return null; }
    let hit = null;
    let body;
    try {
      body = bodyToText(raw);
      hit = scanForSchedule(url);
      if (!hit && SCHEDULE_STORE.scanRequestHeaders && headerSources && headerSources.length) {
        const ht = headerSourcesToText(headerSources);
        if (ht === undefined) {
          schedGuard.unreadableHeaders++;
          if (SCHEDULE_STORE.blockUnreadableHeaders) hit = EGRESS_OPAQUE_HEADERS;
        } else if (ht) {
          schedGuard.headersScanned++;
          hit = scanForSchedule(ht);
        }
      }
      if (body === undefined) {
        // UNREADABLE IS NOT THE SAME AS EMPTY, and treating it as empty is the
        // hole round 4's critic drove a Blob through. While a schedule is
        // stored, a body the guard cannot read is a body it cannot clear.
        schedGuard.unreadableBodies++;
        if (!hit && SCHEDULE_STORE.blockUnreadableBodies) hit = EGRESS_OPAQUE_BODY;
      } else if (!hit) {
        hit = scanForSchedule(body);
        // ...and the same bytes again, in the encodings a decode cannot reach.
        if (!hit) {
          const u8 = bodyBytes(raw);
          if (u8) { schedGuard.bodyBytesScanned += u8.length; hit = scanBytesForSchedule(u8); }
        }
      }
    } catch (e) {
      // FAIL OPEN, AND COUNT IT. A throw in here must not be able to stop the
      // map loading; the audit asserts this counter is zero, which is where a
      // broken inspector actually gets caught.
      schedGuard.inspectFailures++;
      if (!quiet) noteEgress(via, method, url, null, false, 0);
      return null;
    }
    const block = !!(hit && schedGuard.armed);
    if (!quiet || hit) {
      noteEgress(via, method, url, hit, block, body === undefined ? -1 : String(body || '').length);
    }
    if (block) {
      schedGuard.blocked++;
      if (EGRESS_SENTINELS[hit]) schedGuard.blockedOpaque++;
    }
    return block ? hit : null;
  }

  function egressError(via, hit) {
    return new Error('[wayfind] blocked: ' + via + ' carried stored schedule content (' +
      redactToken(hit) + '). The schedule never leaves this device.');
  }

  /**
   * Wrap the two egress doors inside a Window this page has a handle on — a
   * same-origin iframe, or whatever `window.open` handed back. See
   * `SCHEDULE_STORE.guardChildFrames` for why patching our own realm is not
   * enough. Idempotent via a mark ON THAT REALM'S OWN window, so re-reading
   * `contentWindow` in a loop costs one property read.
   *
   * WHAT IT DOES NOT CLAIM: a child realm can mint its own child, and this
   * only follows references that pass through THIS page. It is the same kind
   * of seatbelt as the rest of §12 — it makes an honest mistake fail loudly,
   * and it is not a sandbox. docs/si-privacy.md §9 says so in the same words.
   */
  const CHILD_REALM_MARK = '__wfEgressGuarded';
  function guardChildRealm(w) {
    if (!w) return false;
    try {
      if (w[CHILD_REALM_MARK]) return true;
      const pm = w.postMessage;
      if (typeof pm !== 'function') return false;
      w.postMessage = function (msg) {
        if (schedRe) {
          schedGuard.frameChecked++;
          const hit = inspectPayload('childframe.postMessage', msg);
          if (hit) throw egressError('child frame postMessage', hit);
        }
        return pm.apply(w, arguments);
      };
      if (typeof w.fetch === 'function') {
        const of = w.fetch;
        w.fetch = function (input, init) {
          if (schedWatch.length) {
            const isReq = !!(w.Request && input instanceof w.Request);
            const url = isReq ? input.url : String(input);
            const method = (init && init.method) || (isReq && input.method) || 'GET';
            let raw = init ? init.body : null;
            if (isReq && raw == null && input.body) raw = BODY_UNREADABLE;
            const hit = inspect('childframe.fetch', method, url, raw, false,
              [init ? init.headers : null, isReq ? input.headers : null]);
            if (hit) return Promise.reject(egressError('child frame fetch', hit));
          }
          return of.apply(w, arguments);
        };
      }
      w[CHILD_REALM_MARK] = true;
      return true;
    } catch (e) {
      // Cross-origin. The assignment throws SecurityError, which is the
      // browser telling us the thing we were worried about cannot happen
      // through this handle either.
      return false;
    }
  }

  function installEgressGuard() {
    if (schedGuard.installed) return;
    schedGuard.installed = true;

    // fetch ────────────────────────────────────────────────────────────────
    if (typeof window.fetch === 'function') {
      const orig = window.fetch;
      window.fetch = function (input, init) {
        // FAST PATH. With nothing stored there is nothing to scan, and this is
        // the path every tile in the city takes.
        if (!schedWatch.length) return orig.apply(this, arguments);
        const isReq = (typeof Request !== 'undefined' && input instanceof Request);
        const url = isReq ? input.url : String(input);
        const method = (init && init.method) || (isReq && input.method) || 'GET';
        let raw = init ? init.body : null;
        if (isReq && raw == null && input.body) raw = BODY_UNREADABLE;   // stream
        // BOTH header sources, because a `Request` carries its own and `init`
        // can add more, and the wire gets the union of them.
        const hit = inspect('fetch', method, url, raw, false,
          [init ? init.headers : null, isReq ? input.headers : null]);
        if (hit) return Promise.reject(egressError('fetch', hit));
        return orig.apply(this, arguments);
      };
    }

    // XMLHttpRequest ───────────────────────────────────────────────────────
    if (typeof XMLHttpRequest !== 'undefined') {
      const op = XMLHttpRequest.prototype.open, sd = XMLHttpRequest.prototype.send;
      const srh = XMLHttpRequest.prototype.setRequestHeader;
      XMLHttpRequest.prototype.open = function (m, u) {
        this.__wfM = m; this.__wfU = u; this.__wfH = '';   // a reused XHR starts clean
        return op.apply(this, arguments);
      };
      // XHR has no header collection to read at `send` time — the only record
      // of what was set is the calls that set it, so keep one. Gated on a
      // schedule being stored, so an app with none pays nothing.
      if (typeof srh === 'function') {
        XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
          if (schedWatch.length && SCHEDULE_STORE.scanRequestHeaders) {
            this.__wfH = (this.__wfH || '') + String(k) + ': ' + String(v) + '\n';
          }
          return srh.apply(this, arguments);
        };
      }
      XMLHttpRequest.prototype.send = function (b) {
        if (schedWatch.length) {
          const hit = inspect('xhr', this.__wfM, this.__wfU, b, false, [this.__wfH]);
          if (hit) throw egressError('XMLHttpRequest', hit);
        }
        return sd.apply(this, arguments);
      };
    }

    // sendBeacon ───────────────────────────────────────────────────────────
    if (navigator && typeof navigator.sendBeacon === 'function') {
      const orig = navigator.sendBeacon.bind(navigator);
      navigator.sendBeacon = function (u, d) {
        if (schedWatch.length && inspect('sendBeacon', 'POST', u, d)) return false;
        return orig(u, d);
      };
    }

    // WebSocket ────────────────────────────────────────────────────────────
    if (typeof window.WebSocket === 'function') {
      const OrigWS = window.WebSocket;
      class GuardedWebSocket extends OrigWS {
        constructor(url, protocols) {
          if (schedWatch.length) {
            // Report the token that actually matched. The literal 'url' this
            // used to pass rendered in the thrown message as `ur…(3)`, which
            // tells the reader nothing about what was caught.
            //
            // ROUND 8: the SUBPROTOCOLS are on the wire too. They travel as
            // `Sec-WebSocket-Protocol` in the opening handshake, and this
            // passed `''` for the body and never looked at them. Same family
            // as the request headers below — a string argument that reaches
            // the network and nothing read it.
            const h = inspect('websocket', 'OPEN', url,
              protocols == null ? '' :
              (Array.isArray(protocols) ? protocols.join(',') : String(protocols)));
            if (h) throw egressError('WebSocket', h);
          }
          super(url, protocols);
        }
        send(data) {
          if (schedWatch.length) {
            const hit = inspect('websocket', 'SEND', this.url, data);
            if (hit) throw egressError('WebSocket.send', hit);
          }
          return super.send(data);
        }
      }
      window.WebSocket = GuardedWebSocket;
    }

    // EventSource ──────────────────────────────────────────────────────────
    if (typeof window.EventSource === 'function') {
      const OrigES = window.EventSource;
      class GuardedEventSource extends OrigES {
        constructor(url, cfg) {
          if (schedWatch.length) {
            const h = inspect('eventsource', 'OPEN', url, '');
            if (h) throw egressError('EventSource', h);
          }
          super(url, cfg);
        }
      }
      window.EventSource = GuardedEventSource;
    }

    // every structured-clone door into a worker ────────────────────────────
    // THESE ARE THE ONES THAT CLOSE THE HOLE. The guard is main-thread, and
    // MapLibre does its tile fetching inside workers where it cannot reach. So
    // instead of trying to follow the bytes into the worker, it stops schedule
    // bytes from ever getting in — and "the door" means every door, not the
    // one door a critic happened to knock on.
    //
    // `MessagePort` and `BroadcastChannel` are here because a `MessagePort`
    // transferred into a worker carries structured clones without ever
    // touching `Worker.prototype.postMessage`, which would have been the
    // round-7 finding. Measured cost of guarding them: exactly zero — a full
    // cold load of this city makes 0 `MessagePort.postMessage` calls and 0
    // `BroadcastChannel.postMessage` calls.
    if (typeof Worker !== 'undefined' && Worker.prototype && Worker.prototype.postMessage) {
      const pm = Worker.prototype.postMessage;
      Worker.prototype.postMessage = function (msg) {
        if (schedRe) {
          const hit = inspectPayload('worker.postMessage', msg);
          if (hit) throw egressError('Worker.postMessage', hit);
        }
        return pm.apply(this, arguments);
      };
    }
    if (typeof MessagePort !== 'undefined' && MessagePort.prototype && MessagePort.prototype.postMessage) {
      const pm = MessagePort.prototype.postMessage;
      MessagePort.prototype.postMessage = function (msg) {
        if (schedRe) {
          schedGuard.portChecked++;
          const hit = inspectPayload('port.postMessage', msg);
          if (hit) throw egressError('MessagePort.postMessage', hit);
        }
        return pm.apply(this, arguments);
      };
    }
    if (typeof BroadcastChannel !== 'undefined' && BroadcastChannel.prototype && BroadcastChannel.prototype.postMessage) {
      const pm = BroadcastChannel.prototype.postMessage;
      BroadcastChannel.prototype.postMessage = function (msg) {
        if (schedRe) {
          schedGuard.portChecked++;
          const hit = inspectPayload('broadcast.postMessage', msg);
          if (hit) throw egressError('BroadcastChannel.postMessage', hit);
        }
        return pm.apply(this, arguments);
      };
    }

    // the doors round 7 found still open ───────────────────────────────────
    // Round 6 closed every structured-clone door it could name and wrote that
    // `MessagePort`/`BroadcastChannel` "would have been the round-7 finding".
    // It was half right. These four were still unwrapped, and the channel
    // matrix caught them the cheap way: fire at each one with the guard armed
    // and read `checked` before and after. All four came back `checked: 0` —
    // not "allowed", *never looked at*, which is the same reading the
    // ArrayBuffer leak gave in round 5.
    //
    // None of them is exotic. `window.parent.postMessage(schedule, '*')` hands
    // the term to whatever page has this app in an iframe, and this app is a
    // public URL anyone can frame. A `ServiceWorker` has its own `fetch` and
    // outlives the tab. An `RTCDataChannel` is a socket with a different name.
    //
    // MEASURED COST: zero. A cold load of this city makes 0 calls to any of
    // the four (`frameChecked`/`swChecked`/`rtcChecked` all 0 in the audit),
    // which is exactly why closing them now is cheap and finding out later
    // would not have been.
    if (typeof window.postMessage === 'function') {
      const opm = window.postMessage.bind(window);
      window.postMessage = function (msg, targetOrigin, transfer) {
        if (schedRe) {
          schedGuard.frameChecked++;
          const hit = inspectPayload('window.postMessage', msg);
          if (hit) throw egressError('window.postMessage', hit);
        }
        return opm(msg, targetOrigin, transfer);
      };
    }
    // An iframe's `contentWindow` is a *different* Window object, so patching
    // our own is not enough — the class has to be patched on the prototype.
    if (typeof Window !== 'undefined' && Window.prototype && Window.prototype.postMessage) {
      const wpm = Window.prototype.postMessage;
      Window.prototype.postMessage = function (msg) {
        if (schedRe) {
          schedGuard.frameChecked++;
          const hit = inspectPayload('frame.postMessage', msg);
          if (hit) throw egressError('Window.postMessage', hit);
        }
        return wpm.apply(this, arguments);
      };
    }
    if (typeof ServiceWorker !== 'undefined' && ServiceWorker.prototype && ServiceWorker.prototype.postMessage) {
      const spm = ServiceWorker.prototype.postMessage;
      ServiceWorker.prototype.postMessage = function (msg) {
        if (schedRe) {
          schedGuard.swChecked++;
          const hit = inspectPayload('serviceworker.postMessage', msg);
          if (hit) throw egressError('ServiceWorker.postMessage', hit);
        }
        return spm.apply(this, arguments);
      };
    }
    // The same shape as `new Worker(url)`: the URL alone is the leak, and the
    // registration outlives the page that made it.
    if (navigator && navigator.serviceWorker && typeof navigator.serviceWorker.register === 'function') {
      const reg = navigator.serviceWorker.register.bind(navigator.serviceWorker);
      navigator.serviceWorker.register = function (url, opts) {
        if (schedRe) {
          schedGuard.swChecked++;
          const h = inspect('serviceworker.register', 'REGISTER', url, '');
          if (h) return Promise.reject(egressError('serviceWorker.register', h));
        }
        return reg(url, opts);
      };
    }
    // a child realm this page can reach is a realm the guard reaches ───────
    if (SCHEDULE_STORE.guardChildFrames && typeof HTMLIFrameElement !== 'undefined') {
      const d = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
      if (d && typeof d.get === 'function') {
        Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
          configurable: true,
          enumerable: d.enumerable,
          get: function () {
            const w = d.get.call(this);
            if (schedRe) guardChildRealm(w);
            return w;
          },
        });
      }
      if (typeof window.open === 'function') {
        const op = window.open.bind(window);
        window.open = function (url) {
          if (schedRe) {
            schedGuard.frameChecked++;
            const h = inspect('window.open', 'OPEN', url, '');
            if (h) throw egressError('window.open', h);
          }
          const w = op.apply(null, arguments);
          if (schedRe) guardChildRealm(w);
          return w;
        };
      }
    }
    // ROUND 8, and the same shape as the WebSocket subprotocols: a channel's
    // LABEL is carried in the SDP the peers exchange, so the label alone is a
    // leak that never calls `send`. Round 7 guarded the send and not the name.
    if (typeof RTCPeerConnection !== 'undefined' && RTCPeerConnection.prototype &&
        RTCPeerConnection.prototype.createDataChannel) {
      const cdc = RTCPeerConnection.prototype.createDataChannel;
      RTCPeerConnection.prototype.createDataChannel = function (label) {
        if (schedWatch.length) {
          schedGuard.rtcChecked++;
          const h = inspect('rtc.createDataChannel', 'OPEN',
            String(label == null ? '' : label), '');
          if (h) throw egressError('RTCPeerConnection.createDataChannel', h);
        }
        return cdc.apply(this, arguments);
      };
    }
    if (typeof RTCDataChannel !== 'undefined' && RTCDataChannel.prototype && RTCDataChannel.prototype.send) {
      const snd = RTCDataChannel.prototype.send;
      RTCDataChannel.prototype.send = function (data) {
        if (schedWatch.length) {
          schedGuard.rtcChecked++;
          const hit = inspect('rtc.send', 'SEND', this.label || '[datachannel]', data);
          if (hit) throw egressError('RTCDataChannel.send', hit);
        }
        return snd.apply(this, arguments);
      };
    }

    // the worker's own script URL ──────────────────────────────────────────
    // `new Worker('/collect?t=' + classTitle)` is a leak that never sends a
    // single message, and until this round nothing looked at it. The URL is a
    // string, so this is the ordinary scan.
    //
    // WHAT IT CANNOT DO, and it is written here rather than only in the doc:
    // MapLibre mints ONE `blob:` URL and spawns FOUR workers from it (measured
    // on a real load), and a `Blob` cannot be read synchronously. So schedule
    // text baked into a worker's SOURCE via a blob URL is not visible here.
    // Refusing blob-sourced workers outright would break the map on contact.
    // §9 of docs/si-privacy.md names this as a residual rather than pretending
    // otherwise.
    const guardWorkerCtor = (name) => {
      const Orig = window[name];
      if (typeof Orig !== 'function') return;
      class GuardedWorkerCtor extends Orig {
        constructor(url, opts) {
          if (schedRe) {
            schedGuard.workerCtors++;
            const h = inspect(name.toLowerCase() + '.new', 'NEW', url, '');
            if (h) throw egressError(name + ' constructor', h);
          }
          super(url, opts);
        }
      }
      window[name] = GuardedWorkerCtor;
    };
    guardWorkerCtor('Worker');
    guardWorkerCtor('SharedWorker');

    // form submission ──────────────────────────────────────────────────────
    if (typeof HTMLFormElement !== 'undefined' && HTMLFormElement.prototype.submit) {
      const sub = HTMLFormElement.prototype.submit;
      HTMLFormElement.prototype.submit = function () {
        if (schedWatch.length) {
          const hit = inspect('form.submit', this.method || 'GET', this.action,
            typeof FormData !== 'undefined' ? new FormData(this) : null);
          if (hit) throw egressError('form.submit', hit);
        }
        return sub.apply(this, arguments);
      };
    }
    document.addEventListener('submit', (ev) => {
      if (!schedWatch.length) return;
      const f = ev.target;
      if (!f || f.tagName !== 'FORM') return;
      let fd = '';
      try { fd = new FormData(f); } catch (e) { fd = BODY_UNREADABLE; }
      if (inspect('form.event', f.method || 'GET', f.action, fd)) ev.preventDefault();
    }, true);
  }

  // ── read, write, and the delete that has to be total ───────────────────────
  let schedCache = null;
  const schedListeners = new Set();
  function fireScheduleChange(why) {
    for (const fn of schedListeners) { try { fn(schedCache, why); } catch (e) {} }
    renderPrivacyPanel();
  }

  function scheduleLoad() {
    if (schedCache) return schedCache;
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(SCHEDULE_STORE.key) || 'null'); } catch (e) { return null; }
    if (!raw || typeof raw !== 'object') return null;
    if (Number(raw.v) > SCHEDULE_SCHEMA_VERSION) return { tooNew: true, v: raw.v };
    const d = migrateSchedule(raw);
    if (!d) return null;
    schedCache = d;
    setWatchlist(buildWatchlist(d));
    return d;
  }

  function scheduleSave(doc) {
    const d = normaliseSchedule(doc);
    let text;
    try { text = JSON.stringify(d); } catch (e) { return { ok: false, why: 'unserialisable' }; }
    if (text.length > SCHEDULE_STORE.maxBytes) return { ok: false, why: 'toobig', bytes: text.length };
    try { localStorage.setItem(SCHEDULE_STORE.key, text); }
    catch (e) { return { ok: false, why: 'storage', message: String(e && e.name) }; }
    schedCache = d;
    setWatchlist(buildWatchlist(d));
    fireScheduleChange('save');
    return { ok: true, bytes: text.length, classes: d.classes.length };
  }

  /** Every key this feature could ever have written, right now, on disk. */
  function scheduleKeys() {
    const out = [];
    for (const store of [['local', localStorage], ['session', sessionStorage]]) {
      try {
        for (let i = 0; i < store[1].length; i++) {
          const k = store[1].key(i);
          if (k && k.indexOf(SCHEDULE_STORE.prefix) === 0) out.push({ where: store[0], key: k });
        }
      } catch (e) {}
    }
    return out;
  }

  function scheduleInventory() {
    const keys = scheduleKeys().map(k => {
      let v = '';
      try { v = ((k.where === 'local' ? localStorage : sessionStorage).getItem(k.key)) || ''; } catch (e) {}
      return { where: k.where, key: k.key, bytes: v.length };
    });
    return { keys, bytes: keys.reduce((n, k) => n + k.bytes, 0), inMemory: !!schedCache };
  }

  /**
   * scheduleClear — the delete control's whole job. Sweeps the prefix in both
   * web storages (not just the one key), drops the reserved IndexedDB database
   * whether or not anything has created it yet, drops the in-memory copy, and
   * empties the guard's watchlist so the guard is not holding the last copy of
   * what it was guarding.
   */
  function scheduleClear() {
    const removed = [];
    for (const k of scheduleKeys()) {
      try { (k.where === 'local' ? localStorage : sessionStorage).removeItem(k.key); removed.push(k.key); } catch (e) {}
    }
    schedCache = null;
    setWatchlist([]);
    const idb = new Promise((res) => {
      if (typeof indexedDB === 'undefined' || !indexedDB.deleteDatabase) return res('no-idb');
      let done = false;
      const fin = (r) => { if (!done) { done = true; res(r); } };
      try {
        const req = indexedDB.deleteDatabase(SCHEDULE_STORE.idbName);
        req.onsuccess = () => fin('deleted');
        req.onerror = () => fin('error');
        req.onblocked = () => fin('blocked');
        setTimeout(() => fin('timeout'), 2000);
      } catch (e) { fin('threw'); }
    });
    fireScheduleChange('clear');
    return { removed, idb, remaining: scheduleInventory() };
  }

  async function scheduleClearAsync() {
    const r = scheduleClear();
    r.idbResult = await r.idb;
    r.remaining = scheduleInventory();
    return r;
  }

  /**
   * THE STORED ENVELOPE -> THE OBJECT THE REST OF THE FEATURE READS.
   *
   * A reload used to lose the import outright. Nothing new is read here —
   * `scheduleLoad()` already put this in memory at boot, which is where the
   * guard's watchlist comes from — this only gives it the shape everything
   * downstream expects, so the day view after a reload is the student's own
   * day and not the demo.
   */
  function schedulePublished(d) {
    if (!d || d.tooNew || !Array.isArray(d.classes) || !d.classes.length) return null;
    const events = d.classes.map((c, i) => {
      const t = String(c.title || '');
      // `course` is not stored — it is derivable from the title by the same
      // rule the parser used to derive it, and a stored field that can go out
      // of step with the field it came from is a schema change looking for a
      // bug.
      const cm = SCHED_COURSE_RE.exec(t.toUpperCase());
      return {
        index: i + 1, id: c.id || ('row-' + (i + 1)),
        title: t, course: cm ? cm[1].replace(/\s+/g, ' ').trim() : '',
        locationText: c.code ? (c.room ? c.code + ' ' + c.room : c.code) : '',
        code: c.code || null, room: c.room || '',
        days: Array.isArray(c.days) ? c.days.slice() : [],
        startMin: c.startMin, endMin: c.endMin,
        firstDate: null, lastDate: null, exDates: [],
        tz: d.tz || SCHEDULE.tz,
        status: c.unroutableWhy ? 'failed' : 'ok',
        problems: [], confidence: c.confidence == null ? 1 : c.confidence,
      };
    });
    return {
      v: SCHEDULE_SCHEMA_VERSION, restored: true, tz: d.tz || null,
      origin: (d.sources && d.sources[0]) || null,
      source: (d.sources && d.sources[0] && d.sources[0].kind) || 'manual',
      events: events,
    };
  }

  /**
   * Keep `window.wayfindSchedule` and the device in step in BOTH directions: a
   * stored schedule is published, a deleted one is unpublished, and a delete in
   * another tab does both — which is the case that would otherwise leave a
   * schedule on screen that the student believes they erased.
   *
   * A LIVE IMPORT WINS. The object `impUse()` publishes carries this round's
   * placements and rejects as well as the events; the restored one is thinner,
   * and overwriting the richer object with it on the save that just happened
   * would be a regression dressed as tidiness.
   */
  function scheduleSyncPublished() {
    const d = scheduleLoad();
    const has = !!(d && !d.tooNew && d.classes && d.classes.length);
    if (!has) {
      if (window.wayfindSchedule) {
        window.wayfindSchedule = null;
        try { window.dispatchEvent(new CustomEvent('wayfind:schedule', { detail: null })); } catch (e) {}
      }
      return;
    }
    if (window.wayfindSchedule) return;
    window.wayfindSchedule = schedulePublished(d);
    try {
      window.dispatchEvent(new CustomEvent('wayfind:schedule', { detail: window.wayfindSchedule }));
    } catch (e) {}
  }
  schedListeners.add(() => { try { scheduleSyncPublished(); } catch (e) {} });

  // A delete in one tab is a delete everywhere. Cheap, and the alternative is
  // a second tab still holding a schedule the student believes they erased.
  window.addEventListener('storage', (ev) => {
    if (!ev || !ev.key || ev.key.indexOf(SCHEDULE_STORE.prefix) !== 0) return;
    schedCache = null;
    const d = scheduleLoad();
    if (!d || d.tooNew) setWatchlist([]);
    fireScheduleChange('othertab');
  });

  // ── the panel: the sentence, what is stored, and the one tap ──────────────
  let privEl = null, privMountTries = 0, privNoticeTimer = 0;

  /** index.html's `<template id="wf-privacy-copy">` overrides the defaults, so
   *  the wording is a one-line edit in the HTML with no JS change. */
  function privacyCopy() {
    const out = Object.assign({}, SCHEDULE_PRIVACY_COPY);
    const t = document.getElementById('wf-privacy-copy');
    if (t && t.content) {
      for (const n of t.content.querySelectorAll('[data-k]')) {
        const k = n.getAttribute('data-k');
        if (k in out) out[k] = n.textContent.trim();
      }
    }
    return out;
  }

  function buildPrivacyPanel() {
    if (privEl) return privEl;
    if (!document.getElementById('wf-priv-css')) {
      const s = document.createElement('style');
      s.id = 'wf-priv-css'; s.textContent = SCHEDULE_PRIVACY_CSS;
      document.head.appendChild(s);
    }
    const C = privacyCopy();
    const root = h('div', null); root.id = 'wf-priv';
    root.appendChild(h('div', 'wf-priv-line', C.line));
    const st = h('div', 'wf-priv-state', ''); root.appendChild(st);
    const del = h('button', null, ''); del.id = 'wf-priv-del';
    del.type = 'button';
    del.appendChild(icon(null, IC.close, 2.2));
    del.appendChild(h('span', null, C.deleteBtn));
    del.addEventListener('click', async () => {
      if (SCHEDULE_STORE.deleteNeedsConfirm && !window.confirm(C.confirm)) return;
      await scheduleClearAsync();
      st.textContent = C.deleted;
      clearTimeout(privNoticeTimer);
      privNoticeTimer = setTimeout(renderPrivacyPanel, SCHEDULE_STORE.deletedNoticeMs);
    });
    root.appendChild(del);
    privEl = { root, state: st, del };
    return privEl;
  }

  function renderPrivacyPanel() {
    if (!privEl) return;
    const C = privacyCopy();
    const d = scheduleLoad();
    const has = !!(d && !d.tooNew && d.classes && d.classes.length);
    privEl.root.classList.toggle('has-schedule', has);
    if (has) {
      const src = (d.sources && d.sources[0] && d.sources[0].label) || 'an import';
      privEl.state.textContent = scheduleSavedLine(d.classes.length, src);
    } else {
      privEl.state.textContent = C.empty;
    }
  }

  /**
   * Where the panel goes. The import bar does not exist in this lane's files —
   * four other lanes are building it — so this mounts itself into the sheet's
   * own footer, which is where this feature already puts the things it has to
   * say about itself, and `WAYFIND.store.mount(el)` lets whoever builds the
   * import bar move it into the bar in one line instead.
   */
  function mountPrivacyPanel(host) {
    const p = buildPrivacyPanel();
    const target = host || document.querySelector('#wf-sheet .wf-foot');
    if (!target) {
      // The sheet is built on first open, so retry for a while and then stop
      // rather than leaving a timer running forever on a page nobody opened.
      if (privMountTries++ < 200) setTimeout(() => mountPrivacyPanel(), 250);
      return null;
    }
    if (p.root.parentNode !== target) target.insertBefore(p.root, target.firstChild);
    renderPrivacyPanel();
    return p.root;
  }

  // ── install, and the public seam the import lanes call ────────────────────
  installEgressGuard();
  scheduleLoad();
  if (schedCache) setWatchlist(buildWatchlist(schedCache));
  // ...and hand whatever survived the reload back to the surfaces that read it.
  scheduleSyncPublished();
  setTimeout(() => mountPrivacyPanel(), 0);

  WAYFIND.store = {
    KEY: SCHEDULE_STORE.key,
    PREFIX: SCHEDULE_STORE.prefix,
    IDB: SCHEDULE_STORE.idbName,
    VERSION: SCHEDULE_SCHEMA_VERSION,
    SOURCES: SCHEDULE_SOURCES,
    copy: privacyCopy,
    defaultCopy: SCHEDULE_PRIVACY_COPY,
    normalise: normaliseSchedule,
    save: scheduleSave,
    load: scheduleLoad,
    has: () => { const d = scheduleLoad(); return !!(d && !d.tooNew && d.classes && d.classes.length); },
    clear: scheduleClear,
    clearAsync: scheduleClearAsync,
    inventory: scheduleInventory,
    mount: mountPrivacyPanel,
    onChange: (fn) => { schedListeners.add(fn); return () => schedListeners.delete(fn); },
    guard: {
      state: () => ({
        installed: schedGuard.installed,
        armed: schedGuard.armed,
        watched: schedWatch.length,
        checked: schedGuard.checked,
        quietChecked: schedGuard.quietChecked,
        blocked: schedGuard.blocked,
        inspectFailures: schedGuard.inspectFailures,
        unreadableBodies: schedGuard.unreadableBodies,
        blockedOpaque: schedGuard.blockedOpaque,
        opaqueWorkerLeaves: schedGuard.opaqueWorkerLeaves,
        // Round 6. `binaryLeaves`/`binaryBytes` are the measurement that says
        // whether the byte scan is doing its job or quietly doing nothing: if
        // a cold load reports 0 bytes scanned, the guard is not reading the
        // map's own tile traffic and something above it has gone wrong.
        binaryLeaves: schedGuard.binaryLeaves,
        binaryBytes: schedGuard.binaryBytes,
        truncatedScans: schedGuard.truncatedScans,
        scanThrows: schedGuard.scanThrows,
        portChecked: schedGuard.portChecked,
        workerCtors: schedGuard.workerCtors,
        // Round 7. All four are the "measured cost: zero" claim, republished so
        // the next person re-checks it in one line instead of trusting a
        // comment — the same reason `binaryLeaves` is here.
        bodyBytesScanned: schedGuard.bodyBytesScanned,
        frameChecked: schedGuard.frameChecked,
        swChecked: schedGuard.swChecked,
        rtcChecked: schedGuard.rtcChecked,
        // Round 8. `headersScanned` is the "measured cost: nil" claim about
        // reading request headers, republished so the next person re-checks it
        // rather than trusting the comment; `encodedHits` says how often the
        // one string scanner's decode retry is what caught something, which is
        // the number that would have been non-zero for eight rounds if anyone
        // had been counting.
        headersScanned: schedGuard.headersScanned,
        unreadableHeaders: schedGuard.unreadableHeaders,
        encodedHits: schedGuard.encodedHits,
        policy: {
          blockUnreadableBodies: SCHEDULE_STORE.blockUnreadableBodies,
          blockOpaqueWorkerLeaves: SCHEDULE_STORE.blockOpaqueWorkerLeaves,
          failClosedOnScanError: SCHEDULE_STORE.failClosedOnScanError,
          binaryScanBytes: SCHEDULE_STORE.binaryScanBytes,
          workerScanNodes: SCHEDULE_STORE.workerScanNodes,
          scanRequestHeaders: SCHEDULE_STORE.scanRequestHeaders,
          blockUnreadableHeaders: SCHEDULE_STORE.blockUnreadableHeaders,
          scanEncodedForms: SCHEDULE_STORE.scanEncodedForms,
        },
      }),
      log: () => schedGuard.log.slice(),
      /** ONLY so the audit can prove its own network capture is not blind. A
       *  "zero requests carried the schedule" result means nothing unless the
       *  instrument is shown catching one; this lets the audit fire a real
       *  leak, watch the capture catch it, and re-arm. Nothing in the app
       *  calls it. */
      __disarmForAudit: () => { schedGuard.armed = false; return schedGuard.armed; },
      arm: () => { schedGuard.armed = true; return schedGuard.armed; },
    },
  };
  window.wayfindStore = WAYFIND.store;

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
  dayBoot();
})();
