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

---
---

# ROUND 3

Same lane, `acer/w-ui` continued. Round 2 fixed what the walking readout *said*.
Round 3 is about the shape of the thing beside Citymapper's walking directions at
390 x 844 — **the pre-walk summary and the during-walk view**, which is what this
lane is judged on. Everything below was photographed before and after at that
size; the shots are in `shots/walk/ui/`.

## 13. The itinerary — the one shape every walking app has and this bar did not

The rail says **where** the things on a route are. Nothing said **what they
are, in order**. Open the details on any other walking app and you get a list;
open this one and you got three disclaimers and a checkbox.

`STEP BY STEP` is now the first thing in the card, `JES -> WEL`:

```
▌  Beauford H. Jester Center
│    33 m
↱  then right
│    470 m
↰  then left
│    24 m
◎  Robert A. Welch Hall   Entrances are on this side
```

**Every row is derived, and nothing in it is invented.** One walk of the same
`routeProfile` the rail and the walking readout are built from: the distance
between consecutive events, the SIGN of the bearing change at a vertex, and the
marks `routeMarks` already draws. It names no street — the graph has none — and
it gives no instruction: the rows read `then left`, the audited round-2 wording,
because we are describing a line already painted on the ground. There is no
arrival clock time on this bar and there will not be one; §3 of the honesty doc
forbids it outright, which is the one place where copying Citymapper exactly
would have been the wrong move.

Four rules earned on the frame, in the order they were found:

**(a) The joint with the door link is not a turn.** The first list drawn opened
`JES -> WEL` with `then a sharp right` before it had walked a metre, and closed
it with `then a sharp left` at the door. Both were the seam between the routed
path and **our own straight line** from the door to the nearest path node —
geometry this app drew. Describing a manoeuvre there asserts something about the
world off a line we invented. `routeProfile` already flags those two segments
(`link`), and both the list and `nextTurnFrom` now skip them, so the walking
readout stopped opening a walk with a turn that is not there either.

**(b) A turn is a decision only when there is walking around it.** `JES -> DKR`
listed **twelve** turns for 580 m — `then right` / `then left` every fifteen
metres — which describes the wander of the pavement, not the walk.
`stepTurnMinLegM` 40: a turn is kept when the longer of its two legs reaches
40 m. Dropping one **merges its two legs into one longer distance**, so the
printed distances still sum to the route's own length, which is the property
that makes this a summary rather than a truncation. It converges — every drop
lengthens the legs either side. Staircases, crossings and the stop are never
pruned, at any row count. `JES -> ANB` (1.1 km) now lists eight turns, and
33+120+90+99+260+21+130+54+30+180+74 = 1,091 m against the bar's 1,090.

**(c) The list merges where the RAIL merges, by construction.** The rail merges
marks closer than `pipMergeT` of the route; the list used a flat 14 m. On
`JES -> ANB` the rail drew one capsule of four crossings while the list printed
two rows of two, 15 m apart — two pictures of the same four lights, counting
them differently. The list's merge distance is now `max(stepMergeM, pipMergeT x
total)`. Turns still merge only when they go the **same way**: a left-then-right
jink is two facts and collapsing it would invent one.

**(d) Every mark in the gutter is an element that already exists.** The two ends
are `.wf-mk-a` / `.wf-mk-b` — the same tick and ring the origin and destination
lines wear and the rail is capped with. The staircases, crossings and the coffee
stop are `.wf-pip` in the same kind classes. So the bar, the rail and the list
cannot drift apart: a colour or a shape changed once moves all three. With a stop
on the route the list shows `● Jester Java` in the same green the rail's via pip
uses and the key row names.

## 14. `pipMergeT` 0.018 -> 0.03, because a merged pip is wider than an unmerged one

A capsule of three is 19 px, so it needs about 5.5 % of a 342 px rail of
clearance; the old threshold bought it 1.8 %. Photographed on `JES -> ANB`: a
capsule of three and a single dot, 20 m apart, drew **on top of each other**, and
what landed on the frame was a blue pill with a paler circle inside it — an iOS
toggle switch, sitting on the one element in this bar that had already had to be
argued out of looking like a slider. At 0.03 they are one capsule of four, which
is also the number the card prints two lines below.

## 15. The card stopped being sized by a guess

`style.css` capped the details card at `100vh - (bar top + 128px + --drive-clear)`,
where 128 was a guess at the closed bar's height. The closed bar is **173 px with
nothing to say and 249 px with a passing-period warning and a wrapped action
row**, so the guess could not be right for both. Measured on `JES -> ANB` at
390 x 844, the open card ran to y781 — and the joystick ring, which draws *above*
the bar, punched an orange circle through the middle of the itinerary.

`fitCard()` sizes it from where the card actually starts:
`innerHeight - card.top - --drive-clear - 8`. `--drive-clear` is a
`calc(max(...))` and reads back through `getComputedStyle` as its own token
stream, so it is **measured** — a 1 px probe styled with it, added and removed
inside one frame, only while the card is open. Both routes now end at **y662**,
clear of the ring at y674. The CSS rule stays as the pre-script fallback and its
128 became 168. A `.scrolls` class (set only when the content really is taller)
fades the last 20 px, so a list that continues says so and one that fits keeps a
hard edge.

## 16. The figure line has a mode, and one layout instead of two

* **A walking figure in front of the minutes.** `min walk` carried the entire
  "this is a walking route" claim in a 12.5 px word at the tail of a sentence
  whose first thing is a 25 px number. `#wf-headline`.textContent is untouched —
  an `<svg>` contributes no characters to it.
* **The condition takes its own line, always.** As an inline run it wrapped only
  on routes long enough to overflow, and when it did it stranded the middot at
  the end of the line above: `12-20 min walk · 1.1 km ·` / `No stairs on this
  route`, photographed on `JES -> ANB`. A line that sometimes wraps is two
  layouts. The break is deliberate now and the stairs swatch leads its own line.
  The middot is visually hidden, not deleted. **While walking it goes back
  inline**, because demoted to footnote size the whole sentence is ~230 px of a
  342 px bar and the break would cost a row for nothing.
* **The destination is 12.5 px, not 11.5.** Which building is the subject of the
  whole bar and it was set smaller than the distance beside the minutes.
* **`Show route` is solid.** It was amber at 26 % over dark glass — the same
  weight as the panel behind it — and it is the control the whole answer exists
  to offer. It is now the one filled thing on the bar, in the same amber as the
  manoeuvre disc, so this feature has exactly one filled colour and it always
  means "the thing to do".

## 17. The during-walk view: one row shorter, one fact richer, and the comma fixed

**`13 m , then left`.** `.wf-then` is the string `, then left` — the comma
belongs to the distance in front of it — and a 4 px flex gap put a space before
it on every walking frame round 2 shot. `gap:0`.

**The footer was two half-empty rows.** The passing-period warning sat on a line
of its own and under it a 44 px row held one 90 px `Clear` with 270 px of nothing
beside it. `#wf-footrow` is a wrapping flex: `#wf-acts` asks for 210 px, more
than survives next to a warning chip on a 366 px bar, so with the wide primary
action present the actions still take their own line — and while walking, when
the only action is `Clear`, the two share a row. `margin-left:auto` and not the
container's `justify-content`, because `#wf-verdict:empty` removes itself and
`space-between` with one child puts that child on the **left**: photographed
walking `JES -> DKR`, a route with nothing to warn about, `Clear` sat alone in
the bottom-left corner where the primary action lives.

**And then right.** The space that freed up carries the turn AFTER the next one,
direction only. It is deliberately without a distance — a second number on the
bar is read as the distance to the first turn by anybody glancing — and it reads
as the continuation of the line above it: `24 m, then left` / `and then right`.
It comes from `nextTurnFrom` asked again from just past the first turn, so both
manoeuvres come off one function and one definition of a turn. **Three things do
not fit on 342 px**, so `#wf-verdict:not(:empty) + #wf-then2` drops it on exactly
the routes that have something to warn about — which is why the DOM order is
verdict, then2, acts while the frame order is then2, verdict, acts (`order:-1`):
CSS can only look forward from a sibling.

Measured, both poses at alt 2.40 m with the ribbon under the middle of the lower
half of the frame:

| | `21 Rio -> WEL` | `JES -> DKR` |
|---|---|---|
| bar height while walking, round 2 | 225.7 px | 196.7 px |
| bar height while walking, round 3 | **195.7 px** | **195.7 px** |
| top line | `150 m, then left` | `24 m, then left` |
| second line | `7–10 min walk REMAINING · 580 m` | `3–5 min walk REMAINING · 270 m` |
| footer row | `Tight for a 15-minute passing period` + `Clear` | `↱ and then right` + `Clear` |
| ribbon sample points hit | 5 of 5 | 5 of 5 |
| horizontal overflow | none | none |

