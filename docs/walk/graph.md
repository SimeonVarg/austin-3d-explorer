# The walking graph — the spec, and the proof it connects

Acer lane, 2026-08-15. No code was written into the repo for this pass and no
browser was opened. Every number below came out of a throwaway script run
against the files on disk on that date; the scripts live in the session
scratchpad and are quoted in full where the method matters.

This is the third of three documents and it is the engineering one:

* `docs/walk/what-we-can-honestly-say.md` — what the feature is **allowed to
  claim**. That file outranks this one on every question of wording.
* `docs/walk/interface.md` — what it **looks like**.
* **this file** — what the **graph is**, whether it connects, and what
  `data/walk_graph.json` should contain.

Confidence marks are the house convention from `docs/entrances/`:
**[M]** measured here, **[D]** derived from an [M] by an argument written out,
**[C]** cited to a published source I have not re-measured, **[U]** an authoring
default I am choosing so the bake has a number.

**The one-line answer.** The network is already a graph — OSM node identity does
the whole job, 94.26 % of nodes are in one component, and snapping is nearly
worthless. The doors attach beautifully, median 2.7 m. The thing that actually
limits the feature is that 92 of 198 UT buildings have no modelled door at all.

---

## 0. Four numbers in the task brief are wrong, and one of them changes scope

Checked before depending on any of them, per the brief's own instruction.

| brief says | on disk today | verdict |
|---|---|---|
| 3,430 walkable ways, 3,098 footway / 189 steps / 55 pedestrian / 70 cycleway / 18 path | identical, all five | **[M] correct** |
| 198 buildings in `ut_buildings.json` | 198 | **[M] correct** |
| 24 named West Campus towers | 24 | **[M] correct** |
| 584 doors, 11,890 pieces | **629 doors, 11,777 pieces** on 280 buildings | **[M] the file moved on** — more doors, fewer parts |
| `places.geojson`: 209 cafes, 268 restaurants, 230 fast food, 81 convenience | **156 POIs total** in `osm_cache/places.json` (34 restaurant, 30 fast_food, 29 cafe, 10 convenience); the baked `data/places.geojson` renders **127 distinct named tenants** | **[M] wrong by ~5×** |

The last row matters. *"Add a coffee shop on the way"* is not sitting on 788
places, it is sitting on about 90 food-and-drink POIs, nearly all of them on the
Drag, Guadalupe and West Campus. It is a real feature for a route that passes
that corridor and an empty one for a route that stays inside east campus. Good
news for the routing itself: **every one of the 127 named places is within 30 m
of the main component** (median 6.2 m, p90 14.4 m) **[M]**, so no coffee stop is
ever unreachable — there just are not many of them.

---

## 1. The raw graph. Do not build a snapper first; you almost certainly do not need one.

The single most useful fact about `data/osm_cache/footways.json` is one the
brief did not mention: **every way carries its OSM `nodes` array alongside its
`geometry`, and the two are always the same length** (checked on all 3,430 —
zero mismatches) **[M]**. That means the topology is *given*. Two ways that meet
at a junction share an integer node id. Nothing has to be inferred from
coordinates.

Build the graph by treating the node id as the identity and nothing else:

```
ways                     3,430
nodes (distinct ids)    10,637
undirected edges        11,566      (11,599 raw segments, 33 duplicates, 0 zero-length)
directed arcs           23,198
total walkable line     160.75 km
  footway  143.2 km   pedestrian 8.5 km   cycleway 6.29 km   path 1.39 km   steps 1.37 km
bbox   lon -97.75456 .. -97.72226   lat 30.27362 .. 30.29816   (3.11 x 2.73 km)
```
**[M]**

Degree histogram — this is what a real, already-noded network looks like:

```
degree 1   612 nodes      dead ends
degree 2 8,032 nodes      shape points inside a way
degree 3 1,521 nodes      T-junctions
degree 4   468 nodes      crossroads
degree 5     3
degree 6     1
```
**[M]** 3,577 of the 10,637 nodes are shared by two or more ways **[M]** —
those are the junctions, and they exist for free.

Two structural notes for whoever writes the bake:

* **51 ways are closed rings and 42 are tagged `area=yes`** **[M]** — plazas and
  traffic islands drawn as polygons. Their perimeter is walkable line; their
  *interior* is not traversable by this graph, so a route will walk around a
  plaza it should cut across. That is a known, bounded ugliness. Do not fix it by
  triangulating areas in v1.
* **`layer` is tagged on 85 ways** (70 at +1, 15 at −1) **[M]**. Bridges over,
  underpasses under. Layer is the guard that stops a snapper joining a bridge
  deck to the path beneath it, and §3 shows it earning its keep.

---

## 2. Components. This is the number.

```
59 connected components
largest:  10,026 nodes  =  94.26 % of nodes
          3,256 of 3,430 ways
          153.63 km of 160.75 km  =  95.57 % of walkable line

stranded outside it:      611 nodes, 174 ways, 7.126 km  (4.43 % of length)
next largest: 85, 77, 54, 49, 31, 29, 24, 22, 20, 17, 13, 12 nodes
size buckets: 27 components of <=2 nodes, 11 of 3-5, 5 of 6-10, 12 of 11-50, 4 of >50
```
**[M]**

**Read that as: one campus-sized island and a scatter of debris, which is the
healthy outcome.** Twenty-seven of the 59 components are one or two nodes —
driveway aprons, an orphaned crossing, a way whose other end nobody drew.

The four large islands are, by centroid:

| # | nodes | centre | span | what it is |
|---|---|---|---|---|
| 1 | 85 | 30.29272, −97.74990 | 1,118 m | west of Lamar, off campus |
| 2 | 77 | 30.29333, −97.73723 | 141 m | north campus, near Dean Keeton |
| 3 | 54 | 30.28130, −97.72656 | 155 m | far east, past the interstate |
| 4 | 49 | 30.29355, −97.73839 | 413 m | **Austin Presbyterian Theological Seminary** — named in the data, a genuinely private, gated site |

