# Lowering the camera floor to walking height

**Written 2026-08-05, acer lane. Reading pass only — no browser was opened, no
code was changed, nothing was measured on a running page.** Every number below
comes from one of three places, and each is named where it is used:

* the source of `js/controls.js` (read in full, 1,414 lines) and everything it
  calls;
* arithmetic on the app's own closed forms, using the same instrument §101
  measured on a live page — **`camPx` = 811.82 px at 1440x900, fov 58**
  (`0.5 * 900 / tan(29°)`; §101 read `cameraToCenterDistance` = 811.8 on the
  running library, so the two agree to the digit). At other canvas heights every
  altitude figure here scales linearly with height — the 800x560 viewport
  `scripts/verify/collision.mjs` uses gives `camPx` = 505.1, which is **0.62x**
  these numbers;
* counting over the data files on disk (`data/trees.geojson`,
  `data/outer_ring.geojson`, `data/snapshots/2026-08-05/buildings.enriched.geojson`).

Anything I could not establish this way is in **§9, what I did not verify**.
The brief asked for an honest report of what falls apart. §5 and §6 are that
report; they are longer than the plan on purpose.

---

## 1. The headline

**Changing `ALT_MIN` from 18 to 2 does not put the camera at 2 m.** There are
four other mechanisms that each impose a floor of their own, none of them named
`ALT_MIN`, and three of them are invisible in the sense that nothing in the app
reports them. Ranked by how high a floor they impose:

| # | mechanism | where | floor it imposes | today |
|---|---|---|---|---|
| 1 | `stepFloor` from the step-up branch | `controls.js:1141-1143` | **8 m the moment you press W, over open ground** | hidden by `ALT_MIN` |
| 2 | `ZOOM_MAX` saturation in the derived pose | `controls.js:58, 606` | **18.5 m at nadir, 9.2 m at pitch 60** (1440x900) | already live at pitch < 13° |
| 3 | unnamed `Math.max(outAlt, 12)` | `controls.js:601` | **12 m on the rendered altitude** | hidden by `ALT_MIN` |
| 4 | `ALT_MIN` | `controls.js:85` | 18 m | the one everybody knows about |

So a one-line change ships a camera that says `alt: 2.0` in `window.__fly.eye()`
and renders from 8-18 m depending on where you point it. That is the same class
of defect §101 found, with a different constant, and it would be reported as
"the floor change didn't work".

**My recommendation is therefore a staged approach, and the staging is by
mechanism, not by altitude.** Details in §7. Short version: land the four floors
and the render-truth test first at a floor of **8 m**, then land the
ground-collision retune at **1.7 m**. I would not ship 1.7 m in one PR.

---

## 2. Q1 — every use of `ALT_MIN`, and what each one does

There are **five uses and one load-bearing comment**, plus the unnamed sixth
floor at line 601 that behaves like a seventh use.

**`js/controls.js:85` — the declaration.**
`const ALT_MIN = 18, ALT_MAX = 900, ALT_SLACK = 30;`

**`js/controls.js:374` — a comment that is a dependency, not prose.**
The rationale for `OUTER_MIN_H = 12`: *"Nothing under this can be hit. ALT_MIN is
18 m and blockedAt fires at height + SKIN > alt, so a 12 m building never
blocks"*. This is correct today and **false at any floor under 14.5 m**. Lower
`ALT_MIN` and `OUTER_MIN_H` silently becomes a hole in the collision field —
see §6, risk 4.

**`js/controls.js:1031` — the drive test. This is the clamp on SCRIPTED poses.**

```js
const resolvedAlt = clamp(Math.max(altUser, altFloor), ALT_MIN, altCeiling());
...
const realDrive = inputActive || Math.hypot(vel.e, vel.n) > V_EPS ||
                  Math.abs(alt - resolvedAlt) > 0.05;
```

