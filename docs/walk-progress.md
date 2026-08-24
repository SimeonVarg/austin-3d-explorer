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

## 2026-08-23 -- critic pass on acer/w-door, round 2: the door numbers hold up, the stairs toggle does not

Re-ran scripts/verify/walkmeter.mjs myself, fresh server on a clean port, not
trusting the builder figure: 1,333 m of extra walking over the twenty pairs
before this branch, 96.2 m after; every one of the forty pair-ends lands within
15 m of the door UT itself publishes; mean worst-case door error across all 55
UT-surveyed buildings this build can route to, 29.1 m down to 2.5 m. The door
work is real and it holds. But driving the actual UI (not the wayfindRoute API)
found a break in the exact feature this round measured hardest: click "Avoid
stairs" in the route card and the whole panel snaps shut instead of turning the
toggle on -- the checkbox click bubbles up to the pills own click handler
(js/wayfind.js:1999), which flips state.expanded back to false and collapses
the card before the checkboxs change handler (js/wayfind.js:2225) can stick.
Confirmed three ways, including a real mouse click at the checkboxs exact
pixel coordinates: the box stays unchecked after you click it. The routing fix
behind the toggle is sound -- walkmeter drives it directly and it is clean on
9/9 buildings -- but a person who actually cannot climb stairs, clicking the
control Simeon asked for by name, cannot turn it on. Not shipped as-is.
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

## 2026-08-24 — the "Avoid stairs" box you could not tick, and one ruler instead of two

Branch `acer/w-door`. Last round's critic found that the routing behind "Avoid
stairs" was right and the checkbox was unusable, and that turned out to be exactly
true: clicking it shut the panel and did nothing else. Clicking anything inside the
answer card was being read as "close the card", and a checkbox only reports itself
after the click has finished travelling — by which time the card, and the checkbox
with it, had already been thrown away. Fixed, and photographed both ways: on the walk
from Will C. Hogg to the Tower, ticking the box now takes you from a 260 m walk with
a set of steps in it to a 170 m walk with none. The box was hiding a route that is
ninety metres shorter. The panel still opens and closes when you click its own text —
that is now checked too, because it was the obvious thing to break.

The other half was tidying. Two different lanes had each built a thing called
`walkmeter.mjs` measuring two different quantities, which is worse than having none.
They are one script now, on one list of twenty walks, reporting both numbers: how far
out of your way the chosen door sends you, and how far from UT's own published
entrance you end up. Proof it lost nothing: pointed at an untouched copy of `main` it
reprints the baseline lane's headline to the decimal. Against the same twenty walks,
this branch takes the second number from 1152 m to 84 m, with all 38 measurable ends
now landing at the door UT draws on its own map (it was 7), and the first number from
+210 m of wasted walking to 277 m saved. Across every building UT surveyed, the worst
door the router might pick is 2.5 m out, down from 29.

Also re-pulled UT's entrance data live to be sure we are still scoring against what
maps.utexas.edu actually shows: identical, line for line, to the table we ship — the
only "new" row is a duplicate UT has of its own Will C. Hogg entrance. And one honest
finding written down: the door score can be driven to a perfect zero by never using
our own modelled doorways at all, which would score better and look worse, so it was
not done. `WAYFIND.on` untouched.

## 2026-08-24 — critic pass, door round 4: it wins, but avoid-stairs strands a real building

Judged fresh, no memory of how hard round 4 was to build. Checked out
`acer/w-door` on its own port (8851), drove the live page with `?walk=1`, and
did not take a single number on faith.

Re-ran `scripts/verify/walkmeter.mjs` myself, `--baseline`, against the live
server: it reproduced the branch's own claim to the decimal — route-length
extra 795.3 m -> 162.1 m, door-offset extra 1151.6 m -> 83.7 m, every one of
20 pairs ends within 15 m of UT's own published door (38/38, up from 7/38),
self-check drift 0.00 m on every measurable pair. Then went further than
trusting the script: pulled `Celebrated_Entrances_view` straight from UT's own
ArcGIS endpoint myself, live, for four buildings the app claims to know exactly
(WCH, MAI, WEL, CAL) — every coordinate the app reports off `wayfindUTDoors()`
matched the live UT feed to six decimal places, and the two buildings the app
reports as unsurveyed (CBA, UNB) really do have zero rows in UT's own layer.
The door data is not fabricated or stale.

