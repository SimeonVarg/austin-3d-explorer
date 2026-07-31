# PASS_TOWER — the UT Tower and the Main Building

Written 2026-07-31, against `docs/PASS_COMMON.md`.
Owns: `js/tower.js`, `scripts/bake_tower.py`, `data/tower.geojson`,
`scripts/verify/tower-*.mjs`, `shots/tower-*.png`.

---

## 0. What was actually there before

Worth stating first, because it is not what the brief assumed and it changes the
size of the job.

`data/snapshots/2026-07-30/buildings.detailed.geojson` has **one** feature for
this building: `name: "UT Tower"`, id `a0af80df-5ca8-4408-ba74-2817533dae1a`,
`final_height: 94.0`, `building_class: "university"`, 25 vertices, 79.5 × 87.2 m.
There is no separate "Main Building", and the wings are not separate features —
that footprint **is** the whole complex. In OSM it is way/27397894, tagged
`name=Main Building`, `loc_name=The Tower`, `roof:shape=quadruple_saltbox`.

It also carries `has_parts: 1`, and `js/app.js`'s `NO_PARTS` filter drops every
such building from `buildings-3d` and `buildings-roof`. So that footprint was
**not being drawn at all**. What rendered was two OSM `building:part`s out of
`parts.detailed.geojson`:

| part | h | base | plan | what it is |
|---|---|---|---|---|
| way/516187631 | 94.0 | 0 | 22.56 × 20.84 m | the tower shaft |
| way/516187635 | 12.8 | 0 | 44.5 × 24.6 m | one low block south of it |

Two more checks, because "the roofs are already handled" was worth being sure
about: **nothing** in `data/roofscape.geojson`, `data/roofscape.detail.geojson`
or `data/roofs.geojson` falls inside this footprint. `js/roofs.js` is excellent
and gives this building nothing, for the same `has_parts` reason.

So the before state is: a plain 94 m box wearing the generic office-tower window
grid, one low slab, and **no Main Building at all** — no wings, no arcade, no
red barrel tile. Every red roof in this pass is new.

---

## 1. Reference table

`m/px` columns are the scale used to read that photograph; the derivation is in
§2. All heights are metres above the footprint's own grade (the app's datum),
not above the South Mall, which is ~5 m lower.

### The Tower

| fact | value | source |
|---|---|---|
| Architect, completion | Paul Philippe Cret, 1937 | Wikipedia, tower.utexas.edu, guidetoaustinarchitecture.com |
| Height | 307 ft = 93.6 m; the data says 94.0 and this pass uses 94.0 | Wikipedia; every source repeats 307 ft |
| Levels | 29 (`building:levels=29` on the OSM part); "17 relatively plain stories supporting clock tower section" | OSM way/516187631; guidetoaustinarchitecture.com |
| Structure / cladding | steel frame clad in Bedford, Indiana limestone | jimnicar.com "How Texan is the UT Tower?"; tower.utexas.edu |
| Shaft plan | **22.56 × 20.84 m** | OSM way/516187631, cross-checked against z20 nadir |
| Floor-to-floor | **3.46 m** | gold spandrel pitch measured at 40.65 px in `main_2014`, × 0.0851 |
| Facade system | **punched openings in masonry, and barely that.** Three narrow vertical window slots per face, 1.42 m wide on a 4.05 m pitch, recessed in a channel; everything else is blank ashlar. Glazing ≈ **8%** | measured off `closeup.jpg` (CC0) and `main_2014.jpg` |
| Slot contents | alternating dark glass and gilt-bronze spandrel panels, one pair per floor | `closeup.jpg` at full resolution |
| Shaft top | 66.3 m | silhouette, `main_2014` |
| Bracketed cornice | 66.3 → 70.1 m, plan × 1.026 | silhouette |
| Clock / observation stage | 70.1 → 78.2 m, plan × 0.860 | silhouette |
| Clock faces | four, one per elevation. Dial **3.66 m (12 ft)**, gilt bezel **5.60 m**, centre **74.6 m** | "the clock's four faces measure 12 feet across" (texasmonthly/tower.utexas.edu); measured independently at **12.5 ft** — see §2 |
| Belfry | 79.2 → 89.4 m, plan × 0.491 → 11.1 × 10.2 m. Open colonnade: four square corner piers, **four Doric columns per face** grouped 2 + 2 around a wide central opening | counted off a 5× enlargement of `elev_tall.jpg`; "Simple Doric columns … enclosed … the belfry" (jimnicar) |
| Carillon | 56 bells, largest in Texas — the dark chamber behind the colonnade | tower.utexas.edu |
| Belfry entablature | 89.4 → 90.7 m, plan × 0.521. Carries the gold-leaf garland cartouches | silhouette; guidetoaustinarchitecture.com |
| Cap | 90.7 → 92.4 (plan × 0.449), then 92.4 → 94.0 (× 0.362), verdigris copper roof | silhouette; the green is visible in `elev_tall.jpg` |
| Masts | present, **not drawn** — 0.1 m of steel is a tenth of a pixel at flying altitude | — |
| Limestone, sampled | (208, 195, 177) ≈ `#d0c3b1` after illuminant correction | median of the shaft's blank piers in `main_2019_38.jpg` (overcast), corrected against that photo's own sky |

