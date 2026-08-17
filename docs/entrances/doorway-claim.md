# Why eid 345 landed on eid 621, what the fix costs, and why it is shipped OFF

**Date:** 2026-08-17. **Branch:** `acer/r3-dkrdoor`. **Server:**
`python scripts/serve.py 8571` from a throwaway worktree cut from `origin/main`
(`e10d591`). **Harness-drift:** PASS — 29 scripts in `index.html`, 29 in
`_harness.html` — run before any pixel work. Every page loaded with
`?intro=0&drift=0`; `cancelGraphicsAutoDetect()` at the top of every run; every
arm waited for `austin-entrances` to report LOADED before any frame.

**`data/entrances.geojson` IS NOT TOUCHED BY THIS BRANCH.** Nothing the app
loads is touched by this branch. `main` is byte-for-byte the city it was.

---

## 0. The verdict first

1. **The cause is established, and it is not what the brief guessed.** The
   relocation march never asked *what was already standing* on the wall it
   landed on. It is not that the door left its own building — **21 of 27
   relocations land on a neighbour's building and most of them are good.**
2. **The fix is written, measured, and turned OFF** behind
   `BURIED_DOOR_CLAIM = False` in `scripts/bake_entrances.py`. Turned on it
   takes `coplanar` from 1655 to **1623** — green, and four *under* the 1627
   baseline — and every removed pair is a cross-building door collision.
3. **It is off because it costs a visible change to Moncrief-Neuhaus's main
   door and there was not time to photograph the other five doors it moves.**
   The defect it removes is invisible; the change it makes is not. That is the
   wrong trade the night before a recording.
4. **The pinch gesture is NOT backwards.** Driven with real touch events at
   393x852: pinch-closed climbs, spread descends. That is the map convention,
   and the QUEUE entry claiming otherwise has the convention inverted. **Do not
   invert it.**

---

## 1. Why eid 345 landed on eid 621 — read out of the bake, not guessed

`clear_buried()` finds the mass that buried a door, then hands **that mass's
exterior ring** to `_free_wall()` and marches the door to the nearest point on
it with a free run and clear space in front. Nothing in that loop ever asked
whose wall it was or what was already on it.

The bake now prints the answer on every run (`moved 1x <who> <d> m to <lon,lat>
-> onto <what>`). On `origin/main`, with the rule off:

```
21 of 27 relocations come to rest against ANOTHER BUILDING'S drawn footprint
 3 come to rest against an authored mass
 3 come to rest against their own footprint
```

**So "a relocated door must stay on its own building" is refuted by the bake's
own log.** The Moody Center's five doors — the headline of `relocated.md`, each
photographed at 31,000+ px on both bearings — every one of them lands on
`2b0f20a0`, which is not Moody's ring. That rule would delete twenty-one
working doors to fix seven.

**What actually separates the good landings from the bad ones is what is
already on the wall:**

```
good landings -> 2b0f20a0, d51aba3f, eddfc577, 78a70444 ...
                 BLANK masses. Not one door group between them.
bad  landings -> 3fb4507f, 6671852e, 568a1f55 ...
                 every one already carries its own doors, and every one of the
                 seven cross-building collisions on main is on one of them.
```

Measured on `main`, door-piece centroid to door-piece centroid, every pair of
door groups closer than 4 m:

```
  0.00 m  eid 165 BEL  <-> eid 288  -      DIFFERENT buildings
  0.00 m  eid 166 BEL  <-> eid 289  -      DIFFERENT buildings
  0.89 m  eid 164 BEL  <-> eid 287  -      DIFFERENT buildings
  1.08 m  eid 179  -   <-> eid 345 SEZ     DIFFERENT buildings
  1.79 m  eid 345 SEZ  <-> eid 621 MNAC    DIFFERENT buildings   <- QUEUE Y24
  2.15 m  eid 128 PAC  <-> eid 587 DFA     DIFFERENT buildings
  2.83 m  eid 366 BMA  <-> eid 367 BMA     same building (an authored bank)
  2.86 m  eid 179  -   <-> eid 621 MNAC    DIFFERENT buildings
```

**Seven of the eight are two buildings in one doorway.** eid 345 is not a
one-off; it is the loudest of a family, and it was loud only because its
overlap happened to be 100 % on a canopy where `coplanar` could see it.

### The second-order cause, which is worth keeping

NB8 (`BURIED_OWN_BLOCKS_FRONT`) made this **worse, not better**, and correctly
so. Before it, a buried door could park facing back into its own building.
After it, the host's own mass blocks the front test — so in a tight complex
like the DKR belt the only clear space left is off the building entirely, and
nothing then stopped the door taking somebody else's doorway. Ten of NB8's
eleven movers were fine. eid 345 is the eleventh.

