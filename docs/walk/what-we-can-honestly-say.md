# What the walking feature is allowed to say

Written 2026-08-15, Acer lane, before any routing code exists. Every number
below was counted out of the files in this repo on that date; nothing here is
recalled and nothing is estimated unless it says so.

**Why this document is the first one.** Until now the failure mode on this
project was "that building looks a bit off". Here it is "that made me late for
my exam", and in one case — accessibility — it is "that stranded me at the
bottom of a staircase". A route that is beautiful and wrong is worse than no
route. So: the wording ships from this file. The build phase follows the two
lists at the end literally, and if it wants to say something that is on neither
list, it comes back here first.

The short version, if you read nothing else:

* **Stairs: yes.** We can honestly tell someone a route uses stairs and how many
  separate staircases. We cannot tell them how many steps.
* **Hills: no.** There is no elevation data in this repo, at all. The "12
  minutes but it's uphill" half of the pitch is not currently available.
* **Time: only as a range.** Never one number.
* **Step-free: avoid stairs, never say "accessible".**
* **The door: for 24 of 198 buildings we know the real door.** For 82 more we
  have a good guess and must word it as one. For 92 we have nothing.
* **Hours: we have none for any building.** The interface must never imply a
  building is open.

---

## 1. What was checked

Counted directly out of:

| file | what it is | snapshot |
|---|---|---|
| `data/osm_cache/footways.json` | the walk network, 3,430 ways, all with geometry | Overpass `2026-07-30T16:47:30Z` |
| `data/osm_cache/construction.json` | 87 features, 26 of them walkable ways under construction | `2026-07-30T17:07:05Z` |
| `data/osm_cache/places.json`, `food.json` | 143 distinct named POIs, 107 of them food/drink | `2026-07-31` / `2026-07-30` |
| `data/entrances.geojson` | 11,777 polygon pieces = 629 distinct doors on 280 buildings | baked |
| `data/ut_buildings.json` | UT's own register: 198 codes, names, numbers, year occupied | scraped `2026-08-05` |
| `data/westcampus.geojson` | 24 named apartment towers | baked |
| `scripts/bake_entrances.py`, `docs/entrances/placement.md` | how the doors got there, and its own accuracy measurements | — |
| `js/app.js`, `js/ground.js`, `js/controls.js` | whether anything in the app knows about ground height | — |

Everything below cites one of those. No browser was opened; nothing here needed
one.

---

## 2. The network itself, measured

```
3,430 ways, 10,637 nodes, 161.1 km of walkable line
  footway     3,098 ways   143.6 km
  pedestrian     55 ways     8.5 km
  cycleway       70 ways     6.3 km
  path           18 ways     1.4 km
  steps         189 ways     1.4 km
bbox  lon -97.75456 .. -97.72226   lat 30.27362 .. 30.29816   (3.11 km x 2.73 km)
```

**Connectivity.** 59 connected components. The largest holds **10,026 of 10,637
nodes (94.3 %)** and 3,256 of 3,430 ways. Thirty components are three nodes or
fewer — stubs, driveway aprons, orphaned crossings.

So roughly **5 % of the network is on an island** and a route to or from it does
not exist. The interface must be able to say *no route found* and must never
paper over a gap with a straight line, because a straight line across this
campus goes through buildings.

**Tag coverage across all 3,430 ways** (this table is the whole audit in
miniature — the first column is what OSM knows, and it is thin):

```
surface        1,457 (42 %)      incline           86 (2.5 %)
crossing         824 (24 %)      handrail          72 (2.1 %)
bridge            65 (1.9 %)     wheelchair        59 (1.7 %)
access            44 (1.3 %)     lit               23 (0.7 %)
covered           14 (0.4 %)     step_count        10 (0.3 %)
indoor             1
```

**Crossings.** 805 ways are `footway=crossing`: 136 `traffic_signals`, 318
`uncontrolled`, 347 `unmarked`, 23 `marked`. This is the largest single source of
timing error and it is quantified in §3.

**Closures.** `construction.json` holds 26 walkable ways under construction, and
**none of them appear in `footways.json`** (they carry `highway=construction`, so
the footway query never saw them). Good news: the router cannot send anyone down
a sidewalk that OSM knows is closed. The residual risk is closures nobody has
mapped, which is a freshness problem (§9), not a graph problem.

