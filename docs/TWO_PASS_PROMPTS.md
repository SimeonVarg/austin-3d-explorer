# Two parallel passes — Austin 3D Explorer
Copy ONE block per agent. They are scoped so they can run at the same time.

**Ownership split (the only rule that matters for parallelism):**
- **Pass A owns** `data/trees.geojson`, `data/props.geojson`, `data/landscape.geojson`,
  and their fetch/bake scripts. It works INSIDE the current bbox.
- **Pass B owns** `scripts/config.sh`, the buildings bake, and a NEW outer-ring data file.
  It must not touch trees/props/landscape.
- Neither edits `js/app.js` or `index.html` — each leaves a registration snippet.

---

## PASS A — REAL TREES, FURNITURE AND STREET LIFE

```
You are enriching the Austin 3D Explorer (C:\Users\simip\Projects\austin-3d-explorer) —
a MapLibre GL 2.5D flyover of UT Austin and West Campus that is going to be featured on
AWS Kiro's socials. Your job is to make the GROUND PLANE feel alive: real trees, real
street furniture, real campus objects, placed where they actually are.

READ THE APP FIRST, BEFORE YOU PLAN ANYTHING. It is MapLibre GL (not three.js): the
scene is GeoJSON sources + fill-extrusion layers + procedural canvas patterns, wired in
js/app.js, and baked by scripts/*.py. Understand how js/props.js, js/ground.js and
js/night.js consume data before you decide what to produce. A previous effort wasted
days building beautiful three.js geometry that this renderer cannot express — do not
repeat that. Whatever you make must be something MapLibre can draw.

== WHERE IT STANDS (measured, not guessed) ==
  data/trees.geojson    5,144 features = 2,572 TREES (each stored as a trunk + a canopy
                        feature, kind='trunk'/'canopy', props: base, d, h, kind)
                        by longitude: west of -97.741 -> 1,106 trees
                                      -97.741..-97.734 -> 533
                                      east of -97.734  -> 933
  data/props.geojson    501 features. k='furn' 453, k='art' 31, k='cons' 17.
                        props: k, name, h, at, artist, u
                        by zone: west 133, mid 207, east 161
  data/landscape.geojson  53 features (52 'pitch', 1 'fountain')
  Existing fetchers: scripts/fetch_city_trees.py already pulls the City of Austin Tree
  Inventory (Socrata dataset wrik-xasw) and notes "OSM has 498 trees in the bbox and NONE
  on the UT malls". scripts/fetch_osm_detail.py pulls OSM detail.
  Current bbox (scripts/config.sh): 30.276,-97.752 to 30.296,-97.726

== THE PROBLEM, IN THE OWNER'S WORDS ==
"middle campus and west campus has some but east campus has close to none - would like
more overall". Note what the numbers say: east is not empty, it is UNDER-DENSE relative
to its area — east campus holds the big academic and athletic precincts and is far
larger than West Campus, so 933 trees spread over it reads as bare. And 501 props for
an entire university is the real hole: a campus is benches, bike racks, bollards, lamp
posts, planters, bus shelters, trash bins, tables, statues, banners, signs, scooters.

== WHAT TO ACTUALLY DO — you decide the how ==
1. GET REAL DATA WHEREVER IT EXISTS. Do not synthesise what you can source. Legitimate
   and pre-authorised, no need to ask: City of Austin open data (data.austintexas.gov —
   tree inventory, street furniture, bike infrastructure, public art), OSM/Overpass
   (natural=tree, amenity=bench/bicycle_parking/waste_basket/shelter/drinking_fountain,
   highway=street_lamp, tourism=artwork, leisure=pitch), UT Austin's own campus GIS /
   campus map / landscape master plan, NAIP or other aerial imagery for canopy detection,
   and Google Street View Static for verifying what is actually on a given block.
   A Google Maps API key already exists at C:\Users\simip\Projects\utx-diorama\.env —
   read it in-script, NEVER print or commit it. Probe /streetview/metadata first for the
   panorama DATE.
2. FILL THE GAPS HONESTLY. Where no dataset covers a real area (UT malls, interior
   quads, east campus), it is fine to place objects procedurally — but drive the
   placement from something real: building footprints, path centrelines, the ground and
   landscape polygons already in data/, or canopy detected from imagery. Random scatter
   reads as noise. Trees line paths and edge quads; benches face paths; bike racks
   cluster at building entrances; lamps follow streets at regular spacing.
3. RAISE DENSITY EVERYWHERE, and fix east campus specifically. Say in your report what
   the before/after counts are per zone.
4. VARIETY MATTERS MORE THAN COUNT. 2,572 identical trees look worse than 1,500 with
   real species variation. Central Texas campus canopy is dominated by live oak, with
   pecan, cedar elm, crepe myrtle, magnolia, bald cypress near water. Vary height,
   canopy radius and tone. Same for furniture — a bench, a bollard and a bike rack must
   not be the same box.
5. KEEP IT CHEAP TO DRAW. The app ALREADY auto-detects ~30 fps and drops itself into
   "performance" mode (see js/graphics.js). Anything you add must respect that: prefer
   instancing-friendly simple geometry, use the existing trunk/canopy two-feature idiom
   rather than inventing a heavier one, and give js/graphics.js a way to thin your layers
   at low quality. If you increase counts a lot, add a density knob.
6. MAKE IT WORK AT NIGHT. js/night.js already places 1,046 streetlights. Whatever you add
   should read correctly through the day→night palette, and lamps/lit objects should
   participate rather than going flat black.

== THE STANDARD ==
This is going on a public feed. The bar is "a stranger scrolling past believes it is a
real place". Concretely that means: things sit where they really are, they vary, they
cast and receive shadow like everything else, and nothing floats, z-fights, or sits in
the middle of a road. Verify by LOOKING — run the app, fly the camera to several places
(the South Mall, Speedway, the DKR/east precinct, Guadalupe, a West Campus street), take
screenshots and judge them critically. A green build is not proof. If it looks wrong,
say so rather than shipping it.

== YOUR SANDBOX ==
Work in a git worktree on branch  data/ground-life . Never commit to main.
You OWN and may edit: data/trees.geojson, data/props.geojson, data/landscape.geojson,
any new data file you create, scripts/fetch_*.py and scripts/bake_*.py that relate to
them, js/props.js, js/ground.js, and docs/ notes you write.
DO NOT edit js/app.js, index.html, scripts/config.sh, the buildings bake, or
data/snapshots/** — another agent is extending the building radius in parallel and owns
those. If you need a hook in app.js, write the one-line registration snippet into your
docs and let Simeon paste it.

== DONE MEANS ==
- Before/after counts per zone (west / mid / east) for trees and for each prop kind.
- A written note on data PROVENANCE: what came from a real dataset, what is procedural
  and what rule drove it. Be explicit — nobody should have to guess later which is which.
- Screenshots from at least 5 locations, day and night.
- A performance note: frame time before and after, and how the density knob behaves.
- Commit to data/ground-life explaining what you added and where it came from.
```

