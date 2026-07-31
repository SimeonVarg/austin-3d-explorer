# The roofscape

*The pass that noticed the product is a flyover, and that a flyover is mostly
looking at roofs.*

---

## 1. Why this pass exists, as a measurement

The camera in this app spends most of its time above the city looking down. The
surface the viewer sees most is therefore not facades — it is roofs. And before
this pass, `scripts/bake_detail.py` derived every roof colour like this:

```python
roof = adjust_light(wall, -0.12)          # bake_detail.py:293,298
```

The roof is the building's own wall, 12% darker. Of 2,453 buildings, 107 have a
real pitched roof from `bake_roofs.py`; the other 2,346 were one flat quad in a
brown derived from their own walls, with nothing on them at all.

So West Campus — which in the aerial is a field of **bright white TPO membrane
carpeted in condenser rows** — rendered as a field of brown lids. That is
`shots/before-D3-west-campus.png`, and it is not a subtle defect.

The single loudest error was never the missing clutter. **It was the colour.**

---

## 2. What was built

Two files, one bake, one module.

| | |
|---|---|
| `scripts/bake_roofscape.py` | measures every roof off z20 nadir imagery, emits geometry |
| `data/roof_survey.json` | the measurement cache — what the photograph said, per building |
| `data/roofscape.geojson` | the drawn features |
| `js/roofs.js` | source + three layers, LOD, density knob, time-of-day hook |

### The vocabulary

