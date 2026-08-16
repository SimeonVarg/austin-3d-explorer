# The old doors, looked at — a sampled inspection of the 656 shipped entrances

**Date:** 2026-08-16. **Branch:** `acer/n13-olddoors`. **Server:**
`python scripts/serve.py 8462` from a throwaway worktree.
**Harness-drift:** PASS (29 scripts in `index.html`, 29 in `_harness.html`),
run before any pixel work.

Everything below was produced by standing in front of a door at **1.7 m of eye
height** and looking at it, or by measuring the shipped file. Nothing here is
reasoning about what the bake *should* have produced.

---

## 0. THE DENOMINATOR, which is the honest part

```
656   door groups in data/entrances.geojson   (15,071 pieces)
295   buildings carrying at least one
 33   photographed one by one before tonight  (the n8 pass, HANDOFF §140)
171   photographed in this pass               (26% of 656)
 87   buildings covered by this pass
```

**A human has now stood in front of 196 of the 656 door groups — 30%.** The
other 460 have had numeric checks only, and this document says which numeric
checks, so nobody mistakes them for inspected.

Every one of the 656 was put through the **numeric audit in §2**, which is a
different and weaker claim than having been looked at. Say "audited", not
"inspected", about the other 460.

---

## 1. The sampling plan, stated before the results

A 26% sample is only worth anything if the strata are named in advance. Five,
in priority order; a group claimed by an earlier stratum is not counted twice,
so the numbers are disjoint and add up.

| # | stratum | picked | why |
|---|---|---|---|
| S1 | **TEACHING** — every `role: main` group on a building an undergraduate enters | 62 | the doors that matter most |
| S3 | **CELEBRATED** — every tier-1 and tier-2 ref in `celebrated.md` §3 | 37 | the only doors with a *measured spec* to check against, so the cheapest to judge |
| S4 | **RANDOM DERIVED** — seeded random over `src: derived` | 34 | least trustworthy by construction: 570 of 656 |
| S5 | **LEADS** — everything the numeric audit flagged | 27 | go where the numbers point |
| S2 | **COVERAGE** — top-up to ≥ 3 from every `era`, every `src`, every `role` | 11 | **a systematic error is per-family, not per-building** |

Resulting coverage — every family and every provenance is represented:

```
era   midcentury 45  modern 42  cret 37  utility 34  gilbert 6  highrise 4  victorian 3
src   derived 138    osm 28     westcampus 3        authored 2
role  main 88        secondary 75  service 4  emergency 2  exit 2
```

**The teaching ranking is `[A]` and it is a judgement, not a measurement.**
This repo holds no room inventory and no course schedule — `ut_buildings.json`
carries `ref`, `name`, `number`, `occupied` and nothing else, exactly as
`docs/walk/the-78.md` §5 says. The list is written down in the pass's selector
so it can be argued with rather than guessed at.

---

## 2. The numeric audit — all 656, five tests

Run before a single photograph, because a rule that is wrong across two hundred
doors is worth more than any single odd door.

| # | test | result |
|---|---|---|
| 1 | **era vs the register year** — family from `ut_buildings.json`'s `occupied`, boundaries from `eras.md` §5.2 rule 6 | 322 groups are dated *and* in a date family. **306 match. 16 do not** — §3.1 |
| 2 | **heights** — leaf height, sill height, group top | **clean.** Leaf heights are 2.134 (432), 2.44 (197), 2.6 (8), 2.7 (5), 2.9 (3) and 4.30 (11). Every 4.30 is a garage vehicle opening. Group tops run 2.35–7.17 m |
| 3 | **on a real elevation** — metres from the group centroid to the host footprint boundary | **0 groups further than 6 m.** Every door is on its own building's wall |
| 4 | **facing outward** — centroid outside the host ring | **655 of 656 outside.** The one inside (eid 56, The Quarters Sterling House) is 0.16 m in, i.e. a re-entrant notch, not a door in a lobby |
| 5 | **buried** — centroid inside *another* building's footprint | **14 groups.** Ten are stadium/Moody sub-footprints that legitimately overlap; **five are Moody Center and they are the finding in §3.2** |

Also checked and clean: **0** groups with no door leaf, **0** with a handrail
but no flight, **0** with a leaf taller than its own family's maximum.

---

## 3. The ranked defect list

### 3.1 — `CELEBRATED` overrides the measured year 16 times, and 7 of those are one building

**Rank 1. Not a bug; a documented override that is now worth re-reading.**

