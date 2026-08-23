# Which door — the W-DOOR pass, 2026-08-23

Simeon, on the walk feature: *"So many entrances per building, and many routes
if not most take you to a farther entrance than you have to go. you need to do
research on where students actually enter buildings."*

He was right, and the research had already been done by somebody with a tape
measure. **UT Facilities publishes its own hand-surveyed record of the real
front door of 67 campus buildings** — the `Celebrated_Entrances` layer behind
maps.utexas.edu — and this build was ignoring it. Scored against that survey,
the door the router walked you to was the right one on **16 of the 55**
buildings it can route to. On the other 39 the right door was already in our own
data, correctly placed, wearing the label `secondary`, and the router was
structurally unable to see it.

**On twenty class-to-class pairs, the walk now ends within 4.8 metres of the
door UT itself puts on the map, down from 66.6. Across all 55 buildings, the
worst door the router might pick is 3.7 m out, down from 29.1.**

---

## The number

`scripts/verify/walk-pairs.json` and `walkmeter.mjs` were not on any branch this
worktree could reach when this pass ran, so the metric was built here to the
same definition: **twenty class-to-class pairs, scored by how far the chosen
door is from the nearest door UT publishes for that building, at both ends.**
The twenty pairs and the harness are in this session's scratchpad
(`pairs.json`, `doormeter.mjs`, `allcodes.mjs`); the pairs are listed at the
bottom of this file so the run is repeatable. Every reading below came from
driving the real page through `window.wayfindRoute()` on
`python scripts/serve.py 8711`, not from reasoning about the graph.

| | before | after |
|---|---|---|
| total extra metres over 20 pairs | **1332.0 m** | **96.8 m** |
| mean per pair | 66.6 m | 4.8 m |
| worst single pair | 120.3 m | 15.7 m |
| chosen doors within 15 m of a UT door | 7 / 40 (18%) | **40 / 40 (100%)** |

And over every building UT covers, not just the twenty pairs — this is the
stronger test, because a pair list can be lucky:

| 55 routable buildings UT surveyed | before | after |
|---|---|---|
| mean error of the door the router picks | 29.1 m | **3.7 m** |
| buildings where EVERY candidate door is within 15 m of UT's | 16 / 55 | **54 / 55** |

The one that is left is `JON` (Jesse H. Jones Hall): UT's entrance there is 57 m
from the nearest footway anybody has mapped, past the cap below, so it keeps the
door it had.

Some routes got **longer** and that is the point. `PAT -> BIO` went from 376 m
to 470 m because the old route stopped 62 m from Biological Laboratories' actual
west entrance and the walk from there was uncounted. Others got much shorter:
`WAG -> NHB` fell from 537 m to 295 m, `GDC -> RLP` from 484 m to 394 m,
`JGB -> WEL` from 316 m to 229 m.

---

## What changed, in order

### 1. UT's survey is now truth, in `js/wayfind.js`

`Celebrated_Entrances_view` ships as a literal 97-row table inside
`js/wayfind.js` — `CODE lat lon side barrier-free auto-opener` — and
`doorSet()` consults it before anything else. A table rather than a fetch,
because a fetch that fails at boot leaves the feature worse than it started and
a table in the file shows up in a diff. Re-pull it with:

```
python scripts/bake_entrances.py --refresh-ut
```

which prints a table to paste into **both** `scripts/bake_entrances.py` and
`js/wayfind.js`. The two copies exist on purpose: the router reads its own,
so the door choice is right on a checkout whose `data/walk_graph.json` is older
than the bake's output — which is exactly the situation this round shipped in.

### 2. Under 12 m it is our door; over 12 m it is a different door

`WAYFIND.utDoorMatchM = 12`. Not a round number. Of the 83 UT doors on buildings
this build can route to, the distance to our own nearest door falls out like
this:

```
  0-  4 m  ############# 13
  4-  8 m  ############ 12
  8- 12 m  ##### 5
 12- 16 m  #### 4
 16- 20 m  ####### 7
 20- 24 m  ####### 7
 24- 28 m  ########### 11
 28- 32 m  ### 3
 ...
```

Two piles with a trough between them. Under the trough our door **is** UT's door
and only the role was wrong — relabel it and route there, because a real door is
drawn in the city and a coordinate is not. Over the trough it is a different
doorway on a different wall, and treating it as a match is what let the router
arrive 28 m from Welch's east door while a 2 m match sat in the same candidate
list.

