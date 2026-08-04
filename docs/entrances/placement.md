# Entrance placement — the method, and what it measures

Written 2026-08-04, acer lane. This is the spine of the entrances pass: it
decides WHERE the doors go. It does not decide what they look like. Every
number below was measured on this repo's data on this date; nothing here is
reasoned about, and where the method fails the failure is written down with its
size.

Everything in this doc was produced with a scratchpad harness, not a browser.
No pixel was measured, because there is nothing rendered yet to measure.

---

## 0. THE HEADLINE, before anything else

**The geometric method proposed in the brief works, and it is not enough on its
own.**

It recovers **78% of the 91 known OSM entrances at 8 m, with a median position
error of 0.00 m** — when it hits, it hits the exact node, because the same OSM
footway vertex that OSM's mapper attached the entrance to is the vertex the
derivation lands on.

But it only ever *fires* on buildings that have a footway drawn up to them.
Across the 1,961 Overture footprints in the campus survey bbox it produces doors
on **167 of them**, and **168 of the 274 named footprints over 400 m² get zero
doors**. Total output: **387 doors.** The brief asks for 600–900 on ~374
buildings. Path evidence alone cannot get there and no tuning of its thresholds
changes that — recall is flat from TERM_R 6 m to 12 m.

So the shipped method is **three stages, not two**: OSM truth, then path
derivation, then a *publicness field* that fills the remainder from the
walkable-surface network. Stage 3 is where most doors come from and it is the
part that most needs review.

---

## 1. Scope: which buildings are in

**Survey bbox** (what was queried and validated against, matching the brief):

```
30.2760, -97.7480, 30.2960, -97.7220     # s, w, n, e
```

That rect is not "campus". It contains West Campus apartments, the Capitol
Complex, the Bullock Museum and the Rio Grande Campus. Measured: 1,961 of the
2,453 Overture footprints, and **22 of the 91 OSM entrance nodes in it are not
on campus at all** (Robert E. Johnson State Legislative Building, Texas State
History Museum, Stephen F. Austin State Office Building, Rio Grande Campus).

**The campus filter that ships** — the rect bounded by Guadalupe, I-35,
MLK and the north edge of the Dean Keeton blocks:

```python
CAMPUS = (30.2795, -97.7420, 30.2930, -97.7255)   # s, w, n, e
MIN_AREA  = 250.0   # m² of footprint
MIN_H     = 4.0     # m of final_height
# and building_class != "roof"   (33 of these in the bbox — they are canopies)
```

Measured: **290 buildings**. 69 of the 91 OSM entrance nodes fall on one of
them, and those 69 are the honest validation set.

Widen to the full survey bbox and the same pipeline yields 749 buildings /
999–1,146 entrances. That is a one-line change (`CAMPUS`), so if Simeon wants
West Campus doors too it is not a rewrite.

### The building file, and the thing that will bite the bake author

`data/snapshots/2026-08-04/buildings.detailed.geojson`, 2,453 features. Its
`id` is an **Overture UUID**, not an OSM id, it has **no `ref` at all**, and
only 384 of 2,453 carry a `name`.

So `ref` and `nm` in the output schema have to come from a **spatial join to
OSM**, which this doc measured:

| join | result |
|---|---|
| OSM building ways in the bbox | 2,448 |
| joined to an Overture footprint (centroid-in-polygon, else nearest centroid < 20 m) | 1,716 (70%) |
| of the 379 OSM ways carrying `ref` or `name` — the ones we actually need | **337 (89%)** |
| centroid offset OSM → Overture | median **0.0 m**, p90 23.4 m |

170 OSM ways in the bbox carry the three-letter `ref` (PCL, MAI, JES, GRE…).
The 89% is the number that matters: the buildings with codes are the buildings
that join.

OSM also has **no `building:material` on a single one of the 2,448 ways** and
`start_date` on 5. **`mat` and `era` cannot be derived — they must be an
authored table keyed on `ref`.** Do not let a generator guess them.

---

## 2. The method

