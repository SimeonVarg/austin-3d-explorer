# The walk interface — round 1

Lane `acer/w-ui`, 2026-08-23. Owns `index.html`, `_harness.html`, `style.css`,
the UI/render half of `js/wayfind.js`, `shots/walk/ui/` and this file.
Nothing else in the repo was touched. `index.html` and `_harness.html` did not
need an edit — no script was added — and `harness-drift.mjs` is quoted below.

Everything here was **photographed at 390 x 844 before and after**, which is how
the first item was found at all. Shots are in `shots/walk/ui/`.

---

## 0. The defect that was already shipped, and nobody could have seen it in a diff

`style.css` had a stray comment terminator in the middle of the QUEUE Z7 note
above the phone rule for `#wf-pill`: the comment closed, four more lines of
English ran on, and the comment closed a second time. CSS cannot read that as a
comment. The second half became a **selector prelude**, the prelude ran on into
`#wf-pill{...}`, and an invalid selector drops the whole rule.

So the fix Z7 shipped — the answer bar pinned to both edges, dropped below the
top buttons — **was not in effect on any phone**. The bar fell back to the
desktop `left:50%`, which on a 390 px screen can never exceed 195 px however
generous its `max-width` is, because `left:50%` makes the shrink-to-fit
available width `100% - 50%`. That is precisely the 197 px column Z7 was written
to kill, and it had been silently un-killed for however long the comment had
been there.

Photographed before the fix, at 390 x 844:

* the headline wrapped to two lines (`6-8 min walk · 530 m · No` / `stairs on
  this route`);
* `Show route ⤡` wrapped **inside its own button**;
* the bar sat at `top:16px`, on the same row as `#wf-button`, `#gfx-button` and
  `#fb-button`, overlapping all three.

The two halves of the Z7 note are now one comment, and the rule below it parses.
A brace/comment balance check over the whole file reports depth 0, zero stray
terminators.

**Nothing else in this pass would have been visible while that rule was dead**,
so it had to be first.

---

## 1. What the answer bar is now

One bar, in the row below the top buttons, holding — in this order:

```
FROM  Beauford H. Jester Center                                  ⌄
6-8  min walk  ·  530 m  ·  No stairs on this route
▌━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◎
Robert A. Welch Hall · Entrances are on this side
[ Longer than a 15-minute passing period ]        (only when it applies)
```

Four things are new.

**(a) The minutes are 25 px and nothing else is.** The old bar set the whole
sentence as one 12 px run, centred. The one number a student reads at a glance
now looks like the one number a student reads at a glance, and the rest of the
sentence is unchanged text at 12.5 px.

**(b) The origin is on screen.** With an empty From, the app picks the routable
building nearest the **camera** (QUEUE Z2) — a guess it makes on your behalf —
and it never said which one it picked. A router that hides its own assumed
origin is the "wrong building, beautifully drawn" failure with an extra step.

**(c) The strip: where the things on this route actually are.** A flat rail with
a pip at every mapped staircase and every signalised crossing, at its true
fraction of the route, plus a start tick and a destination ring. It turns two
counts the bar already prints (`Stairs: 3 sets`, `Crosses 2 signalised
crossings`) into **where**, which is the part a student plans around.

*It is not an elevation profile and must never become one* — §12 of
`what-we-can-honestly-say.md` forbids the whole hill family and there is no
elevation source in this repo. The rail is dead flat by construction.

Two things the strip had to learn the hard way, both caught by reading the DOM
rather than the picture:

* **Merged pips carry their count.** A divided road tags both carriageways, so
  `JES → ANB` counts 4 signalised crossings that fall at two places. Drawn as
  four dots they are two smears; drawn as two dots the strip contradicts the
  card. They are now two **capsules**, widened by the count and labelled `3
  signalised crossings` / `A signalised crossing` — so the number of things on
  the strip equals the number in the card, always. Verified across 14 routes.
* **The end marks are outside the rail.** A staircase 20 m from the door is at
  97 % of a 660 m route (`WEL → DKR` really is), and inside the rail it was
  drawn underneath the destination ring — the one mark a student most needs to
  see, hidden by the mark it is nearest to.

**(d) There is an affordance.** The card used to be behind a tap on an element
with nothing on it to tap. There is a chevron and it turns. Tapping the card
itself no longer closes it, either — reading the accessibility disclaimer and
having the panel shut under your thumb is the kind of thing nobody reports and
everybody notices.

---

## 2. The during-walk view, which is the thing a maps app cannot do

When the **view** is on the route — within `liveOnRouteM` 45 m of the drawn line
and below `liveAltMaxM` 90 m of altitude — the bar changes:

```
 ↑    4–6 min walk  REMAINING                                    ⌄
      340 m to the next turn · 370 m
      6-8 min walk · 530 m · No stairs on this route      (demoted, dim)
▌━━━━━━━━━━━●─────────────────────────────────────────◎
Robert A. Welch Hall · Entrances are on this side
```

