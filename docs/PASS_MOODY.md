# Modern east — Moody Center and the Dell Med block

Written 2026-07-31. The pass brief is `docs/PASS_COMMON.md` plus block 5 of
`docs/FIVE_BUILDING_PASSES.md`. This file carries the reference table so the next
person does not re-derive it, and the three places the brief turned out to be
wrong so nobody re-derives those either.

Files: `scripts/bake_moody.py` → `data/moody.geojson` → `js/moody.js`.
Checks: `scripts/verify/moody-check.mjs`, `moody-perf.mjs`, `moody-pose.mjs`,
`moody-shots.json`.

---

## 0. Three corrections to the brief, up front

**The Dell Med buildings are not curtain wall.** The brief expected "horizontal
ribbon glazing or a unitised curtain wall with spandrel panels, sunshades or fins
on the exposed elevations". ZGF's own project photographs show a **stone
rainscreen with deeply recessed punched windows**, no fins and no sunshades —
shading is done by the depth of the reveal. This is not a judgement call:
clustering 1.86 Mpx of pure elevation puts vision glass at **19.8%** of the wall.
A curtain-wall family would have drawn 51%. The photograph wins, per playbook
rule 7, and the pass builds punched windows.

**Neural Molecular Science is not in this pass.** Its footprint in the snapshot
sits on a **red clay-tile hipped-roof block** with a central plant courtyard —
the nadir crop is unambiguous, and `data/roofs.geojson` already gives that
footprint 49 pitched terracotta facets. Cladding it in glass and metal would have
replaced a correct heritage roof with a wrong modern one *and* fought a layer
owned by another pass. It is left exactly as it is. Whether the Overture name is
misplaced or the building is simply older than the brief assumed, the render is
the same either way and the answer is the same: don't touch it.

**Dell Seton Medical Center is not in the snapshot** under that or any close
name, so there was nothing to do for it.

**Boundary check, as instructed:** `data/stadium.geojson`'s `replacedBuildingIds`
is `['6b5bbe97-…']` — DKR only. Moody Center is `d8b0698a-…` and is not in it, so
the two layers cannot render the same building. `bake_stadium.py` skips Moody
because its footprint has no interior ring, which is correct: an arena has a
closed roof, not an open bowl. Neither that file nor `data/stadium.geojson` was
touched.

---

## 1. Reference table

| | **Moody Center** | **Health Transformation Building** | **Health Discovery Building** |
|---|---|---|---|
| id | `d8b0698a-…` | `866e9c84-…` | `f1ca81ce-…` |
| `final_height` | 27.7 m | 46.1 m | 44.8 m |
| Completed | 2022 | 2018 | 2018 |
| Architect | Gensler | ZGF with Page | ZGF with Page |
| Floors | ~4 concourse levels over a sunken bowl | **10** | **7** |
| Floor-to-floor derived | — | 46.1 ÷ 10 ≈ 4.6 m gross, less the mechanical crown | 44.8 ÷ 7 ≈ 6.4 m gross — too tall for a floor, which is what says a mechanical level is in there |
| Size | 530,000 sq ft, 15,000 seats | 233,000–239,370 sq ft | 264,428 sq ft |
| **Facade system** | Layered, not gridded: dark bronze MCM rainscreen, a screen of vertical aluminium fins, a glazed concourse ribbon, then a deeply oversailing roof | Stone rainscreen, **punched windows**, copper reveals, pale ribbed podium | Same family, grey stone, staggered openings |
| Material | 67,000 sq ft ALPOLIC/fr MCM, "three custom shades of dark bronze", PVDF Kynar; 4 mm rout-and-return rainscreen | Limestone / stone panel | Limestone / stone panel |
| Glazing | 360° curtain wall, Vitro **Solarban 70 clear** with Solargray sections | 19.8% measured | 19.8% measured |
| Bay rhythm | Fins 12 in wide on **15–16 in centres** (0.30 m at 0.39 m pitch) | ~3 m bay, staggered between floors | ~3 m bay, staggered |
| **Roofline** | 70,000 sq ft of curved wood-veneered soffit under an oversailing edge; white TPO membrane above | Parapet, modest plant | Parapet over a **solid field of exposed ductwork** |
| Roof deck measured | **[255, 255, 253]** — the brightest large surface in the core | [217, 220, 210] | [180, 180, 172] |
| Snapshot painted its roof | `#434347` (luma 67) | `#65707b` | `#715035` |

### Sources

- Moody envelope, panel area, bronze finish, fin dimensions, soffit area:
  Metal Architecture, *"Moody Center Feels Like Approachable Arena"*; ALPOLIC
  Americas project write-up (photographs by Chase Daniel).
