# West Campus apartment lobby entrances — the measured vocabulary

The written spec a generator builds from for the **24 named West Campus
buildings** in `data/westcampus.geojson`. **No code, no geometry and no pixels
have been produced against this file.** It is a spec, and it is deliberately
honest about which of its numbers are measured and which are not.

Read it together with:

- `docs/entrances/eras.md` — the parent spec. Everything here is an **extension**
  of that alphabet, not a second door system. Same nine parts, same schema, same
  proud-of-the-wall contract.
- `scripts/bake_westcampus.py` — the source of every `base` band height quoted
  below. The lobby is *inside* a band that already exists and was already
  measured; this pass does not get to invent its height.
- `scripts/bake_places.py`'s header — the proud-slab rule that lets six passes
  land on the same building without colliding.
- `docs/PASS_WESTCAMPUS.md` line 197, which is the hole this fills:
  *"No ground-floor signage or awnings. The Drag pass owns that vocabulary."*

Confidence tags are the ones `eras.md` defines: `[S]` sourced, `[C]` code,
`[D]` derived (arithmetic shown), `[A]` assumption (reasoning shown),
`[M]` measured in-repo.

**The honest headline.** Street frontage, front-door elevation and ground-floor
retail are **`[S]` for 22 of 24 buildings** — every address was looked up, and
every one was cross-checked against the repo's own road centrelines and against
OSM footway dead-ends before it was written down. **The lettering, the canopies
and the mullion grids are almost entirely `[A]`.** Three wordmarks are `[S]`
(Moontower, The Standard, 2400 Nueces) because a previous pass read them off a
named photograph. The other twenty-one are **not verified and are not invented**
— §7 says so per building and §8 gives the rule for what to draw instead.

---

## 0. Three address errors already in the repo — fix these first

The single biggest risk in this pass was drawing on the wrong building. Three
addresses written in `scripts/bake_westcampus.py`'s comments do not agree with
the footprint the name is attached to. In every case the **footprint** is right
and the **comment** is wrong, which is the good outcome — the geometry is where
the door goes.

| Building | Comment in `bake_westcampus.py` | What the footprint and the web agree on |
|---|---|---|
| `The Block` | *"The Block, 2504 Nueces"* | Footprint is at **Leon Street**, lon −97.7499…−97.7492. `2504 Nueces` is 700 m east. This is **The Block on Leon, 2510 Leon St** `[S]` |
| `The G` | *"The G, 2400 San Gabriel"* | Footprint is at **Guadalupe & W 18th**, 30.2800…30.2805. `2400 San Gabriel` is 900 m north. This is **1715 Guadalupe St** `[S]` |
| `Pointe on Rio` | *"Pointe on Rio, 2101 Rio Grande"* | Footprint is in the **1900 block**, between MLK and 21st. `2101 Rio Grande` is **21 Rio's** address. This is **1901 Rio Grande St** `[S]` |
| `The Nine at Rio` | *"The Nine at Rio, 2222 Rio Grande"* | Footprint is in the **2100 block**, between 21st and 22nd. This is **2100 Rio Grande St** `[S]` |

None of these changes the geometry; all four change *which photograph you would
go and look at* to verify a lobby. Fix the comments in the same PR as the bake.

---

## 1. A student high-rise lobby is not family D, and this is the whole point

`eras.md` §4 family **D** ("modern glazed bay, 1990–2026") is the closest
existing family and it is wrong here in four specific, checkable ways. If you
apply D to West Campus you get a campus research building's front door on a
student tower, and it will read as one.

| | Family D (GDC, EER, NHB) | West Campus lobby |
|---|---|---|
| **Canopy** | 3.20 m projection, **0.18 m** thick steel blade | ~2.60 m projection, **0.30 m** thick — it is a signboard with a soffit, not a blade |
| **The name** | none — the building is named on a plaque | **the name is the loudest element**, lit, on or over the canopy |
| **Leasing window** | none | a glazed leasing/management office **beside the door**, part of the same storefront run |
| **Garage** | in a separate structure | **a roll gate in the same elevation or the side street**, and on the older ones it is nine storeys of open deck directly above the lobby |
| **Bay height** | `min(host, 6.00)` authored | **derived from the building's own measured `base` band** — see §3.1. Only 7 of 24 are genuinely two storeys |

So: **a fifth family, `W`, era `"highrise"`.** It reuses every part in
`eras.md` §3 and adds nothing to the alphabet except two named pieces (§4.6,
§4.7) and one variant (§5). Families stay opt-in; nothing outside the 24-name
list in §6 gets `W`.

---

## 2. What already exists — the do-not-double-draw contract

This is the section to read before writing a line of the bake.

### 2.1 The band the lobby lives in already exists and is already measured

`scripts/bake_westcampus.py` emits a `base` band for all 24 buildings — the
ground floor, its own feature, its own height, its own colour, its own facade
family. **It has no door.** The lobby is drawn *proud of that band's wall face*,
inside its height, and never restates it. The band heights are in §6 and they
are `[M]`: they came from measured storey counts and nadir imagery, not from
this document.

### 2.2 Two of the 24 already have baked entrances, and one of them is on the wrong elevation

`data/entrances.geojson` already carries doors on exactly two of these
buildings, both from the `E2` (`era="utility"`) fallback:

| Building | eid | role | at | verdict |
|---|---|---|---|---|
| Cambridge Tower | 421 | main | 30.28075, −97.74052 | **Correct elevation** (west, Lavaca) — matches 1801 Lavaca St `[S]`. Upgrade in place to `W`+`porte`. |
| Cambridge Tower | 422 | secondary | 30.28087, −97.74048 | keep |
| The G | 563 | **main** | 30.28048, −97.74189 | **Wrong.** That is the W 18th (north) elevation. |
| The G | 562 | secondary | 30.28032, −97.74198 | **This is the main one.** Guadalupe (west), and it is the only door in the whole set with *measured* stair evidence — four OSM `steps` / `footway` endpoints land on this wall at 30.28024 / 30.28031 / 30.28033 / 30.28035, lon −97.74198…−97.74202 `[M]`. |

**Swap The G's main and secondary.** A 1715 Guadalupe address plus four tagged
`steps` ways ending at the west wall beats a derived guess.

The other 22 have **no** entrance geometry at all. Nothing to collide with.

### 2.3 Four of the 24 already carry shopfronts from `data/places.geojson`

Counted by centroid-in-footprint, so these are real:

| Building | Features already on it | Consequence |
|---|---|---|
| **Dobie Twenty21** | Target ×18, Oma's Kitchen ×9, Dobie Tower Food Court ×9, Gong Cha ×5, Starbucks ×5 — **46 features** | The Guadalupe (west) elevation is **fully claimed**. Draw the residential lobby on **Whitis (east)** and nothing on Guadalupe. |
| **21 Rio** | Rio Mart ×9 | Rio Mart sits on the Rio Grande frontage. Put the lobby at the **south end** of that elevation; leave the rest. |
| **Pointe on Rio** | Conscious Cravings ×5 | Same treatment, north end free. |
| **The Venue on Guadalupe** | Dirty Martin's ×5, Torchy's Tacos ×9 | **Unverified and suspicious** — Dirty Martin's is 2808 Guadalupe and is probably the *neighbour*, caught by the bbox test. **Check the actual host wall segment before drawing.** |

Rule, copied from `eras.md` §4 E1 and non-negotiable: **the generator loads
`data/places.geojson`, computes the wall segments its `front` slabs occupy, and
refuses to place a lobby bank that overlaps one.** Not "avoids the building" —
avoids the *segment*. All four of these buildings need both a lobby and their
existing shops.

### 2.4 The atlas budget: this pass spends ZERO new tiles

`js/drag.js` already spends eleven to fifteen `fill-extrusion-pattern` tiles and
the atlas is repainted in full on every time-of-day tick.

**This vocabulary adds no tile, no atlas image and no style layer.** Every piece
is flat-coloured geometry carrying its own `wd`/`wg`/`wn` trio in the feature,
exactly the way `data/entrances.geojson`'s 10,717 features already do. A mullion
grid is 6–12 thin slabs, which is cheaper than a tile and, unlike a tile, has a
vertical anchor. Where a texture would be the obvious answer — the roll gate's
slats, the lobby's interior — the answer here is a flat value, because at 200–900 m
and 60–75° pitch neither resolves. **Count: 0 new tiles.**

### 2.5 Which file this writes

`scripts/bake_entrances.py` → `data/entrances.geojson` (CLAUDE.md lane rule 1:
one bake owns one output file). `W` goes in the existing `FAMILIES` dict as a
fifth entry and the 24 names go in the existing named-list cascade at step 3.
**Do not create `data/westcampus_entrances.geojson`.** A second door file is a
second door system and the whole reason this document is an extension.

---

## 3. The derived rules — nothing here is authored per building

Playbook rule 1: derive the rule, then confirm it reproduces every cited example.
Four quantities drive the entire vocabulary and all four come off numbers that
already exist.

### 3.1 Lobby glazing height — from the building's own `base` band

```
LOBBY_H = base_band_h - HEAD_DROP
HEAD_DROP = 0.45          # m of spandrel / slab edge over the storefront head  [A]
```

`base_band_h` is `BUILDINGS[name]["base"][0]` in `bake_westcampus.py` `[M]`.

**This produces a real finding that contradicts the brief.** "Two storeys tall"
is true of the towers and false of the blocks:

```
LOBBY_H >= 5.50  (genuinely two-storey):  21 Rio 5.75, Dobie 5.55, Inspire 5.55,
                 Ion 6.55, Moontower 6.95, Skyloft 5.75, The Standard 6.55   — 7 of 24
LOBBY_H  < 5.50  (one-and-a-half):        the other seventeen
LOBBY_H  = 3.95  (a single storey):       The Nine at Rio — the shallowest base
                 band in the set at 4.4 m. A two-storey lobby does not fit and
                 must not be drawn there.
```

### 3.2 Bank width — a three-step ladder, not a fraction of the elevation

A lobby storefront does **not** scale with the building. A 96 m block and a 44 m
tower have nearly the same front door; what changes is where on the wall it sits.
A linear rule was tried first and it clamped 16 of 24 buildings to the same
value, which means the clamp was doing all the work and the rule was fiction.

```
MULLION_PITCH = 1.524      # m — 5'-0" storefront module                        [A]
bays = 6  if front_elev_len <  45 m
       8  if 45 <= front_elev_len < 80 m
       10 if front_elev_len >= 80 m
bank_w = bays * MULLION_PITCH          #  9.14 / 12.19 / 15.24 m                [D]
```