### The Main Building

| fact | value | source |
|---|---|---|
| Style | Spanish Colonial Renaissance / Beaux-Arts, red barrel tile roofs, deep arcades | guidetoaustinarchitecture.com; visible |
| Levels | 4 (`building:levels=4` on OSM way/516187635) — but they are monumental | OSM |
| Rusticated arcade storey | 0 → 6.8 m, ~9 arch bays across the south front | `main_2019_38.jpg`, scale in §2 |
| Piano nobile | 6.8 → 17.2 m — a **double-height** storey (the Life Science Library reading room) | ditto |
| Entablature + balustrade | 17.2 → 20.2 m, carrying "YE SHALL KNOW THE TRUTH…" | ditto |
| Attic loggia | 20.2 → 24.4 m, openings on a red-brown ground behind balusters | ditto |
| Tile roof | eave **24.4 m**, ridge **29.0 m** → 31° pitch. Spanish tile | ditto; "red roof tiles produced in Spain" (tower.utexas.edu) |
| Massing | three tile-roofed arms — west wing, east wing, south block — around a **lower** middle that stops at 20.2 m, plus two low terraces (9.2 m) flanking the south entrance | z20 Esri nadir, classified by colour on a 1 m grid |
| Tower position | **not central.** The shaft sits at the north edge, between two open light courts, at u −17.6…+4.9 in a footprint spanning −39.5…+33.2 | the footprint's own north notches |
| Cladding | also Bedford, Indiana limestone; Austin shell stone frames the loggia doorways; Cordova shell and cream limestone around the Tower | jimnicar; Grokipedia summary of the same |

### Night — the sourced convention

`tower.utexas.edu/lighting` lists **seven** configurations:

| configuration | means |
|---|---|
| White | the everyday state |
| White with orange top | football regular-season and bowl wins |
| Orange | academic achievement, UT's birthday, Commencement, Texas Independence Day, conference championships |
| **Orange with No. 1** | **national championship** ← this pass builds this one |
| Orange with special effects | fireworks, class years |
| Darkened with white cap | UT Remembers and other solemn occasions |
| Dark | Earth Hour |

"Orange with No. 1" is the one the brief asked for and the only one with a
numeral. UT's brand burnt orange is `#BF5700`, and floodlit limestone is not
that: sampled off two night photographs it is a much deeper red-orange, brighter
on the crown where the floods are close and falling off up the shaft. Both
photographs are clipped in green and blue, so the hexes used
(`#8e2c10` shaft, `#a63f14` cornice, `#b7511a` crown) are pulled back toward the
warm side of what the sensor recorded rather than copied off it. **The Main
Building is not floodlit** and stays dark, which is both what the photographs
show and what makes the tower read.

