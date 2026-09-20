# Massing from lidar

The model used to guess how tall a building is. It now measures it — and, where
it cannot, it says so instead of publishing a number.

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
| `area_m2` | Area of **our** footprint polygon (EPSG:3857, corrected by cos(lat)) |
| `inv_area_m2`, `foot_ratio` | The target list's own footprint area for the same building, and ours over it. **0.5–2.0 is fine.** Outside that our polygon is a fragment; outside 0.25–3.5 no height is published at all |
| `ground_z` | Median class-2 (ground) elevation in a 14 m ring just outside the footprint, in metres above the lidar datum |
| `gnd_in_dz` | Median class-2 height *inside* the footprint relative to `ground_z`. A few metres negative is an excavated basement |
| `h_max` | Tallest class-6 (building) point inside the footprint, above `ground_z` |
| `h_p99` | 99th percentile of the same — the robust roof/parapet height |
| `h_med` | Median — the height of the bulk of the roof surface |
| `levels` | Roof steps: `[height_m, % of roof cells]` from a 0.5 m max-height raster |
| `slope_med`, `flat_pct`, `fill` | Median cell-to-cell slope of that raster in degrees, % of cells below 10°, and % of the raster's bounding box that carries any return |
| `roof` | `flat` / `pitched` / `mixed`, from the slope histogram of that raster |
| `roof_no` | Present *instead of* `roof` when a guard declined the call: `roof_too_small`, `too_sparse`, `raster_patchy`, `facade_not_roof`, `no_slope` |
| `roof_conf` | 0..1 confidence. **Capped at 0.45 when `split_agree` is false and at 0.6 on a partial footprint**, so the number can be read on its own |
| `split_agree` | Both random halves of the points gave the same verdict. This is *repeatability*, not correctness — a biased estimator agrees with itself perfectly — so it only ever lowers `roof_conf` |
| `n`, `d`, `noise_n` | Class-6 points inside the footprint, those points per m², and the ASPRS class 7/18 noise returns dropped before anything was measured |
| `h_nv` | 99th percentile of every non-vegetation, non-noise return inside the footprint. **A question, never a height** — see below |
| `city_h`, `city_cover`, `city_ratio`, `city_oid` | City of Austin 2017 footprint height; how much of **our** footprint that city polygon covers; and how many times **our** area it is |
| `snap_h`, `snap_floors`, `inv_h`, `auth_h` | What the model already claims, from the snapshot, the target list and the authored apartment file. Comparison only — nothing here is measured |
| `late_build` | The tallest of those claims is >8 m above anything the 2017 lidar found here, so the building postdates the flight and **these heights describe the site, not the building** |
| `trust`, `why` | `good` / `fair` / `poor` / `none`, and what is wrong when it is not `good` |

### The three flags that decide whether a height is usable

**`foot_ratio` is the first one, and it is the one that was missing.** Ninety of
the model-area buildings are not in `buildings.detailed.geojson` — all 76
downtown ones among them — and get matched by nearest centroid onto
`data/outer_ring.geojson`, which is drawn as tiles. That match can land on a
12 m² corner of a 4029 m² tower. Thirty buildings measured under a quarter of
their real footprint; they now ship with **no height at all**, and twenty more
in the 0.25–0.5 band ship flagged. Nothing downstream could previously tell.

**`late_build`** marks the 34 buildings where the lidar is measuring whatever
stood on the site in 2017 rather than what stands there now.

**`city_ratio` above 2** means the city drew a whole block as one polygon that
happens to contain us, and its height belongs to somebody else's building.
`city_cover` below 0.90 means the city drew our building as several polygons —
that one is much less dangerous, but it is not harmless either (numbers below).

### `h_nv` is a question, not a spare height

`h_nv` is the 99th percentile of every non-vegetation, non-noise return inside
the footprint. An earlier revision of this bake **promoted it to a height**
whenever class 6 was empty, on the theory that the 2017 classifier had missed
the roof. Measured against the point cloud, that theory is wrong:

```
signature-1909, inside its own footprint, heights relative to ground_z:
   class  1 (unclassified)  n=2167   p50  -5.94   p99  +74.19
   class  2 (ground)        n=6127   p50  -8.07   max  -2.61
   class  7 (noise)         n=  51   p50  -9.89
   class  6 (building)      none
```

