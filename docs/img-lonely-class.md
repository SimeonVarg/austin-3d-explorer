# img-lonely-class — the class with nobody beside it

**QUEUE IMG0a and IMG0b.** Branch `acer/img-lonely-class`, off `origin/main`
(`30b701c`). Port 8973, `python scripts/serve.py`, never `http.server`.
`WAYFIND.on` is still `false` (`js/wayfind.js:88`) and that file is not in the
diff.

**One sentence.** A real-but-wrong UT building code was saved silently at
confidence **1.00** whenever the misread class was the only class on its day —
one of the commonest schedule shapes there is — and it now raises one question
with the right answer as a button.

**Shipped 2026-08-26** by the ship lane after three independent judges and its
own from-scratch re-measurement. See §11 at the bottom for what that lane ran,
including the one thing it had to recover from mid-pass.

![The question a class with nobody beside it now raises, on a 390x844 phone.
The crop at the top is the student's own picture — it reads MEZ 1.306 while the
reading underneath says NEZ.](../shots/img-confidence/lonely-class-question-phone.jpg)

*`shots/img-confidence/lonely-class-question-phone.jpg` — corpus image 03 read
for real, one stroke of the answer changed to `NEZ`, then kept as the only class
in the schedule. Before this round that screen did not exist: the class was
written down as NEZ at 1.00 and nothing was said.*

---

## 1. The mechanism

Some real UT codes are one stroke apart. **MEZ** is Mezes Hall on the South
Mall; **NEZ** is the North End Zone Building, inside the football stadium,
**803 m** away (the real `data/walk_graph.json` says `metres 803.36`, 9–13 min).
When the reader misreads one *as* the other, the misread lands on a code that is
really on UT's register, so every "is this a building?" check in
`js/schedconfirm.js` answers **yes** and `CONF.building.lexicon` scores it
**1.00** on its own.

The only thing in the repo that asks the *other* question — "is this the RIGHT
building?" — is `neighbourDoubt()`. It had two legs and **both went blind on the
same shape, at the same time**, which is why nobody saw it:

- **The venue leg** tests UT's own printed name against `CONF.venue.unlikely`.
  Stadiums, gyms and residence halls are excluded from that list **on purpose**,
  and the comment there names NEZ as *"the case this whole check exists for"* —
  UT really does teach in all three, and a check that fires on a real classroom
  is worse than no check. So it cannot fire here, by design.
- **The walk leg** called `adjacentLegs()`, which skips every class where
  `o.day !== cls.day`, and then read `if (!legs.length) return null;`.
  **No same-day neighbour → no legs → no doubt, no question, no crop.**

So a once-a-week discussion section, lab or seminar got `M.apply()` committing
`{building:"NEZ", room:"1.306", day:"Fri", needsConfirm:false}` at full
confidence, with no chip and no "why", and the student found out when the door
was locked 803 m away.

**Why every green gate missed it.** `scripts/verify/schedconfirm.mjs` §2c tested
this exact NEZ misread — but only ever inside a **three-class day**. The
benchmark could not catch it either: every scored class in the 15-image corpus
has same-day company (`truth.json`: four schedules, none with a lone day). The
gate was green over the hole for a whole round. That is fixed here too — §5.

---

## 2. The direction chosen, and why it beat the others

The brief named three candidate directions and left the call to this lane. The
tension is the whole job, and it runs both ways:

- **Under-asking** is the defect: a wrong building saved silently at 1.00.
- **Over-asking** is the failure not to introduce. Today a student who skips
  every question loses 3 classes out of 171 and gains nothing wrong. If the fix
  interrogated every one of the 13 confusable pairs unconditionally, a student
  with an ordinary timetable would be asked about roughly one class in eight for
  nothing — and **a question the student always answers "yes, obviously" is what
  trains them to tap through the one that mattered.**

**What landed: the walk check widened from the day to the WEEK, with a
last-resort standing doubt underneath it that can only fire when the geometry
has nothing at all to look at.** Four readings, tried in order, each speaking
only where the one above it had nothing to say:

| | reading | when it speaks | charged |
|---|---|---|---|
| 1 | UT's printed name is a car park | always (needs no graph) | `venueNeighbour` 0.62 |
| 2 | the swap fixes / shortens the **same-day** walks | there is a class either side | `walkNeighbour` 0.55 / `nearerNeighbour` 0.62 |
| 3 | **NEW** the swap is nearer to the rest of the **week** | nobody else on this day | `weekNeighbour` 0.65 |
| 4 | **NEW** membership of a confusable pair, alone | nothing else in the schedule at all | `loneNeighbour` 0.68 |

