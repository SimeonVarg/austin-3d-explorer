# QUEUE — Acer lane

## THE OVERNIGHT BLITZ, IN PLAIN WORDS (morning of Aug 16 — full story in HANDOFF §127, pictures in `shots/blitz/final/`)

Eight PRs merged overnight, nothing merged red, and the app is recordable
right now. What you'd notice: **you can type a building and walk to it**
(120 of 198 route, all 24 West Campus towers findable), **the Drag's upper
walls read as real masonry instead of a barcode**, **the ground has grain up
close**, **the app boots about three-quarters of a second faster** because the
door file now loads while you look at the city instead of before it appears,
and **`?clip=1&preset=cinematic` gives a clean chrome-free frame for the AWS
recording** (frame 01 in the final folder). Doorways on 57 buildings got their
era looks from UT's own occupancy register — judged blind against the old
build at seven poses: never worse, invisible from altitude. Still open, on
purpose: the windows-vs-storeys decision branch (PR #164) and the July docs
PR (#5). The two biggest unpaid bills are unchanged: nobody has measured the
frame cost of everything that landed (K1), and campus/West Campus walls still
need the Drag's close-range treatment (Y5's second half).

**UPDATE, later on Aug 16 (§131):** that second half is **DONE and merged** —
campus (#178) and West Campus (#179), both judged blind against the live site
and both WON. Walk the South Mall or Guadalupe now and the walls above the
doorways read as floors, not as a pegboard. **The remaining wall defect is the
VERTICAL barcode**, which is a shared-atlas problem in `js/facades.js` and is
written up as Y19. K1's frame cost is still unmeasured and still the top risk.

---

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

## K1. Measure performance and set a budget — JOBS 2 AND 3 DONE AND GATED 2026-08-16 (§143)

> ### GATED 2026-08-16 — read this before the list below, three of its numbers were the machine
>
> `docs/perf/measured.md` **§7** is the AFTER column, taken on the first quiet
> machine this project has had. HANDOFF **§141/§142/§143**, branch
> `acer/n6-boot`, merged.
>
> * **JOB 2 (facade atlas) — DONE.** 40.5–52.1 % of main-thread self time at
>   cruise → **1.9–3.0 %**. The 15–20 % below was LOW; the real figure was
>   38–52 %. `js/facades.js` `FACADE_ATLAS.RELEASE`.
> * **JOB 3 (`updateSky`) — DONE, and it was never the hog.** Measured with its
>   own CPU timer it is **0.69–2.5 ms per call**, not the 2–8 ms/frame §128
>   predicted. `window.__sky` now exists — that is `budget.md`'s G10.
> * **FRAME TIME, at last:** cruise best frame **47.8 → 15.2 ms**, walking at
>   night **27.6 → 10.8 ms**; frames per 3 s sweep 56 → 163 and 98 → 167. All 8
>   after-reps beat all 8 before-reps, no overlap.
> * **JOB 1 (boot) — PARTLY, and the number was wrong.** On an idle machine the
>   "2,744 ms task" is **702 ms** and the "7.07 s of blocking" is **2,236 ms**.
>   **Downtown is on the skyline at 6.1 s, not 24 s** — the 24 s was contention
>   plus the 10.5 s intro flight. The reorder in `js/outer.js` moved the worst
>   quiet rep 9,778 → 6,359 ms; the best case only moved 227 ms. `buildScene` is
>   still one synchronous block and is still `js/app.js`.
> * **JOB 5 (shader compile) — did NOT reproduce** at cruise (~0 %), but the
>   sweep started with programs already compiled. Probably a first-flight cost.
>   Still open, still needs the layer count.
>
> **Still not established:** anything under Simeon's real load, anything on a
> phone or a throttled CPU, and GC share went UP 0.5 → 2.2 %.

**The measuring half is DONE and the three documents exist** (HANDOFF §133,
branch `acer/n1-perf`):

| | owns |
|---|---|
| `docs/perf/payload.md` | bytes and node-side parse, off disk |
| `docs/perf/budget.md` | the frame budget, written by reading — a prediction |
| **`docs/perf/measured.md`** | **what a frame and a boot actually cost in Chrome** |

**The five things it found, in the order to fix them.** Nothing below was
fixed — every one of these files belonged to another lane the night it was
measured.

1. **Boot blocks the main thread for 7.07 s out of the first 8 s, and one
   single task is 2,744 ms.** This is Simeon's own complaint, photographed at
   `shots/perf/boot-downtown-*.png`: veil gone at ~5 s, city completely FLAT at
   8 s, campus built by 16 s, **downtown skyline not on screen until 24 s.**
   `payload.md` says JSON parsing is ~15–20 ms a file, so **the freeze is not
   parsing** — it is what happens after, in `addSource` and the atlas build.
2. **The facade atlas is 15–20 % of every moving frame** (`getImageData` +
   `patchUpdatedImages` + `getImage`), with the time of day held CONSTANT. That
   is new-combos-entering-view, not the tod repaint. `js/facades.js`.
3. **`updateSky` is 93 % of everything that runs on a camera move** and 6–9 % of
   all main-thread time. `budget.md` §128 predicted 2–8 ms and attached a
   falsifier; the falsifier is not met. One function, no throttle, no counter.
   `js/sky.js`.
4. **Y7 ~40 ms, Y15 ~150 ms** — see those entries, both restated with numbers.
5. **16 % of a cruise frame is `getProgramParameter`/`getShaderParameter`** —
   MapLibre compiling shaders mid-flight against 219 style layers.

**What is NOT established and must not be read as clean:** frame time (2–10×
rep noise on a machine at 91–100 % CPU — there is no fps number in the
document), total wire bytes, anything on a real phone or a throttled CPU, and
`js/shadows.js`'s 2,428-hull rebuild plus the 4/s tod tick, which need the
autoplay clock running. **"Autoplay while walking" is still the worst state the
app can be in and is still unmeasured.** Full list in `measured.md` §6.

**`scripts/verify/perf-budget.mjs` is RED on `main` and should stay red** — it
was watched failing on the real overrun and watched passing on the same build
with loosened thresholds, so it is known to work. Do not re-baseline it.

### The original entry, for the record

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

**W3. `data/entrances.geojson` is now 6.38 MB raw / 396 KB gzipped, 14,242
features, loaded as a flat GeoJSON source.** (Was 5.44 MB / 11,890 — the
measured-era bake grew it, PR #166.) **HALF DONE (2026-08-16, §126): it no
longer loads at boot** — `ENT.defer` fetches it at first idle + 2 s, or when
the camera descends below 60 m, or on a 25 s ceiling; measured off the boot
path (city-up 10.85 -> 10.08 s min-of-3, `boot.mjs`, localhost) with
`?entdefer=0` as the one-build A/B lever and `window.__entDefer` as the
instrument. The TILING half is still open and now heavier: on a phone
connection 396 KB gz + a 683 ms main-thread parse still lands in one lump at
idle — tile it the way the note in `js/entrances.js` anticipates if that lump
ever shows up in a real profile.

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

**~~W7.~~ DONE — and it turned out to be ALREADY SHIPPED; this entry was stale
(2026-08-16, §126/PR #166).** Gates-Dell's door was moved 22 m out to the
Speedway wall by `66699d9` before the blitz; a baseline bake on the exact
pre-blitz tree reproduced the committed geojson byte-for-byte, and the X4
pass verified the GDC centroid stayed byte-identical through the self-block
fix. The original entry follows for the record: a measured OSM
`entrance=main` node landed inside a 28.7 m hero piece and rendered 0 pixels
from all 16 bearings tried.

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

**~~X4.~~ DONE — the march no longer tests a door against its own building
(2026-08-16, PR #166, HANDOFF §126).** A mass with IoU >= 0.90 against the
host footprint (`SELF_IOU`, threshold measured off a bimodal distribution:
1,391 < 0.5, six between, 57 >= 0.9) is excluded from that host's burial test
and clear-space march. Buried doors 7 -> 5; Sterling House and The Nine were
self-blocks and keep their placed doors; GDC's centroid byte-identical.
Judged in pixels at seven poses, never worse. Still unsettled from the
original entry: whether Cambridge's glazing is on that elevation (X8's probe).
The original entry follows for the record.

**X4 (original). Cambridge Tower's door is blocked by CAMBRIDGE TOWER, and the bug is in
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

**Y7 — RE-MEASURED AGAIN 2026-08-16 ON A QUIET MACHINE (§143,
`docs/perf/measured.md` §7.6). STILL OPEN. The honest floor is ~17 ms, not
43.3 — that figure was contention, and it does not matter, because it is STILL
over budget.** `perf-budget.mjs` G3 on the merged tree read **17.30 ms** and
**19.90 ms** at 15–29 % CPU with 27–32 Chrome processes: the two lowest readings
anyone has ever taken of this scan, and both **2.2× over the 8 ms budget**. The
claim to carry forward is not a number, it is: **there is no machine state in
which the outer-ring scan comes in under budget** — 17.3, 18.6, 37.9, 40.1, 43.3
and 154 ms across four separate passes and every machine state tested. Still
`js/controls.js:475`, still not this lane's file. **Rank it FOURTH still** — but
note the two things that outranked it (the atlas and the sky) are now FIXED, so
Y7 is the top REMAINING frame cost. Y15 could not be measured a third time: every
walk rep ended at **altitude 23.8 m** (QUEUE Y16's silent lift, third sighting),
so the trunk field was gated off and the guard correctly printed no figure.

**Y7 — RE-MEASURED 2026-08-16 (§133, `docs/perf/measured.md` §3.2). STILL OPEN,
still ~40 ms, and now budgeted.** Driven three ways on the merged tree, minimum
of interleaved counterbalanced reps, machine at 91–100 % CPU with the load
printed beside every reading: **43.3 ms** worst instalment over a natural
1,500 m cruise at 420 m, **40.1 ms** over 200 m hops at 1.7 m, 27.2 ms on a
forced rescan after a teleport. §109's 37.9 ms reproduces and is if anything
optimistic. **It has never come in under its 8 ms budget on any machine state
anyone has tested.** `perf-budget.mjs` G3 fails on it every run. Not fixed —
`js/controls.js` belonged to another lane. **Rank it FOURTH**: the sky redraw
(every frame) and the facade atlas (every frame) each cost more per second than
this does, and both were found the same night. Original entry follows.

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

**~~Y10.~~ DRIVEN, RANKED, and FIVE OF SEVEN FIXED (PR #185 and PR #187,
HANDOFF §139 and §144).** The city has now been driven by thumb at 1.7 m,
twice: the survey is `docs/mobile/driving-at-eye-level.md`, the near-plane pass
is §139/§140, and the chrome pass — every item that lived in `style.css` — is
§144. **NOT A REAL IPHONE AND NOT REAL SAFARI** — Chromium in a phone costume
(393x852, dpr 3, `isMobile`, `hasTouch`, real CDP touch events). Touch handling,
layout and geometry are solid; frame rate, memory, battery and heat on Simeon's
actual phone are untested and unpredicted.

**Fixed: item 1, the vertical look.** At 1.7 m the whole pitch range is
3.58 deg, which at the authored 0.11 deg/px was 33 px of thumb, so every 150 px
swipe landed on the opposite stop and the other ~117 px moved nothing — it read
as a hang. `LOOK.PITCH_SPAN_PX = 300` in `js/controls.js` fits the sensitivity
to the range that exists and **can only ever slow the look down**
(`Math.min` against the authored value). Measured, real touch, 3 interleaved
reps each: stock lands on the 84.42 floor 3/3; fitted stops at 86.21 3/3, about
half the range, no stop hit. Above 18.47 m the authored value wins by
arithmetic, and a real 150 px mouse drag at 165 m gives dPitch −19.50 /
dYaw 330.00 identically with the fit on and off, 3/3 reps.

**Fixed: items 3, 4, 5 and 7 — the whole `style.css` set (PR #187, §144).**
Before/after frames, real touch at 393x852, day and night:
`shots/mobile/final2/`.
- **item 3, BOOST — Simeon's own complaint, twice, and now moved rather than
  redressed.** It was 60x44 with its nearest corner **53.0 px** from a 50 px
  ring, on the same side and the same thumb as the stick, the only rounded
  rectangle among controls that are all discs and pills, and **0.94x the frame
  median off / 1.74x on with its brightest pixel ON equal to the brightest
  pixel in the whole frame**. It is now a **64 px disc mirrored to the right
  edge**, wearing the joystick base's own wash and ring with the knob's amber
  as its mark. Separation **3.0 px -> 147 px**; left thumb steers, right thumb
  sprints. Off->on is now a colour change, not a flare: **chroma 73.9 -> 129.2
  by day, 4.2 -> 71.1 by night**, and luma actually FALLS by day (161.6 ->
  140.2) because amber is darker than limestone. Luma alone would have called
  that "no change" — see §144, it nearly did.
- **item 4** — the graphics sheet was 393x596 at y256, exactly 70.0% of the
  screen, with `elementFromPoint` returning `SPAN.gfx-group-note` at the
  stick's centre. It now stops at `--drive-clear` (186 px) with its top edge
  unmoved, and both drive controls hit-test to themselves with it open. The
  gear, the feedback button, the day/night play button and the time slider's
  drag band all went to **44 px on phone only** (desktop still 34/30/18).
- **item 5** — `?clip=1` is byte-for-byte the mode it was; **`?clip=1&drive=1`**
  is the opt-in that keeps the stick and BOOST and nothing else, so a phone can
  walk through a shot. The OpenStreetMap credit is present in both.
- **item 7** — `controls-hint` was 404.5 px wide at x = −5.8 on a 393 px
  screen, clipped at BOTH edges; now 362.5 px at x = 15.3, one line, inside the
  glass. Bought with `--hint-fs`, not with wrapping: the only row in the bottom
  third clear of both controls is that one, and a second line grows into them.

**Still open: item 6, and it is now the only one.** The two-finger altitude
gesture goes the wrong way — pinching CLOSED lifts you, against the universal
map convention — and nothing on screen says which way or marks "you are back on
the pavement". Not fixed here: it is `js/controls.js` gesture semantics, not
chrome, it needs its own before/after drive (the survey's own numbers for it are
caveated — four of five gestures were measured from the wrong starting
altitude), and inverting it silently would change a gesture the recording brief
may already depend on. **The double-tap-and-drag gesture is still untested by
anybody** — `TAP_MS` is 280 ms and the smallest gap that instrument could
produce was 2,012 ms.

What still works and should not be spent time on: `collision.mjs` 8/8,
`movement.mjs` **14/14** (including the diagonal assertion that was straddling
its tolerance), `motion-feel.mjs` 20/20, zero page errors in every run.

**~~Y11.~~ DONE — nine frames shot at 1.7 m, p 0.55/0.62/0.70, three sites
(HANDOFF §117, `shots/blitz/y11-*.png`).** The dusk SKY at eye level is the
best thing in the frame set — the Tower against the p 0.62 gradient
(`y11-southmall-p062.png`) is the frame to show. What the transition breaks is
now Y17 (the ground plane does not ride the dusk clock) and Y18 (the
post-process canvas paints glow bands across facades). Both were found by these
frames and both are measured below.

**~~Y12.~~ FIXED, AND NARROWER THAN THE ENTRY CLAIMED (PR #185 merged
2026-08-16, HANDOFF §139).** `WALK_NEAR` in `js/app.js` scales the near plane
with altitude — 0.12 m at or below 2 m, MapLibre's own value at or above 40 m,
blended in log space — and it is a **strict no-op above 40 m**, proved rather
than asserted: `projectionMatrix` and `modelViewProjectionMatrix` bit-identical
with the hook on and off at all 12 flyover poses and all 5 `shots-places` poses,
on desktop AND phone, with two control probes at 1.7 m and 20 m that DIFF so the
test is not inert. Lowest non-control altitude in the whole flyover: 57.1 m.

**The gates it had to pass, on the merged tree:** `coplanar.mjs --gate` **exit 0,
"no file gained a coplanar pair"**; `zfight.mjs` on five eye-level poses run
twice, hook on and hook off, **every flicker percentage and every cluster
identical to the pixel and to the screen box** (southmall 0.023 %, drag-day
0.554 % / 7 clusters, drag-night 0.016 %, westcampus 1.078 % / 12 clusters,
mid20 0.550 %); `zfight` on `westcampus-day` **242 px @ [642,827,869,895] in
both arms, min of 3 interleaved reps** — the same box W6 has reported since §95.
Flyover pixels: 24 frames across two viewports, 23 byte-identical, the 24th
inside its own A/A noise floor.

**Two corrections to what this entry and §108 said, both found by looking:**
1. **The near plane is `t.nearZ / t.pixelsPerMeter`, not
   `(cameraToCenterDistance / 50) / pixelsPerMeter`.** The second is MapLibre's
   default *formula* and reads the same number whether the hook is on or off —
   it made a first run of this gate report "no change" everywhere. The real
   stock value on a phone at 1.7 m is **0.72 m at pitch 87 and 1.08 m at the
   88 deg cap**, not the 0.97 the drive doc recorded.
2. **A plain wall never vanished, and the "3 cm margin" was an artefact.** The
   collision field is a **6 m grid** (`CELL = 6`), so `roofAt(p, 0.5)` cannot
   locate a drawn face to better than metres. Driven into the Main Building
   block by real touch, the app stops you with the wall **fully drawn and
   solid**, and the before/after frames at that identical pose are **0 differing
   pixels against a 0-pixel A/A floor at every pitch from 84.5 to the 88 cap**:
   `shots/mobile/final/01-*`.

**So what it actually buys, measured, and it is narrow.** A/B sweeps with an A/A
floor at every step: at a South Mall live oak, **95.7 % of the frame at 1.0 m and
14.9 % at 1.5 m, nothing at 0.5 or 2.0 m** (`final/02-*`). But the joystick
**stops a walking user at 1.67 m from that trunk, where the A/B is 0 px**
(`final/03-*`), and on four real walks — South Mall, the Drag, West Campus,
Speedway, 24 poses — only one non-tree pose changed at all (the Drag, 0.34 %).
**The fix is correct and free; its visible benefit to someone walking is small.**

**What it does NOT fix, and this is the drive doc's own headline frame:** a crown
you are standing INSIDE cannot be recovered by any near plane, because its near
face is behind the eye. Every tree-lined path is still a corridor of poles at
1.7 m. That is now the open half and belongs to `js/trees.js`, not the transform.

**And the new cost, which is correct rendering rather than a bug:** pressed
against a surface you now get a featureless field instead of a view through it
(`final/04-*`). "Walk into a tree and the screen goes brown" is the next thing
someone should look at.

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

**Y15 — MEASURED FROM A WALK AT LAST, 2026-08-16 (§145). The worst incremental
trunk scan on a real walk is 86.6 ms, and the duty cycle is the worse number.**
`scripts/verify/walk-trunk.mjs 3`, steered walk at 1.7 m against a hop control,
3 interleaved counterbalanced reps, one page load each, minimum of the reps'
maxima, headless `gl:hardware`, no CPU throttle, **another lane running
`collision.mjs` at 90–100 % CPU for the drag reps**:

| site | walk worst | hop worst | avg | duty (budget 0.53 %) |
|---|---:|---:|---:|---:|
| the Drag | **86.6 ms** (3/3 valid) | 53.4 ms | 11.64 ms | **1.31 %** |
| South Mall | **78.3 ms** (1/3 valid) | 57.9 ms | 10.18 ms | **1.41 %** |

**10.8× over the 8 ms budget, about five dropped frames — not the fifty §109's
841.5 ms implied. Neither 841.5 nor 149.8 reproduced.** The new finding is the
duty cycle: a walk crosses `TRUNK_RESCAN_M` continuously and runs 90–101 scan
instalments in 85 s against the hop's 6–22, so **the walk is worse than the hop
on the metric that matters and better on the one that has always been quoted.**
Still open, still the same fix as Y7 (`querySourceFeatures` returns the whole
list before `TRUNK_BUDGET_MS` starts its clock). Do Y7 and Y15 as one change.
Caveat: South Mall rests on one valid rep. History follows.

**Y15 — RESTATED 2026-08-16 (§133, `docs/perf/measured.md` §3.3). 841.5 ms DID
NOT REPRODUCE. The honest worst case is 149.8 ms.** Still open, still 19× the
8 ms budget, still about nine dropped frames — but an order of magnitude below
the number that has been sitting in this file, and **it now comes from the
regime a real walk produces** (one 60 m `TRUNK_RESCAN_M` hop, 149.8 ms) rather
than from a teleport (89.9 ms). Minimum of three interleaved reps; the others
read 235.8 / 439.9 / 522.7 / 543.9 ms on a machine at 100 % CPU. Read §109's
841.5 ms as a stale upper bound from a different tree density.

**It had to be measured without a walk, and that is its own finding.** All three
`perf-budget.mjs` walk reps travelled their 120 m and **ended at altitude
23.8 m — the same digit every rep, so it is a mechanism, not noise.** Above
`TRUNK_ALT` (12 m) the trunk field switches off, so a lifted walk measures a
subsystem that is not running; the gate correctly marks G2/G4/G5b `INVALID` and
prints no figure. **QUEUE Y16's silent lift is now blocking a measurement as
well as a camera, and it is the prerequisite for ever closing Y15 properly.**
Not fixed — `js/controls.js` belonged to another lane. Original entry follows.

**Y15. The trunk field's worst incremental scan is 841.5 ms.** Measured in §109:
61 scans, 25.3 ms average, 2,976 trunks, **max 841.5 ms** — about fifty dropped
frames. That run teleported across West Campus ten times, which forces rescans a
real walk would not, so it is an upper bound rather than a typical cost. Same
shape as Y7 and the same fix (spread `querySourceFeatures` across frames by tile
rather than asking for everything). Measure it under a sustained walk first.

**~~Y16 (the harness half).~~ CLOSED 2026-08-16 (§143). THE HARNESS WALKS. The
23.8 m constant was the walk phase's own hard-coded start pose, and there is no
silent lift in the movement path.** `scripts/verify/walk-lift.mjs` traced the
camera frame by frame: `roofAt(-97.74170, 30.28950, 1 m)` is **8.6 m**, i.e.
`perf-budget.mjs` had always started its walk INSIDE A BUILDING, and the hard net
(`controls.js:1617`) ejected it on the first tick at **zero metres travelled** —
`8.6 + HARD_CLEAR(4) = 12.6` — then again once `rCam()` had lerped 1 → 6 m past
`ALT_GROUND`, because the wider probe sees the 19.8 m roof next door:
`19.8 + 4 = 23.8`. Deterministic start, deterministic digit. Fixed in
`scripts/verify/lib/walker.mjs` (refuse any start with `roofAt(p, 7 m) > 0`,
steer along open ground, drive only through key and pointer events, and return
the altitude of EVERY frame). **300 m walked on the Drag with `alt` min 1.7 and
max 1.7 across 3,940 frames.** Gate: `walk.mjs`, watched red at the old start in
the same run. NOTHING IN `js/controls.js` NEEDED TO CHANGE and none was changed.

**Y16 (the app half) — still open, and it is the `setPitch` sighting only.** At
1.7 m you cannot look down: driven through `setPitch` in §109 the pitch is
**granted and the eye is silently lifted** — asked 80 you get 4.23 m, asked 70
you get 8.34 m, asked 60 you get 12.19 m, asked 45 you get 17.23 m. Same verdict
as Y4 (`ZOOM_MAX` is still 21.5), but whoever picks Y4 up should know they are
removing a silent lift, not a block. §132's second "independent sighting through
the movement path" was **not** this — it was the start pose above, and that
sentence in §132 should be read as retracted.

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
Y5  facades at close range ................... DONE for all three districts.
                                                DRAG #167 (2026-08-15, §114/§121);
                                                CAMPUS #178 and WEST CAMPUS #179
                                                (2026-08-16, §129/§130, both judged
                                                blind against the live site in §131
                                                and both WON). Storey lines, no
                                                windows; candidate B (windows) stays
                                                alive on acer/facade-choice (PR #164)
                                                for the later job. WHAT IS LEFT is
                                                Y19 below — the VERTICAL half of the
                                                barcode, which is a js/facades.js
                                                tile problem and nobody owns it.
Y6  motion-feel FOV assertion ................ DONE (acer/blitz-verify, HANDOFF §115).
                                                Repaired to assert the MECHANISM: zero
                                                kick at cruise, TUNE.FOV_KICK (read live)
                                                at the sprint ceiling, exact restore.
                                                Watched failing on an injected fault.
Y7  outer-ring scan worst case ............... OPEN, now MEASURED (§133):
                                                43.3 ms natural cruise / 40.1 ms at
                                                1.7 m. Never under its 8 ms budget.
                                                Ranks FOURTH behind the sky redraw
                                                and the facade atlas.
Y8  the ground plane ......................... TEXTURE half DONE (#170, merged
                                                2026-08-15 after the gate re-proved the
                                                byte-identical-flyover claim: SHA-256
                                                equal with the layers on/off at cruise,
                                                magenta 625,928 px at feet / 0 at
                                                default and cruise — §120, §121).
                                                Daylight feature by measurement; night
                                                grain is nil by design. The GEOMETRY
                                                half (gutter line, door thresholds,
                                                smaller repeat ring) is still OPEN.
                                                PART Z's Z0 (texGroundMaxZoom 25
                                                rejected ground-base-texture on main)
                                                is CLOSED — 25 -> 24, PR #172, §123.
Y9  labels sized by zoom not metres .......... OPEN
Y10 touch at walking height .................. FIVE OF SEVEN FIXED. Item 1 (#185,
                                                §139); items 3/4/5/7, the whole
                                                style.css set, in §144. Item 2 is Y12
                                                and closed. ITEM 6 IS THE ONLY ONE
                                                LEFT — pinch-closed lifts you, which
                                                is backwards, and the double-tap-drag
                                                gesture is still untested by anybody.
                                                NOT REAL iOS SAFARI, still.
Y11 dusk at eye level ........................ DONE (§117, shots/blitz/) — found Y17+Y18
Y12 the near plane ........................... DONE (#185, §139) and NARROWER than the
                                                entry claimed. Flyover matrices
                                                bit-identical, zfight identical on/off,
                                                coplanar --gate exit 0. A plain WALL
                                                never vanished (the 6 m collision grid,
                                                not a 3 cm margin); a trunk at 1.0 m did
                                                and now does not. The CANOPY you stand
                                                inside is still unfixable this way and
                                                is the open half — js/trees.js.
Y13 the moon behind a building ............... CLOSED (§117) — disc occluded, 0 px through wall
Y14 places-check / zfight not run ............ CLOSED (both at baseline on 38fbeee, §115)
Y15 trunk field worst scan ................... OPEN, MEASURED FROM A WALK (§145):
                                                86.6 ms worst (Drag, 3/3 reps),
                                                78.3 ms (South Mall, 1/3), against
                                                an 8 ms budget. 841.5 and 149.8 both
                                                failed to reproduce. The duty cycle
                                                is the real damage: 1.31-1.41 %
                                                against 0.53 %. Fix it with Y7.
Y16 the silent lift out of walking height .... HARNESS HALF CLOSED (§145): there was no
                                                silent lift. perf-budget's walk phase
                                                started INSIDE A BUILDING and the hard
                                                net ejected it at 0 m; 23.8 m is
                                                roofAt(that start, 6 m) + HARD_CLEAR.
                                                scripts/verify/lib/walker.mjs walks now
                                                — 300 m at 1.7 m, every frame proved.
                                                APP HALF STILL OPEN: the setPitch
                                                lift of §109, which is Y4's job.
Y17 ground plane ignores the dusk clock ...... NEW  (§117) — pavement 2.3-2.9x wall luma at p 0.70
Y18 fx-canvas paints glow bands on facades ... NEW  (§117) — dusk AND night, A/B proven
Y19 the VERTICAL half of the barcode ......... NEW  (§131) — Y5 is done, this is what
                                                Y5 did not touch. See below.
```

**The one-line verdict on the Drag at night:** it is genuinely better — no stars
on the brick, and a carriageway that went from 0.78x the frame median to 1.40x —
but **Y5 is what is still between it and good.** The shopfronts are excellent and
the 40 m of wall above them is a barcode, and that is the first thing your eye
goes to.

---

## N5. ~~`coplanar.mjs` cannot see the storey trim~~ — FIXED 2026-08-16 (§134),
## ~~and it found ten real coplanar pairs on the Drag~~ — N5a AND N5b BOTH
## FIXED 2026-08-16 (§135, branch `acer/n7-cornice`). N5c stands as a baseline.

The checker keyed on `h`/`height` and scanned a hardcoded list of eight files,
so it silently skipped **882 extrusion rings** — 640 in `campus_storeys.geojson`
(not in the list at all), 219 in `westcampus.geojson` and 23 in `drag.geojson`
(all `dbase`/`dh`). It printed "1144 features, no coplanar overlaps" on a file
holding 1363. The tool is rewritten: it scans every `data/*.geojson`, prints
`examined / flat / unreadable` on every file, fails hard on anything it cannot
interpret, and audits its own vocabulary against every `fill-extrusion-height`
and `fill-extrusion-base` expression in `js/*.js`. `--selftest` is eight
assertions that make it fail on purpose. **What it then found is below, and
§135 fixed both of them the same way: the trim moves, not the wall.**

### N5a. ~~Ten cornices on the Drag sit flush with the wall band they cap~~ — FIXED

`data/drag.geojson`, every `part:"cornice"` in the file — ten of them, one per
building. The cornice's `dh` lands **2 to 4 mm** under the top of the `upper`
wall band it rings, and the ring's footprint is **100 % inside** the wall's:

| wall | wall top | cornice | cornice `dh` | gap | shared |
|---|---|---|---|---|---|
| #26 | 15.500 | #30 | 15.498 | 2 mm | 1878 m² |
| #34 | 12.950 | #37 | 12.946 | 4 mm | 1446 m² |
| #47 | 8.650 | #49 | 8.650 | 0 mm | 661 m² |
| … | | | | | ~6,300 m² total |

2 mm is inside the depth-buffer quantum at any flying distance. `node
scripts/verify/coplanar.mjs data/drag.geojson` lists all ten.
**Owner: whoever owns `scripts/bake_drag.py`** — the fix is a lift in the bake,
not in the data, and `docs/` should say which way (cornice proud ABOVE the band
top, or band top pulled down to the cornice base). **Do not fix it by widening
`--eps`.**


**FIXED 2026-08-16, §135.** `scripts/bake_drag.py` gained `CORNICE_LIFT = 0.03`
and the cornice row now emits `corn[1] + CORNICE_LIFT`. **The trim moved, not
the wall** — a cornice caps a wall, so the stone sits ON the wall head, and the
size and the precedent are `scripts/bake_depth.py`'s `STEP_LIFT` ("two coplanar
top faces z-fight; 30 mm settles it"). Re-baked: **`drag.geojson` goes 10
coplanar pairs -> 0**, 124 features either side, geometry byte-identical,
byte size identical, and the only changed property in the whole file is `dh` on
those ten rings, each exactly +0.030. `storey_details()`'s docstring used to
claim outward offset made coplanarity impossible; it now says which face that
argument actually covers and which one it never did.

### N5b. ~~Fifty-five campus caps and cornices sit flush with their host~~ — FIXED

`data/campus_storeys.geojson`: all **40 `cap` + 15 `cornice`** rings have `dh`
**exactly equal** (0.0000 m) to their host's `final_height` in
`data/snapshots/2026-08-16/buildings.detailed.geojson`. The other 585 rings
(`course`, `base`) are clear by 0.2 m or more.

**`coplanar.mjs` cannot judge this and says so** — the host is a basemap
building replaced by `js/app.js`, so the two surfaces live in different
documents and the tool only ever pairs within one. This was measured by hand
against the snapshot the bake itself reads. It may well be invisible: the roof
**cap** layer runs from `final_height` upward and may cover the tie, and a
proud ring only overlaps the body on its inner edge. **That is a rendering
question, so the instrument is `zfight.mjs` at a campus roofline, not more
arithmetic.** `scripts/bake_campus_storeys.py` line 20 claims "Nothing
coplanar, nothing for the depth buffer to argue"; against its own host heights
that claim is not true, and somebody should either make it true or amend it.


**FIXED 2026-08-16, §135, and it is now a machine check.**
`scripts/bake_campus_storeys.py` gained `HOST_LIFT = 0.03` — `split_ends()`
ends the top piece at `y1 + HOST_LIFT`, and only the top moves, so the storey
span, the fitted pitch and every floor line are untouched. 40 `cap` + 15
`cornice` rings, each `dh` exactly +0.030; 640 features either side; geometry
byte-identical; nothing else in the file changed.

**The important half is the assertion.** `check_host_clearance()` re-reads each
host's `final_height` from the snapshot the bake already loads, runs BEFORE the
file is written, raises on any ring face within `HOST_EPS = 0.01` of the host's
ground or head, and prints `rings_checked / coplanar_with_host / worst_gap_m /
against` on every run — `640 / 0 / 0.03 / final_height in snapshots/2026-08-16`.
**Proved by making it fail**: with `HOST_LIFT` forced to 0 it raises and names
**55** faces, which is the hand count of §134 exactly. So the cross-document
tie `coplanar.mjs` structurally cannot see is now checked by the only thing
that can see it — the bake that reads both documents — and it re-runs when the
snapshot rolls. The header's "Nothing coplanar, nothing for the depth buffer to
argue about" is gone, replaced by what is true: outward offset clears the SIDE
faces and says nothing about the horizontal ones.

**Still not established: nobody has looked at it.** This pass was arithmetic and
bakes, no browser. `zfight.mjs` at a Drag cornice and at a campus roofline is
the confirmation nobody has run — see N5d.

### N5c. Numbers nobody had ever seen, now baselined

`scripts/verify/coplanar-baseline.json` records the per-file counts at
eps=0.01/frac=0.30 so `--gate` goes red only on a NEW pair. **`drag.geojson` was lowered 10 -> 0
in §135**; the gate is green and the total is 2,332. Previously
unmeasured files: `stadium` 313, `outer_ring` 179, `trees` 99, `art` 92,
`drag` 10 -> **0 after §135**, `capitol_parts` 2, and one each in `capitol_dome`, `ground`,
`heroes`. The recorded baselines held: **roofs 85 and places 1 are unchanged.**
`entrances` reads **1558**, not the recorded 1729 — the old number was computed
on `h` as if it were an absolute top when `js/entrances.js` paints
`['+',['get','base'],['get','h']]`, so 1729 was a count of coincident
*thicknesses*. Nobody has looked at whether any of these are visible.

### N5d. Nobody has ever SEEN any of these 2,332 pairs, fixed or not

`zfight.mjs` needs a browser and every N5 pass so far has been pure data. Two
poses are owed, for a lane that already holds a browser: **a Drag cornice at
15.5 m** (Co-op, ≈ -97.74228, 30.28596) before/after §135, and **a campus
roofline** on a family-C `cap` building. If the before frame does not flicker
that is worth writing down too — it bounds how much the remaining 2,332
baselined pairs are worth chasing.

---

## Y19. Y5 fixed the HORIZONTAL barcode. The VERTICAL one is still there, and it
## is a `js/facades.js` tile problem that nobody owns.

Three passes have now put horizontal structure back into the walls as
**geometry in metres** — the Drag (#167), campus (#178), West Campus (#179) —
and a gate judged each of them against the live site and each one won
(§121, §131). That closes Y5 as written.

What none of them could touch is the **other axis**. The West Campus builder
measured it on the base band under Dobie Twenty21 and wrote the number down:
**48.56 vertical edges per 100 px against 1.12 horizontal**, i.e. at eye level
that wall is a *vertical* barcode and always was. `facades-at-two-metres.md` §2
has the mechanism and the table: `drawWallMaterial`'s `WALL.STREAKS` and the
`WALL.PIER` pilaster pair are drawn **full tile height**, and the tile repeats
vertically, so family `mh` puts **17 full-height verticals in 2.06 m of wall —
one every 0.121 m** at walking height. It is the same screen-locked-repeat
defect, rotated 90 degrees.

**Why no lane has fixed it.** It lives in the shared facade atlas, which paints
downtown, the outer ring and the Capitol as well as campus, so it cannot be
changed for one district — PR #167's day/night tile swap worked only because
`js/drag.js` owns its own tile. Whoever takes it must either fade the verticals
out below a metres-per-repeat threshold (the honest analogue of what the storey
bands did), or give the districts that matter their own tile the way the Drag
has. **Do not fix it by making the pier lighter**; that is the "it looks
plausible" trap the reference playbook names.

Cheaper and also open, from the same pass: `WC_BASE_LINES` is a named constant,
default `False`, one line to flip — the West Campus base band was deliberately
left alone because the entrances and places passes already model 24 lobbies,
canopies, sign bands and shopfront reveals there in metres.

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
# §116. **PR #169 MERGED 2026-08-16 after a second fresh-eyes pass re-ran every
# gate on the merged tree (HANDOFF §122): Z1-Z3 closed below, Z4 stays with the
# graph bake, Z5-Z9 stay open.** The original header said: the routes are
# right; four things the interface says or fails to draw are not.

**The one-line verdict.** The routing is the best-verified thing in this repo —
eighteen pairs driven in a real browser, every distance identical to the bake's
audited table, nothing routed through a building that OSM does not mark
`covered=yes`. What is not ready is the picture and the wording around it.

**~~Z0.~~ CLOSED — `texGroundMaxZoom` 25 → 24 (PR #172, 2026-08-16, HANDOFF
§123). The layer is in the style (219 layers, was 218), zero rejection lines on
load, magenta-masked 154,097 px at the eye pose (was 0), and cruise/default
stayed at the measured floor.** The original entry:

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

**~~Z1.~~ CLOSED — the ghost is in the style, the stops are computed from
named constants, and its own pixels are photographed crossing a building
(2026-08-16, HANDOFF §122, merged in PR #169).** `ghostWidthExpr()` does the
clamp arithmetic in JavaScript and hands MapLibre the bare top-level
interpolate; driven on the merged tree it reads back exactly 15:1.65 /
21:27.30, the layer sits in the style, and the console is free of wayfind MAP
ERRORs on every load. The photograph nobody had: `shots/walk/gate2/
_z1-ghost-pixels-magenta.png` — the ghost layer toggled off at a fixed pose,
the 4,345 px that vanished painted magenta: dashes ON the dark building mass
along the BTL>PMA line, solid ribbon on the open walkway beside it. The
original entry: §114 recorded
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

**~~Z2.~~ CLOSED — From defaults to the routable building nearest the camera,
and the placeholder says exactly that (2026-08-16, HANDOFF §122, merged in
PR #169).** Placeholder `Nearest building to the view` (added to the honesty
doc §11 first), field pre-filled on open, and empty From + Enter now picks the
same default and routes — all three driven on the merged tree. The withdrawn
sentence `Where I am standing` renders nowhere. The original entry:
its placeholder was
`Where I am standing`. There is no `navigator.geolocation` anywhere in the file
and no camera-position default; leave From empty, press Enter on a valid To, and
**nothing happens at all** — `run()` returns on `!state.from`. `interface.md` §2
specifies a pre-filled `Here · near Speedway at 24th` taken from the camera, and
that is the flow in Simeon's own brief ("get a route from where you are").
Either build the camera default (it needs no permission and no prompt) or change
the placeholder to something true. Shipping the sentence without the feature is
the one failure `what-we-can-honestly-say.md` §9 names by hand.

**~~Z3 (client half).~~ CLOSED — every register code is findable and a dead
one answers honestly and clears the stale route (2026-08-16, HANDOFF §122,
merged in PR #169).** The register rides along with the graph fetch; `SMC`,
`NUR` and `UTA` each show greyed `not walkable yet`, Enter answers `<code> is
not walkable in this build yet`, and a route drawn immediately before is gone
from every wayfind source (113 strip features → 0, measured). **The graph
half — actually ROUTING those codes — is Z4's bake and stays open.** The
original entry: 85 of the 198 UT register codes returned NOTHING when typed,
including
`NUR`, `SMC`, `HDB`, `HLB`, `HTB`, `UTA`, `ACS`, `ANB`, `BMS`, `BMK`, `WMB` and
`WAT`. `walk_graph.json`'s `code` map holds 113 of 198; 111 are routable and 2
(`BIO`, `TSG`) are shown greyed with "no door mapped", which is the right
behaviour. The other 85 are not in the index at all, so the list is empty and,
as `interface.md` §1 says, **an empty list reads as "you typed it wrong" rather
than "we don't have it".** §114 asked for this as a schema change to
`scripts/bake_walk.py` and it is not done: add the remaining register codes with
an empty door list.

**~~Z4.~~ CLOSED (2026-08-16, HANDOFF 136 — all 24 towers route, verified by a second independent router on the shipped wire file). Original entry:** Six of the twenty-four West Campus towers are not in the graph at all —
**21 Rio, Skyloft Austin, The Quarters Sterling House, The Block, Pointe on Rio,
The Venue on Guadalupe**. All 24 are in `data/westcampus.geojson` with lobby
doors; `walk_graph.json`'s `wc` map has 18. Simeon's brief says "works with
wampus apartments too", and **§113's own audited table advertises a
`21 Rio > WEL` route that the shipped client cannot produce** — typing `21 Rio`
returns nothing. And it is not a hypothetical: **`21 Rio` and `Pointe on Rio` are
both LABELLED ON SCREEN** in the golden-hour hero frame
(`shots/walk/final/90-hero-unchanged-origin-main.png`). A student reads the name
off the city, types it, and gets an empty list. `scripts/bake_walk.py`.

**~~Z5.~~ CLOSED and MEASURED (2026-08-16, HANDOFF 137 + 138 — 0.0 setPaint/s and 0.0 render/s at walking height, tab-hidden and 14 s after drawing; was 7.8-9.7). Original entry:** A drawn route repaints the whole city fifteen times a second, forever.
`startPulse()` runs a `requestAnimationFrame` loop that calls
`setPaintProperty(..., 'line-gradient', ...)` at `pulseFps` 15 for as long as a
route is on screen. Every one of those marks the style dirty and forces a full
repaint of a scene that measures 3.7 fps on a software rasteriser and ~35 fps on
this laptop's GPU. Worse, the layer it animates (`wayfind-thread`) is faded to
zero opacity above `threadGoneZoom` 18.4, so **at walking height it repaints the
city for an effect nobody can see.** Nobody has measured the frame cost. Gate it
on the thread being visible at all, and measure it with `perf.mjs` before and
after (quote the 4x CPU throttle).

**~~Z6.~~ CLOSED (2026-08-16, HANDOFF 137 + 138 — the fit waits for the intro and frames the route at t=43.8 s, pitch 55). Original entry:** Not a defect, a gap: `?clip=1&from=JES&to=WEL&fit=1` is advertised in
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

**~~Z7.~~ CLOSED TWICE (2026-08-16, HANDOFF 137 for the width, 138 for the button it still sat under). Original entry:** On a phone the answer column is 197 px wide and can never be wider.
`#wf-pill` is `position:absolute; left:50%; transform:translateX(-50%)`, so its
shrink-to-fit available width is `100% - 50%` = 196.5 px on a 393 px screen and
the `max-width:calc(100vw - 32px)` in the `@media(max-width:640px)` block **never
binds**. Result: the headline wraps to two lines and `Show route` wraps inside
its own button. One line in the media block: `left:16px; right:16px;
transform:none`. Nothing collides with the existing controls — that was measured
box by box and is fine.

**~~Z8.~~ CLOSED (2026-08-16, HANDOFF 137 — sheet y324..634, stick y682..782, elementFromPoint returns the joystick). Original entry:** The open bottom sheet covers the joystick. At 393x852 the sheet takes the
bottom ~230 px and `#joystick-zone` sits at y 682-782, entirely inside it.
`docs/walk/interface.md` §4 says the joystick and the hint are hidden at this
width while searching; nothing in the shipped CSS does that.

**~~Z9.~~ CLOSED (2026-08-16, HANDOFF 137 — seven ranking cases green, the +N more row is out of the scroller). Original entry:** Typing a partial word still puts the wrong Jester first. §114 fixed the
exact code — `JES` returns `JES` — but `jest` returns **JCD Jester East Hall**
ahead of **JES Beauford H. Jester Center**, because the rung sorts routable-first
then shortest display name. Both are on screen so nobody is misrouted; it is
still the wrong first row. And in the same panel, `#wf-list`'s `max-height:196px`
cuts the `+ N more — keep typing` row in half so it collides with the hint line.
`shots/walk/final/09-typing-jest-shows-both-jesters.png`.

---

# PART Z — THE STATE OF IT, 2026-08-16, overnight (HANDOFF §136, §137, §138)

**Z0 CLOSED. Z1 CLOSED. Z2 CLOSED. Z3 CLOSED, both halves. Z4 CLOSED, both
halves. Z5 CLOSED. Z6 CLOSED. Z7 CLOSED. Z8 CLOSED. Z9 CLOSED.** Everything
above this line is kept for the record and every entry in it has been
answered; read this block for what is true now.

**Z3 / Z4 — closed, and the QUEUE was the last thing still saying otherwise.**
All 24 West Campus towers are in the graph and every one routes end to end
(§136 decoded the shipped wire file with a second, independent router: 21 Rio
843 m, Pointe on Rio 1,017 m, Quarters Sterling 925 m, Skyloft 718 m,
The Block 1,436 m, The Venue 1,140 m). Every name the search offers is
routable, and a register code the graph lacks answers `SMC is not walkable in
this build yet` rather than showing an empty list. **120 of 198 register codes
route**, on two independent measurements.

**Z5 — closed, and MEASURED, not read.** A drawn route no longer repaints the
city forever. Headed Chrome, real GPU (RTX 3050 Ti, D3D11), 4 s windows,
three interleaved reps, minimum reported, noise floor first, machine at
25-99 % CPU with three sibling workflows running:

```
condition                         BEFORE (main)      AFTER
                                setPaint/s render/s  setPaint/s render/s
no route (FLOOR)                    0.0      0.0        0.0      0.0
route, cruise, thread visible      11.2     26.7        8.7      8.9
route, WALKING, thread invisible    7.8      9.7        0.0      0.0
route, cruise, TAB HIDDEN           9.0      9.0        0.0      0.7
route, cruise, 14 s later           9.7     12.7        0.0      0.0
```

**Z6 — closed.** `?clip=1&from=JES&to=WEL&fit=1`, loaded exactly as the docs
write it with the intro left running, waits for the opening flight and then
frames the whole route: fit lands at t=43.8 s at `fitPitch` 55, whole bbox in
the viewport, 72 rendered route features, 13 chrome elements gone, OSM credit
still painting. `shots/walk/final2/6-the-recordable-url.png`.

**Z7 — closed TWICE.** The 197 px column became a 361 px full-width bar
(§137), and this pass found it still sitting **under `#fb-button`** on a
phone: `--wf-pill-top` 68 px is the row below ONE button and the phone block
stacks a second at `top:58px`. Measured bar y68..135 against button y58..92;
now 100 px, six real headlines all 361 px and all on one line, zero overlap.

**Z8 — closed.** Sheet y324..634, joystick y682..782, `elementFromPoint` at
the stick's centre returns the joystick and at BOOST's centre returns BOOST.
Touchable, not merely drawn.

**Z9 — closed.** `jest`, `jester`, `jes`, `welch`, `greg`, `burd`, `paint` all
rank the intended building first; exact `JES` is the only row; `jester east`
finds JCD by its displayed name; `+ 28 more` is whole, outside the scroller,
clear of the hint line.

### WHAT IS ACTUALLY LEFT, with numbers

**~~ZA.~~ ANSWERED, ON A BRANCH: 120 of 198 becomes 135, and 14 of the twenty
buildings a freshman actually needs (2026-08-16, HANDOFF §141 + §142, branch
`acer/n8-doors`, PR #184 — OPEN, NOT MERGED, see the two unrun gates below).**
The shopping list below was worked, and **no door was drawn by hand**: the
entrance bake's hand-drawn `CAMPUS` rectangle was replaced by a scope test on
UT's own register, which admitted twelve buildings rather than the 125 the wide
rect would have. 27 new doors on 15 buildings, every one `src: derived`, so
every one says *"Entrances are on this side"* and none can say *"the main
entrance"*.

```
                                  before      after
routable UT register codes       120 / 198   135 / 198    (+15)
merged in as "not walkable yet"   78          63
door groups                      629         656   (651 attached, 99.2 %)
bake gates                                   19 of 19 green
--regress                                    19 of 19 PASS, every distance
                                             identical to the tenth of a metre
```

Newly routable: `NUR UTA WMB HDB HTB CDL JHH ANB LCH FDH SAG TRG GUG HCG E26`.
**None lost.** The freshman list (`docs/walk/the-78.md` §5) goes **0 of 20 to
14 of 20**.

**The check that matters for a door pass was driven, not argued.** A new door
creates exactly one part of a route — the *arrival leg*, the unmapped straight
line from the network to the door. From all 143 origins that routed on `main`,
to all 15 new buildings: **2,145 arrival legs, ZERO crossing a building**,
longest 29.2 m, all inside `DOOR_LINK_MAX_M`.

**What is still out of reach, and why — 63 codes.** `ACS` (the Autry C.
Stephens Engineering Discovery Building, **opening this semester**) has no
polygon, no label and no reference anywhere in this repository; the only route
in is digitising a footprint from outside, which is authoring a *building* and
needs its own pass. `HLB` and `SMC` (Dell Med) have real OSM ways in
`capitol_area.json` but **are not in the 2,453-footprint snapshot the app
renders**, so a door for them would stand in an empty field — refused on
purpose. `WAT` has no mapped approach within 22 m and is refused on purpose.
The remaining ~58 are the Facilities sheds, equipment storehouses, graduate
housing, the aquatic plant and the parking garages — buildings no undergraduate
has a class in. **All 63 answer `<code> is not walkable in this build yet`.**

**ZB. Fourteen edges of the base network run through a footprint, and nobody
has looked at any of them.** Unchanged and now sized: `origin/main`'s own graph
carries **14 such edges**, found by `build_raw()` from `footways.json` alone
before any door exists. Two named ones:

* **`-97.7351, 30.2874`, beside EER** — one 13.9 m edge, 4.1 m inside an
  unnamed unclassed footprint (the original ZB, from Pointe on Rio > EER).
* **`-97.7380, 30.2809`** — a cluster of **four ~65 m² unnamed footprints**
  with five short edges through them, ways 571500827 and 1199982733-5, **one of
  them `highway=steps`**. This is what makes `JES>UTA` and `GRE>UTA` report
  `walls 5`. Four tiny adjacent structures with footpaths and a staircase drawn
  through them is the shape of a stair head or a gateway you walk between — or
  four buildings a sidewalk was drawn across. Nobody knows.
* and `PCL>UTA`'s single wall is **OSM way 1206168875**, tagged plainly
  `highway=footway, footway=sidewalk` — no `covered`, no `layer`, no `tunnel` —
  across the AT&T Center footprint. Avoiding it costs **0.8 m**.

**The obvious fix was priced and REFUSED.** Dropping all 14 leaves every one of
the 19 frozen pairs unmoved to two decimal places — and costs **`EER` 25.4 %**
of its route to WEL. So at least one of the fourteen is a real passage, and
deleting the set to buy a clean number is buying honesty with a disconnection,
the mirror of the move `graph.md` §3d refused. **The rate, measured both ways,
did not get worse when the new buildings landed:** among `main`'s own routable
codes 20 of 300 sampled pairs cross a footprint (6.7 %); among routes ending at
a newly routable building, 15 of 300 (5.0 %). Reading the OSM ways or standing
there is still the only way to resolve it.

**~~ZC.~~ CLOSED, on the same branch (2026-08-16, HANDOFF §142, PR #184).**
`avoidShown` no longer has `189` typed into it. 189 is the count of
`highway=steps` ways in the 2026-07-30 snapshot — a measurement of a file,
printed by a program that had stopped consulting the file, so the next Overpass
refresh would have moved the graph and left the sentence behind **looking
exactly as plausible as before**. It now reads `swEdges.size`, the same set
`edgeCost` prices at `Infinity` when the toggle is on, so the sentence
describes what the filter did. Counted today: still 189, so the rendered string
is byte-identical. `what-we-can-honestly-say.md` §11 carries the revision.
**In the same pass, `no door mapped` was removed** — it was the one rendered
string in `js/wayfind.js` living neither in `SAY` nor on §11's permitted list,
and gate S had already made it unreachable.

**ZC-NEW. THE GATES WERE RUN, AND ONE IS RED — PR #184 IS OPEN ON A TASTE
CALL, NOT A DEFECT.** The machine went quiet at 07:40 (13 chrome, 0 node,
CPU 11 %) so the browser gates were taken after all, on port 8411.

```
harness-drift.mjs                      PASS   29 scripts = 29 scripts
bake gates                             19 of 19 green
--regress                              19 of 19 PASS, all walls 0
wfgate.mjs  behaviour + honesty DOM    34 pass, 0 fail
n8gate.mjs  this pass's own gates      14 pass, 0 fail
n8off.mjs   feature off + hero poses   inert PASS, H4 at floor, H1 RED
```

**The feature is still inert with no `?walk=1`:** zero wayfind layers, zero
sources, zero `#wf-*` DOM nodes, `WAYFIND.on === false`, zero fetches of
`walk_graph.json` or `ut_buildings.json` — measured on both arms.

**The hero spawn pose is NOT at the noise floor.** Four interleaved launches,
base arm serving `origin/main`'s `wayfind.js` + `walk_graph.json` +
`entrances.geojson`:

```
pose        own cross-launch floor    candidate vs origin/main
H4-city     over24 0                  over24 0, max delta 4   <- at the floor
H1-spawn    over24 0 on BOTH arms     over24 447, max 102, identical in both reps
```

447 px is 0.04 % of the frame and the magenta mask says what it is: **scattered
single doorway pieces on distant West Campus and campus-edge buildings**, a few
pixels each — the entrance half of the branch rendering, exactly as HANDOFF
§141 predicted. Nothing structural, nothing in the wrong place.

**FOR SIMEON, and it is the only thing on this branch that needs him.** The new
doorways are faintly visible from the spawn hero pose. Look at
`shots/walk/n8/1-hero-spawn-the-447-changed-pixels-in-magenta.png` and frames
2-5 (before/after crops on the historic core and the Dell Med block, which
nobody in this project had ever seen up close) and say whether the city should
carry them. **If yes, PR #184 merges as-is and 135 of 198 buildings become
walkable.** Everything else on it is green and the data half is final.

**ZD. Nothing in this feature has been on a real phone.** 393x852 in headless
Chrome is not an iPhone: no real touch, no real DPR behaviour, no Safari.

**ZE. Nobody has stood in front of any door.** Every door claim is checked
against OSM entrance nodes, which under-map; the known worst-case derived-door
position error is 76 m (Norman Hackerman) and the interface's wording is built
to survive that, but it has never been checked against Austin.

**ZF. A taste call for Simeon, not a defect.** At cruise the route is a thread
lying over the rooftops (the ground ribbon is for walking height, and fades in
as you descend). Look at `shots/walk/final2/6-the-recordable-url.png` and say
whether that reads right for the recording.

**ZG. THE FEATURE IS STILL OFF FOR EVERY VISITOR AND THAT IS DELIBERATE.**
`WAYFIND.on` is one constant in `js/wayfind.js`. With no `?walk=1` there are
zero wayfind layers, sources, DOM nodes and globals, zero fetches of
`walk_graph.json` or `ut_buildings.json`, and six hero-class poses are at or
below their own cross-launch noise floor against `origin/main` (H1 byte-
identical). **Flipping it is Simeon's call and should wait for the AWS
recording.**
