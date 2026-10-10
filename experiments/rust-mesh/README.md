# rust-mesh: a prototype for "what can we rewrite in Rust"

Nothing in the site loads anything in this folder. It backs `docs/rust-study-2026-10-09.md` (read that first; it has the
numbers, the research and the roadmap).

What is here:

| Path | What |
|---|---|
| `rust/` | `meshkernel`: the shared mesh builder of `js/slopes.js` `build()` (tri / quad / triN / facet, flat normals, welded planar quads, byte colours, per-vertex surface) as a WebAssembly module with a flat C ABI, plus `blur_wrap` (an experiment: `js/pattern-lowpass.js` in Rust). 34 KB. No dependencies. |
| `dist/meshkernel.wasm`, `dist/meshkernel-simd.wasm` (+ `.sha256`) | the built, `wasm-opt`ed modules, committed so the site would need no build step to use them (`SIMD=1 ./build.sh` makes the second) |
| `build.sh` | `cargo build` + `wasm-opt`; `./build.sh --check` rebuilds from scratch and fails if the bytes differ from the committed file |
| `js/builder-app.mjs` | the app's own `build()`, cut out of `js/slopes.js` at load time (not retyped), driven from a recorded stream |
| `js/builder-typed.mjs` | the same algorithm as tuned JS: typed array in, no per-call arrays. The honest competitor to the Rust. |
| `js/builder-wasm.mjs` | drives `meshkernel.wasm`: palette in, records in batches, zero-copy views out |
| `compare.mjs` | feeds one recorded stream to all three and demands byte-identical buffers (sha256 of every attribute array) |
| `fixtures/moontower/` | 2 MB stream recorded from the real generator (Moontower alone), with the sha256 of what the real in-app builder produced |
| `blur/compare-and-bench.mjs` | the second kernel: `blur_wrap` against the app's `js/pattern-lowpass.js`, 408 byte-identical cases, then an interleaved benchmark (finding: no gain) |
| `profile/` | loads the REAL `js/slopes.js` + `js/slopes-apartments.js` into Node (no browser, no map) and runs the real build over the real 198-building catalog; records the builder stream; times the builder's share |
| `bench-one.mjs`, `bench-node.mjs` | interleaved Node benchmark, one fresh process per run (cold JIT like a page load) |
| `bench-browser.html`, `bench-browser.mjs` | the same in headless Chrome with real GL (through `gpu-run.mjs`) |
| `analysis/` | bytes-on-the-wire study (`pack-size.mjs`), the route search (`route-bench.mjs`), the bus protobuf (`protobuf-decode.mjs`) |
| `results/` | the raw output of the runs quoted in the study. Host and stream paths are written generically (`x64 laptop-class CPU`, `stream-full`) on purpose. |
| `../../scripts/verify/rust-study-numbers.mjs` | the check that the study's headline numbers recompute from `results/` (runs in CI; no browser) |

## Commands (all from the repo root unless noted; Node 22+; no sudo, no global installs)

```bash
# one-time: a Rust toolchain in its own conda env (does not touch the system)
~/miniforge3/bin/conda create -y -n rustwasm -c conda-forge rust rust-std-wasm32-unknown-unknown binaryen
export PATH=~/miniforge3/envs/rustwasm/bin:$PATH

cd experiments/rust-mesh
./build.sh                 # builds dist/meshkernel.wasm
./build.sh --check         # rebuild from scratch, compare with the committed bytes
./size-matrix.sh           # wasm size for opt-level 3/s/z x wasm-opt -O3/-Oz

# the correctness gate (needs only Node; runs in about a second)
node compare.mjs                       # exit 0 = all three builders byte-identical (Moontower + synthetic edge cases)
node compare.mjs fixtures/moontower --break    # must print MISMATCH and exit 1: the gate can fail

# the full-catalog work needs three.js r159 (the file index.html loads from unpkg), kept OUTSIDE the repo
curl -sLo /tmp/three.min.js https://unpkg.com/three@0.159.0/build/three.min.js
export THREE_JS=/tmp/three.min.js
node profile/node-apartments-build.mjs 5               # the real build, 3.1 M triangles, no browser
node --cpu-prof profile/node-apartments-build.mjs 3    # same, with a CPU profile
node profile/in-situ-share.mjs 5                       # how much of that build is the shared builder
node profile/node-apartments-build.mjs 3 --null-builder   # the generator alone (builder replaced by no-ops)
EXPECT=/tmp/stream-full/expected.json node profile/node-apartments-build.mjs 3 --wasm   # END TO END: the Rust builder behind the REAL generator, hash-checked
RESERVE=6523203 node profile/node-apartments-build.mjs 3 --wasm   # same, vertex count known in advance
HINT=6523203 node profile/node-apartments-build.mjs 3              # JS builder given the count (the app's own build(initialCapacity) parameter)
node blur/compare-and-bench.mjs both                   # the facade-blur kernel
node profile/record-stream.mjs /tmp/stream-full        # record the full 1.7 M-call stream (364 MB) and the in-app sha256s
node compare.mjs /tmp/stream-full                      # the three builders against the REAL build: byte-identical
node bench-node.mjs /tmp/stream-full 6 app,typed,typed-exact,wasm,materialize > results/node-kernel-cpu.json
node bench-node.mjs /tmp/stream-full 6 wasm-exact,app,materialize > results/node-kernel-cpu-wasm-exact.json   # the vertex-count-known row
node analysis/pack-size.mjs /tmp/stream-full           # wire bytes: recipes vs baked meshes
node analysis/route-bench.mjs
# browser: one at a time on this Mac, through the lane gate
NOGPU=1 node bench-browser.mjs /tmp/stream-full 5 > results/browser-kernel-nogpu.json        # CPU only: no GPU slot needed
NOGPU=1 node bench-browser-build.mjs 4 real,wasm,wasm-exact > results/browser-build-real-wasm.json   # whole generator in Chrome
node ~/Projects/astra-pipe/tools/gpu-run.mjs --label rust -- node bench-browser.mjs /tmp/stream-full 3 wasm,typed   # with real WebGL: times gl.bufferData too
# (bench-browser.mjs imports playwright-core; scripts/verify/node_modules has it after `cd scripts/verify && npm install`)
```

## Rules this prototype follows

- Every float operation is f64 in the order `js/slopes.js` does it; `hypot` reproduces V8's Kahan-summed `Math.hypot`
  (plain `sqrt(x*x+y*y+z*z)` differs in the last bit for some inputs and would flip an f32 rounding now and then).
- The JS twin is cut from `js/slopes.js` at run time, so it cannot drift from the app. If that function moves, the harness
  stops with "js/slopes.js moved".
- Timing follows `scripts/verify/README.md`: interleaved, fresh process per run, the minimum and the spread, the machine
  load written beside every sample.