* The **arrow** is screen-relative: the bearing from the view to the next vertex
  where the route turns more than `WAYFIND.turnMinDeg`, minus where the view is
  pointing. Straight ahead is straight up. It names no street, because the graph
  carries no street names.
* **What is left is measured, not scaled.** Every segment ahead of the
  projection contributes its own length to flat or to stair, and the staircases
  and crossings ahead are counted rather than prorated; the result goes through
  the same `timeRange()`, the same constants and the same outward rounding as
  the whole-route figure above it.
* The whole-journey figures **demote rather than disappear** — you still want to
  know what the whole walk was while you are halfway through it.
* The **progress fill and a "you" dot** run along the strip, and pips you have
  already passed dim.

**It costs nothing at rest.** This is a `move` handler on the map, not a loop: a
parked camera does nothing, a hidden tab does nothing, and clearing the route
unhooks it. While the camera is moving it does one projection and one
`textContent` write, capped at `liveHz` 6 a second. (`moveend` deliberately
bypasses the throttle — through it, a jump shorter than one tick dropped the
frame the camera actually stopped on, and left the readout stale at exactly the
moment somebody stops to read it.)

Photographed from a pose found with `__walker.findStart`, which refuses any
point with a roof over it, and with the altitude and roof clearance read back
and printed with the frame:

| shot | pose | readout |
|---|---|---|
| `during-walk.png` | alt 3.01 m, `roofAt` 0, bearing 5.3° | `4–6 min walk remaining · 340 m to the next turn · 370 m`, fill 30.1 % |
| `during-walk-2.png` | alt 3.01 m, `roofAt` 0, bearing 93.8° | `6–8 min walk remaining · 290 m to the next turn · 510 m`, fill 49.5 % |

*(The first two candidate poses were thrown away: one put the camera under a
canopy near 21 Rio with `roofAt` reading 0 and a frame full of ceiling. The house
rule earned itself again — the number said clear and the picture said buried.)*

---

## 3. The question, at thumb size

* **Result rows are `--touch-min` tall on a phone.** They were 34 px, under the
  size this stylesheet's own variable calls "the smallest target a thumb reliably
  hits", on the one control in the feature you have to hit correctly to avoid
  being routed to the wrong building. The list is the flex child that yields, so
  the taller rows cost the sheet no height — they scroll.
* **The row Enter will take is drawn.** `Enter` committed "the first routable
  match", which is correct and completely invisible. There is now a highlighted
  row, arrow keys move it, and Enter takes it.
* **A first-run state**, which `interface.md` listed as undesigned: a `TRY` row
  of four codes you can tap, gone the moment a character is typed. The hint line
  no longer repeats them, so it is just the as-of date.
* **A swap button** on the seam between the two rows.
* **A clear × per field**, and the field only gives up the 19 px it needs while
  there is a value to clear — reserving it always cost 19 px at exactly the
  moment the field is empty and showing its placeholder, which is how `Building
  code, name or number` came to render as `…name or num`. Measured after the
  fix: placeholder 167.1 px into 195 px of room.
* **On a failure both ends stay on screen.** The headline names whichever end we
  cannot route, and with only the destination under it the bar read `FC1 is not
  walkable in this build yet` over `Robert A. Welch Hall` — which says, to any
  reader, that Welch is the building we do not have.

---

## 4. The strings did not move, and nothing that reads this UI had to change

`#wf-headline`, `#wf-sub` and `#wf-verdict` still exist, still hold exactly the
sentences §11 permits, and `.textContent` on each returns the same string it
returned before this pass — the typography is **spans inside them**, so
`wayfindRoute()`'s return value is byte-identical.

```
before  "6-8 min walk · 530 m · No stairs on this route"
after   "6-8 min walk · 530 m · No stairs on this route"
```

### New readable strings, for the honesty lane to audit

They are in one block, `SAY_UI`, next to `SAY`. Every one is a **label** — a
word naming a control or a part of the picture — and none asserts anything that
could be true or false about the world. The two that come closest, and the
reasoning, are written into the file itself:

* `remaining` — the route's own length minus how far along it the **camera** is.
  A measurement of the drawn line and of the view, both of which we have
  exactly. It says nothing about where the *person* is standing (§12's
  `You are here`), and the minutes beside it are the same range arithmetic over
  the same permitted wording, run on the part of the route that is left.
* `to the next turn` — a distance along the drawn line to the next vertex where
  the bearing changes by more than `WAYFIND.turnMinDeg`. Names no street, gives
  no instruction the ribbon on the ground does not already give.

The rest: `min walk`, `to the end of the route`, `You are at the end of the drawn
route`, `A staircase OpenStreetMap has mapped`, `A signalised crossing`, `N
staircases OpenStreetMap has mapped`, `N signalised crossings`, `The stop on the
way`, `Start of the route`, `Details`, `Hide details`, `Swap the two ends`,
`Clear this field`, `Try`. Most are `title`/`aria-label` only.

