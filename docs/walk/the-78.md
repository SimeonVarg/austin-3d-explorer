# The 78 — every unroutable UT building, classified by actual cause

Acer lane, 2026-08-16. **No browser, no server, no bake was run.** Nothing in
the repo was written except this file; every number below came out of
throwaway scripts in the session scratchpad, run against the files on disk on
this date. The chrome/node process check at the top of the pass read
**20 chrome, 1 node, 2 python** — the machine is not quiet, which is exactly
why this pass touched no browser.

Confidence marks are the house convention:
**[M]** measured here, **[D]** derived from an [M] by an argument written out,
**[A]** an authoring judgement I am making so the list has an order.

This document answers one question the skeptic asked in HANDOFF §116:
*78 of 198 UT buildings still can't be routed to at all — why each one, and
what would it honestly take?*

It does **not** place a single door. `docs/walk/what-we-can-honestly-say.md`
outranks this file everywhere, and the rule that outranks coverage is the one
in `docs/walk/graph.md`: *a route through a wall to gain a connection is a
lie.* Manufacturing a door on a building whose location this repo does not
know would be a bigger lie, because the student would believe it.

---

## 0. The one-line answer

**Class C is empty. Not one of the 78 has a door that merely failed to reach
the graph** — the cheap fix everyone hoped for was already spent by the road
access legs in `graph.md` §11b. **62 of the 78 have no polygon to put a door
on at all. The other 16 have a perfectly good polygon, sitting metres from a
mapped footway, and were skipped by a hand-drawn rectangle.** The single
largest cause of the whole gap is one constant: `CAMPUS` in
`scripts/bake_entrances.py:118`.

---

## 1. The exact list, and how it was produced

"Routable" is copied from the bake that decides it: a register code is
routable if any door filed under it carries at least one graph anchor
(`bake_walk.py`, `d[i][2]` non-empty in the shipped `data/walk_graph.json`).
Run against the shipped wire file:

```
198 UT register codes in data/ut_buildings.json
120 routable
 78 NOT routable          <- this document
```
**[M]** — same 78 the bake prints in its health block on every run.

Then, for each of the 78, four questions in order:

1. Does `data/entrances.geojson` hold any door under that ref? — **zero, for
   all 78.** [M]
2. Does the snapshot the *entrance* bake reads
   (`data/snapshots/2026-08-04/buildings.enriched.geojson`, 2,453 footprints,
   378 of them named) hold a polygon that is this building's and nobody
   else's? [M]
3. If yes, which of `bake_entrances.py`'s own scope gates rejected it? [M]
4. If yes, what evidence would the derivation have had — a footway
   dead-ending within `TERM_R` = 8 m of a wall (stage 2), or walkable line
   within `APPROACH_R` = 22 m of a wall (stage 3)? Measured by walking each
   perimeter at 2 m and counting samples. [M]

**A note on the snapshots, because it is a live inconsistency.** The entrance
bake reads `2026-08-04`; the walk bake reads `2026-08-05`; `main` gained a
`2026-08-16` snapshot last night. The three carry **identical name coverage —
378 named footprints, zero gained, zero lost** [M], so no conclusion here
moves if a bake is repointed. But two bakes reading two different days of the
same data is a papercut somebody should close.

---

## 2. The tally

| class | meaning | count |
|---|---|---|
| **A** | **No footprint.** Nothing in the snapshot is this building. A door cannot be placed because there is nowhere to place it. | **62** |
| **B** | **Footprint but no door.** A good polygon exists and the entrance derivation was never allowed to run on it. | **16** |
| **C** | **Door but not on the graph.** | **0** |
| **D** | **Out of scope.** Not a separate bucket — an overlay on A and B. §6. | — |

**Class C being empty is the finding that changes the plan.** The brief
guessed it "may be most of them"; it is none of them. `graph.md` §11b already
spent that fix — BIO and TSG were the last two doors stranded off the network,
and the road access legs recovered both. Every remaining door in the file is
attached. There is no cheap class left; the gap is upstream, in
`data/entrances.geojson`, and beyond that in the footprints themselves.

---

## 3. Class B — 16 buildings, a polygon each, and the gate that rejected it

