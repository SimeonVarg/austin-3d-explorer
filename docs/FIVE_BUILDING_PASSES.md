# Five parallel building passes — paste one block per session

Written 2026-07-31, alongside the DKR pass running in the main session.

Each block below is **standalone and paste-ready**. Copy ONE block per session. They are
designed to run at the same time as each other and at the same time as the DKR pass
without colliding: every pass owns a disjoint set of files, and the `<script>` tags for
all five modules are **already committed** to `index.html` and `_harness.html` pointing
at stubs, so no pass ever has to touch either HTML file.

| # | Pass | Slug | Buildings |
|---|---|---|---|
| 1 | **The Tower** | `tower` | UT Tower + Main Building |
| 2 | **West Campus towers** | `westcampus` | The ten student high-rises |
| 3 | **The Drag** | `drag` | PCL, Gregory Gym, Texas Union, Co-op, Guadalupe streetwall |
| 4 | **Arts corridor** | `arts` | Blanton, Kelly's *Austin*, Ransom Center, Bass, LBJ Library |
| 5 | **Modern east** | `moody` | Moody Center + the Dell Med health district |

**Taken, do not touch:** DKR Memorial Stadium and everything in `data/stadium.geojson`
(main session), the Texas Capitol (`js/capitol.js`, already authored), Union on 24th
(`js/union24.js`, done — use it as the quality bar).

---

## 1 — THE TOWER

```
Read docs/PASS_COMMON.md first, in full. It is the shared brief for this pass: the app,
the reference method, the rendering traps, the integration contract, and the verification
rules. Everything in it is mandatory and every rule in it is a bug that already shipped.

YOUR TARGET: the UT Tower and the Main Building it rises from.
In data/snapshots/2026-07-30/buildings.detailed.geojson: name "UT Tower",
final_height 94.0, building_class "university". Check whether the Main Building's wings
are the same feature or separate ones and handle whichever is true.

This is THE icon. If one building carries the whole flyover it is this one, and it is
currently a plain 94 m extrusion wearing a generic office-tower window grid. It should be
the best-looking object in the scene.

WHAT MAKES IT ITSELF — go and source all of this, do not take my word for any of it:
  - Paul Cret, 1937. Indiana limestone over a steel frame, on a Main Building base of a
    different, warmer stone. The tower and the base are NOT the same colour — get both.
  - The shaft is not one prism. It steps: a broad Main Building mass, then setbacks, then
    the shaft, then the belfry. The setbacks are most of what makes the silhouette read.
  - The crown: an open colonnaded belfry with a stepped cap above it. Find out how many
    columns per face and how tall the belfry is relative to the shaft. This is the part
    that photographs, and getting it wrong is the difference between "the Tower" and "a
    tower".
  - Four clock faces near the top, one per elevation. Get their diameter and their height
    above grade. They are drawable as a face on the wall band that contains them.
  - The Main Building's wings: Spanish Colonial Renaissance, red barrel tile roofs, deep
    arcades, cream limestone. Those red roofs are a huge colour event from the air and
    js/roofs.js may or may not already be giving them one — check what it currently does
    before you author anything on top of it.
  - NIGHT LIGHTING IS A FREE MONEY SHOT AND YOU MUST BUILD IT. The Tower floods burnt
    orange for wins and full orange for a national championship, with a lit numeral in
    the windows. Find the actual convention, pick one state, and make it the night
    appearance. UT's official burnt orange is #BF5700 — but sample what the floodlit
    limestone actually looks like in a night photograph, because lit stone is not the
    brand hex.

THE HARD PART, and read the trap section of the common brief before you fight it:
a wall pattern has NO vertical anchor, so you cannot put a cornice "at the top" — it
appears every ~40 m up the shaft. The Tower is nothing but vertical events: base, shaft,
setbacks, clock band, belfry, cap. So this building must be emitted as STACKED GEOMETRY
BANDS, each its own feature with its own base, height, colour and pattern. Copy the BANDS
list in scripts/bake_stadium.py. If you take one thing from this prompt, take that.

YOU OWN, and may create or edit freely:
  js/tower.js  scripts/bake_tower.py  data/tower.geojson  docs/PASS_TOWER.md
  scripts/verify/tower-*.mjs  shots/tower-*.png
js/tower.js already exists as a stub and is already loaded by index.html and
_harness.html. Do not touch either HTML file. Do not touch js/app.js, js/facades.js,
js/ground.js, js/roofs.js, or any file belonging to another pass.

ESCALATE TO SIMEON ONLY IF: the belfry/crown geometry has two defensible readings from
the references and you cannot resolve it. Render both side by side as ONE labelled image
and ask. Every other call — colours, band heights, tile design, night convention — is
yours to make. Make it, then report what you decided and why.

DELIVERABLE: a branch and a PR, per section 6 of docs/PASS_COMMON.md.
```