---

## 3. "9 minutes" — RULE: a range, never a number, and never a clock time

**There is no walking speed anywhere in this repo, and there cannot be** — it is
a property of the person, not of the campus. Any number we print is our
assumption multiplied by their legs.

Two sources of spread, and only one of them is arguable:

1. **Walking pace.** Ordinary adult walking sits around 1.1–1.4 m/s. On a 1 km
   cross-campus route that alone is **12.1 min to 15.2 min** — a 25 % spread
   before anything else happens.
2. **Signalised crossings, which we can actually count.** 136 ways in the
   network are `crossing=traffic_signals`. A Guadalupe or MLK cycle is on the
   order of 90 s, so each signalised crossing on a route is **0 to ~90 s of
   waiting** and the router knows exactly how many it hits.

**Ruling.** The interface may show a **range**, produced from a low and a high
walking speed plus a per-signal wait allowance, rounded to whole minutes. It may
not show a single number, may not show seconds, and may not show an arrival
clock time or a "leave by" — those convert an assumption into a promise, and a
promise is the thing that makes someone late.

Round outward, never inward: `11-14 min`, not `12 min`.

Every one of those values is a named constant the build must expose:
`WALK_SPEED_LOW`, `WALK_SPEED_HIGH`, `SIGNAL_WAIT_S`, `TIME_ROUND_MIN`.

---

## 4. "3 flights up" — RULE: count staircases, never steps

`step_count` is on **9 of the 189 step ways (4.8 %)**. The values are
3, 3, 4, 4, 5, 7, 12, 21, 21.

**Could we estimate the rest from length?** That was the obvious rescue, so it
was tested on the only nine samples that exist:

| step_count | way length | metres per step |
|---|---|---|
| 21 | 63.8 m | 3.04 |
| 21 | 64.2 m | 3.06 |
| 12 | 9.9 m | 0.82 |
| 7 | 2.5 m | 0.35 |
| 5 | 2.5 m | 0.51 |
| 4 | 1.5 m | 0.38 |
| 4 | 1.3 m | 0.34 |
| 3 | 1.2 m | 0.39 |
| 3 | 0.9 m | 0.29 |

**0.29 to 3.06 m per step — a 10.5x spread.** The estimator would be wrong by an
order of magnitude, and it would be wrong in the confident direction (the two
long ones are almost certainly stairs drawn with their landings and ramps
included). So: **step counts cannot be estimated from geometry, and the feature
must not try.**

But look at what we *do* have. The router knows **exactly how many distinct
`highway=steps` ways a route traverses**, because it traverses them. 189 step
ways, median length 3.7 m, 128 of 189 under 5 m — these are individual
staircases, and counting them is counting a real thing.

**Ruling.**

* MAY say: *"This route uses stairs."*
* MAY say: *"Stairs: 3 sets."* (a count of step ways on the route — measured)
* MAY say: *"21 steps"* **only** on the 9 ways that carry `step_count`, and only
  worded as someone else's count: *"OpenStreetMap counts 21 steps here."*
* MAY say: *"Handrail"* on the 60 ways tagged `handrail=yes`, and *"no
  handrail"* on the 8 tagged `handrail=no`. Silence on the other 121.
* MAY NOT say **"flights"** in any form. A flight is a run between landings and
  nothing in the data records landings.
* MAY NOT total steps across a route, ever — 4.8 % coverage means the total is
  always an undercount presented as a total.

---

## 5. "Uphill" — RULE: cannot be said at all. This changes the pitch.

This was checked properly, because the app is 3D and it is reasonable to assume
something knows about height. It does not.

**There is no elevation data in this repo.**

* **Zero `ele` tags in `footways.json`.** Not sparse — zero.
* **35 `ele` tags in the entire `data/osm_cache/`**, every one of them on a
  *building or park polygon* in the Capitol / east-campus area, values 143–184 m.
  Those are spot heights on whole objects. They cannot be interpolated onto a
  path network, they do not cover main campus, and they are not a surface.
* **No DEM, no terrain source, no hillshade.** `js/ground.js:1405` says it in as
  many words: *"There is no terrain in this scene — no DEM, no MapLibre terrain
  source"*, and the creek's depth is faked with a shadow line for exactly that
  reason.
