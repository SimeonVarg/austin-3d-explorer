# The day plan — the whole day's walks, not one leg at a time

Lane `acer/si-dayview`. Round 3. Everything below was produced by running the
app, not by reading the code; the instrument is `scripts/verify/dayview.mjs` and
anybody can re-run every number in this file with it.

---

## What this adds

The walk feature answers one question: *I am here, my next class is in WEL.* A
student with four classes asks it three times a day, retypes both ends every
time, and the answer that actually matters — **which of today's three walks is
the one that will make me late** — is not any single one of those three answers.
It is the sequence.

So there is a day plan now. It takes a whole imported schedule, works out the
walk between each pair of consecutive classes, and shows all of them in order,
with the one that is next marked, before you pick one to navigate.

**It is a chooser, not a second feature.** Tapping a walk row calls the same
`run()` the search panel calls, with the same two ends. The ribbon on the ground,
the answer bar, `Walk it`, the stairs card and the lighting card are all the ones
that already shipped and are not duplicated anywhere in this work. Every figure
on a row comes out of the same `computeRoute()` the bar is drawn from, which is
why the two cannot disagree — and there is a gate that checks they do not, per
leg, on every run.

---

## The seam a schedule import has to land on

`docs/import-bar-ut.md` established the thing that makes this tractable: UT's own
location field is `{3-LETTER CODE} {FLOOR.ROOM}`, space-separated, code first —
the same vocabulary `UT_ENTRANCES` in `js/wayfind.js` already speaks. A schedule
import's whole job is turning `MAI 220, TTh 2:00pm` into `MAI`.

So the normalised shape this renderer reads is deliberately thin:

```js
{ day, date, tz, source, items: [
    { course, title, code, room, raw, startMin, endMin, unique,
      codeSource, codeConfidence } ] }
```

Only `code`, `startMin` and `endMin` are load-bearing. Everything else is display
or provenance. `window.wayfindDay(plan)` takes it; nothing calendar-shaped —
no `VEVENT`, no `RRULE`, no `webcal`, no timezone arithmetic — reaches the
renderer at all. That is the parser lane's side of the seam and this side has no
opinion about which of the three sources produced it.

### The three fields that are not for today's three importers

`raw`, `codeSource` and `codeConfidence` exist so that **image-OCR or a
Registration-Plus API can land later without a rewrite here**, which the brief
asked for explicitly.

Google's, Apple's and UT's `.ics` all hand over a code we either read or do not:
confidence is 1, or the parser drops the item. An OCR of a photographed timetable
cannot do that — it will hand over `MA1` for `MAI` with 0.6 of a belief — and a
renderer with no branch for *the code might be wrong* would have to grow one,
which is exactly the rewrite. So the branch is here now and today's three
importers simply never take it: an item under `WF_DAY.confidenceSure` renders
with the raw string it came from and asks to be checked, instead of silently
routing to a building nobody has a class in.

Nothing else was added speculatively. There is no OCR here and no API client.

---

## What it may say about time, and the one thing it will not say

`docs/walk/what-we-can-honestly-say.md` §15 rules that this feature may **warn**
and may never **reassure** — which is why `SAY.passingOver` and
`SAY.passingTight` exist in `js/wayfind.js` with deliberately no third sentence
for the good case.

That rule gets **stricter** here, not looser, because a day plan is tempting in a
way a single leg is not: it would be very easy to print *12 min spare* on every
row. It does not. What it prints is the gap the **schedule itself** holds — a
fact read off the calendar, not a claim about a walk — and it draws the walk's
range inside that gap. The tail of that bar is left empty and unlabelled. There
is a gate that greps the whole rendered surface for `spare`, `you'll make it`,
`plenty of time`, `enough time`, `in time`, `easy` and `no rush`, and it runs on
every fixture.

**The one thing this does better than the single-leg bar.** That bar measures
against `WAYFIND.passingMin`, which its own comment calls the only value in the
feature with no file behind it: *UT's MWF blocks leave ten minutes and its TTh
blocks fifteen, so the sentences say "a 15-minute passing period", never "the".*
A schedule **knows** the real gap. So when there is one it is used instead of the
assumed 15, and the row says which it used (`15 min between them` vs `assuming a
15-minute passing period`). On the MWF fixture — real 10-minute passing periods —
that is the difference between one warning and three.

The ladder has exactly two rungs and must not grow a third:

| the router says | the row says |
|---|---|
| the **fast** end of the range already exceeds the gap | *Longer than the gap, even at a walking pace* |
| the **slow** end exceeds it | *Tight for this gap* |
| neither | **nothing at all** |

---

## The gap bar

