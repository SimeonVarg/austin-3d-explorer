# QUEUE W6 — what actually flickers in `westcampus-day`

Acer lane, 2026-08-05, branch `acer/flicker-diag`. **Diagnosis only. No code, no
data, no bake.** Everything below was measured on `origin/main` at `b84d1f9`
with `python scripts/serve.py 8272`, Chrome + `--use-angle=swiftshader`,
1440×900, `deviceScaleFactor 1`, graphics auto-detect cancelled.
`node scripts/verify/harness-drift.mjs` **PASS** (28 scripts in `index.html`,
28 in `_harness.html`) from the repo root before any pixel was read.

---

## The answer in five lines

1. The 242 px cluster is **reproducible, exactly**: same count, same box.
2. It is **`roofscape-deck` against `buildings-roof`** on ONE building —
   **Villas on 24th**, `4e5f2b29-dd92-4232-82c9-fa8ef81c6e77`.
3. Those two surfaces **are exactly coplanar** — the deck's base and the
   parapet cap's top are both **9.00 m**, because two files each compute
   `max(1.0, 0.015·h)` from their own copy of the rule.
4. **But that coplanarity is not what flickers.** Separating them by 20, 50 and
   150 mm leaves the cluster exactly where it is. Halving the camera step
   removes it completely. A depth-buffer tie behaves the other way round on
   both counts.
5. So **W6 is a false positive in `scripts/verify/zfight.mjs`**, not a defect in
   the city — and the 85 `roofs.geojson` pairs are a **different fact**, on the
   other side of campus, invisible from every pose in the suite.

---

## 1. Reproduced first

`shots-places.json`'s `westcampus-day` pose, on its own, `VERIFY_MAX_MS=900000`,
run from the repo root:

```
pose                    bldg/roof   moved   flicker   clusters
westcampus-day            3110/3754    9.9%   0.055%   242@[642,827,869,895]
```

Identical to §94 and §95: **242 px, box [642,827,869,895]**. Mask written to
`shots/w6-rep1-westcampus-day-flicker.png`. Brightened, the cluster is a
**one-pixel-wide diagonal line** along the front eave of a low block at the
bottom of frame — not a patch, not a comb, a line.

The mask PNG paints flagged pixels pure `#ff00ff`, so the **exact 242 pixels**
were read straight back out of it and used as the sample set for everything
below. 719 pixels in the whole frame are flagged; 242 of them are this cluster.

## 2. Which layer owns those pixels — the mask, run three ways

HANDOFF §48's technique, with two changes that turned out to be necessary.

**Magenta alone cannot answer this.** `buildings-3d`, `wc-wall` and the other
wall layers are `fill-extrusion-**pattern**` layers; `fill-extrusion-color` is
ignored on them, so a magenta paint returns a silent, believable **zero**. That
is the same class of mistake as sampling a basemap and calling it your own
layer. So the probe **hides** each layer and counts how many of the 242 pixels
changed by more than 24/255, with a **control set** of 242 pixels 300 px to the
left riding along — this scene auto-exposes, and without a control every layer
looks like it changed something (§94).

**A single pose can only ever name the winner at that pose.** `zfight.mjs`'s
signature is A-B-A across zoom `z`, `z+0.003`, `z+0.006`: whichever surface is
frontmost at frame 0 is *not* frontmost at frame 1. So the probe was run at all
three.

All 215 layers in the style, frame 0 (`zoom 17.900`):

| layer | of the 242 px | control |
|---|---|---|
| `buildings-roof` [fill-extrusion, `austin-buildings`] | **224** | 18 |
| `buildings-3d` | 0 | 206 |
| `buildings-shadow` | 0 | 18 |
| `ground-road` | 0 | 18 |
| every other layer (211 of them) | 0 | 0 |

Frame 1 (`zoom 17.903`), candidate layers only:

| layer | of the 242 px |
|---|---|
| `roofscape-deck` [fill-extrusion, `austin-roofscape`] | **242** |
| everything else tried | 0 |

Mean colour on the 242 pixels, measured rather than read off a paint expression:

```
frame 0   zoom 17.900   rgb 145,126,98
frame 1   zoom 17.903   rgb 103,90,70
frame 2   zoom 17.906   rgb 145,126,98
```

Frame 2 is byte-for-byte the same mean as frame 0. That is the A-B-A the
detector is looking for, and the two contenders are named.

## 3. The two features, their z values, and the shared area

`queryRenderedFeatures` at eight points along the line returns the same pair
every time:

| | feature | z |
|---|---|---|
| A | `buildings-roof` — **Villas on 24th**, `4e5f2b29-dd92-4232-82c9-fa8ef81c6e77`, `final_height` 8.00 (`source_height: class_default`) | base **8.00** → top **9.00** |
| B | `roofscape-deck` — `k:"deck"`, `src:"m"` | base **9.00** → top **9.25** |

Footprint 1,339 m². Deck 1,183 m² — inset `PARAPET_IN = 1.1 m`, so **88 % of
the roof**. A `fill-extrusion` top face covers the whole polygon, so the cap's
top face runs **under** the whole deck: the plane z = 9.00 m is claimed by both,
over 1,183 m².

Both are the same colour, `#817e72`, and that is not a coincidence — `js/app.js`
overwrites the building's own `rd` (`#7d6a55` in the snapshot) with the deck's
measured colour out of `roofs.caps`, so the parapet reads as a rim of the deck
rather than a burnt-orange ring (js/roofs.js's own header, and HANDOFF §37).

### Why they are coplanar — and this is the structural half

`js/app.js`:

```
const capLiftNum = h => Math.max(1.0, 0.015 * h);   // buildings-roof top
```

`scripts/bake_roofscape.py`:

```
lift   = max(1.0, 0.015 * h)                        # roofscape-deck base
deck_b = round(h + lift, 2)
```

**Two systems, two copies of one rule, one surface.** Nothing enforces the
agreement; it holds because someone typed the same three numbers twice. It is
the same shape as the ground rank ladder's problem before PR #78 — a square
metre with two owners — except here the two owners are a JS layer and a Python
bake, so no single file can be read to find the collision. `bake_roofscape.py`'s
own comment says the deck sits **on** the cap "for exactly the reason the cap
itself sits on the wall instead of in it", which shows the author knew the
hazard and landed the deck's base exactly on the hazard anyway.

**`coplanar.mjs` cannot see any of this.** Its default target list is
`roofscape, roofscape.detail, roofs, tower, westcampus, drag, arts, moody` — the
buildings file is not in it, and the cap's top is not a stored number anywhere,
it is an expression evaluated in the style. Run over the buildings file with the
cap rule applied by hand, `buildings.detailed.geojson` has **0** coplanar
cap-top pairs among its 2,439 capped footprints, so cap-vs-cap is ruled out too.

## 4. The coplanarity is real and it is NOT what flickers

This is the part that would have been got wrong by reasoning. Same pose, same
three frames, `roofscape-deck`'s base and height shifted at runtime:

```
deck AS SHIPPED    moved 9.9%   flagged  719   242@[642,827,869,895]
deck HIDDEN        moved 9.6%   flagged  189   (none)
deck +0.02 m       moved 9.9%   flagged  712   222@[642,834,845,894]
deck +0.05 m       moved 9.9%   flagged  711   255@[642,824,878,894]
deck +0.15 m       moved 9.9%   flagged  725   237@[642,828,862,893]
```

Hiding the deck removes the cluster outright — so it is the deck's. But
**150 mm of clearance, five times `bake_depth.py`'s `STEP_LIFT` and fifteen
times `coplanar.mjs`'s epsilon, does not shrink it at all.** The box wanders by
a few pixels, which is the cluster *following the deck's edge*, not a plane
being resolved.

Then the camera step, which the detector treats as a free parameter:

```
dz = 0.001   AS SHIPPED   moved  2.4%   flagged     11   (none)
dz = 0.001   deck hidden  moved  2.2%   flagged      7   (none)
dz = 0.003   AS SHIPPED   moved  9.9%   flagged    719   242@[642,827,869,895]   <- the default
dz = 0.012   AS SHIPPED   moved 37.0%   flagged  75128   saturated, identical with the deck hidden
dz = 0.050   AS SHIPPED   moved 44.8%   flagged  43632   saturated, identical with the deck hidden
```

At a third of the default step the cluster **does not exist** — and that run is
valid by the file's own guard (`moved 2.4 %`, well over its 1 % floor). A
depth-buffer tie is decided by rounding that has nothing to do with how far the
camera moved; it would flicker at 0.001 and it would stop flickering at 0.15 m
of separation. This does the opposite of both.

**What it actually is.** The deck's riser is `0.25 m` tall and at this range
projects to about one pixel. The two measured means are the same hue at
`103,90,70` ≈ 0.71 × `145,126,98` — one lit top face and one shaded vertical
face **of the same `#817e72`**. Along the deck's silhouette the rasteriser
covers each boundary pixel with the top face or with the riser depending on
where the edge falls inside the pixel, and at the default step the edge moves
roughly one pixel per frame, so a run of boundary pixels goes light-dark-light.
`zfight.mjs`'s flat-neighbourhood gate is supposed to throw exactly this away,
and it does not fire here because in frame 0 the pixel sits inside a **flat**
run of parapet rim — the neighbourhood is uniform even though the pixel is a
boundary. More than half of every flagged pixel in the frame (719 → 189 with the
deck hidden) comes from deck edges.

## 5. The 85 pairs in `roofs.geojson` are a different fact

They are not the same fact. Located and classified:

* **All 85 sit in two places**, and neither is in this frame: **Gregory Gym**
  (`-97.7368, 30.2842`) and **Jester** (`-97.7355…-97.7373, 30.2817…30.2827`).
  The `westcampus-day` camera is at `-97.74495, 30.28660` looking on bearing
  205 — Gregory is ~780 m east and ~290 m south, behind the camera.
* Attributing every facet to a footprint and run-length-encoding the file shows
  a clean tail: indices **3916–4896** are Gregory Gym, Jester West Hall,
  Beauford H. Jester Center and Longhorn Dining Facility — the block
  `bake_roofs.py` appends **after both resolvers**, deliberately, under the
  heading *"the authored elevations"*.
* Of the 85 pairs: **84 are authored × authored** (76 m² of shared face in
  total) and **1 is authored × generic** — feature **#4026** (Gregory Gym gable
  front, `az 274.9`, `rd #947f69`, top **22.18**) against feature **#752**
  (Gregory Gym generic stepped hip facet, `az 95`, `rd #c05d3c`, top **22.17**),
  **42.4 m² at 100 % shared**. **0 pairs are generic × generic**, which agrees
  with the bake's own claim that `resolve_surfaces` clears that class.
