# The ground plane: what is there, and where it came from

Branch `data/ground-life`. This pass is about everything below the buildings —
trees, street furniture, planting, lighting. The brief was that middle and west
campus had some and **east campus had close to none**, and that 501 props for an
entire university was the real hole.

Everything below is measured, not estimated. Regenerate any of it with the
commands in [Rebuilding](#rebuilding).

---

## 1. Why east campus was bare — and it was not a rendering problem

The tree pipeline had three sources, and all three stop before east campus:

| source | what it covers | why it misses east campus |
|---|---|---|
| OpenStreetMap `natural=tree` | 498 nodes in the bbox | almost nothing on UT land; **none on the malls** |
| City of Austin Tree Inventory (Socrata `wrik-xasw`) | 1,566 rows | the city surveys **city** land; UT is state property |
| `scripts/detect_canopy.py` (crowns read off nadir aerial imagery) | 1,557 crowns | it had only ever been **pointed at three hand-drawn rectangles** — `southmall`, `corridor`, `westcampus`, all of them west of −97.7375 |

So east campus was not under-rendered. **Nobody had ever looked there.** The PCL,
the LBJ grounds, Waller Creek, Clark Field, San Jacinto and the whole athletic
precinct had zero coverage in every source at once.

`scripts/fetch_canopy_grid.py` fixes that: it walks the **entire** app bbox in
56 overlapping chunks, prefetches the imagery tiles in parallel (a sequential
sweep of ~1,400 tiles is what made this look impossible before), and runs the
existing detector over every one. 17,483 raw crowns, in 142 seconds.

The detections were checked against the photograph before anything was baked —
`python scripts/detect_canopy.py --bbox=… --debug` writes an overlay PNG with a
magenta circle on every detection. On the Gregory Gym / Waller Creek block the
circles land on real crowns.

---

## 2. Trees — before and after

| | before | after | ×|
|---|---|---|---|
| **trees** | 2,572 | **12,137** | 4.7 |
| features (trunk + canopy) | 5,144 | 19,440 | |
| west (lon < −97.741) | 1,106 | **5,018** | 4.5 |
| mid (−97.741 … −97.734) | 533 | **2,889** | 5.4 |
| **east (lon > −97.734)** | **933** | **4,230** | **4.5** |
| file | 1.6 MB | 6.3 MB | |

East campus still has fewer trees than West Campus, and that is correct: it
holds DKR, the Moody Center, the LBJ complex and a great deal of surface
parking. What it no longer has is *nothing*.

### Provenance, per tree

Every canopy feature carries `src`.

| `src` | trees | POSITION | RADIUS | HEIGHT |
|---|---|---|---|---|
| `city` | 878 | **factual** — surveyed lon/lat, City of Austin inventory | modelled from the **measured** trunk diameter (DBH), per species group | modelled |
| `osm` | 489 | **factual** — the mapped node | OSM `diameter_crown` where tagged, else modelled | OSM `height` where tagged, else modelled |
| `imagery` | 10,770 | **factual** — a crown is only emitted where the photograph shows one | **measured** from the detected blob | modelled |

**No source anywhere records tree height.** Height is modelled in every single
case. That is stated in the bake report too, and it is the one number nobody
should cite as fact.

### What the imagery pass added on top of position

A nadir photo tells you a crown's radius and nothing else, so species is
**generative** — but not arbitrary. Radius is bucketed against the real
campus mix (live oak dominates anything with a big crown; the small stuff is
overwhelmingly crepe myrtle), ties broken by a deterministic hash of the
position, and anything of size within 26 m of mapped water becomes bald cypress
— which is what actually lines Waller Creek.

Each species then carries its own **habit**: height-from-radius, crown squash
range, and how far up the trunk the crown starts. A pecan of a given spread is
far taller than a live oak of the same spread, and since `js/timeofday.js` ramps
canopy colour on height, **species variety is what produces tonal variety**.
Measured spread after the change: 5th percentile 4.4 m, median 9.1 m, 95th 19.2 m
— 2,045 trees below the ramp's light end and 1,270 above its dark end.

| species group | trees |
|---|---|
| live oak | 3,329 |
| crepe myrtle | 2,329 |
| cedar elm | 2,034 |
| magnolia | 1,449 |
| pecan / hickory | 970 |
| Ashe juniper | 733 |
| bald cypress | 598 |
| other / oak / palm (surveyed species, unchanged) | 695 |

### What was thrown away, on purpose

- **1,421 crowns detected on top of a building footprint.** Green roofs,
  courtyard trees read one wall too far, and roof shadow. Trees do not grow on
  roofs. Tested against the latest snapshot's footprints.
- **97 crowns detected on water.** Pool and pond reflections.
- **5,605 duplicates** across the three sources (4 m grid). A surveyed tree
  always wins, so it keeps its real species and its measured diameter.

### Known residual

14 crowns of 12,137 (0.1%) have their centre inside a mapped carriageway — 8 of
them on East 24th Street and Speedway. Those two are genuinely tree-tunnelled:
the canopy meets over the road and the detected crown centre is over asphalt.
They were left in; removing them would make two of the most heavily treed
streets on campus look barer than they are.

---

## 3. Props — before and after

**501 → 9,022 features:** 6,073 objects plus 2,949 light points (one per lamp
and per emergency phone). By provenance: **1,484 OSM-positioned, 346
City-of-Austin-surveyed, 7,192 placed by a named rule.**

| object | before W/M/E | after W/M/E | before | after | source |
|---|---|---|---|---|---|
| `street_lamp` | 72 / 29 / 93 | 1206 / 927 / 773 | 194 | **2,906** | proc 2,713 + osm 193 |
| `bicycle_parking` | 26 / 111 / 41 | 565 / 378 / 156 | 178 | **1,099** | proc 591 + **city 330** + osm 178 |
| `planter` | – | 12 / 261 / 135 | 0 | **408** | proc 408 |
| `scooter` | – | 109 / 131 / 75 | 0 | **315** | proc 315 |
| `bench` | 11 / 20 / 12 | 82 / 116 / 116 | 43 | **314** | proc 271 + osm 43 |
| `bollard` | – | 17 / 121 / 65 | 0 | **203** | osm 155 + proc 48 |
| `waste_basket` | 15 / 15 / 4 | 49 / 61 / 57 | 34 | **167** | proc 133 + osm 34 |
| `fence` | – | 18 / 36 / 34 | 0 | 88 | osm 88 |
| `bus_stop` | – | 28 / 25 / 31 | 0 | 84 | osm 84 |
| `traffic_signals` | – | 39 / 24 / 17 | 0 | 80 | osm 80 |
| `gate` | – | 17 / 13 / 46 | 0 | 76 | osm 76 |
| `phone` (blue-light) | – | 2 / 26 / 15 | 0 | 43 | osm 43 |
| `mast` | – | 6 / 5 / 27 | 0 | 38 | osm 38 |
| `art` | 1 / 22 / 8 | 2 / 22 / 10 | 31 | 34 | osm 31 + city 3 |
| `shelter` | – | 9 / 18 / 7 | 0 | 34 | osm 34 |
| `flowerbed` | – | 22 / 3 / 4 | 0 | 29 | osm 29 |
| `bicycle_rental` | – | 11 / 8 / 3 | 0 | 22 | **city 13** + osm 9 |
| `wall` | – | 2 / 12 / 7 | 0 | 21 | osm 21 |
| `cons` | 8 / 7 / 2 | 8 / 7 / 2 | 17 | 17 | osm 17 |
| `flagpole` | – | 0 / 9 / 2 | 0 | 11 | osm 11 |
| `charging_station`, `defibrillator`, `outdoor_seating`, `fire_hydrant`, `lift_gate`, `bicycle_repair_station`, `information`, `picnic_table`, `atm`, `garden`, `drinking_water`, `post_box`, `vending_machine`, `toilets`, `street_cabinet`, `advertising`, `fitness_station` | – | – | 4 | 78 | osm |
| **total objects** | 133 / 207 / 161 | **2,225 / 2,253 / 1,595** | **501** | **6,073** | |

### Where each one came from

**`src=city` — 346 features. POSITION factual, from the City of Austin's own
inventories** (`scripts/fetch_city_props.py`). These were the biggest available
truth upgrade and the pipeline had never touched them:

- **330 surveyed bike racks** from the ATD `Bike_Parking_VL` ArcGIS layer, each
  with a `TYPE` and a `NUMBER_OF_ASSETS`. The drawn length comes from the
  survey, so a single U-shaped hoop is 1 m and a 13-rack bike corral is 6.5 m —
  the one thing the survey genuinely tells you is not thrown away. They are
  inserted **before** the procedural rule, which then refuses to place inside
  25 m of one; 93 guessed racks were displaced by surveyed ones.
- **13 active MetroBike docking stations** from `bcycle_kiosks`, drawn at
  0.72 m of dock run per dock, so a 15-dock station is 11 m of hardware. The 8
  closed kiosks in the bbox are skipped.
- **3 City of Austin public artworks** with real titles and artists, from
  Socrata `uuk6-933w` — deduplicated against the OSM Landmarks pieces.

**Checked and genuinely not available**, so nobody repeats the search: the city
publishes no bench, bin, planter or street-lamp inventory (the Socrata catalogue
returns zero results for "street furniture", "bench" and "light pole"), and UT's
campus GIS (`maps.utexas.edu/data/utm.json`) is 199 building footprints and
nothing else.

**`src=osm` — 1,484 features. POSITION factual, FORM generative.**

The first pass only ever *asked* OSM for five kinds of furniture. That is the
whole reason there were 453 of them. `scripts/fetch_street_furniture.py` asks
for the rest — five new Overpass queries, cached under `data/osm_cache/` like
the original survey. It found 159 bollards, 84 bus stops, 43 shelters, 43
emergency phones, 38 masts, 12 flagpoles, 29 flowerbeds, 44 fences, 21 walls,
9 bike-share docks, and the long tail above. Nothing was invented; a wider
question was asked of the same source.

`fence`, `wall` and `flowerbed` are drawn from their **real polygon or polyline
geometry**, not as a stand-in box at the centroid.

**`src=proc` — 7,342 features. POSITION generated by a named rule, always
riding real geometry.** Every one carries `rule`:

| `rule` | count | what it rides | the rule |
|---|---|---|---|
| `walk_lamp` | 5,426 (2,713 lamps × pole + light) | OSM path centrelines in `data/ground.geojson` | every walkway ≥ 2.4 m wide with a pedestrian surface (concrete / paving / brick / limestone), a lamp every 38 m, 1.7 m + half-width off the centreline, **alternating sides** along the run, never within 16 m of another lamp including the OSM ones |
| `entrance_bike` | 591 | the baked building footprints + path centrelines | for every footprint over 550 m², the façade vertex closest to a real path within 20 m, pushed 3.2 m out toward it; max 2 per building — **and never within 25 m of a city-surveyed rack**, which is why this is 591 and not 684 |
| `path_bench` | 404 (271 benches + 133 bins) | path centrelines + the ground surface polygons | a bench every 62 m along a pedestrian path, on **whichever side is actually a lawn or a plaza** (both sides are probed), oriented along the path; a bin beside every second one |
| `plaza_planter` | 408 | OSM plaza polygons | every 14 m around the edge of any paved area over 400 m², set 1.4 m inside the edge |
| `scooter_at_rack` | 315 | the racks placed above | 3 scooters beside 18% of racks, deterministically chosen |
| `crossing_bollard` | 48 | path endpoints + the asphalt areas | a row of 3 bollards where a walkway ≥ 2.4 m runs into a carriageway |

Asphalt paths are **excluded** from `walk_lamp` on purpose: those are the lines
`js/night.js` already lights from the basemap's road network, and the first cut
double-lit every service road and parking aisle while starving the malls.

**Art — 34 pieces (31 OSM + 3 City of Austin). POSITION and NAME factual. The FORM IS NOT THE
ARTWORK.** Unchanged from the previous pass and worth restating: we do not model
di Suvero's steel or Rubins' aluminium boats. Each piece is a plinth-and-mass
stand-in sized by its `artwork_type`, and the label carries the identity.

### Nothing sits in the middle of a road

Measured, not asserted. `RoadTest` in `scripts/bake_props.py` rejects any
procedural placement whose centre falls inside a mapped carriageway (half-width
+ 0.4 m kerb margin); 36 were rejected. After the bake, **6 of 6,073 objects**
are inside one — one gate, three lift gates and two fences, all OSM-positioned
and all things that legitimately cross a road.

---

## 4. Variety

> "2,572 identical trees look worse than 1,500 with real species variation."

- **Trees**: 7 species habits, each with its own height-from-radius curve, crown
  squash range and crown lift up the trunk, plus a deterministic per-tree wobble
  on squash and rotation. Height spans 4.0–27.1 m.
- **Furniture**: 38 object kinds, each with its own footprint dimensions and
  height — a bench is 1.80 × 0.60 × 0.46 m lying **along its path**, a bollard is
  0.24 × 0.24 × 0.95 m, a rack is 2.60 × 0.85 × 0.82 m, a shelter is
  4.20 × 1.70 × 2.60 m. Sizes carry a ±10% deterministic wobble and headings a
  few degrees of scatter, because real furniture is not stamped.
- **Colour**: eight classes — `wood` `steel` `dark` `stone` `green` `glass`
  `sign` `blue` — carried per feature on `c` and resolved through one `match` in
  `js/props.js`, blended day → golden → night like every other palette. Muted on
  purpose: the buildings still have to win the frame.

---

## 5. Night

`js/night.js` places ~1,046 **road** streetlights and draws them as glow pools
with no physical object. This pass adds the walkway tier and the objects:

- 2,713 procedural + 193 OSM lamp posts as real extruded poles.
- Every lamp and every blue-light phone also emits a `k='lit'` **Point** feature,
  drawn by `js/props.js` as a pool + core circle pair, deliberately **tighter and
  dimmer** than night.js's road pools so the two tiers read as different tiers.
- They come on across the same dusk ramp night.js uses (p 0.58 → 0.85), so the
  campus lights up in one wave rather than two.
- UT's blue-light emergency phones keep a blue glow after dark — the one accent
  on a night path that is not sodium.
- The glow layers sit **under** the building extrusions, so a tower occludes the
  lamps behind it.

---

## 5b. What it actually looks like

Rendered from the real app (`scripts/verify/shot.mjs`, camera poses in
`scripts/verify/shots-ground-life.json`), six locations, day and night, at the
balanced preset. Re-render with:

```bash
VERIFY_URL=http://127.0.0.1:8137 node scripts/verify/shot.mjs gl scripts/verify/shots-ground-life.json
```

| location | day | night |
|---|---|---|
| South Mall / West Campus | [`southmall-day.jpg`](shots/southmall-day.jpg) | [`southmall-night.jpg`](shots/southmall-night.jpg) |
| Speedway (the pedestrian spine) | [`speedway-day.jpg`](shots/speedway-day.jpg) | [`speedway-night.jpg`](shots/speedway-night.jpg) |
| East Mall / Waller Creek | [`eastmall-day.jpg`](shots/eastmall-day.jpg) | [`eastmall-night.jpg`](shots/eastmall-night.jpg) |
| DKR / the athletic precinct | [`dkr-day.jpg`](shots/dkr-day.jpg) | [`dkr-night.jpg`](shots/dkr-night.jpg) |
| Guadalupe (the Drag) | [`guadalupe-day.jpg`](shots/guadalupe-day.jpg) | [`guadalupe-night.jpg`](shots/guadalupe-night.jpg) |
| West Campus | [`westcampus-day.jpg`](shots/westcampus-day.jpg) | [`westcampus-night.jpg`](shots/westcampus-night.jpg) |

The two that carry the whole pass are `eastmall-day` (the precinct that used to
read bare) and `speedway-night` / `eastmall-night` (the walkway lamp tier, with
the blue emergency-phone glows visible among the sodium).

---

## 6. Performance

Measured on the real app at 1280×800, `renderScale` 1.0, balanced preset, by
forcing a synchronous `map._render()` and blocking on `gl.finish()` so GPU time
lands in the number. (The rAF-paced numbers are useless here: `_harness.html`
pins `requestAnimationFrame` to a 16 ms shim **before** MapLibre loads, so every
rAF measurement reads ~15 ms no matter what is on screen.)

Median frame time, three poses:

| pose | trees OFF | 12,137 trees, d = 1.0 | 12,137 trees, d = 0.675 | old 2,572 trees |
|---|---|---|---|---|
| South Mall (z16.9) | 10.2 ms | 10.5 ms | 9.9 ms | 9.1 ms |
| high over campus (z15.2) | 9.7 ms | 9.9 ms | 10.3 ms | 10.7 ms |
| low over West Campus (z17.8) | 10.0 ms | 10.1 ms | 10.0 ms | 10.1 ms |

**Every one of those is within run-to-run noise of every other.** 4.7× the trees
cost nothing measurable on this machine; the scene is bound by something else
(post-FX, the basemap, the building extrusions). The `~6–7 fps` figure in the
old `js/app.js` comment was measured at 1440×900 under different settings and
could not be reproduced here — worth re-measuring on a phone before trusting
either number.

**The real cost is transfer, not draw:** `trees.geojson` went 1.6 MB → 6.3 MB and
`props.geojson` 118 KB → 2.2 MB. Uncompressed, over localhost, `trees.geojson`
fetches in 937 ms. Both are plain JSON and gzip to roughly a fifth; GitHub Pages
compresses automatically, so make sure whatever hosts this does too.

### The density knobs

Both knobs are now **quantiles**, which they were not before. `d` used to be
computed from a size formula, so the fraction a given density actually drew
depended on the size distribution — at 2,572 trees `treeDensity` 0.675 drew
1,544 (60%), and after a 4.7× growth the same setting would have drawn some
other arbitrary share. Now `d` is the rank in 0..1, so **density 0.675 draws
67.5%, always**, whatever the file holds.

| `GFX.treeDensity` | trees drawn | derived `propDensity` |
|---|---|---|
| 0.35 | 4,249 | 0.58 |
| 0.52 (performance preset) | 6,312 | 0.69 |
| 0.675 (balanced preset) | 8,193 | 0.79 |
| 1.0 (cinematic / ultra) | 12,137 | 1.00 |

Thinning still drops the least valuable things first: small trees before big live
oaks, and bins and scooters before a lamp run (`WEIGHT` in `bake_props.py`).

`js/props.js` has **no** entry in the graphics menu of its own, because this
workstream does not own `js/graphics.js`. Instead it wraps `window.applyTreeDensity`
— which `applyGraphics()` already calls on every settings change — so the prop
density rides the existing presets and the ~30 fps auto-detect for free.

**Optional, for whoever owns `js/graphics.js`.** To give props their own slider,
add one line to `SCHEMA`:

```js
{ key: 'propDensity', label: 'Prop density', min: 0.2, max: 1, step: 0.025, group: 'world',
  fmt: v => Math.round(v * 100) + '%',
  hint: 'Street furniture, lamp posts and planting. Thins bins and scooters first and keeps the lamp runs.' },
```

`js/props.js` picks up `GFX.propDensity` automatically the moment it exists; no
other change is needed.

**Optional, for whoever owns `js/timeofday.js`.** Canopy colour is currently
ramped on height alone (`canopyLo` at 6 m → `canopyHi` at 15 m), so two trees of
the same height are the same green. A per-tree tone jitter would deepen the
variety — replace the `trees-canopy` paint line with:

```js
safePaint(map, 'trees-canopy', 'fill-extrusion-color',
  ['interpolate', ['linear'],
    ['+', ['get', 'h'], ['*', 3.5, ['-', ['%', ['*', ['get', 'd'], 977], 1], 0.5]]],
    6, s.canopyLo, 15, s.canopyHi]);
```

That reuses `d` (already per-tree and deterministic) as a ±1.75 m tone offset. It
was deliberately **not** applied here — `timeofday.js` belongs to another
workstream.

---

## 7. Rebuilding

```bash
python scripts/fetch_canopy_grid.py --workers 14      # sweep the bbox for crowns (~2.5 min, cached after)
python scripts/fetch_street_furniture.py              # 5 new Overpass queries (cached after)
python scripts/fetch_city_props.py                    # City bike racks / MetroBike / public art
python scripts/fetch_city_trees.py                    # -> data/trees.geojson
python scripts/bake_props.py                          # -> data/props.geojson
```

`fetch_canopy_grid.py` and `fetch_street_furniture.py` are both cache-first and
idempotent; pass `--refresh` (furniture) or delete the tag from
`data/canopy_detected.json` (canopy) to force a re-fetch. Aerial tiles land in
`data/imagery_cache/`, which is gitignored — the derived
`data/canopy_detected.json` (17,483 crowns, 1.1 MB) is committed, so nobody has
to re-download 1,400 tiles to reproduce the bake.

## 8. Things that will waste your time

- **`scripts/verify/shot.mjs` defaults to `http://127.0.0.1:8099`.** There was
  already a server on that port rooted at a *different* checkout, so the first
  full shot run rendered the old `js/props.js` and came back with three of the
  new layers simply missing — which reads exactly like a broken layer rather
  than a wrong server. Always run it as
  `VERIFY_URL=http://127.0.0.1:<your port> node shot.mjs …`, and check the
  `DIAG` layer list contains what you just added.
- **`detect_canopy.py`'s `--bbox` starts with a minus sign**, so argparse eats
  it as a flag. Use `--bbox=-97.74,…`, with the equals sign.
- **`data/landscape.geojson` is dead.** `js/app.js` moved every pitch and
  fountain into `data/ground.geojson` and deleted the `austin-landscape` layers;
  nothing loads the file any more. It was left untouched rather than deleted,
  since the buildings workstream is live in the same tree.