One height for both, and the taller of the two came down 30 px while gaining a
fact.

## 18. What was verified this round, and how

One browser, port 8715, `python scripts/serve.py`, `?walk=1&drift=0&intro=0`,
`cancelGraphicsAutoDetect()`, waited on `!#veil`, two screenshots and the second
kept, 390 x 844 at DSF 2 (desktop shot at 1440 x 900).

```
node scripts/verify/harness-drift.mjs
  index.html:    31 scripts
  _harness.html: 31 scripts
  PASS  the harness loads the same city the site does
```

No `<script>` was added, so neither HTML file needed an edit; the check is quoted
because the rule says to run it.

**The recording surfaces, all three, measured rather than assumed** —
`?clip=1`, `?autopilot=1`, `?sliderdemo=1`, each with `from=JES&to=WEL&fit=1`:

```
                 #wf-button   #wf-sheet   #wf-pill   #hud
clip=1              none         none       none     none
autopilot=1         none         none       none     none
sliderdemo=1        none         none       none     none
```

**Horizontal overflow 0** on every state photographed: summary, details, details
with marks, details with a stop, both walking poses, the failure, the night
summary, and the three capture modes.

**The walking poses were rejected by the script, not by me.** It tries fractions
along the line and throws away any pose where `__walker.clearAhead` reports under
20 m on the heading, then any where `queryRenderedFeatures` finds the
`wayfind-ribbon` layer under fewer than 3 of 5 points down the lower half of the
frame — **and then any where `body.wf-live` never arms**, which is new this round
and caught a run that photographed the summary layout from a camera standing on
the route. `during-walk` was rejected at 0.30 and 0.40 ("wall at 6 m", "wall at
2 m") before 0.22 passed; `during-walk-2` was rejected at 0.30, 0.40 and 0.22
before 0.62 passed. Every frame reported above was opened and looked at.

## 19. One line for another lane, and one thing still not done

**`fmtDist` prints `10.0 m`.** Its sub-10-metre branch is `m.toFixed(1)`, and a
distance of 9.96 m rounds into it, so a leg between the two halves of a divided
crossing rendered as `10.0 m` while every other distance on the bar is a whole
number. The formatter is in the arithmetic half of `js/wayfind.js` and is not
this lane's to change. The patch:

```js
  if (m < 10) return (m >= 9.95 ? '10' : m.toFixed(1)) + ' m';
```

The itinerary sidesteps it for now — `stepMinLegM` is 12, and 10 m of median is
not a leg of anybody's walk — but the headline can still hit it on a very short
route.

**Still no `Walk it` button.** Unchanged from rounds 1 and 2: placing a camera at
eye level without a clearance search is how a pose ends up inside a wall, and the
camera is not this lane's to own beyond the existing `Show route`. The proposal
stands — `__walker.findStart`'s ring search around the origin door, then
`placeEye(lng, lat, 1.7, bearingOfFirstLeg, 80)`, behind a tap.

## 20. Taste values added this round (CLAUDE.md rule 11)

`WF_UI`: `stepsOn`, `stepsMax` 10, `stepTurnMinLegM` 40, `stepMergeM` 14 (a
floor under the rail-bound distance), `stepMinLegM` 12, `cardGapPx` 8,
`cardMinPx` 150; `pipMergeT` moved 0.018 -> 0.03. `SAY_UI`: `stepsTitle`,
`andThen`. Custom properties on `#wf-root`: `--wf-step`, `--wf-step-h`,
`--wf-thread`, `--wf-step-ic`, `--wf-mode`, `--wf-go-bg`, `--wf-go-edge`,
`--wf-go-ink`; `--wf-line` 11.5 -> 12.5.

# ROUND 4

Same lane, `acer/w-ui` continued. Round 3 gave the bar a list. Round 4 found
that **half of what this lane is judged on could not be reached from the
interface at all**, and fixed that first; the rest is the two shapes that were
still reading as something they are not.

Everything below was photographed at 390 x 844, before and after, in
`shots/walk/ui/`. Two new frames — `during-walk-walkit.png` and
`during-walk-2-walkit.png` — are the during-walk view as the **button** produces
it, not as a test harness poses it.

## 21. The during-walk view had no door into it

`renderLive` and everything it draws — the manoeuvre disc, `27 m, then right`,
`and then left`, the remaining figures, the progress on the rail — arm on
`body.wf-live`, which arms when the camera is within `liveOnRouteM` of the drawn
line and under `liveAltMaxM`. **Nothing in the interface ever put the camera
there.** Three rounds of this lane photographed that readout by flying a
Playwright harness onto the route. A person holding the phone would have had to
spot the line from 300 m up and fly down onto it by hand, with nothing anywhere
telling them there was a different bar waiting when they did.

So the bar could say two things and the product could only ever show one.

**`Walk it` is the door**, and it is the primary action now. It stands the eye
at 1.7 m on the first point of the route that is clear of every building,
looking down the walk. `Show route` — which frames the line from above, i.e.
the thing every maps app already does — keeps its glyph and its word at
secondary weight, and `Clear` gives up its word for the ✕ it always meant, which
is the only reason three controls fit on 342 px.

Four things had to be right, and each of them was wrong first and was found on
a frame:

**(a) A door is on a wall, so the start is a SEARCH.** `js/controls.js` answers
a camera inside geometry by lifting it clear (`writeToMap` raises the altitude
to `roofAt + HARD_CLEAR`), so placing the eye at the origin door does not clip
through a facade — it puts you on the roof looking down at one. That is exactly
the "camera buried inside a surface" that voided two rounds of work on this
project. `walkIt` walks the route's own profile outward, probing
`__fly.roofAt(lng, lat, walkClearR)` every `walkStepM`, and stands at the first
point that reads zero. The lowest roof seen is kept as a fallback, because a
button that silently does nothing is worse than one that stands you in the best
place it could find.

**(b) `walkClearR` was 7 m and had to be measured, not copied.** 7 is what the
verify harness's `findStart` uses to drop a camera on open ground, and on
`JES -> DKR` it found nothing in 140 m and the button did nothing at all: a
pavement three metres from a wall never has seven clear metres around it.
`js/controls.js` itself walks at `R_CAM_GROUND = 1.0` — at walking altitude the
app asks "is there a roof within one metre of me". `walkClearR` is 2.

**(c) The readout did not arm, because `__fly.eye()` was stale.** The camera
moves by `jumpTo`, and the controller only re-reads the map on its own next tick
(`syncFromMap`, and only while nothing is driving). `jumpTo` fires `move` and
`moveend`, `onCam` is on both, and BOTH of those samples still saw the camera
745 m up — photographed, with the bar showing the summary layout while the view
stood on the pavement. The readout is now re-asked `walkSettleN` times at
`walkSettleMs`, and stops the moment it takes.

**(d) You look down the WALK, not along one segment of it.** Two frames were
needed for this. Facing along the segment underfoot opened `21 Rio -> WEL`
across the pavement rather than down it, because the accepted point is usually
the far end of the **door link** — the straight line this app drew from the door
to the nearest path node — and describing a heading off geometry we invented is
the same mistake round 3's itinerary already had to fix. Facing along the first
*real* segment fixed that one and not `JES -> DKR`, where the eye stood exactly
on the line with **zero degrees** of deviation from its own segment and the
route still crossed only 23 % of the centre of the frame: that walk bends inside
its first twenty metres. The camera now aims at the point `walkLookM` along the
polyline, and steps `walkLeadM` in along the polyline too (not along a straight
bearing — measured, five metres along the old bearing walked off the pavement
onto a plaza and the ribbon left the frame entirely).

Both routes now: eye 1.70 m, pitch 85, `wf-live` armed, and the route under
**100 %** of the centre column of the lower half of the frame.

## 22. The rail was still a slider, and thickness was not the fix

Two rounds of notes in `style.css` say this element had been "argued out of
looking like a slider". It had not. Photographed this round at 390 x 844:

* summary — a 7 px hairline track, empty, with one bright round amber cap at the
  right end. That is a slider at 100 %;
* walking — the same track with an amber fill and a **13 px white disc** sitting
  in the middle of it. That is a volume slider, and nothing else;
* `JES -> ANB` — the merged four-crossing capsule, a pale blue pill on a dark
  track, i.e. an iOS toggle switch.

Four changes, in the order they were tried, and the first three were not enough
on their own — each one was photographed before the next was made:

1. **10 px, then 14 px.** Better and not sufficient: a band with one prominent
   round mark on it is a slider whatever its height.
2. **Filled with the route's own colour** (`--wf-rail` from 17 % neutral cream to
   26 % amber) so it is a drawn thing rather than an empty groove waiting to be
   filled. The brighter `--wf-fill` still marks the walked part, so progress is
   a change of weight inside one object.
