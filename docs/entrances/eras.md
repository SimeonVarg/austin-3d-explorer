# Entrance era vocabulary — UT Austin

The written spec a generator builds from. **No code, no geometry, no pixels have
been produced against this yet.** Everything here is either a number with a
source, a number derived from a number with a source, or a number labelled
`ASSUMPTION` with the reasoning that produced it shown next to it. Nothing is
laundered.

Read `docs/entrances/eras.md` (this file) together with the header of
`scripts/bake_places.py`, which is the structural template, and
`docs/VISUAL_REFERENCE_PLAYBOOK.md` in the sibling `utx-diorama` repo, whose
rules bind here: derive the rule and confirm it reproduces every cited example
before drawing; sample colours, never guess them; uniform primitives are the
null hypothesis.

---

## 0. Confidence tags used throughout

| Tag | Means |
|---|---|
| `[S]` | **Sourced.** A published statement or an in-repo measured value. Cited. |
| `[C]` | **Code.** A building-code or industry-standard dimension. Cited. |
| `[D]` | **Derived.** Arithmetic on an `[S]` or `[C]` value; the arithmetic is shown. |
| `[A]` | **Assumption.** Not measured, not sourced. The reasoning is shown so it can be argued with, and every one of these is a one-line override. |

The honest headline: **the geometry of the door leaf, the stair and the handrail
is `[C]` and solid. The geometry of the surrounds, reveals and canopies is
mostly `[A]`.** No measured drawing or dimensioned survey of any of these
entrances was found on the open web — SAH Archipedia returns 403 to a fetch,
Wikipedia carries no dimensions, and the Cass Gilbert Society and UT School of
Architecture pages are prose. The `[A]` values below are geometric reasoning
from things that *are* known (a door has to be a door's size; a semicircular
arch's rise is half its span; a storey is ~3.46 m on this campus per
`scripts/bake_tower.py`'s `FLOOR`), not vibes — but they are assumptions and
they are marked as such.

---

## 1. Correction to the four-family hypothesis

The brief proposed four families. **Four is right for the *celebrated* buildings
and badly wrong for the corpus**, and this is the single most important finding
in this document.

Counting named buildings whose centroid falls inside the campus bbox
`30.2760,-97.7480 → 30.2960,-97.7220`, from
`data/snapshots/2026-07-10/buildings.detailed.geojson`:

```
359 named buildings in the bbox
129  building_class = (none)     ← mostly Drag retail + West Campus
107  university
 42  apartments
 14  parking
 14  church
 14  dormitory
  7  commercial
  6  office
  4  library
  3  public   3 detached   3 roof
  2  college  2 school  2 stadium  2 hospital
  1  post_office  1 house  1 residential  1 mosque  1 retail
```

Roughly **125 of 359 are UT academic buildings.** The rest are apartment blocks,
parking garages, churches, fraternity houses, state office buildings and
fast-food restaurants. A four-family scheme with no null case gives Chipotle a
Paul Cret limestone portal. So:

**There are four monumental families (A–D) plus a fifth context family (E) and a
NULL treatment. Families are opt-in by evidence; NULL is the default.** A dull,
correct door on an unknown building is honest. A Cret portal on an unknown
building is a lie you can see from 400 m.

Two further corrections to the hypothesis:

- **Gregory Gym is in family B but its opening is *arched*, not square.** "A
  large, stone staircase leading up to a set of grand arches define the front
  exterior" `[S]` — UT RecSports / Acme Brick. It is also brick, not limestone:
  "cast-stone base and a blend of five different brick colors ... the UT Blend"
  `[S]`. This is why **family sets GEOMETRY and the host building sets
  MATERIAL** (§3.4) — otherwise Gregory forces a fifth family for one building.
- **Family A has exactly two members on this campus** (Battle Hall, Sutton
  Hall). Garrison, Waggener, Painter et al. are Herbert M. Greene and Paul Cret,
  not Cass Gilbert, and their portals are square-headed. Two buildings is still
  worth a family — they are the two most architecturally significant entrances
  at UT — but a generator should not expect to apply it widely.
- **Arno Nowotny Building (1856) and John W. Hargis Hall are 1850s Greek
  Revival** (the old Texas Asylum for the Blind, Abner Cook). They are in
  neither hypothesis nor this spec. **Give them NULL, not family B.** Writing a
  fifth monumental vocabulary for two buildings that sit 700 m south of the
  Forty Acres is not worth it in this pass.

---

## 2. Structural contract — how an entrance pass composes

Copied from `scripts/bake_places.py`, which solved this problem already.

1. **Every piece of entrance geometry stands PROUD of, or RECESSED into, the
   host wall — and claims NO building ids.** `replacedBuildingIds` is empty, on
   purpose and permanently.
2. This matters because six passes already claim ids: `js/arts.js`,
   `js/drag.js`, `js/heroes.js`, `js/moody.js`, `js/capitol.js` (via
   `window.FACADE_PROTECTED`) and the stadium block in `js/app.js`.
   `js/tower.js` additionally filters two OSM `building:part`s out by wall
   colour. An entrance pass that claims nothing can never collide with any of
   them, in either order, whether or not they loaded.
3. **The recess is a problem, not a free win.** A reveal is geometrically a
   *hole* in the host wall and this renderer has no CSG. So a "reveal" is drawn
   as a dark slab standing `0.02 m` proud of the wall (so it z-fights nothing)
   whose *colour* is the shadow, plus the door bank standing further proud on
   top of it. **Depth is read from value, not from geometry**, exactly as
   `bake_arts.py` does for the Blanton's arcade: "at this altitude the arches
   themselves are undrawable, so the band is modelled as what it actually looks
   like from 400 m — a recessed line of shadow under the wall."
   The *jamb returns* (§3.3) are the only real 3D depth, and they are cheap.
4. **Self-register like `js/places.js`** — `map.addSource` / `map.addLayer` from
   the module itself, no edit to `js/app.js`.
5. **Output schema:** `wd` / `wg` / `wn` (day / golden / night), `base` and `h`
   in metres, same as `data/places.geojson`. Use the `wall_ramp()` function
   copied verbatim from `bake_drag.py` / `bake_heroes.py` / `bake_arts.py` —
   three files already share it; do not invent a fourth dusk.
6. **One output file, `data/entrances.geojson`, and nothing else writes it**
   (CLAUDE.md lane rule 1).

### 2.1 What actually reads from the camera

The camera flies at 200–900 m at 60–75° pitch. At 70° a **vertical** surface is
foreshortened to about a third of its true height; a **horizontal** surface is
seen at nearly full size (`bake_places.py`'s awning note). Consequences that
must drive every decision below:

- **A canopy's TOP face is the loudest surface an entrance has.** Families C and
  D get canopies partly because they really have them and partly because that is
  the surface the camera can see.
- **Steps read as light/dark BANDING, not as height** (`HANDOFF.md` §42b:
  "courses 140 mm apart rendered as one flat blob"). Reuse `bake_depth.py`'s
  step vocabulary — `STEP_NOSING 0.35`, `STEP_NOSING_FRAC 0.35`,
  `STEP_LIFT 0.03` and its `flight()` generator — do not invent a second stair
  look.
- **A 38 mm handrail tube is sub-pixel at 400 m** (one pixel ≈ 0.5 m). Draw it
  anyway *at a drawable minimum width* — see §3.9 — or drop it under a LOD
  threshold. Do not draw a true-scale 38 mm cylinder and call it done; it will
  be invisible and you will have spent the polygons.
- **A door leaf is ~1 m wide, i.e. two pixels.** What makes an entrance read is
  the **dark bank** (all leaves + mullions as one dark mass), its **width**
  relative to the wall, its **surround**, and its **canopy**. Model leaves
  individually anyway, because at ground level in the tour poses they matter —
  but tune the *bank* to be right first.

---

## 3. The universal alphabet

**Uniform primitives are the null hypothesis.** Every entrance in every family
is composed from these nine parts and nothing else. The families differ only in
which parts are present and in the values of the parameters — never in the
parts themselves. This is what makes each correction a one-line edit rather
than surgery across draw calls (playbook rule 5).

Local frame: **u** across the wall (metres from the entrance centre),
**v** out from the wall face (positive = away from the building),
**z** metres above the entrance's own grade.

| # | Part | Params | Notes |
|---|---|---|---|
| 1 | `LEAF` | `leaf_w`, `leaf_h`, `leaf_mat` | one door leaf |
| 2 | `STILE` | `stile_w` | the vertical between two leaves, and the meeting stile of a pair |
| 3 | `TRANSOM` | `transom_h`, arched or square | glazed panel over the head |
| 4 | `SIDELIGHT` | `side_w` | glazed bay flanking the bank |
| 5 | `SURROUND` | `sur_w`, `sur_proj`, `arched?` | the frame standing proud of the wall |
| 6 | `REVEAL` | `reveal_d`, `reveal_mat` | shadow slab + jamb returns (§2.3) |
| 7 | `FLIGHT` | `risers`, `riser_h`, `tread_d`, `flight_w` | uses `bake_depth.flight()` |
| 8 | `RAIL` | `rail_h`, `rail_d`, `rail_mat` | or `CHEEK` on the monumental families |
| 9 | `CANOPY` | `can_proj`, `can_t`, `can_z`, `can_mat` | horizontal slab, may be glazed |

### 3.1 Leaf sizes — the `[C]` core

| Leaf | Width | Height | Source |
|---|---|---|---|
| Commercial standard | **0.914 m** (36″) | **2.134 m** (84″) | `[C]` STANLEY Access Technologies: "The workhorse commercial door is a 36-inch-wide leaf, often 84 inches tall" |
| IBC egress minimum height | — | 2.032 m (80″) | `[C]` IBC 1010.1.1 |
| ADA/IBC min **clear** width | 0.813 m (32″) | — | `[C]` IBC 1010.1.1 |
| Monumental (families A, B) | **1.000 m** | **2.440 m** (8′-0″) | `[A]` — no measured drawing found. Reasoning: a monumental portal leaf is universally taller than the 84″ commercial leaf, and 8′-0″ is the next standard height above it. Argue with this number, not with a fabricated survey. |
| Modern lobby (family D) | **1.067 m** (3′-6″) | **2.440 m** | `[A]` — same reasoning; wide-stile lobby doors are commonly 3′-6″. |

### 3.2 Stiles and frames

| Part | Value | Source |
|---|---|---|
| Aluminium **medium** stile | 0.089 m (3½″) | `[A]` industry-common; Kawneer's published spec found only states "2 inch overall thickness with minimum .188 inch thick extruded aluminum tubular rail and stile members" `[S]` |
| Aluminium **wide** stile | 0.127 m (5″) | `[A]` same |
| Storefront framing profile | **0.114 m deep × 0.044 m face** (1¾″ × 4½″) | `[S]` Kawneer Trifab 450 / APS spec: "1-3/4″ x 4-1/2″ center glazed storefront" |
| Bronze/wood monumental stile | 0.150 m | `[A]` |
| Meeting stile of a pair | 0.100 m | `[A]` |

### 3.3 Reveal — the family discriminator

**This is the number that tells the four families apart from the air, and it is
the number to get right first.** Ordered:

```
A  Gilbert arcade      reveal_d = 1.20 m   (walk-through loggia bays: 3.60 m)
B  Cret portal         reveal_d = 0.65 m
C  Mid-century         reveal_d = 1.50 m   ← deepest, and it is a punched recess
D  Modern              reveal_d = 0.35 m   ← nearly flush
```

All four `[A]`. Reasoning for each is in its family section. Note the ordering
is **not** monotonic in date: mid-century punched recesses are the deepest
setbacks on campus (they are sun-shading, not ceremony) while Gilbert's are the
most *articulated*. A generator that assumes "older = deeper" will get C wrong.

Drawn as: a shadow slab at `v = +0.02`, `wd = reveal_mat`, spanning the full
opening; plus two **jamb returns** — thin slabs perpendicular to the wall, at
`u = ±(opening_w/2)`, running `v` from `0` to `reveal_d`, thickness 0.15 m.
The jamb returns are the only true 3D depth and they are what makes the reveal
survive an oblique view.

### 3.4 **Family sets geometry; host sets material.**

The portal *surround* is limestone on every UT building in families A and B —
including the brick ones. Gregory Gym is "cast-stone base" under "a blend of
five different brick colors" `[S]`; Sutton Hall is "limestone to the first floor
with brick and terra cotta above" `[S]` (UT SOA). So:

```
wall_mat    = host feature's own baked `wd` from buildings.detailed.geojson
surround_mat= LIMESTONE, unless an override says otherwise
```

This keeps the entrance pass from fighting `js/facades.js`: it never restates
the wall colour, it only adds a surround that is *supposed* to differ from it.

### 3.5 Colours

Every hex below is either already in this repo (and therefore already sampled
and already checked against a render) or is derived from one by the repo's own
measured transfer function. **No hex here is new and unmeasured.**

**The renderer transfer, which everything is entered against** — measured in
`bake_arts.py` and re-confirmed in `bake_heroes.py`: a fill-extrusion **wall
face lands at roughly `R×0.78 / G×0.69 / B×0.58` of its input**, and a wall face
lands at about `0.67` of its input luma. Two consequences that have each cost a
round already:
- **A shadow must be entered ALREADY LIT.** `bake_arts.py`: entering the
  photographed `#181a1d` for the LBJ undercroft measured `#2f2517` on screen —
  "a black slot that read as a hole punched under the building". Entered
  `#78736b` instead.
- **Glass must be entered BLUER than photographed**, or an input R/B of 0.73
  lands at 0.99 — dead neutral grey.

| Role | Hex | Provenance |
|---|---|---|
| Campus limestone, Main Building | `#e5dbc2` | `[S]` `bake_tower.py PART_WD` — the snapshot's own value for the Main Building's OSM building:parts |
| Battle Hall cream | `#e6dcc3` | `[S]` cited in `bake_heroes.py` as the value to avoid landing modern limestone on |
| Texas Union ashlar | `#e6ded0` | `[S]` `bake_drag.py MATERIALS["ashlar"]`, from a sampled `#f0e6de` in sun split with the baked `#e4dabf` |
| Gregory cast stone | `#b3ab9c` | `[S]` `bake_drag.py MATERIALS["cstone"]`, sampled `#afa899` in sun |
| Gregory / UT-blend brick | `#b98a62` | `[S]` `bake_drag.py MATERIALS["brick"]`, sampled `#c28e64` on a sunlit photo, less 5% |
| Terracotta roof tile / ornament | `#ad5833` | `[S]` `bake_roofs.py` — "owns 9,543 px at rgb(173,88,51)" |
| Cordova Cream limestone (the named material) | use `#e5dbc2` | `[S]` for the *identification* — Continental Cut Stone / Mezger: "Most University of Texas buildings incorporate locally quarried limestone... Cordova Cream Limestone", "a light cream colored limestone with subtle swirling veins". No hex published; the repo's sampled campus limestone stands in. |
| **Reveal shadow, warm stone** | `#9a9082` | `[D]` limestone `#e5dbc2` × 0.66, floored the same way `bake_arts.py lbj_under` is — a shadow entered already lit |
| **Reveal shadow, cool/modern** | `#74756d` | `[S]` `bake_heroes.py eer_soffit`, from a sampled `#666864` sd 17.3 |
| **Bronze door leaf** | `#6b5540` | `[D]` a dark bronze `#4a3a2a` lifted through the ×0.67 luma transfer so it does not land as a hole. `[A]` on the base colour — bronze on these doors is described, not sampled. |
| **Dark stained wood leaf** | `#5f4a35` | `[A]`, same treatment |
| Aluminium storefront leaf/frame | `#9aa0a4` | `[D]` from `bake_heroes.py nhb_steel #8e969c`, 6% up (a bright mill finish rather than a perforated louvre) |
| Stainless / modern steel | `#8e969c` | `[S]` `bake_heroes.py nhb_steel`, patch `#73838d` |
| Near-black structural steel | `#4b4f53` | `[S]` `bake_heroes.py eer_steel`, patch `#6b7275` sd 80, pulled down 12% for sky bleed |
| **Entrance glass, default** | `#4f86b4` | `[S]` `bake_heroes.py gdc_glass` — already entered bluer for this exact renderer |
| Entrance glass, cool canyon | `#4d81ad` | `[S]` `bake_heroes.py eer_glass` |
| Entrance glass, saturated | `#2f5c94` | `[S]` `bake_heroes.py nhb_glass`, patch median `#24497e` over 310×220 px |
| Entrance glass, warm-lobby | `#6b93b6` | `[S]` `bake_arts.py bass_glass` |
| Canopy soffit, dark | `#6b6f72` | `[D]` `eer_soffit` cooled 5% — a soffit is a horizontal shadow and takes the same lift rule |
| Blanton arcade shadow (arched reveal reference) | `#4d4535` | `[S]` `bake_arts.py blanton_arc`, sampled `#514a35` sd 124 |

**Per-building glass override rule:** where the repo has already sampled a
building's glass, the entrance uses *that* value, not the default — EER
`#4d81ad`, GDC `#4f86b4`, NHB `#2f5c94`, Bass `#6b93b6`. An entrance in a
different blue from the curtain wall three metres above it is a visible defect.

### 3.6 Stairs — the `[C]` core

| Value | Number | Source |
|---|---|---|
| IBC max riser | 0.178 m (7″) | `[C]` IBC 1011.5.2 |
| IBC min riser | 0.102 m (4″) | `[C]` IBC 1011.5.2 |
| IBC min tread | 0.279 m (11″) | `[C]` IBC 1011.5.2 |
| Repo's existing flight | riser **0.17**, tread **0.42** | `[S]` `bake_depth.py FLIGHT_RISER / FLIGHT_TREAD`, with its own note: *"A real monumental stair is ~0.15."* |
| **Monumental flight, families A + B** | riser **0.15**, tread **0.42** | `[D]` the repo's own note, and inside IBC's 4″–7″ band |
| **Utility flight, families C + D + E** | riser **0.17**, tread **0.30** | `[D]` IBC-legal, and visibly steeper than the monumental one, which is the point |
| Step nosing band | 0.35 m, capped at 0.35 × tread | `[S]` `bake_depth.py STEP_NOSING / STEP_NOSING_FRAC` |
| Step lift | 0.03 m | `[S]` `bake_depth.py STEP_LIFT` |

**Riser count is derived, never authored:**
`risers = max(1, round(entrance_z / riser_h))`, then `riser_h = entrance_z /
risers` so the flight lands exactly on the threshold. `entrance_z` is the door
threshold's height above grade — see §5.3, which is the weakest link in the
whole pipeline and is called out there.

### 3.7 Handrails and cheek walls

| Value | Number | Source |
|---|---|---|
| Handrail top above nosing | **0.90 m** | `[C]` IBC 1014.3 requires 0.865–0.965 m (34″–38″); 0.90 is the midpoint |
| Handrail tube diameter, true | 0.038 m (1½″) | `[A]` industry-common |
| Handrail tube diameter, **drawn** | **0.10 m** | `[D]` §2.1 — a true 38 mm tube is sub-pixel at cruise altitude. Drawn at 0.10 m as a deliberate, parameterised over-scale, exactly as `bake_places.py` over-scales a sign band. Flag it in the file so nobody "fixes" it back to 0.038. |
| Rail present when | risers ≥ 2 | `[A]` — IBC requires rails at 4+ risers; 2 is chosen so the rail reads |
| **Cheek wall** (families A, B instead of a rail) | width 0.40 m, top 0.60 m above the nosing, following the flight slope | `[A]` — historic monumental limestone flights on this campus have solid cheeks, not tube rails. **If a photograph shows a retrofitted metal rail on a specific flight, that is a per-building override, not a family change.** |

### 3.8 Canopies

| Family | Present | Projection | Thickness | Top at | Material |
|---|---|---|---|---|---|
| A | **no** — the arch is the canopy | — | — | — | — |
| B | **no** | — | — | — | — |
| C | **yes** | 2.40 m `[A]` | 0.25 m `[A]` | 3.60 m `[A]` | concrete, host `wd` darkened 12%; soffit `#6b6f72` |
| D | **yes**, and it is the identifying feature | 3.20 m `[A]` | 0.18 m `[A]` | 4.20 m `[A]` | steel `#8e969c`, soffit `#74756d`; optionally glazed top face `#4f86b4` at 55% |
| E2 | yes, small | 1.80 m `[A]` | 0.22 m `[A]` | 3.20 m `[A]` | host `wd` darkened 12% |

Canopy width = bank width + 0.60 m each side (C, E2) or + 1.20 m each side (D).
All `[A]`.

### 3.9 Leaf-count rule — **derived, not authored**

Do not hard-code "Battle Hall has two doors". Derive:

```
bank_w   = clear width of the opening
pair_w   = 2*leaf_w + meeting_stile          # one pair
pairs    = clamp(floor((bank_w + stile_w) / (pair_w + stile_w)), 1, max_pairs)
leaves   = 2 * pairs
leftover = bank_w - (pairs*pair_w + (pairs-1)*stile_w)
```

`leftover` becomes **sidelights**, split evenly either side, if ≥ 0.6 m; below
that it is absorbed into the jambs. `max_pairs` is 3 for family B (ceremonial
fronts), 2 for A, C and D, 1 for E.

This is the playbook's rule-not-patch discipline: if one building comes out with
the wrong number of doors, the *opening width* is wrong, not the count.

---

## 4. The families

Storey height reference used throughout: **3.46 m floor-to-floor** `[S]`
(`bake_tower.py FLOOR`, derived from the gold spandrels in a rectified elevation
photograph of the UT Tower).

---

### FAMILY A — Cass Gilbert Spanish Renaissance arcade, 1910–1922

**Members: 2.** Battle Hall (1911) `[S]`, Sutton Hall (1915–18) `[S]`.

**Sourced character.** "Spanish Renaissance style, with limestone facades and a
shallow pitched hip roof of red tile" `[S]` (Cass Gilbert Society). "Simple but
elegant detailing in limestone and terra-cotta concentrated at door and window
surrounds" `[S]`. Sutton: "the most striking feature is the double vaulted
arcade with its colorful ceiling mosaics... custom-designed iron lanterns grace
the main entry"; "limestone to the first floor with brick and terra cotta
above" `[S]` (UT School of Architecture). Battle Hall: "a spacious, seven-arched
loggia" `[S]` — **but note the caveat in §7.1, this attribution is contested
between Battle Hall and the Main Building across the sources found and must be
verified against a photograph before seven arches are drawn anywhere.**

| Parameter | Value | Tag |
|---|---|---|
| Opening | **round arch**, semicircular | `[S]` |
| Arch clear width | **2.60 m** | `[A]` — must clear a pair (2×1.00 + 0.10 = 2.10) plus 0.25 jamb each side |
| Arch springing height | **2.90 m** | `[A]` — leaf 2.44 + entablature over the doors 0.25 + 0.21 clearance |
| Arch rise | **1.30 m** | `[D]` = ½ × clear width, semicircular |
| Head of arch | **4.20 m** | `[D]` = 2.90 + 1.30 |
| Leaves | **2** (one pair), `max_pairs = 2` | `[D]` §3.9 at 2.60 m |
| Leaf | 1.00 × 2.44 m, wood or bronze with a glazed upper panel | `[A]` |
| Transom | **yes, arched fanlight**, fills the arch head, 1.30 m rise, glazed and mullioned radially | `[A]` |
| Surround | **arched.** Archivolt band **0.45 m** wide, projecting **0.12 m**; impost band 0.20 m tall at the springing, projecting 0.16 m | `[A]` |
| **Reveal depth** | **1.20 m** for a doorway arch; **3.60 m** for a walk-through loggia bay | `[A]` — 3.60 ≈ one structural bay, i.e. an arcade you can stand in, which is what "double vaulted arcade" means |
| Steps | rise 1.00 m → **7 risers** at 0.143 m, tread 0.42, run 2.94 m, width = 2.60 + 1.20 each side = **5.00 m** | `[D]` from §3.6; the 1.00 m rise is `[A]` |
| Rails | **none.** Cheek walls 0.40 × 0.60 m | `[A]` §3.7 |
| Canopy | **none** | `[S]` — the arch is the canopy |
| Wall material | limestone `#e6dcc3` (Battle); Sutton **limestone at ground floor** `#e5dbc2`, brick above (host `wd` handles above) | `[S]` |
| Surround material | limestone `#e5dbc2` | `[S]` §3.4 |
| Reveal | `#9a9082` | `[D]` |
| Leaf | `#5f4a35` wood, glazed panel `#4f86b4` at 40% of the leaf | `[A]`/`[S]` |
| Terracotta accent at the arch keystone/spandrels | `#ad5833`, 0.30 m band | `[S]` colour; `[A]` placement |

**Sutton Hall exception `[S]`:** "An extensive renovation completed in 1982
adapted Sutton Hall for use by the School of Architecture and **created the
present main entrance on the north façade**." So Sutton's principal entrance is
**north** and is 1982 work in a 1918 building. Draw the north entrance in
family A (it was done to match) but expect it to differ; flag for a photo check.

---

### FAMILY B — Cret / Greene monumental portal, 1926–1942

**The largest celebrated family.** Members and dates in §6.

**Sourced character.** Main Building: Beaux-Arts, Paul Philippe Cret, completed
1937, Indiana limestone facades `[S]`; "Simple Doric columns" enclosing front
extensions, "pilasters with Ionic capitals" on the south facade, "a row of
dentils" `[S]` (UT History Corner); the cornerstone sits "next to the south
entrance in the building's loggia" `[S]`. Gregory Gym: "a large, stone staircase
leading up to a set of grand arches" `[S]`.

| Parameter | Value | Tag |
|---|---|---|
| Opening | **square-headed**, except Gregory Gym → arched (per-building override) | `[S]` |
| Portal clear width | **7.20 m** ceremonial front; **3.20 m** secondary | `[A]` — 7.20 = 3 pairs (3×2.10) + 2 stiles (0.30) + jambs (0.60) |
| Portal clear height | **4.10 m** | `[A]` — leaf 2.44 + transom 0.90 + head member 0.20 + sill/threshold 0.56 |
| Leaves | **6** (3 pairs) ceremonial, **2** secondary; `max_pairs = 3` | `[D]` §3.9 |
| Leaf | 1.00 × 2.44 m, **bronze frame with a large glazed light** | `[A]` type; the "bronze light fixtures" and "walnut doors and screens" of the Main Building interior are `[S]` and support bronze-and-glass at the exterior, but the exterior leaves themselves were not found described |
| Transom | **yes, square, 0.90 m**, glazed, divided on the same mullion rhythm as the leaves below | `[A]` |
| Surround | **square.** Architrave band **0.55 m** wide on jambs and head, projecting **0.15 m**; over it an inscription/frieze panel **1.10 m** tall projecting 0.08 m; over that a cornice shelf **0.30 m** thick projecting **0.45 m** | `[A]`; the inscription band is `[S]` in principle — "Ye shall know the Truth and the Truth shall make you free" is on the Main Building facade |
| **Reveal depth** | **0.65 m** | `[A]` — Cret's portals are articulated in *relief*, not in depth. The A↔B contrast (1.20 vs 0.65) is the clearest read between the two limestone families and is the number to check first in any render. |
| Steps | rise **1.35 m** `[A]` → **9 risers** at 0.15, tread 0.42, run **3.78 m**; width = portal + 2.50 m each side, **min 8.0 m, max 18.0 m** | `[D]` |
| Rails | **none.** Cheek walls 0.45 × 0.60 m | `[A]` |
| Canopy | **none** | `[A]` |
| Wall material | host `wd` (limestone on most; **brick `#b98a62` on Gregory Gym** `[S]`) | `[S]` |
| Surround material | **always limestone/cast stone** — `#e5dbc2` on the limestone buildings, `#b3ab9c` cast stone on Gregory | `[S]` §3.4 |
| Reveal | `#9a9082` | `[D]` |
| Leaf | bronze `#6b5540`; glazed light `#4f86b4` at 60% of the leaf | `[D]`/`[S]` |

**Main Building interaction `[S]`, and it is a hard constraint.**
`scripts/bake_tower.py` already owns this geometry and already models the
entrance context: `H_ARCADE = 6.8` (rusticated arcade storey) and
`H_PAVILION = 8.4` ("the two low south terraces flanking the entrance"). The
entrance pass must **add the portal only**, between those terraces, at grade,
and must not restate the arcade. In the snapshot this footprint is named
**`UT Tower`**, not "Main Building" — a name-keyed generator that looks for
"Main Building" will silently draw nothing.

---

### FAMILY C — Mid-century punched storefront, 1950–1989

**Sourced character.** Jester Center, 1969, Brooks, Barr, Graeber & White:
"brutalist-lite", "tiny windows edged in concrete dot the tired brick walls"
`[S]`. PCL, 1977: "brutalist... walls were built from textured Indiana
limestone, and its large windows purposely inlaid to be well-shaded from the hot
Texas sun" `[S]` — **the inlay is the point**: the deep reveal on this family is
sun-shading, which is why it is the deepest of the four (§3.3).

| Parameter | Value | Tag |
|---|---|---|
| Opening | **square punched recess**, no surround | `[S]` |
| Recess clear width | **6.00 m** main, **3.00 m** secondary | `[A]` — 2 pairs + 2 sidelights |
| Storefront head height | **3.05 m** (10′-0″) | `[A]` industry-common storefront head |
| Leaves | **4** (2 pairs) main, **2** secondary; `max_pairs = 2` | `[D]` |
| Leaf | **0.914 × 2.134 m**, aluminium medium stile, full glazed light | `[C]` §3.1 |
| Stile / frame | 0.089 m stile; frame 0.114 deep × 0.044 face | `[A]`/`[S]` §3.2 |
| Transom | **yes, glazed, 0.87 m** | `[D]` = 3.05 − 2.134 − 0.044 |
| Sidelights | **yes**, 1.20 m each side | `[A]` |
| Surround | **none.** Jamb reveal 0.10 m | `[A]` |
| **Reveal depth** | **1.50 m** — deepest of the four | `[A]`, reasoned from PCL's "purposely inlaid to be well-shaded" `[S]` |
| Steps | **0–3 risers.** Ground floor is at grade on most of this family. riser 0.17, tread 0.30 | `[D]` |
| Rails | **yes** where risers ≥ 2. Tube, top 0.90 m above nosing, drawn at 0.10 m ⌀, `#8e969c` | `[C]`/`[D]` §3.7 |
| Canopy | **yes.** proj 2.40, t 0.25, top 3.60 | `[A]` §3.8 |
| Wall | host `wd` | — |
| Reveal | `#74756d` (cool) — this family's recesses are concrete, not warm stone | `[S]` |
| Leaf/frame | `#9aa0a4` | `[D]` |
| Glass | `#4f86b4` | `[S]` |

**PCL exception, and it is `[S]`:** "The entrance to the library is on the
**second floor**, accessible from a **plaza** at the southwest corner of
Speedway and 21st Streets." So PCL gets **no flight at the door** — the rise is
taken by the plaza, which is ground-pass geometry (`bake_ground.py` /
`bake_depth.py`), not entrance geometry. Any generator that puts a 4 m flight on
PCL's ground-floor wall has drawn a door that does not exist. `entrance_z` for
PCL ≈ **one storey, 3.46 m** `[D]`.

---

### FAMILY D — Modern glazed bay, 1990–2026

Members with in-repo sampled colour: GDC (Pelli Clarke Pelli, 2010) `[S]`, EER
(2017) `[S]`, NHB (CO Architects, 2008) `[S]`, Blanton Michener Gallery
(Kallmann McKinnell & Wood, 2006) `[S]`, Bass lobby (Boora, 2008) `[S]`, HRC
facade (Lake|Flato, 2003) `[S]` — all cited in `bake_heroes.py` / `bake_arts.py`.

| Parameter | Value | Tag |
|---|---|---|
| Opening | **full-height glazed bay** | `[S]` character |
| Bay clear width | **7.00 m** | `[A]` |
| Bay height | `min(host_height, 6.00 m)` | `[A]` — a glazed entrance bay is 1½–2 storeys |
| Leaves | **4** (2 pairs); on the largest lobbies (Rowling, SAC, Dell Med) a **revolving door** — model as a 3.60 m ⌀ glazed drum, 2.60 m tall — plus 1 flanking pair | `[A]` |
| Leaf | 1.067 × 2.440 m, wide stile 0.127, full glazed | `[A]` §3.1 |
| Transom | **none as such** — the curtain wall continues above; model the glass from door head to bay head as one glazed plane | `[A]` |
| Sidelights | absorbed into the curtain wall | — |
| Surround | **none**, or a projecting frame **0.30 m** wide standing **0.25 m** proud, in steel or limestone | `[A]` |
| **Reveal depth** | **0.35 m** — nearly flush, the opposite end of the range from A | `[A]` |
| Steps | **0–2 risers.** Modern accessible design puts the threshold at grade | `[A]` |
| Rails | only where steps exist; stainless `#8e969c` | `[C]` |
| Canopy | **yes, and it is the identifying feature.** proj **3.20**, t **0.18** (thinner than C's 0.25 — this difference *is* the family read), top **4.20** | `[A]` |
| Glass | **the host's own sampled value** — EER `#4d81ad`, GDC `#4f86b4`, NHB `#2f5c94`, Bass `#6b93b6`, else `#4f86b4` | `[S]` |
| Steel | `#8e969c`, structural members `#4b4f53` | `[S]` |
| Canopy soffit | `#74756d` | `[S]` |

---

### FAMILY E — context, and the NULL treatment

These exist so that 234 of 359 named buildings do not get a monumental portal.

| Sub | Applies to | Treatment |
|---|---|---|
| **E1** | Drag retail, Guadalupe 21st–24th, and any POI already in `data/places.geojson` | **DRAW NOTHING.** `scripts/bake_places.py` and `js/drag.js` already own these frontages, with `SHOP_DATUM 4.3`, `SIGN_H 1.05`, `BULKHEAD 0.55`, `PROUD 0.30`. A second entrance on top is a double-draw. **The generator must load `data/places.geojson` and exclude every host id it uses.** |
| **E2** | `apartments`, `residential`, `house`, `detached`, `dormitory` outside the Forty Acres | 1 pair, 0.914 × 2.134, reveal 0.25, no surround, canopy 1.80 / 0.22 / top 3.20, 0–1 riser, glass `#4f86b4` |
| **E3** | `parking` (14 buildings) | **No pedestrian portal at family scale.** One vehicle opening **6.00 m wide × 4.30 m tall** `[A]` on the street elevation, dark `#3f4145`; plus one 0.914 m stair-tower door. |
| **E4** | `church`, `mosque` (15 buildings) | Arched, leaf 0.95 × 2.60, 1 pair, arch clear 2.40, rise 1.20, reveal 0.60, 4 risers at 0.15, no canopy, leaf `#5f4a35` |
| **E5 — NULL** | **everything else, and every unknown** | 1 pair, 0.914 × 2.134, reveal **0.15**, no surround, no transom, no canopy, 1 riser. Deliberately dull. |

---

## 5. The decision procedure

### 5.1 Test 0 — the data that does not exist yet

`data/osm_cache/` contains **no entrance nodes and no building tag file**.
Nothing in the cache carries `start_date`, `architect`, `ref` or
`building:levels`; `buildings.detailed.geojson` has been reduced to
`{id, name, num_floors, building_class, final_height, source_height, wd, wg, wn,
rd, rg, rn}` and the raw tags are gone.

So **step one of any entrance bake is a new Overpass fetch cached to
`data/osm_cache/campus_buildings.json` and `data/osm_cache/entrances.json`**,
over `30.2760,-97.7480,30.2960,-97.7220`, keeping at minimum: `name`, `ref`,
`start_date`, `architect`, `building:levels`, `height`, `building`, `amenity`,
`operator`. The scout's counts for that bbox: 93 entrance nodes (57
`entrance=yes`, 19 `main`, 8 `staircase`, 6 `emergency`, 2 `exit`, 1 `parking`),
11 `door=hinged`, 374 named buildings, 165 with `ref`, 138 with
`building:levels`, 104 with `height`, only 2 indoor features.

**Verify before depending on it:** the scout reported no `start_date` count at
all. **Count `start_date` coverage first.** If it is under ~40% — which is the
expectation for a US university campus — the tag test below is a bonus, not the
mechanism, and the named list in §6 is doing all the work.

### 5.2 The cascade

Run in order; first match wins.

```
0.  host id ∈ places.geojson hosts        → E1, draw nothing
1.  architect ~ /Cass Gilbert/i           → A
2.  architect ~ /Cret|Greene|Kuehne/i     → B
3.  name ∈ NAMED LIST (§6)                → its listed family + overrides
4.  building_class = parking              → E3
5.  building_class ∈ {church, mosque}     → E4
6.  start_date present:
        year ≤ 1925                       → A
        1926 ≤ year ≤ 1949                → B
        1950 ≤ year ≤ 1989                → C
        year ≥ 1990                       → D
7.  building_class ∈ {apartments, residential, house, detached, dormitory}
                                          → E2
8.  everything else                       → E5 NULL
```

**Note the deliberate ordering.** The named list (3) beats the date test (6),
because a date is a proxy and a name is evidence. And rule 8 is NULL, not "C" —
the temptation is to default unknown campus buildings to mid-century because
mid-century is numerically dominant, and that is exactly how a wrong entrance
gets onto 80 buildings at once. **Families are opt-in.**

### 5.3 Where the entrance goes — the weakest link, stated as such

Three sub-problems, in descending confidence:

- **Position, when OSM has an entrance node.** 93 nodes cover maybe 40 of 374
  buildings. Snap the node to the nearest footprint edge; that edge's outward
  normal is the entrance's facing. Confident.
- **Position, when it does not.** Use `data/osm_cache/footways.json` — 3,430
  walkable ways *with geometry* (3,098 footway, 189 steps, 55 pedestrian, 70
  cycleway, 18 path). **The footway that dead-ends nearest a footprint edge is
  the entrance.** A path that stops at a wall stops there because there is a
  door. This is the single best signal available and it should be built and
  measured before anything else in the pass. `[A]` as a rule — untested.
- **`entrance_z`, the threshold height above grade. This is not solved.** The
  app has **no terrain** — `HANDOFF.md` §41: "everything builds UP: buildings
  start at z=0 with no terrain". So there is no ground surface to measure a
  threshold against, and the flight height in §3.6 is currently an authored
  per-family constant (A: 1.00 m, B: 1.35 m, C: 0–0.51 m, D: 0–0.34 m), which is
  a guess dressed as a parameter. **Say so in the bake.** Two honest ways
  forward, neither taken here: (a) read the 189 `steps` ways in
  `footways.json` — a `steps` way ending at a building is a measured flight, and
  `step_count` is sometimes tagged; (b) accept the constant and let it be a
  one-line taste override, which is what CLAUDE.md rule 11 asks for anyway.

---

## 6. The fallback named list

Exact `name` strings from `data/snapshots/2026-07-10/buildings.detailed.geojson`
— **match on these, not on the buildings' colloquial names.** Centroid
lon/lat given so a generator can verify it matched the right footprint. Dates
are best-effort and tagged.

### Family A

| snapshot `name` | lon, lat | date | tag | notes |
|---|---|---|---|---|
| `Battle Hall` | −97.74036, 30.28543 | 1911 | `[S]` | 3 fl, 21.5 m. Arch count contested — see §7.1 |
| `Sutton Hall` | −97.74089, 30.28498 | 1918 | `[S]` | 3 fl, 13.0 m. **Main entrance is NORTH, 1982** `[S]` |

### Family B

| snapshot `name` | lon, lat | date | tag |
|---|---|---|---|
| `UT Tower` *(this footprint IS the Main Building)* | −97.73932, 30.28601 | 1937 | `[S]` |
| `Garrison Hall` | −97.73844, 30.28513 | 1926 | `[S]` |
| `Gregory Gym` **← arched override, brick** | −97.73635, 30.28408 | 1930 | `[S]` |
| `Waggener Hall` | −97.73760, 30.28514 | 1931 | `[S]` |
| `Goldsmith Hall` | −97.74123, 30.28540 | 1932 | `[S]` |
| `Mary E. Gearing Hall` | −97.73924, 30.28772 | 1932 | `[S]` |
| `Will C. Hogg Building` | −97.73841, 30.28605 | 1932 | `[S]` |
| `T. S. Painter Hall` | −97.73867, 30.28699 | 1933 | `[S]` |
| `Union Building` *(the Texas Union)* | −97.74113, 30.28648 | 1933 | `[S]` in-repo `bake_drag.py`: "The Texas Union, 1933, Paul Cret" |
| `Hogg Memorial Auditorium` | −97.74061, 30.28688 | c.1933 | `[A]` same campaign; not separately sourced |
| `Homer Rainey Hall` | −97.74026, 30.28411 | c.1942 | `[A]` |
| `Dorothy Gebauer Building` | −97.73864, 30.28634 | pre-1910 | `[A]` — probably predates the family; verify before drawing |
| `E. P. Schoch Building` | −97.73661, 30.28579 | c.1930s | `[A]` |
| `Anna Hiss Gymnasium` | −97.73775, 30.28855 | c.1931 | `[A]` |
| `Texas Memorial Museum` | −97.73232, 30.28697 | 1936 | `[A]` |
| `Art Building and Museum` | −97.73308, 30.28622 | c.1960s | `[A]` — **likely family C; verify** |
| `Mezes Hall` | −97.73884, 30.28437 | c.1952 | `[A]` "B-late" |
| `Benedict Hall` | −97.73898, 30.28397 | c.1952 | `[A]` "B-late" |
| `Batts Hall` | −97.73889, 30.28476 | c.1952 | `[A]` "B-late" |
| `Parlin Hall` | −97.74008, 30.28488 | c.1959 | `[A]` "B-late" |
| `Calhoun Hall` | −97.74025, 30.28451 | c.1965 | `[A]` "B-late" — **likely C; verify** |

**"B-late" is a flag, not a family.** Mezes / Benedict / Parlin / Batts /
Calhoun continue the Cret limestone idiom postwar. If a photograph shows an
aluminium storefront in that limestone portal — which is what a 1952 building
usually has — the correct answer is **family B surround with family C leaves**,
which the alphabet in §3 supports directly by mixing parameters. That
combination is a legitimate fifth reading and worth one labelled test render
(playbook rule 6) before it is tiled across five buildings.

### Family C

`Beauford H. Jester Center` (−97.73696, 30.28302, 1969 `[S]`),
`Jester East Hall` (−97.73591, 30.28232, 1969 `[S]`),
`Jester West Hall` (−97.73682, 30.28214, 1969 `[S]`),
`Perry-Castañeda Library` (−97.73819, 30.28282, 1977 `[S]`, **plaza exception**),
`Robert A. Welch Hall` (−97.73772, 30.28629),
`Burdine Hall` (−97.73851, 30.28891),
`Sid Richardson Hall` (−97.72895, 30.28492),
`L. Theo Bellmont Hall` (−97.73354, 30.28376),
`Peter T. Flawn Academic Center` (−97.74053, 30.28636),
`Jesse H. Jones Hall` (−97.73163, 30.28867),
`Ernest Cockrell, Jr. Hall` (−97.73557, 30.28900),
`Harry Ransom Center` (−97.74108, 30.28442, 1972; facade Lake|Flato 2003 `[S]` —
**family C mass, family D entrance**),
plus every `university` / `library` / `dormitory` building inside the Forty Acres
that is not on another list **only if** its `start_date` lands 1950–1989.
Dates without `[S]` above are `[A]` from massing and are the least reliable
column in this document.

**Note `Perry-Castañeda Library` carries a `ñ`.** Match on the exact UTF-8
string or normalise; an ASCII comparison silently misses UT's most-visited
building.

### Family D

`Bill and Melinda Gates Computer Science Complex` (−97.73657, 30.28629, Pelli
Clarke Pelli 2010 `[S]`, glass `#4f86b4`),
`Engineering Education and Research Center` (−97.73540, 30.28841, 2017 `[S]`,
glass `#4d81ad`),
`Norman Hackerman Building` (−97.73783, 30.28763, CO Architects 2008 `[S]`,
glass `#2f5c94`),
`Blanton Museum of Art` (−97.73759, 30.28104, 2006 `[S]` — **arcaded limestone
base**, so family D dates with a family A/B arcade at the ground floor; use
`blanton_arc #4d4535` for the reveal),
`Robert B. Rowling Hall` (−97.74144, 30.28221, 2018 `[A]`, revolving door),
`William C. Powers, Jr. Student Activity Center` (−97.73632, 30.28489,
revolving door),
`Belo Center for New Media` (−97.74072, 30.29016),
`Health Discovery Building`, `Health Transformation Building` (Dell Med),
`Moody Center`, `Gary L. Thomas Energy Engineering Building`,
`Larry R. Faulkner Nano Science and Technology Building`,
`Louise and James Robert Moffett Molecular Biology Building`,
`Neural Molecular Science Building`, `Student Services Building`,
`AT&T Executive Education and Conference Center`,
`Bernard and Audre Rapoport Building`.
Dates without `[S]` are `[A]`.

### Explicitly NULL — do not give these a family

`Arno Nowotny Building` (−97.73101, 30.27823, 1856 Greek Revival),
`John W. Hargis Hall` (−97.73200, 30.27840, 1850s),
`Littlefield House` (−97.74076, 30.28812, 1893 Victorian),
`Littlefield Carriage House`,
every `Chilling Station`, `Cooling Tower`, `Hal C. Weaver Power Plant*`,
`Facilities Complex Building 7`, `University Sign Shop`,
`Caven Clark Field Support Building`, and everything with
`building_class = roof`.

---

## 7. What is not established, and must be before drawing

1. **Battle Hall's "seven-arched loggia" is contested in the sources found.**
   One search result attributes it to Cass Gilbert's 1911 Library (Battle Hall);
   a fetch of `jimnicar.com/tag/paul-cret/` attributes the same phrase to the
   Main Building's front. The tag page aggregates several articles, so the fetch
   may have crossed them — but **it may also be that Battle Hall's loggia is on
   the west elevation and is not the entrance at all.** Do not draw seven arches
   anywhere until a photograph settles which building, which elevation, and
   whether it is the entrance. This is exactly the playbook's "read the source
   correctly before reading the pattern".
2. **No measured drawing was found for any entrance on this campus.** SAH
   Archipedia (`sah-archipedia.org/buildings/TX-01-AU41.2` and `.3`) returns
   HTTP 403 to a fetch and is the most likely source of real descriptions;
   Wikipedia, the Cass Gilbert Society and UT SOA all carry prose only. The
   Alexander Architectural Archives at UT hold the original Gilbert and Cret
   drawings and are the correct next stop — the UT SOA page says so explicitly.
   **Every surround, reveal, arch-width and projection number in §4 is `[A]`.**
3. **Door counts per entrance are derived (§3.9), not observed.** No source
   consulted states how many leaves any UT entrance has. The derivation is
   defensible and it is a rule rather than a patch, but it has not been checked
   against a single photograph.
4. **Cordova Cream has no published hex.** The material identification is `[S]`
   (Continental Cut Stone, Mezger Stone: "light cream colored limestone with
   subtle swirling veins and a fine to medium grain"). The repo's own sampled
   `#e5dbc2` / `#e6dcc3` stand in and are the right call — they are measured
   against *this renderer* — but they are campus-limestone-in-general, not
   Cordova Cream specifically.
5. **`entrance_z` is unsolved** (§5.3). This is the biggest open item.
6. **The footway dead-end rule for entrance placement is untested** (§5.3). It
   should be built and measured *first*, as coding step one, together with a
   render→pixel-sample→assert harness (playbook rule 2), before any vocabulary
   is drawn. A placement rule that is 60% right makes every beautiful portal
   land on a blank wall.

---

## 8. Sources consulted

- [Cass Gilbert Society — University of Texas Library (Battle Hall)](https://www.cassgilbertsociety.org/works/utexas-austin-library/)
- [Cass Gilbert Society — UT Education Building (Sutton Hall)](https://cassgilbertsociety.org/works/utexas-austin-education-bldg/)
- [UT School of Architecture — Sutton Hall at 100](https://soa.utexas.edu/news/sutton-hall-100)
- [UT School of Architecture — A Witness to History: Battle Hall](https://soa.utexas.edu/news/witness-history-battle-hall-and-past-present-and-future-school-architecture)
- [Wikipedia — Battle Hall](https://en.wikipedia.org/wiki/Battle_Hall)
- [Wikipedia — Main Building (University of Texas at Austin)](https://en.wikipedia.org/wiki/Main_Building_(University_of_Texas_at_Austin))
- [The UT History Corner — Paul Cret](https://jimnicar.com/tag/paul-cret/)
- [Preservation Austin — History and Preservation at UT Austin](https://www.preservationaustin.org/news/history-and-preservation-at-the-university-of-texas-at-austin)
- [UT RecSports — Gregory Gym History](https://www.utrecsports.org/facilities/gregory-gym-history)
- [Acme Brick — The Iconic UT Gregory Gym Was Built with Acme Brick](https://brick.com/stories/did-you-know-the-iconic-university-of-texas-gregory-gym-was-built-with-acme-brick/)
- [Wikipedia — Perry–Castañeda Library](https://en.wikipedia.org/wiki/Perry%E2%80%93Casta%C3%B1eda_Library)
- [Wikipedia — Jester Center](https://en.wikipedia.org/wiki/Jester_Center)
- [The Daily Texan — Creating Campus: Was Jester designed by a prison architect?](https://thedailytexan.com/2018/01/24/creating-campus-was-jester-designed-by-a-prison-architect/)
- [Continental Cut Stone — Lueders, Cordova Cream and Cordova Shell Limestone](https://continentalcutstone.com/smooth-cut-stone-gallery/)
- [Mezger Stone — Cordova Cream](https://www.mezgerstone.com/cordova-cream)
- [Lapeyre Stair — IBC Stair Code Compliance](https://www.lapeyrestair.com/resources/ibc-code-compliance/)
- [Koffler Sales — Handrail Height Guide & Code Requirements (IRC, IBC, OSHA, ADA)](https://kofflersales.com/blog/handrail-height-guide-code-requirements/)
- [STANLEY Access Technologies — Standard Commercial Door Heights, Widths, Specs](https://www.stanleyaccess.com/insights/standard-commercial-door-heights-widths-specs-and-requirements)
- [CDF Distributors — IBC Door Requirements for Commercial Buildings](https://www.cdfdistributors.com/blog/post/ibc-door-requirements-commercial-buildings)
- [Albuquerque Public Schools — Aluminum Storefront Specification (Kawneer Trifab 450)](https://www.aps.edu/facilities-design-and-construction/documents/design-standards-and-guidelines/APS_Aluminum_Storefront_Specification_1-20-14_Version.doc)
- [Kawneer — Storefront Framing Product Selection Guide](https://www.kawneer.com/kawneer_files/shared%20files/97911-Arch_Manual/Storefront_Framing_Product_Selection_Guide.pdf)
- **Blocked:** SAH Archipedia `TX-01-AU41.2` (Main Building and Tower) and
  `TX-01-AU41.3` (Battle Hall) — HTTP 403. Most likely source of real
  descriptions; retry from a browser session or a different client.

In-repo sources (measured against this renderer, and therefore preferred over
any web colour): `scripts/bake_tower.py`, `scripts/bake_drag.py`,
`scripts/bake_heroes.py`, `scripts/bake_arts.py`, `scripts/bake_roofs.py`,
`scripts/bake_depth.py`, `scripts/bake_places.py`,
`data/snapshots/2026-07-10/buildings.detailed.geojson`.
