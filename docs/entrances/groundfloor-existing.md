# What is already drawn at ground level in West Campus

An audit, taken 2026-08-04, of every system that puts geometry on or near the
ground floor of the 24 named West Campus buildings. It exists so the next pass
does not draw a second copy of something that is already there.

Every number below is measured out of the shipped data files, not estimated.
Method: all four files re-projected to metres about lat 30.286, feature polygons
tested against the host footprint in `data/snapshots/2026-08-04/
buildings.detailed.geojson`. Scripts were throwaway; the numbers are
reproducible from the files.

Sources audited:

| file | features | writer |
|---|---|---|
| `data/westcampus.geojson` | 1,144 | `scripts/bake_westcampus.py` |
| `data/places.geojson` | 1,185 | `scripts/bake_places.py` |
| `data/entrances.geojson` | 10,717 pieces / 584 doors / 258 buildings | `scripts/bake_entrances.py` |
| `data/drag.geojson` + `js/drag.js` | 101 | `scripts/bake_drag.py` |

All 24 ids in `westcampus.geojson → replacedBuildingIds` resolve in the
snapshot, and all 24 name back to a building. Nothing in this audit is inferred
from a name string.

---

## 1. The headline: West Campus ground floors are almost entirely empty

Perimeter of the 24 footprints, and how many metres of it another system has
already claimed. A perimeter sample every 0.5 m counts as claimed when a piece
of that system lies within 1.0 m of it.

| | metres | share of 6,084 m |
|---|---|---|
| claimed by `places.geojson` | 142.0 | **2.3 %** |
| claimed by `entrances.geojson` | 26.0 | **0.4 %** |
| claimed by `drag.geojson` | 0.0 | **0 %** |
| unclaimed | 5,916 | **97.3 %** |

Only **6 of 24** buildings carry any second system at all. The other 18 have a
ground floor consisting of exactly one thing: a single `band:"base"` wall prism.

---

## 2. Per building

`wc all` = every westcampus feature on that building. `wc grd` = those with
`base < 8 m`. `pl` / `en` / `dg` = pieces from places / entrances / drag whose
plan geometry intersects the footprint + 2 m.

| building | area m² | h m | base-band top | base fam | wc all | wc grd | pl | en | dg |
|---|---|---|---|---|---|---|---|---|---|
| 21 Rio | 1483 | 73.5 | 6.2 | sg | 82 | 2 | **8** | 0 | 0 |
| 2400 Nueces | 5491 | 21.2 | 5.0 | sp | 22 | 9 | 0 | 0 | 0 |
| Block on 25th East | 2836 | 28.1 | 5.0 | sp | 245 | 44 | 0 | 0 | 0 |
| Cambridge Tower | 1925 | 55.0 | 5.0 | sg | 67 | 6 | 0 | **30** | 0 |
| Crest at Pearl | 3362 | 16.7 | 4.6 | sg | 17 | 8 | 0 | 0 | 0 |
| Dobie Twenty21 | 4998 | 82.0 | 6.0 | sp | 9 | 2 | **40** | 0 | 0 |
| Inspire on 22nd | 1233 | 56.4 | 6.0 | sg | 6 | 2 | 0 | 0 | 0 |
| Ion Austin | 2261 | 59.1 | 7.0 | sg | 10 | 3 | 0 | 0 | 0 |
| Moontower | 1541 | 57.3 | 7.4 | sg | 9 | 2 | 0 | 0 | 0 |
| Pointe on Rio | 2651 | 24.3 | 5.0 | sg | 25 | 8 | **4** | 0 | 0 |
| Rambler | 4213 | 14.4 | 4.6 | sn | 139 | 50 | 0 | 0 | 0 |
| Signature 1909 | 1712 | 64.3 | 5.2 | sg | 10 | 3 | 0 | 0 | 0 |
| Skyloft Austin | 2127 | 57.9 | 6.2 | sg | 6 | 2 | 0 | 0 | 0 |
| The Block | 3180 | 32.7 | 5.4 | sg | 76 | 15 | 0 | 0 | 0 |
| The Callaway House Austin | 4229 | 62.5 | 5.4 | sp | 6 | 2 | 0 | 0 | 0 |
| The Castilian | 2855 | 60.0 | 4.6 | sp | 8 | 2 | 0 | 0 | 0 |
| The G | 1416 | 26.4 | 5.2 | sp | 27 | 6 | 0 | **34** | 0 |
| The Nine at Rio | 2354 | 12.2 | 4.4 | sg | 14 | 9 | 0 | 0 | 0 |
| The Nine at West Campus | 3193 | 14.4 | 4.6 | sg | 27 | 10 | 0 | 0 | 0 |
| The Quarters Grayson House | 1342 | 28.4 | 5.0 | sn | 39 | 8 | 0 | 0 | 0 |
| The Quarters Sterling House | 2673 | 24.8 | 5.0 | sn | 33 | 8 | 0 | 0 | 0 |
| The Standard | 4007 | 20.5 | 7.0 | sg | 183 | 5 | 0 | 0 | 0 |
| The Venue on Guadalupe | 2213 | 26.5 | 5.0 | sg | 45 | 9 | **4*** | 0 | 0 |
| Twenty Two 15 | 1811 | 27.3 | 5.2 | sp | 39 | 8 | 0 | 0 | 0 |

