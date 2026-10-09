# What sets the Safari frame floor on an Intel Mac (2026-10-04)

The owner's Intel Mac draws the city in Safari at about 5 frames a second
(195 ms a frame). Headless Chrome on the same Mac draws the same city in 35 to 54
ms. This note says where the 195 ms goes, what was ruled out, and which fixes
exist. **No lossless fix was found, so nothing is changed in `js/`.** The one
option that moves a lot is pixel-changing and is shown as a labelled before/after
below, not built.

## The short answer

One frame at the Performance tier, first visit, main at `6fac246`, Safari 17.6,
window 2560 x 1360 CSS px at 2x, map canvas 3840 x 2040:

- **The sky canvas upload is the biggest single piece: about 58 ms of the 195.**
  Every camera move redraws the sky on a 5120 x 960 2D canvas (`js/sky.js`,
  `updateSky`) and then copies it into a GL texture (the one `texImage2D` per
  frame in `drawSky`). In Safari that call behaves like a synchronous round trip
  to the GPU process. Skipping just that one call takes the frame from
  193 ms to 126 ms (5.2 to 7.9 fps).
- The rest is the city itself, one piece after another: the 82 building
  extrusion layers about 25 ms, the apartment mesh 22 to 35 ms, lines and fog
  about 9 ms each, labels 4 ms, and 21 to 25 ms that is there with every layer
  hidden (the page's own overlay stack and the compositor).
- **Safari does not overlap the JavaScript with the GPU.** With the sky copy
  skipped, a frame is 41 ms of script and then about 87 ms of waiting for the
  GPU, strictly in that order (127 ms). So the pieces add instead of hiding
  behind each other. Why it does not overlap is not known (see the end).
- It is **not** the machine, the canvas size or Safari's presenting of a canvas:
  a blank WebGL2 canvas of exactly this size, in the same tab of the same Safari,
  presents at 59 fps empty or with one full-screen fill, 50 fps with eight, and
  53 fps with 4.5 million triangles.

## How it was measured

Visible Safari tab the whole time (every step logs the page's visibility), one
tab, one test at a time, the app's own first-visit probe running to the
Performance tier before anything is timed, the camera turned a fixed amount every
animation frame, median frame interval over 6 s per step (the figures below are
medians of one step each unless a range is given; the baseline was repeated 17
times across the session and read 180 to 208 ms, with one outlier at 244). Every
step restores what it changed. `performance.now()` in Safari ticks at 1 ms, so single
calls are noisy; the sums are not.

| What was timed | How | Result |
|---|---|---|
| Frame interval | gap between animation frames | 194 ms |
| Script per frame | wrapper around every `requestAnimationFrame` callback | 98 ms (95 ms of it inside MapLibre's own render callback) |
| Time outside script | interval minus script | 99 ms |
| GPU wait after the render | a 1 x 1 `readPixels` at the end of each render | 92 ms |
| GL calls | wrapper on every WebGL2 method | 13,360 calls a frame, 75 ms inside them (wrapper cost included) |
| Where the GL time is | same wrapper, by method | `texImage2D` 56 ms a frame, everything else 19 ms |
| The call itself | `texImage2D` traced with its caller and source | `drawSky` in `js/sky.js`, source `HTMLCanvasElement#sky-canvas (5120x960)`, one call a frame, 57.8 ms |

`getParameter` is called about 1,350 times a frame and costs 6 ms a frame in
total (4 microseconds a call): WebKit answers it from its own cache, it is not
a round trip. `createBuffer` is 21 calls a frame, 5 ms.

## The sky, in detail

The canvas is 5120 x 960 (the sky band, at the display's 2x). About half of its
pixels carry colour, 41 to 51 percent of them change from one frame to the next
while the camera turns, and the box around the colour runs to the right edge and
from the top to row 704 of 960. So there is no small dirty rectangle to upload.

The copy, tried on its own in an isolated tiny context (static canvas), same
result byte for byte every time (0 differing bytes against the app's own way):

| Way of getting the canvas into a texture | ms |
|---|---|
| `texImage2D(canvas)` with premultiply on (what the app does) | 25 |
| `texStorage2D` once, then `texSubImage2D` each time | 25 |
| `texImage2D` with a sized format (`RGBA8`) | 25 |
| the same with colour-space conversion off | 25 |
| only the top 75 percent of the rows | 19 |
| premultiply off (not the same bytes) | 35 |
| `getImageData` then `texImage2D(ImageData)` | 8 + 25 |
| `createImageBitmap` then `texImage2D(bitmap)` | 61 |

So the copy is bandwidth-bound at about 0.8 GB/s, and no way of asking for it
is cheaper. In the real frame it costs more than 25 ms because the same call
also waits for the 2D canvas to finish drawing and for the GPU process to get to it.

Tried in the real frame (interleaved inside one load, Performance tier):

| Variant | Frame |
|---|---|
| as shipped | 193 to 197 ms |
| upload only the top 75 percent of the rows (what the clip allows) | 187 ms |
| upload only the top 50 percent | 180 ms |
| issue the upload first thing in the frame (MapLibre's `prerender`), before the city is queued | 196 ms (the call itself 68 ms) |
| skip the upload altogether (sky freezes) | 126 to 141 ms |

So the cost is mostly the synchronisation and the 2D drawing behind it, not the
bytes: trimming rows is lossless but is worth 4 to 8 percent, and moving the
call earlier is worth nothing. Neither is built.

## What the city costs (sky upload skipped, layers hidden one group after another)

| Hidden so far | Frame |
|---|---|
| nothing | 123 ms |
| + 82 `fill-extrusion` layers (the buildings) | 98 |
| + the apartment mesh (`slopes-mesh`) | 63 |
| + 33 symbol layers | 61 |
| + 76 line layers | 52 |
| + 23 fill layers | 49 |
| + circles, the one raster layer | 46, 48 |
| + the name-label layer | 44 |
| + the aerial fog | 35 |
| + the sky overlay | 34 |
| + the background (every layer now hidden) | 25 |

Hiding any one group on its own took off 3 ms or less, except the buildings
(27) and the apartment mesh (22); three groups (symbols, sky overlay, name
labels) read slower with the group hidden, which is the size of the noise. The
25 ms left with everything hidden (21 in another run) is the page's own stack:
with the whole interface hidden as well it is 18 ms.

## Ruled out in Safari on this Mac

Each is one step in the same load; the baseline beside it read 4.8 to 5.2 fps.

| Suspect | With it removed | Verdict |
|---|---|---|
| the SVG tone filter on `#map` | 4.8 fps | not it |
| all the interface hidden | 4.9 fps | not it |
| the effects canvas | 4.6 fps | not it |
| the six `mix-blend-mode` layers set to normal | 5.0 fps | not it |
| the DOM sky layers hidden (the GL sky stays) | 5.2 fps | not it |
| all 33 symbol layers hidden | 5.1 fps | not it |
| `preserveDrawingBuffer` off (context built without it) | 5.2 fps | not it |
| `getParameter` traffic | 6 ms a frame | not it |
| the name-label layer | hidden: 4 ms | not it |
| canvas pixel count, apartment triangles | | not it (the earlier PR #390 runs) |
| a blank canvas of this size | 59 fps | not the machine or the size |

## The one pixel-changing option, measured and shown (not built)

Experiment only, a one-line switch in `resize()` kept out of the commit: draw the
sky canvas at `min(2, devicePixelRatio, map.getPixelRatio())` instead of
`min(2, devicePixelRatio)`. At the owner's Performance tier that is 3840 x 720
instead of 5120 x 960, sampled 1:1 instead of down.

Safari, interleaved, the app's own first-visit probe, canvas 3840 x 2040,
Performance tier (A = as shipped, B = sky at the map ratio):

| Run | A | B |
|---|---|---|
| 1 | 193 ms (5.2 fps) | |
| 2 | | 152 ms (6.6 fps) |
| 3 | void: the probe stopped at Balanced, canvas 4096 x 2176, 231 ms | |
| 4 | | 151 ms (6.6 fps) |
| 5 | 192 ms (5.2 fps) | |
| 6 | | 150 ms (6.7 fps) |

Minimum of each: A 192 ms, B 150 ms. Two valid A readings, three B; the page was
visible the whole time in every run.

Strong GPU (headless Chrome, hardware GL, map pixel ratio set to 1.5 at a 2x
display, frozen camera, three times of day). Pixels that differ in the sky band,
A against B in one load, next to A against A in two loads (the noise floor; the
stars twinkle on a clock):

| Time of day | A vs B | A vs A (noise) |
|---|---|---|
| day | 0.012 percent, largest step 2 | 0.011 percent, largest step 2 |
| sunset | 0.009 percent, largest step 3 | 0.010 percent, largest step 3 |
| night | 20.9 percent, largest step 19 | 21.2 percent, largest step 17 |

So at these three times the difference is the size of the run-to-run noise. It
is still a change of pixels on purpose, so it is **not built**; the frames are
in `docs/shots/safari-frame-floor-sky-before-after.jpg` (A, B and the
difference times 8, per time of day; the 1:1 window is where the two differ most,
which by day and at sunset is noise in the city, not the sky). The second B load
of that run came up at a 2x map (the app reset the ratio after it was set), so
only the first pair is used.

## Fixes, in the order worth considering

1. **Lossless, small: upload only the rows that can hold colour** (the clip is
   known: `hzPx + 0.5 * fade`). 4 to 8 percent. Needs a high-water rule so the
   rows left behind by a shrinking clip are cleared. Not built: the gain is
   inside what a Safari reading wanders by.
2. **Pixel-changing, one line: draw the sky at the map's own pixel ratio**
   (`resize()` in `js/sky.js` caps at `Math.min(2, devicePixelRatio)`, so a
   Performance-tier map at 1.5 gets a sky drawn at 2 and sampled down).
   **Measured: 193 ms to 151 ms a frame (5.2 to 6.6 fps), 21 percent.** Only
   machines already on the Performance tier (map at 0.75 of the display ratio)
   would change; Balanced and up keep a 2x sky. See the next section.
3. **Pixel-changing, larger: draw the sky's washes in the GL pass** (a shader for
   the glow lobes, the stars and the clouds) and remove the 2D canvas and the
   copy altogether. Takes out all 58 ms. A rewrite, not the same pixels (gradient
   quantisation differs), so it needs the owner's eye.
4. **Lossless, large: fewer building layers.** 82 `fill-extrusion` layers cost
   about 25 ms; merging layers that share a paint would cut draw calls. Needs a
   look at why the style has 82 and a before/after for every merge.

Nothing here reaches 60 fps. The floor with everything hidden is already 25 ms
(40 fps) before a single building is drawn, and even the sky alone is a third of
the frame. The honest ceiling for a lossless change on this Mac is a few percent;
for "same look, drawn smarter" (options 3 and 4) it is a guess of up to about
double, not measured.

## Still unknown

- **Why script and GPU run one after the other.** With the sky copy skipped the
  frame is 41 ms of script and then 87 ms waiting. Chrome overlaps them. Safari's
  end-of-frame present may be waiting for the GPU process; not shown.
- **How much of the sky's cost is the 2D drawing and how much is the copy.** The
  drawing alone, forced to finish with a 1 x 1 `getImageData`, read 5 to 6 ms in
  four tries and 27 to 53 ms in the other six; why it varies is not known. The
  copy alone is 25 ms. In the frame the two together are 58 to 68 ms.
- **The same GL-call profile in headless Chrome on this Mac, for contrast.** Not
  run.
- Whether another Safari or another Intel Mac behaves the same.
