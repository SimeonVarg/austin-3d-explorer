# Three more parallel passes — run alongside A (ground-life) and B (extend-radius)
Copy ONE block per agent. Ownership is disjoint from A and B and from each other.

**Who owns what, across all five running passes**

| Pass | Owns |
|---|---|
| A ground-life | `data/trees.geojson`, `data/props.geojson`, `data/landscape.geojson` + their scripts, `js/props.js`, `js/ground.js` |
| B extend-radius | `scripts/config.sh`, buildings fetch/enrich/bake, `data/snapshots/**`, `data/manifest.json`, `js/facades.js`, `js/graphics.js` |
| **C atmosphere** | `js/sky.js`, `js/atmosphere.js`, `js/night.js`, `js/timeofday.js`, `js/shadows.js` |
| **D roofscape** | `data/roofs.geojson`, `data/roof_runs.json`, new `js/roofs.js` |
| **E the film** | `js/signs.js`, `js/controls.js`, `js/diff-tour.js`, `data/signs.json`, new `js/flight.js` |

Nobody edits `js/app.js` or `index.html` — every pass leaves a one-line registration
snippet in its docs for Simeon to paste.

---

## PASS C — SKY, LIGHT, ATMOSPHERE AND SHADOW

```
You are upgrading the LIGHT of the Austin 3D Explorer
(C:\Users\simip\Projects\austin-3d-explorer) — a MapLibre GL 2.5D flyover of UT Austin
and West Campus that is going to be featured on AWS Kiro's socials.

Geometry is being handled by other agents. YOUR JOB IS THE SINGLE BIGGEST REMAINING
LEVER ON WHETHER THIS LOOKS REAL: the sky, the sun, the atmosphere, the shadows and the
night. A mediocre model in beautiful light reads as a photograph; a great model in flat
light reads as a video game.

READ THE APP FIRST. It is MapLibre GL, not three.js — GeoJSON sources, fill-extrusion
layers, procedural canvas patterns. Read js/sky.js, js/atmosphere.js, js/timeofday.js,
js/night.js and js/shadows.js end to end and understand the existing model before you
change it. There is already real thinking in there worth preserving — for example
facades.js deliberately runs TWO night schedules, because walls follow the sun while
windows follow the hour, after a measured inverted-dusk silhouette bug. Respect that
kind of prior work; extend it rather than flattening it.

== WHAT EXISTS ==
  js/timeofday.js drives a normalised p (0=day .. 1=night); everything keys off it.
  js/sky.js, js/atmosphere.js — sky dome / haze.
  js/night.js — already places 1,046 streetlights (404 major / 642 minor).
  js/shadows.js — ground shadows.
  window.skyBodies(p) returns sun elevation, already used by facades.js.
  ?clip=1 strips all UI for cinematic capture. A "Forty Acres" camera tour exists.

== THE BAR ==
This is going on a public feed, shot as a flyover. Concretely, chase:
  - A SUN THAT IS ACTUALLY RIGHT for Austin's latitude and the chosen date/time, so
    shadow direction and length are physically plausible rather than art-directed guesses.
  - GOLDEN HOUR THAT LANDS. This is the money shot for a social clip — long raking
    shadows, warm rim on west faces, cool fill in shade, the sky gradient doing real work.
  - A REAL NIGHT. Not "the same scene, darker". Sky gradient, window lights at varied
    intensity and warmth, streetlight pools, buildings silhouetting correctly against a
    lighter sky, and the UT Tower's burnt-orange lighting if you can reach it.
  - ATMOSPHERE WITH DEPTH. Distance haze so the far city recedes — this matters much more
    once another agent triples the radius and downtown appears on the horizon.
  - SHADOWS THAT SELL FORM. From flyover altitude, shadows are how a viewer reads height
    and massing. Cheap ground shadows that are the wrong shape hurt more than they help.
  You may add weather/mood states (clear, hazy, overcast, post-rain) if you think they
  earn their cost — a single moody state can carry a whole clip. Your call.

== CONSTRAINTS THAT WILL ACTUALLY BITE ==
1. *** THE APP ALREADY AUTO-DETECTS ~30 fps AND HAS DROPPED ITSELF INTO "performance"
   MODE (js/graphics.js). *** You are adding to a scene already at budget, and TWO other
   agents are adding geometry to it right now. Measure frame time before and after. If an
   effect is expensive, put it behind the existing quality tiers.
2. js/graphics.js is owned by the radius agent — do NOT edit it. If you need a new
   quality tier or flag, write the exact snippet into your docs and say where it goes.
3. Another agent is adding street furniture including lamp posts. You own the LIGHT;
   they own the OBJECTS. Make your lighting work whether or not a lamp mesh is present.

== GETTING WHAT YOU NEED — PRE-AUTHORISED ==
Never ask permission. Web research on sky/atmosphere models, real sun-position math for
30.28 N, and reference PHOTOGRAPHY of Austin at golden hour and at night (find real
photos and match them — do not invent a palette). A Google Maps API key exists at
C:\Users\simip\Projects\utx-diorama\.env for Street View reference; read it in-script,
NEVER print or commit it.

== VERIFY BY LOOKING ==
Run the app. Sweep p across the full day, at several locations and altitudes, and take
screenshots. Compare golden hour and night against real Austin photographs side by side.
A green build is not proof. If dusk looks wrong, say so rather than shipping it.

== YOUR SANDBOX ==
Git worktree, branch  look/atmosphere . Never commit to main.
You OWN: js/sky.js, js/atmosphere.js, js/night.js, js/timeofday.js, js/shadows.js, plus
any new module or data file you create, plus your docs.
DO NOT edit: js/app.js, index.html, js/graphics.js, js/facades.js, js/props.js,
js/ground.js, data/trees.geojson, data/props.geojson, scripts/config.sh, or
data/snapshots/**. Four other agents are running.

== DONE MEANS ==
Before/after screenshots at day, golden hour, dusk and night from the same camera;
a side-by-side against real Austin reference photos; frame-time before/after; a note on
what you put behind quality tiers; the registration snippet if you need one; and a commit
on look/atmosphere explaining the model you implemented and why.
```