\* The Venue's four are **Torchy's Tacos**, and they are hosted on the
neighbouring footprint, standing 1.47 m (front) / 1.61 m (awning) clear of the
Venue's own wall. They claim 0 m of the Venue's perimeter. Anything new on the
Venue's south-east elevation has to keep out of that 1.5 m gap.

### What each of the six actually carries

- **Dobie Twenty21** — 40 places pieces (30 `front`, 10 `awning`), 5 tenants:
  Target (16), Oma's Kitchen (8), Dobie Tower Food Court (8), Gong Cha (4),
  Starbucks (4). **108 m of its 325 m perimeter, 33 %.** This is the only
  genuinely built-out ground floor in West Campus.
- **21 Rio** — Rio Mart, 8 pieces, 17 m, 11 %.
- **Pointe on Rio** — Conscious Cravings, 4 pieces, 17 m, 7 %.
- **Cambridge Tower** — 30 entrance pieces, **2 doors** (1 main, 1 secondary),
  era `utility` (family E2), kinds: 6 reveal, 4 door, 4 glass, 12 step, 4 canopy.
  z span 0.00–3.20 m. 13 m, 6 %.
- **The G** — 34 entrance pieces, **2 doors**, era `utility` (E2), 6 reveal,
  4 door, 4 glass, 16 step, 4 canopy. z span 0.00–3.20 m. 13 m, 6 %.
- **The Venue on Guadalupe** — see the footnote; nothing on its own wall.

### Everything else the 24 have at ground level is westcampus' own

`band:"base"` is exactly **one prism per building, 24 total**, sitting on the
footprint at offset 0.000. It is a `kind:"wall"` feature wearing one of three
tile families:

| fam | what the tile draws (`js/facades.js` DKR_TILES) | buildings |
|---|---|---|
| `sg` | horizontal glazing bands with metal mullions | 13 |
| `sp` | arcade piers with deep portals between them | 7 |
| `sn` | chamfered brick piers with open bays behind | 3 (Rambler, Grayson, Sterling) |

**None of the three has a vertical anchor and none of them contains a door.**
That is the gap this pass is for.

The remaining ground-level westcampus features are the balcony system, not the
ground floor: `balc` + `rail` pairs down to grade on 15 buildings (Rambler 22,
Block on 25th East 20, The Block 5), plus 5 ground-level amenity `deck`s with
`pool` / `shade` / `furn` on Crest at Pearl, Pointe on Rio, Rambler, The Block,
The Nine at Rio.

---