These are the fixable ones. `area` is m² computed from the ring, `h` is the
snapshot's `final_height`. **stage 2** counts perimeter samples with a footway
dead-end within 8 m; **stage 3** counts samples with walkable line within
22 m. All figures **[M]**.

| code | building | polygon | area | h | the gate that rejected it | stage 2 | stage 3 | nearest line |
|---|---|---|---|---|---|---|---|---|
| `NUR` | Nursing School | Nursing School | 2,947 | 24.5 | **outside `CAMPUS` — 189 m south** | 2/110 | 99/110 | 4.5 m |
| `UTA` | UT Administration Bldg | UT Administration Building | 2,827 | 38.7 | **outside `CAMPUS` — 13 m south, 84 m west** | 5/108 | 86/108 | 2.5 m |
| `HTB` | Health Transformation Bldg | Health Transformation Building | 5,327 | 46.1 | **outside `CAMPUS` — 257 m south** | 26/174 | 139/174 | 0.0 m |
| `HDB` | Health Discovery Bldg | Health Discovery Building | 5,341 | 44.8 | **outside `CAMPUS` — 176 m south** | 21/150 | 139/150 | 2.2 m |
| `JHH` | John W. Hargis Hall | John W. Hargis Hall | 956 | 18.5 | **outside `CAMPUS` — 122 m south** | 9/78 | 78/78 | 0.0 m |
| `ANB` | Arno Nowotny Bldg | Arno Nowotny Building | 377 | 6.7 | **outside `CAMPUS` — 141 m south** | 14/43 | 43/43 | 0.0 m |
| `CDL` | Collections Deposit Library | Collections Deposit Library | 1,187 | 13.0 | **outside `CAMPUS` — 79 m south** | 0/68 | 42/68 | 12.9 m |
| `TRG` | Trinity Garage | Trinity Garage | 5,570 | 10.6 | **outside `CAMPUS` — 47 m south** | 0/160 | 95/160 | 3.3 m |
| `HCG` | Health Center Garage | Health Center Garage | 2,884 | 25.3 | **outside `CAMPUS` — 326 m south** | 26/109 | 89/109 | 1.9 m |
| `SAG` | San Antonio Garage | San Antonio Garage | 4,445 | 23.0 | **outside `CAMPUS` — 56 m west** | 6/135 | 135/135 | 2.4 m |
| `GUG` | Guadalupe Garage | Guadalupe Garage | 2,990 | 20.2 | **outside `CAMPUS` — 124 m west** | 2/115 | 93/115 | 0.8 m |
| `WMB` | West Mall Office Bldg | West Mall Office Building | 845 | 22.2 | **E1 places veto** (11 shopfront slots, `building_class: office`) | 3/58 | 45/58 | 3.3 m |
| `LCH` | Littlefield Carriage House | Littlefield Carriage House | 160 | 10.8 | `area 160 < MIN_AREA 250` | 5/24 | 24/24 | 4.7 m |
| `FDH` | J. Frank Dobie House | J. Frank Dobie House | 161 | 9.4 | `area 161 < MIN_AREA 250` | 0/26 | 26/26 | 6.2 m |
| `FC7` | Facilities Complex Bldg 7 | Facilities Complex Building 7 | 206 | 3.1 | `area < 250` **and** `height 3.1 < MIN_H 4` | 0/32 | 27/32 | 7.9 m |
| `WAT` | Arthur P. Watson House | Arthur P. Watson House | 104 | 9.4 | outside `CAMPUS`; `area 104 < 250` | 0/21 | **0/21** | **23.6 m** |

### 3a. The rectangle, which is the story

```python
# scripts/bake_entrances.py:118
CAMPUS = (30.2795, -97.7420, 30.2930, -97.7255)   # s, w, n, e   [M]
# "The rect bounded by Guadalupe, I-35, MLK and the Dean Keeton blocks."
```

Eleven of the sixteen fail on that one line, and nothing else. It is not a
data problem and it is not a mapping problem — the polygons are large, named,
tall and correctly placed, and OSM has drawn footways that **physically
dead-end into their walls**: 26 such samples on the Health Transformation
Building, 26 on the Health Center Garage, 21 on Health Discovery, 14 on
Nowotny, 9 on Hargis. That is stage-2 evidence, the strong kind — *a path that
runs into a wall runs into a door.*