---

## PASS D — THE ROOFSCAPE (what a flyover actually looks at)

```
You are building the ROOFSCAPE of the Austin 3D Explorer
(C:\Users\simip\Projects\austin-3d-explorer) — a MapLibre GL 2.5D flyover of UT Austin
and West Campus that is going to be featured on AWS Kiro's socials.

HERE IS THE INSIGHT THAT MAKES THIS PASS WORTH RUNNING: this product is a FLYOVER. The
camera spends most of its time above the city looking down. That means the surface the
viewer actually sees most is not facades — IT IS ROOFS. And right now roofs are the
least-developed surface in the scene.

READ THE APP FIRST. MapLibre GL, not three.js — GeoJSON sources + fill-extrusion layers +
procedural canvas patterns, wired in js/app.js, baked by scripts/*.py. Understand how
roofs are currently produced and drawn before changing anything.

== WHAT EXISTS (measured) ==
  data/roofs.geojson    2,883 features, props: az, b, h, rd, rdd, rg, rgd, rn
                        (azimuth, base, height, and roof day/golden/night colours with
                        'd' darker variants) — so roof PLANES and COLOUR already exist.
  data/roof_runs.json   EMPTY (0 features). Whatever it was meant to hold, it holds
                        nothing — that is a gap worth understanding and filling.
  data/parts.geojson    23 features only — sub-volumes are barely used.
  Reference of what "done" looks like: the Union on 24th hero build in
  C:\Users\simip\Projects\utx-diorama documented a real Level-29 roof in detail —
  a covered grill pavilion, a mechanical plant deck with dense condenser grids behind a
  louvre screen, a pool with a sun shelf, planters, paving. Read docs/U24_ROOFTOP_SPEC.md
  there for the flavour of what real roofs carry. You cannot port its geometry (wrong
  engine) but the VOCABULARY is exactly right.

== WHAT REAL ROOFS HAVE, AND THIS SCENE DOES NOT ==
Mechanical plant (condenser banks, AHUs, ducts, cooling towers), stair and lift overruns,
parapets of varying height, roof membrane vs gravel vs standing-seam vs tile, skylights,
solar arrays, water tanks, satellite/antenna clutter, rooftop amenity decks with pools and
planters, helipads, and on campus specifically: labs with fume-hood stacks, and the tile
roofs of the 1930s buildings. Right now most roofs are flat coloured planes.

== THE JOB — you decide the how ==
Make roofs read as real from flyover altitude. Get REAL data where it exists (aerial and
satellite imagery is the obvious source — rooftop equipment is directly visible from
above; OSM has roof:shape, roof:material, roof:colour tags; the City of Austin has
building and solar datasets). Where you must generate, drive it from something real:
building class, footprint size, height, and age all predict what is on a roof. A 1930s
campus hall gets tile and a chimney; a 1970s lab gets a stack farm; a modern student
tower gets an amenity deck; a parking deck gets nothing but stair cores and light poles.
VARIETY IS THE POINT — identical grey boxes on every roof is worse than nothing.

== CONSTRAINTS THAT WILL ACTUALLY BITE ==
1. *** THE APP ALREADY AUTO-DETECTS ~30 fps AND HAS DROPPED ITSELF INTO "performance"
   MODE. *** Roof clutter is a per-building cost multiplied by thousands of buildings.
   This is the pass most likely to destroy the frame rate. Budget hard: LOD by zoom and
   distance, only detail roofs above a footprint-area or height threshold, merge clutter
   into as few features as possible, and give it a density knob. Measure before and after.
2. Another agent is TRIPLING THE BBOX right now. Scope your detail to the CORE area only —
   the outer ring is deliberately a cheap tier and must stay cheap. Say explicitly in your
   docs what happens to roofs beyond the core.
3. Do not edit the buildings bake, data/snapshots/**, or js/facades.js — the radius agent
   owns those. Work from data/roofs.geojson and your own new files.

== GETTING WHAT YOU NEED — PRE-AUTHORISED ==
Never ask permission. Aerial/satellite imagery (Esri, Google, NAIP), OSM/Overpass roof
tags, City of Austin open data, and Google Street View for tall-building context. A Google
Maps API key exists at C:\Users\simip\Projects\utx-diorama\.env — read it in-script, NEVER
print or commit it. Probe /streetview/metadata for panorama dates before trusting imagery.

== VERIFY BY LOOKING ==
Run the app and fly it at the altitudes the product actually uses. Screenshot over the
campus core, the athletics precinct, West Campus and The Drag, and judge critically
against a real aerial of the same block. A green build is not proof. If it reads as a
field of grey lumps, say so and fix it.

== YOUR SANDBOX ==
Git worktree, branch  look/roofscape . Never commit to main.
You OWN: data/roofs.geojson, data/roof_runs.json, a new js/roofs.js, any new data file or
bake script you create for roofs, plus your docs.
DO NOT edit: js/app.js, index.html, js/facades.js, js/graphics.js, scripts/config.sh,
data/snapshots/**, data/trees.geojson, data/props.geojson, js/props.js, js/ground.js,
js/sky.js, js/night.js, js/shadows.js. Four other agents are running.

== DONE MEANS ==
Before/after aerials over four different districts; a side-by-side against a real aerial;
counts of what you added and by what rule; the LOD/threshold scheme written down;
frame-time before/after and how the density knob behaves; the registration snippet; and a
commit on look/roofscape explaining the vocabulary you built.
```

