# The roads pass — classification, bike lanes, and the Speedway brick

> "also more accurate roads? bike lanes for roads that have them?"
> "TUrn speedway into the yellow brick road thing its supposed to be."

The previous pass (`07c9e3c`, `docs/GROUND_TEXTURE.md`) fixed the road *tone*: it
took the basemap's road lines over, hid them, and redrew them off the same vector
tiles in the `asphalt` colour with a width per OpenMapTiles `class`. Nothing here
undoes that. The palette, the casing, the service-road zoom fade, the lane-marking
rule and the pale-paving trap all survive intact and are re-measured at the end.

What changes is where the roads come from, because the tiles cannot carry this ask.

---

## 1. Why the basemap tiles had to go

`scripts/verify/road-probe.mjs` established what the Liberty basemap's
`transportation` source-layer holds: `class`, `subclass`, `oneway`, `ramp`,
`brunnel`. That is the complete list. In particular it has

| missing | consequence |
|---|---|
| `lanes` | width can only be guessed per class — a 2-lane San Jacinto and a 5-lane MLK are both `secondary` |
| `cycleway*` | **a bike lane cannot exist even in principle** |
| `name` | Speedway cannot be told from San Jacinto |
| `surface` | East MLK's concrete carriageway has to be drawn as asphalt |

So `scripts/fetch_roads.py` asks OSM directly, over the **outer-ring** bbox
(`30.240,-97.788 → 30.315,-97.702`) rather than the detail bbox, because the
camera flies at 200–900 m and sees several km — clipping arterials to the
2.9 × 2.2 km detail box would end Guadalupe at a hard edge in mid-frame.

What came back, over that bbox:

```
roads      12,124 ways
  highway   service=6618 residential=2336 secondary=910 tertiary=831 primary=739
            motorway=175 unclassified=173 motorway_link=152 ...
  lanes     2,657 ways    2=1049 3=540 4=480 1=294 5=241 6=40 7=13
  surface   4,986 ways    asphalt=4431 concrete=373 paved=71 concrete:plates=47
  cycleway            210   track=99  shared_lane=65  lane=36  separate=7  no=2
  cycleway:left       163   lane=73   track=26  shared_lane=22 separate=18 no=16
  cycleway:right      513   lane=256  track=158 shared_lane=37 share_busway=24
  cycleway:both       600   lane=409  track=78  shared_lane=56 no=51
cycleways   1,316 ways     (highway=cycleway=1028, plus bicycle=designated paths)
roads_far   8,271 ways     motorway/trunk/primary/secondary over a 4x wider box
```

The third query is the far field, and it exists because of a regression this pass
caused and then fixed — see §8.

`scripts/bake_ground.py` grew a `bake_roads()` that writes `data/roads.geojson`.
It is a **second source**, not part of `ground.geojson`, because it comes from a
different bbox, wants a lower `minzoom` than the ground fill, and keeping it
separate makes `GROUND.roads = false` free instead of a filter over 11,000
features.

---

## 2. Road classification, and how much of it is measured

The width model is one line:

```
pavement_m = lanes × 3.4 + 1.6      (+ 1.8 per side that has a bike lane,
                                     + 0.9 more where cycleway:*:buffer=yes)
```

`3.4 m` is a US urban travel lane and `1.6 m` is the kerb/gutter allowance. Those
two numbers are the only **generative** part; everything they multiply is OSM's
own lane count. Where OSM has no `lanes` the class fallback below is used and the
feature is flagged `wt: 0` so the split can be counted rather than claimed.

| class | fallback m | why |
|---|---|---|
| motorway | 30 | I-35 mainlanes where they are mapped as one way |
| trunk | 24 | |
| primary | 18 | |
| secondary | 15 | |
| tertiary | 12 | |
| unclassified / residential | 9.5 | two lanes plus parking, the West Campus section |
| living_street | 8 | |
| service | 5.5 | alleys, driveways, parking aisles |
| any `*_link` | 7.5 | a ramp is one lane plus shoulders |