Two details worth saying out loud:

* **`UTA` misses the rectangle by 13 metres of latitude.** The UT
  Administration Building — where a freshman goes for the registrar and
  financial aid — is unroutable because its centroid sits 13 m south of a
  number somebody typed. [M]
* **The rectangle's south edge is MLK, so it excludes the entire Dell Med
  block by design** (`HDB`, `HTB`, `HCG`, and `HLB`/`SMC` which are class A
  for a different reason). That was a correct call when the file was about
  drawing doorways on the historic core. It is the wrong call now that the
  same file is the routing feature's door source.

### 3b. `WMB` — the Cambridge self-block, exactly as the brief predicted

`West Mall Office Building` clears every size gate, sits inside the rectangle,
and has a footway dead-ending 3.3 m from its wall. It got zero doors because
of `bake_entrances.py:4183`:

```python
if b.bid in place_hosts and b.cls in PLACES_EXCLUDE_CLASSES and not b.wc:
```

It hosts **11 shopfront slots** from `data/places.geojson` (the campus post
office and copy shop are in its ground floor) and its `building_class` is
`office`, which is in `PLACES_EXCLUDE_CLASSES`. The bake reasoned "the
shopfronts already draw its doors, a second entrance on top is a
double-draw" — correct for *drawing*, wrong for *routing*, because the walk
bake only reads `entrances.geojson` and never sees the shopfront doors. [M]

This is the one class-B case where a door already exists in the repo, in
another file, measured. It is the cleanest honest fix on the page.

### 3c. `WAT` is the one that cannot be done honestly

Arthur P. Watson House: 104 m², and **not one of its 21 perimeter samples has
walkable line within 22 m** — nearest anything is 23.6 m. Stage 2 sees
nothing, stage 3 sees nothing. There is no mapped approach to this building.
Widening the rectangle would place a door on it anyway, from a publicness
field scoring zero evidence, and that is precisely the invented door this
whole document exists to refuse. **`WAT` stays unroutable and says so.** [D]

---

## 4. Class A — 62 buildings with nothing to place a door on

Broken down by *why* there is no polygon, because the remedies differ:

### 4a. Two register codes, one polygon — 10 codes [M]

The map draws one building where UT's register lists several. The polygon is
already owned by a code that routes today, so these cannot be separated
without inventing a boundary.

```
FC1 FC2 FC3 FC4 FC5 FC6 FC8   one 'Facilities Complex Building 7' polygon; FC7 owns it
FDG  J. Frank Dobie Garage    the only Dobie polygon is the House; FDH owns it
AF1  Athletic Fields Pavilion (Rehab)   two pavilions are mapped and they carry
                                        AFP and AF2; there is no third polygon
LAC  Lake Austin Centre       matched the polygon OSM names 'Austin' — which is
                              BMK's (the Blanton's Ellsworth Kelly building,
                              already routable). A FALSE match, caught by hand.
```

`LAC` is the reason this document does not trust name matching alone. A
0.5-Jaccard hit on the token "austin" would have put the Lake Austin Centre —
a building on Lake Austin Boulevard, well outside the network bbox — on top of
the Blanton. `graph.md` §5 called this failure mode when it rejected the
AF1/AF2 automatic join, and it was right.

### 4b. Real OSM geometry exists in this repo, just not in the footprint snapshot — 2 codes [M]

**This is the recoverable half of class A, and both are buildings people go
to.**

```
HLB  Health Learning Building        data/osm_cache/capitol_area.json
                                     way 516285436, ref=HLB, building=hospital,
                                     13 geometry points, building:levels=7
                                     @ 30.27570, -97.73363
                                     nearest snapshot polygon: 179 m away
SMC  Dell Seton Medical Center       data/osm_cache/capitol_area.json
                                     way 516285446, ref=DSMC, building=hospital,
                                     30 geometry points
                                     @ 30.27720, -97.73401
                                     nearest snapshot polygon: 13.7 m, and it is
                                     a 114 m2 blob, not the hospital
```

