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
