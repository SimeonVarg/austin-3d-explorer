# Doors in the right clothes — round 2 of "doors at the real doors"

Round 1 (`docs/entrances/doors-at-the-real-doors.md`) moved doors onto UT's own
surveyed coordinates. The review of it agreed the position fix was real and then
said the thing that matters:

> The round fixed WHERE the door sits but did nothing to WHAT is drawn there.
> Correct address, wrong building.

It photographed our render at Welch Hall's east door and put it beside a CC BY
photograph of Welch's entrance: a green-tinted glass storefront with a plain
metal awning, against a three-storey carved-limestone surround with CHEMISTRY
cut into the stone, an iron-grilled arched transom, cast lanterns and a full
stone staircase. Then it did the same at four more doors from three different
architectural eras and got the identical green storefront every time.

This round is about that. It did not touch a single door's position.

---

## 1. The number

`scripts/verify/campusmeter.mjs`, run against `python scripts/serve.py 8821`,
both readings taken by the **same instrument on the same served file**:

```
                                          before        after
  doors drawn                              591           591     (unchanged)
  era MEASURED                          277 (47%)     301 (51%)
  era from no source at all             185 (31%)     161 (27%)
  entrance position, metric A            74/181        74/181    (unchanged)
  walkmeter, ends at UT's own door        38/38         38/38    (unchanged)
```

The before column is produced by `ERA_BASELINE=1 python scripts/bake_entrances.py`,
which reverts exactly the five sourcing changes below and nothing else, so the
comparison runs through the same counter rather than against a remembered number.

**Position did not move and the router did not move.** `campusmeter` metric A is
74 of 181 in both columns; `walkmeter` is 87.0 m / −393.7 m signed, drift 0.00,
38 of 38 ends at UT's own door, live "avoid stairs" UI gate PASS — byte-identical
to HANDOFF §181 and §198. The part that already worked was not disturbed.

---

## 2. The instrument came first, and it is the actual deliverable

Before this round `classify()` returned a bare family letter. Nothing recorded
where that letter came from, nothing printed it, and nothing asserted it — so
the only interesting question about the door vocabulary was unanswerable from
outside the bake: **is this door's era a measurement, or did nobody know?**

Every rule in the cascade now carries a grade (`ERA_GRADE` in
`scripts/bake_entrances.py`):

| grade | what it means |
|---|---|
| `MEASURED` | a dated first-party record said so — UT's register, UT Direct's own building page, OSM's own `building=*` tag |
| `AUTHORED` | a human typed it into a table in this file **with** its evidence |
| `GUESSED` | a human typed it with no evidence recorded |
| `NONE` | nothing is known. E5, the null door. An honest answer, not a failure |

The bake prints the whole table every run, and every emitted piece now carries
`fam` (the family letter the door was **actually assembled with**) and `famsrc`
(the rule that chose it), so the served file can be cross-examined without
re-deriving the cascade.

```
ERA PROVENANCE     : 591 doors; 301 MEASURED (51%), 125 AUTHORED, 4 GUESSED,
                     161 with no era known at all
      MEASURED  261 doors  register-year  UT register / UT Direct occupied year
      NONE      144 doors  default        nothing known — E5
      AUTHORED   70 doors  celebrated     CELEBRATED row, fam_src cited
      AUTHORED   28 doors  wc-secondary   W tower's side/service door -> E2
      AUTHORED   27 doors  wc-table       West Campus lobby table
      MEASURED   20 doors  parking        OSM building=garage / amenity=parking
      NONE       15 doors  null-ref       explicit NULL_REFS
      MEASURED   12 doors  osm-class      OSM building=* class
      MEASURED    8 doors  worship        OSM building=church|mosque
      GUESSED     4 doors  named-list     hand-maintained FAMILY_BY_REF
      NONE        2 doors  null-name      plant/outbuilding by name
```

`campusmeter.mjs` scores the same thing from the outside and **does not trust
`famsrc`**. For every door claiming `famsrc:"register-year"` it goes and looks
that code up in `data/ut_buildings.json` (fetched from the running server) and in
the `YEAR_UTDIRECT` table it slices out of the served `bake_entrances.py`; a code
neither source dates fails the self-check loudly. A lane that wanted to inflate
this number by stamping `register-year` on everything trips that on the first
door. The metric also cannot be raised by drawing fewer doors — deleting a
sourced door lowers the numerator, deleting an unsourced one lowers the
denominator — and both halves are printed side by side.

### The instrument earned its keep on its first run

Adding `"thermal storage"` to `NULL_NAME_PARTS` was supposed to stop UTM Thermal
Storage 1 and 2 from taking a family-D glazed lobby once UT Direct's dates
reached them. The diff said otherwise: **TS1, TS2 and CT7 went E5 → D.** Those
footprints carry no name at all — only a code — so a name test can never fire on
them, and a measured 2011 sailed straight into a seven-metre curtain-wall
entrance on a chilled-water tank. Fixed at the level the rule was wrong
(`PLANT_REFS`, keyed on the thing those footprints actually carry), not by
patching the three cells.

