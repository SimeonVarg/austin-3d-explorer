# The walk interface — rounds 1 and 2

Lane `acer/w-ui`. Owns `index.html`, `_harness.html`, `style.css`, the UI/render
half of `js/wayfind.js`, `shots/walk/ui/` and this file. Nothing else in the repo
was touched. No `<script>` was added, so `index.html` and `_harness.html` needed
no edit; `harness-drift.mjs` is quoted below anyway.

Everything here was **photographed at 390 x 844, before and after**. Round 2's
section starts at §8; §0–§7 are round 1 and are unchanged.

---

## 0. The defect that was already shipped, and nobody could have seen it in a diff

`style.css` had a stray comment terminator in the middle of the QUEUE Z7 note
above the phone rule for `#wf-pill`: the comment closed, four more lines of
English ran on, and the comment closed a second time. CSS cannot read that as a
comment. The second half became a **selector prelude**, the prelude ran on into
`#wf-pill{...}`, and an invalid selector drops the whole rule.

So the fix Z7 shipped — the answer bar pinned to both edges, dropped below the
top buttons — **was not in effect on any phone**. The bar fell back to the
desktop `left:50%`, which on a 393 px screen can never exceed 195 px however
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
▌ FROM  Beauford H. Jester Center                                 ⌄
6-8  min walk  ·  530 m  ·  No stairs on this route
▌━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◎
● 2 signalised crossings                                    (round 2, §9)
◎ Robert A. Welch Hall · ▯ Entrances are on this side
[ Longer than a 15-minute passing period ]        (only when it applies)
[   ⛶ Show route   ]  [ Clear ]                             (round 2, §10)
```

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
and below `liveAltMaxM` 90 m of altitude — the bar changes. Round 2 rewrote what
it says; see §8. The mechanism is unchanged:

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
  of four codes you can tap, gone the moment a character is typed.
* **A swap button** on the seam between the two rows.
* **A clear × per field**, and the field only gives up the 19 px it needs while
  there is a value to clear.
* **On a failure both ends stay on screen.** The headline names whichever end we
  cannot route, and with only the destination under it the bar read `FC1 is not
  walkable in this build yet` over `Robert A. Welch Hall` — which says, to any
  reader, that Welch is the building we do not have.

---

## 4. The strings did not move

`#wf-headline`, `#wf-sub` and `#wf-verdict` still exist, still hold exactly the
sentences §11 permits, and `.textContent` on each returns the same string it
returned before either pass — the typography is **spans inside them**, so
`wayfindRoute()`'s return value is byte-identical.

```
before  "6-8 min walk · 530 m · No stairs on this route"
after   "6-8 min walk · 530 m · No stairs on this route"
```

Round 2 adds two more spans that are invisible and change no string: the stairs
swatch inside `.wf-cond` (an empty `<span>`), and the middot before the door
phrase, which is now visually hidden rather than deleted **precisely so that
`#wf-sub`.textContent does not move**.

New readable strings live in one block, `SAY_UI`, next to `SAY`. Every one is a
**label** — a word naming a control or a part of the picture — and none asserts
anything that could be true or false about the world. The four that come closest,
and the reasoning, are written into the file itself: `remaining`, `to the next
turn`, and (round 2) `then left` / `then right`. See §8.

---

## 5. Taste values (CLAUDE.md rule 11)

**Numbers** — `WF_UI` in `js/wayfind.js`, a *separate* object from `WAYFIND` on
purpose: four lanes are editing this file at once and `WAYFIND` is the object all
four want to append to.

```
liveOnRouteM 45   liveAltMaxM 90   liveHz 6      liveMinMoveM 1.0
arriveM 15        turnAheadMinM 8  pipMergeT 0.018  stripMinPipT 0.01
keyOn true        turnSharpDeg 100                          (round 2)
exampleCodes ['WEL','PCL','GDC','JES']
```

