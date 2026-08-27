# What stands over the door

Round 3 of the entrances piece, branch `acer/cd-entrances`, 2026-08-27.
One script changed — `scripts/bake_entrances.py`, which owns
`data/entrances.geojson` and writes nothing else. No app code. `WAYFIND.on`
untouched. No door moved: the maximum door-centroid movement between the
before and after bakes is **0.0000 m**, checked directly.

---

## 1. The defect, and why the last two rounds could not have caught it

Round 2 put doors where UT says the doors are and gave each door a sourced
*era*. The reviewer then found the hole both rounds had walked past:

> Family D's GEOMETRY was never checked against a photograph, on this
> building or any other — only its ASSIGNMENT got a sourced, cited pass.

`bake_entrances.py` had this, and had had it since family D existed:

```python
# -- D - modern glazed bay, 1990-2026. The canopy is the identifying
#        feature and its 0.18 m thickness against C's 0.25 IS the read.
canopy=dict(proj=3.20, t=0.18, top=4.20, mat="steel", col=STEEL),
```

"The canopy is the identifying feature." Nobody had ever looked at a
photograph to check. It was an **era rule** — built after 1990, therefore a
3.20 m steel blade over the door — and between families C, D and E2 it painted
one on **335 of 591 doors**, none of them with a source.

The proof was inside round 2's own write-up. The building it named as family
D's win is the Tom & Cinda Hicks North Gate (NEZ), and the photograph it cited
shows brick piers, a recessed glass curtain wall, a lettered signage band and a
limestone plinth — **and nothing projecting from the elevation at all.** The
round quoted a picture with no canopy in it as evidence for a family whose
identity was the canopy.

Section 1b of `campusmeter.mjs` scores whether a door's era is honestly
sourced. Nothing scored whether the *shape* is. That is the instrument this
round had to build first.

---

## 2. The measurement

343 of UT's own building photographs, from
`utdirect.utexas.edu/apps/campus/buildings/information/nlogon/maps/UTM/<CODE>/`
— no login — fetched and **viewed** on 2026-08-27, across all 148 codes that
carry a drawn door. 98 of them show the entrance well enough to say what is
over it. One call per building, four values:

| call | meaning | count |
|---|---|---|
| `canopy` | a roof/blade/marquee/porte-cochère **stands over** the doors, cantilevered or on its own posts, separate from the mass | 15 |
| `arcade` | a colonnade or covered walk runs in front and the doors open off it | 15 |
| `recess` | the doors sit back under the building's own upper floors | 19 |
| `flush` | a plain opening in the wall plane; nothing over it | 49 |

The photographs themselves are **not committed** — UT Direct states no licence
on them, so the repo keeps the measurement and cites the page, the same
caution this repo already applies to other UT-sourced material.

### The rule that falls out, and it is not the one the file had

A projecting canopy is on **15 of 98** entrances — 15% — and **it does not
track the era at all**:

```
  family A  Gilbert     1910-1922     0 of  3 have a canopy
  family B  Cret        1926-1942     0 of 20
  family C  midcentury  1950-1989     6 of 40      15%
  family D  modern      1990-2026     4 of 24      17%
  family E5 null                      1 of  6
```

C and D are the same rate. The file had A and B right and C, D and E2 wrong,
and it had them wrong in the one way that shows up on every frame.

So the canopy is a **per-building fact, not an era fact**, and the honest
default is the one this file already applies to families themselves, in its
own words: *"Families are OPT-IN by evidence and E5/NULL is the default."*
The canopy was the one part of the vocabulary that had never been held to it.

### The shape was right. The assignment was the lie.

Scaled off the doors in the photographs (a leaf is 2.13 m), the canopies on
the Forty Acres have a **median projection of 2.40 m, top 3.60 m, thickness
0.25 m** — which is family C's canopy exactly. Family D's 3.20 / 4.20 / 0.18
matches nothing measured; the widest thing in the survey is a genuine
porte-cochère at 7.5 m and the rest cluster tightly around the median. So the
fallback is the measured median, and every building that has one carries its
own numbers off its own photograph.