**[M]**

Island #4 is the shape of the whole problem: it is not a mapping error, it is a
place whose paths really do not connect to the public network in OSM. A snapper
that "fixes" it is inventing a right of way.

---

## 3. Snapping. I measured the curve, then measured what the curve was buying, and it was buying lies.

The classic failure the brief names — two paths that visually cross but share no
node — is **not present here at any material scale**, and the way to see that is
to look at what snapping actually gains.

### 3a. How far apart are the dead ends?

For each of the 612 degree-1 nodes, distance to the nearest point on a segment
it is not part of:

```
n=609   min 0.09   p10 1.97   p25 3.78   median 6.74   p75 12.93   p90 20.92   max 78.9  (metres)
<=0.25 m: 3     <=0.5 m: 4     <=1 m: 25    <=1.5 m: 42    <=2 m: 61
<=3 m: 113      <=5 m: 213     <=8 m: 346   <=12 m: 442   <=20 m: 539
```
**[M]**

A network with a real noding problem has a spike at ~0 — dozens of endpoints
sitting 1–5 cm from a line they were meant to join. **There are four such nodes
in the whole campus.** The median dead end is 6.7 m from anything, which is what
a genuine dead end looks like.

### 3b. The naive curve, which is a trap

Stitch every dead end to the nearest non-incident segment within `tol`, with
only a layer guard:

```
tol_m  stitched  blocked  components  largest   pct nodes
0        0         0        59        10,026    94.26 %
1       22         3        59        10,026    94.26 %
2       57         4        57        10,030    94.29 %
3      105         8        56        10,032    94.31 %
5      202        11        48        10,220    96.08 %   <-- looks like the winner
8      333        13        44        10,243    96.30 %
12     425        17        36        10,262    96.47 %
20     519        20        30        10,268    96.53 %
```
**[M]**

5 m looks like an obvious buy: fourteen fewer components and +1.8 points of the
network folded into the main island for the price of a two-metre-ish tolerance.

### 3c. What those stitches actually cross

I put every candidate stitch through the 2,453 building footprints in
`data/snapshots/2026-08-05/buildings.enriched.geojson` and the 12,098 drivable
road centrelines in `data/osm_cache/roads.json` — 85,012 obstacle segments — and
asked how many stitches pass through a wall or a road:

```
tol_m  candidates  cross building  cross road  cross layer  UNSAFE  unsafe %
0.5        4            0              0            2          2     50.0 %
1         25            1              0            3          3     12.0 %
2         61            1              0            4          4      6.6 %
3        113            2              2            8         11      9.7 %
5        213            3             13           11         26     12.2 %
8        346           10             37           13         58     16.8 %
12       442           16             59           17         89     20.1 %
20       539           23             96           20        135     25.0 %
```
**[M]**

**Thirteen of the stitches that 5 m adds cross a road with cars on it, and three
go through a building.** That is precisely "a footpath connected to a path on the
other side of a wall", and at 8 m it is thirty-seven of them.

Now re-run the connectivity curve with the obstacle guard switched on — reject
any stitch that crosses a building wall, a drivable road, or a layer boundary:

```
tol_m  accepted  rejected  components  largest   pct nodes
0        0          0        59        10,026    94.26 %
1       22          3        59        10,026    94.26 %
2       57          4        57        10,030    94.29 %
3      102         11        56        10,032    94.31 %
5      187         26        51        10,073    94.70 %
8      288         58        48        10,076    94.73 %
12     353         89        42        10,084    94.80 %
20     404        135        36        10,090    94.86 %
```
**[M]**

**The entire apparent gain at 5 m was false connections.** Guarded, twenty metres
of tolerance moves the largest component from 94.26 % to 94.86 % — six tenths of
a point, for 404 invented links. The remaining islands are real.

### 3d. Decision

**`SNAP_TOL_M = 2.0`, with both guards, and the expectation that it is close to a
no-op.** [D]

Why 2.0 and not 0:

* it is above the four sub-0.5 m endpoints that are unambiguous noding errors;
* it is the last tolerance where the unsafe rate is at its floor (4 candidates,
  all four caught by the guards → **0 accepted unsafe stitches**);
* 2 m is narrower than any sidewalk-to-kerb gap and much narrower than a traffic
  lane, so a 2 m stitch cannot cross a street even if the guard were removed;
* it costs 57 links and buys 4 nodes, which is the correct size of answer.

Why not larger: §3c. Why not zero: the four genuine errors, and because having
the guard machinery in place is what makes it safe to raise the number later if
a real gap is ever found by looking at the map.

**The guards are not optional and are not a tuning knob.** Ship them as three
named constants and a hard assertion:

```
SNAP_TOL_M              = 2.0     // dead end -> nearest non-incident segment
SNAP_RESPECT_LAYER      = true    // never join across a layer boundary
SNAP_BLOCK_OBSTACLES    = true    // never join across a building wall or a drivable road
SNAP_MAX_ACCEPTED       = 80      // bake fails loudly if a data refresh explodes this
```

---

## 4. How the 629 doors attach

Door position = centroid of all the polygon rings sharing one `bid|eid`. Link =
perpendicular projection onto the nearest segment **on the main component** (not
merely the nearest segment — see the trap below).

```
629 doors on 280 buildings, 129 distinct three-letter codes
link distance to the main component, metres:
  min 0.00  p10 0.2  p25 0.4  median 2.7  p75 7.2  p90 14.9  p95 24.4  p99 71.9  max 98.9

   0-2 m  271        10-15 m  41        30-45 m  14
   2-5 m  138        15-20 m  21        45-60 m   3
  5-10 m  117        20-30 m  15        60+  m    9
```
**[M]**

