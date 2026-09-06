# Apartments as real geometry — `js/slopes-apartments.js` and `data/apartments/`

The app is apartments → distance → classes, and until 2026-09-05 every
apartment building in it was a flat prism, or at best a stack of one-colour
bands with a repeating window grid painted on (`js/westcampus.js`). This is
the generator that draws a building the way it is: podium, towers, light
wells, the pool on the deck, every panel and window and balcony a quad of its
own — from a data file a builder authors by hand from sources, one file per
building. The first one is The Standard at Austin, 715 W 23rd St.

Switch: `?apartments=0` at load, or `window.APARTMENTS.on = false` from the
console. Off, the page is what `main` draws: the flat prism and the
westcampus bands come back, because the generator hides them by *filter* and
puts the filters back. `?slopes=0` (the whole three.js layer) takes this with
it.

What it hides while it draws, and puts back when it does not:

- the replaced prism, by id, in `buildings-3d` and `buildings-roof`;
- the westcampus bands, by name, in `wc-wall`, `wc-wall-cap`, `wc-solid`,
  `wc-detail`;
- the campus-storeys courses (`js/facades.js`), by `host` — Kinsolving's
  four cream plates were the snapshot's 25.1 m divided into six, crossing
  the courts and standing above the authored roof;
- the roofscape pass (`roofscape-deck`, `-major`, `-minor`), by GEOMETRY:
  those features carry no id or name, only `k/b/h`, and they were baked from
  the SNAPSHOT height, so over a building authored lower than Overture's
  guess the deck plate floated (Regents West's 41 × 44 m slab 6.5 m over the
  roof, 2706 Rio Grande's ten metres up, the Villas' 12.6) and hid the roof.
  The clause is `['>', ['distance', <every footprint inset 1 m>], 0]`, which
  MapLibre answers 0 for a feature that overlaps the inset outline and
  positive for a neighbour's deck that only touches the boundary. Check it
  at a NADIR: `queryRenderedFeatures` on a fill-extrusion answers for the
  whole volume along the view ray, and from an oblique a neighbour's lower
  deck lands on the ray to your courtyard;
- the tiled-roof rig `js/slopes-roofs.js` draws over San Jacinto Hall from
  `data/roofs.geojson` (a hip on Overture's 28.1 m, six metres over the roof
  this file draws): its entries keyed by a replaced id are lifted out of
  that generator's data and it is rebuilt; off, they go back. That
  generator has no skip list; the right fix is in `scripts/bake_roofs.py`
  (skip every id in `data/apartments/index.json`) and is asked for in
  `HANDOFF.md`.

`window.slopesApartments.hidden` lists the plan, any layer whose clause is
missing (a layer that booted after the generator gets it within a minute),
and the rigs lifted out.

Gate: `scripts/verify/slopes-layer.mjs`, section 2b (`apartments:` lines).
Two archives can stand in for `main` there and answer different questions:
`--against-tip URL` is a `git archive` of the commit the branch was cut from
(main with the slopes layer), and ours at `?apartments=0` must be its frame
at the pose with that page's ridge courses switched off as this branch's
are; `--against URL` stays the pre-slopes main the gate's bake-identity
lines are written for, and ours at `?apartments=0&slopes=0` must be its
frame — the data, the index and the script tags changed nothing the slabs
draw here.

![ours from the south-west](shots/apartments-standard-sw-ours.jpg)
![Google Earth from the south-west](shots/apartments-standard-sw-earth.jpg)
![ours from the north-west](shots/apartments-standard-nw-ours.jpg)
![Google Earth from the north-west](shots/apartments-standard-nw-earth.jpg)

*Above: The Standard at the brief's oblique (Google Earth
`@30.28699,-97.74578,190a,220d,35y,45h,55t`, ours at zoom 18.66 / pitch 55 /
bearing 45) and from the north-west (heading 135), ours in daylight. Google
Earth's imagery is 12/2023.*

