# shots/walk/sidewalks — what each frame is

Taken 2026-08-23 on branch `acer/w-sidewalks`, port 8712,
`?intro=0&drift=0&walk=1`, graphics auto-detect cancelled, veil waited out,
screenshot twice and the second kept. Full method and every number:
`docs/walk-sidewalks.md`.

## `-x1` vs `-x4` — the door-link cost

Same page load, same camera, one constant changed: `WAYFIND.linkCostMult`.
**x1 is `main` today** (a door link costs one pavement metre per metre, so the
router treats it as a free shortcut). **x4 is this branch.**

| frame | route | invented door leg, x1 → x4 |
|---|---|---|
| `door-wel-x1/x4` | PMA → WEL, close up | **26.7 m → 1.0 m** — the clearest pair. In x1 a dashed leg runs diagonally straight across the roof of Physics, Math and Astronomy. In x4 the route goes round the building on real pavement. |
| `door-bur-x1/x4` | PAI → BUR, close up | 27.6 m → 2.3 m — Burdine's door has a path 2.3 m away and the router was using one 27.6 m away on the far side. |
| `pma-wel-x1/x4` | PMA → WEL, whole route | the same fix at route scale, down Speedway |
| `pai-bur-x1/x4` | PAI → BUR, whole route | 53.0 m → 13.4 m of leg across the pair of doors |
| `bel-jes-x1/x4` | BEL → JES, whole route | 27.4 m → 0.9 m; also drops from two flights of stairs to none |
| `wch-gar-x1/x4` | WCH → GAR, whole route | 31.2 m → 1.9 m |
| `cal-mez-x1/x4` | CAL → MEZ, whole route | the one route whose "% on pavement" goes DOWN while its off-pavement metres go 29.5 → 7.5 — see `docs/walk-sidewalks.md` §5 |

Cameras are nadir and framed on the union of both routes' bounding boxes, so
neither variant can fall out of frame. Ribbon polygons actually rasterised in
each viewport were counted before every shot (22–80 per frame).

## `-before` vs `-after` — the kerb apron

Same camera, same everything, only `data/ground.geojson` swapped: **before** is
the file `main` ships, **after** is the same bake with `CROSSING_APRON_M`.

* `kerb-sanjac-before/after` — a four-way junction. In *before* the sidewalks
  stop a stride short of the road at every corner; in *after* a concrete ramp
  reaches the kerb at each one.
* `kerb-21st-before/after` — the same thing at a T junction.
* `streets-wide-before/after` — campus scale, the control. The aprons must not
  become "pale ribbons across every street", which is why the bake skips
  crossings in the first place. They don't: at this scale the two frames are
  indistinguishable and the streets still read as streets.

## `aprons-` vs `malls-` — a pedestrian mall becomes a walk

Later the same day, on the same branch. Same camera, same everything, only
`data/ground.geojson` swapped: **`aprons-`** is this branch as the section above
left it (kerb aprons in, malls still flat plaza fills), **`malls-`** is the same
bake with `PEDESTRIAN_AREA_IS_A_WALK`. See `docs/walk-sidewalks.md` §9.

* `2-eastmall` — **the pair to look at.** The Jester forecourt goes from a flat
  cool-grey slab with the walking ribbon running along its edge to warm paving
  the same colour as the footways that cross it, with the ribbon on it.
* `1-mainmall` — the same change beside Garrison Hall, on the GRE → MAI route.
* `6-eastmall-city` — the East Mall pose with the tree layers left in, i.e. what
  a person actually sees rather than what the ground is doing.

The frames are **near-nadir** and their poses are computed offline from
`data/walk_graph.json`, so both halves are byte-identical camera. The browser
reported z 18.91 on every one of them, which is the offline prediction to the
second decimal, and the route pill in each frame carries the distance (520 m for
PCL → RLP, 580 m for GRE → MAI) that `bake_ground.py --walkaudit` predicts for
the same pair.

The non-`-city` frames have the five tree and canopy layers hidden so the ground
is the subject. The filter is `/^trees-|canopy/` and NOT `/tree|canop/i`: the
loose one also matches s-**tree**-t and hid `bridge_street` and both
night-streetlight layers in frames that are evidence about streets.

## `rim-` — a mall's OUTLINE is a walk too

Round 3, 2026-08-24, port 8812. Same camera, same route, only
`data/ground.geojson` swapped: **`-before`** is this branch as round 2 left it,
**`-after`** is the same bake with `PEDESTRIAN_RIM_IS_A_WALK`. See
`docs/walk-sidewalks.md` §12–§14.