This is the exact mechanism §101 measured. A `jumpTo` to 5 m sets
`altUser = 5.0` through `syncFromMap()`; `resolvedAlt` is 18; the third term of
`realDrive` is true with nobody touching a key; the controller takes ownership
and flies the camera up over ~2 s. **Nothing else in the file lifts an idle
camera.** It is the only one of the five that acts without user input.

**`js/controls.js:1086` — the clamp on the USER's intent.**
`altUser = clamp(altUser, ALT_MIN, ALT_MAX);` Applied after Q/E, the wheel and
the two touch altitude gestures have been folded into `altUser` multiplicatively.
This is what stops you *descending* below the floor by hand. Note the comment
above it: only the absolute limits touch intent, deliberately, because
`altCeiling()` is pitch-dependent and clamping intent against it would let one
pitch gesture permanently eat altitude.

**`js/controls.js:1176` — the settle-after-move clamp.**
`alt = clamp(Math.max(altUser, altFloor), ALT_MIN, altCeiling());` This is the
one line that resolves the frame's altitude from intent (`altUser`) and the
rooftop floor (`altFloor`). Every collision result reaches the render through
here.

**`js/controls.js:1369` — the debug export.**
`consts: { ALT_REF, ALT_MIN, ALT_MAX, ... }`. Read by
`scripts/verify/pitch-probe.mjs:40`. It is a **snapshot taken at init**, not a
live binding, so a runtime override of the constant would not show up here.

**`js/controls.js:601` — the sixth floor, and it has no name.**

```js
outAlt = Math.max(outAlt, 12);
```

Inside `writeToMap()`, after the feel-effect offsets and after the hard net. It
clamps the **rendered** altitude, not the state, so `window.__fly.eye().alt`
would report 2 m while the map is posed from 12 m. Per CLAUDE.md rule 11 this
should have been a named constant already; it must become one
(`ALT_RENDER_MIN`) before anything else here is touched.

---

## 3. Q2 — what stops the camera entering a building today

**Nothing tests a wall. Everything tests a roof height against the camera's
altitude.** There is exactly one geometric query in the whole file:

```js
maxHeightIn(lng, lat, r)   // controls.js:524 — "THE ONE CHOKE POINT"
```

It returns *the tallest roof within `r` metres of a ground position*, from two
fields:

* **the core grid** — `Float32Array`, `CELL = 6` m, rasterised once at init from
  `scene.buildings.final_height` and `scene.parts.h` (scanline fill plus a
  half-cell edge walk). Extent measured off
  `data/snapshots/2026-08-05/buildings.enriched.geojson`: 2,496 x 2,224 m, so
  418 x 373 cells = **624 KB**. 2,453 buildings, from 1.7 m to 97.5 m.
* **the outer field** — a sparse `Map`, `OUTER_CELL = 10` m, **axis-aligned
  bounding boxes**, filled incrementally from whatever tiles the `austin-outer`
  source is currently holding, and **filtered to `h > OUTER_MIN_H = 12`**.

Everything else is a comparison against that one number:

| consumer | line | test |
|---|---|---|
| `blockedAt` (block-and-slide) | 623 | `maxHeightIn(...) + SKIN > alt`, `SKIN = 2.5` |
| step-up / skim | 1141 | `hObs + SKIN - alt <= STEP_UP`, `STEP_UP = 12` |
| rooftop floor `altFloor` | 1162-1174 | `roof > 0 ? roof + SKIN_V : 0`, `SKIN_V = 8`, with a 0.5 s look-ahead |
| speed brake | 657-667 | same test at 0.9 / 0.5 / 0.25 s ahead → cap 0.55 / 0.30 / 0.12 |
| wall deflect probes | 642-649 | same test 10 m ahead, ±40° |
| hard net (state) | 1179-1182 | `alt < h + HARD_CLEAR` → `alt = altUser = h + HARD_CLEAR`, `HARD_CLEAR = 4` |
| hard net (render) | 597-600 | same, applied to `outAlt` after the feel offsets |

