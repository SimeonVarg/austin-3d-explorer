# A mall is a surface, not a fence

Acer lane `acer/cd-walkways`, 2026-08-27. Round 1.

**The brief was "the drawn paths do not follow the real ones — trace them
against recent aerial imagery, and use desire paths where they are visibly
real". Measured, the drawn paths already follow OSM to a median of 1.2 m and
99 % of a walking route's metres already land on a drawn surface. What does not
follow the real ones is the ROUTE: `scripts/bake_walk.py` puts a mapped
pedestrian area into the walking graph as a RING OF EDGES and nothing across
the middle, so the router walks students round the South Mall rather than down
it. Tower to PCL was 630 m for a walk that is 484 m.**

Two things landed and one did not:

1. **1,573 plaza chords** across 33 mapped pedestrian areas, each one confirmed
   against a real aerial photograph before it was added, and **134 refused by
   that photograph** — because OSM's pedestrian polygons on this campus are
   *not* all pavement. The Main Mall polygon contains the two South Mall lawn
   panels, and a blind triangulation would have routed students over them.
2. **Zero desire paths.** 42,233 geometric shortcut candidates, and the
   photograph confirms none of them. §5 says exactly how hard that was pushed
   before it was written down as a zero.
3. On the way, **the shipped `data/walk_graph.json` turned out to be stale
   against the `data/entrances.geojson` the same tree ships**, and re-baking it
   made `walkmeter.mjs`'s ground-truth doors point at the wrong buildings while
   it went on printing numbers. §2. That one is not about walkways at all and it
   is the most important thing in this document.

Every number below was measured on this date against the files on disk or in a
browser driving the real page. Confidence marks follow the house convention:
**[M]** measured here, **[D]** derived from an [M] by a stated argument.

---

## 1. The picture, first

Same camera, same everything, `data/walk_graph.json` swapped underneath —
`scripts/verify/plazawalk.mjs`, trees hidden, near-nadir, screenshot twice and
the second kept.

| | |
|---|---|
| `docs/shots/walkways-mai-pcl-before.jpg` | UT Tower → PCL, **630 m**. The ribbon hugs the OUTLINE of the South Mall, runs to its corner, and turns. |
| `docs/shots/walkways-mai-pcl-after.jpg` | The same walk, **484 m**. The ribbon cuts straight across the mall's paving, which is what a person does. |

**[M]** 630 m → 484 m, −146 m, −23 %. It is the largest saving of the five
pairs photographed and it is not the only one; all five, including the one that
got LONGER, are in §4.

---

## 2. THE STALE FILE, AND AN INSTRUMENT THAT COULD NOT SAY SO

This came first because nothing else could be measured until it was settled.

`data/walk_graph.json` as committed carries **656 doors**. The
`data/entrances.geojson` in the same tree carries **591**. The entrance work in
HANDOFF §198–199 deleted 118 invented doors and moved 17 onto UT's own surveyed
points, and the walk graph was never re-baked against it — so the graph the
router uses and the doors the city draws had drifted apart. **[M]**

Re-baking with no functional change at all (`CHORDS=0`, the control flag §3
describes) moves:

```
doors        656 -> 591          nodes 11,284 -> 11,206      edges 12,231 -> 12,158
components    50 -> 48           snapshot 2026-08-16 -> 2026-08-27
```
**[M]** None of that is this branch's work. It is the entrance round's work
finally reaching the graph — and the snapshot line is the second half of the
same fault. `data/manifest.json` says `latest = 2026-08-27` and the shipped
graph was built against `2026-08-16`, which is exactly the housekeeping item
HANDOFF §198 left open. `python scripts/snapshot_parity.py` now reports
**`walk_graph.json  PASS  2026-08-27`**; three of its siblings (`drag.geojson`,
`facade_palette.json`, `westcampus.geojson`) are still on the old one and are
not this lane's. Between the two snapshots **0 of 2,453 footprint geometries
changed** **[M]**, so no wall and no door moved because of it — the parity is
bookkeeping, not a relocation.