**Sizes and colours** — custom properties on `#wf-root` in `style.css`:
`--wf-big --wf-unit --wf-fact --wf-line --wf-small --wf-ink --wf-dim
--wf-dimmer --wf-accent --wf-glass --wf-glass-solid --wf-edge --wf-edge-soft
--wf-hot --wf-shadow --wf-radius --wf-pad --wf-rail-h --wf-cap-in --wf-rail
--wf-fill --wf-pip-stairs --wf-pip-signal --wf-pip-via --wf-you --wf-arrow
--wf-btn-row`, plus round 2's `--wf-key --wf-key-gap --wf-mk-col --wf-mk-w
--wf-then`. The phone block overrides `--wf-big`, `--wf-arrow`, `--wf-then` and
`--wf-key-gap` and nothing else.

---

## 6. What was verified, and how

```
node scripts/verify/harness-drift.mjs
  index.html:    31 scripts
  _harness.html: 31 scripts
  PASS  the harness loads the same city the site does
```

Gates driven on the real page at 390 x 844 (`?drift=0`, auto-detect cancelled,
waited on `!#veil`, one browser, port 8715) — round 2's numbers in §12.

---

## 7. Round 1's open items

* **No `Walk it` button.** Placing a camera at eye level without a clearance
  search is how a pose ends up inside a wall, and the camera is not this lane's
  to own beyond the existing `Show route`. Still true in round 2; the same
  proposal stands (reuse `__walker.findStart`'s ring search around the origin
  door, then `placeEye(lng, lat, 1.7, bearingOfFirstLeg, 80)`, behind a tap).
* **No turn-by-turn list.** The graph carries no street names.
* **The magenta sky in the walk shots is not ours** — reproduced with no walk
  parameter at all, so `js/wayfind.js` returns on line one and adds nothing, and
  the frame is tinted identically. (Round 2's walk shots do not show it; they are
  taken at `applyTimeOfDay(map, 0.32)`.)

---
---

# ROUND 2

Same lane, same day, `acer/w-ui` continued. Round 1 made the bar legible on a
phone. Round 2 is about the two things it is judged on side by side with
Citymapper's walking directions: **the pre-walk summary** and **the during-walk
view**. Six changes, every one of them from looking at a 390 x 844 frame.

## 8. The during-walk readout said a turn was coming and would not say which way

This is the biggest one and it was a contradiction on the frame, not a gap.

**Before**, at a real walking pose (alt 2.4 m, on the ribbon):

```
 ↗    4–6 min walk REMAINING
      340 m to the next turn · 370 m
```


The disc held an arrow rotated to the **bearing from the view to the turn
vertex**. So on `21 Rio → WEL` the frame carried an arrow pointing up and to the
**right** — correct, the turn was over there — while the route at that turn goes
**left**. Two true facts about one turn, and a 44 px glyph only gets to say one.
Photographed; that is how it was found.

**After:**

```
 ↰    13 m , then left
      7–11 min walk REMAINING · 620 m
```

Three changes, in order of how much they matter:

1. **The disc shows the MANOEUVRE.** A shaft coming up from the bottom and
   hooking the way the route goes; straight for the last leg. Where the turn *is*
   you can already see — it is painted on the floor in front of you. Which way it
   *goes* is the thing the ribbon cannot tell you until you are standing on it.
2. **The distance to the turn is the big number, and the words say the turn.**
   `nextTurnFrom()` computed the bearing change and then took `Math.abs` two
   lines before it returned, so the sign the whole question turns on was
   discarded. It is signed now, negative left, and `turnWord()` maps it to one of
   four labels with `turnSharpDeg` 100 as the only threshold.
3. **The journey figures move down one line** and the remaining distance joins
   them, so the top line is only ever *the next thing that happens*.

**On the wording.** `then left` is a description of a line already painted on the
ground, not an instruction — which is why it is `340 m, then left` and never
`turn left`. It names no street, because the graph has none. It is in `SAY_UI`
with that reasoning beside it, for the honesty lane to audit.

**And it made the readout cheaper.** The old sample gate re-rendered whenever the
view turned more than 4°, because the arrow had to follow the bearing. Nothing
on the readout depends on where the view points any more, so that clause is
gone: **swiping to look — the most common gesture there is on a phone — now
costs zero DOM writes.** Only moving along the route writes.

Measured on the shipped build, both poses at alt 2.41 m with the ribbon under
**5 of 5** sample points down the middle of the lower half of the frame:

| | `21 Rio → WEL` | `JES → DKR` |
|---|---|---|
| top line | `13 m , then left` | `24 m , then left` |
| second line | `7–11 min walk REMAINING · 620 m` | `3–5 min walk REMAINING · 270 m` |
| bar height while walking | 225.7 px of 844 | 196.7 px of 844 |
| horizontal overflow | none | none |

