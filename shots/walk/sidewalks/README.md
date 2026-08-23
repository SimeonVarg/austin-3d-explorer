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
