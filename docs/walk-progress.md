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
