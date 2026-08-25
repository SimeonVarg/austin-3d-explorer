# SI5, SI6 and the measurable half of SI4

Branch `acer/si-combined`. Follows the seam pass (`docs/si-seams.md`), which
closed SI1/SI2/SI3 and left these three. Gate: `scripts/verify/si-integration.mjs`
went **45/50 → 49/50**. The one still red is the taste half of SI4, which is
Simeon's call and is written up on its own in `docs/si-doors.md`.

## SI5 — one app, two answers about SSW

The import screen kept its own table of building codes it could not reach:
twelve rows, `IMP_UNREACHABLE`, ten Pickle campus codes plus `SSW` and `HLB`.
Every row of it was measured honestly against the live router on the day it was
written. That was never the problem.

The problem is that a measurement written down stops being a measurement. The
gaps lane then gave SSW its register entry and HLB its virtual door — both of
them route now, with two doors and one — and this screen went on refusing them,
because the answer had been remembered instead of asked for. On the merged tree
`wayfindSearch('SSW')` said routable and the import screen two taps away said
"no door", in the same app, at the same moment.

The table is gone. `impPlace()` now asks two live questions instead:

- `window.wayfindOffMap(code)` — a real UT building at a campus this app does not
  draw. Returns a record or null, and the record carries the building's own name,
  its campus, and how far and which way it is, all derived from UT's own survey.
- `window.wayfindSearch(code)` — everything on this map, routable or not.

Neither can go stale, because neither is a copy: both **are** the router.

Two things came free. The distance sentence is now built from the same record
the day view measures from, so the two surfaces cannot drift apart — the screen
says "about 11 km north of here" because the record says 11.09, not because
someone typed 11. And the building's name comes from the same place as the
distance, so a student reading `MER 1.906 · Microelectronics & Engineering
Research Center — J.J. Pickle Research Campus` can check it against their own
registration page.

**The count, from the shipped instrument** (`scripts/verify/schedule-fixtures/gaps-recheck.mjs`,
which asks the running app rather than a list):

```
UT survey: 97 doors on 67 buildings
the index flags 10 of them unroutable — now actually try each:
OFF THIS MAP (Pickle Research Campus) — correctly unroutable:
  BE1 BEG EME FS1 FSL MER PX3 ROC SV1 TCB
ON THE MAIN CAMPUS and still unroutable — these are real gaps:  (none)
FLAGGED UNROUTABLE BY THE INDEX AND ROUTES ANYWAY:              (none)
```

**Ten, not eleven, and all ten are Pickle.** `walkmeter.mjs` reports the same
ten independently.

## SI6 — the day view gave a Pickle building the wrong reason

`dayPlace()` tested `entry.routable`, then fell through to `nodoor`, before it
ever reached its own off-map branch. The gaps lane had added the ten Pickle codes
to the search index as entries carrying an `offMap` record; they have no doors,
so `routable` was false, so every one of them was answered

> No door or path for MER · It is in the building list, but nothing is mapped to
> walk to.

which is true of a building 400 m away whose door nobody has surveyed, and a lie
about one eleven kilometres north. Meanwhile the import screen, two taps away,
said "about 11 km north of here".

**It really was one line.** The `nodoor` clause now reads
`if (entry && !entry.offMap)`; an off-map entry falls through to the branch that
was already there, already correct, and already measures the distance itself.
The row now reads

> MER is 11.1 km north of campus — off this map · This map is main campus only.

**One thing that changed with it, said out loud rather than buried.** The day
view prints no building-name line for an off-map class — that is the day-view
lane's own design (its name fallback deliberately skips `offmap` and `unknown`),
so MER's row lost the words "Microelectronics & Engineering Research Center" when
it stopped being called `nodoor`. The row still names the code, the distance, the
direction and the reason, and the import screen names the building in full. I
left the day view's rule alone rather than reach into another lane's rendering
decision on the back of a one-line fix, but it is worth a look: the name is
sitting right there in `entry.display` now.

## SI4 — the phone fold, measurable half

On a 390x844 phone the panel was 337 px tall around 494 px of content, clipped
with `overflow-y: hidden`. **157 px were unreachable, and in them were the
privacy promise, the Delete button and the OpenStreetMap credit.** A student
could not tap the control that deletes their class schedule. That is the promise
the feature makes, so it is a defect and not a matter of taste.

Two changes, both in `style.css`, both inside the existing phone rule.

**The ceiling.** `62vh` was measured when this panel held 279 px — a head, two
fields, the examples and a two-line footer. The schedule round appended three
more rows and the content went to 494. The ceiling is now `84vh`, expressed as
`--wf-sheet-vh` so it is one line to move. 84 is not a new number: it is exactly
what `#wf-imp` already uses, and the two panels swap places on a tap, so having
them differ would be a jump on the frame. The reasoning under that number holds
unchanged — the top edge must not rise above about y120, where the flag button
and the right-hand column stack. The bottom edge does not move at all, so the
rule that the panel stops above the joystick is untouched.

**And it scrolls.** `overflow-y: auto`, with the close button made sticky so the
way out can never scroll off. This is the part that cannot go stale: a taller
ceiling fixes today's phone, and a shorter one (a 667 px handset puts the ceiling
at 374) or the next row somebody appends would put the same controls back out of
reach. The result list is still the child that gives up height first, so the
scroller only ever engages once even the fixed rows will not fit.

**What it measures now**, on the real page at 390x844
(`scripts/verify/si-fold-shots.mjs`, screenshot twice and keep the second):

- **Nothing imported yet:** panel 496 px around 494 px of content. Everything on
  screen, nothing scrolls. This is the state the gate checks, and it passes.
- **A real import, then a reload** — the state a student comes back to, and the
  one where Delete matters: content 548 px against 523 px of phone. The privacy
  line and the Delete button are both on screen at rest; the map credit sits
  16 px below the edge and takes a 27 px swipe.

**548 does not fit and no ceiling makes it fit.** Between the buttons above and
the drive controls below there are about 523 px on this phone, and 100vh minus
both clearances is 538. So the honest claim is *reachable*, not *all on one
frame*, and both states are printed by the script rather than asserted. The
frame is `shots/si/fold/sheet-phone-fixed.jpg`, taken after that swipe, with all
three visible together.

The thing that would actually close the last 25 px is one door instead of two —
worth 66 px, which turns "swipe for the credit" into "everything fits". That is
the taste call, and it is in `docs/si-doors.md` with a picture.

## What was left alone

`WAYFIND.on` is still `false`. The parser/day-view/store seam was not touched.
`walkmeter.mjs` reproduces 87.0 m over the pairs it makes worse, −393.7 m signed,
38 of 38 ends at UT's own door, drift 0.00 m, 0 route errors, live UI gate PASS.
`harness-drift` PASS. `dayview.mjs` is 100 ok / 2 failed — byte-identical to its
baseline on this tree, both failures being the merge's own (the gaps lane made
SSW routable, so "all eleven are still unroutable" reads 10/11).
