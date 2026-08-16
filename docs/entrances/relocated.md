# The 25 relocated doors, looked at one by one — and the Main Building was never one of them

**Date:** 2026-08-16. **Branch:** `acer/nb-relocated`. **Server:**
`python scripts/serve.py 8491` from a throwaway worktree cut from `origin/main`
(`2beaeb8`). **Harness-drift:** PASS — 29 scripts in `index.html`, 29 in
`_harness.html` — run from the worktree root before any pixel work.

`buried.md` §8.2 flagged its own blast radius against itself: *"the other 25
relocated doors were not photographed one by one … MEZ, GSB, PAC, MNAC, Jester
West, BEL, BHD, Cambridge Tower, MAI and four stadium doors have had the numeric
test and nothing more."* This page is that inspection. It found three broken
doors and fixed them.

---

## 0. THE HEADLINE: THE MAIN BUILDING'S SOUTH PORTAL DID NOT MOVE

**MAI is not one of the 25.** It was named in the risk and it does not belong
there, and two independent instruments say so:

1. **Against the shipped file.** Every one of MAI's seven door groups
   (eids 417–423) is **byte-identical** between `origin/main` today and
   `efb0625^` — the entrances file `main` shipped *before* the buried-door rule
   changed. Zero displacement, not "small displacement".
2. **Against the rule itself.** Re-baking with `BURIED_DRAWN_FOOTPRINTS = False`
   and with `True` produces the same MAI geometry to the byte. The
   `moved MAI 1 m` line in the bake log **appears in BOTH arms** — it is one of
   the two relocations the old rule already made (the other is `GDC 22 m`, the
   case the constant is named after), caused by an *authored* mass in
   `BURIED_MASS_FILES`. It is not a footprint case and it is not new.

The whole diff of last night's change is exactly 25 groups, 0.97 m to 14.54 m,
measured on door-piece centroids and identical whether you diff the two bake arms
or diff today's `main` against `efb0625^`.

### And the portal is right, checked against `celebrated.md` §5.1 line by line

Photographed at **1.70 m of eye height, both bearings**, day and night, plus the
South Mall at walking distance and a raised hero. Frames in `shots/relocated/mai/`.

| `celebrated.md` §5.1 says | what the render does |
|---|---|
| facade **SOUTH**, OSM `entrance=main` at 30.285759, −97.739416 **[M]** | door-piece centroid **−97.739416, 30.285758**, outward normal **184.8°**. **0.2 m and due south.** |
| *"portal centred in a recessed centre bay flanked by two projecting wings. Model the recess."* **[M]** | the recess is there and it is the first thing you see — the jamb returns deeply and the wall runs forward on both sides |
| authoring default `hinged_quad`, **4 leaves** **[U]** | 4 leaves, `dt: hinged-quad`, `n: 4` |
| *"tall divided lights in the upper half of each leaf, plus a fixed transom"* **[U]** | divided lights in the upper half; one `transom` piece, base 3.45, h 0.90, `#36557c` |
| surround in Texas shell stone, walls Indiana limestone **[C]** | 4 `surround` pieces, `mat: limestone`, `#e5dbc2`, framing the bay |
| inscription band above the entrance **[C]** | the band is baked — a `sign` piece at base **5.16**, h **1.10**, limestone. The **lettering is deliberately off**: `js/entrances.js` records that 108 characters on an 8.29 m band cannot be read, and `?entlabels=1` turns it on. A documented refusal, not a gap. |
| *"Default 5 risers full width across the recessed bay, no rails"* **[U]** | full-width flight across the bay, ~5 risers. **It has low stone cheek walls at both ends** rather than the doc's "no rails" — period-correct for a monumental flight, but a deviation from the written default. Pre-dates this pass. |
| two secondary `entrance=yes` nodes, west 30.285955/−97.739743, east 30.285980/−97.738982 **[M]** | eid 417 at **−97.739744, 30.285955** and eid 419 at **−97.738981, 30.285980**. Both within **0.2 m**. |

