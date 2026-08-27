# Campus ground truth — target set

Real, sourced facts for the 16 UT Austin buildings this round targets for the entrances/facades detail pass QUEUE asked for. Every number in every `<CODE>.md` file here, and in `data/campus_truth.json`, has a citation — an unsourced number is a guess, and this round exists to remove those.

## The 16 buildings, and why these and not others

198 UT Austin buildings exist in `data/ut_buildings.json`; most are never on screen during the reel or a typical walking path, and 198 is too many to source rigorously in one round. This round picked the buildings that actually matter: what the camera flies past (`TOUR`/`AP_TOUR` in `js/app.js` — down the Drag, up the South Mall to the Tower, a quarter-orbit, out to DKR), what a student walks between (the West Mall plaza, the South Mall halls, the Six Pack quad), and what has a genuinely distinctive real facade worth getting right.

| Code | Building | Why it's in this round |
|---|---|---|
| **BAT** | Batts Hall | see CAL -- part of the same deliberately matched "Six Pack" trio. |
| **BTL** | Battle Hall | one of the four halls the camera flies past on "up the South Mall to the Tower"; a richly documented, non-generic Beaux-Arts facade a generic grid currently flattens. |
| **BUR** | Burdine Hall | one of the tallest, most visible academic buildings (8 floors); the deliberate CONTROL CASE -- a building whose real facade genuinely is close to a uniform punched-window grid, so this set is not skewed entirely toward "everything is bespoke". |
| **CAL** | Calhoun Hall | the "Six Pack" trio (with BAT, HRH) is a real, deliberately matched set built together in the 1950s-60s -- a second control case (a family where SHARING one template is architecturally correct) sitting on a heavily walked block between the South Mall and 21st Street. |
| **GAR** | Garrison Hall | same South Mall approach; carries a real, sourced, non-generic decorative program (carved founders' names, cattle-brand medallions) worth checking a fix against. |
| **GOL** | Goldsmith Hall (School of Architecture) | directly on Inner Campus Drive next to Battle Hall; a real, heavily used building (labelled "ARCHITECTURE", visible bike traffic) with solid Commons coverage. |
| **GRE** | Gregory Gymnasium | one of the most structurally distinctive buildings on campus (raked gable, corbel tables, triple-arch entrance), and already has a partial, real fix in data/roofs.geojson this ground truth can be checked against. |
| **HRH** | Homer Rainey Hall | see CAL -- part of the same deliberately matched "Six Pack" trio. |
| **JGB** | Jackson School of Geosciences | another large (200k sq ft) modern building with a clean, well-documented, genuinely regular grid -- a second "close to uniform is actually fine here" data point, distinct in era and material from Burdine. |
| **LFH** | Littlefield House | the single most visually distinctive building on campus (a unique Victorian mansion, National Register of Historic Places) on the northern approach near the Drag/West Mall corridor; the strongest possible proof that "uniform primitives are the null hypothesis" is wrong for at least one high-visibility building. |
| **MAI** | Main Building ("the Tower") | the literal centre of both camera tours -- TOUR dwells on it and quarter-orbits it, AP_TOUR keeps it dead ahead for the first half of the flight -- and the single most recognised building on campus. |
| **PCL** | Perry-Castañeda Library | the biggest library on campus, heavily walked past; its blank-wall-with-one-window-band reality is the single most extreme rebuttal to "every building gets a window grid", worth having in the set specifically to prove that null. |
| **SUT** | Sutton Hall | same South Mall approach as Battle Hall, its architectural companion piece. |
| **UNB** | Union Building (Texas Union) | sits on the West Mall plaza between the Drag and the core campus -- the building most students physically enter multiple times a week -- with an unmistakable, unambiguous carved entrance and a rich multi-part facade. |
| **WAG** | Waggener Hall | same South Mall approach; already flagged in the bake script's own comments as "THE REGRESSION FIXTURE" for entrance placement -- worth carrying the same status into facade ground truth. |
| **WEL** | Robert A. Welch Hall (Chemistry) | a large (430k sq ft), 7-floor building with an unambiguous labelled entrance and strong documentation, anchoring the northeast quad near Speedway. |

**Deliberately left for a later round:**

The three 'hero' buildings (EER, GDC, NHB) already have bespoke authored facades in js/heroes.js -- not part of this round's atlas-template problem, so left alone. DKR-Memorial Stadium is on the camera's TOUR flight path but is already a distinct, separately modelled megastructure (data/stadium.geojson), not a template-grid building. The remaining ~180 UT Austin buildings are real buildings too, but most are never on screen during the reel or a typical walking path, and 198 is too many for one round to source rigorously -- the task brief said so itself. HABS/HAER was checked and came back empty for every UT Austin main-campus building tried (Old Main, Sutton, Battle, Littlefield all zero hits) -- not usable regardless of which buildings this round had picked. Mapillary and Google Street View are both blocked without a client token/API key (confirmed twice this round, no keyless path even to a coverage check) -- this ground truth relies on Wikimedia Commons, UT Direct, UT's own facilities survey, Austin's LiDAR footprints, and OSM instead.

## Sources used

- **OSM / Overpass** — building footprints, `entrance=yes/main` nodes, and the footway/path/pedestrian/steps network (fresh queries this round, not cached).
- **City of Austin's official building-footprint LiDAR data** (`UTILITIESCOMMUNICATION_building_footprints_2017`, ArcGIS FeatureServer, public domain) — real measured `MAX_HEIGHT` per footprint, in feet.
- **UT Direct's own facilities register** (`utdirect.utexas.edu/apps/campus/buildings/information/nlogon/maps/UTM/<CODE>/`, no login wall) — official floor count and gross square footage per building.
- **UT Facilities' own hand-surveyed "celebrated entrance" table** — already fetched into this repo at `UT_CELEBRATED` in `scripts/bake_entrances.py` (2026-08-23, from UT's own ArcGIS FeatureServer), covering 97 doors on 67 campus buildings. This is the single best entrance source found: an official survey, not a proxy.
- **Wikimedia Commons** — one CC-licensed reference photograph per building, viewed and hand-counted for its window grid. License and photographer recorded per building; nothing here needed checking for rights beyond the per-file Commons metadata, which was pulled programmatically and is CC0/CC BY/CC BY-SA in every case used.
- **This app's own baked data** (`data/entrances.geojson`, `data/snapshots/<date>/buildings.detailed.geojson`, `js/facades.js`) — read, not guessed at, to state precisely what the app currently does for each of these 16 buildings, so the ground truth above can be scored against the real running app rather than a description of it.

