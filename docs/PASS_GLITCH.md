# PASS_GLITCH — the five building passes, looked at together

Written 2026-07-31. PRs #16–#20 landed five building passes — the Tower, West
Campus, The Drag, the arts precinct and the modern east block — built in parallel
against the ownership contract in `docs/PASS_COMMON.md`. They merged cleanly and
nobody had looked at them *in the same frame*. Simeon spotted two defects by eye:

> "flawn academic center roof is bugging out glitching"
> "UT Tower base has a long line going out of it into biomed building"

Both were real. They were not the same bug, and finding that out took the two
tools in this document rather than the two guesses in that sentence. This file
records what was found, what was fixed, what was not, and the checks that now
stop each class coming back.

---

## The result in one table

| # | Defect | Owning layer | Cause | State |
|---|---|---|---|---|
| 1 | Flawn Academic Center's roof flickers as the camera moves | `roofscape-major` (`js/roofs.js` / `bake_roofscape.py`) | Two `plant` slabs at an identical top of 15.95 m sharing 94% of 1,887 m² | **fixed** |
| 2 | A terracotta sliver runs 356 m north from the Main Building into the Biomedical Engineering Building | `tower-roof` (`js/tower.js` / `bake_tower.py`) | Unguarded miter in `offset()`; a 1 m edge folded, then the next inset put a vertex 350 m away | **fixed** |
| 3 | Nine West Campus towers carry a deck and condensers hovering 1.0–1.1 m above their own mechanical penthouses | `roofscape-deck` / `-major` / `-minor` | `bake_roofscape.py` knew only about the stadium's `replacedBuildingIds` | **fixed** |
| 4 | The Moody Center carries arena plant standing ~2 m proud of its authored roof | `roofscape-*` | same as #3 — 253 features | **fixed** |
| 5 | Moontower's shade trellis, crown sign and mechanical penthouse all top out at exactly 57.30 m | `wc-solid` (`bake_westcampus.py`) | shade and sign clamped to `final_height`, where the penthouse already is | **fixed** |
| 6 | Kelly's "Austin": the two barrel vaults are coplanar where they cross | `arts-solid` (`bake_arts.py`) | the crossing rectangles share a top face at every step | **fixed** |
| 7 | Eight more coplanar `plant`/`unit` pairs across the city | `roofscape-*` | same detector fault as #1 | **fixed** |
| 8 | PCL, the Bass/PAC and the ten Snohetta petals carry decks and clutter buried metres inside taller authored geometry | `roofscape-*` | same as #3 — invisible, but ~130 features re-tiled and drawn every frame | **fixed** |
| 9 | 51 coplanar pairs in `data/roofs.geojson` — each pitched roof's ridge cap shares a top plane with its own top slope step | `roofs-pitched` (`bake_roofs.py`) | `top = base + 0.35 + rise` for both the last step and the ridge cap | **NOT fixed — see below** |
| 10 | **The entire roofscape — 11,683 features — is absent from the scene on a coin flip, and nothing says so** | `js/roofs.js` | `autoInstall` polled `isStyleLoaded() && getLayer('buildings-3d')` 600× and gave up in silence | **fixed** |

Two things Simeon's report implied that turned out to be **false**, and they are
worth recording because acting on either would have made the scene worse:

- **No two bakes claim the same building id.** That was the first hypothesis in
  the brief and the first thing checked. All 56 claims across six documents are
  unique and all 56 exist in the snapshot (`scripts/verify/dupids.mjs`).
- **The arts and Drag passes were not doing anything wrong.** A first pass of the
  analysis said the Blanton's and the Smith's pitched roofs, the LBJ, the Ransom
  Center, Gregory Gym and the Union were all floating 1 m above their buildings.
  That was an artefact of measuring the passes' top height from the *baked* `h`
  and forgetting that `js/arts.js` and `js/westcampus.js` draw a **separate cap
  layer** at `CAP_GEOM.height(h)`. Counting the cap, all 27 of those roofs land
  exactly on it, to the centimetre. Deleting them — which the "systemic fix" of
  excluding every replaced building would have done — would have taken the tile
  hip roofs off the Blanton and the Smith and flattened Gregory Gym and the
  Union. **A pass replacing a building does not mean it owns that building's
  roof**, and that distinction is now explicit in the data (see below).