### 3. A door UT surveyed that we never placed becomes a routing target

For 26 of the 55 buildings there is nothing within 12 m to relabel, because our
data simply has no door there. Rather than walk people to the far side of the
building, `doorSet()` builds a target at UT's own coordinate and snaps it to the
nearest usable node of the walked network — skipping nodes whose every edge is
`F_OFFMAIN`, or the building would go from "wrong door" to "no route".

It is a **target, not geometry**. Nothing new is drawn on the building at run
time, and the last stretch is the same dashed, *"the last stretch isn't a mapped
path"* leg every unmapped door already gets, counted in the distance like every
other metre. `WAYFIND.utVirtualSnapM = 45` caps how far that dashed line may
run. 45 m is long, and it is the honest length of one: the Music Recital Hall's
entrance really is 37 m from the nearest mapped footway, and the alternative is
arriving at the wrong door and walking those metres uncounted.

### 4. "Avoid stairs" now knows about doors, not just paths

UT records, per door, that Batts Hall's north entrance is up a flight with no
auto-opener while its east entrance is barrier-free. The toggle used to change
only the path cost, so a step-free route could still end at the top of a
staircase. `doorSet()` now takes `avoidStairs` and drops UT's non-barrier-free
doors from the candidate set when it is on. This is still **not** an
accessibility guarantee and the card still says so.

### 5. Side doors can win on the 228 buildings UT does not cover

The old rule — one `role: main` door and nothing else, ever — came from
HANDOFF #113, and it was right about the problem: minimising over every door
pair walks adjacent buildings back-door to back-door. But `role` is assigned by
a publicness score, and making a score the *only* thing the router will consider
makes a wrong score unrecoverable.

So `legBetween()` runs a second Dijkstra over every routable door on both ends,
and keeps it only if it is shorter **after each door pays a handicap**:
`sideDoorPenaltyM = 55` for a `secondary` door, `backDoorPenaltyM = 400` for a
service, exit or emergency door. A back-door pair of the kind #113 caught saved
76 m; it would now have to save 110. Ends UT surveyed are never widened —
ground truth does not get outvoted by a 55 m saving.

**The handicap never touches a printed number.** If the second pass wins it is a
real route with its real link metres; the handicap exists only in the
comparison.

Measured cost of the second pass, warm, minimum of 7 interleaved reps on a
quiet-ish machine (CLAUDE.md rule 10), `widenSideDoors` flipped in place on one
page: **0.0–0.9 ms**. A cold first call read 181 ms and that was JIT, not the
pass — the same route ran at 2.4 ms warm with the flag off.

```
pair          narrow(min)   widened(min)   cost
CLA->PAR         2.40 ms      2.40 ms     0.00 ms
JCD->GDC         1.30 ms      2.20 ms     0.90 ms
SZB->EER         2.60 ms      3.00 ms     0.40 ms
```

### 6. The bake now carries it too — `scripts/bake_entrances.py`

The runtime table fixes the router. The bake fixes the data, so the fix survives
the next rebake and so the doors get **drawn** where UT says they are:

```
UT celebrated : 30 of our doors relabelled `main` from UT's own survey,
                47 doors placed that we never had,
                 2 of our `main` labels demoted
                (no host 13, unplaceable 0, normal test 4)
entrances     : 706 on 295 buildings   (was 656)
  by src      : {'derived': 573, 'westcampus': 21, 'ut': 47, 'osm': 63, 'authored': 2}
```

A placed door goes through the same `snap_to_edge` / `normal_test` /
`clear_buried` gauntlet an OSM entrance node does, and carries `src: "ut"` so
the provenance is never laundered into `derived`. The OSM-recall floor the bake
asserts on every run is unchanged and still passes (67% at 8 m, floor 65%).

**The diff is UT's doors and nothing else, and that was checked rather than
asserted.** Two new switches make it checkable:

* `SNAP_DATE=2026-08-16` pins the bake to a named snapshot instead of
  `manifest.latest`. It is needed because the manifest had already rolled to
  `2026-08-23` while the shipped `data/entrances.geojson` was built from
  `2026-08-16` — rebaking without the pin would have smuggled a whole snapshot
  roll into a door-choice diff.
* `UT_STAGE=0` turns the new stage off.

With both set, `python scripts/bake_entrances.py` reproduces the committed file
**byte for byte** (md5 `0c4ffff393519b61d6a695d116e8df1d`). The shipped file is
the same run with `UT_STAGE=1`.

---