Distribution over the 24: **3 six-bay, 14 eight-bay, 7 ten-bay.** That is a
vocabulary, not a clamp.

`MULLION_PITCH` is `[A]`. It is the common US storefront module and it is
consistent with the one `[S]` framing dimension in `eras.md` §3.2 (Kawneer
Trifab 450, 1¾″ × 4½″ centre-glazed), but no West Campus elevation was measured
to confirm it. **One rectified photograph of any of these lobbies collapses this
to `[M]` and is the single highest-value verification in the document.**

Mullion face 0.044 m, depth 0.114 m `[S]` (`eras.md` §3.2). Drawn at
`MULLION_DRAW_W = 0.10` for the same reason the handrail is (§2.1 of `eras.md`:
sub-pixel at cruise) — **flag it so nobody "fixes" it back to 0.044.**

### 3.3 Leaf count — derived from the bank, per `eras.md` §3.9

```
n  = 2  on 6- and 8-bay banks   ->  dt = "hinged-pair"
n  = 4  on 10-bay banks         ->  dt = "hinged-quad"   (a vestibule pair)
leaf = LOBBY_DOOR_W 1.067 x DOOR_H 2.44, wide stile 0.127                 [A]
glaz_frac = 0.92
```

**Nobody gets a slider and nobody gets a revolving door.** The brief allows
both; not one of the 24 was found described with either, and inventing a
revolving drum on a 158-unit student tower would be exactly the "confidently
fabricated" failure this file exists to avoid. If a photograph shows one, it is
a per-building `dt` override — one line.

### 3.4 Canopy — derived top, authored projection

```
CAN_PROJ   = 2.60          # m                                             [A]
CAN_T      = 0.30          # m — thicker than family D's 0.18 ON PURPOSE.
                           #     That difference IS the family read.       [A]
CAN_SIDE   = 1.20          # m past the bank each side                     [A]
CAN_TOP    = min(4.20, LOBBY_H - 0.80)                                     [D]
mat = "steel", col = STEEL #8e969c ; soffit REVEAL_COOL #74756d            [S]
```

`CAN_TOP` derived means the shallow-band buildings get a lower canopy
automatically: The Nine at Rio 3.15, Crest/Rambler/Castilian/Nine-at-WC 3.35,
the 5.0 m group 3.75, and everything at or over 5.0 m base band gets the full
4.20. No canopy is ever drawn taller than the band it hangs on.

### 3.5 Reveal — nearly flush, and shallower than family D

```
reveal_d = 0.30           # m                                              [A]
reveal_col = REVEAL_COOL  # #74756d                                        [S]
```

Reasoning: a UNO-era West Campus tower is built to the lot line with the
storefront in the plane of the podium. It is the least articulated entrance in
the whole city model and should read that way. Ordering against the parent spec:
`C 1.50 > A 1.20 > B 0.65 > D 0.35 > W 0.30`. **`W` is now the flattest family
and that ordering is the first thing to check in any render.**

### 3.6 Steps — almost none

```
rise = 0.00 for 21 of 24  [A]  — UNO buildings meet the sidewalk at grade
```

The three exceptions are `[M]`, not taste: **The G** has four tagged OSM `steps`
endpoints at its Guadalupe wall; **Crest at Pearl** has five footway ends on the
MLK elevation (grade change onto MLK); **The Castilian** sits above San Antonio.
Give those three `rise = FLOOR_RISE 0.55`, riser 0.17, tread 0.30, rail present.
Everyone else gets `rise = 0` and **no rail** — a handrail on a flat threshold is
a defect you can see.

---

## 4. Family `W` — the drop-in `FAMILIES` entry

Same shape as `bake_entrances.py`'s existing A/B/C/D/E entries, so this is a
paste, not a port.

```python
"W": dict(
    era="highrise", arched=False,
    open_w=None, open_w_sec=None,        # DERIVED per building — see 3.2
    leaf_w=LOBBY_DOOR_W, leaf_h=DOOR_H, max_pairs=2,
    spring_h=None,                       # DERIVED: LOBBY_H, see 3.1
    arch_rise=0.0,
    transom=True, transom_h=None,        # DERIVED: LOBBY_H - 2.44 - 0.044
    surround_w=0.0, surround_proj=0.0,   # no surround: the storefront IS the frame
    cornice=0.0, sign_band=True,         # the NAME band, see 4.6
    reveal_d=0.30, reveal_col=REVEAL_COOL,
    rise=0.0, riser=FLIGHT_RISER, tread=UTILITY_TREAD,
    cheek=False, rail=False,             # rail only where rise > 0
    canopy=dict(proj=2.60, t=0.30, top=None, mat="steel", col=STEEL),
    leaf_mat="glass", leaf_col=STEEL_DK, glaz_frac=0.92,
    sur_mat="aluminium", sur_col=ALUMINIUM, glass_col=GLASS_LOWE,
    dt="hinged-pair", accent=None, accent_h=0.0,
    # ── new to this family
    mullion_pitch=1.524, mullion_w=0.10, mullion_col=None,  # see 4.5
    leasing_bays=2,                                          # see 4.7
    name_cap=None,                                           # DERIVED, see 4.6
),
```

### 4.5 Mullion colour — derived from the base band's own facade family

```
mullion_col = STEEL_DK  #4b4f53   where base band family is "sg" (dark glazed base)
              ALUMINIUM #9aa0a4   where it is "sp" / "sn" (masonry / brick base)
```