---

## 1. Flawn Academic Center — the reported "glitching"

**Symptom.** From the air the roof carries a large dark rectangle whose edges
dissolve into a comb of horizontal scanlines, and the comb moves as the camera
moves.

**Why a screenshot could not find it.** Z-fighting does not exist in a frame. Two
coplanar faces resolve to one of them for any given frame and look perfectly
fine; the defect lives in the *difference between* frames. Three separate looks
at a still of this roof produced three explanations and none of them was right.

**How it was actually found.** `scripts/verify/zfight.mjs` renders three frames
along a steady, tiny zoom-in and flags pixels that go A, B, A — a value that
leaves and comes straight back is not a camera moving, it is a depth-buffer tie
being re-decided. On this pose it lit up exactly one object in a frame containing
the whole of the central campus, and it was FAC's roof.

**Cause.** `bake_roofscape.py` labels connected components in a threshold mask
and draws each one as its *oriented bounding rectangle*. A big louvre screen with
a gap down the middle comes back as two components, and two bounding rectangles
of two halves of one object are two near-identical rectangles — same kind, so
the same `KIND_H`, so the same top height:

```
roofscape #1977  plant  b=14.45 h=15.95  46.9 x 40.1 m
roofscape #1978  plant  b=14.45 h=15.95  47.6 x 47.2 m     94% shared, 1,887 m²
```

**Fix.** A coplanar-duplicate guard at emission time, not in `survey()` — the
survey is cached in `data/roof_survey.json`, so a change there would not run on
a normal bake. Boxes are compared in the roof's own rotated frame, where they are
axis-aligned with respect to each other and the overlap is exact:

- overlap ≥ `COPLANAR_COVER` (0.35) of the smaller → **drop it**. `draw` is
  sorted biggest-first, so the survivor is always the larger reading. 19 dropped.
- overlap below that but non-zero → **stagger** the later one up by
  `COPLANAR_STAGGER` (0.25 m) instead. A partial overlap is two real objects that
  abut, and deleting one would delete something the photograph saw; two adjacent
  equipment screens are not level in reality either. 100 staggered.

Nine roofs were affected, FAC worst. `scripts/verify/coplanar.mjs` now reports
zero coplanar overlaps in both roofscape documents.

---

## 2. The Tower — the reported "long line"

**Symptom.** Exactly as described: a thin terracotta sliver leaves the Main
Building's roof and runs north the length of the campus, ending at the
Biomedical Engineering Building.

This one needed no renderer at all. `scripts/verify/geomlint.mjs` reads the bakes
and flags any ring that spans more than 260 m:

```
tower.geojson  #12 roof mb-roof-e  ring0: spans 358 m (39 x 356)
```

Seven of its eight vertices sit at latitude 30.2860; one sits at **30.289238**,
which is 350 m north — inside Biomedical Engineering.

**Cause.** The Main Building's hip roof is three stepped bands, each an inward
`offset()` of the last. `offset()` was a plain miter: move every edge line by
`d`, intersect consecutive pairs. That is correct only while no edge is shorter
than `|d|`. These roof arms come out of `clip_box()`, and a clip line that grazes
a vertex leaves a **1 m edge**. Inset by 2.55 m that edge inverts (visible in
band 11 as a 1.5 m notch nobody would ever notice); inset again, the two
now-nearly-antiparallel offset lines meet 350 m away.

**Fix**, in `bake_tower.py`:

- a **miter limit** — a corner may not travel more than 4× the offset distance
  from its source vertex, so no single corner can ever produce a spike again;
- **fold detection** — after offsetting, any edge whose direction reversed
  relative to its source is one the offset could not sustain, so it is removed
  from the **source** and the ring is solved again. Fixing the rule, not the
  cell.
- a **`check()` on the output** that refuses to write the file at all if any ring
  spans more than 140 m or any feature's height is below its base. A guard on the
  output catches every future cause of this symptom, not just this one.

