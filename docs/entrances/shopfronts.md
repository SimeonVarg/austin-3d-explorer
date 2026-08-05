# Shopfronts — the ground-floor retail vocabulary

**A written spec. No code, no geometry and no pixels have been produced against
it.** Sibling to `docs/entrances/eras.md`; same rules, same confidence tags, and
it is meant to be read *after* that file, because §4 below is a tenth family in
the `FAMILIES` table of `scripts/bake_entrances.py` and not a second door system.

Companion audit: `docs/entrances/groundfloor-existing.md` (what is already drawn
at ground level in West Campus). Read that first if the question is *is this
already there*.

---

## 0. Confidence tags

| Tag | Means |
|---|---|
| `[S]` | **Sourced.** A published statement, an ordinance, or an in-repo measured value. Cited. |
| `[C]` | **Code.** A building-code, accessibility or manufacturer's standard dimension. Cited. |
| `[M]` | **Measured.** Read out of a shipped data file or the running renderer during this pass. |
| `[D]` | **Derived.** Arithmetic on an `[S]`/`[C]`/`[M]` value; the arithmetic is shown. |
| `[A]` | **Assumption.** Not measured, not sourced. Reasoning shown so it can be argued with; every one is a one-line override. |

### The honest headline, before anything else

**I could not sample a photograph.** The brief asked for numbers derived from
photographs of Guadalupe and West Campus. This pass had no browser and no image
pipeline, so no pixel of any storefront photo was measured. What I did instead is
better than imagination and worse than a photo: **I went to the rules that
actually built these buildings.** West Campus has been rebuilt almost entirely
since 2004 under one ordinance — the University Neighborhood Overlay — and the
Drag's newer tenancies sit under Austin's Subchapter E design standards. Those
documents dimension the ground floor directly. Where they are silent I used
manufacturer's standards, ADA/IBC, or an `[A]` marked assumption.

**What this costs:** every *colour* below is `[D]` off a value this repo already
sampled, never off a photograph. If one number in this document is going to be
wrong it is a colour, and §7.6 names the check that would close it.

---

## 1. What already exists, so nothing here is drawn twice

Measured out of the shipped files during this pass. `[M]`

| system | what it puts at street level |
|---|---|
| `data/places.geojson` | **789 `front` slabs = 263 tenants**, each 3 bands (bulkhead / glass / sign) + 263 awnings + 133 labels. Stands `PROUD = 0.30 m` of the wall, claims no building id. |
| `js/places.js` | **one** atlas tile, `pl-glass`, 64 px. Vertical mullions every 5 px, 1 px wide; a day sky-reflection mix; **a night interior glow already exists** (`T.NIGHT 0.86`, `T.NIGHT_TONE [255,206,148]`, `T.BAY_RATE 0.34` brighter bays). |
| `js/drag.js` | the Guadalupe streetwall 21st–24th. `SHOP_DATUM 4.3` glass + `SIGN_H 1.05` fascia, carried by **11–15 `dg-` tiles**. |
| `data/entrances.geojson` | 584 doors / 258 buildings / 10,051 pieces, nine primitives, five families, two LOD tiers. **None of them is a shop door.** |
| `data/props.geojson` | 4,869 features: `furn` 3,589, `lamp` 532, `cons` 383, `lit` 236, `line` 95, `art` 34. Includes `outdoor_seating`, `bicycle_parking` (2.60×0.85×0.82 m), `bicycle_rental`, `planter`, `waste_basket`, `scooter`, `vending_machine`. |

**Therefore: the shopfront already has a glass band, a bulkhead, a fascia in the
brand colour, an awning, a mullion pattern and a night glow. It has no door, no
recess, no transom, no sill, and its night glow is one flat value for a bar and
for a shut hairdresser alike.** Everything in this document is one of those five
gaps or a correction to a number that is already there.

**Sidewalk furniture is DONE. Do not add A-boards, patio tables or bike racks.**
See §8 — there is also a legal reason, not just a duplication reason.

---

## 2. The regulatory frame — why West Campus storefronts are the shape they are

### 2.1 University Neighborhood Overlay (UNO), LDC §25-2-751 ff. `[S]`

Adopted Ord. 040902-58, 2004; amended 20080925-039. This is the ordinance that
produced 21 Rio, The Castilian's neighbours, Dobie Twenty21's frontage and
essentially every named tower in `data/westcampus.geojson`.

| § | requirement | metres `[D]` |
|---|---|---|
| 25-2-753(H)(1) | ground floor must be **occupant space along ≥ 75 %** of net street frontage | — |
| 25-2-753(H)(3) | ground floor within **5 ft** of the adjacent sidewalk level | ±1.52 |
| 25-2-753(H)(4) | **≥ 10 ft** finished floor to structural ceiling | **3.05** |
| 25-2-753(H)(5) | **≥ 18 ft** depth of occupant space, outside face of front wall to rear | **5.49** |
| 25-2-757(E) | building **≥ 12 ft** from the front face of the curb | 3.66 |
| 25-2-759(A) | **≥ 42 %** of street wall area must be occupant space | — |
| 25-2-760(A) | sidewalk **≥ 12 ft** wide on every frontage | 3.66 |
| 25-2-761(A) | no utility/mechanical/trash between a building and a street | — |

Two consequences with teeth for this pass:

1. **(H)(5) is why the night glow is the biggest win.** The lit box behind the
   glass is at least 5.49 m deep, by ordinance. A shopfront at night is not a
   lit *pane*, it is a lit *room* seen through a pane, and it is a room whose
   minimum depth is written down.
2. **(H)(4) says 10 ft, and `SHOP_DATUM` is 4.30 m ≈ 14 ft.** `[M]` The repo's
   shared glass head is one storey taller than the West Campus code minimum.
   That is *not* wrong — 14 ft ground floors are normal on the newer UNO towers
   and `SHOP_DATUM` is already clamped by `SHOP_MAX_FRAC 0.72` on short hosts —
   but it means the drawn glass head sits at the generous end of the real range.
   **Do not change it.** `js/drag.js` and `scripts/bake_places.py` share it
   deliberately so a brand fascia lands on the generic fascia it replaces.
   Recorded here so nobody "discovers" it later and breaks the alignment.

### 2.2 Subchapter E, City Code Ch. 25-2, Article 3 `[S]`