3. **A 4 px corner instead of a pill** (`--wf-rail-r`). A fully-rounded
   horizontal band is a control; a band with a square-ish corner is a bar in a
   chart. Cheapest signal available and the one that had not been spent.
4. **AND THE ONE THAT ACTUALLY DID IT: every mark cuts the band.** No slider in
   the world is segmented. Each mark now punches a full-height notch through the
   band and sits in the gap, so the amber comes apart into the stretches of
   uninterrupted walking between the things that happen — which is a better
   picture than the dots were, because the width of a piece is how far you go
   without stopping. `.wf-notch` is its own element appended just before its
   mark (a `::before` is painted over its element's background and would have
   covered the dot it exists to frame) and is sized from the same number that
   sizes a merged capsule, so the two cannot drift.

The merged mark is a **block** now, not a capsule — with a notch behind it, a
rounded blue pill in a dark rounded slot is a toggle switch, and that is the
second time this element has had to be argued out of being a control.

`.wf-you` is a **playhead**: a 4 x 24 bar overhanging the band both ways, which
is the mark every scrubbing UI uses for position and none of them use for a
handle. The two terminals are exactly `--wf-rail-h` tall, so nothing on the rail
stands proud of it any more.

## 23. Walking, the bar carried two whole trip summaries and one was stale

Photographed walking `21 Rio -> WEL`: `27 m, then right`, under it `11–17 min
walk REMAINING · 940 m`, and under THAT `12-18 min walk · 1.0 km · Stairs: 3
sets`. Two complete trip summaries stacked on a 366 px bar — and the second one
measures a walk you are no longer taking, because `Stairs: 3 sets` goes on
counting sets already behind you.

The whole-route figure line is `display:none` while walking (`#wf-headline`
.textContent is unchanged — it is what the honesty gates and every verify script
assert on), and the row it vacates carries **what is ahead**: the marks past the
camera's own projection onto the line, which is the same class of measurement as
`remaining` and the one that changes what you do next. `3 staircases · 2
signalised crossings AHEAD`, in the same uppercase footnote `REMAINING` wears.

The counts use short labels. The legend's own strings — written for something
you read standing still, where naming the source is the point of the row —
wrapped this onto two lines. **What is still named: signalised**, because a
signalised crossing and an unsignalised one are different facts about the walk.
**What is not: OpenStreetMap**, which the details card states in full two lines
below and the standing legend still carries. Flagging that for the honesty lane
rather than assuming it: `SAY_UI.aheadStairsN` / `aheadSignalN`.

## 24. The open card: readable over the city, and one duplicate row shorter

`--wf-glass` is 72 % over a rendered city. Closed, that is four lines over sky
and it is right. Open, it is 540 px of small type — photographed on `JES -> ANB`,
the itinerary's leg distances sat on a bright green field and `260 m` was the
same value as the grass behind it. `#wf-pill.open` takes `--wf-glass-solid`, the
token the search panel next door already uses, so there is exactly one
"readable panel" colour in the feature and it is set in one place.

`#wf-key` is hidden when the card is open. `#wf-steps` prints every one of those
marks, in order, with the same swatch, so on the open bar the key was the
identical fact twice forty pixels apart; the 18 px buys another row of the
itinerary. The rail stays — it is the picture and the list is the words.

## 25. What was verified this round, and how

One browser, port 8715, `python scripts/serve.py`, `?walk=1&drift=0&intro=0`,
`cancelGraphicsAutoDetect()`, waited on `!#veil`, two screenshots and the second
kept, 390 x 844 at DSF 2 (desktop at 1440 x 900). Every frame reported below was
opened and looked at with the Read tool.

```
node scripts/verify/harness-drift.mjs
  index.html:    31 scripts
  _harness.html: 31 scripts
  PASS  the harness loads the same city the site does
```

No `<script>` was added, so neither HTML file needed an edit; the check is
quoted because the rule says to run it. `style.css` balances: 182 comment
openers, 182 closers, brace depth 0, no stray terminators.

**The four walking frames, and how the instrument got there.** The gate is "is
the route actually under the middle of the lower half of the frame", and
**three instruments answered it wrongly before the fourth**:

| instrument | what it did | why it was wrong |
|---|---|---|
| `queryRenderedFeatures(['wayfind-ribbon'])` | 0 of 5 on a frame with the ribbon plainly down the middle | a fill-extrusion at 1.7 m and pitch 85 is not reliably hit-tested; `buildings-shadow` was the only feature it would name |
| in-page `drawImage` of the GL canvas | right on some calls, blank on others, same page | `js/app.js` builds the context with `preserveDrawingBuffer: !!window.GFX_PDB` — whether the buffer still holds the frame depends on the graphics preset |
| Playwright screenshots **with a `clip`** | "nothing changed" | an unclipped diff of the very same two states changed 38 % of the frame |
| **two full screenshots, diffed** | the answer | goes through the compositor; cannot be empty |

The one that ships hides every layer this feature draws, shoots, restores,
shoots again, and diffs in a second Chromium page (the only PNG decoder in
reach). **It carries its own control** — an A/A pair with nothing changed
between them — because "the pixels changed" only means "the route is there" when
nothing else moves, and the thing being measured *does* move: `startPulse` runs
a gradient down the route's thread and an A/A pair taken while it runs differs
by 37 %. The measurement waits for the scene to go still (up to five tries) and
refuses to answer rather than reporting a number over a moving picture. Reduced
motion was deliberately NOT set: the frame photographed should be the frame that
ships.

| | via | alt | pitch | `wf-live` | A/A control | route on frame | route on centre column |
|---|---|---|---|---|---|---|---|
| `21 Rio -> WEL` | **`Walk it`** | 1.70 m | 85 | armed | 0.25 % | 38.4 % | **100 %** |
| `21 Rio -> WEL` | posed at t=0.22 | 1.7 m | 85 | armed | 0 % | 38.4 % | **100 %** |
| `JES -> DKR` | **`Walk it`** | 1.70 m | 85 | armed | 0.25 % | 37.5 % | **100 %** |
| `JES -> DKR` | posed at t=0.62 | 1.7 m | 85 | armed | 0 % | 38.8 % | 87.1 % |

**The recording surfaces, all three, measured rather than assumed** —
`?clip=1`, `?autopilot=1`, `?sliderdemo=1`, each with `from=JES&to=WEL&fit=1`:

```
                 #wf-button   #wf-sheet   #wf-pill   #hud
clip=1              none         none       none     none
autopilot=1         none         none       none     none
sliderdemo=1        none         none       none     none
```

**Horizontal overflow 0** on every state photographed: summary, summary with
marks, summary at night, details, details with marks, details with a stop, four
walking frames, the failure, the three capture modes, and desktop.

**Bar heights at 390 x 844.** Closed summary 195 px (245 with a passing-period
warning); open card bottom y650, clear of the joystick ring at y674; walking
195 px — one row of whole-route figures traded for one row of what is ahead.

**The failure state**, `FC1 -> WEL`: `Walk it` none, `Show route` none, `Clear`
44 x 44. There is no route to frame and none to stand on, so only the way out is
left.

**Desktop**, 1440 x 900: bar 560 px, action row 532 px, overflow 0, all three
controls on one line with the itinerary under them.

## 26. Not done, and one line for another lane

**`fmtDist` still prints a decimal under 10 m** — `8.4 m, then right` is on
`during-walk-2.png`. Correct at that distance and the only place it looks odd is
`10.0 m` from a rounded 9.96. The formatter is in the arithmetic half of
`js/wayfind.js` and is not this lane's to change; the patch is still:

```js
  if (m < 10) return (m >= 9.95 ? '10' : m.toFixed(1)) + ' m';
```

**`Walk it` moves the camera and nothing else** — no state, no route, no
re-render. It does not start a walk, follow you, or re-frame as you go; the
joystick does that, and the readout follows the camera the way it always has.

**The night bar was shot but not tuned.** `pre-summary-night.png` reads fine as
it stands; nothing in this round was chosen for it.

