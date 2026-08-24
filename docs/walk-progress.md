# Walk feature — progress log

## 2026-08-23 — recon only, no code touched: UT publishes its own official front-door data, and our heuristic is currently wrong most of the time

Went looking for where students actually enter buildings before anyone writes
more entrance-picking code. The OSM side confirmed what the brief expected:
only 20% of OSM's campus entrance tags say `main`, and of the app's 295
buildings, 264 (89%) have zero OSM-sourced door data at all — every door on
them is a guess from the bake script.

The real find was somewhere nobody asked to look: UT Austin's own campus map
(maps.utexas.edu) runs on public ArcGIS data, and buried in it is a
`Celebrated_Entrances` layer — UT Facilities' own hand-surveyed record of the
real front door (and the separate accessible door, when it's a different
door) for 67 campus buildings, with barrier-free and auto-opener flags per
door. Free, public, no login. Checked it against what the app currently ships
as each building's "main" door: for the 66 buildings that could be matched,
the app's door was within 15 m of UT's real one only 27% of the time. The
other 73%, the correct door was already sitting in the app's own data,
placed right, just labelled "secondary" — so the router (which only ever
routes to a `role: main` door once a building has one) was structurally
blind to it. Worst case, Engineering Education and Research Center, sends
you 56 m past the real door.

Also settled the lighting question: `data/ground.geojson` really does have
no `lit` tags, confirmed — but the app already has 532 OSM-sourced street
lamps baked into `data/props.geojson` and just isn't using them for
anything route-related yet, so that's a wiring problem, not a missing-data
one. And the "avoid stairs" toggle already works for the walking path, it
just doesn't know a building's "main" door can itself be up a flight while a
barrier-free door sits on another wall — which UT's own data proves happens
on real buildings (Batts Hall, for one).

Wrote it all up with sources and a live-requeryable method in
`docs/walk-evidence.md`, including a ranked fix list for whichever lane
builds next: import UT's layer as a second source of truth alongside OSM
`entrance=main`, and stop collapsing near-tied derived candidates down to a
single door that's the only thing the router will ever consider. Nothing in
`js/wayfind.js` or the bake changed this round; `WAYFIND.on` untouched.

## 2026-08-23 — the walk interface, rebuilt for a phone: and the first thing found was that the last phone fix had been silently switched off by a comment

Went to make the walking UI good enough to put next to a real transit app at
phone size, took a picture of what we ship today at 390x844 first, and the
picture was worse than anyone thought. The answer bar was a 197-pixel column
jammed on top of the three buttons in the top row, its headline broken over two
lines, and `Show route` wrapping inside its own button. That defect had been
fixed once already — and the fix had stopped working, because the long comment
explaining it accidentally ended twice. CSS read the second half of the
explanation as the name of the rule, decided it was nonsense, and threw the
whole rule away. Everything below only became visible once that was repaired.

What the answer looks like now: the minutes are big, the building you are
walking FROM is printed (until now the app quietly guessed it from wherever the
camera was and never told you), and under the numbers there is a thin strip of
the whole walk with a mark on it for every staircase and every crossing, in the
right place along the route. So "three sets of stairs" stops being a number and
becomes "one near the start and two in the last third", which is the part you
actually plan around. The strip is deliberately flat — it is not a hill profile
and can never become one, we have no elevation data at all.

The part that a maps app cannot copy: when you are actually walking the route in
the 3D city, the bar changes on its own. It shows what is left rather than the
whole journey, an arrow that points at the next turn from wherever you are
facing, how far that turn is, and a dot travelling along the strip. It costs
nothing when you are standing still — it only recomputes while the camera moves.

The search panel got the boring, important things: rows big enough to hit with a
thumb, a visible highlight on the row the Enter key will take, four example
building codes to tap on a first run, a swap button, and a clear X in each
field. The placeholder stopped being cut off mid-word.

Checked by driving the real page, not by reading the diff: the feature still
adds absolutely nothing to the page when it is off, and nothing of it appears in
any of the three recording modes — the gate now walks every element the feature
owns rather than the three it used to name. Fifteen screenshots in
`shots/walk/ui/`, the whole write-up in `docs/walk-ui.md`. Branch `acer/w-ui`.
`WAYFIND.on` untouched.

## 2026-08-23 — walk UI, round 2 (Acer, `acer/w-ui`)

