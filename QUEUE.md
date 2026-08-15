# QUEUE — Acer lane

Rewritten 2026-08-04 from Simeon's fourth list. Everything above this in git
history is superseded. **The project has been submitted to the product manager.**

## The brief has changed — read this before anything

*"lets just not do those details for now. most of the timeframe u give for those
is spent me telling you things you got wrong and hand picking details for you to
add. i submitted this to the product manager so lets just focus on presentation
and performance now. so im gonna yap about things i want fixed instead of things
i want added"*

**PART G IS CLOSED.** Do not author more per-building facades. The judgement was
made and it was correct: the cost of that work is mostly HIM correcting it, which
is the opposite of what a submitted project needs.

**This round is FIXING, not ADDING.** Every item below is something already in
the scene that is wrong, or something about how the app presents itself. The few
that add geometry are there because a missing building reads as a bug (a stub
where the University Catholic Center should be), not because more detail is
wanted.

**And his standing instruction on verification, which is new and matters:**
*"dont just take my word for my recommendations, but also dont require hefty
verification to touch anything."* So: check that a thing is really what he says
it is before rebuilding around it, but do not build a measurement harness to
change a colour. Match the rigour to the risk.

---

## The traps that keep costing hours

1. **`python -m http.server` cannot test this site.** Use `scripts/serve.py`.
2. **A missing layer makes every metric look BETTER.** Verify with a picture.
3. **`node scripts/verify/harness-drift.mjs` before ANY pixel measurement**, and
   if you add a `<script>` it goes in BOTH `index.html` and `_harness.html`.
4. **`git pull` and confirm `0 0` against origin/main before you screenshot.**
5. **CAP CONCURRENCY AT THREE.** Eight agents froze the laptop for three hours.
6. **Do not run `git stash -u`** — it eats `scripts/verify/node_modules` and
   every script then dies with `Cannot find package 'playwright-core'`.

---

# PART K — AFTER THE FOURTH LIST. Run these once Part H/I/J have landed.

Ordered by what actually threatens the demo. **Mobile verification was #2 and is
CLOSED** — he tested on his phone 2026-08-04: *"i tested on my phone performance
is great and it looks amazing - only thing is the boost button is a bit off
visually but its great."* That removes the single biggest unknown in the project.

## K1. Measure performance and set a budget — THE TOP RISK

**Nobody has measured frame rate or load time in about thirty-five merges**, and
in that time the app has gained 3,015 road polygons (+445 KB on an untiled file),
thousands of trees, authored buildings, food trucks, garden beds and a new intro.

His laptop already showed the first symptom — the intro flying over ground whose
buildings had not arrived. That is a loading-budget failure surfacing as a visual
one, and it will not be the last.

**Unmeasured is worse than bad.** Get the numbers first:
- `scripts/verify/perf.mjs` — NOTE IT THROTTLES THE CPU 4x BY DEFAULT. Quote the
  setting with the number or the figure is about a crippled machine (CLAUDE.md
  rule 10).
- `scripts/verify/boot.mjs` — per-source load timing, and `NET=4g` / `NET=3g`.
- `scripts/verify/payload.mjs` — total bytes.
- Minimum of interleaved reps, never one reading.

Then decide what to cut, and only then cut it. **He has said three times that
render speed and fps still matter** even while asking for quality over
production speed.

## K2. The mobile boost button is visually off

*"only thing is the boost button is a bit off visually but its great."* Shipped
in PR #128 and never seen on a real device until now. Small, pure presentation.

## K3. Finish DKR

Still the most-asked-for thing in the project. The Mac lane rebuilt the four
sides, the real heights and the 2021 entry towers, and PR #114 unblocked the two
faults it could not reach — but **the seating is still a stepped cone** until
`bake_stadium.py` emits real deck bases into the void that fix opened.

## K4. A clean full sweep, and READ every frame

Day, dusk and night. The last attempt was killed by the watchdog at 7 of 12
frames and roughly twenty PRs have landed since. `night-pale.mjs`'s threshold was
recalibrated and the result has never been looked at.

**Before a product manager finds something, I want to have found it.**

## K5. Downtown still reads cooler and greyer than campus

In any wide daytime frame the two halves of the city do not look like they are in
the same light. PR #117 established it was "undifferentiated, not dark" and fixed
the spread — that was real, and this is what is left after it.

## K6. The graphics menu is too wordy

*"add making the graphics menu less yap"* — 2026-08-04, correcting PR #128.

**This is a correction to the instruction that produced it.** The brief was
"rename every control in plain language and say what it DOES" and the result
explains too much. A settings menu should be scannable: a short label, and help
text only where a control genuinely needs it. Cut the prose.

---

# PART H — GLITCHES. A flickering frame kills a demo; these come first.

## H1. The Tower's night glow is wrong in five separate ways

*"at night, UT tower finally glows but its weird - the bottom part of the
illuminated prism glitches with the nonlit part they overlap and movement
triggers a glitch similar to the window one. also the main prism gradient is too
severe it goes into basically black. and its a bit too red should be burnt
orange. The top is fine. Is there a way that this can actually be light instead
of a colored surface? the base around it is too dark."*

Five things, and the first is a bug while the rest are taste:

1. **The lit prism and the unlit prism OVERLAP at the bottom and z-fight**, and
   movement triggers it. Two coincident surfaces — the same class as the ground
   fight PR #78 solved with a rank ladder. Fix the geometry, do not nudge a
   colour.
2. **The gradient runs to near-black.** Floor it well above black.
3. **Too red — it should be BURNT ORANGE.** UT's is `#BF5700`. Sample what is
   actually being drawn before changing it.
4. **The top is fine.** Do not touch it.
5. **The base around the Tower is too dark.**

**And the real question he asked: "Is there a way that this can actually be light
instead of a colored surface?"** Answer it properly in the PR. MapLibre has one
global directional light and no point lights, so a genuine emissive source is not
available — but the honest options are worth naming: a bloom/glow sprite behind
the tower, a lit ground pool under it, or brighter neighbouring surfaces to imply
spill. Say what you chose and why.

## H2. The window-density flicker is STILL happening

*"UTC still has the window glitching where it rapidly alternates between the less
and more dense window pattern on movement. same with buildings behind dobie. and
U24. they all happen from a distance i think. alot of other buildings have the
window glitching so find thos out. kinsolving is one of them. and san jac and
jester this problem was supposed to be fixed a while ago idk why its still buggy"*

PR #103 fixed the HOUR flipping (day pattern at night). **This is a different
bug: the DENSITY flips.** Two mip tiers of the same pattern have different window
densities, and at a distance the tile zoom oscillates between them frame to
frame, so the wall visibly switches rhythm.

Named: **UTC, the buildings behind Dobie, Union on 24th, Kinsolving, San Jacinto,
Jester.** "They all happen from a distance" is the strongest clue in the report.

**Read HANDOFF §46 before touching `js/facades.js`.** The fix there was "every
mip tier must hold the same hour". The rule this needs is stronger: **every mip
tier must be the same PATTERN, differing only in resolution** — if a coarser tier
is drawn with fewer windows rather than the same windows at lower resolution,
that difference IS the flicker.

