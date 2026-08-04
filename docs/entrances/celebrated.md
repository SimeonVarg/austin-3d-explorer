# Celebrated entrances — authoring spec

Written for the entrance bake (`scripts/bake_entrances.py` → `data/entrances.geojson`,
neither of which exists yet). This file is the *taste and accuracy* half of that
job. It does not contain code and it does not claim any file.

Simeon's brief: *"make entrances extremely accurate with accurate text and
design, some of these are celebrated entrances. Do all entrances and exits,
correct types of doors, amount of doors + stairs, rails, glass, and material."*

The whole difficulty is in "some of these are celebrated". A single generic
recipe applied 374 times will place a rectangle of glass on Battle Hall's east
portal and on a loading dock with equal confidence, and the Battle Hall one is
the one people will look at. So this spec sorts the campus into three tiers and
spends its accuracy budget on the top one.

---

## 0. How to read the confidence marks

Every factual line below carries one of these. **Do not strip them when you turn
this into code.** Half the value of this document is knowing which half is real.

| mark | meaning |
|---|---|
| **[M]** | **Measured** — read out of a dataset or quoted verbatim from a cited source in this session. |
| **[C]** | **Cited** — a named published source asserts it in prose; I have not seen the thing. |
| **[D]** | **Derived** — follows from an [M] or [C] fact by a stated argument. The argument is written out so you can attack it. |
| **[U]** | **UNVERIFIED** — an authoring default I am choosing so the bake has a number. Not a claim about the world. Every one of these is a photo-check away from being real. |

I have marked things **[U]** aggressively. Door-leaf counts, step counts and
rail sides are almost never written down in architectural prose, and I refused
to guess in a voice that sounds measured. **Roughly 45% of the per-portal fields
below are [U].** Section 7 says exactly how to close them.

I have invented no inscriptions. Where I could not read carved text, the entry
says so in those words.

---

## 1. What the data actually supports (read this before trusting OSM)

I re-ran the Overpass query rather than taking the scout's numbers on faith, and
the picture is worse than the headline count suggests.

- **93 entrance nodes** exist in the campus bbox `30.2760,-97.7480,30.2960,-97.7220`.
  **[M]** (Overpass, `overpass.kumi.systems`, data timestamp 2026-07-02.)
- Of those, only **69** sit on a way that is tagged `building`, and only **65**
  are members of a **named** building. **[M]**
- **Of the 18 buildings on Simeon's celebrated list, exactly four have any OSM
  entrance node at all: MAI, GRE, GDC, HRC.** **[M]** Battle, Sutton, the Union,
  Hogg, Goldsmith, Garrison, Littlefield, PCL, Jester, Welch, Painter, LBJ,
  Blanton and Bass have **zero**.

**Consequence, and it is the single most important line in this file: OSM cannot
be the source of truth for the celebrated set.** A bake that iterates
`entrance=*` nodes and stops will place nothing on Battle Hall and five doors on
Waggener Hall. The celebrated portals must be a hand-authored table — this one —
keyed by building, and OSM is only a *cross-check* on the four where it overlaps.

Two more data facts a bake will trip over:

- **There is no feature named "Main Building" in
  `data/snapshots/2026-07-10/buildings.detailed.geojson`.** The Main Building
  and Tower are one footprint named **"UT Tower"**, bbox
  `lon −97.73977..−97.73895, lat 30.28562..30.28640`, `final_height` 94.0 m.
  **[M]** That bbox is *identical* to the OSM way tagged `ref=MAI`
  **[M]**, so the two are the same polygon and a name-match lookup for
  "Main Building" will silently find nothing.
- **Bass Concert Hall is named "College of Fine Arts Performing Arts Center"** in
  the same file, bbox `lon −97.73157..−97.73048, lat 30.28576..30.28683`. **[M]**

---

## 2. Changes I made to Simeon's starting list, and why

**Promoted in (2):**

- **Texas Memorial Museum (TMM).** It has the one entrance on campus with a
  *documented, named* door material — "bronze west doors" in Art Deco **[C]**
  (Texas Connect). Bronze is exactly the material the brief asks about and this
  is the only place I found it written down. Leaving it out while guessing at
  bronze elsewhere would be backwards.
- **Waggener Hall (WAG).** Not for fame — for calibration. It carries **five**
  OSM entrance nodes on four different sides **[M]**, more than any celebrated
  building, so it is the one place the generic pass and the measured data can be
  compared against each other on a 1931 Greene building of the same family as
  Garrison and Gregory. Use it as the regression fixture.

**Demoted out of tier 1 (2):**

- **Robert A. Welch Hall (WEL).** The building the public sees from Speedway is
  dominated by the large later addition; there is no celebrated portal here and
  I found no published description of one. Tier 3, generic.
- **Jester (JES).** 1969, and the entrances are plain recessed glass lines under
  concrete. Its interest is *volume*, not design — it is the biggest doorway
  count on campus. Tier 3 with a leaf-count override, not a hand-authored portal.

