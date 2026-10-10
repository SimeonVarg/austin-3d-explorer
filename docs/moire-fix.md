# The moire fix

Moire here is shimmer and crawling on building walls: a window grid drawn about once per pixel, where each pixel takes ONE sample of wall or
glass and the choice flips as the camera moves. Multisampling averages those samples. This fix does the averaging in the shader, for the
devices that cannot afford multisampling (integrated chips at large sizes, phones). Code: `js/moire.js` (the authored buildings),
`js/city-lighting.js` (MapLibre's pattern walls, and the loader), hooks in `js/slopes.js` and `js/slopes-apartments.js`.
Meter: `scripts/verify/moire-bar.mjs`; exactness of "off": `scripts/verify/moire-off.mjs`; the maths: `scripts/verify/moire-mean.mjs`.

## What it does

1. **Recording.** `js/slopes-apartments.js`'s cell tiler (`tileFace`) holds the cells of a wall face, and if the face has more than one tone it
   asks `MoireFix.tables(T)`'s `faceOpen`, reports every cell (`faceCell`: rectangle, tone, glass or not, lit or not, the size of the window it
   belongs to, its recess) and `faceClose`s. A blank wall takes no face number. The face's number rides in the unused fourth float of the
   packed normal table (so a vertex is still 16 bytes, and the fix needs `?packverts=1`, the default).
2. **The record**, 12 float texels per face (`T.faces`): the mean tones of the opaque parts and of the glass (day, golden, night; lit and unlit
   glass apart), the glass share, the lit share, the window's size as the "feature" a pixel is compared with, the reveal-hide factors, the
   strip addresses. Colours are the tones' own 8-bit values / 255, the space the frame buffer averages in.
3. **Two strips per face** at 0.25 m: `rowA` = opaque day colour x (1 - glass share) and the glass share of that height; `rowB` the same for
   night with the lit share. What a horizontal line across the face averages to.
4. **Two edge strips** at 0.1 m (`T.fine`): running sums of "a pane stands at this height" and "a pane stands at this place along the wall".
   For windows in an aligned grid the glass share of any box is the product of two differences of these sums (two reads each).
5. **The shader** (`glsl()` in `js/moire.js`, after the cell's own shading):
   - *far mean*: as a window shrinks under `px[0]` pixels across the cell blends to its row's mean (then to its face's mean as it shrinks under
     `pxV[0]` pixels up). The class means (opaque, unlit glass, lit glass) are SHADED by the cell shader's own text (`SHADE_CORE`, `SHADE_REFLECT`
     in `js/slopes.js`: one text, so the two cannot drift apart), so far glass keeps its sky reflection and lit windows their glow.
   - *edges*: where a pixel is more than about one strip texel wide, a pixel on a window's edge is wall and glass mixed by the glass share of its
     own footprint. A recessed pane is looked up where the pixel's ray crosses the wall plane (`through`), and a far mean leaves out the glass that
     the window reveals hide at this view angle (`parallax`).
   - `cityShade` in `js/city-lighting.js` is split in two (`cityShade` measures the sun's visibility, `cityShadeLit` shades) only when the fix is
     on, so the class shades reuse the cell's own shadow read.
6. **MapLibre's pattern walls**: the far pattern filter that was already there (a box of taps over the pixel's own footprint) runs on every
   device and from the camera outward (0 to 60 m fade), not only past 150 m on a graphics card.

## Where it is loaded

`js/city-lighting.js` decides (`?moirefix=1|0`, else `MOIRE_DEFAULT_ON`) while the page is still parsing, and then `document.write`s
`js/moire.js`, which therefore runs before `js/slopes.js`. Where the fix is off the file is never fetched: `window.MoireFix` is undefined, no
face is recorded, no shader define exists, and `cityShade` is main's. If the page was not loading (the file injected later) the fix stays off.

## Switches and named values

`?moirefix=1|0`; `?moireedge=0` (no window edges); `?moirewalls=0` (no pattern-wall part); `?moiresmooth=1` (also on a multisampled context).
Every threshold is a field of `MoireFix.params` (`js/moire.js`, live): `px`, `pxV`, `rowRes`, `edgeRes`, `edgePx`, `nightEdge`, `through`,
`parallax`, `goldSlope`, `footprint`, `withSmoothEdges`, `rows`. `MoireFix.set('off' | 'on' | 'flat')` flips the picture inside one page: `off` is
main's picture drawn through this program, `flat` the floor (every cell its face's mean) the meter measures against.

## Traps (each cost a run)

- **A sampler without a precision is `lowp` in a vertex shader.** The normal table is read in the vertex shader; on ANGLE's desktop-GL backend
  (an NVIDIA L4) a `lowp` fetch came back with about eleven bits, so a face number of thousands lost its low bits and every wall read a
  neighbour's record. The first builds of this fix scored worse than main while looking plausible. `uniform highp sampler2D`.
- **A truth drawn at 4x the pixels is not the same picture** (roof tiles, brick joints and every fade that reads the pixel size draw more detail
  at 4x). The meter's truth is 16 pictures at the same resolution, the lens shifted a fraction of a pixel each (map padding).
- **The style being loaded is not the page being ready.** Wait for the veil and the buildings; hide the name labels.
- **Hold the cells before drawing them**: the face number must be known before the first cell is drawn, and it is known only after the loop.
- **The mean of a lit tone is not linear at dusk and night** (the vertex lighting brightens dark tones): `moire-mean.mjs` holds the maths exact
  by day and under 8 levels from dusk on.
- **The night wall side.** A wall pixel beside a pane is mixed with the face's MEAN glass, not that pane's lit or dark tone; `nightEdge` turns
  that part down by the night amount.

## The meter

`moire-bar.mjs`: one page load, arms flipped inside the page, truth = 16 sub-pixel lens shifts, noise 0.00 between loads. See
`scripts/verify/README.md`, "The moire bar". `moire-off.mjs` loads `?moirefix=0` and the fix compiled in but set off, draws six cameras in each
and counts the pixels that differ (it also loads `?moirefix=0` twice as a control).