### And then the scoreboard broke, silently

`scripts/verify/walk-pairs.json` names the ground-truth door for each of the
twenty pairs as a **POSITION IN THE `d` ARRAY** of `data/walk_graph.json`. A
re-bake renumbers that array. So:

```
pair       frozen index -> door in the graph the       the same index after a
                            index was frozen against    plain re-bake
gdc-jes    #382             GDC  Gates Computer Sci     JCD  Jester East Hall
wch-mai    #463             MAI  UT Tower               PAI  T. S. Painter Hall
eer-nhb    #499             NHB  Hackerman Building     RLP  Patton Hall
...
                            30 of 30 point at a DIFFERENT BUILDING
```
**[M]** And `walkmeter.mjs` scored them without a word: metric A went from
**87.0 m to 282.0 m** and the signed total from **−393.7 m to −6,856 m**, all of
it an artifact of thirty indices pointing at the wrong buildings.

**A number that moves by 7,000 m for a reason that has nothing to do with the
change is worse than no number.** Two things were done about it, and neither
relaxes anything the meter asserts:

* **The indices were re-derived**, by the rule `walk-pairs.json`'s own `_what`
  already states — *the graph door nearest UT's published Celebrated entrance
  for that code* — against the current graph, from the 97-row `UT_CELEBRATED`
  table parsed out of `js/wayfind.js` (which self-checks at 97). Same building
  on all 30. And the ground truth got BETTER, because the doors did:

  ```
  distance from the ground-truth door to UT's own published point
      before   median 3.7 m    worst 47.1 m (BIO)   22.2 m (GAR)   21.9 m (ECJ)
      after    median 1.4 m    worst 11.5 m (JGB)    5.4 m (GAR)    0.2 m (ECJ)
  ```
  **[M]** `utPoint` is now recorded beside each index, so the derivation can be
  re-run without reading this note.

* **`walkmeter.mjs` now self-checks it.** Before using a frozen index it asserts
  the door at that index carries the pair's own building code, and a mismatch is
  a SELF-CHECK FAILURE in the same class as the Dijkstra drift check. Eleven
  lines. An instrument that cannot say *"I am measuring the wrong thing"* is not
  an instrument.

  **And it was watched failing, which is the only version of that claim worth
  anything.** Pointed at the pre-repair pair file against this graph:

  ```
  node walkmeter.mjs <the old walk-pairs.json> --no-ui
    PAIR gdc-jes: ground-truth from door index 382 carries ref "JCD", not "GDC"
      ... 30 of these ...
    FAIL  self-check drift 30 over limit, 0 route error(s)          exit 1
  ```
  **[M]** Thirty complaints and a non-zero exit where there used to be a
  confident wrong number.

**This is the bake trap in a costume nobody had seen: not "I edited a source the
renderer never loads", but "I edited a source a DIFFERENT bake loads, and never
re-ran it."** HANDOFF §198's own housekeeping note lists six bakes reading a
stale snapshot and asks for a pass on them. `bake_walk.py` was on that list by
its snapshot and NOT on it by its doors, and the doors are the half that
mattered: a stale snapshot moved nothing, a stale door file moved sixty-five
doors and broke the meter.

---

## 3. The chords, and why a photograph decides them

`build_raw()` reads `data/osm_cache/footways.json` and puts a closed
`highway=pedestrian area=yes` way into the graph as an ordinary ring of edges.
There are **41 of them on campus, 47,391 m² of plaza, 7,119 m of rim** **[M]**
(that rim total is independently the same 7,119 m `docs/walk-sidewalks.md` §13
measured from the other side, which is a cross-check worth having) —
the Main Mall, the East Mall, the Jester and Gates and Blanton forecourts, the
Speedway courts. `docs/walk/graph.md` §10 accepted "plaza interiors are not
traversable" for v1; `docs/walk-sidewalks.md` §6 measured it as the biggest
thing left and wrote out the patch it wanted:

> *"triangulate or grid the interior and add the interior chords as ordinary
> footway edges … Expected: door links on the Six Pack and both malls collapse
> from ~16-24 m to ~2 m, and the PCL→UNB class of detour drops by a third."*

This is that patch **with one change, and the change is the whole point.**

### The change: OSM's plaza polygons are not all pavement

`docs/shots/walkways-chord-verdict-mainmall.jpg` is the Main Mall with its OSM
ring in yellow, the chords the photograph CONFIRMS in cyan, and the chords it
REFUSES in red. The red ones are the ones that cross the two South Mall lawn
panels — which are inside OSM's Main Mall polygon. A blind triangulation puts
students on the grass and calls it a mall.

So every chord is put to a real aerial photograph before it is added.

```
36 plazas above PLAZA_MIN_AREA_M2 = 200 m2   (5 smaller ones: the rim IS the plaza)
6,720 vertex pairs across them
  -275   shorter than CHORD_MIN_M = 8 m         (the rim costs nothing there)
  -2,446 saves less than CHORD_MIN_GAIN_M = 10 m against walking round
  -2,282 leaves the ring          (concave plazas; tested every 2 m, not at the midpoint)
  -6     crosses a building
= 1,711 reach the photograph
  -134   OPEN TURF under the line                <- the thing this section is about
= 1,577 confirmed        (1,573 of them become new edges; 4 already existed)
```
**[M]** 7.8 % of everything that survived the geometry was refused by the
picture.

### The oracle, and its ground sample distance

USGS NAIP orthoimagery: a real aerial photograph, U.S. federal government work,
**public domain**, and not derived from OSM, so it can disagree with the map.
Fetched at the source's own native **0.30 m/px** — `pixelSizeX` off the
service's own metadata, not a guess.

**The fixture `campusmeter.mjs` already carries is the same imagery at
1.55 m/px** (1024 px across a 1,585 m bbox) — five times coarser than the source
offers, and too coarse to see a walk at all. **[M]** That is worth knowing before
anyone builds another measurement on it; §6 has a number that only the fine
version could produce.

Tiles land in `data/imagery_cache/`, which `.gitignore` already covers: they are
a regenerable input and `data/walkway_evidence.json` records the exact query.
The committed artifact is the verdict, not the picture.

### The surface test, and why it is normalised green

`g/(r+g+b)`, not excess green `2G−R−B`. Normalised green is invariant to
exposure; excess green is not, and this campus is under live oak for much of its
length. Measured on the imagery itself:

```
all 40 plaza RIMS, sampled every metre, per-rim median normalised green
                     min 0.3136   p25 0.3327   median 0.3344   p75 0.3381   max 0.3756
                     39 of the 40 sit below the threshold below
a hand transect across the South Mall            pavement 0.337   turf 0.387
```
**[M]** `NG_GRASS = 0.370` sits in that gap. Two more constants keep canopy out
of the answer (`NG_CANOPY_MAX_LUMA = 105`): live oak is dark and only mildly
green, open turf is bright and strongly green, and refusing a line for canopy
would refuse the middle of the Main Mall — which is the line this exists to
confirm. A chord is refused on `VEG_RUN_REJECT_M = 4` consecutive metres of open
turf: one metre is a mown edge beside a walk, four is a lawn.

### The gate is watchable failing

`scripts/verify/README.md`: *"Every gate must be watchable failing."*

```
python scripts/trace_walkways.py --selftest
  intramural field, east-west      turf run  18.0 m  worn 0.30  vegflank 0.42   ok
  intramural field, north-south    turf run   7.0 m  worn 0.03  vegflank 0.58   ok
  South Mall, down the middle      turf run   0.0 m  worn 1.00  vegflank 0.00   ok
  PASS

python scripts/trace_walkways.py --selftest --break        # exits 1 if it does not move
  ... FAIL -- 4 assertion(s)
  --break: the gates went red, as they must
```
**[M]** Three lines whose answer was read off the photograph by eye before the
thresholds were written down, chosen to be complementary: the field line must
FAIL the chord gate and the mall line must PASS it, so a gate stuck on either
answer is caught.