---

## 3. What actually changed, and where every value came from

Five sourcing changes. All five are individually revertible by `ERA_BASELINE=1`.

**1. `YEAR_UTDIRECT` — the register is not the whole register.**
`data/ut_buildings.json` has 198 rows and every one has a year, which reads like
full coverage and is not. Sweeping **every** building code that carries a drawn
door found 23 with no row in it at all, and those doors fell through the whole
cascade to the null door. UT publishes the missing years itself, per code, with
no login, at
`https://utdirect.utexas.edu/apps/campus/buildings/information/nlogon/maps/UTM/<CODE>/`
("UT Building Since: <year>", plus the address, floor count and gross sq ft).
Fetched 2026-08-27, one request per code, for **every** code with a door and no
register row — not a hand-picked few. Nine have no page and are recorded as such
so the next sweep does not re-ask hoping for a different answer. Frozen in the
bake rather than fetched at bake time, for the same reason `_ENTRANCE_ROWS` is;
and deliberately **not** written into `data/ut_buildings.json`, which is another
bake's output (CLAUDE.md lane rule).
Moves: COM 1961 (5 doors), UPB 1960 (3), ARC 1977 (2).

**2. `split_ref()` — an OSM `ref` may be multi-valued.**
The Red McCombs Red Zone footprint carries `ref=RMRZ;NEZ`. Compared whole that
string equals no code, so it matched nothing, took no year, and its **six** doors
came out as null doors — even though UT dates NEZ (North End Zone Building) to
2008. Split on `;`, prefer the first token the register knows, otherwise the
first token. A ref without a semicolon passes through unchanged, so the other 176
cannot be disturbed. Every split is printed by run.

**3. `OSM_CLASS` — this file was already fetching OSM's `building=*` and binning it.**
`join_refs()` has always read the OSM tag block (that is where `ref` and the OSM
name come from) and used exactly one field out of it: `building=garage|parking`.
The other class-bearing tags in the same 384 rows went in the bin. Now they fill
a class Overture left empty, under the same `not tgt.cls` guard the parking
branch has always used — it can never overwrite a class, only fill one. Measured
gain: 4 dormitory footprints, 5 doors (Whitis Court, E5 → E2).
Only values `CLASS_FAMILY` already understands are in the map. `university`,
`office`, `commercial`, `public`, `hospital`, `yes` are deliberately absent: E5
is the honest answer for a building whose only claim is that it is a building.

**4. `REG_ABBREV` — the register's own abbreviations, and it buys almost nothing.**
Every key is a token that literally appears in `data/ut_buildings.json`; every
value is the long form the same register spells out in another row
(`ENGR`→engineering, `EDUC`→education, `CONF`→conference…). This is a
normalisation, not a similarity score: afterwards the two names either are the
same words in the same order or they are not, and `reg_name_key()` still cannot
produce a partial match — the failure `graph.md` §5 rejected (a Jaccard hit on
"austin" putting the Lake Austin Centre on the Blanton) remains impossible.
Measured gain: **3 doors, on one building** — "AT&T Executive Education and
Conference Center" against "AT&T EXECUTIVE EDUC & CONF CENTER" (ATT, 2008).
Reported at its real size rather than dressed up.

**5. `PLANT_REFS` — plant by code, because the name test cannot reach a nameless footprint.**
See §2. Three structures returned to the null door, which is the correct door for
a cooling tower.

Net: **24 doors gained a measured era, 3 correctly lost a wrongly-measured one,
591 doors before and 591 after.** Nothing was invented and nothing was deleted.

### The picture

`shots/cd-entrances/r2-nez-before.png` / `r2-nez-after.png` — the same camera,
1.7 m requested, 2.23 m actual (the app's own floor at 14 m standoff), same
standoff, same pixel, `doorwalk.mjs` on port 8821.

Before, the Red McCombs Red Zone's main door is a 2.2 m flush pair on a blank
wall with three treads under it — the null door, repeated identically at all six
of its openings. After, it is a glazed lobby bay: mullioned storefront, transom
curtain wall continuing above the head, a steel canopy blade.

The reference is UT's own photograph of the same entrance (Tom & Cinda Hicks
North Gate, `utdirect.utexas.edu` WEL-style building page for NEZ, fetched
2026-08-27): brick piers framing a multi-storey glass curtain wall on a mullion
grid. The after frame is the family the photograph shows. The before frame was
not a worse guess at that building — it was **no guess at all**, which is exactly
what "nothing known" looks like when it reaches the screen.

---

## 4. A hand-typed family may now only outrank a measured year if it says why

`classify()` put `CELEBRATED[ref]["fam"]` **above** the date test,
unconditionally. Four of the twenty CELEBRATED rows disagree with UT's own
register year, and nothing was written down either way — so a 1930 building could
wear a 1970s aluminium storefront and the bake had no opinion about it. That is
the specific mechanism behind the review's Welch Hall finding.

