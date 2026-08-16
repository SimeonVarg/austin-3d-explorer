# The frame budget — written by reading, before anything was timed

**Status: PREDICTION. Not one number below is a measurement.** Every figure is
either (a) a feature count read out of `data/` with `json.load`, (b) a constant
read out of the source, or (c) an arithmetic consequence of the two. The three
figures that *are* measurements — 37.9 ms, 841.5 ms, 12.3/123 ms — are quoted
from HANDOFF §109 with their conditions and are marked as such.

This exists because QUEUE K1 is right: **584 entrances (14,242 features), 24
apartment lobbies, deeper shopfronts, storey bands, close-range ground grain,
walking height with tree collision and a walking route all landed this month and
not one of them has a frame-cost number.** The point of writing the budget first
is that the Measure phase then has something to falsify. A measurement with no
prior prediction is a number; a measurement against a written prediction is a
result.

Written by the Acer lane, 2026-08-16, `docs/perf/budget.md` only.
Owner of this file: whoever holds the perf lane. Nothing else writes it.

**K1 has two halves and they are two documents.** This one is the **frame**
bill — what a rendered frame costs and what runs per camera move.
`docs/perf/payload.md` is the **byte** bill — what a visitor downloads and what
the main thread parses before the city appears. It was measured the same night
by a sibling workflow and it is authoritative on everything to do with bytes,
parse time and load; where the two touch, it wins. Neither document has yet
measured a frame.

---

## Part 0 — how to read the numbers, and what will lie to you

Restating the traps from `scripts/verify/README.md` and CLAUDE.md rule 10,
because half of them are specifically about the instruments the Measure phase is
about to reach for:

* **`perf.mjs` / `perf2.mjs` / `perf3.mjs` throttle the CPU 4× unless told
  otherwise.** Quote the setting beside the number or the figure is about a
  crippled machine. They also launch *headed* on purpose and do **not** carry
  the occlusion flags `outer-perf.mjs` has, so their numbers are only honest on
  an idle desktop.
* **`scripts/serve.py` does not gzip; GitHub Pages does, ~5×.** Any payload
  number taken off the local server is a worst case, not the visitor's case.
* **A page-scoped CDP session cannot see MapLibre's worker fetches** and
  under-reports a load by ~19 MB. The tile fetches happen in the workers.
* **A median frame time is not a performance measurement** — it sits on the
  16.7 ms vsync floor while half the frames are dropped. Count dropped frames.
* **Take the minimum of interleaved, counterbalanced reps.** This suite has
  measured 11 s to 65 s for an identical page on a quiet machine, and four
  sequential runs of one configuration produced 23.4 / 32.4 / 43.6 / 40.9 fps.
* **Cancel the graphics auto-detect probe** (`window.cancelGraphicsAutoDetect()`)
  at the top of every run. It fires ~11 s after load and rewrites every setting.
* **`queryRenderedFeatures` returns 0 for fill-extrusion at a flying pitch.**
  Count `querySourceFeatures` instead.

And one that is specific to tonight: **three other workflows are running and
Simeon is on the machine.** Record the chrome/node process count and CPU percent
immediately before and after every reading and print them beside the figure. A
number without its conditions is not a measurement.

---

## Part 1 — the inventory: every layer, every scan, what triggers it, what bounds it

### 1.1 What the renderer is asked to draw

95 `addLayer` call sites live in our own modules, plus the Liberty basemap's
surviving layers (`cleanupBasemap` hides all symbol and fill-extrusion layers
and keeps background / water / park / ground / major-road lines — the kept count
is logged at boot and **has never been written down**; the Measure phase should
read `map.getStyle().layers.length` and print it). `js/lod.js` states in its own
header that the app runs **41 fill-extrusion layers**.

Feature counts, read off `data/` at `origin/main` `321dd9e`:

| source | file | MB (ungzipped) | features | tiled? |
|---|---|---:|---:|---|
| `austin-trees` | `trees.geojson` | 26.37 | **67,443** (59,884 canopy + 7,559 trunk) | **yes** — `trees.pmtiles` 5.82 MB |
| `austin-entrances` | `entrances.geojson` | 6.38 | **14,242** over 280 buildings | no — **deferred** |
| `ground` | `ground.geojson` | 4.95 | **10,937** | **no** |
| `roads` | `roads.geojson` | 3.70 | 17,462 | yes — `roads.pmtiles` 2.02 MB |
| `austin-outer` | `outer_ring.geojson` | 3.18 | 9,149 | yes — `outer.pmtiles` 1.98 MB |
| roofscape detail | `roofscape.detail.geojson` | 2.27 | 8,034 | yes — `roofdetail.pmtiles` 0.96 MB, **lazy** |
| `austin-roofs` | `roofs.geojson` | 1.61 | 4,897 | no |
| `austin-buildings` | snapshot `buildings.detailed` | 1.48 | **2,453** (2,428 ≥ 3 m) | no, on purpose |
| `austin-props` | `props.geojson` | 1.45 | 4,869 | yes — `props.pmtiles` 0.16 MB |
| roofscape major/deck | `roofscape.geojson` | 1.34 | 3,649 | no |
| capitol (4 files) | | ~1.13 | 2,452 | no |
| `places` | `places.geojson` | 0.97 | 2,533 | no |
| art | `art.geojson` | 0.59 | 2,189 | no |
| stadium | `stadium.geojson` | 0.51 | 1,448 | no |
| westcampus | `westcampus.geojson` | 0.39 | 1,144 | no |
| walk graph | `walk_graph.json` | 0.34 | — | no |
| drag / tower / arts / moody / heroes / parts / landscape / depth | | ~0.20 | 605 | no |

**The byte half of K1 is not this document's — it is
`docs/perf/payload.md`** (merged as `20a88d9`, a sibling workflow, the same
night). It measured what this section could only estimate, so its numbers win
wherever the two disagree. The ones that matter here:

* **first paint, excluding tiles: 2.63 MB gzipped / 15.20 MB raw**, of which
  920 KB gzipped is parsed on the **main thread** and 1,219 KB in workers;