* The 84 are *by design* and the bake says so: "a jamb, the archivolt over it,
  the pediment over that and the corbel on its rake all share the same square
  metre of ground by design, at four different heights". The catch is that its
  argument is *"at four different heights"* and `coplanar.mjs` only ever reports
  pairs at the **same** height, so the 84 are the cases the argument does not
  actually cover.
* `zfight.mjs` reports **(none)** for all seven other poses, and none of them
  looks at Gregory or Jester. **Nothing in the suite has ever seen these 85
  flicker.** They are a static risk with no observed symptom.

## 6. Recommendation, and who owns each piece

**W6-a — the reported cluster. Fix the detector, not the city.**
Owner: `scripts/verify/zfight.mjs`. The flat-neighbourhood gate should reject a
pixel whose flip partner is a **silhouette**, not only one whose 3×3
neighbourhood is busy. The cheapest correct version is to require the A-B-A to
survive **two different camera steps** — run the triple at `dz` and at `dz/3`
and keep only pixels flagged by both. It is one extra triple per pose and it
would have returned `(none)` here. Do **not** raise `minCluster`: 242 px is a
perfectly respectable real z-fight size.

**W6-b — the coplanar plane at 9.00 m. Real, worth closing, not urgent.**
Owner: `scripts/bake_roofscape.py` (the number) with `js/app.js`'s `CAP_GEOM`
(the rule). `CAP_GEOM.liftFor` is already exported for exactly this reason and
the bake does not use it — it cannot, it is Python. So either the bake reads the
lift from one shared JSON constant, or `deck_b` gains a named clearance in the
bake's taste block the way `SF_HEAD_BEARING = 0.03` did in `bake_places.py`. It
does not fix W6-a and this pass has measured that it does not, so it should be
merged on its own merits rather than sold as a flicker fix.

**W6-c — the one genuine cross-system roof pair.** Owner:
`scripts/bake_roofs.py`. #4026 + #752 on Gregory Gym is an **authored** gable
front and a **generic** stepped hip claiming the same 42.4 m² at the same
height, and the resolver never compares them because the authored block is
appended after it runs. Either run the authored parts through
`resolve_across_roofs` against the generic ones (not against each other), or
give the generic facets under an authored elevation to the elevation.

**W6-d — make the 84 legible instead of alarming.** Owner: `scripts/bake_roofs.py`
plus `scripts/verify/coplanar.mjs`. The bake should stamp the authored block
with a property (`el: 1`) and the checker should count them separately, so
"85 overlaps" becomes "1 overlap, 84 authored elevations sharing ground by
design". A detector that reports 85 things nobody will ever act on is a detector
that gets ignored the day it finds a real one — which is §94's own argument for
fixing 195 rather than relaxing the epsilon.