## What this does NOT do, stated plainly

* **`data/walk_graph.json` is not rebaked, so the bake's 47 new doors do not
  reach the router this round.** That file belongs to `scripts/bake_walk.py` and
  another lane, and this lane may read it but not write it. Every number above
  is from the runtime table in `js/wayfind.js`, which is why that table exists.
  **The exact patch for whoever owns it is one command:**

  ```
  python scripts/bake_walk.py          # after this branch merges
  ```

  and then, optionally, `WAYFIND.utVirtualDoors` can go to `false`, because the
  virtual targets will have become ordinary doors with real geometry. Do not
  flip it before the rebake.

* **`js/wayfind.js`'s copy block is untouched**, and it should not stay that
  way. A door that came from UT's own survey prints *"Entrances are on this
  side"* — the sentence for a guess — because `doorPhrase()` maps `src` and does
  not know `'ut'`. That understates rather than overclaims, so it is safe, but
  the honest line already exists in the permitted list. **The exact patch, for
  whichever lane owns the copy block:**

  ```js
  // js/wayfind.js, in doorPhrase(), before the `src === 'osm'` branch:
  if (src === 'ut') return SAY.doorOsmMain;      // "The main entrance"
  ```

  `SAY.doorOsmMain` is already permitted for a surveyed main entrance and UT's
  survey is a stronger source than an OSM `entrance=main` node, so this needs no
  new sentence and no argument with
  `docs/walk/what-we-can-honestly-say.md`. A better line — naming UT's map as
  the source — would need one.

* **No walking-height photograph of one of the 47 newly placed doors.** The
  aerial frames are in `shots/walk/door/` and the map holds 1,313 features
  tagged `src: "ut"` (read off `querySourceFeatures('austin-entrances')` in the
  running page), so the doors are in the data and on the map. But three attempts
  at a z19.6+ ground pose died on the ten-minute watchdog on this machine, under
  SwiftShader and on hardware GL, with several sibling lanes running browsers at
  the same time. **This is the first thing the next pass should look at**, with
  `scripts/verify/doorwalk.mjs`, which exists for exactly this.

* **No lighting and no stairs-avoidance beyond the door filter.**
  `docs/walk-evidence.md` §D found 532 already-baked `lamp` props waiting to be
  used; nothing here touches them.

---

## The twenty pairs

```
JES->WEL  GDC->RLP  EER->GDC  PCL->MEZ  WAG->NHB
BME->JES  MAI->CAL  CMB->PCL  JGB->WEL  PHR->PAI
UTC->GDC  PAT->BIO  GOL->SUT  WCH->BAT  MBB->PMA
CAL->BUR  UA9->EER  CMA->DMC  ECJ->ETC  SZB->JES
```

Chosen for a plausible student day across the whole Forty Acres and weighted
toward the buildings `docs/walk-evidence.md` measured as worst. Both ends of
every pair are buildings UT surveyed, so both ends are scoreable.

## The pictures

`shots/walk/door/`, magenta = the door UT publishes, cyan = the door the router
picked, all at the same pose before and after:

* `before-pcl-mez.jpg` / `after-pcl-mez.jpg` — the clearest one. The route used
  to end at the north end of Mezes Hall, 40 m from either door UT lists; it now
  ends in the breezeway between MEZ and GSB, which is what UT's own field note
  says: *"Access point is the breezeway between MEZ and GSB."*
* `before-wag-nhb.jpg` / `after-wag-nhb.jpg` — 537 m to 295 m.
* `before-eer-gdc.jpg` / `after-eer-gdc.jpg`, `before-jes-wel.jpg` /
  `after-jes-wel.jpg`.
* `check-pcl-jes.jpg` — the HANDOFF #113 pair, both ends now decided by UT's
  survey: PCL's north entrance off the library plaza and Jester's northwest
  entrance face each other across Speedway, 100 m apart.
* `ut-bio-west.jpg`, `ut-mai-west.jpg`, `ut-gdc-south.jpg` — buildings where the
  bake placed a door we never had.

## Sources

UT Austin celebrated entrances, © The University of Texas at Austin, fetched
2026-08-23 from the public, unauthenticated ArcGIS layer
`services9.arcgis.com/w9x0fkENXvuWZY26/.../Celebrated_Entrances_view/FeatureServer/0`
— the same data maps.utexas.edu itself draws. Campus paths and entrance nodes
© OpenStreetMap contributors, ODbL. Prior recon: `docs/walk-evidence.md`.