### Stage 1 — OSM entrance nodes are truth

Freshly queried 2026-08-04 over the survey bbox. **91 nodes**, not the 93 the
scout reported (OSM moved under us; use the number you fetch, and cache the
fetch):

| `entrance=` | n |
|---|---|
| yes | 57 |
| main | 17 |
| staircase | 8 |
| emergency | 6 |
| exit | 2 |
| parking | 1 |

Plus `door=hinged` on 11, `level=0` on 11 (no node is on any other level),
`wheelchair` on 3, `ref` on 1. **85 of the 91 are vertices of an OSM building
way**; 3 belong to two ways at once (shared party walls); 47 distinct hosts.

These get `src: "osm"` and their `role` straight off the tag. They are never
overwritten by a later stage.

**They already sit on the rendered wall.** Distance from each entrance node to
the nearest *Overture* footprint edge:

```
median 0.00 m   p75 0.00   p90 0.00   max 90.7
further than 5 m: 5 of 91      further than 10 m: 5 of 91
```

The nearest Overture edge belongs to the OSM host building for **77 of 81**
where both are known. Overture's campus footprints are OSM's footprints; the
snap is free. The five outliers are buildings Overture simply does not have.

### Stage 2 — derive from the footway network

`data/osm_cache/footways.json`, 3,430 ways with full geometry. Two generators:

1. **CROSSING** — a footway segment that intersects a footprint edge. The
   intersection point is the door. This is the generator that does the work.
2. **DEAD-END TERMINUS** — a way's first or last vertex, projected onto the
   nearest footprint edge within `TERM_R`, **but only if that vertex is a
   dead end in the footway graph** (node degree 1 across all 3,430 ways). A
   terminus shared with another footway is a path junction, not a door.

Then cluster per building at `CLUSTER_R`, then the normal gate (§3).

**The ablation, and it is the most useful table in this doc.** Recall is against
all 91 OSM entrance nodes at ≤ 8 m:

| configuration | doors | recall | median error |
|---|---|---|---|
| A — all footways, every terminus, no filters | 1,081 | 82% | 0.00 m |
| B — + drop `footway=crossing` (805 ways) and `highway=cycleway` (70) | 1,053 | 81% | 0.00 m |
| C — + dead-end termini only (drops 1,830 junction candidates) | **519** | **81%** | 0.00 m |
| D — + outward-normal approach gate (§3) | 387 | 78% | 0.00 m |

Row C is the good trade: **half the output for one point of recall.** Row D
costs three more points for another 132 doors' worth of precision; it ships
because a door facing the wrong way is a visible defect and a missing door is
not. Both are one-line switches.

`TERM_R` 6 / 8 / 12 m changes recall by less than one node. `CLUSTER_R` 4 → 5 m
changes it by none. **Neither is a tuning knob worth arguing about** — recall is
bounded by whether a path exists, not by how generously you snap to it.

### Stage 3 — the publicness field (this is the new part)

For every in-scope building that has not filled its door budget, score its
perimeter and take the best remaining points.

Build one segment set from every line a person can legitimately walk on —
**13,655 segments** measured:

| source | segments | weight |
|---|---|---|
| footways (`footways.json`, minus crossings and cycleways) | 9,260 | 1.0 |
| steps (`highway=steps`) | 210 | 1.4 |
| plaza edges (`plazas.json`, 44 pedestrian areas) | 782 | 1.2 |
| streets (`surfaces.json`, primary…pedestrian) | 2,935 | 0.7 |
| service roads (`highway=service`) | 468 | **−1.0** |

Sample the perimeter every `SAMPLE` metres. For each sample point with outward
normal **n**, score = `weight × (1 − d/APPROACH_R)` for the best segment within
`APPROACH_R` **that lies in the outward half-plane** (`n · v̂ ≥ 0.20`) — a path
on the far side of the building does not make this wall public. Take the highest
scores in order, rejecting any within `MIN_SEP` of a door already placed.