**So "the camera cannot enter a building" is true today only because the camera
is always above every roof + 2.5 m.** `blockedAt` is a *height* test wearing a
wall's clothes: it says "the roof here is too tall for your current altitude",
and block-and-slide then refuses the step. That is a correct and cheap wall test
**for a camera that is high**, and it degenerates completely when the camera is
low. Three ways:

1. **`blockedAt` is not guarded on "is there a building here at all."**
   `maxHeightIn` returns `0` over open ground, and `0 + SKIN(2.5) > alt` is
   **true for any `alt` below 2.5 m**. At a 2 m floor every cell in Austin
   reports blocked, including the middle of the South Mall.
   `speedBrake` (line 664) and `wallDeflect`'s probes (647-648) have the same
   unguarded comparison. The three guarded sites — 599, 1166, 1181 — all test
   `h > 0` first; these three do not.

2. **Because of (1), the step-up branch fires over empty ground and becomes an
   8 m floor.** Trace it at `alt = 2` over grass: `blockedAt` is true →
   `hObs = 0` → `hObs + SKIN - alt = 0.5 <= STEP_UP = 12` → *"low enough to skim
   over"* → `stepFloor = max(stepFloor, 0 + SKIN_V) = 8` → the rooftop floor
   takes `want = max(want, stepFloor) = 8` → `altFloor` climbs to 8 at
   `LIFT = 45` m/s. **You press W and the camera rises to 8 m in under a
   quarter of a second, over nothing.** This is risk #1 in §6.

3. **Even with (1) fixed, `STEP_UP = 12` means "anything up to 12 m above your
   eye is a step you skim over."** At 18 m that is a parapet. At 1.7 m it is
   **54.2% of the campus snapshot** (1,329 of 2,453 buildings are ≤ 8 m) and it
   throws you to `roof + SKIN_V` — a 6 m house launches the camera to 14 m.
   `SKIN_V = 8` is also wrong at walking height: it is the clearance you keep
   *above a roof you are riding*, and 8 m above a one-storey roof is a third
   floor.

**Resolution and standoff.** `R_CAM = 6` m is the probe radius, and the core
grid over-covers a footprint by up to one cell (`CELL = 6` m) because the edge
walk stamps whole cells. Worst case the camera is stopped **~9-12 m from a
facade**. At 18 m nobody could tell. At walking height it means **you cannot
stand on the sidewalk**, and the 584 doors and 24 lobbies this pass is for are
2-4 m from their own wall. This is risk #3.

**Coverage.** 92.2% of the campus snapshot (2,261 of 2,453) is under 18 m, so
**the block-and-slide path has never been exercised against 92% of the buildings
it indexes.** It is not that walls were never asked about; it is that only the
192 tallest have ever been able to answer.

---

## 4. Q3 — trees

**Collision does not know trees exist.** `maxHeightIn` reads the core grid
(built from `scene.buildings` and `scene.parts` only, `buildHeightField`,
line 261) and the outer field (built from the `austin-outer` source only,
`outerStamp`, line 397). `austin-trees` and `austin-trees-capitol` are never
queried by `js/controls.js`. Neither are `austin-props` (532 lamps, 3,589 street
furniture, 34 artworks), the entrances source, or the ground source.

Measured on `data/trees.geojson` (67,443 features = **7,559 trunks + 59,884
canopy tiers**, clustering to **22,974 distinct crowns** by centroid):

| | |
|---|---|
| trunk radius | p5 **0.26 m**, median **0.46 m**, p95 0.82 m, max 0.90 m |
| trunk height | p5 2.9 m, median **3.83 m**, p95 7.38 m — **100% are taller than 2 m** |
| canopy tier radius | median **4.27 m**, p95 9.08 m, max 12.84 m |
| **lowest canopy tier base, per crown** | p5 0.83 m, p10 1.01 m, p25 1.89 m, **median 2.75 m** |
| crowns whose foliage starts below 2.0 m | **27.7%** |
| crowns whose foliage starts below 3.0 m | **57.5%** |