- Moody glazing spec: Vitro Architectural Glass case study via Architectural
  Products.
- Moody size / seats / architect: Architect Magazine, Forbes, Archello.
- Dell Med floor counts, areas, LEED Gold, architect: ZGF project page.
- Every roof deck colour and every rooftop blob: `data/roof_survey.json`, which
  this repo already measured off z20 Esri nadir imagery at 0.129 m/px.
- Massing, the Moody oversail width, and the NMS finding: z20 nadir crops
  fetched for this pass, with the snapshot footprints drawn back over them.

Reference imagery was **not committed**. It is press and manufacturer material,
and `scripts/fetch_reference_imagery.py` already sets that policy ("Reference use
only — marketing/press photos must never ship in the app itself"). The derived
numbers are here instead.

---

## 2. Colours — what was sampled and what was authored

Sampled means a **k-means cluster centre** over a rectangle of pure elevation,
not a box mean. This matters: a box straddling two materials returns a colour
that exists nowhere on the building, and the first three attempts at the copper
reveal returned grey stone twice, because the box was on the wrong rectangle.
The reveal was finally isolated by colour rather than by position — it is the
only strongly warm thing on a grey-stone-and-blue-glass elevation.

| Band | Day hex | How | Share of elevation |
|---|---|---|---|
| `moody-plinth` | `#5a5147` | sampled, flat MCM wall in sun, two photographs agree to 10 luma | — |
| `moody-fins` | `#493c34` | sampled, area-weighted over the three clusters of the fin band | 77% dark / 18% lit |
| `moody-glass` | `#8fa3ad` | sampled, reflecting sky | — |
| `moody-fascia` | `#4a423a` | **authored** — between the MCM's sunlit and shaded values | — |
| soffit tint | `#814b25` | sampled, 52% cluster of the soffit crop, R−B +92 | — |
| lit fin face | `#ac7646` | sampled, 18.5% cluster of the fin close-up, R−B +102 | — |
| `health-podium` | `#efe5d8` | sampled, 51% cluster of the ground-floor band, luma 230 | 51% |
| `health-body-grey` | `#9e918b` | sampled, mean of the two stone clusters (29.1% + 28.0%) | 57% |
| `health-body-cream` | `#cfc4b2` | **authored** — the cream stone exists on the block but no clean sunlit crop of it was sourceable | — |
| window glass | `#203e64` | sampled, 19.8% cluster, R−B −67 | 19.8% |
| copper reveal | `#cda080` | sampled by warm-pixel mask, R−B +77 | 5.6% |
| `health-attic-cream` | `#b6ac9d` | **derived** — its own body × 0.88 | — |
| `health-attic-grey` | `#8b807a` | **derived** — its own body × 0.88 | — |
| apron / membrane / plant | `#c2cddb` / `#dbe6f2` / `#8e9298` | **entered cool on purpose** — see below | — |

The attic tone is derived per building rather than shared, and that was a
correction. One authored tone for both lands as a 10% step below the grey stone
and a 30% step below the cream, so the cream building would have worn a dark hat
that no photograph shows. Same stone, louvred instead of punched, a little in its
own shade — and the louvre texture, not the value, is what says "plant level" at
400 m.

**Why the roof colours are entered cool.** An extrusion's top face picks up the
sun tint; `docs/PASS_COMMON.md` records an input at R/B 1.18 rendering at 1.85,
and `app.js`'s stadium seating tones are entered at R/B 0.85–0.89 for the same
reason. `#dbe6f2` is R/B 0.897 — the same ratio, chosen deliberately, and it
renders at **mean luma 208** (measured, `moody-check.mjs`) against the 67 the
snapshot's `#434347` was giving.

**The weakest claim in this table** is which of the two stones goes on which
building. The block is one material campaign and both stones are present in the
photographs; grey went to Health Discovery partly because its own measured roof
deck is the greyer of the two and partly because it is the lab building whose
roof plant is visible in the same frames. Getting the pair swapped would be
visible only at close range, but it would be wrong, and I could not resolve it
from anything I could source.

---

## 3. Geometry — the bands, and why there are bands at all

A pattern has no vertical anchor, so a ground floor and a mechanical crown cannot
be one extrusion with one tile. Each building is emitted as stacked bands, per
the `BANDS` list in `bake_stadium.py`. 17 features total.

```
Moody Center      plinth   0.00 → 8.31    dark bronze MCM + gate portals
                  fins     8.31 → 17.73   the fin screen
                  glass   17.73 → 22.16   the concourse ribbon
                  fascia  22.16 → 26.04   OVERSAILS the wall by 5.0 m
                  apron   26.04 → 26.45   the grey walk-on strip, roof colour
                  membrane 26.45 → 27.70  white TPO
                  cap     27.70 → 28.70   parapet

Health Transf.    podium   0.00 → 8.99  |  Health Disc.  podium  0.00 → 9.00
                  body     8.99 → 38.49 |                body    9.00 → 36.02
                  attic   38.49 → 46.10 |                attic  36.02 → 44.80
                  cap     46.10 → 47.10 |                cap    44.80 → 45.80
                  plant   47.10 → 50.60 |                plant  45.80 → 50.28
```

**Nothing was made taller.** Every band is a fraction of the `final_height`
already in the data and the topmost *wall* band ends exactly there. That is a
constraint, not modesty: `js/roofs.js` draws a measured roof deck for every core
building at `final_height + capLift`, covering the whole footprint. The first cut
of the bake raised a white membrane on a 14 m inset and stopped at
`final_height`, which left that deck with nothing under it over the whole ring
outside the inset — a pale slab hanging in the air, which would have read as a
broken layer rather than as the layer working exactly as written. The stepped
roof is therefore expressed *below* the deck datum. The plant screens are the one
thing above it, and they start **on** it, which is where a mechanical enclosure
actually sits.

The 5.0 m Moody oversail is measured off the nadir crop: the smooth apron outside
the Overture footprint runs 4.7 m on the west edge and 5.8 m on the south.

---

## 4. What the render harness measured

`node moody-check.mjs` — 16 assertions, all passing. These are **isolated
renders** of this module alone, which is the right way to ask "is my geometry
there and what colour is it" and the wrong way to ask "what changed on screen".
Section 4a is the second question.

| | Result |
|---|---|
| Moody roof planes, isolated | 17,358 px, mean luma 208.2 |
| Dell Med wall, isolated | 366 wall rows, **10 distinct luma levels**, p10 116 → p90 203 |
| Glazing grid | 21.1% against the measured 19.8%; reveal 5.3% against 5.6% |
| Night | precinct mean luma 182.5 day → **38.5** night, identical 21.0% coverage |

## 4a. What actually changed on screen — and one claim I had to retract

Matched frames, same build, same browser session, `?moody=0` against `?moody=1`,
day (p = 0.25), median of each region. The last row is an untouched neighbouring
building and it is there to say what the noise floor is.

| region | before | after | Δ luma |
|---|---|---|---|
| Moody roof | `#e7c392` 200.6 | `#dfbb8c` 192.6 | **−7.9** |
| Moody wall | `#7d5d34` 98.1 | `#775b34` 95.1 | −3.0 |
| Moody roof rim | `#e6c6a4` 203.9 | `#e7d0a8` 210.5 | **+6.6** |
| control (untouched building) | `#59553d` 83.6 | `#59563d` 84.2 | +0.6 |

**The retraction.** "Moody's roof renders as a dark lid and this pass makes it
white" was the headline I started with, and it is wrong. `rd` really is
`#434347` (luma 67) and the membrane really does measure [255,255,253], but the
rendered roof was **already pale** — it went 200.6 → 192.6, i.e. very slightly
darker. Two reasons, both of which were checkable before I wrote the claim: a
top face in this scene is lifted hard by the sun tint and exposure (an input at
luma 83 was already rendering near 200), and `js/roofs.js` covers most of that
roof with its own measured deck and 213 condensers. The isolated luma of 208.2
in §4 is a true measurement of my membrane and a **useless** measurement of the
change, and quoting it as the latter is exactly the "argued rather than
observed" failure `PASS_COMMON.md` opens with.

What this pass actually adds on the roof is the **stepped, oversailing apron
rim**: +6.6 luma and a visible light ring where there used to be a thin
red-brown parapet. On the walls it adds the band structure — the plinth, the
gate portal, the fin band and the glass ribbon are all separately visible in the
matched pair, which is the thing a single extrusion cannot have.

**Read the Dell Med pair as indicative, not measured.** Those two frames did not
fully settle inside the harness's 40 s cap (2,732 buildings in the `before`
frame against 3,071 in the `after`, and the road layer is present in one and not
the other), so a luma comparison between them would be measuring tile loading.
The banding claim for Dell Med rests on the isolated render in §4 instead, where
the frame is entirely ours.