Service roads carry a negative weight, so a wall whose only company is a loading
drive scores below zero and never receives a door. Measured: **80 of the 749
buildings in the wide bbox have nothing but a service road in front of them.**

---

## 3. The frame: the outward normal, and the test that it is not backwards

Every piece of an entrance — leaves, frame, reveal, steps, rail, canopy — is
placed in the frame `(t, n)` of the host edge, where **t** is the edge direction
and **n** points out of the building. Get **n** backwards and the steps are
inside the lobby.

**Measured fact about this snapshot: all 2,455 rings in
`buildings.detailed.geojson` are wound counter-clockwise.** So for an edge
a → b the interior is on the LEFT and

```python
n = (dy, -dx) / |edge|        # dx,dy = b - a, on ring 0
n = -n                        # on any hole ring (index > 0)
```

**Do not trust that.** Assert it, every run, per candidate:

> **THE NORMAL TEST.** Step 0.5 m from the door point along `+n` and run a
> point-in-polygon against ring 0. It must come out **outside**. Fail the bake
> on any candidate that does not.

Run on the 1,293 stage-2 candidates: **1,264 pass, 29 fail (2.24%)**. The 29 are
real and they are not winding errors — they are candidates that land within
0.5 m of a concave corner or on a near-degenerate sub-metre edge, where a
half-metre probe re-enters the polygon. Handle them by rejecting the candidate,
not by flipping the normal.

The second half of the same test is stronger and it is what the stage-D gate
uses: **the approach must come from in front of the wall.** Take the end of the
approach segment that is outside the footprint, and require
`n · v̂ ≥ NORMAL_MIN`. Before the gate, only **60% of raw candidates agree**;
the other 40% are paths running *along* a wall and dying near it, which is a
sidewalk, not a door.

---

## 4. Validation, in full

Shipped configuration: campus rect, `MIN_AREA` 250 m², `MIN_H` 4 m, stage 2 at
row D, `P_PER_DOOR` 100 m, `NMAX` 8, `GARAGE_CAP` 2.

```
290 buildings in scope
614 entrances on 272 of them
      269 from a path (src osm / derived)
      345 from the publicness field (src derived)
       18 buildings get none — see §6
per building: median 2   mean 2.1   p90 4   max 10

recall of the 69 in-scope OSM entrance nodes
  <= 3 m   53   77%
  <= 5 m   53   77%
  <= 8 m   54   78%
  <= 12 m  56   81%
median position error 0.00 m      p75 0.0 m
```

**Recall by role**, on the full 91 at ≤ 8 m (stage 2, row C, so the ceiling of
the geometric method by itself):

| role | recovered |
|---|---|
| main | 15 / 17 |
| yes | 44 / 57 |
| staircase | 7 / 8 |
| emergency | 5 / 6 |
| exit | 2 / 2 |
| parking | 1 / 1 |

The celebrated ones are the ones it gets right: **15 of 17 `entrance=main`.**

### The 20 that miss, named

Because "78%" is not a finding until you know what the other 22% is.

**Five are unplaceable and always will be** — the entrance node is 28–69 m from
*any* Overture footprint, because Overture has no building there: Robert E.
Johnson State Legislative Building (×2), Wahrenberger House, and two unnamed.
All five are outside the campus rect anyway.

**Fifteen sit exactly on a wall (`d_wall` 0.0 m) but the nearest derived
candidate is 9–76 m away.** Named: Main Building (9 m), Moody Center (12 m),
Red McCombs Red Zone (×3, 40–48 m), Bellmont Hall (58 m), Norman Hackerman
(76 m), Jackson Geological Sciences (38 m), Mezes (31 m), Doty Fine Arts (14 m),
Carothers (16 m), Almetris Duren (15 m, `emergency`), East Campus Garage (20 m),
Jester West (13 m), Engineering Teaching Center II (9 m).

They share one cause: **the door opens onto a plaza, a mall or a stadium
concourse, which OSM draws as an AREA, not as a line that terminates at the
wall.** Nothing in stage 2 can see a polygon. Stage 3 fixes it structurally
(plaza edges are in the field at weight 1.2), but it fixes the *wall*, not the
exact node — which is why the shipped recall is 78% and not 95%.