So at 1.7 m of eye height: **every trunk in the city is a solid object at eye
level and you pass straight through all 7,559 of them**, and for **27.7% of
crowns** the eye also passes through leaves. Because MapLibre back-face-culls
fill-extrusions, entering a canopy does not look like being inside a tree — the
canopy simply **vanishes** and reappears when you leave. That reads as a
rendering bug, not as foliage.

**Do not put canopies in the collision field.** A median crown is 4.27 m of
radius and `R_CAM` is 6 m; canopy collision would wall off every tree-lined path
on campus and make the South Mall impassable. The right answer is
**trunk-only**, with its own small radius (`R_TRUNK`, ~0.6 m + the trunk's own
radius), gated to fire only below the ground-mode threshold so the flyover pays
nothing. 7,559 trunks at `OUTER_CELL`-style stamping is a trivially small field.

Passing through leaves I would **document and accept** for now. It is the least
bad of the three options and the alternative (hiding canopies near the camera)
is a whole pass of its own.

---

## 5. Q4 — movement speed

**Speed already scales with altitude, and the scaling is already dead at 18 m.**

```js
// controls.js:60 and 1093
const SPEED_REF = 40, SPEED_EXP = 0.75, SPEED_MIN = 6, SPEED_MAX = 120;
const spdBase = clamp(SPEED_REF * Math.pow(alt / ALT_REF, SPEED_EXP), SPEED_MIN, SPEED_MAX);
```

`ALT_REF` is the spawn altitude, set once at init (line 1348) — **162.9 m** for
`SPAWN` z16.5 / pitch 74 at 1440x900, not the 230 the fallback suggests.
Evaluating the curve (with `ALT_REF = 230`, the value the constant block was
tuned against; at 162.9 every figure below is ~1.3x higher and the conclusion is
unchanged):

| altitude | curve says | after `clamp(..., 6, 120)` | with Shift (2.5x) |
|---|---|---|---|
| 1.7 m | 1.01 m/s | **6.0 m/s** | 15.0 m/s |
| 2 m | 1.14 m/s | **6.0 m/s** | 15.0 m/s |
| 4 m | 1.92 m/s | **6.0 m/s** | 15.0 m/s |
| 8 m | 3.22 m/s | **6.0 m/s** | 15.0 m/s |
| 18 m | 5.92 m/s | **6.0 m/s** | 15.0 m/s |
| 30 m | 8.68 m/s | 8.7 m/s | 21.7 m/s |
| 230 m | 40 m/s | 40 m/s | 100 m/s |

**`SPEED_MIN = 6` binds at every altitude below 18.2 m** — which is to say, at
every altitude the floor change is about. 6 m/s is **21.6 km/h**, a fast
cyclist; with Shift it is 54 km/h. Walking is 1.4 m/s. So today's speed at
walking height is **4.3x too fast**, and the brief is right that this would feel
worse than clipping.

**The proposal is one number.** Lower `SPEED_MIN` to **1.0 m/s** and the
existing curve does the whole job, continuously, with no mode and no branch:
1.0 m/s at 1.7 m, 1.9 at 4 m, 3.2 at 8 m, 5.9 at 18 m, unchanged above. Sprint
gives 2.5 m/s at 1.7 m, which is a jog. Nothing above 18.2 m changes by a single
digit, so **the flyover is arithmetically untouched.**

Two feel constants also need attention at this scale, both already in `TUNE`:

* `BOB_AMP_ALT = 0.45` m. At 162 m that is invisible; at 1.7 m it is **26% of
  eye height** — a pronounced bounce. Wants an altitude-scaled amplitude or its
  own ground value.
* `SETTLE_AMP = 0.7` m. The landing dip would take a 1.7 m eye to 1.0 m. That
  might actually read as a knee-bend and be *good*; it needs looking at, not
  reasoning about.

