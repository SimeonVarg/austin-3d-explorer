# The trees at eye level — what is actually wrong, and why nothing changes tonight

Acer lane, 2026-08-17, the night before the AWS recording. **Read-only. No app
file, bake script or data file was changed.** The only things this pass created
are this file and the 28 pictures in `shots/trees/`.

Driven against a throwaway worktree of `origin/main` (`2ba9965`) served by
`python scripts/serve.py 8601`, at `?clip=1&preset=cinematic&intro=0&drift=0`,
1440x900, hardware GL, graphics auto-detect probe cancelled, `updateSky` forced
once per pose so `aeMeter` runs.

**Noise floor first.** Two identical settled poses, same browser, same session:
**0 pixels over the suite's 24 threshold, max channel delta 16.**
(`SM-noise-b` vs `SM-eye-N-day`.) The *first* pair in the run — `SM-noise-a` vs
`SM-noise-b` — came back **11,070 px over 24**, and that is not renderer noise:
the vector tiles were still arriving (source features 9,866 → 24,631 between the
two shots). **The first pose of any run in this app is not a measurement.**

**Two opposing bearings at every site and at every altitude on the ladder.** The
answer is the same both ways. It is the city, not the camera.

---

# VERDICT: THE TREES ARE FINE AT EVERY ALTITUDE HE WILL RECORD FROM. CHANGE NOTHING.

The brief tells him to stay between 80 and 350 m. **At 80 m the trees are one of
the best things in the app** — `shots/trees/LAD-080-N-day.png` and
`LAD-080-S-day.png`, two opposing bearings, are both keepers. They already read
as a leafy campus. At 200 m they are texture (`LAD-200-N-day.png`).

The defect is real, it is worse than "blocky", and it is **entirely confined to
being underneath a canopy.** It is not a distance problem. It is a *below-the-
crown-base* problem, and 80 m clears it by a factor of about six.

---

## What is actually wrong — "blocky" is three separate things, and only one matters

### 1. THE PRIMARY DEFECT: at eye level you see the flat, unshaded UNDERSIDE of the canopy

This is the diagnosis. Not the silhouette, not the sides — **the bottom face.**

A crown is a stack of octagonal prisms with `fill-extrusion-base` set. MapLibre
draws a base cap on such an extrusion, so every tier has a **flat horizontal
bottom face, painted one uniform colour with no shading of any kind.** Standing
at 1.7 m under a live oak whose crown starts 3–5 m up, that face is what fills
your frame: a green ceiling with a hard straight edge.

* `shots/trees/SM-back-25m.png` — the clearest single picture. The top third of
  the frame is one unbroken flat green plane.
* `shots/trees/GU-eye-S-day.png` — same on Guadalupe, and note there is exactly
  **one** trunk in a frame containing six canopies (see defect 4).
* `shots/trees/LAD-005-N-day.png` — the worst frame in the set. From 5.8 m the
  tier is edge-on: **a flat green bar spanning the entire width of the frame,
  one colour, no form at all.**

The crown gradient we already have does not help here. `TREE_SHADE.depth = 0.85`
ramps colour over `tf`, the tier's height fraction — a gradient you read **from
above or from the side.** From below you see undersides, and the undersides of
adjacent tiers differ by a fraction of the ramp. Measured in the frames: the
tier-to-tier difference under the big South Mall elm is invisible.

**On campus, 74% of crowns start above 1.7 m** (median crown base 2.7 m), so a
walker is underneath three quarters of the trees on the mall.

### 2. THE TIERS ARE PLATES — and there is a number for it

A tier's **width divided by its thickness**, over all 59,884 canopy tiers:

| p10 | p25 | **median** | p75 | p90 | max |
|---|---|---|---|---|---|
| 1.3 | 2.3 | **3.2** | 4.8 | 7.4 | 12.7 |

**34% of all tiers (20,545) are more than four times wider than they are thick.**
The big 5-tier elm on the South Mall is 18.6 m across and 2.5 m per tier — 7.4:1.
That is a plate, and `shots/trees/LAD-012-N-day.png` is what a stack of them
looks like from 12 m: an unmistakable wedding cake.

### 3. THE CANOPY IS AN OCTAGON, and up close you can count the corners

**Every one of the 59,884 canopy tiers is an 8-sided polygon.** No exceptions.
The deviation between an octagon and its circumcircle is `0.076·r` — 0.69 m on a
9.3 m crown. Converted to screen pixels at 1440 px / 62° fov:

