# Walk-feature evidence — where students actually enter buildings, and what data exists

Recon pass, 2026-08-23, no code changed. Answers four questions Simeon asked for
research on, not assumption, before any builder lane touches `js/wayfind.js` or
`scripts/bake_entrances.py`: what OSM holds, what UT itself publishes, whether
lighting data exists, and a ranked heuristic for the real door — tested against
real numbers, not reasoned about.

**The headline finding wasn't on the question list: UT Austin publishes its own
official "celebrated entrance" dataset — the real front door of 67 campus
buildings, hand-surveyed, with accessibility notes — as a public ArcGIS layer.
Cross-checked against it, the app's current heuristic picks the wrong door
(more than 15 m off the real one) for roughly three buildings out of four that
can be checked. The single biggest lever here isn't a smarter guessing rule —
it's importing ground truth UT already published for free.**

---

## 0. Method

Every number below was either measured against a file in this repo on this
date, or fetched live from a public API/site on 2026-08-23 with the query
shown, so a future session can re-run it. No number is estimated or reasoned
from a description. Confidence marks follow the house convention from
`docs/entrances/`: **[M]** measured here, **[C]** cited to a source not
re-derived, **[D]** derived from an [M]/[C] by a stated argument.

---

## A. What OSM holds for UT entrances — freshly queried, not assumed stale

`docs/entrances/placement.md` (2026-08-04) measured 91 `entrance=*` nodes in
the wider survey bbox / 69 in the tight campus bbox. OSM is crowd-edited, so
this pass re-queried live rather than trusting a three-week-old number.

**Live Overpass query, 2026-08-23**, tight campus bbox
`(30.2795, -97.7420, 30.2930, -97.7255)` (same rectangle `placement.md` ships
with — Guadalupe / I-35 / MLK / north of Dean Keeton):

```
[out:csv(entrance)][timeout:25];
node["entrance"](30.2795,-97.7420,30.2930,-97.7255);
out body;
```
— run against `https://overpass-api.de/api/interpreter`. **[M]**

| `entrance=` | n | share |
|---|---|---|
| yes | 52 | 66% |
| main | 16 | 20% |
| staircase | 5 | 6% |
| emergency | 4 | 5% |
| exit | 2 | 3% |
| **total** | **79** | |

Up from 69 on 2026-08-04 — OSM gained ~10 campus entrance nodes in three
weeks, community edits, not drift in the method. **`entrance=main` is 20% of
what's tagged.** The other 80% ("yes") is real doors whose mapper didn't say
which one is the front one — exactly the gap the heuristic has to fill, and
exactly what `assign_roles()` in `scripts/bake_entrances.py` already tries to
do by promoting the best-scored candidate (more on why that specific step is
the weak link, §E).

**How much of that reaches the app's own file.** `data/entrances.geojson`
(the 656 door groups the app actually bakes and ships) has 295 buildings.
Measured directly **[M]**:

| | buildings | share of 295 |
|---|---|---|
| carry ≥1 OSM-sourced entrance node, any role | 31 | 11% |
| carry an OSM-sourced `entrance=main` node | **17** | **6%** |
| carry ZERO OSM-sourced door data — every door is `derived`/`authored`/`westcampus` | **264** | **89%** |

So the premise behind Simeon's complaint is exactly right: for 9 buildings out
of 10, there is no surveyed "this is the front door" fact anywhere in OSM.
Every one of those buildings' doors is a guess produced by the bake's
publicness-field scoring (`scripts/bake_entrances.py` stage 3) — a real,
carefully-built heuristic (facing a mapped path, plaza, or street; penalized
for service roads; §2785 `stage3_public`), but a guess.

---

## B. What UT itself publishes — and this is the finding worth leading with

`maps.utexas.edu` is an Esri ArcGIS Experience Builder app (item
`81d900a3c906482e9731a7a71eaaa178`) with a top-level **"Accessibility"**
category, built on a web map (`trecs.maps.arcgis.com`, item
`471f5223e6a0445cb7965ac86616e800`) whose data sources are public,
unauthenticated ArcGIS `FeatureServer` layers hosted at
`services9.arcgis.com/w9x0fkENXvuWZY26`. Three of them are exactly the "where
do students actually enter" data this task asked to go find:

- `Celebrated_Entrances_view` — **98 rows, 67 buildings [M]**
- `ADA_Celebrated_Entrances_view` — 86 rows (the barrier-free subset)
- `Non_ADA_Celebrated_Entrances_view` — 12 rows