Fifteen of the 24 have an `sg` base and therefore dark-anodised mullions; nine
have a masonry base and get mill-finish aluminium. This is `[D]` off a value the
bake already measured, not a per-building choice.

### 4.6 `SIGN` — the name band

New piece, `k:"sign"` (the kind already exists in `entrances.geojson`; ten
features use it).

```
NAME_CAP = min(0.55, (LOBBY_H - CAN_TOP) * 0.55)          # m cap height   [D]
placement: on the spandrel between CAN_TOP and LOBBY_H, centred on the bank
width:     0.62 * bank_w                                                    [A]
```

**Colour — and this is where the document refuses to invent.** Two trios already
exist in `js/westcampus.js` and both were read off named photographs:

```
signw  ['#e6e5e0','#efe6d6','#cdd6e4']   brushed white letters, backlit    [S]
sign   ['#8a4a22','#b4622c','#ff8a3c']   dark bronze by day, lit orange    [S]
```

`signw` is the **default** for all 24. It is the commonest treatment on these
buildings and, more to the point, it is a *measured* value that already survives
this renderer's transfer at all three times of day. **Moontower is the one
override** (`sign`, warm orange) because its lit orange lettering is sourced
in-repo. No third colour is added. Where the lettering is unverified — which is
21 of 24 — the model draws a **band of `signw`, not a wordmark**: at 200–900 m a
0.55 m cap height is roughly one pixel and a lit band is the honest
representation of "there is a name here". §8 makes this the default.

### 4.7 `LEASING` — the leasing-office window

New piece, `k:"leasing"`. Two bays of the bank (3.05 m), same head height as the
lobby glazing, same mullion grid, **but a distinct glass value** so it does not
merge with the lobby: `GLASS_WARM #6b93b6` `[S]`, day. Placed on the side of the
bank **away from** the nearest street corner, so it reads as the quieter half.
Present on all 24 `[A]` — every one of these buildings has an on-site leasing
office `[S]`, but which window is it was verified on none of them.

### 4.8 Night — the one claim in this file that must be checked in pixels

A student lobby is the one thing in West Campus that is genuinely lit after dark,
and this is exactly where a pass this week went wrong: **the paint expression
said the glass was lit and the pixels said flat grey.**

```
lobby glass  wn = GLASS_NIGHT_LIT[0]  #ffaa3c                              [D]
leasing      wn = GLASS_NIGHT_LIT[1]  #ffc06a                              [D]
sign         wn = signw[2] #cdd6e4  /  Moontower sign[2] #ff8a3c           [S]
everything else follows wall_ramp() unchanged
```

`GLASS_LIT_LUMA_MIN 150` in `bake_entrances.py` is the guard: a lit pane is
entered at least that bright **or it is genuinely dark — nothing in between.**

**Verify with the magenta mask (HANDOFF §48), not by reading the expression.**
Recolour the entrance layer to magenta, screenshot at night, confirm the magenta
is where the lobbies are, restore, screenshot again, sample the hex. Twice;
trust the second.

---

## 5. Garage and service entry — a variant, not a family

`eras.md` E3 already has a vehicle opening: 6.00 × 4.30, `IRON #3f4145`,
`dt="overhead"`. That is a **public parking deck** opening and it is too big for
a residential roll gate, and on a 4.4 m base band it does not physically fit.

```
GATE_W = 5.50                         # m — two lanes, passenger cars       [A]
GATE_H = min(2.90, base_band_h - 0.60)                                      [D]
col    = IRON #3f4145 ; head housing 0.35 m tall in mullion_col             [A]
dt     = "roll"    role = "service"
```

**Roll-gate slats are not drawn.** A 60 mm slat is a tenth of a pixel at cruise;
the head housing band is what makes it read as a gate rather than a hole.

Where it goes, in order of evidence: (1) a sourced garage address; (2) the
**side street** — the non-address street on the shortest elevation; (3) not at
all. Only **two** are sourced (§6). The rest get case (2) and are marked
unverified. **A generator that puts a confident garage door on all 24 has
fabricated 22 of them.**

Two buildings need the garage said differently, and both are `[S]` in-repo:
**The Castilian** (levels 2–10 are open parking deck directly over the lobby —
`bake_westcampus.py` already draws those nine `dk` bands, so the gate is a ramp
mouth at the ground floor, not a deck opening) and **Dobie Twenty21** (two-level
mall plus garage; garage address 2005 Whitis Ave `[S]`).

---

## 6. The 24 buildings

Coordinates are the **front-elevation door point**, in the repo's own footprint
frame — derived from `data/westcampus.geojson` bounds and, where one exists,
snapped to an OSM footway dead-end within 6 m of the wall. `base` is the
measured band height from `bake_westcampus.py`. `L` is the front elevation's
length; `bays`/`n` follow §3.2 and §3.3 mechanically.

Evidence key: **addr** = street address found on the web; **fw** = OSM footway or
steps dead-end at that wall; **repo** = read off a named photograph in a previous
pass.

### 6.1 The towers

