# Pass: The Drag — PCL, Gregory Gym, the Texas Union, the Co-op, Guadalupe

Written 2026-07-31. Companion to `docs/PASS_COMMON.md`. Files: `scripts/bake_drag.py`
→ `data/drag.geojson`, rendered by `js/drag.js`, checked by
`scripts/verify/drag-check.mjs` and `scripts/verify/drag-perf.mjs`.

---

## 0. What was wrong

All five groups were choosing a facade by **height alone** — `js/facades.js:familyFor`
does not consult `building_class` except to separate parking, stadiums and residential
towers. So:

| building | height → family | what that draws | what it is |
|---|---|---|---|
| Perry-Castañeda Library | 15.8 m → `mh` | punched-window grid, 20% glazing | 1970s precast brutalism, largely **blind**, openings are deep coffers reading near-black |
| Gregory Gym | 20.0 m → `mh` | same grid, on a baked `#a05b45` | 1930 buff-brick gymnasium, three enormous round arches, cast stone |
| Texas Union | 11.9 m → `mr` | walk-up grid | 1933 cream **limestone** ashlar, arcaded ground floor, red tile roof |
| University Co-op + 20 shops | 5.1–13.7 m → `mr`/`lo` | residential windows on the ground floor | shopfronts: one tall glass band, bulkhead under, sign band over |

The last row is the important one. A three-storey building is *almost entirely ground
floor*, so getting the ground floor wrong is getting the building wrong.

---

## 1. The 1930s campus vocabulary — derived here, for reconciliation with the Tower pass

`docs/FIVE_BUILDING_PASSES.md` says the Tower pass is deriving the same system for the
Main Building and that the two answers must agree. Here is mine, with sources, so the
merge has something concrete to compare.

**One correction up front, and it matters:** the two 1930s buildings in this pass are
**not the same material as each other**. The brief's shared description ("brick and cast
stone") is right for Gregory Gym and wrong for the Texas Union.

