# Graphics basics study, 2026-10-10

The owner's question: *"to my knowledge rust makes everything run faster. a similar breakdown of language to basics could apply to graphics, see if we can utilize that as well."* His rule: *"each big decision should involve extensive research, with optimism in mind"* and *"testing for that can be completely automated"*.

This is that study: go down to the basics of graphics the way Rust goes down to the basics of code, find the strongest version of each idea, build a prototype of the lead idea, measure it, and write the costs beside the gains. Branch `mac/graphics-basics-study`. Code and commands: `experiments/facade-shader/` (README there). Nothing in `js/`, `index.html`, `HANDOFF.md` or the journal was touched; the site loads none of it. The only file outside the experiment folder is `scripts/verify/facade-shader-bench.mjs`, the entry the AWS runner needs.

**How to read the numbers.** Every number says how it was taken:
- **measured** means this study ran it, with the machine named.
- **estimated** means worked out from measured numbers or from a source, not run.
- **L4** is the AWS runner's NVIDIA L4 (Chrome, hardware GL through ANGLE, vsync off, offscreen targets). It is a strong card: it shows what the work costs a GPU that can absorb almost anything. **It is not the owner's Intel Iris Plus 655 and it is not a phone.** No browser was started on the Mac tonight (the machine is overloaded), so nothing in this document was measured on the Intel chip. Where the Intel chip matters, the document says what the L4 number can and cannot tell.
- **Node** means measured in Node on the Mac, no graphics at all (the maths and the geometry, which do not depend on a card).
- **MB** are mebibytes. Other lanes' work is cited by name (`docs/custom-renderer-study-2026-10-09.md`, `docs/speed-2026-10-09.md`, `docs/perf/safari-frame-floor.md`, PR #437's moire meter).

## 1. The short answer

**The idea, in one line.** Rust goes to the basics of code by not paying for what the program does not use. The graphics version is: **describe a facade by the rule that makes it (the recipe already is that rule) and let each pixel compute what it needs, instead of building every window as triangles that the screen cannot resolve.** The strongest version of that idea was built for one real tower and measured.

**What limits the owner's Intel chip: MEASURED (probe on the Iris Plus 655, Mac quiet, load average 2.5 to 3.5, owner away, headless Chrome 155, ANGLE Metal, minimum of 3 reps).** It is the vertex work. The chip sets up sub-pixel triangles at 935 million a second and fills pixels at 12 Gpixel/s, but with the app's own lighting vertex shader it processes only **85 million vertices a second** (24 byte vertices), 35 million with a 56 byte vertex. The authored mesh has 6.5 million vertices, so its frame cost is about 77 ms at 24 bytes (the earlier study measured 76 to 99 ms), and **pixels are about a thousandth of that** (the facade shader costs 0.31 ns a pixel here: about 0.2 ms for a 1440x900 frame). So the facade shader's value on this chip is the vertices it removes, estimated at 40% of them (the module takes 39.7% of the city's triangles) or about 30 ms of that 77, and the cheapest further win is a lighter vertex shader. The owner's Safari frame also carries a 58 ms canvas upload that no graphics change touches (`docs/perf/safari-frame-floor.md`). Phones were not measured.

**The prototype (Dobie Twenty21 tower, one real authored tower, AWS L4, all measured except where marked):**

| | geometry (what the app builds) | shader walls (one quad per wall) |
|---|---:|---:|
| triangles | 42,252 | **196** |
| bytes | 4.7 MB in the app's arrays (estimated) / 2.5 MB packed | **21.6 KB** |
| windows reproduced from the recipe | 2,328 of 2,328, worst edge 3.05 mm (Node) | the same numbers |
| GPU time, 100 towers (4.2 M triangles), 1440x900 | 0.90 ms | **0.039 ms (23x)** |
| shaded fragments per covered pixel | 2.0 to 2.4 | 1.3 to 1.4 |
| error vs supersampled truth at 230 m (0 to 255) | 6.4 (no AA), 1.13 (4x MSAA) | **1.59** |
| flicker over 0.3 pixel steps at 230 m | 7.9 (no AA), 1.7 (4x MSAA) | **3.3** |
| error / flicker at 55 m | 1.55 / 2.1 (no AA) | **0.30 / 0.71** |
| error / flicker at 500 m | 11.1 / 12.2 (no AA) | **3.4 / 6.0** |

The shader wall removes 3 to 5 times the shimmer error of the unfiltered geometry the app draws on a chip without MSAA, in 1/200 of the triangles and 1/200 of the bytes. It does **not** beat 4x MSAA on geometry for quality (1.1 to 2.0 times its error), and on the strong L4 the speed gain is invisible in a 9 to 11 ms frame. Its case is memory, load time and shimmer on weak chips and phones, not L4 milliseconds.

