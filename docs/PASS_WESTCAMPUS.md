# West Campus towers — the reference table

Written 2026-07-31, for the pass described in `docs/FIVE_BUILDING_PASSES.md` §2.
Everything here is so the next person does not re-derive it. Read
`docs/PASS_COMMON.md` first.

Files: `scripts/bake_westcampus.py` → `data/westcampus.geojson` → `js/westcampus.js`.
Verify: `scripts/verify/westcampus-probe.mjs`, `westcampus-shot.mjs`,
`westcampus-perf.mjs`, `shots-westcampus.json`.

---

## 0. The correction this pass makes to its own brief

The brief says *"almost every one of these is four to seven levels of structured
PARKING at the base with the residential tower set on top of it"*. **That is true
of two of the ten and false of the rest**, and the reason is Austin's University
Neighborhood Overlay: on lots of 1,200–2,900 m² the 2009–2020 towers put their
parking **underground** and their pool on the **roof**. Sourced, per building:

| Building | Parking | Pool |
|---|---|---|
| The Castilian (1967) | **levels 2–10, above grade** | amenity floor 11 |
| Dobie (1972) | two-level mall + garage podium | **podium roof** (nadir) |
| Cambridge Tower (1965) | underground + porte-cochère | roof terrace, no pool (nadir) |
| Moontower (2020) | "four floors of below-grade parking" | roof |
| Inspire on 22nd (2019) | "four stories of underground private parking" | roof |
| Signature 1909 (2018) | garage, not expressed above grade | **lower wing roof** (nadir) |
| Ion Austin | ditto | **south setback terrace** (nadir) |
| Skyloft (2018) | ditto | **main roof, south end** (nadir) |
| 21 Rio (2009) | ditto | roof (no podium setback in the nadir) |
| Callaway House (2014) | ditto | roof |

So the pass emits a `dk` parking-deck band on **two** buildings, not nine. Putting
one on all ten would have been the same class of error as the bug this whole
project just fixed — a parking texture on a building that has no parking.

The one thing the brief is completely right about is the amenity deck: nothing in
the scene had one, six of these are visible from a 60–75° camera, and it is the
cheapest large-scale "these are apartments" signal available.

---

## 1. The parameter table

Every building runs the **same** system — `base / podium / tower / crown` stacked
bands plus optional balconies, deck, penthouse and sign. Only the values below
differ. They live in `BUILDINGS` at the top of `scripts/bake_westcampus.py`;
each is a one-line change.

Heights are `final_height` from `data/snapshots/2026-07-30/buildings.detailed.geojson`
and are **not** altered — the mechanical penthouse is cut *out* of the LiDAR high
point rather than added on top, the call `js/union24.js` makes for its 94.4 m
parapet under a baked 97.5.

| Building | h (m) | Fl | f2f | Facade system | Wall hex | Family | Base | Podium | Crown | Deck | Balconies |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Dobie Twenty21** | 82.0 | 27 | 2.6 | reflective green vision glass curtain wall (1990 retrofit stripped the original brick) | `#5f7a80` **sampled** | `tg` 51% | 6.0 m painted brick, `sp` | **3 lv `dk`** | 5.0 m notched cap, `sf` | podium roof: pool + turf + sport court | none |
| **21 Rio** | 73.5 | 21 | 3.2 | panel + punched window, private balcony per unit | `#b8b1a5` shared | `tr` 22% | 6.2 m glazed, `sg` | — | 4.0 m `sf` | roof | **19 floors × 2 elevations** |
| **Signature 1909** | 64.3 | 17 | 3.3 | white panel with a dark spandrel at every floor | `#a8a6a6` **sampled** | `sb` bands | 5.2 m glazed, `sg` | — | 3.6 m `sf` | **lower wing roof @30.5 m** + shade trellis | none |
| **Callaway House** | 62.5 | 17 | 3.2 | **red brick veneer**, punched windows, pier towers | `#a2614b` (bake) | `sn` brick | 5.4 m brick, `sp` | — | 3.8 m `sf` | roof | none |
| **The Castilian** | 60.0 | 22 | 2.6 | 1967 painted concrete, punched windows | `#d5cfc2` (bake + nadir) | `mh` 20% | 4.6 m retail, `sp` | **9 lv `dk` @2.80** | 3.2 m `sf` | **podium roof @29.8 m** (level 11) | none |
| **Ion Austin** | 59.1 | 19 | 2.9 | light panel with terracotta + blue-grey accent panels, glazed stair core | `#b0aeaa` *generative* | `tr` 22% | 7.0 m glazed, `sg` | — | 3.8 m `sf` | **south setback @21 m** | none |
| **Skyloft Austin** | 57.9 | 18 | 2.8 | panel, punched windows, **two light wells through the plan** | `#93a3ac` (bake) | `tr` 22% | 6.2 m glazed, `sg` | — | 4.0 m `sf` | roof, south end | none |
| **Moontower** | 57.3 | 17+4B | 2.9 | two-tone rainscreen: near-white panel against charcoal, broad vertical strips | `#7d8a8e` **sampled** | `tr` 22% | 7.4 m dark glazed, `sg` | — | 3.8 m `sf` | roof + **lit crown sign** | none |
| **Inspire on 22nd** | 56.4 | 18 | 2.8 | panel, punched windows | `#b8b1a5` (bake) | `tr` 22% | 6.0 m glazed, `sg` | — | 3.8 m `sf` | roof | none |
| **Cambridge Tower** | 55.0 | 15 | 3.1 | **New Formalism**: white concrete, continuous balconies with pierced "Solar Unit" breeze-block parapets, columns sweeping into an arcade of arches at the cornice | `#cbc6ba` **sampled** | `sb` bands | 5.0 m glazed, `sg` | — | 4.6 m **`sp` arcade** | roof terrace, south end | **15 floors × 2 elevations** |