`TAU_ACCEL`/`TAU_DECEL` (0.20 / 0.45 s) are fine at walking pace, and
`BRAKE_PROBES` are specified in *seconds ahead*, so the speed brake rescales
itself for free.

---

## 6. Q5 — zoom, altitude, and whether you can look up at a tower

### The mapping

`writeToMap`, lines 602-606:

```js
const lead = outAlt * Math.tan(rad(outPitch));            // centre runs ahead of the eye
const D    = outAlt / Math.cos(rad(outPitch));            // camera-to-centre distance
const z    = clamp(Math.log2(C * cos(cLat) * camPx / (512 * D)), ZOOM_MIN, ZOOM_MAX);
```

At this latitude and 1440x900 that reduces to **`z = log2(5.4788e7 / D)`**, and
inverting it at `ZOOM_MAX = 21.5` gives a **minimum expressible
camera-to-centre distance of `D_min` = 18.47 m**. Since `alt = D·cos(pitch)`:

| pitch | lowest altitude the pose can express (1440x900) |
|---|---|
| 88° (horizon) | **0.64 m** |
| 85° | 1.61 m |
| 80° | 3.21 m |
| 70° | 6.32 m |
| 60° | 9.23 m |
| 45° | 13.06 m |
| 5° (near nadir) | 18.40 m |

Read the other way: **at 1.7 m of eye height the pose is only expressible at
pitch ≥ 84.7°.** Point the camera any further down and `z` saturates at
`ZOOM_MAX`; MapLibre then places the camera 18.47 m from the centre instead of
the 2-5 m that was asked for, so **the eye slides backwards and upwards along
its own view ray** — at pitch 60 it ends up at 9.2 m altitude and 12.5 m behind
where the state says it is. `window.__fly.eye()` keeps reporting 1.7 m
throughout, because the eye state is genuinely 1.7 m; it is the render that
lies.

This is live **today**, at 18 m, in the pitch 5-13° band. Nobody has noticed
because nobody flies at near-nadir. It is the same failure mode as the
look-up teleport documented at line 553-570, in the opposite direction, and the
comment there is the reason to take it seriously: *"a previous pass multiplied
dMax here by 2.8 ... and the report back was that looking up TELEPORTED the
camera to the edge of the map."*

**`ZOOM_MAX` must rise with the floor.** The required values, again at
1440x900:

| target | pitch 88 | 80 | 70 | 60 | 45 | 5 |
|---|---|---|---|---|---|---|
| alt 8 m | 21.87 | 20.19 | 21.16 | 21.70 | 22.20 | 22.71 |
| alt 1.7 m | 20.10 | 22.42 | 23.39 | 23.94 | 24.44 | **24.94** |

The app never sets `maxZoom` (`js/app.js:303-309` sets `maxPitch: 88` and
nothing else), so MapLibre's default of **22** applies and `ZOOM_MAX = 21.5` was
chosen to bind first. **8 m needs `maxZoom` ≈ 23; 1.7 m with a free pitch needs
≈ 25.** Whether MapLibre 5.24 accepts those, and what it does to symbol
placement and to depth precision if it does, is measurable in an afternoon with
the `scripts/verify/pitch-probe.mjs` pattern — and it is **not** something to
reason about, given that file's own history of the library accepting
`setMaxPitch(120)` and silently still doing 90.