### What it costs

```
data/walk_graph.json   331.3 -> 357.3 KB raw    101.3 -> 106.6 KB gzip   (+5.3 KB)
edges                  12,158 -> 13,751
bake gates             19 of 19 green, before and after
bake reproducibility   two consecutive runs, identical SHA-256
```
**[M]** And nothing fetches it at boot — `WAYFIND.on` is still `false` and is
untouched.

---

## 4. What moved, on two instruments, with the control run

**Both arms are the SAME re-baked graph with the SAME repaired ground truth**,
so the delta is the chords and nothing else. Door array order is identical
between the two bakes (591 of 591 rows match on ref and coordinate **[M]**), so
the frozen indices are valid for both.

`scripts/verify/walkmeter.mjs`, 20 pairs, UT's own coordinates read off the
page (`python scripts/serve.py 8825`):

| | no chords | with chords |
|---|---:|---:|
| A. extra metres over the pairs it makes worse | 2.0 m | **2.0 m** |
| A. signed total | −594.9 m | −541.4 m |
| B. ends at the door UT publishes | **38 / 38** | **38 / 38** |
| B. total door offset, both ends | 109.5 m | 109.5 m |
| mean route length | 435.4 m | **431.2 m** |
| self-check drift | 0.00 m | **0.00 m** |
| live UI gate (a real mouse on the checkbox) | PASS | **PASS** |

**[M]** The signed total moves the "wrong" way by 53.5 m and that is not a
regression: metric A is *app route minus route forced to the ground-truth door*,
and the chords shorten the forced route more than the app's, because the forced
route was the one taking the long way round a mall. The number the record is
quoted on — extra metres over the pairs the router makes worse — is unchanged at
2.0 m, and every walk still ends at UT's own door.

`python scripts/bake_ground.py --walkaudit`, the audit this repo already owns —
20 pairs, 1 m sampling, **zero tolerance**, no browser:

| | no chords | with chords |
|---|---:|---:|
| drawn metres over the twenty | 13,042 | **12,828** (−214 m) |
| **on a drawn WALK** (`k:'patharea'`) | 95.20 % | **96.55 %** |
| on any drawn surface | 98.50 % | 98.37 % |
| over bare ground | 1.50 % (196 m) | 1.63 % (209 m) |

**[M]** 214 m of real walking removed across twenty class-to-class trips, and
more of what is left stands on a drawn walk. **The honest column is the last
one:** bare ground gains 13 m of 12,828, because a chord ends on a plaza ring
vertex and a few of those sit a hand's breadth outside the slab the resolver
kept. 13 metres, named rather than rounded away.

Per pair, the five photographed:

```
pair        before    after
MAI>PCL      630 m -> 484 m      the frames in §1
GRE>MAI      624 m -> 578 m
GRE>NEZ      623 m -> 604 m
PCL>UNB      946 m -> 949 m      LONGER by 3 m, see below
PCL>JES       99 m ->  99 m      unchanged
```
**[M]** `PCL>UNB` getting 3 m longer is real and is the cost model working:
chords give a door new anchors to choose from, and with `LINK_COST_MULT = 4`
the router will accept up to four metres of extra real walking to avoid one
metre of claim about ground nobody surveyed (`docs/walk-sidewalks.md` §3). It
bought a shorter dashed leg with three metres of pavement.

---

## 5. Desire paths: the answer is zero, and here is how hard it was pushed

The brief said students cut across lawns and that aerial imagery shows worn
tracks. It is a good hypothesis. On this photograph it does not survive.

A candidate is a pair of nodes ALREADY IN THE WALKING NETWORK that the network
makes you walk a long way between while they are close in the air — the corner
you would cut. Nothing is invented: an endpoint that is not an OSM node cannot
appear in the output file at all.