Class 2 never reaches 73 m. The 74.68 m that used to ship as Signature 1909's
roof is class 1, sitting over 6127 ground returns **eight metres below grade** —
an excavated pit and a tower crane in February 2017, not a mislabelled roof.
Skyloft Austin has the identical shape. Both are now `construction_in_2017`
with no height, which `gnd_in_dz` detects directly.

The flag works in the other direction too. East Campus Garage reads 56.15 m in
`h_nv` against a class-6 roof of 22.05 m that agrees with the city's 19.54 m —
there it is `h_nv` that is spurious, and its class-1 returns run to 63.07 m
inside a footprint whose roof is 22 m up. So the flag is called `returns_above_roof`
(6 buildings) and it means *something unexplained is up there*, not *our height
is too low*.

---

## How to re-run it

```
pip install --only-binary=:all: laspy lazrs numpy
python scripts/bake_massing.py --plan     # how many octree nodes, how much to download
python scripts/bake_massing.py            # the bake (resumable — safe to interrupt)
python scripts/bake_massing.py --only welch-hall,the-castilian
python scripts/bake_massing.py --osm-refresh   # re-match OSM ids only, no lidar work
```

**That reproduces from a clean checkout.** The 553-building target list is
committed as `data/massing_targets.json` (119 KB: slug, name, area, tier,
lng/lat, footprint area, height, snapshot ids). It is an *input*, and
`--write-targets --inventory <curated inventory.json>` is the only thing that
writes it; `data/massing.json` remains this bake's single output file. Without a
target list the bake now **exits with an error** — it used to fall through to
"every feature in the snapshot", which produced a different target set with
different ids and looked like a successful run.

Downloaded octree nodes are cached **outside the repo** (`--cache`, default
`%TEMP%/austin-massing-cache`, or `$AUSTIN_MASSING_CACHE`), and every measured
building is cached too, so an interrupted run resumes without re-measuring
anything. Each building's split-half test is seeded from its own key, so
`--only <one building>` reproduces exactly what a full run gives it: re-running
eight buildings with `--only --force` against the cache reproduced **297 of 297
fields, 0 differing.**

### Four traps that cost real hours

1. `pip install lazrs` builds from source and fails on Python 3.9 — and laspy
   then *silently* cannot open a single LAZ file. Always `--only-binary=:all:`.
2. EPT X/Y are EPSG:3857. Planar distances must be multiplied by
   cos(lat) = 0.863 at this latitude or every area and density is 34% wrong.
   Z is already true metres — never scale it.
3. Five download workers, not twelve. Twelve produced 31 timeouts out of 92
   nodes.
4. A height with no footprint check is worthless, and non-class-6 returns are
   not a spare roof. Both cost this bake a whole revision — see above.

---

## What it measured

Run of 2026-09-20 over the 552 buildings of the model-area target list, against
the USGS_LPC_TX_Central_B1_2017 flight (acquired 2017-02-16 to 2017-03-14).

| | count | |
|---|---:|---|
| Buildings in the model area | 552 | |
| **Measured** (a real height off the point cloud) | **508** | 92% |
| Not measured | 44 | footprint refused 30, tree cover 5, vacant in 2017 6, construction site 3 |
| `trust: good` | 236 | dense returns, nothing flagged |
| `trust: fair` | 232 | measured, with something flagged in `why` |
| `trust: poor` | 40 | sparse, or the building postdates the flight |
| `trust: none` | 44 | no usable answer |
| `footprint_mismatch` (no height published) | 30 | our polygon is not this building |
| `footprint_partial` (flagged, height kept) | 20 | our polygon is a fragment of it |
| `late_build` (finished after the 2017 flight) | 34 | the height is the SITE's, not the building's |
| City polygon covers <90% of our footprint | 106 | the city drew our building as several polygons |
| City polygon more than 2× our footprint | 127 | the city polygon is a whole block |
| OSM id resolved | 487 | |
| `data/apartments` slug joined | 43 | |
| Class-6 density | 0.10–12.33 pts/m² | median 4.73 |

**Nothing with a `foot_ratio` outside 0.25–3.5 ships a height, a density or a
roof form. That assertion is checked on the shipped file: 0 rows violate it.**

### The 44 it could not answer

Thirty of them are our problem, not the lidar's — the footprint we handed it was
not the building:

| Building | our footprint | target list says | ratio |
|---|---:|---:|---:|
| One American Center | 12.3 m² | 4029 m² | 0.003 |
| ATX Tower | 5.9 m² | 1238 m² | 0.005 |
| 700 River | 9.0 m² | 1356 m² | 0.007 |
| 111 Congress | 23.0 m² | 1895 m² | 0.012 |
| Frost Bank Tower | 99.2 m² | 5062 m² | 0.020 |
| The Austonian | 155.1 m² | 1890 m² | 0.082 |
| Paramount Theatre | 111.8 m² | 1102 m² | 0.101 |
| The Driskill | 255.8 m² | 2548 m² | 0.100 |
| …24 more | | | |

Twenty-three of the thirty previously shipped a height. **Eight of them shipped
at `trust: fair`** with no footprint flag at all: 100 Congress, 111 Congress,
Colorado Tower, an unnamed 122 m downtown tower, Frost Bank Tower, the Paramount
Theatre at 17.90 m against the city's 57.88 m, The Austonian, and The Driskill
at 25.89 m against 50.81 m.

The remaining fourteen are real limits of a February 2017 flight:

| why | n | what it means |
|---|---:|---|
| `vacant_in_2017` | 6 | open ground: the footprint is full of class-2 returns and nothing above 3 m |
| `tree_cover` | 5 | closed canopy over a small roof; class-6 returns collapse |
| `construction_in_2017` | 3 | the ground *inside* the footprint sits metres below the ground outside it — an excavation. Signature 1909, Skyloft Austin, Moody Center |

### Reproducing heights we already knew

| Building | measured `h_max` | `h_p99` | stated | difference | source of the stated figure |
|---|---:|---:|---:|---:|---|
| Robert A. Welch Hall | **31.68 m** | 26.02 m | 32.61 m | **−0.93 m** | `docs/campus-truth/WEL.md` line 9 |
| Main Building and UT Tower | **99.36 m** | 91.96 m | 93.60 m | **+5.76 m** | target list `height_m` |
| Texas State Capitol | **91.06 m** | 73.28 m | 92.00 m | **−0.94 m** | target list `height_m` |
| Beauford H. Jester Center | **51.43 m** | 47.51 m | 53.40 m | **−1.97 m** | target list `height_m` |
| Perry-Castañeda Library | **28.67 m** | 27.49 m | 28.40 m | **+0.27 m** | target list `height_m` |

Four of the five land within two metres. **Welch is not an independent check:**
the 32.61 m in `WEL.md` line 9 is itself City of Austin
`ELEVATION − BASE_ELEVATION` — the same layer as `city_h`, which reads 32.61 m
for the same building. It belongs in the city-comparison section below, and it
is counted once, not twice.

The Tower is the instructive one: `h_max` is 5.76 m over the stated figure
because the lidar caught the mast and the flagpole, while `h_p99` — which throws
away the top 1% of returns — is 91.96 m, 1.64 m under a 93.6 m tower. That is
the whole reason both numbers are in the file. Use `h_p99` for a roof, `h_max`
when you want the antenna.

### The authored apartments

The authored files state a **top floor line**, not a roof height, so lidar
should land above it by roughly one storey plus a parapet. This is a sanity
check, not an accuracy measure:

| Apartment | `h_max` | `h_p99` | authored top floor | `h_max` − top floor | trust |
|---|---:|---:|---:|---:|---|
| dobie-twenty21 | 92.39 | 89.65 | 78.92 | +13.47 | good |
| 21-rio | 73.42 | 72.02 | 64.96 | +8.46 | good |
| the-castilian | 61.89 | 60.06 | 54.60 | +7.29 | good |
| the-callaway-house-austin | 61.48 | 60.52 | 50.45 | +11.03 | fair |
| 2400-nueces | 59.88 | 56.57 | 45.76 | +14.12 | good |
| ion-austin | 59.32 | 57.01 | 55.06 | +4.26 | fair |
| cambridge-tower | 53.43 | 52.88 | 50.57 | +2.86 | good |
| jester-west-hall | 51.43 | 47.51 | 46.36 | +5.07 | fair |
| welch-hall | 31.68 | 26.02 | 18.20 | +13.48 | good |
| san-jacinto-hall | 31.16 | 29.74 | 19.80 | +11.36 | good |
| pcl | 28.67 | 27.49 | 24.00 | +4.67 | fair |
| 2706-rio-grande | 27.16 | 25.40 | 15.50 | +11.66 | good |
| 2623-salado-street-apartments | 20.29 | 18.71 | 19.85 | +0.44 | good |
| battle-hall | 17.76 | 17.53 | 17.70 | +0.06 | fair |

