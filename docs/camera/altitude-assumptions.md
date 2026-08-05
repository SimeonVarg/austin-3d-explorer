# Everything in this city that assumes the camera is far away

Written 2026-08-05, acer lane. **A codebase and data audit. No browser was
opened, no pixel was measured, no code was changed.** The one file this pass
wrote is this one.

Read `docs/camera/at-eye-level.md` (the parallel lane's measured pass) beside
this. That one looks; this one reads. Where they disagree, **the frame wins** —
that is CLAUDE.md rule 10 and it is not negotiable just because the arithmetic
here is tidy.

## How to read the claims

Every finding is tagged:

* **[CODE]** — read straight out of the file at the line quoted. Not in doubt.
* **[ARITH]** — derived from a [CODE] value with the projection maths in
  `js/controls.js` and `js/facades.js`. The inputs are quoted so the sum can be
  checked. Right unless I dropped a factor.
* **[PRIOR]** — taken from a previous pass's measurement in `HANDOFF.md`,
  cited by section.
* **[LOOK]** — I believe this and I have not seen it. **One screenshot settles
  it.** These are listed together in §8 so they can be shot in a batch.

Projection constants used throughout, all from `js/controls.js:47-53`:

```
C     = 40030228.884 m                     (2 pi R)
lat   = 30.2857                            (SPAWN, js/app.js:28)
camPx = 0.5 * canvasClientHeight / tan(fov/2)
      = 811.8 px    at 900 px canvas, fov 58
mpp(z)= C * cos(lat) / (512 * 2^z)
      = 1.030 m per CSS px at z16          (facades.js quotes 67551/2^z; agrees to 0.1%)
alt   = camPx * mpp(z) * cos(pitch)        (js/controls.js:584-585, 606-611)
```

The whole document turns on that last line. **In this app altitude is not a
free variable.** It is `zoom x pitch x canvas height x field of view`, and the
flycam derives the map pose from the eye rather than the other way round
(`js/controls.js:11-14`). Four of the biggest findings below are consequences
of that one architectural choice, not of anybody's taste.

---

## 1. THE HEADLINE: `ALT_MIN` is not the floor. There are five floors and three of them bind first.

`js/controls.js:85` `ALT_MIN = 18` is the one that was found this week. It is
**the third-lowest of five independent mechanisms** that lift the camera, and
if it is the only one that changes, **the camera does not go below 12 m at any
pitch and does not go below 8.1 m at the pitch the app cruises at.**

| # | mechanism | file:line | what it enforces | binds at |
|---|---|---|---|---|
| 1 | `ALT_MIN` | `js/controls.js:85` | eye ≥ 18 m | everywhere |
| 2 | **write-path floor** | `js/controls.js:606` | `outAlt = max(outAlt, 12)` | everywhere, **after** #1 |
| 3 | **`ZOOM_MAX`** | `js/controls.js:58` | z ≤ 21.5, so `alt ≥ 18.49·cos(pitch)` | **pitch-dependent, see below** |
| 4 | rooftop floor | `js/controls.js:1165-1171` | `roof + SKIN_V (8)` within `R_CAM` (6 m) | near any building |
| 5 | hard net | `js/controls.js:603-605` | `roof + HARD_CLEAR (4)` within `R_CAM` | near any building, on the write |

**Classification: STRUCTURAL.** Not because any one is hard to change — each is
a one-line constant — but because #3 is not a constant at all. It is an
identity.

### 1a. The write-path floor, `js/controls.js:606` [CODE]

```js
outAlt = Math.max(outAlt, 12);
```

Undocumented, no comment, sitting between the hard net and the pose derivation.
`ALT_MIN` never reaches this line — `alt` has already been clamped upstream —
so nothing in the file makes it obvious that this is a *second, independent*
floor. Lower `ALT_MIN` to 2 and leave this alone and the camera renders at 12 m
while `__fly.eye().alt` reports 2. That is the exact shape of the bug §101
spent a session on: **the state and the shutter disagree.**

*(The working tree in this worktree already carries an uncommitted
`// LOCAL RECON PATCH` from the parallel lane that ties this to `ALT_MIN`. Every
line number and value in this document is `origin/main`'s, which the patch
preserves as its default.)*

### 1b. `ZOOM_MAX` is a pitch-dependent altitude floor and nobody wrote that down [ARITH]

`js/controls.js:610-611`:

```js
const D = outAlt / Math.cos(rad(outPitch));
const z = clamp(Math.log2(C * Math.cos(rad(cLat)) * camPx() / (512 * D)), ZOOM_MIN, ZOOM_MAX);
```

Solve the clamp for altitude. At `ZOOM_MAX = 21.5`, 900 px canvas, fov 58:

```
D_min = C·cos(lat)·camPx / (512 · 2^21.5) = 18.49 m
alt_min(pitch) = 18.49 · cos(pitch)
```

| pitch | lowest reachable eye | what you are looking at |
|---|---|---|
| 5° | **18.40 m** | straight down |
| 30° | 16.00 m | steep oblique |
| 45° | 13.06 m | oblique |
| 64° | **8.10 m** | the app's own cruise pitch |
| 74° | 5.09 m | the spawn pitch |
| 80° | 3.21 m | |
| 84° | 1.93 m | |
| 88° | 0.65 m | `PITCH_MAX`, the horizon |

Three things fall out of this table and all three matter.

1. **`ALT_MIN = 18` and the `ZOOM_MAX` floor at low pitch (18.40 m) agree to
   within 2%.** I think that is why 18 was chosen and why it survived so long
   unnoticed: at the pitch you use to look *down* at the city, the two floors
   are the same number, so removing one changes nothing you can see. [ARITH,
   and the "why" is inference — flag it as such.]
2. **Low altitude and low pitch are mutually exclusive.** You can stand at 2 m
   and look at the horizon. You cannot stand at 2 m and look at the pavement,
   the steps, the stair nosings, the kerb, or anything else in the bottom third
   of a pedestrian's view — at pitch 45 the floor is 13 m. A walking-directions
   tool that wants "look down at the junction you are standing in" cannot have
   it from this constant.
3. **The reachable floor moves with the browser window and with the graphics
   menu.** `camPx` is linear in `clientHeight` and inverse in `tan(fov/2)`
   (`js/controls.js:51-52`), and `fov` is a user slider, 42–82°
   (`js/graphics.js:151`). At pitch 64: a 1080 px window gives 9.72 m; fov 82
   gives 5.16 m; fov 42 gives 11.7 m. **A 2.3x spread on the floor, set by two
   controls that have nothing to do with altitude.**

When the clamp bites, the pose written is *internally inconsistent*: the lead
to the map centre is computed from the requested `outAlt`
(`js/controls.js:607-609`) while the rendered camera sits at `D_min`. At pitch
80 asking for 2 m puts the eye **6.9 m further back along the bearing than
asked**, as well as 1.2 m higher. Then on hand-back `syncFromMap()`
(`js/controls.js:580-588`) reads the *rendered* pose and writes it into
`altUser`, so the camera "settles" upward with nobody touching a key — the same
observable behaviour §101 attributed to `ALT_MIN`, from a completely different
cause. [ARITH + [LOOK]]

`ZOOM_MAX`'s comment says "under MapLibre's own maxZoom so our clamp binds
first". MapLibre's default is 22; the library accepts up to 24. Raising to 22
buys 5.72 m at pitch 64, not 2 m. **There is no value of `ZOOM_MAX` inside
MapLibre's range that gives 2 m at a cruise pitch.** To get 2 m at pitch 64 you
need z ≈ 23.5. This is the single hardest constraint in the whole audit.

### 1c. `R_CAM = 6` sets a minimum standoff from every wall [CODE + ARITH]

`js/controls.js:99`, `1165`, `603-605`, `623`. `maxHeightIn(lng, lat, R_CAM)`
scans the height grid over a **±6 m box** (`js/controls.js:527-533`) built from
6 m cells, so its worst-case reach is one cell of over-scan: **6 to 12 m**.
Inside that reach:

* the rooftop floor lifts to `roof + 8`,
* the write-path hard net lifts to `roof + 4`,
* `blockedAt` (`:623`) is `roof + 2.5 > alt`, which at `alt = 2` is true for
  **any indexed building at all**, so movement is blocked as well as lifted.

**Consequence, and it is the one that decides whether a walking mode is worth
building: at 2 m of eye height you cannot get closer than roughly 6–12 m to any
building.** A campus sidewalk is 2–4 m wide and runs against the wall. So a
pedestrian camera does not walk on the pavement — **it walks down the middle of
the road.** You cannot stand under the West Campus canopies (`WC_CAN_PROJ` =
2.60 m, `scripts/bake_entrances.py:530`), you cannot enter a recessed shopfront
bay (0.32 m notch, `scripts/bake_places.py` §1), and you cannot get within
arm's reach of any of the 584 doors the last pass built. This is
`shots/lobbies/final/30-X4-CAMBRIDGE-TOWER-*` (HANDOFF §104) restated as a
general law rather than as one building's bug. [PRIOR + ARITH]

### 1d. `OUTER_MIN_H = 12` is justified *verbatim* by `ALT_MIN = 18` [CODE]

`js/controls.js:374-381`:

> `// Nothing under this can be hit. ALT_MIN is 18 m and blockedAt fires at`
> `// height + SKIN > alt, so a 12 m building never blocks`

This is the cleanest example in the repo of a decision whose premise the change
invalidates. **8,236 of the 8,428 outer-ring buildings are under 60 m and every
one under 12 m is absent from the collision field entirely.** At 18 m that was
free. At 2 m every two-storey house in West Campus and every low-rise downtown
is a ghost you walk through. Removing the filter is a one-line change; the
comment says it "cuts the work by roughly an order of magnitude", so the cost
is real and lands on `OUTER_BUDGET_MS = 4` (`:389`) — the scan gets slower, not
the frame. **UGLY, cheap to fix, must be fixed with the floor or the floor
lies.**

### 1e. What has no collision at all [CODE]

`buildHeightField()` (`js/controls.js:261-270`) reads exactly two things:
`scene.buildings.features['final_height']` and `scene.parts.features['h']`.
Nothing else. So there is **no collision whatsoever** for:

trees (`austin-trees`), props — lamp posts, bollards, benches, hedges
(`austin-props`), every entrance piece — steps, ramps, rails, canopies, piers
(`austin-entrances`), every shopfront (`austin-places`), the ground decks and
kerbs (`austin-ground`), and the Capitol's ground plane.

Simeon was told "at 2 m the camera can bump into buildings and trees". **Half
of that is not true and he should be told:** the camera bumps into *building
masses*. It passes straight through every tree trunk and every tree crown, and
through everything the ground-floor pass just built. At 18 m that was invisible
because you were above all of it. At 2 m walking through a live oak is the
first thing anyone will notice. **STRUCTURAL for a walking mode** (trees would
need to go into the height field, which is 7,414 crowns' worth of new
rasterisation work at load), **HARMLESS for a "let me look at the doors"
mode.**

---

## 2. The facade pattern: the one that genuinely does not survive

**Classification: STRUCTURAL. This is the worst finding in the document and it
is not close.**

`js/facades.js:145` `const TIER_CSS = 32;` — and the mechanism, spelled out at
`js/facades.js:44-56` and `:88-96`:

> `one repeat covers image.width / image.pixelRatio CSS PIXELS of screen, at
> every zoom`

The pattern is **screen-locked**, not world-locked. One repeat is
`TIER_CSS · 67551 / 2^floor(cameraZoom)` metres of wall. [CODE]

| camera zoom | m of wall per repeat | `mh` storey height (8 rows) |
|---|---|---|
| 16 (spawn) | 33.0 | **4.1 m — correct** |
| 17 | 16.5 | 2.06 m |
| 18 | 8.25 | 1.03 m |
| 19 | 4.13 | 0.52 m |
| 20 | 2.06 | 0.26 m |
| 21 (eye level) | **1.03** | **0.13 m** |

[ARITH, from `js/facades.js:229` `GRIDS.mh = {rows: 8, cols: 5}`]

**At eye level a campus hall carries 8 window rows and 5 window columns in every
metre of wall — a window every 13 cm, both ways, at 16 mm per texel because the
near tier keeps all 64 texels.** It is not blurry. It is a sharp, fine,
regular mesh. The word for what that looks like is *fabric*, or *speaker
grille*, and it will be most of the frame in any eye-level shot that is not
pointed at a door.

Two things this means that are worth stating plainly:

1. **The facades were never right below about 92 m of altitude, and that is not
   news the 18 m floor caused.** z18 is reached at `alt = 209·cos(pitch)` = 91.6
   m at pitch 64 [ARITH]. Below that the storey is already under a metre. The
   only reason the 24 lobby photographs at 18 m read as "a real ground floor"
   (HANDOFF §101) is that what you are looking at there is **`entrances.js`
   geometry — real boxes** — standing in front of a wall that had already
   degenerated. [PRIOR + inference; [LOOK] — one frame of a *bare* wall at 18 m
   settles it.]
2. **There is no compromise value of `TIER_CSS`.** The error is multiplicative
   in zoom: 32x between z16 and z21. A `TIER_CSS` that is right at 2 m
   (1024 css px) puts one window per 33 m of wall at cruise.

### Why it cannot be fixed the obvious way

To hold world scale you need `displaySize` to double per zoom: 32 → 1024 css
px. `displaySize = texels / pixelRatio` and **`pixelRatio` must be a positive
integer** — `js/facades.js:122-134` documents that MapLibre carries it in a
`Uint16` vertex attribute and that a fractional value renders the entire far
field as a transparent ghost. So 1024 css px means a **1024-texel image**, per
(family x colour bucket): ~14 buckets x 5 families x 4 MB ≈ **280 MB of
atlas.** Not available.

**`fill-extrusion-pattern` cannot carry a facade to eye level in this renderer.
Full stop.** The honest options are:

* **(a) Accept it, and put real geometry in front of the walls people will
  stand at.** This is what `entrances.js` already does and it is why the lobbies
  photograph well. It scopes eye level to "the 374 buildings with entrances",
  which is most of what anyone would walk to. Cost: nothing — it is the current
  design, just stated as a limit.
* **(b) Change the CONTENT at high zoom, not the size.** Register a `step`-gated
  variant whose drawing holds **one** window instead of 40, so at z21 the 1.03 m
  repeat is one 1 m window. World scale is restored by drawing less.
  ~80 lines in `js/facades.js`, no new bytes worth counting.
  **It breaks the "every tier is the same pattern at the same world scale"
  invariant** (`js/facades.js:78-118`) — the invariant that exists because
  MapLibre picks a tile zoom *per tile* past 60° of pitch and a scale
  disagreement across one frame is the reported "rapidly alternates between the
  less and more dense window pattern". **My call: take it, gated above z19.5.**
  At z19.5 the whole frame is inside ~20 m of the camera; the z16-vs-z21 tile
  mixing the invariant protects against is not happening at that range. But it
  is a real risk and it must be re-verified with the same flicker test that
  wrote the invariant, not reasoned about.

---

## 3. The over-scale values, one by one

This is the part the brief asked for an opinion on. First the inventory, then
the opinion, because the opinion depends on a split the inventory makes
obvious.

### 3a. Authored in METRES, baked into geometry — error is CONSTANT

| value | file:line | drawn | real | ratio | at 2 m |
|---|---|---|---|---|---|
| `STEP_NOSING` | `scripts/bake_depth.py:108`, `bake_entrances.py:232` | 0.35 m | 0.02 m | **17.5x** | a 35 cm black kerb along every stair tread |
| `stopBarDepth` | `js/ground.js:145` | 1.6 m | 0.3–0.6 m | ~3x | a 1.6 m white slab across the lane |
| `RAIL_D` | `scripts/bake_entrances.py:284` | 0.10 m | 0.038 m | 2.6x | a chunky tube. Fine. |
| `WC_MULL_W` | `scripts/bake_entrances.py:506` | 0.10 m | 0.044 m | 2.3x | a fat mullion. Fine. |
| `LEAF_T` | `scripts/bake_entrances.py:248` | 0.10 m | ~0.045 m | 2.2x | a thick door leaf. Fine. |
| `GLASS_PROUD` | `scripts/bake_entrances.py:252` | +0.02 m **proud** | −0.04 m **recessed** | wrong sign | glazing standing *out* of its frame |
| sign colour, no logo | `scripts/bake_places.py:25-31` | flat colour band | logo artwork | — | a Chipotle is a red stripe with a text label |

`STEP_NOSING` is the one the brief singled out and it is correctly singled out:
**17.5x is the only ratio here in a different league.** `RAIL_D`, `WC_MULL_W`
and `LEAF_T` at 2.2–2.6x are *chunky*, not *wrong* — a person at 2 m reads a
10 cm handrail as a handrail. **HARMLESS, leave them, and the comments telling
you not to "fix" them are right.**

`GLASS_PROUD` is the interesting small one: the comment
(`scripts/bake_entrances.py:252-255`) says openly that there is no CSG so a
recessed light is invisible, and it inverts the sign. From 18 m nobody could
tell. From 2 m a pane of glass standing 2 cm *proud* of the door frame it sits
in is a thing you have never seen. **UGLY.** Fix is not "recess it" (it can't
be) — it is to make the surround *thicker outward* so the glass is proud of the
wall and recessed from the frame. A bake change, cheap.

### 3b. Authored in SCREEN PIXELS — error is MULTIPLICATIVE in zoom

These are already altitude-dependent; the dependence just runs the wrong way
past a crossover point.

| value | file:line | css px | true | crosses true scale at | at z21 |
|---|---|---|---|---|---|
| facade storey | `js/facades.js:145` | 4 | 4.0 m | **z16.0** | **0.13 m (32x too fine)** |
| `pathSlabPx` (sidewalk joints) | `js/ground.js:248` | 8 | 1.5 m | **z18.5** | **0.26 m (5.8x too fine)** |
| Speedway herringbone cell | `js/ground.js:168-169` | 24 | ~0.20 m | z22.9 (unreachable) | 0.77 m (3.8x too coarse — **improving**) |
| `laneMinPx` | `js/ground.js:102` | 1.1 floor over a metre-true width | 0.10 m | binds only when true < 1.1 px | correct — **this is the right pattern** |
| `buildings-ao` line/blur | `js/app.js:539-540` | 28 / 44 (clamped at z20) | — | — | 0.90 m halo, 1.4 m blur — plausible contact shadow |

[ARITH throughout, using `m per css px = 67551 / 2^floor(z)`]

**`laneMinPx` is the only value in this repo that does over-scale correctly**
and it is worth naming as the pattern: a *metre-true* width with a *minimum
pixel* floor, so the over-scale exists only at the altitudes where the true
value is invisible and evaporates on approach. `js/ground.js:101` even writes
the rule out. Nothing else adopted it.

**The sidewalk is the clean failure.** `pathSlabPx: 8` was chosen so joints
land ~4 m apart at z17 — 2.7x over-scale, declared. The same 8 px is 26 cm at
z21. A sidewalk with a scored joint every 26 cm is corduroy. **UGLY, and the
cheapest fix in the whole document**: `pathSlabPx` feeds a bar count at
`js/ground.js:1031`, so making it a zoom expression that stops shrinking at
z18.5 is one interpolate and **no re-bake**.

### 3c. Data-level decisions taken because of altitude

| decision | file | at 2 m |
|---|---|---|
| **the DETAIL tier was not emitted at all** — sill, water table, transom line, door bottom rail, 13 mm threshold | `scripts/bake_places.py` §3, "*ALT_MIN is 18 m, the mullion needs 18.2*" | the exact features you look at from a metre away are **not in the data**. Re-bake, ~1 day. **STRUCTURAL, and the most quotable line in the repo for this brief** |
| ground/road areas simplified at **1.2 m** RDP, "*nothing moves by more than a quarter of a rendered pixel at the zoom the camera flies at*" | `scripts/bake_ground.py:337-341, 420, 522` | every kerb and path edge has been moved by up to 1.2 m — **more than half a sidewalk width**. Re-bake at a lower tolerance costs file size. **UGLY** |
| far roads simplified at 6.0 m, coords rounded to 5 dp (~1.1 m) | `scripts/bake_ground.py:487` | far field only; not visible at 2 m. **HARMLESS** |
| every tiled archive capped at `--maximum-zoom=16` | `scripts/tile.sh:37-40, 63` | trees, roads, outer ring, roofscape and props are quantised to **0.149 m** (4096 units / 611 m tile) and overzoomed. A lamp post's shaft snaps to a 15 cm grid. **UGLY**, and the cap cannot simply be raised — it is what fixed the city-wide pattern flicker |
| `PATTERN_TILING = {maxzoom:16, tolerance:0.5}` on buildings, ground, places, drag, westcampus, heroes, moody, arts | `js/app.js:441` + 8 call sites | same 0.149 m quantum on every shopfront, pier and lintel. The 0.02 m `GLASS_PROUD` / `REVEAL_PROUD` offsets are **sub-quantum even on the entrances source** (z18 quantum = 0.032 m) — a z-fighting risk that only *shows* when the door fills the frame. **[LOOK]** |
| crown radius and trunk diameter drawn independently; 73% of canopy centres have no trunk within 2 m | HANDOFF §103 / QUEUE X5, `scripts/shape_trees.py` | a floating crown is invisible from 18 m and unmissable from 2 m. **UGLY**, already queued |
| roof top faces carry no texture, citywide | HANDOFF §104 / QUEUE X7 | **HARMLESS at eye level** — you cannot see a roof from 2 m. This one gets *better*. Worth saying, since it was the loudest complaint at 18 m |

---

## 4. My actual opinion on the over-scale question

**The question "altitude-dependent or one compromise value?" has two different
answers and the split is not aesthetic — it is whether the error is constant or
multiplicative.**

**For the metre-authored ones (§3a): one compromise value, and move it DOWN,
toward truth, not to the midpoint.** Altitude-dependence is not available to
them anyway — they are baked polygon geometry, and a fill-extrusion footprint
cannot change with the camera. You would need two baked variants and a swap,
and a swap is a visible pop in the exact frame you built it for.

The compromise should be biased low because **the two failure directions are
not symmetric**:

* too small at altitude → the feature disappears. You lose a hint. The building
  still reads as a building.
* too big up close → the feature is grotesque *and it is the only thing in the
  frame*. You lose the shot.

Up close is the harsher judge, so the midpoint is the wrong answer.

**Except for `STEP_NOSING`, where the right move is not a value at all — it is
noticing that one number is doing two jobs.** The 0.35 m nosing is
simultaneously (i) *mark the leading edge of the tread* and (ii) *shade the
riser so a stair reads as a stair from 300 m*. Job (i) wants real geometry and
wants to be small — 0.05 m, still 2.5x life, reads as an arris at 2 m and as
nothing at 300 m, which is fine because job (ii) is what carries the stair from
the air. Job (ii) does not want geometry at all: it wants **value**. A wide flat
dark band painted on the tread, no proud lip, no height. `bake_entrances.py`
already knows this — *"Depth in this renderer is a colour, not a distance"*
(`:265-268`) — it just did not apply it here.

**Value is the only property in this stack that is genuinely scale-free.** A
dark band is a dark band at 2 m and at 900 m; it costs nothing to draw at either
end; it never needs a tier. Every over-scale problem in §3a that can be
re-expressed as value instead of displacement should be, and the ones that
cannot (`RAIL_D`, `LEAF_T`, `WC_MULL_W`) are all under 3x and should be left
alone.

Cost: `STEP_NOSING` is shared by `bake_depth.py` and `bake_entrances.py` (both
Acer's; the Mac lane owns only the stadium per `MAC_QUEUE.md`), touches
`data/depth.geojson` and `data/entrances.geojson`, and needs a before/after at
both ends of the altitude range. **Call it a day, plus a re-bake and a
`coplanar.mjs` / `zfight.mjs` re-run.**

**For the screen-authored ones (§3b): altitude-dependent, and it is already
free, because they are already zoom expressions.** They do not need a new
mechanism — they need their existing zoom dependence *capped at the crossover*.
`pathSlabPx` should stop shrinking at z18.5. That is one interpolate and no
re-bake. `laneMinPx` shows the shape the whole file should have used.

**And for the facade pattern: neither.** It is not over-scale, it is
*multiplicatively under-scale*, there is no compromise value, and it needs the
structural answer in §2. This is the one place where "eye level" costs real
engineering rather than a constant.

---

## 5. Does anything DISAPPEAR as you get closer?

Mostly no — and the two that do are both worth knowing.

**No, in general.** [CODE] Every `minzoom` in the app opens as you approach.
Every zoom `interpolate` clamps at its last stop rather than running off. The
only layer-level `maxzoom` in the app is `ground-base-texture` at 22
(`js/ground.js:1354`), which can never bind because `ZOOM_MAX` is 21.5 — that
gate is **dead code**. Source-level `maxzoom` (tiles at 16, patterns at 16,
entrances at 18) means *overzoom*, not disappearance.

**Yes, #1 — the outer ring's low-rise mass, and it collides with the altitude
floor at exactly the same number.** `js/outer.js:89-90`:

```js
flatMaxPitch: 80,
flatFadePitch: 84,   // fully gone by here
```

7,511 low-rise prisms fade to zero opacity at pitch 84. From §1b, reaching ~2 m
of eye height **requires** pitch ≥ 84. **So at walking height the low-rise city
around you is drawn at opacity 0.** Two constants chosen independently for
unrelated reasons land on the same number and cancel each other. Towers,
mid-rise, crowns and park pads are deliberately exempt (`js/outer.js:534-540`),
so what you get at 2 m in the outer ring is **towers standing on nothing.**
[CODE + ARITH, and **the single most testable prediction in this document** —
one frame at pitch 85 in the outer ring settles it.] **STRUCTURAL for a
walking mode; a one-line taste change (`flatFadePitch: 89`) if the reason the
fade exists — "low-rise prisms mass edge-on into one brown plane" — does not
apply when you are standing among them, which I do not think it does.**

**Yes, #2 — building labels, and this one matters most for the walking-tool
idea.** `js/app.js:1417-1462`. Three symbol tiers, all on above z17.9, all
`text-allow-overlap: false`, priority by `symbol-sort-key: -lv` (built volume).
There is **no distance term and no facing term** anywhere in the placement.
Consequences at 2 m:

* Labels are placed at the footprint's ground centroid with **no elevation and
  no depth test**, so the name of the building you are standing in front of
  draws **through its own wall**, or is below the frame, or is behind you.
* Every label within the sightline competes for the same screen, and the winner
  is *the biggest building*, not *the nearest*. **The building you are walking
  toward loses its label to DKR 400 m away.** That is a genuine "disappears as
  you get closer".
* Size clamps at 19.5 px (z18 + 2.7), so at 2 m every name in the city is the
  same 19.5 px regardless of whether it is 3 m away or 800 m away.

**UGLY, and cheap, because the fix is already written in this repo.**
`js/entrances.js:210-235` and `:296-305` gate their labels on **`maxDistM`,
`arcDeg` (off the wall's own normal) and `viewArcDeg` (off where the camera is
pointing)** — three world-space tests, written precisely because "a symbol layer
has no depth test — this is the check that stands in for one". Porting that
gate to `buildings-labels-*` is maybe 40 lines and it is the difference between
a flythrough label system and a wayfinding one.

---

## 6. Everything else, sorted by how much it hurts

### STRUCTURAL

* **§2 — the facade pattern.** 32x under-scale at eye level, unfixable by
  resizing.
* **§1b — `ZOOM_MAX` couples altitude to pitch.** No value in MapLibre's range
  gives 2 m at a cruise pitch; low altitude is only reachable while looking at
  the horizon.
* **§1c — `R_CAM = 6` puts a 6–12 m standoff around every building.** A
  pedestrian camera walks in the road, not on the pavement, and can never reach
  a door, a canopy or a recessed bay.
* **§1e — no collision for trees, props, entrances, shopfronts or ground.** You
  walk through every live oak in the city.
* **§5 #1 — the outer ring's low-rise fades out at exactly the pitch eye level
  requires.**
* **`scripts/bake_places.py` §3 — the DETAIL tier was never emitted**, by name,
  because `ALT_MIN` was 18. The sill, water table, transom line, door bottom
  rail and threshold do not exist in `data/places.geojson`.

### UGLY (visibly wrong close up, cheap to fix)

* `outAlt = Math.max(outAlt, 12)` — undocumented second floor, one line.
* `OUTER_MIN_H = 12` — one line, costs collision-scan time.
* `pathSlabPx: 8` — sidewalk corduroy at 26 cm; one interpolate, no re-bake.
* Building labels: no distance/facing/depth gate; port the entrances gate.
* `GLASS_PROUD = +0.02` — glazing proud of its own frame; bake change.
* `stopBarDepth: 1.6` — no true-scale branch; give it the `laneMinPx` treatment.
* Tree crowns floating without trunks (QUEUE X5, already queued).
* `SPEED_MIN = 6` m/s (`js/controls.js:60`) — the speed law
  `40·(alt/230)^0.75` returns 1.1 m/s at 2 m and is clamped up to 6 m/s = 21.6
  km/h, or 15 m/s with Shift. **Walking pace is 1.4 m/s.** A "walking mode" at
  4.3x walking speed with a 6 m collision radius will feel like driving a bus
  down the Drag.
* `js/night.js:215-220` — the lamp **head** (`CORE`, `CORE_RADIUS_SCALE: 0.30`
  of an 8 m pool = 2.4 m radius) is a `circle` **lying flat on the ground**,
  because from the air the head is what reads as a lit city. At 2 m it is a
  4.8 m bright disc painted on the pavement directly under the lamp post, with
  the real post standing in the middle of it. **[LOOK] — this is my strongest
  unverified prediction and it should be the second frame anybody takes at
  night.**
* `js/shadows.js:87-103` — building shadows are the **convex hull** of the
  footprint and its offset, drawn as a flat `fill` with a hard edge and no
  penumbra. From above, a convex hull is a reasonable shadow. At 2 m you are
  standing in one, and it is neither the right shape nor edged like a shadow.

### HARMLESS (over-scale that still reads fine, or improves)

* `RAIL_D` 0.10, `LEAF_T` 0.10, `WC_MULL_W` 0.10 — 2.2–2.6x. Chunky, not wrong.
  Leave them; their comments are right.
* Speedway herringbone — over-scale at cruise, **converges toward true as you
  approach** (3.8x at z21 against 7.9x at z17). The only screen-locked value in
  the app that gets *better* at eye level.
* `laneMinPx` — the min-px floor stops binding on approach, by construction.
* `buildings-ao` — 0.90 m halo with 1.4 m blur at z21 reads as a contact
  shadow. Fill-rate cost is the concern, not the look.
* Untextured roof top faces (QUEUE X7) — invisible from 2 m. This complaint
  *goes away* at eye level.
* No brand logos (`scripts/bake_places.py:25-31`) — a colour band plus a text
  label at 2 m is a plausible sign, and the trademark reasoning is unaffected by
  altitude. **Do not reopen this one.**

### Performance, which nobody has costed

At 2 m, `js/lod.js` hides **nothing** (`alt > distance · 0.45` is false at every
slider setting), every `minzoom` gate is open, and pitch 84–88 puts a kilometre
of sightline in frame. **That is simultaneously the most layers, the most
features and the longest view the app can produce**, and it has never been
measured. Meanwhile the `performance` preset (`js/graphics.js:274-277`) drops
`treeDensity` to 0.52 and `outerDensity` to 0.45 — at 18 m that is a texture
change; at 2 m **half the trees on the street you are walking down are simply
not there**, and the graphics auto-detect has a known habit of sticking on
`performance`. **[LOOK] — measure a frame time at pitch 86, 2 m, on the Drag,
before promising anybody a walking mode.**

---

## 7. What actually has to change for a 2 m floor, in order

Not a plan — this pass wrote no code. This is the dependency order, so nothing
is changed that a later item makes pointless.

1. `js/controls.js:606` — the write-path floor. **Nothing else works until
   this moves.**
2. `js/controls.js:85` — `ALT_MIN`.
3. `js/controls.js:58` — `ZOOM_MAX`, *and* accept that the reachable floor is
   pitch-dependent, or add a documented eye-level mode that pins pitch high.
   **This is where the design decision actually lives, not at `ALT_MIN`.**
4. `js/controls.js:99` — `R_CAM` / `HARD_CLEAR` / `SKIN_V`, or the standoff law
   stays and a pedestrian walks in the road.
5. `js/controls.js:384` — `OUTER_MIN_H`, or the floor lies about downtown.
6. `js/controls.js:60` — `SPEED_MIN`, or it is not walking.
7. `js/outer.js:90` — `flatFadePitch`, or the low-rise city is not drawn.
8. `js/facades.js` — §2, the only item on this list that is engineering rather
   than a constant.

Items 1–7 are **eight numbers in two files.** That is the honest scope of "lower
the floor". Item 8 is the honest scope of "make it look right when you get
there", and they are not the same job.

---

## 8. What I did NOT do, and what one screenshot would settle

**I did not open a browser, run the app, take a frame, or measure a pixel.**
Nothing above is a measurement. The repo's own law is that a reading loses to a
frame, and every `[LOOK]` below is a claim I am confident in and have not seen:

1. **The `ZOOM_MAX` settle.** Set `ALT_MIN` and the write floor to 2, jump to
   pitch 64, read `__fly.eye().alt` at the shutter. I predict **8.1 m**, not
   2 m, on a 900 px canvas. If it reads 2 m my §1b arithmetic is wrong and half
   this document's framing goes with it.
2. **The facade at z21.** One frame of a *bare* patterned wall — not a lobby —
   from 3 m. I predict fine regular mesh, storey ≈ 0.13 m.
3. **The outer ring at pitch 85.** I predict towers standing on nothing.
4. **The lamp head on the pavement at night.** I predict a 4.8 m bright disc
   under every post.
5. **Frame time at 2 m / pitch 86 on the Drag**, minimum of interleaved reps,
   with the CPU throttle quoted.
6. **The 0.02 m proud offsets at z18 tiling.** I predict visible z-fight on door
   glass at eye level; `zfight.mjs` has only ever been run at poses ≥ 18 m.

Also not done:

* **I did not check `js/moody.js`, `js/heroes.js`, `js/arts.js`, `js/tower.js`,
  `js/capitol.js`, `js/roofs.js` or `js/drag.js` line by line.** They all use
  `PATTERN_TILING` and the shared facade atlas, so §2 and the 0.149 m quantum
  apply to all of them, but each has its own taste block with its own
  altitude-justified numbers that I have not read. **`js/tower.js:188` ("at
  1.55 m they blur into a light band at flying altitude") and
  `js/moody.js:70` ("the middle of the range the camera actually flies") are
  both visible in a grep and neither is audited here.**
* **I did not audit `js/sky.js`.** At pitch 88 the frame is 27% sky and the sky
  is drawn by a separate compositor with its own horizon maths
  (`js/sky.js:297`). Eye level is the pose that puts the most sky on screen and
  nobody has looked at it.
* **I did not cost any of the fixes by trying one.** Every "one line", "40
  lines", "a day" above is an estimate from reading, not from doing.
* **I did not check the mobile path.** `camPx` uses `clientHeight`, so a phone
  in portrait has a very different reachable floor from a desktop, and the
  joystick/tap-drag altitude gains (`PAN2_GAIN`, `TAPDRAG_GAIN`) were tuned
  against an 18 m floor.