**Kept but flagged thin:** Painter Hall, PCL. See their entries.

---

## 3. Tiers

- **Tier 1 — hand-authored (13).** MAI, BTL, SUT, UNB, GRE, GAR, HMA, GOL,
  Littlefield House, LBJ, BMA, HRC, TMM.
  Every portal below gets its own geometry: real leaf count, real surround, real
  lettering. These are the ones a screenshot will land on.
- **Tier 2 — semi-authored (5).** PCL, GDC, Bass/PAC, PAI, WAG.
  Correct facade and correct leaf count, generic surround. Modern or plain
  buildings where the portal is a composition of glass and mullions, not carving.
- **Tier 3 — generic (everything else, ~355).** The rule pass. JES and WEL live
  here with per-building leaf-count overrides.

---

## 4. Shared vocabulary — settle this before drawing anything

Per `CLAUDE.md` rule 11, all of it parameterised; per the Visual Reference
Playbook, uniform primitives are the null hypothesis and variation lives in the
surround.

**Door types** (the alphabet — nothing outside this list):
`hinged_single`, `hinged_pair`, `hinged_quad` (two pairs with a mullion),
`revolving`, `sliding_auto`, `overhead` (service), `gate_iron`.

**Leaf** = one operable panel. "Six doors" in campus speech usually means three
pairs. **Record leaves, not openings**, and say which in the field name — this
ambiguity is the most likely source of a wrong count in this whole document.
**[D]**

**Materials** (`mat`): `bronze`, `aluminium_dark`, `aluminium_clear`, `wood_oak`,
`wood_painted`, `glass_frameless`, `iron_wrought`.

**Stairs — reuse `scripts/bake_depth.py`, do not invent a second look.** **[M]**
Verified present in that file: `STEP_NOSING = 0.35`, `STEP_NOSING_FRAC = 0.35`,
`STEP_LIFT = 0.03`, and `Builder.flight(centre, run, length, width, n, tread,
base, riser, name)` at line 388. The header at line 401 records a real bug — a
flight emitted **no light tread at all** when `tread > STEP_NOSING * 1.2` failed
— so use `flight()`, never a hand-rolled loop.

**Rails.** Model as a thin proud slab, same trick as `bake_places.py`. A rail
exists on a flight only where the spec says so; **campus flights of three steps
or fewer usually have none, and I have not verified this on a single building**
**[U]**.

**Proud-of-wall offset.** `bake_places.py` stands its shopfront **0.30 m** proud
of the host wall and projects awnings **1.30 m** **[M]**. Entrances should use
the same 0.30 m datum for flush portals so a door and a shopfront on the same
building agree, and a *recessed* portal should be modelled as a dark inset
rather than negative offset. **[D]**

**Claim no building ids.** `bake_places.py`'s whole structural idea is geometry
that stands proud and claims no host id, so it cannot collide with `facades.js`,
`drag.js`, `westcampus.js` or `heroes.js` **[M]**. Entrances must obey this
exactly. Do not rewrite host buildings.

**Colours.** `wd` / `wg` / `wn` + `base` + `h`, per `data/places.geojson` **[M]**.

---

## 5. Tier 1 — the celebrated portals

### 5.1 Main Building / UT Tower (MAI) — south portal

The one that matters most.

- **Facade: SOUTH.** **[M]** OSM node tagged `entrance=main` at
  **30.285759, −97.739416**.
- **It is in a recessed centre bay, not on a flat wall — this is the detail a
  generic bake will get wrong.** **[M]** Tracing the OSM ring, the south front
  steps: a west wing corner at (30.285664, −97.739772)→(30.285653, −97.739623),
  the wall then jogs *north* to lat ≈30.28576 and runs east from
  lon −97.739611 to −97.739327 (~27 m), then jogs south again to the east wing
  at (30.285629, −97.739224)→(30.285618, −97.739075). The `entrance=main` node
  sits at lon −97.739416, within a metre of the **midpoint** of that recessed
  run. So: portal centred in a recessed centre bay flanked by two projecting
  wings. Model the recess.
- **Two secondary entrances, both measured:** `entrance=yes` west at
  **30.285955, −97.739743** and `entrance=yes` east at **30.285980, −97.738982**.
  **[M]** Both sit at the north end of the wings, i.e. into the courtyards.
- **Surround material: Texas shell stone** — "The doorways were framed in a
  locally quarried limestone called Texas shell stone" **[C]** (Alcalde). Walls
  are **Indiana limestone**; roof tiles were made in Ohio **[C]** (same).
- **South facade order: a row of dentils, and pilasters with Ionic capitals**
  **[C]** (Alcalde). Not columns in the round — pilasters. Do not model a
  free-standing colonnade here.