`bake_entrances.py`'s cascade puts the `CELEBRATED` table *above* the register
date test. Sixteen groups therefore wear a family their building's year does
not predict:

```
WEL  1930  got midcentury  expected cret        7 groups
PAC  1980  got modern      expected midcentury  4 groups
HRC  1972  got modern      expected midcentury  3 groups
LBJ  1971  got modern      expected midcentury  2 groups
```

Three of the four are **right and sourced**: HRC's entrance is the Lake|Flato
2003 facade (`eras.md` §6 says so explicitly — family C mass, family D
entrance); PAC's public front is the 2008 Bass lobby; LBJ is tier 1 and
hand-authored.

**WEL is the one to look at again.** `celebrated.md` §2 demotes Welch Hall out
of tier 1 because "the building the public sees from Speedway is dominated by
the large later addition" — which is an argument about *fame*, and the table
entry also pins `fam="C"`, which is an argument about *era*. The register now
dates the building 1930. All seven of Welch's doors were photographed
(`shots/olddoors/sheets/` sheet 2 and 7): they are consistent, well made, and
sit on the addition's wall, not on the 1930 limestone. **No change made.**
`celebrated.md` was written from photographs and it wins (the hard rule), and
the demotion note describes a real building. Recorded as QUEUE **NB1** so the
next person with a photograph of Welch's *west* front can settle it.

### 3.2 — Six doors render zero pixels because an authored mass stands over them

**Rank 2. CONFIRMED from two independent bearings. The real defect of the sweep.**

**Moody Center, all five groups (eids 574–578).** They are the only non-stadium
centroids inside another footprint in the whole file (§2 test 5). All ten
frames — five doors × two bearings, the crop centred on the door's own
projected pixel — are **blank wall**. On eight of the ten no clean
three-quarter angle existed at all and the pose fell through to head-on, and
head-on it is still blank wall.

**EER (eid 381), the Engineering Education and Research Center's `main`.** Both
bearings are a solid orange field: the standing point 13 m and 15 m out from
the wall is *inside* the building's authored mass, so the door is inside it
too. EER is not in the buried list because the audit only knows OSM footprints
and `js/heroes.js`'s mass is not one.

`bake_entrances.py` already owns this failure mode: `BURIED_MASS_FILES`
includes `moody`, and the buried-door audit relocates a door swallowed by an
authored mass. The audit tests the door's **leaf plane** against masses that
start below `BURIED_BASE_MAX` 2.0 m; Moody Center's own re-drawn mass and its
plaza footprints may be passing that test and still hiding the door.

**Both predate this branch** — every one of these six groups is byte-identical
between `origin/main` and this branch, which changes only eids 202, 203, 210,
457 and 585. QUEUE **NB2**, with the frames and the eids. Not a merge blocker.

### 3.2b — LBJ has the glazed entrance `celebrated.md` explicitly forbids

**Rank 3.** `celebrated.md` §5.10 is unusually direct about this building:
*"Model the plaza podium and the overhang; do not put a shopfront-style glazed
entrance on a windowless travertine wall. That is the specific failure mode
here."* The second bearing on `LBJ-eid582` shows a glazed door pair in a stone
frame on the travertine wall, and `LBJ-eid583` shows another at the corner.

It is not a *shopfront* — it is a modest family-D pair, and `celebrated.md`
records the door's side as `[U]`, so nothing measured says it is in the wrong
place. But it is the shape of thing the spec named, on the one building where
the spec named it. Frame: `shots/olddoors/leads/B-LBJ-eid582.png`. QUEUE
**NB4**; predates this branch.

### 3.3 — `origin/main` fails its own coplanar gate, and this branch adds 12 to it

**Rank 3. A red gate that is red without this branch.**

```
scripts/verify/coplanar.mjs --gate      baseline recorded 2026-08-16
  origin/main's own data/entrances.geojson   1558 -> 1614   REGRESSED
  this branch's                              1558 -> 1626   REGRESSED
```

So **56 of the 68 are already on `main`** and 12 are this branch's — all inside
the five new family-V door groups, and all of the kind `reveal / surround`
(measured directly on the two files: 18 → 32 coplanar pairs *within* eids 202,
203, 210, 457, 585). A family-V surround band frames a reveal slab and the two
share a top height by construction.

Judged by looking: the walking-height frames of ANB, JHH, LFH and GEB
(`shots/olddoors/after/`, `shots/olddoors/leads/B-GEB-eid457.png`, `B-JHH-eid202.png`, `B-LFH-eid585.png`) show **no z-fighting** on
any surround. The precedent is `HANDOFF` §140's suite-lint call — a gate that
fails identically without the branch is not the branch's regression, and the
reason goes in writing rather than into a re-recorded baseline.