The re-bake changes **2 features of 225** — bands 11 and 12 of `mb-roof-e`, where
the folded edge is now consumed. The other 223 are byte-identical.

---

## 3–4, 8. Roofs on buildings a pass had already redrawn

`bake_roofscape.py` had one hard-coded exclusion, and its comment explains
exactly why it exists:

> DKR is a ring 46,000 m² in plan, and app.js REPLACES its extrusion […] A deck
> baked from the footprint would hang a single enormous slab over the open bowl.

That was right, and it quietly became insufficient the day five passes landed at
once. The bake still baked a generic roof for every building those passes had
redrawn, using the snapshot's `final_height` — which is no longer where the roof
is.

The rule that separates the good cases from the bad is **not** "was this building
replaced". It is **does the pass author its own roof**:

| | pass's own top | generic roof baked at | outcome |
|---|---|---|---|
| Gregory Gym, the Union, the Blanton, the Smith, the LBJ, the Ransom, 21 Drag storefronts | `h` + parapet lift | `h` + parapet lift | lands exactly on the cap — **correct, and this is where those tile hip roofs come from** |
| nine West Campus towers | mech penthouse at `h` | `h` + parapet lift | **floats 1.0–1.1 m** with sky under it |
| Moody Center | authored roof at 28.7 m | up to 30.65 m | **pokes ~2 m through** |
| PCL, Bass/PAC, ten petals | 28.5 / 24.0 / 12.2 m | 16.8 / 15.6 / 9.0 m | buried, invisible, drawn every frame |

Every West Campus tower already authors a deck, a mechanical penthouse, a pool,
shade structures and terrace furniture. The generic deck and its condensers were
duplicating that *and* hovering above it.

**Fix.** The exclusion list is now **declared by the passes** rather than
hard-coded in the roof bake. Any document in `data/` may carry a top-level
`authoredRoofIds`, and `bake_roofscape.py` unions them:

```
westcampus.geojson   authoredRoofIds = all 10
moody.geojson        authoredRoofIds = all 3
arts.geojson         authoredRoofIds = 11   (Bass/PAC + the ten petals — NOT the
                                             LBJ, Blanton, Smith or Ransom)
drag.geojson         authoredRoofIds = 1    (PCL only)
tower.geojson        —                      (has_parts already excludes it)
```

27 buildings are now skipped, against 2 before. `roofscape.geojson` goes 3,716 →
3,649 features and `roofscape.detail.geojson` 8,335 → 8,034.

**Why this shape rather than a flag in the roof bake.** The roof bake cannot work
out the answer for itself without knowing each *module's* cap semantics — arts
and West Campus apply `CAP_GEOM` at render time, The Drag bakes cap features into
its data. Encoding renderer behaviour in a bake script is the kind of hidden
coupling that breaks the next time somebody changes a layer. The pass knows what
it authored; it says so.

---

## 5–6. Two more coplanar pairs, found by arithmetic

`scripts/verify/coplanar.mjs` finds this class statically: features from the same
document whose top heights are within 1 cm and whose footprints overlap by more
than 30% of the smaller.

- **Moontower** had *three* surfaces at exactly 57.30 m: the mechanical
  penthouse (which tops out at `final_height` deliberately — the LiDAR high point
  *is* the penthouse), the shade trellis and the crown sign, both of which were
  clamped to `min(..., H)`. `ROOF_CLEAR = 0.35` now makes both clamp to
  `H - 0.35`. That is also physically right: on a real roof the penthouse is the
  tallest thing.
- **Kelly's "Austin"** is a cross of two barrel vaults, emitted as two crossing
  rectangles per step. The old comment claimed fill-extrusion "handles the
  overlap for free" — true of the volume, false of the two top faces. The E-W
  arm's steps are now lifted by `KELLY_ARM_EPS = 0.04 m`. Only the top moves:
  raising the base as well would open a 4 cm ring of sky under each step, and a
  gap is a worse defect than the one being fixed.

---

## 9. NOT FIXED: 51 coplanar pairs in `data/roofs.geojson`

