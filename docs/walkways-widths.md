# Every walk in this city was 2.4 metres wide

Acer lane `acer/cd-walkways`, 2026-08-27. Round 2, built on round 1
(`docs/walkways-on-the-real-paths.md`).

**The reviewer of round 1 named the gap and named it correctly: *"every footway
in this city is stamped with the same flat 2.4 m width regardless of whether
it's a service alley behind a dorm or a mall approach carrying thousands of
students... this is the facade-template defect one level up."* It is fixed for
the 782 walks a real survey can measure, and honestly refused for the rest.
`DEFAULT_WIDTH` is now the fallback, not the answer.**

```
before   every drawn walk               2.4 m       0 of 3,098 campus footways
                                                    carries an OSM width tag
after    782 walks measured, 1.0 - 10.4 m           74 % of them more than
         (44.6 % of all drawn walk metres)          0.5 m off the template
```

The source is not a photograph. Round 1 proved a photograph cannot do this
(§6b: the perpendicular profile of 8,822 stations across every campus footway
at 0.30 m/px is flat, because most campus walks have no pavement/grass edge to
find). The source is **the City of Austin's planimetric impervious-surface
survey** — real digitised polygons of the actual paved slab, one per slab, each
carrying the year of the orthophotography it was traced off. A survey sees
through live oak; a summer aerial does not.

Confidence marks follow the house convention: **[M]** measured here, **[D]**
derived from an [M] by a stated argument.

---

## 1. The picture, first

Same camera, same everything, `data/ground.geojson` swapped underneath —
`scripts/verify/walkwidth.mjs --shots`, near-nadir, trees hidden, screenshot
twice and the second kept.

| | |
|---|---|
| `docs/shots/walkwidths-southmall.jpg` | The South Mall approach past Parlin Hall. **2.40 m → 5.60 m drawn**, against 5.50 m surveyed. |
| `docs/shots/walkwidths-westcampus.jpg` | A West Campus service walk. **2.60 m → 1.40 m drawn**, against 1.35 m surveyed. It got NARROWER, which is half the point. |
| `docs/shots/walkwidths-drag.jpg` | The Drag sidewalk on Guadalupe. **2.50 m → 5.50 m drawn**, against 5.85 m surveyed. |

Two walks a hundred metres apart, one four times wider than the other, and
until this round the city drew them the same. **[M]**

---

## 2. THE SOURCE, and what it is not

`https://services.arcgis.com/0L95CJ0VTaxqcmED/ArcGIS/rest/services/`
`impervious_cover_2023/FeatureServer/0`, `FEATURE IN ('Sidewalk', 'Pavement',
'Courtyard', 'Trail')`, over the bounding box of `data/osm_cache/footways.json`
itself so the survey cannot run out before the walks do. **10,571 polygons.**
**[M]** City of Austin open data is public domain — the City publishes it free
and without restriction. The exact query, the licence and the fetch date are
recorded in `data/walkway_widths.json`; the 16 MB extract itself is a
regenerable input and lives in `data/gis_cache/`, which `.gitignore` now
covers. The committed artifact is the verdict, not the survey.

It is **not** derived from OpenStreetMap, which matters: round 1's paths metric
A ("drawn walkway within 5 m of a fresh OSM way") is honest about being a check
on the bake rather than on the map, because both ends trace to the same
upstream. This one does not. Every polygon carries a `SOURCE` field naming the
orthophotography year it was digitised from — 2013, 2015, 2017, 2019, 2021 and
2023 are all present in this extract. **[M]**

Deliberately **not** in the walking-surface set: `Paved Parking`, `Paved Road`,
`Paved Driveway`, `Bridge`, `Patio`. A footway crossing a car park is on
pavement, but the car park's width is not the walk's width, and measuring it
would be worse than not measuring.

---

## 3. The rule, and the one thing it refuses to do

