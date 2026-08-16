# Which snapshot each bake reads, and how far the snapshots actually differ

Written 2026-08-16 by the Acer lane for QUEUE **NB5**, which said the entrance
bake reads `2026-08-04` while the app draws `manifest.latest` = `2026-08-16`,
and that nobody had compared the two files.

They have now been compared. **The two files are byte-identical.** NB5 is a
pinning bug with a measured blast radius of zero, and the useful half of the
answer is somewhere else: eleven other scripts pin an older date, one shipped
file records its snapshot and that record is stale, and because it is stale a
fast path in `js/facades.js` is switched off right now.

Nothing on this page needs a re-bake tonight except a one-line date stamp.

---

## 1. What each consumer reads

Established by reading the scripts, not by assuming. Line numbers are on
`main` at `2beaeb8`.

### The app

| Consumer | Resolves | Today | Files |
|---|---|---|---|
| `js/app.js:379-385` | `manifest.latest` | **2026-08-16** | `buildings.detailed.geojson`, `parts.detailed.geojson` (`:241`) |

`js/app.js:143` builds the URL, `:385` sets `activeDate = manifest.latest`.
There is no fallback to a hardcoded date.

### Bakes that follow the manifest — correct by construction

| Script | How |
|---|---|
| `bake_facades.py:180-205` | `snapshot_date()` reads `data/manifest.json` → `latest`, falls back to the newest directory only if the manifest is missing |
| `bake_campus_storeys.py:538` | calls `bake_facades.snapshot_date()` |
| `bake_props.py:605` | `manifest["latest"]` → `buildings.geojson` |
| `fetch_city_trees.py:334` | `manifest["latest"]` → `buildings.geojson` |

### Bakes that take the newest directory on disk — agree today, but not by construction

| Script | How |
|---|---|
| `bake_art.py:1838` | `sorted(glob("data/snapshots/*/"))[-1]` |
| `bake_roofscape.py:698` | `sorted(os.listdir(SNAPDIR))[-1]` |
| `bake_ground.py:1864` | `PRECINCT_SNAPSHOT or sorted(...)[-1]`, and `PRECINCT_SNAPSHOT = None` |
| `shape_trees.py:783` | `sorted(...)[-1]` |
| `name_buildings.py:94` | `sorted(...)[-1]` |
| `reseat_authored_roofs.py:135` | `sorted(...)[-1]` |

These resolve to `2026-08-16` today because all twelve snapshot directories
are complete. They are **not** the same question as the manifest:
`update_manifest.py:20` refuses to publish a directory missing
`buildings.detailed.geojson` or `parts.detailed.geojson`, and `sorted()[-1]`
does not. A half-written directory from the data bot would be picked up by six
bakes and by nothing else.

### Bakes pinned to a date written in the file

| Script | Pinned to | File |
|---|---|---|
| `bake_entrances.py:92` | **2026-08-04** | `buildings.detailed.geojson` — *this is NB5* |
| `bake_walk.py:659, :1422` | **2026-08-05** | `buildings.enriched.geojson` |
| `bake_heroes.py:67` | **2026-08-03** | `buildings.detailed.geojson` |
| `bake_arts.py:56` | **2026-07-30** | `buildings.detailed.geojson` |
| `bake_drag.py:85` | 2026-07-30 | ” |
| `bake_moody.py:59` | 2026-07-30 | ” |
| `bake_places.py:126` | 2026-07-30 | ” |
| `bake_roofs.py:83` | 2026-07-30 | ” |
| `bake_stadium.py:76` | 2026-07-30 | ” |
| `bake_tower.py:51` | 2026-07-30 | ” |
| `bake_westcampus.py:65` | 2026-07-30 | ” |

Plus five probes and reference-fetchers pinned to 2026-07-30 that ship no data:
`fetch_dkr_reference.py:31`, `fetch_roof_imagery.py:36`,
`overlay_arts_footprints.py:21`, `probe_dkr.py:32`, `probe_roofs.py:120`.

### Bakes pinned by an argv default

| Script | Default if you pass no argument |
|---|---|
| `bake_detail.py:33` | **2026-07-10** — the *oldest* snapshot, and this script **writes** `buildings.detailed.geojson` / `parts.detailed.geojson` |
| `bake_capitol.py:57` | 2026-07-30 |
| `bake_outer.py:61` | 2026-07-30 |

