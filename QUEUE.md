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

## C5. West Campus apartments — LAST, but he cares most about it

*"so many apartments in austin wampus have such cool designs but are currently
regular building blocks. Can you implement these designs?"*

He lives in **Standard** next year and said seeing his own building look good
would make him feel 5x better about the project. Do NOT cherry-pick Standard —
do the recognisable West Campus towers properly and Standard will be among them.
**This is explicitly last on his list. Do not start it until Parts A–D are done.**

---

# PART D — LANDMARKS AND DETAIL

## D1. The Capitol

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

## D6. Speedway got deleted

*"looks like speedway got slimed out somewhere in between add it back"*. Speedway
is the main pedestrian spine of campus. Find which pass removed it — the ground
resolver in PR #78 is the prime suspect since it clips overlapping surfaces — and
restore it.

## D7. Sidewalks look like duct tape

*"sidewalks in campus look like ducttape can we fix that? wont take much maybe a
few shading or texture things"*. They are flat pale strips with a hard edge.
Texture, a softer kerb, and joint lines would do it. He explicitly says this is a
small job.

## D8. The creek cuts straight through roads and buildings

*"the creek near DKR completely slices through 21st and DKR, but sidewalks still
go over them (added to the ducktape analogy) same thing happened with this creek
and other roads too"*

PR #79 cut the channel below grade and nothing taught it about crossings. Where a
creek meets a road or a building, there is a **culvert or a bridge** — the road
continues over the water. Find every creek/road and creek/building intersection
and deck them over.

## D9. Concrete in front of the Tower is blown out at sunset

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

---

## Not negotiable

1. **Never register a self-hosted GitHub runner.** Public repo.
2. **Never remove the watchdog or reaper in `scripts/verify/chrome.mjs`.**
3. **Never leave a browser or a server running.** `reap.mjs` and kill your server
   before finishing every pass. **Three browsers at once, maximum.**
4. **Record every pass in `HANDOFF.md`** with the branch name, including what you
   tried that did NOT work.