`Union on 24th` (97.5 m) is `js/union24.js` and is not touched.

### Why these families, and not one family

`js/facades.js` owns the tile drawing and this pass may not edit it, so the
variation has to come from choosing among the families that already exist. That
turned out to be enough:

- `tg` — real curtain wall, 51% glazing, no pier/spandrel minimum. **Dobie only.**
  It is the only one of the ten that actually is a glass building.
- `tr` — residential tower, 22% glazing, punched. The 2009–2020 default.
- `sb` — deep horizontal window bands with slim fins. Right for the two buildings
  whose facade is read as *floors* rather than as *windows*: Signature's
  white-band-over-dark-spandrel and Cambridge's continuous balcony line.
- `sn` — brick veneer with punched windows and pier towers. **Callaway only.**
- `mh` — 4–7 storey campus hall, 20% glazing. The Castilian's 1967 grid.
- `dk` — open horizontal decks, bright spandrel edge, no glass. **Parking only.**
- `sg` — horizontal glazing, continuous lit band at night. Every double-height
  glazed lobby/retail base.
- `sp` — piers with deep openings between them. Two uses: a masonry base with
  punched slots (Dobie, Castilian, Callaway) and — the one that matters —
  **Cambridge Tower's crown arcade**, which is literally piers with openings.
- `sf` — board-formed concrete, near solid. Every plain crown. Its whole job is
  to be the band that **stops the window grid before the roofline**.

---

## 2. Where each fact came from

**Sourced** means a document or a photograph says it. **Generative** means this
pass chose it and the choice is defensible but unverified.

### Sourced
- Floor counts, years, uses, parking location and pool location for all ten —
  leasing material, Wikipedia, the architect's page, and news coverage. Notably:
  The Castilian's "level 1 leasing/retail, levels 2–10 parking garage, level 11
  amenities"; Moontower's "four floors of below-grade parking" (Gensler, LV
  Collective); Inspire's "four stories of underground private parking"; Dobie's
  1972 completion by J. & G. Daverman and its 1990 façade retrofit that
  "replace[d] its then brick façade by exposing the glass underneath"; Cambridge
  Tower's 1965 completion by Thomas E. Stanley, National Register listing (2018),
  breeze-block "Solar Units", brise-soleil columns, cornice arches, underground
  garage and porte-cochère.
- **Roof and deck layout** — Esri World Imagery z20 nadir tiles, one crop per
  building. This is what gave: Dobie's pool + artificial turf + sport court on
  the podium roof and its big round cooling towers; Skyloft's two light wells and
  its south-end pool; Signature's lower north wing with a pool and a shade
  trellis; Ion's south setback terrace with a pool; Cambridge's south-end roof
  terrace with planters; and the dense rows of per-apartment condenser units that
  are on nearly all of them (which is what the `mech` penthouses stand in for).
- **Dobie's tower footprint** — measured off a z20 nadir crop with a 10 m grid
  drawn over it. The Overture polygon is the whole block (4,998 m², 86 × 70 m);
  the tower is a chamfered square rotated 45° to the street grid, ~42 m across
  the diagonal, centred ~11 m east of the block centroid. Without that split
  Dobie draws a 4,998 m² mesa 82 m tall over half a block, which is what it did
  before this pass.