## 27. Taste values added this round (CLAUDE.md rule 11)

`WF_UI`: `walkItOn`, `walkAltM` 1.7, `walkPitch` 85, `walkClearR` 2.0 (from a
first cut of 7), `walkStepM` 4, `walkMaxM` 200, `walkSettleMs` 90,
`walkSettleN` 8, `walkLeadM` 5, `walkLookM` 25. `SAY_UI`: `walkIt`,
`walkItHint`, `aheadTag`, `aheadStairsN`, `aheadSignalN`. Custom properties on
`#wf-root`: `--wf-rail-r` 4px, `--wf-you-w` 4px, `--wf-you-h` 24px,
`--wf-notch`, `--wf-notch-pad`; `--wf-rail-h` 7 -> 14,
`--wf-rail` `rgba(255,222,170,.17)` -> `rgba(255,198,99,.26)`.

---
---

# ROUND 5

Same lane, `acer/w-ui` continued. Round 4 gave the bar a door INTO the walking
view. Round 5 found it had no door out, that the one element this bar has spent
three rounds arguing out of being a slider is still a slider on the commonest
shape of route there is, and that the line under the numbers goes stale the
moment you start walking. Everything below was photographed at 390 x 844 and
every frame reported was opened and looked at.

**Before anything new, the four fixes the brief names were re-verified on the
shipped build, by driving the page:**

```
 PASS  CSS: the phone rule for #wf-pill parses and is in the CSSOM  @media (max-width: 640px)
 PASS  CSS: the bar is full-width on a 390 px phone                 366 px of 390
 PASS  CSS: the bar sits BELOW the top button row                   top 120 px
 PASS  `Show route` is visible on the CLOSED bar, not in the card   114.6 x 44
 PASS  exactly one copy of `Show route` exists in the DOM
 PASS  the FIRST thing after the origin is not a turn               "33 m"
 PASS  the LAST thing before the door is not a turn                 "24 m"
 PASS  21 Rio -> WEL: the disc and the words agree                  disc right / words right
 PASS  JES -> DKR:    the disc and the words agree                  disc left  / words left
 PASS  GDC -> PCL:    the disc and the words agree                  disc left  / words left
```

The disc test hides nothing: it reads the `d` of the path inside the disc, maps
it to left/right, reads the words out of `#wf-live`, and fails if they disagree.

## 28. The rail was STILL a slider, on the commonest route there is

Round 4's fix for this element is right and it cannot help the case it does not
cover. Every mark cuts a notch through the band, so the band comes apart into
the stretches of uninterrupted walking — **on a route that has marks.**

`JES -> WEL` has none. `No stairs on this route`, no crossings, no stop: the
route a student walks between two neighbouring buildings, which is most of them.
Photographed at 390 x 844 (`shots/walk/ui/pre-summary.png`, round 4's own
committed frame, is the before): **one continuous amber band, empty, with a
bright round amber ring at the right end.** That is a slider at 100 % and it is
nothing else — and it is carrying zero information, because the line directly
above it already says in words that there is nothing on this walk.

So: **the picture is drawn only when there is something to picture.**
`stripNeedsMarks`.

**And the same rule holds while walking, which was not the first cut.** The
first cut kept the rail on the move, on the reasoning that the playhead is
itself a fact — how far along you are. Photographed walking `JES -> WEL`: an
empty band with a white bar near its left end and a bright ring at the right,
i.e. a volume slider at five per cent, which is word for word what round 4 said
about the shape it had just spent a round killing. The fact is not lost —
`6-8 min walk REMAINING | 520 m`, directly above it, is the same progress in
words. One rule, both states.

What it costs, measured at 390 x 844:

| | before | after |
|---|---|---|
| `JES -> WEL` summary | 195 px | **156.4 px** |
| `JES -> WEL` walking | 195 px | **133.3 px** |
| `21 Rio -> WEL` summary (3 marks) | 245.1 px | 245.1 px, unchanged |
| `21 Rio -> WEL` walking (3 marks) | 194.6 px | 194.6 px, unchanged |

A fifth of the bar back on the routes that had nothing to say, and not one pixel
moved on the routes that did. `shots/walk/ui/r5-summary.jpg`,
`r5-during-walk-2.jpg`.

## 29. The way out: the only control on the walking bar DELETED the answer

Round 4 gave the bar a door in and did not give it a door out. Photographed on
both walking routes: `Walk it` and `Show route` are both `display:none` under
`body.wf-live`, so the **only** control on the bar while standing on the route
was the X, and the X clears the route. A person who taps it to get back to the
map is standing at eye level in the middle of campus with no route and both
fields to type again. The door in was a trapdoor.

`Show route` comes back while walking. `Walk it` stays hidden — you are already
there — and the pair now reads as the toggle it always was: one puts you on the
pavement, one lifts you out. Driven end to end rather than reasoned about:

```
 PASS  21 Rio->WEL: walking bar has TWO controls, not one   ["Show route@44","Clear@44"]
 PASS  21 Rio->WEL: the way out LIFTS the camera            1.7 m -> 900 m
 PASS  21 Rio->WEL: the bar goes back to the summary
 PASS  21 Rio->WEL: the ROUTE SURVIVES the way out          12-18 min walk | 1.0 km | Stairs: 3 sets
 PASS  21 Rio->WEL: and Walk it is back                     ["Walk it","Show route","Clear"]
 (all five again on JES->WEL, with the way out at 113 px and its word on)
```

`shots/walk/ui/r5-during-walk.jpg` (warned route, glyph), `r5-during-walk-2.jpg`
(unwarned, labelled), `r5-wayout.jpg` (after the tap).

**And it uncovered a real bug that was already there.** `sampleLive` reads
`__fly.eye()`, and `js/controls.js` only re-reads the map on its own next tick,
so the sample taken ON `moveend` after a map-driven move can still report where
the camera *was*. Round 4 found this jumping DOWN onto the route and fixed it
inside `Walk it`. The way out jumps UP off the route and hit the identical lag
in the other direction: measured on `JES -> WEL`, the bar kept the walking
readout with the camera at **982 m of altitude** — and with the camera now
parked there was no further `move` event, so nothing was ever going to sample
again. **It stuck.** The re-ask now lives in `onCamEnd`, once, for every move
that ends, and stops at the first sample that changes anything
(`endSettleN` 8 at `endSettleMs` 110). Both routes now land at 900 m with the
readout correctly disarmed, on repeated runs.

**Three things still do not fit on 340 px** and the same rule decides it as in
round 3 — the warning wins. Measured on the shipped build, not guessed: the
footer's content box is 340 px, the warning chip is 219 px, the actions are
96 px as glyphs or 165 px with the word on.

```
  219 + 8 +  96 = 323   one row,  footer 36 px, bar 194.6 px
  219 + 8 + 165 = 392   two rows, footer 67 px, bar 225.6 px
```

So with a warning present the way out loses its word and keeps the frame glyph.
That is not a mystery glyph: **the glyph was taught one state earlier** — the
way you got here is by tapping `Walk it` on a bar where that same frame glyph
was sitting next to the words `Show route` — and it keeps its title and its
aria-label. To stop the two dark squares reading as a matched pair, the way OUT
takes a warm wash and the accent ink (`--wf-out-bg`, `--wf-out-edge`) and the
dismiss stays grey. They are not the same kind of thing and should not look it.

## 30. The passing-period line was about a walk you were no longer taking

`Tight for a 15-minute passing period` was computed once, off the WHOLE route's
range, and never re-asked. Three minutes from the door the bar still said it.
This is exactly the defect round 4 fixed one row higher up — `Stairs: 3 sets`
counting sets already behind you — left in place one row lower down.

It is re-asked of `live.rem.time` now: the same range arithmetic over the same
permitted wording, run on the part of the route that is left, which is the same
measurement class as `remaining` and as the `ahead` counts, both already
audited. **The rule is unchanged and stays one-sided** (honesty doc 15): over ->
say so, crossing -> say it is tight, under -> say nothing. So it goes quiet as
you get close, which is the honest thing for it to do. There is still no
"you'll make it" and there must not be.

Driven down `21 Rio -> WEL`, standing on the line at four fractions of it:

```
  t=0.10   10-15 min walk REMAINING | 820 m    "Tight for a 15-minute passing period"
  t=0.45    5-8 min walk REMAINING | 440 m     ""
  t=0.72    2-4 min walk REMAINING | 170 m     ""
  t=0.90    1-2 min walk REMAINING |  91 m     ""
```