* **Terrain is deliberately off in the app.** `js/app.js:333`: terrain
  *"culled buildings and made them float on slopes"*, so it was disabled.
  `js/controls.js:32` builds the whole eye-level camera on the assumption
  `transform.elevation === 0`.

The 3D in this app is building extrusions standing on a **flat plane**. Nothing
in it knows that campus has hills.

**What about `incline`?** 86 ways carry it, and every single value is `up` or
`down` — 48 and 38. That is a *direction relative to the way's node order*. It
carries no gradient, no height gain, no length of climb. And 86 of 3,430 is
2.5 % coverage, which means the absence of an incline tag is not evidence of
flatness; it is evidence that nobody surveyed it. Using it would produce the
worst possible artefact: a route confidently marked flat because it happens to
run over unsurveyed ways, next to one marked steep because a single mapper was
thorough.

**Ruling. Hills are out of scope for this feature as the data stands.** Nothing
about uphill, downhill, gradient, climb, elevation gain, "it's a hill", or a
little mountain icon. Not even for the 86 tagged ways — partial coverage
presented as a feature is worse than no feature, because the user cannot see the
holes.

**And say this plainly to Simeon, because it edits the pitch.** Wedge #1 in the
brief was "stairs and hills". **The stairs half is real and is the best thing in
the feature. The hills half does not exist yet.** The honest line is *"12 min,
three sets of stairs — or 14 min with none"*, and that is still something Google
does not say.

If hills are wanted later, the route is a real DEM — USGS 3DEP lidar covers
Travis County at 1 m — sampled onto the walk-graph nodes as a **separate,
explicitly scoped job** with its own accuracy audit. It is not a bolt-on to this
one, and the resulting graph would still be a derived database (§10).

---

## 6. "Step-free route" — RULE: we may avoid stairs. We may not say "accessible".

This is the claim where being wrong hurts a specific person, so the standard is
higher than everywhere else.

What the data actually holds:

```
wheelchair=* on 59 of 3,430 ways (1.7 %) — yes 48, no 11
  by type: footway 42, path 10, steps 6, pedestrian 1
ramp=* on 13 ways (yes 1, no 9, separate 3), ramp:wheelchair on 1
tactile_paving on 31 ways (yes 6, no 25)
kerb tagged on 1 way in the entire network
```

**48 positive wheelchair tags out of 3,430 ways is 1.4 % coverage.** Offering a
route badged "accessible" off the back of that would be irresponsible, and here
is the concrete failure: a route can avoid every tagged staircase and still
contain an untagged step, an unramped kerb (kerbs are essentially unmapped — one
tag), a door with no power operator, a locked side entrance, or a construction
detour. We would have no way of knowing, and the user would have no way of
seeing that we did not know.

There is also nothing about the doors. `data/entrances.geojson` carries
`role`, `src`, materials and colours. It has **no accessibility field at all** —
no power operator, no ramp, no threshold height, no automatic door.

**Ruling: ship the avoidance, never the badge.**

The option is a filter over the graph, not a promise about the world. It is
named for what it does — it avoids stairs — and it carries its own limits in the
interface, next to the toggle, not buried in an about page.

Draft wording, and the build should use it close to verbatim:

> **Avoid stairs**
> Routes around every staircase OpenStreetMap has mapped on campus.
> This is not an accessibility check. We don't have data on kerbs, ramps,
> door widths or automatic doors, and there may be steps nobody has mapped.

And when such a route is shown:

> Avoids 189 mapped staircases. Kerbs and doorways are not checked.

Never `accessible`, `wheelchair accessible`, `ADA`, `step-free`, `barrier-free`,
or a wheelchair icon. "Step-free" is the specific trap: it sounds descriptive and
reads as a guarantee, and we cannot back it.

---

## 7. "The door you should use" — RULE: draw it, but say where it came from

This is the best idea in the feature and the one most likely to be oversold, so
the numbers matter. Counted out of the shipped `data/entrances.geojson`:

```
629 distinct doors on 280 buildings

by source                      by role
  derived     543  (86.3 %)      main       274   (236 of them derived)
  osm          63  (10.0 %)      secondary  341
  westcampus   21  ( 3.3 %)      service     10
  authored      2  ( 0.3 %)      emergency    2, exit 2

buildings with at least one OSM-sourced door:  31 of 280
buildings whose doors are ALL derived:        249 of 280
```