**The graphics basics, ranked (section 4):** 1. procedural facades (above); 2. bake offline; 3. anti-aliasing (shader walls for geometry, MSAA only where affordable, TAA is a whole-frame project); 4. texture basics (KTX2, arrays: moot wherever a shader replaces the atlas); 5. resolution scale (a safety net, measured +1.5 fps against +6 for two fewer passes); 6. GPU-driven drawing and a depth pre-pass (no gain on a weak chip, overdraw is already about 2); 7. WebGPU (not available in Safari on the owner's 2019 laptop, which cannot run macOS Tahoe, and MapLibre has no WebGPU path).

**First three roadmap steps (section 6):** (1) a phone: the probe and one fixed route with the sky upload and the wall rendering each switched off in turn, and the app (flag off | on) timed on the Intel chip (the probe itself is done); (2) widen coverage (the in-app module already takes 39.7% of the city's triangles; see 8.2 and 8.3); (3) make the flag's compare harness and the moire meter the gate for turning it on by default.

**The call to action (section 8, last):** build **Facet**, a compiler from the recipes to shader walls, baked near geometry and an error budget a build can fail on. A first version is built and measured in this pull request: its generated shader is pixel-identical to the hand-written one, 26 times cheaper than the geometry on the L4, and within 1.1 to 1.5 times the error of 4x MSAA across a 40 m to 1,600 m sweep; it covers 16% of the catalog's windowed walls so far.

**What I could not measure:** a phone; the whole page (flag off | on) timed on the Intel chip; the shader inside the real scene on a weak chip; the MapLibre walls (section 7).

## 2. What "the basics" are for this app

Rust's idea, stated for graphics: *do not pay for what you cannot use, and say what you mean once.* A frame costs, in the end, five things, and the app's numbers for each are below. Everything in this study is one of the five.

| basic | what it is | the app today |
|---|---|---|
| **Vertices and triangles** | every vertex is fetched, transformed and lit; every triangle is set up and rasterised | 3.1 M triangles / 6.5 M vertices of authored buildings, plus MapLibre's 1.5 to 2.6 M triangles; 56% of the authored triangles are smaller than 0.1 m2, the median is 0.083 m2 (Node, from the dump), and one pixel at the usual oblique camera (0.3 m a pixel) is 0.09 m2: **the typical triangle is one pixel or less** |
| **Pixels and overdraw** | every covered pixel is shaded once per layer on top of it | 1.3 M pixels at 1440x900, 36% covered by authored buildings, a phone at device ratio 3 draws 9 times the pixels; overdraw measured in section 4 |
| **Texture bytes** | what must be resident and fetched | 607 MB of per-tile window-pattern atlases at city ready (`docs/speed-2026-10-09.md`), 1,270 MB peak page on a phone profile |
| **Draw calls and state** | what the driver and the browser do per pass | 800 to 1,500 draw calls and 8,600 to 15,400 GL calls a frame (`docs/custom-renderer-study-2026-10-09.md` section 2) |
| **Anti-aliasing** | how a pattern finer than a pixel is turned into one colour | no filtering of geometry thinner than a pixel; the moire meter (PR #437) found the remaining moire is exactly that: window frames, mullions, fins |

What measured evidence already says about which of the five limits the app:

- **Not pixels, on the Acer.** `js/lod.js` (measured, headed Chrome, 3 interleaved reps): render scale 0.75 (44% fewer pixels) gave 31.0 to 32.5 fps; dropping two of 41 fill-extrusion passes gave 37.0 fps. A pass costs whether or not what is in it is legible.
- **Not pixels, on the owner's Intel Mac in Safari.** `docs/perf/safari-frame-floor.md` (measured): a blank WebGL2 canvas of the same 3840x2040 size presents at 59 fps empty, 50 fps with eight full-screen fills, 53 fps with 4.5 million triangles. The real city costs 195 ms: 58 ms of it is one sky-canvas upload, the 82 building layers 25 ms, the authored mesh 22 to 35 ms, and 21 to 25 ms is the page's own stack.
- **Not draw calls alone, on a weak chip.** The custom-renderer study (measured, Intel Iris Plus 655, shared Mac): one draw call instead of 100 gave no change in frame time for the same triangles; on the L4 it gave 3.8x. (Revised after the Intel probe in section 5: the 24 against 56 byte comparison in that study read the same only because the machine was shared; on a quiet Mac the vertex size changes the vertex rate 2.4 times.)
- **Memory, on phones.** The tab dies at about 1.3 GB (WebKit gives no warning); 607 MB of that is wall-pattern atlases and 270 MB the built authored-building buffers.

So the basics that matter for a weak chip are *how many things the pipeline is asked to handle that the screen cannot show* (sub-pixel triangles, a pass per layer, a pattern texture per tile) and *how many bytes sit resident for them*. That is the case for the lead idea.

## 3. The lead idea: draw a wall as one flat quad and let the fragment shader compute its windows

### 3.1 What was built (`experiments/facade-shader/`)

One real authored tower, **Dobie Twenty21** (a pure window wall: 98 walls, 25 floors, 45,585 triangles in the app), drawn two ways from the same cameras on the AWS L4:
- **Arm A, geometry:** the app's own 42,252 wall triangles (from the renderer study's dump of the running app), in the study's 24 byte vertex, lit by the app's own per-vertex formula.
- **Arm B, shader:** 98 flat quads (one per wall, 196 triangles). The fragment shader computes the window grid from the recipe's numbers (bay 1.79 m, window 1.35 x 1.45 m, sill 1.15 m, floor pitch 2.63 m, recess 0.05 m, the three tone triples), as the integral of the pattern over the pixel's footprint in closed form (a periodic pulse train per axis, so nothing is sampled), with the window's recess done as an exact parallax shift: where the ray through a window opening hits the glass or the side reveal. Lit by the same formula. The podium and crown (3,333 triangles) are drawn identically in both arms.
- **Arm A4:** arm A with 4x MSAA, the "just use the hardware" baseline. **Arm Bt:** arm B with a tent (triangle) filter instead of a box.

### 3.2 It reproduces the recipe: measured (Node, no GPU)

`verify-recipe.mjs` cuts the window rectangles the recipe's numbers predict (the generator's own rule: n = round(L / bay), one window per bay per floor, kept only if it clears the wall ends by 0.05 m) and matches them one to one against the glass cells in the app's geometry, wall by wall. **2,328 windows predicted, 2,328 in the geometry, on all 98 walls, worst edge error 3.05 mm.** One surprise the test found: the generator's metres are not the map's. It converts a recipe metre to degrees with 111,320 m a degree east and 110,540 north, and the map converts degrees back with its own sphere, so a recipe metre is 0.99888 local metres going east and 1.00593 going north. The first version of the test was 4 to 8 mm off on every wall; with that scale taken from first principles (not fitted) the glass cell width over the predicted width reads 1.0000 for all 4,656 glass triangles. `selftest.mjs` takes the shader's own `cum`, `cov`, `cum2` and `covTent` text out of the page, runs it as JavaScript and checks it against brute-force sampling: worst difference 3e-4 over 400 random footprints each.

### 3.3 Size, overdraw and time: measured on the L4

| | A: geometry | B: shader |
|---|---:|---:|
| triangles, one tower | 42,252 | 196 |
| vertices, one tower | 84,504 | 392 |
| bytes in the app's own arrays (estimated from its 50 bytes a vertex and 4 a index; the dump gives 55.7 across the whole city) | 4,732,224 | **21,560** (measured: the buffers uploaded) |
| bytes in the study's 24 byte format (measured) | 2,535,120 | 21,560 |
| draw calls | 1 | 1 |

The facade is 92.7% of this building's triangles (42,252 of 45,585). **City-wide** (Node, from the dump): 75.8% of all 3.1 M triangles have a vertical normal (wall cells, side reveals), another 20.6% are small non-vertical ones (top and bottom reveal strips, trim); the generator's own counters give 644,425 wall cells and 83,434 windows with 4 reveal strips each, which is about 63% of all quads. So the share of the 3.1 M triangles that could move to a shader wall is **about 63 to 76%, estimated**, and up to 93% on a pure window tower like this one. The remainder (balconies, fins, canopies, signs, roofs) stays geometry.

**How much of the catalog the shader could actually take is smaller than that upper bound, and it depends on which layer types exist.** `experiments/facet/coverage.mjs` (Node) walks all 54 recipes: 17,555 m of wall band, 55% of it wearing a window skin. A shader that handles only the plain `bays` skin (what this prototype does) covers **16% of the windowed band height**. Adding, in the order that unlocks the most: bands whose floors are not evenly spaced 42%; a frame ring round the window 60%; the `pixel` skin 67%; several openings per bay 73%; an accent panel beside the window 79%; a head panel above it 85%; fixed-column windows 88%; mullions 92% (cumulative share of windowed band height; band height, not triangles; `mod4`, storefronts and balconies are not in these numbers). So the 63 to 76% above is what is reachable after about eight more layer types, not what one prototype takes.

Overdraw (fragments shaded per covered pixel, counted with additive blending in submission order, depth test on, no pre-pass; measured):

| view | fragments per covered pixel, geometry | shader quads | worst pixel, geometry | worst, quads |
|---|---:|---:|---:|---:|
| 1 tower, mid-230m | 2.11 | 1.27 | 8 | 3 |
| 1 tower, street-55m | 2.42 | 1.39 | 11 | 5 |
| 100 towers, city view | 2.03 | 1.36 | 23 | 8 |

Frame time on the L4 (GPU timer query, minimum of 7 repetitions and two interleaved passes; wall time from a 1x1 read-back agrees):

| scene | covered | triangles A | triangles B | A ms (GPU timer, min) | B ms | A wall | B wall | A/B |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 tower, 1440x900 | 2.8% | 42,252 | 196 | 0.009 | 0.003 | 0.02 | 0.02 | 3.0x |
| 1 tower close, 1440x900 | 13.5% | 42,252 | 196 | 0.011 | 0.008 | 0.02 | 0.025 | 1.4x |
| 100 towers (city of 4.2M triangles), 1440x900 | 33.6% | 4,225,200 | 19,600 | 0.899 | 0.039 | 0.905 | 0.05 | 23.1x |
| 100 towers, 3840x2160 | 32.2% | 4,225,200 | 19,600 | 0.91 | 0.166 | 0.92 | 0.18 | 5.5x |
| 100 towers + podiums, 1440x900 | 51% | 4,558,500 | 352,900 | 0.975 | 0.105 | 0.99 | 0.12 | 9.3x |
| 100 towers, 640x400 | 33.6% | 4,225,200 | 19,600 | 0.894 | 0.019 | 0.9 | 0.035 | 47.1x |

Reading it honestly: **a shader wall is 23 times cheaper for the card than the geometry it replaces at a city of 4.2 M triangles at 1440x900 (47 times at 640x400), 9 times cheaper with the unchanged podiums counted in, and 5.5 times at 3840x2160 (where it is fragment work that costs, 0.17 ms)**. But the L4 draws even the geometry in 0.9 ms of a 9 to 11.5 ms frame. On the L4 this is a rounding error. The reason to believe it matters more on a weak chip is the memory (4.7 MB to 21 KB for the tower; the city's 347 MB of arrays and 185 MB on the card in proportion to the triangles that move) and the load (the cell tiler's time), not this table.

### 3.4 Anti-aliasing: the part that did not go as hoped

The meter's method (PR #437): each view is drawn at 1x and at 4x4 and box-filtered down (the "truth"); `err` is the mean absolute difference over the tower's wall pixels (0 to 255); `band` is the same after a 3x3 box (false low-frequency bands); `flicker` is the per-pixel standard deviation of that error over 8 camera steps of 0.3 pixel. Viewport 640x400, the app's 58 degree field of view, no MSAA except in the last column. One deterministic render each on one card.

Error against the supersampled truth:

| view | m per pixel | pixels per bay | A geometry, no AA | B shader (box) | B shader (tent) | A geometry, 4x MSAA |
|---|---:|---:|---:|---:|---:|---:|
| street-55m | 0.152 | 11.74 | 1.552 | 0.302 | 0.444 | 0.148 |
| near-110m | 0.305 | 5.87 | 3.209 | 0.648 | 0.862 | 0.369 |
| mid-230m | 0.637 | 2.81 | 6.404 | 1.586 | 1.83 | 1.127 |
| far-500m | 1.386 | 1.29 | 11.1 | 3.382 | 3.34 | 2.678 |
| far-grazing | 1.386 | 1.29 | 10.379 | 3.363 | 3.352 | 2.382 |
| vfar-1100m | 3.049 | 0.59 | 15.894 | 5.915 | 5.786 | 5.437 |

False bands:

| view | m per pixel | pixels per bay | A geometry, no AA | B shader (box) | B shader (tent) | A geometry, 4x MSAA |
|---|---:|---:|---:|---:|---:|---:|
| street-55m | 0.152 | 11.74 | 1.227 | 0.353 | 0.448 | 0.114 |
| near-110m | 0.305 | 5.87 | 2.267 | 0.695 | 0.799 | 0.241 |
| mid-230m | 0.637 | 2.81 | 3.304 | 1.492 | 1.527 | 0.48 |
| far-500m | 1.386 | 1.29 | 3.825 | 3.721 | 3.404 | 0.721 |
| far-grazing | 1.386 | 1.29 | 5.182 | 4.61 | 4.398 | 0.693 |
| vfar-1100m | 3.049 | 0.59 | 4.693 | 5.64 | 5.337 | 0.987 |

Flicker over 0.3 pixel camera steps:

| view | m per pixel | pixels per bay | A geometry, no AA | B shader (box) | B shader (tent) | A geometry, 4x MSAA |
|---|---:|---:|---:|---:|---:|---:|
| street-55m | 0.152 | 11.74 | 2.105 | 0.711 | 0.839 | 0.25 |
| near-110m | 0.305 | 5.87 | 4.047 | 1.437 | 1.591 | 0.622 |
| mid-230m | 0.637 | 2.81 | 7.856 | 3.253 | 3.385 | 1.721 |
| far-500m | 1.386 | 1.29 | 12.161 | 6.003 | 5.944 | 3.272 |
| far-grazing | 1.386 | 1.29 | 10.575 | 5.302 | 5.26 | 3.018 |
| vfar-1100m | 3.049 | 0.59 | 17.852 | 8.215 | 8.262 | 5.934 |

How the shader compares to the unfiltered geometry the app draws on a chip without MSAA: **error 5.1 times lower at 55 m, 4.0 at 230 m, 3.1 to 3.3 at 500 m and 2.7 at 1,100 m; flicker 2.0 to 3.0 times lower.** That is the shimmer win, and it needs no extra samples.

How it compares to 4x MSAA on the geometry: **MSAA is better.** The shader's error is 2.0 times MSAA's at 55 m, 1.8 at 110 m, 1.3 to 1.4 at 230 to 500 m and 1.1 at 1,100 m, and its false-band number is no better than the unfiltered geometry's beyond 500 m (3.7 to 5.6, against MSAA's 0.7 to 1.0). Two things I tried that did not change that: a tent filter in place of the box (no better: it blurs the near field and gains nothing far), and an L2 footprint instead of the sum of the screen derivatives (a first version used the sum and read 1.75 / 3.60 / 5.95 at 230 / 500 / 1,100 m; the L2 version 1.59 / 3.38 / 5.92). My reading, not tested: at 1.3 pixels a bay the tower's walls are zig-zag faces 1.4 to 3.8 m long, so a face is about one pixel wide, and a per-face filter cannot integrate across faces; MSAA's samples do. So at and beyond one pixel a bay the right representation is not a per-face pattern at all but an average (a mip) per tower. MSAA costs four times the samples and the memory and is off by default on the app's weak profiles (`defaultMSAA`).