| element | Gregory Gymnasium (1930) | Texas Union (1933) |
|---|---|---|
| architect | Herbert M. Greene ([Wikipedia](https://en.wikipedia.org/wiki/Gregory_Gymnasium), [UT RecSports](https://www.utrecsports.org/facilities/gregory-gym-history)) | Paul Cret |
| primary wall | **buff/tan face brick** — Acme Brick, per [Acme's own case note](https://brick.com/stories/did-you-know-the-iconic-university-of-texas-gregory-gym-was-built-with-acme-brick/) | **cream limestone ashlar**, laid in courses with visible block joints |
| sampled day hex | `#c28e64` sunlit → **`#b98a62`** | `#f0e6de` sunlit → **`#e6ded0`** |
| sample source | Wikimedia `Gregory Gym - UT Austin (54984752541)` | Wikimedia `Union Building - UT Austin (54984999764)` |
| trim | cast stone: coping, corbel table, base — sampled `#afa899` → **`#b3ab9c`** | cast stone: entry surround, balcony, cornice; same family as the wall |
| ground-floor openings | three **round arches**, ~9 m wide, in a mostly blank field | a **run of round-arched windows**, ~6.7 m centres |
| upper openings | small arched lights in the gable only | **punched rectangles**, ~6.7 m centres, ~1.3 m wide |
| decorative band | **arcaded corbel table** — a frieze of small blind arches, ~0.9 m each, under the raking parapet | deep frieze under an overhanging eave with exposed rafter tails |
| roof | gabled behind a coped raking parapet | **red barrel tile**, hipped, deep overhang |
| glazing (whole building) | ~10% — a gymnasium is a blind box | ~20% |

**Shared, and this is what the Tower pass should be able to match:** warm light masonry
between `#b8~` and `#e6~`; cast stone one step paler and greyer than the wall; round
arched openings at the ground floor only; a decorated horizontal band near the top;
terracotta roofs. If the Tower pass lands the Main Building's limestone materially
outside `#dcd4c6`–`#eae2d4`, one of us is wrong.

**Two things I did not draw, and why.** An arch head and a barrel-tile course are both
horizontal features, and a wall pattern here has no vertical anchor (§3). At the camera's
working distance one pixel of wall is about half a metre, so an arch head is a two-pixel
curve — drawing it would place it at a different height at every zoom. What survives is
the *arcade*: light piers against dark voids. The red tile roofs come from
`data/roofs.geojson`, which already carries 132 facets on the Union and 116 on Gregory;
this pass deliberately does not touch them (§4).

---

## 2. Reference table

`S` = sampled off a photograph's pixels. `D` = derived from a sourced quantity.
`G` = generative (the range is real, the exact value is authored).

| | PCL | Gregory Gym | Texas Union | University Co-op | Guadalupe streetwall (×20) |
|---|---|---|---|---|---|
| **built** | 1977, Bartlett Cocke `S` | 1930, H. M. Greene `S` | 1933, Paul Cret `S` | — | 1920s–2000s |
| **floors** | 7 (UT Building Inventory), 6 above the plaza `S` | 3 + annex `S` | 3–4 | 3 | 1–4 |
| **height used** | **27.5 m** `D` — see §5 | 20.0 m (baked) | 11.9 m (baked) | 16.4 m (baked) | 5.1–13.7 m (baked) |
| **floor-to-floor** | 3.2 m `D` | — | — | — | 4.3 m shopfront `D` |
| **facade system** | precast/limestone-clad **coffer grid**; glass at the back of a ~0.7 m reveal `S` | punched masonry, arcaded `S` | punched ashlar, arcaded ground floor `S` | shopfront + solid store above `S` | shopfront + lightly punched upper `S` |
| **sampled hex** | `#a8a19a` (overcast) `S` | `#c28e64` brick / `#afa899` cast stone (sun) `S` | `#f0e6de` (sun) `S` | — | — |
| **hex entered** | `#adb0af` — see §2a | `#b98a62` / `#b3ab9c` | `#e6ded0` | `#cbbda6` `G` | `#c4b49c` `#ded5c2` `#9a6a55` `#8f8c86` `G` |
| **bay rhythm** | 5.7 m drawn centres, 2.5 m of glass `S`/`D` | 13.3 m centres, 3.2 m void `S` | 6.7 m centres, 1.9 m (grd) / 1.3 m (upper) `S` | 3.2 m mullions `G` | 3.2 m mullions / 6.7 m upper `G` |
| **glazing** | 21% overall, 44% of a coffer band `D` | ~10% overall, 23% of the arcade band `D` | ~21% `D` | ~30% `D` | 45–70% (mostly ground floor) `D` |
| **roofline** | blank 3.3 m crown + 1 m lip `S` | coped raking parapet; tile roof from `roofs.geojson` | tile roof from `roofs.geojson` | flat parapet `S` | flat parapets, varied heights `S` |
| **ground floor differs?** | yes — recessed 1.0 m under the mass `S` | yes — arcade | yes — arcade | yes — shopfront | yes — shopfront |

Photographic sources, all Wikimedia Commons:
`University of Texas at Austin August 2019 26 / 28 (Perry–Castañeda Library)` (CC BY-SA 4.0),
`PCL1.JPG` / `PCL3.JPG` (CC BY 2.5),
`Gregory Gym - UT Austin (54984752541)` (CC BY 4.0),
`University of Texas at Austin August 2019 24 (Gregory Gymnasium)` (CC BY-SA 4.0),
`Union Building - UT Austin (54984999764)` (CC BY 4.0),
`Texas Union.JPG` (CC BY-SA 3.0),
`The drag, austin, texas (3233745166)` — the night reference for the streetwall.

### 2a. Sampled hex ≠ hex entered, and the difference is measured

The renderer's sun tint lands on every surface, and it is large. `js/app.js` already
records it for the stadium decks ("an input of R/B 1.18 renders at 1.85"). This pass hit
it twice, and both times the fix was to enter the value **cool of the sample**:

| | entered | rendered R/B | rendered luma | what it should have matched |
|---|---|---|---|---|
| PCL wall, first cut | `#b8b0a5` (R/B 1.11) | **1.75** | 146 | the tan brick building next door: **1.41** |
| PCL wall, corrected | `#adb0af` (R/B 1.00) | **1.52** | 113 | (same-frame neighbour still 1.41) |
| PCL roof, first cut | `#a9a6a2` (R/B 1.04, luma 167) | **1.51** | **211** | a concrete roof next door: **1.19 / 173** |
| PCL roof, corrected | `#7f868c` | **1.43** | **146** | (same-frame concrete roof **1.21 / 143**) |

The roof is now matched (146 against 143). The wall is still **8% warmer in R/B than the
tan brick building next door** — better than the 24% it started at, and it is now clearly
*darker* than that neighbour (113 against 131), which is what makes it read as a heavy
concrete mass rather than another tan box. One more cooling step would close it; I stopped
here and am reporting the residual rather than claiming it is fixed.

PCL is a grey precast box: it should be the **coolest** large mass on that block, and the
first cut made it warmer than a brick building. The second lever, which is also physically
right, is the coffer shadow: a 0.7 m-deep hole lit only by sky is **cool**, not black, so
`PCL_DEEP_TONE` is `[18,24,34]` rather than `[0,0,0]`.

The four streetwall tones were also respread. The first cut used `#c4b49c` / `#d8cfbc` /
`#9a6a55` / `#b0aaa2`, and three of those four sit within 0.1 of each other in luminance —
a run of twenty buildings meant to read as twenty different owners read as one long cream
wall. `r3` is now a dark painted grey and `r1` a paler cream.

---

## 3. The two rules everything here obeys

`fill-extrusion-pattern` is **tile-locked**: a 64 px repeat covers ~30 m of wall at tile
zoom 17, ~59 m at 16, and it repeats with no idea where the building's top or bottom is.

**Rule 1 — every vertical event is geometry.** Shopfront, sign band, upper floors,
parapet, cornice, coffer row: each is a separate feature with its own `base` and `h`,
emitted by `bake_drag.py`. 101 features across 24 buildings.

**Rule 2 — every tile is stationary in y.** A band here is 1–9 m tall against a tile
spanning 30–59 m, so a band shows an arbitrary horizontal *slice* of its tile, and *which*
slice moves as you zoom. So no tile in `js/drag.js` draws anything that varies with y.
Piers, mullions, fins, jambs and reveals are vertical and survive. Arch heads, window
heads, sills and string courses are horizontal and are not drawn at all.

The glazing/gap audit (`window.dragTileAudit()`, asserted by `drag-check.mjs`) — the
constraint on the **gap** is `js/facades.js`'s, learned when packing openings closer left
1–3 px of wall between them and every facade read as ribbed metal:

| family | glazing | intended | pier px | |
|---|---|---|---|---|
| `pclCoffer` | 43.8% | 44% | 5.1 | of the coffer band; 21% of PCL overall — see the note below |
| `gymArcade` | 23.4% | 23% | 16.3 | |
| `uniArcade` | 28.1% | 28% | 7.7 | |
| `uniWin` | 18.8% | 19% | 8.7 | |
| `retUpper` | 18.8% | 19% | 8.7 | |
| `shopGlass` | 80% | 80% | 1 | exempt from the pier minimum — a shopfront *is* thin mullions |

**PCL's bay pitch is wrong on purpose, and it is a resolution limit.** On the building the
coffer opening is ~2.7 m and the pier between two coffers is ~1.3 m — the openings are
*wider* than the piers. One tile pixel here is ~0.63 m, so a truthful 1.3 m pier is 2 px,
under the 5 px minimum, and the openings would fuse into ribbed metal at any real viewing
distance. So the coffer is drawn at roughly double the real pitch, one drawn coffer
standing for two. The **glazing ratio** is what survives to a 400 m camera and it is
right; the pitch is not, and that is the trade.

---

## 4. Band schemes

| building | bands (metres) |
|---|---|
| **PCL** (27.5 m) | base 0–5.0 *inset 1.0 m, the mass overhangs it*; then 6 × (spandrel 1.05 m full ring + coffer 2.15 m **inset 0.7 m**); crown 24.2–27.5 blank; cap to 28.5 |
| **Gregory** (20.0 m) | plinth 0–3.6 cast stone; arcade 3.6–12.6 brick + voids; frieze 12.6–16.8 corbel table; gable 16.8–20.0 cast stone; cap to 21.0 |
| **Union** (11.9 m) | arcade 0–4.05; ashlar + punched 4.05–9.28; cornice 9.28–11.9; cap to 12.9 |
| **Co-op** (16.4 m) | shop 0–4.3; sign 4.3–5.35; store 5.35–15.5; parapet cap 15.5–17.4 |
| **each shop** (5.1–13.7 m) | shop 0–**4.3**; sign +1.05; upper → parapet; parapet cap → `h + max(1, 0.015h)` |

**The shared datum is the point of the streetwall.** `SHOP_DATUM` is an absolute 4.3 m,
so 17 of the 20 shopfronts top out on exactly the same line (the other three are under
6 m tall and are clamped to 0.72 of their own height). The parapet comes off each
building's own baked height, which runs 5.1–13.7 m. One continuous datum, twenty
different parapets: that is what makes a run of small buildings read as a street.

**PCL's coffer inset is real depth, not a texture.** The glazed plane sits 0.7 m behind
the spandrels around it, so the silhouette notches in at every corner of every storey.
It is the only thing a flat extrusion can do to say "deep", and PCL is a building whose
entire character is depth of reveal.

---

## 5. Heights: what was kept, what was overridden, and why

**Kept — Gregory (20.0 m) and the Union (11.9 m), deliberately.** `data/roofs.geojson`
already lands their pitched tile roofs at 21.0 m and 12.9 m, which are exactly
`h + max(1.0, 0.015h)` — `js/app.js`'s parapet-cap rule — on those baked heights. Both
are probably 25–40% short of the real buildings. Raising them would leave 248 roof
facets buried inside the new mass and the two buildings would lose their red tile roofs,
which are a large colour event from the air and are explicitly what the campus should
read as. A short building with the right roof beats a tall one with none. So the bands
sum to the baked height and the cap reproduces app.js's rule exactly.

**Overridden — PCL, once, from 15.8 m to 27.5 m.** The baked value cannot be right:

- UT's Building Inventory gives PCL 7 floors and 491,578 gross sq ft.
- 491,578 sq ft over the 6,987 m² footprint is 6.5 floors' worth, so the floor count is
  consistent with the footprint.
- 15.8 m over 7 floors is 2.3 m of floor-to-floor, which is not a library.
- The photographs show six rows of coffers over a tall base with a blank parapet band
  above them.

27.5 m = 5.0 base + 6 × 3.2 storeys + 3.3 crown. **The accepted cost:** the 30 rooftop
mechanical units `data/roofscape.detail.geojson` places at 17.1 m are now inside the mass
and invisible. That is a lost detail, not a visual defect, and it is recorded here rather
than found later.

---

## 6. Which footprints are "the streetwall"

A geometric rule, not a list of ids, so a later snapshot cannot silently drop a shop out
of the run (`bake_drag.py:is_streetwall`):

1. centroid latitude between 30.28360 and 30.28775 — W 21st and W 24th, measured where
   each crosses Guadalupe's OSM centreline (30.28379 and 30.28769);
2. centroid **west** of that centreline by 0–55 m (the east side of Guadalupe from 21st
   to 24th is all campus: Goldsmith, Sutton, Battle, the Union);
3. nearest footprint vertex within 22 m of the centreline — it must hold the building
   line, which drops the things sitting behind the streetwall;
4. `final_height` ≤ 20 m and area ≤ 1500 m² — drops Dobie Twenty21 and The Castilian,
   which belong to the West Campus pass;
5. `building_class` not church / school / university / parking / apartments / …

That yields **20 buildings**, from 2200 Guadalupe (Church of Scientology, in a converted
two-storey commercial building) to 2354 (Shoe Palace), plus the Co-op at 2246 handled
separately. Two buildings physically on the streetwall are deliberately **excluded** by
rule 5 — Saint Austin Catholic School (2026 Guadalupe, 6 levels) and University Baptist
Church (2130) — because a plate-glass shopfront on either is worse than leaving them
generic.

---

## 7. Night

The reference is the Drag after dark, and it is not a scatter of lit windows: it is an
unbroken ribbon of lit shop interiors at street level with everything above it dark. So

- `shopGlass` goes to a continuous warm glow across the whole band, not per-pane — a pane
  scatter would read as apartments, which is the exact error being fixed;
- `signBand`'s signage blocks are the brightest thing on a two-storey building;
- `retUpper` lights ~26% of its openings, `pclCoffer` ~34% (a library is open late),
  `uniArcade` ~42%, `gymArcade` glows dimly;
- every wall still falls to its `wn` tone on the sun's schedule rather than the hour's, so
  the buildings silhouette through dusk instead of glowing against a darker sky.

Two measurements, because one of them is a trap:

- **The tiles as drawn** (`drag-check.mjs`, via `window.dragTileSample`, no map and no
  light involved): `shopGlass` luma **24 → 146**, `signBand` **98 → 124**, `retUpper`
  **179 → 66**, `pclCoffer` **151 → 59**, `uniWin` **208 → 78**.
- **The pass as rendered against the city** (`drag-night.mjs`, difference mask): at
  `p=0.86` the drag layers average luma **62.7** against `buildings-3d`/`buildings-roof`
  at **72.9** and the sky at **82.8**. The pass is darker than both, so it silhouettes.

The trap: a screenshot alone cannot tell "the tile never repainted for midnight" from
"the tile repainted and the scene light dimmed it", because the wall shading changes so
much between noon and midnight that both look identical. I read a night crop, called the
streetwall a pale cut-out, and was **wrong** — the pale surfaces were parapet-cap top
faces seen at 66° of pitch, and the masked measurement says the pass is darker than the
city around it. Hence both numbers above, and hence `drag-night.mjs` uses a difference
mask rather than an eyeballed crop.

---

## 8. Integration

- `data/drag.geojson` carries `replacedBuildingIds` (24). `js/drag.js` appends the
  exclusion to `buildings-3d` and `buildings-roof`, and **re-asserts it at +0.7 s, +2.5 s
  and +6 s** — `js/app.js`'s stadium loader does the same read-modify-write on the same
  two filters after its own fetch, and six passes are landing on them; if two read before
  either writes, one pass's exclusions are silently dropped and a building renders inside
  another. Re-asserting makes the order irrelevant.
- The bake checks its own `replacedBuildingIds` against every other
  `data/*.geojson`'s and prints the collisions (currently none).
- Layers are anchored to the first symbol layer **after** `buildings-3d`, not the first in
  the style — anchoring to the style's first symbol layer drops the pass under the ground.
- `fill-extrusion-vertical-gradient` is **off**: it darkens the bottom of every extrusion,
  and on a 4.3 m shopfront band the whole band falls inside the gradient.
- The pass registers its own images under `dg-` ids and touches nothing in
  `js/facades.js` — no shared palette entry is claimed.
- `?drag=0` removes the pass at load, for the perf A/B.

## 9. Frame cost

Measured with `scripts/verify/drag-perf.mjs` — headed, `index.html`, a scripted bearing
sweep so every run renders identical content, configurations interleaved and
counterbalanced, minimum of the reps, dropped frames rather than median frame time.

| run | off (dropped, MIN) | on (dropped, MIN) | delta | within-config spread |
|---|---|---|---|---|
| 4 reps | 165 | 189 | **+24** | off 108, on 44 |
| 6 reps | 175 | 168 | **−7** | off 52, on 51 |

**There is no result, and that is the honest reading.** The two runs disagree in sign and
both deltas are far inside their own within-config spread, which is the script's own
stated stop condition. The machine was running five other agents' verification harnesses
at the time (33 concurrent Chrome/node processes; best fps 10–18, against a scene that
normally holds 30+), so this is a noise measurement, not a cost measurement. What can be
said without measuring: the pass adds **101 fill-extrusion features in 2 layers and 16
64×64 atlas images**, against a scene that already carries ~12,000 trees, ~6,000 props,
12,058 roof features and a 7,625-building outer ring — and it removes 24 generic
extrusions and their roof caps. Re-run it on an idle machine before trusting any number.

## 10. Still missing

- **Per-elevation blindness on PCL.** The real building has whole elevations that are
  blank from grade to parapet; here every elevation carries the coffer field at the same
  density. Fixing it means splitting the footprint ring into edge runs the way
  `bake_stadium.py` does per side, and deciding which runs are blind — which I could not
  do reliably from the photographs I had.
- **Gregory's and the Union's heights** are the baked ones and are short (§5).
- **Awnings** are a real and very visible feature of the Drag and are not modelled.
- **Signage as geometry** — the Co-op's sign, the projecting blade signs — is drawn only
  as colour blocks in the sign band's tile.
- The streetwall stops at 24th. The real run continues to 26th; extending it is a
  one-line change to `DRAG_LAT_MAX`.
- The four retail upper-floor tones are assigned by a hash of the building id. The range
  is from the street; no individual building's colour is sourced.
- **PCL is still 8% warmer in R/B than the tan brick building next door** (1.52 vs 1.41),
  down from 24%. See §2a.
- **`shadows.js` still sweeps PCL's ground shadow from its baked 15.8 m**, so the shadow is
  about half the length the 27.5 m mass should cast. That file belongs to another pass.
- **The frame cost is unmeasured**, not zero — see §9. The A/B ran, and returned noise.
- Gregory's corbel table is drawn at roughly every third arch (2.5 m rather than 0.9 m),
  because the real pitch is 1.4 tile pixels and a 1-px rhythm moires against the pixel
  grid as the camera moves. The value and position are right; the frequency is not.

## 11. Renders

Before/after pairs at two times of day, from the flying camera, in `docs/shots/`:
`drag-street-{day,night}-{before,after}.jpg`, `drag-shopfront-{day,night}-{before,after}.jpg`,
`drag-pcl-{day,night}-{before,after}.jpg`, `drag-gym-day-{before,after}.jpg`,
`drag-union-day-{before,after}.jpg`, plus `drag-wide-{day,gold,night}.jpg`.

"Before" is the same build with `?drag=0`, which makes `js/drag.js` return before it adds
a layer OR touches `buildings-3d`'s filter — so the 24 replaced buildings are drawn by the
generic path again, from the same camera at the same hour. Hiding the drag layers instead
would leave those 24 filtered out and the "before" would be 24 holes in the city.