| # | Building | Address `[S]` | Front elev. | Door lat, lon | base → LOBBY_H | L → bays / n | Canopy top | Garage | Retail in the podium |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **21 Rio** | 2101 Rio Grande St | **W, Rio Grande** — addr + fw at 30.28410,−97.74497 | 30.28414, −97.74495 | 6.20 → **5.75** | 43.9 → **6** / 2 | 4.20 | **unverified** → default: W 21st (south) | **YES** — Rio Mart, already 9 slabs in `places.geojson` |
| 2 | **Dobie Twenty21** | 2021 Guadalupe St | **E, Whitis Ave** — *not* Guadalupe; fw ×2 at 30.28365 / 30.28363, −97.74088. Guadalupe is claimed by 46 shop slabs | 30.28364, −97.74090 | 6.00 → **5.55** | 70.3 → **8** / 2 | 4.20 | **`[S]` 2005 Whitis Ave**, Whitis frontage | **YES, heavily** — two-storey Dobie Mall + food court `[S]` |
| 3 | **The Castilian** | 2323 San Antonio St | **W, San Antonio** — addr + fw ×2 at 30.28769/30.28770, −97.74253/−97.74258 (north end) | 30.28762, −97.74264 | 4.60 → **4.15** | 80.3 → **10** / 4 | 3.35 | **ramp mouth**, W elevation — levels 2–10 are the deck `[S]` repo | **YES** — retail suite + Castilian Café `[S]` |
| 4 | **The Callaway House Austin** | 505 W 22nd St | **N, W 22nd** — addr + fw at 30.28509,−97.74385 | 30.28506, −97.74385 | 5.40 → **4.95** | 84.0 → **10** / 4 | 4.15 | unverified → default: Nueces (west) | **No street retail.** On-site dining hall is private `[S]` |
| 5 | **Ion Austin** | 2100 San Antonio St | **E, San Antonio** — addr + fw ×3 near the SE corner | 30.28405, −97.74305 | 7.00 → **6.55** | 65.0 → **8** / 2 | 4.20 | **four-level 260-car garage `[S]`**, above grade → real opening; street unverified → default: W 21st | **YES** — 4,800 sf ground-level commercial suite + 5,000 sf University Lutheran Student Center `[S]` |
| 6 | **Skyloft Austin** | 507 W 23rd St | **N, W 23rd** — addr + fw at 30.28654,−97.74372 | 30.28650, −97.74372 | 6.20 → **5.75** | 48.6 → **8** / 2 | 4.20 | unverified → default: Rio Grande (west) | none found |
| 7 | **Moontower** | 2204 San Antonio St | **E, San Antonio** — addr only; **no footway dead-end on any wall** | 30.28567, −97.74295 | 7.40 → **6.95** | 48.2 → **8** / 2 | 4.20 | **below grade ×4 `[S]`** → ramp; street unverified | none found; "activation spaces from the lobby up" `[S]` |
| 8 | **Inspire on 22nd** | 2200 Nueces St | **E, Nueces** — addr ("corner of Nueces and 22nd" `[S]`) + fw ×3 | 30.28530, −97.74399 | 6.00 → **5.55** | 36.9 → **6** / 2 | 4.20 | **below grade ×4 `[S]`** → ramp; default: W 22nd | none found |
| 9 | **Signature 1909** | 1909 Rio Grande St | **W, Rio Grande** — addr + fw ×2 at 30.28396, −97.74497/−97.74499 | 30.28390, −97.74498 | 5.20 → **4.75** | 52.1 → **8** / 2 | 3.95 | unverified → default: W 21st (north) | none found |
| 10 | **Cambridge Tower** | 1801 Lavaca St | **W, Lavaca** — addr + the existing baked eid 421 | 30.28075, −97.74052 | 5.00 → **4.55** | 88.6 → **10** / 4 | 3.75 | **attended garage `[S]`**; entry unverified | none — 1965 condominium, not student housing |

**Cambridge Tower is the odd one out and must be flagged in the bake.** It is a
1964–65 Thomas E. Stanley New Formalism condominium on the National Register
`[S]`, with 24-hour concierge and an *attended* garage `[S]` — which means a
**porte-cochère**, not a flat 2.60 m canopy. Give it `W` with
`canopy=dict(proj=6.50, t=0.40, top=4.60)` and `dt="hinged-quad"`, marked `[A]`,
and do **not** give it a leasing window or a lit name band. Everything about this
building's entrance is unverified except its street.

### 6.2 The mid-rise blocks

