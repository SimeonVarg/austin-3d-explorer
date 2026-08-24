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

## 2026-08-23 — the stairs: one was drawn nowhere, and "avoid stairs" was walking people over them

Went after the stairs. Three things were wrong. First, the city was drawing 188
of the 189 staircases OpenStreetMap has mapped on campus — the missing one, on
the plaza at the north-west corner of the PCL, is tagged as a stepped *area*
rather than a stepped path and was falling through a gap in the bake, so the
router happily sent people up a flight the city drew nowhere. It is drawn now,
and every drawn staircase carries the OSM id it came from, so "the route has 3
sets of stairs" and "here are the stairs on the ground" can be checked against
each other by name instead of by eye. That also settles the 179-versus-189
confusion: they were always the same staircases, because touching flights merge
into one drawn shape.

Second, and this is the one that mattered: the **Avoid stairs** toggle was
lying. A walk is the mapped path plus two straight lines we draw ourselves from
the path to each door — and on four buildings (the Computation Center,
Magnetics, Studio Art, CS3) that last line runs straight over a flight of steps.
Out of 140 routes where the app offered a stairs-free way, 11 of them still
walked over a staircase. Batts Hall to the Computation Center was the worst:
ticking the box changed nothing at all, and the card said "No stairs on this
route" while the last thirty metres went down a flight. The avoiding route now
refuses to arrive at a door it cannot reach without steps — it costs 32 more
metres on that one, and 11 of 11 are clean now with no route lost.

Third, you had to know the toggle existed. Every route with stairs on it now
works out the way round at the same time, checks it really is stairs-free, and
hands it back with what it costs — and when there genuinely is no way round
(about one stair route in six) it can say that instead of offering nothing. The
route also now knows *which* staircases it uses, where along the walk each one
starts, and which way you are going over it where OpenStreetMap says. That costs
about a millisecond. The interface for it is written out ready in
`docs/walk-stairs.md` for whoever owns the card — four lanes are in that file
this round and I stayed out of it. Pictures in `shots/walk/stairs/`.
Branch `acer/w-stairs`.

## 2026-08-23 (later) — the stairs, part two: the card now shows them, and the way round is a button with the price on it

Part one put all the facts on the route and left the interface for whoever owned
the card. Nobody did, so this is that — plus four things that only turned up
once there was something to look at.

Ask it to walk from the Art Building to the Tower and it used to say
"Stairs: 7 sets" and give you a checkbox. It now lists them, in order, the way a
transit app lists a leg: which flight, how far into the walk, and which building
it is beside ("620 m in · near WEL"). It says "up the steps" or "down the steps"
where OpenStreetMap has recorded which way is up, and plainly says it does not
know on the rest — that is one flight in eight today, and it is a bug in the
graph bake rather than missing data, so the exact patch is written down.

The way round is now a button with its cost already worked out — "Step-free:
14–19 min · 1.2 km / Avoids all 7 sets · 250 m further" — and when there is no
way round it says so in plain sight rather than in grey footnote text.

Four things the pictures and a 300-route sweep caught:

The offer and the button disagreed. It offered a step-free route on Art Building
→ Tower and then answered "no route that avoids mapped stairs" when you pressed
it. Every number was green while that was on screen; it was found by looking at
the screenshot. There is one step-free implementation now and one assertion that
says so.

Ticking "Avoid stairs" folded the card shut on the same click, so you turned it
on and the answer vanished. One line.

The card claimed it avoided 189 staircases when 21 of those sit on paths the
router cannot reach in any mode. It says 168, and the sentence above it that
contradicted the number is fixed too.

And the step-free route now uses any door rather than insisting on the ranked
front one — which is what UT's own accessible-entrance data says is right, and
which on its own rescued 21 of the 300 routes we tested from having no answer at
all and halved the typical detour. It still comes back to the front door when
the front door is within about forty metres of as good.

Pictures in `shots/walk/stairs/`, including the phone, since that is what he
judges it on. Branch `acer/w-stairs`.

## 2026-08-23 — critic pass on `acer/w-stairs`, round 1: the two checkable claims held, the third couldn't be checked