The row it frees is what lets the way out sit beside `and then left` instead of
under it. Stepping off the route puts the whole-route answer back, from the same
one function (`applyVerdict`) — the old copy of this logic was inline in
`renderPill` and is gone, so there is one definition of it.

## 31. The list had no sign on the door

The itinerary is the one shape this bar shares with every walking-directions app
on a phone, and it sat behind a bare 28 px chevron in the corner with nothing on
the frame saying it was there. Round 2 took `Show route` out from behind that
chevron for exactly this reason and left the list behind it.

The chevron carries a word now — `STEPS`, 64.3 px including the glyph — and only
the glyph rotates, so one thing on the control changes state and the word can
stay put. It is hidden while walking (`#wf-orig` is gone then and that row
belongs to the manoeuvre) and on a failure, where the chevron itself is hidden
because there is nothing to open. The clearance the top rows leave for it is
`--wf-chev-clear`, one token instead of the `padding-right:26px` that was
written out three times and would have gone stale the moment the control changed
width. `shots/walk/ui/r5-summary.jpg`, `r5-details.jpg`.

## 32. What was verified this round, and how

One browser, port 8815, `python scripts/serve.py 8815`,
`?walk=1&drift=0&intro=0`, `cancelGraphicsAutoDetect()`, waited on `!#veil`, two
screenshots and the second kept, 390 x 844 at DSF 2. Every frame reported was
opened and looked at with the Read tool.

```
node scripts/verify/harness-drift.mjs
  index.html:    31 scripts
  _harness.html: 31 scripts
  PASS  the harness loads the same city the site does
```

No `<script>` was added, so neither HTML file needed an edit; the check is quoted
because the rule says to run it. `style.css` balances: 188 comment openers, 188
closers, brace depth 0, no stray terminators.

**The rail rule, both states, on three routes**

```
 PASS  JES->WEL:     summary rail NOT drawn (nothing on it)   marks=0 bar=156.4
 PASS  JES->ANB:     summary rail drawn                       marks=1 bar=245.1
 PASS  21 Rio->WEL:  summary rail drawn                       marks=3 bar=245.1
 PASS  JES->WEL:     walking rail NOT drawn                   marks=0 bar=133.3
 PASS  21 Rio->WEL:  walking rail drawn                       marks=3 bar=194.6
```

**The recording surfaces, all three, measured rather than assumed** — the gate
walks every descendant of `#wf-root` and counts anything with a box, so the new
chevron label and the new walking control are inside it by construction:

```
 PASS  ?clip=1:       visible=0 of 83 descendants
 PASS  ?autopilot=1:  visible=0 of 83 descendants
 PASS  ?sliderdemo=1: visible=0 of 83 descendants
 PASS  OFF: no walk parameter adds no element     elements=0
 PASS  OFF: ?walk=0 beats from/to                 elements=0
```

**The failure state**, `FC1 -> WEL`: `Clear` alone, no chevron (so no `STEPS`
label promising a list that does not exist), no rail, overflow 0.

**320 px, photographed for the first time** (round 2 listed it as never
checked). Nothing in the bar escapes it, the three actions still fit, the
destination wraps to two lines, and the bar is 266.5 px. The page reports 21 px
of horizontal overflow at that width and **it is not ours** — measured with the
feature switched off entirely it is the identical 21 px, from `#controls-hint` /
`.mobile-hint` (362.5 px wide) and `#sky-bloom`. `shots/walk/ui/r5-320.jpg`.
Flagging it for whoever owns the drive hint rather than fixing it from here.

## 33. Measured, NOT fixed, and written down so the next round does not rediscover it

**`Show route` frames every route from the same altitude, and on some bearings
it puts the whole route behind the bar.** Found by measuring the frame the new
way out produces, then measuring the old path as a control. Every vertex of the
drawn line projected to screen, twice, on separate runs — the two runs agree to
the decimal:

| route | from the summary | after the way out |
|---|---|---|
| `21 Rio -> WEL` (66 pts) | 100 % in view, 56 % clear of the bar | 100 % in view, **0 % clear** |
| `JES -> WEL` (30) | 100 % / 100 % | 100 % / 100 % |
| `JES -> ANB` (86) | 100 % / **0 %** | 100 % / 45 % |

Both paths hit 0 % on one route each, so **this is not the way out's doing** —
it is `Show route` itself and it has been shipping since round 2, whose own
measurement of it happened to sample three bearings where it was fine.

The mechanism, probed rather than guessed: `cameraForBounds` asks for zoom
14.30 / 14.75 / 14.92 for the three routes, and the camera settles at **zoom
15.00 and altitude 900 m on all six runs** — `__fly.consts().ALT_MAX` is 900.
`js/controls.js` clamps the altitude and then rewrites the centre from the eye,
so the framing is whatever falls out of the clamp, and every route, 530 m or
1.1 km, gets the same camera height.

**An offset on the fit was measured and made it worse**, which is also what
round 2 found for bar-aware padding: `cameraForBounds` returns the *identical*
zoom for uniform 90 padding and for bar-aware padding, and pushing the centre
down 160 px drops 60-80 % of the route off the frame entirely. So nothing was
shipped. The fix belongs to whoever owns the camera: either the fit needs to
know about `ALT_MAX`, or `ALT_MAX` needs to not bind on a campus-scale fit.
`WAYFIND.fitPitch` / `fitPadPx` live in the shared taste block, so this is a
written request and not an edit from here.

*(One thing round 5 improves here by accident: the bar is 156 px instead of 195
on a no-mark route, so the bar's bottom edge is at y276 instead of y365 and
there is 89 px more frame for the route to land in.)*

**`fmtDist` still prints a decimal under 10 m** — `9.2 m, then left` was on the
frame this round on `GDC -> PCL`. Correct at that distance; the only place it
looks wrong is `10.0 m` from a rounded 9.96. Third round of flagging it. The
formatter is in the arithmetic half of `js/wayfind.js`:

```js
  if (m < 10) return (m >= 9.95 ? '10' : m.toFixed(1)) + ' m';
```

**`WAYFIND.viaRingCol`** still paints the stop's ring on the ground in the old
`#8fd3ff` while the bar uses `#8fe6bd`. Round 2's request, still open, still one
line.

**Not done:** the night bar is still untuned; nothing this round was chosen for
it. And at 320 px the taller bar states overlap the top of the time slider —
measured at 266.5 px of bar against a panel that starts around y318. Nothing in
this round changed the height of that state (it changed only no-mark routes, and
downward), so it is recorded rather than claimed as new.

## 34. Taste values added this round (CLAUDE.md rule 11)

`WF_UI`: `stripNeedsMarks`, `liveShowRoute`, `liveVerdictRemaining`,
`stepsPeekOn`, `endSettleN` 8, `endSettleMs` 110. `SAY_UI`: `stepsPeek`.
Custom properties on `#wf-root`: `--wf-chev-lab` 10px, `--wf-chev-clear` 74px,
`--wf-out-bg`, `--wf-out-edge`. The `padding-right:26px` written out three times
above the strip became `var(--wf-chev-clear)` on the two rows that need it.

### Shots

`shots/walk/ui/` — `r5-summary.jpg`, `r5-details.jpg`, `r5-during-walk.jpg`,
`r5-during-walk-2.jpg`, `r5-wayout.jpg`, `r5-320.jpg`. Six frames, 1.2 MB in
total, because CLAUDE.md rule 12 counts every committed byte once per lane;
round 4's eighteen PNGs are 15 MB. Scratch frames from this round stayed in the
scratchpad.

---

# Round 6 — the walk stopped being able to keep the camera, and the bar stopped being a segmented control

Round 1's critic drove the shipped `acer/w-ui` build fresh and returned
`oursWins = false` on two counts. Both are closed here, and one of the two
turned out to be a different defect from the one it was reported as. Everything
below was measured on this branch, at 390 x 844, in real Chromium, and the
frames are cited by name.

## 35. `Walk it` put you on the pavement and something else took you back off it

**The report.** *"the camera correctly drops to 1.70 m, but in 2 of 3
independent runs it was silently ejected back to 900 m — the Show route
altitude — within 2-6 s with no input... `walkIt()` doesn't appear to run the
same open-ground clearance search the scripted test walker's `findStart()`
already does."*

**Reproduced, 3 runs out of 3.** `?walk=1&drift=0&from=JES&to=WEL`, 390 x 844,
`.wf-act-go` clicked, `__fly.eye().alt` sampled every 250 ms for 14 s. Every
run: down to 1.70 m, back up to 158.24 m, parked there for the rest of the
trace.