**If the library refuses, the honest fallback is to raise `PITCH_MIN` when
low** — i.e. below the ground threshold you may not look at your own shoes —
rather than to let the camera silently pull back. Blocking an input is the
pattern this file already chose (line 544: *"These BLOCK input; they never move
the camera"*).

### Looking up at a tower: no, and it is not fixable here

`PITCH_MAX = 88`, and lines 67-83 record that this was verified against the
running library: MapLibre 5.24's hard ceiling is exactly 90° regardless of
`setMaxPitch`, pitch is measured from straight down, and the derivation goes
singular at 90. The top of the frame therefore sits at
`pitch − 90 + fov/2` above horizontal: **27° at the default 58 fov, 41° at the
menu's 82 fov maximum.**

The UT Tower is 94 m. Standing at its base at 1.7 m, its top is 71° above
horizontal. **It is not expressible.** To fit the Tower in frame at eye level
you must stand **~180 m away** (58 fov) or ~108 m (82 fov). Same arithmetic for
every West Campus tower: The Standard at ~57 m needs 112 m of standoff at the
default fov.

So the honest sentence for the report to Simeon is: *at walking height you can
look at a doorway, a shopfront, a stair, a tree and the bottom four storeys of
anything. You cannot look up at a skyscraper — the renderer cannot tip the
camera past horizontal, and that has nothing to do with the floor.* If
looking-up matters, it is a separate and much larger pass (a lower `ZOOM_MIN`,
per line 566-570, which re-budgets every layer's minzoom).

---

## 7. The plan

### The value: `ALT_MIN = 1.7`

Not 2.0, and here is why. The entrances bake authors a **2.44 m door head**
(HANDOFF §103, re-measured against the 4.41 m canopy underside) and 0.35 m stair
treads; the West Campus lobby storefront mullions are 3.95 m tall. At a 2.0 m
eye the door head is only 0.44 m above you and doorways read squat. At **1.7 m**
you are at the eye height the ground-floor pass was authored for — US adult eye
height is 1.56-1.68 m — the 2.44 m head sits properly overhead, and the 4.41 m
canopy underside clears by 2.7 m, which is what "you walk under it" means.

It is one named constant and Simeon can move it to 1.5 or 1.9 in one line.

### Order

**PR-1 — "the floor is real" (target floor: `ALT_MIN = 8`).**
Nothing here changes the feel; it makes the floor mean what it says.

1. Name the constant at line 601: `ALT_RENDER_MIN`, set to 0.5.
2. Guard the three unguarded height tests on `h > 0`: `blockedAt` (623),
   `speedBrake` (664), `wallDeflect`'s probes (647-648). **This is the single
   most important change in the whole plan** — without it the camera cannot
   move at any altitude below `SKIN = 2.5` m, and below `SKIN_V = 8` m it is
   thrown to 8 m the moment it does.
3. Raise `ZOOM_MAX` and set `maxZoom` on the map, after probing what the library
   will actually take. Add `ALT_MIN` → required-`ZOOM_MAX` as a derivation with
   a comment, not as two numbers that can drift.
4. `ALT_MIN = 8`.
5. **New instrument: `scripts/verify/render-truth.mjs`.** At a set of
   (altitude, pitch) poses, assert that MapLibre's own
   `transform.cameraToCenterDistance / transform.pixelsPerMeter` equals
   `window.__fly.eye().alt` to within 0.2 m. This is the test that catches every
   silent-pull-back defect in this document, including the one that is live at
   18 m today, and no test in the suite does it.
6. Re-run `collision.mjs`, `motion-feel.mjs`, `lookup-check.mjs`,
   `pitch-probe.mjs`. Screenshot the same six §101 poses at 8 m.

**PR-2 — "walking height" (`ALT_MIN = 1.7`).**

7. `STEP_UP` and `SKIN_V` become altitude-relative or get ground values
   (`STEP_UP_GROUND` ≈ 0.5 m — a curb, not a storey; `SKIN_V_GROUND` ≈ 0.8 m).
8. `R_CAM_GROUND` ≈ 1.2 m, applied only below `ALT_GROUND`, so you can approach
   a facade. This alone leaves the `CELL = 6` m raster over-cover, so also:
9. A **local fine grid** — `CELL_GROUND` = 1 m over a 400 x 400 m window around
   the eye, rebuilt on a 100 m move, 160k cells = **640 KB**. (A global 1 m grid
   over the current extent would be **22.2 MB**; at 2 m it is 5.6 MB. Local is
   the right shape.) If this is cut, the fallback is a 6-9 m standoff from every
   wall, which means no door photography — say so rather than shipping it
   quietly.
10. `SPEED_MIN = 1.0` (§5), and the two `TUNE` amplitudes.
11. `OUTER_MIN_H` becomes altitude-gated: 12 m while flying, ~2.5 m below
    `ALT_GROUND`, with a forced rescan on the crossing. Without this you walk
    through **83.6% of the outer ring** (7,652 of 9,149 buildings are ≤ 12 m) —
    everything off-campus that is not a tower.
12. Trunk-only tree collision (§4), gated below `ALT_GROUND`.

**Deferred, named, not fixed:** canopy pass-through (§4), looking up at towers
(§6), roof top faces carrying no texture (QUEUE X7 — irrelevant once you are
under them).

### The one thing that must not move

The flyover is safe by arithmetic, not by hope. Every scripted pose in the app
is two orders of magnitude above any floor discussed here (1440x900):

| pose | zoom / pitch | eye altitude |
|---|---|---|
| `SPAWN` | 16.5 / 74 | **162.9 m** |
| `INTRO.start` | 16.2 / 78 | 185.9 m |
| `INTRO.crest` | 15.45 / 71 | 401.6 m |
| `INTRO.end` | 16.9 / 72 | 138.4 m |
| `TOUR` legs | 16.5-17.1 / 71-75 | 114-183 m |
| `ORBIT` (tap a label) | 17.1 / 73 | **113.9 m** |

The lowest scripted altitude in the repo is 113.9 m. Lowering the floor cannot
reach any of them. What *can* reach them is item 3 — changing `ZOOM_MAX` or
`maxZoom` touches the derivation every pose runs through — so
`intro-timeline.mjs` and a tour screenshot belong in PR-1's verification even
though nothing about the intro was edited.

---

## 8. Risks, ranked, and what breaks

1. **The 8 m step-up floor (§3.2).** Certain, not probable — it follows from the
   code by inspection. Ships as "you lowered the floor and nothing happened."
   Fixed by item 2. **This is the risk that makes me recommend staging**: it and
   the `ZOOM_MAX` pull-back are both *silent*, and a pass that fixes the floor
   without an instrument that can see them is a pass that reports success wrongly.
2. **The `ZOOM_MAX` pull-back (§6).** Certain below 84.7° of pitch at 1.7 m.
   Fixed by item 3, *if* the library allows it — and if it does not, the design
   has to change (raise `PITCH_MIN` when low). This is the one unknown in the
   plan that could force a rethink rather than a retune.
3. **You cannot reach a facade (§3, resolution).** 6-12 m of standoff from
   `R_CAM` + `CELL`. Directly defeats the reason for doing this at all — 584
   doors, 24 lobbies, recessed shopfronts. Fixed by items 8 + 9; item 9 is the
   biggest single piece of new code in the plan.
4. **You walk through 83.6% of the off-campus city (§7 item 11).** Certain, and
   the worst-looking defect of the set — a first-time visitor at walking height
   in West Campus walking through a house. Note the campus snapshot itself is
   *fine*: all 2,453 buildings down to 1.7 m are already in the core grid.
5. **Trees (§4).** Certain. 7,559 trunks passed through; 27.7% of crowns pop
   away as you enter them.
6. **Walking at 21.6 km/h (§5).** Certain. One constant.
7. **Frame cost at ground level.** `js/lod.js` hides tiers when
   `alt > renderDistance`, so at 1.7 m **every** fine-tier layer is visible, at
   z23-25, with entrance mullions (`mullionMinZoom` 18.6), the pool circles and
   full tree density all on. Nothing in the perf budget has ever been measured
   at this altitude. Unquantified — needs `perf.mjs` (which throttles the CPU 4x
   by default; quote the setting with the number).
8. **Geometry quantisation at high zoom.** `window.PATTERN_TILING` caps the
   patterned sources at `maxzoom: 16`, and geojson-vt's 4096-unit extent over a
   527 m z16 tile is a **12.9 cm** quantisation grid. Invisible at 18 m; at 1.7 m
   and z24 that is several pixels of stair-step on every facade. `entrances`
   tiles at maxzoom 18 (3.2 cm) and is better, but its mullions are 0.10 m deep.
   Cheap to check, potentially annoying to fix.
9. **Z-fighting and depth precision** on 0.06-0.35 m stair treads and reveals at
   z24. Plausible, unmeasured.
10. **`window.__fly.consts` is a snapshot** (§2, line 1369). Any verification
    that reads it after a runtime override reads the wrong number. Small, but it
    is exactly the kind of instrument defect this project has been bitten by.

---

## 9. Constants, and which to expose

Per CLAUDE.md rule 11, every value above is a named constant in the tuning block
at `js/controls.js:56-105`, none of it inline. New or renamed:

| constant | proposed | what it is |
|---|---|---|
| `ALT_MIN` | **1.7** | the floor. **Simeon's dial.** |
| `ALT_RENDER_MIN` | 0.5 | replaces the bare `12` at line 601 |
| `ALT_GROUND` | 12 | below this, ground-mode parameters take over. **Simeon's dial** — it decides where the city stops being a flyover |
| `ZOOM_MAX` | derived from `ALT_MIN` | with the derivation written out, not a second magic number |
| `R_CAM_GROUND` | 1.2 m | probe radius when low |
| `CELL_GROUND` | 1.0 m | local fine grid resolution |
| `GRID_GROUND_SPAN` | 400 m | local fine grid window |
| `STEP_UP_GROUND` | 0.5 m | a curb, not a storey |
| `SKIN_V_GROUND` | 0.8 m | clearance above a surface you are standing on |
| `SPEED_MIN` | **1.0** | walking pace falls out of the existing curve. **Simeon's dial** |
| `R_TRUNK` | 0.6 m | trunk collision radius, added to the trunk's own |
| `OUTER_MIN_H_GROUND` | 2.5 m | low-rise outer-ring collision when low |
| `TUNE.BOB_AMP_ALT_GROUND` | ~0.08 m | the hover bob at 1.7 m |

**Expose four**: `ALT_MIN`, `ALT_GROUND`, `SPEED_MIN`, and
`TUNE.BOB_AMP_ALT_GROUND` (the last is already live-editable through
`window.__fly.tune`). Those are the four that change how it *feels*. The rest
are correctness, and per CLAUDE.md rule 9 they are the lane's call.

`window.__fly.consts` should become a **function** returning live values, so a
runtime retune is visible to a verification.

---

## 10. What I did not verify

Everything in §6 about `ZOOM_MAX` and `maxZoom` is arithmetic on the app's own
closed form plus MapLibre's documented default of 22. **I did not open a browser
this pass, so:**

* I have not confirmed MapLibre 5.24 accepts `maxZoom` above 22, nor what
  happens to symbols, depth precision or `queryRenderedFeatures` if it does.
  This is the plan's one genuine unknown and it gates PR-1 item 3.
* I have not watched the 8 m step-up floor happen. I am confident it follows
  from lines 623, 1137-1143 and 1166-1168 by inspection, but this repo's own
  law is *verify by looking*, and I have not looked.
* Every altitude is computed at 1440x900 / fov 58. The verify suite runs
  800x560 (`collision.mjs`) and the graphics menu lets the user set fov to 82;
  both move `camPx` and therefore every `D_min` here.
* `ALT_REF` is the spawn altitude read at init. I computed 162.9 m from
  `SPAWN`; I did not read it off a running page, and the constant block's
  fallback of 230 suggests somebody once measured something else.
* No pixels. There are no before/after pictures in this document because the
  brief was a reading pass. **The pass that changes the floor must end with the
  six §101 poses re-shot** — that is the picture Simeon should be shown, and it
  is the only honest way to answer "does walking height look good."