**The mixture is the actual bug.** Four scripts ask the manifest, six ask the
filesystem, eleven state a date, three state a date only when you forget an
argument. Four different answers to one question.

### Not a consumer

`data/snapshots/<date>/austin.pmtiles` differs in every snapshot, but nothing
reads it — the shipped vector tiles are `data/tiles/*.pmtiles` (`js/tiles.js`).
It is dead weight, not drift.

---

## 2. How far the files actually differ

`buildings.detailed.geojson` has only **three distinct contents** across the
twelve dated directories:

| md5 (first 8) | Dates |
|---|---|
| `6c1b30fa` | 2026-07-10, 07-11 |
| `bbdaba52` | 2026-07-27, 07-30, 07-31 |
| `05a95217` | **2026-08-01 … 2026-08-16** (ten directories) |

`buildings.enriched.geojson` has two (`b852da2c` for 07-10/11, `9f843eff` for
everything from 07-27 on). `buildings.geojson` has two, split the same way.
`parts.detailed.geojson` has two (`a7030e23` through 07-31, `f9059953` from
08-01 on).

### NB5 itself: 2026-08-04 → 2026-08-16

```
old = 2453 features        new = 2453 features
added                0
removed              0
geometry changed     0
properties changed   0
```

Same md5. **The entrance bake, the buried-door rule, and the 656 door groups
are all computed against a file that is bit-for-bit the file the renderer
extrudes.** NB2's Moody Center finding stands untouched, and so does every
other number in that pass.

`bake_walk.py`'s 2026-08-05 pin is the same story: `buildings.enriched.geojson`
is identical across all ten August snapshots and back to 2026-07-27. The
walking graph's door attachments are correct against the drawn file.

`bake_heroes.py`'s 2026-08-03 pin is inside the same identical run.

### The only pin that reads a genuinely different file: 2026-07-30 → 2026-08-16

Eight shipped bakes sit here. The measured difference:

```
old = 2453 features        new = 2453 features
added                0
removed              0
geometry changed     0        <- every ring on every building, bit-identical
properties changed   2453, in exactly two keys
```

The two keys:

* **`wn` — all 2453.** The night wall colour was re-derived wholesale on
  2026-08-01. The two palettes are *fully disjoint*: 182 distinct `wn` values
  on 07-30, 347 on 08-16, **zero in common**. Day colour `wd`, golden `wg`,
  roof `rd`/`rg`/`rn` and `final_height` are all unchanged.
* **`has_parts` — 6 buildings**, all `1` → absent:

  | Building |
  |---|
  | UT Tower |
  | Lyndon B. Johnson Building |
  | William B. Travis Building |
  | Dobie Twenty21 |
  | Hampton Inn & Suites Austin at The University/Capitol |
  | University Avenue Church of Christ |

  `has_parts` is destructive — `js/app.js:563` filters those buildings out of
  `buildings-3d`. Matching this, `parts.detailed.geojson` went 23 → 16
  features and gained a `pid` on every one; the seven dropped parts (h 94.0,
  94.0, 38.4, 25.6, 19.0, 12.8, 3.2) are those buildings' OSM parts.

**How far did any footprint move?** Nowhere. Zero buildings changed geometry
between 2026-07-30 and 2026-08-16, so there is no distribution to report and
no worst offender to name. The largest movement is 0.000 m.

### For the record: the one place footprints did move

`bake_detail.py`'s argv default, 2026-07-10, against today:

```
2026-07-10 -> 2026-08-16    old=2443  new=2453
added 11   removed 1   geometry changed 7
hausdorff m:  min 0.000  p50 2.074  p90 10.539  max 10.539
buckets:  <1cm 1   <10cm 0   <1m 2   <5m 3   >=5m 1
```

| Building | Hausdorff | Centroid shift |
|---|---|---|
| Beauford H. Jester Center | 10.54 m | 3.58 m |
| (unnamed `3e667f1f`) | 3.95 m | 1.14 m |
| Austin (`a5ec01b5`) | 3.70 m | 3.08 m |
| Art Building and Museum | 2.07 m | 2.09 m |
| Blanton Museum of Art | 0.00 m | 7.41 m |

Blanton is a ring wound from a different start vertex — same outline, moved
centroid. **No shipped bake reads 2026-07-10.** This table exists so that the
next person who types `python scripts/bake_detail.py` with no argument knows
what they would be regenerating.

---