---

## 2 — WEST CAMPUS TOWERS

```
Read docs/PASS_COMMON.md first, in full. It is the shared brief for this pass: the app,
the reference method, the rendering traps, the integration contract, and the verification
rules. Everything in it is mandatory and every rule in it is a bug that already shipped.

YOUR TARGET: the West Campus student high-rise cluster. By name in
data/snapshots/2026-07-30/buildings.detailed.geojson, with final_height:

  Dobie Twenty21 82.0 | 21 Rio 73.5 | Signature 1909 64.3 | The Callaway House 62.5
  The Castilian 60.0 | Ion Austin 59.1 | Skyloft Austin 57.9 | Moontower 57.3
  Inspire on 22nd 56.4 | Cambridge Tower 55.0

Union on 24th (97.5 m) is ALREADY DONE in js/union24.js — do not touch it, but read it,
and treat it as the quality bar you have to match.

WHY THIS PASS MATTERS MOST FOR MOTION: this is where the camera actually flies. Ten
towers of the same generation, all currently wearing the same generic window grid, is the
single largest area of "generic" left in the scene.

WHAT MAKES THESE BUILDINGS THEMSELVES — source it, per building:
  - THE PODIUM. Almost every one of these is four to seven levels of structured PARKING
    at the base with the residential tower set on top of it, and usually ground-floor
    retail on the street side. That is a completely different facade from the tower above
    — open horizontal decks with a spandrel edge, not windows. Getting the podium right
    is probably the single biggest win available in this pass, and js/facades.js already
    has a parking-deck pattern family ("dk") whose look is correct for it.
  - BALCONIES. These are student apartments and most have projecting or recessed
    balconies on a regular bay rhythm. A balcony is real geometry, not a texture, and it
    is the thing that most reads as "apartments, not an office block" from the air.
    Recessed ones you can fake with a dark inset panel; projecting ones want a thin
    extruded slab. Decide per building from photographs.
  - THE AMENITY DECK. The podium roof is usually a pool deck — a large pale slab with a
    pool, furniture and a shade structure, sitting well below the tower top. It is highly
    visible from a 60-75 degree camera and nothing in the scene has one yet.
  - THE CROWN. Each of these has a different top: parapet, mechanical penthouse, a lit
    sign, a stepped cap. This is what distinguishes ten towers from one tower repeated
    ten times.
  - Facade system and colour, per building. They are NOT all the same. Some are stucco
    and fibre cement panel, some are brick veneer, some are a mixed panel system with
    accent colour bands. Sample the hexes off photographs.

THE HARD PART, and read the trap section of the common brief before you fight it:
a wall pattern has NO vertical anchor, so "parking at the bottom, apartments above" is
impossible to express as one extrusion with one tile — the parking texture would repeat
all the way to the roof. Which, until yesterday, is EXACTLY the bug this whole project
had: every building in Austin was drawing the parking-deck texture. Emit each tower as
STACKED GEOMETRY BANDS — podium, tower, crown — each its own feature with its own base,
height, colour and pattern. Copy the BANDS list in scripts/bake_stadium.py.

Derive ONE parameterised system with per-building values in a table, not ten hand-drawn
buildings. Uniform primitives are the null hypothesis; variation lives in the parameters.

YOU OWN, and may create or edit freely:
  js/westcampus.js  scripts/bake_westcampus.py  data/westcampus.geojson
  docs/PASS_WESTCAMPUS.md  scripts/verify/westcampus-*.mjs  shots/westcampus-*.png
js/westcampus.js already exists as a stub and is already loaded by index.html and
_harness.html. Do not touch either HTML file. Do not touch js/app.js, js/facades.js,
js/union24.js, or any file belonging to another pass.

ESCALATE TO SIMEON ONLY IF: you cannot get usable photographic reference for three or
more of the ten and would have to invent them. Everything else — the parameter schema,
balcony treatment, podium depth, crowns, colours — is yours. Decide, then report.

DELIVERABLE: a branch and a PR, per section 6 of docs/PASS_COMMON.md.
```