Temporal anti-aliasing (a CPU simulation from real renders: 0.3 pixel pan a frame, Halton jitter, history weight 0.15, scored after 8 warm-up frames; arm A, so it is TAA of the geometry):

| view | no AA: error / flicker | TAA (history weight 0.15): error / flicker |
|---|---:|---:|
| mid-230m | 6.627 / 8.653 | 4.758 / 5.326 |
| far-500m | 11.319 / 13.015 | 5.925 / 6.69 |
| vfar-1100m | 14.954 / 17.621 | 7.596 / 8.595 |

TAA halves the geometry's error and cuts its flicker by 38 to 51%, i.e. it lands near the 1x shader wall on the flicker column at 500 and 1,100 m (6.7 and 8.6 against 6.0 and 8.2) and worse at 230 m (5.3 against 3.3), and neither reaches MSAA. TAA needs motion vectors for everything on screen; MapLibre draws none, so TAA in this app is a whole-frame renderer project (path B of the renderer study), not a layer.

Pictures (left to right: geometry 1x, shader 1x, supersampled truth, error of the geometry x6, error of the shader x6): `docs/graphics-basics-study-2026-10-10/quality-near-110m.png`, `quality-mid-230m.png`, `quality-far-500m.png`. The shader's pictures look the same as the geometry's; the error panels show the geometry's window edges lit up and the shader's mostly dark.

### 3.5 What it costs, and the probe

