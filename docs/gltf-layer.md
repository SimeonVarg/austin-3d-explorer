# Blender-built buildings in the city (`js/gltf-layer.js`)

**Status: a trial, OFF by default.** `?gltf=1` turns it on. With the switch off the page loads one small file,
`js/gltf-layer.js` (5.8 KB gzipped: the table, the taste values and two functions), and nothing else changes. With it on the
page also fetches `js/gltf-layer-draw.js` (11.3 KB gzipped: the loader, the wall maps, the night rooms and the mesh code) and the `.glb` (41 KB gzipped).

## What it is

A recipe building (`data/apartments/*.json`) is drawn by rules. A model made by hand in Blender has no recipe. This layer
draws a plain `.glb` as ONE more mesh in the city's own three.js scene (`js/slopes.js`), built with the city's own builder
(`slopes.build()`) and material (`slopes.material()`), so it takes the same sun, shadows, hour, haze and render distance as
every other mesh. Two buildings today: the Yugo Austin Waterloo tower (`data/gltf/waterloo.glb`) and The Venue on Guadalupe (`data/gltf/venue.glb`).

## The table (top of `js/gltf-layer.js`)

One row per building: the `.glb`, where its origin stands (`lng`, `lat`, `groundM`), the compass `headingDeg` of its +Y
axis, `topM` (its height, read by the flight collision), `replaces` (the id of the recipe whose drawing it takes over) and `night` (the
profile and lamps the city's night rules read).
While the layer is on, `js/slopes-apartments.js` leaves that recipe out of the build (one hook, `GLTF_LAYER.hides`) and
keeps its entry in `built` (so ids, collision heights, places and arches see it). The generic block under the recipe stays
hidden through the recipe's own `replacedBuildingIds`. Replace, never overlap.

A row may carry its own values for what differs between buildings (`materials`, `litFix`, `photoHour`, `storeyM`, `storeyOffsetM`, `glassStrength`,
`crownGlass`, `maxRoomWidthM`, `windowGapM`, `sunThreshold`); anything it does not carry is the layer's own. The tower's row carries none.

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

Wall maps are made for every vertical wall of the model, whatever its direction (the Venue's two street walls meet at an angle that is not a
right angle); roofs and slanted faces stay geometry. Each wall has its own frame (outward normal, tangent along the wall); a wall within 0.5
degrees of an axis is snapped to it, so the tower is drawn exactly as before.

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

## The Venue on Guadalupe (second row)

The app has no hand-made recipe for it: it is an entry of the neighbourhood collection (`data/neighborhood_apartments.json`, which the apartments
builder draws like any recipe), so the row's `replaces` is that entry's id and the existing hook leaves it out; its generic prism is hidden through
the collection's own `replacedBuildingIds`. Nothing else in the app was changed to hide it.

Frame: origin = the corner of the two street walls at the ground, X along the long face, Y into the building. The model's two street walls were
measured on a site photograph; the corner between them solved to 124.8 degrees on one assumption (about plus or minus 7 degrees). The surveyed
outline is the judge: it has the corner at 119.6 degrees. The row places the model by a least-squares fit of its two street walls to the outline
(rigid, no scale, nothing in the model bent): the sign face lies 0.12 m (mean, 0.25 m worst) and the other street face 0.40 m (0.81 m worst) from the
outline's walls; the corner is 0.9 m from the outline's corner; the faces are 1.0 m and 1.3 m shorter than the outline's. The rear bar, whose depth
and west end are inferred from one roof edge, does not agree with the outline: its front wall is 3.9 to 4.5 m from the outline's inner wall and the bar
is 17 m too long; 317 m2 of the model (9 % of the front bar, 17 % of the rear bar, 70 % of the link) lies outside the outline, and the model covers 69 % of
the outline's area. That needs a correction round by whoever builds the model; it is reported, not hidden.

Windows: each window group in the file is a measured pane colour (16 groups, one material each). The panes of one window (2 to 4, a few centimetres apart)
share a night room (`windowGapM`), so a window is lit or dark as a whole.

Colour: the row's gains were found at the hour whose sun lights the sign face and leaves the other street face in shade (`photoHour` 0.28), through the
site photograph's camera, hundreds of metres from the building, so they include the app's distance haze there: from 170 m the sun-lit blue reads about 40,59,79 where the photograph has 49,71,95 (from 340 m, 46,65,85).

