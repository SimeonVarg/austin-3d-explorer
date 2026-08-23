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

## 2026-08-23 — the routes were already on the sidewalks; what was crossing the lawns was the last few metres to the door (`acer/w-sidewalks`)

Went in expecting to find the router ignoring the 1,324 sidewalk shapes the
scene draws, and that turned out not to be true — measured against every
polygon in the ground file, 99.9% of the walking network already runs over
pavement the city actually paints. The metres that were crossing grass were
the little straight lines from a building's door out to the nearest path. The
router had been treating those as if they were pavement, so whenever cutting
25 metres diagonally across a lawn saved 25 metres of real walking, it did it.
Burdine Hall was the clearest one: its front door has a path 2 metres away and
another 28 metres away on the far side, and the router kept picking the far
one, drawing a dashed line straight over the roof of the building.

So a door-to-path link now costs four times what a metre of real sidewalk
costs. The router will still use one when there is no alternative — it has to,
that is how you get out of a building — but it will happily walk up to four
extra metres of real pavement rather than invent one. Across twenty
class-to-class walks that cut the invented straight line from 485 metres down
to 164, and cut the metres of route sitting on grass or on bare ground from
308 to 124. Routes got 2.7% longer, which is the honest price and is the right
trade: they are longer because they are no longer taking shortcuts that do not
exist.

The second thing was smaller but it is everywhere. Sidewalks in the scene were
stopping a stride short of every street corner in the city — about 1.4 metres
of bare ground between the end of the pavement and the edge of the road, at
both ends of every crossing, roughly 2.2 kilometres of it in total. The bake
deliberately does not draw crossings (painting 800 crosswalks would put pale
ribbons across every street), but the kerb ramps at each end are not road
markings, they are the sidewalk. They are drawn now, and the resolver still
scrubs off anything that overshoots onto the road, so the streets look exactly
as they did. Ground file grew 50 KB compressed.

Together: 95.4% of a drawn route is on pavement now, up from 93.7%, and 98.6%
is on either pavement or a street it is legitimately crossing. Before-and-after
pictures of four routes and two street corners are in
`shots/walk/sidewalks/`, the full method and every number is in
`docs/walk-sidewalks.md`, and the biggest thing left is written up there too:
the malls and the Six Pack are plazas, the graph only knows their outside edge,
so routes walk around them instead of across — that one needs a change in the
graph bake, which is a different lane's file. `WAYFIND.on` untouched.