`CANOPY_SIDE_D = 1.20` went with it, back to the plain `0.60`: the wide side
overhang existed only to make family D's invented blade legible.

---

## 3. The instrument, and why it is held out

A table the bake reads and the meter scores is a tautology — the bake agrees
with it by construction and the number goes straight to 100%. So the survey
was **split before a single row was written**, on a rule anyone can re-check
in one line:

```
blind  iff  sha1(code).hexdigest()[0] in "0123"
```

* **76 rows** are training data and live in `SHELTER_OBS` in
  `scripts/bake_entrances.py`.
* **22 rows** live only in
  `scripts/verify/campusmeter-fixtures/door-shelter.blind.json` and **the bake
  has never read them.**

`campusmeter.mjs` section 1c asserts the two sets are **disjoint** and exits 1
if any code appears in both — so a later lane that pasted the answers across to
lift the number fails the harness instead of raising the score. The baseline
column ("what the era alphabet alone would draw") is not a remembered number
either: it is recovered by slicing the real `FAMILIES` table out of the served
bake source at run time. C, D and E2 still *declare* their canopy dicts — the
change gates them at assembly, it did not delete the vocabulary — so the old
rule stays measurable from the file itself.

### The held-out score

```
  code   photograph says   era-alphabet drew   this build draws
  ---------------------------------------------------------------
  CPE    arcade            canopy  NO          none  ok
  HRC    arcade            canopy  NO          none  ok
  JCD    arcade            canopy  NO          none  ok
  MAI    arcade            none  ok            none  ok
  TCC    arcade            canopy  NO          none  ok
  CBA    canopy            canopy  ok          none  NO
  LFH    canopy            canopy  ok          canopy  ok
  UA9    canopy            canopy  ok          none  NO
  UTA    canopy            canopy  ok          none  NO
  BAT    flush             canopy  NO          none  ok
  BRB    flush             none  ok            none  ok
  CMB    flush             canopy  NO          none  ok
  CRH    flush             canopy  NO          none  ok
  NEZ    flush             canopy  NO          none  ok
  SJG    flush             none  ok            none  ok
  SW7    flush             canopy  NO          none  ok
  SWG    flush             none  ok            none  ok
  SZB    flush             canopy  NO          none  ok
  TMM    flush             none  ok            none  ok
  WAG    flush             none  ok            none  ok
  PAC    recess            canopy  NO          none  ok
  SSB    recess            canopy  NO          none  ok

  HEADLINE: 19 of 22 held-out buildings show what the photograph shows
            (the era alphabet alone: 10 of 22)
```

**And the number that keeps this honest, printed next to it:** on the 4
held-out buildings that really do have a canopy, this build draws **1**; the
era alphabet drew **4**. It drew four because it drew a canopy on everything —
a classifier that answers "yes" to every question has perfect recall and 45%
accuracy, and both halves are printed so "draw nothing" can never pass as an
answer here either.

That is the real trade and it should be said plainly: **this change is a large
precision gain bought with a recall loss**, and the recall loss is recoverable
only by looking at more photographs.

---

## 4. What changed in the file

* `SHELTER_OBS` — 76 cited observations, each with the call and what was
  actually visible in the frame.
* The canopy is now resolved per door, and **obeys the photograph in both
  directions**: a canopy the picture shows gets drawn whatever family the
  building is in (that is how the one canopy on a plant building and the two
  toll canopies over garage lanes reach the screen), and a canopy no picture
  shows is dropped — which only ever bites C, D and E2, because they are the
  only families that had one to drop.
* `SHELTER_APPLIES_TO = ("main",)` — a photograph of the front door evidences
  the front door. It says nothing about the service door round the back, so the
  back door keeps the default. `SHELTER_FALLBACK_NO_MAIN` is the one exception,
  and it exists because every parking garage is in the state where role
  assignment never names a `main` door at all.
* `SHELTER_REVEAL_D` — `arcade` / `recess` / `flush` deepen or lighten the
  reveal shading. This is the *only* part of those three calls that reaches the
  screen; see §6.