## 3. Two systems near the same wall — is anything z-fighting today?

**No. Measured, not assumed.**

Scan: every pair of features from two different systems whose plan polygons
overlap by more than 0.02 m² over the 24 footprints, checked for a shared
horizontal plane within 5 mm.

| pair | overlapping in plan **and** z | sharing a horizontal plane |
|---|---|---|
| westcampus × places | 41 | 13 |
| westcampus × entrances | 0 | 0 |
| places × entrances | 0 | 0 |
| anything × drag | 0 | 0 |

All 13 shared planes are `bot == bot @ 0.00` — the ground plane, where the
places `front` bulkhead and the westcampus base prism both start. That is not a
z-fight: the coincident faces are the *undersides*, which sit on grade and are
never drawn against sky.

The 41 plan overlaps are all Dobie / 21 Rio / Pointe on Rio, and they are
`bake_places.py`'s `INSET = 0.15` biting deliberately back into the wall so
there is no gap behind the shopfront. Interpenetration by design, and the
outward faces are 0.30 m apart, so there is nothing coplanar to flicker.

Entrance pieces on The G and Cambridge Tower were checked against those
buildings' own westcampus balcony and rail solids: **0 colliding pairs**.

**Conclusion: the West Campus ground floor has no existing z-fighting to fix.
The next pass's job is not to repair a collision, it is not to create one.**

---

## 4. Measured proud-slab offsets

Distance of each piece's outermost face from the host footprint boundary
(+ = outside, − = inside), taken vertex by vertex over every feature that names
a host id. Modes, with counts.

| system | kind | outer face (m) | n |
|---|---|---|---|
| westcampus | `band:"base"` wall | **0.000** | 24 |
| drag | wall, cap | **0.000** | 101 |
| entrances | `reveal` | 0.08 (530) / 0.20 (930) / 0.25 (109) | 1,752 |
| entrances | `door` | **0.18** (985) | 1,097 |
| entrances | `glass`, `transom` | **0.20** (1,001) / 0.18 (219) | 1,398 |
| entrances | `surround` | 0.10 / 0.12 / 0.15 / 0.16 / 0.25 / 0.45 | 662 |
| entrances | `column` | 0.28 | 2 |
| entrances | `sign` | 0.18 (4) / 0.42 (4) | 10 |
| **places** | **`front`** | **0.30** (756), inner face **−0.15** | 789 |
| **places** | **`awning`** | **1.30** (249) | 263 |
| entrances | `step` | 0.30 → 1.50 (ground furniture) | 3,710 |
| entrances | `rail` | 0.20 → 1.50 (ground furniture) | 1,608 |
| entrances | `canopy` | **1.80 / 2.40 / 3.20** by era | 314 |
| entrances | `ramp` | 2.55 → 12.15 (ground furniture) | 164 |
| westcampus | `balc` slab | +1.40 out / −0.15 in (`BALC_PROJ`, `BALC_BITE`) | — |

The entrances numbers reproduce the source constants exactly:
`REVEAL_PROUD 0.02 + REVEAL_T 0.06 = 0.08`; `PROUD_DOOR 0.08 + LEAF_T 0.10 =
0.18`; `+ GLASS_PROUD 0.02 = 0.20`, which is also where the jamb return is
capped. The places numbers reproduce `PROUD 0.30`, `INSET 0.15`, `AWN_PROJ 1.30`.

### The free bands

Sorting all of the above, the planes that are **occupied** by some wall face are
0.00, 0.02–0.08, 0.08–0.20, 0.25, 0.28, 0.30–0.31, 0.42, 0.45, 1.30, and the
overhead 1.80 / 2.40 / 3.20.

The two intervals with no wall face in them at all are:

- **0.32 – 0.41 m** (between places `front` 0.31 and entrances `sign` 0.42)
- **0.46 – 1.29 m** (between entrances `surround` 0.45 and places `awning` 1.30)

---

## 5. Proposed offset ladder for the new work