---

## 2. What the camera saw, before and after

`doorstack.mjs` at **1.70 m** of eye height read back from `__fly.eye()`, five
bearings — the three the Y24 lane used (232.2, 249.9, 332.2) plus **69.9 and
152.2, the opposing partners** of two of them, because a single bearing has
been the camera six times this week. Frames in `shots/lastfix/`.

**B152 is discarded, not reported**: both arms render under 600 px there — the
camera is looking at nothing. **B232 was also read twice and disagreed with
itself** (44,372 px on one launch, 562 px on another); the run below is the one
where both doors are in frame, and it is quoted with that caveat.

```
BEFORE (what main ships)            eid 345 alone            eid 621 alone
bearing 232.2      24,293 px @[583,199,837,457]   36,222 px @[507,199,837,457]
bearing 249.9      28,287 px @[589,205,1022,454]  42,259 px @[477,205,1022,454]
bearing 332.2       7,115 px @[660,243,871,455]   22,195 px @[556,243,871,458]
bearing  69.9      30,975 px @[601,206,831,471]   51,193 px @[601,205,960,471]
```

**345's rectangle is inside 621's at every one of the four**, including the
true opposing pair 249.9 / 69.9. That reproduces HANDOFF §161 independently
(it had 24,814 / 36,991 at 232.2 and 26,156 / 38,686 at 249.9).

```
AFTER (the rule on)                 eid 345 alone            eid 621 alone
bearing 249.9      18,746 px @[555,212,1243,452]   9,340 px @[697,151,1243,475]
bearing 332.2      10,567 px @[634,246,842,458]    7,851 px @[789,247,898,444]
bearing  69.9      21,049 px @[664,205,864,471]    7,973 px @[589,240,749,471]
```

**Neither rectangle contains the other at any bearing. The doubling is gone.**

### And the reason it is shipped off

Look at `621 alone`: **42,259 -> 9,340** at 249.9 and **51,193 -> 7,973** at
69.9. That is Moncrief-Neuhaus's **main** door travelling 6.70 m and narrowing
from `hinged-quad` n=4 to `single` n=1, because the free run it finds after
eid 345 has claimed the good stretch is short.

Judged by eye, not by the pixel count, at the four bearings:

- **249.9 — worse.** `before-345-621/B250-both.png` is a handsome glazed
  entrance; `after-345-621/B250-both.png` is a thin armature of posts and rails
  with the glass gone. This is the frame that decided it.
- **332.2 — better.** The before has a floating frame jammed in mid-air in
  front of the wall; the after is a clean recessed glazed bay.
- **69.9 — better.** The after puts a real mullioned glass door on the wall
  where the before had a bare grey panel.
- **232.2 — cleaner after.**

Three of four improve. **One regresses, and it regresses on the front door of a
building next to the landmark Simeon asks about most.**

---

## 3. What the rule is, and what it costs, in numbers

`BURIED_DOOR_CLAIM` keeps a **live register of every door's position** and
refuses a relocation any wall point within `BURIED_DOOR_CLEAR_M` (3.2 m, the
width this file already calls a door bank) of a door belonging to a
**different** building. Two doors on one building are none of its business.
The register is live: a claim travels with its door and a dropped door releases
its claim.

The constant sits in a real gap, not on top of a cluster: the cross-building
pairs on `main` are 0.00, 0.00, 0.89, 1.08, 1.79, 2.15 and 2.86 m, and the next
pair is past 4 m.

**Turned on** (`coplanar.mjs --dump-pairs`, which this branch adds so the count
can be resolved by id instead of argued about):

```
coplanar entrances.geojson    1655 -> 1623      gate GREEN, exit 0,
                                                4 UNDER the 1627 baseline
pairs removed, by eid pair:
    (345,621)  25      (128,587)  4      (179,621)  1
    (164,287)   1      (179,345)  1                        = 32
pairs added:   none
```

**Every one of the 32 is a cross-building door collision.** Against the 1627
baseline file specifically it removes six (128/587 x4, 179/621, 164/287) and
adds two `(276,276)` / `(281,281)` self-pairs — a door against its own
furniture, the family §156 judged and accepted. 1627 − 6 + 2 = 1623; the
arithmetic closes.

Cross-eid coplanar pairs, which is the number that actually means "two door
groups in one place": **1627 file 11, main 37, with the rule on 5.**

Bake health with the rule on: 656 groups on 295 buildings, **zero eid identity
drift** (every eid keeps ref, name, era, src, role and bid), 0 floating sills,
0 detached pieces, 0 bad base/h/colour, OSM recall unchanged, 19 buildings with
no entrance unchanged. Six door groups move: 621 (6.70 m), 179 (6.09), 287
(5.64), 128 (3.83), 346 (3.02), 345 (1.53).