Night: the glazing and transom take the warm ramp and the leaves stay dark,
matching the committed reference
`shots/entrances/final/after-02-main-building-south-portal-night.jpg`; day matches
`after-01`. From the South Mall at 60 m the portal reads as the thing at the head
of the mall under the Tower, day and night.

**The relocation neither improved nor broke MAI, because it never touched it.**

---

## 1. The instrument, and why a single bearing is worthless here

Same construction as `shots/nb2/`: at every pose the seven `entrances-*` layers
are toggled off and on and the **same 260 px box around the door's own projected
pixel** is captured twice. `doorPixels` is how many pixels in that box the door
itself contributes — camera-independent, and immune to the two failures this
suite has already paid for:

- `queryRenderedFeatures` returns **one feature for the whole screen** at
  pitch > 82 / zoom 21.5, so "0 rendered" from it means nothing;
- a building's **own re-entrant wall occludes its own door** — `sweep.md` §3.4
  measured one frame in five photographing the wrong thing, and four apparent
  defects that month turned out to be the camera.

So **every door was shot from two opposing three-quarter bearings** (the wall's
outward normal ±40°, 15 m out, falling back to 22 m when the collision net lifts
the eye above 2.2× walking height), and a door is only called invisible when
**both** bearings say zero. Every run waited for `austin-entrances` to report
LOADED before any frame (14.0 s, 31.7 s, 32.6 s — the lazy load is real, and a
frame taken early is a blank wall that reads exactly like a missing door).
`window.cancelGraphicsAutoDetect()` at the top of every run.

---

## 2. What the camera saw

| eid | ref | building | role | A px | B px | verdict |
|---|---|---|---|---|---|---|
| 574 | MCA | Moody Center | main | 31,808 | 31,299 | the headline, confirmed a second time |
| 465 | — | Cambridge Tower | main | 31,247 | 31,193 | glazed lobby, both bearings |
| 575 | MCA | Moody Center | secondary | 25,660 | 25,723 | good |
| 179 | — | Moncrief-Neuhaus block | secondary | 25,487 | 19,894 | good |
| 577 | MCA | Moody Center | secondary | 25,192 | 23,809 | good |
| 486 | MEZ | Mezes Hall | main | 24,868 | 909 | correct on A; B looks along the wall |
| 576 | MCA | Moody Center | secondary | 23,287 | 23,147 | good |
| 138 | GSB | Graduate School of Business | main | 23,348 | 1,052 | correct on A; B looks along the wall |
| 128 | PAC | Fine Arts (Bass) | secondary | 19,130 | 0 | correct on A |
| 621 | MNAC | Moncrief-Neuhaus | main | 17,190 | 28,247 | good |
| 287 | — | DKR Memorial Stadium | secondary | 0 | 17,407 | correct on B |
| 578 | MCA | Moody Center | secondary | 16,357 | 26,103 | good |
| 346 | SEZ | South End Zone | secondary | 0 | 18,026 | correct on B |
| 345 | SEZ | South End Zone | secondary | 0 | 17,352 | correct on B |
| 164 | BEL | L. Theo Bellmont Hall | secondary | 0 | 16,336 | correct on B |
| 38 | — | Jester West Hall | main | 6,323 | 14,807 | good |
| 293 | — | DKR Memorial Stadium | secondary | 12,261 | 6,332 | good |
| 281 | — | South End Zone block | main | 0 | 8,348 | correct on B |
| 276 | — | Bellmont block | main | 8,544 | 2,758 | good |
| 391 | — | Guadalupe block | main | 0 | 6,169 | correct on B |
| 294 | — | DKR Memorial Stadium | secondary | 1,189 | 5,774 | present; a tree stands in front of it |
| **172** | — | **Engineering Discovery Building** | secondary | **0** | **0** | **BROKEN — §4** |
| **285** | **BHD** | **Brackenridge Hall Dormitory** | secondary | **0** | **0** | **BROKEN — §4** |
| **194** | — | **West Campus block** | main | **0** | **557** | **BROKEN — §4** |
| 292 | — | DKR Memorial Stadium | secondary | 0 | 0 | dark, and dark BEFORE too — not this change |