HABS/HAER (Library of Congress) was checked and came back empty for every UT Austin main-campus building tried — not usable here. Mapillary and Google Street View are both blocked without a client token/API key — confirmed blocked twice this round, with no keyless path even to a coverage check.

## Scoring: entrances

"Within 10 m of the real door" is measured against UT's own official facilities survey where it exists (12 of the 16 target buildings), and against this repo's own hand-authored CELEBRATED coordinates (themselves OSM `entrance=main`-sourced) for 2 more (Battle Hall, Gregory Gym) that UT's survey doesn't cover — 14 of 16 sourced in total. The bake script's own UT-relabelling stage uses a 12 m match radius, which this table follows.

| Code | Building | Entrance check |
|---|---|---|
| **BAT** | Batts Hall | OK (0.8 m, main) |
| **BTL** | Battle Hall | OK (1.4 m, main) |
| **BUR** | Burdine Hall | OK (3.7 m, main) |
| **CAL** | Calhoun Hall | OK (8.1 m, main) |
| **GAR** | Garrison Hall | OK (4.2 m, main) |
| **GOL** | Goldsmith Hall (School of Architecture) | OK (1.3 m, main) |
| **GRE** | Gregory Gymnasium | OK (1.0 m, main) |
| **HRH** | Homer Rainey Hall | OK (4.0 m, main) |
| **JGB** | Jackson School of Geosciences | MISLABELLED (11.5 m away but role=secondary) |
| **LFH** | Littlefield House | not UT-surveyed |
| **MAI** | Main Building ("the Tower") | MISLABELLED (7.3 m away but role=secondary) |
| **PCL** | Perry-Castañeda Library | MISS (12.3 m, just outside 12 m) |
| **SUT** | Sutton Hall | OK (2.3 m, main) |
| **UNB** | Union Building (Texas Union) | not UT-surveyed |
| **WAG** | Waggener Hall | OK (2.7 m, main) |
| **WEL** | Robert A. Welch Hall (Chemistry) | OK (4.7 m, main) |

