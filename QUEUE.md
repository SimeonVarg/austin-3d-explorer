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

## Not negotiable

1. **Never register a self-hosted GitHub runner.** Public repo.
2. **Never remove the watchdog or reaper in `scripts/verify/chrome.mjs`.**
3. **Never leave a browser or a server running.** `reap.mjs` and kill the server.
4. **Record every pass in `HANDOFF.md`** with the branch name.