Across the **27** authored apartments that existed in 2017 and have a usable
footprint: median `h_max` − top floor line **+6.77 m**, range −2.72 to
+15.09 m. Where the offset is large the authored floor list describes only part
of the building — Welch Hall's list stops at 18.2 m on a 32.6 m building.

Two apartments that used to sit in this table with a clean-looking +21.86 m and
+20.24 m offset — **signature-1909 and skyloft** — are gone from it. They were
never measured; see `h_nv` above. Twelve more authored apartments are
`late_build`.

### Against the city layer

The City of Austin's 2017 footprint layer measured the same city with a
different instrument and a different pipeline. Over every building that predates
the flight and has both numbers:

| The city's polygon is… | n | median difference | median \|difference\| | within 2 m | within 5 m | off by >10 m |
|---|---:|---:|---:|---:|---:|---:|
| same shape (cover ≥ 0.90 **and** ratio ≤ 2) | 285 | +0.80 m | 1.27 m | 63% | 88% | 4% |
| our building drawn as parts (cover < 0.90 **and** ratio ≤ 2) | 62 | +0.49 m | 0.89 m | 74% | 95% | 3% |
| a whole block (ratio > 2) | 119 | +4.67 m | 4.80 m | 27% | 53% | **21%** |

Those three rows are a partition, and the middle one is conditioned on *both*
flags. Taken on its own — which is how a reader would apply it — low coverage is
**not** the best group:

| | n | median \|difference\| | within 5 m | off by >10 m |
|---|---:|---:|---:|---:|
| all `city_cover` < 0.90, any ratio | 77 | 1.08 m | 82% | 12% |
| all `city_ratio` > 2, any cover | 119 | 4.80 m | 53% | 21% |

So: **coverage alone is a weak flag and ratio alone is a strong one.** The
scouting round proposed coverage; measured, it is `city_ratio` that separates a
usable city height from an unusable one, and coverage only looks clean once you
have already excluded the high-ratio buildings with the flag it cannot see.