**11 of 16** have their real front door correctly placed AND correctly labelled `main`, checked against UT's own survey or this repo's own cited entrance sources. **2 of 16** (Main Building, Jackson Geosciences) have the geometrically correct door already sitting in the data within a few metres of the real one — but it is tagged `secondary` (or `exit`) while a door tens of metres away on a different wall wears `main`. **1 of 16** (Perry-Castañeda Library) is a close miss, 12.3 m against a 12 m tolerance — plausibly explained by PCL's real entrance being on the second floor off a plaza, not a ground-level door. **2 of 16** (Texas Union, Littlefield House) have no authoritative source coordinate at all; Texas Union's own CELEBRATED entry in `scripts/bake_entrances.py` says so explicitly ("THE BIGGEST HOLE IN THE SPEC").

**This is a better-than-average subset, and that is worth saying plainly.** These 16 were picked because they are the famous, visible buildings — which are exactly the ones a prior round already gave hand-authored or UT-surveyed attention. `scripts/bake_entrances.py`'s own header comment states the campus-wide picture is worse: the heuristic pass gets the `main` door right on only 16 of 55 routable buildings before the UT-survey stage runs at all (see `docs/walk-door.md`). Simeon's complaint about entrances is real; it is just sharper outside this set than inside it.

## Scoring: facades

`js/facades.js`'s `familyFor()` was run, in Python, on each building's OWN baked `final_height` / `building_class` (from `data/snapshots/*/buildings.detailed.geojson`) — not a guess about what it does, the actual function's actual logic on the actual data.

