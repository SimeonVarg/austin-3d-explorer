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

## 2026-08-23 — round 2 of the door pass: the photographs that were missing, one more building reachable, and the thing that turned out not to work

Went back for the three things the last round left open. The doors it placed
from UT's survey had never been photographed from the pavement, so they are now:
the Main Building's west entrance, Biological Laboratories' west steps and the
Seay Building's southwest doors, all shot standing on the ground at eye height.
They are real modelled doorways with steps and glass, on the walls UT names.

Jesse H. Jones Hall was the one building the router still sent you to the wrong
side of, because its entrance is 57 metres from the nearest mapped path and the
old rule refused anything past 45. Rather than argue about it, we stood on the
path and looked: it is an open, paved courtyard between the building's two wings
with the door at the far end, nothing in the way. So the walk now goes up the
courtyard — 700 m to the right door instead of 830 m to the wrong one, with
those last 57 m drawn dashed and counted like every other unmapped stretch.

The Health Learning Building used to answer "we can't take you there", because
we hold no door on it at all and the code gave up before it checked UT's survey.
It routes now, both ways, to UT's own north entrance.

Across every building UT surveyed, the worst door the router might pick is now
2.5 m out, down from 3.7, and all 56 of them are inside 15 m — up from 54 of 55.
The twenty-pair number did not move, and was not meant to: all forty of its
doors were already right.

The interesting failure: the plan was to make the *guessing* better for the 228
buildings UT does not cover. So we held UT's answers out and used the 55
buildings it does cover as a marked exam paper for the guessing rule. Every rule
we tried scored between 27 and 31 metres, and even cheating — picking the best
door we hold — is still 18 metres out, because for 26 of those 55 buildings the
right door simply is not in our data. It is a missing-data problem, not a
ranking problem, and no cleverer rule fixes it. Worth knowing before someone
spends a week on a better guess. The same test does put a number on Simeon's
original complaint though: on a building nobody surveyed, the door we pick is a
median 95 degrees around the building from the one UT names, and 12 times out of
55 it is on the opposite side. Two other UT data sources were checked as
possible fixes and both turned out to be building centres, not doors.

Branch `acer/w-door`. Details, tables and pictures in `docs/walk-door.md`.
`WAYFIND.on` untouched.

## 2026-08-23 — door lane, round 3: the number is checkable now, and it caught a bug

The last two rounds got the walk ending at the right door and wrote the result
down. Read back hard, both had the same hole: **nobody else could check the
number.** The twenty pairs and the thing that measured them lived in a scratch
folder that no longer exists, so "96.8 metres" was a claim, not a measurement.
So the first job this round was to put the ruler in the repo:
`scripts/verify/walk-pairs.json` has the twenty walks and says why each one is
in the list, and `scripts/verify/walkmeter.mjs` drives the real page and scores
them. Anyone can run it now, and it prints the before and the after side by
side because it flips the switches itself rather than trusting an old note.
It comes out at 96.2 metres over twenty pairs against 1,333 before, and all
forty ends of those twenty walks are within 15 m of the door UT itself puts on
the map.

Then measuring the accessibility side found something ugly. **Every walk to or
from the UT Tower failed when you ticked "avoid stairs."** The card just said
"No walking route found." The reason is that the Tower's west entrance had been
attached to the nearest bit of pavement, which happens to be up on the Tower's
own plinth — and every way off that plinth is a staircase. Thirty-seven paths
you can reach from up there without steps, versus ten thousand seven hundred if
you're allowed to climb. So the walk was being started somewhere you couldn't
leave. Fixed: with the toggle on, a door now has to attach to pavement you can
actually walk away from step-free. That costs the Tower about four extra metres
of dashed line and gives back three buildings that used to be unreachable —
the Tower, the Music Recital Hall and Jackson Geosciences. Fifty-five of the
fifty-six UT buildings can now be reached without stairs, up from fifty-two.
The last one, the Jones communication building, genuinely can't: every door we
hold on it is up steps, and pretending otherwise would be a lie.

Pictures in `shots/walk/door/`: `stepfree-mai-before.jpg` is the Tower with "No
walking route found" on the card, and `stepfree-mai-after.jpg` is the same view
with a real step-free walk. `stairsdoor-par-off.jpg` / `stairsdoor-par-on.jpg`
show the toggle moving the Parlin Hall door 41 m from the east side, which UT
records as having neither a ramp nor an automatic opener, round to the west
side, which has both.

Two open questions from earlier rounds are now closed rather than open. Eleven
UT buildings don't route, and that turned out to be fine: ten of them are at the
Pickle research campus eleven kilometres north, outside everything this app
draws, and the eleventh isn't in UT's own campus register either. And Simeon's
sidewalk hunch got a real test — the idea that a footpath which dead-ends at a
building was built to reach its door. It doesn't work here, and the reason is
interesting: campus paths are a mesh, not a set of driveways. Out of eleven
thousand junctions only six hundred are dead ends, so "where the pavement stops"
barely says anything about where a door is. The sidewalks themselves are fine —
92% of them are one connected step-free network. It's the doors that are
missing, which is the third experiment in a row to land there.

Branch `acer/w-door`. Tables, the full harness output and the reasoning are in
`docs/walk-door.md`. `WAYFIND.on` untouched.
