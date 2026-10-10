# Custom renderer study, 2026-10-09

A study, with a working prototype and an automated test, of replacing the general frameworks (MapLibre GL JS 5.24 and three.js r159) with a renderer written for exactly this app. Written with optimism, as asked: the question throughout is "what could work", with the costs written next to the gains.

Branch `mac/custom-renderer-study`. Code and commands: `experiments/renderer/` (README there). Pictures and the big binaries are in `~/flyover-private/renderer-2026-10-09/`, not in the repo. Nothing in `js/`, `index.html`, `HANDOFF.md` or the journal was touched; the site does not load any of this.

**How to read the numbers.** Every number says how it was taken:
- **measured** means this study measured it, with the setting named beside it.
- **estimated** means worked out from measured numbers or from a source, not run.
- **software** means SwiftShader (a CPU rasteriser): valid for pictures and for counting GL calls, NOT valid for frame time. No frame time in this document comes from software rendering.
- Frame times come from two real GPUs: the AWS runner's NVIDIA L4 ("L4", Chrome, vsync off, 1280x800) and this Mac's Intel Iris Plus 655 ("Mac iGPU", Chrome, vsync off, 1280x800, the machine shared with other lanes, so noisier). The owner was away (idle over 10 minutes) for the Mac runs.
- The app measured is `main` at `7c0a280` (PR #426, 2026-10-09): Chrome 155 headless, `index.html?intro=0&drift=0&namelabels=0`, graphics auto-detect cancelled.
- **MB** in this document are mebibytes (1,048,576 bytes), as the repo's other memory notes use them.
- Other lanes' numbers are cited by name: `flyover-speed` (`docs/speed-2026-10-09.md`, a first draft, one sample each) and the repo's own `docs/perf/*`.

## 1. The short answer

**What could work, in one paragraph.** The authored buildings are 3.1 million triangles that today are built in JavaScript at every page load (7 to 9 s on the AWS server CPU, 20 to 47 s on this shared Mac; measured), held as 347 MB of arrays, uploaded, and drawn by three.js in about 100 draw calls beside MapLibre's 800 to 1,400. A renderer for one fixed city would bake those buildings once into a binary file, load it in under four seconds on this busy Mac (6.2 MB on the wire with meshopt and brotli, measured end to end with the real decoder: 3.9 s from navigation to the first drawn frame, download excluded), hold half the memory (185 MB against 347 MB, measured), draw it in one multi-draw call, and recover from a lost graphics context by re-uploading instead of reloading the page. The prototype in this PR does the draw half of that and a script proves, from ten fixed cameras, how close its pictures are to the real app's. On the ten fixed cameras the prototype's daylight pictures differ from the app's in 0.15% of building pixels (identical silhouettes, SSIM 0.997), the same script catches three deliberately broken versions, and it flags the night views as not yet ported.

**What the study found that changes the question.**
1. Most of what the frameworks cost is not the frameworks' code. It is how this app uses them: 82 fill-extrusion layers (a draw pass each, 790 to 1,400 draw calls and 8,600 to 15,000 GL calls a frame, measured), per-tile pattern atlases for windows (607 of 690 MB of textures at city ready in the speed study), and a 7 to 47 second JavaScript geometry build. Baking and a window shader would remove those with or without replacing MapLibre.
2. **The bake is worth doing first and is independent of the renderer decision.** Roadmap steps 1 to 3 (five days) do not need a new renderer at all.
3. **How much frame time a new renderer buys depends on the card.** On the L4 the isolated authored scene (3.1 million triangles) takes 3.81 ms in three.js and 1.01 ms in the prototype, 3.8 times faster, about a quarter of a 9 to 11.5 ms frame (measured). On the Mac's Intel iGPU it takes 51 to 102 ms with three.js and 76 to 99 ms with the prototype: no difference within the noise of a shared machine (measured). A weak card is limited by the triangles and pixels, not by the API; level of detail and culling baked into the file are what cut that. The renderer matters most for load, memory and moire, and for frame time on strong and middle cards.
4. WebGPU cannot be added to a MapLibre page: MapLibre has no WebGPU path, so path C implies path B.

**Recommendation.** Do roadmap steps 1 to 3 now. They pay for themselves, they build the safety net the owner asked for, and they produce the baked file every later path needs. Decide on step 4 (the raw layer) with the numbers from step 3 in hand. Do not start path B or C yet; section 6 says why and what would change that.


## 2. What the frameworks cost us today

Instrument: `experiments/renderer/measure-app.mjs`. It loads the real `index.html` (`?intro=0&drift=0&namelabels=0`), patches every WebGL call before any app script runs (calls counted per frame, by canvas and by who is drawing: MapLibre or the three.js layer), cancels the graphics auto-detect, and reads steady frames at the ten cameras in `scripts/verify/ci/poses.json`. Two arms: `full` (the page as shipped) and `noslopes` (`?slopes=0`: no three.js layer at all, so the authored buildings fall back to MapLibre's flat prisms; this is NOT a clean "MapLibre only" arm, see the note under 2.3). 1280x800, device pixel ratio 1.

### 2.1 What one frame takes

Measured on the AWS L4 (hardware GL, `full` arm, the GL-call counters on, one steady frame per view; raw JSON in the PR's run artifacts):

| view | MapLibre draw calls | MapLibre triangles | three.js draw calls | three.js triangles | all GL calls | programs used | render targets bound | uniform calls | state-change calls |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| spawn-day | 1,351 | 2.61 M | 108 | 3.52 M | 15,362 | 37 | 3 | 6,584 | 1,231 |
| tower-day | 1,239 | 2.28 M | 70 | 1.56 M | 14,460 | 36 | 3 | 6,159 | 1,082 |
| drag-street-day | 790 | 1.61 M | 74 | 2.69 M | 9,042 | 33 | 3 | 3,878 | 844 |
| west-campus-day | 1,189 | 2.32 M | 92 | 3.82 M | 12,931 | 33 | 3 | 5,542 | 1,139 |
| stadium-day | 1,213 | 1.54 M | 43 | 0.85 M | 12,859 | 36 | 3 | 5,624 | 1,170 |
| capitol-day | 1,265 | 2.27 M | 80 | 1.74 M | 13,420 | 37 | 3 | 5,847 | 1,192 |
| downtown-day | 984 | 2.24 M | 103 | 3.99 M | 10,378 | 37 | 3 | 4,563 | 1,071 |

(Ten views were measured; the night and golden-hour views of the same cameras differ by under 5%.) Reading it:
- A frame is **800 to 1,500 draw calls, 8,600 to 15,400 GL calls, 33 to 41 shader programs and three render targets** (the two sun shadow maps and the picture). MapLibre owns 90 to 97% of the draw calls and 94 to 98% of the GL calls. The three.js layer is 3 to 10% of the draw calls but 35 to 65% of the triangles the two submit together.
- The same count on Safari on the owner's Intel Mac, from `docs/perf/safari-frame-floor.md` (Oct 4, a different build, measured there with a call wrapper): about 13,360 GL calls a frame. The two numbers agree.
- **82 of the page's 224 style layers are fill-extrusion** (76 are lines, 33 symbols, 23 fills, 7 circles; 34 sources: 27 GeoJSON, 6 vector, 1 raster; measured from `map.getStyle()`, and 81 fill-extrusion layers are visible at the campus view). Every visible layer is a pass whether or not anything in it is big enough to see. `js/lod.js` records the experiment that found this: dropping two passes was worth +6 fps and beat a 0.75 render scale, and it records that per-feature distance culling "is not expressible in this stack" (MapLibre 5.24 accepts `within` on a fill-extrusion layer and then draws nothing).
- The fill-extrusion window patterns are anchored to the tile, not the world, so a grid cross-fades between zoom levels while the camera moves; `js/app.js` (lines 693 to 723) caps every patterned source at zoom 16 as the workaround for a defect the owner reported as "most of the vision is a blur between the states". A shader-drawn window pattern is anchored to the wall by construction.

**Frame time.** One steady frame, the whole page, 1280x800, vsync off, the frame ended by reading one pixel back so the card has really finished (40 frames, the first 5 dropped, the GL-call counters muted). Minimum / median in ms, `full` (as shipped) against `noslopes` (`?slopes=0`, a different scene: see the note under 2.3):

| view | Mac iGPU `full` | Mac iGPU `noslopes` | L4 `full` | L4 `noslopes` |
|---|---|---|---|---|
| spawn-day | 93.3 / 121.6 | 53.9 / 80.7 | 11.2 / 11.5 | 7.0 / 7.2 |
| west-campus-day | 92.1 / 124.3 | 52.6 / 78.6 | 10.1 / 10.5 | 6.6 / 7.0 |
| downtown-day | 87.7 / 114.3 | 44.1 / 75.4 | 8.8 / 9.3 | 5.9 / 6.3 |

On the Mac iGPU the authored layer and what it displaces is about 40 to 46 ms of 114 to 124 (35%); on the L4 about 3 to 4 ms of 9 to 11.5 (30 to 37%). The Mac figures are from a machine shared with other helpers: the p90 is 140 to 164 ms. Both machines are far from the owner's Safari figure of 195 ms at a 3840x2040 canvas (`docs/perf/safari-frame-floor.md`), which is a larger canvas and a browser that does not overlap script with the card.

### 2.2 What MapLibre does every frame that this app does not need

From MapLibre's source (read by the research helper, opened): `Style.update` recalculates every style layer every frame (224 here), the painter rebuilds three tile-coordinate lists and runs an opaque pass top to bottom and a translucent pass bottom to top, and symbol placement re-runs whenever the matrix changes (the camera moves every frame in a flight). What of that this app uses: little. 27 of its 34 sources are GeoJSON that the app itself bakes and hands over whole, MapLibre then re-tiles them in workers (geojson-vt) and builds a pattern atlas per tile; the buildings' heights, colours and window patterns are all decided offline, yet colour ramps by the hour are style expressions (for example `['interpolate', ['linear'], p, ...]` in `js/slopes.js`) that MapLibre evaluates per feature on every hour change, for data that is already known per hour. Labels are 33 symbol layers (7 visible at the campus view); the app's own `js/name-labels.js` already decides which names show from its own timing (the CI pictures switch it off, `?namelabels=0`, because two loads of the same page differed by up to 5.8% of a view).

What the sampling profile says (V8 profiler, a 12 s camera orbit at the spawn view; `byFilePct`; the Mac iGPU run, counters muted): main-thread time is **68% waiting (native, idle, garbage collector), 23.5% MapLibre, 5.4% three.js, about 3% all of the app's own files together** (`js/city-lighting.js` 1.0%, `js/facades.js` 0.5%, `js/sky.js` 0.4%, `js/slopes-apartments.js` 0.3%). With the three.js layer off, MapLibre rises to 39% and waiting falls to 59% (the prisms replace the authored buildings, so MapLibre draws more). Reading: on this GPU the main thread mostly waits for the card; what it does do is MapLibre's. The August profile on the Acer (`docs/perf/measured.md`, contended machine, so shares only) had MapLibre's render subtree at 56 to 64% of main-thread time and facade atlas image work at 15 to 20%. Minified function names make a finer split impossible without a source-map build of MapLibre; that is a thing not measured.

### 2.3 What three.js adds

- **Per-frame JavaScript.** The layer's own `render()` (set up about 70 uniforms, the two shadow-map updates, then `renderer.render`) took **1.2 to 1.4 ms a frame on the L4 server CPU and 3.0 to 3.5 ms on this Mac** (measured, steady frames, counters muted on the Mac, on in the L4 run). That is small. The prototype's whole CPU submit is **0.13 ms** (measured, section 7).
- **108 draw calls and 650 GL calls for the layer** at the spawn view against one multi-draw and about 30 GL calls for the prototype's identical triangles (measured; the app's own culling already merges the 198 buildings into 1 to 22 draws in the isolated test, so the 108 includes the shadow passes and the non-apartment groups: roofs, arches, dome, art, stadium).
- **Memory: the layer's geometry is the biggest buffer in the page.** 105 meshes, 4.09 M triangles, **483.6 MB of CPU arrays** held after upload on desktop (measured; the repo's `js/geometry-memory.js` then packs the colour attributes, which the desktop memory report measured at about 310 MB saved), plus the same bytes on the card. GL buffers at city ready: **554 MB, of which MapLibre about 64 to 91 MB** (the `noslopes` arm) and the rest the authored buildings. The speed study measured 484 MB for the same item. Of the 347 MB of arrays for the 198 apartment buildings, aSurface (four floats a vertex, used only by the procedural surface detail) is 99.6 MB, positions 74.7 MB, normals 74.7 MB, the three colour triples 56.1 MB, indices 35.7 MB, the facet flag 6.2 MB.
- **Context loss on a phone is unrecoverable without a reload** (`docs/geometry-memory.md`, `js/mobile.js`): vertex arrays are dropped after upload to save memory, so a restored context has nothing to upload. A baked buffer that is kept compressed (6 MB) and decoded again turns that into a one-second recovery.

Note on the `noslopes` arm: with `?slopes=0` the authored buildings are replaced by MapLibre prisms, so MapLibre draws about 400 more calls and 0.4 to 0.6 M more triangles than in `full`. The difference between the arms is "the authored layer plus what it displaces", not three.js alone.

### 2.4 Bytes and parse

| | raw | gzip -9 | brotli -9 | parse (min of 9 loads, this Mac, 1x / 4x CPU throttle) |
|---|---:|---:|---:|---|
| `maplibre-gl.js` 5.24.0 | 1,056,837 B | 275,161 B | 247,104 B | 56 ms / 190 ms |
| `maplibre-gl.css` | 70,024 B | 10,078 B | 8,996 B | |
| `three.min.js` r159 | 668,024 B | 165,855 B | 147,000 B | 41 ms / 243 ms (noisy) |
| `pmtiles.js` 3.0.6 | 48,555 B | 11,529 B | 11,055 B | 8 ms / 34 ms |
| the two frameworks together | 1,724,861 B | 441,016 B | 394,104 B | about 100 ms / 430 ms (both together, plus pmtiles 8 ms / 34 ms) |
| the app's own 51 scripts | 3,536,520 B | 1,212,174 B | | not measured |

(Measured off the files; parse is from the end of the response to the script's `load` event, so it includes compile and the top-level run. 4x is Chrome's CPU throttle, a stand-in for a mid-range phone, not a phone.) **The frameworks are a third of the JavaScript bytes (1,773,416 of 5,309,936 bytes raw, pmtiles included) and under 1% of the load time** on any machine measured (about 105 ms of parse against 20 to 100 s of load); the app's own code is the larger part. The wire total of a cold load is 48 MB, 41 MB of it data JSON (speed study, `serve.py`, uncompressed; about 6.4 MB gzip). Replacing the frameworks is therefore a poor way to win bytes or parse time; baking the data is a good one.

### 2.5 Memory held

| | desktop, campus view, city ready | source |
|---|---|---|
| JS heap | 153 to 248 MB | measured, Mac runs; 185 MB on the L4 |
| GL buffers | 554 MB (authored buildings about 484 MB, MapLibre 64 to 91 MB) | measured, call counters |
| GL textures | 106 MB counted at rest at the campus view; **690 MB, of which 607 MB the facade pattern atlases, after the opening flight** | measured here at rest; speed study after the flight (one sample) |
| CPU arrays of the authored buildings | 483.6 MB (347 MB for the apartments alone) | measured |
| the page, before the colour packing of PR #354 | 884 to 901 MiB backing store; 564 to 573 MiB after | `docs/desktop-memory-finish-report.md` |

### 2.6 What runs out first on a phone

Memory, then fill rate; draw calls are not the limit. This is from the repo's own record, not from a phone measured here: `js/mobile.js` documents the tab being killed at about 1.3 GB at city ready and 2.0 GB twelve seconds later (Sep 24), "a facade pattern atlas of up to 30 MB" on every tile of the opening flight with about 30 tiles kept by MapLibre; Sep 30's flight peak was 0.9 to 1.0 GB. WebKit gives no warning and no per-tab figure (WebKit bug 300782). The two items that are the framework's fit, not the app's content, are the **per-tile pattern atlases** and the **second copy of geometry**; a world-anchored window shader plus one baked buffer would remove both. After memory comes fill rate at device pixel ratio 3, which no renderer choice changes.

## 3. What others found (outside evidence)

Every row is something a source says, with the link. "Opened" means the page was read in full; "snippet" means only the search result text was seen. Where a source gives no number, none is claimed.

### 3.1 Purpose-built renderers against general ones

| Who | What they did | What it gained | Source |
|---|---|---|---|
| Felt | Wrote its own renderer on Protomaps-JS: fewer GL state changes, batched draw calls | Base map render time down 20%, data render time down 55% on average (no absolute figures). They later moved to MapLibre for smooth zoom and the ecosystem, and published no numbers for that move. | https://felt.com/blog/map-computer-graphics and https://felt.com/blog/maplibre-rendering-engine (opened) |
| deck.gl | Layers fed by binary attributes instead of JS objects | Accessors are "99% of the CPU time" when buffers update; basic layers hold 60 fps to about a million items. Its WebGPU path is "not production ready" and cannot yet share a base map. | https://deck.gl/docs/developer-guide/performance and https://deck.gl/docs/developer-guide/webgpu (opened) |
| Google Maps WebGL Overlay | Your GL code shares the base map's context and depth | You must reset GL state afterwards or both the map and your objects can fail to draw. No performance figures. | https://developers.google.com/maps/documentation/javascript/webgl/webgl-overlay-view (opened) |
| Cesium / 3D Tiles | Hierarchical LOD: each tile carries a geometric error in metres, the client picks by screen error | The standard way a whole city is streamed. Quantised vertex attributes: one model 1,872 KB to 988 KB raw (-47%); a Washington D.C. set 367 to 318 MB raw (-13%) and 85.5 to 75.4 MB gzipped (-12%). | https://github.com/CesiumGS/3d-tiles/tree/main/specification and https://cesium.com/blog/2016/08/08/cesium-web3d-quantized-attributes/ (opened) |
| Streets GL | A whole OSM city on its own WebGL2 frame graph (deferred, TAA, SSAO) | Shows it can be done by one person; says a modern discrete GPU is likely needed. No numbers. | https://github.com/StrandedKitty/streets-gl (opened) |
| MapLibre itself | A general engine | Every frame it recalculates every style layer, rebuilds three tile lists, and runs an opaque then a translucent pass; symbol placement is incremental but reruns when the matrix changes. Mapbox's own guidance: render time is about a constant plus sources plus layers plus vertices, and merging layers that share type, source and filter helps. Nobody has published a MapLibre benchmark that isolates layer count or symbol placement. | https://raw.githubusercontent.com/maplibre/maplibre-gl-js/main/src/style/style.ts and .../render/painter.ts, https://docs.mapbox.com/help/troubleshooting/mapbox-gl-js-performance.md (opened) |
| F4map, OSM Buildings, Mapbox Standard, Overture | | No published frame time, byte or memory figure from going custom was found. | (searched, nothing to cite) |

Not found: any web app that publishes the gain from a renderer built for one fixed city. Felt is the closest and it is a general map renderer.

### 3.2 Getting geometry to the card

- **meshoptimizer** decodes at about 1 GB/s in WebAssembly per the extension proposal; the project says 3 to 6 GB/s on modern desktop CPUs. Against Draco: a 300k-triangle model decodes in about 7.5 ms against 186 ms, a 6M-triangle one in 196 ms against 7.63 s. Draco sends slightly fewer bytes, meshopt decodes 20 to 40 times faster. Vertex data is typically 2 to 4 times smaller than already-quantised data; indices cost about 1 to 1.2 bytes a triangle. https://github.com/KhronosGroup/glTF/pull/1830 and https://github.com/zeux/meshoptimizer (opened). gltfpack uses `KHR_mesh_quantization` by default (three.js reads it since r111): https://meshoptimizer.org/gltf/.
- **One big static buffer with multi-draw (WebGL2).** `WEBGL_multi_draw` is reported on 92.6% of tested browsers: iOS 99.98%, Android 95.9%, macOS 95.0%, Windows 92.0%, Linux 62.6%. The base-vertex variant is on 0.18% (Chromium only), so bake absolute indices into one buffer and use plain `multiDrawElements`. https://web3dsurvey.com/webgl/extensions/WEBGL_multi_draw (opened, a survey of visitors, not the whole web).
- **WebGPU indirect draws.** Core WebGPU has only `drawIndirect` and `drawIndexedIndirect`. Multi-draw-indirect is a Chromium experimental feature behind a flag; the standards proposal is reportedly idle (unverified). https://toji.dev/webgpu-best-practices/indirect-draws and https://developer.chrome.com/blog/new-in-webgpu-131 (opened). So a GPU-driven design that relies on it would be Chrome-only today.
- **GPU-driven rendering in a shipped game.** Assassin's Creed Unity cut the city into 64-triangle clusters and culled on the GPU: draw calls down one to two orders of magnitude and 20 to 40% of triangles culled (30 to 80% for shadows), but the slide text puts the overall geometry gain under 10%. The win was submission cost, not triangles. Text mirror (the original deck could not be rendered): https://pdf4pro.com/view/gpu-driven-rendering-pipelines-7a5c90.html; original https://advances.realtimerendering.com/s2015/aaltonenhaar_siggraph2015_combined_final_footer_220dpi.pdf.
- **Nanite-style on the web.** One WebGPU demo draws 640 million to 1.7 billion triangles with a software rasteriser, but needs Chrome, packs depth to 16 bits and publishes no frame times. https://github.com/Scthe/nanite-webgpu (opened). On phones, Arm measured a 634k-face scene going from 5 fps to 38 fps with Nanite on a Mali-G925: https://developer.arm.com/community/arm-community-blogs/b/mobile-graphics-and-gaming-blog/posts/mori-to-nanite-billions-of-triangles-on-mobile (opened). Nothing here is a fit for a 2.5 million triangle city: it is a technique for hundreds of times more.

### 3.3 WebGPU against WebGL2, October 2026

- **Support.** 87.8% of global usage. iOS Safari: full from 26.0 (17.4 to 18.7 have it off by default). Chrome on Android since 121 on Android 12+ with ARM, Qualcomm and Intel GPUs. Firefox on Android: off by default. https://caniuse.com/webgpu and https://github.com/gpuweb/gpuweb/wiki/Implementation-Status (opened).
- **It is not a free speed-up for draw-bound scenes.** One author's per-draw-call CPU cost, Chrome 154, 2026-10-01 (microseconds per draw, WebGL2 against WebGPU): PlayCanvas macOS 0.75 / 0.43, Windows 1.66 / 1.22, Android 2.16 / 1.63 (WebGPU faster); three.js r186 macOS 0.89 / 2.10, Windows 2.10 / 4.68, Android 2.43 / 5.66; Babylon 9.29 macOS 2.35 / 4.40. So for the two general engines WebGPU costs 1.5 to 2.4 times more CPU per draw. The same author's startup to first frame: about 100 ms for three.js and PlayCanvas, 330 ms for Babylon. The author appears to work on PlayCanvas. https://github.com/mvaligursky/web-engines-compare and https://github.com/mvaligursky/webgpu-webgl-benchmarks (opened).
- **wgpu (Rust) on the web.** No current verified bundle size for a minimal app. A 2021 maintainer discussion shows about 2 MB before trimming and says it depends on which backends are built. https://github.com/gfx-rs/wgpu/discussions/2278 (opened, old). The separate Rust/WebAssembly study (`~/Projects/flyover-rust`) owns this question.

### 3.4 How games draw a dense city

- **Temporal anti-aliasing.** Karis's SIGGRAPH 2014 talk is the reference: jitter the projection each frame, blend with a reprojected history. That it also removes window-grid shimmer is the standard understanding (a sub-pixel pattern that flickers frame to frame is exactly what the history average smooths), but the slides could not be read here. https://advances.realtimerendering.com/s2014/index.html (listed, unread).
- **Filtering repeating patterns.** Toksvig, LEAN and CLEAN are the three published ways to keep a shiny, finely detailed surface from sparkling at a distance; LEAN needs at least eight times the storage of a compressed normal map. https://blog.selfshadow.com/2011/07/22/specular-showdown/ (opened). This app already fades its own brick joints and window detail by `fwidth` in the shader, which is the cheap member of the same family.
- **Shadow shimmer.** Snap the shadow map's bounds to whole texels as the camera moves, and use fixed cascade intervals. https://learn.microsoft.com/en-us/windows/win32/dxtecharts/common-techniques-to-improve-shadow-depth-maps (opened). The app already does this (`shadowSnap`).
- **A cautionary city.** Cities: Skylines 2 spent about 90 ms a frame on an RTX 3080 with frustum culling only, no occlusion culling, many objects without LODs, and about half of render time on shadows. https://hothardware.com/news/cities-skylines-2-autopsy (opened).

### 3.5 What a renderer for ONE fixed city can assume

Unreal's precomputed visibility volumes store, per cell, which objects can be seen; they trade runtime memory and build time for less rendering-thread work, only count static shadow-casting geometry, and handle translucent and streamed content poorly. https://dev.epicgames.com/documentation/en-us/unreal-engine/precomputed-visibility-volumes-in-unreal-engine (opened). Wonka and others pruned over 99% of an 8-million-polygon Vienna model this way (snippet only). No web or game source was found that reports frame time, byte or memory gains from a one-city design as such. What follows in section 5 is therefore an engineering argument, tested by the prototype, not a citation.

### 3.6 Phone memory

- Apple publishes no per-tab WebGL limit. WebKit bug 300782 (filed 2025-10-15, still open): texture-heavy pages are killed under memory pressure and reload in a loop, with no error and no `webglcontextlost` before the kill. https://bugs.webkit.org/show_bug.cgi?id=300782 (opened).
- A third-party estimate (explicitly not from source): iPhone 8/X about 300 to 350 MB, iPhone 13/14 about 400 to 450 MB, iPhone 15 and later about 1 GB. https://www.catchmetrics.io/blog/deep-dive-ram-internals-webkit (opened). Use it as a direction, not a limit.
- No official Chrome Android GPU-memory figure was found.

### 3.7 Arguments against, from the same sources

1. Felt went the other way (custom to MapLibre). Maintenance is the real price.
2. MapLibre already does the opaque/translucent split, shares one depth buffer with custom layers and handles context loss; a custom layer can get most of the draw-call benefit without leaving it.
3. WebGPU is not faster per draw for the general engines (3.3).
4. Multi-draw-indirect is not standard WebGPU (3.2).
5. iOS memory has no documented ceiling and no warning (3.6): memory budgeting, not draw calls, is the phone constraint, and it is also the thing a baked buffer helps most.
6. GPU-driven culling's measured geometry gain was under 10% in the one shipped game that published it (3.2).
7. Search results list MapLibre versions past 6.x (6.12.0 named, unread); this app pins 5.24.0. Re-check what changed in fill-extrusion and symbol work before assuming today's costs are still the costs.

## 4. What a renderer for ONE fixed city can assume, and a framework cannot

A framework has to be right for every scene a stranger might build. This app draws exactly one scene. That lets a renderer written for it take decisions in the bake that a framework has to take every frame.

| Assumption | What a framework does instead | What it buys here |
|---|---|---|
| **Geometry is static and known before the page loads.** Bake it offline into a few binary buffers. | Builds geometry in JavaScript at load (here: `js/slopes-apartments.js` builds about 2.5 million triangles on the main thread under the loading veil, from 19 MB of source JSON), keeps CPU arrays for picking, and copies to the card. | Load time (no build), peak memory (no builder temporaries), context-loss recovery (re-upload from one cached buffer, no reload). |
| **One vertex layout, one program per pass.** | A scene graph of objects, each with its own material, uniforms and draw call; a generic material system that compiles variants. | One state setup per pass; the draw-call count is the number of visible runs, or one with multi-draw. |
| **The camera range is known.** The app flies between about 1.7 m (walking) and a few km. | Generic near/far, generic LOD hooks. | Quantisation can be chosen for the range (positions to 1 cm inside a building's own box); LOD distances are constants and the chain is baked. |
| **The sun's path is known** (the app already has a fixed time-of-day track). | A general shadow system re-renders casters every time anything moves. | Shadow maps for static geometry can be redrawn only when the sun or the snapped camera cell changes (the app does this already; a custom renderer can also bake the sun-independent part: ambient occlusion, per-cell sky visibility). |
| **Visibility can be precomputed.** Cells of the city, each with the list of buildings that can be seen from it. | Per-frame frustum tests against bounding volumes, and a depth pre-pass if you ask for one. | Fewer triangles and fewer draw ranges on the city's dense streets; the cost is bake time and one table. Only static casters count, so it applies to the authored buildings, not to moving things. |
| **One pass order.** Ground, then opaque buildings front to back, then glass and trees, then sky and fog. | A sorted render list that is rebuilt every frame (MapLibre rebuilds three tile lists and runs an opaque pass and a translucent pass). | The order is code, not data. Depth pre-pass and early-z for the heavy fragment shader become possible. |
| **A fixed, small material set** (brick, stone, glass, concrete, roof tile, roof flat, shop glass, aged concrete: `APARTMENTS.materials` already enumerates them). | A generic PBR or custom-shader path with per-object uniforms. | Materials are a number in the vertex and a row in a table; surface detail is one fragment path. Windows can be an analytic pattern in the shader with mip-aware filtering, instead of an image atlas per tile. |
| **Windows repeat.** | Either geometry per window (this app's apartment generator) or an image pattern per tile (MapLibre `fill-extrusion-pattern`, with an atlas per tile, up to 30 MB each on a phone). | Instanced or procedural windows with a shared texture array: one texture for the whole city instead of one atlas per tile. This is the largest single phone-memory item found in the repo's own notes (`js/mobile.js` header). |
| **Precomputed LOD chains** for every authored building (and impostors for the far ones). | Not available; general engines assume the content author did it. | Distant buildings cost a fraction of the triangles. The app today draws the same mesh at 4 km as at 40 m, culled only by the frustum. |

What it cannot assume: that the map stays the same. Every new building, every new area (Riverside is already an on-demand area) and every edit to a building's recipe must go through the bake. That is the cost the automated test in section 7 exists to make safe.

## 5. The design, optimistic and concrete

### 5.1 The data format (all three paths)

One binary per area (the core, Riverside, any later area), made by a bake step that runs the existing generators once, offline, instead of in every visitor's browser:

```
header (json, ~1 KB)  : counts, bounds, origin, material table, chunk table offset
chunk table           : per building (a "chunk"): bounding sphere (4 floats), index range (2 ints),
                        position scale + centre (4 floats), LOD ladder (3 index ranges), cell ids
vertex stream A       : 8 B/vertex  int16 x,y,z + uint16 chunk id        <- the only stream a shadow pass reads
vertex stream B       : 16 B/vertex int8 normal + facet flag, 3 x uint8 colours (day, golden, night)
                        with gradient, and the material kind                <- main pass only
indices               : uint32 (uint16 when a building has < 65,536 vertices)
```

Everything is then meshopt-encoded (vertex and index codecs) and brotli-compressed on the wire; the page decodes it with the 6 KB meshopt WebAssembly decoder into the typed arrays it uploads. The prototype's file in this PR has exactly this shape (24 bytes a vertex in one interleaved stream; splitting position into its own stream is one change, listed in the roadmap).

### 5.2 Draw strategy

| | WebGL2 (works on every phone and desktop in use) | WebGPU (iOS Safari 26+, Chrome, 88% of users) |
|---|---|---|
| Main pass | one VAO, one program; CPU culls the per-building spheres and issues `multiDrawElementsWEBGL` over the visible runs (92.6% of browsers; the loop of `drawElements` over merged runs is the fallback and is also measured) | one render bundle per LOD and cell, replayed; `drawIndexedIndirect` with a compute shader writing the visible list (no multi-draw-indirect in the standard) |
| Shadow pass | same buffers, stream A only (8 B a vertex instead of about 60), two cascades, redrawn only when the snapped sun cell changes, as today | same, with a depth-only pipeline |
| Culling | CPU spheres now; per-cell visible lists (baked) later | compute |
| LOD | three baked index ranges per building plus one impostor box per building for the far field | same |

### 5.3 Lighting and shadows

Time of day, shadows and night windows survive unchanged because the colours are already three baked triples (day, golden, night) blended in the vertex shader by one uniform; the sun and the two-cascade shadow maps are already custom code on three.js's render targets and would be re-plumbed onto raw framebuffers (about 300 lines). The fragment shader is already plain GLSL strings (`CityLighting.glsl`, `WallPatterns.glsl`, `RoofTiles.glsl` in the repo); they move over as they are.

### 5.4 Map basics (ground, roads, labels)

Kept in path A (MapLibre draws them; they are not the cost, see section 2). In path B they must be rebuilt: ground and roads baked into meshes from `data/ground.geojson` (5.2 MB) and `data/tiles/roads.pmtiles` (2.0 MB), trees as instanced billboards from `trees.pmtiles` (5.8 MB), and labels need a signed-distance-field glyph atlas, collision and a place-name pass. Labels are the part nobody enjoys writing and the reason Felt went back to MapLibre.

### 5.5 A smaller format, from what the dump showed

The app's 3,116,469 triangles use 6,529,189 vertices: 2.09 vertices a triangle, i.e. almost everything is a separate quad (`js/slopes-apartments.js` emits one quad per face cell, by design, so nothing overlaps and nothing z-fights). Every vertex of a quad repeats the same normal, the same three colours and the same material. A quad format stores a quad once: corner (int16 x3 relative to the building and a building id, 8 B), two edge vectors (int16 x3 each, 12 B), the three colour triples (12 B), material and flags (2 B): about 34 B a quad against 96 B for four 24-byte vertices, and the normal is the cross product of the edges. Drawn as instanced quads (`drawElementsInstanced` with a four-vertex template). **Estimated** 1.56 million quads x 34 B = about 53 MB, against 185 MB for the prototype's format and 347 MB today, with the shadow pass reading only corners and edges. Not built: it changes the vertex shader and is roadmap step 3's second half.

## 6. The three paths

All numbers in the "expected" columns are **estimated** from the measured ones in sections 2 and 7 unless marked measured. Effort is working days for one person who knows the code, including the automated tests, not calendar time.

### Path A: keep MapLibre for ground, roads and labels; replace three.js with a thin raw-WebGL layer inside a MapLibre custom layer

What it is: the prototype in this PR (`proto/renderer.js`, `makeMapLibreLayer`), grown to the full look, fed by the baked buffer. MapLibre keeps the camera, the ground, the roads, the trees, the labels, the fog and the sky; the authored buildings (and then roofs, arches, dome, art, stadium, campus landscape) draw from one baked buffer through one program.

| | today | path A, expected |
|---|---|---|
| Frame time, strong GPU (L4) | measured 9 to 11.5 ms (section 2.1) of which the authored layer and what it displaces about 3 to 4 ms | the isolated authored scene measured 3.81 ms (three.js) against 1.01 ms (prototype): **about 2.8 ms saved of 9 to 11.5**, plus 1 ms of CPU; the shadow pass would read a seventh of the bytes (estimated) |
| Frame time, weak GPU (Mac iGPU) | measured 114 to 124 ms, of which the authored layer and what it displaces about 40 to 46 ms | **unchanged by the renderer** (measured: app 67 to 102 ms, prototype 76 to 82 ms for the same triangles, section 7). Gains only from fewer triangles: baked LOD and cell culling, estimated 30 to 50% fewer at the far poses |
| Load (authored buildings ready) | measured 7 to 9 s (AWS server CPU) and 20 to 47 s (shared Mac) of JavaScript build, under the loading veil | **measured 3.9 s** navigation to first frame on the Mac plus the download (1 to 2.6 s at 50 to 20 Mbit/s); decode 1.1 s and upload 1.3 s of it, both of which a faster machine shortens (on a phone, decode about 4x: estimated 4 to 5 s) |
| Memory, authored geometry | 347 MB arrays + the same on the card for the apartments; 484 MB for all groups | 185 MB on the card (measured, 24-byte vertex), CPU copy dropped after upload, compressed copy 6 MB kept for recovery; about 60 MB with a quad format (estimated, section 5.5) |
| Bytes | three.js 166 KB gzip; apartment recipes 3.5 MB gzip | three.js gone (step 5); baked buffers 6.2 MB: **2.7 MB more** than the recipes they replace. Honest: the bake trades bytes for 7 to 47 seconds |
| Moire and window grids | `fill-extrusion-pattern` atlases, tile-anchored | authored buildings: unchanged until step 6; the shader window pattern then covers West Campus and the outer ring |
| Effort | | **about 12 days** (roadmap steps 1 to 6; steps 1 to 3 are 5) |
| Risk | | medium. Shading parity is the risk and the harness measures it; MapLibre custom-layer state rules apply (any GL state it does not reset must be restored; both MapLibre and Google's overlay docs say so); the app's lost-context handling must be re-done for the layer (a design gain, but work) |

### Path B: replace both: our own renderer, ground and roads baked ourselves

What it is: one WebGL2 renderer owns the canvas. Camera: the app already has its own flight controller that calls `map.jumpTo` once per frame, so the camera maths is small; but about 40 modules call into MapLibre (`map.project`, `queryRenderedFeatures`, sources, layers, `setPaintProperty`); the walk-to-class routes, entrances, names, places, signs and the finder are all MapLibre layers (224 style layers in all).

| | today | path B, expected |
|---|---|---|
| Draw calls | 900 to 1,500 a frame | estimated 100 to 250: ground and roads as a few baked meshes, trees instanced, buildings in the baked buffer |
| Frame time | L4 9 to 11.5 ms; Mac iGPU 114 to 124 ms | L4 estimated 3 to 5 ms; iGPU unchanged where triangle-bound, estimated 30 to 50% lower from the 90% of draw calls and state changes that disappear (the Safari record: apartment mesh 22 to 35 ms and the building layers about 25 ms of a 195 ms frame) |
| Bytes | frameworks 441 KB gzip, 33% of JS | MapLibre gone: 275 KB gzip, 56 ms parse (about 190 ms at 4x); our renderer +40 to 60 KB gzip (estimated) |
| Memory | | pattern atlases gone, tile caches gone, geometry as path A: the biggest single memory win; estimated 50 to 60% less than today on desktop, the phone peak from about 1 GB to estimated 300 to 400 MB |
| Moire | | whole frame under our control: temporal anti-aliasing (jitter plus history) is possible; the one fix path A cannot reach |
| Labels | 33 symbol layers | a signed-distance-field glyph atlas, collision and a place-name pass to be written. The part that sent Felt back to MapLibre |
| Effort | | **40 to 60 working days** (estimated): camera and picking 4, ground and roads bake 8, trees 4, labels and names 10, entrances, places, signs, art, walking routes and finder layers 15 to 20, sky and fog port 4, tests 5 to 10 |
| Risk | | high. Everything the page shows on top of the buildings must be re-drawn and re-verified; there is no longer a MapLibre to fall back to |

### Path C: WebGPU first, WebGL2 fallback

What it is: path B on a WebGPU backend (iOS Safari 26+, Chrome including Android 12+, 88% of users per caniuse), with the path B renderer kept as the fallback.

**It cannot be built on a MapLibre page.** MapLibre 5.24 is WebGL-only; a custom layer receives a WebGL context. A WebGPU canvas would have to sit above or below the MapLibre canvas with no shared depth buffer, so the app's depth fog, shadows and occlusion of buildings by anything MapLibre draws would be lost. Path C therefore includes path B.

| | | |
|---|---|---|
| Gain over B | compute-driven culling and LOD, render bundles for the static city, storage buffers (no 16-bit chunk id trick), cheaper TAA and blur passes | |
| What the evidence says it does not give | per-draw CPU cost: one author's Chrome 154 measurements (Oct 2026) put WebGPU at 1.5 to 2.4 times the CPU cost per draw of WebGL2 for three.js and Babylon, only PlayCanvas improved. A baked city issues about one draw, so this path wins on compute, not on submit | |
| Effort | | B plus **25 to 35 working days** (estimated) for the second backend and its test matrix |
| Risk | | highest. Two backends doubles the shader and test surface; multi-draw-indirect is not standard WebGPU, so a GPU-driven design is Chrome-only today; iOS memory has no ceiling you can query |

### Which, and when

Path A is the path with a measured prototype, a safety net and independent first steps. B and C are the larger ambitions: B is justified if after step 6 the remaining frame cost is MapLibre's and the owner wants temporal anti-aliasing; C only after B and only if a measured compute-bound problem exists. The decision gate in roadmap step 8 uses the numbers path A produces.

## 7. The prototype, and the test that makes a move like this safe

### 7.1 What was built (`experiments/renderer/`)

1. **`dump-apartments.mjs`** loads the real app headless, waits for `slopesApartments.count.done`, and writes the built arrays of the authored apartments to `~/flyover-private/renderer-2026-10-09/` (not the repo). Result (measured): **198 buildings, 3,116,469 triangles, 6,529,189 vertices in one mesh, 347.0 MB** of arrays at 55.7 bytes a vertex (position 74.7 MB, normal 74.7, three colour triples 56.1, facet flag 6.2, aSurface 99.6, indices 35.7). Two things the dump showed that the code comments did not say: the apartment mesh carries **no vertical-gradient attribute** (so MapLibre's wall darkening is not applied to them) and **2.09 vertices a triangle** (a quad per face cell).
2. **`pack.mjs`** turns that into the prototype's 24-byte vertex (int16 position relative to its building plus a building id, int8 normal and facet flag, three colour triples with the material kind, uint32 indices). Measured: **185.1 MB** (157 MB vertices, 37 MB indices), position error **at most 2.5 mm, mean 0.5 mm**; gzip 28.7 MB; brotli 23.3 MB. With the meshopt vertex and index codecs: **50.1 MB, 6.2 MB with brotli on top**, decoded in **398 ms** on one node thread (meshoptimizer 0.22.0, round trip verified). For scale, the 198 recipe files the app builds this from are 18.8 MB, 3.5 MB gzip: the bake sends **2.7 MB more** and saves 7 to 47 seconds of building.
3. **`proto/renderer.js`**, the renderer (about 220 lines): one VAO, one program, one vertex buffer, one index buffer, a 198-texel float texture holding each building's centre and scale, CPU frustum culling over per-building spheres, merged runs, `WEBGL_multi_draw` when present (else one `drawElements` per run), and the app's own vertex-shader lighting transcribed (MapLibre's formula, the day/golden/night colour blend, the roof-facet shading). Also **`makeMapLibreLayer`**: the same renderer as a `CustomLayerInterface`, composing the camera matrix from MapLibre's `mainMatrix` the way `js/slopes.js` does (contract points 1 to 3 in its header).
4. **Two pages**: `proto/standalone.html` (no MapLibre, no three.js) and `proto/maplibre.html` (the layer inside a real MapLibre map with a flat background).
5. **`selftest.mjs`** (no GPU, 8 checks): a two-box city drawn in software GL checks that the shaders compile, something is drawn in the right place, culling drops a box behind the camera, and the image metrics themselves behave.

What the prototype does not do is listed in section 9. It is the part of path A that decides whether path A is a good idea: the data format, the draw, the camera, the lighting formula.

### 7.2 Prototype against the app, same triangles

All measured, Mac iGPU (Intel Iris Plus 655) unless marked; the app side is the real page with every other layer removed, so it draws the same authored apartments and nothing else (1440x900).

| | the app (three.js layer) | the prototype |
|---|---|---|
| Draw calls, one frame, 10 cameras | 1 to 22 (the app's own culling merges the 198 buildings into runs) | **1** (one multi-draw), the runs merged the same way |
| All GL calls, one frame | 106 to 127 | **31** besides the draw |
| JavaScript per frame (CPU submit) | 0.2 to 1.4 ms (the layer's `render()`) | **0.08 to 0.14 ms**, culling included (198 spheres, 0.0 to 0.5 ms) |
| Frame time, all 198 buildings, 3.1 M triangles, readback-synchronised, Mac iGPU | 51 to 102 ms across four runs | 76 to 99 ms across eight runs of the same code (clean and broken). **No gain, and not distinguishable from noise: this GPU is limited by the triangles, not by the API** |
| Frame time on the L4 | **3.81 ms** a frame (all 198 buildings, 3.1 M triangles, 1440x900, readback-synchronised) | **1.01 ms** a frame: **3.8 times faster for the same triangles** |
| Bytes on the card (authored geometry) | 347 MB of arrays, the same on the card | **194 MB** (157 vertices + 37 indices) |
| Bytes on the wire | the recipes: 3.5 MB gzip, then a 7 to 47 s JavaScript build | 6.2 MB (meshopt + brotli, estimated from the measured encode), decode 0.4 s on one thread |
| Navigation to first frame of the buildings (L4: 1.4 s with the raw 194 MB file from loopback) | 7 to 9 s (AWS server CPU) and 20 to 47 s (shared Mac) until the build is done | **3.9 s** measured on the Mac with the real wire form (6.5 MB brotli over loopback: fetch and inflate 0.77 s, meshopt decode in the page 1.10 s, upload of 194 MB 1.29 s, first draw 10 ms later; the same pictures bit for bit as the raw file). Add the download: 6.5 MB is 1.0 s at 50 Mbit/s, 2.6 s at 20 Mbit/s. The raw 194 MB file from loopback took 2.3 to 7.5 s |
| Renderer in the MapLibre layer | | pictures identical to the standalone page (below): the matrix composition is right |

### 7.3 The automated test: `compare.mjs`

For each of the ten cameras in `scripts/verify/ci/poses.json` it renders the app and the prototype from the same camera and reports per-view differences; side-by-side pictures (app | prototype | moved pixels in magenta) are saved under `~/flyover-private/renderer-2026-10-09/compare-<tag>/`. It runs with no human in it: about five minutes on the Mac, most of it the app's own load.

How it makes the comparison fair: the app side is the real page with every other map layer and every other three.js group hidden (including the custom layers: sky, fog), the page's own CSS picture grade and sky switched off, a flat `#ff00ff` background, and the BASE look flags `?sunlight=0&surfaces=0&facadefilter=0`. The camera matrix and the light uniforms are read off the app (`slopes.camera.projectionMatrix` and the material's uniforms) and handed to the prototype, so the two cannot disagree about where the camera is. Rows of sky that survive on the app side are masked from the score (the harness reports how many).

Metrics per view: percent of pixels over tolerance 12/255 whole-frame (how `ci/pictures.mjs` counts; diluted by the empty background) and **of the building pixels** (the honest one); silhouette overlap (IoU); mean absolute colour difference (0 to 255); SSIM on 8x8 luma blocks.

**Result on the clean prototype** (Mac iGPU, hardware GL; the same on the standalone page and inside MapLibre; this table is the Mac, the L4 follows):

| view | building pixels, % of frame | over tolerance, % of building pixels | silhouette IoU | mean colour diff (of 255) | SSIM |
|---|---:|---:|---:|---:|---:|
| spawn-day | 36.6 | 0.12 | 1.0000 | 0.08 | 0.9977 |
| spawn-golden | 36.6 | 0.13 | 1.0000 | 0.09 | 0.9979 |
| tower-day | 39.6 | 0.13 | 0.9999 | 0.29 | 0.9962 |
| drag-street-day | 41.3 | 0.24 | 1.0000 | 0.28 | 0.9944 |
| west-campus-day | 8.7 | 0.12 | 0.9999 | 0.13 | 0.9980 |
| stadium-day | 29.8 | 0.05 | 1.0000 | 0.03 | 0.9989 |
| capitol-day | 24.9 | 0.13 | 0.9999 | 0.18 | 0.9975 |
| downtown-day | 1.1 | 0.28 | 0.9999 | 0.29 | 0.9962 |
| **spawn-night** | 36.6 | **46.4** | 1.0000 | 12.03 | 0.8184 |
| **tower-night** | 39.6 | **39.5** | 0.9999 | 8.91 | 0.8577 |

**Eight daylight views: 0.15% of building pixels over tolerance on average (worst 0.28%), silhouettes identical, SSIM 0.997.** The prototype reproduces the app's base look to within rounding on every daylight camera. **The two night views are 40 to 46% over: expected and correct**, because the night lamps, window emission and `u_nightWallAmbient` in the fragment shader are not ported. The harness found that on its own; it is the first line of the porting list in step 4 of the roadmap. A pixel diff of the whole frame with the sky in it (the CI definition) would have read 12 to 30% on these views for the same reason the first versions of this harness did: the sky was in the app's picture and not in the prototype's. That was found and fixed during the build by looking at the picture, which is what the harness is for.

**The same harness on a different GPU and driver** (the AWS L4, Linux OpenGL ES through ANGLE; one run, the standalone page): the day views read **4 to 14% of building pixels over tolerance** (mean 0.7 to 4.5 of 255; silhouette IoU 0.997 to 0.999; SSIM 0.89 to 0.98), the night views 39 to 46% as on the Mac. So the picture the same code makes changes by a few percent of pixels between a Metal driver and an NVIDIA one (rasterisation and precision, not a logic difference: the shapes are the same to the pixel). **The tolerance has to be calibrated per runner**, which is why roadmap step 1 measures the app against itself on the runner first and why the CI pictures check uses a noise floor. The app-against-itself floor on the L4 was not measured here.

**What it catches: three deliberate breaks of the prototype**, same ten cameras, day views averaged (clean for comparison: 0.15% over, SSIM 0.997):

| break (`--break`) | what it is | over tolerance, % of building pixels | SSIM | silhouette IoU | caught? |
|---|---|---:|---:|---:|---|
| `light` | the sun on the wrong side (two signs flipped) | **56.1** (worst view 71.6) | 0.912 | 1.000 | yes, 370 times the clean number |
| `quant` | positions rounded to a thirtieth of each building's extent (a precision bug in the bake) | **39.7** | **0.434** | **0.955** | yes; the only one that moves the silhouette |
| `facet` | one shading feature silently switched off (the roof-facet rule: a few roof faces, nothing else) | **1.6** (worst view 4.0) | 0.994 | 1.000 | yes, 11 times the clean number on average and up to 23 times on a single view (tower-day: 3.0% against 0.13%), although to the eye it is a few roof faces |

The three breaks move different columns, which is the point of having several. The subtle one is visible in the number because the metric is taken over building pixels, not the whole frame.

**What the harness cannot do**: it measures pixels against the app, so it cannot say the app is right; it needs the app's flags that switch off the effects not yet ported (so its first job is the base look, and each ported effect moves one flag from "off" to "on" with the tolerance recomputed); and on software GL its absolute numbers differ slightly from hardware (the CI pictures check says the same of itself). It also cannot see a motion artifact; the moire meter (`scripts/verify/moire-meter.mjs`) keeps that.

## 8. Roadmap: steps of one or two days, optimistic path first

The order is chosen so that every step ships something on its own, every step has an automated test that exists before the step starts, and the first two steps are worth doing even if the renderer is never replaced. "Stop point" is the number that says the next step is not worth it.

| # | Days | Step | Gain | Automated test (written first) | Stop point |
|---|---|---|---|---|---|
| 0 | done | This PR: measurements, the dump, the packed format, the prototype, the compare harness | the numbers in this document | `selftest.mjs` (no GPU), `compare.mjs` | none |
| 1 | 1 | Promote `compare.mjs` to a CI check: it needs one flagged page load (`?sunlight=0&surfaces=0&facadefilter=0`), runs the app against itself to get a noise floor per view, and fails a run if a view moves more than 3 times its own noise. Add the deliberate-break controls (`--break light|quant|facet`) so the check proves it can fail. | A safety net for every later step, and for every building pass today (it already catches a change to one authored building's pixels). | The break controls must exit non-zero; app-against-app must read 0.0000% | If app-against-app is not 0 on the CI runner, fix determinism (shadow rebuild, label timing) before anything else |
| 2 | 2 | **Bake only, still three.js.** `scripts/bake_apartments_bin.mjs` runs the generators headless once (the dump script is already that), writes meshopt files per area to `data/`; the page loads them with `?aptbin=1`, decodes, and hands the arrays to the existing three.js geometry and material. No shader change. | Load: no 45 s main-thread build under the veil (the veil today waits on it). Memory: no builder temporaries, no 1 GB peak. Context loss: re-upload from the cached buffer instead of a page reload. All independent of any renderer. | App with `?aptbin=1` against app without: the compare harness at full look, expected 0.00% (same arrays, same shader). Plus `count.triangles` equality per building. | If decode plus upload takes more than a quarter of the build time it replaces, stop and look at the codec |
| 3 | 2 | Position stream split and 16-bit indices in the bake (8 B a vertex for the shadow pass, indices halved). Still three.js (a custom vertex attribute). | Shadow pass reads a seventh of the bytes it reads today. File shrinks again. | Compare harness 0.00% | Shadow pass time not measurably lower on the AWS card: stop |
| 4 | 3 | **The raw layer for the full look, behind `?renderer=raw`, apartments only.** The prototype's layer plus the existing GLSL strings (`CityLighting`, `WallPatterns`, `RoofTiles`), the two shadow cascades on raw framebuffers, fog left to `sky.js`. | One program, one multi-draw; no per-object uniforms; three.js still loaded for the other generators. | Compare harness at full look (`sunlight=1 surfaces=1`) with the tolerance set from step 1. Target: mean over-tolerance on building pixels under 1% | If after 3 days the mean is above 3%, the remaining difference is a shading feature nobody listed; list it, decide, or stop here and keep step 2 and 3 |
| 5 | 3 | Port the other generators' outputs (roofs, arches, dome, art, stadium, campus landscape) to the same bake and drop three.js: `slopes.add` becomes "append a baked chunk". | -166 KB gzip and -668 KB raw of three.js, -41 ms of its parse on this Mac (about 240 ms at 4x, noisy), the scene graph walk, the second copy of the material system. | Compare harness over all ten poses | If any of the six generators needs per-frame geometry change (none does today), keep it on three.js and stop |
| 6 | 5 | **Windows without pattern atlases**: West Campus, outer ring and the campus bands draw their windows from a shader pattern and one texture array in the raw layer, instead of MapLibre `fill-extrusion-pattern` (an atlas per tile, up to 30 MB each on a phone). | The largest memory item found: the facade atlases are 607 of the 690 MB of textures at city ready on desktop (speed study, one sample). About 19% of main-thread time at cruise went to atlas image work in the August profile. Moire: pattern filtered analytically per pixel with mip levels. | Compare harness on the ten poses plus the moire meter (`scripts/verify/moire-meter.mjs`) | If the raw layer cannot match the MapLibre-drawn walls within the step-4 tolerance, keep the atlases for the far field and use the shader only within 300 m |
| 7 | 2 | Per-building LOD ranges and impostor boxes in the bake; cell visibility lists. | Fewer triangles in the far field; the app today draws every authored building at full detail at every distance. | Compare harness at the far poses (`downtown-day`, `capitol-day`) | If the far-pose triangle count is already under 20% of the near-pose count, skip |
| 8 | 1 | **Decision gate.** Re-measure draw calls, frame time, bytes, memory against section 2. Decide whether path B is worth its weeks. | | | |

If every step lands, the total is about 19 working days of one person, of which the first four days (steps 1 to 3) are independent of the renderer decision.

### How moire, phone memory and load time change along the way

| After step | Load time | Phone memory | Moire |
|---|---|---|---|
| 1 | none | none | none |
| 2 | the 45 s build under the veil is gone for authored apartments (replaced by fetch plus decode, measured in section 6) | the peak during the build (565 MB for the phone profile with everything on, from the `js/slopes-apartments.js` header) falls to the size of the buffers | none |
| 4 | shader programs compile in parallel at second one (one program) | one buffer instead of two copies | none (same shader) |
| 5 | -166 KB gzip download, -40 ms parse (about 240 ms at 4x CPU) | the scene graph and a second material system go | none |
| 6 | no per-tile atlas painting (2.4 s sync at boot in the speed study's sample) | the largest single drop: texture memory falls by roughly the atlas share | the window grids are filtered in the shader per pixel: the cause of most shimmer in `docs/shimmer-verdict.md` is addressed at the source |
| path B+TAA, later | | | temporal anti-aliasing needs the whole frame under our control, which MapLibre's canvas does not give a custom layer: this is the one moire fix that path A cannot reach |

## 9. What was not measured, and what that leaves open

- **No phone.** Phone memory and phone frame time are from the repo's own records (`js/mobile.js`, `docs/mobile-device-check.md`), not measured here. Desktop Chrome at 390x844 is not WebKit (the repo says so in `scripts/verify/README.md`). Every phone gain in this document is estimated.
- **Frame time on the Mac iGPU is from a machine shared with other lanes** (a load average of 10 to 30 at times) and the p90 is much worse than the median. Minimums and medians are quoted; the L4 numbers are cleaner. Safari, the owner's actual browser, was not driven.
- **The call counts in section 2.1 (AWS, first run) were taken with the GL-call counters on**, which cost CPU time of their own (the profile shows the pass-through wrapper at about 4 to 7% of main-thread time even when muted); the frame times in section 2.1 and the prototype comparison are from the final run with the counters muted and one pixel read back after every frame. The call counts are exact; no frame time comes from a counted run.
- **One L4 run only.** Frame times and the cross-GPU picture comparison on the L4 are one run each (the AWS runner's quota allows few); the Mac figures are minima and medians over 40 frames and several runs, on a shared machine. The app-against-itself noise floor on the L4 was not measured, and the MapLibre-layer comparison did not run there (the page needs the MapLibre files, which the runner did not have); it ran on the Mac.
- **No full-look parity.** The comparison is the BASE look (MapLibre's lighting formula). Sun shadows, glass reflection, night windows, the procedural brick/tile/shop surface detail, the compact wall patterns and the textured facade meshes are not ported. How much of the picture they are, the harness can measure once they are ported; the prototype does not claim it.
- **Not measured: MapLibre's per-frame JavaScript by function.** The production bundle is minified; a finer split needs a source-mapped MapLibre build. The share by file is measured.
- **Not measured: the cost of a lost-context recovery from a compressed buffer**, only its parts (decode 0.4 s on one node thread, upload 0.5 to 0.9 s).
- **Not measured: quad format, LOD ladders, impostors, cell visibility, TAA, a WebGPU backend.** These are designs with estimates.
- **Not run: the Rust/WebAssembly question** (`~/Projects/flyover-rust` owns it). The decode step in the design uses a 6 KB WebAssembly decoder that already exists (meshoptimizer).
- **Reading list not opened in full:** the original Aaltonen and Haar deck, Karis's TAA slides, Apple's and Arm's tile-based GPU documents, a per-device iOS WebGL limit (none is published), Chrome Android GPU memory (none found), MapLibre's 6.x release notes (search results list versions up to 6.12.0; this app pins 5.24.0).

## 10. Reproduce

See `experiments/renderer/README.md` for the exact commands. In short: `selftest.mjs` (no GPU), `measure-libs.mjs` (no GPU), `dump-apartments.mjs` then `pack.mjs`, `measure-app.mjs`, `compare.mjs` (and `--mode maplibre`, `--break light|quant|facet`), and `scripts/verify/renderer-bench.mjs` for the whole sequence on the AWS runner (`gh workflow run aws-gpu.yml --ref main -f ref=<branch> -f checks=renderer-bench.mjs`; the workflow only runs from `main`, the `ref` input names the branch to check).