The walking view had an arrow that argued with its own words. It pointed at
where the next turn was, relative to whichever way you were facing — which is
true, and useless next to a line of text saying the route goes left. Photographed
on a phone: a big arrow pointing up-and-right over the words "then left". The
disc now shows the turn itself, and the top line of the bar is the next thing
that happens rather than the whole journey: "13 m, then left", with the minutes
left and the distance left on the line below. The code already knew which way
the turn went and was throwing the answer away two lines before it returned it.
A side effect: looking around with a swipe used to redraw the bar every few
degrees and now costs nothing at all, because nothing up there depends on which
way you face any more.

The other change you can see straight away: "Show route" is on the bar now
instead of hidden behind the little chevron. The camera never moves on its own —
that is deliberate — so the route the bar is describing can be completely off
screen, and until now the only button that would go and find it was also off
screen. There is one copy of it, it is thumb-sized, and it disappears while you
are walking the route because framing it from above is not what you want when
you are standing on it. On a building we cannot route to, it disappears too, but
"Clear" stays, so the bar is no longer a dead end.

Small ones that mattered more than they sound: the coloured marks on the route
strip had nothing anywhere explaining what a colour meant except a tooltip, and
tooltips do not exist on a phone — there is a one-line key now, and the stairs
colour sits inline in the sentence that already counts them. The stop-on-the-way
dot and the crossing dot were two blues six units apart and are now clearly
different. The door you should arrive at got a doorway icon and a bit more
weight, because which door is the one thing this app tells you that Google will
not. And the bar itself stopped pretending to be a single button while holding
five real ones inside it, which no screen reader could ever have made sense of.

One idea was measured and thrown away: padding the "show route" framing around
the answer bar so the route cannot hide behind it. Measured on three routes, the
plain version already puts 100% of the route below the bar, the bar-aware version
changed nothing, and the mirror-image version — pad the bottom instead, which
reads just as sensible — would have hidden half of the two longest routes. That
is written down above `fitTo` so nobody spends another round on it. It also
caught that the old screenshots were being taken before the camera had finished
flying, so every "here is the route framed" picture from round 1 was actually the
opening flight's end pose. This round's fifteen shots wait for the camera to
stop. Write-up in `docs/walk-ui.md`, shots in `shots/walk/ui/`. Branch
`acer/w-ui`. `WAYFIND.on` still false.

## 2026-08-23 — the walk now lists itself, step by step

The walking answer had a bar and a little map-strip of where the stairs and the
crossings fall, and it still had nothing that any other walking app has: the
walk written out in order. Open the details now and you get it — start, walk
33 m, turn right, walk 470 m, turn left, walk 24 m, Welch Hall, north side —
strung on one thread with the same marks the strip uses, so the picture and the
list can never say different things. Nothing in it is made up: it is the drawn
line measured, no street names (we have none) and no "turn left" orders, just a
description of the path already painted on the ground. Two things it learned
the hard way and both were caught by looking at the phone: it opened every walk
with "then a sharp right" before you had moved a metre — that was the little
straight line we draw from the door to the pavement, not a corner anybody has
ever turned — and on the way to DKR it listed twelve turns in 580 m, which is
describing the wiggle of the footpath rather than the walk. A turn only earns a
line now if there is real walking either side of it, and the distances still add
up to the total.

The rest of the round was the two views side by side with a real walking app at
phone size. "Show route" is a solid button instead of a tinted one. There is a
little walking figure in front of the minutes so the bar says what kind of trip
this is before you read a word. The stairs line stopped wrapping raggedly and
now always takes its own line. While you are walking, the bar lost a row and
gained a fact — the direction of the turn after the next one — and it is the
same height (196 px of 844) on every route now instead of 226 on some and 197 on
others. And the "13 m , then left" with the floating comma is gone.

Two defects were found only because the frames got opened and looked at: the
details card was long enough to run under the joystick, so the orange ring drew
straight through the middle of the step list, and two crossing marks on a long
route overlapped into something that looked exactly like an iOS toggle switch
sitting on the strip. The card is now measured against where the drive controls
actually are rather than a guessed number, and the two marks merge into one that
carries the count the card prints. Write-up in `docs/walk-ui.md`, seventeen
shots in `shots/walk/ui/`. Branch `acer/w-ui`. `WAYFIND.on` still false, so
none of this is on for anybody who has not asked for it by URL.

## 2026-08-23 — the walk interface, round 4: there was no button that put you on the pavement, so half the feature was unreachable