---

## 3 — THE DRAG

```
Read docs/PASS_COMMON.md first, in full. It is the shared brief for this pass: the app,
the reference method, the rendering traps, the integration contract, and the verification
rules. Everything in it is mandatory and every rule in it is a bug that already shipped.

YOUR TARGET: the student heart of campus, on and just off Guadalupe.
  - Perry-Castaneda Library (PCL)
  - Gregory Gymnasium
  - Texas Union
  - University Co-op
  - the Guadalupe Street retail streetwall between roughly 21st and 24th

Find these by name in data/snapshots/2026-07-30/buildings.detailed.geojson; some of the
small retail will be unnamed and you will have to select it geographically.

WHAT MAKES THESE THEMSELVES — source all of it:
  - PCL is the contrast note: 1970s brutalism, precast concrete, deep vertical fins and
    recessed slot windows, and a footprint people claim resembles the state of Texas —
    check that against the actual polygon before repeating it. Its facade is mostly
    SOLID, which is the opposite of what the generic tall-building grid gives it now.
    Its top-floor band differs from the shaft. Get the fin pitch off a photograph.
  - Gregory Gym and the Texas Union are 1930s campus vocabulary: brick and cast stone,
    arched openings, red barrel tile roofs, Cret-era detailing. They share a language
    with the Main Building, so derive that vocabulary ONCE and apply it — it is the same
    system the Tower pass is deriving, and if your two answers disagree the campus will
    look wrong.
  - The Co-op and the Guadalupe streetwall are LOW retail, two to four storeys: shopfront
    glass at the ground floor, solid or lightly punched above, signage, awnings, flat
    parapets. Right now they are getting the generic low-rise treatment, which puts
    residential-looking windows on the ground floor of a bookstore. A shopfront is a
    single tall glass band with a solid bulkhead under it and a sign band over it.
  - Guadalupe is a real street with a real streetwall. What sells it is the CONTINUITY —
    a run of different small buildings with a shared datum line and varied parapet
    heights.

THE HARD PART, and read the trap section of the common brief before you fight it:
a wall pattern has NO vertical anchor, so a ground-floor shopfront that differs from the
floors above is impossible to express as one extrusion with one tile — it repeats every
~40 m up. For the low retail this matters MORE than for the towers, because a 3-storey
building is almost entirely ground floor. Emit these as STACKED GEOMETRY BANDS — a
shopfront band and an upper band — each its own feature. Copy the BANDS list in
scripts/bake_stadium.py. That single change is most of this pass.

YOU OWN, and may create or edit freely:
  js/drag.js  scripts/bake_drag.py  data/drag.geojson  docs/PASS_DRAG.md
  scripts/verify/drag-*.mjs  shots/drag-*.png
js/drag.js already exists as a stub and is already loaded by index.html and
_harness.html. Do not touch either HTML file. Do not touch js/app.js, js/facades.js,
js/ground.js, or any file belonging to another pass.

COORDINATION: the Tower pass is deriving the same 1930s campus vocabulary for the Main
Building. Write yours down in docs/PASS_DRAG.md with sources so the two can be
reconciled at merge; do not try to share code across the passes.

ESCALATE TO SIMEON ONLY IF: the extent of the Guadalupe streetwall is genuinely
ambiguous — i.e. you cannot tell which unnamed footprints are in scope. Show him one
labelled overhead render with your proposed selection highlighted. Everything else is
yours to decide.

DELIVERABLE: a branch and a PR, per section 6 of docs/PASS_COMMON.md.
```

