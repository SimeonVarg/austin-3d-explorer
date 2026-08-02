# QUEUE — Acer lane

Rewritten 2026-08-01, late, from Simeon's own list. Everything above this in git
history is superseded.

Work top to bottom. One PR per item. Merge your own verified work, resolve your
own conflicts, **never merge red**. If an item cannot be finished, write down why
in the PR and move to the next — do not stop.

**The Mac owns `js/outer.js`, `js/stadium.js`, `js/lod.js`, `scripts/tile.sh` and
`.github/workflows/` tonight** (MAC_QUEUE M1–M8). Stay out of those. Everything
else here is yours.

---

## The three traps that keep costing hours

1. **`python -m http.server` cannot test this site.** It ignores `Range:`, which
   PMTiles needs, and every feature in a tiled layer silently vanishes with no
   console error. Use `python scripts/serve.py 8123`.
2. **A missing layer makes every metric look BETTER.** Verify with a picture —
   `node scripts/verify/tour.mjs day` and `night` — before believing a number.
3. **Assert the effect, never the intention.** The Drag rendered white at night
   for weeks while `window.__dragTodHooked` said `true`; the flag was set two
   lines under the assignment that was missing.

**Minimum of interleaved reps, never one reading.**

---

## Progress, 2026-08-02 — eight PRs merged, all verified, all branches deleted

| item | state |
|---|---|
| A1 movement dies on the slider | **DONE** #54 — a focus guard, not hardware. Windows focuses sliders on click, macOS does not. |
| A2 roofs become windows in low detail | **DIAGNOSED, handed to the Mac** — `TIERS.mid` hides the roof CAP; written into MAC_QUEUE M4 with three candidate fixes. |
| A3 Speedway fans out | **DONE** #55 — paths are polygons now. Measured 3.69x too wide at pitch 86. **Roads still carry it.** |
| A4 Tower clock at night | **DONE** #56 — the bezel was a solid near-white disc, not a ring. It cannot be made to GLOW in MapLibre 5.24; four measurements in the PR. |
| A5 diagonal roofs | **DONE** #57 — a 2.1 m noise vertex folded the inset and deleted a whole 36 m slope. 1,050 of 2,455 footprints affected. |
| A6 Battle Hall grey roof | **ANSWERED, no change** — it is terracotta. The grey roof is the West Mall Office Building next door. |
| A7 creek murky | open, folded into B6 |
| B1 six grey-box artworks | **DONE** #58 — all 34 pieces, 350 parts, ten recipes. Kelly's chromatic circle is in. |
| B5 tree variety | **DONE** #59 — species profiles, 25,341 → 41,964 features, payload still DOWN at 9.74 MB. |
| B4 depth / stairs | **DONE** #62 — a reusable step generator; the Littlefield Fountain has its basin and both flights. |
| B3 Turtle Pond | **PARTLY** #63 — a 12,569 m² "garden" slab was covering it. Turtles and the water colour still open. |
| B9 roof colour variety | **DONE** #60 — measured off the imagery, relative to the campus median, amplified 3.5x and declared. |

**Still open: B2, B3 (turtles + water colour), B6, B7, B8, C1.** They are unchanged below.

Three things worth carrying into the next pass:

- **`scripts/verify/pose.mjs` is new.** Photograph any pose from the command
  line, one browser for the whole list. `--extra "&tiles=0"` forces the GeoJSON
  fallback, which is how you verify a change to a TILED layer without
  tippecanoe (there is no usable Windows build).
- **`tour.mjs` needs `VERIFY_MAX_MS=900000`.** Twelve poses exceed the 300 s
  default watchdog and it dies at pose 8 with no warning.
- **Tiles are rebuilt with `gh workflow run build-tiles.yml --ref <branch>`.**
  It commits the archives back to that branch in about 20 seconds. Any change to
  trees, roads, outer, roofdetail or props does nothing in the app until you do.

---

# PART A — BUGS. These are visible and they come first.

## A1. Movement dies on the Acer when the daylight slider moves

**Acer only. The Mac is fine — so this is reproducible on exactly one machine,
which makes it a hardware/driver interaction, not a logic error.**

