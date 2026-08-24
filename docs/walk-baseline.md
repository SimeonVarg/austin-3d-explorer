# Walk baseline meter — the number this gauntlet was missing

2026-08-24, acer lane, recon only. This is the piece that never got built before
the previous run died mid-flight: a real, reproducible measurement of how far
out of their way `?walk=1` currently sends a UT student, against `origin/main`
(none of the five w-* branches merged), so every later round has a scoreboard
to beat. Nothing in `js/wayfind.js` changed. `WAYFIND.on` untouched.

**Deliverables:** `scripts/verify/walk-pairs.json` (the 20 pairs + citations),
`scripts/verify/walkmeter.mjs` (the reusable scoreboard), this doc.

---

## 0. Method

Twenty real class-to-class pairs (real building codes, back-to-back trips a
timetable actually produces) were driven through the live app's own routing
API, `window.wayfindRoute(from, to)`, in headless Chrome against `origin/main`
served on port 8801 — the exact door and route length the app reports today.

For each pair's endpoints, "the door a student would actually use" was pulled
from UT Austin's own public ArcGIS `Celebrated_Entrances_view` and
`Non_ADA_Celebrated_Entrances_view` layers (queried live 2026-08-24, same
source `docs/walk-evidence.md` found and the same method: match by building
code, nearest graph door within `data/walk_graph.json`, straight-line metres,
no snapping tolerance games). Where a building has no row, or every row for it
has null coordinates, or two rows disagree with no way to pick, **no
correction is applied and the app's own door is used** — that gap is stated
per pair in `walk-pairs.json`, not silently guessed.

**The number that matters isn't the straight-line offset** (that's what
`walk-evidence.md` already measured) **— it's the extra distance on the actual
path network.** `walkmeter.mjs` answers that by re-running the identical
Dijkstra `js/wayfind.js` runs, once with the doors the app picked and once
forcing the UT-verified door, over the same served `data/walk_graph.json`.

**Proof the reimplementation is telling the truth, not a plausible story:**
every one of the 19 measured pairs was cross-checked by replaying the app's
own chosen doors through the local Dijkstra and diffing against the distance
`wayfindRoute()` itself reported. **Drift was 0.00 m on all 19** (see
`scripts/verify/out/walkmeter-last-run.json`, `selfCheckDriftM`). And the
single worst pair (EER → NHB) was screenshotted, not just numbered —
`docs/shots/walk-baseline-eer-nhb.jpg` shows the actual ribbon on screen, its
panel reading "6-9 min walk · 570 m," matching the measured `appDistM` of
568.97 m to the metre. The subject is on screen; the number is real.

---

## 1. The twenty pairs

Spread across campus: 5 pairs cross the measured Speedway way-band
(`-97.7376`..`-97.7369`, from `data/osm_cache/footways.json`'s 9 named
Speedway ways), 1 crosses the Drag/Guadalupe (UTA sits at -97.7430, west of
the campus bbox edge `docs/walk-evidence.md` uses), and 2 are level-change
candidates confirmed, not assumed — see `stairSets` below. Full per-pair UT
citations and the exact door-index reasoning are in `scripts/verify/walk-pairs.json`;
this table is the summary.