Note `SMC` also carries a **ref mismatch**: UT's register says `SMC`, OSM says
`DSMC`. That is a one-line `CODE_REF_JOINS` row of exactly the kind
`graph.md` §11a already ships seven of — but it buys nothing until the polygon
exists, because there is no door either way.

The Overture-derived snapshot simply does not cover the Dell Med block
completely: `HDB` and `HTB` are in it, `HLB` and `SMC` are not.

### 4c. Mapped as a surface or an area, not as a building — 4 codes [M]

```
DFF  UFCU Disch-Falk Field     surfaces.json / sport.json, way, leisure=pitch
MMS  Mike A. Myers Stadium     sport.json, way, leisure=stadium
TTC  Texas Tennis Center       data/ground.geojson, a ground-cover polygon
FTC/FTG Football Training Complex   only a props.geojson label, no polygon
```

A pitch is a playing surface. Putting a door on the edge of a baseball diamond
would be a door on a fence.

### 4d. Nothing anywhere in the repo — 45 codes [M]

Searched every `data/osm_cache/*.json`, every `data/*.geojson`, and the
2026-08-05/08-15/08-16 snapshots, by `ref` tag and by name-token overlap.
These returned no hit at any threshold:

```
ACS BOT BSB CCG CDA CML CPC DEV E11 E13 E15 E26 E27 FC9
GHA GHB GHC GHD GHE GHF GSM GRC GRF GRP GRS
HS4 IC2 ICB IMA IMB KEY LNA LS1 MSB NUG PRH RHG SBS SSC
TLB TSB TSP UIL WGB Z02
```

`ACS` is the painful one and it is discussed in §5.

---

## 5. Ranked: the twenty a freshman is most likely to need

**This ranking is [A], not [M].** The repo holds no room inventory, no course
schedule and no building-use field — `data/ut_buildings.json` carries `ref`,
`name`, `number` and `occupied` and nothing else. So this is judgement from
names and years, written down so somebody can argue with it. A flat list of 78
is useless; this is the list that decides where the work goes.

| # | code | building | year | class | recoverable? |
|---|---|---|---|---|---|
| 1 | `NUR` | Nursing School | 1973 | B — rect | **yes** |
| 2 | `UTA` | UT Administration Building | 2007 | B — rect (by 13 m) | **yes** |
| 3 | `WMB` | West Mall Office Bldg | 1962 | B — E1 veto | **yes, cheapest** |
| 4 | `ACS` | Autry C. Stephens Engr Discovery Bldg | **2026** | A — nothing anywhere | **no** |
| 5 | `HDB` | Health Discovery Building | 2016 | B — rect | **yes** |
| 6 | `HTB` | Health Transformation Building | 2016 | B — rect | **yes** |
| 7 | `HLB` | Health Learning Building | 2016 | A — OSM way exists | **yes, with work** |
| 8 | `CDL` | Collections Deposit Library | 1968 | B — rect | **yes** |
| 9 | `JHH` | John W. Hargis Hall | 1888 | B — rect | **yes** |
| 10 | `ANB` | Arno Nowotny Building | 1859 | B — rect | **yes** |
| 11 | `SMC` | Dell Seton Medical Center | 2017 | A — OSM way exists | **yes, with work** |
| 12 | `LCH` | Littlefield Carriage House | 1894 | B — area gate | **yes** |
| 13 | `FDH` | J. Frank Dobie House | 1995 | B — area gate | **yes** |
| 14 | `SAG` | San Antonio Garage | 1994 | B — rect | **yes** |
| 15 | `TRG` | Trinity Garage | 2002 | B — rect | **yes** |
| 16 | `GUG` | Guadalupe Garage | 2006 | B — rect | **yes** |
| 17 | `HCG` | Health Center Garage | 2016 | B — rect | **yes** |
| 18 | `NUG` | Nueces Garage | 2019 | A — nothing | no |
| 19 | `CCG` | Conference Center Garage | 2008 | A — nothing | no |
| 20 | `RHG` | Rowling Hall Garage | 2017 | A — nothing | no |

**Sixteen of the twenty are recoverable.** Thirteen of them are one constant.

### `ACS` deserves its own paragraph