The numeral: the shaft has exactly three window columns per face, and that is
exactly enough to write a 1 — centre column full height, all three across the
bottom as the base serif, two cells in the left column near the top as the flag.
That is what the real thing does, because it has no other choice either.

### Photographs used

All from Wikimedia Commons, reference only — none ship in the app.

| file | licence | used for |
|---|---|---|
| `University of texas at austin main building 2014.jpg` | CC BY 4.0 | the primary rectified south elevation: crown heights, silhouette widths, clock, floor pitch |
| `University of Texas at Austin August 2019 38 (Main Building).jpg` | CC BY-SA 4.0 | long-lens cross-check, Main Building heights, neutral-light colour |
| `UT Tower, University of Texas in Austin.jpg` | CC BY-SA 4.0 | the belfry colonnade at 5× |
| `University of Texas at Austin Tower Closeup.jpg` | CC0 | the window slots and the gilt spandrels |
| `UT-Tower-BurntOrange.jpg`, `UT tower lit entirely in orange.jpg` | CC BY 2.0 | the night state and the numeral |
| Esri World Imagery z19/z20 nadir | — | plan, roof classification, the three-arm massing |

---

## 2. How the numbers were derived, and the two checks that passed

The playbook's rule is *derive the rule, then verify it reproduces every example
before you draw*. Two independent checks were available here and both were run.

**The scale.** `main_2014.jpg` is a perspective-corrected elevation, so for any
plane parallel to the image plane the horizontal and vertical scales are equal.
The tower shaft measures **265 px** and is **22.56 m** from OSM ⇒ **0.0851 m/px**
on the tower plane. Everything on the tower is read with that one number.

**Check 1 — the clock dial.** At 0.0851 m/px the dark dial measures 45 px =
3.82 m = **12.5 ft**, against a sourced *"the clock's four faces measure 12 feet
across"*. The gilt bezel around it measures 5.6 m (18.4 ft), which is why a
casual eyeball of "the clock" comes out at twice the quoted figure. Two numbers
that were derived completely separately agree to 4%.

**Check 2 — the crown, in a second photograph.** `main_2019_38.jpg` is a
long-lens shot from ~480 m down the South Mall, a different lens and a 4× smaller
image scale. Shaft = 64.2 px ⇒ 0.3514 m/px. The crown (plain shaft top → top of
the cap) measures **28.4 m** there against **27.7 m** in `main_2014` — 2.5%
apart. The crown is 29% of the tower's height in both.

**The Main Building's heights** needed a two-plane solve, because its south front
is 47 m nearer the camera than the tower's south face and therefore renders at a
different scale in the same photograph. Using the long-lens shot (where the plane
correction is only ~9%): `f/D_tower` = 265/22.56 = 2.846 px/m, so
`f/D_main` ≈ 3.1 px/m; grade to eave measures 75 px ⇒ **24.0 m**, grade to ridge
90 px ⇒ **28.8 m**. Rounded to 24.4 / 29.0. Bounding the camera distance between
350 m and 700 m moves the eave only between 23.2 and 24.7 m.

The same solve falls out self-consistently: it puts the camera **4.65 m below**
the Main Building's grade, which is exactly right for a photograph taken from
down the South Mall, and it is the reason an earlier attempt using the
close-range wide-angle photograph produced an absurd 41 m ridge. **A single 2D
projection lies about depth**, and this building has two facade planes 47 m
apart in every frontal view of it.

**What I did not resolve.** The belfry's column *spacing* is irregular in the
photographs — the four columns per face group 2 + 2 with a wide centre — and the
exact centres could not be read reliably at 1-2 px. The grouping is reproduced;
the spacing within it is regularised. At the altitude this app flies a belfry
column is 2 px, so this is the one crown number I would call semi-generative.

---

## 3. Why it is geometry and not texture

Two measured properties of `fill-extrusion-pattern`, both already in
`docs/PASS_COMMON.md`, decide almost everything here.

