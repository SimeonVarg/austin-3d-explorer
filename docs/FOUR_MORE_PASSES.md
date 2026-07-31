# Four more passes — paste one block per session

Written 2026-07-31, from Simeon's list after the five building passes merged.

**Four sessions, not more.** The list splits into four genuinely independent
areas, and a fifth would only be a session fighting one of these for the same
files. **DKR is not in here — the main session owns it** (the angled field, the
flickering block, the missing lettering, the lights).

| # | Pass | Slug | Owns |
|---|---|---|---|
| 1 | **Night** | `night` | `js/night.js`, `js/timeofday.js` |
| 2 | **Roads & bike lanes** | `roads` | `js/ground.js`, `scripts/bake_ground.py`, `data/ground.geojson` |
| 3 | **Storefronts** | `places` | `js/places.js`, `scripts/bake_places.py`, `data/places.geojson` |
| 4 | **Glitch sweep** | `glitch` | the five merged building passes' files |

Every block assumes `docs/PASS_COMMON.md` — the app, the reference method, the
rendering traps, the integration contract, the verification rules. It is
mandatory and it is short.

**Session 3 needs a `<script>` tag that does not exist yet.** The main session
will commit `js/places.js` as a stub plus the tag before you start, exactly as
it did for the five building passes, so no pass touches `index.html`.

---

## 1 — NIGHT

```
Read docs/PASS_COMMON.md first, in full.

THE COMPLAINT, VERBATIM: "lights are a bit too dim on night mode."

Night is currently too dark to read as a city. Your job is the whole scene's
night look — every building, every street, the sky — but NOT the stadium: DKR's
night lighting is being done in the main session right now and
scripts/bake_stadium.py, data/stadium.geojson and the stadium-* layers in
js/app.js are off limits.

WHAT TO ACTUALLY FIX
  - Lit windows are too sparse and too dim. js/facades.js generates a night
    atlas with a per-pane scatter; read PANE_BRIGHT_MIN/MAX and the per-family
    lit fractions before changing anything, and change them in the taste block,
    not inline.
  - Streetlights and the ground read almost black. There is a real street-lamp
    layer in js/night.js — find out what it actually contributes and whether it
    is being drowned by the tone curve in js/graphics.js.
  - The city should have a WARM core and cooler edges. Right now it is uniform.

THE TRAP THAT WILL COST YOU THE PASS. There is a hard-won rule in this repo that
an unlit surface must never end up BRIGHTER than the city around it — an early
DKR night pass left the seating bowl glowing as the brightest object on the east
side of campus, which is the inverted-silhouette failure. So brightening night is
not "raise everything": measure the luma histogram of a night frame before and
after and keep the ordering of lit-vs-unlit intact. scripts/verify has a
night-silhouette check; read it and use it.

Do NOT reach for the post-process stack to fix this. js/graphics.js is shared
with a performance problem we already have (see below) and is not yours.

PERFORMANCE IS A LIVE CONSTRAINT. Simeon reports the site is "super laggy" on an
Acer laptop. Whatever you add at night must be measured with an interleaved A/B
reporting the MINIMUM of the reps, and if it costs frames, it does not ship.

YOU OWN: js/night.js, js/timeofday.js, docs/PASS_NIGHT.md,
scripts/verify/night-*.mjs, shots/night-*.png
DO NOT TOUCH: js/graphics.js, js/facades.js's non-night code paths, js/app.js,
scripts/bake_stadium.py, data/stadium.geojson, index.html, _harness.html.
If you need a value changed inside js/facades.js's night atlas, that is allowed —
it is the one shared file here — but change ONLY values inside the taste block
and say so loudly in the PR.

DELIVERABLE: a branch and a PR, per section 6 of docs/PASS_COMMON.md, with
before/after night frames and the measured frame cost.
```

---

## 2 — ROADS & BIKE LANES

```
Read docs/PASS_COMMON.md first, in full.

THE COMPLAINT, VERBATIM: "also more accurate roads? bike lanes for roads that
have them?"

A previous pass already made roads read as asphalt rather than as pale paving —
read commit 07c9e3c and docs/GROUND_TEXTURE.md before you touch anything, and do
not undo it. There is a specific trap documented there: the paving tones are pale
ON PURPOSE, and an earlier version had paths at luma 185 against ground at 188.5
and the whole path network was invisible. Re-check that separation afterwards and
keep it. Measure it, do not eyeball it.

WHAT TO ADD
  - ROAD CLASSIFICATION. Find out what scripts/bake_ground.py currently pulls
    from OSM and whether it distinguishes motorway / primary / secondary /
    residential / service. Width and tone should track the real class. Guadalupe,
    MLK, San Jacinto, Speedway and 24th are not the same road.
  - BIKE LANES, which is the actual ask. OSM carries `cycleway`, `cycleway:left`,
    `cycleway:right`, `bicycle`, and separate `highway=cycleway` ways. Austin has
    real protected lanes and Speedway is a bike/pedestrian mall. Pull the tags,
    do not assume — and render a lane only where the data says one exists.
    Austin's painted lanes are green at conflict zones; check what is actually
    green on the ground versus plain asphalt before you paint the whole network.
  - LANE MARKINGS on the arterials only — centre dashes, stop bars at signals.
    Not on campus footpaths.

SCALE REALITY CHECK, from section 5 of the common brief: the camera lives
200-900 m up, where one pixel is about half a metre. A 10 cm lane stripe does not
exist at that distance. Either draw it deliberately over-scale and say so, or do
not draw it. Both are fine; pretending is not.

YOU OWN: js/ground.js, scripts/bake_ground.py, data/ground.geojson,
docs/PASS_ROADS.md, scripts/verify/roads-*.mjs, shots/roads-*.png
DO NOT TOUCH: js/app.js, js/facades.js, index.html, _harness.html, or any other
pass's files.

DELIVERABLE: a branch and a PR with before/after from the flying camera, the
measured path-vs-ground luma separation before and after, the measured frame
cost, and an honest list of which roads you could not classify.
```