## 3. Blast radius: derived geometry × real change

The intersection the queue item asked for. For each bake pinned at 2026-07-30,
which snapshot properties does it actually read?

| Bake | Snapshot properties read | Touches `wn`? | Touches `has_parts`? |
|---|---|---|---|
| `bake_arts` | `final_height` | no | no |
| `bake_drag` | `final_height`, `id`, `name`, `building_class` | no | no |
| `bake_moody` | `id`, `name`, `final_height` | no | no |
| `bake_places` | `name`, `lon`, `lat`, `id`, `final_height`, `building_class` | no | no |
| `bake_roofs` | `id`, `name`, `final_height`, `rd`, `rg`, `rn` | no | no |
| `bake_stadium` | `final_height`, `name`, `id`, `building_class`, and `base_props` copies `wd/wg/wn/rd/rg/rn` | **copies, then overwrites** | no |
| `bake_tower` | the footprint of one id | no | no |
| `bake_westcampus` | `name`, `final_height` (its `wn`/`wd` reads at `:1627`/`:1639` are of its **own** output, not the snapshot) | no | no |

`bake_stadium.py:1150` is the only line in the repo that copies `wn` off a
pinned snapshot — and `:1211-1213` overwrites it one line later with
`wall_ramp(col)` from the band's own authored colour. Checked against the
shipped file: `data/stadium.geojson` carries 12 `wn` values and **none** is
DKR's snapshot `wn` (`#1e2029` on 07-30, `#313134` on 08-16). Nothing stale
survived.

No bake reads `has_parts`. Four of the six `has_parts` buildings carry doors —
UT Tower (7 door groups, 209 features), University Avenue Church of Christ (2),
Dobie Twenty21 (3), Hampton Inn (2) — but those doors were baked from
2026-08-04, which *is* the drawn file, so they were never at risk.

**Buildings that carry a door, a storey band, or a walk-graph attachment AND
changed in a property their bake reads: 0.**

**Worst offenders: none exist.** No footprint moved.

---

## 4. The thing that is actually broken

Exactly one shipped file records which snapshot it was built from:

```
data/facade_palette.json     "snapshot": "2026-08-03"
data/manifest.json           "latest":   "2026-08-16"
```

`js/facades.js:815-825` refuses the baked palette unless the recorded snapshot
equals `manifest.latest`, and falls back to electing the palette in the browser
at boot. Those two strings are not equal, so **the baked fast path is off right
now** and has been since the snapshot rolled to 08-15.

`bake_facades.py:357` says so in its own output note, in capitals. Nobody read it.

I re-ran `scripts/bake_facades.py` in a throwaway worktree and diffed the
result against the shipped file:

```
snapshot: 2026-08-03 -> 2026-08-16
  palette    identical = True
  buckets    identical = True
1 file changed, 1 insertion(+), 1 deletion(-)
```

**One line.** The palette and the 14 buckets are byte-identical, because
`2026-08-03` and `2026-08-16` are byte-identical inputs. Re-baking re-arms the
fast path and cannot change a pixel.

The safety of the fallback is real and documented at `js/facades.js:787-789`
— the two paths are measured to produce the same answer — so this is a boot-cost
regression, not a visual one. It is still the clearest possible demonstration
of why the mechanism belongs everywhere: the *only* file that records its
provenance is the only place the drift was visible at all.

---

## 5. Recommendation

Honestly: **almost nothing needs re-baking.** The files are effectively
identical and it is the pinning that is wrong. That is the best available
outcome and it should be taken at face value.

**Do tonight — one line, no data churn, no visual risk:**

1. Re-bake `data/facade_palette.json` (`python scripts/bake_facades.py`).
   Changes one line, proven above. Re-arms the fast path. Minutes.

**Do next, as a pinning-only change with no re-bake:**

2. Point `bake_entrances.py:92` at `bake_facades.snapshot_date()`. **Do not
   re-bake `entrances.geojson`** — the input is byte-identical, so the output
   cannot move, and re-baking 14,893 features the night before a recording buys
   nothing and risks everything. Closes NB5 honestly.
3. Same for `bake_walk.py:659,:1422` and `bake_heroes.py:67`. Byte-identical
   inputs; no re-bake.
4. Same for the eight 2026-07-30 bakes. Their inputs are identical in **every
   property they read** — the only differences are `wn`, which none of them
   consumes, and `has_parts`, which none of them consumes. Repoint them so the
   *next* snapshot roll is caught; do not re-bake now.