Every pitched roof in `bake_roofs.py` ends with a ridge cap at
`top = base + 0.35 + rise`, and its topmost slope step ends at the same number.
Where the ridge cap overlaps the last step — which is most of the ridge — the two
top faces are coplanar. 51 pairs across the 100 tiled buildings, the worst
sharing 598 m².

**It is not fixed because `bake_roofs.py` is not reproducible on this machine.**
Re-running it with no code change at all rewrites 9 features:

```
#286   rd #96928a -> #5c6870
#774   rd #7e6964 -> #984f37     (the building's own rd — the non-membrane fallback)
...    9 features, colour only, geometry byte-identical
```

The run/eave measurements are cached in `data/roof_runs.json`, but the **deck
colour** decision is not — it re-reads z20 imagery on every run, and enough tiles
are missing from `data/imagery_cache` that `membrane` flips false and those roofs
fall back to the generic terracotta. Shipping a fix for a z-fight that nothing in
the renderer currently shows, at the price of silently degrading nine measured
roof colours, is a bad trade.

Worth knowing: the corrected flicker detector does **not** flag these roofs at
any of the twelve poses swept. The pitched roofs read clean in motion today. The
pairs are a latent risk — a 16-bit depth buffer on a phone is exactly where the
parapet cap's own coplanarity showed up before (`js/app.js`, `CAP_GEOM`) — not a
current defect.

**To unblock:** restore the z20 imagery cache, confirm `bake_roofs.py` reproduces
`data/roofs.geojson` byte-for-byte, then give the ridge cap the same treatment
Kelly's vault got — a few centimetres of clearance above the last step. While
that cache is being restored, `bake_roofs.py` should also cache its deck-colour
decision alongside run/eave, so this file stops being un-rebakeable.

---

## 10. The one that was not on anybody's list

This was found by accident, chasing what looked like a regression, and it is
probably the most consequential thing in this document.

**Symptom.** The scene renders. The city looks fine. Every roof is a plain lid
in `rd` — which is precisely the state `js/roofs.js` exists to fix — and there
is no error, no warning, and no missing-data message anywhere.

`js/roofs.js`'s self-install was:

```js
const tick = () => {
  const m = window.__map;
  if (m && m.isStyleLoaded && m.isStyleLoaded() && m.getLayer('buildings-3d')) { … return; }
  if (++tries < 600) setTimeout(tick, 100);      // …and then nothing at all
};
```

`map.isStyleLoaded()` is not "the style has been parsed". It is **false while any
source in the style is still loading**, and this scene carries the core
buildings, the outer ring, the ground, ~12,000 trees, ~6,000 props and six
self-booting building passes that each add their own source seconds apart.
Probed 30 s after load on an idle machine it is still false while `buildings-3d`
has existed for ages:

```
hasInit: "function"   ← the module parsed and ran
hasB3D:  true         ← buildings-3d exists
styleLoaded: false    ← …so the conjunction is never satisfied
hasSrc:  false        ← austin-roofscape was never added
```

So the conjunction only ever held if a poll happened to sample during a momentary
gap in source loading. A coin flip. When it lost, **11,683 features were not in
the scene and nothing said so.** This file's own header records that these
features "sat dead in the repo for days" once before; this is the same outcome by
a different route.

It lost during this session's own verification and cost real time: the "after"
screenshot of FAC came back with no roofscape *and no UT Tower*, which reads
exactly like "the fix deleted the roof".

**Fix.** The shape `docs/PASS_COMMON.md` tells every pass to copy verbatim from
`js/outer.js`: take the style's own `load` **event** rather than polling a
predicate that contains it, then poll only for the thing that actually has to
exist. And if it ever does give up, `console.error` — a silent give-up is worse
than a crash, because the scene still renders and looks plausible.

**`scripts/verify/srcprobe.mjs`** is what settled it, and it is kept because the
distinction it draws has no other source: *the module never booted* vs *the
source never loaded* vs *the source loaded but nothing is tiled at this camera*
are three different bugs that produce an identical screenshot.

---

## Where the static checks stand now