Both new factors are deliberately the **weakest doubts in the file** — they rest
on the least evidence — and both sit clearly under `askBelow` (0.72) and above
`keepUnansweredAbove` (0.34), so each asks once on its own and a student who
never answers still keeps the class.

### Why 3 (the week) over the alternatives

**It keeps doubt evidence-based.** A class 803 m from every other building the
student attends all week is suspicious whether or not anyone sits beside it on
Friday. Nothing about the code itself is being held against it; the graph is
still the witness, just read over a wider window.

**The statistic is the MEAN, not the sum, and that is the whole safety
argument.** The sum grows with how many buildings a student has, so a fixed line
on it would begin firing on **PAI/PAT** — Painter Hall and Patterson Labs, 250 m
and 2 minutes apart — as soon as a schedule had three other buildings in it, and
this file's own gate reports that pair as *honestly unresolvable*. The mean does
not grow. By the triangle inequality `|d(P,X) − d(Q,X)| ≤ d(P,Q)` for every `X`,
so a pair `d` minutes apart can never move the mean by more than `d`, whatever
the schedule looks like. Measured on the real graph, the two closest pairs the
graph can even see both members of are **PHD/RHD at 0 min** and **PAI/PAT at
2 min**, so **`weekGainMin: 3`** is the first value neither can ever reach —
exactly the construction `gainMin: 5` already uses, applied to the mean instead
of the sum. The line is derived from the register, not fitted to the corpus.

The class's **own** code is included in the week set, at zero minutes from
itself, so a second reading of the same code on another day corroborates rather
than accuses — the same reasoning as `CONF.room.agreed`.

### Why 4 (the standing doubt) is gated the way it is

Case B in the brief is a schedule with **one class in it**. There is no same-day
neighbour and no rest-of-week neighbour: the graph has been asked and has
nothing to look at. Only then is "this code is one stroke from another real
code" the whole of what the app knows, and then it is worth one tap.

It fires **only** in that state. Not when the graph disagreed (that is a reading,
and it stays silent). Not when the graph could not measure the code (that is the
residual hole §6 reports honestly, and turning it into a question would fire on
every MMS, BEL, FSL, GHE, ICB, PHD and PRH class in every schedule). Not when the
graph is missing altogether — `walkCheck.active` already reports that, and a
missing witness is not the same as a witness with nothing to see.

**It is symmetric, and that is stated rather than glossed.** With one class and
no second building anywhere, this app has no evidence in either direction, so a
lone *correct* MEZ is asked about too — one tap on a one-class import. §4 shows
it and `schedconfirm.mjs` §2c now asserts it, so nobody later reads "it asks"
as "it only asks when it is wrong".

### The two directions that did NOT land, and why

**"Member of a confusable pair" as an unconditional standing doubt.** Thirteen
pairs is twenty-six codes. Schedule s3 in the corpus's own answer key has a real
class in `MEZ 1.306` *and* one in `PAI 3.02`; s4 has another `MEZ 1.306`.
Unconditional, that alone would have turned §2e — *"not one of the answer key's
own meetings raises a question"* — from **0 of 49** into several, on data that is
correct by definition. That is the exact over-ask the brief forbids, and it is
measurable, so it was measured rather than argued about.

**The OCR's own per-character confidence on the distinguishing stroke.** This is
the signal in principle — M vs N is one glyph — and it was rejected on this
repo's own measurement, not on taste. `CONF.ocr`'s comment records that
Tesseract's word confidence was tried as the base of every field and thrown out:
on this corpus it has *no discriminating power at all* — every correct reading
spans 41..96 and every wrong reading in the loose pass came in at 90+. Per-symbol
confidence is also not plumbed through `ev.conf` today, so shipping it would mean
a schema change in `js/schedimg.js` **plus** a threshold nothing in this repo can
calibrate: the corpus never actually produces a MEZ→NEZ misread, so there would
be zero evidence the new number helps. A guess wearing a number is the failure
this file exists to prevent. Left for whoever measures a real misread rate first;
`ev.conf.building` is where it plugs in.

---

## 3. What changed

`js/schedconfirm.js` only, plus its gate.