| # | Building | Address `[S]` | Front elev. | Door lat, lon | base → LOBBY_H | L → bays / n | Canopy top | Garage | Retail in the podium |
|---|---|---|---|---|---|---|---|---|---|
| 11 | **The Standard** | 715 W 23rd St | **N, W 23rd** — addr | 30.28724, −97.74620 (west end, under the slate bay) | 7.00 → **6.55** | 96.4 → **10** / 4 | 4.20 | unverified → default: Pearl (west) | **YES** — 4,000 sf retail/restaurant `[S]` |
| 12 | **Rambler** | 2513 Seton Ave | **E, Nueces** — *"the exterior of Rambler faces Nueces Street and offers a street level cafe"* `[S]` + fw at 30.29050,−97.74295 | 30.29045, −97.74295 | 4.60 → **4.15** | 92.9 → **10** / 4 | 3.35 | unverified → default: Seton (west) | **YES** — Daydreamer Coffee, open to the public `[S]` |
| 13 | **2400 Nueces** | 2400 Nueces St | **E, Nueces** — addr; the *"NUECES ST 2400"* sign is at the 24th St (south) end `[S]` repo | 30.28805, −97.74310 | 5.00 → **4.55** | 104.0 → **10** / 4 | 3.75 | unverified → default: Seton (west) | **Institutional, not retail** — ~10,000 sf of academic space incl. the UT International Office `[S]`. Treat as a second storefront entrance, no sign band |
| 14 | **The Quarters Grayson House** | 714 W 22nd St | **S, W 22nd** — addr ("corner of 22nd and Pearl" `[S]`) + fw at 30.28539,−97.74645 | 30.28538, −97.74640 | 5.00 → **4.55** | 45.7 → **8** / 2 | 3.75 | unverified → default: Pearl (west) | none found |
| 15 | **The Quarters Sterling House** | 709 W 22nd St | **N, W 22nd** — addr + fw at 30.28527,−97.74645 | 30.28525, −97.74645 | 5.00 → **4.55** | 71.3 → **8** / 2 | 3.75 | unverified → default: Pearl (west) | none found |
| 16 | **The Nine at Rio** | 2100 Rio Grande St | **E, Rio Grande** — addr; fw ×4 cluster at the 21st/Rio Grande corner, −97.74511…−97.74515 | 30.28416, −97.74511 | 4.40 → **3.95** | 56.0 → **8** / 2 | **3.15** | unverified → default: W 21st (south) | none found |
| 17 | **The Nine at West Campus** | 2518 Leon St | **E, Leon** — addr + fw ×2 landing exactly on the wall at 30.29089, −97.74909/−97.74903 | 30.29089, −97.74905 | 4.60 → **4.15** | 68.1 → **8** / 2 | 3.35 | unverified | none found |
| 18 | **The Block** | **2510 Leon St** — see §0 | **E, Leon** — fw ×2 at 30.29058 / 30.29067, −97.74920 | 30.29058, −97.74922 | 5.40 → **4.95** | 69.1 → **8** / 2 | 4.15 | unverified | none found |
| 19 | **Block on 25th East** | 702 W 25th St | **S, W 25th** — addr + fw at 30.28947,−97.74605 | 30.28941, −97.74595 | 5.00 → **4.55** | 91.2 → **10** / 4 | 3.75 | unverified | none found |
| 20 | **Crest at Pearl** | 706 W MLK Blvd | **S, MLK** — addr + **five** fw ends on this wall (0.0 m at 30.28300 / 30.28302 / 30.28307) | 30.28300, −97.74607 | 4.60 → **4.15** | 77.9 → **8** / 2 | 3.35 | unverified → default: Pearl (west) | none found |
| 21 | **Pointe on Rio** | **1901 Rio Grande St** — see §0 | **W, Rio Grande** — addr + fw ×3 at −97.74510/−97.74511 | 30.28274, −97.74509 | 5.00 → **4.55** | 92.7 → **10** / 4 | 3.75 | unverified → default: MLK (south) | **YES** — Conscious Cravings, already 5 slabs in `places.geojson` |
| 22 | **Twenty Two 15** | 2215 Rio Grande St | **W, Rio Grande** — addr. **Conflict:** the only fw ends are on the **N** (W 23rd) wall | 30.28630, −97.74476 | 5.20 → **4.75** | 64.2 → **8** / 2 | 3.95 | unverified | none found |
| 23 | **The Venue on Guadalupe** | 2815 Guadalupe St | **W, Guadalupe** — addr + fw at 30.29434,−97.74221 | 30.29434, −97.74216 | 5.00 → **4.55** | 69.6 → **8** / 2 | 3.75 | unverified | **CHECK FIRST** — two `places.geojson` shops fall inside this bbox and are probably the neighbour's (§2.3) |
| 24 | **The G** | **1715 Guadalupe St** — see §0 | **W, Guadalupe** — addr + **four `steps`/`footway` ends**, the strongest placement evidence in the set | 30.28031, −97.74202 | 5.20 → **4.75** | 51.6 → **8** / 2 | 3.95 | unverified | none found. South of the Drag range, so no E1 conflict |

### 6.3 Where the evidence disagrees with itself — three, stated openly

1. **The Standard.** The address is on W 23rd and the in-repo photograph read
   puts the slate bay carrying `THE STANDARD` at the **west** (Pearl) end
   `[S] repo`. The only footway dead-end is at the **east** (Rio Grande) end.
   This spec puts the lobby **west, under the sign**, and marks it `[A]`. If a
   photograph shows the door at the east end, that is one coordinate.
2. **Rambler.** LV Collective says the exterior *faces Nueces* and the street
   café is there `[S]`; Daydreamer's own listing says *"26th Street and Seton
   Ave"* `[S]`. Both can be true of a corner building. This spec puts the
   **lobby on Nueces (east)** and notes the **café at the 26th/Seton (NW)
   corner** — but only the lobby is drawn by this pass; the café is a
   `places.geojson` job.
3. **Twenty Two 15.** Address on Rio Grande (west), footways on 23rd (north).
   Address wins for the lobby; the north ends are most likely the pedestrian
   route to campus, not the front door.

---

## 7. What is verified, per column, counted honestly