```
$ node scripts/verify/dupids.mjs
COLLISIONS (one id claimed by two or more bakes)         none
CLAIMED BUT NOT IN THE DETAILED SNAPSHOT                 none

$ node scripts/verify/geomlint.mjs
tower.geojson                 225 features  clean   (largest ring 118 m)
westcampus.geojson            145 features  clean   (largest ring 112 m)
drag.geojson                  101 features  clean   (largest ring 170 m)
arts.geojson                   79 features  clean   (largest ring 159 m)
moody.geojson                  17 features  clean   (largest ring 232 m)
roofscape.geojson            3649 features  clean   (largest ring 296 m)
roofscape.detail.geojson     8034 features  clean   (largest ring 23 m)
roofs.geojson                2883 features  clean   (largest ring 193 m)

$ node scripts/verify/coplanar.mjs
…all clean except roofs.geojson, 51 pairs — defect 9, filed above.
```

And, as a regression test on the linter itself rather than on the data, the
pre-fix `tower.geojson` still fails it:

```
$ node scripts/verify/geomlint.mjs <the old file>
tower.before.json  225 features  1 ISSUE(S)
    #12 roof ring0: spans 358 m (39x356)
```

That check matters because the span threshold had to be *raised* to 320 m: Sid
Richardson Hall is a genuinely 279 m long building and its roofscape deck was
being flagged every run. A linter that always prints one known-good complaint is
a linter people stop reading — but loosening it is only safe if the thing it was
written to catch still trips it.

---

## The sweep, after all of it

Twelve poses across the detailed bbox, day / golden / night, `balanced` and
`cinematic`, 200–900 m up at 48–66° of pitch — `scripts/verify/shots-sweep.json`,
scored with the guarded `zfight.mjs`. `bldg/roof` is how many features of
`austin-buildings` / `austin-roofscape` were actually tiled at that camera, which
is the difference between "clean" and "empty".

```
pose                    bldg/roof   moved   flicker   clusters
fac-close                 1785/3021   12.8%   0.048%   (none)     <- the reported defect
tower-main                4612/6795   13.5%   0.034%   (none)     <- the other one
wc-roofs                  6180/8840   18.2%   0.066%   (none)
wc-roofs-hi               5078/7368   17.5%   0.051%   (none)
moody-arena               4418/9137   13.9%   0.080%   (none)
arts-precinct             5784/8566   14.5%   0.081%   (none)
drag-corridor             1835/4072   13.5%   0.054%   (none)
core-wide                 6147/8313   20.8%   0.142%   (none)
core-golden               5802/8031   17.5%   0.112%   (none)
core-night                5334/7228    7.4%   0.038%   (none)
east-block                6483/8579   16.1%   0.043%   (none)
wc-night                  5841/8820    6.7%   0.040%   (none)
```

Twelve of twelve clean, and every one of them scanned a scene that had actually
loaded. That is a sweep, not a proof of absence: it says nothing about poses not
in the list, and `zfight.mjs` cannot see a coplanar pair that is off screen —
which is what `coplanar.mjs` is for.

**One thing this table replaced.** An earlier run of `moody-arena` flagged 2.48%
of the frame in twelve clusters, all on the ground plane — paths, plaza edges,
the walkway network — and it was very nearly filed as a `js/ground.js` defect.
It was not one. That run scanned a scene whose sources had not finished tiling
(`-2 buildings tiled`), and the loading churn scored as flicker. The same pose
with the scene actually loaded is clean. **Two runs of mine disagreed, and the
one that agreed with my hypothesis was the wrong one** — which is the whole
reason the `bldg/roof` column now exists and prints `INVALID` instead of a
number.

---

## The checks, and what each one is for

Four new scripts in `scripts/verify/`. The first three are static — no browser,
no server, no camera — which is why they are the ones to run first.

| script | question it answers |
|---|---|
| `dupids.mjs` | do two bakes claim the same building id, and does every claimed id exist? |
| `geomlint.mjs` | are there stray vertices, slivers, unclosed rings, or inverted extrusions? |
| `coplanar.mjs` | are two features in one document sharing a top face? |
| `zfight.mjs` | does anything actually flicker when the camera moves? |
| `peel.mjs` | which layer group is responsible for what I am looking at? |
| `crop.mjs` | magnify a region of a shot so a defect can be *seen* |
| `srcprobe.mjs` | did every pass boot, is its source loaded, is anything tiled here? |