**Measured share: 8,027 of 16,344 road ways (49.1%) take their width from a real
lane count.** Within the outer ring alone it is 2,646 of 10,120 (26.1%) — lower,
because that set is dominated by 4,617 service roads and 2,335 residential streets
that OSM does not count lanes on. The far-field armature is almost all arterials
and almost all of it is tagged, which is why the overall figure is nearly double.

Either way, the roads that carry the scene are the measured ones, and the guessed
ones are exactly those where a typical section is a safe guess.

### The named streets the complaint was about

Straight off the baked features (`scripts/verify/roads-probe.mjs`), pavement
width in metres:

| street | ways | min | median | max | class(es) | OSM lane counts |
|---|---|---|---|---|---|---|
| Guadalupe Street | 84 | 6.8 | **17.9** | 22.2 | primary / tertiary | 1,2,3,4,5 |
| W Martin Luther King Jr Blvd | 29 | 8.4 | **20.4** | 22.2 | secondary / primary | 2,3,4,5 |
| E Martin Luther King Jr Blvd | 29 | 15.0 | **18.6** | 22.2 | secondary / primary | 4,5,6 |
| San Jacinto Boulevard | 61 | 5.0 | **12.9** | 18.6 | tertiary / secondary / service | 1,2,3,4,5 |
| Speedway *(the road parts)* | 35 | 5.5 | **13.8** | 17.4 | tertiary / residential / service | 2 |
| West 24th Street | 11 | 8.0 | **15.0** | 15.2 | primary / unclassified / secondary / living_street | 2,4 |
| East Dean Keeton Street | 63 | 6.8 | **10.2** | 17.0 | secondary | 1,2,3,4 |
| Red River Street | 71 | 8.4 | **15.2** | 22.2 | secondary / tertiary / unclassified / residential | 2,3,4,5 |
| Whitis Avenue | 10 | 8.0 | **9.5** | 9.5 | residential / unclassified / living_street | 2 |
| University Avenue | 15 | 8.0 | **9.5** | 9.5 | living_street / unclassified / residential | — |

Those are now visibly different roads. Before this pass all ten resolved to one
of seven class widths and Whitis, University Avenue and San Jacinto were the same
object.

Surface is read too: **282 ways come out `roadconcrete`** rather than asphalt —
East MLK is tagged `surface=concrete` for most of its length, and it is a
noticeably lighter grey on the ground than the asphalt either side of it.

---

## 3. Bike lanes — the rule, and what is NOT drawn

This is the actual ask, and most of the work in it is the negative half.

| OSM value | drawn? | what it means on the ground |
|---|---|---|
| `lane` | **yes**, painted lane | a striped on-carriageway lane |
| `opposite_lane` | **yes**, painted lane | contraflow painted lane |
| `shoulder` | **yes**, painted lane | rideable striped shoulder |
| `track` | **yes**, protected | physically separated from traffic |
| `opposite_track` | **yes**, protected | contraflow protected track |
| `shared_lane` | **no** | a *sharrow* — a stencil on a shared travel lane. There is no lane. |
| `share_busway` | **no** | shares the bus lane; no separate bike lane exists |
| `separate` | **no** | mapped as its own way — drawing it here would draw it twice |
| `no` | **no** | explicitly none |
| `shared`, `shared_parking_lane` | **no** | |
| `crossing`, `sidepath`, `link`, `traffic_island`, `planned` | **no** | not a lane |

The tag fallback chain matters: `cycleway:left` beats `cycleway:both` beats plain
`cycleway`. Reading only `cycleway` would have missed 663 of the 883 tagged ways
in this extract; treating `cycleway:both` as one-sided would have drawn half the
lanes that exist.

Result: **1,101 ways carry a bike lane — 741 painted, 360 protected — plus 953
separate `highway=cycleway` ways** drawn as their own piece of ground.
`bicycle=designated` on a road with no `cycleway` tag is a bike *route*, not a
lane, and gets nothing.

### Scale check