| Code | Building | Real window grid (from photo) | App's current template |
|---|---|---|---|
| **BAT** | Batts Hall | The photograph shows the entrance pavilion only -- tree canopy hides the long wings, and that limit is stated rather than papered over. | 8×5 punched grid |
| **BTL** | Battle Hall | East elevation, 2 storeys over a rusticated limestone base, counted off the photograph. | 8×5 punched grid |
| **BUR** | Burdine Hall | A 1970 Brutalist brick tower. | 8×5 punched grid |
| **CAL** | Calhoun Hall | Ground arcade of round arches (partly tree-obscured in the photograph, ~5-6 visible). | 8×5 punched grid |
| **GAR** | Garrison Hall | Ground floor: 3 round arches (the arcade), flanked outside the arcade by barred windows. | 8×5 punched grid |
| **GOL** | Goldsmith Hall (School of Architecture) | The long west wing (around the corner from the entrance) has a regular row of multi-light double-hung windows at both ground and 2nd floo... | 6×5 punched grid |
| **GRE** | Gregory Gymnasium | NOT a repeating rectangular grid -- a raked Romanesque gable end, counted off the photograph. | 8×5 punched grid |
| **HRH** | Homer Rainey Hall | 2-storey limestone elevation under a red clay tile hip roof with a dormer. | 8×5 punched grid |
| **JGB** | Jackson School of Geosciences | A plain modern brick grid: 2-light (roughly 1-over-1) rectangular windows, one per bay, with soldier-course brick lintels and sills. | 8×5 punched grid |
| **LFH** | Littlefield House | NO repeating grid. | 6×5 punched grid |
| **MAI** | Main Building ("the Tower") | South (entrance) elevation, 3-tier limestone base pavilion, each tier 7 bays wide and counted directly off the photograph: (1) ground -- ... | 9×5 punched grid |
| **PCL** | Perry-Castañeda Library | THE key finding for this building. | 8×5 punched grid |
| **SUT** | Sutton Hall | Corner (north + west) view. | 8×5 punched grid |
| **UNB** | Union Building (Texas Union) | Not a uniform grid. | 6×5 punched grid |
| **WAG** | Waggener Hall | A flat, symmetric, unobstructed elevation, and a strong reference photograph. | 8×5 punched grid |
| **WEL** | Robert A. Welch Hall (Chemistry) | The central entrance tower is 4 stacked storeys of single windows in an ornamented Spanish/Churrigueresque pilaster surround (fluted colo... | 8×5 punched grid |

**12 of the 16 (75%) render with the literal same 8-row-by-5-column grid today** — `mh`, "4-7 storey campus halls" — regardless of whether the real building has 2 storeys (Battle Hall, Garrison Hall, Homer Rainey Hall) or 8 (Burdine Hall), arched Beaux-Arts windows (Battle Hall, Sutton Hall) or narrow Brutalist slots (Burdine Hall), or in Perry-Castañeda Library's case, almost no windows at all over most of its walls. 3 more (Goldsmith Hall, Union Building, Littlefield House) get the 6×5 `mr` template meant for "2-3 storey walk-ups" — on a 5-floor architecture school, a 5-floor student union with a round-arched arcade and a tower, and a one-of-a-kind 1894 Victorian mansion. Main Building gets a 9×5 `tr` tower grid painted uniformly across BOTH its 3-storey limestone base (which is really three different 1×7 bands) and its narrower 27-floor tower shaft (really 4 columns), as one shape.

**At most 1 of 16 plausibly matches**: Jackson Geosciences, whose real 7 floors and ~4-5 real window columns per bay roughly line up with the assigned 8 rows × 5 columns (and even that is only confirmed on one photographed wing, not the whole building). Burdine Hall's real row count (8 floors) happens to match the assigned 8 rows, but its real column count (~11-12 narrow slot windows per floor) and window shape do not, so it is not counted as a match. Every other building in the set is a clear miss, either in row/column count or, for Perry-Castañeda, Littlefield House, Gregory Gymnasium, Union Building and Main Building, in KIND — none of those five is a uniform rectangular grid at all.

## Control cases worth keeping in mind

Not everything here needs a bespoke fix. **Burdine Hall** really is close to a uniform punched-window grid — a genuine 1970 Brutalist tower with a repeating pier-and-slot rhythm — so a parameterised grid is the right shape of answer there, just not this specific one. **Batts Hall, Calhoun Hall and Homer Rainey Hall** were built together in the 1950s-60s as a deliberately matched trio (the "Six Pack"); sharing ONE template across those three specific buildings would be architecturally honest, unlike sharing it with the other 13.

## How this was measured

Per the house playbook: derive the rule, then prove it reproduces every cited example before drawing anything. For each of the 16 buildings this meant, in order: (1) fetch the building's real OSM footprint polygon and match it against the Austin LiDAR footprint layer by exact polygon intersection (not a buffer box — an early pass with a 45 m buffer box pulled in neighbouring South Mall buildings' heights and had to be redone); (2) fetch UT Direct's own facilities page for the official floor count and square footage; (3) fetch every `entrance=*` OSM node and every footway/path/pedestrian/steps way in the campus core, and compute the nearest one to each building's footprint; (4) search Wikimedia Commons for that specific building, check each candidate photo's license via the API (not assumed), download the best one, and actually look at it — cropping to a band and re-viewing where a raw eyeball count was ambiguous (Main Building's arcade, Perry-Castañeda's window band, Gregory Gymnasium's gable tiers all got this treatment); (5) cross-check the resulting door location against `scripts/bake_entrances.py`'s own `CELEBRATED` and `UT_CELEBRATED` tables, which turned out to already carry real, sourced, confidence-marked entrance data for 12 of the 16 — using that rather than re-deriving it from scratch where it existed; (6) read what the running app's own baked files actually contain for each of the 16 (`data/entrances.geojson` by `role`, `data/snapshots/<date>/buildings.detailed.geojson` by `bid`, and `js/facades.js`'s `familyFor()` re-executed against that data in Python) rather than assuming what it does.

Every fetch this round was a live, direct request (Overpass, Austin's ArcGIS FeatureServer, UT Direct, Wikimedia Commons) — nothing was answered from memory or reused from a stale cache.
