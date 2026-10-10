# Rust for the 3D explorer: an extensive, optimistic study (2026-10-09)

Owner's question: *"What can we rewrite in rust"*, with the rule *"each big decision like the rust should involve extensive research,
with optimism in mind"*. This is that study: the strongest version of the idea, a real prototype that was built and measured, and
the costs written next to the gains. Plain words; every number says whether it was **MEASURED** (I ran it, here, today), **ESTIMATED**
(arithmetic on measured numbers) or **UNMEASURED** (an assumption, said so).

Machine for every MEASURED number: the Mac this lane runs on, an Intel Core i7-8569U (the same class as the owner's 2019 13-inch
MacBook Pro), 8 threads, 16 GB, Node 26.5, Chrome 155. **The Mac was very busy the whole time** (load average 18 to 460 from other
lanes' browsers). So the study quotes **CPU time of the process** where it can (the Node kernel table; it barely moves with other
people's load) and says "wall" wherever it is wall time (Chrome has no per-page CPU clock); every table says which, and wall figures are
quoted as fastest / median / slowest because the slowest runs are other people's load. Raw files are in `experiments/rust-mesh/results/`.

## 1. The short version

**What could work, strongest first**

| # | Candidate | Optimistic best case | Cost | Confidence |
|---|---|---|---|---|
| 1 | **Bake the city's meshes offline, build nothing at load** (the baker is the app's own generator run in Node; no Rust needed) | the 3.1 M-triangle build (4 to 9 s of compute here, 29 to 45 s as the app reports it) becomes a **122 ms** decode (MEASURED, meshopt in Node) plus the upload | wire bytes go UP: 1.61 MB brotli of recipes becomes 2.5 to 4.0 MB of meshes (MEASURED); every graphics preset or runtime variant needs its own baked file | high that it works (the harness already runs the real generator and reproduces its buffers byte for byte) |
| 2 | **Pack the vertex layout** (int16 positions, 2-byte normals, 1 tone id) | geometry memory 346.7 MB to about 64.5 MB (MEASURED sizes); the phone's actual failure is memory, not speed | a shader change in `js/slopes.js`; pixel parity must be proven | high on the bytes, medium on the shader work |
| 3 | **The vertex/index builder as a Wasm module** (the prototype, built and measured) | **2.7x to 3.7x less CPU than the shipped JS builder** (872 / 635 ms against 2,357 ms, MEASURED); about 1.5x to 2x less than the best plain JS I could write. Put behind the REAL generator it **halves the whole build by the median** (Node 7.2 to 3.7 s, Chrome 8.7 to 4.2 s wall, geometry hash-identical, MEASURED) | a 34 KB `.wasm` in git, a build script, a staging adapter between generator and builder (a version of it is in `profile/app-patch.mjs`); it removes compute, not the main-thread contention that makes the owner's wait 29 s | high: it runs, it is byte-identical, and the end-to-end number is measured. The unknown is the real page (§8) |

**What I would not do:** rewrite the whole generator (3,400 lines of rules) in Rust first; Rust for route search, the bus protobuf or
the Python bakes (measured below: each is milliseconds or I/O-bound); threads and the COOP/COEP headers (nothing here needs them yet).

**The finding that changes the question.** The apartment build costs about **4 to 9 s of compute** on this Mac (MEASURED: the real
generator and real catalog run in Node and in a bare Chrome page, no map) but the app reports **29 s** on the owner's laptop and **45 s** in the speed lane's
loaded-Mac sample. The other 20 to 35 s is the build waiting its turn on a main thread that is also parsing tiles (the speed lane's one loaded-Mac
sample has the veil lifting 33 s after the build finished, on sources it attributes to starvation by the build). A faster language shrinks the 4 to 9 s (the Rust builder halves it); **moving the work off the main
thread, or not doing it at load at all, removes the rest.** Rust is a good tool for the first and irrelevant to the second; the baked
mesh solves both and needs no Rust at runtime.

**What is built and in this pull request:** `experiments/rust-mesh/`: a Rust crate (34 KB wasm: the mesh builder plus a facade-blur experiment), a JS twin cut from the app's own
code, a tuned-JS twin, a compare harness that holds all three to the same bytes on the whole 198-building catalog, interleaved
benchmarks for Node and Chrome, the byte study, and the build script. Nothing in the site loads any of it.

## 2. What other people measured (research)

Every line has a link. "UNCONFIRMED" means I could not find a primary source. The research was gathered on 2026-10-09; browser
support figures come from the WebAssembly.org feature table fetched the same day.

### 2.1 Who moved hot browser code to Rust/Wasm, and what they got

