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

---

# Round 3, 2026-08-23 — the number is in the repo now, and the Tower turned out to be unreachable

Rounds 1 and 2 drove the door error down and wrote the result in this file. A
harsh read of them finds the same hole twice: **there was no way for anyone else
to check the number.** The pairs and the meter lived in a session scratchpad, so
"96.8 metres over twenty pairs" was a claim, not a measurement anybody could
re-run. That is fixed first — and fixing it is what found the defect below.

|  | round 2 | round 3 |
|---|---|---|
| the harness | in a scratchpad, gone | **`scripts/verify/walkmeter.mjs` + `walk-pairs.json`, in the repo** |
| extra metres over the twenty pairs | 96.8 m (unverifiable) | **96.2 m, reproducible** |
| UT buildings reachable with "avoid stairs" on | not measured | **55/56, was 52/56** |
| the accessibility claim | asserted | **measured — 9/9 buildings clean** |
| why 11 UT buildings do not route | unexplained | **10 are 11 km off this map; 1 is not in UT's own register** |

## 1. The harness, which is the actual deliverable

```
python scripts/serve.py 8711
VERIFY_URL=http://127.0.0.1:8711 node scripts/verify/walkmeter.mjs
```

`scripts/verify/walk-pairs.json` holds the twenty class-to-class walks and says
in the file why each one is there. `walkmeter.mjs` drives the real page, routes
all twenty, and scores **the distance from the door the router picked to the
nearest door UT itself publishes**, at both ends. It runs the A/B itself: the
"baseline" column is the same page with `useUTSurvey`, `utVirtualDoors` and
`widenSideDoors` turned off — the router exactly as it behaved before this work
— so the graph, the data and the browser are identical across the comparison and
the only thing that differs is the rule.

Run on this branch, 2026-08-23:

```
  THE TWENTY PAIRS                        baseline       shipped
    total extra metres, 20 pairs           1333.3 m        96.2 m
    mean extra metres per pair               66.7 m         4.8 m
    worst single pair                       120.4 m        15.7 m
    ends at the right door                     7/40         40/40
    mean route length                       421.0 m       415.9 m

  EVERY BUILDING UT SURVEYED (a pair list can be lucky)
    routable buildings scored                    55            56
    mean WORST-case door error               29.1 m         2.5 m
    every candidate inside 15 m               16/55         56/56
```

Twenty pairs out of twenty improve; none regress. The oracle is read out of the
page (`window.wayfindUTDoors()`) rather than re-fetched or copied into the
harness, so the score is against exactly the rows the router used and the list
cannot go stale in silence.

**The residual 96.2 m is not headroom, and driving it to zero would be a
mistake.** Every remaining end is under 12 m, and each one is one of OUR doors —
real geometry, drawn in the city — standing in for UT's bare coordinate, which
is exactly what `utDoorMatchM = 12` is for. The worst building is BME at 11.9 m.
Lowering that constant would score better and route worse, because the metric
measures distance to UT's point and would therefore reward abandoning a modelled
doorway for a coordinate. Left alone on purpose.

## 2. The defect the harness found: you could not walk to the Tower

Scoring the "avoid stairs" claim meant routing with the toggle on, and **every
route to or from the Main Building came back "we cannot take you there."**

`shots/walk/door/stepfree-mai-before.jpg` — the UT Tower, centre frame, and the
card reads *"No walking route found."* Same pose as `stepfree-mai-after.jpg`.

The cause sits one level below the door choice. UT's west entrance to the Main
Building has no door of ours within 12 m, so round 1's `virtualDoor()` builds a
target at UT's coordinate and snaps it to the nearest node of the walked network
with any usable edge. That node is on the Tower's plinth. The plinth is
perfectly walkable — and every one of its exits is a staircase. Measured on
`data/walk_graph.json`: from that node you can reach **10,790 nodes if you may
climb steps and 37 if you may not.**

So "the nearest usable node" was the wrong test for a walker who cannot use
stairs. `nearestUsableNode()` now takes the mode, and with the toggle on it
requires the node to sit in the **step-free component** of the network — the
graph flooded with `F_STEPS` edges removed. That component is 10,383 of 11,284
nodes (92.0%); the runner-up island is 68 nodes, so "the largest one" is not a
close call that could flip between bakes. The flood runs once, lazily, and never
at all for a walker who never ticks the box.

`WAYFIND.utVirtualStepFree = true` is the switch (CLAUDE.md rule 11). Measured
on the real page by flipping it, inside `walkmeter.mjs` itself:

```
    reachable step-free from a hub         52/56         55/56   (off -> on)
    stranded before: CMA CMB JGB MAI   after: CMB
```

It costs the Tower 3.8 m of extra dashed leg (42.8 m → 46.6 m, well inside the
58 m cap) and gives back three buildings, including the one on the postcard.

`stepfree-mai-after.jpg` is the same walk with the fix in: the dashed stretch
leaves the Tower's west entrance, joins the mapped path, "Avoid stairs" ticked,
*"1–3 min walk · 170 m · No stairs on this route."*

