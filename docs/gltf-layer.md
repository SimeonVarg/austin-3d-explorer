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

## What a tone curve cannot do, and one weather for the whole view (2026-10-12, evening)

Sunlit walls land on the site photographs; shaded ones miss by 15 to 83 %. The plain remedy would be one exposure and one response curve for
the whole view, so it was tested before anything was built. For each of the 14 wall materials that a site photograph shows both in the sun and
in shade, the colour was taken from the sunlit pixels through a candidate curve and the shaded pixels were predicted through the same curve
(exposure cancels out of that test). Within 8 %, of 14: plain sRGB 0, the app's own grade 1, the best of 4,788 curves and sun strengths 2, each
photograph with its own best curve and sun 3, a tint of shade light per building 1. The misses go both ways inside one photograph (a white wall
too dark, the grey beside it too light) and are coloured differently at each site (warm at one, yellow at another): they are the light each
shaded wall gets from its own surroundings, which this light does not have (it has an open sky and a flat ground). **No curve was added.**

What was added, all behind `?gltf=1`:

- **Colours from the sunlit pixels alone** for the three builds (the rule builders are given). Shade is then a check, not an input.
- **`CitySky.tune.exposure`** (`?skyexp=`): the view's exposure for surfaces under the app's light. 1 is a photograph taken in full sun.
- **`?skyview=1`, one weather for the whole view.** A row may name a `lookClearDay` file, drawn instead of its `look` file. The tower has
  one. Measured on its site photograph: the sun that fits is a tenth as strong as on the other three, its shaded white is one and a half to
  three times brighter than their shaded whites, and the city around it is as bright as in theirs. So the camera's exposure was the
  same and the weather was not: a veiled sun under a cloud-bright sky. Its Blender colours were chosen for that. `lookClearDay` is the same
  file with every colour divided by 4.4 (`scripts/gltf_scale_colours.py`), which makes its white the same white as the other buildings'.
  Drawn in its photograph's own light (that veiled sun and an exposure of 4.4, handed to the page by the test), it is 4.82 from its Blender
  render (4.81 before the sun was measured). Drawn on the clear day it is a tower on a clear day: its sunlit side white, its shaded side as
  dark as any other shaded white wall. Without `?skyview=1` the tower keeps the colours that hold its photograph's picture under the clear
  sun (9.98 from that render, and brighter in shade than its neighbours).

Nothing here reaches the recipes, the ground, the trees or the sky: they are drawn as before, switch on or off.

## A site photograph with no sun in it (2026-10-12, evening)

Most street-level photographs have no sunlit wall (overcast, dawn, dusk). The clear-day rig cannot be turned to a sun that is not there: one
builder invented a sun, another divided by a grey of its own, and both renders missed their photographs (one five times too dark and blue).
`scripts/blender_light_rig.py` now has the light for that case, on the Blender side only (the app still lights every building with its
clear day; that is the point):

- `apply(weather='overcast', exposure=k)`: the CIE overcast sky, grey, no sun, and the view exposed k times. A level roof gets 1 unit of
  light, an open wall 0.45 (a sunlit wall on the clear day gets 4.5).
- `exposure_from(pixel, normal, surface='white_paint')`: k, read from ONE surface whose own colour is known: white paint is 0.17 and bare
  concrete 0.07 in this light's numbers, both measured on the builds photographed in full sun. That anchor is what puts a building made
  from a no-sun photograph on the same scale as one made from a sunlit photograph.
- `base_colour(samples, weather='overcast', exposure=k)`: pixel divided by that grey light times k.
- `gate(pairs, by_material=True)`: without a sun every place is lit by what stands round it (a wall is darker low in a street than high
  above it), so the places of one material are pooled and their median must be within 8 %; the spread is reported beside it.

Tried, read-only, on the two builds that had such photographs: `check()` is empty under the new light on both; the dawn build's white wall
renders within 4 % of its photograph where the clear rig had it five times too dark, and the overcast build's brick and limestone show the
fault of having been divided by the clear light's colours (right in red and green, 13 and 28 % too blue), which the new division removes.