Independent critic, fresh context, own scripts (not the builder's — those live
in a scratchpad and aren't in the branch). Checked out `acer/w-stairs`, served
it on its own port, drove the real `?walk=1` feature with playwright-core and
real Chrome, not the builder's word.

**Re-derived the two numbers from the raw files myself**, not from the docs:
counted `highway=steps` ways straight out of `data/osm_cache/footways.json`
(189, one of them — `147362093` — tagged `area=yes`) and cross-checked every
`u:"steps"` feature in `data/ground.geojson` (180 polygons, every one carrying
a `wid`, together covering all 189 way ids including the `area=yes` one). Both
match what the branch claims to the digit.

**Ran a fresh 250-pair census** with my own random seed, calling the branch's
own `window.wayfindStairs()` and then independently re-requesting the
avoid-stairs route for every offer to check it myself rather than trust the
card: 97 of 250 pairs had stairs, 84 got a step-free offer, and every single
one of those 84 came back clean on a fresh request — 0 that still crossed a
staircase, 0 where the offered distance didn't match what pressing the button
actually produces, 0 leg-list ordering bugs. Also drove the real UI by hand
(not the API): typed a route with 7 flights, pressed the priced "Step-free"
button, and the headline actually became "No stairs on this route" — and
clicking the "Avoid stairs" checkbox on an open card left it open, both fixes
holding under a real click. Screenshots (desktop + a 393×852 phone frame)
looked, not just asserted: the leg list, the priced button, and the honest
"avoids 168, not 189" caveat all render exactly as the branch's own doc says.

**What I could not check: the Citymapper bar.** The brief asks to judge our
leg list against how Citymapper states steps in its own — I have no device
running the Citymapper app and no web equivalent that produces a real
turn-by-turn leg list for a campus walk; Citymapper's own public pages
describe step-free routing in marketing language and never show the actual
leg-list format, so `docs/walk-stairs.md`'s own comparison table (§R10) is
against that marketing copy, not a captured screenshot. That half of the bar
was never actually fetched, by the builder or by me.

**oursWins: false** — not because anything I could test failed (nothing did),
but because one third of the stated bar was never obtained, and a pass on two
of three isn't a win on the bar as written. The gap for next round: get an
actual Citymapper leg list for a real walking route with stairs in front of a
person (a phone with the app, or a support/help-centre page that shows one)
and diff our card against it directly — until that exists, "matches
Citymapper's format" is asserted, not verified, and shouldn't be treated as
closed.

## 2026-08-23 (round three) — the stairs read like a transit app now, because we finally went and looked at one

The last round was marked down for one reason: we kept saying our list of
stairs was shaped "like Citymapper's" without anybody ever having seen
Citymapper's. So this round started by getting it. Citymapper puts screenshots
of its own app in its public newsroom, and two of them show a walking
direction close up. Their row is three lines: how far away it is, then what you
do, then the name of the thing you do it at — "in 25 m / Turn right onto /
Goldsmith's Row" — with the leg's own size on the right. A third picture, from
their step-free feature, does something we weren't doing at all: it **names the
door it's sending you to**.

So five things changed, all of them because of what was in those pictures.

The list of stairs now leads with how far along the walk each one is, and names
the building instead of its code — "in 630 m / Steps at Robert A. Welch Hall"
where it used to say "Up the steps · 620 m in · near WEL". Every one of 210
staircases across a 300-route sweep got a real name.

The way round now tells you where it puts you down: "Ends at the north side of
Jackson Geological Sciences Building" instead of "It uses a different
entrance." It works out the side from where that door sits among the building's
own doors, and stays quiet when the building only has one. Fifty of fifty
checked out. It deliberately does **not** copy Citymapper's wording ("Best
Step-Free Entrance") — what we checked is that the walk has no steps on it, not
that the door doesn't, and those aren't the same promise.

Three things were only visible by looking at the picture, which is the whole
argument for taking one. The Art Building approach was printing three
near-identical rows in a row — three real staircases, but one thing you
actually do — so they're one row now that says "3 sets of steps". Anything
past 950 m was rounding to "1.1 km", so two different flights twenty metres
apart read as the same row twice. And the card was calling the same building
by its full name at the top and by its three-letter code four lines down.

While measuring the phone I found something bigger and it isn't the stairs'
fault: **the walk card is half the width of the screen on a phone, and runs
about eighty pixels off the bottom.** It's one CSS line — the card is pinned at
the halfway mark and then slid back, which leaves it only half a screen to grow
into. Fixing it makes the card 369 px wide instead of 197 and 634 px tall
instead of 926, so it fits with room to spare. That file belongs to another
lane, so the exact two lines are written down in `docs/walk-stairs.md` §R15
with the before-and-after pictures rather than made here.

Last thing: the safety check that stops a "step-free" route being offered when
it isn't really step-free had never been watched failing properly. Turning the
old switch on made the check *withhold* every bad route, which is it working —
green, not red. So there's a second switch now that removes the check itself,
and with it off the sweep reports 49 bad routes out of 55. That's the number
that check is standing between this feature and the person it's for.

Everything green: eleven checks over 300 routes, fourteen more that click the
real buttons. `WAYFIND.on` is still false — none of this is public yet.
Pictures in `shots/walk/stairs/` (`r3-*`). Branch `acer/w-stairs`.

## 2026-08-23 — the "avoid stairs" answer was walking people down steps, and the check meant to catch it couldn't see them

Every time this feature has said "no stairs on this route", it checked that
claim against the same file it built the route from. This round checked it
against two different files instead — the raw OpenStreetMap survey, and the
staircases the map actually draws — and the claim did not hold up. Out of 122
step-free walks offered across 300 routes, **nine ended by walking along a
mapped flight of steps**, and five more routes said "no stairs" while crossing
one. All of them had passed every test the feature had.

The reason is small and a bit silly. A route is the surveyed path plus two
straight lines we draw ourselves — from the pavement to your starting door, and
from the pavement to the door you're going to. The test asked "does that
straight line *cross* a staircase?", which works fine for a staircase you cut
across and fails completely for one you walk *down*, because a line running
along a flight never crosses it. It also treated a staircase as having no width
at all, when the map draws it three metres wide. So the worst case — the last
stretch to the door running straight down a flight of steps — was the one case
the check was incapable of noticing.

It now measures whether the last stretch lies *along* a staircase, using the
same three-metre width the map draws. Nine false promises became zero, and it
cost two offers out of 122. There is a picture of it: same camera, one setting
flipped — the dashed last stretch coming out of the middle of a lit staircase
while the card cheerfully says "No stairs on this route · no further to walk
than the route with stairs", and then the same view with the walk gone
elsewhere. Two of the four things fixed this round were only ever going to be
found by looking at a frame; the numbers were green for all of them.

Fourteen routes of 300 now have no step-free answer at all, up from seven. That
is honest rather than good — those are buildings whose only doors can be
reached only by stepping over a staircase, and the card says so plainly instead
of offering a walk that does not work. Also written down rather than fixed: the
headline still reads "No stairs on this route" on a card whose own body says
the last stretch crosses one. That line belongs to another lane, so the exact
one-line change is in `docs/walk-stairs.md` §R23. The whole test harness is now
written into that file too, so the next person can re-run every number in it
instead of taking my word for any of them. `WAYFIND.on` is still off; nothing
here is public yet. Branch `acer/w-stairs`.

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

## 2026-08-24 — "there's no step-free way there" was the one thing we'd never checked, and five times in fourteen it wasn't true

Every round so far checked the walks the app *offers* — is this really
step-free, does it really avoid the steps. Nobody ever checked the walks it
*refuses*. When the app says "no step-free route we can find between these
two", that's a much bigger claim than it looks, and it's said to the one person
who can't just go and try it. So this round went and looked.

Built a second, completely separate map of campus straight out of the raw
OpenStreetMap files — every staircase deleted — and asked it, for each of the
fourteen refusals, whether a step-free walk existed anyway. It did. Fourteen
times out of fourteen. (The check earned its keep by failing its own sanity
test first: before it was allowed to accuse anything it had to independently
find the walks the app *had* found, and the first version only managed 111 of
120. Two bugs in the checker, both fixed, then 120 of 120.)

Then the harder question: is that the app's fault or the map data's? Asked the
same thing of the app's own map, and **five of the fourteen were the app's own
fault**. All five were Gearing Hall. It has two doors; both of them are pinned
to a little dead-end scrap of path whose only exit is a flight of steps. Block
the steps and the app is stuck on that scrap, so it concludes there's no way to
the building at all — while the real step-free path runs thirteen metres away.

Fixed by letting a walk leave the path network somewhere other than the two or
three spots the data pre-picked, and **only** as a last resort when the normal
search has already come up empty, so nothing that works today changes (checked:
all 120 existing step-free walks come back identical). The headline case is
Pharmacy Building to Gearing Hall: it used to say there was no step-free way,
and there is one — **eleven metres longer**. Screenshots of the card before and
after are in `shots/walk/stairs/`.

The first attempt at that fix was worse than the bug: three of the five new
walks drew their last stretch **straight through a building**, up to fourteen
metres of it. Caught it by measuring every one of those lines against the real
building outlines, then swept how far the search is allowed to reach and picked
a distance from the middle of the range where all five walks work and none of
them clip a wall. (Uncomfortable thing that fell out of the same measurement:
about one door-line in ten on *every* walk this app draws already cuts through
a building. That's older than this feature and belongs to the map-building
script, but it's written down now instead of nobody knowing.)

The nine refusals left over are genuinely impossible on the app's map and
genuinely possible on the ground — three buildings (Flawn Academic Center, the
Littlefield Home, Texas Student Housing) are marooned on islands whose only
links to the rest of campus are staircases. That's four specific missing
connections in `scripts/bake_walk.py`, written up with the exact IDs for
whoever owns it. Also re-checked the thing this lane is judged on first: all
189 mapped staircases are still drawn, none missing, none invented. The feature
is still switched off; nothing here is public yet. Branch `acer/w-stairs`.

## 2026-08-24 — Stairs, round 6: the walk was step-free and the door at the end of it was not

Every check this lane has ever run stops at the threshold. We prove the route
doesn't climb anything and that our own last straight line doesn't lie on a
flight — and then we deliver somebody to a door nobody ever asked about. UT
publishes the answer itself: for 98 celebrated entrances it says outright
whether each one is barrier-free, and where it isn't, it says why. Gearing
Hall's reads "Access is off 24th Street **up the stairs** and through the
courtyard." Our door sits four feet from that spot and is labelled the main
entrance.

Checked the step-free walks against that survey: of the 38 endpoints at a
building UT has surveyed an accessible entrance for, **20 were going to a
different door** — one of them 63 metres away, round the far side. So the
step-free pass now finishes the job: once it has a clean walk, it tries the
door UT actually names, and takes it if it isn't more than 150 m further. **29
of 38 now, for 353 metres of extra walking spread over 300 routes** — about
31 m on the ones it moves. Nothing that already worked got worse: the number of
walks offered and the number refused don't move at any setting, including with
the limit removed entirely.

The picture is Perry-Castañeda Library to the Physics building. Before, the
ribbon stops at the south side. After, on the same camera, it carries on round
to the north-east corner — which is the entrance UT lists as barrier-free.
Frames are in `shots/walk/stairs/`.

Two things it couldn't fix and one it shouldn't. Waggener Hall's accessible
door can only be reached over a mapped flight on our map, so refusing it is the
feature working. The Computational Engineering building's accessible door is
marooned on a 16-node island. And the big one, which belongs to the
map-building script and not here: **38 of the 60 accessible entrances UT
publishes have no door of ours within eight metres at all** — including Parlin
Hall, where the ramp UT describes simply isn't in our data, so every step-free
walk there arrives at the door UT flags. That list is written up with distances
for whoever owns it.

Also re-checked the thing this lane is judged on first: all 189 mapped
staircases still drawn, none missing, none invented, and all seven of last
round's checks still green. The stopwatch was thrown out — a route proved to do
zero extra work "slowed down" 72 % on a machine with five other lanes running,
which is what that number is worth today. The feature is still switched off.
Branch `acer/w-stairs`.

## 2026-08-24 — stairs, round 7: the app says "up the steps", and nothing used it

The card has always told you which way a flight goes — "up the steps", "down
the steps", off the direction OSM tags. Nobody had noticed that the part of the
app that *chooses* the route never looked at it. Walking up a hill and walking
down it cost the same, so every walk on campus came out identical in both
directions: over 300 pairs driven both ways, the distance matched **300 times
out of 300**, to the millimetre, including the 33 where the map says which way
is up.

The two pictures in `shots/walk/stairs/` are the whole thing. Same camera, same
two buildings, opposite directions. Going one way the walk comes down a 60-metre
flight beside Music Recital Hall. Going the other way, the old app climbed the
same flight — and the two photographs differed by **ten pixels**. Now the
reverse walk goes round the north side instead and the card reads "No stairs on
this route" for 62 metres more.

Eleven walks out of 600 changed. **Every single one got longer, none got
shorter, and not one picked up a staircase it didn't have** — eight dropped
one. Every flight anything walked away from is one the map tags as a climb;
there is nothing else in that list. Two of them are a 64-metre flight the router
swapped for a 6-metre one, which is a trade it simply couldn't see before. Total
extra walking: 449 metres spread across 600 walks, less than a tenth of a
percent.

The step-free walk did not move at all — 243 of them compared field by field,
zero changes, and the number of routes with no way round stayed at nine. Two
ordinary walks stopped touching stairs by themselves, so they no longer need an
alternative offered at all.

The price of a climb is the number that was already in the file — the same one
the time estimate has always used. Worth flagging for Simeon: **making it
higher keeps working.** Pushed hard, the router gets 32 of 34 climbs off the
route instead of 11, but people walk about 80 metres each to dodge flights as
short as two metres. That's a taste call, not a correctness one, so it's one
line to change and the whole ladder is written up.

Two things went red on the way and both deserved to. The pixel test was
measuring the city still loading — it claimed 193,000 "walk pixels" on a frame
where the real answer is about 9,800 — so a noise floor got measured first and
the test now refuses to shoot a scene that is still moving. And the stopwatch
was timing the wrong pair: it compared a route that *changes* between the two
settings, so it "proved" the new code made routing five times faster. Retimed
on a route whose answer is identical either way, it costs 0.06 ms on 7.6.

Re-checked first, before anything was touched: all 189 mapped staircases still
drawn, none missing, none invented, and all seven of round 4's checks still
green. The feature is still switched off. Branch `acer/w-stairs`.