### Two designs that were tried and rejected, so nobody repeats them

- **Priority order** (best-evidenced door claims first, by `(prio, -score)` the
  way `assign_roles` does): sends eid 345 **20.96 m** and eid 621 **12.60 m**
  onto unrelated facades. Twenty metres from the evidence is not a better
  answer than the defect.
- **Drop instead of march** (refuse the relocation outright when its nearest
  wall is taken): cleanest geometry of the three, but it drops four groups,
  which renumbers **427 eids**, silently invalidating every eid in `QUEUE.md`,
  `HANDOFF.md` and `relocated.md`. eids are handed out by `assemble()` in
  sequence, so any change to the drop set shifts the whole space.

The shipped-but-off version is the one that keeps all 656 eids stable.

---

## 4. The pinch gesture is not backwards — QUEUE Y10 item 6

Driven with **real CDP touch events** at **393 x 852, dpr 3, isMobile,
hasTouch**, two interleaved reps of each gesture
(`scripts/verify/pinch-alt.mjs`, new):

```
closed r1   gap 260 -> 60   dAlt +150.744      pinch CLOSED  -> CLIMBS
open   r1   gap  60 -> 260  dAlt  -50.913      spread        -> DESCENDS
closed r2   gap 260 -> 60   dAlt +174.010
open   r2   gap  60 -> 260  dAlt -174.010      exactly symmetric with r2 closed
```

The code agrees: `touchLogAcc += Math.log(pinchDist / d)` with `pinchDist` the
**previous** gap, so closing the gap makes the ratio > 1, the log positive, and
`altUser *= Math.exp(L)` multiplies **up**.

**And that is the map convention, not a violation of it.** On every 2D map
pinch-closed zooms OUT; zooming out moves the camera FURTHER FROM THE GROUND;
further from the ground is UP. `docs/mobile/driving-at-eye-level.md` §6 says
*"the opposite of the universal map convention, where pinching closed zooms
out, i.e. away"* — and treats "away" and "lifts you" as opposites when for an
altitude camera they are the same direction. **The doc has the convention
inverted, not the app.**

**So: do not invert this gesture.** Inverting it would make the app the only
map on the phone where pinching closed drops you toward the pavement.

The on-screen hint reads `two fingers for altitude`. It states no direction, so
it is true either way and needs no change.

**What this did NOT establish: the magnitudes.** +150 m from a nominal 1.7 m
start is far larger than the multiplicative gain predicts (a 260->60 gap is
4.33x, i.e. 1.7 m -> 7.4 m). `altUser` is almost certainly not resynced to the
placed altitude by a bare `map.jumpTo`, so the *sizes* above are not
trustworthy and are not quoted as a finding. **The SIGN is unambiguous and
reproduced four times.** The real usability question — whether the gesture is
far too sensitive — is untouched and is a better use of the next pass than
inverting anything.

---

## 5. What this pass did NOT establish

1. **Five of the six doors the fix moves have never been photographed** — eids
   128, 164, 179, 287 and 346. Only the 345/621 pair was. `relocated.md`'s own
   standard is two opposing bearings per moved door, and that is the work that
   has to happen before `BURIED_DOOR_CLAIM` is turned on.
2. **eids 165/288 and 166/289 are two more doubled doorways, at 0.00 m, and
   this fix does not touch them.** They are identical in the 1627 file, on
   `main`, and in every arm here — so they are **not** caused by relocation and
   not caused by this change. Two buildings (BEL and `6b5bbe97`) derive doors at
   the same coordinate, differing only by base height (0.73 vs 0.77). That is a
   placement-pipeline defect, it is on the Bellmont/DKR block, and it is
   recorded in `QUEUE.md` as R4 rather than fixed here.
3. **The hero set was not re-shot.** It did not need to be: `git diff --stat`
   shows this branch touches `scripts/bake_entrances.py`,
   `scripts/verify/coplanar.mjs`, `scripts/verify/pinch-alt.mjs` and docs —
   **no file the app loads.** The bake output was proved byte-identical to what
   `main` ships, feature by feature, with the rule off. A screenshot cannot be
   more conclusive than "the served bytes are the same bytes".
4. **`BURIED_DOOR_CLEAR_M` was chosen from the gap in the measured
   distribution, not from a photograph of a real doorway.** Same limitation
   `relocated.md` §7 records for `BURIED_RUN_MIN` and `BURIED_CLEAR_M`.
5. **The walk graph was not re-baked** — correctly, because no door moved. If
   the constant is turned on it must be, and the six moved doors' arrival legs
   re-checked.
6. **Whether MNAC's main door SHOULD be a four-leaf portal at all** is
   unexamined; it is derived, not authored, and no `celebrated.md` entry covers
   it.