Shaped like the ground-rank ladder from PR #78 (`RANK` in
`scripts/bake_ground.py`): **one surface, one claim.** A wall run is owned by
exactly one system, and the metric offsets exist only so that where two systems
legitimately abut, they never share a plane.

### 5a. The claim ladder — who owns a metre of wall

| rank | claimant | evidence |
|---|---|---|
| 100 | `places.geojson` `front` / `awning` | a named OSM tenant. Never overdraw. |
| 80 | `entrances.geojson` door bank + its canopy | footpath-derived placement, validated against OSM nodes |
| 60 | **new: West Campus lobby** | the residential entrance |
| 40 | **new: podium retail** (generic, unnamed) | street-facing frontage with no named tenant |
| 20 | `westcampus.geojson` `band:"base"` | the fallback tile, already covering 100 % |

A new piece may only be emitted on a wall run where nothing above its own rank
has a claim within `CLAIM_R`. Set `CLAIM_R = 1.0 m` — the same radius this
audit's perimeter measurement used, so the 142 m and 26 m figures above are
directly the metres the new pass must skip.

### 5b. The metric ladder — where a face may sit

| name | value | why |
|---|---|---|
| `WC_SLAB_PROUD` | **0.30** | deliberately the *same* plane as `places.PROUD`, so a lobby and a Torchy's on the same street read as one datum. Safe because rank 100 already excluded the run. |
| `WC_SLAB_BITE` | **0.15** | same as `places.INSET`, same reason: no gap behind. |
| `WC_FRAME_PROUD` | **0.36** | storefront frame / mullion / pilaster standing off the slab. Lands in the free 0.32–0.41 band, 0.05 m clear of places' 0.31 and 0.06 m clear of entrances' 0.42. |
| `WC_SILL_PROUD` | **0.40** | a bulkhead or planter nib, top of the same free band. |
| `WC_BRACKET_PROUD` | **0.90** | canopy brackets / blade signs, mid the free 0.46–1.29 band, 0.40 m clear either side. |
| `WC_CANOPY_PROUD` | **1.30** | same plane as `places.AWN_PROJ`, exclusive-claim again. |
| door leaf / glass / reveal | **reuse 0.02 / 0.08 / 0.18 / 0.20** | do **not** invent a second door plane. Add a family to `FAMILIES` in `bake_entrances.py`; these four numbers come with it. |

Two hard constraints that fall out of the measurements:

1. **15 of the 24 base bands are shorter than a full shopfront.** `SHOP_DATUM
   4.3 + SIGN_H 1.05 = 5.35 m`, and the base-band tops are 4.4 / 4.6 ×4 /
   5.0 ×7 / 5.2 ×3 below that line. Only 9 buildings (21 Rio, Dobie, Inspire on
   22nd, Ion Austin, Moontower, Skyloft, The Block, Callaway, The Standard) can
   carry the datum unclamped. The other 15 need `SHOP_MAX_FRAC` / `SIGN_MAX_FRAC`
   applied against the **base-band top**, not against `final_height` — clamping
   against the tower height would push a sign band up into the residential
   shaft.
2. **Nothing may sit at exactly 0.31–0.35 m if it can plan-overlap a places
   `front`**, and nothing at 0.42–0.45 m if it can plan-overlap an entrances
   `surround` or `sign`. The rank ladder should already prevent both; the metric
   ladder is the belt to that pair of braces.

### 5c. The ground plane under all of it

`data/ground.geojson` puts 59 features inside the 24 footprints + 1 m
(27 `pathslab`, 19 `patharea`, 10 `roadarea`, 3 `area`), and `js/ground.js`
stands `patharea` at `pathRaise = 0.22 m`. `data/props.geojson` adds 11 `furn`
pieces at 0.78–0.91 m. A new entrance step or threshold must start from 0.22 m
where a sidewalk is present, not from 0.00 — the same rule
`bake_westcampus.py` already encodes as `COURT_Z = 0.45`.