- **Per pixel.** The probe's "facade-like shader" (the same cumulative functions with the derivatives) filled 16 full-screen layers of 1440x900 in 0.22 ms on the L4: 94 Gpixel/s, against 130 for a trivial shader (`probe-l4.json`). **Measured on the owner's Intel Iris Plus 655 (section 5): 3.24 Gpixel/s, 0.31 ns a pixel a layer, 6.4 ms for 16 full-screen layers, against 12 Gpixel/s for a trivial shader.** A shader wall covering 36% of a 1440x900 frame at overdraw 1.4 shades 0.67 M fragments: **about 0.2 ms on that chip** (arithmetic on the measured rate), and on a phone at device ratio 3 and render scale 0.75 (1.67 M pixels) about 0.5 ms. My earlier estimate of 1 to 2 ms from peak arithmetic was five to ten times too high.
- **Features not in the prototype** (priced): night windows (a lit or dark room per window: a hash of building, floor and bay, one more line); window frames and mullions (rectangle rings: separable the same way, I expect them to work, I did not show it); strips, floor lines, `fields`; the `mod4` and `pixel` skins; balconies and fins stay geometry; **shadows** need geometry in the shadow pass, which quads provide (the wall's silhouette is the same; the 5 cm recess shadow is lost).
- **A non-obvious limit** found by the test: the pattern is exact only where layers do not overlap. Averaging each layer and then compositing is not the same as averaging the composite; for window openings that sit inside bays (this skin) the layers are disjoint and it is exact, for strips under windows, frame rings and mullions it is an approximation. (Astra's red-team raised the same point; section 8.)


## 4. The six basics you listed, ranked, each with an optimistic best case, a cost and an automated test

Ranking is by (gain on a weak chip or a phone) against (cost and risk), with the evidence named. "Test" is how a machine, not the owner, would say it works.

| # | basic | optimistic best case | cost, written plainly | automated test | evidence |
|---|---|---|---|---|---|
| 1 | **Procedural facades in the fragment shader** (lead idea) | authored scope: 3.1 M triangles toward 0.3 to 1.2 M (the share that is plain window wall, 63 to 93% depending on the building); 347 MB of build arrays and 185 MB on the card shrink by the same share; moire on those walls gone. Wall-pattern atlases (607 MB) gone for the walls moved to the same shader | per-pixel ALU (small, section 3), the night-window rule has to be ported, every skin kind (`mod4`, `pixel`, strips, piers) is a few more lines each, buildings drawn by MapLibre fill-extrusion must be moved into a layer that can run the shader | `verify-recipe.mjs` (recipe against geometry, per wall), `selftest.mjs`, the lab's err/flicker, the compare harness, the moire meter | section 3, measured |
| 2 | **Bake offline** (not a graphics basic, but it unlocks the rest) | the 7 to 47 s build under the loading veil disappears | wire bytes go up 2.7 MB | `compare.mjs` at 0.00% | `docs/custom-renderer-study-2026-10-09.md` |
| 3 | **Anti-aliasing basics** (analytic, MSAA, TAA) | analytic filtering on shader walls is exact in principle; 4x MSAA on geometry is better than a 1x shader wall; a temporal pass cuts shimmer by about half | MSAA 4x costs memory and fill; TAA needs motion vectors for everything MapLibre draws (it has none), so it is a whole-frame project (path B) | the lab's err and flicker columns (the moire meter's method) | section 3.4, measured |
| 4 | **Texture basics** | KTX2/Basis cuts a texture to about a quarter of RGBA8 (estimated from the formats: 8 bits a pixel against 32); a texture array replaces one atlas per tile | the atlases are painted at run time in JS (`js/facades.js`, about 160 s of worker CPU in the speed study), so compressing them means baking them offline and shipping them (bytes up), and each platform needs a different transcode target (ASTC on iOS and Android, BC on Intel Mac, inferred) | texture bytes in the GL counters; pixel compare | research below; **moot where idea 1 applies: a shader wall has no texture** |
| 5 | **Resolution and shading rate** | dynamic resolution as a safety net | measured weak lever: render scale 0.75 is +1.5 fps where dropping two passes is +6 (`js/lod.js`); the app already has four tiers (0.75, 1.0, 1.0, 1.5); there is no variable-rate shading in WebGL2 or WebGPU (nothing found) | frame time at two scales on the AWS box | `js/lod.js`, `js/graphics.js` |
| 6 | **GPU-driven drawing, depth pre-pass, culling** | one buffer and one multi-draw: 3.8x on the L4 | **no gain on a weak chip** (measured by the renderer study); a depth pre-pass buys little because the measured overdraw is already about 2 (section 3.3); GPU culling saved under 10% of geometry in the one shipped game that published it | `compare.mjs` | renderer study, section 3.2 of it |
| 7 | **WebGPU** | compute culling and mesh generation, render bundles | the 2019 13-inch MacBook Pro cannot run macOS Tahoe, and Safari's WebGPU needs Tahoe (source below), so the owner's own laptop would take the WebGL2 fallback in Safari; MapLibre has no WebGPU path, so it means replacing MapLibre; the only published comparisons are draw-call bound and mixed | none worth building yet | section 4.1 |

### 4.1 WebGPU against WebGL2 for this machine and these phones (research, 2026-10-10; "opened" = page read, "snippet" = search text only)

- **Safari** ships WebGPU in Safari 26 on macOS Tahoe 26, iOS 26 and iPadOS 26. WebKit says `navigator.gpu` needs Tahoe or iOS 26 or later. https://web.dev/blog/webgpu-supported-major-browsers and https://bugs.webkit.org/show_bug.cgi?id=299237 (both opened).
- **The owner's laptop.** The 2019 13-inch MacBook Pro is not on Tahoe's supported list (the 2020 four-port 13-inch and the 2019 16-inch are). https://everymac.com/mac-answers/macos-26-tahoe-faq/macos-tahoe-macos-26-compatbility-list-system-requirements.html (opened). So Safari WebGPU is effectively unavailable on it (my inference from that list; no source states it for this model).
- **Chrome** ships WebGPU on macOS since 113 with no Intel exclusion listed and no published Intel-iGPU bugs found; Chrome on Android needs Android 12 or later and Qualcomm or ARM GPUs; Firefox on Intel Macs is not there yet (opened, same web.dev page).
- **Speed.** No published comparison for a static, high-triangle, few-draw scene was found. One three.js forum test (M4 Pro, cubes) had WebGL faster than WebGPU: 350 against 140 fps at 5,000 cubes. https://discourse.threejs.org/t/webgpu-performance-issue/87939 (opened). A 2023 M1 demo with 10,000 draw calls favoured WebGPU, 50 against 30 fps (snippet). Both stress draw calls, which this scene does not have.
- Verdict: **not a path to speed for this scene, and not available on the owner's laptop in Safari.** It stays a later question for path B of the renderer study.

### 4.2 Texture facts, with sources

- ASTC on WebGL2: iOS 99.93%, Android 99.76%, macOS 89.8% (almost certainly Apple Silicon: the survey does not split by chip), Windows 2.6%; S3TC (BC1 to BC3): macOS 85.2%, Windows 99.96%, iOS 49.21%, Android 31.3% (web3dsurvey, opened). My inference, not a source's: Intel Macs get BC and not ASTC, so a baked texture needs at least two transcode targets and an RGBA fallback.
- Basis Universal transcodes to ASTC 4x4, BC1 to BC7, ETC1 and ETC2; the wasm transcoder is about 515 KB uncompressed (snippet).
- `MAX_ARRAY_TEXTURE_LAYERS` is at least 256 everywhere and usually 2,048 or more; Android is the weak case (opened). Anisotropic filtering: iOS 99.99%, macOS 100%, Android 94% (opened).


## 5. Where "lower level" does NOT help, and what limits the Intel chip

**Measured on the Intel chip (added later the same day, when the Mac went quiet).** The probe ran on the owner's Intel Iris Plus 655 through the Mac's one-browser queue: headless Chrome 155, hardware GL (ANGLE, Metal), 1440x900 offscreen target, three interleaved repetitions each the minimum of 7 (so the minimum of 21 batches per row), the Mac's load average 2.5 to 3.5 and nothing else running (raw files `docs/graphics-basics-study-2026-10-10/intel/probe-rep1..3.json`):

| test | min of 3 reps (ms) | rate at the minimum | reps (ms) |
|---|---:|---|---|
| tiny-1M (0.02 px each) | 1.5 | 666.7 Mtri/s, 334.3 Mvert/s | 1.52 / 1.5 / 1.96 |
| tiny-2M (0.01 px each) | 2.48 | 806.2 Mtri/s, 404 Mvert/s | 2.48 / 2.62 / 3.04 |
| tiny-4M (0.005 px each) | 4.28 | 934.6 Mtri/s, 468 Mvert/s | 4.9 / 4.28 / 4.42 |
| onepx-2.6M (about 0.5 px each, whole screen) | 5.3 | 489.1 Mtri/s, 245 Mvert/s | 6.78 / 5.3 / 5.38 |
| onepx-2.6M, app vertex shader, 24 B vertex | 15.3 | 169.4 Mtri/s, 84.9 Mvert/s | 15.3 / 16.8 / 16.68 |
| onepx-2.6M, app vertex shader, 56 B vertex | 37.26 | 69.6 Mtri/s, 34.8 Mvert/s | 37.74 / 37.26 / 39.66 |
| big-2.6M? (8 px each, 160k tris over the screen) | 0.54 | 74.7 Mtri/s, 37.9 Mvert/s | 0.56 / 0.56 / 0.54 |
| fill trivial x8 | 1.16 | 8.94 Gpix/s, 0.112 ns/pixel/layer | 1.36 / 1.28 / 1.16 |
| fill trivial x32 | 3.46 | 11.99 Gpix/s, 0.083 ns/pixel/layer | 3.46 / 3.96 / 3.54 |
| fill facade-like shader x4 | 1.84 | 2.82 Gpix/s, 0.355 ns/pixel/layer | 1.84 / 1.88 / 1.88 |
| fill facade-like shader x16 | 6.4 | 3.24 Gpix/s, 0.309 ns/pixel/layer | 6.6 / 6.4 / 6.56 |

Reading it. **Setup is not the limit:** sub-pixel triangles go through at 935 Mtri/s (the paper figure for Gen9 is 0.67 a clock, about 0.8 G/s). **Pixels are not the limit:** 12 Gpixel/s trivial, 3.2 for the facade shader. **Vertex work is the limit:** with a trivial vertex shader the chip handles 245 Mvert/s; with the app's lighting vertex shader 85 Mvert/s (the lighting costs 2.9x); and with a 56 byte vertex 35 Mvert/s (the vertex bytes cost another 2.4x: this chip is bound by vertex fetch as well as vertex ALU). Applied to the app: the authored mesh has 6.5 M vertices (2.09 a triangle: one quad per cell, nothing shared), 6.5 M / 85 M a second = **77 ms** at 24 byte vertices, which is what the custom-renderer study measured on this chip (76 to 99 ms) and why one draw call instead of 100 changed nothing. Its other measurement, that the three.js version at 56 bytes took no longer than the 24 byte prototype, now looks like the loaded machine's noise (it measured on a shared Mac). The probe's `appWorkloadEstimate` field has a unit error in the committed L4 run (it divides by Mpixel/s for Gpixel/s, so its pixel-bound figure is a thousand times too large; fixed in this commit, the raw rows are right).

**What this changes.** The remaining arguments below (from other lanes' measurements) agree with it; what it adds is the ranking: vertices first. In order of gain on this chip: (1) fewer vertices (Facet's shader walls: the module takes 39.7% of the city's triangles, so about 40% of the vertices); (2) a lighter vertex shader (the lighting formula costs 2.9x the vertex rate; a wall cell's four vertices all compute the same colour, so the colour could be one per-draw or per-quad constant); (3) smaller vertices (the packed 24 byte vertex against the app's 56); (4) fewer passes; pixels last. All four are estimates from these rates until each is built and timed on this chip.

The four earlier pieces of evidence, which the probe now supports:

1. **The architecture on paper** (Intel's Gen11 architecture paper, whose Gen9 GT2 column the research helper read; the Iris Plus 655 is Gen9.5 GT3e with 48 execution units): triangle setup 0.67 a clock for lists, 8 pixels a clock, 38.4 GB/s of memory. 3.1 M triangles is about 4.6 M clocks, **about 4 ms at 1.2 GHz** for setup (estimated, my arithmetic). Source: https://www.intel.com/content/dam/develop/external/us/en/documents/02-the-architecture-of-intel-processor-graphics-gen11-807276.pdf (opened).
2. **The same chip in Safari, measured by the speed lane's predecessor** (`docs/perf/safari-frame-floor.md`): 4.5 million triangles with a trivial shader in a blank canvas of the page's size present at 53 fps, eight full-screen fills at 50 fps. So neither triangles nor pixels, taken alone, are what fills a 195 ms frame. The real frame is 58 ms of one canvas upload, 25 ms of the 82 building layers, 22 to 35 ms of the authored mesh, and the rest passes, labels, fog and the page's own stack.
3. **The same chip in headless Chrome, measured by the custom-renderer study on the shared Mac:** the authored mesh took 51 to 102 ms with three.js and 76 to 99 ms with a one-draw renderer using 24 byte vertices instead of 56. Fewer draw calls and 2.3 times fewer vertex bytes changed nothing. That is about 20 times the architecture's setup time and about 3 times the quiet-Safari number: the difference between this and item 2 is most likely the other lanes' browsers sharing the chip that night (the study says the machine was shared and the p90 was 140 to 164 ms), but that is an inference, not a measurement.
4. **On the Acer** (`js/lod.js`, measured): 44% fewer pixels bought 1.5 fps; two fewer passes bought 6.

**What I conclude, labelled as a conclusion and not a measurement.** On the owner's chip the geometry share is real but not the biggest slice: the authored mesh is 11 to 18% of the Safari frame (22 to 35 of 195 ms). The biggest slice is one 20 MB canvas upload (58 ms, 30%) that is a synchronisation cost, not a graphics cost: a "basic" worth stating (do not copy a canvas to a texture every frame; the sky should be GL) but outside this study's scope. After that, cost scales with the number of passes and the per-pass state (82 fill-extrusion layers, 224 style layers). **So the facade shader is worth about the geometry share on that chip, 11 to 18% of the Safari frame for the authored buildings alone, plus up to the 25 ms of the 82 fill-extrusion layers if the West Campus and outer-ring walls move into the same shader. It is not a 2x.** That is the honest size of the optimism on this particular laptop.

**The probe** (`experiments/facade-shader/probe.mjs`, three seconds a run) measures, on whatever chip it runs on, triangles a second for sub-pixel and one-pixel triangles, the cost of the app's lighting in the vertex shader, vertex bytes (24 against 56), pixels a second for a trivial and a facade-like shader. It ran on the L4 (section 3.5: everything under a millisecond, nothing to learn) and on the Intel Iris Plus 655 (the table above). **Still owed: the same probe on a phone**, and the app itself (flag off | on) timed on the Intel chip, which the Mac's quiet window was not used for.

**Things that do not help here, with the evidence:**
- **Fewer draw calls / multi-draw / GPU-driven submission.** Measured no change on this chip (3 above). It helps on a strong card (3.8x on the L4, but that is 3 ms of 10) and with CPU time.
- **A depth pre-pass.** Measured overdraw of the authored walls is 2.0 to 2.4 shaded fragments per covered pixel with geometry (1.3 to 1.4 as shader quads), so a pre-pass can remove at most half of the fragment work of a part of the frame that is not fragment bound.
- **A lower resolution.** Measured 1.5 fps on the Acer; it is the right safety net for a phone at device ratio 3, not a fix.
- **WebGPU.** Section 4.1.
- **Compressed textures for the atlases.** They shrink bytes that need not exist (idea 1).
- **MSAA for the shimmer.** MSAA fixes geometry edges. It does not fix a pattern drawn inside a polygon, and the authored windows are geometry, so MSAA does help them (section 3.4 measures how much). It does nothing for the MapLibre atlas walls.


## 6. Roadmap: steps of one or two days, with a gain, an automated test and a stop point

Order: the cheap measurement first, then widen the proof, then put the one idea that survived into the app behind a flag.

| # | days | step | gain | automated test (written first) | stop point |
|---|---|---|---|---|---|
| 0 | done | This PR: the Dobie tower both ways, the recipe-against-geometry test, the lab, the probe | the numbers in section 3 | `verify-recipe.mjs`, `selftest.mjs`, `run.mjs` | none |
| 1 | 1 | **Before widening anything, measure the phone:** run `probe.mjs` and `run.mjs` on the 2019 Intel Mac when it is idle, and profile one fixed route on the weakest phone with the sky upload and the wall rendering each switched off in turn (an independent reviewer's strongest warning: 200 times fewer triangles does not establish phone speed or memory). `page/probe.html` needs only a browser | the unmeasured half of this study: which of triangles, pixels or neither limits the owner's chip; the shader's real cost per pixel on it | the two JSON files; compare to the L4's | if the Intel chip's one-pixel-triangle rate is above 300 M triangles a second, geometry is not the limit and ideas 1 and 6 are worth only the memory; do steps 2 to 3 for memory, not speed |
| 2 | 2 | **Widen what the shader takes, in the order `experiments/facet/coverage.mjs` gives: uneven floor pitch (16% to 42% of windowed band height), then the window frame ring (60%):** run `extract.mjs` per building (the dump script already exists), make `verify-recipe.mjs` take a list | the share of the 3.1 M triangles that can move (this study estimates 63 to 75%; this step measures it) | `verify-recipe.mjs` over every building: counts equal, edges inside 5 mm | any building where windows predicted from the recipe differ from the geometry by more than 5 mm or in count: fix the rule, never patch the building |
| 3 | 2 | **Put it in the app behind `?facadeshader=1`:** the bake writes one quad per wall plus the pattern numbers; `js/slopes-apartments.js` emits quads instead of cells for covered bands; reveals, balconies, fins stay geometry; the shader goes into the existing `slopes.material()` | fewer built triangles, less build time, less memory (the 347 MB of arrays and 185 MB on the card shrink with the triangles); shader walls cannot shimmer | `experiments/renderer/compare.mjs` (daylight views under 1% of building pixels over tolerance), `scripts/verify/moire-meter.mjs` (err and flicker lower than today on the authored arm), frame time on the AWS L4 with the GPU timer | compare over 3% on any view: list the missing shading feature (the study found the same for the first prototype) or stop |
| 4 | 2 | Night windows: a lit/unlit room per window is a hash of (building, floor, bay): the same shader, one more line | night views stop being excluded | compare at night views | the hash disagrees with the generator's `CityNight.room` on any window |
| 5 | 2 | The other skins: `mod4` (Union on 24th: the owner's own k = (c minus r) mod 4 rule), `pixel` (The Standard), storefronts | the 2 largest buildings by triangles (2400 Nueces at 269 k, Union on San Antonio at 151 k) | `verify-recipe.mjs` for those skins | a skin whose rule is a hash per cell the shader cannot reproduce |
| 6 | 5 | **West Campus and outer-ring walls into the same shader** (they are MapLibre fill-extrusion with a pattern atlas per tile today) | the 607 MB of atlases and about 160 s of worker CPU gone; tile-anchored cross-fades gone; the largest phone-memory item | the moire meter on the MapLibre arm; texture bytes in the GL counters | if the walls cannot be drawn by a custom layer in the right depth order with MapLibre's, keep the atlases for the far field |
| 7 | 1 | Decide anti-aliasing: tent against box (section 3.4) and whether 4x MSAA is affordable on phones | the flicker number of the shader walls | the lab's flicker column | none |

First three steps for the lead: 1 (measure the Intel chip), 2 (cover the plain towers), 3 (put it behind a flag with the compare harness as the gate).


## 7. What I could not measure

- **A phone, and the app itself on the Intel chip.** The probe ran on the Iris Plus 655 when the Mac went quiet (section 5); no phone was reachable, and the whole page (flag off | on) was not timed on that chip. Every full-scene frame time here is the L4's.
- **How much of the Intel frame is the authored mesh once everything else is drawn.** The probe isolates the chip's rates; the 77 ms is arithmetic from them, matching the earlier study's isolated measurement, not a measurement of the whole page.
- **The shader's cost inside the real scene on a weak chip.** Measured in isolation on the Intel chip (0.31 ns a pixel); inside the app (more passes, shadows) it was not.
- **A whole city of shader walls in the real app.** One tower was done; a hundred are the same tower repeated (instancing), which proves the draw cost and says nothing about the variety of the other skins.
- **Night windows, balconies, fins, frames and mullions** in the shader (priced, not built). Frames and mullions are rectangle rings and are separable the same way, so I expect them to work; I did not show it.
- **TAA in the app.** The temporal arm is a CPU simulation from real renders with a known pan, not a TAA in the page, and not through MapLibre's moving camera.
- **Real MapLibre fill-extrusion walls.** The shader was not tried against the atlas walls; step 6 depends on that.
- **Run-to-run noise on the L4.** Each timing is the minimum of seven repetitions and two interleaved passes; the quality numbers are single deterministic renders (the same input always gives the same pixels on one driver) but were taken on one card and one driver.


## 8. Call to action: build Facet, a budgeted facade compiler

**Build one thing: Facet, a compiler for facades whose output is proven against its own error budget.** Not a faster shader, and not a new syntax for people to type.

**What it is.** The hand-authored recipes (`data/apartments/*.json`) stay the only source: they are already a small declarative language (a skin is a bay width, a window size, a sill, strips, floor lines, a fit rule), written by the owner and by AI agents from photographs, with a source on every number. Facet compiles a skin into a small intermediate form (a layered, axis-aligned rectangle program over a wall's own coordinates: field, strips, floor lines, openings with a recess) and from that one form emits three things:
1. **a fragment function** (generated GLSL, closed-form filtered coverage per layer, composited in painter's order) so the wall is one quad at any distance;
2. **the baked wall package**: one quad per wall with its constants, plus the near-field geometry the shader cannot show (balconies, fins, deep reveals, silhouettes), as one static file instead of 3.1 M triangles built at load;
3. **a budget**: for every building and every skin, the distance at which the shader wall is as good as the geometry (by the lab's `err` and `flicker` columns against supersampled truth, with 4x-MSAA geometry as the competing baseline), the representation to use on each side of that distance, and a hard failure of the build when a wall is worse than the gate.

**What it replaces.** The runtime cell tiler for the covered skins (`tileFace` in `js/slopes-apartments.js`, the 7 to 47 s build and the 347 MB of arrays); the hand-written GLSL twin of each skin; and, in a later step, the JavaScript pattern-atlas painter (`js/facades.js`, 607 MB of textures, about 160 s of worker CPU) and MapLibre's `fill-extrusion-pattern` walls. Today the same rule is written three times (the cell tiler, the atlas painter, the pattern layers) and they drift; Facet makes it one.

**Why this and not the alternatives**, from the measurements and from an independent consult (Astra, run twice: once for its own idea before seeing mine, once to attack mine):
- *Bake the facades to textures (KTX2, arrays, mips).* Established and handles irregular skins, but it stores every repeated window as texels, needs a per-platform transcode target (ASTC on iOS and Android, BC on Intel Macs), and the atlases are today painted at run time, so it adds bytes where the shader has none. Astra's own alternative was this plus streamed chunks. It remains the right fallback for skins Facet cannot express (hash-toned `pixel`, the `mod4` weave), which is why the compiler must emit "keep as geometry or texture" as a legal answer.
- *Mesh simplification / LOD of the generated triangles.* Cuts triangles but keeps the aliasing and drops authored dimensions; the measured error of unfiltered geometry is 3 to 5 times the shader's.
- *A WebGPU city renderer.* Not available in Safari on the owner's 2019 laptop (it cannot run macOS Tahoe), MapLibre has no WebGPU path, and the scene has too few draw calls for it to help.
- *A new human-typed facade language.* Astra's strongest objection and I accept it: JSON is already the language, and new syntax buys nothing until several incompatible skins need it. So Facet's language is an intermediate form generated from the recipes, like bytecode, not something anyone writes.

**What Astra's attack changed (checked against my numbers).** (1) The gate is not "the shader is exact": the measured shader wall is 1.1 to 2.0 times the error of 4x MSAA on geometry, so the gate is a ratio and the budget decides, per wall, where geometry or MSAA stays. (2) Layer-by-layer averaging is not the average of the composite where layers overlap; v0 admits only skins whose layers are disjoint and says so. (3) A pixel footprint on a rotated wall is not separable; the shader uses the moment-matched box (it measured better than the sum of derivatives and no worse than a tent). (4) A CPU oracle that shares the compiler's logic can share its bugs: truth stays the app's own generated geometry (`verify-recipe.mjs`), never the compiler's own evaluator. (5) The 82 MapLibre fill-extrusion layers cannot run this shader at all: step 6 of the roadmap needs those walls in a custom layer, which is its own project and is not claimed here. (6) A switch between geometry and shader can pop; the lab measures how far the two pictures are apart: 0.8 levels at 55 m, 1.3 at 110 m, 2.7 at 230 m (of 255), growing to 9 at 1,100 m where both are guessing at sub-pixel detail. (7) A third consult, on the built v0, added the strongest warning: 200 times fewer triangles does not establish phone speed or memory, so the next gate is the p95 frame interval on the weakest phone over a fixed route with the sky upload and the wall rendering each switched off in turn, not catalog coverage. It also chose "uneven floors first, frames second" for the order of widening, which is also what the catalog arithmetic says.

**The smallest first version is built, in this same pull request (`experiments/facet/`), and its results follow.**

**What could make it fail:** oblique views and reveal visibility the parallax shift cannot show; the representation switch popping; an Intel chip or phone where the fragment cost or the memory is not what the arithmetic says (the probe decides, step 1); or skins that turn out to be mostly the ones Facet cannot express (the budget will show the share).

### 8.1 Facet v0, built: what it does and what it measured

`experiments/facet/` (README there). Source: the Dobie Twenty21 recipe. `facetc.mjs compile` turns its `curtain` skin into the IR (`dist/dobie-twenty21.facet.json`: a field layer and an opening layer), a generated vertex and fragment shader (3,768 bytes of GLSL), and a baked wall package (98 quads, 196 triangles, 19,992 bytes; the app's geometry for the same wall is 42,252 triangles and 4.7 MB in its arrays). The compiler refuses what it cannot draw, with the reason (`selftest.mjs` checks louvres, frames, offsets and the `pixel` kind are refused).

**Tests with no GPU (Node, `selftest.mjs`):** the IR's window area on all 98 walls equals the generator's own rule to 2e-15; the compiled coverage maths agrees with an independent brute-force point oracle, written from the layout rules and not from the compiler, to a mean of 0.16 of 255 on the real skin (worst 1.1), 0.75 on a synthetic skin with strips at joints and an opening (worst 7.4, the oracle's own sampling noise), 0.31 on strips crossing floor lines; the budget logic behaves in three cases (all inside, all outside, a failure only near, a failure in the middle, which must not invent a switch). One result corrected my own earlier claim, and an outside reviewer's: compositing layers one after another is *exact* over a box footprint when each layer depends on one axis only (a strip on s, a floor line on z), because the average of a product of independent axes is the product of the averages; it is approximate only where two 2D rectangles overlap (a head panel on a window), which v0 does not take.

**Tests on the AWS L4 (run 38039400908, one deterministic render per cell):**
- **The generated shader is pixel-identical to the hand-written one:** F against B, mean absolute difference **0.000** at all 11 distances. It compiled and ran first time on the GPU.
- **Speed, 100 towers at 1440x900 (GPU timer, minimum of 7 and two passes):** geometry 0.899 ms, hand-written shader 0.040 ms, generated shader 0.035 ms (26 times less than the geometry).
- **A camera sweep from 40 m to 1,600 m, scored with the moire meter's method, against 4x MSAA geometry as the competing baseline** (`docs/graphics-basics-study-2026-10-10/facet/sweep.json`; pictures `sweep-55m.png`, `sweep-230m.png`: geometry, Facet, supersampled truth, error panels):

| distance | pixels per bay | err: geometry / **Facet F** / 4x MSAA | F / MSAA | flicker: geometry / **F** / MSAA | F / MSAA | F against MSAA picture (levels) | F against the hand-written shader |
|---:|---:|---|---:|---|---:|---:|---:|
| 40 m | 16.15 | 0.975 / **0.194** / 0.175 | 1.11 | 1.416 / **0.433** / 0.324 | 1.34 | 0.601 | 0 |
| 55 m | 11.74 | 1.546 / **0.324** / 0.244 | 1.33 | 2.15 / **0.71** / 0.439 | 1.62 | 0.804 | 0 |
| 80 m | 8.07 | 2.34 / **0.437** / 0.316 | 1.38 | 3.037 / **1** / 0.556 | 1.80 | 0.995 | 0 |
| 110 m | 5.87 | 3.229 / **0.659** / 0.456 | 1.45 | 4.193 / **1.455** / 0.756 | 1.92 | 1.311 | 0 |
| 160 m | 4.04 | 4.655 / **1.065** / 0.701 | 1.52 | 5.942 / **2.24** / 1.136 | 1.97 | 1.909 | 0 |
| 230 m | 2.81 | 6.418 / **1.559** / 1.123 | 1.39 | 7.861 / **3.22** / 1.679 | 1.92 | 2.707 | 0 |
| 330 m | 1.96 | 7.956 / **2.101** / 1.678 | 1.25 | 9.35 / **4.337** / 2.324 | 1.87 | 3.455 | 0 |
| 500 m | 1.29 | 10.326 / **3.533** / 2.614 | 1.35 | 11.466 / **5.879** / 3.134 | 1.88 | 5.563 | 0 |
| 700 m | 0.92 | 13.58 / **4.228** / 3.468 | 1.22 | 14.164 / **6.679** / 3.926 | 1.70 | 6.812 | 0 |
| 1100 m | 0.59 | 16.13 / **6.086** / 4.308 | 1.41 | 17.983 / **8.195** / 4.857 | 1.69 | 9.09 | 0 |
| 1600 m | 0.4 | 14.533 / **8.605** / 5.921 | 1.45 | 18.367 / **8.979** / 6.532 | 1.37 | 11.312 | 0 |

- **The budget** (`facetc.mjs budget`, gate on the error ratio F / 4x MSAA and on the flicker ratio, 2.0): the worst error ratio in the sweep is 1.52 (at 160 m) and the worst flicker ratio 1.97. **Gate 1.5: the shader wall is outside it only at 160 m, a marginal single-row miss that is not a clean near/far split (so the budget reports it and invents no switch). Gate 1.6: it passes at every distance swept.** The honest reading is that against 4x MSAA this skin's shader wall sits at 1.1 to 1.5 times the error and 1.3 to 2.0 times the flicker at every distance, not at some distance; the budget's job in this first version is to put that in a file a build can fail on, and to tell where a representation switch would show (F against the MSAA picture differs by under 3 levels of 255 out to 230 m, so a switch at or beyond 4 pixels a bay should be hard to see; this was measured as a difference between pictures, not by showing a person a flythrough).

**What v0 does not do, stated:** it takes one skin (`bays`/`flat`: field, strips, floor lines, one opening per bay per floor). Over all 54 recipes (`facetc.mjs refuse` and `coverage.mjs`, Node) it accepts 16% of the windowed band height; widening it in the order uneven floors, frame rings, `pixel`, offsets, accents, heads, fixed columns, mullions reaches 92% (band height, not triangles). The wall rectangles come from the app's geometry, not from the footprint ring. Near-field geometry is the app's existing geometry, not yet baked by Facet. Night windows, the MapLibre pattern walls, shadows and picking are not touched. Nothing here is in the app.

**The next step is still the one from section 6, step 1, with a sharper gate:** measure the weakest phone and the Intel Mac before widening Facet, and gate the next milestone on the p95 frame interval on that phone over a fixed route, not on coverage.

### 8.2 Coverage, measured against the real generator (Node, no browser)

The first version measured coverage in metres of band height from the recipes. The better instrument is the real thing: `experiments/facet/node/` loads the app's own `js/slopes.js` and `js/slopes-apartments.js` into Node (the loader is the Rust study's, from PR #436; no browser, no map, 3.2 s for the whole city) and taps every wall piece the cell tiler cuts. The generator builds **3,113,629 triangles; the cell tiler cut 16,635 wall pieces and 2,143,050 of them (68.8%)**: that is the most any wall shader can take. `node/verify-pieces.mjs` asks, piece by piece and layer type by layer type in the greedy order, what Facet would need, and for the pieces it accepts checks two things against the generator's own output: (1) the window rectangles the rule predicts equal the generator's window list (its own units, tolerance 1e-6) and (2) at random points of the piece the tone the rule paints equals the tone of the real cell the generator emitted there (cells rasterised from the real quads, nearest wins). Coverage is the share of ALL the city's triangles:

| layer type added | triangles Facet covers | share of the city | wall pieces | windows | window-list mismatches vs the generator | picture points checked | picture mismatch |
|---|---:|---:|---:|---:|---:|---:|---:|
| v0 (bays/flat, even floors) | 222,290 | **7.14%** | 9,188 | 12,323 | 0 | 998,313 | 0% |
| floors | 259,984 | **8.35%** | 9,231 | 14,933 | 0 | 998,313 | 0% |
| frame | 377,696 | **12.13%** | 9,418 | 18,583 | 0 | 1,017,213 | 0% |
| offsets | 420,594 | **13.51%** | 9,555 | 21,223 | 0 | 1,024,863 | 0% |
| head | 420,594 | **13.51%** | 9,555 | 21,223 | 0 | 1,024,863 | 0% |
| accent | 510,018 | **16.38%** | 10,286 | 23,863 | 0 | 1,024,863 | 0% |
| cols | 513,436 | **16.49%** | 10,305 | 24,040 | 0 | 1,024,863 | 0% |
| mullion | 1,258,512 | **40.42%** | 13,788 | 49,936 | 0 | 1,547,781 | 0.218% |
| spandrel | 1,301,648 | **41.8%** | 14,342 | 50,804 | 0 | 1,558,881 | 0.217% |
| checker | 1,314,524 | **42.22%** | 14,352 | 51,566 | 0 | 1,558,882 | 0.217% |

Reading it: the plain `bays`/`flat` skin with even floors (v0) is 7.1% of the city; uneven floors add 1.2 points, frame rings 3.8, offsets 1.4, heads none (rare), accents 2.9, fixed columns 0.1, **mullions 23.9** (a third of the wall pieces with windows carry a mullion), spandrels 1.4, checker windows 0.4: **42.2% of all triangles, 14,352 pieces, 51,566 windows, with no window-list mismatch against the generator on any piece**. What still blocks the other 26.6 points of the 68.8: a band's own openings (garage mouths: 240 k triangles), the `pixel` skin (237 k), storefronts (182 k), round-headed windows (83 k), the `mod4` weave (80 k), piers (77 k), louvres (45 k), `fields` and `bands` options. Accent pieces are checked on their window list but not on their picture here, because the accent tone is a hash the oracle does not carry (the in-app check below does carry it).

**A defect in the generator that this check found.** In 4 buildings a third of the sampled points inside a window read "trim" in the generator's cells where the rule says "glass". The cause: `tileFace` rounds its z cuts to four decimals (`+z.toFixed(4)`), and a window whose height has more decimals (The Quarters Grayson House: 2.2345714... m) ends up a hair shorter than its own cell, so the test "does this window span this cell" fails and the glass cell is **never drawn**. The window shows as a trim-coloured panel with a mullion. The shader draws the window the recipe says. Counted separately in the table above (48,044 triangles in 4 buildings), not hidden. Fixing the generator is a one-line change (compare with the rounded value) that this study does not make.

### 8.3 In the app, behind `?facadeshader=1`

`js/facet-walls.js` (new, loaded only with the flag: `js/slopes-apartments.js` injects the script tag only when `?facadeshader=1` is in the URL; with the flag off nothing is downloaded or run) plus about 20 changed lines in `js/slopes-apartments.js` (the loader, a collector per build, two hook lines in front of the two `tileFace` calls, one line adding the mesh to the group). What the flag draws: **every wall piece of a window skin the module can take is one quad; the other pieces stay geometry.** Taken: the plain `bays`/`flat` skins with their field, strips, floor lines, windows in a grid with any floors, frames, offsets, fixed columns, heads, spandrels, accent panels, mullions and any presence rule (checker), exactly the generator's window list. Refused (stays cells): cuts, band openings, storefronts, `pixel`, `mod4`, round-headed windows, piers, fins, louvres, `fields`, `bands`, more than 48 rows or 64 columns, and any piece whose own point evaluator disagrees with the generator's tone function at 24 sampled points (a self-check that runs for every piece at build time).

How it keeps the look: the window grid comes from the generator's OWN resolved window list (so floors, frames, accents, lit and unlit rooms are the cells' own numbers), packed into three data textures (a record per piece, a tone table, a per-window table holding presence, accent index and the glass cell's night colour). The fragment code is spliced into the very same material source the geometry uses (`slopes.material()`'s vertex and fragment text, patched in memory), so lighting, sun shadows, night lamps, window reflections and surface detail run unchanged: the block sets `baseColor`, `albedo`, `night` and `surface` and everything after it is the app's. The mesh is the building's shadow caster (it deliberately does not carry `disposeFacade`, which would hide it from the shadow pass). Window coverage is box-filtered in closed form over the pixel footprint with the exact parallax of the recess; where a pixel spans about a window or more, the grid fades to the piece's mean colour (so distant windows cannot moire), which is also what a distant lit/unlit pattern averages to at night.

**Node check of the module itself, over the whole catalog** (`node/verify-module.mjs`; the module's own `take()` offered every piece exactly as the hook does): it takes **14,145 of 16,635 wall pieces = 39.7% of the city's triangles (1,236,180 of 3,113,629)**. The CPU twin of the shader over the packed data paints the same tone as the real cell at 694,766 sampled points on the taken pieces with 3,421 differences (0.492%), of which all but 55 points (0.008%) are the generator's lost-glass defect above; and the night colour of the glass in the per-window table equals the generator's glass cell's night colour at **77,155 sampled points with 0 differences**.

### 8.4 Night: lit windows in the shader walls

A window's night colour is part of the per-window table the module builds from the generator's own resolved windows: for each window, `lit ? (nightTone or the layer's lit tone) : (the unlit colour the city-night module gives a closed room's glass, else the glass tone's own night colour)`, exactly the colour `tileFace` gives that window's glass cell. The shader paints the window with it into the `night` colour the app's emission and lamp code already reads, so the same lit rooms light up, with the app's own `cityEmission`. **Node check:** the night colour of the glass in the table equals the generator's glass cell's night colour at **77,155 sampled window points with 0 differences** (stub city-night: the real module's unlit rule is applied by the hook in the app, not in Node). **In the app (AWS L4, night hour p = 0.90):** the lit rooms are there and in the same places; the whole-frame difference to the geometry is 0.43 to 1.1% of pixels moved and a mean difference of 0.17 to 0.73 of 255 (table below). Two bugs the pictures found and the module fixed: the first in-app run faded the window grid to the piece's mean colour at about one window a pixel and the lit windows washed out (`docs/graphics-basics-study-2026-10-10/facet-app-run1/west-campus-night-off-on.png`); the closed-form integral is exact at any footprint, so the fade now starts at 3.5 windows a pixel. A pixel straddling a window is also now lit in proportion to its glass share (see 8.5).

### 8.5 The app, flag off against flag on: pictures, bytes, memory, moire

`scripts/verify/facet-app.mjs` (pictures, bytes, GL counters) and `moire-meter.mjs` (the meter of PR #437, copied here) on the AWS L4, headless Chrome, 1440x900, flag off then on, same server. **Pictures** (off on the left, on the right, then moved pixels in magenta; the crops are the 560x330 window with the most change; whole frames beside them) are in `docs/graphics-basics-study-2026-10-10/facet-app-run2/pictures/`: `spawn-day|night-off-on.jpg`, `west-campus-day|night-off-on.jpg`, `drag-street-day|night-off-on.jpg` and the `-whole-off-on-moved.jpg` of each. Run 2 is the version with the window-grid fade fixed (run 1 is kept in `facet-app-run1/`).

Pixels that moved more than 12/255 between flag off and on, over the whole frame (the authored buildings are a third to a half of it):

| camera and hour | pixels moved more than 12/255 | mean absolute difference (0-255, whole frame) |
|---|---:|---:|
| spawn-day | 1.874% | 0.602 |
| spawn-night | 1.116% | 0.727 |
| west-campus-day | 0.793% | 0.381 |
| west-campus-night | 0.427% | 0.172 |
| drag-street-day | 1.752% | 0.657 |
| drag-street-night | 0.815% | 0.436 |

**What changed in the page** (same table, measured; GL bytes are the page's counters after the six shots):

| | flag off | flag on | change |
|---|---:|---:|---:|
| triangles in the authored apartment mesh (the generator's count) | 3,116,469 | 1,880,289 | -1,236,180 (-39.7%) |
| quads the flag adds | 0 | 14,145 (28,290 triangles) | |
| CPU arrays of the apartment meshes at ready | 347.1 MB | 217.9 MB | -129.1 MB (-37.2%) |
| of which the flag's own arrays and three data textures (piece records, window table, tones) | 0 | 2.9 MB geometry, 4.0 MB textures | |
| GL buffer bytes held after the six shots | 549.0 MB | 419.8 MB | -129.1 MB (-23.5%) |
| GL texture bytes held after the six shots | 83.9 MB | 85.1 MB | +1.1 MB (+1.4%) |
| JavaScript the page downloads | 3,601,445 | 3,634,430 | +32,985 (+0.9%) |
| everything the page downloads | 40,980,420 | 41,013,405 | +32,985 (+0.1%) |
| GL programs used | 44 | 45 | |

What the flag does NOT change when off: the page downloads nothing new. It does change one file: `js/slopes-apartments.js` carries the loader and the hook lines, **+1,908 bytes raw, +608 bytes gzipped** (measured against main). With the flag on the page also downloads `js/facet-walls.js` (32,730 bytes raw, 10,697 gzipped).

**The moire meter, as the meter reports it** (each arm against its own 4x4 supersampled truth; authored-building pixels only; `err`, `band`, `flicker` as in section 3.4; lower is better):

| view | authored-building pixels | err off / on | band off / on | flicker off / on | p99 err off / on |
|---|---:|---|---|---|---|
| west-far | 56% / 56% of the frame | 2.73 / 5.48 | 1.15 / 3.71 | 3.99 / 8.69 | 20.4 / 38.4 |
| west-mid | 12% / 18% of the frame | 4.21 / 8.32 | 2.65 / 6.94 | 6.96 / 8.42 | 24.1 / 59.0 |
| drag-mid | 31% / 37% of the frame | 1.95 / 2.16 | 0.95 / 1.14 | 2.32 / 2.09 | 21.3 / 28.6 |

**This is not the result the idea predicted, and it needs saying plainly.** On the meter's own terms the shader walls are *worse* than the geometry at the far and middle views (err 2.73 to 5.48 and 4.21 to 8.32) and equal at the street view (1.95 to 2.16). Two cautions about the table: the meter's flag-off numbers move a lot between runs of the same page (run 1 read 2.29 and 4.06 for west-mid and drag-mid, run 2 read 4.21 and 1.95: the sky, the tile loading and the animated clouds are not frozen), so only differences of about two times mean anything; and each arm is scored against its own truth, which cannot say whether the two arms draw the same picture. The same run's saved pictures can say that (`scripts/verify/facet-meter-cross.py`): the shader's 1x frame, the geometry's 1x frame and the geometry's supersampled truth over the pixels the authored layer draws in both arms:

| view | geometry 1x vs geometry truth | **shader 1x vs geometry truth** | shader truth vs geometry truth | shader 1x vs its own truth | mean level: geometry truth / shader 1x |
|---|---:|---:|---:|---:|---|
| west-far | 2.77 | **6.59** | 3.34 | 3.76 | 94.2 / 90.8 |
| west-mid | 2.56 | **4.39** | 2.03 | 3.19 | 108.9 / 109.6 |
| drag-mid | 1.80 | **2.28** | 0.20 | 2.22 | 86.0 / 85.8 |

Reading it: at the street view the shader wall and the geometry draw the same picture at high resolution (0.20 apart), and the shader's 1x frame is still no closer to the truth than the geometry's (2.28 against 1.80). At the far view the shader's own high-resolution picture is 3.3 away from the geometry's and **3 levels darker on average** (91 against 94), so the shader walls are biased dark, not just noisy. The cause found by reading the shader against the app's: the app's window effects (the sky reflected in glass, window light at night, the wall's night ambient) switch on a whole pixel at a time, right for a cell and wrong for a pixel that is 40% window, and a curtain wall like Dobie's is 42% glass, under the 50% a threshold needs, so the reflection is never applied at 1x. The fix is in the module (the glass fraction of the pixel drives those effects continuously; commit "the glass fraction of a pixel drives window light, reflection and emission continuously") and **was not yet measured on the GPU when this was written** (the AWS run for it was queued behind other lanes). Until it is, the honest status of the in-app flag is: it draws the right pictures (0.4 to 1.9% of pixels differ, from lit windows to the frames), it removes 39.7% of the authored triangles and 129 MB of GL buffers, **and its moire score is not yet better than the geometry's: at the far view it is worse.** The lab result of section 3.4 (the shader wall 3 to 5 times better than unfiltered geometry on one isolated tower) did not carry over to the app unchanged.

**Not measured:** the page's frame time flag off against on (on the Intel chip or on the L4: the app bench takes pictures and counters, no timing); the GPU cost of the interpreter shader at the app's real pixel counts (the probe's facade-like shader is the nearest, 0.31 ns a pixel on the Intel chip); a phone.

### 8.6 How this was made, for the record

Three consults with Astra (Azure, a few cents each): one for its own idea before seeing mine (it proposed a city compiler whose output includes tested error budgets, which is what Facet became), one red-team of the Facet design (it argued a new language buys nothing over JSON: accepted, so Facet's IR is generated, not typed), and one on the built v0 (order of widening, the phone gate). The question files and its answers are under `~/flyover-mail/council/2026-10-10-gfx-*`. Every browser run was on the AWS runner (no browser was started on the Mac); because that workflow keeps one pending run per group, one of my dispatches at 08:52 UTC replaced another lane's pending run (38039374123), which that lane may need to start again.

---

**Call to action: build Facet.** One source (the recipes you already have), compiled by one tool into shader walls, baked near geometry and a quality budget a build can fail on, replacing the three copies of the facade rule the app carries today. v0 exists and works on one tower. Next: widen it to uneven floors and frame rings (16% to 60% of the catalog's windowed walls), and before that, measure the weakest phone and the Intel Mac with the probe, because 200 times fewer triangles is a result about triangles, not yet about phones.