(The taller one carries a crossings count and a passing-period warning that the
shorter one has nothing to say about; the bar is only ever as tall as it has
facts.) I did **not** measure round 1's bar height on these two routes before
changing it, so there is no honest before-number to put beside these — what
changed is on the frame and in the two rows above, not in a delta I can quote.

**How the pose was proved, because this is where a round gets voided.** The
first two candidate poses were thrown away by the script itself, not by me: it
tries a list of fractions along the route and rejects any where
`__walker.clearAhead` reports under 20 m of clear ground on the heading, then
rejects any where `queryRenderedFeatures` finds the `wayfind-ribbon` layer under
fewer than 3 of 5 points down the lower half of the screen. `during-walk` was
rejected at 0.30 ("wall at 16 m") and 0.40 ("wall at 10 m") before 0.22 passed;
`during-walk-2` was rejected at 0.30, 0.40 and 0.22 ("ribbon hits 0") before 0.50
passed. Round 1's own second shot, kept in the repo, is a camera facing a blank
wall with the route nowhere on the frame — it read fine by the numbers.

## 9. The strip's marks meant nothing on a phone

Three colours of pip on the rail, and the only thing anywhere that said what a
colour meant was a `title` attribute. **`title` does not exist on a phone**, and
the phone is the device this bar is judged at. So the picture was asserting
something the reader had no way to decode, which is worse than not drawing it.

Two fixes that between them cost one row, and often none:

* **The stairs swatch is inline in the sentence that already names it.** The
  headline says `Stairs: 3 sets`; the pip's own class now draws a swatch in front
  of that phrase. Printing the same string twice, forty pixels apart, to
  introduce a colour would have been worse than either.
* **`#wf-key` carries only what the bar has not said yet** — the crossings count
  and, when there is one, the stop on the way. It is absent entirely on a route
  with no marks, which is most short routes, and it is hidden while you are
  walking (you read it once, standing still).

The counts come off `r.m.stairSets` and `r.m.signals` — the **same object** the
card's sentences are built from — so the key, the card and the headline cannot
drift apart.

**And it exposed a colour collision the rail alone never had to answer for.**
`--wf-pip-signal` was `#9ed3ff` and `--wf-pip-via` was `#8fd3ff`: six units apart
on one channel. On the rail they are never adjacent. In the key they are two
rows apart, and `2 signalised crossings` and `Starbucks` sat behind two dots no
eye can separate. The stop is now `#8fe6bd`.

> **Request to whoever owns the shared taste block:** `WAYFIND.viaRingCol` still
> paints the stop's ring **on the ground** in the old `#8fd3ff`, and it should
> follow to `#8fe6bd`. That constant lives in `WAYFIND`, which four lanes are
> appending to this round, so it is written here rather than edited from this
> lane. One line: `viaRingCol: '#8fe6bd'`.

Also raised `--wf-cap-in` from 9 px to 14 px. A staircase 20 m from the door
clamps to `stripMinPipT` at the rail's right end, and at 9 px the destination
ring began within a pixel of it — the two read as one smear at exactly the end of
the walk. Photographed before and after.

## 10. The answer had no way to show you what it was describing

`WAYFIND.fit*` is deliberate and right: **the camera never moves on its own.**
The consequence nobody had looked at is that unless the answer arrived with
`?fit=1`, the route the bar is describing can be entirely off screen — and the
only control that framed it was `Show route`, **inside the card, behind the
chevron.** An answer whose subject is not on screen, and whose "show me" is not
on screen either, is not an answer.

So `Show route` and `Clear` moved **out of the card and into the closed bar**, as
one row at `--touch-min` height: `Show route` wide (270 px on a phone), `Clear`
narrow (62 px), because one of them is what you came for and the other is how you
leave. There is now exactly one copy of each.

Three states it has to get right, all photographed:

* **routed** — both, `Show route` primary.
* **walking it** — `Show route` goes (framing it from above is not what you want
  while standing on it) and `Clear` tucks into the bottom-right corner, where a
  dismiss lives.
* **failed** — `Show route` goes, because a button offering to frame the route
  directly under `FC1 is not walkable in this build yet` is offering the thing
  the line above it just said we do not have. Hiding the whole row, which is what
  I did first, went too far: the chevron is hidden on a failure too, so the bar
  had **no control on it at all** and the only way out was to find the button in
  the opposite corner and reopen the sheet. `Clear` stays, alone.