---

## 4 — ARTS CORRIDOR

```
Read docs/PASS_COMMON.md first, in full. It is the shared brief for this pass: the app,
the reference method, the rendering traps, the integration contract, and the verification
rules. Everything in it is mandatory and every rule in it is a bug that already shipped.

YOUR TARGET: the arts and presidential precinct on the east side of campus.
  - Blanton Museum of Art, including the 2023 Snohetta plaza structures
  - Ellsworth Kelly's "Austin"
  - Harry Ransom Center
  - Bass Concert Hall
  - LBJ Presidential Library

Find them by name in data/snapshots/2026-07-30/buildings.detailed.geojson.

WHY THIS PASS: these are the five buildings on campus where the ARCHITECTURE is the
subject rather than the container, and four of the five are nearly windowless — which
means the generic window grid is not slightly wrong on them, it is completely wrong. Two
of them are also the most shareable objects on campus.

WHAT MAKES THESE THEMSELVES — source all of it:
  - LBJ Presidential Library: a travertine box on piers, essentially blind on its long
    elevations, with a cantilevered upper mass. Big, simple and unmistakable — which
    means proportion errors are brutally visible and window errors are fatal. Get the
    travertine's actual colour and the cantilever's actual overhang. Right now it is
    almost certainly wearing office windows; every one of them is wrong.
  - Ellsworth Kelly's "Austin": small, white stone, barrel-vaulted, with coloured glass
    windows in specific patterns on specific elevations. It is TINY — check whether it
    even reads at flying altitude before you invest, and if it does not, say so and spend
    the time on the other four rather than polishing something no one will see.
  - Blanton: warm stone with a strong cornice, plus the 2023 plaza addition — large
    vaulted white "petals" that are freestanding structures, not building. Those are
    authored geometry, not a facade, and they are the single most photographed thing in
    this precinct. Decide whether they are in scope and say which way you went.
  - Harry Ransom Center: a stone box whose upper floors are clad in etched translucent
    glass panels — a solid-looking grid, not windows. The panel grid is the facade.
  - Bass Concert Hall: a large brick performance mass with a glazed lobby wrapping part
    of it. The auditorium volume is blind; only the lobby is glass. That contrast IS the
    building.

THE HARD PART: four of these five are mostly SOLID, and the whole facade system in
js/facades.js is built around windows. Your job is largely to take windows AWAY and
replace them with material — panel joints, stone coursing at a scale that is actually
drawable, shadow at the reveals. Read section 5 of docs/PASS_COMMON.md on what feature
sizes survive at flying altitude before you design any tile; anything under about a metre
is invisible and anything you draw at a tenth of a pixel becomes a lie about the
material. Also read the vertical-anchor trap: a base, a blind middle and a cornice need
STACKED GEOMETRY BANDS, per the BANDS list in scripts/bake_stadium.py.

YOU OWN, and may create or edit freely:
  js/arts.js  scripts/bake_arts.py  data/arts.geojson  docs/PASS_ARTS.md
  scripts/verify/arts-*.mjs  shots/arts-*.png
js/arts.js already exists as a stub and is already loaded by index.html and
_harness.html. Do not touch either HTML file. Do not touch js/app.js, js/facades.js,
js/ground.js, or any file belonging to another pass.

ESCALATE TO SIMEON ONLY IF: you want to build the Blanton petals as authored geometry and
it would take the pass materially longer. That is a scope call and it is his. Everything
else — materials, colours, band heights, whether Kelly's Austin is worth the time — is
yours to decide. Decide, then report what you decided and why.

DELIVERABLE: a branch and a PR, per section 6 of docs/PASS_COMMON.md.
```