**CMB is left stranded on purpose.** Its own mapped doors all anchor onto a
stairs island, so there is no honest snap to move. Fixing it would mean routing
to a door UT did not survey, or mapping the missing kerb-level connection in
OSM. That is a data gap, and it is named here rather than papered over.

The virtual-door cache key carries the mode (`|sf`). It memoises refusals as
well as hits, so a key that ignored the toggle would hand a step-free walker the
door snapped for a stair-climber — the bug, cached.

## 3. The accessibility claim, measured instead of asserted

Round 1 said `doorSet()` drops UT's non-barrier-free doors when "avoid stairs"
is on. That is a sentence with a truth value, so `walkmeter.mjs` now checks it
on the buildings where UT records **both** kinds of door:

```
    BAT   UT doors 3   candidates 3 -> 2   non-barrier-free among them 1 -> 0   ok
    CCJ   UT doors 2   candidates 2 -> 1   non-barrier-free among them 1 -> 0   ok
    ECJ, EPS, GEA, NHB, PAR, WCH, WWH — the same shape
    9/9 clean; 9 of them would have offered a stepped door with the toggle off
```

Nine, not ten, because SSW is not in this city (§4).

And the toggle moves the walk, not just the candidate list:
`shots/walk/door/stairsdoor-par-off.jpg` and `stairsdoor-par-on.jpg` are Calhoun
Hall to Parlin Hall at one pose, straight down, centred on the midpoint of
Parlin's two UT doors so both are in frame by construction. Off, the walk ends
at Parlin's east entrance, which UT records as **neither** barrier-free nor
auto-opening. On, the door moves **41 m** round to the west entrance, which UT
records as both, and the walk goes 160 m → 197 m.