**No vertical anchor.** A pattern repeats from the extrusion base with no idea
where the top is, so a cornice drawn "at the top" appears every ~40 m up the
shaft. The Tower is *nothing but* vertical events. Everything is therefore
stacked bands — nine on the tower, six on the Main Building — each its own
feature with its own base, height, colour and pattern, exactly the shape of the
`BANDS` list in `scripts/bake_stadium.py`.

**Tile-locked, not world-locked.** A 64 px repeat covers ~30 m of wall at tile
zoom 17 and ~59 m at 16, and it never aligns to a building corner. The shaft has
**three** window slots on a 22.56 m face; no tile can say "three". So the slots
are prisms standing 0.30 m proud of each face — and so are the belfry colonnade,
the four clock faces, and the windows that light the numeral.

That leaves the tiles doing the one thing a tile is good at: material. **Every
pattern in `js/tower.js` varies only in x** — vertical strips and per-block value
scatter, constant down the tile. An x-only pattern cannot produce a horizontal
band, so it cannot produce the parking-deck read that `js/facades.js` documents,
and it has no anchor to get wrong. Block-to-block value scatter is at a 4 px
cell ≈ 2-4 m, which is one ashlar block face; real ashlar coursing is 0.2-0.3 m,
well under one texel, and drawing it anyway would assert half-metre coursing.

Consequence worth stating: **the `fill-extrusion-vertical-gradient` is off on all
three layers.** With nine stacked bands it would draw a dark seam at each of the
eight boundaries, and the 1.0 m belfry plinth would fall entirely inside its own
gradient and render black.

---

## 3b. Four things the render corrected that the reference did not

Every one of these looked right in the source and wrong on screen. They are the
reason the harness exists.

**The roofs were a pale salmon island.** `docs/PASS_COMMON.md` says to enter roof
colours COOL, because an extrusion's top face picks up the sun tint. Taken
literally that gave `#a5766a` (R/B 1.56). Rendered and sampled, it came back at
**R/B 2.36 against 4.3-4.7 for every other campus roof in the same frame** — the
Main Building was pink in a sea of terracotta. Measured over this range the
transform is about R/B_out = 1.4 x R/B_in, so landing beside the neighbours
needs an input near R/B 3.3, which is exactly the `rd`/`rg`/`rn` trio the
snapshot already carries for this building. The rule of thumb was right about
the direction and wrong about the magnitude, and only a pixel sample could say
which.

**The south front read as corduroy.** Arcade, piano nobile and attic loggia are
all vertical rhythms at a similar pitch, stacked. The entablature band between
them was only 8% lighter than the walls and did not separate them, so the whole
elevation was one sheet of stripes. It is now pushed well brighter — a bright
horizontal datum is what the real cornice does, and it is the only thing on that
elevation that is not vertical.

**The floodlit tower was not the brightest thing at night.** The night hexes were
sampled off two photographs and came out at roughly the luma of the unlit city
around them — an orange building, not a landmark. Raised until it is
unambiguously the brightest object in a night frame, which is what a photograph
of the real thing shows.

**The clock read as a hole.** At the true 3.66 m the dark dial left the gilt
bezel about one pixel wide from a flying camera. The dial is drawn at 3.05 m so
the ring gets the pixels. It is the one measurement in this pass that is
knowingly wrong, and it is wrong on purpose.

**A pattern image IS a colour, so it cannot be shared by two palettes.** Found by
re-reading the module rather than by looking, which is why it is worth writing
down. The first cut let the drawing family name *be* the image id. Seven bands
use the plain-ashlar family — the Main Building's entablature and its two
terraces, then the tower's cornice, clock stage, belfry plinth, belfry
entablature and cap — and `js/tower.js` builds each image from the **first**
feature it sees carrying that id. So the entire crown inherited the Main
Building trim's palette. By day that was invisible (`#e7ddc9` against
`#ddd2c0`); at night the trim is unlit `#12101c` and the crown is floodlit
`#dd6420`, so **the top 28 m of the Tower went dark in the one shot the night
state exists for**. The bake now allocates one image per (family, *whole trio*)
— `twplain`, `twplain2`, `twplain3` — and keying on the day hex alone was not
enough either, because the cornice and the crown share a daylight limestone and
differ only under the floods. `tower-check.mjs` asserts no id carries two
palettes.

