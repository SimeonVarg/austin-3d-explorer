# Common brief — every building pass reads this first

Written 2026-07-31. This is the shared half of the five building-pass prompts in
`docs/FIVE_BUILDING_PASSES.md`. Each of those blocks says "read this file" and then
adds only what is specific to its buildings. Everything below is mandatory and none
of it is theory — every rule here is a bug that already shipped once.

---

## 0. The app

**Austin 3D Explorer**, `C:\Users\simip\Projects\austin-3d-explorer`. A MapLibre GL JS
5.24 flyover of UT Austin and West Campus going out on AWS Kiro's channels. Plain
static HTML/CSS/JS, **no build step**. Serve the repo root:

```bash
python -m http.server 8099 --bind 127.0.0.1
```

Check whether one is already running on 8099 before starting another.

It is **MapLibre, not three.js**. Your tools are: GeoJSON sources, `fill`, `line` and
`fill-extrusion` layers, and procedurally generated canvas images registered with
`map.addImage`. There are no meshes, no shaders you can write, no sloped faces, and no
per-vertex colour. Every piece of "geometry" you add is a flat polygon with a `base`
and a `height`. Read `scripts/bake_stadium.py` and `js/app.js`'s `addStadiumLayers` —
that pair is the worked example of replacing one real building with authored geometry,
and it is the pattern you are copying.

**Read before you plan.** In this order:
- `js/app.js` — the boot sequence, the `step()` registry, `addBuildingLayers`,
  `addStadiumLayers`, and how layers get anchored.
- `scripts/bake_stadium.py` — how a bake reads the snapshot, emits stacked bands, and
  declares `replacedBuildingIds`.
- `js/facades.js` — how wall pattern images are generated and registered. Read the
  header comment; it is the single densest source of measured truth in the repo.
- `js/capitol.js`, `js/outer.js`, `js/union24.js` — three different shapes of
  self-booting module.
- `scripts/verify/README.md` — the screenshot and perf harness, and the traps in it.

**The data.** `data/snapshots/2026-07-30/buildings.detailed.geojson` — 2,453 buildings
with `name`, `building_class`, `final_height`, `num_floors`, `id`, and the day/golden/
night wall and roof colours (`wd`/`wg`/`wn`, `rd`/`rg`/`rn`). The detailed bbox is
lon −97.752…−97.726, lat 30.276…30.296. Anything outside that is in the low-detail
outer ring (`data/outer_ring.geojson`, 7,625 buildings) and is not yours.

---

## 1. Get real reference. This is the whole job.

The point of these passes is that **the buildings stop being generic**. A pass that
invents a plausible facade has failed even if it renders beautifully.

Go find the actual building. Use web search, Wikipedia, the university's own facilities
and campus-planning pages, the architect's project page (Page, Overland, Populous, HKS,
Gensler and Kirksey have all built here and all publish elevations), news coverage of
the construction, Google Maps and Street View, real estate listings for the residential
towers, and photographs. Emporis-style databases, the Austin Historical Survey, and the
UT Buildings Inventory all carry floor counts and completion dates.

Write down, per building, in the doc you produce:

- **Floors, and the floor-to-floor height** you derived from them. `final_height ÷
  num_floors` is a check on your reference, not a substitute for it.
- **The facade system.** Punched openings in masonry? A curtain wall? Precast panels
  with a strip window? A rainscreen? These four look completely different and the
  difference is visible from 400 m up. Say which one and cite where you got it.
- **The material, and its actual colour**, sampled off a photograph's pixels — not
  guessed, not "limestone is about #d8d0c0". Pull the hex. Note the lighting in the
  photo you sampled and correct for it.
- **The window rhythm**: bay width, how many bays across each elevation, whether the
  ground floor differs (it almost always does), where the setbacks are.
- **What is on top.** Mechanical penthouse, parapet, cornice, crown, signage, an amenity
  deck. The roofline is what the camera sees most of.
- **Anything that makes it recognisable to somebody who has stood in front of it.**

Then say honestly, for each fact, whether it is **sourced** or **generative**. The bake
scripts in this repo already do this — see the `provenance` block at the end of
`bake_stadium.py`. Copy that habit.