## Ten more builds in the layer, and what a model replaces (2026-10-12, night)

Ten buildings made under the standard light stand in the table with the first four: fourteen rows with a `look` file. Each is one export
command from its builder's file (`scripts/blender_export_look.py`), stands with its own origin on the origin of its surveyed outline (x east,
y north, heading 0), and takes the place of what stood there. Four things were needed that the first four did not show:

- **A lean file for a heavy model.** `blender_export_look.py OUT.glb SKY.png [skip=objA,objB] [drop=matA,matB] [dissolve=2]`:
  `skip=` leaves named objects out (a ground slab the builder drew under the building), `drop=` leaves whole materials out, and `dissolve=`
  merges flat neighbouring faces of one material (the angle in degrees). The merged faces are kept whole, so the sky-light bake still gives
  each its own patch. A model over about 40,000 triangles is exported this way for the layer and the full file is kept outside the repo.
  Thin metal window frames are the first thing to leave out: on one tower they were 40,112 of 109,098 triangles.
- **Everything the old drawing owned goes with it.** A row's `replaces` now also takes out the building's kept roof
  (`js/slopes-apartments.js`: a campus building that kept its tile roof when its walls were handed over) and its door assembly
  (`js/entrances.js`: a model brings its own doors). Both only when the switch is on.
- **Nothing under the ground plane is drawn.** The city's ground is a flat picture with no depth. A builder who models a sloping street
  makes walls that reach below the origin's height; the shader discards them (`js/gltf-look.js`), or they are painted over the ground.
  The building then stands on the flat ground with its downhill storey partly buried, which is what every recipe building does today.
- **The smoothing targets are shared.** One target per sample count, sized for the largest building in view, instead of one per building:
  fourteen buildings held about 410 MB of targets before and about 125 MB after, at the same picture.

A material whose name starts with `glass` is treated as glass and one that starts with `sign` as a sign when the row gives no material
table, so a model that follows the builders' naming rule needs no entry of its own.

## The ground's colour: neutral, and measured (2026-10-12, late)

A wall in shade is lit by the sky and by what lies below the level line. That second part was `[0.1, 0.125, 0.07]`, one Blender scene's lawn,
and it put a green cast on every wall in shade: on the five pale walls that three site photographs show both in sun and in shade, the light
gave the shaded pixels 0.83 / 0.95 / 0.85 (red, green, blue) of the photographs', so green stood 13 % above red and blue. It is now
`[0.16, 0.16, 0.16]` (`TUNE.ground` in `js/city-sky.js`, and the same number in the rig through `node scripts/city-sky-rig.mjs`): with it the
same walls come out at 1.01 / 1.03 / 1.04. Two things to know about that number:

- **It is a bounce, not a look.** A wall's own colour is on the rig's scale (white paint is 0.17), but how much light the ground throws
  back depends on its true reflectance, and 0.16 is what pavement and the sunlit walls across a street really return. So the ground plane
  of a Blender render is now nearly white on camera. That is the scale, not a fault; a darker plane for camera rays only would be a change
  to the rig's code.
- **What a mirror sees below the level line did not change** (`TUNE.groundMirror`, the old value): glass seen from above looks as before.

What moves for a building already made: a colour taken from SUNLIT pixels moves by -3 / -2 / -5 % on a wall that faces the sun and by up to
-8 / -4 / -11 % on a wall the sun grazes; a colour taken from SHADED pixels under the clear light moves by -20 / -10 / -22 %. Colours taken
under the no-sun light do not move (it has its own grey ground).

What it does not settle: two other site photographs show shade two to three times brighter and bluer than this light gives on white panels,
and about right on brick, in the same frame. No ground colour can do that, and the first three photographs say the opposite. A phone
lifts shade; how much depends on the picture.

**A trap found on the way.** The rig paints every object with "ground" in its name as the ground. One builder named a building's lowest
storey `ground_storey`; its walls were painted as ground and came into the app green. A building part must not carry that word.

## Far away, part two: thin parts and small buildings (2026-10-12, late; rule 15)

Counted on each building's own pixels in a slow pan, none of the fourteen was steady from far. Two causes, by class, found by switching
parts off in one page:

1. **Parts thinner than a pixel** (rails, posts, mullions, bolts): half to three quarters of the flickering pixels. A rail 4 cm wide is a
   fifth of a pixel at 300 m: it is there in one frame and gone in the next.
2. **Edges of windows a few pixels wide, at four samples a pixel**: nearly all of the rest. A dark pane's edge on a pale wall steps by a
   quarter of that contrast as the camera moves.

Not a cause: the sky-light map (with thin parts treated, switching it off does not lower the count). Seen and not treated: a shadow edge
jumps when the app's shadow map shifts with the camera.

The treatment is in the layer, works from the model's own shape, and needs no second file, no switch distance and no hand work
(`GLTF.look.far`; `?gltffar=0` = off):

- **Thin parts** (`js/gltf-look.js`, "FAR: THIN PARTS"). At load, the pieces of each material that hang together are measured along their
  own three directions. A bar (second size under `thinM` = 0.3 m, and `long` = 3 times as long) or a piece under `thinM` in every direction
  is THIN and goes to a mesh of its own. The shader never draws it narrower than `minPx` = 1 pixel, and gives it the share of the pixel it
  truly covers. Nearer than the distance at which it is a pixel wide, nothing changes, so nothing pops.
- **More samples for a building that is small on the screen.** One that covers `midPixels` = 600,000 pixels or fewer is smoothed with
  `midSamples` = 8 samples a pixel instead of 4; one that covers `smallPixels` = 160,000 or fewer with `smallSamples` = 16 (the graphics
  chip's limit caps both) and is also drawn at `smallScale` = 2 times the pixels, each pixel of the canvas taking the mean of its own
  block. No building's picture is then larger than a middle-distance building's, so none costs more than one of those.

**Nothing is blurred.** The block mean takes nothing from a neighbouring pixel, and a thin part is never drawn wider than one pixel. Measured: the building's edges (the strongest tenth of steps
between neighbouring pixels) are as strong after as in the same frame drawn at twice the pixels and averaged, and never weaker; before,
they were harder than that, because a stair-stepped edge is harder than a true one. The building's mean brightness stays on the truth's.

Measured in a 1280 x 680 window at pixel ratio 1.5, a slow pan of 14 frames, flickering pixels on the building's own pixels: one
five-storey block 1,049 of 26,372 at 300 m before and 5 after; 474 of 10,851 at 450 m before and 4 after; 48 of 4,285 at 700 m before
and 1 after.

What it does not do, and what is not known: a window frame made as one ring is not a bar by its shape and is not treated as thin (the
extra samples carry it); the building's outline against what stands behind it is laid at one sample a pixel; one more draw call per
building; and what it costs in frame time has not been measured.

## Far away, part three: what it cost, what was cut, and every finished build (2026-10-13)

**What part two cost.** Timed on a quiet machine (an integrated laptop chip, fourteen buildings in view from 640 m, a 2880 x 1800 canvas),
part two's far treatment added 19.5 ms to a frame of 86 ms. The cost was then split inside one page load, settings flipped while the page
ran. A whole-city frame time swings by 10 ms from one reading to the next, so the layer's smoothing work was also done three times a frame
(`GLTF_LAYER.lookOwn.repeat = 3`): its own cost is then (T3 - T1) / 2, well clear of the noise.