```
42,233 geometric candidates inside the CAMPUS bbox
  -9,497  the straight line crosses a carriageway
  -5,627  it crosses a building
  -740    it crosses water
  -138    it crosses a mapped fence or wall
  -3,947  ITS FLANKS ARE NOT LAWN — a shortcut across a paved court is not a
          desire path, it is a missing link, and that is a different claim
  -49     lawn either side, and NO WORN LINE in the photograph
=      0  confirmed
```
**[M]**

### The test is relative, because an absolute one is a rubber stamp

The first version asked *"is the line free of turf"* and confirmed 247 lines out
of 4,000 while refusing 22 — which is not a test. An absolute turf call cannot
separate shaded grass from a shaded walk: measured, a line straight across 67 m
of open intramural field came back with only 8 m of it called turf, because the
rest was in shade. **[M]**

A desire path is not "a line without grass on it". It is a **worn streak through
a lawn**: the ground either side of it is vegetation and the line itself is not.
So the flanks at ±3 m must read as vegetation over `DESIRE_FLANK_FRAC = 0.60` of
their length, and the line itself must read as surface over
`DESIRE_WORN_FRAC = 0.75` of its own. No exposure calibration, and it is the
shape of the thing rather than a property of one pixel.

### Pushed, and it still gives zero

Relaxing the detour ratio from 1.8 to 1.15 and the gain from 25 m to 5 m:

```
100,003 candidates -> 617 with lawn on BOTH flanks
        best worn share 0.56;  reaching 0.75: ZERO;  reaching 0.50: two
```
**[M]** `docs/shots/walkways-desire-nearmiss.jpg` is the best of them with the
candidate drawn on it: unbroken turf and canopy, no track.

**Three reasons this zero could be wrong, all of them real:**

* **0.30 m/px is marginal for a 0.8 m track** — under three pixels, and NAIP is
  JPEG-compressed. A faint track is inside the noise. Finer imagery exists (Esri
  World Imagery at z20 is ~0.13 m/px and this repo already caches it for the
  Speedway work) but its terms are reference-only, so nothing traced from it
  could ship, and this file deliberately emits only what a public-domain source
  can carry.
* **Both ends must already be OSM nodes.** A desire path that leaves a walk
  halfway along a segment is invisible to this scan.
* **NAIP is one flight on one date.** A track worn in term time can be green
  again by the summer.

None of those is a reason to draw one anyway. `desire_paths` is an empty array
in `data/walkway_evidence.json` and the bake reads it every run, so the day
someone finds real evidence the wiring is already there.

---

## 6. Two things measured and NOT shipped, written down so nobody re-derives them

**a) `campusmeter.mjs`'s paths metric B is not a hem artifact, and I was wrong
to think it was.** It samples the RING VERTICES of each path slab — the outline
of a 2.4 m ribbon — so the obvious theory is that it is scoring the mown edge
beside the walk rather than the walk. Tested by pulling every sampled point
inward toward its own polygon's centroid, on the fine 0.30 m mosaic where 1.2 m
is four pixels rather than under one:

```
pull into the slab   ExG>20 (campusmeter's own rule)
        0.0 m         98 of 625   15.7 %
        1.2 m        105 of 623   16.9 %
        2.4 m         96 of 622   15.4 %
```
**[M]** Flat. The theory is dead.

**What the same points say under this round's canopy-aware rule is the useful
part:** only **2.1 %** of them are OPEN, SUNLIT turf. The other ~14 points in a
hundred are dark and green — canopy. **[D]** So roughly seven eighths of metric
B's 16.8 % is live oak over a real path, which is exactly the caveat that metric
prints about itself and could not resolve. It is now resolved, and the number
stands where it is.

**b) Every walkway in this city is 2.4 m wide because that is the default, and
this photograph cannot fix it.** `DEFAULT_WIDTH` in `scripts/bake_ground.py` is
marked GENERATIVE and reads `footway 2.4, steps 3.0, path 1.5, pedestrian 6.0`.
Measured: **0 of 3,098 campus footways in `data/osm_cache/footways.json` carries
a `width` tag.** Not a few — none. **[M]** Every sidewalk in the scene, from a
service walk behind a dorm to a main mall approach, is the same ribbon. That is
the same defect Simeon named on the facades, one system over.