Simeon: *"on acer when i change daylight i can't move anymore - also sometimes
even when i dont change movement stops."*

Two symptoms, possibly one cause:

- moving the time-of-day slider kills WASD/drag input
- movement sometimes stops on its own with no interaction

**Where to look first.** A time-of-day step retints every pattern atlas —
`js/facades.js` repaints its images and six passes push their own tiles. On a
machine where that takes long enough, the main thread stalls; if the flight
controller's loop is driven by `requestAnimationFrame` and something throws
inside a retint, the loop dies silently and never restarts. Check `js/controls.js`
for a rAF loop with no try/catch, and check whether an exception during retint
leaves `__fly` stopped.

**Reproduce before theorising.** Drive it headed on the Acer, move the slider,
then send synthetic key events and assert the camera actually moved. Log every
`pageerror`. The "sometimes even when i dont" case matters more than the slider
case — find what they share.

## A2. Roofs turn into windows in low detail mode

Simeon: *"when i go up on low detail mode the roofs of houses become windows this
is pretty bad."*

Climbing with a low graphics preset makes house roofs render as window patterns.
Almost certainly a facade pattern being applied to a roof layer when the roof
layer is dropped or swapped by LOD — a roof taking the wall's `wp`, or
`buildings-roof` being hidden so the wall pattern shows on the top face.

`js/lod.js` is the **Mac's** file tonight (MAC_QUEUE M7). Diagnose it, write the
finding into that item, and fix only what lives outside `lod.js`. If the fix is
inside it, hand it over rather than colliding.

## A3. Speedway grows enormously wide as the camera nears horizontal

Simeon: *"i look closer to horizontal (low) and speedway gets super wide and
right after monochrome is a seperate layer thats a bit narrower that also grows
wider as i approach 90 degrees see root cause and fix."*

**Two layers, one cause — find it once.** A road drawn as a `line` with a
pixel-based width does not stay a fixed number of metres on the ground: at high
pitch the same pixel width covers far more world distance, so the road fans out.
`data/roads.geojson` carries a real `w` in metres (Speedway `w: 12.0`), so the
data is right and the rendering is not.

The fix is to draw width in metres, not pixels — either a fill/extrusion of the
real footprint, or a `line-width` interpolated against zoom so it tracks ground
scale. Check what `js/ground.js` already does for the asphalt; the second,
narrower layer that also fans is the tell that this is one shared rule.

`js/ground.js` may be quiet tonight but confirm against the Mac's open PRs first.

## A4. The Tower clock still does not shine at night

Reported before and still wrong. `data/tower.geojson` has 113 features with a
bright night colour including `#ffdca8`, `#fff3cf` — so the *data* says lit.
Check that those features are actually the clock faces, that nothing paints over
them after dark, and that the clock is not being dimmed by the same ramp that
darkens the shaft. Verify with a close night pose, not from altitude.

## A5. Two buildings have diagonal roofs

Simeon: *"blanton has a diagonal roof ... theres another diagonal roof building a
bit east of blanton."*

A roof plane running diagonally across a rectangular footprint. Find both, work
out whether it is a bad hip axis in `scripts/bake_roofs.py` (an `az` computed
from the wrong edge) or a footprint whose longest axis is misread. **Fix the
rule, not the two buildings** — if the axis derivation is wrong it is wrong
elsewhere too, so report how many buildings share the symptom.

## A6. Battle Hall has a grey roof — is that right?

Cheap check, do it early. Battle Hall's roof is red clay tile in life. If it is
grey in the render, find out whether it is missing from the authored roof set or
picking a default. One line in the report either way.

## A7. The creek behind the Alumni Center just went murky

Simeon: *"i tried doing a creek pass behind the alumni center it just made the
water murky."*

See Part B item B6 — the fix is the same work, so do them together.

---

# PART B — MAKE THE SCENE REAL. Go wide here; this is the overnight work.

## B1. The public art is six grey boxes and the data is already good

**This is the highest-value item in Part B and the most self-contained.**

`data/props.geojson` already carries every one of these with a name, a height and
an artist. `js/props.js` draws all of them with **one flat colour and one
extrusion** — so a 7 m Nancy Rubins aluminium explosion and a 5.5 m steel
sculpture are both a grey block.

