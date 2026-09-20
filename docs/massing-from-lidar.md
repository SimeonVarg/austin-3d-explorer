# Massing from lidar

The model used to guess how tall a building is. It now measures it.

`scripts/bake_massing.py` reads the public USGS 3DEP lidar point cloud for
central Austin, clips it to each building's own footprint, and writes one
measured record per building into `data/massing.json`: the ground under it, how
tall it is, where its roof steps, and whether that roof is flat or pitched. No
key, no account, no cost, and nothing here is anyone else's copyright.

It is a data pass only. **Nothing in the renderer reads `data/massing.json`
yet** — wiring it in is a separate pass, deliberately, so that the numbers can
be argued with before anything moves on screen.

---

## What it measures

Per building, keyed by the snapshot feature id the app already joins on
(`id`), plus `osm` (OSM way/relation) and `apartment` (the `data/apartments`
slug) where those exist:

| Field | What it is |
|---|---|
| `ground_z` | Median class-2 (ground) elevation in a 14 m ring just outside the footprint, in metres above the lidar datum |
| `h_max` | Tallest class-6 (building) point inside the footprint, above `ground_z` |
| `h_p99` | 99th percentile of the same — the robust roof/parapet height |
| `h_med` | Median — the height of the bulk of the roof surface |
| `levels` | Roof steps: `[height_m, % of roof cells]` from a 0.5 m max-height raster |
| `roof` | `flat` / `pitched` / `mixed`, from the slope histogram of that raster |
| `roof_conf` | 0..1 confidence in that verdict |
| `split_agree` | Whether both random halves of the points gave the same verdict |
| `n`, `d` | Class-6 points inside the footprint, and points per m² |
| `h_nv` | 99th percentile of **every non-vegetation return** inside the footprint. When this runs far above `h_max`, the 2017 classifier did not label that roof as a building |
| `fallback` | Set when there were no class-6 points at all and the height was taken from the non-vegetation returns instead (marked † in the tables below) |
| `city_h`, `city_cover`, `city_ratio`, `city_oid` | City of Austin 2017 footprint height; how much of **our** footprint that city polygon covers; and how many times **our** area it is |
| `snap_h`, `snap_floors`, `inv_h`, `auth_h` | What the model already claims, from the snapshot, the inventory and the authored apartment file. Comparison only — nothing here is measured |
| `late_build` | The tallest of those claims is >8 m above anything the 2017 lidar found here, so the building postdates the flight and **these heights describe the site, not the building** |
| `trust`, `why` | `good` / `fair` / `poor` / `none`, and what is wrong when it is not `good` |

**`late_build` is the flag to act on.** It marks the 51 buildings where the
lidar is measuring whatever stood on the site in 2017 rather than what stands
there now, and it is the only flag here that means "do not use this height".

The two city flags are about *identity*, not accuracy — whether the city's
polygon is the same thing as ours — and they fail in opposite directions. A low
`city_cover` means the city drew our building as several polygons, which turns
out to be harmless. A high `city_ratio` means the city drew a whole block as
one polygon that happens to contain us, and **that** is the one that poisons the
height. The scouting round proposed the first as the trust flag; measured, it is
the second that matters. Numbers below.

---

## How to re-run it

```
pip install --only-binary=:all: laspy lazrs numpy
python scripts/bake_massing.py --plan     # how many octree nodes, how much to download
python scripts/bake_massing.py            # the bake (resumable — safe to interrupt)
python scripts/bake_massing.py --only welch-hall,the-castilian
python scripts/bake_massing.py --osm-refresh   # re-match OSM ids only, no lidar work
```

Downloaded octree nodes are cached **outside the repo** (`--cache`, default
`%TEMP%/austin-massing-cache`, or `$AUSTIN_MASSING_CACHE`), and every measured
building is cached too, so an interrupted run resumes without re-measuring
anything. The model-area list comes from `--inventory` (or
`$AUSTIN_MASSING_INVENTORY`); without one the bake falls back to every feature
in the loaded snapshot.

### Three traps that cost the scouting round real hours

1. `pip install lazrs` builds from source and fails on Python 3.9 — and laspy
   then *silently* cannot open a single LAZ file. Always `--only-binary=:all:`.
2. EPT X/Y are EPSG:3857. Planar distances must be multiplied by
   cos(lat) = 0.863 at this latitude or every area and density is 34% wrong.
   Z is already true metres — never scale it.
3. Five download workers, not twelve. Twelve produced 31 timeouts out of 92
   nodes.

---

## What it measured