* Every canopy in the file now carries `csrc` on its piece, so "how many
  canopies are sourced" is one query instead of an archaeology project.
* Every value above is a named constant, so any of it can be overruled in a
  one-line edit — including the doctrine itself,
  `SHELTER_CANOPY_BY_DEFAULT = False`.

The bake now prints the whole thing loudly, including rows that do nothing:

```
SHELTER            : 10 canopies drawn from a photograph, 299 unevidenced canopies dropped
                     reveal deepened: arcade 12, recess 23, flush 47
  observations idle: 0 of 76 rows reached no door on their building []
```

---

## 5. The picture

`shots/cd-entrances/r3-shelter-nez.png` — the reviewer's own example. Left,
the 3.20 m blade across the whole elevation, drawn because the building is
post-1990. Right, gone: brick piers and a recessed glazed bay, which is what
UT's photograph of that door shows.

`shots/cd-entrances/r3-shelter-etc.png` — the other half of the story, and the
reason this is not "delete every canopy". The Engineering Teaching Center has a
real flat metal canopy on two round columns. It is kept, and **resized to the
photograph**: 3.00 m out and 4.00 m up instead of family C's unsourced 2.40 /
3.60.

`shots/cd-entrances/r3-shelter-sut.png` — the control. Sutton Hall is family A,
which never declared a canopy. The two frames are identical. Nothing that was
already right moved.

All three: same camera, same standoff, same pixel, `doorwalk.mjs` on port 8821,
eye altitude read back at 2.23 m (the app's own floor at 14 m standoff).

---

## 6. What is still wrong, named so nobody has to rediscover it

1. **`recess` and `arcade` are recorded and not drawn.** 34 of the 98
   photographed entrances are sheltered by something real — a colonnade, a
   cantilevered upper floor — and all this round does about it is darken the
   reveal panel. The entrance wall is an extruded footprint and this bake
   cannot cut into it. **This is the biggest remaining gap and it is bigger
   than the one this round fixed:** 34 buildings with the wrong shape beats 15
   with a missing canopy.
2. **Recall on canopies is 1 of 4 on held-out buildings.** Three real canopies
   (UTA's porte-cochère, CBA's projecting roof plane, UA9's blade) are not
   drawn, because the rule that gets 19 of 22 right is "draw nothing unless a
   photograph says otherwise" and those three photographs are in the held-out
   third. The only honest fix is more observations, not a cleverer default.
3. **50 of the 148 door-bearing codes have no usable photograph** — 23 have no
   UT Direct photo at all, the rest have photos that never show the entrance.
   Those buildings are running on the default and nobody has checked them.
4. **Secondary doors are entirely unobserved.** 591 doors, 98 observations, and
   every observation is of a front door. A building whose back door has an
   awning will not have one here.
5. **The wall behind the door is still a placeholder.** Every frame in §5 shows
   a uniform vertical-stripe texture standing in for brick or limestone, and a
   plank-textured ground plane. That is the facade/ground work, not this piece,
   but it is the loudest thing in the picture and it should not be mistaken for
   fixed.
6. **`ATT`'s canopy is drawn over the door bank, not along the elevation.** The
   photograph shows a canopy running the full arcade; the primitive is a slab
   over the bank. Same for `FNT`, whose real canopy is a semicircle. Both are
   noted in their own rows rather than silently approximated.

---

## 7. Everything else held

* `campusmeter.mjs`: entrances A **74/181**, B **69/516**; era MEASURED
  **301/591**; facades **0/7**; paths A **624/625**, B **105/624** — every one
  byte-identical to the round-2 numbers. Nothing else was touched.
* `walkmeter.mjs`: **38 of 38** ends at UT's own door, 87.0 m over the pairs it
  makes worse, −393.7 m signed total, drift 0.00, live "avoid stairs" UI gate
  PASS. Identical to §181.
* `coplanar.mjs`: `entrances.geojson` coplanar overlaps **1786 → 1519**, since
  299 canopies were two overlapping slabs each.
* Bake self-audits: 0 floating sills, 0 detached pieces of 14,070, 0 bad
  base/height/colour, 591 doors before and 591 after.