A 6 ft bike lane is 1.8 m. At the flying camera's ~0.5 m per pixel that is
**3.6 px — true scale.** Unlike a lane stripe, a bike lane is one of the few road
markings big enough to draw honestly from up here. It is drawn at its real width,
offset to its real position (`line-offset` is positive to the right of the line's
direction, which is exactly OSM's left/right convention), and `w` already includes
it, so the lane lands on the pavement rather than in the gutter.

### Green paint: measured, and it is one street

OSM carries **no colour information whatsoever** — not one `*colour*` or
`*color*` key on any of the 13,440 ways fetched. So the choice was between
painting the network green (wrong), drawing no lanes (useless), or going and
looking. `scripts/sample_bike_lane_paint.py` goes and looks.

It sweeps z20 nadir imagery at every perpendicular offset from −14 m to +14 m
along each tagged way and scores green as

```
G − R > 5   AND   R − B < 12   AND   luma > 80
```

which is derived, not invented. Cropping the Guadalupe lane out of the mosaic and
tracking the greenest pixel across 27 rows gives, in one image under one sun:

| | rgb | G−R | R−B |
|---|---|---|---|
| green paint | 158, 168, 151 | **+10** | **+7** |
| asphalt travel lane | 138, 132, 120 | −6 | +18 |
| concrete walkway | 188, 174, 152 | −14 | +36 |
| live oak canopy | 107, 115, 91 | +8 | **+16** |

`G−R` alone cannot separate paint from a live oak — both sit at +8 to +10, which
is why the first two versions of this script found nothing and then everything.
The *pair* separates them: the paint is neutral in red-versus-blue and the canopy
is not.

**Verdict, over 132 ways swept in the core area:**

| way | tags | length | peak offset | green | carriageway centre |
|---|---|---|---|---|---|
| Guadalupe Street | `cycleway:left=track` | 61 m | −9.0 m | **51.5%** | 0.0% |
| Guadalupe Street | `cycleway:left=track` | 78 m | −9.0 m | **50.0%** | 2.5% |
| Guadalupe Street | `cycleway:left=track` | 162 m | −8.0 m | **37.3%** | 0.0% |
| *next best* — Duval St | `cycleway:*=lane` | 45 m | +8.0 m | 35% | — |
| *then* — E MLK | `cycleway:right=lane` | 245 m | −12.0 m | 24% | 0.8% |

**301 m of Guadalupe's west-side protected track is green. Nothing else in the
modelled area clears the bar**, and the runners-up peak at 12–14 m out, which is
the verge, not a bike lane. Three OSM ways carry `gp: 1`; the rest of the network
is drawn in asphalt tones.

Evidence in `research/speedway/guadalupe_green_lane_z20.png` — the ribbon is
unmistakable — and `research/speedway/sanjacinto_track_z20.png`, which is a
`cycleway:right=track` on San Jacinto and is plain grey concrete. **Protected
does not imply green.** That is the finding, and it is the reason the class rule
"paint every `track` green" was not used.

---

## 4. Lane markings and stop bars — both over-scale, both declared

Section 5 of the common brief: at 200–900 m one pixel is about half a metre, so a
10 cm lane stripe does not exist. Both of these are drawn deliberately over-scale
and here is the arithmetic.

| feature | real | drawn | over-scale | why it is still worth drawing |
|---|---|---|---|---|
| lane centre line | 0.10 m wide | `laneMinPx: 1.1` ≈ 0.55 m | **≈5×** | at `laneOpacity: 0.42` it reads as a hint down the middle of an arterial, not as a kerb. Inherited from the previous pass; this doc is where the number finally gets stated. |
| stop bar | 0.3–0.6 m deep | `stopBarDepth: 1.6 m` | **≈3×** | the LENGTH is true — half the carriageway, from the feature's own width — so only the depth is exaggerated |
| Speedway paver | 0.203 × 0.102 m | 1.62 × 0.81 m | **7.9×** | see §5 |
| bike lane | 1.8 m | 1.8 m | **1× (true)** | |

Lane markings stay restricted to `GROUND.laneClasses` — motorway, trunk, primary,
secondary, tertiary — and never a ramp. **No campus footpath gets a marking.**

Stop bars are baked, not faked: 80 `highway=traffic_signals` nodes are matched to
the road ways that actually contain them **by node id**, not by proximity, and a
transverse bar is emitted 5.5 m back along each approach, spanning centreline to
kerb on the approaching driver's right. A one-way road gets one bar; a two-way
gets two, on opposite sides, which is what a junction looks like from the air.
**165 bars from 80 signals.**

---

## 5. Speedway Mall

### The reference

| fact | value | source |
|---|---|---|
| extent | Jester Circle (≈21st St) to Dean Keeton | PWP Landscape Architecture project record; *The Daily Texan*, 25 Sep 2015 |
| width | **30 ft (9.14 m)** | PWP: "narrowed to a pedestrian-friendly 30 feet wide" |
| material | golden sand-molded brick | PWP: "a mellow golden sand-molded brick, referencing the warm golden brick that characterizes the traditional campus architecture" |
| bond | **herringbone**, at 45° to the corridor | PWP: "chosen for both aesthetics and strength as the corridor is used for emergency vehicle access" |
| paver module | 8 × 4 in (0.203 × 0.102 m) nominal | standard US modular paver — **generative**, PWP does not publish the unit |
| colour | see below | **sampled**, `scripts/sample_speedway_colour.py` |

### The colour is sampled, not chosen

The first attempt hand-placed three sample points and two landed in the live-oak
canopy, so "brick" came back rgb(113,116,94) — a tree. `sample_speedway_colour.py`
walks the OSM centreline instead, samples a ±3.5 m profile every metre, and splits
the pixels into lit / shadow / canopy so the shading is a number rather than an
excuse:

```
speedway_brick  (OSM surface=paving_stones)   6 ways, 22,660 px
   lit      64.3%  #b6a488  rgb(182,164,136)  luma 165.8
   shadow   27.0%  #36342f
   canopy    8.8%  #6b735b

speedway_south  (OSM surface=asphalt, SAME corridor)   3 ways, 16,280 px
   lit      93.2%  #c8b08e  rgb(200,176,142)  luma 178.6

inner_campus_dr (asphalt control, same image)          1 way,  5,922 px
   lit      25.8%  #a19b89  rgb(161,155,137)  luma 155.0
```

Two things fall out of that:

1. **OSM's `surface=asphalt` on the southern half is a stale tag.** It samples
   rgb(200,176,142), a warm tan with R−B = +58, against a real asphalt control of
   rgb(161,155,137) with R−B = +24 in the same frame. The whole corridor was
   rebuilt in brick. The bake overrides it, and reports how many segments it
   overrode (`speedway_stale_asphalt_overridden: 3`).
2. The measured chroma ratio is **1 : 0.880 : 0.710**. That ratio is what
   `SURF.brickpave` reproduces — `#e9cca4` = 1 : 0.876 : 0.704 — with the
   lightness raised into the palette's own pale-paving band, because this palette
   is stylised and the aerial is hazy. The *relationship* is measured; the
   absolute level is the palette's.

### The bond, and the tiling lattice

A herringbone is the two-brick L-pair `{H at (0,0) size 2W×W, V at (2W,0) size
W×2W}` repeated on a lattice. Which lattice was **brute-forced** rather than
recalled: search all integer generator pairs whose determinant equals the pair's
area, rasterise, reject any that overlap or leave a gap. Generators `(W, −W)` and
`(4W, 0)` survive, and their axis-aligned period is exactly 4W × 4W.

The first attempt used an invented four-brick cell and produced a **pinwheel**,
not a herringbone. That was obvious the instant it was rendered and looked at, and
completely invisible on paper — playbook rule 6, and it cost one render.

Rotated 45° the smallest axis-aligned period becomes 4W·√2, so the tile is drawn
oversized, rotated, and cropped to a window that is a whole number of those
periods. Per-brick lightness jitter is hashed on the brick's position **modulo the
tile**, not on its lattice index: hash the index and the brick clipped by the
right edge gets a different tone from the one continuing at the left edge, and the
seams show as a grid the moment it is laid down a 679 m corridor.

`GROUND.speedwayCells = 2` puts two herringbone cells across the 9.14 m corridor,
making W = 0.81 m and a brick 1.62 × 0.81 m — **7.9× over-scale**, and 1.6 px wide
at 400 m, which is the smallest thing that can read at all.

### It reads from several altitudes

The tile is registered as `line-pattern` on a line layer over the corridor's own
brick colour, so like the four ground-texture tiles it carries **no colour**, is
generated once at load, and time of day only moves its opacity.

| frame | zoom | what the corridor reads as |
|---|---|---|
| `shots/roads-speedway-high.png` | 15.5 | a golden ribbon with fine grain, distinct from every concrete walk around it |
| `shots/roads-speedway-along.png` | 16.9 | **the herringbone zigzag, plainly** |
| `shots/roads-speedway-close.png` | 18.1 | a dense weave under the oaks |
| `shots/roads-speedway-across.png` | 16.6 | seen side-on across the corridor rather than down it |

### The scaling law of `line-pattern` is NOT established, and that is stated

`GROUND_TEXTURE.md` measured `fill-pattern` properly — 32 px tile, 33.0 m at z16,
16.5 m at z17, 8.2 m at z18 — and that measurement is why every ground tile in
this scene is scale-free noise. The obvious next question is whether
`line-pattern` behaves the same way, and `roads-pattern.mjs` was written to
answer it the same way.

**It did not answer it.** The autocorrelation it uses cannot resolve a 0.8 m bond
until the corridor itself is ~30 px wide, which happens only at z18 and above:

```
 zoom  corridorPx  periodPx   period/corridor    sd
 15.5         8.1         3             0.370  61.64
 16.0         8.9         3             0.337  60.69
 16.5        12.6         3             0.238  56.59
 17.0        17.8         3             0.169  52.44
 17.5        25.1         3             0.120  51.04
 18.0        35.6         4             0.112  33.42
 18.5        50.3        13             0.258  21.60
```

Five of seven rows sit on the smallest lag the search allows. A column of
identical 3s is not a constant period; it is a corridor 8 px wide. Two earlier
versions of this script printed confident and **opposite** conclusions off
exactly those rows — one said native-pixel-locked, the next said world-locked,
from the same renders. The script now refuses to conclude unless at least three
zooms resolve the bond, and prints `NO VERDICT`.

What the run *does* establish is the `corridorPx` column, and it is worth having:
the mall is drawn at a constant **world** width, doubling cleanly per zoom level
from 8.1 px at z15.5 to 50.3 px at z18.5. A 30 ft corridor is 30 ft at every
altitude. Whether the bond inside it holds its size is settled by looking at the
four frames above, which is what the brief says to do anyway.

---

## 6. The trap, re-measured

`docs/GROUND_TEXTURE.md` §"Verifying it": *"The paving tones are pale on purpose;
if path-vs-ground separation ever falls back toward single digits, the bug that
made the whole path network invisible has come back."* Re-toning the roads and
adding a fifth pale surface to the palette is exactly the edit that could do it,
so it is measured, on the same pose, before and after.

`before` is a pristine `git archive HEAD` tree served on its own port and run
through the unmodified `ground-luma.mjs`. `after` is `roads-luma.mjs`, which
classifies the same way plus the new surfaces.

| p | | path | ground | **path − ground** |
|---|---|---|---|---|
| 0.14 day | before | 204.9 | 162.9 | **42.0** |
| | after | 209.3 | 163.2 | **46.1** |
| 0.50 golden | before | 197.6 | 150.4 | **47.2** |
| | after | 201.8 | 150.8 | **51.0** |
| 0.92 night | before | 54.8 | 33.7 | **21.0** |
| | after | 56.2 | 33.8 | **22.4** |

**No regression — it improved by 4.1 / 3.8 / 1.4 luma.** The reason is not a
palette change: Speedway's nine mall segments used to be counted as `path` at
the pale `paving` tone, and they now classify as `brickpave`, which lifts the
remaining paths' mean slightly. The ground is unmoved to within 0.4 luma at
every hour, which is the real check.

The new separations, on a pose that actually contains the mall and a bike lane:

| | day | golden | night |
|---|---|---|---|
| road − path | 123.8 | 137.9 | 28.3 |
| brick − ground | 34.2 | 44.1 | 28.7 |
| **brick − path** | **11.9** | **6.9** | **6.3** |

`brick − path` is the thinnest number in this pass and it is stated plainly:
by luma alone, Speedway is only ~12 units from a concrete walk by day and ~7 at
golden hour. What separates them on screen is hue and pattern, not lightness —
brick is R−B = +69 against concrete's +20, and it carries the herringbone. That
is visibly enough (`shots/roads-speedway-close.png`), but if a later pass warms
the concrete tone, this is the number that will break first.

---

## 7. Frame cost: the measurement does not resolve it, and here is the proof

"Before" is not a setting here — the road geometry used to come from vector tiles
and now comes from a 3.8 MB GeoJSON source, and no `GROUND` flag reproduces that.
So `roads-perf.mjs` serves a pristine `git archive HEAD` tree on a second port and
alternates the **page**: one browser, one window, one machine, reloaded between
configurations, counterbalanced (the order reverses on alternate reps), minimum of
the reps, dropped frames over a 4.2 s scripted bearing sweep, headed.

It was run twice — once before the far-field armature was added and once after,
so the second run is measuring 50% more road data than the first.

```
RUN 1  (roads.geojson 2.5 MB)
config      dropMIN   fpsBest   all reps
head           120      19.2    [170, 210, 173, 120, 121]
roadsOnly      112      30.9    [135, 192, 112, 132, 120]
after          110      31.6    [179, 179, 110, 285, 121]
delta vs head:  roadsOnly -8    after -10      spreads: head 90, roadsOnly 80, after 175

RUN 2  (roads.geojson 3.8 MB, +6,224 far-field ways)
config      dropMIN   fpsBest   all reps
head           116      31.8    [117, 175, 172, 165, 116]
roadsOnly       33      42.9    [133,  33, 135,  92, 108]
after           25      43.2    [ 98,  25, 123,  80,  64]
delta vs head:  roadsOnly -83   after -91      spreads: head 59, roadsOnly 102, after 98
```

**There is no result here, and the two runs together are what proves it.** Three
things say so and any one of them would be enough:

1. Every delta in both runs is **negative** — the build that strictly does more
   work measured *faster*. That cannot be real.
2. Every delta is smaller than or comparable to the spread one configuration
   produces on its own.
3. The same configuration, `roadsOnly`, returned a minimum of **112 in run 1 and
   33 in run 2** — a 3.4× swing on more data, not less. If the harness could
   resolve a difference this size it would not do that.

What can be said honestly is a bound: any real cost is below roughly 100 dropped
frames per 4.2 s on this machine, which is where the measurement floor sits. The
noise floor here is 2–6× worse than the ground-texture pass's (spread 27) for a
structural reason — the configurations are separated by a full page reload rather
than a settings toggle, so each rep carries fresh tile state and fresh GC
pressure. That is the price of "before" not being a setting, and it is the main
weakness in this pass's verification.

The design reason to expect it to be cheap is unchanged: the added per-frame work
is four line layers on one extra source, the herringbone tile is generated once at
load and never regenerated, and time of day moves opacities rather than redrawing
images.

---

## 8. What is still wrong, and what could not be classified

- **Bike-lane offsets step where OSM's lane count steps.** Guadalupe goes 3 → 4 →
  5 lanes across a few hundred metres because of turn pockets, so the drawn kerb
  and the bike lane inside it jump sideways by up to 2 m at those joins. It is
  visible at z18. It is also what the data says: the road really does get wider
  there. Not smoothed, because smoothing it would be inventing a kerb line.
- **74% of road widths are still a class typical section**, not a measurement.
  OSM has no lane count for them. This is reported per feature as `wt: 0` and
  counted in the bake report, not hidden.
- **Parking lanes are not modelled.** `parking:*` tags were not fetched, so
  Guadalupe at the Drag is drawn at its travel-lane width plus bike lane and is
  narrower than the real kerb-to-kerb section.
- **Green paint outside Guadalupe is unresolved, not absent.** The detector needs
  a continuous run to clear 35%; Austin's short conflict-zone patches at junction
  approaches are 15–30 m and would be averaged away. The imagery also has no
  published per-tile capture date, so paint added recently would not show. What
  can be said is what is written above: over 132 ways, one corridor separates
  cleanly from the rest and the rest do not separate from each other.
- **The far field is an armature, not a network.** Taking the roads off the
  basemap took them off the whole world, and the first version of this pass left
  the outer third of a wide establishing shot blank tan — the city read as a
  plate. That is fixed: motorways, trunks, primaries and secondaries are pulled
  over `30.180,-97.900 → 30.400,-97.600`, about four times the outer ring, and
  appended (`far: 1`, 6,224 extra ways, geometry simplified five times harder).
  Compare `shots/before-wide-day.png`, the first `roads-wide-day.png` and the
  current one. But it is only the arterials: beyond the outer ring there are no
  residential streets, so the far field is a skeleton where the basemap drew a
  full grid. At 5 km a residential street is sub-pixel, so this is deliberate,
  but a very low, very wide pose can still find the difference.
- **`highway=cycleway` includes shared-use paths.** 953 of them are drawn as bike
  infrastructure; many are sidewalk-level trails that a pedestrian would call a
  footpath. OSM does not consistently distinguish them and `segregated` is present
  on only 628 of 1,316.
- **`js/timeofday.js` still writes `road`/`roadCasing` every tick** onto hidden
  layers, as it has since the previous pass. Deleting them belongs to whoever owns
  that file.

---

## 9. Verifying it

```bash
python -m http.server 8171 --bind 127.0.0.1
```

```bash
cd scripts/verify && VERIFY_URL=http://127.0.0.1:8171 node roads-probe.mjs
```

- `roads-probe.mjs` — the layers exist, the basemap's roads are hidden, the
  source carries what the bake claims, and named streets resolve to the widths in
  the table above.
- `roads-pattern.mjs` — how `line-pattern` actually scales, measured the way
  `pattern-scale.mjs` measured `fill-pattern`. **Read the note in its header
  first**: the initial version located the corridor by thresholding luma, matched
  the *background*, and reported the 9 m mall as 833 px wide at z15.5 while
  returning an identical 3 px period at every zoom. A clean table of identical
  numbers is what a broken measurement looks like.
- `roads-shot.mjs` + `shots-roads.json` — the frames. A verbatim copy of
  `shot.mjs` except that it also waits for `austin-roads`; roads.geojson is 2.5 MB
  and does not finish inside `shot.mjs`'s fixed settle, so a Speedway frame taken
  through `shot.mjs` comes back with no roads and reads as a broken layer.
- `roads-perf.mjs` — the interleaved A/B. "Before" is not a setting here, so it
  serves a pristine `git archive HEAD` tree on a second port and alternates the
  **page**, counterbalanced, minimum of the reps.
- `roads-luma.mjs` — the guard on the pale-paving trap, extended. It classifies
  the bike, cycleway, stop-bar and Speedway-brick layers, which `ground-luma.mjs`
  drops into "unclassified"; and it waits on RENDERED FEATURES rather than a
  clock, because with roads.geojson added the old fixed settle is no longer long
  enough — a run of `ground-luma.mjs` against this branch came back 0.0% path,
  0.0% area and a perfectly plausible-looking table.
- `ground-luma.mjs` — unchanged, and used as-is for the `before` column.
- `scripts/sample_bike_lane_paint.py` / `sample_speedway_colour.py` — the imagery
  measurements above, re-runnable.