**If the bake author wants those fifteen exactly right, the cheap route is to
carry the 91 OSM nodes through verbatim (stage 1 already does) and treat this
number as what happens to buildings OSM has not mapped.** The 78% is a measure
of the *derivation*, not of the shipped file — every one of the 91 is in the
output regardless, because stage 1 runs first.

### Precision cannot be measured, and saying otherwise would be a lie

The obvious check — "what fraction of derived doors is within 8 m of a known
entrance" — returns **28%**, and that number is meaningless. OSM's median host
carries **1** mapped entrance. Gregory Gym has 1 in OSM and manifestly has more
than one door. Measuring precision against a source that under-maps by a factor
of three measures the source.

**What can be measured is the no-door tests (§6), and they are what the review
should look at.**

---

## 5. How many entrances per building

**What OSM says**, on its 44 joinable mapped hosts, binned by footprint
perimeter:

| perimeter | n | mean OSM entrances | max |
|---|---|---|---|
| 0–150 m | 6 | 1.0 | 1 |
| 150–250 m | 13 | 1.7 | 5 |
| 250–400 m | 17 | 2.6 | 6 |
| 400–700 m | 8 | 1.4 | 3 |

The 400–700 bin **falls**, which is not architecture, it is mapping effort:
that bin is Gregory Gym (1), Moody Center (1), Bellmont (1), the garages.
Fitting a curve to this data would encode OSM's fatigue.

**So the rule is perimeter-per-door, chosen to match the well-mapped middle of
the range and then held constant:**

```python
n_entrances = clamp(round(perimeter / P_PER_DOOR), 1, NMAX)
P_PER_DOOR = 100.0    # m of facade per entrance
NMAX       = 8
```

which gives 1 door at 150 m of perimeter, 2 at 250 m, 4 at 400 m, 6 at 570 m,
8 at 800 m+. Sweep, over the 290 in-scope buildings:

| `P_PER_DOOR` | total entrances |
|---|---|
| 80 m | 702 |
| **100 m** | **614** |
| 120 m | 548 |
| 150 m | 507 |

100 m lands in the brief's 600–900 band at its low end, which is the right side
to err on: a stage-3 door is an inference and 345 of them is already most of the
file.

**What it produces on the buildings that matter.** `budget` is what the rule
asks for; `placed` exceeds it where OSM/path evidence already gave more, because
truth is never deleted to satisfy a budget:

| building | perimeter | budget | placed | sources |
|---|---|---|---|---|
| Main Building / UT Tower (`MAI`) | 421 m | 4 | **10** | all path |
| Battle Hall (`BTL`) | 155 m | 2 | 2 | 1 path, 1 public |
| Sutton Hall | 173 m | 2 | 2 | 1 path, 1 public |
| Goldsmith Hall | 236 m | 2 | 2 | public |
| Texas Union (Union Building) | 431 m | 4 | 4 | 2 path, 2 public |
| Gregory Gym | 463 m | 5 | 5 | 1 path, 4 public |
| Perry-Castañeda Library | 392 m | 4 | 4 | 1 path, 3 public |
| Jester East / West | 570 / 500 m | 6 / 5 | 8 / 5 | path-led |
| Welch Hall | 541 m | 5 | 5 | path |
| Gates Computer Science | 376 m | 4 | 6 | path |
| Moody Center | 478 m | 5 | 5 | 1 path, 4 public |
| Blanton Museum | 281 m | 3 | 3 | path |
| Harry Ransom Center | 244 m | 2 | 3 | path |
| Littlefield House | 104 m | 1 | 1 | path |
| Waggener Hall | 169 m | 2 | 6 | path |

**Two rows to review before anything else.** The Main Building at **10** is the
highest count in the whole file and every one of the ten is path-derived — the
South Mall front, the Tower base and the four wings really do have that many
doors, but ten is where a budget stops meaning anything, and if `NMAX` should
bite it should bite here. Waggener at 6 on a 169 m perimeter is the other:
OSM maps 5 entrances on it, so the derivation is agreeing with a mapper who was
unusually thorough, and it is probably right.