Reproduce it in a script: park the camera where a named building is far, orbit or
dolly slightly, and sample its wall across frames.

## H3. The horizon line tilts the wrong way

*"the horizontal horizon line tilts in the opposite direction as the map horizon
when i move sideways make that the same direction"*

PR #116 turned `#fx-dof` off, so whatever tilts now is something else — probably
the sky canvas or a horizon band that takes the camera's roll with the wrong
sign. The flight controller banks into turns (`rollNow` in `js/controls.js`), so
the sign convention is knowable. One character, most likely.

## H4. Asphalt bleeds into Speedway

*"some asphalt roads bleed into speedway"*. PR #78's ground rank ladder resolves
overlaps; either Speedway is not in the ladder at the right rank, or the roads
that bleed are `roadarea` polygons added by PR #105 that the ladder never saw.

## H5. Roofs intersect badly where footprints have many corners

*"Jester roofs have some weird extrusions with the diagonals. specifically above
where it says J2. other buildings with alot of corners next to each other with
cornered roofs have this weird intersecting as well."*

A general rule, not a Jester bug. Find the class — a footprint with closely-spaced
corners generates roof facets that overshoot and stab through each other. Report
how many buildings share it.

---

# PART I — PRESENTATION. This is what the product manager sees.

## I1. Sidewalks look like bathroom tiles

*"sidewalks look like bathroom tiles. looks like its all one huge tile floor and
the sidewalks just reveal a portion of that one floor. make sidewalks look
better. At first it looked like tape now it looks like bathroom tiles i dont want
another silly analogy next."*

**He has diagnosed the mechanism exactly.** The paving texture is a
world-anchored `fill-pattern`, so every sidewalk in the city is a window onto ONE
continuous tiled plane — the joints line up across separate paths, which is why
it reads as a single bathroom floor. **The joints must run along each path, not
across the world.** That is the fix; a different tile image is not.

Third attempt at this. Get it right.

## I2. The startup flythrough

*"make the start up fly through a more cinematic location - by that i mean
starting looking at the tower is night but then it goes to like the guad
buildings which are like whatever pick a better one. Maybe it could start flying
up from downtown and going into a large campus view. or not if thats bad on poor
devices just make a better one."*

The first thing anyone sees. His suggestion — rising from downtown into a wide
campus view — is a good one; if it costs too much on a weak device, pick another
and SAY why. It must not end on something forgettable.

## I3. The chrome: loading screen, slider, graphics menu

*"there should be an option to sprint on mobile. sprinting should increase my FOV
a bit. Make the loading screen look nicer. make the day night slider look nicer
and replace the sun and moon emoji. make the graphics menu more intuitive. the
light and lens sliders i dont understand execpt for distance blur. The preset
modes also dont make sense all i understand is performance and ultra. Put my
credentials Simeon Varghese on the loading screen."*

- **Mobile sprint** — there is a joystick; it needs a boost control.
- **Sprint raises FOV a bit.** `TUNE.FOV_KICK` already exists in
  `js/controls.js` and rides speed — check whether it is simply too small.
- **Loading screen**, and **"Simeon Varghese" credited on it.**
- **Day/night slider** — nicer, and the sun/moon emoji replaced with real marks.
- **The graphics menu is not intuitive.** He understands "Performance" and
  "Ultra" and nothing else. The light and lens sliders mean nothing to him except
  distance blur. **Rename everything in plain language and say what each one
  does.** A control nobody understands is worse than no control.

## I4. A recommendations box

*"add a recommendations box, have the message send to simeonvarg@outlook.com. or
tell me how to do this if thats a bad idea idk how to do that."*

**A static site cannot send mail.** The right answer is a form service —
Formspree, Web3Forms or similar: he creates a free account, it gives an endpoint,
the page posts to it and the service emails him. **His address never appears in
the page source**, which a `mailto:` would expose to scrapers.

Build the form and read the endpoint from ONE config constant. **Do not create an
account for him.** Until an endpoint is set the form must say so plainly rather
than pretending to send.

---

# PART J — SCENE FIXES. Things that are there and wrong.

## J1. Calhoun's middle prism should be roofed

*"for calhoun u were right to not red roof the middle part - however the
horizontal prism in the middle should be roofed. So there should be 3 horizontal
roofed prisms, rn the top and bottom r roofed, the middle should be roofed, and
the areas between should stay as they are (not roofed)."*

Precise and easy to check with a picture.

## J2. University Christian Church reads as an office block

*"University Christian church looks like an office building make its outline
better."* Its footprint or its massing is wrong — a church has a nave and usually
a tower.

## J3. The University Catholic Center is a stub

*"also that building between university christian church and dobie 21 is the
University Catholic Center. Its a very important building idk why it was just a
stub before. I think an earlier pass didn't have data on it and put construction
around it. Build the university catholic center"*

**Find out why it is a stub first** — if a pass wrapped it in construction
hoarding for want of data, that decision is probably repeated elsewhere and worth
reporting. Then build it.

## J4. The parking garage and the food trucks

*"theres what looks like (not sure) a parking garage diagonall across in that same
block. pretty sure there are food trucks in front of that parking garage almost
on 21st"* — he flags his own uncertainty, so CHECK before building.

*"add the food truck that is always in front of jester, and always in the PCL
area"* — these are certain.

## J5. The South Mall and the lawns are washed out

*"Make south mall more vibrant and saturated. Lawns like that throughout the
project should be more saturated."* A global taste value, parameterised.

## J6. The starred medians south of the fountain

*"the grass median on the road south of the fountain has cool designs add them
(the circles have stars on them)"*.

## J7. Two missing paved areas

*"theres a walkway - pavement area between guad and tower, south of flawn and
union. add that. also the area in front of UT tower looks bland - see whats here
and add it."* For the second, **look at what is actually there** before drawing.

## J8. Not enough trees on campus

*"theres not enough trees on campus. Make sure new trees are not collided with
buildings or on roads."* The in-surface rule from PR #76 already exists — extend
the count, keep the rule.

---

# PART L — the entrances are MERGED, and two buildings still need work

PR #145 is merged. §86's five defects are all closed and re-measured in pixels
in §89 of `HANDOFF.md` — PCL is at grade, the inscription is off by default and
does not leak, the poles and the plank are gone, the four eras render four
different glazings, and the night glass measures 2.4x to 3.4x its own frame's
median luma with a channel spread of 46–81 (§86 measured spread 16). The
before/after set a human should look at is `shots/entrances/final/`.

Two buildings are left. Both are one building each, both were already flagged
**[U]** in `docs/entrances/celebrated.md`, and neither was in §86's five.

**L1. Gates-Dell's main entrance is buried inside a hero block.** The door point
`-97.736684, 30.286256` is a **measured OSM `entrance=main` node** — the
best-documented entrance on the celebrated list — and it falls INSIDE a
`data/heroes.geojson` piece 28.7 m tall. So `scripts/bake_entrances.py` places
it correctly against `buildings.geojson`, where it is outside every footprint,
and then the hero pass draws a wall over the top of it. Measured: **0 entrance
pixels from all 16 camera bearings tried**, and a camera 46 m west at 39 m up is
inside the mass. Audited across the whole file, this is **1 of 584**. Fix in the
bake: read `data/heroes.geojson` the way §87 taught the plaza check to read
`ground.geojson`, and push a door that lands inside hero geometry out to the
hero's own wall (or drop it and say so in the run's print). Picture:
`shots/entrances/final/still-wrong-01-gates-dell-entrance-buried-inside-a-hero-block.jpg`.

