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

## 2026-08-23 — stairs: the route now says where they are, and offers a way round them with the price on the button

The walk feature already knew about every staircase on campus and was only
telling you how many. Ask it to walk from the Art Building to the Tower and it
said "Stairs: 7 sets" and gave you a checkbox — seven flights, no idea where,
and a filter you could only understand by ticking it.

It now lists them, in order, the way a transit app lists a leg: which flight,
how far into the walk, and which building it is beside ("620 m in · near WEL").
It says "up the steps" or "down the steps" where OpenStreetMap has recorded
which way is up, and plainly says it does not know on the rest — that is one
flight in eight today, and it is a bug in the graph bake rather than missing
data, so `docs/walk-stairs.md` carries the exact patch to nearly double it.

The bigger change: when a route has stairs, the card now works out the
step-free route without being asked and offers it as a button with what it
costs — "Step-free: 14–19 min · 1.2 km / Avoids all 7 sets · 250 m further".
Nine routes in ten that have stairs get one. The other one in ten gets an
honest sentence saying there is not one, said properly rather than buried in
grey. Under step-free it will now use any door rather than insisting on the
front one, which is what UT's own accessible-entrance data says is right, and
which on its own rescued 21 of the 300 routes we tested from having no answer
at all and halved the typical detour.

Every offered step-free route is checked against the graph before it is shown —
112 of 112 contained zero steps — and the check can be watched failing on
demand. Two claims got quietly corrected while we were in there: the card used
to say it avoided 189 staircases when 21 of those sit on paths the router
cannot reach in any mode (168 now), and one line contradicted the number
directly above it. And a defect that every number said was fine turned up in a
screenshot: the step-free button offered a route and then landed on "no route".
Fixed, and there is an assertion for it now.

Branch `acer/w-stairs`. Pictures in `shots/walk/stairs/`, the full record in
`docs/walk-stairs.md`. `WAYFIND.on` untouched; with the feature off the app
makes byte-identical requests to before, checked.