| Who | What moved | What they measured | Source |
|---|---|---|---|
| Mozilla (source-map library) | JS source-map parsing to Rust/Wasm | up to 5.89x faster on real maps, with less variance. After algorithm work in both languages: 5.3x in Chrome, 10.8x in Firefox, 9.4x in Safari over the original JS | [Mozilla Hacks](https://hacks.mozilla.org/2018/01/oxidizing-source-maps-with-rust-and-webassembly/), [Fitzgerald follow-up](https://fitzgen.com/2018/02/26/speed-without-wizardry.html) |
| Figma | C++ engine from asm.js to Wasm (not Rust) | load time more than 3x faster; Wasm parses about 20x faster than asm.js | [Figma blog](https://www.figma.com/blog/webassembly-cut-figmas-load-time-by-3x/) |
| Figma (server) | multiplayer server TypeScript to Rust (native, not Wasm) | serialization over 10x faster | [Figma blog](https://www.figma.com/blog/rust-in-production-at-figma/) |
| Google Earth (web) | streaming and decompression on Wasm worker threads | "a clear performance improvement"; no figures published; threads only where SharedArrayBuffer exists | [web.dev case study](https://web.dev/case-studies/earth-webassembly) |
| meshoptimizer (zeux) | vertex and index decoders, in Wasm | 1 to 3 GB/s on desktop with Wasm SIMD; the 2019 scalar port decoded a 28k-triangle mesh in 0.48 ms (vertices) + 0.27 ms (indices) in Chrome | [JS README](https://raw.githubusercontent.com/zeux/meshoptimizer/master/js/README.md), [zeux.io 2019](https://zeux.io/2019/03/11/small-fast-web/) |
| Foxglove | three.js `EdgesGeometry` port to Wasm | their own claim of about 10x; not independently measured | [foxglove/wasm-edgesgeometry](https://github.com/foxglove/wasm-edgesgeometry) |
| SWC / Rolldown (native Rust build tools) | Babel / bundlers | SWC's own claims 18x to 70x over Babel (methodology not verified); one independent run had Rolldown slower than esbuild (Go) | [Better Stack](https://betterstack.com/community/comparisons/esbuild-vs-swc/), [benchmark post](https://decodeapps.pp.ua/blog/post/fastest-js-bundler-2026-rolldown-vs-esbuild-vs-webpack-benchmark) |
| `fast_paths` (Rust contraction hierarchies) | road routing | 55 microseconds per query on a New York road graph after 9 s preparation, native on an M1 Max. No published Wasm number (UNCONFIRMED) | [fast_paths](https://github.com/easbar/fast_paths) |

### 2.2 Where Rust/Wasm lost or tied (the honest list)

- **OpenUI parser (2026-03):** the team moved a Rust/Wasm parser BACK to TypeScript. Per call: Wasm 20.5 to 61.4 microseconds,
  TypeScript 9.3 to 19.4 (2.2x to 4.6x faster in TS). Causes: copying the input string into Wasm memory, then serializing the
  result to JSON and parsing it again; `serde-wasm-bindgen` (direct objects) was another 30% slower because it built many
  small objects across the boundary. [urandom.io](https://urandom.io/blog/2026-03-21-rust-wasm-slower-than-typescript) (I fetched and
  read this one.)
- **JS can catch up.** After the Mozilla result, a JS-only rewrite got about 4x on V8 and SpiderMonkey and reportedly matched the
  Rust/Wasm version, fragilely and per engine. [Fitzgerald follow-up](https://fitzgen.com/2018/02/26/speed-without-wizardry.html)
- **earcut.** The Rust port `earcutr` first ran about 10x SLOWER than the JS and ended up comparable to C++ (about 1.7 to 1.9x slower
  than C++ on an M1 Pro). Triangulation is not where a Rust gain lives. [earcutr](https://github.com/dabreegster/earcutr/blob/master/OPTO.md)
- **Protobuf.** One AssemblyScript benchmark has protobuf.js ahead of the Wasm decoder on decodes per second (GC and strings
  blamed). No prost vs protobuf.js benchmark exists that I could find (UNCONFIRMED). [as-proto](https://www.npmjs.com/package/as-proto)
- **maplibre-rs** is experimental (no text, labels, raster or terrain); nobody has rewritten MapLibre Native in Rust.
  [README](https://raw.githubusercontent.com/maplibre/maplibre-rs/main/README.md)
- **Rust vs vectorised Python.** For geometry bakes the win is over Python LOOPS, not over Shapely: on 1.58 M polygons Rust with
  rayon validated in 1.13 s against 3.78 s for GEOS batch, but the full-dataset runs were about even (3.34 s vs 3.61 s).
  [geo-repair](https://docs.rs/crate/geo-repair/latest)

### 2.3 What makes a win big, and what kills it

Big: tight typed loops over flat arrays; no per-element garbage; coarse calls (a boundary call itself is cheap, Firefox measured
about 4.5 ns each [Mozilla Hacks](https://hacks.mozilla.org/2018/10/calls-between-javascript-and-webassembly-are-finally-fast-🎉/));
SIMD (a MediaPipe demo went from about 14 to about 39 fps [v8.dev](https://v8.dev/features/simd)); zero-copy views.

Killers: copying strings or objects across the boundary (the OpenUI case); `memory.grow()` detaching every cached view
([MDN](https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/JavaScript_interface/Memory/grow): re-create views from `memory.buffer`
after any call that can allocate); cold-start compile (Liftoff code runs about 50% slower than optimised code until the optimising
tier finishes [v8.dev](https://v8.dev/blog/liftoff); Chrome caches optimised code only for modules of 128 kB or more loaded with
`instantiateStreaming` from a stable URL [v8.dev](https://v8.dev/blog/wasm-code-caching)). Binary size is not an issue for a kernel
like ours (the prototype is 27 KB, 8 KB brotli).

### 2.4 Browser support that matters (WebAssembly.org feature table, fetched 2026-10-09)

| Feature | Chrome | Firefox | Safari |
|---|---|---|---|
| SIMD (fixed-width) | 91 | 89 | 16.4 |
| Threads / atomics | 74 | 79 | 14.1 (iOS 14.5) |
| Relaxed SIMD | 114 | 145 | flag only |
| Memory64 | 133 | 134 | flag / preview |
| GC, tail calls, exception handling | 112 to 137 | 120 to 131 | 18.2 to 18.4 |

Source: [features.json](https://raw.githubusercontent.com/WebAssembly/website/main/features.json); Wasm 3.0 shipped 2025-09-17
([WebAssembly.org](https://webassembly.org/news/2025-09-17-wasm-3.0/)). WebGPU is on by default in Safari 26 on macOS and iOS
([web.dev](https://web.dev/blog/webgpu-supported-major-browsers)). Streaming compilation (`compileStreaming`) is universal.

**iOS memory is the hard limit for this app's actual problem.** A WebKit report found only about 300 to 500 MB reliably allocatable
to Wasm on iOS 17 ([WebKit 269777](https://bugs.webkit.org/show_bug.cgi?id=269777)), and Safari kills or reloads the tab past the
limit instead of failing `memory.grow` ([WebKit 221530](https://bugs.webkit.org/show_bug.cgi?id=221530)). The Wasm heap comes out of
the same budget as the page's JS and GPU buffers. Rust helps the phone only if it makes the data smaller; making the build faster
does not.

### 2.5 Threads and the cross-origin-isolation headers (checked against this app)

Wasm threads need `SharedArrayBuffer`, which needs `Cross-Origin-Opener-Policy: same-origin` plus `Cross-Origin-Embedder-Policy:
require-corp` (or `credentialless`). Safari has supported both headers since 15.2 ([WebKit](https://www.webkit.org/?p=12140)) but not
`credentialless` ([WebKit 230550](https://bugs.webkit.org/show_bug.cgi?id=230550)), so iOS would need `require-corp`.

- **Can Vercel send them?** Yes. `vercel.json` takes a `headers` array of `source` + `key`/`value` pairs
  ([Vercel docs](https://vercel.com/docs/project-configuration/vercel-json)); this repo's own `vercel.json` already sends
  `Referrer-Policy` that way.
- **What would break (MEASURED today with `curl -I`):** the page loads maplibre-gl, pmtiles and three.js from `unpkg.com` (checked on the three.js URL; maplibre-gl and pmtiles come from the same host), which
  answers with `access-control-allow-origin: *` AND `cross-origin-resource-policy: cross-origin`, so it would pass `require-corp`.
  `tiles.openfreemap.org` answers with `access-control-allow-origin: *` (fine for MapLibre's CORS fetches). The two form services
  (`formspree.io`, `api.web3forms.com`) are POSTs from the page and are not checked. I did NOT load the whole page under the headers
  (not measured); any `<img>` or font from a host without CORP/CORS would be blocked and that is the thing to test.
- **Do we need threads at all?** No. A single-threaded Wasm module in a Web Worker needs no isolation, no nightly Rust (the
  `wasm-bindgen-rayon` route needs a pinned nightly and `-Zbuild-std`, [docs](https://docs.rs/wasm-bindgen-rayon)) and avoids Safari's
  shared-memory leak across reloads ([emscripten #19374](https://github.com/emscripten-core/emscripten/issues/19374)). The roadmap
  below stays single-threaded and keeps threads as a later, separate decision.

### 2.6 Toolchain facts

- The `rustwasm` GitHub org was sunset in 2025; wasm-bindgen continues under its own org
  ([Rust blog](https://blog.rust-lang.org/inside-rust/2025/07/21/sunsetting-the-rustwasm-github-org)). `wasm-pack` status is
  UNCONFIRMED, so the prototype uses plain `cargo build --target wasm32-unknown-unknown` + `wasm-opt`: nothing archived in the path.
- Since Rust 1.87 the target enables bulk-memory, reference-types, multivalue, mutable-globals and sign-ext by default
  ([rustc book](https://doc.rust-lang.org/rustc/platform-support/wasm32-unknown-unknown.html)); `wasm-opt` must be told the same
  features (the first build of the prototype failed on that, see `build.sh`).
- Raw `extern "C"` exports with scalar arguments and pointers into linear memory need no glue code
  ([depth-first](https://depth-first.com/articles/2020/07/07/rust-and-webassembly-from-scratch-hello-world-with-strings)); the prototype uses that.


## 3. Where the time and the bytes are today (measured before any Rust)

**How.** `experiments/rust-mesh/profile/app-env.mjs` loads the app's own `js/slopes.js` and `js/slopes-apartments.js` into Node (no
browser, no map; the sources are patched in memory only: the map-origin line, one exported handle, and stand-ins for the night-light
module and the pattern registry) and runs the real `build()` over the real catalog (the 48 individual files plus the 5 collections
`startFetch` loads; the lazy "riverside" area is left out; the facade filter and view culling are off, as they are in a plain
build). The same page-free harness also runs inside headless Chrome (`bench-browser-build.html`).

| Fact | Value | |
|---|---|---|
| Buildings / blocks / faces / cells | 198 / 1,978 / 16,654 / 644,425 | MEASURED |
| Triangles / vertices / indices | 3,113,629 / 6,523,203 / 9,340,887 (the speed lane's page sample says 3,116,469; the gap is my stand-in night-light flags) | MEASURED |
| Buffers the page holds and uploads | **346.7 MB**, 55.7 bytes per vertex counting the index (position 74.7, normal 74.7, three colour triples 56.0, facet 6.2, surface 99.5, index 35.6 MB) | MEASURED |
| Compute of generator + builder, Node | 4.06 s fastest of 18 builds, 7.2 s median, 13.3 s slowest (load average 20 to 460) | MEASURED |
| Same build inside Chrome 155, no map, nothing else on the page | 3.86 s fastest of 12 builds, 8.65 s median, 17.5 s slowest (load 48 to 159) | MEASURED |
| The generator alone (builder replaced by do-nothing calls) | 2.0 s in Node; 1.65 s fastest, 2.4 s median in Chrome. A lower bound: it also skips the polygon triangulation inside `polygon()` | MEASURED |
| What the app reports as `count.ms` | about 29,000 ms on the owner's 2019 MacBook Pro (the brief); 45,161 ms over 39 slices in the speed lane's one loaded-Mac sample | reported by others |
| Share of the build spent inside the shared builder (`tri`/`quad`/`triN`) | **40%** (33% to 44% over 5 runs), clocked in place | MEASURED (`results/in-situ-share-node.txt`) |
| Same, from the speed lane's Chrome profile | mesh emission about 12 of 19.8 s of build time (inclusive times overlap, so an upper bound: up to about 60%) | speed lane, `docs/speed-2026-10-09.md` §2b (branch `mac/speed-profile`) |
| Distinct tones the 6.5 M vertices actually use | **1,266**, against 111,828 separate colour arrays the generator creates (a new `[day, golden, night]` array per lit window cell) | MEASURED |
| Distinct flat normals | about 84,900 | MEASURED (hash-counted) |

**Three things this changes.**

1. **The compute is not most of what the owner waits for.** Compute for the whole apartment build is roughly 4 to 9 s (fastest to median) on this Mac class of
   machine; the app reports 29 to 45 s. The remainder is the build sharing one main thread with MapLibre's tile parsing, the facade
   atlas and the sky, in 12 ms slices (`buildSliceMsLive`). The speed lane's profile says the same from the other side: the main thread
   never idled and "the load is bound by total CPU work, not by one thread". A change that halves 4 to 9 s of compute saves 2 to 4.5 s
   of a 29 to 45 s wait. Moving the work off the main thread, or not doing it at load, saves the whole thing.
2. **Much of what a Rust builder wins on the kernel is also available in plain JS.** See §5.3: stop allocating a point array per call
   and give the builder the vertex count up front, and the JS builder already drops from 2,357 to 1,280 ms CPU in the replay (the
   app's `build(initialCapacity)` already takes the count; passing it end to end saved about 17% of the CPU, §5.4).
3. **The phone problem is a layout problem.** 1,266 tones are stored as 26 bytes on each of 6.5 million vertices (about 170 MB);
   the flat normals (12 bytes each, 74.7 MB) could be 2; the index (35.6 MB) is fully predictable from the quads. No language change
   touches that; a different vertex format does (§4 b, §7 day 2), and Rust is a good place to write the code that emits it.

**A benchmarking trap worth writing down.** The first version of the harness ran the app's code in a `vm.createContext` sandbox,
as the repo's other no-browser checks do. The same build took 38 s instead of 7 s: every global lookup (`Math.min`, `Float32Array`)
goes through the sandbox's interceptor, which blew up three.js's `Box3` loop about five-fold. `vm.runInThisContext` fixed it. Any
timing taken in a `createContext` sandbox on this codebase is wrong by a large factor.


## 4. Candidates in this app, each with its optimistic best case and its cost

### (a) The apartment mesh builder as a Wasm module, in a worker, zero-copy to three.js

*What it is.* The generator keeps producing the same calls, but `B.quad`/`B.tri` write numbers into a staging buffer in Wasm memory
instead of building vertex arrays in JS; the module owns the vertex store; the finished arrays are typed-array views of Wasm memory.
This is exactly what the prototype is (§5).

*Optimistic best case.* The builder part of the work costs **2.7x less CPU than the shipped JS builder with no other change (872 vs
2,357 ms, Node, MEASURED) and 3.7x less if the vertex count is known in advance (635 vs 2,357 ms, MEASURED, 3 runs)**; Chrome's
fastest of 5 was 702 ms against 2,321 ms (3.3x, wall time on a loaded machine, MEASURED). Peak memory is lower too: 356 MB for the
Wasm heap with the count known (MEASURED) against +911 MB for the shipped JS builder's growth buffers plus the trimming copy.
Put behind the REAL generator (§5.4) the whole build roughly **halves by the median** (Node 7.2 to 3.7 s, Chrome 8.7 to 4.2 s,
geometry hash-identical, MEASURED), and 1.4x to 1.6x by the fastest runs. In a Worker, where the build stops competing with the main
thread, the owner's wait could approach the compute time (ESTIMATE, §5.5).

*Cost.* A 34 KB `.wasm` and `build.sh` in the repo; nothing in the generator has to change (the adapter used in §5.4 takes the same `[x,y,z]` arrays the generator already passes; writing numbers directly instead is a later 150 ms saving per the replay), but every consumer of `slopes.build()` (roofs, arches, heroes: not only the apartments) would get the new builder, and each has to keep its output identical, which is what the compare harness is for; `memory.grow()` detaches views, so three.js attributes cannot point into a module that will be reused (use a fresh
module per build, or copy); a Wasm heap cannot be *transferred* out of a worker (it is not detachable; sharing it needs the COOP/COEP
headers), so a worker build pays one copy of 347 MB (the `wasm-copy` variant in the bench, about 0.7 s on the loaded machine,
UNMEASURED on a quiet one). And as §3 says, it removes compute and none of the main-thread contention.

### (b) The same builder as an OFFLINE tool that bakes compact meshes, so the browser builds nothing

*What it is.* The baker is the app's own generator, already runnable in Node (`profile/app-env.mjs`, 4 to 9 s for the city); its
buffers are quantised and meshopt-coded; the page downloads them, decodes with the Wasm meshopt decoder and uploads. No Rust is
needed anywhere on this path (npm `meshoptimizer` encodes; its Wasm decodes; a Rust crate `meshopt` exists if one wanted a Rust baker).

*Measured bytes (`results/pack-size.txt`, the real 3.1 M-triangle catalog).*

| What goes over the wire | Raw | gzip -9 | brotli q9 |
|---|---:|---:|---:|
| **Today: the 54 JSON recipe files** | 13.95 MB | 2.56 MB | **1.61 MB** |
| Baked, simple: int16 positions + 2-byte normals + tone id, delta-coded, byte-planes | 64.5 MB | 3.11 MB | **2.47 MB** |
| Baked with meshopt's real vertex + index codecs (12-byte vertices) | 31.5 MB | 4.25 MB | **3.97 MB** (3.53 MB at q11) |

So **baking makes the download 1.5x to 2.5x LARGER, not smaller**; the JSON recipes are a very compact program. What baking buys is
the CPU: decoding the whole city with meshopt's Wasm decoder took **122 ms fastest of 5 in Node** (MEASURED, loaded machine;
slowest 1,565 ms), against 4 to 9 s of generation. In memory, the packed layout is **64.5 MB against 346.7 MB** (10.0 bytes per
vertex against 55.7; MEASURED sizes), with a worst position error of 1.27 cm (int16 per 60,000-vertex chunk; smaller chunks give
finer steps).

*Optimistic best case.* Core catalog costs about 0.1 to 0.3 s at load instead of 4 to 9 s of compute (and instead of the 29 to 45 s the
user sees), runs in a worker with no generator code at all, and the phone holds a fifth of the memory if the shader reads the
packed form (§7 day 2).

*Cost.* +1 to 2.4 MB on the wire; the baked file must be rebuilt whenever a recipe changes (a CI step re-bakes and diffs; the baker
is 4 to 9 s); anything the generator decides at run time becomes a second baked variant (the graphics preset's detail level, the
pseudo-random lit-window pattern from `CityNight`, `?apartments`-style switches); the packed layout needs the vertex shader to
dequantise and look tones up (this is where the real engineering is). Flat shading needs a normal per face, so welding vertices
(what a mesh optimiser usually does) is not available without moving the normal into the shader (`dFdx`/`dFdy`).

### (c) Facade stamping and the pattern pipeline

*What it is.* `js/facades.js` draws each tile on a canvas on the main thread (about 2 ms per tile by its own comment), then a worker
pool does `applyMottle`, `decimate`, `blurWrap` and `premultiplyInto` on the pixels. In the speed lane's cold-load profile `blurWrap`
is the top function by self time (8.8 s of 113 s on the main thread, 7.8%) and two pattern workers were busy 83.6 s and 76.5 s: by
CPU this is the biggest block of the load.

*I built the strongest version of it and measured it* (`blur/compare-and-bench.mjs`, `results/blur-bench.txt`): `blur_wrap` in the
same Wasm module, scalar and simd128, **byte-identical to `js/pattern-lowpass.js` on 408 cases** (every tile size from 8 to 512,
radii 0 to 9, four blend amounts, extreme tiles). Result, CPU time per tile, fastest of 9 interleaved rounds:

| Tile | JS | Wasm exact, with tile copied in and out | Wasm exact, no copy | Wasm approximate (f32, reciprocal) |
|---|---:|---:|---:|---:|
| 128 x 128, r 3 | 0.650 ms | 0.678 to 0.713 (0.91 to 0.96x) | 0.620 (1.05x) | 0.457 (1.42x) |
| 256 x 256, r 3 | 2.619 ms | 2.766 to 2.824 (0.93 to 0.95x) | 2.422 (1.08x) | 1.763 (1.49x) |
| 512 x 512, r 2 | 10.735 ms | 10.681 to 11.385 (0.94 to 1.01x) | 9.625 (1.12x) | 7.145 (1.50x) |

**Rust did not beat V8 here.** The JS is already a tight typed-array loop with a sliding window; the Wasm is at parity to a few
percent faster before copy costs and a few percent slower after. A looser, approximate version (not byte-identical: 0.08% of bytes
differ, never by more than 1 level) reaches 1.4x to 1.5x, which is worth knowing and not worth the risk. This is the same lesson as
the OpenUI parser and Mozilla's JS catching up (§2.2): Wasm wins when the JS version allocates, grows and copies; it does not win
on arithmetic V8 already compiles well. The way to speed the pattern pipeline is to do less (fewer tiles, fewer tiers, one pass), not
to translate it.

*Optimistic best case:* none from the language. *Cost:* n/a.

### (d) Route search and the walking graph

Measured (`analysis/route-bench.mjs`, `results/` quoted here): the graph (11,229 nodes) decodes in 33 ms including the JSON parse; a
route query between two building codes is **6.2 ms fastest, 10.0 ms median** (two Dijkstra passes: the normal cost and the
fast-time floor; 395 random pairs, 7 runs, loaded machine). *Optimistic best case:* a Rust Dijkstra or contraction hierarchy
(`fast_paths` reports 55 microseconds on a New York road graph, native) would answer in about a tenth of a millisecond, saving about 6
ms per query (ESTIMATE; no Wasm figure exists). *Cost:* a second implementation of the cost model, which `scripts/verify/finder-correctness.mjs`
exists to keep honest in ONE place. Nothing waits on 6 ms. If a feature ever needs all pairs (157 walkable building codes make
24,649 pairs), bake the table once in the existing Python bake: it is 49 KB at two bytes a pair. No Rust.

### (e) Decoding the live bus protobuf

Measured on the branch's own decoder (`analysis/protobuf-decode.mjs`): vehicle positions 3.7 microseconds for the 372-byte fixture,
trip updates 40.6 microseconds for the 2,566-byte fixture; scaled to the real feed sizes (20 KB every poll, 260 KB for trip
updates; EXTRAPOLATED) that is **0.2 ms and 4 ms per poll**, every 15 to 30 s. The research finds protobuf decoding in Wasm is
dominated by string and object creation, which is what this feed is made of. *Optimistic best case:* 4 ms to 1 ms. *Cost:* a module
and a build for nothing a user could see. Do not.

### (f) The Python bakes as one fast Rust CLI

`scripts/bake_*.py` is 45,917 lines. The code comments say what is slow: reading 2,400 roofs off z20 imagery tiles "takes ~15
minutes", probing footprints "takes minutes", nearest-road queries (a spatial index fixed one). Those are image I/O and per-pixel
probes. *Optimistic best case:* for numeric loops written as Python loops, a Rust rewrite is routinely 100x faster (one public
example: 362x, [poly-match](https://github.com/ohadravid/poly-match)); for vectorised Shapely/numpy it is about even (1.13 s vs 3.78 s
on 1.58 M polygons, but 3.34 s vs 3.61 s over the whole job, [geo-repair](https://docs.rs/crate/geo-repair/latest)). *Cost:* months
for 46,000 lines that run a few times a month and change often (the owner edits them between passes). I did not time any bake
(UNMEASURED). The right move is to profile each slow bake and replace only a measured hot loop (a PyO3 extension or a small CLI),
never to rewrite the set.

### (g) Anything else the code shows

- **Tone interning (JS, an hour).** The generator makes a new `[day, golden, night]` array for every lit window cell, 111,828 of them
  for 1,266 distinct tones, which defeats the builder's `WeakMap` colour cache (`rgb3` is 1.5% and `rgb` 1.5% of the speed lane's
  profile). Intern the arrays and the cache hits.
- **Capacity hint (JS, an hour).** The builder doubles seven typed arrays and then copies each into a trimmed array. Passing the
  vertex count (store it in the catalog index) and returning views removes ~0.9 GB of transient memory and 1.1 s of CPU in the replay
  (MEASURED: `typed-exact` against `typed`).
- **The index is predictable.** 9.34 M indices (35.6 MB) are `0,1,2,0,2,3` patterns on consecutive vertices; one flag per primitive
  regenerates them. A shared index buffer would do.
- **Bounding spheres.** When view culling is on, the build makes two more passes over the 6.5 M vertices (`computeBoundingSphere` and
  `rangeSphere`). The builder already touches every vertex once; it could keep each building's min and max as it goes. UNMEASURED
  here (my harness runs with culling off).
- **A worker for the rest of the generator** helps whether or not Rust is involved, and is §7 day 4.
- **The shadow proxy** (`js/city-lighting.js`, 3.9 s inclusive in the speed lane's profile) spends its time in MapLibre tile queries
  and polygon triangulation; the research says triangulation (earcut) is a poor Rust target.
- **wgpu / Bevy / rewriting the renderer** is the other lane's study (`~/Projects/flyover-renderer`); nothing here depends on it. The
  research notes a Bevy web build of 15 MB (old figure) and maplibre-rs is experimental, so neither is a drop-in.


## 5. The prototype and its numbers

### 5.1 What was built

`experiments/rust-mesh/`. The kernel is **the shared mesh builder** of `js/slopes.js` `build()`: `tri`, `quad` (welds a planar quad
to 4 vertices and 6 indices, falls back to two triangles when bent), `triN`, `facet`, flat normals, byte colours, per-vertex
surface. I chose it because it is the hottest *isolatable* routine (the generator itself is 3,400 lines of rules over JS objects)
and because every generator in the app calls it, so a Rust version helps all of them.

- `rust/src/lib.rs`: about 200 lines, no dependencies, flat `extern "C"` ABI, no wasm-bindgen. The JS writes 28-double records into a
  staging buffer that lives in Wasm memory, calls `process(n)`, and at the end reads the finished arrays as typed-array views of
  the same memory.
- Byte-identical on purpose: every float operation is f64 in the same order as the JS, and `hypot` reproduces V8's Kahan-summed
  `Math.hypot` (plain `sqrt(x*x+y*y+z*z)` differs in the last bit for some inputs and flips an f32 rounding now and then).
- `js/builder-app.mjs` cuts the app's own `build()` out of `js/slopes.js` at run time, so the JS side cannot drift. `js/builder-typed.mjs`
  is my best honest attempt at fast JS for the same job.

### 5.2 Correctness: the same bytes, three ways

`node compare.mjs` (about a second; fixture `fixtures/moontower`, 2 MB) and `node compare.mjs /tmp/stream-full` (the whole catalog):

- the app's own builder, the tuned JS and the Rust/Wasm all produce **identical sha256 on all eight attribute arrays**, and they
  equal the hash of what the REAL in-app build produced (recorded by running the real generator, not by the harness);
- a synthetic stream covers what the apartment generator never calls but other generators do (`triN`, facet runs, bent and
  degenerate quads, wrongly-wound quads): the app's builder against both twins, all identical;
- `--break` nudges one coordinate by 1e-9: all three report MISMATCH and the harness exits 1 (so it can fail);
- **end to end:** with the real generator running unchanged and its `build()` swapped for a thin adapter over the Wasm module
  (`profile/app-patch.mjs` `patchSlopesWasm`; nothing on disk changes), the city's geometry is identical to the recorded in-app
  build on all eight arrays (Node; every run printed `true`).

**A bug the end-to-end check caught, worth knowing.** The first adapter lost 5,574 of one building's 269,332 triangles whenever
`palette_add` happened to grow Wasm memory in the middle of a batch. `memory.grow()` detaches every view of the old buffer, and a
write into a detached `Float64Array` is silently dropped (no error). The kernel replay bench could never see it (the palette is loaded
before the stream); only comparing the whole real build's hashes did. The adapter now re-takes its view after every call that can
allocate and computes the tone id *before* indexing (`S[o + 1] = toneId(col)` writes to the array evaluated before the call). This
is the sort of failure a real integration needs the hash gate for.

### 5.3 Speed: the kernel, replayed

The recorded stream is 1,704,992 builder calls (294,638 triangles, 1,410,354 quads) = **3,113,629 triangles, 6,523,203 vertices**.
Each row is a fresh Node process (cold JIT, as at page load), six rounds interleaved with the other rows. **CPU time of the process**
(user + system), because the Mac was at load average 48 to 134 during this set; wall time next to it.

| Builder | CPU ms min / median / max | ms per million triangles (min) | wall ms min | Peak memory above the load-only baseline |
|---|---:|---:|---:|---:|
| Shipped JS builder, driven from the stream | 2,357 / 2,426 / 2,459 | 757 | 2,691 | +911 MB |
| Tuned JS: typed array in, no per-call arrays | 2,164 / 2,194 / 2,269 | 695 | 2,484 | +919 MB |
| Tuned JS, vertex count known up front, views not copies | 1,280 / 1,292 / 1,373 | 411 | 1,341 | +424 MB |
| **Rust/Wasm** (includes copying the stream into Wasm memory, 95 to 130 ms) | **872 / 908 / 960** | **280** | 1,050 | +712 MB (650 MiB Wasm heap) |
| **Rust/Wasm, vertex count known** (3 runs) | **635 to 666** | **204** | | **+356 MB** (357 MiB) |
| Just creating the JS point arrays the generator would make | 150 / 161 / 168 | | | |

Reading it plainly: **Rust/Wasm is 2.7x less CPU than the shipped builder (3.7x with the count known) and 1.5x to 2x less than the
best JS I could write.** About two thirds of the Rust saving (2,357 to 1,280 ms of the 1,485 to 1,722 ms) is also available in plain JS by passing the vertex
count and returning views; the rest is Rust (the cause I did not isolate; the likely ones are V8's zero-fill-and-copy growth of seven
typed arrays and its garbage collector seeing 347 MB of them). The shipped-builder row includes the 150 ms it takes to make the point arrays from the stream (the generator makes
them anyway, `W.at()` returns one per point); the tuned-JS and Rust rows read the numbers straight from the stream, which is what a
generator that writes into a buffer would do.

Same comparison in headless Chrome 155 (`results/browser-kernel-nogpu.json`; no GPU needed; fresh page per run, 5 rounds
interleaved; **wall** time because Chrome offers no per-page CPU clock, machine at load 51 to 199): shipped JS builder 2,321 /
3,606 / 4,305 ms (min / median / max), tuned JS 2,132 / 2,720 / 6,486, **Rust/Wasm 702 / 1,339 / 3,148**: 3.3x faster than the shipped
builder and 3.0x faster than the tuned JS by the fastest runs. Streaming compile of the module took 5 / 7 / 23 ms (min / median / max),
instantiate under 1 ms. JS heap after the build: 1,209 MB with the JS builders, 366 MB with Wasm (plus its 650 MiB linear memory).

### 5.4 Speed: the whole build, real generator, Rust builder behind it

This is the number that matters, because the builder is only part of the work. The real generator (all 198 buildings, unchanged)
runs with the Wasm adapter in place of `build()`. Geometry checked identical in Node on every run.

| Whole build | Node wall min / median / max (CPU median) | Chrome wall min / median / max |
|---|---|---|
| Shipped JS builder | 4.06 / 7.18 / 13.3 s (9.2 s CPU median; 18 builds) | 3.86 / 8.65 / 17.5 s |
| Shipped JS builder, vertex count passed in (`S.build(n)`, the app's own parameter) | 5.02 / 7.23 / 13.0 s (7.6 s CPU; 9 builds) | not run |
| Rust builder, vertex count unknown | **3.09 / 3.80 / 6.61 s** (5.3 s CPU; 9 builds) | **2.42 / 5.07 / 11.6 s** |
| Rust builder, vertex count known | **2.74 / 3.66 / 10.2 s** (5.8 s CPU; 18 builds) | **2.62 / 4.15 / 6.09 s** |
| (for scale) generator with a builder that does nothing | 2.0 s | 1.65 s fastest, 2.4 s median |

Node: 9 to 18 builds per row in fresh processes at machine load 20 to 170; Chrome: 12 builds per row, three per fresh page, load 48 to 159.
So **swapping only the vertex/index builder cuts the whole build roughly in half by the median** (Node 7.2 to 3.7 s; Chrome 8.7 to 4.2 s with
the count known), more than the 40% to 50% share clocked in place would suggest. My reading (not isolated): the 347 MB of typed arrays
also load V8's allocator and garbage collector while the generator runs, and in Wasm memory they do not. By the fastest runs the gain is
smaller (1.4x to 1.6x), because a quiet moment hides that pressure. The in-JS one-line alternative (pass the count) saved CPU (9.2 to 7.6 s
median) but not wall time. (My first estimate, from the in-place clock alone, was 25% to 29%; the measurement is better than that.) Every
Node run printed `geometry identical ... true`; the Chrome runs were checked on triangle count (3,113,629 each).

### 5.5 What it does to the owner's 29 s (EXTRAPOLATION, marked as such)

- The generator and builder together are about **4 to 9 s of compute** here (Node 4.1 to 7.2 s, Chrome 3.9 to 8.7 s; fastest to
  median), against **29 s reported** on the owner's laptop. This Mac is the same class of machine, so the other ~20 to 25 s is waiting:
  slicing every 12 ms to let MapLibre parse tiles, the facade atlas, the sky. It also holds work my harness leaves out (the facade
  filter's texture rasterising, view-culling spheres), UNMEASURED.
- The Rust builder removes about 3.5 to 4.5 s of compute (median) or 1.4 to 1.7 s (fastest). **Applied to a 29 s wait with nothing else
  changed: 29 s becomes about 25 s (a saving of 1.4 to 4.5 s, roughly 5% to 15%) (ESTIMATE).**
- Put the same builder in a Worker and the build stops competing with the main thread: the wait becomes roughly the compute, **about 2.5
  to 5 s plus a copy of the finished buffers out of the worker (0.3 to 0.7 s, ESTIMATE from the `wasm-copy` row), instead of 29 s
  (ESTIMATE; it assumes a second core that is idle at load, which I cannot promise on a 2-core phone)**. That is the optimistic case, and Rust is
  a small part of it: most of the win is the worker.
- Per million triangles the builder alone now costs 204 to 280 ms of CPU (Node), against 757 ms.

### 5.6 Sizes and start-up

| | bytes |
|---|---:|
| `rustc` output for the mesh builder alone (opt-level 3) | 31,738 |
| after `wasm-opt -O3` | 27,225 |
| gzip -9 / brotli -11 | 10,009 / 8,328 |
| opt-level `s` or `z` with `wasm-opt` | 23,385 to 21,572 (gzip 9,810 to 9,748) |
| the committed `dist/meshkernel.wasm` (mesh builder + the blur experiment of §4c), after `wasm-opt -O3` | 34,038 |
| the same with `simd128` | 36,111 |

(`size-matrix.sh` prints the sizes of the crate as it is now, mesh builder plus blur: 34,038 / gzip 11,980 / brotli 9,810 at opt-level 3; the mesh-only rows above were taken before the blur module was added.) For scale, `three.min.js` is about 700 KB. Compile (Node, lazy tiering) 0.6 ms,
instantiate 0.2 ms (7 runs); Chrome `compileStreaming` 5 ms fastest. `opt-level=3` against `s`: `s` is 14% smaller before gzip and
the gzipped size is the same within 2%, so the choice does not matter for download; I kept 3.

### 5.7 Getting the buffers to the GPU

The same eight typed arrays are uploaded either way (`gl.bufferData` takes a view), so the upload itself is unchanged. What differs
is what happens *before* it: the shipped builder allocates growth buffers (doubling seven arrays, copying each time) and then copies
every array again with `.slice()` to trim it (`geometry()`), the difference between the "tuned JS" rows above; the Wasm path hands
out views of memory it already holds. **The upload timing itself is UNMEASURED:** the shared GPU slot was held by another lane for
the whole study (`gpu-run` status: busy, my request queued for more than 30 minutes), and a CPU-only headless Chrome has no WebGL. The harness
for it is written (`bench-browser.html?upload=1`, which times `gl.bufferData` of all eight arrays on a real WebGL2 context);
run it when the slot is free. Two facts bound the answer: a view of Wasm memory is an ordinary `ArrayBufferView` to WebGL, and
a view into Wasm memory is invalid after the next `memory.grow()`, so a three.js attribute that keeps pointing at it needs either a
module per build (what the adapter does) or one copy.

## 6. The build question (the repo has no build step)

Options considered, for a `.wasm` that the static site would load:

| Option | What it costs | Verdict |
|---|---|---|
| A. Commit the built `.wasm` next to its Rust source | one 27 KB binary in git per rebuild; a reviewer cannot read it | **Recommended**, with the two checks below |
| B. A GitHub Action builds on release and publishes the file | the site still needs the file in the repo or on Vercel (no build step), so the Action would have to commit back or Vercel gains a build step | not worth it for one small module |
| C. A script, `build.sh`, run by hand | the same as A without the checks | this is the tool A uses |

**Recommendation: A + C + two checks.**

1. `experiments/rust-mesh/build.sh` is the only way the file is produced (cargo, then `wasm-opt`; no npm, no wasm-bindgen, no wasm-pack).
   It writes `dist/meshkernel.wasm` and its sha256. Shown working: a from-scratch rebuild (`rm -rf rust/target && ./build.sh --check`)
   gave the identical sha256 `303518d1...5d71`, 27,225 bytes. The build removes the home folder and timestamps from the output
   (`--remap-path-prefix`, `--strip-debug --strip-producers`), which is what makes it repeatable.
2. **Every pull request** (no Rust needed in CI): a top-level `scripts/verify/wasm-mesh-parity.mjs` that runs the compare harness
   against the committed `.wasm`. `scripts/verify/ci/checks.json` says every top-level `scripts/verify/*.mjs` runs in CI on Linux
   automatically, so this lands as one file. It fails if the committed binary stops producing the same bytes as the JS builder.
3. **Only when `rust/**` changes** (a small separate workflow, needs the toolchain): rebuild and run the same compare. Byte identity
   with the committed file is checked too, but as a warning: it holds only on the same toolchain, and I have NOT measured whether the
   conda-forge `rustc 1.98.1` and rustup's official `1.98.1` produce the same bytes (UNMEASURED). Behavioural equality (step 2's
   compare) is the gate that matters.
4. Pin the toolchain in one place: `rust-toolchain.toml` (rustup users) and a conda `environment.yml` with `rust=1.98.1`, `binaryen=121`.

Loading it in the page needs no glue: `WebAssembly.compileStreaming(fetch('wasm/meshkernel.wasm'))` (served as `application/wasm`,
which Vercel does by extension). The module has no imports, so `new WebAssembly.Instance(module, {})` is the whole startup.

## 7. Roadmap, one day per step, optimistic path first

Each step ends in something measurable and something that can fail automatically. The gate for every step that touches triangles is
the same: **the same bytes out of the JS and the Rust for the same recipe** (`experiments/rust-mesh/compare.mjs`: sha256 of all eight
attribute arrays, against the recorded stream of the whole 198-building catalog, plus the synthetic edge cases). A step is not done
until that is green AND the existing pixel checks (`scripts/verify/apts-shots.mjs`, `slopes-chunked-build.mjs`) still pass.

| Day | Step | What it should gain | How it is tested | Stop here if |
|---|---|---|---|---|
| 1 | **Wire the prototype in behind a flag** (`?rustbuilder=1`): the generator's `B.quad/tri` write into a staging buffer, the wasm module builds, `geometry()` wraps zero-copy views (or one copy). Main thread, no worker yet. Also: intern tones (112k objects to 1.3k) and stop allocating `col.slice()` per window cell. | MEASURED in the prototype: the builder part costs 2.7x to 3.7x less CPU; behind the real generator the whole build roughly halves by the median (Node 7.2 to 3.7 s, Chrome 8.7 to 4.2 s). Plus about 17% CPU from passing the count to the JS builder alone. | compare.mjs on the full stream in CI; `slopes-chunked-build.mjs`; build once in Chrome with and without the flag, min of 7, same `count.ms` reading | the end-to-end `count.ms` in Chrome does not drop by at least 15% (min of 7, interleaved): the generator, not the builder, is the cost, and Rust at this layer is not worth another day |
| 2 | **Packed vertex layout**: the builder emits int16 positions per 60k-vertex chunk, octahedral normals and a u16 tone id; `slopes.js`'s vertex shader decodes and looks the tone up in a small texture/uniform table. | geometry memory 346.7 MB to about 64.5 MB (MEASURED sizes, in the byte study). This is the PHONE fix; speed is not the point. | `apts-shots.mjs` pixel-for-pixel against main at the 3 standard poses; `mobile-memory.mjs` | any pixel differs beyond the tolerance the existing shot checks use, or the shader's per-vertex cost shows in frame time on the integrated GPU |
| 3 | **Bake the core catalog offline, ship meshes, build nothing at load.** The baker is the Node harness that already runs the real generator (`profile/app-env.mjs`, about 6 s for the whole city); output is meshopt-coded buffers per graphics preset. The page decodes them (meshopt's Wasm decoder, 1 to 3 GB/s) and uploads. | wire bytes go UP, 1.61 MB to 2.5 to 4.0 MB brotli (MEASURED); load-time CPU for the city from 4 to 9 s of compute to about 0.1 to 0.3 s (the decode is MEASURED at 122 ms fastest in Node; the generator disappears from the page for the core catalog). | the baked buffers hash-equal the live generator's output (same compare.mjs, same stream); a CI step re-bakes and diffs | any recipe field depends on something only known at runtime (the lit-window pattern from `CityNight`, the graphics preset's detail) that cannot be a second baked variant |
| 4 | **Move what is left of the generator into a Worker** (or keep it only for edits). It has no DOM; it needs `THREE.ShapeUtils`, `APTS` and a handful of `window.*` reads. | main-thread time for any runtime rebuild (detail change, areas) drops to a copy. Independent of Rust. | `apartment-areas.mjs`, `apartment-map-lifecycle.mjs` | the worker needs more than about 8 `window.*` reads to be supplied (then bake instead, step 3) |
| 5 | **Port the cell tiler (`tileFace`, `faceCell`, `box`, `blades`) to Rust**, JS resolving skins to flat row/column/window tables first. | The only step that attacks the generator's own cost. That cost is 2.0 s in Node and 1.65 to 2.4 s in Chrome (the do-nothing-builder run, a lower bound), so even a 3x Rust port saves at most about 1.1 to 1.6 s (ESTIMATE, an upper bound). | compare.mjs on the stream recorded BEFORE the port against the stream produced AFTER (the port must emit the same quads in the same order) | the JS-side table building (skins, `h01`, window rules) is as expensive as the tiling it feeds: then there is nothing for Rust to speed up |
| 6 | **Profile the facade worker pool and cut work, not language.** `blurWrap` was ported byte-identically and measured at 0.91x to 1.12x of the JS (§4c): no gain. Profile `applyMottle`, `decimate`, `premultiplyInto` in the workers the same way; remove tiers, tiles or passes. | The facade pipeline is the biggest CPU block of the cold load (about 160 s of worker CPU and 8.8 s of main-thread `blurWrap` on the speed lane's loaded sample), so any real saving is large; none comes from translating the blur. | `facade-parity.mjs`, `facade-pace.mjs` | each pass is already at parity in a byte-identical Wasm twin: then only doing less work helps |
| 7 | **Decide on threads and COOP/COEP** with the §2.5 test: load the whole page under `require-corp` and list what the browser blocks. Only worth doing if steps 1 to 6 left a CPU-bound loop that parallelises. | none by itself | a headless load of the full page with the headers, asserting `crossOriginIsolated === true` and zero blocked resources | any blocked resource that cannot be given a CORP/CORS header |
| never | route search, bus protobuf decode, Python bakes as a whole | see §4 | | |

Order of the three that pay: **day 1 first, because it is the cheapest way to turn the prototype's measured halving into a real
`count.ms`; days 2 and 3 next, because they cut the thing the owner's phone actually fails on (memory) and the load-time CPU, and
neither needs Rust at runtime (day 3 needs none anywhere).** Days 4 to 7 are only worth starting if the numbers from days 1 to 3 leave
something to fix.


## 8. What I could not measure (and what would settle it)

- **The real page.** Nothing here is wired into the site (the rule), so there is no `count.ms` with Rust in it. §5.4 swaps the
  builder behind the real generator with no map and no other work on the page; the gap from there to the app's 29 s (facade-filter
  rasterising, culling spheres, MapLibre contention) is not measured. Settling it: flip the adapter in behind a flag and read
  `slopesApartments.count.ms` min of 7.
- **A quiet machine.** The Mac sat at load average 43 to 460 the whole time (other lanes' browsers). I used CPU time where I could
  (Node) and interleaved fresh processes; Chrome offers only wall time, so its figures are noisier. The ratios agree across both.
- **GPU upload and a real GPU.** The shared slot was never free (§5.7). `bench-browser.mjs` has the upload timing ready.
- **A phone.** No iPhone here. The iOS Wasm allocation limit (about 300 to 500 MB per the cited WebKit report) is the thing to test:
  357 MiB of linear memory with the count known, 650 MiB without it, so the hint is not optional on a phone, and the build there is
  chunked (`LITE.budget.geometryChunkTris`) which the adapter does not do yet.
- **Threads and the headers.** I checked the headers of the two CDN origins (§2.5) but did not load the whole page under
  COOP/COEP, and built nothing threaded. Not needed by anything here.
- **Rust and Wasm vs byte-identical across toolchains.** The committed `.wasm` rebuilds byte-for-byte on this machine from scratch;
  whether the official rustup 1.98.1 gives the same bytes as the conda-forge one is untested.
- **Python bakes** (not timed), **facade worker CPU split** (read, not profiled: `mottle` / `decimate` / `premultiply` costs inside
  the workers are unknown; only `blurWrap` was ported), **the tile-level generator logic in Rust** (day 5 of the roadmap is an
  estimate, not a measurement).
- **Peak memory of the page.** Peak RSS is for the Node process on the replay, not for a browser tab.

## 9. Everything is reproducible

`experiments/rust-mesh/README.md` has the exact commands. The raw runs are in `experiments/rust-mesh/results/`:
`node-kernel-cpu.json` (the §5.3 table), `node-kernel-wall-load50-460.json` (the first, loaded wall-time set),
`browser-kernel-nogpu.json`, `browser-build-*.json`, `node-end-to-end.txt`, `in-situ-share-node.txt`, `pack-size.txt`,
`blur-bench.txt`, `protobuf-decode.txt`. The study's Node scripts need three.js r159 outside the repo
(`THREE_JS=/path/to/three.min.js`; the file `index.html` loads from unpkg), and `meshoptimizer` from npm outside the repo for the
codec row. Neither was added to the repository.

## 10. For the journal

Rust/Wasm study (branch `mac/rust-study`, draft PR). I ran the app's own generator and builder in Node and in a bare Chrome page,
built a Rust/Wasm version of the shared mesh builder (`experiments/rust-mesh/`, 34 KB, no dependencies), and made three builders
(the app's, a tuned JS twin, the Rust) produce byte-identical buffers on the whole 3.1 M-triangle catalog, then replayed the call stream
(Rust 2.7x to 3.7x less CPU than the shipped builder) and put the Rust builder behind the real generator (whole build about halved by the
median, geometry hash-identical). Candidates measured: baked meshes (wire bytes go up from 1.61 to 2.5 to 4.0 MB, decode 122 ms, memory
346.7 to 64.5 MB), facade blur (Rust at parity, 0.91x to 1.12x), route search (6.2 ms), bus protobuf (0.2 to 4 ms), Python bakes (not
timed). Findings that matter more than the language: the compute is 4 to 9 s while the app waits 29 to 45 s; 26 of 55.7 bytes per
vertex are 1,266 tones; the CDN origins already send CORP so threads would be possible but are not needed. Nothing in the site loads any of
it. The recommended order is in §7 (wire the builder behind a flag, pack the vertex layout, bake the core catalog), with stop rules.