`CEL_FAM_NEEDS_SRC` now requires a `fam_src` citation on any row whose family
contradicts the measured year. Uncited, the measurement wins. All four are cited,
so **no family changed** — the point of the rule is the next one, not these four.

| code | authored | register | evidence now on the row |
|---|---|---|---|
| HRC | D | 1972 → C | UT Direct's own photo: a travertine box on a colonnade with a **full-height** glazed ground floor. Family C's storefront head is 3.05 m; the photographed glazing is a whole storey and keeps going. |
| LBJ | D | 1971 → C | UT Direct's own photo: a windowless ten-storey travertine block on a raised plaza. C would put a 3.05 m storefront under a concrete awning on it — the one thing this building's own note says never to draw. |
| PAC | D | 1980 → C | UT Direct's own photo: a multi-storey glass curtain-wall lobby on a visible mullion grid. Settles a note that had called the glazed band "genre knowledge". |
| WEL | C | 1930 → B | see below |

### Welch Hall, in full, because the review was right about the picture and the fix is not the obvious one

The obvious fix is to flip WEL from C to B and let the 1930 date give it a
limestone monumental portal. That would have been wrong, and finding out why is
the most useful thing this round learned.

* **Welch is three buildings under one Overture footprint.** The 1929 Herbert M.
  Greene / Laroche & Dahl Chemistry Building, a **1959** wing by Preston M. Geren,
  and a **1974** wing by Wyatt C. Hedrick.
  [C] `en.wikipedia.org/wiki/Welch_Hall_(University_of_Texas_at_Austin)`.
  The app has one polygon, one height (17.2 m) and one era for all three.
* **All three of UT's surveyed WEL doors are on the later fabric.** Plotting UT
  Facilities' E, NE and NW coordinates on USGS NAIP orthoimagery [M] puts every
  one of them on the flat pale-roofed wings — not on either of the red-tile-roofed
  1929 blocks. So every door this file actually draws on Welch is on post-war
  fabric, and **C is the correct family for those doors.**
* **The 1929 portal is real, documented, and not drawn.**
  `commons.wikimedia.org/wiki/File:Welch_Hall_UT_Austin_Texas_2024.jpg`
  (CC BY 4.0, Larry D. Moore, 2024-08-06) and UT's own building photo both show
  it: semicircular arch, wrought-iron fanlight grille, CHEMISTRY carved in
  limestone, two lanterns, a monumental stair with stone cheeks and pipe rails.
  It is simply not at any coordinate this pass has. Placing it on a guessed wall
  would be inventing structure, which is the one thing the playbook forbids.

So the review's before/after was comparing two different parts of one building.
The render was of a 1959/1974 wing; the photograph was of the 1929 block. Both
were accurate pictures of different things.

---

## 5. Still wrong, named

1. **The 1929 Welch portal is not drawn**, and neither is any other entrance on a
   part of a building that post-dates or pre-dates the footprint's single era.
   The real fix is per-wing fabric, not a per-building era, and it needs the
   footprint split before it needs anything else.
2. **161 doors still have no era at all**, and about 99 of them are on footprints
   carrying no name and no code in any source reached here. E5 is the honest
   answer for those and inflating it would be the defect, not the fix. The named
   remainder that *is* still sourceable is short and specific: DKR Memorial
   Stadium (8 doors), Scottish Rite Dormitory (4 — a 1922 NRHP-listed Herbert M.
   Greene building currently wearing the null door), the George H. W. Bush State
   Office Building (4), 1836 San Jacinto (3).
3. **Family C is 154 doors and its parameters were never checked against a
   photograph.** Evidence found in passing and not acted on: UT dates the
   Pharmacy Building to 1951, which the date test reads as C — an aluminium
   storefront under a concrete awning — while UT's own photograph of it shows a
   limestone balustraded monumental stair on a limestone-trimmed brick building.
   UT kept building in the Cret manner well into the 1950s, so the **1949 → C**
   boundary in `ERA_BOUNDS` is the next thing to test. It was left alone
   deliberately: moving a boundary that governs 154 doors on one anecdote is how
   you trade a known error for an unknown one. It needs its own pass, with a
   photograph per building.
4. **`campusmeter` metric A is still 74/181 and still structurally capped near
   40%**, for the reason round 1 gave: UT publishes one celebrated entrance per
   building while the app draws real OSM side doors that score as misses.
   Main Building's `src=osm` west-wing and east-wing doors are 43.6 m and 74.7 m
   from UT's single west door and are both real. Deleting them would raise the
   score and make the city wronger.
5. **`HANDOFF.md` is not updated by this round's commit.** It has uncommitted
   in-flight edits from another lane in this checkout, and committing it would
   commit their unfinished work. The entry for this pass belongs in HANDOFF as
   §199 and is the next writer's to add.