---

## 5 — MODERN EAST

```
Read docs/PASS_COMMON.md first, in full. It is the shared brief for this pass: the app,
the reference method, the rendering traps, the integration contract, and the verification
rules. Everything in it is mandatory and every rule in it is a bug that already shipped.

YOUR TARGET: the modern glass-and-metal precinct on the east edge of campus.
  - Moody Center (final_height 27.7, building_class "stadium")
  - Health Transformation Building (46.1)
  - Health Discovery Building (44.8)
  - Neural Molecular Science Building (37.4)
  - Dell Seton Medical Center and the rest of the Dell Med block, if present by name

WHY THIS PASS: everything else on campus is limestone and red tile from the 1930s. This
block is 2017-2022 curtain wall, and the contrast is the point — it is what makes the
flyover read as a real modern city rather than a heritage diorama. It is also the ONE
group in the scene where a curtain wall is genuinely correct, so the glassy look the
other passes are removing is the look you should be perfecting.

IMPORTANT BOUNDARY: Moody Center is classified "stadium" in the data, the same class
DKR uses. scripts/bake_stadium.py currently skips it because its footprint has no
interior ring, and DKR is being rebuilt in another session right now. bake_stadium.py and
data/stadium.geojson are NOT yours — do not edit either. Verify before you start that
data/stadium.geojson's replacedBuildingIds does not contain Moody Center's id, and if it
ever does, stop and say so rather than having two layers render the same building.

WHAT MAKES THESE THEMSELVES — source all of it:
  - Moody Center, 2022, ~15,000 seats. Its skin is the whole design: a curving, faceted
    metal-panel and glass envelope that does NOT follow the seating bowl underneath, with
    a large glazed corner at the main entry and a deep overhanging roof edge. It is an
    arena, so unlike DKR it is a CLOSED roof, not an open bowl — do not copy the bowl
    approach, it is the wrong building type. Get the panel module and the roof overhang.
  - The Dell Med buildings are laboratory and clinical blocks: horizontal ribbon glazing
    or a unitised curtain wall with spandrel panels, sunshades or fins on the exposed
    elevations, a heavy rooftop mechanical penthouse (labs have enormous plant, and the
    penthouse is often a fifth of the visible height), and a distinctly different ground
    floor. The mechanical penthouse is the most-visible and most-missing feature from a
    60-75 degree camera.
  - Sample the actual glass colour off photographs at more than one time of day. Glass is
    not one hex; it reads dark and reflective in some light and pale sky-coloured in
    others, and the day/golden/night ramp in this app is where you express that. A
    curtain wall that does not change character between noon and night is not finished.

THE HARD PART, and read the trap section of the common brief before you fight it: a wall
pattern has NO vertical anchor, so a distinct ground floor and a rooftop mechanical
penthouse cannot be expressed as one extrusion with one tile. Emit STACKED GEOMETRY
BANDS per the BANDS list in scripts/bake_stadium.py. Also note that the pattern is
TILE-locked, not world-locked — a curtain wall module that looks right at one zoom is
wrong at every other one, and this pass is the one most exposed to that because a
regular glass grid makes the scaling error obvious. Measure it at three zooms.

YOU OWN, and may create or edit freely:
  js/moody.js  scripts/bake_moody.py  data/moody.geojson  docs/PASS_MOODY.md
  scripts/verify/moody-*.mjs  shots/moody-*.png
js/moody.js already exists as a stub and is already loaded by index.html and
_harness.html. Do not touch either HTML file. Do not touch js/app.js, js/facades.js,
scripts/bake_stadium.py, data/stadium.geojson, or any file belonging to another pass.

ESCALATE TO SIMEON ONLY IF: Moody Center's envelope needs authored geometry rather than a
facade treatment to read correctly, and that would materially extend the pass. Show him
one labelled render of both options. Everything else is yours to decide.

DELIVERABLE: a branch and a PR, per section 6 of docs/PASS_COMMON.md.
```
