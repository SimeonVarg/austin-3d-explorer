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
