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