**L2. The Texas Union's "main" portal opens into a courtyard.** The door at
`-97.740963, 30.286162` sits at the bottom of a deep notch in the Union's own
footprint facing **north**, away from the West Mall. The placement is not
broken — the notch is real and the door is properly on its wall — but that is
not the mall front, and the Union is one of the two buildings Simeon named for
carved inscriptions. `celebrated.md` §5.4 already says in bold *"Do not author
this portal until someone looks"*. Someone has now looked and it is wrong.
**This one needs a photograph before any code**: which elevation is the Union's
main door on, and is there lettering on it. Picture:
`shots/entrances/final/still-wrong-02-texas-union-main-door-is-in-a-courtyard-notch.jpg`.

**L3. The Main Building's south portal is not in its recess.** Not one of §86's
five, so it was never scoped, but `celebrated.md` §5.1 says in bold that the
portal sits in a **recessed centre bay flanked by two projecting wings** and
traces the OSM ring to prove it — "model the recess". The wall is flat. This is
the most-photographed portal on campus and it is the one thing in the frame a
person who has stood on the South Mall would notice.

**Do not re-derive the poses.** §89 solved them: door position from
`entrances.geojson` cross-checked against `celebrated.md`'s cited OSM nodes,
`zoom = log2(91_190_745 / D)` for a wanted standoff D at 1440x900, and a
magenta-mask pose search that asks the renderer whether the entrance is actually
on screen. Note the trap it found: **an edge-normal sign test flips on these
concave footprints** and will tell you ten entrances face backwards when a
point-in-polygon probe says zero do.

---

# PART W — WEST CAMPUS GROUND FLOOR. Written 2026-08-05 from the review in
# HANDOFF §93. **W1 and W2 are DONE and PR #147 is MERGED** (HANDOFF §94, §95).
# Everything from W3 down is still open, and none of it blocked the merge.

**~~W1.~~ DONE — `places-check.mjs` is 40 ok / 0 failed.** Not fixed the way
this entry proposed. The one-line re-copy would have been correct on the day and
stale on the next family, so assertion A now **derives** the catalogue from
`scripts/bake_places.py`'s own `band_props()`/`glow_props()` call sites: 11 call
sites → 10 families, set-equal to the data, no second list anywhere. Verified
independently outside the checker on the merged tree. **Run it from
`scripts/verify/`** — it resolves both the bake and `places.geojson` against
`process.cwd()`.

**~~W2.~~ DONE — `coplanar.mjs data/places.geojson` is back to 1**, the
awning/awning pair that pre-dates the pass. The pier's top face is now a bearing
seat 30 mm under the lintel's (`SF_HEAD_BEARING = 0.03`, a named constant in the
entry taste block): 194 `plPier` at 2.43, 133 `plHead` at 2.46. The lintel was
the wrong surface to move — its top is clamped to the host's glass head and
`places-check` asserts the sign band sits flush on it at 0.001 m. The look is
unchanged and was measured, not argued: `shots/wampus/merged/`.

**W3. `data/entrances.geojson` is 5.44 MB raw / 326.7 KB gzipped, 11,890
features, loaded as a flat GeoJSON source.** Already on `main`; nothing this
week measured its load cost. It is 4.4 % of the gzipped `data/` payload and
10 % of the raw JSON the browser parses at boot, and K1's loading budget never
saw it. Either tile it the way the note at `js/entrances.js:924` anticipates, or
measure it and write down that it is affordable. Do not guess.

**W4. Several West Campus towers have no lit windows after dark.** The Castilian
is the clearest: `shots/wampus/final/lobby-castilian-night.png` is a fully lit
lobby under a completely black 20-storey tower, with its neighbours dense with
lit windows in the same frame. Two more blocks in `guadalupe-24th-night.png`.
`js/westcampus.js` / `scripts/bake_westcampus.py`. Verify by picture, not by
reading the night colour expression — a pass this week already claimed glass was
lit because the expression said so and the pixels said flat grey.

**W5. A tenant can be labelled twice in one frame.**
`shots/wampus/final/guadalupe-street-day.png` shows "Chipotle" in white above
the sign band and again in brand red at awning level. `data/places.geojson` has
exactly one Chipotle label and `js/app.js` already strips the basemap's POIs, so
the duplicate is one of our own label layers drawing the same name. Find which,
then suppress it where `places-label` already names the tenant.

**W6. `zfight.mjs`'s `westcampus-day` pose flickers over 242 px at
[642,827,869,895] by day and nothing at night, and it is NOT the shopfronts.**
Same count and same box before and after the pier fix (§94 A/B'd it against the
old data file; §95 re-read it on the merged tree). Nothing in
`data/places.geojson` stands above 5 m and the cluster is a roof plane on a
podium at the bottom of frame. Mask:
`shots/wampus/blockers/zf-after-westcampus-day-flicker.png`. Related and also
untouched: `node scripts/verify/coplanar.mjs` on its DEFAULT file set reports
**85 overlaps in `data/roofs.geojson`**, worst 42 m² at 100 % shared. That file
is byte-identical on `main` and nobody owns the finding yet. Note the default
set does not include `places.geojson` or `entrances.geojson` — name them.

**W7. Gates-Dell's main door is still buried inside a `heroes.geojson` block.**
This is PART L's **L1**, unchanged and unstarted: a measured OSM `entrance=main`
node that lands inside a 28.7 m hero piece, so the door renders 0 pixels from
all 16 bearings tried. 1 of 584. The fix is in `scripts/bake_entrances.py` —
read `heroes.geojson` and push the door out to the hero's own wall, or drop it
and print that it was dropped.

**~~W8.~~ RULED — author the secondary West Mall door; the courtyard door stays
as main (2026-08-15, HANDOFF §117, photographed).** The photographs:
`shots/blitz/w8-union-courtyard-door.png` and `-door-close.png` show the bake's
main door (eid 350, hinged-quad, bronze + limestone surround + steps) is
genuinely good and correctly placed in the east courtyard notch, facing north
toward the FAC courtyard. `w8-union-from-westmall.png` shows the cost: standing
on the West Mall at 1.7 m, **no way into the Union reads at all** — the south
elevation is a blank arcade wall. `w8-union-overhead.png` shows the geometry of
the problem in one frame. **The ruling:** the real Union has a public south
entrance up the steps from the West Mall; OSM simply has not mapped it, and the
south face is the building's public face. So the next entrances pass should
**add ONE authored secondary door on the south (West Mall) elevation, `src:
"authored"`, `role: "secondary"`, same recipe as the hero doors** — and leave
eid 350 exactly where it is, because the notch is honest and the composition is
the best-authored door on that block. On lettering: no carved inscription
renders on any Union elevation in these frames — if the inscription pass ever
reaches the Union, the mall face is where it belongs.