## 4b. Frame cost

`node moody-perf.mjs 3` — headed, `index.html`, interleaved and counterbalanced,
minimum of the reps, dropped frames over a 4.2 s bearing sweep across the
precinct.

| config | dropped (MIN) | best fps | all reps |
|---|---|---|---|
| off | 152 | 22.9 | 152, 174, 164 |
| on | 138 | 27.7 | 178, 184, 138 |

**Delta −14 dropped frames against a within-config spread of 22 and 46, so there
is no measurable draw cost.** 17 features across four layers should not cost
anything and it does not; the negative sign is noise, not a speed-up.

The repaint path is the one that could have hurt, because it lands on the hour
slider, which quantises to 1/128:

```
applyMoodyColors (9 tiles)     2.30 ms
applyTimeOfDay  (whole hook)  32.70 ms   -> this pass is 7% of a time-of-day step
```

**Features added: 17** (14 wall/roof/plant bands + 3 parapet caps), **9 tile
images**, **3 generic extrusions removed**.

### The two things the repo's own docs disagreed about, now measured

**`fill-extrusion-pattern` is TILE-locked.** Counting window rows on one wall at
three zooms: 2.0 cycles at z15.6 → 8.5 at z17.6, a **ratio of 4.25**. World-locked
predicts 1.00; tile-locked predicts 4.00. `js/facades.js`'s header used to claim
world-locked and was flatly wrong; this is the direct measurement on a wall
rather than on the ground, which is what `pattern-scale.mjs` does.