| setting for a small building | the smoothing's own cost a frame |
|---|---|
| far treatment off (4 samples a pixel, the canvas's pixels) | 10.2 ms |
| thin parts only | 10.3 ms |
| 4 samples, twice the pixels each way | 20.3 ms |
| 8 samples, twice the pixels each way (part two) | 30.9 ms |

So the 8-sample target was half of the cost and the doubled pixels the other half. The thin parts' extra draw call costs nothing that can
be measured. Neither does the size of the shared smoothing target (the copy out of it is already cut to the building's box), nor the lay
pass's sixteen reads. The sun's shadow lookup (nine reads a pixel) is a third to a half of the doubled pixels' share.

**What was cut** (`GLTF.look.far`; nothing is blurred, every canvas pixel still takes the mean of its own block and nothing else):

- **4 samples a pixel in every tier but the smallest.** Only a box of `tinyPixels` (70,000) canvas pixels or fewer takes 8: it costs
  little because it is small, and the smallest buildings are the ones that need it (a count of flickering pixels on the six worst
  buildings from 450 m: 8 samples alone leave 846, 4 samples at twice the pixels leave 133, both leave 49). With the tier at 40,000
  the fourteen left 120, 59 of them on one tower just over that size; at 70,000 it is in.
- **The picture's fineness goes by the screen, not by the canvas.** A small building is drawn at `density` (3) picture pixels to one CSS
  pixel along a side, and at most twice the canvas's. A canvas with two pixels to a CSS pixel is drawn at 1.5 times, one with 1.5 at
  twice, a phone's with three at once. Part two doubled every canvas, so the densest screens paid most for the least gain.
- **One and a half times is exact.** The box is made an even number of pixels, so each canvas pixel's block starts on a texel edge and
  spans two texels a side: one whole and one half. One read with linear filtering, placed a third of the way between the two texels'
  middles, is the area-weighted mean of that block. The same single read serves once and twice the pixels.
- The middle tier (a box up to 600,000 pixels) took 8 samples and now takes 4 at up to 1.5 times: the same cost a pixel, steadier.
- A smoothing target left over from a closer view (the size of the canvas: 187 MB at a laptop's density) is let go after 60 frames at
  twice the size needed. It was four times and 120 frames.

**The result**, same harness, same fourteen buildings, the far treatment flipped rep by rep inside one page load, the minimum of four
readings a load (two loads at pixel ratio 2, one at 1):

| pixel ratio | camera | far treatment costs, part two | now |
|---|---|---|---|
| 2 | 640 m | +19.5 ms | **+6.9 ms** |
| 2 | 1,150 m | +7.7 ms | +4.2 ms |
| 1 | 640 m | +5.4 ms | +6.0 ms |
| 1 | 1,150 m | +2.4 ms | +1.0 ms |

At pixel ratio 1 nothing changed: there every box is in the smallest tier and keeps part two's 8 samples at twice the pixels.
A second instrument, the smoothing work done three times a frame (two rounds), puts the cost at pixel ratio 2 from 640 m at 4.7 ms
(16.7 against 12.0 ms): the two agree on "a third to a quarter of what it was", not on the last millisecond.
`tinyPixels` trades cost for steadiness, but less than it seems: at 40,000 (six of the fourteen in the 8-sample tier, not eleven) one
session of the harness read +1.2 ms, with a far-off arm 4 ms slower than in the later sessions, and the second instrument read 5.3 ms,
the same as 70,000 within its noise; the flicker test below left 120 at 40,000 and the count below at 70,000. A shared 8-sample target
forced to five times its size cost 2.2 ms more, so a target of its own for each size class would save about half a millisecond.
Flicker in a slow pan from 450 m, all fourteen on their own pixels (1280 x 680 at pixel ratio 1.5, against the same frames at twice
the pixels drawn with part two's settings): **91 flickering pixels of 213,407**; part two left 55, no far treatment 2,464.
A single building's count moves by tens from one page load to the next with the same settings (one tower read 1 in the morning and 36 in
the afternoon under part two's settings, another 27 and 1), so the two totals say "under a hundred of two hundred thousand", not which
is steadier. Read side by side in one page load, part two's settings and these give the same count on three of four buildings; on the
fourth, a wide block that is now in the 4-sample tier, 1 against 24. These are counts in a test window. Whether it is steady is decided
by eye, in motion (CLAUDE.md rule 15).

**Forty-four more builds: fifty-eight in all.** `js/gltf-rows.js` holds one generated line a build: its name, the origin of its surveyed
map outline, its height, the map building it replaces. `js/gltf-layer.js` appends them to its table (`?gltfrows=0` leaves them out). Each
file is one export command, as before; a street, a site plane or a helper object that a builder left in the scene is skipped by name
(`skip=`), never a part of the building. One of the new files is lean (flat neighbouring faces merged), as two of the first fourteen are. `scripts/verify/gltf-layer.mjs` checks
every row against its file. The 44 files add 64 MB to `data/gltf/` (88 MB in all): a file carries float normals that could be worked
out from its triangles, and float positions that could be 16-bit; that is the next cut before this goes anywhere near the live site.

**A model can replace a building that has no recipe.** Thirteen campus buildings are drawn by the app's generic layers: a block, a
roof, storey lines, a street front. With the switch on, `GLTF_LAYER.replacedIds()` names every map building a model stands on and
`js/slopes-apartments.js` adds them to the ids it hides (block, storey lines, street front, campus roof); `GLTF_LAYER.masks()` gives
the outlines of those thirteen (`rings` in their rows), which join the footprints that hide the roof deck, the tiled-roof bands and the
building parts by outline.

**Rows by distance** (`GLTF.look.load`, `js/gltf-look.js` "BY DISTANCE"). Every 250 ms the distance from the camera's eye to each row is
taken. A row within `inM` (2,500 m) is fetched and built, nearest first, three at a time; a row beyond `outM` (3,000 m) has its meshes,
materials and sky-light map disposed and its file forgotten. `?gltfload=0` loads all at the start; `?gltfin=` and `?gltfout=` set the
distances. What the layer holds on the graphics card with all fifty-eight in (a camera over West Campus or over campus has them all
within 2,500 m): 185 MB of vertex and index data, 33 MB of sky-light maps, and 49 and 39 MB of smoothing targets at a
2880 x 1800 canvas. Rows within 1,000 m of the same cameras are 23 rows and 83 MB over West Campus, 24 rows and 81 MB over campus.

**What is not right yet.**

1. **A row that is out has no stand-in.** Its old drawing is hidden for the whole session, so beyond `outM` the building is missing from
   the picture. That is why the distances are long, and why near campus the rule holds everything. A far stand-in (the model's largest
   faces in one small file for all rows) would let `inM` come down to about 1,000 m.
2. **Fifty-eight detailed models are slow to draw.** With all of them in view from 950 m at a 2880 x 1800 canvas a frame took 136.4 ms over West Campus and 137.3 ms over campus, against 87.9 and 89.8 ms with the layer off (one reading each). Every model is drawn in full
   detail at every distance, five times a frame (its picture, its depth, the lay pass, and twice for the sun's shadow maps). The far
   treatment is no longer the cost; the triangles are. The same far stand-in is the cure.
3. Nine of the new builds were made before the standard light and keep their own colour scale: they come out pale to white under the
   app's light. The same nine and all of the first fourteen were made before the glass and wall-pattern functions.
4. Four of the new builds stand on a sloping site and reach 0.6 to 4.5 m below the city's flat ground on one side; one stands 1 m low.
5. `wall_patterns` (brick courses, boards, panel joints, measured by the builders) are not drawn yet.

(Items 1 and 2, and eight of the nine builds of item 3, are answered by the next section.)

## A far copy for every building, packed files, one white (2026-10-13, later)

**1. Every row has a far copy.** `scripts/gltf_far.py` makes it from the row's own look file, by rule, right after the export
(`data/gltf/<name>-look-far.json`, 5 to 28 kB of plain numbers, 152 to 1,066 triangles; all 59 together 39,000 triangles against 1,070,000).
How: every face is sampled every 25 cm; the highest sample in each cell of a 50 cm grid is the building's height there. The grid is turned
to the building's own main wall direction and shifted so that its lines lie on the main walls. What sticks up and is narrower than 2.5 m
(rails, parapet lines, masts, balcony slabs) is taken off; the cells are grouped into levels 2.5 m apart, and a level's connected cells are
a part (a tower, a set-back, a wing round a court); a part under 30 m2 joins a neighbour. A roof part has the area-weighted mean colour of
what is seen from above on it. A wall has the area-weighted mean of what is seen from in front of it (the front-most face in each half
metre), in rows of half a metre; neighbouring rows of nearly one colour are merged into bands, so a storey's window strip is one darker,
glassier band and the spandrel under it a paler one. Windows are not drawn one by one. A band carries its share of glass and the mean of
its glass's mirror colour, so it mirrors as much sky as its windows do together, and the mean of the look file's sky-light map over its
faces. A building with slanted or curved walls is drawn as small steps (five builds take a 1 m grid to stay near 900 triangles), each
step lit by the wall's true direction.

**2. Which one is drawn goes by pixel size, not by a fixed distance** (`GLTF.look.copy` in `js/gltf-layer.js`, the code in
`js/gltf-look.js` "THE FAR COPY"). `pxM` = the metres of the building that one CSS pixel covers (its distance from the camera's eye times
the angle of a CSS pixel). The full building is drawn while `pxM` is under 0.84; the far copy alone from 0.99; between the two both are
drawn, the full building laid over its far copy in a growing share, so the change is a dissolve over a stretch of the approach and never a
pop. On a 1440 x 900 window those are 680 and 800 m. A full file is fetched under 1.04 (845 m) and let go above 1.10 (895 m); a file
that arrives late dissolves in over half a second. All far copies are fetched at the start and the ones shown are ONE mesh (one draw call,
and one in each shadow map), so **a building whose full file is not loaded is never missing**. A band of a far copy that is under 4 pixels
high gives way to its wall's mean colour and is the mean under 2 (rule 15: a band a pixel high would flicker). `?gltfcopy=0`: no far
copies, every full file by distance as before. **What this costs the picture:** at the change a 1.5 m window is still 1.8 CSS pixels
wide (3.6 pixels of a dense laptop screen), so from 800 m a Blender building is a banded block with no windows, plainer than the full
model and plainer than the recipe drawing it replaces. The two numbers are the dial: 1.2 and 1.4 would keep full buildings to 970 m, hold
about 23 full files in the views below (83 MB of their own data against 55 MB now) and draw about twice as many in full (not timed).

**3. What it costs now** (an integrated chip, a 2880 x 1800 canvas, all 58 rows on, the camera 950 m from the middle of West Campus and of
campus; the minimum of interleaved readings, one page): a frame takes 91.1 and 91.0 ms with the far copies against 136.1 and 137.0 ms
with every full file drawn, and 87.2 and 89.3 ms with the layer off (so +3.9 and +1.7 ms). The layer holds 102 and 98 MB on the graphics card (16 and 15 full
files, the shared smoothing targets, 8.5 MB of far copies) against 267 and 257 MB. In the slow-pan flicker test at 450 m the fourteen
buildings of the earlier test read 75 flickering pixels of 213,398 (91 of 213,407 before): at that distance each is drawn in full, eleven
read exactly their earlier count, one swings by tens between page loads, and one tower depends on the ORDER the buildings are built in
(1 flickering pixel when rows are loaded nearest first, 22 to 24 when every row is loaded at the start, with the far copies on or off:
the order in which the buildings' smoothed pictures are laid onto the canvas shows at their edges; open). The far copies' own flicker (their
unsmoothed edges and bands, from 800 m) was not measured, and nobody has judged the dissolve or the far view in motion by eye.

**4. Look files are kept packed.** `data/gltf/<name>-look.glb.gz` is the export, gzip-packed (a fifth to a sixth of its bytes, nothing
lost); the page unpacks it with the browser's own `DecompressionStream`, so there is no decoder file. `data/gltf/` went from 92 MB to
20 MB. Where a browser has no `DecompressionStream` the plain `.glb` is asked for, and where that is missing the far copy stands.
`?gltfpacked=0` asks for the plain file first. (Whole numbers for positions and normals were tried: half the raw bytes, but only a sixth
less after packing, and positions move by up to 1.5 mm, so it was not used.)

**5. One white.** A build made before the standard light has its colours on its builder's own scale and came out pale to white.
`scripts/blender_export_look.py ... white=0.17` divides every base colour and every glass mirror colour by one number, so that the
build's white paint is the standard light's white: the white is the material named `*white*` with the largest surface that is not glass,
not a sign and not a roof. Eight builds were exported again that way (factors 1.26 to 4.94). GrandMarc Austin has no material named
white and is unchanged.