Derived from the imagery **before** anything was drawn, from these crops (all
reproducible with `scripts/roofscape_sbs.py`'s stitcher):

* West Campus apartment block, `-97.7489,30.28855 → -97.7476,30.28965` —
  white membrane, paired condenser rows of 6–14, courtyard pool, stair boxes.
* The Welch / Hackerman plant deck, `-97.7390,30.2872 → -97.7370,30.2884` —
  a large dark louvre screen, a line of eight round fans, a ribbed metal roof
  with a pipe rack, a greenhouse, fume stacks on a gravel deck.
* The historic halls, `-97.7377,30.288 → -97.7362,30.2892` — terracotta hips,
  a cupola, round vents on the ridge, small plant boxes on the flat wings.

| kind | what it is | height | where it comes from |
|---|---|---|---|
| `deck` | the roof surface, inset inside the parapet, in its own measured colour | 0.25 m | **measured** |
| `cond` | split-system condenser, ~1.4 m square | 1.0 m | **measured** |
| `unit` | AHU / large condenser / plant box, 5–34 m² | 1.7 m | **measured** |
| `fan` | round exhaust or cooling-tower fan | 2.1 m | **measured** |
| `duct` | ductwork or pipe rack — long, thin, low | 0.9 m | **measured** |
| `plant` | dark equipment field or louvre screen | 1.5 m | **measured** |
| `phouse` | stair / lift / mechanical penthouse | 3.0 m | measured **or generated** |
| `pool` | rooftop and courtyard water | 0.12 m | **measured** |

### What is factual and what is not

Every feature carries `src`:

* **`src = "m"` — measured.** Position, footprint, orientation and colour read
  off z20 Esri World Imagery (0.129 m/px at this latitude, so a 1.4 m condenser
  is 11 px across — which is the whole reason this works). **Every deck colour
  in the scene is measured, without exception.**
* **`src = "g"` — generated.** One kind only: a stair/lift overrun, placed only
  where the photograph showed an empty roof on a building ≥ 11 m. Its existence
  is a rule; its corner is a stable hash of the building id.

The one thing a nadir photograph cannot measure is **height**, so every height
in the table above is generative: each kind gets the height that kind of plant
has. That is stated rather than hidden.

---

## 3. Counts, and the rule that produced each

`python scripts/bake_roofscape.py`, snapshot `2026-07-30`:

**12,058 features — 11,857 measured (98.3%), 201 generated (1.7%).**

| kind | n | the rule that produced it |
|---|---:|---|
| `deck` | **1,846** | one per eligible building; colour = median of the 55th–90th luma percentile inside the parapet |
| `cond` | 6,179 | blob < 5.5 m² and < 3.8 m on its long side |
| `unit` | 2,856 | blob 5.5–34 m² |
| `plant` | 373 | blob ≥ 34 m² that is dark (median luma < 100) or ragged (fill < 0.60) |
| `duct` | 303 | aspect ≥ 4.5, short side ≤ 2.6 m, ≥ 3 m² |
| `phouse` (measured) | 113 | blob ≥ 34 m², fill ≥ 0.60, median luma ≥ 100 |
| `fan` | 103 | 5.5–30 m², near-square (side difference < 28%), fill > 0.68 |
| `pool` | 84 | water mask **and** ≥ 7 m² **and** luma ≥ 92 **and** B−R ≥ 20 |
| `phouse` (**generated**) | **201** | building ≥ 11 m whose photograph showed no structure over 12 m²; corner from a stable hash of the id |

**Buildings the bake declined to touch**

| reason | n |
|---|---:|
| imagery gave too few samples, or footprint < 60 m² | 465 |
| already has a pitched roof — `bake_roofs.py` owns it | 107 |
| below 3 m | 25 |
| `has_parts` — `parts-3d` draws its real massing | 8 |
| replaced by the stadium bake (DKR) | 1 |
| footprint overridden at load (Union on 24th) | 1 |

**Detections the bake threw away**

| reason | n |
|---|---:|
| blue, but a sky-lit shadow rather than water (§9.4) | 1,216 |
| would have hung over the parapet | 827 |

**File sizes**

| file | features | size | loaded |
|---|---:|---:|---|
| `data/roofscape.geojson` | 3,718 | 1.40 MB | always, from z14 |
| `data/roofscape.detail.geojson` | 8,340 | 2.42 MB | **lazily**, first time the camera goes below z16.65 |
| `data/roof_survey.json` | — | 1.6 MB | never — it is the bake's cache, not a runtime asset |

The split is the LOD, not tidiness: at flyover altitude nothing in the detail
file is drawn, so shipping it in the always-loaded document would make every
session pay 2.4 MB of download and worker tiling for geometry it never shows.

---

## 4. The LOD and threshold scheme

`fill-extrusion` filters in MapLibre cannot read `['zoom']`, so the tiers are
separate layers with separate `minzoom`s rather than one clever filter.

| layer | contents | minzoom | why |
|---|---|---|---|
| `roofscape-deck` | every deck | **14.0** | one flat polygon per building, 0.25 m tall — the cheapest feature here and the one carrying the whole colour correction |
| `roofscape-major` | `t=0`: anything ≥ 11 m² **or** ≥ 2.4 m tall — plant screens, penthouses, big banks, fans, pools | **14.5** | this is what reads from flying altitude |
| `roofscape-minor` | `t=1`: individual condensers, small ducts, vents | **16.2**, opacity fading in over the next 0.5 | below this they are noise, not information — the same reasoning `props.js` uses to hold back benches |

Tier is decided by **size, not kind**: a big condenser bank reads from the air
and a small penthouse does not.

**Which buildings get a roofscape at all:**

| test | effect |
|---|---|
| `final_height < 3 m` | skipped — a shed has no roofscape |
| footprint `< 60 m²` | skipped — the deck would be smaller than the parapet inset |
| already has a pitched roof (`roof_runs.json` run ≥ 2 m) | skipped — `bake_roofs.py` owns those 107 roofs, decks included |
| `has_parts` | skipped — `parts-3d` draws its real massing, so `final_height` is not where its roof is (8 buildings) |
| in `stadium.geojson`'s `replacedBuildingIds` | skipped — DKR's plan is 82% open seating; a deck there would hang one enormous slab over the bowl |
| imagery gave < 40 samples | skipped |

**Per-roof clutter cap** — `MAX_FOR(area) = clamp(10, 96, area / 85)`. A flat cap
is the wrong shape: 46 units is nothing on a 7,000 m² apartment block and far too
many on a 200 m² shopfront. Scaling with area holds the *density* roughly
constant, which is what the eye actually reads.

---

## 5. The density knob

Density is a parameter, not a cull — the same decision, for the same reason, as
`treeDensity`. Every clutter feature carries `d`, a keep-order in 0..1 ordered
**biggest-first per roof**, so turning the knob down thins the specks off each
roof and keeps the plant that reads. Nothing is dropped by region.

```js
window.setRoofDetail(0.45);   // 0..1
window.setRoofDetail(null);   // follow the graphics preset
```

Preset defaults, in `ROOFSCAPE.byPreset`:

| preset | `roofDetail` |
|---|---|
| performance | 0.45 |
| balanced | 0.75 |
| cinematic / ultra | 1.0 |

Tier-0 features (`d = 0` for decks and overruns; plant, penthouses, pools and
big banks sort to the front) survive at any density, because they are what the
flyover actually sees.

---

## 6. Beyond the core — what happens to the outer ring

**Nothing. Deliberately.**

This bake reads the current snapshot, whose bbox is UT + West Campus + The Drag
(`scripts/config.sh`: `-97.752,30.276 → -97.726,30.296`). A building outside
that box appears in no survey entry and gets **no deck and no clutter** — it
keeps exactly the plain `rd` lid it has today, at exactly today's cost.

That is the right answer while the radius pass triples the bbox: the outer ring
is meant to be a cheap backdrop tier, and roof clutter is the single most
expensive thing that could be added to it. Concretely, extending the roofscape
outward would need three things, in this order:

1. **z20 imagery for the new area.** The core alone is 4,071 tiles. Cost scales
   with area, and the outer ring is ~8× the area.
2. **A far higher `MIN_AREA`.** In the core the threshold is 60 m². For a
   backdrop, decks only (no clutter) above ~400 m² would carry nearly all of the
   visible benefit at a small fraction of the count.
3. **A third LOD tier** with `minzoom` above the altitude the outer ring is
   normally seen from.

Until then the boundary is visible only in the sense that the far ring is
flatter — which is what a backdrop should be.

---

## 7. Registration

`js/app.js` and `index.html` belong to other passes, so **the module installs
itself**: it polls for `window.__map` and `buildings-3d`, then adds its source
and layers (see the `autoInstall` block at the bottom of `js/roofs.js`). It also
wraps `window.applyTimeOfDay` so the roofscape follows the sun, because
`js/timeofday.js` drives every other palette from a fixed list of `applyXColors`
calls and this file is not on it.

That works, and it is how every screenshot and every timing number in this
document was produced. But the clean registration is three lines. When
`index.html` and `js/app.js` are next touched:

```html
<!-- index.html, with the other modules, before js/app.js -->
<script src="js/roofs.js"></script>
```

```js
// js/app.js, in buildScene(), immediately after step('roofs', …)
step('roofscape', () => { if (typeof initRoofscape === 'function') initRoofscape(map); });
```

```js
// js/timeofday.js, in applyTimeOfDay(), beside the other applyXColors calls
if (typeof window.applyRoofscapeColors === 'function') window.applyRoofscapeColors(map, p);
```

All three are safe to add at any time: `initRoofscape` no-ops if the source
already exists, and the `applyTimeOfDay` wrapper is guarded by
`window.__roofscapeHooked`.

Optional — to put the density knob in the graphics menu, add one row to
`SCHEMA` in `js/graphics.js` and one key to each preset:

```js
{ key: 'roofDetail', label: 'Roof detail', min: 0, max: 1, step: 0.05, group: 'world',
  fmt: v => Math.round(v * 100) + '%',
  hint: 'Thins the small roof units first and keeps the plant, penthouses and pools that read from the air.' },
```

Without it the knob still exists and still works, via `setRoofDetail()`.

---

## 8. Verification

Everything below was produced against the real app, served from this worktree.

Screenshots live in `scripts/verify/shots/`, which is gitignored (regenerable) —
the commands below reproduce every frame this document refers to.

> **A trap that cost a round here:** port 8099 (the port `scripts/verify/README.md`
> documents) was already held by **another agent's** server, and it answered 404
> for `scripts/bake_roofscape.py`. The first set of "before" screenshots was of a
> different worktree, and they looked plausible — brown roofs either way. Every
> command below pins `VERIFY_URL` to a private port. If you are running more than
> one worktree, check `curl -o /dev/null -w '%{http_code}' <url>/scripts/bake_roofscape.py`
> before trusting a single frame.

> **The self-install path is what was verified.** `roofscape-shot.mjs` injects
> `js/roofs.js` with `addScriptTag` into the real app rather than loading a
> special harness copy, so the `autoInstall` block is the code path every
> screenshot and timing number here went through. Its final diagnostic:
> `{"injected":true,"detailLoaded":true,"deck":1482,"major":1451,"minor":3317}`.
> Note that `autoInstall` waits for `isStyleLoaded()` **and** `buildings-3d`; in a
> browser tab that never finishes building the scene it correctly installs
> nothing, which is the intended behaviour rather than a failure.

```bash
cd scripts/verify && npm install
python -m http.server 8177 --bind 127.0.0.1        # from the repo root
```

```bash
VERIFY_URL=http://127.0.0.1:8177 node roofscape-shot.mjs before shots-roofscape.json --off
```

```bash
VERIFY_URL=http://127.0.0.1:8177 node roofscape-shot.mjs after shots-roofscape.json
```

```bash
VERIFY_URL=http://127.0.0.1:8177 node roofscape-probe.mjs
```

```bash
VERIFY_URL=http://127.0.0.1:8177 node roofscape-perf.mjs
```

```bash
python scripts/roofscape_sbs.py scripts/verify/shots/after-N2-west.png
```

### 8.1 Frame cost

`roofscape-perf.mjs`, headed, `index.html` (not `_harness.html`, whose rAF shim
pins the loop at 60 Hz), a scripted bearing sweep so every run renders identical
content, interleaved configurations, minimum of the reps. Over West Campus —
the densest roofscape in the scene and the pose the before/after shots use.

**At flyover altitude (z16.4, pitch 58), 7 reps:**

```
source features {"base":2778,"detail":5932,"deck":232,"major":262,"minor":753}

config      dropped(min)   fps(best)   [all reps dropped]
off              2         59.5      [20, 2, 2, 2, 9, 5, 14]
full             3         54.3      [4, 3, 5, 4, 48, 56, 59]
balanced         2         54.6      [4, 4, 2, 4, 52, 41, 54]
perf             1         54.6      [1, 2, 6, 48, 36, 44, 57]
major            0         57.5      [0, 1, 2, 21, 21, 17, 31]
```

Two things to read carefully here.

**Dropped frames cannot separate these.** Every configuration sits at 0–3 of
~250 frames; the run is not dropping frames at all, in any configuration. The
figure that does separate them is best-case fps:

| | fps | cost vs off |
|---|---:|---|
| off | 59.5 | — |
| tier 0 only (`major`) | 57.5 | **≈ 2 fps** |
| everything | 54.3–54.6 | **≈ 5 fps** |

So the whole roofscape costs about **5 fps** at the densest pose in the scene,
and the part that reads from the air — decks plus tier 0 — costs about **2**.

**The density knob does nothing at this altitude, and that is correct.** `full`
(1.0), `balanced` (0.75) and `perf` (0.45) all land within 0.3 fps of each
other, because at z16.4 the tier-1 layer is inside its opacity ramp and drawing
almost nothing. What costs at flyover altitude is the always-on tier, which the
knob does not thin. **The tier split, not the knob, is what buys the frame rate
back up here** — see §8.3 for where the knob does its work.

The last three reps of each row (the 40–59 values) are the machine getting busy
again with other agents' work, not a configuration effect. Taking the minimum is
exactly what the suite's README prescribes for this reason.

Two measurement bugs were found and fixed on the way to this table, both worth
recording:

* **Setting a filter re-tiles the whole source in a worker.** The first version
  timed 1.4 s after `setRoofDetail`, so every density config measured its own
  re-tile and `full` came back *cheaper* than `off` — an impossible ordering
  that reads as noise but was a methodology bug. It now waits for `idle` then
  settles 2.5 s.
* **A busy machine measures the machine.** An earlier run with four other agents
  active (27 Chrome, 5 node processes) produced per-config spreads of 17–201
  dropped frames that overlapped completely, i.e. no result. The tables here
  were taken during a quiet window.

### 8.2 What IS solid: the drawn-feature budget

Counting features, not frames, is not machine-dependent. At the flyover pose
above (z16.4, 1440×900), of 12,058 features in the two files:

| | drawn | note |
|---|---:|---|
| `roofscape-deck` | 232 | one per visible building |
| `roofscape-major` | 262 | tier 0 |
| `roofscape-minor` | 753 | tier 1 — **and z16.4 is inside its opacity ramp**; above z16.2 it draws nothing at all |
| **total** | **~1,250** | against 2,326 buildings and ~2,450 tree features in the same frame |

So at flyover altitude the roofscape adds roughly half a tree layer's worth of
geometry, and the 8,340-feature detail tier is not even downloaded until the
camera descends past z16.65.

### 8.3 How the density knob behaves

Measured where the knob actually has something to do — **z17.3**, low enough for
the tier-1 layer to be past its opacity ramp and fully drawn, 6 reps:

```
config      dropped(min)   fps(best)   [all reps dropped]
off              1         60.0      [11, 1, 6, 2, 6, 6]
full             3         56.2      [7, 3, 42, 39, 43, 38]
balanced         3         56.8      [3, 3, 53, 33, 32, 45]
perf             1         57.6      [3, 1, 29, 28, 32, 31]
major            1         59.0      [1, 52, 15, 17, 13, 12]
```

Monotonic, in the right order, and it does what it was built to do:

| `roofDetail` | fps | cost vs off | recovered vs `full` |
|---|---:|---:|---:|
| — (`off`) | 60.0 | — | 3.8 |
| tier 0 only | 59.0 | 1.0 | 2.8 |
| 0.45 (`performance`) | 57.6 | 2.4 | **1.4** |
| 0.75 (`balanced`) | 56.8 | 3.2 | 0.6 |
| 1.00 (`cinematic`) | 56.2 | 3.8 | — |

So the knob buys back about **1.4 fps** between cinematic and performance, and
dropping the whole detail tier buys back **2.8**. Combined with §8.1: the pass
costs ~5 fps at flyover altitude and ~4 fps close in, and the `performance`
preset gives back a third of that without touching anything that reads from the
air — because `d` is ordered biggest-first, so what it thins is specks.

---

## 9. What the measurements said, and what changed because of them

### 9.1 The ceiling that flattened the whole pass

The first cut copied `bake_roofs.py`'s `deck_colour()` constants wholesale,
including `DECK_MAX_CH = 150` — a hard clamp on the brightest channel. On the
handful of membrane decks inside a terracotta band that is a sensible guard.
Applied to 1,847 roofs it is not a tempering, it is a **flattener**:

| | luma p5 | p50 | p95 | roofs with a channel > 200 |
|---|---|---|---|---|
| the photograph | 122 | 192 | 250 | 912 of 1,847 |
| first cut, emitted | 120 | 145 | 149 | 0 — pinned at exactly 150 |

Every roof in West Campus came out the same mid-tone: the same defect as the
brown lids, one step lighter. The ceiling was replaced by a **range map** that
rescales the photograph's luma span onto the span this scene can show,
preserving order and spread.

| | luma p5 | p50 | p95 |
|---|---|---|---|
| after the range map | 84 | 138 | 182 |

### 9.2 The scene warms roofs by 1.58×, and roofs are not actually colourful

`roofscape-probe.mjs` pairs the hex the bake typed for a deck with the RGB that
deck renders as, at the product's default hour and preset, over 2,467 sampled
deck pixels:

```
typed luma   n     typed RGB        rendered RGB     lum in->out   R/B in->out
  0-100     97   ( 91, 94, 96)    (111, 94, 77)     93 ->  97    0.95 -> 1.44
100-125    500   (118,122,124)    (143,120, 95)    121 -> 124    0.95 -> 1.51
125-150    794   (133,137,143)    (155,133,109)    136 -> 137    0.93 -> 1.42
150-175    772   (154,161,169)    (188,157,128)    160 -> 163    0.91 -> 1.47
175-255    304   (175,184,199)    (207,178,152)    183 -> 184    0.88 -> 1.36

OVERALL  luma 142.9 -> 146.4 (gain 1.02)   R/B 0.92 -> 1.45 (warm shift 1.58x)
```

Two things follow, and one of them corrected a wrong assumption:

* **Luma survives** (gain 1.02) — the range map lands where it was aimed.
* **The frame applies a 1.58× warm shift**, so decks are entered cool to land
  neutral. That is the same correction, at the same kind of strength, that the
  stadium bake documents for its seating tones.
* **Roofs are a brightness story, not a hue story.** The measured deck R/B
  spans only 0.97–1.31 (p5–p95) with bright and dark roofs at essentially the
  same hue (1.09 vs 1.13). The intuition that "the render is too brown next to
  the photo" is mostly the app's deliberate golden grade, not the layer. So the
  pass leans on the luma range and does not fight the grade.

### 9.3 A busy roof hid its own equipment

The equipment threshold adapts to each roof's own MAD. That means a roof
**densely carpeted** in condensers — a West Campus apartment block, i.e. exactly
the roof this pass exists for — raises its own threshold and detects the fewest
units. The first cut found a median of **2** blobs per building and **18** on
roofs over 800 m², where the aerial plainly shows 60–120. Capping the adaptive
term (`DEV_CEIL`) breaks the feedback loop.

### 9.4 1,052 swimming pools

"Blue" is not a water test in aerial imagery: shadows are lit by the **sky**, so
every shadow on every roof has B > R. The permissive water mask found 1,052
"pools", median **2.6 m², luma 81** — shadow slivers. Requiring area ≥ 7 m²,
luma ≥ 92 and B−R ≥ 20 at once takes that to a plausible count of real rooftop
and courtyard water.

Because those thresholds live in the **geometry** stage and the survey records
each blob's area, colour and luma, re-deciding them costs seconds against the
cache instead of a 20-minute re-read. That split is the single most useful
structural decision in this bake.

### 9.5 Two performance bugs found by the clock, not by reading

* `scipy.ndimage.median_filter` at a 32 px window is `O(n·k²)` and not
  separable. The first run was still measuring after 15 minutes with nothing
  written. Two separable `uniform_filter` passes — mean, then mean again over
  only the pixels the first pass called background — cost `O(n)` and keep the
  one property the median was there for.
* `poly_mask` tested every grid cell against every edge. The scan only needs the
  **row** coordinate, so a 700×1000 grid against a 300-vertex footprint went
  from 300 × 700,000 cell tests to 300 × 700 row tests.

The survey now checkpoints every 200 buildings, because losing a 15-minute read
to an interrupted run happened twice while this was being tuned.

---

## 10. Known gaps

* **The 107 pitched roofs get no clutter.** They keep their measured hip and
  their measured deck colour from `bake_roofs.py`, but the fume stacks, cupolas
  and small plant boxes visible on the historic halls' flat wings are not
  reproduced. Doing it needs the pitched deck's top height, which means porting
  `fold_free_run` out of `bake_roofs.py`. The 1,847 flat brown lids were the
  bigger problem and were done first.
* **Courtyards are sampled as roof.** For a building with an interior court, the
  outer ring is used and polygon holes are ignored, so a courtyard pool or paving
  is measured as though it were on the roof. From above this reads roughly right;
  at a low oblique a courtyard pool sits a storey too high.
* **Solar arrays are not called solar.** Large dark regular fields are classified
  `plant` (a louvre screen or dark equipment deck), which is what most of them
  are here. Distinguishing a PV array from a dark plant screen needs row-period
  analysis or an OSM `generator:source=solar` tag; the bbox has neither.
* **The Capitol Complex gets no roofscape.** It is spliced in from
  `data/capitol.geojson` at load time and never appears in the snapshot this
  bake reads.