- **INSCRIPTION, above the south entrance, exact text:**
  > Ye shall know the truth and the truth shall make you free

  **[C]** — John 8:32, KJV, chosen by the Faculty Building Committee under
  Dr. William Battle, approved by the Board of Regents **28 September 1935**
  (Nicar, *The Inscription*, UT History Corner). Note **two of the sources
  punctuate it differently** — the Alcalde renders it "Ye shall know the truth,
  **and** the truth shall make you free" with a comma; Nicar and the campus
  history item render it without. **[M]** I could not resolve the carved
  punctuation from text sources; carve it **without a comma** and flag it, or
  read it off a photo.
- **Inscription layout — carve it in two clauses either side of the University
  seal.** Nicar: the chosen text was "two clauses and twelve words", suited to
  "the elevation design, which featured the University seal in the middle
  dividing the text" **[C]**. Twelve words splits exactly as
  `YE SHALL KNOW THE TRUTH` (5) | *seal* | `AND THE TRUTH SHALL MAKE YOU FREE`
  (7) **[D]**. High confidence, but confirm on a photo before carving.
  Nicar also notes a length limit of **108 letters and spaces** **[C]** — a
  direct constraint on letter width if you ever fit type to the band.
- **Other exterior lettering (relevant if the camera ever gets close):**
  - **Twelve university seals, east and west walls: Bologna, Paris, Oxford,
    Salamanca, Cambridge, Heidelberg, Mexico, Edinburgh, Harvard, Virginia,
    Michigan, Vassar.** **[C]** (Alcalde). A second source calls them
    "terracotta cartouches" depicting 12 renowned universities **[C]**.
  - **Fourteen "men of letters" carved east and west**, range given as Aristotle
    to Mark Twain and William Shakespeare **[C]**. **I do not have the other
    eleven names and will not invent them.**
  - **Cast-iron alphabet letters** around the windows. **Sources conflict on the
    languages**: Alcalde says four — Phoenician, Hebrew, Greek, Latin, on the
    north side and courtyards; the campus-history summary says five, adding
    **Egyptian**. **[M]** Unresolved. Use four and mark it.
- **Doors — leaves and material: [U].** I found no published description of the
  south doors. **Authoring default: `hinged_quad`, 4 leaves, `bronze`**, chosen
  because Cret-era Texas civic portals of this rank are bronze and because the
  contemporaneous Texas Memorial Museum's west doors *are* documented bronze
  **[C]**. This is an analogy, not evidence.
- **Glazing: [U].** Default: tall divided lights in the upper half of each leaf,
  plus a fixed transom under the inscription band.
- **Historic detail worth knowing:** a stained-glass window, a gift of the class
  of 1909, was **originally on the south doorway** **[C]** (Texas Connect). It is
  not there now. Do not model it; do record it, because someone will ask.
- **Steps and rails: [U].** Default 5 risers full width across the recessed bay,
  no rails (a monumental full-width flight of this era generally has none).

### 5.2 Battle Hall (BTL) — east portal

Cass Gilbert, 1911; NRHP **70000763**, listed **25 August 1970** **[C]**.
Selected by the AIA in 2007 as one of America's 150 favourite works **[C]**.

- **Facade: EAST.** **[C]** and strongly so — "The east facade faces the first
  cross axis of the Cass Gilbert campus plan, its five large, arched windows
  lighting the grand beamed and panelled reading room" (UT Libraries, *Our
  Landmark Library: Battle Hall at 100*). The same source's item list includes a
  photograph captioned "detail of east façade entrance" **[M]**.
- **No OSM entrance node exists.** **[M]** Approximate portal position, derived
  from the footprint: the east wall runs at **lon ≈ −97.74015**, lat
  **30.28521..30.28561**; the portal is on the centre of that wall, so
  **≈ 30.28541, −97.74015** **[D] — centre-of-wall assumption, unverified.**
- **Five large arched windows on the east facade, deeply recessed and
  monumental.** **[C]** Five is a hard number from the source; the portal sits in
  that same rhythm.
- **Wall material: Cordova Creme limestone, from the Featherlite quarries near
  Cedar Park.** **[C]** (UT Libraries). This is the most specific stone
  attribution I found for any building on campus — use the real thing.
- **Terra cotta surrounds and roundels** on the exterior; **zodiac medallions**;
  deep overhanging eaves with **polychrome bracketed soffits**, restored to
  Gilbert's original bright palette after decades painted muted grey; a
  **red clay tile** roof. **[C]**
- **Ironwork: wrought iron, fabricated by H. B. Milmine of Toledo, Ohio** —
  balconies, grilles and lanterns. **[C]**
- **Two wrought-iron lanterns, one either side of the main door on the east
  facade.** **[C]** — from Gilbert's own general specifications, which allowed
  up to **$800.00** for them. This is a measured, citable portal feature and it
  is the single most recognisable thing about this entrance. **Model the
  lanterns.**
- **Eight-inch-high owls sculpted in zinc** run in a series along the exterior;
  some were re-fabricated in zinc sheet during the restoration. **[C]** Eaves
  level, not portal level, but they are what the building is loved for.
- **Doors: [U].** Default `hinged_pair`, 2 leaves, `wood_oak` with a glazed
  upper panel, set in an arched limestone surround with a fanlight or tympanum
  above. The arch is [D] from the five arched windows setting the facade's
  rhythm; the door material is a pure default.