**Twenty-one of twenty-five are correct.** The ones reading `0` on a single
bearing are the camera, exactly as `sweep.md` §3.4 predicted: the other bearing
shows a well-made portal at grade with steps, rails and a canopy. Every zero was
re-shot at a second standoff before being written down. Contact sheets:
`shots/relocated/sheets/`.

---

## 3. What the relocation cost, which nobody had measured

Two of `sweep.md` §2's five numeric invariants moved, and they moved **silently**:

```
                                             PRE-NB2      TODAY on main
test 3  groups > 6 m from their own footprint      0            4
test 4  centroid INSIDE its own host ring          2           13
```

**Test 3 is measuring the wrong ring, and that is the finding.** All four —
DKR 294 (14.13 m), MCA 574 (10.73 m), BEL 164 (7.75 m), DKR 287 (6.84 m) — sit on
a host whose id **is claimed by an authored pass**, so `austin-buildings` never
extrudes that footprint; `js/stadium.js`, `js/moody.js` and `js/heroes.js` draw
something else there. Ten metres from a ring nobody draws is not ten metres from
a wall, and the pictures show all four on a wall. **Whoever re-runs the numeric
audit must exclude the 73 claimed ids from test 3, or it will report four defects
that are not there.**

**Test 4's eleven new "inside" cases are 0.55–1.30 m deep** — re-entrant-notch
depth, the same shape as the pre-existing eid 56 (0.16 m). Every relocated door
lands exactly **0.48 m** proud of the mass it was moved to (`BURIED_PROUD` 0.35
plus half the leaf), so "inside the host ring" here means "proud of the
neighbouring wall that stands inside the host ring". No z-fighting on any of
them, and the coplanar cost of the whole change was measured at one pair by the
pass that made it.

---

## 4. The ranked list

### Rank 1 — THREE RELOCATIONS TOOK A VISIBLE DOOR AND MADE IT INVISIBLE

This is the finding, and it is the one thing the numeric test could never have
caught. Measured by shooting the **pre-NB2 file at its own pre-NB2 poses** — not
the new camera at the old data, which is the `-oldcam` mistake `shots/nb2/README`
records deleting two frames for:

```
eid  building                        BEFORE (A/B px)     ON main NOW     WITH THE FIX
172  Engineering Discovery Building   5,432 /      0      0 /    0        0 /  4,453
285  Brackenridge Hall Dormitory          0 / 10,376      0 /    0    31,770 / 29,754
194  (West Campus block, role main)  15,351 / 13,837      0 /  557    15,567 / 15,241
```

**The cause, in one sentence.** `clear_buried()` hands `_free_wall()` a union
that deliberately omits the door's own building (the X4 self-block), and
`_free_wall` uses that same union for two different jobs — walking a neighbour's
wall edge, *and* asking whether there is `BURIED_CLEAR_M` = 4 m of open space in
front of the leaf. With the host missing from the union, **space that is solid
host building reads as free**, so the march parks the door on a neighbour's wall
with its outward normal pointing straight back into its own building. It then
passes every numeric test: real elevation, sane height, facing "outward",
counted in every total.

**The fix, narrow.** The edge walk keeps the old union — a door in its own
re-entrant notch must still be allowed, which is all X4 ever claimed — and the
FRONT clearance is tested against a union that includes the host.
`BURIED_OWN_BLOCKS_FRONT = True`; `False` restores today's behaviour in one line.

**One thing had to be measured rather than reasoned, and it changed the fix.**
The first cut put *all* of the host's own masses into the front union and
**dropped one of the Main Building's door groups.** `own` holds two different
kinds of thing: footprints matched by **id**, which `austin-buildings` really
does extrude, and authored re-draws matched by **IoU ≥ 0.90**, which are only
*shaped like* the ring — `js/tower.js` does not fill MAI's footprint, it draws
the recessed centre bay set back, so the ring-shaped IoU match says "solid" where
the render shows open air. So only the id-matched footprints join the front
union. `buried.md` §4 already drew that line — *"an id match is exact; a ratio is
a threshold"* — and it turned out to be load-bearing.