| § | requirement |
|---|---|
| 3.2.2.A.1 | **40 %** of wall area **below 10 ft** (from the entry's finish floor) shall be glazing |
| 3.2.2.A.2 | **25 %** of wall area between **10 and 30 ft** shall be glazing |
| 3.2.2.E | **at least half** of all glazing on the principal-street facade shall have **Visible Transmittance ≥ 0.6** |
| 2.x (shade) | building entrances shall be located **under a shade device such as an awning or portico**; a shaded sidewalk uses trees ≤ 30 ft o.c. **or a 4 ft awning** |
| 3.x | building entrances **at intervals of no more than 75 ft** along the principal-street elevation |

**§3.2.2.E is the single most useful number in this document for the night
pass.** VT ≥ 0.6 is a published, legally-required optical property: six tenths of
the interior light gets out through the glass. It is the reason a shopfront glows
and a dormitory window above it does not.

**The 75 ft entrance interval is the rule for placing the door** — see §5.2. It
is not a guess; it is the same instrument `bake_entrances.py` uses (evidence, not
scatter), applied to a frontage instead of a footpath.

### 2.3 Austin Building Code Chapter 32 — encroachments `[C]`

| § | requirement | metres `[D]` |
|---|---|---|
| 3202.2 | **doors and windows shall not open or project into the public right-of-way** | — |
| 3202.2.1 | steps shall not project more than **12 in** into the ROW | 0.305 |
| 3202.2.2 | columns/pilasters ≤ **12 in** projection; belt courses, lintels, sills, architraves ≤ **4 in** | 0.305 / **0.102** |
| 3202.2.3 | awning lowest part, incl. valance, **≥ 7 ft** clear of the ROW | 2.13 |
| 3202.3.1 | awnings/canopies/marquees/signs with **< 15 ft** clearance may occupy **≤ ⅔** of the sidewalk width; supporting stanchions **≥ 2 ft** in from the curb | 4.57 / 0.61 |

**§3202.2 is the whole reason a recessed entry exists,** and it is Austin's own
adopted code, not a style preference. A shop door big enough to need outswing
cannot swing over the sidewalk, so the storefront plane steps back far enough to
swallow the leaf. §5.1 derives the depth from exactly this.

**§3202.2.2's 4 in (0.102 m) sill/architrave limit is the ceiling on any
projecting trim in this vocabulary.** Nothing below projects more than 0.10 m
except the awning and the blade sign, both of which are explicitly allowed to.

### 2.4 The sign rule that changes the night, LDC §25-10-133 `[S]`

The University Neighborhood Overlay is also a **sign district**, and in it:

- a freestanding sign is prohibited;
- a roof sign is prohibited;
- no sign above the second floor except non-electric, engraved/inlaid work;
- **a sign may not be illuminated, or contain electronic images or moving parts.**

This is not theoretical. **Sweetgreen at 2234 Guadalupe — a tenant that is in
`BRANDS` in `scripts/bake_places.py` right now — had to go to the Board of
Adjustment (case C16-2020-0007, Nov 2020) for a variance from §25-10-133(G) to
allow one wall sign, one blade sign and a vinyl letter board, "all
illuminated".** `[S]`

**So `sign_ramp()` in `scripts/bake_places.py` is the downtown rule, not the West
Campus rule.** Its docstring says channel letters "are the brightest thing on a
two-storey building after dark — it is the entire reason the Drag reads at
night", and it pushes every fascia to near-full chroma at night. On the Drag that
is *partly* true (a stock of pre-2004 legally-nonconforming lit signs, plus
variance holders like Sweetgreen). Deeper into West Campus it is false by
ordinance.

**Recommendation, and it is a taste call so it is Simeon's:** keep `sign_ramp()`
as-is, because a dark Drag is a worse-looking Drag and the lit signs really are
there. But **stop making the fascia the primary night light source** and let the
interior take that job (§7). The fascia lift should read as *a sign that is lit*,
the interior as *a shop that is open*. Right now there is only the first, and the
Drag at night is a row of glowing labels over a dead wall.

---

## 3. Storefront anatomy — the numbers

Bottom to top. All metres. Every one of these is a named module-level constant in
a marked taste block (CLAUDE.md rule 11).

| element | value | tag | source / derivation |
|---|---|---|---|
| `SF_BULKHEAD` | **0.55** | `[M]` | already shipped as `BULKHEAD` in `bake_places.py`. Sits inside the 18–30 in (0.46–0.76 m) range the storefront-preservation literature gives; **no change**. |
| `SF_BULK_MAT` | matte dark, `#39332e` | `[M]` | already shipped as `BULK_COL`. Correct: a bulkhead is painted metal panel, tile or dark stone — the one *opaque* thing at eye level and the surface that takes the kicks. |
| `SF_SILL_H` | **0.05** | `[A]` | the sill/water table line at the top of the bulkhead. Held under the 0.102 m Ch.32 architrave limit. |
| `SF_SILL_PROJ` | **0.04** | `[C]` | §3202.2.2 allows 4 in; a real storefront sill projects far less, but 0.04 is the smallest projection that survives §9's pixel test at any altitude. |
| `SF_GLASS_TOP` | **4.30** | `[M]` | `SHOP_DATUM`. Shared with `js/drag.js`. Do not drift. |
| `SF_TRANSOM_H` | **0.60** | `[D]` | transoms run 12–36 in (0.30–0.91 m) in the storefront literature; 0.60 m ≈ 24 in is the middle. Occupies the top 0.60 m of the existing glass band — **it is a subdivision of glass that is already drawn, not new glass.** |
| `SF_DOOR_HEAD` | **2.30** | `[D]` | leaf 2.134 (`COMM_DOOR_H`) + 0.166 frame head. Leaves 2.00 m of glass above the door head. |
| `SF_MULL_FACE` | **0.051** | `[C]` | 2 in — the face width of the industry-default storefront system (Kawneer Trifab 451: 2 in face × 4½ in depth). |
| `SF_MULL_SPACING` | **1.35** | `[C]`/`[A]` | Kawneer's own guide spec: "mullion spacing … shall not exceed 6′ (1.83 m) on center". 1.35 m ≈ 4′-5″ is the common working bay; `[A]` within a `[C]` ceiling. |
| `SF_SIGN_BASE` / `SF_SIGN_H` | **4.30 / 1.05** | `[M]` | `SIGN_H`. No change. |
| `SF_AWN_PROJ` | **1.30** | `[M]` | shipped `AWN_PROJ`. Legal: sidewalk is ≥ 3.66 m (§25-2-760) and ⅔ of that is 2.44 m. |
| `SF_AWN_CLEAR` | **2.13** | `[C]` | §3202.2.3 minimum. The shipped awning bottom sits at `SHOP_DATUM − AWN_DROP − AWN_T = 3.84` m, comfortably legal. |

### 3.1 Mullion spacing — the existing tile is at roughly double the real rhythm

`js/places.js` comment `[M]`: "One tile is ~40 m of wall in the middle of the
flying range, so 1 px is about 0.63 m", with `T.MULL = 5` → **≈ 3.2 m** between
mullions. The real ceiling is 1.83 m and the real working bay is ~1.35 m.

**One-line fix: `T.MULL: 5 → 2`** gives ≈ 1.27 m, or `→ 3` gives ≈ 1.9 m.

**Do `3`, not `2`,** for a reason that is arithmetic and not taste: at `MULL 2`
the 1 px dark line is 50 % of the tile's area and `T.MULL_DARK 0.26` then removes
a quarter of the band's mean luma — which is precisely the failure `js/places.js`
already records fixing once ("the tile came back at luma 80 against a ~145 wall
and rendered as a black ribbed void … not glass, a hole"). At `MULL 3` the line
is 33 % and `T.GAIN 1.42` still covers it.

**A caveat that must be written down: `fill-extrusion-pattern` is tile-locked,
so the mullion spacing in *metres* is not constant — it shrinks as you zoom in.**
`0.63 m/px` is a mid-range figure, not a world constant. A tile can carry the
*rhythm* of a mullion grid; it can never carry its *dimension*. If the spacing
has to be true in metres, the mullions have to become geometry — and §9 says
that geometry is never worth a pixel, so they should not.

---

## 4. The new era: family `R`, era `"storefront"`

Slots into `FAMILIES` in `scripts/bake_entrances.py` alongside A / B / C / D /
E2 / E3 / E4 / E5, using **the same nine primitives and only different
parameter values**. That is the constraint eras.md sets and this obeys it: no new
primitive is proposed anywhere in this document.

```
"R": dict(
    era="storefront", arched=False,
    open_w=<by category, §5.3>, open_w_sec=<by category>,
    leaf_w=COMM_DOOR_W (0.914), leaf_h=COMM_DOOR_H (2.134), max_pairs=<by category>,
    spring_h=2.30,            # SF_DOOR_HEAD                                [D]
    arch_rise=0.0,
    transom=True, transom_h=0.60,     # SF_TRANSOM_H                        [D]
    surround_w=0.0, surround_proj=0.0,   # a storefront has no surround     [A]
    cornice=0.0, sign_band=False,     # the fascia is places.geojson's job  [M]
    reveal_d=<by category, §5.1>, reveal_col=REVEAL_SHOP,
    rise=0.00, riser=FLIGHT_RISER, tread=UTILITY_TREAD,   # §5.5            [S]
    cheek=False, rail=False,
    canopy=None,              # the awning is already drawn; do NOT add one [M]
    leaf_mat="aluminium", leaf_col=ALUMINIUM, glaz_frac=0.88,
    sur_mat=None, sur_col=None, glass_col=GLASS_SHOP,
    dt=<by category>, accent=None, accent_h=0.0,
)
```

Four fields differ in kind from every existing family and each is deliberate:

- **`canopy=None`.** `bake_places.py` already emits 263 awnings. A family canopy
  here would be a second awning on the same 12 m of wall.
- **`sign_band=False`.** `plSign` already exists at base 4.30.
- **`rise=0.00`.** See §5.5 — a shop floor is level with the sidewalk by
  ordinance, unlike every academic building in the existing families.
- **`glaz_frac=0.88`.** A narrow-stile aluminium shop door is almost all glass.
  Higher than C's 0.86 and just under D's 0.92.

**Family `R` is chosen by tenancy, not by building.** A `places.geojson` tenant
whose host also carries an E2 apartment lobby gets an `R` door for the shop and
keeps its E2 door for the residents. Both stand proud; neither claims an id;
they cannot collide. That is the entire reason to extend this system instead of
starting a second one.

---

## 5. The recessed entry

### 5.1 Depth — derived from the code, not assumed

Austin Building Code **§3202.2: "Doors and windows shall not open or project into
the public right-of-way."** `[C]` A shop with occupant load ≥ 50 must have
egress doors swinging in the direction of travel (IBC 1010.1.2.1), i.e. outward.
The building face is at or near the ROW line (UNO §25-2-757(E): 12 ft from the
curb, with a 12 ft sidewalk). **So the leaf's full swing must be contained inside
the building line.**

```
SF_RECESS_D  =  leaf 0.914  +  hinge stile & hardware 0.09   =  1.00 m   [D]
SF_RECESS_D2 =  1.00 + a 0.50 m landing apron                =  1.50 m   [D]
```

| value | metres | tag | used for |
|---|---|---|---|
| `SF_RECESS_D` | **1.00** | `[D]` | single-leaf categories. The minimum that satisfies §3202.2. |
| `SF_RECESS_D2` | **1.50** | `[D]` | double-leaf and high-turnover categories. |
| `SF_RECESS_D0` | **0.00** | `[C]` | inswing categories — a small shop under 50 occupants may swing in and often does; its door is flush with the glass line. |

### 5.2 Width, and where the recess goes

```
SF_RECESS_W = open_w + 2 x 0.20 jamb return                            [D]
```

Placement, in priority order — this is the same evidence-first discipline
`docs/entrances/placement.md` uses:

1. **The tenant's own frontage midpoint.** `bake_places.py` already computes
   `arc_slice(pieces, s0, s0+w)` per tenant and already places the label at
   `s0 + w*0.5`. **The door goes at the same arc position the label already
   uses.** Zero new geometry reasoning, and it guarantees the door is inside the
   tenant's own slot and never on a neighbour's glass.
2. **Nudge to the nearer end of the slot** when the slot is > 9 m, because real
   shopfronts put the door at one end and the display window at the other.
   `SF_DOOR_BIAS = 0.30` `[A]` — fraction of the slot from the nearer party wall.
3. **Never within `GAP` (1.2 m) of the slot edge.**
4. **A frontage longer than 22.9 m (75 ft) gets a second door**, per Subchapter E
   §3.x. `[S]` Applies to `supermarket`, `department_store` and the longer
   `food_court` runs; nothing else in `places.geojson` is that wide (`MAX_W`
   caps a tenant at 15 m).

### 5.3 Door type by category — the mapping from `cat` in `data/places.geojson`

Category shares are `[M]`, counted from the 789 shipped `front` slabs (3 slabs
per tenant, 263 tenants).

| `cat` | slabs | share | `dt` | leaves | `open_w` | recess | why |
|---|---|---|---|---|---|---|---|
| `restaurant` | 180 | 22.8 % | `hinged-pair` | 2 | 1.90 | `D2` 1.50 | waiting overflow; a pair is standard at ≥ 50 occupants |
| `fast_food` | 153 | 19.4 % | `hinged-pair` | 2 | 1.90 | `D2` 1.50 | highest turnover on the Drag |
| `cafe` | 138 | 17.5 % | `hinged-single` | 1 | 1.00 | `D` 1.00 | small footprint, one leaf, often propped |
| `convenience` | 54 | 6.8 % | `sliding-pair` | 2 | 2.00 | `D0` 0.00 | automatic sliders sit flush — they do not swing, so §3202.2 does not force a recess. This is why a 7-Eleven front is flat and a cafe front is not. |
| `pub` | 36 | 4.6 % | `hinged-pair` | 2 | 1.80 | `D2` 1.50 | often a solid or half-glazed leaf; `glaz_frac` 0.45 |
| `clothes` | 33 | 4.2 % | `hinged-pair` | 2 | 1.90 | `D2` 1.50 | wide open front, display windows either side |
| `bar` | 21 | 2.7 % | `hinged-single` | 1 | 1.00 | `D` 1.00 | `glaz_frac` **0.10** — a bar door is not a window |
| `hairdresser` | 18 | 2.3 % | `hinged-single` | 1 | 0.95 | `D0` 0.00 | small tenancy, inswing |
| `bakery` | 15 | 1.9 % | `hinged-single` | 1 | 1.00 | `D` 1.00 | |
| `second_hand` | 15 | 1.9 % | `hinged-single` | 1 | 1.00 | `D` 1.00 | |
| `food_court` | 12 | 1.5 % | `hinged-quad` | 4 | 3.60 | `D2` 1.50 | it is a building entrance, not a shop door |
| `copyshop` | 12 | 1.5 % | `hinged-single` | 1 | 0.95 | `D0` 0.00 | |
| `supermarket` | 9 | 1.1 % | `sliding-pair` | 2 | 2.40 | `D0` 0.00 | + second door if frontage > 22.9 m |
| `department_store` | 3 | 0.4 % | `sliding-pair` | 2 | 2.40 | `D0` 0.00 | + second door rule |
| `chemist`, `optician`, `telecommunication`, `books`, `sports`, `frame`, `pet`, `florist`, `beauty`, `tattoo`, `cannabis`, `e-cigarette`, `bicycle`, `shoes`, `variety_store`, `alcohol`, `beverages`, `ice_cream` | 69 | 8.7 % | `hinged-single` | 1 | 0.95 | `D0` 0.00 | **the null case.** A small independent tenancy with an inswing single leaf. Deliberately dull, exactly as `E5` is. |
| `yes` | 3 | 0.4 % | `hinged-single` | 1 | 0.95 | `D0` 0.00 | unknown → null case |

**Three door types, not fifteen.** `hinged-single`, `hinged-pair` and
`sliding-pair`, plus `hinged-quad` reused unchanged from the existing families.
`sliding-pair` is the only genuinely new `dt` value, and it earns its place
because it is the one that changes the *plan* — a slider has no recess, and 63 of
263 tenants are sliders. That is a visible difference at street level and it
costs one flag.

**Coverage: every `cat` present in `data/places.geojson` is in this table.** The
rule was checked against the file, not invented from a shop list.

### 5.4 The recess is drawn as VALUE, not as a hole

`bake_entrances.py` header, verbatim: "this renderer has no CSG, so a reveal is
not a hole. A recess is drawn as a dark slab standing 0.02 m proud whose COLOUR
is the shadow, plus jamb returns that give the only real 3D depth." `[M]`

**That is correct here and §9 proves it with a factor of eight.** A 1.20 m recess
depth is 0.68 px at the spawn altitude. The same recess drawn as a 2.40 × 2.60 m
dark panel is 3.7 × 3.6 px. Value beats geometry by ~8× on the same feature.

```
REVEAL_SHOP  = "#4a463f"    [D]  REVEAL_WARM (#9a9082) x 0.50, entered ALREADY LIT.
                                 Warmer than REVEAL_COOL because a shop recess is
                                 lit from inside, not shaded from outside like
                                 PCL's mid-century reveal.
JAMB_SHOP    = "#6e675c"    [D]  REVEAL_SHOP + 30% toward the bulkhead tone. The
                                 two jamb returns are the only real depth cue.
```

### 5.5 The sill, the step and the ramp

**UNO §25-2-753(H)(3): the ground floor may not be more than 5 ft above or below
the adjacent sidewalk** `[S]` — and in practice, on a 12 ft sidewalk built level
with the curb (§25-2-760(B)), a UNO ground-floor retail slab is *at grade*.

```
SF_STEP_RISE   = 0.00      [S]  from (H)(3) + (B). West Campus retail is at grade.
SF_THRESHOLD_H = 0.013     [C]  ADA 2010 §404.2.5 - thresholds 1/2 in maximum.
SF_RAMP        = None      [D]  a 13 mm threshold is not a ramp. ADA requires a
                                ramp above 1/2 in; below it, a bevel.
```

**So: no step, no ramp, and the threshold is 13 mm.** §9 shows 13 mm reaches one
pixel at 4.2 m altitude, which is below `ALT_MIN = 18`. **It is therefore not
drawable in this application at any camera position and must not be emitted.**
This is the cheapest finding in the document: it deletes a primitive.

The one exception worth carrying: `SF_STEP_RISE` is a *parameter*, and the older
pre-2004 Drag buildings (Dirty Martin's, Texas Chili Parlor, the Co-op's older
frontage) predate UNO and do sit above grade. If a future pass wants them, the
override is per-tenant and one line — but there is no evidence in any shipped
file that says which ones, so **inventing per-building step heights would be
fiction.** Left at 0.00 for all, and said out loud.

---

## 6. Glass, by day

```
GLASS_SHOP = "#6e7a84"     [M]  already shipped as GLASS_COL in bake_places.py.
```

No change proposed. It is the base tone the `pl-glass` tile is drawn over and it
already carries a sky mix (`T.SKY [126,148,176]`, `T.SKY_MIX 0.26`) that stops
the band reading as a hole.

**Subchapter E §3.2.2.E's VT ≥ 0.6** `[S]` means shop glazing is *clearer* than
the tinted curtain wall above it. That argues for the shop glass being **less
blue** than the tower glass on the same building — which is already true here
(`#6e7a84`, spread 22) versus e.g. `GLASS_SAT #2f5c94` (spread 101). Consistent;
nothing to do.

---

## 7. Night — the biggest win, and the one number that matters most

### 7.1 What is already there, and what is wrong with it

`js/places.js` `glassTile()` already glows at night: `T.NIGHT = 0.86` toward
`T.NIGHT_TONE = [255, 206, 148]`, with `T.BAY_RATE 0.34` of bays brightened a
further 30 % toward `[255,240,214]`. `[M]`

Two things are wrong with it and both are one-line fixes.

### 7.2 The tone is not pre-compensated for the night light `[D]`

`js/entrances.js` carries the repo's measured night transfer: at `tod 0.92`,
`map.setLight` is `{color:'#9aa6da', intensity:0.066}`, and MapLibre multiplies
every fill-extrusion by it. **Measured end-to-end: input `#ffd9a4` arrived on
screen as `(134,121,118)` — a per-channel transfer of about R 0.53 / G 0.56 /
B 0.72.** `[M]`

Apply it to the shipped `T.NIGHT_TONE`:

```
[255, 206, 148]  ->  (135, 115, 107)   R:B = 1.26
```

Compare `js/entrances.js`'s five magenta-masked measurements of lit entrance
glazing on the same night: **R:B of 1.79, 2.02, 2.31, 2.09, 2.21.** `[M]`

**So the shop interiors currently glow at roughly 60 % of the warmth of the
doorway three metres to their left, on the same building, in the same frame.**
That is a visible disagreement and it is the pale-neutral failure this repo has
now recorded three times (Capitol bands, entrance glass, DKR videoboard).

**Fix, one line:**

```
T.NIGHT_TONE: [255, 206, 148]  ->  [255, 190, 94]      [D]
   after transfer: (135, 106, 68), R:B = 1.99 -- inside the entrances band.
   luma of the input = 190; >= GLASS_LIT_LUMA_MIN 150.   OK
   channel spread   = 161; >> NIGHT_SPREAD_MAX 14.       OK (not the pale band)
```

**This is `[D]`, not `[M]`. I did not render it.** §7.6 names the check.

### 7.3 Open versus closed — and it is *sourced*, not guessed

The brief asked whether modelling opening hours is over-reach and said to give
one honest value if so. **It is not over-reach, because the data is already in
the repo.**

`data/osm_cache/places.json` carries **`opening_hours` on 78 of 156 places —
50 %.** `[M]` Real values, sampled:

```
7-Eleven          24/7
Domino's          Su-Th 10:00-01:00, Fr,Sa 10:00-02:00
Dive              Mo-Fr 15:00-02:00, Sa 16:00-02:00, Su 18:00-24:00
Chick-fil-A       Mo-Sa 06:00-23:45; Su closed
Urban Outfitters  Mo-Sa 10:00-20:00; Su 11:00-19:00
Square Peg Coffee Mo-Sa 07:00-14:00
The UPS Store     Mo-Fr 08:30-19:00; Sa 10:00-15:30; Su off
```

**A full `opening_hours` parser IS over-reach** — the syntax has month ranges,
comma lists, `off`, and `J2 Dining` in this very file carries
`Jun-Jul: Mo-Fr 07:00-14:00, 16:30-20:00; …`. Writing an OSM opening-hours
interpreter for a 3D city is the wrong job.

**What is not over-reach is extracting ONE number: the latest closing hour of the
week.** A regex for `\d{2}:\d{2}-(\d{2}):\d{2}` taking the maximum, with `24/7`
and `00:00-00:00` → 24, gets it from every one of the 78 strings above. That is
twenty lines, it is `[S]` provenance for half the corpus, and it drives the only
thing the renderer needs to know.

```
SF_NIGHT_HOUR = 22.0        [A]  the hour the "night" interior state is evaluated at.
                                 22:00 is after the sun is fully down on the
                                 tod slider and before the 02:00 bar closings.
```

| state | condition | `prov` |
|---|---|---|
| `open` | `close_hour > SF_NIGHT_HOUR` (or `24/7`) | `S` where hours exist |
| `closed` | `close_hour <= SF_NIGHT_HOUR` | `S` where hours exist |
| fallback | category habit table below | `G`, and named in the bake summary exactly as `CAT_TONES` fallbacks are |

Category fallback for the 50 % with no hours — the same "class habit" honesty
`CAT_TONES` already uses `[A]`:

```
OPEN_AT_22 = {
  # open
  "bar": 1, "pub": 1, "convenience": 1, "fast_food": 1, "restaurant": 1,
  "cannabis": 1, "e-cigarette": 1, "ice_cream": 1, "supermarket": 1,
  # closed
  "cafe": 0, "bakery": 0, "clothes": 0, "second_hand": 0, "hairdresser": 0,
  "copyshop": 0, "books": 0, "sports": 0, "frame": 0, "pet": 0, "florist": 0,
  "beauty": 0, "tattoo": 0, "bicycle": 0, "shoes": 0, "optician": 0,
  "chemist": 0, "telecommunication": 0, "alcohol": 0, "beverages": 0,
  "variety_store": 0, "department_store": 0, "food_court": 0, "yes": 0,
}
```

**Sanity check against the sourced half `[M]`:** the fallback agrees with the
real `opening_hours` for Twin Liquors (alcohol, closes 21:00 → closed ✓), Rally
House (clothes, 21:00 → closed ✓), Urban Outfitters (clothes, 20:00 → closed ✓),
Dive (bar, 02:00 → open ✓), 7-Eleven (24/7 → open ✓), Domino's (fast_food, 01:00
→ open ✓), Dooby's (cannabis, 24:00 → open ✓). It **disagrees** on Starbucks
(cafe, closes 19:30 → both say closed ✓) but would be wrong for `Tapioca House`
(cafe, 23:00 → really open, fallback says closed) and for many of the 22.8 % of
`restaurant` tenancies that close at 21:00. **Roughly one tenant in six will be
in the wrong state where hours are missing.** That is the honest error rate and
it is far better than one flat value.

### 7.4 The two night states

```
SF_GLOW_OPEN   = "#ffbe5e"   [D]  after transfer (135, 133,  68)  luma 108  R:B 1.99
                                  A lit sales floor. Warm, near the entrances band.
SF_GLOW_CLOSED = "#553f27"   [D]  after transfer ( 45,  35,  28)  luma  36  R:B 1.61
                                  Security lighting only: real, dim, unmistakably warm.
```

**`SF_GLOW_CLOSED` deliberately violates one assertion in `js/entrances.js` and
this must be argued, not smuggled.** That file asserts a lit pane is entered at
luma ≥ 150 *or* genuinely dark at luma ≤ 30 — "nothing in between" — because the
in-between band is where the Capitol pale-neutral defect lives. `SF_GLOW_CLOSED`
has input luma 66, squarely in the forbidden zone.

**The assertion is a proxy for the real test, and the real test is SPREAD, not
luma.** The pale-band signature is *channels within 14 of each other at luma ≥
40* — a colour nobody chose. `SF_GLOW_CLOSED` has a channel spread of **46**, is
unambiguously warm, and is exactly the thing a shut shop with one back-of-house
light actually looks like.

**Recommendation:** the shopfront pass should assert `spread >= 24` on every
night value, and should NOT import the luma bimodality rule. Write that
difference into the bake's docstring the way `bake_entrances.py` writes down its
`h`-is-a-thickness disagreement with `places.geojson`.

### 7.5 The spill on the sidewalk

`js/entrances.js` already has the mechanism: `ENT.pool`, a `circle` layer on
`js/night.js`'s lamp schedule, sized in **ground metres** converted to px per
zoom, `minZoom 14.8`, `groundM [15,7, 17,9, 19,11]`, `colorMain '#ffc98a'`,
`opacityMain 0.30`, `blur 1.0`. `[M]`

**Reuse it verbatim. Do not build a second pooling system.** Shopfront values:

```
SF_POOL_ON        = true
SF_POOL_MIN_ZOOM  = 15.5     [D]  see §9: below this the pool is a smear on a
                                  band that is itself under 2 px.
SF_POOL_GROUND_M  = [15, 5, 17, 7, 19, 9]      [A] smaller than a door pool
SF_POOL_COLOR     = "#ffc27a"    [D]  ENT.pool.colorMain pulled 8% warmer to sit
                                      under SF_GLOW_OPEN rather than under a door
SF_POOL_OPACITY   = 0.22         [A]  below the door's 0.30: 4.3 m of glass spills
                                      wider and softer than a 2.1 m doorway
SF_POOL_OFFSET_M  = 2.0          [D]  half the 3.66 m minimum sidewalk (§25-2-760),
                                      so the pool centres on the walking surface
```

**Only for tenants in the `open` state.** A closed shop's spill is the whole
point of not drawing one.

### 7.6 The check that closes §7.2 and §7.4

None of the night colours above were rendered. The check that would settle them
is the one `js/entrances.js` already documents and used:

1. `node scripts/verify/harness-drift.mjs` first — mandatory before any pixel
   measurement.
2. `window.cancelGraphicsAutoDetect()` at the top of the test.
3. **Magenta-mask the `places-glass` layer** (HANDOFF §48) so the pixel set is
   provably that layer's and not the wall behind it or `drag.js`'s band in front.
4. `tod 0.92`, one open tenant and one closed tenant in frame, screenshot twice,
   trust the second, minimum of interleaved reps.
5. Assert **R:B between 1.75 and 2.35** on the open tenant — the band the five
   entrance measurements already occupy — and **spread ≥ 24** on both.

If the open tenant lands outside that band, the fix is `T.NIGHT_TONE`, one line.

---

## 8. Sidewalk objects — the answer is *no*, twice over

The brief asked about A-boards, patio seating and bike racks. Two independent
reasons not to add any of them.

**1. `props.geojson` already has them.** `[M]` 4,869 features, and `FORM` in
`scripts/bake_props.py` already defines `outdoor_seating` (1.70 × 0.70 × 0.75 m),
`bicycle_parking` (2.60 × 0.85 × 0.82 m, with `RACK_HOOP_M 0.85` uprights),
`bicycle_rental`, `planter`, `waste_basket`, `scooter` (`SCOOTER_PER_RACK 3` at
`SCOOTER_RACK_FRAC 0.18` of racks) and `vending_machine`. Placement is real: OSM
positions where they exist, and procedural fill from real path centrelines
otherwise (`RACK_PATH_MAX_M 20.0`, `RACK_MAX_PER_BLDG 2`).

**2. A-boards are largely illegal in Austin, and this is the interesting one.**
`[S]` LDC Ch. 25-10 prohibits signs not permanently affixed to a building,
structure or the ground — "excluding a sidewalk sign described in §25-10-153
(Sidewalk Sign In Downtown Sign District)". **West Campus and the Drag are not
the Downtown Sign District.** A sandwich board on the Guadalupe sidewalk is a
code violation, not street texture. Modelling a row of them would be modelling a
city that does not exist.

**Patio seating is legal but permitted, and `outdoor_seating` is already an OSM
tag in the source** — `data/osm_cache/places.json` carries `outdoor_seating` on
16 of 156 places `[M]`. Austin's sidewalk-café rules require a **6 ft (1.83 m)
clear pedestrian zone** `[S]`; with a 12 ft (3.66 m) UNO sidewalk that leaves
1.83 m of café depth against the building.

**The one thing worth doing here, and it is small:** `bake_props.py` places
`outdoor_seating` from OSM *nodes*. Sixteen tenants in `places.json` carry
`outdoor_seating=yes` as a *tag on the place*, and those are not the same set.
**That is a request for `bake_props.py`'s owner, written here per CLAUDE.md lane
rule 1 rather than acted on:** consider seating a tenant with
`outdoor_seating=yes` whose frontage has ≥ 1.83 m of sidewalk beyond the clear
zone. Two tables of 1.70 × 0.70 m at the tenant's frontage midpoint, offset 1.0 m
from the wall. This document does not write `props.geojson`.

**Blade signs.** Not sidewalk furniture, but the one genuinely missing eye-level
object. Sweetgreen's variance (§2.4) was for a wall sign *and a blade sign*, so
they exist on this block. A blade sign is 0.90 × 0.60 m, projecting 0.90 m from
the wall at 3.20 m above grade `[A]`. §9 says it is 3.2 px at the spawn altitude
— visible, and the only thing in this vocabulary that breaks the flatness of the
streetwall in *plan*. **Recommended, gated at the `PORTAL` tier, for the sourced
brands only (`src == "S"`), which is 39 of 263 tenants** — a blade sign on every
storefront would be a stylistic claim, on a chain it is a fact.

---

## 9. THE ALTITUDE QUESTION — what survives, and what needs a gate

**This is the most valuable section in the document and it is where I would spend
the review time.**

### 9.1 The projection, derived from the app's own numbers

`js/controls.js` `[M]`: `ALT_MIN 18`, `ALT_MAX 900`, `ALT_REF 230` (spawn),
`ZOOM_MIN 14.0`, `ZOOM_MAX 21.5`, `PITCH_MIN 5`, `PITCH_MAX 88`, default fov 58°.
`js/entrances.js` `[M]`: the reference viewport is **1440 × 900**.

Focal length in CSS px: `f = 0.5 x 900 / tan(29°) = 811.8`.
Slant range to the screen centre at MapLibre pitch `P` (0 = straight down):
`d = alt / cos P`.

At the spawn pose, **pitch 64°**:

```
px per metre of WALL HEIGHT      = f.sin(P)/d = 319.9 / alt
px per metre of WALL WIDTH       = f/d        = 355.9 / alt
px per metre of DEPTH into wall  = f.cos(P)/d = 156.0 / alt
```

Cross-check against the repo's own verified figure: `js/controls.js` records
"230.4 m at zoom 16.5 / pitch 64 / 800 px canvas". The same closed form at
900 px gives 259.1 m, which is 900/800 of 230.4. **The arithmetic reproduces the
repo's verified value.** `[D]`

Zoom for a given altitude at pitch 64: `z = log2(24,020,000 / alt)`.

| alt (m) | z | | alt (m) | z |
|---|---|---|---|---|
| 900 | 14.70 | | 100 | 17.87 |
| 400 | 15.87 | | 60 | 18.61 |
| 260 | 16.50 | | 30 | 19.61 |
| 230 (spawn) | 16.67 | | 18 (`ALT_MIN`) | 20.35 |
| 150 | 17.29 | | | |

### 9.2 The table that answers the question

"1 px" = the altitude at or below which the feature is at least one CSS pixel on
its dominant axis. "3 px" = the altitude at which it is legible rather than
merely present. Pitch 64 throughout.

| feature | size m | axis | 1 px at | 3 px at | verdict |
|---|---|---|---|---|---|
| glass band | 4.30 | height | **1375 m** | 458 m | **survives everywhere** — above `ALT_MAX` |
| door leaf height | 2.13 | height | 682 m | 227 m | survives to the top of the envelope |
| recess shadow panel | 2.40 × 2.60 | width | 854 m | 285 m | **survives** — this is the win |
| sign fascia | 1.05 | height | 336 m | 112 m | colour only, as `bake_places.py` already concluded |
| door leaf width | 0.914 | width | 325 m | 109 m | present at spawn, legible below 110 m |
| blade sign | 0.90 | width | 320 m | 107 m | present at spawn |
| mullion spacing | 1.35 | width | 480 m | 60 m (8 px) | rhythm only |
| transom band | 0.60 | height | 192 m | 64 m | needs a gate |
| recess DEPTH | 1.20 | depth | **187 m** | 62 m | **geometry loses to value 8:1** |
| bulkhead | 0.55 | height | 176 m | 59 m | already drawn; effectively a gate at ~175 m |
| door bottom rail | 0.25 | height | 80 m | 27 m | low tier only |
| sill / water table | 0.15 | height | 48 m | 16 m | low tier only |
| **mullion FACE** | **0.051** | width | **18.2 m** | 6.1 m | **never — see below** |
| threshold | 0.013 | height | 4.2 m | 1.4 m | **never — do not emit** |

### 9.3 The three findings

**(a) A 2-inch mullion is never one pixel in this application.** `[D]` It reaches
1 px at 18.2 m altitude, and `ALT_MIN` is 18 m. The camera *cannot* get to where
a real mullion is a pixel wide. **Therefore mullions must remain a pattern
forever** — the existing `pl-glass` tile is the right answer and there is no
altitude at which promoting them to geometry pays. That also settles the atlas
question: the pattern already exists, so this costs **zero new tiles**.

**(b) Depth is worth 44 % of height, and value beats geometry ~8:1.** `[D]`
`156.0/319.9 = 0.49` per metre — and the recess's *shadow panel* is 2.4 × 2.6 m
against the recess *depth* of 1.2 m, so the panel out-reads the geometry by
`(2.40 x 355.9) / (1.20 x 156.0) = 4.6x` in width alone and ~8× in visible area.
**`bake_entrances.py` reached the same conclusion by argument; this is the
arithmetic that backs it.** Every recess, reveal and jamb in this vocabulary is a
coloured slab, never a modelled void.

**(c) `bake_places.py`'s awning rationale is inverted, and the awning survives
anyway.** `[D]` That file's header says: "At 70 degrees a vertical sign band is
foreshortened to about a third of its true height while a horizontal surface is
seen at nearly full size." **MapLibre measures pitch from straight down** — 0 is
a top-down map — so at pitch 70 the camera is only 20° above horizontal, and the
foreshortening runs the other way: a vertical face keeps `sin 70 = 0.94` of its
size and a horizontal face keeps `cos 70 = 0.34`.

The conclusion still holds, for a different reason and in a different part of the
envelope. Projected area at pitch 64: fascia `12.6 m² x 0.899 = 11.3`, awning top
`15.6 m² x 0.438 = 6.8`. The fascia wins at the flying pose. But the app allows
`PITCH_MIN 5`, and at pitch 20 the awning top gets `cos 20 = 0.94` and the fascia
`sin 20 = 0.34` — the awning wins outright on any near-top-down pass, which is
exactly what the intro flyover does from 900 m.

**So: keep the awning, keep `AWN_COOL`/`AWN_BLUE`, and fix the sentence.**
`[D]`, not `[M]` — it is a derivation from MapLibre's documented pitch
convention, not a pixel measurement. **The check that would close it is trivial
and should be run before the comment is edited:** render one awning at pitch 20
and at pitch 75 from the same altitude, magenta-mask the `places-solid` layer,
and count the awning's pixels in each. If the pitch-20 count is larger, this is
right.

### 9.4 The proposed gates

Two tiers, matching `js/entrances.js`'s existing `PORTAL` / `DETAIL` split
exactly, so the four graphics presets and the ~30 fps auto-detect already move
them with no edit to `js/graphics.js`.

| tier | minzoom | ≈ alt at pitch 64 | contains | why that number |
|---|---|---|---|---|
| **BASE** | 15.0 (unchanged, `PLACES.minZoom`) | 730 m | glass band, bulkhead, fascia colour, awning, **night interior glow**, night ground pool (15.5) | the glass band is ≥ 1 px to 1375 m; the night glow is a *colour on geometry that already renders*, so it costs nothing and survives to the top of the envelope. **The night glow is the one item in this whole document that needs no gate at all.** |
| **PORTAL** | **16.7** | **225 m** | recess shadow panel, jamb returns, door leaves, door head line, blade sign | the door leaf is 3 px tall at 227 m. Gating at the spawn altitude means **the door appears the moment you are looking at the Drag**, which is the point. |
| **DETAIL** | **18.6** | **60 m** | transom line, mullion-rhythm correction, door rails/stiles, sill, bulkhead reveal line | the mullion rhythm needs 8 px of spacing to read rather than moiré: `1.35 x 355.9 / 8 = 60 m`. The transom is 3 px at 64 m. Both land on the same number. |
| — | — | — | **threshold, ramp, step** | **never drawn.** §5.5. |

Names, so they are one-line overrides:

```
SF_PORTAL_MIN_ZOOM = 16.7     [D]
SF_DETAIL_MIN_ZOOM = 18.6     [D]
SF_POOL_MIN_ZOOM   = 15.5     [D]
```

### 9.5 Caveats on §9 that a reviewer should hold against it

- **Pitch is a free variable.** Every number is quoted at pitch 64. At pitch 88
  (horizon) a vertical metre is worth 11 % more and a depth metre 92 % less; at
  pitch 20 the reverse. The *ordering* of the table is stable; the absolute
  altitudes move by up to ±15 % across the pitch range the camera actually uses
  (55–75).
- **Device pixel ratio is not in this.** All figures are CSS px at 1440 × 900.
  A 2× display renders twice the device pixels, which does not change what a
  person perceives but does change what a headless pixel test measures. **Any
  verification script must state its `deviceScaleFactor`** — this is the same
  class of trap as `perf.mjs`'s silent 4× CPU throttle.
- **Screen-centre only.** MapLibre's zoom is defined at the map centre; at high
  pitch the foreground is nearer and larger than the table says and the horizon
  much smaller. A shopfront in the bottom third of the frame reads better than
  these numbers; one near the horizon reads worse.
- **Nothing in §9 was measured on screen.** It is a derivation that reproduces
  the one figure `js/controls.js` verified. The magenta-mask check in §7.6
  measures the night colours; a second, separate check should measure one
  feature's pixel width against one row of this table before the gates ship.

---

## 10. Atlas budget

**Zero new `fill-extrusion-pattern` tiles.** `[D]`

- The mullion grid is already `pl-glass`, one 64 px tile, registered by
  `js/places.js`. §3.1 changes `T.MULL` from 5 to 3 — a value in an existing
  tile, not a new tile.
- The night interior glow is already painted into that same tile. §7.2 changes
  `T.NIGHT_TONE`, one array.
- The recess, jambs, door leaves, transom and blade sign are **geometry with a
  flat colour**, following `bake_entrances.py`'s proud-slab contract. No pattern.
- The ground pool is a `circle` layer, which uses no atlas at all.

Running total after this pass: `js/drag.js` 11–15 `dg-` tiles, `js/places.js`
**1** `pl-glass` tile, `js/entrances.js` 0. **Unchanged.**

Feature-count cost, per tenant `[D]`: recess panel 1 + jambs 2 + leaves 1–2 +
head 1 + transom 1 = **6–7 pieces**, plus 1 blade sign on 39 tenants. Over 263
tenants that is **≈ 1,700 new features** — about 16 % of what
`data/entrances.geojson` already carries, and split across two LOD tiers so at
the performance preset only the `PORTAL` half draws.

---

## 11. The proud-slab contract, restated because it is the reason any of this is safe

Copied from `scripts/bake_places.py` and `scripts/bake_entrances.py`, and it
binds this vocabulary too:

**Every piece stands proud of the host wall. `replacedBuildingIds` stays empty,
permanently.** Eight passes already claim building ids (arts, drag, heroes,
moody, capitol, westcampus, tower, the stadium block in `app.js`). A pass that
only ever *adds* geometry in front of a wall can never collide with any of them,
in either order, whether or not they have already rebuilt the wall behind it.

Projection depths, so nothing z-fights:

```
PROUD        = 0.30    [M]  bake_places.py — the shopfront slab, already shipped
SF_JAMB_PROUD  = 0.28  [D]  0.02 inside the slab face, so the jamb reads as a return
SF_RECESS_PROUD = 0.26 [D]  0.02 behind the jamb; the darkest plane
SF_LEAF_PROUD  = 0.24  [D]  the door leaf inside the recess
SF_GLASS_PROUD = 0.26  [D]  the leaf's light stands 0.02 PROUD of the leaf --
                            bake_entrances.py's GLASS_PROUD rule, verbatim:
                            "a light recessed inside a solid leaf is a light
                            nobody can see"
SF_BLADE_PROUD = 0.90  [A]  the blade sign, the one thing that projects
```

Note the ordering is *inverted* from intuition: the recess is drawn **less**
proud than the slab, not behind the wall. It cannot go behind the wall — the host
building's extrusion is there. The 0.02 m steps are the same trick
`bake_entrances.py` uses and they are below every altitude in §9.2, which is
fine: **they exist to control draw order, not to be seen.**

---

## 12. What this document does NOT do

- **No photograph was sampled.** Stated at the top and repeated here. Every
  colour is `[D]` off an in-repo measured value.
- **No pixel was measured.** §7.6 and §9.5 name the two checks that would close
  the two claims most likely to be wrong (the night tone, and the awning pitch
  argument).
- **No opening-hours parser is specified beyond one regex.** Deliberate; §7.3.
- **Per-building step heights on the pre-2004 Drag buildings are not invented.**
  §5.5.
- **`props.geojson` is not touched.** The one thing worth doing there is written
  as a request in §8, per CLAUDE.md lane rule 1.
- **No new primitive is proposed.** Family `R` is nine existing parts with
  different numbers, which is the constraint `docs/entrances/eras.md` sets.

---

## Sources

- [University Neighborhood Overlay Program — City of Austin](https://www.austintexas.gov/planning/university-neighborhood-overlay-program)
- [LDC Division 9, University Neighborhood Overlay District Requirements (§25-2-751 ff.)](https://services.austintexas.gov/edims/document.cfm?id=165054)
- [City Code Chapter 25-2, Subchapter E — Design Standards and Mixed Use](https://services.austintexas.gov/edims/document.cfm?id=190630)
- [Subchapter E on Municode](https://library.municode.com/tx/austin/codes/land_development_code?nodeId=TIT25LADE_CH25-2ZO_SUBCHAPTER_EDESTMIUS_ART3BUDEST_S3.3OPIMBUDE)
- [LDC §25-10-133, University Neighborhood Overlay Zoning District Signs](http://austin-tx.elaws.us/code/ldc_title25_ch25-10_art6_sec25-10-133)
- [Board of Adjustment case C16-2020-0007, 2234 Guadalupe St (Sweetgreen sign variance)](https://services.austintexas.gov/edims/document.cfm?id=350075)
- [LDC Chapter 25-10, Sign Regulations — Municode](https://library.municode.com/TX/Austin/codes/land_development_code?nodeId=TIT25LADE_CH25-10SIRE_ART7SPSI_S25-10-153SISI)
- [Austin Building Code (IBC 2021) Chapter 32 — Encroachments Into the Public Right-of-Way](https://up.codes/viewer/austin/ibc-2021/chapter/32/encroachments-into-the-public-right-of-way)
- [Kawneer Trifab VersaGlaze 451 Framing System — guide specifications](https://www.kawneer.ca/kawneer_files/products/1833%20-%20Trifab%20VersaGlaze%20451-451T%20Framing%20System/Specifications/SPCC040EN_Trifab&reg;%20VersaGlaze&reg;%20451%20Framing%20System%20-%20English/SPCC040EN.pdf)
- [2010 ADA Standards §404 — Doors, Doorways and Gates](https://www.corada.com/documents/2010ADAStandards/404)
- [NYC Landmarks Preservation Commission — Storefronts (permit guidebook ch. 3)](https://www.nyc.gov/assets/lpc/downloads/pdf/LPCPermitGuidebook_Chapter3_Storefronts.pdf)
- [Anatomy of a Main Street Building — WA Dept. of Archaeology & Historic Preservation](https://dahp.wa.gov/sites/default/files/Anatomy_of_MainStreet.pdf)
- [Austin Sidewalk Cafe Handbook](https://www.austintexas.gov/sites/default/files/files/Transportation/SidewalkCafe_Handbook_05_12_17.pdf)
- [Austin Great Streets Master Plan — Site Standards Overview](https://www.austintexas.gov/sites/default/files/files/Planning/Urban_Design/20191016_Great%20Streets%20Master%20Plan%20Site%20Standards%20Overview.pdf)