- **Steps and rails: [U].** Default 3 risers, no rails.
- **Inscription: none found.** Two sources explicitly note the facade
  documentation contains no inscription or lettering **[M]**. **Carve nothing.**
- **Secondary entrances: [U].** A north link to Sutton Hall and a service door
  are near-certain from plan logic but I have nothing on either.

### 5.3 Sutton Hall (SUT) — north portal

Cass Gilbert, 1917; originally the Education Building.

- **Facade: NORTH — and this is a trap.** **[C]** "An extensive renovation
  completed in **1982** adapted Sutton Hall for use by the School of Architecture
  and **created the present main entrance on the north façade**." Anyone reasoning
  from the 1917 plan, or from the building's obvious address on Inner Campus
  Drive, will put the door on the wrong side.
- **No OSM entrance node.** **[M]** Footprint `lon −97.74117..−97.74050,
  lat 30.28482..30.28509`; the north wall is at **lat ≈ 30.28509**, so the portal
  is **≈ 30.28509, −97.74083** **[D] — centre-of-wall assumption, unverified.**
- **The historic entry, and the reason it is on the list, is the double vaulted
  arcade with polychrome ceiling mosaics** — named by both the Cass Gilbert
  Society and UT SOA as the building's most striking feature **[C]**. **[U]:** I
  could not confirm which facade the arcade is on. If the bake models one thing
  here, model the arcade — but resolve its side from a photo first. Putting a
  vaulted arcade on the wrong elevation is worse than omitting it.
- **Materials, and they differ from Battle Hall deliberately:** brick and
  limestone facades, **limestone limited to the first floor**, brick and terra
  cotta above, shallow-pitched hip roof in clay tile. **[C]** Gilbert gave Sutton
  "rich-appearing but less imposing" facades than the Library **[C]**. So: the
  ground floor around the portal is stone, everything above it is brick. That one
  fact will do more for the look of this building than the door will.
- **Custom-designed iron lanterns grace the main entry** **[C]** — the same motif
  as Battle Hall. **Model them.**
- **Stone bas-relief and terra cotta ornament** enliven the facade; soffits are
  detailed with **wood carvings**. **[C]**
- **Doors: [U].** Default `hinged_pair`, 2 leaves, `wood_oak`. Note the operable
  door is a **1982 insertion**, so a modern aluminium-and-glass leaf in a historic
  stone surround is at least as likely as oak. Flag, then check.
- **Steps, rails, inscription: [U] / none found.** No inscription in any source.
  **Carve nothing.**

### 5.4 Texas Union (UNB) — West Mall front

Paul Cret, opened **1933**, built with Texas Exes funds raised in a campaign led
by Thomas Watt Gregory **[C]**.

- **Facade: [U] — I could not verify it.** The building sits on the West Mall and
  the mall front is the presumed main entrance, but **no source I found states
  which elevation the main door is on, and OSM has no node.** **[M]** The
  footprint is `lon −97.74147..−97.74080, lat 30.28599..30.28731` **[M]** — a
  strongly north–south building, 145 m long, ~65 m wide, so the mall front is the
  **south or east** face. **Do not author this portal until someone looks.**
  This is the biggest single hole in the document and it is on one of the two
  buildings Simeon named for carved inscriptions.
- **INSCRIPTION: I could not read any.** Multiple searches returned nothing on
  Union lettering. Simeon's brief says the Union "carries real carved
  inscriptions" — **that may well be true and I simply could not source it.**
  I am not inventing it. **Carve nothing until it is read off a photograph.**
- Everything else — leaves, material, glazing, steps, rails, surround — **[U]**.
  Cret + 1933 + limestone is the family; that is all I can honestly say.

### 5.5 Gregory Gymnasium (GRE) — west portal

Herbert M. Greene, 1930.

- **Facade: WEST.** **[M]** OSM `entrance=main` at **30.284010, −97.736834**.
  Footprint `lon −97.73699..−97.73558, lat 30.28352..30.28445` **[M]**, so the
  node is on the west wall, slightly south of centre. This one is measured; take
  it.
- **The portal composition is "grand arches and ornate stone staircases" over
  brick facades** **[C]** (UT Libraries, *The Architectural Legacy of Herbert
  Miller Greene*). The **stone staircase is part of the entrance, not incidental**
  — this is the one building on the list where the stair is explicitly called out
  as a feature. Give it the `flight()` treatment and give it generous width.
- **Roof: Spanish tile** **[C]**.
- **Doors, leaf count, glazing, step count, rails, inscription: [U] / none
  found.** Default `hinged_quad`, 4 leaves, `wood_painted`, in a round-arched
  brick-and-stone surround, on a flight of **7 risers [U]** with **stone cheek
  walls rather than metal rails [U]** (an "ornate stone staircase" implies solid
  balustrade, but that is reading a phrase, not a photo).