Lane `acer/w-ui`. The bar has always had two faces — the answer you read
standing still, and a different readout that appears once you are actually on
the route, with the next turn, which way it goes, and how much is left. Nothing
in the app ever put you on the route. Every picture of that second face for
three rounds was taken by a test script flying the camera down onto the line by
hand; a person holding the phone would have had to find the route from three
hundred metres up and fly down onto it themselves, with nothing telling them
there was anything down there to find.

So there is a **Walk it** button now, and it is the big one. Tap it and you are
standing on the path at eye height, looking down the walk. It is fussier than it
sounds: a building's front door is a point on its wall, and the app answers a
camera standing in a wall by lifting it onto the roof — so the button walks the
route outward until it finds ground with nothing over it, steps a few paces in,
and aims at a point twenty-five metres down the walk so a bend does not take the
path out of frame. Every one of those was wrong first and was found by taking
the picture and looking at it. **Show route**, which frames the line from above,
is the second button now, and **Clear** is an ✕.

Two other things. The little bar showing where the stairs and crossings fall
along the walk **was reading as a slider** — a thin track with a bright round
cap at one end, and while walking a white disc sitting in an amber fill, which
is a volume slider and nothing else. Thickening it did not fix it and neither
did colour. What fixed it is that every mark now cuts a notch clean through the
bar, so it comes apart into the stretches of uninterrupted walking between the
things that happen. No slider is segmented. And while you are walking, the bar
was carrying **two complete trip summaries stacked** — the second one counting
staircases you had already climbed. That row now says what is still ahead of
you instead.

The details panel is opaque now: it was 72 % glass over a rendered city and the
step distances were landing on bright grass.

Numbers, at phone size: after tapping Walk it on both test routes the eye is at
1.70 m, the walking readout arms, and the route covers **100 %** of the middle
of the lower half of the frame — measured by hiding the route, re-photographing,
and diffing, with an A/A control so a moving picture cannot fake it. Three
earlier ways of measuring that all gave wrong answers and are written up in
`docs/walk-ui.md`. The bar is 195 px walking, the same as before, having traded
a stale row for a useful one; no horizontal overflow anywhere; the feature is
still completely invisible in all three recording modes.

## 2026-08-24 — round 1 critic verdict on `acer/w-ui`: oursWins = NO

Fresh context, drove the shipped build on branch `acer/w-ui` (7 commits ahead
of the round-5 entry above) at 390x844 with a real Chromium
(`scripts/verify/chrome.mjs`, both SwiftShader and hardware GL), not the
builder's own screenshots. Confirmed the capture-mode hiding (`.clip` drops
`#wf-root` entirely; `.autopilot`/`.sliderdemo` leave it present but 0 of 64
descendants visible — clean) and re-ran `scripts/verify/walkmeter.mjs` against
this branch's own served app: 19/20 pairs measured, self-check held at 0.00 m
drift on every pair, 795 m total extra walking — same figure round `w-baseline`
reported off unmodified `main`, so nothing in this branch's routing regressed.

The finding that decides the verdict is not cosmetic. Traced `__fly.eye().alt`
every 500 ms after tapping **Walk it** on `JES → WEL` (an ordinary 530 m
class-to-class walk, not an edge case): the camera drops to 1.70 m (real
walking height) as it should, but across two of three independent runs it was
silently ejected back to 900 m — the exact altitude `Show route` uses — within
2-6 seconds, with no input from the user. The bar dutifully reverts to the
pre-walk summary the moment that happens (this is round 5's own "way out" fix
working correctly), but the net effect is that tapping the feature's headline
button, on a real route, does not reliably keep you walking. The two seconds
before ejection also render broken — a band of magenta and a flat olive-green
block cut across the top of the frame, consistent with the camera sitting hard
against or inside the building at the route's start (the same failure class
`scripts/verify/README.md`'s walking-suite section documents for the
*scripted* walker, whose `findStart()` searches outward for open ground before
placing the camera; `walkIt()` in `js/wayfind.js` does not appear to run the
same check before dropping the live camera at the route start). Reproduced
with `?walk=1&from=JES&to=WEL&fit=1&drift=0`, click `.wf-act-go`, sample
`window.__fly.eye().alt` every 500 ms — two frames cited,
`shots/walk/ui/r6-critic-eject-groundview.jpg` (t=2s, still on the ground,
glitching) and `r6-critic-eject-reverted.jpg` (t=4s, back at 900 m, `Walk it`
button restored, headline back to the whole-journey sentence).