**What "derived" actually means.** `scripts/bake_entrances.py` places them two
ways, and its own docstrings are admirably honest about both:

* **Stage 2, path evidence** — a footway physically crosses the footprint edge,
  or dead-ends within a few metres of it. That is real evidence: a path that
  runs into a wall runs into a door.
* **Stage 3, "the publicness field"** — for buildings stage 2 could not fill,
  score every wall segment by how much walkable line faces it and put a door at
  the best point. The docstring says it straight: *"it supplies most of the
  file"*. In the run recorded in `docs/entrances/placement.md`, **345 of 614
  doors came from the publicness field and 269 from a path.**

A publicness-field door means *"this wall faces open space, so a door is
plausible here"*. It does not mean a door is there.

**How accurate is the derivation?** `docs/entrances/placement.md` measures it
against the OSM entrance nodes and the numbers are good but they measure the
right thing only half-way:

* **Recall 78 %** of in-scope OSM entrance nodes within 8 m; **15 of 17**
  `entrance=main` recovered; median position error 0.00 m.
* **Precision is unmeasurable and the doc says so** — OSM's median building
  carries one mapped entrance and manifestly has more, so measuring precision
  against it measures OSM.

Recall answers *"when a real door exists, do we put one near it?"* — usually
yes. It does not answer *"is the door we drew real?"*, and routing asks the
second question.

**And the misses are named, which is the part a router has to respect.** Fifteen
buildings where the nearest derived candidate is 9–76 m from the real door:
Norman Hackerman **76 m**, Bellmont **58 m**, Red McCombs Red Zone ×3 **40–48 m**,
Jackson Geological **38 m**, Mezes **31 m**, East Campus Garage **20 m**,
Carothers **16 m**, Almetris Duren **15 m**, Doty Fine Arts **14 m**, Jester West
**13 m**, Moody Center **12 m**, Main Building **9 m**, ETC II **9 m**. They share
a cause — the door opens onto a plaza or a mall, which OSM draws as an area, and
stage 2 cannot see a polygon.

**A 76 m error on a door instruction is a wrong instruction**, and it is on the
Main Building's neighbours, i.e. the buildings people actually walk to.

### The proposed rule, per door

| `src` | doors | what the route may do | wording |
|---|---|---|---|
| `osm` | 63 | end **at** the door, 3D highlight, name it | *"The main entrance"* / *"An entrance"* per its role |
| `westcampus`, `authored` | 23 | end at the door, highlight | *"The lobby entrance"* — ours, hand-placed |
| `derived` | 543 | end at the **side of the building**, softer marker | *"Entrances are on this side"* — never a definite article |
| none | — | end at the **building outline**, and say so | *"We don't have door locations for this building."* |

Three hard consequences of that table:

1. **A derived door may never be called "the main entrance"**, even though 236 of
   them carry `role: "main"`. That role was assigned by `assign_roles()` as
   *"best-scoring entrance on a building that has no main yet"* — it is a
   ranking, not an observation.
2. **The last leg is not a surveyed path.** Between the walk network and the door
   there is a straight line across whatever is actually there. It must be drawn
   differently from the routed path — dashed, lighter — so the picture itself
   tells the truth about which part is surveyed.
3. **A schema request for whoever owns `bake_entrances.py`:** the shipped file
   collapses stage 2 and stage 3 into one `src: "derived"`, so the app cannot
   tell "a path runs into this wall" from "this wall faces a lawn". Those deserve
   different wording and one extra key (`gen: 2 | 3`) would give it to us. Not
   this lane's file to change — recorded here per CLAUDE.md rule 1.

### Search coverage, and it is the number Simeon will want

Cross-checking the 198 codes in UT's own register against the doors we have:

```
198 UT building codes in the register
106 have at least one modelled door         92 have none
 of the 106:
   24 have at least one OSM-verified door
   82 have only derived / authored doors
```

Plainly: **type a building code and we can point at a real, verified door for
about one building in eight.** For another 82 we can point at the right side of
the right building. For 92 — including ACS, BME, BMS, ANB, ATT, CDL and 86 more
— we have no door at all and the route has to end at the outline and say so.

