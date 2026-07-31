# DKR — Darrell K Royal–Texas Memorial Stadium: the reference

Everything the bake is built from, with a source for each line, so nobody has to
derive it twice. Written 2026-07-31.

**The instrument.** `scripts/fetch_dkr_reference.py` fetches an Esri World
Imagery nadir of the stadium **with its bbox recorded** into
`data/dkr_aerial_geo.json`; `scripts/probe_dkr.py` inverts that projection.
Result: **2915 × 2882 px at 0.1289 m/px**, and any feature in the photograph can
be read as a lon/lat and a size in metres.

That mattered. `data/dkr_aerial.png` was already in the repo and is a perfectly
good photograph, but nothing recorded the bbox it came from, and the only bbox
anywhere in the repo (`fetch_reference_imagery.py`) belongs to a different
target — projecting the stadium's own footprint through it puts the building
1.5 km outside the frame. An aerial you cannot georeference is a mood board.

Verification that the new one *is* georeferenced: projecting the footprint from
`buildings.detailed.geojson` onto it lands the outer ring on the building's outer
edge and the inner ring on the field apron, and reports **235.7 × 231.5 m**
against the data's own 236 × 232. See `scripts/verify/shots/ref-dkr-georef.png`.

---

## Measured off the photograph

| Thing | Value | How |
|---|---|---|
| Seat row pitch | **0.74 m** | 13–14 stripes per 10 m in `dkr-r-east-zoom.png`. The 30-inch row every US bleacher uses. |
| Aisle pitch | **~14 m** | stair spacing up the rake, east and west crops |
| Aisle width | **1.5–2 m** | same |
| Vomitories | **~5 × 3 m**, dark, sitting *on* the aisles | `dkr-r-east-zoom.png` |
| Clean deck | `#99968b`, **luma 149.5** | `probe_dkr.py box 1860 1420 1900 1460` |
| Stained deck | `#897968`, **luma 122.9** | `probe_dkr.py box 1800 1560 1840 1600` |
| **Deck contrast** | **luma SD 51.6, p10/p90 79/228** | same box. The number v1 missed entirely. |
| Staining pattern | irregular blotches **2–8 m** across | east and west crops |
| Decks per side | **three**, split by **two black slots 4–6 m wide** | `dkr-r-west.png` — the shadow under each overhang |
| Ramp towers | **four/five circular, ~14 m diameter** | `dkr-r-nwtower.png`; positions to 7 dp in `RAMPS` |
| Turf (through imagery) | `#54604d` | midfield box |
| End zone (through imagery) | `#846149` | north end zone box |

**On the two colour readings at the bottom:** those are the photograph's
exposure, not the material. The end zone is painted UT burnt orange `#BF5700`
and samples at `#846149`; the difference is haze, sensor and JPEG. So the
photograph is trusted for **structure and relative luminance**, and published
brand/material colours are used for **hue**. Saying that out loud is the point —
the readings are real, they are just not measurements of paint.

---

## Sourced, not measured

The Esri imagery **predates the 2021 south end zone**. Tested rather than
assumed: only **2,170 scattered burnt-orange pixels** in the south structure
against **17,516** in the painted north end zone — there is no Longhorn balcony
in that picture. So the south end is authored from published dimensions and is
labelled generative in the bake's provenance block.