Note the Overture `name` for `MAI` is **"UT Tower"**, not "Main Building", and
`BAT` is Batts Hall while Battle Hall is `BTL`. Match on `ref`, never on name.

---

## 6. Not putting a door where there is none

Four tests, in the order they fire. Each is a named constant.

**1. The service-road sign test.** `highway=service` enters the publicness
field at **weight −1.0**. A wall whose only approach is a loading drive scores
negative and is never selected. 468 service segments; 80 of 749 buildings in
the wide bbox have no other approach.

**2. The outward half-plane test.** A sample point only sees segments with
`n · v̂ ≥ 0.20`. A path on the far side of a building, or one running parallel
to this wall, contributes nothing. This is what kills blank walls facing alleys:
they score 0 and there is nothing to select.

**3. The parking cap.** A garage's ramp is a vehicle entrance, not a door.

```python
GARAGE_CAP = 2   # pedestrian doors, regardless of perimeter
```
Triggered by `building=garage|parking`, `amenity=parking`, `building_class ==
"parking"`, or `garage`/`parking` in the name. Measured: 7 parking structures in
the campus rect, **15 entrances placed on them** rather than the ~30 perimeter
alone would ask for. San Jacinto Garage and East Campus Garage both have real
pedestrian doors in OSM, so zero would be wrong.

**4. Nothing wins, so nothing is placed.** The pipeline is allowed to output a
building with no entrance. **18 of the 290 do**, and the list is the test
passing:

> Chilling Station No. 4 · Cooling Tower 1 · Computational Resource Building ·
> an unnamed 2,210 m² stadium structure · and fourteen unnamed sheds between
> 254 and 519 m², all under 6 m tall.

Those are plant. They should not have celebrated entrances and they do not have
any. **If a review finds a real building in that list, the publicness weights
are wrong — that is the failure mode to watch.**

---

## 7. Ground height, and the answer is "there is none"

**The repo knows nothing usable about terrain, and that is deliberate.**

- `js/app.js:333` — terrain is explicitly disabled: *"it culled buildings and
  made them float on slopes (see HANDOFF §7.4). Slope is deprioritised."*
- `js/ground.js:1384` — *"There is no terrain in this scene — no DEM, no
  MapLibre terrain source"*, and the comment goes on to rule campus-wide terrain
  out of scope because a sunk surface would need every building base raised.
- `js/controls.js:32` — every camera height in the app assumes
  `transform.elevation === 0`.

The one elevation signal in the data is OSM `ele` on **81 of 2,448** building
ways, spread 154–187 m (33 m across the bbox, median 174 m). It is real, it is
sparse, and **using it would make 81 buildings float and 2,367 sit on zero.**
Do not use it.

**So: a constant, and it is already chosen elsewhere in the repo.**

```python
GROUND_Z   = 0.22   # = GROUND.pathRaise (js/ground.js:53)
                    # = FLIGHT_BASE (scripts/bake_depth.py:163)
FLOOR_RISE = 0.55   # m; ground floor above the path slab. TASTE.
```

`GROUND_Z` is not a taste value — it is the top of the paved-path extrusion the
ground pass already draws, and `bake_depth.py` already sets `FLIGHT_BASE` to
exactly it "or the bottom treads are swallowed". Any entrance step course starts
at 0.22 or it sinks.

`FLOOR_RISE` **is** taste, and it is the single most visible number in the pass:
it decides how many steps every entrance gets. 0.55 m with `FLIGHT_RISER` 0.17
is a three-riser stoop, which is the Cret/Gilbert default on this campus. Set it
to 0 and a building sits flat on the plaza.