**But not for the reported reason, and that matters because the reported fix
would not have worked.** Every call into the camera was monkey-patched to log
its own stack before forwarding, so the culprit came back named rather than
inferred:

```
t=+0.0 s  jumpTo   at walkIt   (js/wayfind.js)
t=+2.5 s  easeTo   at js/app.js:1948          <- the opening title flight
```

`js/app.js`'s intro is **two legs with a `setTimeout` between them**. Leg 2 is
armed the instant leg 1 departs and is only ever disarmed by the intro's own
`cancel()`. `walkIt` calls `map.stop()`, which kills the ease that is *running*
and cannot touch a timer that has not fired yet — so leg 2 lands on top of the
walk and carries the camera to the intro's end pose. With `?fit=1` there is a
second one: the QUEUE Z6 `fitWhenFree` poll is waiting for exactly the quiet
that `walkIt`'s own `map.stop()` produces, and it fits to **900 m**, which is
the number in the report.

The clearance search the report asked for **was already there and it is
working**. Probed at the walk pose on `JES -> WEL`:

```
__fly.roofAt(eye, 0.5 m) = 0     __fly.roofAt(eye, 2 m) = 0
__fly.roofAt(eye, 4 m) = 51.6    <- Jester's mass, four metres away
```

Nothing over the eye out to 2 m. `walkClearR` is 2.0 and the search stops at the
first sample that reads zero, so the pose is on open ground by construction; the
51.6 m at 4 m is what a pavement beside a seventeen-storey building looks like.

**The "renders broken (magenta/olive banding)" evidence is a misattribution
too,** and it was worth five minutes to say so rather than chase it. Re-shot the
same pose with every `build*` and `facade*` layer hidden: the band is still
there. Then with every wayfind layer hidden, then with every road layer hidden:
`rgb(110,45,74)` at three sample points, identical in all four states. It is not
the camera inside a building, it is not our ribbon (the route palette is
`#fff4d8` / `#ffcf6a` — there is no magenta anywhere in this feature), and it is
not the road casing. It is the app's dusk sky and the basemap's own fills seen
at **grazing angle**, which is unavoidable at walking height: `js/controls.js`
pins the pitch between `pitchFloor()` 84.42 and `PITCH_MAX` 88 at 1.7 m, so a
walking camera cannot look down. Recorded for whoever owns the sky; nothing in
this lane can change it and `walkPitch` is not free to lower.

### The fix: the walk owns the camera until you take it back

`holdWalk` in `js/wayfind.js`. For `walkHoldMs` after the tap, anything that
lifts the eye above `walkHoldAltM` or slides it more than `walkHoldSlipM` off
the spot we stood on — **with no input in between** — is undone: `map.stop()`
and the same `jumpTo` again. The hold is armed inside the `click` handler, which
is after that tap's own `mousedown`, and **the next `pointerdown`, `mousedown`,
`touchstart`, `wheel` or `keydown` releases it for good**, so it can never fight
the person holding the phone. `fitWhenFree`'s poll bails while it is up, and
`Show route` releases it explicitly (a synthetic `.click()` from a script has no
`mousedown` to do it).

Two brakes, because a camera that fights back is worse than one that gives up
once: at most `walkHoldMaxN` re-takes, and it will not re-take at all unless
`roofAt` still says the ground it wants is clear — so if the controller's own
hard net is pushing the eye out of geometry, this yields instead of flickering
in and out of a wall.

**A real finger dodged the intro half of this by luck**, and that is why the fix
is written the other way up rather than as a patch to the intro. The intro
cancels itself on `mousedown`, which a tap fires a few milliseconds before the
`click` that runs the button — so with `page.mouse.click()` the ejection is 1 in
3 and with `element.click()` it is 3 in 3. That coincidence does not hold for a
keyboard `Enter`, for `?fit=1`, or for anything a future pass schedules.

## 36. Three same-weight actions were not three actions, they were one segmented control

**The report.** *"Citymapper's pre-walk sheet has exactly one action (a single
green GO pill)... Ours puts three same-weight actions (Walk it / Show route / ✕)
in one row of the closed bar and stacks current-turn + remaining ETA +
destination note + next-step preview + two buttons into a single persistent top
card while walking — denser and more capable but not calmer, which was the
brief."*

Looked at on the frame, that is right, and the reason is not the count. All
three wore the same costume: three rounded 44 px rectangles, each with a 1 px
warm border and a lit panel behind it, 8 px apart. Three of those in a row is
the iOS **segmented control** — one widget with three equal cells, meaning "pick
which of these you are in". That is the third time this bar has accidentally
drawn a stock phone control (the rail did it twice) and the fix is the same one
that worked there: stop spending the shape.

So the border and the panel come off the two that are not the point. `Walk it`
keeps the fill and is now the only filled or bordered thing in the whole
feature. **Nothing is hidden and no label is lost** — round 2 of this lane took
`Show route` out from behind the chevron precisely because the control that
mattered was the one you could not see, and it is still on the frame, still
labelled `Show route`, still 106 x 44 px of touch target (measured).

`shots/walk/ui/r6-bar-before-after.jpg` — the same 390 x 844 crop, before and
after.

### And on the walking bar the same rule removed the second amber

While walking, the way out wore the accent ink on a warm-edged panel, which put
a **second amber object** on the bar — and the first one is `24 m`, the distance
to the next turn, which is the entire reason the bar is on screen. It is ghost
now too.

## 37. The entrance callout arrives when you do

`Entrances are on this side` is the single most valuable thing this app says and
no maps app says it. While walking it was printed for the **whole** journey,
where it is the longest line on a 342 px bar and, six minutes from the door, not
yet a fact anybody can act on.

It now holds until `WF_UI.liveDoorNoteM` (160 m, about two minutes at this app's
own walking speed) of route is left, and then appears — and the destination's
name, which was set at the same weight as the live remaining figures, goes quiet
for the same stretch and comes back to full weight with it. One line changes
weight once, on approach. Nothing appears from nowhere: the building's name is
on the bar the whole way.

`#wf-sub`.textContent is byte-identical in both states — the phrase is hidden in
CSS the same way the middot beside it already is — so every honesty gate and
verify script that reads that string still reads it. Asserted in both
directions (see the gate, item 7).

`shots/walk/ui/r6-walkbar-before-after.jpg` (far from the end),
`shots/walk/ui/r6-walk-approach.jpg` (`GDC -> WEL`, 110 m, so the whole walk is
inside the band and the callout is up from the first frame).

## 38. What was verified this round, and how

`node scripts/verify/harness-drift.mjs` first: **31 scripts in each**, PASS. No
`<script>` was added this round, so `index.html` and `_harness.html` are
unchanged.

Then a fourteen-assertion gate, every item of which is a thing some round of
this lane shipped broken. Server `python scripts/serve.py 8815`, playwright-core
from `scripts/verify/node_modules` with an explicit `executablePath`, one
browser, 390 x 844 at dpr 2, `?drift=0`, `window.cancelGraphicsAutoDetect()` at
the top of every page, veil waited out.

```
1. Walk it holds the camera (no input for 12 s)
  PASS  [tap 1] alt=1.7 m, walking layout=true
  PASS  [tap 2] alt=1.7 m, walking layout=true
  PASS  [click 1] alt=1.7 m, walking layout=true
  PASS  [click 2] alt=1.7 m, walking layout=true
2. Manoeuvre disc and the words are the same turn
  PASS  10 samples, 2 distinct glyphs, 0 that contradicted their words
3. Show route is on screen and tappable
  PASS  summary: 106.2x44 at y220.4, "Show route"
4. Exactly one filled control on the bar
  PASS  filled: .wf-act-go
5. The phone rule for #wf-pill really applies
  PASS  left=12px right=12px transform=none width=366
6. The walk opens on a real path, not on the line we drew
  PASS  ribbon layers (4) changed 5/5 samples down the centre of the lower frame
7. The entrance note waits for the approach
  PASS  530 m route: near=false doorOnFrame=false inTextContent=true
  PASS  110 m route: near=true  doorOnFrame=true  inTextContent=true
8. Hidden in every capture mode
  PASS  clip=1: visible wayfind elements = []
  PASS  autopilot=1: visible wayfind elements = []
  PASS  sliderdemo=1: visible wayfind elements = []

14 passed, 0 failed
```

**Item 1 was watched failing on the code it guards.** The identical script, same
server, same browser, run against this branch *before* the change: `EJECTED 3/3`
with the `js/app.js:1948` stack in the log. Items 3, 5 and 6 are the round-2,
round-1 and round-4 defects respectively, re-asserted because the brief asked
for exactly that; item 2 is round 4's arrow-versus-words defect.