- `CONF.building.weekNeighbour = 0.65`, `CONF.building.loneNeighbour = 0.68`.
- `CONF.walk.week = true`, `CONF.walk.weekGainMin = 3`, `CONF.walk.lone = true`
  — three switches, so any of this can be turned off in a one-line edit
  (`CLAUDE.md` rule 11).
- `weekBuildings()` — the distinct buildings this student walks to on **other**
  days, once each.
- `neighbourDoubt()` — the same `cost()` comparison now runs over either
  same-day legs (sum, can be *impossible*) or rest-of-week buildings (mean,
  never impossible), and returns the lone doubt when there is neither.

Nothing else in the file moved: `askBelow` is still 0.72, the reading still
leads the buttons, and the check still **asks and never rewrites**.

---

## 4. Before and after — cases A, B and C

The brief's own three shapes, run against the **real 209-code register** and the
**real `data/walk_graph.json`** (`@2026-07-30T16:47:30Z`, 158 routable codes),
driving the real module in a real browser. Fixture is `mk()` from
`scripts/verify/schedconfirm.mjs`. **Case A is the control** and it is unchanged,
reason text and all — without it a silent result below is indistinguishable from
a rig that stopped working.

| case | shape | before | after |
|---|---|---|---|
| **A** (control) | `NEZ 1.306` with WEL before and GDC after, **same day** | ask **true**, overall **0.62** | ask **true**, overall **0.62** — same reason |
| **B** | the identical `NEZ` reading, **alone, only class in the schedule** | ask **false**, overall **1.00** | ask **true**, overall **0.68** |
| **C** | B plus WEL on Mon and GDC on Wed | ask **false**, overall **1.00** | ask **true**, overall **0.65** |

And the same three with the **true** MEZ in them, which is the half that costs a
student something:

| case | shape | before | after |
|---|---|---|---|
| **A′** | true `MEZ`, same day as WEL and GDC | ask **false**, 1.00 | ask **false**, 1.00 |
| **B′** | true `MEZ`, only class in the schedule | ask **false**, 1.00 | ask **true**, 0.68 — *one tap, symmetric, see §2* |
| **C′** | true `MEZ`, alone on Fri, WEL Mon + GDC Wed | ask **false**, 1.00 | ask **false**, 1.00 |

What the student actually sees, after:

```
  A   MEZ is one stroke from NEZ and is 8 minutes closer to the classes
      either side of it                                    -> [NEZ] [MEZ]
  B   NEZ is one stroke from MEZ, and this schedule has nothing else in
      it to check that against                             -> [NEZ] [MEZ]
  C   MEZ is one stroke from NEZ and is 4 minutes closer, on average, to
      every other building this schedule goes to — and there is no other
      class on Fri to check it against                     -> [NEZ] [MEZ]
```

The reading still leads in all three; the neighbour is the second button; the
reason is printed underneath. It asks, it does not rewrite.

**`MMS`/`NMS`, the brief's second pair.** After the change it asks in shape B
and stays silent in A and C — because **`MMS` and `NMS` are not both in the walk
graph**, so no amount of geometry can separate them and the lone reading is the
only one that reaches. That is the honest reach of this fix, not a gap that was
hidden: §6.

---

## 5. Both sides measured — the over-ask number

**Questions per import, the whole 15-image corpus, real reader + real
`review()`, every cross-check live.**

```
                          before        after
  classes read             136           136
  questions raised          16            16
  per import              1.07          1.07
  retake list                0             0
```

**Identical, image for image** — the same 1 question on images 01, 03, 07 and
10, the same 4 on 05, the same 8 on 09, zero on the other nine. Not one new
question anywhere in the corpus. That is the expected result and it is the
reason the direction was chosen: every corpus schedule has several buildings and
every scored class has same-day company, so reading 3 and reading 4 have nothing
to add to any of them.

**The answer key, straight through the model** (`schedconfirm.mjs` §2e — 49
meetings that are correct by definition): **0 of 49 asked, before and after.**
This is the sharpest over-ask instrument in the repo and it did not move.

**The benchmark score.** `image-bench.mjs` with `img-import-extract.mjs`, the
student who answers **nothing**. Both runs on this machine, this round — the
"before" was re-run here on the stashed tree rather than quoted from
`docs/img-verdict.md`, so the two numbers come off the same instrument on the
same box:

```
                              before        after
  ALL FOUR FIELDS RIGHT     131 / 171     131 / 171     (76.6%)
  precision                    100.0%        100.0%     (133 predictions,
                                                          0 matched nothing)
  hallucinations                    0             0
  three-of-four near miss           0             0
  false positives                   0             0

  clean-export                  52/52         52/52
  angled-photo                  23/49         23/49
  dark-mode                     24/38         24/38
  partial-crop                  32/32         32/32
```