| in the data now | what it is |
|---|---|
| `Monochrome for Austin` — Nancy Rubins, h 7.0 | a burst of welded aluminium canoes |
| `Clock Knot` — Mark di Suvero, h 5.5 | red-orange steel I-beams, a leaning knot |
| `The West` — Donald Lipski, h 4.5 | a mirrored sphere on a ring |
| `Diana the Huntress` — Anna Hyatt Huntington, h 5.5 | bronze figure with a bow |
| `Austin` — Ellsworth Kelly, h 8.0 | a stone chapel with **coloured glass** |
| `Sea Turtle` — Dylan Connor, h 4.2 | a bronze turtle |

**What to do.** Author each one the way `js/capitol.js` authors the dome: a small
generated form, per-piece, keyed on `name`, with its own colour and material.
None of these needs to be a model — they need to be *recognisable at 60 m*. A
canoe burst is a dozen thin angled slabs from a common origin. A knot is three
crossed beams. A mirrored sphere is a stack of discs with a bright specular
colour. Ellsworth Kelly's *Austin* is a white barrel-vaulted box with **coloured
glass panels** — Simeon called this out specifically: *"chromatic circle of glass
can you add that with the colors."*

Keep the generic grey box as the fallback for everything unnamed. Parameterise
every colour and dimension (rule 11).

## B2. Ellsworth Kelly's lawn should look like somewhere you'd sit

Simeon: *"that whole area is supposed to be green can you make it look nicer (not
just add green lol)."*

So: not a green polygon. Real ground surfaces from `data/ground.geojson`, path
edging, scattered trees at real positions, benches from the props furniture set,
and the paving pattern around the chapel. Look at what `ground.geojson` already
carries for that block before adding anything new.

## B3. Turtle Pond, with turtles