Run of 2026-09-20 over the 552 buildings of the model-area inventory, against the USGS_LPC_TX_Central_B1_2017 flight (acquired 2017-02-16 to 2017-03-14).

| | count | |
|---|---:|---|
| Buildings in the model area | 552 | from the round's inventory |
| **Measured** (a real height off the point cloud) | **537** | 97% |
| Not measured | 15 | vacant_in_2017 13, tree_cover 2 |
| `trust: good` | 236 | dense returns, city polygon agrees |
| `trust: fair` | 240 | measured, with something flagged in `why` |
| `trust: poor` | 61 | sparse, or the building postdates the flight |
| `trust: none` | 15 | no usable answer |
| `late_build` (finished after the 2017 flight) | 51 | the height is the SITE's, not the building's |
| City polygon covers <90% of our footprint | 127 | the city drew our building as several polygons |
| City polygon more than 2× our footprint | 152 | the city polygon is a whole block; its height is not ours |
| OSM id resolved | 487 | |
| `data/apartments` slug joined | 43 | |
| Class-6 density | 0.10–14.74 pts/m² | median 4.74, p10 3.63, p90 8.14 |

### The 15 it could not answer

Not one of them is a lidar problem. Thirteen sites were open ground when the plane flew — the footprint is full of class-2 ground returns and nothing above 3 m — and two are slivers of footprint under closed canopy:

| Building | why | footprint |
|---|---|---:|
| Arthur P. Watson House | `tree_cover` | 104 m² |
| Modern Austin Residences | `tree_cover` | 17 m² |
| Moody Center | `vacant_in_2017` | 50480 m² |
| George H.W. Bush State Office Building | `vacant_in_2017` | 6687 m² |
| Thompson Austin | `vacant_in_2017` | 1206 m² |
| Third + Shoal | `vacant_in_2017` | 1104 m² |
| Hilton Garden Inn | `vacant_in_2017` | 832 m² |
| Waterline | `vacant_in_2017` | 600 m² |
| 405 Colorado | `vacant_in_2017` | 536 m² |
| The Republic | `vacant_in_2017` | 278 m² |
| Guadalupe storefront 4d9c0911 | `vacant_in_2017` | 116 m² |
| Austin Proper | `vacant_in_2017` | 27 m² |
| Paseo | `vacant_in_2017` | 27 m² |
| 70 Rainey | `vacant_in_2017` | 26 m² |
| 700 River | `vacant_in_2017` | 9 m² |

### Reproducing heights we already knew

| Building | measured `h_max` | `h_p99` | stated | difference | source of the stated figure |
|---|---:|---:|---:|---:|---|
| Robert A. Welch Hall | **31.68 m** | 26.02 m | 32.61 m | **-0.93 m** | `docs/campus-truth/WEL.md` — City of Austin, 107.0 ft |
| Main Building and UT Tower | **99.36 m** | 91.96 m | 93.60 m | **+5.76 m** | inventory `height_m` (Main Building + Tower) |
| Texas State Capitol | **91.06 m** | 73.28 m | 92.00 m | **-0.94 m** | inventory `height_m` |
| Beauford H. Jester Center (Jester West + Jester East) | **51.43 m** | 47.51 m | 53.40 m | **-1.97 m** | inventory `height_m` (Jester West + East) |

Three of the four land within two metres. The Tower is the instructive one:
`h_max` is 5.76 m over the stated figure because the lidar caught the mast and
the flagpole, while `h_p99` — which throws away the top 1% of returns — is
91.96 m, 1.64 m under a 93.6 m tower. That is the whole reason both numbers are
in the file. Use `h_p99` for a roof, `h_max` when you want the antenna.

### The authored apartments

