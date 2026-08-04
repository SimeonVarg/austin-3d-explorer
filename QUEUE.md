# QUEUE — Acer lane

Rewritten 2026-08-03 evening from Simeon's third list, which is the longest and
most specific feedback this project has had. Everything above this in git history
is superseded.

## Read this before the list

**This is probably the last long unattended run before the app is shown
publicly.** He said so. Two audiences, and they do not want the same thing:

- **Amazon / general viewers** — everything is impressive to them *except
  glitches*. A flickering window kills the demo; a slightly wrong podium does not.
- **UT students** — glitches matter less than **the accuracy of the place they
  personally live**. A freshman looking at Jester, or a sophomore looking at their
  West Campus apartment. In his words, about his own building: *"if this tool
  wasn't mine and i saw standard look nice i would feel really cool, like 5x
  better about the project"*.

**So the order is: kill the glitches, then make the places people live accurate,
then everything else.** He put "extreme accurate downtown towers and West Campus
apartments" LAST on purpose. Do not start there.

**Quality over speed.** Verbatim: *"idc how long it takes its fine if your still
running in the morning. focus on quality, not speed (production speed - render
speed + fps is still important lol)"*. One thing genuinely right beats five
schematic. He has now said this three separate ways across three lists.

**And the standing rebuke, worth reading once:** *"embarrased it took so many
millions of tokens wasted building it for me to look at it online for 1 minute
and tell you these things"*. He is right. **Look at a photograph of the thing
before you model it.** Every single item below that says "accurate" means: find a
reference, read it properly, and check your output against it — not against your
memory of what the thing probably looks like.

---

## The traps that keep costing hours

1. **`python -m http.server` cannot test this site.** It ignores `Range:`, so
   every feature in a tiled layer vanishes with no console error. Use
   `python scripts/serve.py 8123`.
2. **A missing layer makes every metric look BETTER.** Verify with a picture.
3. **Run `node scripts/verify/harness-drift.mjs` before ANY pixel measurement.**
4. **`git pull` before you screenshot.** A working copy 38 commits behind
   produced a "finished result" tour of the old city on 2026-08-03. Check
   `git rev-list --left-right --count HEAD...origin/main` reads `0 0`.
5. **A bounding box is not a shape** (§50). **A level run has no height** (§51).
   **Sample the pixels you mean** — the magenta-mask trick (§48).
6. **CAP CONCURRENCY AT THREE.** Eight parallel agents each opening a browser
   pinned this laptop at 95% CPU for three hours on 2026-08-03 and froze it. The
   speed was never in the browsers.
7. `tour.mjs` needs `VERIFY_MAX_MS=900000`. `pose.mjs --extra "&tiles=0"` forces
   the GeoJSON fallback. Tiles rebuild with
   `gh workflow run build-tiles.yml --ref BRANCH`.

---

# PART G — THE CEILING, AND HOW TO BREAK IT

*"they are NOWHERE CLOSE to the level they should be - looks like u made overall
shape a bit more accurate but its like youre trying to draw the mona lisa and you
made the canvas the right size - we need accurate detail and color"*

**He is right, and it is structural rather than any pass being lazy. Read this
before touching another building.**

## Why every pass reports massing and never detail

| | how it is produced | result |
|---|---|---|
| **roofs** | MEASURED from aerial imagery — `roof_survey.json` has 2,312 buildings with sampled colours and detected blobs, 2,334 cached tiles in `data/imagery_cache/` | specific, per-building |
| **walls** | `quantiseFacades` elects **FOURTEEN** tones for the entire city and stamps one per building, plus a repeating window tile | every building in Austin wears one of fourteen tans |

That is the whole vocabulary a normal building has. So "make EER look like EER"
inside that system can only ever return a slightly different box in one of
fourteen colours — which is precisely "you made the canvas the right size".

## What actually breaks through

A building needs its OWN facade, and both halves of that are already possible:

1. **Its own colours, outside the fourteen.** `window.FACADE_PROTECTED` exists
   for exactly this — it is why the Capitol keeps its Sunset Red granite instead
   of folding into the nearest tan. `quantiseStadiumFacades` shows per-feature
   palette entries being appended at runtime. Use it.
2. **Its own composition.** `js/union24.js` is the worked example and currently
   the ONLY building in the city with one: it finds a feature by name, replaces
   the geometry, and documents every measured dimension with the working written
   out. That is roughly 200 lines per building.

## The rule for this part

**TEN BUILDINGS THAT GENUINELY LOOK LIKE THEMSELVES BEATS FIFTY NUDGED.** Do not
spread. For each one:

- find real photographs and WRITE DOWN what the building is made of — bay rhythm,
  where the material changes, balcony bands, glazing lines, the crown, the base
- register its own colours rather than accepting a bucket
- author the composition as separate banded features with their own base and
  height, the way `js/drag.js` does shopfronts — never a pattern that tries to
  place something "at the top"
- put a render and a photograph side by side in the PR. **If you would not
  recognise the render, it is not done.** That test is the item.

---

# PART F — 2026-08-03, after he looked at it

## F1. The fade is INVERTED now, not fixed — round three — **DONE**

> **FIXED, PR #116, merged `5414425`. F1 and F2 were the same knob and neither
> was the haze.** PR #107 is fine — peeled off a live frame the depth haze moves
> the ten 100-row bands by 3.01 / 3.86 / 2.70 / 2.08 / 1.62 / 1.24 / 0.85 / 0.74
> mean |dLuma|: smooth, monotone, no edge, and **0.74 in the nearest band**,
> which is F2's "do near buildings get essentially zero fade" answered yes.
>
> What was left is **`#fx-dof`, the "distance blur"** in `js/graphics.js`: a
> viewport-wide DOM rectangle pinned to the horizon ROW, 0.24H tall, running
> `backdrop-filter: blur()`. It cannot know what is in front of what, so a NEAR
> building crossing it has its upper half blurred and its lower half sharp — a
> gradient up its own face, on the upper side — while a FAR building sits wholly
> inside the band and shows no gradient of its own. Blur also pulls the pale sky
> into whatever it covers, so it reads as washed out. **Detail destroyed,
> measured on one frame with one toggle: rows 200–300 2.43 → 4.60, rows 300–400
> 4.71 → 10.72, rows 400–500 7.98 → 9.03, every other band identical.**
>
> Off in all four presets, with a `SETTINGS_REV` migration so a saved `0.30`
> cannot put it back in a browser that has already loaded the app. **NOT the
> cause, and measured so:** `fill-extrusion-vertical-gradient` (byte-identical
> with it off on all 60 layers), the sky canvas, and the fog ladder's own
> base-to-crown difference. HANDOFF §55;
> `docs/shots/f1-horizon-crop-before-after.jpg`.


*"the horizontal line thing is inverted - i prefer this version over the last but
as you can see its still a bit harsh with the gradient on the uppser side. far
away buildings dont have it anymore which is nice"*

His screenshot: a single tower, **normal colour at the base, washing out to pale
toward the top.** Before PR #107 it was the opposite — faded base, hard normal
top. **Both are the same defect with the sign flipped: the fade is still keyed to
HEIGHT WITHIN THE BUILDING.**

The hard part is genuinely done — the far city recedes and the hard screen-row
line is gone, and he says so. What is left is that a single near building still
has a gradient up its own face.

**A building should take ONE fade value, chosen by its distance from the camera,
applied uniformly from base to crown.** If that is not expressible in a
fill-extrusion paint expression, say so plainly and explain what was tried —
`fill-extrusion-vertical-gradient` is a candidate culprit, as is any expression
keyed on `['get','h']` or on the extrusion's own base/height.

## F2. Dusk is over-dark — **DONE, same fix as F1**

> **FIXED, PR #116.** It was not the fade at all. From the West Campus pose the
> blocks sit in exactly the rows `#fx-dof` blurs, so the "brown lumps with the
> detail lost" was the blur band, not the haze. The haze at that hour reaches
> only 4.3% alpha at 200 m and moves the nearest 100-row band by 0.74 luma.
> `docs/shots/f2-westcampus-dusk-before-after.jpg`.

At tod 0.62 the West Campus blocks read as brown lumps with the detail lost —
`shots/tour/dusk-west-campus.png`. New since F1's predecessor. The fade is
probably too strong at close range; check that near buildings get essentially no
fade at all.

## F3. Downtown is STILL a dark grey mass