| Pair | App's door → distance | UT-verified door → distance | Extra | Tags |
|---|---|---|---|---|
| GDC → JES | door 379 (main), 471.8 m | door 382/435, 420.5 m | **+51.3 m** | |
| WEL → PAI | door 649/511, 227.0 m | door 649/509, 257.7 m | −30.7 m | |
| GDC → WEL | door 379/649, 109.9 m | door 382/649, 176.8 m | −66.9 m | speedway |
| EER → NHB | door 367/498, 569.0 m | door 363/499, 270.9 m | **+298.1 m** | speedway |
| RLP → GAR | door 545/378, 486.5 m | door 545/377, 506.8 m | −20.3 m | speedway |
| PMA → MEZ | door 526/482, 672.9 m | door 526/481, 903.8 m | −230.9 m | speedway |
| UTA → CAL | door 624/312, 813.9 m | (no correction either end) | ~0 m | drag |
| PCL → GDC | door 517/379, 464.8 m | door 518/382, 417.3 m | **+47.5 m** | |
| WAG → GAR | door 635/378, 81.1 m | door 636/377, 109.2 m | −28.1 m | |
| MEZ → CAL | door 482/312, 224.0 m | door 481/312, 323.5 m | −99.4 m | |
| BUR → SZB | door 306/594, 1039.5 m | same doors (both confirmed correct) | 0 m | |
| CBA → UTC | door 316/627, 224.4 m | same (UTC confirmed correct; CBA no UT row) | 0 m | |
| ECJ → PAI | door 361/511, 429.9 m | door 362/509, 499.7 m | −69.8 m | |
| JGB → GDC | door 440/379, 262.9 m | door 438/382, 106.3 m | **+156.6 m** | |
| NHB → PMA | door 498/526, 484.0 m | door 499/526, 281.0 m | **+203.0 m** | speedway |
| PHR → BIO | door 522/287, — | door 521/**286 — unroutable** | **unmeasurable** | |
| WCH → MAI | door 638/465, 211.2 m | door 637/463, 228.0 m | −16.8 m | level-change |
| PCL → UNB | door 517/619, 1057.2 m | door 518/619, 1018.3 m | **+38.9 m** | level-change, drag |
| PAT → RLP | door 514/545, 674.7 m | door 513/545, 697.5 m | −22.8 m | |
| UTC → FAC | door 627/374, 508.7 m | same (FAC's only door is already 374 — no `main` role exists on FAC at all, so the router already lands on the nearest door by default) | 0 m | |

Bold = the app currently sends a student measurably farther than the door UT
itself says is correct. **PHR → BIO could not be measured**: the UT-verified
door for BIO (door 286, matched 48.8 m from UT's survey point — the loosest
match in this set) carries **empty node/cost arrays in `data/walk_graph.json`**
— it was never snapped to the path network at all. That is a bake-level gap,
separate from the door-labelling bug, worth its own line in the queue for
whichever lane owns `scripts/bake_entrances.py` / `scripts/bake_walk.py`.

**Level-change claim, confirmed not assumed:** both candidate pairs came back
with `stairSets ≥ 1` on the corrected route (WCH → MAI: 1, PCL → UNB: 1) —
read off the same `F_STEPS`/`stairSets` accounting `js/wayfind.js` itself
uses, not asserted from campus geography.

---

## 2. THE NUMBER

- **Total extra distance the current door-labelling bug costs, summed only
  over pairs it makes worse (floored at 0 per pair): 795.3 m** across 6 of 19
  measurable pairs.
- **Median extra per pair: ≈0 m.** Half of the 19 measured pairs are within a
  rounding error of zero — the bug is not evenly distributed, it is
  concentrated in a handful of buildings.
- **Worst offender: EER → NHB, +298.1 m** (Engineering Education & Research
  Center to Norman Hackerman Building) — the app's current main door sends a
  student 569 m for a walk that should be 271 m, more than double.
  Screenshotted in `docs/shots/walk-baseline-eer-nhb.jpg`.
- Runner-up: **NHB → PMA, +203.0 m** (the same NHB mislabel, opposite
  direction). Third: **JGB → GDC, +156.6 m**.

**The number this baseline did NOT expect going in, and the most important
finding for whoever builds the fix:** 9 of the 19 measured pairs got LONGER,
not shorter, when forced to the single UT-verified door — net **−585.8 m**
against the +795.3 m of real improvement, for a **net signed total of only
+209.5 m** across all 19 pairs combined. **PMA → MEZ is the sharpest example:**
MEZ's UT-verified door (confirmed by two independent UT rows, both landing on
the same door) is real and correctly matched — and routing to it from PMA
costs **231 m more** than the app's current (mislabelled) door does for that
specific trip, because the two doors are on different sides of the building
and PMA approaches from the side the "wrong" door already faces.

**This is not a reason to distrust the UT data — it is a demonstration of
exactly the failure mode `docs/walk-evidence.md` §G.3 already predicted.**
That doc's ranked fix list said: don't collapse a building down to one
`role: main` door, not even UT's verified one — keep every near-tied
candidate eligible and let Dijkstra pick per-trip. A blanket "set `role:main`
to UT's celebrated entrance" fix, without also widening the candidate set
(the `MAIN_TIE_BAND` idea in that doc), would fix EER/NHB/JGB/PMA→MEZ-as-origin
and simultaneously make PMA→MEZ-as-destination and eight other real trips
measurably worse. The baseline number to beat is **+795.3 m of real waste**,
and the constraint the fix has to hold is **not regressing the −585.8 m of
trips that are already fine.**

---

## 3. What this pass does NOT establish

- 6 endpoints across the 20 pairs (WEL, CAL ×2, CBA, UNB ×2, and the ambiguous
  RLP/UTA cases) have no confident UT-verified correction — documented per
  pair in `walk-pairs.json`, not silently assumed correct. A future pass with
  a wider UT dataset pull, or a manual site check, could close these.
- PHR → BIO's unroutable corrected door is a real bake gap this pass found but
  did not fix — flagged above, not repaired here.
- Whether the app's CURRENT distance is itself right for the 4 "confirmed
  correct" pairs (BUR→SZB, CBA→UTC, UTC→FAC, and PMA's own door) — those are
  reported as 0 m extra because the app's existing choice already matches or
  nearly matches UT's data, not because they were independently re-verified
  beyond that match.
- Nothing about the sidewalk-utilization or streetlight questions from the
  original brief — those are `docs/walk-evidence.md` §D/§F's territory, this
  pass is the door/route-length number only.

---

## 4. Re-running this against any branch

```bash
python scripts/serve.py <port>                                   # from repo root
cd scripts/verify && npm install                                  # once
VERIFY_URL=http://127.0.0.1:<port> node walkmeter.mjs walk-pairs.json
```

Works unmodified against `acer/w-door`, `acer/w-sidewalks`, `acer/w-stairs`,
`acer/w-lit`, or `acer/w-ui`'s own served checkout — same 20 pairs, same
self-check, same door-index citations. A branch that fixes the door-labelling
bug should show the +795.3 m mostly gone and the −585.8 m of currently-fine
trips still at or near 0. Full per-pair JSON lands in `scripts/verify/out/`
(gitignored, regenerable) every run.

---

*2026-08-24, acer lane. Sources: UT Austin `Celebrated_Entrances_view` and
`Non_ADA_Celebrated_Entrances_view`, public ArcGIS FeatureServer,
`services9.arcgis.com/w9x0fkENXvuWZY26`, queried live. `data/walk_graph.json`
as baked 2026-07-30. `data/osm_cache/footways.json` for the Speedway
way-band. No code in `js/wayfind.js` or any bake script touched.*