That is not a reason to cut the feature. Ending at the correct *side* of the
correct building, drawn in 3D on a building you can see, is still better than a
pin in the middle of a blob. It is a reason the wording has to carry its own
confidence, and a reason the "we have 584 modelled entrances" line should never
be said out loud as though 584 doors were surveyed.

---

## 8. Opening hours — RULE: never imply anything is open

**Buildings: we have nothing.**

* `data/ut_buildings.json` holds `ref`, `name`, `number`, `occupied` (year) and
  nothing else. No hours, no rooms, no accessibility.
* `footways.json` carries zero `opening_hours`.
* No building-hours source exists in this repo, and UT does not publish one in a
  machine-readable form.

A route to a locked door at 23:00 is a wrong route, and we cannot detect it. So
the interface must not imply entry. Concretely: no "open", no "closed", no
"open until", no green dot, no "you'll arrive at 22:47" (which implies arriving
gets you in), and the door label must read as a location, not an invitation.
*"West entrance"* is fine. *"Enter here"* is not.

**Food and coffee: partial, and the partial part is the dangerous part.**

* 107 distinct named food/drink POIs across `places.json` + `food.json`;
  **58 of them (54 %) carry real `opening_hours` strings** like
  `Mo-Th 11:00-21:00; Fr,Sa 11:00-22:00`.
* But the **baked** `data/places.geojson` throws the strings away. It carries a
  single binary `open` flag meaning *open at 22:00*, for 133 tenant slots, with a
  provenance key `hsrc`: **72 sourced (`S`), 61 guessed (`G`)**.
* The guess comes from `OPEN_AT_22`, a category habit table, and the bake's own
  manifest describes it as *"wrong about one in six"*. It exists to decide
  whether a shopfront glows at night. It is a lighting decision and it is a
  perfectly good one — it is **not** an opening-hours source.

**Ruling for the coffee stop, if it ships:** read the real strings from
`data/osm_cache/places.json` / `food.json`, show hours **only** where the string
exists, show **nothing** where `hsrc` would be `G` — never surface the guess as a
fact — and attribute: *"OpenStreetMap lists 07:00-15:00. Check before you go."*
Never *"open now"*.

---

## 9. Four more things the wording has to carry

**Freshness.** The walk network is an Overpass snapshot taken
**2026-07-30**. It is 16 days old as this is written and it will keep ageing.
Sidewalk closures, new construction hoarding and reopened paths after that date
are invisible to us. The interface should carry the date somewhere quiet —
*"Campus paths from OpenStreetMap, 30 July 2026"* — and never present a route as
live. Make it a named constant, `DATA_AS_OF`, read from the file rather than
typed.

**No route is a real answer.** 5 % of the network is off the main island. When
Dijkstra fails, say *"No walking route found"*. Never draw a straight line
between two points and never silently return the nearest thing that worked.

**Never through a building.** Exactly **one** feature in the entire OSM cache
carries an `indoor` tag. There are no floor plans and there will not be. The
route stops at a door or at an outline, and the interface must never imply it
knows a floor, a room, or a way through.

**"From where you are" does not exist yet.** There is no geolocation anywhere in
`index.html` or `js/` — no `navigator.geolocation`, no `GeolocateControl`. When
it is added: browser GPS on a dense campus is good to roughly 5–20 m outdoors
and is unreliable indoors, which is exactly where a student checking their next
class is standing. So the start point must be settable by hand, the located
position must be shown as an area rather than a point, and the app must never
say *"you are here"* in a voice more confident than the sensor. It is also a
permission prompt and a privacy surface: the position never leaves the browser,
which is easy to guarantee here because the whole architecture is client-side —
and worth saying in the interface, because it is a genuine advantage over the
alternatives.

---

## 10. Licence, in one paragraph

