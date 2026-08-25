# The 11 unroutable buildings — recon for the schedule-import feature

Recon pass, 2026-08-24, no code changed, `WAYFIND.on` untouched. Answers one
question before any import builder lane touches `js/wayfind.js`: when a real
class schedule names BE1, BEG, EME, FS1, FSL, MER, PX3, ROC, SSW, SV1 or TCB,
what should the import feature actually do?

**Short answer: none of the 11 are a data gap this app can close this pass.**
All eleven are structurally unroutable — ten because they are 11 km outside
everything this map draws, one because the building was demolished two years
ago. The import feature's job is to say that plainly, not to error, not to
silently drop the class, and not to try to route to any of them.

---

## 0. What was re-verified, and how (nothing here is carried over on trust)

The brief's list came from a comment in `scripts/verify/walkmeter.mjs`
(around line 887-894). Every claim below was re-derived independently this
session, against a live server and live UT sources, not read off that
comment or off `docs/walk-door.md`'s prior write-up:

1. **Re-ran the live gate.** Served the repo on port 8901
   (`python scripts/serve.py 8901`), ran `node harness-drift.mjs` (PASS — the
   harness and `index.html` agree), then `node walkmeter.mjs` against that
   server. Its own output, today, on this commit:

   ```
   UT buildings this build cannot route to at all (11): BE1 BEG EME FS1 FSL MER PX3 ROC SSW SV1 TCB
   ```

   Same eleven codes, same order the brief gave. The list is current.

2. **Re-derived "off this map" from a completely different file than the
   one that made the original claim.** Not from `walk_graph.json` (which is
   what `walkmeter.mjs` reads) — from `data/ground.geojson`, the rendered
   pavement/ground mesh, walking every coordinate in every feature:

   ```
   ground.geojson bbox:  lat 30.231157–30.321774   lon -97.79607…-97.692655
   ```

   The rendered city's own footprint stops at **lat 30.3218**. All ten of the
   Pickle-cluster codes sit at **lat 30.382–30.392** — roughly **6.5 km north
   of the map's own northern edge**, not just "not in the walk graph." This
   is a second, independent confirmation using a file `walkmeter.mjs` never
   touches.