The Autry C. Stephens Engineering Discovery Building's register year is
**2026** — it is opening now, this semester, and it is a teaching building for
exactly the students this feature is for. There is **no polygon, no label, no
reference to it anywhere in this repository** [M]. Every snapshot on disk
predates it or does not carry it.

There is no honest bake-side fix. The only route is to digitise a footprint
from an external source, which is authoring a *building*, not a door, and
belongs in its own pass with its own accuracy check. Until then the honest
answer is the one the client already gives: **`ACS is not walkable in this
build yet`** — and that sentence is exactly right here, because the campus
changed and we have not.

---

## 6. Class D — the ones it is more honest to exclude than to serve

Not everything on UT's register is a place a student goes. Naming these
plainly is a better answer than manufacturing coverage for them, and it makes
the coverage number mean something.

```
 9  Facilities Complex sheds        FC1-FC9 (one 206 m2, 3.1 m polygon between them)
 5  equipment storehouses           E11 E13 E15 E26 E27
 7  graduate housing + maintenance  GHA GHB GHC GHD GHE GHF GSM
 4  Gregory aquatic plant           GRC GRF GRP GRS
 3  intramural plant                ICB IMA IMB
 3  child development centres       CDA CML LNA
11  athletics venues and support    AF1 BSB DFF FTC FTG MMS SBS TLB TSB TSP TTC
12  misc plant, offices, leased     BOT CPC DEV HS4 IC2 KEY LS1 MSB SSC UIL WGB Z02
 2  genuinely elsewhere             PRH (Dobie Paisano Ranch, Hill Country)
                                    LAC (Lake Austin Centre, outside the bbox)
--
56  total
```
**[A] on the grouping, [M] on the counts.**

**56 of the 78 are buildings no undergraduate has a class in.** That leaves
**22** that a student might plausibly walk to — and it reframes the headline
completely: the feature is not missing 78 buildings a student needs, it is
missing about **twenty**, and **sixteen of those twenty are recoverable**.