OpenStreetMap data is published under the **Open Database Licence 1.0 (ODbL)**.
It is free to use and modify, and it carries two obligations. **Attribution:**
wherever the data is shown, credit "© OpenStreetMap contributors" visibly — that
is the bottom-right credit line the app already has, and `docs/aws/RECORDING-BRIEF.md`
already records that it is a licence condition and not decoration, that it must
survive the AWS recording, and that if compression makes it unreadable the fix is
a credit in the video description, never removing it from the app. **Share-alike:**
`data/walk_graph.json` will be built by extracting and restructuring OSM ways, so
it will be a **Derivative Database**, and because it ships in a public repo and is
fetched by the browser it counts as publicly used. It must therefore be offered
under ODbL 1.0 and say so — practically, one `_license` and one `_source` key
inside the file (exactly the pattern `data/ut_buildings.json` already uses) plus a
line in the repo README. A route *picture* drawn from that database is a Produced
Work: it needs the attribution, not the share-alike. None of this touches the
app's own JavaScript — ODbL covers the database, not the code that reads it. One
separate note: `data/ut_buildings.json` is scraped from UT's own building
register, is not OSM and is not ODbL, and already carries the line *"Not
affiliated with UT Austin"* — that disclaimer has to survive into any interface
that shows UT building names and codes.

---

## 11. SENTENCES THE INTERFACE MAY USE

Copy these. Where a number appears it comes from the route or the file, not from
a person.

**Distance and time**
* `11-14 min walk`
* `About 12-15 minutes at an ordinary walking pace`
* `950 m`
* `Crosses 2 signalised crossings — add up to a minute and a half if the lights are against you`

**Stairs**
* `This route uses stairs`
* `Stairs: 3 sets`
* `No stairs on this route` — permitted, because it is a statement about mapped stairs and the toggle wording next to it says so
* `OpenStreetMap counts 21 steps here` (only on the 9 ways with `step_count`)
* `Handrail on both flights` / `No handrail here` (only where `handrail` is tagged)

**The stairs-avoidance option**
* `Avoid stairs`
* `Routes around every staircase OpenStreetMap has mapped on campus.`
* `This is not an accessibility check. We don't have data on kerbs, ramps, door widths or automatic doors, and there may be steps nobody has mapped.`
* `Avoids 189 mapped staircases. Kerbs and doorways are not checked.`

**Doors** — pick by `src`
* `The main entrance` — `src: osm`, `role: main` only
* `An entrance` / `A side entrance` — `src: osm`, other roles
* `The lobby entrance` — `src: westcampus` / `authored`
* `Entrances are on this side` — `src: derived`
* `Most people approach from here` — `src: derived`, stage-2 only, once `gen` exists in the file
* `We don't have door locations for this building — the route ends at the building`
* `The last stretch isn't a mapped path` — for the door leg

**Food on the way**
* `Coffee on the way: Medici, 200 m off route`
* `OpenStreetMap lists 07:00-15:00. Check before you go.`

**Honest limits, said out loud**
* `No walking route found`
* `Campus paths from OpenStreetMap, 30 July 2026`
* `Paths may have changed since then`
* `We can't route inside buildings`
* `Your location stays in your browser`
* `© OpenStreetMap contributors`
* `Not affiliated with UT Austin`

---

## 12. SENTENCES IT MAY NOT USE

Each one is followed by why, so the build can argue with the reason rather than
guess at the rule.

**Time**
* ~~`9 minutes`~~ — single number, no error bar. Range only.
* ~~`9 min 40 s`~~ — precision we do not have by two orders of magnitude.
* ~~`Arrive 10:47`~~ / ~~`Leave by 10:35`~~ — turns an assumption into a promise, and implies the building lets you in.
* ~~`Fastest route`~~ — we optimise a graph, we do not know the campus's crowds, lights or your legs.

**Stairs**
* ~~`3 flights up`~~ — nothing records landings; a flight is not in the data.
* ~~`40 steps`~~ (as a route total) — 4.8 % `step_count` coverage; every total is an undercount dressed as a total.
* ~~`About 20 steps`~~ (estimated from length) — measured 10.5x spread on the only 9 samples that exist.
* ~~`Mostly flat with a few steps`~~ — "flat" is an elevation claim (below).

**Hills — the entire family, none of it is available**
* ~~`Uphill`~~ / ~~`Downhill`~~ / ~~`It's uphill from here`~~
* ~~`Gentle climb`~~ / ~~`Steep`~~ / ~~`12 m of climb`~~ / ~~`4 % grade`~~
* ~~`Flat route`~~ — asserting no hill is as much an elevation claim as asserting one.
* ~~`Avoids the hill`~~ — and no hill icon, no elevation profile, no little mountain.
  *Reason for all of the above:* zero elevation data in the repo; terrain deliberately disabled; `incline` is a direction on 2.5 % of ways, not a gradient.