**Blast radius, measured.** 11 door groups move, 2.04–9.61 m. All 11 were
photographed from both bearings on the fixed file. **None got worse and eight got
better:** 138 GSB 1,052 → 27,047 on its weak bearing, 486 MEZ 909 → 33,160,
345 SEZ 0 → 19,426, 281 0 → 10,728, 391 0 → 15,163, 346 0 → 27,448, 276 2,758 →
8,730, 38 14,807 → 18,434. Bake health: 656 groups on 295 buildings unchanged,
min 1 / median 2 / mean 2.22 / p90 4 / max 8 unchanged, 19 buildings with no
entrance unchanged, **zero identity drift** (every eid keeps ref, name, era, src,
role and bid), floating sills 0, detached pieces 0, bad base/h/colour 0, OSM
recall floor 67 % at 8 m unchanged, median position error 0.00 m unchanged.
Pieces 15,069 → 15,067.

### Rank 2 — eid 292 (DKR) is dark, and was dark before

`0 px` from both bearings at 15 m and 22 m — and `0 px` from both bearings on the
**pre-NB2** file too. Not caused by this change and not fixed by it: the thing in
front of it is `js/stadium.js`'s authored wall (base 6.5 → 22.4 with a lintel
below it), which the fix does not touch because it is not the host's own
footprint. A service door in the stadium's service canyon. Recorded, not fixed.

### Rank 3 — MAI's flight has cheek walls where `celebrated.md` says "no rails"

§5.1's authoring default is *"5 risers full width across the recessed bay, no
rails"*. The render puts low stone cheek walls at both ends of the flight. It is
period-correct and it is one constant, but it disagrees with the written default.
Pre-dates this pass. Simeon's call, not mine.

---

## 5. The three dropped doors

All three are on the DKR service belt, and all three now print their
**coordinate** — because a drop line without one cannot be walked to, and walking
to it is the only way to tell a genuinely tight wall from a wrong constant:

```
DROPPED 1 on 568a1f55-…  at -97.731425,30.284601
DROPPED 1 on 568a1f55-…  at -97.731552,30.282656
DROPPED 1 on RMRZ;NEZ    at -97.731592,30.284884
```

Before, the first two collapsed into one line reading `DROPPED 2 on 568a1f55`,
which hid that they are **215 m apart**. Photographed from four bearings each
plus a look-down (`shots/relocated/drops/`):

- All three stand against **curved concourse and ramp walls with roadway or
  service apron in front**, not pedestrian frontage. The nearest other building
  is 10.4 m, 15.7 m and 22.4 m away.
- **Dropping was the right call for all three.** What I can say is that the walls
  look exactly like what the rule describes — no 3 m of straight run with 4 m of
  clear space in front of it. What I did **not** establish is whether
  `BURIED_RUN_MIN` 3.0 and `BURIED_CLEAR_M` 4.0 are the right numbers; I checked
  the walls against the rule, not the rule against the world.

---

## 6. The hero gate