- **Secondary entrances: [U].** A 1970s north addition and the Rec Sports
  connection both exist; nothing measured. Note the separate `RSC` building has
  its own measured `entrance=main` at **30.281439, −97.732931** (west) **[M]** —
  that is a *different building*, do not merge them.

### 5.6 Garrison Hall (GAR) — the lettering building

Herbert M. Greene, completed **1926** (construction from 1925) **[C]**.
This is where "accurate text" pays off most, because the text is a *list of
names* and the names are documented.

- **Facade: [U].** No OSM node **[M]**. Footprint is a narrow east–west bar,
  `lon −97.73877..−97.73822, lat 30.28499..30.28528` — 53 m by 32 m **[M]**.
  Sources say "entrance**s**", plural **[C]**, so there is more than one.
- **CARVED NAMES — below the eaves and at the corner windows.** The names of
  founders of the Republic of Texas: **HOUSTON, AUSTIN, BURNET, JONES, TRAVIS,
  LAMAR** **[C]**. The source words it as "among them", so **this list may be
  incomplete** **[M]** — treat six as a floor, not a total.
- **WILLIAM B. TRAVIS and STEPHEN F. AUSTIN appear on the windows** specifically
  **[C]** — a different treatment from the eaves frieze. **[U]:** I do not know
  whether the window carvings are the full names or the surnames only. If you
  cannot tell from a photo, carve surnames — it is the safer failure.
- **32 terra-cotta cattle brands**, chosen from hundreds of candidates to
  represent different periods of the Texas cattle industry **[C]**. Thirty-two is
  a hard number. **The individual brand shapes are not documented anywhere I
  found — do not draw specific real brands you cannot cite.** Draw 32 abstract
  brand-shaped medallions, or draw none.
- **The entrances themselves are decorated with limestone longhorn skulls and
  terra-cotta cacti and bluebonnets.** **[C]** This is explicitly *at the
  entrances*. It is the single most characterful portal ornament on the list and
  it is well sourced. **Model it.**
- **Doors, leaves, glazing, steps, rails: [U].** Default `hinged_pair`,
  2 leaves, `wood_painted`, 3 risers, no rails.

### 5.7 Hogg Memorial Auditorium (HMA)

Paul Cret; part of the same Cret group as the Tower, the Union and the Texas
Memorial Museum **[C]**.

- **Facade: [U].** No OSM node **[M]**. Footprint `lon −97.74087..−97.74038,
  lat 30.28674..30.28702` — 47 m by 31 m **[M]**, west of Waggener, north of the
  Union.
- **Everything about this portal is [U].** I found no description of the
  entrance, the doors, the surround or any lettering. A theatre of this date and
  architect will have a formal front with a columnar or pilastered order and a
  wide flight — but that is a genre expectation, not a fact about this building.
- **Inscription: I could not read any.** The building's name is plausibly carved
  over the entrance; **I did not verify it and am not carving "HOGG MEMORIAL
  AUDITORIUM" on speculation.**
- **Recommendation: demote to tier 2 unless someone photographs it.** Hand-
  authoring a portal from zero sources is how you get a confident wrong answer.

### 5.8 Goldsmith Hall (GOL)

Paul Cret. Now School of Architecture with Sutton and Battle.

- **Facade: [U].** No OSM node **[M]**. Footprint `lon −97.74144..−97.74086,
  lat 30.28512..30.28570` — 56 m by 64 m, nearly square, consistent with the
  courtyard plan **[M]**.
- **[U] on everything else.** I found no published entrance description.
- **The one structural thing worth encoding:** Goldsmith wraps a courtyard, so it
  has an *inward* facing entrance as well as street ones. A bake that only ever
  puts doors on the outer hull will miss the door people actually use. **[D]**
- **Inscription: none found. Carve nothing.**

### 5.9 Littlefield House

James W. Wahrenberger, **1894**; bequeathed to the University in 1935; NRHP
**70000767**; Texas Historic Landmark 1962 **[C]**. (Simeon's brief said
"Littlefield Home"; the NRHP name is Littlefield House, and note the repo also
contains **Littlefield Dormitory** and **Littlefield Carriage House** as separate
features — three different buildings, easy to confuse **[M]**.)

- **Facade: [U].** No OSM node **[M]**. Footprint `lon −97.74090..−97.74065,
  lat 30.28798..30.28825` — a small 24 m × 30 m house **[M]** at the corner of
  Whitis and 24th. The porch faces the street corner; **which street, I did not
  verify.**
- **"Defiantly ornate Victorian", with two mismatched towers — one square, one
  round — over a multicoloured slate roof**; described as the best surviving
  example of eclectic Victorian design in Austin **[C]**.
- **The roof is the identity here, not the door.** Multicoloured slate and two
  differently-shaped towers will read from the air; a Victorian front door will
  not. **Spend the budget on the roof and the towers.** **[D]**
- **Porch, columns, veranda, doors, steps, rails: [U].** Searches specifically
  for the porch and columns returned nothing; an 1894 house of this class has a
  deep wraparound veranda on turned or classical columns, but **I did not verify
  it and the sources say so explicitly.**