The gate lives in the scratchpad rather than in `scripts/verify/`, because this
lane's ownership line for this round is `index.html`, `_harness.html`,
`style.css`, the UI half of `js/wayfind.js`, `shots/walk/ui/` and this file, and
four sibling lanes were editing the rest of `js/wayfind.js` at the same time. It
is described here in enough detail to be rebuilt without rediscovering it:

```
scripts/verify/_scratch-uigate.mjs   (scratchpad copy)
  python scripts/serve.py 8815
  VERIFY_URL=http://127.0.0.1:8815 node scripts/verify/_scratch-uigate.mjs

 1  tap Walk it, then no input for 12 s: still at walking height and still in
    the walking layout. Run with a real pointer tap AND with a synthetic
    .click() -- the second does not fire the mousedown that cancels
    js/app.js's intro, and is the case round 1's critic measured.
 2  the manoeuvre disc and `then left/right` are the same turn, sampled down
    the route by jumping the camera forward on its own bearing.
 3  `Show route` is on screen, >= 44 px of touch target, labelled.
 4  exactly one of .wf-act-go / .wf-act-show / .wf-act-clr computes to a
    non-transparent background or border.
 5  #wf-pill computes to left:12px right:12px transform:none -- i.e. the
    @media(max-width:640px) block was not dropped by a comment that closed
    twice.
 6  hide the four `wayfind-*` layers and re-sample five points down the centre
    of the lower frame: >= 4 must change, so the ribbon really is under the
    walk and not off to one side.
 7  JES->WEL is 530 m and GDC->WEL is 110 m: the door phrase must be off the
    frame on the first and on it on the second, and in `#wf-sub`.textContent
    on both.
 8  ?clip=1 / ?autopilot=1 / ?sliderdemo=1: no wayfind element has a box.
```

## 39. Measured and NOT fixed, handed on

* **The grazing horizon at walking height.** `js/controls.js` pins pitch to
  [84.42, 88] at 1.7 m, so `WF_UI.walkPitch` is not a free taste value and a
  third of the walking frame is sky and flattened basemap. Whoever owns the sky
  owns this. Pose and pixel samples are in §35.
* **`Show route` still frames some routes off the bottom of the phone.** Round 5
  measured it (`ALT_MAX` 900 binds on a campus-scale fit) and it is unchanged;
  the fix belongs to whoever owns the camera. Round 6 makes it less costly to
  hit, because `Show route` no longer looks like the primary action.
* **`fmtDist` prints `10.0 m` from a rounded 9.96.** Fourth flagging; the
  formatter is in the arithmetic half of the file, one line.
* **`WAYFIND.viaRingCol` `#8fd3ff` vs the bar's `#8fe6bd`.** Third flagging.

## 40. Taste values added this round (CLAUDE.md rule 11)

`WF_UI`: `walkHoldOn` true, `walkHoldMs` 9000, `walkHoldPollMs` 200,
`walkHoldAltM` 12, `walkHoldSlipM` 60, `walkHoldMaxN` 3,
`liveDoorNoteOnApproach` true, `liveDoorNoteM` 160.
Custom property on `#wf-root`: `--wf-ghost-pad` 10px.
No new string, so `SAY` and `SAY_UI` are unchanged and nothing new is claimed.

### Shots

`shots/walk/ui/` — `r6-bar-before-after.jpg`, `r6-walkbar-before-after.jpg`,
`r6-summary.jpg`, `r6-walk.jpg`, `r6-walk-approach.jpg`. Five frames. Every
other frame this round stayed in the scratchpad (CLAUDE.md rule 12).

---
---

# ROUND 7

Same lane, `acer/w-ui`, continued from c06733a. Round 6's critic returned
nothing at all, so this round is its own critic: the two frames this lane is
judged on — the pre-walk summary and the during-walk view at 390 x 844 — were
re-shot on the shipped build and read beside real Citymapper product frames
(their pre-walk sheet and their during-walk manoeuvre card).

Three things came out of that reading. One of them was a feature Citymapper has
and we deliberately may not; one was a regression this lane caused itself and
did not look at; one was a rule round 6 wrote that round 6's own gate could not
see break.

## 41. The biggest gap against Citymapper is one this project has already ruled out

Every Citymapper frame in the reference set carries an **arrival clock**:
`Arrive 14:38` anchoring the pre-walk sheet, `19 min / 14:38` in the persistent
pill while you walk. It is the fact their interface is built around, and for a
student between classes it is *the* question — not "how long is this" but "am I
there before it starts". We have nothing like it, and the first plan for this
round was to add it.

It is forbidden, in writing, by this project's own audit.
`docs/walk/what-we-can-honestly-say.md` §3, "a range, never a number, and never
a clock time":

> may not show a single number, may not show seconds, and **may not show an
> arrival clock time or a "leave by"** — those convert an assumption into a
> promise, and a promise is the thing that makes someone late.

The reasoning is the same one-sided rule §15 uses for the passing period, and it
is right: our range is `WALK_SPEED_LOW`..`WALK_SPEED_HIGH` plus a per-signal
wait, multiplied by somebody else's legs. So the gap stays open **on purpose**,
and it is written down here rather than rediscovered and re-proposed by round 8.
The nearest honest thing to an arrival time is already on the bar and is
arguably better than a clock: `Longer than a 10-minute passing period`, which
answers the question the clock only implies.

## 42. Round 5 deleted the thing holding the two ends together, and nobody looked at what was left

Round 4 gave the origin line a tick and the destination line a ring, and
`style.css` says why in the code: *"Identical shapes to `.wf-cap-a` and
`.wf-cap-b` on the rail — so the origin line, the rail and the destination line
are visibly one object."* That was true when it was written.

Round 5 then stopped drawing the rail on any route with nothing on it —
correctly; an empty rail is a slider at 100 % and it had been argued out of that
shape twice already. But **most short walks have nothing on them**, so on most
routes the sentence above became a claim about an object that is no longer
there.

Photographed at 390 x 844 on `JES -> WEL`, the commonest shape of route there is
(`shots/walk/ui/r7-bar-before-after.jpg`, left half):

```
 |  FROM  Beauford H. Jester Center            STEPS v
 *  6-8 min walk . 530 m                  <- flush left
    No stairs on this route               <- flush left
 O  Robert A. Welch Hall   Entrances are on this side
```

Two marks, two rows apart, with nothing between them, and **two different left
edges 21 px apart alternating down four rows**. Measured: `#wf-orig` and
`#wf-sub` are indented into the `--wf-mk-w` gutter; `#wf-headline` was not.

And the two marks were not even on one axis. `--wf-mk-w` made the two NAMES
share a left edge — the comment says so — but the marks themselves were both
pinned at `left:0` of that gutter at two different widths, so the 3 px tick's
centre sat at **x=1.5** and the 11 px ring's centre at **x=5.5**. Four pixels;
invisible on either mark alone and fatal to a line drawn between them.
`#wf-steps .wf-mk::before` has centred them since round 3, because the itinerary
runs a thread through them; the bar never did, because until now it had nothing
to run.

### The spine

`#wf-spine` — the rail, stood on its end. A `--wf-spine-w` hairline down the
same gutter, from the tick to the ring, behind the text, and `#wf-headline`
joins the column. It adds **no row, no word and no claim**: it is the two marks
the bar already draws, joined.

It is drawn only when the rail is not, so the bar never carries two pictures of
one walk, and it is down while walking (there is no origin row then — the bar
has stopped describing a journey and started describing the next twenty metres).

It is **measured, not declared**, and `drawSpine`'s header says why: the two rows
it runs between change height with the route, so there is no CSS length that is
right on every route, and the other CSS-only way — a `::before` segment per row
— breaks at every margin and gives you a dashed line nobody asked for. Two
things that cost a debugging pass each and are now written down in the code: a
`.wf-mk` is an EMPTY inline-block, so `align-self:center` gives it **zero
height** and its `y` is the row's centre (a `!rect.height` guard silently
switched the whole feature off); and `#wf-pill` has a 1 px border, so an
absolutely positioned child is placed from the padding box and the join sat one
pixel low until `clientTop`/`clientLeft` were read rather than assumed.

## 43. The second amber disc — which round 6's rule forbids and round 6's gate could not see