---

## 6. Why entrances skipped West Campus, and what that means

`bake_entrances.py` `CAMPUS = (30.2795, −97.7420, 30.2930, −97.7255)`. Measured
against the 24 centroids: **only 3 fall inside it** — Cambridge Tower
(−97.74041), Dobie Twenty21 (−97.74135) and The G (−97.74178). The other 21 are
west of −97.7420 and were never in scope. West Campus is not a placement
failure; it is outside the bbox.

Of those 3, Dobie got zero doors because its `building_class` is `null`, which
is in `PLACES_EXCLUDE_CLASSES` — the E1 "draw nothing, places.js owns this
frontage" rule. That rule fired correctly: Dobie is the one West Campus building
places.geojson genuinely covers.

Cambridge Tower and The G got family **E2** (`apartments` → E2), which emits
`era:"utility"`. That is the honest fallback, not a residential vocabulary:
across the whole 10,717-piece file, `utility` is 5,557 pieces and the era string
`residential` does not exist. **A West Campus pass should add that family**, not
start a second door system — E2's canopy is a 1.80 m concrete slab with a
0.70 glazing fraction, which is a service door, not a 2018 leasing lobby.

---

## 7. Atlas budget, measured

`fill-extrusion-pattern` images actually registered today:

| system | images | how counted |
|---|---|---|
| `js/drag.js` | **16** | distinct `(fam, wd)` combos over `drag.geojson` wall features; `stampPatterns()` mints one `dg-` id per combo |
| `js/westcampus.js` | **46** | distinct `(fam, wd)` combos, via `quantiseStadiumFacades()` |
| `js/places.js` | **1** | `pl-glass`, one shared mullion tile |
| `js/entrances.js` | **0** | flat-colour geometry only |

drag is 16, not the 11–15 quoted in the pass brief — worth knowing before
anything is added to it.

**The precedent to follow is places (1) and entrances (0), not westcampus (46).**
The two most recent ground-floor passes between them cost one atlas image for
789 shopfronts and 10,717 door pieces. A West Campus lobby and podium-retail
vocabulary should be expressible with geometry plus the existing `pl-glass`,
and should add **zero to one** new tile. If it needs more, say the number in the
PR.

---

## 8. Leave these alone

| verdict | buildings |
|---|---|
| **Do not touch the claimed runs.** Add nothing to Dobie's 108 m of Target / food-court / Starbucks frontage, 21 Rio's 17 m of Rio Mart, or Pointe on Rio's 17 m of Conscious Cravings. Dobie in particular is done — a third of its perimeter is real, named, sourced retail. | Dobie Twenty21, 21 Rio, Pointe on Rio |
| **Door already placed; extend it, do not duplicate it.** Both have a main and a secondary E2 door with canopy and steps, footpath-derived. Upgrading the era family in `bake_entrances.py` reaches them for free; a second door system does not. | Cambridge Tower, The G |
| **Keep out of the 1.5 m gap** on the south-east elevation where Torchy's stands on the neighbour. | The Venue on Guadalupe |
| **Empty ground floor, one base prism, no door, nothing to collide with.** 5,916 m of the 6,084 m perimeter. This is where the pass should spend its effort. | the other 18 |

Two more notes for whoever writes the pass:

- **`drag.js` never touches West Campus.** Zero of its 24 host ids are in
  `westcampus.replacedBuildingIds`; its westernmost feature is *Rise at West
  Campus* at −97.74191, on the Guadalupe streetwall. There is no boundary to
  negotiate with drag at all.
- The three buildings with the most existing ground-level westcampus geometry
  are **Rambler (50 pieces)**, **Block on 25th East (44)** and **The Block
  (15)** — all balcony-and-rail runs reaching grade, plus a ground-level amenity
  deck on Rambler and The Block. Those are the footprints where a new lobby is
  most likely to hit something, and the only three worth a plan check before
  emitting.