**What is genuinely not available**, so you do not waste a day: there is exactly ONE
building in the core bbox with a `building:colour` tag in OSM, aerial imagery sees roofs
and not walls, and street-level coverage of the campus interior is thin and tree-blocked.
Per-building *measured* wall colour across thousands of buildings is not a thing. That is
precisely why these passes exist: for twenty named landmarks you can look at a photograph
and author it correctly, and that is worth more than any amount of procedural cleverness.

---

## 2. The reference-to-generator method

From `utx-diorama/docs/VISUAL_REFERENCE_PLAYBOOK.md`. Fire these BEFORE you draw anything.
The window pattern on Union on 24th cost ten correction rounds for want of them.

1. **Derive the rule, then verify it reproduces every example before you draw.** Set up a
   coordinate system, classify each cell into a tiny alphabet, find the modular rule,
   then confirm it regenerates every cell you can see in the reference. A wrong cell
   means a wrong *rule* — fix the rule, never patch the cell.
2. **Build the render → pixel-sample → assert harness as coding step ONE, not last.**
   Render headless, read pixels, assert exact hex at named features. And confirm you are
   sampling *your* output and not a fallback that happens to look plausible — a whole
   session was once spent "fixing" the basemap's grey buildings because our own layer had
   silently failed to load.
3. **Sample exact colours and measurements. Never guess.** Guessed values always cost a
   round.
4. **Uniform primitives are the null hypothesis.** Every bay is the same size *and the
   same internal composition* until the reference proves otherwise. Variation lives in
   the surround and the connections.
5. **Parameterise every axis of variation up front** — bay pitch, orientation, extents,
   colour map, z-order — in a taste block at the top of your module, so every later
   correction is a one-line value change and not surgery across draw calls.
6. **Disambiguate "where does this go" with ONE labelled render.** When the question is
   *which* edge or sub-rectangle, render a single large labelled cell, or two candidate
   readings side by side, and confirm before tiling it across hundreds of cells.
7. **Read the source correctly, and do not rationalise a defect you can see.** A single
   2D projection lies about depth. Derived data disagreeing with the photo loses to the
   photo. And when it looks wrong, reproduce it and look — "it's still loading, it'll
   settle" is how you ship a defect.

---

## 3. Traps that will cost you hours. All measured, all real.

**`fill-extrusion-pattern` is TILE-locked, not world-locked.** The 64 px pattern repeats
once per tile, so its world size *halves every integer zoom*: ~14.8 m at tile zoom 18,
~30 m at 17, ~59 m at 16, ~118 m at 15. A tile designed as "one storey" is one storey at
exactly one zoom and wrong everywhere else. The file header in `js/facades.js` used to
claim the opposite and was flatly wrong. Do not trust any doc on this — render it and
measure.

**A pattern has no vertical anchor.** It repeats from the extrusion base with no idea
where the top or bottom of the building is. So anything you put "at the top" — a cornice,
a crown — appears every ~40 m all the way up the wall. **The only way to get a base
storey, a string course or a cornice is stacked geometry: emit the wall as several
features with different `base`/`height` and different patterns.** `bake_stadium.py`'s
`BANDS` list is exactly this and is your template.

**`fill-extrusion-vertical-gradient` restarts per extrusion.** Stack bands and you get a
dark seam at every boundary. Turn it off on banded walls (see the `stadium-wall` layer).

**Extrusion top faces pick up the sun tint.** An input of R/B 1.18 renders at 1.85.
Enter roof colours COOL so they land neutral.

**Layer anchoring.** `map.addLayer(layer, beforeId)` inserts *before* `beforeId`. The
basemap's first symbol layer comes immediately after `background`, so anchoring there
drops your work to the BOTTOM of the stack, under the ground. This already happened: the
stadium rendered underneath `ground-areas`. Anchor to the first symbol layer that appears
*after* `buildings-3d` — `addStadiumLayers` has the loop that finds it, copy it.

**`queryRenderedFeatures` on a fill-extrusion answers by FOOTPRINT.** It is unreliable
for "which layer owns this pixel". Use `scripts/verify/isolate.mjs` to render a pose with
only named layers visible instead.

**Canvas performance.** `drawImage` *from* a WebGL canvas forces a pipeline flush no
matter how small the destination. A 2D context created with `willReadFrequently: true`
takes a CPU path for `drawImage` — 230 ms against 22 ms. If you need noise on a tile,
write it into the pixel buffer you are already reading, do not composite a second canvas.