| Fact | Value | Source |
|---|---|---|
| Capacity | 100,119 | [Wikipedia](https://en.wikipedia.org/wiki/Darrell_K_Royal%E2%80%93Texas_Memorial_Stadium) |
| Field | Earl Campbell–Ricky Williams Field; FieldTurf, reinstalled 2021 | ibid |
| Field markings | dark green turf; **burnt orange end zones** lettered TEXAS / LONGHORNS; orange border only **to the 20-yard lines**, not around the whole field; midfield Longhorn | [Burnt Orange Nation](https://www.burntorangenation.com/2021/7/15/22578565/field-turf-installation-texas-longhorns-darrell-k-royal-texas-memorial-stadium) + the aerial |
| **North end zone** | 2008, $149.9M, Heery International / Hensel Phelps. Brick blend matched to the older stadium *and* to the campus. "Radiused block walls on the pedestrian ramps … creates the angular expression seen from the exterior." | [Mason Contractors](https://masoncontractors.org/project/university-of-texas-darrell-k-royal-memorial-stadium-north-end-zone-expansion/) |
| North facade, actual | **chamfered red-brick piers** on a buff cast-stone base, bays between them **open and deeply shadowed** showing stacked concourse decks with green guardrails, occasional tall grey-mullioned glass, near-black cap band. **No punched window grid.** | Commons `DKR_new_north_end_2008-08-30.JPG` |
| **South end zone** | 2019–21, $175M, **Populous** / Hensel Phelps, 240,000 sq ft. First fully enclosed the bowl in 97 years. | [texaslonghorns.com](https://texaslonghorns.com/news/2018/9/20/football-populous-selected-to-design-175-million-south-end-zone-for-the-university-of-texas) |
| **Longhorn balcony** | **215 × 72 ft (65.5 × 21.9 m)**, custom UT Burnt Orange ALUCOBOND PLUS, ~900 mostly-tapered panels. First team logo ever carved into a seating bowl; **designed to be seen from the air**. | [ALUCOBOND](https://www.alucobondusa.com/blog/new-stadium-end-zone-stands-out-with-first-ever-seating-bowl-team-logo-clad-in-alucobond-plus/) |
| Entry towers | **two seven-storey**, "Rusted Metal" ALUCOBOND, "an almost suede-like appearance" | ibid |
| Cladding totals | 48,200 sq ft of 4 mm ALUCOBOND PLUS in three custom colours: UT Burnt Orange, Rusted Metal, Pure White | [Metal Construction News](https://www.metalconstructionnews.com/projects/darrell-k-royal-texas-memorial-stadium-austin-texas) |
| **Video board** | **55.85 × 134.38 ft = 17.0 × 41.0 m**, south end, 7,505 sq ft, 2.72M pixels | [Burnt Orange Nation](https://www.burntorangenation.com/football/2020/8/6/21357965/new-video-board-completed-as-part-of-texas-south-end-zone-project) |
| West side | **Bellmont Hall**, eleven levels, 1972, built *inside* the west upper deck's support structure. 72.5 m in our data. 8th-floor press box. | Wikipedia + `buildings.detailed.geojson` |
| Lighting | 1955: eight 100-ft towers. **2023–24: instant-start multi-colour LED — the whole stadium can go burnt orange.** | [Burnt Orange Nation](https://www.burntorangenation.com/2023/9/14/23873499/texas-longhorns-burnt-orange-led-lighting-dkr-stadium-wyoming) |
| Interior | orange chairback sections concentrated on the **club/middle deck**; dark fascia bands with white lettering; tall slim light masts above both upper decks | Commons `Darrell_K._Royal-Texas_Memorial_Stadium_March_2016.JPG` |

---

## Generative, and declared as such

- **All deck elevations.** No public source gives DKR's per-deck heights; the `DECKS`
  table in `bake_stadium.py` derives them as fractions of the 63 m already in the data.
- **Rake gamma**, the light-mast positions and count, the exact radial position of
  the Longhorn balcony within the south bowl, and the ramp-tower heights (those
  last estimated from the shadows they throw across the plaza).

---

## Still missing — the honest list

- **The two seven-storey south entry towers** and the "Rusted Metal" finish are
  not built. Only the balcony and the board are.
- **Vomitories** are not modelled. They are 5 × 3 m and clearly visible in the
  aerial, but ~120 of them across the bowl is a real feature-count question that
  has not been measured.
- **End zone lettering** (TEXAS / LONGHORNS) and the **midfield Longhorn** are not
  drawn. At 0.5 m per pixel from the flying camera the letters are ~2 px tall.
- **Fascia lettering** ("BIG 12 CHAMPIONS …") on the deck backs.
- **The war memorial plaza** paving north of the stadium, with its diamond
  medallion pattern, which is clearly visible in the aerial.
- **The north pedestrian bridge** linking the ramp towers along the north rim.
- **Statues** — Royal, Whittier, the Democracy figure over the north seats.
- The **staining** varies only radially, because a seating band is a full ring.
  The photograph's blotches vary in both directions.