Read the two frames along the **north face of Parlin**: in the "on" frame a
ribbon runs the length of it that is simply not there in the "off" frame — that
stretch is the detour round to the west door. The cards differ too (*"160 m ·
The main entrance"* against *"200 m · Entrances are on this side"*), and the
chosen door coordinates are in `stairs-manifest.json` next to the pictures.

Being straight about the framing, because three attempts got it wrong and the
reasons are reusable: `fit: true` at the shipped `fitPitch` of 55 puts Parlin and
Sutton between the camera and the route, so the ground line is hidden and the
two frames look identical — a picture that does not show its own subject. And a
hand-set pose stalled the page for minutes, which looked like a zoom problem and
was not: the frame helper was calling `querySourceFeatures('austin-entrances')`
on a 10,000-feature source, which blocks the main thread. Neither of those is
about this round's fix, and both will cost the next lane an hour if they are not
written down.

## 4. Why eleven UT buildings do not route, which was an open question

`walkmeter.mjs` prints them, and they are not a shortfall:

* **Ten are at the J.J. Pickle Research Campus** — BE1, BEG, EME, FS1, FSL, MER,
  PX3, ROC, SV1, TCB, all at latitude 30.38–30.39, about **11 km north** of the
  Forty Acres and outside everything this app draws.
* **One is SSW**, and it is absent from UT's own 198-code Main Campus register
  (`data/ut_buildings.json`, retrieved 2026-08-05) as well as from our data.

So the honest denominator is 57, not 67: **56 of the 57 UT-surveyed buildings
that exist in this city route to UT's own door.**

## 5. Simeon's sidewalk question, answered with a measurement and a no

> *"so many sidewalks are not being utilized properly ... at least make sure
> existing sidewalks are identified properly and used to the advantage."*

The idea worth testing was that **a footway which dead-ends at a building was
built by somebody to reach a door** — which would be a door signal for the 228
buildings UT does not cover, drawn from sidewalks already sitting in the graph.
Tested on the same held-out 55 buildings round 2 built, ranking without ever
looking at UT:

| rule (never looks at UT) | mean | median | ≤15 m |
|---|---|---|---|
| shipped: `role: main` first | 29.0 m | 29.3 m | 16/54 |
| our door nearest a dead-ending footway | 31.2 m | 30.9 m | 17/54 |
| same, including service spurs | 31.0 m | 30.9 m | 16/54 |
| the dead-end node itself, within 45 m | 35.9 m | 30.2 m | 13/54 |
| oracle — the best door in our own data | 17.6 m | 12.4 m | 29/54 |

**It does not work, and the reason is worth writing down: campus sidewalks are a
mesh, not a set of spurs.** 11,284 nodes carry only 610 terminal nodes, 488 of
them pedestrian. A campus path almost always continues to somewhere else, so
"where does the pavement stop" carries nearly no information about where a door
is. Different angle from round 2's experiment, same landing: the door is missing
from our data, not mis-ranked.

What the same numbers *do* say, in the sidewalks' favour: the network itself is
fine. 92.0% of it is one step-free component, and the connectivity work in
`docs/walk/graph.md` had it at 94.26% overall. The sidewalks are identified and
they are being used. It is the doors that are missing.

## 6. What round 3 changed in the code

All inside the entrance-choice functions this lane owns; four sibling lanes are
in `js/wayfind.js`:

* `WAYFIND.utVirtualStepFree` — new, default `true`. §2.
* `stepFreeComp()` — new, memoised flood fill over the graph with `F_STEPS`
  edges removed. Runs on the first avoid-stairs door and never otherwise.
* `nearestUsableNode()` takes the mode; `virtualDoor()` takes it and keys its
  cache on it.
* `window.wayfindUTDoors()` with no argument now returns the building codes as
  well as the row count, so the harness can score every UT building without
  carrying its own copy of the list.

`scripts/bake_entrances.py` and `data/entrances.geojson` are unchanged this
round — round 1's UT stage already placed those doors and nothing here found a
reason to move one. `WAYFIND.on` untouched.

## 7. Still not done

* **`data/walk_graph.json` is still not rebaked**, so the bake's 47 placed doors
  still reach the router through the runtime table rather than as ordinary
  doors. Unchanged from rounds 1–2; the one-command patch is above, and it
  belongs to whoever owns `scripts/bake_walk.py`.
* **`doorPhrase()` still calls a UT-surveyed door a guess** — the same one-line
  patch as round 1, for whichever lane owns the copy block:
  ```js
  if (src === 'ut') return SAY.doorOsmMain;   // "The main entrance"
  ```
* **CMB cannot be reached step-free**, and that is honest rather than fixed (§2).
* **Nothing here helps the 228 buildings UT does not cover.** Three separate
  experiments across rounds 2 and 3 now say the same thing: it is a missing-door
  problem. The next real move is more surveyed doors, not a cleverer rule.

## 8. The shipped data file, checked rather than assumed

Round 1 said the bake placed 47 doors we never had. `data/entrances.geojson` is
this lane's file, so that claim is checkable and was checked: cluster every
feature tagged `src: "ut"` by building and by 6 m linkage — a door in this city
is an assembly of parts (reveal, frame, glass, steps), not one polygon — and
measure each cluster against UT's published coordinate.

```
placed UT door groups: 47 on 35 buildings
distance from the DRAWN door to UT's published coordinate:
  median 1.5 m   mean 3.2 m   p90 11.7 m   max 17.8 m
  within 5 m: 40/47      worst: ECJ 17.8 m, JON 17.1 m, WWH 14.5 m
```

47 on 35 is exactly what round 1 claimed, and the doors sit where UT says.

**The tail is worth naming, because it is a real seam.** The bake runs a placed
door through `snap_to_edge` / `normal_test` / `clear_buried` so it lands ON a
wall rather than floating at a raw coordinate, and for seven doors that moves it
5–18 m along the facade. Meanwhile the ROUTER walks to UT's raw coordinate,
because it reads `data/walk_graph.json` and that file predates the UT stage of
the bake. So on those seven buildings **the door you see drawn and the door the
route ends at are up to 18 m apart.** Neither is wrong — one is on the wall, the
other is UT's survey point — but they are two objects and they will stay two
objects until `data/walk_graph.json` is rebaked (§7). Written down here so the
next lane meets it as a known seam rather than as a mystery.

# Round 4, 2026-08-24 — the checkbox nobody could click, and two rulers made into one

Round 3's own critic pass ended on a defect it could not fix inside its budget:
the routing behind "Avoid stairs" was clean on 9/9 buildings **through the API**,
and the checkbox a person actually clicks did nothing. That is round 4's first
job. The second is that `origin/main` has since merged a *different*
`scripts/verify/walkmeter.mjs` and a *different* `scripts/verify/walk-pairs.json`
from the baseline lane — two instruments with the same filename measuring two
different quantities, which is the worst thing that can happen to a shared
scoreboard. They are one instrument now.

---

## 1. The checkbox — reproduced, understood, fixed, and photographed

**Reproduced first, on the real page, with a real mouse.** Not inferred from the
source. Route WCH → MAI, card expanded, `page.mouse.click()` at the checkbox's
own pixel centre:

```
BEFORE  found=true  checked=false  box at (387.5, 116.9)  "3-5 min walk · 260 m · Stairs: 1 set"
AFTER   the input is GONE from the document (stillThere=false)
        card hidden=true
        headline unchanged — "3-5 min walk · 260 m · Stairs: 1 set"
        the same route through the API with avoidStairs:true — 166.2 m, 0 stair sets
```

So the toggle was hiding a route that is **95 m shorter and has no stairs at
all**, and there was no way for a person to reach it.

**THE MECHANISM.** `#wf-pill` carries a click listener that flips
`state.expanded` and calls `renderPill()`, and `renderPill()` opens with
`el.card.innerHTML = ''`. A checkbox does not fire `change` during its click —
it fires it in the *activation behaviour*, which runs **after** the click has
finished bubbling. So the order on every click was:

1. click on the input bubbles up to the pill,
2. the pill collapses the card and `renderPill()` empties it,
3. the input is now detached from the document, Chrome drops the activation,
4. `change` never fires, `state.avoid` never moves, `run()` is never called.

Every *button* in the card already dodged this by calling `stopPropagation` in
its own handler — the chips, `Show route`, `Clear`. A checkbox cannot be fixed
that way, because by the time its handler would run it is already too late.

**THE FIX is a guard at the source, not a patch at the leaf.** The pill's
expand/collapse gesture now ignores clicks that originate on anything
interactive:

```js
const WF_CONTROL_SEL = 'input, button, select, textarea, label, a';
pill.addEventListener('click', (ev) => {
  const t = ev.target;
  if (t && t.closest && t.closest(WF_CONTROL_SEL)) return;
  state.expanded = !state.expanded; renderPill();
});
```

One place, for every control the card will ever hold, rather than one
`stopPropagation` per control and a new bug the next time someone adds one.

**Measured after, same script, same pixel:**

```
after one click       checked=true   card open=true   "1-3 min walk · 170 m · No stairs on this route"
after clicking back   checked=false  card open=true   "3-5 min walk · 260 m · Stairs: 1 set"
```

**And the thing the fix could plausibly have broken is now asserted too.** A
guard that is too wide would leave the card permanently stuck open, and no
number in this document would notice. So the gate also clicks the pill's *own
text* twice and requires the card to collapse and reopen: `yes`.

Pictures, and the route visibly changes, not just the words —
`shots/walk/door/r3-stairs-off.jpg` and `shots/walk/door/r3-stairs-on.jpg`: the
same pose over the Main Building, box unticked with a long ribbon running the
length of the South Mall front, box ticked with a shorter one curling round the
north side.

**It is in the harness now, so it cannot rot.** `walkmeter.mjs` ends with a live
UI gate that drives the real control with a real mouse and fails the run if the
route does not change. An API-only harness said this feature worked for three
rounds.

---

## 2. Two walkmeters, one instrument

`origin/main` (PR #222, the baseline lane) now ships `walkmeter.mjs` and
`walk-pairs.json` at the same paths this lane had been using. They are not
duplicates — they measure different things:

| | what it asks | what it says on `origin/main` |
|---|---|---|
| **A. route-length extra** (baseline lane) | app route length − the route forced to the ground-truth door | **795.3 m** over the pairs it hurts, **+209.5 m** signed |
| **B. door-offset extra** (this lane) | metres from the door the router picked to the nearest door UT publishes, both ends | **1151.6 m**, **7/38** ends at the right door |

**Both are kept, because each is blind to what the other catches.** A shorter
route to the wrong door scores *well* on A and badly on B, and B is right —
the metres you then walk around the building are real and simply go uncounted.
And A catches what B cannot see: `docs/walk-baseline.md` measured that forcing
every building onto one published door makes nine of nineteen pairs *longer*,
because a building can have two real front doors on different sides. A rule that
wins on B and loses on A has traded one complaint for another.

**Main's pair list is the house pair list**, adopted verbatim — it is on trunk,
it carries a per-pair UT citation, and the other four w-* lanes are told to run
against it. This lane's own 20-pair file was dropped rather than kept alongside.

**The reconciliation is proved, not asserted.** The merged script was pointed at
a clean `origin/main` checkout (extracted with `git archive`, served on the same
port, one server at a time):

```
    total, over pairs it makes worse    795.3 m      <- docs/walk-baseline.md says 795.3 m
    signed total                       +209.5 m      <- that doc says +209.5 m
    worst offender             eer-nhb +298 m        <- that doc says EER→NHB +298.1 m
    self-check drift                    0.00 m on all 20 pairs
```

To the decimal. The merge lost nothing.

**Two things had to be added for the merged script to be honest on this branch.**

- **The self-check now survives a run-time door.** Main's script replays the
  app's chosen doors through its own Dijkstra and fails loud on disagreement —
  but a UT entrance our bake never placed is created in the tab and has no index
  in the served `data/walk_graph.json`, so that check would have had to be
  *skipped for exactly the doors this lane added*. `wayfindDoorAt()` now reports
  `nodes`, `costM` and `virtual`, and the replay uses them. Drift: **0.00 m on
  all 20 pairs**, virtual doors included.
- **A bake hole no longer eats metric B.** BIO's UT-matched graph door (index
  286) carries empty node arrays — it was never snapped to the network, which
  `docs/walk-baseline.md` §2 found and flagged. Metric A is unmeasurable for
  PHR → BIO by construction. Main's script dropped the whole pair and exited 1;
  it now warns, scores metric B anyway (**0.0 m** — this branch walks to UT's own
  coordinate), and does not fail the run for someone else's bake gap.

---

## 3. The A/B had been lying, and its own comment said so

`window.wayfindUTDoors(code)` carried this comment since round 3:

> Deliberately NOT gated on `useUTSurvey`: the held-out pass turns the survey off
> inside the ROUTER and still has to score itself against it, so the oracle must
> survive its own master switch.

It did not. The per-code branch went through `utTruth()`, which returns `null`
the moment `useUTSurvey` is false. So the "doors off" column silently lost the
ground truth it was being scored against, fell back to the pair file's coarser
proxy, and compared **30 ends against 38** while printing them side by side.

The table is now read through an ungated `utIndex()`; the switch stays on the
routing path where it belongs. The A/B below is the first one in this document
where both columns are scored on the same oracle over the same ends.

---

## 4. THE NUMBERS — same page, same graph, same browser, only the rule differs

`--baseline` is not an old checkout: it is this page with `useUTSurvey`,
`utVirtualDoors` and `widenSideDoors` turned off. That configuration reproduces
`origin/main`'s numbers exactly, which is the check that it really is the
"before".

```
                                          doors off       shipped
A. ROUTE-LENGTH EXTRA
   total, over pairs it makes worse        795.3 m        162.1 m
   signed total (credit for the rest)     +209.5 m       -276.7 m
   median per pair                          -0.0 m         -8.4 m

B. DOOR-OFFSET EXTRA  (UT's own coordinates, 38 scoreable ends)
   total over 20 pairs, both ends          1151.6 m         83.7 m
   mean per pair                             57.6 m          4.2 m
   worst single pair                        114.4 m         10.9 m
   ends at the right door                      7/38          38/38

EVERY BUILDING UT SURVEYED (a pair list can be lucky)
   routable buildings scored                     55             56
   mean WORST-case door error                29.1 m          2.5 m
   every candidate inside 15 m                16/55          56/56

"AVOID STAIRS"
   door filter clean                                          9/9
   reachable step-free from a hub             52/56          55/56
   the checkbox a person clicks             broken           works
```

**Nineteen of the twenty pairs improved on metric B; one is unchanged
(CBA → UTC, where UTC was already 10.9 m out and CBA has no UT row at all); none
got worse.** Worst pair falls from 114.4 m to 10.9 m — i.e. the worst walk in the
set now ends within eleven metres of the door UT draws on its own map.

The signed route total going from **+209.5 m to −276.7 m** is the part worth
reading twice: the door fix does not merely stop wasting metres, it now saves
277 m net across the twenty walks *while also* ending at the right door.

---

## 5. Is the remaining 83.7 m reducible? Measured: yes, and it should not be

`utDoorMatchM` decides when one of OUR doors counts as "the same door" as UT's.
Under it the router walks to our real, modelled doorway; over it, it builds a
target at UT's own coordinate and the last leg is drawn dashed. Swept on the
live page, one page load per value (`virtualDoor()` memoises refusals):

```
utDoorMatchM   doorExtra(UT)   atDoor   meanRoute   dashed ends   dashed metres
        0          0.0 m        38/38     446.3 m         38          576 m
        6         31.4 m        38/38     442.5 m         28          530 m
       12  (ship) 83.7 m        38/38     439.5 m         22          465 m
       20        210.4 m        32/38     425.6 m         14          351 m
       40        499.2 m        22/38     421.8 m          3           83 m
```

**Metric B has a degenerate optimum and it is worth naming out loud.** Setting
`utDoorMatchM` to 0 scores a perfect 0.0 m — because the router then never uses
its own geometry at all and every target sits on UT's coordinate by
construction. The cost is that all 38 ends become "not a mapped path" dashed
legs, 111 m more of them, and sixteen real modelled doorways get replaced by
synthetic points 3–11 m away that we would then have to draw nothing at.

Twelve stays, and the reason is the same one round 1 measured: under 12 m our
door **is** UT's door and only the label was wrong; over it, it is a different
doorway on a different wall. The residual 83.7 m is 16 ends standing at a real
door within 10.9 m of UT's survey point. Chasing it to zero would improve the
score and make the product worse — which is precisely the sort of thing a
scoreboard should be made to say about itself, so it is now in `walkmeter.mjs`'s
own header.

---

## 6. The door maps.utexas.edu presents, re-checked against the live layer today

The scoring is only worth anything if the shipped table still equals what UT
publishes. Re-pulled live, 2026-08-24:

```
python scripts/bake_entrances.py --refresh-ut
```

- live `Celebrated_Entrances_view`: **98 rows**, all `Status: Active`, none with a
  null coordinate.
- after dedupe: **97 rows on 67 buildings** — the 98th is UT's own duplicate,
  OBJECTID 154 and 228, byte-identical West entrances for WCH (same coordinate to
  seven decimals, same `BarrierFree`, same `AutoOpener`, same description).
- the fresh pull is **identical, line for line**, to the table in
  `js/wayfind.js` AND to the copy in `scripts/bake_entrances.py`.
- independently matched row by row: **97/97 matched, worst coordinate
  disagreement 0.07 m, zero side/barrier-free/auto-opener disagreements.**
- `Non_ADA_Celebrated_Entrances_view` (12 rows) is a **strict subset**: 8 rows
  are in the main layer at 0.0 m, and the other 4 (FSL W, BAT N, NHB SW, NHB SE)
  have null coordinates in that view but *do* carry coordinates in the main layer
  and are already in our table. Nothing is published there that we lack.

So "the door maps.utexas.edu presents" and "the door this router walks to" are
scored against the same 97 rows, verified current on the day of this round, with
a one-command way to re-check.

---

## 7. What round 4 changed in the code

`js/wayfind.js` — entrance-choice functions and the one control that turns the
entrance choice on. Four sibling lanes are in this file; the diff is small and
deliberately narrow.

- `utIndex()` factored out of `utTruth()`, and `wayfindUTDoors(code)` reads it
  directly, so the oracle finally survives its own master switch (§3).
- `wayfindDoorAt()` also reports `nodes`, `costM` and `virtual`, so an offline
  replay can route to a door that exists only in the tab (§2).
- `utVirtualIdx`, a set of the door indices this file invents at run time, which
  is what `virtual` reads.
- the pill's click listener ignores clicks on controls (§1).

`scripts/verify/walkmeter.mjs` — main's script, kept as the base, with metric B,
the virtual-door replay, the two-oracle reporting, `--baseline`, `--shots` and
the live UI gate folded in.

`scripts/verify/walk-pairs.json` — main's, verbatim. This lane's own pair file
is gone.

`data/entrances.geojson`, `scripts/bake_entrances.py`: unchanged; the table
inside the bake script was re-verified against the live layer (§6) rather than
edited. `WAYFIND.on` untouched — still `false`. `?walk=0` re-checked: no
`wayfindRoute`, no `wayfindUTDoors`, no `wayfindDoorAt`, no `wayfindDoors`, no
`#wf-root`, no pill, no page errors. `harness-drift`: 31 scripts both sides,
PASS.

---

## 8. Still not done

- **`data/walk_graph.json` is still unrebaked.** Everything §5 calls a "dashed
  leg" and everything round 3 §8 calls a "seam" closes the day the lane that owns
  `scripts/bake_walk.py` reruns it against the current `data/entrances.geojson`.
  BIO's unanchored door (§2) closes with it, and metric A becomes measurable on
  all 20 pairs.
- **CMB is still stranded step-free**, on purpose. Every door we hold on it
  anchors onto a stairs island; moving it would mean walking people to a door UT
  did not survey.
- **`doorPhrase()` still calls a UT door a guess.** A door sourced `ut` falls
  through to `SAY.doorDerived`. It is one line and it belongs to whichever lane
  owns the copy, so it is written down rather than taken.
- **The UI gate covers one control on one pair.** It is the control Simeon named
  and the pair that has stairs to avoid; the chips and `Show route` are still only
  covered by the fact that they already call `stopPropagation`.

## Round 4 sources

UT Austin `Celebrated_Entrances_view` and `Non_ADA_Celebrated_Entrances_view`,
public unauthenticated ArcGIS FeatureServer,
`services9.arcgis.com/w9x0fkENXvuWZY26`, re-queried live 2026-08-24. © The
University of Texas at Austin. Baseline numbers from `docs/walk-baseline.md`
(acer/w-baseline, merged to `main` as PR #222) and reproduced here against an
`origin/main` checkout. All measurements on `python scripts/serve.py 8811`,
headless Chrome via `scripts/verify/chrome.mjs`, `?drift=0`,
`cancelGraphicsAutoDetect()` called, veil waited out. Re-run:

```
python scripts/serve.py 8811
cd scripts/verify && VERIFY_URL=http://127.0.0.1:8811 node walkmeter.mjs --baseline
```

---

# Round 5, 2026-08-24 — the one building "Avoid stairs" still refused

Round 4's critic passed the round (`oursWins = true`) and then named one
concrete thing wrong with it, so this round is that one thing.

> Ticking "Avoid stairs" for a route to CMB (Jesse H. Jones Communication
> Center - B) returns `{ok:false, why:"noroute"}` from three different hubs, and
> the live UI shows the user "No walking route found" for a route that works
> fine with the box unchecked.

It was right, and it was worse than "one awkward building": it was a hole in the
rule round 3 wrote, sitting in plain sight in the code comment that shipped
alongside it.

## 1. What was actually broken

Round 3 taught the *snap* about the step-free component. `utVirtualStepFree`
made sure that when the router **invents** a target at UT's published
coordinate, the node it hangs that target on is one the walker can leave without
climbing anything. It fixed CMA, JGB and MAI, and the comment next to it said,
in as many words, that CMB was a data gap it had decided to leave alone.

That was the wrong reading. The rule was never about snapping — it is about
whether a walker can *arrive*. And the doors the router had **not** invented —
our own baked ones, straight out of `data/entrances.geojson` — were never asked
the same question at all.

The trace, node by node, off the served `data/walk_graph.json`:

| CMB door | role | metres from UT's east entrance | anchor nodes | in the step-free component |
|---|---|---|---|---|
| #321 | secondary | 45.9 | 11042, 457, 8268 | **yes** (11042, 8268) |
| #322 | main | 29.2 | 457, 439, 8273 | **yes** (8273) |
| #323 | secondary | 5.4 | 452, 11040, 441 | no — all on component #20 |
| #324 | secondary | **3.1** | 452, 11040 | no — all on component #20 |

Component #20 is sixteen nodes in the CMA/CMB courtyard, and every edge leaving
it is tagged `highway=steps` in OpenStreetMap. UT publishes CMB's entrance at
`30.289279, -97.741010`; our door #324 is 3.1 m from it, comfortably inside
`utDoorMatchM` (12 m). So the UT match fired, `doorSet()` returned exactly one
candidate, that candidate was unreachable **by construction** the moment
`avoidStairs` was on, and Dijkstra said `noroute`. Every time, from every hub.

The building was not hard to reach. The *only door we offered* was.

## 2. The rule

One function, `stepFreeDoor(g, di)`, and one line in `doorSet()`:

> With "avoid stairs" on, a door is a candidate only if one of its anchor nodes
> is in the step-free component.

It is subtraction, and subtraction that cannot cost a route: a node outside that
component is a node Dijkstra could never have reached with the toggle on, so
dropping it removes refusals and nothing else. Everything downstream — the UT
match, the virtual-door snap, the `main`/everything fallbacks — then runs on the
filtered list. For CMB that means the 3.1 m door is no longer a match, the
nearest *reachable* door is 29.2 m away (past `utDoorMatchM`), and the building
falls through to exactly the machinery round 3 already built and defended: a
target at UT's own published coordinate, snapped 41.2 m to the nearest step-free
node, with the last stretch drawn dashed and the card saying so in words.

Switch: `WAYFIND.stepFreeDoors` (default `true`).

## 3. The thing that was tried here and rejected

The obvious alternative was to take CMB's own door #322 — a real, mapped, main
entrance, 29.2 m round the building, anchored to pavement — instead of letting a
41 m dashed leg run into the courtyard the steps are in. It was implemented,
capped with a named `stepFreeDoorDetourM` at 35 m, and measured on the live page
against every building with a mapped door. It recovered CMB, and it also did
this:

| building | door offset from UT's own point, "avoid stairs" on |
|---|---|
| BEN | 0 → 25.7 m |
| BUR | 0 → 22.0 m |
| CAL | 0 → 15.6 m |
| DMC | 0 → 30.0 m |
| ECJ | 0 → 33.7 m |
| EER | 0 → 18.5 m |
| GEA | 0 → 25.6 m |
| GOL | 0 → 20.3 m |
| GWB | 0 → 23.6 m |
| HRH | 0 → 25.4 m |
| PAI | 0 → 20.0 m |
| PAT | 0 → 16.9 m |
| PCL | 0 → 12.4 m |
| SZB | 0 → 15.1 m |
| UA9 | 0 → 24.1 m |
| UTA | 0 → 33.8 m |
| WEL | 0 → 27.8 m |
| WWH | 14.5 → 25.0 m |

Eighteen buildings pushed off UT's exact coordinate, plus GAR, PHR and RLP whose
candidate changed without moving. That is this lane's own founding complaint —
*"many routes take you to a farther entrance than you have to go"* —
reintroduced inside the step-free mode, to fix one building. The branch was
reverted before it was committed and the reasoning is kept in the comment where
the next person will trip over the same idea.

The virtual door is also the better **answer**, not merely the cheaper diff. UT's
survey records CMB East as `BarrierFree` **with an auto-opener** — that is UT
asserting a step-free approach exists that OSM has not drawn. Our door #322 is
one UT never surveyed either way. Given a choice between the entrance UT
certified for wheelchair use, with the unmapped stretch drawn dashed and
labelled *"The last stretch isn't a mapped path"*, and one nobody surveyed that
we happen to have pavement to — send them to the certified one and be honest
about the gap.

## 4. The numbers

Same page, same graph, same browser, one pose, `WAYFIND.stepFreeDoors` the only
difference. 158 buildings with a mapped door, routed from GDC, PCL and UTC.

|  | rule off | rule on |
|---|---|---|
| step-free dead ends, all 158 buildings | 3 (CMB, LTH, TS2) | **2 (LTH, TS2)** |
| GDC → CMB, "avoid stairs" | `noroute` | **866 m, 0 stair sets** |
| CMB's endpoint vs UT's published door | — | **0.0 m** |
| stairs-**allowed** routes that moved | — | **0 of 158** |

`scripts/verify/walkmeter.mjs`, the house ruler, on the same server:

|  | round 4 | round 5 |
|---|---|---|
| route-length extra, pairs it hurts | 162.1 m | 162.1 m |
| route-length extra, signed | −276.7 m | −276.7 m |
| door offset from UT's own door, 20 pairs | 83.7 m | 83.7 m |
| ends at the right door | 38/38 | 38/38 |
| every UT building: worst-case door err | 2.5 m | 2.5 m |
| UT buildings scored at all | 55 | **56** |
| reachable step-free from a hub | 55/56 | **56/56** |
| **stranded** | **CMB** | **none** |
| live UI gate (real mouse on the checkbox) | PASS | PASS |

Metrics A and B are measured with stairs **allowed** (`walkmeter.mjs` routes
every pair with `{}`), which is why they are bit-identical: this round cannot
reach them. That is the point of it. The one number that moves is the one the
critic pointed at.

`walkmeter.mjs --baseline` also still reprints the baseline lane's `origin/main`
headline (795.3 m / +209.5 m) to the decimal, and self-check drift is 0.00 m on
all 20 pairs.

## 5. Two claims this round MADE and then had to withdraw

Written down because both were caught by running the thing, and neither by
reading it.

**"It rescues AHG and NUR too."** An offline read of the bake said both have
their `main` door on a stairs island and a real secondary door that is not, so
both must have been dead ends. Driving the live app said no: both already
routed, both modes, from all three hubs. `legBetween()`'s wide pass had been
quietly covering them, because `widenSideDoors` reopens every routable door on a
building UT does not cover. What actually changed for AHG and NUR is smaller and
honest: the candidate list is now the door you can reach rather than the one you
cannot, and the unmapped last stretch halves (9.9 → 4.5 m, 8.8 → 4.1 m). The
route a user gets is the route they always got.

**The first "before" photograph was the loading screen.** The DOM readback was
already correct — the card really did say "790 m · Stairs: 1 set" — while the
map underneath was still *0 of 4 layers ready*, so the frame shows the veil.
Every map frame in this round now waits the veil out and reports how many
features each `wayfind-*` layer actually painted, so "the route is on screen" is
asserted rather than eyeballed: 83 ribbon features in the after frame, 0 in the
before, at a pose read back after the shutter.

## 6. The pictures

The card, GDC → CMB, one real mouse click at the checkbox's own pixel centre:

- `shots/walk/door/cmb-card-off.jpg` — "9-13 min walk · 790 m · Stairs: 1 set",
  box unticked.
- `shots/walk/door/cmb-card-on.jpg` — after the click: "10-15 min walk · 870 m ·
  No stairs on this route", box ticked, and the card volunteers *"The last
  stretch isn't a mapped path"* for the 41 m dashed leg.

The map, one camera pose (30.28779, −97.73850, z 16.55, pitch 12, bearing 0),
held and read back, `stepFreeDoors` the only difference:

- `shots/walk/door/cmb-whole-before.jpg` — "No walking route found". Nothing
  drawn; all four `wayfind-*` layers paint 0 features.
- `shots/walk/door/cmb-whole-after.jpg` — the walk drawn up Speedway to CMB;
  83 ribbon, 6 ghost, 4 thread, 1 column feature on screen.

(The brown hatched strip up the middle is in **both** frames — it is the
Speedway mall, and its presence in both is what proves the two frames are the
same scene.)

## 7. What round 5 changed in the code

`js/wayfind.js`, entrance-choice functions only, and nothing else in the repo:

- **new** `stepFreeDoor(g, di)` — is any of this door's anchor nodes in the
  step-free component. Reuses `stepFreeComp()`'s existing lazy flood; no new
  traversal, and it still never runs for a walker who never ticks the box.
- **`doorSet()`** now derives `pool` from `all` through that test when
  `avoidStairs && WAYFIND.stepFreeDoors`, and every branch below reads `pool`.
  The "nothing anchored" branch falls back to `all` when the building has no
  step-free door at all, so LTH and TS2 keep answering with the doors that exist
  and the route keeps failing — which is the honest answer when we have no
  evidence of a step-free way in.
- **new switch** `WAYFIND.stepFreeDoors` (default `true`), with the measured
  before/after in its comment.
- **corrected** the `stepFreeComp()` header, which claimed CMB was a data gap
  nothing could be done about. It was a hole in this file.

`data/entrances.geojson` and `scripts/bake_entrances.py` unchanged — read, not
edited. `WAYFIND.on` still `false`. `?walk=0` still draws no pill, no sheet, no
`wayfind-*` layer, exposes no `wayfindRoute`/`wayfindDoors`/`wayfindUTDoors`,
and logs no error. `harness-drift`: 31 scripts both sides, PASS.

## 8. Still not done

- **LTH and TS2 have no step-free door in the bake at all** — not one anchor in
  the step-free component between them. They are honest dead ends today and the
  card says so, but they are the next thing to look at, and the answer is
  probably upstream in the walk bake rather than here.
- **`walkmeter.mjs` does not print `stepFreeDoors` in its `flags` line.** That
  file is not this round's to write. The switch is readable at
  `window.WAYFIND.stepFreeDoors`, and the metric it moves is the
  `stranded before/after` line, which walkmeter already reports. A request for
  whoever owns the ruler next: add it to the flag dump.
- Everything in round 4 §8 that was not CMB still stands — the unrebaked
  `data/walk_graph.json`, BIO's unanchored door, `doorPhrase()` calling a UT
  door a guess, and a UI gate that covers one control on one pair.

## Round 5 sources

UT Austin `Celebrated_Entrances_view`, public unauthenticated ArcGIS
FeatureServer, `services9.arcgis.com/w9x0fkENXvuWZY26`; the copy shipped in
`js/wayfind.js` was re-verified against the live layer in round 4 §6 and is
unchanged since. © The University of Texas at Austin. Step-free components read
off the served `data/walk_graph.json` with the same flood `stepFreeComp()` uses.
All measurements on `python scripts/serve.py 8811`, headless Chrome via
`scripts/verify/chrome.mjs`, `?drift=0`, `cancelGraphicsAutoDetect()` called,
veil waited out, one browser. Re-run:

```
python scripts/serve.py 8811
cd scripts/verify && VERIFY_URL=http://127.0.0.1:8811 node walkmeter.mjs --baseline
```