The checkbox: wrote my own Playwright script from scratch (not walkmeter's own
UI-gate code) and clicked the real `label.wf-toggle input[type=checkbox]` at
its real pixel centre on WCH->MAI. Screenshot before: unchecked, "3-5 min walk
· 260 m · Stairs: 1 set". After one real click: checked, "1-3 min walk · 170 m
· No stairs on this route". Click again: unchecked, back to 260 m and Stairs: 1
set. It works, independently confirmed.

**oursWins = true.** Every one of the three bars in the brief — extra metres
to the door a student would use, agreement with the door maps.utexas.edu
itself presents, and a checkbox that actually avoids stairs — beats what
shipped before this round by a wide margin, and I obtained the maps.utexas.edu
bar myself rather than accepting the branch's account of it.

**The gap that should be next**: "Avoid stairs" doesn't just fail to help for
some buildings, it actively stops working for at least one real one. Routing
to CMB (Jesse H. Jones Communication Center - B, an occupied campus building)
with the box unchecked works fine from three different hubs (GDC, PCL, UTC —
790 m / 1.1 km / 1.1 km, 1-2 stair sets). Tick the box on any of those three
and the API returns `{ok:false, why:"noroute"}` — and the real UI, driven with
a real click, shows the user "No walking route found" (screenshotted:
the pill card, GDC to CMB, after clicking Avoid stairs for real — kept only in
the session scratchpad, not committed). This is a dead end a step-free user
can actually hit, not a hypothetical: CMB is one of the buildings the branch's
own round-4 commit already named as still stranded (`stranded before: CMA CMB
JGB MAI after: CMB`), but "the checkbox works" and "the checkbox strands you at
a real building" are two different claims and only the first one got
screenshotted before this round shipped. Next round should trace CMB's
step-free component specifically — which edge or door is cutting it off from
every hub — rather than re-sweeping the global tuning constants, which are
already documented as tried.

Server on 8851 stopped and confirmed free after this pass. No file this branch
owns (`js/wayfind.js`, `data/*`, `scripts/bake_entrances.py`) was touched.

## 2026-08-24 — the last building "Avoid stairs" refused to take you to

Branch `acer/w-door`, round 5. Last round's critic passed the work and then
found one real hole in it: tick "Avoid stairs" and ask for a walk to the Jesse
H. Jones Communication Center B, and the app said "No walking route found" — for
a walk it happily gives you with the box unticked. That is the one person on
campus who cannot just take the steps, being told to go away.

It turned out not to be about that building. The rule we wrote two rounds ago
made sure that when we *invent* a destination point we hang it somewhere a
person can actually reach without steps. It never asked the same question of the
doors we already had on file. Jones B has four of them; the one sitting closest
to the entrance UT publishes — three metres away — opens onto a courtyard whose
every way out, as far as OpenStreetMap knows, is a staircase. So we offered
exactly one door, it was a door nobody could get to, and the router did the only
thing it could.

The fix is a subtraction, not an addition: with the box ticked, a door is only
offered if you can actually walk to it. Nothing else changed — every one of the
twenty test walks measures the same to the decimal, and not one of the 158
buildings routes differently with the box unticked. What did change: the app now
gets you to every single building UT has surveyed without stairs, 56 of 56, up
from 55. Jones B is a ten-to-fifteen minute walk that ends at the east entrance
UT's own accessibility survey certifies — with the last forty metres drawn
dashed, because we genuinely do not have a path mapped there and the card says
so out loud.

Two things this round claimed and then took back, both caught by driving the app
instead of reading it: two other buildings we thought we had rescued had never
been broken (a widening rule was already covering them), and the first "before"
photograph turned out to be the loading screen with the map still four layers
from ready. Every picture now waits the loading screen out and counts how many
pieces of route actually got painted before the shutter — 83 in the after frame,
zero in the before. Also tried and thrown away: sending step-free walkers round
to Jones B's other, reachable door. It fixes that one building and drags
eighteen others 12 to 34 metres off the entrance UT publishes, which is the
exact complaint this whole lane exists to fix. Pictures and the full table are in
`docs/walk-door.md` round 5. `WAYFIND.on` still false.