**Accessibility**
* ~~`Accessible route`~~ / ~~`Wheelchair accessible`~~ / ~~`ADA route`~~ / ~~`ADA compliant`~~
* ~~`Step-free`~~ / ~~`Barrier-free`~~ / ~~`Fully accessible`~~
* ~~`Suitable for wheelchairs`~~ — and no wheelchair icon on a route.
  *Reason:* 1.4 % positive coverage, one kerb tagged in the whole network, zero accessibility fields on any door.

**Doors**
* ~~`The main entrance`~~ for a `derived` door — the role is a ranking, not an observation.
* ~~`Use this door`~~ / ~~`Enter here`~~ for any door — implies it is open and that it is the right one.
* ~~`584 modelled entrances`~~ as a boast — 86 % are derived; the verified figure is 63 doors on 31 buildings.
* ~~`Door-to-door routing`~~ — 92 of 198 UT buildings have no door in the file.
* ~~`Takes you to the right door every time`~~ — the known worst-case position error is 76 m.

**Hours and state**
* ~~`Open now`~~ / ~~`Closes at 10`~~ / ~~`Open until late`~~ for any **building** — we have zero building hours.
* ~~`Open now`~~ for a food POI where `hsrc` is `G` — that is a category habit table the bake itself calls wrong one time in six.
* ~~`Live`~~ / ~~`Real-time`~~ / ~~`Up to date`~~ — a 30 July 2026 snapshot.

**Routing itself**
* ~~`Takes into account all pathways and walkways`~~ — it takes into account the 3,430 ways OSM had on 30 July, minus a 5 % island, plus whatever nobody mapped.
* ~~`Through the building`~~ / ~~`Exit the north side of Welch`~~ — one indoor tag in the entire cache; no floor plans exist.
* ~~`You are here`~~ stated flatly — GPS is 5–20 m here and unreliable indoors.
* ~~`Shortest walk`~~ — say `shortest mapped walk` or nothing.

---

## 13. Named constants the build must expose (CLAUDE.md rule 11)

Not taste values, but the same principle: every one of these is a judgement
someone should be able to overrule in one line, and every one of them changes
what the interface is claiming.

```
WALK_SPEED_LOW_MS      1.1    // m/s — the slow end of the printed range
WALK_SPEED_HIGH_MS     1.4    // m/s — the fast end
SIGNAL_WAIT_S          45     // added to the high end per crossing=traffic_signals
TIME_ROUND_MIN         1      // round the range outward to whole minutes
STAIR_COUNT_SHOW       false  // never total step_count across a route
DOOR_TRUST_SRC         ['osm','westcampus','authored']  // may be named "the" door
DOOR_MAX_SNAP_M        25     // beyond this, end at the outline instead
DATA_AS_OF             read from footways.json osm3s.timestamp_osm_base
AVOID_STAIRS_LABEL     'Avoid stairs'   // never 'step-free', never 'accessible'
```

---

## 14. What this audit did NOT do

* **Did not open a browser, run a server, or take a screenshot.** This phase was
  files only, as scoped.
* **Did not verify any door against reality.** Everything about door accuracy
  comes from `docs/entrances/placement.md`'s own measurements against OSM nodes,
  which is a check against a source that under-maps. Nobody has stood in front of
  Norman Hackerman.
* **Did not check whether a route between two named buildings actually looks
  sane.** That is the build phase's first job and it should be done by eye, on
  routes someone has walked — the sanity test in the brief is the right one.
* **Did not measure walking speed on this campus.** The 1.1–1.4 m/s band is
  general literature, flagged as an assumption everywhere it appears, and
  exposed as a constant precisely because it is the softest number here.
* **Did not audit `data/surfaces.json`** (2,205 features, 61 `incline`, 9
  `step_count`, 56 `wheelchair`) as a second walkable source. It is used by the
  entrance bake's publicness field and may add coverage; the tag *density* is no
  better than `footways.json`, so it would not change any ruling above, but the
  counts in §2 are `footways.json` only.
* **Did not resolve whether Overture footprints or OSM footprints should own the
  building outline** for the "route ends at the outline" case. Both are in the
  repo; they agree for 77 of 81 checked (`placement.md`).
* **Did not write any code, and changed no data file.** The only file this pass
  wrote is this one.