The single strongest thing on a walk row, and the reason the sequence reads at a
glance.

The track is the gap the schedule holds. Solid amber to the fast end of the
walk's range, lighter out to the slow end, and the tail left empty. If the slow
end runs past the gap, a hatched stub is drawn **outside** the track — the one
state worth seeing from across the room.

It is not drawn at all past `WF_DAY.gapBarMaxMin` (45 min). A 105-minute lunch
gap is not a race, and an eleven-twelfths-empty track next to a 14–22 minute walk
makes the longest walk of the day look like nothing.

---

## The forcing function, re-verified rather than quoted

The brief named eleven codes no real schedule can route to, and asked for two
claims to be confirmed independently. Both were, **from the running app's own
data**, and one of them is wrong. `dayview.mjs` re-runs this on every invocation
so it cannot go stale.

```
BE1  known=false  route=notfound  UT doors=1  11.83 km from the Tower
BEG  known=false  route=notfound  UT doors=1  11.76 km from the Tower
EME  known=false  route=notfound  UT doors=1  11.58 km from the Tower
FS1  known=false  route=notfound  UT doors=1  11.24 km from the Tower
FSL  known=false  route=notfound  UT doors=1  11.30 km from the Tower
MER  known=false  route=notfound  UT doors=3  11.09 km from the Tower
PX3  known=false  route=notfound  UT doors=1  11.31 km from the Tower
ROC  known=false  route=notfound  UT doors=1  11.70 km from the Tower
SSW  known=false  route=notfound  UT doors=2   0.90 km from the Tower
SV1  known=false  route=notfound  UT doors=1  10.81 km from the Tower
TCB  known=false  route=notfound  UT doors=1  11.32 km from the Tower
```

**Claim 1 — ten are ~11 km north at the Pickle Research Campus. TRUE.**
Measured from UT's own surveyed door for each code (the `UT_CELEBRATED` table in
`js/wayfind.js`) to UT's surveyed door for the Tower: 10.81 to 11.83 km. They are
correctly outside a main-campus walking router and the fix is not "route there".

**Claim 2 — "SSW is not in UT's own building register at all". FALSE.**
SSW is **0.90 km from the Tower**, on main campus, with **two** hand-surveyed
doors already sitting in this codebase's own UT table. `docs/import-bar-ut.md`
reached the same conclusion from three public sources; this is the independent
confirmation, off the app's own data rather than off the web.

**And a third fact neither the brief nor the recon doc had.** All eleven fail as
`notfound`, not `noroute`. The app's search index has never heard of these codes;
it is not that the router cannot reach them. That matters twice over:

* `docs/import-bar-ut.md` concluded SSW's unroutability was "something inside
  this app's own pavement/routing graph". It is not — it is upstream of the
  graph, in whatever builds the building register the search index is made from.
  A different, smaller fix. (Not this lane's file; written down, not made.)
* For the day plan it is the difference between three sentences and one. A
  student whose schedule says `BE1` needs *"BE1 is 11.8 km north of campus — off
  this map"*. A student whose schedule says `SSW` needs *"We've never heard of
  SSW"* — telling them "off the map" about a building they can see from the Tower
  would be a lie.

**How the row knows which.** Not from a list of eleven codes, which would go
stale the next time the graph is rebaked. `dayPlace()` measures: it takes UT's
own surveyed coordinate for the code and asks whether it lies inside the extent
of the graph we actually route on (`dayBounds()`, computed once off `G.X`/`G.Y`).
Outside → off this map, with the real distance and compass direction printed.
Inside, and still unroutable → we have never heard of it. In the register but
with no door or path → the existing "not walkable in this build yet" answer.

---

## The fixtures

Three, built into `js/wayfind.js` next to the renderer and reachable as
`window.wayfindDayFixture(name)` so the harness drives the same day the file
ships rather than carrying its own copy.

**`tth` — an ordinary Tuesday, 4 classes, 3 walks.** Every location string in it
is verbatim a real UT `LOCATION:` line quoted in `docs/import-bar-ut.md` from
UT-Registration-Plus's own test fixtures (`CMA 6.146`, `UTC 3.102`, `GSB 2.122`,
`DMC 3.208`), on UT's real TTh grid — 75-minute classes, 15 between. The format
being parsed is therefore a real one and not one invented here.

| leg | measured | into a gap of | the row says |
|---|---|---|---|
| CMA → UTC | 1.1 km, 13–18 min, 1 set of stairs | 15 min | Tight for this gap · 1 set of stairs, a step-free way is 29 m **shorter** |
| UTC → GSB | 43 m, under 1 min | 15 min | nothing |
| GSB → DMC | 1.2 km, 14–22 min, 4 signalised crossings | 15 min | Tight for this gap · Crosses 4 signalised crossings |