And two things the harness itself got wrong, recorded because the next person
will hit them:

- The silhouette test isolates the tower and measures its width per scanline.
  Keying on "not sky" reported the shaft as **1440 px wide** — the whole
  viewport — because with every other layer hidden the basemap's tan
  `background` is not sky either. Painting the tower magenta, which
  `scripts/verify/README.md` already tells you to do, fixed it in one line.
- The night sample raced the atlas repaint and once read a **fully daylit frame**
  at p = 0.95, reporting 1 orange pixel — which reads as "the night state is
  broken" rather than "the harness was early". It now reads twice and trusts the
  second, and asserts the frame is actually night before asserting anything
  about it.

---

## 4. What this emits

225 features, 69.6 kB.

| kind | n | what |
|---|---|---|
| `wall` | 16 | the nine tower bands and the six Main Building bands, plus the bell chamber |
| `roof` | 9 | three tile-roofed arms × three stepped hip facets |
| `post` | 20 | four belfry corner piers + four columns on each of four faces |
| `slot` | 12 | three window channels on each of four faces |
| `win` | 144 | 3 columns × 12 rows × 4 faces. Dark glass by day; at night 4 of every 9 are the numeral |
| `clock` | 24 | four faces × (five bezel slabs + one dial) |

Layers: `tower-wall` (patterned bands), `tower-solid` (roof facets and flat
colour), `tower-detail` (slots / windows / columns / clock, held back to
z14.6 — below that they are sub-pixel and pure overdraw).

Every Main Building mass is a **clip of the real footprint** against an
axis-aligned box in the building's own rotated frame (4.915° off north), not a
hand-drawn rectangle, so no band can escape the building's outline and the
pieces tile it exactly.

---

## 5. Integration

- `data/tower.geojson` declares `replacedBuildingIds: [a0af80df-…]`, filtered out
  of `buildings-3d` and `buildings-roof` the way the stadium does it. Today that
  is belt and braces (the feature already carries `has_parts`), but a future
  bake that stops emitting building:parts would otherwise drop a 94 m grey box
  back inside all of this.
- The two OSM parts also have to stop drawing, and they are the awkward half:
  `parts.detailed.geojson` properties are `{h, base, wd, wg, wn, rd, rg, rn}`
  and carry **no id**. They are matched on wall colour `#e5dbc2`, which the bake
  writes into the geojson as `replacedPartWallColour`. Checked: across all five
  snapshots on disk those are the only two parts with that colour, and the only
  other feature anywhere carrying it is a building called "The G", which has no
  parts and so never appears in that document.
- `js/tower.js` self-boots (the `boot()` from `js/outer.js`), waits for
  `buildings-3d` **and** `parts-3d`, wraps `window.applyTimeOfDay`, and anchors
  to the first symbol layer *after* `buildings-3d`.
- No HTML was touched. No file owned by another pass was touched.

---

## 5b. Verification

```bash
python -m http.server 8151 --bind 127.0.0.1        # from the repo root
cd scripts/verify
VERIFY_URL=http://127.0.0.1:8151 node tower-check.mjs   # 18 assertions
VERIFY_URL=http://127.0.0.1:8151 node tower-shot.mjs tower both
VERIFY_URL=http://127.0.0.1:8151 node tower-perf.mjs 4
```

Serve on a port nobody else is using. Six passes were running against this repo
at once while this was written, and `scripts/verify/README.md` already records
what happens when three of them share 8099.

`tower-check.mjs` measures the **silhouette**: everything else hidden, the tower
painted magenta, and the run of key-coloured pixels counted per scanline.
Measured profile, crown to shaft:

```
76 80 81 82 | 95 99 103 106 107 108 110 112 113 115 117 | 165 170 175 178 181 184 187 189 187
```