**603 of 629 doors (95.9 %) are within 30 m of the main component**, and two
thirds are within 5 m. This is the part of the feature that is in good shape.

**The trap, and it is a real one: for 25 doors the *nearest* path is on an
island while the main component is comfortably within reach** **[M]**. A naive
"link to nearest segment" implementation strands 25 doors that are perfectly
routable — including doors on MAI, WEL, GDC, POB, ARC and BMC. **Link to the
nearest segment on the main component, not the nearest segment.**

**The far doors.** 26 doors have no main-component path within 30 m. Ten of them
are the same thing: doors with **no `ref` at all** on peripheral buildings,
36–99 m out. The named ones:

```
FAC 47 m + 40 m   Peter T. Flawn Academic Center
CT7 46 m          (no register code)
SSB 42 m + 41 m   Student Services Building
BIO 40 m + 37 m   Biological Laboratories
UA9 38 m          2609 University Avenue
ARC 37 m + 32 m   Animal Resource Center
TS2 36 m          (no register code)
TSG 35 m x2       27th Street Garage
TCC 32 m          Joe C. Thompson Conference Center
```
**[M]**

Diagnosing them, per the brief's instruction to say which it is: **these are not
"a building with no path to it".** FAC, SSB and BIO sit on the East Mall and the
Six-Pack, which OSM draws as `area` polygons rather than as lines — the same
cause `docs/entrances/placement.md` already identified for its own worst
placement misses. The door is real, the plaza in front of it is real, and the
*line* through the plaza does not exist. TSG and CT7 are garages whose service
frontage genuinely has no mapped footway.

**`DOOR_LINK_MAX_M = 30`** **[U]** — chosen because it is the knee of the
distribution (p95 = 24.4 m, then it jumps) and because 30 m of undrawn last leg
is about the width of one plaza, which is what these actually are. It must be a
constant, and the interface must draw that last leg differently from the routed
path — `docs/walk/what-we-can-honestly-say.md` §7 already rules on this.

**12 of the 603 links pass through a *different* building** than the one the
door belongs to **[M]**, worst offenders on MCA. Eleven of the twelve are ≤9 m,
i.e. a link that clips the corner of a neighbour. Cheap fix, and the bake should
do it: **when the straight link crosses another footprint, take the nearest
main-component segment that does not.** Report the count in the bake's manifest;
if it ever rises above ~20, something upstream moved.

**West Campus attaches cleanly.** 21 lobby doors on 24 towers, median link
2.2 m, max 15.8 m, none on an island **[M]**. Wampus works.

---

## 5. Routable buildings: 104 of 198, and the reason is not the graph

A building is **routable** if at least one of its doors links to the main
component within 30 m.

```
198 UT register codes
  104  routable                                      [M]
    2  have doors, none reach the main component:  BIO (best 37 m), TSG (best 35 m)
   92  have NO MODELLED DOOR AT ALL
```

**Of the 106 codes that have a door, 104 are routable — 98.1 %.** The graph is
not the bottleneck. The door coverage is.

**Six more are recoverable for free.** 262 doors carry no `ref`, on 151
buildings, 57 of which have a name on the footprint. Matching the UT register's
official names against those footprint names by token overlap recovers:

```
RLP  "PATTON HALL"                    -> "Patton Hall"                    3 doors, 0 m
BME  "BIOMEDICAL ENGINEERING BUILDING"-> "Biomedical Engineering Building"3 doors, 1 m
ECG  "EAST CAMPUS GARAGE"             -> "East Campus Garage"             4 doors, 0 m
CLK  "CAVEN CLARK FIELD SUPPORT BLDG" -> "Caven Clark Field Support Bldg" 1 door,  2 m
AF1  "ATHLETIC FIELDS PAVILION (REHAB)"    -> "Athletic Fields Pavilion (Eastside)"
AF2  "ATHLETIC FIELDS PAVILION (EASTSIDE)" -> "Athletic Fields Pavilion (Eastside)"
```
**[M]**

RLP is Patton Hall, a large general-purpose classroom building — the kind of
place a student actually has class. It is currently unroutable because of a
missing string, not a missing door. AF1 and AF2 both match the *same* footprint,
which is the honest failure mode of name matching and the reason this must be a
**reviewed** override list, not an automatic join: **`data/walk_code_aliases.json`,
hand-checked, 4 confident rows to start.** [D]

That takes it to **110 of 198 routable**, and 88 register codes with genuinely
nothing.

**Who the 88 are matters more than the count.** Reading the list: 9 Facilities
Complex sheds, 5 equipment storehouses, 6 graduate-housing units, 4 Gregory
aquatic plant buildings, 10 parking garages, and a scatter of pump houses,
control buildings and child development centres. **A student does not have class
in most of these.** The painful absences are short: `NUR` (Nursing School),
`ATT` (AT&T Conference Center), `KIN` (Kinsolving), `SMC` (Dell Seton),
`HDB`/`HLB`/`HTB` (the Dell Med block), `UTA`, `STD` (DKR), `BMS`/`BMK`
(the Blanton). Those ten or so are worth authoring by hand; the sheds are not.

**And a coverage number for the whole scene, so nobody is surprised:** the
2026-08-05 snapshot holds **2,453 building footprints and 280 of them have a
modelled door** **[M]**. Type the name of a West Campus apartment that is not
one of the 24 authored towers and there is nothing to route to.

---

## 6. Edge costs, honestly

`docs/walk/what-we-can-honestly-say.md` §3–§6 owns the *wording*. This section
owns the *arithmetic*, and it agrees with that file everywhere.

### 6a. Distance is the only thing measured exactly