Blind side-by-side against real Citymapper product screenshots (their own
"Turn-by-turn directions for Walking" post, phone-cropped) was still run for
the two requested views and it also does not go ours' way on its own terms:
Citymapper's pre-walk sheet has exactly one action (a single green **GO**
pill) and its during-walk view has exactly one instruction in a dedicated
full-width bottom card. Ours puts three same-weight actions (Walk it / Show
route / ✕) in one row of the closed bar and stacks current-turn + remaining
ETA + destination note + next-step preview + two buttons into a single
persistent top card while walking — denser and more capable (no-stairs and
entrance-side callouts Citymapper doesn't have) but not calmer, which was the
brief. That alone would be a real but arguable loss; the camera ejection is
not arguable.

**oursWins = false.**

**Single biggest gap, concretely:** `walkIt()` in `js/wayfind.js` places the
live camera at the route's start point without the open-ground clearance check
`scripts/verify/lib/walker.mjs`'s `findStart()` already does for the scripted
test walker (search outward for a point where `roofAt(p, 7 m) === 0` before
dropping to walking height) — so on at least one ordinary real route the
walking view renders broken for ~2 seconds and then self-ejects back to the
900 m aerial summary within 2-6 seconds of tapping the feature's own primary
button, with no user input. Port the same clearance search into `walkIt()`'s
start placement before this ships.

Not independently re-verified by me, corroborated only from the branch's own
round-5 writeup: the separate, already-documented "`Show route` puts up to
100% of some routes behind the answer bar" defect (measured by round 5, not
fixed, explicitly handed to whoever owns the camera). Still open.

Branch left as found — no files the builder owns were touched. Ran from a
worktree on port 8855, server killed and confirmed free, browser processes
closed, no scratch scripts left in `scripts/verify`. Two frames added under
`shots/walk/ui/` (114 KB combined) because this entry cites them; nothing else
written to the repo.

## 2026-08-24 — the baseline meter, built: 20 real class-to-class pairs, a real number

The recon above never got turned into an actual measurement before the run
that was doing it died (disk full, not a code failure). This picks that up.
Built `scripts/verify/walk-pairs.json` (20 real building-code pairs a UT
student would actually walk back-to-back — GDC→JES, WEL→PAI, and 18 more,
spread across campus, 5 crossing Speedway, 1 crossing the Drag, 2 confirmed
level-change routes) and `scripts/verify/walkmeter.mjs`, a reusable script any
of the five w-* lanes can point at their own branch to get the identical
measurement. Drove all 20 through the live app's own `wayfindRoute()` API
against unmodified `origin/main`, then compared each app-picked door against
the door UT Austin's own public entrance survey says is correct, using a
from-scratch Dijkstra reimplementation that self-checks against the app's own
reported numbers every single run (drift was 0.00 m on all 19 measurable
pairs this round — the one unmeasurable pair, PHR→BIO, is its own finding:
BIO's UT-verified door was never snapped to the path network in the bake at
all).

The headline number: **795 m of real extra walking**, summed only over the 6
pairs the current door mislabelling actually makes worse, worst single case
EER→NHB at +298 m (screenshotted, matches the measured number to the metre —
`docs/shots/walk-baseline-eer-nhb.jpg`). But the more useful finding for
whoever builds the fix: 9 of the other 19 pairs would get LONGER, not
shorter, if every building were simply forced onto UT's single verified door
— PMA→MEZ alone would get 231 m worse, because MEZ's two real, front-facing
doors sit on different sides of the building and PMA approaches from the side
the "wrong" door already faces. That's a live demonstration of exactly what
`docs/walk-evidence.md`'s own fix list warned about: collapsing a building to
one door, even a UT-verified one, isn't the fix — keeping near-tied
candidates open so the router picks per-trip is. Full writeup, the 20-pair
table, and the re-run instructions are in `docs/walk-baseline.md`.
`WAYFIND.on` still untouched; nothing in `js/wayfind.js` changed this round
either. Pushed as `acer/w-baseline`, self-merged after the self-check passed.

## 2026-08-24 — the walk interface, round 5: the door into the walk had no door out, and the little bar of the journey was still a slider

