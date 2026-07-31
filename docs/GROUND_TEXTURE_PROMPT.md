# One parallel pass — make the ground look like ground

Run this in ONE session, alongside the window/facade work happening in the main session.

**Ownership split — the only rule that matters for parallelism:**
- **This pass owns** `js/ground.js`, `scripts/bake_ground.py`, `data/ground.geojson`,
  and any new texture-generation code it needs.
- It must **NOT** edit `js/facades.js`, `js/app.js`, `index.html`, `_harness.html`,
  or `js/atmosphere.js`. Those are being changed right now in another session and a
  conflict there costs a merge.
- If it genuinely needs a line in `index.html`, it leaves the snippet in its PR body
  instead of editing the file. (Read the commit `9f40bfd` first to see why that rule
  exists — two modules shipped and loaded nowhere because a script tag was missing.)

---

```
You are working on the Austin 3D Explorer (C:\Users\simip\Projects\austin-3d-explorer),
a MapLibre GL JS 5.24 flyover of UT Austin and West Campus that is going out on AWS
Kiro's channels. Plain static HTML/CSS/JS, no build step. Serve the repo root with
`python -m http.server 8099 --bind 127.0.0.1` (check whether one is already running
before you start another).

READ THE APP BEFORE YOU PLAN. It is MapLibre, not three.js: GeoJSON sources +
fill/line/fill-extrusion layers + procedurally generated canvas patterns. Start with
js/ground.js and scripts/bake_ground.py, and read js/facades.js purely as a worked
example of generating pattern images in a canvas and registering them with map.addImage
— that is the technique available to you.

== THE COMPLAINT, VERBATIM ==
"the ground doesnt look like the ground it looks like a walkway of flour. Roads should
look like roads. Add a bit of texture. Grass and water should also have a bit of texture"

Three things, in priority order:
  1. ROADS DO NOT READ AS ROADS. Everything drivable is currently the same pale warm
     tone as the footpaths. Asphalt is dark, slightly blue-grey, and has lane markings.
     Right now a six-lane arterial and a 2 m campus footpath are nearly the same colour.
  2. EVERYTHING IS FLAT COLOUR. Every surface in data/ground.geojson is painted with one
     flat hex from a `match` expression on the `s` property. At flying altitude a
     600 x 400 px region of unbroken flat tan reads as paper, not ground.
  3. GRASS AND WATER NEED TEXTURE TOO. Same problem, and water especially — it is one
     flat blue with no variation at all.

== A TRAP THAT WILL COST YOU A DAY IF YOU MISS IT ==
The paving tones are pale ON PURPOSE and you must not simply darken them back.
Read the comment block at the top of the SURF palette in js/ground.js. The first version
of this layer had paths at luma 185 against a ground at 188.5 — 3.5 luma of separation —
and the entire path network was invisible even though it was rendering perfectly. That
was proved with a magenta debug pass (6.2% of the frame) BEFORE any colour was touched.
The fix was to drop the base ground to a mid warm grey and LIFT the paving.

So: roads going darker is right, but re-check path-vs-ground separation afterwards and
keep it. If you reduce it, you have reintroduced a bug that has already been fixed once.
Measure it, do not eyeball it.

== WHAT TO DO ==

ROADS. data/ground.geojson has an `s` (surface) property per feature — see the SURF
palettes in js/ground.js for the full key list; `asphalt` already exists as a key. Find
out what OSM/the bake actually classifies as roadway versus footway (scripts/bake_ground.py
is where surfaces get assigned) and make sure roads are genuinely getting `asphalt` rather
than falling through to a paving tone. Then:
  - asphalt goes darker and cooler than any pedestrian surface
  - width should track the real road class, not one width for everything
  - centre lane markings on the major roads only. Dashes, not solid, and only where a
    real road has them. Do not put lane markings on a campus walkway.

TEXTURE. Two techniques are available and you should measure both before choosing:
  (a) `fill-pattern` with a procedurally generated tile, same approach as js/facades.js.
      NOTE: fill-pattern does NOT tile the same way fill-extrusion-pattern does. Verify
      the actual scaling behaviour with a test render before you design a tile around an
      assumption — do not trust either me or the docs on this.
  (b) Cheap per-feature colour variation: hash the feature id into a small lightness
      jitter so 3,117 areas stop being 12 exact hexes. No new images, near-zero cost.
  Grass wants a mottled, slightly varied green; asphalt wants fine noise plus patching;
  water wants gentle banding or ripple, and it should still read as water at night.

TIME OF DAY. Everything must work across the full day/golden/night cycle. js/ground.js
already has day/golden/night palettes and an applyGroundColors(map, p) that interpolates.
Anything you add has to ride that same ramp — a texture that only looks right at noon is
not done.

== NON-NEGOTIABLES ==

VERIFY BY LOOKING. This project has repeatedly shipped fixes that were argued rather than
observed. Render it, sample pixels, look at the actual frame. scripts/verify/shot.mjs
takes screenshots at named camera poses (`node shot.mjs <prefix> <shots.json>` from
scripts/verify), and scripts/verify/isolate.mjs renders a pose with only the layers you
name so you can judge the ground with the buildings hidden. Read scripts/verify/README.md
first — it documents traps that will otherwise waste hours.

JUDGE IT FROM THE FLYING CAMERA, not from an overhead view. An orthographic top-down will
always look fine and tell you nothing. The camera spends its time 200-900 m up at a pitch
of 60-75 degrees. A texture with a 1 m feature size is invisible from there; a 10 m one
reads. Take the screenshot twice and trust the second — data-driven paint does not land
in the same frame as the call.

HOLD THE FRAME RATE. The scene already carries ~12,000 trees, ~6,000 props, 12,058 roof
features and a 7,625-building outer ring. Measure your cost with an interleaved A/B and
report the MINIMUM of the reps, never the mean — a mean measures the machine, and that
mistake has already produced one false regression report in this repo. scripts/verify has
several perf scripts to copy the shape from (ground-perf.mjs is the closest).

PARAMETERISE EVERY TASTE VALUE. Put them in the GROUND taste block at the top of
js/ground.js, next to the existing ones, so every later correction is a one-line change
and not surgery across draw calls.

BE HONEST ABOUT WHAT YOU DID NOT REACH. A short, true list beats a confident summary.

== DELIVERABLE ==
A branch and a PR. In the PR body: before/after screenshots from the flying camera at
two times of day, the measured frame cost, the measured path-vs-ground luma separation
before and after, and the honest list of what is still missing.
```