- **Inscription: none. A house does not carry one.**

### 5.10 LBJ Presidential Library (LBJ)

Gordon Bunshaft / Skidmore, Owings & Merrill.

- **Facade: [U].** No OSM node **[M]**. Footprint `lon −97.72955..−97.72902,
  lat 30.28559..30.28619` **[M]** — and note that footprint is only ~51 m × 67 m,
  which is the *tower*, **not** the plaza. The plaza is 90,000 sq ft **[C]** and
  is not in the building file at all.
- **This building's entrance problem is the opposite of everyone else's: it
  barely has a door.** An "unadorned ten-storey travertine monolith" **[C]**,
  clad in **Roman travertine** **[C]**, standing **87 feet above the plaza**,
  eight storeys above and two below **[C]**. **The east and west walls are eight
  feet thick at the base**, curve gently upward, and the tenth floor **overhangs
  the walls by fifteen feet** **[C]**. Those three numbers are the building.
- **The approach is the entrance.** A travertine-and-terrazzo plaza surrounds the
  building **[C]**; the visitor arrives across it and up. **Model the plaza
  podium and the overhang; do not put a shopfront-style glazed entrance on a
  windowless travertine wall.** **[D]** That is the specific failure mode here.
- **Which side the door is on, leaf count, glazing: [U].** The ceremonial stair
  and the four-floor archive view are *interior* **[C]** — do not surface them.
- **Inscription: none found.**

### 5.11 Blanton Museum of Art (BMA) — Michener Gallery Building

**The entrance changed in 2023 and any pre-2023 reference is wrong.** Snøhetta's
grounds redesign (UT alumni Craig Dykers, Elaine Molinar, John Newman) opened
**May 2023** and won the 2025 AIA New York urban design award **[C]**.

- **Facade: [U] on the compass, but the composition is well documented.** No OSM
  node **[M]**. Repo footprint `lon −97.73783..−97.73701, lat 30.28061..30.28136`
  **[M]** — that is one of the two buildings; the Blanton is a **two-building**
  campus (Michener Gallery Building and the Smith Building) and the bake must not
  treat it as one.
- **The Michener entrance is in the MIDDLE of a loggia**, and a site-specific
  **Carmen Herrera mural runs the full length of the interior loggia wall, with
  the entrance in the middle of it** **[C]**. So the portal is a void in a painted
  colonnade — not a glass box on a blank wall.
- **A new archway marks the Smith building's ticketing lobby; its inverted
  companion hovers above the Michener gallery entrance** **[C]**. Two arches,
  mirrored, one per building. **Model both or neither** — one alone reads as a
  mistake.
- **Petals.** Sculptural shade canopies over the plaza, smooth outside, with
  raised perforations inside that move water to the drainage system **[C]**.
  From the air these are the Blanton. **[U]:** I do not have a petal count or
  their heights. **Count them off an aerial before drawing them** — a wrong
  number here is immediately visible.
- **Glass, measured from the fabricator's project record:** the Michener building
  has **3 structural glass walls and 1 glass guard rail**; the Smith building has
  **5 structural glass walls and 8 glass guardrails** **[C]** (Sentech). These are
  hard counts and the only hard glazing counts in this entire document. Use them.
- **Inscription: none found** beyond ordinary museum signage.

### 5.12 Harry Ransom Center (HRC)

- **Facade: SOUTH-EAST corner.** **[M]** OSM `entrance=main` at
  **30.284281, −97.740931**, which relative to the footprint
  (`lon −97.74156..−97.74090, lat 30.28403..30.28464` **[M]**) is the
  south-east. The building address is 300 West 21st Street **[C]** — 21st runs
  along the south — so the SE reading is consistent with the street. `height=32`
  is tagged on the OSM way and matches the repo's 32.0 m **[M]**.
- **The 2003 Lake|Flato renovation is the whole point of this entrance.**
  Ground-floor public spaces that were **formerly hidden behind a windowless
  facade** are now visible through **glass walls etched with images and text from
  the collections**, which **at night serve as a beacon for the campus**
  **[C]**. **Two former plazas were enclosed in glass** **[C]**.
- **So: ground floor = etched glass, everything above = the original blank
  stone box.** That contrast *is* the building. A bake that glazes the whole
  facade, or none of it, gets it wrong in opposite directions. **[D]**
- **Night behaviour.** The `wn` colour on the HRC ground band should be the
  *brightest* night value of any facade in this document — the source calls it a
  beacon **[C]**. This is a taste value; parameterise it (`HRC_NIGHT_GLOW`).
- **The etched artwork content is documented in kind but not in detail** —
  "images and text from the collections", with permanent displays of the
  Gutenberg Bible and the world's first photograph inside **[C]**. **[U]:** I
  cannot reproduce the etched imagery and would not try at this scale. Model it
  as a translucent frit, not as legible pictures.