## 2026-08-24 — the door lane, round 6 (`acer/w-door`): one way in became eight

Round 5's critic came back empty, so this round went hunting for its own gap.
It turned out not to be about which door the app walks you to — that part has
been right since round 4 — but about how you walk up to it. When UT publishes an
entrance our own data never mapped, the app builds a target at UT's coordinate
and hangs it on the single nearest bit of pavement. One bit. So no matter which
direction you were coming from, you had to reach that one spot before you could
reach the door, and the walk went round the houses to get there. Every real door
in the city already gets several — the app picks whichever suits your walk — and
this was the only kind of door that did not.

It does now. Across every UT building, walked from three different starting
points in both modes — 416 trips — 127 of them got shorter, five got a few metres
longer (the router will trade a little pavement to skip a road crossing, and
always has), none broke, and about a kilometre and a half of walking came off the
total. On the twenty measured pairs the extra walking the door choice costs you
fell from 162 m to 142 m and the credit it earns you went from 277 m to 354 m,
while the door you arrive at did not move by so much as a centimetre — same
entrance, better approach. The best single case is in the pictures: from the
University Teaching Center to Garrison Hall, 320 m and a staircase became 200 m
and no stairs, ending at the other entrance UT publishes on that building — the
one you were always closer to.

The part worth reading twice is what this round refused. Letting the app pick
freely among all the nearby pavement scored much better — 68 m of extra walking
instead of 142 — but the last few metres to one of these doors is a straight
dashed line over ground nobody has surveyed, and the further round the building
that line starts, the more of it goes through the building. That is the one thing
we are not allowed to do. So every one of those lines, on all 416 trips, was
measured against the real building outlines: unbounded, the number of walks whose
last stretch cuts through a building went from 70 to 115. Bounded the way it now
ships, it is 76. The better score was available and it was not worth the picture,
and the whole trade-off table is in `docs/walk-door.md` round 6 so the next person
can disagree with the call rather than rediscover it. The same measurement also
found that 23 of UT's 84 doors already had this problem before this round
existed, and wrote down the fix — it belongs in the entrance bake, not the router.
`WAYFIND.on` still false.

## 2026-08-24 — critic pass, door round (after round 6): it still wins, and the "UT door" it's scored against is sometimes the wrong point

Fresh critic, port 8851, no memory of how hard rounds 4-6 were. Re-ran
`scripts/verify/walkmeter.mjs --baseline` myself against a clean server on this
branch's HEAD (`994e705`, round 6): it reproduced the branch's own numbers to
the decimal — route-length extra 795.3 m -> 142.1 m, signed total +209.5 m ->
-354.3 m, door-offset extra 1151.6 m -> 83.7 m, 38/38 pair-ends within 15 m of
UT's published door, self-check drift 0.00 m, live UI gate PASS. Then drove the
checkbox myself through the real API and the real page: 250.7 m / 1 stair set
with the box off, 162.7 m / 0 stair sets on, and two real screenshots of the
real card (WCH -> Tower) with a real click in between — unchecked "3-4 min walk
· 250 m · Stairs: 1 set", checked "1-3 min walk · 160 m · No stairs on this
route · Avoids 189 mapped staircases." The checkbox genuinely avoids stairs.

**The gap.** UT's own `Celebrated_Entrances_view` carries two different
coordinates per row — a `Longitude`/`Latitude` attribute pair and a separate
point `geometry` — and this branch (rounds 1-6, `js/wayfind.js` and
`scripts/bake_entrances.py`) reads only the attribute pair. Queried the SAME
Experience Builder widget that maps.utexas.edu itself loads
(`experience.arcgis.com/experience/81d900a3c906482e9731a7a71eaaa178`,
layer `Celebrated Entrance`, id `194a972f836-layer-6`) directly through its own
`queryFeatures()`, live: for MAI the attribute pair is 30.286186/-97.739719 but
the point the map actually draws is 30.286023/-97.739757 — **18.5 m away**. For
EER, attribute 30.288143/-97.735633 vs geometry 30.288310/-97.735657 — **18.75
m away**. A 69-row sample of the whole layer (`Longitude`/`Latitude` present
and non-null) found 15 buildings 10 m+ apart between the two coordinates,
2 of them 20 m+ (MBB at 39.4 m), and only 19 of 69 under 1 m agreement. Round
4's "97/97 matched, worst 0.07 m" check never caught this because it compared
the branch's own copy of the attribute field against a fresh pull of the same
attribute field — an internal-consistency check, not a check against what
maps.utexas.edu actually renders on screen.