> **PARTLY SOLVED 2026-08-02 (PR #63) — read this before starting.**
>
> The premise below is wrong: the pond was NOT "flat blue". It rendered as solid
> lawn green because a `props-line` feature — an OSM `leisure=garden` **area**
> baked as a 0.55 m raised slab, **12,569 m²** of it — was painted over the whole
> Memorial Garden block including the pond. Capped at 150 m² in
> `bake_props.py`; three features in the city exceeded it. The pond, its paths,
> its beds and a bench are all visible now.
>
> **What is still to do here:**
> 1. The pond reads **silver-grey, not blue**. `GROUND.texStrength.water` is
>    0.95 and the water texture washes the `#8fbccd` fill out almost completely.
>    Look at that number before anything else.
> 2. The turtles. The generator works and is worth rebuilding: a `dome()` of
>    stacked chords plus a head, twelve of them, placed deterministically (no
>    `Math.random` in a bake that must produce the same file twice), half hauled
>    out on the rim and half floating.
>
> **And a rule, not a detail: `terrace()` from `scripts/bake_depth.py` is a
> BASIN tool and Turtle Pond is not a basin.** It is a 60 m winding ribbon under
> 4 m across for most of its length. A 1.6 m rim buffered in from both banks left
> almost no water; narrowing the courses to 0.16–0.55 m over 1.1 m offsets made
> them near-coplanar with the ground fill and the render came back as a stripe of
> z-fighting slivers across the lawn. Measure the shape before choosing an offset.


`data/ground.geojson` **already has** `Turtle Pond` as `u: water, s: pond`, and
`props.geojson` has a `Sea Turtle` statue. So the pond exists and is presumably
flat blue.

Give it: a depressed water surface with a bank, planting around the edge, and
**actual turtles** — small dark low domes on the rocks and in the water, a
handful, at slightly different sizes and angles. This is a texture-of-life
detail; a dozen 30 cm domes will read from the air.

## B4. Depth: stairs, terraces, sunken and raised ground

Simeon: *"fountain in front of tower has stairs on both sides is that possible
depth throughout or did we already rule that out."*

**It is possible and it was never ruled out.** A `fill-extrusion` takes a `base`
and a `height`, so a flight of steps is N thin extrusions at rising bases —
exactly the trick `bake_roofs.py` already uses to imply a hip and
`shape_trees.py` uses to taper a crown. Nothing new is needed.

Do the Littlefield Fountain first because he named it: the basin, the steps on
both flanks, the terrace it sits in. Then look for other places where the ground
is not flat and currently pretends to be — the South Mall terraces are the
obvious next one.

Write it as a **reusable step generator in the bake**, not as hand-placed
geometry, so the next terrace costs one call.

## B5. Trees: real variety, rounder crowns

Simeon: *"i said taper them and u added like one smaller octagon on top make it a
big smoother, more like round tree type cool things and different types."*

Fair. The current taper is one narrower octagon stacked on top — the minimum
viable version of the idea.

**Do it properly:** three or four tiers with a smooth radius curve rather than
one step, and **distinct species profiles** rather than one shape scaled:

- live oak — wide, low, spreading, the campus default
- cedar elm / pecan — taller, narrower, higher crown
- a conifer form — narrow and pointed
- a small ornamental — low and round

`data/trees.geojson` carries species where the city inventory had it — use it,
and fall back to size-based assignment where it does not. **Watch the feature
count**: `js/lod.js` drops `trees-canopy` as one pass at altitude and the file is
already the largest in the app. More tiers means more features; measure the
payload and the frame time before and after, and keep the tier count a
parameter.

## B6. Waller Creek behind the Alumni Center — depth and greenery

The creek currently reads as murky flat water. Give it a **cut**: banks stepped
down to the water with the same step generator from B4, water below grade rather
than painted on top, and dense planting along both banks. The isoperimetric
shape classification already separates creek from pond — use it so the two get
different treatments.

## B7. The circular thing behind the Drama Building

Simeon: *"the area that looks like it has construction behind drama building that
circular area has stuff find it and add it."*

Find out what it actually is before modelling it — a circular plaza, an
amphitheatre, a genuine construction site, a fountain. Check `ground.geojson` and
OSM for what is recorded there. Then build it. Say in the PR what you concluded
it is and how you decided.

## B8. Sidewalks, especially West Campus

Simeon: *"roads are wtv but sidewalks especially in wampus are a bit lame."*

Kerb line, a slightly raised surface rather than a painted strip, crossings,
tree pits, and a texture that is not one flat grey. West Campus first because he
named it. This shares the ground pipeline with A3 — if the sidewalk width has the
same pixel-vs-metres problem, fix it once.

## B9. Roof colour: mostly burnt orange, some redder

Simeon: *"some of the roofs on campus are not all burnt orange some of them are
more red can we add a bit of variety corresponding to real color? i like the
burnt orange but add a tiny bit of red to some."*

**Corresponding to the real colour**, not random jitter — that is the whole ask.
Sample the actual roofs from imagery where the roof survey has them, and where it
does not, vary by building era or by pass. Keep the burnt orange dominant; this
is a small deliberate spread, not a rainbow. Parameterise the spread so he can
turn it down in one edit.

---

# PART C — the tiling work that is still open

## C1. Buildings on vector tiles

**Not done — Simeon assumed correctly.** Blocked on the same thing as the outer
ring: `quantiseFacades` elects the 14 most populous window tones across the
*whole* city and stamps `wp` per feature in the browser, which tiles cannot carry.

Measured at **14 ms**, so this is a *correctness* blocker, not a performance one.

The Mac is porting the outer ring's equivalent to Python as MAC_QUEUE M1. **Let
that land first and copy its shape**: port, prove parity feature-for-feature with
the JS pass still in place, then delete the JS.

**And yes, we can mix and match** — that is exactly what is running now. Trees,
roads, roof detail and props are vector tiles; buildings, ground, the Capitol and
every authored pass are still GeoJSON, in the same map, in the same style. There
is no requirement to convert everything, and no penalty for not.

---

## Not negotiable

1. **Never register a self-hosted GitHub runner.** Public repo.
2. **Never remove the watchdog or reaper in `scripts/verify/chrome.mjs`.**
3. **Never leave a browser or a server running.** `reap.mjs` and kill your server
   before finishing every pass.
4. **Record every pass in `HANDOFF.md`** with the branch name.
