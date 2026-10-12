# Blender-built buildings in the city (`js/gltf-layer.js`)

**Status: a trial, OFF by default.** `?gltf=1` turns it on. With the switch off the page loads one small file,
`js/gltf-layer.js` (5.8 KB gzipped: the table, the taste values and two functions), and nothing else changes. With it on the
page also fetches `js/gltf-layer-draw.js` (11.3 KB gzipped: the loader, the wall maps, the night rooms and the mesh code) and the `.glb` (41 KB gzipped).

## What it is

A recipe building (`data/apartments/*.json`) is drawn by rules. A model made by hand in Blender has no recipe. This layer
draws a plain `.glb` as ONE more mesh in the city's own three.js scene (`js/slopes.js`), built with the city's own builder
(`slopes.build()`) and material (`slopes.material()`), so it takes the same sun, shadows, hour, haze and render distance as
every other mesh. One building today: the Yugo Austin Waterloo tower (`data/gltf/waterloo.glb`).

## The table (top of `js/gltf-layer.js`)

One row per building: the `.glb`, where its origin stands (`lng`, `lat`, `groundM`), the compass `headingDeg` of its +Y
axis, `topM` (its height, read by the flight collision), `replaces` (the id of the recipe whose drawing it takes over) and `night` (the
profile and lamps the city's night rules read).
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

## Far away: steady windows (CLAUDE.md rule 15)

Panes thinner than a pixel crawl when they are drawn as geometry. The city's own cure for its recipe buildings is a texture of each wall's
area-averaged colours, drawn over the wall once a pixel covers more than a quarter metre (`js/facade-filter.js`, `facadeMaterial` in
`js/slopes.js`). This layer builds the same overlay from the model's own quads: every wall face with enough quads on it is painted back to
front into a fine grid and averaged down to a small map (about 0.25 m a texel, 22 faces, 8 MB of textures for the tower), and the
overlay is drawn by the city's own facade-filter material. Near, the hard panes of the geometry show; far, their true area average; in
between a fade (`GLTF.facade.fadeStart` / `fadeEnd`) that never pops. Nothing is blurred: the map is only sampled where a texel is smaller
than a pixel. `?gltffilter=0` turns it off for an A/B. `scripts/verify/gltf-layer.mjs` plans and paints the faces of the real model.

## Night

Windows are lit room by room by the city's own night rules (`CityNight.room(building, floor, column)`, the profile in the table row: the
recipe's occupancy 0.23), the floor from the pane's height and the column from its place in its row on its wall. Wall and slab night tones
are the recipe tower's own authored tones for the same roles (blade, panels, charcoal, frames); the sign is lit like the recipe's sign; the
recipe's four downlights are carried over, moved onto this model's terrace, sign and entry.

## Day colour under the app's light

The colours in the `.glb` are what a lit photograph shows, and the app lights them again. Each material class has a gain per colour
channel, for faces the sun reaches at the photograph's hour and for faces it does not (`GLTF.litFix`), found by rendering the app from the
photograph's camera and dividing the photograph's colour by the app's, as `js/look-photo.js` does for trees and roads. A colour above white
(the lit slab is brighter than the city's light can make white) is kept as a per-vertex multiplier of the albedo (`aBoost`), applied by this
layer's own copy of the city's shader; nothing else in the city changes.

## What it does not carry from a recipe building

The packed vertex format (88 bytes a vertex instead of 16), the recipe's per-block reveals (window recesses), and the golden-hour and night
colour corrections of the lit-colour gains (they are calibrated for the photograph's hour only). The facade overlay is off at night, as the
recipes' are.

## Placement

The model's origin is the middle of the slab's lettering on its street face, and its podium is centred on the surveyed footprint (the map
outline, which the 2021 laser scan of the site agrees with) along the street face. The recipe's own slab would put it 6.35 m south of that
(`lng -97.7442748, lat 30.2881180`); the outline is surveyed and the recipe's slab is authored from exterior references, so the table uses the
outline. The heading comes from the recipe's frame (95 degrees). `groundM` is 1.74 m: the model's own ground level is inferred and its height
scale is only good to about 5 % (4.7 m on this tower), so the offset is a choice, written down in the table. Set it to 0 for the model's own
inferred ground. `scripts/verify/gltf-layer.mjs` checks `topM` against the file's height plus `groundM`.
