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

**What limits the owner's Intel chip: not measured, argued.** No browser was run on the Mac (overloaded, by instruction), so the Intel chip is unmeasured. Four pieces of other lanes' evidence (section 5) say the same thing: it is neither triangles nor pixels taken alone; on the owner's Mac in Safari the authored mesh is 22 to 35 ms of a 195 ms frame (11 to 18%), and the biggest single item is a 58 ms canvas upload. So the facade shader is worth about the geometry share on that chip plus the 82 building layers (25 ms) if the same shader takes over those walls; **it is not a 2x**. A three-second probe that would settle it is built (`probe.mjs`) and waits for the Mac to be idle.

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

**First three roadmap steps (section 6):** (1) run the probe and the lab on the Intel Mac and one phone when idle; (2) cover every plain `bays`/`flat` tower with `verify-recipe.mjs` as the gate; (3) put it behind `?facadeshader=1` with the renderer study's compare harness and the moire meter as the gate.

**The call to action (section 8, last):** build the one out-of-the-box thing the measurements point to. See there.

**What I could not measure:** anything on the Intel chip or a phone; the shader's cost on a weak chip (estimated 1 to 2 ms at 1440x900); night windows, balconies, frames; the MapLibre walls (section 7).

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
- **Not draw calls alone, on a weak chip.** The custom-renderer study (measured, Intel Iris Plus 655, shared Mac): one draw call instead of 100 gave no change in frame time for the same triangles; on the L4 it gave 3.8x.
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

- **Per pixel.** The probe's "facade-like shader" (the same cumulative functions with the derivatives) filled 16 full-screen layers of 1440x900 in 0.22 ms on the L4: 94 Gpixel/s, against 130 for a trivial shader (`probe-l4.json`). On this card the shader is not the cost. **Estimated for the Intel chip, not measured:** about 150 floating point operations a pixel, 475 thousand covered pixels at overdraw 1.4 at 1440x900 is 0.1 GFLOP a frame, against 0.85 TFLOPS peak for the Iris Plus 655 (48 units x 16 x 1.1 GHz): about 0.1 ms at peak, 1 to 2 ms at a realistic tenth of peak. At a phone's device ratio 3 and render scale 0.75 (1.67 M pixels) the same arithmetic gives 3 to 6 ms. These are arithmetic; step 1 of the roadmap replaces them with a measurement.
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

**Not measured on the Intel chip tonight.** The Mac was overloaded and the instruction was no browser on it. What exists instead is four pieces of evidence, none of them mine except the probe's method. They agree with each other, and they say something different from "the chip is slow at triangles".