Station the OSM centreline every `WIDTH_STATION_M = 4` m, ignoring
`WIDTH_TRIM_M = 2` m at each end because a junction is a blob. At each station
march perpendicular both ways in `WIDTH_STEP_M = 0.20` m steps, bisecting the
last step to `WIDTH_BISECT_M = 0.05` m, until the surveyed pavement ends. The
way's width is the **median** of its stations.

**A station only counts if BOTH marches found an edge inside
`WIDTH_HALF_MAX_M = 6` m.** Inside a continuous paved court there IS no edge —
the court is the surface — and this file must not invent a corridor width for
it. That is not a tuning choice, it is the same finding round 1 reached from
the photograph and it is why the naive version fails: with "any pavement counts
as inside" and no edge requirement, Speedway came back at the 16 m search cap
against the 30 ft (9.14 m) this repo already has from Public Works' own project
record. **[M]** The edge requirement is what makes the measurement mean
something.

What may reach the bake, all of it one line each in the script (CLAUDE.md
rule 11):

```
WIDTH_MIN_EDGED     0.60   share of stations that must find BOTH edges
WIDTH_MIN_STATIONS  2      and at least this many of them
WIDTH_MIN_LEN_M     6.0    shorter ways are junction stubs
WIDTH_MIN_M         0.90   narrower is a digitising sliver
WIDTH_MAX_M        12.0    wider is a plaza wearing a walk's name
```

---

## 4. What it found

```
3,430 OSM ways in data/osm_cache/footways.json
  782 measured  (23 % of ways, 71,475 m of 160,363 m = 44.6 % of drawn walk)

  p10 1.4   p25 1.7   median 2.4   p75 3.5   p90 4.5   max 10.4 m
  578 of 782 (74 %) more than 0.5 m from the 2.4 m default
```
**[M]** The median lands on 2.4 m, so whoever chose that default chose a good
*average*. What was missing was never the average. It was the spread: 34 walks
at a metre, 191 at a metre and a half, and a tail out to ten.

In the bake, **745 line-ways take a measured width** (the other 37 rows belong
to mapped pedestrian AREAS and crossings, which are not centrelines to widen),
**558 of them move more than 0.5 m — 282 wider and 276 narrower.** **[M]** That
balance is worth stating plainly: this is not a change that makes the city
bigger, it is a change that makes it uneven, which is what it really is.

### Why the other 2,648 got nothing

```
1,603  the city's survey maps no walking surface under it   <- §5, and it is NOT a missing walk
  353  no station found an edge on both sides               (inside a continuous paved court)
  337  shorter than WIDTH_MIN_LEN_M
  235  under WIDTH_MIN_EDGED of stations found both edges
  118  fewer than WIDTH_MIN_STATIONS counted stations
    2  narrower than WIDTH_MIN_M
```
**[M]**

---

## 5. THE COVERAGE GAP, and why it is never allowed to narrow anything

**46.7 % of ways — 37.5 % of the drawn walk metres — sit on nothing the city's
survey calls a walking surface.** The tempting reading is "those paths are
wrong". It is the wrong reading, and it was put to a photograph rather than
argued.

`docs/shots/walkwidths-coverage-gap.jpg` is OSM way `129347372` in magenta with
**every** Austin planimetric paved polygon in view outlined in green, over real
USGS NAIP orthoimagery at 0.30 m/px. The line runs straight down a wide,
obviously paved court between two buildings and the city maps **nothing** under
it. Way `1317394733` is the same story. **[M]** The city's impervious mapping
is thorough on street frontage and thin over UT's own interior.

Before blaming the reader, twelve of those off-pavement midpoints were sent
back to the FeatureServer as point-intersect queries and compared with this
script's own point-in-polygon: **12 of 12 agree.** **[M]** Where anything is
mapped at all under an off-pavement way it is `Structure` (an arcade or a
breezeway — the walk really does go through a building), `Paved Parking`,
`Bridge`, or `Unpaved Road`.