Plane distance in a local equirectangular frame anchored at lat 30.285
(`MPD_LON = 96,061 m/deg`, `MPD_LAT = 111,195 m/deg`). Over a 3.1 km bbox the
error against the ellipsoid is under 0.02 % **[D]** — far below the noise in
everything else here. Store it as **centimetres in an integer**, not metres in a
float; it compresses better and 1 cm is absurd precision already.

### 6b. Walking speed

**`WALK_SPEED_LOW = 1.10 m/s`, `WALK_SPEED_HIGH = 1.40 m/s`** **[C]** —
Bohannon's meta-analysis of comfortable gait speed puts healthy adults aged
20–49 at roughly 1.34–1.43 m/s, and pedestrian design practice (MUTCD crossing
timing) uses 1.07 m/s as the conservative end. Those two brackets are where the
range comes from. A single number is forbidden by the sibling doc and the reason
is good: on a 1 km route those two speeds are 11.9 min and 15.2 min.

### 6c. Stairs — a speed, never a step count

The brief asked how to get a step count from length when only 9 ways carry
`step_count`. **The answer is that you cannot, and I have the measurement.**

At the best-fitting linear estimator (`TREAD_RUN_M = 0.38`, the median metres
per step across the seven short tagged ways):

```
way length  tagged  estimated   error
   0.9 m      3        2         -1
   1.2 m      3        3          0
   1.3 m      4        4          0
   1.5 m      4        4          0
   2.5 m      7        7          0
   2.5 m      5        7         +2
   9.9 m     12       26        +14
  63.5 m     21      167       +146
  63.9 m     21      168       +147
```
**[M]** — mean absolute error 2.4 steps on the seven short ways, and off by a
factor of eight on the two long ones. The cause is obvious once you see it: long
stairways on this campus are mostly landing, and the estimator counts landing as
tread. Applied to all 189 ways it would claim **3,619 steps on campus** with 13
individual staircases over 40 steps and 10 over 80. Those are not real.

**Ruling: no step count is computed, ever.** The route counts *staircases*,
which it knows exactly because it traverses them.

Cost model for a `highway=steps` edge:

```
STAIR_SPEED_MPS   = 0.50    [C]  horizontal-component speed on stairs, ~1/3 of level
                                 walking; Fruin's stair-flow figures put ascent at
                                 0.5-0.8 m/s along the slope, and a stair's plan
                                 length is shorter than its slope length.
STAIR_FIXED_S     = 4.0     [U]  per staircase, for finding it, queueing and turning.
```

So a steps edge costs `len / STAIR_SPEED_MPS`, plus `STAIR_FIXED_S` once per
distinct steps way entered. In practice that makes a 3.7 m staircase (the median)
cost about 11 s against 3 s for the same distance on the flat — enough for the
router to prefer a modest detour, which is the behaviour we want.

### 6d. `incline` is not a hill tag. It is a stair-direction tag.

This is the finding that changes how to use it. Of the 86 ways carrying
`incline`, **80 are `highway=steps`** (44 up, 38 down across all 86) and only
**6 are not** **[M]**.

So `incline` on this campus does not describe gradient. It describes **which way
is up on a staircase**, relative to the way's node order. That is directly
usable, and it is the only honest use:

* **DO** use it to say *"up the steps"* or *"down the steps"* for the 80 tagged
  staircases the route traverses, flipping the sense when the edge is traversed
  against node order.
* **DO** make going up cost more than going down (`STAIR_UP_MULT = 1.35` **[U]**,
  applied only where `incline` is known).
* **DO NOT** use it for gradient, climb, or "uphill" anywhere. The sibling doc
  §5 rules that out and it is right: there is no elevation data in this repo at
  all, so the 2.5 % of ways with an `incline` tag would produce routes marked
  flat because nobody surveyed them.

### 6e. Crossings

805 ways are `footway=crossing`; 136 of those are `crossing=traffic_signals`
**[M]**. A signal cycle on Guadalupe or MLK is ~90 s, so each signalised crossing
is 0–90 s of waiting and the router knows how many it hits. Model it as a cost
that widens the range rather than a fixed add:

```
SIGNAL_WAIT_LOW_S  = 0     [U]
SIGNAL_WAIT_HIGH_S = 45    [U]   half a cycle, the expected wait on arrival
CROSSING_PENALTY_M = 8     [U]   a small distance-equivalent nudge so the router
                                 mildly prefers a route with fewer road crossings
```

### 6f. The step-free profile — it works, and here is what it costs

Delete every `highway=steps` edge and re-measure:

```
largest step-free component:  9,656 nodes  (90.78 % of all nodes;
                              96.31 % of the full main component survives)
doors still linkable within 30 m:  579 of 589      [M]
doors that lose their link:        10, on FAC MAI JGB AHG CMB CMA WIN LTH
```

Sampling 60 random door-to-door pairs with Dijkstra:

```
shortest path uses stairs in            36 of 60 pairs
extra distance to avoid them:  median   78 m
                               p90     454 m
                               max     659 m
no step-free path at all with a FIXED anchor node:  11 of 60
```
**[M]**

Two design consequences, and the second one is a genuine spec finding:

1. **The feature is real.** Three routes in five across this campus use stairs,
   and dodging them usually costs about a minute. *"11–14 min, three sets of
   stairs — or 13–16 min with none"* is a true sentence about this campus and
   nobody else says it.
2. **A door cannot have one fixed anchor node.** With the anchor fixed, 11 of 60
   pairs had no step-free route — but re-anchoring each door to the nearest
   step-free node within 30 m recovers all but 10 doors campus-wide. **So the
   graph must store, per door, either several candidate links or enough to
   re-anchor per profile.** Storing the 3 nearest main-component nodes per door
   (§7) is the cheap version and it is what I am specifying.

MAI losing a door when stairs are banned is the South Mall steps, and it is
correct — that door genuinely is up a staircase.

### 6g. Performance, so nobody worries about it