Lane `acer/w-ui`. Started by re-checking the four things the last rounds said
were fixed, on the shipped build, by driving the page rather than reading the
diff — the arrow that used to argue with its own words, "Show route" being
reachable without opening anything, no route opening with a turn onto a line the
app drew itself, and the phone rule that a doubled comment had once switched
off. All four hold, on three routes each where that made sense.

Then the two things that were wrong. Last round put a **Walk it** button on the
bar so you can stand on the pavement it just drew. Standing there, the only
button left on the bar was the ✕ — and the ✕ throws the route away. So the way
in was a trapdoor: tap the one control you can see and you are at eye level in
the middle of campus with nothing, and both buildings to type again. **Show
route** comes back while you are walking now; it lifts you out and the answer is
still there when you land. Tested end to end on two routes: the camera goes up,
the bar goes back to the whole-journey summary, the route survives and **Walk
it** is waiting again. Fixing that turned up a real bug hiding underneath it —
after the camera flew up, the bar sometimes kept showing the walking readout
from nine hundred metres in the air, and because the camera had stopped moving
nothing was ever going to correct it. It was stuck. It asks again now, a few
times, after any move that ends.

The other one: the little bar of the journey, with a mark on it for every
staircase and every crossing. On a route that has nothing on it — which is most
short walks between two neighbouring buildings — it is an empty band with one
bright round cap at the end, which is a volume slider and nothing else. That is
the third round in a row this one element has had to be argued out of looking
like a control, and the answer this time is to not draw it. If there is nothing
on the walk, the line above it already says so in words. The bar got a fifth
shorter on those routes (195 px down to 156 standing still, 133 while walking)
and did not move by a pixel on the routes that do have something to show.

Two smaller ones. The line that says **"Tight for a 15-minute passing period"**
was worked out once, for the whole walk, and never asked again — so three
minutes from the door it was still warning you about a walk you had nearly
finished. It is about what is left now, and it goes quiet as you get close;
measured walking down one route, it says it at the start and stops saying it
just under halfway. And the step-by-step list — the one thing this bar has that
looks like every other walking app — was behind a bare chevron in the corner
with nothing anywhere saying it was there. The chevron says **STEPS** now.

Photographed at phone size, six frames in `shots/walk/ui/`, and the bar was
checked at 320 px for the first time (it holds; the 21 px of overflow the page
reports at that width is not ours — it is identical with the whole feature
switched off). One thing measured and deliberately **not** fixed, written up
with the numbers: "Show route" frames every route from the same height, 900 m,
because the camera controller's ceiling is 900 m and the fit is asking for
higher — so on some bearings the whole route lands behind the answer bar. That
is not new and it is not the new button's doing (the old path does it too, on a
different route), and the fix is in the camera, which is not this lane's. An
offset on the fit was tried and measured and made it worse, same as round 2's
version of the idea. Branch `acer/w-ui`. `WAYFIND.on` still false, so none of
this is on for anybody who has not asked for it by URL.

## 2026-08-24 — w-ui round 6: the walk can keep the camera now, and the bar stopped looking like a segmented control

Picked up round 1's critic verdict on `acer/w-ui` and closed both halves of it.

**The ejection is real and I reproduced it 3 times out of 3** — tap `Walk it` on
`JES → WEL` at phone size, the eye drops correctly to 1.70 m, and two and a half
seconds later it is back up at 158 m with nobody having touched anything. But it
is not the defect it was reported as, and the reported fix would not have worked.
I logged every camera call in the page with its own stack, and the thing that
takes the camera away is **the opening title flight**: it is two legs with a
timer between them, `Walk it` stops the leg that is running and cannot stop the
leg that has not started, so leg two lands on top of the walk. On a deep link
with `&fit=1` there is a second one — the "frame the route" wait is watching for
exactly the quiet that `Walk it` itself produces, and it fits to 900 m, which is
the number in the report. The open-ground search the report asked for was
already there and working: probed at the walk pose, there is nothing over the
eye out to 2 m, and the nearest building mass is 4 m away, which is what a
pavement beside Jester looks like. The "renders broken, magenta banding" frames
are the same story — I re-shot that pose with every building layer hidden, then
every route layer, then every road layer, and the band is identical in all four:
it is the dusk sky and the flattened basemap seen at grazing angle, which is
forced, because the controller pins the camera's pitch to 84–88° at walking
height and a walking camera physically cannot look down. Handed to whoever owns
the sky.