The authored files state a **top floor line**, not a roof height, so lidar should land above it by roughly one storey plus a parapet. This is a sanity check, not an accuracy measure — the offset below is expected, and where it is large the authored floor list is describing only part of the building (Welch Hall's list stops at 18.2 m on a 32.6 m building):

| Apartment | `h_max` | `h_p99` | authored top floor | `h_max` − top floor | city cover |
|---|---:|---:|---:|---:|---:|
| dobie-twenty21 | 92.39 | 89.65 | 78.92 | +13.47 | 0.98 |
| signature-1909 † | 74.68 | 72.94 | 52.83 | +21.86 | 1.00 |
| skyloft-austin † | 74.08 | 71.49 | 53.84 | +20.24 | 0.94 |
| 21-rio | 73.42 | 72.02 | 64.96 | +8.46 | 0.96 |
| the-castilian | 61.89 | 60.06 | 54.60 | +7.29 | 0.99 |
| the-callaway-house-austin | 61.48 | 60.52 | 50.45 | +11.03 | 0.98 |
| 2400-nueces | 59.88 | 56.57 | 45.76 | +14.12 | 0.98 |
| ion-austin | 59.32 | 57.01 | 55.06 | +4.26 | 0.97 |
| cambridge-tower | 53.43 | 52.88 | 50.57 | +2.86 | 0.97 |
| jester-west-hall | 51.43 | 47.51 | 46.36 | +5.07 | 0.71 |
| welch-hall | 31.68 | 26.02 | 18.20 | +13.48 | 0.92 |
| san-jacinto-hall | 31.16 | 29.74 | 19.80 | +11.36 | 0.96 |
| pcl | 28.67 | 27.49 | 24.00 | +4.67 | 0.99 |
| 2706-rio-grande | 27.16 | 25.40 | 15.50 | +11.66 | 0.96 |

Across the 29 authored apartments that existed in 2017: median `h_max` − top floor line **+7.29 m**, range -2.72 to +21.86 m. † = measured off the non-vegetation surface because the 2017 classifier left this roof out of class 6 entirely.

The other 13 authored apartments were **built after the flight** and are flagged `late_build`. The lidar is not measuring them, it is measuring whatever stood on the site in 2017:

| Apartment | lidar found | snapshot says | authored top floor |
|---|---:|---:|---:|
| the-mark-austin | 42.64 m | 18.0 m | 52.00 m |
| the-standard | 28.17 m | 20.5 m | 54.03 m |
| villas-on-rio | 15.31 m | 9.6 m | 52.20 m |
| union-on-san-antonio | 15.24 m | 7.4 m | 95.36 m |
| union-on-24th | 13.25 m | 97.5 m | 91.12 m |
| yugo-austin-rio | 12.58 m | 11.9 m | 24.50 m |
| yugo-austin-waterloo | 12.01 m | 8.4 m | 95.40 m |
| rambler | 11.86 m | 14.4 m | 25.30 m |
| inspire-on-22nd | 10.85 m | 56.4 m | 57.55 m |
| the-otis-hotel | 10.78 m | 6.6 m | 39.40 m |
| moontower | 9.74 m | 57.3 m | 53.30 m |
| villas-on-24th | 9.25 m | 8.0 m | 90.65 m |
| icon | 8.49 m | 7.8 m | 87.12 m |

### Against an independent source

The City of Austin's 2017 footprint layer measured the same city with a different instrument and a different pipeline, so it is the closest thing to an independent check available. Over every building that predates the flight, split by whether the city's polygon is actually the same shape as ours:

| The city's polygon is… | n | median difference | median \|difference\| | within 2 m | within 5 m | off by >10 m |
|---|---:|---:|---:|---:|---:|---:|
| same shape (cover ≥ 0.90, ratio ≤ 2) | 285 | -0.80 m | 1.27 m | 63% | 88% | 4% |
| city drew our building as parts (cover < 0.90) | 62 | -0.40 m | 0.92 m | 74% | 95% | 3% |
| city polygon is a whole block (ratio > 2) | 128 | -4.67 m | 4.83 m | 27% | 53% | 23% |

**The trust flag the scouting round proposed — coverage under 90% — does not on its own predict a wrong height, and I am not going to pretend it does.** The buildings it was derived from (Villas on Rio 10%, Rambler 37%, Union on San Antonio 21%) are all post-2017 towers, which `late_build` catches directly and which are excluded from this table. What coverage really measures is *shape*, and shape fails in two opposite directions: the city drew our building as several polygons (low cover), or the city drew a whole block as one polygon that happens to contain us (high ratio). The second is the dangerous one, and coverage alone cannot see it — the city's polygon over the Paramount Theatre covers 100% of our footprint and is **41 times its area**, so its 57.88 m is the block behind the theatre. Split that way, the same-shape group lands within 5 m 88% of the time and the block group only 53%. Hence `city_ratio` alongside `city_cover`.

The worst six disagreements in the whole model, which is where both sources show their failure modes:

| Building | lidar `h_max` | `h_nv` | city | difference | `city_ratio` |
|---|---:|---:|---:|---:|---:|
| UNIDENTIFIED university (8 m) at 30.28284,-97.73198 | 10.76 m | 4.77 m | 73.23 m | -62.47 m | 68.4× |
| UNIDENTIFIED university (10 m) at 30.28780,-97.73552 | 6.89 m | 62.92 m | 53.26 m | -46.37 m | 14.8× |
| UNIDENTIFIED university (8 m) at 30.28296,-97.73325 | 28.97 m | 15.65 m | 73.23 m | -44.26 m | 84.8× |
| Seaholm Residences | 105.24 m | 105.04 m | 61.49 m | +43.75 m | 2.7× |
| Paramount Theatre | 17.90 m | 17.03 m | 57.88 m | -39.98 m | 41.3× |
| Red McCombs Red Zone | 38.88 m | 38.78 m | 73.23 m | -34.35 m | 19.0× |

`h_nv` is the 99th percentile of every non-vegetation return inside the footprint, and reading it next to `h_max` and `city_ratio` says which source is wrong. Where `h_nv` tracks `h_max` and the ratio is large, our measurement is sound and the city's number belongs to a bigger polygon — four of these six are that. Where `h_nv` runs far above `h_max`, the 2017 classifier did not label that roof as a building at all and our class-6 clip is missing it: the UNIDENTIFIED building at 30.28780,-97.73552 has non-vegetation returns 62.92 m up and a class-6 surface that stops at 6.89 m. Those are flagged `taller_returns_unclassified` (6 buildings) rather than quietly shipped, and 7 more were measured off the non-vegetation surface outright because class 6 was empty (`fallback`).

### The ground is not flat

`ground_z` across the model runs **127.81 m to 186.18 m — a 58.4 m spread** (median 174.68 m).

| Part of the model | n | ground_z | spread |
|---|---:|---|---:|
| campus | 169 | 149.7 – 186.2 m | 36.5 m |
| westcampus | 176 | 150.8 – 184.4 m | 33.6 m |
| guadalupe | 73 | 167.4 – 183.7 m | 16.2 m |
| downtown | 76 | 127.8 – 176.1 m | 48.2 m |
| other | 58 | 152.4 – 185.2 m | 32.8 m |

The low point is Austin Proper at 127.8 m; the high point is Facilities Complex Building 8 at 186.2 m.
`js/app.js` disables terrain on purpose — it culled buildings and made them float on slopes — so every building in the model stands on one flat datum. That is a deliberate, and now measured, 58.4 m of error in relative base height between the lowest ground in the model and the highest. It is a small error for a single building seen on its own and a large one for a long view across the model, and `ground_z` is the number that would fix it whenever someone wants to.

### Roof form: where the 2017 density supports a call, and where it does not

Each building's class-6 points were split into two random halves and the flat/pitched verdict computed on each. **Split-half agreement** is the honest measure of whether the density can support the call at that size:

| Footprint | buildings | got a verdict | no call | split-half agreement | median pts/m² |
|---|---:|---:|---:|---:|---:|
| under 200 m² | 55 | 41 | 7 | **71%** (n=41) | 4.44 |
| 200–500 m² | 92 | 90 | 1 | **83%** (n=90) | 4.37 |
| 500–1 000 m² | 100 | 97 | 0 | **86%** (n=97) | 4.78 |
| 1 000–2 500 m² | 176 | 170 | 4 | **88%** (n=170) | 4.85 |
| over 2 500 m² | 129 | 124 | 3 | **88%** (n=124) | 4.84 |

Verdicts: 258 flat, 147 pitched, 117 mixed, 15 declined.

---

## Licence

| Source | Position |
|---|---|
| **USGS 3DEP lidar** (`USGS_LPC_TX_Central_B1_2017_LAS_2019`, EPT on the AWS `usgs-lidar-public` bucket) | **US public domain.** Redistributable. Everything in `data/massing.json` derived from the point cloud is ours to ship. |
| **City of Austin** `UTILITIESCOMMUNICATION_building_footprints_2017` | The city catalogue says **"See Terms of Use"** — *not* an explicit public-domain dedication. We store the derived height number and the OBJECTID, which are facts; we do not redistribute the polygons. |
| **OpenStreetMap** (ids only) | ODbL. Only the id string is kept, as a join key. |

---

## What this cannot answer

- **Nothing about walls.** Lidar is nadir. It sees roofs and the ground. It
  has no opinion about a facade, a window grid, a material or a colour, and no
  amount of processing will make it have one. Street photography still owns
  that question.
- **Nothing at night.** There is no lighting information in a point cloud.
- **Nothing built after 2017.** The flight is from February–March 2017. Any
  building finished since is missing, half-built, or is still the thing that
  stood there before — see the `late_build` flag and the failure table above.
- **Nothing under a tree.** Where a canopy closes over a small roof, the
  class-6 return count collapses and the bake declines to answer rather than
  guessing.
- **No interiors, no floor lines.** Storey counts come from permits and
  appraisal records, not from here. Height ÷ storeys is the useful join, and
  the storey half of it is a different bake.