The clearest example is Red McCombs Red Zone: our footprint is right (2103 m²
against the target list's 2089 m²) and the city's polygon is **19.0× that** —
73.23 m for a 38.88 m building, because the polygon is the stadium. The
Paramount Theatre used to be quoted here at 41×; that figure was inflated ten
times over by **our own** 111.8 m² sliver, and against the real 1102 m²
footprint the city polygon is 4.2×. The Paramount is now refused outright. The
conclusion survives the correction — 152 buildings have a `city_ratio` above 2,
and 122 of them are still above 2× when the ratio is recomputed against the
target list's own footprint area instead of ours — but the example did not.

### The ground is not flat

`ground_z` across the 522 buildings whose footprint passed the cross-check runs
**136.46 m to 186.18 m — a 49.7 m spread**.

| Part of the model | n | ground_z | spread |
|---|---:|---|---:|
| westcampus | 176 | 150.8 – 184.4 m | 33.6 m |
| campus | 169 | 149.7 – 186.2 m | 36.5 m |
| downtown | 76 | 127.8 – 176.1 m | 48.2 m |
| guadalupe | 73 | 167.4 – 183.7 m | 16.2 m |
| other | 58 | 152.4 – 185.2 m | 32.8 m |

The headline figure used to be 58.4 m. It was anchored on a single reading of
127.81 m under Austin Proper — a 27 m² broken footprint that is now refused. The
second-lowest reading in the whole model is 136.46 m, so 49.7 m is the
defensible number. (The 127.8 m still appears in the downtown row, because that
row is computed over every row that has a `ground_z`.)

`js/app.js` disables terrain on purpose — it culled buildings and made them
float on slopes — so every building in the model stands on one flat datum. That
is a deliberate, and now measured, ~50 m of error in relative base height
between the lowest ground in the model and the highest. It is small for a single
building seen on its own and large for a long view across the model, and
`ground_z` is the number that would fix it whenever someone wants to.

### Roof form: where the 2017 density supports a call, and where it does not

| Footprint | buildings | got a verdict | no call | split-half agreement | median pts/m² |
|---|---:|---:|---:|---:|---:|
| under 200 m² | 28 | 28 | 0 | **93%** | 4.36 |
| 200–500 m² | 88 | 84 | 4 | **81%** | 4.37 |
| 500–1 000 m² | 95 | 93 | 2 | **68%** | 4.99 |
| 1 000–2 500 m² | 172 | 167 | 5 | **78%** | 4.82 |
| over 2 500 m² | 125 | 119 | 6 | **77%** | 4.83 |

Verdicts: 246 flat, 140 pitched, 105 mixed, 17 declined among the measured.
The declines are `too_sparse` 7, `facade_not_roof` 5, `raster_patchy` 4,
`no_slope` 1.

**Split-half agreement is a repeatability measure and nothing more.** An earlier
revision called it "the honest measure of whether the density can support the
call", which it is not: a systematically biased estimator agrees with itself
perfectly. The case that proves it is a tower measured through a sliver
footprint: every return is a *facade* return at a different height, max-wins
rasterisation turns that into huge cell gradients — 78.9° median slope on
100 Congress, which is 2.5 m of rise per 0.5 m cell and not a roof surface at
all — and both halves agree, because the bias is in both halves. The Austonian
shipped as `pitched` at `roof_conf` **0.97**, `split_agree` true. It is a
flat-roofed glass tower. So did 100 Congress (0.86) and 360 Condominiums (0.67).

Three guards close that, and all three are one-line taste constants:

- The footprint refusal above. It is what closes The Austonian, 100 Congress,
  Frost Bank Tower and the other sliver-measured towers outright: they ship no
  roof verdict now because they ship no measurement.
- `MAX_SLOPE_FOR_ROOF = 45°` — a median cell-to-cell slope above this is a
  column of facade returns, not a roof surface. This is the mechanism guard for
  the towers whose footprint *is* fine: it declines 5 buildings, among them
  360 Condominiums at 50.7°, which used to ship `pitched` at 0.67.
- `MIN_FILL_FOR_ROOF = 25%` — the raster must actually cover its own bounding
  box. 100 Congress used to ship a verdict at 14.3% fill.
- `roof_conf` is now capped at 0.45 when the halves disagree and at 0.6 on a
  partial footprint. **111 shipped verdicts have `split_agree` false; none of
  them carries `roof_conf` ≥ 0.70.** Before, 46 did.

Below ~200 m² and below ~1 pt/m² no call is made at all. Between those and about
1000 m² a verdict is repeatable roughly seven or eight times in ten, which is
worth acting on in aggregate and not worth acting on for one named building.

---

## Licence

| Source | Position |
|---|---|
| **USGS 3DEP lidar** (`USGS_LPC_TX_Central_B1_2017_LAS_2019`, EPT on the AWS `usgs-lidar-public` bucket) | **US public domain.** Redistributable. Everything in `data/massing.json` derived from the point cloud is ours to ship. |
| **City of Austin** `UTILITIESCOMMUNICATION_building_footprints_2017` | The city catalogue says **"See Terms of Use"** — *not* an explicit public-domain dedication. We store the derived height number and the OBJECTID, which are facts; we do not redistribute the polygons. |
| **OpenStreetMap** (ids only) | ODbL. Only the id string is kept, as a join key. |

⚠️ **Seventeen tracked files describe that City of Austin layer as "public
domain":** `docs/campus-truth/*.md` line 9 in each of BAT, BTL, BUR, CAL, GAR,
GOL, GRE, HRH, JGB, LFH, MAI, PCL, SUT, UNB, WAG, WEL, plus
`docs/campus-truth/README.md` line 35, and a line in `HANDOFF.md`. That claim
does not match the city catalogue. **Flagged, not fixed** — those files are not
this bake's to edit.

---

## What this cannot answer

- **Nothing about walls.** Lidar is nadir. It sees roofs and the ground. It
  has no opinion about a facade, a window grid, a material or a colour, and no
  amount of processing will make it have one. Street photography still owns
  that question.
- **Nothing at night.** There is no lighting information in a point cloud.
- **Nothing built after 2017.** The flight is from February–March 2017. Any
  building finished since is missing, half-built, or is still the thing that
  stood there before.
- **Nothing under a tree.** Where a canopy closes over a small roof, the
  class-6 return count collapses and the bake declines to answer.
- **Nothing about a building we pointed it at wrongly.** Thirty of the 552 were
  measured on somebody else's patch of ground, and the only reason we know is
  that the target list carries an independent footprint area. Fixing those means
  giving downtown real per-building footprints; that is a separate job.
- **No interiors, no floor lines.** Storey counts come from permits and
  appraisal records, not from here. Height ÷ storeys is the useful join, and
  the storey half of it is a different bake.
- **No build dates.** `late_build` and `construction_in_2017` are inferred from
  the point cloud and from a building's absence from the 2017 city layer, not
  from permit or appraisal records.
