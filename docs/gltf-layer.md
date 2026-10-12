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

## The app's light (2026-10-12): a row with a `look` file

A table row may name a second file, `look`: the same model exported WITH its Blender materials (`scripts/blender_export_look.py`), and beside it
`<name>-sky.png`, a small map of how much sky each part of each face sees, baked in Blender by casting rays. A row with a `look` file is not drawn
by the flat-colour code above. It is drawn by `js/gltf-look.js` under `js/city-sky.js`, **the app's light**: one place that makes the sky and the
sun for the hour and holds the shader code that lights a surface with them.

What that light is, in plain words:

- **Light from the whole sky.** A wall in shade is lit by the sky's own colours from every direction it can see, and by the ground's bounce from
  below. The exact sum is made once per hour as 17 colours (by how far a surface tilts up); there is no texture.
- **The sun**, through the app's own two shadow maps.
- **Materials, not painted colours.** A wall has a colour. Glass is a dark pane plus a mirror of the same sky, in the mirror colour its Blender
  material has. No light gains per building: nothing in `js/gltf-look.js` or `js/city-sky.js` knows which building it draws.
- **Recesses** get less sky light, by the baked map.
- **Night** is the city's own: rooms by `CityNight.room(building, floor, column)`, the row's lamps, the sign lit.
- **The screen curve** is plain sRGB (Blender's "Standard" view transform). The app lays a tone table over the whole canvas (`js/graphics.js`),
  tuned for painted colours; this light cancels that table for its own pixels (`CitySky.tune.undoGrade`), so what reaches the screen is the picture
  the standalone test page `proto/blender-look.html` shows.

Switches (all off unless the page asks):

| In the address | What it does |
|---|---|
| `?gltf=1` | the layer, as before; rows with a `look` file are drawn under the app's light |
| `?gltfaa=0` | no smoothing of the building's own (see below): hard edges, and its thin lines break up |
| `?gltf=1&smooth=1` | the app's own "Smooth edges" for the whole canvas instead; the building's own smoothing then stands down |
| `?gltflook=0` | every row the old way (flat colours with light gains, wall maps) |
| `?skygrade=1` | leave the app's canvas tone table on the new light's pixels (to see what it does to them) |
| `?skyambient=0.8` | scale all sky light |

**Smooth edges of its own.** A Blender model has lines far thinner than a pixel from across the street (joint lines 4 cm wide, mullions 7 cm
wide). They need several samples a pixel, or they break up and every edge is stair-stepped. Giving the WHOLE canvas four samples a pixel is the
app's "Smooth edges" setting, and on an integrated chip at a laptop's full density it is far too dear with the city drawn (measured: 89 ms a frame
becomes 228). So `js/gltf-look.js` smooths the building by itself, after the city is drawn: (1) the building alone is drawn into a small target of
its own with four samples a pixel, covering only the part of the screen it stands on; (2) its depth is written into the canvas, so the city in
front still hides it and the fog and labels see it; (3) the smoothed picture is laid onto the canvas wherever the building is the front-most
thing; (4) its see-through glass is drawn over that. In the city's own scene the building is a mesh that draws nothing: it is there to cast its
shadow. Values: `GLTF.look.own` in `js/gltf-layer.js`. One limit: the outermost pixel of the building's outline against the city is smoothed on
its inner side only.

What a `look` file must be (the loader refuses anything else): glTF 2.0 binary, positions, normals and a UV set for the sky-light map as float32 (the second set, when the file has two), no node transforms,
no images; per material a base colour; for glass the `extras` the export writes (`look_kind`, `look_glossy`, and for see-through glass
`look_transparent` and `look_transmit`); a colour per vertex where the Blender material paints its base colour per face. The export script turns
text objects into meshes, puts every object's place and turn into its points, and leaves out cameras, lights and any object named `...ground`.

One rule for the people (or models) who build in Blender: **an albedo only means something under a known light.** The tower's file arrives looking
like its Blender render because this light is that scene's light. A building lit differently in Blender (a stronger sun, a flatter sky) arrives with
the same materials but not the same picture. Build under the same light rig, and it will.

## One light for every Blender build (2026-10-12, later the same day)

The Venue's Blender file went through the same export, not edited for it, and came out with the right shape and the wrong wall colours: its
builder had lit its scene with a hard sun and a dim sky, the tower's builder with a bright sky and a weak sun. Three things followed.

**1. The sun is now measured, not taken from one scene.** For each wall material that a site photograph shows both in the sun and in shade,
there is one sun strength at which the sunlit pixels and the shaded pixels give the same surface colour under the app's sky. Pooled over 14
materials of three buildings photographed in full sun it is 23.65 / 21.64 / 18.95 (red, green, blue; single photographs gave 8 to 34). The first
value, 1.57 / 1.53 / 0.91, made a sunlit wall 1.6 times a shaded one; the photographs show 3 to 10 times (most between 4 and 7). It is `TUNE.sunStrength` in
`js/city-sky.js`; `?skysun=` scales it (0.07 is about the first light). The sky was not changed.

**2. Blender gets the same light from one file.** `scripts/blender_light_rig.py` puts the app's sky, sun, ground and view transform into a
Blender scene (`apply()`), turns the sun to where it stood in a photograph (`sun_from_photo()`), and says whether a scene is still under it
(`check()`). Its numbers are written from `js/city-sky.js` by `node scripts/city-sky-rig.mjs`, and `scripts/verify/gltf-layer.mjs` fails when
the two differ. It also holds the rule for colours as code: `base_colour()` divides a photograph's pixel by the light that fell there,
`gate()` compares a render with the photograph at the same places (8 %, as light, worst channel).

**3. A base colour is the surface's own colour: the photograph's pixel divided by the light.** Under this light the numbers are small (a white
wall is near 0.17, because a sunlit wall gets about 4.5 units of light), and they are right. The builds that existed were carried through
without touching their shapes: for each, the light on every pixel of the photograph's camera was rendered in Blender three ways (the builder's
own lamps, the standard sky alone, a sun of strength 1 alone), and each material's colour became the median, over its clean pixels, of the
photograph divided by the standard light (its sunlit pixels and its shaded pixels each counted by their number). A material the photograph does not show clean (and all glass) kept what its builder's render showed:
its colour times its own light over the standard light. The tower was converted that second way, so its picture holds under the stronger sun.