**The card was reordered around it.** The three stop chips were the *last* thing
in it, under two paragraphs of accessibility disclaimer — so the two things you
can actually do to a route (put a stop on it, take the stairs off it) sat either
side of the longest run of grey text in the feature. Photographed at 390 x 844
with a via note and an hours line present, the chips landed 500 px below the top
of the bar and off the bottom of the phone. Order is now: route facts → chips →
`Avoid stairs` and its two disclaimers → footer, with the actions above all of it
in the bar.

## 11. A bar-aware fit, measured and then NOT shipped

The obvious next thought: `fitTo` pads the bounds with one number on all four
sides, and the top of a phone frame is not empty — the bar is sitting in 172 to
220 px of it. So the fit grew a bar-aware top padding. Then the claim was
measured rather than believed — every vertex of the drawn path projected to
screen after a real `Show route`, counted against the bar's own measured bottom
edge, on three routes at 390 x 844:

| padding | JES→WEL (30 pts) | 21 Rio→WEL (66) | JES→ANB (86) |
|---|---|---|---|
| uniform 90 | 100 % | 100 % | 100 % |
| 90 + the bar on top | 100 % | 100 % | 100 % |
| 90 + the bar at the bottom | 100 % | 59 % | 45 % |

A fit at `fitPitch` 55 already lands the whole route in the lower half of the
frame: MapLibre solves `cameraForBounds` unpitched and applies the pitch
afterwards, so the tilt carries the content down the screen on its own. The
bar-aware version was three functions and a clamp **that moved no pixel**, and
the mirror-image "pad the bottom instead" — which reads just as plausible — is
the one that would have broken it, on the two longest routes.

**Reverted.** The padding is one number and the finding is a comment above
`fitTo` so the next person to have the idea does not spend the round on it.

*(This also caught a flaw in how these shots were being taken. `?fit=1` waits for
the intro flight to finish, ~10–18 s, and the shots were being taken 2.6 s after
the bar appeared — so every "fitted route" frame in round 1 is actually the
intro's end pose. Round 2's shots load `?intro=0` and wait for
`!isMoving() && !isEasing()`, so the frame is the fit.)*

## 12. Two smaller things, and the gates

**The bar is not a button any more, and it could not be.** `#wf-pill` carried
`role="button"` and `tabIndex=0` while containing `Show route`, `Clear`, a
checkbox and three chips — a control with controls inside it, which no assistive
technology can present, and which put every one of those on the wrong side of one
focus stop. The **chevron** is the button now: a real `<button>` with
`aria-expanded`, `aria-controls="wf-card"`, a focus ring and a `--touch-min` hit
area grown with a pseudo-element so the visible disc stays 28 px. Tapping the bar
still toggles, as a pointer convenience on top of a keyboard control that exists.

**The door phrase looks like the answer it is.** `Entrances are on this side` is
the single thing this app tells you that a maps app does not, and it was running
on as the tail of a sentence in the dimmest colour on the bar. It has a doorway
glyph now — a doorway, not a map pin, because a pin is the glyph every row of
every other app already uses — and one step up in weight. The destination line
and the origin line also carry the **same two marks as the rail's two ends**, a
flat tick and a ring, on a shared `--wf-mk-w` gutter: the rail between two named
places stops reading as a slider, which is what `style.css`'s own comment says
the first cut of it read as.

### Gates, at 390 x 844, one browser, port 8715, `?drift=0`, auto-detect cancelled, waited on `!#veil`

```
 PASS OFF: no walk parameter adds no element                        elements=0
 PASS VETO: ?walk=0 beats from/to                                   elements=0
 PASS CAPTURE ?clip=1:       nothing of the feature is on the frame  visible=0
 PASS CAPTURE ?autopilot=1:  nothing of the feature is on the frame  visible=0
 PASS CAPTURE ?sliderdemo=1: nothing of the feature is on the frame  visible=0
 PASS API: #wf-headline is the permitted sentence, unchanged
 PASS API: #wf-sub is destination + door phrase, unchanged
 PASS FAIL: FC1 gets a readable bar, no strip, no key, no Show route, a Clear
 PASS LIVE: the walking readout is off when the view is not on the route
 PASS no horizontal overflow in any state at 390 px
```