- **Doors, leaves, steps, rails: [U].** Default `sliding_auto` plus
  `hinged_pair`, `aluminium_dark`, level entry (a 2003 accessible renovation
  almost certainly has no step at the main door **[D]**).
- **Inscription: [U].** Modern lettering on the facade is likely but I did not
  verify the wording. **Do not carve "HARRY RANSOM CENTER" on speculation.**

### 5.13 Texas Memorial Museum (TMM) — promoted in

- **Facade: WEST.** **[C]** — "bronze west doors", Art Deco, 1930s (Texas
  Connect). This is **the only entrance in this whole document whose door
  material is stated in a source rather than assumed** **[M]**.
- **Use it as the bronze reference.** Every other `bronze` in this file is an
  analogy to this one; if the TMM doors get modelled well, MAI's default has
  something real to copy.
- **[U]:** leaf count, glazing, steps, rails, surround, inscription. Cret again;
  Art Deco bronze doors of this date are usually a pair or two pairs with cast
  relief panels, but that is genre knowledge.
- **No OSM entrance node** **[M]**.

---

## 6. Tier 2 — correct facade and leaf count, generic surround

### PCL (Perry-Castañeda Library)
Completed **1977**; Austin's most prominent Brutalist building; at 21st and
Speedway **[C]**. The Texas-shaped-plan story is **false** — the University says
it was not intentional and calls the plan a **rhomboid** that pairs with the
business school building across the street, finished the same year **[C]**.
Do not let a "Texas shape" get into the model or the copy.
No OSM entrance node **[M]**. Footprint `lon −97.73869..−97.73770,
lat 30.28214..30.28337` **[M]**. **Facade [U]** — the 21st/Speedway corner is
the address but I did not verify which elevation the door is on. Portal is a
recessed glass line under deep concrete; `sliding_auto`, `aluminium_dark`,
**leaf count [U]**. No inscription.