`roofowner.mjs` is the one-off that produced the table in §3; it attributes every
roof feature to a building by point-in-polygon and is kept because "who is
drawing a roof on this building" has no other answer — neither roof document
carries a building id.

### Traps these added, and one bug in the harness itself

- **`zfight.mjs`'s first cut was wrong in a way that looked like a result.** It
  put frames 0 and 2 at the *same* pose and only frame 1 elsewhere, which makes
  `|f0 − f2|` identically zero and flags every pixel any edge moved across. It
  reported the entire city as z-fighting — every building edge, every tree, every
  kerb. A broken discriminator's null result is indistinguishable from a clean
  scene, so the script now measures how much of the frame moved between f0 and f1
  and prints `INVALID` rather than `(none)` when the camera did not actually
  move. It also excludes pixels whose 3×3 neighbourhood is not flat: a z-fight is
  a *surface* flickering, and a one-pixel edge straddling two colours flips for
  ordinary rasterisation reasons.
- **`shot.mjs` waited for three sources and there are ten.** The README's
  cold-server section describes this and the fix was still missing: the wait list
  was `austin-buildings`, `austin-ground`, `austin-trees`, and every building pass
  self-boots, polls for the map and adds its own source *seconds later*. A shot
  taken in that window is a real render of a scene missing whole buildings. It
  bit this session directly and in the most misleading possible way: the "after"
  screenshot of the Flawn Academic Center came back with **no roofscape and no UT
  Tower**, which reads exactly like "the fix deleted the roof". It had not — the
  same pose re-run with the sources waited for is correct. `shot.mjs` now waits
  for all ten, and additionally waits for the pass sources to *exist*, because a
  module that has not added its source yet passes an `isSourceLoaded` test
  vacuously.
- **The same phantom scored as a defect in `zfight.mjs`.** A drag-corridor pose
  returned the ground plane, the building shadows and no extrusions at all, and
  the loading noise in it clustered as flicker. `map.loaded()` and `idle` are both
  true on that frame, so neither is a guard. The script now counts
  `querySourceFeatures('austin-buildings')` — `queryRenderedFeatures` returns 0
  for fill-extrusion at a flying pitch — gives a cold pose three more settles, and
  prints `INVALID` with the count rather than a number nobody should believe.
  **A scan of an empty scene is not a clean scene**, and a false negative here is
  worse than a false positive: it says a defect is fixed when nothing was tested.
- **A stale mask PNG reads exactly like a fresh one.** `zfight.mjs` now deletes
  the mask for a pose that comes back clean. Its own first (broken) run left a
  mask on disk that was briefly read as a current result from the corrected run.
- **`isolate.mjs` can silently fail to isolate.** One run in this session
  returned a frame with every building still visible under `KEEP=['roofscape']`.
  `peel.mjs` re-reads `visibility` in a *later* JS turn and prints which layers
  refused to hide, for exactly this reason.
- **A `file://` image cannot be read into a canvas** from a page built with
  `setContent` — the origin is opaque. `crop.mjs` goes through the dev server.
- **`geomlint.mjs`'s first area threshold was too aggressive.** At 0.5 m² it
  flagged sixteen tower features that are exactly as authored: the window slots
  really are 1.42 × 0.30 m and the clock dials 3.05 × 0.16 m. Only a ring with no
  area at all is a defect; the floor is 0.02 m².

### And one method note worth keeping

The brief's leading hypothesis — two passes claiming one building id — was
checked first because it was cheap and would have explained several defects at
once. It was false. The second hypothesis, "both defects are the same class of
bug", was also false: one was a bake's geometry routine and one was a detector
emitting a duplicate. What actually worked was to make each hypothesis *cheap to
refute*: a duplicate-id script (2 minutes, ruled it out), a geometry linter
(found defect #2 with no renderer at all), and only then the rendering tools.