Full single-source Dijkstra over all 10,637 nodes / 23,198 arcs with a binary
heap: **3.2 ms per query** (mean of 200, node v25, unthrottled, no early exit)
**[M]**. With an early exit at the target it is a fraction of that. On a 4×
throttled mobile CPU, assume ~13 ms. Sampled route lengths: median 1,004 m, p90
1,754 m, detour ratio (path ÷ straight line) median **1.38**, p90 1.77 **[M]** —
which is a normal, believable pedestrian network, not one full of absurd
detours. One sampled pair hit a ratio of 9.26; that is a door anchored onto a
stub and it is the shape of bug the assertions in §8 exist to catch.

The client-side architecture in the brief is not just affordable, it is
over-provisioned. **[M]**

---

## 7. `data/walk_graph.json` — the format

### The shape

One file, one bake (`scripts/bake_walk_graph.py`), owned by nobody else per
CLAUDE.md rule 1. Arrays of primitives, not arrays of objects — that single
choice is worth 4.4× on the wire.

```jsonc
{
  "v": 1,
  "as_of": "2026-07-30T16:47:30Z",     // the Overpass timestamp, read from the source
  "q": 1e-6,                            // coordinate quantum, degrees (~0.11 m)

  "n": {                                // 10,637 nodes, delta-coded quantised ints
    "x": [ -97754563, 214, 97, ... ],   // lon, first absolute then deltas
    "y": [  30273617, 118, -3, ... ]
  },

  "e": {                                // 11,566 undirected edges
    "a": [ ... ],                       // node index
    "b": [ ... ],                       // node index
    "w": [ ... ],                       // plan length, CENTIMETRES, integer
    "f": [ ... ],                       // flag byte, see below
    "s": [ ... ]                        // steps-way id, only for edges with STEPS set,
                                        //   so the router can count STAIRCASES not edges
  },

  "d": [                                // 629 doors
    // [ x, y, [node,node,node], [linkcm,linkcm,linkcm], role, src, bldgIdx ]
  ],

  "code": { "MAI": [12, 13], "RLP": [88, 89, 90], ... },   // 129 codes -> door indices
  "name": { ... },                       // lowercased search key -> code, for the box
  "poi":  [ ... ],                       // 127 named places: x, y, node, cat, name

  "meta": { "components": 59, "main_nodes": 10026, "snap_accepted": 57, ... }
}
```

Flag byte on each edge:

```
bit 0  STEPS            highway=steps
bit 1  CROSSING         footway=crossing
bit 2  SIGNALLED        crossing=traffic_signals
bit 3  INCLINE_UP_AB    incline known, and a->b is up   (80 staircases)
bit 4  BRIDGE
bit 5  COVERED
bit 6  WHEELCHAIR_YES   informational only — NEVER routed on, see the sibling doc
bit 7  OFF_MAIN         this edge is not on the main component
```

**Three doors' worth of link, not one** (`"d"[i][2]` and `[3]`): the three
nearest main-component nodes and their link lengths. That is what §6f showed is
needed for the avoid-stairs profile to re-anchor, and it costs ~15 KB raw.

**`OFF_MAIN` ships in the file rather than being stripped.** The 611 stranded
nodes stay so the map can draw the whole path network as context while the
router refuses to route on them, and so the bake's own assertion can count them.

### The size, measured

Serialised the real payload — all 10,637 nodes delta-coded, all 11,566 edges with
weights and flags, all 629 doors, all 129 codes — and compressed it:

```
raw JSON      275.3 KB
gzip -9        86.7 KB
brotli         48.7 KB
JSON.parse      1.4 ms   (mean of 20, node v25, unthrottled)

the naive object-per-row form of the same data:   1,206.7 KB raw / 167.1 KB gzip
for scale, data/entrances.geojson:                5.26 MB raw /   323.4 KB gzip
```
**[M]**

**275 KB raw is one nineteenth of `entrances.geojson`'s raw bytes**, which is
the file whose parse cost is open queue item W3. It is not going to repeat that
mistake. But the parse cost is not the point — **the point is that it must not be
fetched at boot at all.**

### Loading rule, which is the part that protects the AWS recording

```
WALK_GRAPH_URL     = 'data/walk_graph.json'
WALK_GRAPH_PRELOAD = false          // taste constant; leave false
```

`js/walk.js` self-registers like `js/places.js` and **issues no network request
until the walk control is first opened**. With the feature closed the app makes
byte-identical requests to today's, which is the brief's hard requirement and
which the bake's verify script must assert by diffing the request list, not by
reasoning about it.

At ~87 KB gzipped and a 1.4 ms parse, even a preload would be affordable — but
"affordable" is not "proven", and the recording is imminent. Leave it lazy.

---

## 8. What the bake must assert, or the graph is not trustworthy

`scripts/verify/walk-graph-check.mjs`, run from `scripts/verify/`. Every one of
these is a number in this document and a data refresh that moves it should be
loud, not silent.

```
A.  nodes == 10637 +- 5 %, edges == 11566 +- 5 %
B.  components <= 60, largest component >= 94 % of nodes           <- the §2 number
C.  snap stitches accepted <= SNAP_MAX_ACCEPTED (80)
D.  ZERO accepted stitches cross a building wall or a drivable road <- hard, not a range
E.  ZERO accepted stitches cross a layer boundary
F.  >= 95 % of doors have a main-component link <= DOOR_LINK_MAX_M
G.  door links passing through another building <= 20
H.  routable UT codes >= 104
I.  every code in walk_code_aliases.json resolves to exactly one footprint
J.  step-free largest component >= 90 % of nodes
K.  no edge has w == 0; no node has degree 0
L.  100 random routable door pairs: all reachable, detour ratio p90 <= 2.0
M.  with the walk feature off, the app's network request list is byte-identical
    to main's
```