**It is NOT vertically anchored to the extrusion base.** Swapping in a tile that
is white across its bottom eighth put **three** white stripes up a 27 m band, not
one. `PASS_COMMON.md` says a pattern "repeats from the extrusion base" and
`facades.js` says the vertical phase is uncontrollable; the second is right. Every
tile in `js/moody.js` is therefore vertically uniform, and all vertical hierarchy
comes from the band boundaries, which are geometry.

That measurement also sets the honest limit of the tile design. At the zooms this
app flies, one texel is 0.5–0.9 m of wall. Moody's fins are 0.30 m wide on a
0.39 m pitch — under half a texel — so **individual fins cannot be drawn**, and
drawing them anyway would assert a 1.4 m fin, which is a column. What is drawn is
the fin *field*: vertical striation at 2.8 m, the finest pitch that survives
camera motion. Same reasoning as `facades.js`'s refusal to draw brick coursing.

### One harness bug worth recording

The first run of `moody-check.mjs` reported **16 passes with the same code and a
different meaning**: `isolate()` was copied from `isolate.mjs`, which keeps the
`background` layer because it is a screenshot tool. Every measurement then
counted the whole 1280×800 frame — `n = 1,023,994` — and the roof-brightness
assertion passed at luma 160.9 by measuring the basemap's own fill. **It would
have passed with this entire pass deleted.** That is exactly the failure
`PASS_COMMON.md` records: a session spent "fixing" the basemap's grey buildings
because our own layer had silently failed to load. The fix is to hide the
background too, so MapLibre clears to transparent and alpha alone identifies our
geometry — plus a coverage ceiling assertion, so the same mistake fails loudly
next time instead of passing quietly.

---

## 5. Still missing

- **The visible delta is modest, and the numbers above are the honest size of
  it.** At the distance this camera flies, three buildings out of 2,453 gaining
  a band structure is a detail, not a transformation. The strongest single
  result of this pass is arguably not the buildings at all — it is the two
  measurements in §4 that settle a contradiction in the repo's own docs.

- **The wood soffit cannot be drawn at all.** 70,000 sq ft of curved
  wood-veneered soffit is the single most photographed thing about Moody Center
  and `fill-extrusion` renders no underside faces. All that is expressed is the
  warm bounce it throws onto the fascia, which grows toward golden hour and
  carries a warm edge at night.
- **Moody's roof is flat here and curves in reality.** The real envelope sweeps;
  `fill-extrusion` has no sloped faces. The stepped apron-and-membrane profile is
  the closest available approximation.
- **Moody's faceted plan is the Overture footprint**, which is an octagon close
  to the real one but does not carry the envelope's independent facet lines.
- **The glazed corner at the main entry is not modelled** — the plinth carries a
  repeating gate portal instead, so all four gates read the same.
- **Which stone goes on which Dell Med building is the weak claim** (§2).
- **The Dell Med podium is drawn at the tower footprint.** In the photographs it
  extends beyond the blocks above it; the snapshot has one polygon per building
  and no second ring to work from.
- **No night lighting authored for Moody beyond the concourse ribbon and the warm
  fascia edge.** A real arena on an event night is much more of an event than
  this.
- **`data/roofscape.geojson`'s clutter still draws on these three buildings**, and
  it should — it is measured. It was not re-baked against the new massing, so a
  few of its units sit on the attic band rather than on the plant screen.