**`mwf` — a Monday on the other grid**, 50-minute classes, 10 between, and it
carries the one thing the brief named that the TTh day does not:

| leg | measured | into a gap of | the row says |
|---|---|---|---|
| WAG → FAC | 380 m, 4–6 min, 1 set of stairs | 10 min | **1 set of stairs · no way round it** |
| FAC → WEL | 340 m, 4–6 min, 3 sets of stairs | 10 min | 3 sets of stairs · a step-free way is 97 m further |
| WEL → ART | 640 m, 8–11 min, 3 sets of stairs | 10 min | Tight for this gap · 3 sets of stairs · a step-free way is 100 m **shorter** |

WAG → FAC is not a hand-picked example. It came out of a 435-pair sweep over
thirty plausible classroom buildings looking for a leg with mapped stairs on it
and **no step-free alternative at all** — it is the only one among those thirty
buildings, which is itself worth knowing.

This day is also where the gap bar earns its place: the first two walks fill
about half a 10-minute track and the third runs off the end of it, so which leg
has the problem is visible before a word is read.

**`gaps` — constructed, and it says so.** The `tth` day with two classes moved
onto `SSW` and `BE1`, the two codes the forcing function names, and one leg left
routable on purpose so the good rows and the bad rows can be seen in one list.

| leg | what it is | the row says |
|---|---|---|
| SSW → UTC | SSW is a real main-campus building this app has never heard of | *We can't take you from SSW* |
| UTC → GSB | 43 m | *Under 1 min · 43 m* |
| GSB → BE1 | BE1 is at the Pickle Research Campus | *We can't take you to BE1* |

Nobody's real Thursday looks like that; the renderer still has to survive it.
The **why** is printed once, on the class row for the building it is about —
photographed before that fix, *"BE1 is 11.8 km north of campus — off this map ·
This map is main campus only."* was on screen three times in a five-row panel,
because a building appears on one class row but on up to two walk rows either
side of it.

---

## What was checked, and how

`node scripts/verify/dayview.mjs 8914 --shots ../../shots/si/dayview`, against
`python scripts/serve.py 8914`. Real Chrome via `playwright-core`, `?drift=0`,
`window.cancelGraphicsAutoDetect()` cancelled at the top of every page, veil
waited out, screenshot twice and the second kept — the house rules in
`scripts/verify/README.md`.

1. **The day plan cannot disagree with the answer bar.** Every walk row's minutes
   and distance are read back **off the rendered DOM** and compared to what
   `wayfindRoute()` returns for the same two ends. Zero tolerance on minutes;
   `fmtDist`'s own rounding on distance. This is the gate that matters most: the
   "two surfaces, two claims" failure has already cost this repo two rounds (the
   stairs offer versus the stairs button; the ruler versus the router).
2. **Exactly one row is NEXT and it is the right one for the clock**, driven with
   `?dayat=HH:MM` so the picture is the same tomorrow.
3. **The chips are exactly the problems the router found** — no chip without a
   problem, no problem without a chip.
4. **The forcing function**, re-probed every run (above).
5. **Off stays off.** With no `?walk=1` there is no panel, no button, no injected
   stylesheet and no `window.wayfindDay` — the module still returns on its
   `ENABLED` line and this surface is behind it. With `?clip=1` (and therefore
   `?autopilot=1` and `?sliderdemo=1`, which set the same class) nothing this
   surface adds is visible, walked element by element rather than by naming two
   ids.
6. **The phone.** 390 × 844: the panel is on screen and uncut, the page does not
   scroll sideways, and every pressable walk row clears 44 px.
7. **§15**, grepped (above).

### The one place this surface writes CSS instead of asking

`style.css` belongs to another lane this round, and the recording gate lives in
it as:

```css
.clip #wf-button,.clip #wf-sheet,.clip #wf-pill{display:none!important}
```

with a comment claiming *"every element this feature has ever added is a CHILD of
one of these three, which is why the rule has not had to grow as the bar did"*.
That claim stops being true the moment this panel exists: `#wf-day` and
`#wf-day-btn` are children of `#wf-root` and of none of those three. So the gate
for them is injected from `DAY_CSS` in `js/wayfind.js`, one line, next to the
elements it covers, and verified by gate 5 above.

**The one-line consolidation, for whoever owns `style.css`:**

```css
.clip #wf-button,.clip #wf-sheet,.clip #wf-pill,.clip #wf-day,.clip #wf-day-btn{display:none!important}
```