Assertion **D** is the one that matters. It is the difference between this
document and a plausible-sounding graph.

---

## 9. Build order

1. `scripts/bake_walk_graph.py` → `data/walk_graph.json`. Nodes from OSM ids,
   guarded 2 m snap, door links (3 per door), code index. No routing.
2. `scripts/verify/walk-graph-check.mjs` with assertions A–L. **Green before any
   client code.** This is the render→sample→assert harness rule from the
   playbook, applied to a graph instead of pixels.
3. `data/walk_code_aliases.json` — 4 hand-checked rows (RLP, BME, ECG, CLK).
   Re-run H, expect ≥ 108.
4. `js/walk.js` — lazy fetch, Dijkstra, two profiles. Self-registering, no
   `js/app.js` edit. Assertion M.
5. Drawing and wording per `interface.md` and `what-we-can-honestly-say.md`.

---

## 10. What I did NOT do

* **No code in the repo.** This pass wrote exactly one file, this one. The bake,
  the checker and `js/walk.js` do not exist.
* **No browser, per the brief.** `harness-drift.mjs` was not run because no pixel
  was measured. No server was started; nothing to reap.
* **The 88 doorless buildings are counted and named but not fixed.** Deciding
  which ten deserve a hand-authored door is a separate pass, and it touches
  `data/entrances.geojson`, which this pass does not own.
* **`walk_code_aliases.json` is proposed, not written.** The name match found 6
  candidates and 2 of them (AF1/AF2) collide on one footprint, so the list needs
  a human eye on it before it becomes data.
* **I did not measure real-world walking times against a stopwatch.** Every time
  number here is a speed assumption times a measured distance, and the sibling
  doc's rule that we print a range rather than a number is the mitigation.
* **I did not test a `?walk=` URL grammar or anything about clip mode.** That is
  `interface.md`'s territory.
* **Areas are still not traversable.** 42 plaza polygons will be walked around
  rather than across. Measured, accepted for v1, not solved.

---

## 11. Round two, 2026-08-15: 111 -> 120 routable, and where the honest maximum actually is

The graph shipped (§113 of `HANDOFF.md`) at 111 of 198 register codes
routable. This section is the recovery pass: what was recoverable without
inventing anything, what was not, and the numbers after. Everything below is
**[M]** off `scripts/bake_walk.py` on this date unless marked.

### 11a. The 87 stranded codes, classified before anything was changed

```
  2   have doors, none within 30 m of the walked network     BIO, TSG
  7   have doors filed under a name or ref the register
      does not use                                           DMC MNC NEZ BMS BMK AF2 TCP
 78   have NO DOOR IN ANY SOURCE - not in OSM, not derived
      from a facade model, not authored
```

The 7 are the finding. §5's name-matching pass stopped at door groups whose
`nm` matched a register name; it never looked at door groups whose **ref**
disagrees with the register:

* `DMC` — the register renamed the Belo Center to the G. B. Dealey Center
  for New Media; the doors still carry `BMC`. Ref join.
* `MNC` — OSM spells the ref `MNAC`. Same building name letter for letter.
* `BMS` — the Blanton Museum Smith Building IS the Edgar A. Smith Building;
  doors carry `EAS` on the Blanton block. Ref join.
* `NEZ` — the doors carry the multi-ref `RMRZ;NEZ`; splitting refs on `;`
  is all it took. The ref itself names the register code.
* `AF2` — §5 rejected AF1/AF2 because REGISTER-name matching hit one
  footprint twice. DOOR-GROUP-name matching does not: the group is named
  'Athletic Fields Pavilion (Eastside)' verbatim. (AF1, the rehab pavilion,
  has no door anywhere and stays stranded.)
* `TCP` — 'Texas Cowboys Pavillion', OSM's spelling, one group, role main.
* `BMK` — the Ellsworth Kelly building is the footprint OSM names 'Austin'.
  One unref'd main-role group, on the Blanton block. The nm is one word,
  so this row leans entirely on the one-footprint assertion (gate I).

Every join was verified against the door group's own coordinates before
being written into the bake, and each is one line in `CODE_ALIASES` /
`CODE_REF_JOINS` with the reasoning inline.

### 11b. Walkable road access legs — the §3c trap, avoided structurally

BIO's doors are 37 m from the walked network and 18 m from a service road;
TSG's are 35 m and 10 m. The road network shares OSM node ids with the
footway network, so where a road meets a footway the join is GIVEN — 1,207
such portal nodes exist in the main component.

The client prices every non-steps edge at plain metres and the bake may
never disagree with it, so the brief's "roads at a time penalty" is
replaced by a **structural guarantee that makes the penalty unnecessary**:
adopted road edges are parent-chains in ONE multi-source Dijkstra forest
rooted at the portals, so their union is a forest and each chain hangs off
exactly one main-component node. A road is a way IN to a stranded door,
never a way THROUGH — no route between two footway-served places can touch
one. That is not an argument, it is gate R (forest violations == 0) plus
the measured fact that all nine §113 routes were bit-identical with roads
on and off (staged run, this date).

```
classes    service, residential, living_street, unclassified
adopted    84 edges, 1.087 km, 18 door groups attached
guards     chain <= 250 m; rejected whole if any edge runs > 3 m inside
           a footprint that is not the target door's own building
recovers   BIO (chain 34 m), TSG (35 m) - plus better doors for ARC, CT7,
           MCA, SSB, TCC, TS2, UA9 and three unnamed groups
```

### 11c. Anchors now span distinct approaches, and BUR>CBA is fixed