So `data/walkway_widths.json` is **strictly opt-in**, exactly like the entrance
survey in `bake_entrances.py`: a way with no row keeps `DEFAULT_WIDTH` and is
marked unsourced. **It may say "this walk is 1.4 m wide". It may not say "there
is no walk here".** Nothing in this round deletes, moves or narrows a path for
want of evidence.

---

## 6. Four instruments, and the one that had to go red first

### a) The gate, watched failing

`python scripts/trace_walk_widths.py --selftest` — three slabs of a width
chosen by construction, a court that must refuse to answer, and three real
campus walks whose width was read off NAIP at 0.30 m/px with the transect drawn
on the picture:

```
  a 1.5 m slab measures 1.50 m                             ok
  a 2.4 m slab measures 2.40 m                             ok
  a 6.0 m slab measures 5.95 m                             ok
  a walk inside a 200 m paved court measures nothing       ok
  way 1020963716  a narrow walk by a car park   1.45 m in [1.1, 1.9]   ok
  way 129347386   an ordinary campus walk       2.41 m in [2.0, 2.9]   ok
  way 1199982735  a walk on a wide paved apron  5.28 m in [4.4, 6.6]   ok
  PASS
```

`--break` does not disable the marcher, it **reinstates the defect**: the
marcher stops at a fixed 1.2 m either side, so every walk comes out 2.4 m, and

```
  a 1.5 m slab measures 2.40 m                             FAIL
  a 6.0 m slab measures 2.40 m                             FAIL
  a walk inside a 200 m paved court measures 2.40 m        FAIL
  way 1020963716  ... 2.40 m in [1.1, 1.9]                 FAIL
  way 1199982735  ... 2.40 m in [4.4, 6.6]                 FAIL
  --break: 5 of 7 assertions went red, as they must
```
**[M]** Two stay green, and they should: a 2.4 m slab really is 2.4 m wide.

### b) DID THE NUMBER REACH THE CITY — the bake trap, checked

A number in a JSON file is not a wider walk. `scripts/verify/walkwidth.mjs`
drives the real page, hides the trees, points a near-nadir camera at four
targets and walks outward **in render space**, asking the map at each screen
pixel whether a `k:'patharea'` polygon is drawn there. It reads the target
widths out of the *served* `data/walkway_widths.json`, never off disk and never
typed into the script, so it cannot drift from the evidence.

| way | the survey | drawn, BEFORE | drawn, AFTER |
|---|---:|---:|---:|
| 1216105912 a narrow service walk | 1.35 m | 2.60 m ✗ | **1.40 m** ✓ |
| 1058218049 a narrow campus walk | 1.70 m | 2.50 m ✓ | **1.80 m** ✓ |
| 126328774 a wide South Mall approach | 5.50 m | 2.40 m ✗ | **5.60 m** ✓ |
| 1120921416 a wide walk on the Drag | 5.85 m | 2.50 m ✗ | **5.50 m** ✓ |

**[M]** `FAIL — 3 of 4` on the old bake, `PASS` on this one, from the same
script in the same browser against the same evidence file. That table *is* the
template defect, measured on the rendered city rather than described.
`node walkwidth.mjs --break` hides the ground layers and all four go red.

### c) The photograph, via the repo's own scoreboard

`campusmeter.mjs`'s paths metric B samples the ring vertices of every drawn
walkway polygon against real USGS NAIP orthoimagery and counts the ones landing
on vegetation. It is the harshest instrument in the file and this lane did not
write it.

```
paths B   105 of 624 on vegetation  (16.8 %)   ->   83 of 625  (13.3 %)
```
**[M]** A fifth of the drawn walkway points that had no paved surface under
them in the real photograph no longer do. Round 1 measured that roughly seven
eighths of that number is live oak over a real path rather than a path in a
lawn (§6a), so this is the open-turf share shrinking, which is the only part of
it that was ever a defect.