This means "38/38 ends at the right door" and "worst single pair 10.9 m" are
scored against the wrong ground-truth point for an unknown-but-real subset of
the 20 pairs — EER and MAI both appear in the headline pair set (EER->NHB is
the baseline doc's worst offender; WCH->MAI is walkmeter's own UI-gate pair).
**The fix**: in whichever bake/table-building step reads
`Celebrated_Entrances_view`, take the row's `geometry.x`/`geometry.y`, not the
`Longitude`/`Latitude` attribute fields, and re-run `walkmeter.mjs` to see how
much of the 83.7 m residual door-offset was real and how much was measurement
error.

**oursWins = true anyway.** All three bars in the brief — extra metres to the
door a student would use, agreement with the door maps.utexas.edu actually
presents, and a checkbox that actually avoids stairs — still land far ahead of
doing nothing, even accounting for a coordinate source that inflates the
precision claim by 10-20 m on a handful of buildings; none of it reverses which
side of the building the router sends you to. The through-building residual on
invented-door last stretches (76/619 legs, documented in round 6 as unchanged
and unfixed by this round) is real and already written up with a concrete fix
design in `docs/walk-door.md` round 6 §6 — still open, not this round's find.

Server on 8851 killed and port confirmed free. Touched only this file
(`docs/walk-progress.md`) — no file `acer/w-door` owns.

## 2026-08-24 — door round 7: the critic was right about the coordinate, and fixing it was worth 64 metres

The critic's find held up under a fresh check from scratch. UT's entrance layer
gives every door two positions — a pair of ordinary columns and the point the
map actually draws — and they are a median 2.7 m apart, fifteen buildings are
more than 10 m apart, and one is 39 m apart. Rounds 1 to 6 read the columns. The
map draws the other one, and two of the buildings that disagree are ends of the
headline pairs, so the lane had been marking its own homework against a point
maps.utexas.edu does not show. Switched to the drawn point: the extra walking the
door choice costs you across the twenty pairs fell from 142 m to **78 m**, the
credit it earns went from 354 m to **405 m**, and — the line that matters most,
because it cannot be moved by rewriting the table — the independent oracle whose
doors were matched by hand offline went from 434 m to **349 m** and from 15 to
**19** of its thirty ends landing on the right door. Still 38 of 38 pair-ends at
UT's own door, still 56 of 56 buildings inside 15 m, avoid-stairs still clean on
all nine buildings, the checkbox still passes a real mouse click each way, ruler
drift still 0.00 m.

What it did not do is make the doors better, and this round says so out loud
rather than banking a win it did not earn. Both coordinate fields were scored
against a referee neither of them controls — how far each sits from the wall of
its own building — and it is a dead heat: geometry nearer on 18 rows, the columns
nearer on 23, a tie on 25, 2.37 m against 2.58 m on average. There are pictures
of that in `docs/walk-door.md`: standing at each of the Main Building's two
candidate coordinates at eye level, the old one puts you square in front of the
monumental west entrance and the new one 18 m south on the plaza. We use the
published point because it is the published one, not because it is the better
door.

The interesting damage was elsewhere. Moving Jones Hall's door by **two metres**
knocked the building out of the app entirely — 0 m from UT's door became 59.9 m,
and nothing failed to say so. The cap that decides whether a door far from any
mapped path is still routable had been set to 58 because Jones Hall's own gap was
57, "plus a metre". A constant fitted to the last digit of one building's
coordinate. Rather than re-fit it, the whole distribution was measured with the
cap lifted: 38 of the 39 invented doors need 41.6 m or less, Jones Hall needs
58.8 m, and nothing at all lies in between. So this number decides exactly one
building and every value above 58.8 admits the same set. It now reads 75 — chosen
for headroom, not fit, with more slack than the worst disagreement between UT's
own two fields, so the next data refresh cannot silently strand a building the
way this one did. Jones Hall is back at 0 m. `WAYFIND.on` still false. Branch
`acer/w-door`.