**Your building may be replaced already.** `data/stadium.geojson` carries a
`replacedBuildingIds` array and `app.js` filters those ids out of `buildings-3d`. If two
passes replace the same id, one of them renders inside the other. Check the ids you claim
against every other `replacedBuildingIds` in `data/` before you claim them.

---

## 4. The integration contract

Follow it exactly and five passes merge cleanly.

**Your bake** (`scripts/bake_<slug>.py`) reads the snapshot, writes
`data/<slug>.geojson` as a `FeatureCollection` with an extra top-level
`replacedBuildingIds` array listing the `properties.id` of every building whose generic
extrusion your geometry supersedes, and prints a JSON summary with a `provenance` block
saying which values are sourced and which are generative.

**Your module** (`js/<slug>.js`) is an IIFE that:
- exposes `window.init<Slug>(map)` and `window.apply<Slug>Colors(map, p)`;
- **self-boots** — poll for `window.__map`, wait for `map.getLayer('buildings-3d')` and
  for whatever facade quantiser you need, then run. Copy the `boot()` at the bottom of
  `js/outer.js` verbatim; `app.js` will not call you;
- hooks `window.applyTimeOfDay` the way `outer.js` does, so your colours ride the
  day/golden/night ramp. **A building that only looks right at noon is not done.**

**The `<script>` tag already exists** in both `index.html` and `_harness.html`, pointing
at your stub. Do not add it, do not move it, do not touch either HTML file. Five passes
plus the DKR pass all editing the same two script lists is a guaranteed conflict, and the
opposite failure — a module that loads nowhere — is how `js/roofs.js`'s 12,058 features
sat dead in the repo for days. If you genuinely need a line of HTML, put the snippet in
your PR body and say so loudly.

**Do not edit** `js/app.js`, `js/facades.js`, `js/ground.js`, `index.html`,
`_harness.html`, `js/atmosphere.js`, `js/graphics.js`, or any file owned by another pass.
If you need a hook in `app.js`, wrap the global from your own module instead — that is
what `outer.js` does with `applyTimeOfDay`, and it is why `outer.js` needs no changes
anywhere else.

---

## 5. Verification — non-negotiable

**Verify by looking.** This project has repeatedly shipped fixes that were argued rather
than observed, including one where I reported a glazing ratio I had computed wrong in a
comment and never checked in code. Render it, sample pixels, open the image.

- `scripts/verify/shot.mjs <prefix> <shots.json>` — screenshots at named camera poses.
- `scripts/verify/isolate.mjs` — render a pose with only the layers you name.
- The harness URL must carry `?intro=0&drift=0` or your first frame is the intro's end
  pose, not the pose you asked for. This wasted two debugging sessions.
- Wait for idle before shooting. Data-driven paint does not land in the same frame as the
  call — take the shot twice and trust the second.

**Judge from the flying camera, not from overhead.** An orthographic top-down always
looks fine and tells you nothing. The camera lives 200–900 m up at 60–75° of pitch. At
that distance one pixel of wall texture is roughly half a metre, so a 1 m feature is
invisible and a 10 m one reads. This is also why brick coursing is not drawable here: a
7 cm course is a tenth of a pixel, and drawing it anyway draws a half-metre course, which
is concrete block.

**Hold the frame rate.** The scene already carries ~12,000 trees, ~6,000 props, 12,058
roof features, a 7,625-building outer ring and a full post-process stack. Measure with an
**interleaved A/B** and report the **MINIMUM of the reps, never the mean** — a mean
measures the machine, and that mistake has already produced one false regression report
in this repo. Measure in headed Chrome; headless uses the software rasteriser and you
will be timing swiftshader. No screenshots during a timing run. Copy the shape from
`scripts/verify/ground-perf.mjs`.

**Report honestly.** A short true list of what you did not reach beats a confident
summary. If something is generative rather than sourced, say so.

---

## 6. Deliverable

A branch and a PR. In the PR body:

- **Before / after screenshots from the flying camera**, at two times of day, with the
  building actually in frame at a size the viewer would see it.
- **The reference table** — per building: floors, floor-to-floor, facade system,
  sampled hex, bay rhythm, roofline, and a source for each.
- **The measured frame cost**, as a minimum-of-reps interleaved A/B, and the feature
  count you added.
- **The honest list of what is still missing.**

Plus a short `docs/PASS_<SLUG>.md` in the repo carrying the reference table, so the next
person does not re-derive it.