Paths metric A is unchanged at **624 of 625 within 5 m** (median 1.2 → 1.1 m),
and its p90 moves the other way, 1.2 → 1.4 m. That is not a regression and it
should be said out loud: metric A measures ring VERTICES, and a wider ribbon
puts its vertices further from the centreline the metric compares against. A
5.5 m walk is 2.75 m off its own centreline by construction. **[D]**

### d) The city's own width attribute, reported and not leaned on

`TRANSPORTATION_sidewalks` — a different City of Austin dataset, an asset
inventory rather than a planimetric trace — carries a `WIDTH` column in feet.
Measured against it on 246 segments where both exist:

```
declared 3 ft (0.91 m)  ->  measured median 1.50 m      n=47
declared 4 ft (1.22 m)  ->                  1.54 m      n=22
declared 5 ft (1.52 m)  ->                  1.95 m      n=93
declared 6 ft (1.83 m)  ->                  3.15 m      n=82
median error +0.60 m, MAE 0.89 m
```
**[M]** Monotonic, and biased wide. **The reason this is a weak instrument and
is not being leaned on: 33 % of those sidewalk polylines do not lie on the
paved polygon at all** — the asset layer's geometry is schematic, so a third of
the comparison is measuring whatever the line happened to land on. **[M]**
Reported because it exists and points the right way, not because it settles
anything.

---

## 7. The router's record is untouched, and here are all four numbers

`data/walk_graph.json` is **byte-identical** — this round changed the painted
pavement, not the routing network, and the two are separate files with separate
bakes. `scripts/verify/walkmeter.mjs`, 20 pairs, real page on `serve.py 8825`:

| | round 1 | this round |
|---|---:|---:|
| A. extra metres over the pairs it makes worse | 2.0 m | **2.0 m** |
| A. signed total | −541.4 m | **−541.4 m** |
| B. ends at the door UT publishes | 38 / 38 | **38 / 38** |
| self-check drift | 0.00 m | **0.00 m** |
| live UI gate (a real mouse on the checkbox) | PASS | **PASS** |

**[M]** (Round 1 moved this record from the 87.0 m / −393.7 m the brief quotes
to 2.0 m / −541.4 m, by re-deriving thirty ground-truth door indices that a
re-bake had silently invalidated — see `docs/walkways-on-the-real-paths.md` §2.
2.0 m / −541.4 m is the number this round inherited and the number it kept.)

`python scripts/bake_ground.py --walkaudit`, 20 pairs, 1 m sampling, zero
tolerance, no browser:

| | before | after |
|---|---:|---:|
| drawn metres over the twenty | 12,828 | 12,828 |
| **on a drawn WALK** (`k:'patharea'`) | 96.55 % | **96.60 %** |
| on any drawn surface | 98.37 % | **98.42 %** |
| over bare ground | 1.63 % (209 m) | **1.58 % (203 m)** |

**[M]** Six metres of real
walking moved off bare ground and onto a drawn walk. It is a small number and
it is reported as small — the route was already 96.5 % covered — but it moves
in the right direction while 276 walks were made *narrower*, which is the
result worth having.

---

## 8. The question the brief asked: data problem, or routing problem?

> *"an earlier round found many campus sidewalks were 'not being utilized
> properly' — real paths that exist in the data and the router ignores. Find
> out whether that is a data problem or a routing problem before adding new
> geometry."*

Round 1 answered one half (plaza interiors were in the graph as a ring of edges
with nothing across the middle — a data problem, and 1,573 photograph-confirmed
chords fixed it). Here is the other half, measured on the shipped graph.

```
219,041 m of walking network, 13,751 edges, 48 components
   5,647 m  (2.6 %) in 47 ISLANDS the router cannot reach at all
   1,151 m  of that, 28 islands, inside the campus core bbox
```
**[M]** And the diagnostic that says what kind of problem it is — how far each
island sits from the main network:

```
within  2 m of the main network:   0 islands
within  5 m:                        0 islands
within 10 m:                        3 islands,   387 m
within 20 m:                       15 islands,   611 m
within 50 m:                       33 islands, 1,420 m
the largest island: 1,825 m of walkway, 118 m from anything
```
**[M]** **Not one island is within five metres of the main network**, so this is
not a snapping-tolerance bug that a larger epsilon would close — `bake_walk.py`
already runs a snap stage (63 candidates, 8 accepted, components 59 → 48). The
gaps are 10 to 278 m of genuinely unmapped connection: a walk that ends at an
unmapped crossing, a flight of steps nobody has drawn, a service drive. **It is
a DATA problem, upstream, in OpenStreetMap — and bridging a 118 m gap with
invented geometry is exactly the thing this project does not do.** It is
written down in §10 as the next lane's, with the number attached.

---

## 9. What this pass did NOT do

* **No walking-graph change.** `data/walk_graph.json` byte-identical, checked.
  `WAYFIND.on` still `false` and untouched.
* **No desire paths.** Round 1's answer was zero on a photograph, pushed hard
  (§5 there), and nothing here changes the evidence. `desire_paths` is still an
  empty array that the bake reads every run.
* **No path MOVED.** Every centreline is where OSM put it and where round 1
  measured it at a median 1.2 m from a freshly-fetched OSM extract. Only the
  width of the ribbon drawn over it changed.
* **No entrance, facade or building change.** campusmeter's other four lines
  are byte-identical: entrances A 74/181 B 69/516, eras 301/591, shelter 19/22,
  facades 0/7.
* **No perf measurement.** `data/ground.geojson` grew 5.47 → 5.50 MB; that is
  reported as a size, not as a cost, because sibling lanes were live on this
  machine and a frame time taken tonight would be a lie.
* **No width for steps drawn as areas, or for mapped pedestrian areas.** Those
  are polygons already; they are the thing itself, not a centreline standing in
  for it.

## 10. Still wrong, and named

1. **The biggest one: 55 % of drawn walk metres are still on the 2.4 m
   template**, and the largest single reason (37.5 % of metres) is that the
   City's survey does not cover UT's interior. Closing it needs a different
   source — UT's own facilities GIS, or leaf-off orthophotography at 0.15 m/px
   or finer, which the City flies and which is a real, reachable next step. NOT
   another pass at summer NAIP; round 1 already proved that road is closed.
2. **5,647 m of real surveyed sidewalk that the router cannot reach**, §8. Not
   fixable by tolerance, and not fixable by inventing geometry.
3. **The measured width is the PAVED SLAB, which is not always the walk.** A
   walk running along the edge of a paved apron measures as wide as the apron —
   way `1199982735` at 5.28 m is a real case, correct as pavement and arguably
   wrong as a walk. `WIDTH_MAX_M = 12` bounds the damage; nothing distinguishes
   the two cases today.
4. **Widths are per WAY, not per metre.** A walk that genuinely narrows halfway
   along gets one median. `lo`/`hi` (the station quartiles) are recorded in
   `data/walkway_widths.json` for whoever wants to do it properly.
5. **The city attribute cross-check is weak** and §6d says exactly how weak.

## 11. Files

```
scripts/trace_walk_widths.py     NEW. owns data/walkway_widths.json
data/walkway_widths.json         NEW. 782 measured widths, 91 KB
scripts/bake_ground.py           +64 lines: load_measured_widths(), the lookup,
                                 MW=0 control arm, four stats counters
data/ground.geojson              re-baked; 745 line-ways take a measured width
scripts/verify/walkwidth.mjs     NEW. asserts the width reached the RENDER
.gitignore                       data/gis_cache/ (the 16 MB survey extract)
docs/shots/walkwidths-*.jpg      the five frames this file cites
```