3. **Computed the distances myself**, haversine, from the campus centroid
   (30.2862, -97.7394) to each code's own coordinate as this repo already has
   it (`js/wayfind.js`'s `UT_CELEBRATED` table, line ~2463 area):

   | code | km from main campus |
   |---|---|
   | SV1 | 10.78 |
   | MER | 11.13 |
   | FS1 | 11.22 |
   | PX3 | 11.28 |
   | FSL | 11.28 |
   | TCB | 11.29 |
   | EME | 11.55 |
   | ROC | 11.68 |
   | BEG | 11.73 |
   | BE1 | 11.80 |
   | **SSW** | **0.89** |

   Ten cluster tightly at 10.8–11.8 km — matching the brief's "~11 km" almost
   exactly. SSW is the outlier at under a kilometre: it is not part of this
   cluster at all, and treating it as "the eleventh Pickle building" (which
   the brief's phrasing invites) would be wrong.

4. **Checked UT's own live building directory today**, not a cached file —
   fetched `utdirect.utexas.edu/apps/campus/buildings/information/nlogon/maps/`
   directly (2026-08-24): it is UT's alphabetical Main Campus register, and
   **SSW does not appear in it.** Cross-checked against this repo's own
   `data/ut_buildings.json` (retrieved 2026-08-05, same source): also zero
   hits for all eleven codes, confirmed programmatically.

5. **Checked why SSW is missing, which no prior doc in this repo asked** —
   web search plus a live fetch, below (§2).

6. **Checked whether any of the eleven have a building footprint anywhere in
   this app at all** — not just missing router data. Searched
   `data/snapshots/2026-08-24/buildings.detailed.geojson` (2,453 features,
   the actual basemap polygons drawn on screen) for any of the eleven codes
   and for the string "social work": zero matches, all eleven. Searched
   `data/entrances.geojson` (16,663 features, every door the app ever
   places): zero matches. Searched `walk_graph.json`'s own `code` index:
   zero matches. **There is nothing to click on screen for any of these
   eleven — not a mislabelled door, not an unrouted footprint, nothing.**

7. **Checked what a student actually sees today.** Loaded the real page,
   forced the walk graph to load (`window.wayfindDoors('WEL')`, which the
   real UI does on first use), then called the same `window.wayfindSearch()`
   the search box itself calls:

   ```
   WEL [{"code":"WEL","name":"Robert A. Welch Hall","routable":true,"doors":7}]
   MAI [{"code":"MAI","name":"UT Tower","routable":true,"doors":7}]
   WWH [{"code":"WWH","name":"Walter Webb Hall","routable":true,"doors":2}]
   SSW []
   BEG []
   MER []
   BE1 []
   TCB []
   ROC []
   EME []
   FS1 []
   FSL []
   PX3 []
   SV1 []
   ```

   Every working code (including WWH, chosen because it is the School of
   Social Work's current temporary home — see §2) returns a real result. All
   eleven gap codes return **an empty array — not a "not walkable yet"
   placeholder, not an error, nothing at all.** That distinction matters for
   the design recommendation in §5.

Cleanup: server on 8901 killed, port confirmed free by `netstat` after; the
one scratch script this check needed (`scripts/verify/tmp_check_search.mjs`)
was deleted immediately after the run, nothing left in the repo.

---

## 1. Category (a): ten buildings, genuinely off this map — J.J. Pickle Research Campus

BE1, BEG, EME, FS1, FSL, MER, PX3, ROC, SV1, TCB. Confirmed live against
UT's own building-information pages (not assumed from a prior doc):

| code | UT building | source |
|---|---|---|
| BEG | Bureau of Economic Geology, 10611 Exploration Way | [utdirect prc/beg](https://utdirect.utexas.edu/apps/campus/buildings/information/nlogon/maps/prc/beg/) |
| MER | Microelectronics & Engineering Research Center, 10100 Harry Ransom Trail | [utdirect prc/mer](https://utdirect.utexas.edu/apps/campus/buildings/information/nlogon/maps/prc/mer/) |
| ROC | Research Office Complex, 10601 Exploration Way | [utdirect prc/roc](https://utdirect.utexas.edu/apps/campus/buildings/information/nlogon/maps/prc/roc/) |
| EME | Electrical/Mechanical Engineering Research Center, 10500 Exploration Way | [utdirect prc/eme](https://utdirect.utexas.edu/apps/campus/buildings/information/nlogon/maps/prc/eme/) |
| TCB | J. Neils Thompson Commons, 2901 Read Granberry Trail | [utdirect prc/tcb](https://utdirect.utexas.edu/apps/campus/buildings/information/nlogon/maps/prc/tcb/) |

(BE1, FS1, FSL, PX3, SV1 not individually confirmed by name this pass — the
search engine did not surface their utdirect pages directly — but all five
carry the same `prc/` (Pickle Research Campus) URL pattern as their
neighbours in `utdirect`'s own directory-listing page, and all five sit
inside the identical 10.8–11.8 km / lat 30.38–30.39 cluster measured
independently in §0.3 from coordinates that are already in this repo. That
is enough to place them, not enough to name their buildings; naming them is
a two-minute follow-up (`utdirect.../prc/be1/` etc.), not blocking.)

**This is not a missing-data bug.** The whole rendered city stops at lat
30.3218 (§0.2); Pickle Research Campus starts at 30.38. There is no
`ground.geojson` polygon, no OSM way, no basemap tile for anything up there
— the app was never built to draw that campus at all. Nothing to place a
door on, nothing to route pavement across. Fixing this would mean extending
the entire map's geographic footprint 11 km north, which is not a
schedule-import task.

## 2. Category (a), second reason: SSW — demolished, not merely unmapped

The task brief's "SSW is reportedly not in UT's own building register at
all" turned out to be true, but the *reason* is the actual finding, and it
changes how the import feature should talk about this one code.

**SSW is (was) the Steve Hicks School of Social Work Building, 1925 San
Jacinto Blvd — a real Main Campus building, 0.89 km from campus centre, not
part of the Pickle cluster.** It is currently absent from every layer this
app or UT itself checks, for a specific reason:

- UT began demolishing it **23 September 2024** to build a football
  training facility, over public objection from a preservation group
  ([The Daily Texan, 7 Oct 2024](https://thedailytexan.com/2024/10/07/demolition-of-social-work-building-begins-despite-opposition-from-preservation-group/);
  [KVUE](https://www.kvue.com/article/news/education/university-of-texas/ut-austin-demolishing-steve-hicks-social-work-school/269-f860f665-fc66-4cc4-9c57-6fc0eb9943de)).
- The school itself moved out to **Walter Webb Hall (WWH)** at the end of
  spring 2024 — which is already a routable building in this app, confirmed
  in §0.7 — and is slated to stay there roughly four years before moving
  into the current McCombs building.
- The $70M training facility replacing SSW was reported as due to complete
  **around August 2026** — i.e. right now, as this report is written.
- **Confirmed live today (2026-08-24):** fetching UT's own Main Campus
  building directory
  (`utdirect.utexas.edu/apps/campus/buildings/information/nlogon/maps/`)
  returns no entry for SSW at all. The only "SS"-prefixed code on it is SSB
  (Student Services Building), unrelated.

**The one thing worth flagging loudly for whoever touches
`scripts/bake_entrances.py --refresh-ut` next:** UT's *other* public data
source — the `Celebrated_Entrances_view` ArcGIS layer this app already
imports (`js/wayfind.js`'s `UT_CELEBRATED` and `UT_ENTRANCES` tables) — has
**not** caught up. Queried live just now:

```
GET https://services9.arcgis.com/w9x0fkENXvuWZY26/arcgis/rest/services/
    Celebrated_Entrances_view/FeatureServer/0/query?where=Bldg_Abbr='SSW'&outFields=*&f=json
```

still returns **two "Active" rows** for SSW's northwest and southwest
doors, full accessibility metadata, as if the building still stood — which
is exactly the two rows already sitting in this file's own `UT_CELEBRATED`
table (lines 2540-2541) and `UT_ENTRANCES` (SSW is absent there, having
never had coordinates that placed cleanly — worth re-checking on the next
refresh). **UT's two public sources disagree with each other right now: the
authoritative building register has retired SSW, the celebrated-entrances
layer has not.** A future `--refresh-ut` run that trusts the ArcGIS layer
alone will re-import a demolished building's doors as live ground truth.
This report is the flag; the fix (skip any `UT_CELEBRATED`/`UT_ENTRANCES`
code absent from `data/ut_buildings.json`, or hand-exclude SSW) belongs to
whoever next runs that refresh, not to this recon pass.

## 3. Category (b): on-campus and fixable

**None of the eleven.** Every one of the checks in §0.6 came back empty —
no footprint, no door, no graph node, for any of the eleven, anywhere in
this app's own data. This is a different finding from "the door is
mislabelled" or "the pavement doesn't connect" (the kind of gap
`docs/walk-evidence.md` and `docs/walk-door.md` found and fixed for other
buildings) — there is nothing here to relabel or reconnect. Ten are outside
the map's own geography; one no longer physically exists. If a future pass
wants to extend routing to the Pickle Research Campus, that is a real new
scope (a second map footprint, a second OSM pull, a second bake) — not a
bug in this one.

---

## 4. What happens today when a schedule names one of these codes

This is the part that matters for the import feature, so it was checked
live rather than assumed (§0.7). Typing any of the eleven into the existing
search box, or calling `window.wayfindSearch()` (the same function the
search box calls) with any of the eleven, returns a bare empty array.

This is *worse* than the graceful path this file already has for other
missing buildings. `js/wayfind.js:2244-2261` already merges every code in
`data/ut_buildings.json` that the walk graph lacks into a findable, honest,
non-routable entry — typing one of those 63 gets you a real search result
and the card says *"X is not walkable in this build yet"* rather than
nothing. That mechanism does not reach the eleven in this report, because
all eleven are **also** absent from `data/ut_buildings.json` itself (§0.4)
— the merge has nothing to attach a placeholder to.

So today, a class-schedule string containing "SSW" or "BEG" or any of the
other nine has literally nothing in this codebase to resolve it against, not
even the graceful placeholder. An import parser that naively calls
`resolve()`/`search()` on an extracted building code and assumes a null
result always means "typo, ask the user to fix it" will do exactly that to
a perfectly correctly-typed SSW or BEG — which is the wrong message for a
code that is real, just genuinely gone or genuinely off this map.

## 5. What the schedule-import feature should do about it — the seam, exactly

The feature's job, per the task brief, is turning `"MAI 220, TTh 2:00pm"`
into the code `MAI`, then handing that code to the exact same
`resolve()`/`search()` seam described above (`js/wayfind.js` ~line 2311 for
`search()`, ~2400 for `resolve()`, and the register merge at 2244-2261 that
already produces graceful non-routable placeholders for the other 63 gap
codes). Recommendation, in priority order, for whoever builds that feature:

1. **Never let a null `resolve()` result crash the import or silently drop
   the class.** Every class the parser extracted a building code for should
   still land in the student's schedule list — the walking-directions
   feature is additive, not a gate on whether a class exists.
2. **Distinguish "unknown/typo" from "known but not on this map."** A tiny
   explicit lookup table is the right size for this — the same pattern this
   file already uses for `UT_ENTRANCES`/`UT_CELEBRATED` (literal arrays,
   easy to read, easy to extend, no bake dependency). It does not belong in
   `data/ut_buildings.json` (that file is a straight transcription of UT's
   own register and SSW's absence from it is *correct*, not a bug to patch
   around) and it does not belong in the register merge at
   `js/wayfind.js:2244-2261` (same reason — that merge's whole point is
   "UT still recognises this code," which is false for all eleven). It
   belongs in the schedule-import module itself, once it exists, as its own
   small table:

   ```js
   // codes a real UT schedule can name that this map cannot route to,
   // and why — so the import can say something true instead of nothing.
   const OFF_MAP_BUILDINGS = {
     BE1: 'J.J. Pickle Research Campus, ~11 km north — outside this map',
     BEG: 'J.J. Pickle Research Campus, ~11 km north — outside this map',
     EME: 'J.J. Pickle Research Campus, ~11 km north — outside this map',
     FS1: 'J.J. Pickle Research Campus, ~11 km north — outside this map',
     FSL: 'J.J. Pickle Research Campus, ~11 km north — outside this map',
     MER: 'J.J. Pickle Research Campus, ~11 km north — outside this map',
     PX3: 'J.J. Pickle Research Campus, ~11 km north — outside this map',
     ROC: 'J.J. Pickle Research Campus, ~11 km north — outside this map',
     SV1: 'J.J. Pickle Research Campus, ~11 km north — outside this map',
     TCB: 'J.J. Pickle Research Campus, ~11 km north — outside this map',
     SSW: 'demolished 2024 for the football training facility — the ' +
          'School of Social Work moved to Walter Webb Hall (WWH)',
   };
   ```

   (A named constant per building, not a magic string test — CLAUDE.md rule
   11 — and the values are exactly the sentences this report already
   verified, not new copy invented for the UI.)
3. **Show the class with an honest note instead of a route.** "PX3 · no
   walking directions — this building isn't on this map" reads very
   differently from a silent gap or a raw error, and for SSW specifically,
   *"SSW was demolished in 2024 — this class is probably actually at Walter
   Webb Hall"* is worth the extra clause given how directly it's confirmed
   above (§2) — a real, current, low-effort kindness to a student whose
   schedule export is simply stale.
4. **This is the shape a future image-OCR or Registration-Plus source needs
   too**, per the brief's forward-compat requirement: whatever surface
   extracts a building code from a photo or an API response instead of a
   pasted schedule string, it should funnel through the same
   `resolve()` → `OFF_MAP_BUILDINGS` → graceful-note path, not grow its own
   copy of this logic. Nothing about this recommendation is import-source
   specific.
5. **Don't build routing to Pickle Research Campus this pass.** It is real
   scope (new basemap footprint, new OSM pull, new bake), not a bug fix, and
   nothing in the brief asked for it.

---

## Sources

- `scripts/verify/walkmeter.mjs` — live re-run, 2026-08-24, port 8901,
  `harness-drift.mjs` PASS first.
- `data/ground.geojson`, `data/ut_buildings.json`, `data/walk_graph.json`,
  `data/entrances.geojson`, `data/snapshots/2026-08-24/buildings.detailed.geojson`
  — all queried directly this session, counts and bboxes computed fresh.
- `js/wayfind.js` `UT_CELEBRATED` (~line 2463) and `UT_ENTRANCES` (~line
  3596) tables — coordinates used for the distance table in §0.3.
- UT Austin Main Campus building directory (live), 2026-08-24 —
  [utdirect.utexas.edu/apps/campus/buildings/information/nlogon/maps/](https://utdirect.utexas.edu/apps/campus/buildings/information/nlogon/maps/)
  and per-building pages for BEG, MER, ROC, EME, TCB linked in §1.
- UT Austin Celebrated Entrances (live ArcGIS FeatureServer, no auth),
  queried 2026-08-24 for `Bldg_Abbr='SSW'` —
  [services9.arcgis.com/.../Celebrated_Entrances_view/FeatureServer/0](https://services9.arcgis.com/w9x0fkENXvuWZY26/arcgis/rest/services/Celebrated_Entrances_view/FeatureServer/0)
- "Demolition of Social Work building begins despite opposition from
  preservation group," *The Daily Texan*, 7 Oct 2024 —
  [thedailytexan.com/2024/10/07/demolition-of-social-work-building-begins-despite-opposition-from-preservation-group](https://thedailytexan.com/2024/10/07/demolition-of-social-work-building-begins-despite-opposition-from-preservation-group/)
- "UT Austin begins demolition at Steve Hicks School of Social Work site to
  make way for football training facility," KVUE —
  [kvue.com/article/news/education/university-of-texas/ut-austin-demolishing-steve-hicks-social-work-school/269-f860f665-fc66-4cc4-9c57-6fc0eb9943de](https://www.kvue.com/article/news/education/university-of-texas/ut-austin-demolishing-steve-hicks-social-work-school/269-f860f665-fc66-4cc4-9c57-6fc0eb9943de)
- Prior in-repo write-ups, read but not trusted without re-derivation:
  `docs/walk-door.md` §4 (round-3 door lane, 2026-08-23),
  `docs/walk-evidence.md` §C (recon, 2026-08-23).

---

*2026-08-24, recon only — no code touched, `WAYFIND.on` untouched. Port 8901
served and freed within this session; nothing else in the repo was left
running.*