Flagged before PR #112 and still true in `shots/tour/day-downtown-skyline.png`.
#112 fixed 645 blank streetwall prisms, which was real work on a different
problem. **Measure downtown's rendered wall values against campus's** and find
out whether this is a regression from the facade tile switch (PRs #84/#94) or an
authored choice. It is the most visible thing in any wide day frame.

## F4. UT campus buildings that are blocks and should not be

*"also add some UT buildings too - some of them look really cool like EER but rn
theyre a block. DO those"*

**EER** — the Engineering Education and Research Center — is the one he named: a
striking modern building with a folded, angular facade and a big glazed atrium,
currently an extruded box. It is not alone. Find the campus buildings with real
architectural character and give them their form, the way `js/union24.js` already
does for Union on 24th.

Candidates worth checking against photographs: EER, the Blanton, the Harry Ransom
Center, Bass Concert Hall, the LBJ Library, the Moody Center, the AT&T Center,
Rowling Hall, the Norman Hackerman Building, Welch Hall.

`data/hero_designs.json` already exists and `js/union24.js` is the worked example
of a per-building hero override. Read both before inventing a mechanism.

---

# PART A — GLITCHES. These come first and they are demo-killers.

## A1. Windows flip to NIGHT MODE by quadrant, in broad daylight — **DONE**

> **FIXED, PR #103, merged `715fa49`.** Cause: past 60 degrees of pitch MapLibre
> picks a tile zoom PER TILE by distance, so one pitched frame samples all three
> facade mip tiers at once — and `updateFacades` repainted only the tiers the
> CAMERA's zoom named, leaving the far tier stuck at whatever hour it was last
> dragged to. Read HANDOFF §46 before touching `js/facades.js` again: **every mip
> tier must hold the same hour, always.** Pictures in `shots/a1-before/` against
> `shots/a1-after/`.

*"huge new window bug - wow this is horrible ... half the buildings past a
certain point switch their windows to night mode (complete daylight) ... whatever
point im rotating around, everything past that in my line of sight is night black
windows and everything towards me renders fine ... it happens every quarter, so
like NE and SE, then SE and SW, then SW and NW ... The buidings on the line that
seperate these quarters keep bugging between day and night windows, or between
different window densities ... exited rotate mode flew toward dark buildings and
they fixed themselves but i have to fly over each chunk to fix that chunk ... nvm
they go back to being dark after a while. Keep in mind i was switching between
day and night before this happened"*

**THE WORST BUG IN THE APP. Fix this first.**

Read the report carefully — it names the mechanism. "Every quarter", "chunks",
"fly over a chunk to fix that chunk", "goes back after a while" is **TILES**. The
facade pattern is a `fill-extrusion-pattern` whose image is re-rendered per
time-of-day into the atlas; a tile built while the atlas held the night image
keeps it until that tile is re-built. Flying near forces a rebuild; eviction
brings the stale one back. The quadrant boundaries are tile boundaries.

Likely: the time-of-day retint calls `map.updateImage(id, ...)` for each combo,
but tiles already uploaded do not re-sample; or `bakedfacades` /
`registerOuterTowerBuckets` (PRs #84, #94) register images at the CURRENT hour and
never re-register on a tod change. **Check that every registration path is hooked
to the tod wrapper — HANDOFF has a whole entry about a pass that built a wrapper
and never installed it.**

Reproduce it in a script first: load, set tod day, set tod night, set tod day
again, orbit, and sample facade pixels by quadrant. Assert the effect.

## A2. Roads swell as you tilt up from low altitude — **DONE**

> **FIXED, PR #105, merged `a420d07`.** "some roads dont" was the answer: the
> ones that don't are the SIDEWALKS, whose width PR #70 already moved into the
> geometry. `bake_ground.py`'s new `widen_roads()` does the same for every near
> carriageway and cycleway — 3,015 `k:'roadarea'` polygons, `ground-road` is a
> fill. Measured on Guadalupe mid-block: a road that was drawn between HALF and
> TWICE its real width depending on pitch and distance is now x0.9–1.1 at every
> pitch. The far-field armature is the one road layer still a line, under a 3 px
> ceiling, because everything in it is over 3.4 km away. **It cost 293 → 738 KB
> gzipped on an untiled file — moving those polygons into `roads.pmtiles` is the
> follow-up.** HANDOFF §47; `shots/a2-before/` against `shots/a2-after/`.


*"when im all the way down vertically and look at an angle towards the roads and
start facing upright, the roads get bigger. some roads dont do this."*

The `some roads dont` is the clue: two different road representations. PR #78
gave ground polygons a rank ladder and PR #70 lifted paths to 0.22 m, but any
road still drawn as a **`line` with a pixel width** covers more ground metres as
pitch increases — that is exactly "gets bigger when I look up". Find every ground
or road layer still using `line-width` in pixels rather than a
metres-on-the-ground width and convert it.

## A3. The horizon line that follows the camera — READ THIS SLOWLY

He has described this three times and it has not been understood. Verbatim, most
complete version:

*"ever since start theres been a horizon that shades things under it into the
sky. this line follows me when i go up or down. so if i go high enough so where
the line is above the towers in downtown it looks really nice like their distant
and shaded with the sky a bit - THE WHOLE THING - but when i go down then under
the line has this nice gradient but above the line is COMPLETELY NORMAL building.
so like on default sunset im looking at downdown from a medium height, the bottom
half shades fine, but the top half is completely darker and the same tone"*

**What this means:** the atmospheric fade is applied as a function of SCREEN
HEIGHT, not of distance. HANDOFF §85's own note says "screen row IS distance
under a pitch" — that is true for the GROUND and false for anything with height.
A tower's base is far and its top is equally far, but the top is above the line,
so it gets no fade and reads as a flat dark slab sitting on a faded base.

**The fix is to fade by DISTANCE, not by screen row.** Every building needs the
same fade over its whole height, chosen by how far away it is. Until that is
true, no amount of tuning the line helps — he has been shown three tunings and
all three were the same defect.

## A4. Night windows appear briefly while moving vertically

*"in the night ... theres a bug i go up and down sometimes the buildings render
the daytime wall windows. i did up and down for like 20 seconds then it fixed
itself for good."* Almost certainly the same root as A1. Fix A1, then re-test
this and say whether it went with it.

> **IT WENT WITH IT. DONE, PR #103.** Same root, same tier, opposite sign: A4 is
> the far tier holding the DAY drawing while the near field is at night, A1 is
> the far tier holding NIGHT in daylight. Which one you get depends only on the
> hour the far tier was last painted at. Re-tested explicitly and measured — at
> tod 0.95 all three tiers now read 63.5 mean luma where the far one read 153.6.
> "I did up and down for like 20 seconds then it fixed itself" was the old zoom
> drain finally firing; there is no drain to wait for now.

## A5. Intricate roofs flicker while moving

*"some buildings with intricate roofs like united methodist church have a bit of
movement glitching between the slightly grayer roof and the brown slope. same
with the childhood center behind it that also has a diagonal roof."*

Z-fighting between a roof deck and a roof slope at the same height — the same
class as A2's ground fight, which PR #78 solved with a rank ladder. Apply the
same idea to roof surfaces. **And note both named buildings ALSO have a diagonal
roof, so check A6 has not left them behind.**

## A6. The diagonal roof that has been reported four times

*"found out the name of the other building with teh diagonal roof that you never
fixed despite mentioning 10 times - it houses the anna hiss gymnasium"*

PR #98 claimed the last three. It missed this one. **Anna Hiss Gymnasium** is at
roughly `-97.73775, 30.28855`, `final_height` 9.7. Fix it, then re-run the
mechanical azimuth-gap finder from #98 and report why it did not catch this
building — a detector that misses a known case is worth more attention than the
case itself.

## A7. You cannot fly into downtown — **DONE**

> **FIXED, PR #105, merged `a420d07`.** The fence was the bbox of
> `scene.buildings` — campus plus the Capitol — so its south edge sat at lat
> 30.2685 while the downtown bake runs 30.2560–30.2770. Exactly 59% of the way
> down downtown, exactly "almost halfway". It is the modelled-city box now:
> **10.1 km² → 77.4 km²**, and he eases to a stop 89 m short of the far edge
> with a full city still around him. Widening it also needed a second, coarse
> collision field built incrementally off the tiled outer ring, or he would fly
> through the 315 m tower at Sixth & Guadalupe. HANDOFF §47; `shots/a7-fence/`.


*"i wish i could explore more of downtown im currently locked almost halfway"*

`js/controls.js` has a soft `fence` that eases the camera to a stop at the edge
of the data. Downtown is inside the modelled area now, so the fence is drawn too
tight. Widen it to cover everything that renders, and check the far edge still
stops him before he flies into empty basemap.

---

# PART B — DKR. He has asked a hundred times. Do it properly this once.

## B1. Rebuild DKR from a reference, not from its footprint

*"can we please redo DKR? make it look like the actual thing. this is now my
100th time asking ... right now the seating is 0/10 similarity to how it actually
is ... it looks like the colloseum not a football stadium ... your current
'seats' look like cutouts from a big pyramid"*

**Do not start in the code. Start with a photograph and a plan view.** Darrell K
Royal–Texas Memorial Stadium, capacity ~100,000. Everything below is his own
description and it is a specification:

- **It is far too tall.** Check the modelled height against the real thing before
  anything else. A stadium is wide, not tall.
- **The top of the perimeter is LIGHTS and is rendering as wall.**
- **West side: two really big decks of seating.** (The west side is the tall
  main-grandstand side with the press/suite tower.)
- **North and east: a second layer, wrapped, smaller, and connected to each
  other.**
- **South: mainly the screen** — the giant videoboard.
- **A Longhorn-shaped thing at the south end, low down.**
- **Entrances on the southwest and northwest sides**, and they are distinctive.
- **Some seat sections are burnt orange and some are not** — the seating bowl is
  not one colour.

## B2. Stadium lighting that behaves like stadium lighting

*"make the lights accurate and make them work at night - now the seats become
bright yellow and everything else is dull - what? the lights are supposed to
illuminate everything - if you cant find out by just data alone then do research
on football stadium mechanics and combine that with real data"*

He is exactly right and it is the reason the night frames look wrong: the seat
bands were authored as *emissive* — they glow — while nothing they should be
lighting responds. Real floodlights are on the rim pointing INWARD and DOWN: the
field is the brightest thing, the lower bowl is lit, the structure is edge-lit,
and the outside of the stadium is comparatively dark.

Invert it. The field and the bowl take the light; the seats stop being the light
source. **Note this supersedes the earlier "LED upgrade" defence in HANDOFF §27 —
he has now rejected that read twice.**

---

# PART C — WHERE STUDENTS ACTUALLY LIVE. This is what UT viewers will check.

## C1. Jester should not look like a prison — **DONE (roofs + courts)**

> **PR #106.** All three Jester footprints now carry the roof the nadir
> photograph shows — a terracotta tile hip band around a light grey concrete
> deck (measured: 28-47% of each roof passes the tile test, 33-59% is neutral
> and bright). Three things had stopped it: the 34 m height gate, a ring survey
> diluted by canopy and walkway roofs, and a deck colour taken from
> `roofscape.geojson`'s dark measurement. `data/building_overrides.json` is the
> new per-building correction file. The Caven-Clark Courts got white markings,
> hoops, net posts and a fence in `bake_art.py`. **Still open: Jester's MASSING**
> — each hall is one prism at the tower's height, so the two-storey wings are
> extruded to 51.6 m, and the WALL colour, which only the buildings bake can
> reach. HANDOFF §48; `shots/cbefore/` against `shots/cafter/`.

*"make jester look alot nicer if freshman r gonna see this then their dorm
shouldnt look like a prison"*

- **Some Jester roofs should carry the red brick pattern; some should be light
  grey flat concrete with roof detail.** Right now they are neither.
- **The colour is not accurate.** Check it against a photograph.
- **Add the tennis / volleyball court between the buildings.**
- **The ground around it is bare with duct-tape sidewalks** — fill the block in
  properly (see C4 and D7).

Jester East and West are one complex at roughly `-97.7305, 30.2830`.

## C2. Gregory Gym's famous entrance — **DONE**

> **PR #106.** A three-arch loggia on a monumental stair under a tiled gable,
> on the WEST face, placed from OSM node 1427259422 (`entrance=main`) and the
> 2101 Speedway address rather than from memory. The arch heads are prisms cut
> across the opening whose BASE is the arch's own curve, not axis-aligned
> blocks. Parameterised in `data/building_overrides.json` — if it is on the
> wrong block, it is a one-line move. HANDOFF §48.

*"greg gym is split into two sections (one building) one should replicate the
famous entrance with the three hall things and the roof"*

The 1930 Gregory Gymnasium facade has a **three-arch entrance loggia** under a
tiled gable. It is one of the most recognisable faces on campus and it is
currently a flat wall.

## C3. Littlefield Dorm has the wrong roof — **DONE, and it was 65 buildings**

> **PR #106.** The survey was never wrong — Littlefield reads run 7.1 m, eave
> 0.766, rings 0.77/0.99/1.00/0.99 to its own half-span, the most certain hip on
> campus. **The COLOUR never asks the photograph.** Facets take `rd` off the
> building, and `bake_detail.py` sets `rd` from the wall 12% darker when there is
> no OSM `roof:colour` tag. **65 of the 105 pitched roofs are painted from an
> `rd` that is not a tile colour at all.** 30 now take the campus tile median,
> gated on two independent readings. HANDOFF §48.

*"littlefeild dorm should have a red roof"*. One-line data fix — but check
whether the roof survey has it and why it was missed, because that rule probably
misses others.

## C4. The Honors Quad court

*"Can the yard in the honors quad court be better? theres no asphalt roads in
that court so idk why its there"*

There is asphalt drawn in a courtyard that has none. Find out where that surface
comes from — it is probably an OSM `highway` way crossing the court, or a
service-road polygon — and stop drawing it there. Then make the court a court.

## C5. West Campus apartments — **DONE. Blocks (#113), then CHARACTER (#119)**

> **PR #113, merged `0c9bd1a`.** The pass already did the ten TOWERS; West Campus
> is made of six-to-ten storey BLOCKS, and every building he named that was still
> a plain prism was one of those. Fourteen join the bake — The Standard, Rambler,
> The Quarters (both houses), 2400 Nueces, The Nine, Twenty Two 15, The Block,
> Block on 25th East, Pointe on Rio, Crest at Pearl, The Venue, The G, The Nine
> at Rio — with a ground-floor band, a crown that stops the window grid, 268
> projecting balcony slabs clipped to their own footprints, and amenity in the
> courtyards the footprints already have.
>
> **The colour was in the data and the renderer was electing it away.**
> `quantiseFacades()` keeps the fourteen most populous tones city-wide; over the
> 284 West Campus buildings ≥12 m that fold moves a wall by a median 13.9 RGB and
> up to 97.5. **The Standard was being painted brick red**; its architect's
> photographs show a light three-tone panel building. A feature in
> `data/westcampus.geojson` skips the election. HANDOFF §54;
> `docs/shots/westcampus-*.jpg`.
>
> **OWED, and it is the one thing he would notice.** The Standard is **17
> storeys** (Humphreys & Partners: 17 floors, 287 units, 989 beds, 640 spaces).
> The snapshot has it at **20.5 m** — the pre-2019 building's LiDAR, on a 2015
> City-of-Austin footprint that has never been redrawn. It cannot be fixed in
> this pass: `js/controls.js` builds its collision field from `final_height`, so
> raising it there would draw a tower you can fly through. It belongs in
> `scripts/hero_overrides.json` + a re-run of `enrich.py`. **That one number also
> unlocks his building's pool deck**, which was measured off the z20 nadir, built,
> and then deleted — all three routes to drawing it are blocked by the stale
> height. The measured rectangles are kept in `bake_westcampus.py`.

> **TIER THREE, branch `acer/westcampus-character`.** #113 gave fourteen blocks
> their measured colour; this gives them the things he actually named. A
> `fill-extrusion-pattern` has no HORIZONTAL anchor either, so the tower band is
> now cut into vertical **colour bays** — The Standard's cream / warm / pale
> panel field with its slate corner volume carrying the name, Block on 25th
> East's burnt-orange mass, 2400 Nueces' honey Texas limestone. **Every bay hex
> came off a named architect's photograph in `research/`** (crop, look at the
> crop, cluster it, re-centre on the colour #113 verified so the bays average
> back to it). Plus **504 balcony RAILS** at 1.05 m — the slabs were shelves —
> **segmented balconies**, one per unit, and **setback crowns** on fourteen.
>
> **Moontower was built and removed:** its two-tone split is sourced, its colours
> are not, and there is no photograph of it in `research/`. It stays a flat slab.
> **Block on 25th East turns out to have a hip roof** (nadir), which this tier
> cannot say — walls only, and the note in the bake that said otherwise is fixed.
> Measured: 401 -> 1,144 features, 26.0 KB gzipped, atlas 37 -> 46, nothing above
> `final_height`, tod tick +14% and frame time +4.5% (MIN of interleaved reps).
> HANDOFF §58; `docs/shots/westcampus-tier3-*.jpg`.
>
> **STILL OWED, and it is the same one number:** The Standard is 17 storeys and
> the snapshot has it at 20.5 m.

*"so many apartments in austin wampus have such cool designs but are currently
regular building blocks. Can you implement these designs?"*

He lives in **Standard** next year and said seeing his own building look good
would make him feel 5x better about the project. Do NOT cherry-pick Standard —
do the recognisable West Campus towers properly and Standard will be among them.
**This is explicitly last on his list. Do not start it until Parts A–D are done.**

---

# PART D — LANDMARKS AND DETAIL

## D1. The Capitol — **DONE**

> **FIXED, PR #108.** All three, and none of them was what the brief guessed.
> **(1)** Neither #78 nor #93 touched it. Two causes stacked: `bake_capitol.py`
> still emitted `k:'path'` LINES after the whole city moved to `k:'patharea'`
> polygons, and even as polygons they sat under `outer-detail`'s **0.45 m park
> pad**, which covers 98.6% of the south lawn. The green everyone was looking at
> was the outer ring's pad, not the Capitol's lawn — and `js/capitol.js`'s
> `updateData` merge had been rejected in the worker every load since Aug 1, so
> none of the 1,161 ground features had reached the map at all.
> **(2)** The dome was never leaning — 0.0 px axis drift over 57 m, measured
> isolated. It stood on an INVENTED 7 m stepped pyramid that no photograph has.
> **(3)** `FACADE_PROTECTED` is honoured; the dome and the walls carry the same
> `#bd8477` and rendered 1.40/1.52/1.56 apart because only the walls go through
> the window atlas. Now 1.28/1.30/1.29 against a photograph's 1.20/1.21/1.30.
> HANDOFF §49; `shots/cap-before-day/` vs `shots/cap-after-day/`.
>
> **Owed:** `scripts/verify/capitol-merge.mjs` is red by design — it asserts a
> console string for the deleted `updateData` path, and it was green for two
> days while the merge was failing. Rewrite it against `window.__capitolMerge`.

*"same thing with capitol building and lawn - looks like u got rid of the
walkways around it those had a cool pattern add them back. also the thing on the
top of capitol buildings looks like its angled. Also its not the right color."*

Three separate defects:
1. **The walkways around the Capitol lawn are gone** and they had a pattern worth
   having. Find out which pass removed them — a ground-resolver rank ladder
   (PR #78) or a precinct lawn (PR #93) is the likely culprit — and restore them.
2. **The dome/goddess reads as angled.** It should stand vertical.
3. **The colour is wrong.** Texas Capitol granite is a distinctive pink —
   "Sunset Red" — and there is already a `FACADE_PROTECTED` entry for exactly
   that (`#bd8477`). Check whether it is still being honoured.

## D2. Make the UT Tower actually glow at night

*"see how the UT tower is supposed to glow at night, analyze what types of orange
glow and how to replicate it"*

This is a research task before it is a code task. The Tower is **floodlit burnt
orange** for wins and special occasions — a warm wash up the limestone from below
with the top lantern lit, not a uniform orange repaint. Look at photographs of a
lit Tower, work out what is actually glowing (the shaft washed from below, the
observation deck, the clock faces, the lantern), and reproduce that structure
rather than tinting the whole thing.

## D3. The art is made of big square pixels

*"alot o the art u did liek the glass, monochrome for austin, clock knot are like
mini legos - i thought vectors could be like angled and stuff you could make the
actual thing? not like a paint tool with the biggest pixel brush setting?"*

**A fair and important question, and it deserves a real answer in the PR.**
`bake_art.py` builds everything from axis-aligned boxes and discs, so a leaning
steel beam becomes a staircase of blocks. MapLibre CAN draw an arbitrary polygon
prism at any angle — a rotated rectangle is just four points — so a beam should
be ONE rotated prism, not a stack. The limitation is that a `fill-extrusion` is
always vertical, so a diagonal member has to be approximated by a thin rotated
prism per segment; but that is very different from an axis-aligned staircase.

Fix `beam()` to emit rotated prisms aligned to the member's own axis. That one
change fixes Clock Knot, Monochrome for Austin and most of the rest at once.

## D4. Balls of Texas are rotated the wrong way

*"balls of texas are rotated the wrong way LOL was funny but super embarrasing"*.
Fix the orientation and check nothing else shares the bug.

## D5. Kelly's Austin still looks bad

*"austin building with the circle class still looks horrible"*. The starburst
window has been drawn twice and is still wrong. Get a photograph of the west
window and match it — radiating coloured panels in a circle, in a specific order.

## D6. Speedway got deleted — **DONE**

> **FIXED, PR #110, merged `e003b50`.** It was never deleted: 6,132 m2 of
> `s:'brickpave'`, unchanged across 8 commits, drawn every frame. Two causes.
> **(1)** The golden-hour palette did not go to dusk while everything round it
> did, so the brick rose to meet the concrete — `sum|dRGB|` 62 by day but **27
> at sunset, and 0.9 luma apart**. tod 0.62 is the default and the default is
> where he looks. **(2)** The herringbone was a flat `fill` at z=0 under the
> 0.22 m `ground-paths` extrusion, so 92% of the weave was painted over by the
> deck it decorates — the same shape of defect as §49's park pad over the
> Capitol walks. Both grain layers are prisms standing ON the deck now.
> HANDOFF §52; `docs/shots/d6-speedway-sunset-before-after.jpg`.

*"looks like speedway got slimed out somewhere in between add it back"*. Speedway
is the main pedestrian spine of campus. Find which pass removed it — the ground
resolver in PR #78 is the prime suspect since it clips overlapping surfaces — and
restore it.

## D7. Sidewalks look like duct tape — **DONE**

> **FIXED, PR #110.** They had **no texture at all** — `ground-texture` filters
> `k:'area'`, so every lawn and plaza wore a grain and every walk was a flat fill
> with a hard bright stroke round it. It was never the colour, it was the absence
> of a surface. New scored-concrete tile (slab grid + joints + aggregate, pure
> alpha), `kerbLight` 0.10 → 0.06 and a new `kerbOpacity`.
> HANDOFF §52; `docs/shots/d7-sidewalks-before-after.jpg`.

*"sidewalks in campus look like ducttape can we fix that? wont take much maybe a
few shading or texture things"*. They are flat pale strips with a hard edge.
Texture, a softer kerb, and joint lines would do it. He explicitly says this is a
small job.

## D8. The creek cuts straight through roads and buildings — **DONE**

> **FIXED, PR #110. It is 30 road crossings and 23 walk crossings** — 11 of the
> roads carry an OSM `bridge` tag and 19 do not, so the tag cannot be the test.
> **Zero buildings overlap the water**; DKR's footprint does not touch it. Cause
> is PR #62's own rule never applied here: a `fill` does not depth-test against a
> `fill-extrusion`, so `ground-channel` painted over `ground-road` while the
> walks (extrusions) won and crossed on nothing. `RANK[('bank','deck')]` = 95
> takes the ground off the channel, and `ground-deck` sits BEFORE the roads so
> the carriageway paints over its own bridge. 47 decks, 14,055 m2.
> HANDOFF §52; `docs/shots/d8-creek-crossing-before-after.jpg`.

*"the creek near DKR completely slices through 21st and DKR, but sidewalks still
go over them (added to the ducktape analogy) same thing happened with this creek
and other roads too"*

PR #79 cut the channel below grade and nothing taught it about crossings. Where a
creek meets a road or a building, there is a **culvert or a bridge** — the road
continues over the water. Find every creek/road and creek/building intersection
and deck them over.

## D9. Concrete in front of the Tower is blown out at sunset — **DONE**

> **FIXED, PR #110, and it is the same four numbers as D6.** The pale-paving
> band stayed within 4 luma of midday while the rest of the scene went to dusk,
> so the forecourt was the brightest object in the frame. Median rendered luma
> of the plaza paving, masked so trees and buildings cannot enter the sample:
> **213.3 → 194.5** (day), **159.4 → 141.2** (sunset), **47.1 → 45.2** (night).
> Checked at all three hours. HANDOFF §52;
> `docs/shots/d9-tower-forecourt-sunset-before-after.jpg`.

*"concrete area right in front of tower renders too bright on default sunset"*.
The golden-hour paving value is too high. Taste knob, one line, but check it
across all three times of day.

## D10. Simone Leigh's *Sentinel IV*

Missing. It stands in the yard of the Anna Hiss Gymnasium building (A6) — a tall
slender bronze. Add it while you are in there.

---

# PART E — DOWNTOWN DEPTH. Explicitly last.

## E1. The small downtown buildings are skeletons

*"downtown big buildings are a bit more detailed which is nice, but smaller ones
are just skeletons - when i say make downtown vibrant i mean a UT campus level
transformation. alot of downtown towers have unique shapes and designs im sure
the data isnt an issue."*

PR #99 gave the tall ones podiums, setbacks and crowns. The mid-rise and low-rise
did not get it. **UT-campus level** is the bar he named: real roofs, real
materials, ground-floor retail, plant on the roofs.

**AND CHECK THE COLOUR.** In `shots/tour/day-downtown-skyline.png` the downtown
towers read as a dark grey mass next to a warm campus. That may be a real
regression from the tile switch (PRs #84/#94) rather than a design choice —
measure it against the campus buildings before adding anything.

## D11. The outer ring pads over ground the city models properly

**Found by D1, and it is not a Capitol problem.** `outer-detail` carries the
outer ring's 309 flat park pads as a `fill-extrusion` at **h 0.45 m**, opacity 1.
The Capitol grounds get one, and it buries `ground-areas` (a flat fill at z=0)
and `ground-paths` (0.22 m) under it — both lose the DEPTH test, so no layer
reorder can help. Measured with the magenta mask asked of every layer in turn:
`outer-detail` covers **98.6%** of the Capitol's south lawn and nothing else
covers any of it.

The Capitol works around it by standing its own ground at 0.46 m
(`CAPITOL.groundLift`), which is a patch, not a fix. **Every other modelled
block inside a ring park pad has the same defect and no workaround.** The fence
only just grew to 77.4 km² (#105), so the modelled area and the ring's
assumptions about it have drifted apart. `scripts/bake_outer.py` should not emit
a pad where the city has real ground, or `js/outer.js` should not draw one there.
Check the whole modelled box for other pads before deciding which.

---

## Not negotiable

1. **Never register a self-hosted GitHub runner.** Public repo.
2. **Never remove the watchdog or reaper in `scripts/verify/chrome.mjs`.**
3. **Never leave a browser or a server running.** `reap.mjs` and kill your server
   before finishing every pass. **Three browsers at once, maximum.**
4. **Record every pass in `HANDOFF.md`** with the branch name, including what you
   tried that did NOT work.