---

## PASS E — THE FILM: ROUTE, CINEMATOGRAPHY AND LABELS

```
You are making the Austin 3D Explorer (C:\Users\simip\Projects\austin-3d-explorer)
into something that can be POSTED. It is a MapLibre GL 2.5D flyover of UT Austin and West
Campus, and it is going to be featured on AWS Kiro's socials.

Other agents are improving what the world looks like. YOUR JOB IS THE SHOT: the route the
camera flies, how it moves, what it reveals and in what order, and how places are named
on screen. A beautiful city filmed badly is not a video. The deliverable is a flyover
someone would stop scrolling for.

READ THE APP FIRST. MapLibre GL, not three.js. There is ALREADY a camera system and you
must understand it before replacing anything:
  - ?clip=1 strips all UI for clean capture (see index.html + style.css .clip rules).
  - ?tour=1 replaces the intro with a "Forty Acres" tour; ?clip=1&tour=1 is a pure
    footage run. Waypoints live in js/app.js with INTRO / SPAWN / ORBIT blocks, hero
    arrivals with a "short push-in dwell", and any input ends the tour where it is.
  - js/controls.js is the manual joystick/look system.
  - js/diff-tour.js flies the snapshot-diff story.
  - js/signs.js + data/signs.json (48 signs) and ~220 OSM labels are the naming layer.

== WHAT IS WEAK ==
48 signs for a whole city, and a tour whose route was written before most of the scene
existed. Labels are the thing that turns a pretty flyover into something a viewer can
FOLLOW — "that's the UT Tower", "that's the stadium" — and 48 is not enough to carry a
narrative. The route also has to be re-judged now that the world is about to get trees,
roofs, better light and triple the radius.

== THE JOB — you decide the how ==
1. DESIGN A ROUTE THAT TELLS A STORY. A social clip is 30-60 seconds. Decide what the
   beats are — establish, approach, reveal, detail, pull out — and lay the path so each
   beat lands. Think about what enters frame and when. The UT Tower and DKR Stadium are
   the two icons; downtown is about to appear on the horizon when the radius triples.
2. MAKE THE MOVEMENT FEEL SHOT, NOT SCRIPTED. Easing, banking into turns, altitude
   changes that motivate reveals, dwell on arrival, and speed that varies with what is
   interesting. Straight-line lerps between waypoints read as a screensaver.
3. GET THE LABELS RIGHT. More of them, better placed, appearing and disappearing with
   intent rather than popping. Priority so the icons always win. Legible at social
   resolution — this will be watched on a phone.
4. MAKE CAPTURE EASY AND REPEATABLE. ?clip=1&tour=1 should produce identical framing
   every run so Simeon can re-shoot after other agents land their work. Consider a
   deterministic timeline, a fixed frame rate for capture, and a way to record.
   If you can produce an actual video file end to end, do it.
5. OFFER MORE THAN ONE CUT if you think it helps — a 15s vertical for stories and a 45s
   landscape, for instance. Your call.

== CONSTRAINTS THAT WILL ACTUALLY BITE ==
1. *** THE APP ALREADY AUTO-DETECTS ~30 fps AND HAS DROPPED ITSELF INTO "performance"
   MODE, and three other agents are adding geometry, roof clutter and lighting to it
   right now. *** Your route must stay smooth on the FINISHED scene, not the current one.
   Prefer altitudes and speeds that stay away from the worst-case frame cost, and test
   again once other branches land.
2. THE WORLD IS CHANGING UNDER YOU. Trees, props, roofs, light and a 3x radius are all in
   flight. Do not hard-code around today's holes — design the route for the finished
   world and note which beats depend on which pass landing.
3. Do not edit js/app.js or index.html. That is the one shared pair everyone is avoiding,
   and the tour waypoints currently live in app.js — so build your route in a NEW
   js/flight.js that you own, and leave an exact registration snippet showing what to
   paste into app.js to hand over to it.

== GETTING WHAT YOU NEED — PRE-AUTHORISED ==
Never ask permission. Study real drone-flyover cinematography, look at how city flyovers
are cut for social, research MapLibre camera APIs and any recording approach that works
here. A Google Maps API key exists at C:\Users\simip\Projects\utx-diorama\.env if you want
Street View for framing reference; read it in-script, NEVER print or commit it.

== VERIFY BY LOOKING ==
Actually watch it, repeatedly, end to end. Screenshot or record the beats. Judge it as a
viewer, not as a developer: is it boring anywhere, does anything pop, is any label
unreadable, does it end well? A green build is not proof. If a beat does not land, cut it.

== YOUR SANDBOX ==
Git worktree, branch  film/flyover . Never commit to main.
You OWN: a new js/flight.js, js/signs.js, js/controls.js, js/diff-tour.js,
data/signs.json, any new route/label data you create, plus your docs.
DO NOT edit: js/app.js, index.html, js/facades.js, js/graphics.js, js/sky.js,
js/atmosphere.js, js/night.js, js/timeofday.js, js/shadows.js, js/props.js, js/ground.js,
js/roofs.js, scripts/config.sh, data/snapshots/**, data/trees.geojson, data/props.geojson,
data/roofs.geojson. Four other agents are running.

== DONE MEANS ==
The route documented beat by beat with timings; a recorded run (video file if you can,
otherwise a frame sequence); label counts before/after and the priority scheme; a note on
which beats depend on which other pass landing; the registration snippet for app.js; and a
commit on film/flyover explaining the cut.
```
