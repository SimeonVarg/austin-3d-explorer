# Routing on the pavement that is actually there

Acer lane `acer/w-sidewalks`, 2026-08-23. Round 1.

**The brief was "route along the sidewalks that already exist — 1,324 footway
features in `data/ground.geojson` the router may not be using". Measured, the
router was already using them: 99.9 % of the walking graph's footway length runs
over pavement the scene paints. The metres that were crossing lawns were not
footway edges at all. They were the DOOR LINKS — the straight lines from a
building's door to the network — and the router was treating them as free
pavement and spending them as shortcuts.**

Two changes, both measured before and after on the same twenty pairs:

1. `js/wayfind.js` — a door link now costs **four pavement metres per metre**
   (`LINK_COST_MULT`). Invented straight line across the twenty routes:
   **485 m → 164 m**.
2. `scripts/bake_ground.py` — the two **kerb aprons** of every crossing are now
   painted (`CROSSING_APRON_M`), so the sidewalk network no longer stops short of
   the street at every corner in the city. 1,604 aprons; the file grows 50 KB
   gzipped.

Net, on the whole drawn route including the dashed legs:

| | main today | this branch |
|---|---|---|
| on painted pavement | **93.7 %** | **95.4 %** |
| on painted pavement **or** carriageway | 96.5 % | **98.6 %** |
| metres on lawn | 20.2 m | **6.0 m** |
| metres on nothing painted at all | 287.4 m | **118.5 m** |
| metres of invented straight line | 485 m | **164 m** |
| worst single route, % on pavement | 76.1 % | 68.8 % (see §5) |
| median route, % on pavement | 95.4 % | **97.9 %** |
| total route length | 8,678 m | 8,910 m (**+2.7 %**) |