**The fix is written the other way up: the walk owns the camera until you take
it back.** For nine seconds after the tap, anything that lifts the eye off the
pavement with no input in between gets undone; the first touch of anything at
all releases it for good, so it can never fight the person holding the phone,
and it gives up after three attempts rather than flicker. Before: ejected 3/3.
After: 4 runs, two with a real finger and two with a scripted click, still
standing on the pavement twelve seconds later with no input.

**The other half was the look, and the critic was right.** Three buttons in a
row — `Walk it`, `Show route`, `✕` — all wearing the same rounded box with the
same warm border. That is not three actions, it is the shape a phone uses for
one segmented control with three cells. The border and the panel came off the
two that are not the point, so there is now exactly one filled thing in the
whole feature and it is `Walk it`. Nothing is hidden and no word is lost —
`Show route` is still on the frame, still labelled, still a full-size touch
target. While walking, the same change removed a second amber object that had
been competing with the distance to your next turn, which is the only reason the
bar is on screen.

**And the entrance callout now arrives when you do.** `Entrances are on this
side` is the best thing this app says and it was printed for the entire six
minutes of the walk, where it is the longest line on the bar and not yet
something you can act on. It holds until about two minutes out and then appears,
with the building's name brightening beside it. The name is on the bar the whole
way, so nothing is lost.

Fourteen assertions, all green, including the four things the brief asked me to
re-check specifically (the arrow agreeing with the words, `Show route` being
visible, the walk not opening onto a line we drew ourselves, and the phone rule
that a duplicated comment terminator had once switched off), plus the feature
staying invisible in all three capture modes. Frames:
`shots/walk/ui/r6-bar-before-after.jpg`, `r6-walkbar-before-after.jpg`,
`r6-summary.jpg`, `r6-walk.jpg`, `r6-walk-approach.jpg`. Full writeup in
`docs/walk-ui.md` §35–40. Branch `acer/w-ui`, port 8815, server killed and port
confirmed free, no scratch scripts left in `scripts/verify`.

## 2026-08-24 — the walk bar reads as one journey again (`acer/w-ui`, round 7)

No critic came back this round, so I put our two frames side by side with real
Citymapper ones and judged them myself, at phone size.

**The one thing they have that we don't, we are not allowed to have — and that
is the right call.** Every Citymapper frame carries an arrival time: "Arrive
14:38" on the pre-walk sheet, "19 min / 14:38" while you walk. For a student
between classes that is the whole question. I was about to build it, and then
found this project's own honesty audit says in writing that we may never print
an arrival clock, because our minutes are a guess about somebody else's legs and
a clock turns a guess into a promise. So the gap stays open on purpose, and it
is now written down so the next round doesn't spend an afternoon rediscovering
it. The honest version of that answer is already on our bar and I think it is
better than a clock: "Longer than a 10-minute passing period."

**What was actually broken was ours, and we did it to ourselves.** Round 4 put a
little tick beside the building you start from and a little ring beside the one
you're going to, so the answer would read as one journey with a line between
them. Round 5 then deleted that line on every route with nothing on it — which
is most short walks — and nobody looked at what was left. What was left was two
stray marks two rows apart, with the middle of the bar set to a different left
edge, and the tick and the ring not even lined up with each other. It looked
like four unrelated lines of text.

The bar now has a spine: one hairline down the left, from the start mark to the
door mark, with everything about the walk sitting inside it. No new row, no new
word, nothing new claimed — just the two marks we already drew, joined. Before
and after: `shots/walk/ui/r7-bar-before-after.jpg`.

**And one thing on the walking bar was still dressed as a button that isn't
one.** "and then left" — the turn after your next turn — wore an amber disc in
the same row as two real buttons. Last round's rule was that only "Walk it"
gets a fill, and last round's test checked three buttons by name, so it could
not see this. It is a plain grey glyph now, and the test was rewritten to sweep
every element on the bar instead of a list somebody has to remember to update.
`shots/walk/ui/r7-walkbar-before-after.jpg`.

**Twenty-two checks, all green**, including the four the brief asked me to
re-confirm (the arrow agreeing with its words, "Show route" being visible, the
walk not starting on a line we drew ourselves, and the phone rule a duplicated
comment had once switched off), and the feature staying invisible in all three
capture modes. I also ran the same test against the old code first and watched
four of them go red, so they mean something.