Rows: The Venue (its look file), 26 West and Yugo Austin Nueces (look files only: `file` is absent, so with `?gltflook=0` they are not drawn
and their recipes stay). A row may name more recipes it takes over (`alsoReplaces`: 26 West is four buildings on the map). Their frame is the
surveyed outline's own (x east, y north, origin at the mean of the outline's points).

What this does not solve, measured:

- **A phone photograph is not light.** It holds its whites back and lifts or crushes its shadows, differently per picture. With one colour per
  material, sunlit places come out within a few per cent and shaded places miss by 10 to 40 %, in both directions. No single light passes
  8 % in sun and shade on all three buildings.
- **The app's sun shadow shades lit walls by a fifth** when it is read on the face (the app's own note in `js/city-lighting.js`). The look
  shader reads it 0.6 m in front (`GLTF.look.shadowLiftM`, `?gltflift=`).
- **Glass made as a plain Principled material** (the two newest builds) is drawn as a dark pane with no mirror yet. The tower's glass, a
  node graph with its own mirror colour, keeps its mirror.
- **26 West is 76,396 triangles and a 6.8 MB file (1.1 MB gzipped).** It is in the branch so that the row draws; it needs a smaller file
  (indexed, quantised, or a far version) before it is merged or sent to a phone.
- **The tower's site photograph shows almost no difference between its sunlit and its shaded white walls** (thin cloud, most likely). Its colours
  carry that picture's brighter exposure, so under one light with the others its shaded white is about twice as bright as theirs. One exposure for the whole view (the app's auto exposure, or a film curve) is the answer,
  and that is the decision about the canvas grade that the recipes need too.
- **Blender's default gloss.** A build whose wall materials keep Specular IOR Level 0.5 renders up to a tenth brighter in Blender than here on a
  white wall, and twice as bright on a dark one. The app draws walls matt; `light_rig.check()` lists such materials.