The 22 are: `ACS ANB CCG CDL FDG FDH GUG HCG HDB HLB HTB JHH LCH NUG NUR RHG
SAG SMC TRG UTA WAT WMB` — §5 ranks the twenty of them that matter most; the
two left over are `FDG` (the Dobie garage, whose polygon is the House's) and
`WAT` (§3c, no mapped approach).

---

## 7. What each fix costs, and the one that must not be taken

### Fix 1 — widen `CAMPUS`. Recovers 11 of the 16. [D]

One constant in `scripts/bake_entrances.py`. **It is honest**: it does not
invent anything, it runs the existing, measured derivation over buildings it
was previously told to skip, and every door it produces is `src: derived` and
gets `Entrances are on this side` — never `The main entrance` — under
`what-we-can-honestly-say.md` §7.

**But the cost is real and must be quoted before anyone does it.** Widening
the rect south to 30.2755 and west to -97.7440 takes the entrance bake's
in-scope building count from **292 to 435 — plus 143 buildings** [M]. That is
49 % more doorway geometry in the scene, on buildings whose doorways nobody
has ever looked at, and this repo's own history says the way that bill comes
due is in frame time and in a visual regression nobody photographed. So:

* it needs the standard blind A/B at the usual poses before it merges;
* it needs a frame-cost measurement, and the perf lane's K1 is already the
  biggest unpaid bill in the queue;
* and the derivation's **78 % recall was measured inside the old rectangle**
  (`docs/entrances/placement.md`). Outside it, recall is **unmeasured**. That
  does not make the doors dishonest — the wording already carries the
  uncertainty — but the doc must not repeat "78 %" over the new area.

An alternative worth considering, and cheaper: **keep `CAMPUS` for drawing and
add a second, wider rect that only produces routing anchors.** The visual bill
goes to zero and the routing coverage is the same. That is a schema question
for whoever owns `bake_entrances.py`, recorded here per CLAUDE.md rule 1
rather than made.

### Fix 2 — let a shopfront host keep its own door. Recovers `WMB`. [D]

The E1 veto is right for drawing and wrong for routing. Either exempt
university-owned hosts from it, or — better, and it invents nothing at all —
let `bake_walk.py` read `data/places.geojson`'s shopfront entries as routing
anchors when the building has no entrance of its own. Those positions are
measured, not derived. `WMB` has 11 of them.

### Fix 3 — lower `MIN_AREA` for named buildings. Recovers `LCH`, `FDH`, `FC7`. [D]

160 m² is a small building, not a shed. A named, 10 m tall, 1894 carriage
house is a place; the gate exists to keep doors off pump housings. Gating on
`MIN_AREA` **or** a name would take all three, and `FC7` is honestly class D
anyway.

### Fix 4 — import `HLB` and `SMC` footprints from `capitol_area.json`. [D]

The geometry is real OSM, already in this repo, already ODbL-clean and already
attributed. It is not a hand-drawn shape. This is the only honest way into
class A, it needs a `CODE_REF_JOINS` row for `SMC` ← `DSMC`, and it needs
Fix 1 first or the widened derivation will skip them too.

### The fix that must not be taken

**Do not synthesize a point on a footprint outline and call it an arrival.**
`graph.md` §11e already considered and rejected this, and it is still right:
the client words every arrival as a door claim, so a synthesized point puts
*"Entrances are on this side"* on a side nobody has looked at. And do not
place a door on `WAT`, which has no mapped approach within 22 m — a
publicness field scoring zero is a coin flip wearing a measurement's clothes.

---

## 8. Recommendation, and the honest ceiling

```
today                                              120 / 198   (60.6 %)
+ widen CAMPUS (11)                                131 / 198
+ WMB via its own shopfronts (1)                   132 / 198
+ MIN_AREA relaxed for named buildings (3)         135 / 198
+ HLB and SMC footprints from capitol_area.json    137 / 198   (69.2 %)
```
**[D], from the [M] classification above.**

**137 of 198 is the honest ceiling of this data**, and `WAT` is deliberately
not in it. Everything past 137 requires digitising footprints this repository
does not contain — a real job, but a different one, with its own accuracy
audit, and not something a bake can do.

The number that should be said out loud is not 137/198. It is this:

> **Of the twenty buildings a freshman is most likely to have a class or an
> errand in, sixteen are recoverable and thirteen of those are one constant in
> one file. The four that are not — `ACS` and three parking garages — are
> buildings this repository has never seen, and for those the right answer is
> the one already shipping: *not walkable in this build yet*.**

Classes start in a week. If only one thing gets done, it is Fix 1 plus Fix 2:
that is twelve buildings including Nursing, UT Administration and the West
Mall Office Building, from two constants, with no new door invented anywhere.

---

## 9. What this pass did NOT establish

* **Did not open a browser, start a server, or run any bake.** No file in the
  repo changed except this one. The routable list was read out of the shipped
  `data/walk_graph.json`, not regenerated.
* **Did not prove that widening `CAMPUS` actually produces a door on any
  named building.** §3 measures the *evidence the derivation would see* —
  perimeter samples with a footway dead-end within 8 m or walkable line within
  22 m. That is a strong indicator and it is not the bake's answer. Only
  running `bake_entrances.py` with a wider rect gives that, and it will also
  give the 143 extra buildings whose doorways nobody has judged.
* **Did not measure the frame cost of those 143 extra buildings.** That is the
  gate on Fix 1 and it is not optional.
* **Did not verify a single door against reality.** Nobody has stood in front
  of any of these buildings, and the accuracy this document leans on is
  `placement.md`'s recall against OSM entrance nodes — a check against a source
  that under-maps.
* **Did not look outside this repository for any footprint**, including for
  `ACS`. Deliberately: pulling a building outline from an external source is
  authoring geometry and needs its own scoped pass, not a paragraph at the end
  of a classification.
* **The §5 ranking is a judgement, not a measurement.** The repo has no room,
  department or course data. If UT publishes a room inventory, that ranking
  should be replaced by it and this sentence deleted.
* **Did not resolve the three-snapshot inconsistency** (entrance bake on
  `2026-08-04`, walk bake on `2026-08-05`, `2026-08-16` now on disk). Measured
  that all three carry identical named-footprint coverage, so nothing here
  moves — but the inconsistency itself is unfixed and is not this pass's file.