**W9. The Main Building's centre bay should be recessed and is flat** (PART L,
**L3**). `docs/entrances/celebrated.md` §5.1 traces the OSM ring to prove the
south portal sits in a recessed centre bay between two projecting wings, and
says in bold "model the recess". This is the most-photographed portal on campus
and the one thing a person who has stood on the South Mall would notice.

**~~W10.~~ DONE — all 24 are photographed, day and night** (HANDOFF §101).
Contact sheets: `shots/night/final/00-ALL-24-WEST-CAMPUS-LOBBIES-day.png` and
`-night.png`. **17 of 24 read as a real ground floor; the seven that do not are
W11–W16 below.** The pose list still is not in `scripts/verify/shots-*.json` —
the lane that owns that directory should take the recipe from §101 (door
centroid, outward normal signed two ways, eye 18 m, standoff `min(30, clear+8)`,
bearings confirmed by a magenta pose search).

---

# PART X — WHAT THE 24 LOBBY PHOTOGRAPHS FOUND. Written 2026-08-05 from
# HANDOFF §101. **Every one of these was found by looking, not by measuring.**

> **STATUS after HANDOFF §102-§104 (re-shot on `main` at `a8ae8ad`).** Of the
> seven: **one was a real defect and is fixed (X2)**; **two were never defects
> (X3, X5)**; **four are the 18 m camera floor wearing different costumes (X4
> in part, X5, X6, X7)** and are therefore blocked on **X1, which is Simeon's
> call and is still open.** Pictures for all of it:
> `shots/lobbies/final/`. Nothing below is closed by an execution decision that
> was his to make.

**~~X1.~~ DONE — the floor is 1.7 m and it holds (HANDOFF §105).** Simeon chose
walking height. `ALT_MIN` is 1.7, eight more constants had to move with it, and
three pre-existing bugs had to be fixed before it meant anything; the intro end
pose is identical to every digit and the controller never drives during the intro
or the tour. Pictures: `shots/eye/final/`. What it EXPOSED is Part Y below.
The original entry follows.

**X1 (original).** `js/controls.js:85` `ALT_MIN = 18`. Any scripted pose under 18 m of eye
height is treated as "the user is flying" and lifted back to 18 m within ~2 s —
so **there is no pedestrian view of this city, and there never has been.** The
"7.5 m of eye height" in HANDOFF §93 and the poses in §100 are the altitude at
the instant of the jump; every frame was taken from 18 m. 18 m is a fourth-floor
window. Six poses measured before and after in §101's table. **This is a taste
and scope decision, not an execution one:** lowering the floor is what lets a
flying user clip through a wall, so it goes to Simeon with a picture rather than
being decided in a lane.

**~~X2.~~ DONE — The Callaway House Austin's tower is lit** (HANDOFF §102,
re-verified §104). The family was `sn`, a stadium-concourse elevation with no
window grid, on a 17-storey residence; it is `tr` now and the brick colour is
untouched. In the four-tower night frame Callaway measures **7.41 % lit** against
21 Rio 8.65 %, Signature 1909 7.78 %, Ion Austin 6.92 % — inside its neighbours'
spread, from 0.04 % before. `shots/lobbies/final/01`–`06`.
**The guard has now been watched failing**: breaking 21 Rio, Callaway or Dobie
into an unlit family fails the bake by name and by metre, and editing
`js/facades.js`'s night constants fails it on the digest. All 24 principal tower
bands measure over 120 luma peak off the atlas; **no dark towers remain.**

**~~X3.~~ CLOSED — Grayson House is not transparent** (HANDOFF §103, re-shot
§104). §101's camera was standing **inside The Quarters Sterling House**, 24 m
south, and MapLibre does not draw the back of a fill-extrusion. Photographed at
**six** bearings on `main` it is a solid punched-window block with a brick base
and a coping: `shots/lobbies/final/20-X3-GRAYSON-AFTER-bearing-*.png`, and the
magenta silhouette `21-...` is one connected mass. `19-...` is the old frame for
comparison. **Nothing to fix.** The guard for the class —
`scripts/verify/westcampus-probe.mjs:60`, "nothing stands above `final_height`" —
is still dead in the page-setup regression the Mac lane owns.

**X4. Cambridge Tower's door is blocked by CAMBRIDGE TOWER, and the bug is in
the march, not the placement.** Not the AT&T Center and not the wrong wall — both
guesses are wrong. Measured (§104): the main-door group's 40 points sit **0.2 m
outside Cambridge Tower's own base ring** and the nearest *other* West Campus
footprint is **107 m** away. Marching outward in 30° steps against its own ring,
**six of twelve directions re-enter the host building within 1–3 m** because the
door sits in a re-entrant notch of its own plan; the other six are clear for
30 m. **`scripts/bake_entrances.py`'s clear-distance march must exclude the
footprint the door belongs to**, or every door in a notch reports 0 m. The
photograph agrees there is open ground:
`shots/lobbies/final/30-X4-CAMBRIDGE-TOWER-bearing-180.png`. Still unsettled:
whether the glazing is on that elevation — the probe that would answer it failed
(see X8).

**~~X5.~~ CLOSED — the trees are real and correctly placed** (HANDOFF §103).
Every canopy in front of 21 Rio and The Nine at West Campus is `src:"imagery"`,
the big one is an ordinary mature live oak by size, and its underside is 4.41 m
against a 2.44 m door head — **you walk under it**, if you could get under it.
Re-shot from a different bearing in §104 the 21 Rio frontage reads fine:
`shots/lobbies/final/60-X5-*`. **This is X1 in a costume.** The real finding
underneath it is separate and general: **crown radius and trunk diameter in
`data/trees.geojson` are drawn independently** — 31 % of 7,414 pairs have a
ratio over 40 where a real oak sits near 12–25, and 73 % of canopy centres have
no trunk within 2 m. `scripts/shape_trees.py` should derive one from the other.

**~~X6.~~ CLOSED — both CAN be framed; the shorter one is X1** (§104).
The Quarters Sterling House at bearing 180 reads as a real ground floor —
balcony bands, brick base with piers, pavement, glazed lobby and canopy:
`shots/lobbies/final/40-X6-sterling-house-bearing-180.png`. The Nine at Rio is
**12.2 m tall against an 18 m camera floor**, so every frame looks down onto its
roof; its facade is modelled and visible, you simply cannot stand in front of it.
`40-X6-nine-at-rio-*`.

**X7. The flat untextured colour field is the camera floor, and here is the
number.** Rambler is **14.4 m tall**; at the 18 m floor **84.8 % of the frame is
one exact colour** (`#bfae98`, its own roof slab). Move the same camera to 55 m
and the largest single-colour field is **15.6 %** — nothing in the model changed.
`shots/lobbies/final/50-X7-rambler-*`. **The queue's second example does not
reproduce**: Block on 25th East is 28.1 m, above the floor, and measures **2.1 %**
at the same pose. So X7 is **blocked on X1** for the framing complaint. What
survives it as a real, general note: **roof top faces carry no texture at all**,
citywide, and any downward view shows it.