**Identical line for line, by condition included.** The score did not fall and
did not move.

**The gate.** `scripts/verify/schedconfirm.mjs`: **101 passed / 0 failed**
before, **108 passed / 0 failed** after — seven new assertions, nothing red.

---

## 6. The one-class-day case in the gate, and the control beside it

Without this the gate stays green over the hole forever, which is exactly what
happened for a round. `schedconfirm.mjs` §2c now runs the same MEZ→NEZ misread
in **three** shapes, each of them twice — once with the misread and once with
the true code:

- `day` — a class either side, same day. **Unchanged, and kept as the CONTROL.**
- `week` — alone on Friday with an ordinary MWF load on the other days.
- `lone` — alone on Friday and the only class in the schedule.

Plus an over-ask control the widened check had to survive: **`PAI` alone on
Friday raises nothing**, because the week read cannot separate a 250 m pair
either. s1 and s3 both put a real class in `PAI 3.02`, so if that ever fires it
fires on the corpus.

**The residual hole, unchanged and still reported pair by pair.** Of the 13
confusable pairs in the 209-code lexicon, only 4 have both members in the walk
graph and only 2 of those (`MEZ/NEZ` at 9 min, `TSC/TSG` at 20 min) are far
enough apart for the graph to separate; UT's printed names separate 4 more. This
round did **not** widen that coverage — it made the two witnesses reach the
schedule shapes they were already supposed to cover. `PAI/PAT` is still
invisible and the gate still says so out loud.

---

## 7. IMG0b — two published sentences corrected

1. **`docs/img-bar.md`** was headed *"The downstream parsing — the same parser
   the feature gets"* and claimed the number therefore measured *reading the
   image* rather than *who bolted on a smarter parser*. It does not.
   `window.wayfindParseSchedule` is the app's real production parser, but it is
   the producer behind the **paste-and-text** import screen; the photo path goes
   through `confirmFromFile()` → `js/schedimg.js`, and
   `grep -c "wayfindParseSchedule\|schedParseRows" js/schedimg.js` is **0**,
   re-checked here. That bounding-box geometry is the main lever between 36 and
   131 and it is on exactly one side of the comparison. The section now says so.
   **The 36 and the 131 both stand as measured** — the framing was wrong, not
   the numbers.
2. **`docs/img-verdict.md`**'s import **request count** now carries a "do not
   quote this" note. It reads 165 there, 136 in the committed `img-import.mjs`
   run, 99 in `docs/img-independent-check.md` §5 and 30 in the privacy checker's
   capture — four measurements of the same import. The claim is the other five
   lines: zero bodies, zero needles, zero new hosts, zero sink hits, each proved
   non-blind by a canary first.

---

## 8. What this lane did NOT check

- **Whether Tesseract really misreads MEZ as NEZ from a real photograph.** The
  premise is the repo's own — `MEZ 1.306` is a real class in the corpus's
  schedule s3 and §2b already asserts the pair is one confusable stroke apart —
  but the real-world *rate* behind this defect is still unmeasured and may be
  low. This fix costs nothing when the rate is zero and pays a tap when it is
  not, which is why it did not wait for that number.
- **A schedule where every reading of the pair agrees.** Three Monday/Wednesday/
  Friday readings that all say NEZ corroborate each other at zero minutes and
  raise nothing. That is deliberate and consistent with `CONF.room.agreed`, but
  it means a *systematic* misread on one picture is still invisible.
- **Timing.** Nothing in this diff is on the load path and no timing number is
  claimed. `js/schedconfirm.js` is still a dynamic import reached only when a
  student picks a file.
- **The other 11 confusable pairs.** Coverage is unchanged at 5 of 13 wherever
  the geometry can measure; §6.

## Housekeeping

Every server and browser this lane started was killed and port 8973 freed;
`Get-Process node,python,chrome` is empty at the end. Scratch frames went to the
scratchpad, not `shots/`. `js/wayfind.js` is not in the diff.

---

## 11. The ship lane's own reading — 2026-08-26, port 8951

Written by the lane that merged it, from what **it ran itself**. Nothing below
is quoted from the builder or from the three judges; every number was produced
on this machine with this lane's own fixtures against its own server, and where
a number was NOT re-measured here it says so.

