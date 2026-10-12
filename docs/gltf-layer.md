# Blender-built buildings in the city (`js/gltf-layer.js`)

**Status: a trial, OFF by default.** `?gltf=1` turns it on. With the switch off the page loads one small file,
`js/gltf-layer.js` (3.4 KB gzipped: the table, the taste values and two functions), and nothing else changes. With it on the
page also fetches `js/gltf-layer-draw.js` (4.3 KB gzipped: the loader and the mesh code) and the `.glb`.

## What it is

A recipe building (`data/apartments/*.json`) is drawn by rules. A model made by hand in Blender has no recipe. This layer
draws a plain `.glb` as ONE more mesh in the city's own three.js scene (`js/slopes.js`), built with the city's own builder
(`slopes.build()`) and material (`slopes.material()`), so it takes the same sun, shadows, hour, haze and render distance as
every other mesh. One building today: the Yugo Austin Waterloo tower (`data/gltf/waterloo.glb`).

## The table (top of `js/gltf-layer.js`)

One row per building: the `.glb`, where its origin stands (`lng`, `lat`, `groundM`), the compass `headingDeg` of its +Y
axis, `topM` (its height, read by the flight collision), and `replaces`, the id of the recipe whose drawing it takes over.
While the layer is on, `js/slopes-apartments.js` leaves that recipe out of the build (one hook, `GLTF_LAYER.hides`) and
keeps its entry in `built` (so ids, collision heights, places and arches see it). The generic block under the recipe stays
hidden through the recipe's own `replacedBuildingIds`. Replace, never overlap.

Every taste value is a named constant in the same file: the colour and surface class of each Blender material, the night
ramp, the fraction of lit panes at night (`?gltflit=0.4` tries another), two-sided faces, the tier and zoom.

## What a `.glb` must be

glTF 2.0 binary, positions float32, indices uint8/16/32, one flat colour per material (`baseColorFactor`), no node
transforms, no images, no sparse accessors. The loader (about 70 lines) refuses anything else with an error instead of
drawing it wrong. Model frame in Blender (Z up): X along the street face, Y into the building, Z = 0 at the ground.
`scripts/blender_export_delivery.py` makes such a file from a Blender scene (metres, welded, triangles, no normals or UVs).
`node scripts/verify/gltf-layer.mjs` checks the layer's contract with no browser (the table's ids, the file's contents,
the refusals, the winding).

## What it does not carry from a recipe building

Night downlights, windows lit by the city's night rules (here: a random pane pattern), the packed vertex format, the
facade filter that keeps thin window detail steady at distance, and per-block reveals. The cost of each is in the pull
request that added this file.

## Placement

The model's origin is the middle of the slab's lettering on its street face. The table's `lng`/`lat` come from the recipe's own
slab (`data/apartments/yugo-austin-waterloo.json`, block `blade`: face plane u = 0.3, lettering centre v = 13.5) and the heading
from its frame (95 degrees). `groundM` is 1.74 m: the model's own ground level is inferred and its height scale is only good
to about 5 % (4.7 m on this tower), so the offset is a choice, written down in the table. Set it to 0 for the model's own
inferred ground. `scripts/verify/gltf-layer.mjs` checks `topM` against the file's height plus `groundM`.