---

## 5. Taste values (CLAUDE.md rule 11)

Two blocks, both named, both one line per judgement.

**Numbers** — `WF_UI` in `js/wayfind.js`, a *separate* object from `WAYFIND` on
purpose: four lanes are editing this file at once and `WAYFIND` is the object all
four want to append to.

```
liveOnRouteM 45   liveAltMaxM 90   liveHz 6      liveMinMoveM 1.0
arriveM 15        turnAheadMinM 8  pipMergeT 0.018  stripMinPipT 0.01
exampleCodes ['WEL','PCL','GDC','JES']
```

**Sizes and colours** — custom properties on `#wf-root` in `style.css`:
`--wf-big --wf-unit --wf-fact --wf-line --wf-small --wf-ink --wf-dim
--wf-dimmer --wf-accent --wf-glass --wf-glass-solid --wf-edge --wf-edge-soft
--wf-hot --wf-shadow --wf-radius --wf-pad --wf-rail-h --wf-cap-in --wf-rail
--wf-fill --wf-pip-stairs --wf-pip-signal --wf-pip-via --wf-you --wf-arrow
--wf-btn-row`. The phone block overrides `--wf-big` and `--wf-arrow` and nothing
else.

---

## 6. What was verified, and how

```
node scripts/verify/harness-drift.mjs
  index.html:    31 scripts
  _harness.html: 31 scripts
  PASS  the harness loads the same city the site does
```

Gates, driven on the real page at 390 x 844 (`?drift=0`, auto-detect cancelled,
waited on `!#veil`, one browser, port 8715):

```
 PASS OFF: no walk parameter adds no element                       elements=0
 PASS VETO: ?walk=0 beats from/to                                  elements=0
 PASS CAPTURE ?clip=1: nothing of the feature is on the frame      visible=0
 PASS CAPTURE ?autopilot=1: nothing of the feature is on the frame visible=0
 PASS CAPTURE ?sliderdemo=1: nothing of the feature is on the      visible=0
 PASS API: headline is the permitted sentence, unchanged
 PASS API: sub is destination + door phrase
 PASS FAIL: an unroutable code gets a readable bar and no strip
 PASS LIVE: the walking readout is off when the view is not on the route
```

The capture gate walks **every descendant of `#wf-root`** and counts anything
with a box, not just the three ids the `.clip` rule names — every element this
feature has ever added is a child of one of those three, which is why the rule
has not had to grow as the bar did, and the gate is what proves it rather than
the reading of it. All three surfaces were also photographed
(`capture-clip.png`, `capture-autopilot.png`, `capture-sliderdemo.png`) and there
is nothing on any of them but the city and the OpenStreetMap credit.

Pip/card agreement was checked across 14 routes; the counts on the strip match
the counts in the card on every one.

### Shots

`shots/walk/ui/` — `search-empty`, `search-typed`, `search-not-walkable`,
`pre-summary`, `pre-summary-long`, `pre-summary-night`, `pre-details`,
`pre-details-coffee`, `answer-not-walkable`, `during-walk`, `during-walk-2`,
`capture-clip`, `capture-autopilot`, `capture-sliderdemo`, `desktop`.
All phone shots are 390 x 844 at 2x except `desktop`, which is 1440 x 900.

---

## 7. Two things I did not do, and one that is not mine

* **No `Walk it` button.** A one-tap "put me at street level at the start,
  facing the first leg" is the obvious next move and is exactly what this app has
  that Citymapper does not — but placing a camera at eye level without a
  clearance search is how a pose ends up inside a wall, and the camera is not
  this lane's to own beyond the existing `Show route`. Proposed for round 2:
  reuse `__walker.findStart`'s ring search (`clearR` 6 m) around the origin door,
  then `placeEye(lng, lat, 1.7, bearingOfFirstLeg, 80)`, behind an explicit tap
  only, never on load.
* **No turn-by-turn list.** The graph carries no street names, so every line of
  it would have to be `In 120 m, turn left` with nothing to turn onto. The strip
  and the arrow are what the data can actually back.
* **The magenta sky in the two walk shots is not mine, and I checked rather than
  assumed.** At walking height the default time of day renders a hard magenta
  sky with olive-tinted foliage, which looks alarming behind the bar. Loaded the
  same eye-level pose on the South Mall with **no walk parameter at all** — so
  `js/wayfind.js` returns on line one and adds nothing — and the frame is tinted
  identically (`scratchpad/sky-feature-off.png`, alt 3.01 m, `roofAt` 0, zero
  `wf-*` elements on the page). Whatever it is, this pass did not cause it and it
  is not in the interface's own colours.

**No other lane needs to change anything for this pass.** Nothing here required a
schema change, a new constant in `WAYFIND`, or an edit outside the functions this
lane owns.