Queried live 2026-08-23:
```
GET https://services9.arcgis.com/w9x0fkENXvuWZY26/arcgis/rest/services/
    Celebrated_Entrances_view/FeatureServer/0/query?where=1=1&outFields=*&f=json
```
This is UT Facilities' own hand-surveyed record of each building's real,
named entrance — the same effort behind the Division of Diversity and
Community Engagement's **Wayfinder Project**, which the Daily Texan covered
in 2019: the accessible-door map's purpose was letting a student "know in
advance" which door to head for, because "most buildings do have an
accessible entrance, but... many of UT's older buildings have staircases that
are still inaccessible" **[C]** ([The Daily Texan, Apr 9
2019](https://thedailytexan.com/2019/04/09/new-map-helps-students-find-accessible-entrances/);
program page: [compliance.utexas.edu/programs/iaa/wayfinding](https://compliance.utexas.edu/programs/iaa/wayfinding)).

**The schema is rich enough to use directly**, not just as a spot-check:
`Bldg_Abbr` (the same three/four-letter code the app already keys `ref` on),
`Longitude`/`Latitude`, `Directional` (compass side of the building — the
exact "which wall" signal the heuristic needs), `BarrierFree` (Y/N),
`AutoOpener` (Y/N), and a free-text `Description` that in practice reads like
field notes: *"Access point is off Inner Campus Drive, up the stairs... No
auto-opener is installed at this location"* vs. the barrier-free alternate on
the same building 30 m away. **[M]**, both quotes under 15 words, cited.

Coverage tally: **86/98 rows (88%) are `BarrierFree=Y`**; only one building
(`FSL`) has no barrier-free row at all in this layer. **23 of the 67
buildings carry more than one celebrated-entrance row** — i.e. UT itself
records that the ceremonial front door and the accessible door are two
different physical doors on many buildings (Batts: north entrance is up
stairs with no auto-opener; the barrier-free entrance is on the east side off
Inner Campus Drive — a different wall entirely). This directly answers "step
free routes" and "if someone can't climb stairs": **UT has already surveyed
it, per building, per door** — this doesn't need to be inferred from a path
network at all for these 67 buildings.

**Coverage caveat, stated plainly:** 67 of 295 app buildings (23%) appear in
this layer. It is the celebrated/landmark academic buildings — dorms,
West Campus private buildings, and utility structures are not in it. For the
other 77%, UT publishes nothing this pass could find, and the derived
heuristic (§E) is still what has to carry the weight.

---

## C. The test: UT's ground truth against what the app currently ships

Matched by building code (`Bldg_Abbr` ↔ app's `ref`), comparing UT's official
entrance coordinate to (a) the door the app's bake currently labels `role:
main` for that building, and (b) the app's *nearest* door of any role. **[M]**,
full script and raw JSON kept in this session's scratchpad; matching code:
nearest-point distance in metres via an equirectangular approximation, no
snapping tolerance games.

```
UT celebrated entrances matched to an app ref:      66 buildings
App's current "main" door within 15 m of UT's door:  18 buildings (27%)
App's current "main" door is the WRONG door
  (a closer, correctly-placed door exists in the
  app's OWN data, just labelled "secondary"):        48 buildings (73%)
UT refs with no app building at all (DMC, SSW):        2
```

**73% wrong is the number this task set out to find.** And it is not that the
door doesn't exist in the data — in every one of the 48 cases the *correct*
door is already sitting in `data/entrances.geojson`, correctly placed (often
within 1–5 m of UT's surveyed point), just carrying `role: secondary` instead
of `role: main`. Since `js/wayfind.js`'s `doorSet()` restricts routing
candidates to **only** `role: main` doors whenever a building has one
(`js/wayfind.js:797`, comment: *"role: main wins where a building has
one"*), the router is structurally blind to the correct door for most of
these buildings — not because the geometry is missing, but because one
mislabel hides it.

**Twenty buildings, ranked by how far out of the way the current mislabel
sends a pedestrian** — substituting for a hand-picked pair list (see the note
at the end of this section for why):

| Bldg code | Building | App's current "main" vs UT's real door | The correct door is already in the data, mislabelled | Distance a walker is sent past the real door |
|---|---|---|---|---|
| EER | Engr. Education & Research Ctr. | 71.9 m off | `secondary`, 15.6 m from UT's door | 56.3 m |
| JES | Beauford H. Jester Center | 54.6 m off | `secondary`, 2.8 m | 51.8 m |
| BME | Biomedical Engineering Building | 58.3 m off | `secondary`, 11.1 m | 47.2 m |
| NHB | Norman Hackerman Building | 85.6 m off | `secondary`, 42.7 m | 42.9 m |
| GDC | Gates Dell Complex | 35.8 m off | `secondary`, 2.0 m | 33.7 m |
| MEZ | Mezes Hall | 36.0 m off | `secondary`, 2.4 m | 33.6 m |
| WAG | Waggener Hall | 34.8 m off | `secondary`, 2.3 m | 32.5 m |
| MAI | Main Building | 53.1 m off | `secondary`, 23.2 m | 29.9 m |
| PMA | Physics, Math & Astronomy Bldg. | 33.3 m off | `secondary`, 5.5 m | 27.8 m |
| CMB | Jesse H. Jones Comm. Ctr. (B) | 24.9 m off | `secondary`, 0.7 m | 24.2 m |
| WCH | Will C. Hogg Bldg. | 25.1 m off | `secondary`, 0.9 m | 24.2 m |
| JGB | Jackson Geological Sciences | 42.8 m off | `secondary`, 19.0 m | 23.8 m |
| PHR | Pharmacy Building | 27.8 m off | `secondary`, 7.1 m | 20.7 m |
| PAT | J.T. Patterson Labs Bldg. | 33.4 m off | `secondary`, 14.4 m | 19.0 m |
| UA9 | 2609 University Avenue | 36.1 m off | `secondary`, 21.4 m | 14.7 m |
| PAI | T.S. Painter Hall | 18.8 m off | `secondary`, 4.4 m | 14.4 m |
| GAR | Garrison Hall | 53.0 m off | `secondary`, 40.0 m | 13.0 m |
| RLP | Patton Hall | 33.5 m off | `secondary`, 20.6 m | 12.9 m |
| MBB | Moffett Molecular Biology Bldg. | 16.8 m off | `secondary`, 4.3 m | 12.5 m |
| BIO | Biological Laboratories | 59.2 m off | `secondary`, 46.8 m | 12.4 m |

Note: **this substitutes for testing against the pairs a sibling "baseline"
lane was asked to pick** — this pass ran in an isolated worktree in the same
parallel round and that lane's selections were not committed to any branch
reachable here at the time of writing (checked: `worktree-wf_9103c8d4-6c9-1/
2/3` are all still at the same commit as `main`, nothing pushed). Rather than
guess at 20 buildings, this table is the actual worst 20 by measured error
against UT's own survey — a stronger test than a hand-picked list, but the
builder lane should still reconcile against whatever the baseline lane
produces, and re-run this exact query (§B) since it is cheap and live.

**A distance in this table understates the real walking cost** — it's
straight-line metres from the wrong door to the right one, not the extra
distance around a building footprint or block face a pedestrian pathfinder
would actually walk, which is typically larger. Turning this into an on-graph
number (route from a fixed approach point via the wrong door vs. the right
one) is the next thing to measure once the fix lands, with `scripts/verify/
doorwalk.mjs`, which already exists for exactly this.

---

## D. Street lighting — it exists, in two different places, neither wired to the router

The brief is right that `data/ground.geojson` has no `lit` tag on any way —
confirmed **[M]**, zero hits. But lighting data is not absent from this
project, it's just not where the router would look for it:

**1. OSM has it, live, as point features**, not way tags:
```
[out:json][timeout:25];
node["highway"="street_lamp"](30.2795,-97.7420,30.2930,-97.7255);
out count;
```
**111 `street_lamp` nodes** inside the tight campus bbox alone. **[M]**,
2026-08-23.

**2. The app has *already baked this in*.** `data/props.geojson` carries
**532 features tagged `k: "lamp"`** and **236 tagged `k: "lit"`**, every one
of them `"src": "osm"`, `"u": "street_lamp"` — i.e. the prop-placement bake
already pulled OSM's street-lamp nodes across the whole render area (a wider
footprint than the tight campus bbox, hence 532 > 111) and split them into a
dark pole geometry (`lamp`, all 532) and a subset that gets an emissive glow
at night (`lit`, 236 — 44% of poles). **[M]**, sampled directly.

**So the answer to "can lighting be sourced at all" is yes, with zero new
data collection** — the app is already carrying exactly the point layer a
route-safety score would need, it is simply invisible to `js/wayfind.js`
today (`grep -n "lamp\|lit\b" js/wayfind.js` — zero hits outside unrelated
words like "clamp"). Wiring it in is a matter of building a spatial index
over the existing 532 `lamp` props and scoring route segments by proximity —
no bake change required, no new fetch, and it reuses data another lane
already paid for. Simeon said not to over-focus here, so: this is a real,
cheap, already-collected signal, worth a small pass, not a research gap.

---

## E. The stairs gap is narrower than it looks — and door-level, not path-level

`js/wayfind.js` already has real infrastructure here, more than the brief
implied: `highway=steps` ways carry an `F_STEPS` flag, cost real seconds
(`stairFixedS`), and an **"Avoid stairs" checkbox already ships in the UI**
(`SAY.avoidStairs`, `state.avoid`, wired through `computeRoute`'s
`avoidStairs` option, `js/wayfind.js:1704`). That part of the ask is built.

**What's missing is one level down: `avoidStairs` changes the PATH cost, not
the DOOR choice.** `doorSet()` has no accessibility filter at all — it can
still hand a `avoidStairs`-mode walker a `role: main` door that itself sits
at the top of a flight, even though the walk to its threshold was flat the
whole way. Section B's own data proves this is a real, not theoretical, case:
Batts Hall's north entrance is *"off Inner Campus Drive, up the stairs...No
auto-opener is installed"* while its east and southwest entrances are
barrier-free — three different doors, two different accessibility states, on
one building. **[M]**, from UT's own field notes (§B). The fix is small:
carry `BarrierFree`/`AutoOpener` from the UT layer onto the matched door (or
a boolean flag on `derived` doors that the publicness-field's normal-test
already computes a threshold for), and have `doorSet()` drop non-barrier-free
doors from the candidate set when `avoidStairs` is on, same as it already
drops `F_STEPS` edges from the path.

---

## F. Sidewalks — two separate pipelines exist and should be checked for drift, not re-derived

The brief states `data/ground.geojson` has 1,324 `footway`-tagged and 179
`steps`-tagged features "already in the data and not being used." Traced
this **[M]**: that count is real (`u: "footway"` / `u: "steps"` on the
*rendered* pavement mesh), but it is a **different file from a different
pipeline** than the one the router actually reads. `scripts/bake_walk.py`
builds `data/walk_graph.json` from `data/osm_cache/footways.json` — a raw
Overpass cache of **3,430 ways** (3,098 footway / 189 steps / 55 pedestrian /
70 cycleway / 18 path), not from `data/ground.geojson` at all.

This is not necessarily a bug — `docs/walk/graph.md` and `docs/walk/
regraph.md` (2026-08-15, already in this repo) did the actual connectivity
work on that raw cache and found 94.26% single-component connectivity with
median 2.7 m door-to-network snapping, so the routing graph is not starved of
sidewalks in the way "not being used" might suggest. What this pass adds:
**the two pipelines are separate files that should agree in coverage and
currently aren't cross-checked against each other.** If `data/ground.geojson`
was baked from a newer or differently-filtered OSM snapshot than
`data/osm_cache/footways.json`, a sidewalk a pedestrian can SEE (rendered)
could be one the router can't route on, or vice versa — an easy, cheap
regression check for a builder lane (diff way counts/IDs between the two
sources on the next bake) rather than a re-litigation of the connectivity
work already on record in `docs/walk/graph.md`.

---

## G. The ranked heuristic — for the builder lane, in priority order

1. **UT's `Celebrated_Entrances_view` is truth, same standing OSM `entrance=
   main` already gets.** Match by building code within ~15–20 m (the largest
   *correct* match in §C's data was 15.3 m; every wrong one was >16 m — a
   clean separation), force that door's role to `main`, and carry
   `BarrierFree`/`AutoOpener`/`Directional` onto it as new fields. Covers 67
   buildings, fixes the wrong-door case for the 48 of them measured wrong
   today, costs one API fetch (cacheable, same as `footways.json` already is)
   and one join key that already exists (`ref`/`Bldg_Abbr`).
2. **OSM `entrance=main`** — already correctly treated as truth, unchanged.
   Covers the further ~17 buildings not in UT's layer that OSM itself
   pins down.
3. **For everything else, stop collapsing ties to a single door.** The real
   defect in `assign_roles()` (`scripts/bake_entrances.py:4667`) isn't the
   publicness scoring itself — the facing-the-path / plaza / street weights
   are reasonable — it's that the single best-scored candidate on a building
   becomes the ONLY door `doorSet()` will ever route to, even when a second
   candidate scores nearly as well (a real near-tie, not a clear winner).
   Concretely: keep every derived candidate whose score is within some
   `MAIN_TIE_BAND` of the top score (a new named constant, per CLAUDE.md
   rule 11 — start it at, say, 15% of the top score and let Simeon tune it)
   eligible as a routing target, not just the single highest scorer. This
   turns a guessed tie-break into "let Dijkstra pick the one that's actually
   closer to this particular walker," which is what should have been
   happening all along for the 89% of buildings with no OSM ground truth.
4. **Facing the desire line / mall / street, plaza in front, door width and
   count — already implemented**, in `stage3_public`'s publicness field
   (`W_FOOT/W_STEPS/W_PLAZA/W_STREET/W_SERVICE`, `docs/entrances/
   placement.md` §2). Nothing here found a reason to redo that scoring; the
   defect is downstream of it (role collapse + the router's hard filter),
   confirmed by the fact that the WRONG doors in §C's table are, themselves,
   real, plausibly-placed doors — just not the one a student actually uses.
5. **Accessibility as a first-class door attribute, not just a path
   avoidance.** Filter `doorSet()`'s candidates by `BarrierFree` when
   `avoidStairs` is set (§E) — cheap once UT's per-door flag is imported.
6. **Lamp proximity as a route-safety signal** using the 532 already-baked
   `props.geojson` `lamp` features (§D) — lower priority per Simeon's own
   "don't focus too much on this," but worth a small pass since the data
   requires zero new collection.

---

## What this pass does NOT establish

- Whether UT's `Celebrated_Entrances_view` covers doors this app draws for
  West Campus private towers or dorms — it doesn't (checked: 0 of the 67
  matched buildings are West Campus `src: westcampus` buildings). That
  population still needs the derived heuristic alone.
- The on-graph (not straight-line) extra-walk cost of the 48 wrong-door
  cases — flagged in §C as the next measurement, with the tool
  (`doorwalk.mjs`) already in the repo.
- Whether `data/ground.geojson`'s footway/steps mesh and `data/osm_cache/
  footways.json` actually agree in coverage — flagged in §F as a cheap check,
  not run here (would need a spatial diff, not just two counts).
- Any pixel/visual verification — this was a data and API recon pass with no
  browser opened, per the task brief; the house rule "prove the subject is on
  screen" applies to the NEXT pass, which will render something.

---

## Sources

- OpenStreetMap entrance and street-lamp data — live Overpass API query,
  2026-08-23, `https://overpass-api.de/api/interpreter` (queries quoted
  above). ODbL, © OpenStreetMap contributors.
- UT Austin campus map — [maps.utexas.edu](https://maps.utexas.edu/) (Esri
  ArcGIS Experience Builder, item `81d900a3c906482e9731a7a71eaaa178`).
- UT Austin Celebrated Entrances data (public ArcGIS FeatureServer, no
  auth required), queried live 2026-08-23:
  - `https://services9.arcgis.com/w9x0fkENXvuWZY26/arcgis/rest/services/Celebrated_Entrances_view/FeatureServer/0`
  - `https://services9.arcgis.com/w9x0fkENXvuWZY26/arcgis/rest/services/ADA_Celebrated_Entrances_view/FeatureServer/0`
  - `https://services9.arcgis.com/w9x0fkENXvuWZY26/arcgis/rest/services/Non_ADA_Celebrated_Entrances_view/FeatureServer/0`
- University Risk and Compliance Services, Wayfinding program —
  [compliance.utexas.edu/programs/iaa/wayfinding](https://compliance.utexas.edu/programs/iaa/wayfinding)
- Services for Students with Disabilities / Division of Diversity and
  Community Engagement — [disability.utexas.edu](https://disability.utexas.edu/)
  (accessibility checklist PDF located but not machine-readable as scanned;
  content not usable as a source here beyond confirming the office exists).
- "New map helps students find accessible entrances," *The Daily Texan*,
  Apr 9 2019 —
  [thedailytexan.com/2019/04/09/new-map-helps-students-find-accessible-entrances](https://thedailytexan.com/2019/04/09/new-map-helps-students-find-accessible-entrances/)
- In-repo, re-verified or cited: `data/entrances.geojson`, `data/props.geojson`,
  `data/ground.geojson`, `data/osm_cache/footways.json`, `data/walk_graph.json`,
  `js/wayfind.js`, `scripts/bake_entrances.py`, `scripts/bake_walk.py`,
  `docs/entrances/placement.md`, `docs/walk/graph.md`, `docs/walk/regraph.md`.

---

*2026-08-23, acer lane, recon only — no code touched, `WAYFIND.on` untouched.
Scratch scripts and the raw UT ArcGIS JSON pull are in the session scratchpad
if a builder lane wants to re-run the cross-reference against the current
`data/entrances.geojson` rather than trust this table after a rebake.*