Every number below was measured on this date against the files on disk or in a
browser driving the real page; none is estimated or reasoned from a description.
The measuring scripts live in the session scratchpad rather than the repo
(`scripts/verify/` is not this lane's to write) and §0 and §4 describe them in
enough detail to rebuild them. Confidence marks follow the house convention from
`docs/entrances/`: **[M]** measured here, **[D]** derived from an [M] by a stated
argument.

---

## 0. How the judged number is measured, and one trap in measuring it

The question is geometric, not tag-based. A route is a lon/lat polyline; the
scene's ground is 10,937 polygons in `data/ground.geojson`. So: sample the route
every **0.5 m**, classify each sample against the polygon under it, and weight by
sub-segment length.

```
PAVED   k=patharea / k=pathslab (footway, steps, path, pedestrian),
        k=area with u=plaza / deck / platform, and hard-surfaced area
ROAD    k=roadarea, k=cyclearea, parking             <- a crossing legitimately lands here
SOFT    lawn, grass, turf, garden, bed, scrub, dirt, park, pitch, wood, channel
NONE    off every polygon in the file
```
Resolved in that order, so a footway slab drawn on top of a plaza is never
counted twice.

**The trap, and it cost the first two hours: do not do this with line
intersection.** The scene's slabs overlap each other on purpose — a `pathslab`
sits on the `patharea` it was cut from — and `unary_union` of near-duplicate
intersection linestrings does not dissolve cleanly in floating point. The first
implementation reported **124.2 % coverage** and looked plausible until the
column was totalled. Point sampling cannot exceed 100 % and needs no dissolve.

**The second trap, which changes the headline by three points: sampling exactly
ON a polygon's boundary is a coin flip.** 42 of OSM's pedestrian areas on this
campus are drawn as `area=yes` rings — the Main Mall, the East Mall, the Six
Pack — and the graph's edges ARE those rings, because §10 of
`docs/walk/graph.md` accepted that plaza interiors are not traversable in v1. So
a route walking the Main Mall runs along the Main Mall polygon's own edge, and a
strict test scores it as off-pavement. It is not off-pavement; it is on the rim
of it.

```
tolerance   graph line on pavement   door legs on pavement   whole drawn route
  0.00 m           93.9 %                   39.0 %                90.8 %
  0.10 m           96.8 %                   40.6 %                93.7 %
  0.30 m           97.0 %                   42.9 %                94.0 %
  1.20 m           97.9 %                   50.6 %                95.3 %
```
**[M]** 2.9 points of the strict miss disappears inside ten centimetres.

**So every headline number in this document uses a 10 cm tolerance, and says
so.** Ten centimetres is a rounding of the source coordinates (`1e-6` degrees is
0.096 m east-west here), not a fudge — at 0.30 m the number has already stopped
moving. The strict-zero numbers are given alongside wherever it matters, and the
change looks the same in both — on the shipped `data/ground.geojson`, turning the
link multiplier from 1 to 4 moves the whole drawn route from **91.1 % to 92.9 %
strict** and from 94.0 % to 95.4 % at 10 cm. (The 93.7 % in the summary table is
`main` today: old ground file AND old multiplier, so it carries both changes.)

The twenty pairs are frozen in the measuring script and are real class-to-class
hops: GDC→WEL, RLP→GDC, JES→UTC, PAI→BUR, CAL→MEZ, WCH→GAR, ART→DFA, PCL→UNB,
ECJ→ETC, EER→GDC, JES→GRE, MAI→PCL, PMA→WEL, BUR→UTC, CBA→UTC, NHB→UNB,
WAG→MEZ, BEL→JES, ANB→GRE, SZB→PAI.

---

## 1. The premise in the brief is wrong, and finding that out is the finding

The brief said `data/ground.geojson` holds 1,324 `footway` features "the router
may not be using". Both halves are worth checking before building anything on
them.

The 1,324 is right **[M]** — `u:'footway'` on 1,324 polygons, `u:'steps'` on 179.
But those polygons are not a separate network. They are `scripts/bake_ground.py`
buffering the SAME OSM ways the walking graph is built from
(`data/osm_cache/footways.json`, 3,430 ways) out to 2.4 m slabs. Router and
pavement come from one source. They cannot disagree about where a sidewalk is —
only about whether it got drawn.

So the real question is: **which edges does the router use that the scene never
paints?** Run every non-stranded edge in the graph, sample it, name the OSM way
behind each miss:

```
                          length      off pavement
footway              141.83 km          86.0 m   ( 0.1 %)
steps                  1.26 km           4.9 m   ( 0.4 %)
road access legs       1.09 km           0.0 m   ( 0.0 %)
crossings             11.59 km       2,426.8 m   (20.9 %)   <- all of it
```
**[M]**, 10 cm tolerance, whole graph, not just the twenty pairs.

**The footway network is 99.9 % painted.** There is no missing-sidewalk problem
to fix in the bake. The entire systematic gap is crossings, and of the 2,427 m,
**2,245 m is on nothing painted at all** rather than on grass — which is the
signature of a gap, not of a route running over a lawn.

---

## 2. The gap is at the kerb, and it is at every corner in the city

`scripts/bake_ground.py` skips `footway=crossing` deliberately, and the reason
in the comment is good: *"they are road markings, and drawing them as paths lays
pale ribbons across every street."* Painting 805 crosswalks as pale concrete
would wreck the streets.

But a crossing way does not begin at the kerb. It begins a metre or two back, on
the ramp. And the sidewalk it leaves ALSO stops short, because `widen_paths`
buffers with flat caps (`cap_style=2`) — the pavement polygon ends square at the
sidewalk's last node. Between the two, nothing was painted.

```
2,245 m of graph over nothing / 806 crossings / 2 ends  =  1.4 m per kerb
```
**[D]** — which is exactly the size of a kerb ramp, and is why the sidewalk in
the scene visibly stops a stride short of every street.

### The fix

Emit the **first and last `CROSSING_APRON_M` = 2.5 m** of every crossing as
ordinary footway and nothing in between. The middle — the part actually over the
carriageway — is still never drawn.

```python
CROSSING_APRON_M = 2.5
CROSSING_APRON_SURFACE = "concrete"
```

Two constants, both taste values per CLAUDE.md rule 11. The surface is forced to
concrete on purpose: a crossing's own `surface=asphalt` describes the ROAD it is
painted on, and honouring it would drop a black patch at every corner instead of
continuing the sidewalk. Forcing concrete puts the apron in the same
`(footway, concrete)` union group as the sidewalks, so it dissolves into them
rather than reading as a separate patch.

**Why 2.5 m and not 1.4 m:** the measured gap is a mean, the real one varies, and
overshoot is free — the resolver already cuts every `patharea` against the
buffered road centrelines (`carriageway_polys`, inset by `KERB_M/2`), so an apron
that reaches past the kerb is removed before it ships. That is not a hope, it is
in the bake's own report:

```
carriageway x path overlap, AFTER the cut     before this change   77 pairs / 102 m2
                                              after                81 pairs / 108 m2
```
**[M]** Four extra pairs and six square metres across 1,604 new aprons. The
pale-ribbons-across-every-street failure the skip was guarding against cannot
happen, and `shots/walk/sidewalks/streets-wide-after.png` is the campus-scale
frame that confirms it by eye.

### What it costs

```
features        10,937 -> 11,860     (+923)
file            5,071 KB -> 5,406 KB raw     944.7 KB -> 994.6 KB gzip   (+5.3 %)
aprons emitted  1,604 from 806 crossings
```
**[M]** `data/ground.geojson` is fetched at boot for everyone, so this is a real
+50 KB on the wire for a fix nobody asked for by name. It is worth it: the
sidewalk network stopping short at every corner is visible in any nadir frame,
and it is the literal reading of *"at least make sure existing sidewalks are
identified properly."* **A perf lane should confirm the extra 923 polygons cost
nothing at frame time — this pass did not measure frame time, because the
machine was not quiet.**

The bake is byte-reproducible, checked at both ends **[M]**: running it unchanged
before touching anything reproduced `data/ground.geojson` to the same SHA-256, so
the whole diff in that file is this change and nothing else; and running the
committed script again at the end reproduced the committed data file to the same
SHA-256 — which is also the exact file every screenshot below was rendered from.

Pictures: `shots/walk/sidewalks/kerb-sanjac-before.png` / `-after.png`, and
`kerb-21st-before.png` / `-after.png` — same camera, same everything, only the
data file swapped.

---

## 3. The real defect: the router was using invented straight lines as shortcuts

This is the part that matters, and it was not in the brief.

`data/walk_graph.json` gives every door up to **three anchors** — the three
nearest points on the network, out to `DOOR_LINK_MAX_M = 30 m` — and stores the
link length with each. `dijkstra()` seeded from all of them and minimised
`link + path`, **costing the link at one metre per metre, exactly like a
surveyed footway.**

A link is not a footway. Nobody surveyed it. The interface already draws it
dashed and thinner precisely because we are not claiming it is walkable
(`docs/walk/what-we-can-honestly-say.md` §7). But the router did not know that,
so a 27 m straight line across a lawn was a legal shortcut any time it saved
27 m of real walking — and it took it constantly:

```
BUR main door  anchors at   2.3 m  and  27.6 m   -> router chose 27.6
JES main door  anchors at   0.4 m  and  26.8 m   -> router chose 26.8
UNB main door  anchors at   0.5 m  and  24.2 m   -> router chose 24.2
BEL door 281   anchors at   1.1 m  and  27.7 m
GDC door 383   anchors at   0.4 m,  21.1 m,  29.6 m
```
**[M]**

Across the twenty pairs the router spent **485 m of invented straight line, and
57 % of it lay on grass or on nothing at all** **[M]** (269 m on nothing, 9 m on
grass, the rest on pavement or road). `door-bur-x1.png` is what
that looks like: a 27.6 m dashed leg running straight over Burdine Hall's roof
because the anchor on the far side of the building was cheaper than walking
round.

### The fix

```js
const LINK_COST_MULT = 4.0;
function linkCost(a) { return a.pc != null ? a.pc : a.c; }
```

`anchors()` now returns `pc = metres * LINK_COST_MULT` alongside the true `c`,
and `dijkstra()` spends `pc`. **`c` is untouched**, so `legBetween()`,
`computeRoute()`, every printed distance and every drawn door leg still carry the
honest metres — the change is three lines inside two functions and nothing
outside the graph section had to move. `WAYFIND.linkCostMult` overrides the
constant at runtime if a later lane wants it in the config block or in the bake's
`tune` map.

### Why 4.0 and not something else — the curve, measured

Twenty pairs, 10 cm tolerance, whole drawn route:

```
 mult | length  doorleg | %pave  %pave+road  off-pavement m  worst leg
    1 |   8678    485.1 | 93.69      96.46        307.6         27.6
    2 |   8762    241.5 | 94.48      97.80        192.7         26.8
    3 |   8819    204.5 | 94.74      98.04        173.2         26.8
    4 |   8910    163.7 | 95.10      98.45        138.0         25.5   <- shipped
    6 |   9004    140.3 | 94.53      98.55        130.6         25.5
   12 |   9302    102.2 | 95.06      98.95         98.0         17.6
 1000 |   9925     69.6 | 95.58      99.23         76.6         11.1
```
**[M]** (measured against `data/ground.geojson` before the apron change, so this
table isolates one variable.)

4.0 is the knee. Below it a metre of lawn costs about 1.5 m of extra route to
remove; above it, about 4.5 m. The limit case — "always take the nearest anchor",
the `mult 1000` row — buys another 61 m of pavement for **14 % longer routes**,
and a router that walks you 14 % further to avoid drawing a dashed line is
answering the wrong question. Steeper shapes were tried too (tax only the excess
over 5, 6, 8, 10, 12 m, at 10x/20x/50x) and every one of them lands on the same
curve; none beat the plain multiplier.

Stated plainly, `LINK_COST_MULT = 4.0` means: **accept up to four metres of extra
real walking to avoid one metre of claim about ground nobody surveyed.** [D]

### It changes nothing about what is reachable

```
158 register codes, one route each, both profiles:
  avoidStairs=false  mult 1  -> 158 routed, 0 failed
  avoidStairs=false  mult 4  -> 158 routed, 0 failed
  avoidStairs=true   mult 1  -> 146 routed, 12 failed
  avoidStairs=true   mult 4  -> 146 routed, 12 failed   <- the SAME twelve
```
**[M]** The three-anchor design exists so the step-free profile can re-anchor
(`docs/walk/graph.md` §6f); a cost multiplier preserves that, where a hard cap
would have broken it. That is why this is a cost and not a cap.

---

## 4. The offline mirror agrees with the browser to the tenth of a metre

Everything above was measured by a Python re-implementation of `decode()`,
`edgeCost()`, `dijkstra()` and `anchors()` run against the files on disk. That is
only worth anything if it is the same router. Driven in Chrome through
`window.wayfindRoute()` with `WAYFIND.linkCostMult` flipped on the live page:

```
                       browser              python mirror
PAI->BUR  x1   links 25.4 + 27.6 = 53.0        53.0
PAI->BUR  x4   links 11.1 +  2.3 = 13.4        13.4
BEL->JES  x1   links  0.5 + 26.8 = 27.3        27.4
BEL->JES  x4   links  0.5 +  0.4 =  0.9         0.9
PMA->WEL  x1   links 26.7 +  0.4 = 27.1        27.1
PMA->WEL  x4   links  1.0 +  0.4 =  1.4         1.3
```
**[M]**

Frames were taken with `?intro=0&drift=0&walk=1`, `cancelGraphicsAutoDetect()`
called, the veil waited out, sources waited on, screenshot twice and the second
kept. Before and after share ONE camera per pair, derived from the union of both
routes' bounding boxes so neither can drop out of frame, and every frame records
how many ribbon polygons the renderer actually rasterised in that viewport:

```
pai-bur x1  ribbon 42   x4  ribbon 52
wch-gar x1  ribbon 27   x4  ribbon 28
bel-jes x1  ribbon 80   x4  ribbon 69
pma-wel x1  ribbon 46   x4  ribbon 52
cal-mez x1  ribbon 22   x4  ribbon 23
```
**[M]** The first attempt at these shots was thrown away: a derived eye-altitude
pose put the camera at 152 m when 95 was asked for, and the ribbon was four
pixels wide. Posing by named zoom and counting rendered features is the version
that can be believed.

---

## 5. What got worse, and why it is not a regression

`CAL→MEZ` goes from 81.5 % to 68.8 % on pavement. That reads badly and is not.

Its off-pavement metres go **29.5 m → 7.5 m**. What happened is a
reclassification: with the 24 m door link no longer free, the route leaves
Calhoun by the door on the other side and runs 44 m along a sidewalk whose
polygon the carriageway cut removed, because the OSM footway centreline there
sits inside the buffered width of Inner Campus Drive. The ribbon is on the drawn
road surface, next to the street, where the sidewalk really is — not on a lawn.
`%pavement or road` for the same route goes UP. This is the one place where
"% on pavement" and "is the ribbon somewhere a person walks" disagree, which is
why both columns are printed.

The full twenty, 10 cm tolerance, on the shipped `data/ground.geojson`:

```
pair        drawn m   %pave x1   %pave x4   off m x1   off m x4   doorleg x1   doorleg x4
GDC->WEL       110       97.9       97.9        2.3        2.3          4.0          4.0
RLP->GDC       485       99.5       99.5        2.3        2.3          3.9          3.9
JES->UTC       231      100.0      100.0        0.0        0.0          5.7          5.7
PAI->BUR       312       79.9       93.0       45.6       10.5         53.0         13.4
CAL->MEZ       245       81.5       68.8       29.5        7.5         48.0         24.4
WCH->GAR       128       76.5       96.5       19.8        0.0         31.2          1.9
ART->DFA       273       91.4       95.6       12.8        2.4         19.5          2.4
PCL->UNB      1058       98.6       98.6        2.5        2.5         24.6          0.9
ECJ->ETC       115       78.8       78.8        9.4        9.4         10.9         10.9
EER->GDC       490       96.6       97.9       12.2        6.4         18.6          7.8
JES->GRE       246      100.0      100.0        0.0        0.0         10.5          1.4
MAI->PCL       564       98.4       98.5        2.5        2.5         19.7          1.3
PMA->WEL       359       92.6       98.9       20.8        0.0         27.1          1.3
BUR->UTC       924       96.4       99.5       26.2        0.9         41.2          7.6
CBA->UTC       227       95.4       97.7        6.9        1.9         12.3          3.6
NHB->UNB       404       89.1       89.1       19.1       19.1         49.7         26.0
WAG->MEZ       148       76.1       76.1       29.0       29.0         33.0         33.0
BEL->JES       520       90.9       95.6       32.6        6.3         27.4          0.9
ANB->GRE      1254       91.3       91.3       11.8       11.8         17.6          1.8
SZB->PAI       817       98.8       98.8        9.6        9.6         27.3         11.5
```
**[M]** Fourteen of twenty unchanged or better; one worse on `%pave` and better
on off-pavement metres; five untouched because their doors have no near anchor to
switch to. Which is §6.

---

## 6. What is left, and it is one thing, and it is not in this lane

`WAG→MEZ` still spends 33 m of dashed line and `NHB→UNB` 26 m, and the multiplier
cannot help them: **their doors have no near anchor to prefer.** Both face a
plaza, and a plaza in OSM here is an `area=yes` ring. The graph contains the
ring's perimeter and nothing across the middle, so a door in the middle of the
East Mall frontage projects sixteen metres sideways to the nearest rim.

That is the same fact behind the detours: `PCL→UNB` walks 1,058 m for a 449 m
straight line (ratio 2.36) because the direct line crosses the South Mall and the
Six Pack, and the router has to go round them.

**The fix is one change in a file this lane does not own.** Written out so
whoever owns `scripts/bake_walk.py` can take it:

> In `scripts/bake_walk.py`, for each of the 42 `area=yes highway=pedestrian`
> ways, triangulate or grid the interior and add the interior chords as ordinary
> footway edges (a constrained Delaunay of the ring, or a 6 m lattice clipped to
> the polygon minus building footprints, either is enough). Tag them with a new
> flag bit so the client can tell a surveyed line from a plaza crossing if it ever
> wants to. Expected: door links on the Six Pack and both malls collapse from
> ~16-24 m to ~2 m, and the PCL→UNB class of detour drops by a third.
> `docs/walk/graph.md` §10 already lists this as a known, accepted v1 limitation —
> this is the measurement that says it is now the biggest one left.

Two smaller ones, also outside this lane:

* **`LINK_COST_MULT` belongs in the bake's `tune` block** eventually, next to
  `CROSSING_PENALTY_M`, so the client and the graph can never disagree about the
  cost model. `bake_walk.py` owns that block. Until then it is a named const in
  `js/wayfind.js` with a `WAYFIND.linkCostMult` override.
* **`doorSet()` prefers `role:'main'` doors only**, and
  `docs/walk-evidence.md` measured that our "main" is more than 15 m from UT's
  own surveyed front door about three times in four. Several of the remaining
  long links are a wrong door, not a missing path. That is the entrances lane's
  ground to cover and this pass deliberately did not touch it.

---

## 7. What this pass did NOT do

* **No lighting and no stairs work.** The brief mentioned both; neither is what
  the sidewalk number is made of. `data/props.geojson` already holds 532
  OSM-sourced street lamps (`docs/walk-evidence.md`) and nothing routes on them.
* **No indoor routing.** Ruled out.
* **No perf measurement.** Four sibling lanes were running; a timing number taken
  on this machine tonight would be a lie. The +923 polygons and +50 KB gzip are
  reported as sizes, not as costs.
* **No new verify script committed.** The shot harness and the measuring scripts
  live in the session scratchpad because `scripts/verify/` is not this lane's to
  write. The method is written out above in enough detail to rebuild them.
* **`WAYFIND.on` untouched.** Still `false`.

---

# Round 2 — the malls, and the audit moves into the repo

Same lane, same branch, later the same day. Everything above stands; nothing in
it was rewritten. This section is additive and every number in it was measured
**on top of** the branch as §0–§7 left it — kerb aprons painted, `LINK_COST_MULT`
at 4.0 — so the deltas below are this change and nothing else.

Two things landed.

## 8. `--walkaudit`: the measurement is in the repo now, not in a scratchpad

§7 above says, honestly, that the measuring scripts live in the session
scratchpad because `scripts/verify/` is not this lane's to write. That is true
and it is also the reason nobody will ever re-run them. `scripts/bake_ground.py`
IS this lane's, so the audit lives there:

```bash
python scripts/bake_ground.py --walkaudit    # no browser, no bake, ~40 s
```

It routes the twenty pairs against `data/walk_graph.json` with a Python copy of
`js/wayfind.js`'s decode + Dijkstra + `geometryOf`, samples the drawn ribbon
every metre, and reports what each metre is standing on. `WALKAUDIT_LINK_COST_MULT`
sits at the top with a comment saying it must equal `LINK_COST_MULT` in
`js/wayfind.js`; if the two drift the audit is measuring a router the app does
not have.

**It was checked against the browser before it was trusted.** Driving the real
`index.html` at `?walk=1`, calling `window.wayfindRoute()` on all twenty pairs
and reading the drawn geometry off the `wayfind-route` source: every route
distance agreed to within 0.5 m and grading the browser's own geometry gave the
same table, per route, to a tenth of a percent.

Its numbers are not the same as §0's and that is by construction, not a
disagreement: §0 samples at 0.5 m with a 10 cm tolerance and counts a mall rim
as pavement; this samples at 1 m with **zero tolerance** and counts a rim as
whatever the polygon test says. The strict version is the harder bar and it is
the one that makes the mall problem below visible instead of absorbing it.

## 9. A pedestrian mall is a WALK, and it was being drawn as a lawn-band area

§0 already spotted the mechanism and worked around it: *"42 of OSM's pedestrian
areas on this campus are drawn as `area=yes` rings… a route walking the Main
Mall runs along the Main Mall polygon's own edge, and a strict test scores it as
off-pavement."* The workaround was a 10 cm tolerance. The cause is worth fixing
instead.

Those 44 polygons — Main Mall, East Mall, the Speedway courts, the Jester, Gates
and Blanton forecourts — were emitted as `k:'area', u:'plaza'`: a **flat fill**,
in the same band as lawns and parking lots. Everything else you walk on in this
scene is a `k:'patharea'` slab standing `GROUND.pathRaise` = 0.22 m proud. Two
consequences, and the second is the one you can see:

1. **The route ribbon floated.** `WAYFIND.routeBaseM` is 0.22, pinned to
   `GROUND.pathRaise` on purpose so the ribbon rests on the pavement slab rather
   than z-fighting it. Over a mall there is no slab, so the ribbon stood 22 cm in
   the air — over **4.0 %** of the twenty routes' drawn length, and over 23 % of
   PCL→RLP.
2. **A mall was a different colour from the walks crossing it.** Sampled off two
   frames at the same pixel: the mall `rgb(224,207,175)`, a footway slab drawn
   across that same mall `rgb(237,192,132)`. In one frame, both concrete.

This file's own rank ladder already says what a mall is — `('patharea',
'pedestrian')` sits at 60, above the generic footway laid over it — and Speedway,
which OSM tags `highway=pedestrian` as a **line**, has always come out of this
bake as a `patharea`. Only the `area=yes` branch was routing the very things that
ladder entry describes into the other band.

`PEDESTRIAN_AREA_IS_A_WALK = True`. Set it False and they go back to flat plaza
fills with no other change.

### What it moved

`python scripts/bake_ground.py --walkaudit`, twenty pairs, 13,097 drawn metres,
1 m sampling, **zero tolerance**:

| | branch before | with the malls |
|---|---:|---:|
| **on a drawn WALK** (`k:'patharea'`) | 86.69 % | **90.20 %** |
| on a flat plaza fill | 3.8 % | 0.2 % |
| on any drawn surface | 96.00 % | 95.92 % |
| over bare ground | 4.00 % (524 m) | 4.08 % (534 m) |

Per route, the ones that moved (share on a drawn walk):

| pair | before | after |
|---|---:|---:|
| PCL>RLP | 54.3 % | **78.1 %** |
| PCL>JES | 69.2 % | **89.3 %** |
| GDC>PCL | 88.1 % | **97.8 %** |
| GRE>MAI | 77.9 % | **85.3 %** |
| 21 Rio>WEL | 80.6 % | **87.0 %** |
| GRE>NEZ | 81.8 % | **88.0 %** |
| GRE>MNC | 86.7 % | **89.9 %** |
| STD>MAI | 86.2 % | **88.9 %** |

**The two numbers that did not improve are the honest part.** "Any drawn
surface" moves 0.08 % the wrong way and bare ground gains 10 m of 13,097. Both
are the same thing: a mall in the path band cuts the `patharea/footway` slabs
that overlap it (rank 60 beats 52, which is what the ladder says should happen),
and a handful of the resulting slivers fall under `RESOLVE_MIN_M2` and are
dropped. It is 10 metres across twenty routes and it buys 3.5 points of correctly
classified walk plus the end of the floating ribbon. **The rim straddle itself is
untouched, and that is expected** — it is a routing problem, not a paint problem,
and §6's `bake_walk.py` patch is still the fix for it.

### What it cost

**Nothing measurable.** `data/ground.geojson` goes 5,406 → 5,409 KB raw and
**995 → 995 KB gzipped**: 44 polygons changed band, they did not multiply.
Coincident-surface conflicts pick up three pairs totalling 24 m² — two
`footway/pedestrian` and one `pedestrian/steps`, i.e. a walk and the mall it
crosses now sharing the 0.22 m band. Carriageway-versus-path overlap is
unchanged at 81 pairs / 108 m², exactly the figure §2 reports.

**One knock-on, disclosed.** Two flagpoles that stood on plaza polygons no longer
get a limestone plinth, because the polygon under them changed band. Nothing
visible changed: a plinth is `('area','plinth')` at rank 13 and a plaza was rank
30, so the surface underneath ate the plinth in the resolver anyway — the bake
reported one of them as `resolve_covered_plinth` on every run. The reasoning is
written at `PLINTH` so it cannot rot into a mystery.

### The frames — this is a taste call, so look at it

`shots/walk/sidewalks/aprons-*.png` and `malls-*.png`, same camera, near-nadir,
tree layers hidden except on the `-city` frame. The only difference between the
two sets is `PEDESTRIAN_AREA_IS_A_WALK`.

* **`2-eastmall`** is the one to look at: the Jester forecourt goes from a flat
  pale slab with the route running along its edge to paving the same colour as
  the walks that cross it, with the route on it.
* **`1-mainmall`** is the same change beside Garrison Hall.
* **`6-eastmall-city`** is the East Mall pose with the trees left in — what a
  person actually sees.

The malls are now warmer and stand 22 cm proud with a kerb stroke. Whether the
campus should look like that is Simeon's call (CLAUDE.md rule 9); it is one
constant either way.

**Near-nadir on purpose.** The first attempt at these stood at 20 m with 74° of
pitch, photographed tree trunks, and did not contain one pixel of ribbon while
the route pill in the same frame said a route was drawn. Poses are derived
offline from `data/walk_graph.json` and are identical between the two sets; the
zoom the browser reported matched the offline prediction to the second decimal
on every frame.

## 10. Two things in `js/wayfind.js` found while measuring, and not fixed here

Neither is in a graph-building function, so neither is this pass's to change.

**`overOf()` asks for the whole style, three times, per session.** It is
`map.getStyle().layers`, and `getStyle()` on this style serialises every source
carrying inline GeoJSON — trees at 27 MB, ground at 5.4 MB, roads, entrances.
`ensureLayers()` calls it three times, at exactly the moment a user first asks
for a route. The one-line fix is `map.getLayersOrder()`, which returns ids only.

It is a real allocation and it is worth removing, but **it is NOT what broke
this round's harness, and saying so is the point of this paragraph.** Six
verification runs died — five on a node heap limit at 373 / 398 / 593 / 409 s
across three different heap caps, one on chrome.mjs's 25-minute watchdog with
the page unresponsive — and a whole theory was built on `getStyle()` before the
actual cause turned up: **`df` reported the machine's C: drive at 476 G of 476 G,
zero bytes free.** Chrome and node both want scratch space and neither says so
when they cannot have it. Freeing 5.6 G ended the failures. The lesson is the
one already in `scripts/verify/README.md` in a different costume: an
instrument's environment is part of its answer, and "the harness ran out of
memory" and "the machine ran out of disk" look identical from inside the log.

**The ribbon still floats over the carriageway.** `WAYFIND.routeBaseM` = 0.22 is
right for a `patharea`, and `k:'roadarea'` is a flat `fill` at ground level.
**5.5 %** of the twenty routes' drawn length is on a carriageway — every marked
crossing — and over those metres the ribbon stands 22 cm in the air. Raising the
ground fixed the mall half of this defect; the road half cannot be fixed that way
because the road really is at zero. It needs a per-feature base chosen in
`ribbonPolys()` from what the segment is crossing.

## 11. One thing measured and rejected

Before §3's `LINK_COST_MULT` was on this branch, this round independently
measured the same lever from the other side: penalising the door link at 1.5×
cut the invented straight line from 397 m to 231 m across twenty pairs and moved
off-pavement from 5.06 % to 4.60 %, for +135 m (+1.0 %) of real walking — and it
was written off as buying a prettier drawing with a student's legs.

**That verdict was wrong and §3 is right.** The argument this round missed is in
§3's own evidence: the far anchor Burdine was taking is not merely unsurveyed,
it crosses the building, and the app was drawing a dashed leg over the roof. The
extra metres are not paid for a nicer picture, they are paid to stop claiming a
line nobody can walk. Recorded here so the measurement is not repeated a third
time and so the reasoning that beat it is on the record.