§113 froze BUR>CBA at its broken 949 m on purpose: McCombs' main door sat
3 m from a spur that rejoins the network 130 m south, nearest-3 put all
three anchors on that spur, and the route overshot the building by 131 m.
The fix is `ANCHOR_SPREAD_M = 45`: after the nearest anchor, a candidate
within 45 m of an earlier anchor ALONG THE NETWORK is passed over, so the
door also anchors on the frontage path across the 11 m gap — a 21 m
unmapped last leg, drawn dashed like every other, not an invented stitch.
Slots the spread cannot fill are refilled nearest-first, so no door lost an
anchor it had.

Three frozen routes moved, each re-audited: BUR>CBA 949.2 -> 788.7 (the
overshoot is gone, walls 0), GRE>MAI 575.3 -> 540.3 (cleaner South Mall
approach, walls 0), STD>MAI 1002.5 -> 1018.0 (+1.5 %, and the route sheds
3 of its 5 staircases). The other six did not move by a centimetre.

### 11d. The numbers after, and the new assertion set

```
nodes 11,228   edges 12,175   components 50   largest 95.6 % of nodes
doors attached 620 of 629 (98.6 %)   worst link 27.7 m
routable 120 of 198   (118 codes have a door; 120 route because NEZ and
                       BMS ride on doors filed under RMRZ;NEZ and EAS)
file 335.3 KB raw / 101.0 KB gzip -9   (+6.8 KB raw over §113's)
validation: 18 frozen pairs (the nine §113 pairs + one per recovered
            code), all audited walls-0, regression PASS and watched
            failing on a perturbed baseline
```

New wire key: `re` — delta-coded edge indices of the road access legs. The
flag byte is full and the client decodes it into a Uint8Array, so a ninth
bit would wrap to zero; membership ships out of band and today's client
ignores it.

Gates grew from 13 to 17: H's floor rises 104 -> 118, I asserts every nm
alias resolves to exactly one footprint and every ref join found doors,
R asserts the road forest property and caps adoption at 2 km.

### 11e. The 78 that remain, and why they are the honest maximum for this bake

Every one of the 78 has **no door in any source**. 23 of them have a named
footprint on the map (NUR, UTA, HDB, HTB, JHH, WMB, WAT, CDL, ANB, LCH,
the garages...); 55 have not even that (the Facilities Complex sheds, the
equipment storehouses, graduate housing, Dell Seton, the aquatic plant).
The bake prints each code with its reason on every run.

