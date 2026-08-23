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

## 2026-08-23 — the walk now ends at the door a student actually uses, because UT publishes which one that is

Branch `acer/w-door`. Simeon's complaint was that routes take you to a farther
entrance than you have to go. They did. UT's own campus map publishes a
hand-surveyed list of the real front door of 67 buildings, and this build was
ignoring it — scored against that list, the door we walked you to was the right
one on 16 of the 55 buildings we can route to.

Across twenty class-to-class routes, the walk now ends **4.8 metres** from the
door UT puts on its own map, down from **66.6**, and every single one of the
forty doors is now within 15 m of UT's — it used to be seven of them. Across all
55 buildings the worst door the router might pick is 3.7 m out, down from 29.1.
Some routes got shorter by a lot: Waggener to Hackerman went from 537 m to
295 m. One got longer on purpose — Patterson to Biological Laboratories went up
94 m, because the old route stopped 62 m short of the actual door and left you
to find it yourself.

Three things did it. UT's survey now beats our own scoring wherever it exists.
Where UT names a door we never placed at all, the route goes to UT's coordinate
and snaps onto the nearest mapped path, with the last stretch drawn dashed and
counted like every other unmapped bit. And on the 228 buildings UT does not
cover, a side door is finally allowed to win when it genuinely saves a walk —
but only if it saves more than 55 m, which is what keeps the old back-door bug
from coming back. "Avoid stairs" also learned that a door can be up a flight
even when the path to it is flat, which is a thing UT records per door.

The bake was fixed too, so it survives: 30 doors relabelled and 47 doors placed
that we simply did not have. That part does not reach the router until
`data/walk_graph.json` is rebaked by the lane that owns it — one command, written
down in `docs/walk-door.md` along with the numbers, the pictures, a one-line
copy patch for the door caption, and the one thing not verified this round (no
walking-height photograph of a newly placed door; the ground-level poses died on
the watchdog with several other lanes on the machine). `WAYFIND.on` untouched.
