# Campus and West Campus walls at two metres — the measurement, and two bakes

Acer lane, 2026-08-16. **No code, no browser, no pixels changed.** This is the
reading-work for the second half of QUEUE **Y5**: the Drag got storey bands on
2026-08-15 (PR #167) and the queue says in one line that *"campus and West
Campus walls still need the Drag close-range treatment"*. Campus is what the
video shows most.

Everything below is arithmetic over constants in this repo plus a census over
`data/snapshots/2026-08-16/buildings.detailed.geojson`, `data/osm_cache/`,
`data/ut_buildings.json` and the shipping `data/westcampus.geojson`. The one
number that is a live instrument reading is inherited and cited (§1).

Read with: `docs/camera/facades-at-two-metres.md` (the plan),
`docs/camera/facades-measured.md` (the app-confirmed measurement),
`docs/camera/facade-choice.md` (the taste decision), and
`scripts/bake_drag.py`'s storey-band block (the recipe being harvested).

---

## 0. THE HEADLINE, IN FOUR LINES

1. **Campus and West Campus wear the *same* barcode, at *half* the Drag's world
   scale.** `buildings-3d` and `wc-wall` both take
   `window.FACADE_PATTERN_EXPR`, i.e. `TIER_CSS` 32, i.e. **2.06 m of wall per
   repeat** at walking height — where the Drag was 4.12 m. Campus is twice as
   collapsed as the wall Simeon already called a barcode.
2. **The dominant family is `mh` in both districts** — 59.2 % of campus wall
   area and 46.3 % of West Campus wall area — and `mh` is the *worst* case:
   eight rows in 2.06 m is a **0.258 m storey**, with a full-height vertical
   every **0.121 m**.
3. **The bakes are cheap.** Storey bands on everything a person can walk up to
   cost **950 features / 617 KB** on campus and **959 features / 730 KB** in
   West Campus (~55 KB and ~65 KB gzipped). `data/entrances.geojson` is
   6.7 MB. This is not a budget question.
4. **The Drag's vocabulary does not transfer whole, and that is the main
   finding.** A base course + floor line + cornice is a *masonry* vocabulary.
   It is right for **17 campus buildings** (6.5 % of the walkable campus wall by
   area) and wrong for the 1950–89 concrete-and-brick bulk (**186 k m²**, the
   single largest slice) and flatly false on the 1990+ glass buildings
   (**95 k m²**). §6 says what to draw instead. Shipping one vocabulary
   everywhere is how a pass "looks wrong on half the city".

---

## 1. THE REPEAT, AND WHY THIS DOCUMENT DOES NOT RE-MEASURE IT

`docs/camera/facades-measured.md` §3 measured the world repeat in the running
app, with a calibration tile, at the recorded pose `GUAD-24TH-PAVEMENT-WEST`
(eye 1.70 m, pitch 87, `floor(zoom)` 20, `mpp` 0.064386 m/css px). Three of the
four walls it measured on are **in the districts this document is about**:

| wall measured there | district here | family | repeat measured | vs predicted 2.0604 m |
|---|---|---|---|---|
| University Presbyterian Church, N face | West Campus (`walk` 4.1 m) | `mh` | 2.0664 m | +0.3 % |
| University Presbyterian Church, S face | West Campus | `mh` | 2.0770 m | +0.8 % |
| unnamed block, 19.5 m | — | — | 2.0749 m | +0.7 % |

So the 2.06 m repeat is **not a derivation for this pass — it is a measurement
already taken on a West Campus wall.** What this document adds is the census,
not the ruler.

Two facts that make the whole scale question decided rather than open:

* `js/westcampus.js:1011` sets `'fill-extrusion-pattern': window.FACADE_PATTERN_EXPR`
  and `quantiseStadiumFacades` registers through the same `ensureImages` /
  `tierPixelRatio` path. **`wc-wall` is on the `facades.js` scale, not the
  `drag.js` one.** (`facades-measured.md` §5 saw it as 602 px of a Guadalupe
  frame and said the same thing; this is the code path behind that.)
* At walking height the whole reachable band is `floor(zoom)` 20–21, i.e.
  **2.06 m or 1.03 m** per repeat. There is no pose at 1.7 m that reaches a
  sane number, and Y4 (`ZOOM_MAX` 25) would push it to 0.13 m. Hence the
  sequencing rule that everything below is expressed in **metres**, never in
  zoom stops.

### What the collapse does, per family, at that measured repeat

| family | rows | **floor-to-floor at 1.7 m** | full-height verticals | **their spacing** |
|---|---|---|---|---|
| `mh` | 8 | **0.258 m** | 7 streaks + 5 pier pairs | **0.121 m** |
| `tr` | 9 | 0.229 m | 6 + 5 pairs | 0.129 m |
| `mr` | 6 | 0.343 m | 5 + 5 pairs | 0.137 m |
| `tg` | 10 | 0.206 m | 3 streaks, no piers | 0.687 m |
| `lo` | 2 | 1.030 m | 3 streaks, no piers | 0.687 m |

A person standing on the South Mall is looking at a limestone hall with a
**26 cm storey** and a dark line every **12 cm**.

---

## 2. WHO WEARS WHAT — THE CENSUS

Snapshot `data/snapshots/2026-08-16/buildings.detailed.geojson` (2,453
buildings). `familyFor()` reimplemented offline from `js/facades.js:735`.
"Claimed" = an id in `replacedBuildingIds` of `westcampus`, `drag`, `heroes`,
`arts`, `moody`, `tower` or `stadium` — those walls belong to another pass and
are excluded everywhere below.

District boxes: **campus** is `bake_entrances.py`'s own `CAMPUS`
`(30.2795, −97.7420, 30.2930, −97.7255)`. **West Campus** is
`(30.2820, −97.7530, 30.2960, −97.7420)` — Guadalupe's west kerb to Lamar, 21st
to 29th. That box is authored here and is the one soft edge in the census.

### Campus — 668 unclaimed buildings, 962 k m² of wall

| fam | buildings | wall area | % of district wall | median height |
|---|---|---|---|---|
| **`mh`** | 135 | **569.9 k m²** | **59.2 %** | 17.4 m |
| `mr` | 397 | 229.9 k m² | 23.9 % | 8.0 m |
| `tr` | 3 | 65.5 k m² | 6.8 % | 40.4 m |
| `tg` | 6 | 32.9 k m² | 3.4 % | 31.1 m |
| `dk` | 7 | 32.3 k m² | 3.4 % | 11.2 m |
| `lo` | 115 | 20.4 k m² | 2.1 % | 4.1 m |
| `st` | 5 | 11.4 k m² | 1.2 % | 8.0 m |

### West Campus — 819 unclaimed buildings, 904 k m² of wall

| fam | buildings | wall area | % of district wall | median height |
|---|---|---|---|---|
| **`mh`** | 161 | **418.4 k m²** | **46.3 %** | 14.6 m |
| `mr` | 549 | 338.2 k m² | 37.4 % | 8.0 m |
| `tr` | 7 | 60.7 k m² | 6.7 % | 29.7 m |
| `tg` | 7 | 45.6 k m² | 5.0 % | 28.6 m |
| `dk` | 8 | 28.3 k m² | 3.1 % | 18.2 m |
| `lo` | 87 | 12.5 k m² | 1.4 % | 4.0 m |

**`mh` + `mr` is 83 % of campus wall and 84 % of West Campus wall.** Two
families carry the districts. That is good news for a bake: two vocabularies
cover almost everything, and the four exotic families are a handful of
buildings each.

**69.7 % of campus wall area and 65.1 % of West Campus wall area sits above
4.30 m** — above the entrances pass's canopy datum, i.e. above everything the
modelled ground floor already does well. That is the atlas's territory and the
territory a storey band would take back.

### The 24 authored West Campus towers, which are a separate problem

`data/westcampus.geojson` already cuts its 24 buildings into stacked bands, and
the barcode lives in **only some of them**:

| band | features | families | summed band height |
|---|---|---|---|
| `base` | 24 | `sg` ×14, `sp` ×7, `sn` ×3 | 130 m |
| `podium` | 2 | `dk` ×2 | 36 m |
| **`tower`** | **34** | **`mh` ×22, `tr` ×7, `sb` ×3, `sp` ×1, `tg` ×1** | **810 m** |
| `crown` | 27 | `sf` ×26, `sp` ×1 | 82 m |

So **the tower band is 810 of the 1,058 banded metres and it is 29/34 on the
punched-window families.** That is where the collapse is. But the other three
bands collapse too, in their own way — the DKR band families are screen-locked
exactly like the window grids, and at the same 2.06 m repeat they land at:

| family | where | drawn structure | **pitch at 1.7 m** |
|---|---|---|---|
| `sg` | tower **base** (14 features) | 4 glazing tiers per repeat | **0.515 m**, glass 0.258 m tall |
| `dk` | **podium** (parking deck) | bands every 13 texels | **0.419 m** — a real deck is 2.4–3.0 m |
| `sf` | **crown** (26 features) | form-board line every 4 texels | **0.129 m** |
| `sb` | tower (3 features) | 5 window bands per repeat | 0.412 m |

The podium number is the loudest of these: a parking deck with **seven times
too many decks in it**, at eye level, on the streets students walk.

---

## 3. WHICH WALLS ACTUALLY MATTER — RANKED

A wall nobody walks past does not need this. "Walkable" here is measured, not
asserted: the minimum distance from any footprint vertex to any way in
`data/osm_cache/footways.json` (3,430 ways — 3,098 footway, 189 steps, 70
cycleway, 55 pedestrian, 18 path) or to any of 370 named-street ways in
`roads.json`. **481 unclaimed buildings sit within 25 m of a named corridor,
and they carry 55.8 % of the two districts' wall area.**

### The corridors, by wall area within 25 m

| corridor | bldgs | wall | `mh` share | note |
|---|---|---|---|---|
| Rio Grande | 67 | 156.7 k | 45 % | the West Campus spine |
| **24th St** | 45 | **144.4 k** | 64 % | Union on 24th, Thomas EEB, ODonnell |
| Dean Keeton | 46 | 115.0 k | 85 % | Kinsolving, Townes, BME |
| 25th St | 42 | 111.1 k | 59 % | West Campus |
| 21st St | 39 | 99.7 k | 56 % | San Jacinto Hall, UTC, Moore-Hill |
| Pearl St | 55 | 97.2 k | 49 % | West Campus |
| **Guadalupe** | 69 | **93.5 k** | 65 % | Rowling, Belo, Jones Comm B |
| **Speedway (mall)** | 11 | **90.3 k** | 71 % | Jester West, SAC, MBB, Welch |
| Inner Campus Dr | 25 | 88.0 k | 97 % | SAC, Welch, GSB, Calhoun |
| University Ave | 27 | 69.2 k | 78 % | Kinsolving, BME, UCC, AT&T |
| Speedway (street) | 14 | 63.4 k | 82 % | NMS, MBB, Seay, PMA |
| 26th St | 23 | 66.6 k | 90 % | Belo, GrandMarc |
| Nueces | 52 | 102.9 k | 59 % | West Campus |
| San Antonio St | 27 | 61.7 k | 54 % | West Campus |
| Whitis Ave | 20 | 52.2 k | 91 % | Kinsolving, Belo, Duren |
| Leon St | 35 | 45.5 k | 52 % | West Campus |
| San Jacinto | 15 | 29.2 k | 55 % | Alumni Center, Art Building |
| **South Mall** | 9 | 29.1 k | 73 % | the frames in the video |
| West Mall | 1 | 2.7 k | — | **undercounted — see below** |

**West Mall is not a named way in the cache** (South Mall is; West Mall and East
Mall are not), so the corridor query finds one building. Read by box instead
(Guadalupe kerb → Main Building, lat 30.2858–30.2872) it is **Flawn Academic
Center (1962, 13.2 m) and Hogg Memorial Auditorium (1933, 12.5 m)** plus the
Texas Union, which `js/drag.js` already owns. Small, and one of the two best
frames the project has. Do not let the query's zero talk you out of it.

### The one ranked list to build against

**Tier 1 — build first, 25 buildings, ~137 k m² of wall, every one of them a
frame someone will look at.**

*South Mall (14 buildings ≥ 8 m in the 21st-St-to-Main-Building box — the
corridor row above counts only the 9 within 25 m of the named footway — 47 k m²,
every single one family `mh`):*

| wall | height | year | family |
|---|---|---|---|
| Graduate School of Business | 24.2 m | 1975 | C |
| Calhoun Hall | 22.1 m | 1967 | C |
| Mezes Hall | 20.5 m | 1951 | C |
| McCombs School of Business | 16.1 m | 1962 | C |
| Waggener Hall | 24.8 m | 1931 | **B** |
| Battle Hall | 21.5 m | 1911 | **A** |
| Batts / Parlin / Benedict | 20.5 / 19.8 / 20.0 m | 1951 / 1955 / 1951 | C |
| Homer Rainey Hall | 17.1 m | 1941 | **B** |
| Sutton Hall | 13.0 m | 1917 | **A** |
| Garrison Hall | 12.9 m | 1926 | **B** |
| West Mall Office Building | 22.2 m | — | null |

*Speedway mall (11 buildings, 90 k m²):* SAC (27.6 m), NMS (37.4 m), MBB
(25.3 m), Welch Hall (17.2 m, 1930), Thomas EEB (26.8 m), PMA (25.5 m), Jester
Center (19.0 m, 1969), ODonnell (27.0 m), Patterson Labs (32.9 m).

**Tier 2 — the campus edges:** Guadalupe east frontage 21st–26th (19 buildings,
42 k m², Jones Comm B / Saint Austin / Webb Hall / Goldsmith), Inner Campus
Drive, University Ave, Whitis, Dean Keeton.

**Tier 3 — West Campus streets:** Rio Grande / 24th / 25th / Nueces / San
Antonio / Pearl. 162 unclaimed buildings ≥ 8 m inside the 24th–25th ×
Rio-Grande–San-Antonio box carrying 334 k m². Almost none of them are named in
the snapshot (54 of 271 in the recommended set have a name at all), so this
district must be driven by **geometry and height, never by a name list**.

**Explicitly deprioritised:** `lo` (115 + 87 buildings, 2 % of wall each). A
4 m shed has one storey; a floor line on it is a lie and its 1.03 m collapsed
storey is already the least wrong in the city.

---

## 4. STOREY HEIGHT, AND WHERE IT COMES FROM

This is the number the whole bake hangs on, so its provenance is spelled out and
its weakest link is named.

### Campus: **3.46 m**, and it is measured

`scripts/bake_tower.py:106` — `FLOOR = 3.46`, *"window-row pitch, from the gold
spandrels in the photo"*, i.e. a rectified elevation photograph of the UT Tower.
`docs/entrances/eras.md` §4 already adopts it as the campus storey reference.
It is the best number in the repo for this campus and it should be the default.

### West Campus: **3.25 m**, from the shipping bake's own slabs

`data/westcampus.geojson` carries 498 balcony slab features. Their base heights
per building give a measured slab pitch:

```
The Block 3.50   The Quarters Sterling 3.48   Grayson 3.47   2400 Nueces 3.45
Block on 25th E 3.42   Pointe on Rio 3.38   Crest at Pearl 3.37   Twenty Two 15 3.25
The Venue 3.18   The G 3.10   21 Rio 3.12   Cambridge Tower 2.85
Rambler 2.54   The Nine at WC 2.54   The Standard 2.17
```

Median **3.25 m**. **But do not ship the median onto these fifteen buildings.**
Six of them sit 0.4–1.1 m away from it, and a storey line at 3.25 m on a
building whose *existing balconies* are at 2.85 m puts two different floor
rhythms on one wall — a defect nobody would have to squint at. For the 24
authored towers, harvest `span / count` from the same `balc` spec the balcony
loop already uses (`bake_westcampus.py`, the `f2f = span / max(1, count)`
line). For the other 819, use 3.25 m.

### Parking decks: **2.4 m**, and it must be its own constant

Measured `final_height / num_floors` on family `dk`: **2.47 m** (campus, n = 6)
and **2.36 m** (West Campus, n = 2). `bake_westcampus.py`'s own podium specs say
`(3, 3.6)` and `(9, 2.80)`. Thin evidence, so: one named `DECK_M` constant at
**2.80 m**, sourced to the bake's own nine-level podium, overridable in one
line. A deck is not a storey and it must not take `STOREY_M`.

### Where a real floor count exists, and where it does not

| source | campus | West Campus |
|---|---|---|
| OSM `building:levels`, matched by name | 17 usable | 1 usable |
| snapshot `num_floors` (Overture) | 61 usable | 30 usable |
| **union, distinct buildings** | **75 of 668** | **33 of 819** |
| **share of district wall area covered** | **36.9 %** | **11.5 %** |

("Usable" = levels ≥ 2 and height ≥ 6 m.) The scout count quoted in
`eras.md` §5.1 — *138 with `building:levels`* over the wider survey box — is
consistent: `data/osm_cache/capitol_north_tags.json` holds 80 and
`capitol_area.json` 132, and most of them are outside these two boxes or fail
to match a footprint.

**And the ratio is contaminated, which is why it is a cross-check and not the
rule.** `final_height` is a LiDAR high point — it includes parapet and
mechanical, which is exactly why `bake_westcampus.py` cuts `mech` *out* of
`final_height` rather than adding it on. So `h / levels` is an **upper bound**
on floor-to-floor, not a measurement of it. It reads:

```
campus      median 4.18 m  (p25 3.22, p75 5.48, range 1.76-11.90, n=61)
West Campus median 4.01 m  (p25 3.30, p75 5.12, range 1.08- 7.35, n=30)
by family:  mh 4.32   mr 4.70   tr 3.86   tg 5.86   dk 2.47
```

3.46 m sits below that median, which is what an upper bound should do. **The
rule: where a levels count exists, fit `n` storeys to the measured count between
the base course and the cornice; where it does not, divide by `STOREY_M`.**
That is the same `storeys_of()` shape `bake_drag.py` already has, with the
count supplied instead of derived when it is known. 75 + 33 buildings get a real
floor count; 37 % of campus wall area is drawn from a measured number rather
than a nominal one, and it will be the visible-difference set.

### Eras, and how many buildings have a measured year

`data/ut_buildings.json` (UT's own building register, 198 entries, **a year on
all 198**) joined by normalised name and by OSM `ref`, over the 253-building
campus recommended set:

| era (`bake_entrances.py ERA_BOUNDS`) | buildings | wall area |
|---|---|---|
| **A** — Gilbert, ≤1925 | 4 | 8.6 k m² |
| **B** — Cret/Greene, 1926–1949 | 13 | 40.3 k m² |
| **C** — mid-century, 1950–1989 | 31 | **186.4 k m²** |
| **D** — modern, ≥1990 | 15 | 95.1 k m² |
| **no measured year** | 190 | 425 k m² |

**63 of 253 buildings carry a measured year, and they are 43.7 % of the
walkable campus wall by area.** West Campus: 0 — the register is Main Campus
only, and 217 of the 271 buildings in its set have no name at all.

---

## 5. THE TWO BAKES, SPECIFIED

### 5.0 The rule being harvested

From `scripts/bake_drag.py` (PR #167) and `js/drag.js`, verbatim in intent:

* **A horizontal event cannot come from a tile.** One repeat is
  `displaySize × mpp(floor(cameraZoom))` metres, so a line drawn into the tile
  lands at a different height at every zoom. It has to be **geometry, in
  metres**, which is also what survives Y4.
* **Every band is a ring offset OUTWARD from the footprint**, containing the
  wall's own face over its height. Proud stone. Nothing coplanar, nothing for
  the depth buffer to argue about, and the underside is what casts the line of
  shadow a barcode does not have.
* **Trim carries `dbase`/`dh`, never `base`/`h`, and claims NO `bid`.** The
  proud-geometry rule (`eras.md` §2.1–2.2): six passes already claim building
  ids, and a pass that claims none can never collide with any of them in either
  order. Trim *overlaps* its wall on purpose and must stay out of any
  no-gap-no-overlap band contract.
* **Rings emit at 8 decimals** (`to_ll8`): a 0.11 m offset against 7 decimals
  (~1 cm) is only a tenth of the offset; 8 gives a millimetre.
* **Flat colour, `fill-extrusion-vertical-gradient: false`.** A 0.26 m course
  that falls entirely inside the gradient goes black.
* Colour: the host's tone lifted by a named `BAND_TRIM_LIFT`, run through
  `wall_ramp()` for the day/golden/night trio. Do not invent a fourth dusk.

### 5.1 Ownership — three writers, three files, no overlaps

| what | bake | output file | drawn by |
|---|---|---|---|
| the Forty Acres, everything unclaimed | **`scripts/bake_campus_storeys.py`** (new) | **`data/campus_storeys.geojson`** (new) | new `js/storeys.js`, layer `campus-storeys` |
| West Campus generic stock (819 buildings) | **`scripts/bake_wc_storeys.py`** (new) | **`data/wc_storeys.geojson`** (new) | same `js/storeys.js`, layer `wc-storeys` |
| the 24 authored West Campus towers | **`scripts/bake_westcampus.py`** (existing) | `data/westcampus.geojson` (existing) | `js/westcampus.js`, new `wc-detail` layer |

The two new bakes share their geometry through a plain library module
`scripts/storeybands.py`, which **writes no file** and therefore owns nothing —
that keeps CLAUDE.md rule 1 ("each bake script owns exactly one output file")
intact while the offset/ring/era code exists once.

**Why the 24 towers must stay with `bake_westcampus.py` and cannot be swept up
by a generic bake.** That script alone knows where `base` ends and `podium`,
`tower` and `crown` begin, knows `mech` and `bayrise` are cut *out* of
`final_height`, and knows each building's balcony pitch. A generic bake reading
only the footprint and `final_height` would put a "cornice" in the middle of a
tower and slab edges out of register with balconies that are already there.
Two sources of truth for one building's floor heights is the defect, not the
duplication.

### 5.2 Geometry and offsets, per era

Base course / floor line / cornice, with `_PROUD` = metres the ring is offset
outward and `_H` = metres of ring height. The Drag's values are the starting
point and every one is a named constant.

| | Drag (shipped) | **A/B — limestone, ≤1949** | **C — 1950–1989** | **D — 1990+ / unknown** |
|---|---|---|---|---|
| base course proud / h | 0.17 / 0.42 | **0.20 / 0.55** | 0.12 / 0.35 | **none** |
| floor line proud / h | 0.11 / 0.26 | **0.14 / 0.30** (string course) | **0.12 / 0.30** (slab edge) | **0.06 / 0.18** (shadow reveal) |
| cornice proud / h | 0.34 / 0.55 | **0.45 / 0.75** | **none** | **none** |
| parapet cap proud / h | — | — | **0.20 / 0.45** | 0.15 / 0.35 |
| trim lift over host tone | 0.17 | 0.17 | 0.10 | 0.06 |

Provenance for the new numbers, all from this repo: family B's surround in
`eras.md` §4 is *"a cornice shelf 0.30 m thick projecting 0.45 m"* — the 0.45 /
0.75 cornice is that number, not a guess. Family C's slab edge takes its
thickness from the same document's canopy (0.25 m) rounded up to the 0.30 m the
repo's own `BALC_THICK` (0.34) says still reads. Family D's 0.18 m is
`eras.md`'s own family-D canopy thickness, whose *thinness against C's 0.25 is
stated there as the family read.*

**West Campus** uses the modern column plus one addition: a **slab edge at
0.10 / 0.30** on the tower band at each residential floor, aligned to the
existing balcony rows where they exist; a **deck edge at 0.10 / 0.25** on the
podium every `DECK_M`; and **no cornice, ever** — a 2010s student high-rise has
a parapet cap, not a cornice.

`STOREY_MIN_M` 2.00 and the "too short to band" refusal come across unchanged.
On the Drag it honestly refused 4 of 14 walls; here it refuses 268 of 668
campus footprints and 271 of 819 West Campus ones, which is correct — most of
them are 4–7 m sheds and garages.

### 5.3 What each bake costs

Model: rings = 1 base + (n−1) floor lines + 1 cornice over the wall above the
4.30 m entrances datum; bytes = 175 B of properties + 29 B per 8-decimal
coordinate pair, both measured on `data/drag.geojson`'s 23 shipped detail
features (387 B mean at 7.3 vertices).

| scope | banded bldgs | features | bytes | gzip | vertices | wall covered |
|---|---|---|---|---|---|---|
| **campus, walkable ≤10 m and h ≥ 8 m** | 253 | **950** | **617 KB** | ~55 KB | 16,070 | 78.6 % |
| campus, everything unclaimed | 400 | 1,313 | 801 KB | ~72 KB | 20,365 | 91.7 % |
| **West Campus generic, walkable ≤10 m and h ≥ 8 m** | 271 | **959** | **730 KB** | ~65 KB | 20,005 | 64.3 % |
| West Campus generic, everything unclaimed | 548 | 1,642 | 1,134 KB | ~102 KB | 30,134 | 90.6 % |
| the 24 authored towers (into `westcampus.geojson`) | 24 | **228** | **154 KB** | ~14 KB | 1,824 | — |

For scale: `data/entrances.geojson` is **6.7 MB / 14,242 features** (0.41 MB
gzipped) and `data/drag.geojson` is 60 KB.

**Recommendation: bake everything unclaimed, not only the walkable set.** The
walkability filter saves 184 KB on campus and 404 KB in West Campus — nothing —
and it buys a visible seam where a banded building stands next to an unbanded
one on the same street. The ranking in §3 is for deciding **what to look at
when judging**, not for deciding what to emit.

### 5.4 The layer, and the one number that must be measured before merge

One `fill-extrusion` layer per file, filtered `['==', ['get','kind'], 'detail']`,
`fill-extrusion-height: ['get','dh']`, `base: ['get','dbase']`,
`vertical-gradient: false`, colour from the baked trio through
`applyDragColors`'s shape.

**The flyover cost is the open risk and it is not the same as the Drag's.** The
Drag's 23 features measured **67 px of a 1.3 M-px cruise frame** (magenta-masked
per HANDOFF §48). These bakes are **~3,200 features — 139× as many** — spread
across two districts the tour flies directly over. Do not assume 67 px scales to
nothing. Two mitigations, in order:

1. **Gate the load the way `js/entrances.js` now does** (HANDOFF §126/§127): the
   file loads when the city is idle or the camera descends, not at boot. That
   protects the load budget for free.
2. **A `minzoom` on the layer**, expressed against `ALT_GROUND` rather than a
   zoom stop wherever the module can see altitude — same reason as everything
   else here.

Then measure it: magenta-mask the new layer at a recorded cruise pose, min of
interleaved reps, and quote the pixel count. **Frame-diffing cruise across
sessions has a 31 % noise floor (HANDOFF §114) — do not do that.**

---

## 6. WHAT WILL NOT TRANSFER, HONESTLY

This is the section that decides whether the pass ships something that looks
wrong on half the city.

**1. The cornice is a masonry object and campus is mostly not masonry.** A base
course, a string course and a cornice describe Battle Hall, Sutton, Garrison,
Waggener, Rainey and the Cret group. That is **17 buildings, 48.9 k m², 6.5 %
of the walkable campus wall.** The 1950–89 group is **186.4 k m²** — Mezes,
Batts, Benedict, Parlin, Calhoun, GSB, McCombs, Jester, Welch — concrete frame
and brick infill whose horizontal event is a *slab edge and a spandrel*, not a
projecting cornice. Putting the Drag's 0.34 m cornice on Calhoun Hall is the
same class of mistake as `familyFor` once putting a curtain-wall grid on DKR.

**2. On family D it is worse than wrong, it is a lie you can see.** GDC, EER,
NHB, Rowling, the Belo Center: a modern glazed building has **no cornice, no
base course and no string course.** 95.1 k m² of the walkable campus wall is
post-1990. The only honest horizontal there is a 0.06 m shadow reveal at each
floor and a thin parapet cap — and on a true curtain wall (`tg`, 6 campus
buildings) arguably nothing at all, because the mullion grid *is* the structure
and it is the one family `facades.js` exempts from `MIN_PIER`/`MIN_SPANDREL`.

**3. 190 of 253 campus buildings and all 271 West Campus ones have no measured
year.** `eras.md` §5.2 rule 8 is explicit that the default must be NULL and not
"C", *"because that is exactly how a wrong entrance gets onto 80 buildings at
once."* That argument binds here for the *cornice* and does **not** bind for the
*floor line*: every building has floors, and a slab edge asserts only that.
**So the null treatment is floor lines only** — no base course, no cornice, no
parapet band — and a building earns its cornice by having a year or a name.
That is a rule, not a patch, and it is the single most important line in this
document.

**4. West Campus's balcony slabs already are the floor line on 15 buildings.**
Adding a second horizontal at a different pitch would double-draw the thing the
pass exists to add. Those buildings want their slab edges *at the balcony rows*,
filling in the elevations the balconies do not reach — not a new rhythm.

**5. The night is a known regression and it is already solved once.** Candidate
A's calm wall went near-black after dark, and PR #167 fixed it by making the
tile's punched openings **night-only**: geometry carries the day, the old
treatment fades back in at dusk (`RET_NIGHT_FADE`). Nothing equivalent exists
for `facades.js` — its night lit-pane scatter is baked into `drawTile` for every
family in the city, and a campus/West Campus pass **cannot** flip it per
district without touching a file the atlas shares with downtown, the outer ring
and the Capitol. **Do not attempt the day/night swap in this pass.** Ship the
geometry over the existing tile and measure that the night wall is not darker
than live, exactly as §114 did. If it is darker, that is a separate, named job.

**6. Nothing here has been seen.** Every claim is arithmetic and census. §7.

**7. Two smaller traps.** `dk` at 0.419 m band pitch and `st` at eye level are
both in the walkable set (7 + 2 on campus, 6 in West Campus) and neither is a
window family; give `dk` its `DECK_M` and exclude `st` outright — DKR has its
own bake and its own vocabulary. And `tg`'s mullions already sit at the pixel
floor by design (`curtain: true`); a floor line on a curtain wall must be a
*spandrel* value change, not a proud ring, or it will read as a shelf.

---

## 7. WHAT I DID NOT DO

* **Did not open a browser and did not change a pixel.** By instruction. No
  frame in this document; nothing here is a fresh instrument reading. The one
  live measurement quoted (§1) is `facades-measured.md`'s, taken at the recorded
  pose `GUAD-24TH-PAVEMENT-WEST`, and it is cited as inherited.
* **Did not run `harness-drift.mjs`, `zfight`, `coplanar` or `drag-check`.** No
  code changed and no pixel work was done, so none of them is a gate on this
  pass. Every one of them is a gate on the pass that follows.
* **Did not start a server.** Nothing needed one; there is none to kill.
* **Did not confirm the 2.06 m repeat on a campus wall myself.** It was measured
  on University Presbyterian Church (West Campus, `mh`) and one unnamed block by
  the earlier pass, within 0.8 %. I re-derived it from `TIER_CSS` and confirmed
  the code path (`FACADE_PATTERN_EXPR` on `wc-wall`), which is a derivation, not
  a measurement, and is labelled as one.
* **Did not verify the district boxes against anything but themselves.** The
  campus box is `bake_entrances.py`'s own `CAMPUS`. **The West Campus box is
  authored in this document** and is the softest input in the census; move it
  10 m and the 819 count moves. Nothing else here depends on it to more than a
  few per cent.
* **Did not resolve the 24 authored towers' balcony-pitch disagreement.** Six of
  fifteen sit 0.4–1.1 m off the median and I state the rule (harvest
  `span/count`) rather than the fifteen numbers. The Standard's 2.17 m in
  particular looks like a `bayrise` interaction rather than a real pitch and
  should be read out of the spec table, not out of the geojson.
* **Did not cost `updateFacades` or any repaint.** These bakes add geometry, not
  atlas images, so the 80.4 ms baseline should be untouched — but that is a
  prediction.
* **Did not measure the flyover cost of ~3,200 features.** §5.4 says so
  explicitly and says how. It is the one number that could still kill the scope.
* **Did not look at night.** Every family number in §1 and §2 is the daytime
  drawing. The lit-pane scatter at a 0.26 m storey is almost certainly a haze
  rather than windows and nobody has photographed it.
* **Did not check `tower.js` or `heroes.js` walls.** They are on the 4.12 m
  scale and, per `facades-measured.md` §8b, nobody has stood under either. The
  UT Tower at eye level is still unphotographed.
* **Did not touch a single file other than this one.**