1. **The architecture on paper** (Intel's Gen11 architecture paper, whose Gen9 GT2 column the research helper read; the Iris Plus 655 is Gen9.5 GT3e with 48 execution units): triangle setup 0.67 a clock for lists, 8 pixels a clock, 38.4 GB/s of memory. 3.1 M triangles is about 4.6 M clocks, **about 4 ms at 1.2 GHz** for setup (estimated, my arithmetic). Source: https://www.intel.com/content/dam/develop/external/us/en/documents/02-the-architecture-of-intel-processor-graphics-gen11-807276.pdf (opened).
2. **The same chip in Safari, measured by the speed lane's predecessor** (`docs/perf/safari-frame-floor.md`): 4.5 million triangles with a trivial shader in a blank canvas of the page's size present at 53 fps, eight full-screen fills at 50 fps. So neither triangles nor pixels, taken alone, are what fills a 195 ms frame. The real frame is 58 ms of one canvas upload, 25 ms of the 82 building layers, 22 to 35 ms of the authored mesh, and the rest passes, labels, fog and the page's own stack.
3. **The same chip in headless Chrome, measured by the custom-renderer study on the shared Mac:** the authored mesh took 51 to 102 ms with three.js and 76 to 99 ms with a one-draw renderer using 24 byte vertices instead of 56. Fewer draw calls and 2.3 times fewer vertex bytes changed nothing. That is about 20 times the architecture's setup time and about 3 times the quiet-Safari number: the difference between this and item 2 is most likely the other lanes' browsers sharing the chip that night (the study says the machine was shared and the p90 was 140 to 164 ms), but that is an inference, not a measurement.
4. **On the Acer** (`js/lod.js`, measured): 44% fewer pixels bought 1.5 fps; two fewer passes bought 6.

**What I conclude, labelled as a conclusion and not a measurement.** On the owner's chip the geometry share is real but not the biggest slice: the authored mesh is 11 to 18% of the Safari frame (22 to 35 of 195 ms). The biggest slice is one 20 MB canvas upload (58 ms, 30%) that is a synchronisation cost, not a graphics cost: a "basic" worth stating (do not copy a canvas to a texture every frame; the sky should be GL) but outside this study's scope. After that, cost scales with the number of passes and the per-pass state (82 fill-extrusion layers, 224 style layers). **So the facade shader is worth about the geometry share on that chip, 11 to 18% of the Safari frame for the authored buildings alone, plus up to the 25 ms of the 82 fill-extrusion layers if the West Campus and outer-ring walls move into the same shader. It is not a 2x.** That is the honest size of the optimism on this particular laptop.

**The measurement that would settle it** is in this PR and takes three seconds: `experiments/facade-shader/probe.mjs` measures, on whatever chip it runs on, triangles a second for sub-pixel triangles and for one-pixel triangles, the cost of the app's lighting in the vertex shader, vertex bytes (24 against 56), pixels a second for a trivial and for a facade-like shader, and prints which of "triangle bound" and "pixel bound" the app's workload would be. It ran on the L4 (section 3.5) to prove the method; on the L4 everything is under a millisecond, so it says nothing about the Intel chip. **It must be run on the 2019 laptop when nothing else is drawing.** That is roadmap step 1.

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
| 1 | 1 | **Run `probe.mjs` and `run.mjs` on the 2019 Intel Mac when it is idle**, and a probe page on one phone (`page/probe.html` needs only a browser) | the unmeasured half of this study: which of triangles, pixels or neither limits the owner's chip; the shader's real cost per pixel on it | the two JSON files; compare to the L4's | if the Intel chip's one-pixel-triangle rate is above 300 M triangles a second, geometry is not the limit and ideas 1 and 6 are worth only the memory; do steps 2 to 3 for memory, not speed |
| 2 | 2 | **Cover every authored tower whose bands are plain `bays` or `flat`:** run `extract.mjs` per building (the dump script already exists), make `verify-recipe.mjs` take a list, add the strip, `fields` and floor-line options of the `bays` skin to the shader | the share of the 3.1 M triangles that can move (this study estimates 63 to 75%; this step measures it) | `verify-recipe.mjs` over every building: counts equal, edges inside 5 mm | any building where windows predicted from the recipe differ from the geometry by more than 5 mm or in count: fix the rule, never patch the building |
| 3 | 2 | **Put it in the app behind `?facadeshader=1`:** the bake writes one quad per wall plus the pattern numbers; `js/slopes-apartments.js` emits quads instead of cells for covered bands; reveals, balconies, fins stay geometry; the shader goes into the existing `slopes.material()` | fewer built triangles, less build time, less memory (the 347 MB of arrays and 185 MB on the card shrink with the triangles); shader walls cannot shimmer | `experiments/renderer/compare.mjs` (daylight views under 1% of building pixels over tolerance), `scripts/verify/moire-meter.mjs` (err and flicker lower than today on the authored arm), frame time on the AWS L4 with the GPU timer | compare over 3% on any view: list the missing shading feature (the study found the same for the first prototype) or stop |
| 4 | 2 | Night windows: a lit/unlit room per window is a hash of (building, floor, bay): the same shader, one more line | night views stop being excluded | compare at night views | the hash disagrees with the generator's `CityNight.room` on any window |
| 5 | 2 | The other skins: `mod4` (Union on 24th: the owner's own k = (c minus r) mod 4 rule), `pixel` (The Standard), storefronts | the 2 largest buildings by triangles (2400 Nueces at 269 k, Union on San Antonio at 151 k) | `verify-recipe.mjs` for those skins | a skin whose rule is a hash per cell the shader cannot reproduce |
| 6 | 5 | **West Campus and outer-ring walls into the same shader** (they are MapLibre fill-extrusion with a pattern atlas per tile today) | the 607 MB of atlases and about 160 s of worker CPU gone; tile-anchored cross-fades gone; the largest phone-memory item | the moire meter on the MapLibre arm; texture bytes in the GL counters | if the walls cannot be drawn by a custom layer in the right depth order with MapLibre's, keep the atlases for the far field |
| 7 | 1 | Decide anti-aliasing: tent against box (section 3.4) and whether 4x MSAA is affordable on phones | the flicker number of the shader walls | the lab's flicker column | none |

First three steps for the lead: 1 (measure the Intel chip), 2 (cover the plain towers), 3 (put it behind a flag with the compare harness as the gate).


## 7. What I could not measure

- **Anything on the Intel Iris Plus 655 or a phone.** No browser was started on the Mac (overloaded, by instruction) and no phone was reachable. Every frame time here is the L4's. The probe is built and ready for the Mac.
- **The Intel chip's real limiter.** Section 5 argues from four pieces of other lanes' evidence; the probe on a quiet Mac would replace the argument.
- **The cost of the shader on a weak chip.** The L4 number is in section 3.5; the Intel number there is an estimate from peak arithmetic throughput (30.3 against 0.85 TFLOPS), not a measurement.
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

**What Astra's attack changed (checked against my numbers).** (1) The gate is not "the shader is exact": the measured shader wall is 1.1 to 2.0 times the error of 4x MSAA on geometry, so the gate is a ratio and the budget decides, per wall, where geometry or MSAA stays. (2) Layer-by-layer averaging is not the average of the composite where layers overlap; v0 admits only skins whose layers are disjoint and says so. (3) A pixel footprint on a rotated wall is not separable; the shader uses the moment-matched box (it measured better than the sum of derivatives and no worse than a tent). (4) A CPU oracle that shares the compiler's logic can share its bugs: truth stays the app's own generated geometry (`verify-recipe.mjs`), never the compiler's own evaluator. (5) The 82 MapLibre fill-extrusion layers cannot run this shader at all: step 6 of the roadmap needs those walls in a custom layer, which is its own project and is not claimed here. (6) A switch between geometry and shader can pop; the budget's switch distance is chosen where the two agree (the lab measures their disagreement: 0.7 levels at 55 m, 1.1 at 110 m).

**The smallest first version (built in this branch, stacked on the study; see below):** one real tower (Dobie Twenty21), one source (its recipe), compiled by Facet into generated GLSL and a baked wall package, drawn by the lab from the generated shader, scored by the same automated compare and moire score, with a distance sweep, a hybrid geometry-near / shader-far arm and the budget file.

**What could make it fail:** oblique views and reveal visibility the parallax shift cannot show; the representation switch popping; an Intel chip or phone where the fragment cost or the memory is not what the arithmetic says (the probe decides, step 1); or skins that turn out to be mostly the ones Facet cannot express (the budget will show the share).