The capture gate walks **every descendant of `#wf-root`** and counts anything
with a box — not just the three ids the `.clip` rule names. Every element this
feature has added, in both rounds, is a child of one of those three, which is why
the rule has not had to grow; the gate is what proves that rather than a reading
of it.

### Shots

`shots/walk/ui/` — `pre-summary`, `pre-summary-marks`, `pre-summary-night`,
`pre-details`, `pre-details-coffee`, `answer-not-walkable`, `during-walk`,
`during-walk-2`, `search-empty`, `search-typed`, `search-not-walkable`,
`capture-clip`, `capture-autopilot`, `capture-sliderdemo`, `desktop`.
Phone shots are 390 x 844 at 2x; `desktop` is 1440 x 900 at 1x.

## 13. What round 2 did NOT do

* **Still no `Walk it`.** Same reason as round 1, and the pose-selection code in
  this round's capture script is the missing half of it: it takes three tries and
  two rejection tests to find a spot on a route where the camera is neither in a
  wall nor looking at one. That belongs in the app before a button offers it.
* **No arrival clock, no "leave by", no "you'll make it".** §3 and §15 of
  `what-we-can-honestly-say.md` forbid all three, and they are the three things
  Citymapper leads with. The passing-period line is the whole of what we may say
  and it is already above the fold.
* **Did not touch the ribbon, the thread or their colours.** At the fitted
  altitude the route reads as a thin pale thread over a pale ground by day and
  clearly by night; whether `threadPx` / `threadOpacity` should rise is a taste
  call for whoever owns that half of the block, and it is a `WAYFIND` constant.
* **Did not measure the load cost of the index or the graph.** Unchanged from
  round 1 and still open.
* **Did not re-photograph the sheet at the smallest supported width** (320 px).
  Everything was checked for horizontal overflow at 390.

---

## 14. The harness this round was photographed with

Driven from a scratch script this lane does **not** own and therefore did not
commit (`scripts/verify/` belongs to another lane). The two pieces of it worth
keeping are written out here so the next round does not rediscover them.

**Getting the drawn route out of the page.** `map.getSource('wayfind-route')._data`
is **not** the FeatureCollection — it is `{ geojson: <FeatureCollection> }`, and a
naive `._data.features` throws. The path feature is the one with
`properties.k === 'path'`; the others are the two dashed door legs.

```js
let d = map.getSource('wayfind-route')._data;
if (d && d.geojson) d = d.geojson;
const line = d.features.find(f => f.properties && f.properties.k === 'path')
                       .geometry.coordinates;
```

**Finding a walking pose that is actually on the route, and proving it.** Two
rejection tests, in this order, over a list of fractions along the line. Both
were needed: the first alone still produced a frame facing a blank wall.

```js
for (const f of [0.30, 0.40, 0.22, 0.50, 0.60, 0.15, 0.70]) {
  const i   = Math.round(line.length * f);
  const brg = bearingBetween(line[i], line[i + 1]);
  const st  = __walker.findStart({ lng: line[i][0], lat: line[i][1],
                                   alt: 1.7, clearR: 6, searchR: 30 });
  if (!st) continue;                                    // no open ground here
  if (__walker.clearAhead(st.lng, st.lat, 1.7, brg, 40, 2, 2.0) < 20) continue;
  __walker.placeEye(st.lng, st.lat, 1.7, brg, 82);
  await settle(900);
  let hits = 0;                                    // THE RIBBON IS ON THE FRAME
  for (const y of [0.55, 0.65, 0.75, 0.85, 0.95]) {
    if (map.queryRenderedFeatures([W * 0.5, H * y],
        { layers: ['wayfind-ribbon'] }).length) hits++;
  }
  if (hits >= 3) return { f, alt: __fly.eye().alt, hits };    // this one
}
```

**And take the shot with `?intro=0`.** `?fit=1` waits for the opening flight to
finish (`fitWaitIntro`, up to 30 s), so a screenshot taken a couple of seconds
after the bar appears is of the **intro's end pose**, not of the fit. Load with
`intro=0`, then wait on `!map.isMoving() && !map.isEasing()` before the frame.
Every round-2 shot in `shots/walk/ui/` was taken that way; round 1's were not,
which is why the two sets do not frame the same city.