- **Wall colours, sampled off reference pixels** (k-means over the facade region,
  area-weighted to the distant read the way `js/union24.js` does):
  - Dobie — glass `#80a7ac` (31%), dark spandrel `#293b46` (29%), glass in shade
    `#3d545e` (23%), mid `#51636f` (17%) → area-weighted `#50696f`, lifted for
    the overcast/backlit exposure to **`#5f7a80`**. The bake had it at `#a2865a`,
    a tan. It is a teal glass tower.
  - Cambridge — the photographed elevations are in open shade under a clear sky,
    so the raw sample `#a2b0c5` is strongly blue. The sunlit sidewalk in the same
    frame reads `#d3c5bd`, and the building's own roof parapet reads `#ebead9` in
    the z20 nadir; both agree on a warm off-white, so **`#cbc6ba`**.
  - Moontower — light panel `#a4a5a4` (40%), charcoal panel `#24292e` (39%), glass
    → area-weighted `#5e696c` at golden hour backlight, lifted to **`#7d8a8e`**.
  - Signature — dark spandrel `#616165` (39%), white panel `#e1dddc` (31%) →
    area-weighted `#8c8b8e` at dusk, lifted to **`#a8a6a6`**.
- Roof/parapet tones cross-checked against z20 nadir: Castilian `#e5dfcb`,
  21 Rio `#ebe5d1`, Cambridge `#ebead9`, Skyloft `#dfdccc`, Dobie `#a09c8c`.

### Generative — stated plainly
- **Every band height.** Floor-to-floor is derived from the floor count and
  `final_height`, not measured. The Castilian's split (2.80 m garage, ~2.6 m
  rooms) is reasoned from 22 floors in 60 m, not sourced.
- **Ion Austin's and Inspire on 22nd's wall colour.** Ion's is derived from a dusk
  marketing render with the colour cast removed; Inspire has no usable photograph
  at all and keeps the snapshot's baked value. These are the two weakest rows.
- **Amenity deck contents** for 21 Rio, Callaway, Inspire and Moontower — the
  pool exists (documented) but its size and position on the roof are invented.
- **Balcony projection** (1.40 m) and **slab thickness** (0.34 m). The *existence*
  of Cambridge's and 21 Rio's balconies is sourced; the dimensions are not.
- **Crown heights** and the notched profile of Dobie's cap, which in the photo is
  a sawtooth of triangular notches and is modelled here as one flat band.
- All the `SOLID` day/golden/night trios in `js/westcampus.js`.

---

## 3. Two things worth knowing before you change this

**Atlas cost is per IMAGE, not per building.** The facade atlas is regenerated in
full on every time-of-day tick. The first cut of the table authored a crown and a
base colour per building and cost **32** new images; nine of those crowns were
pale greys within 9 RGB units of each other, which is invisible at any range this
app flies at. Materials that really are the same material now share a hex
(`BASE_GLASS`, `MASONRY`, `CROWN_WARM`, `PANEL_WARM` …) and it costs **19**. If
you add a building, share a hex unless the material genuinely differs.

**A roof deck placed at the parapet is invisible.** `buildings-roof` (and this
pass's `wc-wall-cap`) extrude the *whole footprint* from `h` to `h + max(1.0,
0.015h)` — a solid slab, not a ring. Anything standing on the roof has to start
above that, which is why `cap_lift()` exists in the bake. The first version put
ten amenity decks inside ten parapet caps.

---

## 4. What is still missing

- **Ion Austin and Inspire on 22nd have no photographic reference.** Two of ten.
  Under the escalation rule in the brief that is below the threshold of three, so
  the pass proceeded — but those two rows are the ones to fix first.
- Dobie's crown is a **sawtooth of triangular notches** with a deep recessed
  centre bay on each face. It is modelled as a plain 5 m band. That crown is the
  most distinctive roofline in West Campus and it is not drawn.
- Cambridge Tower's **breeze block** is not drawn and cannot be: a 12-inch block
  is 0.3 m, which is under a pixel at cruise. What is drawn is the balcony line
  it sits on, which is the part that reads.
- Moontower's **two-tone vertical strips** are flattened to one area-weighted
  colour, because a feature gets one wall colour. The same is true of Ion's
  accent panels.
- The **`step` clip is a single half-plane**, so a building whose lower wing is
  not a clean end-slice (Callaway's courtyard) does not get one. Callaway is
  drawn as a single mass with a roof deck.
- Balconies are **continuous per-floor slabs**, not per-bay. That is right for
  Cambridge (its balconies genuinely run the full elevation) and an
  approximation for 21 Rio.
- No **ground-floor signage or awnings**. The Drag pass owns that vocabulary.
