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

---

# Round 2, 2026-08-23 — the picture that was missing, the building that could not be reached, and a number that turned out to be right

Round 1 above shipped UT's survey and left three things open. This round closed
all three. The thing it *expected* to be the win turned out not to be one, and
that is the most useful finding in it.

|  | round 1 | round 2 |
|---|---|---|
| buildings UT surveyed that this build routes to | 55 | **56** |
| mean worst-case door error over those buildings | 3.7 m | **2.5 m** |
| every candidate door within 15 m of UT's own | 54 / 55 | **56 / 56** |
| extra metres over the twenty pairs | 96.8 m | 96.8 m (unchanged, on purpose) |

The twenty pairs are unchanged deliberately: all forty of their doors were
already inside 15 m of UT's, so there was nothing left to win there. Everything
below is about the buildings a pair list does not happen to name.

## 1. The walking-height photograph, which was the open debt

Round 1 shipped 47 doors it had never photographed from the pavement — three
attempts died on the watchdog. They are photographed now, with
`scripts/verify/doorwalk.mjs` on hardware GL, eye altitude read back off
`__fly.eye()` after every jump and written next to the frame:

* `shots/walk/door/eye-mai-west.jpg` — the Main Building's west entrance, eye at
  **1.70 m**. A modelled doorway with its steps and stone surround, on the wall
  UT names, on the building everybody recognises.
* `shots/walk/door/eye-bio-west.jpg` — Biological Laboratories' west entrance,
  eye at 2.23 m (the app's own floor at this framing — `ZOOM_MAX` saturates
  below ~18 m of standoff, which the script reports rather than fights). Our
  nearest own door is 62 m away; this is the flight of steps a student climbs.
* `shots/walk/door/eye-sea-southwest.jpg` — the Seay Building's southwest
  entrance, eye at 2.23 m. Oracle error before the bake placed it: **79.8 m**.

That closes the "no walking-height photograph" item. These are real geometry in
`data/entrances.geojson` — a reveal, a frame, glass, steps — not a marker.

## 2. Jesse H. Jones Hall — the one building the cap still refused

`utVirtualSnapM` was 45 m and Jones Hall's UT entrance is 57 m from the nearest
mapped path, so it kept a door **62.1 m** out. Round 1 wrote that 45 m was where
a dashed leg stops being honest. That was a guess about geometry, and geometry
can be looked at:

`shots/walk/door/jon-courtyard-eye.jpg` — standing on the snap node, 1.70 m up,
looking north along exactly the 57 m the dashed leg runs. It is an **open
courtyard between the two wings of Jones Hall**, paved end to end, with the
entrance at the far end. Nothing is in the way.

(An offline segment-versus-footprint test was written first and thrown away. Its
control — a line driven straight through the middle of Jones Hall — also came
back "no crossing", because `data/parts.geojson` holds 23 features, not the
building set; the footprints live in the tiles. A test that cannot fail is not
evidence. The photograph is.)

So the cap is now **58 m**: 57 plus a metre, and 57 is a measured courtyard
rather than a round number. What it buys, on the real page:

```
RLP -> JON   before   832 m, ends at a derived door 62 m from the entrance
             after    703 m, ends at UT's own entrance, last 57 m dashed and counted
```

**129 m shorter AND at the right door** — `jon-route-before.jpg` /
`jon-route-after.jpg`, same pose, both cards readable. Four other buildings gain
an extra UT door in the 45–58 m band (FAC 53 m, NHB 50 m, UTA 47 m, and HLB
below at 42 m); none regressed — every candidate on all 56 buildings is still
inside 15 m of a UT door. The longest dashed leg anywhere in the build is now
Jones Hall's 57 m.

## 3. The Health Learning Building, which used to answer "we cannot take you there"

`doorSet()` opened with `if (!all.length) return all;` — it gave up on a
building with nothing anchored to the network **before** it looked at UT's
survey. HLB is the live case: the code resolves, the register knows the
building, and `data/entrances.geojson` has no door on it at all. UT publishes
its north entrance. The empty case now builds the same virtual target the
matched case does:

```
PCL -> HLB   1.3 km, 16-21 min, arrives at UT's north entrance, 42 m dashed
HLB -> PCL   the same walk back
```

`shots/walk/door/hlb-route-after.jpg`. That is where the 56th building came
from.

## 4. What did NOT work — and the instrument built to find out

The plan for the 228 buildings UT does not cover was to rank their doors better:
prefer an OSM-surveyed door over one the bake's publicness score guessed, and
lower `sideDoorPenaltyM` so a nearer side door wins more often. Both were tested
before being written, and both are wrong.

**The instrument.** `WAYFIND.useUTSurvey` (new, default `true`) turns the whole
UT path off. With it off, the 55 buildings UT surveyed stop being answers and
become a **labelled test set** for the guessing rule that has to carry the other
228: rank our own doors without ever looking at UT, then score the top pick
against UT's coordinate. `data/walk_graph.json` predates the UT stage of the
bake, so no UT door has leaked into the doors being ranked — the hold-out is
clean by construction, not by care.

**Ranking is not the lever.** Eight rules, 55 labelled buildings, top-1 error
against UT's own door:

| rule (never looks at UT) | mean | median | ≤15 m |
|---|---|---|---|
| shipped: `role: main` first | 29.0 m | 29.2 m | 16/55 |
| prefer an OSM-surveyed public door, then role | 27.6 m | 26.2 m | 17/55 |
| prefer OSM anything, then role | 27.6 m | 26.2 m | 17/55 |
| role, then shortest link to the network | 29.0 m | 29.2 m | 16/55 |
| shortest link only | 31.4 m | 30.0 m | 13/55 |
| **oracle — the best door in our own data** | **17.8 m** | **12.4 m** | **29/55** |

Every rule lands between 27.6 and 31.4 m, and the *oracle* — cheating, picking
the best door we hold — is still 17.8 m out. **26 of 55 buildings have no door
of ours within 15 m of UT's at all.** The door is missing, not mislabelled, so
no amount of re-ranking can find it. And the one rule that gained gains by
flipping five buildings: four better (MEZ 40→3 m, NHB 40→2 m, EER 74→18 m,
JGB 46→26 m) and one catastrophically worse (WEL 15→90 m). That is a coin flip
dressed as a heuristic, so it was not shipped.

The same table is the quantified version of Simeon's complaint. Measured from
the building centre, the shipped rule's pick sits a **median 95° away** from the
door UT names, and **12 of 55 are on the literally opposite side** of the
building. "Most routes take you to a farther entrance than you have to go" is,
for the buildings nobody surveyed, still true.

**`sideDoorPenaltyM = 55` was already right, and now it is measured.** Swept
0 → ∞ over 432 real routes into those 55 buildings with UT held out:

```
handicap      0 m   mean door error 28.2 m   within 15 m 34%   mean route 599 m
handicap     20 m   mean door error 28.2 m   within 15 m 34%   mean route 600 m
handicap     35 m   mean door error 28.1 m   within 15 m 32%   mean route 609 m
handicap     55 m   mean door error 27.5 m   within 15 m 32%   mean route 626 m
handicap    120 m   mean door error 28.7 m   within 15 m 30%   mean route 659 m
handicap      inf   mean door error 28.9 m   within 15 m 29%   mean route 674 m
```

Flat on door correctness, monotone on route length — on that evidence alone the
handicap should be as low as it can go. It is not, because of what the hold-out
cannot see: both ends of the HANDOFF #113 pair are UT-surveyed now, so the test
set is blind to the failure the number was built to stop. Re-run with UT off,
that pair has a **cliff between 35 and 55**:

```
        PCL->JES    doors chosen
  H= 0     80 m     secondary/derived -> secondary/derived   (the #113 bug, exactly)
  H=20     80 m     secondary/derived -> secondary/derived
  H=35     80 m     secondary/derived -> secondary/derived
  H=55    156 m     main/derived      -> main/derived        (the doors people use)
  H=120   156 m     main/derived      -> main/derived
```

55 is the smallest value that holds, so it stays, and the comment in
`js/wayfind.js` now carries the sweep and the cliff instead of a feeling.

## 5. What round 2 changed in the code

All inside the entrance-choice functions this lane owns — four sibling lanes are
in this file:

* `WAYFIND.useUTSurvey` — new switch, default `true`. The hold-out instrument.
* `WAYFIND.utVirtualSnapM` 45 → **58**, on the courtyard photograph.
* `WAYFIND.sideDoorPenaltyM` stays **55**, now with the sweep and the #113 cliff
  written next to it.
* `doorSet()` consults UT **before** giving up on a building with no anchored
  door of ours (HLB).
* `utWant()` factored out — which UT doors are on offer once "avoid stairs" has
  had its say, shared by both branches instead of written twice.
* `window.wayfindDoorAt()` also reports `linkM`, so a verify script can measure
  a dashed leg instead of inferring it.

`WAYFIND.on` untouched. `?walk=0` still exposes no `wayfindRoute`,
`wayfindDoors` or `wayfindUTDoors`, draws no pill and logs nothing — re-checked
this round, not carried over.

## 6. Still not done

* **`data/walk_graph.json` is still not rebaked**, so the bake's 47 placed doors
  still reach the router through the runtime table rather than as ordinary
  doors. Unchanged from round 1; the one-command patch is in §"What this does
  NOT do" above.
* **`doorPhrase()` still calls a UT-surveyed door a guess.** Same one-line patch
  as round 1, still for whichever lane owns the copy block.
* **`utVirtual` caches a refusal.** A session that changes `utVirtualSnapM` at
  runtime must reload the page, or a door already refused stays refused. It
  costs nothing at a fixed setting; it cost this round one wrong measurement
  before it was caught.
* **Nothing here helps the 228 buildings UT does not cover**, and §4 is why: it
  is a data problem, not a ranking problem. The honest next move is more
  surveyed doors, not a cleverer guess. Two candidate sources were checked and
  ruled out this round: UT's `Campus_Buildings_view` layer carries a
  `Google_Directions_URL` point for 308 Austin buildings, but it is a centroid —
  median **20.9 m** from the nearest celebrated entrance, only 2 of 66 inside
  5 m — and the per-building pages on `utdirect.utexas.edu` embed that same
  point. Neither is a door.

## Round 2 sources

The same UT ArcGIS layers as round 1, re-queried live 2026-08-23:
`Celebrated_Entrances_view` (98 rows, 67 buildings) and `Campus_Buildings_view`
(430 Austin buildings, checked and rejected as a door source), both public and
unauthenticated on `services9.arcgis.com/w9x0fkENXvuWZY26`. © The University of
Texas at Austin. Campus paths © OpenStreetMap contributors, ODbL.