| Column | `[S]`/`[M]` | `[A]` | Notes |
|---|---|---|---|
| Front-door street | **22 / 24** | 2 | Only The Block and The G rest on a footprint-vs-address reconciliation, and both are argued in §0 |
| Door lat/lon | **17 / 24** have a footway or steps dead-end within 6 m | 7 | Moontower and Cambridge Tower have **none**; both fall back to the elevation midpoint |
| Ground-floor retail present | **9 / 24 positively established** | 15 negative | A negative here means *"not found"*, not *"none"* |
| `base` band → lobby height | **24 / 24 `[M]`** | 0 | The strongest column in the document |
| Garage entry | **2 / 24** (Dobie `[S]`, Castilian `[S]` repo) | 22 | The weakest column in the document |
| Building **name lettering** | **3 / 24** (Moontower, The Standard, 2400 Nueces — all `[S]` repo) | 21 | See §8 |
| Canopy geometry | **0 / 24** | 24 | Not one canopy was found described or photographed |
| Mullion pitch | **0 / 24** | 24 | §3.2 |
| Door leaf count / type | **0 / 24** | 24 | Derived per `eras.md` §3.9 |

---

## 8. THE DEFAULT — what the generator draws when it does not know

Every field above has a default so the generator never guesses silently. This
block is the whole contract in one place.

```
DEFAULT_W = dict(
    # placement
    elevation      = the wall the street address is on,
                     else the wall with the most footway dead-ends,
                     else the longest wall facing a named road.
    door_point     = the nearest footway dead-end on that wall,
                     else that wall's midpoint.
    rise           = 0.0 ; no steps, NO RAIL.

    # size — all derived, never authored
    lobby_h        = base_band_h - 0.45
    bays           = 6 / 8 / 10 by elevation length (3.2)
    bank_w         = bays * 1.524
    n, dt          = 2 "hinged-pair"  (6, 8 bays) / 4 "hinged-quad" (10 bays)
    reveal_d       = 0.30
    canopy         = proj 2.60, t 0.30, top min(4.20, lobby_h - 0.80)

    # THE NAME — the field most likely to be fabricated, so it is the most
    # constrained. Where the lettering is unverified the model draws a LIT BAND,
    # NOT A WORDMARK: k="sign", colour signw, cap height per 4.6, and the
    # property carries  nm_verified: false  so a later pass can find all 21.
    name_text      = None            # <- deliberately null, not the building name
    name_col       = signw ['#e6e5e0','#efe6d6','#cdd6e4']

    # THE GARAGE — omitted, not guessed, unless there is a side street
    garage         = None  if the footprint fronts only one named road
                     else GATE_W 5.50 x GATE_H min(2.90, base-0.60), IRON,
                          on the shortest non-address elevation,
                          property  gate_verified: false

    # RETAIL — never asserted by this pass
    retail         = whatever data/places.geojson already says, and nothing else.
                     This pass NEVER adds a shopfront. It only refuses to
                     overlap one.
)
```

**Three rules that outrank everything above.**

1. **A wall segment already carrying a `places.geojson` `front` slab is not
   available.** Move the bank along the wall; if it does not fit, move to the
   next-best elevation; if that fails, draw no lobby on that building and log it.
2. **Never write a building's name as drawn text unless it is one of the three
   `[S]` wordmarks.** A band is honest; an invented wordmark is not, and Simeon
   asked for accurate text specifically.
3. **`nm_verified` and `gate_verified` are emitted as feature properties**, so
   "how much of West Campus is guessed" is a query, not an archaeology project.

---

## 9. What is not established, and should be before this is drawn

1. **No photograph of any West Campus lobby was obtained in this pass.** Every
   canopy dimension, every mullion pitch, every door count and 21 of 24 wordmarks
   are `[A]`. Leasing sites describe amenities, not elevations; Google Street
   View is not fetchable from here. **One rectified photograph per building
   collapses most of §3 to `[M]`.** Start with Moontower (Gensler's own project
   page), The Standard (Humphreys & Partners, already used in-repo) and 2400
   Nueces (Architect Magazine, already used in-repo) — three buildings whose
   photographs this repo has already found once.
2. **`MULLION_PITCH = 1.524` is the highest-leverage unverified number** (§3.2).
   It sets the bay count on all 24.