| camera | slant to crown | tier step | octagon corner |
|---|---|---|---|
| eye 1.7 m, tree 8.5 m away | 8.5 m | 352 px | **100 px** |
| eye 1.7 m, tree 25 m away | 25 m | 120 px | **34 px** |
| alt 5 m | 13.7 m | 218 px | **62 px** |
| alt 12 m | 33 m | 90 px | **26 px** |
| alt 30 m | 85 m | 35 px | **10 px** |
| **alt 80 m** | **231 m** | **13 px** | **3.7 px** |
| alt 200 m | 582 m | 5 px | 1.5 px |

**The octagon corner drops under 4 px at 80 m and under 2 px at 200 m** — below
what survives a video encode. The arithmetic and the pictures agree exactly.

### 4. Two smaller things, both only visible at eye level

* **40% of campus crowns have no trunk at all** — 7,556 trunks for 12,602 crowns
  inside the core box. `bake` only emits a trunk when the crown base is above
  2.4 m. So four campus trees in ten are a green mass with nothing under it, and
  in `GU-eye-S-day.png` the whole canopy on the right side of the frame floats.
* **A trunk is an axis-aligned SQUARE, 4 sides, unrotated.** From any bearing near
  a cardinal you see one face, one flat colour, and it reads as a brown plank —
  `SM-eye-N-day.png`, dead centre. At night it is a pure black rectangle
  (`SM-eye-N-night.png`).

### 5. NOT a defect: variety

43 distinct forms (species × tier count) across 27,043 crowns, and the bake
already varies species, radius profile, height, tier count, per-tier 14° twist,
squash and a per-tree hue bucket. **A row does not read as a repeated stamp.**
Rule that hypothesis out. (The one thing that genuinely does not vary: plan
aspect is 0.94–1.15, median 1.03, so every crown is a circle from above.)

### 6. Night at eye level is worse than day, and nothing about it is subtle

`SM-eye-N-night.png`, `WC-eye-N-night.png`: with the sun gone there is no shading
left at all, so each canopy collapses to a single flat dark-green shape with hard
straight edges — it reads as a painted wall. **Do not put night footage at
walking height in this video.** Night at 30 m is fine (`LAD-030-N-night.png`).

---

## Where it stops mattering

Photographed at the same tree row, pitch fixed at 70° so altitude is the only
variable, two bearings at 30 and 80 m:

| altitude | verdict |
|---|---|
| 1.7 m (eye) | **unusable** — flat green ceiling, plank trunks |
| 5 m | **worst frame in the set** — a flat green bar across the whole frame |
| 12 m | clearly a stack of drums; a wedding cake |
| **30 m** | **reads as a tree.** Flat tops still visible on the nearest 2–3, octagon corners countable on those. Usable footage. |
| **80 m** | **good — genuinely good.** No slab read anywhere in either bearing. |
| 200 m | trees are texture |

**The crossover is between 12 m and 30 m.** It is clean by 30 m and gone by 80 m.
The brief's own floor of 80 m is already 2.5× more conservative than it needs to
be. *"Avoidable by staying above 80 m"* is not just an acceptable answer for
tomorrow — it is a generous one.

---

## Why there is no one-line fix, checked rather than assumed

The hope was that a constant adds sides or varies height. It does not exist.

* **Sides.** `octagon()` in `scripts/fetch_city_trees.py` hard-codes `range(8)`.
  Going to 12 or 16 sides is a bake change to `data/trees.geojson` — **the largest
  file the app fetches (27.6 MB raw)** — and the trees are **tiled**: after the
  bake the PMTiles archive has to be rebuilt through GitHub Actions, because
  tippecanoe has no usable Windows build. That is a network round-trip on a
  pipeline that cannot be re-verified end to end before a morning shoot, for a
  defect that is 3.7 px at his recording altitude.
* **Tier count / thickness.** `TIERS_BY_RADIUS` and `TIER_TWIST_DEG` live in
  `scripts/shape_trees.py`. Same bake, same tile rebuild.
* **Shading the underside — not possible with what we have.** `fill-extrusion`
  takes one colour per feature; there is no per-face control. The only lever is
  `fill-extrusion-vertical-gradient`, and it is already deliberately `false` with
  the reason written down: with real tiers it darkens the bottom of *every* tier,
  which is five shadows up one tree.
* **What IS runtime and one line:** `window.TREE_SHADE.depth` / `.jitter` in
  `js/app.js`, and `GFX.treeDensity`. **Neither touches the diagnosis** — both act
  on the crown gradient, which is invisible from below. Turning them up cannot
  fix an unshaded horizontal plane.