**One thing I measured and did not fix, honestly:** tapping "Walk it" still
loses the camera roughly one time in five — the app's opening flight lands on
top of the walk a couple of seconds later and wins. I measured it before my
change and after, on the same machine, and it is the same on both, so I am not
claiming it. I did fix the half of it that is ours: the bar could end up showing
the summary while you were already standing on the pavement, because it stopped
asking where you were 720 ms after the tap and the camera doesn't settle that
fast on a busy machine. It keeps asking now.

Frames: `shots/walk/ui/r7-summary.jpg`, `r7-walk.jpg`, `r7-bar-before-after.jpg`,
`r7-walkbar-before-after.jpg`. Full writeup in `docs/walk-ui.md` §41–46. Branch
`acer/w-ui`, port 8815, one browser, server killed and the port confirmed free,
no scratch scripts left in `scripts/verify`. `WAYFIND.on` is still false.

## 2026-08-24 — round 8 critic verdict on `acer/w-ui`: oursWins = true

Fresh context, no memory of how hard round 7 tried. Checked out `origin/acer/w-ui`
at `806ad8f` into its own worktree, served it on 8855, drove the real `?walk=1`
feature at 390x844 in real Chromium — not the builder's screenshots.

**Camera fight (the round 1 critic's original finding): held.** Tapped `Walk it`
on JES→WEL and sampled `__fly.eye().alt` once a second for 14 straight seconds.
It read exactly 1.70 m on all 14 samples — never ejected. One run isn't the four
the builder logged, but it's a real, fresh, independent check and it agrees.

**Every specific claim in round 7's own writeup, checked, held.** The spine —
one hairline from the start tick to the door ring — renders correctly; closeup
at `shots/walk/ui/r8-critic-spine-closeup.png`. Exactly one filled control on
the closed bar (`Walk it`, `rgb(255,198,99)`); `Show route` and the "and then
left" next-turn glyph are both transparent-background, confirmed by reading
computed style off every visible button, not by eye. The feature stays hidden
(`display:none` on `#wf-button`/`#wf-sheet`/`#wf-pill`) under `?clip=1`,
`?autopilot=1`, and `?sliderdemo=1` — all three checked, all three pass.
`walkmeter.mjs` against this branch: 19/20 pairs, 0.00 m self-check drift,
795 m total extra — identical to `docs/walk-baseline.md`, so nothing upstream
of the UI broke either.

**The blind comparison, done for real this time.** Citymapper's own web app
(`citymapper.com/directions`, cookie banner rejected through its actual "Reject
All", not just accepted to get past it) turns out to have no live walking
navigation at all — a pure campus walk there is one line, "12 min · Show Map,"
thinner than anything on our bar. So the true bar — the GO-pill pre-trip card
and the "19 min / 14:38, turn left onto [street]" live card — was pulled instead
from Citymapper's own product blog,
`citymapper.com/news/2266/turn-by-turn-directions-for-walking`, which is the
first time this project has had the *actual* walking-specific screens instead of
a multi-modal marketing composite. Saved neutrally, shuffled, judged before
looking at the mapping: **ours preferred on both pieces.** Pre-walk: ours
carries entrance-side and stairs-on-route information Citymapper's card doesn't
have room for; during-walk: the first-person camera IS the orientation cue,
where Citymapper needs a 2D dot-and-cone to fake it. Real bar images at
`shots/walk/ui/r8-critic-citymapper-gopill-real.png` and
`-turncard-real.png` for whoever runs this next.

**The one gap Citymapper's real card has that ours structurally cannot close
without another lane.** Its turn card names the actual street — "Turn left onto
Rue de l'Échiquier" — twice. Ours never names a path anywhere, not on the live
bar and not in the expanded step list; it's distance-and-icon only ("24 m, then
right"). This is not a UI bug: `data/walk_graph.json`'s edges (`g.e`: `a b w f
s`) carry no name field at all, so there is nothing for `js/wayfind.js` to print.
Whoever owns the sidewalk graph needs to add a name to the edge schema before
any bar round can close this — it's the literal thing Simeon asked for
("sidewalks... identified properly and used to the advantage") and the one
thing the real bar visibly does that ours can't yet.

Ran `harness-drift.mjs` clean before starting. One browser, port 8855 confirmed
free after, no scratch scripts left in `scripts/verify` (six `_critic-*.mjs`
fetch/compare helpers were written and deleted in the same session). `WAYFIND.on`
untouched.