The router walks the RIM of the 41 `highway=pedestrian area=yes` rings, because
`bake_walk.py` puts a closed way into the graph as a ring of edges — but this
bake was painting only the polygon, so the ribbon's outer rail hung over nothing
for 7.1 km of rim. 88 % of every bare metre in the twenty routes was on one of
those outlines, and 87 % of it within five centimetres of paving.

* `rim-pcljes-before` / `-after` — **the pair to look at.** PCL → Jester. The
  mall's hairline edge becomes a proper paved border and the ribbon sits on it.
* `rim-pcljes-diff` — the same pair as a change mask, dimmed original with every
  changed pixel in red. Everything bright is the hem; the speckle on other walks
  is one-pixel pattern phase, accounted for in §14.
* `rim-city-before` / `-after` — **the control.** A 1.2 m hem round 41 malls must
  not read as a halo at the scale a person looks at the city. It does not; the
  two frames are indistinguishable by eye.

Poses are derived offline **from the router itself** — each sits on the midpoint
of that route's longest bare run measured against the `-before` file — so the
subject cannot be off screen. Ribbon features actually rasterised: 29 in the
`pcljes` pair, 100 in the `city` pair. The renderer is deterministic here:
shooting the identical poses twice off the identical file changed **0 pixels**
on five of six frames (0.03 % on the city frame), which is why the before/after
diffs can be believed.

## `eye-` — the ribbon from WALKING HEIGHT (round 4, 2026-08-24)

Taken on port 8812, `?intro=0&drift=0&walk=1`, `cancelGraphicsAutoDetect()`
called, veil waited out, tiles waited on, screenshot twice and the second kept.
Full method and every number: `docs/walk-sidewalks.md` §20.

Every frame above this section is near-nadir, and nadir is the one angle that
cannot see whether the ribbon SITS on the pavement or floats over it —
`js/wayfind.js`'s own comment records a coplanar ribbon that was "invisible at
walking height". These are pitch 78°, zoom 20.0, camera standing on the route
with the map centre 28 m further along it. Tree crowns hidden: they sit at eye
height over these malls and render slightly differently run to run.

| frame | what it is |
|---|---|
| `eye-mainmall` | Main Mall beside Waggener, looking at the Tower. GRE → MAI, pill 580 m. **The pair to look at.** |
| `eye-mainmall-noroute` | the identical camera with `wayfindClear()`. Every pixel that differs from `eye-mainmall` IS the ribbon. |
| `eye-mainmall-float` | the identical camera with `WAYFIND.routeBaseM` = 0.95 m. This is what a ribbon that does NOT sit on the pavement looks like — a kerb-height wall with a side face. |
| `eye-eastmall` / `-float` | the East Mall outside Jester. PCL → JES, pill 160 m. |
| `eye-speedway` | Speedway beside the Jackson Geological Sciences steps. PCL → RLP, pill 520 m. |

```
eye-mainmall  ribbon owns 29,567 px (2.89 % of frame)   a 0.95 m float moves 23,338 px
eye-eastmall  ribbon owns 30,695 px (3.00 %)            a 0.95 m float moves 22,610 px
eye-speedway  ribbon owns 32,532 px (3.18 %)            a 0.95 m float moves 20,039 px
```

The pills read 580 / 160 / 520 m against `bake_ground.py --walkaudit`'s 578 /
157 / 518 m for the same three pairs.

All nine frames were taken; six are here. `eye-eastmall-noroute`,
`eye-speedway-noroute` and `eye-speedway-float` are deliberately NOT committed —
their pixel counts above are the evidence and CLAUDE.md rule 12 says a frame no
doc points at is a multiplier, not a deliverable. `eyeshot.mjs` regenerates all
nine.

`eyeshot.mjs` in this directory is the script that took them. It is here rather
than in `scripts/verify/` because that directory is not this lane's to write, and
round 2 already lost a set of measuring scripts to a session scratchpad; its
header says how to run it.

### METHOD WARNING for anyone taking the next frame here

The `-x1`/`-x4` and `aprons-`/`malls-` sections above prove "the subject is on
screen" by counting the ribbon features `queryRenderedFeatures` reports. **That
works at nadir and FAILS at eye level.** In all three `eye-` frames
`queryRenderedFeatures` returned **0** ribbon features while the ribbon
demonstrably owned ~30,000 pixels — a `fill-extrusion` under a steep pitch is not
reliably reported. Use the clear-and-diff pixel count instead: screenshot, call
`wayfindClear()`, screenshot again at the same camera, and count differing
pixels. Nothing already published here is wrong; every frame that used the
feature count was near-nadir.