## 2026-08-24 — critic pass, door round (post-round-7), oursWins=true

Fresh critic, port 8851, no memory of rounds 1-7. Did not read the diff first;
drove `?walk=1` cold, then checked the branch's own claims from scratch rather
than accepting them.

**Independently re-ran `walkmeter.mjs --baseline`** against a clean checkout of
HEAD (`8d32030`) served on 8851: it reproduced the round's own numbers to the
decimal against the "doors off" baseline (main, no correction) — route-length
extra 795.3 m -> 78.5 m, signed total +209.5 m -> -404.6 m, door-offset extra
1144.0 m -> 81.4 m, 8/38 -> 38/38 pair-ends within 15 m of UT's door, the
independent pair-file oracle 1080.3 m -> 349.0 m and 7/30 -> 19/30, mean
worst-case door error across all 55 UT-surveyed buildings 29.8 m -> 2.3 m,
17/55 -> 56/56 inside 15 m, self-check drift 0.00 m, live UI gate PASS.

**Independently queried UT's live `Celebrated_Entrances_view` layer myself**
(not through the branch's tooling — a raw `curl` against
`services9.arcgis.com/.../Celebrated_Entrances_view/FeatureServer/0/query`) for
EER and MAI, the two buildings the round's coordinate-source fix hinges on.
Both rows' `geometry.x/y` matched `js/wayfind.js`'s baked `UT_CELEBRATED` rows
for those codes to the sixth decimal (EER 30.288310/-97.735657, MAI
30.286023/-97.739757), confirming the branch is really reading the field
ArcGIS renders position from and not misquoting its own source.

**Drove the feature myself with a standalone Playwright script**, independent
of `walkmeter.mjs`, calling `window.wayfindRoute('WCH','MAI',...)` directly and
screenshotting the live 3D scene both times: unchecked gave `stairSets:1`,
"2-4 min walk · 230 m · Stairs: 1 set", a visible ribbon descending the Tower's
east side; checked gave `stairSets:0`, "3-5 min walk · 270 m · No stairs on
this route," and the ribbon visibly moved to the other side of the Tower in
the screenshot. The subject is on screen and the checkbox genuinely changes
which door and which path it draws, not just the label.

**oursWins = true.** All three things this piece is judged on beat doing
nothing by a wide, independently-reproduced margin, and the avoid-stairs
checkbox demonstrably avoids stairs on a real click through the real API.

**The single biggest remaining gap:** the independent pair-file oracle —
doors matched to UT's rows by hand, offline, so it can't be moved by rewriting
a table — still lands on the wrong door for **11 of its 30 ends (37%)** even
after this round's fix, and round 6's own diagnosis is almost certainly why:
23 of 84 UT doors have their nearest walkable node on the *far side of a wall*
from the door itself (`docs/walk-door.md` round 6 §6), so the router's last
stretch snaps to a node that can't actually see the door. That defect was
found in round 6, a concrete fix was designed (a per-door 24-bucket
"clear-reach profile" baked in `scripts/bake_entrances.py`, gating
`usableNodesNear()`), and it is still unbuilt three rounds later. Compounding
it: round 7 moved 54 of 97 doors by up to 39 m switching coordinate fields,
but the through-building residual on invented last-stretches (measured in
round 6 at 76 of 619 legs, 12%, using the OLD coordinates) was never
re-measured against the new ones — nobody knows today whether that number
went up, down, or stayed put. Next round should build the clear-reach-profile
fix (it is the highest-leverage undone item in the doc) and re-run the
through-building intersection check against the current baked table before
claiming that number still holds.

Server on 8851 killed, port confirmed free. Touched only this file
(`docs/walk-progress.md`) — no file `acer/w-door` owns.