* **75.9 ms of eager main-thread `JSON.parse`** unthrottled (~304 ms at
  `perf.mjs`'s 4× throttle), plus **63.9 ms** more when the deferred door file
  lands — and a further **~100 ms of `JSON.stringify`** that is *suspected*
  (fifteen modules hand MapLibre a parsed object) and explicitly **not yet
  verified**;
* **PMTiles do not gzip further** — each tile is already gzipped inside the
  archive;
* `entrances.geojson` is **6.690 MB / 14,242 features**, not the 5.44 MB /
  11,890 the briefs have been carrying. `docs/entrances/` is stale.

Two things that stay this document's problem: `ground.geojson` at 4.95 MB /
10,937 features is the largest untiled file in the app and nobody has proposed
tiling it; and none of the parse cost above is *per-frame*, so it belongs to the
load budget, not the frame budget. Both budgets are needed and they are separate
bills.

Layer-owning modules, by `addLayer` count:
`ground` 17, `app` 14, `props` 9, `entrances` 7, `outer` 6, `capitol` 5,
`places` 5, `arts` 4, `wayfind` 4, `drag` 3, `night` 3, `roofs` 3, `tower` 3,
`westcampus` 3, `heroes` 2 (+8 via a local `add()` helper), `moody` 2,
`signs` 2, `sky` 2 (both `type:'custom'`, `renderingMode:'3d'`),
`shadows` 1. Plus `js/capitol.js` `cloneLayersOnto()`, which **clones every
basemap layer bound to one source** — an unbounded count nobody has printed.

### 1.2 The one thing that turns every listener into a per-frame listener

`js/controls.js` `writeToMap()` ends in `map.jumpTo(pose, {fly:true})`, and it
runs on **every rAF tick while the controller is driving** (`tick()` →
`writeToMap()`, `js/controls.js:1374`/`951`). `jumpTo` fires MapLibre's whole
event cascade in that one frame: `movestart`/`move`/`moveend`, plus
`zoomstart`/`zoom`/`zoomend` whenever the derived zoom changed — and zoom is
derived from altitude on the same line, so it changes on essentially every
moving frame — plus `pitch` and `rotate` when those move.

**So "on `move`" means "every frame" here, and a module registered on two of
those events runs twice a frame.** That is not written down anywhere in the
repo and it is the frame through which everything below should be read.

### 1.3 Everything that runs per frame or per camera move

| # | what | file:line | trigger | cost in features | bounded? |
|---|---|---|---|---|---|
| 1 | flight tick: keys, arbitration, feel effects, `writeToMap` | `controls.js:1374` | **rAF, always** | O(1) | yes |
| 2 | movement substepping + collision probes | `controls.js:1517` | rAF, while moving | ≤ 7 substeps (`DT_MAX` 0.10 × 300 m/s ÷ 4.5 m) × ~4 grid lookups | **yes**, by `DT_MAX` |
| 3 | rooftop floor + hard net: 4× `maxHeightIn` | `controls.js:839` | rAF, while driving | 2×2 to 3×3 cells (`CELL` 6 m, `rCam` 1–6 m) | yes |
| 4 | **outer-ring incremental scan** | `controls.js:564`/`475` | rAF, throttled 200 m **or** 1.5 s (6 s when idle-backed-off) | `querySourceFeatures` over `austin-outer`; field goes 1,336 feats / 29,381 cells → **4,580 / 59,760** below `ALT_GROUND` | **stamping** budgeted at `OUTER_BUDGET_MS` = 4; **the query is not** |
| 5 | **trunk field incremental scan** | `controls.js:770`/`703` | rAF below `ALT_GROUND` = 12 m; on new tile, 60 m of movement, or 1.5 s | `querySourceFeatures` over `austin-trees` filtered `kind=trunk`; **7,559 trunks** | **stamping** budgeted at `TRUNK_BUDGET_MS` = 3; **the query is not** |
| 6 | **sky repaint** (`updateSky`) | `sky.js:1298`/`1340` | **`move`** → every frame | **520 stars** projected + arc-filled + halo blit, **22 clouds × 3–5 lobes ≈ 88 `createRadialGradient` ellipse fills**, 6 wide `drawGlow` lobes, canvas cleared and re-uploaded to GPU | **NO** |
| 7 | entrance/wordmark label gate | `entrances.js:970–972` | **`move` AND `moveend` AND `zoom`** → **3× per frame** | 32 sign features + ≤22 wordmarks, plus an **unconditional** `setPaintProperty('text-translate')` per visible layer per call | no gate on call count |
| 8 | outer-ring flat-tier opacity | `outer.js:571–572` | **`pitch` AND `move`** → 2× per frame | O(1); writes only when the opacity bucket moves ≥ 0.02 | yes, by the 0.02 gate |
| 9 | LOD tier show/hide | `lod.js:186–187` | `move` + `zoom`, **debounced 140 ms** | 18 fine + 6 mid layer ids | yes |
| 10 | roofscape detail fetch trigger | `roofs.js:177` | `zoom` → every frame | O(1) after `_detailAsked` | yes |
| 11 | facade tier staleness watch | `facades.js:1882` | `zoom` → every frame | filter over 2 tiers; repaints only if stale | yes in the steady state |
| 12 | loader source scan | `loader.js:351–352` | `sourcedata` + `idle` | O(sources) until `finished` | yes, self-disarms |
| 13 | entrance deferred-load altitude check | `entrances.js:1522` | `move` until it fires once | O(1), then `map.off` | yes |
| 14 | trunk `sourcedata` dirty flag | `controls.js:781` | every tile state change on every source, once below 12 m | O(1) | yes |
| 15 | **route pulse** (Z5, wayfind lane) | `wayfind.js:1110` | own rAF, throttled to ~15 Hz, **runs forever once a route exists** | one `setPaintProperty('line-gradient')` → re-evaluates a line-gradient across the whole route | 15 Hz cap only |
| 16 | time-of-day autoplay | `timeofday.js:526` | own rAF while ▶ is on | see §1.4 | quantised to 1/128 |
| 17 | graphics fps readout | `graphics.js:1516` | own rAF, **only while the menu is open** | O(1) | yes |
| 18 | graphics auto-detect probe | `graphics.js:1230` | once, ~11 s after load | 1.4 s of rAF + a `jumpTo` nudge per frame | one-shot |

### 1.4 What a time-of-day tick actually costs

`applyTimeOfDay` quantises `p` to 1/128 (`timeofday.js:347`). The autoplay sweep
is 32 s (`AUTO_PER_MS = 1/32000`), so the **heavy path fires ~4 times a second**
for as long as ▶ is held on. Each heavy pass runs:

* `updateFacades` → `paintTiers` over **every registered combo × 2 mip tiers**.
  `facades.js:1784` says "the 100 registered images of each tier", so **≈200
  `updateImage` calls**, each preceded by a canvas draw and a **`getImageData`
  readback** — which `facades.js:291` itself names as "the slowest common
  canvas2d op on iOS". Every one dirties the sprite atlas, which re-renders
  every pattern-using tile.
* `updateShadows` → below.
* `applyGroundColors`, `applyPropColors`, `applyCapitolColors`,
  `applyNightLayer`, `applySignGlowLayer`, `applyStadiumColors`, plus
  `setSky` and `setLight`.
* Six sweeps over the kept basemap layer lists (`_bgLayers`, `_groundFills`,
  `_parkFills`, `_waterFills`, `_waterLines`, `_roadLines`), each a
  `setPaintProperty` per layer.
* **Eleven wrappers**, chained: `arts`, `drag`, `entrances`, `heroes`, `moody`,
  `outer`, `places`, `roofs`, `tower`, `wayfind`, `westcampus` all do
  `window.applyTimeOfDay = wrapped`. Every heavy tick walks all eleven.
* `updateSky` again at the end, on top of the one `move` already caused.

**`js/shadows.js` is the part of that chain nobody has costed.**
`updateShadows` rebuilds when `|p − lastP| ≥ 0.04`, debounced 140 ms
(`shadows.js:132`). At the autoplay rate `p` crosses 0.04 every **1.28 s**, so a
full rebuild fires roughly **once a second, forever, while the sun is animating**.
Each rebuild is `build(p)`: for each of **2,428 buildings ≥ 3 m**, take every
ring, duplicate every vertex offset by the shadow vector, and run **Andrew's
monotone chain hull over 2× the ring's points** — then `src.setData(...)` the
whole resulting FeatureCollection, which re-tiles a GeoJSON source in a worker.

---

## Part 2 — the ranked suspect list

**This is a prediction to be tested, not a measurement.** Ranked by
(cost per occurrence) × (occurrences per second), reasoning from the feature
counts and trigger frequencies in Part 1.

### (a) Cruise altitude (~150–600 m, pitch 70–80, the flyover and the tour)

| rank | suspect | why | falsified if |
|---|---|---|---|
| 1 | **GPU fill: `trees-canopy` (59,884), `buildings-3d` (2,453), the outer ring (9,149), roofscape (3,649)** across 41 fill-extrusion passes | at altitude the whole city is in frame and overdraw is maximal; `lod.js` already measured +6.0 fps from dropping two whole passes | hiding `trees-canopy` alone moves fps < 2 |
| 2 | **`updateSky` per frame** — 520 stars + ~88 gradient lobes, canvas re-uploaded | unbounded, runs every frame the camera moves, and the star loop runs whenever `B.stars > 0.02` (i.e. all of dusk and night) | `?` a day pose and a night pose at the same altitude differ by < 1 ms |
| 3 | **outer-ring scan** — **37.9 ms worst case (HANDOFF §109)** | throttled to 1.5 s, so ≈0.7 % duty, but 37.9 ms is 2¼ dropped frames when it lands | `__fly.outerField().maxMs` stays under 8 ms over a full tour |
| 4 | symbol placement / collision for the label layers | `buildings-labels`, `places-label`, `signs-label`, `props-art-label`, entrance labels + wordmarks — MapLibre re-places symbols on zoom change, and zoom changes every frame | hiding every symbol layer moves fps < 1 |
| 5 | the flight tick itself | O(1) by construction; `__fly.tickMsAvg` exists to prove it | it is over 2 ms |

Trunk field is **not** on this list at cruise: `TRUNK_ALT` = `ALT_GROUND` = 12 m
gates the whole feature behind one compare, and §109 confirms nothing scripted
goes below 113.9 m.

### (b) Walking height (1.7 m, pitch pinned 84.7–88 by the pitch floor)

| rank | suspect | why | falsified if |
|---|---|---|---|
| 1 | **trunk field scan — 841.5 ms worst (HANDOFF §109, 61 scans, 25.3 ms avg, 2,976 trunks)** | that run teleported across West Campus ten times, so it is an upper bound, not typical — but even the 25.3 ms *average* is 1½ frames, at 1.5 s intervals, while walking | `maxMs` under a sustained walk (no teleports) stays under 20 ms |
| 2 | **`updateSky`, and it is WORSE here than at cruise** | the sky canvas is sized to the horizon: `hzPx = 0.5 − 0.5·tan(90−pitch)/tan(fov/2)`, so at pitch 88 the horizon sits at ~47 % of frame height and the canvas is at its **maximum**. Walking height pins pitch high (§109: 84.72 floor at 1.70 m). Bigger canvas, more stars in frame, more upload — exactly where the app is already slowest | the sky canvas height at 1.7 m is not materially larger than at cruise |
| 3 | **outer-ring scan, made ~3.4× heavier by walking** | crossing `ALT_GROUND` swaps `OUTER_MIN_H` 12 → `OUTER_MIN_H_GROUND` 2.5, throws the pending list away and rescans: **1,336 → 4,580 features, 29,381 → 59,760 cells** | crossing 12 m does not move `outerField().maxMs` |
| 4 | close-range ground: `CLOSE_AREA` / `CLOSE_ROAD` / `CLOSE_PATH` + the pathslab deck | minzoom-gated so there is no JS cost, but Y8 already records the ground plane at **40–55 % of every frame** and these add three more passes over it | hiding the three close layers moves fps < 1 |
| 5 | entrance geometry now resident: 14,242 features across 7 layers (3,808 steps, 3,180 rails, 1,833 reveals, 1,666 glass, 1,353 doors) | the file only loads on descent, so walking is the *only* state where it is drawn | hiding all 7 entrance layers moves fps < 1 |
| 6 | the 3× label gate + its `setPaintProperty` | small loop, but three style writes per frame on a symbol layer force symbol re-evaluation | making the handler idempotent-per-frame changes nothing |

### (c) A phone

Simeon tested on his phone 2026-08-04 and said performance is great — that was
**before** entrances, storey bands, close ground grain, walking height and the
route landed. Treat the phone as re-opened, not closed.

| rank | suspect | why |
|---|---|---|
| 1 | **the facade atlas repaint** — ~200 `getImageData` + `updateImage` per heavy tod tick, 4×/s | `facades.js` names `getImageData` as the slowest common canvas2d op on iOS. This is the one item where the phone is not just "the desktop, slower" — it is a *different* bottleneck |
| 2 | **payload and parse** — 2.63 MB gzipped and **75.9 ms of main-thread `JSON.parse`** before the city appears, ~304 ms at a 4× throttle, which a mid-range phone is a fair model of | measured in `docs/perf/payload.md`; **`ground.geojson` at 4.95 MB / 10,937 features is the biggest file left untiled** |
| 3 | **tile workers**: `perCores: 2`, capped 4 — a 4-core phone gets 2, a 2-core phone gets 1 | measured on desktop only (`tiles.js`); the scaling rule is a reasoned guess on mobile |
| 4 | fill rate — the phone's real limit is overdraw, and `renderScale` 0.75 in the `performance` preset is the only lever that touches it | `lod.js` measured tier-dropping beating `renderScale 0.75` on desktop; on a phone that ranking may invert, because the phone is fill-bound and the desktop is not |
| 5 | the shadow rebuild: 2,428 convex hulls + a whole-source `setData` | on a phone, once a second during autoplay, on one thread |

---

## Part 3 — what is O(everything) on a camera move

The two that were already known:

* **`js/controls.js:475` `outerStamp()`** — `querySourceFeatures` on
  `austin-outer` builds its complete feature list before returning, so
  `OUTER_BUDGET_MS = 4` cannot bound it. **37.9 ms worst (§109).**
* **`js/controls.js:703` `trunkStamp()`** — same shape on `austin-trees`.
  **841.5 ms worst (§109)**, which is not a budget overrun, it is a visible
  freeze. `controls.js:681` also records the earlier polling design at
  **12.3 ms average / 123 ms worst**, which is what the current trigger design
  replaced.

### The third one, and it is the one nobody has written down

**`js/sky.js` `updateSky()` is a full CPU repaint of the sky on every camera
move, and nothing bounds it, throttles it, or times it.**

`sky.js:1298` registers `map.on('move', redraw)`. Per §1.2, that is every frame
the flight controller is driving. Each call:

1. `resize()` the sky canvas to the horizon (quantised with hysteresis — this
   part is fine).
2. Three DOM `place()` writes for the disc, bloom and glow.
3. `ctx.clearRect` the whole canvas, then in `globalCompositeOperation:'lighter'`:
   * up to 6 large `drawGlow` ellipses (skyglow band, Belt of Venus ×2, wide
     wash ×2, hot spot ×2) — each a `createRadialGradient` + `arc` + `fill` at
     up to `0.5 × max(W,H)` radius;
   * **a loop over 520 stars**, each projected, frustum-tested, and — when in
     frame — `arc` + `fill`, plus a `drawImage` halo blit for the bright ones.
     Gated on `B.stars > 0.02`, i.e. **the whole of dusk and night**;
   * **a loop over 22 clouds × 3–5 lobes ≈ 88 lobes**, each of which builds its
     own `createRadialGradient` under a `save`/`translate`/`scale`/`restore` and
     fills an ellipse. Gated on `cloudA > 0.02`, i.e. **the whole of day and
     dusk**.
4. The mutated canvas is re-uploaded to the GPU as a texture. The file itself
   measured this at **13.7 MB/frame at 2560×1400** before the canvas was cropped
   to the sky band — so the *upload* was costed once and fixed; **the draw never
   was.**

Why it has stayed invisible:

* It has **no counter and no timer.** `window.__fly` publishes
  `outerField().maxMs` and `trunkField().maxMs`; there is no `window.__sky` at
  all. The two hogs that got written down are exactly the two that instrumented
  themselves.
* It is on `move`, not on rAF, so it does not look like a per-frame cost when
  you grep for `requestAnimationFrame`.
* Its two heavy loops are gated on *opposite* halves of the day (stars at night,
  clouds by day), so at no single test hour is the whole thing running — but at
  **dusk both are**, and dusk is what §117 calls the best frame set in the app
  and what the AWS recording is most likely to use.
* Its cost **rises with pitch**, and walking height pins pitch near the ceiling.

**Prediction to test:** at dusk (`p ≈ 0.62`) at 1.7 m, `updateSky` is between
2 and 8 ms per frame on this laptop, and it is the single largest main-thread JS
cost in the app after the two known scans. **If it is under 1 ms, this section
is wrong and should be struck.**

### Two smaller ones, also unwritten

* **The entrance label gate runs three times per frame.**
  `js/entrances.js:970–972` registers the *same* `run` on `move`, `moveend` and
  `zoom`; `jumpTo` fires all three. The scan itself is small (32 signs, ≤22
  wordmarks) but each call that has a label visible does an **unconditional**
  `map.setPaintProperty(L_LABEL, 'text-translate', …)`. Three symbol-layer paint
  writes per frame, two of which are redundant by construction.
* **`js/outer.js` `watchPitch` runs twice per frame** (`pitch` and `move`). It
  is properly gated — it only writes when the opacity bucket moves ≥ 0.02 — so
  this is a listener-count observation, not a hog. Written down so the Measure
  phase does not "discover" it and rank it.

### Things that look O(everything) and are not — checked, so nobody re-checks

* `maxHeightIn` (`controls.js:839`) — 4 calls/frame, but `CELL` = 6 m and
  `rCam()` is 1–6 m, so it is a 2×2 to 3×3 cell scan.
* The movement substepping (`controls.js:1517`) — `steps = ceil(frameDist /
  4.5 m)`, and `frameDist` is bounded by `DT_MAX = 0.10 s` × the 300 m/s ceiling,
  so **≤ 7 substeps**. It cannot spiral: a slow frame does *not* buy more
  substeps, because `dt` is clamped before it is used. (The cost of that clamp is
  a correctness one — at low fps the camera covers less ground than wall time
  says — not a performance one.)
* `js/night.js:607` `querySourceFeatures` over the basemap's `transportation`
  layer — one-shot, guarded by `_points`, retried at most 5 idles.
* `js/places.js:572` `labelDuplicates` — a full-viewport
  `queryRenderedFeatures` per symbol layer, but it has **no** event registration;
  it is a verification entry point only. Its own docstring warns that calling it
  per `render` "takes the renderer down". Confirm nothing ships calling it.
* `js/app.js:1921` `queryRenderedFeatures` — on `pointerup` inside a tap
  window only.
* `js/lod.js` — debounced 140 ms.
* `js/roofs.js maybeDetail` — guarded by `_detailAsked` after the first fire.

---

## Part 4 — the proposed budget

### 4.1 The two targets

| | frame | why |
|---|---|---|
| **60 fps** | **16.7 ms** | the desktop target, and the only one that makes the AWS screen recording read as smooth |
| **30 fps** | **33.3 ms** | the phone floor and the `performance` preset's floor. `graphics.js` already colours its own fps readout `bad` above 34 ms, so 33.3 is the number the app itself already believes in |

### 4.2 The split, at 60 fps

Main-thread JS gets a **4.0 ms** slice. Everything else belongs to MapLibre's own
render and the compositor, because that is what actually draws the city.

| owner | 60 fps | 30 fps | read it from |
|---|---:|---:|---|
| `controls.js` tick — input, arbitration, collision, feel, `writeToMap` | **1.0 ms** | 2.0 ms | `__fly.tickMsAvg` (see §4.4) |
| `sky.js` `updateSky` per move | **1.5 ms** | 3.0 ms | **no instrument exists — one must be added** |
| entrance label gate (all 3 calls combined) | **0.3 ms** | 0.6 ms | none |
| `outer.js` pitch watch + `lod` + `roofs` + `facades` zoom listeners | **0.2 ms** | 0.4 ms | none |
| wayfind route pulse, when a route is up (Z5, other lane) | **0.5 ms** | 1.0 ms | none |
| slack for GC and event dispatch | **0.5 ms** | 1.0 ms | — |
| **main-thread JS subtotal** | **4.0 ms** | **8.0 ms** | |
| MapLibre render: 41 fill-extrusion passes, symbol placement, GPU submit | **10.7 ms** | 22.3 ms | dropped-frame count |
| compositor + sky canvas texture upload | **2.0 ms** | 3.0 ms | — |
| **total** | **16.7 ms** | **33.3 ms** | |

### 4.3 The amortised budget — work that must never land in one frame

| work | per-occurrence ceiling | max rate | duty cycle |
|---|---:|---:|---:|
| outer-ring scan instalment (`outerStamp`) | **8 ms** | 1 per 1.5 s | 0.53 % |
| trunk field scan instalment (`trunkStamp`) | **8 ms** | 1 per 1.5 s | 0.53 % |
| time-of-day heavy tick (atlas + 11 wrappers + basemap sweeps) | **12 ms** | 4 /s (1/128 quantisation over a 32 s sweep) | 4.8 % |
| shadow rebuild (`shadows.build` + `setData`) | **25 ms** | 1 per 1.28 s during autoplay | 2.0 % |
| roofscape detail fetch + tile (one-shot, on descent) | **—** | once | — |
| entrance file fetch + parse (6.38 MB, deferred) | **—** | once | — |

**8 ms, not 4.** `OUTER_BUDGET_MS` is 4 and `TRUNK_BUDGET_MS` is 3, but both
budgets start the clock *after* `querySourceFeatures` has returned, so neither
constant is the frame cost. 8 ms is set as the ceiling on the *whole* call
including the query — a deliberately loose bound that the 37.9 ms and 841.5 ms
worst cases both blow, which is the point: it is the number the fix has to hit,
not a description of today.

**The worst state the app can be in** is time-of-day autoplay while walking:
per-frame sky redraw at its maximum canvas size, plus 4 heavy tod ticks/s
(≈200 `getImageData` each), plus a 2,428-hull shadow rebuild every 1.28 s, plus
a trunk scan every 1.5 s. That combination has never been measured and it is
plausibly the single worst thing a demo recording could capture. **Measure that
state explicitly.**

### 4.4 What the regression guard should assert

Named so the Measure phase can test them. Every threshold is a prediction; a
threshold that the current build already fails is marked **DEBT** and is a
statement of where the fix must land, not a claim about today.

Readable **today**, with no code change:

| # | assertion | source | note |
|---|---|---|---|
| G1 | `Δ(__fly.tickMsAvg × __fly.ticks) / Δ(__fly.ticks) ≤ 1.5 ms` at cruise | `controls.js:1830` | **`tickMsAvg` is a cumulative mean since load** — a slow boot poisons it forever and it can never show a mid-session regression. Sample `(tickMsAvg, ticks)` twice and difference them; never read it raw. |
| G2 | same, `≤ 2.5 ms` at 1.7 m | | walking adds the trunk scan and the ground blend |
| G3 | `__fly.outerField().maxMs ≤ 8` over a full tour | `controls.js:1769` | **DEBT** — §109 measured 37.9 |
| G4 | `__fly.trunkField().maxMs ≤ 8` over a sustained walk | `controls.js:1779` | **DEBT** — §109 measured 841.5, on a teleporting run |
| G5 | `__fly.trunkField().scans` grows **no faster than** wall-seconds ÷ 1.5 during a walk | | catches the throttle being defeated |
| G6 | dropped frames over a fixed 20 s bearing sweep, min of 5 interleaved counterbalanced reps, headed, occlusion flags on, `cancelGraphicsAutoDetect()` first | `outer-perf.mjs` pattern | the only honest fps number this suite produces |
| G7 | `map.getStyle().layers.length` — record it, then assert it does not grow by more than 2 without a QUEUE entry | | 95 of ours + the kept basemap + the Capitol clones; **the total has never been printed** |
| G8 | **owned by `docs/perf/payload.md`, not by this file.** Its baseline: 2.63 MB gzipped first paint, 75.9 ms eager main-thread parse | `payload.md` §2–3 | do not re-derive it here; two documents with two payload numbers is how a stale figure survives |
| G9 | `__entDefer.firedAt − armedAt` and `sourceLoadedAt − firedAt` | `entrances.js:1497` | the 6.38 MB file must still not be in the boot path |

Needing **one instrument each**, and these are the deliverable of the Measure
phase as much as the numbers are:

| # | assertion | what to add |
|---|---|---|
| G10 | `window.__sky.drawMsMax ≤ 4` and `.drawMsAvg ≤ 1.5` at dusk, 1.7 m | a `performance.now()` pair around `updateSky`'s canvas pass and a `{calls, avgMs, maxMs, canvasH, stars, cloudLobes}` global — the same shape `__fly.outerField()` already uses. **This is the highest-value single line of instrumentation in the app**, because it is the one suspect with no way to test it at all today. |
| G11 | `window.__facadeAtlas.repaintMsMax ≤ 12`, `.imagesPerRepaint` recorded | a timer around `paintTiers` |
| G12 | `window.__shadows.buildMsMax ≤ 25`, `.rebuilds` counted | a timer around `shadows.build` |
| G13 | the entrance gate runs **once** per frame, not three times | a frame-id guard in `wireGate`, and a counter to prove it |

### 4.5 The order the fixes should go in, if the measurements agree

1. **Instrument `updateSky` (G10) before fixing anything.** It is one function,
   it has no owner conflict, and it is the only top-three suspect that cannot be
   tested at all today.
2. **Y7 + Y15 together, one fix.** Both are `querySourceFeatures` returning a
   complete list. The fix written into QUEUE — ask tile by tile instead of
   asking for everything — is the same code shape in both, and doing them
   separately means writing it twice.
3. **Deduplicate the entrance gate** (G13). Three lines, no risk.
4. **Only then** consider the tod-tick cost (atlas + shadows). It is 4.8 % + 2 %
   duty and only while ▶ is on, so it is real but it is not what a still camera
   or a flythrough pays.

---

## Part 5 — what this document does NOT establish

* **No number here was measured tonight.** Nothing has been run. The three
  measured figures quoted (37.9 / 841.5 / 12.3–123 ms) are from HANDOFF §109 on
  a different day and a different machine state; §109 itself calls the 841.5 an
  upper bound because that run teleported.
* **The layer count is not known.** 95 of our own `addLayer` sites is exact;
  the kept basemap layers and the Capitol's cloned layers are not counted
  anywhere and cannot be counted by reading.
* **No GPU cost is predicted, only ranked.** Fill rate, overdraw and the real
  cost of 41 fill-extrusion passes cannot be reasoned about from source; they
  are the top suspect at cruise and the top suspect on a phone, and neither
  claim has any arithmetic behind it.
* **The `updateSky` prediction (2–8 ms) is a guess with a stated falsifier**,
  not a derivation. 520 arcs and 88 radial gradients per frame is the count;
  what canvas2d charges for them on this laptop is unknown.
* **Nothing about the phone is grounded in a phone.** Every mobile ranking above
  is inference from desktop measurements plus the one comment in `facades.js`
  about `getImageData` on iOS.
* **The proposed split (4.0 ms JS / 10.7 ms render / 2.0 ms composite) is an
  allocation, not an observation.** If the Measure phase finds MapLibre's render
  is already 15 ms at cruise, the split is wrong and the budget should be
  rewritten around the measurement rather than the measurement judged against
  the budget.