**The baseline is not this lane's file** (`scripts/verify/` belongs to the
suite-repair lane), so it is QUEUE **NB3** rather than a one-line fix here.

### 3.4 — about one frame in five photographed the wrong thing, and that is the instrument

**Rank 4. A finding about the harness, not about the city.**

The pose is derived — nearest wall, its outward normal, stand back and turn
three-quarters — and the first cut only tested the sight line against *other*
buildings' footprints. **A building's own re-entrant wall is an occluder too.**
`JON-eid75` photographed the flank of Jesse H. Jones Hall with its door's
handrails just visible round the corner; `PAI-eid348`, `ASE-eid527`,
`DFA-eid588` and `MAI-eid421..423` did the same.

Fixed in this pass by aiming the occlusion test at a point **1.6 m outside**
the door rather than at the door itself, so the wall a door is set into does
not count as blocking its own doorway; and every door was then re-shot from
the **opposite** three-quarter angle at 15 m. **The second bearing paid for itself immediately**: `AHG-eid477`,
`CMA-eid561`, `BRB-eid516` and `GAR-eid535` all photographed a blank wall or
the inside of a mass on the first bearing and a correct, well-made portal on
the second. Four apparent defects that were the camera.

Both sets were shot; what is committed is the **contact sheets**
(`shots/olddoors/sheets/`, `sheetsB/` — every one of the 171 doors on both
bearings, labelled with ref / eid / era / src / role), the two full manifests
(`sweep_manifest.json`, `sweepB_manifest.json`, carrying every pose, every
read-back eye altitude and every entrance feature count), and the named frames
in `shots/olddoors/leads/`. **The 342 raw frames are 164 MB and were not
committed** — the sheets carry the same evidence at 1/5 the size.

Four frames are featureless because the eye landed inside an **authored** mass
that is not in the footprint file at all (`EER-eid381`, `CMA-eid561`,
`BRB-eid516`, `GAR-eid535`). The footprint snapshot cannot see `js/heroes.js`;
that is the same blind spot §3.2 is about, from the camera's side.

---

## 4. What the sweep did NOT find, which is worth as much

- **No family is systematically wrong.** Every era reads as its period at
  walking height: family A's arcaded brown leaves on Battle and Sutton,
  family B's bronze-and-limestone on Gearing, TMM and the Union, family C's
  green-tinted plate on Welch, Burdine, CPE and Jester, family D's glazed bays
  on GDC, NHB, SSB and NMS.
- **The mid-century glass really is green** — `#528a86`, against blue in every
  other family. That is deliberate and documented in the bake: 1960s–70s tinted
  plate reads green because the tint eats blue. It looked like a defect and is
  not one.
- **No door floats.** The "table" failure the bake's header warns about (PCL's
  four doors hanging 3.68 m over a blank wall) does not appear anywhere in 171
  frames. PCL's own doors are at grade under a canopy, which is correct.
- **The `utility` NULL family is uniform**, which is what `eras.md` §4 E5 asks
  for. Measured: median door bank 1.74 m on a flight 4.46 m wide — a stoop
  2.6× the door. That is `FLIGHT_SIDE = 1.20` m per side applied to every
  family, and it is `eras.md` §3.6's *family A* number. It reads acceptably at
  1.7 m; recorded as an observation, not a defect, and it is one constant.

## 5. What this pass did not establish

1. **460 of 656 door groups have still never been looked at.** They passed the
   five numeric tests in §2 and nothing more.
2. **Night was not photographed.** Every frame in this sweep is
   `applyTimeOfDay(0.30)` daylight. The night ramp on the new family V was
   checked by the previous pass, not by this one.
3. **The `service` doors on garages are unresolved.** `SAG-eid612` and
   `TSG-eid598` photograph a corrugated garage wall with no readable opening.
   Two frames is not enough to say whether the vehicle opening is missing or
   the camera is on the wrong bay.
4. **Nothing was measured against a photograph of the real building.** "Era
   plausible" here means plausible against `eras.md` and the register year, not
   against a picture of the actual entrance.
5. **The five family-V doors moved 0.10–0.64 m** when the vocabulary changed.
   `data/walk_graph.json` is unchanged and was baked against the old positions,
   so it is up to 0.64 m stale on four buildings. That is inside any routing
   tolerance and no route was re-checked.