**Case B, with `main` as the control.** The same instrument, the same server,
the same run — the only thing changed is which module the page imports. `main`'s
`js/schedconfirm.js` was served alongside as a sibling file so the two could be
read back to back rather than across a checkout:

| shape | on `origin/main` | on this branch |
|---|---|---|
| **A — control**, `NEZ` with WEL before and GDC after, same day | ask **true**, 0.62 | ask **true**, 0.62, *reason text identical* |
| **B**, the same `NEZ`, the only class in the schedule | ask **false**, **1.00** | ask **true**, **0.68**, `kind: lone` |
| **C**, alone on Friday, WEL Mon and GDC Wed | ask **false**, **1.00** | ask **true**, **0.65**, `kind: week-nearer` |
| **A′ / C′**, the true `MEZ` | false, 1.00 | false, 1.00 |
| **B′**, the true `MEZ` alone | false, 1.00 | **true, 0.68** — the disclosed symmetric tap |

`M.apply()` on B and C commits `{building:'NEZ', needsConfirm:true}` on this
branch against `{needsConfirm:false}` on `main`, and the reading is **kept**, not
rewritten. Case A is byte-identical across the two, which is what makes the rest
of the table readable at all: a silent result with no control is indistinguishable
from a broken rig.

**It generalises past MEZ/NEZ.** Five more codes from the thirteen confusable
pairs — `PAI`, `TSC`, `MMS`, `GHE`, `ICB` — each alone as the only class in a
schedule: every one asks, `kind: lone`, 0.68.

**It is not "one class means a question".** A lone `WEL` — a real code with no
confusable neighbour — stays silent at 1.00, and an ordinary four-class week
raises **zero** questions.

**Over-asking, measured on the real corpus rather than argued.** This lane built
its own probe that drives the shipped entry point (`window.wayfindImportImage` →
`#wf-cfm`) for all fifteen corpus images and steps **every** question screen,
reading the text off the DOM — it never presses "Skip the rest". Result:
**16 questions over 15 imports = 1.067 each**, per image `01=1 02=0 03=1 04=0
05=4 06=0 07=1 08=0 09=8 10=1 11=0 12=0 13=0 14=0 15=0`. The same probe run
against a tree without this fix returns the identical count and the identical
per-image split. And reading the captured question text back: **none of the 16
is the new pair question** — they are day chips, single-option confirmations and
one genuine 2:00-vs-7:00 pm ambiguity. The new branches cannot fire anywhere in
this corpus, because its only class alone on its day is `BIO 311C` in `WEL`,
which has no confusable neighbour.

**Gates, re-run here on the tree that was merged:** `schedconfirm.mjs` **108/0**,
`image-bench.mjs` (`img-import-extract.mjs`) **131/171, 76.6%, precision 100.0%,
0 hallucinations, 0 near misses, 0 false positives**, by condition
`clean 52/52 · angled 23/49 · dark 24/38 · crop 32/32`, `si-integration.mjs`
**50/0**, `img-import.mjs` **67/0**. `js/wayfind.js` has a zero-line diff against
`main` and `WAYFIND.on` is `false` at line 88. The diff adds no `fetch`, `XHR`,
`sendBeacon`, `WebSocket` or `postMessage` — a schedule still cannot leave the
device.

### The thing that went wrong, because it will happen again

**Mid-pass, another session moved `HEAD` in this same working directory.** The
local branch was reset from the fix commit back to `origin/main` and two
unrelated docs commits were made on top of it, which silently removed
`js/schedconfirm.js`'s fix from the working tree **while this lane was running
gates against it**. It surfaced as a real-looking defect — the lone doubt
suddenly not firing on a real extracted reading — and cost a full bisect before
`CONF.walk` was printed and turned out to have no `lone` key at all, i.e. the
page was serving `main`'s module.

Two things follow, and both are cheap:

1. **Print the thing under test, not just the result.** One line dumping
   `CONF.walk` would have identified this in seconds. A harness that never
   states which build it is measuring cannot tell "the fix is wrong" from "the
   fix is not there".
2. **Bracket every long run with `git rev-parse HEAD` and a `grep -c` for a
   token only the change contains.** Every run in §11 is bracketed that way; the
   ones taken before the bracket was added were all re-run afterwards and are
   the numbers quoted above. Nothing was lost — the fix commit was safe on
   `origin` and both sessions' work was merged rather than either being
   discarded — but a green gate measured against the wrong tree is exactly the
   failure `scripts/verify/README.md` exists to prevent.
