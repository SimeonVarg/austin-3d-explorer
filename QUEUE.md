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

**W8. The Texas Union's main door is in a courtyard notch** (PART L, **L2**).
The placement is not broken — the notch is real and the door is on its wall —
but it faces north into a courtyard, not the West Mall, and the Union is one of
the two buildings named for carved inscriptions. **Needs a photograph before any
code**: which elevation, and is there lettering on it.

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

**X1. THE CAMERA CANNOT GO BELOW 18 m, AND THIS IS THE ONE TO SHOW SIMEON
FIRST.** `js/controls.js:85` `ALT_MIN = 18`. Any scripted pose under 18 m of eye
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

## Not negotiable

1. **Never register a self-hosted GitHub runner.** Public repo.
2. **Never remove the watchdog or reaper in `scripts/verify/chrome.mjs`.**
3. **Never leave a browser or a server running.** `reap.mjs` and kill the server.
4. **Record every pass in `HANDOFF.md`** with the branch name.
