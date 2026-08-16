# The buried-door rule, and the file it could not see

**Written 2026-08-16 (QUEUE NB2), branch `acer/nb2-buried`.** The rule itself
lives in `scripts/bake_entrances.py` — `BURIED_MASS_FILES`,
`BURIED_DRAWN_FOOTPRINTS`, `load_masses()`, `clear_buried()`. This page is the
why, and the measurements.

---

## 1. What the rule is for

A door that exists in the data and renders nothing is the worst defect this
project produces, because **every numeric check passes it.** It is at a sane
height, on a real elevation, facing outward, and counted in every total. It is
a silent lie in the feature count, and the only instrument that catches it is
somebody standing in front of it.

So the bake owns the failure mode: the door's **leaf plane** is tested against
everything opaque at ground level, and a buried door is either relocated to the
nearest wall that has real open space in front of it, or **dropped with the
reason printed**. The count prints on every run, so the day a new pass grows a
mass over somebody's front door it is one line of bake output rather than a
sixteen-bearing photo hunt.

## 2. What it was actually testing, which was not that

`load_masses()` read **nine authored files** — heroes, stadium, moody, arts,
drag, capitol, tower, westcampus, parts. That list is where the first case came
from (Gates-Dell's measured OSM `entrance=main` node ends up 0.21 m inside the
atrium's glass slab), and the constant is named after it.

But the invariant the rule is really enforcing is

> **nothing the renderer extrudes may stand over a door**

and the single largest thing the renderer extrudes was not in the list at all:
`austin-buildings`, whose source is
`data/snapshots/<date>/buildings.detailed.geojson`. **A door swallowed by an
ordinary neighbouring building passed every test in the audit**, because the
audit was reading the nine authored files and not the one the buildings layer
draws.

## 3. The Moody Center, measured

Five door groups, eids 574–578. All five sit on footprint
`d8b0698a` — Moody Center, 15,410 m², which `data/moody.geojson` **claims**, so
`austin-buildings` does not draw it; `js/moody.js` draws the arena instead.

All five leaf planes are inside **`2b0f20a0`** — an unnamed 21.3 m Overture ring
over the same arena that **no pass claims**, so the buildings layer extrudes it
in full. A 21.3 m building stands in front of a 6.0 m door.

```
door                       inside 2b0f20a0 (h=21.3, claimed_by NOBODY)   yes, all five
                           inside ba9c090c (h=8.0,  claimed_by NOBODY)   four of five
                           host ring d8b0698a (h=27.7, claimed by moody) near, not inside
```

Why every earlier test missed it:

| test | what it said | why it was wrong |
|---|---|---|
| §2.3 on a real elevation | 0 groups > 6 m from their own wall | true, and irrelevant — the door IS on its own wall |
| §2.4 facing outward | 655/656 outside the host ring | true — it faces out, into another building |
| §2.5 buried | 5 groups, none of them MCA | it only ever asked about the nine authored files |
| the X4 self-block | excluded the Moody plinth, IoU **1.000** | correct and not the cause: the leaf plane is 0.32–0.57 m OUTSIDE the plinth either way |

The self-block was the obvious suspect and it is **innocent**. Narrowing it to
the march only (its original justification — Cambridge Tower's march re-entering
its own ring) was measured over all 656 doors before being written: it catches
**2** doors, neither of them Moody's. The measurement is what killed the theory.

## 4. The rule as it now stands

`load_masses()` returns `(polys, owners)` and draws from **two** sources:

1. the authored masses of `BURIED_MASS_FILES`, unchanged;
2. the footprints `austin-buildings` extrudes — **minus every id an authored
   pass claims** (`BURIED_CLAIM_FILES` → `replacedBuildingIds`), because a
   claimed ring is drawn by that pass's own geometry and counting it twice
   would bury every door on every re-drawn building, starting with Moody's own.

A door's **own host** is skipped by **bid** where the mass is a footprint, and
by the IoU self-block where it is an authored re-draw with no id. An id match is
exact; a ratio is a threshold.

`BURIED_DRAWN_FOOTPRINTS = False` restores the old behaviour in one line.

## 5. What the change did, measured over the whole file

```
                              BEFORE            AFTER
buried doors found            5                 30
  relocated to a free wall    2                 27
  dropped, reason printed     3                 3
entrances                     656 on 295 bldgs  656 on 295 bldgs   unchanged
per building                  min1 med2 mean2.22 p90 4 max 8       unchanged
no entrance                   19 buildings                         unchanged
OSM recall floor              67% at 8 m, floor 65%  OK            unchanged
median position error         0.00 m, p75 15.64 m                  unchanged
floating sills                0 of 656                             unchanged
detached pieces               0                                    unchanged
bad base/h/colour             0                                    unchanged
pale-neutral wn               0                                    unchanged
glazing neither lit nor dark  0                                    unchanged
pieces                        15,071            15,069             -2
file                          6.75 MB           6.75 MB            unchanged
eid -> ref/name/era/src/role  ------------ identical on all 656 ------------
door groups that MOVED        25 of 656, 0.97 m to 14.42 m
```

**The three dropped doors are the same three as before.** The count did not
change, and since the eid → building/era/src/role mapping is identical on all
656, a different door being dropped would have shifted that mapping. So the
relocation half of the rule absorbed all 25 new cases and the drop list is
untouched.

**Nothing was added and nothing was lost.** Every eid keeps its building, era,
provenance and role; 25 groups moved onto a wall that is drawn. The two
buildings a visitor looks for:

```
MCA  eid 574   12.06 m    the main door — this is the headline
MCA  eid 576    4.02 m
MCA  eid 575    3.57 m
MCA  eid 578    3.31 m
MCA  eid 577    1.20 m
```

Judged by looking, at 1.70 m of eye height, both bearings:
`shots/nb2/before/` and `shots/nb2/after/`.

## 6. The instrument, because the pictures alone are not enough

`sweep.md` §3.4 measured **one frame in five photographing the wrong thing** — a
building's own re-entrant wall occludes its own door. And `doorwalk.mjs` records
`queryRenderedFeatures` returning ONE feature for the WHOLE screen at pitch > 82
/ zoom 21.5, so "0 rendered" from it is the instrument failing, not the door
missing.

So the judgement here is **not** a crop. At every pose the entrance layers are
toggled off and on and the same box around the door's own projected pixel is
captured twice; the changed-pixel count is what the door contributes. It is
camera-independent, and a door is only called invisible when **both bearings**
say zero.

```
                    before        after
MCA-eid574-A        0 px          33,768 px
```

## 7. EER 381 was never broken, and that matters as much

`sweep.md` §3.2 listed EER's `main` as the sixth zero-pixel door, "a solid
orange field from both bearings". Re-shot from the bake's own outward normal it
contributes **7,149 px from bearing A** — a glazed door with a handrail. Bearing
B is 0 px and is the frame the sweep saw: the eye lands inside EER's authored
mass and photographs the inside of it.

That is the fifth apparent defect this month that was the camera, after
`AHG-eid477`, `CMA-eid561`, `BRB-eid516` and `GAR-eid535`. **Use both bearings
or you will fix a door that was never broken.**

## 8. What this pass did NOT establish

1. **Only two of the five Moody doors were photographed before the fix**
   (eid 574, both bearings). The other three rest on the sweep's ten frames plus
   §3's geometry — the same unclaimed 21.3 m ring contains all five leaf planes.
2. **The other 25 relocated doors were not photographed one by one.** They were
   found by the same rule and moved by the same code; MEZ, GSB, PAC, MNAC,
   Jester West, BEL, BHD, Cambridge Tower, MAI and four stadium doors have had
   the numeric test and nothing more.
3. **Three doors are still dropped**, two on an unnamed footprint and one on
   `RMRZ;NEZ`, for "no wall within 35 m carrying 3 m of free run with 4 m of
   open space in front of it". Nobody has looked at those three walls to say
   whether the constants are wrong or the walls really are that tight.
4. **The bake reads the `2026-08-04` snapshot; the app draws `manifest.latest`,
   which is `2026-08-16`.** For `2b0f20a0` the two files agree exactly, so it
   does not affect this finding — but the rule is now reading a footprint file
   that is not guaranteed to be the one on screen. Recorded as QUEUE NB5.
5. **Night was not photographed.** Every frame here is `applyTimeOfDay(0.30)`.