Make that edit and the corresponding line in `DAY_CSS` becomes redundant (it is
harmless either way — it is the same declaration). Better still, the honest fix
is `.clip #wf-root{display:none!important}`, which cannot go stale the next time
somebody adds an element; that is a bigger change than a merge should carry, so
it is written down rather than made.

### The frames

Five, and every one of them is cited by a claim above (CLAUDE.md rule 12 — a
frame nothing references is 1.4 GB of multiplier waiting to happen, so nothing
else this round was committed; the working frames stayed in the scratchpad).

| frame | what it is evidence for |
|---|---|
| `shots/si/dayview/mwf-desktop.jpg` | the whole claim: three walks, three different states, and which one is next, read before a word |
| `shots/si/dayview/mwf-phone.jpg` | 390 × 844, two walk rows visible, every pressable row over 44 px |
| `shots/si/dayview/tth-desktop.jpg` | an ordinary Tuesday, with a picked leg driving the shipped answer bar above it |
| `shots/si/dayview/gaps-desktop.jpg` | the three unreachable sentences, the whole-day banner, and one good leg among them |
| `shots/si/dayview/clip-nothing.jpg` | `?clip=1`: nothing of this on the frame |

### What the harness does NOT prove

* It compares the day plan against **this app's own router**, not against
  Citymapper or Google. There is no outside oracle for "is 13–18 minutes right",
  and there is not one anywhere in this repo either.
* It reads the DOM. It does not sample pixels. Every frame above was opened and
  looked at by hand, and three of the fixes in this round came only from doing
  that (the tripled explanation, `0–1 min`, and the last class of the day sitting
  permanently one scroll below the fold) — none of them was red in any gate.

### The sibling check

Adding to a file four other lanes are inside is the failure this round was warned
about, so the diff was kept to a shape that cannot cause it: **1,025 lines added,
zero lines removed**, in one hunk near the end of the file, plus one appended
`dayBoot();` call on the last line. No existing function was edited.

And the routing was re-measured rather than assumed. `node
scripts/verify/walkmeter.mjs` against this branch's own served app:

```
20 pairs routed, 0 failed, self-check drift 0.00 m on every pair
route-length extra   87.0 m   (docs/walk-progress.md's current figure, unchanged)
door-offset extra    90.6 m   38 of 38 ends within 15 m of UT's own door
"avoid stairs" at the door   9/9 clean
LIVE UI GATE  the real mouse click on the checkbox still turns the routing on
              and back off, and the pill still toggles          PASS
```

Nothing in the router, the doors, the stairs or the lighting moved.

---

## Deliberately not done

* **No OCR and no Registration-Plus API client.** The brief said to shape for
  them and not build them. The shaping is the three provenance fields above.
* **No edits to any function another lane owns.** The day plan is one additive
  block near the end of `js/wayfind.js` plus one line at the very end calling
  `dayBoot()`. The way in is a row **appended to the search sheet at run time**
  rather than a line added inside `buildUI()` — four lanes are in that function
  this round and a DOM append cannot collide the way a source edit does.
* **`WAYFIND.on` is untouched.** Nothing here is on for anybody who has not
  asked for it by URL.
* **No stairs, lighting or door logic was reimplemented.** The stairs chip reads
  `route.stepFree`, which the stairs lane already computed on the same answer
  object; it does not re-route anything.

---

## Every taste value, in one place

`WF_DAY` at the top of section 10 of `js/wayfind.js` (CLAUDE.md rule 11). Nothing
below it invents a number, including the injected stylesheet, which is written
from those values rather than carrying a second copy of them.

| key | what it decides |
|---|---|
| `demoPlan` | which fixture `?walk=1&day=1` shows |
| `nextGraceMin` | how long a walk stays marked NEXT after its class has begun |
| `confidenceSure` | below this a parsed code is shown to be checked, not routed |
| `gapBar`, `gapBarH`, `gapBarR`, `gapBarMinPct`, `gapBarOverPct`, `gapBarMaxMin` | the bar |
| `warnOn` | the §15 ladder |
| `signalChipMin` | how many lights before the crossings are worth a row |
| `panelW`, `listMaxVh`, `railW`, `dotR` | layout |
| `clockFrom` | the clock, and `?dayat=HH:MM` freezes it |

---

## How to look at it yourself

```
python scripts/serve.py 8914
```

* `http://127.0.0.1:8914/index.html?walk=1&day=tth&dayat=10:50` — the ordinary day
* `...&day=mwf&dayat=09:55` — the stair-only leg
* `...&day=gaps&dayat=10:50` — the three unreachable sentences
* `...&day=tth&dayat=16:30` — after the last class
* or open the walk panel and press **Import my class schedule** at the foot of it