Round 6's ruling: three 44 px rounded boxes in a row are not three actions, they
are an iOS segmented control, so the panel and the border come off `Show route`
and the close control, and **`Walk it` is the only filled or bordered thing in
the feature**. It asserted that over `.wf-act-go / .wf-act-show / .wf-act-clr` —
a list of three class names typed by hand.

`#wf-then2` is in the same row and is not on that list. Measured on the shipped
build while walking: `background: rgba(255, 198, 99, 0.15)`, `box-shadow:
rgba(22, 14, 4, 0.96) 0 0 0 2.5px`. An amber disc with a dark ring, 250 px from
two glyph-and-label pairs that really are buttons.

The class is shared with the itinerary, where the disc is exactly right — it
punches the thread that runs behind the list. In the footer row there is no
thread. `and then left` is a fact, so it is now set like one
(`shots/walk/ui/r7-walkbar-before-after.jpg`).

**And the gate was rewritten so this class of miss cannot recur**: the rule is
now swept over EVERY element inside `#wf-pill`, computing fill, border and ring
off the CSSOM, rather than over a list somebody remembered to update. It is also
state-aware, because the honest version of round 6's rule is *one filled object
per state*: `Walk it` on the summary, the manoeuvre disc while walking.

## 44. Measured on the camera, and NOT fixed: `Walk it` still loses the camera about one time in five

Driving the tap for real (`page.mouse.click`, not a synthetic `.click()`),
390 x 844, `?walk=1&drift=0&from=JES&to=WEL`, on a machine with four sibling
lanes rendering:

| build | landed at 1.70 m on the route | lost the camera |
|---|---|---|
| `origin/acer/w-ui`, before this round | 4 / 5 | 1 / 5 — ended at 141.98 m |
| this round | 3 / 5, then 3 / 4 | 218.87 m, 312.38 m, 354.86 m |

The A/B was run by restoring the branch's own files, measuring, restoring this
round's, and measuring again, on the same server and the same browser. **The
failure is on both sides**, the samples are small, and the machine was loaded —
so this round neither caused it nor fixed it, and says so rather than quoting
the greener half. The end poses (354.86 m, 2 km from the route) are
`js/app.js`'s opening flight landing its second leg on top of the walk, which is
§35's defect exactly; `holdWalk` answers it and `walkHoldMaxN` (3) can be spent
before the delayed leg arrives when the machine is slow. Raising it is a
one-line taste change and it belongs to a round that can measure it on a quiet
machine.

What this round DID change is the other half of the same window. `walkIt`'s
eight re-asks are eight `setTimeout`s armed at once, so **all of them have fired
720 ms after the tap** — while the flight lands 2-3 s later and `holdWalk`'s
re-jump, the one the readout actually has to see, is later still. That jump's
`moveend` starts `onCamEnd`'s chain, which is `endSettleN * endSettleMs` =
880 ms, and `sampleLive` reads `__fly.eye()`, which `js/controls.js` only
refreshes on its own next tick. Miss that window with the camera parked and
there is no further `move` event, so nothing is ever going to ask again:
photographed, the eye at **1.70 m on the route with the bar still on the summary
layout**. Same shape as the bug §29 found on the way OUT of the walk, on the way
in. The asking now lasts `walkSettleMaxMs`, which is set to cover `walkHoldMs`
because that is exactly the window in which something can still put the camera
back on the pavement, and it stops on the first sample that arms.

## 45. What was verified this round, and how

`node scripts/verify/harness-drift.mjs` first: **31 scripts in each**, PASS. No
`<script>` was added, so `index.html` and `_harness.html` are unchanged.

Then a 22-item gate. Server `python scripts/serve.py 8815`, playwright-core from
`scripts/verify/node_modules` with an explicit `executablePath`, ONE browser,
390 x 844 at dpr 2, `?drift=0`, `window.cancelGraphicsAutoDetect()` at the top
of every page, the veil waited out, every screenshot taken twice.

```
1. The closed bar, JES -> WEL (no stairs, no crossings: no rail)
  PASS 1a phone rule for #wf-pill really in the CSSOM — left=12px right=12px transform=none width=366
  PASS 1b `Show route` on the closed bar, labelled — 106.2x44 at y220.44
  PASS 1c exactly ONE control costume in the whole bar — [".wf-act.wf-act-go"]
  PASS 1d rail down on this route, so the spine is up — spine 2x64.28
  PASS 1e spine, tick and ring on ONE axis — 32.50 / 32.50 / 32.50
  PASS 1f the spine reaches both marks — 138.0..202.3 vs 138.0 and 202.3
  PASS 1g #wf-headline.textContent unchanged
  PASS 1h #wf-sub.textContent unchanged
2. Walk it, and the during-walk view
  PASS 2a the walking readout is up — bar 131.9 px
  PASS 2b the spine is DOWN while walking
  PASS 2c the chained turn is not wearing a control costume — bg rgba(0,0,0,0), shadow none
  PASS 2d exactly ONE filled object while walking, and it is the manoeuvre disc
  PASS 2e the way OUT of the walk is on the bar
  PASS 2f #wf-sub.textContent is the same string in both states
3. The manoeuvre disc and its words, down the REAL route line
  PASS 3.0 the camera really walked the line — 16 distinct positions
  PASS 3a no glyph appeared with two different words — 16 samples, 2 glyphs, 0 contradictions
  PASS 3b the words really varied — [", then right", ", then left"]
4. PASS 4a hiding the wayfind layers changes the pixels under your feet — 5/5
5. PASS 5a a route WITH marks: rail up => spine down (PCL -> UNB, Stairs: 1 set)
6. PASS clip=1 / autopilot=1 / sliderdemo=1 — no wayfind element has a box

22 passed, 0 failed
```

**Watched failing on the code it guards.** The identical gate, same server, same
browser, run against this branch *before* the change: **18 passed, 4 failed** —
1d, 1e and 1f red (there is no `#wf-spine` at all) and 2c red with the amber
disc's computed style printed. Items 1a, 1b, 3a and 4a are the round-1, round-2,
round-4 and round-4 defects the brief names, re-asserted on the shipped build;
5a is round 5's.

Two honest notes about the instrument itself, both of which cost a run:

* **A placer that no-ops reads as a green gate.** The first cut read the route
  line off `map.getSource('wayfind-route')._data` — on this MapLibre the data is
  one level down, under `.geojson` — so the placer returned false, the camera
  never moved, and sixteen identical samples came back as "no contradictions".
  Item **3.0** exists to make that impossible: it counts distinct camera
  positions before 3a is allowed to mean anything.
* **The general costume sweep is set at 24 x 18 px** and `#wf-then2`'s disc is
  17 px, so item 2d did not see it — which is exactly why 2c names it. Lowering
  the threshold is a good idea for round 8; it was not changed this round
  because it would have re-run green without a matching watched failure.

The gate lives in the scratchpad rather than in `scripts/verify/`, because four
sibling lanes were editing the rest of `js/wayfind.js` at the same time and this
lane's ownership line for this round is `index.html`, `_harness.html`,
`style.css`, the UI half of `js/wayfind.js`, `shots/walk/ui/` and this file. It
is described above in enough detail to be rebuilt:

```
scripts/verify/_scratch-r7gate.mjs   (scratchpad copy)
  python scripts/serve.py 8815
  VERIFY_URL=http://127.0.0.1:8815 node _scratch-r7gate.mjs <outDir>

  __wfPlace(f) stands the eye at fraction f of the route's OWN drawn line
  (`wayfind-route`, the k:'path' LineString), facing 12 m further on, using the
  same closed form walkIt and doorwalk.mjs both use. Everything in item 3 and
  item 4 is posed with it.
```

## 46. Taste values added this round (CLAUDE.md rule 11)

`WF_UI`: `spineOn` true, `spineMinPx` 10, `walkSettleTailOn` true,
`walkSettleTailMs` 250, `walkSettleMaxMs` 10000.
Custom properties: `--wf-mk-gap` 6px (the mark-to-name gutter, named because
three rows now share it), `--wf-spine-w` 2px, `--wf-spine-col`
rgba(248,234,208,.20), `--wf-then2-ic` 15px.
**No new string.** `SAY` and `SAY_UI` are untouched, `#wf-headline`.textContent
and `#wf-sub`.textContent are byte-identical, and nothing new is claimed —
which, given §41, is the whole point.

### Shots

`shots/walk/ui/` — `r7-bar-before-after.jpg`, `r7-walkbar-before-after.jpg`,
`r7-summary.jpg`, `r7-walk.jpg`. Four frames, 260 KB. Every other frame this
round stayed in the scratchpad (CLAUDE.md rule 12).