### GDC (Gates-Dell Complex)
**Six measured entrance nodes — the best-documented building on the list** **[M]**:
`main` **west** at 30.286256, −97.736683; `staircase` at 30.285998, −97.736842
(SW) and 30.286529, −97.736791 (NW); `yes` at 30.285982, −97.736646 (S),
30.286202, −97.736477 (SE) and 30.286247, −97.736472 (SE). Footprint
`lon −97.73694..−97.73596, lat 30.28596..30.28654`, `building:levels=6` **[M]**.
Main entrance faces **Speedway (west)**. Two staircase entrances are a real
feature, not noise — model them as stairs. Glass and metal; **leaf count [U]**.
**Neighbour warning:** the adjacent **POB (O'Donnell Building)** has five more
nodes including an `exit` **[M]** — different building, do not merge.

### Bass Concert Hall
**Named "College of Fine Arts Performing Arts Center" in the repo** **[M]**,
footprint `lon −97.73157..−97.73048, lat 30.28576..30.28683` **[M]**. No OSM
node. **Facade [U], everything [U].** I found no architectural description.
A concert hall's entrance is a wide glazed lobby band under a canopy — genre,
not fact.

### Painter Hall (PAI)
Footprint `lon −97.73910..−97.73842, lat 30.28667..30.28727` **[M]**. No OSM
node, no description found. **All [U].** Kept in tier 2 only because it sits on
the Cret/Greene-era inner campus and will be seen next to Welch and the Tower.

### Waggener Hall (WAG) — the regression fixture
Built **1931**, Greene; carries a tile mosaic depicting Texas citrus exports
**[C]**. **Five measured entrance nodes, all `entrance=yes`** **[M]**:
30.284938, −97.737516 (SE); 30.284946, −97.737724 (SW); 30.285114, −97.737707
(W); 30.285266, −97.737483 (NE); 30.285280, −97.737691 (NW).
**Use this building to test the generic pass against ground truth** before
trusting it on 355 others.

---

## 7. What is not known, and exactly how to close it

Being blunt: **the fields Simeon asked for most specifically — leaf count, door
type, step count, rails — are the fields published architectural prose almost
never contains.** I read a lot of it. It gives you style, stone, ornament and
inscriptions, and it is silent on how many doors there are. That gap is real and
it is not going to be closed by more searching.

**It closes with photographs, and there is a right way to do that.** Per the
Visual Reference Playbook: derive the rule, verify it reproduces every example,
*then* draw.

1. **One reference image per tier-1 portal, straight-on, at the door.** Not a
   three-quarter campus view — a portal elevation. 13 images.
2. **Read four numbers off each and write them here:** leaf count; riser count;
   rail present y/n and which side; glazed fraction of the leaf. Those four
   convert ~45% of this document from [U] to [M] in one sitting.
3. **Resolve the five named conflicts and blanks**, in this order of damage:
   (a) the Union's main facade — currently unknown on a tier-1 building;
   (b) whether the Union carries a carved inscription at all, and its wording;
   (c) Sutton's arcade side;
   (d) the Main Building inscription's comma;
   (e) four alphabets or five on the Main Building.
4. **Do not carve any text that is not in section 5 with a citation.** If a
   photo is unreadable, leave the band blank. A blank band reads as a band; wrong
   Latin reads as a lie.
5. **Build the pixel-sample harness before the second portal, not after the
   thirteenth.** Assert the MAI recess depth and the Battle Hall lantern
   positions from rendered pixels. And confirm you are sampling your own layer —
   a whole session on this repo went into "fixing" the basemap's grey buildings
   because the real layer had silently failed to load.

**Things I tried that did not work, so nobody repeats them:**
- The NRHP nomination PDFs on NPGallery (`.../NRHP/GetAsset/NRHP/70000763_text`)
  fetch fine but are **scanned images with no text layer**; no description can be
  pulled from them without OCR. This was the most promising lead and it is dead.
- `campushistory.la.utexas.edu` **does not resolve** (DNS failure). It is still
  indexed by search engines, so it looks alive in results and is not.
- `sah-archipedia.org` returns **403** to WebFetch.
- Wikipedia is unusually thin here — the Battle Hall and Sutton Hall articles
  contain **no** entrance description at all, only style and dates.
- `overpass-api.de` rate-limited after two queries; **`overpass.kumi.systems`
  answered immediately.** Use the mirror.

---

## 8. Sources

- Jim Nicar, *The Inscription*, The UT History Corner — https://jimnicar.com/2016/10/06/the-inscription/
- *From the Finials to the Floors, the UT Tower was Built to Inspire*, The Alcalde — https://alcalde.texasexes.org/2026/02/from-the-finials-to-the-floors-the-ut-tower-was-built-to-inspire
- *Delve into UT's hidden architectural gems*, Texas Connect — https://texasconnect.utexas.edu/2022/05/04/delve-into-uts-hidden-architectural-gems/
- *Our Landmark Library: Battle Hall at 100*, UT Libraries — https://exhibits.lib.utexas.edu/spotlight/our-landmark-library-battle-hall-at-100/feature/tour
- *Reviving a Masterpiece: The Historic Restoration of Cass Gilbert's Battle Hall*, Traditional Building — https://www.traditionalbuilding.com/features/reviving-a-masterpiece-the-historic-restoration-of-cass-gilberts-battle-hall-at-ut-austin
- Cass Gilbert Society, University of Texas Library — https://www.cassgilbertsociety.org/works/utexas-austin-library/
- Cass Gilbert Society, UT Education Building (Sutton Hall) — https://cassgilbertsociety.org/works/utexas-austin-education-bldg/
- *The Architectural Legacy of Herbert Miller Greene*, UT Libraries — https://exhibits.lib.utexas.edu/spotlight/herbert-miller-greene/feature/university-of-texas
- *Garrison Hall is 90!*, The UT History Corner — https://jimnicar.com/2016/10/28/garrison-hall-is-90/ (404 on direct fetch; content reached via search summary only — treat Garrison facts as [C] not [M])
- Wikipedia, Battle Hall — https://en.wikipedia.org/wiki/Battle_Hall
- Wikipedia, Sutton Hall (University of Texas at Austin) — https://en.wikipedia.org/wiki/Sutton_Hall_(University_of_Texas_at_Austin)
- Wikipedia, Littlefield House — https://en.wikipedia.org/wiki/Littlefield_House
- Wikipedia, Perry–Castañeda Library — https://en.wikipedia.org/wiki/Perry%E2%80%93Casta%C3%B1eda_Library
- Snøhetta, Blanton Museum of Art grounds redesign — https://www.snohetta.com/projects/blanton-museum-of-art-grounds-redesign
- Blanton Museum, The Blanton Grounds — https://blantonmuseum.org/permanent-collection/grounds/
- Sentech, UT Blanton Museum of Art (glass counts) — https://sentechas.com/projects/ut-blanton-museum-of-art/
- Lake|Flato, UT Austin Harry Ransom Center — https://www.lakeflato.com/project/ut-austin-harry-ransom-center/
- *Let There Be Light*, The Austin Chronicle, 16 May 2003 — https://www.austinchronicle.com/arts/2003-05-16/159751/
- Harry Ransom Center, About — https://www.hrc.utexas.edu/about/
- LBJ Library, History — https://www.lbjlibrary.org/history
- Wikipedia, Lyndon Baines Johnson Library and Museum — https://en.wikipedia.org/wiki/Lyndon_Baines_Johnson_Library_and_Museum
- Preservation Austin, History and Preservation at UT Austin — https://www.preservationaustin.org/news/history-and-preservation-at-the-university-of-texas-at-austin
- OpenStreetMap via Overpass API (`overpass.kumi.systems`), campus bbox
  `30.2760,-97.7480,30.2960,-97.7220`, data timestamp 2026-07-02 — all **[M]**
  entrance coordinates, facade sides and footprint bboxes.
- This repo: `data/snapshots/2026-07-10/buildings.detailed.geojson`,
  `data/places.geojson`, `scripts/bake_places.py`, `scripts/bake_depth.py`.