Six poses, reconstructed from `docs/aws/beautiful.md` (the committed `C-HERO*.png`
were hand-flown and unreproducible — HANDOFF §116's substitution, used again).
Same served tree, only `data/entrances.geojson` swapped, a fresh browser per arm,
**launches interleaved**, and **every arm waited for `austin-entrances` to report
LOADED** (11.6–12.2 s) before any frame.

**Noise floor first**, same file, two launches:

```
                MAIN r1 vs r2      PRE r1 vs r2
H1-spawn        IDENTICAL BYTES    IDENTICAL BYTES
H2-drag         0 over24 max 1     IDENTICAL BYTES
H3-tower        IDENTICAL BYTES    IDENTICAL BYTES
H4-city         0 over24 max 2     IDENTICAL BYTES
H5-dkr          IDENTICAL BYTES    IDENTICAL BYTES
H6-towernight   117 over24         39 over24     <- the night pose has a real floor
```

**What the 25 relocations already on `main` cost the hero frames** (main vs the
pre-NB2 file), both interleaves agreeing to the pixel:

```
H1-spawn        IDENTICAL BYTES
H2-drag         0 over24
H3-tower        43 over24, max 200      <- real, reproducible, and it is MNAC
H4-city         0 over24
H5-dkr          1 over24
H6-towernight   94 / 89 over24          <- BELOW its own 117 px floor
```

The 43 pixels sit at x 78–109, y 700–739 — the **far bottom-left corner**, on the
face of the Moncrief-Neuhaus Athletic Center, and they are eid 621's door having
moved 2.07 m along its own wall. 43 pixels out of 1,296,000 is **0.003 %**.
`main` is recordable and was never at risk.

### And what the FIX costs the hero frames, on top of that

Three more launches, interleaved `NB6-r1 → MAINr3 → NB6-r2`:

```
                NB6-r2 vs MAINr3
H1-spawn        IDENTICAL BYTES
H2-drag         0 over24, max 4
H3-tower        47 over24, max 131      <- same bottom-left corner, x 89-101 y 735-745
H4-city         IDENTICAL BYTES
H5-dkr          IDENTICAL BYTES
H6-towernight   0 over24, max 8
```

**`MAINr1`, `MAINr2` and `MAINr3` are one SHA-256 each at H1, H3 and H5 — three
launches, three identical files.** That is the floor this is measured against.

**`NB6-r1` is thrown out, and the reason is worth keeping.** It differs from
everything — including the other NB6 arm — by ~160,000 px at every day pose, and
the frames are visibly darker and warmer with no bloom on the sun. Its entrance
file took **54.4 s** to land against 11–13 s for every other arm, and
`cancelGraphicsAutoDetect()` runs *before* the entrance wait: on a launch that
slow the auto-detect probe fires first and downgrades the preset, and the cancel
arrives too late. **A whole-frame tone shift in one arm is the graphics preset,
not the data.** (This is the open `graphics auto-detect sticking` defect showing
up in an unrelated measurement.) Interleave, and check whether the outlier arm is
outlying against *its own* twin before you believe it.

---

## 7. What this pass did NOT establish

1. **The other 460 door groups still have never been looked at.** This pass adds
   the 25 relocated groups and MAI's seven to the 196 the n8 and n13 passes shot.
2. **`BURIED_RUN_MIN` and `BURIED_CLEAR_M` were not tested against the world.**
   §5 checks three walls against the rule; nobody has checked the rule against a
   photograph of the real place.
3. **eid 292 is not fixed** and I do not know whether its door belongs where it
   is. It is dark on `main` and dark on the pre-NB2 file.
4. **`data/walk_graph.json` is now stale by up to 9.61 m on 11 buildings and this
   pass did NOT re-bake it** — `scripts/bake_walk.py` and `data/walk_graph.json`
   belong to the snapshot lane. **It needs re-baking.** Largest movers: GSB
   9.61 m, eid 281 8.09, MEZ 7.46, eid 276 7.35, BHD 6.62. `sweep.md` §5.5 treated
   0.64 m as inside routing tolerance; these are ten times that.
5. **Nothing here was measured against a photograph of the real building.**
   "Correct" means correct against `celebrated.md` and against being visible from
   the pavement.
6. **The standoff ladder is the instrument's, not a choice per door.**
   `relocwalk` falls back to 22 m when the collision net lifts the eye, so the
   four re-shoots labelled `-8m` were also taken at 22 m and are not the closer
   look they were meant to be.
7. **NB5 is still open** — the bake reads the `2026-08-04` snapshot while the app
   draws `manifest.latest` = `2026-08-16`. Every finding here inherits that.