**Which entrances actually get stairs, from data rather than taste.** OSM's 189
`highway=steps` ways: **87 of them (46%) end within 12 m of a derived door.**
Of the 189, 60 carry `handrail=yes`, 80 carry `incline`, and 9 carry
`step_count` — values `3, 3, 4, 4, 5, 7, 12, 21, 21`, **median 5**. 86 footways
in the bbox are tagged `ramp` or inclined.

So: an entrance with a steps way at its foot gets a real flight, sized by
`step_count` where present and by 5 risers where not; it gets a rail if that way
says `handrail=yes`; and 46% of entrances having one is a plausible campus, not
a guess. Everything else gets the `FLOOR_RISE` stoop.

**Reuse `scripts/bake_depth.py`'s stair vocabulary. Do not invent a second one:**
`STEP_NOSING` 0.35 · `STEP_NOSING_FRAC` 0.35 · `STEP_LIFT` 0.03 ·
`FLIGHT_RISER` 0.17 · `FLIGHT_TREAD` 0.42 · `FLIGHT_RISE_MAX` 1.10 ·
`FLIGHT_LANDING_M` 0.6 · `FLIGHT_BASE` 0.22.

`FLIGHT_RISE_MAX` 1.10 is a guard that already stopped one pass shipping a 3 m
staircase. Keep it.

---

## 8. The taste block the bake must expose

CLAUDE.md rule 11. Every one of these is a module-level constant with a comment,
none of them buried in a function. Values below are what the measurements above
were run with.

```python
# ── SCOPE ──────────────────────────────────────────────────────────
CAMPUS       = (30.2795, -97.7420, 30.2930, -97.7255)  # s,w,n,e
MIN_AREA     = 250.0    # m² of footprint to be worth a door
MIN_H        = 4.0      # m; under this it is a shed

# ── PLACEMENT ──────────────────────────────────────────────────────
TERM_R       = 8.0      # m; how far a dead-end path may sit off a wall
CLUSTER_R    = 5.0      # m; two candidates this close are one entrance
NORMAL_MIN   = 0.25     # cos; how squarely a path must face the wall
APPROACH_R   = 22.0     # m; publicness reach
SAMPLE       = 2.0      # m; perimeter scoring step
MIN_SEP      = 14.0     # m between two entrances on one building
P_PER_DOOR   = 100.0    # m of facade per entrance
NMAX         = 8        # cap, even on Jester
GARAGE_CAP   = 2        # pedestrian doors on a parking structure
W_FOOT, W_STEPS, W_PLAZA, W_STREET, W_SERVICE = 1.0, 1.4, 1.2, 0.7, -1.0

# ── VERTICAL (see §7) ──────────────────────────────────────────────
GROUND_Z     = 0.22     # NOT taste — matches GROUND.pathRaise
FLOOR_RISE   = 0.55     # m; ground floor above the path. Taste, and loud.
DEFAULT_RISERS = 5      # when a steps way has no step_count

# ── THE ASSEMBLY — every one of these is a one-line override ───────
DOOR_H       = 2.44     # m, leaf height
DOOR_W       = 0.92     # m, leaf width
PROUD        = 0.10     # m the frame stands out of the wall (cf. bake_places PROUD 0.30)
REVEAL_D     = 0.22     # m the door face is recessed behind the wall
GLASS_INSET  = 0.04     # m glazing sits behind its frame
FRAME_W      = 0.09     # m stile/rail width
TRANSOM_H    = 0.60     # m over the head
SURROUND_W   = 0.35     # m of limestone either side, Gilbert/Cret door surround
RAIL_H       = 0.95     # m
RAIL_D       = 0.05
CANOPY_PROJ  = 1.80     # m (cf. bake_places AWN_PROJ 1.30 — a canopy is deeper)
CANOPY_T     = 0.30
RAMP_SLOPE   = 1/12.0
```

Materials are a `ref`-keyed authored table, per §1 — OSM has zero
`building:material` on this campus and inference would be invention.

---

## 9. The output schema, restated so the bake author has one place to look

`data/entrances.geojson`. **One feature per PIECE of an entrance assembly, not
one per entrance** — `fill-extrusion-pattern` is tile-locked and every band
needs its own `base`/`h`. This is the same trap `scripts/bake_places.py`
documents; do not re-learn it.

