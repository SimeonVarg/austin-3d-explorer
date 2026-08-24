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

## 2026-08-24 — `acer/w-sidewalks` round 4 critic: it wins, verified independently

Reviewed `acer/w-sidewalks` (round 4 of 5, HEAD `6c50c1d`) against `origin/main`
as the bar, on the two things the brief actually asks for — is the router on
real pavement, and does the drawn ribbon look like it's on real pavement.
Nothing taken on the builder's word; every number below was re-run by hand and
every picture below was looked at directly, blind where a visual call was
being made.

**The number, re-measured.** Swapped `data/ground.geojson` for `origin/main`'s
own file and set the audit's link-cost constant back to 1.0 (what `main`
actually ships), then ran the branch's own `scripts/bake_ground.py
--walkaudit` against it — the same tool, pointed at the bar instead of taken
on faith. On the harsher "house twenty" fixture: pavement coverage
(`ON A DRAWN WALK`) goes **85.71% → 96.83%**, bare ground **7.52% (695 m) →
1.63% (154 m)**, and share of each route running on a real OSM footway
feature rather than an invented line goes **95.38% (mean-per-route 93.07%) →
97.46% (mean-per-route 95.53%)**. The 8.24 km "sidewalk painted as street"
defect independently reproduced too: main's own file carries 8.27 km of
non-crossing surveyed sidewalk with carriageway paint under it; the branch's
is 0.07 km. All four numbers matched the doc's own claims to within rounding.
`walkmeter.mjs` was also run against the branch and is NOT a fair second
opinion here — its self-check (browser vs. its own Dijkstra reimplementation)
fails on 14 of 19 pairs with drifts up to 38 m, because that script was built
for `main`'s router and doesn't know about this branch's `LINK_COST_MULT`; its
"903 m extra" figure is a different, uncalibrated instrument and was not used
to judge this round.

**The picture, checked blind.** Took my own screenshots of both `main` and the
branch at `?walk=1`, plus a blind shuffle of the branch's own committed
before/after pair at a street corner (kerb apron). Pixel-diffed rather than
eyeballed at low res, which caught me misreading the corner on first look —
zoomed in, the apron is a real, if narrow (0.9–1.8 m), strip of paving that
appears at every crossing corner and along the Robert Dedman Drive kerb where
the ribbon used to sit directly on bare asphalt with a lane-marking dash for
company. It's a genuine geometry change, not a screenshot that happens to look
different.

**Verdict: ours beats the bar, not a tie.** Decisive margin on the measured
axis (+11 pts pavement coverage, +2 pts provenance, an 8 km defect closed to
0.07 km), and the visual claim holds up under blind, zoomed inspection rather
than just at a glance.

**Biggest gap left, concretely:** ~2.1% of the twenty routes' drawn ribbon
still stands on a marked street crossing, and there `WAYFIND.routeBaseM` =
0.22 m (right for a paved path) leaves the ribbon floating 22 cm above the
`roadarea` fill, which sits at z=0. Painting more pavement can't fix this —
crossings are deliberately never painted as pavement (§2's own argument). The
fix is a per-feature base picked in `ribbonPolys()` in `js/wayfind.js`: use
0.22 m over a `patharea`/mall/rim segment, 0 m over a `roadarea` crossing
segment. Every sibling lane is currently in `js/wayfind.js`, which is
presumably why this round left it alone three times running (§10, §14, §26)
— it should be the first change made once the file is free.