## Risk assessment for tonight, specifically

**Recommendation: change nothing.** This is not caution for its own sake —

1. **The gain is zero at the altitudes he will record from.** Every candidate fix
   improves frames he has been told not to shoot, and the go/no-go already ranks
   walking-height footage as thing-to-avoid #2.
2. **The blast radius is every frame.** Canopies are 59,884 features and they are
   in shot from the ground to 900 m. A re-bake that shifted tier counts would
   change the look of the 80 m and 200 m frames — the ones that are currently
   *good* — and there is no time to re-judge those blind tonight.
3. **A tree change can break walking.** `js/controls.js` builds its collision
   field from `trees-trunk` features and tests the trunk as an exact circle
   (`TRUNK_SRC = 'austin-trees'`). Any bake that touches trunk geometry or the
   `base >= 2.4 m` trunk rule silently changes where you stop. That is a
   demonstrated feature in the video.
4. **The tile pipeline is the real hazard.** A bake without the matching PMTiles
   rebuild leaves the app serving the OLD shapes with no error — the failure mode
   is "nothing happened", which is exactly the kind of thing that looks fine in a
   local check and is wrong on the deploy in the morning.

## How to frame around it tomorrow

* **Stay at or above 30 m and there is no tree problem at all.** 80 m is already
  well clear.
* The rule is not distance, it is **crown base**: never put the camera under a
  canopy. Campus median crown base is 2.7 m, so at walking height you are under
  three quarters of them.
* **No night footage at walking height.** Day at eye level is bad; night at eye
  level is worse.
* If a ground-level beat is wanted anyway, the least-bad version is an open
  space with the camera looking along a street rather than up a tree-lined walk,
  and it should be short.
* `shots/trees/LAD-080-S-day.png` — 80 m over the Drag looking south, downtown
  skyline on the horizon, red roofs, tree-lined street — is a shot worth stealing
  for the video.

---

## What this pass did NOT establish

* **No fix was built, so no fix was judged.** Everything above about more sides,
  thicker tiers or a shaded underside is reasoning from the geometry and the
  render, **not** a candidate that was baked and looked at. The claim "a 12-sided
  canopy would look better" is untested.
* **No frame-rate number was taken.** Nothing here says what the trees cost. The
  app.js comment claims ~6–7 fps at 1440x900 for the full set; that was not
  re-measured tonight.
* **One machine, one browser, hardware GL, siblings running on the same box.**
* **Only three ground sites** — South Mall, Guadalupe, one West Campus street.
  The creek plantings behind Patton/San Jacinto were not visited, and those are
  the densest canopy in the data.
* **The altitude ladder is one ground point and one pitch (70°).** A shallower
  pitch at 30 m puts trees further away and would read better; a steeper one
  worse. The 30 m verdict is for that framing.
* **The live site was not used.** Everything is a local worktree of `origin/main`
  at `2ba9965`; the deploy was verified at the tip separately this morning in
  `docs/aws/go-nogo.md`.
* **`trees-canopy` was confirmed visible and drawn at every altitude up to 200 m**
  (it is in the LOD `mid` tier), so none of the "good" verdicts are a layer that
  quietly went missing. It was not checked above 200 m.

---

# ADDENDUM — second Acer pass, 2026-08-17 night, branch `acer/r6-trees`

**Also read-only as far as the app is concerned. No app file, bake script, data
file or tile archive was changed.** This pass was sent to *act on the diagnosis
above or refuse it*, with a deliberately high bar: ship only if a change was
provably better at eye level AND provably invisible between 80 and 350 m.

## VERDICT: the recommendation stands. NOTHING CHANGED. And there are now two
## reasons that are stronger than the original ones.

The first pass argued from cost and risk. Both of those still hold, but they are
no longer the binding constraint — the binding constraint is that **the change
is not reachable from here at all.**

### 1. `js/trees.js` DOES NOT EXIST. The runtime tree layer is in `js/app.js`.

The one-line runtime levers the diagnosis listed — canopy colour, the tier
gradient, `fill-extrusion-vertical-gradient` — are all defined in the
`trees-canopy` / `trees-trunk` layer block in **`js/app.js`** (about lines
1370–1423), with the source wired in **`js/tiles.js`**. Neither file was
writable by this lane, and `js/trees.js` is not a file in this repository.

Confirmed while reading it: `'fill-extrusion-vertical-gradient': false` carries
its reason inline, and it is the same reason the diagnosis gave — with real
tiers it darkens the bottom of *every* tier, which is five shadows up one tree.
That lever is correctly shut.