Routing to a synthesized point on a footprint outline was considered and
REJECTED: the client words every arrival as a door claim ("Entrances are
on this side" for anything it does not recognise), and a synthesized point
would put that sentence on a building whose entrances nobody has mapped.
The honest fix is authoring doors in `data/entrances.geojson` — which is
not this bake's file. The ten worth authoring first, per §5: NUR, UTA,
HDB/HLB/HTB, SMC, JHH, WMB, CDL, ANB.

### 11f. Known-bad, updated

`BUR>CBA` is fixed and unfrozen from its broken value. The one entry now is
`GRE>MNC`: Moncrief-Neuhaus sits inside the fenced athletic complex and
every mapped approach comes off the San Jacinto loop to the east, so a walk
from Gregory rounds the stadium block and the audit reads the arrival as a
90 m overshoot. Both doors anchor cleanly; there is no western approach to
choose. That is the fence, not the graph.

---

## 12. Round three, 2026-08-16: findable now MEANS routable, and a canopy was eating the only surveyed door on the Moody Center

Two questions this pass had to answer, and they are not the same question.
**Findable** is "the search box offers this name". **Routable** is "pressing
Enter produces a walk". A name that is findable and not routable is worse
than a name that is absent, because it fails *after* the student believes it
worked - and it fails while they are already walking. Everything below is
**[M]** off `scripts/bake_walk.py` and the shipped `data/walk_graph.json` on
this date.

### 12a. QUEUE Z4, checked rather than assumed - and it was already closed

Z4 says six of the 24 West Campus towers are not in the graph. **On `main`
today they are.** §11 landed the fix (the `wc` map had been filtering door
groups on `src == "westcampus"`, and six towers' lobby doors are `derived`);
QUEUE.md was never updated because that lane could not write it.

Trusting that was not good enough, so the shipped wire file was decoded by a
second, independent router - not the bake's own in-memory graph - and every
tower was routed end to end:

```
24 of 24 towers in `wc`, all with anchored doors, all producing a real route
  21 Rio                  843 m      Skyloft Austin            718 m
  Pointe on Rio          1017 m      The Block                1436 m
  The Quarters Sterling   925 m      The Venue on Guadalupe   1140 m
  (the other 18: 530-1461 m, all routing)
120 of 120 register codes in the `code` map have an anchored door
119 of 119 of them produce a real route to WEL
  0 entries anywhere in the file are findable-but-not-routable
```

**So the two states now differ like this.** A building the graph ships is
findable *and* routable - there is no in-between state left in the file. A
building the graph does not ship (the 78 below) is findable because the
client merges UT's register in, and it answers `<code> is not walkable in
this build yet`. That is findable-and-refusing, which is honest; the state
this pass abolished is findable-and-failing.

**And it is now a gate, so it cannot come back.**

* **Gate S** - every key in `code` and every name in `wc` has at least one
  anchored door, and every anchor sits on the main component.
* **Gate T** - all 24 towers are routed to `WC_ROUTE_TARGET` (`WEL`, chosen
  because it is the far side of campus) on the finished graph, driven, not
  argued.

Both were **watched failing** before being believed. Re-apply the original
Z4 bug (filter `wc` on `src == "westcampus"`) and T reports `18 of 18
routed` and goes red. Leave a tower findable but strip its anchors and S
reports `1 entries with no anchored door` and T names it: `23 of 24 routed,
FAILING Skyloft Austin`.

### 12b. A `building_class: roof` was counted as a wall in the one test that mattered

The Moody Center's doors were the last four unlinked doors on campus, and
one of them is `src: osm, role: main` - a **surveyed** entrance, the kind
`what-we-can-honestly-say.md` §7 says may be called *"The main entrance"*.
It sits **9.4 m** from the walked network and it was being thrown away.

The cause is in this file's own constant. `WALL_IGNORE_CLASSES = {"roof"}`
was declared with a comment naming the Moody Center by hand - canopies,
awnings, arena roof planes, walking under one is walking outdoors - and it
was honoured in `find_through_edges` and in `edge_clips_building` and **not
in `anchor_doors`**, which called the raw boundary test. So every candidate
link to those doors crossed an unnamed 8 m roof plane and was rejected:

```
Moody Center, before        after
  door 461 osm/main    0 of  3 candidates usable   ->  2 anchors, 9.4 m
  door 462 derived     0 of  2                     ->  3 anchors, 0.9 m
  door 463 derived     0 of 19                     ->  3 anchors, 4.0 m
  door 464 derived     0 of 43                     ->  2 anchors, 3.8 m
doors linked   620 of 629 (98.6 %)  ->  624 of 629 (99.2 %)
```

The same inconsistency was in `audit()`, whose wall counter is the strongest
guard in the file (*"any number here is a FAILURE"*). It tested the two
unmapped last legs without the class filter, so the moment the Moody door
attached, five spot-checked routes reported `walls 1` - and the wall was the
awning. Both now use the class filter, and canopy contacts are **counted and
printed separately** rather than dropped: the validation line reads
`(last leg passes under 1 canopy/ies)`. Measured across the 299-pair sweep:

```
routes flagged, roof counted as a wall   27
routes flagged now                       22
the difference                            5, every one of them canopy-only
```

**What was deliberately NOT done**: `anchor_doors` still requires a link to
cross *no* other building. It was tempting to give it `edge_clips_building`'s
3 m depth tolerance for consistency, and that would be loosening a guard to
buy connections, which is the one move this graph does not make.

### 12c. The 78 that do not route, re-derived from OSM's own ref tags

§11e said all 78 have "no door in any source". That was true and it was
*argued* from fuzzy token-matching the register's names against footprint
names - a method in which a fuzzy miss and a genuinely unmapped building
read identically. This pass re-derived it a second, independent way.

OSM tags **177 campus building ways with a `ref`, and 134 of those refs are
register codes**. That is a surveyed answer to "where is this building" that
depends on no name string agreeing with any other. Frozen into the bake as
`OSM_REF_XY` (provenance in the comment; **diagnosis only - it creates no
door, node or edge**), it turns the stranded list from a number into a
per-building finding:

```
 50  not on the map at all: no OSM ref, and no footprint carries the
     register's name  (greenhouses GHA-GHF, equipment storehouses E11-E27,
     the Facilities garages, graduate housing, NUR, SMC, UTA...)
 26  on the map, but the nearest mapped door is further than 40 m and
     belongs to another building
  2  on the map with a mapped door within 40 m - checked by hand, below
```

Each of the 78 prints one line, e.g. `HDB  OSM maps it as 'Health Discovery
Building'; nearest mapped door is 183 m away and it is 1836 San Jacinto's`.

**The three borderline cases were checked by hand and all three are
rejected**, which is the point of surfacing them:

* `FDH` J. Frank Dobie House - nearest door 39 m, on an unnamed neighbour.
* `LCH` Littlefield Carriage House - nearest door 40 m, and it is the Jesse
  H. Jones Communication Center B's.
* `WMB` West Mall Office Building - nearest door 40 m, and it is Goldsmith
  Hall's.

Adopting any of them would put *"Entrances are on this side"* on the wrong
building's wall, 40 m away. `AF1` deserves its own line because it is the
trap: a 0.6-Jaccard name match pulls in *'Athletic Fields Pavilion
(Eastside)'*, whose doors are 15 m away - and that footprint is **AF2**. The
rehab pavilion still has no door anywhere.

**So 120 of 198 remains the honest ceiling for this bake, now on two
independent measurements rather than one.** The constraint is door supply,
not connectivity: 624 of 629 doors attach, and the five that do not
(`ARC`, `BIO` and `FAC` second doors, one unnamed) are 30.9-47.4 m from the
network with their buildings already routable through other doors. Raising
`DOOR_LINK_MAX_M` past 30 m to catch them would be buying a connection with
a longer unsurveyed straight line, which is the same trade §3d refused.

**The fix is still authoring doors in `data/entrances.geojson`, another
lane's file.** With `OSM_REF_XY` the shopping list now comes with
coordinates: the 26 "on the map" codes are the ones where a surveyor has
already drawn the building and only the door is missing - `NUR`, `UTA`,
`HDB`, `HTB`, `JHH`, `WMB`, `CDL`, `ANB`, `LCH`, `SAG`, `TRG`, `GUG`, `HCG`
first, because they are named buildings a student types.

### 12d. The numbers after

```
nodes 11,247   edges 12,194   components 50   largest 95.61 %
doors attached 624 of 629 (99.2 %)   worst link 27.7 m   re-routed 5
routable 120 / 198   `code` 143 keys   `wc` 24 towers
file 336.0 KB raw / 101.3 KB gzip -9   bake 5.8 s (was 3.3 s: gate T
     drives 24 real routes)
gates 19 of 19 green   (17 -> 19: +S findable-means-routable, +T towers
     driven; both watched failing)
validation 19 pairs (18 frozen + JES>MCA, the recovered surveyed door),
     all walls 0, --regress PASS and watched failing on a moved baseline
sweep 299/299 routed, 0 no-route, detour median 1.41 / p90 1.81 / max 4.50
```

Two frozen rows moved by less than half a metre - `BUR>CBA` 788.7 -> 789.2
and `GDC>BIO` 405.8 -> 405.7 - because four new anchors splice new nodes into
existing edges and a shared edge is then summed in two pieces. Both were
re-audited: same door pair, same path, walls 0.