3. **The garage column is 22/24 unverified.** The default is to draw nothing.
   Resist the temptation to put a gate on every building because student
   high-rises usually have one — "usually" is how a wrong door gets onto 22
   buildings at once (`eras.md` §5.2's own warning).
4. **The night-lit lobby glass claim is unverified in pixels** (§4.8) and must be
   checked with the magenta mask before it is reported as working. The paint
   expression saying so is not evidence; a pass this week made exactly that
   mistake.
5. **The Venue on Guadalupe's two `places.geojson` shops** may belong to the
   neighbouring building (§2.3). Resolve before drawing anything on its
   Guadalupe wall.
6. **Cambridge Tower does not belong to this family** and is carried only
   because it is in the named list. Its porte-cochère numbers are pure `[A]`.
7. **`entrance_z` is still unsolved** — the app has no terrain (`eras.md` §5.3).
   Here it matters less than on the Forty Acres, because 21 of 24 are at grade by
   construction, but the three that are not (The G, Crest at Pearl, The Castilian)
   inherit the same open problem.

---

## 10. Sources consulted

Addresses and ground-floor uses:

- [21 Rio — 2101 Rio Grande St](https://www.apartments.com/21-rio-apartments-austin-tx/yjbdxhr/)
- [Dobie Twenty21 — 2021 Guadalupe St](https://www.loopnet.com/Listing/2021-Guadalupe-St-Austin-TX/35880859/) · [Dobie Center (two-storey mall, restaurants, stores)](https://en.wikipedia.org/wiki/Dobie_Center) · [Dobie Twenty21 garage, 2005 Whitis Ave](https://en.parkopedia.com/parking/garage/dobie_twenty21_garage/78705/austin/)
- [The Castilian — 2323 San Antonio St, retail suite](https://www.loopnet.ca/Listing/2323-San-Antonio-St-Austin-TX/22994129/) · [The Castilian Café](https://www.yelp.com/biz/the-castilian-caf%C3%A9-austin)
- [The Callaway House Austin — 505 W 22nd St](https://www.americancampus.com/student-apartments/tx/austin/the-callaway-house-austin)
- [Ion Austin — 2100 San Antonio St, 4,800 sf commercial + Lutheran Student Center](https://ion-austin.com/one-sheet/) · [Ion Austin listing](https://www.yelp.com/biz/ion-austin-austin)
- [Skyloft Austin — 507 W 23rd St](https://www.apartments.com/skyloft-austin-austin-tx/89ljpm3/)
- [Moontower — 2204 San Antonio St, 17 floors + 4 below-grade parking](https://lvcollective.com/work/moontower-austin/) · [Moontower / Gensler](https://www.gensler.com/projects/moontower-student-housing)
- [Inspire on 22nd — 2200 Nueces St, corner of Nueces and 22nd](https://www.apartments.com/inspire-on-22nd-austin-tx/ncvj5eq/)
- [Signature 1909 — 1909 Rio Grande St](https://www.apartments.com/signature-1909-austin-tx/52d45jm/)
- [Cambridge Tower — 1801 Lavaca St, 1964–65, Thomas E. Stanley, attended garage](https://en.wikipedia.org/wiki/Cambridge_Tower) · [Cambridge Tower amenities](https://austin.towers.net/condos/cambridge/)
- [The Standard at Austin — 715 W 23rd St, 4,000 sf retail](https://www.landmarkproperties.com/property/the-standard-at-austin/) · [The Standard listing](https://www.apartments.com/the-standard-at-austin-austin-tx/656p4kt/)
- [Rambler — 2513 Seton Ave, exterior faces Nueces, street-level café](https://lvcollective.com/work/rambler-atx/) · [Daydreamer Coffee, 2513 Seton Ave](https://www.yelp.com/biz/daydreamer-coffee-austin)
- [2400 Nueces — 10,000 sf ground-level academic space, UT International Office](https://housing.utexas.edu/housing/2400-nueces-apartments) · [2400 Nueces, Architect Magazine](https://www.architectmagazine.com/project-gallery/2400-nueces/)
- [The Quarters Grayson House — 714 W 22nd St, corner of 22nd and Pearl](https://www.trulia.com/building/the-quarters-grayson-house-714-w-22nd-st-austin-tx-78705-1001505915) · [The Quarters Sterling House — 709 W 22nd St](https://www.apartmentratings.com/tx/austin/the-quarters-at-sterling-house_512531012378705/)
- [The Nine at Rio — 2100 Rio Grande St](https://www.yelp.com/biz/the-nine-at-rio-austin) · [The Nine at West Campus — 2518 Leon St](https://www.trulia.com/building/the-nine-at-west-campus-2518-leon-st-austin-tx-78705-1001414484)
- [The Block on Leon — 2510 Leon St](https://www.yardimatrix.com/property-types/multifamily/austin/block-on-leon-the-2510-leon-street-tx-78705--30397/) · [The Block on 25th East — 702 W 25th St](https://www.yelp.com/biz/the-block-on-25th-east-austin)
- [Crest at Pearl — 706 W MLK Blvd](https://www.yelp.com/biz/crest-at-pearl-austin)
- [Pointe on Rio — 1901 Rio Grande St](https://www.trulia.com/building/pointe-on-rio-1901-rio-grande-st-austin-tx-78705-2750929673)
- [Twenty Two 15 — 2215 Rio Grande St](https://www.zillow.com/b/twenty-two-15-austin-tx-5Yy9N5/)
- [The Venue on Guadalupe — 2815 Guadalupe St](https://www.apartments.com/venue-on-guadalupe-austin-tx/rxxpkt1/)
- [The G — 1715 Guadalupe St](https://www.apartments.com/the-g-apartments-austin-tx/19xp826/)

Dimensions and code, carried from `docs/entrances/eras.md` §8 rather than
re-cited: STANLEY Access Technologies (commercial leaf), IBC 1010.1.1 / 1011.5.2
/ 1014.3, Kawneer Trifab 450 storefront framing.

In-repo sources — **measured against this renderer and therefore preferred over
any web value**: `scripts/bake_westcampus.py` (every `base` band height, the
Moontower and Standard and 2400 Nueces wordmarks, the Castilian's nine parking
levels), `js/westcampus.js` (`sign` and `signw` trios),
`scripts/bake_entrances.py` (the FAMILIES shape and every colour constant),
`data/places.geojson` (the four already-claimed podia),
`data/osm_cache/roads.json` (street centrelines, used to confirm every frontage),
`data/osm_cache/footways.json` (6,860 endpoints, used to place 17 of 24 doors),
`data/westcampus.geojson` (all footprint bounds).

**Blocked / not obtained:** no street-level photograph of any of the 24
buildings. Google Street View, Apple Look Around and Bing Streetside are not
fetchable from this environment, and the leasing sites publish interior and
amenity photography almost exclusively. That is the reason §7's canopy and
lettering rows are zero.