| property | meaning |
|---|---|
| `k` | piece kind: `door` · `frame` · `glass` · `transom` · `surround` · `reveal` · `step` · `rail` · `canopy` · `ramp` · `sign` · `column` |
| `eid` | entrance id — groups every piece of ONE entrance |
| `bid` | host building id, from `buildings.detailed.geojson` (an Overture UUID) |
| `ref` | three-letter code, e.g. `"PCL"` — `null` if unknown (89% coverage on named/ref'd buildings, §1) |
| `nm` | building name — `null` if unknown |
| `role` | `main` · `secondary` · `service` · `emergency` · `exit` |
| `era` | `gilbert` · `cret` · `midcentury` · `modern` · `utility` |
| `n` | door LEAF count for this entrance |
| `dt` | `single` · `hinged-pair` · `hinged-quad` · `revolving` · `sliding` · `overhead` · `arched-pair` |
| `mat` | `limestone` · `brick` · `bronze` · `aluminium` · `glass` · `steel` · `concrete` · `terracotta` · `wood` |
| `base` | metres above local ground for the BOTTOM of this piece |
| `h` | height of this piece, metres |
| `wd` / `wg` / `wn` | day / golden / night hex |
| `src` | `osm` · `derived` · `authored` — provenance, and it is not decoration: it is how anyone later tells a measured door from an inferred one |

**`src` is load-bearing given §4.** 269 of the 614 shipped entrances trace to a
path or an OSM node; 345 are inferred from the publicness field. Anyone
reviewing this file needs to be able to select on that, and any later pass that
wants to trust only measured doors needs it too.

### And the structural rule that makes this pass composable

Copied from `bake_places.py` and it is not optional: **every piece stands PROUD
of the host wall and the pass claims NO building ids.** `replacedBuildingIds`
stays empty. Six passes land on this repo and one that only ever adds geometry
in front of a wall cannot collide with `facades.js`, `drag.js`, `westcampus.js`
or `heroes.js`, whether or not they have already rebuilt the wall behind it.
`js/entrances.js` should self-register via `map.addSource`/`map.addLayer` the
way `js/places.js` does, so `js/app.js` needs no edit.

---

## 10. What did not work, and what was not attempted

1. **Recall does not respond to threshold tuning.** `TERM_R` 6 → 12 m moved
   recall by under one node in every configuration tried. The ceiling is
   whether a footway exists, not how far you reach for it. An hour spent
   sweeping these is an hour wasted; the fix was a new generator (stage 3).
2. **The first recall run reported 20% and was a bug, not a finding.** A
   `nearest_derived(...) or 1e9` treated an exact hit — distance `0.0`, which is
   falsy in Python — as "no candidate". The by-role breakdown printed 80% in the
   same run and the disagreement is what caught it. **Two independent statistics
   over the same data are worth the eight lines they cost.**
3. **Precision was measured, is 28%, and is not reported as a result** (§4).
   Against a source whose median building carries one mapped entrance, it
   measures OSM.
4. **OSM `ele` was investigated as a terrain source and rejected** (§7): 81 of
   2,448 buildings, and using it makes those 81 float above a flat city.
5. **`era` and `mat` were not derived and cannot be.** Zero
   `building:material` and five `start_date` across 2,448 OSM ways. Authored
   table keyed on `ref`, or nothing.
6. **The campus polygon was not used as the scope filter.** OSM relation
   1701848 *University of Texas at Austin* exists but runs to latitude 30.397 —
   it includes the Pickle Research Campus, seven kilometres north. A rect is
   both more honest and a one-line override.
7. **No render, no screenshot, no browser.** There is nothing drawn yet. Every
   number here is geometric, and the first thing the bake author should do —
   per `scripts/verify/README.md` and the reference-to-generator method — is
   build the render → pixel-sample → assert harness before drawing the second
   entrance, and confirm it is sampling the entrances layer and not the wall
   behind it.