**X8. A magenta mask on `entrances-glass` does not survive a camera move, and
that broke a probe in §104.** Painting the four entrance layers magenta once at
load and then walking eight bearings returned **0 pixels for all 24
measurements, including two control buildings that carry 11 and 12 `glass`
features**. `js/entrances.js:1298` re-applies `fill-extrusion-color` on the
time-of-day path, so the mask is repainted away. **Set the mask inside the
per-pose loop** (§103's version did, and worked). Related and already costly:
**a `#ff00ff` fill is multiplied by the night light** and comes back around
`#9911cc` at `p = 0.92`, so every `r > 170 && b > 170` test reads zero —
**measure silhouettes in day light**; the silhouette is geometry.

---

# PART Y — WHAT WALKING HEIGHT EXPOSED. Written 2026-08-05 from HANDOFF §105.
# **X1 IS DONE AND MERGED**: `ALT_MIN` is 1.7 m, the floor holds, the flyover is
# byte-identical, and every gate in §105 is green. Everything below is a defect
# that the 18 m floor had been HIDING, not one this pass introduced. They are in
# the order I would fix them, and the order is by how badly each one reads from a
# pavement rather than by how hard it is.

**Y1. Stars, the moon and clouds draw ON TOP of solid geometry. Fix this first.**
It is the only one of these that reads as a *bug* rather than as a style. In
`shots/eye/final/02-THE-TOWER-...-night.png` stars sit on the tree canopies and on
the brick wall at frame right; in `05-WEST-CAMPUS-lobby-at-eye-level-night.png`
they are scattered across a wall 1.5 m from the camera. Invisible at 18 m looking
down, unmissable at 1.7 m looking level. Almost certainly a draw-order/depth-test
question in `js/sky.js` rather than new art. **Verify by standing at 1.7 m facing
a wall at `p = 0.90` and asserting zero sky-coloured pixels inside the wall's
silhouette** — measure the silhouette in DAY light, per QUEUE X8, because a night
multiply moves every colour.

**Y2. The night street is unlit — not moody, unlit.**
`71-FAILURE-the-night-street-is-unlit.png`: the carriageway is ~45% of the frame
and near-black. One warm pool per lamp with real falloff onto the kerb and the
wall, a visible lamp head, and a night tint on the daylight-coloured shopfront
apron polygons (which currently stay fully bright in a black street). **Half the
reason to be at eye level at night is the street**, and there is not one. Data is
already there: 532 lamps in `data/props.geojson`.

**Y3. Trees: you walk through all 7,559 trunks, and 27.7% of crowns start below
2 m so you walk through the leaves too.** MapLibre back-face-culls
fill-extrusions, so entering a canopy makes it **vanish** rather than enclose you,
which reads as a rendering fault. Fix is **trunk-only** collision — a small
`R_TRUNK` (~0.6 m plus the trunk's own radius), stamped into the same field, and
gated below `ALT_GROUND` so the flyover pays nothing. **Do NOT put canopies in the
collision field**: a median crown is 4.27 m of radius against `R_CAM` 6 m and it
would wall off every tree-lined path on campus. Separately and already asked for
in §103: crown radius and trunk diameter in `data/trees.geojson` are drawn
independently, and 73% of canopy centres have no trunk within 2 m — visible at
eye level as canopies floating with nothing under them.

**Y4. Raise `ZOOM_MAX` so you can look down at your own feet, and it is a
`js/ground.js` job, not a `js/controls.js` one.** At 1.7 m the pose is only
expressible at pitch >= 84.7 deg (`dMin` = 18.48 m at 1440x900 / fov 58), so the
controller BLOCKS pitching down rather than letting the render silently pull the
eye back. `72-LIMIT-...` and `73-LIMIT-...` are the same spot at 1.7 m and at
12 m. **The library is not the obstacle** — measured on the vendored 5.24,
`setMaxZoom(22.5/23/24/25/26)` are all accepted and a `jumpTo` to z24.2 genuinely
arrives. The obstacle is `js/ground.js:349` `texGroundMaxZoom: 22`, a LAYER
maxzoom: above z22 the textured ground stops drawing, and z only passes 22 when
you pitch down at low altitude. So: give the ground a level that survives z25,
then set `ZOOM_MAX = 25` and `map.setMaxZoom(25.5)` in `js/controls.js` and the
pitch floor disappears on its own. Re-run `zfight` and `coplanar` afterwards —
nothing in this repo has ever been drawn above z21.5.

**Y5. Facade textures are authored for 200-900 m and do not survive close range.**
The wall at frame right in `01-THE-TOWER-...-day.png` is a pegboard of brown dots;
the upper storeys in `03-GUADALUPE-from-the-pavement-day.png` are vertical
barcode stripes. The modelled ground floor (584 doors, 24 lobbies, recessed
shopfronts) is excellent and it is a 3 m stripe under 40 m of that. Wants either a
close-range atlas tier or a mip/detail level that fades the fine grid out under
~15 m of camera distance and leaves base colour plus the real modelled openings.
This is the biggest piece of work on the list and the one with the highest ceiling.

**~~Y6.~~ DONE (HANDOFF §115).** Reproduced on `origin/main` `38fbeee` (sprint
FOV 65.00 against a 2.5–4.5 window — exactly `TUNE.FOV_KICK` 7, i.e. correct
behaviour, stale gate). The assertion now tests the mechanism `js/controls.js`
implements: cruise kick < 0.5 deg (the `FOV_KICK_FROM` half), sprint kick =
`TUNE.FOV_KICK` −0.6/+0.1 read live from `window.__fly.tune`, exact restore.
Guard proven: with the ramp broken in-page (`tune.FOV_KICK_FROM = 99`) exactly
the sprint assertion fails (kick 0.00), exit 1; clean reps 20/20 either side.
The original entry follows.

**Y6 (original). `motion-feel.mjs`'s FOV-kick assertion is stale, and it fails on `main`.**
It expects a 2.5-4.5 deg sprint kick and measures 7.00, which is exactly
`TUNE.FOV_KICK` — correct behaviour since `FOV_KICK_FROM` was introduced so that
the whole effect belongs to sprinting. **Reproduced on `origin/main`'s
`js/controls.js` under the same conditions, so it is not from the walking-height
pass.** Either widen the assertion to `TUNE.FOV_KICK +/- tolerance` read live from
`window.__fly.tune`, or decide the kick is too big and lower it — but a test that
has been red on `main` is a test nobody can use as a gate.

**Y7. The outer-ring scan's worst case is 37.9 ms and nothing budgets it.**
`querySourceFeatures` builds its whole feature list before returning, so
`OUTER_BUDGET_MS` cannot bound it. Crossing `ALT_GROUND` now forces a rescan at
`OUTER_MIN_H_GROUND` and takes the field from 1,336 features / 29,381 cells to
4,580 / 59,760; the AVERAGE did not move (6.13 -> 5.65 ms) but the worst case was
already two dropped frames before this pass and I did not chase it. Measure it
under sustained walking across a district boundary, and if it bites, spread the
query itself across frames by tile rather than asking for everything.

**Y8. The ground plane is now 40-55% of every frame and it is one flat colour**
with a soft ~5 m noise and a visible ~30 m repeat ring. Wants pedestrian-scale
paving joints, a gutter line, a smaller repeat, and thresholds/sills at the doors
the entrances pass placed (doors currently meet the pavement at a hard colour
seam with no step). **Kerbs are already correct** — right height, right profile,
they read at 1.7 m — so this is finishing a thing that works, not starting one.

**Y9. Labels are sized by zoom, not by distance in metres.** At eye level the
nearest label is a billboard and everything else is dust, and because the horizon
sits mid-frame every label in the city projects into one narrow band. Below some
eye height, show only what is within ~60 m and size by metres.

**Y10. Nobody has driven a touch device at walking height.** The joystick, the
two-finger altitude gesture and the BOOST latch were only exercised at flying
altitude by `collision.mjs`'s synthetic touch. `SPEED_MIN` is now 1.0, so the
joystick's expo curve is operating over a completely different speed range than it
was tuned for.

**~~Y11.~~ DONE — nine frames shot at 1.7 m, p 0.55/0.62/0.70, three sites
(HANDOFF §117, `shots/blitz/y11-*.png`).** The dusk SKY at eye level is the
best thing in the frame set — the Tower against the p 0.62 gradient
(`y11-southmall-p062.png`) is the frame to show. What the transition breaks is
now Y17 (the ground plane does not ride the dusk clock) and Y18 (the
post-process canvas paints glow bands across facades). Both were found by these
frames and both are measured below.

**Y12. MapLibre's near plane clips anything within 2.2 % of D — 0.4–1.1 m at
walking height.** Diagnosed in §108: walk into a tree and the trunk you are
touching *disappears* instead of filling the frame, because the near plane is in
front of it, so a working collision reads as a rendering fault. `TRUNK_PAD` was
raised 0.6 → 0.9 m so the stop lands outside it, which hides the symptom for
trunks and does nothing for walls, kerbs or door surrounds. Candidate fix is
overriding the transform's near plane below `ALT_GROUND`. It belongs to whoever
owns the map transform, and it **must** be re-checked against `zfight` and
`coplanar`, because a nearer near plane costs depth precision.

**~~Y13.~~ CLOSED — the disc is occluded by geometry, photographed and measured
(2026-08-15, HANDOFF §117).** Pose: eye 1.7 m at [-97.74575, 30.28640], bearing
112, pitch 85, p 0.92 — a West Campus tower square across the moon's screen
position, `skyFrame.sun` at (724,71) with `queryRenderedFeatures` returning
`buildings-3d` at that point. A 40x40 box around the disc position: **with the
wall present, mean luma 25.3, max 105.9 (a lit window), 0 px over luma 120;
with `buildings-3d/roof/ao` hidden at the same pose, 412 px over 120, max 194 —
the disc, exactly where it should be and nowhere else.** Frames:
`shots/blitz/y13-wc-moon-night.png` / `-nobldg.png` (plus a DKR pair muddied by
canopies under the disc; the WC pair is the proof). Instrument: composited
`page.screenshot()` per §109's rule, SwiftShader headless 1440x900,
`cancelGraphicsAutoDetect()`. One pose plus its own control, single rep — the
control failing loudly (412 px) is what makes one rep enough here. What the
frames DID catch is Y18 below.

**Y15. The trunk field's worst incremental scan is 841.5 ms.** Measured in §109:
61 scans, 25.3 ms average, 2,976 trunks, **max 841.5 ms** — about fifty dropped
frames. That run teleported across West Campus ten times, which forces rescans a
real walk would not, so it is an upper bound rather than a typical cost. Same
shape as Y7 and the same fix (spread `querySourceFeatures` across frames by tile
rather than asking for everything). Measure it under a sustained walk first.

**Y16. At 1.7 m you cannot look down, and the failure mode is not what §106
recorded.** §106 said the controller BLOCKS the pitch. Driven through `setPitch`
in §109 the pitch is **granted and the eye is silently lifted**: asked 80 you get
4.23 m, asked 70 you get 8.34 m, asked 60 you get 12.19 m, asked 45 you get
17.23 m. Same verdict as Y4 (`ZOOM_MAX` is still 21.5), but whoever picks Y4 up
should know they are removing a silent lift, not a block.

**~~Y14.~~ CLOSED — both run against `origin/main` `38fbeee`, both at baseline
(HANDOFF §115).** `places-check.mjs` **PASS, 40 ok / 0 failed** (same as §95).
`zfight.mjs shots-places.json`: **7 poses no clusters; `westcampus-day` 242 px @
[642,827,869,895]** — the same count and the same box as §95/§101/§104, i.e. the
known QUEUE W6 cluster, unchanged. Nothing new to open. The original entry:
`zfight` needs a shots file as `argv[2]` and `VERIFY_URL`; `places-check` needs
`VERIFY_URL` and to be run from `scripts/verify/`; under CPU load the fly-drag
poses can come back `INVALID: the scene had not loaded` — rerun those poses,
do not read INVALID as clean.

**Y17. The ground plane does not ride the dusk clock at eye level.** Found by
the Y11 frames (HANDOFF §117), measured with a fixed 400x150 pavement box per
site (offline PNG decode, no instrument between the frame and the number).
Pavement mean luma across p 0.55 / 0.62 / 0.70: Guadalupe **128 / 141 / 101**,
West Campus **120 / 126 / 84**, South Mall **134 / 118 / 80** — at two of three
sites the pavement gets BRIGHTER through mid-dusk, and at p 0.70, with the sky
starlit (sky box 38) and the facades at night values (wall box 35–44), the
pavement still reads 80–101: **2.3–2.9x the luma of the wall it meets, in the
50–60 % of the frame the ground occupies at 1.7 m.** From the flyover this was
invisible; on the pavement it is the first wrong thing in every dusk frame.
Same family as §82 (three ramps rode the slider instead of the sun) — whatever
ramps the ground texture/fill never got the §82 treatment, or has a floor.
Frames: `shots/blitz/y11-*-p070.png` against their own p 0.55 siblings.

**Y18. The post-process canvas (`fx-canvas`, z 6 — bloom/god-rays) paints glow
bands across solid facades at eye level; it is composited over the whole frame
and depth-tests nothing.** Two independent catches in the §117 frames:
a red-brown band across the Drag facade at dusk (`y11-guadalupe-p070-ship.png`,
rows ~150–260, well above the horizon at 379), and a warm band across a West
Campus tower at full night p 0.92 (`y13-wc-moon-night.png`), i.e. this is not
§109's sky field — that pass is depth-tested and proved 0 px on walls — it is
`js/graphics.js`'s screen-space pass. A/B at the same pose: with
`GFX.bloom/godRays/flare = 0` the band is gone and the wall reads its honest
brown (`y11-guadalupe-p070-fxoff.png`); the pass moves **73.1 % of a 950x370
wall region by >8, max channel delta 32** (single rep each; the band's
presence/absence is visual and unambiguous, the percentage is one reading).
Related, unproven but written down: the same wall box measured 35 luma when
p 0.70 was reached via 0.55→0.62 in one session and 56 when jumped to directly
in a fresh one — auto-exposure path-dependence is the suspect, and it needs
interleaved reps before anyone treats frame-to-frame dusk numbers as stable.
The §109 star gate could not have seen any of this: its poses had the FX band
elsewhere and its assertion hunted sky colours, not warm washes. Fix belongs to
whoever owns `js/graphics.js`; the honest options are masking the fx pass below
the horizon against the depth of the scene, or gating bloom/rays off below
`ALT_GROUND`. Do not fix by turning the preset down and calling it done.

---

# PART Y — STATUS AFTER THE AUDIT (HANDOFF §109, 2026-08-06, verified on `main`)

```
Y1  stars/moon/clouds drawn through geometry ... DONE  (#160) and re-proved in §109
Y2  the night street ......................... DONE for the CARRIAGEWAY (#161).
                                                The PAVEMENT half is still blocked on
                                                scripts/verify/night-lights.mjs asserting
                                                a LAYER INDEX instead of an occlusion
                                                property — not this lane's file. See §107.
Y3  tree collision ........................... DONE  (#162). Trunks only; canopies
                                                deliberately not collided.
Y4  look down at your own feet ............... HALF. js/ground.js is ready
                                                (texGroundMaxZoom 22 -> 25). ZOOM_MAX is
                                                still 21.5, so the pitch floor stands and
                                                you still cannot look at your feet.
                                                Blocked behind Y8 by choice, and now also
                                                behind Y5 (see that doc's sequencing note).
Y5  facades at close range ................... DONE for the DRAG (#167, merged
                                                2026-08-15 after a blind gate vs live:
                                                day eye-level WIN, night not worse,
                                                cruise footprint 67 px — §114, §121).
                                                Storey bands, no windows; candidate B
                                                (windows) stays alive on acer/facade-
                                                choice (PR #164) for the later job.
                                                Campus + West Campus (js/facades.js,
                                                wc-wall) still need the same treatment
                                                and are OPEN.
Y6  motion-feel FOV assertion ................ DONE (acer/blitz-verify, HANDOFF §115).
                                                Repaired to assert the MECHANISM: zero
                                                kick at cruise, TUNE.FOV_KICK (read live)
                                                at the sprint ceiling, exact restore.
                                                Watched failing on an injected fault.
Y7  outer-ring scan worst case ............... OPEN
Y8  the ground plane ......................... TEXTURE half DONE (#170, merged
                                                2026-08-15 after the gate re-proved the
                                                byte-identical-flyover claim: SHA-256
                                                equal with the layers on/off at cruise,
                                                magenta 625,928 px at feet / 0 at
                                                default and cruise — §120, §121).
                                                Daylight feature by measurement; night
                                                grain is nil by design. The GEOMETRY
                                                half (gutter line, door thresholds,
                                                smaller repeat ring) is still OPEN, and
                                                so is PART Z's Z0 (texGroundMaxZoom 25
                                                rejects ground-base-texture on main —
                                                one character, 25 -> 24).
Y9  labels sized by zoom not metres .......... OPEN
Y10 touch at walking height .................. OPEN
Y11 dusk at eye level ........................ DONE (§117, shots/blitz/) — found Y17+Y18
Y12 the near plane ........................... NEW
Y13 the moon behind a building ............... CLOSED (§117) — disc occluded, 0 px through wall
Y14 places-check / zfight not run ............ CLOSED (both at baseline on 38fbeee, §115)
Y17 ground plane ignores the dusk clock ...... NEW  (§117) — pavement 2.3-2.9x wall luma at p 0.70
Y18 fx-canvas paints glow bands on facades ... NEW  (§117) — dusk AND night, A/B proven
```

**The one-line verdict on the Drag at night:** it is genuinely better — no stars
on the brick, and a carriageway that went from 0.78x the frame median to 1.40x —
but **Y5 is what is still between it and good.** The shopfronts are excellent and
the 40 m of wall above them is a barcode, and that is the first thing your eye
goes to.

---

## ~~Y5 IS WAITING ON A TASTE DECISION~~ — DECIDED AND SHIPPED (2026-08-15, §114/§121)

**The decision was delegated and executed per this section's own written
recommendation: storey lines, no windows.** PR #167 built them across the whole
Drag corridor, the gate judged it blind against the live site (day eye-level
WIN, night not worse, cruise 67 px) and merged it. What still stands from the
original entry: **PR #164 stays alive** — the windows candidate is the storey
candidate plus openings, and the queued windows job finishes from it. The
sequencing note about Y4 also stands. Original entry follows for the record.

## Y5, the original entry (2026-08-06, §112)

Both candidate walls exist and are photographed. The question left is the one
`docs/camera/facades-at-two-metres.md` §6 said is Simeon's and not ours: **how
close is the Drag meant to survive?**

Show him these two, in this order:

```
shots/facade/final/CHOOSE-the-drag-at-eye-level.png
shots/facade/final/CHOOSE-from-600m.png
docs/camera/facade-choice.md      <- half a page, plain English, with a recommendation
```

The recommendation on the page is **storey lines, not windows** — most of the win
for a twentieth of the work, and windows stay additive afterwards because the
windows candidate IS the storey-lines candidate plus openings.

**The code for both candidates lives on branch `acer/facade-choice` (PR #164),
which is a DECISION BRANCH and must not be merged as it stands.** It is three
files — `js/drag.js`, `scripts/bake_drag.py`, `data/drag.geojson` — scoped to one
block and inert without `?cand=`. Leave it alive: whichever wall he picks gets
finished from it rather than rebuilt.

**Sequencing that still stands:** Y4 (raise `ZOOM_MAX`) pushes `floor(zoom)` to
24-25 at walking height. Neither candidate cares — both are geometry and their
heights are in metres — but the shipping *texture* underneath them does, so Y5
should land before Y4 or Y4 must re-run the check.

---

## Not negotiable

1. **Never register a self-hosted GitHub runner.** Public repo.
2. **Never remove the watchdog or reaper in `scripts/verify/chrome.mjs`.**
3. **Never leave a browser or a server running.** `reap.mjs` and kill the server.
4. **Record every pass in `HANDOFF.md`** with the branch name.

# PART Z — WALK TO CLASS. Written 2026-08-15 from the skeptic pass in HANDOFF
# §116. **PR #169 IS OPEN AND WAS NOT MERGED.** The routes are right; four
# things the interface says or fails to draw are not, and each is small.

**The one-line verdict.** The routing is the best-verified thing in this repo —
eighteen pairs driven in a real browser, every distance identical to the bake's
audited table, nothing routed through a building that OSM does not mark
`covered=yes`. What is not ready is the picture and the wording around it.

**Z0 — NOT THIS FEATURE, AND THE MOST URGENT LINE ON THIS PAGE.
`ground-base-texture` is rejected by MapLibre on `main` today.**
`js/ground.js:370` sets `texGroundMaxZoom: 25`; the style spec's maximum for
`maxzoom` is 24. So `addLayer` fails validation and the city-wide ground grain
layer — a `background` layer carrying `TEX_IMG.paving` — is never added. The
console says so on every single load:

```
MAP ERROR: layers.ground-base-texture.maxzoom: 25 is greater than the maximum value 24
MAP ERROR: Cannot style non-existing layer "ground-base-texture".   (x3)
```

`js/ground.js` is byte-identical between this branch and `origin/main`, so this
is on `main` now, and it is almost certainly the leftover of the Y4 half-fix
that raised `texGroundMaxZoom` from 22 to 25. **QUEUE Y8 says "the ground plane
is now 40-55 % of every frame and it is one flat colour" — this is at least part
of why.** It is one character (`25` → `24`) and it is not this lane's file.

---

**Z1. `wayfind-ghost` never enters the style, and here is why.** §114 recorded
"reports index -1 ... I ran out of time to find out why". The browser says it
outright, once per load:

```
MAP ERROR: layers.wayfind-ghost.paint.line-width:
           "zoom" expression may only be used as input to a top-level
           "step" or "interpolate" expression.
```

`js/wayfind.js:917` wraps `groundWidthExpr()` — which IS a zoom `interpolate` —
inside `['max', 1.5, ['*', 0.55, ...]]`. MapLibre rejects the layer at
validation, fires an error event rather than throwing, and skips it. So the
"solid on open ground, dashed through the wall" half of the occlusion design,
which the file's own header calls "the whole occlusion design", is absent: a
route that runs behind a building simply disappears.

**The fix is to do the arithmetic in JavaScript and leave a bare top-level
interpolate.** Measured at lat 30.2862, `routeWidthM` 1.6, `routeMinPx` 3,
`routeMaxPx` 90, ghost multiplier 0.55, floor 1.5:

```js
'line-width': ['interpolate', ['exponential', 2], ['zoom'], 15, 1.65, 21, 27.30]
```

Do not hardcode those two numbers — compute them from the constants, the same
way `groundWidthExpr` already does, and return the finished interpolate.
**Then photograph a route that passes behind a building**, because nobody ever
has.

**Z2. The From field promises a location it does not have.** Its placeholder is
`Where I am standing`. There is no `navigator.geolocation` anywhere in the file
and no camera-position default; leave From empty, press Enter on a valid To, and
**nothing happens at all** — `run()` returns on `!state.from`. `interface.md` §2
specifies a pre-filled `Here · near Speedway at 24th` taken from the camera, and
that is the flow in Simeon's own brief ("get a route from where you are").
Either build the camera default (it needs no permission and no prompt) or change
the placeholder to something true. Shipping the sentence without the feature is
the one failure `what-we-can-honestly-say.md` §9 names by hand.

**Z3. 85 of the 198 UT register codes return NOTHING when typed**, including
`NUR`, `SMC`, `HDB`, `HLB`, `HTB`, `UTA`, `ACS`, `ANB`, `BMS`, `BMK`, `WMB` and
`WAT`. `walk_graph.json`'s `code` map holds 113 of 198; 111 are routable and 2
(`BIO`, `TSG`) are shown greyed with "no door mapped", which is the right
behaviour. The other 85 are not in the index at all, so the list is empty and,
as `interface.md` §1 says, **an empty list reads as "you typed it wrong" rather
than "we don't have it".** §114 asked for this as a schema change to
`scripts/bake_walk.py` and it is not done: add the remaining register codes with
an empty door list.

**Z4. Six of the twenty-four West Campus towers are not in the graph at all** —
**21 Rio, Skyloft Austin, The Quarters Sterling House, The Block, Pointe on Rio,
The Venue on Guadalupe**. All 24 are in `data/westcampus.geojson` with lobby
doors; `walk_graph.json`'s `wc` map has 18. Simeon's brief says "works with
wampus apartments too", and **§113's own audited table advertises a
`21 Rio > WEL` route that the shipped client cannot produce** — typing `21 Rio`
returns nothing. And it is not a hypothetical: **`21 Rio` and `Pointe on Rio` are
both LABELLED ON SCREEN** in the golden-hour hero frame
(`shots/walk/final/90-hero-unchanged-origin-main.png`). A student reads the name
off the city, types it, and gets an empty list. `scripts/bake_walk.py`.

**Z5. A drawn route repaints the whole city fifteen times a second, forever.**
`startPulse()` runs a `requestAnimationFrame` loop that calls
`setPaintProperty(..., 'line-gradient', ...)` at `pulseFps` 15 for as long as a
route is on screen. Every one of those marks the style dirty and forces a full
repaint of a scene that measures 3.7 fps on a software rasteriser and ~35 fps on
this laptop's GPU. Worse, the layer it animates (`wayfind-thread`) is faded to
zero opacity above `threadGoneZoom` 18.4, so **at walking height it repaints the
city for an effect nobody can see.** Nobody has measured the frame cost. Gate it
on the thread being visible at all, and measure it with `perf.mjs` before and
after (quote the 4x CPU throttle).

**Z6. Not a defect, a gap:** `?clip=1&from=JES&to=WEL&fit=1` is advertised in
§114 as the recordable URL, and every isolation run that produced it also
carried `intro=0`, which that URL does not. See §116 for what the camera
actually does when the intro is left running.

# PART Z, SECOND HALF — what the pictures found once they existed (same pass)

**Z6 is a defect, not a gap.** `?clip=1&from=JES&to=WEL&fit=1`, the URL §114
advertises as *"a recordable shot of a route with no chrome"*, loaded exactly as
written with the intro running: `fitBounds` lands at t=2 s, **the intro takes the
camera back at t=10 s**, and from t=16 s the frame is the intro's end pose
(z16.9, centre `[-97.7394, 30.2836]`, pitch 72, bearing 2), not the route's. The
route is still drawn — and at z16.9, below `threadFadeZoom` 17.2, the altitude
thread is at full opacity **on top of the buildings**, so it reads as a white line
laid across the rooftops and the tree canopies. Either put `intro=0` in the
advertised URL or make `?fit=1` wait for the intro to finish.
Frame: `shots/walk/final/13-the-advertised-recording-url-ends-on-the-intro-pose.png`.

**Z7. On a phone the answer column is 197 px wide and can never be wider.**
`#wf-pill` is `position:absolute; left:50%; transform:translateX(-50%)`, so its
shrink-to-fit available width is `100% - 50%` = 196.5 px on a 393 px screen and
the `max-width:calc(100vw - 32px)` in the `@media(max-width:640px)` block **never
binds**. Result: the headline wraps to two lines and `Show route` wraps inside
its own button. One line in the media block: `left:16px; right:16px;
transform:none`. Nothing collides with the existing controls — that was measured
box by box and is fine.

**Z8. The open bottom sheet covers the joystick.** At 393x852 the sheet takes the
bottom ~230 px and `#joystick-zone` sits at y 682-782, entirely inside it.
`docs/walk/interface.md` §4 says the joystick and the hint are hidden at this
width while searching; nothing in the shipped CSS does that.

**Z9. Typing a partial word still puts the wrong Jester first.** §114 fixed the
exact code — `JES` returns `JES` — but `jest` returns **JCD Jester East Hall**
ahead of **JES Beauford H. Jester Center**, because the rung sorts routable-first
then shortest display name. Both are on screen so nobody is misrouted; it is
still the wrong first row. And in the same panel, `#wf-list`'s `max-height:196px`
cuts the `+ N more — keep typing` row in half so it collides with the hint line.
`shots/walk/final/09-typing-jest-shows-both-jesters.png`.