Cap, belfry, clock stage — two abrupt setbacks, and shaft/cap = **2.46×**. A
single prism gives one width and a ratio of 1.00. It also asserts belfry/shaft =
0.44 and cap/shaft = 0.41 (against 0.49 and 0.45 in plan; the crown reads ~10%
narrow because it is further from a camera looking up).

Two assertions had to be rewritten to test the right thing, and both are worth
knowing about:

- **`applyTimeOfDay` is wrapped** — was checked by looking for the `__tower`
  marker this module puts on its wrapper. Six modules wrap that global and each
  wraps whatever it found, so the marker is only visible on whichever wrapped
  *last*. The assertion therefore passed or failed depending on the load order
  of the **other five passes**. It now drives the global at two hours and
  asserts this layer's paint changed.
- **The two superseded parts** were counted with `querySourceFeatures`, which
  answers only for tiles the renderer currently holds and returned 0 from two
  different camera poses. It now reads the snapshot over HTTP and asserts that
  exactly two features carry `#e5dbc2` — which is the property the filter
  actually depends on, and the only line that would notice a future snapshot
  giving that hex to a third part.

### Frame cost

Interleaved A/B on one build (`?tower=0` equivalent, layers toggled),
counterbalanced on alternate reps, **minimum of 4 reps**, dropped frames over
4.2 s of scripted bearing sweep, headed Chrome:

| config | dropped (MIN) | all reps |
|---|---|---|
| before | 189 | 200, 199, 189, 211 |
| bands + roofs only | 184 | 192, 193, 200, 184 |
| after (everything) | 187 | 199, 187, 198, 215 |

**No measurable cost.** The deltas are −5 and −2 frames against within-config
spreads of 16 and 28 — smaller than the noise, which by this suite's own rule
means there is no result. That is the expected answer for 225 features added to
a scene already carrying ~12,000 trees, ~6,000 props, 12,058 roof features and a
7,625-building outer ring.

The absolute numbers (12-15 fps, ~190 dropped in *every* configuration including
`before`) are meaningless: five other headless Chrome instances were driving the
same GPU. The A/B is still valid — same machine, same build, interleaved and
counterbalanced — but only as a delta.

---

## 6. Honest list of what is missing

- **The arcade is a texture, not an opening.** The south front's nine arched
  bays are drawn as dark vertical strips at their real 6.3 m pitch. They read as
  an arcade from the air; they are not modelled as arches, and there is no
  ground-floor depth.
- **The hipped roofs are three stepped facets**, not slopes, because
  `fill-extrusion` has exactly one roof shape. They read as a pitch from 200 m
  and as a ziggurat from 30 m. Same trade `scripts/bake_roofs.py` makes.
- **The clock is a stack of five slabs**, because a vertical disc is not
  something a vertically-extruded polygon can be. The dial stands *proud* of its
  bezel rather than recessed inside it, which is geometrically backwards and
  invisible at any altitude this app flies — and it is drawn at 3.05 m rather
  than its true 3.66 m so the gilt ring survives at flying distance.
- **The bracketed shaft cornice does not read as a setback.** It is emitted at
  its measured 1.026 plan scale, but 0.3 m of projection is under three pixels
  from the flying camera and is swamped by the perspective growth inside the
  band below it. `scripts/verify/tower-check.mjs` measures two abrupt silhouette
  steps, not three, and that is the honest number.
- **The belfry column spacing is regularised** — see §2.
- **The masts on top are not drawn.**
- **The two north light courts are open to the sky** in the footprint, so the
  bake leaves them empty. In reality there is lower building in them.
- **The Main Building's north elevation is inferred**, not measured — I found no
  usable photograph of it. Its bands are the same as the south's.
- **The lighting state is fixed.** "Orange with No. 1" is hard-coded as the night
  appearance; the other six configurations in the sourced convention are not
  selectable.
- **The Tower and the Main Building are given different stone tones**, and that
  is an authored decision, not a claim about the material — both are Bedford
  Indiana limestone. The split stands in for a difference the renderer cannot
  express: the Tower is a clean prism taking full sky, the Main Building's walls
  sit under a 1.5 m tile eave behind a loggia over a rusticated arcade.
