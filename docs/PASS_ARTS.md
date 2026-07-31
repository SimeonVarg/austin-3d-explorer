# The arts and presidential precinct

Written 2026-07-31. The brief is `docs/PASS_COMMON.md` plus the "Arts corridor"
block in `docs/FIVE_BUILDING_PASSES.md`. Owned files: `js/arts.js`,
`scripts/bake_arts.py`, `data/arts.geojson`, this document,
`scripts/verify/arts-*.mjs`.

---

## What the pass is actually about

Four of these five buildings are **essentially blind**. That is not a nuance —
it means the generic facade system was not slightly wrong on them, it was wrong
in kind. It was drawing office windows on:

- a windowless travertine box on piers,
- a barrel-vaulted stone chapel whose only openings are fourteen pieces of
  coloured glass the size of a door,
- a museum whose upper wall is a blind incised limestone panel field over an
  arcade,
- a stone box clad in large *etched glass panels* — a solid-looking grid, not
  openings,
- and a concert hall whose entire architectural argument is that the auditorium
  is blind brick and only the lobby is glass.

So the work is mostly **subtraction**. `data/arts.geojson` replaces sixteen
generic extrusions with **79 stacked band features**, and 77 of those 79 carry a
flat measured colour and no pattern at all. Two exceptions get a registered
image, and both are named in the brief: the Ransom Center's panel grid, and the
Bass lobby.

The mechanism throughout is the one `scripts/bake_stadium.py` established:
`fill-extrusion-pattern` has no vertical anchor and its world scale halves at
every integer zoom, so a base, a blind middle and a cornice can only be built as
**separate features with different `base` / `height` / inset / colour**.

---

## The one rule that made the geometry safe

**The snapshot footprint is the WIDEST element of the building; every band below
it is inset.** That was checked rather than assumed —
`scripts/overlay_arts_footprints.py` draws each footprint on its own z20 Esri
nadir tile, and in all five cases the outline traces the topmost projecting
thing: the LBJ's cantilevered tenth floor, the Ransom Center's cornice, the
Blanton's tile eave. Nothing is ever grown past the data, which also keeps
`collision.mjs` ("never inside a building") honest.

---

## Reference table

Every hex is the **median of a named patch of a named photograph**, printed by
`scripts/sample_arts_colours.py`. `sd` is that patch's own standard deviation:
under ~30 the patch is one material; over ~80 it straddled two and the number
should not be trusted. Where a value is authored it says so.