---

## 3 — STOREFRONTS

```
Read docs/PASS_COMMON.md first, in full.

THE COMPLAINT, VERBATIM: "i also want all restaurants on the campus and in
wampus and guad and around campus to look like the actual restaurant and have
their logos and fronts."

READ THIS PARAGRAPH BEFORE YOU PLAN. Do not download or embed real brand logo
artwork. Reproducing a company's logo as an image asset in a published site is a
trademark question, and this project is going out on AWS Kiro's channels, so it
is not a hypothetical. What you CAN do, and what will actually read from a
flyover anyway, is: the brand's real SIGN COLOUR, the real sign band position and
proportion, the real shopfront glazing, awning colour, and the business NAME as
text. From 200 m up a logo is a few pixels; the colour and the name are what a
person recognises. If you think a specific case genuinely needs artwork, put it
in the PR body as a question for Simeon rather than shipping it.

WHAT TO BUILD
  - Source the places from OSM: `amenity=restaurant|cafe|fast_food|bar|pub` and
    `shop=*` within the detailed bbox (lon -97.752..-97.726, lat 30.276..30.296).
    Guadalupe (the Drag), West Campus, and the campus edges are the targets.
  - Each becomes a SHOPFRONT on its host building's ground floor: a glazed band,
    a solid bulkhead under it, a sign band over it in the brand colour, and the
    name. The Drag pass (js/drag.js, merged) already built a shopfront vocabulary
    for Guadalupe — read it first and extend it rather than inventing a second
    one that disagrees with it.
  - Get the brand sign colours off photographs, sampled, not remembered.

THE STRUCTURAL TRAP, and it is the same one that has bitten every pass here: a
facade pattern has NO vertical anchor, so a ground-floor shopfront painted into
a wall tile repeats every ~40 m up the building. A shopfront MUST be stacked
geometry — its own feature with its own base and height. Copy the BANDS list in
scripts/bake_stadium.py.

COUNT DISCIPLINE: there are a lot of these. Report the feature count you add and
the measured frame cost, and if the honest answer is "only the 60 that front a
street are worth drawing", do that and say so.

YOU OWN: js/places.js (a stub and its <script> tag will already be committed —
do NOT touch index.html or _harness.html), scripts/bake_places.py,
data/places.geojson, docs/PASS_PLACES.md, scripts/verify/places-*.mjs,
shots/places-*.png
DO NOT TOUCH: js/drag.js (read it, extend from your own file), js/app.js,
js/facades.js, js/ground.js.

DELIVERABLE: a branch and a PR with before/after at street level AND from the
flying camera, the feature count, the frame cost, and the list of places you
could not source a real colour for.
```

---

## 4 — GLITCH SWEEP

```
Read docs/PASS_COMMON.md first, in full.

Five building passes merged today — the Tower, West Campus, the Drag, the arts
precinct, and the modern east block (PRs #16-#20). They were built in parallel
against an ownership contract and they have not been looked at TOGETHER. Simeon
has already spotted two defects by eye:

  1. "flawn academic center roof is bugging out glitching"
  2. "UT Tower base has a long line going out of it into biomed building"

Both are almost certainly the same class of bug and there are probably more.

WHAT "GLITCHING" AND "A LONG LINE" USUALLY MEAN HERE, in likelihood order:
  - Z-FIGHTING: two coplanar surfaces at the same height flickering as the camera
    moves. Two passes both emitting geometry for the same building, or a roof
    feature at exactly the parent's height. This is the single most likely cause
    of both reports.
  - A polygon with a bad winding or a stray vertex, which renders as a spike or a
    long thin sliver shooting off to another building. "A long line going out of
    it into biomed" is textbook.
  - Two passes claiming the same building id. Every bake declares
    replacedBuildingIds; if two claim one id, one renders inside the other.
    CHECK EVERY data/*.geojson's replacedBuildingIds FOR DUPLICATES FIRST — it is
    one script and it may explain several defects at once.

METHOD, and do this before you change a line of code:
  - Write the duplicate-id check and run it across all of data/*.geojson.
  - Use scripts/verify/isolate.mjs to render a pose with only one pass's layers
    visible. That is how you find out which pass owns a defect instead of
    guessing — and guessing has already cost this project multiple sessions.
  - scripts/verify/whoccludes.mjs finds which layer paints over a given pixel.
  - READ scripts/verify/README.md, especially the section on a cold server
    producing phantom missing geometry. If a layer looks absent, RUN THE SAME
    POSE TWICE before diagnosing anything.

Then sweep for more: fly the whole detailed bbox at several altitudes and
bearings, day and night, and list every defect you find with a screenshot and the
layer that owns it. Fix what you can in the owning pass's files; for anything you
cannot fix safely, file it clearly in the PR.

YOU OWN: js/tower.js, js/westcampus.js, js/drag.js, js/arts.js, js/moody.js,
js/roofs.js, their bake scripts and data files, docs/PASS_GLITCH.md.
DO NOT TOUCH: scripts/bake_stadium.py, data/stadium.geojson, js/ground.js,
js/night.js, js/app.js, index.html, _harness.html — all four are owned by
another live session.

DELIVERABLE: a branch and a PR with the defect list (screenshot + owning layer +
fixed/not-fixed for each), and before/after for every one you fixed.
```