The obvious fix is to measure each one off the photograph. It does not work at
this resolution, and the measurement that says so is worth keeping: the
aggregate perpendicular profile of **8,822 stations** along every campus
footway, sampled every 15 cm out to 7.8 m either side, is **FLAT** — normalised
green does not change from the centreline to eight metres off it. **[M]** The
reason is not the instrument: most campus footways are not bordered by turf at
all. They sit inside continuous paved courts, or under canopy, and there is no
pavement/grass edge to find. A width pass needs finer imagery, or LiDAR
intensity, or a different method entirely — not another go at this one.

---

## 6b. The scoreboard did not move, and it cannot see this change

`scripts/verify/campusmeter.mjs`, run on the finished branch, is **byte-identical
to the starting numbers**:

```
entrances  A: 74/181 within 10 m of UT's own door   B: 69/516 within 10 m of any OSM node
eras       301/591 drawn doors have a MEASURED era
shelter    19/22 HELD-OUT buildings' door shelter matches the photograph
facades    0/7 target buildings' drawn grid matches the photograph
paths      A: 624/625 within 5 m of a fresh OSM way (median 1.2 m)
           B: 105/624 sampled points sit on vegetation in the real aerial photo
```
**[M]** That is the correct result and it is not a shrug: **campusmeter's two
paths metrics both score `data/ground.geojson`, the painted pavement, and this
round changed `data/walk_graph.json`, the routing network. It never opens the
walking graph.** So the scoreboard is blind to this piece by construction, and
`walkmeter.mjs` and `bake_ground.py --walkaudit` are the instruments that see
it. A campusmeter section that reads the walking graph would be the honest fix
and this lane deliberately did not add one — a lane grading itself by extending
the scoreboard it is graded on is exactly the move that should not be trusted.

(The run was against this working tree's `campusmeter.mjs`. The sibling
`acer/cd-facades` branch this one is built on carries a 19-line change to it,
entirely inside `scoreRenderedFacades`; the ENTRANCES and PATHS sections are
byte-identical between the two, so the two numbers this piece is judged on are
unaffected.)

## 7. What this pass did NOT do

* **No ground geometry.** `data/ground.geojson` is byte-identical, checked by
  SHA-256 before and after every run of `--walkaudit`. Nothing about the painted
  city changed; only the route drawn over it.
* **`WAYFIND.on` untouched.** Still `false`.
* **No cost-model change.** A chord is an ordinary footway edge costing plain
  metres, carries no new flag bit (the flag byte is full) and adds no term for
  `walkmeter.mjs` to drift against. Membership ships out of band as `pe`,
  exactly as the road access legs ship as `re`; today's client ignores it.
* **No perf measurement.** Sibling lanes were running; a frame time taken on
  this machine tonight would be a lie. The +1,593 edges and +5.3 KB gzip are
  reported as sizes, not as costs.
* **The other six stale bakes named in HANDOFF §198's housekeeping note were not
  touched.** Only `bake_walk.py`, which was the seventh and was not on the list.

## 8. Files

```
scripts/trace_walkways.py        NEW. owns data/walkway_evidence.json
data/walkway_evidence.json       NEW. 1,577 confirmed chords, 0 desire paths
scripts/bake_walk.py             plaza_chords(), the `pe` wire key, health block
data/walk_graph.json             re-baked (see §2) and chorded
scripts/verify/plazawalk.mjs     NEW. photographs a route; counts the ribbon
scripts/verify/walk-pairs.json   30 indices re-derived (§2), `utPoint` recorded
scripts/verify/walkmeter.mjs     +11 lines: the stale-index self-check (§2)
docs/shots/walkways-*.jpg        the four frames this file cites
```