![what main draws at the same pose](shots/apartments-standard-sw-main.jpg)
![ours at the same pose, the gate's own frame](shots/apartments-standard-sw-gate.jpg)

*Above: the gate's two frames at the brief's pose, golden hour, the same
page load: `?apartments=0` — what `main` draws, `js/westcampus.js`'s bands
with two slab towers standing on what the nadir shows to be the two light
wells — and the generator on.*

## What is in the frame, and where it came from

The building has one outline in OSM (way 380916747: `building=apartments`,
no height, no levels, no `building:part`) and one polygon in our snapshot at
20.5 m — Overture's guess, wrong by 2.8×. Nothing about its shape is in any
data source. It was authored from:

- Humphreys & Partners' own photographs in
  `research/union24th-area/imagery/web/the-standard-at-austin/` — the corner
  at 23rd and Pearl, the dusk aerial from the north, the pool deck, the sky
  lounge.
- The architect's page (17 storeys, 287 units, the 7th-floor amenity deck
  with the pool, the double-volume gym) and SkyscraperPage (191 ft to top of
  structure).
- `data/roads.geojson`, which says which corner is which: 23rd St runs along
  the building's *north* edge and Pearl ends at its north-west corner. The
  research pass had the towers' compass directions garbled for want of this.
- Six Google Earth captures (nadir, two obliques at 220 m, three at 300 m),
  taken with `scripts/verify/chrome.mjs` on hardware GL and
  `page.screenshot()`. The nadir was *rectified* into the building's own
  frame (below) at 0.164 m/px — the scale bar is 183 px for 30 m and the
  footprint polygon overlaid lands on the roof edges — so every plan
  dimension was read in metres off a gridded plan, not eyeballed.
- `js/westcampus.js`'s TIER4 block, whose deck features (pool, spa, turf,
  cabana, jumbotron, rail) were read off the same frame from the z20 nadir
  and land on the imagery's own features when overlaid. Its two "tower
  slabs" do not: overlaid on the nadir they are the two light wells. The
  towers are the bars round them.

Every number in `data/apartments/the-standard.json` carries a `_src` naming
one of those, or says it is derived or unknown. The per-floor heights are
derived (17 storeys to 58.2 m, the podium top at the LiDAR's 21.5 m, the
rest divided); tower B's and the bars' 15 storeys are read off the
photogrammetry mesh at ±1 storey; the garage louvre pitch is a plausible
number and says so.

## The frame every building is authored in

A building's numbers are metres in its footprint's **oriented bounding box**
— the same `obbOf` `js/westcampus.js` uses, ported unchanged, so a `(u, v)`
read for that file means the same thing here. `+u` runs along the long axis,
`+v` across it; the generator logs `L`, `W` and the compass bearing of `+u`
at boot (`[slopes-apartments] The Standard: obb L=94.9 W=46.4, +u at bearing
274.7°`), which tells a builder which end is which. For The Standard `u=0`
is the east end, `+u` runs west along 23rd St, `v=0` is the north (street)
edge and `+v` runs south.

A block's plan is one of:

- `"footprint"` — the outline itself (the ring in the file), for a podium;
- `[[u, v], ...]` — a polygon in the frame, for a podium you have split
  (The Standard's is three pieces at three heights) or an L-shaped tower;
- `[u0, u1, v0, v1]` — a rectangle, for a tower, a corner bay, a wing.

### The metre, and the two constants that make it

A ring's longitude/latitude becomes metres with **two different scales**, and
the generator, `js/westcampus.js` and the westcampus bake all use the same
two: **110,540 m per degree of latitude** (`M_LAT`) and **111,320 · cos(lat)
m per degree of longitude** (`mLon`; 96,118 m at UT's 30.29°). A builder who
converts a ring with 111,320 on both axes, or with the longitude factor on
the latitude axis, lands a plan 0.7 % long on one axis and 16 % short on the
other, and the numbers read off it disagree with the frame the generator
builds by that ratio — the file's `L`, `W` and every `(u, v)` are in the
generator's metres. So:

```python
M_LAT = 110540
m_lon = 111320 * math.cos(math.radians(lat0))      # lat0: the ring's mean latitude
x = (lng - lng0) * m_lon                            # metres east
y = (lat - lat0) * M_LAT                            # metres north
```

Those are true ground metres to 0.03 %, so a scale bar on a rectified nadir
agrees with them. `slopes.toLocal` (Web Mercator, scaled by cos lat) is what
places a vertex on the pixel MapLibre puts it on, and `frameFor` builds the
frame through it at three points, so the `(u, v)` metres above land on the
map's own metres to 1e-6 over a building. Do not mix the two: convert the
ring with the constants above, author in that frame, and let the generator
carry it to the map.

To read a plan off a nadir: capture it at tilt 0 with `chrome.mjs`
(`page.screenshot`, wait 35 s), find the metres-per-pixel from the scale
bar, project the snapshot polygon on to it with the view centre at the
canvas middle, check the red outline sits on the roof edges, then resample
the image into the `(u, v)` frame at 10 px/m with a 10 m grid. The scripts
that did it for The Standard are in the session scratchpad
(`apts/build/standard/`), thirty lines of PIL each; the rectified plan is
what the block extents were read from.

## The schema, field by field

```jsonc
{
  "id": "<snapshot feature id>",       // the prism this replaces (buildings-3d / buildings-roof)
  "name": "<name>",                    // the westcampus bands this replaces (wc-* layers), and the label
  "sources": { "S1": "...", ... },     // named sources; every `_src` below cites them
  "footprint": { "ring": [[lng, lat], ...] },   // the snapshot polygon, verbatim
  "frame": "obb",                      // or { "obb": {...} } to pin one by hand
  "levels": { "floors": [0, 6.0, 9.1, ...] },   // every floor line, metres; skins put windows on them
  "colours": { "<tone>": { "hex": "#day" } | ["#day", "#golden", "#night"] },
  "skins":   { "<skin>": { "kind": "pixel" | "bays" | "storefront" | "flat", ... } },
  "balcony": { "proj", "slabT", "railH", "railT" },   // the building's balcony module
  "blocks":  [ { "id", "plan", "z0", "z1", "bands", "faces", "overrides",
                 "roofTone", "parapet", "parapetSides", "roofItems", "roof", "inset" } ],
  "deck":    { "z", "items": [ { "plan", "z0", "h" | "z1", "tone" } ] }
}
```

**colours** — a day hex gets golden and night from `js/westcampus.js`'s
`ramp()` (the same relationship its own bands use, so a mesh panel and the
fill-extrusion band next door age the same way); a full trio is taken as
given. Keys starting `_` are notes.

**skins** — a rule for one face treatment. All of them derive their column
count from a module, never a hard-coded count.

- `pixel`: horizontal planks in a running bond. `course` (m tall), `plank`
  (m long), `bond` (fraction of a plank the alternate rows shift), `tones`
  and `weights` (the field's tones and their shares), `runMax` (a run of
  1..n cells shares a tone), `macro` (`[rows, planks]` per decision cell —
  The Standard's dark runs are two courses by two planks), `window`
  (`cols` as fractions of the face, `w`, `h`, `sill`).
- `bays`: a flat `field` cut into bays of `bay` metres; `strip` (`w`,
  `tone`, `at: "joints" | "centres"`, `every`) puts a vertical strip of
  another tone on the bay lines; `window` (`w`, `h`, `sill`) one per bay per
  floor; `louvre` (`pitch`, `w`, `tone`, `start`) covers the band in
  horizontal slats (a garage screen); `bands` explicit horizontal bands.
- `storefront`: full-height glazing between `mullion`-spaced mullions of
  `mullionW`, a `transom` line at that fraction of the height, a `fascia`
  band on top in `fasciaTone`, panes set `reveal` behind the fascia line.
- `flat`: one tone, with optional `window` bays.
- `mod4`: Union on 24th's outer wall — a square `cell` per bay per floor,
  every cell a window in a light frame (`frameTone`) with a light strip
  (`stripTone`) above and below it on the dark `field`, and the cells merged
  into two-cell dominoes by k = (c − r) mod `period`: `pairs[k]` = `"h"`
  pairs a cell with the one to its right, `"v"` with the one below, any
  other k stands alone. The rule, the fractions (`fractions: { fi, wi, ws,
  st }`, the dark margin, the frame beside the glass, the glass and each
  strip as shares of the cell) and the seams (an H-pair's is frame, a
  V-pair's the light strip) are the owner's own `utx-diorama/workbench/js/
  union.js`, ported. r = 0 is the top row; `colOffset` continues the column
  index round a corner so the diagonals wrap on to the end caps, and `wrap:
  [lo, hi]` lets a pair straddle the corner as two halves whose frames run
  to the edge.

Every skin takes `glass`, `frame` (the reveal strips' tone) and `reveal`
(metres a pane sits behind the wall plane; `APARTMENTS.reveal` otherwise).

A `window` spec (on `pixel`, `bays`, `flat`) also takes:

- `frame: { w, h?, tone }` — a picture frame round the opening, `w` wide at
  the jambs and `h` (default `w`) at the head and sill, in `tone`
  (Signature 1909's white precast surround; Jester West's 1.31 × 2.31 m
  precast round a 0.72 × 1.76 window is `{ w: 0.295, h: 0.275 }`). It is
  cut into the wall's own cells, so it is coplanar with nothing and exactly
  as wide as the number says.
- `offsets: [[off, w], ...]` — several openings per bay, each `off` metres
  from the bay centre and `w` wide: a mirrored pair about a party wall
  (Jester West's and San Jacinto's wings: `[[-1.5, 0.72], [1.5, 0.72]]`), a
  wide light with two narrow ones beside it (Skyloft). Without it, one
  window of `w` at the bay centre.

**blocks** — each one is walls plus a roof plus parapets:

- `bands`: `[{ z0, z1, skin, balconies?, signs? }]` up the wall, the default
  for every face.
- `faces`: per face, keyed `v0 | u0 | v1 | u1` for a rectangle (the side
  each faces) or `"0", "1", ...` (edge index) for a polygon, and `"*"` for
  the rest. `null` skips a face that stands against another block (never
  draw two same-facing coplanar faces — they z-fight; back-to-back ones are
  fine). `{ z0 }` starts a face higher (it shows only above a neighbour);
  `{ bands }` replaces the bands for that face.
- `overrides`: `[{ region: [u0, u1, v0, v1], bands }]` — the part of any
  axis-parallel wall inside the region wears these bands instead (The
  Standard's corner bay, the wall above the lower east wing).
- `balconies` on a band: `[{ s0, s1, lift }]` — a stack, one per floor line
  in the band, `s` measured along the face (a rectangle's `v0` face runs
  from its `u1` end to its `u0` end). The slab, projection and rail come
  from the building's `balcony`.
- `signs` on a band: `{ text, s0, z0, dot, gap, tone }` horizontal
  (`s0` = the low-`s` edge of the text block; it reads left to right for a
  viewer in front whichever way the wall winds) or `{ vertical: true, s,
  zTop, back: { w, tone, pad } }` stacked letters on a backing strip. A 5×7
  dot font, one quad per dot.
- `roofTone`, `parapet` (m), `parapetTone`, `parapetSides` (which edges get
  one — never an edge another block of the same height stands on),
  `roofItems`: `{ plan, h, tone }` boxes, or `{ plan, grid: [nu, nv], size:
  [w, d], h, tone }` for a cluster of them (condensers), or `{ plan, h,
  tone, roof }` — a box `h` tall (0 for none) with a pitched roof on it
  (2706 Rio Grande's two hipped masses on the wing's plate, 26 West's
  turret caps, the Villas' bay caps).
- `roof`: a pitched roof over the block, in place of the flat cap — nine
  buildings came in with theirs as stacks of five to twenty-three inset
  boxes. `{ kind: "hip" | "gable", pitch }` in degrees; `over` metres of
  eave overhang beyond the wall (0), `lipH` the fascia's height there
  (`APARTMENTS.roof.lipH` when `over` > 0), `tone` and `lipTone` (the
  roof's and the fascia's; `roofTone` and `coping` otherwise); `deck: tone`
  with `d` metres stops the slope `d` in from the eave and fills the middle
  with a flat deck of that tone (Regents West's mitred cap round a membrane
  roof); `inset` metres stands the eave inside the wall (a roof behind a
  parapet — The Block on Rio's wing), keeping the flat cap under it; `base`
  is the eave height (the block's `z1`); `sides: [face keys]` makes only
  those edges slope — the rest STAND: a gable end on a full hip, the deck's
  own vertical edge on a deck roof (a shingle band round three sides of a
  membrane roof); `gable: [face keys]` names a gable's standing ends (a
  rectangle's two short edges when omitted) and `gableTone` colours the
  wall drawn up to the ridge there. The eave profile is solved by the same
  straight-skeleton arithmetic `scripts/bake_roofs.py` uses (ported into
  the generator), packed into that bake's rig schema and drawn by
  `js/slopes-roofs.js`'s emitter, the way the Capitol's wings are: a
  rectangle gets a ridge, a square a point, an L two ridges over a valley,
  and every strip is shaded as the campus roofs are. The boot log counts
  the roofs; `slopesApartments.built[i].roofs` lists each with its ridge
  height for a raycast to check.
- `inset` on a band (or on a face, or on the block, for every band of it):
  metres the band's wall stands behind the face plane — a ground floor set
  back under an oversailing podium (Union on 24th, 2.4 m; The Castilian,
  2 m), a loggia (Union's L6 court glazing, 3.3 m). A number, or `{ d, tone,
  columns: { pitch | at: [s...], w, d, tone } }`. The wall is tiled by the
  band's skin on a frame `d` behind the plane, and the generator closes the
  recess: the soffit at the band's top, the floor at its foot when that is
  above the block's own foot, columns on the face line from floor to
  soffit (`pitch` apart on the bay centres, or on the bay lines with `on:
  "joints"`, or at the `at` list of s), and at each end either a return wall (where the neighbouring
  face or piece is not recessed at the same band) or nothing — two faces
  recessed by the same depth over the same band meet at the mitre of their
  offset lines, so an open corner on columns is open round the corner. The
  corner arithmetic is in the file's `recess` comment.

**deck** — boxes on a roof at `z`: `plan` rectangle, `z0` and `h` (or `z1`)
above the deck, `tone`. The Standard's pool, spa, turf, cabana, jumbotron
and guard rail.

## Authoring a building when OSM has one outline

1. Get the outline and the id from the snapshot; put the ring in the file
   verbatim. Run the page with the file listed in `index.json` and read the
   frame line off the console: which way `+u` runs.
2. Get the storey count and height from a source that states them
   (SkyscraperPage, the architect, a leasing page). Overture's height in the
   snapshot is a guess for any building OSM never tagged; say so in `_src`.
3. Capture the nadir and rectify it. Read every block's extents off the
   gridded plan — towers, wings, wells, the deck's features. Overlay any
   numbers you inherit (a westcampus TIER4 block) and keep only the ones that
   land on the imagery.
4. Capture two obliques and get the photographs. Decide each face's skin
   from what was photographed; for faces nobody photographed use the
   plainest rule the building has and say the face is unphotographed.
   Decide heights per block by counting rows against a known floor line,
   and write the uncertainty.
5. Take tones from measurements that already exist (the westcampus bake's
   crops are the model: a crop, its clusters, the blue-hour lift) before
   sampling new ones; a sampled tone cites the photograph and the crop.
6. Split the podium where its height changes and skip the faces blocks
   share. Put every roof edge's parapet on the list, and none between blocks
   of one height.
7. Look: ours at the matched camera beside the reference, at least twice.
   Fix the biggest thing you see each time before anything else.

## The taste block (`window.APARTMENTS`)

| key | default | what it is |
|---|---|---|
| `on` | `?apartments` ≠ `0` | the switch |
| `index` | `data/apartments/index.json` | the list of buildings and the ids/names they replace |
| `lod`, `minzoom` | `null`, `14` | the tier of buildings-3d, which has none |
| `byPreset` | performance 0.5 | geometry density per graphics preset (reserved) |
| `balconies`, `signs`, `deck`, `reveals` | `true` | draw those features at all |
| `reveal` | `0.12` | m a window sits behind its wall |
| `nightLit`, `nightLitTone` | `0.45`, `#d9b46a` | the share of windows lit after dark, and their tone |
| `signDot`, `signProud` | `0.18`, `0.06` | the dot font's stroke, and how proud of the wall the letters stand |
| `parapetT` | `0.25` | parapet thickness |
| `floorSlack` | `1.0` | a band that starts within this of the floor line below it keeps that storey's windows, clipped to the band; beyond it the storey is dropped — either way the boot log names the band |
| `hideRoofscape`, `roofscapeInset` | `true`, `1.0` | hide the roofscape pass over every authored footprint (inset this many metres so a neighbour's own deck, which shares the boundary, stays) |
| `hideStoreys` | `true` | hide the campus-storeys courses whose `host` is a replaced id |
| `roof.pitch`, `roof.lipH`, `roof.gableLean` | `25`, `0.25`, `0.30` | a roof's pitch when the file gives none; the fascia height where a roof oversails its wall; how far a gable end leans in over its rise so the emitter's strip on that edge stands behind the wall drawn there |
| `insetSoffit`, `insetReturns` | `true`, `true` | draw a recess's soffit and floor; draw its returns |

Everything that is a measurement is in the building's file, not here.

## Why quads and not textures

The brief allowed a canvas-texture path in the shared shader, as
`utx-diorama`'s `union.js` does for its brick and rib. Measured against the
cameras this app is judged from — the oblique at ~0.3 m/px and the walking
height at ~0.05 m/px — every feature the photographs show is at least half a
metre on its short side: a 2.2 × 0.56 m panel, a 0.9 m slit window, a 0.5 m
rust strip, a 0.18 m sign dot. All of it reads as geometry, and geometry
needs no change to `slopes.js`, no second material, no texture seam at a
building's edge. The one thing a texture would add — brick coursing at 7 cm
— is under a pixel at every camera here. Should a later building need one
(a mural), the place is a second `THREE.Mesh` in the same group, the way the
contract in `slopes.js`'s header already allows.

## What it costs

The Standard: 9 blocks, 55 faces, ~11,700 cells, ~1,600 windows, 26
balconies, 4 signs, ~45,000 triangles in one draw call, built in ~220 ms.
The whole slopes layer was ~74,000 triangles before it.

## Open

- Tower B's and the bars' heights are ±1 storey off the mesh; a drawing or
  a street photograph of the south face would settle them.
- The faces on the light wells, tower B's south and east faces and tower
  A's west face were not photographed and wear the plainest skin.
- The corner glazing stack on the charcoal bay and the deck's furniture
  (loungers, palms, hammocks) are not drawn.
- `applyWestcampusSettings()` (the westcampus perf A/B, nothing on the site)
  rewrites buildings-3d's filter from its own snapshot and would drop this
  generator's clause; the next `applySlopesApartments()` puts it back.