### Lyndon Baines Johnson Presidential Library and Museum
| | |
|---|---|
| **Architect / year** | Gordon Bunshaft, Skidmore Owings & Merrill, with R. Max Brooks; dedicated 22 May 1971 |
| **Floors** | 10 (Wikipedia, LBJ Library). `final_height` 28.3 m → 2.83 m/floor, which is right for a building most of whose volume is archive stack |
| **Facade system** | Unornamented cream Italian travertine. **No windows at all** on the two 59 m elevations. The east and west walls batter — they "curve gently upward to the underside walls of the tenth floor" — and the tenth floor **overhangs by 15 ft (4.6 m) on each side**; the north and south walls are set back 15 ft. |
| **Sampled hex** | wall in full sun **#f0e9dd** (sd 64) · nadir roof deck **#f5eedc** (sd 49) · shadow under the cantilever #524b3f · undercroft #181a1d |
| **Bay rhythm** | None. There is one horizontal ribbon window at the foot of the recessed north/south walls, ~2 m tall — 4 px at cruise, not drawn |
| **Roofline** | Parapet over the cantilever; mechanical penthouse (already carried by `data/roofscape.geojson`) |
| **Sources** | [Wikipedia](https://en.wikipedia.org/wiki/Lyndon_Baines_Johnson_Library_and_Museum) · [LBJ Library history](https://www.lbjlibrary.org/history) · Wikimedia Commons exterior photographs · Esri World Imagery z20 |

Modelled as: dark undercroft → three battered wall steps (inset 6.4 → 5.5 →
4.6 m, i.e. 1.8 m of taper over 20 m of wall) → a shadow reveal → the
cantilevered crown at inset 0, with a parapet lip.

### Ellsworth Kelly, *Austin*
| | |
|---|---|
| **Architect / year** | Ellsworth Kelly; opened 2018. The only building Kelly ever designed and his final work |
| **Size** | 2,715 sq ft; **60 × 73 × 26 ft 4 in = 18.3 × 22.3 × 8.03 m**. The snapshot's 6.7 m is 17% short, which on an 8 m object is the entire vault — this is the pass's one height override and it is sourced |
| **Facade system** | White stone panels, **double barrel vault** over a cruciform plan, with fourteen coloured-glass windows |
| **Sampled hex** | nadir vault crown **#dedccd** (sd 39) · street elevation **#b9b4bb** (sd 12). Entered as **#dfe1e3** — see "entering colours cool" below |
| **Bay rhythm** | A 3 × 3 grid of coloured squares on the south gable, a starburst monstrance on the east, tumbling squares on the west. Each pane is 2 ft × 3 ft = 0.6 × 0.9 m ≈ **1–2 px at cruise**. Not drawable, not drawn |
| **Roofline** | Two crossing barrel vaults, ridge at 8.03 m |
| **Sources** | [Blanton](https://blantonmuseum.org/permanent-collection/austin/) · [Wikipedia](https://en.wikipedia.org/wiki/Austin_(building)) · [Bendheim](https://bendheim.com/project/ellsworth-kelly-austin/) · Commons elevations · Esri z20 |

**Was it worth the time?** The brief said to check whether it reads at flying
altitude and to spend the time elsewhere if not. It reads: ~20 m of near-white
stone on a green lawn is about 40 px across at cruise, and it is the brightest
object in its frame. It got a proper cruciform vault rather than a token one,
and it cost about forty lines — see below.

### Blanton Museum of Art — Mari and James A. Michener Gallery Building
| | |
|---|---|
| **Architect / year** | Kallmann McKinnell & Wood; opened 2006 |
| **Floors** | Two gallery levels. (`num_floors: 5` in the snapshot is an Overture artefact) |
| **Facade system** | Arcaded loggia of round arches at grade; above it a **blind panelled limestone field** with incised geometric borders and very few openings; a deep overhanging eave; a clay-tile hip roof around a central court with a clerestory monitor |
| **Sampled hex** | sunlit limestone **#eadbcd** (sd 30) · arcade shadow #514a35 (sd 124, straddles arch head and pier) · clay tile from nadir **#9e7865** (sd 28) |
| **Bay rhythm** | The arcade, at roughly 7 m. Not drawn as a pattern — see "why the arcade is geometry" |
| **Roofline** | Clay tile hip roof, ridge ~20.5 m. **Not baked here** |
| **Sources** | Commons 2025 street photography · Esri z20 nadir · Kallmann McKinnell & Wood |

The **Edgar A. Smith Building** (the Blanton's second building, 43 × 63 m) gets
the same three-band recipe, because it is the same building in a smaller box and
having one of the pair corrected and the other not would have looked worse than
correcting neither.

### The twelve Snøhetta petals (2023)
| | |
|---|---|
| **What** | A grove of perforated petal-shaped shade structures over the Blanton plaza, doubling as rainwater collection |
| **Count / height** | **12**, standing "nearly 40 feet" = **12.2 m** |
| **In the snapshot** | **Ten** of them, as unnamed 9.2 m circles at a `class_default` 8.0 m, in ten different unrelated colours (brown, blue-grey, brick). The other two are absent entirely |
| **The missing pair** | Digitised off the z20 Esri nadir tile at (−97.7371430, 30.2806676) and (−97.7370465, 30.2806699), radius 4.0 m. The digitising was **checked before it was trusted**: the same transform reprojects all ten known footprints onto their own discs to within a few pixels |
| **Sampled hex** | sunlit outer shell **#e4d9ca** · nadir disc top #95937e (sd 60). Entered as **#dcd7cf** |
| **Sources** | [Architectural Record](https://www.architecturalrecord.com/articles/16998-at-ut-austin-snohettas-grove-of-towering-petals-transforms-a-museum-campus) · [Snøhetta](https://www.snohetta.com/projects/blanton-museum-of-art-grounds-redesign) · Esri z20 |

### Harry Ransom Center
| | |
|---|---|
| **Architect / year** | 1972; front facade and lower floors remodelled by **Lake\|Flato, 2003** — a 40,000 sq ft transformation of what the practice's own write-up calls a "fortress-like" building with a windowless façade |
| **Floors** | `final_height` 32.0 m. The snapshot's `num_floors: 3` is wrong; the visible panel field alone is three courses of double-height panel |
| **Facade system** | A stone box whose upper two-thirds are **large etched translucent glass panels** — a solid-looking grid, not windows. Thin dark joints, a heavier structural line every two panels, a band of close-spaced vertical fins above the recessed ground floor, and a deep projecting cornice |
| **Sampled hex** | panel field **#a4a4a1** (sd 17; two further patches within 11 units) · cornice **#b2aaa1** street (sd 14) / #b2a38c nadir (sd 24) · joint #312e2c (sd 90 — a 2 px feature) |
| **The colour that matters** | Three separate patches of the panel field measure **H60, S 1.8–2.5% — dead neutral** — while the concrete cornice on the same building measures H32 S10%. That difference is the etched glass against the concrete, and it is the most identifying fact about this facade. The snapshot had the building as `#cdc4b0`, the campus-limestone default, which is a warm tan |
| **Bay rhythm** | Panels ≈ 6.5 m square (three courses over a 20 m field, two panels per structural bay) → **10–14 px at cruise**, the largest drawable feature anywhere in this pass |
| **Roofline** | Deep projecting cornice, flat roof, mechanical (already in `roofscape.geojson`) |
| **Sources** | [Lake\|Flato](https://www.lakeflato.com/project/ut-austin-harry-ransom-center/) · [Ransom Center](https://www.hrc.utexas.edu/about/) · [Etched Archive](https://sites.utexas.edu/ransomcentermagazine/2021/04/10/etched-archive-windows-at-the-harry-ransom-center/) · Commons 2012 elevation · Esri z20 |

### Bass Concert Hall / College of Fine Arts Performing Arts Center
| | |
|---|---|
| **Architect / year** | Opened 1981; lobby and front facade by **Boora Architects with CCS&H, 2007–08** — a $14.7 M renovation that extended the facade one structural bay and added 7,000 sq ft of lobby across five levels behind a glass-and-steel curtain wall |
| **Seats** | 2,900 — the largest theatre in Austin |
| **Facade system** | Buff brick, **completely blind**, in stepped masses. The only glass on the building is the 2008 lobby on the south elevation, under a white horizontal sunshade |
| **Sampled hex** | brick **#dab596** (sd 20; two further patches within 4 units) · lobby glass **#738e9d** (sd 53) · nadir roof deck #a99d89 (sd 24) |
| **Bay rhythm** | None on the brick. The lobby curtain wall is drawn at the **structural bay** (~4–7 m), not the mullion: a 1.5 m mullion spacing is 2–3 px of a tile that covers 30–59 m of wall, and drawing it would draw a 3–5 m mullion |
| **Roofline** | Flat, stepped parapets; the auditorium block rises well above the rest |
| **Sources** | [Texas Performing Arts](https://texasperformingarts.org/about/news-stories/bass-concert-hall-renovation/) · [Boora](https://bora.co/project/ut-austin-bass-concert-hall/) · [Wikipedia](https://en.wikipedia.org/wiki/University_of_Texas_Performing_Arts_Center) · Commons 2025 street photography · Esri z20 |

**Two volumes the footprint does not contain.** The snapshot has the whole
complex as one 105 × 119 m polygon at 14.6 m, which is neither the auditorium
nor the lobby:

- the **auditorium block**, 38.3 × 35.1 m, measured off the z20 tile (297 × 272
  px axis-aligned, de-rotated by the complex's own 3.6° off north) and raised to
  **23.0 m** by scaling the entrance doors in a street photograph;
- the **2008 lobby**, 33.5 × 13.0 m at **15.8 m**, which post-dates the
  footprint entirely — it is the "extended one structural bay" of the Boora
  renovation and sits outside the polygon.

The base mass is deliberately **left at 14.6 m** even though the photograph says
the south elevation is over 20 m, because `data/roofscape.geojson` puts this
building's roof deck at 15.85 m and 42 clutter items at 16.9–17.9 m. Raising the
mass would have buried all of them. The tall part of the photograph is the
auditorium, and that is modelled as its own volume instead.

---

## Decisions this pass made, and why

**The Blanton petals were built.** The brief said to escalate if authoring them
would make the pass materially longer. It would not have: the snapshot already
contains ten of the twelve as circular footprints, so they were a scaling
function over existing geometry rather than new authorship. Four stacked rings
per petal — shaft, two flare steps, canopy — 48 features for the lot. They are
the most photographed object in the precinct and from the flying camera they
read as a grove of pale discs floating over the plaza, which is exactly what
they are.

**The Blanton's clay tile roof was NOT built.** `data/roofs.geojson` already
carries 28 pitched features for this building, rising from base 15.3 to 20.5 m
in `#c85f3c`, and `app.js`'s `addRoofLayers` draws them from a source this
module never touches. Baking a second hip roof would have put one inside the
other. Insetting the walls 1.5 m instead turns that existing roof into the deep
eave the building actually has — a correction that cost nothing because someone
else had already done the expensive half. Checking for this was not optional:
`docs/PASS_COMMON.md` warns that your building may be replaced already, and this
is the same trap wearing a different hat.

**Kelly's *Austin* was worth building, and got a real vault.** A uniform inward
offset is the wrong erosion for a barrel vault — a barrel narrows across its
span and keeps its ridge full length, ending in a vertical gable, which on this
building is the arched south front with the nine-square colour grid in it. It is
also not a *legal* offset here: the plan is a cross, every inward offset of it
has four reflex corners, and the offset-then-intersect method in `offset()`
spikes at reflex corners and self-intersects. The first run of the bake reported
`inset_collapsed: 3` — all three vault steps, at insets as small as 1.3 m — and
would have rendered Kelly as a flat white box. `kelly_vault()` fits an oriented
frame to the footprint, measures each arm's width in that frame, and emits one
rectangle per arm per step, narrowed only across the arm. The fit reports
22.7 × 19.7 m with 7.7 m arms against Kelly's published 18.3 × 22.3 m, which is
an independent check that the frame-fitting is right.

**Why the arcade is geometry and not a pattern.** A pattern has no vertical
anchor *and* its world scale halves at every integer zoom, so a band 5 m tall
shows a different 5–11 px slice of the tile at every altitude. Only a
statistically **uniform** pattern survives that. A panel grid is uniform. An
arcade is not — the arches have to sit at the bottom. So the Blanton's loggia is
a band inset 2.6 m and painted in shadow, which is what a colonnade looks like
from 400 m.

**Entering colours cool.** Measured, this renderer's sun tint pushes an input
R/B of 1.03 out to 1.35 on a top face, and a wall face lands at roughly R ×0.78,
G ×0.69, B ×0.58 of its input. So:

- Kelly's near-neutral stone was entered at **#dfe1e3** rather than its sampled
  value, or it would stop being the cool object it is next to the Blanton;
- the petals were entered at **#dcd7cf** — before that correction the discs
  measured **#f5d4a4** on screen, which is orange;
- the Bass lobby glass was entered at **#6b93b6** rather than the sampled
  **#738e9d**, because the sampled value renders dead neutral and the one cool
  material in the pass stops being cool;
- the parapet caps are their nadir samples with R ×0.94 and B ×1.06 — a
  **partial** correction, because a full one needs an input near R/B 0.7 and
  that is a blue roof at golden hour and at night, when the same `wall_ramp()`
  carries it through.

This is the same rule `docs/PASS_COMMON.md` §3 gives for roof colours, applied
to walls as well, because two of these buildings are mostly roof.

---

## Traps hit, for the next person

**A glass lobby handed to the shared facade atlas came back BRICK.** The lobby
was originally given to `quantiseOuterFacades()` to borrow a curtain-wall
pattern at zero image cost. Measured, it rendered at `#ac7a52` against a sampled
`#738e9d`: the shared palette is fourteen buckets derived from Austin's building
colours and they are almost all tan, so nearest-RGB on blue-grey glass simply
snaps to brick. `bake_stadium.py` says the same thing about its 2008 brick end
zone. It rendered beautifully, which is why only a pixel measurement caught it.

**`applyArtsColors` lost its `ensureImages()` call in a refactor and nothing
noticed.** The two patterned bands stayed frozen at whatever time of day they
were first registered while every band around them moved through the ramp.
`arts-check.mjs` now asserts the image BYTES change, not just the paint
properties.

**The panel joint entered as its sampled hex rendered as a black cage.** Eleven
hard bars across a 63 m elevation. A joint at this distance is a shadow reveal a
few centimetres deep, so it has to be a *value step* relative to the panel — and
a value step is also the only thing that minifies gracefully, because it
averages into the field instead of aliasing into bars.

**A sub-metre ledge between two bands aliases into a dashed white line** that
reads as a rendering fault. The Ransom Center's fin band left a 0.3 m ledge
under the panel field and the Bass parapet left 0.6 m; both are now flush. A
ledge is either worth a metre or it is worth nothing.

**A shadow entered as a photograph's black point renders as a hole.** The LBJ's
undercroft sampled at `#181a1d` and measured `#2f2517` on screen: a black slot
punched under the building. This renderer applies its own face shading, so a
shadow has to be entered *already lit* — `#78736b`.

**Three verification rigs were wrong before one was right**, and all three
produced believable numbers. See the long comment at the top of the rig in
`scripts/verify/arts-check.mjs`; the short version is that `map.setSky()` is not
a layer, that the sky is animated so a two-frame diff drifts, and that a key
colour painted onto the layers themselves is the only mask that cannot lie.

---

## Verification

```bash
python -m http.server 8146 --bind 127.0.0.1        # from the repo root
cd scripts/verify
VERIFY_URL=http://127.0.0.1:8146 node arts-check.mjs        # 28 assertions
VERIFY_URL=http://127.0.0.1:8146 node arts-perf.mjs         # interleaved A/B
VERIFY_URL=http://127.0.0.1:8146 node shot.mjs arts shots-arts.json
python scripts/overlay_arts_footprints.py          # footprints on nadir imagery
python scripts/sample_arts_colours.py              # every hex in this document
```

`arts-check.mjs` asserts wiring (four layers, anchored above `buildings-3d` and
above `ground-areas`, every replaced id filtered out, both images registered,
vertical-gradient off, the day/night hook live) and then measures pixels:
stacked geometry on the LBJ, two materials with glass in the minority on Bass,
Kelly cooler and lighter than the Blanton, twelve petals covering the right area
and spread over the right distance, golden hour and night moving, and the panel
tile neutral rather than tan.

---

## What is still missing

- **The LBJ's roof deck is the wrong colour, and it is the surface the camera
  sees most.** `data/roofscape.geojson` bakes it at `#afb5bc`, a cool mid-grey;
  an independent z20 nadir sample of the same roof reads `#f5eedc`, near-white
  travertine. That file belongs to the roofscape pass and has not been touched
  here. It is the single biggest remaining error on the building.
- **The LBJ's undercroft is drawn on all four sides.** In reality the deep
  loggia is only on the two short (north/south) elevations; the long travertine
  walls run to the plaza. A dark plinth band all round is a small, plausible
  error that buys the "on piers" read from every angle, but it is an error.
- **The coffered soffit under the LBJ cantilever is not drawn** — those beams
  are ~1 m deep at 2.5 m centres. Only the shadow band under them is.
- **Kelly's fourteen coloured-glass windows are not drawn**, and cannot be at
  0.6 × 0.9 m. The building reads as white stone with a vaulted silhouette,
  which is what survives at this altitude, but the colour is the whole point of
  the real thing.
- **The Blanton's clerestory monitor and the central court roof** are left to
  the existing roof layers; no monitor is baked.
- **The Ransom Center's fin band tone is generative.** Every patch of the real
  louvre band was blocked by live oaks in every photograph found; the value is
  the panel tone 14% down.
- **Bass's brick masses are one stepped block plus one auditorium box.** The
  real complex steps several more times, and the fly tower is not separated from
  the auditorium.
- **Raising the Bass base mass would bury 42 roofscape clutter items**, so the
  base stays at 14.6 m even though the photograph says the south elevation is
  over 20 m. That is a cross-pass compromise, not a measurement.
- **Sun-tint correction is partial on the caps.** They still render warmer than
  the material is; a full correction is not safe across the whole day ramp.