### On a third copy of `STEP_LIFT` — asked for directly, so: no.

`bake_depth.py` has `STEP_LIFT = 0.03` and `bake_places.py` now has
`SF_HEAD_BEARING = 0.03`. A third copy here would be **the wrong fix, and this
pass has the A/B to prove it**: 0.02, 0.05 and 0.15 m of exactly that clearance
were applied to the deck and the cluster did not move.

The shared rule that *is* worth having is not a constant, it is the law PR #78
already wrote for the ground: **one square metre, one surface, and one owner
decides.** On the ground that was implemented as a **rank ladder in the data** —
"nothing is moved in z and no layer order changes; the ambiguity is removed from
the DATA, so it cannot come back at a camera angle nobody photographed". That is
strictly better than a lift, because a lift is a number that has to be big
enough for the far plane and small enough not to read, and it has to be re-tuned
every time something moves. The roof stack (`buildings-3d` → `buildings-roof` →
`roofscape-deck` → `roofs-pitched` → clutter) is a ladder with no rungs written
down: every one of those four passes decides where the surface above it starts
by re-deriving the one below. Writing that ladder down once, in one place both
Python and JS read, is the fix that generalises. Three copies of `0.03` is the
fix that does not.

---

## What did NOT work, in the order it cost time

1. **The first probe painted every layer magenta and it was silently blind.**
   Wall layers are `fill-extrusion-pattern`; `fill-extrusion-color` is ignored
   on them and the probe returned a confident 0 for `buildings-3d`,
   `wc-wall` and the rest. If a magenta mask returns zero for a layer you can
   plainly see on screen, suspect the property before the geometry.
2. **Counting magenta inside the reported BOX instead of on the flagged
   PIXELS.** The box is 228 × 69 = 15,732 px and the cluster is 242 of them, so
   `roofscape-deck` scored 7,378 and `austin-signs` 3,498 — both were just
   things that happen to be in the box. The box is a bounding box, not the
   defect. Read the flagged pixels out of the mask PNG.
3. **Probing at one pose named one of the two contenders and looked complete.**
   Frame 0 says `buildings-roof` and nothing else, and that reads like a whole
   answer. The partner only appears at frame 1.
4. **Three browser runs died mid-probe** with `Target page, context or browser
   has been closed` on swiftshader, twice inside the tile-settle loop. Not the
   watchdog (`VERIFY_MAX_MS` was 900,000–1,500,000). Re-running worked each
   time; log every layer as you go or you cannot tell which one it died on.
5. **`mask4`'s frame 2 returned 0 for every layer** — a broken reading, not a
   result. The mean colour was correct, so the reference was captured before the
   canvas had repainted after the pose change. It is quoted above only as the
   mean, not as a layer attribution.
6. **`git stash -u` was not used** (it deletes `scripts/verify/node_modules`).
   Nothing needed stashing; every A/B in section 4 was done at runtime with
   `setPaintProperty` / `setLayoutProperty`, which is better than editing a bake
   anyway — it changes exactly one thing and leaves no file to restore.

## What this pass did NOT do

* **Nothing is fixed.** No js, no data, no bake, no `scripts/verify/`. This is
  one document.
* **The 84 authored pairs were classified but not photographed.** They are
  asserted from geometry and from `bake_roofs.py`'s own prose. No render has
  ever shown Gregory Gym's or Jester's roofs flickering, because no pose in
  `shots-places.json` points at them. **A pose that does belongs in
  `scripts/verify/shots-*.json`** before anyone claims they are fine.
* **Only the `westcampus-day` pose was examined.** The other seven report clean
  and were not re-run; §95's reading of them stands.
* **Night was not looked at.** `zfight.mjs` reports nothing at night for this
  pose, and the mechanism found here explains why — the deck and its rim
  collapse to nearly the same night value, so the boundary pixel has nothing to
  flip between.
* **No performance number.** Nothing in this pass changes what is drawn.
* **`HANDOFF.md` was not written.** This pass's write allow-list was
  `docs/night/flicker.md` only. The record that belongs in `HANDOFF.md` is this
  file; it can be summarised into a section at the END of `HANDOFF.md` by
  whoever takes W6-a next, and it should be numbered against `main` at that
  moment rather than against the tree of the day.