5. Change `bake_detail.py:33`'s default from `2026-07-10` to the manifest date.
   It is the oldest snapshot, it is the one file where footprints genuinely
   moved 10 m, and this script *writes*. This is the only pin that could do
   real damage, and only by accident.

**Cost of the whole thing:** one bake re-run, and about a dozen one-line edits
across twelve scripts. Cost of doing nothing tonight: the recording is
unaffected — every shipped file is correct against the drawn footprints today.

---

## 6. How a bake should choose its snapshot, so this cannot recur

A hardcoded date goes stale silently. Following the manifest is right, but it
means a bake's output can change under you when the data bot runs. The fix is
not to pick one — it is to **make the choice legible in the output**, so a
check can compare it against what the app draws.

`bake_facades.py` + `facade_palette.json` + `js/facades.js:818` is already
exactly this design, working, in one place. Generalise it.

**1. One resolver, imported everywhere.**
`bake_facades.snapshot_date()` is the reference implementation. Lift it to
`scripts/snapshot.py` and have every bake import it. It reads
`data/manifest.json` → `latest` and falls back to the newest *complete*
directory (the `update_manifest.py:20` definition of complete — not
`sorted()[-1]`, which will happily pick a half-written directory the manifest
refuses to publish).

**2. Every bake records what it used, in its own output.**

```json
{ "type": "FeatureCollection",
  "snapshot": "2026-08-16",
  "features": [ ... ] }
```

Top-level, one key, alongside the `replacedBuildingIds` / `authoredRoofIds`
keys these files already carry. `facade_palette.json` proves the shape works.
`walk_graph.json` has an `as_of`, but it dates the OSM pull, not the footprint
snapshot — it needs the new key too.

**3. One check, `scripts/verify/snapshot-parity.py`**, with three outcomes,
because two would lie:

* read `data/manifest.json` → `latest`;
* for every shipped file carrying a `snapshot` key, compare;
* **equal** → PASS;
* **different, but `md5(snapshots/<recorded>/buildings.detailed.geojson)` ==
  `md5(snapshots/<latest>/…)`** → **STALE-BUT-EQUAL**, advisory, names the file
  and the two dates and says "re-bake at leisure; the bytes are the same";
* **different, and the bytes differ** → **FAIL**, and print the same three
  numbers this page reports — added / removed / geometry-changed — so the
  reader knows immediately whether it is a re-bake or a shrug.

That middle outcome is the whole point. Tonight was a full pass of work to
learn "the files are the same". This check answers it in a second, every time,
and still shouts when the answer is different.

**4. An explicit pin stays legal, but must say why.** A bake that genuinely
needs an old snapshot keeps its date as a named constant with a written reason,
and `snapshot-parity.py` carries a whitelist keyed on that constant. A pin with
a reason is a decision; a pin without one is this page.

**5. The bake's own health print already says the date** — `bake_facades.py`
and `bake_campus_storeys.py` both print `"snapshot": <date>` in their JSON
summary. Make that universal too, so a bake run in a terminal is
self-describing even before the check runs.

---

## What this page does NOT establish

* **No browser was run.** The claim that the baked facade palette is currently
  refused comes from reading `js/facades.js:815-825` plus the two data values,
  not from `window.facadePaletteSource()` on a live page. Someone with a
  browser should confirm it reads `baked for 2026-08-03, scene is 2026-08-16`
  before and `baked 2026-08-16` after.
* **No bake was re-run except `bake_facades.py`**, and that only in a throwaway
  worktree which was reverted. I proved the eight 2026-07-30 bakes read
  identical *inputs*; I did not prove that re-running them reproduces their
  shipped outputs byte-for-byte. Several have authored and measured inputs of
  their own that have moved since they were last run, for reasons unrelated to
  the snapshot.
* **`austin.pmtiles` was not diffed** beyond noting that it differs in every
  snapshot and that nothing reads it.
* **The outer ring was not examined.** `manifest.json` records
  `outer_ring.built_against_snapshot: 2026-07-30`, but its real input is an
  Overture release, not the campus snapshot, and it is explicitly
  date-independent.
* **`bake_capitol.py` and `bake_outer.py` argv defaults (2026-07-30) were not
  traced to a shipped file.** They take an argument; how they were last invoked
  is not recorded anywhere I could read.