### 2. THE APP DOES NOT READ `data/trees.geojson`. It reads `trees.pmtiles`.

This is the important one, and it converts the diagnosis's hazard #4 from a
worry into a fact.

`js/app.js` asks `window.tileSource('trees')` first and only falls back to
`data/trees.geojson` when the archives are absent. **The archives are present
and they are tracked in git**: `data/tiles/trees.pmtiles`, 5.8 MB, committed.

So editing `data/trees.geojson` or `scripts/shape_trees.py` — the only tree
files this lane could write — **would have changed nothing on screen.** The bake
would succeed, the diff would look real, every local check would pass, and the
served city would still be the old shapes, because the shapes it draws come out
of a binary that only `tippecanoe` can rebuild (`scripts/tile.sh`; no usable
Windows build; the workflow is `.github/workflows/build-tiles.yml`).

**The failure mode is "nothing happened", with no error, on the morning of a
shoot.** That is the single worst shape a change can have tonight.

## What this pass verified for itself rather than trusting

* **harness-drift PASS** — 29 scripts in `index.html`, 29 in `_harness.html`.
* **The 80 m verdict is real.** `LAD-080-N-day.png` and `LAD-080-S-day.png`,
  two opposing bearings, were looked at again: rounded, varied, leafy, no slab
  read in either. `LAD-080-S-day.png` remains the frame worth stealing.
* **The 5 m frame is as bad as claimed** — `LAD-005-N-day.png` is a flat green
  bar spanning the full frame width with a plank trunk under it.
* **One correction to the framing advice below.** The first pass's summary line
  said *"stay at or above 30 m and there is no tree problem at all"*, which is
  softer than its own table. At 30 m (`LAD-030-N-day.png`) the nearest two or
  three canopies still show flat tops and **countable octagon corners**. 30 m is
  the floor at which it stops being embarrassing, not the altitude at which it
  is clean. **The honest number is the brief's own 80 m.**

## TREE COLLISION: measured, green, and the brief's claim about it was wrong

> **`collision.mjs` does not assert a trunk stop distance.** Its 8 assertions
> are buildings, streets, the tallest tower and the joystick. **No script in
> `scripts/verify` asserts one.** The 1.3 m figure was folklore, not a gate.

So it was measured directly against this build, at walking height on the South
Mall, `?clip=1&preset=cinematic&intro=0&drift=0`, auto-detect probe cancelled:

| | |
|---|---|
| `TRUNK_ON` / `TRUNK_PAD` / radius clamp | `true` / `0.9 m` / `0.2–1.2 m` |
| trunk field once settled | **2,747 trunks**, 4,908 buckets, scan avg 3–4 ms |
| walk closed | **9.2 m** |
| **came to rest** | **1.01 m from the trunk centre, and held there** |
| ever inside a trunk | **no** |

**Walking into a tree still stops you, about a metre short, and never lets you
through.** `walk.mjs` is also **PASS 3/3 sites** on this build, with its watched
failure correctly going red — so the gate is not stuck green.

**Two traps this measurement hit, written down because they will bite the next
person:**

1. **The first pose is not a measurement — for the collision field too.** A
   single `trunkScan()` at 8 s reported **zero trunks**, which reads exactly
   like "tree collision is gone". The field builds incrementally off
   `querySourceFeatures` as tiles arrive and reports completion via its own
   `dirty` flag. Settle on that flag, never on a timeout.
2. **Do not aim at the nearest trunk.** In a grove the nearest blocked cell is
   the one under the camera's own feet, and the walk then goes *away* from it —
   the first run "closed" a gap that grew from 3.0 m to 8.6 m. Target a trunk
   7–14 m out and measure **closest approach**, not end position; sliding along
   a trunk would flatter a before/after reading.

## What this pass did NOT establish

* **Still no fix was built, so still no fix was judged.** Everything about more
  sides, thicker tiers or a shaded underside remains untested reasoning. This
  pass strengthened the case for *not* building it; it did not test it.
* **No frame-cost number was taken, and none was needed** — nothing changed, so
  there is nothing to have made slower. The 47.8 ms → 15.2 ms atlas win is
  untouched by this pass.
* **The `?p=` night ladder was not re-shot**, and the creek plantings behind
  Patton/San Jacinto are still unvisited.
* **Two sibling lanes were running on this laptop throughout.** The collision
  numbers are behavioural, not timing, so load does not move them — but the
  ~4 fps observed during the first 11-second walk probe is **not** a frame-rate
  finding and must not be quoted as one.