---

## PASS B — TRIPLE THE RADIUS (cheap outer city)

```
You are extending the Austin 3D Explorer (C:\Users\simip\Projects\austin-3d-explorer) —
a MapLibre GL 2.5D flyover of UT Austin and West Campus that is going to be featured on
AWS Kiro's socials. Right now the modelled world ends abruptly at a small bbox and the
flyover has nothing beyond it. Your job is to TRIPLE THE RADIUS so the city reads as a
city, while keeping the new area DELIBERATELY CHEAPER than the existing core.

READ THE APP FIRST, BEFORE YOU PLAN ANYTHING. It is MapLibre GL (not three.js): GeoJSON
sources + fill-extrusion layers + procedural canvas facade patterns (js/facades.js),
wired in js/app.js, baked by scripts/*.py from Overture + OSM. Understand the existing
pipeline end to end — scripts/config.sh, the fetch/enrich/bake chain, data/snapshots/**,
data/manifest.json — before changing anything. A previous effort wasted days producing
detail this renderer cannot express; do not repeat that.

== WHERE IT STANDS (measured, not guessed) ==
  scripts/config.sh bbox: 30.276,-97.752 → 30.296,-97.726  (~2.2 km N-S × 2.5 km E-W)
  Current scene: 3,057 buildings, 14 colour buckets, 44 facade patterns, plus 604
  Capitol-area buildings merged separately by js/capitol.js.
  Facade families in js/facades.js: lo / md / tw / dk / st, chosen by height and class.
  hero data: data/hero_designs.json (per-building palettes), scripts/hero_overrides.json
  (height + display name only — NOT geometry).
  *** THE APP ALREADY AUTO-DETECTS ~30 fps AND DROPS ITSELF INTO "performance" MODE
  (js/graphics.js). You are adding to a scene that is ALREADY at its budget. ***

== THE JOB ==
Triple the radius. Centre is roughly 30.286, -97.739, so a 3× extent lands near
30.256,-97.778 → 30.316,-97.700 — that pulls in downtown Austin, the Capitol approach,
the Lady Bird Lake north shore and the neighbourhoods. Confirm the exact box yourself
against what actually improves the flyover; you may prefer an asymmetric box that reaches
further south to downtown than north.

THE NEW RING MUST BE CHEAPER THAN THE CORE. This is the owner's explicit instruction:
"make these new buildings less in quality because they don't have the same level of
detail as the rest - they should render easy". Interpret that as a two-tier world:
  - CORE (existing bbox): unchanged. Do not degrade it. Full facade patterns, parts,
    heroes, labels, shadows.
  - OUTER RING (new): simplified. Fewer vertices per footprint, coarser or no facade
    pattern, a smaller palette, no parts, no per-building heroes, fewer/no labels, and
    aggressive simplification of anything under a size threshold.
Downtown towers are the exception worth spending on — the skyline silhouette is the whole
point of extending south, so the tall ones should still read as themselves.

== HOW YOU DO IT IS YOURS, BUT THESE ARE THE REAL CONSTRAINTS ==
1. FRAME BUDGET IS THE HARD ONE. The scene is already at 30 fps. Measure before you
   start, measure after every significant addition, and report both. If the outer ring
   costs more than a few ms, cut it back. Techniques that fit this renderer: geometry
   simplification at bake time, a minimum-footprint-area cull, merging tiny buildings,
   distance/zoom-based layer filters, tile-level filtering, and reusing existing colour
   buckets instead of adding new ones. Use whatever works — you know this engine better
   than the prompt does after you have read it.
2. DO NOT BREAK THE SNAPSHOT/DIFF SYSTEM. data/manifest.json tracks dated snapshots and
   diffs, and js/date-switcher.js and js/diff-tour.js depend on them. Whatever you add
   must fit that model or explicitly and carefully extend it.
3. DO NOT BREAK THE CAPITOL. js/capitol.js merges its own baked area, and its design rule
   is "add nothing new where something exists". Your bigger bbox will now OVERLAP the
   Capitol area it fills in. Resolve that deliberately — deduplicate rather than
   double-drawing, and say what you did.
4. HEIGHTS MATTER MOST AT DISTANCE. At flyover altitude a wrong height is the only thing
   anyone can see. Overture heights are decent but downtown has known bad values; spot-
   check the tall ones against a reliable source and override where needed.
5. KEEP THE HORIZON HONEST. The point of tripling is that the world does not end. Make
   sure the edge of the new ring is not itself a visible cliff — fade, thin out, or reach
   far enough that the camera never sees the boundary on the intended flight paths.

== GETTING DATA — PRE-AUTHORISED, JUST DO IT ==
Never ask permission to go get better data. Overture Maps (the existing pipeline already
pulls a versioned release — see config.sh), OSM/Overpass, City of Austin open data, and
Google Street View Static for spot-checking. A Google Maps API key exists at
C:\Users\simip\Projects\utx-diorama\.env — read it in-script, NEVER print or commit it.

== THE STANDARD ==
This is going on a public feed. The bar is "a stranger scrolling past believes it is
Austin". At flyover altitude that means: correct skyline silhouette, correct relative
heights, no popping, no visible data boundary, and no frame-rate collapse. Verify by
LOOKING — run the app, fly the actual intended paths (campus → downtown, along the lake,
over West Campus), screenshot, and judge critically. A green build is not proof. If the
outer ring looks like a carpet of grey boxes, say so and fix it rather than shipping it.

== YOUR SANDBOX ==
Work in a git worktree on branch  data/extend-radius . Never commit to main.
You OWN and may edit: scripts/config.sh, the fetch/enrich/bake scripts for BUILDINGS,
data/snapshots/** , data/manifest.json, js/facades.js, js/graphics.js, and any new data
file or module you create.
DO NOT edit data/trees.geojson, data/props.geojson, data/landscape.geojson, js/props.js
or js/ground.js — another agent is enriching ground life in parallel and owns those.
DO NOT edit js/app.js or index.html; write a one-line registration snippet into your docs
for Simeon to paste.

== DONE MEANS ==
- The bbox you chose and WHY, with a map or bounds listed.
- Before/after building counts, split core vs outer ring.
- Before/after frame time, and what you did to protect it.
- A written statement of the quality tiering: exactly what the outer ring does NOT get.
- Screenshots along the intended flight paths, including one that deliberately looks
  toward the new boundary to prove there is no visible cliff.
- Commit to data/extend-radius explaining the tiering and the performance result.
```
